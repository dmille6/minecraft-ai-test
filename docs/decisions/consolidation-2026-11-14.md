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
| C3 | Test world replaces the fleet as the first stop for changes. If rehearsal-0 passed, that world carries on as the test world, grown to about 20 bots. Fleet shrinks to make GPU room | 7 days and at least 3 releases through test world then showcase; stopwatch, brainwatch and the death alarm working on the test world | 11-23 to 11-30 |
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

## Found 11-14, to settle in C0

- The 3090 has a second tenant that is not this project: a llama-server from `~/ethan-gpu` holding about 14.5 GB of the
  24 GB, with the card at 100% when read. **Owner 11-14: it stays ("thats a different project"). Never stop, unload or
  move it.** So this project has about 9 GB and a share of the compute on that card: room for one small model (qwen2.5 7B
  measured 5.9 GB there), not two, and not a training run beside it. Plan on the 5080 as the one real serving card and
  the 3090 as the fallback; the bot count for the two worlds is set by the 5080.
- One fleet settings file (of 81) still names the Blackwell address. Whether a running bot uses it is not checked.
- **The showcase is already on the 5080.** At ~15:00Z all 15 showcase settings files read
  `OLLAMA_BASE_URLS=http://10.0.0.72:11434|qwen2.5:7b-instruct` and none names the tunnel port; brainwatch at 14:50Z:
  94 model decisions by 14 bots in 10 min, with 30 endpoint failures by 11 bots. Who switched it and when is not
  established here (it was dark on the Studio tunnel from 08:31Z). So the C0 load test is no longer synthetic for the
  showcase: it is a read of the real load, plus a synthetic stream for the rehearsal's 12 bots. The Studio tunnel unit
  still runs and flaps (1,131 restarts); it is removed when C0 closes.
- A scheduled task (`voyager-harness2-start-1114`, 18:30Z) was set to start six new Voyager arms for 48 h on the Anthropic
  API and the Blackwell, approved 11-12. It conflicts with decision 3 above. It was cut back to closing stage 3b only;
  the owner can restore it.

## Open owner decisions

1. How long to keep the fleet's world saves and raw logs after C4 (suggested: 30 days on the NAS).
2. Are VMs 204 eval-mc and 205 eval-agents this project's?
