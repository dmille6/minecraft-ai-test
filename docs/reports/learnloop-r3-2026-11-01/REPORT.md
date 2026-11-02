# Learning loop weekly round 20261101

_Generated 2026-11-02T13:51:40Z by scripts/learnloop/weekly/weekly.py on 10.0.0.31. State: `/home/mike/learnloop/rounds/20261101/state.json`._

| phase | status | when | note |
|---|---|---|---|
| harvest | done | 2026-11-01T13:05:15Z |  |
| pool | done | 2026-11-01T13:06:28Z |  |
| transform | done | 2026-11-01T13:06:41Z |  |
| teach | done | 2026-11-01T16:34:46Z |  |
| referee | done | 2026-11-01T16:34:46Z |  |
| assemble | done | 2026-11-01T16:48:19Z |  |
| train:qwen35-4b | done | 2026-11-01T19:33:12Z |  |
| export:qwen35-4b | done | 2026-11-01T19:50:03Z |  |
| train:qwen35-9b | done | 2026-11-02T02:00:03Z |  |
| export:qwen35-9b | done | 2026-11-02T02:10:03Z |  |
| replay | done | 2026-11-02T03:47:25Z |  |
| latency | done | 2026-11-02T13:51:39Z |  |
| gate | done | 2026-11-02T13:51:40Z |  |
| register | done | 2026-11-02T13:51:40Z |  |
| report | done | 2026-11-02T13:51:40Z |  |

**Training set** `train-20261101.jsonl`: 5800 examples, composition {'fail': 2164, 'good': 3000, 'post_veto': 636}, provenance {'teacher-local:qwen3.8:27b': 2800, 'fleet:qwen2.5:7b-instruct': 3000}, sha256 7d23cc3a6f1a.

## Replay (600 items, promptcache layout, llama-server b12020, fleet client, T=0)

| model | schema | hard | rep_fail | post_veto | agree skill | agree key |
|---|---|---|---|---|---|---|
| qwen2.5-7b-instruct | 100.0 | 15.0 | 59.0 | 95.0 | 75.5 | 69.0 |
| cand-c2-q8 | 100.0 | 1.5 | 15.7 | 8.0 | 67.0 | 57.0 |
| 20261101-qwen35-4b | 100.0 | 2.3 | 15.3 | 7.0 | 68.5 | 60.5 |
| base-qwen35-4b-q8 | 100.0 | 1.7 | 20.0 | 46.0 | 53.5 | 44.5 |
| 20261101-qwen35-4b-bf16 | 100.0 | 1.8 | 15.0 | 7.0 | 66.5 | 58.5 |
| 20261101-qwen35-9b | 100.0 | 2.2 | 16.3 | 6.0 | 68.0 | 58.0 |
| base-qwen35-9b-q8 | 100.0 | 2.3 | 19.3 | 38.0 | 44.5 | 37.5 |

- **20261101-qwen35-4b**: vs incumbent PASS; vs best FAIL ['hard <= best + 0.5 pp']; new best: True (CAPACITY RULE (owner 11-02): not significantly worse on any of ['hard', 'post_veto', 'rep_fail'], and 80/min within the gates vs best 0/min (>= 1.5x; best fails the lowest rung 20/min))

- **20261101-qwen35-9b**: vs incumbent PASS; vs best FAIL ['hard <= best + 0.5 pp']; new best: False (did not pass both gates)

New best: **20261101-qwen35-4b**.

## Referee (paid, evaluation only)

- arm C: local vs paid same skill 139/192 (pilot baseline 59.6); drift flag False (z 3.61); cost $0.7373
- arm B: local vs paid same skill 143/200 (pilot baseline 58.9); drift flag False (z 3.62); cost $1.7705
- paid vs paid (Claude vs GPT): same skill 155/192 (80.7%; pilot 72.5%)
