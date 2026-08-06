# Self-check — 2026-08-06 00:19 UTC (measure side)

> Anomalies were detected by counting rules, not by a model. The diagnoses
> below are PROPOSALS. Each carries a falsifiable prediction, recorded in
> `reports/predictions.jsonl` and scored later by `selfcheck.py --verify`.

## Anomalies

- **recovery_ineffective** (high) — _entombed fired 565x and the bot moved afterwards only 3x (1%)  
  A recovery that does not change the state it exists to fix is worse than none: it burns cycles, floods telemetry, and hides the real problem behind apparent activity.
- **recovery_ineffective** (high) — _livelock_escape fired 12x and the bot moved afterwards only 2x (17%)  
  A recovery that does not change the state it exists to fix is worse than none: it burns cycles, floods telemetry, and hides the real problem behind apparent activity.
- **recovery_ineffective** (high) — _trapped_in_canopy fired 27x and the bot moved afterwards only 0x (0%)  
  A recovery that does not change the state it exists to fix is worse than none: it burns cycles, floods telemetry, and hides the real problem behind apparent activity.
- **recovery_ineffective** (high) — _stagnation fired 12x and the bot moved afterwards only 1x (8%)  
  A recovery that does not change the state it exists to fix is worse than none: it burns cycles, floods telemetry, and hides the real problem behind apparent activity.
- **event_storm** (high) — _entombed is 76% of all events (282/hour)  
  A single hazard dominating the record means the agent is pinned in one failure mode, and every rate computed from this window is distorted by it.
- **success_collapse** (medium) — only 15/87 skill attempts succeeded (17%)  
  Sustained low success means the agent is trying and failing rather than idle -- usually the skill layer or the terrain, not the model.

## Diagnoses

### ollama/qwen2.5:32b

1. ROOT CAUSE — The most likely cause of the anomalies is an incomplete recovery mechanism for `_entombed` and other similar states (e.g., `_livelock_escape`, `_trapped_in_canopy`). This suggests that while these recoveries are triggered, they do not effectively resolve the underlying issue, leading to repeated failures. Evidence includes high firing rates with very low movement post-recovery (`_entombed`: 565 fired, moved only 3 times; `_livelock_escape`: 12 fired, moved only 2 times).

2. FIX — The recovery mechanisms for `_entombed`, `_livelock_escape`, and `_trapped_in_canopy` need to be reviewed and potentially rewritten to ensure they effectively resolve the trapped state before marking themselves as successful or retrying with a different strategy if the initial attempt fails. This should involve checking `recovery_mechanisms.py` for these specific recovery functions, ensuring that each has a clear exit condition (e.g., moving out of the entombed state) and possibly adding fallback strategies.

3. PREDICTION — 
       PREDICT: recovery_move_rate:_entombed > 10 within 6h
       PREDICT: event_share:_entombed < 0.2 within 6h
       PREDICT: events_per_hour:_entombed < 50 within 6h
