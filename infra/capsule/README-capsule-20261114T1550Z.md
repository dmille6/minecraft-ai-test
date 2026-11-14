# Showcase time capsule, 2026-11-14

The showcase town as it stood on 2026-11-14 at 15:50:17Z, taken with saving held and flushed
(`/srv/showcase/bin/backup_stage.py`, the nightly backup stage). The owner asked for it on 11-14 so that later,
better bots and a better platform can be loaded onto this same town to see how they clean it up and add to it.

**This file set is never edited. Always restore to a COPY and work on the copy.** The same capsule can be restored
any number of times, which makes it a repeatable test: the same messy town against each new version of the bots.

## What is inside

| path | what |
|---|---|
| `showcase/world`, `showcase/world_the_end` | the world (Minecraft 1.21.8, Paper build 60). This save has no separate nether folder |
| `showcase/plugins/CoreProtect/database.db` | block history: who placed and broke what (523,533 block rows, SQLite quick_check ok) |
| `showcase/plugins`, `showcase/config`, `showcase/*.yml` | plugins (CoreProtect, SkinsRestorer, spark) and server settings |
| `showcase/state` | the bots' own records (`/var/lib/mcai`): town project records, tidy records, atlases, climbs, per-bot memory |
| `showcase/meta` | every release's RELEASE.json, the showcase ops journals, FRAME0.json, town-site.json |
| `paper.jar`, `libraries/`, `versions/` | the server runtime, so the world opens without downloading anything |
| `46286e9e-6dd0ded8-fdd64ead/` | the bot code that was live (release 46286e9e-6dd0ded8-fdd64ead), with node_modules |
| `bin/`, `tools/` | the showcase ops scripts (`tools/scripts/bootstrap-hermes.sh` is left out: it holds a password) |
| `units/` | the systemd units the server and the bots ran under |
| `redacted/` | `server.properties`, `config/paper-global.yml`, `plugins/SkinsRestorer/config.yml` with password, secret and token values replaced by REDACTED. The originals are NOT in the capsule |
| `scorecard/` | the measuring scripts and the baseline they gave on this save |
| `MANIFEST-world.sha256` | sha256 of every world file (169 files), to prove a restored copy is whole |

Not inside: the bots' raw decision and skill logs (they are in Elasticsearch and the learning-loop archive, each with
its own retention), timelapse frames (on the NAS), and secrets.

Town home is 0,70,0. Bots: showcase-Alpha to showcase-Onyx (15 names, 14 running). Model at the time: qwen2.5:7b-instruct.

## Baseline scorecard (this save, within 48 blocks of home)

- **Open pits:** 791 columns in 368 pits, 2,416 blocks to fill (234 of one column, 127 of 2-9 columns, 7 of 10-30).
- **Roofed hollows** (air within 8 under the ground top): 7,742 columns in 32 hollows, 26,116 air blocks. One hollow
  holds nearly all of it: the town lawn is a deck over a gap.
- **Tidy record:** 5,790 fill cells planned, 2,181 still open.
- **Town projects:** 34 plots. 23 complete; 7 open (civicH, civicM, country, stepwell, tidy, tower, waterwalk); forest
  standing; land in plan; treefarm retired; siteprep with no state. `structure_complete` is true on 27.
- **Ground-top kinds** over 11,025 columns: grass 6,170, cobblestone 2,762, stone 460, dirt 451, path 367.

Full output: `scorecard/pitmap-baseline.txt` and `scorecard/projects-baseline.json`. Because the whole world is here,
any better measure invented later can be run on this capsule to get its own baseline.

## How to measure a restored (or a later) copy

    CAPSULE_REGION=<copy>/showcase/world/region CAPSULE_POOL=<copy>/showcase/state/_pool-showcase python3 scorecard/pitmap.py 48
    python3 scorecard/projects.py <copy>/showcase/state/_pool-showcase

Run on the untouched capsule, these print the baseline again. Run after new bots have worked on a restored copy, the
difference is what they did.

## How to restore

1. Check the archive: `sha256sum -c capsule-20261114T1550Z.tar.zst.sha256`.
2. Unpack into an empty directory on a host with Java 21: `tar --zstd -xf capsule-20261114T1550Z.tar.zst`.
3. Check the world: `cd showcase && sha256sum --quiet -c ../MANIFEST-world.sha256`.
4. Server: make a server directory from `showcase/` (leave `state/` and `meta/` out of it), add `paper.jar`,
   `libraries/` and `versions/`, and put the three files from `redacted/` in place with new values where they say
   REDACTED. Set the port and RCON to suit the host. Start Paper with the options in `units/showcase-paper.service`.
5. Bot records: copy `showcase/state/` to the bots' state directory (STATE_DIR; it was `/var/lib/mcai`). The pool is
   `_pool-showcase` and the bots ran with MEMORY_POOL=showcase: keep that name, or point the new bots at it.
6. Bots: start the NEW bot code against that server and state. The old code in `46286e9e-6dd0ded8-fdd64ead/` is here
   only to reproduce how the town behaved on the day; its settings are in its `env/` folder.
7. Standing rule: no admin world edits (no /fill, /setblock, WorldEdit or world-file edits) on a test copy, or the test
   measures the admin and not the bots.
