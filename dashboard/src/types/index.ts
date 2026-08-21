export interface CachePoint {
  lat: number;
  lng: number;
  recurrence_score: number;
  complaint_count: number;
  dominant_request_type: string;
  seasonal_pattern: string;
}

export interface ScoreComponents {
  frequency_score: number;
  recency_score: number;
  severity_score: number;
  resolution_score: number;
}

export interface ScoringResult {
  recurrence_score: number;
  components: ScoreComponents;
  complaint_count: number;
  dominant_request_type: string;
  dominant_subtype: string;
  date_range: { earliest: string | null; latest: string | null };
  seasonal_pattern: string;
}

export interface Complaint {
  id: string;
  complaint_id: string;
  request_type: string;
  subtype: string;
  status: string;
  latitude: number;
  longitude: number;
  address: string;
  council_district: string;
  opened_date: string;
  closed_date: string | null;
  request_origin: string;
}

export interface PriorityQueueItem {
  lat: number;
  lng: number;
  recurrence_score: number;
  complaint_count: number;
  dominant_request_type: string;
  dominant_subtype: string;
  seasonal_pattern: string;
  council_district?: string;
}

export interface TemporalDataPoint {
  period: string;
  count: number;
  dominant_type: string;
}

export interface DashboardStats {
  total_complaints: number;
  by_request_type: Record<string, number>;
  by_status: Record<string, number>;
  by_council_district: Record<string, number>;
  date_range: { min: string; max: string };
}

export type SeasonalPattern = 'spring' | 'summer' | 'fall' | 'winter' | 'year-round' | 'insufficient data';
export type ScoreTier = 'high' | 'moderate' | 'low';

// These thresholds must stay in sync with the backend's HIGH_PRIORITY_* /
// MODERATE_* constants in backend/services/scoring.js. They are calibrated
// against the actual recurrence_score distribution produced by the current
// formula weights (METHODOLOGY.md Section 4.1/4.5/4.8), not chosen a priori:
// after the Phase 2.7 weight revision (40/30/20/10 → 15/40/35/10), the
// citywide score distribution compressed enough that the previous
// thresholds (0.70 / 0.50) became unreachable by any real Nashville
// location — which would have made every dashboard entry render as "low"
// (green) regardless of actual severity. Re-derive these values (and the
// map color/heatmap breakpoints in NashvilleMap.tsx) from a fresh percentile
// analysis of recurrence_cache any time the backend formula weights change.
export function getScoreTier(score: number, count: number): ScoreTier {
  if (score >= 0.30 || (score >= 0.20 && count >= 1000)) return 'high';
  if (score >= 0.25 && count >= 10) return 'moderate';
  return 'low';
}

export function getTierColor(tier: ScoreTier): string {
  if (tier === 'high') return 'var(--color-primary)';
  if (tier === 'moderate') return 'var(--color-warning)';
  return 'var(--color-safe)';
}

export function formatRequestType(raw: string): string {
  const labels: Record<string, string> = {
    'Streets, Roads & Sidewalks': 'Road & Sidewalk',
    'Electric & Water General': 'Water & Utility',
    'Public Works WO': 'Public Works',
    'Pothole': 'Pothole',
    'Street Lighting': 'Street Lighting',
    'Power Lines Down or Low': 'Power Lines',
    'Blocked Drain': 'Blocked Drain',
    'Flooding': 'Flooding',
    'Traffic Light Issue': 'Traffic Signal',
    'Remove debris in roadway': 'Debris',
    'Ditch Maintenance': 'Ditch',
    'Clogged Culvert & Cross Drains': 'Culvert',
    'Repair Storm Drain': 'Storm Drain',
    'Snow and Ice Removal': 'Snow & Ice',
    'Sidewalks': 'Sidewalk',
    'Sinkhole': 'Sinkhole',
  };
  return labels[raw] ?? raw;
}
