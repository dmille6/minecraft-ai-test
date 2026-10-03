# sandbox/craft — craft A/B harness (sandbox Paper only)

Drives the **real bot** (an unmodified worktree at the revision under test) through `craft` decisions on a
sandbox Paper server, sets each scene with RCON, and reads the **server's** slots and the item entities on the
ground before and after. The bot's own claim is recorded but never trusted as the outcome.

Sandbox only: every driver refuses a non-`sandbox-*` bot name, and `run-bot.sh` refuses anything but
`10.0.0.30:25599..25602`. RCON goes through `sbx-rcon.py` on the worlds host, which asserts a sandbox name and reads
the RCON password from that server's own `server.properties` (nothing secret lives here). Never point any of this at
a fleet world.

## Files

| file | what it is |
|---|---|
| `craftroom-ab.cjs` | **the scene A/B driver** (craftroom vs craftsync, 2026-10-03). One fresh bot per session, scenes below, server oracle per slot. |
| `abba.sh` | runs `craftroom-ab.cjs` cand, ctrl, ctrl, cand, cand, ctrl: three rounds per arm, each a fresh bot. |
| `summarize.py` | per-trial lines + per-scene outcome table (CRAFTED / TOSSED / REFUSED / LIED) from the results files. |
| `trace.cjs` | `node --require` preload that **only observes** packets (clicks, item spawns, pickups, slot updates) with timestamps. |
| `qbrain.mjs` | loopback "model": answers each decision with the next line of a queue file (`craft [n] <item>`, `goto x y z`), else `status`. |
| `sbx-rcon.py` | the RCON helper the drivers call over ssh as `/tmp/sbx-rcon.py <sandbox..sandbox4> -` (copy it there if missing). |
| `drive.cjs` | craftsync skill A/B (2026-10-03 night): real bot, no shims, table/2x2/recursive cells. |
| `realdrive.cjs` + `preload.cjs` | the same through `preload.cjs`, which can SHIM clicks (`CRAFTSYNC_ARM=A/B/AB`): an experiment harness, not a neutral observer. |
| `craftsync.cjs` | bare-mineflayer craft probe (no bot code): table/2x2 cells, arms none/A/B/AB via in-process shims. |

## Running the scene A/B

Prerequisites: ssh to `mike@10.0.0.30` (keys), `/tmp/sbx-rcon.py` there, the target sandbox empty (the drivers wait
for `list` to say 0 players), and one worktree per arm with `bots/node_modules` (a symlink to another worktree's
node_modules is fine when `package.json` is identical).

```bash
git worktree add --detach ../crab-cand <candidate-sha>
git worktree add --detach ../crab-ctrl <control-sha>
ln -s <a worktree>/bots/node_modules ../crab-cand/bots/node_modules   # same for ctrl

# one session (one fresh bot) of every scene:
node sandbox/craft/craftroom-ab.cjs cand ../crab-cand 1 full35,full36,full36-chain,race-early,race-late,race-stream,logs,wear,wear-open,nothing
# or the ABBA run of both arms (3 rounds each, ~25 min):
sandbox/craft/abba.sh ../crab-cand ../crab-ctrl
python3 sandbox/craft/summarize.py sandbox/log/craftroom-ab/results-cand.jsonl sandbox/log/craftroom-ab/results-ctrl.jsonl
python3 sandbox/craft/summarize.py --rows sandbox/log/craftroom-ab/results-cand.jsonl race-late   # every bot row
```

`CRAFT_REPO` overrides the checkout that holds `sandbox/run-bot.sh` and `sandbox/sandbox-bot-scripted.env`
(default: two levels above this directory). Outputs (bot stdout, skill log, brain log, queue, packet trace, results)
go to `sandbox/log/craftroom-ab/` (the older drivers: `sandbox/log/craft/`), both gitignored. One bot process per
driver; run one driver at a time per machine (the brain listens on 127.0.0.1:11499).

## Scenes (`craftroom-ab.cjs`)

The bot stands at 700.5 120 700.5 on a stone floor (y 119), air above; a crafting table, when the scene has one, at
702 120 700. Fillers are stacks of 64.

| scene | bag | command | what it asks |
|---|---|---|---|
| `full35` | cobblestone 8, stick 5, 33 rock stacks = 35/36 | `craft stone_pickaxe` | fits one: both arms should craft |
| `full36` | + a spent stone_pickaxe (the only pickaxe) + one dirt = 36/36 | same | no room: toss, refuse, or wear something? never the last pickaxe |
| `full36-chain` | as full36 | `craft`, then `place dirt`, then `craft 1` | the refusal CHAIN: is the remedy the refusal named executable, and does the craft then land? |
| `race-early` | as full35 | same | a feather summoned 1 block away as the decision is served, PickupDelay 20 ticks |
| `race-late` | as full35 | same | a feather summoned ~1.3 s after the decision, PickupDelay 0 (lands after the clicks start) |
| `race-stream` | as full35 | same | five feathers as the decision is served, PickupDelay 10/30/50/70/90 ticks |
| `logs` | oak_log 3 + 12 rock stacks, no table anywhere | `craft wooden_pickaxe` | whole tree from logs: exact counts, table placed and taken back |
| `wear` | cobblestone 8, stick 5, good stone_pickaxe, spent stone_axe (1 use), 32 rocks = 36/36; side stones at foot height | `craft stone_pickaxe` | the craft's own remedy wears the axe out, never the pickaxe |
| `wear-open` | as wear, no side stones | same | the same with nothing at the sides to wear the axe on |
| `nothing` | cobblestone 8, stick 5, good stone_pickaxe, 33 stacks of bone/string/feather/gunpowder = 36/36 | same | the refusal names only a remedy that can run |

`wear`/`wear-open` first run a **primer** (a 35-slot bag with a spent wooden_hoe) so the decision loop's own hygiene
`wear_out` fires and its 2-minute cooldown is charged; otherwise that reflex, not the craft, would wear the axe out.

Harness settings that are not the code under test, identical for every arm: `FAILED_COOLDOWN_MS=1000` (the admission
gate's 45 s cooldown would otherwise reject the next scene's identical craft, since a refusal is a failure),
`MAX_CONSECUTIVE_FAILURES=50`, a fresh `STATE_DIR` and `MEMORY_POOL` per session, and the arg form alternating
between `craft X` and `craft 1 X` so no two consecutive decisions are identical. A rejected decision re-sets the
whole scene before the retry, so drops never accumulate.

## Reading a result

Each results line has `before`/`after` (server slots `{slot: {id, count, damage}}`, totals, ground items, position),
`tables` (crafting tables left standing in the arena), every bot row the trial wrote (`craft`, `_craft_room`,
`_craft_sync`, `_table_retaken`, `wear_out`, `_pickups`, ...), decision rejections, and the packet trace relative to
the moment the decision was served (`firstReal`/`lastReal` = the craft's own clicks; slot `-999` clicks are
craftsync's resyncs or a toss, and the ground oracle tells which). A trial's outcome is the server's, not the row's:
a pickaxe on the ground after the trial is TOSSED whatever the craft row says.
