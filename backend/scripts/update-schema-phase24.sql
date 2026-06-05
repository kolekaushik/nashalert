-- Phase 2.4: Add confidence_factor and raw_score columns to recurrence_cache
--
-- confidence_factor: the multiplier applied to the raw composite score based on
--   complaint count at the location. Formula: min(1.0, complaint_count / 5).
--   Locations with fewer than 5 complaints are statistically less reliable and
--   receive a proportional discount. 5+ complaints → factor = 1.0 (no penalty).
--
-- raw_score: the composite recurrence score BEFORE the confidence factor is applied.
--   Preserved so researchers can compare pre- and post-confidence rankings and
--   evaluate the effect of the confidence modifier in sensitivity analysis.

ALTER TABLE recurrence_cache
  ADD COLUMN IF NOT EXISTS confidence_factor float8,
  ADD COLUMN IF NOT EXISTS raw_score float8;

COMMENT ON COLUMN recurrence_cache.confidence_factor IS
  'Confidence multiplier applied to raw score based on complaint count. Formula: min(1.0, complaint_count / 5). Locations with fewer than 5 complaints receive a proportional discount; 5+ complaints yields 1.0 (no penalty).';

COMMENT ON COLUMN recurrence_cache.raw_score IS
  'Recurrence score before confidence factor applied. Kept for sensitivity analysis comparing pre- and post-confidence prioritization rankings.';
