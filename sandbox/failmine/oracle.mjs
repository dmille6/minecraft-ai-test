// THE SCENE VERDICT, as a pure function (CLAUDE.md "extract the decision"; Claude r1 P1 / Codex r1 P1 on scene-e2e.mjs).
// The driver gathers observations; this decides. An absence never reads as a result: a bot that was not observed, whose
// process exited, or whose deaths the two independent counters disagree on, is NO-RUN (pass null, matched null), which
// library-ab.mjs scores INVALID.
//
// obs = {
//   deathsLog:    `_death` rows in the bot's own log                       (number)
//   deathsScore:  the server's deathCount scoreboard for the bot, or null  (independent of the bot's logging)
//   deathFamily:  failmine.py's family for the first death message, or null
//   deathCell:    the first death's cell in FLEET coordinates, or null
//   childExited:  the bot process ended before the run did
//   maxGapS:      the longest stretch the bot was not observed (absent from the server or no position)
//   lastSeenAgoS: seconds between the last observation and the verdict
//   endHealth:    health at the last observation
//   outHeldS:     seconds the bot has been continuously out of the trap at the end (escape)
//   inArenaEnd:   the last observation lies inside the arena
// }
// expect = { deathCell: the fleet death's cell, or null }; oracle = the scene's.
export const MAX_GAP_S = 10
export const MAX_STALE_S = 8
export const DEATH_MATCH_BLOCKS = 6        // the cluster link distance (failmine.py DEATH_LINK_H)

export function decide (oracle, obs, expect = {}) {
  const noRun = why => ({ outcome: `no-run: ${why}`, pass: null, matched_fleet: null })
  if (obs.deathsScore == null) return noRun('the death counter could not be read')
  if (obs.deathsScore !== obs.deathsLog) return noRun(`the death counter says ${obs.deathsScore}, the bot's log ${obs.deathsLog}`)
  if (obs.deathsLog > 0) {
    if (!obs.deathFamily) return noRun('a death without a readable message')
    const near = expect.deathCell && obs.deathCell
      ? Math.hypot(obs.deathCell[0] - expect.deathCell[0], obs.deathCell[2] - expect.deathCell[2]) <= DEATH_MATCH_BLOCKS &&
        Math.abs(obs.deathCell[1] - expect.deathCell[1]) <= DEATH_MATCH_BLOCKS
      : false
    const matched = oracle.type === 'survive' && (oracle.fail_families || []).includes(obs.deathFamily) && near
    return { outcome: `died:${obs.deathFamily}${near ? '' : ' (elsewhere)'}`, pass: false, matched_fleet: matched }
  }
  if (obs.childExited) return noRun('the bot process exited')
  if (obs.maxGapS > MAX_GAP_S) return noRun(`the bot went unobserved for ${obs.maxGapS.toFixed(0)} s`)
  if (obs.lastSeenAgoS > MAX_STALE_S || !(obs.endHealth > 0)) return noRun('no fresh live observation at the end')
  if (oracle.type === 'escape') {
    if (obs.outHeldS >= (oracle.hold_s ?? 20) && obs.inArenaEnd) return { outcome: 'escaped', pass: true, matched_fleet: false }
    if (obs.outHeldS > 0) return { outcome: 'out-not-held', pass: false, matched_fleet: false }
    return { outcome: 'stayed', pass: false, matched_fleet: true }
  }
  if (oracle.type === 'survive') return { outcome: 'survived', pass: true, matched_fleet: false }
  return noRun(`unknown oracle ${oracle.type}`)
}

// THE LIBRARY GATE'S VERDICT for one (scene, start): bs / cs = the base and candidate driver results of one session.
// The base must reproduce the fleet's failure in >= 2 runs and >= 2 of every 3 completed ones, never passing; the
// candidate must complete and pass EVERY run. Fewer than MIN_REPEATS runs of either build is never a verdict (Codex r2 P2).
export const MIN_REPEATS = 3
export function abVerdict (bs, cs) {
  const bDone = bs.filter(b => b.matched_fleet === true || b.matched_fleet === false)
  const bm = bDone.filter(b => b.matched_fleet === true).length
  const reproduced = bs.length >= MIN_REPEATS && bm >= 2 && bm * 3 >= bDone.length * 2 && !bs.some(b => b.pass === true)
  const cDone = cs.filter(c => c.pass === true || c.pass === false)
  const verdict = !reproduced || cs.length < MIN_REPEATS || cDone.length < cs.length ? 'INVALID' : cs.every(c => c.pass === true) ? 'PASS' : 'FAIL'
  return { verdict, reproduced, bm, bDone: bDone.length }
}

// THE FIDELITY PROBES: the scene's named checks and every `every`-th cell of the cut, each as its FULL block state
// (Codex r2 P2 / Claude r2 P3: a name-only sample cannot see a water level, waterlogging or facing).
export function fidelityProbes (S, BX, BZ, every = 37) {
  const [OX, OY] = S.cells.origin, [SX, , SZ] = S.cells.size
  const DX = BX - OX, DZ = BZ - S.cells.origin[2]
  const flat = []
  for (let k = 0; k < S.cells.rle.length; k += 2) for (let n = 0; n < S.cells.rle[k + 1]; n++) flat.push(S.cells.rle[k])
  const probes = S.checks.map(k => ({ x: k.at[0] + DX, y: k.at[1], z: k.at[2] + DZ, is: k.is, check: true }))
  for (let i = 0; i < flat.length; i += every) {
    const x = i % SX, z = Math.floor(i / SX) % SZ, y = Math.floor(i / (SX * SZ))
    probes.push({ x: BX + x, y: OY + y, z: BZ + z, is: S.cells.palette[flat[i]] })
  }
  return probes
}
