**BLOCKER — Drawn materials can be stranded with no recovery path.** In [skills.mjs:19370](/Users/darrellmiller/Documents/.wt-enchantshop/bots/src/skills.mjs:19370), a partial withdrawal returns before banking; aborts also bypass banking at line 19411. Even ordinary craft failures or refused placements skip banking when ≤30 seconds remain (line 19420), while placement can run until only 20 seconds remain (line 19402). No persistent draw balance schedules recovery. Later plans exclude bag iron and diamonds: verified that **31 bag iron + 64 town iron still reports 31 iron short**. This can strand the furnishing’s inputs and prevent completion. Track outstanding cargo across exits and retry banking independently of furnishing eligibility.

- **NOT BLOCKER:** Unloaded or blocked slots produce `why=placed`, prematurely closing furnishing requests ([enchantshop.mjs:246](/Users/darrellmiller/Documents/.wt-enchantshop/bots/src/enchantshop.mjs:246)).
- **NOT BLOCKER:** A malformed `short=broken` row clears existing requests for that furnishing instead of being ignored; reproduced without a crash ([requests.mjs:87](/Users/darrellmiller/Documents/.wt-enchantshop/bots/src/requests.mjs:87)).

No additional blockers found in placement geometry, waiting/upkeep wiring, copper/kit handling, or siting. Read-only review and in-memory checks; no files edited. Full tests were not run because they write files.

VERDICT: BLOCK (1 blockers)
