# ADR-0002: Cognitive layer design (pass 2)

**Date:** 2026-08-05
**Status:** Accepted
**Builds on:** ADR-0001, and the working deterministic harness in `bots/`

Reached the same way as ADR-0001 — Claude, ChatGPT (`codex`), and local
`qwen3.5:122b-a10b` analysed the same brief independently. Convergence was
high; the disagreements and each analysis's unique contributions are recorded.

---

## The shape of the thing

The LLM's job is **to choose one skill and its arguments**. That is all.

It does not write code, does not own a multi-step plan, does not decide when
it runs, and its output is not authoritative — it is a *proposal* that a
deterministic gate may reject. This follows directly from the handoff doc's
priority order (§25): reliability before intelligence, deterministic skills
before generated code.

```
milestone controller  ──> current task, completion predicates   (deterministic)
        │
        ▼
prompt assembler ─────> compressed state, token-sliced, sentinel-tagged
        │
        ▼
    LLM (Ollama) ─────> structured JSON: {skill, args, reason}
        │
        ▼
admission layer ──────> schema? policy? cooldown? milestone-relevant?  (deterministic)
        │
        ▼
      runner ─────────> executes one skill, cancellable        (already built)
        │
        ▼
   reflex layer ──────> may PREEMPT at any point               (already built)
```

Everything below the LLM box already exists and is tested. This ADR is about
the three boxes around it.

## D1 — Tool-call mechanism: **JSON-schema structured output**

Use Ollama's `format: <json schema>`, not native `tools`, and never
"respond with JSON" prompting.

Unanimous. Native tool-calling support varies by model *template*, not just by
model, so it fails inconsistently across a heterogeneous set. Plain prompting
produces wrappers, prose preambles, and markdown fences at a rate that makes
parsing a permanent tax.

**On invalid output: one repair retry**, containing only the validation error
and the schema — then give up, log `schema_valid: false`, and execute
**nothing**. Never best-effort parse a malformed response into an action.
A rejected decision is a datum; a guessed action is a bug with a plausible
alibi.

## D2 — Prompt content: compressed state, **2–4k tokens**

In: current task and completion predicate · health, hunger, position,
dimension, day · inventory summary · nearby useful blocks and hazards · known
locations (home, chest, bed) · last 5–10 event outcomes · the skill list with
exact argument schemas · hard policies.

Out: raw block dumps, full chat history, full inventory NBT, prior
natural-language reasoning, anything from the JSONL history.

**Slice tokens client-side before sending.** Ollama silently truncates at
`num_ctx`, and a truncated prompt does not error — it produces a model that
looks stupid because it has been blindfolded. Set `num_ctx` explicitly *and*
enforce the budget ourselves, dropping oldest events first and never the
current task.

**Truncation sentinel** *(contributed by the ChatGPT analysis)*: end the prompt
with a short random token and require the model to echo it in a `saw_end`
field. If it comes back wrong or missing, the prompt was truncated — detected
directly instead of inferred from bad behaviour weeks later.

## D3 — Decision loop: **one next action**, controller-held plan

The LLM chooses the next skill. The **milestone plan lives in deterministic
code**, not in the model.

Unanimous, and it is the most important decision here. An LLM holding a plan
across calls has no mechanism to keep it consistent; a controller with
completion predicates does.

Anti-oscillation, all deterministic:
- cooldown on a skill+args pair that just failed
- dedupe identical tool calls within a recent window
- progress counters per milestone (food gathered, shelter built, tools crafted)
- reject actions that do not advance the active milestone unless a reflex or
  discovery trigger justifies the switch

Triggered by events only — `skill_complete`, `skill_failed`, `discovery`,
`chat`, `resource_shortage`, `death`, `stuck`, `startup`. Never per tick
(handoff doc §9.3).

## D4 — Working memory: **structured state + short event window**

Facts update in place; events expire. No growing prose summaries.

Carried forward: current milestone and subtask · known locations · resource
needs · recent failures with decaying cooldowns · last ≤20 events.

Both analyses independently rejected summarisation as the primary mechanism,
for the same reason: structured memory is bounded *by schema*, so a 4-hour
soak cannot grow its own context until it truncates. Summaries bloat
unpredictably and fail exactly when the run gets interesting.

Accepted risk: soft context is lost. That is a good trade for stable behaviour.

## D5 — Model: **`qwen2.5:14b-instruct` on the RTX 5080** first

Both analyses picked the 14B on the GPU over the big models on the Studio,
for the reason established in ADR-0001 D3: agent prompts are long, prefill is
compute-bound, and Apple Silicon is comparatively weak at prefill. 81 ms of
network latency is noise next to that.

*(qwen suggested `qwen2.5-coder:14b` instead, arguing coder tunes emit better
structured JSON. Unresolved and cheap to test — it is one env var.)*

**Deciding metric:** milestone steps completed per wall-clock hour, with
invalid schema, rejected actions, and repeated failures counted as blockers.
`schema_valid` rate alone is necessary but not sufficient — a model can emit
perfect JSON and still choose badly.

The A/B is nearly free because every decision is logged: replay recorded
states against a second model offline, compare, and only then run a live soak.

## D6 — Goals: **human-set milestone, controller-owned task queue**

The human sets "survive three nights: gather food, build shelter, craft stone
tools." The controller decomposes that into ordered tasks with completion
predicates. The LLM picks the next skill *within* the active task.

Unanimous. The LLM never redefines success.

## The admission layer

*(Contributed by the ChatGPT analysis; neither of the others raised it.)*

A deterministic gate between the model and the runner. Even schema-valid output
is checked against: policy (no code execution, no destructive verbs), cooldowns,
world constraints (inside the border, target reachable), and milestone
relevance.

This is what makes the model advisory rather than authoritative, and it is the
cleanest expression of "reliability before intelligence" in the whole design.
Every rejection is logged with a reason, which turns "the model is unreliable"
into a distribution over specific, fixable causes.

## Also worth doing

- **Log reflex/LLM conflicts explicitly** *(qwen)* — when a reflex preempts a
  skill the model just chose, that is a distinct, interesting event, not a
  generic abort.
- Keep `ENABLE_AGENT_CODE_EXECUTION=false`. Not revisited until the
  deterministic skill set is proven (handoff doc §18).

## Open

- `qwen2.5:14b-instruct` vs `qwen2.5-coder:14b` for structured output.
- Whether the 122B MoE's ~10B active parameters make it viable in the hot path
  despite Apple prefill. Measure; do not argue.
