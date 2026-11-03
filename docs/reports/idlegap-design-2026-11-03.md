# idlegap: cut the "between" time (OWNER 11-03 item 6) — design, 2026-11-03

Owner goal: bots that build, survive and cooperate. The busy-time baseline (24 h, `scripts/lib/busytime.py`) had fleet
**between 54%** (no skill running, within 45 s before a model call). This report measures what fills that time, ranks causes
by **bot-time**, and ships the first fix as a fleet canary (`vetoremedy-01`).

## 1. Measurement

Method: full walks of `llm-<bot>.jsonl` + `skill-<bot>.jsonl` on the canary host, `lib/busytime.classify` over the window,
then the same classifier over every slice between two consecutive decisions, charged to the decision that **opened** the slice
(scripts: `idlegap-2026-11-03/gap.py.txt`, `veto.py.txt`, `ret.py.txt`). Positive control: the attributed between-hours sum
to the whole-window between-hours (34.5 of 34.6; 251.9 of 252.2).

**Post-promotion (15 s cooldown), 11-03 19:45–20:45Z, 80 bots, 80.0 bot-h, all on 53fd28ee:** productive 20.5%, walking
16.7%, model wait 6.0%, runner pause 11.1%, **between 43.3%** (34.6 bot-h), idle 2.5%. 7,834 model calls (98/bot-h);
**4,487 (57%) vetoed** by admission, 1,719 admitted + success, 1,067 admitted + failed.

| between after… | n | bot-h | share of between | median gap |
|---|---:|---:|---:|---:|
| veto repeat_loop | 1,058 | 6.97 | 20.2% | 26.1 s |
| model success | 1,719 | 5.32 | 15.4% | 15.6 s |
| veto deposit_nothing_to_bank | 969 | 4.13 | 12.0% | 15.6 s |
| veto unreachable_elevation | 951 | 4.01 | 11.6% | 15.4 s |
| model failed | 1,067 | 3.52 | 10.2% | 15.5 s |
| veto cooldown | 563 | 2.41 | 7.0% | 15.6 s |
| veto learned_avoid | 487 | 2.07 | 6.0% | 15.5 s |
| model aborted / veto not_worth_it / bad_args | | 1.32 / 0.94 / 0.78 | | |

All vetoes together: **~62% of between**, plus 2.7 bot-h of model latency spent producing them. A veto cycle is ~2.2 s of
model time and ~15.5 s of cooldown with nothing done. Pre-promotion 6 h (11-03 12–18Z, 480 bot-h, 30 s cooldown): between
52.5%, the same shape (vetoes ~58%).

By rung: **the `return` rung** ("Return home with what you gathered", hint "use the home skill") holds **9.0 of 34.5
between-hours (26%)**: unreachable_elevation goto 3.82, deposit_nothing_to_bank 1.80, learned_avoid goto 1.68, repeat goto
0.87, cooldown goto 0.51, not_worth_it 0.30. Over 24 h (11-02 19:00 – 11-03 19:00): **382 of ~1,920 bot-h on `return`**,
33,201 model calls there, **81% vetoed** (goto 20,740, deposit 6,206); `home` was proposed 907 times fleet-wide. Typical
trace (placebo-d-Delta, y=33, home y=75): `goto 177,75,73` -> "y=75 is 42 blocks ABOVE your y=33 — you cannot climb that in
one move. Descending is not limited this way" every ~17 s for 10+ minutes, interleaved with `deposit iron_axe` -> "last of its
tool family". The refusal names no remedy (CLAUDE.md: a refusal must name one the bot can perform).

Second: **deposit_surplus** named kept-item deposits (apple 363/h, last iron_pickaxe 256, last iron_axe 141): 1.9
between-hours. Over 24 h an **unnamed** deposit on that rung was refused as nothing-to-bank 0 times (successes 126,
learned_avoid 208, not_worth_it 109), and a named veto followed by the model's own unnamed deposit succeeded 200 of 404.

Third: **repeat_loop** (REPEAT_WINDOW = 4 identical admitted keys in the last 8, success or not): ~225 of 1,058 vetoes
blocked a key whose >= 3 recent same-key runs all succeeded (gather oak_log for stockpile_wood, explore on patrol).

After success: patrol `explore` successes leave 2.13 h (6.2%) — CONTINUE only continues gathers that gained items.

**Showcase** (11 bots, 18–21Z, 30.0 bot-h, protected tree 5d862a8a = still the 30 s cooldown): between 46.9%, but vetoes are
small; **after a successful model decision 51.8%** of between, `patrol explore` success alone 31.4%. Its lever is the 15 s
cooldown (arrives with the next restack onto 53fd28ee) and piece 3 below, not the veto remedy.

### Deposit refusals (coordinator input, storehub design 00d9056e: 16,381 deposit proposals/day, 15,831 refused before they start)

In the measured hour, every deposit veto together leaves **5.2 of 34.5 between-hours (15%)**: deposit_nothing_to_bank on
`return` 1.80 and on `deposit_surplus` 1.79, deposit_not_worth_it on `deposit_surplus` 0.50 and on `return` 0.30,
item_missing 0.13, nothing_to_bank on `idle` 0.25 and `gather_dirt_16` 0.14, the rest < 0.1 each. vetoremedy-01 converts
**~4.0 h** of it (all of `return` -> home; named nothing/missing on `deposit_surplus` -> deposit {}). Of the remaining ~1.2 h,
deposit_not_worth_it **on the deposit_surplus rung itself** (0.50 h) is the `onDepositMilestone` id bug below: the rung is
current only with storage within 48, but the gate's `'deposit_surplus'` never equals `deposit_surplus#N`.

Piece **depositoffer-01** (after repeatwork-01, or folded into it): one exported pure `depositRunnable(items, ctx)` = the
gate's own `depositPlan(...).length > 0 && depositDue(...)`, used by admission AND by the prompt: when it is false the
prompt does not offer `deposit` (and drops the CARRYING/deposit hint), so the model is not asked a question whose answer is a
certain veto. Removing the option is deterministic only if the per-call schema's skill enum drops it too (today
`this.schema` is built once in the constructor), so that part is cognitive.mjs + admission.mjs = tier 3. Expected: the
~1.2 h residual plus fewer model calls (deposit is 12% of decisions).

## 2. Designs

### Claude

1. **vetoremedy-01 (shipped as a canary, tier 3).** Right after a MODEL proposal is vetoed on an idle tick, queue the
   remedy the refusal implies as a work ORDER for the next tick (250 ms): `return_home` (on `return`, any vetoed proposal but
   `home` -> `home {}`) and `deposit_all` (on `deposit_surplus`, a named deposit refused nothing-to-bank / item-missing ->
   `deposit {}`). It never replaces an admitted model decision, a work order or a reflex exit; admission.check still judges
   it; budget one per rule per 45 s, <= 20/h; a dropped remedy waits out the veto's cooldown. Model calls can only fall.
   Addresses ~10.9 of 34.5 between-hours.
2. **repeatwork-01 (tier 3, admission.mjs).** The repeat window should not refuse a gather whose recent same-key runs all
   succeeded **and gained a wanted item** while the rung is unfinished; explore excluded until it has a visited-cell progress
   signal. `memoryRefuses()` and `check()` must call one exported pure `repeatDecision`. ~1.3 h addressable.
3. **patrolcont-01 (fewerdec.mjs, not protected, but its `gained` input is wired in cognitive.mjs).** CONTINUE an `explore`
   on `patrol` that made distance progress (the rung's own measure: blocks from home) — the showcase's largest cause (31%) and
   6.2% of fleet between.
4. Also: `unreachable_elevation` should name its remedy (`home`, or `surface` when below sea level) in its detail text.

### Codex (independent, `codex exec` read-only, given the measurements and the goal, not this design)

1. **Return-rung trap, 8.17 bot-h:** a deterministic `home {}` order while `return` is unfinished, **instead of asking the
   model**, with an attempt budget (two attempts per return episode, >= 60 s apart, continue only on measured distance progress);
   `RETURN_ORDER=0`. Warns: `home` succeeds 347/912, more climbing exposure; read deaths and return completions.
2. **Progress-aware repeat guard, 6.10 bot-h addressable (~0.65–1.3 recovered):** one pure `repeatDecision` used by both
   `memoryRefuses` and `check`; gather only, explore excluded; `PROGRESS_REPEAT=0`.
3. **Surplus order:** a deterministic `deposit {}` on an unfinished `deposit_surplus` with >= 4 bankable and storage in reach,
   to fill post-success windows and avoid named kept-item proposals; `SURPLUS_ORDER=0`.
4. **First canary: the surplus order alone** (concrete exposure, existing inventory protections, less movement risk).

### Reconciliation

- **Same top three causes, same ranking by bot-time** (return trap > repeat guard > post-success/surplus). Agreed: orders,
  not new skills; admission.check stays the only door; idle trigger only; exits keep priority; per-rule off switches.
- **Pre-model order (Codex) vs post-veto remedy (Claude) for `return`:** kept post-veto. It never overrides an admitted model
  decision (the model's own admitted gotos on `return` succeeded 2,619 times in 24 h and stay), and it only fills time that is
  provably wasted today. Codex's exposure point is adopted as the budget (one per 45 s, <= 20/h, per rule) on top of the gate's
  failed-cooldown / learned_avoid / repeat window.
- **First canary:** Codex picked the surplus order alone (less movement); Claude bundles both rules in one module because
  `return` is ~4.5x the bot-time and the bot already uses `home` (watchdog, model 907x/24 h). `VETOREMEDY_RULES=deposit_all`
  turns off `return_home` alone from the env, without a redeploy — the owner or the read can take Codex's narrower version at
  any time.
- Both reviews' shared note (a remedy dropped at the next tick brought the model call forward) fixed before queueing.
- Found in passing: admission's `onDepositMilestone` compares `activeMilestoneId === 'deposit_surplus'`, but sustaining ids
  carry `#N` (`deposit_surplus#3207`), so it is never true on the fleet; deposits there pass only when storage is within 48.
  Not fixed here (protected admission.mjs); goes with repeatwork-01.

## 3. What the design rests on (no new Paper/mineflayer behaviour)

`home` and `deposit` are existing skills, already issued by the model and the watchdog; the change only issues them as
orders. Facts used: `skills.mjs home` (goto, one `surface` repair when stranded below sea level, 240 s contract), the
admission gate (`memoryRefuses`, `check`), `fewerdec.mjs` scheduling. Nothing needs a Paper proof; the death gate and the read's
own lines cover the climbing exposure.

## 4. Pieces, tiers, queue

| piece | tier | where | status |
|---|---|---|---|
| vetoremedy-01 (return_home + deposit_all) | 3 (cognitive.mjs) | fleet canary | built `0556ddfa` on 53fd28ee, branch `vetoremedy01-on-53fd28e` |
| repeatwork-01 (progress-aware repeat window + onDepositMilestone fix) | 3 (admission.mjs) | fleet canary | design |
| patrolcont-01 (explore continuation on patrol) | 3 by wiring | fleet canary; reaches the showcase by restack | design |
| unreachable_elevation names its remedy | 3 (admission.mjs) | fold into repeatwork-01 | design |
| depositoffer-01 (deposit not offered / schema enum when the gate would refuse it) | 3 (cognitive + admission) | fleet canary, with repeatwork-01 | design |

Queue (Claude): vetoremedy-01 is a **progress** entry; after swimcentre-01 (S), i.e. bagdiet-01 (P) -> swimcentre-01 (S) ->
**vetoremedy-01 (P)** -> next S, ahead of bundle-1103a if the control session wants the larger busy-time lever first, else
right after it. Codex: the surplus rule first and the return rule as its own later canary. No showcase piece: the showcase's
between is post-success waiting under the 30 s cooldown; the restack onto 53fd28ee + this canary's KEEP carries both.

Read (registration `idlegap-2026-11-03/vetoremedy-01.0556ddfa.json`): +90/+180 generic, plus mechanism (`veto remedy`
work_order rows), calls/bot-h not up > 5%, no rule > 20 remedies/h on a bot, between share and return-rung bot-h reported,
deaths inside a home run named. Effect: busy.share between -5% relative; unreachable_elevation veto share -20% relative;
guardrails drowning deaths and items/bot-h (`effectwatch.py validate`: valid).
