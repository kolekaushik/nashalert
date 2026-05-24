import { useState, useEffect, useReducer } from 'react';
import './index.css';
import NashvilleMap from './components/NashvilleMap';
import StatsBar from './components/StatsBar';
import FilterControls from './components/FilterControls';
import PriorityQueue from './components/PriorityQueue';
import LocationDetail from './components/LocationDetail';
import ResearchBanner from './components/ResearchBanner';
import EquityPanel from './components/EquityPanel';
import type { DashboardStats } from './types';
import { fetchStats, fetchCacheStatus } from './services/api';

export interface MapBounds {
  swLat: number;
  swLng: number;
  neLat: number;
  neLng: number;
}

export interface Filters {
  district: string;
  minScore: number;
  requestType: string;
}

export type CacheStatus = 'fresh' | 'stale' | 'critical' | 'unknown';

interface AppState {
  selectedLocation: { lat: number; lng: number } | null;
  mapBounds: MapBounds;
  filters: Filters;
  cacheStatus: CacheStatus;
}

type AppAction =
  | { type: 'SET_LOCATION'; payload: { lat: number; lng: number } | null }
  | { type: 'SET_BOUNDS'; payload: MapBounds }
  | { type: 'SET_FILTERS'; payload: Partial<Filters> }
  | { type: 'SET_CACHE_STATUS'; payload: CacheStatus };

function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'SET_LOCATION':
      return { ...state, selectedLocation: action.payload };
    case 'SET_BOUNDS':
      return { ...state, mapBounds: action.payload };
    case 'SET_FILTERS':
      return { ...state, filters: { ...state.filters, ...action.payload } };
    case 'SET_CACHE_STATUS':
      return { ...state, cacheStatus: action.payload };
    default:
      return state;
  }
}

function LiveIndicator({ status }: { status: CacheStatus }) {
  const config = {
    fresh:   { color: 'var(--color-safe)',         label: 'Live',    pulse: true  },
    stale:   { color: 'var(--color-warning)',       label: 'Stale',   pulse: false },
    critical:{ color: 'var(--color-primary)',       label: 'Offline', pulse: false },
    unknown: { color: 'var(--color-text-muted)',    label: 'Unknown', pulse: false },
  }[status];

  return (
    <div className="flex items-center gap-1.5">
      <span
        className={`inline-block w-2 h-2 rounded-full ${config.pulse ? 'animate-pulse' : ''}`}
        style={{ backgroundColor: config.color }}
      />
      <span className="text-xs" style={{ fontFamily: 'var(--font-mono)', color: config.color }}>
        {config.label}
      </span>
    </div>
  );
}

export default function App() {
  const [state, dispatch] = useReducer(appReducer, {
    selectedLocation: null,
    mapBounds: { swLat: 35.9, swLng: -87.1, neLat: 36.4, neLng: -86.5 },
    filters: { district: '', minScore: 0, requestType: '' },
    cacheStatus: 'unknown',
  });

  // Stats are fetched once here and passed down to every component that needs
  // them — StatsBar, FilterControls, EquityPanel — so they don't each issue
  // an independent /api/complaints/stats request on mount, which was causing
  // 15 parallel Supabase RPC calls and cascading statement timeouts.
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);

  useEffect(() => {
    fetchStats().then(({ data }) => {
      if (data) setStats(data);
      setStatsLoading(false);
    });

    fetchCacheStatus().then(({ data }) => {
      if (!data) {
        dispatch({ type: 'SET_CACHE_STATUS', payload: 'unknown' });
        return;
      }
      const s = (data as { status?: string }).status;
      if (s === 'fresh')    dispatch({ type: 'SET_CACHE_STATUS', payload: 'fresh' });
      else if (s === 'stale')   dispatch({ type: 'SET_CACHE_STATUS', payload: 'stale' });
      else if (s === 'critical') dispatch({ type: 'SET_CACHE_STATUS', payload: 'critical' });
      else dispatch({ type: 'SET_CACHE_STATUS', payload: 'unknown' });
    });
  }, []);

  return (
    <>
      <title>NashAlert — Nashville Infrastructure Dashboard</title>
      <meta
        name="description"
        content="A research dashboard applying recurrence-weighted scoring to Nashville 311 open data to surface persistent infrastructure failures and examine equity in complaint-driven maintenance prioritization."
      />
      <div
        className="flex h-screen w-screen overflow-hidden"
        style={{ backgroundColor: 'var(--color-bg)' }}
      >
        {/* Left: Map — 60% width */}
        <div className="flex-none" style={{ width: '60%', height: '100vh' }}>
          <NashvilleMap
            bounds={state.mapBounds}
            selectedLocation={state.selectedLocation}
            onBoundsChange={(b) => dispatch({ type: 'SET_BOUNDS', payload: b })}
            onSelectLocation={(lat, lng) => dispatch({ type: 'SET_LOCATION', payload: { lat, lng } })}
          />
        </div>

        {/* Right: Panel — 40% width, scrollable */}
        <div
          className="flex flex-col overflow-y-auto"
          style={{
            width: '40%',
            height: '100vh',
            backgroundColor: 'var(--color-surface)',
            borderLeft: '1px solid var(--color-border)',
          }}
        >
          {/* Header */}
          <div
            className="flex-none px-5 py-4 flex items-start justify-between"
            style={{ borderBottom: '1px solid var(--color-border)' }}
          >
            <div>
              <h1
                className="text-2xl font-bold leading-none tracking-tight"
                style={{ color: 'var(--color-primary)', fontFamily: 'Inter, sans-serif' }}
              >
                NashAlert
              </h1>
              <p className="text-xs mt-1" style={{ color: 'var(--color-text-muted)' }}>
                Infrastructure Prioritization Dashboard
              </p>
            </div>
            <LiveIndicator status={state.cacheStatus} />
          </div>

          {/* Panel content */}
          <div className="flex-1 flex flex-col">
            <ResearchBanner />

            {/* StatsBar receives stats from App so it doesn't re-fetch */}
            <StatsBar stats={stats} loading={statsLoading} />

            {/* FilterControls always renders — shows empty dropdowns while stats load */}
            <FilterControls
              filters={state.filters}
              stats={stats}
              onChange={(partial) => dispatch({ type: 'SET_FILTERS', payload: partial })}
            />

            <PriorityQueue
              filters={state.filters}
              selectedLocation={state.selectedLocation}
              onSelectLocation={(lat, lng) => dispatch({ type: 'SET_LOCATION', payload: { lat, lng } })}
            />

            {state.selectedLocation && (
              <LocationDetail
                lat={state.selectedLocation.lat}
                lng={state.selectedLocation.lng}
                onClose={() => dispatch({ type: 'SET_LOCATION', payload: null })}
              />
            )}

            {/* EquityPanel receives stats from App so it doesn't re-fetch */}
            <EquityPanel stats={stats} loading={statsLoading} />
          </div>
        </div>
      </div>
    </>
  );
}
