import React, { useEffect, useRef, useState } from 'react';
import maplibregl, { GeoJSONSource, LngLatBounds, Map as MapLibreMap, Marker } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { Port, Ship } from '../types';

interface MapViewProps {
  ships: Ship[];
  allShips: Ship[];
  selectedShip: Ship | null;
  ports: Port[];
  onSelectShip: (mmsi: string) => void;
  onClearSelection: () => void;
}

export const MapView: React.FC<MapViewProps> = ({
  ships,
  allShips,
  selectedShip,
  ports,
  onSelectShip,
  onClearSelection,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const readyRef = useRef(false);
  const portsDrawnRef = useRef(false);
  const fittedRef = useRef(false);
  const markersRef = useRef<Marker[]>([]);
  const [mapError, setMapError] = useState<string | null>(null);

  // Convert ships to GeoJSON feature collection
  const getShipsGeoJSON = (shipList: Ship[]): GeoJSON.FeatureCollection => ({
    type: 'FeatureCollection',
    features: shipList.map((s) => ({
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [s.lon, s.lat],
      },
      properties: {
        m: s.mmsi,
        t: s.type,
        sp: s.sog || 0,
        c: s.cog ?? s.hdg ?? 0,
      },
    })),
  });

  const getPad = () => {
    const isDesktop = window.matchMedia('(min-width: 900px)').matches;
    if (isDesktop) {
      return { top: 40, bottom: 40, left: 40, right: 40 };
    }
    const topBar = document.querySelector('.top-bar') as HTMLElement | null;
    const nav = document.querySelector('.bottom-nav') as HTMLElement | null;
    const topOffset = (topBar?.offsetHeight || 160) + 30;
    const botOffset = (nav?.offsetHeight || 56) + 40;
    return { top: topOffset, bottom: botOffset, left: 30, right: 30 };
  };

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    if (typeof (maplibregl as any).supported === 'function' && !(maplibregl as any).supported()) {
      setMapError('WebGL is not supported in this browser environment.');
      return;
    }

    const dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const cx = document.createElement('canvas').getContext('2d');

    const tint = (v: any): any => {
      if (Array.isArray(v)) return v.map(tint);
      if (typeof v !== 'string' || !/^(#[0-9a-f]{3,8}|(rgb|hsl)a?\()/i.test(v)) return v;
      if (!cx) return v;
      cx.fillStyle = '#000';
      cx.fillStyle = v;
      const c = cx.fillStyle;
      let r = 0, g = 0, b = 0, a = 1;
      if (c[0] === '#') {
        [r, g, b] = [1, 3, 5].map((i) => parseInt(c.substring(i, i + 2), 16));
      } else {
        const matches = c.match(/[\d.]+/g);
        if (matches) [r, g, b, a = 1] = matches.map(Number);
      }
      r /= 255;
      g /= 255;
      b /= 255;
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
      let h = 0, s = 0;
      if (d) {
        s = d / (1 - Math.abs(2 * l - 1));
        h = 60 * (mx === r ? ((g - b) / d + 6) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4);
      }
      return `hsla(${Math.round(h)},${Math.round(s * 60)}%,${Math.round((0.08 + (1 - l) * 0.8) * 100)}%,${a})`;
    };

    const night = (m: MapLibreMap) => {
      try {
        const style = m.getStyle();
        if (!style || !style.layers) return;
        for (const layer of style.layers) {
          const paint = (layer as any).paint || {};
          for (const k in paint) {
            if (/color$/.test(k)) {
              m.setPaintProperty(layer.id, k, tint(paint[k]));
            }
          }
        }
      } catch (err) {
        console.warn('Map styling error:', err);
      }
    };

    let map: MapLibreMap;
    try {
      map = new maplibregl.Map({
        container: containerRef.current,
        center: [57.2, 25.3],
        zoom: 5.7,
        attributionControl: { compact: true },
        style: 'https://tiles.openfreemap.org/styles/liberty',
      });
    } catch (e: any) {
      console.error('Failed to construct map:', e);
      setMapError('Failed to initialize MapLibre GL map.');
      return;
    }

    mapRef.current = map;

    map.on('error', (e) => {
      console.warn('MapLibre error event:', e);
    });

    map.once('style.load', () => {
      try {
        if (dark) night(map);
      } catch (e) {
        console.warn(e);
      }
    });

    map.on('load', () => {
      const CC = {
        cargo: dark ? '#7b8fff' : '#2338d6',
        tanker: dark ? '#ff5a64' : '#e0202e',
      };
      const tc: any = ['match', ['get', 't'], 'tanker', CC.tanker, CC.cargo];

      // Generate vessel arrow & stationary circle sprites
      for (const t of ['cargo', 'tanker'] as const) {
        for (const a of [1, 0]) {
          const canvas = document.createElement('canvas');
          canvas.width = 52;
          canvas.height = 52;
          const ctx = canvas.getContext('2d');
          if (!ctx) continue;
          ctx.lineWidth = 4;
          ctx.lineJoin = 'round';
          ctx.strokeStyle = dark ? '#000' : '#fff';
          ctx.fillStyle = CC[t];
          ctx.beginPath();
          if (a) {
            ctx.moveTo(26, 3);
            ctx.lineTo(43, 47);
            ctx.lineTo(26, 38);
            ctx.lineTo(9, 47);
          } else {
            ctx.arc(26, 26, 10, 0, Math.PI * 2);
          }
          ctx.closePath();
          ctx.stroke();
          ctx.fill();

          map.addImage(
            (a ? 'a-' : 'd-') + t,
            ctx.getImageData(0, 0, 52, 52),
            { pixelRatio: 2 }
          );
        }
      }

      // Add sources
      map.addSource('ships', {
        type: 'geojson',
        data: getShipsGeoJSON(ships),
      });

      map.addSource('track', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });

      // Add track layer
      map.addLayer({
        id: 'track',
        type: 'line',
        source: 'track',
        layout: {
          'line-cap': 'round',
          'line-join': 'round',
        },
        paint: {
          'line-color': tc,
          'line-width': 2.5,
          'line-opacity': 0.9,
        },
      });

      // Add selection ring
      map.addLayer({
        id: 'sel',
        type: 'circle',
        source: 'ships',
        filter: ['==', ['get', 'm'], ''],
        paint: {
          'circle-radius': 18,
          'circle-color': '#ffd40066',
          'circle-stroke-width': 3,
          'circle-stroke-color': dark ? '#fff' : '#000',
        },
      });

      // Add vessel symbol layer
      map.addLayer({
        id: 'ships',
        type: 'symbol',
        source: 'ships',
        layout: {
          'icon-image': [
            'concat',
            ['case', ['>', ['get', 'sp'], 0.5], 'a-', 'd-'],
            ['get', 't'],
          ],
          'icon-rotate': ['get', 'c'],
          'icon-rotation-alignment': 'map',
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
          'icon-size': [
            'interpolate',
            ['linear'],
            ['zoom'],
            5,
            0.75,
            10,
            1.15,
          ],
        },
      });

      map.on('click', 'ships', (e) => {
        const feature = e.features?.[0];
        if (feature?.properties?.m) {
          onSelectShip(String(feature.properties.m));
        }
      });

      map.on('click', (e) => {
        const features = map.queryRenderedFeatures(e.point, { layers: ['ships'] });
        if (!features.length) {
          onClearSelection();
        }
      });

      map.on('mouseenter', 'ships', () => {
        map.getCanvas().style.cursor = 'pointer';
      });

      map.on('mouseleave', 'ships', () => {
        map.getCanvas().style.cursor = '';
      });

      const handleZoom = () => {
        if (containerRef.current) {
          containerRef.current.classList.toggle('far', map.getZoom() < 7);
        }
      };

      map.on('zoom', handleZoom);
      handleZoom();

      readyRef.current = true;
    });

    return () => {
      map.remove();
      mapRef.current = null;
      readyRef.current = false;
    };
  }, []);

  // Update ships GeoJSON source when ships array changes
  useEffect(() => {
    if (!readyRef.current || !mapRef.current) return;
    const source = mapRef.current.getSource('ships') as GeoJSONSource | undefined;
    if (source) {
      source.setData(getShipsGeoJSON(ships));
    }
  }, [ships]);

  // Initial fitBounds once all ships are loaded
  useEffect(() => {
    if (!readyRef.current || !mapRef.current || fittedRef.current || !allShips.length) return;
    fittedRef.current = true;
    const b = new LngLatBounds();
    allShips.forEach((s) => b.extend([s.lon, s.lat]));
    mapRef.current.fitBounds(b, {
      padding: getPad(),
      maxZoom: 8.5,
      duration: 0,
    });
  }, [allShips]);

  // Draw port markers
  useEffect(() => {
    if (!readyRef.current || !mapRef.current || portsDrawnRef.current || !ports.length) return;
    portsDrawnRef.current = true;
    const map = mapRef.current;

    // Clear any previous markers
    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];

    ports.forEach((p) => {
      const el = document.createElement('div');
      el.className = 'pt';
      el.innerHTML = `<i></i><span>${p.name}</span>`;
      const marker = new Marker({ element: el, anchor: 'left' })
        .setLngLat([p.lo, p.la])
        .addTo(map);
      markersRef.current.push(marker);
    });
  }, [ports]);

  // Selected ship update (ring, track, flyTo)
  useEffect(() => {
    if (!readyRef.current || !mapRef.current) return;
    const map = mapRef.current;

    if (!selectedShip) {
      map.setFilter('sel', ['==', ['get', 'm'], '']);
      const trackSource = map.getSource('track') as GeoJSONSource | undefined;
      if (trackSource) {
        trackSource.setData({ type: 'FeatureCollection', features: [] });
      }
      return;
    }

    // Set selection filter
    map.setFilter('sel', ['==', ['get', 'm'], selectedShip.mmsi]);

    // Set track line
    const trackSource = map.getSource('track') as GeoJSONSource | undefined;
    if (trackSource) {
      const coordinates = (selectedShip.track || [])
        .map((p) => [p[1], p[0]])
        .concat([[selectedShip.lon, selectedShip.lat]]);

      trackSource.setData({
        type: 'Feature',
        properties: { t: selectedShip.type },
        geometry: {
          type: 'LineString',
          coordinates,
        },
      });
    }

    // Fly to ship
    map.flyTo({
      center: [selectedShip.lon, selectedShip.lat],
      zoom: Math.max(map.getZoom(), 8.5),
      padding: getPad(),
      essential: true,
    });
  }, [selectedShip]);

  return (
    <div id="map-container" ref={containerRef}>
      {mapError && (
        <div style={{ padding: 20, textAlign: 'center', color: '#666' }}>
          {mapError}
        </div>
      )}
    </div>
  );
};
