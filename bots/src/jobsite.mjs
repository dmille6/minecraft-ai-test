// JOBSITE-01 ("make jobs"; trading design docs/reports/trading-design-2026-11-03.md section 12). Pure decisions.
//
// WHY. MEASURED 11-05: no fleet census holds a mason (0 in 16 pools), so coalsale-02's stone sale has no buyer; the same worlds
// hold many UNEMPLOYED adults (board-a 18 of 38 villagers). PROVEN sandbox4 11-03 (sandbox/trading/trade-proof.cjs): an
// unemployed villager takes a job-site block a bot placed in survival in 5.5 s (smithing table -> toolsmith; fletching table ->
// fletcher), with mobGriefing true and false. Control session 11-05 (owner: bots may change the world; trading approved): a bot
// on a trade trip places a STONECUTTER (1 iron + 3 stone) beside a cluster of unemployed adults; the villager becomes a MASON,
// who buys stone and sells bricks. A lectern (librarians) waits for leather.
// RULES: one job site per unemployed cluster (none within 32 b of an earlier one, or of any stonecutter already there); never
// inside a protected zone (the fleet has none; protectzone's chokepoint refuses one anyway); never break a block; never on a
// path, a door, a bed, a chest or another job site, nor beside a door; at most JOB.perDay per town per day; the town keeps 64 iron.
export const JOB = Object.freeze({
  block: 'stonecutter',
  perDay: 2,
  ironKeep: 64,
  clusterR: 16,
  near: 5,                     // the cell is within this of an unemployed villager (a job site is sought within 48 b; reachable)
  spacing: 32,                 // no second job site this close to an earlier one or an existing stonecutter
  claimWaitMs: 12_000,
})
export function jobsiteSwitch (env = process.env) {
  const v = String(env.JOBSITE ?? '').toLowerCase()
  return !(v === '0' || v === 'off' || v === 'false')
}
export const jobsiteModeDetail = on => `on=${on ? 1 : 0} block=${JOB.block} per_day=${JOB.perDay} iron_keep=${JOB.ironKeep} spacing=${JOB.spacing}`

const bare = n => String(n ?? '').replace(/^minecraft:/, '')
// every village job-site block (1.21): a cell next to one of these is never chosen; the stonecutter itself counts too
export const JOB_BLOCKS = /^(composter|blast_furnace|smoker|cartography_table|brewing_stand|barrel|fletching_table|cauldron|water_cauldron|lava_cauldron|powder_snow_cauldron|lectern|stonecutter|loom|smithing_table|grindstone)$/
const NO_TOUCH = /(_door$|_trapdoor$|_bed$|chest$|^barrel$|^bell$|_fence$|_fence_gate$|_wall$|_pane$|^glass$|_sign$|_carpet$|^hay_block$|^farmland$|^dirt_path$|_stairs$|_slab$|torch$|^lantern$|^campfire$)/
const AIR = /^(air|cave_air|void_air)$/
const PLANT = /^(short_grass|grass|tall_grass|fern|large_fern|dandelion|poppy|[a-z_]*_tulip|allium|azure_bluet|oxeye_daisy|cornflower|snow)$/
const FLOOR_OK = /^(grass_block|dirt|coarse_dirt|podzol|stone|cobblestone|mossy_cobblestone|gravel|sand|red_sand|sandstone|snow_block|packed_ice|andesite|diorite|granite|deepslate|tuff|mud|rooted_dirt|moss_block|[a-z_]+_planks|terracotta|[a-z_]+_terracotta)$/

/** Unemployed adult villagers grouped into clusters (single link, clusterR). Pure. merchants: trade.mjs merchantOf shape. */
export function unemployedClusters (merchants, { r = JOB.clusterR } = {}) {
  const pts = (merchants ?? []).filter(m => m && m.profession === 'none' && !m.baby)
  const groups = []
  for (const m of pts) {
    const hits = groups.filter(g => g.some(o => Math.hypot(o.x - m.x, o.z - m.z) <= r))
    const merged = [m, ...hits.flat()]
    for (const h of hits) groups.splice(groups.indexOf(h), 1)
    groups.push(merged)
  }
  return groups.map(g => ({ n: g.length, uuids: g.map(m => m.uuid), x: g.reduce((a, m) => a + m.x, 0) / g.length, y: Math.floor(Math.min(...g.map(m => m.y))), z: g.reduce((a, m) => a + m.z, 0) / g.length, members: g }))
    .sort((a, b) => b.n - a.n)
}

/** The town's job-site ledger -> may a job site go here today? -> { ok, why }. Pure. ledger: [{x, z, at}] for this pool. */
export function jobsiteAdmit ({ ledger = [], now = 0, at = null, townIron = 0, haveBlock = false, perDay = JOB.perDay, spacing = JOB.spacing, ironKeep = JOB.ironKeep } = {}) {
  const today = (ledger ?? []).filter(e => now - (e.at ?? 0) < 24 * 3600_000).length
  if (today >= perDay) return { ok: false, why: 'day_cap' }
  if (at && (ledger ?? []).some(e => Math.hypot(e.x - at.x, e.z - at.z) < spacing)) return { ok: false, why: 'cluster_done' }
  if (!haveBlock && townIron <= ironKeep) return { ok: false, why: 'iron_keep' }
  return { ok: true, why: 'go' }
}

/**
 * THE CELL for the job site beside a cluster -> { cell, below, standNear } | { cell: null, why }. Pure: blockAt(x, y, z) ->
 * { name } | null. A cell is AIR (or a small plant, never a village block), with air above (a villager reaches it), standing on
 * a natural / plain floor block (never a path, farmland, slab, stair, carpet ...), with no door, bed, chest, bell or job site in
 * its 8 neighbours at the same level or the floor below (it never blocks a door or crowds another job site), and at least one
 * side neighbour a villager can stand in. Within JOB.near of a cluster member; the nearest to the members first.
 * existingJob: a JOB_BLOCKS cell within spacing -> 'jobsite_near' (a site is already there: the cluster is penned or busy).
 */
export function pickJobCell (blockAt, cluster, { near = JOB.near, spacing = JOB.spacing, existing = [] } = {}) {
  const at = (x, y, z) => { try { return blockAt(x, y, z) } catch { return null } }
  if (!cluster?.members?.length) return { cell: null, why: 'no_cluster' }
  if ((existing ?? []).some(p => Math.hypot(p.x - cluster.x, p.z - cluster.z) < spacing)) return { cell: null, why: 'jobsite_near' }
  const cands = []
  const seen = new Set()
  for (const m of cluster.members) {
    const fx = Math.floor(m.x), fy = Math.floor(m.y + 1e-6), fz = Math.floor(m.z)
    for (let dx = -near; dx <= near; dx++) for (let dz = -near; dz <= near; dz++) for (const dy of [0, -1, 1]) {
      const x = fx + dx, y = fy + dy, z = fz + dz, k = `${x},${y},${z}`
      if (seen.has(k) || Math.hypot(dx, dz) > near || (dx === 0 && dz === 0 && dy === 0)) continue
      seen.add(k)
      cands.push({ x, y, z, d: Math.min(...cluster.members.map(o => Math.hypot(o.x - (x + 0.5), o.z - (z + 0.5)))) })
    }
  }
  cands.sort((a, b) => a.d - b.d)
  let why = 'no_cell'
  for (const c of cands) {
    if (c.d < 1.5) continue                                    // never on a villager's own cell or touching it
    const here = at(c.x, c.y, c.z), up = at(c.x, c.y + 1, c.z), below = at(c.x, c.y - 1, c.z)
    if (!here || !up || !below) { why = 'unloaded'; continue }
    if (!(AIR.test(bare(here.name)) || PLANT.test(bare(here.name)))) continue
    if (!AIR.test(bare(up.name)) && !PLANT.test(bare(up.name))) continue
    if (!FLOOR_OK.test(bare(below.name))) continue
    let bad = false, reach = false
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const n0 = at(c.x + dx, c.y, c.z + dz), nb = at(c.x + dx, c.y - 1, c.z + dz), n1 = at(c.x + dx, c.y + 1, c.z + dz)
      if (!n0 || !nb || !n1) { bad = true; break }
      for (const b of [n0, nb, n1]) if (NO_TOUCH.test(bare(b.name)) || JOB_BLOCKS.test(bare(b.name))) bad = true
      if (Math.abs(dx) + Math.abs(dz) === 1 && (AIR.test(bare(n0.name)) || PLANT.test(bare(n0.name))) && AIR.test(bare(n1.name)) && FLOOR_OK.test(bare(nb.name))) reach = true
    }
    if (bad || !reach) continue
    return { cell: { x: c.x, y: c.y, z: c.z }, below: { x: c.x, y: c.y - 1, z: c.z }, d: +c.d.toFixed(1), replaces: bare(here.name) }
  }
  return { cell: null, why }
}

/** Did a cluster member take the job? -> 'claimed:<profession>' | 'unclaimed'. Pure (merchantOf shapes after the wait). */
export function claimOf (cluster, merchantsNow) {
  const ids = new Set(cluster?.uuids ?? [])
  const m = (merchantsNow ?? []).find(v => ids.has(v.uuid) && v.profession !== 'none' && v.profession !== 'unknown')
  return m ? `claimed:${m.profession}` : 'unclaimed'
}
export const jobsiteDetail = ({ op, cell = null, cluster = null, why = null, claim = null, d = null }) =>
  `op=${op}${cell ? ` at=${cell.x},${cell.y},${cell.z}` : ''}${cluster ? ` cluster=${cluster.n}@${Math.floor(cluster.x)},${Math.floor(cluster.z)}` : ''}${d != null ? ` d=${d}` : ''}${why ? ` why=${why}` : ''}${claim ? ` ${claim}` : ''} block=${JOB.block}`
