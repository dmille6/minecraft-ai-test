# Continuous analysis

Runs on the ELK host, unattended, on a timer. No laptop or phone involved.

```
detect  →  diagnose  →  predict  →  verify
```

**detect** — deterministic counting rules over telemetry. No model. Four rules:
recovery-ineffective, event-storm, success-collapse, agent-silent.

**diagnose** — only when a rule trips. Assembles a fact pack and asks one or
more models. Cheap because it is triggered, not scheduled.

**predict** — every proposal must state a falsifiable claim:
`PREDICT: events_per_hour:_entombed < 50 within 6h`. Recorded in
`reports/predictions.jsonl`.

**verify** — hourly, scores predictions whose deadline has passed and writes the
verdict back. **A source whose predictions keep failing is telling you something
about the source**, not just about the agent.

## Why detection is deterministic

The two worst bugs here were a recovery that reported success while the bot
stayed trapped, and a recovery that fired 560 times in an hour without ever
working. Both are trivial counting rules. An LLM asked "is this healthy?" will
usually say something plausible; a counting rule will not.

Run against the window Scout was trapped in, the rules found in seconds what
took an hour by eye — including two broken recoveries nobody had noticed:

```
[high] recovery_ineffective: _entombed fired 565x, bot moved after 3x (1%)
[high] recovery_ineffective: _trapped_in_canopy fired 27x, moved 0x (0%)
[high] event_storm:          _entombed is 76% of all events (282/hour)
[medium] success_collapse:   15/87 succeeded (17%)
```

## Install

```bash
sudo mkdir -p /opt/mcai-analysis/{bin,reports}
sudo cp scripts/{selfcheck,reflect,progress_report}.py /opt/mcai-analysis/bin/
sudo chmod +x /opt/mcai-analysis/bin/*.py

sudo tee /etc/mcai-analysis.env >/dev/null <<'ENV'
MCAI_ES_URL=http://localhost:9200
MCAI_ES_USER=elastic
MCAI_ES_PASS=<from docker-elk/.env>
OLLAMA_BASE_URL=http://<your-ollama>:11434
MCAI_SIDE=<measure|infra>
ENV
sudo chmod 600 /etc/mcai-analysis.env
```

Then two timers: `mcai-selfcheck.timer` (every 30 min) and `mcai-verify.timer`
(hourly). Unit files are in this repo's history under commit
`docs: continuous analysis`.

**Set `MCAI_SIDE`** so reports are attributable once both deployments commit
them — our two stacks cannot see each other's Elasticsearch, so the filenames
are the only provenance.

## Backends

| backend | auth | cost | notes |
|---|---|---|---|
| `ollama` | none | free | default; runs unattended today |
| `codex` | OpenAI login | metered | `--backends ollama,codex` |
| `claude` | Anthropic login | metered | `--backends ollama,claude` |

Detection is free and constant. Only diagnosis calls a model, and only when a
rule trips — so adding a paid backend costs per *incident*, not per interval.

Credentials are per-user and interactive; whoever owns the host has to log in
once. Neither agent can do that step.

## What this does not do

It does not apply changes. Every proposal is reviewed by a human, and the
prediction ledger is what makes that review cheap — you can see whether a
source's previous advice actually worked before taking its next suggestion.
