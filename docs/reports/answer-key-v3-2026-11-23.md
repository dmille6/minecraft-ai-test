# Answer key v3: 30,931 bot decisions graded by Opus 5.5 (2026-11-23)

**What:** Opus 5.5 graded real logged decisions from ELK **without seeing the outcome** (rubric v3, which includes the skill reference).
- **Coverage set, 30,000:** stratified over 8,922 situation types across all **15,496,853** decisions from 08-05 to 11-22.
- **Prevalence set, 931:** a **simple random sample**. Only this set estimates how common something is.

All requests succeeded. **Cost ≈ $247**, worked out from the token counts at batch list prices; the Console bill is authoritative.
Data: NAS `proxmox_data_share/mcai-new/answer-key-v3/` and `~/mcai/` on the analysis VM. Design reviewed by Codex beforehand
(`infra/analysis/codex-review-sample-design-2026-11-22.md`).

## Headline (random sample, ±95% margin)

| | Share of all decisions |
|---|---|
| Skill choice sensible | **35.2% ±3.1** |
| Arguments right, given the skill chosen | 50.2% ±3.2 |
| **Both sound** | **22.3%** |
| Judge could not tell | 1.4% skill · 1.3% arguments (the skill reference fixed the pilot's 24–33% "unclear" on arguments) |

**Why poor decisions were poor** (random sample, as a share of poor decisions):

| Cause | Share |
|---|---|
| **Repeated an action the system had just rejected** | **57%** |
| **Ignored the task or hint in its own prompt** | **20%** |
| Bad arguments | 11% |
| Wrong priority | 5% |
| Wrong target | 4% |
| Missing prerequisite | 2% |
| Not near / unreachable | 2% |

## What the coverage set shows

- **Quality did not improve over three months:** 34% sensible in Aug–Sep, 34% in October, 34% in November. Months of tuning the decision tree
  did not make the model's choices better.
- **Decisions after a gate rejection are much worse:** 22% sensible, against 38% otherwise. The model and the admission gates lock each other
  in a loop: the gate rejects, the model asks again for the same thing.
- **Town chore skills are almost never the right pick:** furnace_drain 0%, smelt_town 2%, make_material 3%, build_shop 4%, deep_mine 4%, bucket 6%,
  place 11%. They are on the menu when they don't fit the bot's task.
- **The best skills are still only about half right:** surface 59%, town_deposit 55%, gather 53%, mine 48%, smelt 47%, home 46%.
- **Situation matters less than expected:** underground and deep are slightly worse (30–31% against 37% on the surface). Bag fullness and nearby hazards make
  almost no difference.
- **Newer models look better**, but the samples are small: Qwen3.5-4B 52% (n=48) and gemma4:26b 48% (n=25), against qwen2.5:7b 34% (n=853).
  Screening will test this properly.

## What it means for the new platform (ADR-0004 / fresh-start analysis)

1. **Never offer a skill the bot cannot run right now, or one just rejected.** Feasible-skill menus from skill preconditions, with the typed rejection
   reason in the next prompt, and no-progress budgets. That targets the 57% cause directly.
2. **Put the task and its hint first, and keep the prompt short.** That targets the 20% cause.
3. **Planner-owned goals:** town chores come from the planner as goals, not as always-on menu items for the executive.
4. **A stronger executive model is likely to help** (see the newer-model signal above). Executive screening against this key is next.

## Caveats
- One judge (Opus 5.5). Opus agreed with Fable 5.2 on 89% of 45 shared items. Its error rate is measured on audits, not assumed zero.
- The coverage set over-samples rare situations by design: use it for "where and why", and use the random 931 for "how often".
- Grading is blind to the outcome: it judges the choice from what the bot saw, not whether it worked.
- These are decisions from the old architecture (orders, gates, prompts). They describe what failed there, not how the new runtime will do.
