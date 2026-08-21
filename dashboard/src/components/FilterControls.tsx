import type { DashboardStats } from '../types';
import type { Filters } from '../App';
import { formatRequestType } from '../types';

const INFRASTRUCTURE_TYPES = [
  'Streets, Roads & Sidewalks',
  'Electric & Water General',
  'Public Works WO',
  'Pothole',
  'Street Lighting',
  'Power Lines Down or Low',
  'Blocked Drain',
  'Flooding',
  'Traffic Light Issue',
  'Remove debris in roadway',
  'Ditch Maintenance',
  'Clogged Culvert & Cross Drains',
  'Repair Storm Drain',
  'Snow and Ice Removal',
  'Sidewalks',
  'Sinkhole',
];

interface FilterControlsProps {
  filters: Filters;
  stats: DashboardStats | null;
  onChange: (partial: Partial<Filters>) => void;
}

const selectStyle: React.CSSProperties = {
  backgroundColor: 'var(--color-bg)',
  border: '1px solid var(--color-border)',
  borderRadius: '4px',
  color: 'var(--color-text-primary)',
  fontSize: '12px',
  padding: '5px 8px',
  width: '100%',
  cursor: 'pointer',
  outline: 'none',
};

export default function FilterControls({ filters, stats, onChange }: FilterControlsProps) {
  // Sort districts by complaint count (desc) once stats load; show numbered
  // options even before stats arrive so the control is always interactive.
  const sortedDistricts = stats
    ? Object.entries(stats.by_council_district ?? {})
        .filter(([d]) => d && d !== 'null' && d !== 'unknown')
        .sort(([, a], [, b]) => b - a)
    : [];

  const sortedTypes = stats
    ? INFRASTRUCTURE_TYPES.slice().sort((a, b) => {
        const ca = stats.by_request_type?.[a] ?? 0;
        const cb = stats.by_request_type?.[b] ?? 0;
        return cb - ca;
      })
    : INFRASTRUCTURE_TYPES;

  return (
    <div className="px-4 py-3" style={{ borderBottom: '1px solid var(--color-border)' }}>
      <div className="flex items-end gap-3">
        {/* Council District */}
        <div className="flex-1 min-w-0">
          <label className="block text-xs mb-1 font-medium" style={{ color: 'var(--color-text-muted)' }}>
            Council District
          </label>
          <select
            style={selectStyle}
            value={filters.district}
            onChange={(e) => onChange({ district: e.target.value })}
          >
            <option value="">All Districts</option>
            {sortedDistricts.map(([district, count]) => (
              <option key={district} value={district}>
                District {district} ({count.toLocaleString()})
              </option>
            ))}
          </select>
        </div>

        {/* Score Threshold */}
        <div className="flex-1 min-w-0">
          <label className="block text-xs mb-1 font-medium" style={{ color: 'var(--color-text-muted)' }}>
            Min. Score{' '}
            <span
              className="ml-1 px-1.5 py-0.5 rounded text-xs"
              style={{
                backgroundColor: 'var(--color-surface)',
                border: '1px solid var(--color-border)',
                color: 'var(--color-primary)',
                fontFamily: 'var(--font-mono)',
              }}
            >
              ≥ {filters.minScore.toFixed(2)}
            </span>
          </label>
          <input
            type="range"
            min={0}
            // Max and step are calibrated to the current formula's real score
            // range (recurrence_cache citywide max ≈ 0.54 as of the Phase 2.7
            // weight revision — see METHODOLOGY.md Section 4.8). A max of 0.9
            // left most of the slider as dead space where every location was
            // filtered out; 0.6 keeps a small margin above the observed max
            // without wasting most of the control's range.
            max={0.6}
            step={0.02}
            value={filters.minScore}
            onChange={(e) => onChange({ minScore: parseFloat(e.target.value) })}
            className="w-full h-1.5 rounded appearance-none cursor-pointer"
            style={{ backgroundColor: 'var(--color-border)', accentColor: 'var(--color-primary)' }}
          />
        </div>

        {/* Complaint Type */}
        <div className="flex-1 min-w-0">
          <label className="block text-xs mb-1 font-medium" style={{ color: 'var(--color-text-muted)' }}>
            Complaint Type
          </label>
          <select
            style={selectStyle}
            value={filters.requestType}
            onChange={(e) => onChange({ requestType: e.target.value })}
          >
            <option value="">All Types</option>
            {sortedTypes.map((type) => (
              <option key={type} value={type}>
                {formatRequestType(type)}
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
}
