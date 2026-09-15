// LAVA PREVENTION, pure parts (docs/lava-prevention.md v3; two Codex passes). Three guards over blocks the bot can
// already read; nothing here touches the bot. `at(x, y, z)` returns a block ({ name, boundingBox }) or null/undefined
// for an UNKNOWN (unloaded) cell -- unknown is unsafe everywhere below.
export const LAVA_LIKE = new Set(['lava', 'flowing_lava', 'fire', 'soul_fire', 'magma_block', 'campfire', 'soul_campfire'])
const isLava = b => !!b && LAVA_LIKE.has(b.name)
const solid = b => !!b && b.boundingBox === 'block'
const passable = b => !!b && b.boundingBox !== 'block' && !isLava(b)

/** One feet-level cell is lava-safe when it is known, has nothing lava-like within 1 block horizontally, and nothing lava-like in the 3 cells below. */
export function cellLavaSafe (at, x, y, z) {
  for (const [dx, dz] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) { const b = at(x + dx, y, z + dz); if (b == null || isLava(b)) return { safe: false, why: b == null ? 'unknown' : 'lava beside', cell: [x + dx, y, z + dz] } }
  for (let dy = 1; dy <= 3; dy++) { const b = at(x, y - dy, z); if (b == null) return { safe: false, why: 'unknown below', cell: [x, y - dy, z] }; if (isLava(b)) return { safe: false, why: 'lava below', cell: [x, y - dy, z] }; if (solid(b)) break }
  return { safe: true }
}
/** Supported: a solid block within 3 below the feet cell with nothing lava-like in between. */
export function cellSupported (at, x, y, z) {
  for (let dy = 1; dy <= 3; dy++) { const b = at(x, y - dy, z); if (b == null) return false; if (isLava(b)) return false; if (solid(b)) return true }
  return false
}
const isWater = b => /water|kelp|seagrass|bubble_column/.test(b?.name || '')
/**
 * The drop under a route sample, judged for LAVA ONLY. The first fleet canary (-08, 2026-09-15) refused 124 legs in
 * 45 min as "unsupported step" against 10 for lava: every swim node (water is not solid) and every drop of more
 * than three blocks failed cellSupported, and each refusal cleared the goal. Water is terrain and a drop is the
 * pathfinder's business; this guard's business is lava. So: below the cell, scan up to `reach` cells -- solid or
 * water ends the scan as safe; lava is unsafe; unknown within 3 is unsafe (cellLavaSafe already says so), unknown
 * deeper is out of the loaded world and not this guard's call; nothing found within reach is safe too.
 */
export function dropLavaSafe (at, x, y, z, { reach = 12 } = {}) {
  for (let dy = 1; dy <= reach; dy++) {
    const b = at(x, y - dy, z)
    if (b == null) return dy <= 3 ? { safe: false, why: 'unknown below', cell: [x, y - dy, z] } : { safe: true }
    if (isLava(b)) return { safe: false, why: 'lava below', cell: [x, y - dy, z] }
    // The falling body is 0.6 wide: lava BESIDE a cell it passes through burns it too (Codex pass 2). Four cardinals per depth.
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const s = at(x + dx, y - dy, z + dz); if (isLava(s)) return { safe: false, why: 'lava beside the drop', cell: [x + dx, y - dy, z + dz] } }
    // Water does NOT end the scan: a bubble column over magma pulls the bot down onto it (placebo-b-Echo, 2026-09-14
    // 21:18, the pre-restart -07 death). Only a solid landing does, and the landing itself must be lava-free beside.
    if (solid(b)) return dy > 1 ? cellLavaSafe(at, x, y - dy + 1, z) : { safe: true }
  }
  return { safe: true }   // no landing within reach: the pathfinder never plans a drop this deep; a chasm is not this guard's call
}
/**
 * Guard 1: the EXECUTED route. `nodes` are the pathfinder's path nodes ({x,y,z}, feet positions) from the bot to the
 * goal. Every 0.5-block sample along each segment must be known, lava-safe (3x3 around it) and free of lava in the
 * drop below it (dropLavaSafe: water and plain drops are terrain); a failing sample refuses the leg with its
 * coordinates. Cost: ~6 reads per sample.
 */
export function corridorSafe (at, nodes, { step = 0.5 } = {}) {
  if (!nodes || nodes.length < 2) return { safe: true, samples: 0 }
  let samples = 0
  for (let i = 1; i < nodes.length; i++) {
    const a = nodes[i - 1], b = nodes[i]; const len = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z); const n = Math.max(1, Math.ceil(len / step))
    for (let k = 1; k <= n; k++) {
      const t = k / n; const x = Math.floor(a.x + (b.x - a.x) * t), y = Math.floor(a.y + (b.y - a.y) * t), z = Math.floor(a.z + (b.z - a.z) * t); samples++
      for (const [dx, dz] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
        const s = cellLavaSafe(at, x + dx, y, z + dz); if (!s.safe) return { safe: false, why: `lava_corridor: ${s.why}`, at: s.cell, samples }
      }
      const d = dropLavaSafe(at, x, y, z); if (!d.safe) return { safe: false, why: `lava_corridor: ${d.why}`, at: d.cell, samples }
    }
  }
  return { safe: true, samples }
}
/**
 * Guard 2: the water hold's forward push. `dir` is the unit push direction ([dx, dz] in {-1,0,1}); the swept 3-wide
 * body through +3 cells along it, at feet level and one below, must be known and free of lava. Returns the first
 * offending cell. The caller clears `forward` explicitly on refusal.
 */
export function holdForwardSafe (at, feet, dir, { reach = 3 } = {}) {
  const [dx, dz] = dir; if (!dx && !dz) return { safe: true }
  const lateral = dx ? [[0, -1], [0, 0], [0, 1]] : [[-1, 0], [0, 0], [1, 0]]
  for (let k = 1; k <= reach; k++) for (const [lx, lz] of lateral) for (const dy of [0, -1]) {
    const x = feet.x + dx * k + lx, y = feet.y + dy, z = feet.z + dz * k + lz; const b = at(x, y, z)
    if (b == null) return { safe: false, why: 'unknown ahead', cell: [x, y, z] }
    if (isLava(b)) return { safe: false, why: 'lava ahead', cell: [x, y, z] }
  }
  return { safe: true }
}
/**
 * Guard 3: the stand-off decision for an IDLE bot (the caller guarantees no skill, no claim, no dig/place in 20 s).
 * Fires only when lava-like lies within 1 block horizontally of the feet or directly under the support; the retreat
 * cell must be passable (feet and head), supported, lava-safe by guard 1's cell test, and the swept 3-wide footprint
 * from here to it must be supported and lava-free. Returns the move or null with the reason.
 */
export function lavaStandOff (at, feet) {
  const near = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dz]) => isLava(at(feet.x + dx, feet.y, feet.z + dz)) || isLava(at(feet.x + dx, feet.y - 1, feet.z + dz)))
  const under = at(feet.x, feet.y - 1, feet.z); const underLava = isLava(under) || isLava(at(feet.x, feet.y - 2, feet.z))
  if (!near.length && !underLava) return { move: null, why: 'no lava adjacent' }
  const candidates = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dz]) => !near.some(([nx, nz]) => nx === dx && nz === dz))
  // prefer the cell opposite the nearest lava
  candidates.sort((p, q) => score(q) - score(p))
  function score ([dx, dz]) { return near.reduce((s, [nx, nz]) => s + (dx * nx + dz * nz < 0 ? 2 : dx * nx + dz * nz === 0 ? 1 : 0), 0) }
  for (const [dx, dz] of candidates) {
    const x = feet.x + dx, y = feet.y, z = feet.z + dz
    if (!passable(at(x, y, z)) || !passable(at(x, y + 1, z))) continue
    if (!solid(at(x, y - 1, z))) continue
    if (!cellLavaSafe(at, x, y, z).safe) continue
    // the swept 3-wide footprint between here and there
    const lateral = dx ? [[0, -1], [0, 0], [0, 1]] : [[-1, 0], [0, 0], [1, 0]]
    // the origin's own centre cell is the hazard being left (magma underfoot counts as lava-like support), so the
    // sweep checks the origin's LATERAL cells and the whole destination footprint
    if (!lateral.every(([lx, lz]) => ((lx === 0 && lz === 0) || (cellSupported(at, feet.x + lx, y, feet.z + lz) && !isLava(at(feet.x + lx, y, feet.z + lz)))) && cellSupported(at, x + lx, y, z + lz) && !isLava(at(x + lx, y, z + lz)))) continue
    return { move: [dx, dz], why: 'retreat' }
  }
  return { move: null, why: 'lava_adjacent_no_retreat' }
}

/**
 * Guard 1b: a BLIND step -- a straight walk of `dist` blocks along yaw `ang` from `pos` with no path (explore's
 * failed-leg fallback, 1.2 s of forward+jump). Sampled like a route: the line from the feet to the end point, with
 * every cell known, lava-free around it and lava-free in the drop below it. board-b-Delta, 2026-09-15 10:26: guard 1
 * refused the explore leg over a pool ("lava below at 386,70,100"), the refusal failed the goto, and the fallback
 * walked the bot into that pool one second later. mineflayer yaw: x = -sin(yaw), z = cos(yaw) (bot.look convention).
 */
export function stepLineSafe (at, pos, ang, { dist = 5 } = {}) {
  const dx = -Math.sin(ang), dz = Math.cos(ang)
  const a = { x: pos.x, y: Math.floor(pos.y), z: pos.z }, b = { x: pos.x + dx * dist, y: Math.floor(pos.y), z: pos.z + dz * dist }
  const r = corridorSafe(at, [a, b])
  return r.safe ? { safe: true } : { safe: false, why: r.why.replace('lava_corridor', 'blind_step'), at: r.at }
}
