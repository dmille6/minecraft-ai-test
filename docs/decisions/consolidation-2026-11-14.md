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

## Open owner decisions

1. Stop adding new entries to the fleet queue from now (fixes only)?
2. Learning loop and the Voyager pilot: keep on the 3090, or pause until C4 is done?
3. If the load test shows no room: may fleet pools retire early?
4. How long to keep the fleet's world saves and raw logs after C4 (suggested: 30 days on the NAS).
5. Are VMs 204 eval-mc and 205 eval-agents this project's?
