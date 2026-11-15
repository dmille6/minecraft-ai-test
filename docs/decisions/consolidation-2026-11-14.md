# Consolidation plan (owner direction 2026-11-14)

Owner, 2026-11-14: the project has sprawled; pull it back in. Accepted ~14:50Z ("lets move towards this plan").

## End state

- **Two worlds:** a test world and the showcase, each with many bots working together (about 20-24 each; the count is set by the GPUs).
- **Models served only by the RTX 5080 (10.0.0.72) and the RTX 3090 (10.0.0.16).** No Studio, no Blackwell, no 96 GB analysis box.
- **Five VMs:** test world + its bots, showcase, the two model VMs, one ops VM (telemetry, dashboard, crons). One or two test hosts on top until the suite queue is seen to stay short.
- One code line (main). A change goes: test world, 3-hour read, showcase, 3-hour read.

## Measured 2026-11-14 (Proxmox `/cluster/resources`, read-only)

Project VMs: 109 elk, 118 rehearsal, 122 mindcraft-baseline (stopped), 124 ci3, 125 ci4, 200 ollama-3090, 201 block2-worlds,
202 block2-bots, 207 showcase (pve1); 107 ci2 (pve3); 203 ollama-5080 (pve4). 160 vCPU, 408 GB RAM, 3.1 TB of disk allocated.
204 eval-mc and 205 eval-agents (pve4) look like this project's; role not confirmed. The other ~24 VMs in the cluster are
not this project's and are out of scope.

Live: 80 fleet bots on 16 worlds, 14 showcase bots. Disk used: block2-worlds 228 GB, block2-bots 75 GB (29 GB of it
autorebase worktrees), showcase 196 GB (146 releases kept), elk 184 GB, ollama-3090 634 GB. The NAS timelapse share was not
measured.

GPU capacity known so far: the 5080 passed 40 bots on the 4B model (p95 2.9 s) and failed at 60; the 3090 is far slower
(14 calls/min on the 4B).

## Steps, gates and dates

Dates are estimates. A step starts when the gate before it is passed, not on the date.

| Step | What | Gate | Estimate |
|---|---|---|---|
| C0 | Home GPUs only. Load test, then the showcase and the rehearsal served from the 5080/3090; Studio tunnel removed; every other outside endpoint found and removed | 24-h showcase read with the model answering, no `dark:model` page | load test 11-15 after 14:30Z; switch 11-16; closed 11-17 |
| C1 | One trunk: showcase line merged into main (78 conflicted files), pool differences as flags, one release path. Fleet canary launches held for the length of the merge | both lines run a build that is on main; suite green | 11-16 (after 11:00Z) to about 11-20 |
| C2 | Rehearsal-0: 12 bots, 48 h, fresh seed, no admin edits, on VM 118. **Started 11-14 14:46:09Z by another session** | rehearsal card: town progress, nothing stuck over 6 h | ends 11-16 14:46Z |
| C3 | **Owner 11-14: the test world is the LAND WORLD first (land work only, no town; see "The land world").** Test world replaces the fleet as the first stop for changes. If rehearsal-0 passed, that world carries on as the test world, grown to about 20 bots. Fleet shrinks to make GPU room | 7 days and at least 3 releases through test world then showcase; stopwatch, brainwatch and the death alarm working on the test world | 11-23 to 11-30 |
| C4 | Retire the 16-world fleet: queue entries folded into the trunk or dropped (listed for the owner), bots and worlds stopped, saves and raw logs archived to the NAS, crons on block2-bots moved to the ops VM | VMs 201/202 stopped 7 days with nothing missed; owner's yes on each delete | stop 11-30; delete about 12-07 |
| C5 | Shrink the rest: test hosts 4 to 1-2, Elasticsearch retention, VMs 122/204/205 if confirmed ours, showcase releases, autorebase worktrees, 3090 model files, local worktrees and branches; delete scheduler, autorebase, restack and promotion-merge code | final count: 5 VMs (plus test hosts) | week of 12-07 |

## What can move the dates

- The trunk merge is the largest unknown.
- A failed rehearsal costs at least three days per rerun.
- If the load test shows no room on the 5080, fleet pools retire early (C4 work pulled forward) so the showcase and rehearsal fit.

## Rules while this runs

- No new VMs, hosts or outside model endpoints.
- New work is weighed by whether it survives the two-world end state. Fleet-pool plumbing does not.
- Deleting a VM or data needs the owner's yes at that time.

## Owner decisions, 2026-11-14 ~14:57Z ("Yes, defaults")

1. **The fleet queue takes no new work, fixes only.** Entries already queued keep running until the trunk merge (C1)
   starts. A fix means: a regression a kept canary caused, a death or halt cause, or something the consolidation needs.
2. **If the load test shows no room on the 5080, fleet pools retire early**, the two whose projects the daily audit flags
   BROKEN first (isolated-a, placebo-a on 11-13). Stopping a pool is: stop its bots, keep its world save and logs.
3. **The learning loop and the Voyager pilot are paused until the fleet is retired (C4).**
   - Learning loop: `~/learnloop/PAUSED` on the canary host (written 11-14 15:01Z, code 39d6c6aa3 installed). `weekly.py tick` keeps running and keeps the heartbeat fresh
     but starts no new round; remove the file to resume. The nightly archive (`nightly.py`) is left running.
   - Voyager: stage 3b (q1, q2) ends on its own timer 11-14 18:16Z and its verdict is still to be written. No further
     stage starts.
4. **Go-ahead for the C0 load test** on Sunday 11-15 after 14:30Z. Scheduled task `consolidation-c0-capacity-read-1115`
   fires 11-15 15:30Z: it reads the real load, adds a one-hour synthetic stream for the rehearsal's 12 bots, writes the
   verdict here, and stops no pool by itself.

5. **Voyager is shelved, not part of the end state (owner 11-14 ~15:30Z):** "its an interesting project and we can
   occasionally test when new local models come out to see how close they get to frontier models, but i dont think it
   adds value to the project compared to the real cost". Harness 2's six arms are not started. Stage 3b is closed and its
   verdict written; the harness stays on main as an occasional benchmark for a new local model that fits the home cards.
   A benchmark run is a one-off the owner asks for, not a standing job, and it uses no Blackwell and no paid API by default.

6. **A time capsule of the showcase, kept as a standing test (owner 11-14 ~15:45Z):** "lets make a timecapsule now. and
   use it as a test of our new bots and platform as time goes on". Done, see the section below.
7. **Cameras are part of a world from its first moment (owner 11-14 ~15:50Z).** See "Cameras and timelapses" below.

8. **Cameras, three decisions (owner 11-14 ~17:45Z, "do what you recommend"):** rehearsal-0 is recorded by a read-only
   copy every 15 minutes (since 17:47Z); the nine showcase cameras on finished projects are off (since 17:48Z); the world
   record is kept every 15 minutes for 14 days, hourly to 90 days, daily forever. Details in the camera design.

## Showcase time capsule (made 2026-11-14)

The showcase town as saved at **15:50:17Z** with saving held and flushed. One archive, 433 MB:
`capsule-20261114T1550Z.tar.zst`, sha256 `5b33ef3b19d578da40e17e9f8004eaf35c09ce9dcb88da09304ff4b46ead333b`.

- **Permanent copy:** NAS `10.0.0.5:/volume1/homes/mike/showcase-capsules/capsule-20261114T1550Z/`, read-only, outside
  every backup rotation; checksum read back from the NAS. Working copies: the showcase VM (`/srv/showcase/capsule/`), the
  worlds host (`/srv/showcase-backup/capsules/`), VM 118 (`~/capsule-test/`). The NAS is reached from the worlds host with
  its backup key; when that host is retired (C4) the key and this path move to the ops VM.
- **Inside:** the world, the block-history database (523,533 block rows), plugins and server settings, the bots' own
  records (project, tidy, atlas, per-bot state), every release record and the ops journals, the server runtime, the live
  bot code (release 46286e9e-6dd0ded8-fdd64ead), the measuring scripts and their baseline. Passwords are left out; three
  settings files are stored with those values replaced. Restore notes: `infra/capsule/README-capsule-20261114T1550Z.md`
  (the same file is inside the archive and beside it on the NAS).
- **Proven by a restore, not assumed:** unpacked on a different host (VM 118), all 169 world files matched their
  checksums, both measuring scripts gave output identical to the baseline, and a Paper 1.21.8-60 server started on a copy
  of the restored world (`Done (15.880s)`, CoreProtect enabled) and shut down cleanly. Not proven: bots joining a restored
  copy.
- **Baseline scorecard** (within 48 blocks of home): 368 open pits (791 columns, 2,416 blocks to fill); 26,116 air
  blocks under the ground top in 32 hollows (the lawn is a deck over a gap); 2,181 of 5,790 planned tidy fills still open;
  23 of 34 town projects complete, 7 open. Scripts and full output: `infra/capsule/scorecard/`.
- **How it is used as a test:** restore to a COPY (never edit the capsule), run the new bots on it for a set time with no
  admin world edits, run the same scorecard, compare with the baseline. The same capsule can be restored again for every
  later version, so results are comparable across versions. First run: when the test world path (C3) works. The
  measuring scripts are a first cut; a better measure can always be run on the capsule to get its own baseline.
- **Disclosure:** the restore test ran on VM 118 at about 15:53-15:56Z. Rehearsal-0 had been started there at 14:46Z by
  another session, which this session had not seen. The test unpacked 1.7 GB, ran the two scripts and ran a second Paper
  server (4 GB heap, port 25599) for about 20 seconds. No port or file of the rehearsal was touched; the rehearsal's read
  should name that window.

## Cameras and timelapses (owner 11-14)

The owner's words: cameras "from the very first moment the world is created to monitor and showcase the world building";
some that "focus on whatever project or projects are going on, but once those projects are complete we can stop those
timelapses since nothing will change"; "some top down and isometric, some 4k really beautiful rendering timelapses so i
can showcase this process".

Requirements:
1. **From frame zero.** No world starts without its capture running. This is a gate on C3 (test world) and on any new
   showcase world.
2. **Project cameras that end.** A camera follows each active project and stops when the project is complete.
3. **Views:** top-down, isometric, and 4K beauty renders.

What exists today (showcase only, from the 11-07 and 11-10 work; not re-checked today): hourly top-down map frames with
bot trails, event-driven project build clips, daily before/after, a daily reel, a weekly film, two 4K cameras (town and
active project), nightly Chunky beauty renders.

Gaps:
- **Rehearsal-0 started today with no capture at all** (its server has no map or block-history plugin). Its day-0
  snapshot exists, so frame zero can still be rendered; the hours since are not being captured.
- A fresh-world camera plan was written on 11-10 and is not installed anywhere.
- Isometric views: not confirmed to exist. Project cameras stopping at completion: not confirmed.
- The render jobs run on the worlds host, which is retired at C4: they move to the ops VM.

**Design (11-14, not built): [`docs/reports/camera-design-2026-11-14.md`](../reports/camera-design-2026-11-14.md).**
Measured there: the showcase has 19 cameras incl. an isometric one (perspective, not true isometric) and two 4K ones;
on 11-13 it wrote 4.8 GB of frames, 2.1 GB of it from nine cameras whose projects are complete or retired; a
block-deduplicated copy of the world differed by 6.6 MB of 180 MB over 108 minutes.

Design direction (proposed, not built): **save the world, not just the pictures.** A small copy of the world's region
files every few minutes from minute zero costs little and lets any camera, angle or resolution be rendered later, even
ones not thought of yet. Live cameras are then a choice of what to render now.

## No more ugly worlds: cleanup and levelling are proven before a new town is born (owner 11-14)

The owner, 11-14 ~18:00Z, on whether a new world should be sited, planned, cleared and levelled before building: "My
concern is that our cleanup code and our leveling and terraforming code don't work and I figured this would be a good way
to test it. I don't want another ugly world with junk and holes everywhere."

What the record says about that code today (it supports the concern):
- Cleanup fills only small open holes (the keeper's rule: up to 9 columns, 4 deep; never under a roof). On the capsule,
  68 of the pits are too big for it and 26,116 air blocks sit under the lawn with nothing built to fill them.
- Site preparation works for two building kinds (tower, shrine). Of its two recent attempts one was abandoned and one
  given up. Homes get no levelling.
- Prevention did help: keeping the pathfinder from placing blocks in town cut stray blocks from 173 to 57 an hour.

**OWNER DECISION 11-14 ~18:15Z:** "before we do the real new showcase worlds let's build a world and just focus on
cleanup, leveling terraforming and making the land beautiful. Let's not worry about building the town. Let's get this code
right before we start building the town."

### The land world

- **What it is:** a world where the bots do land work only: clean up junk, pillars and floating blocks, fill holes, level
  and terrace plots, blend edges and shores, replant, plant. No houses, walls, shops or other town projects.
- **Which world:** rehearsal-0's world carries on as the land world when the rehearsal ends (11-16 14:46Z), on the same VM
  (118, no new VM). It is raw land with 48 hours of real bot wear on it, and it has been recorded every 15 minutes since
  11-14 17:47Z. The rehearsal's own read by its session comes first.
- **This changes plan step C3.** The "test world" is the land world first. The town-building test world and any new
  showcase world are born only after the land bar below is passed and the owner says the land looks right.

### Three courses, so a fix is tested in hours and not on a live town

| Course | Start state | The bots' job | Measured by |
|---|---|---|---|
| A. Cleanup | a restored copy of the showcase time capsule | clean the old town's mess | the capsule scorecard: pits, air under the lawn, open fills |
| B. Levelling | a copy of rehearsal-0's untouched day-0 terrain, with a set of marked plots (hill, shore, forest, flat) | prepare each plot, build nothing | per plot: level, solid underneath, no spoil left nearby, edges blended, trees handled |
| C. Living | the land world itself | live and work there for days | the mess meter, hourly: junk must not grow |

Courses A and B are restored fresh for every run, so two versions of the code can be compared on the same ground.

### The bar (proposed numbers; the owner can change them)

- A: at least 90% of the pits gone, the big ones included; at least 90% of the air under the lawn filled; no new junk.
- B: 9 of 10 plots pass the ground check with no admin help.
- C: the mess meter stays under its limit for 7 days running.
- And the owner's eye: before-and-after 4K pictures of each course, and a yes that the land looks good. Numbers gate the
  junk; only he gates "beautiful".

### Evaluation of the present cleanup code (owner 11-14: "evaluate with both Claude and Codex ... the right way or start fresh")

Done 11-14: [`docs/reports/land-eval-2026-11-14/RECOMMENDATION.md`](../reports/land-eval-2026-11-14/RECOMMENDATION.md).
Both engines, working alone, said **restructure around a new core**: replace what decides the ground that should exist,
what is junk and when a repair is done; keep the code that makes a bot dig and place safely and the two prevention
features. Build order N1 ground ledger (no bot code), N2 debts for temporary blocks that do not expire, N3 planner with
acceptance by reading the world, N4 speed of the kept worker code. Owner 11-14: "Go ahead and start".

**N1 first version built 11-15** (`scripts/host/groundledger.py`): first runs in
[`ledger-first-run.md`](../reports/land-eval-2026-11-14/ledger-first-run.md). Finding: the showcase lawn is not a deck.
Its grass top is the original surface and the dirt under it was dug out by the bots, 2,200 to 3,700 blocks a day from
11-07 to 11-13, by every bot alike; it all but stopped on 11-14. So the lawn's target is to put the dirt back.

**The repair plan, offline half (11-15): [`plan-first-run.md`](../reports/land-eval-2026-11-14/plan-first-run.md).**
`scripts/host/groundplan.py` turns the ledger's list into ordered jobs under the dirt-cap rule. For the showcase within
48 blocks of home: 20,878 cells to fill (15,248 cobblestone, 5,630 dirt), 295 to cut, 76 things to pick up, in 1,127
jobs. At today's pace of about 1,000 fills in 30 hours that is about 26 days (arithmetic, not a measurement), which is
why the worker code's speed is a step of its own. Open for the owner: in 601 columns the lawn now sits one block higher
than the original ground over the hollow; the plan fills the hollow and leaves that grass one block proud.

**Where stairs are needed (11-15): [`stair-spots.md`](../reports/land-eval-2026-11-14/stair-spots.md).** From 40,669
positioned climb and escape events on the showcase (11-13 17:00Z to 11-15 04:00Z, 14 bots): 54% happen below y 50, so
most of the climbing is in the bots' own diggings, not on the lawn. Named places: the west mine yard (15.9% of all
events; one proper stair shaft and a filled pit field), a cave under the east hill, the shared mine stair (399 of 776
uses failed; a tread sits in an open cave), the junk well (236 of 431 attempts failed; a four-step stair on its west
face), and five storage chest cells no bot can reach (the same five in all 950 audit rows). Not built.

**The showcase over the whole map (11-15): [`showcase-whole-map.md`](../reports/land-eval-2026-11-14/showcase-whole-map.md).**
The untouched world was regenerated for the whole map on ci3 (24,025 chunks, 17 minutes) and matches the older copy on
99.58% of solid cells; the rest is small differences in rock and ore patches, so a regeneration has a noise floor (2.3%
of columns in chunks no bot ever visited read as changed). 17,176 finished chunks were read. Not natural: 87% of columns
within 64 blocks of home, 29% from 65 to 128, 9% from 129 to 256, 7% from 257 to 512, 2% beyond. After the noise floor
about 13,000 columns in about 1,800 chunks beyond 128 blocks are probably the bots' work. The 12 most changed chunks are
all within 72 blocks of home. A new world does not have this noise: its frame-zero copy is exact.

**The cause (11-15): [`dirt-loop.md`](../reports/land-eval-2026-11-14/dirt-loop.md).** Dirt is what the bots gather most
(48% of gather actions on 11-12) because the escape code climbs with dirt first; a request for dirt takes the block under
the grass and leaves a roofed gap. The 11-13 rule stopped it inside the town square but moved it to a ring just outside:
on the rehearsal world the band 65 to 70 blocks from home has 174 damaged columns per 1,000 against 23 to 43 inside.
Five prevention changes are listed there.

**Owner authorizations and direction, 2026-11-15:**
- ~03:25Z, asked "Do you authorize changing the protected gather code so bots take ground only from the top?": **"Yes,
  authorize"**. Covers `bots/src/skills.mjs` gather / gatherRun / collectManually for that change (P1).
- ~03:40Z: **"lets use cobblestone before dirt"**. Covers the escape's scaffold pick and the bag's climbing reserve
  (protected `bankable.mjs`, `scaffold.mjs`, and `reflex.mjs` pickScaffold) for that change (P2).
- ~03:40Z: **"lets build good ways to navigate around areas like building stairs and leveling the land before building
  junk dirt piles"**. Direction for the land work: where bots need to get up, down or across again and again, the answer
  is a built stair or levelled ground, not a pillar each time. This becomes its own step (P6) after P1 and P2; the
  places are already in the logs (every spot where the no-placing rule had to be lifted, every repeated escape).
- ~05:20Z, **"1,2,3 yes"** to three questions put to him:
  1. `landprev-01show` (take ground from the top; cobblestone before dirt) MAY BE RELEASED TO THE SHOWCASE once its tests
     pass and both Claude and Codex clear it; the other control session is told first, it goes out as the one allowed
     change, and its three-hour read is written.
  2. Two more changes to protected code are authorized, each still to get tests and both reviews before any release:
     the dig-down rule covers the whole town square (not 16 blocks around home), and the walking pathfinder may place
     cobblestone (`scaffold.mjs`).
  3. The desktop app stays open (the scheduled jobs and background work depend on it).
- ~16:20Z, **a dirt mine (owner's idea):** "instead of the bots digging a new hole every time they need dirt, could we
  create a 'dirt mine' where there is a dirt mine entrance outside the city, and they go down the mine and grab dirt from
  one single entrance to keep the land clean and free. i'd want the mine entrance to look nice, a few blocks wide so more
  than one bot could enter and exit at a time?" This replaces the "one borrow pit" item (P3). What I told him and proposed
  (not yet agreed, nothing built): dirt is only about three blocks deep under the grass, so a gallery that simply takes it
  is the same hollow we are stopping; the mine therefore SWAPS: each dirt block taken from the gallery is put back as
  cobblestone, one layer of dirt is always left under the grass (the dirt-cap rule), and no void is left. One handsome
  entrance about three wide outside the wall, shared with the town's stone mine (whose stair fails 399 of 776 uses today),
  and the gather rule walks a bot that needs dirt there instead of "six blocks past the edge".
  **Owner, ~16:30Z: "One shared mine".** Decided: ONE town mine with one entrance about three wide outside the wall, made
  to look good (framed arch, proper stairs, lanterns); the dirt gallery near the top, worked by swapping each dirt block
  for cobblestone under the dirt cap; stone and ore further down by the same stairs. It replaces the shared mine stair
  that fails today and the "walk six blocks past the edge" remedy. Order: a design pass (both engines) after the two
  prevention pieces; a new kind of town project, so it is built on the one trunk. Not built.
- ~05:00Z, **the fill rule: "Yes, dirt cap".** Ground that is put back is cobblestone below and ONE layer of dirt
  directly under the surface block (the grass). Why the cap: grass spreads only onto dirt, so with cobblestone right
  under it a broken grass block would stay grey for good. Cobblestone is what the town has in surplus; the cap roughly
  halves the dirt a two-or-three-deep hollow needs. The planner (N3) records the fill cells as intended, so the ledger
  does not keep reporting them as changed. A column with no surface block left (an open pit) is filled the same way and
  topped with dirt, which grass then covers.

### Order of work

| Step | What | When (estimate) |
|---|---|---|
| L0 | No bot code: an inventory of the land code (about 7,200 lines: tidy, buildsite, terrace, siteprep, landplan, roughground, cleanzone, groundskeeper) saying what each part does, where it refuses and why; the scorecard grown into the mess meter; the plots for course B chosen; rehearsal-0's mess growth read from its recorded copies | now to 11-16 |
| L1 | A land-only mode (no switch for it was found in the live code on 11-14), the start gate and the recorder from the camera design | with the trunk merge, from 11-16 |
| L2 | Filling what today's rule cannot: big pits and the gap under a lawn | after L1 |
| L3 | Levelling and terracing for any plot, not two building kinds | after L2 |
| L4 | The beauty pass: edges, shores, replanting, flowers | after L3 |

Each of L2 to L4 is tried on courses A and B before it reaches the land world. The land code lives on the showcase's
code line, so this work starts on the one trunk (C1), not before it.

**Effect on the schedule:** the new town has no calendar date any more; it is born when the bar is passed. The fleet's
retirement (C4) does not wait for that: the land world is a test world and serves as the first stop for changes.

## Found 11-14, to settle in C0

- The 3090 has a second tenant that is not this project: a llama-server from `~/ethan-gpu` holding about 14.5 GB of the
  24 GB, with the card at 100% when read. **Owner 11-14: it stays ("thats a different project"). Never stop, unload or
  move it.** So this project has about 9 GB and a share of the compute on that card: room for one small model (qwen2.5 7B
  measured 5.9 GB there), not two, and not a training run beside it. Plan on the 5080 as the one real serving card and
  the 3090 as the fallback; the bot count for the two worlds is set by the 5080.
- One fleet settings file (of 81) still names the Blackwell address. Whether a running bot uses it is not checked.
- **The showcase is already on the 5080.** At ~15:00Z all 15 showcase settings files read
  `OLLAMA_BASE_URLS=http://10.0.0.72:11434|qwen2.5:7b-instruct` and none names the tunnel port; brainwatch at 14:50Z:
  94 model decisions by 14 bots in 10 min, with 30 endpoint failures by 11 bots. The showcase ops journal has it: an owner-directed
  setting at 14:43:49Z by another session, from gemma4:26b through the Studio tunnel to qwen2.5 on the 5080 as a stopgap
  (it was dark on the tunnel from 08:31Z; backup `/srv/showcase/ops/env-bak-20261114T1440Z-qwen-stopgap/`). So the C0 load test is no longer synthetic for the
  showcase: it is a read of the real load, plus a synthetic stream for the rehearsal's 12 bots. The Studio tunnel unit
  still runs and flaps (1,131 restarts); it is removed when C0 closes.
  **Settled 11-15 (C0 read):** the showcase ops journal row `owner-direct-setting` of 11-14 14:43:49Z is the move, made by
  another control session on the owner's words ("move to qwen while i sort out why the studio went down", then "Yes,
  override for now"). The bots' own logs agree: 8,228 of 8,228 model calls failed in 08:15-14:15Z (`fetch failed`), and
  every answered call from 11-15 03:30Z on names `10.0.0.72:11434`. On 11-15 16:00Z the tunnel unit was still enabled and
  restarting (5,535 restarts). Not removed in this run.
- A scheduled task (`voyager-harness2-start-1114`, 18:30Z) was set to start six new Voyager arms for 48 h on the Anthropic
  API and the Blackwell, approved 11-12. It conflicts with decision 3 above. It was cut back to closing stage 3b only;
  the owner can restore it.

## C0 capacity read 2026-11-15

**Verdict: FITS WITHOUT THE REHEARSAL.** The 5080 carries the fleet as it runs today plus the showcase's 14 bots, with
little room left. It does not also carry the rehearsal's 12 bots. The rehearsal does not need it today: its 12 bots are
served by the 3090, which is a home card, and are answered well there.

All numbers are from the bots' own `llm-*.jsonl` rows, read with `scripts/lib/telemetry.py` `stream_rows` (full walks,
rotated files included). "Calls" are model calls an endpoint answered; work orders (rows with no model call) are left
out. Latency is the client's `llm.latency_ms`.

**Where each world is served (11-15):**
- Fleet, 80 bots: 40 on the 4B (llama-server, 5080 `:18080`), 40 on qwen2.5 (Ollama, 5080 `:11434`). No fleet call in any
  window below went anywhere but 10.0.0.72.
- Showcase, 14 bots: qwen2.5 on the 5080 Ollama since 11-14 14:43:49Z. **Stopped by its tripwire 11-15 09:49:49Z** (0 bot
  units running at 15:30Z), so it put no load on the 5080 during the test.
- Rehearsal-0, 12 bots: qwen2.5 on the **3090** (`10.0.0.16:11434`), 12 of 12 bots, every answered call. (The release's
  `control.env` on VM 118 names the 5080 first; the bots' own settings files, which this account cannot read, evidently do
  not.) No outside endpoint.

**The real load, three 6-hour windows:**

| Window | Endpoint | Bots | Calls/min (peak minute) | p50 / p95 |
|---|---|---|---|---|
| 11-14 08:15-14:15Z, before the showcase moved | 5080 qwen2.5, fleet | 60 | 90.8 (116) | 2.83 / 4.71 s |
| | 5080 4B, fleet | 20 | 32.2 (49) | 1.47 / 2.80 s |
| 11-15 03:30-09:30Z, fleet + showcase on the 5080 | 5080 qwen2.5, fleet | 40 (+4 on fallback) | 61.6 (85) | 3.09 / 4.99 s |
| | 5080 qwen2.5, showcase | 14 | 15.4 (22) | 3.08 / 5.01 s |
| | 5080 4B, fleet | 40 | 54.1 (75) | 2.24 / 3.84 s |
| | 3090 qwen2.5, rehearsal | 12 | 15.7 (24) | 1.77 / 3.02 s |
| 11-15 09:30-15:30Z, showcase stopped | 5080 qwen2.5, fleet | 40 (+4) | 74.3 (99) | 3.05 / 4.94 s |
| | 5080 4B, fleet | 40 | 65.2 (90) | 2.52 / 4.30 s |
| | 3090 qwen2.5, rehearsal | 12 | 15.8 (23) | 1.67 / 2.79 s |

- Endpoint failures: 0 of 41,634 fleet model calls (03:30-09:30Z), 0 of 50,221 (09:30-15:30Z), 0 of 5,533 showcase calls,
  0 of 5,668 rehearsal calls. Positive control for the zero: the same reader finds 8,228 failed calls by 14 showcase bots
  in 11-14 08:15-14:15Z, when the Studio was dark.
- Schema-valid decisions: 99.9% or more of answered calls on every endpoint in every window.
- Bots with no valid decision in a whole clock hour: 0 of 80 fleet bots and 0 of 12 rehearsal bots over 5 whole hours in
  each window; 0 of 14 showcase bots while it ran. Positive control: the dark window flags all 14 showcase bots.
- The 5080 answered about 131 calls a minute in total in the middle window and 140 in the last. Moving 20 bots to the 4B on
  11-14 14:22Z slowed the 4B from p95 2.8 s to 3.8-4.3 s (the 24-hour read of that move, journal row `servea-40bots-1114`
  11-15 14:43Z: INCONCLUSIVE, stay at 40, do not go to 60).

**The synthetic stream (the only added load).** `batchload.mjs`, open mode, from the canary host, 600 learning-loop
evaluation items, to the 5080 Ollama qwen2.5 (the endpoint the showcase uses; the 4B read was not in the 4B's favour on
capacity, so the default stood). Install-hold `c0-capacity` 15:35:01Z to 16:11:45Z; no canary was in the slot. Journal rows
`c0-capacity-1115` `load-test-start` / `load-test-end`. Because the showcase was stopped, the rungs read as: rung 1 puts
the showcase's load back, rung 2 is the showcase plus the rehearsal.

| | Added | Fleet qwen2.5 p50 / p95 | Worst 5 min p95 | Fleet 4B p95 | Synthetic p50 / p95 |
|---|---|---|---|---|---|
| 30 min before (15:05-15:35Z) | 0 | 2.93 / 4.74 s at 72.2/min | 4.89 s | 4.23 s | - |
| Rung 1, 15:35-16:06Z | 14.4/min (420 answers, 420 valid, 0 failed) | 3.22 / 5.03 s at 68.7/min | 5.28 s | 4.22 s | 3.14 / 4.78 s |
| Rung 2, 16:06-16:11Z, **stopped** | 27.6/min (141 answers, 141 valid, 0 failed) | 3.57 / 6.41 s at 71.8/min | **6.40 s** | 4.13 s | 3.62 / 5.65 s |

- Rung 2 was stopped by the rule after its first whole 5-minute window (16:05-16:10Z: fleet p95 6.40 s over 370 calls,
  limit 6 s). 141 of its planned 840 calls were sent. No endpoint failure, no halt or model-dark page. So "fails at 28" rests
  on five minutes, not thirty; what makes it believable is that the hour before the test already sat 0.6 to 1.7 s under
  the limit.
- The 4B endpoint did not move under either rung.
- Not measured: the showcase's own latency under the stream (it was stopped); the 3090 beyond what the rehearsal asks of it.
- A slip in this run: the first monitor process was replaced four minutes into rung 1 (its launch call would have timed
  out and released the hold). The generator and the hold were never interrupted; the journal has one start and one end row.

**What it would take to put the rehearsal on the 5080 too (arithmetic, not measured).** Ollama on the 5080 held at about
84 calls a minute (fleet 69 + 14) and failed at about 100 (72 + 28). With the showcase (15) and the rehearsal (16) on it,
the fleet's qwen2.5 bots would have to come down from about 72 to about 53 calls a minute: **about 10 bots, two pools, off
the qwen2.5 side** (a qwen2.5 bot makes about 1.8 calls a minute). The two pools pre-approved for early retirement,
isolated-a and placebo-a, are both on the **4B** server. Stopping them frees the same card but a different server, and
how much that helps Ollama was not measured: it needs its own 30-minute rung afterwards.

**What this means for C0.** No pool has to be retired today: the showcase fits on the 5080 beside the whole fleet, and the
rehearsal fits on the 3090 (about 6 GB beside the other tenant). Every world is then on a home card, which is what C0 asks.
What remains for C0: the showcase's qwen2.5 setting is still recorded as a stopgap for gemma on the Studio, so the owner
has to say it is the showcase's model now; then the Studio tunnel unit is removed and the 24-hour read written. The fleet
settings file that names the Blackwell was not checked in this run.

## Open owner decisions

1. How long to keep the fleet's world saves and raw logs after C4 (suggested: 30 days on the NAS).
2. Are VMs 204 eval-mc and 205 eval-agents this project's?
