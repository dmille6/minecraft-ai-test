codex
**3 BLOCKERS**

1. **A failed verification erases cargo that was actually withdrawn.**  
   [skills.mjs:18945](/Users/darrellmiller/Documents/.wt-storehubab/bots/src/skills.mjs:18945), `hubClerkOne`: when `withdrawVisit` returns without `verified`, `took` becomes `{}` and overwrites the persisted intent. `withdrawVisit` can return this after successful clicks—for example, if the subsequent server recount fails, a later transfer fails, or the cursor requires recovery. Already-withdrawn items then lose cargo protection and recovery. Concrete case: withdrawn stained glass remains in the bag after recount failure; the cargo file is cleared, and ordinary well disposal can throw it as `DECORATIONS`. Preserve the intent through uncertain transfers until the bag/cursor is reconciled.

2. **The clerk can throw kept decorations picked up while walking to the well.**  
   [skills.mjs:18960](/Users/darrellmiller/Documents/.wt-storehubab/bots/src/skills.mjs:18960), `hubClerkOne`, and `throwPhase` at line 9689: `keepAll` snapshots names before `disposeWell` walks to the well. The eventual throw plan reads the refreshed whole inventory using ordinary `isWellJunk`, without enforcing `HUB_THROWABLE`. Concrete case: a clerk carrying flint picks up stained glass en route; stained glass was absent from `keepAll`, so the clerk throws it. `listedOnly` disables swords/cobble/stock extras but still allows `DECORATIONS`. Enforce the cargo allowlist against the inventory used for the actual throw.

3. **Interrupted cargo cannot return to its source and can repeatedly monopolize upkeep.**  
   [skills.mjs:18917](/Users/darrellmiller/Documents/.wt-storehubab/bots/src/skills.mjs:18917), `hubClerkOne`: persisted cargo contains only counts. On recovery, `src` stays `null`, so the source-return branch at line 18993 cannot execute. Concrete case: abort after withdrawal; on the next visit, the section’s home, “more,” and overflow are full, while the original source still has room. Every recovery leaves the cargo held. `hubUpkeepDue` at line 18874 returns immediately for owed cargo, bypassing the visit gap, idle backoff, and clerk rest; `dueFirst` keeps selecting this fruitless upkeep ahead of sinks and ordinary upkeeps. Persist and restore the source, and back off unsuccessful recovery.

Read-only review; no files edited.
70,424
**3 BLOCKERS**

1. **A failed verification erases cargo that was actually withdrawn.**  
   [skills.mjs:18945](/Users/darrellmiller/Documents/.wt-storehubab/bots/src/skills.mjs:18945), `hubClerkOne`: when `withdrawVisit` returns without `verified`, `took` becomes `{}` and overwrites the persisted intent. `withdrawVisit` can return this after successful clicks—for example, if the subsequent server recount fails, a later transfer fails, or the cursor requires recovery. Already-withdrawn items then lose cargo protection and recovery. Concrete case: withdrawn stained glass remains in the bag after recount failure; the cargo file is cleared, and ordinary well disposal can throw it as `DECORATIONS`. Preserve the intent through uncertain transfers until the bag/cursor is reconciled.

2. **The clerk can throw kept decorations picked up while walking to the well.**  
   [skills.mjs:18960](/Users/darrellmiller/Documents/.wt-storehubab/bots/src/skills.mjs:18960), `hubClerkOne`, and `throwPhase` at line 9689: `keepAll` snapshots names before `disposeWell` walks to the well. The eventual throw plan reads the refreshed whole inventory using ordinary `isWellJunk`, without enforcing `HUB_THROWABLE`. Concrete case: a clerk carrying flint picks up stained glass en route; stained glass was absent from `keepAll`, so the clerk throws it. `listedOnly` disables swords/cobble/stock extras but still allows `DECORATIONS`. Enforce the cargo allowlist against the inventory used for the actual throw.

3. **Interrupted cargo cannot return to its source and can repeatedly monopolize upkeep.**  
   [skills.mjs:18917](/Users/darrellmiller/Documents/.wt-storehubab/bots/src/skills.mjs:18917), `hubClerkOne`: persisted cargo contains only counts. On recovery, `src` stays `null`, so the source-return branch at line 18993 cannot execute. Concrete case: abort after withdrawal; on the next visit, the section’s home, “more,” and overflow are full, while the original source still has room. Every recovery leaves the cargo held. `hubUpkeepDue` at line 18874 returns immediately for owed cargo, bypassing the visit gap, idle backoff, and clerk rest; `dueFirst` keeps selecting this fruitless upkeep ahead of sinks and ordinary upkeeps. Persist and restore the source, and back off unsuccessful recovery.

Read-only review; no files edited.
