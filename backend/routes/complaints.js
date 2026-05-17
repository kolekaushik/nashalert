'use strict';

const express = require('express');
const { supabase } = require('../services/supabase');

const router = express.Router();

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
    const { data, error } = await supabase.rpc('complaints_within_radius', {
      query_lat: lat,
      query_lng: lng,
      radius_m: radiusMeters,
    });

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

    const [totalResult, byTypeResult, byStatusResult, byDistrictResult, dateRangeResult] =
      await Promise.all([
        supabase.rpc('get_complaint_total_count'),
        supabase.rpc('get_complaints_by_request_type'),
        supabase.rpc('get_complaints_by_status'),
        supabase.rpc('get_complaints_by_district'),
        supabase.rpc('get_complaints_date_range'),
      ]);

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
