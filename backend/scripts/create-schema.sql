-- ============================================================
-- NashAlert — Database Schema
-- Run this file once in the Supabase SQL editor.
-- ============================================================
--
-- TABLE PURPOSES
-- ---------------------------------------------------------------
-- complaints:
--   Stores every infrastructure-relevant Nashville 311 service
--   request imported from the Metro Open Data CSV. This is the
--   historical dataset that drives the recurrence scoring engine
--   and the equity analysis.
--
-- user_reports:
--   Stores new infrastructure reports submitted by Nashville
--   residents via the NashAlert mobile app. These augment the
--   historical 311 data with real-time community input.
--
-- recurrence_cache:
--   Stores precomputed recurrence scores for location clusters.
--   Computing the full score on every API call is expensive
--   (requires aggregating complaints within a radius, applying
--   exponential decay, etc.). This table caches those results
--   and is refreshed on a schedule or invalidated when new
--   complaints arrive nearby.
--
-- WHY PostGIS GEOGRAPHY TYPE OVER RAW LAT/LNG FLOATS
-- ---------------------------------------------------------------
-- The geography(Point, 4326) column type stores coordinates as
-- a proper spatial object referenced to the WGS-84 ellipsoid
-- (the same datum used by GPS). This enables:
--
--   1. ST_DWithin(location, query_point, radius_meters) — radius
--      queries in real-world meters without manual haversine math.
--      PostGIS accounts for Earth's curvature; a simple float
--      comparison does not.
--
--   2. GIST spatial indexes — dramatically faster spatial queries
--      on large datasets (the complaints table will hold ~250,000+
--      rows). A plain B-tree index on (latitude, longitude) floats
--      cannot accelerate proximity queries efficiently.
--
--   3. Future spatial joins — joining complaints to Nashville
--      census tract boundaries for the equity analysis requires
--      ST_Within, ST_Intersects, and related operators, all of
--      which require PostGIS geometry/geography types.
--
-- Latitude and longitude floats are stored as redundant columns
-- alongside the geography column so API responses can return
-- plain numeric coordinates without clients needing to decode
-- a PostGIS binary object.
-- ============================================================


-- Enable PostGIS. Supabase includes PostGIS by default.
CREATE EXTENSION IF NOT EXISTS postgis;


-- ---------------------------------------------------------------
-- complaints
-- Historical Nashville 311 infrastructure service requests.
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS complaints (
  id                  uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  complaint_id        text          UNIQUE NOT NULL,         -- original Request # from CSV
  request_type        text          NOT NULL,                -- normalized Request Type
  subtype             text,                                  -- Subtype; stored as '(none)' if missing
  additional_subtype  text,
  status              text,
  location            geography(Point, 4326),               -- PostGIS spatial column
  latitude            float8        NOT NULL,
  longitude           float8        NOT NULL,
  address             text,
  city                text,
  council_district    text,
  opened_date         timestamptz,
  closed_date         timestamptz,
  request_origin      text,                                  -- phone, app, web — kept for equity analysis
  created_at          timestamptz   DEFAULT now()
);


-- ---------------------------------------------------------------
-- user_reports
-- Infrastructure reports submitted via the NashAlert mobile app.
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_reports (
  id                  uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  complaint_type      text          NOT NULL,
  subtype             text,
  description         text,
  location            geography(Point, 4326),
  latitude            float8        NOT NULL,
  longitude           float8        NOT NULL,
  photo_url           text,
  recurrence_score    float8,                                -- populated by backend after submission
  historical_context  jsonb,                                 -- context object returned to mobile app
  submitted_at        timestamptz   DEFAULT now()
);


-- ---------------------------------------------------------------
-- recurrence_cache
-- Precomputed recurrence scores per location cluster.
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS recurrence_cache (
  id                  uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  location            geography(Point, 4326),
  latitude            float8,
  longitude           float8,
  recurrence_score    float8,
  frequency_score     float8,
  recency_score       float8,
  severity_score      float8,
  resolution_score    float8,
  complaint_count     integer,
  last_computed       timestamptz   DEFAULT now()
);


-- ---------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------
-- RLS must be enabled on every table so that the Supabase auto-generated
-- REST API cannot be used to bypass your Express backend. The service role
-- key (supabaseAdmin) ignores RLS entirely — it always has full access.
-- The anon key (supabase) is governed by the policies below.
--
-- Policy design:
--   complaints      — public read, no client writes (ingestion uses service key)
--   user_reports    — public insert (anonymous report submission), no client reads
--   recurrence_cache — public read, no client writes (scoring engine uses service key)
-- ---------------------------------------------------------------

ALTER TABLE complaints       ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_reports     ENABLE ROW LEVEL SECURITY;
ALTER TABLE recurrence_cache ENABLE ROW LEVEL SECURITY;

-- complaints: anyone can read, nobody can write via the anon key
CREATE POLICY "Public read access to complaints"
  ON complaints FOR SELECT
  TO anon
  USING (true);

-- user_reports: anyone can submit a report (anonymous app), nobody can read others' reports via anon key
-- The mobile app posts a report and receives the computed score back in the API response;
-- it never needs to query this table directly.
CREATE POLICY "Public insert for user reports"
  ON user_reports FOR INSERT
  TO anon
  WITH CHECK (true);

-- recurrence_cache: public read so the API route can serve scores without the service key
CREATE POLICY "Public read access to recurrence cache"
  ON recurrence_cache FOR SELECT
  TO anon
  USING (true);


-- ---------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------

-- Spatial index on complaints — enables fast ST_DWithin radius queries
CREATE INDEX IF NOT EXISTS idx_complaints_location
  ON complaints USING GIST(location);

-- B-tree indexes for common filter/sort operations on complaints
CREATE INDEX IF NOT EXISTS idx_complaints_request_type
  ON complaints(request_type);

CREATE INDEX IF NOT EXISTS idx_complaints_opened_date
  ON complaints(opened_date);

CREATE INDEX IF NOT EXISTS idx_complaints_council_district
  ON complaints(council_district);

-- Spatial index on user_reports — same rationale as complaints
CREATE INDEX IF NOT EXISTS idx_user_reports_location
  ON user_reports USING GIST(location);

-- Spatial index on recurrence_cache — nearest-cache lookup by location
CREATE INDEX IF NOT EXISTS idx_recurrence_cache_location
  ON recurrence_cache USING GIST(location);
