# Working rules for this repo

Short list. Every rule here exists because breaking it cost real time, and the
evidence is named so you can judge it rather than obey it.

**This file is a tripwire, not a control system.** Where a rule here could be
made mechanical instead, that is the better fix and this file should shrink.
`ZeroLooksWrong` is the model: it does not ask you to remember, it raises.
Two rules earned their mechanism already — `npm test` is now the only test
command, and `Events.rate()` no longer has a fleet-size default to get wrong.

The failure this project keeps repeating is **believing a cheap negative**. A
zero from a query, an empty mutant, a short window, a green run of the wrong
runner. Most of the rules below are guards against exactly that.

The second failure is **never closing**. Analysis is unbounded here and
validation is one change at a time; the queue can only grow. The rule below is
the guard, and `check-open-loop.py` is its mechanism.

---

## Done means read on the fleet, not merged

A change is DONE when all five have happened:

```
merged -> deployed -> observed on the fleet -> KEEP or REVERT recorded -> memory says SHIPPED
```

Not "analysed". Not "105/105 green". Not "the plan is published". Not
"probably right". A local test proves the code does what you wrote; only the
fleet says whether what you wrote was worth writing.

**While a canary is deployed and unread, no new analysis starts.** Read it,
decide, tear it down (both steps), then take the next thing. `check-open-loop.py`
raises `OpenLoop` when the manifest declares a canary with no decision recorded
against its sha, so this does not depend on anyone remembering it.

Recording INCONCLUSIVE is a legitimate close and is often the honest one — two
readings inside the 2.36x between-pool noise band is not a result. What is
forbidden is walking away with nothing written, because that is indistinguishable
from the work never having happened.

Measured 2026-09-04, and this is why the rule exists: **100 memory entries, 25
of which mention shipping anything and 17 of which correct an earlier finding.**
Five commits sat on `main` undeployed, including all three drowning fixes, while
that day produced six fresh analyses and one commit. Sixty commits were written
that week; roughly two were validated. Every one of those analyses was correct.
That is the point — being right is not the constraint, and treating "better
grounded" as progress is how a month goes by with the endpoint flat.

---

## Telemetry: use `scripts/lib/telemetry.py`. Do not hand-roll a query.

```python
from lib.telemetry import Events
ev = Events.load(since_minutes=180)
ev.count('drowning_route')          # raises ZeroLooksWrong on a suspicious 0
ev.by_bot('mine'); ev.where('mine', lambda r: 'water' in (r.get('detail') or ''))
```

`ZeroLooksWrong` exists precisely because a zero is usually a query bug. Pass
`allow_zero=True` only when you have already proven the query finds something.

Hand-rolled queries produced two wrong findings in one day: "84 of 84 bots
immobile" (read a `snapshot` field that does not exist in these logs — position
is at `bot.pos`), and "rideFloorDown places zero blocks" (read a filtered
failure bucket as if it were the population; it had placed 140).

- **Full walks only.** A full walk is ~4s. Seeking to the tail silently eats the
  baseline and flatters whatever changed most recently.
- **`grep -a`** — the files trip binary detection.
- **Event kinds live in `skill.name`**, position in `bot.pos`, inventory in
  `bot.inventory`, arm/pool in `exp`. There is no top-level `snapshot`.
- **`Events.rate()` requires `bots=`** — pass `bots='auto'` to count the bots
  actually present. It used to default to 40 against an 80-bot fleet.

## Tests: run `node scripts/run-tests.mjs` from `bots/`. Never a homegrown loop.

`npm test` runs exactly this and nothing else. It sets `SKILL_TIMEOUT_MS=300`
and `SKILL_HARD_STOP_GRACE_MS=300`, so a test
that assumes production timeouts passes standalone and turns the suite red.

A homegrown loop reported green for a whole session while this runner was red,
and separately reported two files as "hanging" when they merely take 56s and
210s — `mine` really does `await sleep(250)` + `sleep(150)` per step.

## Every negative claim carries a positive control

Before writing "zero X", show the same query finding something — a neighbouring
event kind, or just the totals for rows, bots and timestamps. `ZeroLooksWrong`
does this for `count()`; do it by hand for anything it does not cover.

This is the single rule that would have caught the most damage. "84 of 84
immobile", "zero blocks placed", "0 successes", "two hanging tests" were all
absences produced by an instrument that could not have seen a presence.

## Say the denominator before you say the number

"0 placed blocks" was true of the failures and false of the population.
"19 vs 0" was true of that window and false of those bots. Both survive one
question: **out of what?**

Canary results are **difference-in-differences, never canary-vs-fleet**. A good
deploy was rolled back once on cross-sectional noise, because the pool happened
to contain two chronic emitters of a pre-existing error.

## Test behaviour. Source-grep only for structural invariants.

Five grep assertions passed for the wrong reason in one day: matching the
comment that explains the code, an inverted assertion, a window too narrow to
see the thing it forbade, a constant asserted present but never used, and a
hardcoded ternary whose branches both still appeared in the text.

The fix each time was the same — pull the decision into an exported pure
function and test its behaviour. See `overheadBreakRisk` and `climbPrereqFor`
(reflex/scaffold) and `stairLiquid` (skills). Those cannot lie.

Source assertions ARE legitimate for things behaviour cannot reach: a skill is
registered in the dispatch table, a dangerous call is absent, a config value is
wired into the runner, an anti-regrowth guard is still dead. Those are real and
this repo needs them.

When you write one: strip comments first (this codebase's comments quote the
code they explain, so a naive grep matches the explanation), anchor on the
executable line rather than a constant's declaration, and prove it fails for the
intended reason with a mutant. A source test that has never been seen to fail is
not a test.

Never assert decision logic by matching text. Extract the decision.

## Mutants must assert their anchor is present and unique

```python
assert old in src, "ANCHOR MISSING"          # and check it appears once
```

A mutant that silently fails to apply reads as "killed". One used
`replace(old, '', 1)` on a string appearing at several call sites and deleted a
different function's line; another produced no output at all and was nearly
scored as a pass. `withMutant` in `bots/test/climb-escape.test.mjs` does this
correctly — reuse it.

## A new refusal must name a remedy the bot can perform from where it is

Four separate traps were **two individually-correct guards meeting where the bot
had no legal move**: the exit contract vs `mine`; `surface` vs the entombment
reflex; `rideFloorDown` deferring to a `mine` that correctly refuses; the
staircase bearing vs its own water check.

The bug class is not "missing remedy" — it is **local policy composition
creating a dead end**. Naming a remedy does not prove it is executable,
selected, or reachable, so all three need checking:

- **Executable from here.** "Get a pickaxe" to a bot sealed underground with no
  wood is not a remedy.
- **Reachable.** One refusal printed the correct remedy 262 times and the model
  never acted on it. Advice printed is not advice taken; if it must happen, make
  it deterministic rather than advisory.
- **Composed.** Test the refusal CHAIN, not the single guard. Every trap this
  week passed its own unit tests.

## Deploys

- Run the deploy script **from a copy outside the repo** — it `git reset`s the
  tree it lives in, and bash re-reads a running script by byte offset.
  `sudo cp /opt/minecraft-ai/scripts/deploy-fleet.sh /root/d.sh && sudo /root/d.sh <sha> <run_id> "<notes>" [--pool P]`
- **One canary pool, ever.** The tripper matches `canary_pool` literally; two
  canaries means three versions means a halted fleet.
- **Teardown is two steps** — drop-ins *and* clearing `canary_pool` — or every
  future `fleet-recycle` is blocked.
- A canary pool must **contain the population the fix targets**, or it shows
  nothing.
- Rare outcomes (deaths ~0.1/hour/pool) are unmeasurable on 5 bots. Use them as
  tripwires, not proof.

## Commits

Use `git commit -F -` with a quoted heredoc. `-m` with double quotes silently
eats backticked identifiers.

## Standing constraints from the owner

- **Do not change the world to fix a bot.** No teleporting, no `/give`, no world
  edits. The fix must be code that works in any Minecraft world.
- Swimming is travel, not danger. Water is terrain. The only water reflex is
  getting air.
- Do not use the 192.168.19x network. Do not use the UniFi API on 10.0.0.1 (it
  triggers a WAN re-provision).
- Do not disable `rpcbind` on any Proxmox node.
- Independent Claude **and** ChatGPT review, plus a real search of open source,
  issues and forums, before proposing to build. Scope it to design changes, new
  research claims, deploy-impacting conclusions, and anything resting on
  external Minecraft/mineflayer/Paper behaviour — an unscoped version becomes
  review theatre, which is worse than no review because it looks like one.
