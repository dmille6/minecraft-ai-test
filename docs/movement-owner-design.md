# One movement owner — design draft v1 (13 Sep 2026, for review by both engines before code)

Reliability program step 2. Today the body is driven by skills, five reflexes (air/drowning, entombed, marooned,
stuck, livelock), the recovery ladder, and the admission gate, coordinated through flags (`escaping`, `marooned`,
`climbing`), body claims (`claimBody('climb'|'stair'|'dig'|'pillar')`) and fields on the bot object. Every trap this
month was two correct guards meeting where the bot had no legal move. This design gives the body one owner.

## The machine

One object, `MovementOwner`, owns every actuator call: pathfinder goals, `bot.dig`, `bot.placeBlock`, control
states, `look`. Nothing else calls them. States:

| State | Meaning | Enters from | Leaves to |
|---|---|---|---|
| WORK | a skill's movement request is being executed (walk / dig / place legs) | ASSESS when the request is admitted | ASSESS on completion, failure, deadline, or hazard |
| ASSESS | the body is still; the owner decides what happens next from the world + the request | every state | WORK, ESCAPE, RETURN, SAFE-HOLD |
| ESCAPE | the bot is in a recognised trap class and a recovery rung is running | ASSESS | ASSESS (postcondition met or rung ended) |
| RETURN | no work is pending and the bot is walking back to a known safe place (home/station) | ASSESS | ASSESS |
| SAFE-HOLD | nothing executable is safe; the body is held still with a named reason and a terminal record | ASSESS | ASSESS only when the world changes (a displacement by the shared postcondition, or a new request that is admitted) |

Transitions are the only place policy lives. Every transition carries: a reason string, the budget it was given
(deadline ms, attempt count, block reserve), and the postcondition that ends it. The shared postcondition is
`escapedFrom(before, after)` (recovery.mjs): eight blocks sideways or four up, and dry.

## Trap classes ESCAPE knows (each a rung, each with its captured fixture)

| Class | Detection (pure, from the world) | Rung | Fixture |
|---|---|---|---|
| no air | head cell is liquid | air route: surface swim or dig up (existing air reflex, as a rung) | flooded pocket (Bravo) |
| entombed | ceiling solid, ≥ 3 of 4 head cardinals solid, terrain higher within 4 | measured pillar-out (climbNeedAbove), then stair ramp, then harvest underfoot | Delta, Bravo |
| marooned | no path can start, open column above | measured pillar-out | hive-b-echo-sealed-pocket |
| flooded pocket | feet in water, floor within 6 below, opening above | sink-and-pillar (raw dig/place; design under review) | Bravo |
| ledge / disconnected | path fails with ≤ 1 visited node, dry | bridge/dig rung under the ascent profile with the block reserve | synthetic island (not a trap today), Comet-class capture when one appears |
| livelock | identical action refused 4× | relocation ladder: walk → dig → latch → exhausted | corpus, descriptive |

ESCAPE runs at most one rung at a time, with the rung's own budget, and records `escape_rung` rows (class, rung,
budget, outcome, blocks spent). Exhaustion is terminal until displacement (as in the ladder).

## Legs (WORK) carry navigation discipline

Every leg the owner executes has an expected cost from the planner and:
- an overrun budget: cancel at 2× the expected duration or 10 s without progress (Baritone `movementTimeoutTicks`);
- a re-plan trigger when the remaining cost rises by 50% (`maxCostIncrease`);
- a look-ahead stop before any step that became impossible (`costVerificationLookahead`);
- a refusal before entry if the leg has no route or the bot lacks the escape resources the leg's terrain needs
  (blocks for a bridge, a pickaxe for a dig).

Guards from the survey: stop when the dig target is unharvestable with the held tool; open doors/gates after
1.2 s stationary; stop a descent at liquid or a void below.

## What the skills and reflexes become

- Skills request movement (`owner.request({kind:'walk'|'dig'|'place', goal, budget, why})`) and await an
  outcome; they never touch actuators. The gather/mine/craft cycle is unchanged except for this call.
- The five reflexes become detectors (pure predicates over the world) that ASSESS consults; their bodies become
  rungs. Body claims disappear: the owner is the claim.
- The admission gate keeps its role (what may be proposed); the owner decides what may move.

## Budgets and records

One inventory budget per ESCAPE episode (blocks reserve = the entombment climb's need + 2); one deadline per rung;
one terminal record per episode. `escape_rung`, `movement_leg` (with expected vs actual cost) and `safe_hold`
rows are the new telemetry; the digest's trapped-bot list reads `safe_hold` and `recovery_exhausted`.

## Migration (sandbox-first)

1. Build the owner beside the existing code with a feature flag; route ONLY the recovery ladder and the entombed /
   marooned climbs through it first (they already share the postcondition). Corpus: control vs candidate.
2. Route the air reflex and the flooded-pocket rung. Corpus.
3. Route skill legs (walk/dig/place) with the navigation discipline. Corpus + a 24-h unattended sandbox run.
4. Safety canary on the fleet (registration in the v8 shape: KEEP = safe), staged rollout.

## Open questions for the reviewers

1. Does a single owner with ASSESS between every leg cost too much latency for gather (legs are ~1–5 s)?
2. Should RETURN be a state or a WORK request from the skill layer?
3. Is "exhaustion terminal until displacement" right for the whole machine, or only for the livelock rung?
4. What must SAFE-HOLD do when holding still is itself lethal (lava rising, air running out)?
