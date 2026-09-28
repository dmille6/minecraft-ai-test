# Status — 2026-09-24

_Session opened 11:08Z, closed 11:30Z. Clock from `date -u` throughout._

## Headline

**No canary ran today, and that was the right call.** The loop was already closed when the session opened.
What I found instead is that **the instrument that decides every canary had run a whole generation ahead of
its own registration**: eight gate rules — v25, v26, v26b, v27, v27b, v28, v28b, v28c — were live in
`~/verdict.py` and entered in **no registration file**. Registering them was today's work.

I also posed and measured the next canary end to end, so tomorrow can build rather than re-derive.

## What was true at open

| | |
|---|---|
| fleet | 80 bots / 16 worlds, **one version `9b572aa+72e533`**, verified 11:19Z |
| loop | **closed** — `canary_pool` empty, `check-open-loop.py` clear, anchored pgrep empty |
| ledger | **59** decisions, newest `banktruth-01` INCONCLUSIVE 23 Sep 18:19Z |
| program window | **OPEN**, 24–27 Sep, opened 00:00Z today |
| overnight pages | none since the 18:23Z teardown |

## The finding: a commit message is not a registration

Between **21:47Z 23 Sep and 00:48Z 24 Sep**, a session took `verdict.py` from 26 KB to 52 KB across eight
new gate rules. `RULE.md` — **hashed into every read as `registration_sha256`** — and `RULES-IN-FORCE.md`
were both still the **19 Sep** versions naming **v24** as the newest rule, while the instrument ran **v28c**.

I found it by checking host file mtimes rather than by reading the state file, which knew nothing about it.
That is now re-arm rule 6.

**The gap cost nothing, and that is the only reason today's entry is a registration and not a rescue.** The
ledger's last decision is 18:18Z 23 Sep; the first gate landed at 21:47Z. **No canary has ever been read by
any of v25–v28c**, so registering them makes all eight prospective — the only form the standing rule allows.
Had a canary been decided in between, the honest close would have been to void that decision.

**The work being registered is excellent and I am not criticising it** — 800 accepted pseudo-canary draws
over a 6.6 M-row walk, every change mutant-pinned. The defect is purely that it was not written down where a
verdict can point at it.

### Direction test, applied line by line

Seven of the eight act only against a REVERT or against a quiet KEEP, so they pass the standard
`immobiledid` set and are registered retrospectively. **v28 is the exception** — it creates a path to revert
that did not exist under v24 (a change's own alarm stopping its own canary), so it is registered
**prospectively, from the next canary registered after `a9e13e1`**. No amount of quality in the measurement
changes that direction. `CAL_MAX_AGE_H = 48` is registered explicitly **as a placeholder** so it can never
later be quoted as a calibrated value.

### Shipped

- `a9e13e1` on `recovery-ladder-03` — the registration block.
- `RULES-IN-FORCE.md` rewritten, synced to host, md5 `c30f1b0b` → **`29ba5e26`** matching on both.
- `RULE.md` header corrected (it had named `recovery-ladder-01` as live since **13 Sep**) and the block
  appended, md5 `30a63a67` → **`395d8988`**. Safe only because no canary was live.

### Two queue items were already closed and the state file did not know

- **Item 12** — the death gate's invented control denominator (`canary_bot_h × 7`) is gone; exposure is
  measured and a mutant pins it. On the 23 Sep canary the hardcoded ten implied 30.8 bot-h against 56.8
  measured — a death rate inflated **1.85x** toward a false REVERT.
- **Item 13** — both halves. `canary-loop.sh` captures stderr *and* substitutes an explicit
  `CRASH (no verdict on stdout)` note for an empty `$V`. `depositread.py` reads `fail_class` and now refuses
  with `NotAnInstrument` when ≥50 deposit runs carry none.

Suites re-run green at 11:10–11:14Z: 57/57 acceptance, 25/25 mutants (off-host), deathgate pass, linkage
pass, membership 14/14, singledeath 11/11.

## A correction to yesterday's numbers: stock is 2.96, not 0.80

Yesterday's state file reported the program's stock endpoint as **0.80 items/bot-h**. That figure is a
**`[7dd3775 nominal]` per-version line** — and `programread.py` prints on those lines that they are *not
comparable*, no DiD and no exposure cut. 7dd3775 was not even live. **The program endpoint is the `[fleet]`
line.**

Nightly fleet series: **6.00 → 5.88 → 3.95 → 2.95 → 2.96** items/bot-h. An independent 6 h walk I ran today
gives **2.76**, which agrees.

Standing on the five committed targets (fleet line): deaths 0.0229/bot-h **pass**, iron-pick share 15.2%
**pass**, immobile 5.0% **FAIL**, gather 20.2% **FAIL**, stock 2.96 **FAIL by 6.8x**. **Two of five** — as
forecast once stock resolved, one worse than the 18 Sep prediction.

**Stock has halved across five nightly reads with no code change.** That is consistent with the known ±77%
six-hour world drift and must **not** be read as a regression, nor may any future fix be credited with
reversing it. It is exactly why the program read is a 72-h aggregate.

## The next canary, posed and measured

6 h / 80 bots / 480 bot-h / 227,862 rows, positive control printed. **859 deposit runs:** `no_effect` 56.5%,
`skill_error` 16.4%, **`storage_full` 10.9%**, `container_open` 8.0%, **success 7.0%**.

**`no_effect` is not a banking bug.** Its items are apple 240, chest 56, wheat_seeds 53, dirt 39,
cooked_beef 28, oak_sapling 24 — food, ballast and reserve that `bankable.mjs` is *right* to refuse. That is
banktruth-01's finding confirmed at fleet scale: the outcome is correct, and the model keeps asking anyway.

**`storage_full` is where real stock is lost, and the remedy is already in the bot's hands:**

- **85 of 94 storage_full refusals (90.4%) happen while the bot is holding at least one chest** — median
  **3** (3:19, 2:17, 4:15, 5:14, 7:10, 1:4).
- Bankable items carried at that moment: median **55**.
- Successful deposits bank **22.1 items** each; observed stock **2.76 items/bot-h**.

**Effect ceiling, stated as a ceiling:** conservative, bankable items only, 94 × 55 = **+10.77 items/bot-h**
against current stock of 2.76 — roughly **4x**. The whole-carried-stack figure (+68/bot-h) is an upper bound
only and **must not be quoted as an expected effect**, because most of that stack is not bankable.

This satisfies the refusal rule exactly — *a remedy the bot can perform from where it is*: it is holding
three chests while being told storage is full. It must be **deterministic, not advisory** (262
printed-and-ignored remedies are the precedent), and read on **acquired stock**, never on refusals avoided
(`leaf-01`, `shoreline-01`).

**Not built.** It needs sandbox mechanism proof, two Codex passes, independent Claude *and* ChatGPT review,
and a registration with **`immobiledid` in `reads`**.

## Owner calls waiting — and the notification failed for the third day running

The 11:18Z PushNotification returned *"Mobile push not sent (Remote Control inactive)"*, the same failure as
22 and 23 Sep. **This file and STATE.md are the only channel.**

1. **The v21 lower bound trips on 0 of all 15 death-involved reverts.** Its false-positive win was bought
   with real detection. A question about the *bound*, not the p.
2. **The audit finds 7 of 23 reverts confirmed false, 5 more suspect** — a third of this project's REVERT
   history may be wrong.
3. **`banktruth-01` — ship or drop?** Correct and unmeasurable at this size; shipping on truthfulness
   grounds alone is not a read I can take.
4. **Two commits are headed "OWNER DECISION 2026-09-24"** and no artefact records one. They landed 23:00Z
   and 00:13Z, evening in the owner's timezone — **recorded as unverifiable from this session, not as
   unsanctioned.** v28 is prospective either way; if the owner did not make that call, it needs re-deciding
   before any canary uses it.

## My own miss

I stamped the registration heading `11:4xZ` and the RULE.md header `11:55Z` while the clock read **11:19Z** —
estimating elapsed time from the flow of the work, which is the exact error yesterday's file recorded against
itself. Both corrected. The rule earns its place again: **run `date -u`, do not estimate.**
