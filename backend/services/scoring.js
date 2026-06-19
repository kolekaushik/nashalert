'use strict';

/**
 * NashAlert Recurrence Scoring Engine
 *
 * Implements the recurrence scoring formula documented in docs/METHODOLOGY.md Section 4:
 *
 *   recurrence_score = (frequency_score  * 0.40)
 *                    + (recency_score    * 0.30)
 *                    + (severity_score   * 0.20)
 *                    + (resolution_score * 0.10)
 *
 * Weights reflect the research priority: recurrence over time (frequency + recency = 70%)
 * is more indicative of systemic infrastructure failure than any single complaint's
 * characteristics (severity + resolution = 30%).
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
 * Formula: complaintCount / maxComplaintCount
 *
 * Frequency carries the highest weight (40%) because persistent complaint
 * volume is the strongest signal of systemic infrastructure failure.
 * A location reported ten times over three years is structurally more
 * problematic than one reported once last month, regardless of type.
 * See METHODOLOGY.md Section 4.1 for full rationale.
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
  return clamp01(complaintCount / maxComplaintCount);
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
 * a statistical non-contributor despite carrying 30% formula weight.
 *
 * The score is the mean decay weight across all complaints (including those
 * with null dates, which receive weight 0). Dividing by complaint count
 * rather than by the sum of possible weights keeps the score in [0, 1]:
 * a location where every complaint was filed today scores close to 1.0;
 * a location where every complaint was filed years ago scores close to 0.
 *
 * Recency is weighted at 30% — significant but secondary to frequency,
 * so a single very recent complaint cannot outrank a location with years
 * of persistent history. See METHODOLOGY.md Section 4.2.
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
 * Severity is weighted at only 20% because the project's core goal is to
 * surface persistently problematic locations, not to rank by complaint type.
 * A location with ten moderate-severity complaints is of greater maintenance
 * concern than a location with one high-severity complaint that was resolved.
 * Severity nonetheless provides a meaningful tiebreaker: two equally frequent
 * locations should be differentiated by the nature of their failures.
 * See METHODOLOGY.md Section 4.3.
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
 *   recurrence_score = (frequency_score * 0.40)
 *                    + (recency_score   * 0.30)
 *                    + (severity_score  * 0.20)
 *                    + (resolution_score * 0.10)
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
    frequency_score * 0.40 +
    recency_score   * 0.30 +
    severity_score  * 0.20 +
    resolution_score * 0.10;

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
 * locations are never undersold. A location with 5,000+ complaints and a score
 * of 0.59 is unambiguously a serious infrastructure concern — labeling it
 * "moderate" because its composite score falls below 0.70 misrepresents the
 * real-world situation to the resident reading the screen.
 *
 *   - 0 complaints:   straightforward "no history on record" message
 *   - 1–2 complaints: acknowledge the history but note insufficient data
 *   - 3+, HIGH:       score >= 0.70 (strong score regardless of count), OR
 *                     score >= 0.50 AND count >= 1000 (high-volume, high-score)
 *   - 3+, MODERATE:   score >= 0.40 AND count >= 10, not already HIGH
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
  // The second condition catches locations like Downtown Nashville (5,177 complaints,
  // score 0.59) that score just below 0.70 but are unambiguously serious concerns.
  const isHighPriority =
    recurrence_score >= 0.70 ||
    (recurrence_score >= 0.50 && complaint_count >= 1000);

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
  if (recurrence_score >= 0.40 && complaint_count >= 10) {
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
};
