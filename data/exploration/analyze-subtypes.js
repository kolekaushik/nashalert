/**
 * analyze-subtypes.js
 *
 * One-off exploration script for the Nashville 311 dataset.
 * Reads the raw CSV in streaming mode and builds frequency maps of every
 * Request Type + Subtype combination to inform ingestion pipeline design —
 * specifically: what subtypes exist, how often subtype is missing, and
 * which request types dominate the dataset.
 *
 * Usage:
 *   node analyze-subtypes.js [path-to-csv]
 *
 * If no path is given, defaults to the raw 311 export in data/.
 *
 * Outputs (written to data/):
 *   subtype-analysis.csv      — every Request Type + Subtype combo with count
 *   request-type-summary.csv  — every Request Type with total count
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const { parse } = require('csv-parse');

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const DATA_DIR = path.resolve(__dirname, '../../data');

const DEFAULT_CSV = path.join(
  DATA_DIR,
  'hubNashville_(311)_Service_Requests_1_-8948652486743819816.csv'
);

const INPUT_PATH      = process.argv[2] ? path.resolve(process.argv[2]) : DEFAULT_CSV;
const SUBTYPE_OUTPUT  = path.join(DATA_DIR, 'subtype-analysis.csv');
const SUMMARY_OUTPUT  = path.join(DATA_DIR, 'request-type-summary.csv');

// Sentinel used so missing subtypes are visible in output rather than blank
const NONE = '(none)';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

// Map from "requestType|||subtype" -> count
const combinationCounts = new Map();
// Map from requestType -> count
const requestTypeCounts = new Map();

let totalRows          = 0;
let nullRequestTypeRows = 0;
let nullSubtypeRows    = 0;

// ---------------------------------------------------------------------------
// Row processing
// ---------------------------------------------------------------------------

function processRow(record) {
  totalRows++;

  const rawRequestType = (record['Request Type']      || '').trim();
  const rawSubtype     = (record['Subrequest Type']   || '').trim();

  // Count missing values before applying fallback labels
  if (!rawRequestType) nullRequestTypeRows++;
  if (!rawSubtype)     nullSubtypeRows++;

  const requestType = rawRequestType || NONE;
  const subtype     = rawSubtype     || NONE;

  requestTypeCounts.set(requestType, (requestTypeCounts.get(requestType) || 0) + 1);

  // Composite key — the separator is unlikely to appear in real 311 data
  const key = `${requestType}|||${subtype}`;
  combinationCounts.set(key, (combinationCounts.get(key) || 0) + 1);
}

// ---------------------------------------------------------------------------
// CSV helpers — escape double-quotes per RFC 4180
// ---------------------------------------------------------------------------

function csvField(value) {
  const escaped = String(value).replace(/"/g, '""');
  return `"${escaped}"`;
}

// ---------------------------------------------------------------------------
// Output writers
// ---------------------------------------------------------------------------

function writeSubtypeCSV() {
  const rows = [];
  for (const [key, count] of combinationCounts) {
    const separatorIndex = key.indexOf('|||');
    const requestType    = key.slice(0, separatorIndex);
    const subtype        = key.slice(separatorIndex + 3);
    rows.push({ requestType, subtype, count });
  }

  // Sort: request_type alphabetically, then count descending within each type
  rows.sort((a, b) => {
    const typeOrder = a.requestType.localeCompare(b.requestType);
    return typeOrder !== 0 ? typeOrder : b.count - a.count;
  });

  const lines = ['request_type,subtype,count'];
  for (const row of rows) {
    lines.push(`${csvField(row.requestType)},${csvField(row.subtype)},${row.count}`);
  }

  fs.writeFileSync(SUBTYPE_OUTPUT, lines.join('\n'));
  return rows.length;
}

function writeSummaryCSV() {
  const rows = [];
  for (const [requestType, count] of requestTypeCounts) {
    rows.push({ requestType, count });
  }

  rows.sort((a, b) => b.count - a.count);

  const lines = ['request_type,count'];
  for (const row of rows) {
    lines.push(`${csvField(row.requestType)},${row.count}`);
  }

  fs.writeFileSync(SUMMARY_OUTPUT, lines.join('\n'));
  return rows.length;
}

// ---------------------------------------------------------------------------
// Console summary
// ---------------------------------------------------------------------------

function printSummary(uniqueRequestTypes, uniqueCombinations) {
  const top10 = [...requestTypeCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  const pad = (n) => n.toLocaleString().padStart(9);

  console.log('\n========================================');
  console.log('  Nashville 311 — Subtype Analysis');
  console.log('========================================\n');
  console.log(`Total rows processed:                ${pad(totalRows)}`);
  console.log(`Unique Request Types:                ${pad(uniqueRequestTypes)}`);
  console.log(`Unique Request Type + Subtype combos:${pad(uniqueCombinations)}`);
  console.log(`Rows with null/empty Request Type:   ${pad(nullRequestTypeRows)}`);
  console.log(`Rows with null/empty Subtype:        ${pad(nullSubtypeRows)}`);

  const subtypeMissingPct = totalRows > 0
    ? ((nullSubtypeRows / totalRows) * 100).toFixed(1)
    : '0.0';
  console.log(`  → ${subtypeMissingPct}% of rows are missing a subtype`);

  console.log('\nTop 10 Request Types by count:');
  top10.forEach(([type, count], i) => {
    const rank  = String(i + 1).padStart(2);
    const tally = count.toLocaleString().padStart(8);
    console.log(`  ${rank}. ${tally}  ${type}`);
  });

  console.log('\nOutput files written:');
  console.log(`  ${SUBTYPE_OUTPUT}`);
  console.log(`  ${SUMMARY_OUTPUT}`);
  console.log('');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function run() {
  if (!fs.existsSync(INPUT_PATH)) {
    console.error(`Error: CSV file not found at:\n  ${INPUT_PATH}`);
    console.error('Pass the path as the first argument: node analyze-subtypes.js <path-to-csv>');
    process.exit(1);
  }

  console.log(`\nReading: ${path.basename(INPUT_PATH)}`);
  console.log('Streaming rows...\n');

  const parser = fs.createReadStream(INPUT_PATH).pipe(
    parse({
      // Trim whitespace from every header name so column lookups are reliable
      columns:            (headers) => headers.map((h) => h.trim()),
      skip_empty_lines:   true,
      trim:               true,
      relax_column_count: true,
      // Some address/coordinate fields contain literal " characters (e.g. degree
      // notation like 36°02'30.5") which aren't RFC-4180-escaped — relax_quotes
      // lets the parser tolerate them rather than aborting.
      relax_quotes:       true,
    })
  );

  parser.on('readable', () => {
    let record;
    while ((record = parser.read()) !== null) {
      processRow(record);
    }
  });

  parser.on('error', (err) => {
    console.error('CSV parse error:', err.message);
    process.exit(1);
  });

  parser.on('end', () => {
    const uniqueCombinations  = writeSubtypeCSV();
    const uniqueRequestTypes  = writeSummaryCSV();
    printSummary(uniqueRequestTypes, uniqueCombinations);
  });
}

run();
