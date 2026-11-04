// DROPANDDIG-01: dig the air pocket STANDING (bots/src/dropdig.mjs; docs/reports/dropdig-01-2026-11-04.md).
//
// What this file proves, by BEHAVIOUR (CLAUDE.md: decisions extracted and driven, never matched as text):
//   S. the sink under prismarine-physics 1.11.1 at 1.21.8 (the real physics, a real block world): from the pinned N.2 pose
//      the body reaches a floor 1 down and 2 down inside the deadline the admission prices;
//   R. the REAL sites: every time-budget-refused drowning since apseal-01 (11 deaths, 59.75 h), cut from the 11-04 03:16Z
//      backup's region copies, with each refusal's own health/need/budget. Positive control: the floating plan is OK at
//      every site (the refusal was on time, not geometry). Which ones drop, which do not, and why;
//   P. the floor rule's hazards (magma, soul sand, mud, a slab, kelp/seagrass/bubble/current in the descent, unknown
//      cells, a neighbour column the body overlaps, the eye cell), the reach, the price;
//   E. eligibility: off, the pre-empt's worst case, already standing, a non-budget refusal, a failed cell's memory;
//   B. the step (airPocketStep with plan.drop) on a physics-driven fake bot: floor 1 and 2 down -> success standing;
//      no landing -> nothing dug, the short cooldown, the cell remembered; a lift-off mid-dig -> stopped;
//   C. the REFUSAL CHAIN: drop fails -> airPocketAfter's short cooldown -> the cell is not dropped from again -> the next
//      admission refuses exactly as the base; the pinned head-in-air cell (swimunder's) never reaches a drop;
//   W. wiring in reflex.mjs (structural, comments stripped, each assertion seen to fail on a mutant);
//   M. anchored mutants (present AND unique), imported with a fresh URL each time.
import assert from 'node:assert'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dropFloor, standingPlan, dropEligible, landed, dropSink, dropTag, dropDigOn, footprint, fullCube, stillWater,
         DD_SINK_BASE_MS, DD_SINK_PER_BLOCK_MS, DD_RISE_PER_BLOCK_MS, DD_FAIL_MEMORY_MS } from '../src/dropdig.mjs'
import { airPocketPlan, airPocketAdmit, airPocketStep, airPocketRow, airPocketAfter, AP_REFUSE_COOLDOWN_MS } from '../src/airpocket.mjs'

const require = createRequire(import.meta.url)
const { Physics, PlayerState } = require('prismarine-physics')
const { Vec3 } = require('vec3')
const VER = '1.21.8'
const mcData = require('minecraft-data')(VER)
const Block = require('prismarine-block')(VER)

let pass = 0, fail = 0
const t = (name, fn) => Promise.resolve().then(fn)
  .then(() => { pass++; console.log(`  PASS  ${name}`) })
  .catch(e => { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 3).join('\n        ') ?? e}`) })

const DD_PATH = new URL('../src/dropdig.mjs', import.meta.url)
const AP_PATH = new URL('../src/airpocket.mjs', import.meta.url)
const REFLEX_PATH = new URL('../src/reflex.mjs', import.meta.url)

// ANCHORED MUTANTS: the anchor must be present AND unique, or the mutant is refused (a mutant that never applied reads as
// killed). The mutant is written next to its source (its own relative imports resolve) and imported with a fresh URL.
async function withMutant (path, pairs, fn) {
  let src = readFileSync(path, 'utf8')
  for (const [old, neu] of pairs) {
    assert.ok(src.includes(old), `ANCHOR MISSING: ${JSON.stringify(old.slice(0, 70))} in ${path.pathname}`)
    assert.equal(src.split(old).length, 2, `ANCHOR NOT UNIQUE: ${JSON.stringify(old.slice(0, 70))}`)
    src = src.replace(old, neu)
  }
  const out = new URL(`./_mutant-dd-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, path)
  writeFileSync(out, src)
  try { return await fn(await import(`${out.href}?${Date.now()}_${Math.random()}`)) } finally { try { unlinkSync(out) } catch {} }
}

// ---------------------------------------------------------------- blocks and worlds
const blk = (state) => {
  const s = String(state).startsWith('minecraft:') ? state : `minecraft:${state}`
  return Block.fromString(s, 0)
}
const cache = new Map()
const B = (state) => { if (!cache.has(state)) cache.set(state, blk(state)); return cache.get(state) }
// a world from cells relative to an origin cell; anything not listed is `dflt`
function worldOf (cells, origin, dflt = 'stone') {
  const m = new Map()
  for (const [k, v] of Object.entries(cells)) { const [a, b, c] = k.split(',').map(Number); m.set(`${origin[0] + a},${origin[1] + b},${origin[2] + c}`, v) }
  const at = (x, y, z) => { const k = `${x},${y},${z}`; const v = m.has(k) ? m.get(k) : dflt; return v == null ? null : B(v) }
  return { m, at, set: (x, y, z, v) => m.set(`${x},${y},${z}`, v) }
}
const relAt = (w, o) => (dx, dy, dz) => w.at(o[0] + dx, o[1] + dy, o[2] + dz)

const CUTS = JSON.parse(readFileSync(new URL('./fixtures/dropdig-cuts.json', import.meta.url), 'utf8'))
// the logged pos is rounded to 0.1: clamp it into the feet cell the refusal row named (the row's `at` is exact)
const posIn = (s) => {
  const c = (v, lo) => Math.min(lo + 0.999, Math.max(lo + 0.001, v))
  return { x: c(s.pos.x, s.at[0]), y: c(s.pos.y, s.at[1]), z: c(s.pos.z, s.at[2]) }
}
// the floating dig the fleet priced, from the refusal's own need: need = dig x 1.5 + 3000 + 1500 x seals
const floatingDigOf = (s, seals) => (s.need - 3000 - 1500 * seals) / 1.5

// ---------------------------------------------------------------- S. the sink under the real physics
// a physics fake: prismarine-physics ticks every 50 ms over a block world; controls are the bot's own
function physicsBot ({ world, pos, health = 20, digOf = null, onTick = null }) {
  const physics = Physics(mcData, { getBlock: p => { const b = world.at(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z)); if (!b) return null; const c = Object.create(b); c.position = new Vec3(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z)); return c } })
  const entity = { position: new Vec3(pos.x, pos.y, pos.z), velocity: new Vec3(0, 0, 0), onGround: false, isInWater: true, isInLava: false,
                   isInWeb: false, isCollidedHorizontally: false, isCollidedVertically: false, elytraFlying: false, yaw: 0, pitch: 0,
                   effects: {}, attributes: {}, metadata: [] }
  const controlState = { forward: false, back: false, left: false, right: false, jump: false, sprint: false, sneak: false }
  const bot = { entity, controlState, health, jumpTicks: 0, jumpQueued: false, fireworkRocketDuration: 0, version: VER, registry: mcData,
                game: { gameMode: 'survival' }, inventory: { slots: [], items: () => [{ name: 'wooden_pickaxe', type: mcData.itemsByName.wooden_pickaxe.id }] },
                getEquipmentDestSlot: () => 5, heldItem: null, digSends: [], stopped: 0, minEye: Infinity, ticks: 0 }
  bot.setControlState = (n, on) => { controlState[n] = !!on }
  bot.blockAt = v => { const b = world.at(Math.floor(v.x), Math.floor(v.y), Math.floor(v.z)); if (!b) return null; const c = Object.create(b); c.position = new Vec3(Math.floor(v.x), Math.floor(v.y), Math.floor(v.z)); return c }
  bot.equip = async it => { bot.heldItem = { ...it } }
  bot.lookAt = async () => {}
  bot._getBlockAtEyeLevel = () => bot.blockAt(entity.position.offset(0, 1.62, 0))
  bot.stopDigging = () => { bot.stopped++; if (bot.digging) { const d = bot.digging; bot.digging = null; d.rej(new Error('Digging aborted')) } }
  // the dig: priced at its start from the body's state then (mineflayer); the SERVER breaks it only if the body was on the
  // ground at the finish when it was priced on the ground (PR #3930: the time is fixed at the start)
  bot.dig = (b, _force) => new Promise((res, rej) => {
    const env = { inWater: /water/.test(bot._getBlockAtEyeLevel()?.name ?? ''), notOnGround: !entity.onGround }
    const ms = b.digTime(bot.heldItem?.type ?? null, false, env.inWater, env.notOnGround, [], {})
    bot.digSends.push({ ms, onGround: entity.onGround })
    bot.digging = { rej }
    setTimeout(() => {
      if (!bot.digging) return
      bot.digging = null
      if (!env.notOnGround && !entity.onGround) return rej(new Error('server refused: off the ground at the finish'))
      world.set(b.position.x, b.position.y, b.position.z, 'air')
      res()
    }, ms)
  })
  bot.timer = setInterval(() => {
    const st = new PlayerState(bot, controlState); physics.simulatePlayer(st, { getBlock: p => bot.blockAt(p) }); st.apply(bot)
    bot.ticks++
    const eye = bot._getBlockAtEyeLevel()
    if (eye?.name === 'air') bot.health = Math.min(20, bot.health + 0.05)
    else bot.health = Math.max(0, bot.health - 0.016)    // ~0.31 HP/s: peaceful drowning (sandbox2)
    onTick?.(bot)
  }, 50)
  bot.stop = () => clearInterval(bot.timer)
  return bot
}
// a 1x1 water column: floor at dy -k (stone), roof stone at +2 (feet cell 0,0,0 at y 40), stone around
function columnWorld (k, extra = {}) {
  const cells = {}
  for (let y = -k + 1; y <= 1; y++) cells[`0,${y},0`] = 'water[level=0]'
  return worldOf({ ...cells, ...extra }, [0, 40, 0])
}

await t('S1 prismarine-physics: pinned at N.2 with jump released, a floor 1 down and 2 down are reached inside the priced sink deadline', async () => {
  for (const k of [1, 2]) {
    const w = columnWorld(k)
    const bot = physicsBot({ world: w, pos: { x: 0.5, y: 40.2, z: 0.5 } })
    bot.setControlState('jump', true)
    await new Promise(r => setTimeout(r, 1000))            // the rescue holds jump: pinned against the roof
    assert.ok(Math.abs(bot.entity.position.y - 40.2) < 0.01, `pinned at ${bot.entity.position.y}`)
    const floor = dropFloor(relAtAbs(w), { pos: bot.entity.position, fx: 0, fy: 40, fz: 0 })
    assert.equal(floor.ok, true, floor.why)
    const sinkMs = DD_SINK_BASE_MS + DD_SINK_PER_BLOCK_MS * floor.descent
    const s = await dropSink(bot, { landY: floor.landY, sinkMs }, { fx: 0, fz: 0 })
    bot.stop()
    assert.equal(s.ok, true, `floor -${k}: ${s.why}`)
    assert.ok(s.ms < sinkMs, `landed in ${s.ms} of ${sinkMs}`)
    assert.ok(Math.abs(bot.entity.position.y - (41 - k)) < 0.01, `rests at ${bot.entity.position.y}`)
    assert.equal(bot.controlState.jump, false)
  }
})
function relAtAbs (w) { return (x, y, z) => w.at(x, y, z) }

// ---------------------------------------------------------------- R. the real sites (region copies, 11-04 03:16Z)
const EXPECT = {   // site id -> what drop-and-dig decides there at the health of its FIRST refusal
  'placebo-d-Comet@202,34,188': /no floor within 2/,
  'hive-b-Bravo@510,61,161': 'ok',
  'hive-b-Delta@907,52,447': /no floor within 2/,
  'hive-d-Bravo@91,60,172': /no floor within 2/,
  'hive-d-Delta@123,60,67': /moving water/,
  'isolated-d-Alpha@335,54,172': 'ok',
  'hive-d-Delta@139,60,109': /no floor within 2/,
  'placebo-d-Delta@196,45,184': 'ok',
  'placebo-c-Bravo@510,61,161': 'ok',
  'placebo-d-Bravo@206,39,196': /standing needs/,
  'isolated-a-Delta@442,43,61': /no floor within 2/,
}
function siteDecision (s) {
  const w = worldOf(s.cells, s.at)
  const plan = airPocketPlan(relAt(w, s.at))
  const seals = plan.seal?.length ?? 0
  const floating = floatingDigOf(s, seals)
  const admit = airPocketAdmit({ health: s.health, difficulty: 'peaceful', digMs: floating, seals })
  const pos = posIn(s)
  const floor = dropFloor((x, y, z) => w.at(x, y, z), { pos, fx: s.at[0], fy: s.at[1], fz: s.at[2] })
  const sp = standingPlan({ floor, plan, fx: s.at[0], fy: s.at[1], fz: s.at[2], x: pos.x, z: pos.z, digStandingMs: floating / 5, budgetMs: admit.budgetMs })
  return { plan, admit, floor, sp }
}
await t('R1 POSITIVE CONTROL: at all 11 refused sites the copy plans the pocket (or the ice) and the floating price is refused on time, as on the fleet', () => {
  const real = CUTS.sites.filter(s => s.need != null)
  assert.equal(real.length, 11)
  for (const s of real) {
    const { plan, admit } = siteDecision(s)
    assert.equal(plan.ok, true, `${s.id}: ${plan.why}`)
    assert.equal(admit.ok, false, s.id)
    assert.ok(Math.abs(admit.requiredMs - s.need) < 2, `${s.id}: ${admit.requiredMs} vs ${s.need}`)
  }
})
await t('R2 the drop decision at each real site: 4 of 11 dig standing (floor 1 or 2 down, fits); placebo-d-Bravo (8 HP at its first refusal) still refused; deeper/none/ice refused', () => {
  const got = {}
  for (const s of CUTS.sites.filter(s => s.need != null)) {
    const { sp } = siteDecision(s)
    got[s.id] = sp.ok ? 'ok' : sp.why; if (process.env.DD_SHOW) console.log("     ", s.id, got[s.id])
    const want = EXPECT[s.id]
    if (want === 'ok') assert.equal(sp.ok, true, `${s.id}: ${sp.why}`)
    else assert.match(String(sp.why), want, `${s.id}: ${sp.why}`)
  }
  assert.equal(Object.values(got).filter(v => v === 'ok').length, 4, JSON.stringify(got))
})
await t('R3 the pinned head-in-air cells (isolated-d Delta/Echo 358,58,180; isolated-c-Bravo): the pocket plan refuses (head in air), so no drop is ever offered -- swimunder-01\'s population', () => {
  for (const s of CUTS.sites.filter(s => s.need == null)) {
    const w = worldOf(s.cells, s.at)
    const plan = airPocketPlan(relAt(w, s.at))
    assert.equal(plan.ok, false, s.id); assert.match(plan.why, /head cell is air/, s.id)
    assert.equal(standingPlan({ floor: { ok: true, landY: s.at[1], depth: 1, descent: 0.2 }, plan, fx: s.at[0], fy: s.at[1], fz: s.at[2], digStandingMs: 1000, budgetMs: 32000 }).ok, false)
  }
})

// ---------------------------------------------------------------- P. the floor rule
const fx = 0, fy = 40, fz = 0, POS = { x: 0.5, y: 40.2, z: 0.5 }
const df = (cells, pos = POS) => { const w = columnWorld(1, cells); return dropFloor((x, y, z) => w.at(x, y, z), { pos, fx, fy, fz }) }
await t('P1 a stone floor 1 down: landY = feet cell, descent 0.2; 2 down: landY one lower, descent 1.2; 3 down: refused', () => {
  const a = df({}); assert.deepEqual([a.ok, a.landY, a.depth, +a.descent.toFixed(2)], [true, 40, 1, 0.2])
  const w2 = columnWorld(2); const b = dropFloor((x, y, z) => w2.at(x, y, z), { pos: POS, fx, fy, fz })
  assert.deepEqual([b.ok, b.landY, b.depth, +b.descent.toFixed(2)], [true, 39, 2, 1.2])
  const w3 = columnWorld(3); const c = dropFloor((x, y, z) => w3.at(x, y, z), { pos: POS, fx, fy, fz })
  assert.equal(c.ok, false); assert.match(c.why, /no floor within 2/)
})
await t('P2 hazardous or partial floors refuse: magma, soul sand, mud (0.875 tall), a slab, sand, an unknown cell', () => {
  for (const f of ['magma_block', 'soul_sand', 'mud', 'stone_slab[type=bottom,waterlogged=false]', 'sand', 'slime_block']) {
    const r = df({ '0,-1,0': f }); assert.equal(r.ok, false, f); assert.match(r.why, /not a floor/, f)
  }
  const w = columnWorld(1, { '0,-1,0': null })
  const u = dropFloor((x, y, z) => w.at(x, y, z), { pos: POS, fx, fy, fz }); assert.equal(u.ok, false); assert.match(u.why, /unknown/)
  for (const f of ['stone', 'cobblestone', 'dirt', 'oak_log[axis=y]', 'deepslate[axis=y]']) assert.equal(df({ '0,-1,0': f }).ok, true, f)
})
await t('P3 the descent must be plain still water: kelp, seagrass, a bubble column or a current in the way refuse', () => {
  for (const c of ['kelp[age=3]', 'seagrass', 'bubble_column[drag=true]', 'water[level=3]']) {
    const w = columnWorld(2, { '0,-1,0': c })
    const r = dropFloor((x, y, z) => w.at(x, y, z), { pos: POS, fx, fy, fz }); assert.equal(r.ok, false, c)
  }
})
await t('P4 every column the 0.6-wide body overlaps is read: a straddled neighbour with magma under it refuses; with stone it may hold the body higher', () => {
  const pos = { x: 0.85, y: 40.2, z: 0.5 }           // overlaps column x=1
  assert.deepEqual(footprint(pos.x, pos.z), [[0, 0], [1, 0]])
  const base = { '1,0,0': 'water[level=0]', '1,1,0': 'water[level=0]' }
  const bad = df({ ...base, '1,-1,0': 'magma_block' }, pos); assert.equal(bad.ok, false); assert.match(bad.why, /magma_block/)
  const w = columnWorld(2, { ...base, '1,-1,0': 'stone' })
  const hi = dropFloor((x, y, z) => w.at(x, y, z), { pos, fx, fy, fz })   // own floor 2 down, the neighbour's 1 down
  assert.deepEqual([hi.ok, hi.landY], [true, 40])
})
await t('P5 the eye cell after landing must be plain water (seagrass at the eye would make the client and server disagree)', () => {
  const w = columnWorld(2, { '0,0,0': 'seagrass' })   // floor 2 down: feet land at 39, eye at 40.62 -> cell 40
  const r = dropFloor((x, y, z) => w.at(x, y, z), { pos: { x: 0.5, y: 40.2, z: 0.5 }, fx, fy, fz })
  assert.equal(r.ok, false); assert.match(r.why, /seagrass|feet row/)
})
await t('P6 standingPlan: the price = sink + extra rise + seals + dig x1.5 + 3 s; a dug pocket only; reach checked from the standing eye', () => {
  const plan = airPocketPlan(relAt(columnWorld(1), [0, 40, 0]))
  const floor = df({})
  const sp = standingPlan({ floor, plan, fx, fy, fz, digStandingMs: 5625, budgetMs: 28000 })
  const want = DD_SINK_BASE_MS + DD_SINK_PER_BLOCK_MS * 0.2 + DD_RISE_PER_BLOCK_MS * 0.2 + 5625 * 1.5 + 3000
  assert.equal(sp.ok, true); assert.ok(Math.abs(sp.requiredMs - want) < 1e-6)
  assert.equal(standingPlan({ floor, plan, fx, fy, fz, digStandingMs: 30000, budgetMs: 28000 }).ok, false)
  assert.equal(standingPlan({ floor, plan: { ...plan, kind: 'ice' }, fx, fy, fz, digStandingMs: 100, budgetMs: 28000 }).ok, false)
  const far = standingPlan({ floor: { ...floor, landY: 35 }, plan, fx, fy, fz, digStandingMs: 100, budgetMs: 28000 })
  assert.equal(far.ok, false); assert.match(far.why, /reach/)
})

// ---------------------------------------------------------------- E. eligibility
await t('E1 a drop is asked only on the step\'s own admission, floating, after a BUDGET refusal, and never from a failed cell for 60 s', () => {
  const base = { on: true, worstCase: false, onGround: false, budgetRefused: true, failedUntil: 0, now: 1000 }
  assert.equal(dropEligible(base), true)
  assert.equal(dropEligible({ ...base, on: false }), false)
  assert.equal(dropEligible({ ...base, worstCase: true }), false)
  assert.equal(dropEligible({ ...base, onGround: true }), false)
  assert.equal(dropEligible({ ...base, budgetRefused: false }), false)
  assert.equal(dropEligible({ ...base, failedUntil: 1000 + DD_FAIL_MEMORY_MS }), false)
  assert.equal(dropEligible({ ...base, failedUntil: 999 }), true)
})
await t('E2 kill switch: DROPANDDIG=0/off/false/no disables; unset or 1 enables', () => {
  for (const v of ['0', 'off', 'false', 'no', ' OFF ']) assert.equal(dropDigOn({ DROPANDDIG: v }), false, v)
  assert.equal(dropDigOn({}), true); assert.equal(dropDigOn({ DROPANDDIG: '1' }), true)
})
await t('E3 landed: three still polls on the ground, in the column, at the floor', () => {
  const s = { onGround: true, vy: 0, x: 0.5, y: 40, z: 0.5 }
  assert.equal(landed([s, s, s], { fx: 0, fz: 0, landY: 40 }), true)
  assert.equal(landed([s, s], { fx: 0, fz: 0, landY: 40 }), false)
  assert.equal(landed([s, s, { ...s, onGround: false }], { fx: 0, fz: 0, landY: 40 }), false)
  assert.equal(landed([s, s, { ...s, x: 1.2 }], { fx: 0, fz: 0, landY: 40 }), false)
  assert.equal(landed([s, s, { ...s, vy: -0.2 }], { fx: 0, fz: 0, landY: 40 }), false)
  assert.equal(stillWater(B('water[level=0]')), true); assert.equal(stillWater(B('water[level=2]')), false)
  assert.equal(fullCube(B('stone')), true); assert.equal(fullCube(B('mud')), false)
})

// ---------------------------------------------------------------- B. the step on the physics fake
// the drop the reflex would attach (prepareAirPocket): built here from the same pure functions
function dropFor (w, pos, health) {
  const plan = airPocketPlan(relAt(w, [0, 40, 0]))
  const floor = dropFloor((x, y, z) => w.at(x, y, z), { pos, fx: 0, fy: 40, fz: 0 })
  const stone = B('stone'); const pick = mcData.itemsByName.wooden_pickaxe.id
  const floatMs = stone.digTime(pick, false, true, true, [], {}), standMs = stone.digTime(pick, false, true, false, [], {})
  const admit = airPocketAdmit({ health, difficulty: 'peaceful', digMs: floatMs, seals: 0 })
  const sp = standingPlan({ floor, plan, fx: 0, fy: 40, fz: 0, x: pos.x, z: pos.z, digStandingMs: standMs, budgetMs: admit.budgetMs })
  return { plan, admit, floor, sp, floatMs, standMs,
           drop: sp.ok ? { fx: 0, fy: 40, fz: 0, landY: floor.landY, depth: floor.depth, descent: floor.descent, sinkMs: sp.sinkMs, riseExtraMs: sp.riseExtraMs } : null }
}
const stepDeps = (bot) => ({ Vec3, predict: (b, item) => b.digTime(item?.type ?? null, false, /water/.test(bot._getBlockAtEyeLevel()?.name ?? ''), !bot.entity.onGround, [], {}),
                             envelope: 0.5, centre: true })
async function pinned (w, health = 18) {
  const bot = physicsBot({ world: w, pos: { x: 0.5, y: 40.2, z: 0.5 }, health })
  bot.setControlState('jump', true)
  await new Promise(r => setTimeout(r, 600))
  return bot
}
for (const k of [1, 2]) {
  await t(`B${k} floor ${k} down, wooden pickaxe on stone, 18 HP: the floating price is REFUSED (the fleet's isolated-d-Alpha numbers) and the drop digs it standing -> breathing`, async () => {
    const w = columnWorld(k)
    const bot = await pinned(w)
    const d = dropFor(w, bot.entity.position, bot.health)
    assert.equal(d.admit.ok, false, 'the base would have refused here')
    assert.ok(Math.abs(d.admit.requiredMs - 45225) < 30, `floating need ${d.admit.requiredMs}`)
    assert.equal(d.sp.ok, true, d.sp.why)
    const r = await airPocketStep(bot, { ...d.plan, drop: d.drop }, stepDeps(bot))
    bot.stop()
    assert.equal(r.ok, true, r.why); assert.equal(r.outcome, 'success'); assert.equal(r.standing, true)
    assert.match(r.drop, new RegExp(`^${k}:landed:`))
    assert.equal(bot.digSends.length, 1); assert.equal(bot.digSends[0].onGround, true)
    assert.ok(bot.digSends[0].ms < d.floatMs / 4, `dug at ${bot.digSends[0].ms} ms (floating ${d.floatMs})`)
    assert.equal(w.at(0, 42, 0).name, 'air')
    assert.match(airPocketRow({ id: 'x', r, requiredMs: d.sp.requiredMs, budgetMs: d.admit.budgetMs, difficulty: 'peaceful' }), new RegExp(`standing=1 drop=${k}:landed:`))
    assert.ok(bot.health > 10, `health ${bot.health}`)
  })
}
await t('B3 the floor is gone when the step sinks (dug out under it): no landing -> jump back, NOTHING dug, the short cooldown, dropFailed', async () => {
  const w = columnWorld(1)
  const bot = await pinned(w)
  const d = dropFor(w, bot.entity.position, bot.health)
  assert.equal(d.sp.ok, true)
  for (let y = 30; y <= 39; y++) w.set(0, y, 0, 'water[level=0]')   // the floor (and below) turn to water after admission
  const r = await airPocketStep(bot, { ...d.plan, drop: d.drop }, stepDeps(bot))
  bot.stop()
  assert.equal(r.ok, false); assert.equal(r.dropFailed, true); assert.equal(r.handoffHeld, true)
  assert.match(r.why, /^drop: (no landing|drifted)/); assert.match(r.drop, /^1:fail:/)
  assert.equal(bot.digSends.length, 0)
  assert.equal(w.at(0, 42, 0).name, 'stone')
  const st = airPocketAfter(false, { cooldownUntil: 0 }, 1000, { handoffHeld: r.handoffHeld === true })
  assert.equal(st.cooldownUntil, 1000 + AP_REFUSE_COOLDOWN_MS)
})
await t('B4 a body that leaves the floor during the standing-priced dig is stopped (the server would refuse the early finish)', async () => {
  const w = columnWorld(1)
  const bot = await pinned(w)
  const d = dropFor(w, bot.entity.position, bot.health)
  const realDig = bot.dig
  bot.dig = (b, f) => { setTimeout(() => bot.setControlState('jump', true), 400); const iv = setInterval(() => bot.setControlState('jump', true), 50); return realDig(b, f).finally(() => clearInterval(iv)) }
  const r = await airPocketStep(bot, { ...d.plan, drop: d.drop }, stepDeps(bot))
  bot.stop()
  assert.equal(r.ok, false); assert.match(r.why, /lifted off the floor/)
  assert.ok(bot.stopped >= 1)
})

// ---------------------------------------------------------------- C. the refusal chain
await t('C1 chain: drop fails -> short cooldown -> the cell is remembered -> the next admission refuses exactly as the base (no second sink, no new refusal reason)', () => {
  const now = 50_000
  const failedUntil = now + DD_FAIL_MEMORY_MS
  const s = CUTS.sites.find(x => x.id === 'isolated-d-Alpha@335,54,172')
  const { admit } = siteDecision(s)
  assert.equal(admit.ok, false); assert.match(admit.why, /^needs \d+ ms, budget \d+ ms/)
  assert.equal(dropEligible({ on: true, onGround: false, budgetRefused: admit.budgetMs != null, failedUntil, now: now + AP_REFUSE_COOLDOWN_MS }), false)
  assert.equal(dropEligible({ on: true, onGround: false, budgetRefused: true, failedUntil, now: failedUntil + 1 }), true)
})
await t('C2 chain: the pre-empt of an in-flight escape (entombed / maroon climb) prices the floating worst case and never drops -- an escape is never stopped for a sink', () => {
  assert.equal(dropEligible({ on: true, worstCase: true, onGround: false, budgetRefused: true }), false)
})

// ---------------------------------------------------------------- W. wiring (structural, comments stripped)
const strip = src => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
function wiring (code) {
  const prep = code.indexOf('const prepareAirPocket = ('), run = code.indexOf('const runAirPocket = async'), end = code.indexOf('const rescueExpired')
  const p = code.slice(prep, run), r = code.slice(run, end)
  return {
    prepDropGated: /if \(!\(drop && dropEligible\(\{ on: dropDig, worstCase, onGround: bot\.entity\?\.onGround === true, budgetRefused: admit\.budgetMs != null,/.test(p),
    standPrice: /const standEnv = \{ \.\.\.digEnv\(bot\), inWater: true, notOnGround: false \}/.test(p) && /predictedDigMs\(block, item, standEnv\)/.test(p),
    planCarries: /plan: \{ \.\.\.plan, drop \}/.test(p),
    memory: /if \(r\?\.dropFailed\) dropFailUntil\.set\(`\$\{fx\},\$\{fy\},\$\{fz\}`, Date\.now\(\) \+ DD_FAIL_MEMORY_MS\)/.test(r),
    memoryRead: /failedUntil: dropFailUntil\.get\(`\$\{fx\},\$\{fy\},\$\{fz\}`\) \?\? 0/.test(p),
    preemptWorst: /stepWouldRun: \(\) => prepareAirPocket\(\{ worstCase: true \}\)\.ok \}\)/.test(code),
    heldOffNoDrop: /const p = prepareAirPocket\(\{ drop: false \}\)\s*if \(!p\.ok && p\.inputs\)/.test(code),
    killSwitch: /const dropDig = dropDigOn\(\)/.test(code),
  }
}
await t('W1 wiring: the drop is gated (switch, worst case, budget refusal, memory), priced standing, carried on the plan, remembered on failure; the pre-empt keeps the worst case; the held-off row never drops', () => {
  const w = wiring(strip(readFileSync(REFLEX_PATH, 'utf8')))
  for (const [k, v] of Object.entries(w)) assert.equal(v, true, k)
})
await t('W2 MUTANTS KILLED (text): each wiring assertion fails when its line is changed', () => {
  const src = strip(readFileSync(REFLEX_PATH, 'utf8'))
  const muts = [
    ['prepDropGated', 'if (!(drop && dropEligible({ on: dropDig, worstCase,', 'if (!(drop && dropEligible({ on: dropDig, worstCase: false,'],
    ['standPrice', 'const standEnv = { ...digEnv(bot), inWater: true, notOnGround: false }', 'const standEnv = { ...digEnv(bot), inWater: true, notOnGround: true }'],
    ['planCarries', 'plan: { ...plan, drop }', 'plan'],
    ['memory', 'if (r?.dropFailed) dropFailUntil.set(', 'if (false) dropFailUntil.set('],
    ['preemptWorst', 'stepWouldRun: () => prepareAirPocket({ worstCase: true }).ok })', 'stepWouldRun: () => prepareAirPocket({ worstCase: false }).ok })'],
    ['heldOffNoDrop', 'const p = prepareAirPocket({ drop: false })', 'const p = prepareAirPocket()'],
  ]
  for (const [k, old, neu] of muts) {
    assert.ok(src.includes(old), `ANCHOR MISSING ${k}`); assert.equal(src.split(old).length, 2, `ANCHOR NOT UNIQUE ${k}`)
    assert.equal(wiring(src.replace(old, neu))[k], false, k)
  }
})

// ---------------------------------------------------------------- M. behaviour mutants (anchored, fresh import)
await t('M1 MUTANT KILLED: without the full-cube check, mud and a bottom slab pass as floors (P2 catches it)', async () => {
  await withMutant(DD_PATH, [["if (BAD_FLOOR.test(b.name || '') || !fullCube(b)) return no(", "if (BAD_FLOOR.test(b.name || '')) return no("]], async m => {
    const w = columnWorld(1, { '0,-1,0': 'stone_slab[type=bottom,waterlogged=false]' })
    assert.equal(m.dropFloor((x, y, z) => w.at(x, y, z), { pos: POS, fx, fy, fz }).ok, true)
  })
})
await t('M2 MUTANT KILLED: reading only the own column, a straddled magma neighbour passes (P4 catches it)', async () => {
  await withMutant(DD_PATH, [['  for (const [cx, cz] of footprint(pos.x, pos.z)) {', '  for (const [cx, cz] of [[fx, fz]]) {']], async m => {
    const pos = { x: 0.85, y: 40.2, z: 0.5 }
    const w = columnWorld(1, { '1,0,0': 'water[level=0]', '1,1,0': 'water[level=0]', '1,-1,0': 'magma_block' })
    assert.equal(m.dropFloor((x, y, z) => w.at(x, y, z), { pos, fx, fy, fz }).ok, true)
  })
})
await t('M3 MUTANT KILLED: a drop offered on the worst-case (pre-empt) price (E1/C2 catch it)', async () => {
  await withMutant(DD_PATH, [['if (!on || worstCase || onGround || !budgetRefused) return false', 'if (!on || onGround || !budgetRefused) return false']], async m => {
    assert.equal(m.dropEligible({ on: true, worstCase: true, onGround: false, budgetRefused: true }), true)
  })
})
await t('M4 MUTANT KILLED: without the sink the step digs floating, over the budget, and fails (B1 catches it)', async () => {
  await withMutant(AP_PATH, [['    if (drop) {\n      if (fy !== drop.fy', '    if (false) {\n      if (fy !== drop.fy']], async m => {
    const w = columnWorld(1)
    const bot = await pinned(w)
    const d = dropFor(w, bot.entity.position, bot.health)
    const r = await m.airPocketStep(bot, { ...d.plan, drop: d.drop }, stepDeps(bot))
    bot.stop()
    assert.equal(r.ok, false); assert.match(r.why, /over the budget/)
  })
})
await t('M5 MUTANT KILLED: without the lift-off watch the early finish goes to the server and is refused there (B4 catches it)', async () => {
  await withMutant(AP_PATH, [["if (offGround >= 2) aborted = aborted ?? 'drop: lifted off the floor while digging'", 'if (false) aborted = null']], async m => {
    const w = columnWorld(1)
    const bot = await pinned(w)
    const d = dropFor(w, bot.entity.position, bot.health)
    const realDig = bot.dig
    bot.dig = (b, f) => { const iv = setInterval(() => bot.setControlState('jump', true), 50); return realDig(b, f).finally(() => clearInterval(iv)) }
    const r = await m.airPocketStep(bot, { ...d.plan, drop: d.drop }, stepDeps(bot))
    bot.stop()
    assert.equal(r.ok, false); assert.doesNotMatch(String(r.why), /lifted off the floor/)
  })
})
await t('M6 MUTANT KILLED: a sink without the landing wait (lands "at once") digs before the body is down, priced wrong (S1/B1 catch it)', async () => {
  await withMutant(DD_PATH, [['      if (landed(samples, { fx, fz, landY: drop.landY })) return { ok: true', '      if (true) return { ok: true']], async m => {
    const w = columnWorld(2)
    const bot = await pinned(w)
    const floor = dropFloor((x, y, z) => w.at(x, y, z), { pos: bot.entity.position, fx: 0, fy: 40, fz: 0 })
    const s = await m.dropSink(bot, { landY: floor.landY, sinkMs: 4000 }, { fx: 0, fz: 0 })
    bot.stop()
    assert.equal(s.ok, true); assert.ok(bot.entity.position.y > 39.5, `already down at ${bot.entity.position.y}`)
  })
})
await t('T1 dropTag', () => {
  assert.equal(dropTag(null, null), null)
  assert.equal(dropTag({ depth: 2 }, { ok: true, ms: 2612.4 }), '2:landed:2612')
  assert.equal(dropTag({ depth: 1 }, { ok: false, ms: 1500 }), '1:fail:1500')
})

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
