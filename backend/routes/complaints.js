'use strict';

const express = require('express');
const { supabase } = require('../services/supabase');
const {
  getCacheStatus,
  getNearestCachedScore,
  getMaxComplaintCount,
} = require('../services/cache');
const {
  computeRecurrenceScore,
  generateHistoricalContext,
  computeSeasonalPattern,
  SCORING_RADIUS_METERS,
} = require('../services/scoring');

const router = express.Router();

// Supabase PostgREST enforces a default 1,000-row cap on all TABLE-returning
// RPC calls. complaints_within_radius() returns a TABLE, so without an explicit
// .limit() override it silently truncates results for high-density locations.
// 10,000 is the Supabase per-request maximum and covers the observed city-wide
// max of 5,547 complaints within 200m with ample headroom.
const SUPABASE_MAX_ROWS = 10000;

// In-memory cache for the stats endpoint.
// Stats aggregate all ~335,000 complaints — expensive to recompute on every request.
// A 1-hour TTL is appropriate because complaint counts change only when new data
// is ingested (infrequent) or a user_report is submitted (doesn't affect complaints table).
const statsCache = {
  data: null,
  computedAt: null,
  TTL_MS: 60 * 60 * 1000, // 1 hour
};

// ---------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------

function parseAndValidateNearbyParams(query) {
  const errors = [];

  const lat = parseFloat(query.lat);
  const lng = parseFloat(query.lng);

  if (isNaN(lat)) {
    errors.push('lat must be a valid number');
  } else if (lat < 24 || lat > 50) {
    errors.push('lat must be within continental US range (24 to 50)');
  }

  if (isNaN(lng)) {
    errors.push('lng must be a valid number');
  } else if (lng < -125 || lng > -65) {
    errors.push('lng must be within continental US range (-125 to -65)');
  }

  let radiusMeters = 200;
  if (query.radius_meters !== undefined) {
    radiusMeters = parseFloat(query.radius_meters);
    if (isNaN(radiusMeters) || radiusMeters <= 0) {
      errors.push('radius_meters must be a positive number');
    } else if (radiusMeters > 2000) {
      errors.push('radius_meters cannot exceed 2000');
    }
  }

  return { errors, lat, lng, radiusMeters };
}

// ---------------------------------------------------------------
// GET /api/complaints/nearby
// ---------------------------------------------------------------
// Returns all complaints within radius_meters of a given lat/lng.
// Uses PostGIS ST_DWithin for spatial filtering — correct geodesic
// distance in meters, GIST-indexed for performance.
// ---------------------------------------------------------------
router.get('/nearby', async (req, res, next) => {
  try {
    const { errors, lat, lng, radiusMeters } = parseAndValidateNearbyParams(req.query);

    if (errors.length > 0) {
      return res.status(400).json({ success: false, error: errors.join('; ') });
    }

    // ST_DWithin with geography type measures true geodesic distance in meters.
    // ST_GeogFromText builds the query point from the validated lat/lng.
    const { data, error } = await supabase
      .rpc('complaints_within_radius', {
        query_lat: lat,
        query_lng: lng,
        radius_m: radiusMeters,
      })
      .limit(SUPABASE_MAX_ROWS); // override PostgREST 1,000-row default

    if (error) {
      // Fall back to direct query if RPC not yet created — allows development without SQL function
      const pointWKT = `POINT(${lng} ${lat})`;
      const { data: fallbackData, error: fallbackError } = await supabase
        .from('complaints')
        .select(
          'id, complaint_id, request_type, subtype, additional_subtype, status, latitude, longitude, address, city, council_district, opened_date, closed_date, request_origin, created_at'
        )
        .filter(
          'location',
          'not.is',
          null
        );

      if (fallbackError) {
        return next(fallbackError);
      }

      // Manual distance filter as fallback (less efficient, used only if RPC missing)
      const nearby = (fallbackData || []).filter((row) => {
        const dLat = (row.latitude - lat) * (Math.PI / 180);
        const dLng = (row.longitude - lng) * (Math.PI / 180);
        const a =
          Math.sin(dLat / 2) ** 2 +
          Math.cos(lat * (Math.PI / 180)) *
            Math.cos(row.latitude * (Math.PI / 180)) *
            Math.sin(dLng / 2) ** 2;
        const distanceMeters = 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return distanceMeters <= radiusMeters;
      });

      return res.json({
        success: true,
        data: { complaints: nearby, count: nearby.length, radius_meters: radiusMeters },
      });
    }

    return res.json({
      success: true,
      data: { complaints: data || [], count: (data || []).length, radius_meters: radiusMeters },
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------
// GET /api/complaints/stats
// ---------------------------------------------------------------
// Aggregate statistics used by the dashboard summary cards.
// All aggregation runs inside Postgres via RPC functions defined in
// backend/scripts/create-functions.sql. This bypasses PostgREST's
// 1,000-row default limit that caused silently truncated counts when
// this endpoint fetched raw rows and aggregated in JavaScript.
// Cached in memory for 1 hour — see statsCache comment above.
// ---------------------------------------------------------------
router.get('/stats', async (req, res, next) => {
  try {
    const now = Date.now();
    if (statsCache.data && statsCache.computedAt && (now - statsCache.computedAt) < statsCache.TTL_MS) {
      return res.json({ success: true, data: statsCache.data });
    }

    // Run RPCs sequentially rather than with Promise.all to avoid hammering
    // Supabase free tier's connection pool simultaneously. The 1-hour in-memory
    // cache means this sequential path runs at most once per hour per server
    // process — the latency cost is paid once, not on every request.
    const totalResult      = await supabase.rpc('get_complaint_total_count');
    const byTypeResult     = await supabase.rpc('get_complaints_by_request_type');
    const byStatusResult   = await supabase.rpc('get_complaints_by_status');
    const byDistrictResult = await supabase.rpc('get_complaints_by_district');
    const dateRangeResult  = await supabase.rpc('get_complaints_date_range');

    if (totalResult.error) return next(totalResult.error);
    if (byTypeResult.error) return next(byTypeResult.error);
    if (byStatusResult.error) return next(byStatusResult.error);
    if (byDistrictResult.error) return next(byDistrictResult.error);
    if (dateRangeResult.error) return next(dateRangeResult.error);

    // RPC returns arrays of {request_type, count} rows — reshape to keyed objects
    // for convenient lookup in the dashboard.
    const countByRequestType = rowsToCountMap(byTypeResult.data, 'request_type');
    const countByStatus = rowsToCountMap(byStatusResult.data, 'status');
    const countByDistrict = rowsToCountMap(byDistrictResult.data, 'council_district');

    const dateRange = dateRangeResult.data?.[0] ?? {};

    const stats = {
      total_complaints: Number(totalResult.data),
      by_request_type: countByRequestType,
      by_status: countByStatus,
      by_council_district: countByDistrict,
      date_range: {
        min: dateRange.min_date ?? null,
        max: dateRange.max_date ?? null,
      },
    };

    statsCache.data = stats;
    statsCache.computedAt = now;

    return res.json({ success: true, data: stats });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------
// GET /api/complaints/district/:district
// ---------------------------------------------------------------
// Returns paginated complaints for a given council district.
// ---------------------------------------------------------------
router.get('/district/:district', async (req, res, next) => {
  try {
    const { district } = req.params;

    const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);
    const offset = parseInt(req.query.offset, 10) || 0;

    if (isNaN(limit) || limit <= 0) {
      return res.status(400).json({ success: false, error: 'limit must be a positive integer (max 500)' });
    }
    if (isNaN(offset) || offset < 0) {
      return res.status(400).json({ success: false, error: 'offset must be a non-negative integer' });
    }

    const { data, error, count } = await supabase
      .from('complaints')
      .select(
        'id, complaint_id, request_type, subtype, additional_subtype, status, latitude, longitude, address, city, council_district, opened_date, closed_date, request_origin, created_at',
        { count: 'exact' }
      )
      .eq('council_district', district)
      .order('opened_date', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) return next(error);

    return res.json({
      success: true,
      data: {
        complaints: data || [],
        count,
        district,
        limit,
        offset,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------
// POST /api/complaints/score
// ---------------------------------------------------------------
// Returns the recurrence score for a given lat/lng.
// Primary path: serves from recurrence_cache (precomputed nightly).
// Fallback path: real-time computation if cache is critically stale
// (> 48h old) or has no entry within 200m of the query point.
// ---------------------------------------------------------------
router.post('/score', async (req, res, next) => {
  try {
    const { lat, lng } = req.body;
    let { radius_meters } = req.body;

    const validationErrors = validateScoreParams(lat, lng, radius_meters);
    if (validationErrors.length > 0) {
      return res.status(400).json({ success: false, error: validationErrors.join('; ') });
    }

    radius_meters = radius_meters ? Math.min(parseFloat(radius_meters), 500) : SCORING_RADIUS_METERS;
    const latNum = parseFloat(lat);
    const lngNum = parseFloat(lng);

    const cacheStatus = await getCacheStatus();

    // Serve from cache if it is not critically stale (< 48h old).
    if (!cacheStatus.isCriticallyStale) {
      if (cacheStatus.isStale) {
        console.warn(
          `[Cache Warning] Cache is ${cacheStatus.ageHours}h old — nightly job may have failed`
        );
      }

      const cached = await getNearestCachedScore(latNum, lngNum);

      if (cached) {
        return res.json({
          success: true,
          data: {
            source:          'cache',
            cache_age_hours: cacheStatus.ageHours,
            location:        { lat: latNum, lng: lngNum, radius_meters },
            scoring: {
              recurrence_score:     cached.recurrence_score,
              components: {
                frequency_score:  cached.frequency_score,
                recency_score:    cached.recency_score,
                severity_score:   cached.severity_score,
                resolution_score: cached.resolution_score,
              },
              complaint_count:       cached.complaint_count,
              dominant_request_type: cached.dominant_request_type,
              dominant_subtype:      cached.dominant_subtype,
              date_range:            { earliest: null, latest: null },
              seasonal_pattern:      cached.seasonal_pattern,
            },
            historical_context: cached.historical_context,
            // nearby_complaints is intentionally empty for cache hits —
            // the full complaint list is not stored in the cache table.
            // Only real-time computations include raw complaints.
            nearby_complaints: [],
          },
        });
      }
    }

    // Real-time fallback — either cache is critically stale or no cache
    // entry exists within 200m of this specific coordinate.
    if (cacheStatus.isCriticallyStale) {
      console.error('[Cache Error] Cache critically stale — falling back to real-time');
    }

    const { data: complaints, error: rpcError } = await supabase
      .rpc('complaints_within_radius', {
        query_lat: latNum,
        query_lng: lngNum,
        radius_m:  radius_meters,
      })
      .limit(SUPABASE_MAX_ROWS); // override PostgREST 1,000-row default

    if (rpcError) return next(rpcError);

    const complaintList = complaints || [];
    const storedMax = await getMaxComplaintCount();
    // If the cached MAX_COMPLAINT_COUNT is unavailable, fall back to the
    // local query count. This produces a locally normalized score — less
    // globally accurate than the city-wide max, but better than refusing
    // to score at all when the batch job metadata is missing.
    const effectiveMax = storedMax || complaintList.length || 1;

    const scoring = computeRecurrenceScore(complaintList, effectiveMax);
    const historical_context = generateHistoricalContext(scoring, radius_meters);

    return res.json({
      success: true,
      data: {
        source:          'realtime',
        cache_age_hours: null,
        location:        { lat: latNum, lng: lngNum, radius_meters },
        scoring,
        historical_context,
        nearby_complaints: complaintList,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------
// GET /api/complaints/temporal
// ---------------------------------------------------------------
// Returns complaint counts grouped by time period (month or quarter)
// for a given location radius. Used to render temporal trend charts.
// ---------------------------------------------------------------
router.get('/temporal', async (req, res, next) => {
  try {
    const { lat, lng } = req.query;
    const radiusMeters = parseFloat(req.query.radius_meters) || SCORING_RADIUS_METERS;
    const groupBy = req.query.group_by === 'quarter' ? 'quarter' : 'month';

    const validationErrors = validateNearbyLatLng(lat, lng);
    if (validationErrors.length > 0) {
      return res.status(400).json({ success: false, error: validationErrors.join('; ') });
    }

    const latNum = parseFloat(lat);
    const lngNum = parseFloat(lng);

    const { data: complaints, error } = await supabase
      .rpc('complaints_within_radius', {
        query_lat: latNum,
        query_lng: lngNum,
        radius_m:  radiusMeters,
      })
      .limit(SUPABASE_MAX_ROWS); // override PostgREST 1,000-row default

    if (error) return next(error);

    const complaintList = complaints || [];
    const temporal_distribution = groupByTimePeriod(complaintList, groupBy);
    const seasonal_pattern = computeSeasonalPattern(complaintList);

    return res.json({
      success: true,
      data: {
        location: { lat: latNum, lng: lngNum, radius_meters: radiusMeters },
        temporal_distribution,
        seasonal_pattern,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------
// GET /api/complaints/priority-queue
// ---------------------------------------------------------------
// Returns ranked cache points for the priority queue panel.
// Excludes the sentinel metadata row (latitude = 0) and applies
// optional filters for district, score threshold, and request type.
//
// District filtering uses a two-stage approach:
//   Stage 1: fetch a large candidate pool from recurrence_cache
//            (1,000 points when district-filtering; `limit` otherwise)
//   Stage 2: for each candidate, check whether any complaint in the
//            target district exists within 1,000m using the
//            complaints_within_radius RPC.
//
// The district-assignment radius is intentionally wider (1,000m) than
// the scoring radius (200m). Scoring clusters are tight by design;
// district assignment is a geographic question — "which administrative
// area does this cache point serve?" — and outer Nashville districts
// have lower complaint density, so the nearest district complaint
// may be 300–800m from the nearest grid point.
//
// Query params:
//   district        - council district number, cast to string (optional)
//   min_score       - minimum recurrence_score, default 0 (optional)
//   min_confidence  - minimum confidence_factor, default 0.0 (optional)
//                     Use min_confidence=1.0 to see only fully-corroborated
//                     locations (5+ complaints, no confidence discount applied)
//   request_type    - dominant_request_type filter (optional)
//   limit           - max results, default 50, max 200 (optional)
// ---------------------------------------------------------------

// Radius used only for district assignment, not for scoring.
// Wide enough to catch sparse outer-district cache points.
const DISTRICT_FILTER_RADIUS_M = 1000;

// When district filtering is active we pull a larger candidate pool first
// so outer-district points (which may rank below the top N globally)
// are included in the spatial check before we apply the user's limit.
const DISTRICT_CANDIDATE_POOL = 1000;

router.get('/priority-queue', async (req, res, next) => {
  try {
    const minScore      = parseFloat(req.query.min_score) || 0;
    const minConfidence = parseFloat(req.query.min_confidence) || 0.0;
    const limit         = Math.min(parseInt(req.query.limit, 10) || 50, 200);
    // Explicit String() cast ensures numeric district values like "17" from
    // query params compare correctly against the text council_district column.
    const district    = req.query.district ? String(req.query.district) : null;
    const requestType = req.query.request_type ? String(req.query.request_type) : null;

    if (isNaN(minScore) || minScore < 0 || minScore > 1) {
      return res.status(400).json({ success: false, error: 'min_score must be between 0 and 1' });
    }
    if (isNaN(minConfidence) || minConfidence < 0 || minConfidence > 1) {
      return res.status(400).json({ success: false, error: 'min_confidence must be between 0 and 1' });
    }

    // When district filtering is active, pull a larger candidate pool so that
    // lower-scoring outer-district cache points are included before the spatial
    // check narrows the set. Without this, top-N globally are all downtown
    // hotspots and outer districts appear to have zero matching cache points.
    const candidateLimit = district ? DISTRICT_CANDIDATE_POOL : limit;

    let query = supabase
      .from('recurrence_cache')
      .select('latitude, lng:longitude, recurrence_score, raw_score, confidence_factor, complaint_count, dominant_request_type, dominant_subtype, seasonal_pattern')
      .neq('latitude', 0)            // exclude MAX_COMPLAINT_COUNT sentinel row
      .gte('recurrence_score', minScore)
      .order('recurrence_score', { ascending: false })
      .limit(candidateLimit);

    if (minConfidence > 0) {
      query = query.gte('confidence_factor', minConfidence);
    }

    if (requestType) {
      query = query.eq('dominant_request_type', requestType);
    }

    const { data, error } = await query;
    if (error) return next(error);

    let items = (data || []).map((row) => ({
      lat:                   row.latitude,
      lng:                   row.lng,
      recurrence_score:      row.recurrence_score,
      raw_score:             row.raw_score,
      confidence_factor:     row.confidence_factor,
      complaint_count:       row.complaint_count,
      dominant_request_type: row.dominant_request_type,
      dominant_subtype:      row.dominant_subtype,
      seasonal_pattern:      row.seasonal_pattern,
    }));

    // District spatial filter — runs only when district param is provided.
    //
    // Previous approach: 1,000 parallel complaints_within_radius RPC calls (one per
    // candidate cache point). This saturated the Supabase free-tier connection pool,
    // causing silent null returns that either dropped all results (fail-closed) or
    // included everything (fail-open), both wrong.
    //
    // Current approach: ONE query to fetch the district's complaint coordinates, then
    // pure-JavaScript haversine distance checks — no parallel RPCs, no connection pool
    // pressure, deterministic results regardless of Supabase load.
    //
    // Membership criterion: a cache point must have ≥ 3 district complaints within
    // DISTRICT_FILTER_RADIUS_M. A single nearby complaint is insufficient — boundary
    // points can pick up one stray complaint from an adjacent district.
    if (district) {
      // Fetch up to 5,000 complaint coordinates for the target district.
      // 5,000 covers every Nashville district with headroom; the query is indexed
      // on council_district and returns only two lightweight numeric columns.
      const { data: districtCoords, error: dcError } = await supabase
        .from('complaints')
        .select('latitude, longitude')
        .eq('council_district', district)
        .not('latitude', 'is', null)
        .not('longitude', 'is', null)
        .limit(5000);

      if (dcError) return next(dcError);

      const coords = districtCoords || [];

      // Haversine distance in metres between two WGS-84 coordinates.
      function haversineM(lat1, lng1, lat2, lng2) {
        const R = 6371000;
        const dLat = (lat2 - lat1) * (Math.PI / 180);
        const dLng = (lng2 - lng1) * (Math.PI / 180);
        const a =
          Math.sin(dLat / 2) ** 2 +
          Math.cos(lat1 * (Math.PI / 180)) *
          Math.cos(lat2 * (Math.PI / 180)) *
          Math.sin(dLng / 2) ** 2;
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      }

      // Filter: keep cache points that have ≥ 3 district complaints within the
      // assignment radius. Early-exit at count = 3 keeps this O(candidates × coords)
      // loop fast in practice — most genuine district members hit 3 quickly.
      const beforeCount = items.length;
      items = items.filter((item) => {
        let count = 0;
        for (const c of coords) {
          if (haversineM(item.lat, item.lng, c.latitude, c.longitude) <= DISTRICT_FILTER_RADIUS_M) {
            count++;
            if (count >= 3) return true;
          }
        }
        return false;
      }).slice(0, limit);

      console.log(
        `[PriorityQueue] district filter applied — ` +
        `district="${district}", district complaints fetched: ${coords.length}, ` +
        `candidates checked: ${beforeCount}, matched: ${items.length}`
      );
    }

    return res.json({
      success: true,
      data: {
        items,
        count: items.length,
        filters_applied: {
          district:        district ?? null,
          min_score:       minScore,
          min_confidence:  minConfidence,
          request_type:    requestType ?? null,
        },
      },
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------
// Helper: group complaints by month or quarter
// ---------------------------------------------------------------

/**
 * Groups complaints by calendar month ("2023-01") or quarter ("2023-Q1").
 * Finds the dominant request_type within each period.
 * Complaints with null opened_date are excluded.
 *
 * Uses Postgres date_trunc semantics via JavaScript Date: truncates to the
 * first day of the month or first day of the quarter.
 *
 * @param {Array<Object>} complaints
 * @param {'month'|'quarter'} groupBy
 * @returns {Array<{period: string, count: number, dominant_type: string}>}
 */
function groupByTimePeriod(complaints, groupBy) {
  const periodMap = {};

  for (const c of complaints) {
    if (!c.opened_date) continue;
    const d = new Date(c.opened_date);
    let period;

    if (groupBy === 'quarter') {
      const year = d.getUTCFullYear();
      const q = Math.floor(d.getUTCMonth() / 3) + 1;
      period = `${year}-Q${q}`;
    } else {
      const year = d.getUTCFullYear();
      const month = String(d.getUTCMonth() + 1).padStart(2, '0');
      period = `${year}-${month}`;
    }

    if (!periodMap[period]) {
      periodMap[period] = { count: 0, types: {} };
    }
    periodMap[period].count++;
    const type = c.request_type || 'Unknown';
    periodMap[period].types[type] = (periodMap[period].types[type] || 0) + 1;
  }

  return Object.entries(periodMap)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([period, { count, types }]) => {
      const dominant_type = Object.entries(types)
        .sort(([, ca], [, cb]) => cb - ca)[0]?.[0] || 'Unknown';
      return { period, count, dominant_type };
    });
}

// ---------------------------------------------------------------
// Validation helpers for new endpoints
// ---------------------------------------------------------------

function validateScoreParams(lat, lng, radius_meters) {
  const errors = validateNearbyLatLng(lat, lng);
  if (radius_meters !== undefined && radius_meters !== null) {
    const r = parseFloat(radius_meters);
    if (isNaN(r) || r <= 0) {
      errors.push('radius_meters must be a positive number');
    } else if (r > 500) {
      errors.push('radius_meters cannot exceed 500');
    }
  }
  return errors;
}

function validateNearbyLatLng(lat, lng) {
  const errors = [];
  const latNum = parseFloat(lat);
  const lngNum = parseFloat(lng);

  if (isNaN(latNum)) {
    errors.push('lat must be a valid number');
  } else if (latNum < 24 || latNum > 50) {
    errors.push('lat must be within continental US range (24 to 50)');
  }

  if (isNaN(lngNum)) {
    errors.push('lng must be a valid number');
  } else if (lngNum < -125 || lngNum > -65) {
    errors.push('lng must be within continental US range (-125 to -65)');
  }

  return errors;
}

// ---------------------------------------------------------------
// Helper: reshape RPC GROUP BY results into a keyed count object.
// Input:  [{request_type: "Pothole", count: "7168"}, ...]
// Output: {"Pothole": 7168, ...}
// Counts come back as strings from Postgres bigint — cast to Number.
// ---------------------------------------------------------------
function rowsToCountMap(rows, keyField) {
  const map = {};
  for (const row of rows || []) {
    const key = row[keyField] ?? 'unknown';
    map[key] = Number(row.count);
  }
  return map;
}

module.exports = router;
