BLOCKERS

- `bots/src/skills.mjs:20766`: The new apron guard inherits `shopCtx()`’s switch-dependent `z0` (line 17602). With an existing monument and `MONUMENT=off`, `z0` becomes null; `projectsGuarded()` also omits the monument, removing its record protections. Extension siting can therefore allocate plots inside its apron. The new test supplies `z0` directly and misses this live path. Fix: read and guard existing monument records regardless of the build switch, and add a regression covering `MONUMENT=off`.
