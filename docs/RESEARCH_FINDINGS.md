# Research Findings

**Last updated:** 2026-08-21

This document records what the analysis has actually established, what it has ruled out, and what remains open. It is deliberately structured so that the negative results and retractions are as prominent as the positive ones.

**Scope warning up front.** The primary research question has been partially answered. The secondary (equity) question has **not** been answered at all — it depends on the Census ACS tract-level income join, which is incomplete. No finding in this document supports any claim about how infrastructure burden is distributed by income in Nashville. Two implementation defects documented in Section 5 also bound how the priority queue output should be read.

Every figure below is reproducible from `backend/scripts/weight-sensitivity-analysis.js` and `backend/scripts/weight-sweep.js` against the `recurrence_cache` table, and is cross-referenced to the relevant section of [METHODOLOGY.md](METHODOLOGY.md).

---

## 1. The headline result: the queue is dominated by locations volume ranking cannot reach

Ranking Nashville's 30,979 scored grid points by recurrence score produces a priority queue almost entirely disjoint from a ranking by complaint count.

After spatial deduplication at 500m, the **top 20 distinct sites have a median complaint count of 6.** The highest-scoring site in the city has 8 complaints. A city planner sorting by complaint volume would never examine any of these locations — the volume ranking is led by a downtown cell with 5,547 complaints accumulated over nine years.

This is the project's central empirical claim, and the important property is its robustness. It is **not** an artifact of the particular weights chosen. The median top-20 complaint count is 6 under *both* the original 40/30/20/10 weighting and the revised 15/40/35/10 weighting, and remains so at every point along the interpolation path between them (METHODOLOGY §4.9.1, §4.9.3). The finding holds across the entire weight range from frequency-dominant to severity-dominant, rather than depending on one favorable configuration.

**Interpretation in the honest direction.** This establishes that recurrence scoring produces *different* prioritization than volume ranking. It does not establish that the different answer is *better*. That would require ground-truth data on actual maintenance urgency — Metro work-order and asset-condition records — which is not public and which this project does not have (METHODOLOGY §7). The claim supported by the evidence is divergence, not superiority.

---

## 2. The scoring weights matter far less than expected — a retraction

This is a case where the analysis contradicted an earlier claim made in this project's own documentation, and the earlier claim has been withdrawn.

An intermediate version of METHODOLOGY §4.9 argued that the two weight configurations "answer different prioritization questions" and that the ranking was substantially underdetermined by the uncalibrated weight choice. A systematic weight-space sweep does not support this.

Measured as top-k overlap over deduplicated sites:

| Test | Result |
|---|---|
| ±0.05 perturbation to any single weight, k=20 | mean overlap 0.938–0.950, worst case 0.850 |
| ±0.05 perturbation to any single weight, k=10 | mean overlap 0.938, worst case 0.800 |
| Full 20-step interpolation path, A → B | no adjacent step reorders more than one site |
| Endpoint-to-endpoint, 40/30/20/10 vs 15/40/35/10 | 18 of top 20 sites shared |

Traversing the *entire* distance from a frequency-dominant to a severity-dominant configuration changes only 2 of the top 20 sites, with no discontinuity anywhere along the path (METHODOLOGY §4.9.2).

**Why this cuts in the project's favor rather than against it.** A reader's natural suspicion is that an uncalibrated weight vector is doing the analytical work, making the headline result in Section 1 an artifact of tuning. The sweep says the opposite: the result survives the full range of weights considered, so it rests on the structure of the data rather than on a parameter choice that cannot be justified. This is a stronger position than the one the earlier documentation claimed.

**What the weights *do* control.** One thing, robustly and monotonically: whether the dense downtown core appears in the queue at all. Along the A→B path, the number of top-20 sites with at least 1,000 complaints falls 2 → 1 → 0 (METHODOLOGY §4.9.3). Under the deployed weighting, Nashville's busiest corridor does not appear in the top 20 — which is a legitimate reason for a city planner to distrust the queue, and is called out as such rather than defended.

What remains genuinely unadjudicated is narrow: **whether the downtown corridor belongs at the top of a maintenance priority queue at all.** That is a policy question about what prioritization is for — triaging the highest-traffic corridor versus the most acute unattended failure — and no quantity of 311 data answers it.

---

## 3. A large apparent effect turned out to be a measurement artifact

Compared at the level of individual 200m grid cells, the two weight configurations look nearly disjoint: they share only 8 of their top 20 cells. Configuration A's top 30 cells contain 14 locations with at least 1,000 complaints; Configuration B's contain zero.

That comparison is misleading, and the reason is instructive. A queue of *cells* is not a queue of *places*. Adjacent cells covering one real site each occupy their own rank, so one location can consume many slots. Repeating the comparison over deduplicated sites raises the top-20 overlap from 8/20 to 18/20 (METHODOLOGY §4.9.1).

The dependence on deduplication radius is itself the evidence, and it behaves exactly as the fragmentation explanation predicts:

| Dedup radius | A vs B overlap (k=20) | Dense sites in A's top 20 |
|---|---|---|
| 150m (below grid spacing) | 0.40 | 12 |
| 250m | 0.65 | 7 |
| 350m | 0.85 | 3 |
| 500m | 0.90 | 2 |
| 750m | 0.95 | 1 |
| 1,000m | 0.90 | 1 |

Overlap rises monotonically as merging becomes more aggressive while dense sites fall from 12 to 1 — the divergence disappears in proportion to how much duplication is removed. At 150m, below the grid spacing, the metric returns exactly 8/20, reproducing the cell-level figure and confirming that deduplication is the only thing separating the two measurements.

**Disclosed conditionality.** The A-vs-B similarity figure is strongly radius-dependent, and 500m was chosen before this sensitivity was measured. The defensible range is bounded below by the 200m scoring radius: two cells less than ~400m apart draw on substantially overlapping complaint sets and are not independent observations. Across the defensible 350m–1,000m range, overlap is 0.85–0.95, so the conclusion holds — but conditional on treating a "place" as something on the order of a few hundred meters. Local stability, by contrast, is insensitive to the radius across the entire 150m–2,000m range (METHODOLOGY §4.9.2).

---

## 4. A negative finding: the score distribution says nothing about geographic concentration

Recurrence scores across the 30,979 scored points run from 0.021 to 0.540, with a median of 0.193 and an interquartile range of 0.140–0.217. The distribution is tightly compressed.

An earlier version of this project's documentation and paper draft interpreted that compression as evidence of "the real geographic concentration of infrastructure stress in Nashville's urban core." **That interpretation is wrong and has been retracted.** The compression is a property of how the score is constructed: recency and severity carry 75% of the weight under the deployed configuration, and both vary far less across Davidson County than complaint volume does. A formula built mostly from low-variance components produces a low-variance output regardless of the underlying geography.

This is recorded as a finding because the error is exactly the inferential mistake this project exists to warn against — reading a property of a measurement instrument as a property of the world. Scores are meaningful relative to one another and carry no absolute interpretation.

---

## 5. Two defects that bound how the output should be read

Both were present under the original weighting, are not caused by the weight revision, and cannot be fixed by adjusting weights (METHODOLOGY §4.9.4).

**The queue ranks cells, not places.** Single-link clustering of the top 30 cells at 500m:

| | A — 40/30/20/10 | B — 15/40/35/10 |
|---|---|---|
| Distinct sites in top 30 | 9 | 15 |
| Distinct sites in top 20 | 6 | 10 |
| Largest single site | 14 of 30 slots | 6 of 30 slots |

The defect is *worse* under the original weighting, where fourteen adjacent downtown cells read to a reader as "the busy corridor" rather than as two places listed fourteen times. Until spatial deduplication is applied before presentation, the queue's top N must be read as the top N grid cells. On the evidence of Section 3, this is a higher-value fix than any further weight adjustment.

**The confidence factor is being out-run, not failing.** The multiplier `min(1, n/5)` is applied correctly, but because it is multiplicative it cannot gate a raw composite that rises faster than the discount shrinks it. Under the deployed weighting, two locations with three complaints reach ranks 26–27 on a pre-confidence composite of 0.6555 — higher than the entire citywide maximum under the original weighting — and survive the 0.6 multiplier to land at 0.3933. Nine of the top 30 cells sit below the five-complaint corroboration threshold. This is a structural consequence of expressing corroboration as a multiplier on a score whose achievable range depends on the weights. A mechanism that does not scale with the weight vector — a hard eligibility floor on `n`, a confidence interval, or a Poisson lower-bound estimate rather than a discounted point estimate — would be more robust. Unsolved.

---

## 6. The equity question is open

No finding on the secondary research question is available. The tract-level join between recurrence scores and Census ACS median household income is not complete, and the dashboard's equity panel currently displays complaint volume by council district only.

Two things are known that will shape the analysis when it runs:

**District 19 is a severe confound.** It carries 40,910 complaints — about 4.4 times the mean across the 36 districts with data, and roughly 2.5 times the next-highest district (District 6, at 16,069). This is not a data error; District 19 covers a large area including the downtown core. Any district-level comparison must handle it explicitly, and population normalization only partly addresses the geographic scale difference (METHODOLOGY §6.3).

**The analysis is circular in a way that cannot be fully escaped.** Recurrence score is computed from complaints, so it inherits the reporting biases the equity question is testing for. A tract with a low score may have sound infrastructure, or may have residents who do not file complaints. 311 data alone cannot distinguish these, which means a null result will be genuinely ambiguous rather than evidence of equitable outcomes. This limitation was identified at design time and remains unresolved.

---

## 7. What would change these conclusions

Stated so the findings can be falsified rather than only supported:

- **Ground-truth maintenance data.** Metro work-order records or asset-condition surveys would allow the queue to be scored against actual repair urgency. This is the single change that would convert the divergence finding in Section 1 into a claim about accuracy. Without it, "different from volume ranking" is the strongest available claim.
- **A sweep over the full weight simplex.** The stability result in Section 2 covers the interpolation path between the two configurations actually used and ±0.05 perturbations around each. It cannot rule out instability in regions far from that path — for example, configurations weighting resolution heavily, which no candidate design proposed. The conclusion should be read as local to the configurations considered.
- **Spatial deduplication implemented before presentation.** This would change the queue that users actually see and would make the Section 1 result directly readable rather than requiring the cell-versus-place caveat.
- **A non-multiplicative corroboration mechanism.** This would likely remove the sparse three-complaint locations from the top 30, changing the composition of the headline result. It is plausible that some of the low-count sites in Section 1 are noise that a better-specified confidence treatment would suppress; this has not been tested and is the most likely source of error in the headline finding.
- **Community-sourced reports.** The primary research question asks whether community reports *combined with* historical data improve prioritization. The mobile app is still in development, so no community reports exist and only the historical-data half of that question has been examined.

---

*Findings are recorded as they are established rather than written once at the end, so that retractions remain visible alongside the results they replace. All revisions are logged in [CHANGELOG.md](CHANGELOG.md).*
