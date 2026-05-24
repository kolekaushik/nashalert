import type { DashboardStats } from '../types';

interface StatsBarProps {
  stats: DashboardStats | null;
  loading: boolean;
}

function SkeletonCard() {
  return (
    <div
      className="p-3 rounded"
      style={{ backgroundColor: 'var(--color-bg)', border: '1px solid var(--color-border)' }}
    >
      <div
        className="h-6 w-24 rounded mb-2 animate-pulse"
        style={{ backgroundColor: 'var(--color-border)' }}
      />
      <div
        className="h-3 w-32 rounded animate-pulse"
        style={{ backgroundColor: 'var(--color-border)' }}
      />
    </div>
  );
}

function StatCard({ value, label }: { value: string; label: string }) {
  return (
    <div
      className="p-3 rounded"
      style={{ backgroundColor: 'var(--color-bg)', border: '1px solid var(--color-border)' }}
    >
      <div
        className="text-xl font-semibold leading-none"
        style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-text-primary)' }}
      >
        {value}
      </div>
      <div className="text-xs mt-1.5" style={{ color: 'var(--color-text-muted)' }}>
        {label}
      </div>
    </div>
  );
}

function deriveYearRange(stats: DashboardStats): string {
  const min = stats.date_range?.min;
  const max = stats.date_range?.max;
  if (!min || !max) return '—';
  return `${new Date(min).getFullYear()} – ${new Date(max).getFullYear()}`;
}

function getTopDistrict(stats: DashboardStats): string {
  const districts = Object.entries(stats.by_council_district ?? {});
  if (districts.length === 0) return '—';
  const top = districts.sort(([, a], [, b]) => b - a)[0];
  return `District ${top[0]}`;
}

export default function StatsBar({ stats, loading }: StatsBarProps) {
  return (
    <div className="px-4 py-3" style={{ borderBottom: '1px solid var(--color-border)' }}>
      <div className="grid grid-cols-2 gap-2">
        {loading ? (
          <>
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
          </>
        ) : stats ? (
          <>
            <StatCard
              value={stats.total_complaints.toLocaleString('en-US')}
              label="complaints on record"
            />
            <StatCard
              value={deriveYearRange(stats)}
              label="dataset date range"
            />
            <StatCard
              value={Object.values(stats.by_request_type ?? {})
                .reduce((a, b) => a + b, 0)
                .toLocaleString('en-US')}
              label="infrastructure complaints"
            />
            <StatCard
              value={getTopDistrict(stats)}
              label="highest complaint volume"
            />
          </>
        ) : (
          <div
            className="col-span-2 text-xs py-2"
            style={{ color: 'var(--color-text-muted)' }}
          >
            Could not load statistics — check backend connection.
          </div>
        )}
      </div>
    </div>
  );
}
