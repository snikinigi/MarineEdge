"""MarineEdge recorder, all in one file (docs/TASKS.md Task 7).

Listens to AISStream all the time and saves what it hears into PostgreSQL + PostGIS.
Run it on the always-on server:   python recorder_standalone.py

Settings go in a .env file on the server (never in Git, never in a chat):
    DATABASE_URL=...         the PostgreSQL + PostGIS address
    AISSTREAM_API_KEY=...    the AISStream key
Optional: RECORDER_BBOX=lat1,lon1,lat2,lon2 (default: the Oman / UAE / Hormuz box collect.mjs uses).

What it keeps (docs/PLAN.md decision 4): cargo ships and tankers with a valid IMO, at most one position
per ship per 5 minutes while moving and one per 30 minutes while stopped, plus every change in name,
call sign, MMSI or draught. It prints a status line every minute.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import signal
import sys
import time
from collections import Counter
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Iterable
from urllib.parse import urlparse



# ============================================================================
# IMO numbers
# ============================================================================

def normalise_imo(value: object) -> str | None:
    """Return the IMO as seven-digit text, or None if it is missing or not valid.

    AIS ships often broadcast 0 or a made-up number when they have no IMO; those give None.
    """
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        text = str(value)
    elif isinstance(value, str):
        text = value.strip()
    else:
        return None
    if len(text) != 7 or not text.isascii() or not text.isdigit():
        return None
    total = sum(int(d) * w for d, w in zip(text[:6], range(7, 1, -1)))
    return text if total % 10 == int(text[6]) else None


def is_valid_imo(value: object) -> bool:
    return normalise_imo(value) is not None



# ============================================================================
# Database schema
# ============================================================================

SCHEMA_SQL = """
-- MarineEdge recorded data (docs/PLAN.md section 5). Safe to run again and again.
-- All times are UTC (timestamptz). Calculated tables (port_calls, voyages, flags) come with later tasks.

-- One row per ship we track. Keyed on IMO, seven digits.
CREATE TABLE IF NOT EXISTS vessels (
    imo             text PRIMARY KEY CHECK (imo ~ '^[0-9]{7}$'),
    first_recorded  timestamptz NOT NULL,
    last_recorded   timestamptz NOT NULL,
    ship_type_code  smallint,
    length_m        real,
    beam_m          real
);

-- One row each time a ship's own details change (name, call sign, MMSI or draught).
-- Destination and ETA are saved with the row but do not create a row on their own.
CREATE TABLE IF NOT EXISTS static_observations (
    imo          text NOT NULL,
    time         timestamptz NOT NULL,
    mmsi         text NOT NULL,
    name         text,
    call_sign    text,
    draught      real,
    destination  text,
    eta          text,
    source       text NOT NULL DEFAULT 'aisstream',
    PRIMARY KEY (imo, time)
);
CREATE INDEX IF NOT EXISTS static_observations_mmsi_idx ON static_observations (mmsi, time DESC);

-- Every recorded position. One row per ship per time, one partition per month
-- (positions_YYYY_MM, created by the recorder). source says where the row came from:
-- 'aisstream' = live recorder, 'git-history' = one-off import of data/history, low detail.
CREATE TABLE IF NOT EXISTS positions (
    imo         text NOT NULL,
    mmsi        text,
    time        timestamptz NOT NULL,
    point       geometry(Point, 4326) NOT NULL,
    speed       real,
    course      real,
    heading     real,
    nav_status  smallint,
    source      text NOT NULL DEFAULT 'aisstream',
    PRIMARY KEY (imo, time)
) PARTITION BY RANGE (time);
CREATE INDEX IF NOT EXISTS positions_point_gix ON positions USING gist (point);

-- Positions heard before we know the ship's IMO. They move to positions once the IMO is heard.
-- Rows older than three days are deleted by the recorder.
CREATE TABLE IF NOT EXISTS unmatched_positions (
    mmsi        text NOT NULL,
    time        timestamptz NOT NULL,
    point       geometry(Point, 4326) NOT NULL,
    speed       real,
    course      real,
    heading     real,
    nav_status  smallint,
    PRIMARY KEY (mmsi, time)
);
CREATE INDEX IF NOT EXISTS unmatched_positions_time_idx ON unmatched_positions (time);
"""


def partition_name(year: int, month: int) -> str:
    return f"positions_{year:04d}_{month:02d}"


def month_bounds(year: int, month: int) -> tuple[datetime, datetime]:
    """First instant of the month and of the next month, in UTC."""
    start = datetime(year, month, 1, tzinfo=timezone.utc)
    end = datetime(year + 1, 1, 1, tzinfo=timezone.utc) if month == 12 else datetime(year, month + 1, 1, tzinfo=timezone.utc)
    return start, end


def ensure_partition(cur, year: int, month: int) -> None:
    """Create the partition of positions for one month if it does not exist yet."""
    start, end = month_bounds(year, month)
    # Name and dates are built from integers above, never from outside text.
    cur.execute(
        f"CREATE TABLE IF NOT EXISTS {partition_name(year, month)} PARTITION OF positions "
        f"FOR VALUES FROM ('{start.isoformat()}') TO ('{end.isoformat()}')"
    )


def apply_schema(conn) -> None:
    """Make sure PostGIS is on and the tables exist. Needs a database user that may create tables."""
    with conn.cursor() as cur:
        cur.execute("SELECT 1 FROM pg_extension WHERE extname = 'postgis'")
        if cur.fetchone() is None:
            cur.execute("CREATE EXTENSION postgis")
        cur.execute(SCHEMA_SQL)
    conn.commit()



# ============================================================================
# Reading AISStream messages
# ============================================================================

STREAM_URL = "wss://stream.aisstream.io/v0/stream"
MESSAGE_TYPES = ["PositionReport", "ShipStaticData"]


@dataclass(frozen=True)
class PositionFix:
    mmsi: str
    time: datetime
    lat: float
    lon: float
    speed: float | None  # knots
    course: float | None  # degrees
    heading: float | None  # degrees
    nav_status: int | None


@dataclass(frozen=True)
class StaticReport:
    mmsi: str
    time: datetime
    imo: str | None  # None when missing or not a valid IMO
    ship_type: int | None
    name: str | None
    call_sign: str | None
    length: float | None  # metres
    beam: float | None  # metres
    draught: float | None  # metres, as typed in by the crew
    destination: str | None
    eta: str | None  # "MM-DD HH:MM" (AIS carries no year)


def parse_bbox(text: str) -> list[list[list[float]]]:
    """Turn "lat1,lon1,lat2,lon2" into AISStream's BoundingBoxes value."""
    parts = [p.strip() for p in text.split(",")]
    if len(parts) != 4:
        raise ValueError("RECORDER_BBOX must look like: lat1,lon1,lat2,lon2")
    lat1, lon1, lat2, lon2 = (float(p) for p in parts)
    if not (-90 <= lat1 <= 90 and -90 <= lat2 <= 90 and -180 <= lon1 <= 180 and -180 <= lon2 <= 180):
        raise ValueError("RECORDER_BBOX has a latitude outside -90..90 or a longitude outside -180..180")
    return [[[lat1, lon1], [lat2, lon2]]]


def subscription_message(api_key: str, bbox: list[list[list[float]]]) -> str:
    """The first message to send after connecting (AISStream closes the link if it is late)."""
    return json.dumps({"APIKey": api_key, "BoundingBoxes": bbox, "FilterMessageTypes": MESSAGE_TYPES})


def parse_time_utc(text: object, now: datetime) -> datetime:
    """AISStream writes '2026-10-19 12:34:56.789012345 +0000 UTC'. Anything odd gives `now`."""
    if isinstance(text, str):
        parts = text.split()
        if len(parts) >= 2:
            clock = parts[1]
            if "." in clock:
                whole, frac = clock.split(".", 1)
                clock = f"{whole}.{frac[:6].ljust(6, '0')}"
            try:
                parsed = datetime.fromisoformat(f"{parts[0]}T{clock}").replace(tzinfo=timezone.utc)
            except ValueError:
                return now
            if abs(parsed - now) <= timedelta(days=1):
                return parsed
    return now


def parse_message(raw: object, now: datetime) -> PositionFix | StaticReport | None:
    """One decoded JSON message to a PositionFix or StaticReport. None if it is not usable."""
    if not isinstance(raw, dict):
        return None
    meta = raw.get("MetaData") or raw.get("Metadata") or {}
    message = raw.get("Message") or {}
    kind = raw.get("MessageType")
    if kind == "PositionReport":
        return _position(meta, message.get("PositionReport"), now)
    if kind == "ShipStaticData":
        return _static(meta, message.get("ShipStaticData"), now)
    return None


def _num(value: object) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return float(value)


def _mmsi(meta: dict, body: dict) -> str | None:
    for value in (meta.get("MMSI"), body.get("UserID")):
        if isinstance(value, int) and not isinstance(value, bool) and value > 0:
            return str(value)
    return None


def _position(meta: dict, body: object, now: datetime) -> PositionFix | None:
    if not isinstance(body, dict):
        return None
    mmsi = _mmsi(meta, body)
    lat = _num(body.get("Latitude", meta.get("latitude")))
    lon = _num(body.get("Longitude", meta.get("longitude")))
    if mmsi is None or lat is None or lon is None:
        return None
    # 91 and 181 mean "not available"; (0, 0) is a transponder with no fix.
    if not (abs(lat) <= 90 and abs(lon) <= 180) or (lat == 0 and lon == 0):
        return None
    sog, cog, hdg = _num(body.get("Sog")), _num(body.get("Cog")), _num(body.get("TrueHeading"))
    nav = body.get("NavigationalStatus")
    return PositionFix(
        mmsi=mmsi,
        time=parse_time_utc(meta.get("time_utc"), now),
        lat=lat,
        lon=lon,
        speed=sog if sog is not None and 0 <= sog < 102.3 else None,  # 102.3 = not available
        course=cog if cog is not None and 0 <= cog < 360 else None,
        heading=hdg if hdg is not None and 0 <= hdg < 360 else None,  # 511 = not available
        nav_status=nav if isinstance(nav, int) and not isinstance(nav, bool) and 0 <= nav <= 15 else None,
    )


def _clean(text: object, *, join: str = "") -> str | None:
    """AIS pads text with '@'. Remove the padding; empty becomes None."""
    if not isinstance(text, str):
        return None
    cleaned = re.sub(r"\s+", " ", re.sub(r"@+", join, text)).strip()
    return cleaned or None


def _eta(eta: object) -> str | None:
    if not isinstance(eta, dict):
        return None
    month, day, hour, minute = (_num(eta.get(k)) for k in ("Month", "Day", "Hour", "Minute"))
    if None in (month, day, hour, minute):
        return None
    if 1 <= month <= 12 and 1 <= day <= 31 and 0 <= hour < 24 and 0 <= minute < 60:
        return f"{int(month):02d}-{int(day):02d} {int(hour):02d}:{int(minute):02d}"
    return None


def _static(meta: dict, body: object, now: datetime) -> StaticReport | None:
    if not isinstance(body, dict):
        return None
    mmsi = _mmsi(meta, body)
    if mmsi is None:
        return None
    dim = body.get("Dimension") if isinstance(body.get("Dimension"), dict) else {}
    a, b, c, d = (_num(dim.get(k)) for k in ("A", "B", "C", "D"))
    length = a + b if a is not None and b is not None and a + b > 0 else None
    beam = c + d if c is not None and d is not None and c + d > 0 else None
    draught = _num(body.get("MaximumStaticDraught"))
    ship_type = body.get("Type")
    return StaticReport(
        mmsi=mmsi,
        time=parse_time_utc(meta.get("time_utc"), now),
        imo=normalise_imo(body.get("ImoNumber")),
        ship_type=ship_type if isinstance(ship_type, int) and not isinstance(ship_type, bool) and 0 <= ship_type <= 99 else None,
        name=_clean(body.get("Name")) or _clean(meta.get("ShipName")),
        call_sign=_clean(body.get("CallSign")),
        length=length,
        beam=beam,
        draught=draught if draught is not None and draught > 0 else None,  # 0 = not available
        destination=_clean(body.get("Destination"), join=" "),
        eta=_eta(body.get("Eta")),
    )



# ============================================================================
# What the recorder keeps
# ============================================================================

MOVING_INTERVAL = timedelta(minutes=5)
STOPPED_INTERVAL = timedelta(minutes=30)
STOPPED_BELOW_KNOTS = 0.5
TRACKED_SHIP_TYPES = range(70, 90)  # 70-79 cargo, 80-89 tankers


class Throttle:
    """Says whether a new fix is far enough after the last kept one for the same ship."""

    def __init__(self) -> None:
        self._last: dict[str, datetime] = {}

    def allow(self, key: str, time: datetime, speed: float | None) -> bool:
        stopped = speed is not None and speed < STOPPED_BELOW_KNOTS
        interval = STOPPED_INTERVAL if stopped else MOVING_INTERVAL
        last = self._last.get(key)
        if last is not None and time - last < interval:  # also refuses fixes older than the last kept one
            return False
        self._last[key] = time
        return True

    def prune(self, now: datetime, keep: timedelta = timedelta(days=1)) -> None:
        cutoff = now - keep
        for key in [k for k, t in self._last.items() if t < cutoff]:
            del self._last[key]

    def __len__(self) -> int:
        return len(self._last)


@dataclass(frozen=True)
class VesselRow:
    imo: str
    time: datetime
    ship_type: int | None
    length: float | None
    beam: float | None


@dataclass(frozen=True)
class StaticRow:
    imo: str
    time: datetime
    mmsi: str
    name: str | None
    call_sign: str | None
    draught: float | None
    destination: str | None
    eta: str | None


@dataclass(frozen=True)
class PositionRow:
    imo: str
    mmsi: str
    time: datetime
    lat: float
    lon: float
    speed: float | None
    course: float | None
    heading: float | None
    nav_status: int | None


@dataclass(frozen=True)
class UnmatchedRow:
    mmsi: str
    time: datetime
    lat: float
    lon: float
    speed: float | None
    course: float | None
    heading: float | None
    nav_status: int | None


@dataclass
class Batch:
    """Everything waiting to be written to the database in one go."""

    vessels: list[VesselRow] = field(default_factory=list)
    statics: list[StaticRow] = field(default_factory=list)
    positions: list[PositionRow] = field(default_factory=list)
    unmatched: list[UnmatchedRow] = field(default_factory=list)
    attach: dict[str, str] = field(default_factory=dict)  # mmsi -> imo: move its unmatched positions across
    discard: set[str] = field(default_factory=set)  # mmsi we will never track: drop its unmatched positions

    def __len__(self) -> int:
        return (len(self.vessels) + len(self.statics) + len(self.positions)
                + len(self.unmatched) + len(self.attach) + len(self.discard))

    def merge(self, newer: "Batch") -> "Batch":
        """Add a newer batch after this one (used to retry a batch that failed to save)."""
        self.vessels += newer.vessels
        self.statics += newer.statics
        self.positions += newer.positions
        self.unmatched += newer.unmatched
        self.attach.update(newer.attach)
        self.discard |= newer.discard
        return self


@dataclass(frozen=True)
class KnownShip:
    """A ship already in the database, loaded at start so a restart does not repeat rows."""

    mmsi: str
    imo: str
    name: str | None
    call_sign: str | None
    draught: float | None


@dataclass
class ShipState:
    imo: str | None = None
    tracked: bool | None = None  # None = we have not heard its details yet
    vessel_sig: tuple | None = None


def _identity(mmsi: str, name: str | None, call_sign: str | None, draught: float | None) -> tuple:
    # Draught is stored as a 4-byte number, so compare to one decimal to avoid false changes after a restart.
    return (mmsi, name, call_sign, None if draught is None else round(draught, 1))


class Recorder:
    def __init__(self, known: Iterable[KnownShip] = ()) -> None:
        self.ships: dict[str, ShipState] = {}
        self.throttle = Throttle()
        self.batch = Batch()
        self.stats: Counter[str] = Counter()
        self._identity: dict[str, tuple] = {}  # imo -> details last saved
        for ship in known:
            self.ships[ship.mmsi] = ShipState(imo=ship.imo, tracked=True)
            self._identity[ship.imo] = _identity(ship.mmsi, ship.name, ship.call_sign, ship.draught)

    def take_batch(self) -> Batch:
        batch, self.batch = self.batch, Batch()
        return batch

    def handle(self, event: PositionFix | StaticReport) -> None:
        if isinstance(event, PositionFix):
            self._position(event)
        elif isinstance(event, StaticReport):
            self._static(event)

    def _position(self, fix: PositionFix) -> None:
        self.stats["positions_heard"] += 1
        ship = self.ships.get(fix.mmsi)
        if ship is not None and ship.tracked is False:
            self.stats["ignored"] += 1
            return
        if not self.throttle.allow(fix.mmsi, fix.time, fix.speed):
            self.stats["throttled"] += 1
            return
        if ship is not None and ship.tracked and ship.imo:
            self.batch.positions.append(PositionRow(ship.imo, fix.mmsi, fix.time, fix.lat, fix.lon,
                                                    fix.speed, fix.course, fix.heading, fix.nav_status))
            self.stats["positions_kept"] += 1
        else:
            self.batch.unmatched.append(UnmatchedRow(fix.mmsi, fix.time, fix.lat, fix.lon,
                                                     fix.speed, fix.course, fix.heading, fix.nav_status))
            self.stats["unmatched_kept"] += 1

    def _static(self, rep: StaticReport) -> None:
        self.stats["static_heard"] += 1
        ship = self.ships.setdefault(rep.mmsi, ShipState())
        tracked = rep.imo is not None and rep.ship_type is not None and rep.ship_type in TRACKED_SHIP_TYPES
        if not tracked:
            if ship.tracked is True:
                return  # one odd message from a ship we already follow does not make us drop it
            if ship.tracked is None:
                self.batch.discard.add(rep.mmsi)
            ship.tracked = False
            return
        assert rep.imo is not None
        mapping_changed = not ship.tracked or ship.imo != rep.imo
        ship.tracked, ship.imo = True, rep.imo
        sig = (rep.ship_type, rep.length, rep.beam)
        if mapping_changed or sig != ship.vessel_sig:
            self.batch.vessels.append(VesselRow(rep.imo, rep.time, rep.ship_type, rep.length, rep.beam))
            ship.vessel_sig = sig
        identity = _identity(rep.mmsi, rep.name, rep.call_sign, rep.draught)
        if self._identity.get(rep.imo) != identity:
            self.batch.statics.append(StaticRow(rep.imo, rep.time, rep.mmsi, rep.name, rep.call_sign,
                                                rep.draught, rep.destination, rep.eta))
            self._identity[rep.imo] = identity
            self.stats["static_rows"] += 1
        if mapping_changed:
            self.batch.attach[rep.mmsi] = rep.imo



# ============================================================================
# Writing to the database
# ============================================================================

log = logging.getLogger("recorder.store")

UNMATCHED_KEEP = timedelta(hours=72)

_SQL_KNOWN = """
    SELECT DISTINCT ON (imo) imo, mmsi, name, call_sign, draught
    FROM static_observations ORDER BY imo, time DESC"""
_SQL_UNMATCHED = """
    INSERT INTO unmatched_positions (mmsi, time, point, speed, course, heading, nav_status)
    VALUES (%s, %s, ST_SetSRID(ST_MakePoint(%s, %s), 4326), %s, %s, %s, %s)
    ON CONFLICT DO NOTHING"""
_SQL_DISCARD = "DELETE FROM unmatched_positions WHERE mmsi = ANY(%s)"
_SQL_VESSEL = """
    INSERT INTO vessels (imo, first_recorded, last_recorded, ship_type_code, length_m, beam_m)
    VALUES (%s, %s, %s, %s, %s, %s)
    ON CONFLICT (imo) DO UPDATE SET
        first_recorded = LEAST(vessels.first_recorded, EXCLUDED.first_recorded),
        last_recorded = GREATEST(vessels.last_recorded, EXCLUDED.last_recorded),
        ship_type_code = COALESCE(EXCLUDED.ship_type_code, vessels.ship_type_code),
        length_m = COALESCE(EXCLUDED.length_m, vessels.length_m),
        beam_m = COALESCE(EXCLUDED.beam_m, vessels.beam_m)"""
_SQL_STATIC = """
    INSERT INTO static_observations (imo, time, mmsi, name, call_sign, draught, destination, eta)
    VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
    ON CONFLICT DO NOTHING"""
_SQL_ATTACH = """
    INSERT INTO positions (imo, mmsi, time, point, speed, course, heading, nav_status, source)
    SELECT %s, mmsi, time, point, speed, course, heading, nav_status, 'aisstream'
    FROM unmatched_positions WHERE mmsi = %s
    ON CONFLICT DO NOTHING"""
_SQL_ATTACH_DELETE = "DELETE FROM unmatched_positions WHERE mmsi = %s"
_SQL_POSITION = """
    INSERT INTO positions (imo, mmsi, time, point, speed, course, heading, nav_status, source)
    VALUES (%s, %s, %s, ST_SetSRID(ST_MakePoint(%s, %s), 4326), %s, %s, %s, %s, 'aisstream')
    ON CONFLICT DO NOTHING"""
_SQL_LAST_RECORDED = "UPDATE vessels SET last_recorded = GREATEST(last_recorded, %s) WHERE imo = %s"
_SQL_PURGE = "DELETE FROM unmatched_positions WHERE time < %s"


def normalise_dsn(url: str) -> str:
    """psycopg wants postgresql://. The SQLAlchemy form postgresql+psycopg:// is accepted too."""
    for prefix in ("postgresql+psycopg://", "postgres+psycopg://"):
        if url.startswith(prefix):
            return "postgresql://" + url[len(prefix):]
    return url


def describe_target(dsn: str) -> str:
    """host:port/database for the log. Never the user name or password."""
    try:
        u = urlparse(dsn)
        return f"{u.hostname}:{u.port}{u.path}"
    except ValueError:
        return "(unreadable DATABASE_URL)"


def redact(text: str, dsn: str = "") -> str:
    """Remove anything that looks like a password or connection string before it reaches a log."""
    if dsn:
        text = text.replace(dsn, "<database url>")
    text = re.sub(r"postgres(?:ql)?(?:\+\w+)?://\S+", "<database url>", text)
    return re.sub(r"(?i)password\s*=\s*\S+", "password=<hidden>", text)


def _months(batch: Batch, now: datetime) -> set[tuple[int, int]]:
    months = {(r.time.year, r.time.month) for r in batch.positions}
    # Unmatched rows are at most three days old, so these two months cover everything we may move.
    for t in (now, now - timedelta(days=4)):
        months.add((t.year, t.month))
    return months


class Store:
    def __init__(self, dsn: str) -> None:
        self._dsn = dsn
        self._conn = None
        self._partitions: set[tuple[int, int]] = set()

    def _connection(self):
        if self._conn is None or self._conn.closed:
            import psycopg  # imported here so the tests do not need a database driver

            self._conn = psycopg.connect(self._dsn, connect_timeout=10)
            apply_schema(self._conn)
            self._partitions.clear()
        return self._conn

    def open(self, now: datetime | None = None) -> list[KnownShip]:
        """Connect, make sure the tables exist, and return the ships we already know."""
        now = now or datetime.now(timezone.utc)
        conn = self._connection()
        with conn.cursor() as cur:
            cur.execute("SELECT postgis_version()")
            log.info("database ready, PostGIS %s", cur.fetchone()[0])
            for year, month in _months(Batch(), now):
                ensure_partition(cur, year, month)
            self._partitions |= _months(Batch(), now)
            cur.execute(_SQL_KNOWN)
            known = [KnownShip(mmsi=m, imo=i, name=n, call_sign=c, draught=d) for i, m, n, c, d in cur.fetchall()]
        conn.commit()
        return known

    def flush(self, batch: Batch, now: datetime | None = None) -> None:
        """Save a batch in one transaction. Raises if anything fails; nothing is then saved."""
        if len(batch) == 0:
            return
        now = now or datetime.now(timezone.utc)
        conn = self._connection()
        needed = _months(batch, now)
        try:
            with conn.cursor() as cur:
                for year, month in sorted(needed - self._partitions):
                    ensure_partition(cur, year, month)
                if batch.unmatched:
                    cur.executemany(_SQL_UNMATCHED, [(r.mmsi, r.time, r.lon, r.lat, r.speed, r.course,
                                                      r.heading, r.nav_status) for r in batch.unmatched])
                if batch.discard:
                    cur.execute(_SQL_DISCARD, (sorted(batch.discard),))
                if batch.vessels:
                    cur.executemany(_SQL_VESSEL, [(r.imo, r.time, r.time, r.ship_type, r.length, r.beam)
                                                  for r in batch.vessels])
                if batch.statics:
                    cur.executemany(_SQL_STATIC, [(r.imo, r.time, r.mmsi, r.name, r.call_sign, r.draught,
                                                   r.destination, r.eta) for r in batch.statics])
                for mmsi, imo in batch.attach.items():
                    cur.execute(_SQL_ATTACH, (imo, mmsi))
                    cur.execute(_SQL_ATTACH_DELETE, (mmsi,))
                if batch.positions:
                    cur.executemany(_SQL_POSITION, [(r.imo, r.mmsi, r.time, r.lon, r.lat, r.speed, r.course,
                                                     r.heading, r.nav_status) for r in batch.positions])
                    latest: dict[str, datetime] = {}
                    for r in batch.positions:
                        if r.imo not in latest or r.time > latest[r.imo]:
                            latest[r.imo] = r.time
                    cur.executemany(_SQL_LAST_RECORDED, [(t, imo) for imo, t in latest.items()])
            conn.commit()
        except Exception:
            try:
                conn.rollback()
            except Exception:
                self.close()  # the link is gone; the next flush opens a new one
            raise
        self._partitions |= needed

    def purge_unmatched(self, now: datetime | None = None) -> None:
        now = now or datetime.now(timezone.utc)
        conn = self._connection()
        with conn.cursor() as cur:
            cur.execute(_SQL_PURGE, (now - UNMATCHED_KEEP,))
        conn.commit()

    def close(self) -> None:
        if self._conn is not None:
            try:
                self._conn.close()
            except Exception:
                pass
            self._conn = None



# ============================================================================
# The recorder program
# ============================================================================

log = logging.getLogger("recorder")

FLUSH_SECONDS = 10  # how often held rows are written to the database
STATS_SECONDS = 60  # how often a status line is printed
SILENCE_SECONDS = 120  # no message for this long: reconnect
HOUSEKEEPING_SECONDS = 3600  # purge old unmatched rows, forget idle ships in the throttle
MAX_HELD_ROWS = 200_000  # if the database stays down, stop holding rows beyond this


class StreamRejected(RuntimeError):
    """AISStream answered with an error (for example a bad key)."""


class Worker:
    def __init__(self, store: Store, recorder: Recorder, api_key: str, bbox: list) -> None:
        self.store, self.recorder, self.api_key, self.bbox = store, recorder, api_key, bbox
        self.messages = 0
        self.saved: Counter[str] = Counter()
        self.last_save: datetime | None = None
        self._held: Batch | None = None  # a batch that failed to save, retried first

    def _on_raw(self, raw: str | bytes) -> None:
        try:
            data = json.loads(raw)
        except ValueError:
            return
        if isinstance(data, dict) and data.get("error"):
            raise StreamRejected(str(data["error"]))
        self.messages += 1
        event = parse_message(data, datetime.now(timezone.utc))
        if event is not None:
            self.recorder.handle(event)

    async def _listen_once(self) -> None:
        import websockets  # imported here so the tests do not need it

        async with websockets.connect(STREAM_URL, open_timeout=15, ping_interval=20, ping_timeout=20,
                                      max_size=2**20) as ws:
            await ws.send(subscription_message(self.api_key, self.bbox))
            log.info("connected to AISStream")
            while True:
                try:
                    raw = await asyncio.wait_for(ws.recv(), timeout=SILENCE_SECONDS)
                except asyncio.TimeoutError:
                    raise RuntimeError(f"no messages for {SILENCE_SECONDS} seconds") from None
                self._on_raw(raw)

    async def _listen_forever(self) -> None:
        delay = 1
        while True:
            started = time.monotonic()
            try:
                await self._listen_once()
                reason = "connection closed"
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                reason = f"{type(exc).__name__}: {redact(str(exc))}"
                if isinstance(exc, StreamRejected):
                    delay = max(delay, 60)  # a rejected key will not fix itself in a second
            if time.monotonic() - started > 60 and delay < 60:
                delay = 1
            log.warning("AISStream disconnected (%s); reconnecting in %ds", reason, delay)
            await asyncio.sleep(delay)
            delay = min(delay * 2, 60)

    async def _flush_once(self) -> None:
        batch = self.recorder.take_batch()
        if self._held is not None:
            batch, self._held = self._held.merge(batch), None
        if len(batch) == 0:
            return
        try:
            await asyncio.to_thread(self.store.flush, batch)
        except Exception as exc:
            log.error("database write failed (%s: %s); will retry", type(exc).__name__, redact(str(exc)))
            if len(batch) <= MAX_HELD_ROWS:
                self._held = batch
            else:
                log.error("too many rows waiting; dropped %d rows", len(batch))
            return
        self.saved["positions"] += len(batch.positions)
        self.saved["unmatched"] += len(batch.unmatched)
        self.saved["static"] += len(batch.statics)
        self.last_save = datetime.now(timezone.utc)

    def _status_line(self) -> str:
        s = self.recorder.stats
        last = self.last_save.strftime("%H:%M:%S") if self.last_save else "never"
        held = len(self._held) if self._held else 0
        return (f"status: messages={self.messages} saved_positions={self.saved['positions']} "
                f"saved_details={self.saved['static']} waiting_ids={self.saved['unmatched']} "
                f"throttled={s['throttled']} ignored={s['ignored']} ships={len(self.recorder.ships)} "
                f"held_rows={held} last_save_utc={last}")

    async def _maintenance_loop(self) -> None:
        next_stats = next_house = time.monotonic()
        while True:
            await asyncio.sleep(FLUSH_SECONDS)
            await self._flush_once()
            now = time.monotonic()
            if now >= next_stats:
                log.info(self._status_line())
                next_stats = now + STATS_SECONDS
            if now >= next_house + HOUSEKEEPING_SECONDS:
                next_house = now
                self.recorder.throttle.prune(datetime.now(timezone.utc))
                try:
                    await asyncio.to_thread(self.store.purge_unmatched)
                except Exception as exc:
                    log.error("purge failed (%s: %s)", type(exc).__name__, redact(str(exc)))

    async def run(self, stop: asyncio.Event) -> None:
        tasks = [asyncio.create_task(self._listen_forever()), asyncio.create_task(self._maintenance_loop())]
        waiter = asyncio.create_task(stop.wait())
        await asyncio.wait([waiter, *tasks], return_when=asyncio.FIRST_COMPLETED)
        for t in (waiter, *tasks):
            t.cancel()
        await asyncio.gather(waiter, *tasks, return_exceptions=True)
        log.info("stopping; saving what is left")
        await self._flush_once()
        log.info(self._status_line())


def _open_store(dsn: str) -> tuple[Store, list]:
    """Connect to the database, waiting and retrying if it is not reachable yet."""
    store = Store(dsn)
    while True:
        try:
            return store, store.open()
        except Exception as exc:
            log.error("cannot use the database at %s (%s: %s). Retrying in 30 seconds. "
                      "Check DATABASE_URL in the .env file.",
                      describe_target(dsn), type(exc).__name__, redact(str(exc), dsn))
            store.close()
            time.sleep(30)


async def _run(worker: Worker) -> None:
    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            loop.add_signal_handler(sig, stop.set)
        except NotImplementedError:  # not on Windows; the server is Linux
            pass
    await worker.run(stop)


def load_env_file() -> None:
    """Read KEY=VALUE lines from a .env file next to this script (or the folder above, or where we run).
    Values already set in the real environment win. Nothing is ever printed."""
    here = os.path.dirname(os.path.abspath(__file__))
    for folder in (os.getcwd(), here, os.path.dirname(here)):
        path = os.path.join(folder, ".env")
        if not os.path.isfile(path):
            continue
        with open(path, encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, value = line.split("=", 1)
                value = value.strip()
                if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
                    value = value[1:-1]
                os.environ.setdefault(key.strip(), value)


class Config:
    def __init__(self) -> None:
        self.database_url = os.environ.get("DATABASE_URL", "").strip()
        self.aisstream_api_key = os.environ.get("AISSTREAM_API_KEY", "").strip()
        # lat1,lon1,lat2,lon2. Default: the Oman, UAE and Iran (Hormuz) box collect.mjs uses.
        self.recorder_bbox = os.environ.get("RECORDER_BBOX", "16.5,51.0,28.0,61.0").strip()


def main() -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s",
                        stream=sys.stdout)
    load_env_file()
    cfg = Config()
    if not cfg.database_url:
        log.error("DATABASE_URL is empty. Add it to the .env file on this server.")
        return 2
    if not cfg.aisstream_api_key:
        log.error("AISSTREAM_API_KEY is empty. Add it to the .env file on this server.")
        return 2
    try:
        bbox = parse_bbox(cfg.recorder_bbox)
    except ValueError as exc:
        log.error("%s", exc)
        return 2
    dsn = normalise_dsn(cfg.database_url)
    store, known = _open_store(dsn)
    log.info("database: %s; ships already known: %d; listening box (lat,lon): %s",
             describe_target(dsn), len(known), bbox[0])
    worker = Worker(store, Recorder(known), cfg.aisstream_api_key, bbox)
    try:
        asyncio.run(_run(worker))
    finally:
        store.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
