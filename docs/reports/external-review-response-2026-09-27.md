# Three questions: an outside code review, the mineflayer upgrade, and Voyager's skill library

_written 2026-09-27 (date -u). Owner asked for both engines on all three. An external reviewer read the repo
at the live sha `268c074` and filed `docs/reports/external-repo-review-2026-09-27.md`; the earlier
greenfield brief is at `docs/reports/external-project-brief-2026-09-27.md`._

---

## PART 0 — THE ONE FINDING I HAVE ALREADY VERIFIED, AND IT IS REAL

The review claims a latent integration failure. **Confirmed, with a positive control:**

```
index.mjs:285   runner.arb.installActuatorGate(bot, { onRefuse: ... })
arbiter.mjs     defines acquire, act, ok, release, #check, #preempt  —  NOT installActuatorGate
config.mjs:155  arbiter: req('ARBITER', '0') === '1'        (off by default)

instantiated and probed:
  acquire  function | act function | ok function | release function     <- POSITIVE CONTROL
  installActuatorGate  undefined
  calling it -> TypeError: a.installActuatorGate is not a function
```
`grep -rn installActuatorGate src/ test/` finds **only** the call site. So **`ARBITER=1` crashes a
bot at startup** — and `config.mjs:153-154`'s own comment says *"the recovery ladder canary and the
corpus turn it on with ARBITER=1"*.

**Questions:** was the arbiter ever actually live, and if so how? Does any canary registration or
corpus env in the repo set `ARBITER=1`, and did that run produce rows? What is the minimum correct
fix — implement the gate, or delete the call and the config flag until the gate exists? And what
would the gate have to do to be worth having: the review's point is that *acquiring a grant does not
enforce ownership unless the actuator calls respect it*.

## PART 1 — JUDGE THE REVIEW ITSELF

It is better informed than the earlier brief: it read the code, pinned its claims to `268c074`, and
distinguished "latent in the enabled config" from "the deployed fleet is failing". Its five
priorities are: (1) finish movement ownership, (2) unify prerequisite planning across skills,
(3) correct the scope of learned refusals, (4) make model evaluation production-representative,
(5) separate endurance from generalization.

**What I want from you, and be adversarial about it:**
1. **Which of the five are real, which are already done, and which are wrong?** It says the README's
   persistence claim is stale — check. It says `model-eval.py` groups situations by coarse features
   and falls back to skill-without-args — check that against the file.
2. **Its priority 2 is the largest piece of work it proposes.** Is unified prerequisite planning the
   right next build, given what THIS session measured: 74.1% of craft failures target an item the bot
   already holds, the gate rejects 52.4% of them, held pickaxes sit at a median 1.7% durability while
   676 of 1,382 banked ones are above 50%, and `withdraw` refuses to walk home while `deposit` does?
   **Rank its priority 2 against the tool-keeper and withdraw work already specified.**
3. Its suggested experiment is "obtain an iron pickaxe, current agent vs unified planning, model and
   execution fixed, on unfamiliar seeds". Iron is 66% of our named ingredient gaps, `iron_ore`
   succeeds in 0.37% of 2,401 attempts with 84.7% tried at y>=48, and the bank holds 28 ingots.
   **Is that the right experiment, and is our harness able to run it?**
4. It recommends splitting `skills.mjs` (~7,000 lines) and `reflex.mjs` (~5,200) along execution
   boundaries. Say plainly whether that is worth any risk right now.
5. **What does it get WRONG about us?** It did not have this session's measurements.

## PART 2 — MINEFLAYER: UPGRADE OR STEAL?

We run **mineflayer 4.37.1** (vendored under `bots/node_modules`). The latest release is **4.39.0**
(2026-09-06). Paper servers are 1.21.11; bot envs declare `MINECRAFT_VERSION=1.21.8`.

**This is not academic — I worked around mineflayer behaviour today.** In 4.37.1's
`lib/plugins/inventory.js`, `transfer` lifts the source stack onto the cursor with
`clickWindow(sourceItem.slot, 0, 0)` (`:301`), and throws `destination full` from `clickDest`
(`:323`) **after** the lift; the cursor is only restored on the `count === 0` path (`:288`). So a
failed deposit leaves an item on the cursor, and closing the container drops it in the world. I have
just built a `returnCursor` workaround.

**Questions:**
1. **Read the 4.38.0 and 4.39.0 changelogs and diffs.** Is the cursor/transfer behaviour fixed
   upstream? If so, the workaround should be conditional or dropped.
2. **What would break?** A memory entry records `bucket` requiring >= 4.37.1, and
   `mineflayer-pathfinder` is coupled to the mineflayer version. `PATHFINDER_SCAFFOLD`,
   `setMovements`, `countScaffoldingItems` and the `lint:movement` baseline of 4 movement writers
   all sit on that seam.
3. **Is there anything in 4.38/4.39 we should STEAL rather than upgrade for** — a better container
   API, a physics fix, an event we are currently polling for?
4. **Recommend: upgrade, pin, or cherry-pick.** With the cost of being wrong, and the smallest test
   that would catch a regression. We have 203 test files and a sandbox server on .30:25599.

## PART 3 — VOYAGER'S REUSABLE VERIFIED SKILL LIBRARY

Both external documents point at Voyager's skill manager as the thing we lack: we select from a fixed
catalogue of hand-written skills; Voyager acquires and retrieves reusable behaviours.

**Our relevant structure:** `SKILLS` is a fixed dispatch table (`skills.mjs` ~6913) with declared
args; `actionKey` keeps only declared args; `admission.mjs` gates every proposal; `lessons.mjs`
persists failures and successes; `workorder.mjs` issues DETERMINISTIC orders that bypass the model
entirely — and that path is proven: the planting obligation shipped today landed **1,033 of 1,034**
placements. `ENABLE_AGENT_CODE_EXECUTION=false` in every env.

**Questions, and the third is the one I care most about:**
1. **Read Voyager's actual skill manager.** What does it store, how does it decide a skill is
   verified, and how does it retrieve? Separate the parts that need generated code from the parts
   that do not.
2. **Generated JavaScript is a non-starter here** — it would be an uncontrolled movement writer, and
   `lint:movement` exists precisely to keep that to 4 files. So: **what is the most valuable version
   of Voyager's idea that stores a VERIFIED SEQUENCE OF EXISTING SKILLS rather than new code?**
   Both external docs suggest exactly this. Design it.
3. **Is `workorder.mjs` already 80% of it?** A work order is a deterministic, verified,
   precondition-checked action. A learned skill would be a work-order TEMPLATE with prerequisites, a
   completion check and provenance. What is actually missing — storage, promotion criteria,
   retrieval, or the ability to represent a sequence at all?
4. **What is the promotion criterion?** This project's whole discipline is that a change is not real
   until it is read on the fleet. A skill promoted on one success is a superstition. Name the bar.
5. **What would it cost us if it went wrong**, given `learned_avoid` blacklisted the ladder on 70 of
   80 bots and the hive stores accumulate everything?

## Rules
- Every negative claim carries a positive control, **from a different instrument than the claim**.
- `file:line` for repo claims; a real URL or changelog entry for external ones.
- Distinguish measured / source-verified / inferred / external-behaviour.
- Rank by what a wrong decision costs.
- Use web search for PART 2 and PART 3; do not rely on training memory for library internals.
- End with ONE sentence: the single most valuable thing from all three parts, and what it would cost.
