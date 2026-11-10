# keeperstall — the showcase keeper's crash loop (2026-11-10)

Status: DIAGNOSIS + FIX DESIGN, written for an independent Claude review and a Codex review before anything is built.
Base: the live showcase release `18bed2db` (branch `showcase-planahead-on-country`). Worktree branch `keeperstall-01show`.

## What happened (measured; times UTC, host 10.0.0.40)

- 12:35Z the showcase tripwire TRIPPED on S7 (crash loop): `showcase-Onyx` was killed by its 1 GB cgroup limit at
  10:18, 11:51, 12:11, 12:38. All bots were stopped.
- Restarted 12:51Z with Onyx held out. `showcase-Bravo` took the keeper lane and did the same: OOM 13:53, 14:36.
- 14:22Z `FOREST=off TREEFARM=off` (owner): forest visits stopped (0 after 14:25Z) but Bravo still timed out once a
  minute and went 210 -> 983 MB in 13 min. 15:02Z `BOARDWALK3=off COUNTRY=off` added (owner). Result pending.
- Every bad stretch has the same shape in the bot's journal:
  `LLM -> build_shop` ... 23-130 s with few or no rows ... the skill returns `no_effect` ... `write EPIPE` at that same
  instant ... `disconnected, will reconnect reason=socketClosed` ... `spawned` ... and again. Paper's log says
  `<bot> lost connection: Timed out` (Onyx 69 times, Delta 53, in 12 h; nobody else above 16).
- On every reconnect the same process logs `MaxListenersExceededWarning: 11 end listeners added`, `viewer port busy
  EADDRINUSE`, and the `memory` line is printed N times at once (N grows by one per reconnect). `external_mb` /
  `array_buffers_mb` grow about 60 MB per reconnect.
- The visits that stall are the KEEPER's: `project=forest outcome=blocked` (two `op=clear_failed ... result=no_stand`
  on cell -90,65,24 per visit, forever), `project=country outcome=waterwalk` (`water: 0 dug, 0 planks laid (complete)`,
  71-129 s), and a country siting with a 34 s silent gap. `_waterwalk` rows per hour: 2-10 normally, 18 in the hour
  Onyx's OOMs began, 13 in the hour of Bravo's 14:36 OOM. BW3.everyMs is 15 min.

## What the code says (18bed2db)

1. **The record read is O(whole history), synchronous.** `buildproj.mjs recordHead(dir, key)` reads, JSON-parses and
   sha-256s EVERY generation file of the record on every call. Measured on the live pool dir (9,504 files, 31 record
   families, 435 generation files, 35.2 MB): ONE pass over every family = **663 ms** in an idle node process
   (tidy: 119 gens, 14.1 MB, 260 ms; stepwell 105 ms; storehub 102 ms). tidyrefresh adds a tidy generation an hour.
2. **The water visit calls that pass uncached, per cell.** `skills.mjs bw3GuardStrict()` walks `recordHead` for every
   guarded plot + tidy + country. `waterWalkVisit` passes `tidyOk` / `foreignOk` = a FRESH `bw3GuardStrict()` per cut
   (buildrun.mjs:977 and :984, :1163), and `alsoDone` = a re-read every 2 s. The record had 62 standing cuts.
3. **Per-connection memory is erased by the failure it guards against.** `bw3Due(bot)` reads `bot.bw3At`; the give-up
   memory is `bot.bw3Given`; the stands are `bot.bw3Stands`; the forest's is `bot.farmSkip` ("for the connection").
   A reconnect makes a new `bot`, so the 15-min clock and every give-up count start again -- the visit that timed the
   bot out is the first thing it does after it is back.
4. **The reconnect leaks the old bot.** `index.mjs connect()` runs again in the same process on `end`. `memTimer`
   (index.mjs:270) and the `posSamples` interval (index.mjs:1081, closes over `bot`) are never cleared; the viewer is
   bound to the first bot; something adds an `end` listener per connection to a shared emitter.

## Hypothesis (NOT yet proven by a profile)

Long synchronous stretches (the record walks, stand searches) with only microtask awaits between them starve the
socket; Paper drops the client after 30 s without a keepalive; the reconnect wipes the per-connection give-up state
and leaks the old bot; the keeper goes straight back to the same visit. One stall becomes a loop; the loop becomes an OOM.

What would falsify it: a CPU profile of a keeper during a water visit that does not show `recordHead`/JSON/sha on top;
or the stall persisting with `BOARDWALK3=off COUNTRY=off FOREST=off` (read due 15:35Z).

## Candidate fixes (to be judged)

- **A. recordHead cache.** Keep the verified chain per (dir, key); on a call, list the generations and stat them;
  re-read only files that are new or whose (size, mtimeNs, ino) changed; a racily-recent mtime is never trusted.
  Expected: 663 ms -> a few ms. Helps every caller, fleet included.
- **B. A real yield.** A `breathe()` helper (setImmediate-based, at most once per ~50 ms of work) inside runVisit's
  cell loops and the forest/country/water loops, so the socket is serviced whatever the loop costs.
- **C. Keep give-up state for the process, not the connection.** `bw3At`, `bw3Given`, `bw3Stands`, the forest's skip
  and fail maps: on a process-level object handed to each new bot.
- **D. Stop the reconnect leak.** Clear every per-connection timer on `end`; one viewer per process; no listener
  growth. A structural test that every `setInterval` in `connect()` has a matching clear on `end`.
- **E. A no_stand give-up for the forest's clear cells** (cell -90,65,24 is retried forever; the forest record has a
  `waived` map and `keepDue` but this path does not feed them).

Questions for the reviewers are in the review prompts, not here.

## Reviews (11-10 ~15:10Z) and the decision

Two independent reads of the code at 18bed2db, same questions, neither shown the other: a Claude reviewer and Codex
(`keeperstall-2026-11-10/codex-design-r1.md`). Both confirm the mechanism and both correct this document:

- **The proximate bug is in `buildrun.mjs clears()` (953-988), not only the cost of `recordHead`.** A standing cut runs
  `p.tidyOk` (:977) and the stand check (:982) BEFORE the step guard and `tried++` (:980-981). A cut the guard owns, or
  one with no stand, `continue`s with no await at all, so neither `clearMax` (24) nor the deadline bounds the loop:
  62 cuts x one full record pass is one macrotask of about 41 s. `recordHead` is the multiplier.
- The forest's blocked path: `digNamed` returning `no_stand` resolves at once (a microtask), and each retry rebuilds the
  synchronous reachable-node search (`nodesFor`). The forest's `runVisit` passes neither `deferSpent` nor `sealed`
  (skills.mjs:28187), so a no-stand foreign cell never reaches the on-disk stuck map: that is why -90,65,24 repeats.
- "An `end` listener on a shared emitter" was wrong: index.mjs registers 17 `end` listeners on every new bot, so the
  warning fires once per connection. The real roots are `memTimer` (:270) and the `posSamples` interval (:1081).
- The forest map is `forestSkip` / `forestFails` / `forestIdleUntil`, not `farmSkip`. Also lost: `gkCountryAt`.
- Paper's limit: the server kicks a client whose keepalive is still unanswered at its check (15 s cadence; Paper's
  limit `paper.playerconnection.keepalive`, default 30 s). Raising it is NOT the remedy (it hides a stall).

BLOCKERS both engines named, kept as rules for the build: no yield between a check and its dig/send (loop tops only);
no yield without the visit learning that its connection ended; `tidyOk`/`foreignOk` stay FRESH reads (never the 2 s
cache); never carry `shopUnknown`, `shopAcks` or `*Stands.pending` across connections; a cache never keeps a verdict, a
head, a failed read or a shared parsed object.

**Piece 1 — `keeperstall-01show` (this branch; unprotected files only):**
1. `buildrun.mjs`: the visit BREATHES -- at the top of the clears loop and of the segment loops, a `setImmediate` yield
   once 40 ms of wall time has passed since the last one; after it, an ended/aborted visit stops and a passed deadline
   ends the visit (no step counted). Nothing between a check and its dig.
2. `buildbot.mjs`: the effects' `aborted()` is also true once this bot's client has ended (index.mjs's `end` handler
   does not cancel the running skill, and index.mjs is protected: piece 2).
3. `procmem.mjs` + `skills.mjs`: the keeper's clocks and give-ups live for the PROCESS, not the connection:
   `bw3At`, `bw3Given`, `forestIdleUntil`, `forestSkip`, `forestFails`, `gkCountryAt`.

**Piece 2 — `reconnleak-01` (protected: index.mjs; owner authorisation + both engines):** clear `memTimer` and the
`posSamples` interval on `end`, `runner.cancel('disconnected')`, one viewer per process.
**Piece 3 — `reccache-01` (fleet canary):** the verified-generation cache for `recordHead`/`recordChain`
(per-file facts keyed on ino/size/mtimeNs/ctimeNs, the chain walk recomputed every call, `RECCACHE=off`).
**Piece 4 — the forest's no-stand give-up** (pass `deferSpent`, so the existing stuck-cell flow and `waived` handle it).

Rollback of piece 1: `BREATHE=off` (the yield) and `PROCMEM=off` (per-connection memory as before).
