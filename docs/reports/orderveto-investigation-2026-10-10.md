# orderveto: does the admission gate wrongly veto the bots' own work orders? — NO; not built

_2026-10-10 (host clock 13:42Z). Fleet `4970c91`. **Decision: orderveto-01 NOT BUILT** — both engines AGREE (round 2).
Reads: `scripts/host/orderveto/orderveto_read{,2,3,4}.py`; outputs and inputs (skillargs.json, stacks.json) in
`~/mcai-analysis/orderveto-evidence-2026-10-10/` and `/tmp/orderveto-evidence-2026-10-10/` on the fleet host._

## Instrument

Today's `/var/log/mcai/*/llm-<bot>.jsonl`, 00:00-13:28Z (the host was powered off 13:28:15Z for its memory resize), full
walk, rows sorted per bot: 80 bots, 90,660 decisions. A WORK ORDER row = `llm.latency_ms == 0`, empty response,
`tool_calls[0].skill` set (cognitive.mjs synthesises the proposal and skips the LLM). Key = `actionKey(skill, args)` with
the declared arg lists dumped from `SKILLS`. **Positive control:** 7,314 `_work_order` events in the skill logs vs 7,311
order rows (the first attempt matched `work_order` instead of `_work_order` and read 0 — a broken instrument caught by
its own control).

## Classification (denominators first)

7,311 work orders: 3,703 admitted, **3,608 refused** (repeat_loop 2,151, cooldown 1,457) on 57 of 80 bots. All 3,608 are
RUNG orders (craft 3,536, smelt 72). Town orders, wear_out and planting were never refused on these reasons (positive
control: 904 place, 530 town_deposit, 106 compost, 97 withdraw_pick, 79 wear_out admitted in the window).

| refused by | the bot's own history of the same key | n |
|---|---|---|
| repeat_loop | >= 3 of the 4 window admissions FAILED/unknown | 2,047 |
| repeat_loop | mixed window | 91 |
| repeat_loop | >= 3 were no_effect (smelt produced nothing) | 12 |
| repeat_loop | >= 3 SUCCEEDED (a productive repeat) | **0** |
| repeat_loop | window boundary | 1 |
| cooldown | last attempt FAILED | 1,456 |
| cooldown | no prior attempt today | 1 |

Positive control for the zero: 203 craft and 96 smelt orders succeeded in the window, and 91 windows read "mixed".

**Why the earlier attempts failed** (the last same-key failure; a runner pause traced to the failure before it):
no room in the bag for the craft's output (craftroom) **3,238 with no fewer slots at the refusal than at the failure**;
42 with fewer slots; table/furnace unreachable 204; other/no record ~124. The slot count is a stack-size ESTIMATE from
the snapshot (aggregated by name), not a re-run of `admitRoom` (table and pickup reservations, output stacking), so the
3,238 (89.7%) are *consistent with* the cause still holding, and ~4.6% is a rough, not rigorous, bound on unjustified
refusals (both reviews).

**After:** of the 3,608, 2,682 were admitted later and FAILED again, 318 later succeeded, 536 were never admitted again
that day, the rest aborted/no_effect.

**Verdict on question 1: the refusals are justified.** The brief's build condition ("if unjustified vetoes dominate") is
not met. Exempting work orders from repeat_loop/cooldown would convert cheap refusals into more failed crafts.

## What a refused order costs (question 2)

- Time to the bot's next decision after a refused order: median 31 s, p90 45 s; **33.1 bot-h in 13.5 h** (gaps capped at
  600 s) = ~3.1% of ~1,078 fleet bot-h. These are inter-decision intervals in which no skill ran; not all of it is
  recoverable (Codex).
- What came next: the SAME order again 2,368 times (it is recomputed every decision, before the model, and `recent` only
  moves on an admission). **44 runs of >= 10 consecutive refused orders, 14.77 bot-h; the 12 longest ~36-42 min each
  (~80 repeat_loop refusals in a row with the model never consulted)** — e.g. board-b-Bravo `craft furnace` 07:06-07:48Z,
  hive-d-Alpha `craft stone_pickaxe` three times. They end at ~2,490 s, consistent with the 45-min no-progress give-up.
- Plus 1,124 admitted craft orders that failed for no room and 315 that failed "runner paused".

## The real defect, and why the obvious fix was not built

The gate is right; the ORDER is wrong. `readyFor` (workorder.mjs) asks whether the recipe is satisfiable, never whether
the bag can hold the output (`admitRoom`), so a rung craft is issued, fails for no room, and is re-issued every decision.
The failure names a remedy — of the 1,124 bag-full failures: **"home -- then deposit X" 696 (62%)**, "deposit X -- it
walks home" 235, "place <block>" 160, "no slot can be freed from here" 22 — but nothing executes it.

**Designed and reviewed (round 1): "the order yields".** A craft/smelt order refused for cooldown/repeat_loop hands the
decision to the model in the same tick; gate and generator unchanged. Prototyped with behaviour tests and mutants, then
discarded. Round 1: Codex APPROVE-WITH-CHANGES, Claude APPROVE-WITH-CHANGES — Claude predicted it mostly INERT: the
prompt the model would get carries `HINT: craft with item=X` (milestones.mjs) and lists X under CAN CRAFT NOW with no room
check (prompt.mjs), and the repo has measured the model re-proposing a refused action 70.9% of the time (2fba1a88) and
following craftroom's deposit advice 7% of the time (towndeposit.mjs header). Also: ingredient gathers count as serving
the rung (cognitive.mjs wanted set, milestones.mjs servesRung) and reset the 45-min give-up, so a yield could stretch a
stuck rung toward the 3-h residence limit while refilling the bag.

**Measured (read 3/4): what the model does with a turn right after a bag-full craft-order failure** (n=112, the cases
where it got one today): it took the NAMED remedy 14 times (12.5%; 12 = `home` or a goto ending within 16 blocks of home,
2 deposits); otherwise mine 28, explore 22, gather 15, craft 11, goto elsewhere 11, deposit refused
`deposit_not_worth_it` 5 (the far-from-home case the "home" text exists for). Median distance from home at the failure
108 blocks (p90 210). **Selection caveat (both reviews):** these turns happened only when the order had stopped being
issued, so their prompt likely lacked the craft HINT; under a yield the model would be pulled harder toward the craft.
The measurement supports skepticism; it is not a causal estimate.

**Round 2 (decision not to build): Codex AGREE ("record insufficient evidence of benefit, not proved inert"); Claude
AGREE.**

## Recommended follow-up (separate design, own canary, both engines) — NOT built

Make the craftroom remedy deterministic and stop issuing the craft while it cannot fit:
1. `readyFor` asks the craft skill's own room predicate (`admitRoom`, with its table/pickup reservations); while it says
   no room, no craft order — and CAN CRAFT NOW / HINT stop advertising X (else the model re-proposes it).
2. In its place, the NAMED remedy as the order, recomputed against the current bag: `place <block>`; or home-then-deposit
   X. Going home does NOT guarantee the town deposit fires (34+ slots, the 16/12 town zone, `plan.freed >= 1`, and it KEEPS
   logs/cobble/wanted up to 64 — often exactly the X craftroom names; towndeposit.mjs:93-111, 230-245), so the remedy must
   be "home then deposit X" or check `townDepositPlan(...).freed` covers the shortfall first.
3. Suppressing the craft before its first failure must still schedule the remedy (Codex).
4. Once the rung order is gone, wear_out and the compost town order become reachable again — test as a chain.
5. Canary tripwires: deaths and travel failures (a home walk is long); rung residence and no-progress give-ups (DiD);
   primary = executed decisions per bot-hour plus time from a no-room craft failure to that craft's success / slots freed /
   rung change; report admitted no-room craft failures per bot-hour as the harm metric.

## Instruments kept

`orderveto_read.py` (classification, cost, streaks), `orderveto_read2.py` (failure causes, positive control, streaks),
`orderveto_read3.py` (named remedies; the model's next turn), `orderveto_read4.py` (remedy taken, with homes from the
harness env). Each walks one day of llm rows per bot (~1 min, < 1 GB); run under `systemd-run --user --scope -p
MemoryMax=12G`.
