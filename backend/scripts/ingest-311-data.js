'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse');
const { supabaseAdmin } = require('../services/supabase');
const { isInfrastructureRelevant, isExcluded } = require('../constants/categories');

const CSV_PATH = path.join(__dirname, '../../data/311_complaints.csv');
const BATCH_SIZE = 500;
const LOG_INTERVAL = 2000;

/**
 * Normalize a raw request type value from the CSV.
 * Converts 'Public_Works_WO' (underscore variant) to 'Public Works WO'.
 * All other values are returned trimmed but with original casing preserved
 * for storage. See METHODOLOGY.md Section 5.1.
 */
function normalizeRequestType(raw) {
  const trimmed = (raw || '').trim();
  if (trimmed === 'Public_Works_WO') return 'Public Works WO';
  return trimmed;
}

/**
 * Normalize a subtype value. Null, empty, or whitespace-only subtypes
 * are stored as the sentinel string '(none)'.
 * See METHODOLOGY.md Section 5.2.
 */
function normalizeSubtype(raw) {
  const trimmed = (raw || '').trim();
  return trimmed.length > 0 ? trimmed : '(none)';
}

/**
 * Parse a date string from the CSV into an ISO 8601 string suitable
 * for Supabase / PostgreSQL timestamptz. Returns null if the value is
 * missing or unparseable.
 */
function parseDate(raw) {
  if (!raw || raw.trim() === '') return null;
  const d = new Date(raw.trim());
  return isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * Build the WKT string for a PostGIS geography point.
 * Format: SRID=4326;POINT(longitude latitude)
 * The EWKT prefix tells PostGIS which spatial reference system to use.
 * Note: POINT(X Y) = POINT(longitude latitude) — X is the east-west axis.
 * Supabase accepts this string directly in the geography column via upsert.
 */
function buildLocationEWKT(longitude, latitude) {
  return `SRID=4326;POINT(${longitude} ${latitude})`;
}

/**
 * Upsert a batch of complaint rows to Supabase.
 * Uses onConflict on complaint_id so re-running the script is safe.
 * Returns the number of successfully upserted rows.
 */
async function upsertBatch(batch) {
  const { error } = await supabaseAdmin
    .from('complaints')
    .upsert(batch, { onConflict: 'complaint_id' });

  if (error) {
    throw error;
  }
  return batch.length;
}

async function main() {
  if (!supabaseAdmin) {
    console.error('SUPABASE_SERVICE_KEY is not set. Cannot run ingestion.');
    process.exit(1);
  }

  if (!fs.existsSync(CSV_PATH)) {
    console.error(`CSV not found at: ${CSV_PATH}`);
    process.exit(1);
  }

  const counters = {
    totalRead: 0,
    infrastructureRows: 0,
    nonInfrastructureSkipped: 0,
    excludedRequestTypeSkipped: 0,
    missingCoordinatesSkipped: 0,
    missingComplaintIdSkipped: 0,
    successfullyUpserted: 0,
    failedBatches: 0,
  };

  let currentBatch = [];

  const processBatch = async () => {
    if (currentBatch.length === 0) return;

    const batchToProcess = currentBatch.slice();
    currentBatch = [];

    try {
      const upserted = await upsertBatch(batchToProcess);
      counters.successfullyUpserted += upserted;
    } catch (err) {
      counters.failedBatches += 1;
      console.error(
        `[BATCH FAILED] First complaint_id in batch: ${batchToProcess[0]?.complaint_id} — ${err.message}`
      );
    }
  };

  const parser = fs
    .createReadStream(CSV_PATH)
    .pipe(
      parse({
        columns: true,
        skip_empty_lines: true,
        trim: true,
        relax_column_count: true,
        // Some Address fields contain DMS coordinate strings like 36°02'30.5"
        // which include a literal " character. Without this option csv-parse
        // throws INVALID_OPENING_QUOTE and aborts the entire stream.
        relax_quotes: true,
      })
    );

  for await (const row of parser) {
    counters.totalRead += 1;

    if (counters.totalRead % LOG_INTERVAL === 0) {
      console.log(`[${counters.totalRead}/~?] Processing...`);
    }

    // Validate complaint_id (Request #)
    const complaintId = (row['Request #'] || '').trim();
    if (!complaintId) {
      counters.missingComplaintIdSkipped += 1;
      continue;
    }

    // Normalize request type before any category checks
    const rawRequestType = row['Request Type'] || '';
    const requestType = normalizeRequestType(rawRequestType);

    // Skip resolution-status rows that are misrecorded as request types
    if (isExcluded(requestType)) {
      counters.excludedRequestTypeSkipped += 1;
      continue;
    }

    // Skip non-infrastructure rows silently (count only)
    if (!isInfrastructureRelevant(requestType)) {
      counters.nonInfrastructureSkipped += 1;
      continue;
    }

    // Validate coordinates — CSV headers confirmed as "Latitude" and "Longitude"
    const latRaw = row['Latitude'];
    const lngRaw = row['Longitude'];
    const latitude = parseFloat(latRaw);
    const longitude = parseFloat(lngRaw);

    if (
      latRaw == null || latRaw === '' ||
      lngRaw == null || lngRaw === '' ||
      isNaN(latitude) || isNaN(longitude)
    ) {
      counters.missingCoordinatesSkipped += 1;
      continue;
    }

    counters.infrastructureRows += 1;

    // Actual CSV headers (verified from dataset):
    //   "Subrequest Type"            (not "Subtype")
    //   "Additional Subrequest Type" (not "Additional Subtype")
    //   "Date /Time Opened"          (note the space before "Time")
    const subtype = normalizeSubtype(row['Subrequest Type']);
    const additionalSubtype = (row['Additional Subrequest Type'] || '').trim() || null;

    const record = {
      complaint_id: complaintId,
      request_type: requestType,
      subtype,
      additional_subtype: additionalSubtype,
      status: (row['Status'] || '').trim() || null,
      // Supabase accepts EWKT strings directly for geography columns.
      // Format: SRID=4326;POINT(lng lat) — PostGIS parses this server-side.
      location: buildLocationEWKT(longitude, latitude),
      latitude,
      longitude,
      address: (row['Address'] || '').trim() || null,
      city: (row['City'] || '').trim() || null,
      council_district: (row['Council District'] || '').trim() || null,
      opened_date: parseDate(row['Date /Time Opened']),
      closed_date: parseDate(row['Date/Time Closed']),
      request_origin: (row['Request Origin'] || '').trim() || null,
    };

    currentBatch.push(record);

    if (currentBatch.length >= BATCH_SIZE) {
      await processBatch();
    }
  }

  // Flush remaining rows
  await processBatch();

  printSummary(counters);
}

function printSummary(c) {
  console.log('\n=================== INGESTION COMPLETE ===================');
  console.log(`Total rows read:                  ${c.totalRead}`);
  console.log(`Infrastructure-relevant rows:     ${c.infrastructureRows}`);
  console.log(`Non-infrastructure rows skipped:  ${c.nonInfrastructureSkipped}`);
  console.log(`Excluded request type skipped:    ${c.excludedRequestTypeSkipped}`);
  console.log(`Missing coordinates skipped:      ${c.missingCoordinatesSkipped}`);
  console.log(`Missing complaint_id skipped:     ${c.missingComplaintIdSkipped}`);
  console.log(`Successfully upserted:            ${c.successfullyUpserted}`);
  console.log(`Failed batches:                   ${c.failedBatches}`);
  console.log('==========================================================\n');
}

main().catch((err) => {
  console.error('Fatal ingestion error:', err);
  process.exit(1);
});
