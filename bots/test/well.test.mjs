// THE TOWN JUNK WELL (src/well.mjs has the geometry, the sandbox numbers and the design).
//
// Behaviour only. Pure decisions through their exported functions -- the list, the site, the aim, the admission, the
// scheduler, the room decision, the exclusions -- checked against the real registry's trapdoor boxes and the real
// pathfinder; then the real skills through a fake bot whose inventory follows mineflayer's rules and whose throws follow
// vanilla's drop ballistics (noise-free). The refusal CHAIN is driven through wellOrder -> skill -> wellOrderOutcome ->
// wellOrder. Structural assertions only where behaviour cannot reach (the dispatch table, index.mjs's arrays), with
// comments stripped, unique anchors, and a mutant each.
import assert from 'node:assert/strict'
import fsMod, { readFileSync, writeFileSync, unlinkSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { Vec3 } from 'vec3'
import { inPickupBox } from '../src/pickupbox.mjs'

const LOG_DIR = `/tmp/mcbot-test-logs-well-${process.pid}`
process.env.LOG_DIR = LOG_DIR; process.env.BOT_NAME = 'TestBot'
process.env.WELL_RECORD_SETTLE_MS = '300'   // production 25 s (every peer's 20 s cache refresh); the suite cannot wait that long
const W = await import('../src/well.mjs')
const require = createRequire(import.meta.url)
const REG = require('minecraft-data')('1.21.11')
const Recipe = require('prismarine-recipe')(REG).Recipe
const PBlock = require('prismarine-block')('1.21.11')

let pass = 0, fail = 0
const failed = []
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) {
    fail++; failed.push(name); console.log(`  FAIL  ${name}\n        ${String(e?.stack ?? e).split('\n').slice(0, 4).join('\n        ')}`)
  }
}
const within = (p, ms, what) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`${what} did not finish within ${ms}ms`)), ms))])

// ===================================================================================================================
// WHAT GOES IN
// ===================================================================================================================
await t('the list is the owner\'s eleven (10-04) plus the 10-07 decorations, every one a real item, and nothing the guards forbid', () => {
  for (const n of ['egg', 'brown_egg', 'blue_egg', 'flint', 'clay_ball', 'ink_sac', 'glow_ink_sac', 'armadillo_scute', 'dead_bush', 'pointed_dripstone', 'rail',
    // the owner's 10-07 examples and the census's decorations (glass 59 slots, lead 20, oak_button 17, wool, brick, fences, plates)
    'glass', 'white_wool', 'oak_button', 'lead', 'powered_rail', 'brick', 'bricks', 'oak_fence', 'oak_pressure_plate', 'smooth_basalt', 'polished_diorite',
    'diorite', 'granite', 'andesite', 'stone_bricks', 'mossy_cobblestone', 'smooth_stone']) {
    assert.ok(W.isWellJunk(n), `positive control: ${n} is on the list`)
  }
  for (const n of W.WELL_JUNK) {
    assert.ok(REG.itemsByName[n], `${n} is a real 1.21.11 item`)
    assert.ok(W.isWellJunk(n), `${n} is listed AND passes every guard (a listed name a guard refuses is a typo or a contradiction)`)
  }
  assert.equal(W.WELL_JUNK.size, W.OWNER_JUNK_1004.length + W.DECORATIONS.length + W.SCAFFOLD_DECORATIONS.length, 'no name listed twice')
  // scripts/host/wellread.py keeps a Python copy (its C3 gate) and asserts the same 124: change both together
  assert.equal(W.WELL_JUNK.size, 124)
  for (const n of ['cobblestone', 'cobbled_deepslate', 'dirt', 'gravel', 'sand', 'oak_log', 'oak_planks', 'stick', 'oak_sapling',
    'stone_pickaxe', 'wooden_axe', 'apple', 'bread', 'beef', 'raw_iron', 'iron_ingot', 'coal', 'leaf_litter', 'wheat_seeds', 'poppy', 'bamboo', 'bone_meal',
    // 10-07: what the decoration list must NOT take -- the composter's recipe (wooden slabs), the well's own trapdoors, the
    // sleep skill's bed, desert rescue blocks, raw ballast the stone rung counts, compostables, the furnace and the table
    'oak_slab', 'birch_slab', 'oak_trapdoor', 'red_bed', 'white_bed', 'sandstone', 'red_sandstone', 'calcite', 'tuff', 'stone', 'deepslate',
    'wildflowers', 'moss_carpet', 'moss_block', 'kelp', 'dried_kelp', 'furnace', 'crafting_table', 'chest', 'ladder', 'torch', 'bucket', 'string']) {
    assert.equal(W.isWellJunk(n), false, `${n} must never go down the well`)
  }
})

// THE CONSUMERS (10-07): a listed name is never an input the fleet's own code relies on -- checked against the REAL lists,
// so a later change to one of them that starts using a listed item fails here, not on the fleet.
await t('no listed item is fuel, a composter-build input, or a scaffold/pillar/rescue/exit block -- except the six guarded ones', async () => {
  const { PATHFINDER_SCAFFOLD } = await import('../src/scaffold.mjs')
  const { fuelTicks } = await import('../src/smelting.mjs')
  const { scaffoldCount } = await import('../src/exit-contract.mjs')
  const { RESCUE_BLOCK } = await import('../src/skills.mjs')
  const guarded = new Set(W.SCAFFOLD_DECORATIONS)
  assert.ok(PATHFINDER_SCAFFOLD.includes('diorite') && RESCUE_BLOCK.test('granite') && scaffoldCount([{ name: 'andesite', count: 3 }]) === 3,
    'positive control: the consumer lists do see the guarded stones')
  assert.ok(fuelTicks('oak_planks') > 0, 'positive control: the fuel table answers')
  for (const n of W.WELL_JUNK) {
    assert.equal(fuelTicks(n), 0, `${n} is fuel in smelting.mjs`)
    if (guarded.has(n)) continue
    assert.ok(!PATHFINDER_SCAFFOLD.includes(n), `${n} is a pathfinder scaffold block but not guarded`)
    assert.ok(!RESCUE_BLOCK.test(n), `${n} is a rescue block but not guarded`)
    assert.equal(scaffoldCount([{ name: n, count: 5 }]), 0, `${n} counts toward the exit contract but is not guarded`)
  }
  for (const n of W.SCAFFOLD_DECORATIONS) assert.ok(PATHFINDER_SCAFFOLD.includes(n) || RESCUE_BLOCK.test(n), `${n} is guarded for a reason: a consumer uses it`)
})

await t('STONE_GUARD: a scaffold-capable decoration goes only while the bag KEEPS 64 reserve stone (cobble, deepslate, raw andesite/diorite/granite)', () => {
  const names = p => p.stacks.map(s => `${s.name}:${s.count}`).join(',')
  assert.equal(W.STONE_GUARD, 64)
  assert.deepEqual([...W.RESERVE_STONE].sort(), ['andesite', 'cobbled_deepslate', 'cobblestone', 'diorite', 'granite'])
  // plain decorations never touch the reserve
  assert.equal(names(W.disposePlan([{ name: 'glass', count: 5, slot: 9 }])), 'glass:5')
  // diorite 10 + cobble 63: reserve 73, the diorite would leave 63 -> kept; at cobble 64 it leaves 64 -> goes
  const bag = cobble => [{ name: 'diorite', count: 10, slot: 9 }, { name: 'cobblestone', count: cobble, slot: 10 }, { name: 'glass', count: 5, slot: 11 }]
  assert.equal(names(W.disposePlan(bag(63))), 'glass:5')
  assert.equal(W.disposePlan(bag(63)).junkStacks, 1, 'the trigger counts only what may go')
  assert.equal(names(W.disposePlan(bag(64))), 'diorite:10,glass:5')
  assert.equal(W.disposePlan(bag(64)).stone, 74)
  // stone_bricks is pathfinder scaffold but not reserve stone: it goes while the reserve stays at 64+, and costs none of it
  assert.equal(names(W.disposePlan([{ name: 'stone_bricks', count: 30, slot: 9 }, { name: 'cobblestone', count: 64, slot: 10 }])), 'stone_bricks:30')
  assert.equal(names(W.disposePlan([{ name: 'stone_bricks', count: 30, slot: 9 }, { name: 'cobblestone', count: 63, slot: 10 }])), '')
  // cobbled_deepslate counts; 'stone' (not on every consumer list) does not
  assert.equal(names(W.disposePlan([{ name: 'granite', count: 20, slot: 9 }, { name: 'cobbled_deepslate', count: 64, slot: 10 }])), 'granite:20')
  assert.equal(names(W.disposePlan([{ name: 'granite', count: 20, slot: 9 }, { name: 'stone', count: 640, slot: 10 }])), '')
  // stacks are judged in slot order against what the earlier ones leave
  assert.equal(names(W.disposePlan([{ name: 'diorite', count: 40, slot: 9 }, { name: 'granite', count: 40, slot: 10 }, { name: 'cobblestone', count: 64, slot: 11 }])), 'diorite:40,granite:40')
  assert.equal(names(W.disposePlan([{ name: 'diorite', count: 40, slot: 9 }, { name: 'granite', count: 40, slot: 10 }, { name: 'cobblestone', count: 30, slot: 11 }])), 'diorite:40')
  assert.equal(W.disposableIn({ name: 'cobblestone', count: 64 }, [{ name: 'cobblestone', count: 640 }]), false, 'the guard never lists anything')
  assert.equal(W.guardLeft('glass', 64, 0), 0, 'a plain decoration passes with any reserve')
  assert.equal(W.guardLeft('diorite', 10, 73), null)
  assert.equal(W.guardLeft('diorite', 10, 74), 64)
  assert.equal(W.guardLeft('smooth_stone', 64, 64), 64)
})

await t('NO GUARD-ONLY DEAD END (Codex r1 P2): a full bag of 36 diorite stacks and no cobble disposes down to a 64 reserve, through the order', () => {
  const bag = Array.from({ length: 36 }, (_, i) => ({ name: 'diorite', count: 64, slot: 9 + i }))
  const p = W.disposePlan(bag)
  assert.equal(p.junkStacks, 35, 'every stack but the reserve may go')
  assert.equal(p.stacks.length, W.MAX_STACKS_PER_VISIT)
  // the order fires on it (the composed chain: a full bag at town with a well -> dispose_well)
  const r = W.wellOrder({ now: 1e9, slots: 36, freeSlots: 0, junkStacks: p.junkStacks, distHome: 5, well: () => ({ open: false, attended: false, breached: false }) })
  assert.equal(r.order?.skill, 'dispose_well', JSON.stringify(r))
  // and what stays is exactly one stack: 64 reserve stone
  const keep = bag.filter(it => !W.disposePlan(bag, { maxStacks: 99 }).stacks.some(s => s.slot === it.slot))
  assert.deepEqual(keep.map(it => `${it.name}:${it.count}`), ['diorite:64'])
})

await t('the row carries the guard evidence (gclicked=, stone=) right after offlist -- a 300-character cut from the end cannot drop it', () => {
  const items = Object.fromEntries(['white_stained_glass_pane', 'light_gray_stained_glass_pane', 'light_blue_stained_glass_pane', 'magenta_stained_glass_pane', 'diorite'].map(n => [n, 64]))
  const d = W.wellDisposeDetail({ slotsBefore: 36, slotsAfter: 31, items, tossed: 5, source: 'resync', stop: 'done', stone: 63, gclicked: 64, at: { x: 1000, y: 64, z: -1000 } })
  assert.equal(d.length, 300, 'positive control: this row IS cut by the cap')
  assert.doesNotMatch(d, /diorite:64/, 'positive control: the cut ate the guarded item from items=')
  assert.match(d.slice(0, 80), / gclicked=64 stone=63 /, d)
  assert.match(W.wellDisposeDetail({ slotsBefore: 36, slotsAfter: 36 }), / gclicked=0 swords=0 sword_lost=0 sword_kept=0 offlist_items=/, 'no click, no reserve claim')
  // the read's C7 predicate is the row's own fields (wellread.py c7_breach): gclicked > 0 with stone missing or < 64
  const src = readFileSync(new URL('../../scripts/host/wellread.py', import.meta.url), 'utf8')
  assert.match(src, /if num\(f, 'gclicked'\) > 0 and \(st is None or not str\(st\)\.isdigit\(\) or int\(st\) < STONE_GUARD\):/)
})

// ===================================================================================================================
// THE GEOMETRY, against the registry's own trapdoor boxes
// ===================================================================================================================
/** Does every item centre in the opening keep its 0.125 half-width off the open flap's box? */
const flapClear = (o, [x0, z0, x1, z1]) => {
  const m = 0.125, thinX = x1 - x0 < 0.5
  if (thinX) return x0 > 0.5 ? o.x1 + m <= x0 + 1e-9 : o.x0 - m >= x1 - 1e-9
  return z0 > 0.5 ? o.z1 + m <= z0 + 1e-9 : o.z0 - m >= z1 - 1e-9
}
const trapShape = props => {
  const b = REG.blocksByName.oak_trapdoor
  for (let id = b.minStateId; id <= b.maxStateId; id++) {
    const x = PBlock.fromStateId(id, 0); const p = x.getProperties()
    if (Object.entries(props).every(([k, v]) => p[k] === v) && !p.waterlogged && !p.powered) return x.shapes
  }
  throw new Error('no state')
}
await t('CLEARANCE with the vanilla trapdoor boxes: 1.625 under the cap with the floor trapdoor < creeper 1.7; 1.8125 without it (the sandbox finding)', () => {
  const capBottom = trapShape({ half: 'top', open: false, facing: 'north' })[0][1]
  const floorTop = trapShape({ half: 'bottom', open: false, facing: 'north' })[0][4]
  assert.equal(capBottom, 0.8125); assert.equal(floorTop, 0.1875)
  const creeper = REG.entitiesByName.creeper.height
  assert.equal(creeper, 1.7)
  const g = 63
  const withFloor = (g + capBottom) - (g - 1 + floorTop), without = (g + capBottom) - (g - 1)
  assert.equal(without, 1.8125); assert.ok(without > creeper, 'positive control: without the floor trapdoor a creeper fits')
  assert.equal(withFloor, 1.625); assert.ok(withFloor < creeper, 'with the floor trapdoor a creeper cannot fit')
  for (const m of ['zombie', 'skeleton', 'spider', 'creeper', 'witch', 'enderman']) {
    const e = REG.entitiesByName[m]
    assert.ok(e.height > withFloor || e.width > 1, `${m} (${e.width}x${e.height}) fits in the shaft`)
  }
})

await t('PICKUP: an item on the floor trapdoor is >= 0.75 below every standing player near it (rim and closed cap); a body INSIDE would reach it (control)', () => {
  const g = 63, cap = { x: 0, y: g, z: 0 }
  const item = { x: 0.5, y: g - 1 + 0.1875, z: 0.5 }
  let n = 0
  for (let x = -1.5; x <= 2.5; x += 0.25) for (let z = -1.5; z <= 2.5; z += 0.25) {
    const feet = { x, y: g + 1, z }
    assert.ok(feet.y - item.y >= 0.75 + 1); n++
    assert.equal(inPickupBox(feet, item, 0, 0), false, `a body at ${x},${z} on the rim picks it up`)
  }
  assert.ok(n > 200)
  assert.equal(inPickupBox({ x: 0.5, y: g - 1 + 0.1875, z: 0.5 }, item, 0, 0), true, 'positive control: a body standing in the shaft does')
  // a body in a DUG wall cell (feet at g, beside the shaft): still out of the box, by the floor trapdoor's 1/16 margin
  assert.equal(inPickupBox({ x: 1.3, y: g, z: 0.5 }, item, 0, 0), false)
  assert.ok(W.bodyInWell([cap], { x: 0.5, y: g - 1 + 0.1875, z: 0.5 })); assert.equal(W.bodyInWell([cap], { x: 0.5, y: g + 1, z: 0.5 }), null, 'on the closed cap is not inside')
  assert.ok(W.itemInWell([cap], item)); assert.equal(W.itemInWell([cap], { x: 0.5, y: g + 1, z: 0.5 }), null, 'on the cap is not in the well')
})

await t('THE FLAP: for every facing, the registry\'s OPEN shape lies on the side the opening excludes, never the stand side', () => {
  const cap = { x: 0, y: 63, z: 0 }
  for (const facing of ['north', 'south', 'west', 'east']) {
    const [x0, , z0, x1, , z1] = trapShape({ half: 'top', open: true, facing })[0]
    const o = W.wellOpening(cap, facing)
    const f = W.FACING[facing], stand = { x: 0.5 + f.x, z: 0.5 + f.z }
    const flapMid = { x: (x0 + x1) / 2, z: (z0 + z1) / 2 }
    assert.ok(Math.hypot(flapMid.x - stand.x, flapMid.z - stand.z) > 1.2, `${facing}: the flap is on the stand's side`)
    assert.ok(flapClear(o, [x0, z0, x1, z1]), `${facing}: an item centred in the opening can touch the flap`)
    const open = W.wellOpening(cap, null)
    assert.ok((o.x1 - o.x0) * (o.z1 - o.z0) < (open.x1 - open.x0) * (open.z1 - open.z0), 'the flap narrows the opening')
  }
})

// ===================================================================================================================
// THE AIM
// ===================================================================================================================
await t('AIM: pitches match the sandbox (54.45 at 1.0, 58.5 at 0.85, 48.45 at 1.15) within 1.5 degrees; rates >= 0.99', () => {
  const cap = { x: 10, y: 63, z: 10 }
  for (const [d, sb] of [[1.0, 54.45], [0.85, 58.5], [1.15, 48.45]]) {
    const a = W.wellAim({ from: { x: 10.5, z: 10.5 - d }, cap, facing: 'north' })
    assert.ok(a.ok, `${d}: ${a.why}`); assert.ok(Math.abs(a.pitch - sb) <= 1.5, `${d}: pitch ${a.pitch} vs sandbox ${sb}`); assert.ok(a.rate >= 0.99, `${d}: ${a.rate}`)
  }
  assert.ok(W.wellAim({ from: { x: 10.75, z: 9.5 }, cap, facing: 'north' }).ok, 'the sandbox\'s lateral 0.25 stand')
  assert.equal(W.wellAim({ from: { x: 10.5, z: 10.5 - 1.2 }, cap, facing: 'north' }).ok, false, 'beyond 1.15: refused')
  assert.equal(W.wellAim({ from: { x: 10.5, z: 10.5 - 0.7 }, cap, facing: 'north' }).ok, false, 'nearer than 0.8: refused')
})

await t('AIM cross-check: a seeded Monte Carlo of vanilla\'s RANDOM drop at the chosen pitch lands >= 98% in the opening (the quadrature is not flattering itself)', () => {
  let seed = 12345; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648
  const cap = { x: 10, y: 63, z: 10 }
  for (const d of [0.9, 1.0, 1.1]) {
    const from = { x: 10.5, z: 10.5 - d }
    const a = W.wellAim({ from, cap, facing: 'north' })
    const o = W.wellOpening(cap, 'north')
    let hit = 0; const N = 4000
    for (let i = 0; i < N; i++) {
      const ang = rnd() * 2 * Math.PI, m = 0.02 * rnd()
      const c = W.tossCrossing({ ux: 0, uz: 1, pitchDeg: a.pitch, dvy: (rnd() - rnd()) * 0.1, dvx: Math.cos(ang) * m, dvz: Math.sin(ang) * m })
      const X = from.x + c.x, Z = from.z + c.z
      if (X >= o.x0 && X <= o.x1 && Z >= o.z0 && Z <= o.z1) hit++
    }
    assert.ok(hit / N >= 0.98, `${d}: MC ${hit / N} at ${a.pitch}`)
    // positive control: a bad pitch misses
    let bad = 0
    for (let i = 0; i < 500; i++) { const c = W.tossCrossing({ ux: 0, uz: 1, pitchDeg: 25, dvy: (rnd() - rnd()) * 0.1 }); const Z = from.z + c.z; if (Z >= o.z0 && Z <= o.z1) bad++ }
    assert.ok(bad / 500 < 0.5, 'positive control: a shallow throw clears the opening')
  }
})

await t('aimPoint looks along the cap\'s centre bearing at the pitch asked', () => {
  const eye = { x: 10.5, y: 65.62, z: 9.5 }, cap = { x: 10, y: 63, z: 10 }
  const p = W.aimPoint({ eye, cap, pitchDeg: 54 })
  const h = Math.hypot(p.x - eye.x, p.z - eye.z)
  assert.ok(Math.abs(Math.atan2(eye.y - p.y, h) * 180 / Math.PI - 54) < 1e-9)
  assert.ok(Math.abs(p.x - 10.5) < 1e-9 && p.z > eye.z, 'toward +z, the cap')
})

await t('tossOutcome: in the shaft vs on the rim or the cap', () => {
  const cap = { x: 10, y: 63, z: 10 }
  const r = W.tossOutcome({ cap, items: [{ id: 1, x: 10.5, y: 62.19, z: 10.4 }, { id: 2, x: 10.5, y: 64, z: 11.2 }, { id: 3, x: 10.5, y: 64, z: 10.5 }] })
  assert.deepEqual(r.inWell, [1]); assert.deepEqual(r.missed.map(m => m.id), [2, 3])
})

// ===================================================================================================================
// ADMISSION
// ===================================================================================================================
await t('ADMISSION: nobody else within 5 of the rim; self and far players ignored; the nearest is named', () => {
  const cap = { x: 0, y: 63, z: 0 }
  assert.equal(W.wellAdmission({ cap, players: [] }), null)
  assert.equal(W.wellAdmission({ cap, me: 'a', players: [{ username: 'a', x: 0.5, y: 64, z: 0.5 }] }), null, 'self')
  assert.equal(W.wellAdmission({ cap, players: [{ username: 'far', x: 6, y: 64, z: 0.5 }] }), null)
  const r = W.wellAdmission({ cap, players: [{ username: 'far', x: 4.4, y: 64, z: 0.5 }, { username: 'near', x: 2.5, y: 64, z: 0.5 }] })
  assert.equal(r.reason, 'player_near'); assert.equal(r.who, 'near')
})

// ===================================================================================================================
// THE SITE
// ===================================================================================================================
const AIR = { name: 'air', boundingBox: 'empty', hardness: 0, shapes: [] }
const shapesOf = name => { const d = REG.blocksByName[name]; return PBlock.fromStateId(d.defaultState, 0).shapes }
const B = name => ({ name, boundingBox: REG.blocksByName[name].boundingBox, hardness: REG.blocksByName[name].hardness, shapes: shapesOf(name) })
const TD = (half, open = false, facing = 'north') => ({ name: 'oak_trapdoor', boundingBox: 'block', hardness: 3, props: { half, open, facing }, shapes: [] })
const flatRead = (extra = {}, g = 63) => (x, y, z) => extra[`${x},${y},${z}`] ?? (y > g ? AIR : y === g ? B('grass_block') : B('dirt'))
const HOME0 = { x: 0, y: 64, z: 0 }
const HOMEFAR = { x: -20, y: 64, z: 0 }   // the site tests' cap at x=5 is 25 from it: home clearance is not what they test

await t('SITE: flat dirt passes; a cave cell 2 off at g-3 (Codex\'s underground neighbour), liquid within 3, a chest within 3, sand walls and the home point are refused', () => {
  const cap = { x: 5, y: 63, z: 0 }
  assert.equal(W.wellSiteRefusal(flatRead(), cap, HOMEFAR), null, 'positive control: flat ground')
  assert.match(W.wellSiteRefusal(flatRead({ '7,60,0': AIR }), cap, HOMEFAR), /underground air/)
  assert.match(W.wellSiteRefusal(flatRead({ '6,62,1': AIR }), cap, HOMEFAR), /wall is air|underground/)
  assert.match(W.wellSiteRefusal(flatRead({ '8,63,0': B('water') }), cap, HOMEFAR), /water within 3/)
  assert.match(W.wellSiteRefusal(flatRead({ '6,64,1': B('chest') }), cap, HOMEFAR), /chest within 3/)
  assert.match(W.wellSiteRefusal(flatRead({ '6,64,1': B('composter') }), cap, HOMEFAR), /composter within 3/)
  assert.match(W.wellSiteRefusal(flatRead({ '4,63,0': B('sand') }), cap, HOMEFAR), /wall is sand/)
  assert.equal(W.wellSiteRefusal(flatRead(), { x: 1, y: 63, z: 0 }, HOME0), 'too near home (bots idle there)')
  assert.equal(W.wellSiteRefusal(flatRead(), { x: 6, y: 63, z: 0 }, HOME0), 'too near home (bots idle there)', 'inside WELL_HOME_CLEARANCE')
  assert.equal(W.wellSiteRefusal(flatRead(), cap, HOMEFAR, { avoid: [{ x: 6, z: 1 }] }), 'the composter site is within 3')
  assert.equal(W.wellSiteRefusal(flatRead({ '7,59,0': AIR }), cap, HOMEFAR), null, 'g-4 is below the ring: a cave there cannot reach')
  const unknown = (x, y, z) => (x === 7 && y === 61 ? null : flatRead()(x, y, z))
  assert.equal(W.wellSiteRefusal(unknown, cap, HOMEFAR), 'unknown', 'never on a guess')
})

await t('SITE STAGES: a part-built site is accepted (resume); a built one is "already a well"; identity reads the cap', () => {
  const cap = { x: 5, y: 63, z: 0 }
  assert.equal(W.wellStage(flatRead(), cap), 'fresh')
  const dug = { '5,63,0': AIR, '5,62,0': AIR }
  assert.equal(W.wellStage(flatRead({ '5,63,0': AIR }), cap), 'half_dug')
  assert.equal(W.wellStage(flatRead(dug), cap), 'dug'); assert.equal(W.wellSiteRefusal(flatRead(dug), cap, HOMEFAR), null)
  const floored = { '5,63,0': AIR, '5,62,0': TD('bottom') }
  assert.equal(W.wellStage(flatRead(floored), cap), 'floored'); assert.equal(W.wellSiteRefusal(flatRead(floored), cap, HOMEFAR), null)
  const built = { '5,63,0': TD('top', false, 'north'), '5,62,0': TD('bottom') }
  assert.equal(W.wellStage(flatRead(built), cap), 'built'); assert.equal(W.wellSiteRefusal(flatRead(built), cap, HOMEFAR), 'already a well')
  assert.deepEqual(W.wellIdentity(flatRead(built), cap), { ok: true, open: false, facing: 'north', floor: true })
  assert.equal(W.wellIdentity(flatRead({ '5,63,0': TD('bottom') }), cap).ok, false, 'a bottom-half trapdoor is no cap')
  assert.equal(W.wellIdentity(flatRead({ '5,63,0': TD('top') }), cap).ok, false, 'a cap over solid ground is no well')
  assert.equal(W.wellIdentity(flatRead({ '5,63,0': TD('top', true, 'east'), '5,62,0': AIR }), cap).open, true)
})

await t('STAND: the facing side, feet and head open over a full block, hinge opposite; a slab stand is skipped', () => {
  const cap = { x: 5, y: 63, z: 0 }
  const s = W.wellStand(flatRead(), cap)
  assert.equal(s.facing, 'north'); assert.deepEqual(s.stand, { x: 5, y: 64, z: -1 }); assert.deepEqual(s.hinge, { x: 5, y: 63, z: 1 }); assert.deepEqual(s.face, { x: 0, y: 0, z: -1 })
  assert.deepEqual(W.standForFacing(cap, 'north'), s.stand)
  const s2 = W.wellStand(flatRead({ '5,63,-1': B('oak_slab') }), cap)
  assert.equal(s2.facing, 'west', 'a slab under the north stand is not a full block -- and as the south side\'s hinge it is no wall either')
})

await t('CANONICAL: a pure function of home and the world; it skips a column with a cave beside it', () => {
  const a = W.canonicalWellSite({ home: HOME0, read: flatRead() }).site
  assert.ok(a); assert.deepEqual(W.canonicalWellSite({ home: HOME0, read: flatRead() }).site, a)
  const cave = {}; for (let dx = -1; dx <= 1; dx++) cave[`${a.x + dx},60,${a.z}`] = AIR
  const b = W.canonicalWellSite({ home: HOME0, read: flatRead(cave) }).site
  assert.ok(b && (b.x !== a.x || b.z !== a.z), 'the cave column was taken')
  assert.equal(W.wellSiteRefusal(flatRead(cave), a, HOME0) !== null, true)
})

// ===================================================================================================================
// THE SCHEDULER AND THE ROOM DECISION
// ===================================================================================================================
const NOW = 10_000_000
const well0 = { open: false, attended: false }
await t('ORDER: dispose at >= 34 slots with listed junk, at town; never below 34, never without junk, never away', () => {
  const o = x => W.wellOrder({ now: NOW, distHome: 5, well: well0, slots: 34, freeSlots: 2, junkStacks: 2, ...x }).order?.skill ?? null
  assert.equal(o({}), 'dispose_well')
  assert.equal(o({ slots: 33, freeSlots: 3 }), null)
  assert.equal(o({ junkStacks: 0 }), null)
  assert.equal(o({ distHome: 60 }), null)
  assert.equal(o({ well: () => ({ open: true, attended: false }) }), 'close_well', 'an open, unattended well is closed first')
  assert.equal(o({ well: () => ({ open: true, attended: true }) }), 'dispose_well', 'an attended open well is someone else\'s')
  let calls = 0
  const r = W.wellOrder({ now: NOW, distHome: 5, slots: 10, freeSlots: 26, junkStacks: 0, well: () => { calls++; return null }, buildPlan: () => null, state: {} })
  assert.equal(r.order, null); assert.equal(calls, 1)
  W.wellOrder({ now: NOW + 1000, distHome: 5, slots: 10, well: () => { calls++; return null }, buildPlan: () => null, state: r.state })
  assert.equal(calls, 1, 'the world scan is rate limited')
})

await t('ORDER: build when the town has none, room or pit-first; one builder (lowest name defers, bounded)', () => {
  const plan = { wood: 'oak', slotsNeeded: 2 }
  const o = x => W.wellOrder({ now: NOW, distHome: 5, well: null, buildPlan: plan, slots: 20, freeSlots: 16, junkStacks: 0, ...x })
  assert.equal(o({}).order?.skill, 'build_well')
  assert.equal(o({ slots: 36, freeSlots: 0, junkStacks: 0 }).order, null, 'no room and no junk to make it')
  assert.match(o({ slots: 36, freeSlots: 0, junkStacks: 2 }).order?.why ?? '', /2 junk stack\(s\) go down the pit first/)
  assert.equal(o({ buildPlan: null }).order, null)
  const d = o({ myName: 'b', peers: ['a'] }); assert.equal(d.order, null); assert.equal(d.state.deferrals, 1)
  assert.equal(o({ myName: 'b', peers: ['a'], state: { deferrals: 3 } }).order?.skill, 'build_well', 'no starvation')
})

await t('ROOM: craft first with room; pit-first when junk stacks cover the deficit; else short', () => {
  assert.deepEqual(W.wellBuildRoom({ free: 3, slotsNeeded: 2, junkStacks: 0 }), { ok: true, pitFirst: false, toss: 0, short: 0 })
  assert.deepEqual(W.wellBuildRoom({ free: 0, slotsNeeded: 2, junkStacks: 3 }), { ok: true, pitFirst: true, toss: 2, short: 0 })
  assert.deepEqual(W.wellBuildRoom({ free: 1, slotsNeeded: 3, junkStacks: 1 }), { ok: false, pitFirst: false, toss: 0, short: 1 })
})

await t('BUILD PLAN: two carried trapdoors; or 6 planks (+4 for a table) from one wood\'s logs; simulated slots', () => {
  assert.deepEqual(W.wellBuildPlan({ oak_trapdoor: 1, spruce_trapdoor: 1 }), { carried: true, trapdoor: 'oak_trapdoor', slotsNeeded: 0, need: 2 })
  assert.equal(W.wellBuildPlan({ oak_trapdoor: 1 }), null, 'one trapdoor and no wood: not enough for a fresh site')
  assert.equal(W.wellBuildPlan({ oak_trapdoor: 1 }, { need: W.trapdoorsNeeded('floored') }).carried, true, 'a floored pit needs only its cap (Codex review)')
  assert.deepEqual([W.trapdoorsNeeded('fresh'), W.trapdoorsNeeded('dug'), W.trapdoorsNeeded('floored'), W.trapdoorsNeeded('built')], [2, 2, 1, 0])
  assert.equal(W.wellBuildPlan({ oak_log: 2 }), null, '2 logs = 8 planks < 10 without a table')
  const p = W.wellBuildPlan({ oak_log: 3 })
  assert.equal(p.wood, 'oak'); assert.equal(p.logCrafts, 3); assert.equal(p.needTable, true); assert.equal(p.trapdoor, 'oak_trapdoor')
  assert.equal(W.wellBuildPlan({ oak_log: 2 }, { tableAvailable: true }).logCrafts, 2)
  assert.equal(W.wellBuildPlan({ birch_planks: 6 }, { tableAvailable: true }).logCrafts, 0)
  const sim = W.wellBuildPlan({ oak_planks: 6 }, { tableAvailable: true, items: [{ name: 'oak_planks', count: 6 }] })
  assert.equal(sim.slotsNeeded, 0, 'the planks stack the craft empties takes the trapdoors')
  assert.equal(W.wellBuildPlan({ iron_trapdoor: 4 }), null, 'iron trapdoors are not wooden')
})

await t('OUTCOME: a skip, an abort or a runner refusal is free; a failed dispose backs off; a no-room build only a cooldown', () => {
  const f = W.wellOrderOutcome
  assert.equal(f('dispose_well', 'no_effect', NOW, {}).disposeBackoffUntil ?? 0, 0)
  assert.equal(f('dispose_well', 'aborted', NOW, {}).disposeBackoffUntil ?? 0, 0)
  assert.equal(f('dispose_well', 'failed', NOW, {}, 'runner_busy').disposeBackoffUntil ?? 0, 0)
  assert.equal(f('dispose_well', 'failed', NOW, {}).disposeBackoffUntil, NOW + W.DISPOSE_BACKOFF_MS)
  assert.equal(f('build_well', 'failed', NOW, {}, 'well_no_room').buildBackoffUntil, NOW + W.WELL_BUILD_COOLDOWN_MS)
  assert.equal(f('build_well', 'failed', NOW, {}, 'well_place').buildBackoffUntil, NOW + W.WELL_BUILD_BACKOFF_MS)
  assert.equal(f('dispose_well', 'success', NOW, { disposeBackoffUntil: NOW + 5 }).disposeBackoffUntil, 0)
})

// ===================================================================================================================
// EVERY PATH KEEPS OUT: the real pathfinder (mineflayer-pathfinder 2.4.5 Movements + AStar)
// ===================================================================================================================
const routeWorld = ({ well = { x: 2, y: 63, z: 0 }, open = false, pillar = false } = {}) => {
  const reg = require('prismarine-registry')('1.21.8'); const Block = require('prismarine-block')(reg)
  const { Movements: Mv, goals: G } = require('mineflayer-pathfinder')
  const AStar = require('mineflayer-pathfinder/lib/astar.js'); const Move = require('mineflayer-pathfinder/lib/move.js')
  const w = new Map(), k = (x, y, z) => `${x},${y},${z}`
  for (let x = -3; x <= 7; x++) for (let z = -3; z <= 3; z++) { w.set(k(x, 63, z), 'stone'); if (Math.abs(z) >= 1) for (let y = 64; y <= 72; y++) w.set(k(x, y, z), 'bedrock') }
  w.set(k(well.x, well.y, well.z), 'oak_trapdoor'); w.set(k(well.x, well.y - 1, well.z), 'oak_trapdoor')
  let start = new Move(0, 64, 0, 0, 0)
  if (pillar) {   // the only way off a 3-high pillar drops past the well column onto the cap (drop-down landing)
    for (let y = 64; y <= 66; y++) w.set(k(1, y, 0), 'stone')
    for (let y = 64; y <= 72; y++) w.set(k(0, y, 0), 'bedrock')
    start = new Move(1, 67, 0, 0, 0)
  }
  const nameAt = (x, y, z) => w.get(k(x, y, z)) ?? (y < 63 ? 'bedrock' : 'air')
  const stateOf = (name, x, y, z) => {
    const b = reg.blocksByName[name]
    if (name !== 'oak_trapdoor') return b.defaultState
    for (let id = b.minStateId; id <= b.maxStateId; id++) {
      const p = Block.fromStateId(id, 0).getProperties()
      if (p.facing === 'north' && !p.powered && !p.waterlogged && p.half === (y === well.y ? 'top' : 'bottom') && p.open === (y === well.y ? open : false)) return id
    }
  }
  const blockAt = p => {
    const x = Math.floor(p.x), y = Math.floor(p.y), z = Math.floor(p.z)
    const name = nameAt(x, y, z); const b = Block.fromStateId(stateOf(name, x, y, z), 0); b.position = new Vec3(x, y, z); return b
  }
  const bot = { registry: reg, version: '1.21.8', game: { minY: -64, height: 384 }, blockAt, entity: { position: new Vec3(start.x + 0.5, start.y, start.z + 0.5), effects: {} },
                entities: {}, inventory: { items: () => [], slots: [] }, pathfinder: { bestHarvestTool: () => null } }
  const profile = (cols) => { const m = new Mv(bot); m.canDig = false; m.allowParkour = false; m.maxDropDown = 6; if (cols) m.exclusionAreasStep = [b => W.wellStepCost(cols, b)]; return m }
  const route = (m, goal = new G.GoalBlock(5, 64, 0)) => new AStar(start, m, goal, 3000, 1000).compute()
  const inColumn = r => r.path.filter(n => n.x === well.x && n.z === well.z && n.y >= well.y - 1 && n.y <= well.y + 10).map(n => `${n.x},${n.y},${n.z}`)
  return { reg, bot, G, Mv, route, profile, inColumn, well }
}

await t('PATH: the plain profile walks over the closed cap (positive control); with the well cost no node is ever in the column, and a detour does not exist in a 1-wide corridor', () => {
  const { route, profile, inColumn } = routeWorld()
  const plain = route(profile(null))
  assert.equal(plain.status, 'success'); assert.deepEqual(inColumn(plain), ['2,64,0'], 'positive control: the corridor route crosses the cap')
  const r = route(profile([{ x: 2, y: 63, z: 0 }]))
  assert.deepEqual(inColumn(r), [], `a node in the well column: ${r.status}`)
})

await t('PATH: an OPEN cap is still floor to the planner (the sandbox hazard: positive control) -- and a GOAL on the well cell is never reached through it', () => {
  const { route, profile, inColumn, G } = routeWorld({ open: true })
  const plain = route(profile(null), new G.GoalBlock(2, 64, 0))
  assert.equal(plain.status, 'success', 'positive control: the planner happily ends ON an open trapdoor'); assert.deepEqual(inColumn(plain).slice(-1), ['2,64,0'])
  const r = route(profile([{ x: 2, y: 63, z: 0 }]), new G.GoalBlock(2, 64, 0))
  assert.notEqual(r.status, 'success'); assert.deepEqual(inColumn(r), [])
})

await t('PATH: the drop-down landing (getLandingBlock bypasses step exclusions on the landing) cannot land on the cap: the column is closed up to +10', () => {
  const { route, profile, inColumn, G } = routeWorld({ pillar: true })
  const plain = route(profile(null), new G.GoalBlock(5, 64, 0))
  assert.equal(plain.status, 'success'); assert.ok(inColumn(plain).includes('2,64,0'), `positive control: the drop lands on the cap: ${plain.path.map(n => `${n.x},${n.y},${n.z}`).join(' ')}`)
  const r = route(profile([{ x: 2, y: 63, z: 0 }]), new G.GoalBlock(5, 64, 0))
  assert.deepEqual(inColumn(r), [], `${r.status} ${r.path.map(n => `${n.x},${n.y},${n.z}`).join(' ')}`)
})

await t('BREAK: a dig profile never digs a trapdoor or the well\'s walls, floor or ring; it still digs stone further off (positive control)', async () => {
  const { reg, bot, Mv } = routeWorld()
  const cols = [{ x: 2, y: 63, z: 0 }]
  const m = W.protectWellBlocks(new Mv(bot), reg)
  m.canDig = true; m.dontCreateFlow = false; m.dontMineUnderFallingBlock = false
  m.exclusionAreasBreak = [b => W.wellBreakCost(cols, b)]
  const at = (x, y, z) => bot.blockAt(new Vec3(x, y, z))
  assert.equal(m.safeToBreak(at(6, 63, 0)), true, 'positive control')
  assert.equal(m.safeToBreak(at(3, 63, 0)), false, 'a wall')
  assert.equal(m.safeToBreak(at(4, 61, 1)), false, 'the underground ring')
  assert.equal(m.safeToBreak(at(2, 61, 0)), false, 'the floor')
  const bare = W.protectWellBlocks(new Mv(bot), reg); bare.canDig = true; bare.dontCreateFlow = false; bare.dontMineUnderFallingBlock = false
  assert.equal(bare.safeToBreak(at(2, 63, 0)), false, 'the trapdoor type is never dug, with or without a known well')
  const { tunnelMovements } = await import('../src/oretunnel.mjs')
  for (const tm of [tunnelMovements(bot, null), tunnelMovements(bot, m)]) assert.ok(tm.blocksCantBreak.has(reg.blocksByName.oak_trapdoor.id), 'the tunnel profile digs trapdoors')
  assert.equal(W.wellStepCost(cols, { position: { x: 2, y: 74, z: 0 } }), 0, 'above +10 is free')
  assert.equal(W.wellStepCost(cols, { position: { x: 3, y: 64, z: 0 } }), 0, 'beside the column is free')
})

// ===================================================================================================================
// THE SKILLS, through the real registry and a fake bot
// ===================================================================================================================
const { SKILLS, SKILL_CONTRACTS, classifyOutcome, throwResults, installWellWatch } = await import('../src/skills.mjs')
const SP = new URL('../src/skills.mjs', import.meta.url)
const WP = new URL('../src/well.mjs', import.meta.url)
const { config } = await import('../src/config.mjs')
const { isHousekeeping } = await import('../src/hygiene.mjs')
const HOME = { x: config.world.homeX, y: config.world.homeY, z: config.world.homeZ }
const G0 = HOME.y - 1   // the fake town is flat: grass at G0, dirt below, feet at G0+1

/**
 * The fake town. Inventory slots 9..44 like mineflayer's (hotbar 36..44); equip SWAPS; crafted/collected output goes to a
 * partial stack or the first empty slot and is DROPPED when there is none. Throws (clickWindow mode 4 button 1) empty
 * the slot and spawn an item at the feet + 1.32, landing where vanilla's NOISE-FREE drop crosses the rim plane
 * (well.mjs tossCrossing from the last lookAt): into the shaft through an open cap or a pit, else on the rim/cap.
 * mineflayer hears an item's resting position 20 ticks after it spawns; the server hands an item to a body whose box
 * holds it once the pickup delay (40 ticks for a throw, 10 for a dig) has passed and the bag has room.
 */
function fakeTown ({ items = [], hand = null, storeDir = null, blocks = {}, wellAt = null, wellOpen = false, wellFacing = 'north', players = {}, botAt = null, unloaded = [] } = {}) {
  process.env.POOL_STATE_DIR = storeDir ?? mkdtempSync(path.join(tmpdir(), 'well-store-'))
  const world = new Map(Object.entries(blocks).map(([k, v]) => [k, typeof v === 'string' ? { name: v } : v]))
  const key = p => `${p.x},${p.y},${p.z}`
  const state = { tick: 0, clicks: [], goals: [], activations: [], events: [], dropped: [], pending: [], lookPitch: null, lookDir: null, digs: [], places: [], nextId: 1000,
                  missNext: 0, refuseClose: false, onClick: null, writes: [], placeLagTicks: 0, lagged: [], serverSilent: false, onResync: null, activateLagTicks: 0, tickThrows: false, serverSubstitute: null }
  const cell = v => world.get(key(v)) ?? { name: v.y > G0 ? 'air' : v.y === G0 ? 'grass_block' : 'dirt' }
  const gone = new Set(unloaded)   // cells in a chunk not yet sent: blockAt answers null, as mineflayer does
  const blockAt = p => {
    const v = new Vec3(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z))
    if (gone.has(key(v))) return null
    const c = cell(v), def = REG.blocksByName[c.name]
    const b = { name: c.name, type: def.id, position: v, boundingBox: def.boundingBox, hardness: def.hardness, diggable: def.diggable, shapes: /_trapdoor$/.test(c.name) ? [] : shapesOf(c.name) }
    if (c.props) b.getProperties = () => ({ ...c.props })
    return b
  }
  const slots = new Array(46).fill(null)
  const mk = (name, count, extra = {}) => ({ name, type: REG.itemsByName[name].id, count, stackSize: REG.itemsByName[name].stackSize, ...extra })
  let next = 9
  if (hand) slots[36] = { ...mk(hand.name, hand.count), slot: 36 }
  for (const x of items) { while (slots[next] || next === 36) next++; slots[next] = { ...mk(x.name, x.count), slot: next } }
  const add = (name, n) => {
    const max = REG.itemsByName[name].stackSize
    while (n > 0) {
      const partial = slots.find((s, i) => i >= 9 && s && s.name === name && s.count < max)
      if (partial) { const k = Math.min(max - partial.count, n); partial.count += k; n -= k; continue }
      const order = [36, 37, 38, 39, 40, 41, 42, 43, 44, ...Array.from({ length: 27 }, (_, i) => 9 + i)]
      const empty = order.find(i => !slots[i])
      if (empty == null) { state.dropped.push(`${n}x ${name}`); return false }
      const k = Math.min(max, n); slots[empty] = mk(name, k, { slot: empty }); n -= k
    }
    return true
  }
  const room = name => slots.slice(9, 45).some(s => !s) || slots.slice(9, 45).some(s => s && s.name === name && s.count < s.stackSize)
  const take = (name, n) => {
    for (const s of slots.slice(9)) { if (!s || s.name !== name || n <= 0) continue; const k = Math.min(s.count, n); s.count -= k; n -= k; if (!s.count) slots[s.slot] = null }
    if (n > 0) throw new Error(`missing ${n}x ${name}`)
  }
  const count = name => slots.slice(9).reduce((a, s) => a + (s && s.name === name ? s.count : 0), 0)
  // WHERE AN ITEM CROSSING THE RIM PLANE AT X,Z COMES TO REST: through an air cell or an open top trapdoor's opening
  // (well.mjs wellOpening, the vanilla flap) down the column onto the first solid or bottom-trapdoor floor; else on top.
  const landAt = (X, Z) => {
    const col = { x: Math.floor(X), y: G0, z: Math.floor(Z) }
    const top = cell(col)
    const through = top.name === 'air' || (/_trapdoor$/.test(top.name) && top.props?.half === 'top' && top.props.open && (() => {
      const o = W.wellOpening(col, top.props.facing); return X >= o.x0 && X <= o.x1 && Z >= o.z0 && Z <= o.z1
    })())
    if (!through) return new Vec3(X, G0 + 1, Z)
    let y = G0 - 1
    for (;;) {
      const here = cell({ x: col.x, y, z: col.z })
      if (/_trapdoor$/.test(here.name) && here.props?.half === 'bottom') return new Vec3(X, y + 0.1875, Z)
      if (here.name !== 'air') return new Vec3(X, y + 1, Z)
      y--
    }
  }
  const listeners = {}
  let lru = 0
  const capCell = () => wellAt
  const bot = {
    username: 'b-Alpha', quickBarSlot: 0, health: 20, food: 20, controlState: { sneak: false }, entities: {},
    players: {},
    entity: { position: botAt ?? new Vec3(HOME.x + 0.5, HOME.y, HOME.z + 0.5), height: 1.8 },
    get heldItem () { return slots[36 + bot.quickBarSlot] ?? null },
    registry: REG,
    inventory: { slots, items: () => slots.slice(9, 45).filter(s => s && s.count > 0), count: id => slots.slice(9).reduce((a, s) => a + (s && s.type === id ? s.count : 0), 0),
                 emptySlotCount: () => slots.slice(9, 45).filter(s => !s).length },
    on (ev, fn) { (listeners[ev] ??= []).push(fn) }, removeListener (ev, fn) { listeners[ev] = (listeners[ev] ?? []).filter(f => f !== fn) },
    emit (ev, ...a) { for (const f of [...(listeners[ev] ?? [])]) f(...a) },
    setQuickBarSlot (n) { bot.quickBarSlot = n },
    setControlState () {}, clearControlStates () {},
    lookAt: async (p) => {
      const f = bot.entity.position, eye = { x: f.x, y: f.y + 1.62, z: f.z }
      const h = Math.hypot(p.x - eye.x, p.z - eye.z)
      state.lookPitch = Math.atan2(eye.y - p.y, h) * 180 / Math.PI; state.lookDir = { x: (p.x - eye.x) / h, z: (p.z - eye.z) / h }
      await state.onLook?.()
    },
    equip: async (item, dest) => {
      assert.equal(dest, 'hand')
      if (!item || slots[item.slot] !== item) throw new Error('not in inventory')
      if (item.slot >= 36) { bot.quickBarSlot = item.slot - 36; return }
      let d = [36, 37, 38, 39, 40, 41, 42, 43, 44].find(i => !slots[i]); if (d == null) { d = 36 + lru; lru = (lru + 1) % 9 }
      bot.quickBarSlot = d - 36
      const other = slots[d], from = item.slot
      slots[d] = item; item.slot = d; slots[from] = other; if (other) other.slot = from
    },
    unequip: async () => { state.events.push('unequip') }, toss: async () => { throw new Error('toss used') }, tossStack: async () => { throw new Error('tossStack used') },
    blockAt,
    findBlock: (o) => { const r = bot.findBlocks({ ...o, count: 1 })[0]; return r ? blockAt(r) : null },
    findBlocks: ({ matching, maxDistance, point, count: n = 1 }) => {
      const from = point ?? bot.entity.position
      return [...world.keys()].map(k => new Vec3(...k.split(',').map(Number)))
        .filter(v => v.distanceTo(from) <= maxDistance && matching(blockAt(v)))
        .sort((a, b) => a.distanceTo(from) - b.distanceTo(from)).slice(0, n)
    },
    nearestEntity: f => Object.values(bot.entities).find(f) ?? null,
    pathfinder: {
      setGoal () {}, stop () {},
      goto: async goal => {
        state.goals.push(goal)
        const here = bot.entity.position.floored()
        if (goal?.item && typeof goal.isEnd === 'function') {
          const gi = goal.item, nodes = []
          for (let dx = -3; dx <= 3; dx++) for (let dz = -3; dz <= 3; dz++) for (let dy = -1; dy <= 1; dy++) {
            const n = new Vec3(Math.floor(gi.x) + dx, Math.floor(gi.y) + dy, Math.floor(gi.z) + dz)
            if (cell(n).name !== 'air' || cell(n.offset(0, 1, 0)).name !== 'air' || cell(n.offset(0, -1, 0)).name === 'air') continue
            if (goal.isEnd(n)) nodes.push(n)
          }
          nodes.sort((a, b) => a.distanceTo(here) - b.distanceTo(here))
          if (nodes[0]) bot.entity.position = new Vec3(nodes[0].x + 0.5, nodes[0].y, nodes[0].z + 0.5)
        } else if (!goal.isEnd?.(here)) {
          const off = (goal.rangeSq ?? 0) >= 4 ? 2 : 0
          bot.entity.position = new Vec3(Math.floor(goal.x) + off + 0.5, goal.y ?? bot.entity.position.y, Math.floor(goal.z) + 0.5)
        }
        state.events.push(`goto:${Math.floor(bot.entity.position.x)},${Math.floor(bot.entity.position.y)},${Math.floor(bot.entity.position.z)}`)
        await state.onGoto?.(goal)
      },
    },
    waitForTicks: async n => {
      if (state.tickThrows) throw new Error('tick wait exploded')
      for (let i = 0; i < (n ?? 1); i++) {
        state.tick++
        for (const l of [...state.lagged]) if (state.tick >= l.at) { l.fn(); state.lagged.splice(state.lagged.indexOf(l), 1) }
        for (const d of [...state.pending]) {
          if (state.tick >= d.spawnTick + 20) d.entity.position = d.rest.clone()
          if (state.tick < d.at || !bot.entities[d.entity.id]) continue
          const feet = bot.entity.position
          if (inPickupBox(feet, d.rest, 0, 0) && room(d.name)) {
            add(d.name, d.count); delete bot.entities[d.entity.id]; state.pending.splice(state.pending.indexOf(d), 1)
            state.events.push(`collect:${d.name}`); bot.emit('playerCollect', bot.entity, d.entity)
          }
        }
      }
      await new Promise(r => setImmediate(r))
    },
    activateBlock: async b => {
      state.activations.push({ at: key(b.position), t: state.tick })
      assert.ok(bot.entity.position.distanceTo(b.position.offset(0.5, 0.5, 0.5)) <= 4.5, 'used from out of reach')
      const c = world.get(key(b.position)); assert.ok(c?.props && /_trapdoor$/.test(c.name), `activated ${c?.name}`)
      if (c.props.open && state.refuseClose) return
      const flip = () => { c.props.open = !c.props.open; state.events.push(c.props.open ? 'open' : 'close'); if (!c.props.open) state.onClosed?.() }
      if (state.activateLagTicks) { const lag = state.activateLagTicks; state.activateLagTicks = 0; state.lagged.push({ at: state.tick + lag, fn: flip }); await state.onActivate?.(); return }
      flip()
    },
    clickWindow: async (slot, button, mode) => {
      state.clicks.push({ slot, button, mode, name: slots[slot]?.name, count: slots[slot]?.count, open: wellAt ? !!world.get(key(wellAt))?.props?.open : null, at: bot.entity.position.floored() })
      assert.equal(mode, 4, 'a throw is a THROW click'); assert.equal(button, 1, 'the whole stack')
      const it = slots[slot]; if (!it) return
      slots[slot] = null
      const f = bot.entity.position
      const spawn = new Vec3(f.x, f.y + 1.32, f.z)
      let rest
      const c = W.tossCrossing({ ux: state.lookDir.x, uz: state.lookDir.z, pitchDeg: state.lookPitch })
      const X = f.x + c.x, Z = f.z + c.z
      if (state.missNext > 0) { state.missNext--; const cap = capCell() ?? f.floored(); rest = new Vec3(cap.x + 0.5, G0 + 1, cap.z + 1.3) } else rest = landAt(X, Z)
      const id = state.nextId++
      const served = state.serverSubstitute ?? it.name; state.serverSubstitute = null   // the item AS THE SERVER drops it
      const entity = { id, name: 'item', position: spawn, getDroppedItem: () => ({ name: served, count: it.count }) }
      bot.entities[id] = entity
      state.pending.push({ entity, rest, at: state.tick + 40, spawnTick: state.tick, name: it.name, count: it.count })
      bot.emit('entitySpawn', entity)
      await state.onClick?.(slot)
    },
    dig: async (b) => {
      state.digs.push(key(b.position)); world.set(key(b.position), { name: 'air' })
      for (const d of state.pending) {   // what rested on the dug block falls with it
        if (Math.floor(d.rest.x) === b.position.x && Math.floor(d.rest.z) === b.position.z && Math.abs(d.rest.y - (b.position.y + 1)) < 0.01) {
          d.rest = new Vec3(d.rest.x, b.position.y, d.rest.z); d.entity.position = d.rest.clone()
        }
      }
      const drop = b.name === 'grass_block' ? 'dirt' : b.name
      let y = b.position.y; while (cell(new Vec3(b.position.x, y - 1, b.position.z)).name === 'air') y--
      const id = state.nextId++, rest = new Vec3(b.position.x + 0.5, y, b.position.z + 0.5)
      const entity = { id, name: 'item', position: rest.clone(), getDroppedItem: () => ({ name: drop }) }
      bot.entities[id] = entity; state.pending.push({ entity, rest, at: state.tick + 10, spawnTick: state.tick, name: drop, count: 1 })
    },
    _placeBlockWithOptions: async (ref, face, opts = {}) => {
      const at = ref.position.plus(face); const h = bot.heldItem
      assert.ok(h && /_trapdoor$/.test(h.name), `placing ${h?.name} with _placeBlockWithOptions`)
      assert.equal(cell(at).name, 'air', 'placing into a full cell')
      const half = opts.half === 'top' ? 'top' : face.y === 1 ? 'bottom' : face.y === -1 ? 'top' : 'bottom'
      const facing = face.x === 1 ? 'east' : face.x === -1 ? 'west' : face.z === 1 ? 'south' : face.z === -1 ? 'north' : 'north'
      h.count--; if (!h.count) slots[h.slot] = null
      world.set(key(at), { name: h.name, props: { half, open: false, facing, powered: false, waterlogged: false } })
      state.places.push(`${key(at)}:${half}:${facing}`)
    },
    placeBlock: async (ref, face) => {
      const at = ref.position.plus(face); const h = bot.heldItem
      assert.ok(h, 'placing with an empty hand')
      world.set(key(at), { name: h.name }); state.events.push(`place:${h.name}`)
      // THE SERVER'S SLOT UPDATE MAY TRAIL THE BLOCK UPDATE (sandbox 10-05): with placeLagTicks the item leaves the bag later
      const takeIt = () => { h.count--; if (!h.count && slots[h.slot] === h) slots[h.slot] = null }
      if (state.placeLagTicks) state.lagged.push({ at: state.tick + state.placeLagTicks, fn: takeIt }); else takeIt()
    },
    recipesFor: (id, meta, min = 1, table) => Recipe.find(id, meta).filter(r => (!r.requiresTable || table) &&
      r.delta.every(d => bot.inventory.count(d.id) + d.count * Math.ceil(min / r.result.count) >= 0)),
    recipesAll: (id, meta, table) => Recipe.find(id, meta).filter(r => !r.requiresTable || table),
    craft: async (recipe, n = 1, table) => {
      if (recipe.requiresTable) { assert.ok(table, 'a table recipe crafted without a table'); assert.equal(cell(table.position).name, 'crafting_table') }
      for (let i = 0; i < n; i++) {
        for (const d of recipe.delta) if (d.count < 0) take(REG.items[d.id].name, -d.count)
        add(REG.items[recipe.result.id].name, recipe.result.count)
        state.events.push(`craft:${REG.items[recipe.result.id].name}`)
      }
    },
  }
  // THE SERVER: answers craftsync's window-0 resync (close_window 0 + window_click -999/-1) unless serverSilent; onResync
  // may rewrite the local bag first, as a window_items carrying the SERVER's truth would.
  const ls = {}
  bot._client = {
    on: (k, f) => { (ls[k] ??= []).push(f) }, removeListener: (k, f) => { ls[k] = (ls[k] ?? []).filter(g => g !== f) },
    write: (name, p) => {
      state.writes.push({ name, p, tick: state.tick })
      if (name === 'window_click' && p.slot === -999 && p.stateId === -1 && !state.serverSilent) {
        queueMicrotask(() => { state.onResync?.(); for (const f of ls.window_items ?? []) f({ windowId: 0 }) })
      }
    },
  }
  for (const [name, pos] of Object.entries(players)) bot.players[name] = { username: name, entity: { position: new Vec3(pos.x, pos.y, pos.z) } }
  bot.players[bot.username] = { username: bot.username, entity: bot.entity }
  if (wellAt) {
    world.set(key(wellAt), { name: 'oak_trapdoor', props: { half: 'top', open: wellOpen, facing: wellFacing, powered: false, waterlogged: false } })
    world.set(key({ x: wellAt.x, y: wellAt.y - 1, z: wellAt.z }), { name: 'oak_trapdoor', props: { half: 'bottom', open: false, facing: 'north', powered: false, waterlogged: false } })
  }
  return { bot, state, world, count, slots, key, cell, setWell: c => { wellAt = c } }
}
const S = (name, count) => ({ name, count })
const filler = n => Array.from({ length: n }, () => S('cobblestone', 64))
const rows = async kind => {
  await new Promise(r => setTimeout(r, 150))
  try { return readFileSync(`${LOG_DIR}/skill-TestBot.jsonl`, 'utf8').trim().split('\n').map(l => JSON.parse(l)).filter(r => r.skill?.name === kind) } catch { return [] }
}
const field = (detail, k) => { const m = new RegExp(`(?:^| )${k}=(\\S+)`).exec(detail ?? ''); return m ? m[1] : null }
const run = (name, bot, signal = { aborted: false }) => within(SKILLS[name].run({ bot }, {}, signal), 15000, name)
const homeRead = town => (x, y, z) => { const b = town.bot.blockAt(new Vec3(x, y, z)); let props = null; try { props = b.getProperties?.() ?? null } catch {} return { name: b.name, boundingBox: b.boundingBox, shapes: b.shapes, hardness: b.hardness, props } }
const CAP = W.canonicalWellSite({ home: HOME, read: flatRead({}, G0) }).site
const goalInColumn = (state, cap) => state.goals.filter(g => Number.isFinite(g?.x) && !g.item && Math.floor(g.x) === cap.x && Math.floor(g.z) === cap.z)

await t('the three orders are registered, chatOnly, housekeeping, with contracts; well_effect counts listed losses only', () => {
  for (const n of ['dispose_well', 'build_well', 'close_well']) {
    assert.ok(SKILLS[n]?.run, n); assert.equal(SKILLS[n].chatOnly, true, n); assert.ok(SKILL_CONTRACTS[n], n); assert.equal(isHousekeeping(n), true, n)
  }
  assert.deepEqual(SKILL_CONTRACTS.dispose_well.expects, ['well_effect', 'world_change'])
  assert.equal(classifyOutcome('dispose_well', 'success', { inventory: { egg: -16, flint: -3 } }).value, 'valuable')
  assert.equal(classifyOutcome('dispose_well', 'success', { inventory: { cobblestone: -64 } }).value, 'neutral', 'a non-listed loss is not the well\'s evidence')
})

await t('DISPOSE end to end: only listed stacks thrown (THROW clicks, whole stacks), all land in the shaft, cap open only while throwing and closed after; the row reads the counts', async () => {
  const town = fakeTown({ wellAt: CAP, items: [S('egg', 16), S('flint', 64), S('cobblestone', 64), S('oak_sapling', 30), S('ink_sac', 10), S('clay_ball', 20), ...filler(28)], botAt: new Vec3(HOME.x + 0.5, HOME.y, HOME.z + 0.5) })
  const before = town.bot.inventory.items().length
  const r = await run('dispose_well', town.bot)
  assert.equal(r.status, 'success', r.detail)
  assert.deepEqual(town.state.clicks.map(c => c.name).sort(), ['clay_ball', 'egg', 'flint', 'ink_sac'])
  assert.ok(town.state.clicks.every(c => c.open === true), 'a throw with the cap closed')
  assert.equal(town.count('egg') + town.count('flint') + town.count('ink_sac') + town.count('clay_ball'), 0)
  assert.equal(town.count('cobblestone'), 64 * 29); assert.equal(town.count('oak_sapling'), 30)
  assert.equal(town.world.get(town.key(CAP)).props.open, false, 'left open')
  assert.deepEqual(town.state.events.filter(e => e === 'open' || e === 'close'), ['open', 'close'])
  assert.equal(town.bot.inventory.items().length, before - 4)
  assert.deepEqual(goalInColumn(town.state, CAP), [], 'a goal named the well cell')
  const inShaft = town.state.pending.filter(d => W.itemInWell([CAP], d.rest)).length
  assert.equal(inShaft, 4, 'all four throws rest in the shaft')
  const row = (await rows('_well_dispose')).pop()
  assert.equal(row.skill.status, 'success')
  assert.equal(field(row.skill.detail, 'tossed'), '4'); assert.equal(field(row.skill.detail, 'n'), String(16 + 64 + 10 + 20))
  assert.equal(field(row.skill.detail, 'misses'), '0'); assert.equal(field(row.skill.detail, 'nonlisted'), '0'); assert.equal(field(row.skill.detail, 'freed'), '4')
  assert.equal((await rows('_well_left_open')).length, 0)
})

await t('SERVER COUNTS: craftsync\'s resync (close_window 0 then the -999/stateId -1 click, written back to back) before and after; the row says server=resync; a craft in flight refuses', async () => {
  const town = fakeTown({ wellAt: CAP, items: [S('egg', 16), S('flint', 64), ...filler(33)] })
  const writes = [], ls = {}
  town.bot._client = {
    on: (k, f) => { (ls[k] ??= []).push(f) }, removeListener: (k, f) => { ls[k] = (ls[k] ?? []).filter(g => g !== f) },
    write: (name, p) => {
      writes.push({ name, p, sync: writes.length && writes[writes.length - 1].tick === town.state.tick, tick: town.state.tick })
      if (name === 'window_click' && p.slot === -999 && p.stateId === -1) queueMicrotask(() => { for (const f of ls.window_items ?? []) f({ windowId: 0 }) })
    },
  }
  const r = await run('dispose_well', town.bot)
  assert.equal(r.status, 'success', r.detail)
  const pairs = writes.filter(w => w.name === 'window_click')
  assert.equal(pairs.length, 2, 'one resync before, one after')
  for (const w of pairs) {
    const prev = writes[writes.indexOf(w) - 1]
    assert.equal(prev.name, 'close_window'); assert.equal(prev.p.windowId, 0); assert.equal(w.tick, prev.tick, 'the close and the resync were not written in the same tick')
    assert.equal(w.p.windowId, 0); assert.equal(w.p.cursorItem.itemCount, 0)
  }
  assert.equal(field((await rows('_well_dispose')).pop().skill.detail, 'server'), 'resync')
  const busy = fakeTown({ wellAt: CAP, items: [S('egg', 16), ...filler(34)] })
  busy.bot.craftSync = { busy: () => true }
  assert.equal((await run('dispose_well', busy.bot)).status, 'no_effect'); assert.equal(busy.state.clicks.length, 0)
})

await t('DISPOSE: a miss is tracked by entity and retaken with the cap already closed (row misses=1 retaken=1); the stand is never the column', async () => {
  const town = fakeTown({ wellAt: CAP, items: [S('egg', 16), S('flint', 64), ...filler(33)] })
  town.state.missNext = 1
  const r = await run('dispose_well', town.bot)
  assert.equal(r.status, 'success', r.detail)
  const row = (await rows('_well_dispose')).pop()
  assert.equal(field(row.skill.detail, 'misses'), '1'); assert.equal(field(row.skill.detail, 'retaken'), '1'); assert.equal(field(row.skill.detail, 'recollected'), '0')
  const ev = town.state.events, close = ev.indexOf('close'), back = ev.findIndex(e => e.startsWith('collect:'))
  assert.ok(close >= 0 && back > close, `retaken before the cap closed: ${ev.join(' ')}`)
  assert.deepEqual(goalInColumn(town.state, CAP), [])
  assert.ok(town.state.goals.filter(g => g?.item).every(g => !g.isEnd({ x: CAP.x, y: CAP.y + 1, z: CAP.z })), 'the retake goal accepts the well cell')
})

await t('DISPOSE: each slot is re-read synchronously before its click -- a slot that changed DURING THE AIM (a server update the hold cannot stop) is skipped, never thrown', async () => {
  const town = fakeTown({ wellAt: CAP, items: [S('egg', 16), S('flint', 64), S('rail', 3), ...filler(32)] })
  const railSlot = town.slots.findIndex(s => s?.name === 'rail')
  town.state.onLook = () => { if (town.state.clicks.length === 2 && town.slots[railSlot]?.name === 'rail') { town.slots[railSlot] = { name: 'iron_ingot', type: REG.itemsByName.iron_ingot.id, count: 5, slot: railSlot } } }
  const r = await run('dispose_well', town.bot)
  assert.equal(r.status, 'success', r.detail)
  assert.ok(!town.state.clicks.some(c => c.name === 'iron_ingot'), 'a non-listed stack was thrown')
  assert.equal(town.count('iron_ingot'), 5)
})

// ---- SWORDS (OWNER 10-07 "no reason to store swords at all, this is a peaceful world"): peaceful-only, judged at the click
await t('SWORDS, the switch table (Claude P2): only a world read as peaceful with foodskip on for it', () => {
  for (const mode of ['auto', 'on', 'off']) {
    for (const d of ['peaceful', 'easy', 'normal', 'hard', null, undefined]) {
      assert.equal(W.swordSwitch(mode, d), d === 'peaceful' && mode !== 'off', `${mode} x ${d}`)
    }
  }
})
await t('SWORDS, pure: every tier goes only with the peaceful switch; never on WELL_JUNK; the guards stay absolute', () => {
  const bag = [{ name: 'stone_sword', count: 1, slot: 9 }, { name: 'wooden_sword', count: 1, slot: 10 }, { name: 'iron_sword', count: 1, slot: 11 }, { name: 'egg', count: 16, slot: 12 }]
  assert.deepEqual(W.disposePlan(bag).stacks.map(s => s.name), ['egg'], 'not peaceful: swords are weapons')
  assert.deepEqual(W.disposePlan(bag, { swords: true }).stacks.map(s => s.name), ['stone_sword', 'wooden_sword', 'iron_sword', 'egg'])
  assert.equal(W.disposePlan(bag, { swords: true }).junkStacks, 4, 'the trigger counts them in a peaceful world')
  for (const n of ['stone_sword', 'wooden_sword', 'iron_sword', 'diamond_sword']) assert.equal(W.isWellJunk(n), false, `${n} is never on the list itself`)
  assert.equal(W.swordGoes('stone_pickaxe', true), false); assert.equal(W.swordGoes('stone_sword', false), false)
  assert.equal(W.thrownNames([{ name: 'stone_sword', count: 1 }]).offlist, 1, 'a sword thrown without the switch is OFF the list (C3)')
  assert.equal(W.thrownNames([{ name: 'stone_sword', count: 1 }], { swords: 1 }).offlist, 0)
  assert.equal(W.thrownNames([{ name: 'stone_sword', count: 1 }, { name: 'iron_sword', count: 1 }], { swords: 1 }).offlist, 1, 'one more sword entity than clicked is off the list')
  assert.match(W.wellDisposeDetail({ slotsBefore: 36, slotsAfter: 34, swords: 2, peaceful: true, gclicked: 0 }).slice(0, 60), / swords=2 peaceful=1 /)
})
const peacefulTown = (items, difficulty) => { const town = fakeTown({ wellAt: CAP, items }); town.bot.serverDifficulty = difficulty; return town }
await t('SWORDS, the skill: peaceful -> the swords go down the well with the junk, the row says swords=2 peaceful=1', async () => {
  const town = peacefulTown([S('stone_sword', 1), S('wooden_sword', 1), S('egg', 16), ...filler(33)], 'peaceful')
  const r = await run('dispose_well', town.bot)
  assert.equal(r.status, 'success', r.detail)
  assert.equal(town.count('stone_sword') + town.count('wooden_sword'), 0)
  const row = (await rows('_well_dispose')).pop()
  assert.equal(field(row.skill.detail, 'swords'), '2', row.skill.detail); assert.equal(field(row.skill.detail, 'peaceful'), '1'); assert.equal(field(row.skill.detail, 'offlist'), '0')
})
await t('SWORDS, the skill: easy (or unknown) -> no sword is thrown; positive control: the egg still goes', async () => {
  for (const d of ['easy', undefined]) {
    const town = peacefulTown([S('stone_sword', 1), S('egg', 16), ...filler(34)], d)
    const r = await run('dispose_well', town.bot)
    assert.equal(r.status, 'success', `${d}: ${r.detail}`)
    assert.equal(town.count('stone_sword'), 1, `${d}: the sword stays`); assert.equal(town.count('egg'), 0, 'positive control')
    assert.equal(field((await rows('_well_dispose')).pop().skill.detail, 'swords'), '0')
  }
})
await t('SWORDS, one thrown then the world turns easy: the second is kept, the row still says peaceful=1 sword_kept=1 (no false C8)', async () => {
  const town = peacefulTown([S('stone_sword', 1), S('wooden_sword', 1), S('egg', 16), ...filler(33)], 'peaceful')
  town.state.onLook = () => { if (town.state.clicks.some(c => /_sword$/.test(c.name ?? ''))) town.bot.serverDifficulty = 'easy' }
  const r = await run('dispose_well', town.bot)
  assert.equal(r.status, 'success', r.detail)
  assert.equal(town.count('stone_sword') + town.count('wooden_sword'), 1, 'one thrown, one kept')
  const row = (await rows('_well_dispose')).pop()
  assert.equal(field(row.skill.detail, 'swords'), '1', row.skill.detail); assert.equal(field(row.skill.detail, 'peaceful'), '1')
  assert.equal(field(row.skill.detail, 'sword_kept'), '1'); assert.equal(field(row.skill.detail, 'sword_lost'), '1'); assert.equal(field(row.skill.detail, 'offlist'), '0')
})
await t('SWORDS, never in the pit-first build (Claude P3): a peaceful bag building pit-first throws junk, keeps its sword', async () => {
  const town = fakeTown({ hand: S('cobblestone', 64), items: [S('stone_sword', 1), S('oak_log', 3), S('egg', 16), S('egg', 16), S('flint', 64), ...filler(30)] })
  town.bot.serverDifficulty = 'peaceful'
  const r = await run('build_well', town.bot)
  assert.equal(r.status, 'success', r.detail)
  assert.equal(town.count('stone_sword'), 1, 'the pit took no sword')
  assert.ok((await rows('_well_dispose')).some(x => /stop=pit_first/.test(x.skill.detail)), 'positive control: a pit phase ran')
})
await t('SWORDS, a sword-only visit is contract evidence (Codex P2): classifyOutcome sees the loss', () => {
  const v = classifyOutcome('dispose_well', 'success', { inventory: { stone_sword: -1 } })
  assert.ok(JSON.stringify(v).includes('stone_sword'), JSON.stringify(v))
})
await t('SWORDS, AT THE CLICK: the world turns easy during the aim -> the planned sword is not thrown', async () => {
  const town = peacefulTown([S('egg', 16), S('stone_sword', 1), ...filler(34)], 'peaceful')
  town.state.onLook = () => { if (town.state.clicks.length >= 1) town.bot.serverDifficulty = 'easy' }
  const r = await run('dispose_well', town.bot)
  assert.equal(r.status, 'success', r.detail)
  assert.equal(town.count('stone_sword'), 1, 'the switch re-read at the click kept it'); assert.equal(town.count('egg'), 0)
})

await t('DISPOSE (Codex r1 P1): the reserve is re-judged AT THE CLICK -- cobble spent during the aim keeps the diorite in the bag; the row says what was clicked', async () => {
  const town = fakeTown({ wellAt: CAP, items: [S('diorite', 10), S('cobblestone', 64), S('egg', 16), ...Array.from({ length: 32 }, () => S('oak_log', 64))] })
  const cob = town.slots.findIndex(x => x?.name === 'cobblestone')
  town.state.onLook = () => { if (town.slots[cob]?.name === 'cobblestone' && town.slots[cob].count === 64) town.slots[cob] = { ...town.slots[cob], count: 63 } }
  const r = await run('dispose_well', town.bot)
  assert.equal(r.status, 'success', r.detail)
  assert.ok(town.state.clicks.some(c => c.name === 'egg'), 'positive control: the visit threw')
  assert.ok(!town.state.clicks.some(c => c.name === 'diorite'), 'the diorite went with only 63 cobble left')
  assert.equal(town.count('diorite'), 10)
  const row = (await rows('_well_dispose')).pop()
  assert.equal(field(row.skill.detail, 'gclicked'), '0', row.skill.detail)
  // and the same bag with the reserve intact throws it, saying so
  const ok = fakeTown({ wellAt: CAP, items: [S('diorite', 10), S('cobblestone', 64), S('egg', 16), ...Array.from({ length: 32 }, () => S('oak_log', 64))] })
  await run('dispose_well', ok.bot)
  assert.ok(ok.state.clicks.some(c => c.name === 'diorite'))
  const row2 = (await rows('_well_dispose')).pop()
  assert.equal(field(row2.skill.detail, 'gclicked'), '10', row2.skill.detail); assert.equal(field(row2.skill.detail, 'stone'), '64')
})

await t('ADMISSION in the skill: another player within 5 -> no click, no activation, a _well_refused row with a wait remedy', async () => {
  const town = fakeTown({ wellAt: CAP, items: [S('egg', 16), ...filler(34)], players: { 'b-Bravo': { x: CAP.x + 2.5, y: CAP.y + 1, z: CAP.z + 0.5 } } })
  const r = await run('dispose_well', town.bot)
  assert.equal(r.status, 'no_effect'); assert.match(r.detail, /^wait for b-Bravo/)
  assert.equal(town.state.clicks.length, 0); assert.equal(town.state.activations.length, 0)
  const row = (await rows('_well_refused')).pop(); assert.match(row.skill.detail, /order=dispose reason=player_near/)
})

await t('THE REFUSAL CHAIN (dispose): player near -> free skip -> the next order after the cooldown, player gone -> disposed', async () => {
  const town = fakeTown({ wellAt: CAP, items: [S('egg', 16), S('flint', 64), ...filler(33)], players: { 'b-Bravo': { x: CAP.x + 1.5, y: CAP.y + 1, z: CAP.z + 0.5 } } })
  const inputs = now => {
    const p = W.disposePlan(town.bot.inventory.items())
    return { now, slots: p.slots, freeSlots: 36 - p.slots, junkStacks: p.junkStacks, distHome: 3,
             well: () => ({ open: false, attended: false }), buildPlan: () => null }
  }
  let st = {}
  let o = W.wellOrder({ ...inputs(NOW), state: st }); st = o.state
  assert.equal(o.order?.skill, 'dispose_well')
  const r1 = await run('dispose_well', town.bot)
  assert.equal(r1.status, 'no_effect')
  st = W.wellOrderOutcome('dispose_well', r1.status, NOW, st)
  assert.equal(W.wellOrder({ ...inputs(NOW + 60_000), state: st }).order, null, 'the cooldown holds the next order')
  delete town.bot.players['b-Bravo']
  o = W.wellOrder({ ...inputs(NOW + W.DISPOSE_COOLDOWN_MS + 1), state: st })
  assert.equal(o.order?.skill, 'dispose_well', 'the remedy (wait) leads back to the order: nothing backed off')
  const r2 = await run('dispose_well', town.bot)
  assert.equal(r2.status, 'success', r2.detail)
  assert.equal(town.count('egg') + town.count('flint'), 0)
})

await t('ABORT mid-throw: the cap is closed in the finally (not abortable), the row says aborted, the abort propagates', async () => {
  const town = fakeTown({ wellAt: CAP, items: [S('egg', 16), S('flint', 64), S('rail', 5), ...filler(32)] })
  const signal = { aborted: false }
  town.state.onClick = async () => { signal.aborted = true }
  await assert.rejects(run('dispose_well', town.bot, signal), e => e?.aborted === true)
  assert.equal(town.world.get(town.key(CAP)).props.open, false, 'left open after an abort')
  assert.equal(town.state.clicks.length, 1, 'kept throwing after the abort')
  const row = (await rows('_well_dispose')).pop(); assert.equal(row.skill.status, 'aborted')
  assert.equal((await rows('_well_left_open')).length, 0)
})

await t('AN ERROR mid-visit (a throw click that rejects) still closes the cap, writes a failed row, and returns failed -- never throws past the visit', async () => {
  const town = fakeTown({ wellAt: CAP, items: [S('egg', 16), S('flint', 64), ...filler(33)] })
  town.state.onClick = async () => { throw new Error('click exploded') }
  const r = await run('dispose_well', town.bot)
  assert.equal(r.status, 'failed'); assert.equal(r.failClass, 'well_toss_failed'); assert.match(r.detail, /click exploded/)
  assert.equal(town.world.get(town.key(CAP)).props.open, false)
  const row = (await rows('_well_dispose')).pop(); assert.equal(row.skill.status, 'failed'); assert.match(row.skill.detail, /stop=error:/)
})

await t('LEFT OPEN is a row (positive control for the read\'s gate): a cap that will not close is reported', async () => {
  const town = fakeTown({ wellAt: CAP, items: [S('egg', 16), ...filler(34)] })
  town.state.refuseClose = true
  await run('dispose_well', town.bot)
  const lo = await rows('_well_left_open')
  assert.ok(lo.length >= 1, 'no _well_left_open row'); assert.match(lo.pop().skill.detail, new RegExp(`at=${CAP.x},${CAP.y},${CAP.z}`))
})

await t('THE VISITOR closes an open well first (closed_open=1), and close_well closes one nobody is at', async () => {
  const town = fakeTown({ wellAt: CAP, wellOpen: true, items: [S('egg', 16), ...filler(34)] })
  const r = await run('dispose_well', town.bot)
  assert.equal(r.status, 'success'); assert.equal(town.state.events.filter(e => e === 'open' || e === 'close')[0], 'close', `first act at the well: ${town.state.events.join(' ')}`)
  assert.equal(field((await rows('_well_dispose')).pop().skill.detail, 'closed_open'), '1')
  const t2 = fakeTown({ wellAt: CAP, wellOpen: true, items: [S('dirt', 3)] })
  const r2 = await run('close_well', t2.bot)
  assert.equal(r2.status, 'success'); assert.equal(r2.placed, 1); assert.equal(t2.world.get(t2.key(CAP)).props.open, false)
  const t3 = fakeTown({ wellAt: CAP, wellOpen: true, items: [S('dirt', 3)], players: { 'b-C': { x: CAP.x + 0.5, y: CAP.y + 1, z: CAP.z - 1.5 } } })
  assert.equal((await run('close_well', t3.bot)).status, 'no_effect', 'someone is using it')
  assert.equal(t3.world.get(t3.key(CAP)).props.open, true)
})

await t('throwResults: a throw this body collected from the rim is a retaken miss; one collected from IN the shaft is a recollection', () => {
  const cap = { x: 10, y: 63, z: 10 }
  const e = (id, x, y, z) => ({ id, position: { x, y, z } })
  const r = throwResults({ cap, spawned: [e(1, 10.5, 62.2, 10.5), e(2, 10.5, 64, 11.3), e(3, 10.5, 62.2, 10.4), e(4, 10.5, 64, 9.2)], got: new Set([2, 3]), present: id => id === 4 })
  assert.equal(r.misses, 2, 'ids 2 (retaken from the rim) and 4 (still out)')
  assert.equal(r.recollected, 1); assert.deepEqual(r.missed.map(m => m.id), [4])
})

await t('INSTRUMENTS: this bot collecting an item out of a well column is a _well_recollected row; its feet inside a well, _well_inside (once a minute)', async () => {
  const ev = {}
  const bot = { entity: { position: new Vec3(CAP.x + 0.5, CAP.y + 1, CAP.z - 0.5) }, on: (k, f) => { ev[k] = f }, removeListener () {} }
  const w = installWellWatch(bot, () => [CAP])
  ev.playerCollect({}, { position: new Vec3(CAP.x + 0.5, CAP.y - 0.8, CAP.z + 0.5) })
  ev.playerCollect(bot.entity, { position: new Vec3(CAP.x + 0.5, CAP.y + 1, CAP.z + 1.4), getDroppedItem: () => ({ name: 'egg' }) })
  assert.equal((await rows('_well_recollected')).length, 0, 'another player\'s collection, or one from the rim, is not ours to report')
  ev.playerCollect(bot.entity, { position: new Vec3(CAP.x + 0.5, CAP.y - 0.8, CAP.z + 0.5), getDroppedItem: () => ({ name: 'egg' }) })
  assert.equal((await rows('_well_recollected')).length, 1)
  assert.equal(w.checkInside(1000), false, 'on the rim')
  bot.entity.position = new Vec3(CAP.x + 0.5, CAP.y - 0.8, CAP.z + 0.5)
  assert.equal(w.checkInside(70_000), true); assert.equal(w.checkInside(80_000), false, 'rate limited')
  assert.equal((await rows('_well_inside')).length, 1)
})

// ---- building it ------------------------------------------------------------------------------------------------------
const wellOk = (town, cap) => W.wellIdentity(homeRead(town), cap)
await t('BUILD from two carried trapdoors: dug from the stand, a bottom trapdoor on the floor, a closed top cap facing the stand; never a goal on the cell', async () => {
  const town = fakeTown({ items: [S('oak_trapdoor', 2), S('dirt', 10)] })
  const r = await run('build_well', town.bot)
  assert.equal(r.status, 'success', r.detail); assert.equal(r.placed, 2)
  const id = wellOk(town, CAP)
  assert.deepEqual(id, { ok: true, open: false, facing: W.wellStand(flatRead({}, G0), CAP).facing, floor: true })
  assert.equal(town.state.places.length, 2)
  assert.ok(town.state.places[0].startsWith(`${CAP.x},${CAP.y - 1},${CAP.z}:bottom:`), 'the floor trapdoor first, bottom half')
  assert.equal(town.state.places[1], `${CAP.x},${CAP.y},${CAP.z}:top:${id.facing}`)
  assert.deepEqual(town.state.digs, [`${CAP.x},${CAP.y},${CAP.z}`, `${CAP.x},${CAP.y - 1},${CAP.z}`])
  assert.deepEqual(goalInColumn(town.state, CAP), [])
  const stand = W.standForFacing(CAP, id.facing), f = town.bot.entity.position.floored()
  assert.deepEqual({ x: f.x, y: f.y, z: f.z }, stand, 'built from somewhere other than the stand')
  assert.equal(town.count('dirt'), 10, 'the dug blocks were picked up (they must fall into the shaft, out of the box)')
  assert.equal((await rows('_well_built')).length >= 1, true)
  assert.equal((await run('build_well', town.bot)).status, 'no_effect', 'a second build')
})

await t('BUILD from logs: planks, a crafting table put down off the well, two trapdoors crafted at it, then the well', async () => {
  const town = fakeTown({ items: [S('oak_log', 3), S('dirt', 5)] })
  const r = await run('build_well', town.bot)
  assert.equal(r.status, 'success', r.detail)
  assert.ok(wellOk(town, CAP).ok)
  assert.ok(town.state.events.includes('craft:oak_trapdoor'))
  const table = [...town.world].find(([, v]) => v.name === 'crafting_table')
  assert.ok(table, 'no table placed'); const [tx, , tz] = table[0].split(',').map(Number)
  assert.ok(Math.max(Math.abs(tx - CAP.x), Math.abs(tz - CAP.z)) >= 2, 'the table went beside the well')
  assert.equal(town.state.dropped.length, 0, `dropped: ${town.state.dropped}`)
})

await t('THE REFUSAL CHAIN (build): a FULL bag of listed junk and logs digs the pit first, empties junk down it, crafts, and caps -- no dead end', async () => {
  const town = fakeTown({ hand: S('cobblestone', 64), items: [S('oak_log', 3), S('egg', 16), S('egg', 16), S('flint', 64), ...filler(31)] })
  assert.equal(town.bot.inventory.items().length, 36)
  const plan = W.wellBuildPlan({ oak_log: 3 }, { items: town.bot.inventory.items() })
  const o = W.wellOrder({ now: NOW, distHome: 3, slots: 36, freeSlots: 0, junkStacks: 3, well: null, buildPlan: plan })
  assert.equal(o.order?.skill, 'build_well', 'the order is issued to the full bot')
  const r = await run('build_well', town.bot)
  assert.equal(r.status, 'success', r.detail)
  assert.ok(wellOk(town, CAP).ok && wellOk(town, CAP).floor)
  assert.equal(town.state.dropped.length, 0, `a craft output was dropped: ${town.state.dropped}`)
  const thrown = town.state.clicks.map(c => c.name)
  assert.ok(thrown.length >= plan.slotsNeeded && thrown.every(n => W.isWellJunk(n)), `thrown: ${thrown}`)
  assert.ok(town.state.pending.filter(d => ['egg', 'flint'].includes(d.name)).every(d => W.itemInWell([CAP], d.rest)), 'a pit throw missed')
  const built = (await rows('_well_built')).pop(); assert.equal(field(built.skill.detail, 'pit_first'), '1')
  assert.ok((await rows('_well_dispose')).some(x => field(x.skill.detail, 'stop') === 'pit_first'))
})

const fullBagBuild = async (mod = null, lag = 0) => {
  const town = fakeTown({ hand: S('cobblestone', 64), items: [S('oak_log', 3), S('egg', 16), S('egg', 16), S('flint', 64), ...filler(31)] })
  town.state.placeLagTicks = lag
  const r = await within((mod ?? { SKILLS }).SKILLS.build_well.run({ bot: town.bot }, {}, { aborted: false }), 15000, 'build')
  return { town, r }
}
await t('PAPER\'S LAGGING SLOT UPDATE (sandbox 10-05): the table leaves the bag 4 ticks after its block appears; the full-bag build still finishes', async () => {
  const { town, r } = await fullBagBuild(null, 4)
  assert.equal(r.status, 'success', r.detail); assert.ok(wellOk(town, CAP).ok); assert.equal(town.state.dropped.length, 0)
})
await t('MUTANT (skills): without waiting for the bag, the lagging slot update refuses the trapdoor craft (the sandbox failure)', async () => {
  await withMutant(new URL('../src/skills.mjs', import.meta.url), "        for (let i = 0; i < 20 && countItem(bot, 'crafting_table') >= tablesHeld; i++) await tick()\n", '', async m => {
    const { r } = await fullBagBuild(m, 4)
    assert.notEqual(r.status, 'success', 'mutant inert')
  })
})

await t('BUILD REFUSAL with no junk to make room names an executable remedy first, and the order is never issued', async () => {
  const town = fakeTown({ items: [S('oak_log', 3), ...filler(33)] })
  const plan = W.wellBuildPlan({ oak_log: 3 }, { items: town.bot.inventory.items() })
  assert.equal(W.wellOrder({ now: NOW, distHome: 3, slots: 34, freeSlots: 2, junkStacks: 0, well: null, buildPlan: plan }).order?.skill ?? null,
    plan.slotsNeeded <= 2 ? 'build_well' : null)
  const full = fakeTown({ hand: S('cobblestone', 64), items: [S('oak_log', 3), S('dirt', 1), ...filler(33)] })
  assert.equal(full.bot.inventory.items().length, 36)
  const p2 = W.wellBuildPlan({ oak_log: 3 }, { items: full.bot.inventory.items() })
  assert.ok(p2.slotsNeeded > 0)
  assert.equal(W.wellOrder({ now: NOW, distHome: 3, slots: 36, freeSlots: 0, junkStacks: 0, well: null, buildPlan: p2 }).order, null)
  const r = await run('build_well', full.bot)
  assert.equal(r.status, 'no_effect'); assert.match(r.detail, /^[^.]+\. Not started: the junk well's craft chain needs/)
  assert.doesNotMatch(r.detail.split('. Not started')[0], /junk well|build/, 'the remedy is circular')
  assert.equal(full.state.digs.length, 0)
})

await t('BUILD RESUMES a pit left open by an interrupted visit (stage dug): floor trapdoor, cap, done', async () => {
  const blocks = { [`${CAP.x},${CAP.y},${CAP.z}`]: 'air', [`${CAP.x},${CAP.y - 1},${CAP.z}`]: 'air' }
  const dir = mkdtempSync(path.join(tmpdir(), 'well-store-'))
  const C = await import('../src/composter.mjs')
  assert.ok(C.createSiteGen(dir, `junkwell-site-${HOME.x}_${HOME.y}_${HOME.z}`, 1, CAP, null), 'the interrupted build recorded its site')
  const town = fakeTown({ items: [S('oak_trapdoor', 2)], blocks, storeDir: dir })
  const r = await run('build_well', town.bot)
  assert.equal(r.status, 'success', r.detail); assert.equal(town.state.digs.length, 0); assert.ok(wellOk(town, CAP).floor)
})

await t('BUILD never digs with someone at the site', async () => {
  const town = fakeTown({ items: [S('oak_trapdoor', 2)], players: { 'b-Bravo': { x: CAP.x + 0.5, y: CAP.y + 1, z: CAP.z + 2.5 } } })
  const r = await run('build_well', town.bot)
  assert.equal(r.status, 'no_effect'); assert.equal(town.state.digs.length, 0)
})

// ---- the Codex review's findings, one test each -------------------------------------------------------------------------
await t('CODEX #1 THE HOLD: a reflex equip fired during the aim waits until the throw phase ends; the bread it equips is never thrown', async () => {
  const town = fakeTown({ wellAt: CAP, items: [S('egg', 16), S('flint', 64), S('rail', 3), S('bread', 5), ...filler(31)] })
  let equipDoneAt = null, phaseEndClose = null
  town.state.onLook = () => {
    if (town.state.clicks.length === 1 && equipDoneAt === null) {
      equipDoneAt = 'pending'
      const bread = town.slots.find(x => x?.name === 'bread')
      town.bot.equip(bread, 'hand').then(() => { equipDoneAt = town.state.events.length })
    }
  }
  const r = await run('dispose_well', town.bot)
  assert.equal(r.status, 'success', r.detail)
  phaseEndClose = town.state.events.lastIndexOf('close')
  assert.ok(Number.isInteger(equipDoneAt) && equipDoneAt > phaseEndClose, `the reflex equip ran inside the phase (done at event ${equipDoneAt}, close at ${phaseEndClose})`)
  assert.ok(!town.state.clicks.some(c => c.name === 'bread')); assert.equal(town.count('bread'), 5)
  assert.equal(town.bot.heldItem?.name, 'bread', 'the held equip was lost instead of delayed')
})
await t('MUTANT (skills): without the hold the reflex equip lands mid-phase', async () => {
  await withMutant(SP, '      release = holdInventory(bot)\n', '      release = () => {}\n', async m => {
    const town = fakeTown({ wellAt: CAP, items: [S('egg', 16), S('flint', 64), S('rail', 3), S('bread', 5), ...filler(31)] })
    let done = null
    town.state.onLook = () => { if (town.state.clicks.length === 1 && done === null) { done = 'pending'; town.bot.equip(town.slots.find(x => x?.name === 'bread'), 'hand').then(() => { done = town.state.events.length }) } }
    await within(m.SKILLS.dispose_well.run({ bot: town.bot }, {}, { aborted: false }), 15000, 'mutant')
    assert.ok(Number.isInteger(done) && done <= town.state.events.lastIndexOf('close'), `mutant inert: done=${done} close=${town.state.events.lastIndexOf('close')} events=${town.state.events.join(' ')}`)
  })
})

await t('CODEX #2 NO SERVER ANSWER, NO THROW: an unanswered resync refuses before opening (well_unverified); the plan is made from the SERVER\'s bag', async () => {
  const town = fakeTown({ wellAt: CAP, items: [S('egg', 16), ...filler(34)] })
  town.state.serverSilent = true
  const r = await run('dispose_well', town.bot)
  assert.equal(r.status, 'failed'); assert.equal(r.failClass, 'well_unverified')
  assert.equal(town.state.clicks.length, 0); assert.equal(town.state.activations.length, 0)
  // the server says the "egg" slot holds bread: the resync rewrites the local bag before the plan is made
  const t2 = fakeTown({ wellAt: CAP, items: [S('egg', 16), S('flint', 64), ...filler(33)] })
  const eggSlot = t2.slots.findIndex(x => x?.name === 'egg')
  let once = false
  t2.state.onResync = () => { if (!once) { once = true; t2.slots[eggSlot] = { name: 'bread', type: REG.itemsByName.bread.id, count: 16, slot: eggSlot } } }
  const r2 = await run('dispose_well', t2.bot)
  assert.equal(r2.status, 'success', r2.detail)
  assert.deepEqual(t2.state.clicks.map(c => c.name), ['flint'], 'a stale local slot was thrown')
})

await t('CODEX #3 AN OPEN STILL IN FLIGHT AT THE ABORT: the cleanup waits for its block update and closes the cap (no silent open well)', async () => {
  const town = fakeTown({ wellAt: CAP, items: [S('egg', 16), ...filler(34)] })
  const signal = { aborted: false }
  town.state.activateLagTicks = 6
  town.state.onActivate = async () => { signal.aborted = true }
  await assert.rejects(run('dispose_well', town.bot, signal), e => e?.aborted === true)
  for (let i = 0; i < 10; i++) await town.bot.waitForTicks(1)   // let any late update land
  assert.equal(town.world.get(town.key(CAP)).props.open, false, 'the late OPEN left the well open')
  assert.ok(town.state.events.includes('open'), 'positive control: the late open did land')
})
await t('MUTANT (skills): without waiting for a requested open, the late update leaves the well open', async () => {
  await withMutant(SP, '        for (let i = 0; pending.open && !open && i < WELL_OPEN_WAIT_TICKS; i++)', '        for (let i = 0; false && pending.open && !open && i < WELL_OPEN_WAIT_TICKS; i++)', async m => {
    const town = fakeTown({ wellAt: CAP, items: [S('egg', 16), ...filler(34)] })
    const signal = { aborted: false }
    town.state.activateLagTicks = 6; town.state.onActivate = async () => { signal.aborted = true }
    await assert.rejects(within(m.SKILLS.dispose_well.run({ bot: town.bot }, {}, signal), 15000, 'mutant'))
    for (let i = 0; i < 10; i++) await town.bot.waitForTicks(1)
    assert.equal(town.world.get(town.key(CAP)).props.open, true, 'mutant inert')
  })
})

await t('CODEX #4 PEERS FIRST: the builder digs only once the site record is WELL_RECORD_SETTLE_MS old (every bot\'s 20 s cache has read it)', async () => {
  const { WELL_RECORD_SETTLE_MS } = await import('../src/skills.mjs')
  const dir = mkdtempSync(path.join(tmpdir(), 'well-store-'))
  const C = await import('../src/composter.mjs')
  const key = `junkwell-site-${HOME.x}_${HOME.y}_${HOME.z}`
  assert.ok(C.createSiteGen(dir, key, 1, CAP, null))
  const file = path.join(dir, `${key}.g1.json`)
  const fresh = Date.now() + 800
  fsMod.utimesSync(file, fresh / 1000, fresh / 1000)                // a record written "just now" (+0.8 s)
  const town = fakeTown({ items: [S('oak_trapdoor', 2)], storeDir: dir })
  let firstDig = null
  const dig0 = town.bot.dig; town.bot.dig = async b => { firstDig ??= Date.now(); return dig0(b) }
  const r = await run('build_well', town.bot)
  assert.equal(r.status, 'success', r.detail)
  assert.ok(firstDig - fresh >= WELL_RECORD_SETTLE_MS - 5, `dug ${firstDig - fresh} ms after the record (settle ${WELL_RECORD_SETTLE_MS})`)
})

await t('CODEX #5 A FLOORED PIT finishes with the ONE trapdoor carried (no wood): the plan follows the recorded stage', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'well-store-'))
  const C = await import('../src/composter.mjs')
  assert.ok(C.createSiteGen(dir, `junkwell-site-${HOME.x}_${HOME.y}_${HOME.z}`, 1, CAP, null))
  const blocks = { [`${CAP.x},${CAP.y},${CAP.z}`]: 'air', [`${CAP.x},${CAP.y - 1},${CAP.z}`]: { name: 'oak_trapdoor', props: { half: 'bottom', open: false, facing: 'north', powered: false, waterlogged: false } } }
  const town = fakeTown({ items: [S('oak_trapdoor', 1), S('dirt', 3)], blocks, storeDir: dir })
  const { townWellBuildPlan } = await import('../src/skills.mjs')
  assert.equal(townWellBuildPlan(town.bot)?.carried, true, 'the planner wants two')
  const r = await run('build_well', town.bot)
  assert.equal(r.status, 'success', r.detail); assert.ok(wellOk(town, CAP).ok && wellOk(town, CAP).floor)
  assert.equal(town.count('oak_trapdoor'), 0)
})

await t('CODEX #6 A WELL WITH A WALL DUG OUT is never thrown into, and the scheduler treats it as no well (build a new one)', async () => {
  const town = fakeTown({ wellAt: CAP, items: [S('egg', 16), ...filler(34)], blocks: { [`${CAP.x + 1},${CAP.y - 1},${CAP.z}`]: 'air' } })
  const r = await run('dispose_well', town.bot)
  assert.equal(r.status, 'no_effect'); assert.match(r.detail, /no longer usable \(wall is air\)/); assert.equal(town.state.clicks.length, 0); assert.equal(town.state.activations.length, 0)
  const { townWellState } = await import('../src/skills.mjs')
  const st = townWellState(town.bot); assert.equal(st.breached, true)
  assert.equal(W.wellOrder({ now: NOW, distHome: 3, slots: 34, freeSlots: 2, junkStacks: 1, well: st, buildPlan: { wood: 'oak', slotsNeeded: 1 } }).order?.skill, 'build_well')
  const intact = fakeTown({ wellAt: CAP, items: [S('dirt', 1)] })
  assert.equal(townWellState(intact.bot).breached, false, 'positive control')
})

await t('CODEX #7 FULL CUBES ONLY: iron bars / glass panes in the walls or the ring are a gap a body can stand in -- refused', () => {
  const cap = { x: 5, y: 63, z: 0 }
  const bars = {}; for (const y of [62, 63]) for (const [x, z] of [[6, 0], [6, 1], [7, 0], [7, 1]]) bars[`${x},${y},${z}`] = B('iron_bars')
  assert.equal(B('iron_bars').boundingBox, 'block', 'positive control: the coarse category calls bars a block')
  assert.match(W.wellSiteRefusal(flatRead(bars), cap, HOMEFAR), /wall is iron_bars|underground iron_bars/)
  assert.match(W.containmentRefusal(flatRead({ '7,61,1': B('glass_pane') }), cap), /underground glass_pane/)
  assert.equal(W.containmentRefusal(flatRead(), cap), null)
  // the geometry Codex measured: a body in the bars' corner gap reaches the item
  assert.equal(inPickupBox({ x: 6.87, y: 62, z: 0.9 }, { x: 5.5, y: 62.1875, z: 0.5 }, 0, 0), true)
})

await t('CODEX #8 PIT-FIRST throws share the disposal\'s accounting: server-resynced counts, a miss retaken, one row', async () => {
  const town = fakeTown({ hand: S('cobblestone', 64), items: [S('oak_log', 3), S('egg', 16), S('egg', 16), S('flint', 64), ...filler(31)] })
  town.state.missNext = 1
  const r = await run('build_well', town.bot)
  assert.equal(r.status, 'success', r.detail)
  const pits = (await rows('_well_dispose')).filter(x => /stop=pit_first/.test(x.skill.detail)).slice(-2)
  assert.equal(pits.length, 2, 'the retaken miss refilled its slot: a second pit phase makes the room again')
  assert.ok(pits.every(x => field(x.skill.detail, 'server') === 'resync' && field(x.skill.detail, 'nonlisted') === '0'))
  assert.equal(field(pits[0].skill.detail, 'misses'), '1'); assert.equal(field(pits[0].skill.detail, 'retaken'), '1')
  const stand = W.wellStand(flatRead({}, G0), CAP).stand
  assert.ok(town.state.clicks.every(c => c.at.x === stand.x && c.at.y === stand.y && c.at.z === stand.z), `a pit throw from off the stand: ${town.state.clicks.map(c => String(c.at)).join(' ')}`)
})

await t('CODEX #9/#11 an exception after a throw keeps that throw\'s evidence; eating bread meanwhile is other_loss, never nonlisted', async () => {
  const town = fakeTown({ wellAt: CAP, items: [S('egg', 16), S('flint', 64), S('bread', 5), ...filler(32)] })
  town.state.onClick = async () => {
    if (town.state.clicks.length === 1) { const b = town.slots.find(x => x?.name === 'bread'); b.count--; return }
    throw new Error('second click exploded')
  }
  const r = await run('dispose_well', town.bot)
  assert.equal(r.status, 'failed')
  const row = (await rows('_well_dispose')).pop()
  assert.equal(field(row.skill.detail, 'tossed'), '2', 'the throws before the exception were forgotten')
  assert.equal(field(row.skill.detail, 'nonlisted'), '0'); assert.equal(field(row.skill.detail, 'other_loss'), '1')
  assert.ok(Number(field(row.skill.detail, 'n')) >= 16)
})

await t('CODEX #10 close_well re-checks, immediately before the click, that nobody arrived while it walked', async () => {
  const town = fakeTown({ wellAt: CAP, wellOpen: true, items: [S('dirt', 3)], botAt: new Vec3(HOME.x + 8.5, HOME.y, HOME.z + 8.5) })
  town.state.onGoto = async () => { town.bot.players['b-Thrower'] = { username: 'b-Thrower', entity: { position: new Vec3(CAP.x + 0.5, CAP.y + 1, CAP.z - 1.5) } } }
  const r = await run('close_well', town.bot)
  assert.equal(r.status, 'no_effect'); assert.equal(town.world.get(town.key(CAP)).props.open, true, 'closed under another bot\'s throws')
})

await t('MUTANT (skills): planning on an unanswered resync throws anyway (#2 killed)', async () => {
  await withMutant(SP, "      if (before.source !== 'resync') { out.refused = 'server_unanswered'; return out }\n", '', async m => {
    const town = fakeTown({ wellAt: CAP, items: [S('egg', 16), ...filler(34)] })
    town.state.serverSilent = true
    await within(m.SKILLS.dispose_well.run({ bot: town.bot }, {}, { aborted: false }), 15000, 'mutant')
    assert.ok(town.state.clicks.length > 0, 'mutant inert')
  })
})
await t('MUTANT (skills): digging without the record settle digs before peers can know (#4 killed)', async () => {
  await withMutant(SP, "    if (['fresh', 'half_dug'].includes(stage())) await settleRecord()\n", '', async m => {
    const dir = mkdtempSync(path.join(tmpdir(), 'well-store-'))
    const C = await import('../src/composter.mjs')
    const key = `junkwell-site-${HOME.x}_${HOME.y}_${HOME.z}`
    assert.ok(C.createSiteGen(dir, key, 1, CAP, null))
    const fresh = Date.now() + 800
    fsMod.utimesSync(path.join(dir, `${key}.g1.json`), fresh / 1000, fresh / 1000)
    const town = fakeTown({ items: [S('oak_trapdoor', 2)], storeDir: dir })
    let firstDig = null
    const dig0 = town.bot.dig; town.bot.dig = async b => { firstDig ??= Date.now(); return dig0(b) }
    await within(m.SKILLS.build_well.run({ bot: town.bot }, {}, { aborted: false }), 15000, 'mutant')
    assert.ok(firstDig !== null && firstDig < fresh, 'mutant inert')
  })
})
await t('MUTANT (skills): throwing into a breached well (#6 killed)', async () => {
  await withMutant(SP, "  if (well.breach) return skip('breached',", "  if (false) return skip('breached',", async m => {
    const town = fakeTown({ wellAt: CAP, items: [S('egg', 16), ...filler(34)], blocks: { [`${CAP.x + 1},${CAP.y - 1},${CAP.z}`]: 'air' } })
    await within(m.SKILLS.dispose_well.run({ bot: town.bot }, {}, { aborted: false }), 15000, 'mutant')
    assert.ok(town.state.clicks.length > 0, 'mutant inert')
  })
})

// ---- Codex round 2 -------------------------------------------------------------------------------------------------------
await t('R2 A LATE OPEN (15 ticks, past the old 10-tick wait) is seen and closed; one that never lands in 40 ticks is a _well_open_unresolved row, and the scheduler then closes', async () => {
  const town = fakeTown({ wellAt: CAP, items: [S('egg', 16), ...filler(34)] })
  const signal = { aborted: false }
  town.state.activateLagTicks = 15; town.state.onActivate = async () => { signal.aborted = true }
  await assert.rejects(run('dispose_well', town.bot, signal), e => e?.aborted === true)
  for (let i = 0; i < 20; i++) await town.bot.waitForTicks(1)
  assert.equal(town.world.get(town.key(CAP)).props.open, false); assert.ok(town.state.events.includes('open'))
  const t2 = fakeTown({ wellAt: CAP, items: [S('egg', 16), ...filler(34)] })
  const sig2 = { aborted: false }
  t2.state.activateLagTicks = 200; t2.state.onActivate = async () => { sig2.aborted = true }
  const n0 = (await rows('_well_open_unresolved')).length
  await assert.rejects(run('dispose_well', t2.bot, sig2), e => e?.aborted === true)
  assert.equal((await rows('_well_open_unresolved')).length, n0 + 1, 'the unresolved open was not reported')
  for (let i = 0; i < 200; i++) await t2.bot.waitForTicks(1)       // the late update lands: the well is open now
  assert.equal(t2.world.get(t2.key(CAP)).props.open, true, 'positive control: the late open landed')
  const { townWellState } = await import('../src/skills.mjs')
  assert.equal(W.wellOrder({ now: NOW, distHome: 3, slots: 10, well: () => townWellState(t2.bot) }).order?.skill, 'close_well')
  assert.equal((await run('close_well', t2.bot)).status, 'success'); assert.equal(t2.world.get(t2.key(CAP)).props.open, false)
})

await t('R2 B someone arriving DURING the record wait stops the dig (well_attended, a cooldown only); the settle is fixed, not the skill budget', async () => {
  const { WELL_RECORD_SETTLE_MS } = await import('../src/skills.mjs')
  assert.equal(WELL_RECORD_SETTLE_MS, 300, 'the suite override')
  const dir = mkdtempSync(path.join(tmpdir(), 'well-store-'))
  const C = await import('../src/composter.mjs')
  const key = `junkwell-site-${HOME.x}_${HOME.y}_${HOME.z}`
  assert.ok(C.createSiteGen(dir, key, 1, CAP, null))
  const fresh = Date.now() + 600
  fsMod.utimesSync(path.join(dir, `${key}.g1.json`), fresh / 1000, fresh / 1000)
  const town = fakeTown({ items: [S('oak_trapdoor', 2)], storeDir: dir })
  const timer = setTimeout(() => { town.bot.players['b-Late'] = { username: 'b-Late', entity: { position: new Vec3(CAP.x + 2.5, CAP.y + 1, CAP.z + 0.5) } } }, 300)
  const r = await run('build_well', town.bot)
  clearTimeout(timer)
  assert.equal(r.status, 'failed'); assert.equal(r.failClass, 'well_attended'); assert.equal(town.state.digs.length, 0)
  assert.equal(W.wellOrderOutcome('build_well', 'failed', NOW, {}, 'well_attended').buildBackoffUntil, NOW + W.WELL_BUILD_COOLDOWN_MS)
})

await t('R2 C an exception AFTER the throws (a tick wait failing while judging misses) still writes the account row', async () => {
  const town = fakeTown({ wellAt: CAP, items: [S('egg', 16), S('flint', 64), ...filler(33)] })
  town.state.onClosed = () => { town.state.tickThrows = true }
  const r = await run('dispose_well', town.bot)
  assert.ok(['failed', 'success'].includes(r.status))
  const row = (await rows('_well_dispose')).pop()
  assert.equal(field(row.skill.detail, 'tossed'), '2'); assert.match(row.skill.detail, /error_after:/)
  assert.equal(town.world.get(town.key(CAP)).props.open, false)
})

await t('R2 E a visitor with nothing listed closes an open well and reports it (success, closed_open=1)', async () => {
  const town = fakeTown({ wellAt: CAP, wellOpen: true, items: [S('dirt', 5), ...filler(33)] })
  const r = await run('dispose_well', town.bot)
  assert.equal(r.status, 'success', r.detail); assert.equal(r.placed, 1)
  assert.equal(town.world.get(town.key(CAP)).props.open, false); assert.equal(town.state.clicks.length, 0)
  assert.equal(field((await rows('_well_dispose')).pop().skill.detail, 'closed_open'), '1')
})

// ---- Claude review (independent), round after f40334e ------------------------------------------------------------------
const WRP = new URL('../../scripts/host/wellread.py', import.meta.url)
await t('P1-1 C3 FIRES: the server drops iron where the client saw a rail -> the row says offlist=1 offlist_items=iron_ingot (the read gates on it)', async () => {
  const town = fakeTown({ wellAt: CAP, items: [S('egg', 16), S('flint', 64), S('rail', 3), ...filler(32)] })
  town.state.onLook = () => { if (town.state.clicks.length === 2) town.state.serverSubstitute = 'iron_ingot' }
  const r = await run('dispose_well', town.bot)
  assert.equal(r.status, 'success', r.detail)
  const row = (await rows('_well_dispose')).pop()
  assert.equal(field(row.skill.detail, 'offlist'), '1', row.skill.detail); assert.equal(field(row.skill.detail, 'offlist_items'), 'iron_ingot:3')
  assert.equal(field(row.skill.detail, 'nonlisted'), '0', 'the instrument the review proved blind still reads 0 here -- which is why C3 no longer rests on it')
  // the read's C3 rule fires on this exact row (wellread.py c3_breach, same predicate): offlist > 0
  const src = readFileSync(WRP, 'utf8')
  assert.match(src, /if num\(f, 'offlist'\) or off or num\(f, 'nonlisted'\):/)
  const clean = fakeTown({ wellAt: CAP, items: [S('egg', 16), ...filler(34)] })
  await run('dispose_well', clean.bot)
  assert.equal(field((await rows('_well_dispose')).pop().skill.detail, 'offlist'), '0', 'positive control the other way: a clean visit reads 0')
})
await t('MUTANT: counting no off-list entity leaves C3 blind again', async () => {
  await withMutant(WP, "    if (!isWellJunk(t.name) && !swordOk) {", "    if (false) {", async m => {
    assert.equal(m.thrownNames([{ name: 'iron_ingot', count: 3 }]).offlist, 0, 'mutant inert')
  })
  assert.equal(W.thrownNames([{ name: 'iron_ingot', count: 3 }, { name: 'egg', count: 16 }, { name: null }]).offlist, 1)
  assert.equal(W.thrownNames([{ name: null }]).unnamed, 1)
})

// the real pathfinder, a body standing on the floor trapdoor inside the shaft
const escapeWorld = ({ cap = 'closed', deep = false } = {}) => {
  const reg = require('prismarine-registry')('1.21.8'); const Block = require('prismarine-block')(reg)
  const { Movements: Mv, goals: G } = require('mineflayer-pathfinder')
  const AStar = require('mineflayer-pathfinder/lib/astar.js'); const Move = require('mineflayer-pathfinder/lib/move.js')
  const well = { x: 2, y: 63, z: 0 }
  const td = (half, open) => { const b = reg.blocksByName.oak_trapdoor; for (let id = b.minStateId; id <= b.maxStateId; id++) { const p = Block.fromStateId(id, 0).getProperties(); if (p.facing === 'north' && !p.powered && !p.waterlogged && p.half === half && p.open === open) return id } }
  // A BOUNDED WORLD (Codex round 7: an unbounded search ends 'partial', which proves nothing): bedrock walls at |x|,|z| > 9
  // and a bedrock ceiling at y >= 72, so every search ends success or noPath.
  //   pit   an interrupted build at stage 'dug': no cap, no floor trapdoor -- the body stands on the stone floor
  //   deep  the floor breached too: the body stands one lower (y 61); bedrock beside it and under it, so the only way out
  //         is a jump whose headroom is the column at cap level (Codex round 7's case)
  const B_ = n => reg.blocksByName[n].defaultState
  const stateAt = (x, y, z) => {
    if (Math.abs(x - 2) > 9 || Math.abs(z) > 9 || y >= 72) return B_('bedrock')
    if (x === well.x && z === well.z) {
      if (y === well.y) return cap === 'pit' || deep ? B_('air') : td('top', cap === 'open')
      if (y === well.y - 1) return cap === 'pit' || deep ? B_('air') : td('bottom', false)
      if (y === well.y - 2 && deep) return B_('air')
    }
    if (deep && y === well.y - 2 && Math.abs(x - well.x) <= 1 && Math.abs(z - well.z) <= 1) return B_('bedrock')   // no way sideways
    if (deep && y === well.y - 3 && Math.abs(x - well.x) <= 2 && Math.abs(z - well.z) <= 2) return B_('bedrock')   // nor down
    return B_(y <= 63 ? 'stone' : 'air')
  }
  const blockAt = p => { const x = Math.floor(p.x), y = Math.floor(p.y), z = Math.floor(p.z); const b = Block.fromStateId(stateAt(x, y, z), 0); b.position = new Vec3(x, y, z); return b }
  const bot = { registry: reg, version: '1.21.8', game: { minY: -64, height: 384 }, blockAt, entity: { position: new Vec3(2.5, deep ? 61 : 62.1875, 0.5), effects: {} },
                entities: {}, inventory: { items: () => [], slots: [] }, pathfinder: { bestHarvestTool: () => null } }
  const cols = [{ ...well }]
  const profile = skip => {
    const m = W.protectWellBlocks(new Mv(bot), reg)
    m.canDig = true; m.allow1by1towers = true; m.dontCreateFlow = true; m.maxDropDown = 6
    m.exclusionAreasStep = [b => W.wellStepCost(cols, b, skip)]; m.exclusionAreasBreak = [b => W.wellBreakCost(cols, b, skip)]
    return m
  }
  const start = deep ? new Move(2, 61, 0, 0, 0) : new Move(2, 62, 0, 0, 0)
  const route = (m, goal = new G.GoalBlock(6, 64, 0)) => new AStar(start, m, goal, 20000, 20000).compute()
  return { cols, profile, route, bot, G }
}
await t('P2-1 ESCAPE (real pathfinder): from inside the shaft, closed/open cap or uncapped pit, every way out is in the well -- with the own-column exemption a dig profile gets out; without it, noPath (the dead end)', async () => {
  for (const [cap, deep] of [['closed', false], ['open', false], ['pit', false], ['pit', true]]) {
    const { cols, profile, route } = escapeWorld({ cap, deep })
    const without = route(profile(null))
    assert.equal(without.status, 'noPath', `${cap}${deep ? ' deep' : ''}: positive control -- the composed guards trap the body (a definitive noPath)`)
    const r = route(profile(cols[0]))
    assert.equal(r.status, 'success', `${cap}${deep ? ' deep' : ''}: no way out with the exemption`)
    const last = r.path[r.path.length - 1]; assert.ok(last.y >= 64 && !(last.x === 2 && last.z === 0), `${cap}: ended at ${last.x},${last.y},${last.z}`)
    assert.ok(r.path.every(n => !(n.x === 2 && n.z === 0 && n.y >= 64)), `${cap}: the way out crossed the cap`)
  }
  assert.equal(W.wellStepCost([{ x: 2, y: 63, z: 0 }], { position: { x: 2, y: 64, z: 0 } }, null), W.WELL_STEP_COST, 'another bot still never steps there')
})
await t('MUTANT: without the own-column exemption the body in the shaft has no path out', async () => {
  await withMutant(WP, "    if (c === skip) continue   // THE BOT'S OWN WELL", "    if (false) continue   // THE BOT'S OWN WELL", async m => {   // the BREAK exemption: the one the escape needs
    const { cols, profile, route } = escapeWorld({ cap: 'closed' })
    const p = profile(cols[0]); p.exclusionAreasStep = [b => m.wellStepCost(cols, b, cols[0])]; p.exclusionAreasBreak = [b => m.wellBreakCost(cols, b, cols[0])]
    assert.notEqual(route(p).status, 'success', 'mutant inert')
  })
})
await t('P2-1 THE CHAIN: a bot inside an OPEN well gets no well order, close_well never seals it in, dispose/build refuse ("inside")', async () => {
  const town = fakeTown({ wellAt: CAP, wellOpen: true, items: [S('egg', 16), S('oak_trapdoor', 2), ...filler(33)], botAt: new Vec3(CAP.x + 0.5, CAP.y - 1 + 0.1875, CAP.z + 0.5) })
  const { townWellState, insideTownWell } = await import('../src/skills.mjs')
  assert.equal(insideTownWell(town.bot), true)
  assert.equal(townWellState(town.bot).attended, false, 'positive control: self is not "attended" -- the review\'s self-close')
  assert.equal(W.wellOrder({ now: NOW, distHome: 3, slots: 36, junkStacks: 1, well: () => townWellState(town.bot), inside: () => insideTownWell(town.bot) }).order, null)
  assert.equal(W.wellOrder({ now: NOW, distHome: 3, slots: 36, junkStacks: 1, well: () => townWellState(town.bot), inside: false }).order?.skill, 'close_well', 'positive control: without the inside flag it would close over itself')
  assert.equal((await run('close_well', town.bot)).status, 'no_effect'); assert.equal(town.world.get(town.key(CAP)).props.open, true, 'sealed in')
  assert.match((await run('dispose_well', town.bot)).detail, /inside a junk well/)
  assert.equal(town.state.activations.length, 0)
})
await t('MUTANT: without the scheduler\'s inside refusal a bot in the well is ordered to close it over itself', async () => {
  await withMutant(WP, '  if (lazy(inside)) return none()\n', '', async m => {
    assert.equal(m.wellOrder({ now: NOW, distHome: 3, slots: 36, junkStacks: 1, well: { open: true, attended: false }, inside: true }).order?.skill, 'close_well', 'mutant inert')
  })
})
await t('MUTANT (skills): without the inside detection close_well closes the cap over the bot (both of its checks rest on it)', async () => {
  await withMutant(SP, "  try { return !!bodyInWell(bot.wellCellsNow?.() ?? knownWellCells(bot), bot.entity?.position) } catch { return false }", '  return false', async m => {
    const town = fakeTown({ wellAt: CAP, wellOpen: true, items: [S('dirt', 3)], botAt: new Vec3(CAP.x + 0.5, CAP.y - 1 + 0.1875, CAP.z + 0.5) })
    await within(m.SKILLS.close_well.run({ bot: town.bot }, {}, { aborted: false }), 15000, 'mutant')
    assert.equal(town.world.get(town.key(CAP)).props.open, false, 'mutant inert')
  })
})

await t('P2-2 STANDS: a chest on the front stand -> the throw is made from a side stand; all three blocked -> a breach, and the town builds a new well', async () => {
  const front = W.standForFacing(CAP, 'north')
  const town = fakeTown({ wellAt: CAP, items: [S('egg', 16), S('flint', 64), ...filler(33)], blocks: { [`${front.x},${front.y},${front.z}`]: 'chest' } })
  const r = await run('dispose_well', town.bot)
  assert.equal(r.status, 'success', r.detail)
  assert.ok(town.state.clicks.every(c => !(c.at.x === front.x && c.at.z === front.z)), 'thrown from the blocked front')
  assert.equal(town.state.pending.filter(d => W.itemInWell([CAP], d.rest)).length, 2, 'a side throw missed')
  const all = {}; for (const c of W.standCandidates(CAP, 'north')) all[`${c.x},${c.y},${c.z}`] = 'chest'
  const t2 = fakeTown({ wellAt: CAP, items: [S('egg', 16), ...filler(34)], blocks: all })
  const r2 = await run('dispose_well', t2.bot)
  assert.equal(r2.status, 'no_effect'); assert.match(r2.detail, /every throwing stand is blocked/); assert.equal(t2.state.clicks.length, 0)
  const { townWellState } = await import('../src/skills.mjs')
  assert.equal(townWellState(t2.bot).breached, true)
  assert.deepEqual(W.wellReservedCells(CAP, 'north').length, 4, 'the cells chest-full must reserve on the rebase: the column above the cap and three stands')
})
await t('MUTANT: with only the front stand, one chest ends the well', async () => {
  await withMutant(WP, "          ...side.map((d, i) => ({ x: cap.x + d.x, y: cap.y + 1, z: cap.z + d.z, side: i ? 'left' : 'right' }))]", '          ]', async m => {
    const front = W.standForFacing(CAP, 'north')
    const read = (x, y, z) => (x === front.x && y === front.y && z === front.z ? B('chest') : flatRead({}, G0)(x, y, z))
    assert.equal(m.usableStands(read, CAP, 'north').length, 0, 'mutant inert')
  })
})

await t('P2-3 HOME IS OFF THE WELL: the canonical cap is >= 7 from home, so a bot idling on the home point does not refuse disposal; bank containers are kept 7 away', async () => {
  assert.ok(Math.hypot(CAP.x - HOME.x, CAP.z - HOME.z) >= W.WELL_HOME_CLEARANCE, `cap ${Math.hypot(CAP.x - HOME.x, CAP.z - HOME.z).toFixed(2)} from home`)
  assert.equal(W.wellAdmission({ cap: CAP, players: [{ username: 'idler', x: HOME.x + 0.5, y: HOME.y, z: HOME.z + 0.5 }] }), null)
  assert.ok(W.wellAdmission({ cap: { x: HOME.x + 2, y: CAP.y, z: HOME.z + 1 }, players: [{ username: 'idler', x: HOME.x + 0.5, y: HOME.y, z: HOME.z + 0.5 }] }), 'positive control: the old 2.55 cap is refused')
  const town = fakeTown({ wellAt: CAP, items: [S('egg', 16), ...filler(34)], players: { idler: { x: HOME.x + 0.5, y: HOME.y, z: HOME.z + 0.5 } } })
  assert.equal((await run('dispose_well', town.bot)).status, 'success')
  const site = W.canonicalWellSite({ home: HOME, read: flatRead({}, G0), avoid: [{ x: CAP.x, z: CAP.z, r: 7, what: 'a bank container' }] }).site
  assert.ok(site && Math.hypot(site.x - CAP.x, site.z - CAP.z) >= 7, 'a bank chest at the old cap moves the site')
})
await t('MUTANT: the site search starting at the composter\'s 3 puts the cap where a bot at home blocks it', async () => {
  await withMutant(WP, 'export const WELL_HOME_CLEARANCE = ADMISSION_RADIUS_FOR_SITE + 2', 'export const WELL_HOME_CLEARANCE = 3', async m => {
    const cap = m.canonicalWellSite({ home: HOME, read: flatRead({}, G0) }).site
    assert.ok(m.wellAdmission({ cap, players: [{ username: 'idler', x: HOME.x + 0.5, y: HOME.y, z: HOME.z + 0.5 }] }), 'mutant inert')
  })
})

await t('P2-5 a close that keeps failing backs off (2 failures -> 5 min); a success clears it', () => {
  let st = W.wellOrderOutcome('close_well', 'failed', NOW, {})
  assert.equal(st.closeBackoffUntil ?? 0, 0, 'one failure is not yet a pattern')
  st = W.wellOrderOutcome('close_well', 'failed', NOW + 1, st)
  assert.equal(st.closeBackoffUntil, NOW + 1 + W.CLOSE_BACKOFF_MS)
  assert.equal(W.wellOrder({ now: NOW + 60_000, distHome: 3, slots: 10, well: { open: true, attended: false }, state: st }).order, null)
  assert.equal(W.wellOrder({ now: NOW + 1 + W.CLOSE_BACKOFF_MS, distHome: 3, slots: 10, well: { open: true, attended: false }, state: st }).order?.skill, 'close_well')
  assert.equal(W.wellOrderOutcome('close_well', 'success', NOW, st).closeBackoffUntil, 0)
})
await t('MUTANT: no close backoff retries forever', async () => {
  await withMutant(WP, '      if (s.closeFails >= CLOSE_FAILS_BEFORE_BACKOFF) { s.closeBackoffUntil = now + CLOSE_BACKOFF_MS; s.closeFails = 0 }', '      if (false) { s.closeBackoffUntil = now + CLOSE_BACKOFF_MS; s.closeFails = 0 }', async m => {
    const st = m.wellOrderOutcome('close_well', 'failed', NOW, m.wellOrderOutcome('close_well', 'failed', NOW, {}))
    assert.equal(st.closeBackoffUntil ?? 0, 0, 'mutant inert')
  })
})

await t('P2-6 ITEMS IN THE 2x2 GRID (an aborted craft): no close_window, no resync, no throw -- a named skip', async () => {
  const town = fakeTown({ wellAt: CAP, items: [S('egg', 16), ...filler(34)] })
  town.slots[1] = { name: 'oak_planks', type: REG.itemsByName.oak_planks.id, count: 4, slot: 1 }
  const r = await run('dispose_well', town.bot)
  assert.equal(r.status, 'no_effect'); assert.match(r.detail, /2x2 grid/)
  assert.equal(town.state.writes.filter(w => w.name === 'close_window').length, 0, 'the close that drops grid items was sent')
  assert.equal(town.state.clicks.length, 0)
})
await t('MUTANT (skills): without the grid check the resync close is sent with items in the grid', async () => {
  await withMutant(SP, "      if (grid.length || bot.inventory?.selectedItem) { out.refused = 'grid_loaded';", "      if (false) { out.refused = 'grid_loaded';", async m => {
    const town = fakeTown({ wellAt: CAP, items: [S('egg', 16), ...filler(34)] })
    town.slots[1] = { name: 'oak_planks', type: REG.itemsByName.oak_planks.id, count: 4, slot: 1 }
    await within(m.SKILLS.dispose_well.run({ bot: town.bot }, {}, { aborted: false }), 15000, 'mutant')
    assert.ok(town.state.writes.some(w => w.name === 'close_window'), 'mutant inert')
  })
})

const arrive = town => { town.bot.players['b-Arrives'] = { username: 'b-Arrives', entity: { position: new Vec3(CAP.x + 2.5, CAP.y + 1, CAP.z + 0.5) } } }
await t('P2-8 ADMISSION RACE: a player arriving DURING THE WALK stops the visit before the resync; one arriving DURING THE RESYNC stops it before the cap opens', async () => {
  const a = fakeTown({ wellAt: CAP, items: [S('egg', 16), ...filler(34)] })
  a.state.onGoto = async () => arrive(a)
  const ra = await run('dispose_well', a.bot)
  assert.equal(ra.status, 'no_effect'); assert.equal(a.state.writes.filter(w => w.name === 'window_click').length, 0, 'resynced with a player at the rim'); assert.equal(a.state.activations.length, 0)
  const b = fakeTown({ wellAt: CAP, items: [S('egg', 16), ...filler(34)] })
  b.state.onResync = () => arrive(b)
  const rb = await run('dispose_well', b.bot)
  assert.equal(rb.status, 'no_effect'); assert.match(rb.detail, /before the cap opened/); assert.equal(b.state.activations.length, 0, 'the cap opened with a player at the rim')
})
await t('MUTANT M2 (skills): without the at-the-stand re-check the visit resyncs with a player at the rim', async () => {
  await withMutant(SP, "    const near2 = wellAdmission({ players: playersSeen(bot), cap, me: bot.username })\n    if (near2) return skip('player_near', `wait for ${near2.who} to move off the town junk well (${near2.dist.toFixed(1)} blocks): it opens only with nobody within 5`)\n    stationary = Date.now() + VISIT_BUDGET_MS", '    stationary = Date.now() + VISIT_BUDGET_MS', async m => {
    const a = fakeTown({ wellAt: CAP, items: [S('egg', 16), ...filler(34)] })
    a.state.onGoto = async () => arrive(a)
    await within(m.SKILLS.dispose_well.run({ bot: a.bot }, {}, { aborted: false }), 15000, 'mutant')
    assert.ok(a.state.writes.some(w => w.name === 'window_click'), 'mutant inert')
  })
})
await t('MUTANT (skills): without the pre-open re-check the cap opens with a player at the rim', async () => {
  await withMutant(SP, "        if (near) { out.refused = 'player_near'; out.stop = `${near.who} came within ${near.dist.toFixed(1)} before the cap opened`; return out }\n", '', async m => {
    const b = fakeTown({ wellAt: CAP, items: [S('egg', 16), ...filler(34)] })
    b.state.onResync = () => arrive(b)
    await within(m.SKILLS.dispose_well.run({ bot: b.bot }, {}, { aborted: false }), 15000, 'mutant')
    assert.ok(b.state.activations.length > 0, 'mutant inert')
  })
})

await t('P3 an interrupted build that leaves its shaft uncapped writes _well_pit_open (the read counts it)', async () => {
  const town = fakeTown({ items: [S('oak_trapdoor', 2)] })
  town.bot._placeBlockWithOptions = async () => { throw new Error('placement refused') }
  const r = await run('build_well', town.bot)
  assert.equal(r.status, 'failed')
  const row = (await rows('_well_pit_open')).pop()
  assert.ok(row, 'no pit row'); assert.match(row.skill.detail, new RegExp(`at=${CAP.x},${CAP.y},${CAP.z} stage=dug`))
})
await t('P3 a breached well stays in the exclusions next to the new one; building past it writes _well_retired (C6 counts active wells)', async () => {
  const { knownWellCells } = await import('../src/skills.mjs')
  const CAP2 = { x: CAP.x + 6, y: CAP.y, z: CAP.z }
  const tdb = (half) => ({ name: 'oak_trapdoor', props: { half, open: false, facing: 'north', powered: false, waterlogged: false } })
  const town = fakeTown({ wellAt: CAP, items: [S('oak_trapdoor', 2), S('dirt', 1)], blocks: { [`${CAP.x + 1},${CAP.y - 1},${CAP.z}`]: 'air',
    [`${CAP2.x},${CAP2.y},${CAP2.z}`]: tdb('top'), [`${CAP2.x},${CAP2.y - 1},${CAP2.z}`]: tdb('bottom') } })
  const cols = knownWellCells(town.bot)
  assert.ok(cols.some(c => c.x === CAP.x && c.z === CAP.z), 'the breached well left the exclusions'); assert.ok(cols.some(c => c.x === CAP2.x && c.z === CAP2.z))
  const t2 = fakeTown({ wellAt: CAP, items: [S('oak_trapdoor', 2), S('dirt', 1)], blocks: { [`${CAP.x + 1},${CAP.y - 1},${CAP.z}`]: 'air' } })
  await run('build_well', t2.bot)
  const ret = (await rows('_well_retired')).pop()
  assert.ok(ret, 'no retirement row'); assert.match(ret.skill.detail, new RegExp(`^at=${CAP.x},${CAP.y},${CAP.z} why=wall_is_air`))
})

await t('CODEX R5 THE EXEMPTION STOPS AT THE CAP: from inside, a goal ON the open cap is unreachable (no shaft -> beside -> cap path); the escape still gets out', async () => {
  const { cols, profile, route, G } = escapeWorld({ cap: 'open' })
  const onCap = route(profile(cols[0]), new G.GoalBlock(2, 64, 0))
  assert.equal(onCap.status, 'noPath', `re-entry (${onCap.status}): ${onCap.path.map(n => `${n.x},${n.y},${n.z}`).join(' ')}`)
  const out = route(profile(cols[0]))
  assert.equal(out.status, 'success'); assert.ok(out.path.every(n => !(n.x === 2 && n.z === 0 && n.y >= 64)), 'the way out crossed the cap')
})
await t('MUTANT: exempting the WHOLE own column (not just cap level and below) lets a path from inside stand on the open cap', async () => {
  await withMutant(WP, '      if (c === skip && p.y <= c.y) continue', '      if (c === skip) continue', async m => {
    const { cols, profile, route, G } = escapeWorld({ cap: 'open' })
    const p = profile(cols[0]); p.exclusionAreasStep = [b => m.wellStepCost(cols, b, cols[0])]
    assert.equal(route(p, new G.GoalBlock(2, 64, 0)).status, 'success', 'mutant inert')
  })
})

await t('CODEX R5 cap_end: every visit row carries the cap AS READ BACK at its end -- closed after a normal visit, open when the close failed (and the visit still reports success)', async () => {
  const town = fakeTown({ wellAt: CAP, items: [S('egg', 16), ...filler(34)] })
  await run('dispose_well', town.bot)
  assert.equal(field((await rows('_well_dispose')).pop().skill.detail, 'cap_end'), 'closed')
  const stuck = fakeTown({ wellAt: CAP, items: [S('egg', 16), ...filler(34)] })
  stuck.state.refuseClose = true
  const r = await run('dispose_well', stuck.bot)
  assert.equal(r.status, 'success', 'the status alone would read as a close')
  assert.equal(field((await rows('_well_dispose')).pop().skill.detail, 'cap_end'), 'open')
})

await t('P2-8 (sandbox race) a player arriving AFTER the cap opened closes it early: WELL_FLOOR_TICKS after the last throw, not the full settle', async () => {
  const town = fakeTown({ wellAt: CAP, items: [S('egg', 16), S('flint', 64), ...filler(33)] })
  let lastClickTick = null, closeTick = null
  town.state.onClick = async () => { lastClickTick = town.state.tick; if (town.state.clicks.length === 2) arrive(town) }
  town.state.onClosed = () => { closeTick ??= town.state.tick }
  const r = await run('dispose_well', town.bot)
  assert.ok(['success', 'no_effect'].includes(r.status), r.detail)
  assert.ok(closeTick !== null && closeTick - lastClickTick <= 15, `closed ${closeTick - lastClickTick} ticks after the last throw (full settle is 25+)`)
  assert.equal(town.state.pending.filter(d => ['egg', 'flint'].includes(d.name)).every(d => W.itemInWell([CAP], d.rest)), true, 'an early close caught a throw')
})
await t('MUTANT (skills): without the early close the cap stays open the whole settle with a player at the rim', async () => {
  await withMutant(SP, "        if (!pit && i + 1 >= WELL_FLOOR_TICKS && wellAdmission({ players: playersSeen(bot), cap, me: bot.username })) { out.earlyClose = true; break }\n", '', async m => {
    const town = fakeTown({ wellAt: CAP, items: [S('egg', 16), S('flint', 64), ...filler(33)] })
    let lastClickTick = null, closeTick = null
    town.state.onClick = async () => { lastClickTick = town.state.tick; if (town.state.clicks.length === 2) arrive(town) }
    town.state.onClosed = () => { closeTick ??= town.state.tick }
    await within(m.SKILLS.dispose_well.run({ bot: town.bot }, {}, { aborted: false }), 15000, 'mutant')
    assert.ok(closeTick - lastClickTick > 15, 'mutant inert')
  })
})

await t('MUTANT: without the step exemption a body in a breached-floor shaft cannot jump out (Codex round 7)', async () => {
  await withMutant(WP, '      if (c === skip && p.y <= c.y) continue\n', '', async m => {
    const { cols, profile, route } = escapeWorld({ cap: 'pit', deep: true })
    const p = profile(cols[0]); p.exclusionAreasStep = [b => m.wellStepCost(cols, b, cols[0])]
    assert.equal(route(p).status, 'noPath', 'mutant inert')
  })
})

// ---- the approval round's minor finding (8f73e80) ----------------------------------------------------------------------
await t('8f73e80 AN UNLOADED NEIGHBOUR IS "DECIDE LATER": not breached, not retired, not rebuilt, never thrown into', async () => {
  const ring = `${CAP.x + 2},${CAP.y - 2},${CAP.z}`, stand = W.standCandidates(CAP, 'north').map(c => `${c.x},${c.y},${c.z}`)
  const baseRead = homeRead(fakeTown({ wellAt: CAP }))
  const readGone = (gone) => (x, y, z) => (gone.includes(`${x},${y},${z}`) ? null : baseRead(x, y, z))
  assert.equal(W.wellBreach(readGone([ring]), CAP, 'north'), 'unknown')
  assert.equal(W.wellBreach(readGone(stand), CAP, 'north'), 'unknown', 'unloaded stands are not blocked stands')
  const { townWellState } = await import('../src/skills.mjs')
  const town = fakeTown({ wellAt: CAP, items: [S('egg', 16), S('oak_trapdoor', 2), ...filler(33)], unloaded: [ring] })
  assert.equal(townWellState(town.bot).breached, false)
  assert.equal(W.wellOrder({ now: NOW, distHome: 3, slots: 36, junkStacks: 1, well: () => townWellState(town.bot), buildPlan: { carried: true, slotsNeeded: 0 } }).order?.skill, 'dispose_well', 'treated as a breach -> it would order a rebuild')
  const r = await run('dispose_well', town.bot)
  assert.equal(r.status, 'no_effect'); assert.match(r.detail, /not loaded yet/); assert.equal(town.state.clicks.length, 0); assert.equal(town.state.activations.length, 0)
  const n0 = (await rows('_well_retired')).length
  const rb = await run('build_well', town.bot)
  assert.equal(rb.status, 'no_effect'); assert.match(rb.detail, /already has a junk well/)
  assert.equal((await rows('_well_retired')).length, n0, 'an unloaded well was retired')
  // positive control: a well with that ring cell really dug out IS breached
  const dug = fakeTown({ wellAt: CAP, items: [S('dirt', 1)], blocks: { [ring]: 'air' } })
  assert.equal(townWellState(dug.bot).breached, true)
})
await t('MUTANT (skills): reading "unknown" as a breach retires a well whose chunk is still loading', async () => {
  await withMutant(SP, "      out.push({ cap, ...id, breach: b === 'unknown' ? null : b, unsure: b === 'unknown' })", "      out.push({ cap, ...id, breach: b, unsure: false })", async m => {
    const town = fakeTown({ wellAt: CAP, items: [S('oak_trapdoor', 2)], unloaded: [`${CAP.x + 2},${CAP.y - 2},${CAP.z}`] })
    const n0 = (await rows('_well_retired')).length
    await within(m.SKILLS.build_well.run({ bot: town.bot }, {}, { aborted: false }), 15000, 'mutant')
    assert.ok((await rows('_well_retired')).length > n0, 'mutant inert')
  })
})

await t('8f73e80 SNOW: a snow layer (any height) on every stand leaves the well usable; a thrower raised by 2-8 layers is aimed for it', () => {
  const PB = require('prismarine-block')('1.21.11')
  const snow = layers => { const d = REG.blocksByName.snow; for (let id = d.minStateId; id <= d.maxStateId; id++) { const b = PB.fromStateId(id, 0); if (String(b.getProperties().layers) === String(layers)) return { name: 'snow', boundingBox: d.boundingBox, shapes: b.shapes, hardness: d.hardness, props: b.getProperties() } } }
  const baseRead = homeRead(fakeTown({ wellAt: CAP }))
  for (const layers of [1, 2, 8]) {
    const extra = {}; for (const c of W.standCandidates(CAP, 'north')) extra[`${c.x},${c.y},${c.z}`] = snow(layers)
    const read = (x, y, z) => extra[`${x},${y},${z}`] ?? baseRead(x, y, z)
    assert.equal(W.usableStands(read, CAP, 'north').length, 3, `${layers} layer(s) of snow blocked the stands`)
    assert.equal(W.wellBreach(read, CAP, 'north'), null)
  }
  const from = { x: CAP.x + 0.5, z: CAP.z - 0.5 }
  const flat = W.wellAim({ from, cap: CAP, facing: 'north' }), raised = W.wellAim({ from, cap: CAP, facing: 'north', rise: 0.875 })
  assert.ok(raised.ok && raised.rate >= 0.95, `raised ${raised.rate}`); assert.notEqual(raised.pitch, flat.pitch, 'the rise changed nothing')
  assert.ok(W.tossHitRate({ from, cap: CAP, facing: 'north', pitchDeg: flat.pitch, rise: 0.875 }) < raised.rate, 'positive control: the flat aim from 0.875 higher is worse')
})
await t('MUTANT: an aim that ignores the thrower\'s rise throws from a snow layer as if from the rim', async () => {
  await withMutant(WP, '  let x = 0, z = 0, y = TOSS.spawnUp + Math.max(0, rise)', '  let x = 0, z = 0, y = TOSS.spawnUp', async m => {
    const from = { x: CAP.x + 0.5, z: CAP.z - 0.5 }
    assert.equal(m.wellAim({ from, cap: CAP, facing: 'north', rise: 0.875 }).pitch, m.wellAim({ from, cap: CAP, facing: 'north' }).pitch, 'mutant inert')
  })
})

// ===================================================================================================================
// WIRING (structural: comments stripped, unique anchors, a mutant each)
// ===================================================================================================================
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map(l => l.replace(/(^|\s)\/\/.*$/, '')).join('\n')
const once = (s, needle, where) => { const n = s.split(needle).length - 1; assert.equal(n, 1, `${where}: expected exactly one "${needle}", found ${n}`) }
const IDX = strip(readFileSync(new URL('../src/index.mjs', import.meta.url), 'utf8'))
const COG = strip(readFileSync(new URL('../src/cognitive.mjs', import.meta.url), 'utf8'))
const idxWired = s => {
  once(s, 'moves.exclusionAreasStep = [waterEntryPenalty, deathSitePenalty, wellPenalty]', 'index')
  once(s, 'waterMoves.exclusionAreasStep = [deathSitePenalty, wellPenalty]', 'index')
  once(s, 'moves.exclusionAreasBreak = [(block) => wellBreakCost(wellCols, block, selfWell)]', 'index')
  once(s, 'const wellPenalty = (block) => wellStepCost(wellCols, block, selfWell)', 'index')
  once(s, "bot.on('move', trackSelf)", 'index')
  once(s, 'protectWellBlocks(moves, bot.registry)', 'index')
  once(s, 'const wellsTimer = setInterval(refreshWells, 20_000)', 'index')
  const clone = s.indexOf('Object.assign(gatherMoves, moves)')
  for (const a of ['moves.exclusionAreasStep = [waterEntryPenalty', 'moves.exclusionAreasBreak = [', 'protectWellBlocks(moves']) assert.ok(s.indexOf(a) > 0 && s.indexOf(a) < clone, `${a} after the clones copy the profile`)
}
await t('index.mjs: the well cost on the shared step array and the water array, the break array and the trapdoor never-dig set before any clone, the 20 s cache', () => idxWired(IDX))
await t('MUTANT (index): the well dropped from the water profile, or the break array set after the clones, is detected', () => {
  const m1 = IDX.replace('waterMoves.exclusionAreasStep = [deathSitePenalty, wellPenalty]', 'waterMoves.exclusionAreasStep = [deathSitePenalty]')
  assert.notEqual(m1, IDX, 'MUTATION DID NOT APPLY'); assert.throws(() => idxWired(m1), /found 0/)
  const line = 'moves.exclusionAreasBreak = [(block) => wellBreakCost(wellCols, block, selfWell)]'
  const m2 = IDX.replace(line, '').replace('Object.assign(gatherMoves, moves)', 'Object.assign(gatherMoves, moves)\n' + line)
  assert.notEqual(m2, IDX, 'MUTATION DID NOT APPLY'); assert.throws(() => idxWired(m2), /after the clones/)
})
const cogWired = s => {
  once(s, 'const r = wellOrder({', 'cognitive')
  once(s, 'if (WELL_ORDERS.has(admitted.skill)) this.wellState = wellOrderOutcome(admitted.skill, r.status, Date.now(), this.wellState ?? {}, r.failClass ?? null)', 'cognitive')
  assert.ok(s.indexOf('const r = townOrder({') < s.indexOf('const r = wellOrder({'), 'the composter takes what composts first')
}
await t('cognitive.mjs issues the well orders after the composter\'s and feeds the outcome back', () => cogWired(COG))
await t('MUTANT (cognitive): the outcome line removed is detected', () => {
  const m = COG.replace('if (WELL_ORDERS.has(admitted.skill)) this.wellState = wellOrderOutcome(', 'if (false) this.wellState = wellOrderOutcome(')
  assert.notEqual(m, COG, 'MUTATION DID NOT APPLY'); assert.throws(() => cogWired(m), /found 0/)
})

// ---- mutants on the decisions (withMutant as in climb-escape.test.mjs: anchor present AND unique) ----------------------
async function withMutant (file, old, neu, fn) {
  const src = readFileSync(file, 'utf8')
  assert.ok(src.includes(old), `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 60))} is not in ${file.pathname}`)
  assert.equal(src.split(old).length, 2, 'the mutation target is not unique; the mutant is ambiguous')
  const body = src.replace(old, neu).replace(/from '\.\//g, "from '../src/")
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, body)
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}
await t('MUTANT: no underground-ring check accepts a cave beside the shaft', async () => {
  await withMutant(WP, "if (!fullCube(b) || LIQUID.test(b.name ?? '')) return `underground ${b.name} beside the shaft`", ';', async m => {
    assert.equal(m.wellSiteRefusal(flatRead({ '7,60,0': AIR }), { x: 5, y: 63, z: 0 }, HOMEFAR), null, 'mutant inert')
  })
})
await t('MUTANT: an admission radius of 0 opens with a player beside it', async () => {
  await withMutant(WP, 'if (d <= radius && (!near || d < near.dist))', 'if (d <= 0 && (!near || d < near.dist))', async m => {
    assert.equal(m.wellAdmission({ cap: { x: 0, y: 63, z: 0 }, players: [{ username: 'x', x: 2, y: 64, z: 0.5 }] }), null, 'mutant inert')
  })
})
await t('MUTANT: a free step cost lets the planner stand on the cap', async () => {
  await withMutant(WP, '      if (c === skip && p.y <= c.y) continue\n      return WELL_STEP_COST', '      if (c === skip && p.y <= c.y) continue\n      return 0', async m => {
    const { route, profile, inColumn } = routeWorld()
    const mm = profile(null); mm.exclusionAreasStep = [b => m.wellStepCost([{ x: 2, y: 63, z: 0 }], b)]
    assert.deepEqual(inColumn(route(mm)), ['2,64,0'], 'mutant inert')
  })
})
await t('MUTANT: the trigger below 34 disposes from a roomy bag', async () => {
  await withMutant(WP, '          slots >= TRIGGER_SLOTS && junkStacks > 0', '          slots >= 0 && junkStacks > 0', async m => {
    assert.equal(m.wellOrder({ now: NOW, distHome: 5, well: well0, slots: 10, freeSlots: 26, junkStacks: 1 }).order?.skill, 'dispose_well', 'mutant inert')
  })
})
await t('MUTANT: no pit-first means a full bag of junk is a dead end', async () => {
  await withMutant(WP, 'if (junkStacks >= deficit) return { ok: true, pitFirst: true', 'if (false) return { ok: true, pitFirst: true', async m => {
    assert.equal(m.wellBuildRoom({ free: 0, slotsNeeded: 2, junkStacks: 3 }).ok, false, 'mutant inert')
  })
})
await t('MUTANT: without STONE_GUARD a bag with no cobble throws its last scaffold (diorite)', async () => {
  await withMutant(WP, '  return after >= STONE_GUARD ? after : null\n', '  return after\n', async m => {
    assert.equal(m.disposePlan([{ name: 'diorite', count: 10, slot: 9 }]).stacks.length, 1, 'mutant inert')
  })
  assert.equal(W.disposePlan([{ name: 'diorite', count: 10, slot: 9 }]).stacks.length, 0, 'and the real code keeps it')
})
await t('MUTANT: a guard that does not charge raw diorite to the reserve lets a diorite-only bag empty itself', async () => {
  await withMutant(WP, '  const after = RESERVE_SET.has(name) ? reserveNow - (Number(count) || 0) : reserveNow\n', '  const after = reserveNow\n', async m => {
    assert.equal(m.disposePlan(Array.from({ length: 3 }, (_, i) => ({ name: 'diorite', count: 64, slot: 9 + i })), { maxStacks: 9 }).stacks.length, 3, 'mutant inert')
  })
})
await t('MUTANT (skills): without the reserve re-check at the click, a reserve spent during the aim is thrown anyway', async () => {
  await withMutant(SP, '      if (left === null) continue\n', '', async m => {
    const town = fakeTown({ wellAt: CAP, items: [S('diorite', 10), S('cobblestone', 64), S('egg', 16), ...Array.from({ length: 32 }, () => S('oak_log', 64))] })
    const cob = town.slots.findIndex(x => x?.name === 'cobblestone')
    town.state.onLook = () => { if (town.slots[cob]?.name === 'cobblestone' && town.slots[cob].count === 64) town.slots[cob] = { ...town.slots[cob], count: 63 } }
    await within(m.SKILLS.dispose_well.run({ bot: town.bot }, {}, { aborted: false }), 15000, 'mutant')
    assert.ok(town.state.clicks.some(c => c.name === 'diorite'), 'mutant inert')
  })
})
await t('MUTANT: the switch without its foodskip half (FOOD_SKIP=off in a peaceful world would throw swords)', async () => {
  await withMutant(WP, "export const swordSwitch = (mode, difficulty) => difficulty === 'peaceful' && foodSkipActive(mode, difficulty)", "export const swordSwitch = (mode, difficulty) => difficulty === 'peaceful'", async m => {
    assert.equal(m.swordSwitch('off', 'peaceful'), true, 'mutant inert')
  })
})
await t('MUTANT (skills): swords allowed in the pit-first build', async () => {
  await withMutant(SP, '      out.swordsAllowed = !pit && wellSwordsNow(bot)', '      out.swordsAllowed = wellSwordsNow(bot)', async m => {
    const town = fakeTown({ hand: S('cobblestone', 64), items: [S('stone_sword', 1), S('oak_log', 3), S('egg', 16), S('egg', 16), S('flint', 64), ...filler(30)] })
    town.bot.serverDifficulty = 'peaceful'
    await within(m.SKILLS.build_well.run({ bot: town.bot }, {}, { aborted: false }), 30000, 'mutant')
    assert.equal(town.count('stone_sword'), 0, 'mutant inert')
  })
})
await t('MUTANT: swords without the switch go down the well in any world', async () => {
  await withMutant(WP, 'export const swordGoes = (name, peaceful) => !!peaceful && isSword(name)', 'export const swordGoes = (name, peaceful) => isSword(name)', async m => {
    assert.equal(m.disposePlan([{ name: 'stone_sword', count: 1, slot: 9 }]).stacks.length, 1, 'mutant inert')
  })
})
await t('MUTANT (skills): no switch re-read at the click throws a sword in a world turned easy', async () => {
  await withMutant(SP, '      if (sword) { const p = wellSwordsNow(bot); if (!p) { acc.swordsKept++; continue } acc.peaceful = (acc.peaceful ?? true) && p }\n', '      if (sword) { acc.peaceful = true }\n', async m => {
    const town = peacefulTown([S('egg', 16), S('stone_sword', 1), ...filler(34)], 'peaceful')
    town.state.onLook = () => { if (town.state.clicks.length >= 1) town.bot.serverDifficulty = 'easy' }
    await within(m.SKILLS.dispose_well.run({ bot: town.bot }, {}, { aborted: false }), 15000, 'mutant')
    assert.equal(town.count('stone_sword'), 0, 'mutant inert')
  })
})
await t('MUTANT: without the list filter the plan throws cobblestone', async () => {
  await withMutant(WP, '  for (const it of list.filter(x => (isWellJunk(x.name) || swordGoes(x.name, swords)) && Number.isInteger(x.slot)).sort((a, b) => a.slot - b.slot)) {', '  for (const it of list.filter(x => Number.isInteger(x.slot)).sort((a, b) => a.slot - b.slot)) {', async m => {
    assert.ok(m.disposePlan([{ name: 'cobblestone', count: 64, slot: 9 }]).stacks.length, 'mutant inert')
  })
})
await t('MUTANT: no flap in the opening is caught by the registry shapes', async () => {
  await withMutant(WP, '    if (f.z === -1) o.z1 -= TOSS.flap\n', '', async m => {
    const [x0, , z0, x1, , z1] = trapShape({ half: 'top', open: true, facing: 'north' })[0]
    assert.equal(flapClear(m.wellOpening({ x: 0, y: 63, z: 0 }, 'north'), [x0, z0, x1, z1]), false, 'mutant inert: the opening still clears the flap')
  })
})
await t('MUTANT (skills): without the finally close an aborted visit leaves the well open', async () => {
  await withMutant(SP, '        if (open) {\n          sawOpen = true\n          try { await setWellOpen(bot, cap, false, g.restoreBound, tickNA) }', '        if (false) {\n          sawOpen = true\n          try { await setWellOpen(bot, cap, false, g.restoreBound, tickNA) }', async m => {
    const town = fakeTown({ wellAt: CAP, items: [S('egg', 16), S('flint', 64), ...filler(33)] })
    const signal = { aborted: false }
    town.state.onClick = async () => { signal.aborted = true }
    await assert.rejects(within(m.SKILLS.dispose_well.run({ bot: town.bot }, {}, signal), 15000, 'mutant'))
    assert.equal(town.world.get(town.key(CAP)).props.open, true, 'mutant inert')
  })
})
await t('MUTANT (skills): without the per-stack re-read a changed slot is thrown', async () => {
  await withMutant(SP, "      if (!it || it.name !== st.name || !(isWellJunk(it.name) || (sword && acc.swordsAllowed)) || bot.currentWindow || bot.inventory?.selectedItem) continue\n", '', async m => {
    const town = fakeTown({ wellAt: CAP, items: [S('egg', 16), S('flint', 64), S('rail', 3), ...filler(32)] })
    const railSlot = town.slots.findIndex(s => s?.name === 'rail')
    town.state.onLook = () => { if (town.state.clicks.length === 2 && town.slots[railSlot]?.name === 'rail') town.slots[railSlot] = { name: 'iron_ingot', type: REG.itemsByName.iron_ingot.id, count: 5, slot: railSlot } }
    await within(m.SKILLS.dispose_well.run({ bot: town.bot }, {}, { aborted: false }), 15000, 'mutant')
    assert.ok(town.state.clicks.some(c => c.name === 'iron_ingot'), 'mutant inert')
  })
})

console.log(`\n${pass} passed, ${fail} failed${failed.length ? `\n  ${failed.join('\n  ')}` : ''}`)
process.exit(fail ? 1 : 0)
