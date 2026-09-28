# banktruth-01: an independent read, one hour in

**2026-09-23 ~13:00Z.** `banktruth-01` (9a6aa13) was deployed 12:10:07Z by another session
to placebo-d, hive-c, board-b, board-c. This is NOT that run's verdict — the canary loop
owns that. It is a second pair of eyes, using instruments built overnight that did not
exist when the canary launched.

## The patch is better than the one I had blocked

My `deposit-truth` (b2e6dfd) failed two review passes on four defects. 9a6aa13 is
independent work, not built on it, and avoids every one:

- **It does not touch `admission.mjs` at all**, so the P1 defect — a refusal feeding
  `consecutiveRejections` into the livelock breaker — cannot exist.
- **"ONE DEFINITION, EVALUATED TWICE"**: it calls `depositPlan` itself, so the sentence
  and the transfer cannot disagree. That is my mixed-case defect fixed at the root, and
  the comment names the reason: "the previous attempt computed bankability by two
  different routes and was refused in review for it."
- **It suggests no remedy**, explicitly because "that machinery produced five findings in
  the review of the larger patch" — which removes the 160-char truncation problem too.
- It corrected its own headline: 2,078 of 2,079 is "a restatement of the upstream guard,
  not evidence".
- And it adds a catch I did not have: **no count in the message**, because an embedded
  number splits one refusal into one `detail` string per quantity held, and this repo's
  own refusal reads bucket on `Counter(detail[:95])` — the largest refusal on the fleet
  would drop out of every top-N the day it shipped.

## Linkage, 60 min window, deposit runs canary 80 / control 94

| row | canary | control |
|---|---:|---:|
| NEW: "you are carrying X, but X is not a banking target right now" | **17** | **0** |
| OLD: "nothing matching X to hand over" | 23 (28.8%) | 75 (79.8%) |

The change fired, the control arm is clean (this repo has reverted three canaries on rows
the control also emitted), and the false sentence fell about 64%.

## The one thing worth telling the owning session early

**It is a partial fix.** 28.8% of canary deposit runs still print the old sentence —
`chest` (11 runs) and some `apple` (9). Either a path bypasses the new wording, or those
items are genuinely absent and the sentence is true for them, in which case the headline
"false by construction" holds only for the items admission actually gates. Worth knowing
at +60 rather than at +360.

## Not a verdict, and specifically not this

Deposit success reads canary 1.8% (1 of 55) against control 5.5% (4 of 73) in the first
45 minutes. That is 1 success against 4. It is noise and must not be read as harm.

## What made this read possible

Yesterday every fail_class question had to be answered by regexing prose, because the
blessed analysis library indexed only event names. `classsplit.py` and the typed
vocabulary landed overnight; this read took minutes.
