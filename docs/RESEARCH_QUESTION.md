# Research Question
## NashAlert: Community-Sourced Infrastructure Reporting and Prioritization for Nashville, TN

---

## 1. What problem does NashAlert address?

Urban infrastructure — roads, drainage systems, sidewalks, water mains, traffic signals — degrades unevenly across a city. The rate of degradation depends on the age of the infrastructure, intensity of use, environmental exposure, and the responsiveness of municipal maintenance systems. In Nashville, as in most mid-sized American cities, the primary mechanism for residents to flag infrastructure failures is the 311 non-emergency service request system. A resident notices a pothole, calls or submits online, and the complaint enters a queue.

This system has two structural weaknesses that motivate this project.

The first is **reactivity**. The 311 system captures failures only after a resident notices and reports them. It has no mechanism for recognizing that a location has been reported repeatedly over years, that complaints at a given site cluster seasonally, or that co-occurring complaint types at nearby locations may indicate a shared underlying cause — such as subsurface pipe failure manifesting simultaneously as road surface damage and localized flooding. Each complaint is treated as an isolated event rather than a signal in a longer pattern.

The second is **reporting inequality**. Infrastructure failures do not distribute themselves evenly across income levels, but neither do reports. Higher-income neighborhoods tend to be more vocal, more digitally connected, and more experienced with navigating municipal systems. Lower-income neighborhoods may experience equal or greater infrastructure stress while generating fewer formal complaints — meaning their needs are systematically underrepresented in the very data that drives maintenance prioritization. If a city allocates repair resources in proportion to complaint volume, it may inadvertently reinforce existing inequalities rather than correct them.

NashAlert addresses both weaknesses. It is a two-component civic technology system: a mobile application that enables Nashville residents to submit real-time infrastructure reports, and a web-based dashboard that surfaces historical 311 patterns, computes location-level recurrence scores, and presents a prioritized maintenance queue for city planners and researchers. By combining community-sourced real-time reports with years of historical open data, and by layering in Census income data to test for reporting disparities, NashAlert attempts to make infrastructure maintenance prioritization both smarter and more equitable.

---

## 2. What specific question are you trying to answer with the data?

This project is organized around two related research questions, one operational and one equity-focused:

**Primary question:**
> Can community-sourced real-time infrastructure reports, when combined with historical Nashville 311 open data and a recurrence-weighted scoring algorithm, produce a more informed and defensible infrastructure maintenance priority queue than complaint volume alone?

**Secondary question:**
> Do lower-income Nashville census tracts exhibit higher infrastructure complaint recurrence rates relative to their 311 report volume — and if so, does this disparity suggest systematic underreporting that a passive complaint-driven prioritization system would fail to correct?

The primary question is a systems and software question: does the scoring methodology produce prioritizations that are meaningfully different from, and arguably better than, a naive ranking by complaint count? It is evaluated by comparing the output of the recurrence scoring engine against a simple frequency ranking and examining where the two diverge — those divergences are the cases worth studying.

The secondary question is an equity question: it requires joining 311 complaint data with U.S. Census tract-level median household income data for Nashville and testing whether the relationship between infrastructure stress (as measured by recurrence score) and report volume differs systematically by income level. The hypothesis, grounded in prior literature on civic participation and digital access, is that lower-income tracts will show higher recurrence scores per complaint — meaning they experience persistent infrastructure problems that are proportionally underreported relative to their severity.

---

## 3. Why does this matter civically?

My interest in this problem is not purely academic. During my time as a student at Vanderbilt, I moved through different parts of Nashville regularly — between campus, East Nashville, areas along Nolensville Pike, and neighborhoods further from the university. The difference in road surface quality, sidewalk continuity, drainage during heavy rain, and general infrastructure upkeep across these neighborhoods was not subtle. It was the kind of difference you notice without looking for it.

What struck me, once I started thinking about it more carefully, was that the neighborhoods with the most visible infrastructure stress were not the ones most likely to have their grievances heard through formal channels. A flooded intersection in a lower-income neighborhood south of downtown and a pothole in a wealthier neighborhood near Green Hills may both generate 311 complaints — but the latter is more likely to be submitted promptly, followed up on, and escalated if unresolved. The former may go unreported entirely, or be reported once and forgotten.

This matters because infrastructure is not an abstraction. A road that floods regularly is a road that people cannot reliably use to get to work. A broken sidewalk in a neighborhood without cars is an accessibility failure. A water main that has been complained about for two years without resolution is a public health risk. Infrastructure inequity translates directly into unequal access to the basic conditions of urban life.

At a civic technology level, NashAlert matters because it demonstrates that the data to identify these disparities already exists — it is sitting in Nashville's open data portal, publicly available, underused. The gap is not in data collection but in analytical framing. By reframing 311 data from a complaint log into a signal about infrastructure health, and by asking explicitly whether the signal is weaker in lower-income areas, NashAlert contributes to a growing body of work on algorithmic fairness in municipal resource allocation.

At a research level, this project sits at the intersection of cyber-physical systems, civic data science, and urban infrastructure — a space where computational methods can have direct, legible impact on how cities serve their residents.

---

## 4. What would a meaningful finding look like — in either direction?

A meaningful finding does not require confirming the hypothesis. Either direction produces research value, and intellectual honesty about which direction the data points is more important than arriving at a predetermined conclusion.

**If the hypothesis is confirmed** — lower-income Nashville tracts show higher recurrence scores per unit of complaint volume — this would suggest that a complaint-volume-driven prioritization system is not equity-neutral. It would provide empirical grounding for the argument that Nashville (and cities using similar systems) should weight infrastructure maintenance decisions by recurrence and persistence of complaints, not just raw volume. It would also point toward a concrete policy intervention: a recurrence-adjusted priority queue of the kind NashAlert's dashboard implements.

**If the hypothesis is not confirmed** — income level does not predict the ratio of recurrence score to complaint volume — this is also a meaningful finding. It would suggest that Nashville's 311 system may be more equitably utilized than prior literature on civic participation would predict, or that the specific infrastructure complaint categories captured in 311 data do not exhibit the reporting disparity that other forms of civic engagement do. This would warrant further investigation into whether the disparity exists in other dimensions not captured here — response time, resolution rate, or complaint escalation patterns.

**In either case**, the scoring methodology itself — the recurrence-weighted prioritization engine — produces a research contribution independent of the equity finding. A system that surfaces persistent, multi-year infrastructure problems that a naive complaint count would deprioritize is useful regardless of whether those problems cluster by income. The equity analysis sharpens the research question; it does not define the entire value of the project.

**The most interesting finding** would be a specific class of locations: sites with high recurrence scores and low complaint volume, concentrated in lower-income tracts. These are the places the current system is most likely to miss — and they are the places NashAlert is most directly designed to surface.

---

## 5. Relationship to Prior Work and Research Trajectory

This project grows directly out of collaborative work undertaken with Dr. Daniel Balasubramanian at Vanderbilt's ISIS lab during the senior year of my undergraduate degree. That project — a lost and found animal reporting mobile application for Nashville using open civic data — established two things that carry forward into NashAlert: a working methodology for building community-facing civic applications on top of Nashville's open data infrastructure, and a conviction that software systems designed around public data can meaningfully serve Nashville residents beyond the university.

NashAlert extends that foundation in three directions. First, it moves from a relatively bounded problem domain (lost animals) to a higher-stakes one (infrastructure maintenance), where the consequences of system failures are more severe and the equity dimensions more significant. Second, it adds an analytical layer — the recurrence scoring engine and equity analysis — that was not present in the prior project, moving from a reporting tool toward a decision-support system. Third, it connects to the broader Smart & Connected Communities research agenda at ISIS, particularly the work of Dr. Balasubramanian on community safety through open data and Dr. Abhishek Dubey on decision-making under uncertainty for societal-scale cyber-physical systems.

The intended research trajectory beyond this project would explore whether the scoring methodology generalizes to other mid-sized cities with open 311 data, whether community-sourced reports meaningfully improve prioritization accuracy over historical data alone, and whether the equity findings replicate across different urban contexts. These questions are tractable at the PhD level and form a natural research agenda at the intersection of smart city systems, civic data science, and algorithmic fairness.

---

*Document authored prior to project implementation as a research framing exercise. Last updated: project initialization.*
