import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { BottomNav } from './components/BottomNav';
import { Header } from './components/Header';
import { MapView } from './components/MapView';
import { ShipList } from './components/ShipList';
import { ShipSheet } from './components/ShipSheet';
import { FilterType, Port, Ship, ShipData, ViewTab } from './types';
import { cname } from './utils/formatters';
import fallbackData from '../data/ships.json';

export const App: React.FC = () => {
  const [data, setData] = useState<ShipData>(fallbackData as unknown as ShipData);
  const [loading, setLoading] = useState<boolean>(false);
  const [query, setQuery] = useState<string>('');
  const [filter, setFilter] = useState<FilterType>('all');
  const [selectedMmsi, setSelectedMmsi] = useState<string | null>(null);
  const [currentTab, setCurrentTab] = useState<ViewTab>('map');

  const portsMap = useMemo<Record<string, Port>>(() => {
    return Object.fromEntries((data.meta.ports || []).map((p) => [p.id, p]));
  }, [data.meta.ports]);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      let res: Response | null = null;
      try {
        res = await fetch(`data/ships.json?${Date.now()}`);
      } catch {
        res = await fetch(`/data/ships.json?${Date.now()}`);
      }

      if (res && res.ok) {
        const json: ShipData = await res.json();
        setData(json);
      }
    } catch (err: any) {
      console.warn('Network refresh note:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();

    const interval = setInterval(loadData, 300000); // 5 minutes
    const handleVisibility = () => {
      if (!document.hidden) loadData();
    };

    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [loadData]);

  // Sync header height CSS variable (--hh)
  useEffect(() => {
    const updateHh = () => {
      const topBar = document.querySelector('.top-bar') as HTMLElement | null;
      if (topBar) {
        document.documentElement.style.setProperty('--hh', `${topBar.offsetHeight}px`);
      }
    };

    updateHh();
    window.addEventListener('resize', updateHh);
    document.fonts?.ready?.then(updateHh);
    return () => {
      window.removeEventListener('resize', updateHh);
    };
  }, [filter, query]);

  // Filter and search logic
  const filteredShips = useMemo(() => {
    const q = query.trim().toLowerCase();

    return data.ships.filter((s) => {
      // Type filter
      if (filter === 'cargo' && s.type !== 'cargo') return false;
      if (filter === 'tanker' && s.type !== 'tanker') return false;
      if (filter === 'moving' && (s.sog || 0) < 1) return false;
      if (filter === 'port' && !s.port) return false;

      // Search query
      if (q) {
        const hay = [
          s.name,
          s.mmsi,
          s.imo,
          s.dest,
          s.flag,
          cname(s.flag),
          s.type,
          s.port ? portsMap[s.port]?.name : '',
          s.last ? portsMap[s.last]?.name : '',
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();

        if (!hay.includes(q)) return false;
      }

      return true;
    });
  }, [data.ships, filter, query, portsMap]);

  const selectedShip = useMemo(() => {
    if (!selectedMmsi) return null;
    return data.ships.find((s) => s.mmsi === selectedMmsi) || null;
  }, [data.ships, selectedMmsi]);

  const handleSelectShip = (mmsi: string) => {
    setSelectedMmsi(mmsi);
    // On mobile, show the map view so user sees the sheet and marker
    setCurrentTab('map');
  };

  const handleClearSelection = () => {
    setSelectedMmsi(null);
  };

  const handleQueryChange = (val: string) => {
    setQuery(val);
    if (val.trim()) {
      setCurrentTab('list');
    }
  };

  return (
    <div className="marine-edge-app">
      <MapView
        ships={filteredShips}
        allShips={data.ships}
        selectedShip={selectedShip}
        ports={data.meta.ports || []}
        onSelectShip={handleSelectShip}
        onClearSelection={handleClearSelection}
      />

      <Header
        query={query}
        onQueryChange={handleQueryChange}
        filter={filter}
        onFilterChange={setFilter}
        meta={data.meta}
        loading={loading}
        onRefresh={loadData}
      />

      <ShipList
        ships={filteredShips}
        totalShipsCount={data.ships.length}
        selectedMmsi={selectedMmsi}
        onSelectShip={handleSelectShip}
        ports={portsMap}
        meta={data.meta}
        visible={currentTab === 'list'}
      />

      <ShipSheet
        ship={selectedShip}
        ports={portsMap}
        onClose={handleClearSelection}
      />

      <BottomNav
        currentTab={currentTab}
        onTabChange={setCurrentTab}
        shipCount={data.ships.length}
      />
    </div>
  );
};

export default App;
