import type {
  CachePoint,
  DashboardStats,
  Complaint,
  ScoringResult,
  TemporalDataPoint,
  PriorityQueueItem,
} from '../types';

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '';

type ApiResult<T> = { data: T | null; error: string | null };

async function apiGet<T>(path: string): Promise<ApiResult<T>> {
  try {
    const res = await fetch(`${BASE_URL}${path}`);
    const json = await res.json();
    if (!res.ok || !json.success) {
      return { data: null, error: json.error ?? `HTTP ${res.status}` };
    }
    return { data: json.data as T, error: null };
  } catch (err) {
    return { data: null, error: err instanceof Error ? err.message : 'Network error' };
  }
}

async function apiPost<T>(path: string, body: unknown): Promise<ApiResult<T>> {
  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    if (!res.ok || !json.success) {
      return { data: null, error: json.error ?? `HTTP ${res.status}` };
    }
    return { data: json.data as T, error: null };
  } catch (err) {
    return { data: null, error: err instanceof Error ? err.message : 'Network error' };
  }
}

export async function fetchHeatmapBounds(
  swLat: number,
  swLng: number,
  neLat: number,
  neLng: number
): Promise<ApiResult<CachePoint[]>> {
  const params = new URLSearchParams({
    sw_lat: String(swLat),
    sw_lng: String(swLng),
    ne_lat: String(neLat),
    ne_lng: String(neLng),
  });
  const result = await apiGet<{ points: CachePoint[]; count: number }>(`/api/heatmap/bounds?${params}`);
  if (result.error) return { data: null, error: result.error };
  return { data: result.data?.points ?? [], error: null };
}

export async function fetchStats(): Promise<ApiResult<DashboardStats>> {
  return apiGet<DashboardStats>('/api/complaints/stats');
}

export async function fetchNearby(
  lat: number,
  lng: number,
  radiusMeters: number = 200
): Promise<ApiResult<Complaint[]>> {
  const params = new URLSearchParams({
    lat: String(lat),
    lng: String(lng),
    radius_meters: String(radiusMeters),
  });
  const result = await apiGet<{ complaints: Complaint[]; count: number }>(`/api/complaints/nearby?${params}`);
  if (result.error) return { data: null, error: result.error };
  return { data: result.data?.complaints ?? [], error: null };
}

export interface ScoreResponse {
  scoring: ScoringResult;
  historical_context: string;
  source: string;
}

export async function fetchScore(lat: number, lng: number): Promise<ApiResult<ScoreResponse>> {
  const result = await apiPost<{
    scoring: ScoringResult;
    historical_context: string;
    source: string;
  }>('/api/complaints/score', { lat, lng });
  if (result.error) return { data: null, error: result.error };
  return { data: result.data ?? null, error: null };
}

export async function fetchTemporal(
  lat: number,
  lng: number,
  groupBy: 'month' | 'quarter' = 'month'
): Promise<ApiResult<TemporalDataPoint[]>> {
  const params = new URLSearchParams({
    lat: String(lat),
    lng: String(lng),
    group_by: groupBy,
  });
  const result = await apiGet<{
    temporal_distribution: TemporalDataPoint[];
    seasonal_pattern: string;
  }>(`/api/complaints/temporal?${params}`);
  if (result.error) return { data: null, error: result.error };
  return { data: result.data?.temporal_distribution ?? [], error: null };
}

export interface PriorityQueueFilters {
  district?: string;
  minScore?: number;
  requestType?: string;
  limit?: number;
}

export async function fetchPriorityQueue(
  filters: PriorityQueueFilters
): Promise<ApiResult<PriorityQueueItem[]>> {
  const params = new URLSearchParams();
  if (filters.district) params.set('district', filters.district);
  if (filters.minScore !== undefined) params.set('min_score', String(filters.minScore));
  if (filters.requestType) params.set('request_type', filters.requestType);
  if (filters.limit !== undefined) params.set('limit', String(filters.limit));

  const query = params.toString();
  const result = await apiGet<{ items: PriorityQueueItem[]; count: number }>(
    `/api/complaints/priority-queue${query ? `?${query}` : ''}`
  );
  if (result.error) return { data: null, error: result.error };
  return { data: result.data?.items ?? [], error: null };
}

export async function fetchCacheStatus(): Promise<ApiResult<{ status: string; age_hours: number | null }>> {
  return apiGet('/health');
}
