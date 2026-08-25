# The question has a name, and a nineteen-year literature

**2026-08-25.** Claude and ChatGPT each swept the internet independently for
anything that could improve this project — papers, projects, other fields — then
compared. This is the merged result.

The single most useful finding is that **the research question is not new, and
not a Minecraft question.**

---

## 1. It is called the Zollman Effect

> *"A more sparsely connected community has epistemic advantages over a more
> connected one in that the former learns the true belief more frequently, but
> a more sparsely connected community also learns the truth more slowly."*
>
> *"Complete networks are fast but fragile; they converge quickly on whatever
> early signals suggest, and if those signals are wrong, the entire community is
> locked into error."*

That is "does shared memory make a collective learn faster **and** be wrong
faster", formalised by Kevin Zollman in 2007 and studied ever since.
[PhilPapers](https://philpapers.org/rec/ZOLTCS) ·
[Cambridge](https://www.cambridge.org/core/journals/philosophy-of-science/article/abs/communication-structure-of-epistemic-communities/B1A3770084C04C26A3533626E7AABBFD)

**Our arms are network topologies.** `hive` is a complete network. `isolated` is
disconnected. `board` is a costly, partial channel. `placebo` is disconnected
plus the cost. We are running an embodied version of Zollman's simulation with
LLM agents instead of Bayesian ones — which, as far as either sweep could find,
nobody has done.

The mechanism has a name too: **transient diversity**. Early disagreement
protects a group from converging prematurely on a wrong answer. Connectivity
destroys it.

**It has already been shown in robots.** *When less is more: Robot swarms adapt
better to changes with constrained communication*, Science Robotics —
[link](https://www.science.org/doi/10.1126/scirobotics.abf1416).

### What this changes immediately

Zollman's metric is **the proportion of runs converging on the correct action**,
over ~10,000 runs. We have four pools per arm. That is not four runs — the unit
should be the **belief**, not the pool. Each stored lesson is a bandit arm a
pool has converged on, and we can check whether it is true.

That turns n=4 into n=(pools × beliefs), and it is the sample-size fix the
underpowered design has been missing.

---

## 2. How to measure "wrong faster" properly

Both sweeps independently reached epidemiology. ChatGPT found the canonical
reference: Vosoughi, Roy & Aral compared true and false diffusion in
[Science](https://www.science.org/doi/10.1126/science.aap9559) using **speed,
reach, depth, breadth and structural virality** — not contradiction counts,
which is all we currently have.

Concretely, per claim: `false_claim_Rt`, `time_to_25%_adoption`,
`false_belief_bot_minutes`, `correction_half_life`, `max_depth`, `max_breadth`.

**Provenance is the part we would get wrong without this.** Every memory item
needs parent claim ids, because *five bots agreeing is not five independent
observations if four of them copied the first.* Metrics: `independent_sources`,
`lineage_entropy`, `copy_depth`. Without it, hive will look better-informed than
isolated purely by echo.

---

## 3. The experiment worth copying wholesale

Lorenz et al., [PNAS](https://www.pnas.org/doi/10.1073/pnas.1008636108): social
influence **reduces diversity without improving accuracy**, pushes the truth
toward the edge of the group's range, and **increases confidence without
increasing accuracy**.

The design is directly portable: before a bot reads hive or board memory, make
it commit to an independent estimate — nearest resource direction, expected
success probability, expected time. Then expose the shared memory and ask again.

    diversity_loss  = Var(pre) − Var(post)
    accuracy_delta, confidence_delta, truth_percentile_in_pool_range

That measures "learns faster but becomes confidently wrong faster" **directly**,
rather than inferring it from productivity. It is the closest thing to a
purpose-built instrument for our actual question.

---

## 4. Mechanisms from other fields that break bad consensus

Both sweeps found consensus-breaking mechanisms; neither found them in the same
place.

**Cross-inhibition / stop signals** (honeybee house-hunting). Scouts do not just
recruit for their preferred site — they actively *inhibit* scouts recruiting for
rivals. Our memory only ever accumulates: a contradicting observation adds a
counter-record, it never suppresses the belief. A stop-signal analogue is a
small change with a strong biological precedent.

**Pheromone evaporation** (ant colony optimisation). ACO needs decay or early
paths dominate forever — classic premature convergence. Our salience should
decay unless refreshed by *measured evidence*, never by repetition:

    score = evidence_weight × recency_decay × independent_sources − contradictions

**Quorum thresholds** (best-of-n swarm robotics). Our beliefs propagate on a
single report. Swarms require a quorum before commitment.

**The illusory truth effect**, now studied in epistemic networks —
[Three People Make a Tiger](https://www.tandfonline.com/doi/full/10.1080/02691728.2025.2463057)
— is exactly the failure mode repetition-without-evidence creates.

---

## 5. Things with evidence that we could use, and one to avoid

**Hidden-profile tasks.** Distribute private evidence so no single bot can solve
alone; groups reliably over-discuss shared information and neglect unique
information (65 studies, 3,189 groups). There is already an LLM-agent benchmark:
[HiddenBench](https://arxiv.org/abs/2505.11556). This is the cleanest bridge
from "Minecraft productivity" to "collective epistemics", and it would make our
results comparable to somebody else's.

**Falsifiable memories with Brier scores.** Convert memories from advice into
propositions with `p_true`, `expires_at` and a verification plan, then score
them. Calibration and overconfidence-on-false-claims become measurable.

**Constrained decoding** for planner output — typed skill + args + confidence,
enforced by grammar. Well-suited to a 7B.
[JSONSchemaBench](https://arxiv.org/abs/2501.10868)

**AVOID: asking the 7B to "reflect".** Intrinsic self-correction does not
replicate — models often cannot self-correct without external feedback and
[may degrade](https://arxiv.org/abs/2310.01798). At equal token cost, repeated
sampling beats Self-Refine/Reflexion for 1.5B–7B models. Use *repair from
observation* — "failed because inventory unchanged, path blocked, target absent"
— which our evidence gate already produces.

---

## Ranked, by value over effort

| # | What | Cost | Why it matters here |
|---|---|---|---|
| 1 | **Belief-level unit of analysis** (Zollman) | ~1 day | Turns n=4 into n=(pools × beliefs). Fixes the power problem without hardware. |
| 2 | **Claim provenance / lineage** | 2–4 d | Without it, echo reads as independent corroboration and hive wins by artefact. |
| 3 | **Diffusion metrics** (Rt, depth, breadth, correction half-life) | 1–3 d | Replaces contradiction-counting with the field's standard vocabulary. |
| 4 | **Evidence-decay on memory salience** (ACO) | ~1 day | Directly attacks herding; repetition stops being persuasive. |
| 5 | **Pre/post independent estimate** (Lorenz) | 2–4 d | Measures the actual question directly instead of inferring it. |
| 6 | **Seeded true/false claims** | 1–2 d | Organic false beliefs may be too sparse to measure; matched pairs fix that. |
| 7 | **Hidden-profile microtasks** | 3–5 d | Comparability to an existing benchmark. |
| 8 | **Constrained decoding** | 1–3 d | Cheap reliability win on a small local model. |
| 9 | **Cross-inhibition stop signal** | 2–3 d | Novel here; strong biological precedent. |

Items 1–4 are instrumentation, not behaviour: they can be built and even
back-applied to existing telemetry **without touching the fleet or disturbing a
measurement window.**

## Where the two sweeps differed

Claude found the Zollman literature, the Science Robotics replication, transient
diversity and honeybee cross-inhibition — the *theory* of the question.

ChatGPT found Lorenz, hidden-profile/HiddenBench, Brier scoring, provenance and
anti-entropy, and the self-correction non-replication — the *instruments*.

Neither found the other's. The overlap was the epidemiological framing for false
belief, which both reached independently from different directions — which is
the strongest signal in the whole exercise that it is the right frame.
