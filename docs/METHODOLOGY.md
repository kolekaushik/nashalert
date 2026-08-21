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
  (frequency_score  * 0.15) +
  (recency_score    * 0.40) +
  (severity_score   * 0.35) +
  (resolution_score * 0.10)
)
```

**Revision history:** the formula originally used 40/30/20/10 (frequency/recency/severity/resolution). It was revised to 15/40/35/10 after empirical analysis (documented in full in Section 4.1) showed the original weights were nominal, not effective — see below. This is a research design decision, not a bug fix, and is documented here in the interest of transparency rather than silently changed. The change is logged in `docs/CHANGELOG.md` Phase 2.7.

### 4.1 Frequency Score (weight: 0.15)

Frequency measures the number of infrastructure complaints within a defined radius of the query location, normalized against the maximum complaint count across all Nashville locations at the same radius:

```
frequency_score = complaints_in_area / max_complaints_in_any_area
```

**Why frequency's weight was lowered from 0.40 to 0.15 — the nominal-vs-effective weight problem.** `max_complaints_in_any_area` is set not by a single outlier but by the extreme upper tail of the distribution: at least eleven Nashville locations exceed 2,400 complaints, with the citywide maximum at 5,547 (all in the dense downtown Broadway corridor). Because the normalizing denominator is drawn from that tail, a plain linear ratio produces a frequency sub-score near zero for the large majority of Nashville locations that are not themselves part of that small high-volume cluster: a location with 80 complaints scores 0.014, one with 23 complaints scores 0.004, one with 8 complaints scores 0.001. At the original 40% nominal weight, those sub-scores contributed on the order of 1–3% of the composite score for most of the city — not 40% — while at the citywide-maximum location, frequency alone contributed roughly three-quarters of that location's composite score. The formula's *stated* weights (40/30/20/10) and its *actual, effective* weights therefore diverged sharply and in opposite directions depending on complaint density: frequency-dominated in the downtown core, and severity-and-recency-dominated (by construction, not by design) everywhere else.

**Two ways to resolve this, and why the second was chosen.** There are two internally consistent fixes: (a) raise frequency's *effective* contribution so it matches its stated 40% nominal weight everywhere (for example, by applying a compressive exponent such as a square root to the count/max ratio), or (b) lower frequency's *nominal* weight to match what it was already effectively contributing almost everywhere outside the downtown core, and state plainly that outside the urban core this system measures severity and recency rather than volume-recurrence. Option (a) was implemented first and then reverted after further consideration. It is defensible on internal-consistency grounds, but it pulls the composite score toward a closer proxy for raw complaint volume — the exact ranking approach this project's core thesis (Section 4.8, Section 7) argues is inadequate for surfacing infrastructure problems that a volume-based system would miss. A scoring system built on the premise that complaint volume misleads should not then engineer complaint volume's effective influence upward to satisfy a nominal weight chosen before the normalization's behavior was understood. Option (b) was chosen instead: `FREQUENCY_WEIGHT` was lowered to 0.15, and `RECENCY_WEIGHT` and `SEVERITY_WEIGHT` were raised to absorb the redistributed weight (see Sections 4.2 and 4.3). The frequency sub-score itself is unchanged — a plain linear ratio (`FREQUENCY_NORMALIZATION_EXPONENT = 1.0` in `backend/services/scoring.js`) — because the goal was to make the *stated* weight honestly describe the formula's *actual* behavior, not to re-engineer the sub-score to chase a weight that no longer applied.

**What this means for interpreting the score:** frequency still acts as a real, capped contributor — it can add up to 0.15 to any location's score, and does scale with complaint volume relative to the city — but it is no longer the dominant term outside the small set of extreme-volume downtown locations. For the majority of Nashville, this recurrence score is primarily a measure of *how recently and how severely* a location has been reported, with volume as a secondary, bounded signal. This is a deliberate design choice consistent with the project's argument that severity and recency, not raw volume, should drive prioritization — see Section 4.8 for the empirical case that this produces meaningfully different (and more useful) rankings than a volume-only approach.

**Practical consequence — ranking reorder.** Because frequency no longer dominates, the relative ranking of locations by recurrence score changed measurably between the 40/30/20/10 and 15/40/35/10 formulas: locations with extreme complaint volume but average severity and moderate recency (the downtown Broadway corridor) score lower in absolute terms than before, while locations with fewer complaints but recent, high-severity reports rise in relative standing. A reader comparing before/after top-N tables will observe this reordering directly; it is the intended effect of the weight change, not an artifact.

### 4.2 Recency Score (weight: 0.40)

Recent complaints are weighted more heavily than older ones because infrastructure conditions change over time. A location with many complaints from 2018 that has had no complaints since 2022 may have been repaired. Recency is computed using an exponential decay function with a half-life of 365 days:

```
recency_weight(complaint) = e^(-λ * days_since_complaint)
where λ = ln(2) / 365
```

The 365-day half-life was chosen after evaluating 90-day and 180-day alternatives against the actual dataset. Both shorter half-lives produced recency scores of 0.02–0.05 across all test locations — effectively making recency a non-contributor to the final score despite carrying substantial formula weight (30% at the time of this evaluation), a clear misalignment between the formula's design intent and its practical behavior. A 365-day half-life produces recency scores in the 0.15–0.35 range for most locations, making it a genuine differentiator between locations with recent complaint activity and those with only historical records.

The 365-day value also has the strongest domain rationale of the three candidates: infrastructure degradation in Nashville follows seasonal and annual cycles. A pothole corridor that generates complaints every winter for three consecutive years represents a structural failure that a scoring system should recognize — not a one-time event whose signal should decay to near-zero within 90 days. A one-year half-life means complaints from the past 2–3 years carry meaningful weight, complaints from 3–5 years ago carry moderate weight, and complaints older than 5 years approach zero — a decay curve that reflects how infrastructure professionals actually reason about persistent maintenance problems.

A 365-day half-life is also more equitable to the secondary research question. Lower-income Nashville neighborhoods likely accumulate older, more persistent complaint histories rather than high-volume recent ones. A shorter half-life would systematically underweight those histories relative to wealthier areas with more recent but less persistent complaints, introducing a bias contrary to the equity analysis the project is designed to conduct.

Recency now carries the largest share of the total weight (`RECENCY_WEIGHT = 0.40`, raised from an original 0.30 — see Section 4.1 and Section 4.5 for why), reflecting that after the frequency weight revision, real-world urgency is driven more by how recently a problem has been reported than by raw complaint count in most of the city.

**Recency is "now-relative," by construction.** The recency sub-score is computed relative to the moment it is calculated — `days_since_complaint` is measured against the current wall-clock time, not against a fixed reference date. This means a cached score computed by the nightly batch job will drift slightly further from a real-time recomputation of the *same* location the longer the gap between them: every day that passes without a new complaint at that location, its recency sub-score (and therefore its composite score) decays a small amount, whether or not the cache has been refreshed. This is expected behavior, not a bug — a real-time fallback query run three days after the last batch run is *supposed* to show a slightly lower recency score than the cached value, because three additional days have elapsed since the most recent complaint. Section 4.6 discusses the cache-vs-real-time architecture; this note exists specifically so that a discrepancy between a cached score and a real-time score for the same location is not mistaken for an inconsistency between the two code paths.

### 4.3 Severity Score (weight: 0.35)

The severity score is the average severity weight of all complaints at the location, using the weights defined in Section 3. It now carries substantial formula weight (`SEVERITY_WEIGHT = 0.35`, raised from an original 0.20 — see Section 4.1 and Section 4.5). A location with ten moderate-severity complaints can still be of greater maintenance concern than a location with one high-severity complaint that was resolved, but severity is no longer a minor tiebreaker: alongside recency, it is one of the two dominant signals for the large majority of Nashville locations whose frequency sub-score is small relative to the citywide maximum. This is intentional — two otherwise similar locations should be differentiated by the nature of their failures, and a location with repeated flooding complaints should be treated as more urgent than one with repeated roadwork complaints, even at similar complaint counts.

### 4.4 Resolution Score (weight: 0.10)

The resolution score measures how long complaints at a location historically take to close, normalized against a fixed 730-day cap:

```
resolution_score = avg_resolution_days / MAX_RESOLUTION_DAYS
```

A higher resolution score indicates that complaints at this location have historically taken longer to resolve, which is an additional signal of systemic neglect. The denominator uses a fixed cap of 730 days rather than the observed city-wide maximum to ensure score stability across cache reruns and prevent a single extreme-outlier location from compressing all other resolution scores. Resolution is given the lowest weight (10%) because resolution time data is inconsistently recorded in the Nashville 311 dataset — many complaints have null closed dates — and because slow resolution may reflect complaint complexity rather than neglect. It is included as a tiebreaker signal rather than a primary driver.

**Defining "resolved" for resolution time calculation:** The Nashville 311 dataset contains 18 distinct status values with inconsistent casing and formatting — including `PENDING`, `In Progress`, `CityWorks In Progress`, and variants thereof. Rather than attempt to classify this taxonomy, the resolution time calculation uses a single unambiguous rule: a complaint is considered resolved only if its `status` field equals `"Closed"` **and** its `closed_date` is not null. All other rows — regardless of status label — are treated as unresolved and excluded from resolution time averaging. This rule is conservative: it will undercount resolved complaints, but it will not introduce spurious resolution times by inferring closure from ambiguous status strings.

### 4.5 Weight Justification

**Original reasoning (40/30/20/10):** the project's initial design claim was that recurrence matters more than any single complaint's characteristics, so frequency should dominate. Recency was the second most important factor because a prioritization system that equally weights a 2018 complaint and a 2025 complaint would produce stale recommendations. Severity provided meaningful differentiation between location types but should not allow a single high-severity complaint to override years of moderate-severity recurrence. Resolution time was treated as a useful but unreliable signal and given a minimal weight.

**Revised reasoning (15/40/35/10):** the frequency weight in the original design assumed that a 40% nominal share would translate into a 40% effective share of the composite score. Section 4.1 documents why that assumption did not hold: normalizing against the citywide maximum causes frequency's effective contribution to collapse to near-zero for most Nashville locations, so the true "recurrence" signal in most of the dataset was already coming from recency and severity, not frequency. Rather than leave that gap between stated and actual behavior undocumented, or force frequency's effective contribution upward to match the original 40% (which would make the score more like a volume ranking — see Section 4.1), the nominal weights were rebalanced to reflect what the formula was already effectively doing: recency and severity became the two largest weights (0.40 and 0.35 respectively), frequency was reduced to a smaller but still meaningful capped contribution (0.15), and resolution's weight was left unchanged at 0.10, since the reasoning for its minimal weight (unreliable, inconsistently recorded data) was independent of the frequency normalization issue.

This revision does not change the underlying claim that recurrence — evidenced through recency and severity of reports — matters more than any single complaint's characteristics in isolation; it changes which sub-score carries that claim. Under the original weights, "recurrence" was nominally carried by frequency but effectively carried by recency and severity for most of the city. Under the revised weights, recency and severity carry that role explicitly and by design, and frequency contributes what it can actually differentiate: real, bounded differences in complaint volume relative to the rest of Nashville.

These weights are a deliberate research design decision and are stored as named constants (`FREQUENCY_WEIGHT`, `RECENCY_WEIGHT`, `SEVERITY_WEIGHT`, `RESOLUTION_WEIGHT`) in `backend/services/scoring.js` so they can be adjusted and re-evaluated systematically.

### 4.6 Architectural decision for recurrence score calculation

**Grid Resolution Note:** The nightly batch job uses a 200m grid spacing across Nashville's bounding box, producing approximately 15,000–20,000 scored grid points. This resolution provides sufficient coverage for heatmap visualization and matches the 200m scoring radius. A 100m grid would produce approximately 60,000–80,000 points for finer spatial detail at approximately 4x the compute time. Upgrading to 100m grid spacing is recommended before any production deployment or public launch.

**Caching Architecture:** Scores are precomputed nightly rather than computed per request. This matches the daily update cadence of the Nashville 311 dataset — real-time computation would perform expensive PostGIS spatial queries to return scores unchanged since the previous night's data. The API serves scores from the recurrence_cache table with a 24-hour freshness threshold. If the cache is between 24 and 48 hours old, scores are served with a staleness warning logged server-side. If the cache exceeds 48 hours, the API falls back to real-time computation to ensure resilience against nightly job failures. A hybrid approach with background recomputation triggered by cache staleness detection would be the appropriate next evolution if real-time community report ingestion were added as a scoring data source.

**Cache vs. real-time agreement:** the real-time fallback path is expected to *converge toward*, not exactly reproduce, a cached score for the same location once any time has passed since the cache was computed. All four sub-scores are deterministic given the same complaint data, but the recency sub-score (Section 4.2) is computed relative to wall-clock "now," so it decays continuously between cache runs. A real-time score computed even a few hours after the nightly batch job will show a slightly lower recency sub-score — and therefore a slightly lower composite score — than the cached value for the same location, purely as a function of elapsed time. This is expected behavior, not a discrepancy between the two code paths, and should not be mistaken for a bug when comparing cached and real-time results for the same coordinates.

### 4.7 Confidence Weighting

A confidence factor is applied as a final multiplier to the composite recurrence score to reflect statistical reliability based on complaint count. The formula is `confidence_factor = min(1.0, complaint_count / 5)`, producing multipliers of 0.20 for a single complaint, 0.60 for three complaints, and 1.0 (no penalty) for five or more complaints.

The motivation for this adjustment is a discovered behavior during baseline comparison analysis: single high-severity complaints at sparse outer Nashville grid points (predominantly Electric & Water General subtypes including sinkholes and water main failures) were producing composite recurrence scores of 0.50–0.52 under the original 40/30/20/10 weighting, comparable to locations with thousands of corroborated complaints in the urban core. This behavior reflects a genuine tension in composite scoring: severity weights correctly identify acute safety hazards, but a single isolated report at a geographic fringe provides insufficient statistical evidence to treat a location with the same confidence as one with years of complaint history. Under the revised 15/40/35/10 weighting (Section 4.1), this same effect is *larger*, not smaller: a single very recent, maximally severe complaint can now reach a raw composite of roughly 0.80 (0.40 recency + 0.35 severity + 0.05 default resolution), before the confidence factor is applied. This makes the confidence factor's role more important post-revision, not less — the weight change increases how much a single unconfirmed report can move the composite score, which is exactly the scenario the confidence factor exists to discount.

The confidence factor does not reduce the severity weights assigned to critical complaint types — a sinkhole remains severity 1.0. Rather, it requires a minimum level of corroboration before a location's score is treated as fully reliable. A sinkhole with five or more corroborating reports at a location retains its full score. This distinction between severity (how serious is this complaint type?) and confidence (how certain are we this location has a real problem?) is a deliberate design choice and a candidate for further methodological refinement in future work.

The pre-confidence composite score is preserved in the `raw_score` field of the `recurrence_cache` table and all API responses. This allows direct comparison of pre- and post-confidence rankings as a sensitivity analysis, and ensures the modification is fully transparent and reversible. The `CONFIDENCE_THRESHOLD_COMPLAINTS = 5` constant is defined in `backend/services/scoring.js` so the threshold can be adjusted systematically. The nightly batch job summary log reports the count of confidence-discounted grid points (those with `complaint_count < 5`) to make the practical scope of the modifier observable.

The z-score anomaly detection module currently in development applies a normality assumption to complaint count distributions. This is a known approximation: complaint counts are more accurately modeled as Poisson-distributed events, particularly in sparse grid cells where counts are small. The normality assumption introduces bias in low-count cells and is a candidate for replacement with Poisson-based detection methods in future work (Mukhopadhyay et al., 2022).

### 4.8 Baseline Comparison and Score Distribution

*The figures in this section were measured against the current 15/40/35/10 weighting (Section 4.1, Section 4.5) after the `compute-scores.js` batch job run of 2026-08-21. They supersede the figures measured under the original 40/30/20/10 weighting; see the note at the end of this section for how the two compare.*

A comparison of Nashville's top 15 locations by raw complaint volume versus recurrence score now shows **complete divergence at the top, not convergence.** The top 15 locations by complaint volume are, without exception, downtown Broadway-corridor grid points (1,791–5,547 complaints, all Streets, Roads & Sidewalks) scoring between 0.26 and 0.35. None of them appear anywhere in the top 15 locations by recurrence score. The top 15 by recurrence score instead consist of sparse outer-Nashville locations — 4 to 24 complaints, predominantly Electric & Water General water outages, and a cluster of four Bridge Damage locations — scoring between 0.42 and 0.54, roughly 30–55% higher than the busiest location in the entire city.

| Rank | By complaint volume | | By recurrence score | |
|---|---|---|---|---|
| | Count | Score | Score | Count |
| 1 | 5,547 | 0.3473 | 0.5399 | 8 |
| 2 | 5,177 | 0.3363 | 0.4837 | 10 |
| 3 | 4,811 | 0.3238 | 0.4827 | 5 |
| 4 | 4,578 | 0.3185 | 0.4610 | 23 |
| 5 | 3,413 | 0.3120 | 0.4464 | 24 |

This is a stronger version of the same finding reported under the original weighting (where the top 9 rankings were identical and divergence began at rank 10): lowering frequency's weight from 0.40 to 0.15 means the busiest single location in Nashville — 5,547 complaints, accumulated over years — no longer outranks a location with 8 recent, high-severity water-outage complaints. A city planner using naive complaint-count ranking would never examine a location with 8, 10, or 23 complaints; the recurrence score says exactly these locations should be examined first.

This divergence is the core empirical justification for the scoring methodology: locations with persistent, recent, high-severity utility failures in outer Nashville are systematically underrepresented in raw complaint volume but correctly elevated by the recurrence scoring engine. This finding is consistent with the broader emergency response management literature's characterization of frequency-based approaches: Mukhopadhyay et al. (2022) note that frequency analysis "neglects fluctuations in incident occurrence and requires a large volume of incident data to infer accurate characteristics" — a limitation directly observable in Nashville's outer-district complaint data.

Recurrence scores across Nashville's 30,979 scored grid points range from 0.0212 to 0.5399 (mean 0.172, median 0.193). Because the distribution is right-skewed with a long tail of high-severity/high-recency outliers rather than a smooth spread, percentiles are more informative than the mean:

| Percentile | Score |
|---|---|
| 50th (median) | 0.193 |
| 75th | 0.217 |
| 90th | 0.240 |
| 95th | 0.257 |
| 99th | 0.301 |
| 99.9th | 0.385 |
| max | 0.540 |

Scores should be interpreted relative to each other and relative to this distribution, not against an absolute scale — a score of 0.30 is not "30% as bad as it could theoretically get," it is a location in the top 1% of Nashville by this formula's measure of recency-weighted, severity-weighted infrastructure concern. District-level filtering in the priority queue is recommended for identifying high-priority locations within specific neighborhoods. This percentile table is also the basis for the `generateHistoricalContext()` priority-message thresholds documented in Section 4.7 and in `backend/services/scoring.js`.

**Comparison to the original 40/30/20/10 weighting:** under that formula, scores ranged from approximately 0.02 to 0.62 with the majority of locations in the 0.15–0.35 band, and the top 9 locations by volume and by score were identical. The revised formula compresses the top of the distribution (the single busiest location in the city drops from roughly 0.52 to 0.35) while *expanding* the effective range for sparse, severe, recent locations (the highest-scoring location in the city rises to 0.54, higher than the old formula's citywide maximum). Section 4.9 reports both weightings side by side and states plainly what each one does and does not surface; the claim that the revised weighting is *better* is deliberately not made there.

### 4.9 Weight Sensitivity Analysis — Reporting Both Weightings

**Why this section exists.** The weights were revised once during development in response to inspecting ranked output (Section 4.1). Output inspection is a legitimate way to *discover* that a formula does not behave as its documentation claims, but it is not a calibration procedure, and it cannot establish that the revised weights are correct. No ground-truth data on actual Nashville maintenance outcomes is available to calibrate against (Section 7). Presenting 15/40/35/10 as the settled answer would therefore overstate what the evidence supports. This section instead reports both weightings as a sensitivity analysis and characterizes what each one measures.

The comparison is exact rather than approximate. `compute-scores.js` persists all four sub-scores per grid point, so both composites are re-derived from the *same* stored sub-scores by `backend/scripts/weight-sensitivity-analysis.js`. Complaint data, recency reference time, and confidence factors are held identical across both; the only variable is the weight vector. The script is rerunnable and its output is the source of every figure below.

**Headline result: the two weightings are near-disjoint at the top of the queue.** They share only 8 of their top 20 locations and 16 of their top 30. More importantly, they disagree completely about *what kind of place* belongs at the top:

| | A — 40/30/20/10 | B — 15/40/35/10 |
|---|---|---|
| Highest-ranked location | n=5,547 (downtown Broadway) | n=8 (southwest fringe) |
| Complaint count, top 20 (min/median/max) | 4 / 2,495 / 5,547 | 4 / 5 / 24 |
| Locations with n ≥ 1,000 in top 30 | 14 | 0 |
| First fringe (low-n) entry | rank 8 | rank 1 |
| First dense (n ≥ 1,000) entry | rank 1 | none in top 30 |
| Citywide maximum score | 0.5228 | 0.5399 |

**This is the central tradeoff, stated plainly.** Weighting A produces a volume-recurrence ranking: it surfaces the downtown corridor first and reaches outer-city utility failures at rank 8 and below. Weighting B produces a severity-recency ranking: it surfaces sparse, recent, high-severity utility failures first and does not include a single high-volume downtown location anywhere in its top 30 — the 5,547-complaint Broadway cell that ranked first under A appears nowhere near the top under B. Neither behavior is self-evidently correct, and the choice between them is a research design decision, not an empirical finding:

- A city planner handed queue B would observe that the busiest corridor in Nashville is absent from the first thirty entries, which is a legitimate reason to distrust the tool regardless of the formula's internal logic.
- A city planner handed queue A would observe a ranking that a simple complaint-count sort would largely reproduce at the top, which is precisely the redundancy this project argues against.

The honest characterization is that these two weightings answer different questions, and the project's thesis — that volume-based prioritization misses severe, recent, outer-city infrastructure failures — is supported by the *existence of the divergence* between them, not by asserting that B's ordering is the true priority ordering. Reporting only B, and describing it as an improvement over A, would be claiming more than the data can support. A product that surfaced both orderings as distinct views would represent this uncertainty more faithfully than a single blended weight vector, and is the recommended direction (see Section 7).

**Two defects this analysis surfaced that are independent of the weight choice.** Both were present under the original weighting and are not caused by the revision; the revision changed how visible they are. Neither should be addressed by adjusting weights.

*1. Grid-cell fragmentation — the queue is substantially redundant.* Adjacent 200m grid cells covering one real-world site each occupy their own queue slot, so a single location consumes multiple ranks. Single-link clustering of the top 30 at a 500m radius shows this is severe under both weightings, and *worse* under A:

| | A — 40/30/20/10 | B — 15/40/35/10 |
|---|---|---|
| Distinct sites in top 30 | 9 | 15 |
| Distinct sites in top 20 | 6 | 10 |
| Slots consumed by the 5 largest sites | 26 of 30 | 20 of 30 |
| Largest single site | 14 slots (ranks 1–7, 9–12, 18, 23, 25) | 6 slots (ranks 3, 6, 14, 16, 20, 29) |

Under A this redundancy was easy to miss because the 14 duplicated slots were all downtown cells, and a reader scanning the list would read them as "the busy corridor" rather than as one site repeated fourteen times. Under B the duplicated sites are scattered, which makes the fragmentation conspicuous — but the defect is strictly worse under A by every measure above. The fix is spatial deduplication (collapsing cells within a clustering radius into a single ranked entry with a representative point) applied before the queue is presented, which is a change to result presentation, not to scoring. This is logged as required future work; the queue's current top-N should be read as "top N grid cells," not "top N places."

*2. The confidence factor is being out-run rather than failing.* The multiplier `min(1, n/5)` is applied correctly, but because it is multiplicative it cannot gate a raw composite that rises faster than the discount shrinks it. Under B, two locations with n=3 reach ranks 26–27 with a pre-confidence raw composite of 0.6555 — which exceeds the entire citywide maximum under weighting A (0.5228) — and survive a 0.6 multiplier to land at 0.3933. Nine of B's top 30 locations sit below the n=5 corroboration threshold, versus five of A's. This is a structural limitation of expressing corroboration as a multiplier on a score whose achievable range depends on the weights: raising recency and severity weights raises what a single recent severe report can achieve pre-confidence, so the same multiplier gates less. A corroboration mechanism that does not scale with the weight vector — a hard floor on `n` for queue eligibility, a confidence interval on the score, or a Poisson-based lower-bound estimate rather than a point estimate discounted after the fact — would be a more robust design. This is a known limitation, not a solved problem.

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

This project does not claim to provide a production-ready infrastructure management system for the City of Nashville. It does not claim that the severity weights assigned in Section 3 are objectively correct — they represent one reasonable operationalization of infrastructure severity informed by civil engineering principles and are explicitly documented so they can be critiqued and revised.

**It does not claim that the recurrence scoring formula's weights are calibrated, optimal, or uniquely defensible.** This claim requires care, because an earlier version of this section asserted that the weights were "derived through principled reasoning rather than empirical calibration," which understated how the current values were actually arrived at. The full history is: the weights were specified a priori as 40/30/20/10 from design reasoning (Section 4.5); analysis then showed those stated weights did not describe the formula's actual behavior, because normalizing frequency against the citywide maximum collapsed its effective contribution to near-zero across most of the city (Section 4.1); the weights were revised to 15/40/35/10 in response to that finding. The revision was prompted by inspecting the formula's behavior and its ranked output. That is a legitimate way to discover a documentation-behavior mismatch, but it is not calibration, and it provides no evidence that 15/40/35/10 is correct — only that 40/30/20/10 was not describing what the system did.

No ground-truth data on actual Nashville maintenance outcomes, repair urgency, or infrastructure condition is available to calibrate any weight vector against; that would require Metro internal work-order and asset-condition data not present in public datasets. Absent such data, the specific numeric values 15/40/35/10 should be read as one defensible configuration among several, not a result. Section 4.9 therefore reports both weightings side by side on identical data, documents that they share only 8 of their top 20 locations, and states what each surfaces and omits rather than designating one as correct. A reader asking "why 15/40/35/10 rather than some other vector?" should be given that section's answer — that the two configurations answer different prioritization questions and the divergence between them is the finding — rather than a claim of optimality that the available data cannot support.

What this project does claim is that the methodology is transparent, reproducible, and grounded in a defensible research rationale; that it produces meaningfully different prioritization outputs than naive complaint-count ranking — demonstrated empirically by the baseline comparison and sensitivity analysis in Sections 4.8 and 4.9, which show that severity- and recency-weighted scoring surfaces outer-Nashville utility infrastructure locations with 3–24 complaints that a volume-based ranking would never reach, while a volume-weighted configuration of the same formula surfaces the downtown corridor instead; and that it provides a tractable empirical framework for asking the equity question at the center of this project.

Two implementation limitations are load-bearing enough to restate here, both documented in Section 4.9 and both independent of the weight choice: the priority queue ranks 200m *grid cells* rather than deduplicated places, so a single site can occupy several consecutive ranks (under either weighting, the top 30 collapses to 9–15 distinct sites); and the confidence factor, being a multiplier, gates low-corroboration locations less effectively as the weights raise what a single severe recent report can score pre-confidence. Neither is fixed by adjusting weights, and no results from the priority queue should be read as a ranking of distinct physical locations until spatial deduplication is implemented.

---

*Document authored prior to implementation as a research design exercise. Severity weights and formula parameters are subject to revision as analysis proceeds. All revisions will be logged in CHANGELOG.md with reasoning.*
