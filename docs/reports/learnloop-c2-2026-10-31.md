# Learning loop candidate 2 + the teacher pilot (2026-10-30 .. 31)

Owner 10-30 "queue both": run the paid-teacher pilot, train a SECOND candidate on cleaned data, judge it against
qwen3.5:9b. Kill rule (owner-approved): stop after two failed candidates; this one counts. Branch `learnloop-c2-1030`
(main + learnloop-m3-run merged in). Nothing here touched 10.0.0.72, a bot, an env file, the canary queue (except where
section 7 says), the manifest or a world. The Mac ran only the batch-API client and light analysis.

## 0. Answer

RESULT: (filled at the end)

**Owner decision still needed: read the vendors' output-use terms before any paid-teacher label is trained on.**
Both Anthropic (Usage Policy; Commercial Terms D.4) and OpenAI (Services Agreement 3.3(e)) restrict using outputs to
build competing models (design s.2.4 quotes them). The Claude labels from this pilot sit quarantined on the Mac
(`~/learnloop/teacher-paid/B/`) and were used ONLY to measure the local teacher; the dataset builder refuses any
`teacher-paid:` provenance (and, after Codex r1, any record that does not carry an allow-listed LOCAL provenance).
Questions (i)-(iii) of design s.2.4 remain open; whether even this measurement use is fine is question (i).

## 1. Teacher pilot (design s.2.4)

| arm | model (why) | route | requests | result | cost (actual) |
|---|---|---|---|---|---|
| B | `claude-opus-5-5` -- the current Opus and the design's choice; $4/$20 list, $2/$10 batch (claude-api skill, cached 10-06) | Anthropic Message Batches, effort `low`, structured output = the fleet schema, no server-side fallback (a fallback model would contaminate the arm) | 5 probe + 1,000 blind + 200 informed | 1,205/1,205 succeeded and parsed | **$11.61** (5.27 M in / 107 k out) |
| C | `gpt-6.1-sol` -- newest OpenAI generation, batch $1/$5; `gpt-6-astra` ($5/$25 batch) would have cost ~5x and the design priced sol | OpenAI Batch | 5 probe | **NOT RUN: `400 Billing hard limit has been reached` / `429 You have no credits remaining`** -- the OpenAI account has no credit. Nothing was submitted (no batch exists; the reservation was released) | $0 |

- Actual Claude cost is far under the plan ($11.61 vs $26.4 expected for blind + informed): answers were ~65 visible
  tokens with almost no thinking at effort `low`, against the plan's 1,500 output tokens per item.
- **Owner action:** add credit to the OpenAI project (its hard limit is reached), if arm C is still wanted.

### 1.1 How good are the LOCAL teacher's labels? (1,000 pilot items, blind condition)

Local teacher = **qwen3.8:27b** (Apache-2.0; the best untuned model on the 600-item replay: rep_fail 14.7, post-veto
21, hard 2.2), T=0, think:false, through the fleet's own client. Same scorer as training (`pilot_agreement.py`).

| | schema-valid | hard | re-chooses the logged failed action (837 non-transient) | passes the label filter |
|---|---|---|---|---|
| qwen3.8:27b (local) | 100.0 | 4.6 | 14.2 | 84.6 |
| claude-opus-5-5 (paid) | 100.0 | 4.4 | 10.6 | 87.2 |
| the fleet's logged action (positive control) | 100.0 | 16.7 | 100 (by construction) | 13.9 |

| agreement on 1,000 items | same skill | same skill + key arg | skill kappa |
|---|---|---|---|
| **qwen3.8:27b vs Claude** | **58.9%** | **50.5%** | **0.48** |
| fleet logged action vs Claude (floor) | 18.5% | 9.5% | 0.10 |
| Claude informed vs Claude blind (200; the paid teacher's own consistency across conditions) | 75.0% | 67.0% | 0.69 |

- Same keep/drop verdict on 85.8% of items; when both are kept, same action on 55.1%.
- Read: the local teacher is much closer to Claude than the fleet is, and about as valid (hard 4.6 vs 4.4), but it
  re-chooses the failed action somewhat more (14.2 vs 10.6) and over-uses `surface` (485 vs Claude's 331 of 1,000;
  when it says surface, Claude agrees on 311). That last point shaped the dataset (s.2: the 30% skill cap).

## 2. Cleaned dataset v1-c2 (design s.2.1-2.2)

Source: dataset v0's TRAIN cell only (13 training worlds x 10-08..10-19; held-out worlds board-a, placebo-d,
isolated-c and the 2 newest days never enter; the 600 eval ids and 1,000 pilot ids are excluded from the pool).
Positive control: the pass walked 1,462,110 TRAIN rows = v0's TRAIN cell exactly. `build_clean.py`.

- **Good by OUTPUT** (never decision success alone): of 316,538 v0 train-good, 12,597 dropped as repeats of the bot's
  previous action when that one failed or was vetoed; 49,390 with no gathered item in 600 s and no milestone; then the
  top half of each skill by 600-s gathered items (131,395 left); 9,000 sqrt-by-skill.
- **Relabel pool** for the local teacher (blind prompt = what the fleet saw): 12,000 non-transient failures stratified
  over 107 failure-class x skill strata + 4,000 decisions right after a repeat_loop veto.
- **Label filter** (s.2.2): schema-valid through the fleet client; bench/models/score.py hard check passes; not the
  logged failed action (any item whose logged decision failed non-transiently); after a veto not the vetoed action;
  allow-listed local provenance only.
- **Anti-collapse cap**: no skill above 30% of the kept relabels (fixed before the final count; seeded downsampling).

COMPOSITION: (filled at assembly)

## 3. Base choice: Qwen3.5-9B (not Qwen3-8B)

(filled)

## 4. Training

(filled)

## 5. Replay (600 items, same instrument and scorer as replay-cands-01 / blackwell-base-01)

(filled)

## 6. Verdict vs the owner's bar

(filled)

## 7. Queue entry

(filled)

## 8. Reviews

| round | Codex (codex exec, read-only, blockers only) | Claude (independent subagent) |
|---|---|---|
| 1 | 2 blockers: post-veto item that itself failed could be relabelled with that action; missing provenance defaulted to local (both reproduced) | 2 blockers: template check tested think:false while the canary serves think unset (Ollama 0.33.2: identical; 0.32.14 on the 3090: thinks); Blackwell guard failed open |
| 2 | all FIXED, no new blocker | -- |

## 9. Owner decisions needed

1. **Vendor terms** (above) before any paid label trains anything; and whether measurement use is fine.
2. **OpenAI credit** if arm C (gpt-6.1-sol) is still wanted.
3. (filled)
