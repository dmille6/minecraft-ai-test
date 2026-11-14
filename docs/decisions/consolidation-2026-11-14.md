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
| C2 | Rehearsal-0: 12 bots, 48 h, fresh seed, no admin edits, on VM 118 | rehearsal card: town progress, nothing stuck over 6 h | about 11-17 to 11-19 |
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
3. Voyager harness 2 (six arms, approved 11-12): stays paused under decision 3 unless the owner says to run it.
