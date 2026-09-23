# banktruth-01 closed INCONCLUSIVE on a one-line registration omission, and the safety read it needed says it was fine (23 Sep 18:25 UTC)

Read-only. The slot is gone and the change is unjudged, but **the evidence below says the change was safe and
mildly favourable** -- it was lost to bookkeeping, not to data.

## What happened

```
12:10:07  deployed 9a6aa13 to placebo-d,hive-c,board-b,board-c
18:15:58  VERDICT UNREADABLE (+360) :: immobiledid evidence is absent (registration reads: ['banktruthread'])
18:18:46  ledger: INCONCLUSIVE   note: ""        <- empty
18:19:09  torn down
```

The registration's `reads` array lists only `banktruthread`. `immobiledid` carries the death gate, the v15c movement
guards and the readability test, so **there was no safety floor to read for the whole six hours**, and the loop
correctly refused to call a verdict without one. Six hours of canary time on a change whose premise was one of the
best-measured this month -- 2,079 deposit runs refused with "nothing matching <item> to hand over" and the bot was
carrying the item in **2,078 of them** -- produced no judgement.

## The missing safety read, run by hand before teardown

Window +360, canary 20 bots / 120 bot-h, control 40 / 240:

| line | canary pre -> post | control pre -> post |
|---|---|---|
| immobile share | 5.4% -> **1.8%** | 14.8% -> 10.9% |
| gather / bot-h | 16.7 -> **17.8** | 18.4 -> 15.8 |
| explore / bot-h | 9.4 -> 10.1 | 7.6 -> 9.6 |
| climbs / bot-h | 2.2 -> 2.8 | 4.6 -> 3.9 |
| livelock success | 65% -> 68% | 67% -> 67% |
| deaths | 2 -> 4 (0.033/bh) | 3 -> 5 (0.021/bh) |

Immobility fell on both arms by almost the same amount, so the DiD is ~flat. Gathering rose on the canary while
falling on control. Deaths are 1.6x control, which is exactly the regime the v21 lower-bound rule exists for: four
against five events cannot clear 1.25x at the lower bound, and the death poll ran for six hours without tripping.

**Caveat, stated because the read itself prints it:** the control arm moved -3.9 pp on the primary against a
"must stay within 3 pp" validity bound. When the control drifts past its own bound the difference-in-differences is
weaker evidence, so read the above as "no harm visible", not as an effect.

## Two process gaps, both cheap

1. **A registration whose `reads` omit `immobiledid` should not be deployable.** The loop discovered the omission at
   +360, six hours in. The same check at declare time -- does `reads` include the script carrying the safety floor --
   costs nothing and would have returned the slot immediately.
2. **The ledger note for this decision is empty.** Every other entry carries its verdict line. An INCONCLUSIVE with
   no reason recorded is indistinguishable later from a canary nobody read, which is the exact failure the ledger
   exists to prevent. The reason is known and is in this file; it belongs in the ledger.

## A correction to my own reading, for the record

I ran `immobiledid` twice. The second run returned all-`nan` guards and zero canary rows, and for a moment I took
that for a broken instrument. It was not: the canary had been torn down between the two runs, so the script read
`canary_pool=__none__` with a fresh cutoff and had nothing to classify. **The first run is the valid one.** A read
whose window straddles a teardown is vacuous by construction, and the header says so if you look at it before the
numbers.
