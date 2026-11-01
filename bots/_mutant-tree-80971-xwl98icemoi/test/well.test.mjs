// THE TOWN JUNK WELL (src/well.mjs has the geometry, the sandbox numbers and the design).
//
// Behaviour only. Pure decisions through their exported functions -- the list, the site, the aim, the admission, the
// scheduler, the room decision, the exclusions -- checked against the real registry's trapdoor boxes and the real
// pathfinder; then the real skills through a fake bot whose inventory follows mineflayer's rules and whose throws follow
// vanilla's drop ballistics (noise-free). The refusal CHAIN is driven through wellOrder -> skill -> wellOrderOutcome ->
// wellOrder. Structural assertions only where behaviour cannot reach (the dispatch table, index.mjs's arrays), with
// comments stripped, unique anchors, and a mutant each.
import assert from 'node:assert/strict'
import fsMod, { readFileSync, writeFileSync, unlinkSync, mkdtempSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { Vec3 } from 'vec3'
import { inPickupBox } from '../src/pickupbox.mjs'

const LOG_DIR = `/tmp/mcbot-test-logs-well-${process.pid}`
process.env.LOG_DIR = LOG_DIR; process.env.BOT_NAME = 'TestBot'
process.env.WELL_RECORD_SETTLE_MS = '300'   // production 25 s (every peer's 20 s cache refresh); the suite cannot wait that long
// THE NATURAL WELL, as plinth-02 built it: this file is the natural build's own suite, so plinth-first (plinthfirst-01, which
// never starts a natural well) is off here; its section at the end turns it on per test (withFirst).
process.env.PLINTH_FIRST = '0'
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
    'white_stained_glass', 'white_wool', 'oak_button', 'lead', 'powered_rail', 'brick', 'bricks', 'oak_fence', 'oak_pressure_plate', 'smooth_basalt', 'polished_diorite',
    'diorite', 'granite', 'andesite', 'mossy_cobblestone']) {
    assert.ok(W.isWellJunk(n), `positive control: ${n} is on the list`)
  }
  for (const n of W.WELL_JUNK) {
    assert.ok(REG.itemsByName[n], `${n} is a real 1.21.11 item`)
    assert.ok(W.isWellJunk(n), `${n} is listed AND passes every guard (a listed name a guard refuses is a typo or a contradiction)`)
  }
  assert.equal(W.WELL_JUNK.size, W.OWNER_JUNK_1004.length + W.DECORATIONS.length + W.SCAFFOLD_DECORATIONS.length, 'no name listed twice')
  // scripts/host/wellread.py keeps a Python copy (its C3 gate). OWNER D8 (10-15, smeltjob-01) took stone_bricks and
  // smooth_stone OFF the list: 124 -> 122. The read's copy is a SUPERSET by those two until its owner drops them, which
  // cannot false-trip C3 (no build throws them any more); change both together when wellread is next edited.
  // matset-01 (OWNER 10-23, building tier §3.4) took glass and glass_pane off too: 122 -> 120 (wellread's copy: a superset by 4).
  assert.equal(W.WELL_JUNK.size, 120)
  for (const n of ['cobblestone', 'cobbled_deepslate', 'dirt', 'gravel', 'sand', 'oak_log', 'oak_planks', 'stick', 'oak_sapling',
    'stone_pickaxe', 'wooden_axe', 'apple', 'bread', 'beef', 'raw_iron', 'iron_ingot', 'coal', 'leaf_litter', 'wheat_seeds', 'poppy', 'bamboo', 'bone_meal',
    // 10-07: what the decoration list must NOT take -- the composter's recipe (wooden slabs), the well's own trapdoors, the
    // sleep skill's bed, desert rescue blocks, raw ballast the stone rung counts, compostables, the furnace and the table
    'oak_slab', 'birch_slab', 'oak_trapdoor', 'red_bed', 'white_bed', 'sandstone', 'red_sandstone', 'calcite', 'tuff', 'stone', 'deepslate',
    'wildflowers', 'moss_carpet', 'moss_block', 'kelp', 'dried_kelp', 'furnace', 'crafting_table', 'chest', 'ladder', 'torch', 'bucket', 'string',
    // OWNER D8 (10-15): building stone for the town projects (the hall's bricks, the blast furnaces' smooth stone)
    'stone_bricks', 'smooth_stone',
    // matset-01 (OWNER 10-23): building parts
    'glass', 'glass_pane', 'stone_brick_slab', 'cut_copper', 'copper_door']) {
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
  assert.equal(names(W.disposePlan([{ name: 'white_stained_glass', count: 5, slot: 9 }])), 'white_stained_glass:5')
  assert.equal(names(W.disposePlan([{ name: 'glass', count: 5, slot: 9 }])), '', 'matset-01: plain glass is a building part, never junk')
  // diorite 10 + cobble 63: reserve 73, the diorite would leave 63 -> kept; at cobble 64 it leaves 64 -> goes
  const bag = cobble => [{ name: 'diorite', count: 10, slot: 9 }, { name: 'cobblestone', count: cobble, slot: 10 }, { name: 'white_stained_glass', count: 5, slot: 11 }]
  assert.equal(names(W.disposePlan(bag(63))), 'white_stained_glass:5')
  assert.equal(W.disposePlan(bag(63)).junkStacks, 1, 'the trigger counts only what may go')
  assert.equal(names(W.disposePlan(bag(64))), 'diorite:10,white_stained_glass:5')
  assert.equal(W.disposePlan(bag(64)).stone, 74)
  // mossy_cobblestone is pathfinder scaffold but not reserve stone: it goes while the reserve stays at 64+, and costs none of it
  // (stone_bricks was this example until OWNER D8 took it off the list -- it never goes now)
  assert.equal(names(W.disposePlan([{ name: 'mossy_cobblestone', count: 30, slot: 9 }, { name: 'cobblestone', count: 64, slot: 10 }])), 'mossy_cobblestone:30')
  assert.equal(names(W.disposePlan([{ name: 'mossy_cobblestone', count: 30, slot: 9 }, { name: 'cobblestone', count: 63, slot: 10 }])), '')
  assert.equal(names(W.disposePlan([{ name: 'stone_bricks', count: 30, slot: 9 }, { name: 'cobblestone', count: 640, slot: 10 }])), '', 'D8: never')
  // cobbled_deepslate counts; 'stone' (not on every consumer list) does not
  assert.equal(names(W.disposePlan([{ name: 'granite', count: 20, slot: 9 }, { name: 'cobbled_deepslate', count: 64, slot: 10 }])), 'granite:20')
  assert.equal(names(W.disposePlan([{ name: 'granite', count: 20, slot: 9 }, { name: 'stone', count: 640, slot: 10 }])), '')
  // stacks are judged in slot order against what the earlier ones leave
  assert.equal(names(W.disposePlan([{ name: 'diorite', count: 40, slot: 9 }, { name: 'granite', count: 40, slot: 10 }, { name: 'cobblestone', count: 64, slot: 11 }])), 'diorite:40,granite:40')
  assert.equal(names(W.disposePlan([{ name: 'diorite', count: 40, slot: 9 }, { name: 'granite', count: 40, slot: 10 }, { name: 'cobblestone', count: 30, slot: 11 }])), 'diorite:40')
  assert.equal(W.disposableIn({ name: 'cobblestone', count: 64 }, [{ name: 'cobblestone', count: 640 }]), false, 'the guard never lists anything')
  assert.equal(W.guardLeft('white_stained_glass', 64, 0), 0, 'a plain decoration passes with any reserve')
  assert.equal(W.guardLeft('diorite', 10, 73), null)
  assert.equal(W.guardLeft('diorite', 10, 74), 64)
  assert.equal(W.guardLeft('mossy_cobblestone', 64, 64), 64)
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
  assert.match(W.wellDisposeDetail({ slotsBefore: 36, slotsAfter: 36 }), / gclicked=0 swords=0 sword_lost=0 sword_kept=0 cobble=0 offlist_items=/, 'no click, no reserve claim')
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
  // wellsite-01: a sand wall is refused only when it can fall (the cell under it is not ground); one resting on dirt holds
  assert.match(W.wellSiteRefusal(flatRead({ '4,63,0': B('sand'), '4,62,0': AIR }), cap, HOMEFAR), /wall is sand/)
  assert.equal(W.wellSiteRefusal(flatRead({ '4,63,0': B('sand') }), cap, HOMEFAR), null, 'a sand wall on dirt cannot fall: it is a wall')
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
const TOSS_SPEED = 0.3
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
      bot.entity.yaw = Math.atan2(-(p.x - eye.x), -(p.z - eye.z)); bot.entity.pitch = Math.atan2(p.y - eye.y, h)   // mineflayer's lookAt
      const pitch = Math.atan2(eye.y - p.y, h) * 180 / Math.PI, dir = { x: (p.x - eye.x) / h, z: (p.z - eye.z) / h }
      state.clientPitch = pitch
      // THE SERVER'S ROTATION (sandbox 10-08): a look the server drops (dropLooks) leaves the one it had
      if (state.dropLooks > 0) state.dropLooks--; else { state.lookPitch = pitch; state.lookDir = dir }
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
      const ph = state.lookPitch * Math.PI / 180
      // AS MINEFLAYER 4.37.1: entity.velocity is NOT set from spawn_entity (still zero at entitySpawn); the packet carries it
      const entity = { id, name: 'item', position: spawn, velocity: new Vec3(0, 0, 0), getDroppedItem: () => ({ name: served, count: it.count }) }
      bot.entities[id] = entity
      state.pending.push({ entity, rest, at: state.tick + 40, spawnTick: state.tick, name: it.name, count: it.count })
      bot.emit('entitySpawn', entity)
      // one tick of drag; the registry's protocol shape: lpVec3 (blocks/tick) from 1.21.9, vec3i16 (1/8000) before
      const lp = REG.version['>=']('1.21.9'), nv = k => (lp ? k * TOSS_SPEED * Math.cos(ph) * 0.98 : Math.round(k * TOSS_SPEED * Math.cos(ph) * 0.98 * 8000))
      if (state.foreignSpawn) for (const f of [...(ls.spawn_entity ?? [])]) f({ entityId: 99999, velocity: { x: 0, y: 0, z: 0 } })   // another entity's spawn
      for (const f of [...(ls.spawn_entity ?? [])]) f({ entityId: id, velocity: { x: nv(state.lookDir.x), y: lp ? -0.11 : -900, z: nv(state.lookDir.z) } })
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
      // CLICKING A TRAPDOOR TOGGLES IT (vanilla: an interactive block takes the use, no place happens)
      const rc = cell(ref.position)
      if (/_trapdoor$/.test(rc.name ?? '') && rc.props) { rc.props.open = !rc.props.open; state.events.push('toggle'); return }
      assert.ok(h, 'placing with an empty hand')
      assert.equal(cell(at).name, 'air', 'placing into a full cell')
      if (!/_trapdoor$/.test(h.name)) {   // a full block (the pit fill)
        assert.equal(REG.blocksByName[h.name]?.boundingBox, 'block', `placing ${h.name}, not a full block`)
        h.count--; if (!h.count) slots[h.slot] = null
        world.set(key(at), { name: h.name }); state.places.push(`${key(at)}:${h.name}`); return
      }
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
      if (name === 'look') {   // a raw look: the server takes it (notchian degrees: pitch down, yaw from -z clockwise)
        const yr = p.yaw * Math.PI / 180
        state.lookPitch = p.pitch; state.lookDir = { x: -Math.sin(yr), z: Math.cos(yr) }
      }
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
await t('SWORDS, a sword-only visit is contract evidence (Codex P2) -- but only a sword the well CLICKED (Codex, pk composition)', async () => {
  const town = peacefulTown([S('stone_sword', 1), S('egg', 16), ...filler(34)], 'peaceful')
  assert.equal((await run('dispose_well', town.bot)).status, 'success')
  const v = classifyOutcome('dispose_well', 'success', { inventory: { stone_sword: -1 } })
  assert.ok(JSON.stringify(v).includes('stone_sword'), 'clicked in a peaceful world: credited ' + JSON.stringify(v))
  const easy = peacefulTown([S('stone_sword', 1), S('egg', 16), ...filler(34)], 'easy')
  assert.equal((await run('dispose_well', easy.bot)).status, 'success')
  assert.equal(easy.count('stone_sword'), 1, 'positive control: the easy visit kept its sword')
  const u = classifyOutcome('dispose_well', 'success', { inventory: { stone_sword: -1, egg: -16 } })
  assert.ok(!JSON.stringify(u).includes('stone_sword'), 'a sword the well never clicked is not its evidence ' + JSON.stringify(u))
  assert.ok(JSON.stringify(u).includes('egg'), 'positive control: the junk still is')
})
await t('THE GRADE, sequential visits (Codex r2): a visit that never reaches its throw is graded on NONE of the last visit\'s clicks', async () => {
  const town = peacefulTown([S('stone_sword', 1), S('egg', 16), ...filler(34)], 'peaceful')
  assert.equal((await run('dispose_well', town.bot)).status, 'success')
  assert.ok(JSON.stringify(classifyOutcome('dispose_well', 'success', { inventory: { stone_sword: -1 } })).includes('stone_sword'), 'positive control: clicked')
  const later = peacefulTown([S('stone_sword', 1), S('egg', 16), ...filler(34)], 'peaceful')
  await run('dispose_well', later.bot, { aborted: true, addEventListener () {}, removeEventListener () {} }).catch(() => {})
  assert.equal(later.state.clicks.length, 0, 'positive control: the second visit threw nothing')
  assert.ok(!JSON.stringify(classifyOutcome('dispose_well', 'success', { inventory: { stone_sword: -1 } })).includes('stone_sword'), 'stale clicks graded a later visit')
})
await t('MUTANT (skills): without the reset at the visit\'s start, the last visit\'s clicks grade the next', async () => {
  await withMutant(SP, "  wellClickedLast = new Set()   // THIS visit's clicks only (Codex r2: a visit that aborts before its throw is graded on none)\n", '', async m => {
    const town = peacefulTown([S('stone_sword', 1), S('egg', 16), ...filler(34)], 'peaceful')
    await within(m.SKILLS.dispose_well.run({ bot: town.bot }, {}, { aborted: false }), 15000, 'mutant')
    const later = peacefulTown([S('stone_sword', 1), S('egg', 16), ...filler(34)], 'peaceful')
    await within(m.SKILLS.dispose_well.run({ bot: later.bot }, {}, { aborted: true, addEventListener () {}, removeEventListener () {} }), 15000, 'mutant').catch(() => {})
    assert.ok(JSON.stringify(m.classifyOutcome('dispose_well', 'success', { inventory: { stone_sword: -1 } })).includes('stone_sword'), 'mutant inert')
  })
})
await t('MUTANT (skills): the grade credits any sword loss (not only one the well clicked)', async () => {
  await withMutant(SP, '(isWellJunk(k) || ((isSword(k) || isWellCobble(k) || groupOf(k)) && wellClickedLast.has(k)))', '(isWellJunk(k) || isSword(k) || ((isWellCobble(k) || groupOf(k)) && wellClickedLast.has(k)))', async m => {
    const easy = peacefulTown([S('stone_sword', 1), S('egg', 16), ...filler(34)], 'easy')
    await within(m.SKILLS.dispose_well.run({ bot: easy.bot }, {}, { aborted: false }), 15000, 'mutant')
    assert.ok(JSON.stringify(m.classifyOutcome('dispose_well', 'success', { inventory: { stone_sword: -1 } })).includes('stone_sword'), 'mutant inert')
  })
})
// THE STRICT SWITCH UNDER EVERY FOOD_SKIP MODE (Claude review of the peacefulkit composition: the switch was only tested
// as a pure function). FOOD_SKIP is read once per process, so each mode runs the REAL wellSwordsNow in a child process.
import { spawnSync } from 'node:child_process'
const switchIn = (mode, modFile = new URL('../src/skills.mjs', import.meta.url).pathname) => {
  const code = `const m = await import(${JSON.stringify(modFile)}); console.log('RESULT ' + JSON.stringify(['easy', 'normal', 'hard', 'peaceful'].map(d => m.wellSwordsNow({ serverDifficulty: d, game: { difficulty: d } }))))`
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', code], { env: { ...process.env, FOOD_SKIP: mode }, encoding: 'utf8', timeout: 60_000 })
  const line = (r.stdout ?? '').split('\n').find(l => l.startsWith('RESULT '))
  assert.ok(line, `no result from the child (${mode}): ${(r.stderr ?? '').slice(-300)}`)
  return JSON.parse(line.slice(7))
}
await t('SWORDS, THE STRICT SWITCH in a real process: FOOD_SKIP=on in an easy/normal/hard world takes NO sword; peaceful does (auto and on)', () => {
  assert.deepEqual(switchIn('on'), [false, false, false, true], 'on')
  assert.deepEqual(switchIn('auto'), [false, false, false, true], 'auto')
  assert.deepEqual(switchIn('off'), [false, false, false, false], 'off: never')
})
await t('MUTANT (skills): the well switch as foodskip\'s own `active` throws swords with FOOD_SKIP=on in an easy world', async () => {
  const src = readFileSync(SP, 'utf8')
  const old = '  try { return swordSwitch(FOOD_SKIP.mode, difficultyOf(bot)) } catch { return false }\n'
  assert.equal(src.split(old).length, 2, 'the mutation target is present and unique')
  const out = new URL(`./_mutant-${process.pid}-sw.mjs`, import.meta.url)
  writeFileSync(out, src.replace(old, '  try { return foodSkipNow(bot).active } catch { return false }\n').replace(/from '\.\//g, "from '../src/"))
  try { assert.equal(switchIn('on', out.pathname)[0], true, 'mutant inert') } finally { try { unlinkSync(out) } catch {} }
})
await t('SWORDS, AT THE CLICK: the world turns easy during the aim -> the planned sword is not thrown', async () => {
  const town = peacefulTown([S('egg', 16), S('stone_sword', 1), ...filler(34)], 'peaceful')
  town.state.onLook = () => { if (town.state.clicks.length >= 1) town.bot.serverDifficulty = 'easy' }
  const r = await run('dispose_well', town.bot)
  assert.equal(r.status, 'success', r.detail)
  assert.equal(town.count('stone_sword'), 1, 'the switch re-read at the click kept it'); assert.equal(town.count('egg'), 0)
})

// ---- COBBLE AT THE TOWN CAP (stonecap-01 x junkwell-02): surplus whole stacks above the bot's 64, only when PROVEN at cap
const CCAP = await import('../src/cobblecap.mjs')
// cobblecap-1000: the town cobble cap from the one place it is written (1000; was 256). CO shifts the 256-era town counts
// below so each one keeps its relation to the cap (300 -> past it, 100 -> below it, 192 + 64 -> exactly it)
const COBBLE_CAP = CCAP.TOWN_COBBLE_CAP, CO = COBBLE_CAP - 256
const { townKey: CF_townKey } = await import('../src/chestfull.mjs')
// a REAL container holds the count (a counted cell that is loaded and not a container is `gone` and no longer counts: the
// cap's scan, skills.mjs townCobbleScan) -- a barrel under the town square
const townAt = (town, n) => {
  town.world.set('9,9,9', { name: 'barrel' })
  return CCAP.appendJournal(process.env.POOL_STATE_DIR, CF_townKey(HOME), town.bot.worldId ?? null, { t: 'obs', k: '9,9,9', n, cap: Date.now() })
}
await t('COBBLE, pure: cobbleWellStacks -- whole stacks, smallest first, the bag keeps 64; disposePlan takes them only with cobbleAtCap', () => {
  const bag = [{ name: 'cobblestone', count: 64, slot: 9 }, { name: 'cobblestone', count: 30, slot: 10 }, { name: 'cobblestone', count: 64, slot: 11 }, { name: 'egg', count: 16, slot: 12 }]
  assert.deepEqual(W.cobbleWellStacks(bag).map(s => s.count), [30, 64], '158 -> 94 go, 64 stay')
  assert.deepEqual(W.cobbleWellStacks([{ name: 'cobblestone', count: 64, slot: 9 }]), [], 'exactly the reserve: nothing')
  assert.deepEqual(W.disposePlan(bag).stacks.map(s => s.name), ['egg'], 'not at the cap: no cobble')
  assert.deepEqual(W.disposePlan(bag, { cobbleAtCap: true }).stacks.map(s => `${s.name}:${s.slot}`), ['cobblestone:9', 'cobblestone:10', 'egg:12'])
  // a guarded stone judged after the cobble never counts on it: diorite 40 + cobble [64, 64] at the cap -> one cobble stack
  // goes, the reserve stone left is 64 + 40 = 104, so the diorite (-> 64) still goes; with only one 64 cobble it would not
  const g = [{ name: 'diorite', count: 40, slot: 9 }, { name: 'cobblestone', count: 64, slot: 10 }, { name: 'cobblestone', count: 64, slot: 11 }]
  assert.deepEqual(W.disposePlan(g, { cobbleAtCap: true }).stacks.map(s => s.name), ['diorite', 'cobblestone'])
  assert.equal(W.thrownNames([{ name: 'cobblestone', count: 64 }]).offlist, 1, 'cobble thrown without the cap is OFF the list')
  assert.equal(W.thrownNames([{ name: 'cobblestone', count: 64 }], { cobble: 64 }).offlist, 0)
  assert.equal(W.thrownNames([{ name: 'cobblestone', count: 64 }, { name: 'cobblestone', count: 30 }], { cobble: 64 }).offlist, 1, 'listed only up to the count CLICKED')
})
await t('COBBLE, the skill: the town PROVEN at its cap (300 counted) -> surplus whole stacks go, 64 stay; the row says cobble=94 cobble_left=64 cap=at_cap', async () => {
  const town = fakeTown({ wellAt: CAP, items: [S('cobblestone', 64), S('cobblestone', 30), S('cobblestone', 64), S('egg', 16), ...Array.from({ length: 31 }, () => S('oak_log', 64))] })
  townAt(town, 300 + CO)
  const r = await run('dispose_well', town.bot)
  assert.equal(r.status, 'success', r.detail)
  assert.equal(town.count('cobblestone'), 64, 'the bot keeps exactly its reserve')
  const row = (await rows('_well_dispose')).pop()
  assert.equal(field(row.skill.detail, 'cobble'), '94', row.skill.detail); assert.equal(field(row.skill.detail, 'cobble_left'), '64'); assert.equal(field(row.skill.detail, 'cap'), 'at_cap')
  assert.equal(field(row.skill.detail, 'offlist'), '0')
  // THE GRADE (Codex, pk composition): cobble the well CLICKED at the cap is its evidence -- a cobble-only loss is not 'neutral'
  assert.ok(JSON.stringify(classifyOutcome('dispose_well', 'success', { inventory: { cobblestone: -94 } })).includes('cobblestone'))
})
await t('COBBLE, the grade: below the cap no cobble is clicked, so a cobble loss is not the well\'s evidence', async () => {
  const town = fakeTown({ wellAt: CAP, items: [S('cobblestone', 64), S('cobblestone', 30), S('egg', 16), ...Array.from({ length: 32 }, () => S('oak_log', 64))] })
  townAt(town, 100 + CO)
  assert.equal((await run('dispose_well', town.bot)).status, 'success')
  assert.equal(town.count('cobblestone'), 94, 'positive control: no cobble went')
  assert.equal(classifyOutcome('dispose_well', 'success', { inventory: { cobblestone: -30 } }).value, 'neutral')
})
await t('COBBLE, the skill: below the cap (100 counted, complete or not) or with no count -> no cobble goes; positive control: the egg does', async () => {
  for (const n of [100 + CO, null]) {
    const town = fakeTown({ wellAt: CAP, items: [S('cobblestone', 64), S('cobblestone', 30), S('egg', 16), ...Array.from({ length: 33 }, () => S('oak_log', 64))] })
    if (n != null) townAt(town, n)
    const r = await run('dispose_well', town.bot)
    assert.equal(r.status, 'success', `${n}: ${r.detail}`)
    assert.equal(town.count('cobblestone'), 94, `${n}: all cobble stays`); assert.equal(town.count('egg'), 0, 'positive control')
    assert.equal(field((await rows('_well_dispose')).pop().skill.detail, 'cobble'), '0')
  }
})
await t('COBBLE, AT THE CLICK: cobble spent during the aim (the reserve would break) -> the stack is not thrown', async () => {
  const town = fakeTown({ wellAt: CAP, items: [S('egg', 16), S('cobblestone', 30), S('cobblestone', 64), ...Array.from({ length: 33 }, () => S('oak_log', 64))] })
  townAt(town, 300 + CO)
  const big = town.slots.findIndex(x => x?.name === 'cobblestone' && x.count === 64)
  town.state.onLook = () => { if (town.slots[big]?.count === 64) town.slots[big] = { ...town.slots[big], count: 40 } }
  const r = await run('dispose_well', town.bot)
  assert.equal(r.status, 'success', r.detail)
  assert.equal(town.count('cobblestone'), 70, '30 + 40: the 30 would leave 40 < 64, so it stayed')
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
  const town = fakeTown({ items: [S('oak_trapdoor', 2), S('dirt', 1)], blocks, storeDir: dir })
  const r = await run('build_well', town.bot)
  assert.equal(r.status, 'success', r.detail); assert.equal(town.state.digs.length, 0); assert.ok(wellOk(town, CAP).floor)
})

// THE RAISED WELL (plinth-02; fleet 10-16: two finished plinths, 23 of 30 build_well visits failed "nowhere within 2 of the
// junk well's standing cell to put a crafting table", no well built). A k=3 plinth (P.plinthShell) on the flat town, its cap
// covered with dirt as the plinth leaves it, with the stair its planner gives it, the site recorded as the hand-off records it; the bag holds LOGS and dirt only --
// no trapdoor, no table. Expected: the table goes down within the craft's reach BELOW the stand, the trapdoors are crafted
// at it, the cover is dug, and the well reads built. MUTANT: the old table rule -> the fleet's failure, nothing built.
const raisedTown = async () => {
  const PL = await import('../src/plinth.mjs')
  const RC = { x: CAP.x, y: G0 + 3, z: CAP.z }
  const blocks = Object.fromEntries(PL.plinthShell(RC).map(c => [`${c.x},${c.y},${c.z}`, 'cobblestone']))
  blocks[`${RC.x},${RC.y},${RC.z}`] = 'dirt'
  // THE PLANNER'S STAIR (k=3 over flat ground: the ring top is 2 above the ground, so the plan carries a stair to the top)
  const shellRead = (x, y, z) => { const n = blocks[`${x},${y},${z}`] ?? (y > G0 ? 'air' : y === G0 ? 'grass_block' : 'dirt'); return n === 'air' ? { name: 'air', boundingBox: 'empty', shapes: [] } : { name: n, boundingBox: 'block', shapes: [[0, 0, 0, 1, 1, 1]] } }
  const stair = PL.stairOptions(shellRead, RC).find(o => o.length)
  assert.ok(stair, 'the planner offers a stair here')
  for (const c of stair) blocks[`${c.x},${c.y},${c.z}`] = 'cobblestone'
  const dir = mkdtempSync(path.join(tmpdir(), 'well-store-'))
  const Cm = await import('../src/composter.mjs')
  assert.ok(Cm.createSiteGen(dir, `junkwell-site-${HOME.x}_${HOME.y}_${HOME.z}`, 1, RC, null), 'the plinth hand-off recorded the site')
  const town = fakeTown({ items: [S('oak_log', 3), S('dirt', 4)], blocks, storeDir: dir })
  return { town, RC }
}
await t('RAISED WELL, NO TRAPDOORS CARRIED (plinth-02): the table goes below the stand within reach, the trapdoors are crafted, the cover dug, the well built', async () => {
  const { town, RC } = await raisedTown()
  assert.equal(W.wellSiteRefusal(homeRead(town), RC, HOME, { avoid: [] }), null, 'the plinth passes the oracle')
  const st = W.wellStand(homeRead(town), RC)
  const C2 = await import('../src/composter.mjs')
  assert.equal(C2.tableCellFor({ site: { x: RC.x, y: st.stand.y, z: RC.z }, stand: st.stand, read: homeRead(town) }), null, 'POSITIVE CONTROL: the old rule finds no cell here')
  const r = await run('build_well', town.bot)
  assert.equal(r.status, 'success', r.detail)
  const id = wellOk(town, RC)
  assert.ok(id.ok && !id.open && id.floor, JSON.stringify(id))
  const table = [...town.world].find(([, v]) => v.name === 'crafting_table')
  assert.ok(table, 'a table was put down'); const [tx, ty, tz] = table[0].split(',').map(Number)
  assert.ok(ty < st.stand.y, `below the stand: ${table[0]}`)
  assert.ok(Math.max(Math.abs(tx - RC.x), Math.abs(tz - RC.z)) >= 2, 'never the well\'s 3x3')
  assert.ok(town.state.events.includes('craft:oak_trapdoor'))
  assert.ok((await rows('_well_built')).some(x => field(x.skill.detail, 'at') === `${RC.x},${RC.y},${RC.z}`), 'the _well_built row at the plinth cap (the canary\'s exposure)')
})
await t('MUTANT (skills): the old table rule on a raised well -> no table cell (the fleet\'s failure), nothing built', async () => {
  // townplan-01 (re-anchored): the two-tier call over the same wellTableCell arguments
  const old = "        const cell = wellTableCell({ ...tableArgs, tableForbid: wellStrict }) ?? wellTableCell({ ...tableArgs, tableForbid: wellLoose })\n"
  const neu = "        const cell = tableCellFor({ site: { x: site.x, y: stand.y, z: site.z }, stand, read: readCell(bot), bodies: bodiesAround(bot) })\n"
  await withMutant(SP, old, neu, async m => {
    const { town, RC } = await raisedTown()
    const r = await within(m.SKILLS.build_well.run({ bot: town.bot }, {}, { aborted: false }), 15000, 'build')
    assert.equal(r.status, 'failed'); assert.match(r.detail, /nowhere within reach of the junk well's standing cell to put a crafting table/)
    assert.equal(wellOk(town, RC).ok, false)
  })
})

await t('BUILD never digs with someone at the site', async () => {
  const town = fakeTown({ items: [S('oak_trapdoor', 2), S('dirt', 1)], players: { 'b-Bravo': { x: CAP.x + 0.5, y: CAP.y + 1, z: CAP.z + 2.5 } } })
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
  const town = fakeTown({ items: [S('oak_trapdoor', 2), S('dirt', 1)], storeDir: dir })
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
  await withMutant(SP, "    if (['fresh', 'half_dug', 'covered', 'covered_floored'].includes(stage())) await settleRecord()\n", '', async m => {
    const dir = mkdtempSync(path.join(tmpdir(), 'well-store-'))
    const C = await import('../src/composter.mjs')
    const key = `junkwell-site-${HOME.x}_${HOME.y}_${HOME.z}`
    assert.ok(C.createSiteGen(dir, key, 1, CAP, null))
    const fresh = Date.now() + 800
    fsMod.utimesSync(path.join(dir, `${key}.g1.json`), fresh / 1000, fresh / 1000)
    const town = fakeTown({ items: [S('oak_trapdoor', 2), S('dirt', 1)], storeDir: dir })
    let firstDig = null
    const dig0 = town.bot.dig; town.bot.dig = async b => { firstDig ??= Date.now(); return dig0(b) }
    await within(m.SKILLS.build_well.run({ bot: town.bot }, {}, { aborted: false }), 15000, 'mutant')
    assert.ok(firstDig !== null && firstDig < fresh, 'mutant inert')
  })
})
await t('MUTANT (skills): throwing into a breached well (#6 killed) -- the entry check, the stand re-check and the click re-check (wellsite-01) all removed', async () => {
  await withMutants(SP, [["  if (well.breach) return skip('breached',", "  if (false) return skip('breached',"],
                         ['      if (sealed) { out.refused = \'breached\'; out.stop = sealed; return out }', '      if (false) { out.refused = \'breached\'; out.stop = sealed; return out }'],
                         ['      if (unsealed) { acc.stop = `breached: ${unsealed}`; break }\n', '']], async m => {
    const town = fakeTown({ wellAt: CAP, items: [S('egg', 16), ...filler(34)], blocks: { [`${CAP.x + 1},${CAP.y - 1},${CAP.z}`]: 'air' } })
    await within(m.SKILLS.dispose_well.run({ bot: town.bot }, {}, { aborted: false }), 15000, 'mutant')
    assert.ok(town.state.clicks.length > 0, 'mutant inert')
  })
})
await t('wellsite-01 DEFENCE IN DEPTH: with the entry check removed, the stand re-check alone still throws nothing into a breached well', async () => {
  await withMutant(SP, "  if (well.breach) return skip('breached',", "  if (false) return skip('breached',", async m => {
    const town = fakeTown({ wellAt: CAP, items: [S('egg', 16), ...filler(34)], blocks: { [`${CAP.x + 1},${CAP.y - 1},${CAP.z}`]: 'air' } })
    const r = await within(m.SKILLS.dispose_well.run({ bot: town.bot }, {}, { aborted: false }), 15000, 'mutant')
    assert.equal(town.state.clicks.length, 0, 'thrown into a breached well'); assert.equal(town.state.activations.length, 0, 'the cap was opened')
    assert.equal(r.status, 'no_effect'); assert.match(r.detail, /read unsealed at the stand \(wall is air\)/)
  })
})

// ---- wellsite-01 (10-13): a supported sand wall, the stand re-check, the exhausted search, one retirement row ----------
const steadyTown = (extra = {}, o = {}) => fakeTown({ wellAt: CAP, items: [S('egg', 16), ...filler(34)], blocks: { [`${CAP.x + 1},${CAP.y},${CAP.z + 1}`]: 'sand', ...extra }, ...o })
await t('wellsite-01 A SUPPORTED SAND WALL IS A WELL (placebo-b 10-12): sand on dirt beside the cap -- not breached, disposed into; positive control: the same sand over air is a breach', async () => {
  const { townWellState } = await import('../src/skills.mjs')
  const town = steadyTown()
  assert.equal(townWellState(town.bot).breached, false)
  const r = await run('dispose_well', town.bot)
  assert.equal(r.status, 'success', r.detail); assert.equal(town.count('egg'), 0)
  const loose = steadyTown({ [`${CAP.x + 1},${CAP.y - 1},${CAP.z + 1}`]: 'air' })
  assert.equal(townWellState(loose.bot).breached, true, 'positive control: sand that can fall is no wall')
})
await t('wellsite-01 THE STAND RE-CHECK (Codex r1 P1): the sand wall\'s support dug away during the visit (after the entry check, before the throw) -- nothing thrown, cap never opened, a named skip', async () => {
  const town = steadyTown()
  let dug = false
  town.state.onResync = () => { if (!dug) { dug = true; town.world.set(`${CAP.x + 1},${CAP.y - 1},${CAP.z + 1}`, { name: 'air' }) } }
  const r = await run('dispose_well', town.bot)
  assert.ok(dug, 'positive control: the support was dug inside the visit')
  assert.equal(r.status, 'no_effect', r.detail); assert.match(r.detail, /read unsealed at the stand \(wall is sand\)/)
  assert.equal(town.state.clicks.length, 0); assert.equal(town.state.activations.length, 0)
  assert.equal(town.count('egg'), 16)
  const row = (await rows('_well_refused')).pop()
  assert.match(row.skill.detail, /^order=dispose reason=breached at=/)
})
await t('wellsite-01 THE CLICK RE-CHECK (Codex r2 P1): the support dug during the AIM (after the cap opened) -- no stack clicked, the cap closed, a named no_effect', async () => {
  const town = steadyTown()
  let dug = false
  town.state.onLook = () => { if (!dug) { dug = true; town.world.set(`${CAP.x + 1},${CAP.y - 1},${CAP.z + 1}`, { name: 'air' }) } }
  const r = await run('dispose_well', town.bot)
  assert.ok(dug, 'positive control: dug inside the aim'); assert.ok(town.state.activations.length > 0, 'positive control: the cap had opened (the stand check passed)')
  assert.equal(town.state.clicks.length, 0, 'thrown into an unsealed shaft'); assert.equal(town.count('egg'), 16)
  assert.equal(r.status, 'no_effect', r.detail); assert.match(r.detail, /unsealed at the click \(wall is sand\)/)
  assert.equal(town.world.get(town.key(CAP)).props.open, false, 'the cap was left open')
})
await t('wellsite-01 THE DIG-CLICK GAP WAITED TO THE END (Codex r3 P1): a dig renewed during the wait -- the click comes a whole gap after the LATEST dig', async () => {
  const town = steadyTown()
  let gapAtClick = null, renewed = false
  town.state.onLook = () => { if (town.bot.lastDigTime == null) { town.bot.lastDigTime = Date.now(); setTimeout(() => { renewed = true; town.bot.lastDigTime = Date.now() }, 300) } }
  town.state.onClick = async () => { if (gapAtClick == null) gapAtClick = Date.now() - town.bot.lastDigTime }
  const r = await run('dispose_well', town.bot)
  assert.equal(r.status, 'success', r.detail); assert.ok(renewed, 'positive control: the dig was renewed inside the wait')
  assert.ok(gapAtClick >= 540, `clicked ${gapAtClick} ms after the latest dig`)
})
await t('MUTANT (skills): a one-shot dig-gap wait clicks inside a renewed gap', async () => {
  await withMutant(SP, '        if (++digWaits > DIG_CLICK_MAX_WAITS) break\n        await sleep(DIG_CLICK_GAP_MS - sinceDig, signal)\n', '        if (++digWaits > DIG_CLICK_MAX_WAITS) break\n        await sleep(DIG_CLICK_GAP_MS - sinceDig, signal)\n        break\n', async m => {
    const town = steadyTown()
    let gapAtClick = null
    town.state.onLook = () => { if (town.bot.lastDigTime == null) { town.bot.lastDigTime = Date.now(); setTimeout(() => { town.bot.lastDigTime = Date.now() }, 300) } }
    town.state.onClick = async () => { if (gapAtClick == null) gapAtClick = Date.now() - town.bot.lastDigTime }
    await within(m.SKILLS.dispose_well.run({ bot: town.bot }, {}, { aborted: false }), 15000, 'mutant')
    assert.ok(gapAtClick != null && gapAtClick < 540, `mutant inert (${gapAtClick})`)
  })
})
await t('MUTANT (skills): without the click re-check a support dug during the aim is thrown past', async () => {
  await withMutant(SP, '      if (unsealed) { acc.stop = `breached: ${unsealed}`; break }\n', '', async m => {
    const town = steadyTown()
    let dug = false
    town.state.onLook = () => { if (!dug) { dug = true; town.world.set(`${CAP.x + 1},${CAP.y - 1},${CAP.z + 1}`, { name: 'air' }) } }
    await within(m.SKILLS.dispose_well.run({ bot: town.bot }, {}, { aborted: false }), 15000, 'mutant')
    assert.ok(town.state.clicks.length > 0, 'mutant inert')
  })
})
await t('MUTANT (skills): without the stand re-check the cap OPENS over a shaft whose support went during the resync (the click re-check still throws nothing)', async () => {
  await withMutant(SP, '      if (sealed) { out.refused = \'breached\'; out.stop = sealed; return out }', '', async m => {
    const town = steadyTown()
    let dug = false
    town.state.onResync = () => { if (!dug) { dug = true; town.world.set(`${CAP.x + 1},${CAP.y - 1},${CAP.z + 1}`, { name: 'air' }) } }
    await within(m.SKILLS.dispose_well.run({ bot: town.bot }, {}, { aborted: false }), 15000, 'mutant')
    assert.ok(town.state.activations.length > 0, 'mutant inert')
    assert.equal(town.state.clicks.length, 0, 'the click re-check, unmutated, still holds')
  })
})
// THE EXHAUSTED SEARCH: every column of rings 7..14 has air two below its ground (the floor), so no cell passes
const noFloor = () => { const b = {}; for (let dx = -14; dx <= 14; dx++) for (let dz = -14; dz <= 14; dz++) if (Math.max(Math.abs(dx), Math.abs(dz)) >= 7) b[`${HOME.x + dx},${G0 - 2},${HOME.z + dz}`] = 'air'; return b }
await t('wellsite-01 AN EXHAUSTED SEARCH: no_effect with failClass well_no_site, one _well_refused reason=no_site row with tally= first (inside 300); every column counted', async () => {
  const town = fakeTown({ items: [S('oak_trapdoor', 2), S('dirt', 1)], blocks: noFloor() })
  const r = await run('build_well', town.bot)
  assert.equal(r.status, 'no_effect', r.detail); assert.equal(r.failClass, 'well_no_site')
  const row = (await rows('_well_refused')).pop()
  assert.match(row.skill.detail, /^order=build reason=no_site tally=cols:672,\S* rec=ok w=/, row.skill.detail)
  assert.ok(row.skill.detail.length <= 300)
  const tally = Object.fromEntries(field(row.skill.detail, 'tally').split(',').map(kv => kv.split(':')).map(([k, v]) => [k, Number(v)]))
  assert.equal(Object.entries(tally).filter(([k]) => k !== 'cols').reduce((a, [, v]) => a + v, 0), tally.cols, 'every column has one class')
  assert.ok(tally.floor > 0, 'the floor rule refused them')
  // the scheduler holds the build order for WELL_NO_SITE_BACKOFF_MS
  assert.equal(W.wellOrderOutcome('build_well', r.status, NOW, {}, r.failClass).buildBackoffUntil, NOW + W.WELL_NO_SITE_BACKOFF_MS)
})
await t('wellsite-01 THE TOWN REMEMBERS (reconnect-proof): A searches in vain -> a record; B of the same pool is held without a search (few cells read); the record aged out, or from another world, B searches', async () => {
  const store = mkdtempSync(path.join(tmpdir(), 'well-store-'))
  const a = fakeTown({ storeDir: store, items: [S('oak_trapdoor', 2), S('dirt', 1)], blocks: noFloor() })
  assert.equal((await run('build_well', a.bot)).failClass, 'well_no_site')
  const { readWellNoSite } = await import('../src/skills.mjs')
  const rec = readWellNoSite()
  assert.ok(rec && Number.isFinite(rec.at), 'no record written'); assert.match(rec.tally, /^cols:672,/)
  const counted = town => { let n = 0; const f = town.bot.blockAt; town.bot.blockAt = p => { n++; return f(p) }; return () => n }
  const b = fakeTown({ storeDir: store, items: [S('oak_trapdoor', 2), S('dirt', 1)], blocks: noFloor() })
  // THE SCHEDULER issues no build order while the town holds (townWellBuildPlan null), on a fresh CognitiveLoop too
  const { townWellBuildPlan } = await import('../src/skills.mjs')
  assert.equal(townWellBuildPlan(b.bot), null, 'the held town still offered a build plan')
  const bOrder = W.wellOrder({ now: Date.now(), distHome: 3, slots: 10, freeSlots: 26, well: null, buildPlan: () => townWellBuildPlan(b.bot), myName: 'b', peers: [], state: {} })
  assert.equal(bOrder.order, null, 'a held town was ordered to build')
  // an order that got through anyway (the instant before the record landed): a FREE skip, no search
  const nb = counted(b)
  const rb = await run('build_well', b.bot)
  assert.equal(rb.status, 'no_effect'); assert.equal(rb.failClass, undefined, 'a held skip must not push the bot past the record'); assert.match(rb.detail, /no search for \d+ min more/)
  assert.ok(nb() < 2000, `the held build read ${nb()} cells: it searched`)
  assert.match((await rows('_well_refused')).pop().skill.detail, /^order=build reason=no_site_held /)
  // aged out: the next order searches (and records again)
  writeFileSync(path.join(store, readdirSync(store).find(f => f.startsWith('junkwell-nosite-'))), JSON.stringify({ ...rec, at: Date.now() - W.WELL_NO_SITE_BACKOFF_MS - 1 }))
  const c = fakeTown({ storeDir: store, items: [S('oak_trapdoor', 2), S('dirt', 1)], blocks: noFloor() })
  assert.equal(townWellBuildPlan(c.bot)?.carried, true, 'positive control: aged out, the plan is offered again')
  const nc = counted(c)
  assert.equal((await run('build_well', c.bot)).failClass, 'well_no_site')
  assert.ok(nc() > 10000, `positive control: an aged record lets the search run (${nc()} cells)`)
  assert.match((await rows('_well_refused')).pop().skill.detail, /^order=build reason=no_site tally=/)
  // another world (a reseed keeps the pool and home): not held
  writeFileSync(path.join(store, readdirSync(store).find(f => f.startsWith('junkwell-nosite-'))), JSON.stringify({ ...rec, at: Date.now(), world: 'old-world' }))
  const d = fakeTown({ storeDir: store, items: [S('oak_trapdoor', 2), S('dirt', 1)], blocks: noFloor() })
  d.bot.worldId = 'new-world'
  const nd = counted(d)
  await run('build_well', d.bot)
  assert.ok(nd() > 10000, 'a record from another world held the build')
})
await t('MUTANT (skills): the scheduler\'s plan ignores the town record -- a held town is ordered to build again', async () => {
  await withMutant(SP, '  if (noSiteHold({ record: readWellNoSite(), now: Date.now(), world: bot.worldId ?? null }).held) return null\n', '', async m => {
    const store = mkdtempSync(path.join(tmpdir(), 'well-store-'))
    const a = fakeTown({ storeDir: store, items: [S('oak_trapdoor', 2), S('dirt', 1)], blocks: noFloor() })
    await within(m.SKILLS.build_well.run({ bot: a.bot }, {}, { aborted: false }), 15000, 'mutant')
    const b = fakeTown({ storeDir: store, items: [S('oak_trapdoor', 2), S('dirt', 1)], blocks: noFloor() })
    assert.ok(m.townWellBuildPlan(b.bot), 'mutant inert')
  })
})
await t('MUTANT (skills): the town record not consulted inside the build -- a raced order searches again', async () => {
  await withMutant(SP, '  if (hold.held) {\n    return skip(\'no_site_held\',', '  if (false) {\n    return skip(\'no_site_held\',', async m => {
    const store = mkdtempSync(path.join(tmpdir(), 'well-store-'))
    const a = fakeTown({ storeDir: store, items: [S('oak_trapdoor', 2), S('dirt', 1)], blocks: noFloor() })
    await within(m.SKILLS.build_well.run({ bot: a.bot }, {}, { aborted: false }), 15000, 'mutant')
    const b = fakeTown({ storeDir: store, items: [S('oak_trapdoor', 2), S('dirt', 1)], blocks: noFloor() })
    await within(m.SKILLS.build_well.run({ bot: b.bot }, {}, { aborted: false }), 15000, 'mutant')
    assert.match((await rows('_well_refused')).pop().skill.detail, /reason=no_site tally=/, 'mutant inert')
  })
})
await t('wellsite-01 A DEFERRAL IS NOT EXHAUSTED: one unloaded cell in the first ring -- reason=site_deferred, no failClass, no backoff', async () => {
  const town = fakeTown({ items: [S('oak_trapdoor', 2), S('dirt', 1)], blocks: noFloor(), unloaded: [`${HOME.x - 7},${G0},${HOME.z - 7}`, `${HOME.x + 7},${G0},${HOME.z - 7}`, `${HOME.x - 7},${G0},${HOME.z + 7}`, `${HOME.x + 7},${G0},${HOME.z + 7}`] })
  const r = await run('build_well', town.bot)
  assert.equal(r.status, 'no_effect', r.detail); assert.equal(r.failClass, undefined)
  assert.match((await rows('_well_refused')).pop().skill.detail, /^order=build reason=site_deferred .*unknown cell/)
  assert.equal(W.wellOrderOutcome('build_well', r.status, NOW, {}, r.failClass ?? null).buildBackoffUntil ?? 0, 0)
})
await t('MUTANT (skills): every missing site called exhausted backs a deferral off for two hours', async () => {
  await withMutant(SP, '  if (!site && exhausted) {', '  if (!site) {', async m => {
    const town = fakeTown({ items: [S('oak_trapdoor', 2), S('dirt', 1)], blocks: noFloor(), unloaded: [`${HOME.x - 7},${G0},${HOME.z - 7}`, `${HOME.x + 7},${G0},${HOME.z - 7}`, `${HOME.x - 7},${G0},${HOME.z + 7}`, `${HOME.x + 7},${G0},${HOME.z + 7}`] })
    const r = await within(m.SKILLS.build_well.run({ bot: town.bot }, {}, { aborted: false }), 15000, 'mutant')
    assert.equal(r.failClass, 'well_no_site', 'mutant inert')
  })
})
await t('wellsite-01 ONE RETIREMENT ROW per well and reason per bot: two builds past a breached well write one row; a fresh bot one more; the well read sealed again and re-breached, one more', async () => {
  const breached = { [`${CAP.x + 1},${CAP.y - 1},${CAP.z}`]: 'air' }
  const town = fakeTown({ wellAt: CAP, items: [S('dirt', 1)], blocks: breached })
  const n0 = (await rows('_well_retired')).length
  const b1 = await run('build_well', town.bot); await run('build_well', town.bot)
  assert.match(b1.detail, /wood|planks|log/i, 'positive control: the build got past the retirement loop (to the wood check)')
  assert.equal((await rows('_well_retired')).length, n0 + 1, 'two builds, one row')
  const other = fakeTown({ wellAt: CAP, items: [S('dirt', 1)], blocks: breached })
  await run('build_well', other.bot)
  assert.equal((await rows('_well_retired')).length, n0 + 2, 'another bot says it once too')
  town.world.set(`${CAP.x + 1},${CAP.y - 1},${CAP.z}`, { name: 'dirt' })
  assert.match((await run('build_well', town.bot)).detail, /already has a junk well/, 'positive control: sealed again')
  town.world.set(`${CAP.x + 1},${CAP.y - 1},${CAP.z}`, { name: 'air' })
  await run('build_well', town.bot)
  assert.equal((await rows('_well_retired')).length, n0 + 3, 'breached again after reading sealed: said again')
})
await t('MUTANT (skills): without the once-per-well log every build re-says the retirement', async () => {
  await withMutant(SP, '    if (!retiredSaid(bot).say(w.cap, why)) continue\n', '', async m => {
    const town = fakeTown({ wellAt: CAP, items: [S('dirt', 1)], blocks: { [`${CAP.x + 1},${CAP.y - 1},${CAP.z}`]: 'air' } })
    const n0 = (await rows('_well_retired')).length
    for (let i = 0; i < 2; i++) await within(m.SKILLS.build_well.run({ bot: town.bot }, {}, { aborted: false }), 15000, 'mutant')
    assert.ok((await rows('_well_retired')).length > n0 + 1, 'mutant inert')
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
  const town = fakeTown({ items: [S('oak_trapdoor', 2), S('dirt', 1)], storeDir: dir })
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
  await withMutant(WP, "    if (!isWellJunk(t.name) && !swordOk && !cobbleOk && !stockOk) {", "    if (false) {", async m => {
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
  const town = fakeTown({ items: [S('oak_trapdoor', 2), S('dirt', 1)] })
  town.bot._placeBlockWithOptions = async () => { throw new Error('placement refused') }
  const r = await run('build_well', town.bot)
  assert.equal(r.status, 'failed')
  const row = (await rows('_well_pit_open')).pop()
  assert.ok(row, 'no pit row'); assert.match(row.skill.detail, new RegExp(`at=${CAP.x},${CAP.y},${CAP.z} stage=dug`))
})
// ---- THE AIM SAID AGAIN (sandbox 10-08: the server dropped the aim look in 12 of 12 pit-first throws) -----------------
await t('AIM, pure: the packet velocity in both protocol shapes; the calibrated band at the 0.04 tolerance', () => {
  assert.deepEqual(W.packetVelocity({ x: 0, y: -900, z: 1544 }, false), { vx: 0, vz: 0.193 }, '1.21.8 vec3i16: 1/8000 units')
  assert.deepEqual(W.packetVelocity({ x: 0, y: -0.11, z: 0.193 }, true), { vx: 0, vz: 0.193 }, '1.21.9+ lpVec3: blocks per tick')
  assert.equal(W.packetVelocity(null, false), null)
  // the sandbox traces 10-08 (1.21.8): applied 0.180-0.211 at 49.95, dropped 0.085-0.111 (thrown at 72.15)
  for (const h of [0.180, 0.1836, 0.193, 0.2066, 0.211]) assert.equal(W.aimApplied({ vx: 0, vz: h, pitchDeg: 49.95 }), true, `applied ${h}`)
  for (const h of [0.085, 0.0951, 0.111]) assert.equal(W.aimApplied({ vx: 0, vz: h, pitchDeg: 49.95 }), false, `dropped ${h}`)
})
await t('AIM, pure: the spawn velocity says which pitch the server threw at', () => {
  const v = p => ({ vx: 0, vz: 0.3 * Math.cos(p * Math.PI / 180) })
  assert.equal(W.aimApplied({ ...v(49.95), pitchDeg: 49.95 }), true)
  assert.equal(W.aimApplied({ vx: 0.019, vz: v(49.95).vz, pitchDeg: 49.95 }), true, 'within the 0.02 kick')
  assert.equal(W.aimApplied({ ...v(72.15), pitchDeg: 49.95 }), false, 'the sandbox miss: thrown at the dig look')
  assert.equal(W.aimApplied({ vx: 0, vz: 0.1085, pitchDeg: 49.95 }), false, 'the traced spawn velocity of a miss (868/8000)')
  assert.equal(W.aimApplied({ vx: undefined, vz: 0.1, pitchDeg: 50 }), null)
})
const dropScene = () => {
  const town = fakeTown({ hand: S('cobblestone', 64), items: [S('oak_log', 3), S('egg', 16), S('egg', 16), S('flint', 64), ...filler(31)] })
  // AS TRACED: the server holds the dig look (72.15, toward the pit) and drops the FIRST look after the pit's second dig
  const dig = town.bot.dig
  town.bot.dig = async (b, ...a) => {
    await dig(b, ...a)
    if (town.state.digs.length >= 2 && !town.state.armed) { town.state.armed = true; town.state.lookPitch = 72.15; town.state.lookDir = { x: 0, z: 1 }; town.state.dropLooks = 1 }
  }
  return town
}
await t('AIM: the server drops the aim look -- the aim said again lands the pit-first throw (no miss, aim_off=0, the well built)', async () => {
  const town = dropScene()
  const n0 = (await rows('_well_dispose')).length
  const r = await run('build_well', town.bot)
  assert.equal(r.status, 'success', r.detail)
  const pits = (await rows('_well_dispose')).slice(n0).filter(x => /stop=pit_first/.test(x.skill.detail))
  assert.equal(pits.length, 1, 'one phase: the first throw landed')
  const pit = pits[0]
  assert.equal(field(pit.skill.detail, 'misses'), '0'); assert.equal(field(pit.skill.detail, 'aim_off'), '0')
  assert.ok(Number(field(pit.skill.detail, 'aim_read')) >= 1, 'positive control: the receipt was read (from the spawn PACKET -- mineflayer leaves entity.velocity at zero)')
  assert.ok(town.state.writes.filter(w => w.name === 'look').length >= 2, 'positive control: the look was written again')
})
await t('MUTANT (skills): without the aim said again, the dropped look throws at the dig pitch: a miss, aim_off=1', async () => {
  await withMutant(SP, '      await waitTick(); resendLook(bot); await waitTick(); resendLook(bot); await waitTick()\n', '      await waitTick(); await waitTick()\n', async m => {
    const town = dropScene()
    const n0 = (await rows('_well_dispose')).length
    await within(m.SKILLS.build_well.run({ bot: town.bot }, {}, { aborted: false }), 15000, 'mutant')
    const pit = (await rows('_well_dispose')).slice(n0).filter(x => /stop=pit_first/.test(x.skill.detail))[0]   // the FIRST phase
    assert.ok(Number(field(pit.skill.detail, 'misses')) >= 1, 'mutant inert: ' + pit.skill.detail); assert.equal(field(pit.skill.detail, 'aim_off'), '1')
  })
})
await t('MUTANT (skills): the receipt read from entity.velocity (Claude r1: mineflayer never sets it at spawn) counts every landed throw as aim_off', async () => {
  await withMutant(SP, '    const v = packetVelocity(pk.velocity, lpVec3)\n', '    const v = (e => e && { vx: e.velocity.x, vz: e.velocity.z })(acc.spawned.find(e => e.id === pk?.entityId))\n', async m => {
    const town = dropScene()
    const n0 = (await rows('_well_dispose')).length
    await within(m.SKILLS.build_well.run({ bot: town.bot }, {}, { aborted: false }), 15000, 'mutant')
    const pit = (await rows('_well_dispose')).slice(n0).filter(x => /stop=pit_first/.test(x.skill.detail))[0]
    assert.equal(field(pit.skill.detail, 'misses'), '0', 'positive control: the throw landed')
    assert.notEqual(field(pit.skill.detail, 'aim_off'), '0', 'mutant inert')
  })
})
// ---- AN ABANDONED BUILD NEVER LEAVES AN OPEN PIT (coordinator 10-08; Codex r1 + Claude r1 on the fill) ----------------
const pitCells = town => [town.cell(new Vec3(CAP.x, CAP.y - 1, CAP.z)).name, town.cell(new Vec3(CAP.x, CAP.y, CAP.z)).name]
const giveUpScene = (extra = []) => {
  const town = fakeTown({ hand: S('cobblestone', 64), items: [S('oak_log', 3), S('egg', 16), S('egg', 16), S('flint', 64), ...extra, ...filler(31 - extra.length)] })
  town.state.missNext = 99   // every pit-first toss misses: the build gives up after WELL_PIT_PHASES
  return town
}
const recordSite = async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'well-store-'))
  const C = await import('../src/composter.mjs')
  assert.ok(C.createSiteGen(dir, `junkwell-site-${HOME.x}_${HOME.y}_${HOME.z}`, 1, CAP, null))
  return dir
}
const FLOOR_TD = () => ({ name: 'oak_trapdoor', props: { half: 'bottom', open: false, facing: 'north', powered: false, waterlogged: false } })
const newRows = async (kind, n0) => (await rows(kind)).slice(n0)
const counts = async () => ({ open: (await rows('_well_pit_open')).length, covered: (await rows('_well_pit_covered')).length })

await t('COVER, pure: the cover block (never junk, never the reserve, never too hard to dig out); the covered stages', () => {
  assert.equal(W.pitCoverItem([S('cobblestone', 64), S('dirt', 1)]), 'dirt', 'a plain block before cobblestone')
  assert.equal(W.pitCoverItem([S('cobblestone', 64)]), null, '64 cobblestone is the reserve: none to spare')
  assert.equal(W.pitCoverItem([S('cobblestone', 65)]), 'cobblestone', 'the 65th is spare')
  assert.equal(W.pitCoverItem([S('cobblestone', 40), S('cobbled_deepslate', 25)]), 'cobblestone', 'both count to the reserve')
  assert.equal(W.pitCoverItem([S('cobblestone', 64), S('granite', 64)]), null, 'granite is junk the pit-first throw may take: not counted')
  assert.equal(W.pitCoverItem([S('diorite', 3), S('iron_ore', 9), S('sand', 64), S('chest', 1), S('deepslate', 64), S('cobbled_deepslate', 64)]), null,
    'never junk, an ore, a falling block, a container, or a block harder than MAX_DIG_HARDNESS')
  const cap = { x: 5, y: 63, z: 0 }
  for (const n of W.PIT_COVER_BLOCKS) {
    assert.equal(W.isWellJunk(n), false, `${n} is junk the well throws`)
    assert.ok(REG.blocksByName[n].hardness <= W.MAX_DIG_HARDNESS, `${n} cannot be dug out by the next build`)
    assert.equal(W.wellStage(flatRead({ [`5,63,0`]: B(n), '5,62,0': AIR }), cap), 'covered', `${n} over an open shaft`)
    assert.equal(W.wellStage(flatRead({ [`5,63,0`]: B(n), '5,62,0': TD('bottom') }), cap), 'covered_floored', `${n} over the floor trapdoor`)
  }
  assert.equal(W.trapdoorsNeeded('covered'), 2); assert.equal(W.trapdoorsNeeded('covered_floored'), 1)
  assert.equal(W.wellSiteRefusal(flatRead({ '5,63,0': B('dirt'), '5,62,0': AIR }), cap, HOMEFAR), null, 'a covered pit is a site a build resumes')
  assert.ok(W.wellSiteRefusal(flatRead({ '5,63,0': B('dirt'), '5,62,0': AIR, '5,61,0': AIR }), cap, HOMEFAR), 'positive control: a covered column with no floor is refused')
})
await t('COVER, pure: what it is placed against (never a trapdoor; across from the stand first) and the body check', () => {
  const cap = { x: 5, y: 63, z: 0 }, stand = { x: 5, y: 64, z: -1 }
  assert.deepEqual(W.coverRef(flatRead({ '5,63,0': AIR }), cap, stand), { ref: { x: 5, y: 62, z: 0 }, face: { x: 0, y: 1, z: 0 } }, 'half_dug: the block under')
  assert.deepEqual(W.coverRef(flatRead({ '5,63,0': AIR, '5,62,0': AIR }), cap, stand), { ref: { x: 5, y: 63, z: 1 }, face: { x: 0, y: 0, z: -1 } }, 'dug: the wall across from the stand')
  assert.deepEqual(W.coverRef(flatRead({ '5,63,0': AIR, '5,62,0': TD('bottom'), '5,63,1': AIR }), cap, stand).ref, { x: 6, y: 63, z: 0 }, 'floored: a side wall, never the trapdoor')
  assert.equal(W.coverRef(flatRead({ '5,62,0': TD('bottom'), '6,63,0': AIR, '4,63,0': AIR, '5,63,1': AIR, '5,63,-1': AIR }), cap, stand), null)
  const P = (name, x, y, z, extra = {}) => ({ name, position: new Vec3(x, y, z), ...extra })
  assert.equal(W.bodyInPit([P('player', 5.5, 62, 0.5, { username: 'b-Fallen' })], cap), 'b-Fallen', 'a body in the shaft')
  assert.equal(W.bodyInPit([P('chicken', 5.5, 62.2, 0.5, { width: 0.4, height: 0.7 })], cap), 'chicken')
  assert.equal(W.bodyInPit([P('player', 5.5, 64, -0.5, { username: 'b-Stand' })], cap), null, 'the thrower on the stand')
  assert.equal(W.bodyInPit([P('player', 5.5, 64, 0.5, { username: 'b-Rim' })], cap), null, 'feet on the rim cell: above the cap cell')
  assert.equal(W.bodyInPit([P('item', 5.5, 62, 0.5)], cap), null, 'items do not block a place')
  assert.equal(W.bodyInPit([P('player', 6.25, 63, 0.5, { username: 'b-Edge' })], cap), 'b-Edge', 'a box over the edge counts')
})
await t('COVER, ORDER: an open pit nobody is at is covered by a visitor holding a block (close_well); a build that can run goes first', () => {
  const plan = { wood: 'oak', slotsNeeded: 2 }
  const o = x => W.wellOrder({ now: NOW, distHome: 5, well: null, buildPlan: null, slots: 20, freeSlots: 16, junkStacks: 0, pit: () => ({ attended: false, coverable: true }), ...x })
  assert.equal(o({}).order?.skill, 'close_well'); assert.match(o({}).order.why, /open pit/)
  assert.equal(o({ pit: () => ({ attended: true, coverable: true }) }).order, null, 'someone is at it (building it)')
  assert.equal(o({ pit: () => ({ attended: false, coverable: false }) }).order, null, 'no cover block: nothing to do')
  assert.equal(o({ pit: () => null }).order, null, 'positive control: no pit, no order')
  assert.equal(o({ buildPlan: plan }).order?.skill, 'build_well', 'a build resumes the pit')
  assert.equal(o({ buildPlan: plan, myName: 'b', peers: ['a'] }).order?.skill, 'close_well', 'the deferring builder covers instead')
  assert.equal(o({ state: { lastCloseAt: NOW - 1000 } }).order, null, 'the close cooldown')
  // plinth-02.1 (Codex hotfix P1): townPitState never names the sealed well itself (a built site is no open pit), so a pit read
  // beside a sealed well is ANOTHER column -- an abandoned plinth's -- and it is covered too
  assert.equal(o({ well: () => ({ open: false, attended: false, breached: false }) }).order?.skill, 'close_well', 'a pit beside a sealed well is covered')
  assert.equal(o({ well: () => ({ open: false, attended: false, breached: false }), pit: () => null }).order, null, 'a sealed well and no pit: nothing')
})
await t('COVER: a pit-first build that gives up (every toss missed) covers the CAP cell only -- no _well_pit_open, a _well_pit_covered row', async () => {
  const town = giveUpScene([S('dirt', 1)])
  const c0 = await counts(), d0 = (await rows('_well_pit_dug')).length
  const r = await run('build_well', town.bot)
  assert.equal(r.status, 'failed', r.detail)
  assert.ok(town.state.digs.length >= 2, 'positive control: the pit was dug')
  const dug = await newRows('_well_pit_dug', d0)
  assert.equal(dug.length, 1, 'one row when the pit opens (C9 starts its clock there), not one per phase')
  assert.match(dug[0].skill.detail, new RegExp(`at=${CAP.x},${CAP.y},${CAP.z} from=fresh`))
  assert.deepEqual(pitCells(town), ['air', 'dirt'], 'the cap cell covered; the shaft under it left as it is')
  assert.equal((await rows('_well_pit_open')).length, c0.open, 'no pit left open')
  const row = (await newRows('_well_pit_covered', c0.covered)).pop()
  assert.ok(row); assert.match(row.skill.detail, new RegExp(`at=${CAP.x},${CAP.y},${CAP.z} stage=dug by=build item=dirt`))
  // ...AND THE NEXT BUILD DIGS THE COVER OUT AND FINISHES (the tosses land this time)
  town.state.missNext = 0
  const d1 = (await rows('_well_pit_dug')).length
  const r2 = await run('build_well', town.bot)
  assert.equal(r2.status, 'success', r2.detail); assert.ok(wellOk(town, CAP).ok && wellOk(town, CAP).floor)
  assert.match((await newRows('_well_pit_dug', d1)).pop()?.skill.detail ?? '', /from=covered/, 'the resume opens the pit again: C9\'s clock restarts')
})
await t('COVER: never after an ABORT (a danger preemption owns the body): the pit says so (why=aborted), and a visitor\'s close_well covers it', async () => {
  const town = giveUpScene([S('dirt', 1)])
  const sig = { aborted: false, _l: [], addEventListener (k, f) { this._l.push(f) }, removeEventListener (k, f) { this._l = this._l.filter(x => x !== f) } }
  town.state.onLook = () => { if (town.state.digs.length >= 2 && !sig.aborted) { sig.aborted = true; for (const f of [...sig._l]) f() } }
  const c0 = await counts(), places0 = town.state.places.length
  await run('build_well', town.bot, sig).catch(() => {})
  assert.ok(sig.aborted, 'positive control: aborted after the dig')
  assert.deepEqual(pitCells(town), ['air', 'air']); assert.equal(town.state.places.length, places0, 'nothing placed after the abort')
  assert.match((await newRows('_well_pit_open', c0.open)).pop()?.skill.detail ?? '', /stage=dug why=aborted/)
  const { townPitState } = await import('../src/skills.mjs')
  assert.deepEqual(townPitState(town.bot), { stage: 'dug', attended: false, coverable: true }, 'the scheduler sees the open pit')
  const r = await run('close_well', town.bot)
  assert.equal(r.status, 'success', r.detail)
  assert.deepEqual(pitCells(town), ['air', 'dirt'])
  assert.match((await newRows('_well_pit_covered', c0.covered)).pop()?.skill.detail ?? '', /by=visitor item=dirt/)
  assert.equal(townPitState(town.bot), null)
})
await t('COVER: only the run that opened (or took over) the pit covers it -- a build that stops before its dig leaves another\'s pit to close_well', async () => {
  const dir = await recordSite()
  const town = fakeTown({ items: [S('oak_log', 3), S('dirt', 1)], blocks: { [`${CAP.x},${CAP.y},${CAP.z}`]: 'air', [`${CAP.x},${CAP.y - 1},${CAP.z}`]: 'air' }, storeDir: dir })
  town.bot.craft = async () => { throw new Error('craft refused') }   // the build stops at its chain, before any dig
  const c0 = await counts()
  const r = await run('build_well', town.bot)
  assert.equal(r.status, 'failed', r.detail); assert.match(r.detail, /craft/)
  assert.ok(town.bot.entity.position.distanceTo(new Vec3(CAP.x + 0.5, CAP.y + 1, CAP.z + 0.5)) < 3, 'positive control: it stood at the pit')
  assert.deepEqual(pitCells(town), ['air', 'air'], 'not its pit: not covered by the build')
  assert.equal((await rows('_well_pit_covered')).length, c0.covered); assert.equal((await rows('_well_pit_open')).length, c0.open)
})
await t('COVER: someone at the pit when the build ends -- not covered (theirs), _well_pit_open says why', async () => {
  const town = giveUpScene([S('dirt', 1)])
  town.state.onLook = () => { if (town.state.digs.length >= 2 && town.state.missNext < 99) town.bot.players['b-Bravo'] = { username: 'b-Bravo', entity: { position: new Vec3(CAP.x + 2.5, CAP.y + 1, CAP.z + 0.5) } } }
  const c0 = await counts()
  await run('build_well', town.bot)
  assert.ok(town.bot.players['b-Bravo'], 'positive control: the player arrived')
  assert.deepEqual(pitCells(town), ['air', 'air'])
  assert.match((await newRows('_well_pit_open', c0.open)).pop()?.skill.detail ?? '', /why=(b-Bravo_is_at_the_pit|well_attended)|b-Bravo/)
})
await t('COVER: a body in the shaft is never sealed in (a mob that fell in): the pit stays open and says so', async () => {
  const town = giveUpScene([S('dirt', 1)])
  town.bot.entities[7] = { id: 7, name: 'chicken', position: new Vec3(CAP.x + 0.5, CAP.y - 1, CAP.z + 0.5), width: 0.4, height: 0.7 }
  const c0 = await counts()
  await run('build_well', town.bot)
  assert.deepEqual(pitCells(town), ['air', 'air'])
  assert.match((await newRows('_well_pit_open', c0.open)).pop()?.skill.detail ?? '', /why=a_body_in_the_pit_\(chicken\)/)
})
await t('COVER: a place the server never applies writes no _well_pit_covered (the read-back decides, not the click)', async () => {
  const town = giveUpScene([S('dirt', 1)])
  const place = town.bot._placeBlockWithOptions
  town.bot._placeBlockWithOptions = async (ref, face, opts) => { if (/_trapdoor$/.test(town.bot.heldItem?.name ?? '')) return place(ref, face, opts) }   // silently refused
  const c0 = await counts()
  await run('build_well', town.bot)
  assert.equal(town.bot.heldItem?.name === 'dirt' || town.count('dirt') === 1, true, 'positive control: the cover was tried with dirt in hand')
  assert.equal((await rows('_well_pit_covered')).length, c0.covered)
  assert.match((await newRows('_well_pit_open', c0.open)).pop()?.skill.detail ?? '', /why=the_cap_cell_reads_dug_after_the_place/)
})
await t('COVER over a FLOORED pit goes against a side wall, never the floor trapdoor (a click would toggle it)', async () => {
  const dir = await recordSite()
  const town = fakeTown({ items: [S('oak_trapdoor', 1), S('dirt', 3)], blocks: { [`${CAP.x},${CAP.y},${CAP.z}`]: 'air', [`${CAP.x},${CAP.y - 1},${CAP.z}`]: FLOOR_TD() }, storeDir: dir })
  const place = town.bot._placeBlockWithOptions
  town.bot._placeBlockWithOptions = async (ref, face, opts) => { if (/_trapdoor$/.test(town.bot.heldItem?.name ?? '')) throw new Error('cap refused'); return place(ref, face, opts) }
  const r = await run('build_well', town.bot)
  assert.equal(r.status, 'failed', r.detail)
  assert.equal(town.cell(new Vec3(CAP.x, CAP.y, CAP.z)).name, 'dirt', 'the cap cell is covered')
  assert.ok(!town.state.events.includes('toggle'), 'the floor trapdoor was clicked')
  assert.equal(town.cell(new Vec3(CAP.x, CAP.y - 1, CAP.z)).props.open, false)
  assert.equal(W.wellStage(homeRead(town), CAP), 'covered_floored')
})
await t('COVER BEFORE THE DIG: a bag with no cover block is never dug into (skip no_cover, before the walk)', async () => {
  const town = fakeTown({ items: [S('oak_trapdoor', 2), S('cobblestone', 64)] })
  const r = await run('build_well', town.bot)
  assert.equal(r.status, 'no_effect'); assert.match(r.detail, /cover the junk well pit/)
  assert.equal(town.state.digs.length, 0); assert.equal(town.state.goals.length, 0, 'not even walked')
  const ok = fakeTown({ items: [S('oak_trapdoor', 2), S('cobblestone', 65)] })
  assert.equal((await run('build_well', ok.bot)).status, 'success', 'positive control: the 65th cobblestone is a cover')
})
await t('COVER (Codex r2): a body that enters the shaft DURING the cover\'s equip and look is seen -- the checks come after the awaits', async () => {
  const town = giveUpScene([S('dirt', 1)])
  const look = town.bot.lookAt
  town.bot.lookAt = async (p, f) => {
    if (town.bot.heldItem?.name === 'dirt') town.bot.entities[8] = { id: 8, name: 'chicken', position: new Vec3(CAP.x + 0.5, CAP.y - 1, CAP.z + 0.5), width: 0.4, height: 0.7 }
    return look(p, f)
  }
  const c0 = await counts()
  await run('build_well', town.bot)
  assert.ok(town.bot.entities[8], 'positive control: the chicken arrived during the cover\'s look')
  assert.deepEqual(pitCells(town), ['air', 'air'])
  assert.match((await newRows('_well_pit_open', c0.open)).pop()?.skill.detail ?? '', /why=a_body_in_the_pit_\(chicken\)/)
})
await t('COVER (Codex r2): a HALF-DUG pit (an abort after the first dig) is covered back to fresh by a visitor, and says so', async () => {
  const town = giveUpScene([S('dirt', 1)])
  const sig = { aborted: false, _l: [], addEventListener (k, f) { this._l.push(f) }, removeEventListener (k, f) { this._l = this._l.filter(x => x !== f) } }
  const dig = town.bot.dig
  town.bot.dig = async (b, ...a) => { await dig(b, ...a); if (town.state.digs.length === 1) { sig.aborted = true; for (const f of [...sig._l]) f() } }
  const c0 = await counts()
  await run('build_well', town.bot, sig).catch(() => {})
  assert.deepEqual(pitCells(town), ['dirt', 'air'], 'positive control: half dug (the cap cell open, the shaft not)')
  const r = await run('close_well', town.bot)
  assert.equal(r.status, 'success', r.detail)
  assert.deepEqual(pitCells(town), ['dirt', 'dirt'])
  assert.match((await newRows('_well_pit_covered', c0.covered)).pop()?.skill.detail ?? '', /stage=half_dug by=visitor item=dirt/)
})
await t('COVER (Codex r2): _well_pit_dug is written BEFORE the dig -- a dig that never takes is closed by its own row (C9 sees no open pit)', async () => {
  const town = giveUpScene([S('dirt', 1)])
  town.bot.dig = async () => { throw new Error('dig refused') }
  const c0 = await counts(), d0 = (await rows('_well_pit_dug')).length
  const r = await run('build_well', town.bot)
  assert.equal(r.status, 'failed'); assert.match(r.detail, /could not dig/)
  assert.equal((await rows('_well_pit_dug')).length, d0 + 1, 'the row came before the dig (the dig never succeeded)')
  assert.match((await newRows('_well_pit_covered', c0.covered)).pop()?.skill.detail ?? '', /stage=fresh by=closed/)
  assert.equal((await rows('_well_pit_open')).length, c0.open)
})
await t('COVER (Codex r2): an abort DURING the cover\'s look places nothing (the cover yields to the rescue)', async () => {
  const town = giveUpScene([S('dirt', 1)])
  const sig = { aborted: false, _l: [], addEventListener (k, f) { this._l.push(f) }, removeEventListener (k, f) { this._l = this._l.filter(x => x !== f) } }
  const look = town.bot.lookAt
  town.bot.lookAt = async (p, f) => { if (town.bot.heldItem?.name === 'dirt' && !sig.aborted) { sig.aborted = true; for (const g of [...sig._l]) g() } return look(p, f) }
  const c0 = await counts(), places0 = town.state.places.length
  await run('build_well', town.bot, sig).catch(() => {})
  assert.ok(sig.aborted, 'positive control: aborted during the cover')
  assert.equal(town.state.places.length, places0); assert.deepEqual(pitCells(town), ['air', 'air'])
  assert.match((await newRows('_well_pit_open', c0.open)).pop()?.skill.detail ?? '', /why=aborted/)
})
await t('COVER BEFORE THE DIG from a FULL bag (Codex r2): the remedy names the move that makes a slot first', async () => {
  const town = fakeTown({ items: [S('oak_log', 3), S('egg', 16), S('egg', 16), S('flint', 64), ...filler(31)].slice(0, 35), hand: S('cobblestone', 1) })
  town.slots.forEach((s, i) => { if (s && s.name === 'cobblestone') s.count = 1 })   // no cobblestone to spare, a full bag
  assert.equal(36 - town.bot.inventory.items().length, 0, 'positive control: the bag is full')
  const r = await run('build_well', town.bot)
  assert.equal(r.status, 'no_effect'); assert.match(r.detail, /; then carry one block to cover the junk well pit/)
  assert.equal(town.state.goals.length, 0)
})
await t('COVER (Codex r3): an abort DURING the first dig, the dig landing after it -- the end state is read once it lands (an open pit, never by=closed)', async () => {
  const town = giveUpScene([S('dirt', 1)])
  const sig = { aborted: false, _l: [], addEventListener (k, f) { this._l.push(f) }, removeEventListener (k, f) { this._l = this._l.filter(x => x !== f) } }
  const dig = town.bot.dig
  town.bot.dig = async (b, ...a) => {
    if (!sig.aborted) { sig.aborted = true; for (const f of [...sig._l]) f() }   // the abort as the dig starts
    await new Promise(r => setTimeout(r, 120))                                    // ...and the dig lands after it
    return dig(b, ...a)
  }
  const c0 = await counts()
  await run('build_well', town.bot, sig).catch(() => {})
  await new Promise(r => setTimeout(r, 200))
  assert.deepEqual(pitCells(town), ['dirt', 'air'], 'positive control: the late dig opened the cap cell')
  assert.equal((await rows('_well_pit_covered')).length, c0.covered, 'never said closed')
  assert.match((await newRows('_well_pit_open', c0.open)).pop()?.skill.detail ?? '', /stage=half_dug why=aborted/)
})
await t('MUTANT (skills): reading the end state before the in-flight dig settles says a pit is closed that the dig then opens', async () => {
  await withMutant(SP, '    const settledEnd = await g.settle().catch(() => false)\n', '    const settledEnd = true\n', async m => {
    const town = giveUpScene([S('dirt', 1)])
    const sig = { aborted: false, _l: [], addEventListener (k, f) { this._l.push(f) }, removeEventListener (k, f) { this._l = this._l.filter(x => x !== f) } }
    const dig = town.bot.dig
    town.bot.dig = async (b, ...a) => { if (!sig.aborted) { sig.aborted = true; for (const f of [...sig._l]) f() } await new Promise(r => setTimeout(r, 120)); return dig(b, ...a) }
    const c0 = await counts()
    await within(m.SKILLS.build_well.run({ bot: town.bot }, {}, sig), 15000, 'mutant').catch(() => {})
    await new Promise(r => setTimeout(r, 200))
    assert.equal((await rows('_well_pit_covered')).length, c0.covered + 1, 'mutant inert')
  })
})
const coverLookHook = (town, fn) => {
  const look = town.bot.lookAt
  let done = false
  town.bot.lookAt = async (p, f) => { if (town.bot.heldItem?.name === 'dirt' && !done) { done = true; await fn() } return look(p, f) }
}
const movedRecordScene = async () => {
  const town = giveUpScene([S('dirt', 1)])
  const C = await import('../src/composter.mjs')
  coverLookHook(town, () => { assert.ok(C.createSiteGen(process.env.POOL_STATE_DIR, `junkwell-site-${HOME.x}_${HOME.y}_${HOME.z}`, 2, { x: CAP.x + 6, y: CAP.y, z: CAP.z }, null)) })
  return town
}
await t('COVER (Claude r2 P3): the site record moving during the cover\'s look stops the place (the gen re-check after the awaits)', async () => {
  const town = await movedRecordScene()
  const c0 = await counts(), p0 = town.state.places.length
  await run('build_well', town.bot)
  assert.equal(town.state.places.length, p0); assert.deepEqual(pitCells(town), ['air', 'air'])
  assert.match((await newRows('_well_pit_open', c0.open)).pop()?.skill.detail ?? '', /why=the_site_record_moved/)
})
const coveredMeanwhileScene = () => {
  const town = giveUpScene([S('dirt', 1)])
  coverLookHook(town, () => { town.world.set(town.key({ x: CAP.x, y: CAP.y, z: CAP.z }), { name: 'cobblestone' }) })   // someone else covered it
  return town
}
await t('COVER (Claude r2 P3): a pit covered by someone else during the cover\'s look is not placed into (the stage re-check after the awaits)', async () => {
  const town = coveredMeanwhileScene()
  const c0 = await counts(), p0 = town.state.places.length
  await run('build_well', town.bot)
  assert.equal(town.state.places.length, p0, 'nothing placed')
  assert.match((await newRows('_well_pit_covered', c0.covered)).pop()?.skill.detail ?? '', /stage=covered by=closed/)
})
await t('MUTANT (skills): without the gen re-check after the awaits the cover goes into a site the record moved off', async () => {
  await withMutant(SP, "  if (cur.gen !== gen || !cur.site || cur.site.x !== site.x || cur.site.y !== site.y || cur.site.z !== site.z) return { why: `the site record moved (generation ${gen} -> ${cur.gen})`, soft: true }\n", '', async m => {
    const town = await movedRecordScene()
    await within(m.SKILLS.build_well.run({ bot: town.bot }, {}, { aborted: false }), 15000, 'mutant')
    assert.deepEqual(pitCells(town), ['air', 'dirt'], 'mutant inert')
  })
})
await t('MUTANT (skills): without the stage re-check after the awaits the cover is clicked into a covered cell', async () => {
  await withMutant(SP, "  if (!isOpenPit(stage())) return { why: `the site reads ${stage()}`, soft: true }\n", '', async m => {
    const town = coveredMeanwhileScene()
    const p0 = town.state.places.length, c0 = await counts()
    await within(m.SKILLS.build_well.run({ bot: town.bot }, {}, { aborted: false }), 15000, 'mutant')
    assert.match((await newRows('_well_pit_covered', c0.covered)).pop()?.skill.detail ?? '', /by=build/, 'mutant inert: the place was attempted and credited')
    assert.equal(town.state.places.length, p0)
  })
})
const driftScene = () => {
  const town = giveUpScene()
  town.state.missNext = 0
  // A ROTATION MOVED AFTER THE AIM (a server correction): on the second resend, mineflayer's pitch is knocked 0.3 rad up
  let n = 0
  const write = town.bot._client.write
  town.bot._client.write = (name, p) => {
    const out = write(name, p)
    if (name === 'look' && ++n === 2) { town.bot.entity.pitch += 0.3; town.state.lookPitch -= 0.3 * 180 / Math.PI }   // the server's correction, both sides
    return out
  }
  return town
}
await t('AIM (Claude r2 P3): a rotation moved after the aim is aimed again before the click -- the throw still lands', async () => {
  const town = driftScene()
  const n0 = (await rows('_well_dispose')).length
  const r = await run('build_well', town.bot)
  assert.equal(r.status, 'success', r.detail)
  const pit = (await rows('_well_dispose')).slice(n0).filter(x => /stop=pit_first/.test(x.skill.detail))[0]
  assert.equal(field(pit.skill.detail, 'misses'), '0')
})
await t('MUTANT (skills): without the re-aim a moved rotation is what the click throws at (a miss)', async () => {
  await withMutant(SP, "      if (Math.abs(bot.entity.pitch - want.pitch) > 0.009 || Math.abs(bot.entity.yaw - want.yaw) > 0.009) {\n", '      if (false) {\n', async m => {
    const town = driftScene()
    const n0 = (await rows('_well_dispose')).length
    await within(m.SKILLS.build_well.run({ bot: town.bot }, {}, { aborted: false }), 15000, 'mutant').catch(() => {})
    const pit = (await rows('_well_dispose')).slice(n0).filter(x => /stop=pit_first/.test(x.skill.detail))[0]
    assert.ok(Number(field(pit.skill.detail, 'misses')) >= 1, 'mutant inert: ' + pit?.skill.detail)
  })
})
await t('MUTANT (skills): the receipt without the entity filter counts another entity\'s spawn packet', async () => {
  await withMutant(SP, '    if (acc.aimPitch == null || !acc.spawned.some(e => e.id === pk?.entityId)) return\n', '    if (acc.aimPitch == null) return\n', async m => {
    const town = dropScene(); town.state.foreignSpawn = true
    const n0 = (await rows('_well_dispose')).length
    await within(m.SKILLS.build_well.run({ bot: town.bot }, {}, { aborted: false }), 15000, 'mutant')
    const pit = (await rows('_well_dispose')).slice(n0).filter(x => /stop=pit_first/.test(x.skill.detail))[0]
    assert.equal(field(pit.skill.detail, 'misses'), '0', 'positive control: the throw landed')
    assert.notEqual(field(pit.skill.detail, 'aim_off'), '0', 'mutant inert')
  })
})
await t('AIM: another entity\'s spawn packet during the throw is not the throw\'s receipt (aim_off=0, aim_read=1)', async () => {
  const town = dropScene(); town.state.foreignSpawn = true
  const n0 = (await rows('_well_dispose')).length
  await run('build_well', town.bot)
  const pit = (await rows('_well_dispose')).slice(n0).filter(x => /stop=pit_first/.test(x.skill.detail))[0]
  assert.equal(field(pit.skill.detail, 'aim_off'), '0'); assert.equal(field(pit.skill.detail, 'aim_read'), field(pit.skill.detail, 'tossed'))
})
await t('MUTANT (skills): the receipt read as 1/8000 units on a 1.21.9+ registry (lpVec3) calls every landed throw off', async () => {
  await withMutant(SP, "  try { lpVec3 = !!bot.registry?.version?.['>=']?.('1.21.9') } catch { lpVec3 = false }\n", '', async m => {
    const town = dropScene()
    const n0 = (await rows('_well_dispose')).length
    await within(m.SKILLS.build_well.run({ bot: town.bot }, {}, { aborted: false }), 15000, 'mutant')
    const pit = (await rows('_well_dispose')).slice(n0).filter(x => /stop=pit_first/.test(x.skill.detail))[0]
    assert.equal(field(pit.skill.detail, 'misses'), '0', 'positive control: the throw landed')
    assert.notEqual(field(pit.skill.detail, 'aim_off'), '0', 'mutant inert (the test registry is ' + REG.version.minecraftVersion + ')')
  })
})
await t('COVER (Claude r3 P3): a build that stops on a cap reading OPEN never says the site is closed (an open top trapdoor reads built)', async () => {
  const town = giveUpScene([S('dirt', 1)])
  town.state.missNext = 0
  const place = town.bot._placeBlockWithOptions
  town.bot._placeBlockWithOptions = async (ref, face, opts) => {
    await place(ref, face, opts)
    const c = town.world.get(town.key({ x: CAP.x, y: CAP.y, z: CAP.z }))
    if (c?.props?.half === 'top') c.props.open = true   // the cap lands open
  }
  const c0 = await counts()
  const r = await run('build_well', town.bot)
  assert.equal(r.status, 'failed'); assert.match(r.detail, /open=true/)
  assert.equal((await rows('_well_pit_covered')).length, c0.covered, 'an open cap is not closed')
})
await t('MUTANT (skills): by=closed for any stage but invalid says an open cap is closed', async () => {
  await withMutant(SP, "settledEnd && (st === 'fresh' || isCoveredPit(st))) logEvent(", "settledEnd && st !== 'invalid') logEvent(", async m => {
    const town = giveUpScene([S('dirt', 1)])
    town.state.missNext = 0
    const place = town.bot._placeBlockWithOptions
    town.bot._placeBlockWithOptions = async (ref, face, opts) => { await place(ref, face, opts); const c = town.world.get(town.key({ x: CAP.x, y: CAP.y, z: CAP.z })); if (c?.props?.half === 'top') c.props.open = true }
    const c0 = await counts()
    await within(m.SKILLS.build_well.run({ bot: town.bot }, {}, { aborted: false }), 15000, 'mutant')
    assert.equal((await rows('_well_pit_covered')).length, c0.covered + 1, 'mutant inert')
  })
})
await t('SWORDS ON PEACEFULKIT: the well classifies with peacefulkit\'s unwantedSword under its own strict switch', async () => {
  const PK = await import('../src/peacefulkit.mjs')
  assert.equal(W.isSword, PK.isSword, 'one isSword')
  for (const n of ['wooden_sword', 'stone_sword', 'iron_sword', 'diamond_sword', 'netherite_sword', 'golden_sword', 'stone_pickaxe', 'stone_axe', 'iron_shovel', 'wooden_hoe', 'sword', 'egg']) {
    for (const p of [true, false]) assert.equal(W.swordGoes(n, p), PK.unwantedSword({ name: n }, p), `${n} ${p}`)
  }
  assert.equal(W.swordGoes('stone_sword', true), true, 'positive control')
  for (const n of ['stone_axe', 'iron_shovel', 'wooden_hoe', 'stone_pickaxe']) assert.equal(W.swordGoes(n, true), false, `${n} is a tool, never a sword`)
  // the switch: peaceful only, and only with foodskip's switch on
  assert.equal(W.swordSwitch('auto', 'peaceful'), true)
  for (const [m, d] of [['auto', 'easy'], ['on', 'normal'], ['on', 'hard'], ['off', 'peaceful']]) assert.equal(W.swordSwitch(m, d), false, `${m}/${d}`)
})
await t('MUTANT (skills): without the cover the abandoned pit stays open', async () => {
  await withMutant(SP, "        else { const res = await coverPit(bot, { site, gen, g, signal, by: 'build' }); why = res.why ?? null; if (res.ok) pitClosedLogged = true }\n", "        else why = 'mutant'\n", async m => {
    const town = giveUpScene([S('dirt', 1)])
    await within(m.SKILLS.build_well.run({ bot: town.bot }, {}, { aborted: false }), 15000, 'mutant')
    assert.deepEqual(pitCells(town), ['air', 'air'], 'mutant inert')
  })
})
await t('MUTANT (skills): without the ownership gate a build covers a pit it never dug', async () => {
  await withMutant(SP, '      if (owned && isOpenPit(stage())) {\n', '      if (isOpenPit(stage())) {\n', async m => {
    const dir = await recordSite()
    const town = fakeTown({ items: [S('oak_log', 3), S('dirt', 1)], blocks: { [`${CAP.x},${CAP.y},${CAP.z}`]: 'air', [`${CAP.x},${CAP.y - 1},${CAP.z}`]: 'air' }, storeDir: dir })
    town.bot.craft = async () => { throw new Error('craft refused') }
    await within(m.SKILLS.build_well.run({ bot: town.bot }, {}, { aborted: false }), 15000, 'mutant')
    assert.deepEqual(pitCells(town), ['air', 'dirt'], 'mutant inert')
  })
})
await t('MUTANT (skills): without the body check the cover seals a mob in the shaft', async () => {
  await withMutant(SP, "  if (body) return { why: `a body in the pit (${body})`, soft: true }\n", '', async m => {
    const town = giveUpScene([S('dirt', 1)])
    town.bot.entities[7] = { id: 7, name: 'chicken', position: new Vec3(CAP.x + 0.5, CAP.y - 1, CAP.z + 0.5), width: 0.4, height: 0.7 }
    await within(m.SKILLS.build_well.run({ bot: town.bot }, {}, { aborted: false }), 15000, 'mutant')
    assert.deepEqual(pitCells(town), ['air', 'dirt'], 'mutant inert')
  })
})
await t('MUTANT (skills): without the read-back a refused place writes _well_pit_covered over an open pit', async () => {
  await withMutant(SP, "  if (!shut(after)) return { why: `the cap cell reads ${after} after the place` }\n", '', async m => {
    const town = giveUpScene([S('dirt', 1)])
    const place = town.bot._placeBlockWithOptions
    town.bot._placeBlockWithOptions = async (ref, face, opts) => { if (/_trapdoor$/.test(town.bot.heldItem?.name ?? '')) return place(ref, face, opts) }
    const c0 = await counts()
    await within(m.SKILLS.build_well.run({ bot: town.bot }, {}, { aborted: false }), 15000, 'mutant')
    assert.equal((await rows('_well_pit_covered')).length, c0.covered + 1, 'mutant inert')
  })
})
await t('MUTANT (skills): without the pre-dig cover check the build walks to the site with nothing to cover a pit', async () => {
  await withMutant(SP, "  if (!pitCoverItem(items())) {\n", '  if (false) {\n', async m => {
    const town = fakeTown({ items: [S('oak_trapdoor', 2), S('cobblestone', 64)] })
    await within(m.SKILLS.build_well.run({ bot: town.bot }, {}, { aborted: false }), 15000, 'mutant')
    assert.ok(town.state.goals.length > 0, 'mutant inert')
  })
})
await t('MUTANT (skills): close_well without the pit job leaves an aborted build\'s pit open', async () => {
  await withMutant(SP, '  if (!well || !well.open) return coverOpenPit(bot, signal)\n', "  if (!well || !well.open) return { status: 'no_effect', detail: 'mutant' }\n", async m => {
    const dir = await recordSite()
    const town = fakeTown({ items: [S('dirt', 1)], blocks: { [`${CAP.x},${CAP.y},${CAP.z}`]: 'air', [`${CAP.x},${CAP.y - 1},${CAP.z}`]: 'air' }, storeDir: dir })
    await within(m.SKILLS.close_well.run({ bot: town.bot }, {}, { aborted: false }), 15000, 'mutant')
    assert.deepEqual(pitCells(town), ['air', 'air'], 'mutant inert')
  })
})
await t('MUTANT (well): a cover placed against the floor trapdoor toggles it and covers nothing', async () => {
  await withMutant(WP, '  if (ok(read(cap.x, cap.y - 1, cap.z))) return', '  if (read(cap.x, cap.y - 1, cap.z)) return', async m => {
    const r = m.coverRef(flatRead({ '5,63,0': AIR, '5,62,0': TD('bottom') }), { x: 5, y: 63, z: 0 }, { x: 5, y: 64, z: -1 })
    assert.deepEqual(r.ref, { x: 5, y: 62, z: 0 }, 'mutant inert')
  })
})
await t('MUTANT (well): without the reserve rule the cover spends the 64th cobblestone', async () => {
  await withMutant(WP, '(!COVER_RESERVE.has(n) || reserve - 1 >= STONE_GUARD)', 'true', async m => {
    assert.equal(m.pitCoverItem([S('cobblestone', 64)]), 'cobblestone', 'mutant inert')
  })
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
    const town = fakeTown({ wellAt: CAP, items: [S('oak_trapdoor', 2), S('dirt', 1)], unloaded: [`${CAP.x + 2},${CAP.y - 2},${CAP.z}`] })
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
  once(s, 'moves.exclusionAreasBreak = [(block) => wellBreakCost(wellCols, block, selfWell) || planBreakCost(bot.townPlan?.cells, block)]', 'index')   // townplan-01 re-anchor: the plan's furniture rides in the same entry
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
  const line = 'moves.exclusionAreasBreak = [(block) => wellBreakCost(wellCols, block, selfWell) || planBreakCost(bot.townPlan?.cells, block)]'
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
async function withMutants (file, pairs, fn) {
  let src = readFileSync(file, 'utf8')
  for (const [old, neu] of pairs) {
    assert.ok(src.includes(old), `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 60))} is not in ${file.pathname}`)
    assert.equal(src.split(old).length, 2, 'the mutation target is not unique; the mutant is ambiguous')
    src = src.replace(old, neu)
  }
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, src.replace(/from '\.\//g, "from '../src/"))
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}
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
await t('MUTANT: cobble below the bot\'s 64 at the cap (no reserve in cobbleWellStacks)', async () => {
  await withMutant(WP, '    if (left - it.count < COBBLE_WELL_RESERVE) break\n', '', async m => {
    assert.equal(m.cobbleWellStacks([{ name: 'cobblestone', count: 64, slot: 9 }]).length, 1, 'mutant inert')
  })
})
await t('COBBLE: the reserve is re-judged at the click -- a bag that shrank under the plan keeps its 64 (positive control for the mutant below)', async () => {
  const town = fakeTown({ wellAt: CAP, items: [S('egg', 16), S('cobblestone', 30), S('cobblestone', 64), S('cobblestone', 64), ...Array.from({ length: 32 }, () => S('oak_log', 64))] })
  townAt(town, 300 + CO)
  const last = town.slots.map((x, i) => (x?.name === 'cobblestone' && x.count === 64 ? i : -1)).filter(i => i >= 0).pop()
  town.state.onLook = () => { if (town.slots[last]?.count === 64) town.slots[last] = { ...town.slots[last], count: 10 } }
  await within(SKILLS.dispose_well.run({ bot: town.bot }, {}, { aborted: false }), 15000, 'scene')
  assert.equal(town.count('cobblestone'), 74, 'the 30 went, the planned 64 stayed: 64 + 10 kept')
})
await t('MUTANT (skills): no reserve re-check at the cobble click', async () => {
  await withMutant(SP, '        if (it.count !== st.count || leftC < COBBLE_WELL_RESERVE) continue\n', '        if (it.count !== st.count) continue\n', async m => {
    // plan [30, 64] of 30 + 64 + 64; before the first throw the UNPLANNED 64 becomes 10: the planned 64 would now leave 40
    const town = fakeTown({ wellAt: CAP, items: [S('egg', 16), S('cobblestone', 30), S('cobblestone', 64), S('cobblestone', 64), ...Array.from({ length: 32 }, () => S('oak_log', 64))] })
    townAt(town, 300 + CO)
    const last = town.slots.map((x, i) => (x?.name === 'cobblestone' && x.count === 64 ? i : -1)).filter(i => i >= 0).pop()
    town.state.onLook = () => { if (town.slots[last]?.count === 64) town.slots[last] = { ...town.slots[last], count: 10 } }
    await within(m.SKILLS.dispose_well.run({ bot: town.bot }, {}, { aborted: false }), 15000, 'mutant')
    assert.ok(town.count('cobblestone') < 64, 'mutant inert')
  })
})
await t('COBBLE (Codex r1 P2): a planned stack whose count changed before its click stays (whole planned stacks only); mutant without the count check throws it', async () => {
  const bag = () => [S('cobblestone', 30), S('cobblestone', 64), S('cobblestone', 64), ...Array.from({ length: 33 }, () => S('oak_log', 64))]
  const scene = async mod => {
    const town = fakeTown({ wellAt: CAP, items: bag() })
    townAt(town, 300 + CO)
    const small = town.slots.findIndex(x => x?.name === 'cobblestone' && x.count === 30)
    town.state.onLook = () => { if (town.slots[small]?.count === 30) town.slots[small] = { ...town.slots[small], count: 20 } }
    await within(mod.SKILLS.dispose_well.run({ bot: town.bot }, {}, { aborted: false }), 15000, 'scene')
    return town.count('cobblestone')
  }
  const kept = await scene({ SKILLS: (await import('../src/skills.mjs')).SKILLS })
  assert.ok(kept >= 84, `the changed 20 stayed (positive control: the 64 above the reserve may go): ${kept}`)
  await withMutant(SP, '        if (it.count !== st.count || leftC < COBBLE_WELL_RESERVE) continue\n', '        if (leftC < COBBLE_WELL_RESERVE) continue\n', async m => {
    assert.ok(await scene(m) < 84, 'mutant inert')
  })
})
await t('COBBLE (Codex r1 P1): the cap is re-read at EVERY cobble click -- the town dropping below 256 after the first stack keeps the second', async () => {
  const scene = async mod => {
    const town = fakeTown({ wellAt: CAP, items: [S('cobblestone', 30), S('cobblestone', 64), S('cobblestone', 64), ...Array.from({ length: 33 }, () => S('oak_log', 64))] })
    townAt(town, 300 + CO)
    let looks = 0
    town.state.onLook = () => { if (++looks === 2) CCAP.appendJournal(process.env.POOL_STATE_DIR, CF_townKey(HOME), town.bot.worldId ?? null, { t: 'obs', k: '9,9,9', n: 100 + CO, cap: Date.now() + 1 }) }
    await within(mod.SKILLS.dispose_well.run({ bot: town.bot }, {}, { aborted: false }), 15000, 'scene')
    return { left: town.count('cobblestone'), looks }
  }
  const r = await scene({ SKILLS: (await import('../src/skills.mjs')).SKILLS })
  assert.ok(r.looks >= 2, `positive control: two throws were looked at (${r.looks})`)
  assert.equal(r.left, 128, 'the 30 went at the cap; the 64 stayed once the town read 100')
  await withMutant(SP, "        if (acc.capLast !== 'at_cap') continue\n", '', async m => {
    assert.equal((await scene(m)).left, 64, 'mutant inert')
  })
})
await t('COBBLE (Codex r1/r2 P1; cobblekeep-01): only COUNTED stock proves the cap -- 192 counted + 64 admitted on its way never sends cobble down the well; 240 counted + CO with a 30 the bank must refuse at the cap now DOES (the band where neither moved it)', async () => {
  const SK = await import('../src/skills.mjs')
  const town = fakeTown({ wellAt: CAP, items: [S('cobblestone', 30), S('cobblestone', 64), ...Array.from({ length: 34 }, () => S('oak_log', 64))] })
  townAt(town, 192 + CO)
  const r = CCAP.claimStack(process.env.POOL_STATE_DIR, CF_townKey(HOME), town.bot.worldId ?? null, { id: 'onway', n: 64, k: '9,9,9', bot: 'Other', keys: ['9,9,9'], coverage: true, inst: 'x' })
  assert.equal(r.decision, 'bank', 'positive control: the claim is admitted ((192 + CO) + 64 = the cap)')
  assert.equal(SK.cobbleTownViewFor(town.bot).reserved, 64, 'and it is a live reservation')
  assert.notEqual(SK.cobbleWellCap(town.bot), 'at_cap', '192 + CO held + 64 on its way is not the cap held (Codex r1 P1 stands)')
  // a COMPLETE count in town (a barrel beside home, the only container)
  // (stocktarget: two counts in ONE millisecond keep the smaller for the floor, so each count here is captured later than the last)
  let capAt = Date.now()
  const inTownAt = (tw, n) => { const k = `${HOME.x + 6},${HOME.y},${HOME.z - 6}`; tw.world.set(k, { name: 'barrel' }); CCAP.appendJournal(process.env.POOL_STATE_DIR, CF_townKey(HOME), tw.bot.worldId ?? null, { t: 'obs', k, n, cap: ++capAt }) }
  const t2 = fakeTown({ wellAt: CAP, items: [S('cobblestone', 30), S('cobblestone', 64), ...Array.from({ length: 34 }, () => S('oak_log', 64))] })
  inTownAt(t2, 240 + CO)
  assert.equal(SK.cobbleTownViewFor(t2.bot).complete, true, 'positive control: the count is complete')
  assert.equal(CCAP.cobbleAdmit(SK.cobbleTownViewFor(t2.bot), 30), 'at_cap', 'positive control: the BANK refuses this 30 at the cap')
  assert.equal(SK.cobbleWellCap(t2.bot), 'at_cap', '240 + CO counted: no whole stack of this bag can be banked, so the well takes it')
  inTownAt(t2, 240 + CO - 30)
  assert.equal(SK.cobbleWellCap(t2.bot), 'below', 'room for the 30 (the bank admits it): the well keeps it')
  inTownAt(t2, COBBLE_CAP)
  assert.equal(SK.cobbleWellCap(t2.bot), 'at_cap', 'positive control: the cap counted is')
  await withMutant(SP, "    return wellCobbleSwitch(cobbleTownViewFor(bot), stacks[0].count, { cap: TOWN_COBBLE_CAP, held: (h.cobblestone ?? 0) + (h.cobbled_deepslate ?? 0), floorOnly })",
    "    const v = cobbleTownViewFor(bot); void h; return (Number(v?.avail) || 0) >= TOWN_COBBLE_CAP ? 'at_cap' : v?.complete ? 'below' : 'unknown'", async m => {
      const t3 = fakeTown({ wellAt: CAP, items: [S('cobblestone', 30), S('cobblestone', 64), ...Array.from({ length: 34 }, () => S('oak_log', 64))] })
      inTownAt(t3, 240 + CO)
      assert.equal(m.cobbleWellCap(t3.bot), 'below', 'mutant inert (stonecap\'s floor-only predicate leaves the band: neither the bank nor the well moves the stack)')
    })
})
await t('COBBLE (Codex r1 P2): the server account lists cobble only up to what was CLICKED', async () => {
  const SK = await import('../src/skills.mjs')
  const a = SK.throwAccount({ before: { counts: { cobblestone: 158 }, slots: [] }, after: { counts: { cobblestone: 64 } }, clicked: [], cobble: 30 })
  assert.equal(a.lost.cobblestone, 30); assert.equal(a.otherLoss, 64)
  const b = SK.throwAccount({ before: { counts: { cobblestone: 158 }, slots: [] }, after: { counts: { cobblestone: 128 } }, clicked: [], cobble: 30 })
  assert.equal(b.lost.cobblestone, 30); assert.equal(b.otherLoss, 0, 'positive control: exactly the clicked amount')
})
await t('COBBLE (Codex r1 P2): the pit-first BUILD never counts cobble as room -- no build order it cannot carry out', () => {
  const o = x => W.wellOrder({ now: 1e9, distHome: 5, well: () => null, slots: 36, freeSlots: 0, junkStacks: 2, buildPlan: () => ({ slotsNeeded: 2, wood: 8 }), myName: 'a', peers: [], state: {}, ...x }).order?.skill ?? null
  assert.equal(o({ buildJunkStacks: 0 }), null, 'only cobble to toss: no build order')
  assert.equal(o({ buildJunkStacks: 2 }), 'build_well', 'positive control: real junk to toss')
})
await t('MUTANT: the switch without its foodskip half (FOOD_SKIP=off in a peaceful world would throw swords)', async () => {
  await withMutant(WP, "export const swordSwitch = (mode, difficulty) => difficulty === 'peaceful' && foodSkipActive(mode, difficulty)", "export const swordSwitch = (mode, difficulty) => difficulty === 'peaceful'", async m => {
    assert.equal(m.swordSwitch('off', 'peaceful'), true, 'mutant inert')
  })
})
await t('MUTANT (skills): swords allowed in the pit-first build', async () => {
  await withMutant(SP, '      out.swordsAllowed = !pit && !listedOnly && wellSwordsNow(bot)', '      out.swordsAllowed = !listedOnly && wellSwordsNow(bot)', async m => {   // re-anchored: junkout-01's listedOnly
    const town = fakeTown({ hand: S('cobblestone', 64), items: [S('stone_sword', 1), S('oak_log', 3), S('egg', 16), S('egg', 16), S('flint', 64), ...filler(30)] })
    town.bot.serverDifficulty = 'peaceful'
    await within(m.SKILLS.build_well.run({ bot: town.bot }, {}, { aborted: false }), 30000, 'mutant')
    assert.equal(town.count('stone_sword'), 0, 'mutant inert')
  })
})
await t('MUTANT: swords without the switch go down the well in any world', async () => {
  await withMutant(WP, 'export const swordGoes = (name, peaceful) => unwantedSword({ name }, peaceful)', 'export const swordGoes = (name, peaceful) => unwantedSword({ name }, true)', async m => {
    assert.equal(m.disposePlan([{ name: 'stone_sword', count: 1, slot: 9 }]).stacks.length, 1, 'mutant inert')
  })
})
await t('MUTANT (skills): no switch re-read at the click throws a sword in a world turned easy', async () => {
  await withMutant(SP, '      if (sword) { const p = wellSwordsNow(bot); if (!unwantedSword(it, p)) { acc.swordsKept++; continue } acc.peaceful = (acc.peaceful ?? true) && p }\n', '      if (sword) { acc.peaceful = true }\n', async m => {
    const town = peacefulTown([S('egg', 16), S('stone_sword', 1), ...filler(34)], 'peaceful')
    town.state.onLook = () => { if (town.state.clicks.length >= 1) town.bot.serverDifficulty = 'easy' }
    await within(m.SKILLS.dispose_well.run({ bot: town.bot }, {}, { aborted: false }), 15000, 'mutant')
    assert.equal(town.count('stone_sword'), 0, 'mutant inert')
  })
})
await t('MUTANT: without the list filter the plan throws cobblestone', async () => {
  await withMutant(WP, '  for (const it of list.filter(x => (isWellJunk(x.name) || swordGoes(x.name, swords) || cobbleSlots.has(x.slot)) && Number.isInteger(x.slot)).sort((a, b) => a.slot - b.slot)) {', '  for (const it of list.filter(x => Number.isInteger(x.slot)).sort((a, b) => a.slot - b.slot)) {', async m => {
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
  await withMutant(SP, "      if (!it || it.name !== st.name || !(isWellJunk(it.name) || (sword && acc.swordsAllowed) || (cob && acc.cobbleAllowed) || (stk && (acc.stockAllowed || acc.pruned))) || bot.currentWindow || bot.inventory?.selectedItem) continue\n", '', async m => {
    const town = fakeTown({ wellAt: CAP, items: [S('egg', 16), S('flint', 64), S('rail', 3), ...filler(32)] })
    const railSlot = town.slots.findIndex(s => s?.name === 'rail')
    town.state.onLook = () => { if (town.state.clicks.length === 2 && town.slots[railSlot]?.name === 'rail') town.slots[railSlot] = { name: 'iron_ingot', type: REG.itemsByName.iron_ingot.id, count: 5, slot: railSlot } }
    await within(m.SKILLS.dispose_well.run({ bot: town.bot }, {}, { aborted: false }), 15000, 'mutant')
    assert.ok(town.state.clicks.some(c => c.name === 'iron_ingot'), 'mutant inert')
  })
})

// ---- PLINTH-02.1 (10-17, the hotfix after the direct rollout): the same build_well / build_plinth, through the fake town ------
const PF = await import('../src/plinth.mjs')
const PCm = await import('../src/composter.mjs')
const SITE_KEY = `junkwell-site-${HOME.x}_${HOME.y}_${HOME.z}`
const PLINTH_FILE = dir => path.join(dir, `junkwell-plinth-${HOME.x}_${HOME.y}_${HOME.z}.json`)
const NOSITE_FILE = dir => path.join(dir, `junkwell-nosite-${HOME.x}_${HOME.y}_${HOME.z}.json`)
const CAPREF_FILE = dir => path.join(dir, `junkwell-plinth-${HOME.x}_${HOME.y}_${HOME.z}.caprefused.json`)
const siteGens = dir => readdirSync(dir).filter(f => f.startsWith(`${SITE_KEY}.g`) && f.endsWith('.json'))
const readJ = f => { try { return JSON.parse(readFileSync(f, 'utf8')) } catch { return null } }
const completeRecord = (dir, RC) => writeFileSync(PLINTH_FILE(dir), JSON.stringify({ v: PF.PLINTH_VERSION, state: 'complete', id: 'hf-r1', world: null, at: Date.now() - 9e6, doneAt: Date.now() - 8e6, plan: { cap: RC, steps: [], stair: [] }, prev: [] }))
const { townPlinthState, townWellSite } = await import('../src/skills.mjs')
const finishedTown = async extraBlocks => {
  const { town, RC } = await raisedTown()
  for (const [k, v] of Object.entries(extraBlocks(RC, town))) town.world.set(k, { name: v })
  completeRecord(process.env.POOL_STATE_DIR, RC)
  return { town, RC, dir: process.env.POOL_STATE_DIR }
}
const chestCell = (RC, town) => [[2, 0], [-2, 0], [0, 2], [0, -2]].map(([dx, dz]) => `${RC.x + dx},${RC.y},${RC.z + dz}`).find(k => !town.world.has(k))
const lastNoSiteRow = async () => (await rows('_well_refused')).filter(x => /reason=no_site /.test(x.skill.detail)).pop()?.skill.detail ?? ''

await t('PLINTH-02.1 A FINISHED PLINTH REFUSED FOR A TRANSIENT REASON IS HELD, NOT REPLANNED (board-c 10-16): a chest beside it -> no_effect well_site_held, the 30 min backoff, no search, no no-site record, no new site; 6 h and 3 sightings of it -> lost=persisted and the town replans; positive control: no chest -> the well is built', async () => {
  const ok = await finishedTown(() => ({}))
  assert.equal((await run('build_well', ok.town.bot)).status, 'success', 'positive control')
  const { town, RC, dir } = await finishedTown((rc, tw) => ({ [chestCell(rc, tw)]: 'chest' }))
  assert.match(W.wellSiteRefusal(homeRead(town), RC, HOME, { avoid: [] }) ?? '', /chest within 3/)
  const r = await run('build_well', town.bot)
  assert.equal(r.status, 'no_effect', r.detail); assert.equal(r.failClass, 'well_site_held')
  assert.equal(town.state.digs.length, 0)
  assert.equal(readJ(NOSITE_FILE(dir)), null, 'plinth-02 searched here (and on the flat town built a natural well, or replanned)')
  assert.deepEqual(siteGens(dir), [`${SITE_KEY}.g1.json`])
  assert.deepEqual(townPlinthState(town.bot).want, { want: null, why: 'complete' })
  assert.equal(W.wellOrderOutcome('build_well', r.status, NOW, {}, r.failClass).buildBackoffUntil, NOW + W.WELL_BUILD_BACKOFF_MS)
  assert.equal(W.wellOrderOutcome('build_well', 'no_effect', NOW, {}, null).buildBackoffUntil, undefined, 'a plain skip stays free')
  const note = readJ(CAPREF_FILE(dir)); assert.equal(note?.note?.transient?.n, 1)
  writeFileSync(CAPREF_FILE(dir), JSON.stringify({ ...note, note: { ...note.note, transient: { since: Date.now() - PF.PLINTH_LOST_PATIENCE_MS - 60e3, at: Date.now() - 20 * 60e3, n: 2 } } }))
  // ...lost: the town's site rule runs again as plinth-02's -- the flat test town still has a natural cell, so the base search
  // re-sites there (on the fleet's dug-out towns it exhausts and writes no-site lost=persisted -> complete_lost: plinth021.test)
  const a = townWellSite(town.bot)
  assert.equal(a.lost?.cls, 'persisted', 'the evidence build_well writes into the no-site record when the search exhausts')
  assert.ok(a.site && !(a.site.x === RC.x && a.site.z === RC.z), 'the base search re-sited')
  assert.equal(readJ(CAPREF_FILE(dir))?.note?.transient?.n, 3)
  const r2 = await run('build_well', town.bot)
  assert.equal(r2.status, 'success', r2.detail); assert.equal(wellOk(town, RC).ok, false, 'the refused plinth is replaced, not built')
})
await t('PLINTH-02.1 AN AFFIRMATIVE RECOVERY ENDS THE EPISODE: 5.5 h noted, the cap passes -> cleared; the chest back -> a new episode n=1', async () => {
  const { town, RC, dir } = await finishedTown(() => ({}))
  writeFileSync(CAPREF_FILE(dir), JSON.stringify({ cap: RC, world: null, note: { transient: { since: Date.now() - 5.5 * 3600e3, at: Date.now() - 30 * 60e3, n: 11 }, why: 'chest within 3' } }))
  const a = townWellSite(town.bot)
  assert.ok(a.site && a.site.x === RC.x); assert.equal(readJ(CAPREF_FILE(dir)), null)
  town.world.set(chestCell(RC, town), { name: 'chest' })
  assert.equal((await run('build_well', town.bot)).failClass, 'well_site_held')
  assert.equal(readJ(CAPREF_FILE(dir))?.note?.transient?.n, 1)
})
await t('PLINTH-02.1 A WALL GONE: held on the first sighting (a ghost cell?), lost=structural once seen again 10 min on', async () => {
  const { town, dir } = await finishedTown(rc => ({ [`${rc.x + 1},${rc.y},${rc.z}`]: 'air' }))
  const r0 = await run('build_well', town.bot)
  assert.equal(r0.failClass, 'well_site_held', r0.detail); assert.match(r0.detail, /structural/)
  const note = readJ(CAPREF_FILE(dir))
  writeFileSync(CAPREF_FILE(dir), JSON.stringify({ ...note, note: { ...note.note, structural: { since: Date.now() - PF.PLINTH_STRUCT_CONFIRM_MS - 1000, at: Date.now() - PF.PLINTH_STRUCT_CONFIRM_MS - 1000, n: 1 } } }))
  const r = await run('build_well', town.bot)
  assert.equal(r.status, 'success', `confirmed: the site rule re-sites (${r.detail})`)
  assert.equal(readJ(CAPREF_FILE(dir))?.note?.structural?.n, 2)
})
await t('PLINTH-02.1 AN UNSURE WELL IS NO RECOVERY: the note survives a reading with a wall cell not loaded; a well READ sealed clears it', async () => {
  const mk = async unloaded => {
    const RC = { x: CAP.x, y: G0 + 3, z: CAP.z }
    const blocks = Object.fromEntries(PF.plinthShell(RC).map(c => [`${c.x},${c.y},${c.z}`, 'cobblestone']))
    blocks[`${RC.x},${RC.y},${RC.z}`] = { name: 'oak_trapdoor', props: { half: 'top', facing: 'north', open: false } }
    blocks[`${RC.x},${RC.y - 1},${RC.z}`] = { name: 'oak_trapdoor', props: { half: 'bottom', facing: 'north', open: false } }
    const dir = mkdtempSync(path.join(tmpdir(), 'well-store-'))
    assert.ok(PCm.createSiteGen(dir, SITE_KEY, 1, RC, null))
    const town = fakeTown({ items: [S('dirt', 4)], blocks, storeDir: dir, unloaded })
    completeRecord(dir, RC)
    writeFileSync(CAPREF_FILE(dir), JSON.stringify({ cap: RC, world: null, note: { transient: { since: Date.now() - 3 * 3600e3, at: Date.now() - 20 * 60e3, n: 5 }, why: 'chest within 3' } }))
    return { town, dir }
  }
  const { findTownWells } = await import('../src/skills.mjs')
  const u = await mk([`${CAP.x + 1},${G0 + 2},${CAP.z}`])
  assert.equal(findTownWells(u.town.bot)[0]?.unsure, true, 'the fixture reads unsure')
  await run('build_well', u.town.bot)
  assert.ok(readJ(CAPREF_FILE(u.dir)), 'kept')
  const ok = await mk([])
  assert.equal(findTownWells(ok.town.bot)[0]?.unsure, false)
  await run('build_well', ok.town.bot)
  assert.equal(readJ(CAPREF_FILE(ok.dir)), null, 'cleared')
})
await t('MUTANT (skills): the transient hold removed -> the chest beside a good plinth at once re-sites the town\'s well elsewhere (a second well beside a finished plinth)', async () => {
  await withMutant(SP, "        if (v.verdict === 'hold') { held = { cap: doneCap, why, since: v.note[v.cls]?.since ?? Date.now(), cls: v.cls }; return 'unknown' }\n", '', async m => {
    const { town, dir } = await finishedTown((rc, tw) => ({ [chestCell(rc, tw)]: 'chest' }))
    const r = await within(m.SKILLS.build_well.run({ bot: town.bot }, {}, { aborted: false }), 15000, 'mutant')
    assert.equal(r.status, 'success', 'mutant inert: the plinth was held'); void dir
  })
})
await t('PLINTH-02.1 AN ISOLATED BOT (its pool is its own) PLANS NO PLINTH: unshared at the scheduler AND inside build_plinth; positive control: the same town in board scope plans', async () => {
  const mk = () => { const town = fakeTown({ items: [S('oak_trapdoor', 2), S('dirt', 1), S('cobblestone', 64), S('cobblestone', 64)] }); writeFileSync(NOSITE_FILE(process.env.POOL_STATE_DIR), JSON.stringify({ at: Date.now() - 60e3, world: null, by: 'x', tally: 'cols:672' })); return town }
  const was = config.memory.scope
  config.memory.scope = 'isolated'
  try {
    const town = mk()
    assert.deepEqual(townPlinthState(town.bot).want, { want: null, why: 'unshared' })
    const p = await run('build_plinth', town.bot)
    assert.equal(p.status, 'no_effect'); assert.match(p.detail, /no raised junk well is wanted here \(unshared\)/)
    assert.equal(readJ(PLINTH_FILE(process.env.POOL_STATE_DIR)), null, 'no record written')
  } finally { config.memory.scope = was }
  const town = mk()
  assert.equal(townPlinthState(town.bot).want.want, 'plan', 'positive control')
  assert.match((await run('build_plinth', town.bot)).detail, /planned/)
})
await t('MUTANT (skills): the guard missing inside build_plinth -> an isolated bot that is handed the order plans anyway', async () => {
  // plinthfirst-01 routes both plinthWant calls through plinthWantNow: the guard's one line is there
  await withMutant(SP, "  return plinthWant({ wellUsable, rec, noSite: readWellNoSite(), world, now, shared: townShared(bot), first, naturalPit, loaded })\n",
    "  return plinthWant({ wellUsable, rec, noSite: readWellNoSite(), world, now, first, naturalPit, loaded })\n", async m => {
      const was = config.memory.scope
      config.memory.scope = 'isolated'
      try {
        const town = fakeTown({ items: [S('oak_trapdoor', 2), S('dirt', 1)] })
        writeFileSync(NOSITE_FILE(process.env.POOL_STATE_DIR), JSON.stringify({ at: Date.now() - 60e3, world: null, by: 'x', tally: 'cols:672' }))
        const p = await within(m.SKILLS.build_plinth.run({ bot: town.bot }, {}, { aborted: false }), 15000, 'mutant')
        assert.match(p.detail, /planned/, 'mutant inert')
      } finally { config.memory.scope = was }
    })
})
await t('PLINTH-02.1 THE REPLACED SITE\'S PIT IS WATCHED: a recorded natural pit refused (a chest beside it) is carried in the new plan\'s prev', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'well-store-'))
  assert.ok(PCm.createSiteGen(dir, SITE_KEY, 1, CAP, null))
  const town = fakeTown({ items: [S('oak_trapdoor', 2), S('dirt', 1)], storeDir: dir, blocks: { [`${CAP.x},${CAP.y},${CAP.z}`]: 'air', [`${CAP.x},${CAP.y - 1},${CAP.z}`]: 'air', [`${CAP.x + 2},${CAP.y + 1},${CAP.z}`]: 'chest' } })
  writeFileSync(NOSITE_FILE(dir), JSON.stringify({ at: Date.now() - 60e3, world: null, by: 'x', tally: 'cols:672' }))
  assert.match(W.wellSiteRefusal(homeRead(town), CAP, HOME, { avoid: [] }) ?? '', /chest within 3/)
  assert.equal(PF.plinthHazard(homeRead(town), CAP), true)
  assert.match((await run('build_plinth', town.bot)).detail, /planned/)
  const rec = readJ(PLINTH_FILE(dir))
  assert.ok((rec?.prev ?? []).some(c => c.x === CAP.x && c.y === CAP.y && c.z === CAP.z), JSON.stringify(rec?.prev))
})
await t('MUTANT (skills): the displaced site not carried -> the refused pit is not in prev', async () => {
  await withMutant(SP, '      const carried = carryPrev(mine, hazardOf, res.plan?.cap ?? null, displaced)\n', '      const carried = carryPrev(mine, hazardOf, res.plan?.cap ?? null)\n', async m => {
    const dir = mkdtempSync(path.join(tmpdir(), 'well-store-'))
    assert.ok(PCm.createSiteGen(dir, SITE_KEY, 1, CAP, null))
    const town = fakeTown({ items: [S('oak_trapdoor', 2), S('dirt', 1)], storeDir: dir, blocks: { [`${CAP.x},${CAP.y},${CAP.z}`]: 'air', [`${CAP.x},${CAP.y - 1},${CAP.z}`]: 'air', [`${CAP.x + 2},${CAP.y + 1},${CAP.z}`]: 'chest' } })
    writeFileSync(NOSITE_FILE(dir), JSON.stringify({ at: Date.now() - 60e3, world: null, by: 'x', tally: 'cols:672' }))
    await within(m.SKILLS.build_plinth.run({ bot: town.bot }, {}, { aborted: false }), 15000, 'mutant')
    const rec = readJ(PLINTH_FILE(dir))
    assert.ok(rec?.plan, 'the mutant still plans')
    assert.ok(!(rec.prev ?? []).some(c => c.x === CAP.x && c.z === CAP.z), 'mutant inert')
  })
})
await t('PLINTH-02.1 AN ABANDONED PLINTH PIT IS COVERED EVEN BESIDE A SEALED WELL (Codex hotfix P1): an isolated bot\'s own plan, walled in and uncovered, its lease expired, and a sealed natural well elsewhere -> wellOrder gives close_well, and close_well covers the plinth pit; positive control: plinth-02\'s wellOrder gave nothing', async () => {
  // the plinth-02 raised town (shell + stair, so a visitor can walk up), its cap OPEN (walled in, uncovered), no site record
  const { town, RC } = await raisedTown()
  const dir = process.env.POOL_STATE_DIR
  for (const f of siteGens(dir)) unlinkSync(path.join(dir, f))
  town.world.set(`${RC.x},${RC.y},${RC.z}`, { name: 'air' })
  const NAT = { x: 2 * HOME.x - CAP.x, y: G0, z: 2 * HOME.z - CAP.z }
  town.world.set(`${NAT.x},${NAT.y},${NAT.z}`, { name: 'oak_trapdoor', props: { half: 'top', facing: 'north', open: false } })
  town.world.set(`${NAT.x},${NAT.y - 1},${NAT.z}`, { name: 'oak_trapdoor', props: { half: 'bottom', facing: 'north', open: false } })
  writeFileSync(PLINTH_FILE(dir), JSON.stringify({ v: PF.PLINTH_VERSION, state: 'plan', id: 'iso-r1', world: null, at: Date.now() - 3600e3, plan: { cap: RC, steps: [], stair: [] }, prev: [] }))
  const { townWellState, townPitState } = await import('../src/skills.mjs')
  const was = config.memory.scope
  config.memory.scope = 'isolated'
  try {
    assert.equal(PF.plinthHazard(homeRead(town), RC), true, 'the column is walled in and open')
    const ws = townWellState(town.bot); assert.equal(ws?.breached, false, 'a sealed natural well'); assert.equal(ws.open, false)
    const pit = townPitState(town.bot); assert.ok(pit?.plinth && !pit.attended && pit.coverable, JSON.stringify(pit))
    assert.deepEqual(townPlinthState(town.bot).want, { want: null, why: 'unshared' }, 'the owner no longer builds (nor resumes) it')
    const args = { now: NOW, distHome: 3, slots: 5, freeSlots: 31, junkStacks: 0, well: ws, pit, state: {} }
    assert.equal(W.wellOrder(args).order?.skill, 'close_well')
    assert.equal(W.wellOrder({ ...args, pit: null }).order, null, 'positive control: no pit, no order')
    const r = await run('close_well', town.bot)
    assert.equal(r.status, 'success', r.detail)
    assert.equal(PF.plinthHazard(homeRead(town), RC), false, 'covered')
    assert.ok((await rows('_well_pit_covered')).some(x => field(x.skill.detail, 'at') === `${RC.x},${RC.y},${RC.z}`))
  } finally { config.memory.scope = was }
})
await t('MUTANT (well): the pit cover beside a sealed well removed -> no order for the abandoned pit (plinth-02\'s gap)', async () => {
  await withMutant(WP, "    if (closeReady && !w.open) {\n      const p = lazy(pit)\n", "    if (false) {\n      const p = lazy(pit)\n", async m => {
    const pit = { stage: 'plinth', plinth: true, attended: false, coverable: true }
    assert.equal(m.wellOrder({ now: NOW, distHome: 3, slots: 5, freeSlots: 31, junkStacks: 0, well: { open: false, attended: false, breached: false }, pit, state: {} }).order, null, 'mutant inert')
  })
})
// ===================================================================================================================
// wellcare-01 fix 2: NO WELL ORDER FOR A BOT DEEP UNDER THE STAND -- the chain through the REAL CognitiveLoop
// ===================================================================================================================
// The fleet case (72 h to 10-17 12:55Z): dispose_well orders that started more than 12 below the stand failed
// well_unreachable 238 times in 262 (build_well 25 of 25), each a walk into a timeout and a 15-min backoff. The loop must not
// give the order down there, must let the bot carry on (the model's turn), and must give the order on the first decision
// in reach once the bot has climbed (nothing charged while it was held).
{
  const { Lessons } = await import('../src/lessons.mjs')
  const { CognitiveLoop } = await import('../src/cognitive.mjs')
  const ldir = mkdtempSync(path.join(tmpdir(), 'mcai-wellcare-'))
  let lseq = 0
  const freshLessons = () => { const L = new Lessons(path.join(ldir, `l${lseq++}.json`)); L.data.avoid = {}; L.data.worked = {}; return L }
  const CP = new URL('../src/cognitive.mjs', import.meta.url)
  const STAND_Y = CAP.y + 1
  /** A real loop on the fake town; every dispatched skill is recorded with the bot's height and succeeds. The model proposes
   *  `status`, and from decision `climbAt` on `surface` -- the bot's own climb, the remedy the held row names (the real skill
   *  climbs 17 blocks to y 63 on Paper: sandbox/well/wellcare-e2e.cjs `deep`); the runner performs it as the climb to the
   *  stand's level. Nothing in the loop's state is rewritten: the well's 30-s scan gate is waited out in real time (Codex r1
   *  P2). `until` stops the loop early. */
  async function loopOrders (town, { n = 3, Loop = CognitiveLoop, until = null, maxMs = 9000, climbAt = null } = {}) {
    Object.assign(town.bot, { oxygenLevel: 300, time: { day: 1, age: 1, timeOfDay: 1000 }, game: { dimension: 'overworld' }, experience: { level: 0 }, isInWater: false })
    // the prompt's block census asks by block id (mineflayer accepts ids); this fake answers predicates only
    const fb = town.bot.findBlocks
    town.bot.findBlocks = o => (typeof o?.matching === 'function' ? fb(o) : [])
    const ran = []
    let loop = null
    const runner = { isBusy: () => false, run: async (skill) => {
      ran.push({ skill, y: Math.floor(town.bot.entity.position.y), at: Date.now() })
      if (skill === 'surface') town.bot.entity.position = new Vec3(HOME.x + 0.5, STAND_Y, HOME.z + 0.5)
      return { status: 'success', detail: 'ok', delta: {}, contractEvidence: [`${skill}: probe 1`] }
    } }
    loop = new Loop(town.bot, runner, freshLessons(), null)
    loop.llm = { decide: async () => ({ schemaValid: true, latencyMs: 1, proposal: { skill: climbAt != null && ran.length >= climbAt ? 'surface' : 'status', args: {}, reason: 'probe' } }) }
    loop.milestones.cycle = 540
    // the loop paces model decisions at LLM_DECISION_COOLDOWN_MS (production 20 s; this file's config is loaded without it)
    const pace = config.llm.decisionCooldownMs
    config.llm.decisionCooldownMs = 50
    try {
      loop.start()
      for (const t0 = Date.now(); Date.now() - t0 < maxMs && ran.length < n && !(until && until(ran)); ) await new Promise(r => setTimeout(r, 30))
      loop.stop()
    } finally { config.llm.decisionCooldownMs = pace }
    return { ran, loop }
  }
  const fullOfJunk = () => [S('egg', 16), S('flint', 64), S('ink_sac', 10), ...filler(33)]
  await t('wellcare-01 CHAIN (real loop): at the stand\'s level, a full bag of junk at town gets dispose_well (positive control)', async () => {
    const town = fakeTown({ wellAt: CAP, items: fullOfJunk(), botAt: new Vec3(HOME.x + 0.5, STAND_Y, HOME.z + 0.5) })
    const { ran } = await loopOrders(town, { n: 1 })
    assert.equal(ran[0]?.skill, 'dispose_well', JSON.stringify(ran))
  })
  await t('wellcare-01 CHAIN (real loop): 20 below the stand, under the town -> no well order, the bot keeps its turn, a _well_deep action=hold row names surface; after the bot climbs dispose_well comes on the first scan in reach', async () => {
    const town = fakeTown({ wellAt: CAP, items: fullOfJunk(), botAt: new Vec3(HOME.x + 0.5, STAND_Y - 20, HOME.z + 0.5) })
    const { ran, loop } = await loopOrders(town, { n: 999, climbAt: 2, maxMs: 45_000, until: r => r.some(x => x.skill === 'dispose_well') })
    const c = ran.findIndex(x => x.skill === 'surface')
    assert.ok(c >= 2, `the loop went on deciding before the climb: ${JSON.stringify(ran.map(x => x.skill))}`)
    assert.ok(ran.slice(0, c).every(x => !['dispose_well', 'build_well', 'close_well'].includes(x.skill)), `a well order 20 below: ${JSON.stringify(ran)}`)
    const row = (await rows('_well_deep')).pop()
    assert.ok(row, 'no _well_deep row')
    assert.match(row.skill.detail, new RegExp(`^order=dispose below=20 stand_y=${STAND_Y} feet_y=${STAND_Y - 20} limit=12 remedy=surface action=hold$`), row.skill.detail)
    const i = ran.findIndex(x => x.skill === 'dispose_well')
    assert.ok(i > c, `no dispose_well after the climb: ${JSON.stringify(ran.map(x => x.skill))}`)
    assert.equal(ran[i].y, STAND_Y, 'given only in reach')
    assert.ok(ran[i].at - ran[0].at <= 40_000, 'within the scan gate of the first held decision (nothing charged while held)')
    assert.ok(loop.wellState.lastDisposeAt > 0, 'positive control: the order given after the climb is charged')
  })
  await t('wellcare-01 CHAIN, AN OPEN WELL: close_well from 20 below is held too (order=close row), and nothing else is given', async () => {
    const town = fakeTown({ wellAt: CAP, wellOpen: true, items: fullOfJunk(), botAt: new Vec3(HOME.x + 0.5, STAND_Y - 20, HOME.z + 0.5) })
    const { ran } = await loopOrders(town, { n: 2 })
    assert.ok(ran.length >= 2 && ran.every(x => !['dispose_well', 'build_well', 'close_well'].includes(x.skill)), JSON.stringify(ran))
    assert.match((await rows('_well_deep')).pop()?.skill.detail ?? '', /^order=close below=20 .* action=hold$/)
  })
  await t('wellcare-01 CHAIN, 12 below (the limit): still in reach -- the order is given', async () => {
    const town = fakeTown({ wellAt: CAP, items: fullOfJunk(), botAt: new Vec3(HOME.x + 0.5, STAND_Y - 12, HOME.z + 0.5) })
    const { ran } = await loopOrders(town, { n: 1 })
    assert.equal(ran[0]?.skill, 'dispose_well', JSON.stringify(ran))
  })
  await t('wellcare-01 MUTANT (cognitive): the depth reader removed -> the deep bot is ordered to dispose (the defect)', async () => {
    const src = readFileSync(CP, 'utf8')
    const old = "          depth: skill => wellOutOfReach({ feetY: p?.y, standY: townWellStandY(bot, skill) ?? config.world.homeY }),\n"
    assert.equal(src.split(old).length, 2, 'ANCHOR missing or not unique')
    const out = new URL(`./_mutant-cog-wc-${process.pid}.mjs`, import.meta.url)
    writeFileSync(out, src.replace(old, '').replace(/from '\.\//g, "from '../src/"))
    try {
      const { CognitiveLoop: M } = await import(out.href)
      const town = fakeTown({ wellAt: CAP, items: fullOfJunk(), botAt: new Vec3(HOME.x + 0.5, STAND_Y - 20, HOME.z + 0.5) })
      const { ran } = await loopOrders(town, { n: 1, Loop: M })
      assert.equal(ran[0]?.skill, 'dispose_well', `mutant inert: ${JSON.stringify(ran)}`)
    } finally { try { unlinkSync(out) } catch {} }
  })
}

// ---- PLINTH-FIRST (plinthfirst-01 on plinth-02.1): the policy alone; plinth-02.1's own fixes are tested in its section above
{

// ---- PLINTH-FIRST (plinthfirst-01; OWNER 10-16 ~12:05Z): the same build_well, with plinth-first ON ------------------------
// Every scene has its positive control: the same town with plinth-first OFF (this file's default) does what plinth-02 did.
// Fleet census 10-17 (docs/reports/plinthfirst-01-2026-10-17.txt): 6 towns on a sealed natural well, 2 on a plinth well, 4 shared
// towns + 20 isolated bots with none. The scenes: a viable natural site declined; a recorded fresh natural site declined; a
// started natural pit finished; a working natural well kept; a retired one replaced; a finished plinth refused for a transient
// reason held (and replaced only once the refusal persists), for a structural one replaced; an isolated bot never plans one.
const PF = await import('../src/plinth.mjs')
const PCm = await import('../src/composter.mjs')
const SITE_KEY = `junkwell-site-${HOME.x}_${HOME.y}_${HOME.z}`
const PLINTH_FILE = dir => path.join(dir, `junkwell-plinth-${HOME.x}_${HOME.y}_${HOME.z}.json`)
const NOSITE_FILE = dir => path.join(dir, `junkwell-nosite-${HOME.x}_${HOME.y}_${HOME.z}.json`)
const CAPREF_FILE = dir => path.join(dir, `junkwell-plinth-${HOME.x}_${HOME.y}_${HOME.z}.caprefused.json`)
const siteGens = dir => readdirSync(dir).filter(f => f.startsWith(`${SITE_KEY}.g`) && f.endsWith('.json'))
const readJ = f => { try { return JSON.parse(readFileSync(f, 'utf8')) } catch { return null } }
async function withFirst (fn) { process.env.PLINTH_FIRST = '1'; try { return await fn() } finally { process.env.PLINTH_FIRST = '0' } }
const kitTown = (o = {}) => fakeTown({ items: [S('oak_trapdoor', 2), S('dirt', 1)], ...o })
const lastNoSiteRow = async () => (await rows('_well_refused')).filter(x => /reason=no_site /.test(x.skill.detail)).pop()?.skill.detail ?? ''
const completeRecord = (dir, RC) => writeFileSync(PLINTH_FILE(dir), JSON.stringify({ v: PF.PLINTH_VERSION, state: 'complete', id: 'pf-r1', world: null, at: Date.now() - 9e6, doneAt: Date.now() - 8e6, plan: { cap: RC, steps: [], stair: [] }, prev: [] }))
const { townPlinthState } = await import('../src/skills.mjs')

await t('PLINTH-FIRST A VIABLE NATURAL SITE IS DECLINED: no dig, no site generation, the town\'s no-site record (tally cols:0,plinth_first:1, shadow= the declined cell), and the town wants a plinth; positive control: plinth-first off builds it', async () => {
  const off = kitTown()
  const r0 = await run('build_well', off.bot)
  assert.equal(r0.status, 'success', `positive control: ${r0.detail}`); assert.ok(wellOk(off, CAP).ok)
  await withFirst(async () => {
    const town = kitTown(), dir = process.env.POOL_STATE_DIR
    const r = await run('build_well', town.bot)
    assert.equal(r.status, 'no_effect', r.detail); assert.equal(r.failClass, 'well_no_site_policy')
    assert.equal(town.state.digs.length, 0, 'nothing dug'); assert.equal(wellOk(town, CAP).ok, false)
    assert.deepEqual(siteGens(dir), [], 'no natural site recorded')
    assert.equal(readJ(NOSITE_FILE(dir))?.tally, 'cols:0,plinth_first:1')
    const d = await lastNoSiteRow()
    assert.match(d, /^order=build reason=no_site tally=cols:0,plinth_first:1 rec=ok w=\S+ shadow=(\S+) /)
    assert.equal(field(d, 'shadow'), `${CAP.x},${CAP.y},${CAP.z}`, 'the shadow is the cell plinth-02 would have built')
    assert.ok(d.length <= 300)
    const w = townPlinthState(town.bot).want
    assert.equal(w.want, 'plan', JSON.stringify(w))
  })
})
await t('PLINTH-FIRST THE DECLINE IS NO BACKOFF (Paper pfnew 10-18): build_well declining the natural site returns well_no_site_policy, which costs the bot nothing (the town\'s no-site record holds the order until the hand-off); positive control: an exhausted ground search backs the bot off 2 h', async () => {
    await withFirst(async () => {
      const town = kitTown(), dir = process.env.POOL_STATE_DIR
      const r = await run('build_well', town.bot)
      assert.equal(r.failClass, 'well_no_site_policy', r.detail)
      assert.equal(W.wellOrderOutcome('build_well', r.status, NOW, {}, r.failClass).buildBackoffUntil, undefined, 'no self-backoff')
      assert.ok(readJ(NOSITE_FILE(dir)), 'the town hold is written')
      const { townWellBuildPlan } = await import('../src/skills.mjs')
      assert.equal(townWellBuildPlan(town.bot), null, 'the hold stops the next order')
      assert.equal(W.wellOrderOutcome('build_well', 'no_effect', NOW, {}, 'well_no_site').buildBackoffUntil, NOW + W.WELL_NO_SITE_BACKOFF_MS, 'positive control')
    })
  })
await t('PLINTH-FIRST A RECORDED FRESH NATURAL SITE is refused (cur= names it), no new generation; positive control: off, it is built', async () => {
  const mk = () => { const dir = mkdtempSync(path.join(tmpdir(), 'well-store-')); assert.ok(PCm.createSiteGen(dir, SITE_KEY, 1, CAP, null)); return kitTown({ storeDir: dir }) }
  const off = mk(); assert.equal((await run('build_well', off.bot)).status, 'success', 'positive control')
  await withFirst(async () => {
    const town = mk(), dir = process.env.POOL_STATE_DIR
    const r = await run('build_well', town.bot)
    assert.equal(r.failClass, 'well_no_site_policy', r.detail); assert.equal(town.state.digs.length, 0)
    assert.deepEqual(siteGens(dir), [`${SITE_KEY}.g1.json`], 'the record is not replaced by the refusal')
    assert.equal(field(await lastNoSiteRow(), 'cur'), `${CAP.x},${CAP.y},${CAP.z}:a_natural_site:_every_new_junk_well_is_a`)
  })
})
await t('PLINTH-FIRST A STARTED NATURAL PIT IS FINISHED (never orphaned): a dug, recorded pit gets its floor and cap, and no plinth is wanted meanwhile', async () => {
  await withFirst(async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'well-store-'))
    assert.ok(PCm.createSiteGen(dir, SITE_KEY, 1, CAP, null))
    const town = kitTown({ storeDir: dir, blocks: { [`${CAP.x},${CAP.y},${CAP.z}`]: 'air', [`${CAP.x},${CAP.y - 1},${CAP.z}`]: 'air' } })
    assert.equal(W.wellStage(homeRead(town), CAP), 'dug')
    assert.equal(townPlinthState(town.bot).want.why, 'natural_pit', 'no plinth beside a pit being finished')
    const r = await run('build_well', town.bot)
    assert.equal(r.status, 'success', r.detail); assert.ok(wellOk(town, CAP).ok && wellOk(town, CAP).floor)
    assert.equal(townPlinthState(town.bot).want.why, 'well')
  })
})
await t('PLINTH-FIRST A WORKING NATURAL WELL IS KEPT: build_well says it exists, the town wants no plinth, nothing is dug', async () => {
  await withFirst(async () => {
    const town = kitTown({ wellAt: CAP })
    const r = await run('build_well', town.bot)
    assert.equal(r.status, 'no_effect'); assert.match(r.detail, /already has a junk well/)
    assert.equal(town.state.digs.length, 0)
    assert.deepEqual(townPlinthState(town.bot).want, { want: null, why: 'well' })
  })
})
await t('PLINTH-FIRST A RETIRED NATURAL WELL IS REPLACED BY A PLINTH: well_retired said, no natural search builds, the town wants a plinth; positive control: off, a new natural well is built', async () => {
  const breach = { [`${CAP.x + 1},${CAP.y - 1},${CAP.z}`]: 'air' }
  const off = kitTown({ wellAt: CAP, blocks: breach })
  const r0 = await run('build_well', off.bot)
  assert.equal(r0.status, 'success', `positive control: the base re-sites a natural well (${r0.detail})`)
  await withFirst(async () => {
    const town = kitTown({ wellAt: CAP, blocks: breach }), dir = process.env.POOL_STATE_DIR
    assert.equal(townPlinthState(town.bot).want.want, 'plan', 'no usable well: the plinth is wanted at once (plinth-first needs no no-site record)')
    const r = await run('build_well', town.bot)
    assert.equal(r.failClass, 'well_no_site_policy', r.detail); assert.equal(town.state.digs.length, 0)
    assert.deepEqual(siteGens(dir), [])
    assert.ok((await rows('_well_retired')).some(x => field(x.skill.detail, 'at') === `${CAP.x},${CAP.y},${CAP.z}`))
    assert.equal(townPlinthState(town.bot).want.want, 'plan')
  })
})
await t('PLINTH-FIRST NO WELL SEEN OVER UNSENT GROUND IS NO EVIDENCE: a chunk near home not loaded -> no plinth wanted (unloaded); and build_well\'s shadow search over an unread cell defers (no no-site record)', async () => {
  await withFirst(async () => {
    const town = kitTown({ unloaded: [`${HOME.x + 16},${HOME.y},${HOME.z + 16}`] })
    assert.deepEqual(townPlinthState(town.bot).want, { want: null, why: 'unloaded' })
    const ok = kitTown()
    assert.equal(townPlinthState(ok.bot).want.want, 'plan', 'positive control: the same town fully loaded')
    const near = kitTown({ unloaded: [`${CAP.x},${CAP.y + 1},${CAP.z}`] }), dir2 = process.env.POOL_STATE_DIR
    const r = await run('build_well', near.bot)
    assert.equal(r.status, 'no_effect'); assert.ok(!/^well_no_site/.test(r.failClass ?? ''), r.detail)
    assert.equal(readJ(NOSITE_FILE(dir2)), null, 'no no-site record over an unread cell')
  })
})
// a finished plinth: the plinth-02 raised town (raisedTown) plus the complete record the hand-off writes
const finishedTown = async extraBlocks => {
  const { town, RC } = await raisedTown()
  for (const [k, v] of Object.entries(extraBlocks(RC, town))) town.world.set(k, { name: v })
  completeRecord(process.env.POOL_STATE_DIR, RC)
  return { town, RC, dir: process.env.POOL_STATE_DIR }
}
const chestCell = (RC, town) => [[2, 0], [-2, 0], [0, 2], [0, -2]].map(([dx, dz]) => `${RC.x + dx},${RC.y},${RC.z + dz}`).find(k => !town.world.has(k))
await t('PLINTH-FIRST A FINISHED PLINTH IS USED: build_well builds on the plan cap (the hand-off\'s site) with plinth-first on', async () => {
  await withFirst(async () => {
    const { town, RC } = await finishedTown(() => ({}))
    const r = await run('build_well', town.bot)
    assert.equal(r.status, 'success', r.detail); assert.ok(wellOk(town, RC).ok)
  })
})
await t('A PLANNER THAT FOUND NOTHING HANDS THE TOWN BACK TO THE NATURAL SEARCH (Claude r1 P2-1, r2 P2-3): record none + plinth-first on -> build_well builds the natural site; the none is not replanned on the old no-site record', async () => {
  await withFirst(async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'well-store-'))
    writeFileSync(NOSITE_FILE(dir), JSON.stringify({ at: Date.now() - 3 * 3600e3 - 60e3, world: null, by: 'x', tally: 'cols:0,plinth_first:1' }))
    writeFileSync(PLINTH_FILE(dir), JSON.stringify({ v: PF.PLINTH_VERSION, state: 'none', world: null, at: Date.now() - 3 * 3600e3, why: 'no_candidate', prev: [] }))
    const town = kitTown({ storeDir: dir })
    assert.deepEqual(townPlinthState(town.bot).want, { want: null, why: 'no_trigger' }, 'the old no-site record is older than the none (Claude r2 P3-1)')
    const r = await run('build_well', town.bot)
    assert.equal(r.status, 'success', r.detail); assert.ok(wellOk(town, CAP).ok, 'the natural well')
  })
})
await t('NONE -> NONE_AGED -> A RAISED PLAN (Codex r3 P2-2, Claude r3 P2-1): inside the 24 h window a newer no-site record replans, and the plan is still raised (minK from the policy); after the window plinth-first\'s own trigger replans', async () => {
  await withFirst(async () => {
    for (const [label, age, noSiteNewer] of [['inside the window, a newer no-site record', 3 * 3600e3, true], ['after the window, no record needed', PF.PLINTH_FIRST_NONE_WINDOW_MS + 60e3, false]]) {
      const dir = mkdtempSync(path.join(tmpdir(), 'well-store-'))
      writeFileSync(PLINTH_FILE(dir), JSON.stringify({ v: PF.PLINTH_VERSION, state: 'none', world: null, at: Date.now() - age, why: 'no_candidate', prev: [] }))
      if (noSiteNewer) writeFileSync(NOSITE_FILE(dir), JSON.stringify({ at: Date.now() - 60e3, world: null, by: 'x', tally: 'cols:672,walls:600' }))
      const town = kitTown({ storeDir: dir })
      assert.deepEqual(townPlinthState(town.bot).want, { want: 'plan', why: 'none_aged' }, label)
      const p = await run('build_plinth', town.bot)
      assert.match(p.detail, /planned the town's raised junk well/, `${label}: ${p.detail}`)
      const rec = readJ(PLINTH_FILE(dir))
      assert.ok(rec.plan.k >= PF.PLINTH_FIRST_MIN_RAISE, `${label}: k=${rec.plan.k} (a replan out of none is still raised)`); assert.equal(rec.minK, PF.PLINTH_FIRST_MIN_RAISE)
    }
  })
})
await t('THE RAISE LADDER IN THE REAL build_plinth (Claude r4 P2-1): a none written at k>=2, then the natural search exhausted since -> the next plan may be k=1 (blocks placed, never the bare cell); MUTANT: the floor pinned at 2 -> k>=2 again', async () => {
  const scene = async (mod = null) => {
    const dir = mkdtempSync(path.join(tmpdir(), 'well-store-'))
    writeFileSync(PLINTH_FILE(dir), JSON.stringify({ v: PF.PLINTH_VERSION, state: 'none', world: null, at: Date.now() - 3 * 3600e3, why: 'no_candidate', prev: [], minK: 2 }))
    writeFileSync(NOSITE_FILE(dir), JSON.stringify({ at: Date.now() - 60e3, world: null, by: 'x', tally: 'cols:672,walls:600' }))
    const town = kitTown({ storeDir: dir })
    const p = await within((mod ?? { SKILLS }).SKILLS.build_plinth.run({ bot: town.bot }, {}, { aborted: false }), 15000, 'plan')
    assert.match(p.detail, /planned/, p.detail)
    return readJ(PLINTH_FILE(dir))
  }
  await withFirst(async () => {
    const rec = await scene()
    assert.equal(rec.minK, 0); assert.ok(rec.plan.cost > 0, 'never the bare cell'); assert.ok(rec.plan.k < PF.PLINTH_FIRST_MIN_RAISE, `the floor dropped: k=${rec.plan.k}`)
  })
  await withMutant(SP, '      const { minK, bare } = plinthFirstMinK({ policy, recState: plinthRecordState(rec, world), rec, noSite: readWellNoSite() })\n',
    '      const { minK, bare } = { minK: policy ? 2 : 0, bare: !policy }\n', async m => {
      await withFirst(async () => {
        const rec = await scene(m)
        assert.ok(rec.plan.k >= PF.PLINTH_FIRST_MIN_RAISE, `mutant inert: k=${rec.plan.k}`)
      })
    })
})
await t('MUTANT (skills): the natural search back in plinth-first\'s compute -> the viable natural site is built', async () => {
  await withMutant(SP, '    compute: () => (searched = first ? plinthFirstSearch(planWellSearch(bot, { home, read, avoid })) : planWellSearch(bot, { home, read, avoid })),\n',
    '    compute: () => (searched = canonicalWellSite({ home, read, avoid })),\n', async m => {
      await withFirst(async () => {
        const town = kitTown()
        const r = await within(m.SKILLS.build_well.run({ bot: town.bot }, {}, { aborted: false }), 15000, 'mutant')
        assert.equal(r.status, 'success', 'mutant inert')
      })
    })
})
await t('MUTANT (skills): plinth-first\'s site rule dropped -> the recorded fresh natural site is built', async () => {
  await withMutant(SP, '      return why ?? pf\n', '      return why\n', async m => {
    await withFirst(async () => {
      const dir = mkdtempSync(path.join(tmpdir(), 'well-store-')); assert.ok(PCm.createSiteGen(dir, SITE_KEY, 1, CAP, null))
      const town = kitTown({ storeDir: dir })
      const r = await within(m.SKILLS.build_well.run({ bot: town.bot }, {}, { aborted: false }), 15000, 'mutant')
      assert.equal(r.status, 'success', 'mutant inert')
    })
  })
})
await t('THE REFUSAL CHAIN (plinth-first): build_well declines the natural site -> the town\'s plinth order is given to the same bot where it stands -> build_plinth plans the raised well; from 13 below home, no order', async () => {
  await withFirst(async () => {
    const town = kitTown()
    assert.equal((await run('build_well', town.bot)).failClass, 'well_no_site_policy')
    const st = townPlinthState(town.bot)
    const order = dy => PF.plinthOrder({ now: Date.now(), distHome: 0, dy, inside: false, want: st.want, lease: st.lease, budget: 0 }).order
    assert.equal(order(0)?.skill, 'build_plinth', 'a planning visit needs no funds')
    assert.equal(order(-13), null, 'not from a mine below the town')
    const p = await run('build_plinth', town.bot)
    assert.match(p.detail, /planned the town's raised junk well at/, p.detail)
    const rec = readJ(PLINTH_FILE(process.env.POOL_STATE_DIR))
    assert.equal(rec?.state, 'plan'); assert.equal(rec.plannedFor, 'no_site')
    assert.ok(rec.plan.k >= PF.PLINTH_FIRST_MIN_RAISE, `a raised plan on intact ground (k=${rec.plan.k}), not the bare natural cell`)
    assert.match((await rows('_plinth')).filter(x => /^stage=planned/.test(x.skill.detail)).pop()?.skill.detail ?? '', / why=trigger_no_site/)
  })
})
}

// ===================================================================================================================
// junkout-01 (docs/reports/junkout-01-design-2026-10-21.md section 3 A): THE WELL AT EVERY TOWN VISIT, through the REAL
// CognitiveLoop and the REAL dispose_well on the fake town. A NOT-full bag with listed junk, in the town zone, near the well:
// the visit order comes, it throws the listed junk ONLY (cobble and everything else stay), and no second visit order comes in
// the same visit. A breached well gets none (no loop). MUTANT: the loop's visit call removed -> no order (the defect today).
// ===================================================================================================================
{
  const { Lessons } = await import('../src/lessons.mjs')
  const { CognitiveLoop } = await import('../src/cognitive.mjs')
  const ldir = mkdtempSync(path.join(tmpdir(), 'mcai-junkout-'))
  let lseq = 0
  const freshLessons = () => { const L = new Lessons(path.join(ldir, `l${lseq++}.json`)); L.data.avoid = {}; L.data.worked = {}; return L }
  const CP = new URL('../src/cognitive.mjs', import.meta.url)
  /** A real loop; dispose_well RUNS (the real skill), every other skill succeeds as a probe. Records skill + args. */
  async function visitLoop (town, { n = 4, Loop = CognitiveLoop, maxMs = 8000, until = null } = {}) {
    Object.assign(town.bot, { oxygenLevel: 300, time: { day: 1, age: 1, timeOfDay: 1000 }, game: { dimension: 'overworld' }, experience: { level: 0 }, isInWater: false })
    const fb = town.bot.findBlocks
    town.bot.findBlocks = o => (typeof o?.matching === 'function' ? fb(o) : [])
    const ran = []
    const runner = { isBusy: () => false, run: async (skill, args) => {
      const rec = { skill, args: args ?? {}, slots: town.bot.inventory.items().length }
      ran.push(rec)
      if (skill === 'dispose_well') { const r = await within(SKILLS.dispose_well.run({ bot: town.bot }, args ?? {}, { aborted: false }), 15000, 'dispose'); rec.status = r.status; return { ...r, delta: {} } }
      return { status: 'success', detail: 'ok', delta: {}, contractEvidence: [`${skill}: probe 1`] }
    } }
    const loop = new Loop(town.bot, runner, freshLessons(), null)
    loop.llm = { decide: async () => ({ schemaValid: true, latencyMs: 1, proposal: { skill: 'status', args: {}, reason: 'probe' } }) }
    loop.milestones.cycle = 540
    const pace = config.llm.decisionCooldownMs
    config.llm.decisionCooldownMs = 50
    try {
      loop.start()
      for (const t0 = Date.now(); Date.now() - t0 < maxMs && ran.length < n && !(until && until(ran)); ) await new Promise(r => setTimeout(r, 30))
      loop.stop()
    } finally { config.llm.decisionCooldownMs = pace }
    return { ran, loop }
  }
  const visitBag = () => [S('egg', 16), S('flint', 64), S('ink_sac', 10), ...filler(5)]
  await t('junkout-01 CHAIN (real loop): a NOT-full bag with listed junk at town -> dispose_well {visit} -> the listed junk goes, the cobble stays -> no second visit order in the visit', async () => {
    const town = fakeTown({ wellAt: CAP, items: visitBag(), botAt: new Vec3(HOME.x + 0.5, HOME.y, HOME.z + 0.5) })
    const cobble0 = town.count('cobblestone')
    const { ran, loop } = await visitLoop(town, { n: 5 })
    const d = ran.filter(x => x.skill === 'dispose_well')
    assert.equal(d.length, 1, `one visit dispose: ${JSON.stringify(ran.map(x => x.skill))}`)
    assert.equal(d[0].args.visit, true); assert.ok(d[0].slots < 34, `below the trigger: ${d[0].slots}`)
    assert.ok(Number.isFinite(d[0].args.dw) && d[0].args.dw <= 20, `the well within reach: ${d[0].args.dw}`)
    assert.equal(d[0].status, 'success')
    for (const n of ['egg', 'flint', 'ink_sac']) assert.equal(town.count(n), 0, `${n} down the well`)
    assert.equal(town.count('cobblestone'), cobble0, 'nothing else changes')
    assert.equal(loop.wellVisitState.latched, true, 'the visit is spent')
    const row = (await rows('_junkout')).filter(x => /^phase=well /.test(x.skill.detail)).pop()
    assert.match(row?.skill?.detail ?? '', /^phase=well vid=\S+ armed=first dh=\d+ dy=-?\d+ dw=\d+ offlist=0 swords=0 cobble=0 stock=0 slots=8->5 listed=3 n=90 status=success/)
  })
  await t('junkout-01 CHAIN (real loop): the latch is TICKED on every decision -- a bot outside the zone starts the outside clock though no visit order runs', async () => {
    const town = fakeTown({ wellAt: CAP, items: visitBag(), botAt: new Vec3(HOME.x + 30.5, HOME.y, HOME.z + 0.5) })
    const { ran, loop } = await visitLoop(town, { n: 2 })
    assert.ok(!ran.some(x => x.skill === 'dispose_well' && x.args.visit), `no visit order 30 from home: ${JSON.stringify(ran.map(x => x.skill))}`)
    assert.ok(Number.isFinite(loop.wellVisitState?.outsideSince), 'the outside clock runs')
  })
  await t('junkout-01 CHAIN (real loop): a BREACHED well gets no visit order -- no loop, the bot keeps its turns', async () => {
    const town = fakeTown({ wellAt: CAP, items: visitBag(), botAt: new Vec3(HOME.x + 0.5, HOME.y, HOME.z + 0.5), blocks: { [`${CAP.x + 1},${CAP.y},${CAP.z + 1}`]: 'air' } })
    const { townWellState: TWS } = await import('../src/skills.mjs')
    assert.equal(TWS(town.bot)?.breached, true, 'positive control: the fake well reads breached')
    const { ran } = await visitLoop(town, { n: 4 })
    assert.ok(ran.length >= 4 && !ran.some(x => x.skill === 'dispose_well'), JSON.stringify(ran.map(x => x.skill)))
  })
  await t('junkout-01 MUTANT (cognitive): the loop\'s visit call removed -> the not-full bag of junk gets no well order (the defect the change fixes)', async () => {
    const src = readFileSync(CP, 'utf8')
    const old = '      const visit = this.#visitOrder(milestone, { tickOnly: blocked })\n'
    assert.equal(src.split(old).length, 2, 'ANCHOR missing or not unique')
    const out = new URL(`./_mutant-cog-jo-${process.pid}.mjs`, import.meta.url)
    writeFileSync(out, src.replace(old, '      const visit = null\n').replace(/from '\.\//g, "from '../src/"))
    try {
      const { CognitiveLoop: M } = await import(out.href)
      const town = fakeTown({ wellAt: CAP, items: visitBag(), botAt: new Vec3(HOME.x + 0.5, HOME.y, HOME.z + 0.5) })
      const { ran } = await visitLoop(town, { n: 4, Loop: M })
      assert.ok(!ran.some(x => x.skill === 'dispose_well'), 'mutant inert')
      assert.equal(town.count('egg'), 16, 'the junk rides out of town again')
    } finally { try { unlinkSync(out) } catch {} }
  })
}

console.log(`\n${pass} passed, ${fail} failed${failed.length ? `\n  ${failed.join('\n  ')}` : ''}`)
process.exit(fail ? 1 : 0)
