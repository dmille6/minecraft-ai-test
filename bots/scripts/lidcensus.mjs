#!/usr/bin/env node
// lidcensus.mjs -- which TOWN containers have a blocked lid, and what sits on them (lidclear-01 evidence). OFFLINE and
// READ-ONLY: region files are copies (scp from the world host; no world command runs), the town state dir is a copy.
//
//   node scripts/lidcensus.mjs <pool> <region.mca> <entities.mca|-> <statedir> [--json]
//
// The town's container keys are found the way skills.mjs townCobbleScan finds them (every chest, trapped_chest and
// barrel with inTown && depositTargetOk around home, a double chest keyed at its lower cell), plus every key the town's
// journal holds a count for. Per container: the block above judged by the BOT's rule (skills.mjs chestLidBlocked) and by
// the SERVER's (lidrule.mjs serverLidBlocks: a redstone-conductor block above, or a cat sitting on it), the count's age
// in the journal, and what the town's container memory says. The world may be up to one autosave behind.
import fs from 'node:fs'
import zlib from 'node:zlib'
import { createRequire } from 'node:module'
import { loadRegion, reader } from './wellsite-replay.mjs'
import { inTown, depositTargetOk, TOWN_SCAN_RADIUS, chestPartnerOffset, isChestPartner } from '../src/chestfull.mjs'
import { readTown, OBS_TTL_MS } from '../src/cobblecap.mjs'
import { chestLidBlocked } from '../src/lidrule.mjs'
import { serverLidBlocks, lidClearRefusal } from '../src/lidrule.mjs'
const require = createRequire(import.meta.url)
const nbt = require('prismarine-nbt')

const [pool, regionFile, entFile, stateDir] = process.argv.slice(2)
const asJson = process.argv.includes('--json')
const files = fs.readdirSync(stateDir)
const tk = files.map(f => /^town-chest-(-?\d+_-?\d+_-?\d+)\.containers\.json$/.exec(f)?.[1]).find(Boolean)
if (!tk) { console.error('no town in', stateDir); process.exit(2) }
const [hx, hy, hz] = tk.split('_').map(Number)
const home = { x: hx, y: hy, z: hz }
const mem = JSON.parse(fs.readFileSync(`${stateDir}/town-chest-${tk}.containers.json`, 'utf8'))
const world = mem.world ?? null
const st = readTown(stateDir, `town-chest-${tk}`, world, { rotateBytes: 1e12, ckptEvery: 1e12 })
const read = reader(loadRegion(regionFile))

// cats (and anything else) sitting on a container: the entities file
const cats = []
let entChunks = 0, entFailed = 0, entities = 0
if (entFile && entFile !== '-') {
  const buf = fs.readFileSync(entFile)
  for (let i = 0; i < 1024; i++) {
    const loc = buf.readUInt32BE(i * 4), off = (loc >>> 8) * 4096
    if (!off || !(loc & 255)) continue
    try {
      const len = buf.readUInt32BE(off), comp = buf[off + 4], data = buf.subarray(off + 5, off + 4 + len)
      entChunks++
      const root = nbt.simplify(nbt.parseUncompressed(comp === 2 ? zlib.inflateSync(data) : comp === 1 ? zlib.gunzipSync(data) : data, 'big'))
      for (const e of root.Entities ?? []) { entities++; if (e.id === 'minecraft:cat') cats.push({ id: e.id, pos: e.Pos, sitting: !!(e.Sitting ?? 0) }) }
    } catch { entFailed++ }   // counted and printed: a zero cats claim needs the decode coverage beside it
  }
}

const ckey = (x, y, z) => `${x},${y},${z}`
const CONT = /^(chest|trapped_chest|barrel)$/
const keys = new Map()
for (let x = hx - TOWN_SCAN_RADIUS; x <= hx + TOWN_SCAN_RADIUS; x++) {
  for (let z = hz - TOWN_SCAN_RADIUS; z <= hz + TOWN_SCAN_RADIUS; z++) {
    for (let y = hy - TOWN_SCAN_RADIUS; y <= hy + TOWN_SCAN_RADIUS; y++) {
      const q = { x, y, z }
      if (!inTown(home, q) || !depositTargetOk(home, q)) continue
      const b = read(x, y, z)
      if (!b || !CONT.test(b.name)) continue
      keys.set(ckey(x, y, z), { x, y, z, name: b.name, props: b.props })
    }
  }
}
// ...plus every key the town's journal holds a count for (townCobbleScan keeps a counted container the scan missed)
for (const k0 of Object.keys(st?.obs ?? {})) {
  if (keys.has(k0)) continue
  const [x, y, z] = k0.split(',').map(Number)
  const b = read(x, y, z)
  if (b && CONT.test(b.name) && inTown(home, { x, y, z })) keys.set(k0, { x, y, z, name: b.name, props: b.props })
}
// ONE KEY PER CONTAINER (skills.mjs containerKey): a double chest is one inventory at two cells, keyed at the lower cell
// (x, then z); its lid is blocked when EITHER half's is (vanilla combines the two halves' isChestBlockedAt)
const partnerOf = c => {
  const off = chestPartnerOffset(c.props ?? {})
  if (!off) return null
  const q = { x: c.x + off.x, y: c.y, z: c.z + off.z }
  const b = read(q.x, q.y, q.z)
  return b && isChestPartner({ name: c.name, props: c.props }, { name: b.name, props: b.props }) ? { ...q, name: b.name, props: b.props } : null
}
const doubles = new Map()
for (const [k, c] of [...keys]) {
  const q = partnerOf(c)
  if (!q) continue
  const lower = (q.x < c.x || (q.x === c.x && q.z < c.z)) ? q : c, upper = lower === c ? q : c
  keys.delete(ckey(upper.x, upper.y, upper.z))
  keys.set(ckey(lower.x, lower.y, lower.z), { ...lower, name: c.name, props: lower.props ?? c.props })
  doubles.set(ckey(lower.x, lower.y, lower.z), upper)
}
const now = Date.now()
const out = { pool, town: tk, world, containers: 0, chests: 0, doubles: doubles.size, barrels: 0, botBlocked: 0, serverBlocked: 0, disagree: 0, rows: [] }
// a cat SITTING with its box over the lid (vanilla: a sitting cat in the AABB one block above the chest)
const catOn = c => cats.find(e => e.sitting && Array.isArray(e.pos) && e.pos[0] > c.x - 0.3 && e.pos[0] < c.x + 1.3 && e.pos[2] > c.z - 0.3 && e.pos[2] < c.z + 1.3 &&
  e.pos[1] >= c.y + 0.5 && e.pos[1] < c.y + 2)
for (const [k, c] of keys) {
  out.containers++
  if (c.name === 'barrel') out.barrels++; else out.chests++
  // the half whose lid is blocked (either half blocks a double chest); the lower key's lid first
  const halves = [c, ...(doubles.has(k) ? [doubles.get(k)] : [])]
  const lidOf = h => read(h.x, h.y + 1, h.z)
  const isChest = c.name !== 'barrel'
  const blockedHalf = halves.find(h => isChest && (chestLidBlocked(lidOf(h)) || serverLidBlocks(lidOf(h), { cat: !!catOn(h) }))) ?? c
  const above = lidOf(blockedHalf)
  const below = read(blockedHalf.x, blockedHalf.y - 1, blockedHalf.z)
  const cat = catOn(blockedHalf)
  const bot = isChest && halves.some(h => chestLidBlocked(lidOf(h)))
  const srv = isChest && halves.some(h => serverLidBlocks(lidOf(h), { cat: !!catOn(h) }))
  if (bot) out.botBlocked++
  if (srv) out.serverBlocked++
  if (bot !== srv) out.disagree++
  const o = st?.obs?.[k]
  const age = o?.at ? Math.round((now - o.at) / 60000) : null
  const m = mem.entries?.[k]
  // the bot's own decision (lidrule.mjs lidClearRefusal) on the same cells: may the block on this lid be broken?
  const h = blockedHalf
  const clear = (bot || srv) ? lidClearRefusal({ lid: above, above: read(h.x, h.y + 2, h.z),
    sides: [read(h.x + 1, h.y + 1, h.z), read(h.x - 1, h.y + 1, h.z), read(h.x, h.y + 1, h.z + 1), read(h.x, h.y + 1, h.z - 1)] }) : null
  out.rows.push({ k, kind: c.name + (doubles.has(k) ? '(double)' : ''), lidAt: ckey(h.x, h.y + 1, h.z), above: above?.name ?? null, above2: read(h.x, h.y + 2, h.z)?.name ?? null, below: below?.name ?? null,
    botBlocked: bot, serverBlocked: srv, cat: cat ? cat.id : null, obsAgeMin: age, obsFresh: age !== null && age * 60000 < OBS_TTL_MS,
    memory: m ? m.o : null, clear: clear ?? (bot || srv ? 'ok' : null) })
}
if (asJson) { console.log(JSON.stringify(out)); process.exit(0) }
console.log(`${pool} town ${tk} containers=${out.containers} (chests ${out.chests} of which double ${out.doubles}, barrels ${out.barrels}) lid-blocked bot-rule=${out.botBlocked} server-rule=${out.serverBlocked} disagree=${out.disagree} | entities: chunks ${entChunks} unreadable ${entFailed} entities ${entities} cats ${cats.length} sitting ${cats.filter(c => c.sitting).length}`)
for (const r of out.rows) if (r.botBlocked || r.serverBlocked || !r.obsFresh) console.log(`  ${r.k} ${r.kind} lid@${r.lidAt} above=${r.above} (+2 ${r.above2}) below=${r.below} bot=${r.botBlocked ? 1 : 0} srv=${r.serverBlocked ? 1 : 0}${r.cat ? ' CAT' : ''} obs=${r.obsAgeMin ?? 'never'}min mem=${r.memory ?? '-'} clear=${r.clear ?? '-'}`)
