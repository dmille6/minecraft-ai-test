# Review request: 30k judged-sample design (before spending ~$135)

Goal: build an "answer key" of judged bot decisions to (a) screen executive models offline, (b) learn which situations/skills fail,
(c) later seed lessons and fine-tuning. Population: 15,496,853 logged LLM skill choices (2026-08-05..11-22, fleet 80 bots + showcase 15 bots,
models qwen2.5:7b and Qwen3.5-4B; 10-07 excluded for duplicate docs). Each row has the exact prompt, the chosen skill+args, and a logged
outcome status (success/failed/aborted/no_effect/unknown) + detail.

Sampling (sample30k.py, attached): strata = era(aug-sep/oct/nov) x world x skill x outcome x trigger(idle/event) x y-band x bag fullness x
hazard nearby x gate-rejected => 10,280 cells. Allocation ~ sqrt(cell size), min 1; one decision per bot per minute; max 30 per session;
excludes ids/sessions of earlier sets (replay-1000, replay-5000 incl. a sealed 3,003 final_test). Result: 30,000 rows, 9,024 cells, 11,843
sessions; era nov 11,846 / oct 9,110 / aug-sep 9,044; showcase 4,298; three balanced 10k slices (round-robin across sorted cells).

Grading (claude_judge.py, attached): system prompt asks "was the choice sensible GIVEN WHAT THE BOT COULD SEE; outcome is a hint only";
JSON schema {acceptable_skills[], decision_ok yes/no/unclear, args_ok yes/no/unclear, why}. Batch API, effort medium.
Plan: slice 1 (10k) by Sonnet 5.5 + Haiku 5.5 (second opinion); Opus 5.5 on Sonnet/Haiku disagreements; then slices 2-3 if worth it.

Calibration on 500 shared decisions (decision_ok, vs Opus 5.5): Fable 5.2 89% (n=45), Sonnet 5.5 87%, Haiku 5.5 82%, local Qwen3.5-122B 74%.
Opus "yes" rate by logged outcome: success 54%, aborted 23%, failed 25%, no_effect 16%, unknown 36%; local Qwen judge: success 65%, aborted 9%.
Costs (batch): Opus ~$7.7/1k, Sonnet ~$3.2/1k, Haiku ~$0.18/1k.

Questions: Is the sampling sound for those three uses (incl. weighting back to the population for prevalence estimates)? Is the grading
prompt/schema adequate (hindsight bias from showing the outcome? should we grade blind to outcome on a subset to measure bias?
skill-choice vs args separation; "unclear")? Is Sonnet+Haiku with Opus tie-break the right adjudication? Anything to change before
submitting slice 1? Blockers only plus top 3 improvements. Under 700 words.
