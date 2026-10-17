import React from 'react';
import { Port, Ship, ShipMeta } from '../types';
import { ago, cname, flag, getShipColor, where } from '../utils/formatters';

interface ShipListProps {
  ships: Ship[];
  totalShipsCount: number;
  selectedMmsi: string | null;
  onSelectShip: (mmsi: string) => void;
  ports: Record<string, Port>;
  meta: ShipMeta;
  visible: boolean;
}

export const ShipList: React.FC<ShipListProps> = ({
  ships,
  totalShipsCount,
  selectedMmsi,
  onSelectShip,
  ports,
  meta,
  visible,
}) => {
  const showFailNote =
    totalShipsCount > 0 &&
    (meta.status === 'error' || meta.status === 'no_messages');

  const renderEmpty = () => {
    if (totalShipsCount > 0) {
      return (
        <div className="empty">
          <b>No ships match</b>
          Try another name, number or port, or clear the filter.
        </div>
      );
    }
    if (meta.status === 'error' || meta.status === 'no_messages') {
      return (
        <div className="empty">
          <b>The collector heard no ships</b>
          {meta.error || 'Check that the AISSTREAM_API_KEY secret is set and valid.'}
        </div>
      );
    }
    if (meta.status === 'empty') {
      return (
        <div className="empty">
          <b>Heard traffic, but no cargo ships or tankers yet</b>
          Run the collector again in a few minutes.
        </div>
      );
    }
    return (
      <div className="empty">
        <b>No ships yet</b>
        In GitHub open Actions, choose collect, then Run workflow. Ships appear
        here when it finishes, about 8 minutes later.
      </div>
    );
  };

  return (
    <section
      id="ship-list"
      className={visible ? 'visible' : ''}
      aria-label="Ships"
    >
      {showFailNote && (
        <div className="note">
          <b>Last collector run failed</b>
          {meta.error || 'No messages received.'} Showing the previous data.
        </div>
      )}

      <div id="rows">
        {ships.length > 0
          ? ships.map((s) => {
              const isSelected = s.mmsi === selectedMmsi;
              const dotColor = getShipColor(s.type);
              const shipFlag = flag(s.flag);
              const country = cname(s.flag);

              return (
                <button
                  key={s.mmsi}
                  className={`row ${isSelected ? 'sel' : ''}`}
                  onClick={() => onSelectShip(s.mmsi)}
                  data-m={s.mmsi}
                  type="button"
                >
                  <i className="dot" style={{ background: dotColor }} />
                  <span className="nm">{s.name}</span>
                  <span className="rt">{where(s, ports)}</span>
                  <span className="sub">
                    <span>{s.type === 'tanker' ? 'Tanker' : 'Cargo ship'}</span>
                    {s.flag && (
                      <span>
                        {shipFlag} {country}
                      </span>
                    )}
                    {s.len ? <span>{s.len} m</span> : null}
                  </span>
                  <span className="ag">{ago(s.ts)}</span>
                  {s.dest && <span className="dst">to {s.dest}</span>}
                </button>
              );
            })
          : renderEmpty()}
      </div>

      <p className="fine">
        Positions come from coastal AIS receivers. Ships with AIS switched off do
        not appear, and positions near the strait can be jammed or spoofed.
        Destination, ETA and draught are typed in by the crew. For awareness only,
        not navigation.
      </p>
    </section>
  );
};
