'use strict';

/**
 * Severity weight lookup table for NashAlert's recurrence scoring engine.
 *
 * Source: docs/METHODOLOGY.md Section 3 — Full Severity Weight Table.
 * Every entry in this file corresponds to a row in that table.
 * Do not add, remove, or change weights without updating METHODOLOGY.md
 * and recording the change in docs/CHANGELOG.md.
 *
 * Lookup key format: "requestType:subtype" — both values lowercased and trimmed.
 * Example: "electric & water general:sinkhole"
 *
 * Weight scale: 0.0 – 1.0
 *   Tier 1 (Critical / Public Safety):     0.85 – 1.0
 *   Tier 2 (High / Structural):            0.65 – 0.84
 *   Tier 3 (Medium / Usability):           0.40 – 0.64
 *
 * Fallback behavior (see getSeverityWeight):
 *   1. Try "requestType:subtype"
 *   2. Try "requestType:(none)"  — for complaints with no subtype filed
 *   3. Return DEFAULT_SEVERITY (0.3)
 */

const SEVERITY_WEIGHTS = {

  // ---------------------------------------------------------------
  // Tier 1 — Critical / Public Safety (0.85 – 1.0)
  // ---------------------------------------------------------------

  // Rationale: Structural collapse hazard; indicates major subsurface failure
  'electric & water general:sinkhole': 1.0,

  // Rationale: Compromises emergency fire response capability
  'electric & water general:broken fire hydrant': 0.95,

  // Rationale: Public health; affects drinking water access
  'electric & water general:water outage': 0.95,

  // Rationale: Affects essential services; safety risk in extreme weather
  'electric & water general:power outage': 0.90,

  // Rationale: Immediate electrocution and fire hazard
  'electric & water general:power lines down/low': 0.90,

  // Rationale: Same as above; direct-filed variant of the power lines complaint type
  'power lines down or low:power lines down/low': 0.90,

  // Rationale: Open or damaged manholes are fall and vehicle hazards
  'electric & water general:repair manhole': 0.85,

  // Rationale: Sewer failures pose direct public health and environmental risk
  'electric & water general:sewer service line assistance request': 0.85,

  // ---------------------------------------------------------------
  // Tier 2 — High / Structural Infrastructure (0.65 – 0.84)
  // ---------------------------------------------------------------

  // Rationale: Structural failure risk; catastrophic rather than incremental consequence
  'streets, roads & sidewalks:bridge damage': 0.80,

  // Rationale: Renders infrastructure impassable; escalates rapidly in rain events
  'electric & water general:flooding issues': 0.80,

  // Rationale: Direct-filed flooding complaint; same rationale as above
  'flooding:flooding issues': 0.80,

  // Rationale: Same; filed via Public Works channel
  'public works wo:flooding issues': 0.80,

  // Rationale: Precursor to flooding; acute risk during rain
  'blocked drain:blocked drain': 0.75,

  // Rationale: Same; utility-channel filing
  'electric & water general:blocked drain': 0.75,

  // Rationale: Stormwater system failure; flooding risk
  'clogged culvert & cross drains:clogged culvert': 0.75,

  // Rationale: Same; utility-channel filing
  'electric & water general:clogged culvert': 0.75,

  // Rationale: Direct stormwater infrastructure failure
  'repair storm drain:repair storm drain': 0.75,

  // Rationale: Same; utility-channel filing
  'electric & water general:repair storm drain': 0.75,

  // Rationale: Drainage maintenance failure; flooding precursor
  'ditch maintenance:clean ditches': 0.70,

  // Rationale: Indicates subsurface or embankment instability over time
  'electric & water general:erosion complaints': 0.70,

  // Rationale: Environmental and drainage infrastructure impact
  'electric & water general:construction site runoff': 0.70,

  // Rationale: Environmental health; stormwater system integrity
  'electric & water general:stormwater pollution': 0.70,

  // Rationale: Road surface failure; vehicle damage and injury risk
  'streets, roads & sidewalks:potholes': 0.65,

  // Rationale: Direct-filed variant; same rationale as above
  'pothole:potholes': 0.65,

  // Rationale: Same; filed via Public Works channel
  'public works wo:potholes': 0.65,

  // Rationale: Similar to pothole in consequence; road surface failure
  'streets, roads & sidewalks:dip/bump in roadway': 0.65,

  // ---------------------------------------------------------------
  // Tier 3 — Medium / Usability (0.40 – 0.64)
  // ---------------------------------------------------------------

  // Rationale: Safety risk at intersections; high volume suggests many partial failures
  'streets, roads & sidewalks:traffic light issue': 0.60,

  // Rationale: Same; filed via Public Works channel
  'public works wo:traffic light issue': 0.60,

  // Rationale: Direct-filed variant; same rationale
  'traffic light issue:traffic light issue': 0.60,

  // Rationale: Structural safety barrier; failure increases accident severity
  'streets, roads & sidewalks:guard rails': 0.60,

  // Rationale: Road safety during weather events; time-sensitive
  'streets, roads & sidewalks:snow and ice removal': 0.55,

  // Rationale: Accessibility and pedestrian safety; disproportionate impact on car-free residents
  'streets, roads & sidewalks:sidewalks': 0.50,

  // Rationale: Direct-filed variant; same rationale
  'sidewalks:sidewalks': 0.50,

  // Rationale: Safety concern in pedestrian corridors; not acutely dangerous
  'street lighting:street lighting': 0.50,

  // Rationale: Same; filed via Public Works channel
  'public works wo:street lighting': 0.50,

  // Rationale: Road hazard; severity depends on debris type
  'streets, roads & sidewalks:remove debris in roadway': 0.45,

  // Rationale: Direct-filed variant; same rationale
  'remove debris in roadway:remove debris in roadway': 0.45,

  // Rationale: Often inconvenience rather than failure; lowest infrastructure weight
  'streets, roads & sidewalks:roadwork complaint': 0.40,

  // Rationale: Same; filed via Public Works channel
  'public works wo:roadwork complaint': 0.40,
};

/**
 * Fallback severity score for complaint type + subtype combinations
 * not listed in SEVERITY_WEIGHTS. Sits at the lower bound of Tier 3
 * (0.3) — below the lowest explicitly scored combination — so that
 * unknown types influence the score without dominating it.
 * See METHODOLOGY.md Section 5.2 for rationale.
 */
const DEFAULT_SEVERITY = 0.3;

/**
 * Look up the severity weight for a given request type and subtype.
 *
 * Lookup order:
 *   1. Exact match on "requestType:subtype"
 *   2. Fallback to "requestType:(none)" — handles complaints filed
 *      without a subtype where the request type alone has a known weight
 *   3. Return DEFAULT_SEVERITY if neither key exists
 *
 * @param {string} requestType - The complaint's request type (any casing/whitespace; normalized internally)
 * @param {string} subtype     - The complaint's subtype (any casing/whitespace; normalized internally)
 * @returns {number}           - Severity weight between 0.0 and 1.0
 */
function getSeverityWeight(requestType, subtype) {
  const normalizedType = (requestType || '').toLowerCase().trim();
  const normalizedSubtype = (subtype || '').toLowerCase().trim();

  const exactKey = `${normalizedType}:${normalizedSubtype}`;
  if (SEVERITY_WEIGHTS[exactKey] !== undefined) {
    return SEVERITY_WEIGHTS[exactKey];
  }

  const noneKey = `${normalizedType}:(none)`;
  if (SEVERITY_WEIGHTS[noneKey] !== undefined) {
    return SEVERITY_WEIGHTS[noneKey];
  }

  return DEFAULT_SEVERITY;
}

module.exports = { SEVERITY_WEIGHTS, DEFAULT_SEVERITY, getSeverityWeight };
