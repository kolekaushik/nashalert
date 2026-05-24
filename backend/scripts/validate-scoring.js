'use strict';

/**
 * NashAlert Scoring Validation Script
 *
 * Run after the nightly batch job completes to verify that recurrence scores
 * have been computed correctly for a representative set of Nashville locations.
 * Prints a structured report for each location showing all component scores,
 * the final recurrence score, and the historical context string.
 *
 * This is a diagnostic tool, not a feature. It does not write to any table.
 * Run with: node backend/scripts/validate-scoring.js
 */

/**
 * IMPORTANT: Always recompute the cache before running this script if any
 * of the following have changed since the last compute-scores.js run:
 *   - RECENCY_HALF_LIFE_DAYS or any constant in scoring.js
 *   - Severity weights in constants/severity-weights.js
 *   - generateHistoricalContext logic
 *   - The scoring formula weights
 * Run: DELETE FROM recurrence_cache; then node scripts/compute-scores.js
 * A critically stale cache will serve outdated context strings and scores.
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const { supabase } = require('../services/supabase');

// Override Supabase PostgREST's 1,000-row default for TABLE-returning RPCs.
const SUPABASE_MAX_ROWS = 10000;
const {
  getNearestCachedScore,
  getMaxComplaintCount,
  getCacheStatus,
} = require('../services/cache');
const {
  computeRecurrenceScore,
  generateHistoricalContext,
  SCORING_RADIUS_METERS,
} = require('../services/scoring');

// ---------------------------------------------------------------
// Test locations
// Five Nashville coordinates covering a range of neighborhoods
// and expected complaint densities.
// ---------------------------------------------------------------

const TEST_LOCATIONS = [
  { name: 'Downtown Nashville',     lat: 36.1627, lng: -86.7816 },
  { name: 'East Nashville',         lat: 36.1834, lng: -86.7397 },
  { name: 'Nolensville Pike corridor', lat: 36.0821, lng: -86.7302 },
  { name: 'North Nashville',        lat: 36.2084, lng: -86.8097 },
  { name: 'Green Hills',            lat: 36.1077, lng: -86.8178 },
];

// ---------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------

async function main() {
  console.log('NashAlert Scoring Validation');
  console.log(`Timestamp: ${new Date().toISOString()}`);
  console.log('');

  const cacheStatus = await getCacheStatus();
  console.log(`Cache status: ${cacheStatus.isCriticallyStale ? 'CRITICALLY STALE' : cacheStatus.isStale ? 'STALE' : 'FRESH'} (${cacheStatus.ageHours === Infinity ? 'never run' : cacheStatus.ageHours + 'h old'})`);
  console.log(`Last computed: ${cacheStatus.lastComputed || 'never'}`);
  console.log('');

  const maxComplaintCount = await getMaxComplaintCount();
  console.log(`MAX_COMPLAINT_COUNT: ${maxComplaintCount === null ? '(not set — batch job has not run)' : maxComplaintCount}`);
  console.log('');

  for (const location of TEST_LOCATIONS) {
    await validateLocation(location, maxComplaintCount);
  }

  console.log('Validation complete.');
}

// ---------------------------------------------------------------
// Validate a single location
// ---------------------------------------------------------------

async function validateLocation(location, maxComplaintCount) {
  const DIVIDER = '─────────────────────────────────────────────';
  console.log(DIVIDER);

  let source = 'unknown';
  let scoring = null;
  let historical_context = '';

  // Try cache first
  const cached = await getNearestCachedScore(location.lat, location.lng);

  if (cached) {
    source = 'cache';
    scoring = {
      recurrence_score: cached.recurrence_score,
      components: {
        frequency_score:  cached.frequency_score,
        recency_score:    cached.recency_score,
        severity_score:   cached.severity_score,
        resolution_score: cached.resolution_score,
      },
      complaint_count:       cached.complaint_count,
      dominant_request_type: cached.dominant_request_type,
      dominant_subtype:      cached.dominant_subtype,
      seasonal_pattern:      cached.seasonal_pattern,
      date_range:            { earliest: null, latest: null },
    };
    historical_context = cached.historical_context || '';
  } else {
    // Fall back to real-time computation
    source = 'realtime';
    const { data: complaints, error } = await supabase
      .rpc('complaints_within_radius', {
        query_lat: location.lat,
        query_lng: location.lng,
        radius_m:  SCORING_RADIUS_METERS,
      })
      .limit(SUPABASE_MAX_ROWS); // override PostgREST 1,000-row default

    if (error) {
      console.log(`Location:         ${location.name}`);
      console.log(`Coordinates:      ${location.lat}, ${location.lng}`);
      console.log(`ERROR:            ${error.message}`);
      console.log(DIVIDER);
      console.log('');
      return;
    }

    const complaintList = complaints || [];
    const effectiveMax = maxComplaintCount || complaintList.length || 1;
    scoring = computeRecurrenceScore(complaintList, effectiveMax);
    historical_context = generateHistoricalContext(scoring, SCORING_RADIUS_METERS);
  }

  const c = scoring.components || {};
  console.log(`Location:         ${location.name}`);
  console.log(`Coordinates:      ${location.lat}, ${location.lng}`);
  console.log(`Source:           ${source}`);
  console.log(`Complaint count:  ${scoring.complaint_count}`);
  console.log(DIVIDER);
  console.log(`Frequency score:  ${formatScore(c.frequency_score)}`);
  console.log(`Recency score:    ${formatScore(c.recency_score)}`);
  console.log(`Severity score:   ${formatScore(c.severity_score)}`);
  console.log(`Resolution score: ${formatScore(c.resolution_score)}`);
  console.log(DIVIDER);
  console.log(`RECURRENCE SCORE: ${formatScore(scoring.recurrence_score)}`);
  console.log(`Seasonal pattern: ${scoring.seasonal_pattern || '(none)'}`);
  console.log(`Dominant type:    ${scoring.dominant_request_type || '(none)'}`);
  console.log(DIVIDER);
  console.log('Historical context:');
  console.log(`"${historical_context}"`);
  console.log(DIVIDER);
  console.log('');
}

function formatScore(value) {
  if (value === null || value === undefined) return '(not computed)';
  return Number(value).toFixed(4);
}

// ---------------------------------------------------------------
// Run
// ---------------------------------------------------------------

main().catch((err) => {
  console.error('Validation script failed:', err);
  process.exit(1);
});
