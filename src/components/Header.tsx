import React from 'react';
import { FilterType, ShipMeta } from '../types';
import { ago } from '../utils/formatters';

interface HeaderProps {
  query: string;
  onQueryChange: (q: string) => void;
  filter: FilterType;
  onFilterChange: (f: FilterType) => void;
  meta: ShipMeta;
  loading: boolean;
  onRefresh?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  query,
  onQueryChange,
  filter,
  onFilterChange,
  meta,
  loading,
  onRefresh,
}) => {
  const updatedTs = meta.updated ? Date.parse(meta.updated) : 0;
  const ageMin = updatedTs ? (Date.now() - updatedTs) / 6e4 : 0;
  const statClass = !updatedTs
    ? ''
    : ageMin <= 45
    ? 'ok'
    : ageMin <= 180
    ? 'warn'
    : 'bad';

  const statText = loading
    ? 'Loading'
    : updatedTs
    ? 'Updated ' + ago(updatedTs).replace(' ago', '')
    : 'No data';

  const filters: { key: FilterType; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'cargo', label: 'Cargo' },
    { key: 'tanker', label: 'Tanker' },
    { key: 'moving', label: 'Moving' },
    { key: 'port', label: 'In port' },
  ];

  return (
    <header className="top-bar">
      <div className="brand">
        <div className="brand-left">
          <span className="logo">MarineEdge</span>
          {onRefresh && (
            <button
              onClick={onRefresh}
              className="refresh-btn"
              title="Refresh ship data"
              disabled={loading}
            >
              {loading ? '...' : '↻'}
            </button>
          )}
        </div>
        <span className={`stat ${statClass}`} id="stat">
          <i />
          <b>{statText}</b>
        </span>
      </div>

      <label className="search">
        <input
          id="q"
          type="search"
          placeholder="Search name, IMO, MMSI…"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          autoComplete="off"
          autoCapitalize="off"
          enterKeyHint="search"
          aria-label="Search ships"
        />
      </label>

      <div className="chips" id="chips">
        {filters.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            className={`chip ${filter === key ? 'on' : ''}`}
            onClick={() => onFilterChange(key)}
            data-f={key}
          >
            {label}
          </button>
        ))}
      </div>
    </header>
  );
};
