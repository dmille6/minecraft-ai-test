# Learning loop weekly round 20261101

_Generated 2026-11-02T05:06:06Z by scripts/learnloop/weekly/weekly.py on 10.0.0.31. State: `/home/mike/learnloop/rounds/20261101/state.json`._

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
| latency | done | 2026-11-02T05:06:05Z |  |
| gate | done | 2026-11-02T05:06:06Z |  |
| register | done | 2026-11-02T05:06:06Z |  |
| report | done | 2026-11-02T05:06:06Z |  |

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

- **20261101-qwen35-4b**: vs incumbent PASS; vs best FAIL ['hard <= best + 0.5 pp']; new best: False (did not pass both gates)

- **20261101-qwen35-9b**: vs incumbent PASS; vs best FAIL ['hard <= best + 0.5 pp']; new best: False (did not pass both gates)

New best: **None**.

## Latency (open loop, 3 min per rate, llama-server -np 8, beside ethan-gpu)

| model@rate | valid/n | done/min | p50 ms | p95 ms | cached | gates |
|---|---|---|---|---|---|---|
| qwen2.5-7b-instruct@20 | 60/60 | 24.1 | 2239 | 5838 | 0.457 | fail |
| qwen2.5-7b-instruct@50 | 150/150 | 48.8 | 7417 | 12416 | 0.442 | fail |
| qwen2.5-7b-instruct@80 | 231/240 | 54.2 | 27709 | 88932 | 0.495 | fail |
| qwen2.5-7b-instruct@107 | 109/321 | 25.1 | 34427 | 44895 | 0.446 | fail |
| qwen2.5-7b-instruct@130 | 89/390 | 20.5 | 28455 | 44850 | 0.44 | fail |
| cand-c2-q8@20 | 60/60 | 24.2 | 3050 | 5563 | 0.432 | fail |
| cand-c2-q8@50 | 150/150 | 48.5 | 16614 | 23970 | 0.426 | fail |
| cand-c2-q8@80 | 57/240 | 13.0 | 24717 | 43632 | 0.397 | fail |
| cand-c2-q8@107 | 49/321 | 11.2 | 26643 | 42571 | 0.389 | fail |
| cand-c2-q8@130 | 46/390 | 10.5 | 26531 | 42206 | 0.386 | fail |
| 20261101-qwen35-4b@20 | 60/60 | 24.2 | 1668 | 3084 | 0.432 | PASS |
| 20261101-qwen35-4b@50 | 150/150 | 49.3 | 5989 | 11996 | 0.428 | fail |
| 20261101-qwen35-4b@80 | 213/240 | 50.2 | 31924 | 84628 | 0.443 | fail |
| 20261101-qwen35-4b@107 | 127/321 | 29.2 | 34904 | 44752 | 0.426 | fail |
| 20261101-qwen35-4b@130 | 84/390 | 19.3 | 26070 | 44645 | 0.422 | fail |
| 20261101-qwen35-9b@20 | 60/60 | 24.2 | 2933 | 6005 | 0.424 | fail |
| 20261101-qwen35-9b@50 | 150/150 | 48.4 | 11077 | 18487 | 0.428 | fail |
| 20261101-qwen35-9b@80 | 69/240 | 15.8 | 26674 | 44314 | 0.41 | fail |
| 20261101-qwen35-9b@107 | 49/321 | 11.2 | 25813 | 43009 | 0.389 | fail |
| 20261101-qwen35-9b@130 | 52/390 | 11.9 | 27122 | 44036 | 0.392 | fail |

## Referee (paid, evaluation only)

- arm C: local vs paid same skill 139/192 (pilot baseline 59.6); drift flag False (z 3.61); cost $0.7373
- arm B: local vs paid same skill 143/200 (pilot baseline 58.9); drift flag False (z 3.62); cost $1.7705
- arm B_vs_C: local vs paid same skill 155/192 (pilot baseline None); drift flag None (z None); cost $None
