# Data Exploration

These files document the initial exploration of the Nashville 311 dataset
prior to building the ingestion pipeline.

- `analyze-subtypes.js` — script to extract all unique Request Type + Subtype
  combinations and their frequencies from the raw 311 CSV
- `subtype-analysis.csv` — output: every unique combination with complaint counts,
  sorted by request type and frequency
- `request-type-summary.csv` — output: top-level request type totals

Findings from this exploration informed the severity weight methodology
documented in `docs/METHODOLOGY.md`.