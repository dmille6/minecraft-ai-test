# Two gates against unverified negative inference

**2026-08-24.** Nothing here changes bot behaviour. The fleet stayed on
`b9436d5` throughout and kept accumulating.

## The question

Two classes of mistake kept recurring, four instances of one and six of the
other in a single day:

**A — the capability exists and the model never sees it.** `swim_to` shipped
with a usage line and zero uses, because nothing told the model it was in
water. The `IN WATER` line then shipped without a destination, and the model
asked for zero-block crossings. Tool equivalence surfaced the better pickaxe
only inside a craft failure a trapped bot never triggered; one sat entombed for
ten hours carrying the materials for its own rescue. `deposit_surplus` went
into the milestone chain behind a rung requiring 15 blocks from home, when the
median bot is 804 blocks away.

**B — a detector answers uniformly and I nearly believe it.** An RCON probe
read an entire ocean as dry. A measurement window landed in the future. The
`_${kind}` underscore convention returned 0 against 560 events, twice, the
second time straight through the guard written after the first.

Both reviews independently landed on one cause, and stated it better than the
"boundary problem" framing I had:

> **The system treats absence as information without proving observability.**
>
>     capability exists    != the model can see when to use it
>     query returns zero   != the phenomenon is absent
>     probe returns false  != the world condition is false

They are two faces of the same thing: an unverified negative inference across a
layer boundary. In A the boundary is skills → prompt, and the unlicensed
inference is "the model didn't pick it, so it judged it unhelpful". In B the
boundary is data source → analysis, and it is "the query said zero, so it
didn't happen".

## What was built

Two gates, in the shape this repo already uses — one lesson, one cheap
automated check, each naming the outage that caused it.

### Class B: a probe that is allowed to say "I don't know"

`scripts/lib/probe.py` is to probes what `scripts/lib/telemetry.py` is to
counts. `Probe` carries `yes | no | unknown`, and **`__bool__` raises** — always,
not only on unknown. That is the whole mechanism: `if matches(...)` becomes a
crash at every call site instead of a silent `False` at the one call site that
happened to hit an unloaded chunk. A tri-state you can accidentally treat as a
bool is a bool.

`Survey` adds the other half: denominators and controls on every report.

```
  wood within 80b of 355,147:
    queried  48   yes 7   no 39   unknown 2
             2x 'That position is not loaded'
    control  ok    sky above the centre is not a log: expected no, got no
    control  ok    a column counted as wood reads as wood: expected yes, got yes
```

It **refuses to print** unless the controls passed. Six of six confident zeros
would have been caught by that block.

`place-town.py` was retrofitted — it is where the original bug lived. Doing so
surfaced a second, live defect: `_forceload`'s pad was 40 blocks while
`WOOD_RINGS` reach 80, so **every one of the 24 wood samples probed chunks the
server had not loaded**, and the old boolean turned each one into "not a tree"
without a word. The wood criterion exists precisely because a site with zero
trees within 288 blocks had already passed siting once. The pad is derived from
the constants now, and unknown is fatal inside `surface_y` — a binary search
does not return "I could not tell", it returns a number, and numbers get
believed.

The guard caught my own code within a minute of being written:
`confirmed = confirmed or wood` used a probe as a boolean and raised.

### Class A: a funnel, not a count

I had proposed "alert when a newly shipped skill has zero uses after N
bot-hours". Both reviews rejected it and they were right: zero is one number
covering five different failures. The instrument is

```
eligible -> prompted -> selected -> admitted -> started -> succeeded
```

and the finding is the **first broken edge**, not the final count.

- `bots/src/affordances.json` — every model-selectable skill in exactly one of
  three buckets: `contract` (an observation names its situation),
  `unconditional` (applies in nearly any state, reason required), `gap` (we
  know the observation is missing, reason required, reported every run so the
  silence stays a known silence).
- `bots/test/affordance-contract.test.mjs` — renders a **real prompt from a
  real bot fixture** in the eligible state and asserts the observation appears
  and names the skill; renders the ineligible state and asserts it does not. The
  negative half matters as much: a line that is always on carries no
  information and costs tokens on ~60 decisions per bot-hour.
- `scripts/affordance-funnel.py` — the flight side. Eligibility is recomputed
  **from the logged snapshot, never from the prompt**, deliberately a second
  independent source. Deriving it from the prompt line would make every edge
  pass by construction; because the two answers come from different code, their
  disagreement is the finding.

Both consume the same JSON, and the test fails if a contract names an
eligibility rule the funnel does not implement.

## The funnel's first run, and what it found

90 minutes, 4,566 decisions, 39 bots, `b9436d5`:

| affordance | eligible | prompted | selected | admitted | started | succeeded |
|---|---|---|---|---|---|---|
| `swim_to` | 1318 | 1238 | 247 | 231 | 231 | **11** |
| `craft` | 3421 | 3075 | **307** | 180 | 180 | 36 |
| `deposit` | 1043 | 1022 | 118 | 26 | 26 | 7 |

**`swim_to`'s break has moved.** This morning it was `eligible → prompted`: the
renderer never fired. That edge now runs at 94%. The break is at
`started → succeeded`, **5%**, and the outcome breakdown names two causes:

```
swim_to outcomes, 90m:  failed 148   aborted 89   success 11
    67  drowning
    76  "target is Nb away — that is not a crossing"  (1b:36, 2b:12, 3-8b:28)
     7  "swim_to crosses water and you are on land — use goto"
```

1. **The drowning reflex preempts the swim, 67 times.** `swim_to`'s travel mode
   is submerged sprint-swimming (`jump: false`) because it is ~3.92 m/s against
   2.20 at the surface. Submerged means oxygen depletes, which is precisely
   what the 500ms reflex layer exists to interrupt. The skill and the reflex are
   fighting over the same bot, and the reflex wins by design. I built both and
   did not see it.
2. **The model still supplies near targets, 76 times**, despite the destination
   wording. The `IN WATER` fix moved the behaviour and did not solve it.

**`craft`: `prompted 3075 → selected 307` (10%).** The model is told it can
craft on three thousand decisions and picks craft on three hundred. That is a
wording or competing-affordance problem, not plumbing — a different day's work
from the swim bug, and the funnel says which.

**`deposit`: eligible 1043.** The rung is reachable now. `selected → admitted`
runs at 22%, so the gate vetoes 78% of deposit proposals; worth a look, below
the break threshold.

## The funnel's first run also caught the funnel

Run without `--home`, the deposit rule could classify 658 of 4,564 records —
every one ineligible — and the report announced *"the situation never occurs"*.
A claim about the fleet made from 14% of it: the exact mistake the whole day was
about, committed by the instrument built to prevent it, within an hour.

Fixed with `Survey.report()`'s rule: above 20% unclassifiable, print
`INSUFFICIENT` and no edge. An instrument that did not pass its own
preconditions does not get to publish a conclusion.

## Mutation testing

Every new test was verified by breaking the source and confirming it fails.
Eight mutations, eight caught:

| mutation | caught by |
|---|---|
| `classify_execute_if` returns `NO` instead of `UNKNOWN` | 2 siting tests |
| `_PAD` back to 40 | pad-covers-probes |
| observation removed from the prompt | fires + names-the-skill |
| `IN WATER` fires unconditionally | silent-when-not-applicable |
| every `swim_to` mention stripped from the line | names-the-skill |
| `CARRYING` removed | 2 deposit tests |
| contract names a rule the funnel lacks | funnel-rule-exists |
| a skill falls out of every bucket | exactly-one-bucket |
| a gap reason becomes `"n/a"` | arguable-reason |

The first attempt at the fifth mutation **survived**, and the test was right to
pass: I had stripped only one of two `swim_to` mentions on that source line. A
surviving mutation is a claim about the test that has to be checked, not
automatically a defect in it.

## Also fixed

`scripts/test-*.py` was not in `preflight.sh`'s loop, so `test-place-town.py` —
the only thing between a bad siting run and eight unusable worlds — ran only
when someone remembered to. A gate nobody executes is not a gate.

## The failure mode of all of this

Named in both reviews: bureaucratic false confidence. Contracts rot, opt-outs
become a junk drawer, fixtures overfit to wording, funnels get Goodharted, and
`unknown` spreads until callers suppress it to get work done.

Two things hold it off. The bar stays short — one live prompt fixture per
capability, one positive control per negative measurement, `unknown` in the
type, a funnel rather than a final count. And **every gate names the corpse**.
The moment one of these becomes a rule without a story, it becomes something to
route around.
