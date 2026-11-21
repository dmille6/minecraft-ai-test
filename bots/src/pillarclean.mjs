// PILLARS-01show: BOTS TAKE DOWN THE LONE PILLARS BOTS LEFT OUTSIDE THE WALLS (owner 11-20: "remove them, all of them. i want a
// clean manicured landscape").
//
//
// WHY (measured 11-20 on read-only copies of the showcase's 11-20 04:15Z backup, docs/reports/pillars/pillars-2026-11-20.md): the
// vision render counted 456 lone pillars outside the walls in its frame. Over the whole saved world the same rule finds 7,669
// columns; 7,026 outside the walls and every project box; CoreProtect proves 1,695 of them bot-made (1,341 every block, 354 a top
// run). Of their 2,505 proven blocks, 2,390 have the placer's own log rows: 2,050 were placed by mineflayer-pathfinder's own
// scaffold on a WALK (explore, goto, gather), 121 by the escape reflexes (pillarOut, digStraightUp), 33 by skills (shaftAscend).
// Of the walk's blocks placed while the take-back was installed (1,044), 481 were LEFT `expired` (the walk went on out of reach),
// 326 never got a receipt, and 104 were ADOPTED `built_on` -- the lower block of the walk's own tower, closed for good because the
// block over it was its own still-open receipt (fixed in takeback.mjs verdictFor: `deferred why=stack`).
//
// WHAT. Two halves, floatclean-01show's shape.
//   1. THE SURVEY (host side, never on the showcase VM): scripts/pillar-colscan.mjs (every column's top over a region copy, the
//      vision's rule), scripts/host/floatclean_cp.py (CoreProtect's last row per cell, with its positive control), and
//      scripts/host/pillar_survey.py (outside the walls and every project box; a pillar's BODY is its column from the
//      neighbourhood's median + 1 to its top; only a CoreProtect-proven top run of bot placements is ever listed). The list:
//      bots/src/pillarclean/<pool>.json, or a newer `pillarclean.json` the host drops in the pool directory.
//   2. THE WORK (skills.mjs pillarcleanLap, at the head of a tidy visit after floatclean's lap): the visit's own clear machinery
//      (buildrun.mjs runVisit: a dig stand on the town's walk nodes, eye in reach and sight clear, no scaffold, no tower, no dig to
//      get there), the pillars nearest the bot first, each TOP DOWN (`clearKeepOrder`), never a stand on a listed block or on a
//      floor with liquid under it (`clearNoFloor` += seaFloors: the frozen sea's ice, a block on the water -- a sea pillar is dug
//      from the side, from the shore's ground, or not at all), the cell judged again at the dig (pillarClearOk). Taken down to its
//      neighbourhood's median, the column is level with the ground round it: nothing natural is ever dug.
//   A cell already gone CLOSES; one that holds something, has a liquid against it, or became a record's or a zone's cell is HELD
//   and named; one no stand reached in PL.asideTries laps is SET ASIDE for PL.asideMs (floatclean's memory) -- never waived.
// PROGRESS: pillars cleared (every listed cell of the pillar gone) out of the list's pillars, on every `_pillarclean op=pass` row.
// ROWS: `_pillarclean op=survey` (the list's census as read now), `op=dig` (cell, block, CoreProtect's placer, pillar), `op=aside`,
//   `op=pass` (cleared, pillars_done/pillars, stop, ms).
// SWITCH: PILLARCLEAN=off|0|false|no -> no lap.
// PURE: nothing here touches a bot, a file or a clock. The host survey and the bot's lap share these rules.

const nm = b => String(b?.name ?? '').replace(/\[.*\]$/, '')
const AIR = /^(air|cave_air|void_air)$/
const LEAVES = /_leaves$/
const LIQ = /^(water|lava|bubble_column|flowing_water|flowing_lava)$/
const isLiquid = b => !!b && (LIQ.test(nm(b)) || b?.props?.waterlogged === true || b?.props?.waterlogged === 'true')
const isSolid = b => !!b && b.boundingBox === 'block' && !isLiquid(b)

/** The vision render's pillar tops (vision.py 1b: JUNK + planks, logs, scaffolding, cobblestone wall). */
export const PILLAR_TOPS = /^(cobblestone|cobbled_deepslate|dirt|coarse_dirt|grass_block|stone|andesite|diorite|granite|tuff|gravel|sand|netherrack|mossy_cobblestone|rooted_dirt|deepslate|[a-z_]+_planks|oak_log|spruce_log|scaffolding|cobblestone_wall)$/
export const PILLARCLEAN_PLOT = 'pillarclean'
export const PL = Object.freeze({
  passMax: 24,        // listed cells a lap takes into its visit at most (whole pillars, nearest first)
  passMs: 100_000,
  passMinMs: 20_000,
  everyMs: 5 * 60_000,
  builders: 3,
  asideTries: 2,
  asideMs: 6 * 60 * 60_000,
  rowMs: 30 * 60_000,
  walkR: 160,         // the visit's walk radius round home (the survey lists nothing further out)
  seaR: 5,            // round each pillar of a lap: every floor with a liquid under it is never a stand (seaFloors)
  rise: 3,            // a pillar stands this far over its neighbourhood's median (vision.py: y - m >= 3)
  nb: 2,              // the neighbourhood: (2*nb+1)^2 - 1 columns
  nbMin: 12,          // fewer known neighbours (the world's edge): not judged
  perchedRun: 6,      // a solid run this short with air under it is perched (floatclean's), not a column's top
})

/**
 * A COLUMN'S STANDING TOP -> { y, name, leavesOver } | null. Pure over `read`. Scans down from yStart: air, plants (no full box)
 * and leaves are passed; a liquid is the top (the sea, a pond: name 'water'); a solid is the top unless its run (down to the
 * first non-solid) is at most PL.perchedRun long with AIR under it and `skipPerched` is set. By default the TRUE top: the vision
 * render's rule counts a pillar whose lower blocks were taken back, leaving its top run hanging, as a pillar too.
 */
export function standTop (read, x, z, yStart, yMin = -64, { skipPerched = false } = {}) {
  let leavesOver = false
  for (let y = yStart; y >= yMin; y--) {
    const b = read(x, y, z)
    if (!b) continue
    const n = nm(b)
    if (AIR.test(n)) continue
    if (LEAVES.test(n)) { leavesOver = true; continue }
    if (isLiquid(b)) return { y, name: 'water', leavesOver }
    if (!isSolid(b)) continue
    let yb = y
    while (yb - 1 >= yMin && isSolid(read(x, yb - 1, z)) && y - yb < PL.perchedRun + 1) yb--
    const under = read(x, yb - 1, z)
    if (skipPerched && y - yb + 1 <= PL.perchedRun && under && AIR.test(nm(under))) { y = yb; leavesOver = false; continue }
    return { y, name: n, leavesOver }
  }
  return null
}

/**
 * THE VISION'S PILLAR RULE -> { med, base } | null. Pure. `t` the column's standing top, `topAt(x, z)` a neighbour's. A pillar: a
 * PILLAR_TOPS top (not a log under leaves: a tree), PL.rise or more over the median of the known neighbours. `base` is the
 * commonest neighbour top AT the median ('water', 'ice', 'grass_block'...): the sea guard reads it.
 */
export function pillarCandidate (x, z, t, topAt) {
  if (!t || !PILLAR_TOPS.test(t.name)) return null
  if (/_log$/.test(t.name) && t.leavesOver) return null
  const nb = []
  for (let dx = -PL.nb; dx <= PL.nb; dx++) for (let dz = -PL.nb; dz <= PL.nb; dz++) {
    if (!dx && !dz) continue
    const v = topAt(x + dx, z + dz)
    if (v) nb.push(v)
  }
  if (nb.length < PL.nbMin) return null
  const hs = nb.map(v => v.y).sort((a, b) => a - b)
  const med = hs[Math.floor(hs.length / 2)]
  if (t.y - med < PL.rise) return null
  const at = {}
  for (const v of nb) if (v.y === med) at[v.name] = (at[v.name] ?? 0) + 1
  const base = Object.entries(at).sort((a, b) => b[1] - a[1])[0]?.[0] ?? '?'
  return { med, base }
}

/** THE SWITCH -> bool. Pure. */
export const pillarcleanOn = (env = process.env) => !/^(off|0|false|no)$/i.test(String(env?.PILLARCLEAN ?? '').trim())
export const k3 = a => `${a[0]},${a[1]},${a[2]}`
const FAMILY = n => (n === 'grass_block' || n === 'dirt' ? 'dirt' : n)
export const sameBlock = (a, b) => FAMILY(nm({ name: a })) === FAMILY(nm({ name: b }))
const N6 = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]
const N4 = [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]]
const isAir = b => !!b && AIR.test(nm(b))

/**
 * THE CELL NOW -> 'take' | why. Pure over `read`. A listed pillar block (CoreProtect-proven at the survey):
 *   unread   the cell or a neighbour cannot be read (its chunk is not loaded for this bot: no finding, waits)
 *   gone     no longer the listed block (dug, replaced; dirt and grass are one)          -> CLOSES
 *   record   a record's cell or clear, or a town plan plot's column (`cells`)             -> HELD
 *   zoned    a protected zone's cell                                                      -> HELD
 *   wet      a liquid against any of its six faces (taken out, the liquid runs in)        -> HELD
 *   above    a listed cell still stands over it: the one over it goes first (top down)
 *   holds    over it anything but air (not a listed cell), or on its four sides a thing that is neither air nor a full block (a torch,
 *            a ladder, a sign: something hung on it)                                      -> HELD
 * Nothing about what is UNDER it: a pillar stands on the ground (floatclean's `grounded` is this list's normal case).
 */
export function pillarVerdict (job, read, { listed = () => false, cells = () => false, zone = () => false } = {}) {
  const [x, y, z] = job.at
  const b = read(x, y, z)
  if (!b) return 'unread'
  if (!sameBlock(nm(b), job.name)) return 'gone'
  if (cells(k3(job.at))) return 'record'
  if (zone(x, y, z)) return 'zoned'
  const ns = N6.map(([dx, dy, dz]) => read(x + dx, y + dy, z + dz))
  if (ns.some(n => !n)) return 'unread'
  if (ns.some(isLiquid)) return 'wet'
  const over = read(x, y + 1, z)
  if (!isAir(over)) return listed(k3([x, y + 1, z])) && isSolid(over) ? 'above' : 'holds'
  for (const [dx, , dz] of N4) { const s = read(x + dx, y, z + dz); if (!isAir(s) && !isSolid(s)) return 'holds' }
  return 'take'
}
export const CLOSES = Object.freeze(['gone'])

/**
 * THE SEA GUARD -> Set 'x,y,z' of FLOORS no stand may use round the given pillars. Pure over `read`. Every solid cell within PL.seaR
 * (Chebyshev) of a pillar's column, from its median - 2 to its top + 1, with a liquid directly under it: the frozen sea's ice, a
 * block laid on the water. A sea pillar is dug from the side, standing on ground, or it waits (control session 11-20: "never
 * standing on ice over water").
 */
export function seaFloors (read, pillars, R = PL.seaR) {
  const out = new Set()
  for (const p of pillars ?? []) {
    for (let dx = -R; dx <= R; dx++) for (let dz = -R; dz <= R; dz++) {
      for (let y = p.med - 2; y <= p.top + 1; y++) {
        const x = p.x + dx, z = p.z + dz
        const b = read(x, y, z)
        if (!b || !isSolid(b)) continue
        const u = read(x, y - 1, z)
        if (!u || isLiquid(u)) out.add(k3([x, y, z]))   // an unread under: never a floor either
      }
    }
  }
  return out
}

/** A list as read from a file -> the list | null (malformed, or another pool's). Pure. Pillars: { id, x, z, med, top, sea, take }. */
export function pillarListOk (doc, pool) {
  if (!doc || doc.v !== 1 || !Array.isArray(doc.pillars)) return null
  if (String(doc.pool ?? '') !== String(pool ?? '')) return null
  const tri = a => Array.isArray(a) && a.length >= 3 && a.slice(0, 3).every(Number.isInteger)
  const pillars = doc.pillars.filter(p => Number.isInteger(p?.x) && Number.isInteger(p?.z) && Number.isInteger(p?.med) && Array.isArray(p?.take) && p.take.length && p.take.every(t => tri(t) && typeof t[3] === 'string'))
    .map(p => ({ ...p, top: Number.isInteger(p.top) ? p.top : Math.max(...p.take.map(t => t[1])) }))
  return { ...doc, pillars }
}
export const pillarListNewer = (a, b) => (!a ? b : !b ? a : (Number(b.surveyedAt) || 0) > (Number(a.surveyedAt) || 0) ? b : a)

/**
 * THE LAP'S JOBS NOW -> { take: [clear], held: [{ job, why }], census, floor, pillars }. Pure over `read`.
 *   list     the list (pillarListOk);  pos: the bot's position -- its pillars nearest first (only what its chunks show: `unread` waits)
 *   aside    (k) -> bool: set aside by this bot;  cells, zone: as pillarVerdict;  max: cells at most (whole pillars while they fit;
 *            the first pillar always)
 *   part of parts: the crew's split -- pillars with id % parts === part first
 * `take` entries are runVisit clears { at, kind: 'pillar', name: the block the cell reads NOW, placer, pillar }, each pillar's top
 * first. `floor`: every listed cell still standing in the lap's pillars plus seaFloors round them (runVisit `clearNoFloor`).
 * census: pillars (the list's), done (every listed cell gone), standing cells, take, held by why, aside.
 */
export function pillarPassJobs (list, read, { pos = null, aside = () => false, cells = () => false, zone = () => false, max = PL.passMax, part = null, parts = 1 } = {}) {
  const ps = list?.pillars ?? []
  const census = { pillars: ps.length, done: 0, unread: 0, standing: 0, take: 0, aside: 0, why: {} }
  const standing = new Set()
  const left = []
  for (const p of ps) {
    let n = 0, unread = false
    for (const t of p.take) { const b = read(t[0], t[1], t[2]); if (!b) { unread = true; continue } if (sameBlock(nm(b), t[3])) { standing.add(k3(t)); n++ } }
    if (!n && !unread) { census.done++; continue }
    if (unread && !n) { census.unread++; continue }
    left.push({ p, n })
  }
  census.standing = standing.size
  const d = p => (pos ? Math.max(Math.abs(p.x + 0.5 - pos.x), Math.abs(p.z + 0.5 - pos.z)) : 0)
  const mine = p => part == null || !(parts > 1) || ((((Number(p.id) || 0) % parts) + parts) % parts) === part
  left.sort((a, b) => (mine(b.p) - mine(a.p)) || d(a.p) - d(b.p) || (a.p.id ?? 0) - (b.p.id ?? 0))
  const take = [], held = [], chosen = []
  for (const { p } of left) {
    const cs = []
    for (const t of [...p.take].sort((a, b) => b[1] - a[1])) {
      const job = { at: t.slice(0, 3), name: t[3], placer: t[4] ?? '-' }
      const k = k3(job.at)
      if (!standing.has(k)) continue
      if (aside(k)) { census.aside++; continue }
      const v = pillarVerdict(job, read, { listed: q => standing.has(q), cells, zone })
      if (v === 'take' || v === 'above') { cs.push({ at: job.at, kind: 'pillar', name: nm(read(...job.at)), placer: job.placer, pillar: p.id ?? -1 }); continue }
      if (v === 'unread') continue
      census.why[v] = (census.why[v] ?? 0) + 1
      held.push({ job: { ...job, pillar: p.id }, why: v })
    }
    if (!cs.length) continue
    if (take.length && take.length + cs.length > max) break
    take.push(...cs); chosen.push(p)
  }
  census.take = take.length
  const floor = new Set([...standing, ...seaFloors(read, chosen)])
  return { take, held, census, floor, pillars: chosen }
}

/**
 * THE CHECK AT THE DIG (runVisit `clearOk`, before the walk and again after it) -> bool. Pure over `read`. Only a `pillar` clear is
 * judged: it must read `take` NOW. Never a block under this bot or under another body (floatclean's rules, rig 11-20), never while
 * this bot stands on a listed block or on a floor with liquid under it (`noFloor(k)`: the lap's floor set).
 */
export function pillarClearOk (c, read, { listed = () => false, cells = () => false, zone = () => false, under = [], noFloor = () => false, others = [], inWater = false } = {}) {
  if (c?.kind !== 'pillar') return true
  // rig 11-20 (6db0cb11, Delta at 89,60,-63): never a dig while the bot is in water at all, its floor a liquid -- it gets out first
  if (inWater || under.some(k => { const b = read(...k.split(',').map(Number)); return !b || isLiquid(b) })) return false
  if (others.includes(k3(c.at))) return false
  if (under.includes(k3(c.at)) || under.some(k => noFloor(k))) return false
  return pillarVerdict(c, read, { listed: k => listed(k) && isSolid(read(...k.split(',').map(Number))), cells, zone }) === 'take'
}

// ---- floatclean-01show's pure helpers, carried here so this piece stands on a base without floatclean (control session 11-20:
// releases are restacked one piece at a time). Same rules, same tests' shape; on a base with floatclean they are its twins.
/**
 * THE GUARD -> (k) -> bool. Pure (floatclean.mjs floatGuardOf). `records`: every guarded project's record (each [x,y,z] it lists
 * anywhere -- `at` or `cell` of any top-level array: its cells AND its clears, cuts, replants, trees); `extra`: more cell keys (the
 * bridges' planned cells); `plan`: the town plan as townPlanHead gives it (`head.plan`): every plot's box guards its columns.
 */
export function pillarGuardOf ({ records = [], extra = [], plan = null } = {}) {
  const out = new Set(extra)
  const tri = a => Array.isArray(a) && a.length === 3 && a.every(Number.isInteger)
  for (const rec of records) for (const v of Object.values(rec ?? {})) if (Array.isArray(v)) for (const q of v) { const at = q?.at ?? q?.cell; if (tri(at)) out.add(at.join(',')) }
  const boxes = (plan?.plots ?? []).map(p => p?.box).filter(b => Array.isArray(b) && b.length === 4)
  return k => { if (out.has(k)) return true; const [x, , z] = k.split(',').map(Number); return boxes.some(b => x >= b[0] && x <= b[2] && z >= b[1] && z <= b[3]) }
}
/** The cells under a body (every column its box stands over, at its feet's floor) -> ['x,y,z']. Pure (floatclean.mjs floorKeys). */
export function pillarFloorKeys (pos, width = 0.6) {
  if (!pos || ![pos.x, pos.y, pos.z].every(Number.isFinite)) return []
  const w = (Number(width) || 0.6) / 2, y = Math.floor(pos.y + 1e-6) - 1, out = []
  for (let x = Math.floor(pos.x - w); x <= Math.floor(pos.x + w); x++) for (let z = Math.floor(pos.z - w); z <= Math.floor(pos.z + w); z++) out.push(`${x},${y},${z}`)
  return out
}
/**
 * THE SET-ASIDE MEMORY (one bot's) after a lap -> { mem, aside: [{ k, tries }] }. Pure (floatclean.mjs floatAsideAfter). A cell
 * offered, considered (the visit asked its dig-time check for it) and still standing gets a try; at PL.asideTries it is set aside
 * until now + PL.asideMs. A cell gone forgets its tries.
 */
export function pillarAsideAfter (mem0, { offered = [], standing = () => true, considered = () => false, now = Date.now(), F = PL } = {}) {
  const mem = { tries: { ...(mem0?.tries ?? {}) }, until: { ...(mem0?.until ?? {}) } }
  for (const [k, t] of Object.entries(mem.until)) if (!(t > now)) delete mem.until[k]
  const aside = []
  for (const k of offered) {
    if (!standing(k)) { delete mem.tries[k]; continue }
    if (!considered(k)) continue
    const n = (mem.tries[k] ?? 0) + 1
    if (n >= F.asideTries) { mem.until[k] = now + F.asideMs; delete mem.tries[k]; aside.push({ k, tries: n }) } else mem.tries[k] = n
  }
  return { mem, aside }
}
export const pillarAsideNow = (mem, k, now = Date.now()) => (Number(mem?.until?.[k]) || 0) > now

/** One `_pillarclean` row's detail. Pure. */
export const pillarDetail = f => Object.entries(f).filter(([, v]) => v != null && v !== '').map(([k, v]) => `${k}=${String(Array.isArray(v) ? v.join(',') : typeof v === 'object' ? Object.entries(v).map(([a, b]) => `${a}:${b}`).join(',') : v).replace(/\s+/g, '_').slice(0, 160)}`).join(' ')
