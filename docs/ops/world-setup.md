# World setup — as built

**Server:** Paper 1.21.11 build 132 · **Seed:** random (unset) · **Built:** 2026-08-05

| Setting | Value |
|---|---|
| Pregenerated radius | 2,000 blocks (overworld), 250 (nether) |
| World border | 3,900 diameter = **1,950 radius**, warning at 32 blocks |
| Overworld chunks | 63,001 (100 region files) |
| Nether chunks | ~960 (4 region files) |
| End | not pregenerated |

The border sits 50 blocks *inside* the pregenerated area. That margin means an agent
can reach the border without ever triggering live chunk generation — which is the
entire point. Pregenerating without a matching border accomplishes nothing, because a
scout will simply walk past the edge and cause the lag spike you were avoiding
(handoff doc §17).

A fixed border also makes runs reproducible — the world is a known arena rather than
an expanding one — and gives the reflex layer a clean, easily detected boundary
condition instead of a scout lost 8,000 blocks out.

## Chunk generation is ~6x faster with `worker-threads` set explicitly

Paper's `chunk-system.worker-threads: -1` (auto) allocated only **2 threads on 6 cores**.
Chunky ran at 17 chunks/sec with the VM 83% idle.

Setting `worker-threads: 4` in `config/paper-global.yml` (leaving 2 cores for the main
tick thread, IO, and the OS):

| | before | after |
|---|---|---|
| Rate | 17 cps | **~85 cps** |
| ETA for 63k chunks | 67 min | **~10 min** |
| CPU utilisation | 17% | 67% |
| TPS | 20.0 | 20.0 |

TPS never moved — Chunky throttles against the tick budget, so the extra threads went
straight into throughput. Worth re-checking this setting on any Paper box with more
than 4 cores.

Set `continue-on-restart: true` in `plugins/Chunky/config.yml` before restarting
mid-pregen, or the task will not resume.

## Measured disk cost — much lower than estimated

**63,001 chunks = 603 MB, i.e. ~9.6 KB/chunk.** Pre-flight planning assumed ~65 KB/chunk,
which overestimated by roughly 7x. Freshly generated chunks with no entity or
block-update history compress far better than worlds with play history.

Revised, based on the measurement:

| Radius | Chunks | Disk |
|---|---|---|
| 1,000 | ~15.6k | ~150 MB |
| **2,000 (current)** | **63k** | **603 MB** |
| 5,000 | ~390k | ~3.7 GB |
| 10,000 | ~1.56M | ~15 GB |

Practical consequence: expanding the world is far cheaper than assumed. Growing to
radius 5,000 would cost under 4 GB and roughly 75 minutes of Chunky time. Extend with
`chunky radius <n>` then `chunky start` — already-generated chunks are skipped — and
raise the border to match.

The 120 GB data LV is therefore heavily oversized for world data alone. That headroom
now belongs to backups, logs, and the LLM JSONL corpus.

## server.properties choices worth remembering

| Setting | Value | Reason |
|---|---|---|
| `online-mode` | `false` | Mineflayer bots have no Microsoft accounts. **Requires** whitelist. |
| `white-list` / `enforce-whitelist` | `true` | The only thing preventing anyone on the LAN joining as any username |
| `spawn-protection` | `0` | Default 16 silently blocks non-op building near spawn — would break the builder agent's first task |
| `pvp` | `false` | Mobs still fight agents; this only stops agents damaging each other. Revisit when adding a guard role. |
| `view-distance` / `simulation-distance` | `8` / `6` | Below vanilla 10; chunk churn from exploring bots is the top MSPT cost |
| `sync-chunk-writes` | `false` | Tick-time win; crash-safety tradeoff is covered by ZFS snapshots |
| `enable-rcon` | `true`, port 25575 | Automation command channel. Bound to 0.0.0.0 by Paper — **firewalled**, see below. |

## Network exposure

Paper binds RCON to whatever `server-ip` is set to; blank means all interfaces, so
RCON came up on `0.0.0.0:25575`. Setting `server-ip=127.0.0.1` would also confine the
game port and break LAN access, so this is handled with ufw instead:

```
22/tcp     ALLOW  Anywhere            # ssh
25565/tcp  ALLOW  LAN-SUPERNET      # minecraft, private LAN only
25575/tcp  DENY   Anywhere            # rcon: loopback only (ufw permits loopback by default)
```

The `25565` rule spans `LAN-SUPERNET` deliberately: the VM is on `VM-SUBNET`
but the admin workstation is on `ADMIN-SUBNET`. A `/24` rule would have locked out
the human player.

RCON password is generated (24 chars) in `/srv/minecraft/server/.rcon.env`, mode 640,
gitignored. Helper client at `/srv/minecraft/shared/rcon.py`.

## Outstanding

- **Whitelist is empty** — nobody can join, including the owner. Needs a Minecraft username.
- Automated ZFS snapshot schedule for world backups not yet configured.
