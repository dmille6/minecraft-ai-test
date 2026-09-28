# Access brief for a second agent (written 16 Sep 2026, 22:45 UTC) — no secrets in this file

Hand this file to the other agent. It says where things are and what it may touch. Credentials are never in the repo or in
chat: the private key stays in ~/.ssh on the mini (or a new key is authorized for the other agent; see "Access").

## Hosts (lab network 10.0.0.0/24; never 192.168.19x; never the UniFi API on 10.0.0.1)
| Host | Role | User | What is there |
|---|---|---|---|
| 10.0.0.31 (`block2-bots`) | the 80 bot processes, telemetry, canary loop | `mike` (passwordless sudo) | `/var/log/mcai/<bot>/skill-*.jsonl` (telemetry, sudo to read), `/srv/mcbots/trial-manifest.json`, `/opt/minecraft-ai` (checkout the fleet runs from), `~/digest/latest.md` (30-min fleet digest), `~/digest/page.jsonl` (canary pages), `~/canary-journal.jsonl` |
| 10.0.0.30 (worlds host) | 16 live Paper 1.21.8 worlds + 4 sandbox servers | `mike` (passwordless sudo) | `/srv/block2/<pool>/` per world; `server.properties` holds each world's `server-port` and `rcon.port`/`rcon.password` (sudo to read) |
| 10.0.0.30:25599–25602 | **sandbox, sandbox2, sandbox3, sandbox4** — the test rig | Minecraft protocol; RCON per `server.properties` | tp/setblock/give are allowed HERE and nowhere else |

The lab key on the mini is `~/.ssh/id_ed25519` (not `id_ed25519_aiservers`, which is instance #1's). Both hosts accept it for
`mike`. ELK: the fleet ships to Elasticsearch on 10.0.0.186 (indices mcai-skill-agents, mcai-llm-agents, mcai-sys-journal), whose TRIAL LICENSE EXPIRED 2026-09-04 — since 5 Sep the cluster answers 403 "license non-compliant for [security]" to most requests, filebeat drops part of each batch (7,709 error lines in its journal), Kibana (10.0.0.186:5601, lab-only) is unusable, and the mini has no SSH access to that host. Until someone with access restores a basic license (`POST /_license/start_basic?acknowledge=true` as elastic) and creates an `mcai_reader` user, the telemetry FILES on 10.0.0.31 are the complete, authoritative source; 10.0.0.81 (`research-elk`) is a different stack.

## What the other agent may and may not do (the owner's standing rules)
- **Use the sandbox servers only** (sandbox2–4 are free; sandbox is used by the operator's corpus runs). Never connect a bot to,
  or run a command against, the 16 live worlds — a live canary (one at a time, fleet-wide rules) is running there under the
  operator's loop, and an extra client or a world edit contaminates its read.
- **Never run** `~/bin/fleet-deploy`, `deploy-fleet.sh`, `mcai-canary-tree`, `systemctl restart mcbot@*`, or edit
  `/srv/mcbots/trial-manifest.json`, `/opt/minecraft-ai`, `/srv/mcbots/harness`, or `/var/log/mcai`.
- **Do not change the world to fix a bot** outside the sandbox. Do not disable `rpcbind` on any Proxmox node. Do not
  touch the apt timer. Do not use the 192.168.19x network or the UniFi API on 10.0.0.1.
- **Bot names on the sandbox start with `sandbox-`** (run-bot.sh refuses others); state and logs under `./sandbox/`.
- Reading is fine: telemetry (`sudo` + `grep -a`; kinds live in `skill.name` with a leading underscore; position in
  `bot.pos`), the digest, the manifest, the canary journal and pages. Use `scripts/lib/telemetry.py` (`Events.load`) rather
  than hand-rolled queries; `Events.rate(..., bots='auto')`; every "zero" needs a positive control.

## How to drive the sandbox (from the repo, `~/Documents/code-minecraft-ai` or a worktree)
- `sandbox/run-scenario.sh <fixture.json> <env-file> [minutes]` with `SERVER=sandbox2` (or 3/4) rebuilds a captured or
  synthetic fixture over RCON, joins a local bot, and prints a verdict; `SCRIPT="goto x y z"` scripts the bot's decisions
  through the loopback brain; `sandbox/run-corpus.sh <candidate-root> [control-root]` runs the trap corpus control vs candidate.
- Fixtures: `sandbox/fixtures/*.json` (origin, radius, cells, the bot's position and inventory).
- A plain mineflayer client for reproductions: `bare-client` pattern in memory ("reproduce with a bare client before
  touching our code").
- RCON from the worlds host: `sudo python3 -` with the small client in `scripts/lib/rcon-list.py` (authenticate type 3,
  command type 2) against `127.0.0.1:<rcon.port>` read from `/srv/block2/<server>/server.properties`.

## Visibility without touching anything
- `ssh mike@10.0.0.31 'cat ~/digest/latest.md'` — versions live, deaths, immobile, zero-item bots, every 30 min.
- `ssh mike@10.0.0.31 'tail ~/digest/page.jsonl ~/canary-journal.jsonl'` — the canary loop's state.
- `docs/reports/STATE.md` (docs branch `recovery-ladder-03`, worktree ~/Documents/mcai-rl02) — the operator's state file.
- Coordination: the operator session and the daily 11:08 UTC session own the live fleet; write anything the other agent
  needs the operator to know into `docs/reports/handoff-<agent>-<date>.md` on the docs branch, never into STATE.md.
