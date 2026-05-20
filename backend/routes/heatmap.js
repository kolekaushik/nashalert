'use strict';

/**
 * Heatmap endpoints — serves precomputed recurrence scores for the
 * dashboard map as the user pans and zooms.
 *
 * GET /api/heatmap/bounds returns all cache entries within the current
 * map viewport bounding box. The dashboard calls this endpoint on every
 * map move event (debounced). Returning only visible-area points keeps
 * payload size proportional to zoom level.
 */

const express = require('express');
const { getCachedScoresInBounds, getCacheStatus } = require('../services/cache');

const router = express.Router();

// Approximate Nashville region bounds used to reject clearly out-of-range
// bounding box requests before querying the database.
const NASHVILLE_BOUNDS = {
  LAT_MIN: 35.9,
  LAT_MAX: 36.5,
  LNG_MIN: -87.2,
  LNG_MAX: -86.4,
};

// ---------------------------------------------------------------
// GET /api/heatmap/bounds
// ---------------------------------------------------------------
// Returns all recurrence_cache entries within the given bounding box.
// Primary endpoint for the dashboard heatmap layer.
// ---------------------------------------------------------------
router.get('/bounds', async (req, res, next) => {
  try {
    const { sw_lat, sw_lng, ne_lat, ne_lng } = req.query;
    const errors = validateBoundsParams(req.query);

    if (errors.length > 0) {
      return res.status(400).json({ success: false, error: errors.join('; ') });
    }

    const swLat = parseFloat(sw_lat);
    const swLng = parseFloat(sw_lng);
    const neLat = parseFloat(ne_lat);
    const neLng = parseFloat(ne_lng);

    const [points, cacheStatus] = await Promise.all([
      getCachedScoresInBounds(swLat, swLng, neLat, neLng),
      getCacheStatus(),
    ]);

    if (cacheStatus.isStale && !cacheStatus.isCriticallyStale) {
      console.warn(
        `[Cache Warning] Cache is ${cacheStatus.ageHours}h old — nightly job may have failed`
      );
    }

    const formatted = points.map((p) => ({
      lat:                  p.latitude,
      lng:                  p.longitude,
      recurrence_score:     p.recurrence_score,
      complaint_count:      p.complaint_count,
      dominant_request_type: p.dominant_request_type,
      seasonal_pattern:     p.seasonal_pattern,
    }));

    return res.json({
      success: true,
      data: {
        points:          formatted,
        count:           formatted.length,
        cache_age_hours: cacheStatus.isCriticallyStale ? null : cacheStatus.ageHours,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------
// Validation
// ---------------------------------------------------------------

function validateBoundsParams(query) {
  const errors = [];
  const { sw_lat, sw_lng, ne_lat, ne_lng } = query;

  const swLat = parseFloat(sw_lat);
  const swLng = parseFloat(sw_lng);
  const neLat = parseFloat(ne_lat);
  const neLng = parseFloat(ne_lng);

  if (isNaN(swLat) || isNaN(swLng) || isNaN(neLat) || isNaN(neLng)) {
    errors.push('sw_lat, sw_lng, ne_lat, and ne_lng are all required and must be numbers');
    return errors;
  }

  if (swLat >= neLat) {
    errors.push('sw_lat must be less than ne_lat');
  }

  if (swLng >= neLng) {
    errors.push('sw_lng must be less than ne_lng');
  }

  // Reject requests outside the Nashville region to prevent scanning the
  // entire database for a bounding box that can't contain any Nashville data.
  if (
    neLat < NASHVILLE_BOUNDS.LAT_MIN || swLat > NASHVILLE_BOUNDS.LAT_MAX ||
    neLng < NASHVILLE_BOUNDS.LNG_MIN || swLng > NASHVILLE_BOUNDS.LNG_MAX
  ) {
    errors.push(
      `Bounding box is outside the Nashville region ` +
      `(lat ${NASHVILLE_BOUNDS.LAT_MIN}–${NASHVILLE_BOUNDS.LAT_MAX}, ` +
      `lng ${NASHVILLE_BOUNDS.LNG_MIN}–${NASHVILLE_BOUNDS.LNG_MAX})`
    );
  }

  return errors;
}

module.exports = router;
