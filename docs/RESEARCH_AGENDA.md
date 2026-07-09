# Research Agenda
## From NashAlert Prototype to Formal Methods for Infrastructure Maintenance Under Uncertainty
*Kunal Kaushik | Vanderbilt CS '23*

---

NashAlert is a spatiotemporal infrastructure prioritization system built on Nashville's full 311 open dataset — 334,710 complaints across 2017–2026, scored across 30,979 geospatial grid points using a composite recurrence engine (frequency, exponential recency decay, severity weighting, and resolution time). The system already surfaces something a naive complaint-volume ranking cannot: outer Nashville locations with concentrated but low-frequency infrastructure complaints that would be invisible under a counts-based approach. That finding points directly at the equity problem — complaint volume is not infrastructure need, and a prioritization system that conflates them systematically under-serves communities with lower reporting rates.

## NashAlert as a Research Baseline

But NashAlert is a prototype, not a research contribution. The scoring weights are heuristic. The recency decay constant is assumed, not learned. The anomaly detection is a z-score baseline that treats grid cells independently and misses spatially correlated failure signatures. The inspection routing is a greedy orienteering heuristic with no approximation guarantee and no way to incorporate equity constraints formally. Most importantly, the system is static — it has no model of how Nashville's complaint distribution shifts as the city grows, no feedback loop between inspection outcomes and future scoring, and no formal representation of the fact that I'm observing a noisy signal (complaints) about a latent state (actual infrastructure condition) I can never directly see.

I see three connected research thrusts:

## Thrust 1 — Debiased Observation Modeling

311 complaint data is not a direct measure of infrastructure need — it is a biased, spatially uneven, socioeconomically mediated signal. Wealthier, better-connected neighborhoods generate more complaints per underlying problem. Any prioritization system that doesn't model this bias will reproduce it. I want to develop statistical models of the complaint-to-need relationship that incorporate demographic covariates to produce debiased infrastructure risk estimates.

## Thrust 2 — Decision-Theoretic Maintenance Allocation Under Partial Observability

The infrastructure prioritization problem has the formal structure of a Partially Observable MDP: the true condition of infrastructure is hidden, observations are noisy complaints, and inspection resources are limited. I want to formalize this, develop scalable approximate solution methods using hierarchical decomposition inspired by recent emergency response planning literature, and evaluate whether decision-theoretic prioritization measurably outperforms heuristic scoring on both efficiency and equity metrics. RESPOND — a modular incident-level simulation platform (Zulqarnain et al., 2026) — suggests what an analogous infrastructure simulator would look like: a testbed where I can evaluate coupled scoring and routing policies counterfactually before any city deploys them.

## Thrust 3 — Online Adaptation to Non-Stationary Demand

Nashville's infrastructure complaint distribution is non-stationary — it shifts with population growth, infrastructure age, seasonal cycles, and the outcomes of prior maintenance actions. A scoring system calibrated on 2019 data is already partly wrong for 2026. I want to develop online demand models that detect and adapt to structural shifts in complaint distributions, evaluated on held-out 311 data. The long-run question is whether an agent trained in a simulated NS-MDP environment can be deployed in a real city and maintain calibrated prioritization as the city evolves around it.

## How the Thrusts Connect

These three thrusts are not independent. The debiased observation model feeds into the POMDP's emission function. The POMDP's value function informs the routing optimizer's prize assignment. The non-stationary demand model determines how the POMDP's transition dynamics are updated online. Together they form a coherent system: one that treats infrastructure maintenance as what it actually is — a sequential, uncertain, equity-sensitive resource allocation problem — rather than a queue sorted by complaint counts.

---
*Kunal | NashAlert | Vanderbilt CS '23*
