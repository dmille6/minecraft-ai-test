# leaf-01 at +90: the refusal moved, the wood did not — 19 September 2026, 14:20 UTC

Not a verdict. The loop decides at +180 (16:12Z) against the registered gate. This is the mechanism, written
down while it is legible, because the +180 read will say *what* and this says *why*.

## The endpoint did its job

```
MECHANISM  buried refusals/bot-h   DiD  -3.18     <- the "win"
PRIMARY    acquired logs/bot-h     DiD  -0.42     <- the endpoint, NEGATIVE
v15c       items gathered/bh       -63%           <- WATCH breach (bound -50%, severe -70%)
           gather calls -24%   explore calls +81%
           deaths 0 vs control 0.053/bh   exposure 209 gather runs (min 100)
```

Canary went **19 logs in 29.9 bot-h → 1 log in 14.9 bot-h**; control held 4.25 → 4.10/bot-h.

**Scored on "buried refusals avoided" this reads as a −3.18 triumph.** The endpoint was moved to acquired wood
on Codex pass 1's objection — *"pickup restores the digging profile and never clears cover, so a log dropping
inside foliage can be broken and never collected"* — and that decision is the only reason this is visible.

## Where the refusals went: named, with the control flat

Failure-class shares of canary gather calls, pre vs post, against the same split on control:

| class | can/pre | can/post | ctl/pre | ctl/post |
|---|---:|---:|---:|---:|
| `failed/unreachable` | 29.0% | **13.1%** | 29.0% | 26.1% |
| `failed/no_safe_target` | 21.6% | **36.6%** | 22.8% | 20.1% |
| `failed/no_path` | 11.9% | **18.3%** | 16.8% | 16.7% |
| **`success`** | **21.4%** | **21.1%** | 19.4% | 24.9% |

**The change worked and did not help.** `unreachable` halved — exactly the class it targets, and control did not
move — but the freed attempts became `no_safe_target` (+15 pp) and `no_path` (+6.4 pp), **not successes**. The
success share is flat to a tenth of a point.

This is Codex pass 1's question answered in its own terms: *"If this converts 'buried' refusals into a DIFFERENT
failure class rather than successes, say so and name the class."* The classes are `no_safe_target` and `no_path`.

## Why fewer attempts, and why the model left

Success *share* is unchanged while gather *calls* fell 24% and wood fell 63%, so the loss is in throughput, not
in hit rate. Both Codex passes named the route:

- pass 2: **"three consecutive barren attempts terminate the run"** (`skills.mjs:316`), inside a 180-second
  budget (`skills.mjs:5082`). A newly admitted leaf-covered log fails LATE — after the walk — where the old
  refusal was free and immediate. Late failures spend the run.
- pass 2: the reach probe keeps **4** nearest candidates and promotes its hit above approachable ones
  (`reachprobe.mjs:75`, `skills.mjs:1470`), and its goal **checks distance only** (`digreach.mjs:113`). Leaf-covered
  logs are nearer, so they take the slots.

`explore calls +81%` is the consequence, not a separate finding: gather stops paying and the model spends the
tick elsewhere.

## What this says about the next version

The principle survives — a trunk in its own canopy **is** reachable, and `unreachable` halving on the canary
with control flat is the proof. What fails is admitting it as a *peer* of an open target.

Codex pass 2 proposed the fix before the deploy and it was not taken: **"admit leaf-covered logs only as
fallback, including in the probe."** That is now the design, and this read is the evidence for it. It also needs
`no_safe_target` understood first — 36.6% of canary gather calls, the largest single class, and the code's own
comment already says `safeToBreak` ORs two rules and returns one `false`, so nobody can tell "beside water"
from "under falling blocks".

**Do not rebuild it as a peer-ranked filter and re-canary. That experiment has now run.**
