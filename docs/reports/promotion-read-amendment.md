# Two prospective amendments for the owner's delegation (14 Sep 2026, 22:00 UTC) — draft for ChatGPT's review

## 1. Missed slots
Rule today: a canary needs two eligible pools from the 5080 inference half, within +-40% of that half's 2-h median
of items/bot-h, with exposure, not a canary in the last 12 h, never placebo-c. Six pools are excluded tonight, so a
revert at 03:18 UTC leaves no slot before ~09:30 UTC.
Proposed: keep the rule. The 5080-half restriction exists so both arms share an inference endpoint (latency and
model are then not a confound); widening to the 3090 half would buy slots by adding a confound. The cost is at most
six idle hours a day of canary capacity, and the sandbox is where the queue actually waits. Nothing to change.

## 2. The 72-hour read on the ladder promotion (6d843a1, T0 14 Sep 09:34 UTC; read Thu 17 Sep 09:34 UTC)
Rule today (registered in RULE v9c): survival is judged fleet-wide over 72 h after promotion against the program's
2-week number, deaths/bot-h <= 0.05; a failure reverts the fleet to 8a2964a.
The problem: 0.05 is the program's two-week COMMITMENT (feasibility review, committed numbers), not a property any
single change was expected to deliver; the ladder does not touch the channels that kill (lava, sealed pockets,
falls). The fleet ran at 0.06-0.07 all day. A revert on Thursday would also remove the deposit rebuild (42% vs 12%
success on its canary) and the breaker fixation gate (75% of blind relocations refused), which rode in on top, and
would put the fleet back on code with the tool-banking bug.
Proposed (prospective; registered now, before the read): the 72-h read judges the promoted code against the 72 h
BEFORE the promotion on the same fleet, split by code version, on all five numbers, with the counts beside the rates:
- REVERT if deaths/bot-h on the promoted versions exceed the pre-period by more than 25% AND the excess is at least
  8 deaths (so a 5% difference on 250 deaths is not a revert, and neither is a 30% difference on 20);
- REVERT if immobility (bot-minutes) or items returned per bot-hour fall by more than 25% with the same count floor;
- otherwise the promotion STANDS, the five numbers are reported against the commitments as a program status, not
  a gate, and the two-week commitment is judged on 27 Sep on the whole program, as the feasibility review wrote it.
The absolute 0.05 stays what it was: a program target for 27 Sep.

## Question for the reviewer
Are both calls sound? For #2, name at most three defects with a one-line remedy each.

## ChatGPT's verdict and the joint resolution (22:15 UTC)
ChatGPT agreed on #1 and disagreed with #2 as drafted: changing a gate whose outcomes are already partly known is not
prospective; the draft's harm rule was malformed (direction, denominator and threshold per metric); a before/after
cannot isolate the ladder from the fixes stacked on it. The resolution (RULE v13): the Thursday read becomes a
program status read with an explicit, owner-delegated exception recorded against v9c; a well-formed fleet-regression
rule is registered prospectively for every later promotion (deaths and immobility as gates with relative thresholds
and count floors, the three productivity numbers report-only); and a contemporaneous reverse canary is the named
instrument for isolating one change when it matters.
