'use strict';

/**
 * NashAlert Weight-Space Sweep — Rank Stability Analysis
 *
 * Measures how sensitive the priority ranking is to the recurrence score's
 * weight vector. This exists to test, rather than assert, the claim in
 * METHODOLOGY.md Section 4.9 that the weight choice is underdetermined: if
 * small perturbations of the weights barely move the ranking and only a large
 * jump reorders it, then the weights are locally well-behaved and the strong
 * form of that claim does not hold.
 *
 * TWO METHODOLOGICAL CHOICES, both deliberate:
 *
 * 1. METRIC: top-k set overlap, not a full-list rank correlation.
 *    Kendall's tau over all ~31,000 cells would read deceptively high. The
 *    distribution's middle is highly compressed (median 0.193, p75 0.217 — see
 *    Section 4.8), so the vast majority of cells barely move relative to each
 *    other under any reweighting, and they would dominate a full-list
 *    correlation while being invisible to any actual user. A planner only ever
 *    sees the top of the queue, so the metric is overlap among the top k.
 *
 * 2. UNIT: deduplicated sites, not grid cells.
 *    Ranking cells makes the metric hostage to whether a six-cell site
 *    reshuffles internally, which is meaningless — the same place either way.
 *    Each ranking is therefore deduplicated into distinct sites before
 *    comparison, and two sites are considered "the same site" across two
 *    rankings if their representative points fall within the dedup radius
 *    (a different member cell of one site may win under a different weighting).
 *
 * WHY DEDUP IS GREEDY (non-maximum suppression) RATHER THAN GLOBAL CLUSTERING:
 * the cache is a contiguous 200m grid, so single-link clustering of *all* cells
 * at any radius >= 200m chains transitively across the whole developed area and
 * collapses Nashville into one or two giant blobs. Dedup must therefore run
 * within a ranking: walk the ranked cells from the top and claim a cell as a new
 * site only if it is farther than the dedup radius from every site already
 * claimed. This is deterministic, depends on the weighting only through the
 * ranking itself, and yields exactly "the top k distinct places" that a
 * deduplicated queue would show.
 *
 * SITE-MATCHING RULE (how "the same site" is decided across two rankings):
 * greedy one-to-one nearest-available matching within the match radius. For
 * each site in ranking A, in rank order, scan ranking B's sites in rank order
 * and claim the first not-yet-claimed site lying within the match radius; a
 * claimed site cannot be matched again. Overlap is the number of successful
 * matches divided by k. The one-to-one constraint matters: without it, a single
 * site in B sitting near several of A's sites would be counted as the
 * counterpart of each, inflating overlap. Matching is by proximity rather than
 * exact coordinates because a different member cell of the same site may be the
 * top-ranked representative under a different weighting. The match radius
 * defaults to the dedup radius, which keeps the rule self-consistent: sites
 * within one ranking are by construction more than that distance apart, so a
 * match is never ambiguous between two sites of the same ranking.
 *
 * Three sweeps are run:
 *   - PATH: linear interpolation from weighting A (40/30/20/10) to weighting B
 *     (15/40/35/10), reporting overlap between adjacent steps (are neighbors
 *     stable?) and against both anchors (where does the regime change?).
 *   - LOCAL: each component of each anchor perturbed by +/- a small delta, with
 *     the remaining weights rescaled to preserve sum = 1, reporting overlap
 *     against the unperturbed anchor.
 *   - RADIUS: the above stability findings re-measured across dedup radii, since
 *     the radius is a free parameter that the site-level conclusions depend on.
 *     Rankings are memoized because a ranking does not depend on the radius —
 *     only the deduplication does — so this sweep is nearly free.
 *
 * Usage:  node scripts/weight-sweep.js [k] [dedupRadiusMeters] [pathSteps]
 * Default: k = 20, dedupRadiusMeters = 500, pathSteps = 20
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const {
  fetchAllCacheRows,
  scoreUnder,
  haversineMeters,
} = require('./weight-sensitivity-analysis');

// ---------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------

const ANCHOR_A = { frequency: 0.40, recency: 0.30, severity: 0.20, resolution: 0.10 };
const ANCHOR_B = { frequency: 0.15, recency: 0.40, severity: 0.35, resolution: 0.10 };

const TOP_K = Number(process.argv[2]) || 20;
const DEDUP_RADIUS_METERS = Number(process.argv[3]) || 500;
const PATH_STEPS = Number(process.argv[4]) || 20;

// Perturbation magnitude for the local-stability sweep. 0.05 is a meaningful
// fraction of every weight in play (a third of frequency's 0.15 under anchor B)
// while remaining small relative to the A-to-B distance, so it tests "would a
// slightly different judgment call change the output?" rather than re-running
// the A-vs-B comparison.
const PERTURBATION = 0.05;

const COMPONENTS = ['frequency', 'recency', 'severity', 'resolution'];

// Dedup radii tested in the radius sweep. The grid is spaced ~200m in latitude
// and ~162m in longitude at Nashville's latitude, so radii at or below ~200m
// are degenerate — they fail to merge cells that are adjacent in longitude but
// not in latitude — and 150m is included precisely to show that under-merging.
const RADIUS_SWEEP_METERS = [150, 250, 350, 500, 750, 1000, 1500, 2000];

// A location is "dense" if it sits in the high-volume urban core. Used to
// locate the regime change along the interpolation path.
const DENSE_COMPLAINT_THRESHOLD = 1000;

// ---------------------------------------------------------------
// Weight vector construction
// ---------------------------------------------------------------

function interpolate(a, b, t) {
  const w = {};
  for (const c of COMPONENTS) w[c] = a[c] + (b[c] - a[c]) * t;
  return w;
}

/**
 * Shifts one component by delta and rescales the others so the vector still
 * sums to 1. Without the rescale, a perturbation would also change the total
 * weight, conflating "different balance" with "different scale."
 */
function perturb(anchor, component, delta) {
  const shifted = Math.min(1, Math.max(0, anchor[component] + delta));
  const others = COMPONENTS.filter((c) => c !== component);
  const othersSum = others.reduce((s, c) => s + anchor[c], 0);

  const w = { [component]: shifted };
  const target = 1 - shifted;
  for (const c of others) {
    w[c] = othersSum === 0 ? target / others.length : anchor[c] * (target / othersSum);
  }
  return w;
}

function formatWeights(w) {
  return COMPONENTS.map((c) => w[c].toFixed(3)).join('/');
}

// ---------------------------------------------------------------
// Ranking and deduplication
// ---------------------------------------------------------------

function rankCells(rows, w) {
  return rows
    .map((row) => ({ row, score: scoreUnder(row, w).final }))
    .sort((a, b) => b.score - a.score);
}

/**
 * Memoized ranking, keyed by the weight vector. A ranking is independent of the
 * dedup radius, so caching lets the radius sweep reuse rankings computed for the
 * path and local sweeps instead of recomputing ~130 of them.
 */
const rankingCache = new Map();

function rankingFor(rows, w) {
  const key = formatWeights(w);
  if (!rankingCache.has(key)) rankingCache.set(key, rankCells(rows, w));
  return rankingCache.get(key);
}

/**
 * Greedy spatial non-maximum suppression. Walks the ranked cells from the top
 * and claims a cell as a new site only if it is farther than radiusMeters from
 * every already-claimed site. See the header for why global clustering is not
 * usable here.
 */
function topSites(rankedCells, k, radiusMeters) {
  const sites = [];

  for (const { row, score } of rankedCells) {
    if (sites.length >= k) break;

    const isNewSite = sites.every(
      (s) =>
        haversineMeters(s.latitude, s.longitude, row.latitude, row.longitude) >
        radiusMeters
    );

    if (isNewSite) {
      sites.push({
        latitude: row.latitude,
        longitude: row.longitude,
        complaint_count: row.complaint_count,
        score,
      });
    }
  }

  return sites;
}

/**
 * Fraction of sitesA that have a distinct counterpart within radiusMeters in
 * sitesB. Greedy one-to-one matching prevents a single site in B from being
 * counted as the counterpart of several sites in A.
 */
function overlapAtK(sitesA, sitesB, radiusMeters) {
  const claimed = new Set();
  let matched = 0;

  for (const a of sitesA) {
    for (let j = 0; j < sitesB.length; j++) {
      if (claimed.has(j)) continue;
      const d = haversineMeters(
        a.latitude, a.longitude, sitesB[j].latitude, sitesB[j].longitude
      );
      if (d <= radiusMeters) {
        claimed.add(j);
        matched++;
        break;
      }
    }
  }

  return matched / Math.max(1, Math.min(sitesA.length, sitesB.length));
}

function median(nums) {
  if (nums.length === 0) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

// ---------------------------------------------------------------
// Sweeps
// ---------------------------------------------------------------

function runPathSweep(rows, k, radius, steps) {
  console.log(`\n================ PATH SWEEP: A -> B ================`);
  console.log(`Interpolating 40/30/20/10 -> 15/40/35/10 in ${steps} steps.`);
  console.log(`Overlap is measured over top-${k} deduplicated sites @ ${radius}m.\n`);

  const anchorASites = topSites(rankingFor(rows, ANCHOR_A), k, radius);
  const anchorBSites = topSites(rankingFor(rows, ANCHOR_B), k, radius);

  console.log(
    't      weights (f/rc/sv/rs)      vs_prev  vs_A   vs_B   dense_sites  median_n'
  );

  let prevSites = null;

  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const w = interpolate(ANCHOR_A, ANCHOR_B, t);
    const sites = topSites(rankingFor(rows, w), k, radius);

    const vsPrev = prevSites ? overlapAtK(sites, prevSites, radius) : null;
    const vsA = overlapAtK(sites, anchorASites, radius);
    const vsB = overlapAtK(sites, anchorBSites, radius);
    const dense = sites.filter(
      (s) => s.complaint_count >= DENSE_COMPLAINT_THRESHOLD
    ).length;
    const medN = median(sites.map((s) => s.complaint_count));

    console.log(
      t.toFixed(2).padEnd(6) + ' ' +
      formatWeights(w).padEnd(25) + ' ' +
      (vsPrev === null ? '  --  ' : vsPrev.toFixed(2).padStart(6)) + '  ' +
      vsA.toFixed(2).padStart(5) + '  ' +
      vsB.toFixed(2).padStart(5) + '  ' +
      String(dense).padStart(11) + '  ' +
      String(medN).padStart(8)
    );

    prevSites = sites;
  }

  console.log(
    `\n  vs_prev = overlap with the previous step (adjacent-vector stability)`
  );
  console.log(`  dense_sites = top-${k} sites with n >= ${DENSE_COMPLAINT_THRESHOLD}`);
}

function runLocalSweep(rows, k, radius) {
  console.log(`\n================ LOCAL PERTURBATION SWEEP ================`);
  console.log(
    `Each component shifted by +/-${PERTURBATION}, others rescaled to keep sum = 1.`
  );
  console.log(`Overlap measured over top-${k} deduplicated sites @ ${radius}m.\n`);

  for (const [label, anchor] of [['A (40/30/20/10)', ANCHOR_A], ['B (15/40/35/10)', ANCHOR_B]]) {
    const anchorSites = topSites(rankingFor(rows, anchor), k, radius);
    console.log(`--- Anchor ${label} ---`);
    console.log('perturbation           weights (f/rc/sv/rs)      overlap_vs_anchor');

    const overlaps = [];

    for (const component of COMPONENTS) {
      for (const delta of [-PERTURBATION, PERTURBATION]) {
        const w = perturb(anchor, component, delta);
        const sites = topSites(rankingFor(rows, w), k, radius);
        const ov = overlapAtK(sites, anchorSites, radius);
        overlaps.push(ov);

        const sign = delta > 0 ? '+' : '-';
        console.log(
          `${component} ${sign}${Math.abs(delta).toFixed(2)}`.padEnd(22) + ' ' +
          formatWeights(w).padEnd(25) + ' ' +
          ov.toFixed(2).padStart(10)
        );
      }
    }

    const min = Math.min(...overlaps);
    const mean = overlaps.reduce((s, o) => s + o, 0) / overlaps.length;
    console.log(
      `  -> mean overlap ${mean.toFixed(3)}, worst case ${min.toFixed(3)} ` +
      `across ${overlaps.length} perturbations\n`
    );
  }
}

function reportSiteTables(rows, k, radius) {
  console.log(`\n================ DEDUPLICATED TOP-${k} SITES ================`);
  console.log(
    `Dedup radius ${radius}m. "n" is the complaint count of the representative`
  );
  console.log(
    `cell — the highest-scoring cell of the site under that weighting — not the`
  );
  console.log(`sum over the site's cells.\n`);

  for (const [label, w] of [['A (40/30/20/10)', ANCHOR_A], ['B (15/40/35/10)', ANCHOR_B]]) {
    const sites = topSites(rankingFor(rows, w), k, radius);
    console.log(`--- Weighting ${label} ---`);
    console.log('rank  score    n      representative lat,lng');
    sites.forEach((s, i) => {
      console.log(
        String(i + 1).padStart(4) + '  ' +
        s.score.toFixed(4) + '  ' +
        String(s.complaint_count).padStart(5) + '   ' +
        `${s.latitude.toFixed(4)}, ${s.longitude.toFixed(4)}`
      );
    });
    const counts = sites.map((s) => s.complaint_count);
    console.log(
      `  n: min ${Math.min(...counts)}, median ${median(counts)}, max ${Math.max(...counts)}` +
      `   |   sites with n >= ${DENSE_COMPLAINT_THRESHOLD}: ` +
      `${sites.filter((s) => s.complaint_count >= DENSE_COMPLAINT_THRESHOLD).length}\n`
    );
  }
}

/**
 * The dedup radius is a free parameter, and the site-level conclusions (A-vs-B
 * overlap and local stability) are stated in terms of it. This re-measures both
 * across a range of radii so the conclusions are not resting on one choice.
 */
function runRadiusSweep(rows, k, radii) {
  console.log(`\n================ DEDUP RADIUS SWEEP ================`);
  console.log(
    `Re-measuring the site-level findings across dedup radii, at k=${k}.`
  );
  console.log(
    `Match radius tracks the dedup radius (see the site-matching rule in the header).\n`
  );
  console.log(
    'radius   A_vs_B   localA_mean  localA_worst  localB_mean  localB_worst  denseA  denseB'
  );

  for (const radius of radii) {
    const aSites = topSites(rankingFor(rows, ANCHOR_A), k, radius);
    const bSites = topSites(rankingFor(rows, ANCHOR_B), k, radius);
    const aVsB = overlapAtK(aSites, bSites, radius);

    const localStats = [ANCHOR_A, ANCHOR_B].map((anchor) => {
      const anchorSites = topSites(rankingFor(rows, anchor), k, radius);
      const overlaps = [];
      for (const component of COMPONENTS) {
        for (const delta of [-PERTURBATION, PERTURBATION]) {
          const sites = topSites(
            rankingFor(rows, perturb(anchor, component, delta)), k, radius
          );
          overlaps.push(overlapAtK(sites, anchorSites, radius));
        }
      }
      return {
        mean: overlaps.reduce((s, o) => s + o, 0) / overlaps.length,
        worst: Math.min(...overlaps),
      };
    });

    const denseA = aSites.filter(
      (s) => s.complaint_count >= DENSE_COMPLAINT_THRESHOLD
    ).length;
    const denseB = bSites.filter(
      (s) => s.complaint_count >= DENSE_COMPLAINT_THRESHOLD
    ).length;

    console.log(
      `${radius}m`.padEnd(8) + ' ' +
      aVsB.toFixed(2).padStart(6) + '   ' +
      localStats[0].mean.toFixed(3).padStart(11) + '  ' +
      localStats[0].worst.toFixed(3).padStart(12) + '  ' +
      localStats[1].mean.toFixed(3).padStart(11) + '  ' +
      localStats[1].worst.toFixed(3).padStart(12) + '  ' +
      String(denseA).padStart(6) + '  ' +
      String(denseB).padStart(6)
    );
  }

  console.log(
    `\n  A_vs_B = top-${k} site overlap between the two anchor weightings`
  );
  console.log(
    `  localX_mean/worst = overlap vs anchor X across 8 +/-${PERTURBATION} perturbations`
  );
  console.log(`  denseX = top-${k} sites with n >= ${DENSE_COMPLAINT_THRESHOLD} under anchor X`);
}

// ---------------------------------------------------------------
// Main
// ---------------------------------------------------------------

async function main() {
  console.log('=============== WEIGHT-SPACE SWEEP ===============');
  console.log(`k = ${TOP_K}   dedup radius = ${DEDUP_RADIUS_METERS}m   path steps = ${PATH_STEPS}`);

  const rows = await fetchAllCacheRows();
  console.log(`Loaded ${rows.length.toLocaleString()} scored grid points.`);

  reportSiteTables(rows, TOP_K, DEDUP_RADIUS_METERS);
  runPathSweep(rows, TOP_K, DEDUP_RADIUS_METERS, PATH_STEPS);
  runLocalSweep(rows, TOP_K, DEDUP_RADIUS_METERS);
  runRadiusSweep(rows, TOP_K, RADIUS_SWEEP_METERS);

  console.log('=============== END ===============');
}

main().catch((err) => {
  console.error(`[Weight Sweep] Failed: ${err.message}`);
  process.exit(1);
});
