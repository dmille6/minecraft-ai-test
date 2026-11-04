BLOCKERS

1. **bots/src/wall.mjs:1167; bots/src/skills.mjs:21436** — Holds can be masked by ordinary project reservations. `tidyAvoid` returns `pathAvoid`’s `project` first, or an earlier `project:wall` zone; inwall then permits litter removal despite the hold. Reproduced with a retained foundation and retired cobblestone above it: `hold:true`, `avoid:"project"`, and the retired block appears in `surveyInwall.cut`, even with `noStair:()=>true`. **Fix:** include hold zones in the independent `reserved` predicate, checked before build exceptions and for every stair column; enforce this at execution too.

2. **bots/src/skills.mjs:20837,20872** — Release retries depend on another demolition visit, but completion removes that project's scheduled work. A crash after publishing completion but before release, or a failed release publication, leaves the hold indefinitely: the empty demolition record has neither damage nor upkeep, and a complete fallback produces no build order. **Fix:** explicitly schedule pending release while a complete demolition still has wall holds, or reconcile these holds through a regularly executed recovery path.

Reader selftest and mutant suite passed; the optional `storehub.mjs` copy check was skipped.
