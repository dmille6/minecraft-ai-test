# infra/dashboard — the MCAI dashboard

**Open it: http://10.0.0.186/** (LAN only; no login needed to view). `:3000` reaches the same nginx front.
Built on open source: **Grafana** (dashboards + alert rules), **Prometheus** (time series),
**node_exporter** (host metrics), the **Infinity** Grafana plugin (JSON tables), **nginx** (one origin).

| Dashboard | What it answers |
|---|---|
| Overview (home) | bots up, fleet build, what is in test, alarms, deaths, worlds, bags, servers, latest videos |
| Bots & Bags | every bot's health, food, bag slots, what it carries and is doing; towns; top failures |
| Servers & Worlds | CPU / memory / disk / network per host; TPS, MSPT, bots online, memory per Paper world |
| Testing & Releases | the canary in test, test history with results, the queue in order, showcase releases and pieces |
| Towns & Projects | open and stuck town projects with why, building activity, the daily goal scoreboard |
| World Videos | the showcase timelapses: daily, weekly, monthly and full-history renders |
| Status Report | the owner's plain-language report (12 AM / 6 AM / 12 PM / 6 PM Central) and the previous four; its headline also tops the Overview |

Canary decisions are drawn as purple markers on every time series.

## How it fits together

```
 10.0.0.31 fleet ─┐  mcai-dash-agent :9188 (bots, bags, journal, queue, ALARMS.log, goals)
 10.0.0.30 worlds ┼─ mcai-dash-agent :9188 (RCON tps/mspt/list per world) ──┐
 10.0.0.40 show ──┘  mcai-dash-agent :9188 (+ videos: index, thumbs, files) │  pulled over HTTP
 all five hosts      node_exporter   :9100                                  │
                                                                            ▼
 10.0.0.186   nginx :80 ─┬─ /         → Grafana :3000 ── Prometheus :9090 (scrapes every 30 s, keeps 180 d)
                         │                          ├── Elasticsearch (docker-elk network, read-only key)
                         │                          └── Infinity → the agents' JSON
                         ├─ /videos/  → gallery.html, proxied to the showcase agent
                         ├─ /status/  → the fleet agent's ~/digest/statusreport (scripts/host/statusreport.py)
                         └─ /agent/showcase/{releases,trip}.json → the showcase agent (read by statusreport on .31)
```

* **The agent is read-only.** It reads files the fleet already writes and serves them; it writes
  nothing but its own thumbnail cache (`~/.cache/mcai-dash-thumbs` on .40). RCON is used only for
  `tps`, `mspt` and `list`. `curl http://<host>:9188/health` names each collector and its last error.
* **No host trusts another's keys.** Everything is pulled over HTTP; on .40 (ufw active) ports 9100/9188
  are opened to 10.0.0.186 only.
* **Elasticsearch** is reached container-to-container on `docker-elk_elk`: the host's `DOCKER-USER`
  chain accepts :9200 only from listed LAN subnets, which is why the stack joins that network instead.
* **Secrets** live only in `/opt/mcai-dash/secrets` on .186 (mode 400, uid 472): `admin.pw` (Grafana
  admin, generated once) and `es.key` (the analysis read-only key, copied from .31). Never in git.

## Alerts

Dashboard-only (owner, 11-04): 13 Grafana rules in folder *Minecraft AI*, shown on the Overview's
*Firing alerts* panel; nothing is pushed. The fleet's own watchers (goalwatch, flowledger, haltwatch,
stallcheck, effectwatch …) appear beside them as *Active alarms*, read from each host's `ALARMS.log`.
To add phone/Discord/email delivery later: Grafana → Alerting → Contact points, then point the default
notification policy at it.

## Changing it

* **Panels and alert rules are code:** edit `build_dashboards.py`, then `./deploy.sh stack`.
  Grafana provisions them read-only; edits in the UI are refused by design.
* **The agent:** edit `agent/mcai-dash-agent.py`, then `./deploy.sh agents` (≈20 s for all hosts).
* **Everything:** `./deploy.sh` (idempotent).

## Measured while building it (11-04)

* Bag slots are *estimated* from item counts (rows carry counts, not slots). Positive control:
  identical to `bagcensus.py` on the same moment — min 21, median 29, 4 of 80 at ≥ 34, 2 full.
* A bot whose newest row is less than a second old has age 0; `age or 1e9` once read 8 of 80 live
  bots as silent and fired a false alert. `age()` in the agent is the fix — keep it.
* In a hidden/background browser tab Grafana panels wait ~10 s to paint (no animation frames).
  A visible tab renders at once.

## The status report (11-06)

`scripts/host/statusreport.py` (cron on .31, installed by `scripts/host/install-statusreport.sh`) writes the owner's
plain-language report to `~/digest/statusreport/` four times a day; the fleet agent serves that directory read-only at
`/status/` (latest.html, the archive, index.json, headline.html for the Overview strip). The report reads the worlds
agent's `backups.json` (newest result of each backup check in `/var/log/mcai-monitor/backup-alarm.log`) and the showcase
agent's `releases.json` + `trip.json` through this host's nginx (`/agent/showcase/...`), because .31 cannot reach
10.0.0.40:9188 directly.
