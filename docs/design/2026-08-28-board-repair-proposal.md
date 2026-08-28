# Repairing the board arm

**Status:** proposal, 2026-08-28. Not built. Written after
[the board arm was found noncompliant](2026-08-28-board-arm-noncompliant.md)
— 10 `board` calls in 8 days across 20 bots.

Designed with Claude and ChatGPT independently, then reconciled; the third
cause below is the one measurement contributed that neither of us predicted.

## What is already right

The storage format needs no work. A live claim from `_pool-board-a`:

```json
{"id": "avoid:gather:{\"block\":\"oak_log\",\"count\":12}",
 "kind": "avoid", "tier": "rule",
 "reports": [
   {"reporter": "board-a-Delta", "failClass": "no_path",
    "observed_at": 1787796055687, "posted_at": 1787807420907, "distance": 42.6},
   {"reporter": "board-a-Bravo", "failClass": "no_path",
    "observed_at": 1787891883700, "posted_at": 1787894096439, "distance": 138.0}],
 "disputes": [], "posted_at": 1787894096439}
```

Two clocks, per-report `failClass` for typed quorum, `reporter` provenance
feeding `memory.inherited`, `distance` for utility-weighted credit, a
`disputes` array. The ledger fires too: `_board_post` 66, `_board_read` 6,
`_board_adopt` 3, `_board_expire` 8. **The machinery works. Nothing reaches it.**

## Three causes, ranked, with the evidence for each

### 1. The price is not a walk. It is forty minutes.

Median distance from a `board-a` bot to its own board, over 24h and 50,237
position samples:

| bot | n | median | p10 | min |
|---|---|---|---|---|
| board-a-Alpha | 12,151 | **1,194** | 84 | 2 |
| board-a-Bravo | 12,001 | **1,143** | 73 | 1 |
| board-a-Comet | 13,723 | **1,195** | 377 | 2 |
| board-a-Delta | 8,898 | **881** | 57 | 2 |

At the measured ~1,800 blocks/h, a median-position bot is **~20 minutes from
the board one way** — a ~40-minute round trip against a 30-second decision
cadence, roughly 80 decisions' worth of life. The arm was designed to make
sharing cost a walk. Nobody checked what the walk had grown to.

This reframes everything: a rational agent declining that trip for 48
prohibitions it cannot see is **behaving correctly**. The non-use may not be a
defect in the agent at all.

The p10 column is the way out: bots are within ~60–85 blocks of the board 10%
of the time already. The price does not need to be abolished, only made
*payable when it happens to be cheap*.

### 2. The board can only hold prohibitions

`pendingReports()` in `bots/src/board-visit.mjs` iterates
`lessons.data.avoid` and nothing else. All 48 claims are `kind: "avoid"`. The
designed `worked` rules (quorum 1, self-correcting), sightings and hazard tiers
were never built. A walk buys 48 notices saying *don't*, never one saying
*here is ore* or *this worked*. The literature on multi-agent communication
puts this plainly: agents underuse communication when the information obtained
is not valuable for the decision they are making.

### 3. The board has no scent

The model's entire view of the board is one static line:

```
board   args: {}   (walk to the town board: file what you have learned, read what others filed)
```

No pending count, no "new since your last visit", no distance, no "you have 6
unfiled lessons". This is the failure this lab has now paid for five times: **a
capability is not shipped until the observation names it.**

Stigmergy is the exact analogy, and it is instructive about *why* this matters.
Ant pheromone coordinates because the trace is perceptible **from where the ant
already stands** — agents act on locally perceivable marks inside their
observation space. Our lectern has no scent. It is a mark you can only perceive
after paying the full price of reaching it, which inverts the mechanism.

Blackboard-architecture work says the same in different words: a shared
workspace needs a trigger or control signal telling agents when the workspace
is relevant. We built the blackboard and omitted the control component.

**Ranking.** ChatGPT judged (3) dominant for non-use and (2) dominant for
low value once used, and I agree with that split. But both of us reasoned
before the distance was measured. With cause (1) in hand I put the order at
**1 → 3 → 2**: even a perfectly informed, perfectly motivated agent should
decline a 40-minute trip for prohibitions. Fixing (3) alone would make the
board *legibly* not worth visiting.

ChatGPT adds a fourth framing worth keeping: the board action is a **delayed
collective good competing with immediate private progress**. That asymmetry is
the treatment and must not be removed — only made legible.

## The repair

### R1 — pay the price only when it is cheap (addresses cause 1)

Do **not** move the board, shrink the world, or auto-schedule visits. Instead
bring forward the block-3 **outpost totem** idea in its cheapest form: allow
additional boards, founded at cost, with minimum spacing and a cap — and
crucially **no board-to-board sync**, so facts still move only inside
travelling bots. The sharing cost becomes endogenous: the community buys down
its own isolation, which was always the elegant part of that design.

If that is too much for one block, the minimum version is to **measure and
report** `sync_distance` honestly (R2) and accept that this block's board is
priced out — which is itself a publishable finding about voluntary sharing
under travel cost.

### R2 — one memory-state line, identical in every arm (addresses cause 3)

ChatGPT's design, adopted as written, because arm symmetry is the hard part
and this gets it right. Same slot, same fields, same terse style, no
recommendation, no "should", no reputation language:

```
MEMORY STATE: mode=board     private_new=6 shared_available=3 shared_new=2 sync_distance=1194 last_sync=42m
MEMORY STATE: mode=hive      private_new=6 shared_available=auto shared_new=14 sync_distance=0 last_sync=auto
MEMORY STATE: mode=placebo   private_new=6 shared_available=0 shared_new=0 sync_distance=1194 last_sync=42m
MEMORY STATE: mode=isolated  private_new=6 shared_available=none shared_new=0 sync_distance=none last_sync=none
```

Field definitions are arm-neutral: `private_new` = locally observed
claim-worthy items not yet shared or checkpointed; `shared_available` = public
items readable through that arm's mechanism; `shared_new` = public items this
bot has not seen; `sync_distance` = cost of the memory action, if the arm has
one; `last_sync` = age of the last exchange. Every arm discloses its real
state through the same slot, so cognitive allocation is constant and no arm
gains an attention advantage.

Note how R2 and R1 interact: with `sync_distance=1194` in the line, an honest
agent will *still* decline — correctly. R2 without R1 buys legibility, not use.

### R3 — three more claim kinds (addresses cause 2)

| kind | quorum | TTL | rationale |
|---|---|---|---|
| `worked` | 1 | 12h | success is self-correcting; a failed retry produces an `avoid` report or a dispute. Requiring 2 suppresses the main upside of sharing. |
| `sighting` | 1 to show, marked unconfirmed until 2 | 6h | ore, trees, crossings — high value, perishable. A false positive costs a trip, not a policy. |
| `hazard` | 1 to warn, 2 same `failClass` to block | 24h | one drowning report is worth seeing; two are needed before it should strongly constrain behaviour. |
| `avoid` (unchanged) | 2, same `failClass` | 12h; 3h for `unreachable` | prohibitions are exactly where premature convergence hurts. |

All TTLs distance-scaled, as already designed.

## Verification, pre-registered before building

Primary metric, ChatGPT's formulation, adopted because it refuses to condition
on the wrong denominator:

```
board_use_rate = successful_visits_that_filed_or_adopted / board_eligible_decisions
```

where an *eligible decision* is one in the board arm where the bot has
`private_new > 0` or `shared_new > 0` **and** `sync_distance` is finite.
Counting all decisions would dilute the test with moments the board could not
possibly have helped — the same conditioning error that made a drowning
"improvement" out of a rising death rate.

Success requires all three: use rate rises against the pre-repair baseline;
**at least 3 of 4 board pools produce a board file** (today: one); and at least
half of board pools reach ≥3 distinct reporters (today: two, in one pool).

Secondaries: `adopted/posted`; `positive_fraction` = non-`avoid` share of
claims; `stale_loss` = expired-before-adoption (today **8 expired vs 3
adopted**, the single most damning number here); and `wrong_faster` = disputed
adoptions per adoption and time-to-first-dispute, which is the Zollman effect
itself and must go **up** if the board is doing anything at all.

**What would falsify "the repair helped":**

- eligible decisions exist but use stays near zero
- use rises only in board-a, or only from one or two reporters
- visits rise but `filed + adopted == 0` dominates — ritual, not exchange
- **use rises equally in placebo** — then the line taught "walk to the totem",
  not "exchange memory", and R2 became a treatment
- speed improves with no increase in false adoption or dispute exposure — then
  the board is useful but is not testing the mechanism we care about

## What not to do

Do not auto-schedule or compel visits; that converts the independent variable
from *sharing that costs a walk* to *sharing that is compelled*. Do not give
the board arm a state line without structurally equivalent lines in the other
three. Do not add reputation, reporter scores or "recommended visit" language
— those are separate social-epistemology treatments and reopen the poison hole.
Do not lower `avoid` quorum to 1; that manufactures the Zollman effect instead
of measuring it. Do not optimise for board usage as an end in itself.

## Sequencing

R2 and R3 are cheap and independent of the block boundary. R1 is a block-level
design change. None of it should ship into a running measurement window, and
none of it should ship tonight. The honest order is: land R3 (the board becomes
worth reading), land R2 (it becomes visible), re-shake, and only then decide
whether R1 is needed or whether the priced-out result is itself the finding.

## Sources

- Zollman, "The Communication Structure of Epistemic Communities" —
  <https://doi.org/10.1086/525605>
- LLM multi-agent blackboard systems — <https://arxiv.org/abs/2507.01701>,
  <https://arxiv.org/abs/2510.01285>
- Memory in LLM-based multi-agent systems —
  <https://arxiv.org/pdf/2512.13564>
- Stigmergic coordination in swarms —
  <https://www.frontiersin.org/journals/robotics-and-ai/articles/10.3389/frobt.2020.591402/full>
- Goal-oriented communication in MAS — <https://arxiv.org/pdf/2508.07720>
