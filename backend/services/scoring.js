'use strict';

/**
 * NashAlert Recurrence Scoring Engine
 *
 * Implements the recurrence scoring formula documented in docs/METHODOLOGY.md Section 4:
 *
 *   recurrence_score = (frequency_score  * 0.15)
 *                    + (recency_score    * 0.40)
 *                    + (severity_score   * 0.35)
 *                    + (resolution_score * 0.10)
 *
 * Weight history: an earlier version of this formula used 40/30/20/10, with frequency
 * as the dominant term. That weighting was revised after empirical analysis showed
 * frequency's normalization (count / citywide-max) causes its effective contribution to
 * collapse to near-zero for the large majority of Nashville locations that are not among
 * the highest-volume handful — meaning the stated 40% weight was nominal, not effective,
 * for most of the dataset. Rather than re-engineering the normalization to force frequency's
 * effective share upward (which would make the score more like the raw-volume ranking this
 * project's thesis argues is inadequate — see METHODOLOGY.md Section 4.8), the weights
 * themselves were revised downward for frequency and upward for recency/severity, so the
 * stated weights honestly describe what the formula does: outside a small set of
 * extreme-volume locations, this score is primarily a severity-and-recency measure, with
 * complaint volume as a smaller, capped contributor. See METHODOLOGY.md Section 4.1 and
 * docs/CHANGELOG.md Phase 2.7 for the full before/after analysis.
 *
 * See METHODOLOGY.md Sections 4.1–4.5 for full rationale of each component and weight.
 */

const { getSeverityWeight, DEFAULT_SEVERITY } = require('../constants/severity-weights');

// ---------------------------------------------------------------
// Named constants — never hardcode these values inline
// ---------------------------------------------------------------

// Recency decay half-life: a complaint from 365 days ago counts half as much
// as a complaint filed today. Named constant so the value can be tuned
// systematically and every usage site updates automatically.
const RECENCY_HALF_LIFE_DAYS = 365;

// Derived decay rate: λ = ln(2) / half-life. Using ln(2) ensures that
// Math.exp(-λ * 365) = 0.5 exactly, honoring the 365-day half-life definition.
const RECENCY_LAMBDA = Math.log(2) / RECENCY_HALF_LIFE_DAYS;

// Maximum resolution window: complaints open longer than 730 days (2 years)
// are treated as equally unresolved for scoring purposes. Prevents a handful
// of extremely old open complaints from distorting the average beyond the
// practical range of the 0–1 score.
const MAX_RESOLUTION_DAYS = 730;

// Default resolution score returned when a location has no closed complaints
// with a valid closed_date. 0.5 (neutral mid-range) is used rather than 0
// so that absence of resolution data does not penalize a location. See
// METHODOLOGY.md Section 4.4 for full rationale.
const DEFAULT_RESOLUTION_SCORE = 0.5;

// Fraction of total complaints in a single quarter required for that quarter
// to be declared the dominant seasonal period. 40% means a quarter must
// account for more than 2 out of every 5 complaints.
const SEASONAL_PATTERN_THRESHOLD = 0.40;

// ---------------------------------------------------------------
// Composite formula weights
// ---------------------------------------------------------------
//
// recurrence_score = (frequency_score  * FREQUENCY_WEIGHT)
//                  + (recency_score    * RECENCY_WEIGHT)
//                  + (severity_score   * SEVERITY_WEIGHT)
//                  + (resolution_score * RESOLUTION_WEIGHT)
//
// Revised from the original 40/30/20/10 split. Frequency's sub-score is
// bounded to [0, 1] and reaches 1.0 only at the single busiest location in
// the city; FREQUENCY_WEIGHT is therefore a hard ceiling on how much any one
// location's score can be driven by raw complaint volume alone. It was
// lowered from 0.40 because empirical analysis showed the original weight
// caused two problems: (1) at moderate complaint counts (the large majority
// of Nashville locations), frequency's effective contribution was near-zero,
// making the composite behave as if frequency mattered far less than 40% for
// most of the city; and (2) at the citywide-max location, frequency alone
// accounted for roughly three-quarters of that location's score, making the
// single highest-ranked result in the whole system close to a pure
// volume proxy. Both problems point the same direction: frequency's nominal
// weight was too high relative to what this project's own thesis argues
// (recurring severity and recency, not raw volume, should drive
// prioritization — METHODOLOGY.md Section 4.8). Recency and severity absorb
// the redistributed weight, in roughly the proportion they already carried
// in practice. See METHODOLOGY.md Section 4.1 and 4.5, and CHANGELOG.md
// Phase 2.7, for the full before/after numbers and reasoning.
const FREQUENCY_WEIGHT = 0.15;
const RECENCY_WEIGHT = 0.40;
const SEVERITY_WEIGHT = 0.35;
const RESOLUTION_WEIGHT = 0.10;

// Exponent applied to the (complaintCount / maxComplaintCount) ratio when
// computing the frequency sub-score. See computeFrequencyScore() and
// METHODOLOGY.md Section 4.1 for the full rationale.
//
// Kept at 1.0 (plain linear ratio) deliberately. An earlier revision of this
// file used a square-root exponent (0.5) to raise frequency's effective
// contribution for moderate-volume locations, so that the formula's stated
// 40% frequency weight would hold more uniformly across the city. That
// approach was reverted: raising frequency's effective influence pulls the
// composite score toward the raw-volume ranking this project's thesis
// argues is inadequate (METHODOLOGY.md Section 4.8). Instead, the nominal
// frequency WEIGHT was lowered (see the module-level formula comment above)
// so that the stated weights honestly reflect the formula's real behavior,
// rather than re-engineering the sub-score itself to chase a weight that no
// longer applies. Do not reintroduce a normalization exponent without
// updating this comment and METHODOLOGY.md Section 4.1 together.
const FREQUENCY_NORMALIZATION_EXPONENT = 1.0;

// ---------------------------------------------------------------
// Historical-context priority thresholds (see generateHistoricalContext())
// ---------------------------------------------------------------
//
// These thresholds classify a location as HIGH, MODERATE, or LOW priority for
// the resident-facing historical context message. They are calibrated against
// the actual recurrence_score distribution produced by the CURRENT formula
// weights (Section 4.1/4.5 of METHODOLOGY.md) — not chosen a priori — because
// this composite score is not on an absolute, formula-independent scale: its
// achievable range depends on the weights. When those weights changed
// (Phase 2.7, 40/30/20/10 → 15/40/35/10), the empirical range compressed
// (citywide max dropped from ~0.52 to ~0.54 measured differently — see
// CHANGELOG.md Phase 2.7) enough that the previous thresholds (0.70 / 0.50)
// became unreachable by any real Nashville location, which would have
// silently broken high-priority classification for exactly the locations
// this feature exists to flag. These values were re-derived from a full
// percentile analysis of all 30,979 scored grid points after the Phase 2.7
// batch job run:
//   p90 ≈ 0.240, p95 ≈ 0.257, p97 ≈ 0.269, p99 ≈ 0.301, p99.5 ≈ 0.321,
//   max = 0.540 (min = 0.021, median = 0.193)
// Any future change to FREQUENCY_WEIGHT / RECENCY_WEIGHT / SEVERITY_WEIGHT /
// RESOLUTION_WEIGHT or to FREQUENCY_NORMALIZATION_EXPONENT should be
// followed by re-running this percentile analysis and updating these
// thresholds — they are not independent of the formula weights.

// Score alone qualifies a location as high-priority above this value.
// 0.30 sits just below the 99th percentile (≈ top 1% of scored locations
// citywide) — a deliberately high bar so "high-priority" remains rare and
// meaningful rather than a routine label.
const HIGH_PRIORITY_SCORE_THRESHOLD = 0.30;

// Below HIGH_PRIORITY_SCORE_THRESHOLD, a location is still treated as
// high-priority if it has extreme complaint volume (HIGH_PRIORITY_VOLUME_
// THRESHOLD or more) AND a score above this lower bar. This exists so a
// location like downtown Nashville's busiest cluster (5,547+ complaints)
// is never undersold merely because its severity/recency profile — spread
// across years of aggregate history — pulls its score down relative to a
// small, recent, acute-severity cluster. Empirically, every real Nashville
// location with 1,000+ complaints already scores at or above 0.246 under
// the current formula, so 0.20 is a deliberately generous floor that acts
// as a safety net without being the binding constraint today.
const HIGH_PRIORITY_VOLUME_SCORE_THRESHOLD = 0.20;

// Minimum complaint count for the volume-based high-priority path above.
const HIGH_PRIORITY_VOLUME_THRESHOLD = 1000;

// Moderate-priority score threshold — roughly the 93rd percentile (top ~7%
// of scored locations), paired with MODERATE_COUNT_THRESHOLD below.
const MODERATE_SCORE_THRESHOLD = 0.25;

// Minimum complaint count for the moderate-priority tier. Kept low relative
// to the high-priority volume threshold because moderate priority is meant
// to flag "worth watching," not "extensively corroborated."
const MODERATE_COUNT_THRESHOLD = 10;

// Number of complaints at a location required before the location is treated
// with full scoring confidence. Below this threshold the raw composite score
// is discounted by min(1.0, count / CONFIDENCE_THRESHOLD_COMPLAINTS).
// Rationale: a single isolated complaint — even a high-severity one — provides
// insufficient statistical evidence to rank a location alongside sites with
// thousands of corroborated reports. 5 complaints is the point at which
// the location has been reported independently enough to treat as reliable.
// See computeConfidenceFactor() and METHODOLOGY.md Section 4.7.
const CONFIDENCE_THRESHOLD_COMPLAINTS = 5;

// Minimum number of complaints required to attempt seasonal pattern detection.
// Below 3 complaints, any single-quarter dominance is not meaningful.
const MIN_COMPLAINTS_FOR_PATTERN = 3;

// Canonical 200m scoring radius — the radius used by the batch job and the
// API's cache lookup. Defined here so the scoring service and the API layer
// share a single definition.
const SCORING_RADIUS_METERS = 200;

// Maps raw request_type values (as stored in the database) to plain-English
// labels used in the post-submission historical context string shown to
// mobile app users. Civic and human — no database jargon.
const READABLE_TYPE_LABELS = {
  'Streets, Roads & Sidewalks': 'road and sidewalk',
  'Electric & Water General': 'water and utility',
  'Pothole': 'pothole',
  'Public Works WO': 'road and public works',
  'Street Lighting': 'street lighting',
  'Flooding': 'flooding',
  'Power Lines Down or Low': 'power line',
  'Blocked Drain': 'drainage',
  'Clogged Culvert & Cross Drains': 'drainage',
  'Ditch Maintenance': 'drainage',
  'Repair Storm Drain': 'storm drain',
  'Sidewalks': 'sidewalk',
  'Remove debris in roadway': 'road debris',
  'Traffic Light Issue': 'traffic signal',
};

// ---------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------

/**
 * Clamps a numeric value to the [0, 1] range.
 * All sub-score functions call this before returning to guarantee the
 * composite formula operates on valid inputs.
 *
 * @param {number} value
 * @returns {number}
 */
function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

/**
 * Rounds a number to 4 decimal places using integer arithmetic to avoid
 * floating-point rounding artifacts (e.g. 0.10000000000000001).
 *
 * @param {number} value
 * @returns {number}
 */
function round4(value) {
  return Math.round(value * 10000) / 10000;
}

/**
 * Finds the most frequently occurring value of `field` across `complaints`.
 * When multiple values are tied on count, the tiebreaker is the highest
 * average severity weight (getSeverityWeight applied to each complaint
 * in that group). Returns null if the complaints array is empty.
 *
 * This is used to compute dominant_request_type and dominant_subtype in
 * computeRecurrenceScore. The severity-based tiebreaker ensures that when
 * two complaint types are equally frequent, the more safety-critical type
 * surfaces — consistent with the project's prioritization philosophy.
 *
 * @param {Array<Object>} complaints
 * @param {string}        field        - 'request_type' or 'subtype'
 * @returns {string|null}
 */
function findDominantValue(complaints, field) {
  if (!complaints || complaints.length === 0) return null;

  const groups = {};
  for (const c of complaints) {
    const val = c[field] || '(none)';
    if (!groups[val]) {
      groups[val] = { count: 0, totalSeverity: 0 };
    }
    groups[val].count++;
    groups[val].totalSeverity += getSeverityWeight(c.request_type, c.subtype);
  }

  const maxCount = Math.max(...Object.values(groups).map((g) => g.count));
  const tied = Object.entries(groups).filter(([, g]) => g.count === maxCount);

  if (tied.length === 1) return tied[0][0];

  // Tiebreak by average severity weight — higher severity wins
  let best = null;
  let bestAvg = -1;
  for (const [val, group] of tied) {
    const avg = group.totalSeverity / group.count;
    if (avg > bestAvg) {
      bestAvg = avg;
      best = val;
    }
  }
  return best;
}

// ---------------------------------------------------------------
// Exported scoring functions
// ---------------------------------------------------------------

/**
 * Computes the frequency sub-score for a location.
 *
 * Formula: (complaintCount / maxComplaintCount) ^ FREQUENCY_NORMALIZATION_EXPONENT
 * (the exponent is currently 1.0, i.e. a plain linear ratio — see the
 * constant's own comment for why a square-root correction was tried and reverted)
 *
 * A location reported ten times over three years is structurally more
 * problematic than one reported once last month, regardless of type — this
 * is the intuition frequency is meant to capture. But its FREQUENCY_WEIGHT
 * in the composite formula is deliberately modest (0.15, down from an
 * original 0.40): normalizing by the citywide maximum means frequency's
 * sub-score is near zero for the large majority of Nashville locations that
 * are not among the highest-volume handful, so a low weight keeps the
 * formula's stated behavior honest rather than overstating frequency's
 * real influence. See METHODOLOGY.md Section 4.1 for the full rationale,
 * including why the alternative (raising frequency's effective contribution
 * to match a higher nominal weight) was tried first and rejected.
 *
 * maxComplaintCount is computed once during the nightly batch job — it is
 * the highest complaint count within 200m of any grid point across all of
 * Nashville. This normalization ensures frequency scores are relative to
 * the worst location in the city, not an arbitrary ceiling.
 *
 * @param {number} complaintCount      - Complaints at this location within 200m
 * @param {number} maxComplaintCount   - Highest complaint count at any Nashville grid point
 * @returns {number}                   - Frequency score in [0, 1]
 */
function computeFrequencyScore(complaintCount, maxComplaintCount) {
  if (!maxComplaintCount || maxComplaintCount === 0) return 0;
  if (!complaintCount || complaintCount === 0) return 0;
  const ratio = clamp01(complaintCount / maxComplaintCount);
  return clamp01(Math.pow(ratio, FREQUENCY_NORMALIZATION_EXPONENT));
}

/**
 * Computes the recency sub-score for a set of complaints.
 *
 * Each complaint contributes an exponentially decayed weight based on how
 * many days have elapsed since it was opened:
 *
 *   weight(complaint) = e^(-λ * daysSinceComplaint)
 *   where λ = ln(2) / RECENCY_HALF_LIFE_DAYS (= ln(2) / 365)
 *
 * Half-life of 365 days (one annual cycle).
 * Rationale: Infrastructure degradation in Nashville follows seasonal and annual
 * patterns — a pothole that recurs every year for three years is a structural
 * problem, and complaints from the past 2–3 years are all meaningful signals
 * of persistent failure. A complaint's relevance decays over one full annual
 * cycle, after which it is weighted near-zero but not discarded entirely.
 * This also avoids systematically underweighting older complaint histories
 * in lower-income neighborhoods, which is important for the equity analysis.
 * 90-day and 180-day half-lives were evaluated and rejected: both produced
 * recency scores of 0.02–0.05 across all test locations, making recency
 * a statistical non-contributor despite carrying substantial formula weight
 * (30% at the time of this evaluation; see RECENCY_WEIGHT for the current value).
 *
 * The score is the mean decay weight across all complaints (including those
 * with null dates, which receive weight 0). Dividing by complaint count
 * rather than by the sum of possible weights keeps the score in [0, 1]:
 * a location where every complaint was filed today scores close to 1.0;
 * a location where every complaint was filed years ago scores close to 0.
 *
 * Recency now carries the largest formula weight (RECENCY_WEIGHT = 0.40,
 * revised upward from an original 0.30 — see METHODOLOGY.md Section 4.5 and
 * CHANGELOG.md Phase 2.7), reflecting that a location's real-world urgency
 * is driven more by how recently and severely it has been reported than by
 * raw complaint volume, which is normalized against a citywide maximum and
 * therefore only meaningfully differentiates the handful of highest-volume
 * locations. This score is nonetheless computed relative to complaint
 * "now" at query time — see the recency drift note in METHODOLOGY.md
 * Section 4.6 for why this can cause a cached score to differ slightly from
 * a real-time recomputation of the same location after enough time passes.
 * See METHODOLOGY.md Section 4.2 for full rationale.
 *
 * @param {Array<Object>} complaints - Complaints, each with an `opened_date` field
 * @returns {number}                 - Recency score in [0, 1]
 */
function computeRecencyScore(complaints) {
  if (!complaints || complaints.length === 0) return 0;

  const now = Date.now();
  let weightSum = 0;

  for (const complaint of complaints) {
    if (!complaint.opened_date) {
      // Null opened_date: treat as weight 0 (not skipped — still divides into denominator)
      continue;
    }
    const msElapsed = now - new Date(complaint.opened_date).getTime();
    const daysElapsed = msElapsed / (1000 * 60 * 60 * 24);
    weightSum += Math.exp(-RECENCY_LAMBDA * daysElapsed);
  }

  return clamp01(weightSum / complaints.length);
}

/**
 * Computes the severity sub-score for a set of complaints.
 *
 * Each complaint is assigned a severity weight from the lookup table in
 * backend/constants/severity-weights.js using both its request_type and
 * subtype. The score is the mean severity weight across all complaints.
 *
 * Severity now carries substantial formula weight (SEVERITY_WEIGHT = 0.35,
 * revised upward from an original 0.20 — see METHODOLOGY.md Section 4.5 and
 * CHANGELOG.md Phase 2.7). A location with ten moderate-severity complaints
 * can still be of greater maintenance concern than a location with one
 * high-severity complaint, but severity is no longer a minor tiebreaker: it
 * is one of the two dominant signals (alongside recency) for the large
 * majority of Nashville locations whose frequency sub-score is small
 * relative to the citywide maximum. See METHODOLOGY.md Section 4.3.
 *
 * If the complaints array is empty, the DEFAULT_SEVERITY fallback (0.3) is
 * returned. This prevents the scoring formula from collapsing to zero on
 * the severity axis when no data is available, since 0.3 is the lower
 * boundary of Tier 3 weights — a neutral, non-penalizing default.
 *
 * @param {Array<Object>} complaints - Complaints, each with request_type and subtype fields
 * @returns {number}                 - Severity score in [0, 1]
 */
function computeSeverityScore(complaints) {
  if (!complaints || complaints.length === 0) return DEFAULT_SEVERITY;

  let totalWeight = 0;
  for (const complaint of complaints) {
    totalWeight += getSeverityWeight(complaint.request_type, complaint.subtype);
  }

  return clamp01(totalWeight / complaints.length);
}

/**
 * Computes the resolution sub-score for a set of complaints.
 *
 * Slow resolution is an additional signal of systemic neglect: locations
 * where complaints historically take a long time to close warrant higher
 * priority. The score is:
 *
 *   resolution_score = avgResolutionDays / MAX_RESOLUTION_DAYS
 *
 * A location where complaints sit open for 2 years scores close to 1.0
 * (slow resolution = higher score, signaling systemic neglect). A location
 * where complaints are closed in 10 days on average scores close to 0.0.
 *
 * Only complaints where status === "Closed" AND closed_date is not null are
 * included. All other rows — regardless of status label — are treated as
 * unresolved. This conservative rule is documented in METHODOLOGY.md
 * Section 4.4 (Defining "resolved" for resolution time calculation): it may
 * undercount resolved complaints, but it will not introduce spurious
 * resolution times by inferring closure from ambiguous status strings like
 * "CityWorks In Progress" or "PENDING".
 *
 * Individual resolution times are capped at MAX_RESOLUTION_DAYS (730 days)
 * before averaging. This prevents a handful of decades-old open complaints
 * (which should have been closed but weren't) from inflating the average
 * beyond the meaningful range.
 *
 * If no complaints have a valid closed_date, DEFAULT_RESOLUTION_SCORE (0.5)
 * is returned. Absence of resolution data should not penalize a location —
 * it is a data quality gap, not evidence of good or bad service. 0.5 is a
 * neutral mid-range value that lets frequency, recency, and severity carry
 * the score without the resolution axis adding distortion.
 *
 * Resolution is given the lowest weight (10%) because resolution time data
 * is inconsistently recorded in the Nashville 311 dataset (many complaints
 * have null closed dates) and because slow resolution may reflect complaint
 * complexity rather than neglect. See METHODOLOGY.md Section 4.4.
 *
 * @param {Array<Object>} complaints - Complaints with status, opened_date, closed_date
 * @returns {number}                 - Resolution score in [0, 1]
 */
function computeResolutionScore(complaints) {
  if (!complaints || complaints.length === 0) return DEFAULT_RESOLUTION_SCORE;

  const resolved = complaints.filter(
    (c) => c.status === 'Closed' && c.closed_date != null
  );

  if (resolved.length === 0) return DEFAULT_RESOLUTION_SCORE;

  let totalDays = 0;
  for (const complaint of resolved) {
    const openedMs = new Date(complaint.opened_date).getTime();
    const closedMs = new Date(complaint.closed_date).getTime();
    const days = (closedMs - openedMs) / (1000 * 60 * 60 * 24);
    // Cap at MAX_RESOLUTION_DAYS before averaging — prevents extreme outliers
    // from distorting the mean beyond the [0, 1] normalization range.
    totalDays += Math.min(Math.max(0, days), MAX_RESOLUTION_DAYS);
  }

  const avgDays = totalDays / resolved.length;
  return clamp01(avgDays / MAX_RESOLUTION_DAYS);
}

/**
 * Detects whether complaint activity at a location follows a seasonal pattern.
 *
 * Groups complaints by calendar quarter and checks whether any single quarter
 * accounts for more than SEASONAL_PATTERN_THRESHOLD (40%) of total complaints.
 * If it does, that quarter's season name is returned. If no quarter dominates,
 * "year-round" is returned. If fewer than MIN_COMPLAINTS_FOR_PATTERN (3)
 * complaints exist, "insufficient data" is returned.
 *
 * Quarter-to-season mapping follows Nashville's climate patterns:
 *   Q1 (Jan–Mar) → "winter"   (ice, snow removal, freeze-thaw road damage)
 *   Q2 (Apr–Jun) → "spring"   (post-freeze pothole season, storm drainage)
 *   Q3 (Jul–Sep) → "summer"   (heat-related road buckling, flooding)
 *   Q4 (Oct–Dec) → "fall"     (leaf debris, early freeze)
 *
 * Complaints with null opened_date are excluded from this calculation —
 * they cannot be placed in a quarter. This differs from computeRecencyScore
 * where null dates receive weight 0: here, a null date provides no quarter
 * information and is simply absent from the distribution.
 *
 * @param {Array<Object>} complaints - Complaints, each with an `opened_date` field
 * @returns {string}                 - Season name, "year-round", or "insufficient data"
 */
function computeSeasonalPattern(complaints) {
  if (!complaints || complaints.length === 0) return 'insufficient data';

  const QUARTER_TO_SEASON = {
    1: 'winter',
    2: 'spring',
    3: 'summer',
    4: 'fall',
  };

  const quarterCounts = { 1: 0, 2: 0, 3: 0, 4: 0 };
  let validCount = 0;

  for (const complaint of complaints) {
    if (!complaint.opened_date) continue;
    const month = new Date(complaint.opened_date).getMonth(); // 0-indexed
    const quarter = Math.floor(month / 3) + 1;
    quarterCounts[quarter]++;
    validCount++;
  }

  if (validCount < MIN_COMPLAINTS_FOR_PATTERN) return 'insufficient data';

  let dominantQuarter = null;
  let maxFraction = 0;
  for (const [q, count] of Object.entries(quarterCounts)) {
    const fraction = count / validCount;
    if (fraction > maxFraction) {
      maxFraction = fraction;
      dominantQuarter = parseInt(q, 10);
    }
  }

  if (maxFraction <= SEASONAL_PATTERN_THRESHOLD) return 'year-round';
  return QUARTER_TO_SEASON[dominantQuarter];
}

/**
 * Computes the confidence factor for a location based on its complaint count.
 *
 * Discounts locations with very few complaints to reflect lower statistical
 * reliability, not lower severity. A single high-severity complaint (e.g., a
 * sinkhole) at a sparse outer Nashville grid point should not score comparably
 * to a location with thousands of corroborated complaints simply because its
 * severity weight is high. This modifier requires a minimum level of
 * corroboration before treating a location's score as fully reliable.
 *
 * Locations with 5+ complaints receive no penalty (factor = 1.0).
 * This is NOT a minimum threshold filter — the location still scores and
 * appears in the priority queue; its score is appropriately discounted.
 *
 * Formula: min(1.0, complaint_count / CONFIDENCE_THRESHOLD_COMPLAINTS)
 *   1 complaint  → 0.20 multiplier
 *   2 complaints → 0.40 multiplier
 *   3 complaints → 0.60 multiplier
 *   4 complaints → 0.80 multiplier
 *   5+ complaints → 1.0 multiplier (no penalty)
 *
 * See METHODOLOGY.md Section 4.7 for full rationale.
 *
 * @param {number} complaintCount
 * @returns {number} - Confidence factor in (0, 1]
 */
function computeConfidenceFactor(complaintCount) {
  return Math.min(1.0, complaintCount / CONFIDENCE_THRESHOLD_COMPLAINTS);
}

/**
 * Orchestrates all four sub-score functions and assembles the complete
 * recurrence score result object.
 *
 * Applies the weighted formula:
 *   recurrence_score = (frequency_score * FREQUENCY_WEIGHT)
 *                    + (recency_score   * RECENCY_WEIGHT)
 *                    + (severity_score  * SEVERITY_WEIGHT)
 *                    + (resolution_score * RESOLUTION_WEIGHT)
 *
 * This is the function called by:
 *   1. The nightly batch job (compute-scores.js) — for every Nashville grid point
 *   2. The POST /api/complaints/score endpoint — as a real-time fallback when the
 *      cache is critically stale or has no entry within 200m
 *   3. The POST /api/reports/submit endpoint — to provide the submitter with
 *      historical context about the location they just reported
 *
 * @param {Array<Object>} complaints       - Array of complaint objects from the database
 * @param {number}        maxComplaintCount - City-wide max complaint count (from cache metadata)
 * @returns {Object}                        - Full scoring result (see shape below)
 */
function computeRecurrenceScore(complaints, maxComplaintCount) {
  const safeComplaints = complaints || [];
  const count = safeComplaints.length;

  const frequency_score = computeFrequencyScore(count, maxComplaintCount);
  const recency_score = computeRecencyScore(safeComplaints);
  const severity_score = computeSeverityScore(safeComplaints);
  const resolution_score = computeResolutionScore(safeComplaints);

  const rawScore =
    frequency_score  * FREQUENCY_WEIGHT +
    recency_score    * RECENCY_WEIGHT +
    severity_score   * SEVERITY_WEIGHT +
    resolution_score * RESOLUTION_WEIGHT;

  // Confidence factor discounts locations with insufficient corroboration.
  // Preserving raw_score separately allows sensitivity analysis comparing
  // pre- and post-confidence rankings. See METHODOLOGY.md Section 4.7.
  const confidence_factor = computeConfidenceFactor(count);
  const raw_score         = round4(clamp01(rawScore));
  const recurrence_score  = round4(clamp01(rawScore * confidence_factor));

  // Date range — used in historical context and for display
  let minTs = Infinity;
  let maxTs = -Infinity;
  for (const c of safeComplaints) {
    if (!c.opened_date) continue;
    const ts = new Date(c.opened_date).getTime();
    if (ts < minTs) minTs = ts;
    if (ts > maxTs) maxTs = ts;
  }
  const date_range = {
    earliest: isFinite(minTs) ? new Date(minTs).toISOString() : null,
    latest:   isFinite(maxTs) ? new Date(maxTs).toISOString() : null,
  };

  const dominant_request_type = findDominantValue(safeComplaints, 'request_type');
  const dominant_subtype      = findDominantValue(safeComplaints, 'subtype');
  const seasonal_pattern      = computeSeasonalPattern(safeComplaints);

  return {
    recurrence_score,              // confidence-adjusted final score
    raw_score,                     // pre-confidence formula output (kept for sensitivity analysis)
    confidence_factor:  round4(confidence_factor),
    components: {
      frequency_score:  round4(frequency_score),
      recency_score:    round4(recency_score),
      severity_score:   round4(severity_score),
      resolution_score: round4(resolution_score),
    },
    complaint_count:       count,
    dominant_request_type,
    dominant_subtype,
    date_range,
    seasonal_pattern,
  };
}

/**
 * Generates a plain-English historical context string for display on the
 * mobile app's post-submission screen.
 *
 * The language is civic and human — no raw scores, no decimal numbers, no
 * jargon. The goal is to help a Nashville resident understand whether the
 * location they just reported has a history of similar problems, and if so,
 * how serious that history is.
 *
 * Case logic combines recurrence score AND complaint count so that high-volume
 * locations are never undersold. A location with 5,000+ complaints is
 * unambiguously a serious infrastructure concern regardless of exactly where
 * its composite score falls — labeling it "moderate" would misrepresent the
 * real-world situation to the resident reading the screen. See the
 * HIGH_PRIORITY_* / MODERATE_* threshold constants above computeConfidenceFactor()
 * for how these specific cutoffs were derived from the actual score
 * distribution, and why they must be re-derived if the formula weights change.
 *
 *   - 0 complaints:   straightforward "no history on record" message
 *   - 1–2 complaints: acknowledge the history but note insufficient data
 *   - 3+, HIGH:       score >= HIGH_PRIORITY_SCORE_THRESHOLD (strong score
 *                     regardless of count), OR score >= HIGH_PRIORITY_VOLUME_
 *                     SCORE_THRESHOLD AND count >= HIGH_PRIORITY_VOLUME_THRESHOLD
 *                     (high-volume, meaningful-score safety net)
 *   - 3+, MODERATE:   score >= MODERATE_SCORE_THRESHOLD AND count >=
 *                     MODERATE_COUNT_THRESHOLD, not already HIGH
 *   - 3+, LOW:        everything else
 *
 * @param {Object} scoringResult  - Result from computeRecurrenceScore()
 * @param {number} radiusMeters   - Radius used for the query (for the 0-complaint message)
 * @returns {string}
 */
function generateHistoricalContext(scoringResult, radiusMeters = SCORING_RADIUS_METERS) {
  const {
    complaint_count,
    recurrence_score,
    dominant_request_type,
    date_range,
    seasonal_pattern,
  } = scoringResult;

  if (complaint_count === 0) {
    return `No infrastructure complaints on record within ${radiusMeters}m of this location.`;
  }

  if (complaint_count <= 2) {
    const noun = complaint_count === 1 ? 'complaint' : 'complaints';
    return `This location has ${complaint_count} infrastructure ${noun} on record — not enough history to detect a pattern.`;
  }

  // 3+ complaints — determine readable type label and earliest year
  const rawType = dominant_request_type || '';
  const dominantType = READABLE_TYPE_LABELS[rawType] || rawType.toLowerCase() || 'infrastructure';
  const earliestYear = date_range.earliest
    ? new Date(date_range.earliest).getFullYear()
    : 'recent years';

  // High-priority: strong score alone, OR high volume paired with a meaningful score.
  // The second condition catches locations like downtown Nashville's busiest
  // clusters (5,000+ complaints) that are unambiguously serious concerns even
  // when their score falls short of the score-alone bar. See the threshold
  // constants above for how these specific values were derived.
  const isHighPriority =
    recurrence_score >= HIGH_PRIORITY_SCORE_THRESHOLD ||
    (recurrence_score >= HIGH_PRIORITY_VOLUME_SCORE_THRESHOLD &&
      complaint_count >= HIGH_PRIORITY_VOLUME_THRESHOLD);

  if (isHighPriority) {
    const seasonNote =
      seasonal_pattern !== 'year-round' && seasonal_pattern !== 'insufficient data'
        ? `, with complaints tending to cluster in ${seasonal_pattern}`
        : '';
    return `This is a high-priority location with ${complaint_count} infrastructure complaints on record since ${earliestYear}, mostly ${dominantType} issues${seasonNote}.`;
  }

  // Moderate: meaningful score with at least a handful of complaints.
  // "recurring complaint history" describes the pattern a resident can act on;
  // "moderate complaint history" described a score tier, which is less meaningful.
  if (recurrence_score >= MODERATE_SCORE_THRESHOLD && complaint_count >= MODERATE_COUNT_THRESHOLD) {
    const seasonNote =
      seasonal_pattern !== 'year-round' && seasonal_pattern !== 'insufficient data'
        ? `, tending to spike in ${seasonal_pattern}`
        : '';
    return `This location has a recurring complaint history — ${complaint_count} infrastructure reports since ${earliestYear}, mostly ${dominantType} issues${seasonNote}.`;
  }

  return `This location has a low complaint history — ${complaint_count} infrastructure reports on record since ${earliestYear}.`;
}

module.exports = {
  computeFrequencyScore,
  computeRecencyScore,
  computeSeverityScore,
  computeResolutionScore,
  computeSeasonalPattern,
  computeConfidenceFactor,
  computeRecurrenceScore,
  generateHistoricalContext,
  // Constants exported so other modules (compute-scores.js) can reference them
  RECENCY_HALF_LIFE_DAYS,
  RECENCY_LAMBDA,
  MAX_RESOLUTION_DAYS,
  DEFAULT_RESOLUTION_SCORE,
  SEASONAL_PATTERN_THRESHOLD,
  MIN_COMPLAINTS_FOR_PATTERN,
  SCORING_RADIUS_METERS,
  CONFIDENCE_THRESHOLD_COMPLAINTS,
  FREQUENCY_NORMALIZATION_EXPONENT,
  FREQUENCY_WEIGHT,
  RECENCY_WEIGHT,
  SEVERITY_WEIGHT,
  RESOLUTION_WEIGHT,
  HIGH_PRIORITY_SCORE_THRESHOLD,
  HIGH_PRIORITY_VOLUME_SCORE_THRESHOLD,
  HIGH_PRIORITY_VOLUME_THRESHOLD,
  MODERATE_SCORE_THRESHOLD,
  MODERATE_COUNT_THRESHOLD,
};
