# Jobs, duties and a mayor — two-engine spec, 2026-09-29

Owner question (09-29): *"would it be better to assign different jobs different tasks or duties.. to make sure we
had all the necessary resources? the manager/mayor could direct jobs, priorities, and duties?"*

Claude and Codex each wrote a spec independently (read-only, code-cited). This merges them. Nothing is built.

## The answer in one paragraph

**Yes to duties and a mayor. No to permanent jobs.** Both engines reached this independently. A world has 5 bots,
so a permanent "miner" who dies, sticks, or holds only spent pickaxes stops the colony's iron. The mayor instead
computes what the world is **short of** and hands out **temporary duties** to bots that can do them **from where
they stand**. A duty expires, and a dead or stuck holder is simply replaced. **Not yet, though:** a duty is only as
good as the actions under it, and today those actions are the problem. Withdraw runs ~0.45/bot-day, the chests are
full, and iron cannot be reached. The first slice is observation only.

## Verified starting point (both engines)

- Roles already exist and coordinate nothing. `BOT_ROLE` picks the prefix of a bot's personal milestone chain and a
  word in the prompt (milestones.mjs:760, prompt.mjs:324). All 80 bots are `gatherer`. A fixed `miner` chain was tried
  once and sat unassigned (milestones.mjs:350-356).
- Idle is usually broken, not free. `idle` means the chain ran out (milestones.mjs:921), and 19 of 22 idle bots hold
  only ≤1-use pickaxes (tech-tree review). Drafting idle bots drafts the least capable ones.
- **A trap both engines found:** every decision outcome is charged to the bot's personal rung via `noteAttempt`
  (cognitive.mjs:1002). Wired the same way, a failing duty would burn a bot's personal milestone and skip it. Duty
  failures need their own accounting.
- Missing entirely: a chest ledger, a shared roster (inventory, tools, position), and a duty board. `board.mjs`
  claims are knowledge, not work. worldfacts.mjs's read-merge-rename has no inter-process lock.

## Duties (through iron tools)

| Duty | Trigger (world level) | Eligible when (executable from here) | Does | Done = (measured, not a row) |
|---|---|---|---|---|
| Miner | iron held+banked < demand (bots without an iron pick × 3) | stone+ pick with enough uses for route + escape; iron in reach; ≥4 free slots | ore tunnel → gather iron → deposit | raw_iron gained, then in a chest |
| Smelter | raw_iron in storage ≥ 3 and ingots short | furnace carried/in reach, fuel, room | withdraw raw_iron → smelt → deposit | ingot delta in the chest |
| Woodcutter | logs/planks/sticks below recipe demand | a reachable tree, room | gather logs → craft planks/sticks → deposit | wood products delivered |
| Quartermaster *(Codex)* | goods exist in storage but the requester lacks them | reachable chest, receiving room | withdraw → hand over / deposit | the requester actually holds it |
| Toolmaker *(Codex; Claude keeps toolmaking personal)* | usable-pick deficit after bank retrieval | ingredients held or retrievable, a table | craft → deposit spare | a new tool with durability, delivered |

Every duty stops when its quantity is delivered or demand disappears. It is abandoned after 2 failed steps or 5 min
with no physical progress (hard cap 15-30 min). Partial output is kept. A refused duty releases and the bot resumes
its own work, never "wait for the miner".

## Assignment

- Only eligible bots are scored: capability, travel cost, free room, then milestone class (filler/idle before a
  bot with a tech rung it can do).
- Caps: ≤2 bots per duty, ≤2-3 of the 5 bots on duties at once. Duties take at most ~1/3 of a bot's decisions.
- Hysteresis: a duty is kept ≥10 min unless done or failed; after an abandon, a cooldown on that duty.
- Priority: reflexes > survival and escape prerequisites > a personal rung the bot can do > duty > filler.
- A dead or disconnected holder loses the duty through a stale heartbeat (~5 min), and the next computation reassigns it.

## Plumbing

- **A candidate source for the existing work-order path**, shaped like `applyPrereq`. It is not a colony milestone
  (which would rewrite the ladder and inherit its skip/backoff trap) and not a prompt line alone (advice printed is
  not advice taken). Duty ids use the rung shape, so `orderFor` fires deterministically. The first work order shipped
  inert because of exactly this suffix mismatch.
- **The mayor reorders legal options. It never vetoes one**, never grants an admission exemption, and never removes
  a bot's last move (CLAUDE.md: local policy composition creating a dead end).
- Where it runs (the engines differ, both acceptable):
  - **Claude:** a pure function `assignDuties(roster, ledger, facts, now)` inside every bot. Same inputs give the same
    board; each bot acts only on its own row. No election, no single point of failure.
  - **Codex:** a module inside every bot, with a short scheduler lease in `colony-<world>.sqlite` (atomic claims,
    fencing generations).
  - **Recommendation:** Claude's form for shadow mode, since it needs no locks. Take Codex's SQLite when claims become
    real (the ore tunnel, where every bot sees the same iron).
- If the mayor fails, the bot keeps its current autonomous behaviour.

## Measurement

- The unit is a **world**. One treated world can prove **correctness** (assignments, heartbeats, no thrash, no
  milestone skips), **not effect**. The between-pool noise band is 2.36x; ingots run ~3/world-day and iron picks
  ~0.13/world-day.
- Effect needs sequential replication across ~4 random worlds against ~12 never-treated controls, world-level
  difference-in-differences, 48 h+.
- Primary: usable-pickaxe bot-hours per world-hour; verified ingots per world-hour. Transfers must not count as
  production.

## Order (both engines)

1. The queued fixes first: withdraw-home, the bank fix (tiered limits, place chests), inventory hygiene, the ore
   tunnel. A duty cannot be better than the action under it.
2. **Chest ledger** (observe-only): every container open by any bot records contents and position.
3. **Retrieval:** a craft missing ingredients runs withdraw → verify → retry. It is a remedy the bot executes. This
   also fixes a gap Claude found: `craft` returns no `need` on missing ingredients (skills.mjs:2782-2790), so
   prerequisite adoption never fires for crafts.
4. **Roster heartbeat + mayor in SHADOW mode:** it logs `duty_would_assign` / `duty_unstaffed` and changes nothing.
   No canary needed. Reading it shows whether real shortages exist that a duty would fix.
5. **Turn on one duty in one world** as a correctness canary. Smelter first (lowest risk). Miner after the ore
   tunnel is kept.
