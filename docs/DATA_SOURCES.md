# Data Sources
## NashAlert — Nashville Infrastructure Complaint Scoring and Equity Analysis

This document catalogs every external data source used in this project.
It serves as the reference for reproducibility: anyone who clones this repository
should be able to re-obtain every dataset described here.

---

## 1. Nashville hubNashville 311 Service Requests (2017–Present)

**Full name:** Metro Nashville hubNashville 311 Service Requests

**URL:** https://data.nashville.gov/d/7qhx-rexh

**Format:** CSV (downloadable directly from the Nashville Metro Open Data Portal; also accessible via Socrata SODA API)

**Update frequency:** Daily — the dataset is refreshed with new requests on an ongoing basis. The version used in this project was downloaded in May 2026 and covers 2017 through that date.

**What it's used for:** This is the primary dataset for NashAlert. It provides the historical infrastructure complaint record used by:
- The recurrence scoring engine (frequency, recency, resolution sub-scores)
- The dashboard's priority queue and map visualization
- The equity analysis (report volume by census tract)
- The ingestion pipeline (`backend/scripts/ingest-311-data.js`)

Only infrastructure-relevant request types are ingested (see `backend/constants/categories.js` and `docs/METHODOLOGY.md` Section 1).

**How to obtain:**
1. Navigate to https://data.nashville.gov/d/7qhx-rexh
2. Click "Export" > "CSV"
3. Save the file to `data/311_complaints.csv`
4. Run `node backend/scripts/ingest-311-data.js`

**Volume:** Approximately 500,000+ rows as of May 2026. The full CSV is ~150 MB; it is gitignored and must be downloaded locally before running the ingestion script.

**Known limitations and caveats:**
- **Reporting bias:** 311 complaint volume reflects who calls, not necessarily where infrastructure failures are worst. Lower-income neighborhoods may be systematically underrepresented. This is one of the equity questions the project is designed to investigate.
- **Resolution status misrecorded as request type:** A small number of rows have "Resolved by hubNashville on First Call" recorded in the Request Type field rather than the actual complaint category. These are filtered out during ingestion.
- **Duplicate request type spelling:** `Public Works WO` and `Public_Works_WO` (with an underscore) refer to the same category. Normalized to `Public Works WO` during ingestion. Affects approximately 2,902 records.
- **Missing coordinates:** A small number of records are missing latitude or longitude values. These cannot be placed on a map and are excluded from ingestion.
- **Missing subtypes:** Fewer than 0.05% of infrastructure-relevant rows have null or empty Subtype values. These are stored with the sentinel value `(none)` and receive a default severity score of 0.3.
- **No demographic data:** The 311 dataset contains no information about the person filing the complaint (by design; reports are anonymous). Equity analysis requires joining to external Census data.

---

## 2. U.S. Census Bureau American Community Survey 5-Year Estimates

**Full name:** American Community Survey (ACS) 5-Year Estimates — Table B19013 (Median Household Income in the Past 12 Months)

**URL:** https://data.census.gov — search for table B19013, geography: Census Tracts in Davidson County, Tennessee

**Format:** CSV (downloadable via data.census.gov) or via the Census Bureau API at https://api.census.gov/data/[year]/acs/acs5

**Update frequency:** Annually (5-year rolling estimates are released each December for the prior 5-year period). The project uses the most recent available release as of project implementation.

**What it's used for:** Provides median household income at the census tract level for Davidson County (Nashville), TN. Used in the equity analysis (Phase 3) to test whether lower-income tracts show higher infrastructure recurrence scores relative to their 311 complaint volume. Joined to complaint data using PostGIS spatial operations against census tract boundaries.

**How to obtain:**
1. Navigate to https://data.census.gov
2. Search for table B19013
3. Set geography to "Census Tract" within "Davidson County, Tennessee"
4. Download as CSV
5. Save to `data/acs_income_tracts.csv` (gitignored)

**Known limitations and caveats:**
- ACS estimates are sample-based and carry margins of error. For small census tracts (small populations), estimates can be imprecise.
- The 5-year rolling average smooths over gentrification and rapid income changes that are especially relevant in Nashville given its growth since 2017.
- Census tract boundaries are not the same as Nashville's council district boundaries, which are the geographic unit used by the 311 system for routing and reporting. Joining across these two geographies introduces spatial misalignment.

---

## 3. Nashville Council District Boundaries

**Full name:** Nashville Metropolitan Government Council District Boundaries

**URL:** https://data.nashville.gov/d/abpp-9mzs (Nashville Open Data Portal — GIS boundaries)

**Format:** GeoJSON or Shapefile (available via the Nashville Open Data Portal)

**Update frequency:** Updated after redistricting. Nashville redistricted in 2023 following the 2020 Census. The current boundaries reflect that cycle.

**What it's used for:** Council district boundaries are used in the dashboard to group complaints by district and to support the `GET /api/complaints/district/:district` endpoint. In the equity analysis, they provide an operationally relevant geographic unit (council districts correspond to how the city routes maintenance requests) that complements the Census tract analysis.

**How to obtain:**
1. Navigate to https://data.nashville.gov/d/abpp-9mzs
2. Download as GeoJSON
3. Save to `data/council_districts.geojson` (gitignored)

**Known limitations and caveats:**
- Council districts are the city's operational unit for complaint routing, but they do not correspond to Census tract boundaries, making direct comparison of district-level complaint statistics and tract-level income data approximate.
- District boundaries were redrawn in 2023. Complaints filed before that date may be assigned to districts that no longer exist or have been significantly redrawn. The 311 dataset's `council_district` field reflects the district at the time of filing.

---

*Last updated: 2026-05-17 — Phase 1 Data Foundation*
