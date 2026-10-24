// TOWNPLAN-01 ON THE 10-23 FLEET (JIT 10-23c): townplan-01 was built on indexsearch-01 d0a27a5e; since then the fleet gained
// ironpick-01, keepout-01, protectzone-01, townindex-01's JIT line and poolescape-01. Where the plan meets them, behaviour only:
//
//   1. PROTECTZONE: one zones file, two parsers (townplan's own, protectzone's guard). Every zone the guard protects is a zone the
//      planner avoids (or the planner refuses to plan at all): the planner's view is a SUPERSET of the guard's.
//   2. PROTECTZONE: a READY cell is a cell the guard will let found click into. The guard judges three cells for a placement at
//      an explicit cell (the floor reference, the destination, the cell above); readyCell judged two. A cell under a zone's
//      bottom face was READY and the guard refused the click every visit -- readyCell now judges the third (the one production
//      change of this re-stack). Property over a grid, both modules' own decisions, plus the showcase plan and zones file.
//   3. PROTECTZONE: the guard's findBlocks filter means the planner's context never sees a container inside a zone (a retrofit
//      store never adopts the village's chest); positive control without the guard.
//   4. PATHFINDER: the plan's furniture price, the junk well's and the zone price are all in the SHARED break array, set before
//      the clones copy it (index.mjs wiring: a structural invariant behaviour cannot reach from a unit test).
//   5. POOLESCAPE: its stair and plug never CLICK a plan's furniture as a reference (INTERACTIVE covers every kind the plan
//      places), and a plug cell (water) is never a READY plan cell. NOT COVERED (and not true): poolescape's dig list can CUT a
//      station or chest at its head/clearance cell -- base behaviour for any town block, a named follow-up (JIT 10-23c Q1).
import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { createRequire } from 'node:module'

process.env.LOG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-tpc-logs-'))
process.env.BOT_NAME = 'ComposeBot'
process.env.OLLAMA_MODEL ??= 'qwen2.5:7b-instruct'
process.env.HOME_X = '0'; process.env.HOME_Y = '64'; process.env.HOME_Z = '0'
process.env.LOG_LEVEL = 'error'
process.env.MEMORY_SCOPE = 'board'
process.env.PLINTH_FIRST = '0'
process.env.POOL_STATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-tpc-pool-'))

const T = await import('../src/townplan.mjs')
const PZ = await import('../src/protectzone.mjs')
const PE = await import('../src/poolescape.mjs')
const S = await import('../src/skills.mjs')
const { fakeWorld } = await import('./fakeworld.mjs')
const TP_PATH = new URL('../src/townplan.mjs', import.meta.url)
const SKILLS_PATH = new URL('../src/skills.mjs', import.meta.url)
const require_ = createRequire(import.meta.url)
const mcData = require_('minecraft-data')('1.21.8')

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 5).join('\n        ')}`) }
}
async function withMutant (p, old, neu, fn) {
  const src = readFileSync(p, 'utf8')
  assert.ok(src.includes(old), `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 70))} is not in ${p.pathname}. A mutant that was never written reads as killed.`)
  assert.ok(src.split(old).length === 2, 'the mutation target is not unique; the mutant is ambiguous')
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, src.replace(old, neu).replace(/from '\.\//g, "from '../src/"))
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}
async function killedBy (fn) { try { await fn(); return false } catch { return true } }

/** townplan.test's fake read: grass at y <= G, air above, cells set by name, boxes from minecraft-data 1.21.8. */
const G = 69
function world ({ cells = {}, ground = G } = {}) {
  const box = n => mcData.blocksByName[n]?.boundingBox ?? 'block'
  const shapes = n => box(n) === 'block' ? [[0, 0, 0, 1, 1, 1]] : []
  return (x, y, z) => {
    const name = cells[`${x},${y},${z}`] ?? (y <= ground ? (y === ground ? 'grass_block' : 'dirt') : 'air')
    return { name, boundingBox: box(name), shapes: shapes(name), props: null }
  }
}
const HOME = { x: 100, y: 70, z: 100 }
/** townplan's zone ({ id, box }) -> protectzone's ({ x0..z1 }) through protectzone's OWN parser (the guard's view). */
const pzOf = zs => PZ.parseZones({ version: 1, zones: zs.map(z => ({ id: z.id, box: z.box })) }).zones
/** The cells protectzone's place guard judges for found's click at `at` (skills.mjs place(): ref = the floor, face UP). */
const guardCells = ([x, y, z]) => [[x, y - 1, z], [x, y, z], [x, y + 1, z]]

console.log('townplan x protectzone: one file, two parsers')
// seeded PRNG: the fuzz is the same every run
let seed = 20261023
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff }
const pick = a => a[Math.floor(rnd() * a.length)]
function fuzzZone (i) {
  const x0 = Math.floor(rnd() * 200 - 100), y0 = pick([-64, 40, 60, 71, 72]), z0 = Math.floor(rnd() * 200 - 100)
  const box = [x0, y0, z0, x0 + Math.floor(rnd() * 40), y0 + Math.floor(rnd() * 60), z0 + Math.floor(rnd() * 40)]
  const z = { id: pick([`z${i}`, `z${i}`, `z${i}`, '', undefined]), box }
  const m = rnd()
  if (m < 0.08) z.box = box.map(v => v + 0.5)              // non-integer: the guard drops it, the planner floors it
  else if (m < 0.14) z.box = [box[3], box[1], box[2], box[0], box[4], box[5]]   // inverted
  else if (m < 0.18) z.box = box.slice(0, 5)                 // short
  else if (m < 0.22) z.floor_y = 'x'                         // a bad floor_y: the guard drops the zone
  else if (m < 0.30) z.floor_y = box[1] + 1
  return z
}
await t('SUPERSET (fuzz, 400 files): every zone the guard protects is a zone the planner avoids -- or the planner plans nothing (unknown / stale)', () => {
  let protectedSeen = 0, plannerRefused = 0, plannerKept = 0
  for (let f = 0; f < 400; f++) {
    const json = { version: 1, hashed_seed: pick(['w', 'w', 'other', undefined]), zones: Array.from({ length: 1 + Math.floor(rnd() * 5) }, (_, i) => fuzzZone(i)) }
    const g = PZ.parseZones(json, { worldId: 'w' })
    const p = T.parseZones(json, 'w')
    // townPlanZones: known only when ok and nothing dropped (a partly malformed file is stale/unknown -> no root, no fit, no found)
    const plannerUses = p.ok && !/^(dropped|guard_drops) /.test(p.why)
    for (const z of g.zones) {
      protectedSeen++
      if (!plannerUses) { plannerRefused++; continue }
      const same = p.zones.find(q => q.box.join() === [z.x0, z.y0, z.z0, z.x1, z.y1, z.z1].join())
      assert.ok(same, `the guard protects ${z.id} ${[z.x0, z.y0, z.z0, z.x1, z.y1, z.z1]} and the planner does not avoid it: ${JSON.stringify(json)}`)
      plannerKept++
    }
  }
  // POSITIVE CONTROLS: the fuzz reached both branches
  assert.ok(protectedSeen > 200, `zones protected ${protectedSeen}`)
  assert.ok(plannerKept > 50 && plannerRefused > 20, `kept ${plannerKept} refused ${plannerRefused}`)
})
await t('SUPERSET THROUGH THE REAL READERS (fuzz, 150 edit pairs: a good file, then a fuzzed edit): whenever the planner says known, it avoids every zone the guard protects', () => {
  const dir = process.env.POOL_STATE_DIR, file = path.join(dir, 'protected-zones.json')
  const bot = { worldId: 'w' }
  let checked = 0, unknown = 0, partial = 0
  for (let f = 0; f < 150; f++) {
    S.resetPlanZones()
    const good = { version: 1, hashed_seed: 'w', zones: Array.from({ length: 1 + Math.floor(rnd() * 3) }, (_, i) => ({ id: `g${i}`, box: [i * 50, -64, 0, i * 50 + 9, 90, 9] })) }
    fs.writeFileSync(file, JSON.stringify(good))
    const guard = PZ.zoneReader({ file: () => file, worldId: () => 'w' }); guard.refresh()
    S.townPlanZones(bot, 1e9 + f * 1e6)
    const edit = { version: pick([1, 1, 1, 2]), hashed_seed: pick(['w', 'w', undefined]), zones: Array.from({ length: 1 + Math.floor(rnd() * 4) }, (_, i) => fuzzZone(i)) }
    const roll = rnd()
    fs.writeFileSync(file, roll < 0.08 ? '{"version": 1, "zones": [' : roll < 0.16 ? 'null' : JSON.stringify(edit))   // torn, JSON null, an edit
    guard.refresh()
    const v = S.townPlanZones(bot, 1e9 + f * 1e6 + 60_000)
    if (/^stale:(dropped|guard_drops)/.test(v.why)) partial++
    if (!v.known) { unknown++; continue }
    for (const z of guard.zones()) {
      checked++
      assert.ok(v.zones.some(q => q.box.join() === [z.x0, z.y0, z.z0, z.x1, z.y1, z.z1].join()), `the guard protects ${z.id} after ${JSON.stringify(edit)}; the planner (${v.why}) does not avoid it`)
    }
  }
  fs.unlinkSync(file); S.resetPlanZones()
  assert.ok(checked > 150 && partial > 10, `checked ${checked}, partial edits ${partial}, unknown ${unknown}`)
})
async function guardDropsEdit (M) {
  const dir = process.env.POOL_STATE_DIR, file = path.join(dir, 'protected-zones.json')
  M.resetPlanZones()
  const bot = { worldId: 'w' }
  fs.writeFileSync(file, JSON.stringify({ version: 1, hashed_seed: 'w', zones: [{ id: 'old', box: [0, -64, 0, 5, 90, 5] }] }))
  const guard = PZ.zoneReader({ file: () => file, worldId: () => 'w' }); guard.refresh()
  M.townPlanZones(bot, 2e9)
  // an edit whose ONLY zone has no id: the guard drops it and keeps `old` (all_malformed); townplan can parse it
  fs.writeFileSync(file, JSON.stringify({ version: 1, hashed_seed: 'w', zones: [{ box: [20, -64, 20, 30, 90, 30] }] }))
  guard.refresh()
  assert.deepEqual(guard.zones().map(z => z.id), ['old'], 'POSITIVE CONTROL: the guard keeps its last good list')
  const v = M.townPlanZones(bot, 2e9 + 60_000)
  assert.equal(v.known, true)
  assert.ok(v.zones.some(z => z.id === 'old'), `the planner still avoids old (${v.why}: ${JSON.stringify(v.zones)})`)
  assert.ok(v.zones.some(z => z.box.join() === '20,-64,20,30,90,30'), '...and the id-less box (avoided, not trusted)')
  fs.unlinkSync(file); M.resetPlanZones()
}
await t('AN EDIT WHOSE EVERY ZONE THE GUARD DROPS (no id): the guard keeps its last good list, and so does the planner (plus the box)', () => guardDropsEdit(S))
await t('MUTANT KILLED: guard-dropped zones not a partial read (the planner replaces its last good list with the id-less zone)', async () => {
  const k = await withMutant(SKILLS_PATH, 'const partial = /^(dropped|guard_drops) /.test(r.why)', 'const partial = /^(dropped) /.test(r.why)', async M => killedBy(() => guardDropsEdit(M)))
  assert.ok(k, 'the mutant survived')
})
async function nullEdit (M) {
  const dir = process.env.POOL_STATE_DIR, file = path.join(dir, 'protected-zones.json')
  M.resetPlanZones()
  const bot = { worldId: 'w' }
  fs.writeFileSync(file, JSON.stringify({ version: 1, hashed_seed: 'w', zones: [{ id: 'old', box: [0, -64, 0, 5, 90, 5] }] }))
  const guard = PZ.zoneReader({ file: () => file, worldId: () => 'w' }); guard.refresh()
  M.townPlanZones(bot, 3e9)
  let tick = 1
  for (const body of ['null', '{"version": 1, "zones": [']) {
    fs.writeFileSync(file, body)
    guard.refresh()
    assert.deepEqual(guard.zones().map(z => z.id), ['old'], `POSITIVE CONTROL: the guard keeps old through ${body.slice(0, 12)}`)
    const v = M.townPlanZones(bot, 3e9 + 60_000 * tick++)
    assert.ok(!v.known || v.zones.some(z => z.id === 'old'), `the planner (${v.why}) dropped old after ${body.slice(0, 12)}`)
  }
  // POSITIVE CONTROL for the other path: a MISSING file clears both
  fs.unlinkSync(file); guard.refresh()
  assert.deepEqual(guard.zones(), [])
  assert.deepEqual(M.townPlanZones(bot, 3e9 + 60_000 * tick++).zones, [])
  M.resetPlanZones()
}
await t('A FILE HOLDING JSON null (Codex JIT r2 P2): broken, not absent -- the guard keeps old, and so does the planner (through a later unreadable read too); a missing file clears both', () => nullEdit(S))
await t('MUTANT KILLED: a JSON null read as no file (the planner clears its zones while the guard keeps them)', async () => {
  const k = await withMutant(SKILLS_PATH, '  if (json === null) json = undefined\n', '', async M => killedBy(() => nullEdit(M)))
  assert.ok(k, 'the mutant survived')
})
await t('THE UNKNOWN WORLD ID (\'\'): the guard honours the file, and so does the planner\'s parser (Claude JIT r1 P3)', () => {
  const json = { version: 1, hashed_seed: 'w', zones: [{ id: 'z', box: [0, -64, 0, 5, 90, 5] }] }
  assert.equal(PZ.parseZones(json, { worldId: '' }).zones.length, 1, 'POSITIVE CONTROL: the guard protects it')
  assert.equal(T.parseZones(json, '').zones.length, 1)
  assert.equal(T.parseZones(json, 'other').why, 'another world', 'a KNOWN other world still drops it')
})
await t('SUPERSET (the showcase file, protectzone-01\'s own infra copy): the planner reads the same 7 zones with the same boxes', () => {
  const doc = JSON.parse(readFileSync(new URL('../../infra/showcase/protected-zones.showcase.json', import.meta.url), 'utf8'))
  const g = PZ.parseZones(doc, { worldId: '1292467317:1056448044' }), p = T.parseZones(doc, '1292467317:1056448044')
  assert.equal(g.why, 'ok'); assert.equal(p.why, 'ok')
  assert.ok(g.zones.length >= 7)
  for (const z of g.zones) assert.ok(p.zones.some(q => q.id === z.id && q.box.join() === [z.x0, z.y0, z.z0, z.x1, z.y1, z.z1].join()), z.id)
})

async function staleEdit (M) {
  // the REAL readers over the same file in the pool's directory: townplan's townPlanZones and protectzone's zoneReader
  const dir = process.env.POOL_STATE_DIR, file = path.join(dir, 'protected-zones.json')
  M.resetPlanZones()
  const bot = { worldId: 'w' }
  fs.writeFileSync(file, JSON.stringify({ version: 1, hashed_seed: 'w', zones: [{ id: 'old', box: [0, -64, 0, 5, 90, 5] }] }))
  const v0 = M.townPlanZones(bot, 1e9)
  assert.equal(v0.known, true); assert.deepEqual(v0.zones.map(z => z.id), ['old'])
  // the owner's edit: a new valid zone and one malformed
  fs.writeFileSync(file, JSON.stringify({ version: 1, hashed_seed: 'w', zones: [{ id: 'old', box: [0, -64, 0, 5, 90, 5] }, { id: 'new', box: [20, -64, 20, 30, 90, 30] }, { id: 'bad', box: [1, 2, 3] }] }))
  const guard = PZ.zoneReader({ file: () => file, worldId: () => 'w' }); guard.refresh()
  assert.ok(guard.zones().some(z => z.id === 'new'), 'POSITIVE CONTROL: the guard protects the edit\'s valid zone at once')
  const v1 = M.townPlanZones(bot, 1e9 + 60_000)
  assert.equal(v1.known, true); assert.match(v1.why, /^stale:dropped/)
  for (const z of guard.zones()) assert.ok(v1.zones.some(q => q.box.join() === [z.x0, z.y0, z.z0, z.x1, z.y1, z.z1].join()), `the planner avoids ${z.id}`)
  assert.ok(v1.zones.some(z => z.id === 'old'), 'the last good list kept')
  // SEQUENTIAL EDITS (Codex JIT r1 P2): then an unreadable file, then an all-malformed one -- the guard keeps the partial edit's
  // zones through both (zoneReader keep()), and so must the planner
  let tick = 2
  for (const body of ['{"version": 1, "zones": [', JSON.stringify({ version: 1, hashed_seed: 'w', zones: [{ id: 'bad', box: [1, 2, 3] }] })]) {
    fs.writeFileSync(file, body)
    guard.refresh()
    assert.ok(guard.zones().some(z => z.id === 'new'), `POSITIVE CONTROL: the guard still protects the edit's zone (${body.slice(0, 20)})`)
    const v = M.townPlanZones(bot, 1e9 + 60_000 * tick++)
    assert.equal(v.known, true, body)
    for (const z of guard.zones()) assert.ok(v.zones.some(q => q.box.join() === [z.x0, z.y0, z.z0, z.x1, z.y1, z.z1].join()), `the planner avoids ${z.id} after ${body.slice(0, 20)}`)
  }
  fs.unlinkSync(file); M.resetPlanZones()
}
await t('A PARTLY MALFORMED EDIT after a good read: the guard protects the edit\'s valid zones at once, and the planner avoids them too (last good + them)', () => staleEdit(S))
await t('MUTANT KILLED: the partial edit keeps only the last good list (the planner would plan over the new zone the guard protects)', async () => {
  const k = await withMutant(SKILLS_PATH, '} else if (partial && zoneMem.good) {', '} else if (false) {', async M => killedBy(() => staleEdit(M)))
  assert.ok(k, 'the mutant survived')
})
await t('MUTANT KILLED: the union not retained (a later unreadable read falls back to the list before the edit)', async () => {
  const k = await withMutant(SKILLS_PATH, '      zoneMem.good = view\n', '', async M => killedBy(() => staleEdit(M)))
  assert.ok(k, 'the mutant survived')
})

console.log('townplan x protectzone: a READY cell is a cell the guard lets found click into')
await t('READY vs THE GUARD: a cell directly under a zone\'s bottom face is not READY; one block higher it is (positive control)', () => {
  const at = [110, 70, 100]
  const over = [{ id: 'roof', box: [105, 71, 95, 115, 90, 105] }]
  assert.match(T.readyCell(world(), at, { home: HOME, zones: over }), /protected zone/)
  // the guard WOULD refuse that click: its third cell (above) is in the zone
  assert.ok(guardCells(at).some(c => PZ.blocked(pzOf(over), ...c, null)), 'the guard refuses a placement under the zone')
  const higher = [{ id: 'roof', box: [105, 72, 95, 115, 90, 105] }]
  assert.equal(T.readyCell(world(), at, { home: HOME, zones: higher }), null, 'one higher: READY')
  assert.ok(!guardCells(at).some(c => PZ.blocked(pzOf(higher), ...c, null)), '...and the guard passes it')
})
await t('PROPERTY (grid 21 x 21 x 5 heights around a zone, both modules\' own decisions): every READY cell passes all three guard cells', () => {
  const zones = [{ id: 'box', box: [104, 71, 96, 108, 74, 104] }, { id: 'col', box: [112, -64, 98, 113, 90, 99] }]
  const g = pzOf(zones)
  let ready = 0, refusedByZone = 0
  for (let x = 95; x <= 115; x++) {
    for (let z = 90; z <= 110; z++) {
      for (const ground of [67, 68, 69, 70, 71]) {
        const at = [x, ground + 1, z]
        if (x === HOME.x && z === HOME.z) continue
        const why = T.readyCell(world({ ground }), at, { home: HOME, zones })
        if (why === 'protected zone') refusedByZone++
        if (why) continue
        ready++
        for (const c of guardCells(at)) assert.equal(PZ.blocked(g, ...c, null), null, `READY ${at} but the guard refuses ${c}`)
      }
    }
  }
  assert.ok(ready > 1000 && refusedByZone > 50, `ready ${ready}, refused by a zone ${refusedByZone}`)
})
await t('THE SHOWCASE (its offline plan and protectzone-01\'s infra zones file): every furniture cell and stand passes the guard\'s cells', () => {
  const plan = JSON.parse(readFileSync(new URL('../../infra/showcase/town-plan-preview.json', import.meta.url), 'utf8'))
  const doc = JSON.parse(readFileSync(new URL('../../infra/showcase/protected-zones.showcase.json', import.meta.url), 'utf8'))
  const g = PZ.parseZones(doc, { worldId: '1292467317:1056448044' }).zones
  const cells = []
  for (const p of plan.plots ?? []) for (const c of [...(p.cells ?? []), ...(p.stations ?? [])]) { cells.push(c.at); if (Array.isArray(c.stand)) cells.push(c.stand) }
  assert.ok(cells.length >= 9 && g.length >= 7, `cells ${cells.length} zones ${g.length}`)
  for (const at of cells) for (const c of guardCells(at)) assert.equal(PZ.blocked(g, ...c, null), null, `${at} -> ${c}`)
})
await t('MUTANT KILLED: readyCell without the cell-above clause plans a cell the guard will refuse', async () => {
  const k = await withMutant(TP_PATH, ' || cellInZones(x, y + 1, z, ctx.zones)) return \'protected zone\'', ') return \'protected zone\'', async M => killedBy(() => {
    assert.match(M.readyCell(world(), [110, 70, 100], { home: HOME, zones: [{ id: 'roof', box: [105, 71, 95, 115, 90, 105] }] }) ?? 'READY', /protected zone/)
  }))
  assert.ok(k, 'the mutant survived')
})

console.log('townplan x protectzone: the guard\'s enumeration filter and the planner\'s context')
await t('RETROFIT CONTEXT: with the guard on, a chest inside a protected zone is not one of the town\'s containers (nor `existing`); without it, it is', () => {
  const mk = () => {
    const w = fakeWorld({ at: [2.5, 64, 0.5] })
    Object.assign(w.bot, { worldId: 'w', username: 'ComposeBot', players: {} })
    w.set(5, 64, 5, 'chest'); w.set(-5, 64, -5, 'chest')
    return w
  }
  const zones = PZ.parseZones({ version: 1, zones: [{ id: 'village', box: [3, -64, 3, 8, 90, 8] }] }).zones
  const plain = mk()
  const c0 = S.townPlanCtx(plain.bot, () => null, { known: true, zones: [], why: 'absent' }, { ok: true, use: null })
  assert.deepEqual(c0.containers.map(c => c.at.join()).sort(), ['-5,64,-5', '5,64,5'], 'POSITIVE CONTROL: both chests without the guard')
  const guarded = mk()
  PZ.attachProtectZone(guarded.bot, { zones: () => zones })
  const c1 = S.townPlanCtx(guarded.bot, () => null, { known: true, zones: [], why: 'absent' }, { ok: true, use: null })
  assert.deepEqual(c1.containers.map(c => c.at.join()), ['-5,64,-5'], 'the zone\'s chest is not the town\'s')
  assert.ok(!c1.existing.some(e => e.join() === '5,64,5'))
})

console.log('townplan x the pathfinder: one shared break array')
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1')
const IDX = strip(readFileSync(new URL('../src/index.mjs', import.meta.url), 'utf8'))
const breakWired = s => {
  const at = l => { const i = s.indexOf(l); assert.ok(i >= 0 && s.indexOf(l, i + 1) < 0, `found ${i < 0 ? 0 : 'more than one'}: ${l}`); return i }
  const plan = at('moves.exclusionAreasBreak = [(block) => wellBreakCost(wellCols, block, selfWell) || planBreakCost(bot.townPlan?.cells, block)]')
  const zone = at('moves.exclusionAreasBreak = moves.exclusionAreasBreak.concat(zonePrice)')
  const clone = at('Object.assign(gatherMoves, moves)')
  const gather = at('gatherMoves.exclusionAreasBreak = [...moves.exclusionAreasBreak, (block) => keepoutBreakPenalty(block)]')
  assert.ok(plan < zone, 'the zone price is appended to the array that carries the plan\'s furniture (not replaced by it)')
  assert.ok(zone < clone && clone < gather, 'both before the clones; gather spreads the shared array')
}
await t('index.mjs: the plan furniture and the junk well in one entry, the zone price appended, both before the clones; gather spreads them', () => breakWired(IDX))
await t('MUTANT: the plan line moved after the zone concat (the concat\'s array lost) is detected', () => {
  const pl = 'moves.exclusionAreasBreak = [(block) => wellBreakCost(wellCols, block, selfWell) || planBreakCost(bot.townPlan?.cells, block)]'
  const zl = 'moves.exclusionAreasBreak = moves.exclusionAreasBreak.concat(zonePrice)'
  const m = IDX.replace(pl, '\u0000').replace(zl, pl).replace('\u0000', zl)
  assert.notEqual(m, IDX, 'MUTATION DID NOT APPLY'); assert.throws(() => breakWired(m), /not replaced/)
})

console.log('townplan x poolescape')
await t('POOLESCAPE never CLICKS the plan\'s furniture as a reference (INTERACTIVE covers every kind the plan places; a plain block is not)', () => {
  for (const k of ['chest', 'crafting_table', 'furnace', 'trapped_chest', 'barrel', 'composter']) assert.ok(PE.INTERACTIVE.test(k), k)
  assert.ok(!PE.INTERACTIVE.test('cobblestone') && !PE.INTERACTIVE.test('dirt'), 'control')
  // the stair finder's own decision: the tread is missing and the only face below it is a crafting table -> no tread face
  // (the click would open the station); with stone there, the tread is placed against it (positive control)
  const mk = under => (x, y, z) => {
    let name = 'stone'
    if (x === 0 && z === 0 && y === 0) name = 'water'                       // the feet: wading
    else if (x === 0 && z === 0 && y >= 1) name = 'air'                     // the head and the room above
    else if (x === 1 && z === 0 && y === 0) name = 'air'                    // the tread cell: nothing to stand on
    else if (x === 1 && z === 0 && y === -1) name = under                   // ...and below it, the only face
    else if (x === 1 && z === 0 && y >= 1) name = 'air'                     // the step, head and clearance: open
    else if (y >= 1) name = 'air'
    const solidB = !/^(air|water)$/.test(name)
    return { name, boundingBox: solidB ? 'block' : 'empty', shapes: solidB ? [[0, 0, 0, 1, 1, 1]] : [] }
  }
  const ctrl = PE.poolStep({ at: mk('stone'), bear: { x: 1, z: 0 }, blocks: 4 })
  assert.ok(ctrl.ok && ctrl.place.some(p => p.why === 'tread' && p.ref.join() === '1,-1,0'), `control: ${JSON.stringify(ctrl)}`)
  const r = PE.poolStep({ at: mk('crafting_table'), bear: { x: 1, z: 0 }, blocks: 4 })
  assert.ok(!r.place.some(p => p.ref?.join?.() === '1,-1,0'), `never clicked: ${JSON.stringify(r)}`)
})
await t('A POOLESCAPE PLUG CELL IS NEVER A READY PLAN CELL: water in the cell or beside it refuses READY', () => {
  assert.ok(T.readyCell(world({ cells: { '110,70,100': 'water' } }), [110, 70, 100], { home: HOME }))
  assert.match(T.readyCell(world({ cells: { '111,69,100': 'water' } }), [110, 70, 100], { home: HOME }), /liquid within 1/)
})

console.log(`\ntownplan-compose: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
