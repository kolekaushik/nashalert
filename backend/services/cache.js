'use strict';

/**
 * NashAlert Cache Service
 *
 * Provides the interface between the API endpoints and the recurrence_cache table.
 * All scoring API endpoints read through this service — they never query
 * recurrence_cache directly. This centralizes cache logic and makes
 * the fallback behavior (real-time computation when cache is stale or missing)
 * easy to reason about.
 *
 * Cache freshness rules (from .cursorrules Section 7):
 *   < 24 hours old  → serve from cache, no warning
 *   24–48 hours old → serve from cache, log a staleness warning
 *   > 48 hours old  → return isCriticallyStale = true; caller falls back to real-time
 *
 * Two sentinel rows in recurrence_cache store metadata:
 *   (lat=0, lng=0)      → MAX_COMPLAINT_COUNT_METADATA (city-wide max, for normalization)
 *   (lat=0, lng=0.0001) → LAST_RUN_METADATA (timestamp + entry count, for freshness checks)
 *
 * Sentinel rows are identified by latitude = 0, which can never be a real
 * Nashville coordinate (Nashville is between lat 35.97 and 36.40).
 */

const { supabase } = require('./supabase');

// Cache freshness thresholds in hours
const CACHE_STALE_HOURS    = 24;
const CACHE_CRITICAL_HOURS = 48;

// Set BYPASS_CACHE_STALENESS=true in .env to always serve from cache regardless
// of age — useful for local screenshot/demo runs when data is stale but valid.
const BYPASS_CACHE_STALENESS = process.env.BYPASS_CACHE_STALENESS === 'true';

// ---------------------------------------------------------------
// Exported functions
// ---------------------------------------------------------------

/**
 * Reads the LAST_RUN_METADATA sentinel row to determine how fresh the cache is.
 *
 * Returns a structured status object so callers can make routing decisions
 * (serve from cache vs. fall back to real-time) without needing to know
 * the implementation details of the sentinel row scheme.
 *
 * If the metadata row does not exist (cache has never been populated),
 * the cache is treated as critically stale — the API must fall back to
 * real-time computation rather than serve an empty cache.
 *
 * @returns {Promise<{
 *   isStale: boolean,
 *   isCriticallyStale: boolean,
 *   ageHours: number,
 *   lastComputed: string|null
 * }>}
 */
async function getCacheStatus() {
  try {
    const { data, error } = await supabase
      .from('recurrence_cache')
      .select('last_computed')
      .eq('latitude', 0)
      .eq('longitude', 0.0001)
      .single();

    if (error || !data || !data.last_computed) {
      return {
        isStale:           !BYPASS_CACHE_STALENESS,
        isCriticallyStale: !BYPASS_CACHE_STALENESS,
        ageHours:          Infinity,
        lastComputed:      null,
      };
    }

    const ageMs = Date.now() - new Date(data.last_computed).getTime();
    const ageHours = ageMs / (1000 * 60 * 60);

    return {
      isStale:           !BYPASS_CACHE_STALENESS && ageHours > CACHE_STALE_HOURS,
      isCriticallyStale: !BYPASS_CACHE_STALENESS && ageHours > CACHE_CRITICAL_HOURS,
      ageHours:          Math.round(ageHours * 10) / 10,
      lastComputed:      data.last_computed,
    };
  } catch (err) {
    // If the table doesn't exist yet or the query fails, treat as critically stale
    // so the API falls back to real-time rather than returning incorrect data.
    console.error('[Cache] getCacheStatus error:', err.message);
    return {
      isStale:           !BYPASS_CACHE_STALENESS,
      isCriticallyStale: !BYPASS_CACHE_STALENESS,
      ageHours:          Infinity,
      lastComputed:      null,
    };
  }
}

/**
 * Reads the MAX_COMPLAINT_COUNT_METADATA sentinel row to retrieve the
 * city-wide maximum complaint count.
 *
 * This value is used to normalize frequency scores: a location's frequency
 * score = its complaint count / MAX_COMPLAINT_COUNT. Reading it from the
 * cache metadata ensures the same normalization baseline is used for both
 * precomputed cache entries and real-time fallback computations.
 *
 * Returns null if the metadata row does not exist (batch job has not run yet).
 * The real-time scoring path handles a null return by using the local query
 * result count as a fallback normalization base.
 *
 * @returns {Promise<number|null>}
 */
async function getMaxComplaintCount() {
  try {
    const { data, error } = await supabase
      .from('recurrence_cache')
      .select('complaint_count')
      .eq('latitude', 0)
      .eq('longitude', 0)
      .single();

    if (error || !data) return null;
    return data.complaint_count;
  } catch (err) {
    console.error('[Cache] getMaxComplaintCount error:', err.message);
    return null;
  }
}

/**
 * Finds the nearest recurrence_cache entry within 200m of the given coordinates.
 *
 * Uses the get_nearest_cache_entry PostGIS RPC (defined in update-schema-phase2.sql)
 * which applies ST_DWithin on the GIST-indexed geography column and orders results
 * by ST_Distance. This ensures geodesic accuracy — the "nearest" result is the
 * nearest in real-world meters, not the nearest in degree arithmetic.
 *
 * Sentinel rows (latitude = 0) are excluded by the RPC function.
 *
 * Returns null if:
 *   - No cache entry exists within 200m of the coordinates
 *   - The RPC function fails (caller should fall back to real-time)
 *
 * Phase 2.4 note: confidence_factor and raw_score are returned automatically
 * once update-schema-phase24.sql has been applied and the batch job re-run.
 * The RPC function (defined in update-schema-phase2.sql) returns the full row
 * from recurrence_cache, so new columns are included without requiring a
 * separate SQL migration for the function itself.
 *
 * @param {number} lat
 * @param {number} lng
 * @returns {Promise<Object|null>}
 */
async function getNearestCachedScore(lat, lng) {
  try {
    const { data, error } = await supabase.rpc('get_nearest_cache_entry', {
      query_lat: lat,
      query_lng: lng,
    });

    if (error) {
      console.error('[Cache] get_nearest_cache_entry RPC error:', error.message);
      return null;
    }

    if (!data || data.length === 0) return null;

    return data[0];
  } catch (err) {
    console.error('[Cache] getNearestCachedScore error:', err.message);
    return null;
  }
}

/**
 * Returns all recurrence_cache entries within a geographic bounding box.
 *
 * Used by the dashboard map to load heatmap data for the currently visible
 * area as the user pans and zooms. Returning only entries within the visible
 * bounds keeps payload size proportional to the zoom level — a zoomed-out
 * view of all Nashville returns more points; a zoomed-in neighborhood view
 * returns fewer.
 *
 * Uses simple latitude/longitude float comparisons (not PostGIS) because
 * bounding box filtering is a rectangle, not a radius — it does not need
 * geodesic computation. The GIST index on the geography column is not
 * useful for rectangle lookups on float columns; a B-tree range scan on
 * the float lat/lng columns is both correct and efficient here.
 *
 * Excludes sentinel rows (latitude = 0) which are outside Nashville's
 * geographic range and should never be returned to the dashboard.
 *
 * @param {number} swLat - Southwest corner latitude
 * @param {number} swLng - Southwest corner longitude
 * @param {number} neLat - Northeast corner latitude
 * @param {number} neLng - Northeast corner longitude
 * @returns {Promise<Array<Object>>}
 */
async function getCachedScoresInBounds(swLat, swLng, neLat, neLng) {
  try {
    const { data, error } = await supabase
      .from('recurrence_cache')
      .select(
        'latitude, longitude, recurrence_score, raw_score, confidence_factor, complaint_count, dominant_request_type, seasonal_pattern'
      )
      .gte('latitude', swLat)
      .lte('latitude', neLat)
      .gte('longitude', swLng)
      .lte('longitude', neLng)
      .neq('latitude', 0)   // exclude sentinel metadata rows
      .limit(50000);        // Nashville has ~30,979 scored points; 50k gives headroom for dataset growth

    if (error) {
      console.error('[Cache] getCachedScoresInBounds error:', error.message);
      return [];
    }

    return data || [];
  } catch (err) {
    console.error('[Cache] getCachedScoresInBounds error:', err.message);
    return [];
  }
}

module.exports = {
  getCacheStatus,
  getMaxComplaintCount,
  getNearestCachedScore,
  getCachedScoresInBounds,
  CACHE_STALE_HOURS,
  CACHE_CRITICAL_HOURS,
};
