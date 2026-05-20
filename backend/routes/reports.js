'use strict';

/**
 * POST /api/reports/submit
 *
 * Accepts an anonymous infrastructure report from the mobile app,
 * inserts it into user_reports, computes the recurrence score for
 * the submission location, persists the score back to the row, and
 * returns the historical context string for display on the post-
 * submission screen.
 *
 * Architecture note: This route uses supabaseAdmin for the row UPDATE
 * after insert (to save recurrence_score and historical_context). The
 * user_reports RLS policy allows anonymous INSERT but no UPDATE — the
 * update must come from the service role. This is an intentional
 * exception to the "no supabaseAdmin in routes" principle: the route
 * runs entirely on the server (Express), the service key is never
 * exposed to the client, and there is no safer way to update the
 * just-inserted row without supabaseAdmin. See CHANGELOG.md Phase 2.
 */

const express = require('express');
const { supabase, supabaseAdmin } = require('../services/supabase');
const {
  getCacheStatus,
  getNearestCachedScore,
  getMaxComplaintCount,
} = require('../services/cache');
const {
  computeRecurrenceScore,
  generateHistoricalContext,
  SCORING_RADIUS_METERS,
} = require('../services/scoring');

const router = express.Router();

// Supabase PostgREST enforces a default 1,000-row cap on all TABLE-returning
// RPC calls. See complaints.js and compute-scores.js for full rationale.
const SUPABASE_MAX_ROWS = 10000;

// ---------------------------------------------------------------
// POST /api/reports/submit
// ---------------------------------------------------------------
// Accepts a mobile app report, scores the location, and returns
// historical context for the post-submission screen.
// ---------------------------------------------------------------
router.post('/submit', async (req, res, next) => {
  try {
    const { complaint_type, subtype, description, lat, lng, photo_url } = req.body;

    // Validate required fields
    const errors = validateReportBody(req.body);
    if (errors.length > 0) {
      return res.status(400).json({ success: false, error: errors.join('; ') });
    }

    // Insert the user report first — do not wait on scoring to record the submission.
    // The insert uses supabase (anon) which respects the public INSERT policy.
    const locationEwkt = `SRID=4326;POINT(${lng} ${lat})`;
    const { data: insertedRows, error: insertError } = await supabase
      .from('user_reports')
      .insert({
        complaint_type,
        subtype:    subtype   || null,
        description: description || null,
        latitude:   lat,
        longitude:  lng,
        location:   locationEwkt,
        photo_url:  photo_url || null,
      })
      .select('id');

    if (insertError) return next(insertError);

    const reportId = insertedRows?.[0]?.id;
    if (!reportId) {
      return res.status(500).json({ success: false, error: 'Report was inserted but no ID was returned.' });
    }

    // Compute the recurrence score for this location.
    // This follows the same cache-first logic as POST /api/complaints/score.
    const scoringData = await computeScoringForLocation(lat, lng, SCORING_RADIUS_METERS);

    // Update the report row with the computed score and context.
    // Requires supabaseAdmin because there is no public UPDATE policy on user_reports.
    // If supabaseAdmin is unavailable (SUPABASE_SERVICE_KEY not set in dev env),
    // we still return a successful response with the computed data — the row
    // will simply not have the score persisted. This is a graceful degradation.
    if (supabaseAdmin && reportId) {
      const { error: updateError } = await supabaseAdmin
        .from('user_reports')
        .update({
          recurrence_score:  scoringData.scoring.recurrence_score,
          historical_context: scoringData.historical_context,
        })
        .eq('id', reportId);

      if (updateError) {
        console.error('[Reports] Failed to update report with score:', updateError.message);
      }
    } else if (!supabaseAdmin) {
      console.warn('[Reports] supabaseAdmin not available — score not persisted to user_reports row.');
    }

    return res.status(201).json({
      success: true,
      data: {
        report_id:         reportId,
        historical_context: scoringData.historical_context,
        scoring:           scoringData.scoring,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------
// Internal: compute scoring for a location (cache-first)
// ---------------------------------------------------------------

/**
 * Computes or retrieves the recurrence score for a given location.
 * Follows the same cache-first logic as the /score endpoint:
 *   1. Check cache status
 *   2. If not critically stale, try the cache
 *   3. Fall back to real-time if needed
 *
 * Extracted as a shared function so both the reports route and the
 * score endpoint use identical logic without HTTP overhead.
 *
 * @param {number} lat
 * @param {number} lng
 * @param {number} radiusMeters
 * @returns {Promise<{scoring: Object, historical_context: string, source: string, cache_age_hours: number|null}>}
 */
async function computeScoringForLocation(lat, lng, radiusMeters) {
  const cacheStatus = await getCacheStatus();

  if (!cacheStatus.isCriticallyStale) {
    if (cacheStatus.isStale) {
      console.warn(
        `[Cache Warning] Cache is ${cacheStatus.ageHours}h old — nightly job may have failed`
      );
    }

    const cached = await getNearestCachedScore(lat, lng);
    if (cached) {
      return {
        source:          'cache',
        cache_age_hours: cacheStatus.ageHours,
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
      };
    }
  }

  // Real-time fallback
  if (cacheStatus.isCriticallyStale) {
    console.error(
      `[Cache Error] Cache critically stale — falling back to real-time`
    );
  }

  return computeRealTime(lat, lng, radiusMeters);
}

/**
 * Computes recurrence score in real-time by querying complaints directly.
 * Used as a fallback when the cache is critically stale or has no nearby entry.
 *
 * @param {number} lat
 * @param {number} lng
 * @param {number} radiusMeters
 * @returns {Promise<Object>}
 */
async function computeRealTime(lat, lng, radiusMeters) {
  const { data: complaints, error } = await supabase
    .rpc('complaints_within_radius', {
      query_lat: lat,
      query_lng: lng,
      radius_m:  radiusMeters,
    })
    .limit(SUPABASE_MAX_ROWS); // override PostgREST 1,000-row default

  if (error) throw new Error(`complaints_within_radius failed: ${error.message}`);

  const complaintList = complaints || [];
  const maxCount = await getMaxComplaintCount();
  // If MAX_COMPLAINT_COUNT metadata is unavailable, use the local query result
  // count as a fallback normalization base — this produces a locally meaningful
  // frequency score (1.0 = highest count in this specific query) rather than
  // refusing to score at all.
  const effectiveMax = maxCount || complaintList.length || 1;

  const scoring = computeRecurrenceScore(complaintList, effectiveMax);
  const historical_context = generateHistoricalContext(scoring, radiusMeters);

  return {
    source:          'realtime',
    cache_age_hours: null,
    scoring,
    historical_context,
    nearby_complaints: complaintList,
  };
}

// ---------------------------------------------------------------
// Validation
// ---------------------------------------------------------------

function validateReportBody(body) {
  const errors = [];
  const { complaint_type, lat, lng } = body;

  if (!complaint_type || typeof complaint_type !== 'string' || !complaint_type.trim()) {
    errors.push('complaint_type is required');
  }

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

// Export shared scoring function so complaints.js score endpoint can import it
module.exports = router;
module.exports.computeScoringForLocation = computeScoringForLocation;
module.exports.computeRealTime = computeRealTime;
