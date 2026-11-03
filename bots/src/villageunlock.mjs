// VILLAGE UNLOCK (T3a villageunlock-01; trading design 2026-11-03, docs/reports/trading-design-2026-11-03.md). Pure decisions.
//
// WHY. The showcase's nearest village (village-taiga-6_1, ~85 blocks from home) has 7 villagers and none employed: 4 stand
// inside a 4x1 ring of OPEN bottom spruce trapdoors (79..84,73,-5..-3) and 3 inside a 2x1 ring in the leatherworker house
// (86..89,76,10..12), read from a region copy 11-03; their brains say they last worked ~6 days ago. OWNER 11-03 ~21:45Z: "we
// can edit the world when it comes to opening doors etc, that is fine".
// PROVEN (sandbox4 11-03, sandbox/trading/unlock-proof.cjs): the replica ring kept an unemployed villager inside and jobless
// for 90 s (control); closing ONE side (4 trapdoors) freed nothing in 90 s; closing the WHOLE ring (10) let it walk out and
// take a smithing table 6 blocks away in 5.7 s. The bot's survival activateBlock toggled each one; all 10 trapdoors remained
// (state change only), villager health 20.
// SO: find the pen a still, jobless villager stands in, and close EVERY open trapdoor (and open every closed fence gate) that
// bounds it. Never break, never place, never touch a door, a bed, a job site or a chest. A pen bounded by anything else is left.
export const VU = Object.freeze({
  maxCells: 12,              // a pen is small: the measured rings hold 4 and 2 cells
  stuckMs: 20 * 60_000,      // a villager that has not left its cell for 20 min (scout sightings)
  perVillagerMs: 6 * 3600_000,
  perBotMs: 30 * 60_000,
  reach: 4,                  // activate from within this many blocks (1.21 block interaction range 4.5 from the eyes)
  scanRadius: 128,
  gapMs: 10 * 60_000,        // sightings further apart than this restart the stuck clock
  freshMs: 5 * 60_000,       // a candidate must have been seen within this
  leaseMs: 5 * 60_000,       // one bot per pen (a pool-wide lease file)
})

/** THE VILLAGER STILL THERE? (Codex r1 blocker 3) entity -> 'ok' | why. Pure: still tracked, jobless, adult, in the pen. */
export function villagerStillPenned (e, pen) {
  if (!e || e.name !== 'villager' || !e.position) return 'villager_gone'
  const md = e.metadata ?? []
  const p = md[18]?.villagerProfession
  if (Number.isInteger(p) && p !== 0) return 'employed'
  if (md[16] === true) return 'baby'
  const fx = Math.floor(e.position.x), fz = Math.floor(e.position.z)
  if (!pen?.cells?.some(c => c.x === fx && c.z === fz)) return 'left_pen'
  return 'ok'
}
/** The pen's lease key: its smallest cell. Pure. */
export const penKey = pen => { const c = [...(pen?.cells ?? [])].sort((a, b) => a.x - b.x || a.z - b.z)[0]; return c ? `${c.x}_${c.y}_${c.z}` : null }
export function unlockSwitch (env = process.env) {
  const v = String(env.VILLAGEUNLOCK ?? '').toLowerCase()
  return !(v === '0' || v === 'off' || v === 'false')
}
export const unlockModeDetail = on => `on=${on ? 1 : 0} max_cells=${VU.maxCells} stuck_min=${VU.stuckMs / 60_000} per_villager_h=${VU.perVillagerMs / 3600_000}`

const bare = n => String(n ?? '').replace(/^minecraft:/, '')
const AIR = /^(air|cave_air|void_air)$/
// what a villager's feet and head pass through (plants, carpets, snow layers, a CLOSED bottom trapdoor is a floor slab)
const THIN = /(^short_grass$|^grass$|^tall_grass$|fern$|_sapling$|^dandelion$|^poppy$|_tulip$|_orchid$|^allium$|^azure_bluet$|^oxeye_daisy$|^cornflower$|^lily_of_the_valley$|^torchflower$|_carpet$|^moss_carpet$|^snow$|^dead_bush$|torch$|_button$|_pressure_plate$|rail$|^wildflowers$|^leaf_litter$|^pink_petals$|lichen$|^vine$|^seagrass$)/
const open = b => String(b?.props?.open ?? b?.properties?.open ?? '') === 'true' || b?.props?.open === true || b?.properties?.open === true
const half = b => b?.props?.half ?? b?.properties?.half ?? null
export const isTrapdoor = b => /_trapdoor$/.test(bare(b?.name)) && !/^iron_/.test(bare(b?.name))
export const isGate = b => /_fence_gate$/.test(bare(b?.name))
/** The barrier a toggle removes: an OPEN wooden trapdoor (a thin wall) or a CLOSED fence gate. */
export const toggleable = b => (isTrapdoor(b) && open(b)) || (isGate(b) && !open(b))
export function passable (b) {
  const n = bare(b?.name)
  if (AIR.test(n) || THIN.test(n)) return true
  if (isTrapdoor(b)) return !open(b) && half(b) !== 'top'
  if (isGate(b)) return open(b)
  // a wooden door: a villager opens it itself (an iron one it cannot)
  if (/_door$/.test(n)) return !/^iron_/.test(n)
  return false
}
const solidBelow = b => { const n = bare(b?.name); return !!n && !AIR.test(n) && !/water|lava|bubble_column/.test(n) && !THIN.test(n) }
/**
 * IS THIS BARRIER A REAL WAY OUT? (Codex review r1, blocker 2: a top shutter under stone or a trapdoor over a hole must never be
 * toggled.) -> bool. A trapdoor: BOTTOM half, a solid block under it (no hole cover), room above it; a gate: room above it. And
 * the cell beyond it, in the same direction, is somewhere a villager can stand: level, one step down, or one step up.
 */
export function barrierExits (at, x, y, z, dx, dz) {
  const b = at(x, y, z)
  if (!b || !toggleable(b)) return false
  const above = at(x, y + 1, z)
  if (!above || !passable(above)) return false
  if (isTrapdoor(b)) {
    if (half(b) !== 'bottom') return false
    const under = at(x, y - 1, z)
    if (!under || !solidBelow(under)) return false
  }
  const fx = x + dx, fz = z + dz
  const f0 = at(fx, y, fz), f1 = at(fx, y + 1, fz), fm1 = at(fx, y - 1, fz), fm2 = at(fx, y - 2, fz), f2 = at(fx, y + 2, fz)
  if (!f0 || !f1 || !fm1) return false
  if (passable(f0) && passable(f1)) {
    if (solidBelow(fm1)) return true                                         // level
    return !!fm2 && passable(fm1) && solidBelow(fm2)                         // one step down
  }
  return !!f2 && solidBelow(f0) && passable(f1) && passable(f2) && !/_(fence|wall)$|_pane$|^iron_bars$/.test(bare(f0.name))   // one step up
}

/**
 * THE PEN around a villager's feet -> { pen: true, cells, toggles: [{x,y,z,name,want}] } | { pen: false, why }. Pure: blockAt(x,y,z)
 * -> { name, props } | null (null = not loaded). A flood over the feet level, 4 neighbours: a walkable cell (feet and head pass,
 * a floor below) is in the pen; a toggleable barrier is collected; a drop (no floor) or a 1-block step up (a villager jumps it)
 * is a way out -> no pen. More than maxCells -> open ground, no pen. A pen with nothing to toggle is `walled` (left alone).
 */
export function penAround (blockAt, feet, { maxCells = VU.maxCells } = {}) {
  const at = (x, y, z) => { try { return blockAt(x, y, z) } catch { return null } }
  const y = Math.floor(feet.y + 1e-6), sx = Math.floor(feet.x), sz = Math.floor(feet.z)
  const start = [at(sx, y, sz), at(sx, y + 1, sz), at(sx, y - 1, sz)]
  if (start.some(b => !b)) return { pen: false, why: 'unloaded' }
  if (!passable(start[0]) || !passable(start[1])) return { pen: false, why: 'not_standing' }
  const seen = new Set([`${sx},${sz}`]), q = [[sx, sz]], cells = [], toggles = new Map()
  while (q.length) {
    const [x, z] = q.shift()
    cells.push({ x, y, z })
    if (cells.length > maxCells) return { pen: false, why: 'open' }
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, nz = z + dz, k = `${nx},${nz}`
      if (seen.has(k)) continue
      const f = at(nx, y, nz), h = at(nx, y + 1, nz), lo = at(nx, y - 1, nz)
      if (!f || !h || !lo) return { pen: false, why: 'unloaded' }
      if (toggleable(f)) {
        // only a barrier that leads somewhere safe is collected; any other is a wall (never touched)
        if (barrierExits(at, nx, y, nz, dx, dz)) toggles.set(k, { x: nx, y, z: nz, name: bare(f.name), want: isGate(f) ? 'open' : 'closed' })
        continue
      }
      if (passable(f) && passable(h)) {
        if (!solidBelow(lo)) return { pen: false, why: 'exit_drop' }
        seen.add(k); q.push([nx, nz]); continue
      }
      // a full block at the feet with room above it: a villager steps up and out
      const h2 = at(nx, y + 2, nz)
      if (!h2) return { pen: false, why: 'unloaded' }
      if (!passable(f) && !toggleable(f) && passable(h) && passable(h2) && !/_(fence|wall)$|^iron_bars$|_pane$|^glass_pane$/.test(bare(f.name))) return { pen: false, why: 'exit_step' }
      // anything else (a wall, a fence, a door frame, a bed, a job site) bounds the pen and is never touched
    }
  }
  const t = [...toggles.values()]
  if (!t.length) return { pen: false, why: 'walled', cells }
  return { pen: true, cells, toggles: t }
}

/** Track how long each villager has stood in one cell -> the map, updated. Pure (mutates `still`). */
export function trackStill (still, sightings, now, { gapMs = VU.gapMs } = {}) {
  for (const s of sightings) {
    if (s.kind !== 'villager') continue
    const cell = `${Math.floor(s.x)},${Math.floor(s.y)},${Math.floor(s.z)}`
    const prev = still.get(s.uuid)
    // a new cell, or an observation interrupted for longer than gapMs (Codex r1 blocker 3): the clock restarts
    if (!prev || prev.cell !== cell || now - prev.seenAt > gapMs) still.set(s.uuid, { cell, since: now, seenAt: now, s })
    else { prev.s = s; prev.seenAt = now }
  }
  if (still.size > 1000) for (const k of [...still.keys()].slice(0, still.size - 1000)) still.delete(k)
  return still
}

/** The candidates: jobless adult villagers still in one cell for >= stuckMs, not tried for perVillagerMs. Nearest first. Pure. */
export function stuckCandidates (still, tried, now, here, { stuckMs = VU.stuckMs, perVillagerMs = VU.perVillagerMs, radius = VU.scanRadius, freshMs = VU.freshMs } = {}) {
  const out = []
  for (const [uuid, v] of still) {
    const s = v.s
    if (!s || s.baby || s.profession !== 'none') continue
    if (now - v.since < stuckMs) continue
    if (now - (v.seenAt ?? v.since) > freshMs) continue   // not seen lately: it may have left (Codex r1 blocker 3)
    if (now - (tried.get(uuid) ?? -Infinity) < perVillagerMs) continue
    const d = here ? Math.hypot(s.x - here.x, s.z - here.z) : Infinity
    if (d > radius) continue
    out.push({ uuid, x: s.x, y: s.y, z: s.z, dist: d, zone: s.zone ?? null })
  }
  return out.sort((a, b) => a.dist - b.dist)
}

/** The next toggle to do: still toggleable now (another bot may have closed it), nearest to the bot first. Pure. */
export function nextToggle (toggles, blockAt, from) {
  const live = toggles.filter(t => { let b = null; try { b = blockAt(t.x, t.y, t.z) } catch { b = null } return b && toggleable(b) })
  if (!live.length) return null
  const d = t => Math.hypot(t.x + 0.5 - from.x, t.y + 0.5 - (from.y + 1.6), t.z + 0.5 - from.z)
  return live.sort((a, b) => d(a) - d(b))[0]
}
export const reachOf = (t, from) => Math.hypot(t.x + 0.5 - from.x, t.y + 0.5 - (from.y + 1.6), t.z + 0.5 - from.z)

export const unlockDetail = ({ villager, zone = null, pen = null, done = [], stop }) =>
  `villager ${villager ? `${Math.floor(villager.x)},${Math.floor(villager.y)},${Math.floor(villager.z)}` : '?'} zone=${zone ?? 'none'} ` +
  `pen=${pen?.cells?.length ?? 0} toggles=${pen?.toggles?.length ?? 0} done=${done.length}${done.length ? ` [${done.slice(0, 6).join(' ')}]` : ''} stop=${stop}`
