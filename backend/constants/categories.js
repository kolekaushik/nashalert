'use strict';

/**
 * Infrastructure category definitions for NashAlert ingestion and scoring.
 *
 * Source: docs/METHODOLOGY.md Section 1 — Infrastructure Complaint Selection.
 *
 * Inclusion criterion: A complaint is infrastructure-relevant if it describes
 * a physical failure or degradation of public infrastructure that, left
 * unaddressed, poses a risk to public safety, mobility, or environmental health.
 *
 * These sets are used by the ingestion script to decide which rows to insert
 * into the database and which to silently skip. They are also the canonical
 * reference for what "infrastructure" means throughout this project.
 *
 * All values are lowercased so comparisons work regardless of source casing.
 * The ingestion script lowercases request_type before calling isInfrastructureRelevant().
 */

/**
 * Request Type values that are infrastructure-relevant and should be ingested.
 * Drawn directly from METHODOLOGY.md Section 1.
 *
 * Note: 'public works wo' covers both the original 'Public Works WO' spelling
 * and 'Public_Works_WO' (underscore variant), which is normalized to
 * 'Public Works WO' before this lookup is performed.
 * 
 * The list is a good starting point for now but in future we need to bulletproof our 
 * isInfrastructureRelevant function, either through logic or LLM if the request types are not clear
 * or if the request type name or string changes.
 */
const INFRASTRUCTURE_REQUEST_TYPES = new Set([
  'streets, roads & sidewalks',
  'electric & water general',
  'public works wo',
  'pothole',
  'street lighting',
  'blocked drain',
  'clogged culvert & cross drains',
  'ditch maintenance',
  'flooding',
  'repair storm drain',
  'remove debris in roadway',
  'sidewalks',
  'sinkhole',
  'snow and ice removal',
  'traffic light issue',
  'power lines down or low',
]);

/**
 * Request Type values that are resolution statuses misrecorded as request types
 * in the Nashville 311 dataset. Rows with these types must be skipped during
 * ingestion and logged separately — they are not infrastructure complaints,
 * they are artifacts of the city's data entry workflow.
 *
 * See METHODOLOGY.md Section 5.3 and .cursorrules Section 6.
 */
const EXCLUDED_REQUEST_TYPES = new Set([
  'resolved by hubnashville on first call',
]);

/**
 * Returns true if the given request type should be ingested as an
 * infrastructure complaint.
 *
 * @param {string} requestType - Request Type value (lowercased and trimmed before calling)
 * @returns {boolean}
 */
function isInfrastructureRelevant(requestType) {
  return INFRASTRUCTURE_REQUEST_TYPES.has(
    (requestType || '').toLowerCase().trim()
  );
}

/**
 * Returns true if the given request type is a resolution-status value
 * that should be skipped entirely during ingestion.
 *
 * @param {string} requestType - Request Type value (any casing; normalized internally)
 * @returns {boolean}
 */
function isExcluded(requestType) {
  return EXCLUDED_REQUEST_TYPES.has(
    (requestType || '').toLowerCase().trim()
  );
}

module.exports = {
  INFRASTRUCTURE_REQUEST_TYPES,
  EXCLUDED_REQUEST_TYPES,
  isInfrastructureRelevant,
  isExcluded,
};
