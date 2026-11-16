# What the trunk newly turns ON for the showcase

The list DECISIONS.md says is owed ("THE LARGEST OPEN QUESTION"). Read-only work: no code was changed and none was run.
Nothing here is a verdict on a piece; it is the inventory the control session needs before any release of the trunk.

**The short answer.** A showcase bot started on this branch (`a37c6b6d0`) with today's showcase environment gets about
40 fleet pieces it has never run, switched on together: 41 new switches are on by default and have a caller on the
branch (rows 1 to 19). The showcase environment sets none of them. Two more fleet pieces have no switch at all
(leasegen-01, bagdiet-01) and a third has only a number to set (pause30-01). Five switches are already off for the
showcase pool (the merge's pool defaults), one is off everywhere, and eleven are on by name but do nothing on this
branch, because their caller was not carried over or the thing they need is off by pool.

## What this is and how it was made

Three trees were compared, `bots/src` only: the showcase `6ed264b9`, the fleet `origin/main` (`af5eb2372`) and the
branch tip `a37c6b6d0`; their common ancestor is `0fb6c0b7c` (2026-10-29).

1. **Switch names.** Every env name read in `bots/src` was extracted from each tree (`env.X`, `env?.X`,
   `process.env.X`, and literal names passed to the helpers `req`, `envMs`, `yardFlag`, `poolSwitchWhy`), comment lines
   dropped. Counts: ancestor 104, showcase 347, fleet 255, tip 410.
   - On the tip and not at the showcase: **63 names** (61 come from the fleet, 2 were made by the merge: `CRAFTSPARE`,
     `VISIT_WAIVER`). Nine more are built from a template and so not in that count: `STN_RETAKE`, `STN_SWEEP`,
     `STN_REUSE`, `STN_WITHDRAW`, `STN_SURPLUS`, `GKF_CLOCK`, `GKF_DEAD`, `GKF_LEVEL`, `GKF_CREW`.
   - Control for the method: it finds `ESCDEAD`, the one case known before. Control for the two zeros that follow: the
     same extraction finds 153 showcase names the fleet lacks. At the showcase and missing on the tip: 0 of 347. On the
     fleet and missing on the tip: 0 of 255.
   - Names on both sides whose reading line differs between the showcase and the tip: 3 of 347
     (`LLM_DECISION_COOLDOWN_MS`, `PAUSE_RECOVERY_MS`, and `MEMORY_POOL`, which gained the five pool-default readers).
     A default that lives in a constant on another line is NOT caught by this; see "not examined".
2. **The showcase's real environment** (10.0.0.40, read 2026-11-16 23:13Z, names and on/off or numeric values only).
   The unit `mcshow@.service` reads `/srv/showcase/harness/env/<bot>.env` plus one drop-in (`SHOP_COOLDOWN_MS=180000`).
   15 of 15 env files hold the same 46 names. **0 of the 72 new names is set in any of them** (control: the same listing
   shows `MEMORY_POOL=showcase`, `BOT_ROLE=gatherer` and `LLM_DECISION_COOLDOWN_MS=30000` in 15 of 15). So every default
   below is what the showcase would get. `PAUSE_RECOVERY_MS` and `LLM_DECISION_COOLDOWN_CAP_MS` are not set either. The
   model setting is one endpoint with no `oai+` prefix.
3. **Is each switch live.** For each switch's reader I searched the tip for a caller (text search, comment and import
   lines dropped; the eleven "no caller" results were re-checked with a looser search, whose control is
   `bambooWalkPlugin`, found at `index.mjs:214`). All 27 fleet-only modules are imported from somewhere `index.mjs`
   reaches (27 of 27). I did NOT trace each caller up to a skill a showcase bot is seen to run, and ran nothing.
4. **Unswitched fleet behaviour.** The files that differ from the showcase are 79 of 277: 35 changed files
   (+4,828 / -688 lines), 27 fleet-only modules (4,013 lines), one module made by the merge (`poolswitch.mjs`) and 16
   empty fleet data files. Read in full: the diffs of 10 of the 35 (`config`, `exit-contract`, `poolescape`,
   `smelting`, `workbench`, `cobblecap`, `toolhygiene`, `lidrule`, `oretunnel`, `worldfacts`; 234 added lines). Read in
   part: `milestones`, `llm`, `protectzone`, `cognitive`, `buildproj`. For the other 20 I read one line per hunk (the
   first code line of each hunk of two or more lines) and followed the piece names in them. Of the 27 fleet modules I
   read the header comment and the switch, not the body. From the ledgers: 233 fleet-only rows in 46 ledgers (189
   declarations only the fleet has, 44 fleet changes to a declaration both lines have); I listed all 44 by name and
   read 5. Fleet history: 278 commits touch `bots/src` since the ancestor, under 118 piece names; 47 of those names
   appear in the tip's source and not once in the showcase's.

**Not examined.** About 4,000 of the 4,828 added lines line by line; the 688 removed lines (showcase code changed or
gone: `skills` 341, `cognitive` 80, `reflex` 55); the bodies of the fleet modules; defaults held in constants;
anything outside `bots/src`; tests. `bots/package.json` and the lock file are identical on both sides (checked), so the
libraries do not change.

**The showcase has moved since the merge.** At 23:03Z on 11-16 release `0e33aa99` (bagfix-01show) replaced `6ed264b9`
on the showcase. It is not in this branch. It adds its own chest merging and chest budget and reads the name
`CHESTCARRY`, which the fleet's chestcarry-01 also reads (row 12).

## The table, riskiest first

"On" in the default column means: nothing set, `MEMORY_POOL=showcase`. "Protected" is `scripts/lib/protected.py --files`
on the file where the piece acts; a piece whose own module is not protected but which is wired into a protected file is
marked by that file.

| # | Fleet piece | What it changes for a showcase bot | Switch and off value | Default in the showcase pool | Protected scope? | Recommendation |
|---|---|---|---|---|---|---|
| 1 | idlework-01, idlework-02 | The lap a bot runs when its ladder is done. Today: walk 80 blocks out and back (`patrol`). On the branch: a batch of work picked by rotation: grounds, iron, grounds, logs, grounds, coal, grounds, scout. All 15 bots are role `gatherer`, so all 15 change | `IDLEWORK=0`; also `IDLEWORK_BAGSTOP=0`, `IDLEWORK_RETURNFIRST=0` (the lap's order: return before deposit) | on | no (`milestones.mjs`, `idlework.mjs`) | Pool-gate off. It changes what every bot does by default, its iron and coal batches send idle bots underground (the owner's word of 11-16 was to limit that on the showcase), and rows 6, 7, 8 (log cap) and 19 only act through it |
| 2 | cooldown15-01 | The wait between model decisions is capped at 15 s. The showcase env sets 30 s (15 of 15 files), so each bot may ask the model up to twice as often, all on the one 5080 endpoint | `LLM_DECISION_COOLDOWN_CAP_MS=30000` | on (cap 15000) | `config.mjs` no; its reader `cognitive.mjs` yes | Pool-gate (cap 30000 for the showcase). The model load on the 5080 is shared with the fleet; doubling the showcase's share is a change of its own |
| 3 | escdead-01 | A bot held 30 min in one 3-block box: a wider underwater swim (radius 8, down 4), breaking its roof to let water in and swimming up, and a pickaxe may be used to its last swing while pinned. Also: the zone guard treats a cell under two blocks of natural ground as outside a zone's protected part | `ESCDEAD=0` (`ESCDEAD_PIN_MS` sets the 30 min) | on | yes (`reflex.mjs`, `protectzone.mjs`, `poolescape.mjs`, `exit-contract.mjs`) | Pool-gate off. Protected reflex and zone-guard code; the zone guard is what the showcase tripwire watches, and DECISIONS row 1 already chose the showcase's own zone rule (`ZONEWALK`) |
| 4 | swimunder-01, swimcentre-01, dropanddig-01, escpocket-01 (with seapocket-01) | How a bot acts when drowning or sealed in water: swims out under water the way it came, steers under the hole while rising, sinks to stand and dig its air pocket, digs a pocket on the wide tier, holds a longer breath, and prices known trap pockets in the pathfinder (a shared trap-site list in the pool's world facts) | `SWIMUNDER=0`, `SWIMCENTRE=0`, `DROPANDDIG=0`, `ESCPOCKET=0` | all four on | yes (`reflex.mjs`, `airpocket.mjs`, `swimunder.mjs`, `dropdig.mjs`, `index.mjs`) | Pool-gate off, then release one at a time. Each is a change to the drowning rescue, and the showcase's own drowning fix (airroute-01show) is being built against the showcase's version of the same code |
| 5 | villageunlock-01 | A bot near a village closes open trapdoors and opens fence gates round penned villagers. It is the one piece that lets a bot act on a block inside a protected zone; the build order asks for it | `VILLAGEUNLOCK=0` | on (unset is on) | yes (the pass is in `protectzone.mjs`) | Pool-gate off. It works inside the zones the tripwire guards. It was written for the showcase's own village, so it is a likely early release of its own |
| 6 | workboard-01 | On a grounds lap the town's build or tidy job is ordered directly (`home`, then `build_shop` pinned to the job) and the model is not asked; the board takes the workshop's turn | `WORKBOARD=off` (`shadow` logs only) | on, but acts only inside row 1's grounds lap | yes (`cognitive.mjs`) | Pool-gate off with row 1. It replaces model decisions with orders |
| 7 | gkforever-01 | Every other idle lap is a grounds lap, and the tidy's ring grows from 80 to 128 blocks for that lap's "is there work" check. Only the `idle` and `clock` parts have a caller; `dead`, `level` and `crew` have none | `GKFOREVER=0` (parts `GKF_IDLE=0`, `GKF_CLOCK=0`) | on, acts only through row 1 | no | Pool-gate off with row 1. The showcase has its own tidy line (tidyrefresh, gkhelpers, country, roughground) and tidyflow is not released yet |
| 8 | vetoremedy-01, depositoffer-01 (with decbundle-01), repeatwork-01, gathermem-01, loggate-01, logcap-02, ironchain-02, toolrank-01 | What the model may choose and what the gate refuses: a fixed remedy runs after some vetoes without asking the model; `deposit` leaves the model's choices when the gate would refuse it; a gather that just gained is not refused as a repeat; failed gather targets and areas are remembered and refused for a while; gathering logs is refused while the town holds more than the cap, with a TOWN WOOD line in the prompt; an iron pickaxe craft with no iron becomes a stone one; a lower-tier tool is refused beside a better working one | `VETOREMEDY=0`, `DEPOSITOFFER=0`, `DEPOSITRUNG=0`, `REPEATWORK=0`, `GATHERMEM=0`, `LOGGATE=off`, `LOGCAP=off`, `LOGCAP_PROMPT=off`, `PICKSWINGS=0`, `TOOLRANK=off` | all on | yes (`admission.mjs`, `cognitive.mjs`); `toolhygiene.mjs`, `logcap.mjs`, `prompt.mjs` no | Pool-gate off, then turn on singly. Eight changes to the decision gate at once cannot be read apart in an hour |
| 9 | stations-01, stationsback-01, gklease-02 | Crafting tables and furnaces: the smelt takes its furnace back; keepers sweep stray tables and furnaces across town; a craft uses the town's stations or a designated cell; a table or furnace is withdrawn from the chests before one is crafted; a spare crafting table is burned as fuel | `STATIONS=0` (parts `STN_RETAKE`, `STN_SWEEP`, `STN_REUSE`, `STN_WITHDRAW`, `STN_SURPLUS` `=0`), `STATIONSBACK=0`, `GKLEASE2=0` | on | `stations.mjs` no; the `skills.mjs` symbols were not checked one by one | Pool-gate off. The sweep digs blocks out of the town, where the showcase runs its own clean-up pieces (takeback-01show); two cleaners have not been run together |
| 10 | stairuse-01, shafttrap-02 | How a bot uses the town stair: it waits for and walks the stair's own steps to go down, and a bot stuck climbing on the stair is handed to a stair exit by the reflex | `STAIRUSE=off`, `SHAFTTRAP=off` | on | yes (`reflex.mjs`; `skills.mjs` `stair*`) | Pool-gate off. Protected, and the mine crew (minecrew-01show) is being designed on the showcase's stair behaviour |
| 11 | pause30-01 | After three failed skills in a row a bot stands 30 s, not 120 s | `PAUSE_RECOVERY_MS=120000` (a number, no on/off) | 30 s | `config.mjs` no; its reader `runner.mjs` yes | Pool-gate (120000 for the showcase). With row 2 it raises the model's load again |
| 12 | chestmerge-01, fullplace-01, chestcarry-01, cobbleroom-01, lidground-01 | Town chests: partial stacks are merged inside a full chest to make room; a deposit that finds every chest full goes on to place a new chest itself; a carried chest gets the larger daily budget; surplus cobble goes down the junk well when no chest has room; natural ground on a chest lid is dug off | `CHESTMERGE=off`, `FULLPLACE=off`, `CHESTCARRY=off`, `COBBLEROOM=off`, `LIDGROUND=off` | all on | no | Pool-gate off, and reconcile first: bagfix-01show, live on the showcase since 11-16 23:03Z and not in this branch, does the merging and the chest budget its own way and reads the same name `CHESTCARRY` |
| 13 | sandrung-01 | The "collect 8 sand" rung leaves the ladder, and the town deposit no longer keeps 8 sand back | `SANDRUNG=1` puts it back | retired | no | Pool-gate (keep the rung on the showcase) until someone checks that the showcase's glass work does not lean on the rung. Not checked here |
| 14 | monustuck-01, stuckcells-01 (the part outside the waiver) | A build visit bans a stand its walk failed from and gives a cell up as `no_stand` after enough bans; a town-stair cell with nothing to click against gets a chain of supports placed first. The rest of stuckcells-01 (waived cells, the sealed pocket, the snow-layer read) sits behind the waiver and is off (row 25) | `MONUSTUCK=off`, `STUCKCELLS=off` | on | no | Pool-gate off. Same family as DECISIONS rows 5 to 7 (how a visit treats a cell it cannot place), which were settled as off for the showcase |
| 15 | bamboowalk-01 | The body's collision with bamboo follows the server's offset post, so a bot no longer walks into a post it cannot see | `BAMBOOWALK=0` | on | yes (`bamboowalk.mjs`) | Pool-gate off until the fleet's effect read is written (fleet-wide since 11-16 08:43Z), then its own release. It changes how bots walk |
| 16 | ironchain-01 | The ore tunnel aims only at ore that gather may take (never a cell of the town stair's record) | `IRONCHAIN_TUNNEL=0` | on | yes (`oretunnel.mjs`, `skills.mjs` `tunnelToOre`) | Pool-gate off (protected), small |
| 17 | buildwait-01 | A build visit tells the stuck reflex about its intended waits, so standing still on purpose is not ended as stuck | `BUILDWAIT=0` | on | no (`buildbot.mjs`), but it feeds the reflex's stuck decision | Pool-gate off, small. A likely early release: it only removes aborted visits |
| 18 | dirtrung-01 | The dirt rung is also met by 64 of dirt plus stone kinds, not only by 16 dirt | `DIRTRUNG_EARTH=0` | on | no | Accept as harmless, or gate with row 1: it only makes one rung easier to pass |
| 19 | gkstay-01 | A keeper hands the grounds lease on when its idle batch is an underground one | `GKSTAY=0` | on, acts only through row 1 | no | Goes off with row 1. The showcase has a piece of the same name (released 11-07); the two were not compared |
| 20 | leasegen-01 | Deletes superseded lease files from the pool's state folder once an hour (keeps each lease's newest 3 and anything under 4 h old), and clears two per-connection timers | **none** | on | `buildproj.mjs` no; the timers are in `index.mjs`, yes | Accept, after one check: the showcase has its own pruning (`POOLPRUNE`), and the two were not compared. Its own header says it was written for the showcase's stall |
| 21 | bagdiet-01 | A craft tries the three nearest tables before putting down its own; monument, wall and tree-farm visits hold at most 64 of one item and bank the rest back; a dug table's drop is looked for farther and once more | **none** | on | no | Accept as harmless: narrow, and nothing on the showcase line names it. If one change at a time is held strictly it needs a switch first |
| 22 | New telemetry rows | Rows the showcase has never written: `escdead_mode`, `seapocket_mode`, `bamboowalk_mode`, `visitswitch_mode`, `poolswitch_mode`, the rung-tracking rows, the deposit-offer tallies | **none** | on | no | Accept, after one check: the showcase's release gate replays rows through its own reader and lists the kinds it knows. Whether new kinds fail that gate was not determined |
| 23 | Serving A (the llama-server client in `llm.mjs`) | Nothing: the new path is taken only for an endpoint written `oai+http://...`, and endpoint stickiness needs two such endpoints | none (chosen by the URL) | inert: the showcase has one endpoint, no `oai+` | no | Accept as harmless |
| 24 | roles (cooperation tier B5) | Nothing unless set | `ROLES=on` turns it ON | off | yes (`cognitive.mjs`) | Already off |
| 25 | buildretry-01, the in-visit waiver, the unsited hold, the well band, the craft spare | Nothing in the showcase pool | `BUILDRETRY`, `VISIT_WAIVER`, `UNSITEDWAIT`, `IDLEWORK_WELL`, `CRAFTSPARE` | off by pool (the merge's own defaults, DECISIONS rows 2 to 6) | no | Already off |
| 26 | buildnext-01, stuckproj-01 (canopy, starve), plankeep, loopyield, stuckclose-01, stuckfleet-01/02/03, tidydead-01, gkforever's `dead`, `level`, `crew` | Nothing today. The switch is on by name, but its caller was not carried over (no caller found for `starveMark`, `planStale`, `loopYieldOn`, `canopyCuts`, `lightWaiveDue`, `orphanWaiveDue`, `tidyTownGiven`, `buildNextAfter`, `nextHoldOf`), or it needs the retry ledger or the waiver, both off by pool (stuckfleet-01, stuckfleet-03) | `BUILDNEXT`, `BUILDNEXT_BREAKER`, `CANOPY`, `STARVE`, `PLANKEEP`, `LOOPYIELD`, `STUCKCLOSE`, `STUCKFLEET`, `STUCKFLEET2`, `STUCKFLEET3`, `TIDYDEAD` | on by name, no effect | no | Default them off for the showcase pool or delete them. A later fix that restores a caller would switch the piece on for the showcase without anyone choosing it |

Five of the 63 names are numbers or lists, not switches: `ESCDEAD_PIN_MS`, `LOGCAP_HIGH`, `LOGCAP_LOW`, `STARVE_MS`,
`VETOREMEDY_RULES`. The count: 41 on with a caller (rows 1 to 19), 11 on with no effect (row 26), 6 off (rows 24 and
25), 5 numbers: 63.

## Also different, and not a fleet piece being switched on

In protected files the first pass kept the FLEET version of 33 declarations where both lines had changed them
(`ledgers/review-worklist.json`, "fleet"): among them `gather`, `gatherRun`, `mine`, `stairDescend`, `stairAscend`,
`deepMine`, `tunnelToOre` in `skills.mjs`, `startReflexes`, `floodBranch`, `guardBranch`, `pillarOut`, `digStraightUp`
in `reflex.mjs`, `CognitiveLoop`, `AdmissionControl`, `connect`, and the four zone-guard functions. Whatever the
showcase had changed inside them was set aside unless one of the 56 fix commits since put it back. I did not read
them. For a showcase bot each one is a place where behaviour may differ with no switch at all.

## The reverse: showcase pieces the trunk turns on for fleet pools

The showcase has 153 env names the fleet never had. By the form of the reader on the tip:

- 41 are pool-gated (a `_POOLS` list that defaults to `showcase`, or a default taken from the pool): off for the fleet.
- **64 are on unless set off, with no pool in the reader.** This is an upper bound on what goes on for fleet pools:
  some sit under a pool-gated parent (twelve `REROOF_*` names, `SINKTURN` under `SINKS`, `CIVICVISIT` under `CIVIC`),
  and I did not resolve the parent for each.
- 46 I could not class from the reading line (the value is normalised first). Sixteen of them sit beside a `_POOLS`
  name. One of those lists defaults to every pool: `OBSIDIAN_POOLS` is `*`.
- 2 are numbers.

The ten largest with no pool test in the reader, by the size of the module that holds the switch: `ZONEGUARD`
(`protectzone.mjs`), `WOODWORKS` (574 lines), `FILLCOLUMN` (436), `CLEANZONE` with `GATHERZONE` and `WELLSTEP` (419),
`GROUNDS2` (392), `TAKEBACK` (329), `TEMPSTAND` (303), `LITTER` (276), `LEAFFELL` (230), `PROJTURN` (219). Next:
`TIDYREFRESH`, `TOPDOWN`. `ZONEWALK` is the same kind and is already DECISIONS row 1.

Beyond switches, outside protected scope the trunk IS the showcase's code: 239 declarations where the showcase side was
picked, 1,149 the showcase alone changed, 74 showcase-only files (62,884 lines). None of that was examined for what it
does to a fleet pool. Also from DECISIONS: `TOWNMINE_DEFAULT_POOLS` is `showcase` on the branch, so a fleet pool loses
the town-mine slots it has on main.

## What could not be determined

- Whether each caller is reached by a showcase bot in practice. "Has a caller" is a text search, not a run.
- Whether pieces that do the same job collide when both run: the fleet's stations sweep with the showcase's takeback,
  the fleet's lease sweep with `POOLPRUNE`, the two `gkstay` pieces, chestmerge-01 and chestcarry-01 with bagfix-01show.
- Whether the new telemetry row kinds pass the showcase's replay gate and tripwire readers.
- Fleet behaviour inside the roughly 4,000 added lines not read line by line, and defaults held in constants.
- The cost of row 2 on the 5080: no measurement was made here.
