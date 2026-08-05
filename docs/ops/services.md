# Service inventory — as built

**Last verified:** 2026-08-05

Start here: **http://mcai.lan** — the homepage dashboard links to everything below.

## Hosts

| Host | IP | Role | Spec |
|---|---|---|---|
| `mcai` | mcai.lan | Paper server, agents, homepage | 6 vCPU / 16 GB / 124 GB |
| `mcelk` | mcelk.lan | Elasticsearch, Kibana, Hermes | 4 vCPU / 16 GB / 124 GB |
| Mac Studio M4 Max | studio.lan | Ollama (primary inference) | 128 GB unified |
| RTX 5080 box | gpu-host.lan | Ollama (embeddings, overflow) | ~16 GB VRAM |

The 5080's Ollama port is publicly routable but firewalled to `REDACTED-WAN`,
which is this network's egress address (verified: all three hosts egress from
REDACTED-WAN). Reachability tests from inside the LAN therefore prove nothing
about external exposure -- they arrive from an allowed source.

## Endpoints

| URL | What | Auth |
|---|---|---|
| http://mcai.lan | **Homepage** — start here | none |
| http://mcai.lan:8080 | **Live world map** (squaremap) — agent markers | none (LAN only) |
| http://mcelk.lan:5601 | Kibana — "Minecraft AI — Overview" | `mike` |
| http://mcelk.lan:9200 | Elasticsearch | `mike` / `elastic` |
| http://mcelk.lan:9119 | Hermes Agent dashboard | basic auth, `mike` |
| http://mcai.lan:61208 | Glances — mcai | none (LAN only) |
| http://mcelk.lan:61208 | Glances — mcelk | none (LAN only) |
| `mcai.lan:25565` | Minecraft (Java 1.21.11) | whitelist |

## systemd units

**mcai**

| Unit | Purpose |
|---|---|
| `minecraft` | Paper 1.21.11, 6 G fixed heap, Paper's recommended G1GC flags |
| `mcbot@scout` | Agent harness. **Templated** — add agents with `systemctl enable mcbot@builder` after dropping `env/builder.env` |
| `filebeat` | Ships Paper logs + agent JSONL to mcelk |
| `glances` | Resource monitor, web + REST API on 61208 |
| `docker` | Runs the homepage container |

**mcelk**

| Unit | Purpose |
|---|---|
| `docker` | Elasticsearch + Kibana via docker-elk |
| `hermes-dashboard` | Hermes web UI on 9119 |
| `glances` | Resource monitor on 61208 |

## Accounts and isolation

Deliberately separated per handoff doc §18 — the agent runtime is untrusted automation.

| Account | Host | Privileges |
|---|---|---|
| `minecraft` | mcai | nologin, owns `/srv/minecraft/server` |
| `mcbot` | mcai | nologin, owns `/srv/minecraft/bots` — cannot write to the server dir |
| `hermes` | mcelk | **no sudo, no SSH keys, not in the docker group** |
| `mcai_ship` | Elasticsearch | write-only to `mcai-*` |
| `hermes_ro` | Elasticsearch | **read-only** to `mcai-*` (verified: writes return `security_exception`) |

Hermes executes code, so it runs as an unprivileged user with no path to root.
It reads Minecraft and agent state **through Elasticsearch**, not by touching
the game server — no RCON access, no SSH. Least privilege, and it works because
Paper logs and agent telemetry are already in the index.

## Firewall (ufw, both hosts)

| Port | Allowed from | Service |
|---|---|---|
| 22 | anywhere | ssh (key only) |
| 80 | LAN-SUPERNET | homepage |
| 25565 | LAN-SUPERNET | Minecraft |
| 25575 | **denied** | RCON — loopback only |
| 8080 | LAN-SUPERNET | squaremap live map |
| 5601, 9200, 9119, 61208 | LAN-SUPERNET | Kibana, ES, Hermes, Glances |

The `/16` span is deliberate: VMs sit on `VM-SUBNET` but the admin
workstation is on `ADMIN-SUBNET`. A `/24` rule locks the human out.

## Gotchas worth remembering

- **Ubuntu's `glances` package omits the web UI static assets** — `glances -w`
  crashes with `Directory '.../static/public' does not exist`. Install via
  `pipx install 'glances[web]'` instead (we use `PIPX_BIN_DIR=/usr/local/bin`
  so systemd can find it).
- **Homepage needs `HOMEPAGE_ALLOWED_HOSTS`** or it serves a blank page with no
  useful error.
- **Hermes' dashboard refuses a non-loopback bind without an auth provider**
  (June 2026 hardening). Set `HERMES_DASHBOARD_BASIC_AUTH_USERNAME` /
  `_PASSWORD`; `--insecure` is a no-op now.
- **squaremap pins to the Minecraft version**: jars are named
  `squaremap-paper-mc<version>-<plugin version>.jar`, and releases past 1.3.12
  build only for mc26.2. 1.3.12 is therefore the newest correct build for our
  pinned 1.21.11, and its "4 versions out of date" warning is expected.
- **The hermes binary is at `~/.local/bin/hermes`**, not `~/.hermes/bin/hermes`.
- **Hermes' installer inherits the caller's cwd**, so `sudo -u hermes` from
  another user's home makes `uv` fail on that home's `.venv`. `cd` first.

## Restarting things

```bash
# agent
sudo systemctl restart mcbot@scout
sudo journalctl -u mcbot@scout -f

# minecraft
sudo systemctl restart minecraft

# elk (on mcelk)
cd /opt/docker-elk && sudo docker compose restart

# homepage (on mcai)
cd /srv/homepage && sudo docker compose restart
```
