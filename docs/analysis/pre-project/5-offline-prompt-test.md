# Offline test: new prompt design × candidate models (2026-11-23)

**Question:** before writing code, does the new design (feasible menu, one BLOCKED section, a hint withheld when blocked, capped lessons and events)
improve decisions, and which executive model is best?

**Setup**
- **Situations:** the 933 simple-random situations (slice 0 of the answer key, which represents all 14.5M eligible decisions).
- **Variants:** each rebuilt twice, as **V0** (the old prompt with all 42 skills) and **V3** (the new design, approximated from what the log contains).
  Script: `infra/analysis/offline-test/build_items.py`.
- **Models:** five, all served by llama.cpp on the 5080 with the tuned profile (8 slots, q8 KV cache, 4k context, thinking off, compact JSON, max 128 tokens).
- **Grading:** every distinct answer (6,479, including the old bots' own logged decisions as the baseline) was graded **outcome-blind by Sonnet 5.5**
  with rubric v3, against **the menu actually offered** (Codex review). Cost about $24.
- **Audit:** Opus 5.5 regraded 300 random answers (about $3).

## Results (sensible skill choice, share of all 933; invalid outputs count as not sensible)

| Model | V0 old prompt | **V3 new design** | Gain (95% bootstrap) | Both skill and args sound V0 / V3 | sec/decision at 8 parallel |
|---|---|---|---|---|---|
| **Gemma 4 12B** (Q4_K_M) | 59.4% | **67.4%** | **+8.0** [+4.5, +11.6] | 55.2% / 62.1% | 6.6 |
| Granite 4.2 8B (Q4_K_M) | 52.0% | 57.3% | +5.4 [+1.6, +9.1] | 48.2% / 54.2% | 2.7 |
| Qwen3-8B (Q4_K_M) | 41.7% | 46.3% | +4.6 [+1.3, +8.1] | 38.2% / 42.7% | 2.3 |
| Qwen3.5-9B (Q4_K_M) | 50.1% | 54.2% | +4.2 [+0.6, +7.6] | 47.8% / 50.7% | 3.5 |
| Qwen3.5-4B r3 (Q8, the fleet's model) | 58.8% | 59.4% | +0.5 [−3.0, +4.3] | 46.9% / 49.6% | 2.5 |
| *Old bots' logged decisions* | *31.7%* | — | — | *23.7%* | — |

Why poor decisions were poor, under V3: "repeated a rejected action" is still the largest share, but smaller (**31–47% against 66%** for the logged decisions).
V3 can only remove a whole skill after 2 refusals, because the old logs don't identify the exact refused call. The real runtime removes the exact call.

**Judge audit:** Sonnet and Opus agree on **80%** of skill-choice grades and **87%** of argument grades. **Sonnet is stricter**: 45% "sensible" against Opus's 54%.
So the absolute rates above are probably **low by several points**. Every row was graded by the same judge, so the comparisons between rows still hold.

## Conclusions
1. **The best model with the new design roughly doubles sensible decisions:** 31.7% → 67.4%. The model choice is most of it. The design adds +4 to +8 points
   for four of the five models, and nothing measurable for the incumbent 4B.
2. **Executive candidates:** **Gemma 4 12B** is the leader (best on both variants, Apache-2.0, 7.1 GB). Its cost is speed, 6.6 s at 8 parallel.
   **Granite 4.2 8B** is the fast runner-up (2.7 s). Keep both in M0; choose on live paired runs, where latency and outcomes count.
3. **The remaining repeat-after-refusal share needs exact-call exclusion** (candidate-call IDs, Codex review). The test confirms the direction, not the end state.

## Caveats
- One-step offline judgement on frozen situations. It does not show that the action then succeeds; live paired runs are the real test.
- V3 is an approximation built from logged text (no world state, a fixed reference skill list). The real feasible menu comes from skill preconditions.
- The judges are Claude models. Sonnet is the main grader (stricter than Opus), and there has been no human check yet (the owner's review bench is pending).
- Stochastic outputs (temperature 0.2), one sample per item.
