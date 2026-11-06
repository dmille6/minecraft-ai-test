// IDLEWORK-02: (1) the bag stop -- a bag-filling idle batch (iron, logs, coal) is met once THIS batch filled the bag to 30 real
// slots, and no bag batch opens above 28 (the lap is a grounds or scout lap instead: no spin); (2) the band dispose -- from 29 slots
// the town's junk well takes the 34-slot order's whole plan (cobble only at the proven cap, the bot's 64 kept); (3) the depth-aware
// hint -- at iron depth the iron/coal hints name a `mine` target the admission gate accepts, never y=16 again. Behaviour on the
// pure functions and on the real MilestoneController; anchored mutants at the end.
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
const IW = await import('../src/idlework.mjs')
const MS = await import('../src/milestones.mjs')
const WL = await import('../src/well.mjs')
const MN = await import('../src/mining.mjs')
const { config } = await import('../src/config.mjs')

let pass = 0, fail = 0
const t = async (name, fn) => { try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 3).join('\n        ')}`) } }
const ALL = { iron: true, logs: true, coal: true, grounds: false }

// ---- the bag stop (pure) ----
await t('idleBagMeans: at <= 28 slots the means are unchanged; above, the bag kinds have none (grounds untouched); off: unchanged', () => {
  assert.deepEqual(IW.idleBagMeans(ALL, 28, { on: true }), ALL)
  const m = IW.idleBagMeans({ ...ALL, grounds: true }, 29, { on: true })
  assert.deepEqual(m, { iron: false, logs: false, coal: false, grounds: true })
  assert.deepEqual(IW.idleBagMeans(ALL, 36, { on: false }), ALL)
  assert.deepEqual(IW.idleBagMeans(ALL, null, { on: true }), ALL, 'an unknown bag changes nothing')
})
await t('a full bag never opens a bag batch: every rotation slot picks grounds (with work) or scout', () => {
  for (const rotation of [IW.IDLE_ROTATION, IW.IDLE_ROTATION_GK]) {
    for (let c = 0; c < 8; c++) {
      assert.equal(IW.idlePick(c, { means: IW.idleBagMeans(ALL, 33, { on: true }), rotation }), 'scout', `cycle ${c}`)
      const k = IW.idlePick(c, { means: IW.idleBagMeans({ ...ALL, grounds: true }, 33, { on: true }), rotation })
      assert.ok(['grounds', 'scout'].includes(k), `cycle ${c}: ${k}`)
    }
  }
})
await t('idleBagFull: only a bag kind, only a fill THIS batch made, only at the stop', () => {
  const s = IW.idleStep(null, 0, 'iron', 0, 0, 25)
  assert.equal(s.slotsAt, 25)
  assert.equal(IW.idleBagFull(s, 29, { on: true }), false)
  assert.equal(IW.idleBagFull(s, 30, { on: true }), true)
  assert.equal(IW.idleBagFull(s, 30, { on: false }), false, 'IDLEWORK_BAGSTOP=0')
  assert.equal(IW.idleBagFull({ ...s, slotsAt: 30 }, 30, { on: true }), false, 'a bag that opened at 30 did not fill on this batch')
  assert.equal(IW.idleBagFull({ ...s, kind: 'scout' }, 36, { on: true }), false)
  assert.equal(IW.idleBagFull({ ...s, kind: 'grounds' }, 36, { on: true }), false)
  assert.equal(IW.idleBagFull({ ...s, slotsAt: null }, 36, { on: true }), false, 'an unknown start counts nothing')
})
await t('idleMet: the bag stop meets an unfinished batch; below the stop the batch still needs its n', () => {
  const s = IW.idleStep(null, 0, 'iron', 0, 0, 25)
  assert.equal(IW.idleMet(s, { slots: 29 }), false)
  assert.equal(IW.idleMet(s, { slots: 30 }), true)
  assert.equal(IW.idleMet({ ...s, gained: 6 }, { slots: 26 }), true, 'its n as before')
})

// ---- the depth-aware hint (pure) x the admission gate's own rule ----
await t('at or below y=18 the iron and coal hints never ask for y=16, and every mine target they name passes mining.mjs mineTargetOk', () => {
  for (let y = -58; y <= 18; y += 0.5) {
    for (const k of ['iron', 'coal']) {
      const h = IW.idleDepthHint(k, y)
      assert.ok(!/y=16 and|down to y=16/.test(h), `${k} y=${y}: ${h}`)
      for (const m of h.matchAll(/mine with y=(-?\d+)/g)) assert.ok(MN.mineTargetOk(y, Number(m[1])), `${k} at y=${y} names mine y=${m[1]}, which the gate refuses`)
      for (const m of h.matchAll(/from here y=(-?\d+)/g)) assert.equal(Number(m[1]), MN.mineTargetCeiling(y) + 0, `${k} y=${y}: the named ceiling is the gate's`)
    }
  }
})
await t('above iron depth the hint is the batch\'s own (mine down to y=16 is a target the gate accepts there)', () => {
  for (const y of [19, 40, 70, 120]) {
    assert.equal(IW.idleDepthHint('iron', y), IW.IDLE_NEEDS.iron.hint)
    assert.ok(MN.mineTargetOk(y, 16), `y=${y}`)
  }
  assert.equal(IW.idleDepthHint('coal', 64), IW.IDLE_NEEDS.coal.hint)
  assert.equal(IW.idleDepthHint('logs', 10), IW.IDLE_NEEDS.logs.hint, 'logs: no depth rule')
  assert.equal(IW.idleDepthHint('iron', NaN), IW.IDLE_NEEDS.iron.hint)
})
await t('near bedrock the iron hint names surface, not an impossible mine', () => {
  const h = IW.idleDepthHint('iron', -55)
  assert.match(h, /surface/)
  assert.ok(!/mine with y=/.test(h))
})

// ---- the band dispose (pure) ----
await t('wellBandDue: 29-33 slots with a well-able stack; never below 29, never without a stack, 34+ stays the old rule, off: never', () => {
  for (let s = 29; s <= 33; s++) assert.equal(WL.wellBandDue({ on: true, slots: s, junkStacks: 1 }), true, `slots ${s}`)
  assert.equal(WL.wellBandDue({ on: true, slots: 28, junkStacks: 5 }), false)
  assert.equal(WL.wellBandDue({ on: true, slots: 31, junkStacks: 0 }), false)
  assert.equal(WL.wellBandDue({ on: true, slots: 34, junkStacks: 1 }), false)
  assert.equal(WL.wellBandDue({ on: false, slots: 31, junkStacks: 3 }), false)
})
await t('wellBandOn: default on; off in the showcase pool (stoneworks); IDLEWORK_WELL=0 off, =1 on anywhere', () => {
  assert.equal(WL.wellBandOn({}), true)
  assert.equal(WL.wellBandOn({ MEMORY_POOL: 'board-a' }), true)
  assert.equal(WL.wellBandOn({ MEMORY_POOL: 'showcase' }), false)
  assert.equal(WL.wellBandOn({ MEMORY_POOL: 'showcase', IDLEWORK_WELL: '1' }), true)
  assert.equal(WL.wellBandOn({ IDLEWORK_WELL: '0' }), false)
})
const wellArgs = (o = {}) => ({ now: 10 ** 12, distHome: 3, well: () => ({ open: false, attended: false, breached: false }), state: {}, ...o })
await t('wellOrder at town: a 30-slot bag with well-able stacks gets dispose_well (the whole plan: no visit args); 28 or off gets none; 34 as before', () => {
  const r = WL.wellOrder(wellArgs({ slots: 30, freeSlots: 6, junkStacks: 3, bandOn: true }))
  assert.equal(r.order?.skill, 'dispose_well')
  assert.deepEqual(r.order.args, {}, 'not a visit order: disposeWell throws the full plan (cobble at the cap, stock)')
  assert.equal(WL.wellOrder(wellArgs({ slots: 28, freeSlots: 8, junkStacks: 3, bandOn: true })).order, null)
  assert.equal(WL.wellOrder(wellArgs({ slots: 30, freeSlots: 6, junkStacks: 3, bandOn: false })).order, null)
  assert.equal(WL.wellOrder(wellArgs({ slots: 34, freeSlots: 2, junkStacks: 3, bandOn: false })).order?.skill, 'dispose_well')
  assert.equal(WL.wellOrder(wellArgs({ slots: 30, freeSlots: 6, junkStacks: 0, bandOn: true })).order, null, 'nothing well-able: no order')
})
await t('the band throws what the 34-slot order throws: cobble only at the proven cap, the bot keeps 64; the stone reserve stands', () => {
  let slot = 9
  const it = (name, count) => ({ name, count, slot: slot++ })
  const items = [it('cobblestone', 64), it('cobblestone', 64), it('cobblestone', 40), it('cobbled_deepslate', 30), it('granite', 20), it('clay_ball', 6), it('iron_pickaxe', 1)]
  const atCap = WL.disposePlan(items, { cobbleAtCap: true })
  const thrown = atCap.stacks.reduce((t, s) => t + (/cobble/.test(s.name) ? s.count : 0), 0)
  const held = 64 + 64 + 40 + 30
  assert.ok(held - thrown >= 64, `the bot keeps its 64 cobble + deepslate (kept ${held - thrown})`)
  assert.ok(thrown > 0)
  assert.ok(atCap.stacks.some(s => s.name === 'granite') && atCap.stacks.some(s => s.name === 'clay_ball'), 'the listed by-products go')
  assert.ok(!atCap.stacks.some(s => s.name === 'iron_pickaxe'))
  const below = WL.disposePlan(items, { cobbleAtCap: false })
  assert.ok(!below.stacks.some(s => /cobble/.test(s.name)), 'a town below its cap keeps every cobble stack (banked instead)')
})

// ---- the controller, on a fake clock and a fake bot ----
let NOW = 2_000_000_000
const realNow = Date.now
Date.now = () => NOW
let DIST = 3
const H = { x: config.world.homeX, z: config.world.homeZ }
const mkItems = () => [
  { name: 'oak_log', count: 16 }, { name: 'stick', count: 2 }, { name: 'cobblestone', count: 64 },
  { name: 'crafting_table', count: 1 }, { name: 'furnace', count: 1 }, { name: 'coal', count: 4 },
  { name: 'stone_pickaxe', count: 1, maxDurability: 131, durabilityUsed: 0 },
  { name: 'iron_pickaxe', count: 1, maxDurability: 250, durabilityUsed: 0 }, { name: 'bucket', count: 1 },
  { name: 'iron_ingot', count: 3 },
]
let ITEMS = mkItems()
const FILL = ['granite', 'diorite', 'andesite', 'tuff', 'dirt', 'clay_ball', 'gravel', 'moss_block', 'calcite', 'sand', 'flint', 'torch',
  'ladder', 'bamboo', 'apple', 'oak_sapling', 'birch_sapling', 'chest', 'lapis_lazuli', 'raw_copper', 'copper_ingot', 'dripstone_block',
  'pointed_dripstone', 'amethyst_block', 'salmon', 'snowball']
const fillTo = n => { let i = 0; while (ITEMS.length < n) ITEMS.push({ name: FILL[i++], count: 1 }) }
const bot = {
  entity: { position: { x: H.x, y: 64, z: H.z, distanceTo: () => DIST } },
  inventory: { items: () => ITEMS },
  registry: { blocks: {} },
  findBlock: () => null,
}
function controller () {
  const progress = { attempts: {}, skipped: [], skippedAt: {}, skipCount: {}, cycle: 0, completions: {}, progressAt: {} }
  const lessons = { getProgress: () => progress, setProgress: (a, s, sa, sc, cy, co, pa) => Object.assign(progress, { attempts: a, skipped: s, skippedAt: sa, skipCount: sc, cycle: cy, completions: co, progressAt: pa }), save () {} }
  const c = new MS.MilestoneController(bot, 'gatherer', lessons)
  c.chain = c.chain.slice(c.chain.length - MS.SUSTAINING.length)
  return c
}
const base = id => String(id ?? '').split('#')[0]
function settle (c, n = 4) { let s; for (let i = 0; i < n; i++) { c.refresh(); s = c.status(); if (base(s.id) === 'idle_work') break } return s }
const reset = (ms = MS) => { ms._idleReset(); ITEMS = mkItems(); DIST = 3; bot.entity.position.y = 64; delete process.env.IDLEWORK_BAGSTOP }

await t('THE BAG STOP, composed: a batch opened at 10 slots that fills the bag to 30 in the field is met -> return (the visit sheds it)', () => {
  reset()
  const c = controller()
  assert.equal(base(settle(c).id), 'idle_work')
  const k = MS._idleState().state.kind
  assert.ok(IW.BAG_KINDS.includes(k), k)
  DIST = 120
  fillTo(29); c.refresh()
  assert.equal(base(c.status().id), 'idle_work', 'at 29 the batch goes on')
  fillTo(30); c.refresh()
  assert.equal(base(c.status().id), 'return', `at 30: ${c.status().id}`)
  assert.ok(MS._idleState().state.gained < IW.IDLE_NEEDS[k].n, 'met by the stop, not by its n')
  assert.equal(MS._idleState().barred.size, 0, 'the stop bars nothing')
})
await t('...and IDLEWORK_BAGSTOP=0 keeps the batch open on the full bag (idlework-01 exactly)', () => {
  reset()
  process.env.IDLEWORK_BAGSTOP = '0'
  try {
    const c = controller()
    settle(c)
    DIST = 120; fillTo(33); c.refresh()
    assert.equal(base(c.status().id), 'idle_work')
  } finally { delete process.env.IDLEWORK_BAGSTOP }
})
await t('NO SPIN: a lap that opens on a 30-slot bag asks a scout lap (no bag gain), which is not met at home -- the rung holds, it does not re-open each refresh', () => {
  reset()
  fillTo(30)
  const c = controller()
  const s = settle(c)
  assert.equal(base(s.id), 'idle_work')
  assert.equal(MS._idleState().state.kind, 'scout')
  const cy = c.cycle
  for (let i = 0; i < 5; i++) c.refresh()
  assert.equal(c.cycle, cy, 'no lap re-entry while it is open')
  assert.equal(base(c.status().id), 'idle_work')
})
await t('THE HINT, composed: an iron batch at the stair landing (y=16) prompts a mine target the gate takes, not y=16', () => {
  reset()
  const c = controller()
  settle(c)
  // walk the rotation until this lap's batch is iron (the rotation's first slot may be grounds -> iron already)
  assert.equal(MS._idleState().state.kind, 'iron')
  bot.entity.position.y = 16
  const h = c.status().hint
  assert.match(h, /mine with y=8/)
  assert.ok(MN.mineTargetOk(16, 8))
  bot.entity.position.y = 64
  assert.equal(c.status().hint, IW.IDLE_NEEDS.iron.hint, 'at the surface the old hint')
})
await t('the iron ladder rung reads depth too (gather_iron_ore_3: hintFor below y=18, the static hint above)', () => {
  const ctl = new MS.MilestoneController(bot, 'gatherer', null)
  const rung = ctl.chain.find(m => m.id === 'gather_iron_ore_3')
  assert.ok(rung, 'the rung exists in the gatherer chain')
  bot.entity.position.y = 16
  assert.match(MS.hintOf(rung, bot), /mine with y=8/)
  bot.entity.position.y = 64
  assert.equal(MS.hintOf(rung, bot), 'gather with block=iron_ore.')
  assert.equal(MS.hintOf({ hint: 'x', hintFor: () => { throw new Error('boom') } }, bot), 'x', 'a throwing hintFor falls back')
})

// ---- structural: the visit's dispose in the band throws the whole plan (a skill this file cannot drive) ----
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
await t('STRUCTURE: disposeWell computes band from the bag and both its entry plan and throwPhase take the whole plan in the band', () => {
  const src = strip(readFileSync(new URL('../src/skills.mjs', import.meta.url), 'utf8'))
  assert.equal(src.split('const band = visit && WELL_BAND.on && slotsBefore >= WELL_BAND_SLOTS').length, 2)
  assert.equal(src.split('const entryPlan = visit && !band ? disposePlan(items(), { keep }) :').length, 2)
  assert.equal(src.split('listedOnly: visit && !band, keep })').length, 2)
})

// ---- mutants (anchored: present and unique, or the mutant is refused) ----
async function withMutant (path, old, neu, fn) {
  const src = readFileSync(path, 'utf8')
  assert.ok(src.includes(old), `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 60))} -- ANCHOR MISSING`)
  assert.equal(src.split(old).length, 2, 'ANCHOR MISSING OR NOT UNIQUE')
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, src.replace(old, neu).replace(/from '\.\//g, "from '../src/"))
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}
const IW_PATH = new URL('../src/idlework.mjs', import.meta.url)
const WL_PATH = new URL('../src/well.mjs', import.meta.url)
const MS_PATH = new URL('../src/milestones.mjs', import.meta.url)
await t('MUTANT KILLED: no bag stop in idleMet -> a batch on a 36-slot bag is never met', async () => {
  await withMutant(IW_PATH, '  if (idleBagFull(state, slots)) return true\n', '', async mod => {
    assert.equal(mod.idleMet(mod.idleStep(null, 0, 'iron', 0, 0, 25), { slots: 36 }), false, 'the mutant keeps the batch open')
  })
  assert.equal(IW.idleMet(IW.idleStep(null, 0, 'iron', 0, 0, 25), { slots: 36 }), true)
})
await t('MUTANT KILLED: a bag batch opens on a full bag -> met at its first full read after a pickup (the spin the open rule prevents)', async () => {
  await withMutant(IW_PATH, '  if (!on || !Number.isFinite(slots) || slots <= openMax) return means\n', '  return means\n', async mod => {
    assert.equal(mod.idlePick(1, { means: mod.idleBagMeans(ALL, 33, { on: true }) }), 'logs', 'the mutant opens a bag batch at 33')
  })
  assert.equal(IW.idlePick(1, { means: IW.idleBagMeans(ALL, 33, { on: true }) }), 'scout')
})
await t('MUTANT KILLED: the band left out of the dispose order -> a 30-slot bag at a full town leaves with its surplus', async () => {
  await withMutant(WL_PATH, '(slots >= TRIGGER_SLOTS || wellBandDue({ on: bandOn, slots, junkStacks }))', 'slots >= TRIGGER_SLOTS', async mod => {
    assert.equal(mod.wellOrder(wellArgs({ slots: 30, freeSlots: 6, junkStacks: 3, bandOn: true })).order, null)
  })
})
await t('MUTANT KILLED: status() reads the static hint -> the model is told y=16 at y=16 again', async () => {
  await withMutant(MS_PATH, '      describe, progress, hint: hintOf(m, this.bot),\n', '      describe, progress, hint: m.hint,\n', async mod => {
    mod._idleReset(); ITEMS = mkItems(); DIST = 3; bot.entity.position.y = 64
    const c = new mod.MilestoneController(bot, 'gatherer', { getProgress: () => ({ attempts: {}, skipped: [], skippedAt: {}, skipCount: {}, cycle: 0, completions: {}, progressAt: {} }), setProgress () {}, save () {} })
    c.chain = c.chain.slice(c.chain.length - mod.SUSTAINING.length)
    for (let i = 0; i < 4; i++) { c.refresh(); if (base(c.status().id) === 'idle_work') break }
    bot.entity.position.y = 16
    assert.match(c.status().hint, /down to y=16/, 'the mutant prints the static hint')
    bot.entity.position.y = 64
  })
})

Date.now = realNow
console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
