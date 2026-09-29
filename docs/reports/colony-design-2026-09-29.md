# Colony layer (sharing, ledger, coordination, chat, mayor) — two-engine analysis, 2026-09-29

Owner: "bots within the same world should be able to share information... coordination... chat between bots...
a log of what materials are in the chests and their location... a director/mayor that directs or incentivizes
priorities. Use both engines to think and analyze this approach." Analysis only; nothing built.

## Where both engines agree
1. **Coordination is not the colony's problem yet — access is.** Only 3.5% of gathers had a same-world peer on the
   same block type (Claude); contended gathers failed LESS (56.6% vs 62.4%). The failures are bots lacking basics
   that sit in their own world's chests: 2,444 craft missing_ingredients in ~22 h, 1,716 of them stone_pickaxe,
   95% of those bots already holding 2+ sticks — **3 cobblestone short**, while the bank holds tens of thousands.
2. **First: a chest ledger, observe-only** — every container open records a full snapshot (location, contents,
   double-chest identity, observer, time). A ledger hint is only ever POSITIVE ("3 cobble at x,z, 14 min ago");
   "ledger says zero" never refuses — the live window always wins. Concurrency matters: worldfacts.mjs's
   read-merge-rename has no lock (lost updates). Claude: one file per container, newest snapshot wins. Codex:
   one SQLite file per world with transactions and short container leases. Either; pick at build time.
3. **Second: deterministic retrieval** — craft/withdraw use the ledger: a bounded withdraw -> verify -> retry-craft
   prerequisite (a remedy the bot EXECUTES, not advice). Needs hygiene (free slots) and withdraw-home (the walk).
4. **Sharing: end the retired arm split, as its own step** — every world shares the world model (hazards, deaths,
   resources, stations, the ledger); lessons/vetoes stay PRIVATE (hive pools ran 109-185 learned_avoid vetoes per
   1k decisions vs 3-16 elsewhere). Re-measure the between-world null after; never confound with another change.
5. **Mayor: deterministic "colony needs" scoring first**, from the ledger + world facts + roster (e.g. "0 ingots,
   6 raw iron banked, cobble surplus"). It REORDERS legal options (milestone choice, workorder.mjs orderFor) and
   NEVER vetoes one (CLAUDE.md refusal-composition rule). An LLM mayor only later, in shadow mode.
6. **Chat: keep it outbound (human-visible narration).** The receiver listens on 'chat', which never fires here;
   if fixed: listen on 'message', parse "[Not Secure] <name> ...", dedupe against the file, and FIRST lock down
   commands.mjs (it accepts !stop/!goto from any name). No free-text LLM-to-LLM chat: MineCollab shows success
   falling from ~90% (2 agents) to <30% (4-5) when agents must negotiate; small models drift to peers' errors;
   prompt injection spreads between agents.
7. **Claims/leases later, with the ore tunnel** (every bot sees the same iron): soft leases (TTL, heartbeat,
   name tie-break) that only RE-RANK targets, never remove the last candidate, never apply in escape paths.
8. **Canary unit = a WORLD** (all 5 bots), world-level DiD; one world at a time establishes correctness.

## Phased plan (after the current queue)
1. Ledger, observe-only (can ride with withdraw-home): coverage per world, agreement with an RCON slot read.
2. Craft/withdraw source ingredients from the bank: share of trapped bots holding a usable pickaxe within T h
   (world DiD); cobble-gap missing_ingredients/bot-h; successful withdraws.
3. Unify sharing (own step), then the rule-based needs vector as a tie-break; then bank-first requests; claims with the ore tunnel.

Prior art read (Claude): MineCollab arxiv 2504.17950; Project Sid/PIANO 2411.00114; TeamCraft 2412.05255 (central
assignment 64% vs 20%); VillagerAgent 2406.05720; MineLand 2403.19267; mindcraft conversation.js; mineflayer chat.js.

## Codex report, verbatim
**Recommendation: start with shared inventory observations and deterministic retrieval; add a lightweight mayor after bots can reliably obtain and use materials.** Coordination cannot substitute for the queued tool, inventory and ore-access fixes.

Read-only analysis; nothing edited, committed or pushed. I checked `80b3bbd`, matching local source, reports and supplied data. **Fresh two-engine review remains incomplete:** Claude returned no review before I stopped the unresponsive call. Recorded two-engine findings inform this analysis; recommendations below are my synthesis.

1. **Verified evidence and its limits**

   The supplied craft/deposit export contains **7,996 rows, 80 bots, 21h55m and three builds**—consistent with [STATE.md:244](/Users/darrellmiller/Documents/code-minecraft-ai/docs/reports/STATE.md:244). I re-counted **2,444 missing-ingredient failures**, including **1,716 stone-pickaxe failures**. Thus “2,444/day” is an approximate summary, not this export’s denominator.

   Withdraw selects a nearby container without knowing its contents ([skills.mjs:3764](/Users/darrellmiller/Documents/code-minecraft-ai/bots/src/skills.mjs:3764)); the reported rate is **0.45 attempts/bot-day** ([STATE.md:327](/Users/darrellmiller/Documents/code-minecraft-ai/docs/reports/STATE.md:327)). These establish opportunity, not how many failures accessible chest stock could resolve.

   Shared facts already affect behavior: peer “unreachable” reports reduce milestone failure budgets from **25 to 8** ([milestones.mjs:845](/Users/darrellmiller/Documents/code-minecraft-ai/bots/src/milestones.mjs:845)). Sharing is therefore more than prompt enrichment.

2. **Sharing policy — recommendation**

   Give every world the same eventual policy: share ore/tree sightings, container observations, stations, hazards, death sites and completed physical work. Record world identity, dimension, reset epoch, coordinates, reporter and observation time. Mark depletion/destruction explicitly; expire uncertain observations.

   Keep personal milestones, failure counters and learned vetoes private. Share successful procedures only as contextual evidence, without automatic policy adoption. The memory analysis explicitly leaves pooled-threshold acceleration as an alternative to “belief convergence” ([hive-effect-may-be-exposure.md:26](/Users/darrellmiller/.claude/projects/-Users-darrellmiller-Documents-code-minecraft-ai/memory/hive-effect-may-be-exposure.md:26)).

   **End the retired arm split gradually, as a separate intervention.** Decouple world identity from legacy memory-pool names. Preserve old stores for analysis; do not seed private stores with pooled veto counts. Standardization sacrifices continuing arm comparisons, but preserves measurement through randomized world-level feature flags and fresh baselines. Changing sharing alongside retrieval would confound their effects.

3. **Chest ledger — architecture and first payoff**

   Recommend one transactional SQLite file per world, accessed through a small colony module. The existing read–modify–rename writer has no interprocess exclusion ([worldfacts.mjs:85](/Users/darrellmiller/Documents/code-minecraft-ai/bots/src/worldfacts.mjs:85)); atomic rename prevents partial files, **not lost concurrent updates**. SQLite serializes writes through transactions ([SQLite documentation](https://www.sqlite.org/isolation.html)).

   Each container record should contain canonical identity—including both double-chest halves—location, type, slots, item/component identity, tool durability, capacity, observer, observation time and revision. Observe every successful open, confirmed slot change and final readable window state. Failed opens mean “unknown/inaccessible,” not “empty.”

   Serialize cooperative access with short container leases and fencing generations; reject delayed writes from expired sessions. Never hold a database transaction during travel or Minecraft operations. Players remain outside those leases: the live window always wins. A failed transfer invalidates the expectation and triggers reconciliation.

   Withdraw ranks matching stock by freshness, usable quantity and travel cost, then rechecks on arrival. Deposit ranks actual compatible capacity under the bank’s limits; the ledger cannot itself solve saturation or placement failures.

   Craft should check recipe alternatives and intermediate ingredients, not merely its printed root gap. Return structured guidance such as “3 sticks last observed at x=…, y=…, z=…, 2 minutes ago.” More importantly, schedule a bounded **withdraw → verify → retry craft** prerequisite. Keep prompt additions to a few task-relevant lines.

4. **Coordination and mayor — recommendation**

   Highest-value initial coordination is **bank-backed requests**, not fixed roles: `{item, quantity, requester, deadline, purpose}`. Fulfill from storage first; otherwise a capable peer claims production and deposits the result. Completion requires observed receipt, not an accepted request.

   Add ore/tree leases only after measuring duplicate pursuit. Use target/cluster identity, atomic acquisition, expiry, progress-based renewal and release on completion, death or disconnect. Avoid nested claims and circular waits. Claims reserve work, never corridors or escape resources; emergency recovery supersedes them. Unavailable targets produce another executable choice, not indefinite waiting.

   Start the mayor as deterministic demand scoring: tool shortages, ingredient deficits, storage capacity and reachable ore. Assign temporary jobs according to capability, distance and inventory room; “two miners, one smelter” must be conditional, not a standing quota.

   Plug priorities into milestone selection, and executable proposals into [workorder.mjs:90](/Users/darrellmiller/Documents/code-minecraft-ai/bots/src/workorder.mjs:90). Existing proposals already pass normal admission ([cognitive.mjs:714](/Users/darrellmiller/Documents/code-minecraft-ai/bots/src/cognitive.mjs:714)). Add no colony veto. On coordinator failure, retain autonomous behavior. Test composed request/admission/recovery chains, as required by [CLAUDE.md:145](/Users/darrellmiller/Documents/code-minecraft-ai/CLAUDE.md:145).

   Defer bidding: it adds valuation and starvation problems without measured contention. A larger, slower LLM could later propose bounded priorities; compare its outcomes against deterministic scoring.

5. **Chat — repair transport, preserve the boundary**

   The receiver uses `chat` ([comms.mjs:172](/Users/darrellmiller/Documents/code-minecraft-ai/bots/src/comms.mjs:172)). Use `message`, rendering its ChatMessage to text, with an anchored parser for optional `[Not Secure] ` followed by `<name> …`. Mineflayer documents custom-format parsing requirements ([FAQ](https://github.com/PrismarineJS/mineflayer/blob/master/docs/FAQ.md)).

   Validate exact world roster, schema, coordinates and event IDs; deduplicate file/chat echoes. Rendered names alone are not authentication. Unauthenticated chat must not mutate authoritative state.

   On this single host, use the shared store for facts, requests and leases; chat supplies visible announcements. Show the LLM bounded structured summaries only. Free-text peer negotiation has no demonstrated payoff here.

6. **First changes and measurement**

   After the active canary and queued last-swing, hygiene and withdraw-home fixes:

   - **Ledger observation:** measure coverage and agreement with independent live-window reads, including concurrent opens, crashes and double chests.
   - **Ingredient retrieval:** measure verified useful withdrawals, subsequent completed crafts, missing-ingredient failures/bot-hour and usable-tool hours. Bank fixes enable sustainable capacity; retrieval can use existing stock.
   - **Bank-first requests, then mayor:** after reliable ore tunneling, measure request-to-receipt latency, iron ingots/usable picks per world-hour and wasted travel.

   Canary **one randomly selected eligible world—all five bots—at a time**. Use world-level DiD, not 80 independent bots. Read at +180/+360, extending for exposure; at today’s rate, five bots produce only about **0.56 withdraw attempts in six hours**. One world establishes correctness, not general effectiveness: replicate sequentially. Track inventory congestion, livelock, skips and safety harms; count completed transfers and production, never announcements or assignments.
