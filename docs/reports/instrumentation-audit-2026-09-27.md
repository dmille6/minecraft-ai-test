# Are we measuring the right things? Plus two specific defects to settle

_written 2026-09-27 19:24Z (date -u). Owner's ask: "sort out the advice bug and veto rate — do we have tools to
measure these metrics or even capture them? are we doing the right analysis on data and metrics to
get good results?"_

That last question is the important one and it is addressed to the whole project, not to one bug.

---

## PART 1 — THE ADVICE BUG (recorded days ago, never built)

`skills.mjs:2759`:
```js
const rootGap = blockedBy.length ? [...new Set(blockedBy)].sort() : missing
```
`.sort()` is **alphabetical**, and `blackstone` < `cobbled_deepslate` < `cobblestone`. So when a
craft is blocked on "some source of cobble", the advice names whichever sorts first.

**MEASURED:** bots are told **1,415 times a day** to gather `cobbled_deepslate`, of which the fleet
has obtained **ZERO, ever**, over `cobblestone`, which succeeds in **7.3% of 2,723 attempts**.

It also appears verbatim inside the redundant-craft failures measured today:
`cannot craft stone_pickaxe -- gather cobbled_deepslate and oak_log first, nothing crafts it`

**Questions:** is a one-line change to sort by *obtainability* correct, or does the ranking belong
somewhere else? What is the right ordering key — historical success rate per block, depth, or a
static preference list? And what is the smallest change that cannot silently reorder something else
that depends on this sort being stable?

## PART 2 — THE VETO RATE, AND I CANNOT MEASURE IT

**MEASURED TODAY:** 74.1% of craft failures (2,189 of 2,956 parsed) target an item the bot ALREADY
HOLDS. `stone_pickaxe` 1,371, with bots carrying six. It is the model: craft rows by trigger are
`llm:idle` **3,832 of 4,130**, against 276 craft work orders.

After 4 failures on one action key, `admission.mjs:631` should veto 4 of every 5 proposals. **So
either the gate is not accumulating on this key, or it is vetoing and 1,371 is what still gets
through. I cannot tell, and that is an instrument gap.**

What I established trying:
- An admission rejection is **not an event**. `cognitive.mjs:789`:
  `outcome = { status: 'aborted', detail: rejection?.detail ?? ... }` — and a skill that never ran
  emits no skill row. **So every craft row in telemetry is one that PASSED the gate.**
- I searched `aborted` rows for `learned_avoid` and found **zero, for every skill**. My positive
  control — expecting thousands of vetoed `explore` — **also came back zero**, so the query is
  wrong, not the fleet. The aborted rows I do see are reflex interrupts: stagnation 1,777,
  entombed 1,769, stuck 557.
- The only veto-shaped kind in 24 h of telemetry is `_veto_faces` (7,104), which is block-face
  selection and unrelated.

**Questions, and the first is the one I most need answered:**
1. **Where does an admission rejection actually become observable?** Find the existing instrument
   before proposing a new one. A memory entry records that both engines once told me to build an
   instrument for exactly this and **it already existed, inside a detail string** — "effective fails
   at veto: median 45, p75 1,776". Does that path still exist at `268c074`?
2. If it genuinely is not observable, what is the **minimum** new instrument? It must be a new
   EVENT and never a new field — the ELK templates are `dynamic:strict` and an unknown field drops
   the whole document.
3. Is the redundant craft a gate failure, a prompt failure, or a `RECENT EVENTS` feedback loop
   (failures appear in the recent-events list and the model re-proposes them)? Name the evidence
   that would separate them.

## PART 3 — THE META QUESTION: ARE WE MEASURING THE RIGHT THINGS?

This is the owner's real question, and I want it answered adversarially.

**What exists.** `scripts/lib/telemetry.py` with `Events.load` / `count` / `rate` / `by_bot` /
`where`, and a `ZeroLooksWrong` exception that raises on a suspicious zero. `halfdid.py` for
pool-hour aggregation. `verdict.py` (gate v32) plus `gatedigest.py`, `licencecheck.py`,
`v30check.py`, `changerowcheck.py`. `mdereplay.py` for replay-based MDE. `canary-loop.sh` to
declare / deploy / read / tear down. RCON for ground truth in-world.

**What today's work suggests is WRONG with how we measure.** Judge each:
1. **My three biggest numbers today were all wrong on the first attempt.** The chest census was
   17x low (the game truncates a long `data get` reply with a literal `...`); "3 items out" was 3
   transactions of 16; and a growth spread of 8.1x collapsed to 4.3x once the metric stopped
   counting a stock as if it were a flow. **In all three the first number was plausible and
   published.** What process change catches that class BEFORE it reaches the owner?
2. **The primary endpoint may be unmeasurable by design.** items/bot-h has a measured MDE of +146%
   at the current canary design and 86.7% of its variance is within-bot hour-to-hour. We keep
   ranking things on it anyway. Should the project stop using items/bot-h as a canary endpoint
   entirely and move to mechanism endpoints?
3. **A mechanism verified in source is not an effect on the fleet, and we keep conflating them.**
   Today: `scaffoldKeep` demonstrably banks all wood, and `milestones.mjs:404` demonstrably marks
   a rung done by absence — a complete causal chain, both halves verified by running the code. The
   event sequence then gave 3.7% post-deposit vs a **3.2% placebo anchor after gather**, ratio
   1.16x. **Should a placebo anchor be mandatory for every causal claim before it is ranked?**
4. **Stock vs flow is unlabelled everywhere.** `grew%` counted standing trunks. `items/bot-h` is a
   flow. Banked totals are a stock. Nothing in the tooling forces the distinction.
5. **We cannot see rejections at all** (Part 2), so the denominator of "what the model wanted to do"
   is invisible. How much of the analysis to date is conditioned on a survivorship-biased sample of
   proposals that happened to execute?
6. Is the two-engine review itself working, or is it review theatre? Today it caught a real bug I
   had introduced and produced one causal story that was refuted by measurement. **Score it.**

**What I want:** a ranked list of changes to how this project MEASURES, with the cheapest first, and
an explicit statement of which of today's conclusions should be distrusted until re-measured.

## Rules
- Every negative claim carries a positive control. `file:line` for everything.
- Distinguish measured / source-verified / inferred.
- Rank by what a wrong decision costs, not by effort.
- End with ONE sentence: the single most valuable change to how we measure, and the one query that
  would show within 6 hours whether the veto is the cause of the redundant crafts.
