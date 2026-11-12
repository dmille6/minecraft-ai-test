// LOGGATE-01 (OWNER 2026-11-12: "could we put a limit, when we had a huge excess of logs bots stop cutting down trees?"): the
// town log cap as a REFUSAL at admission. Measured 11-12 (6 h, 80 bots): capped in 15 of 16 towns, and 432 log gathers still
// succeeded there, 332 the model's own choice -- the cap printed a line and refused nothing.
//
// Behaviour: the pure decision (logcap.mjs logGatherGate) over its table and over random inputs; then the REAL AdmissionControl
// with a fake bot -- the refusal, the rewrite to a withdrawal that is itself admitted, the bounded cut, and the chain that must
// never dead-end a bot short of wood. Every mutant's anchor is asserted present and unique, and each is killed.
import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

process.env.LOG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-loggate-logs-'))
process.env.BOT_NAME = 'GateBot'
process.env.OLLAMA_MODEL ??= 'qwen2.5:7b-instruct'
process.env.HOME_X = '0'; process.env.HOME_Y = '70'; process.env.HOME_Z = '0'
process.env.POOL_STATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-loggate-pool-'))
delete process.env.LOGGATE; delete process.env.LOGCAP

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SRC = path.join(HERE, '..', 'src')
const mcData = createRequire(import.meta.url)('minecraft-data')('1.21.8')
const LC = await import('../src/logcap.mjs')
const { AdmissionControl } = await import('../src/admission.mjs')
const { WOOD_KEEP } = await import('../src/woodkeep.mjs')
const { tapRecords } = await import('../src/logger.mjs')

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 4).join('\n        ')}`) }
}
const CAPPED = { capped: true, why: 'above_high', logs: 4158, coverage: 1 }
const G = (o = {}) => LC.logGatherGate({ on: true, block: 'oak_log', count: 16, cap: CAPPED, wood: 0, keep: 16, inTown: true, top: { name: 'spruce_log', count: 900 }, triedAt: null, now: 1_000_000, ...o })

// ---------------------------------------------------------------- pure ---
await t('what is a log: logs, stems, stripped and all-bark forms; never planks, saplings, leaves, ores', () => {
  for (const n of ['oak_log', 'spruce_log', 'stripped_birch_log', 'crimson_stem', 'warped_stem', 'oak_wood', 'stripped_oak_wood', 'crimson_hyphae']) assert.equal(LC.isLogBlock(n), true, n)
  for (const n of ['oak_planks', 'oak_sapling', 'oak_leaves', 'iron_ore', 'cobblestone', 'dirt', 'bamboo', 'logs', '', null, undefined]) assert.equal(LC.isLogBlock(n), false, String(n))
})
await t('bagWoodUnits = logs + planks / 4 (the wood rung\'s own unit); topTownLog = the species held most', () => {
  assert.equal(LC.bagWoodUnits([{ name: 'oak_log', count: 5 }, { name: 'birch_planks', count: 10 }, { name: 'crimson_stem', count: 2 }, { name: 'stick', count: 30 }, { name: 'oak_sapling', count: 9 }]), 9.5)
  assert.equal(LC.bagWoodUnits([]), 0); assert.equal(LC.bagWoodUnits(null), 0)
  assert.deepEqual(LC.topTownLog({ oak_log: 300, spruce_log: 900, oak_planks: 5000, birch_log: 0 }), { name: 'spruce_log', count: 900 })
  assert.deepEqual(LC.topTownLog({ oak_log: 7, birch_log: 7 }), { name: 'birch_log', count: 7 }, 'a tie: the same species every time')
  assert.equal(LC.topTownLog({ oak_planks: 9, cobblestone: 4 }), null); assert.equal(LC.topTownLog(null), null)
})
await t('THE TABLE: holding the keep -> refused; short and in town with town logs -> the withdrawal; short and anything else -> the bounded cut', () => {
  const full = G({ wood: 16 })
  assert.equal(full.act, 'refuse'); assert.equal(full.need, 0)
  assert.match(full.detail, /the town holds 4158 logs, above its 1024 limit, and you carry 16 wood \(your keep is 16\): no tree cutting/)
  assert.match(full.detail, /Craft planks or sticks from your bag, or pick other work/, 'the remedy is something the bot can do from where it stands')
  assert.equal(G({ wood: 40.5 }).act, 'refuse')
  assert.deepEqual(G({ wood: 4 }), { act: 'withdraw', why: 'town_has_logs', need: 12, item: 'spruce_log', count: 12, cut: 12 })
  assert.equal(G({ wood: 15.5 }).need, 1, 'half a unit short is short')
  assert.deepEqual(G({ wood: 15.5 }), { act: 'withdraw', why: 'town_has_logs', need: 1, item: 'spruce_log', count: 1, cut: 4 })
  assert.equal(G({ wood: 0, top: { name: 'oak_log', count: 5 } }).count, 5, 'never more than the town holds')
  assert.deepEqual(G({ wood: 4, inTown: false }), { act: 'clamp', why: 'away', need: 12, count: 12 })
  assert.deepEqual(G({ wood: 4, top: null }), { act: 'clamp', why: 'no_town_logs', need: 12, count: 12 })
  assert.deepEqual(G({ wood: 4, top: { name: 'oak_log', count: 0 } }), { act: 'clamp', why: 'no_town_logs', need: 12, count: 12 })
  assert.deepEqual(G({ wood: 4, triedAt: 1_000_000 - 60_000 }), { act: 'clamp', why: 'withdraw_tried', need: 12, count: 12 })
  assert.equal(G({ wood: 4, triedAt: 1_000_000 - LC.LOGGATE_LATCH_MS }).act, 'withdraw', 'the latch ends')
})
await t('the bounded cut: never more than was asked, never more than the keep, at least a small tree when more was asked', () => {
  assert.equal(G({ wood: 0, inTown: false, count: 64 }).count, 16)
  assert.equal(G({ wood: 0, inTown: false, count: 128 }).count, LC.LOGGATE_CUT_MAX)
  assert.equal(G({ wood: 15, inTown: false, count: 64 }).count, LC.LOGGATE_CUT_MIN, 'one unit short still cuts a small tree')
  assert.equal(G({ wood: 15, inTown: false, count: 2 }).count, 2, 'never more than the model asked')
  assert.equal(G({ wood: 3, inTown: false, count: undefined }).count, 13)
})
await t('NOT THE GATE\'S: off, a block that is not a log, an uncapped or unread town -> pass (the base)', () => {
  assert.deepEqual(G({ on: false, wood: 99 }), { act: 'pass', why: 'off' })
  assert.deepEqual(G({ block: 'iron_ore', wood: 99 }), { act: 'pass', why: 'not_a_log' })
  for (const cap of [null, undefined, { capped: false, why: 'below_low', logs: 500 }, { capped: false, why: 'unread' }, { capped: false, why: 'coverage', logs: 2000 }]) {
    assert.deepEqual(G({ cap, wood: 99 }), { act: 'pass', why: 'uncapped' }, JSON.stringify(cap))
  }
  assert.equal(G({ cap: { capped: true, why: 'held', logs: null }, wood: 20 }).act, 'refuse', 'a cap held through an unreadable index still refuses')
  assert.match(G({ cap: { capped: true, why: 'held', logs: null }, wood: 20 }).detail, /the town holds more logs than it needs/)
})
await t('PROPERTY (20,000 random cases): a bot short of wood is NEVER refused; a capped bot holding its keep ALWAYS is; a pass changes nothing', () => {
  let seed = 20261112
  const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32
  const pick = a => a[Math.floor(rnd() * a.length)]
  let short = 0, held = 0
  for (let i = 0; i < 20_000; i++) {
    const wood = pick([0, 0.25, 3, 7.75, 15, 15.75, 16, 16.25, 30, 200])
    const o = { on: rnd() > 0.05, block: pick(['oak_log', 'warped_stem', 'stripped_oak_wood', 'cobblestone', 'oak_planks']), count: pick([1, 3, 16, 64, 128, undefined]),
                cap: pick([CAPPED, { capped: true, why: 'band', logs: 900 }, { capped: true, why: 'held', logs: null }, { capped: false, why: 'below_low', logs: 10 }, null]),
                wood, keep: 16, inTown: rnd() > 0.5, top: pick([null, { name: 'oak_log', count: 3 }, { name: 'spruce_log', count: 4000 }, { name: 'oak_log', count: 0 }]),
                triedAt: pick([null, 1_000_000 - 1000, 1_000_000 - 3_600_000]), now: 1_000_000 }
    const g = LC.logGatherGate(o)
    const live = o.on && LC.isLogBlock(o.block) && !!o.cap?.capped
    if (!live) { assert.equal(g.act, 'pass', JSON.stringify(o)); continue }
    if (wood < 16) {
      short++
      assert.notEqual(g.act, 'refuse', `short of wood and refused: ${JSON.stringify(o)}`)
      assert.ok(g.act === 'withdraw' || g.act === 'clamp')
      const n = g.act === 'withdraw' ? g.cut : g.count
      assert.ok(n >= 1 && n <= LC.LOGGATE_CUT_MAX && n <= (o.count ?? Infinity), `the cut is bounded: ${n} ${JSON.stringify(o)}`)
      if (g.act === 'withdraw') assert.ok(o.inTown && o.top?.count > 0 && g.count >= 1 && g.count <= o.top.count && g.count <= 16)
    } else { held++; assert.equal(g.act, 'refuse', JSON.stringify(o)) }
  }
  assert.ok(short > 3000 && held > 1500, `positive control: both populations were drawn (${short}, ${held})`)
})
await t('LOGGATE=off is the rollback (a fresh process): the switch is off and the gate passes everything; LOGCAP is untouched', () => {
  const src = path.join(SRC, 'logcap.mjs')
  const r = spawnSync(process.execPath, ['--input-type=module', '-e',
    `import('${src}').then(m => console.log(JSON.stringify([m.logGateOn(), m.logGatherGate({ block: 'oak_log', count: 16, cap: { capped: true, logs: 4000 }, wood: 99 }).act, m.logCapConfig().on])))`],
  { env: { ...process.env, LOGGATE: 'off' }, encoding: 'utf8' })
  assert.deepEqual(JSON.parse(r.stdout), [false, 'pass', true], r.stderr)
  assert.equal(LC.logGateOn(), true, 'positive control: on by default here')
})

// ---------------------------------------------------------------- the real AdmissionControl ---
function botWith (inv, { at = { x: 2, y: 70, z: 1 } } = {}) {
  const items = Object.entries(inv).map(([name, count], slot) => ({ name, count, slot: 9 + slot, type: mcData.itemsByName[name]?.id }))
  return { username: 'GateBot', entity: { position: at }, health: 20, food: 20, players: {}, inventory: { items: () => items },
           registry: mcData, recipesFor: () => [], findBlock: () => null, findBlocks: () => [], blockAt: () => ({ name: 'stone', boundingBox: 'block' }) }
}
const ROWS = []
tapRecords(r => { if (r?.skill?.name === '_loggate') ROWS.push(r.skill) })
const world = ({ cap = CAPPED, top = { name: 'spruce_log', count: 900 } } = {}) => { LC.setLogCapState(() => cap); LC.setTownLogTop(() => top) }
const CUT = { skill: 'gather', args: { block: 'oak_log', count: 16 }, reason: 'the town store wants logs' }
const FAR = { x: 400, y: 70, z: 300 }

await t('ADMISSION: a capped town and a bot holding its wood keep -> the gather is REFUSED with the remedy, and a _loggate row says so', () => {
  world(); ROWS.length = 0
  const ac = new AdmissionControl()
  const r = ac.check(structuredClone(CUT), botWith({ oak_log: 20, stone_pickaxe: 1 }), null)
  assert.equal(r.ok, false); assert.equal(r.reason, 'log_cap')
  assert.match(r.detail, /above its 1024 limit, and you carry 20 wood \(your keep is 16\): no tree cutting\. Craft planks or sticks from your bag, or pick other work/)
  assert.equal(ROWS.length, 1); assert.equal(ROWS[0].status, 'failed')
  assert.match(ROWS[0].detail, /^loggate act=refuse why=capped block=oak_log asked=16 need=-4 wood=20\.0 town_logs=4158 cap=above_high$/)
  // planks count: 64 planks = 16 units
  assert.equal(ac.check(structuredClone(CUT), botWith({ oak_planks: 64 }), null).reason, 'log_cap')
})
await t('ADMISSION positive controls: the same bot in an UNCAPPED town cuts as before; a capped bot gathers iron as before; a far bot holding its keep is refused too', () => {
  world({ cap: { capped: false, why: 'below_low', logs: 468 } })
  const a = new AdmissionControl().check(structuredClone(CUT), botWith({ oak_log: 20 }), null)
  assert.equal(a.ok, true, JSON.stringify(a)); assert.equal(a.skill, 'gather'); assert.equal(a.args.count, 16)
  world()
  const b = new AdmissionControl().check({ skill: 'gather', args: { block: 'iron_ore', count: 3 }, reason: 'x' }, botWith({ oak_log: 20, stone_pickaxe: 1 }), null)
  assert.notEqual(b.reason, 'log_cap', JSON.stringify(b))
  assert.equal(new AdmissionControl().check(structuredClone(CUT), botWith({ oak_log: 20 }, { at: FAR }), null).reason, 'log_cap', 'the limit holds away from town')
})
await t('ADMISSION: short of wood IN TOWN -> the proposal is REWRITTEN to a withdrawal of the town\'s logs, admitted as a withdrawal', () => {
  world(); ROWS.length = 0
  const ac = new AdmissionControl()
  const r = ac.check(structuredClone(CUT), botWith({ oak_log: 4 }), null)
  assert.equal(r.ok, true, JSON.stringify(r))
  assert.equal(r.skill, 'withdraw', 'cognitive.mjs runs admitted.skill'); assert.deepEqual(r.args, { item: 'spruce_log', count: 12 })
  assert.match(ROWS.at(-1).detail, /^loggate act=withdraw why=town_has_logs block=oak_log asked=16 need=12 wood=4\.0 town_logs=4158 cap=above_high to=withdraw:spruce_log:12$/)
})
await t('THE CHAIN THAT MUST NOT DEAD-END: the withdrawal brings nothing -> the next gather is the BOUNDED CUT, never a refusal; a withdrawal that worked re-arms it', () => {
  world(); ROWS.length = 0
  const ac = new AdmissionControl(), bot = botWith({ oak_log: 4 })
  const first = ac.check(structuredClone(CUT), bot, null)
  assert.equal(first.skill, 'withdraw')
  ac.noteFailure(first.skill, first.args)                       // the chest was full / unreachable / empty
  const second = ac.check(structuredClone(CUT), bot, null)
  assert.equal(second.ok, true, JSON.stringify(second)); assert.equal(second.skill, 'gather'); assert.equal(second.args.count, 12, 'what it is short, no more')
  assert.match(ROWS.at(-1).detail, /act=clamp why=withdraw_tried .* to=gather:12$/)
  // and with NO outcome reported at all (declined, interrupted): still the cut, not a second withdrawal and not a refusal
  const ac2 = new AdmissionControl()
  assert.equal(ac2.check(structuredClone(CUT), bot, null).skill, 'withdraw')
  assert.equal(ac2.check(structuredClone(CUT), bot, null).skill, 'gather')
  // a withdrawal that brought wood clears the latch: still short later -> the town's logs again
  const ac3 = new AdmissionControl()
  const w = ac3.check(structuredClone(CUT), bot, null)
  ac3.noteSuccess(w.skill, w.args)
  assert.equal(ac3.check(structuredClone(CUT), bot, null).skill, 'withdraw')
})
await t('ADMISSION: short of wood AWAY from town, or a town whose index shows no log -> the bounded cut (a bot can always make its own tools)', () => {
  world(); ROWS.length = 0
  const away = new AdmissionControl().check({ skill: 'gather', args: { block: 'oak_log', count: 64 }, reason: 'x' }, botWith({ oak_planks: 8 }, { at: FAR }), null)
  assert.equal(away.ok, true, JSON.stringify(away)); assert.equal(away.skill, 'gather'); assert.equal(away.args.count, 14)
  assert.match(ROWS.at(-1).detail, /act=clamp why=away block=oak_log asked=64 need=14 wood=2\.0 .* to=gather:14$/)
  world({ top: null })
  const none = new AdmissionControl().check(structuredClone(CUT), botWith({}), null)
  assert.equal(none.skill, 'gather'); assert.equal(none.args.count, 16)
})
await t('ADMISSION: a withdrawal admission refuses (a stack still on the cursor) -> the bounded cut is judged as a gather, never refused for the cap', () => {
  world()
  const bot = botWith({ oak_log: 4 })
  bot.inventoryUnsettled = { why: 'a stack is on the cursor' }
  const r = new AdmissionControl().check(structuredClone(CUT), bot, null)
  assert.notEqual(r.reason, 'log_cap', JSON.stringify(r))
  assert.equal(r.reason, 'inventory_unsettled', 'the gather meets the base\'s own check next, exactly as an ungated gather would')
})
await t('a DRY check (the pipeline\'s prefetch) writes no row, sets no latch, and answers what check() will', () => {
  world(); ROWS.length = 0
  const ac = new AdmissionControl(), bot = botWith({ oak_log: 4 })
  const d = ac.dryCheck(structuredClone(CUT), bot, null)
  assert.equal(d.ok, true); assert.equal(d.skill, 'withdraw')
  assert.equal(ROWS.length, 0, 'no row from a dry check'); assert.equal(ac.logGateTriedAt ?? null, null, 'no latch from a dry check')
  assert.equal(ac.check(structuredClone(CUT), bot, null).skill, 'withdraw', 'the real check still withdraws')
  assert.equal(new AdmissionControl().dryCheck(structuredClone(CUT), botWith({ oak_log: 30 }), null).reason, 'log_cap')
})
await t('the gate never breaks a decision: a reader that throws is the base (the gather is judged as before)', () => {
  LC.setLogCapState(() => { throw new Error('index unreadable') }); LC.setTownLogTop(() => { throw new Error('boom') })
  const r = new AdmissionControl().check(structuredClone(CUT), botWith({ oak_log: 30 }), null)
  assert.notEqual(r.reason, 'log_cap'); assert.equal(r.ok, true, JSON.stringify(r))
})

// ---------------------------------------------------------------- mutants ---
async function withMutant (file, pairs, fn) {
  const p = path.join(SRC, file)
  let src = fs.readFileSync(p, 'utf8')
  for (const [old, neu] of pairs) { assert.equal(src.split(old).length - 1, 1, `ANCHOR MISSING OR NOT UNIQUE in ${file}: ${old.slice(0, 70)}`); src = src.replace(old, neu) }
  const tmp = path.join(SRC, `_mut_${process.pid}_${Math.random().toString(36).slice(2)}_${file}`)
  fs.writeFileSync(tmp, src)
  try { return await fn(await import(`${tmp}?${Date.now()}`)) } finally { fs.unlinkSync(tmp) }
}
await t('MUTANT KILLED: the admission call removed (the base: advice only) -> a capped bot holding its keep cuts anyway', async () => {
  world()
  await withMutant('admission.mjs', [['      const g = this.#logGate(args, bot)\n', '      const g = null\n']], async M => {
    const r = new M.AdmissionControl().check(structuredClone(CUT), botWith({ oak_log: 20 }), null)
    assert.equal(r.ok, true, 'the mutant refused anyway: the refusal test proves nothing'); assert.equal(r.skill, 'gather')
  })
})
await t('MUTANT KILLED: `need <= 0` weakened to `need < 0` -> a bot holding EXACTLY its keep is not refused', async () => {
  await withMutant('logcap.mjs', [['  if (need <= 0) {\n', '  if (need < 0) {\n']], async M => {
    assert.notEqual(M.logGatherGate({ on: true, block: 'oak_log', count: 16, cap: CAPPED, wood: 16, keep: 16, inTown: false }).act, 'refuse', 'the mutant refused anyway')
  })
})
await t('MUTANT KILLED: the short bot refused too (`need <= 0` -> always) -> the starvation property fails', async () => {
  await withMutant('logcap.mjs', [['  if (need <= 0) {\n', '  if (true) {\n']], async M => {
    assert.equal(M.logGatherGate({ on: true, block: 'oak_log', count: 16, cap: CAPPED, wood: 0, keep: 16, inTown: false }).act, 'refuse', 'the mutant still let the short bot cut')
  })
})
await t('MUTANT KILLED: the latch removed -> a bot whose withdrawal brought nothing is sent to withdraw again, for ever', async () => {
  await withMutant('logcap.mjs', [["  if (latched) return { act: 'clamp', why: 'withdraw_tried', need, count: cut }\n", '']], async M => {
    assert.equal(M.logGatherGate({ on: true, block: 'oak_log', count: 16, cap: CAPPED, wood: 4, keep: 16, inTown: true, top: { name: 'oak_log', count: 50 }, triedAt: 999_000, now: 1_000_000 }).act, 'withdraw', 'the mutant clamped anyway')
  })
})
await t('MUTANT KILLED: the latch never set at the rewrite -> the second request withdraws again instead of cutting', async () => {
  world()
  await withMutant('admission.mjs', [['            this.logGateTriedAt = Date.now()\n', '']], async M => {
    const ac = new M.AdmissionControl(), bot = botWith({ oak_log: 4 })
    assert.equal(ac.check(structuredClone(CUT), bot, null).skill, 'withdraw')
    assert.equal(ac.check(structuredClone(CUT), bot, null).skill, 'withdraw', 'the mutant cut anyway: the chain test proves nothing')
  })
})
await t('MUTANT KILLED: the gate applied to every block -> a capped bot cannot gather iron', async () => {
  await withMutant('logcap.mjs', [["  if (!isLogBlock(block)) return { act: 'pass', why: 'not_a_log' }\n", '']], async M => {
    assert.equal(M.logGatherGate({ on: true, block: 'iron_ore', count: 3, cap: CAPPED, wood: 20, keep: 16 }).act, 'refuse', 'the mutant passed iron anyway')
  })
})

assert.equal(WOOD_KEEP, 16, 'the keep the gate reads (woodkeep.mjs) is the 16 the wording and the tests assume')
console.log(`\nloggate: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
