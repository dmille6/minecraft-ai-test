// ATLAS-01: THE BOTS' SHARED MAP (bots/src/atlas.mjs) and what reads it (expedition.mjs planTrip, prompt.mjs atlasLine), pure and
// composed: the switch; the cells a bot notices (under the sky only; the fallback before light data); finds merged per kind, the
// caps, the town and the deep aquifer skipped, gone when read absent; the fold of every bot's file; the frontier aim (the most
// unseen swath, dead wedges shut, all seen -> the old pick); the harvest aim (the densest wood, never in a zone, never too near or
// too far); planTrip (no map = tripBearing exactly; even trips frontier, odd harvest); a fractional aim is what legTarget walks;
// the MAP line (task finds first, hazards to avoid, villages never offered); the recorder end to end on a fake bot and a temp dir;
// the wiring in skills.mjs / features.mjs / prompt.mjs. Mutants assert their anchors present and unique.
import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
const A = await import('../src/atlas.mjs')
const E = await import('../src/expedition.mjs')
const P = await import('../src/prompt.mjs')

const EX_PATH = new URL('../src/expedition.mjs', import.meta.url)
const SKILLS_PATH = new URL('../src/skills.mjs', import.meta.url)
const FEAT_PATH = new URL('../src/features.mjs', import.meta.url)
const PROMPT_PATH = new URL('../src/prompt.mjs', import.meta.url)
let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 5).join('\n        ')}`) }
}
/** A mutant (anchor present and unique: CLAUDE.md), imported from the test directory. */
async function withMutant (file, old, neu, fn) {
  const src = readFileSync(file, 'utf8')
  assert.ok(src.includes(old), `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 70))}`)
  assert.ok(src.split(old).length === 2, 'the mutation target is not unique')
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, src.replace(old, neu).replace(/from '\.\//g, "from '../src/"))
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
const HOME = { x: 0, y: 70, z: 0 }
const NOW = 1_800_000_000_000
const H = 3_600_000

/** A view whose every cell within `r` of home is seen at `now`, except the cells `except(x, z)` says. */
function seenView ({ r = 400, now = NOW, except = () => false, finds = [] } = {}) {
  const cells = new Map()
  for (let cx = Math.floor(-r / A.CELL); cx <= Math.ceil(r / A.CELL); cx++) {
    for (let cz = Math.floor(-r / A.CELL); cz <= Math.ceil(r / A.CELL); cz++) {
      const c = A.cellCentre(A.cellKey(cx, cz))
      if (!except(c.x, c.z)) cells.set(A.cellKey(cx, cz), { seen: now - H, stood: 0 })
    }
  }
  return { cells, finds, aims: [] }
}
const wood = (x, z, n = 3, last = NOW - H) => ({ kind: 'spruce_log', cat: 'wood', x, y: 70, z, n, last, first: last, by: ['showcase-Iris'] })

await t('the switch: on only in the showcase pool by default; ATLAS=on|off wins', async () => {
  assert.equal(A.atlasOn({}, 'showcase'), true)
  assert.equal(A.atlasOn({}, 'hive-a'), false, 'the fleet is unchanged unless switched on')
  assert.equal(A.atlasOn({ ATLAS: 'off' }, 'showcase'), false)
  assert.equal(A.atlasOn({ ATLAS: 'on' }, 'hive-a'), true)
  assert.equal(A.atlasOn({ ATLAS_POOLS: '*' }, 'board-b'), true)
  assert.match(A.atlasModeDetail(true, 'showcase'), /^on=1 pool=showcase cell=32 /)
})

await t('the cells a bot notices: every cell within SEEN_R, none further; only under the sky; the stood cell always', async () => {
  const keys = A.cellsSeenFrom(16, 16)
  assert.ok(keys.includes('0,0') && keys.includes('1,1') && keys.includes('-1,-1'), keys.join(' '))
  for (const k of keys) {
    const [cx, cz] = k.split(',').map(Number)
    const nx = Math.max(cx * 32, Math.min(16, cx * 32 + 32)), nz = Math.max(cz * 32, Math.min(16, cz * 32 + 32))
    assert.ok(Math.hypot(nx - 16, nz - 16) <= A.SEEN_R, `${k} is beyond the radius`)
  }
  assert.ok(!keys.includes('2,2'), 'a corner cell 48+ blocks away is not noticed')
  const doc = A.emptyDoc('b')
  assert.equal(A.noteCells(doc, { x: 16, z: 16, sky: false, now: 5 }), 0, 'underground: nothing newly seen')
  assert.deepEqual(doc.cells['0,0'], [0, 5], 'but the bot stood there')
  assert.equal(A.noteCells(doc, { x: 16, z: 16, sky: true, now: 6 }), keys.length)
  assert.equal(A.noteCells(doc, { x: 16, z: 16, sky: true, now: 7 }), 0, 'seen again is not new')
  assert.equal(doc.cells['1,1'][0], 7)
})

await t('finds: merged per kind within the kind\'s radius; wood has its own cap; the oldest go first', async () => {
  const f = []
  assert.equal(A.mergeFind(f, { kind: 'iron_ore', x: 0, y: 40, z: 0 }, 1, 'a').isNew, true)
  assert.equal(A.mergeFind(f, { kind: 'iron_ore', x: 8, y: 40, z: 0 }, 2, 'b').isNew, false, 'inside 12: the same vein')
  assert.equal(f[0].n, 2); assert.equal(f[0].last, 2)
  assert.equal(A.mergeFind(f, { kind: 'iron_ore', x: 20, y: 40, z: 0 }, 3).isNew, true, 'outside 12: another')
  assert.equal(A.mergeFind(f, { kind: 'coal_ore', x: 0, y: 40, z: 0 }, 3).isNew, true, 'another kind is its own find')
  assert.equal(A.mergeFind(f, { kind: 'stone', x: 0, y: 40, z: 0 }, 3), null, 'not a find kind')
  const w = []
  for (let i = 0; i < A.MAX_WOOD + 5; i++) A.mergeFind(w, { kind: 'oak_log', x: i * 30, y: 70, z: 0 }, i)
  assert.equal(w.length, A.MAX_WOOD)
  assert.ok(!w.some(q => q.last < 5), 'the oldest wood went first')
})

await t('the fold: cells take the latest stamp, finds of several bots are one, a find read GONE after its last sighting is dropped', async () => {
  const a = A.emptyDoc('showcase-Iris'), b = A.emptyDoc('showcase-Haven')
  a.cells['0,0'] = [10, 0]; b.cells['0,0'] = [20, 5]; b.cells['3,3'] = [7, 0]
  a.finds.push({ kind: 'iron_ore', cat: 'ore', x: 100, y: 40, z: 0, first: 1, last: 10, n: 2, by: 'showcase-Iris' })
  b.finds.push({ kind: 'iron_ore', cat: 'ore', x: 104, y: 41, z: 2, first: 3, last: 30, n: 1, by: 'showcase-Haven' })
  a.finds.push({ kind: 'sugar_cane', cat: 'plant', x: 50, y: 63, z: 50, first: 1, last: 10, n: 1, by: 'showcase-Iris' })
  b.gone.push({ kind: 'sugar_cane', x: 50, y: 63, z: 50, t: 40 })
  a.finds.push({ kind: 'pumpkin', cat: 'plant', x: -50, y: 64, z: 0, first: 1, last: 50, n: 1, by: 'showcase-Iris' })
  b.gone.push({ kind: 'pumpkin', x: -50, y: 64, z: 0, t: 40 })
  const v = A.foldAtlas([a, b, { v: 99, cells: { '9,9': [1, 1] } }, null], 50)
  assert.equal(v.bots, 2, 'a wrong version and a null are not bots')
  assert.deepEqual(v.cells.get('0,0'), { seen: 20, stood: 5 })
  assert.equal(v.cells.has('9,9'), false)
  const iron = v.finds.filter(f => f.kind === 'iron_ore')
  assert.equal(iron.length, 1); assert.equal(iron[0].n, 3); assert.deepEqual(iron[0].by.sort(), ['showcase-Haven', 'showcase-Iris'])
  assert.equal(iron[0].x, 104, 'the latest sighting\'s place')
  assert.equal(v.finds.some(f => f.kind === 'sugar_cane'), false, 'gone after its last sighting: dropped')
  assert.equal(v.finds.some(f => f.kind === 'pumpkin'), true, 'seen again AFTER the gone read: kept')
})

await t('the frontier aim: the wedge with the most unseen swath, at the offset that crosses it; dead wedges shut; all seen -> null', async () => {
  // everything seen except a blob 150-300 out at ~100 degrees (bearing 2 is 90, so offset +9 = 99 points into it)
  const blob = (x, z) => { const d = Math.hypot(x, z), a = Math.atan2(z, x) * 180 / Math.PI; return d > 150 && d < 320 && a > 92 && a < 108 }
  const v = seenView({ except: blob })
  const f = E.frontierAim(v, { home: HOME, ring: 300, now: NOW })
  assert.equal(f.k, 2)
  assert.ok(f.aim > 2 && f.aim < 2.5, `the aim is inside the wedge, toward the blob: ${f.aim}`)
  assert.ok(f.unseen > 0)
  assert.equal(E.frontierAim(v, { home: HOME, ring: 300, now: NOW, dead: new Set([2]) })?.k === 2, false, 'a dead wedge is never aimed')
  assert.equal(E.frontierAim(seenView(), { home: HOME, ring: 300, now: NOW }), null, 'every swath seen')
  assert.notEqual(E.frontierAim(seenView(), { home: HOME, ring: 300, now: NOW + A.FRESH_MS + H }), null, 'seen too long ago is frontier again')
  // a cell nobody has ever seen counts the same as a stale one
  assert.equal(A.unseen(new Map(), '0,0', NOW), true)
})

await t('the harvest aim: the densest fresh wood, on an open bearing, outside every zone, 64..ring from home', async () => {
  const finds = [wood(120, 0, 2), wood(0, 150, 4), wood(20, 160, 4), wood(-10, 170, 3), wood(30, 20, 9), wood(0, -500, 9), wood(-150, 0, 9, NOW - 5 * 24 * H)]
  const v = { cells: new Map(), finds }
  const h = E.harvestAim(v, { home: HOME, maxRing: 300, now: NOW })
  assert.equal(h.k, 2, 'the cluster south (+z) holds the most wood')
  assert.ok(Math.abs(h.find.z - 160) <= 10)
  assert.equal(h.ring, Math.ceil(Math.hypot(h.find.x, h.find.z) + E.HARVEST_PAST), 'the trip turns at the trees')
  assert.equal(E.harvestAim(v, { home: HOME, maxRing: 300, now: NOW, dead: new Set([2]) }).k, 0, 'its wedge dead: the next best')
  const zones = [{ id: 'village', box: [-50, 40, 100, 80, 90, 220] }]
  assert.equal(E.harvestAim(v, { home: HOME, maxRing: 300, now: NOW, zones }).k, 0, 'wood inside a village is never a target')
  assert.equal(E.harvestAim({ cells: new Map(), finds: [wood(30, 20, 9), wood(0, -500, 9), wood(-150, 0, 9, NOW - 5 * 24 * H)] }, { home: HOME, maxRing: 300, now: NOW }), null,
    'too near (the town\'s), too far, too stale: nothing')
})

await t('planTrip: no map is tripBearing exactly; with the map even trips go to the frontier and odd trips harvest', async () => {
  const day = (n, extra = {}) => Array.from({ length: n }, (_, i) => ({ t: NOW - (i + 1) * 60_000, v: E.PLANNER_V, bearing: i % 8, dist: 120, ring: 100, reason: 'reached', returned: true, haul: 0, ...extra }))
  for (const n of [0, 1, 2, 3]) {
    const old = E.tripBearing(day(n), NOW)
    const p = E.planTrip(day(n), NOW, { view: null, home: HOME, ring: 100 })
    assert.equal(p.bearing, old.bearing); assert.equal(p.reuse, old.reuse); assert.equal(p.aim, old.bearing)
  }
  const blob = (x, z) => { const d = Math.hypot(x, z), a = Math.atan2(z, x) * 180 / Math.PI; return d > 150 && d < 320 && a > -100 && a < -80 }
  const v = seenView({ except: blob, finds: [wood(0, 150, 4)] })
  const even = E.planTrip(day(2), NOW, { view: v, home: HOME, ring: 300 })
  assert.equal(even.mode, 'frontier'); assert.equal(even.bearing, 6, '-z is bearing 6')
  const odd = E.planTrip(day(1), NOW, { view: v, home: HOME, ring: 300 })
  assert.equal(odd.mode, 'harvest'); assert.equal(odd.bearing, 2); assert.equal(odd.find.kind, 'spruce_log')
  const noWood = E.planTrip(day(1), NOW, { view: seenView({ except: blob }), home: HOME, ring: 300 })
  assert.equal(noWood.mode, 'least', 'odd, no wood known, no good trip to reuse: the old pick')
  const allSeen = E.planTrip(day(2), NOW, { view: seenView(), home: HOME, ring: 300 })
  assert.equal(allSeen.mode, 'least'); assert.equal(allSeen.bearing, E.tripBearing(day(2), NOW).bearing)
  const dead = Array.from({ length: 8 }, (_, k) => ({ t: NOW - 1, v: E.PLANNER_V, bearing: k, dist: 10, reason: 'zone' }))
  assert.equal(E.planTrip(dead, NOW, { view: v, home: HOME }).bearing, null, 'every bearing dead stays dead')
  // the frontier branch is load-bearing: without it an even trip is the old pick
  await withMutant(EX_PATH, "  return f ? { bearing: f.k, aim: f.aim, reuse: false, mode: 'frontier', unseen: f.unseen, cells: f.cells } : plain\n", '  return plain\n', async M => {
    assert.equal(M.planTrip(day(2), NOW, { view: v, home: HOME, ring: 300 }).mode, 'least')
  })
})

await t('a harvest trip says nothing about the ring (closed in its call or later by home); a frontier trip that reached it does', async () => {
  const r = [{ t: NOW, returned: true, reason: 'reached', mode: 'harvest', ring: 170 }]
  assert.equal(E.ringOf(r, NOW), E.RING_MIN)
  assert.equal(E.ringOf([{ ...r[0], mode: 'frontier' }], NOW), E.RING_MIN + E.RING_STEP)
  const late = { t: NOW, returned: false, late: true, multi: true, via: 'home_crumbs', reason: 'reached', ring: 260, dist: 255 }
  assert.equal(E.ringOf([{ ...late, mode: 'harvest' }], NOW), E.RING_MIN, 'a multi-call harvest closed by home (Codex r1 note)')
  assert.equal(E.ringOf([late], NOW), E.RING_MIN + E.RING_STEP, 'the same row without its mode would grow the ring')
  // ...so the late-close row must carry the mode (structural: the row is written inside exCloseAtTown)
  const sk = strip(readFileSync(SKILLS_PATH, 'utf8'))
  const close = sk.slice(sk.indexOf('function exCloseAtTown'), sk.indexOf('function exCloseAtTown') + 1500)
  assert.match(close, /exAppend\(exTripsFile\(\), \{[^\n]*mode: t\.mode \?\? null,/)
})

await t('a fractional aim is what the legs walk: legTarget sets its target on the aimed spoke, not on the integer bearing', async () => {
  const flat = (x, y, z) => y === 69 ? { name: 'grass_block', boundingBox: 'block' } : y < 69 ? { name: 'stone', boundingBox: 'block' } : { name: 'air', boundingBox: 'empty' }
  const aim = 2.4
  let pos = { x: 0, y: 70, z: 0 }
  for (let i = 0; i < 6; i++) {
    const lt = E.legTarget(flat, { pos, home: HOME, bearing: aim })
    assert.equal(lt.ok, true)
    pos = { x: lt.target.x, y: 70, z: lt.target.z }
  }
  const deg = Math.atan2(pos.z, pos.x) * 180 / Math.PI
  assert.ok(Math.abs(deg - aim * 45) < 3, `walked at ${deg.toFixed(1)} degrees, aimed ${aim * 45}`)
  assert.ok(Math.abs(deg - 90) > 10, 'not the integer spoke')
})

await t('the MAP line: task finds first, wood only when wanted, hazards to avoid, villages and the town never offered, the unexplored side', async () => {
  const pos = { x: 200, y: 70, z: 0 }
  const view = seenView({
    except: (x, z) => x > 300,
    finds: [
      { kind: 'sugar_cane', cat: 'plant', x: 230, y: 63, z: 10, n: 2, last: NOW - 10 * 60_000, by: ['showcase-Iris'] },
      { kind: 'iron_ore', cat: 'ore', x: 180, y: 50, z: -30, n: 1, last: NOW - 2 * H, by: ['showcase-Haven'] },
      wood(210, 5, 5),
      { kind: 'lava', cat: 'hazard', x: 215, y: 69, z: 0, n: 1, last: NOW, by: ['showcase-Iris'] },
      { kind: 'bell', cat: 'landmark', x: 260, y: 70, z: 0, n: 1, last: NOW, by: ['showcase-Iris'] },
      { kind: 'diamond_ore', cat: 'ore', x: 10, y: 10, z: 10, n: 1, last: NOW, by: ['showcase-Iris'] },
    ],
  })
  const inZone = (x, z) => x >= 250 && x <= 270
  const l = A.mapLine(view, { pos, wants: ['sugar_cane'], now: NOW, inZone, home: HOME })
  assert.match(l, /^MAP \(shared by every bot in this town\): sugar_cane x2 32 blocks E at 230,63,10 \(seen by Iris 10 min ago, for your task\); iron_ore/)
  assert.ok(!/spruce_log/.test(l), 'wood not wanted: the taiga is all wood')
  assert.match(l, /AVOID lava 15 blocks E at 215,69,0/)
  assert.ok(!/bell/.test(l), 'inside a village: keep-out')
  assert.ok(!/diamond_ore/.test(l), 'beyond 200 and inside the town')
  assert.match(l, /unexplored ground \d+ blocks E/)
  assert.match(A.mapLine(view, { pos, wants: ['oak_planks'], now: NOW, inZone, home: HOME }), /spruce_log x5 .*for your task/, 'planks wanted: logs serve')
  assert.equal(A.mapLine(seenView(), { pos: { x: 0, y: 70, z: 0 }, now: NOW }), '', 'nothing known, all seen: no line')
  assert.equal(A.findServes('deepslate_iron_ore', ['iron_ingot']), true)
  assert.equal(A.compass(0, -10), 'N'); assert.equal(A.compass(10, 0), 'E'); assert.equal(A.compass(0, 10), 'S')
})

/** A fake mineflayer bot over a block map: findBlocks over the map, blockAt with skyLight. */
function fakeBot ({ blocks = {}, sky = 15, pos = { x: 200, y: 70, z: 0 }, name = 'showcase-Iris' } = {}) {
  const reg = {}
  let id = 1
  for (const n of Object.keys(A.FIND_KINDS)) reg[n] = { id: id++, name: n }
  const byId = Object.fromEntries(Object.values(reg).map(b => [b.id, b.name]))
  const bot = {
    username: name, registry: { blocksByName: reg },
    entity: { position: { ...pos } },
    blockAt: v => {
      const k = `${Math.floor(v.x)},${Math.floor(v.y)},${Math.floor(v.z)}`
      if (blocks[k] === null) return null
      return { name: blocks[k] ?? 'air', skyLight: sky }
    },
    findBlocks: ({ matching, maxDistance, count }) => {
      const p = bot.entity.position
      return Object.entries(blocks).filter(([, n]) => n && matching.map(i => byId[i]).includes(n))
        .map(([k]) => { const [x, y, z] = k.split(',').map(Number); return { x, y, z } })
        .filter(q => Math.hypot(q.x - p.x, q.y - p.y, q.z - p.z) <= maxDistance)
        .sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z)).slice(0, count)
    },
    once: () => {},
  }
  return bot
}
const V3 = function (x, y, z) { return { x, y, z } }

await t('the recorder end to end: tick notices cells, scans finds (town and aquifer skipped), reads one gone, flushes; another bot reads it', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-'))
  try {
    A.dropViewCache()
    const blocks = { '210,60,5': 'iron_ore', '205,40,0': 'lava', '220,69,0': 'lava', '20,70,0': 'chest', '190,70,-5': 'spruce_log', '195,70,0': 'sugar_cane' }
    const bot = fakeBot({ blocks })
    const rows = []
    const rec = new A.AtlasRecorder({ bot, dir, by: bot.username, home: HOME, Vec3: V3, emit: r => rows.push(r) })
    rec.tick(NOW)
    const kinds = rec.doc.finds.map(f => f.kind).sort()
    assert.deepEqual(kinds, ['iron_ore', 'lava', 'spruce_log', 'sugar_cane'], 'the deep lava and the far town chest are not finds')
    assert.ok(rec.doc.finds.find(f => f.kind === 'lava').y === 69, 'the surface pool is')
    assert.ok(rows.some(r => r.kind === 'atlas_find' && /iron_ore/.test(r.detail)))
    assert.ok(!rows.some(r => /spruce_log/.test(r.detail)), 'wood is not announced row by row')
    assert.ok(rec.doc.cells[A.keyAt(200, 0)][0] === NOW, 'under the sky: seen')
    assert.equal(fs.existsSync(A.atlasFile(dir, bot.username)), true, 'the first tick flushes')
    // the cane is cut; standing beside it the next tick reads it gone
    blocks['195,70,0'] = 'air'
    A.dropViewCache()
    rec.tick(NOW + 6_000)
    assert.equal(rec.doc.finds.some(f => f.kind === 'sugar_cane'), false)
    assert.equal(rec.doc.gone.at(-1).kind, 'sugar_cane')
    // an unloaded block is unknown, not gone
    blocks['210,60,5'] = null
    rec.tick(NOW + 12_000)
    assert.equal(rec.doc.finds.some(f => f.kind === 'iron_ore'), true)
    rec.flush(NOW + 12_000, true)
    A.dropViewCache()
    const other = fakeBot({ name: 'showcase-Haven', pos: { x: 0, y: 70, z: 300 } })
    const rec2 = new A.AtlasRecorder({ bot: other, dir, by: other.username, home: HOME, Vec3: V3 })
    rec2.tick(NOW + 13_000)
    A.dropViewCache()
    const v = A.readView(dir, NOW + 14_000)
    assert.equal(v.bots, 2)
    assert.ok(v.finds.some(f => f.kind === 'iron_ore' && f.by.includes('showcase-Iris')))
    assert.ok(v.cells.get(A.keyAt(0, 300)).seen > 0 && v.cells.get(A.keyAt(200, 0)).seen > 0, 'both bots\' ground in one view')
    assert.deepEqual(fs.readdirSync(dir).filter(n => n.endsWith('.tmp')), [], 'no tmp file left behind')
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

await t('underground notices nothing; no light data at all falls back to the height', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-'))
  try {
    const deep = fakeBot({ sky: 0, pos: { x: 0, y: 20, z: 0 } })
    const r1 = new A.AtlasRecorder({ bot: deep, dir, by: 'a', Vec3: V3 })
    r1.tick(NOW)
    assert.equal(Object.values(r1.doc.cells).filter(c => c[0] > 0).length, 0, 'no light reading ever, y 20: not the surface')
    const top = fakeBot({ sky: 0, pos: { x: 0, y: 70, z: 0 } })
    const r2 = new A.AtlasRecorder({ bot: top, dir, by: 'b', Vec3: V3 })
    r2.tick(NOW)
    assert.ok(Object.values(r2.doc.cells).filter(c => c[0] > 0).length > 0, 'no light data, y 70: the fallback says surface')
    const lit = fakeBot({ sky: 15, pos: { x: 0, y: 70, z: 0 } })
    const r3 = new A.AtlasRecorder({ bot: lit, dir, by: 'c', Vec3: V3 })
    r3.tick(NOW)
    lit.blockAt = () => ({ name: 'air', skyLight: 0 }); lit.entity.position = { x: 500, y: 70, z: 500 }
    r3.tick(NOW + 6_000)
    assert.equal(r3.doc.cells[A.keyAt(500, 500)][0], 0, 'once light data is seen, a dark cell at y 70 (a cave) is not the surface')
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

await t('installAtlas: off leaves no bot.atlas; on gives the readers their view, line and aim', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-'))
  try {
    const bot = fakeBot({ blocks: { '220,66,5': 'sugar_cane' } })
    assert.equal(A.installAtlas(bot, { on: false, dir, by: 'x', Vec3: V3 }), null)
    assert.equal(bot.atlas, undefined)
    const rec = A.installAtlas(bot, { on: true, dir, by: bot.username, home: HOME, Vec3: V3 })
    rec.tick(Date.now())
    A.dropViewCache()
    assert.match(bot.atlas.line({ wants: ['sugar_cane'] }), /sugar_cane .*for your task/)
    bot.atlas.aim({ trip: 't1', mode: 'frontier', k: 2, aim: 2.2, ring: 200, target: [10, 200] })
    A.dropViewCache()
    assert.equal(bot.atlas.view().aims.at(-1).trip, 't1', 'an aim is flushed at once')
    assert.equal(P.atlasLine(bot, { wants: 'sugar_cane' }, null).startsWith('MAP'), true, 'the prompt helper reads bot.atlas')
    assert.equal(P.atlasLine({}, null, null), '', 'no atlas: no line')
    const rows = []
    rec.emit = r => rows.push(r)
    rec.statsRow(Date.now())
    assert.match(rows.at(-1).detail, /^ticks=1 scans=1 scan_ms_avg=\d+\.\d scan_ms_max=\d+\.\d cells_new=\d+ finds_new=1 /, rows.at(-1).detail)
    rec.statsRow(Date.now())
    assert.match(rows.at(-1).detail, /^ticks=0 scans=0 scan_ms_avg=- /, 'the window resets')
    A.installAtlas(bot, { on: false, dir, by: 'x', Vec3: V3 })   // clears the timer
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

await t('the wiring: features installs the atlas; the visit plans with bot.atlas and walks the aim; the prompt carries the MAP line', async () => {
  const feat = strip(readFileSync(FEAT_PATH, 'utf8'))
  assert.match(feat, /export function installFeatures \(bot\) \{\s*try \{ installAtlasFeature\(bot\) \}/)
  const sk = strip(readFileSync(SKILLS_PATH, 'utf8'))
  const visit = sk.slice(sk.indexOf('async function expeditionVisit'), sk.indexOf('async function expeditionVisit') + 30_000)
  assert.match(visit, /atlasView = bot\.atlas\?\.view\?\.\(\) \?\? null/)
  assert.match(visit, /: planTrip\(trips, Date\.now\(\), \{ view: atlasView, home, ring: ring0, zones \}\)/)
  assert.match(visit, /const lt = legTarget\(read, \{ pos: p, home, bearing: trip\.aim \?\? trip\.bearing,/)
  assert.match(visit, /const dirV = bearingVec\(trip\.aim \?\? trip\.bearing\)/)
  assert.ok(!/tripBearing\(trips/.test(visit), 'the visit no longer calls the old picker directly')
  const pr = strip(readFileSync(PROMPT_PATH, 'utf8'))
  const head = pr.slice(pr.indexOf('const head = ['), pr.indexOf('].filter(Boolean)', pr.indexOf('const head = [')))
  assert.match(head, /\n\s*atlasLine\(bot, milestone, wanted\),\n/)
  // the wiring assertion fails for the intended reason: without the line in the head, the match fails
  const mut = pr.replace('    atlasLine(bot, milestone, wanted),\n', '')
  assert.notEqual(mut, pr, 'MUTATION DID NOT APPLY')
  const h2 = mut.slice(mut.indexOf('const head = ['), mut.indexOf('].filter(Boolean)', mut.indexOf('const head = [')))
  assert.doesNotMatch(h2, /atlasLine\(bot, milestone, wanted\)/)
})

console.log(`\natlas: ${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
