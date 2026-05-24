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

export function getScoreTier(score: number, count: number): ScoreTier {
  if (score >= 0.70 || (score >= 0.50 && count >= 1000)) return 'high';
  if (score >= 0.40 && count >= 10) return 'moderate';
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
