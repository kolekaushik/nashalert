import { useEffect, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { fetchHeatmapBounds } from '../services/api';
import type { MapBounds } from '../App';

const NASHVILLE_CENTER: [number, number] = [-86.7816, 36.1627];
const INITIAL_ZOOM = 11;

// Full Nashville bounding box — used for the one-time city-wide data load.
// Covers all of Davidson County where scored cache points exist.
// Fetched once on mount; never re-fetched on pan or zoom.
const NASHVILLE_FULL_BOUNDS = {
  swLat: 35.97,
  swLng: -87.05,
  neLat: 36.40,
  neLng: -86.50,
} as const;

// Nashville boundary reference frame outline coordinates
const NASHVILLE_BBOX_LINE = [
  [-87.05, 35.97],
  [-86.50, 35.97],
  [-86.50, 36.40],
  [-87.05, 36.40],
  [-87.05, 35.97],
];

interface NashvilleMapProps {
  bounds: MapBounds;
  selectedLocation: { lat: number; lng: number } | null;
  onBoundsChange: (bounds: MapBounds) => void;
  onSelectLocation: (lat: number, lng: number) => void;
}

export default function NashvilleMap({
  bounds: _bounds,
  selectedLocation,
  onBoundsChange,
  onSelectLocation,
}: NashvilleMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const popupRef = useRef<mapboxgl.Popup | null>(null);
  const selectedMarkerRef = useRef<mapboxgl.Marker | null>(null);

  // True once the full-city GeoJSON has been loaded into the map source.
  const [dataLoaded, setDataLoaded] = useState(false);

  useEffect(() => {
    if (!containerRef.current) return;

    mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN ?? '';

    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: 'mapbox://styles/mapbox/dark-v11',
      center: NASHVILLE_CENTER,
      zoom: INITIAL_ZOOM,
    });

    mapRef.current = map;
    map.addControl(new mapboxgl.NavigationControl(), 'top-left');

    map.on('load', () => {
      // Nashville county boundary reference frame
      map.addSource('nashville-boundary', {
        type: 'geojson',
        data: {
          type: 'Feature',
          geometry: { type: 'LineString', coordinates: NASHVILLE_BBOX_LINE },
          properties: {},
        },
      });
      map.addLayer({
        id: 'nashville-boundary-line',
        type: 'line',
        source: 'nashville-boundary',
        paint: {
          'line-color': '#2a2d3a',
          'line-width': 1.5,
          'line-dasharray': [4, 4],
        },
      });

      // Empty GeoJSON source — populated once by the full-city fetch below
      map.addSource('nashalert-scores', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });

      // Heatmap layer — primary visualization, visible at all zoom levels.
      // Because the source contains the full city dataset (not just the viewport),
      // the heatmap is stable and complete regardless of pan or zoom position.
      map.addLayer({
        id: 'nashalert-heatmap',
        type: 'heatmap',
        source: 'nashalert-scores',
        maxzoom: 17,
        paint: {
          'heatmap-weight': [
            'interpolate', ['exponential', 2], ['get', 'recurrence_score'],
            0,    0,
            0.30, 0.1,
            0.50, 0.3,
            0.60, 0.7,
            0.70, 1.0,
          ],
          'heatmap-intensity': [
            'interpolate', ['linear'], ['zoom'],
            9,  0.4,
            11, 0.8,
            13, 1.5,
          ],
          // Color ramp: green (low) → yellow (medium) → orange (high)
          'heatmap-color': [
            'interpolate', ['linear'], ['heatmap-density'],
            0,   'rgba(34,197,94,0)',
            0.2, 'rgba(34,197,94,0.6)',
            0.4, 'rgba(234,179,8,0.7)',
            0.6, 'rgba(249,115,22,0.8)',
            0.8, 'rgba(249,115,22,0.9)',
            1,   'rgba(249,115,22,1)',
          ],
          'heatmap-radius': [
            'interpolate', ['linear'], ['zoom'],
            9,  10,
            11, 20,
            13, 35,
            15, 50,
          ],
          'heatmap-opacity': 0.85,
        },
      });

      // Circle layer — visible at zoom ≥ 13 for precise point selection.
      // Shares the same full-city source as the heatmap, so all scored points
      // are available for hover and click regardless of the current viewport.
      map.addLayer({
        id: 'nashalert-points',
        type: 'circle',
        source: 'nashalert-scores',
        minzoom: 13,
        paint: {
          'circle-radius': [
            'interpolate', ['linear'], ['zoom'],
            13, 5,
            16, 10,
          ],
          'circle-color': [
            'interpolate', ['linear'], ['get', 'recurrence_score'],
            0,   '#22c55e',
            0.4, '#eab308',
            0.7, '#f97316',
            1,   '#f97316',
          ],
          'circle-opacity': 0.9,
          'circle-stroke-color': '#0f1117',
          'circle-stroke-width': 1,
        },
      });

      // One-time full-city data load. Fetching the complete Nashville bounding
      // box (35.97–36.40 lat, -87.05–-86.50 lng) returns all ~30,979 scored
      // cache points in a single request. This is small enough (~3–5 MB as
      // GeoJSON) to hold in memory for the entire session. No subsequent
      // fetches are triggered by pan or zoom events.
      fetchHeatmapBounds(
        NASHVILLE_FULL_BOUNDS.swLat,
        NASHVILLE_FULL_BOUNDS.swLng,
        NASHVILLE_FULL_BOUNDS.neLat,
        NASHVILLE_FULL_BOUNDS.neLng,
      ).then(({ data: points }) => {
        if (!points) return;

        const geojson: GeoJSON.FeatureCollection = {
          type: 'FeatureCollection',
          features: points.map((p) => ({
            type: 'Feature' as const,
            geometry: { type: 'Point' as const, coordinates: [p.lng, p.lat] },
            properties: {
              recurrence_score: p.recurrence_score,
              complaint_count: p.complaint_count,
              dominant_request_type: p.dominant_request_type,
            },
          })),
        };

        const source = map.getSource('nashalert-scores') as mapboxgl.GeoJSONSource | undefined;
        if (source) {
          source.setData(geojson);
          setDataLoaded(true);
        }
      });

      // Hover popup on the circle layer (zoom ≥ 13)
      map.on('mouseenter', 'nashalert-points', (e) => {
        map.getCanvas().style.cursor = 'pointer';
        const feature = e.features?.[0];
        if (!feature || feature.geometry.type !== 'Point') return;

        const coords = feature.geometry.coordinates as [number, number];
        const props = feature.properties ?? {};

        popupRef.current?.remove();
        popupRef.current = new mapboxgl.Popup({
          closeButton: false,
          closeOnClick: false,
          offset: 8,
        })
          .setLngLat(coords)
          .setHTML(`
            <div style="
              background:#1a1d27;border:1px solid #2a2d3a;border-radius:4px;
              padding:8px 10px;font-family:'JetBrains Mono',monospace;
              font-size:11px;color:#f1f5f9;min-width:140px;
            ">
              <div style="font-size:16px;color:#f97316;font-weight:600;margin-bottom:4px;">
                ${Number(props.recurrence_score).toFixed(3)}
              </div>
              <div style="color:#94a3b8;margin-bottom:2px;">
                ${Number(props.complaint_count).toLocaleString()} complaints
              </div>
              <div style="color:#94a3b8;font-size:10px;">
                ${props.dominant_request_type ?? ''}
              </div>
            </div>
          `)
          .addTo(map);
      });

      map.on('mouseleave', 'nashalert-points', () => {
        map.getCanvas().style.cursor = '';
        popupRef.current?.remove();
      });

      // Clicking a circle point selects that location
      map.on('click', 'nashalert-points', (e) => {
        const feature = e.features?.[0];
        if (!feature || feature.geometry.type !== 'Point') return;
        const [lng, lat] = feature.geometry.coordinates as [number, number];
        onSelectLocation(lat, lng);
      });

      // Clicking the heatmap (below zoom 13) selects the clicked coordinate
      map.on('click', 'nashalert-heatmap', (e) => {
        onSelectLocation(e.lngLat.lat, e.lngLat.lng);
      });
    });

    // moveend updates mapBounds state in App.tsx (used by LocationDetail for
    // context), but no longer triggers any heatmap data fetch.
    map.on('moveend', () => {
      const b = map.getBounds();
      if (!b) return;
      onBoundsChange({
        swLat: b.getSouth(),
        swLng: b.getWest(),
        neLat: b.getNorth(),
        neLng: b.getEast(),
      });
    });

    return () => {
      popupRef.current?.remove();
      selectedMarkerRef.current?.remove();
      map.remove();
      mapRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fly to selected location when it changes (triggered by queue row click)
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !selectedLocation) return;

    selectedMarkerRef.current?.remove();

    map.flyTo({
      center: [selectedLocation.lng, selectedLocation.lat],
      zoom: Math.max(map.getZoom(), 14),
      speed: 1.4,
      curve: 1,
    });

    const el = document.createElement('div');
    el.style.cssText = `
      width:14px;height:14px;border-radius:50%;background:#f97316;
      border:2px solid #fff;box-shadow:0 0 0 4px rgba(249,115,22,0.3);
    `;
    selectedMarkerRef.current = new mapboxgl.Marker({ element: el })
      .setLngLat([selectedLocation.lng, selectedLocation.lat])
      .addTo(map);
  }, [selectedLocation]);

  function resetView() {
    mapRef.current?.flyTo({ center: NASHVILLE_CENTER, zoom: INITIAL_ZOOM, speed: 1.2 });
  }

  return (
    <div className="relative w-full h-full">
      <div ref={containerRef} className="w-full h-full" />

      {/* Loading indicator — visible until the one-time full-city fetch completes */}
      {!dataLoaded && (
        <div
          className="absolute bottom-20 left-1/2 -translate-x-1/2 z-20 px-3 py-1.5 rounded-full text-xs flex items-center gap-2"
          style={{
            backgroundColor: 'rgba(26,29,39,0.92)',
            border: '1px solid #2a2d3a',
            backdropFilter: 'blur(4px)',
            color: '#94a3b8',
            fontFamily: 'var(--font-mono)',
            whiteSpace: 'nowrap',
          }}
        >
          <span
            className="inline-block w-1.5 h-1.5 rounded-full animate-pulse"
            style={{ backgroundColor: '#f97316' }}
          />
          Loading Nashville data…
        </div>
      )}

      {/* Reset view button */}
      <button
        onClick={resetView}
        className="absolute bottom-8 left-3 px-3 py-1.5 rounded text-xs font-medium z-10"
        style={{
          backgroundColor: 'rgba(26,29,39,0.9)',
          border: '1px solid #2a2d3a',
          color: '#f1f5f9',
          cursor: 'pointer',
          backdropFilter: 'blur(4px)',
        }}
      >
        Reset view
      </button>

      {/* Color legend */}
      <div
        className="absolute bottom-8 right-3 px-3 py-2 rounded z-10"
        style={{
          backgroundColor: 'rgba(26,29,39,0.9)',
          border: '1px solid #2a2d3a',
          backdropFilter: 'blur(4px)',
          minWidth: '110px',
        }}
      >
        <div className="text-xs mb-1.5 font-medium" style={{ color: '#94a3b8' }}>
          Recurrence Score
        </div>
        <div
          className="h-2 w-full rounded-full mb-1"
          style={{ background: 'linear-gradient(to right, #22c55e, #eab308, #f97316)' }}
        />
        <div className="flex justify-between">
          <span className="text-xs" style={{ fontFamily: 'var(--font-mono)', color: '#22c55e' }}>Low</span>
          <span className="text-xs" style={{ fontFamily: 'var(--font-mono)', color: '#f97316' }}>High</span>
        </div>
      </div>
    </div>
  );
}
