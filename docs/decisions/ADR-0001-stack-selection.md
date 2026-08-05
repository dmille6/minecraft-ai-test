# ADR-0001: Stack selection for phase 1

**Date:** 2026-08-05
**Status:** Proposed — awaiting owner sign-off
**Supersedes:** parts of `ai_minecraft_coding_agent_handoff.md` §4, §6, §23

Decisions were reached by three independent analyses (Claude, ChatGPT via `codex`,
local `qwen3.5:122b-a10b` via Ollama) working from the same verified fact brief.
Agreement and disagreement are recorded per decision.

---

## Verified facts (checked 2026-08-05)

Queried live, not recalled. Re-verify before acting on these later.

| Fact | Value | Source |
|---|---|---|
| Latest Paper | **26.2** (year-based versioning now) | `fill.papermc.io/v3` |
| Paper 26.x Java requirement | **Java 25**, status SUPPORTED | `fill.papermc.io/v3` |
| Paper 1.21.11 Java requirement | **Java 21**, status **UNSUPPORTED** (EOL 2026-06-15) | `fill.papermc.io/v3` |
| mineflayer latest | 4.37.1 → `minecraft-protocol ^1.66` | npm registry |
| node-minecraft-protocol supported ceiling | **1.21.11** (`defaultVersion: '1.21.11'`); 26.1/26.2 absent | nmp `src/version.js` |
| ViaVersion | lets **newer clients join older servers** | ViaVersion docs |

**The binding constraint:** mineflayer cannot speak the 26.x protocol. Everything
else follows from that.

### Repo health of candidate frameworks (GitHub API, same date)

| Repo | Stars | Forks | Commits/90d | Contributors | Read |
|---|---|---|---|---|---|
| `mindcraft-bots/mindcraft` | 5602 | 883 | **4** | 30 | Popular but decelerating |
| `JesseRWeigel/minecraft-agent-swarm` | 25 | 14 | **30** | **1** (408 of 409 commits) | Active but bus factor 1 |
| `bigph00t/hermescraft` | 56 | — | — | — | Stale since Mar 2026 |
| `VasilisDragon/cairn` | 1 | — | — | — | Personal project; borrow ideas only |
| `Pomilon/MC-CIV` | 7 | — | — | — | Early alpha |

All repos in the handoff doc are real — none hallucinated.

---

## D1 — Minecraft/Paper version

**Decision: pin Paper 1.21.11. Install ViaVersion so the owner's newer client can join.**

Unanimous across all three analyses.

- mineflayer tops out at 1.21.11, and bots that cannot connect make the rest moot.
- ViaVersion exists precisely to let newer clients reach older servers, so the
  owner keeps a current launcher without downgrading the server.
- Bonus: 1.21.11 needs Java 21, not Java 25 — one less moving part on the VM.

**Accepted risk (found by Claude only; neither cross-check surfaced it):** Paper
1.21.11 is **EOL as of 2026-06-15** and receives no further fixes. Acceptable
*only* because this server is LAN-private and never port-forwarded. This is a
tripwire, not a permanent state — see "Watch" below.

**Rejected:** Paper 26.2 (bots cannot connect at all).
**Also rejected:** the handoff doc's 1.21.6 — superseded, no benefit over 1.21.11.

## D2 — Agent framework

**Decision: build a thin custom harness on mineflayer + mineflayer-pathfinder.
Do not adopt minecraft-agent-swarm or mindcraft as the foundation.**

Unanimous across all three analyses. This **reverses the handoff doc §6**, which
named minecraft-agent-swarm the preferred first path.

Reasoning:
- The doc's own priority is "reliability before intelligence" (§25.1). Betting
  phase 1 on a 25-star, single-maintainer project contradicts that. Its stated
  purpose is a Twitch-streaming swarm — an entertainment goal, not a reliability one.
- mindcraft is the safer *dependency* (5602 stars, 30 contributors) but at 4
  commits/90d it is decelerating, and it carries far more behavior surface than
  phase 1 needs.
- The doc already specifies the architecture worth building (§9: reflex /
  deterministic skill / cognitive / society layers). That *is* the Cairn pattern.
  Writing it directly is a smaller job than bending someone else's framework into it.

**Accepted risk:** more plumbing to write, ~1–2 weeks longer to first agent.
Worth it because the phase-2 milestone is not "smart agent" — it is "agent
connects, obeys tools, logs state, recovers from death and disconnect."

**Both frameworks stay useful as reference implementations.** Specifically:
agent-swarm's recovery logic and Voyager skill set; mindcraft's profile and
model-routing design.

**Sequencing note:** run mindcraft once, briefly, as an *infrastructure smoke test*
(does a bot connect to our Paper build and reach Ollama?) before writing harness
code. It validates the plumbing without becoming the foundation.

## D3 — Models

**Decision: routine agent loop = `qwen3:30b-a3b` (~3B active MoE).
Supervisor = larger model, called rarely.**

Agreement on the routine model was unanimous. Supervisor choice differed:
ChatGPT said `qwen3.5:122b-a10b` or `gpt-oss:120b`; local qwen said `llama3.3:70b`.
**Unresolved — decide empirically once one agent is stable.** It is a cheap
swap (one env var) and the wrong answer costs nothing now.

- A small-active MoE gives large-model breadth at small-model latency, which is
  exactly the routine loop's need: fast, valid, structured tool calls.
- Do not put a 122B in the hot path before one agent is stable.

**Hardware correction to handoff doc §2:** the doc treats the RTX 5080 as primary
inference and the Mac as optional. An RTX 5080 has ~16 GB VRAM — it cannot hold
the 27B–122B models already pulled. Those live on the **Mac Studio M4 Max**
(unified memory). Practical split:
- **RTX 5080** — high tokens/sec on a quantized 7–14B: the routine loop.
- **Mac Studio M4 Max** — the large models: supervisor, embeddings, summarization.

This inverts the doc's "Mac is optional" framing. *(Flagged independently by the
local qwen run, which caught the VRAM arithmetic.)*

## D4 — What goes in the public GitHub repo

**Decision: the repo is a control plane and experiment record, not a database.**

Both cross-checks pushed back on "use the repo as shared state," and they are
right about live state — git commit cycles are far too slow for agent-to-agent
sync, and concurrent writers produce merge conflicts.

But the intent is still sound for the right data. Two tiers:

**In git** (durable, reviewable, versioned — genuinely shared across agents/tools):
`server/` config templates + startup scripts · `bots/` harness, skills, event
handlers · `schemas/` tool-call, memory, and event JSON schemas · `prompts/`
versioned role prompts · `docs/` architecture, runbooks, ADRs, failure modes ·
`infra/` compose/Ansible templates · `experiments/` run reports and results ·
`.env.example`

**On the VM only** (live, high-frequency, or sensitive): world saves · runtime
logs · live agent memory and task queue (SQLite or Redis) · secrets and `.env` ·
`whitelist.json` / `ops.json` / `usercache.json` (real usernames and UUIDs) ·
Paper and plugin jars.

**Because the repo is public:** never commit API keys, SSH keys, internal IPs of
the Ollama hosts, world coordinates the owner considers private, or raw chat
transcripts. Enforced by `.gitignore`.

---

## Watch

- **node-minecraft-protocol 26.x support.** When `supportedVersions` in
  `src/version.js` gains a 26.x entry, re-evaluate D1 and move off EOL Paper.
- **mindcraft commit rate.** If it stays near 4 commits/90d, treat it as reference
  material permanently rather than a fallback foundation.

## Open — needs owner input

1. Does the Ubuntu VM already exist on Proxmox, and is there SSH access from this Mac?
2. RTX 5080 host: IP, and which models are pulled *there* (as opposed to on the Mac Studio)?
3. Is Ollama already listening beyond localhost on either box?
