# Methodology
## NashAlert: Infrastructure Complaint Scoring and Equity Analysis

---

## 1. Infrastructure Complaint Selection

The Nashville 311 dataset contains complaints spanning a wide range of municipal services — from trash pickup scheduling and permit applications to noise violations and mayor correspondence requests. The vast majority of these are not relevant to infrastructure health or maintenance prioritization. The first methodological decision in this project was determining which complaint categories to include.

**Inclusion criteria:** A complaint was considered infrastructure-relevant if it described a physical failure or degradation of public infrastructure that, left unaddressed, poses a risk to public safety, mobility, or environmental health. This includes road surface failures, drainage and stormwater system failures, water and sewer utility failures, traffic control failures, and structural hazards.

**Exclusion criteria:** Complaints were excluded if they related to administrative or social services (permits, billing inquiries, mayor correspondence), waste collection scheduling (missed pickups, cart requests), quality-of-life issues without infrastructure failure (noise, graffiti, overgrowth), or internal Metro government workflows.

The following Request Types were identified as infrastructure-relevant and form the basis of all scoring in this project:

- **Streets, Roads & Sidewalks** — the largest infrastructure category with 252,182 complaints, covering road surface, traffic control, sidewalks, drainage, and right-of-way issues
- **Electric & Water General** — 20,471 complaints covering water, sewer, stormwater, power, and drainage utility failures
- **Public Works WO** — 44,800 complaints (after normalization, see Section 5) covering a broad range of public works issues overlapping with the above categories
- **Pothole** — 7,168 complaints filed directly as pothole requests, treated as a dedicated road surface category
- **Street Lighting** — 6,383 complaints covering streetlight outages, treated separately due to the safety implications of lighting failures
- **Blocked Drain / Clogged Culvert & Cross Drains / Ditch Maintenance** — smaller but highly specific drainage categories totaling approximately 1,625 complaints
- **Flooding** — 283 direct flooding complaints, treated as high-severity regardless of subtype
- **Repair Storm Drain** — 226 complaints for storm drain repair, included for stormwater infrastructure coverage
- **Remove debris in roadway** — 491 complaints, included where debris poses a direct road safety hazard
- **Sidewalks** — 111 direct sidewalk complaints filed separately from the Streets category
- **Sinkhole** — 5 direct sinkhole complaints plus related subtypes in other categories; included at highest severity
- **Snow and Ice Removal** — 183 complaints, included as a road safety category
- **Traffic Light Issue** — 551 direct complaints, plus a large volume under Streets, Roads & Sidewalks
- **Power Lines Down or Low** — 1,853 complaints, included as an immediate public safety hazard

---

## 2. Severity Tier Definitions

Each infrastructure complaint type was assigned a severity weight between 0.0 and 1.0. Weights reflect the potential consequences of the failure going unaddressed, not the frequency of occurrence. A rare failure type can have a high severity weight; a common complaint type can have a low one. Frequency is accounted for separately in the recurrence scoring formula.

Severity was assigned across three tiers based on the following framework:

**Tier 1 — Critical / Public Safety (0.85–1.0)**

These failures pose an immediate risk to human safety or public health if not addressed promptly. They include structural hazards that can cause injury (sinkholes, collapsed infrastructure), utility failures that affect essential services (water outages, fire hydrant damage), and electrical hazards with injury or fire risk (downed power lines). A sinkhole receives the maximum weight of 1.0 because it represents both immediate physical danger and evidence of serious subsurface infrastructure failure that typically indicates a larger systemic problem. Fire hydrant damage and water outages are weighted at 0.95 because they directly compromise emergency response capability and public health respectively.

**Tier 2 — High / Structural Infrastructure (0.65–0.84)**

These failures affect the structural integrity and primary function of public infrastructure without constituting an immediate life-safety emergency. Flooding and drainage failures are in this tier because they render infrastructure unusable and can escalate rapidly during rain events — a blocked drain is not immediately dangerous on a dry day but becomes a flooding hazard within hours of heavy rainfall, which Nashville experiences regularly. Potholes and road surface failures are placed at the lower end of this tier (0.65) because while they cause vehicle damage and pose injury risk, they are generally not acutely life-threatening in the way that flooding or power failures are. Bridge damage is placed at 0.80, above general potholes, because structural bridge failure has catastrophic rather than incremental consequences.

**Tier 3 — Medium / Usability (0.40–0.64)**

These failures affect the usability and safety of public infrastructure but are less likely to cause immediate harm. Traffic signal failures are placed at 0.60 rather than higher because Nashville's 311 data shows they are the single most-reported subtype (21,921 complaints under Streets, Roads & Sidewalks alone), and the volume suggests many reports reflect malfunctions rather than complete failures. Street lighting failures are placed at 0.50 — they create safety concerns, particularly in pedestrian-heavy corridors, but are generally not acute hazards. Sidewalk failures are placed at 0.50, acknowledging that they disproportionately affect residents without cars in lower-income neighborhoods, which is directly relevant to the equity dimension of this project. Roadwork complaints are placed at 0.40 — the lowest infrastructure weight — because they often reflect inconvenience rather than failure.

---

## 3. Full Severity Weight Table

The following table defines all Request Type + Subtype combinations used in scoring, their assigned weights, and the tier rationale. These values are implemented in `backend/constants/severity-weights.js`. The lookup key format is `"Request Type:Subtype"` (case-normalized, trimmed).

### Tier 1 — Critical / Public Safety

| Request Type | Subtype | Weight | Rationale |
|---|---|---|---|
| Electric & Water General | Sinkhole | 1.0 | Structural collapse hazard; indicates major subsurface failure |
| Electric & Water General | Broken Fire Hydrant | 0.95 | Compromises emergency fire response capability |
| Electric & Water General | Water Outage | 0.95 | Public health; affects drinking water access |
| Electric & Water General | Power Outage | 0.90 | Affects essential services; safety risk in extreme weather |
| Electric & Water General | Power Lines Down/Low | 0.90 | Immediate electrocution and fire hazard |
| Power Lines Down or Low | Power Lines Down/Low | 0.90 | Same as above; direct-filed variant |
| Electric & Water General | Repair Manhole | 0.85 | Open or damaged manholes are fall and vehicle hazards |
| Electric & Water General | Sewer Service Line Assistance Request | 0.85 | Sewer failures pose direct public health and environmental risk |

### Tier 2 — High / Structural Infrastructure

| Request Type | Subtype | Weight | Rationale |
|---|---|---|---|
| Streets, Roads & Sidewalks | Bridge Damage | 0.80 | Structural failure risk; catastrophic rather than incremental consequence |
| Electric & Water General | Flooding Issues | 0.80 | Renders infrastructure impassable; escalates rapidly in rain events |
| Flooding | Flooding Issues | 0.80 | Direct-filed flooding complaint; same rationale |
| Public Works WO | Flooding Issues | 0.80 | Same; filed via Public Works channel |
| Blocked Drain | Blocked Drain | 0.75 | Precursor to flooding; acute risk during rain |
| Electric & Water General | Blocked Drain | 0.75 | Same; utility-channel filing |
| Clogged Culvert & Cross Drains | Clogged Culvert | 0.75 | Stormwater system failure; flooding risk |
| Electric & Water General | Clogged Culvert | 0.75 | Same; utility-channel filing |
| Repair Storm Drain | Repair Storm Drain | 0.75 | Direct stormwater infrastructure failure |
| Electric & Water General | Repair Storm Drain | 0.75 | Same; utility-channel filing |
| Ditch Maintenance | Clean Ditches | 0.70 | Drainage maintenance failure; flooding precursor |
| Electric & Water General | Erosion Complaints | 0.70 | Indicates subsurface or embankment instability over time |
| Electric & Water General | Construction Site Runoff | 0.70 | Environmental and drainage infrastructure impact |
| Electric & Water General | Stormwater Pollution | 0.70 | Environmental health; stormwater system integrity |
| Streets, Roads & Sidewalks | Potholes | 0.65 | Road surface failure; vehicle damage and injury risk |
| Pothole | Potholes | 0.65 | Direct-filed variant; same rationale |
| Public Works WO | Potholes | 0.65 | Same; filed via Public Works channel |
| Streets, Roads & Sidewalks | Dip/Bump in Roadway | 0.65 | Similar to pothole in consequence; road surface failure |

### Tier 3 — Medium / Usability

| Request Type | Subtype | Weight | Rationale |
|---|---|---|---|
| Streets, Roads & Sidewalks | Traffic Light Issue | 0.60 | Safety risk at intersections; high volume suggests many partial failures |
| Public Works WO | Traffic Light Issue | 0.60 | Same; filed via Public Works channel |
| Traffic Light Issue | Traffic Light Issue | 0.60 | Direct-filed variant; same rationale |
| Streets, Roads & Sidewalks | Guard Rails | 0.60 | Structural safety barrier; failure increases accident severity |
| Streets, Roads & Sidewalks | Snow and Ice Removal | 0.55 | Road safety during weather events; time-sensitive |
| Streets, Roads & Sidewalks | Sidewalks | 0.50 | Accessibility and pedestrian safety; disproportionate impact on car-free residents |
| Sidewalks | Sidewalks | 0.50 | Direct-filed variant; same rationale |
| Street Lighting | Street Lighting | 0.50 | Safety concern in pedestrian corridors; not acutely dangerous |
| Public Works WO | Street Lighting | 0.50 | Same; filed via Public Works channel |
| Streets, Roads & Sidewalks | Remove debris in roadway | 0.45 | Road hazard; severity depends on debris type |
| Remove debris in roadway | Remove debris in roadway | 0.45 | Direct-filed variant; same rationale |
| Streets, Roads & Sidewalks | Roadwork Complaint | 0.40 | Often inconvenience rather than failure; lowest infrastructure weight |
| Public Works WO | Roadwork Complaint | 0.40 | Same; filed via Public Works channel |

---

## 4. Recurrence Scoring Formula

The recurrence score for a given location is a composite of four sub-scores, each normalized to a 0–1 range:

```
recurrence_score = (
  (frequency_score  * 0.40) +
  (recency_score    * 0.30) +
  (severity_score   * 0.20) +
  (resolution_score * 0.10)
)
```

### 4.1 Frequency Score (weight: 0.40)

Frequency is weighted most heavily because persistent complaint volume at a location is the strongest signal that infrastructure has a recurring, unresolved problem rather than a one-time incident. It is computed as the number of infrastructure complaints within a defined radius of the query location, normalized against the maximum complaint count across all Nashville locations at the same radius:

```
frequency_score = complaints_in_area / max_complaints_in_any_area
```

Frequency is given 40% of the total weight — the largest share — because the core research question is about recurrence. A location that has been reported ten times over three years is structurally more problematic than one reported once last month, regardless of complaint type.

### 4.2 Recency Score (weight: 0.30)

Recent complaints are weighted more heavily than older ones because infrastructure conditions change over time. A location with many complaints from 2018 that has had no complaints since 2022 may have been repaired. Recency is computed using an exponential decay function with a half-life of 365 days:

```
recency_weight(complaint) = e^(-λ * days_since_complaint)
where λ = ln(2) / 365
```

The 365-day half-life was chosen after evaluating 90-day and 180-day alternatives against the actual dataset. Both shorter half-lives produced recency scores of 0.02–0.05 across all test locations — effectively making recency a non-contributor to the final score despite carrying 30% formula weight, a clear misalignment between the formula's design intent and its practical behavior. A 365-day half-life produces recency scores in the 0.15–0.35 range, making it a genuine differentiator between locations with recent complaint activity and those with only historical records.

The 365-day value also has the strongest domain rationale of the three candidates: infrastructure degradation in Nashville follows seasonal and annual cycles. A pothole corridor that generates complaints every winter for three consecutive years represents a structural failure that a scoring system should recognize — not a one-time event whose signal should decay to near-zero within 90 days. A one-year half-life means complaints from the past 2–3 years carry meaningful weight, complaints from 3–5 years ago carry moderate weight, and complaints older than 5 years approach zero — a decay curve that reflects how infrastructure professionals actually reason about persistent maintenance problems.

A 365-day half-life is also more equitable to the secondary research question. Lower-income Nashville neighborhoods likely accumulate older, more persistent complaint histories rather than high-volume recent ones. A shorter half-life would systematically underweight those histories relative to wealthier areas with more recent but less persistent complaints, introducing a bias contrary to the equity analysis the project is designed to conduct.

Recency is given 30% of the total weight — significant but secondary to frequency, because a single very recent complaint at a clean-record location should not outrank a location with years of persistent complaints.

### 4.3 Severity Score (weight: 0.20)

The severity score is the average severity weight of all complaints at the location, using the weights defined in Section 3. It is given 20% of the total weight. Severity is intentionally weighted lower than frequency and recency because the primary goal of this project is to surface *persistently problematic* locations, not simply to rank by complaint type. A location with ten moderate-severity complaints is of greater maintenance concern than a location with one high-severity complaint that was resolved. Severity is nonetheless included because two otherwise equal locations should be differentiated by the nature of their failures — a location with repeated flooding complaints is more urgent than one with repeated roadwork complaints.

### 4.4 Resolution Score (weight: 0.10)

The resolution score measures how long complaints at a location historically take to close, normalized against a fixed 730-day cap:

```
resolution_score = avg_resolution_days / MAX_RESOLUTION_DAYS
```

A higher resolution score indicates that complaints at this location have historically taken longer to resolve, which is an additional signal of systemic neglect. The denominator uses a fixed cap of 730 days rather than the observed city-wide maximum to ensure score stability across cache reruns and prevent a single extreme-outlier location from compressing all other resolution scores. Resolution is given the lowest weight (10%) because resolution time data is inconsistently recorded in the Nashville 311 dataset — many complaints have null closed dates — and because slow resolution may reflect complaint complexity rather than neglect. It is included as a tiebreaker signal rather than a primary driver.

**Defining "resolved" for resolution time calculation:** The Nashville 311 dataset contains 18 distinct status values with inconsistent casing and formatting — including `PENDING`, `In Progress`, `CityWorks In Progress`, and variants thereof. Rather than attempt to classify this taxonomy, the resolution time calculation uses a single unambiguous rule: a complaint is considered resolved only if its `status` field equals `"Closed"` **and** its `closed_date` is not null. All other rows — regardless of status label — are treated as unresolved and excluded from resolution time averaging. This rule is conservative: it will undercount resolved complaints, but it will not introduce spurious resolution times by inferring closure from ambiguous status strings.

### 4.5 Weight Justification

The 40/30/20/10 weighting was arrived at by the following reasoning: the project's core claim is that recurrence matters more than any single complaint's characteristics, so frequency dominates. Recency is the second most important factor because a prioritization system that equally weights a 2018 complaint and a 2025 complaint would produce stale recommendations. Severity provides meaningful differentiation between location types but should not allow a single high-severity complaint to override years of moderate-severity recurrence. Resolution time is a useful but unreliable signal and is therefore given a minimal weight.

These weights are a deliberate research design decision and are stored as named constants in `backend/constants/severity-weights.js` so they can be adjusted and re-evaluated systematically.

### 4.6 Architectural decision for recurrence score calculation

**Grid Resolution Note:** The nightly batch job uses a 200m grid spacing across Nashville's bounding box, producing approximately 15,000–20,000 scored grid points. This resolution provides sufficient coverage for heatmap visualization and matches the 200m scoring radius. A 100m grid would produce approximately 60,000–80,000 points for finer spatial detail at approximately 4x the compute time. Upgrading to 100m grid spacing is recommended before any production deployment or public launch.

**Caching Architecture:** Scores are precomputed nightly rather than computed per request. This matches the daily update cadence of the Nashville 311 dataset — real-time computation would perform expensive PostGIS spatial queries to return scores unchanged since the previous night's data. The API serves scores from the recurrence_cache table with a 24-hour freshness threshold. If the cache is between 24 and 48 hours old, scores are served with a staleness warning logged server-side. If the cache exceeds 48 hours, the API falls back to real-time computation to ensure resilience against nightly job failures. A hybrid approach with background recomputation triggered by cache staleness detection would be the appropriate next evolution if real-time community report ingestion were added as a scoring data source.

### 4.7 Confidence Weighting

A confidence factor is applied as a final multiplier to the composite recurrence score to reflect statistical reliability based on complaint count. The formula is `confidence_factor = min(1.0, complaint_count / 5)`, producing multipliers of 0.20 for a single complaint, 0.60 for three complaints, and 1.0 (no penalty) for five or more complaints.

The motivation for this adjustment is a discovered behavior during baseline comparison analysis: single high-severity complaints at sparse outer Nashville grid points (predominantly Electric & Water General subtypes including sinkholes and water main failures) were producing composite recurrence scores of 0.50–0.52, comparable to locations with thousands of corroborated complaints in the urban core. This behavior reflects a genuine tension in composite scoring: severity weights correctly identify acute safety hazards, but a single isolated report at a geographic fringe provides insufficient statistical evidence to treat a location with the same confidence as one with years of complaint history.

The confidence factor does not reduce the severity weights assigned to critical complaint types — a sinkhole remains severity 1.0. Rather, it requires a minimum level of corroboration before a location's score is treated as fully reliable. A sinkhole with five or more corroborating reports at a location retains its full score. This distinction between severity (how serious is this complaint type?) and confidence (how certain are we this location has a real problem?) is a deliberate design choice and a candidate for further methodological refinement in future work.

The pre-confidence composite score is preserved in the `raw_score` field of the `recurrence_cache` table and all API responses. This allows direct comparison of pre- and post-confidence rankings as a sensitivity analysis, and ensures the modification is fully transparent and reversible. The `CONFIDENCE_THRESHOLD_COMPLAINTS = 5` constant is defined in `backend/services/scoring.js` so the threshold can be adjusted systematically. The nightly batch job summary log reports the count of confidence-discounted grid points (those with `complaint_count < 5`) to make the practical scope of the modifier observable.

The z-score anomaly detection module currently in development applies a normality assumption to complaint count distributions. This is a known approximation: complaint counts are more accurately modeled as Poisson-distributed events, particularly in sparse grid cells where counts are small. The normality assumption introduces bias in low-count cells and is a candidate for replacement with Poisson-based detection methods in future work (Mukhopadhyay et al., 2022).

### 4.8 Baseline Comparison and Score Distribution

A comparison of Nashville's top 20 locations by raw complaint volume versus recurrence score reveals meaningful divergence beginning at rank 10. The top nine locations are identical across both rankings — high-density Broadway corridor grid points with 2,700–5,547 complaints, all Streets, Roads & Sidewalks dominant, concentrated in a tight geographic cluster in downtown Nashville. This convergence at the top is expected: locations with both extreme complaint volume and recent activity naturally dominate both rankings.

Ranks 10–20 by recurrence score, however, include outer Nashville locations with 5–24 complaints — predominantly Electric & Water General types such as water outages, flooding issues, drainage failures, and utility hazards — distributed across southwest, northwest, and north Nashville neighborhoods. These locations would be undetectable in a complaint-volume ranking, buried among thousands of lower-priority entries. The recurrence scoring engine surfaces them because their complaints carry high severity weights, are recent, and remain unresolved — a combination of signals that raw complaint count cannot capture.

This divergence is the core empirical justification for the scoring methodology: locations with persistent high-severity utility failures in outer Nashville are systematically underrepresented in raw complaint volume but correctly elevated by the recurrence scoring engine. A city planner using naive complaint-count ranking would never examine a location with 8 or 23 complaints. The recurrence score says they should.
This finding is consistent with the broader emergency response management literature's characterization of frequency-based approaches: Mukhopadhyay et al. (2022) note that frequency analysis "neglects fluctuations in incident occurrence and requires a large volume of incident data to infer accurate characteristics" — a limitation directly observable in Nashville's outer-district complaint data.

Recurrence scores across Nashville's 30,979 scored grid points range from approximately 0.02 to 0.62, with the majority of locations falling in the 0.15–0.35 range. This compressed distribution reflects the genuine geographic concentration of infrastructure stress in Nashville's urban core rather than a scoring artifact. Scores should be interpreted relative to each other rather than against an absolute scale; district-level filtering in the priority queue is recommended for identifying high-priority locations within specific neighborhoods.

---

## 5. Data Quality Decisions

### 5.1 Request Type Normalization

The Nashville 311 dataset contains two spellings of the same category: `Public Works WO` (with a space) and `Public_Works_WO` (with an underscore). These represent the same municipal department and complaint routing path. All instances of `Public_Works_WO` are normalized to `Public Works WO` during the ingestion pipeline before insertion into the database. This affects approximately 2,902 records.

### 5.2 Missing Subtype Handling

Fewer than 0.05% of complaints in infrastructure-relevant categories have null or empty Subtype values. These are ingested with a subtype value of `(none)`. During severity scoring, complaints with a `(none)` subtype fall back to a default severity score of 0.3 — the lower bound of Tier 3 — rather than being excluded. Excluding them would systematically undercount complaints at locations where residents reported an issue without specifying a subtype, which would bias the frequency score downward for those locations.

### 5.3 Handling Malformed Entries

Records where the Request Type field contained a resolution status rather than a complaint category were excluded as malformed entries, representing a known data quality limitation of the Nashville 311 system. The most common such value — `Resolved by hubNashville on First Call` — accounts for **604,925 rows**, nearly a third of the full 1,982,953-row dataset. This is a substantially larger proportion than anticipated and suggests that the Nashville 311 system's data export conflates resolution outcomes with complaint categories at significant scale. These rows carry no complaint type, subtype, or infrastructure signal and are excluded entirely from ingestion. They are counted separately in the ingestion summary log so the exclusion is transparent and auditable.

### 5.4 Missing Coordinate Handling

Records missing latitude or longitude values are skipped during ingestion and logged as skipped rows with the reason `missing_coordinates`. These records cannot be placed on a map and are therefore unusable for geospatial analysis. They are not inserted into the database.

### 5.5 CSV Column Name Discrepancies

The Nashville Metro Open Data Portal's CSV export uses column names that differ in minor but meaningful ways from the field names documented in the dataset's data dictionary and from what one would expect based on the portal's web interface. These discrepancies were discovered during ingestion and are documented here for reproducibility.

**Subtype field:** The export header is `Subrequest Type`, not `Subtype`. Any script that reads this column using the name `Subtype` will silently read null values for every row, causing all complaints to be stored with a subtype of `(none)` regardless of the actual filed subtype. The ingestion pipeline uses `Subrequest Type`.

**Additional Subtype field:** Similarly, the header is `Additional Subrequest Type`, not `Additional Subtype`.

**Opened date field:** The export header is `Date /Time Opened` — note the space between `Date` and `/Time`. This appears to be a typographical inconsistency in the portal's export formatter. A script using `Date/Time Opened` (no space) will silently read null dates for all rows. The ingestion pipeline uses `Date /Time Opened` verbatim.

**Address field encoding:** Some address values contain DMS (degree-minute-second) coordinate strings such as `36°02'30.5"`, where the `"` character is the arc-seconds symbol. Standard CSV parsers that treat `"` as a quoting character will interpret this as an unclosed quote and abort parsing. The ingestion pipeline uses the `relax_quotes` option to handle this without discarding the affected rows.

These discrepancies do not affect the scientific validity of the analysis but are worth documenting because they would cause silent data errors in any reimplementation that assumes standard column names. The Nashville open data portal does not appear to version its export schema, so future exports should be validated against these headers before ingestion.

### 5.6 Spatial Clustering Radius

Nearby complaints are grouped within a 200-meter radius for scoring purposes. This radius was chosen to approximate a typical city block in Nashville's street grid while being small enough to distinguish between adjacent intersections. Complaints more than 200 meters apart are treated as belonging to different locations even if they are in the same neighborhood. This radius is a configurable constant and can be adjusted for sensitivity analysis.

The dashboard's priority queue district filter uses a deliberately wider 1,000-meter radius for a different spatial question: not "which complaints belong to this cluster?" but "which administrative district does this cache grid point serve?" Council districts are large geographic areas covering several square miles. In outer Nashville districts with lower complaint density, the nearest complaint bearing the target district's label may be 300–500 meters from the nearest scored grid point — well outside the 200-meter scoring radius but clearly within the same district. Using 200 meters for district assignment caused the priority queue to return zero results for outer districts despite those districts having thousands of complaints on record. The 1,000-meter district assignment radius corrects this without affecting scoring in any way: the scoring formula always uses the 200-meter window to compute frequency, recency, severity, and resolution components. The two radii serve distinct purposes and should be maintained separately.

### 5.7 Batch Job Performance

The nightly batch job evaluates approximately 73,000 grid points across Nashville's bounding box, scoring the 42% that have at least one infrastructure complaint within 200m and skipping the remainder. On Supabase's free tier the job completes in approximately 22 minutes due to connection throttling; this would reduce to an estimated 3–5 minutes on a dedicated database instance and should be considered when planning a production deployment.

---

## 6. Equity Analysis Methodology

The secondary research question asks whether lower-income Nashville census tracts are systematically underrepresented in 311 complaint volume relative to their infrastructure condition as measured by recurrence scores.

### 6.1 Data Sources

Infrastructure condition is measured by the average recurrence score of complaints within each census tract, computed using the scoring formula in Section 4. Census tract boundaries and median household income data are drawn from the U.S. Census Bureau's American Community Survey (ACS) 5-Year Estimates, joined to Nashville's geographic boundaries using PostGIS spatial operations.

### 6.2 Metric Definition

For each census tract, two metrics are computed:

- **Infrastructure Stress Score:** the mean recurrence score of all infrastructure complaints within the tract boundary
- **Report Density:** the number of infrastructure complaints per 1,000 residents within the tract

The equity analysis examines the ratio of Infrastructure Stress Score to Report Density across tracts, grouped by income quartile. If lower-income tracts show a higher ratio — meaning higher infrastructure stress relative to complaint volume — this is evidence of systematic underreporting.

### 6.3 Limitations

This analysis has several important limitations that must be acknowledged:

**Reporting behavior is multidimensional.** Lower 311 report density in a tract may reflect lower infrastructure stress (the null hypothesis), lower digital access or awareness of 311, language barriers, distrust of municipal systems, or some combination. This analysis cannot distinguish between these explanations using 311 data alone.

**Recurrence score is not a direct measure of infrastructure condition.** It measures complaint-based evidence of problems, which is itself subject to the same reporting biases the analysis is testing for. A tract with very low complaint volume may show a low recurrence score not because its infrastructure is in good condition but because its residents are not filing complaints. This circularity is a fundamental limitation of complaint-based infrastructure assessment and is noted here explicitly.

**Census tract boundaries do not correspond to infrastructure maintenance districts.** Nashville's public works maintenance is organized by council district, not census tract. The use of census tracts is driven by the availability of income data at that geographic level, not by operational relevance to maintenance decisions.

**The dataset spans 2017–present.** Infrastructure conditions and demographic compositions of Nashville neighborhoods have changed over this period, particularly given Nashville's significant growth. The equity analysis treats the full period as a single snapshot, which may obscure temporal dynamics.

**District 19 is a significant outlier.** With 40,910 complaints, District 19 has nearly three times the complaint volume of the next highest district (District 5 at 13,848). This is not a data artifact — District 19 covers a large geographic area and its concentration will appear prominently in heatmap visualizations. Any district-level equity comparison must account for this disparity, as raw complaint counts and recurrence scores for District 19 will not be directly comparable to those of geographically smaller districts. Census tract-level normalization by resident population partially addresses this, but the geographic scale difference remains a confound.

**Current project implementation uses a static dataset.** The current implementation uses a static snapshot of Nashville 311 data ingested at project initialization. A production deployment would require a scheduled incremental sync job to keep the dataset current, which the existing upsert-based ingestion pipeline is designed to support with minimal modification.


These limitations do not invalidate the analysis — they define its scope. The findings should be interpreted as evidence warranting further investigation, not as definitive proof of inequity.

---

## 7. What This Methodology Does Not Claim

This project does not claim to provide a production-ready infrastructure management system for the City of Nashville. It does not claim that the severity weights assigned in Section 3 are objectively correct — they represent one reasonable operationalization of infrastructure severity informed by civil engineering principles and are explicitly documented so they can be critiqued and revised. It does not claim that the recurrence scoring formula in Section 4 is optimal — the weights were derived through principled reasoning rather than empirical calibration against ground-truth maintenance outcomes, which would require data not available in public datasets.

What this project does claim is that the methodology is transparent, reproducible, and grounded in a defensible research rationale; that it produces meaningfully different prioritization outputs than naive complaint-count ranking — demonstrated empirically by a baseline comparison showing that ranks 10–20 by recurrence score include outer Nashville utility infrastructure locations with 5–24 complaints that would be invisible in a volume-based ranking; and that it provides a tractable empirical framework for asking the equity question at the center of this project.

---

*Document authored prior to implementation as a research design exercise. Severity weights and formula parameters are subject to revision as analysis proceeds. All revisions will be logged in CHANGELOG.md with reasoning.*
