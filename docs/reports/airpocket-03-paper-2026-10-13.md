# airpocket-03: Paper regression, 2026-10-13

**VERDICT: PASS (regression).** This is a regression check of the airpocket-03 rescue in the ice trap. `mine` was
attempted in every FM trial but was **never in flight when the rescue fired**.

**THE CONTESTED DIG ITSELF WAS NOT REPRODUCED ON PAPER.** `mine`'s own water guards stop it within ~0.15 s of any wet dig,
so it is never still digging ~11 s into a drowning. The live case (hive-d-Delta, 10-13 11:00Z) needs a freeze or a flow
to arrive mid-dig, and the sandbox cannot time that. The contest is covered instead by:

- the unit tests: AP3-V1..V6 and `bots/test/mine-abort.test.mjs`, with anchored mutants;
- both reviewers' repros against mineflayer 4.37.1's real `digging.js` (docs/reports/airpocket-03.review-2026-10-13.txt);
- the canary read: airpocket2read's CONTESTED line reports contested attempts and their next-attempt latency, even at 0.
  **The fleet canary is the first real observation.**

## Setup

- **Builds:** candidate `9f29a031` (ap3-on-82aef34), control `70cb0d41` (airpocket-02 as it ran live).
- **Trials:** each is one fresh bot on peaceful. Paper runs on sandbox and sandbox2. The lock was held 18:59-19:28Z.
- **Scene FM:** F's ice trap with kit `mine`: cobblestone in hotbar 0, the only stone_pickaxe in container.9. The brain answers `mine {"y":20}`. `AP_HOME=730,40,700` moves home off the trap.
- **Reads:** "alive" comes from the deathCount scoreboard and Health. Clicks and digs come from the wire.
- **Driver:** `sandbox/craft/airpocket-ab.cjs`, which adds scenes FM, FMD and FMR, kit `mine`, and AP_HOME.
- **Reader:** `sandbox/craft/fmread.py`.

## Results

| scene | build | trials | alive | `_air_pocket` outcome | contested= | window= | notes |
|---|---|---|---|---|---|---|---|
| FM | cand 9f29a031 | 3 (+1 pilot) | 3/3 (4/4) | success 3/3 (4/4), ice, dig 4701-4702 ms vs 4700 predicted | absent | absent | pre-empt @11.2-11.4 s, start @11.7-11.9 s, breathing ~17 s, success row @19.5-19.7 s |
| FM | ctrl 70cb0d41 | 2 | 2/2 | success 2/2, dig 4701 ms | absent | absent | pre-empt @11.25 s, success @19.5-19.6 s |
| F | cand 9f29a031 | 1 | 1/1 | success, dig 4701 ms | absent | absent | no pre-empt; start @11.86 s |
| AF | cand 9f29a031 | 1 | 1/1 | success (stone), dig 14102 ms | absent | absent | pre-empt @11.17 s |

Denominators, over 7 trials (8 counting the pilot):

- Digs during a step that were not the rescue's own: 0 of 14 dig packets.
- Second attempts: 0. Every first step succeeded, so the 5-s cooldown was not exercised.
- `mine` in flight at a step start: 0 of 6 FM steps.
  - mine's first run ended at 1.6-1.75 s, refused 121-166 ms after it started.
  - The brain answered `mine` again at 10.2 s and 18.6 s; neither answer started a run.

## Why `mine` is never in flight (pilots)

1. **Home.** With home at the stand, mine refused at once: "will not dig down within 1 blocks of home". AP_HOME moves it.
2. **The flooded trap.** mine refuses every step at its stair liquid check (`skills.mjs`, "water beside the ceiling cell
   ahead"). The step's ceiling cell always touches the bot's own water head cell, and any wider water trips the
   three-cell check.
3. **FMD** (a dry 1x1x2 pocket, flooded on the first dig): the entombed escape broke the ice and pillared out within 4 s.
4. **FMR** (a dry 3x3x2 room, flooded on mine's first pickaxe dig): mine's dry stone step (0.6 s) ended before the flood
   landed.

Neither FMD nor FMR produced mine in flight.

## Housekeeping

- Both sandboxes are peaceful with randomTickSpeed 3, and nobody is online.
- The `wcc` objective on sandbox is not ours.
- Raw results are in the airpocket agent's scratchpad (`fm/results-sandbox{,2}.jsonl`, `fm/pilot/`).
