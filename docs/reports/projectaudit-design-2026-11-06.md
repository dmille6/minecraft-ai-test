# projectaudit: is every finished project doing its job? (2026-11-06)

OWNER, 11-06 ~13:50Z: "we need to add some kind of daily or scheduled check to see if projects are effective and useful. the
tree farm i assumed was working and effective, we never checked. we need to do that with all projects".

**Why.** The showcase tree farm finished 10-31 20:23Z. After that, every harvest failed: 74 rows of `_build op=harvest
kind=grown_failed` (69 `why=no_safe_target`, 5 `arrived_out_of_reach`), in 24 attempt visits over 40 h, with 0 grown logs
felled. The last attempt was 11-02 12:36Z, and nothing visited the farm after that. Nobody noticed for 5 days.

The existing watchers each cover something else:
- goalwatch: open projects that stop progressing;
- effectwatch: canary effects;
- structcount: building counts read from the world.

Nothing checked that a finished project gets used.

## The registry: what each project is for, and the row that shows it is used

The registry is one file, [`config/projectaudit-registry.json`](../../config/projectaudit-registry.json). Each project kind
declares four things:
- its purpose;
- the rows that show use, and the rows that show a failed attempt;
- the use it is expected to get per day;
- how many days without use make a finished project DORMANT.

It also lists emitter strings. At least one must appear in the deployed bot source before a zero is believed. A build that
cannot log a row is UNMEASURED, never DORMANT.

The signals were read from the code: an agent read the live showcase release `b1d5b17e`, which is a superset of the fleet code.
They were then checked against 7 days of real rows on both hosts.

| kind (plots) | purpose | use metric (rows) | failure rows | expected/day | dormant after |
|---|---|---|---|---|---|
| treefarm | renewable wood | `_build op=harvest kind=grown` (1 row per log) | `kind=grown_failed` | 8 logs | 2 d |
| canefarm | sugar cane | `_build op=harvest kind=cane` | (none logged) | 8 | 2 d |
| cropfarm | wheat | `_build op=harvest kind=crop` | (none logged) | 8 | 2 d |
| shaft | safe stair to the ore levels | `_shaft_use ok=1` (trips) | `ok=0`, except `why=no_plan` | 4 trips | 3 d |
| shop (workshop) | town crafting and smelting | `_smelt_town ws=w` success, `_make_material ws~w` success (jobs at the workshop's own stations); `ws=o` is counted as elsewhere | `_smelt_town ws=w` failed | 2 | 3 d |
| storehouse | sorted shared storage | `_sort_deposit` success (`put ~:t0:` = the item's own chest), `_sort_tidy moved=` | `_sort_tidy` failed | 4 | 2 d |
| storehub | hall plus clerk | `_storehub_clerk` success | `_storehub_clerk` failed | 2 | 2 d |
| enchantshop | better tools | `_enchant_tool stop=enchanted`, `_anvil_apply stop=applied` | failed rows | any | 3 d |
| yard | cobble stockpile | `_yard kind=stock placed=`, `kind=draw dug=`, `refill`, `clerk` | (none) | 32 cobble | 3 d |
| tidy | groundskeeping | `_build project=tidy op=clear kind=tidy`, `op=sweep n=`, `op=place` | `op=clear_failed`, `op=clears_given_up` | 10 | 2 d (open only) |
| paths, road | walked over | bot-minutes whose `bot.pos` stands on a path column (no row names a path cell) | none | 30 bot-min | 3 d |
| well (infra) | disposal | `_well_dispose n=` success | `_well_dispose` failed, `_junkout phase=well` failed | 16 items | 3 d |
| chests (infra) | bank and withdraw | `_town_deposit` success, `_withdraw_pick` success | `_town_deposit` failed | 4 | 2 d |
| composter (infra) | bone meal | `_compost n=` success | `_compost` failed | any | 3 d |
| walldemo | one-off demolition | finishing it is the purpose | | | |
| house, cottage, hall, townhall, tower, shrine, monument | stand intact, be visited | **NO USE SIGNAL**. Reported instead: upkeep, and presence (bot-minutes inside the footprint, builders included). Whether a building is lit is not logged | | | |
| wall, wallext | an intact boundary | **NO USE SIGNAL** beyond upkeep: repair visits mean it was damaged and fixed; no-op complete visits mean it was checked intact | | | |
| decor, dress | decoration | **NO USE SIGNAL**: decoration is looked at, not used | | | |
| stepwell | a tank of water or lava to draw from | **NO USE SIGNAL**: no bot code draws from the stepwell yet | | | |
| shopchest | the workshop's material chests | **NO USE SIGNAL**: withdraw and bank rows do not name these chests | | | |
| siteprep, land | the plan, plus prepared plots on demand | reported, not judged | | | |

The expected rates are **initial** service targets, not measured baselines. Recalibrate them from the first weeks of reports.

**Upkeep, for every finished project with a record.** Each `_build_visit` row after completion is classed one of three ways:
- **intact**: the outcome is `complete` or `upkeep` with nothing placed;
- **repaired**: something was placed or cleared;
- **failed**: an attempt that changed nothing and ended `stuck_on_cell`, `no_material`, `cell_deferred`, `deadline`, `blocked`,
  `walk_failed` and so on.

## The verdict (`judge`, pure; applied in this order)

1. **`-`**: not finished (building, stuck, unsited or plan). goalwatch watches open projects, so these are reported here, not
   judged. A record with `state=no_site` is unsited even when it says `structure_complete`.
2. **NOT JUDGED**:
   - the town's bots logged in fewer than 50% of the judged hours, which means the bots were down or the logs have a gap;
   - or the project finished less than 24 h ago and has no use yet;
   - or the bots were up for less than 50% of the dormant span.
3. **BROKEN (upkeep)**: at least 3 failed repair visits over at least 6 h, and no visit since the first failure found it
   intact or repaired it.
4. **UNMEASURED**: no row shows use. Also when the deployed source cannot emit the use row, and for a finished tidy (nothing
   logs whether the ground stays tidy).
5. **BROKEN**: at least 3 failed attempt visits over at least 6 h, and no use at all. Rows by one bot less than 20 min apart
   count as one visit, because a harvest writes a row per log.
6. **DORMANT**: finished, and no use for `dormant_days`. An open project the registry judges (tidy) that goes idle is
   UNDERUSED instead, because an idle open project is goalwatch's stuck goal.
7. **UNDERUSED**: fewer than half the attempt visits succeed, or use is below the expected rate, or there has been no use yet.
8. **EFFECTIVE**: everything else.

**Carry-forward.** A project that is NOT JUDGED today keeps yesterday's BROKEN or DORMANT alarm. A day with the bots down is not
a recovery.

## Outputs

- **Daily report:** `~/digest/projectaudit/<label>-<date>.md` on each host. It gives every project's state, verdict, why,
  metric, last visit and last use, plus the denominators: lines walked, bots, signal rows, pool mismatches, unparsable lines,
  and whether the source was checked.
- **State:** `~/digest/projectaudit-<label>.json`, containing the summary, one line per town, the alarms and every result.
- **Header and STATE:**
  - the fleetstatus header (`lib/alarmhead.py`) shows the fleet summary plus one line per town, `!!` on a town with a BROKEN or
    DORMANT project;
  - it shows the showcase through its shipped `showcase_projectaudit` heartbeat row;
  - STATE gets the row "Projects (daily audit)" (`stategen.py`).
- **Pager:**
  - BROKEN and DORMANT are tier-1 pages, keys `broken:` and `dormant:`, via `lib/alarm.tier_of`;
  - UNDERUSED is tier 2 and appears in the daily digest;
  - `repush` is 7 days, so a finding pages once when NEW and once when CLEARED. It is not re-paged daily.
  - To ack: `pager.py ack projectaudit-fleet 'dormant:fleet/hive-a/*' "why" --for 2d`.
- **Weekly owner summary (Mondays):** `~/digest/digest-attach/projectaudit-weekly-<label>.txt` is plain language with one table.
  `pager.py digest` pushes every fresh attachment (newer than 26 h) as its own message, right after the 12:30Z digest, and then
  moves it aside.

**Cost.** The walk is FULL: every line of every bot's skill stream in the window, including rotated `.gz` files. Only rows
whose `skill.name` is a registry signal are parsed. Measured on .31: 12.95 M lines from 80 bots in 82 s, with 377 MB peak RSS,
at nice 19. On .40: 1.5 M lines in 13 s.

## Codex design (independent; given the goal and the tree farm failure, not this design)

Codex proposed the same structure:
- a registry with purpose, attribution, attempt/success/failure predicates, an expected rate, grace and dormancy;
- precedence UNMEASURED > BROKEN (at least 3 genuine attempt visits over at least 6 h, all failed) > DORMANT > EFFECTIVE >
  UNDERUSED;
- NOT JUDGED below coverage, keeping previous findings;
- BROKEN retained until a productive use;
- pages for new BROKEN or DORMANT, with stable keys and acks;
- tests that replay the tree farm, plus anchored mutants.

It read origin/main only, so it found no canefarm, cropfarm, storehub or stepwell emitters (those exist only on the showcase
branch). It also asked for:
- a 95% uptime and heartbeat gate, with no gap over 30 min and at least 12 town bot-h a day;
- an owner-rated weekly inspection for aesthetic projects;
- a ground census for tidy;
- route-completion checks for paths.

## Reconciliation

| topic | choice | why |
|---|---|---|
| visits, not rows | adopted (bot + 20-min gap) | a harvest writes one row per log; 74 rows were 24 visits |
| BROKEN threshold (at least 3 visits over at least 6 h, no use) | adopted | the tree farm passes it with margin; one bad visit never pages |
| keep the finding while not judged | adopted (`carry_forward`) | silence is not recovery |
| UNMEASURED before BROKEN (Codex) | **changed**: upkeep BROKEN comes first | repairs that fail on an unmeasured kind (a wall, the signs) are a measured failure |
| coverage gate (95%, no gap > 30 min, at least 12 bot-h/day) | **relaxed to at least 50% of the hours with any bot row** | the showcase stops for releases and the fleet restarts pools; at 95% most days would be NOT JUDGED. Bot-hours are reported |
| positive control | adopted, made concrete | the emitter grep in the deployed source; the alarm line names the rows of that family the walk did find |
| owner inspection, ground census, route checks | **not built** (named as instrumentation gaps) | they need new bot rows or the world; the audit reports UNMEASURED with the reason |
| SQLite / an external missed-run monitor | **not built** | the existing pattern is JSON state plus the alarmhead freshness line (stale > 26 h is `!!`) and the `monitors.json` row (stallcheck) |

## First results (7 days to 11-06 ~13:55Z)

**The showcase.**
- 1.5 M lines from 15 bots; 32 projects in all, 29 of them records.
- 2 BROKEN:
  - **treefarm**, the positive control. "Every attempt fails: 24 failed visits (74 rows: no_safe_target x69,
    arrived_out_of_reach x5) over 40.2 h, 0 logs felled; nothing has visited since 11-02 12:36Z."
  - **dress** (upkeep): 5 repair visits failed over 12 h (stuck_on_cell x3, cell_deferred x2), and none found it intact since.
- 1 DORMANT: **cropfarm** has had no harvest since it finished 11-04 08:29Z, and no visit either. It is the tree farm's
  pattern again.
- 3 UNDERUSED:
  - **canefarm**: 0 cut in the 1.7 days since it finished. It becomes DORMANT at 2 d.
  - **storehub**: 0 clerk runs since it finished 11-05 09:05Z, matching idletowns-1106 ("the clerk has never run").
  - **road**: 2.5 bot-min a day.
- 9 EFFECTIVE: paths, shaft, workshop, storehouse, yard, tidy, well, chests, composter. walldemo is also counted EFFECTIVE as a
  one-off.
- 10 UNMEASURED, 1 NOT JUDGED (enchantshop finished 1 h before the run), and 5 not finished (stepwell, tower and the unsited
  cottage1, reroof and townhall).

**The fleet.**
- 12.95 M lines from 80 bots; 153 projects in 16 towns.
- 0 BROKEN, 0 DORMANT once the tidy rule landed. Before it, 5 finished tidies read DORMANT; a finished tidy is now UNMEASURED.
- 14 UNDERUSED:
  - **the stair shaft in 13 of the 14 towns where it is finished: most trips fail.** Between 41 of 295 attempt visits
    succeeding (isolated-d) and 141 of 274 (board-b, about half). The failures are `why=walk` and `stepN:blocked`. In total
    `_shaft_use` shows 2,545 ok of 13,575 rows, of which 6,194 are `no_plan`.
  - placebo-b tidy: 30 of 138 visits succeed; the rest are `clear_failed kind=tree`.
- **Paths are unsited in 13 of 14 towns** (`state=no_site`, `unrouted: ...:unreachable`, but `structure_complete=true` with 0
  cells). Only board-b has a path, and it is walked 281 bot-min a day.
- The well, chests, composter and workshop are EFFECTIVE in every town that has them.

## Review (one engine, blockers only: `protected.py` says not protected; nothing changes on a bot)

Codex r1 found 3 blockers. All 3 are fixed and covered by tests and mutants; the re-check said FIXED x3 and found no new
blocker.
- **B1:** a use row that moved nothing (`_yard kind=stock placed=0`) counted as use and would hide a DORMANT. It now counts as
  a visit only.
- **B2:** a crashed audit replaced every alarm with its own, so the open findings were CLEARED and then paged as NEW again on
  recovery. The crash path now keeps them.
- **B3:** BROKEN fired inside the 24 h grace, against the documented order. BROKEN rests on failure evidence, so this is kept
  and the docstring now states the order.

`test_projectaudit.py`: all groups pass and 22 of 22 anchored mutants are killed. `test_pager`, `test_w5alarms`,
`test_stategen`, `test_effectwatch`, `test_flowledger`, `test_stallcheck` and `test_promomerge` all pass.

## Install (11-06)

| host | what | verified |
|---|---|---|
| .31 14:01Z | `~/projectaudit/app` (`projectaudit.py`, the registry, `lib/alarm.py`, `lib/telemetry.py`). `lib/alarm.py` (the `tier_of` projectaudit rule) went into all 6 live copies (w5alarms, effectwatch, flowledger, pager, promomerge, stallcheck). `alarmhead.py` went into w5alarms and pager, `pager.py` (digest attachments) into pager, `stategen.py` into stategen. Backup in `~/projectaudit/backup-20261106T1401Z/` (with `crontab.before`) | md5 of every copy = the commit. `pager.py digest --print`, the header lines and `goalwatch --no-state` all run clean. First run 14:02Z: rc 0, 13 UNDERUSED keys in the digest tier, no page (no BROKEN or DORMANT). The header shows the summary plus 16 town lines |
| .31 | cron `5 12 * * * ... projectaudit.py run --label fleet # projectaudit` | |
| .40 14:04Z | `~/projectaudit/app`. `lib/alarm.py`, `pager.py` and `alarmhead.py` went into `~/pager/app/scripts`. Backup in `~/projectaudit/backup-20261106T1404Z/` | First run: rc 0. Page "projectaudit-showcase: 3 NEW" (treefarm and dress BROKEN, cropfarm DORMANT) DELIVERED (webhook HTTP 200). The `showcase_projectaudit` row was shipped |
| .40 | cron `5 12 * * * ... projectaudit.py run --label showcase --ship /var/log/showcase/heartbeat.jsonl # projectaudit` | |

Both first runs used `--weekly yes`, so the first weekly owner summary rides the 11-07 12:30Z digests. After that it goes out on
Mondays.

**Rollback:**
- restore the files from the backup directories;
- delete the `# projectaudit` cron lines;
- the alarm keys clear on their own if the state file is removed together with a run.

**Ack a known finding:** `cd ~/pager/app/scripts && python3 host/pager.py ack projectaudit-showcase 'broken:*treefarm*'
"fix queued" --for 3d`.
