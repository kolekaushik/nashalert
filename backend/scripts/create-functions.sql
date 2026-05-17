-- ============================================================
-- NashAlert — PostgreSQL Functions
-- Run this file once in the Supabase SQL editor, after create-schema.sql.
-- ============================================================
--
-- WHY FUNCTIONS INSTEAD OF CLIENT-SIDE AGGREGATION
-- ---------------------------------------------------------------
-- Supabase's auto-generated REST API (PostgREST) enforces a default
-- row limit of 1,000 on all table queries. Fetching raw rows and
-- aggregating in JavaScript therefore produces silently truncated
-- results — the stats endpoint was returning counts based on only
-- the first 1,000 rows of a 334,710-row table.
--
-- Moving aggregation into database functions eliminates this problem:
-- the function runs a full-table GROUP BY inside Postgres and returns
-- only the summary rows, which are always well under the row limit.
-- Functions called via .rpc() also bypass PostgREST's row limit
-- entirely, since they return their own result set.
--
-- SECURITY
-- ---------------------------------------------------------------
-- All functions are defined with SECURITY DEFINER so they execute
-- with the privileges of the function owner (the database superuser)
-- rather than the calling role. This means they work correctly even
-- when Row Level Security is enabled on the underlying tables — the
-- function can always read all rows. The anon key may call these
-- functions because they are read-only aggregates with no parameters
-- that could be abused for injection.
-- ============================================================


-- ---------------------------------------------------------------
-- get_complaint_total_count()
-- Returns the total number of rows in the complaints table.
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_complaint_total_count()
RETURNS bigint
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT COUNT(*) FROM complaints;
$$;


-- ---------------------------------------------------------------
-- get_complaints_by_request_type()
-- Returns one row per distinct request_type, ordered by count desc.
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_complaints_by_request_type()
RETURNS TABLE(request_type text, count bigint)
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT request_type, COUNT(*) AS count
  FROM complaints
  GROUP BY request_type
  ORDER BY count DESC;
$$;


-- ---------------------------------------------------------------
-- get_complaints_by_status()
-- Returns one row per distinct status value, ordered by count desc.
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_complaints_by_status()
RETURNS TABLE(status text, count bigint)
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT status, COUNT(*) AS count
  FROM complaints
  GROUP BY status
  ORDER BY count DESC;
$$;


-- ---------------------------------------------------------------
-- get_complaints_by_district()
-- Returns one row per distinct council_district, ordered alphabetically.
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_complaints_by_district()
RETURNS TABLE(council_district text, count bigint)
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT council_district, COUNT(*) AS count
  FROM complaints
  GROUP BY council_district
  ORDER BY council_district;
$$;


-- ---------------------------------------------------------------
-- get_complaints_date_range()
-- Returns the earliest and latest opened_date across all complaints.
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_complaints_date_range()
RETURNS TABLE(min_date timestamptz, max_date timestamptz)
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT MIN(opened_date) AS min_date, MAX(opened_date) AS max_date
  FROM complaints;
$$;


-- ---------------------------------------------------------------
-- complaints_within_radius(query_lat, query_lng, radius_m)
-- Returns all complaint columns (except the raw geography object)
-- for complaints within radius_m metres of the given point.
-- Uses ST_DWithin on the GIST-indexed geography column.
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION complaints_within_radius(
  query_lat  double precision,
  query_lng  double precision,
  radius_m   double precision
)
RETURNS TABLE(
  id                  uuid,
  complaint_id        text,
  request_type        text,
  subtype             text,
  additional_subtype  text,
  status              text,
  latitude            double precision,
  longitude           double precision,
  address             text,
  city                text,
  council_district    text,
  opened_date         timestamptz,
  closed_date         timestamptz,
  request_origin      text,
  created_at          timestamptz
)
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT
    id, complaint_id, request_type, subtype, additional_subtype,
    status, latitude, longitude, address, city, council_district,
    opened_date, closed_date, request_origin, created_at
  FROM complaints
  WHERE ST_DWithin(
    location,
    ST_GeogFromText('SRID=4326;POINT(' || query_lng || ' ' || query_lat || ')'),
    radius_m
  );
$$;
