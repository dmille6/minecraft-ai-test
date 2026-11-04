BLOCKERS

- **bots/src/skills.mjs:20812–20820 — retirement does not drain in-flight wall repairs.** A repair can pass its generation fence and send a placement before retirement, while its block update arrives afterward. `demoRecord` reads air, omits that retired cell, and can publish demolition as complete. The delayed placement then restores an old-wall block permanently: neither the retired wall nor the demolition owns its removal. Reproduced with the actual helpers: one retired cell, zero clears, cobblestone standing, `demoLeft=0`. **Fix:** fence new repair sends and drain outstanding wall placement intents before taking the demolition snapshot; coordinate retirement with the wall’s placement mutex/barrier. Add a delayed-placement regression test.

Notes:
- Reader selftest passes, including the storehub copy check when configured.
- All supplied reader mutants are killed; all eight WD1 mutants fail on their intended assertions.
- No files outside this directory were edited.
