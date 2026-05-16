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

Recent complaints are weighted more heavily than older ones because infrastructure conditions change over time. A location with many complaints from 2018 that has had no complaints since 2022 may have been repaired. Recency is computed using an exponential decay function with a half-life of 90 days:

```
recency_weight(complaint) = e^(-λ * days_since_complaint)
where λ = ln(2) / 90
```

The 90-day half-life was chosen because it represents roughly one fiscal quarter — a common cycle for municipal maintenance prioritization. Complaints older than two years receive a weight close to zero but are not discarded, as they contribute to the frequency and pattern analysis. Recency is given 30% of the total weight — significant but secondary to frequency, because a single very recent complaint at a clean-record location should not outrank a location with years of persistent complaints.

### 4.3 Severity Score (weight: 0.20)

The severity score is the average severity weight of all complaints at the location, using the weights defined in Section 3. It is given 20% of the total weight. Severity is intentionally weighted lower than frequency and recency because the primary goal of this project is to surface *persistently problematic* locations, not simply to rank by complaint type. A location with ten moderate-severity complaints is of greater maintenance concern than a location with one high-severity complaint that was resolved. Severity is nonetheless included because two otherwise equal locations should be differentiated by the nature of their failures — a location with repeated flooding complaints is more urgent than one with repeated roadwork complaints.

### 4.4 Resolution Score (weight: 0.10)

The resolution score is the inverse of the average resolution time for complaints at the location, normalized against the city-wide maximum average resolution time:

```
resolution_score = 1 - (avg_resolution_days / max_avg_resolution_days_city_wide)
```

A higher resolution score indicates that complaints at this location have historically taken longer to resolve, which is an additional signal of systemic neglect. Resolution is given the lowest weight (10%) because resolution time data is inconsistently recorded in the Nashville 311 dataset — many complaints have null closed dates — and because slow resolution may reflect complaint complexity rather than neglect. It is included as a tiebreaker signal rather than a primary driver.

### 4.5 Weight Justification

The 40/30/20/10 weighting was arrived at by the following reasoning: the project's core claim is that recurrence matters more than any single complaint's characteristics, so frequency dominates. Recency is the second most important factor because a prioritization system that equally weights a 2018 complaint and a 2025 complaint would produce stale recommendations. Severity provides meaningful differentiation between location types but should not allow a single high-severity complaint to override years of moderate-severity recurrence. Resolution time is a useful but unreliable signal and is therefore given a minimal weight.

These weights are a deliberate research design decision and are stored as named constants in `backend/constants/severity-weights.js` so they can be adjusted and re-evaluated systematically.

---

## 5. Data Quality Decisions

### 5.1 Request Type Normalization

The Nashville 311 dataset contains two spellings of the same category: `Public Works WO` (with a space) and `Public_Works_WO` (with an underscore). These represent the same municipal department and complaint routing path. All instances of `Public_Works_WO` are normalized to `Public Works WO` during the ingestion pipeline before insertion into the database. This affects approximately 2,902 records.

### 5.2 Missing Subtype Handling

Fewer than 0.05% of complaints in infrastructure-relevant categories have null or empty Subtype values. These are ingested with a subtype value of `(none)`. During severity scoring, complaints with a `(none)` subtype fall back to a default severity score of 0.3 — the lower bound of Tier 3 — rather than being excluded. Excluding them would systematically undercount complaints at locations where residents reported an issue without specifying a subtype, which would bias the frequency score downward for those locations.

### 5.3 Handling Malformed Entries

Records where the Request Type field contained a resolution status rather than a complaint category were excluded as malformed entries, representing a known data quality limitation of the Nashville 311 system.

### 5.4 Missing Coordinate Handling

Records missing latitude or longitude values are skipped during ingestion and logged as skipped rows with the reason `missing_coordinates`. These records cannot be placed on a map and are therefore unusable for geospatial analysis. They are not inserted into the database.

### 5.5 Spatial Clustering Radius

Nearby complaints are grouped within a 200-meter radius for scoring purposes. This radius was chosen to approximate a typical city block in Nashville's street grid while being small enough to distinguish between adjacent intersections. Complaints more than 200 meters apart are treated as belonging to different locations even if they are in the same neighborhood. This radius is a configurable constant and can be adjusted for sensitivity analysis.

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

These limitations do not invalidate the analysis — they define its scope. The findings should be interpreted as evidence warranting further investigation, not as definitive proof of inequity.

---

## 7. What This Methodology Does Not Claim

This project does not claim to provide a production-ready infrastructure management system for the City of Nashville. It does not claim that the severity weights assigned in Section 3 are objectively correct — they represent one reasonable operationalization of infrastructure severity informed by civil engineering principles and are explicitly documented so they can be critiqued and revised. It does not claim that the recurrence scoring formula in Section 4 is optimal — the weights were derived through principled reasoning rather than empirical calibration against ground-truth maintenance outcomes, which would require data not available in public datasets.

What this project does claim is that the methodology is transparent, reproducible, and grounded in a defensible research rationale; that it produces meaningfully different prioritization outputs than naive complaint-count ranking; and that it provides a tractable empirical framework for asking the equity question at the center of this project.

---

*Document authored prior to implementation as a research design exercise. Severity weights and formula parameters are subject to revision as analysis proceeds. All revisions will be logged in CHANGELOG.md with reasoning.*
