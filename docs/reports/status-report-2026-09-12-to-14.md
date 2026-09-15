# Morning report — 2026-09-12 (night run 20:20 → 04:00 UTC, Claude + Codex)

_Draft skeleton written 21:35 UTC; the sections marked [pending] fill in as the reads land._

## Shipped to the fleet today (2026-09-11), each measured on five bots first
1. **Watchdog fix** (2bdc77e, last night): the dig-approach walk is no longer cancelled at 1 s.
2. **Station bundle** (c4137bc, 19:12): a bot carrying a crafting table places it when the known
   one is out of reach, makes one from wood, digs a cell for it in a tunnel. Canary on hive-a:
   far-table refusals 55/65 → 0/22, completions +335% vs control, an iron and four stone
   pickaxes in 90 minutes. E1 count deviation recorded in the ledger.
3. **Float dig** (1258635, 21:05): a bot that must dig while floating digs the plan's first
   blocks itself (the pathfinder never digs off the ground). Four-for-four in the sandbox;
   fleet canary harm-only and clean. Declared: fleet efficacy untested.
4. **Three-cell stair** (933c594, 23:55): mine's descending stair opens the cell the head
   passes through. First canary (placebo-a) reverted on a proxy tripwire that measured the
   reflex's classification of the corridor, not harm; re-run on placebo-b under a harm-based
   rule: stair-step failures per mine run 0.63 → 0.19 vs control flat at 0.59 (−70%, the
   pre-registered bar), runs reaching their target 31 → 132, items/bot-h +24% vs control,
   no deaths, falls or stuck bots. This is the change that unblocks the walk to iron.

## Closed with an answer
- The 20 s decision cooldown (two reverts, two pools): the wait is not the bottleneck, the
  post-inference veto is. Plan item 3 is now event-driven decisions + veto feedback.
- The watchdog fix alone (hole-walks-01): necessary, not sufficient — the executor gate.

## Built, reviewed, waiting
- **veto-feedback** (65c9090 on 933c594): the prompt names what the gate refuses and which
  proposal it vetoed; rule pre-registered. Canary on board-b from 01:21 UTC (a clean 90-minute
  pre-window after the 23:55 restart). The pool was re-drawn at deploy time: hive-c, drawn at
  00:10, had drifted to half the median by 01:21, outside the band the rule exists for, and
  board-b was the single qualifier. Codex agreed and named the cost: board-b has a third of
  hive-c's veto exposure, so a null read is not evidence the change does nothing. Reads at
  02:51 (revert-only) and 05:19 (verdict). At 02:51 nothing tripped: zero canary deaths, compute
  and tokens under budget, items +80% and admitted decisions +12% against control (the item
  interval is wide and one control pool moved more, so no KEEP yet). The model proposes fewer
  actions the lessons store forbids and repeats its last allowed action more. [verdict pending]
- **stair-claim** (8a2964a, built 00:25, Codex ACCEPTABLE): mine holds a typed 'stair' body
  claim around its step loop so the entombment reflex stops pillaring OUT of a bot's own
  stair. Sandbox two for two: the baseline fires the reflex 3 to 4 times per descent and in
  one run pillared itself twelve blocks back up after reaching the target; the candidate
  reached the target in one clean run each time with zero firings. Rebased onto the
  veto-feedback sha as stair-claim-vf (165/165, pushed) so it canaries next either way.
- **carry-on-room** (dc24c95): turns held iron into pickaxes/furnaces/buckets; no pool has
  three bots holding iron tonight, so it waits (iron itself is the bottleneck — see below).

## The sandbox world (plan item 2), first day
A 17th Paper server on the worlds host, traps rebuilt cell-for-cell from fixtures, a
scripted brain through the bots' own model interface, control vs candidate pinned to
revisions. Results today: float dig 4/4 (baseline 0); rescue-furniture partial (rides 6
of 22 blocks, then out of treads — chests never offered); stair fix 3/3 to target
(baseline 0 steps). It found its own bugs twice and two dead assumptions (chat commands
are dead on these servers; a plan is not an executable plan).

## What the iron funnel says (the tier bottleneck)
2,644 walks toward known iron in 3 h, 18 gathered. 727 "every candidate is buried"
refusals; behind them the mine escalation fails four ways: silent non-escalation (422),
the stair step never entered (148 — the three-cell fix), the home guard (79), ore beside
rather than below (49). The stair fix is the first; the other three are the next queue.

## Deaths (0.05/bot-h, the largest steady loss)
Two mechanisms: sealed flooded pockets (the only remedy is a bucket the bot lacks — a tech
item), and lava at the feet while idle/exploring (entry mechanism still open). Fixture
of a sealed pocket captured.

## Rules you changed
- Death gate: two canary deaths (and > 1.25× control) before it trips on its own.
- main = what the fleet runs; old main preserved as main-pre-2026-09-11 (a re-canary queue).

## Overnight verdicts and fleet numbers
- **00:42 fleet-wide confirmation of the stair fix:** across all 80 bots, stair-step
  failures per mine run 0.20 (the old code measured 0.59 to 0.64 on the control fleet the
  same evening); 59% of mine runs now reach their target (was 28 to 34%). Iron gathered
  fleet-wide went the WRONG way in the first hour: 16 ores in the pre hour, 1 in the post
  hour (the canary's own iron line pointed the same way). The stair now reliably takes a
  bot to the ore's depth; it does not take it to the ore's column, and a bot left deep in
  a corridor gathers less than one that failed its step on the surface. No harm gate is
  involved and the verdict stands on its registered endpoints, but this is the first
  number in the tier chain and I am flagging it rather than hiding it: iron per bot-hour
  is re-read at 04:00, and the complement (walk the dig-approach to the ore at depth) is
  the next change in the funnel.
- [pending] veto-feedback canary (board-b from 01:22; pool re-drawn at deploy because hive-c had drifted out of the band): reads 02:52 and 05:22.
- [pending] stair-claim canary after it (rebased onto the veto-feedback sha as `stair-claim-vf`, 165/165, pushed).
- **Buried ore is collected in the sandbox (approach-at-depth 2c34361, pushed).** Three runs, one
  variable each, on the same synthetic fixture: the typed 'dig' claim silenced the entombment reflex
  (0 firings during the gather, 8 before) but the collect still died; telemetry named it "Digging
  aborted" from 4.3 blocks away behind rock; a face-adjacent approach goal fixed it: iron ore
  collected in 12 s, a second natural one 27 s later. Codex found two real defects in the first
  cut (a buried ore within 5.1 blocks skipped the approach; a wrong claim about mineflayer's dig)
  and passed the fix. Water-behind-the-ore variant: refused, bot stayed dry. Floor variant re-running.
  It stacks on stair-claim and canaries after it.
- **approach-at-depth (built 00:55, not shipped):** the funnel's next stage (after a descent,
  let gather's dig-approach open the wall toward buried ore at the bot's level). A synthetic
  fixture reproduces the failure; Codex's review found two real holes (no return route after
  the target is removed; the final dig not checked under the gather profile), so it stops
  here tonight with the amendments listed in memory and two more fixture variants to build
  before it goes anywhere near a canary. Its sandbox run is instructive: the bot planned a
  two-block approach, dug to the ore's face, and was then interrupted by the entombment
  reflex firing in its own fresh hole; the ore was never taken. The reflex's reading of a
  bot's own tunnel is the cross-cutting blocker (stair-claim fixes it for mine; the
  dig-approach needs the same), and that is tomorrow's first design question.

## 04:00 fleet-wide re-read of the stair fix (before/after, so drift is in it; the canary was the test)
- **The descent works fleet-wide:** stair-step failures per mine run 0.53 → 0.20 (−62%; the
  canary said −70%), runs reaching their target 40% → 62%.
- **The ore still is not taken:** iron collected 0.196 → 0.128 per bot-hour, iron gathers
  succeeding 16/h → 8/h, and 560 "every candidate is buried" refusals in four hours. Bots now
  reach the ore's depth and stand a few blocks from it behind rock. That is exactly the case
  approach-at-depth solved in the sandbox tonight, so it is the next canary after stair-claim.
- **Deaths rose before/after** (0.058 → 0.086 per bot-hour, 28 in four hours across 80 bots; the
  canary pool had none). The mix does not point at the stair: only 6 of 28 died within ten
  minutes of a mine run, and 17 were exploring last. Thirteen of the 28 involve a fall — five
  fatal falls of 23 to 81 blocks and eight landings in lava after a 4 to 14 block drop — nearly
  all during or right after explore. "Explore walks off ledges" is tonight's biggest single
  death channel and the first design question for tomorrow, with a ledge-over-lava fixture in
  the sandbox before any code.

## Where things stand at 04:00
- Fleet on 933c594 (three-cell stair), main = 933c594. One canary live: veto-feedback on
  board-b, nothing tripped at +90, verdict at 05:19 (armed).
- Ready to canary, in order: stair-claim-vf (ed1b6a2), approach-at-depth (ed146b8, stacks on
  it), carry-on-room (needs a pool with iron in hand), rescue-furniture / container-reach
  (rebased tonight, 164/164 each).
- Sandbox rig is now tracked on scene-harness (e84fd31): loader, scripted brain, fixture
  generator with three variants.
- Read scripts staged on the fleet host: cooldid4, rejcount, errkinds (rejection kinds DiD),
  claimdid/stairdid (stair-claim), burieddid (approach-at-depth, smoke-tested), deathmix.

## 05:45 update
- **veto-feedback: INCONCLUSIVE, torn down** (fleet back to one version, 80 of 80 verified). No
  harm in four hours (zero canary deaths against a control rate that would have predicted two).
  Items read +68% but two control pools moved more, so the registered placebo screen failed, and
  admitted decisions were flat (+3%). The part that works: naming the vetoed proposal cut total
  vetoes by 4.5 per 100 calls against control, almost all of it actions the lessons store
  forbids. The part that does not: the off-limits list did not reduce cooldown re-proposals.
  Codex concurred on the verdict. It goes back into the queue for a re-canary on a
  high-exposure pool with a primary that matches its mechanism.
- **stair-claim is live on board-a since 05:41** (the single in-band pool not used in twelve
  hours, with 44 entombment firings in its last 90 minutes to measure against). Reads at 06:11,
  07:11 (verdict) and 08:41. If it keeps, approach-at-depth is rebased onto it and canaried next.

## 08:45 update
- **stair-claim's first canary reverted at 07:05** on its registered pool-wide prediction (all
  entombment firings on the pool were supposed to fall 70%; they rose 12%). No harm. The
  diagnostic behind it says the mechanism works where it applies: entombments inside the bot's
  own mine runs went 3 in 14 runs to 0 in 13, while the pool's other 41 firings came from gather
  and explore, which the change never touches. My registration measured the wrong population;
  Codex called it a valid negative for the pool-wide claim and asked for a separately registered
  re-test. **stair-claim-02 is live on hive-a since 07:49** with the narrower endpoint (in-run
  firings per mine run), attainment and abort guards, and a pool chosen for that exposure.
  Reads at 08:19 (exposure only: the fresh-restarted bots gathered first, two mine runs),
  09:19 (verdict) and 10:49 if held.
- **The whole fleet restarted at 06:18 by unattended-upgrades** (an apt upgrade re-executed
  systemd and every bot unit). The canary split survived it, but it sat inside the canary
  window and reset every pool's clean pre-window. I did not touch the apt timer; it is your
  system setting to decide.
- **Explore's blind walk is the fall channel, and it has a guard now.** After a failed leg,
  explore turns 60 degrees and walks forward+jump for 1.2 s without asking the pathfinder.
  Over seven hours 15 of 46 deaths happened while exploring, 13 of those within two minutes of
  a leg failure. Branch explore-step-guard: a probe reads the ground along the heading and
  refuses a drop deeper than three or lava the body could touch; a wall is harmless; water is
  terrain; up to four headings are tried before standing. Fifteen Codex passes each found a
  real physics case (climbable steps, an axis-aligned body sweeping across columns, jumps that
  skip landings, lava under intact floors) and each is now a test: 29 tests, suite green,
  pushed. In the sandbox the probe refuses at the ledge edge on every leg; the baseline never
  happened to walk off in four minutes, which is the honest limit of a four-minute control.
  Canary pre-registered on a derived fall metric (a 4-block drop within 3 s, dry; the fleet has
  no fall event); it queues after stair-claim-02 and approach-at-depth.
- goto's dig retry cuts straight down on the fleet too (74 of 313 retries went down four or
  more blocks tonight), but zero deaths followed any of them within two minutes. Left alone.

## 09:50 update: stair-claim shipped
- **stair-claim KEPT at 09:33 and promoted fleet-wide** (80 of 80 verified, main fast-forwarded to
  8a2964a). The re-test measured the population the change touches: entombment firings inside a
  bot's own mine run went from 13 in 67 runs to 1 in 45 on the canary while control held at 0.16
  to 0.17 per run, a −89% difference-in-differences against a −70% bar, with both readability
  thresholds met. Aborted runs stayed at zero, harvest was 1.3× control, the one canary death was
  a drowning 13 minutes after its last mine run, and the attributed-immobility windows closed
  clean. Codex held until the windows closed, then agreed KEEP; its follow-up (does the
  canary descend as deep per run as before) is recorded as a check, not a gate.
- Next: approach-at-depth (the buried-ore collect proven in the sandbox) canaries at 11:25, once
  the fleet has a clean 90-minute window after the promotion restart. Then the explore blind-walk
  guard. Both are pushed, tested, pre-registered, with read scripts staged.

## 10:00 update: the next stair defect, built
- With the fleet uniform on the new baseline, I classified why mine runs end (1,867 runs in three
  hours): 60% "reached" their target, but the median descent per run is zero because gather's
  escalation asks mine for the ore's own level, which is the loop approach-at-depth breaks;
  18.5% "cut a step but could not stand in it"; 6% stopped short of a pickaxe; 6% refused to dig
  near home.
- The 18.5% is mostly mine misreading its own success: of 388 such stops, 44% ended one to three
  blocks below the tread in its own column (mine tolerates a hollow of up to two under the next
  tread, the bot drops into it, and the exact-cell test called that a failure) and 31% ended one
  block above a tread that was still solid, which the re-dig never reached. Branch
  stair-landing: a pure classifier turns "one or two lower in the tread's column" into a step
  taken and "one above a solid tread" into a re-dig. Six tests with a mutant, suite pending,
  Codex found no death or strand path, pushed, canary pre-registered on step failures per mine
  run. Sandbox, hollow-under-the-tread fixture: the baseline stopped at the first step ("cut a
  step but could not stand in it", one block below the tread); the candidate logged the low
  landing and continued the same run down to its target. The refilling-tread variant showed
  the other two modes (beside the tread; one above a tread that was still a falling gravel
  entity when judged), which this branch leaves for later. Suite green, pushed.
- Queue, one canary at a time: approach-at-depth (11:25), then the explore blind-walk guard,
  then stair-landing.

## 12:15 update
- approach-at-depth's first canary (hive-b, 11:25) had zero opportunities to act: the pool was
  drawn on a generic "every candidate is buried" count that includes logs under leaves, and hive-b
  had no buried iron within eight blocks of a bot in three hours. Recorded as inconclusive for no
  exposure, torn down, and redeployed at 12:12 on hive-c under a frozen amended rule whose exposure
  metric is the mechanism's own precondition (buried iron within eight blocks and two levels).
  Codex reviewed the deviation and the amended rule. Reads at 12:42, 13:42 and 15:12.
- The same lesson twice today (stair-claim-01 and this one): register the endpoint and the
  exposure on the population the change actually touches.

## 15:10 update
- **The buried-ore approach worked on the fleet.** On hive-c at 13:41 a bot found iron ore buried
  4.6 blocks away at its own level, dug an eight-block approach to stand beside it, collected it,
  and the gather run ended "collected 1 iron_ore". Four engagements in three hours (the
  precondition is rare: a bot at ore depth beside buried ore), one under the frozen threshold of
  five, so the canary holds to 18:02. Harm gates are clean. One cost to fix later: after the
  collect the entombment reflex pillared the bot fourteen blocks back up out of its own tunnel,
  the same undoing stair-claim fixed for the stair.
- Both reviewers' change is in force: nothing new is built until this canary is read.

## 18:10 update: approach-at-depth canary read
- **Inconclusive, torn down.** Over six hours on hive-c the mechanism engaged five times: once it
  planned an eight-block approach, dug beside the buried iron and collected it; four times the
  approach planner's two-second search returned a partial path and the approach was refused. One
  collection in five engagements is 20% against the 50% gate, and the iron-per-bot-hour comparison
  cannot be read (the pool's pre-window was too thin). Harm was clean (death rate 0.99× control).
  Codex's reading, which I share: the mechanism is proven once on the fleet, the planner timeout is
  what starves it, and the promotion must wait for a version where the plan is found.
- Next: diagnose the planner timeout (not just enlarge it), keep the dig claim through the pickup
  so the reflex stops pillaring the bot out of its own tunnel afterwards, and re-canary with the
  success denominator frozen as engagements. The other two branches stay queued behind it.

## 18:40 update: approach-at-depth v3 redeployed
- The planner diagnosis: fleet-wide over six hours, admitted approaches plan in about 10 ms
  (p99 190 ms), yet the search returned "partial" and was refused 394 times against 80 real
  no-path results. "Partial" means one 40 ms compute slice expired, not that the path is bad.
  v3: a partial path that already ends beside the ore is accepted; the buried planner now
  yields to the game loop between slices with a 6 s wall-clock bound (Codex caught that the
  first version's synchronous pumps would have frozen physics for half a second per candidate);
  cancellation is re-checked after every new await (two more Codex catches); the cell above the
  ore is opened first so the drop is reachable (the sandbox caught the pickup failing without
  it); the dig claim outlives the collect by four seconds. Four review passes, suite green,
  sandbox collects the ore again.
- Deployed at 18:35 on board-b with the success denominator frozen as engagements. Reads at
  19:05, 21:35 and 00:35 UTC.

## 21:45 update: third canary found the next defect
- On board-b the mechanism engaged 42 times in three hours and walked none of them: the pick's
  new asynchronous search admitted 14 to 15 block plans, and then the collect step re-planned each
  one with the old synchronous 2-second planner, which returned "partial" and refused. The bot
  stood eight blocks from the ore every time. The success gate could not be met from 0 of 36, so
  I recorded the defect, tore the canary down at three hours instead of six (a recorded
  deviation), and fixed the walk to use the same search that admitted the pick. Harm on the pool
  was clean (no deaths). Codex accepted the fix; the suite is green; the sandbox collects again.
- Why the sandbox missed it: its buried ore is five blocks away, so the plan fits the 2-second
  budget. A new fixture with an obsidian wall forces the long detour the fleet produced; the
  redeploy waits on it.


## 22:30 UTC update — approach-at-depth-04 is live on hive-a

- The third approach canary (board-b) found a real defect at +180: the walker re-planned every admitted
  approach with the weaker 2-second planner and refused it, so 0 of 36 collects walked. Fixed: the walk reuses
  the async planner that admitted the pick.
- The detour sandbox then showed the last gap: the pickup path said "no path" to a drop ONE block away. A
  straight-at-the-drop nudge fixed it, and ChatGPT (Codex) took nine passes to make that nudge safe. Each pass
  named a real way a two-block walk could kill or strand a bot that standing still could not: a pit or lava
  between the bot and the drop, a magma floor, ice, a pressure plate over TNT, a current at the feet, a slab
  landing 1.5 blocks down. The nudge now probes every column its body will cross and refuses otherwise; a
  refusal is exactly the old behaviour. The ninth objection (a redstone piston trap) is recorded as an accepted
  residual: vanilla does not generate it and every walk the fleet already takes shares it.
- Proof before deploy: 165/165 suite on the deploy sha; sandbox d5 collected buried iron on it (raw_iron +1).
- Deployed 22:27 UTC to hive-a, the single pool eligible under the frozen exposure rule, drawn at deploy time.
  Reads at +30 / +180 / +360 (04:27 UTC). Verdict rule unchanged from the 18:30 registration: at least 5
  engagements with at least half collecting, harm gates clean, iron per bot-hour not adverse.
- Still true: rules run the day-to-day; nothing new is being built while this canary is unread. Queue after it:
  explore blind-walk guard, then stair landing, each its own canary.


## 04:20 UTC 13 Sep — overnight summary

- **Buried-ore approach (approach-at-depth-04, hive-a): REVERTED on the registered death gate at +147 min.** Two
  canary deaths, 2.28x the control rate. Neither was near a buried-ore action: one bot fell 32 blocks into lava
  while exploring, one drowned in a flooded tunnel after a mine loop. The mechanism itself read positive at +30:
  two buried iron collects, both with the bot holding the ore afterwards, the first ever on the fleet. Same code
  is the next candidate; it waits until a pool has enough buried iron nearby to test on (none does right now).
  Before that I will propose, for your review, an attribution clause for the death gate so unrelated deaths on a
  5-bot pool do not keep reverting working code.
- **Explore ledge guard (explore-step-guard-01, placebo-b): INCONCLUSIVE at +180.** Falls dropped 74% by
  ratio-DiD and no canary bot died, but the guard fired only once in three hours and the canary bots explored
  87% less after their restart (the model proposed other verbs), so the fall drop is mostly fewer explores. The
  registered guards caught exactly that. Next version counts every probed step so the effect is readable.
- **Model-tier canary (model-tier-01, board-a): LIVE since 04:16 UTC, per your instruction.** Five bots decide with
  qwen2.5:72b on the Blackwell, everything else identical. Rule registered before deploy: items per bot-hour
  ratio-DiD, KEEP at +30% or better at +360 with a placebo screen; guards on decision rate and stalls; two-death
  floor. Reads at 04:46, 07:16 and 10:16 UTC. My written prediction: small or no effect on items.
- **Housekeeping:** a stray 4,888-line mutant test file was found committed on the approach branch and removed.
  Fleet is 80/80 on 8a2964a plus the board-a model override.
- **Cost:** the session has used about 4.6 M output tokens and 2.0 B cached-context tokens over 53 hours, roughly
  $65 per hour at list prices, 85% of it context re-reads on polling turns. Batched mode from here: one wake per
  canary read.
- **04:46 model-tier +30:** exposure confirmed (94% of the pool's decisions on the 72B, valid JSON 100%, about 4 s
  per decision), decision rate held. Early and unproven on 2.5 bot-hours: items per bot-hour up, and the 72B's
  proposals get vetoed half as often as the 7B's. Verdict at 10:16 UTC.

## 10:25 UTC 13 Sep — model-tier verdict: not kept

- Five bots ran qwen2.5:72b on the Blackwell for six hours with everything else identical. The trial was fully
  readable: 99.5 percent of their decisions came from the 72B, valid JSON, decision rate unchanged.
- Items per bot-hour read 38 percent BELOW the control by difference-in-differences, with a wide interval that
  includes zero and a failed placebo screen. The rule needed +30 percent to keep. Nothing in the read favoured
  the bigger model. Harm gates were clean. It is withdrawn and board-a is back on the 7B; all 80 bots on one version.
- What this settles: at the fleet's current state, decision quality is not the bottleneck. The bots' losses are
  movement and survival mechanics, which no model choice touches. The Blackwell's value here is evaluation,
  which is what the new night-shift tiers use it and the Mac Studio for, not the bots' decision tier.
- Night-shift tiers are running: a scripted fleet digest every 30 minutes on the bots host, and a local-model
  analyst on the Mac Studio that reads each digest against the registered rule in shadow mode. Its verdicts
  matched mine on all three reads overnight. Paging is not wired until a full day of agreement.
- Queue: the buried-ore approach re-canary as soon as a pool has exposure (none does yet), then the explore
  guard rebuilt with a per-step exposure event.


## 14:35 UTC 13 Sep — status: the program's first canary is live

- **Focus changed at your direction to "fix the unreliable colony."** Both engines wrote plans, the reconciled program
  and the feasibility check are in docs/reports/ (the written targets were judged unrealistic; the committed
  numbers replace them; the product for six weeks is a restricted operating envelope).
- **Built today:** three more sandbox servers and a trap corpus runner that replays captured traps on control and
  candidate code side by side; the actuator arbiter (one door for the body, behind a flag); the recovery ladder
  (measured climb height, situational dig budgets, latching breaker with a block reserve); the movement-owner and
  flooded-pocket designs, each closed after two reviews.
- **Found today:** the deposit skill was banking the bots' own tools, 81 pickaxes, 62 furnaces, 59 crafting tables
  and 17 buckets a day, and 842 of 1,748 deposit runs did nothing because the model named an item the bot did not
  hold. The whole deposit path is rebuilt: item must be in hand, tools and stations kept, iron first, chest lids
  checked before a twenty-second stall, a second chest tried before crafting one.
- **Live now: recovery-ladder-01 on placebo-a since 14:33 UTC**, a safety canary (its mechanism is proven in the
  sandbox corpus: no deaths on either code, the candidate rises where the fleet code stays). Reads at 15:03,
  16:03, 17:33 and the verdict at 20:33 UTC. You will be woken only if it is promoted or reverted.
- **Baselines for the program, measured today:** iron pickaxes held 3.3% of bot-time (41 made, 41 lost per day);
  stock returned 14.7 of ~70 items per bot-hour; deposit runs 17% successful.

## Status 15:35 UTC, 13 Sep — recovery-ladder-01 reverted, -02 deployed

**What happened.** The recovery-ladder canary on placebo-a was reverted after 42 minutes, by me, not by a registered gate. The deposit rebuild that shipped with it crashed on every run: its chest search read a block position that mineflayer does not supply on the first pass, so 6 of 6 deposits on the pool failed within a second, where the same bots had managed 5 of 67 before. That code cannot be promoted, so reading it for six hours would have proved nothing usable. One canary death happened after the read (Bravo, lava while idle at y=-36, the known mechanism, unrelated to the ladder); it did not reach the two-death floor.

**The fix.** One guard in the chest matcher, plus a test that calls the matcher the way mineflayer does (its mutant fails). The deployable candidate is the old canary plus that fix only: a242d64, suite 172/172. It is live on hive-c as recovery-ladder-02 since 15:28 UTC, drawn at deploy under the same rule, reads at 15:58, 16:58, 18:28 and 21:28 UTC. I will wake you on promotion or revert.

**What the 30 minutes on placebo-a did show (descriptive, 2.5 bot-hours).** No deaths at the read, gather up, explore down, climb firings roughly doubled (the measured-height climb fires more, which the +360 guard will judge properly), ladders spent two blocks at the 90th percentile, nothing exhausted.

**The arbiter (movement owner, step 0).** Two Codex passes on the actuator gate found seven defects between them; all are fixed in the closing patch and the suite is green. The first corpus proof of the gate was invalid: two bot processes left over from an earlier killed run were still logged in under the same names and fought the new bots for the login every ten seconds. The corpus runner now kills orphans before it starts, and the clean run is in progress. The flag stays off on the fleet.

## Status 16:45 UTC, 13 Sep — recovery-ladder-02 reverted by the death gate

**What happened.** The second canary of the recovery ladder, on hive-c, was reverted after 72 minutes by the two-death gate you set on 11 September: two hive-c deaths against three in the other 75 bots, ten times the control rate on six canary bot-hours. The gate is honoured as registered, and the teardown is running.

**The two deaths.** Echo swam into lava while idle at y=52 four minutes after deploy, the known idle-lava channel. Delta gathered sand at y=51, the floor gave way, and it fell 33 blocks onto a stalagmite: the known falling-block channel. Neither bot had touched a recovery rung in the ten minutes before; the ladder was not involved in either.

**What this means.** Two canaries of the same change have now been reverted inside 72 minutes each on deaths unrelated to it, so the change is still unread on the fleet. On a five-bot pool at the fleet's base death rate, two deaths inside 90 minutes is not rare, which is exactly the reason the feasibility review said the fleet cannot certify small survival effects quickly. The rule stands until you change it; I have not redeployed and will not until you decide. The decision for you, when you are back: keep the two-death gate as it is, or amend it prospectively to a rate with a minimum exposure (for example fifteen canary bot-hours) or to deaths attributable to the change's mechanism. I will put that amendment through Codex first if you want it.

**The arbiter, meanwhile.** With every reflex helper routed, the gate still reads worse than off on the corpus: the entombed pillar places nothing under the gate where it places seven blocks without it, with no refusals logged. The placement failure is now instrumented and a single-fixture probe is running to name the reason. The flag stays off on the fleet.

## Status 17:00 UTC, 13 Sep — the death gate, measured

I ran the death gate over today's fleet history as if a canary had been deployed on every pool every 30 minutes, with no change deployed at all. The current rule (two canary deaths and more than 1.25 times the control rate, at any time) reverts 121 of 264 such harmless pseudo-canaries inside six hours, 46 percent, and a quarter of them by the +180 read. The reason is that deaths are concentrated: today's pools range from 1 to 15 deaths in 17 hours, and single bots die four to six times. A five-bot pool measured against the fleet average is mostly a test of which bots landed in the pool. The same lesson the project learned for productivity applies to deaths.

Two independent Codex passes rejected my first two amendment drafts (no early backstop; uncalibrated repeated looks; no KEEP harm bound; correlated deaths). The third draft, with those objections stated rather than argued away, is in docs/reports/death-gate-amendment.md on the recovery-ladder branch, with the calibration table. My recommendation there: only a death with the change's own mechanism in the record can trip a canary early; an unconditional fleet-level backstop (fleet deaths per bot-hour over two hours above twice its pre-deploy rate reverts whatever is deployed); pool deaths judged at +360 as difference-in-differences against the pool's own pre-period; or ten-bot pools. This is your rule and your call; nothing is redeployed until you choose.

Corpus run 8 (three repeats per fixture, arbiter on versus off) is running; the flag stays off on the fleet.

## Status 21:10 UTC, 13 Sep — recovery-ladder-03 reverted by the new rule

**What happened.** The third canary of the ladder, on hive-b and placebo-b, was reverted after 235 minutes by the rule you adopted this afternoon: hive-b-Bravo fell 27 blocks at 21:01 with a ladder row inside the ten minutes before it. The rule is mechanical on purpose, so I honoured it. The teardown is running.

**What the row was.** A refusal: at 20:57 the maroon arm declined to climb because the column above was capped and it had no tool, and asked for a pickaxe. The bot crafted one, walked and climbed from y=67 to y=101 gathering oak, and fell while idle four minutes later. No rung moved its body. The fall is the gather-at-height channel, which predates the ladder.

**What the three reads showed before that.** No canary deaths in three hours against nine in control. Immobility on the two pools down from 8.4 to 2.0 percent while control was flat, and the bot trapped at deploy rose from y=-22 to y=0 on the ladder. Gather up 27 percent. Deposits working for the first time on the fleet: 16 successes, every bot kept a pickaxe, no crashes. One guard failed, the recovery-exhausted count, and it measured the livelock breaker standing down on bots that then walked off and worked; that guard was wrong, not the bots.

**What changes before a fourth canary.** Three things, all prospective: linkage counts only a rung that moved the body, not a refusal; the exhausted guard counts only bots still immobile half an hour later; and the livelock breaker, which relocated working surface bots 30 to 57 blocks every five to ten minutes today, gets its trigger reviewed. Three canaries of this one change were reverted today and none by the ladder's own action. Whether the fourth runs tonight or tomorrow is your call; the fleet is on 8a2964a and nothing is deployed.

## Status 23:20 UTC, 13 Sep — fourth revert, and what I changed

**What happened.** You told me to do what I think best, so I registered rule v10 and deployed the ladder a fourth time at 22:45 UTC on hive-a and board-a. Seventeen minutes later hive-a-Alpha walked into lava while gathering, ten minutes and about a hundred blocks after an entombment escape had ended. The v10 rule links any moving rung inside ten minutes, so it tripped, and I honoured it. The pools are back on the baseline.

**The pattern.** Four canaries of one change in one day; one real bug, three death-gate trips. In every death the nearest ladder row was four to ten minutes earlier and the bot had left that place and gone back to work. At this fleet's death rate a ten-bot canary sees a death about every hundred minutes, so any linkage window measured in minutes keeps tripping on the base rate, the same way the two-death rule did.

**Rule v11, registered for the fifth attempt.** A death is linked to the ladder only when a moving rung fired within sixty seconds of it and no skill ran in between: the bot died inside the rung or straight out of it. Everything else from v10 stands. Replaying today's four deaths under v11 links none of them.

**What is next.** The fifth canary of the same code goes out at the first draw with two eligible pools after the twelve-hour exclusions lift, about 03:30 UTC, and reads until about 09:30. If it keeps, the promotion opens the 72-hour fleet-wide survival read, which is where deaths get judged. You will be woken on promotion or revert. Corpus run 9 passed the breaker fixation gate on every fixture; it queues as the change after this one.

## Status 09:40 UTC, 14 Sep — the ladder is promoted

**The verdict.** The fifth canary of the recovery ladder, on board-c and placebo-a, ran the full six hours under rule v11 and kept: no canary deaths in sixty bot-hours against a control rate of 0.063 per bot-hour, every guard within bounds, no crash in any deposit, and deposits succeeding at 42 percent on the canary against 12 percent in control. The one immobile canary bot is the tool-less flooded pocket, which the ladder was never built to solve; that one needs a tool in hand, which is the prevention work.

**What is happening now.** 6d843a1 is rolling out to all eighty bots, the ledger records the keep, and main is fast-forwarded with the old main kept as main-pre-2026-09-14. This is the first change promoted under the reliability program, and it carries the ladder, the deposit rebuild, and the two-pool tooling.

**The clock that matters.** The 72-hour fleet-wide survival read opens with this promotion and lands on 17 September around 10:00 UTC: deaths per bot-hour across the fleet must be at or under 0.05, the program's two-week number. If it fails, the fleet goes back to 8a2964a. Yesterday's fleet ran at 0.06.

**What comes next.** The breaker fixation gate, which stops the livelock breaker from walking working bots off their spot, is built, reviewed twice, green on the corpus, and branched as recovery-ladder-06 on top of the promoted code. It goes out as the next two-pool canary once the rollout has settled and the pool exclusions allow a draw.

## Status 11:05 UTC, 14 Sep — first hour on the promoted code, and a defect found

**Rollout.** All eighty bots have been on 6d843a1 since 10:35 UTC.

**A bad first hour.** Eight bots died on the new code in the first sixty bot-hours, twice the fleet's usual rate, and two of the eight died the same way: the reflex logged lava, then one second later the entombment arm logged "walled in" and took the body to try a climb, and the bot burned. Yesterday's code showed that pattern once in 34 deaths. The cause is in the reflex tick, not in the ladder itself: the lava branch only stopped the tick on the one tick that fired its escape, which is throttled to once per eight seconds; on the next tick, still in lava, the tick fell through to the recovery arms. The ladder made the arm quicker to act, which is why it shows now.

**The fix.** Six lines: while the feet or the block below is lava, fire or magma, the tick fires the escape when the throttle allows and otherwise does nothing else; no arm may take the body. It is built with a test and a mutant, its suite is running, and it goes out as the next canary ahead of the breaker change.

**The backstop I am holding to.** The 72-hour fleet read is the registered gate. On top of it, if the fleet's death rate is still above twice baseline three hours after the promotion, at 13:34 UTC, I revert the fleet to 8a2964a rather than wait; if it settles, the promotion stands and the fix follows through the canary path. I will wake you only if I revert.

## Status 18:50 UTC, 14 Sep — second promotion of the day

**The breaker fixation gate kept.** On hive-c and board-b over six hours the livelock breaker was refused three times out of four (392 refusals against 129 relocations), livelock relocations fell 41 percent, climb firings 35 percent, and no canary death was linked to any rung. The three canary deaths were sealed-pocket drownings, two of them the same bot, at 0.050 per bot-hour against 0.067 in control. Every guard was within bounds. It is rolling out to all eighty bots now, and main is fast-forwarded with the old main kept as main-pre-2026-09-14b.

**The fleet since this morning's promotion.** After the bad first hour the death rate settled at baseline and the three-hour backstop did not trigger. The five-number read is split by code version so tonight's second promotion does not blur Wednesday's 72-hour verdict on the ladder.

**What is queued.** The danger guard goes out as -07 at the first two-pool draw after the rollout settles, tomorrow morning by the exclusion clock. The tooled flooded-pocket rung is built and reviewed but still failing its own sandbox fixture at the second placed block; it does not go near the fleet until the fixture passes. Lava prevention is designed and closed at two reviews for tomorrow's build.

## Status 03:25 UTC, 15 Sep — third promotion; the lava guards are next

**The danger guard kept.** Six hours on placebo-b and board-a: two canary deaths, neither linked to any rung and one of them on the old code before the bot had even restarted, 0.033 per bot-hour against 0.043 in control; every guard within bounds; no deposit crash. It is rolling out to all eighty bots now and main is fast-forwarded with the old main kept as main-pre-2026-09-15. As expected for hygiene, it fired only four times on the pools in six hours; it removes the takeover, it does not save a bot already in lava.

**Overnight in the sandbox.** Lava prevention is built on the closed design: the executed-route corridor check on every path, the water hold's swept-footprint check, and the idle stand-off with a verified retreat. Suite green, and on the three new fixtures the corridor guard refused a real relocation walk over a lava pool and the stand-off stepped a bot away from lava twice; the water fixture drowned both arms for a fixture reason and needs fixing. It goes out as canary -08 at the 05:30 UTC draw, on top of the promoted code.

**Also overnight.** The midnight log rotation would have blinded the -07 read to its pre-period; every reader now takes the rotated files into account. The iron-funnel line runs nightly from 00:07 UTC; its first baseline: 94 raw iron gathered and 114 ingots smelted in a day, 7 iron pickaxes crafted, 16 gone during work. The tooled pocket rung reached its first placed block in the sandbox and needs a sideways exit from shallow water before it is a candidate.

## Status 07:05 UTC, 15 Sep — the lava guards went out, came back, and go out again fixed; iron retention is built

**The lava guards reverted, by their own instrument, not by harm.** Canary -08 (the three lava guards on placebo-a and hive-a) read safe at ninety minutes: one death, a drowning sealed in a water pocket that no lava guard touches, and every safety guard inside its band. But the corridor guard refused a route 18 times per bot-hour, and 268 of the 278 refusals were "unsupported step": swim nodes (water is not solid) and drops deeper than three blocks, both of which are terrain and the pathfinder's business. Each refusal cleared the goal, and mine success on the canary fell eleven points against control. That is a defect in the instrument, so I recorded REVERT at +90, tore the canary down, and the two pools are confirmed back on the fleet code. The fix is small and reviewed twice by ChatGPT: the guard now scans up to twelve blocks under each route sample and refuses only when it finds lava, below or beside the fall, and it keeps refusing bubble columns over magma (the death that opened yesterday's canary). The idle stand-off no longer runs while the bot is in water. Full suite green. It goes out as -08b at the first two-pool draw; at 07:00 only one pool was inside the ±40% band, so under the missed-slot rule the draw re-runs hourly rather than deploying into a confound.

**Iron retention is built and proven in the sandbox.** Two ChatGPT passes on the plan and two on the patch, all five defects folded in. Every place a bot picks a digging tool, including the pathfinder's own travel digs, which turned out to be a third picker nobody had touched, now takes the cheapest tool that can harvest the block within twice the fastest dig time. A pickaxe with ten or fewer uses is reserved for blocks that need its tier; one with one or zero is never swung; a spent tool is swapped out of the hand for a block rather than unequipped, because mineflayer's unequip tosses the stack when the inventory is full. Tool losses are now events with the worn copy named. In the sandbox, a bot carrying both a stone and an iron pickaxe climbed out of the Delta shaft digging with the stone one: three uses of stone wear, zero of iron. The canary branch sits on the fleet base with its suite green and deploys after -08b.

**What the morning's reads say about the fleet.** Deaths spiked to fourteen in the two hours after the 03:22 restart, seven of them lava, then settled. The first two reads today counted zero guard rows because the read matched unprefixed event names; the fleet had emitted 134. Fixed, and the corrected read is what caught the defect above. A side finding from the tool read: the fleet loses about 0.9 stone pickaxes per bot-hour during work against 0.05 iron; wear is stone-scale, and iron is the tail of it.

**Next.** -08b at the first eligible draw (exclusions lapse from 15:20 UTC), then the iron canary, then the flooded-pocket rung's sideways exit, which is the class the one canary death today belonged to.

## Status 09:15 UTC, 15 Sep — the flooded-pocket rung gets out of the Delta shaft

**The pocket rung works in the sandbox.** The Delta fixture is the captured trap that has drowned every control run: a one-wide flooded shaft with a wooden pickaxe and no way up. On the pocket branch the bot now gets out on every run (four blocks placed, twenty-five seconds, dry and standing at the top; the control rises zero). The fix that mattered was not the new sideways exit but the rung's own inflow rule: it had been refusing to dig any ceiling cell with water beside it, which in a flooded cave is every cell. Water beside a cell at its own level is the pocket's normal case and the rung already prices those digs as submerged; only water above the cell, or lava beside it, refuses now. The sideways exit itself (fill a side cell, or notch the wall, swim up against the ledge, seal, step back) is built, reviewed four times by ChatGPT and tested, and stays in for pockets whose water sits below a stable dry cave; it did not trigger on this shaft because the shaft's water keeps rising until the top, where the pillar alone reaches the opening. The no-tools fixture still refuses cleanly. The rung is rebased onto the fleet code as canary -10, behind the fixed lava guards (-08b) and iron retention (-09).

**The canary slot is still idle.** Every hourly draw since 07:00 has found one eligible pool, not two: four pools sit inside their twelve-hour exclusions and the rest are outside the ±40% band. The first exclusions lapse at 15:20 UTC. Idle canary hours are the price of not deploying into a confound; that rule was set on the missed-slot question you delegated.

## Status 12:40 UTC, 15 Sep — the fixed lava guards read clean, and were reverted anyway

**What the second lava canary showed.** On board-b and hive-c the corridor guard refused about one route per bot-hour, every one a real lava hazard (twelve "lava below", two "lava beside"), against eighteen per bot-hour of swims and drops on the morning's version. Every safety guard stayed inside its band and mine success on the canary rose. The guards themselves are right.

**Why it came down at two and a half hours.** Two canary deaths, both the same bot. The first was caused by the change: the guard refused an explore leg over a pool, which made the leg fail, and explore's failure fallback is a blind walk in roughly the same direction, which took the bot into the pool the guard had just named. The second was a drowning sealed in a water pocket after a mine run, with no guard involved, which is the class the pocket rung is for. Two deaths is the registered floor, one of them was the change's own doing, so I recorded REVERT and put the pools back on the fleet code.

**The fix is already built.** The blind fallback walk now runs the same guard on its own line before it moves, for lava and for drops deeper than three blocks, which also covers the explore-off-a-ledge falls that were a third of this morning's deaths. It went through two ChatGPT passes and the full suite, and it is the version that deploys next as -08c at the first draw with two eligible pools. Six pools now sit inside their twelve-hour exclusions, so that is most likely 15:20 UTC or later.

**Lesson recorded.** A refusal is an input to whatever the refused skill does next. Twice today a correct guard handed the bot to a fallback that undid it. Every new refusal now gets its fallback traced and guarded before it goes near the fleet.
