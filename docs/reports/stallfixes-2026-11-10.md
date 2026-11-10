# Showcase stall fixes, stacked on sinkturn (2026-11-10)

Coordinator 11-10 (after keeperstall b09d399a went live at 16:54Z): fixes only, stacked on `sinkturn-01show-on-keeperstall`, ready to
stage, not released. Three pieces, one branch `stallfix-01show-on-keeperstall`, in priority order. Ledger rows `tidygrow-1110`,
`cwstall-1110`, `pathsmem-1110`.

## 1. tidygrow-01: one tidy refresh is one record generation

**Measured** on the host, with the live code against the live pool (`recordHead` on each of the 31 records): one pass costs 519 ms.
The pool holds 438 generations (38.1 MB), and tidy takes 226 ms of that pass (122 generations, 15.7 MB). On 11-10 from 06:50 to
16:01Z the tidy record grew by 11 generations (4.19 MB):

| Kind of generation | Count | Bytes each |
|---|---|---|
| Refresh (`bom, cells, cut, segments`) | 5 | 337-401 KB |
| Claim retirement 0-60 s after each refresh (`claimed, cut`) | 5 | same |
| Waiver | 1 | - |

The refresh already writes only when it surveys; every one that day added cells. The second generation exists because the survey
plans cuts inside a sited building's claim, and `gkPlanAdditions` then retires them in a publish of its own.

**Fix:** `tidyrefresh.mjs refreshClaimed`, used in `skills.mjs tidyRefresh`, runs the claim retirement inside the refresh's own
publish. The same day would have been 6 generations and 2.30 MB, 45% less growth. The resulting head is identical
(`bots/test/tidygrow.test.mjs` runs the real record chain on a temp dir: 2 generations become 1).

**Not done:** a record-layer compaction. `recordHead` reads every generation from the root, so growth is only slowed, not capped. A
cap needs a checkpoint or rebase in `buildproj.mjs` `recordHead`/`publishRecord`. That is the function the other session's
recordHead cache (a fleet canary) changes, so it belongs with that work. A rebase root would also not be rollback-safe for old code.

## 2. cwstall-01: the citywall design visit breathes

**Live:** `_build_visit project=citywall outcome=no_site ms=15629..20509`. The design visit (`skills.mjs buildCitywall`,
`t.kind === 'design'`) has no await, so it runs as one macrotask.

**Offline:** `bots/scripts/citywall-stall-offline.mjs`, run on copies of the showcase region files and pool taken at 11-10 17:16Z
(`~/cwstall-1110` on the showcase host). Over 3 runs the design path costs:

| Stage | Before (one macrotask) |
|---|---|
| Town walk | 0.33-0.55 s |
| Swap walk (inside the design) | 0.38-0.63 s |
| Rest of the design | 0.01-0.02 s |
| Escape proof (`wall.mjs wallEscape`, six `walkSet` walks) | 2.5-3.8 s |
| **Total, all one macrotask** | **3.2-4.8 s** |

The design answer is `cut5/trap0`, the same as live.

**Fix:**
- `wallEscape` and `walkSet` are generators. The sync drivers are unchanged, so every caller gets the same answer.
- `wallEscapeAsync` awaits a turn between the walks, and inside each walk every `WALK_SLICE` (4096) cells.
- `buildCitywall` breathes after the town walk, the swap walk (now its own stage) and the design, using keeperstall's 40 ms
  `breathDue` and `visitGone`. If the visit is gone it stops `aborted`.
- `buildrun.mjs`: a swap pass breathes before its second walk.

**After:** the escape proof runs in 88 slices, the longest 66-99 ms, with the same answer. The worst macrotask is now one town walk,
0.38-0.43 s. Going lower needs `buildsite.mjs walkFrom` sliced; it is shared by every siting, so that was left out.

## 3. pathsmem-01: paths no-op visits

**Cause.** Iris had 16 new connections between 12:53 and 16:56Z (`_sink_mode` rows) and made 15 paths visits, each 20 s to 4 min
after one. The mechanism:
- `pathsExtendAt` and `pathsUnrouted` live on the bot object, which `index.mjs` creates anew after every disconnect.
- After each reconnect, `recordDamaged` → `pathsExtendDue` reads the laid network as damaged, so the order sends the bot there as a
  repair.
- The visit's extension answers `unrouted:enchantshop:unreachable` (`pathsite-offline.mjs --extend` on the copy) and finds 610/610
  cells laid.

**Fix:** both fields move to `procMem` (keeperstall-01's process memory).
- An unrouted destination is asked again after `PATHS_UNROUTED_MS` (6 h) instead of never.
- Nothing is noted on an ended connection.
- Replaying Iris's 16 connections: 16 visits become 1.

## Read after release

- Tidy generations per refresh: expect 1. Tidy bytes per day.
- `_build_visit project=citywall` `ms`, against the 15.6-20.5 s before. "Timed out" rows near citywall visits.
- Paths visits per bot per day (about 30 before), and how many place nothing.
- Deaths and H/Z unchanged.
