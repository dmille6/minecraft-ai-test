**I would pause slice 1 until the weighting claim and grading rubric are fixed.** The sample is useful for discovering failures and collecting training candidates, but it is not yet a defensible population benchmark. Three improvements address the blockers.

1. **Separate coverage sampling from population measurement, and lock evaluation splits.**

   In [sample30k.py](sample30k.py), square-root allocation reasonably emphasizes rare situations. However, selection then applies bot-minute thinning, cell quotas, session caps, and global truncation. Decisions within a cell therefore do **not** have equal inclusion probabilities; weighting by `population_cell_count / sampled_cell_count` is invalid. Allocation counts also precede exclusions and thinning. The missing 1,256 cells cannot simply be assigned the rates of observed cells.

   Easiest fix: retain this sample for diagnosis and add a probability sample for prevalence, with known inclusion probabilities. Alternatively, redesign selection to retain calculable probabilities through every stage. Define the target population explicitly: excluded earlier decisions and sealed sessions have zero inclusion probability, so estimates cannot cover all 15,496,853 decisions without additional assumptions. Use session-clustered uncertainty estimates.

   The code excludes **all earlier IDs but only final_test sessions**, contrary to the brief’s broader session-exclusion wording. Resolve that discrepancy and assign session-level evaluation/training roles before deriving lessons or fine-tuning. Verify upstream exclusion of October 7 and the stated date range; neither is enforced here.

   Round-robin slices balance counts, but singleton cells deterministically enter one slice. Randomize the starting slice per cell if slice 1 must represent the full design.

2. **Make the answer key prospective, and distinguish skill validity from argument validity.**

   In [claude_judge.py](claude_judge.py), “outcome is a hint” still permits hindsight. Use **outcome-blind grading as the primary decision label**. On a randomized, stratified subset, obtain independent blind and outcome-visible judgments of the same rows; measure paired label changes by outcome and skill. The reported outcome-conditioned “yes” rates alone cannot establish bias—valid decisions may genuinely correlate with success.

   Define `decision_ok` as whether the **skill choice** is reasonable from visible information, and `args_ok` as whether arguments satisfy the skill’s contract and visible constraints, conditional on attempting that skill. An inappropriate skill can have valid arguments. Ensure the prompt supplies the relevant skill contracts; otherwise judges should return `unclear`, not invent requirements.

   Reserve `unclear` for insufficient evidence or unresolved ambiguity, with a structured reason. Report its rate separately; do not silently drop it or count it as failure.

   Crucially, `acceptable_skills` is not an exhaustive answer key, and it contains no acceptable argument specifications. It can support coarse screening, but alternative model outputs need candidate-specific grading. A reasonable unlisted skill must not automatically fail. Keep visible evidence and failure categories for later lessons.

3. **Audit agreements as well as disagreements before expanding.**

   Sonnet+Haiku with Opus escalation is a reasonable cost-conscious workflow, but agreement with Opus measures consistency, **not accuracy**. Shared mistakes survive disagreement-only adjudication. Send Opus a randomized sample of agreements as well, plus unresolved cases and disagreements on **both** decision and argument labels. Have a domain expert review a smaller stratified sample, including unanimous judgments.

   Predeclare continuation criteria based on audited error rates, consequential errors, and `unclear` rates. Compare judges using class-specific confusion matrices, not overall agreement alone; the Fable result on 45 examples cannot establish superiority.

   Using your prices, slice 1 costs approximately **$33.80 + $77 × escalation fraction**, before audits. All three slices cost **$101.40 + $231 × escalation fraction**. The ~$135 estimate therefore allows roughly 14.5% escalation and no additional audit budget. Validate the rubric and escalation rate on a small pilot before submitting 10,000 rows.
