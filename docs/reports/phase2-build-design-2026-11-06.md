# Phase 2 build pieces: 2.1 buildretry-01, 2.2 buildnext-01, 2.4 buildwait-01 (2026-11-06)

Plan: [codeeval-2026-11-06/README.md](codeeval-2026-11-06/README.md) phase 2. Evidence: [skills.md](codeeval-2026-11-06/skills.md)
S1, S2, S3, S7. Piece 2.3 (escape dead ends, protected) is its own branch and design: `escdead-01`,
`docs/reports/escdead-design-2026-11-06.md` on that branch.

Branch `buildhole-01`, stacked on gkforever-01 `9e9284d7` (which carries decbundle-01 and idlework-01 on fleet `cab8abcf`):

| piece | commits | rollback |
|---|---|---|
| 2.1 buildretry-01 | `66d46b11`, r1 `7762a38a` | `BUILDRETRY=0` |
| 2.2 buildnext-01 | `8fdb572c`, `9124c370` | `BUILDNEXT=0`, `BUILDNEXT_BREAKER=0` |
| 2.4 buildwait-01 | `1fdff0df` | `BUILDWAIT=0` |

Tier 2 for all three (`protected.py --base 9e9284d7`: not protected; `reflex.mjs`, `cognitive.mjs` untouched).

## Measurements (fleet .31, `scripts/lib/telemetry.py` full walks, nice 19)

Windows: 24 h to 11-06 ~13Z (1,587,698 rows, 80 bots, 24.0 h = 1,920 bot-h; rotated `-20261106.gz` plus live) and 6 h after
stuckproj-01 promoted (424,075 rows, 80 bots, 481 bot-h). A visit is the `_build` rows before one `_build_visit` row of the same bot.

- Build visits: 24 h 3,859, of which 3,430 placed nothing (50.3 of 62.2 visit bot-h). 6 h: 786, of which 651 placed nothing
  (10.1 of 14.2 bot-h). Positive control: 2,129 placements in hive-a alone in 24 h.
- **2.1 retry hole.** In 24 h, 84 of 428 failing cells failed in 3 or more visits, with 9,423 of 9,842 failure rows. The
  isolated-c leaves (3 cells, 556 visits, 24.6 bot-h, `clear_failed no_stand`) were cleared by canopy-01 (stuckproj-01): isolated-c
  placed 324 in the 6 h after. What still repeats in the 6 h window:
  - board-d tidy: 101 `blocked` visits "1 open, 0 placeable now" with NO failure row at all. The cell holds a block `foreignKind()`
    never digs, so neither the dig nor tidydead's `hardDeferrals` (it needs `unreached`) acts. 215 in 24 h; placebo-b tidy 305.
  - placebo-d wall: 16 `deadline` visits each spending the budget on ~20 dig walks to listed clears that end `unreached`; 35 cells
    banned in 3+ visits by 2-4 bots. `clears()` skipped a stand-less entry silently, and a failed dig walk was never counted.
  - hive-a monument 325,74,101 (bamboo, foreign) `unreached` + `stand_banned` in 43 visits by 4 bots.
  - isolated-b monument 338,73,114: a listed bamboo `cut` CLEARED 203 times in 24 h (the stalk regrows from below). Not a failure;
    see "not done".
- **2.2 idle on a blocked project.** Town states from the record files at ~12Z: board-a monument UNSITED + wall stuck; board-c shop
  UNSITED (house1/monument/paths/wall all `after` it); hive-c house1 + monument UNSITED (paths/wall after house1); placebo-d
  monument UNSITED; isolated-a monument + wall stuck; hive-d monument + tidy stuck; board-b/hive-b/placebo-a everything complete.
  `shop_skip` rows (1 per reason per bot per 30 min) in 24 h: no_site board-a 197, board-c 153, hive-c 146, placebo-d 184;
  stuck_on_cell isolated-a 219, hive-b 161, placebo-c 160, placebo-b 107, hive-d 66. 2,309 of 3,859 visits were zero-placed AND
  identical (outcome, why with digits blanked) to the same bot's previous visit (31.7 bot-h). Runs of identical empty visits per
  (bot, project): 4+ = 213 runs, 10+ = 66 runs (15.2 bot-h).
- **2.4 stuck-reflex aborts.** 24 h: 614 aborted visits, 593 placed nothing (9.3 bot-h); 178 had no `_reflex_stuck` row within
  4 s. The 35 s before the stuck row, case by case:

  | class | visits | what it is |
  |---|---|---|
  | `_path_*` rows (walk failing) | 80 (+1 moved) | a real wedge: the reflex is right |
  | working in place (clear/place rows) | 52 | productive: isolated-a-Delta cleared 14 leaves in 37 s from one stand; a leaf dig is ~1 tick, so the 0.5 s reflex tick rarely sees `targetDigBlock` |
  | quiet before the first build row | 128 + 45 moved | before `runVisit`: the chest draw (`matsWithdraw`), not the engine |
  | quiet mid-visit after a clear | 113 | ~90 isolated-b-Alpha in its bamboo grove: one cut, then 36 s with no row and no movement. The cause is not in the rows |
  | after clear_failed / stand_banned / place | 12 / 4 / 1 | small |

## Designs: Claude vs Codex, and what was built

Codex (`codex exec -s read-only`, given the measurements and the goal, not Claude's design) wrote one design per piece.

### 2.1 buildretry-01

- **Claude:** a separate per-holder ledger. A cell failing in a visit is counted once; at 3 visits it is held for a while; the
  held cell's segment is deferred into F4 (so `stuck_on_cell`, the waiver and the 6 h back-off apply); a generic deferral covers the
  residual `blocked` / `attempts_spent`.
- **Codex:** reuse and extend the F4 stuck-map files with reset epochs; a 6 h cooldown derived from `lastAt`; keep the waiver
  contract separate (`out.failures`); move `settleStuck`'s finally before `clears()`; tag project stamps by policy; tests per kind
  as fail → fail → threshold → cooldown → retry → success.
- **Reconciled (built):**
  - Separate files (`<key>.retry.<holder>.json`, `buildretry.mjs`), so the F4 readers (`stuckAt`, `stampLiftable`,
    `vfStuckRead`, the waivers) are unchanged.
  - Codex's reset epoch: a success by any builder writes a reset that voids every holder's older failures. Codex r1's blocker was
    exactly this edge (own resets only); it is fixed in `7762a38a`.
  - Settle on every exit: `runVisit` wraps `visitInner` in try/finally, which covers `clears()` too.
  - Per-visit dedupe; a dig failed once in a visit is not retried in the same visit.
  - The hold does not slide: held visits add nothing.
  - **Differences:**
    - Hold 2 h, not 6 h: a cell retry costs one walk, and the project-level back-off stays the 6 h F4 one.
    - Held cells DO feed F4 and the projects' own waivers (`wallWaiveDue`, `waivePick`). This is what the owner asked for: "feeds
      the persistent stuck count, then deferred / skipped / backed off". The waivers keep their own bounds, and shop/zig waive
      only clear `fill`/`core` cells.
    - A listed clear NO dig stand reaches is still not counted. It costs nothing, and a pad built later may give it one
      (fell-01). Codex counted it.
  - The 1b05c924 contract holds: a reachable, diggable block whose dig is refused keeps `blocked` and is retried at once for 3
    visits, then it is held.

### 2.2 buildnext-01

- **Claude:** scope the per-bot `lastStop === 'stuck_on_cell'` hold to its project; add an in-bot breaker; relax `after` when the
  predecessor is unsited.
- **Codex:**
  - Verified the holes: the unscoped hold, `after`, the `open[0]` fallback, single-project gates.
  - Proposed a full candidate scan in `buildOrder` through a provider, pending-pick revalidation, K=3 / 30 min / exact `(outcome,
    why)` per (bot, project).
  - **Do not relax `after`** (paths inform wall gateways).
- **Reconciled (built):**
  - The existing `shopActive` marks already move past unsited / stuck / full projects (idlework-01 B, stuckwait-01). So only the
    two holds and the fallback were missing. They are built as one more mark (`nextBackoff`, before the keeper order and starve).
  - The order holds through a hook only when the active pick itself is held.
  - `activeProject` falls to a due upkeep before a held open project.
  - K=3, 30 min, 1 h gap (Codex).
  - **Differences:** the why is compared with digits blanked. An empty visit's "built 1962/2011" moves with OTHER builders' work.
    The full candidate-scan provider is not built.
  - `after` is not relaxed (Codex). Board-c and hive-c stay blocked behind an unsited predecessor: **owner decision** below.

### 2.4 buildwait-01

- **Claude:** declare `bot.stationaryUntil` inside the engine's bounded waits; return real walk outcomes.
- **Codex:**
  - Windows only around specific bounded waits (ack, confirm, probe, barrier as ONE window, body / spawn / land / rise / settle),
    never walks, planning or whole digs.
  - A fixed allowance after the last progress, so repeated short waits cannot hold the reflex off.
  - Ownership: never shorten another skill's window.
  - Start in OBSERVE mode, because the counts show association, not cause.
  - Walk outcomes as a separate follow-up.
  - `matsWithdraw(…, 30_000)` is a tail reserve, not a 30 s cap, so the pre-engine class is the withdraw.
- **Reconciled (built):**
  - Codex's scope, allowance (60 s after the last confirmed dig or placement) and ownership rule.
  - The windows are ON: they are bounded and narrow, and the 52 working-in-place cases are confirmed productive.
  - The observation Codex asked for is the new `_build op=interrupted kind=<op> why=<s>` row on every aborted visit.
  - The walk-outcome change and the withdraw are follow-ups. Neither is claimed here.

## Tests, reviews, suite

- `bots/test/buildretry.test.mjs`: 20 cases, multi-visit per failure kind:
  - a listed clear whose dig walk fails;
  - a foreign block whose dig is refused;
  - a foreign block with no stand;
  - a placement no click lands on;
  - a kept block (chest);
  - builders summing; an abort; completeness;
  - the cross-holder reset (r1);
  - composed with tidydead + the waiver.

  Controls run at `BUILDRETRY=0`. 6 anchored mutants; the r1 regression was checked against the unfixed code by hand.
- `bots/test/buildnext.test.mjs`: 9 cases, pure plus the chain on real record files. Controls at `BUILDNEXT=0`; 3 mutants.
- `bots/test/buildwait.test.mjs`: 9 cases. The real effects run on a fake mineflayer bot, through `stuckDecision`, plus the
  engine's waits and the abort row. Control at `BUILDWAIT=0`; 2 mutants.
- Legacy remedy tests that prove their own remedy, or the old live stop, run with the new default off for that case only
  (`noRetry`, `BUILDNEXT=0`).
- Review: Codex blockers-only.
  - r1: 1 BLOCKER, the cross-holder reset. It is fixed.
  - r2: "FIXED, BLOCKERS: none".
- Full suite: see the ledger row `phase2-build-1106`.

## Lane, order, bundle

- One bundle, **buildfix-01**. Each piece keeps its own switch.
  - They compose: a held cell (2.1) ends `stuck_on_cell`, the bot's scoped hold (2.2) moves it to the next project, and the
    declared waits (2.4) keep the visit alive.
  - They touch the same files, so separate canaries would each need a rebase.
- **Tier 2: the owner-direct lane** (`rollout.py deploy --tier 2`, fleet-wide, 60-min check), right after handcap-01's read closes
  and before escdead-01 (S) takes the slot.
- The lane asks for `--showcase-evidence`. These pieces are fleet-only, so the control session must accept fleet tests plus review
  as the evidence, or run it as a P canary in the slot (draft: `phase2-build-2026-11-06/buildfix-01.queue-entry.draft.json`).

## Not done / owner decisions

- `after` with an unsited predecessor (board-c: the shop; hive-c: house1). Should a dependent start? Codex says no.
- The bamboo `cut` that regrows (isolated-b 203 clears a day): dig the stalk at its foot. It is a separate small fix; bamboowalk-01
  is queued for the grove's walks.
- buildbot `walkTo` real outcomes, and the pre-engine withdraw time. These are follow-ups once the `interrupted` rows have been read.
