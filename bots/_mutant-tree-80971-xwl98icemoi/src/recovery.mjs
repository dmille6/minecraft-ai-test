// THE SHARED ESCAPE POSTCONDITION (Codex, 2026-09-13). One answer to "did the
// recovery work?" for every rung that moves a bot: the livelock breaker, the
// entombed and maroon climbs, the surface shaft. A relocation counts when the
// bot is somewhere else -- eight blocks sideways, or four blocks up -- and is
// DRY at the end: height gained into water, or a walk that ends underwater, is
// not an escape (hive-a-Delta reached y=63 swimming).
export const ESCAPE_MIN_MOVE = 8
export const ESCAPE_MIN_RISE = 4
export function escapedFrom (before, after, { minMove = ESCAPE_MIN_MOVE, minRise = ESCAPE_MIN_RISE } = {}) {
  if (!before || !after || after.wet) return false
  const flat = Math.hypot(after.x - before.x, after.z - before.z)
  if (flat >= minMove) return true
  return (after.y - before.y) >= minRise
}
