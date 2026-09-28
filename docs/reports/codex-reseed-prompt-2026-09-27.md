# Destroy this before it destroys sixteen worlds. You are the second engine.

READ-ONLY. You are ChatGPT via `codex exec`. A Claude pass runs separately.

Read, in this order:
1. `CLAUDE.md` — the working rules. The owner's standing constraints are at the bottom.
2. `docs/reports/plant-growth-registration-2026-09-27.md` — what was measured today and the gate that
   governs the read still to come at 18:22Z.
3. `docs/reports/planting-and-reseed-memo-2026-09-27.md` — the owner's directive and the plan. §4 is the
   reseed. NOTE: your own earlier pass on this memo already refuted the env-var arm split and demanded a
   registered 12-hour growth cohort before reseeding; both were accepted.
4. `scripts/host/reseed-world.sh` and `scripts/host/reseed-bots.sh` — THE CODE UNDER REVIEW.
5. `scripts/host/place-town.py` (the derived world map near the top) and
   `scripts/host/test_world_map.py`.

## THE SITUATION

`268c074` (the planting obligation) is fleet-wide on 80 bots and READ: 986 saplings placed in 5.5h from a
history of zero; 302 of 847 readable recorded coordinates (35.7%) now hold a log against an ambient
log/leaves rate of 2.07% at the same cells displaced ±7 blocks, and ambient sapling 0.00%. All 16 worlds
show growth. Recorded KEEP.

The owner has directed that all 16 worlds be reseeded. **Nothing has been reseeded yet.** These two
scripts are what would do it. They have been dry-run and every refusal has been seen to fire, but they
have NEVER been run with `--go` on anything.

Facts you need and should verify rather than trust:
- Worlds live on 10.0.0.30 (`/srv/block2/<pool>`, `block2@<pool>.service`). Bots and their state live on
  10.0.0.31 (`/srv/mcbots/harness/env/<bot>.env`, `/var/lib/mcai/<bot>/`, `mcbot@<bot>.service`).
- **There is no inter-host ssh in either direction** (verified both ways today). Hence two scripts and a
  handoff file carried by hand.
- The only prior art is the 19 Sep reseed of `placebo-a`/`placebo-b`; its archives are still on disk with
  the names these scripts reproduce (`world.pre-reseed-<ts>`, `/var/lib/mcai/<bot>.pre-reseed-<ts>`,
  `/var/lib/mcai/_pool-<pool>.pre-reseed-<ts>`).
- `place-town.py`'s world map held EIGHT worlds against a sixteen-world fleet and derived each RCON port
  from the index. It is now derived from the filesystem. Six scripts import it, including
  `fleet-doctor.py`, which computed `total = len(ARMS) * len(NAMES)` — so it has been checking 40 bots.

## WHAT I WANT ATTACKED, ranked by what a wrong answer costs

1. **What does `reseed-world.sh --go` do that cannot be undone?** Walk it line by line. It `mv`s the world
   and rewrites `level-seed`. Name every step after which a failure leaves the pool in a state that the
   archives on disk cannot restore, and say what is missing to make each recoverable. Be specific about
   the window between `systemctl stop` and RCON coming back up.
2. **Order of operations: pregen at 0,0 and then site the town.** `pregen-world.py --x 0 --z 0
   --radius 512`, then `place-town.py --force`, which spirals `rings × step = 5 × 96 = 480` blocks from
   0,0. Is 480 actually inside 512 for every candidate the search can reach, given the platform footprint
   and the ±32 sampling rings? Could `place-town.py` choose a site whose surroundings are ungenerated, and
   what would that cost? Would the reverse order be better, and what breaks if so?
3. **`--force` on `place-town.py`.** Its help says "re-site a world that already has a town (only after
   wiping it)". `reseed-world.sh` moves `TOWN-PLACED.json` aside first. Read the code: is `--force` doing
   what this caller needs, or does it also reuse state from the old world (border, gamerules, a cached
   siting) that would be wrong for a new seed?
4. **The env rewrite in `reseed-bots.sh`.** It rewrites only `HOME_X/Y/Z` and `BOARD_X/Y/Z`, asserting each
   anchor appears exactly once. Search the harness for every other env value that is world-specific and
   would now be stale — a spawn, a border centre, a death-site cache, anything derived from the town. Name
   the file and line. This is the question I am least confident about.
5. **Inventory.** The 986 plantings come from a stock of 10,125 saplings that lives in
   `world/playerdata`, which the archive destroys. `PLANT_RESERVE = 8` is per species. So after a reseed
   the planting obligation is inert until bots re-accumulate >8 saplings of one species. Estimate how long
   from the code and any measurement you can find, and say whether carrying `playerdata` across would be
   sound or whether it violates the owner's "do not change the world to fix a bot".
6. **Is the staged design right?** Your earlier pass preferred "reset 12 worlds and retain four worn
   sentinels for 24–48 hours, balanced across planting assignments and inference hosts". There is now no
   planting split. Given that all 16 worlds show growth, is a worn sentinel still worth a quarter of the
   fleet, and which four pools would you hold and why? Note the inference split: `*-b`/`*-d` on one
   primary, `*-a`/`*-c` on the other.
7. **The derived world map.** Attack `_discover_worlds()` and `test_world_map.py`. Can it admit a world it
   should not, or miss one it should find, on the real `/srv/block2` (which contains `sandbox`..`sandbox4`
   with RCON ports and no town, and `template` with no `server.properties`)? Is the non-root fallback to
   the stale eight-world map the right degradation, or should it refuse outright?
8. **What must NOT be done today.**

## Rules for your answer
- Every negative claim carries a positive control. `file:line` for everything.
- Distinguish measured / source-verified / inferred.
- Rank by what a wrong decision costs, not by effort.
- End with ONE sentence: the single change to these scripts that most reduces the chance of losing a world.
