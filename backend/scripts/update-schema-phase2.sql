-- ============================================================
-- NashAlert — Phase 2 Schema Migration
--
-- Run this file in the Supabase SQL editor after create-schema.sql
-- and create-functions.sql. All statements are idempotent — safe
-- to re-run if the migration was partially applied.
--
-- Changes in this migration:
--   1. Add missing columns to recurrence_cache
--      (dominant_request_type, dominant_subtype, seasonal_pattern,
--       historical_context)
--   2. Add UNIQUE constraint on recurrence_cache (latitude, longitude)
--      — required for the batch job's upsert ON CONFLICT logic
--   3. Add B-tree index on recurrence_cache (latitude, longitude)
--      — for the bounding box query used by GET /api/heatmap/bounds
--   4. Add count_complaints_within_radius() SQL function
--      — used by the batch job's Pass 1 to count before fetching full rows
--   5. Add get_nearest_cache_entry() SQL function
--      — used by the cache service's getNearestCachedScore()
-- ============================================================


-- ---------------------------------------------------------------
-- 1. Add new columns to recurrence_cache
--
-- These columns store the enriched scoring output from Phase 2.
-- They are nullable to remain compatible with any existing cache
-- rows written before this migration.
-- ---------------------------------------------------------------

ALTER TABLE recurrence_cache
  ADD COLUMN IF NOT EXISTS dominant_request_type text,
  ADD COLUMN IF NOT EXISTS dominant_subtype       text,
  ADD COLUMN IF NOT EXISTS seasonal_pattern       text,
  ADD COLUMN IF NOT EXISTS historical_context     text;


-- ---------------------------------------------------------------
-- 2. Unique constraint on (latitude, longitude)
--
-- Required for the batch job upsert:
--   supabase.from('recurrence_cache').upsert(row, { onConflict: 'latitude,longitude' })
--
-- The constraint also enforces the integrity of sentinel metadata rows:
--   (lat=0, lng=0)      → MAX_COMPLAINT_COUNT_METADATA
--   (lat=0, lng=0.0001) → LAST_RUN_METADATA
-- Two distinct sentinel rows are possible because their longitudes differ.
--
-- NOTE: This constraint will fail if duplicate (latitude, longitude) pairs
-- already exist in the table. Run this to check first:
--   SELECT latitude, longitude, COUNT(*) FROM recurrence_cache
--   GROUP BY latitude, longitude HAVING COUNT(*) > 1;
-- If duplicates exist, delete them before running this migration.
-- ---------------------------------------------------------------

ALTER TABLE recurrence_cache
  ADD CONSTRAINT recurrence_cache_lat_lng_unique UNIQUE (latitude, longitude);


-- ---------------------------------------------------------------
-- 3. B-tree index on (latitude, longitude)
--
-- Accelerates the bounding box query in GET /api/heatmap/bounds:
--   WHERE latitude BETWEEN sw_lat AND ne_lat
--     AND longitude BETWEEN sw_lng AND ne_lng
--
-- A B-tree composite index on (latitude, longitude) is efficient for
-- range queries on both columns. The GIST index on the geography column
-- is for radius queries; this B-tree index is for rectangle queries.
-- Both indexes serve distinct access patterns and are both needed.
-- ---------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_recurrence_cache_lat_lng
  ON recurrence_cache (latitude, longitude);


-- ---------------------------------------------------------------
-- 4. count_complaints_within_radius(query_lat, query_lng, radius_m)
--
-- Returns the count of complaints within radius_m metres of a point.
-- Used by the batch job's Pass 1 sweep: calling COUNT before fetching
-- full rows means we only pay the cost of row retrieval for points
-- that actually have complaints — avoiding PostgREST row-limit issues
-- and unnecessary data transfer for the thousands of empty grid points.
--
-- SECURITY DEFINER: same rationale as complaints_within_radius —
-- functions must be able to read complaints regardless of RLS policy
-- to return correct aggregate counts.
-- ---------------------------------------------------------------

CREATE OR REPLACE FUNCTION count_complaints_within_radius(
  query_lat  double precision,
  query_lng  double precision,
  radius_m   double precision
)
RETURNS bigint
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT COUNT(*)
  FROM complaints
  WHERE ST_DWithin(
    location,
    ST_GeogFromText('SRID=4326;POINT(' || query_lng || ' ' || query_lat || ')'),
    radius_m
  );
$$;


-- ---------------------------------------------------------------
-- 5. get_nearest_cache_entry(query_lat, query_lng)
--
-- Returns the nearest recurrence_cache row within 200m of the given
-- coordinates, ordered by geodesic distance (ST_Distance on geography
-- column). Excludes sentinel metadata rows (latitude = 0).
--
-- This function is called by the cache service's getNearestCachedScore()
-- to serve precomputed scores to the POST /api/complaints/score endpoint
-- and the POST /api/reports/submit endpoint.
--
-- The 200m radius here mirrors the batch job's scoring radius — a cache
-- entry at a grid point 200m away was computed from complaints within
-- 200m of that point, so it is representative of the query location.
-- Using ST_Distance ordering ensures the closest (most representative)
-- entry is returned when multiple cache entries exist within 200m.
--
-- SECURITY DEFINER: allows the anon key to read recurrence_cache through
-- this function, consistent with the table's public SELECT RLS policy.
-- ---------------------------------------------------------------

CREATE OR REPLACE FUNCTION get_nearest_cache_entry(
  query_lat  double precision,
  query_lng  double precision
)
RETURNS TABLE(
  id                    uuid,
  latitude              double precision,
  longitude             double precision,
  recurrence_score      double precision,
  frequency_score       double precision,
  recency_score         double precision,
  severity_score        double precision,
  resolution_score      double precision,
  complaint_count       integer,
  dominant_request_type text,
  dominant_subtype      text,
  seasonal_pattern      text,
  historical_context    text,
  last_computed         timestamptz
)
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT
    id,
    latitude,
    longitude,
    recurrence_score,
    frequency_score,
    recency_score,
    severity_score,
    resolution_score,
    complaint_count,
    dominant_request_type,
    dominant_subtype,
    seasonal_pattern,
    historical_context,
    last_computed
  FROM recurrence_cache
  WHERE latitude != 0
    AND ST_DWithin(
      location,
      ST_GeogFromText('SRID=4326;POINT(' || query_lng || ' ' || query_lat || ')'),
      200
    )
  ORDER BY ST_Distance(
    location,
    ST_GeogFromText('SRID=4326;POINT(' || query_lng || ' ' || query_lat || ')')
  )
  LIMIT 1;
$$;
