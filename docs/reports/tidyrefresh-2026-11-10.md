# tidyrefresh-01show: the open tidy record is surveyed again (2026-11-10)

Code: branch `tidyrefresh-01show` d49b5877 (on the live showcase `3b3af7ef`, wood) and `tidyrefresh-01show-on-bw3` **38f048f8** (restacked on
`showcase-boardwalk3-on-bridges` 6b2ca969, the next two pieces). Not released. Tier: not protected (`protected.py`: "not protected").
Allowed under the 11-09 feature freeze as a fix for a measured break.

## The break (measured)

From the cleanup pass 2 (memory `showcase-oneoff-clean-1109.md`) and the 11-10 01:52Z copy of the showcase world and pool:

- The inside-the-wall tidy record (gen 107) was sited 11-08 04:47Z with 1,100 cuts and 1,622 fills. 45 h later it was still
  open: **294 fills and 8 cuts open** (out of 2,601 cells and 1,098 cuts; 1,130 cells are carried `prev` cells), 18 waived.
  Of the 294 open fills, 184 could be worked and 110 waited on a lower layer.
- `buildTidy` sites a new survey only when the head is COMPLETE (`tidyDue` / `gkStageDue`). Mess made after the siting is never
  planned (pass 2: 532 of the 688 in-wall leftovers were made after 04:47Z), and the outer rings never open.
- The rough survey's cap (1,200 cells a box) cut 161 off at the siting; nothing ever paged it.
- A cut one bot gave up (`TIDY_CUT_TRIES`, a per-connection memory) stayed open for every other bot: the stage completes only for
  a keeper that gave up the same cuts itself.
- Not the cause, but measured: the visits are slow. Over 24 h (261 tidy visits, 15 bots) the outcomes were deadline 120,
  helper_idle 90, aborted 50; placements 0 to 52 an hour. The stuck maps name 18 cells, not 41.

## The fix

| | What | Where |
|---|---|---|
| (a) | While the inside-the-wall record is open, its keeper surveys the inside again every hour (`ROUGH.inwallEveryMs` cadence) and **adds** what the survey finds: whole columns only; never a column the record still works, a cell another project's record names now (plus markers and bridges), a cell the record names or waived, a stand or a plot levelling cell; new fills in new segment groups after the record's highest group, layers chained bottom-up; at most 1,200 entries a refresh, nearest home first. Nothing is dropped. The clock (`refreshAt`) is stamped whether or not anything was added. | `tidyrefresh.mjs` refreshDue / openColumns / refreshMerge / refreshStamp; `skills.mjs` tidyRefresh, stageSurveyInputs |
| (a') | The inside-the-wall clock counts a refresh, so after a completion the next band is not sent back inside at once. | `roughground.mjs` inwallAtOf |
| (b) | A cut a crew bot's visits gave up (`TIDY_CUT_TRIES`, still standing) is written to the record's `waived` list, along with the hollow fills a kept crust would have opened. The visit's cut list and the completion count it as given up for every bot. The named remedy: **the next inside-the-wall survey plans it again**. The refresh never re-adds a waived cell to this record; the next record (inwallFirst) plans it from fresh ground. | `tidyrefresh.mjs` cutGiveUps; `skills.mjs` buildTidyVisit |
| (c) | The refresh passes the record's open columns to the rough survey (`siteStage` `planned`), so planned work no longer fills the cap. Each refresh takes the next page. | `tidy.mjs` siteStage |

Rollback: `TIDYREFRESH=off` (no refresh, no town give-up).

Not in this fix: `float_high` (238 blocks in the replay survey, 304 at the siting). These are floating blocks with no side for a
stand. They stay named in the census.

## Offline replay (the 11-10 01:52Z copy, `bots/scripts/tidyrefresh-offline.mjs`)

Copies of r.-1.-1, r.-1.0, r.0.-1 and r.0.0 plus `_pool-showcase`; dump `--box -64 -104 48 56 --y 50 92` (0 missing chunks); run
on ci2. Output: `tidyrefresh-2026-11-10/replay-20261110T0152Z.jsonl` (line 1 with `planned`, line 2 the control without).

- Refresh due: yes (the record was 45 h old). Survey ok: 486 cuts and 1,507 fills found. Rough cap skips: **0** (161 at the siting).
- **Added: 256 cuts + 944 fills over 710 columns** (the 1,200 a refresh). By distance from home: 272 within 20 blocks, 754 within
  40, 174 within 64. 346 more wait for the next hour (`add_max`). Taking all pages at once (`--add-max 100000`): 346 cuts and
  1,200 fills over 918 columns.
- Skipped: known 282 (cells the record already names or waived), stand_or_plot 126, busy 39.
- Independent check of every added cell: protected zone 0, another record's cell 0, own known cell 0, near a well 0.
- Without `planned` (the control): busy 248 instead of 39. The work already planned now re-enters the survey and is refused only
  by the merge.
- Compared with the pass-3 shape survey's dry run (`~/oneoff-1109/p3-dryrun.json`, 395 columns inside the walls): 189 are
  added by the refresh with all pages taken and 10 are already open on the record. **196 are taken by neither**. Those fall
  outside the tidy survey's own rules (natural relief, beside a build, out of a stand's reach), not outside the refresh.

What this means for the outer rings: the refresh is **additive**. On this world it takes the record from about 300 open cells to
about 1,500. At the measured pace of 20 to 50 placements an hour, the inside stays the keeper's work for days before the outer
rings open. That is the owner's "inside the walls first" order, which `inwallFirst` already enforces after a completion. The
refresh makes that work visible now, where before it came only after the completion. If the rings should open sooner, the lever
is visit throughput (the deadline outcomes), not the refresh.

## Tests and reviews

- `bots/test/tidyrefresh.test.mjs`: 12 behaviour checks on buildfake's flat world through `siteStage` (new beam added, busy beam not
  planned twice, new pit in its own group with chained layers, guarded/known/stand/hollow-split refusals, addMax nearest first,
  the clock, inwallAtOf, cap paging, `planned` wired into the rough survey, give-up with hollow fills, the composed progress for
  another keeper), with anchored mutants. Also a structural wiring check, comments stripped, where each anchor fails on its mutant.
- Affected tests pass on both branches: tidy, roughground, roughfill, gkleft, gkwork, gkclear, gkcrew4, gkcrewcut, gkhelpers,
  gkstagefold, gkroom, gkunblock, gkmarker, terrace, plotprep, plotprep03, siteprep, claim, access, gkaccessfold, and boardwalk3
  on the restack. Two moved anchors (plotprep, siteprep) were kept by putting the new clauses at the end of their lines.
- Codex r1 (read-only, blockers only): **NO BLOCKERS**.
- Full suite (suite-run, ci2) at the final restack **38f048f8**: 489/491. The 2 failures: nothing-important-is-orphaned (base:
  bagdiet, also failing at the live 3b3af7ef) and showdrop, a timing assertion ("longest turn 8.4 ms vs pass 7.9 ms") that
  passes alone 2/2 and passed in the earlier full run at 7a4930d1. That earlier run, 488/491, caught bridgepost's
  exactly-one anchor on the tidy guard's bridge line: fixed by the shared `tidyGuardSet` helper. Codex fold check on the restack
  (conflict, helper): NO BLOCKERS.

## After staging, read

`_build op=refreshed` rows (an hourly cadence, `cut/fill/cols/cap` counts), `op=waived why=cut_given_up`, the record's `refreshed`
summary, tripwire H/Z = 0, and the visit's `cuts left / fills left` trend.

## Fleet

No port. The fleet has no groundskeeper, no stages and no inside-the-wall record (`groundskeeper.mjs` is not on main). The fleet's
tidy stuck on single unreachable cells (hive-a, board-c, board-b, placebo-a) is the cuts held by the buildretry ledger.
stuckclose-01 `3d96f847` (built, Codex NO BLOCKERS, not queued) is the fleet fix: queue it.
