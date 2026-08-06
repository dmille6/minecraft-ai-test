# Handoff — the 192.168.192.x side

Written 2026-08-06 by the measurement agent, on being stood down.

The other agent cannot reach any host named here. These two networks were
established as mutually unreachable, and the repo was the only channel between
the two instances. So this document is not a request for review — it is a record
of what is running, what is true, and what is unfinished, for whoever operates
this side next.

---

## What is running

| host | what | state |
|---|---|---|
| `192.168.192.199` (mcai) | Paper 1.21.11, 3 bots (Scout01, Miner01, Gather01), filebeat | all active, harness `b4e92c2` |
| `192.168.192.194` (mcelk) | Elasticsearch + Kibana (docker-elk), `mcai-selfcheck.timer` (30m), `mcai-verify.timer` (1h) | all active |
| `192.168.192.15` (Studio) | Ollama, `qwen2.5:14b-instruct` Q4_K_M | serves the bots and the analysis loop |

These keep running until someone stops them. Nothing here is self-terminating.

To stop this side cleanly:

```bash
sudo systemctl disable --now mcbot@scout mcbot@miner mcbot@gatherer minecraft filebeat
```

```bash
sudo systemctl disable --now mcai-selfcheck.timer mcai-verify.timer
```

Back up first — `scripts/backup-world.sh` archives the world **and**
`bots/state/`, which holds the only artifact that cannot be regenerated:
`lessons-*.json`. Worlds, indices and dashboards can all be rebuilt. Deleted
experience is simply gone, and it presents as "learning does not work" rather
than as data loss.

---

## What is true right now

Fleet success **70%**, `_entombed` ~2 per 5 minutes, LLM p50 **3528ms** /
p95 **5695ms**, schema validity 100%. All three bots on the same build, which
`check-drift.sh` now verifies rather than assumes.

The agents do learn and it survives restarts. Per-bot `avoid`/`worked` rules are
built from counted outcomes, not generated text. Hazard sites are shared
fleet-wide — a drowning site one bot found 30 times is avoided by bots that have
never been there. Terrain is common knowledge; policy stays private.

**The limiter is the skill layer and the terrain, not the model.** Role contrast
on an identical world, model and codebase: gatherer 50%, scout 8%, miner 0%.

---

## Corrections to earlier claims in this repo

Two numbers I published were artefacts, and anyone re-reading the analysis
should know which:

1. **"17% fleet success"** was measured inside a failure storm caused by code
   that was committed but never deployed. The fleet's real figure with current
   code is ~70%.

2. **"`_entombed` 272 → 0 proves the ceiling fix worked"** is wrong. It went to
   zero because the line that emits it was the line that was throwing. The
   honest post-fix figure is 2 per 5 minutes with the layer verified working.

**Contaminated window: 01:42–03:11Z on 2026-08-06.** Entombment and stuck data
is *absent* there, not low. Exclude it rather than reading it as improvement.

---

## Unfinished, in the order I would do it

1. **`biomeAt()` in `bots/src/state.mjs` returns empty.** Visible as
   `"biome": ""` in every skill document. It blocks per-biome terrain analysis,
   which is the analysis that would most directly attack the 0% miner success
   rate. My bug, and the one I most regret leaving.

2. **`LLM_TIMEOUT_MS=90000` but observed latencies of exactly 180002ms.** Two
   timeouts are stacking somewhere — probably a retry wrapping the client
   timeout. Nobody has chased it. It matters because it doubles the worst case
   the watchdog has to tolerate.

3. **Prefetch / overlap inference with skill execution.** Designed, never built,
   deliberately not started without sign-off because it changes the cognitive
   loop. Bots block on the LLM but spend most wall-clock *executing*. Computing
   the next decision during the current skill takes ~5s off the critical path
   without needing any more inference throughput. It is only safe as a
   *speculative* proposal: it must not reserve world state, mutate memory, or
   count as a lesson until re-admitted at execution time.

4. **Standing gaps:** no test suite (the lint gate closes one class, not the
   rest); no logrotate on bot logs; no alerting; no griefing controls, which
   matters now that an LLM can choose `place` and `mine`.

---

## The two bug shapes worth carrying forward

Every real defect this session was one of two shapes, and naming them found
more than looking for bugs did.

**Capability without its inverse.** Five instances now. A veto with no
fallback (livelock). A pause with no auto-resume (16 minutes frozen). A dig-down
with no climb-out (entombment). A recovery with no check that it still applied
(the watchdog resurrecting bots on a host it no longer owned). And the sharpest:
**error capture with no error escalation** — a `catch` that logged and continued
turned a dead safety layer into a log line, while every health signal stayed
green. Anything repeating at the tick rate is an outage, not a log line.

**State captured at one moment, used after the world moved.** Stuck detection
accumulating while idle. A prompt built before a reflex preempted. An escape
that reported success while going nowhere because nothing verified the
postcondition.

---

## On the two-agent experiment, honestly

It produced real wins that neither side would have found alone — the shared
world-facts model, the suffocation latch, the duplicate-bot discovery, and the
role-contrast finding all came out of one side checking the other's claims.

It also produced its own failure mode, and I caused the worst instance: I pushed
`3073a9f` to shared `main` with four undeclared identifiers, which put a latent
reflex-layer outage into the other instance's path. Shared code across
instances that cannot see each other's runtime multiplies blast radius. If this
is ever repeated, the lesson is not "don't" — it is that **shared code needs a
gate that runs before the push, not after the deploy.** `bots/eslint.config.mjs`
is that gate, and it exists because it was missing.
