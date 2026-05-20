'use strict';

/**
 * NashAlert Nightly Recurrence Score Batch Job
 *
 * Precomputes recurrence scores for all Nashville grid points that have
 * at least 1 infrastructure complaint within 200m. Results are written
 * to the recurrence_cache table and served by the API.
 *
 * Grid resolution: 200m spacing across Nashville bounding box.
 * Bounding box: lat 35.97–36.40, lng -87.05 to -86.50
 *
 * NOTE on grid resolution: 200m spacing produces ~15,000–20,000 grid points
 * and provides good heatmap coverage. A 100m grid would produce ~60,000–80,000
 * points for finer heatmap detail at approximately 4x the compute time.
 * Consider upgrading to 100m grid before any production deployment.
 * See docs/METHODOLOGY.md Section 5 for discussion.
 *
 * Run this script nightly after any incremental data sync.
 * Estimated runtime: 5–15 minutes depending on Supabase tier.
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const { supabaseAdmin } = require('../services/supabase');
const {
  computeRecurrenceScore,
  generateHistoricalContext,
  SCORING_RADIUS_METERS,
} = require('../services/scoring');

// ---------------------------------------------------------------
// Batch job configuration
// ---------------------------------------------------------------

// Nashville bounding box — covers the full Davidson County footprint
// with a small margin to ensure border neighborhoods are included.
const BOUNDING_BOX = {
  LAT_MIN: 35.97,
  LAT_MAX: 36.40,
  LNG_MIN: -87.05,
  LNG_MAX: -86.50,
};

// Grid step in degrees. At Nashville's latitude (~36°N):
//   0.0018° of latitude ≈ 200m
// This matches the 200m scoring radius, so each grid point represents
// a distinct, non-redundant location cluster.
const GRID_STEP = 0.0018;

// Number of grid points processed concurrently per batch.
// 50 is chosen for Supabase free tier: enough parallel connections to
// be significantly faster than sequential processing, but well below
// the free tier's connection pool ceiling (~20–100 concurrent connections
// depending on load). See CHANGELOG.md Phase 2 for full rationale.
const BATCH_SIZE = 50;

// Milliseconds to pause between batches. Prevents connection pool
// exhaustion on Supabase free tier while keeping total runtime practical.
const BATCH_PAUSE_MS = 100;

// Log a progress update every N grid points to confirm the job is running.
const PROGRESS_LOG_INTERVAL = 500;

// Supabase's PostgREST layer enforces a default row limit of 1,000 on all
// queries, including RPC calls that return TABLE results. Without an explicit
// .limit() override, complaints_within_radius() silently returns only the
// first 1,000 rows — producing frequency and recency scores computed from a
// truncated complaint list. High-density Nashville locations can have 5,000+
// complaints within 200m, so this cap was causing catastrophic score deflation
// in the most infrastructure-stressed corridors.
//
// Supabase allows overriding the row cap up to 10,000 per request. Our observed
// MAX_COMPLAINT_COUNT is 5,547, so 10,000 covers all current and near-future
// complaint densities with meaningful headroom.
//
// NOTE ON PASS 1: count_complaints_within_radius() returns a single bigint scalar,
// not a TABLE result. Scalar-returning RPC functions are not subject to the
// PostgREST row limit — they bypass the row cap entirely and always return the
// correct aggregate. The .limit() fix is only needed for TABLE-returning RPCs
// like complaints_within_radius().
const SUPABASE_MAX_ROWS = 10000;

// ---------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------

async function main() {
  const startTime = Date.now();
  console.log('=================== STARTING BATCH JOB ===================');
  console.log(`Started at: ${new Date().toISOString()}`);

  if (!supabaseAdmin) {
    throw new Error(
      'SUPABASE_SERVICE_KEY is not set. The batch job requires the service role key ' +
      'to write to recurrence_cache. Set SUPABASE_SERVICE_KEY in backend/.env and retry.'
    );
  }

  // ---------------------------------------------------------------
  // Step 2: Generate Nashville grid
  // ---------------------------------------------------------------
  // Generate all lat/lng grid points within the Nashville bounding box.
  // Points are spaced GRID_STEP degrees apart in both dimensions.
  // Points are rounded to 4 decimal places to match the unique constraint
  // on recurrence_cache (latitude, longitude) — rounding ensures consistent
  // keys across runs.
  // ---------------------------------------------------------------

  const gridPoints = [];
  for (let lat = BOUNDING_BOX.LAT_MIN; lat <= BOUNDING_BOX.LAT_MAX; lat += GRID_STEP) {
    for (let lng = BOUNDING_BOX.LNG_MIN; lng <= BOUNDING_BOX.LNG_MAX; lng += GRID_STEP) {
      gridPoints.push({
        lat: Math.round(lat * 10000) / 10000,
        lng: Math.round(lng * 10000) / 10000,
      });
    }
  }

  console.log(`Grid points generated: ${gridPoints.length.toLocaleString()}`);
  console.log('-----------------------------------------------------------');

  // ---------------------------------------------------------------
  // Step 1: Two-pass scoring — Pass 1: COUNT ONLY
  //
  // Before scoring any grid point, find MAX_COMPLAINT_COUNT — the highest
  // complaint count within 200m of any grid point across Nashville. This
  // is used to normalize frequency scores so that 1.0 = the busiest
  // location in the city, not an arbitrary ceiling.
  //
  // Pass 1 queries only COUNT for each grid point. Points with count = 0
  // are immediately eliminated, reducing Pass 2 to only the meaningful
  // subset. This avoids fetching full complaint rows for empty locations.
  // ---------------------------------------------------------------

  console.log('Pass 1: Counting complaints at each grid point...');
  const countResults = await runPassOne(gridPoints);

  const pointsWithComplaints = countResults.filter((r) => r.count > 0);
  const pointsSkipped = countResults.length - pointsWithComplaints.length;
  const maxComplaintCount = pointsWithComplaints.length > 0
    ? Math.max(...pointsWithComplaints.map((r) => r.count))
    : 0;

  console.log(`Pass 1 complete.`);
  console.log(`  Points with ≥1 complaint: ${pointsWithComplaints.length.toLocaleString()}`);
  console.log(`  Points with 0 complaints (skipped): ${pointsSkipped.toLocaleString()}`);
  console.log(`  MAX_COMPLAINT_COUNT: ${maxComplaintCount}`);
  console.log('-----------------------------------------------------------');

  // Store MAX_COMPLAINT_COUNT as a metadata row immediately so the API
  // can read it even while Pass 2 is still running.
  await upsertMaxComplaintCountMetadata(maxComplaintCount);

  // ---------------------------------------------------------------
  // Step 1 (continued): Pass 2 — FULL SCORING
  //
  // For each grid point with ≥1 complaint: fetch the full complaint data,
  // run the recurrence scoring formula, and write to recurrence_cache.
  // ---------------------------------------------------------------

  console.log('Pass 2: Scoring grid points with ≥1 complaint...');
  const passTwoStats = await runPassTwo(pointsWithComplaints, maxComplaintCount);

  const elapsedMs = Date.now() - startTime;
  const elapsedMinutes = (elapsedMs / 60000).toFixed(1);

  // ---------------------------------------------------------------
  // Step 6: Update LAST_RUN_METADATA
  //
  // Write a second metadata row recording when this job completed and
  // how many entries were written. The API reads this row to determine
  // cache freshness.
  // ---------------------------------------------------------------

  await upsertLastRunMetadata(passTwoStats.cacheEntriesWritten);

  // ---------------------------------------------------------------
  // Step 5: Final summary log
  // ---------------------------------------------------------------

  console.log('');
  console.log('=================== BATCH JOB COMPLETE ===================');
  console.log(`Grid points evaluated:              ${gridPoints.length.toLocaleString()}`);
  console.log(`Grid points scored (≥1 complaint):  ${pointsWithComplaints.length.toLocaleString()}`);
  console.log(`Grid points skipped (0 complaints): ${pointsSkipped.toLocaleString()}`);
  console.log(`Failed batches:                     ${passTwoStats.failedBatches}`);
  console.log(`MAX_COMPLAINT_COUNT used:           ${maxComplaintCount}`);
  console.log(`Total runtime:                      ${elapsedMinutes} minutes`);
  console.log(`Cache entries written:              ${passTwoStats.cacheEntriesWritten}`);
  console.log('==========================================================');
}

// ---------------------------------------------------------------
// Pass 1: COUNT-only sweep across all grid points
// ---------------------------------------------------------------

/**
 * Queries complaint counts for all grid points in parallel batches.
 * Returns an array of { lat, lng, count } objects for every grid point.
 *
 * Uses count_complaints_within_radius RPC (defined in update-schema-phase2.sql)
 * to issue a COUNT query per point using the GIST-indexed ST_DWithin.
 *
 * @param {Array<{lat: number, lng: number}>} gridPoints
 * @returns {Promise<Array<{lat: number, lng: number, count: number}>>}
 */
async function runPassOne(gridPoints) {
  const results = [];
  const totalBatches = Math.ceil(gridPoints.length / BATCH_SIZE);
  let batchIndex = 0;

  for (let i = 0; i < gridPoints.length; i += BATCH_SIZE) {
    const batch = gridPoints.slice(i, i + BATCH_SIZE);
    batchIndex++;

    try {
      const batchResults = await Promise.all(
        batch.map((point) => countComplaintsAtPoint(point.lat, point.lng))
      );
      results.push(...batchResults);
    } catch (err) {
      // One batch failure does not stop Pass 1 — mark those points as count=0
      // so they are skipped in Pass 2. The error is logged for investigation.
      console.error(`[Pass 1] Batch ${batchIndex}/${totalBatches} failed: ${err.message}`);
      for (const point of batch) {
        results.push({ lat: point.lat, lng: point.lng, count: 0 });
      }
    }

    if (i % (PROGRESS_LOG_INTERVAL) === 0 && i > 0) {
      console.log(`  [Pass 1] ${i.toLocaleString()}/${gridPoints.length.toLocaleString()} points counted...`);
    }

    if (batchIndex < totalBatches) {
      await pause(BATCH_PAUSE_MS);
    }
  }

  return results;
}

/**
 * Counts complaints within SCORING_RADIUS_METERS of a single grid point.
 * Uses the count_complaints_within_radius RPC (GIST-indexed, fast).
 *
 * @param {number} lat
 * @param {number} lng
 * @returns {Promise<{lat: number, lng: number, count: number}>}
 */
async function countComplaintsAtPoint(lat, lng) {
  const { data, error } = await supabaseAdmin.rpc('count_complaints_within_radius', {
    query_lat: lat,
    query_lng: lng,
    radius_m: SCORING_RADIUS_METERS,
  });

  if (error) throw new Error(`count_complaints_within_radius failed at (${lat}, ${lng}): ${error.message}`);

  return { lat, lng, count: Number(data) || 0 };
}

// ---------------------------------------------------------------
// Pass 2: Full scoring sweep across points with ≥1 complaint
// ---------------------------------------------------------------

/**
 * Fetches full complaint data, scores each grid point, and writes to
 * recurrence_cache. Processes points in parallel batches.
 *
 * @param {Array<{lat: number, lng: number, count: number}>} points
 * @param {number} maxComplaintCount
 * @returns {Promise<{cacheEntriesWritten: number, failedBatches: number}>}
 */
async function runPassTwo(points, maxComplaintCount) {
  let cacheEntriesWritten = 0;
  let failedBatches = 0;
  let processedTotal = 0;
  const totalBatches = Math.ceil(points.length / BATCH_SIZE);
  let batchIndex = 0;

  for (let i = 0; i < points.length; i += BATCH_SIZE) {
    const batch = points.slice(i, i + BATCH_SIZE);
    batchIndex++;

    try {
      const written = await scoreAndCacheBatch(batch, maxComplaintCount);
      cacheEntriesWritten += written;
    } catch (err) {
      failedBatches++;
      console.error(`[Pass 2] Batch ${batchIndex}/${totalBatches} failed: ${err.message}`);
    }

    processedTotal += batch.length;

    if (processedTotal % PROGRESS_LOG_INTERVAL < BATCH_SIZE && processedTotal > 0) {
      const scored = cacheEntriesWritten;
      const skippedSoFar = processedTotal - scored;
      console.log(
        `  [${processedTotal.toLocaleString()}/${points.length.toLocaleString()}] Processing... ` +
        `(${scored} scored, ${skippedSoFar} skipped, ${failedBatches} failed batches)`
      );
    }

    if (batchIndex < totalBatches) {
      await pause(BATCH_PAUSE_MS);
    }
  }

  return { cacheEntriesWritten, failedBatches };
}

/**
 * Scores all points in a single batch and upserts results into recurrence_cache.
 * Returns the number of cache entries actually written (points with ≥1 complaint).
 *
 * @param {Array<{lat: number, lng: number, count: number}>} batch
 * @param {number} maxComplaintCount
 * @returns {Promise<number>}
 */
async function scoreAndCacheBatch(batch, maxComplaintCount) {
  const cacheRows = await Promise.all(
    batch.map((point) => scorePoint(point.lat, point.lng, maxComplaintCount))
  );

  const validRows = cacheRows.filter((row) => row !== null);
  if (validRows.length === 0) return 0;

  const { error } = await supabaseAdmin
    .from('recurrence_cache')
    .upsert(validRows, { onConflict: 'latitude,longitude' });

  if (error) throw new Error(`recurrence_cache upsert failed: ${error.message}`);

  return validRows.length;
}

/**
 * Fetches all complaints within 200m of a grid point, runs the full scoring
 * formula, and returns a recurrence_cache row ready for upsert.
 * Returns null if no complaints exist at this point (defensive — Pass 1
 * should have already filtered these out).
 *
 * @param {number} lat
 * @param {number} lng
 * @param {number} maxComplaintCount
 * @returns {Promise<Object|null>}
 */
async function scorePoint(lat, lng, maxComplaintCount) {
  const { data: complaints, error } = await supabaseAdmin
    .rpc('complaints_within_radius', {
      query_lat: lat,
      query_lng: lng,
      radius_m: SCORING_RADIUS_METERS,
    })
    .limit(SUPABASE_MAX_ROWS); // override PostgREST's 1,000-row default — see SUPABASE_MAX_ROWS comment above

  if (error) throw new Error(`complaints_within_radius failed at (${lat}, ${lng}): ${error.message}`);

  const complaintList = complaints || [];
  if (complaintList.length === 0) return null;

  const scoringResult = computeRecurrenceScore(complaintList, maxComplaintCount);
  const historical_context = generateHistoricalContext(scoringResult, SCORING_RADIUS_METERS);

  return {
    latitude:             lat,
    longitude:            lng,
    // PostGIS geography point — stored alongside float lat/lng per schema conventions.
    // EWKT format required by Supabase PostgREST for geography inserts.
    location:             `SRID=4326;POINT(${lng} ${lat})`,
    recurrence_score:     scoringResult.recurrence_score,
    frequency_score:      scoringResult.components.frequency_score,
    recency_score:        scoringResult.components.recency_score,
    severity_score:       scoringResult.components.severity_score,
    resolution_score:     scoringResult.components.resolution_score,
    complaint_count:      scoringResult.complaint_count,
    dominant_request_type: scoringResult.dominant_request_type,
    dominant_subtype:     scoringResult.dominant_subtype,
    seasonal_pattern:     scoringResult.seasonal_pattern,
    historical_context,
    last_computed:        new Date().toISOString(),
  };
}

// ---------------------------------------------------------------
// Metadata row management
// ---------------------------------------------------------------

/**
 * Upserts the MAX_COMPLAINT_COUNT_METADATA sentinel row into recurrence_cache.
 *
 * Why store this in recurrence_cache rather than a separate table?
 * A dedicated table would require schema changes and an additional RLS policy.
 * Using a sentinel row in the existing table — identified by the impossible
 * coordinate (lat=0, lng=0), which is in the Gulf of Guinea, nowhere near
 * Nashville — keeps the schema minimal. The API reads it back with a simple
 * equality filter. See CHANGELOG.md Phase 2 for full decision rationale.
 *
 * @param {number} maxComplaintCount
 */
async function upsertMaxComplaintCountMetadata(maxComplaintCount) {
  const { error } = await supabaseAdmin
    .from('recurrence_cache')
    .upsert(
      {
        latitude:         0,
        longitude:        0,
        complaint_count:  maxComplaintCount,
        historical_context: 'MAX_COMPLAINT_COUNT_METADATA',
        last_computed:    new Date().toISOString(),
      },
      { onConflict: 'latitude,longitude' }
    );

  if (error) {
    console.error(`[Metadata] Failed to write MAX_COMPLAINT_COUNT_METADATA: ${error.message}`);
  } else {
    console.log(`MAX_COMPLAINT_COUNT_METADATA written (count: ${maxComplaintCount})`);
  }
}

/**
 * Upserts the LAST_RUN_METADATA sentinel row into recurrence_cache.
 *
 * Stored at (lat=0, lng=0.0001) — distinct from MAX_COMPLAINT_COUNT_METADATA
 * at (lat=0, lng=0). The API's getCacheStatus() reads this row to determine
 * how stale the cache is.
 *
 * @param {number} cacheEntriesWritten
 */
async function upsertLastRunMetadata(cacheEntriesWritten) {
  const { error } = await supabaseAdmin
    .from('recurrence_cache')
    .upsert(
      {
        latitude:         0,
        longitude:        0.0001,
        complaint_count:  cacheEntriesWritten,
        historical_context: 'LAST_RUN_METADATA',
        last_computed:    new Date().toISOString(),
      },
      { onConflict: 'latitude,longitude' }
    );

  if (error) {
    console.error(`[Metadata] Failed to write LAST_RUN_METADATA: ${error.message}`);
  } else {
    console.log(`LAST_RUN_METADATA written (entries: ${cacheEntriesWritten})`);
  }
}

// ---------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------

/**
 * Pauses execution for the given number of milliseconds.
 * Used between batches to avoid overwhelming Supabase free tier
 * connection limits.
 *
 * @param {number} ms
 * @returns {Promise<void>}
 */
function pause(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------
// Run
// ---------------------------------------------------------------

main().catch((err) => {
  console.error('[FATAL] Batch job failed:', err);
  process.exit(1);
});
