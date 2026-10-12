# airpocket-02 (integrated window fix): Paper, 2026-10-12

Candidate: 776766cb (ap2w-on-0cdb1a8). Control: 0cdb1a8 (the live fleet: airpocket-01, no window handoff).
Each trial is one fresh bot on peaceful. Alive/dead come from the deathCount scoreboard and Health. Clicks come from
trace.cjs, with the window id of each click. The window and craftsync's active flag at each click come from
posprobe.cjs `click_state`.

Driver: `sandbox/craft/airpocket-ab.cjs`. This is fabd968's scene SM, plus:
- the probe hook;
- scene CR, a craft in flight at the trap: kit `craft`, `AP_BRAIN_SKILL=craft`;
- craft and smelt durations.

Readers: `scripts/host/sm-read.py` and `scripts/host/crlogs.py`.

## Scenes

| scene | build | trials | alive | notes |
|---|---|---|---|---|
| SM | 0cdb1a8 | 2 | 0 | 6 of 6 equip clicks INTO the furnace window (win=1), tool=hand, drowned at 105 s. The owner's defect, reproduced |
| SM | 776766cb | 3 | 3 | equip clicks 0 of 6 in a window (all win=0); breathing at ~34 s; dig 14100-14102 ms vs 14100 predicted |
| A / AF / F | 776766cb | 1 each | 3 | success; no equip clicks (pickaxe in the hotbar) |
| CR | 776766cb | 4 | 4 | no equip while craftsync was active (0 of 4 equip clicks, first two trials) |
| CR | 0cdb1a8 | 4 | 4 | success |

**Smelt restarts.** In SM on the candidate (3 of 3), cognition restarted smelt twice during the dig. Each time it made 9 furnace clicks before the step's guard aborted it, about 0.4 s in. The pickaxe stayed held and the dig completed. The guard can only stop a skill after it starts; a gate on starting skills while `airPocketing` is set would close this.

## Lost oak logs: a pre-existing craftsync abort-cleanup bug, not airpocket-02

In scene CR, the second craft is aborted 350-400 ms in. craftsync's cleanup then clicks -999 (its no-op resync) and **slot 10**. That click picks up the 63 logs the server had just returned on close. Nothing puts them back, so they sit on the server-side cursor. They are absent from Inventory, and the next craft fails with "0x oak_log". Nothing is dropped into the world and nothing is tossed.

| build | trials | 2nd abort (ms into the craft) | lost logs | the pickup click on slot 10 happened |
|---|---|---|---|---|
| 0cdb1a8 (fleet) | 4 | 350-366 | 3/4 | 3/4 (lost exactly when it did) |
| 776766cb | 4 | 350-397 | 2/4 | 2/4 (lost exactly when it did) |
| 82aef34 (gridfix-01) | 2 | 594, 628 | 0/2 | 2/2, followed by a close: the server returns the cursor |
| 70cb0d41 (airpocket-02 on gridfix) | 2 | 673; the other trial had no 2nd abort | 0/2 | 1/1, followed by a close |

On non-gridfix builds, 5 of 5 pickups lost the logs and 0 of 3 trials without a pickup did. The first aborts (243-910 ms, 12 of 12) never lost anything.

Caveat: every gridfix abort came at 594 ms or later, so there is no gridfix abort under 0.5 s to compare.

airpocket-02 does not cause the loss. It makes it more likely: its guard aborts crafts about 0.35-0.4 s in, when cognition restarts them during a dig. gridfix-01's close after the grid clear covers the loss in these trials.
