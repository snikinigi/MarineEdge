import React from 'react';
import { ViewTab } from '../types';

interface BottomNavProps {
  currentTab: ViewTab;
  onTabChange: (tab: ViewTab) => void;
  shipCount: number;
}

export const BottomNav: React.FC<BottomNavProps> = ({
  currentTab,
  onTabChange,
  shipCount,
}) => {
  return (
    <nav className="bottom-nav">
      <button
        type="button"
        className={currentTab === 'map' ? 'on' : ''}
        onClick={() => onTabChange('map')}
      >
        Map
      </button>
      <button
        type="button"
        className={currentTab === 'list' ? 'on' : ''}
        onClick={() => onTabChange('list')}
      >
        Ships
        <small id="count">{shipCount}</small>
      </button>
    </nav>
  );
};
