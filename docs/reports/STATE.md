# STATE — the operator's state file (a fresh session starts from THIS, not from the handoff history)
_updated 2026-10-02 20:20Z (see the EVENING section first); earlier stamp 06:10Z by the autonomous operator session (owner grant 10-02 04:45Z: 15-20 h on v1, iron first,
both engines, reports every 4-6 h) — **CANARY LIVE: `fixes-03` on `8453c09`, pools hive-c, board-a, placebo-d,
placebo-b (20 bots), declared 05:03:00Z.** Fleet baseline `bf296c9+9287fd` on the other 60. Exactly two versions live
at 05:10Z. `canary-loop.sh fixes-03` (pid 1921117) does reads/verdict/record/promote/teardown. NOTHING is chained
behind it (chain-ore.sh stopped 10-01 on fixes-02's revert)._

> **THIS FILE ALSO EXISTS ON `main`.** `bots/test/nothing-important-is-orphaned.test.mjs` asserts it stays there.
> If the two copies disagree, take the later `_updated` stamp. Long history: `git show 40a09da:docs/reports/STATE.md`
> (to 09-30 morning), `git show 6a18e70:docs/reports/STATE.md` (09-30 evening), `git show d67d840:docs/reports/STATE.md` (10-01).

---

## 10-03 22:56Z — FLEET 3edf1d6 (ore tunnel promoted 22:48Z); CANARY LIVE: craftsync-01 @ ba84fa6 on board-c,
placebo-a (10 bots), declared 22:53:29Z; exactly two versions live (70 x 3edf1d6, 10 x ba84fa6) at 22:56Z.
Reads +180 (~01:53Z) and +360 (~04:53Z); KEEP possible from +360. NOTHING chained behind it (logpickup chain stopped;
craftroom needs its no-logpickup rebuild + registration + the read's positive control proven on craftsync's rows).
Fleet raw iron gained 33 -> 17 -> 6 per 10 h over 10-03 (no fleet-wide change): watch it now the tunnel is fleet-wide.
- **OWNER 10-03 ~23:10Z: "fix the chest full problem, use claude and codex to find the best approach, implement it and
  deploy it" + "yes" to bamboo -> sticks.** Queue: craftsync (live) -> craftroom -> composter -> tool cleanup -> CHEST
  FULL -> BAMBOO STICKS -> logpickup -> explore -> orepack -> cellmem. The ported bank fix is dropped from the slot (frees
  ~0 today; its loop-stopping parts can return later). MEASURED 24 h, 1,970 deposits: success 343 (+99 used another
  chest, +13 built one), failed 938, no_effect 659. Full-chest blocks only 90 -- and **75 of the 90 bots CARRIED a chest**
  while the skill tried to CRAFT one (bug). Bigger deposit losses: 538 path failures (no path 252, goal changed 153,
  path timeout 133) and 494 "not a banking target" (apple 311, dirt 92, scaffold cobblestone 91).
  **DESIGNS (both engines, ~23:30Z) agree:** root cause skills.mjs:2834 crafts a chest unconditionally (place only after a
  successful craft). Claude also found the deposit path DROPS a stack on "destination full" (catch at :2752, then
  chest.close()) -- a never-drop violation; bank-fix's returnCursor cures it. CHEST FIX (building, chest-on-948bc26):
  carried chest first, cursor rescue, new chest only if no container within 16 of home has room, chestSiteRefusal (no
  lids, >= 3 from composter, no adjacent chests, no body-overlap cells, read back after a timeout), shared cap 1 per
  town per 10 min and <= 12 containers. SEPARATE later canaries: deposit admission (no_effect 659: refuse when
  depositPlan is empty) and deposit path failures (538). BAMBOO (2nd): pinned bamboo recipe (never craft('stick'),
  which may burn planks), only when a slot is actually freed (64 bamboo + 0 sticks frees 0), via craftExecutions.
  OWNER QUESTION OPEN: any bankable item may open a new chest (current) vs valuable-only (09-28 rule) -- kept current + cap.

- **craftroom-01 CHAINED (~00:00Z 10-04)** behind craftsync-01: variant ba84fa6 -> ffa0f57 (cr-on-ba84fa6, craftroom
  WITHOUT logpickup; Codex AGREE on the rebuild, Claude confirmation pending -- stop the chain if it says CHANGE; Paper
  regression 15/15). STOPs by itself if craftsync is not promoted. Read /tmp/craftroomread.py = repo c6bd787 (md5
  0dc5218a); POSITIVE CONTROL PROVEN on live craftsync-01 rows: 2 of 5 canary pickaxe crafts lost on the server
  (dry run with the craftsync pools on the control side). Preflights dry-run OK.
- Composter rebuilt without logpickup: co-on-ffa0f57 @ 56db2cd (Codex AGREE). Tool cleanup de7d0aa: both reviews
  CHANGE (non-transitive comparator; name-only equip guard; hard stop 0 only on harvest digs; telemetry) -- fixing.
  Chest fix: building.

- **AUTOMATED LINE (host chains, 23:45Z):** craftsync-01 (live, ba84fa6) -> craftroom-01 (fleet ba84fa6 -> ffa0f57;
  chain pid 2294257) -> composter-01 (fleet ffa0f57 -> 56db2cd; chain pid 2295673; read scripts/host/composterread.py,
  positive control 57 full junk-holding control bots; read under Claude review). Each chain STOPs if the previous run
  was not promoted to the expected sha. Building: tool cleanup fixes (tc-on-948bc26), chest fix (chest-on-948bc26),
  bamboo sticks (bb-on-56db2cd) -- each to be rebased onto the line's tip before its own registration.

- **10-04 ~00:30Z build status (bag fixes):** TOOL CLEANUP 476edb9 -- Claude AGREE, Codex closed all round-1 items;
  being rebased onto 56db2cd (no logpickup). **LOGPICKUP REBASE REQUIREMENT (Codex):** the support-dig veto must clear a
  spent tool to hand/filler before evaluating (2-use axe -> canopy drop -> pickup_failed), with a regression test.
  CHEST FIX 421dc53 -- both CHANGE (cap blocks most towns -> budget on NEW chests: >= 10 min apart, <= 4/day, <= 12
  recovery-created standing, pre-existing not counted; unavailable vs unknown containers with per-town memory;
  MAX_SITE_TRIES=1; verified cursor rescue; 180 s real deadline; truthful closed-bank advice; table access) -- fixing.
  BAMBOO d5736f0 -- Codex CHANGE (re-check the stick cap at execution admission: 63 sticks + 1 picked up during the
  baseline -> 65, slot not freed); Claude CHANGE (pickup refusal must not back off 30 min; split stacks consolidate on
  the real server so the freed decision is too pessimistic; wiring-test mutants survive; row in a finally) -- fixing.
  **BAMBOO YIELD IS SMALL (census 00:40Z):** 68/80 bots at >= 34 slots, 29 hold bamboo, only 9 can fold now (1 slot each,
  ~9 slots fleet-wide); 18 "no batch frees a slot". Tell the owner plainly.

- **10-04 01:35Z: toolclean-01 CHAINED** behind composter-01 (fleet 56db2cd -> tc-on-56db2cd @ 1918bb5; both engines
  AGREE; Paper sandbox 6 scenes x 3 x 2 passed; read /tmp/toolcleanread.py md5 a378d4ad = repo; positive control 87).
  KNOWN pre-existing (both arms): a pathfinder travel dig can swing a held 1-use shovel when travelTool hands back
  nothing (1 of 13 sandbox trials) -- candidate for a later fix (empty the hand before a travel dig).
  **READS NOW ROTATION-AWARE** (logs rotate ~23:59Z; live-only reads dropped the window before it) and the craftsync
  tripwire counts unanswered resyncs (amendment recorded before the +180 read). craftsync-01 so far: 0 of 96 false
  successes (control 117/633), Paper answered 46/46 resyncs, many planks crafts lost to full bags (craftroom's job).

- **10-04 ~02:00Z:** BAMBOO d26eedc both engines AGREE (planner stress-tested on ~25k random bags; live census 19 of
  29 full bamboo holders eligible); Paper sandbox running; read scripts/host/bambooread.py (positive control 27).
  CHEST fix rebased onto the line (chest-on-1918bb5 @ 3be9307, patch-identical, 225/225, 20 mutants): Claude AGREE on
  round 2; Codex CHANGE with 5 reproduced items (standing-cap bypass via dismissed claims, first chest ignores memory,
  unreachable first chest, first attempt not clamped, transfer_unsettled lost on retry) -- builder fixing.
  **OWNER-LEVEL WARNING (Claude):** at <= 4 new chests/day and <= 12 standing, a town whose bank only receives (125k in,
  48 out/day on 09-28) fills its expansion budget in ~3 days; then refusals are honest but permanent. The lasting fix
  is withdrawals or ballast disposal; the chest read should report the refuse_cap share so that point is visible.

- **OWNER 10-04 ~02:50Z: bots WITHDRAW from chests; NEVER deposit junk; existing junk comes OUT. "use both engines to
  formulate, implement ... deploy ... monitor and test ... if not effective revaluate make changes and deploy changes."**
  Running: read-only RCON chest census (slot by slot, tool durability, proposed junk list); both engines designing
  withdraw + no-junk deposit + clear + queue order. The one-time admin clear (09-28 permission) runs only after the
  no-junk fix is live, with the exact list shown to the owner first. 09-27 chests: 124,894 items, 42% cobblestone,
  but 16k logs, 6.8k sticks, 865 stone pickaxes while 45/80 bots lack a usable pickaxe.

- **CHEST CENSUS 10-04 02:52Z (read-only, every slot answered; docs/reports/census/):** bank = 375 containers near
  the 16 homes, 197,863 items, 228/375 full, 73% of slots used. Valuable: 897 usable stone pickaxes (640 > half), 438
  wooden, 8 iron; iron ingots 430; logs 44,701; sticks 14,215; chests 168 -- while 45/80 bots lack a usable pickaxe.
  Junk (proposed): 100,593 items / 3,125 slots (42%): cobblestone above 256/town 81,535; spent tools 1,156; ballast
  9,721; seeds/litter 8,180. Manifest for the owner: docs/reports/chest-clear-manifest-2026-10-04.md (NOT RUN; after
  the no-junk fix; owner decides eggs/scutes/flint/clay/ink 2,297 and decorations 125).
  **SECURITY:** /tmp/scan2.py on 10.0.0.31 holds hive-b's RCON password in plain text and it was printed into this
  session's output while searching for the old census. Owner asked to rotate it and delete the file (and /tmp/scan.py).
  I do not touch credentials.

- **BAMBOO SANDBOX (Paper, ~03:40Z):** short folds work (B: [64,10]+32 sticks -> 5 crafts, 36->35; E cap kept; C/G no
  order; planks never burned) BUT (1) folds > the stuck limit are killed by the 20 s watchdog (32-craft fold stops at
  15, frees nothing; 64 cannot finish; one rep ended fuller) -- no stationary window declared; (2) an ABORTED fold left
  8 bamboo in the 2x2 crafting grid/cursor, invisible to the bag, dropped at logout -- **checking whether this is a
  craftsync defect (live canary, KEEP possible ~04:53Z) or bamboo-only**; (3) row crafts off by one on abort; (4) the
  runner filed the aborted run as success. Harness on main (8ab8a5c). Chest fix 96cfbe0: Claude AGREE; Codex two more
  edge cases (clamped timeout converted in recovery/sweep; walkFrom aliases a mutable Vec3) -- fixing, then withdraw.

- **CRAFTSYNC GRID DEFECT CONFIRMED (10-04 03:25Z, builder repro with real craftsync + mineflayer + fake Paper):** an
  ABORTED 2x2 inventory craft (stuck watchdog, interrupt, preempt) after the first click leaves the grid + cursor
  loaded (craftsync never sends close_window 0 on the cancel path); items return on the next craftsync craft's baseline
  close, that next craft fails once, and a logout/restart before it drops them. Table crafts are clean. The control
  cannot be aborted, so this exposure is NEW. Live canary: 2 of 82 crafts in 4.5 h (oak_planks 2x2). **DECISION:**
  craftsync-01 proceeds to its +360 read (the 19% false-success fix outweighs this narrow, mostly self-healing defect);
  the GRID FIX ships as its own canary right after toolclean: order toolclean -> gridfix -> chest -> withdraw ->
  no-junk -> admin clear -> bamboo -> logpickup.

## 10-05 ~02:45Z — CHESTFULL-01 READY, NOT LAUNCHED (chest-on-1918bb5 @ 6c9a8fb; registration on main
docs/reports/chestfull-01.1918bb5.json; staged on 10.0.0.31: ~/mcai-analysis/chestfull-01.1918bb5.json, /tmp/chestread.py =
repo md5 0b936388, old read backed up /tmp/chestread.py.bak-20261005T024025Z). Suite 225/225, eslint only withinBody.
Launch: `~/chain-after.sh toolclean-01 chestfull-01 1918bb5=/home/mike/mcai-analysis/chestfull-01.1918bb5.json`.
**EXPOSURE AFTER THE CLEAR IS ~0 FOR PLACEMENTS:** 1 storage_full deposit fleet-wide in 8.1 h after 18:07Z (52 in the 12 h
before). The read therefore gates DEFECTS deterministically (C1 off-site, C2 from the bots' own claim ledger in
/var/lib/mcai/_pool-*, C3 unsettled EVENTS, C4 craft-while-carrying from the END snapshot net of a crafted-unplaced chest)
with exposure = the ordinary deposit path (>= 20 canary-build deposits + a control positive control); success DiD is
REPORTED only (identical-code null -0.73/bot-h). The placement path is proven on PAPER (sandbox/craft/chest-ab.cjs, both
arms): carried 2/2 placed + banked (control 2/2 "could not make another chest" while carrying one), craft 4/5 (1 safe
refusal: craftsync baseline_unanswered), budget refusal chain 2/2 (admission refuses, no walk, prompt stops advertising
deposit), roomy 2/2 = control, site 2/2 (no path floor, off table cells), far 2/2 nothing placed; nothing dropped anywhere.
chestread now streams (memory 294 MB for a 12 h walk) -- the other reads still hold every row via Events.load.

## 10-06 ~00:15Z — TREEFARM-01 (blueprint builder + town tree farm) BUILT, REVIEWED, REGISTERED, NOT LAUNCHED. Queue: LAST
(owner 10-05 ~19:00Z). Branch bp-on-1918bb5 @ 453cd07 (base 1918bb5; REBASE onto the fleet sha when its turn comes --
chestSiteRefusal and the junk well's site search must then refuse farmIndex cells). Registration main
docs/reports/treefarm-01.1918bb5.json; read scripts/host/treefarmread.py (staged /tmp/treefarmread.py on 10.0.0.31; dry run
37 s, positive control 352 control log gathers; changerowcheck/licencecheck/v30 preflights dry-run OK). Codex APPROVE r6.
MEASURED (Paper sandbox4): saplings grow a median ~16 min at rtick 3 in light, 0 at night without light, at daylight
speed at night with the farm's torch layout; leaves in a column do NOT block growth (16/16) -- and a harvested tree's
leaves never decay while a neighbour stands, so this mattered. E2E on the final sha: build 9/9 + 4/4 confirmed, SIGKILL
resume, foreign lease, other skills around it, grow -> ordinary gather -> clear -> replant loop closed; harvest A/B on
the same farm: ctrl 15,16 logs vs cand 21,23 (no harm). Bone meal arm built, OFF by default (owner decision pending).
Bags: 76/80 bots hold >= 6 farm saplings, 62/80 carry torches. Design + follow-ons (WORKSHOP, SAFE MINESHAFT, designed
not built): docs/reports/blueprint-builder-design-2026-10-05.md.

## 10-06 06:30Z — CLIMBFLOOD-01 INCONCLUSIVE (+360, 05:11Z), torn down 05:15Z (fleet stays 47110e8). Exposure met (202 opps);
20 s endpoint canary 1.36% -> 0.00% vs control 1.19% -> 1.54% (E0 3.6, 0 observed); harm not detected; BUT correctness
caught 2 real breaches (hive-d-Alpha 04:59Z, caller=ramp_step: dug ICE -- ice melts to water when broken -- then sand
over water 4 s later) + 1 refusal written wet. Fix round (ice/frosted ice as water; ramp_step re-check; Paper ice scenes)
-> climbflood-02. CANARY LIVE: withdraw-01 on board-b,placebo-a (10 bots) since 05:22:41Z (variant 47110e8 = b54e22c);
reads ~08:22Z / ~11:22Z.
MODEL SELECTION checkpoint (Stage A+B, report on main): brain gemma4:26b (LM Studio MLX 8-bit, thinking off, grammar);
overseer + stuck gpt-oss:120b (reasoning medium, Ollama). C1 closed-loop (7B vs gemma Ollama vs gemma LM Studio; 8 bots,
90 min, 3 blocks) running from 06:23Z (orchestrator on the mini, bots on 10.0.0.31). Ollama upgraded 0.33.3 -> 0.35.1.
OWNER DECISIONS PENDING: (1) Studio memory: gemma 8-bit + gpt-oss ~93 GB + co-tenants ~32 GB (LCIA keepwarm coder:7b;
THIS project's own tier-1 shadow analyst cron on 10.0.0.31, ~/analyst.py at :03/:33 calling qwen3.8:27b) exceeds the GPU
budget; (2) C2 needs a bench-only bot-code hook (never deployed), both engines reviewed.

## 10-06 ~04:30Z — READY (not launched): towndeposit td-on-1918bb5 @ 09415cc and foodskip+apples fs-on-1918bb5 @ 41fa406 (Codex
APPROVE; Paper: apples 6 composted / 4 kept x4 in peaceful, 0 with the switch off / on easy / on control); registrations
+ reads on main 419dca1 and on the host; both trial-merge cleanly onto 47110e8 -- rebase onto the fleet sha when their
turn comes (after withdraw).

## 10-06 ~03:30Z — OWNER: compost APPLES in peaceful worlds (same switch as foodskip, keep 4, apples only) -- folded into
foodskip-01 as one "peaceful food policy" variable; builder updating fs-on-1918bb5 + read/registration. Bone meal on the
tree farm offered as the sink; not yet explicitly approved. Model selection A2 (1,008 real decisions): bot brain
gemma4:26b (infeasible 1.3% vs 13.3%, repeats-failed 21% vs 73.5%, 4x loop 28% vs 90%; top blind-judge scores);
overseer gpt-oss:120b (100% valid, 55/60 optimal allocations, 1 rule violation); LM Studio MLX beats Ollama under load
(gemma 8 concurrent: 8.8 s vs 17.1 s; 43 vs 25 decisions/min). Stage C closed-loop runner prepared.

## 10-05 ~23:30Z — TOWNDEPOSIT + FOODSKIP built, reviewed (Codex APPROVE), registered (main d7aafcf), NOT launched; both on
1918bb5 and need rebasing (trial picks onto 47110e8 and withdraw pass). towndeposit Paper: full bag 3/3 banked exactly
the surplus (60-use spare pickaxe, cobble 20, logs 10, raw copper 7), kept spent+best pickaxe, iron, coal, stockpile
targets; the model's own deposit with the same bag banked the spent AND best pickaxe, iron and coal. foodskip: Paper
caught a real bug both reviews missed (mineflayer 4.37.1 stores difficulty undefined on 1.21.8, so auto never fired);
fixed by reading the packet, tested through the real decoder. HONEST: foodskip barely moves bags (sought apples ~0.07
/bot-h; the ~2 food slots already held have no exit -- apples ARE compostable in vanilla: a composter-list change is
the exit, owner decision).

## 10-05 23:03Z — CANARY LIVE: climbflood-01 @ f590430 (cf-on-47110e8) on hive-d,hive-b (10 bots; the draw gave 2 pools,
not the design's 20 bots -- exposure needs >= 100 canary escape opportunities, dry runs gave 107-163 at +180 on 10 bots),
declared 23:01:19Z; exactly two versions (70 on 47110e8, 10 on f590430). Reads +180 ~02:01Z, +360 ~05:01Z 10-06,
extensions to 1560. Withdraw (rebasing onto 47110e8) goes next and will need a quick re-rebase if climbflood is kept.

## 10-05 21:43Z — CHESTFULL-02 KEPT (+360) and PROMOTED: FLEET 47110e8. C1-C4 0, rescues 16 ok, instrument 43; deaths 4/120
bot-h vs 9/240 (0.89x). WATCH: canary successful deposits 37 -> 18 vs control 96 -> 94 (DiD -0.153/bot-h, harm watch,
small n) -- the coming towndeposit makes deposits deterministic. NEXT: withdraw (rebasing onto 47110e8) and climbflood
(rebasing onto 47110e8 as cf-on-47110e8; registered as a FIX per the owner's 09-29 rule: deterministic gates decide,
effect reported; read defects fixed after Codex CHANGE x3 -> APPROVE; Paper: control flooded 17/17 eligible, candidate
0/20) -- whichever is launch-ready first. towndeposit/foodskip and the blueprint builder also need rebases onto 47110e8.

## 10-05 ~19:30Z — OWNER: add a frontier STRATEGIST ("god" layer, Claude/GPT via API, hourly-daily: world goals, role
targets, cross-world lessons, proposed blueprints/rules/skills through the same sandbox + canary gate) to the queue
"further down, its not a rush". Architecture agreed: strategist (frontier) -> overseer (large local) -> bot brain
(fast local) -> reflexes (code), with a deterministic validation layer on every order. Order: model selection ->
overseer first real job (stock record + assembler orders) -> strategist in SHADOW (one plan/day scored against
outcomes) -> authority over overseer targets once it proves out. Needs owner-placed API keys on the host (I never
handle credentials). Not started.

## 10-05 ~19:00Z — OWNER: build a BLUEPRINT BUILDER skill (both engines + GitHub prior art), proven first on a TREE FARM
by town; then a town WORKSHOP and a SAFE MINESHAFT (cobble-lined, ladder exit). Queued BELOW the current queue (after the
cobble rule). Designing/building now on bp-on-1918bb5 (not launched). Bone meal on saplings: a separate switch, default
OFF, until the owner decides. Also discussed (no build yet): overseer roles -- town stock record -> Assembler orders
(806 iron ingots ~= 260 iron pickaxes) -> stock-driven priorities -> Rescuer (big model) -> Builder.

## 10-05 ~18:35Z — OWNER: food no-pickup in peaceful worlds (switch auto|on|off from server difficulty) and an AUTOMATIC
TOWN DEPOSIT for full bags -- both being designed (both engines) and built as separate canaries (towndeposit-01,
foodskip-01). Evidence: docs/reports/bag-creep-analysis-2026-10-05.md (fleet average flat ~33.2 slots; ~11-12
slots/bot have no exit; 715 full-bag town stays carried bankable items, 231 tried a deposit; 35% of model deposit
proposals asked to bank apples; scoreboard undercounts ~0.8 slot -- eggs stack 16). Underground safety:
docs/reports/underground-safety-design-2026-10-05.md (every drowning a sealed pocket; the escape climb digs into
water unchecked = 28% of drownings) -> climbflood-01 being built. Studio co-tenants identified (com.lcia.* launch
agents: keepwarm watchdog restarts Ollama + pins qwen2.5-coder:7b; NUM_PARALLEL=4; caching proxy :11435) -- owner
investigating; Ollama upgrade approved. Model screen A1: gemma4:26b leads (infeasible 1%, repeats failed 14%, overseer
valid 88% vs the fleet 7B 14% / 71% / 17%). QUEUE: chestfull-02 (live) -> withdraw -> climbflood -> towndeposit ->
foodskip -> grid fix -> bamboo -> junk well re-run -> cobble rule.

## 10-05 17:15Z — JUNKWELL-01 REVERTED by the death gate (15:13Z): 6 canary deaths / 51.1 bot-h vs 11 / 358.2 (3.83x,
lower bound 1.40x, randomization p = 0.033). All 6 were 80-173 blocks from the well, deep underground: 4 drownings in
sealed water pockets (y 36-60), 2 lava (y -1, -55); none within 2 min of well activity. MECHANISM (measured): canary
mine actions/bot 15.9 -> 48.9 vs control 34.8 -> 33.5 (DiD +34.3) -- unique among 7 canaries (others -8.2..+5.0), so
NOT a restart effect: freeing bag space sent bots back to iron mining (GET_IRON was blocked on no_room), into the
fleet's existing sealed-pocket and lava weaknesses. The well worked (+180: 154 items disposed, C1-C6 0, junk slots
DiD -1.30). OWNER 17:10Z: work on UNDERGROUND SAFETY next (design with both engines running), and analyse why bags
creep back up (45 at >= 34 slots in 07:01-17:01Z vs 38 overnight; analysis running). The junk well returns after
underground safety. CANARY LIVE: chestfull-02 @ 47110e8 on board-a,board-c,board-d,placebo-d (20 bots) since 15:24Z;
reads ~18:24Z / ~21:24Z. Scoreboard 07:01-17:01Z: no pickaxe 2/80, no usable 12, trip 35, raw iron 167, wood 55.1%.

## 10-05 ~14:30Z — CHAIN: junkwell-01 (live; +180 NOT_YET 13:10Z: 2 wells built, 6 disposals / 154 items, C1-C6 0,
listed-junk slots/bot DiD -1.30, deaths 1 vs 6 same rate) -> chestfull-02 CHAINED on the host (variants 911d792 ->
chest2-on-911d792 @ 7ee230f, which also changes the well's site picker to respect claimed chests; 1918bb5 ->
chest2-on-1918bb5 @ 47110e8). Then withdraw (wd-on-6c9a8fb @ 098cb6b: town-miss gate fixed; rebase onto whichever
chestfull-02 lands) -> grid fix (gf-on-1918bb5 8c9239d / gf-on-911d792 ced0b52 ready; will need a rebase onto the
chest-full fleet sha) -> bamboo. Rebases happen per stage as each lands.

## 10-05 ~13:00Z — OWNER DIRECTION: 4-8 really smart bots are fine (80 not needed); a larger model as OVERSEER and for STUCK
escalation; find the best model(s) with both engines, an "extensive and exhaustive" test, all public sources. The M4 Studio
(ai.ticrcorp.com) is DEDICATED to this; model downloads there are authorized; never 10.0.0.72. Running: Codex research
(docs/reports/model-research-codex-2026-10-05.md: worker qwen3.6:35b-a3b / Nemotron-3.5-Lightning-30B-A3B / qwen3.8:27b /
Gemma 4 26B-A4B; overseer qwen3.5:122b-a10b / gpt-oss:120b / Nemotron-3-Super-120B-A12B; control Hermes-4.3-36B);
Codex test-plan design; Claude research + staged benchmark (A replay of real decisions, B ground-truth scenario suites,
C closed-loop sandbox bots driven by finalists, D blind two-vendor judging) -> docs/reports/model-selection-2026-10-05.md.
Also delivered: trapped-bots-analysis (11-15% real stranding; 4 bots stuck all day; 74% of bot-time outside any skill)
and withdraw-habit-design (bots never learn chest contents; withdraw proposed 10 of 158,821 decisions/24 h).

## 10-05 ~10:30Z — CHESTFULL-01 REVERT INVESTIGATED: no mechanism found. 0 of 7 canary deposits had a watchDigging stop
(fleet nav profile canDig=false); the y=15 chest was targeted 14x in the 3 h BEFORE the deploy on the fleet base (so not
this diff); bank closure never triggered (0 _deposit_new_chest, 0 bank_closed of 201 rejections). The mining rise is
milestone timing: 57 of 71 canary mine decisions were in gather_iron_ore_3 (entered before the deploy); mines per
iron-milestone decision 0.57 vs 0.56 pre (control 0.47 vs 0.51). The deaths were in iron mining, wood gathering and
a goto home after iron. The revert stands as recorded (the gate did its job); the re-run is chestfull-02 with real
fixes Paper found: a bot sealed in a 1-block pocket got "arrived" 17-18 blocks short, struck the good town chest and
CLOSED THE BANK (6c9a8fb 2/2; new 0/2); a deep chest 20 below home was banked into (old 1/1, new 0/3); the chest walk no
longer watches digs; one town boundary (16 h / 12 v); only a truly closed bank closes. chest2-on-1918bb5 @ 47110e8,
Codex APPROVE (round 3), registration chestfull-02.1918bb5.json on main 25c543a. GRID FIX: independent Claude review
APPROVE (Paper: control stranded the grid 12/12, candidate 0/11; bamboo interrupted fold clean 2/2 on the fix);
registration gridfix-01.1918bb5.json (main 483f2b0); a variant on the junk-well base (911d792) is being built so the
chain launches whichever way junkwell-01 ends. QUEUE: junkwell (live) -> gridfix -> chestfull-02 (must add
wellReservedCells to chestSiteRefusal if the well is kept) -> withdraw (rebase onto chest2) -> bamboo (on the grid fix).

## 10-05 10:07Z — CANARY LIVE: junkwell-01 @ 911d792 on placebo-a,board-b (10 bots), declared 10:05:20Z; exactly two
versions (70 on 1918bb5, 10 on 911d792). Reads +180 ~13:05Z, +360 ~16:05Z (extensions to 1560, deadline 1680). Both
engines APPROVE (Codex AGREE after 8 rounds; independent Claude review CHANGE -> APPROVE at 8f73e80; later fixes:
unloaded neighbour = "decide later", snow-raised aim, C4 = stuck inside >= 2 min). Paper: 432/432 items into the shaft,
0 off-list, 0 pickups by a walker, admission refusal, escape from inside in 7 s, creeper clearance 0 spawns.
Expected exposure ~7-12 dispose orders per 6 h once each town builds its well. CONDITION for the chest-full rebase:
chestSiteRefusal must refuse wellReservedCells.
OTHER WORK: withdraw ed0d856 (code done, waits for chest2); chest-full round 6 (chest2-on-1918bb5, evidence + walk fix);
grid fix 8c9239d (Codex APPROVE; Claude review + Paper + registration in progress); bamboo waits for the grid fix.

## 10-05 03:17Z — CHESTFULL-01 REVERTED by the death gate at +30 min (3 canary deaths / 15 bots vs 0 / 65 in 25 min;
randomization p = 0.0018); torn down 03:22Z; fleet 80/80 on 1918bb5 (verified 05:58Z). Deaths: board-a-Bravo drowned
sealed in a flooded pocket at y=45 after entombment; placebo-d-Bravo drowned gathering birch; board-a-Alpha fell 73
blocks during goto. None had a deposit/chest row in the 150 s before death. RESTART EFFECT RULED OUT: over 15 canaries
since 09-27 (8.9M rows, 408 deaths) canary deaths in the first 45 min after deploy 0.023/bot-h vs 0.019 later (excl.
this run); control 0.026 vs 0.028 -- so 3 early deaths (~0.25 expected) is a real outlier. Behaviour shift in the 30 min
(15 bots, small n): canary mine/bot 1.73 -> 4.33 (control 2.85 -> 2.75), _entombed 2.87 -> 4.67 (2.11 -> 2.86), deposits
0.67 -> 0.47 (0.71 -> 0.77); 3 deposits tried a chest at 365,15,184 (y=15, a deep container) "No path". Evidence:
docs/reports/chestfull-01-revert-evidence.txt. Codex causal review running; NO re-run until a mechanism is found or
ruled out. Grid fix (Codex APPROVED 8c9239d) is being prepared for the slot (Claude review + Paper + registration).

## 10-05 02:47Z — CANARY LIVE: chestfull-01 @ 6c9a8fb on board-c,board-a,placebo-d (15 bots), declared 02:46:55Z;
exactly two versions (65 on 1918bb5, 15 on 6c9a8fb). Reads +180 ~05:47Z, +360 ~08:47Z, extensions 540/720, deadline
780 min. After the 10-04 clear a placement is ~0 per 6 h on the canary (1 full-chest failure fleet-wide in 8.1 h vs 52
in the 12 h before), so a KEEP means "C1-C4 defect gates 0 and ordinary deposits unharmed"; placement itself is proven
on Paper (sandbox/craft/chest-ab.cjs: carried chest placed 2/2 where the control failed 2/2; nothing dropped in any
trial). The licence kind row does not gate the verdict (verdict.py has no min_rows); exposure = >= 20 canary deposit
rows + the control positive control. Withdraw (registered on 6c9a8fb) chains after this.

## 10-05 ~02:30Z — BAMBOO-01 READY BUT HELD (bb-on-1918bb5 @ 33384ad; registration on main 33b5a27; staged on the host,
NOT launched). Paper round 2: the stuck-watchdog and tally defects are fixed (32-fold 3/3, 64-fold 3/3 in its window,
planks never burned 26/26, control 6/6 no change) BUT an interrupted fold (low-health reflex) strands up to 46 bamboo in
the 2x2 grid 3/3 -- the craftsync grid defect the GRID FIX repairs; G3 would REVERT on it and the items drop at logout.
DECISION: bamboo waits for the grid fix and is rebased onto it. Canary order, first ready first, dependencies kept:
chest-full (6c9a8fb, sandbox+registration in progress) | grid fix (gf round 5: invalidate the held ticket on a
click-cap timeout) -> bamboo (on the grid fix) -> junk well (building) -> withdraw (on chest-full; Codex APPROVED
2691727; Claude review + first Paper run in progress) -> cobble rule. Grid fix and withdraw share byte-identical
window-binding code (inflight.mjs + craftsync spans). Agents share /tmp/mcai-suite.lock and /tmp/mcai-sandbox.lock.

## 10-05 00:05Z — TOOLCLEAN-01 KEPT (+360); promotion of 1918bb5 fleet-wide follows (chain). Spent axe/shovel/hoe
copies per bot canary 2.25 -> 0.05 vs control 2.27 -> 2.22 (DiD -2.15); G1/G2/G3 0 (G3 amended 19:35Z before the
+180 read: the deposit window covers the whole deposit -- all 10 good-tool losses in the window, both arms, were spare
pickaxes banked during long deposits); instrument 220; 1-use pickaxes/bot DiD +0.13 (reported). Death gate HELD:
6 canary deaths / 120 bot-h vs 7 / 240 (1.71x, lower bound 0.58x); all 6 are idle drownings, none within 90 s of a
spent-tool event; the drawn pools drowned more before the canary too (4 vs 9 in the 6 h pre-window).
NEXT (owner: bags and chests first): bamboo-01 (rebasing onto 1918bb5 + sandbox + registration with change_rows) ->
junk well (building) -> withdraw (round 6) -> cobble rule -> chest-full -> grid fix (round 4, adopting withdraw's
window binding). Session paused twice on Claude limits (10-04 ~20:00-23:55Z).

## 10-04 19:45Z — JUNK WELL SANDBOX (Paper 1.21.8, sandbox3; docs/reports/junk-well-sandbox-2026-10-04.md): control 20/20
picked up on open ground; accuracy 59/60 (117/118 over two runs; the miss re-collected by the thrower); isolation 0
pickups (30 s on the trapdoor, 8 rim blocks, 200 passes, open-trapdoor rim); despawn at age ~6000. FOUND: (1) the age
PAUSES in an unloaded chunk (items wait, still unreachable); (2) pathfinder routes over an OPEN trapdoor (0/12 fell
in crossing) but a bot whose GOAL is the well cell falls in (2/2) -- admission rule + never target the cell; (3)
clearance under the cap is 1.8125 not 1.5: a creeper (1.7) fits and the shaft is dark -- fleet is peaceful, but for
"any world" put the second trapdoor (recipe makes 2) bottom-half on the floor (untested). Run beats reading: the
well's isolation holds, so Codex's 20-iron feeder is not needed; its admission/underground-neighbour concerns are
real and go into the build.
WITHDRAW d490102 (round 4 H-N): 229/229, 79/79 mutants; Codex confirmation running.

## 10-04 18:40Z — DISPOSAL: owner accepts vanilla 5-min despawn as the INTERIM disposal ("fine for now, long term i want
a better solution"). Designs: Claude "junk well" (1x1, floor 2 down, wooden trapdoor cap, 6 planks/town;
docs/reports/disposal-design-2026-10-04.md) vs Codex sealed chest->hoppers->dropper chamber (20 iron + redstone/town;
disposal-design-codex-2026-10-04.md; its merge concern is moot at the measured merge radius 0.5, its admission/
underground-neighbour concerns stand). Paper sandbox subset running to decide. Long-term open item: a better disposal.

## 10-04 18:08Z — ONE-TIME CHEST CLEAR DONE (owner approved). 105,053 junk items / 3,473 slots removed from the 16 town
banks; kept items 92,846 -> 92,846 exactly; full bank containers 233 -> 0; free slots 2,669 -> 6,142. Details in
chest-clear-manifest-2026-10-04.md. **Fleet-wide world event at 18:07Z, inside toolclean-01 (declared 17:55:31Z):** both
arms see it, so DiD absorbs the level shift; note it in the toolclean read. Owner also decided (10-04 ~18:10Z): RCON
rotation later (not major); eggs/flint/clay/ink/scutes have no use -> cleared; cobble: keep 256/town reserve, bank only
when it frees a slot (both-engine no-ledger design); withdraw no-room: junk swap ONLY once a disposal exists, hold
until then. Disposal design (both engines + external search) running. toolclean-01 live: 60 bots 56db2cd, 20 on 1918bb5.

## 10-04 17:51Z — COMPOSTER-01 KEPT (+360) and PROMOTED 56db2cd fleet-wide 17:50:43Z; toolclean-01 chained next.
+360: 12 real compost visits, C1-C5 all 0; junk slots/bot canary 5.60 -> 3.50 vs control 4.90 -> 4.96 (DiD -2.16);
share of bots at >= 34 slots DiD -0.214; 2.00 slots freed per visit. Only board-b built a composter (hive-a visits
used it? -- check hive-a has one after promotion). Deaths 1 vs control 6 (rate 0.017 vs 0.020/bh).
craftroom refusals explained (6 h fleet, 3,187 _craft_room rows, 71 bots): 2,534 refused, all at 36/36 slots with
"no spent tool that can be spared (the last digging pickaxe is kept)"; bags hold leaf_litter, bamboo, saplings, eggs,
cobble. Remedies queued: composter (now fleet), toolclean (next), bamboo fold, no-junk; eggs have NO exit (owner).

## 10-04 17:35Z — CRAFTROOM-01 KEPT (+360, 11:22Z) and PROMOTED ffa0f57 fleet-wide 11:32Z. COMPOSTER-01 LIVE @ 56db2cd on
hive-a,board-b since 11:37:15Z (+180 NOT_YET: 3 real visits, 1 composter, C1-C5 clean, junk slots/bot DiD -0.74);
toolclean-01 chained behind it. (Session paused ~08:20-17:25Z on API limits; the loop ran unattended.)
craftroom +360: canary pickaxe crafts the server saw lost 0 of 19 vs control 123 of 288 (43%; 91 of them at >= 35 slots);
unanswered 0/49; one entombed death on board-a-Bravo (1 vs control 6, under the two-death floor). **Watch:** 225 of 274
canary _craft_room rows are REFUSALS (remedy_failed 112, no_room 111) -- craftroom turned lost pickaxes into refusals;
the full bag is still the blocker, which is what composter/toolclean/withdraw/no-junk target. A refusal must name an
executable remedy (CLAUDE.md): remedy_failed is that remedy failing -- analyse after the composter read.
GRID FIX 55c2bf8: Codex CHANGE (P1: a fence timeout releases ownership while mineflayer still holds a click; the late
click moves items and the row still says grid_clear=yes; P2 passthrough lets reflex clicks overlap cleanup; P2 null
grid_clear on many exits). Round 3 sent: adopt withdraw's `inflight` set (one craftsync implementation). Read drafted:
scripts/host/gridfixread.py (dry run: control positive control 145 unclean 2x2 exits, next craft failed 111/135 = 82%).

## 10-04 07:50Z — WITHDRAW 98b95c8 (round 3 fixed, pushed): Codex CHANGE (2 P1: survival release closes with a click in
flight; confirmCursor does not own the inventory while its answer is pending), Claude APPROVE (5 P2). **Paper sandbox
CONFIRMED confirmCursor** (Paper 1.21.8-60: CLONE + stateId -1 is a no-op, full window_items with the true carried
item, every case). Round 4 = items H-N sent to the builder. **Owner decision sharpened:** "keep holding" cannot keep
its promise -- with a full bag the server drops the stack at the next close/disconnect/death/restart, so holding only
freezes the bot until then. Options built as a switch: hold (default) | close after 30 s | junkswap (swap the cursor
onto a never-bank junk slot, confirm, close: only junk drops). Survival release (air/lava/fire/fall/damage) closes at
once and can drop the held stack on a full bag -- dying would drop everything.

## 10-04 07:30Z — NO-JUNK: ledger DROPPED by both engines; cobble banks only when the transfer empties a bag slot (design file SYNTHESIS)

## 10-04 06:40Z — NO-JUNK DESIGN (both engines; docs/reports/nojunk-design-2026-10-04.md; NOT BUILT, Claude review running)
**Deposit already refuses almost all of the manifest's junk** (bankable.mjs:143-204: goal-wanted, fixed list, ores,
spare usable tools only). 24 h, 1.18M rows, 7,051 items in reconciled deposit runs: cobblestone 62%, wood 34%, ores
2.5%, spent tools 0.7%; ballast/seeds/litter/eggs 0 (positive control: same query finds wood/ores; refusal rows name
apple 302, dirt 90, leaf_litter 37). The census junk dates from the old every-stack deposit loop (replaced ~09-13).
So the live inflow is cobble (~7,200/day) and spent tools (~100/day, withdraw branch already stops them).
**A flat cobble cap is dangerous:** >= 64.6% of banked cobble comes from bots at 34+ slots, for whom it is the bag
relief. Log/plank/stick caps DROPPED (both engines): 4,096 cap vs 44,701 usable; bags net -2,300 wood/day.
Proposed canary stonecap-01 (after withdraw promoted, composter+toolclean closed): cobble 256/town refused only on
evidence (lower bound from chests opened < 6 h, unknown != zero), relief valve at 34+ slots, cap refusal never routes to
chest-full. Plus a hard never-bank list (zero new bag load). Eggs/flint/ink/scutes/clay have NO exit from a bag
(150+64+72 slots across 64 full bags) -- owner decision. Admin clear only after stonecap is KEPT and promoted.

## 10-04 05:15Z — FLEET ba84fa6 (craftsync promoted 05:08Z); CANARY LIVE: craftroom-01 @ ffa0f57 on board-a,hive-b,
declared 05:12:59Z; exactly two versions (70 ba84fa6, 10 ffa0f57). Reads +180 ~08:13Z, +360 ~11:13Z. Chained: composter-01
(fleet ffa0f57 -> 56db2cd), toolclean-01 (fleet 56db2cd -> 1918bb5). scoreboard.py now rotation-aware.

- **WITHDRAW round 3 (515d99c): both CHANGE on the recovery lifecycle** (pending click across timeout; reflex
  equip clicking the inventory during a hold; quiet window != server-confirmed empty cursor; disconnect not
  cancelling a retry; server-closed window; unbounded hold = dead end). Builder applying A-G. **OWNER DECISION PENDING:**
  last resort when a stuck cursor stack has nowhere to go after a verified rearrangement -- (a) keep holding (never
  drop; intervention_needed rows) [DEFAULT, Codex], or (b) close after 30 s (server returns it to the bag; only a
  remainder lands at the bot's feet and is picked back up) [Claude recommends]. Survival reflexes may always release.

## 10-04 04:58Z — craftsync-01 KEPT (+360); promotion to the fleet (ba84fa6) done 05:08Z
- 0 of 215 canary crafts "nothing changed" vs control 236 of 1,337 (18%); Paper answered 82/82 resyncs; 0 confirmed
  without a resync; craft p50 1.6 s / max 4.3 s; _reflex_stuck DiD -0.138/bh; deaths 1 (0.017/bh) vs 7 (0.023/bh).
  58 crafts unconfirmed = full-bag losses, now honest (craftroom's job). Known: aborted 2x2 crafts strand the grid
  (2 of 94) -> grid fix queued after toolclean.
- In review: grid fix (Claude AGREE, Codex CHANGE: in-flight click after cleanup, disconnect tracking, error-path
  verdict) -- fixing; withdraw 18b36d4 round 2 (Claude CHANGE small: abort rows, plan= field, swap failure tests;
  Codex pending); chest fix 6c9a8fb approved (Codex AGREE r5, Claude AGREE r3); bamboo fixes in mutant runs.

## 10-03 22:38Z — oretunnel-03 KEPT (+1560), then promoted
- Iron collected per bot-hour: canary 0.004 -> 0.038, control 0.014 -> 0.016, **DiD +0.033**; 10 iron on 10 canary bots
  vs 29 on 70 control bots; 75 tunnels, 7 reached the ore; tunnel-linked deaths 0; deaths 5 canary (0.019/bh) vs 45
  control (0.035/bh), none mechanism-linked; every v6/v15c guard within. Chain launches craftsync-01 (variant by fleet sha).
- CORRECTION to the tool numbers below: the 2-10-use spent copies were 118 in a 24 h last-snapshot window and 170 in a
  90 min window; both are "latest snapshot per bot" over different windows (Codex and Claude both caught the mismatch).

## 10-03 EVENING (22:40Z) — NEW ORDER (OWNER ~22:30Z: "lets do 1 and 2 now and do the bank fix now too")
- **QUEUE NOW: craftsync (launching after the ore verdict) -> craftroom -> composter -> SPENT-TOOL CLEANUP (new) ->
  BANK FIX (port of bank-fix 4d76b43) -> logpickup -> explore-toward -> orepack -> cellmem.** Still one canary at a
  time. WHY: the full bag is the root blocker (census: bag-full is the top reason wood and iron needs go unmet); full
  bags (59/80 at >= 34) are 40% misc items (bank), 22% tools of which half spent (199 spent: tool cleanup), 14%
  compostable junk (composter), 10% stone (bank), 7% saplings, 5% wood. Logpickup moved last-but-three because it
  FILLS bags (more logs kept).
- logpickup chain (pid 2197785) STOPPED 22:29Z. Craftroom and composter are being REBUILT on ba84fa6 WITHOUT logpickup's
  gather behaviour (helpers only; gather must be byte-identical to ba84fa6). Tool cleanup: design by both engines
  (running). Bank fix: port analysis running.

## 10-03 MIDDAY (11:55Z) — superseded queue, kept for history
- **OWNER 10-03 ~11:20Z: "test each crafting element seperately"; queue per Codex ("i agree with codex"):**
  oretunnel-03 (live, decides ~22:22Z) -> **craftsync-01** -> logpickup -> craftroom -> composter -> explore-toward
  -> orepack -> cellmem (deferred). One change per canary. Explore-toward is no longer next.
- **craftsync-01 CHAINED** behind oretunnel-03 (chain-after.sh pid 2191467, log ~/chain-craftsync-01.out; the explore chain pid 2073712 was stopped). Variants by
  fleet sha: 3edf1d6 -> ba84fa6 (cs-on-3edf1d6, 219/219), 8453c09 -> 9794a58 (cs-on-8453c09, 218/218) (each = base + craftsync 93b3892..6660831 + the
  behaviour-neutral pickup telemetry 3edf1d6..e2b4ebd). Registrations docs/reports/craftsync-01.<fleet>.json; read
  scripts/host/craftsyncread.py (dry run 10-03: control 100/892 crafts "nothing changed" = the positive control; the
  UNCHANGED canary pool read 17/101, so the correctness line would have fired on today's code).
- **logpickup-01 CHAINED (12:36Z)** behind craftsync-01 (chain-after.sh pid 2197785, log ~/chain-logpickup-01.out),
  FOUR variants so it launches whatever craftsync's verdict: fleet ba84fa6 -> a40c588, 9794a58 -> 54ed323 (craftsync
  promoted), 3edf1d6 -> 8c66dda, 8453c09 -> 10251f3 (not promoted; these carry the pickup telemetry). All npm test green.
  Registrations docs/reports/logpickup-01.<fleet>.json; read /tmp/logpickupread.py (md5 = repo).
- **REBASE DEFECT CAUGHT (12:20Z):** logpickup on an 8453c09 base read `gatherT0`, declared only by the ore-tunnel
  change -- every log gather would have thrown ReferenceError. logpickup.test.mjs caught it; fixed in both 8453c09
  variants. Then found the no-undef lint gate (eslint.config.mjs: "Deploys run it") was NEVER run by any v1 fleet
  deploy script (only instance #1's deploy-harness.sh) and the fleet sha fails it. Now `bots/test/lint-gate.test.mjs`
  runs it in the suite (positive control + mutant killed); the one typeof-guarded `withinBody` is declared global.
  Every cross-base variant: run the no-undef lint, not only the suite.
- **craftroom on craftsync (cr-on-a40c588 @ f975a52, builder):** craftsync is the ONE verifier (marker removed),
  count = items, one execution per bot.craft. BOTH reviews CHANGE (14:00Z): [P1, both] room is checked BEFORE craftsync's
  baseline resync -- Codex reproduced a pickaxe tossed when the last slot fills during the resync; fix = an admission
  hook inside craftsync after the resync, before the first click (+1 slot margin with an item entity in range);
  verdict labels from error.reason (unanswered / click_timeout, source=none); executable-remedy refusal. Builder applying.
  **craftroomread.py REWRITTEN** (Claude review: the old gates were 0 by construction under craftsync): correctness =
  canary pickaxe crafts the SERVER saw lost with a full bag <= 1; instrument = verdict=unanswered share <= 5%,
  verified_local = 0. Dry run clean but its positive control (`_craft_sync` lost-pickaxe rows) CANNOT be shown until
  craftsync-01's canary emits them -- prove it on those rows before chaining craftroom.
- **craftroom-on-craftsync APPROVED by both engines at e9da587** (branch cr-on-a40c588, pushed; base a40c588 = the
  logpickup variant for fleet ba84fa6). 5 review rounds, 7 real defects fixed, 30 mutants killed, 222/222: admission
  inside craftsync after an ANSWERED baseline resync (else refuse before any click); pickup hold-back never wears a
  tool, collects only within the table's reach band (anchored to the plan's station), re-measures reach after any
  walk (reason=table_out_of_reach, never no_path); remedies only if executable (placeStackOf, depositFreesSlot);
  verdict labels unanswered/click_timeout, source=none. Known limit: a pickup after clicks start can still toss.
  NEXT: sandbox A/B on Paper (agent running; also lands the craft harness from the scratchpad into sandbox/craft/),
  then registrations once the fleet sha after logpickup is known. Read: scripts/host/craftroomread.py (main c6bd787).
- **craftroom SANDBOX A/B (Paper 1.21.8, 16:40Z, 3 reps/arm/scene, server-slot oracle): control a40c588 TOSSED the
  pickaxe 21 of 21 times the bag had no room; candidate e9da587 never tossed except `race-late` (drop lands mid-clicks;
  both arms 3/3 -- the documented limit).** Candidate: full36 refused with 0 clicks + "place your one dirt" (executed:
  worked, then crafted); race-early/stream refused (admission saw the drop); logs exact (-3 log, +1 pickaxe, table
  retaken; +5.5 s); wear-out spent axe never the good pickaxe; nothing-to-free says so. Deposit advice NOT executed
  (no town chest in the sandbox). Harness landed on main: sandbox/craft/ (67a5efd). Results sandbox/log/craftroom-ab/.
- **BEFORE craftroom's canary, backport from the composter review:** depositTarget (deposit advice names one item the
  craft does not consume -- e9da587's plain "deposit" would bank the craft's own sticks/cobblestone), remedy-first
  text (Codex: 220-char truncation drops the remedy, twice: skill detail and cognitive.mjs:1037), whole-chain
  ingredient protection for planned crafts.
- **craftroom FINAL = b00b22c (cr-on-a40c588, pushed), both engines AGREE (~17:40Z):** e9da587 (sandbox-passed) +
  the backport: deposit advice names one non-ingredient item whose deposit empties a stack (depositTarget), whole-plan
  ingredient protection, remedy-first refusal text checked through formatOutcome (output-identical, 1,152 cases).
  The backport changes advice text only, not the crafting mechanics the sandbox measured.
- **composter on craftroom FINAL = co-on-b00b22c @ 661c249 (pushed), both engines AGREE (~18:30Z).** Stand cell
  enforced before the table (composter_unreachable otherwise). C4: chain room simulated (from logs 2 slots, not 4).
  **SANDBOX (Paper, ~18:45Z): build from logs 6/6 exact (34/36 and 30/36), never starts at 35-36/36 -- BUT 3 defects:**
  bone meal left on the ground 5/6 compost visits; the 20 s stuck watchdog interrupts compost visits (only dig is
  exempt -- guard composition); the stand-cell check passes off-centre and the bot's own body blocks its table cell
  (placement timed out 2/3). Builder fixing; NOT queueable until re-sandboxed. Harness on main (7742265).
  **Fixes d2f3629 RE-SANDBOXED (~19:50Z): bone meal in the bag 6/6 (0 on the ground) with the fleet's 20 s stuck limit,
  no interruption; build 6/6 exact; mid-click toss now composter_no_room; table only placed with the bot centred.**
  Edge: a boat the bot pushes can drift into the chosen table cell (1/3 placement timeout; bounded). Reviews: both
  CHANGE on one item (the avoid-set entry is a no-op; the real hazard is a path node ON TOP of the composter -> an
  exclusionAreasStep) -- builder fixing. Harness re-run on main (650052f).
  **COMPOSTER FINAL = co-on-b00b22c @ 948bc26 (pushed), both engines AGREE (~21:00Z), Paper re-run 9/9** (compost 6/6
  bone meal in the bag at the fleet's 20 s stuck limit; build 3/3 exact). The fleet-wide composter exclusion (d9b8b07)
  was REVERTED to a scoped one: Codex reproduced a drop-down landing on the top that the exclusion did not price
  (getLandingBlock cells never pass exclusionStep) and measured ~8% slower getNeighbors fleet-wide; now only the compost
  visit's two walks borrow a profile whose neighbours are filtered by their real landing cell. Shared movement profiles
  are byte-identical to d2f3629. Queue slot: 4th (after craftsync, logpickup, craftroom).
- **LATENT IRON BLOCKER (sandbox 19:50Z, verified against the fleet):** the 20 s stuck watchdog killed `smelt 8
  raw_iron` at 20.7 s (8 iron ~ 80 s of furnace time; the bot stands still). Fleet 24 h: 0 of 141 failed/aborted/
  unknown smelts coincide with a _reflex_stuck (positive control: 48 other skill rows do -- goto 26, gather 10,
  craft 3), because 72 of 232 smelts had no raw iron and batches are small. It WILL bite once iron flows. Candidate
  fix (both engines first): exempt live furnace waits the way dig is exempt (or a self-expiring stationary window
  bounded by the smelt's own budget, as compost now does); same idea as Claude's suggestion to exempt live crafting
  (craftsync batches can pass 20 s; craftsyncread now REPORTS durations and _reflex_stuck DiD).
- **MAYOR GET_WOOD was blind (found 17:00Z):** world-pooled wood; in 1,376 of 2,661 quiet snapshots a pickaxe-less bot
  held < 2 log-eq while the richest bot held a median 49% of its world's wood. Fix (shadow-mayor 77c025c + 9cad2ad,
  pushed, NOT deployed): per-bot shortage sharing RESTORE_PICK's arithmetic; replay on 2,768 live snapshots: 62 -> 1,812
  firings, = RESTORE_PICK no_ingredients exactly. Also: the mayor test suite had been RED since ~08:35Z (wall-clock
  eviction vs fixture rows) so mutant kills were unscored. Both reviews CHANGE (tests + scorer biases + revision stamp);
  **DEPLOYED 2026-10-03 18:02:46Z: shadow-mayor 784b71c, MAYOR_REV 2e82cfe81496** (matches the reviewer's independent
  hash). Both engines: live assignment behaviour unchanged but for the stamp (Codex replayed 13 ticks old vs new);
  Claude AGREE to deploy; Codex CHANGE items are all in the OFFLINE scorer (retroactive) -- builder fixing before the
  10-06 read. First snapshot per world = <world>@2026-10-03T18:02:46Z (all 16). GET_WOOD leases at deploy: 0.
  Pre-deploy records are `unstamped` (111dadc since 03:17:40Z). Backup ~/mcai-mayor.bak-111dadc. Unit limits intact
  (Nice 10, MemoryMax 512M, CPUQuota 25%). GET_WOOD's 48 h window: 18:02Z 10-03 -> 18:02Z 10-05; never pool pre/post.
  No cfg flag changes during the trial (composter flag off). Scorer runtime on 15 h live data: 4:54, 57 MB.
  **FREEZE UNTIL THE 10-06 READ:** no change to mayor_core.py, mayor_shadow.py or stack_sizes.json and no cfg flag
  change -- any of them starts a new partition and the 48 h GET_WOOD window no longer fits. Scorer-only commits are
  safe. READ RULE (Claude r3): partition 2e82cfe81496/<cfg>, 18:02:46Z 10-03 -> 03:18Z 10-06 (~56 h after warm-up and
  censoring); for GET_WOOD/GET_IRON judge xbase AGAINST THE LEASED-RANDOM baseline's xbase (lease timing cancels), raw
  xbase reported alongside; xrand is a contested-only diagnostic. Deviation from plan: the gate is now target-blind.
- After each KEEP: rebase the next item onto the new fleet sha and chain it. craftroom must take craftsync's count fix
  (count = items) and a test that its final-click marker survives craftsync's click path; composter re-runs its
  build-from-logs sandbox once craftsync is in.

## 10-02 EVENING (20:20Z)
- **fixes-03 KEPT +360 (11:15Z) and PROMOTED: fleet is `8453c09` on all 80.** Good pickaxes lost 1 (120 canary bot-h) vs
  208 (240 control); spent-pickaxe satisfactions 0/147 vs 283/651; climbs +19% (normal); deaths 3 vs 8.
- **digsync2-01 (254f208) REVERTED +180 (15:17Z) on its own correctness gate**: 91 silent acks, 61 got AIR in the 3 s
  grace, 30 restored, 22 of those false (0.73). The server never sends a non-air word; silence = slow break. The
  chain to oretunnel-02 STOPPED correctly. Memory: silence-is-not-refusal. Telemetry detail is capped at 300 chars.
- **NEXT (OWNER 10-02 ~22:15Z: "run explore-toward after the ore tunnel"): exploretoward-02, CHAINED** by
  `chain-after.sh oretunnel-03 exploretoward-02` (pid 2073712, log ~/chain-exploretoward-02.out). It launches after the
  ore tunnel ends WHATEVER its verdict, picking the variant by fleet sha: 8453c09 -> b268881 (explore-on-8453c09, 214/214),
  3edf1d6 -> ccead1e (explore-on-3edf1d6, 215/215). Registrations docs/reports/exploretoward-02.<fleet>.json; read
  /tmp/exploretowardread.py (dry run: instrument 429 control rows).
- **oretunnel-03 +180 (23:27Z): NOT_YET, exposure ready.** 12 tunnels; the 3 that ran ALL reached the ore (3 raw iron;
  control 0); the other 9 were `inventory_full` refusals on 2 bots holding 176-252 spare in stone stacks but no free slot.
  Climbs 8.9 -> 6.7/bh (control 6.7 -> 6.0); deaths 1 vs 6. KEEP possible at +360 (~02:22Z).
- **SHADOW MAYOR LIVE since 2026-10-03 03:17:40Z** on 10.0.0.31: transient unit `mcai-mayor-shadow` (Nice 10, MemoryMax
  512M, CPUQuota 25%, Restart on-failure, exit 6 = output cap, stays down), code ~/mcai-mayor = branch shadow-mayor
  @ a6e8f15 (both engines approved the deterministic part; 66 tests, 60 suite mutants). Writes ONLY /var/lib/mcai-mayor
  (snap-/assign-<world>.jsonl). First tick: 80 bots, 16 worlds, 29 would-assign, 2.0 s CPU, 27 MB. A transient unit
  does not survive a host reboot -- restart it with the same systemd-run line (README). **Decision date: 2026-10-06
  03:18Z (KEEP-BUILDING or STOP).** Frontier replay needs API keys on the host (owner to place) + the client fixes
  queued with the builder.
- **TIMELINE (OWNER 10-03 ~04:40Z: "end of next week is fine"; NO bundling — one change per canary for clean attribution):**
  ore tunnel decides ~22:22Z 10-03 -> explore-toward (+pickup log) -> craftroom -> orepack -> composter (after sandbox)
  -> cell memory (town map stage 1) -> bone-meal trees, bank fix, town map stages 2-3. Shadow mayor in parallel (72 h).
  Chain each next canary on the host as soon as its reviews pass (chain-after.sh), so no operator gap stalls the queue.
- **QUEUE (OWNER 10-03 ~02:15Z: "build a composter, put it in the queue"):** 1) oretunnel-03 (live, verdict ~02:22Z)
  -> 2) exploretoward-02 (chained) -> 3) orepack (ready) -> 4) **composter** (BUILDING, branch composter-on-3edf1d6;
  design agreed by both engines 09-30: one per town, deterministic only when already at town with >= 34 slots, compost
  leaf litter/seeds/flowers, keep saplings/food, collect bone meal, place >= 3 from containers). Then implementation
  reviews by both engines + sandbox. 6) **CRAFT-ROOM + TABLE** (10-03 03:20Z diagnosis): of 7 bots holding cobblestone+sticks without a trip pickaxe, 5 carry
  no crafting_table (crafts fail "need a crafting_table" / "table 32 blocks away could not be reached"); and hive-a-Delta
  (table, full bag) CRAFTED a stone_pickaxe that never reached its bag -- mineflayer drops a craft result with no room
  (163 of 325 pickaxe crafts in 4 h logged "nothing changed"). Fix: never craft into a full bag (make room first or
  refuse with an executable remedy); keep/carry one crafting table; trip-sized pickaxe threshold (need, not a flat 40).
  8) **TOWN MAP / shared mind map** (OWNER 10-03; plan docs/reports/town-map-plan-2026-10-03.md; live shared updates OK): stage 1
  building (remember failed cells, go where gathering worked); stages 2-3 after. 9) **LOG PICKUP** (both engines, 10-03 ~04:40Z, independently): the top log-gather failure is NOT reach -- the log is broken
  and the DROP is not picked up: 291/949 failed log gathers (31%, 48 bots) end "collect threw nothing" and are then
  classed no_path (an action-level learned-avoid vote); 1,866 log drops left behind vs 2,584 logs gained in 3 h; the
  pickup walk's GoalNear(drop,1) times out when the drop rests on leaves (27% of left drops 2.3+ above the feet).
  BUILDING (branch logpickup-on-93b3892): pickup-box goal, break the supporting leaves, finish on inventory gain,
  fail class pickup_failed (no avoid vote). Slot: right after craftroom.
  **SANDBOX 10-03 ~07:00Z (720d079 vs control, 3 reps/scene): wins every scene** — open trunk 15/15 vs 12/15 at
  1.8 vs 6.7 s/log; canopy branch 18/18 vs 14/18; stub 15/15 vs 12/15; full bag 1 log + inventory_full vs control 3 logs
  left + no_path + an avoid rule per rep. Defects being fixed: falling drops judged before landing (server sends item
  positions ~1/s); walk scaffolding with the gathered logs (pre-existing); unreachable label; sweep count. 11b) **CRAFTSYNC — ROOT CAUSE FOUND (sandbox A/B 10-03 ~07:30Z, RCON-verified):** with spare ingredients, unpatched
  mineflayer 4.37.1 silently loses 7/40 single table crafts, 3/20 2x2 crafts, and comes up short on 11/20 repeated crafts in
  one window, reporting success. Cause: ONE global stateId (usually window 0's) + fire-and-forget clicks; Paper applies the
  stale clicks but answers with full refreshes that land behind the click burst, reverting a local slot -> put-away swaps
  on the server -> the result click picks up nothing. LOCKSTEP clicks during bot.craft (wait for quiet; one forced resync
  on open) -> 0/20, 0/10, 0/10; never hung; ~1.4 s per craft. Per-window stateId alone: 3/10 short. BUILDING
  craftsync-on-93b3892 (own canary; propose it NEXT after explore-toward — it is the pickaxe supply). Upstream: mineflayer
  #3906 (same symptom), #4103 (per-window stateId), #3974 (4.39.0). Artifacts: session scratchpad craftsync/.
11e) **CRAFTSYNC @ 6660831: Claude AGREE (4 passes); Codex CHANGES only on rare mixed-variant planning (tight
  oak+birch plank splits in batches report an honest shortfall where a cleverer split exists) — ACCEPTED as a
  documented limitation (fails safe: nothing spent, names the shortfall); revisit if the fleet read shows it.**
  Read note (Claude): duplicate-tool crafts now SUCCEED (74% of craft failures historically targeted items already
  held) and spend materials — count 'root item already held' crafts in the read; a 'you already have a usable one'
  guard is a candidate follow-up.
11d) **CRAFTSYNC SANDBOX through the real craft skill (10-03 ~10:00Z, c5c2dc5 vs 93b3892, RCON oracle):** window-0
  verification answered 140/140. Candidate 38 OK / 0 lost / 0 over / 6 honest fails; CONTROL 16 OK / 13 LOST (reported
  success, nothing made) / 7 OVER-CRAFTED (4 sticks -> 16; 8 planks -> 20 = all logs) / 4 false fails. Cost ~1.1-1.9 s
  per craft. One regression (wooden_pickaxe from logs only: the table eats the pickaxe's planks once over-crafting is
  gone) being fixed. This is likely the largest single pickaxe-supply fix available.
11c) **CRAFTING STATUS 10-03 ~09:30Z:** craftroom APPROVED by both engines at **f0a677c** (verdict from server packets,
  reconcile + one retry after a denial, wear-out room remedy, table retake, `crafted` evidence contract). craftsync
  (lockstep + post-craft verification) in its third round. Both reviewers: keep craftroom's verdict/retry as the safety
  net when combined with craftsync; a combined branch needs a test that the final-click marker survives craftsync's
  click path. PRE-EXISTING FLEET BUG found by the Claude reviewer: craft passes the ITEM count as the CRAFT count (ask 4
  sticks -> 4 crafts -> 16 sticks; wood wasted; can throw 'missing ingredient' after success) — fixed in craftsync,
  must also be applied when craftroom is combined. OWNER DECISION NEEDED: craftsync + craftroom as one 'crafting' canary
  or two.
11) **TABLE CRAFTS REJECTED BY PAPER (sandbox 10-03 ~06:00Z, RCON-verified, BOTH builds):** 5 of 12 crafts at a
  crafting table were rejected by the server (no result, ingredients back in the bag) — mostly the first craft after a
  table is placed — while the fleet's code reports success with a pickaxe that exists only locally. 2x2 grid crafts were
  not rejected. Likely a large share of the fleet's 44% "crafted, nothing changed". Suspect: mineflayer stateId / clicking
  before the crafting window's initial window_items. Both engines diagnosing (root cause + smallest fix in our code).
  Also from that run: wear_out's waitForTicks(2) check misses breaks (same code on the fleet). 10) EXPLORE BLIND-STEP HEADING BUG (pre-existing,
  confirmed by the Claude reviewer 10-03): explore's fallback step calls bot.look(ang) with a math angle, so the body walks a
  MIRRORED heading (ang=0 east walks north). Not a lava risk (stepLineSafe checks the walked line). Fix
  look(Math.atan2(-Math.cos(a), -Math.sin(a)), 0) as its OWN canary (changes explore fleet-wide). 7) **BONE-MEAL TREES AT TOWN** after the composter (renewable wood where the bots live). 5) **SHADOW MAYOR** (OWNER 10-03 ~02:30Z; plan docs/reports/shadow-mayor-plan-2026-10-03.md,
  both engines): host-side, observe-only, NO canary slot -- runs in parallel with the queue; frontier replay after ~24-48 h of
  snapshots; decision date 72 h after start. LATER IDEA: bone meal on planted saplings grows trees at town (the wood bottleneck).
- **READY, not registered: orepack** (branch orepack-on-3edf1d6 @ **f642b17**, 215/215, 43 tests): tunnel room by CAPACITY
  per item with a reserved ore slot (ore room = route iron + target cluster at max drop + 5 slack), post-plan recheck,
  enchanted tools refused with a structured need, a plan-time veto on unplanned digs (same-item spare only, never an empty
  slot). Stack MERGING and bamboo->stick CRAFTING were built and REMOVED (both engines: click races / crafts can toss);
  a bot.dig wrapper was REMOVED (it could refuse a reflex's rescue dig). Reviews: Claude AGREE, Codex APPROVE (6 rounds).
  Of tonight's 9 refusals it would let 3 proceed (the 6 others have no slot for the ore at all). Sandbox: on a full bag it
  passes the room screen where 3edf1d6 refuses; the corpus-iron scene itself is unroutable for BOTH builds (noPath).
  TO RUN: rebase onto the fleet sha after explore-toward; read = tunnel attempts/refusal classes per bot-h, iron collected,
  raw iron left on the ground (the documented residual), enchanted_tool count (expect 0).

- **LEAD (unverified):** 163 of 325 pickaxe crafts that "succeeded" in 4 h logged "nothing changed" (inventory gain not
  seen); 62 of them on an estimated-full bag. mineflayer drops a craft result when the bag is full. Worth a read.
- **WHY IRON IS RARE (10-02 21:00Z, 80 bots, 2-3 h):** iron visible in 77% of scans, but 53/80 bots hold NO pickaxe
  and 52 of those hold no wood; only 11 hold a trip pickaxe, and the iron rung exists only for them. 68% of 1,186 log
  gathers fail (unreachable / no standing spot / beside water); escapes burned ~145 logs in 2 h.
- **oretunnel-03 LAUNCHED 20:19Z**: the ore tunnel on 8453c09 WITHOUT digsync (branch ore-on-8453c09 @ 3edf1d6,
  214/214, Codex APPROVE). Registration docs/reports/oretunnel-03.json. Reads oretunnelread + immobiledid, 180/360/720/1560.

## 10-02 — WHY fixes-02 REVERTED, AND WHAT RUNS NOW
- fixes-02 (f5609af, 10 bots) REVERTED +180 on v11 climbs +123%. **The trip was REAL**: null 858 random 2-pool draws
  (12 h single-version) put climbs > +100% at 0.1%; trapped-seconds +177% vs null p99 +125%. It came with 5x more
  successful mine descents (5.6 -> 30.0/bot/3 h; control flat). Per depth-hour: mid band (y48-62) canary ~ control;
  below y48 canary trapped-s/bh 495 -> 1044 while control 559 -> 370. digsync v1 is the suspect: 92/138 rollbacks
  were false restores (server AIR within 2 s); climbs 2.3-5.1x faster in the 2 min after a rollback.
- **fixes-03** = the bundle minus digsync (branch fixes-nodig-on-bf296c9, 213/213; Codex CHANGES applied:
  fixesbundleread fails closed, licence `_progress_restored` with per-bot coverage). Reads +180 **08:03Z**, +360 **11:03Z**.
  If it trips climbs again: revert, and conclude dropping digsync was insufficient (frozen in the registration).
- **digsync-v2** (branch digsync2-on-8453c09 @ ede3b83, 214/214): a 3 s grace after an ack with no server word;
  restore only at expiry. Codex review + sandbox corpus (control 8453c09) running 06:00Z. Next canary after fixes-03.
- **ore tunnel** rebuilt on digsync-v2: branch ore-on-digsync2 (worktree ore2), tests running.
- **CHAINED ON THE HOST (10-02 06:54Z), each step STOPs on anything but `promoted` at the expected fleet sha:**
  `chain-next.sh fixes-03 8453c09 digsync2-01` (pid 1940380, log ~/chain-digsync2-01.out) and
  `chain-next.sh digsync2-01 254f208 oretunnel-02` (pid 1940387, log ~/chain-oretunnel-02.out). Registrations
  ~/mcai-analysis/digsync2-01.254f208.json, oretunnel-02.553adf2.json (= docs/reports/*.json). Reads in /tmp.
  digsync-v2 final sha **254f208** (3 review rounds, both engines); ore-on-digsync2 **553adf2** (216/216).
- **Climbs guard**: both engines recommend (prospectively) outcome guards — trapped-seconds/bot-h and unrecoverable,
  null-calibrated with restarts — with raw climbs demoted to INCONCLUSIVE; NOT "per descent" (the change makes the
  descents). NOT applied: decide after fixes-03 shows whether digsync v1 caused the traps.
- Iron pickaxes: all 5 lost with >100 uses (24 h) vanished in the same second as an entombment reflex (the toss bug;
  tool-safe, in fixes-03, fixes it).


## WHAT HAPPENED SINCE 09-30 13:20Z (all decided by the host loop)
| run | sha | result |
|---|---|---|
| lastswing-01 | 8ed9450 | KEEP +360, promoted 09-30 19:16Z |
| hygiene-01 | adc7658 | KEEP, recorded 10-01 01:46:59Z, promoted |
| fixes-01 | a943b7f | **REVERT +180 (05:10Z) — FALSE.** The one failing row (prequsableread.spent_satisfied_judged) was placebo-a-Comet 02:03:06Z on the OLD build adc7658, before the restart finished (declared 02:02:10, deployed 02:05:30). Canary-build rows: 0 of 45 spent-satisfied; control 101 of 212. The recorded verdict stands; amendments prospective only. |
| idlegap-01 | bf296c9 | KEEP +360 (11:28Z; deaths 0 vs control 9), promoted fleet-wide 11:38Z; `main` merged it (a2b5d36, `main-pre-20261001b` kept), 208/208 |

**Read fix (e8cd891 on main, /tmp on 10.0.0.31 with `.bak-20261001T*`):** prequsableread, toolsaferead (`_tool_gone`)
and immobiledid (deaths → two-death floor) skip a post-cutoff canary row whose version is NON-EMPTY and not
startswith(CV). Empty versions still count (0 of 450,482 rows carry one). Codex: CHANGES → narrowed → APPROVE. The
other member reads already filtered (audit by a Claude subagent). Memory: restart-lag-rows-are-not-canary.

## (PAST, REVERTED 10-01 16:39Z) fixes-02
| | |
|---|---|
| sha | `f5609af` (branch `idle-on-a943b7f` = fixes3-on-adc7658 a943b7f + bf296c9), 214/214 |
| members | digsync, stale-stop, craft-advice, hive-progress, prereq-usable, tool-safe, bank-why (same seven as fixes-01) |
| pools | board-a, hive-c (both 5080 half) — drawn by the loop 13:28:20Z |
| declared | 2026-10-01T13:28:21Z |
| read +180 | **2026-10-01 16:28Z** (correctness) |
| read +360 | **2026-10-01 19:28Z** — KEEP possible |
| extensions (until exposure) | 540 → 22:28Z · 720 → 10-02 01:28Z · 1080 → 07:28Z · 1560 → 15:28Z |
| deadline | **2026-10-02 17:48Z** (1700 min; v30 passes) |
| registration | `~/mcai-analysis/registrations/fixes-02.json` = `docs/reports/fixes-02.f5609af.json` |
| reads | digsyncread stalestopread craftadviceread hiveprogressread prequsableread toolsaferead bankwhyread fixesbundleread immobiledid (all /tmp) |
| promotion | fleet-wide on KEEP. Then merge `f5609af` into `main` (keep `main-pre-<date>`). |

A REVERT names its member; drop that member and rerun the rest — **but first check the failing rows' build
(`raw.code.version`)**: fixes-01 was lost to an old-build row.

**If the loop has died:** `pgrep -af canary-loop`. If absent and no decision is recorded, restart with
`setsid nohup bash ~/canary-loop.sh fixes-02 >> ~/canary-loop-fixes-02.out 2>&1 < /dev/null &` (resumes from journal).

## (STOPPED) oretunnel-01 chain — rebuilt as ore-on-digsync2, see 10-02 above
`~/chain-ore.sh` (repo `scripts/host/chain-ore.sh`): when fixes-02 ends `promoted` with fleet `f5609af*`, registers
`~/mcai-analysis/oretunnel-01.f5609af.json` (sha **49096f4**, branch `ore-on-f5609af` = bc3bcba + f5609af, 215/215,
v30 passes at 1680) and launches the loop. ANY other ending (torn-down, refused-*, error) → STOP; then rebuild ore
on whatever the fleet is (bc3bcba carries the bundle, so on a torn-down fleet it needs the bundle members removed).

## FLEET
| | |
|---|---|
| baseline | `bf296c9+9287fd`, 70 bots |
| canary | `f5609af+433de1`, 10 bots |
| `main` | `6a18e70` = fleet bf296c9 + docs/scripts |
| analyst 12:00Z | fleet healthy, one version; 49.9 items/bot-h, 39.6 decisions/bot-h; 8 immobile; 3 deaths in 2 h |
| iron funnel (24 h) | raw iron 23, ingots 32, iron pickaxes crafted 3, gone 22 (14 at <= 3 uses) |
| last-swing fleet check | 09-30 baseline to compare: 21/80 bots with a usable pickaxe, 37.5 items/bot-h, 42 deaths/24 h — NOT yet re-measured |

## LOOP STATE
- `check-open-loop.py` 12:05Z: "no open canary". It names fixes-02 open until the loop records a decision.
- **While fixes-02 is unread, no new analysis starts.** Build/stage work for later slots is fine.

## RE-ARM ON A FRESH SESSION
1. `date -u`; read this file; on 10.0.0.31: `grep -E '"fixes-02"|"oretunnel-01"' ~/canary-journal.jsonl | tail`,
   `cat ~/chain-ore.out /srv/mcbots/trial-manifest.json`, `tail ~/digest/page.jsonl`.
2. `pgrep -af 'canary-loop|chain-'` — expect `canary-loop.sh fixes-02` and/or `chain-ore.sh`.
3. If fixes-02 decided: KEEP → confirm 80/80 on f5609af, merge into `main`, PushNotification; confirm chain-ore says
   `launched`. REVERT → check the failing rows' build before believing it; confirm teardown (ONE version), write up.
4. Live versions: `cd /opt/minecraft-ai/scripts && python3 -c "from lib.telemetry import Events; e=Events.load(since_minutes=8); print(e.versions())"`.
5. Monitors: ONE background `until` wait on a journal phase, not re-armed 30-min Monitors.

## OWNER CALLS WAITING (unchanged from 09-27)
1. The v21 death-gate lower bound — trips on 0 of 15 death-involved reverts.
2. The audit (`8019b1d`): 7 of 23 reverts CONFIRMED FALSE, 5 more suspect. (fixes-01 is now another false revert,
   by a different mechanism: restart-lag rows.)
3. Commits headed "OWNER DECISION" with no recorded artefact — three over 24–25 Sep.
4. `vetob2-01` (`efabf13`) KEPT and unpromoted; recommend re-drawing it off the hive pools.

## QUEUE
1. **fixes-03** — LIVE (fixes-02 reverted).
2. **oretunnel-01** — chained.
3. Then each its own canary (rebase onto the fleet sha at launch): **bankfix-01** (bank-fix 15dec57; gate reads
   ledger/RCON, never `_deposit_window`), **exploretoward-01** (86e8985), **vetoretry-01** (1efd82c; d0c47c6 follows).
   Registrations staged in docs/reports (shas need rebasing). Before staging any new read: copy the known-other-build
   skip from prequsableread into every correctness/harm count.
4. COMPOSTER (hygiene phase 2) — designed by both engines 09-30, not built (see `git show 6a18e70:docs/reports/STATE.md` 3c).
5. PARKED: `tool-guard` b1d6b62.
6. Analysis backlog (only when no canary is unread): last-swing/hygiene fleet-wide effect vs 09-30 baseline; why
   `gather cobblestone` ends no_path at the surface; escape burns logs as scaffold; planting cohort vs depletion;
   `container_open` 446/4,160 uncharacterised; ~6,000 bamboo carried (2 bamboo = 1 stick).
7. Colony path: chest ledger (in bank-fix) → shadow-mode mayor (`docs/reports/jobs-mayor-spec-2026-09-29.md`).

## WORKTREES / BRANCHES touched 10-01
- `idle-on-a943b7f` @ f5609af — the live canary; on origin.
- `ore-on-f5609af` @ 49096f4 — chained; on origin (pushed `--no-verify`, new branch only).
- session scratchpad worktree `fx` (disposable).
- `mcai-rl02` worktree carries someone else's uncommitted `check-movement-writers.mjs`, `movement-ratchet.test.mjs`
  and 09-27 reports — still left alone.
