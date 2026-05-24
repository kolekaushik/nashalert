import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Cell,
  ResponsiveContainer,
} from 'recharts';
import type { DashboardStats } from '../types';

interface EquityPanelProps {
  stats: DashboardStats | null;
  loading: boolean;
}

interface DistrictBar {
  name: string;
  count: number;
  aboveAverage: boolean;
}

function buildDistrictBars(stats: DashboardStats): DistrictBar[] {
  const entries = Object.entries(stats.by_council_district ?? {})
    .filter(([d]) => d && d !== 'null' && d !== 'unknown')
    .map(([district, count]) => ({ district, count: Number(count) }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  if (entries.length === 0) return [];

  const avg = entries.reduce((s, e) => s + e.count, 0) / entries.length;
  return entries.map((e) => ({
    name: `D${e.district}`,
    count: e.count,
    aboveAverage: e.count > avg,
  }));
}

function buildInsightLine(bars: DistrictBar[], stats: DashboardStats): string {
  if (bars.length === 0) return '';
  const top = bars[0];
  const allCounts = Object.values(stats.by_council_district ?? {})
    .filter(Boolean)
    .map(Number);
  const cityAvg = allCounts.reduce((a, b) => a + b, 0) / (allCounts.length || 1);
  const multiple = (top.count / cityAvg).toFixed(1);
  const districtNum = top.name.replace('D', '');
  return `District ${districtNum} has the highest complaint volume with ${top.count.toLocaleString()} reports — ${multiple}x the city average.`;
}

const TICK_STYLE = { fontSize: 10, fill: '#94a3b8', fontFamily: '"JetBrains Mono", monospace' };

export default function EquityPanel({ stats, loading }: EquityPanelProps) {
  const bars = stats ? buildDistrictBars(stats) : [];
  const insightLine = stats ? buildInsightLine(bars, stats) : '';

  return (
    <div
      className="mx-4 mt-0 mb-6 rounded"
      style={{ backgroundColor: 'var(--color-bg)', border: '1px solid var(--color-border)' }}
    >
      <div className="px-4 pt-4 pb-1">
        <h2 className="text-sm font-semibold mb-0.5" style={{ color: 'var(--color-text-primary)' }}>
          Equity Analysis
        </h2>
        <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
          Infrastructure stress vs. report volume by council district
        </p>
      </div>

      <div className="px-4 py-3">
        {loading ? (
          <div
            className="h-32 w-full rounded animate-pulse"
            style={{ backgroundColor: 'var(--color-border)' }}
          />
        ) : bars.length === 0 ? (
          <div className="text-xs py-4 text-center" style={{ color: 'var(--color-text-muted)' }}>
            Could not load district data.
          </div>
        ) : (
          <>
            <ResponsiveContainer width="100%" height={140}>
              <BarChart data={bars} margin={{ top: 0, right: 0, bottom: 0, left: -10 }}>
                <XAxis dataKey="name" tick={TICK_STYLE} axisLine={false} tickLine={false} />
                <YAxis tick={TICK_STYLE} axisLine={false} tickLine={false} width={40} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'var(--color-surface)',
                    border: '1px solid var(--color-border)',
                    borderRadius: '4px',
                    fontSize: '11px',
                    color: 'var(--color-text-primary)',
                  }}
                  formatter={(value) => [Number(value).toLocaleString(), 'complaints']}
                />
                <Bar dataKey="count" radius={[2, 2, 0, 0]}>
                  {bars.map((entry, i) => (
                    <Cell
                      key={`cell-${i}`}
                      fill={entry.aboveAverage ? 'var(--color-primary)' : '#94a3b8'}
                      fillOpacity={0.85}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>

            {insightLine && (
              <p className="text-xs mt-2 leading-snug" style={{ color: 'var(--color-text-primary)' }}>
                {insightLine}
              </p>
            )}

            <p
              className="text-xs mt-3 leading-snug"
              style={{ color: 'var(--color-text-muted)', fontStyle: 'italic' }}
            >
              Full equity analysis including income data is in progress. See RESEARCH_FINDINGS.md.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
