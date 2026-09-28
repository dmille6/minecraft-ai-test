# deposit-truth (b2e6dfd), review pass 2: do not ship

**2026-09-22.** Two independent engines attacked the applied diff. Both refused it.
ChatGPT: **DO NOT SHIP**. Claude: **SHIP WITH CHANGES**, three of them blocking.
The suite was **194/194 green** the whole time.

## The one that matters: pass 1 did not fix P1, it renamed it

Pass 1's finding was that the new refusal converts an admitted decision into a rejection,
feeding `consecutiveRejections`, which at 3 fires the livelock breaker. Pass 1 "fixed" it
by moving the check below the `due` gate. Both arms still `return { ok: false }`.
`cognitive.mjs:920` increments on ANY `ok:false` and `:938` resets only on admitted.

The measured population all had `due === true` — they reached the chest and opened it,
which is how they produced the `no_effect` rows we counted. Every one of them previously
ran the skill and returned `no_effect`, which **reset the counter to 0**. After the patch
each is a rejection that **increments** it. The patch converts ~2,128 counter-resets per
day into ~2,128 counter-increments, on bots standing still at the town chest gaining
nothing — which is `livelockFixated` exactly (`moved < 8`, `gained === 0`, 180 s). Three
proposals there fire `#escape()`: relocation 30–57 blocks from the chest, and a 600 s
latch if both rungs fail.

**Before the patch this loop was structurally unreachable via `deposit`. After it, it is
reachable from the standing-at-the-chest state.** That is a regression the whole exercise
was meant to prevent, and it survived a review pass that was specifically looking for it.

## The gate can ship completely inert with every test green

`depositItemArg` has ONE production call site (`admission.mjs:384`) and **no test drives
`AdmissionControl.check()` for deposit at all**. Drop the third argument and
`arg.unbankable` is permanently false, the refusal never fires, the patch is a no-op on
the fleet — and the ordering test still passes (it `indexOf`s three strings that are all
still in the file), the wants test still passes, every pure-function test still passes.
This is `canary-can-ship-inert` verbatim.

## The remedy is truncated out of the only channel the model reads

`cognitive.mjs:912` slices rejection feedback to **160 chars** (the success path gets 220)
and stores the truncated string in memory. Measured on the real message shapes, three or
more suggested items cuts the tail — and the clause that gets cut is
`or say deposit with no item`, the only remedy guaranteed executable. The gate only
reaches this refusal when `due` is true, which normally means several names, so
three-or-more is the common case. CLAUDE.md's "Reachable" clause failing at the transport
layer: not ignored, **not printed**.

## Two guards that promise what the other forbids

A bot far from a chest proposing `deposit apple` now gets *"…bank it when you are next
near the chest"* — which promises that banking the apple will work on arrival. It will
not; on arrival it gets `deposit_item_unbankable`. Pass 1 reordered to avoid this bug
class and pointed it the other way. Neither order is right.

## A remedy that rebuilds the trip it exists to prevent

`depositDue` is true at `occupiedSlots >= 30` even with zero bankable items. Such a bot
gets *"say deposit with no item to hand over everything bankable"* when nothing is
bankable; obeying it walks to the chest, opens it, and returns `no_effect`. `apple 543`
is the largest refusal name, so 30+-slot food hoarders are not hypothetical.

## The two engines disagreed once, and the disagreement was resolvable at the keyboard

ChatGPT: mixed-case chat (`deposit Oak_Log`) reaches `depositPlan` un-normalised, returns
`[]`, and the new sentence calls 12 oak logs "not worth banking". Claude examined the same
path and recorded **no finding**, on the grounds that `depositNoopDetail` normalises.

Reproduced directly:

```
depositPlan(inv,"Oak_Log")       = []
depositPlan(inv,"oak_log")       = [{"name":"oak_log","count":12}]
depositNoopDetail("Oak_Log",inv) = "you hold 12 oak_log but it is not worth banking"
```

ChatGPT is right, and the cause is deeper than it said: `depositNoopDetail(item, items)`
takes two arguments and computes bankability from defaults, while `depositPlan` is given
`bot.currentWants`. **They are two different bankability computations and can contradict
each other.** The patch replaces one false sentence with another, about `oak_log`, the one
item the whole program is bottlenecked on.

## My own denominator is inconsistent inside the patch

The source comments and test headers say "1,069 of 1,069" and "37% of 2,866 deposit runs".
The re-read says 2,126 of 2,128 and 54.6% of 3,894. Two denominators for one claim inside
one change. Reconcile before any canary; the expected change-row effect depends on which.

## What ships instead

Per the two-pass rule: a SMALLER patch, no third pass. Keep only the measured defect —
the false sentence — and drop the machinery that produced five of the findings above:

1. Normalise the item name **before** `depositPlan`, not only inside the message helper.
2. Make `depositNoopDetail` and `depositPlan` share ONE bankability computation.
3. Say which of the two cases it is; suggest NO remedies (that machinery caused F1, F2,
   F4, F7 and the truncation).
4. Leave `admission.mjs` alone entirely. No gate hoisting, no `wants` spread — the `wants`
   change is a live behaviour change that makes the full-chest bucket worse and needs its
   own change row, not a free ride on a truthfulness patch.
5. One behavioural test through the real call path, or it can ship inert.
