import React from 'react';
import { Port, Ship } from '../types';
import {
  ago,
  cname,
  etaFmt,
  findDestPort,
  flag,
  getShipColor,
  km,
  where,
} from '../utils/formatters';

interface ShipSheetProps {
  ship: Ship | null;
  ports: Record<string, Port>;
  onClose: () => void;
}

export const ShipSheet: React.FC<ShipSheetProps> = ({ ship, ports, onClose }) => {
  if (!ship) return null;

  const lp = ship.last ? ports[ship.last] : undefined;
  const dp = findDestPort(ship.dest, ports);

  let pct: number | null = null;
  if (lp && dp && lp !== dp) {
    const totalDist = km(lp.la, lp.lo, dp.la, dp.lo);
    const shipDist = km(lp.la, lp.lo, ship.lat, ship.lon);
    if (totalDist > 0) {
      pct = Math.min(94, Math.max(6, (shipDist / totalDist) * 100));
    }
  }

  const fromSub = !lp
    ? 'No port seen yet'
    : ship.port === ship.last
    ? 'first seen here ' + ago(ship.arrived)
    : ship.left
    ? 'left ' + ago(ship.left)
    : '';

  const originName = lp
    ? ship.port === ship.last
      ? where(ship, ports)
      : lp.name
    : 'Unknown';

  const hz =
    ship.tc && ship.tc % 10 >= 1 && ship.tc % 10 <= 4
      ? ` It declares hazardous cargo, category ${'ABCD'[(ship.tc % 10) - 1]}.`
      : '';

  const cg =
    ship.type === 'tanker'
      ? 'Tanker. Usually carries oil, oil products, chemicals or gas.'
      : 'Cargo ship. Could be containers, bulk or general cargo.';

  const dotColor = getShipColor(ship.type);

  const dlItems: { label: string; value: string | undefined }[] = [
    { label: 'Speed', value: ship.sog != null ? `${ship.sog.toFixed(1)} kn` : undefined },
    { label: 'Course', value: ship.cog != null ? `${Math.round(ship.cog)}°` : undefined },
    { label: 'Draught', value: ship.draught ? `${ship.draught} m` : undefined },
    { label: 'Length', value: ship.len ? `${ship.len} m` : undefined },
    { label: 'MMSI', value: ship.mmsi },
    { label: 'IMO', value: ship.imo },
    { label: 'Last heard', value: ago(ship.ts) },
    { label: 'Position', value: `${ship.lat.toFixed(3)}, ${ship.lon.toFixed(3)}` },
  ];

  return (
    <article
      id="sheet"
      className="open"
      aria-live="polite"
      style={{ '--tc': dotColor } as React.CSSProperties}
    >
      <div className="hd">
        <div>
          <h2>{ship.name}</h2>
          <p>
            {ship.type === 'tanker' ? 'Tanker' : 'Cargo ship'}
            {ship.flag ? `, ${flag(ship.flag)} ${cname(ship.flag)}` : ''}
          </p>
        </div>
        <button
          className="x-btn"
          aria-label="Close"
          onClick={onClose}
          type="button"
        >
          &times;
        </button>
      </div>

      <div className="pass">
        <div>
          <b>{originName}</b>
          <small>{fromSub}</small>
        </div>
        <div className="rail">
          {pct != null && (
            <i style={{ left: `${pct}%`, background: dotColor }} />
          )}
        </div>
        <div className="r">
          <b>{ship.dest || 'Not declared'}</b>
          <small>
            {ship.eta ? 'ETA ' + etaFmt(ship.eta) : 'Declared by crew'}
          </small>
        </div>
      </div>

      <dl className="ship-props">
        {dlItems.map(
          (item) =>
            item.value && (
              <div key={item.label}>
                <dt>{item.label}</dt>
                <dd>{item.value}</dd>
              </div>
            )
        )}
      </dl>

      <p className="cg">
        <b>Cargo is not broadcast.</b> {cg}
        {hz} Destination, ETA and draught are typed in by the crew.
      </p>
    </article>
  );
};
