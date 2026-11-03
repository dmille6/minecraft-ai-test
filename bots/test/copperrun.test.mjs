// COPPERRUN-01: the waiting copper hall's bill drives a copper gather (bots/src/copperhall.mjs copperRunOrder / copperShort /
// townCopperOf, shop.mjs buildOrder's copper ask, skills.mjs copperAsk / copperRunInstall, features.mjs). Behaviour: the town
// reading counts raw copper and blocks; the OPENING still counts ingots only (a block in a chest is never drawn); the run issues
// only while the hall waits short of copper, from off a project site, at exposed ore in reach; every skip; the same ore cell backs
// off; the cheap tests run before the readings; the build order asks it in the idle branch BEFORE the expedition and never while a
// project has work; a run that does not issue leaves the expedition exactly as before (no dead end). Mutants assert their anchors.
import assert from 'node:assert'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'

const H = await import('../src/copperhall.mjs')
const SHOP = await import('../src/shop.mjs')
const HALL_PATH = new URL('../src/copperhall.mjs', import.meta.url)
const SHOP_PATH = new URL('../src/shop.mjs', import.meta.url)
const SKILLS_PATH = new URL('../src/skills.mjs', import.meta.url)
const FEATURES_PATH = new URL('../src/features.mjs', import.meta.url)

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 5).join('\n        ')}`) }
}
async function withMutant (file, old, neu, fn) {
  const src = readFileSync(file, 'utf8')
  assert.ok(src.split(old).length === 2, `ANCHOR MISSING OR NOT UNIQUE: ${JSON.stringify(old.slice(0, 70))}`)
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, src.replace(old, neu).replace(/from '\.\//g, "from '../src/"))
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')

// the showcase on 11-03 02:45Z: 138 ingots, 18 cut (need 247 = floor 103 + 4 batches x 36)
const GATE = { open: false, need: 247, have: 138, raw: 0, blocks: 3, cut: 18, why: 'copper_wait' }
const ORE = { block: 'copper_ore', dist: 14, at: '30,52,-40' }
const OK = { now: 1e12, on: true, waiting: true, gate: GATE, held: 0, freeSlots: 20, tripPick: true, site: { ok: true, hit: null }, ore: ORE, state: {} }

await t('the town reading counts raw copper and copper blocks beside ingots and cut copper', () => {
  const e = { obs: { at: 5, names: { copper_ingot: [40, 1], cut_copper: [4, 1], raw_copper: [9, 1], copper_block: [3, 1] } } }
  const f = { obs: { at: 6, names: { copper_ingot: [64, 1], raw_copper: [2, 1] } } }
  assert.deepEqual(H.townCopperOf({ '1,2,3': e, '4,5,6': f }), { ingots: 104, cut: 4, containers: 2, stale: 0, raw: 11, blocks: 3 })
  assert.deepEqual(H.townCopperOf({}), { unknown: true })
})

await t('the OPENING still counts ingots only: blocks and raw copper never open the hall (mats draws copper_ingot only)', () => {
  // control: 247 ingots at cut 18 opens
  assert.equal(H.hallOpening({ ingots: 247, cut: 18 }).open, true)
  assert.equal(H.hallOpening({ ingots: 246, cut: 18 }).open, false)
  // hallOpening takes no raw/blocks: a town of 138 ingots + 300 blocks stays waiting
  assert.equal(H.hallOpening({ ingots: 138, cut: 18, blocks: 300, raw: 300 }).open, false)
})

await t('copperShort: the target counts the town\'s raw copper (the smelt job makes it ingots); unknown is null', () => {
  assert.deepEqual(H.copperShort(GATE), { short: 109, need: 247, have: 138 })
  assert.deepEqual(H.copperShort({ ...GATE, raw: 109 }), { short: 0, need: 247, have: 247 })
  assert.equal(H.copperShort({ open: false, need: null, have: null }), null)
  assert.equal(H.copperShort(null), null)
})

await t('the run issues a gather of the exposed ore while the hall waits short of copper', () => {
  const r = H.copperRunOrder(OK)
  assert.equal(r.skip, null)
  assert.deepEqual(r.order.args, { block: 'copper_ore', count: H.COPPER_RUN_COUNT, copperrun: true })
  assert.equal(r.order.skill, 'gather')
  assert.equal(r.state.lastIssuedAt, 1e12)
  assert.equal(r.state.lastOre, '30,52,-40')
  assert.equal(H.copperRunOrder({ ...OK, ore: { ...ORE, block: 'deepslate_copper_ore' } }).order.args.block, 'deepslate_copper_ore')
})

await t('every skip names its reason, and none issues', () => {
  const sk = o => { const r = H.copperRunOrder({ ...OK, ...o }); assert.equal(r.order, null); return r.skip }
  assert.equal(sk({ on: false }), 'off')
  assert.equal(sk({ state: { lastIssuedAt: 1e12 - 60_000 } }), 'cooldown')
  assert.equal(sk({ state: { backoffUntil: 1e12 + 1 } }), 'cooldown')
  assert.equal(sk({ held: H.COPPER_RUN_CARRY }), 'carrying')
  assert.equal(sk({ freeSlots: H.COPPER_RUN_MIN_FREE - 1 }), 'room')
  assert.equal(sk({ tripPick: false }), 'pickaxe')
  assert.equal(sk({ state: { lastScanAt: 1e12 - 1000 } }), 'scan')
  assert.equal(sk({ waiting: false }), 'not_waiting')
  assert.equal(sk({ gate: { ...GATE, open: true } }), 'open')
  assert.equal(sk({ gate: { open: false, need: null, have: null } }), 'copper_unknown')
  assert.equal(sk({ gate: { ...GATE, have: 247 } }), 'stocked')
  assert.equal(sk({ gate: { ...GATE, raw: 200 } }), 'stocked')
  assert.equal(sk({ site: { ok: false, hit: null } }), 'site_unknown')
  assert.equal(sk({ site: null }), 'site_unknown')
  assert.equal(sk({ site: { ok: true, hit: 'project:monument' } }), 'on_site')
  assert.equal(sk({ ore: null }), 'no_ore')
  assert.equal(sk({ ore: { block: 'iron_ore', dist: 3, at: '1,2,3' } }), 'no_ore')
})

await t('the same ore cell still there at the next ask backs the bot off (no repeated walk at ore gather cannot take)', () => {
  const r1 = H.copperRunOrder(OK)
  const later = 1e12 + H.COPPER_RUN_COOLDOWN_MS + 1
  const r2 = H.copperRunOrder({ ...OK, now: later, state: r1.state })
  assert.equal(r2.skip, 'same_ore')
  assert.equal(r2.state.backoffUntil, later + H.COPPER_RUN_BACKOFF_MS)
  assert.equal(H.copperRunOrder({ ...OK, now: later + 60_001, state: r2.state }).skip, 'cooldown')
  // after the back-off the cell may be offered again (once)
  const r4 = H.copperRunOrder({ ...OK, now: later + H.COPPER_RUN_BACKOFF_MS + 1, state: r2.state })
  assert.ok(r4.order, r4.skip)
  // a DIFFERENT cell is a new run, not a back-off
  const r5 = H.copperRunOrder({ ...OK, now: later, state: r1.state, ore: { ...ORE, at: '31,52,-40' } })
  assert.ok(r5.order, r5.skip)
})

await t('the cheap tests run before the readings: no gate, site or ore read for a bot with no pickaxe or room', () => {
  const calls = []
  const lz = (k, v) => () => { calls.push(k); return v }
  const reads = { waiting: lz('waiting', true), gate: lz('gate', GATE), site: lz('site', { ok: true, hit: null }), ore: lz('ore', ORE) }
  H.copperRunOrder({ ...OK, ...reads, tripPick: false })
  H.copperRunOrder({ ...OK, ...reads, freeSlots: 0 })
  assert.deepEqual(calls, [])
  H.copperRunOrder({ ...OK, ...reads, gate: lz('gate', { ...GATE, have: 999 }) })
  assert.deepEqual(calls, ['waiting', 'gate'], 'a stocked town never scans the world')
})

const BASE = { on: true, shared: true, atTown: true, planned: true, now: 1e12, health: 20, freeSlots: 30 }
await t('buildOrder asks the copper run in the idle branch BEFORE the expedition, and never while a project has work', () => {
  const asked = []
  SHOP.setCopperAsk(o => { asked.push(o); return { order: { skill: 'gather', args: { block: 'copper_ore', count: 16, copperrun: true } } } })
  SHOP.setExpeditionAsk(() => ({ ok: true, phase: 'trip' }))
  try {
    const r1 = SHOP.buildOrder({ ...BASE, complete: true, record: { plot: 'treefarm' } })
    assert.equal(r1.order.skill, 'gather')
    assert.equal(r1.order.args.copperrun, true)
    assert.equal(asked.length, 1)
    assert.deepEqual(Object.keys(asked[0]).sort(), ['freeSlots', 'health', 'now'])
    // an open project's visit: the copper run is not asked, the visit is ordered
    const r2 = SHOP.buildOrder({ ...BASE, complete: false, record: { plot: 'house1', structure_complete: false }, state: { lastAt: 0 } })
    assert.deepEqual(r2.order, { skill: 'build_shop', args: {} })
    assert.equal(asked.length, 1)
    assert.equal(SHOP.buildOrder({ ...BASE, atTown: false, complete: true }).order, null, 'only at town')
    assert.equal(asked.length, 1)
  } finally { SHOP.setCopperAsk(null); SHOP.setExpeditionAsk(null) }
})

await t('THE CHAIN: a run that does not issue (or throws) leaves the expedition exactly as before -- the real copperRunOrder', () => {
  SHOP.setExpeditionAsk(() => ({ ok: true, phase: 'trip' }))
  try {
    for (const o of [{ ore: null }, { gate: { ...GATE, have: 999 } }, { waiting: false }, { tripPick: false }]) {
      SHOP.setCopperAsk(() => H.copperRunOrder({ ...OK, ...o }))
      const r = SHOP.buildOrder({ ...BASE, complete: true, record: { plot: 'treefarm' } })
      assert.deepEqual(r.order, { skill: 'build_shop', args: { expedition: true, phase: 'trip' } }, JSON.stringify(o))
    }
    SHOP.setCopperAsk(() => { throw new Error('boom') })
    assert.equal(SHOP.buildOrder({ ...BASE, complete: true, record: { plot: 'treefarm' } }).order.args.expedition, true)
    // and with no expedition either: the base's answer
    SHOP.setExpeditionAsk(null)
    SHOP.setCopperAsk(() => H.copperRunOrder({ ...OK, ore: null }))
    assert.deepEqual(SHOP.buildOrder({ ...BASE, complete: true, record: { plot: 'treefarm' } }), { order: null, skip: 'complete' })
  } finally { SHOP.setCopperAsk(null); SHOP.setExpeditionAsk(null) }
})

await t('unset (COPPERRUN / COPPERHALL off): buildOrder is the base, the expedition first', () => {
  SHOP.setCopperAsk(null)
  SHOP.setExpeditionAsk(() => ({ ok: true, phase: 'trip' }))
  try { assert.equal(SHOP.buildOrder({ ...BASE, complete: true, record: { plot: 'treefarm' } }).order.args.expedition, true) } finally { SHOP.setExpeditionAsk(null) }
  // the hall (and so the run) is on only in the showcase pool by default
  assert.equal(H.copperhallOn({}, 'showcase'), true)
  assert.equal(H.copperhallOn({}, 'board-a'), false)
})

await t('the row and mode details stay under 300 chars and name the counts', () => {
  const d = H.copperRunDetail({ skip: 'no_ore', gate: { ...GATE, raw: 12 }, held: 5, free: 20 })
  assert.ok(d.length < 300)
  assert.match(d, /skip=no_ore ingots=138 raw=12 blocks=3 cut=18 need=247 held=5 free=20/)
  assert.ok(H.copperRunModeDetail(true, true).length < 300)
})

await t('WIRED: features.mjs installs the run; skills.mjs sets the ask only where the hall is on (structural)', () => {
  const f = strip(readFileSync(FEATURES_PATH, 'utf8'))
  assert.match(f, /try \{ copperRunInstall\(bot\) \} catch/)
  const s = strip(readFileSync(SKILLS_PATH, 'utf8'))
  assert.match(s, /if \(COPPERRUN\.on && COPPERHALL_ON\.on\) setCopperAsk\(copperAsk\)/)
  assert.match(s, /hallOpening\(\{ ingots: c\.ingots, cut: c\.cut, reserve:/, 'the opening is still ingots + cut only')
})

await t('MUTANT: buildOrder without the copper branch fails the idle-branch test', async () => {
  await withMutant(SHOP_PATH, '    if (cr?.order) return { order: cr.order, skip: null }\n', '\n', async M => {
    M.setCopperAsk(() => ({ order: { skill: 'gather', args: { block: 'copper_ore' } } }))
    M.setExpeditionAsk(() => ({ ok: true, phase: 'trip' }))
    assert.equal(M.buildOrder({ ...BASE, complete: true, record: { plot: 'treefarm' } }).order.skill, 'build_shop', 'the mutant orders the expedition')
  })
})

await t('MUTANT: a target that ignores raw copper fails the stocked test', async () => {
  await withMutant(HALL_PATH, '  const have = gate.have + Math.max(0, Number(gate.raw) || 0)\n', '  const have = gate.have\n', async M => {
    assert.notEqual(M.copperRunOrder({ ...OK, gate: { ...GATE, raw: 200 } }).skip, 'stocked')
  })
})

await t('MUTANT: without the same-ore check the run walks at the same cell again', async () => {
  await withMutant(HALL_PATH, "  if (o.at && o.at === s.lastOre) {", "  if (false) {", async M => {
    const r1 = M.copperRunOrder(OK)
    assert.ok(M.copperRunOrder({ ...OK, now: 1e12 + M.COPPER_RUN_COOLDOWN_MS + 1, state: r1.state }).order, 'the mutant re-issues')
  })
})

await t('MUTANT: an issue from a project site (no site check) is caught', async () => {
  await withMutant(HALL_PATH, "  if (st.hit) return skip('on_site')\n", '\n', async M => {
    assert.ok(M.copperRunOrder({ ...OK, site: { ok: true, hit: 'project:monument' } }).order, 'the mutant issues on a site')
  })
})

console.log(`\ncopperrun: ${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
