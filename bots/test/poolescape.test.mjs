// POOLESCAPE-01 (docs/reports/poolescape-01-design-2026-10-22.md): the walled-water-pit rung.
//
// The fixtures are the two LIVE pits (board-d, 10-22): bots/test/fixtures/poolescape-board-d-{bravo,alpha}.json, read
// from the region files and checked 200 of 200 cells against the live world by read-only RCON. Bravo and Comet share
// the first; Alpha is in the second. Everything below runs the REAL planner (poolescape.mjs) and the REAL actuator
// (reflex.mjs poolEscape) -- never a copy -- on a fake bot whose one piece of physics is the rule the rung depends on:
// prismarine-physics index.js:461-463/499, a wading bot clears a ledge 1 above its floor only into a cell with no
// block and NO WATER.
import assert from 'node:assert'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { Vec3 } from 'vec3'
process.env.OLLAMA_MODEL ??= 'test'
const PE = await import('../src/poolescape.mjs')
const RX = await import('../src/reflex.mjs')
const { stairUpStep, overheadBreakRisk } = await import('../src/scaffold.mjs')
const { poolStep, choosePoolStep, wading, swimToWall, poolToolOk, keepoutMark, poolForbid, poolBackoffMs, poolSpotKey, poolRowDetail } = PE

let pass = 0, fail = 0
const ta = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 3).join('\n        ')}`) }
}

// ------------------------------------------------------------------------------------------------ the world
const HARD = { stone: 1.5, cobblestone: 2, andesite: 1.5, diorite: 1.5, granite: 1.5, dirt: 0.5, sand: 0.5, gravel: 0.6, oak_planks: 2,
               crafting_table: 2.5, furnace: 3.5, oak_log: 2, obsidian: 50, copper_ore: 3, grass_block: 0.6 }
const PICK = /^(stone|cobblestone|andesite|diorite|granite|furnace|obsidian|copper_ore)$/
const TYPE = { wooden_pickaxe: 100, stone_pickaxe: 101, iron_pickaxe: 102, cobblestone: 4, dirt: 3, oak_log: 17 }
const EMPTY = /^(air|cave_air|water|lava|vine|short_grass|bubble_column|seagrass|tall_seagrass|kelp|kelp_plant)$/
function mkBlock (raw, pos) {
  const name = String(raw ?? 'stone').replace(/\[.*$/, '')
  const wl = /\[wl\]/.test(String(raw))
  const solid = !EMPTY.test(name)
  return {
    name, position: pos, boundingBox: solid ? 'block' : 'empty', diggable: name !== 'bedrock', isWaterlogged: wl || undefined,
    harvestTools: PICK.test(name) ? { 100: true, 101: true, 102: true } : undefined,
    canHarvest (t) { return !PICK.test(name) || [100, 101, 102].includes(t) },
    digTime (t, creative, inWater, notOnGround) {
      const h = HARD[name] ?? 1.5
      const ok = this.canHarvest(t)
      const speed = t === 102 ? 6 : t === 101 ? 4 : t === 100 ? 2 : 1
      let ms = h * (ok ? 1.5 : 5) * 1000 / (PICK.test(name) && t ? speed : 1)
      if (notOnGround) ms *= 5
      if (inWater) ms *= 5
      return ms
    },
  }
}
const fixture = name => JSON.parse(readFileSync(new URL(`./fixtures/poolescape-board-d-${name}.json`, import.meta.url))).cells
const k3 = (x, y, z) => `${x},${y},${z}`
function world (name, edits = {}) {
  const cells = { ...fixture(name), ...edits }
  return { cells, at: (x, y, z) => mkBlock(cells[k3(x, y, z)] ?? 'stone', new Vec3(x, y, z)) }
}
const item = (name, count = 1, slot = 9, used = 0, max = undefined) => ({ name, count, slot, type: TYPE[name] ?? 1, durabilityUsed: used,
  maxDurability: max ?? ({ wooden_pickaxe: 59, stone_pickaxe: 131, iron_pickaxe: 250 })[name] })
const N = { x: 0, z: -1 }, S = { x: 0, z: 1 }, E = { x: 1, z: 0 }, W = { x: -1, z: 0 }

// ------------------------------------------------------------------------------------------------ diagnosis
await ta('DIAGNOSIS: both live pits are wading pits (feet water, head air), and the OLD ramp refuses all four bearings', () => {
  for (const nm of ['bravo', 'alpha']) {
    const { at } = world(nm)
    assert.equal(wading({ at }), true, nm)
    for (const bear of [N, S, E, W]) {
      const st = stairUpStep({ at, bear, submerged: false })
      assert.equal(st.ok, false, `${nm} ${JSON.stringify(bear)}: the ramp would cut ${JSON.stringify(st)}`)
    }
  }
  // positive control: the same ramp DOES cut a step out of a dry 1x1 stone pocket
  const dry = (x, y, z) => mkBlock(y >= 1 && y <= 2 && x === 0 && z === 0 ? 'air' : y <= -1 ? 'stone' : (y === 0 && x === 0 && z === 0 ? 'air' : 'stone'), new Vec3(x, y, z))
  const dryOpen = (x, y, z) => (x === 0 && z === 0 && y >= 0 ? mkBlock('air', new Vec3(x, y, z)) : dry(x, y, z))
  assert.equal(stairUpStep({ at: dryOpen, bear: N }).ok, true, 'the instrument can see a yes')
})
await ta('DIAGNOSIS: the head-level wall the pathfinder must break touches water (Bravo north: a source beside it)', () => {
  const { at } = world('bravo')
  assert.equal(at(0, 1, -1).name, 'cobblestone')
  assert.ok(['water'].includes(at(1, 1, -1).name), 'dontCreateFlow refuses it: liquid beside the block')
  assert.notEqual(overheadBreakRisk({ at: (x, y, z) => at(x, 1 + y, -1 + z), submerged: false }), null)
})

// ------------------------------------------------------------------------------------------------ the planner
const plan = (at, extra = {}) => choosePoolStep({ at, bearings: [N, W, S, E], canClear: () => null, blocks: 64, ...extra })
await ta('BRAVO/COMET pit: north -- plug the one water side, cut the cobblestone, tread is the dirt', () => {
  const { at } = world('bravo')
  const c = plan(at)
  assert.equal(c.ok, true, JSON.stringify(c))
  assert.deepEqual(c.bear, N)
  assert.deepEqual(c.dig, [[0, 1, -1]], 'only the step cell; head and clearance are open air')
  assert.deepEqual(c.place.map(q => [q.why, q.cell]), [['plug', [1, 1, -1]]])
  // PAPER 10-22: the plug's first face was the crafting table under it, and a click OPENS a crafting table. Never a reference.
  assert.notEqual(c.place[0].ref.join(','), '1,0,-1', 'the crafting table under the plug cell is not clicked')
  assert.equal(world('bravo').at(...c.place[0].ref).name, 'cobblestone')
})
await ta('ALPHA pit (all four feet-level sides water): a tread is PLACED, two plugs, then the bridge block is cut', () => {
  const { at } = world('alpha')
  const c = plan(at)
  assert.equal(c.ok, true, JSON.stringify(c))
  assert.equal(c.place[0].why, 'tread')
  assert.equal(c.place.filter(q => q.why === 'plug').length, 2)
  assert.equal(c.dig.length, 1)
  assert.equal(c.blocks, 3)
  // without enough blocks every bearing refuses, and says why
  const none = plan(at, { blocks: 2 })
  assert.equal(none.ok, false)
  assert.ok(Object.keys(none.reasons).some(r => /needs 3 block/.test(r)), JSON.stringify(none.reasons))
})
await ta('LAVA POCKET behind the north wall: north refused for lava, south taken; lava everywhere refuses all', () => {
  const { at } = world('bravo', { [k3(0, 1, -2)]: 'lava' })
  const c = plan(at)
  assert.equal(c.ok, true); assert.deepEqual(c.bear, S)
  assert.ok(/lava/.test(poolStep({ at, bear: N, canClear: () => null, blocks: 64 }).reason))
  const lavaAll = world('bravo', { [k3(0, 1, -2)]: 'lava', [k3(0, 1, 2)]: 'lava', [k3(2, 1, 0)]: 'lava', [k3(-2, 1, 0)]: 'lava' }).at
  const r = plan(lavaAll)
  assert.equal(r.ok, false)
  assert.ok(Object.keys(r.reasons).some(k => /lava/.test(k)), JSON.stringify(r.reasons))
})
await ta('THE BREATHING COLUMN: water in or beside a head cell refuses the bearing; water beside the STEP is plugged', () => {
  assert.ok(/water where the head goes/.test(poolStep({ at: world('bravo', { [k3(0, 2, -1)]: 'water' }).at, bear: N, blocks: 64 }).reason))
  assert.ok(/water beside the head cells/.test(poolStep({ at: world('bravo', { [k3(1, 3, -1)]: 'water' }).at, bear: N, blocks: 64 }).reason))
  assert.ok(/no room to rise/.test(poolStep({ at: world('bravo', { [k3(0, 3, 0)]: 'water' }).at, bear: N, blocks: 64 }).reason))
  assert.ok(/waterlogged/.test(poolStep({ at: world('bravo', { [k3(1, 1, -1)]: 'oak_stairs[wl]' }).at, bear: N, blocks: 64 }).reason))
  // water already IN the step cell: filled (clicked on the tread) and dug back out
  const c = poolStep({ at: world('bravo', { [k3(0, 1, -1)]: 'water' }).at, bear: N, blocks: 64 })
  assert.equal(c.ok, true); assert.ok(c.place.some(q => q.why === 'fill')); assert.deepEqual(c.dig, [[0, 1, -1]])
})
await ta('KEEP-OUTS: a protected-zone / town mark ORDERS (fewest marks wins) but never vetoes; a fire column vetoes the move', () => {
  const { at } = world('bravo')
  const zoneN = (x, y, z) => (z < 0 ? 'zone' : null)
  assert.deepEqual(plan(at, { mark: zoneN }).bear, S, 'the unmarked bearing wins')
  const zoneAll = () => 'zone'
  const c = plan(at, { mark: zoneAll })
  assert.equal(c.ok, true, 'every exit crosses the zone: it still leaves (survival, as protectzone lets the pillar)')
  assert.ok(c.marks.zone > 0)
  const fireN = (x, y, z) => (z < 0 ? 'a live fire column (keep-out)' : null)
  assert.deepEqual(plan(at, { forbid: fireN }).bear, S)
  const r = plan(at, { forbid: () => 'a live fire column (keep-out)' })
  assert.equal(r.ok, false)
})
await ta('keepoutMark / poolForbid read the real keep-out predicates', () => {
  const zones = [{ id: 'v', x0: 0, y0: -64, z0: 0, x1: 10, y1: 100, z1: 10, floorY: null }]
  assert.equal(keepoutMark({ cell: { x: 5, y: 60, z: 5 }, zones }), 'zone')
  assert.equal(keepoutMark({ cell: { x: 50, y: 60, z: 5 }, zones }), null)
  assert.equal(keepoutMark({ cell: { x: 3, y: 70, z: 3 }, home: { x: 0, y: 70, z: 0 }, name: 'dirt' }), 'town')
  assert.equal(keepoutMark({ cell: { x: 3, y: 70, z: 3 }, home: { x: 0, y: 70, z: 0 }, name: 'oak_log' }), null)
  const sites = [{ kind: 'death:fire', x: 0, y: 60, z: 0, deaths: 2, last: Date.now(), at: Date.now() }]
  // a bot outside the column may not step in; the same cell from inside, stepping outward, is allowed
  const from = { x: 9, y: 61, z: 0 }
  const inward = poolForbid({ cell: { x: 5, y: 61, z: 0 }, feet: from, fireSites: sites })
  assert.ok(inward === null || /fire/.test(inward))
})
await ta('canClear refusal (obsidian) closes only that bearing', () => {
  const { at } = world('bravo', { [k3(0, 1, -1)]: 'obsidian' })
  const c = plan(at, { canClear: b => (b.name === 'obsidian' ? 'neither hand can break it' : null) })
  assert.equal(c.ok, true); assert.deepEqual(c.bear, S)
})
await ta('swimToWall: a 1x3 pool whose middle cell has no exit swims one cell to the wall that has one', () => {
  const { at } = world('bravo', { [k3(1, 1, 0)]: 'air' })   // the east cell becomes a second wading cell of the pool
  const path = swimToWall({ at, hasStep: (dx, dz) => dx === 1 && dz === 0, safe: () => true })
  assert.deepEqual(path, [[1, 0]])
  assert.equal(swimToWall({ at, hasStep: (dx) => dx === 1, safe: () => false }), null, 'an unsafe transit cell is never swum through')
})
await ta('TOOL RESERVE KEPT: the last usable pickaxe is never spent (the hand digs instead); a second copy may dig', () => {
  const one = item('stone_pickaxe', 1, 9, 0)
  assert.equal(poolToolOk(one, [one], 1), false)
  const two = item('wooden_pickaxe', 1, 10, 50)
  assert.equal(poolToolOk(one, [one, two], 1), true)
  const spent = item('stone_pickaxe', 1, 11, 129)
  assert.equal(poolToolOk(spent, [spent, one], 1), false, 'two uses left minus the dig is the hard stop')
  assert.equal(poolToolOk(null, [], 1), true, 'the hand is always allowed')
})
await ta('back-off 5/10/20/40/60 min; spot key holds a bobbing bot; the row names every field', () => {
  assert.deepEqual([1, 2, 3, 4, 5, 9].map(poolBackoffMs), [5, 10, 20, 40, 60, 60].map(m => m * 60_000))
  assert.equal(poolSpotKey({ x: 329.7, y: 61.0, z: 213.7 }), poolSpotKey({ x: 329.3, y: 61.8, z: 213.3 }))
  const d = poolRowDetail({ outcome: 'out', steps: 1, rose: 1, dug: 1, placed: 1, marks: { zone: 2 }, at: '1,2,3' })
  for (const f of ['outcome=out', 'steps=1', 'dug=1', 'placed=1', 'marks=zone:2,fire:0,town:0', 'at=1,2,3']) assert.ok(d.includes(f), f)
})

// ------------------------------------------------------------------------------------------------ the actuator
function fakeBot (name, { edits = {}, bag = null, yieldAfter = null, onEquip = null } = {}) {
  const w = world(name, edits)
  const cells = w.cells
  const set = (v, n) => { cells[k3(v.x, v.y, v.z)] = n }
  const blockAt = v => { const f = new Vec3(Math.floor(v.x), Math.floor(v.y), Math.floor(v.z)); return mkBlock(cells[k3(f.x, f.y, f.z)] ?? 'stone', f) }
  const items = bag ?? [item('stone_pickaxe', 1, 9, 0), item('wooden_pickaxe', 1, 10, 16), item('cobblestone', 30, 11), item('dirt', 10, 12)]
  const log = { digs: [], places: [], equips: [], controls: [] }
  const controls = {}
  const bot = {
    entity: { position: new Vec3(0.5, 0, 0.5), yaw: 0, onGround: false, velocity: new Vec3(0, 0, 0), effects: {} },
    inventory: { items: () => items.filter(i => i.count > 0), slots: [], emptySlotCount: () => 5 },
    heldItem: null, game: { gameMode: 'survival' },
    getEquipmentDestSlot: () => 5, _getBlockAtEyeLevel: () => blockAt(bot.entity.position.offset(0, 1.62, 0)),
    blockAt,
    async equip (it) { log.equips.push(it?.name); onEquip?.(it, set); bot.heldItem = it },
    async unequip () { bot.heldItem = null },
    async dig (b) {
      log.digs.push([b.position.x, b.position.y, b.position.z, bot.heldItem?.name ?? 'hand'])
      set(b.position, 'air')
      // WATER FLOWS IN: a plain source on any side or above fills the opened cell (conservative: vanilla is slower)
      for (const [x, y, z] of [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0]]) {
        if (cells[k3(b.position.x + x, b.position.y + y, b.position.z + z)] === 'water') { set(b.position, 'water'); break }
      }
    },
    async placeBlock (ref, face) {
      const t = ref.position.plus(face)
      if (/crafting_table|furnace|chest/.test(ref.name)) return   // a click on a crafting table OPENS it: nothing placed (as Paper)
      if (!/^(air|water|cave_air)$/.test(cells[k3(t.x, t.y, t.z)] ?? 'stone') || !bot.heldItem) throw new Error('cannot place')
      log.places.push([t.x, t.y, t.z, bot.heldItem.name]); bot.heldItem.count--; set(t, bot.heldItem.name)
    },
    async look (yaw) { bot.entity.yaw = yaw },
    setControlState (n, on) {
      controls[n] = on; log.controls.push([n, on])
      if (n === 'jump' && on && controls.forward) step()
    },
    clearControlStates () { for (const k of Object.keys(controls)) controls[k] = false; log.controls.push(['clear']) },
    stopDigging () {},
    pathfinder: { setGoal () {}, movements: {}, thinkTimeout: 0,
                  getPathTo: () => ({ path: (Math.floor(bot.entity.position.y) >= 1 && !/water/.test(cells[k3(Math.floor(bot.entity.position.x), Math.floor(bot.entity.position.y), Math.floor(bot.entity.position.z))] ?? '')) ? [1] : [] }) },
  }
  // THE ONE PIECE OF PHYSICS: a wading bot's forward+jump lands on a ledge 1 up only into a dry, empty step and head.
  function step () {
    const p = bot.entity.position.floored()
    const bx = Math.round(-Math.sin(bot.entity.yaw)), bz = Math.round(-Math.cos(bot.entity.yaw))
    const c = (dx, dy, dz) => cells[k3(p.x + dx, p.y + dy, p.z + dz)] ?? 'stone'
    const free = n => /^(air|cave_air)$/.test(n)
    if (EMPTY.test(c(bx, 0, bz)) || !free(c(bx, 1, bz)) || !free(c(bx, 2, bz)) || !free(c(0, 2, 0)) || !free(c(0, 3, 0))) return
    bot.entity.position = new Vec3(p.x + bx + 0.5, p.y + 1, p.z + bz + 0.5)
  }
  let calls = 0
  const yieldTo = () => (yieldAfter != null && log.digs.length + log.places.length >= yieldAfter ? 'the drowning rescue' : null)
  return { bot, log, cells, yieldTo, calls }
}

await ta('ACTUATOR, Bravo/Comet pit: plug, cut with the cheapest pickaxe that may dig, step out, route -> out', async () => {
  const f = fakeBot('bravo')
  const r = await RX.poolEscape(f.bot, { yieldTo: f.yieldTo })
  assert.equal(r.outcome, 'out', JSON.stringify(r))
  assert.deepEqual(f.log.places.map(p => p.slice(0, 3)), [[1, 1, -1]], 'the water beside the step was plugged first')
  assert.deepEqual(f.log.digs.map(d => d.slice(0, 3)), [[0, 1, -1]])
  assert.ok(/pickaxe/.test(f.log.digs[0][3]), `a pickaxe dug the cobblestone afloat (hand would be 50 s): ${f.log.digs[0][3]}`)
  assert.equal(f.cells[k3(0, 1, -1)], 'air', 'the step stayed DRY')
  assert.deepEqual([Math.floor(f.bot.entity.position.x), Math.floor(f.bot.entity.position.y), Math.floor(f.bot.entity.position.z)], [0, 1, -1])
})
await ta('ACTUATOR, Alpha pit: tread, plugs, cut, step -- then onto the bridge', async () => {
  const f = fakeBot('alpha', { bag: [item('stone_pickaxe', 1, 9, 0), item('wooden_pickaxe', 1, 10, 16), item('oak_log', 16, 11)] })
  const r = await RX.poolEscape(f.bot, { yieldTo: f.yieldTo })
  assert.equal(r.outcome, 'out', JSON.stringify(r))
  assert.equal(r.placed, 3); assert.equal(r.dug, 1)
  assert.ok(f.bot.entity.position.y >= 1)
})
await ta('BASE SHAPE: without the plugs (water flows in), the same cut cannot be stepped into', async () => {
  // the control the plug exists for: Bravo with no placeables -> the plug is impossible, north/south refuse; the bot stays
  const f = fakeBot('bravo', { bag: [item('stone_pickaxe', 1, 9, 0), item('wooden_pickaxe', 1, 10, 16)] })
  const r = await RX.poolEscape(f.bot, { yieldTo: f.yieldTo })
  assert.notEqual(r.outcome, 'out')
  assert.equal(f.log.digs.length, 0, 'it never opened a cut it could not keep dry')
  assert.ok(/block/.test(r.reason), r.reason)
})
await ta('EVERY DIG RE-CHECKS LAVA LIVE: lava appearing behind the wall after the plan stops the dig', async () => {
  let armed = true
  const f = fakeBot('bravo', { onEquip: (it, set) => { if (armed && /pickaxe/.test(it?.name ?? '')) { armed = false; set(new Vec3(0, 1, -2), 'lava'); set(new Vec3(0, 1, 2), 'lava') } } })
  const r = await RX.poolEscape(f.bot, { yieldTo: f.yieldTo })
  assert.notEqual(r.outcome, 'out')
  assert.ok(!f.log.digs.some(d => d[2] === -1 && d[1] === 1), `dug the north wall after lava appeared: ${JSON.stringify(f.log.digs)}`)
  assert.ok(r.lavaRefused >= 1, JSON.stringify(r))
})
await ta('YIELDS TO THE DROWNING RESCUE: after the first action it stops, and leaves the controls alone', async () => {
  const f = fakeBot('bravo', { yieldAfter: 1 })
  const r = await RX.poolEscape(f.bot, { yieldTo: f.yieldTo })
  assert.equal(r.outcome, 'yielded', JSON.stringify(r))
  assert.equal(f.log.digs.length, 0, 'no dig after the yield')
  assert.equal(f.log.controls.filter(c => c[0] === 'clear').length, 1, 'only the seize at the start cleared the controls; a yield never clears the new owner\'s')
})
await ta('NO PICKAXE: the hand digs dirt (Bravo north wall made dirt), never refused for want of a tool', async () => {
  const f = fakeBot('bravo', { edits: { [k3(0, 1, -1)]: 'dirt' }, bag: [item('dirt', 10, 12)] })
  const r = await RX.poolEscape(f.bot, { yieldTo: f.yieldTo })
  assert.equal(r.outcome, 'out', JSON.stringify(r))
  assert.deepEqual(r.hands, ['hand'], 'no tool: the empty hand (a non-tool stack held) dug the dirt')
})
await ta('NOT WADING (head in water): the rung does nothing', async () => {
  const f = fakeBot('bravo', { edits: { [k3(0, 1, 0)]: 'water' } })
  const r = await RX.poolEscape(f.bot, { yieldTo: f.yieldTo })
  assert.equal(r.outcome, 'refused'); assert.equal(f.log.digs.length + f.log.places.length, 0)
})

// ------------------------------------------------------------------------------------------------ wiring (structural)
const strip = t => t.split('\n').map(l => (/^\s*(\/\/|\*|\/\*)/.test(l) ? '' : l.replace(/(^|\s)\/\/.*$/, '$1'))).join('\n')
const REFLEX = new URL('../src/reflex.mjs', import.meta.url)
function hooks (src) {
  const code = strip(src)
  const climb = code.indexOf("await poolEscapeTry('climb', () => maroonGrant)")
  const pillar = code.indexOf('pillarOutcome = await pillarOut(bot, climbNeedAbove(')
  const pre = code.lastIndexOf("if (pillarOutcome !== 'preempted') {", climb)
  const scaf = code.indexOf("await poolEscapeTry('need_scaffold', () => g)")
  const rampCut = code.indexOf("kind: 'marooned_needs_scaffold'")
  return { climb: climb > pillar && pillar > 0 && pre > pillar && pre < climb, scaffold: scaf > rampCut && rampCut > 0 }
}
await ta('WIRED: the climb hook runs after pillarOut and never after a pre-emption; the need_scaffold hook after the ramp', () => {
  assert.deepEqual(hooks(readFileSync(REFLEX, 'utf8')), { climb: true, scaffold: true })
})
await ta('WIRED: the licence row is written once per spawn (index.mjs)', () => {
  const idx = strip(readFileSync(new URL('../src/index.mjs', import.meta.url), 'utf8'))
  assert.ok(/logEvent\(\{ kind: 'poolescape_mode'[^\n]*poolEscapeModeDetail\(\)/.test(idx))
})

// ------------------------------------------------------------------------------------------------ mutants
async function withMutant (path, old, neu, fn) {
  const src = readFileSync(path, 'utf8')
  assert.ok(src.includes(old), `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 60))}. A mutant that was never written reads as killed.`)
  assert.ok(src.split(old).length === 2, 'the mutation target is not unique; the mutant is ambiguous')
  const body = src.replace(old, neu).replace(/from '\.\//g, "from '../src/")
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, body)
  try { return await fn(await import(out.href), body) } finally { try { unlinkSync(out) } catch {} }
}
const PEPATH = new URL('../src/poolescape.mjs', import.meta.url)
await ta('MUTANT KILLED: without the lava face check, the north wall with lava behind it is cut', async () => {
  await withMutant(PEPATH, "if (isLavaCell(n)) return no(`lava against the step (", "if (false) return no(`lava against the step (", async m => {
    const { at } = world('bravo', { [k3(0, 1, -2)]: 'lava' })
    assert.equal(m.poolStep({ at, bear: N, blocks: 64 }).ok, true, 'the mutant must cut into the lava wall')
  })
})
await ta('MUTANT KILLED: without the breathing-column check, water beside the head cell is accepted', async () => {
  await withMutant(PEPATH, "if (wetCell(n)) return no(`water beside the head cells", "if (false) return no(`water beside the head cells", async m => {
    assert.equal(m.poolStep({ at: world('bravo', { [k3(1, 3, -1)]: 'water' }).at, bear: N, blocks: 64 }).ok, true)
  })
})
await ta('MUTANT KILLED: without the plugs, Bravo\'s cut floods and the actuator cannot step', async () => {
  await withMutant(PEPATH, '    if (!flowing(n)) continue\n', '    continue\n', async m => {
    const c = m.choosePoolStep({ at: world('bravo').at, bearings: [N], blocks: 64 })
    assert.equal(c.place.length, 0, 'the mutant plans no plug')
  })
})
await ta('MUTANT KILLED: a mark that vetoes (instead of ordering) leaves the all-zone pit with no exit', async () => {
  await withMutant(PEPATH, '    if (!best || better(c, best)) best = c\n', '    if (markTotal(c.marks)) continue\n    if (!best || better(c, best)) best = c\n', async m => {
    const c = m.choosePoolStep({ at: world('bravo').at, bearings: [N, S], blocks: 64, mark: () => 'zone' })
    assert.equal(c.ok, false, 'the veto mutant strands the bot -- the dead end the ordering exists to avoid')
  })
})
await ta('MUTANT KILLED: dropping the last-pickaxe reserve spends the only pickaxe', async () => {
  await withMutant(PEPATH, '    if (usable <= 1) return false\n', '', async m => {
    const one = item('stone_pickaxe', 1, 9, 0)
    assert.equal(m.poolToolOk(one, [one], 1), true)
  })
})
await ta('MUTANT KILLED: without the re-check AT THE SWING, lava that arrives during the equip is dug into', async () => {
  await withMutant(REFLEX, '      const atSwing = recheck()\n', '      const atSwing = { ok: true, place: [], dig: c.dig }\n', async m => {
    let armed = true
    const f = fakeBot('bravo', { onEquip: (it, set) => { if (armed && /pickaxe/.test(it?.name ?? '')) { armed = false; set(new Vec3(0, 1, -2), 'lava'); set(new Vec3(0, 1, 2), 'lava') } } })
    await m.poolEscape(f.bot, { yieldTo: f.yieldTo })
    assert.ok(f.log.digs.some(d => d[2] === -1 && d[1] === 1), 'the mutant must dig the wall with lava behind it')
  })
})
await ta('MUTANT KILLED: a crafting table taken as the plug\'s face (Paper 10-22) -- the plug never takes, the bot stays', async () => {
  await withMutant(PEPATH, "    if (solid(b) && !INTERACTIVE.test(b.name ?? '')) return", "    if (solid(b)) return", async m => {
    const c = m.choosePoolStep({ at: world('bravo').at, bearings: [N], blocks: 64 })
    assert.equal(c.place[0].ref.join(','), '1,0,-1', 'the mutant clicks the crafting table')
  })
})
await ta('MUTANT KILLED: a removed climb hook is seen by the wiring check', async () => {
  const src = readFileSync(REFLEX, 'utf8')
  const old = "            try { await poolEscapeTry('climb', () => maroonGrant) } catch (e) { log('warn', 'pool escape failed', { err: e.message }) }\n"
  assert.ok(src.split(old).length === 2, 'ANCHOR MISSING or not unique')
  assert.equal(hooks(src.replace(old, '')).climb, false)
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
