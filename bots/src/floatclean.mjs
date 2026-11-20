// FLOATCLEAN-01show: BOTS CLEAN UP THE FLOATING BLOCKS OTHER BOTS LEFT BEHIND (owner, control session 11-20).
//
// WHY (measured 11-19/11-20 on read-only copies of the showcase): ~31% of land columns near town carry a solid block perched over
// air (docs/reports/sites-2026-11-19/sites.md); the step well's saved region shows ~175 floating blocks over its dug pit and long
// cobble/dirt bridge beams west of it (docs/reports/stepwell-trace-2026-11-20.md). The cause: explorers bridge with the
// pathfinder's own scaffold and the take-back (takeback.mjs) expires after ~5 min once the bot has walked on (Maple 11-16
// 17:35-17:40Z: 16 dirt bridged over the pit, 12 dug back, 4 left `why=expired`). Nothing in the town's clean-up reaches them: the
// tidy measures ground as the highest solid of a column (a beam over a gap reads as ground) and keeps off every project's box (the
// pit is the step well's), the litter hand-off believes an entry three hours and only in the town and its margin.
//
// WHAT. Two halves.
//   1. THE SURVEY (host side, never on the showcase VM: scripts/host/floatclean_cp.py + bots/scripts/floatclean-survey.mjs over a
//      region copy, a CoreProtect copy and a pool copy) lists the cells that are ALL of: placed by a bot (CoreProtect's LAST row on
//      the cell is a placement by a bot's user, not rolled back), still holding that block, PERCHED (air under it, or another such
//      block that is itself perched), a bot's material (FLOAT_BLOCKS), never a record's cell or clear, never in a protected zone (the
//      villages) or a town plan plot, no liquid against it, and holding nothing up (nothing but air over it unless that is a listed
//      cell too; nothing hung on its sides or under it). Ordered by area (the step well's pit first, then the beams west of it,
//      then the town), then beam by beam (6-connected), each beam TOP DOWN (floatSurvey).
//   2. THE WORK (skills.mjs floatcleanPass, at the head of every tidy visit while the list has open cells): the visit's own clear
//      machinery (buildrun.mjs runVisit: a dig stand on the walk's nodes, eye in reach, sight clear, the walk without scaffold),
//      with three more rules -- the list's order kept (`clearKeepOrder`: top down, beam by beam), no stand on any listed cell
//      (`clearNoFloor`: a bot never stands on the beam it is taking down), and the cell read again AT the dig (floatVerdict via
//      `clearOk`). Drops go to the bag; the town visit's deposit and the junk well take the surplus as for any dig.
//   A cell already gone (or no longer over air) CLOSES; a cell that holds something, has water against it, or became a record cell
//   or a zone's is HELD and named; a cell no walk reached in FC.asideTries passes of a bot is SET ASIDE for that bot for FC.asideMs
//   with a row -- never waived, never dug from a pillar or a scaffold.
//
// ROWS: `_floatclean op=survey` (each pass: the list's census as read now), `_floatclean op=dig` (each block taken: cell, block, its
//   placer by CoreProtect, beam, area), `_floatclean op=aside` (a cell set aside or held, once a cell a bot an FC.rowMs), `_floatclean
//   op=pass` (the pass's end: cleared, stop, ms). The host survey prints its own `op=survey` summary and writes the list's census.
// SWITCH: FLOATCLEAN=off|0|false|no -> no pass (the tidy visit as before). Unset: on wherever a list names the bot's pool.
// PURE: nothing here touches a bot, a file or a clock.

export const FLOATCLEAN_PLOT = 'floatclean'
export const FC = Object.freeze({
  passMax: 24,             // listed cells a pass takes into its visit at most (in the list's order)
  passMs: 100_000,         // a pass's bound (the tidy visit gets the rest of the skill's budget)
  passMinMs: 20_000,       // no pass when less than this is left of the skill's budget
  everyMs: 5 * 60_000,     // a bot's next lap after one that took nothing (a lap that dug: the next visit's head at once)
  builders: 3,             // admission slots on the plot
  asideTries: 2,           // completed passes in which a standing take-able cell was not dug before it is set aside (per bot)
  asideMs: 6 * 60 * 60_000,
  rowMs: 30 * 60_000,      // an aside/held row for the same cell from the same bot at most this often
  walkR: 160,              // the visit's walk radius round home (the step well is ~74 out)
  reach: 128,              // the survey's town reach round home (Chebyshev)
  skyUp: 24,               // a listed cell is open to the sky this far up (floatVerdict `covered`)
})

/** THE SWITCH -> bool. Pure. */
export const floatcleanOn = (env = process.env) => !/^(off|0|false|no)$/i.test(String(env?.FLOATCLEAN ?? '').trim())

const nm = b => String(b?.name ?? '').replace(/\[.*\]$/, '')
const AIR = /^(air|cave_air|void_air)$/
const LEAVES = /_leaves$/
export const k3 = a => `${a[0]},${a[1]},${a[2]}`
/** What a bot places to walk, climb or bridge (scaffold, spoil) and nothing else: a placed chest, furnace or table is upkeep's stray. */
export const FLOAT_BLOCKS = /^(dirt|coarse_dirt|grass_block|rooted_dirt|cobblestone|mossy_cobblestone|cobbled_deepslate|netherrack|stone|andesite|diorite|granite|deepslate|tuff|calcite|blackstone|end_stone|sandstone|[a-z_]+_planks)$/
/** A block that falls when the one under it goes (never listed: it could not be perched). */
export const FALLING = /^(sand|red_sand|gravel|suspicious_sand|suspicious_gravel|[a-z_]+_concrete_powder|anvil|chipped_anvil|damaged_anvil|pointed_dripstone|scaffolding)$/
/** Dirt left in the light greens (Paper 11-07: 24 of 24 within 7.4 min): the same placed block. */
const FAMILY = n => (n === 'grass_block' || n === 'dirt' ? 'dirt' : n)
export const sameBlock = (a, b) => FAMILY(nm({ name: a })) === FAMILY(nm({ name: b }))
const isLiquid = b => !!b && (/^(water|lava|bubble_column)$/.test(nm(b)) || /waterlogged=true/.test(String(b.name ?? '')) || b?.props?.waterlogged === true || b?.props?.waterlogged === 'true')
const isAir = b => !!b && AIR.test(nm(b))
const isSolid = b => !!b && b.boundingBox === 'block' && !isLiquid(b)
const N6 = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]
const N4 = [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]]

/**
 * THE CELL NOW -> 'take' | why. Pure over `read`. The one rule both halves use (the survey with `listed` = its candidates, the visit
 * with `listed` = the list's cells still standing):
 *   unread     the cell or a neighbour cannot be read (wait: nothing is decided on an unknown)
 *   gone       the cell no longer holds the listed block (dug, replaced)                      -> CLOSES
 *   falling    the block is one that falls (never perched)                                     -> HELD
 *   grounded   the cell under it is solid ground now (filled under it: no longer floating)     -> CLOSES
 *   record     a record's cell or clear, or a town plan plot (`cells(k)`)                       -> HELD
 *   zoned      a protected zone's cell (`zone(x, y, z)`: the villages)                          -> HELD
 *   wet        a liquid against any of its six faces (taken out, it would run into the gap)    -> HELD
 *   holds      something rests on it or hangs from it: over it anything but air (a listed cell standing over it is `above`),
 *              under it anything but air or a listed perched cell, on its four sides anything that is not air and not solid
 *              (a torch, a ladder, a sign, a vine, a button)                                     -> HELD
 *   covered    a solid block (not leaves, not a listed cell) within FC.skyUp over it: a mine's, a cave's, a roof's -- not litter -> HELD
 *   above      a listed cell still stands over it: taken first (top down), then this one
 */
export function floatVerdict (job, read, { listed = () => false, cells = () => false, zone = () => false, skyUp = FC.skyUp } = {}) {
  const [x, y, z] = job.at
  const b = read(x, y, z)
  if (!b) return 'unread'
  if (!sameBlock(nm(b), job.name)) return 'gone'
  if (FALLING.test(nm(b))) return 'falling'
  const under = read(x, y - 1, z)
  if (!under) return 'unread'
  if (isSolid(under) && !listed(k3([x, y - 1, z]))) return 'grounded'
  if (cells(k3(job.at))) return 'record'
  if (zone(x, y, z)) return 'zoned'
  const ns = N6.map(([dx, dy, dz]) => read(x + dx, y + dy, z + dz))
  if (ns.some(n => !n)) return 'unread'
  if (ns.some(isLiquid)) return 'wet'
  const over = read(x, y + 1, z)
  if (!isAir(over)) return listed(k3([x, y + 1, z])) && isSolid(over) ? 'above' : 'holds'
  if (!isAir(under) && !(isSolid(under) && listed(k3([x, y - 1, z])))) return 'holds'
  for (const [dx, , dz] of N4) { const s = read(x + dx, y, z + dz); if (!isAir(s) && !isSolid(s)) return 'holds' }
  // open to the sky: no solid block but leaves (or a listed cell) within FC.skyUp over it -- a block in a mine or a cave, under a
  // roof or a deck, is not the surface's floating litter (and no walk from the town's ground reaches it)
  for (let dy = 2; dy <= skyUp; dy++) {
    const u = read(x, y + dy, z)
    if (!u) break   // above the world's loaded height: open
    if (isSolid(u) && !LEAVES.test(nm(u)) && !listed(k3([x, y + dy, z]))) return 'covered'
  }
  return 'take'
}
/** The verdicts that close a listed cell (nothing left to do there). */
export const CLOSES = Object.freeze(['gone', 'grounded'])

/**
 * THE SURVEY (host side) -> { jobs, census, beams }. Pure over `read`.
 *   cp      Map 'x,y,z' -> { user, t, block } -- the cells whose LAST CoreProtect row is a placement by a bot (floatclean_cp.py)
 *   cells   (k) -> bool: a record's cell or clear, or a town plan plot's column (never listed)
 *   zone    (x, y, z) -> bool: a protected zone's cell
 *   home    { x, y, z }; reach: the town's reach (Chebyshev) -- a perched cell outside every area and the reach is not listed (`far`)
 *   areas   [{ name, box: [x0, z0, x1, z1] }] in order of precedence (the step well's pit, the beams west of it); every other cell
 *           in reach is area `town`
 * A candidate: a bot's placement still standing, a FLOAT_BLOCKS block, perched (air under it, or a candidate under it that is
 * perched). Each is judged by floatVerdict with the candidates as `listed`, TOP DOWN: a candidate held (`holds`, `wet`...) is no
 * longer listed for the ones under it, so the one under it then `holds` it. The listed cells are grouped in beams (6-connected),
 * a beam's area its first area by precedence; beams by area then by distance from home; a beam's cells top down.
 */
export function floatSurvey (read, { cp = new Map(), cells = () => false, zone = () => false, home = { x: 0, y: 64, z: 0 }, reach = FC.reach, areas = [] } = {}) {
  const census = { bot_placed: cp.size, standing: 0, not_float_block: 0, perched: 0, listed: 0, far: 0, why: {} }
  const verdict = new Map()   // 'x,y,z' -> why a bot's standing placement is not listed (or 'listed')
  const why = (w, k) => { census.why[w] = (census.why[w] ?? 0) + 1; if (k) verdict.set(k, w) }
  const inBox = (bx, x, z) => x >= Math.min(bx[0], bx[2]) && x <= Math.max(bx[0], bx[2]) && z >= Math.min(bx[1], bx[3]) && z <= Math.max(bx[1], bx[3])
  const areaOf = (x, z) => { const i = areas.findIndex(a => inBox(a.box, x, z)); return i >= 0 ? i : (Math.max(Math.abs(x - home.x), Math.abs(z - home.z)) <= reach ? areas.length : -1) }
  // standing bot placements of a bot's material
  const cand = new Map()
  for (const [k, e] of cp) {
    const at = k.split(',').map(Number)
    const b = read(...at)
    if (!b || !sameBlock(nm(b), e.block)) { verdict.set(k, 'gone'); continue }
    census.standing++
    if (!FLOAT_BLOCKS.test(nm(b))) { census.not_float_block++; verdict.set(k, 'not_float_block'); continue }
    cand.set(k, { at, name: nm(b), placer: e.user, t: e.t })
  }
  // perched: air under it, or a perched candidate under it (memo, bottom up)
  const memo = new Map()
  const perched = k => {
    if (memo.has(k)) return memo.get(k)
    const [x, y, z] = k.split(',').map(Number)
    const u = read(x, y - 1, z)
    let v = false
    if (u && isAir(u)) v = true
    else if (u && cand.has(k3([x, y - 1, z]))) { memo.set(k, false); v = perched(k3([x, y - 1, z])) }
    memo.set(k, v)
    return v
  }
  const per = [...cand.keys()].filter(perched)
  for (const k of cand.keys()) if (!memo.get(k)) verdict.set(k, 'not_perched')
  census.perched = per.length
  // judged top down: a candidate that is not listed stops counting as listed for those under it
  const live = new Set(per)
  const order = per.map(k => cand.get(k)).sort((a, b) => b.at[1] - a.at[1] || a.at[0] - b.at[0] || a.at[2] - b.at[2])
  const ok = new Map()
  for (const c of order) {
    const ai = areaOf(c.at[0], c.at[2])
    if (ai < 0) { census.far++; live.delete(k3(c.at)); verdict.set(k3(c.at), 'far'); continue }
    const v = floatVerdict(c, read, { listed: k => live.has(k), cells, zone })
    if (v === 'take' || v === 'above') { ok.set(k3(c.at), { ...c, ai }); continue }
    why(v, k3(c.at)); live.delete(k3(c.at))
  }
  // a listed cell whose `above` was dropped later in the pass is held (it holds a cell that is not listed)
  for (const [k, c] of [...ok]) if (floatVerdict(c, read, { listed: q => ok.has(q), cells, zone }) === 'holds') { ok.delete(k); why('holds', k) }
  // beams
  const beamOf = new Map(), beams = []
  for (const k of ok.keys()) {
    if (beamOf.has(k)) continue
    const id = beams.length, q = [k], mem = []
    beamOf.set(k, id)
    while (q.length) {
      const cur = q.pop(); mem.push(cur)
      const [x, y, z] = cur.split(',').map(Number)
      for (const [dx, dy, dz] of N6) { const n = k3([x + dx, y + dy, z + dz]); if (ok.has(n) && !beamOf.has(n)) { beamOf.set(n, id); q.push(n) } }
    }
    const cs = mem.map(m => ok.get(m))
    const ai = Math.min(...cs.map(c => c.ai))
    const dist = Math.min(...cs.map(c => Math.max(Math.abs(c.at[0] - home.x), Math.abs(c.at[2] - home.z))))
    beams.push({ id, ai, dist, cells: cs.sort((a, b) => b.at[1] - a.at[1] || a.at[0] - b.at[0] || a.at[2] - b.at[2]) })
  }
  beams.sort((a, b) => a.ai - b.ai || a.dist - b.dist || a.id - b.id)
  const names = [...areas.map(a => a.name), 'town']
  const jobs = []
  beams.forEach((bm, i) => { for (const c of bm.cells) jobs.push({ at: c.at, name: c.name, placer: c.placer, t: c.t, area: names[bm.ai], beam: i }) })
  census.listed = jobs.length
  census.beams = beams.length
  census.by_area = Object.fromEntries(names.map(n => [n, jobs.filter(j => j.area === n).length]))
  for (const j of jobs) verdict.set(k3(j.at), 'listed')
  return { jobs, census, verdict, beams: beams.map((b, i) => ({ beam: i, area: names[b.ai], n: b.cells.length, top: b.cells[0].at })) }
}

/**
 * THE GUARD (the lap's, Codex r1/r2 BLOCKERS) -> (k) -> bool. Pure. `records`: every guarded project's record (each [x,y,z] it lists
 * anywhere -- `at` or `cell` of any top-level array: its cells AND its clears, cuts, replants, trees); `extra`: more cell keys (the
 * bridges' planned cells); `plan`: the town plan as townPlanHead gives it (`head.plan`): every plot's box [x0, z0, x1, z1] guards its
 * columns, every height.
 */
export function floatGuardOf ({ records = [], extra = [], plan = null } = {}) {
  const out = new Set(extra)
  const tri = a => Array.isArray(a) && a.length === 3 && a.every(Number.isInteger)
  for (const rec of records) for (const v of Object.values(rec ?? {})) if (Array.isArray(v)) for (const q of v) { const at = q?.at ?? q?.cell; if (tri(at)) out.add(at.join(',')) }
  const boxes = (plan?.plots ?? []).map(p => p?.box).filter(b => Array.isArray(b) && b.length === 4)
  return k => { if (out.has(k)) return true; const [x, , z] = k.split(',').map(Number); return boxes.some(b => x >= b[0] && x <= b[2] && z >= b[1] && z <= b[3]) }
}
/** A job list as read from a file -> the list | null (malformed, or another pool's). Pure. */
export function floatListOk (doc, pool) {
  if (!doc || doc.v !== 1 || !Array.isArray(doc.jobs)) return null
  if (String(doc.pool ?? '') !== String(pool ?? '')) return null
  const jobs = doc.jobs.filter(j => Array.isArray(j?.at) && j.at.length === 3 && j.at.every(Number.isInteger) && typeof j.name === 'string')
  return { ...doc, jobs }
}
/** The newer of two lists (by `surveyedAt`) -> list | null. Pure. */
export const floatListNewer = (a, b) => (!a ? b : !b ? a : (Number(b.surveyedAt) || 0) > (Number(a.surveyedAt) || 0) ? b : a)

/**
 * THE PASS'S JOBS NOW -> { take: [clear], held: [{ job, why }], closed: n, census, floor }. Pure over `read`. `floor`: every listed
 * cell still standing (taken or held) -- never a stand (the visit's `clearNoFloor`: a bot never stands on a floating block).
 *   list     the job list (its order kept)
 *   aside    (k) -> bool: set aside by this bot (floatAside)
 *   cells, zone   as floatVerdict
 *   max      take at most this many (the list's order: the first beams first)
 * `take` entries are runVisit clears: { at, kind: 'float', name: the block the cell reads NOW (greened dirt), placer, beam, area }.
 * A listed cell under a take-able one (`above`) is taken too, after it.
 * `part` of `parts` (the bot's admission slot of the plot's slots): the beams `beam % parts === part` first, the others after them
 * -- the crew works different beams at once, each in the list's order.
 */
export function floatPassJobs (list, read, { aside = () => false, cells = () => false, zone = () => false, max = FC.passMax, part = null, parts = 1 } = {}) {
  const jobs = list?.jobs ?? []
  const census = { listed: jobs.length, standing: 0, take: 0, aside: 0, closed: 0, why: {} }
  // the list's cells still standing as listed (the `listed` of the verdict)
  const standing = new Set()
  for (const j of jobs) { const b = read(...j.at); if (b && sameBlock(nm(b), j.name)) standing.add(k3(j.at)) }
  census.standing = standing.size
  const take = [], held = [], later = []
  const mine = j => part == null || !(parts > 1) || (((Number(j.beam) || 0) % parts) + parts) % parts === part
  for (const j of jobs) {
    const k = k3(j.at)
    const v = floatVerdict(j, read, { listed: q => standing.has(q), cells, zone })
    if (CLOSES.includes(v)) { census.closed++; continue }
    if (aside(k)) { census.aside++; continue }
    if (v === 'take' || v === 'above') {
      const q = { at: [...j.at], kind: 'float', name: nm(read(...j.at)), placer: j.placer ?? '-', beam: j.beam ?? -1, area: j.area ?? '-' }
      if (!mine(j)) later.push(q)
      else if (take.length < max) take.push(q)
      continue
    }
    census.why[v] = (census.why[v] ?? 0) + 1
    held.push({ job: j, why: v })
  }
  for (const q of later) if (take.length < max) take.push(q)
  census.take = take.length
  return { take, held, closed: census.closed, census, floor: standing }
}
/**
 * THE CHECK AT THE DIG (runVisit `clearOk`, read before the walk and again after it, nothing awaited between it and the dig) -> bool.
 * Pure over `read`. Only a `float` clear is judged; the cell must read `take` now (a listed cell still over it: not yet). `listed(k)`:
 * the pass's take-list cells. `under`: the cells under the bot's body now; `floating(k)`: a listed cell still standing -- the bot never
 * digs the block it stands on, and never digs while standing on a floating listed block. `others`: the cells under every other
 * body near it (players, mobs) -- never dug from under them.
 */
export function floatClearOk (c, read, { listed = () => false, cells = () => false, zone = () => false, under = [], floating = () => false, others = [] } = {}) {
  if (c?.kind !== 'float') return true
  // ANOTHER BODY (rig 11-20: Kite dug the floating grass block Juno stood on; Juno fell 3 blocks): never a block any other player
  // or mob stands on (`others`: the cells under their bodies) -- it waits for the next lap
  if (others.includes(k3(c.at))) return false
  // THE BODY (Codex r1 BLOCKER 1: a walk that did not arrive left the bot on the beam, and it dug the block under itself): never the
  // block the bot stands on, and nothing at all while the bot stands on a floating listed block -- it walks off first
  if (under.includes(k3(c.at)) || under.some(k => floating(k))) return false
  return floatVerdict(c, read, { listed: k => listed(k) && !!read(...k.split(',').map(Number)) && isSolid(read(...k.split(',').map(Number))), cells, zone }) === 'take'
}

/**
 * THE SET-ASIDE MEMORY (one bot's) after a pass -> { mem, aside: [{ k, tries }] }. Pure. `mem` { tries: { k: n }, until: { k: t } }.
 *   offered   the take-list's cells; standing(k) -> bool: still standing after the pass; complete: the pass ran its list out (its
 *   visit stopped `complete`: every offered cell was considered -- a deadline or an abort says nothing about a cell)
 * `considered(k)` (rig 11-20: laps that ran into their deadline on walks that never arrived re-offered the same cells forever): the
 * visit asked its dig-time check for the cell (runVisit `clearOk`, asked before it looks for a stand and walks) -- default: `complete`.
 * A cell offered, considered and still standing gets a try; at FC.asideTries it is set aside until now + FC.asideMs. A cell dug
 * (no longer standing) forgets its tries.
 */
export function floatAsideAfter (mem0, { offered = [], standing = () => true, complete = false, considered = () => complete, now = Date.now(), F = FC } = {}) {
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
export const floatAsideNow = (mem, k, now = Date.now()) => (Number(mem?.until?.[k]) || 0) > now

/** One `_floatclean` row's detail. Pure. */
export const floatDetail = f => Object.entries(f).filter(([, v]) => v != null && v !== '').map(([k, v]) => `${k}=${String(Array.isArray(v) ? v.join(',') : typeof v === 'object' ? Object.entries(v).map(([a, b]) => `${a}:${b}`).join(',') : v).replace(/\s+/g, '_').slice(0, 160)}`).join(' ')
