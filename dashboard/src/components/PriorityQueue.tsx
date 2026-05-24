import { useState, useEffect, useCallback } from 'react';
import { fetchPriorityQueue } from '../services/api';
import type { PriorityQueueItem } from '../types';
import { getScoreTier, getTierColor, formatRequestType } from '../types';
import type { Filters } from '../App';

const SEASON_ICONS: Record<string, string> = {
  spring: '🌸',
  summer: '☀️',
  fall: '🍂',
  winter: '❄️',
  'year-round': '📅',
  'insufficient data': '—',
};

function SkeletonCard() {
  return (
    <div
      className="relative flex items-center gap-3 px-4 py-3 rounded"
      style={{
        backgroundColor: 'var(--color-bg)',
        border: '1px solid var(--color-border)',
        marginBottom: '4px',
      }}
    >
      <div className="absolute left-0 top-0 bottom-0 w-1 rounded-l" style={{ backgroundColor: 'var(--color-border)' }} />
      <div className="w-6 h-6 rounded animate-pulse" style={{ backgroundColor: 'var(--color-border)' }} />
      <div className="flex-1">
        <div className="h-5 w-16 rounded animate-pulse mb-1" style={{ backgroundColor: 'var(--color-border)' }} />
        <div className="h-3 w-24 rounded animate-pulse" style={{ backgroundColor: 'var(--color-border)' }} />
      </div>
    </div>
  );
}

interface QueueCardProps {
  item: PriorityQueueItem;
  rank: number;
  isSelected: boolean;
  onClick: () => void;
}

function QueueCard({ item, rank, isSelected, onClick }: QueueCardProps) {
  const tier = getScoreTier(item.recurrence_score, item.complaint_count);
  const tierColor = getTierColor(tier);
  const seasonIcon = SEASON_ICONS[item.seasonal_pattern] ?? '—';

  return (
    <button
      onClick={onClick}
      className="relative w-full text-left flex items-start gap-3 px-4 py-3 rounded transition-colors"
      style={{
        backgroundColor: isSelected ? 'rgba(249,115,22,0.08)' : 'var(--color-bg)',
        border: isSelected
          ? '1px solid var(--color-primary)'
          : '1px solid var(--color-border)',
        marginBottom: '4px',
        cursor: 'pointer',
      }}
    >
      {/* Tier color bar */}
      <div
        className="absolute left-0 top-0 bottom-0 w-1 rounded-l"
        style={{ backgroundColor: tierColor }}
      />

      {/* Rank */}
      <span
        className="flex-none text-xs pt-0.5 w-6 text-right"
        style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-text-muted)' }}
      >
        #{rank}
      </span>

      {/* Score block */}
      <div className="flex-none w-16 text-right">
        <div
          className="text-lg font-semibold leading-none"
          style={{ fontFamily: 'var(--font-mono)', color: tierColor }}
        >
          {item.recurrence_score.toFixed(3)}
        </div>
        <div
          className="text-xs mt-0.5"
          style={{ color: 'var(--color-text-muted)', fontFamily: 'var(--font-mono)' }}
        >
          {item.complaint_count.toLocaleString()}
        </div>
      </div>

      {/* Details */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs"
            style={{
              backgroundColor: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              color: 'var(--color-text-primary)',
            }}
          >
            {formatRequestType(item.dominant_request_type)}
          </span>
          <span className="text-sm" title={item.seasonal_pattern}>
            {seasonIcon}
          </span>
        </div>
        <div
          className="text-xs mt-1.5"
          style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-text-muted)' }}
        >
          {item.lat.toFixed(4)}, {item.lng.toFixed(4)}
        </div>
      </div>
    </button>
  );
}

interface PriorityQueueProps {
  filters: Filters;
  selectedLocation: { lat: number; lng: number } | null;
  onSelectLocation: (lat: number, lng: number) => void;
}

export default function PriorityQueue({ filters, selectedLocation, onSelectLocation }: PriorityQueueProps) {
  const [items, setItems] = useState<PriorityQueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [displayCount, setDisplayCount] = useState(50);

  const loadQueue = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: apiError } = await fetchPriorityQueue({
      district: filters.district || undefined,
      minScore: filters.minScore,
      requestType: filters.requestType || undefined,
      limit: 200,
    });
    setLoading(false);
    if (apiError) {
      setError(apiError);
      return;
    }
    setItems(data ?? []);
    setDisplayCount(50);
  }, [filters.district, filters.minScore, filters.requestType]);

  useEffect(() => {
    loadQueue();
  }, [loadQueue]);

  const visibleItems = items.slice(0, displayCount);

  return (
    <div
      className="px-4 py-3 flex-1"
      style={{ borderBottom: '1px solid var(--color-border)' }}
    >
      <div className="flex items-center justify-between mb-3">
        <h2
          className="text-xs font-semibold uppercase tracking-wider"
          style={{ color: 'var(--color-text-muted)' }}
        >
          Priority Queue
        </h2>
        {!loading && (
          <span
            className="text-xs font-mono"
            style={{ color: 'var(--color-text-muted)' }}
          >
            {items.length} locations
          </span>
        )}
      </div>

      {loading && (
        <div>
          {Array.from({ length: 5 }).map((_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      )}

      {!loading && error && (
        <div
          className="text-xs py-4 px-3 rounded text-center"
          style={{
            color: 'var(--color-text-muted)',
            backgroundColor: 'var(--color-bg)',
            border: '1px solid var(--color-border)',
          }}
        >
          Failed to load priority queue. Check backend connection.
        </div>
      )}

      {!loading && !error && items.length === 0 && (
        <div
          className="text-xs py-4 px-3 rounded text-center leading-relaxed"
          style={{
            color: 'var(--color-text-muted)',
            backgroundColor: 'var(--color-bg)',
            border: '1px solid var(--color-border)',
          }}
        >
          No locations match the current filters.
          <br />
          Try lowering the score threshold or selecting All Districts.
        </div>
      )}

      {!loading && !error && items.length > 0 && (
        <>
          {visibleItems.map((item, i) => {
            const isSelected =
              selectedLocation !== null &&
              Math.abs(selectedLocation.lat - item.lat) < 0.0001 &&
              Math.abs(selectedLocation.lng - item.lng) < 0.0001;

            return (
              <QueueCard
                key={`${item.lat}-${item.lng}`}
                item={item}
                rank={i + 1}
                isSelected={isSelected}
                onClick={() => onSelectLocation(item.lat, item.lng)}
              />
            );
          })}

          {displayCount < items.length && (
            <button
              onClick={() => setDisplayCount((c) => c + 50)}
              className="w-full py-2 text-xs rounded mt-1 transition-colors"
              style={{
                backgroundColor: 'var(--color-bg)',
                border: '1px solid var(--color-border)',
                color: 'var(--color-text-muted)',
                cursor: 'pointer',
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLButtonElement).style.color = 'var(--color-text-primary)';
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLButtonElement).style.color = 'var(--color-text-muted)';
              }}
            >
              Load more ({items.length - displayCount} remaining)
            </button>
          )}
        </>
      )}
    </div>
  );
}
