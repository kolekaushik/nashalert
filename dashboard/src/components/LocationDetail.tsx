import { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { fetchScore, fetchTemporal, fetchNearby } from '../services/api';
import type { ScoringResult, TemporalDataPoint, Complaint } from '../types';
import { getScoreTier, getTierColor, formatRequestType } from '../types';

interface ScoreBarProps {
  label: string;
  value: number;
  color: string;
}

function ScoreBar({ label, value, color }: ScoreBarProps) {
  return (
    <div className="mb-2">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
          {label}
        </span>
        <span
          className="text-xs"
          style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-text-primary)' }}
        >
          {value.toFixed(3)}
        </span>
      </div>
      <div
        className="h-1.5 w-full rounded-full overflow-hidden"
        style={{ backgroundColor: 'var(--color-border)' }}
      >
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${Math.min(value * 100, 100)}%`, backgroundColor: color }}
        />
      </div>
    </div>
  );
}

interface NearbyComplaintRowProps {
  complaint: Complaint;
}

function NearbyComplaintRow({ complaint }: NearbyComplaintRowProps) {
  const isClosed = complaint.status === 'Closed';
  const dateStr = complaint.opened_date
    ? new Date(complaint.opened_date).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })
    : 'Unknown date';

  return (
    <div
      className="flex items-start justify-between py-2"
      style={{ borderBottom: '1px solid var(--color-border)' }}
    >
      <div className="flex-1 min-w-0 pr-2">
        <div className="text-xs font-medium truncate" style={{ color: 'var(--color-text-primary)' }}>
          {formatRequestType(complaint.request_type)}
          {complaint.subtype && complaint.subtype !== '(none)' && (
            <span style={{ color: 'var(--color-text-muted)' }}> · {complaint.subtype}</span>
          )}
        </div>
        <div className="text-xs mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
          {dateStr}
        </div>
      </div>
      <span
        className="flex-none text-xs px-1.5 py-0.5 rounded"
        style={{
          backgroundColor: isClosed ? 'rgba(34,197,94,0.12)' : 'rgba(249,115,22,0.12)',
          color: isClosed ? 'var(--color-safe)' : 'var(--color-primary)',
          border: `1px solid ${isClosed ? 'rgba(34,197,94,0.3)' : 'rgba(249,115,22,0.3)'}`,
        }}
      >
        {complaint.status}
      </span>
    </div>
  );
}

// Shows only the last 24 months of temporal data — a 24-month window gives
// enough context to see seasonal patterns without overwhelming the chart
// with the full 2017–2026 dataset range.
function filterLast24Months(data: TemporalDataPoint[]): TemporalDataPoint[] {
  if (data.length === 0) return [];
  const sorted = [...data].sort((a, b) => a.period.localeCompare(b.period));
  return sorted.slice(-24);
}

function formatMonthLabel(period: string): string {
  const [year, month] = period.split('-');
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return months[parseInt(month, 10) - 1] ?? period;
}

const CHART_TICK_STYLE = {
  fontSize: 10,
  fill: '#94a3b8',
  fontFamily: '"JetBrains Mono", monospace',
};

interface LocationDetailProps {
  lat: number;
  lng: number;
  onClose: () => void;
}

export default function LocationDetail({ lat, lng, onClose }: LocationDetailProps) {
  const [scoring, setScoring] = useState<ScoringResult | null>(null);
  const [historicalContext, setHistoricalContext] = useState<string>('');
  const [temporal, setTemporal] = useState<TemporalDataPoint[]>([]);
  const [nearby, setNearby] = useState<Complaint[]>([]);
  const [showAllNearby, setShowAllNearby] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    setScoring(null);
    setTemporal([]);
    setNearby([]);
    setShowAllNearby(false);

    Promise.all([
      fetchScore(lat, lng),
      fetchTemporal(lat, lng, 'month'),
      fetchNearby(lat, lng, 200),
    ]).then(([scoreRes, temporalRes, nearbyRes]) => {
      if (scoreRes.data) {
        setScoring(scoreRes.data.scoring);
        setHistoricalContext(scoreRes.data.historical_context ?? '');
      }
      if (temporalRes.data) setTemporal(temporalRes.data);
      if (nearbyRes.data) setNearby(nearbyRes.data);
      setLoading(false);
    });
  }, [lat, lng]);

  const tier = scoring ? getScoreTier(scoring.recurrence_score, scoring.complaint_count) : 'low';
  const tierColor = getTierColor(tier);
  const chartData = filterLast24Months(temporal);
  const earliestYear = scoring?.date_range?.earliest
    ? new Date(scoring.date_range.earliest).getFullYear()
    : null;
  const displayNearby = showAllNearby ? nearby : nearby.slice(0, 5);

  return (
    <div
      className="mx-4 mb-4 rounded"
      style={{
        backgroundColor: 'var(--color-bg)',
        border: '1px solid var(--color-border)',
      }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-3"
        style={{ borderBottom: '1px solid var(--color-border)' }}
      >
        <div className="flex items-center gap-2">
          <span
            className="text-xs font-mono"
            style={{ color: 'var(--color-text-muted)' }}
          >
            {lat.toFixed(4)}, {lng.toFixed(4)}
          </span>
        </div>
        <button
          onClick={onClose}
          className="p-1 rounded transition-colors"
          style={{ color: 'var(--color-text-muted)', cursor: 'pointer' }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--color-text-primary)'; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--color-text-muted)'; }}
          aria-label="Close location detail"
        >
          <X size={14} />
        </button>
      </div>

      {loading ? (
        <div className="px-4 py-6">
          <div className="h-8 w-24 rounded animate-pulse mb-3" style={{ backgroundColor: 'var(--color-border)' }} />
          <div className="h-3 w-full rounded animate-pulse mb-2" style={{ backgroundColor: 'var(--color-border)' }} />
          <div className="h-3 w-3/4 rounded animate-pulse" style={{ backgroundColor: 'var(--color-border)' }} />
        </div>
      ) : scoring ? (
        <div className="px-4 py-3">
          {/* Score header */}
          <div className="mb-3">
            <div
              className="text-3xl font-semibold leading-none mb-1"
              style={{ fontFamily: 'var(--font-mono)', color: tierColor }}
            >
              {scoring.recurrence_score.toFixed(3)}
            </div>
            {historicalContext && (
              <p
                className="text-xs italic leading-snug"
                style={{ color: 'var(--color-text-muted)' }}
              >
                {historicalContext}
              </p>
            )}
          </div>

          {/* Component score bars */}
          <div className="mb-4">
            <ScoreBar label="Frequency" value={scoring.components.frequency_score} color="var(--color-primary)" />
            <ScoreBar label="Recency" value={scoring.components.recency_score} color="#60a5fa" />
            <ScoreBar label="Severity" value={scoring.components.severity_score} color="#c084fc" />
            <ScoreBar label="Resolution" value={scoring.components.resolution_score} color="var(--color-safe)" />
          </div>

          {/* Count and pattern */}
          <div className="flex items-center flex-wrap gap-1.5 mb-4">
            <span
              className="text-xs font-mono"
              style={{ color: 'var(--color-text-muted)' }}
            >
              {scoring.complaint_count.toLocaleString()} complaints
              {scoring.seasonal_pattern && scoring.seasonal_pattern !== 'insufficient data' && ` · ${scoring.seasonal_pattern}`}
              {earliestYear && ` · since ${earliestYear}`}
            </span>
          </div>

          {/* Type badges */}
          <div className="flex flex-wrap gap-1.5 mb-4">
            {scoring.dominant_request_type && (
              <span
                className="text-xs px-2 py-0.5 rounded-full"
                style={{
                  backgroundColor: 'var(--color-surface)',
                  border: '1px solid var(--color-border)',
                  color: 'var(--color-text-primary)',
                }}
              >
                {formatRequestType(scoring.dominant_request_type)}
              </span>
            )}
            {scoring.dominant_subtype && scoring.dominant_subtype !== '(none)' && (
              <span
                className="text-xs px-2 py-0.5 rounded-full"
                style={{
                  backgroundColor: 'var(--color-surface)',
                  border: '1px solid var(--color-border)',
                  color: 'var(--color-text-muted)',
                }}
              >
                {scoring.dominant_subtype}
              </span>
            )}
          </div>

          {/* Temporal chart */}
          {chartData.length > 0 && (
            <div className="mb-4">
              <div
                className="text-xs font-medium mb-2"
                style={{ color: 'var(--color-text-muted)' }}
              >
                Complaint Activity (24 months)
              </div>
              <ResponsiveContainer width="100%" height={100}>
                <BarChart data={chartData} margin={{ top: 0, right: 0, bottom: 0, left: -20 }}>
                  <XAxis
                    dataKey="period"
                    tickFormatter={formatMonthLabel}
                    tick={CHART_TICK_STYLE}
                    axisLine={false}
                    tickLine={false}
                    interval={2}
                  />
                  <YAxis tick={CHART_TICK_STYLE} axisLine={false} tickLine={false} width={30} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: 'var(--color-surface)',
                      border: '1px solid var(--color-border)',
                      borderRadius: '4px',
                      fontSize: '11px',
                      color: 'var(--color-text-primary)',
                    }}
                    labelFormatter={(label) => label as string}
                    formatter={(value) => [Number(value), 'complaints']}
                  />
                  <Bar
                    dataKey="count"
                    fill="var(--color-primary)"
                    fillOpacity={0.7}
                    radius={[2, 2, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Nearby complaints */}
          {nearby.length > 0 && (
            <div>
              <div
                className="text-xs font-medium mb-1"
                style={{ color: 'var(--color-text-muted)' }}
              >
                Recent Complaints
              </div>
              {displayNearby.map((c) => (
                <NearbyComplaintRow key={c.id} complaint={c} />
              ))}
              {nearby.length > 5 && !showAllNearby && (
                <button
                  onClick={() => setShowAllNearby(true)}
                  className="text-xs mt-2 w-full text-center py-1.5 rounded transition-colors"
                  style={{
                    color: 'var(--color-primary)',
                    backgroundColor: 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                  }}
                >
                  View all {nearby.length} complaints ↓
                </button>
              )}
              {showAllNearby && nearby.length > 5 && (
                <button
                  onClick={() => setShowAllNearby(false)}
                  className="text-xs mt-2 w-full text-center py-1.5"
                  style={{
                    color: 'var(--color-text-muted)',
                    backgroundColor: 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                  }}
                >
                  Show less ↑
                </button>
              )}
            </div>
          )}
        </div>
      ) : (
        <div
          className="px-4 py-6 text-xs text-center"
          style={{ color: 'var(--color-text-muted)' }}
        >
          No score data available for this location.
        </div>
      )}
    </div>
  );
}
