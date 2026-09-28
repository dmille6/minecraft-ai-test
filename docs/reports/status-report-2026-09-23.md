# Status — 2026-09-23 (daily operator session)

Session opened 11:08 UTC on a clean board: **no open loop.** `shoreline-01` was read KEEP at 18:04:26Z
yesterday and promoted at 18:14:07Z by its own loop; the manifest was clear, no `canary-loop.sh` was
running, and `check-open-loop.py` said "no open canary — clear to start something new". STATE.md was 23 h
stale and did not know any of that, which is the structural staleness the re-arm list already warns about.

---

## What shipped: `banktruth-01`, deployed 12:10:07Z

**sha `9a6aa13`**, pools **placebo-d, hive-c, board-b, board-c** (4 pools / 20 bots, the registered k=20
draw, drawn at deploy). Baseline `9b572aa`. Version census after the deploy: **9a6aa13 on exactly 20 bots,
9b572aa on the rest.** Reads at +30 / +90 / +180 / +360; **decision and teardown today, before 00:00Z.**

### The finding

The deposit skill's `no_effect` refusal told a bot it was carrying none of an item it was carrying:

> `nothing matching apple to hand over — nothing to deposit`

On the deployed build over 24 h — full walk, 917,491 rows, **3,226 deposit runs / 54 bots**, isolated pools
excluded — **2,079 runs ended in that refusal.** `apple` alone is 1,494 of the 2,587 named runs. And it is a
loop: **1,874 of the 2,079 (90.1%) are a bot re-proposing an item it has already been refused**, one of
them `deposit apple` **151 times in a day**.

**The refusal outcome is correct.** `bankable.mjs` is right that food and chests are ballast and that 8
cobblestone is the scaffold reserve. Only the reason was false — and a false reason is the one thing that
cannot teach.

### The framing I had to retract, before deploying

My headline was "the bot was carrying the item in 2,078 of 2,079 runs — 100.0%", with the single `dirt`
exception as the positive control. **An independent review showed that is a tautology.**
`admission.mjs:326` refuses a named deposit with `deposit_item_missing` whenever the bot holds none of the
item, *before the skill runs*, on both the model and work-order paths. Every named refusal reaching the
skill holds the item **by construction**; the `dirt` run is a gate/skill race, not a control.

The conclusion survives and is stronger — the sentence is false on *every* named fleet refusal, from the
guard rather than from a count. The evidence framing does not. "Out of what?" answered itself.

It also means the `carrying no <item>` branch of the new function is **unreachable from the fleet** and
reachable only from chat. Kept because it is correct for that caller; labelled so its silence is never read
as a finding.

### Two independent reviews, four blocking findings, three fixed in code

Codex returned SHIP. The independent Claude review returned SHIP WITH CHANGES with four blocking findings.
Three were correct at source and are fixed:

1. **The tautology above.**
2. **The embedded count would have broken this project's own instruments.** `sneak.py:16` and `wo5.py:24`
   bucket refusals as `Counter(detail[:95])`. A quantity in the string splits the largest refusal on the
   fleet into one row per amount held, and it leaves every top-N the day it ships. The count is gone and a
   test fails if a digit returns.
3. **"worth banking" is already owned by `prompt.mjs:619`** — "CARRYING: N items worth banking", computed
   *without* wants. Two lines in one prompt, consistent in meaning and contradictory in words. Rephrased.

Both engines independently confirmed, each with a positive control on its own search, that **nothing parses
the old string** and that `no_effect` reaches no rule-minting path.

### The fourth finding rebuilt the read, and the gate with it

The endpoint was "repeat refusals as a **share of deposit runs**" — a denominator the treatment directly
moves. That is `metric-must-not-condition-on-attempts`, the mistake that had escape rate rising while
deaths tripled. **Rebuilt as repeats per bot-hour**, with bot-hours from the span of *all* rows per bot so
a bot that stops depositing still counts its hours.

The rewrite shows in the calibration, which is the part worth keeping:

| null, 300 placebo draws, 4 pools / 20 bots, pre 180 / post 360, one version, 502,713 rows | share (withdrawn) | **rate (registered)** |
|---|---|---|
| mean | +2.18 pp | **+0.006 /bot-h** |
| sd | 11.68 pp | 0.507 /bot-h |
| p05 | −15.70 pp | **−0.885 /bot-h** |
| placebo dry runs crossing the gate | **1 of 2** | **0 of 3** (−0.158, −0.484, −0.025) |

**GATE −0.885 repeats/bot-h** against an effect ceiling of **−1.446/bot-h** (1,874 repeats / 1,296 bot-h).
**The gate needs 61% of the ceiling, so this read can only see a large effect** — a half effect is honestly
INCONCLUSIVE, and that is said here rather than discovered at the read.

A prior endpoint draft was thrown away for a different reason and is worth recording: it counted rows
matching `nothing matching <item> to hand over`, a string **this very change rewrites**, so it would have
read −100% in the canary arm from the wording alone.

### The inert check, answered early

The one way a message-only patch fails silently is by not reaching the fleet. Ten minutes after the deploy:

| | deposit runs | new sentence | old sentence |
|---|---:|---:|---:|
| canary / post | 17 | **8** | 1 |
| control / post | 13 | **0** | 11 |
| canary / pre | 12 | **0** | 10 |
| control / pre | 14 | **0** | 11 |

Live, and discriminating by construction — the control build cannot emit that string. The one old-sentence
row on the canary is a bot mid-way through the rolling restart.

### Recorded before the read, so a good result cannot retire them quietly

- **Advice printed is not advice taken.** This fleet has printed a correct remedy 262 times and never acted
  on it. The whole change is prose reaching a model.
- **`RECENT EVENTS` frequency bias**: the model picks the most-echoed verb 54.5% of the time, and a
  truthful sentence does not reduce how often the refusal is echoed back.
- **The canary is torn down today whatever it reads.** The 24–27 Sep program window forbids fleet-wide
  promotion; a KEEP is promoted on 27 Sep. `canary-loop.sh:73` cannot close a KEEP on a registration whose
  promotion is `none` — it pages an error and exits, leaving the canary up. That is recorded in the
  registration so a fresh session reads it as design rather than a crash.

---

## The other thing fixed today, and it was already costing deploys

`~/mcai-analysis/lib` is the **golden** analysis library: `fleet-deploy` copies it over `/opt` after every
deploy, because `/opt` is reset to the deployed sha. It was **behind** what the host actually had:

| | golden (before) | `/opt` (live) |
|---|---|---|
| `telemetry.py` | 402 lines | **540** |
| `vocabulary.py` | **absent** | present |

The overnight session installed the typed-vocabulary work into `/opt` and did not update golden. `main`
carries a **279-line** `telemetry.py` — the copy from before the walk-cap fix. So the next deploy or
promotion would have reset `/opt` to 279 lines and then copied 402 over it, deleting `count_class`,
`WrongVocabulary` and the vocabulary registry.

Golden was updated from `/opt` and verified both ways (21,462 rows / 80 bots; typed classes live).
**Then today's deploy proved it**, which is better than asserting it:

```
analysis lib restored: openloop.py
analysis lib restored: telemetry.py
analysis lib restored: vocabulary.py
VERIFIED: canary 9a6aa13 is split from the baseline
```

`/opt` after the deploy: 540 lines, `vocabulary.py` present, `count_class` present. **Queue item 11 is
closed for the deploy path.** The durable form — landing the library on the bots line so deployed shas
carry it — still costs a fleet-wide deploy and is therefore held until after 27 Sep.

---

## Fleet

- **80 bots / 16 Peaceful worlds.** Baseline `9b572aa+72e533`; canary `9a6aa13+4fa233` on 20.
- Ledger **58** decisions. Last: shoreline-01 KEEP, 22 Sep 18:04Z.
- 2 h digest: items/bot-h **23.9**, decisions/bot-h 40.7, deaths 5 (0.031/bot-h).
- **4 of 80 bots pinned ≥ 4 h** (up from 3): `hive-a-Echo`, `hive-b-Comet` (y=0), `isolated-d-Alpha`,
  `isolated-d-Echo`. All four show `path_no_legal_move` in the hundreds. An operations alarm about
  individual bots, not a fleet mechanism — but it is also the program's `immobile ≤ 2%` line, and at 4/80
  it fails whichever definition is used.
- Iron, last 24 h: raw iron 19, ingots 23, 1 pickaxe crafted against 2 gone, share 15.3%.

## The 24–27 Sep program read opens at 00:00Z tonight

- **Registration rule 4 — "stock returned needs its units settled BEFORE 24 Sep" — is SATISFIED.**
  `programread.py` now reports `stock 1350 items net into chests = 0.80/bot-h` against the ≥20 target, from
  inventory deltas, and prints the deposit *outcome rate* separately and labelled as not the program's
  stock number. Both denominators are printed.
- The fleet must sit on one `declared_code_version` for the whole 72 h. **Canaries may run** (rule 1);
  fleet-wide promotions may not. `banktruth-01` is torn down before the window opens anyway.
- **Standing on the five committed targets, today:** deaths 0.0071/bot-h **pass**; iron-pickaxe share 15.3%
  **pass**; immobile 4–7% **fail** (≤2%); gather 21.7% **fail** (≥40%); stock 0.80 items/bot-h **fail**
  (≥20). The 18 Sep prediction was "three of five pass, gather fails, stock unresolved". Stock is now
  resolved and **fails by 25x**, so the forecast is on track to be wrong in the direction of one more
  failure than predicted.

## What the overnight session established, which redirects the queue

Server-side ground truth, from Minecraft's own `world/stats/<uuid>.json` rather than from telemetry the
bots write about themselves: **257,378 logs mined, 272,021 picked up — a gap of −5.7%.** There is no
fleet-scale retrieval loss; bots collect everything they break and more. And the fleet has mined a quarter
of a million logs while stock returned sits at 0.80 items/bot-h.

**Acquisition works. Banking does not.** That is why today's slot went to the deposit path rather than to
wood, and it is the strongest evidence the project has produced for where the bottleneck actually is.

Also overnight: RCON reaches all 16 live worlds (the old client hardcoded a different server), and
**every world holds 20.00 TPS with 0.0% spread**, which kills per-world TPS as the explanation for the
endpoint's six-hour swings — the leading unexamined cause, closed in one command.

---

## CLOSE — `banktruth-01` read INCONCLUSIVE 18:19Z, torn down 18:23:13Z, not promoted

| read | n (canary/post runs) | change rows | DiD /bot-h |
|---|---:|---:|---:|
| +30 | 39 | 23 | −0.781 |
| +90 | 94 | 48 | **−1.096** (crossed the gate) |
| +180 | 185 | 112 | −0.602 |
| **+360** | **333** | **217** | **−0.398** against a gate of **−0.885** |

**The primary did not pass.** The +90 crossing decides nothing, and the series is why: it is a noisy
estimator converging as n grows 39 → 333, settling **0.8 sd inside a null of sd 0.507**. Requiring the
series was registered before the draw for exactly this case, and it is the part of today's design that paid.

**What held, and is not being inflated into a KEEP:**

- **Exposure 217** against a floor of 60, with **zero** change-row leaks into control or either pre-period
  across all four reads. The sentence is live and true on the fleet. **The mechanism is proven; the effect
  is not.**
- **Death gate HELD** (v21): 4 canary deaths in 120.0 bot-h vs 5 control in 240.0 — ratio 1.60x, lower 95%
  bound **0.41x**, nowhere near 1.25x. Three drownings and a fall; none deposit-related.
- **All v15c guards within**: blocks moved/bh +8%, working share +3%, immobile +0.3 pp DiD with zero newly
  immobile canary bots, items gathered/bh +25%.
- **The named downside did not happen.** The way this change could make things worse was the model reading
  the true sentence and concluding it cannot bank at all. Deposit runs/bot-h went canary 3.53 → 2.78 against
  control 2.46 → 2.05; the canary/control ratio moved 1.44 → 1.36. No collapse.

**`verdict.py` returned KEEP and that was not the decision.** It says so itself — `primary` appears under
*"NOT evaluated by this gate"*, because it was registered as decided by the operator. Its KEEP means "no
revert gate tripped and exposure cleared". Recording that as a KEEP when the change's own registered
endpoint failed is precisely the rescue the 11:57Z note forbade in advance. **The ledger says INCONCLUSIVE**
and STATE.md explains the disagreement so nobody has to rediscover it.

Stated plainly: **a truthful refusal is measurably reaching these bots, and whatever it does to the
re-proposal loop is smaller than −0.885/bot-h, which is all this instrument can see.** Both prospective
objections stand undisturbed — advice printed is not advice taken, and the `RECENT EVENTS` frequency bias is
a cause a truthful sentence cannot touch. The change is kept unpromoted on `deposit-truth-msg` (9a6aa13). It
is not wrong; it is correct and unmeasurable at this size, and shipping it on truthfulness grounds alone is
an owner call rather than a read.

### A registration defect, found by the apparatus and repaired one-directionally

`reads` was `["banktruthread"]` only, so **`verdict.py` refused the final read as UNREADABLE** —
`immobiledid` carries the death gate, the v15c movement guards and the readability test, and without it
there is no safety floor to read at all. It called this a registration error rather than a result, and it
was right.

`immobiledid` was added **after** the read existed. That is retrospective, and legitimate here for one
reason only: **every line it adds acts against a KEEP and none can produce one.** No endpoint, threshold or
exposure floor moved. Not adopted: `immobiledid`'s own placebo immobile-share criterion, which printed
`canary -54% FAIL` — that line belongs to canaries whose change targets immobility, and this one rewrites a
refusal sentence. **Next registration puts `immobiledid` in `reads` from the start.**

### Teardown, all three steps and the census

20 drop-ins removed; manifest cleared and `declared_at` reset to **18:23:13Z**; all 20 pool bots restarted
12 s apart; detached readers killed. **Census at 18:28Z: one version, `9b572aa+72e533`, on 80 bots.**
`check-open-loop.py`: *no open canary*. Ledger **59** decisions.

**The fleet is on a single version with ~5.5 h of settle before the 24–27 Sep program window opens at
00:00Z, which is what that window needs and the reason this canary was closed tonight rather than promoted.**

---

## A second session ran again today, and it patched the verdict path mid-canary

**Second consecutive day with two autonomous sessions on this fleet, against the owner's one-session-per-day
rule. It needs a human decision and has not had one.** A PushNotification was ATTEMPTED at 18:35Z and
**did not reach** — "Mobile push not sent (Remote Control inactive)", the same failure as 22 Sep. **So the
owner has now been un-notified of this twice, and the only channel that has actually carried it is this
file.** Whoever reads it first should raise it directly.

Found from artefacts, not inferred: transcript `9caf8bc8-…` was still being written at 18:24Z alongside
this one; it wrote two memory entries about **my** canary at 15:09Z and 15:29Z; and it **patched
`~/verdict.py` five times between 15:08Z and 15:29Z** (backups `-v23`, `-v24a/b/c/e`).

**Its work is correct and it materially helped this canary.** `verdict.py` did `im = ev['immobiledid']`
unconditionally, and `canary-loop.sh:54` captures **stdout only** — so a registration without `immobiledid`
raised `KeyError`, the traceback went to an uncaptured stderr, `V` became the empty string, and the loop
journalled an empty verdict and continued. That is why `banktruth-01`'s read-30, read-90 and read-180 notes
are `""`. **The clean `UNREADABLE` diagnosis I got at +360 exists because of their guard**; without it there
would have been a fourth empty note and nothing to act on.

**My own miss belongs next to it: I saw `"note":""` at read-30 and read-90 and did not treat an empty note as
a failure.** The other session found it in the data I was already looking at. An empty journal note is a
crashed read, not a quiet period — the same shape as `page.jsonl is not a heartbeat` and `canary-can-ship-
inert`: the thing that looks like liveness is not liveness.

**The hazard stands regardless of the patch's quality.** The verdict path was modified between the scheduled
reads of a live canary. It does not change tonight's decision — that rests on `banktruthread`'s series, which
does not go through `verdict.py`, and on the `immobiledid` safety read I ran by hand — but two sessions can
each satisfy "one canary at a time" separately and violate it jointly, and they can now also change each
other's instruments mid-run.

**Left open deliberately:** `canary-loop.sh:54` should capture stderr, and was not edited while it was
running my canary because bash re-reads a running script by byte offset. It is queue item 13 and should be
done between canaries.
