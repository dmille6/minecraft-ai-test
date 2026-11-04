BLOCKER: Lost-release recovery still depends on `WALLDEMO` remaining enabled. `projectHeads()` reads only `projectsGuarded()`, which omits `walldemo` when disabled. After completion with a lost release, disabling demolition leaves the wall’s hold active indefinitely because `wallAsHeld` never sees the completed head. Read the demolition head independently of its switch, or always include it in guarded heads.

Confirmed that omission locally. The masked-foundation repro passes; all 35 wallext tests pass.
