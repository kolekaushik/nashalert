'use strict';

/**
 * NashAlert Weight Sensitivity Analysis
 *
 * Compares the recurrence score's two candidate weightings on IDENTICAL cached
 * data, without recomputing anything and without re-tuning either one:
 *
 *   Weighting A (original): frequency 0.40 / recency 0.30 / severity 0.20 / resolution 0.10
 *   Weighting B (revised):  frequency 0.15 / recency 0.40 / severity 0.35 / resolution 0.10
 *
 * This is possible because compute-scores.js persists all four sub-scores per
 * grid point in recurrence_cache, so both composites can be re-derived from the
 * same stored sub-scores. The comparison is therefore exact rather than an
 * approximation across two separate batch runs, and it isolates the effect of
 * the weights alone (identical complaint data, identical recency reference time,
 * identical confidence factors).
 *
 * WHY THIS SCRIPT EXISTS: the weights were revised once in response to
 * inspecting ranked output. Output inspection is not a defensible calibration
 * procedure on its own, and there is no ground-truth maintenance-outcome data
 * available to calibrate against (see METHODOLOGY.md Section 7). This script
 * makes the consequences of the weight choice measurable and reproducible so
 * both weightings can be reported side by side as a sensitivity analysis rather
 * than one being silently presented as correct.
 *
 * Outputs, for each weighting:
 *   - Top-N ranked locations with complaint counts
 *   - Complaint-count profile of the top N (min/median/max) — i.e. whether the
 *     ranking is dominated by dense or sparse locations
 *   - Rank overlap between the two weightings (shared locations in top N)
 *   - Spatial redundancy: single-link clustering of the top N at a configurable
 *     radius, to detect multiple adjacent grid cells representing one real site
 *   - Confidence-factor gating check: how far the confidence multiplier is
 *     actually holding back low-corroboration locations
 *
 * Usage:  node scripts/weight-sensitivity-analysis.js [topN] [clusterRadiusMeters]
 * Default: topN = 30, clusterRadiusMeters = 500
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const { supabaseAdmin } = require('../services/supabase');
const { CONFIDENCE_THRESHOLD_COMPLAINTS } = require('../services/scoring');

// ---------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------

const WEIGHTINGS = {
  'A (original 40/30/20/10)': {
    frequency: 0.40,
    recency: 0.30,
    severity: 0.20,
    resolution: 0.10,
  },
  'B (revised 15/40/35/10)': {
    frequency: 0.15,
    recency: 0.40,
    severity: 0.35,
    resolution: 0.10,
  },
};

const TOP_N = Number(process.argv[2]) || 30;
const CLUSTER_RADIUS_METERS = Number(process.argv[3]) || 500;

// Supabase caps a single select at 1,000 rows; the cache holds ~31,000.
const PAGE_SIZE = 1000;

// Metadata rows are stored at sentinel coordinates rather than in a separate
// table (see cache.js) and must be excluded from any distribution analysis.
const METADATA_SENTINEL_LAT = 0;

// ---------------------------------------------------------------
// Data loading
// ---------------------------------------------------------------

async function fetchAllCacheRows() {
  const rows = [];
  let offset = 0;

  for (;;) {
    const { data, error } = await supabaseAdmin
      .from('recurrence_cache')
      .select(
        'latitude, longitude, complaint_count, confidence_factor, ' +
        'frequency_score, recency_score, severity_score, resolution_score, ' +
        'recurrence_score, raw_score, dominant_request_type'
      )
      .neq('latitude', METADATA_SENTINEL_LAT)
      .range(offset, offset + PAGE_SIZE - 1);

    if (error) throw new Error(`Supabase read failed: ${error.message}`);
    if (!data || data.length === 0) break;

    rows.push(...data);
    if (data.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  return rows;
}

// ---------------------------------------------------------------
// Scoring under an arbitrary weighting
// ---------------------------------------------------------------

/**
 * Recomputes the composite from stored sub-scores under a given weighting.
 * The confidence factor stored on the row is reapplied unchanged, so the only
 * variable between weightings is the weight vector itself.
 */
function scoreUnder(row, w) {
  const raw =
    (row.frequency_score  ?? 0) * w.frequency +
    (row.recency_score    ?? 0) * w.recency +
    (row.severity_score   ?? 0) * w.severity +
    (row.resolution_score ?? 0) * w.resolution;

  const confidence = row.confidence_factor ?? 1;

  return {
    raw: Math.min(1, Math.max(0, raw)),
    final: Math.min(1, Math.max(0, raw * confidence)),
  };
}

function rankUnder(rows, w) {
  return rows
    .map((row) => {
      const { raw, final } = scoreUnder(row, w);
      return { ...row, computed_raw: raw, computed_final: final };
    })
    .sort((a, b) => b.computed_final - a.computed_final);
}

// ---------------------------------------------------------------
// Spatial redundancy: single-link clustering
// ---------------------------------------------------------------

const EARTH_RADIUS_METERS = 6371000;

function haversineMeters(lat1, lng1, lat2, lng2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(a));
}

/**
 * Groups entries into distinct sites using single-link (transitive) clustering:
 * two entries join the same site if they are within radiusMeters of each other.
 * This measures how many genuinely distinct places a ranked list represents,
 * versus how many slots are consumed by adjacent grid cells of one place.
 */
function clusterIntoSites(entries, radiusMeters) {
  const parent = entries.map((_, i) => i);

  const find = (i) => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };

  const union = (i, j) => {
    const ri = find(i);
    const rj = find(j);
    if (ri !== rj) parent[rj] = ri;
  };

  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      const d = haversineMeters(
        entries[i].latitude, entries[i].longitude,
        entries[j].latitude, entries[j].longitude
      );
      if (d <= radiusMeters) union(i, j);
    }
  }

  const sites = new Map();
  entries.forEach((entry, i) => {
    const root = find(i);
    if (!sites.has(root)) sites.set(root, []);
    sites.get(root).push({ ...entry, rank: i + 1 });
  });

  return [...sites.values()].sort((a, b) => a[0].rank - b[0].rank);
}

// ---------------------------------------------------------------
// Reporting helpers
// ---------------------------------------------------------------

function median(nums) {
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function locationKey(row) {
  return `${row.latitude.toFixed(4)},${row.longitude.toFixed(4)}`;
}

function reportRanking(label, ranked, topN) {
  const top = ranked.slice(0, topN);
  const counts = top.map((r) => r.complaint_count);

  console.log(`\n===== Weighting ${label} — top ${topN} =====`);
  console.log(
    'rank  score   raw     n      conf   lat,lng                 dominant type'
  );
  top.forEach((r, i) => {
    console.log(
      String(i + 1).padStart(4) + '  ' +
      r.computed_final.toFixed(4) + '  ' +
      r.computed_raw.toFixed(4) + '  ' +
      String(r.complaint_count).padStart(5) + '  ' +
      String(r.confidence_factor ?? 1).padEnd(5) + '  ' +
      `${r.latitude.toFixed(4)}, ${r.longitude.toFixed(4)}`.padEnd(22) + '  ' +
      (r.dominant_request_type ?? '')
    );
  });

  console.log(`\n  Complaint-count profile of top ${topN}:`);
  console.log(`    min: ${Math.min(...counts)}   median: ${median(counts)}   max: ${Math.max(...counts)}`);

  const denseInTop = top.filter((r) => r.complaint_count >= 1000).length;
  console.log(`    locations with n >= 1000 (dense urban core): ${denseInTop}`);

  const lowCorroboration = top.filter(
    (r) => r.complaint_count < CONFIDENCE_THRESHOLD_COMPLAINTS
  ).length;
  console.log(
    `    locations below the confidence threshold (n < ${CONFIDENCE_THRESHOLD_COMPLAINTS}): ${lowCorroboration}`
  );

  return top;
}

function reportSpatialRedundancy(label, top, radiusMeters) {
  const sites = clusterIntoSites(top, radiusMeters);
  console.log(
    `\n  Spatial redundancy (single-link @ ${radiusMeters}m) for ${label}:`
  );
  console.log(
    `    ${top.length} ranked entries collapse into ${sites.length} distinct sites`
  );

  const multi = sites.filter((s) => s.length > 1);
  if (multi.length > 0) {
    console.log(`    sites consuming more than one slot:`);
    multi.forEach((s) => {
      const ranks = s.map((e) => e.rank).join(', ');
      console.log(
        `      ranks ${ranks}  ->  ~${s[0].latitude.toFixed(3)}, ${s[0].longitude.toFixed(3)} (${s.length} slots)`
      );
    });
    const consumed = multi.reduce((sum, s) => sum + s.length, 0);
    console.log(
      `    ${multi.length} sites consume ${consumed} of ${top.length} slots`
    );
  }
}

function reportOverlap(topA, topB, topN) {
  const keysA = new Set(topA.map(locationKey));
  const shared = topB.filter((r) => keysA.has(locationKey(r)));
  console.log(`\n===== Agreement between weightings (top ${topN}) =====`);
  console.log(`  shared locations: ${shared.length} of ${topN}`);
  console.log(
    `  disjoint: ${topN - shared.length} of ${topN} appear under only one weighting`
  );
}

/**
 * The confidence factor is intended to require corroboration before a location
 * is treated as fully reliable. This reports whether it is actually gating: if
 * low-n locations still reach the top of the ranking after the multiplier is
 * applied, the mechanism is not doing the job it was built for.
 */
function reportConfidenceGating(label, top) {
  const belowThreshold = top.filter(
    (r) => r.complaint_count < CONFIDENCE_THRESHOLD_COMPLAINTS
  );

  console.log(`\n  Confidence gating check for ${label}:`);
  if (belowThreshold.length === 0) {
    console.log(
      `    no location with n < ${CONFIDENCE_THRESHOLD_COMPLAINTS} reaches the top ${top.length}`
    );
    return;
  }

  console.log(
    `    ${belowThreshold.length} location(s) with n < ${CONFIDENCE_THRESHOLD_COMPLAINTS} still reach the top ${top.length}:`
  );
  belowThreshold.forEach((r) => {
    const rank = top.indexOf(r) + 1;
    console.log(
      `      rank ${rank}: n=${r.complaint_count}, conf=${r.confidence_factor}, ` +
      `pre-confidence raw=${r.computed_raw.toFixed(4)} -> final=${r.computed_final.toFixed(4)}`
    );
  });
  console.log(
    `    NOTE: a pre-confidence raw score high enough to survive the multiplier ` +
    `means the discount is being out-run, not that it failed to apply.`
  );
}

// ---------------------------------------------------------------
// Main
// ---------------------------------------------------------------

async function main() {
  console.log('=============== WEIGHT SENSITIVITY ANALYSIS ===============');
  console.log(`Top N: ${TOP_N}   Cluster radius: ${CLUSTER_RADIUS_METERS}m`);
  console.log('Both weightings are computed from the SAME cached sub-scores,');
  console.log('so the only variable is the weight vector itself.\n');

  const rows = await fetchAllCacheRows();
  console.log(`Loaded ${rows.length.toLocaleString()} scored grid points from recurrence_cache.`);

  const entries = Object.entries(WEIGHTINGS);
  const tops = {};

  for (const [label, w] of entries) {
    const ranked = rankUnder(rows, w);
    const top = reportRanking(label, ranked, TOP_N);
    reportSpatialRedundancy(label, top, CLUSTER_RADIUS_METERS);
    reportConfidenceGating(label, top);
    tops[label] = top;
  }

  reportOverlap(tops[entries[0][0]], tops[entries[1][0]], TOP_N);

  console.log('\n=============== END ===============');
}

main().catch((err) => {
  console.error(`[Sensitivity Analysis] Failed: ${err.message}`);
  process.exit(1);
});
