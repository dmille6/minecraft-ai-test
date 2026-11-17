// MINECREW-01SHOW (minecrew.mjs, minecrewio.mjs; cognitive.mjs, admission.mjs, prompt.mjs, milestones.mjs, skills.mjs crew_up /
// groundsIdleAsk): underground work is a small crew's, and an idle bot is steered to the town's surface work. The decisions as pure
// functions, the leases over a real directory, the admission clause through the REAL gate, the chains through the REAL cognitive
// loop (a fake runner, a fake model, the crew's file calls faked), and mutants of the rules and of the wiring. The switch's OFF
// side has its own file (minecrew-off.test.mjs: MINECREW is read once, at import).
process.env.LOG_DIR = process.env.LOG_DIR || '/tmp/mcbot-test-logs-minecrew'
process.env.BOT_NAME = process.env.BOT_NAME || 'CrewBot'
process.env.MEMORY_SCOPE = process.env.MEMORY_SCOPE || 'isolated'
process.env.LOG_LEVEL = 'error'
process.env.BOT_ROLE = 'gatherer'
// ABOVE the crew's 50 ms re-tick (review r1 B1: at 40 ms a re-tick after every refusal looked like the ordinary cadence)
process.env.LLM_DECISION_COOLDOWN_MS = '120'
process.env.HOME_X = '0'; process.env.HOME_Y = '70'; process.env.HOME_Z = '0'
process.env.WORLD_BORDER_RADIUS = '100000'
process.env.PIPELINE = 'off'
process.env.FEWERDEC_CONTINUE = '0'; process.env.FEWERDEC_VETOSKIP = '0'; process.env.FEWERDEC_PAUSEWAIT = '0'
process.env.MINECREW_IDLE_MS = '200'
process.env.MINECREW_HEARTBEAT_MS = '100'; process.env.MINECREW_UP_AFTER_MS = '300'; process.env.MINECREW_RUN_WATCH_MS = '40'
delete process.env.MINECREW_UP_JITTER_MS
delete process.env.MINECREW; delete process.env.MINECREW_MAX; delete process.env.MINECREW_Y
import assert from 'node:assert/strict'
import nodeTest from 'node:test'
// the runner prints a failing file's last 40 lines: every failure is said again at the very end, with its message
const failures = []
const T0 = Date.now(), timeline = []
const test = (name, fn) => nodeTest(name, async (...a) => { timeline.push(`>${name.slice(0, 26)}@${Date.now() - T0}`); try { await fn(...a); timeline.push(`<ok@${Date.now() - T0}`) } catch (e) { timeline.push(`<FAIL@${Date.now() - T0}`); failures.push(`${name}\n    ${String(e?.message ?? e).split('\n').slice(0, 14).join('\n    ')}`); throw e } })
// a tick that throws is an unhandled rejection: node:test fails the running test and moves on while its loop lies dead -- say it
process.on('unhandledRejection', e => { failures.push(`UNHANDLED REJECTION @${Date.now() - T0} (a tick threw: the loop under test is dead)\n    ${String(e?.stack ?? e).split('\n').slice(0, 6).join('\n    ')}`) })
process.on('exit', () => { if (failures.length) console.log(`TIMELINE: ${timeline.slice(-60).join(' ')}`); if (failures.length) console.log(`\nFAILED TESTS (${failures.length}):\n${failures.map(f => `- ${f}`).join('\n')}`) })
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mcai-crew-'))
process.env.STATE_DIR = path.join(tmp, 'state')
const require_ = createRequire(import.meta.url)
const mcData = require_('minecraft-data')('1.21.8')
const { Vec3 } = require_('vec3')
const MC = await import('../src/minecrew.mjs')
const IO = await import('../src/minecrewio.mjs')
const { AdmissionControl } = await import('../src/admission.mjs')
const { Lessons } = await import('../src/lessons.mjs')
const { tapRecords } = await import('../src/logger.mjs')
const PR = await import('../src/prompt.mjs')
const MS = await import('../src/milestones.mjs')
const SK = await import('../src/skills.mjs')
const COG = await import('../src/cognitive.mjs')
const { COAL_FLOOR } = await import('../src/coalrun.mjs')
const TK = await import('../src/toolkit.mjs')
const DM = await import('../src/deepmine.mjs')
const { config } = await import('../src/config.mjs')
const FD = await import('../src/fewerdec.mjs')
const PL = await import('../src/pipeline.mjs')
const BP = await import('../src/buildproj.mjs')
const TI = await import('../src/townindex.mjs')
const GKM = await import('../src/groundskeeper.mjs')

const U = f => new URL(`../src/${f}`, import.meta.url)
const MC_PATH = U('minecrew.mjs'), ADM_PATH = U('admission.mjs'), COG_PATH = U('cognitive.mjs'), PR_PATH = U('prompt.mjs'), MS_PATH = U('milestones.mjs'), SK_PATH = U('skills.mjs'), IO_PATH = U('minecrewio.mjs')
/** The repo's withMutant (climb-escape.test.mjs): the anchor must be present AND unique, or the mutant reads as killed. */
async function withMutant (p, old, neu, fn) {
  const src = fs.readFileSync(p, 'utf8')
  assert.ok(src.includes(old), `ANCHOR MISSING OR NOT UNIQUE: ${JSON.stringify(old.slice(0, 70))} is not in ${p.pathname}`)
  assert.ok(src.split(old).length === 2, `ANCHOR MISSING OR NOT UNIQUE: ${JSON.stringify(old.slice(0, 70))} is in ${p.pathname} more than once`)
  const out = new URL(`./_mutant-crew-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  fs.writeFileSync(out, src.replace(old, neu).replace(/from '\.\//g, "from '../src/"))
  try { return await fn(await import(out.href)) } finally { try { fs.unlinkSync(out) } catch {} }
}
/** Comments out (they quote the code here): whole-line `//`, a trailing `   // ...`, and block comments that begin a line. */
function strip (src) {
  const out = []
  let block = false
  for (const l of src.split('\n')) {
    const t = l.trim()
    if (block) { if (t.includes('*/')) block = false; continue }
    if (t.startsWith('/*')) { if (!t.includes('*/')) block = true; continue }
    if (t.startsWith('//')) continue
    out.push(l.replace(/\s{2,}\/\/ .*$/, ''))
  }
  return out.join('\n')
}
const sleep = ms => new Promise(r => setTimeout(r, ms))
const LINE = 55   // HOME_Y 70 - 15

// ================================================================= the switch, the size, the line
test('SWITCH: on unless MINECREW says off|0|false|no', () => {
  assert.equal(MC.mineCrewOn({}), true)
  for (const v of ['off', '0', 'false', 'no', 'OFF', ' off ']) assert.equal(MC.mineCrewOn({ MINECREW: v }), false, v)
  for (const v of ['on', '1', 'yes', 'junk']) assert.equal(MC.mineCrewOn({ MINECREW: v }), true, v)
  assert.equal(MC.MINECREW.on, true, 'this file runs with the crew on')
})
test('CREW SIZE: default 2; an integer is clamped to 1..3 and the clamp is told; junk is 2; the hard ceiling is 3', () => {
  assert.deepEqual(MC.crewMaxOf({}), { max: 2, clamped: false, raw: null })
  assert.deepEqual(MC.crewMaxOf({ MINECREW_MAX: '1' }), { max: 1, clamped: false, raw: '1' })
  assert.deepEqual(MC.crewMaxOf({ MINECREW_MAX: '3' }), { max: 3, clamped: false, raw: '3' })
  assert.deepEqual(MC.crewMaxOf({ MINECREW_MAX: '14' }), { max: 3, clamped: true, raw: '14' })
  assert.deepEqual(MC.crewMaxOf({ MINECREW_MAX: '0' }), { max: 1, clamped: true, raw: '0' })
  assert.deepEqual(MC.crewMaxOf({ MINECREW_MAX: 'lots' }), { max: 2, clamped: true, raw: 'lots' })
  assert.equal(MC.CREW_HARD_MAX, 3); assert.equal(MC.CREW.runSlot, 3)
  assert.match(MC.crewModeDetail({ on: true, max: 3, clamped: true, raw: '14' }, 55), /on=1 max=3 hard_max=3 clamped=1 raw=14 line_y=55 .*iron=24\/48 coal=32\/64/)
  assert.equal(MC.CREW_UP_DY, GKM.GK_FIT.surfaceDy, 'the way-up line IS the grounds\' own line: between two lines a bot would get neither work nor a way up')
  assert.equal(MC.crewUpLineOf(70), 62)
})
test('CREW SIZE MUTANT KILLED: without the ceiling MINECREW_MAX=14 would be 14 mining slots', async () => {
  await withMutant(MC_PATH, 'const max = Math.min(CREW_HARD_MAX, Math.max(1, n))', 'const max = Math.max(1, n)', async M => {
    assert.equal(M.crewMaxOf({ MINECREW_MAX: '14' }).max, 14)
  })
})
test('THE LINE: HOME_Y - 15 in any world; MINECREW_Y overrides', () => {
  assert.equal(MC.crewLineOf(70, {}), 55); assert.equal(MC.crewLineOf(96, {}), 81); assert.equal(MC.crewLineOf(70, { MINECREW_Y: '40' }), 40)
  assert.equal(MC.crewLineOf(70, { MINECREW_Y: 'x' }), 55)
})

// ================================================================= the need
const entries = o => ({ a: { obs: { at: Date.now(), names: Object.fromEntries(Object.entries(o).map(([k, v]) => [k, [v, 1]])) } }, b: { obs: { at: Date.now(), names: {} } }, c: {} })
test('STOCK: the index is folded per material (blocks count 9); an entry never observed is no container; no index is not ok', () => {
  const s = MC.crewStock(entries({ iron_ingot: 10, raw_iron: 5, iron_block: 1, coal: 40, coal_block: 2, charcoal: 500, obsidian: 3, cobblestone: 900 }))
  assert.deepEqual(s, { ok: true, containers: 2, have: { iron: 24, coal: 58 }, obsidian: 3, stale: 0 })
  assert.equal(MC.crewStock(null).ok, false); assert.equal(MC.crewStock({}).containers, 0); assert.equal(MC.crewStock({}).obsidian, null)
})
const stock = (iron, coal, containers = 3) => ({ ok: true, containers, have: { iron, coal }, obsidian: 0 })
test('NEED: per material -- short below its floor, stocked at its ceiling, the last answer between; a surplus of everything is closed', () => {
  const sur = MC.mineNeed({ stock: stock(200, 300), lacking: 3 })
  assert.deepEqual([sur.open, sur.short, sur.why], [false, [], { iron: 'stocked', coal: 'stocked' }])
  const low = MC.mineNeed({ stock: stock(23, 31), lacking: 1 })
  assert.deepEqual([low.open, low.short, low.why], [true, ['iron', 'coal'], { iron: 'low', coal: 'low' }])
  assert.deepEqual(MC.mineNeed({ stock: stock(24, 32), lacking: 1 }).short, [], 'at the floor with nothing open before: stocked')
  assert.deepEqual(MC.mineNeed({ stock: stock(30, 40), lacking: 1, was: low.stockOpen }).short, ['iron', 'coal'], 'between floor and ceiling the open answer stands (no flapping)')
  assert.deepEqual(MC.mineNeed({ stock: stock(48, 64), lacking: 1, was: low.stockOpen }).short, [], 'the ceiling closes it')
  assert.deepEqual(MC.mineNeed({ stock: stock(10, 100), lacking: 1 }).short, ['iron'], 'only the material that is short')
})
test('NEED: iron also needs a bot that lacks an iron pickaxe (the census); coal does not; the stock\'s own answer is remembered through it', () => {
  const n = MC.mineNeed({ stock: stock(5, 5), lacking: 0 })
  assert.deepEqual([n.short, n.why.iron, n.stockOpen.iron], [['coal'], 'no_one_lacks', true])
  assert.equal(MC.mineNeed({ stock: stock(5, 100), lacking: null }).why.iron, 'census_unread')
  assert.deepEqual(MC.mineNeed({ stock: stock(30, 100), lacking: 1, was: n.stockOpen }).short, ['iron'], 'a bot begins to lack one while the stock is still refilling: open')
})
test('NEED: an unread index keeps the last answer (closed at first); a town with no container opens iron only', () => {
  assert.equal(MC.mineNeed({ stock: { ok: false }, lacking: 2 }).open, false)
  assert.deepEqual(MC.mineNeed({ stock: { ok: false }, lacking: 2, was: { iron: true } }).short, ['iron'])
  const nt = MC.mineNeed({ stock: stock(0, 0, 0), lacking: 1 })
  assert.deepEqual([nt.short, nt.why], [['iron'], { iron: 'no_town_stock', coal: 'no_container' }])
})
test('NEED: the numbers are the neighbours\' -- coal\'s floor is the coal run\'s, iron\'s floor is above the kit reserve plus one kit', () => {
  assert.equal(MC.MATERIALS.coal.floor, COAL_FLOOR)
  assert.ok(MC.MATERIALS.iron.floor > TK.TOWN_IRON_RESERVE + TK.kitMaxIngots(true) - 1 && MC.MATERIALS.iron.floor <= TK.TOWN_IRON_RESERVE + TK.kitMaxIngots(true) + 1)
  assert.equal(MC.MATERIALS.iron.ceil, MC.MATERIALS.iron.floor + DM.IRON_GOAL)
  assert.ok(!('charcoal' in MC.MATERIALS.coal.names), 'charcoal is not the town job\'s fuel')
})
test('NEED MUTANTS KILLED: no census clause -> 22 pickaxes in the bags do not count; no hysteresis -> it flaps; no ceiling test -> never closes', async () => {
  await withMutant(MC_PATH, "    if (open && def.census && !(Number(lacking) >= 1)) { open = false; why[m] = lacking == null ? 'census_unread' : 'no_one_lacks' }\n", '', async M => {
    assert.deepEqual(M.mineNeed({ stock: stock(5, 100), lacking: 0 }).short, ['iron'])
  })
  await withMutant(MC_PATH, "      else { open = was?.[m] === true; why[m] = open ? 'refilling' : 'stocked' }", "      else { open = false; why[m] = 'stocked' }", async M => {
    assert.deepEqual(M.mineNeed({ stock: stock(30, 100), lacking: 1, was: { iron: true } }).short, [])
  })
  await withMutant(MC_PATH, "      if (have >= def.ceil) { open = false; why[m] = 'stocked' }\n      else if", '      if', async M => {
    assert.deepEqual(M.mineNeed({ stock: stock(500, 500), lacking: 1, was: { iron: true, coal: true } }).short, ['iron', 'coal'])
  })
})
test('CENSUS: fresh files of OTHER bots that lack a pickaxe, plus this bot\'s own bag; stale, future and own files are not counted', () => {
  const now = 1_000_000_000
  const files = [{ holder: 'A', at: now - 60_000, ironPick: 0 }, { holder: 'B', at: now - 60_000, ironPick: 1 }, { holder: 'C', at: now - 31 * 60_000, ironPick: 0 },
    { holder: 'D', at: now + 10 * 60_000, ironPick: 0 }, { holder: 'me', at: now, ironPick: 0 }]
  assert.equal(MC.censusLacking(files, { me: 'me', ownLacks: false, now }), 1)
  assert.equal(MC.censusLacking(files, { me: 'me', ownLacks: true, now }), 2)
  assert.equal(MC.censusLacking([], { me: 'me', ownLacks: false, now }), 0)
})

// ================================================================= what is limited
test('KIND: `mine` is limited by where the descent ENDS -- below the line; a descent from a height to the surface is free', () => {
  assert.deepEqual(MC.crewKind('mine', { y: 16 }, { y: 70, lineY: LINE }), { kind: 'mine', material: null, target: 16, line: LINE })
  assert.equal(MC.crewKind('mine', { y: 70 }, { y: 200, lineY: LINE }), null, 'a bot stranded high mines down to the ground')
  assert.equal(MC.crewKind('mine', { y: 55 }, { y: 90, lineY: LINE }), null, 'at the line is not below it')
  assert.equal(MC.crewKind('mine', { y: 54 }, { y: 90, lineY: LINE }).target, 54)
  assert.equal(MC.crewKind('mine', {}, { y: 70, lineY: LINE }).target, 12, 'the skill\'s own default')
  assert.equal(MC.crewKind('mine', { y: 0 }, { y: 70, lineY: LINE }).target, 12, 'the skill reads y=0 as its default (Number(y) || 12)')
  assert.equal(MC.crewKind('mine', { y: 60 }, { y: 40, lineY: LINE }).target, 39, 'clamped under the bot: already below the line, any descent is')
  assert.equal(MC.crewKind('mine', { y: -200 }, { y: 70, lineY: LINE }).target, -59)
})
test('KIND: only an ORE gather is limited -- never stone, dirt, logs, sand; an order\'s ore gather is a material run', () => {
  for (const b of ['iron_ore', 'deepslate_iron_ore', 'coal_ore', 'copper_ore', 'deepslate_diamond_ore', 'nether_gold_ore', 'ancient_debris']) assert.equal(MC.crewKind('gather', { block: b }, { lineY: LINE }).kind, 'ore', b)
  for (const b of ['stone', 'cobblestone', 'deepslate', 'dirt', 'grass_block', 'oak_log', 'sand', 'gravel', 'raw_iron_block']) assert.equal(MC.crewKind('gather', { block: b }, { lineY: LINE }), null, b)
  assert.deepEqual(MC.crewKind('gather', { block: 'deepslate_coal_ore', coalrun: true }, { lineY: LINE, fromOrder: true }), { kind: 'run', material: 'coal', block: 'deepslate_coal_ore' })
  for (const s of ['explore', 'surface', 'home', 'goto', 'deposit', 'craft', 'deep_mine', 'build_shop', 'crew_up']) assert.equal(MC.crewKind(s, { y: 1, block: 'iron_ore' }, { y: 70, lineY: LINE }), null, s)
  assert.deepEqual(['iron_ore', 'deepslate_iron_ore', 'coal_ore', 'nether_quartz_ore', 'ancient_debris', 'stone'].map(MC.oreMaterial), ['iron', 'iron', 'coal', 'quartz', 'netherite', null])
})
test('KIND: the ore test is the one gather itself tunnels by (skills.mjs WORTH_TUNNELLING: a structural pin)', () => {
  const src = strip(fs.readFileSync(SK_PATH, 'utf8'))
  assert.ok(src.includes('const WORTH_TUNNELLING = /(_ore|^ancient_debris$)/'), 'skills.mjs WORTH_TUNNELLING changed: minecrew.mjs isOreBlock must follow it')
  assert.ok(strip(fs.readFileSync(MC_PATH, 'utf8')).includes('export const isOreBlock = name => /(_ore|^ancient_debris$)/.test('))
})
test('KIND MUTANTS KILLED: without the line test a stranded bot\'s descent is the crew\'s; without the clamp a bot below the line "mines to y=60"', async () => {
  await withMutant(MC_PATH, "return target < line ? { kind: 'mine', material: null, target, line } : null", "return { kind: 'mine', material: null, target, line }", async M => {
    assert.equal(M.crewKind('mine', { y: 70 }, { y: 200, lineY: LINE })?.kind, 'mine')
  })
  await withMutant(MC_PATH, '    if (Number.isFinite(y)) target = Math.min(target, Math.floor(y) - 1)\n', '', async M => {
    assert.equal(M.crewKind('mine', { y: 60 }, { y: 40, lineY: LINE }), null)
  })
})
const open = (...short) => ({ open: short.length > 0, short })
test('GATE: closed need refuses; an open one grants a non-holder, renews a holder, and names the material', () => {
  const mine = { kind: 'mine', material: null, target: 16 }, iron = { kind: 'ore', material: 'iron' }, copper = { kind: 'ore', material: 'copper' }
  assert.deepEqual(MC.crewGate({ on: true, kind: mine, need: open() }), { ok: false, why: 'no_need' })
  assert.deepEqual(MC.crewGate({ on: true, kind: iron, need: open() }), { ok: false, why: 'no_need' })
  assert.deepEqual(MC.crewGate({ on: true, kind: mine, need: open('coal') }), { ok: true, take: 'mining', for: 'coal' })
  assert.deepEqual(MC.crewGate({ on: true, kind: iron, need: open('iron', 'coal') }), { ok: true, take: 'mining', for: 'iron' })
  assert.deepEqual(MC.crewGate({ on: true, kind: iron, need: open('coal') }), { ok: false, why: 'not_short' }, 'a holder mines FOR the short material')
  assert.deepEqual(MC.crewGate({ on: true, kind: copper, need: open('iron'), hold: { since: 1000, for: 'iron' }, now: 2000 }), { ok: false, why: 'not_short' })
  // (review r1 B4) a holder mines FOR its turn's material: iron is short too, but this turn is coal's
  assert.deepEqual(MC.crewGate({ on: true, kind: iron, need: open('iron', 'coal'), hold: { since: 1000, for: 'coal' }, now: 2000 }), { ok: false, why: 'not_yours' })
  assert.deepEqual(MC.crewGate({ on: true, kind: iron, need: open('iron', 'coal'), hold: { since: 1000, for: 'build' }, now: 2000 }).ok, true, 'a turn that names no material (a deep trip\'s) follows the need')
  assert.deepEqual(MC.crewGate({ on: true, kind: mine, need: open('iron', 'coal'), hold: { since: 1000, for: 'coal' }, now: 2000 }), { ok: true, take: 'renew', for: 'coal' })
  assert.deepEqual(MC.crewGate({ on: true, kind: iron, need: open('iron'), hold: { since: 1000, for: 'iron' }, now: 2000 }), { ok: true, take: 'renew', for: 'iron' })
  assert.deepEqual(MC.crewGate({ on: true, kind: mine, need: open('iron'), restUntil: 5000, now: 2000 }), { ok: false, why: 'resting' })
  assert.deepEqual(MC.crewGate({ on: true, kind: mine, need: open('iron'), hold: { since: 0, for: 'iron' }, now: MC.CREW.termMs }), { ok: false, why: 'turn_over' }, 'a turn that began at 0 is 40 min old at 40 min')
  assert.deepEqual(MC.crewGate({ on: true, kind: mine, need: open('iron'), hold: { since: 0, for: 'iron' }, now: MC.CREW.termMs - 1 }).ok, true)
  assert.deepEqual(MC.crewGate({ on: true, kind: null, need: open() }), { ok: true, take: null, for: null }, 'not limited: nothing asked')
  assert.deepEqual(MC.crewGate({ on: false, kind: mine, need: open() }), { ok: true, take: null, for: null }, 'the switch')
})
test('GATE: a build\'s material run takes the run slot only when its ore lies below the line', () => {
  const run = { kind: 'run', material: 'coal', block: 'coal_ore' }
  assert.deepEqual(MC.crewGate({ on: true, kind: run, need: open(), oreBelow: true }), { ok: true, take: 'run', for: 'run' }, 'whatever the need: the run has its own')
  assert.deepEqual(MC.crewGate({ on: true, kind: run, need: open(), oreBelow: false }), { ok: true, take: null, for: null })
  assert.deepEqual(MC.crewGate({ on: true, kind: run, need: open(), oreBelow: null }), { ok: true, take: null, for: null })
})
test('GATE MUTANTS KILLED: the material test, the term, the rest', async () => {
  await withMutant(MC_PATH, "  if (kind.kind === 'ore' && !short.includes(kind.material)) return no('not_short')\n", '', async M => {
    assert.equal(M.crewGate({ on: true, kind: { kind: 'ore', material: 'copper' }, need: open('iron') }).ok, true)
  })
  await withMutant(MC_PATH, "  if (hold && now - since >= T.termMs) return no('turn_over')\n", '', async M => {
    assert.equal(M.crewGate({ on: true, kind: { kind: 'mine' }, need: open('iron'), hold: { since: 1, for: 'iron' }, now: 10 * MC.CREW.termMs }).ok, true)
  })
  await withMutant(MC_PATH, "  if (now < (Number(restUntil) || 0)) return no('resting')\n", '', async M => {
    assert.equal(M.crewGate({ on: true, kind: { kind: 'mine' }, need: open('iron'), restUntil: 5000, now: 2000 }).ok, true)
  })
  await withMutant(MC_PATH, "  if (hold && kind.kind === 'ore' && MATERIALS[hold.for] && kind.material !== hold.for) return no('not_yours')\n", '', async M => {
    assert.equal(M.crewGate({ on: true, kind: { kind: 'ore', material: 'iron' }, need: open('iron', 'coal'), hold: { since: 1000, for: 'coal' }, now: 2000 }).ok, true)
  })
})
test('REFUSAL: every reason names a remedy the bot can perform from where it is -- the way up below the line, the town\'s work above it', () => {
  for (const why of ['no_need', 'not_short', 'crew_full', 'resting', 'turn_over', 'run_busy']) {
    const below = MC.crewRefusal({ why, kind: { material: 'copper' }, need: open('iron'), held: 2, max: 2, below: true, restUntil: 600_000, now: 0 })
    const above = MC.crewRefusal({ why, kind: { material: 'copper' }, need: open('iron'), held: 2, max: 2, below: false, restUntil: 600_000, now: 0 })
    assert.match(below, /run surface/, why); assert.match(above, /home, deposit/, why); assert.ok(below.length <= 300 && above.length <= 300)
    assert.doesNotMatch(above, /run surface/, 'a bot at the surface is not told to climb')
  }
  assert.match(MC.crewRefusal({ why: 'crew_full', held: 2, max: 2 }), /full \(2 of 2\)/)
  assert.match(MC.crewRefusal({ why: 'not_short', kind: { material: 'copper' }, need: open('iron') }), /not short of copper \(it is short of iron\)/)
  assert.match(MC.crewRefusal({ why: 'resting', restUntil: 600_000, now: 0 }), /rest 10 more min/)
  // (review r1 B4) A HOLDER IS NEVER TOLD TO LEAVE: it is told what its turn is for, below the line too
  for (const why of ['not_short', 'not_yours', 'no_need']) {
    const h = MC.crewRefusal({ why, kind: { material: 'iron' }, need: open('coal'), hold: { for: 'coal' }, below: true })
    assert.match(h, /Your turn is for coal: gather coal_ore, or mine deeper for it\.$/, why); assert.doesNotMatch(h, /Come up|run surface|home/, why)
  }
  assert.match(MC.crewRefusal({ why: 'not_yours', kind: { material: 'iron' }, need: open('coal', 'iron'), hold: { for: 'coal' } }), /your turn is not for iron/)
  assert.match(MC.crewRefusal({ why: 'turn_over', hold: null, below: true }), /Come up: run surface/, 'a turn that is over is no turn: the way up')
})
test('DEEP TRIPS: an iron trip needs a short material; the town mine\'s build trip and an obsidian trip go on with the need closed; a diamond trip does not', () => {
  const g = o => MC.deepTripGate({ on: true, need: open(), ...o })
  assert.deepEqual(g({ target: 'iron' }), { ok: false, for: null, why: 'no_need' })
  assert.deepEqual(g({ target: 'iron', need: open('coal') }), { ok: true, for: 'coal', why: 'need' })
  assert.deepEqual(g({ target: 'iron', need: open('iron', 'coal') }), { ok: true, for: 'iron', why: 'need' })
  assert.deepEqual(g({ target: 'build' }), { ok: true, for: 'build', why: 'build' })
  assert.deepEqual(g({ target: 'diamond' }), { ok: false, for: null, why: 'no_need' })
  assert.deepEqual(g({ target: 'diamond', need: open('iron') }), { ok: false, for: null, why: 'no_need' }, 'no need names diamonds')
  assert.deepEqual(g({ target: 'diamond', obsWant: 4 }), { ok: true, for: 'obsidian', why: 'obsidian' })
  assert.deepEqual(g({ target: null }), { ok: false, for: null, why: 'no_target' })
  assert.deepEqual(MC.deepTripGate({ on: false, target: 'iron', need: open() }), { ok: true, for: null, why: 'off' })
})
test('DEEP TRIPS: a second builder (the build lease is another\'s) makes an ORE trip inside the skill -- judged as that trip', async () => {
  const g = o => MC.deepTripGate({ on: true, need: open(), target: 'build', buildBusy: true, ...o })
  assert.equal(g({ oreTarget: 'iron' }).ok, false); assert.equal(g({ oreTarget: 'diamond' }).ok, false); assert.equal(g({ oreTarget: null }).why, 'no_target')
  assert.equal(g({ oreTarget: 'iron', need: open('iron') }).for, 'iron'); assert.equal(g({ oreTarget: 'diamond', obsWant: 2 }).for, 'obsidian')
  assert.equal(g({ buildBusy: false }).for, 'build', 'the positive control: the first builder builds')
  await withMutant(MC_PATH, "  if (t === 'build' && buildBusy) t = oreTarget\n", '', async M => {
    assert.equal(M.deepTripGate({ on: true, need: open(), target: 'build', buildBusy: true, oreTarget: 'iron' }).ok, true, 'the mutant lets the ore trip through as a build')
  })
})
test('DEEP TRIPS: the wiring -- a new trip passes #crewDeepStart, an open one renews, and the skill\'s own second-builder rule is still there', () => {
  const cog = strip(fs.readFileSync(COG_PATH, 'utf8'))
  assert.ok(cog.includes('if (r.order) order = this.#crewDeepStart(r.order)'))
  assert.ok(cog.includes("if (order?.skill === 'deep_mine' && this.bot?.deepTrip) this.#crewDeepRenew()"))
  assert.ok(cog.includes('const r = io.takeMining(me, MINECREW.max, meta, { now })'), 'a deep trip takes one of the SAME mining slots')
  const sk = strip(fs.readFileSync(SK_PATH, 'utf8'))
  assert.ok(sk.includes('if (!build.ok) { build = null; target = deepTripTarget(kit, null) }'), 'skills.mjs deepMine no longer turns a second builder into an ore trip: deepTripGate buildBusy must follow')
  assert.equal(DM.obsidianWant({ on: true, target: 'diamond', kit: { obsidian: 0, pickUses: 100, buckets: 1, seal: 20 }, town: 0 }).want, DM.OBS_GOAL, 'the sub-goal reading the gate uses')
})

// ================================================================= the steer
const steer = o => MC.crewSteer({ on: true, y: 70, lineY: LINE, roofed: false, distHome: 10, now: 1_000_000, state: {}, grounds: () => ({ ok: true, why: null }), ...o })
test('STEER S1: under rock below the line -> the way up: crew_up (the stair, never a dig) inside the town, surface outside it', () => {
  const a = steer({ y: 16, roofed: true, distHome: 14 })
  assert.deepEqual([a.kind, a.order.skill, a.order.args, a.why], ['up', 'crew_up', {}, 'idle'])
  assert.equal(steer({ y: 16, roofed: true, distHome: 48 }).order.skill, 'crew_up'); assert.equal(steer({ y: 16, roofed: true, distHome: 49 }).order.skill, 'surface')
  assert.equal(steer({ y: 16, roofed: true, distHome: 300 }).order.skill, 'surface', 'far away and under rock: up first, home after')
  assert.equal(steer({ y: 16, roofed: true, distHome: 14, stair: false }).order.skill, 'surface', 'a town with NO stair has only the climb: never an order that cannot move the bot')
  assert.equal(steer({ y: 54.9, roofed: true }).kind, 'up'); assert.notEqual(steer({ y: 55, roofed: true }).kind, 'up')
  assert.notEqual(steer({ y: 40, roofed: false }).kind, 'up', 'open water or a ravine below the line is terrain, not underground')
  assert.notEqual(steer({ y: 40, roofed: null }).kind, 'up', 'an unread column is never "underground"')
})
test('STEER B2 (review r1), THE BAND between the grounds\' line (home - 8) and the crew\'s (home - 15): under rock there the grounds answer `underground` and the build order skips the bot -- it is sent up as below the crew\'s line', async () => {
  const under = () => ({ ok: false, why: 'underground' })
  for (const y of [61, 58, 55, 54, 16]) {
    const d = steer({ y, lineY: LINE, upLineY: 62, roofed: true, grounds: under })
    assert.deepEqual([d.kind, d.order?.skill], ['up', 'crew_up'], `feet y=${y}`)
  }
  assert.equal(steer({ y: 62, lineY: LINE, upLineY: 62, roofed: true }).kind, 'grounds', 'at the grounds\' line the grounds take the bot')
  // under no roof (low open ground, a pit, a river bed) there is no "up": home is on the town's ground, a walk away
  const low = steer({ y: 58, lineY: LINE, upLineY: 62, roofed: false, distHome: 40, grounds: under })
  assert.deepEqual([low.kind, low.order.skill, low.why, low.state.homeAt], ['home', 'home', 'low', 1_000_000])
  assert.equal(steer({ y: 58, lineY: LINE, upLineY: 62, roofed: false, distHome: 40, grounds: under, state: low.state, now: 1_000_000 + MC.CREW.idleMs }).why, 'underground', 'once per home rhythm')
  assert.equal(steer({ y: 58, lineY: LINE, upLineY: 62, roofed: false, distHome: 10, grounds: under }).why, 'underground', 'already at home: nothing to walk to')
  assert.equal(steer({ y: 58, lineY: LINE, upLineY: 62, roofed: false, distHome: 40, grounds: () => ({ ok: false, why: 'full' }) }).why, 'full', 'the positive control: another answer of the grounds orders nothing')
  await withMutant(MC_PATH, '  if (y < upLineY && roofed === true) {', '  if (y < lineY && roofed === true) {', async M => {
    assert.equal(M.crewSteer({ on: true, y: 58, lineY: LINE, upLineY: 62, roofed: true, distHome: 10, now: 5, state: {}, grounds: under }).kind, 'none', 'the mutant leaves the band with no order')
  })
  await withMutant(MC_PATH, "  if (g?.ok !== true && g?.why === 'underground' && distHome > T.lowR &&", "  if (false && g?.why === 'underground' && distHome > T.lowR &&", async M => {
    assert.equal(M.crewSteer({ on: true, y: 58, lineY: LINE, upLineY: 62, roofed: false, distHome: 40, now: 5, state: {}, grounds: under }).kind, 'none')
  })
})
test('STEER C3 (review r1): a FORCED steer (a refusal just happened) is not held by the deploy jitter; three stair tries that do not arrive owe ONE climb for that back-off', async () => {
  const j = steer({ y: 16, roofed: true, jitterMs: 60_000 })
  assert.equal(j.why, 'jitter')
  const f = steer({ y: 16, roofed: true, jitterMs: 60_000, state: j.state, now: 1_000_001, force: true })
  assert.deepEqual([f.kind, f.order.skill, f.why], ['up', 'crew_up', 'forced'], 'the jitter spreads UNFORCED first orders only')
  let s = { upNotBefore: 0 }
  for (let i = 0; i < 3; i++) s = MC.steerAfter(s, { kind: 'up', skill: 'crew_up', arrived: false, now: 1000 })
  assert.deepEqual([s.upTries, s.upBackoffUntil, s.upClimbOwed], [0, 1000 + MC.CREW.upBackoffMs, true])
  const c = steer({ y: 16, roofed: true, state: s, now: 2000 })
  assert.deepEqual([c.kind, c.order.skill, c.why, c.climb, c.state.upClimbOwed], ['up', 'surface', 'climb', true, false], 'inside the back-off: the one climb it owes')
  const after = MC.steerAfter(c.state, { kind: 'up', skill: 'surface', climb: true, arrived: false, now: 3000 })
  assert.deepEqual([after.upTries, after.upBackoffUntil, after.upClimbOwed], [0, 1000 + MC.CREW.upBackoffMs, false], 'the climb is no try, and it is not owed twice')
  assert.equal(steer({ y: 16, roofed: true, state: after, now: 4000 }).why, 'up_backoff', 'then the back-off stands')
  assert.equal(MC.steerAfter(c.state, { kind: 'up', climb: true, notRun: true }).upClimbOwed, true, 'a climb that never ran is still owed')
  assert.deepEqual(MC.steerAfter(c.state, { kind: 'up', skill: 'surface', climb: true, arrived: true }).upBackoffUntil, 0, 'a climb that arrives ends the episode')
  // outside the town the order was `surface` already: three of those owe nothing more
  let o = { upNotBefore: 0 }
  for (let i = 0; i < 3; i++) o = MC.steerAfter(o, { kind: 'up', skill: 'surface', arrived: false, now: 1000 })
  assert.equal(o.upClimbOwed ?? false, false)
  assert.equal(steer({ y: 16, roofed: true, state: s, now: 2000, refuses: sk => (sk === 'surface' ? 'cooldown' : null) }).why, 'memory')
  await withMutant(MC_PATH, "    if (!force && now < s.upNotBefore) return none('jitter')\n", "    if (now < s.upNotBefore) return none('jitter')\n", async M => {
    assert.equal(M.crewSteer({ on: true, y: 16, lineY: LINE, roofed: true, distHome: 10, now: 5, state: { upNotBefore: 99999 }, force: true }).why, 'jitter')
  })
  await withMutant(MC_PATH, "if (skill === 'crew_up') s.upClimbOwed = true }", '}', async M => {
    let m = {}; for (let i = 0; i < 3; i++) m = M.steerAfter(m, { kind: 'up', skill: 'crew_up', now: 1000 })
    assert.equal(M.crewSteer({ on: true, y: 16, lineY: LINE, roofed: true, distHome: 10, now: 2000, state: m }).why, 'up_backoff', 'the mutant leaves a bot the stair does not reach under the town for the whole back-off')
  })
})
test('STEER S1: three runs that do not arrive back off 10 min; arriving clears; the first order waits the bot\'s jitter', () => {
  let s = {}
  for (let i = 0; i < 2; i++) s = MC.steerAfter(s, { kind: 'up', arrived: false, now: 1000 })
  assert.deepEqual([s.upTries, s.upBackoffUntil ?? 0], [2, 0])
  s = MC.steerAfter(s, { kind: 'up', arrived: false, now: 1000 })
  assert.deepEqual([s.upTries, s.upBackoffUntil], [0, 1000 + MC.CREW.upBackoffMs])
  assert.equal(steer({ y: 16, roofed: true, state: s, now: 2000 }).why, 'up_backoff')
  assert.equal(steer({ y: 16, roofed: true, state: s, now: 2000, force: true }).why, 'up_backoff', 'a refusal does not force past the back-off')
  assert.equal(steer({ y: 16, roofed: true, state: { ...s, upNotBefore: 0 }, now: 1000 + MC.CREW.upBackoffMs }).kind, 'up')
  assert.deepEqual(MC.steerAfter({ upTries: 2 }, { kind: 'up', arrived: true }).upTries, 0)
  assert.deepEqual(MC.steerAfter({ upTries: 2 }, { kind: 'up', notRun: true }).upTries, 2, 'a refused or declined run is not a try')
  const j = steer({ y: 16, roofed: true, jitterMs: 60_000 })
  assert.deepEqual([j.why, j.state.upNotBefore], ['jitter', 1_060_000])
  assert.equal(steer({ y: 16, roofed: true, jitterMs: 60_000, state: j.state, now: 1_060_000 }).kind, 'up')
  const T20 = { upJitterMs: 20 * 60_000 }
  const a = MC.upJitterMs('showcase-Alpha', T20), b = MC.upJitterMs('showcase-Bravo', T20)
  assert.ok(a >= 0 && a < T20.upJitterMs && b >= 0 && b < T20.upJitterMs); assert.equal(a, MC.upJitterMs('showcase-Alpha', T20)); assert.notEqual(a, b)
  assert.equal(MC.upJitterMs('showcase-Alpha'), a, 'the default is the 20 minutes')
})
test('STEER DEAD END 6 (the deploy hour: eleven bots under the town, one stair): each bot\'s FIRST way-up order waits its own share of 20 min -- the herd is spread, and every bot does get its order', () => {
  const T20 = { ...MC.CREW, upJitterMs: 20 * 60_000 }
  const names = ['Alpha', 'Bravo', 'Comet', 'Delta', 'Echo', 'Frost', 'Gale', 'Iris', 'Juno', 'Kite', 'Lumen', 'Moss', 'Nova', 'Onyx'].map(n => `showcase-${n}`)
  const t0 = 5_000_000
  const first = names.map(me => {
    const j = MC.upJitterMs(me, T20)
    const a = MC.crewSteer({ on: true, y: 16, lineY: LINE, roofed: true, distHome: 10, now: t0, state: {}, jitterMs: j, T: T20 })
    assert.equal(a.why, j > 0 ? 'jitter' : 'idle', me)
    const b = MC.crewSteer({ on: true, y: 16, lineY: LINE, roofed: true, distHome: 10, now: t0 + j, state: a.state, jitterMs: j, T: T20 })
    assert.equal(b.order?.skill, 'crew_up', `${me} is ordered up once its share has passed`)
    return j
  })
  assert.ok(new Set(first.map(j => Math.floor(j / 60_000))).size >= 8, `first orders fall in ${new Set(first.map(j => Math.floor(j / 60_000))).size} different minutes: ${first.map(j => Math.round(j / 60_000))}`)
  const sorted = [...first].sort((a, b) => a - b)
  assert.ok(sorted.filter((j, i) => i > 0 && j - sorted[i - 1] < 5_000).length <= 2, 'hardly ever two bots within 5 s of each other')
  assert.ok(Math.max(...first) < T20.upJitterMs)
})
test('STEER S2: at the surface beyond 128 blocks -> home, at most every 10 min (a refusal forces it)', () => {
  const a = steer({ distHome: 129 })
  assert.deepEqual([a.kind, a.order.skill, a.state.homeAt], ['home', 'home', 1_000_000])
  assert.equal(steer({ distHome: 129, state: a.state, now: 1_000_000 + 60_000 }).why, 'rhythm')
  assert.equal(steer({ distHome: 129, state: a.state, now: 1_000_000 + 60_000, force: true }).kind, 'home')
  assert.equal(steer({ distHome: 129, state: a.state, now: 1_000_000 + MC.CREW.homeEveryMs }).kind, 'home')
  assert.equal(steer({ distHome: 128 }).kind, 'grounds', 'within the grounds\' own reach the grounds are asked')
  assert.equal(MC.steerAfter(a.state, { kind: 'home', notRun: true }).homeAt, -Infinity, 'an order that never ran gives its rhythm back')
})
test('STEER S3: at the surface near town -> the idle grounds visit, every idleMs; the grounds\' own answer is the reason when they have nothing', () => {
  const a = steer({})
  assert.deepEqual([a.kind, a.order.skill, a.order.args, a.why, a.state.idleAt], ['grounds', 'build_shop', { grounds: true, why: 'idle' }, 'idle', 1_000_000])
  assert.equal(MC.crewIdleVisit(a.order.args, true), true)
  assert.equal(steer({ state: a.state, now: 1_000_000 + MC.CREW.idleMs - 1 }).why, 'rhythm')
  assert.equal(steer({ state: a.state, now: 1_000_000 + MC.CREW.idleMs }).kind, 'grounds')
  const f = steer({ state: a.state, now: 1_000_001, force: true })
  assert.deepEqual([f.kind, f.why], ['grounds', 'forced'], 'after a refusal the rhythm is not waited out')
  for (const why of ['full', 'spent', 'record_stuck', 'record_complete', 'underground', 'away', 'keeper', 'decor', 'off']) assert.equal(steer({ grounds: () => ({ ok: false, why }) }).why, why)
  assert.equal(steer({ grounds: () => { throw new Error('x') } }).why, 'unknown'); assert.equal(steer({ y: null }).why, 'unknown')
})
test('STEER: it stands aside for a holder, an open trip, an open prerequisite and a pending job -- at every rung', () => {
  for (const pos of [{ y: 16, roofed: true }, { distHome: 400 }, {}]) {
    for (const [k, why] of [['holds', 'crew'], ['tripOpen', 'trip'], ['prereqOpen', 'prereq'], ['jobOpen', 'job']]) {
      const d = steer({ ...pos, [k]: true })
      assert.deepEqual([d.order, d.kind, d.why], [null, 'none', why], `${k} at ${JSON.stringify(pos)}`)
    }
    assert.notEqual(steer(pos).order, null, 'the positive control: the same bot with none of them is given an order')
  }
  assert.equal(steer({ on: false }).why, 'off')
})
test('STEER AND AN OFFER: while a turn is free the steer leaves ONE decision per idleMs to the model (else no bot it keeps busy could ever take the turn)', async () => {
  const a = steer({ offer: true })
  assert.deepEqual([a.order, a.why, a.state.offerAskAt], [null, 'offer', 1_000_000])
  const b = steer({ offer: true, state: a.state, now: 1_000_001 })
  assert.equal(b.kind, 'grounds', 'the next tick is the steer\'s again')
  assert.equal(steer({ offer: true, state: b.state, now: 1_000_000 + MC.CREW.idleMs }).why, 'offer', 'and one more decision a rhythm later')
  assert.equal(steer({ offer: true, y: 16, roofed: true }).why, 'offer', 'under rock too: the model may take the turn where it stands')
  assert.equal(steer({ offer: true, force: true }).kind, 'grounds', 'a refusal\'s forced steer is not held up by it')
  assert.equal(steer({ offer: false }).kind, 'grounds', 'the positive control: no offer, no yielded decision')
  await withMutant(MC_PATH, "  if (offer && !force && now - (Number.isFinite(s.offerAskAt) ? s.offerAskAt : -Infinity) >= T.idleMs) { s.offerAskAt = now; return none('offer') }\n", '', async M => {
    assert.equal(M.crewSteer({ on: true, offer: true, y: 70, lineY: LINE, roofed: false, distHome: 10, now: 5, state: {}, grounds: () => ({ ok: true }) }).kind, 'grounds', 'the mutant never lets the model see the offer')
  })
})
test('STEER: an order the gate\'s memory would refuse (cooldown, learned failures, a full repeat window) is not issued', () => {
  const refuses = sk => (sk === 'crew_up' || sk === 'home' || sk === 'build_shop' ? 'cooldown' : null)
  assert.equal(steer({ y: 16, roofed: true, refuses }).why, 'memory'); assert.equal(steer({ distHome: 400, refuses }).why, 'memory'); assert.equal(steer({ refuses }).why, 'memory')
  assert.equal(steer({ y: 16, roofed: true, distHome: 60, refuses }).order.skill, 'surface', 'another skill\'s memory does not hold this one')
  assert.equal(steer({ refuses: () => { throw new Error('x') } }).why, 'memory', 'a read that throws issues nothing')
})
test('STEER: idle visits that fix nothing -- AN ABORTED ONE TOO -- back off 10, 20, 40 min; one that worked clears it', () => {
  let s = { idleAt: 0 }
  s = MC.steerAfter(s, { kind: 'grounds', worked: false, now: 1000 })
  assert.deepEqual([s.idleN, s.idleBackoffUntil ?? 0], [1, 0], 'one empty visit is not a pattern')
  s = MC.steerAfter(s, { kind: 'grounds', worked: false, now: 1000 }); assert.equal(s.idleBackoffUntil, 1000 + 10 * 60_000)
  assert.equal(steer({ state: s, now: 2000 }).why, 'backoff'); assert.equal(steer({ state: s, now: 2000, force: true }).why, 'backoff')
  s = MC.steerAfter(s, { kind: 'grounds', worked: false, now: 1000 }); assert.equal(s.idleBackoffUntil, 1000 + 20 * 60_000)
  s = MC.steerAfter(s, { kind: 'grounds', worked: false, now: 1000 }); assert.equal(s.idleBackoffUntil, 1000 + 40 * 60_000)
  s = MC.steerAfter(s, { kind: 'grounds', worked: false, now: 1000 }); assert.equal(s.idleBackoffUntil, 1000 + 40 * 60_000, 'capped')
  s = MC.steerAfter(s, { kind: 'grounds', worked: true, now: 1000 }); assert.deepEqual([s.idleN, s.idleBackoffUntil], [0, 0])
  assert.equal(MC.steerAfter({ idleAt: 5, idleN: 1 }, { kind: 'grounds', notRun: true }).idleN, 1, 'a visit that never ran counts for nothing')
  assert.equal(MC.steerAfter({ idleAt: 5 }, { kind: 'grounds', notRun: true }).idleAt, -Infinity)
})
test('STEER MUTANTS KILLED: the prerequisite, the roof, the back-off, the memory, the 128-block rule', async () => {
  await withMutant(MC_PATH, "  if (prereqOpen) return none('prereq')\n", '', async M => {
    assert.equal(M.crewSteer({ on: true, y: 16, lineY: LINE, roofed: true, distHome: 10, prereqOpen: true, now: 5, state: { upNotBefore: 0 } }).kind, 'up', 'the mutant climbs again instead of letting the scaffold be gathered')
  })
  await withMutant(MC_PATH, '  if (y < upLineY && roofed === true) {', '  if (y < upLineY) {', async M => {
    assert.equal(M.crewSteer({ on: true, y: 40, lineY: LINE, roofed: false, distHome: 10, now: 5, state: { upNotBefore: 0 } }).kind, 'up', 'the mutant sends a swimmer "up"')
  })
  await withMutant(MC_PATH, "  if (now < (Number(s.idleBackoffUntil) || 0)) return none('backoff')\n", '', async M => {
    assert.equal(M.crewSteer({ on: true, y: 70, lineY: LINE, roofed: false, distHome: 10, now: 5, state: { idleBackoffUntil: 99999 }, grounds: () => ({ ok: true }) }).kind, 'grounds')
  })
  await withMutant(MC_PATH, "  if (asked('build_shop')) return none('memory')\n", '', async M => {
    assert.equal(M.crewSteer({ on: true, y: 70, lineY: LINE, roofed: false, distHome: 10, now: 5, state: {}, refuses: () => 'repeat_loop', grounds: () => ({ ok: true }) }).kind, 'grounds')
  })
  await withMutant(MC_PATH, '    if (s.idleN >= 2) s.idleBackoffUntil', '    if (false) s.idleBackoffUntil', async M => {
    let s = {}; for (let i = 0; i < 5; i++) s = M.steerAfter(s, { kind: 'grounds', worked: false, now: 1000 })
    assert.equal(s.idleBackoffUntil ?? 0, 0, 'the mutant orders an aborting visit again every idleMs, for ever')
  })
})

// ================================================================= the view, the prompt, the rungs
const view = o => MC.crewView({ on: true, need: open(), held: 0, max: 2, readOk: true, lineY: LINE, now: 1000, ...o })
test('VIEW: closed unless it holds a turn or one is on offer (need open, a slot free, the read good, not resting)', () => {
  assert.deepEqual([view({}).closed, view({}).offer, view({}).holds], [true, false, false])
  assert.deepEqual([view({ need: open('iron') }).closed, view({ need: open('iron') }).offer], [false, true])
  assert.equal(view({ need: open('iron'), held: 2 }).closed, true, 'the crew is full')
  assert.equal(view({ need: open('iron'), readOk: false }).closed, true, 'an unread crew offers nothing')
  assert.equal(view({ need: open('iron'), restUntil: 5000 }).closed, true, 'resting')
  const h = view({ hold: { since: 1000 - 10 * 60_000, for: 'iron' }, need: open('iron'), held: 1 })
  assert.deepEqual([h.holds, h.closed, h.offer, h.minsLeft, h.for], [true, false, false, 30, 'iron'])
  // `allowed`: the ONE list the gate, the iron rung and the ores shown agree on (review r1 B4)
  assert.deepEqual(view({}).allowed, []); assert.deepEqual(view({ need: open('coal') }).allowed, ['coal']); assert.deepEqual(view({ need: open('iron', 'coal') }).allowed, ['iron', 'coal'])
  assert.deepEqual(view({ hold: { since: 900, for: 'coal' }, need: open('iron', 'coal') }).allowed, ['coal'], 'a holder: its turn\'s material')
  assert.deepEqual(view({ hold: { since: 900, for: 'iron' }, need: open('coal') }).allowed, [], 'a turn for iron while only coal is short: no ore (the tick closes it)')
  assert.deepEqual(view({ hold: { since: 900, for: 'build' }, need: open('iron') }).allowed, ['iron'], 'a turn that names no material follows the need')
  for (const [v, m, ok] of [[view({ need: open('coal') }), 'iron', false], [view({ need: open('coal') }), 'coal', true], [view({}), 'iron', false], [view({ hold: { since: 9, for: 'coal' }, need: open('iron', 'coal') }), 'iron', false]]) {
    assert.equal(MC.crewOreOpen({ mineCrewView: v }, m), ok); assert.equal(MC.crewOreHidden(v, `${m}_ore`), !ok); assert.equal(MC.crewOreHidden(v, `deepslate_${m}_ore`), !ok)
    assert.equal(MC.crewGate({ on: true, kind: { kind: 'ore', material: m }, need: { open: v.short.length > 0, short: v.short }, hold: v.holds ? { since: 1000, for: v.for } : null, now: 2000 }).ok, ok, 'the gate agrees with the view')
  }
  assert.equal(MC.crewOreOpen({}, 'iron'), true); assert.equal(MC.crewOreHidden(null, 'iron_ore'), false); assert.equal(MC.crewOreHidden(view({}), 'stone'), false, 'only an ore is ever hidden')
  assert.deepEqual(MC.crewView({ on: false }), { on: false, holds: false, offer: false, closed: false })
})
test('MINING LINE: closed says so and where the town\'s work is; an offer names the material and how to take it; a holder is told the stair', () => {
  assert.match(MC.miningLine(view({})), /^MINING: closed for you \(the town has a surplus of everything mined\)\. Do not choose mine to go underground \(below y=55\), or gather an ore; stay near home/)
  for (const v of [view({}), view({ need: open('iron'), held: 2 }), view({ need: open('iron') }), view({ hold: { since: 1000, for: 'coal' }, need: open('coal') })]) assert.doesNotMatch(MC.miningLine(v).replace('y=16', '').replace('(below y=55)', ''), /y=\d/, 'no depth is advertised but the stair\'s landing to a bot with a turn (review r1 B2)')
  assert.doesNotMatch(MC.miningLine(view({})).replace('(below y=55)', ''), /y=/, 'a bot with no turn is named the line it may not go below, and no depth to dig to')
  assert.match(MC.miningLine(view({ need: open('iron'), held: 2 })), /^MINING: closed for you \(the crew is full or you are resting; short of iron\)/)
  assert.match(MC.miningLine(view({ need: open('iron', 'coal'), held: 1 })), /^MINING: the town is short of iron and coal and a mine-crew turn is free \(1 of 2 taken\): mine with y=16, or gather iron_ore or coal_ore, takes it\.$/)
  assert.match(MC.miningLine(view({ hold: { since: 1000, for: 'coal' }, need: open('coal'), held: 1 })), /^MINING: you hold a mine-crew turn for coal \(40 min left\): mine with y=16 walks down the town stair; gather coal_ore\.$/)
  assert.match(MC.miningLine(view({ hold: { since: 1000, for: 'build' }, held: 1 })), /turn for build \(40 min left\): mine with y=16 walks down the town stair\.$/)
  assert.equal(MC.miningLine(null), ''); assert.equal(MC.miningLine({ on: false }), '')
})
const NAMES = ['gather', 'goto', 'deposit', 'withdraw', 'home', 'status', 'eat', 'craft', 'smelt', 'place', 'bucket', 'build', 'mine', 'explore', 'surface']
const OLD_RULES = ['- Iron: mine down to find iron ore, gather it (you get raw_iron), then', '  smelt item=raw_iron to get iron_ingot. 3 iron_ingot + 2 sticks ->', '  iron_pickaxe. Smelting needs a furnace (8 cobblestone) and fuel.',
  '- Iron ore is most common deep down, around y=16. If your town has a', '  mineshaft stair, mine with y=16 walks down it with no digging.'].join('\n')
test('SYSTEM PROMPT: on, the two rules that sent every bot down are gone and one static crew rule stands; everything else is byte for byte', () => {
  const on = PR.buildSystemPrompt(NAMES), off = PR.buildSystemPrompt(NAMES, { mineCrew: false })
  assert.equal(on, PR.buildSystemPrompt(NAMES, { mineCrew: true }), 'the default follows the switch')
  assert.ok(off.includes(OLD_RULES), 'off: the five old lines, contiguous and verbatim')
  assert.ok(!on.includes('mine down to find iron ore') && !on.includes('mine with y=16 walks down it'))
  const NEW = MC.CREW_RULE_LINES.join('\n')
  assert.ok(on.includes(NEW))
  // the smelt route to iron is still named (smelt-wiring.test.mjs pins it), but only for raw iron the bot CARRIES (review r1 B3)
  assert.match(on, /if you CARRY raw_iron, smelt item=raw_iron gives iron_ingot/); assert.match(on, /Never smelt a raw item you do not carry\./)
  assert.ok(!on.includes('gather it (you get raw_iron), then'), 'no "gather the ore, then smelt" chain')
  assert.equal(on.replace(NEW, '<<>>'), off.replace(OLD_RULES, '<<>>'), 'the two prompts differ in that block and nowhere else')
  assert.ok(on.includes('  mine    args: {"y": <ABSOLUTE elevation to stop at'), 'the verb keeps its usage line: a bot stranded high needs it')
  assert.ok(!/CrewBot/.test(on), 'nothing per-bot in the shared prefix')
})
const mkInv = (extra = []) => [{ name: 'stone_pickaxe', count: 1, slot: 9, type: mcData.itemsByName.stone_pickaxe.id, maxDurability: 131, durabilityUsed: 11 }, ...extra]
function fieldBot ({ at = [10, 70, 10], inv = mkInv([{ name: 'cobblestone', count: 20, slot: 10, type: mcData.itemsByName.cobblestone.id }]), roof = null, ores = [], name = 'CrewBot' } = {}) {
  const air = { name: 'air', boundingBox: 'empty' }, rock = { name: 'stone', boundingBox: 'block' }
  const bot = {
    entity: { position: new Vec3(...at), velocity: { x: 0, y: 0, z: 0 } }, health: 20, food: 20, oxygenLevel: 300,
    time: { day: 1, age: 1, timeOfDay: 1000 }, game: { dimension: 'overworld' }, serverDifficulty: 'peaceful',
    inventory: { items: () => inv }, registry: mcData, recipesFor: () => [], recipesAll: () => [],
    findBlock: ({ matching } = {}) => { const o = ores.find(q => mcData.blocksByName[q.name]?.id === matching); return o ? { name: o.name, position: new Vec3(...o.at) } : null },
    findBlocks: ({ matching } = {}) => ores.filter(q => mcData.blocksByName[q.name]?.id === matching).map(q => new Vec3(...q.at)),
    // `roof`: [y0, y1] of solid rock over every column (a bot under it is roofed); else open sky
    blockAt: p => (roof && p && p.y >= roof[0] && p.y <= roof[1] ? { ...rock, position: p } : air),
    setControlState: () => {}, clearControlStates: () => {}, players: {}, entities: {}, experience: { level: 0 }, username: name,
  }
  return bot
}
const { WorkingMemory } = PR
const userPrompt = (bot, mineCrew) => PR.buildUserPrompt({ bot, milestone: { describe: 'Stockpile 16 logs (any kind).', progress: '0/16', hint: 'gather with block=oak_log.', wants: null },
  memory: new WorkingMemory(), lastOutcome: null, trigger: 'idle', sentinel: 'END-TEST01', lessons: [], mineCrew }).user
test('USER PROMPT: a closed bot is shown the MINING line and NO ore in NEARBY or BLOCK CHECKS; a holder and an offer see them; no view: as before', () => {
  const ores = [{ name: 'iron_ore', at: [14, 70, 10] }, { name: 'coal_ore', at: [15, 70, 10] }, { name: 'stone', at: [12, 70, 10] }]
  const base = userPrompt(fieldBot({ ores }), null)
  assert.match(base, /NEARBY: .*iron_ore@/); assert.match(base, /BLOCK CHECKS[^\n]*iron_ore visible=/); assert.doesNotMatch(base, /MINING:/)
  assert.equal(userPrompt(fieldBot({ ores }), { on: false }), base, 'a view that is off changes no byte')
  const closed = userPrompt(fieldBot({ ores }), view({}))
  assert.doesNotMatch(closed, /iron_ore|coal_ore/); assert.match(closed, /NEARBY: [^\n]*stone@/, 'stone is still named: it is never refused')
  assert.match(closed, /\nMINING: closed for you /)
  const offer = userPrompt(fieldBot({ ores }), view({ need: open('iron') }))
  assert.match(offer, /NEARBY: .*iron_ore@/); assert.match(offer, /\nMINING: the town is short of iron and a mine-crew turn is free/)
  assert.doesNotMatch(offer, /coal_ore/, 'an offer for iron names no coal ore')
  // (review r1 B4) only coal is short: iron ore is named to nobody -- the gate would refuse it
  const coalOnly = userPrompt(fieldBot({ ores }), view({ need: open('coal') }))
  assert.doesNotMatch(coalOnly, /iron_ore/); assert.match(coalOnly, /NEARBY: .*coal_ore@/); assert.match(coalOnly, /BLOCK CHECKS[^\n]*coal_ore visible=/)
  const holder = userPrompt(fieldBot({ ores }), view({ hold: { since: 900, for: 'iron' }, need: open('iron'), held: 1 }))
  assert.match(holder, /NEARBY: .*iron_ore@/); assert.match(holder, /\nMINING: you hold a mine-crew turn for iron/)
})
test('USER PROMPT MUTANT KILLED: without the hide a closed bot is still shown the ore it may not gather', async () => {
  const mp = M => M.buildUserPrompt({ bot: fieldBot({ ores: [{ name: 'iron_ore', at: [14, 70, 10] }] }), milestone: { describe: 'd', progress: 'p', hint: 'h', wants: null }, memory: new M.WorkingMemory(), lastOutcome: null, trigger: 'idle', sentinel: 'END-T', lessons: [], mineCrew: view({}) }).user
  await withMutant(PR_PATH, 'const interesting = scanOrder(wants).filter(n => !crewOreHidden(mineCrew, n))', 'const interesting = scanOrder(wants)', async M => { assert.match(mp(M), /NEARBY: [^\n]*iron_ore/) })
  await withMutant(PR_PATH, '    if (crewOreHidden(mineCrew, name)) continue   // minecrew-01\n', '', async M => { assert.match(mp(M), /BLOCK CHECKS[^\n]*iron_ore/) })
})
const rung = id => MS.SUSTAINING.find(m => m.id === id)
test('RUNGS: for a closed bot the iron-ore rung, the stone stockpile and the patrol are stepped over (done, never fulfilled); for a holder, an offer and no view they stand', () => {
  const ores = [{ name: 'iron_ore', at: [14, 70, 10] }]
  const mk = v => { const b = fieldBot({ inv: mkInv(), ores }); if (v) b.mineCrewView = v; return b }
  for (const [what, v] of [['no view', null], ['off', { on: false, closed: false }], ['a holder', view({ hold: { since: 900, for: 'iron' }, need: open('iron') })], ['an offer', view({ need: open('iron') })]]) {
    assert.equal(rung('gather_iron_ore_3').done(mk(v)), false, `iron rung, ${what}: live (ore in reach, a pickaxe, no iron held)`)
    assert.equal(rung('stockpile_stone').done(mk(v), 0), false, `stone rung, ${what}`)
    assert.equal(rung('patrol').done(mk(v)), false, `patrol, ${what}`)
  }
  const closed = mk(view({}))
  for (const id of ['gather_iron_ore_3', 'stockpile_stone', 'patrol']) {
    assert.equal(rung(id).done(closed, 0), true, `${id}: stepped over`)
    assert.equal(rung(id).fulfilled(closed, 0), false, `${id}: a bypass is not a completion`)
  }
  assert.equal(rung('stockpile_wood').done(closed, 0), false, 'the positive control: a surface rung still stands for the closed bot')
  // (review r1 B4) ONLY COAL IS SHORT: the iron rung has no means for anyone -- an offer, or a coal holder -- while the stone
  // rung and the patrol stand for them (they are not closed)
  for (const v of [view({ need: open('coal') }), view({ hold: { since: 900, for: 'coal' }, need: open('iron', 'coal') })]) {
    assert.equal(rung('gather_iron_ore_3').done(mk(v)), true, 'the gate would refuse the iron ore: the rung is stepped over')
    assert.equal(rung('stockpile_stone').done(mk(v), 0), false)
  }
  assert.equal(MC.crewRungClosed({ mineCrewView: view({}) }), true); assert.equal(MC.crewRungClosed({}), false)
})
test('RUNGS MUTANTS KILLED: each of the three rungs follows the view', async () => {
  const closedBot = () => { const b = fieldBot({ inv: mkInv(), ores: [{ name: 'iron_ore', at: [14, 70, 10] }] }); b.mineCrewView = view({}); return b }
  const r = (M, id) => M.SUSTAINING.find(m => m.id === id)
  await withMutant(MS_PATH, "  }, b => crewOreOpen(b, 'iron') && ironInReach(b) && hasTripPickaxe(", '  }, b => ironInReach(b) && hasTripPickaxe(', async M => {
    assert.equal(r(M, 'gather_iron_ore_3').done(closedBot()), false, 'the mutant hands a closed bot the task "Mine iron ore"')
  })
  await withMutant(MS_PATH, "  }, b => crewOreOpen(b, 'iron') && ironInReach(b) && hasTripPickaxe(", '  }, b => !crewRungClosed(b) && ironInReach(b) && hasTripPickaxe(', async M => {
    const b = closedBot(); b.mineCrewView = view({ need: open('coal') })
    assert.equal(r(M, 'gather_iron_ore_3').done(b), false, 'the r0 rule: with only coal short the task is iron ore the gate refuses')
  })
  await withMutant(MS_PATH, "    hint: 'gather with block=stone (needs a pickaxe), or mine to reach it.',\n  }, b => !crewRungClosed(b)),", "    hint: 'gather with block=stone (needs a pickaxe), or mine to reach it.',\n  }, () => true),", async M => {
    assert.equal(r(M, 'stockpile_stone').done(closedBot(), 0), false)
  })
  await withMutant(MS_PATH, "    hint: 'goto somewhere 80+ blocks from home, staying inside the border.',\n  }, b => !crewRungClosed(b)),", "    hint: 'goto somewhere 80+ blocks from home, staying inside the border.',\n  }, () => true),", async M => {
    assert.equal(r(M, 'patrol').done(closedBot()), false)
  })
})

// ================================================================= the leases, over a real directory
let dseq = 0
const lease = () => { const dir = path.join(tmp, `crew${dseq++}`); return { dir, key: 'project-0_70_0.minecrew' } }
test('LEASES: ONE COUNT -- two mining slots, a third bot is refused; a bot\'s own slot is renewed in place; a release frees it', () => {
  const L = lease(), now = 1_000_000
  const a = IO.crewTakeMining('A', 2, { since: now, for: 'iron' }, { ...L, now }), b = IO.crewTakeMining('B', 2, { since: now, for: 'iron', deep: true }, { ...L, now })
  assert.deepEqual([a.ok, a.slot, b.ok, b.slot], [true, 1, true, 2])
  const c = IO.crewTakeMining('C', 2, null, { ...L, now })
  assert.equal(c.ok, false, 'a deep miner and a model miner are two of the SAME two slots')
  const n = IO.crewLeasesNow({ ...L, me: 'A', max: 2, now })
  assert.deepEqual([n.ok, n.mining, n.run, n.mine.slot, n.holders], [true, 2, false, 1, { slot1: 'A', slot2: 'B' }])
  assert.deepEqual(IO.crewMeta(2, L), { since: now, for: 'iron', deep: true }, 'the lease carries its term and its purpose (a restart adopts them)')
  const again = IO.crewTakeMining('A', 2, { since: now, for: 'iron' }, { ...L, now: now + 1000 })
  assert.deepEqual([again.ok, again.slot], [true, 1], 'ours already: the same slot, never a second')
  assert.equal(IO.crewLeasesNow({ ...L, me: 'C', max: 2, now: now + 1000 }).mining, 2)
  IO.crewRelease('B', { slot: b.slot, gen: b.gen }, L)
  assert.equal(IO.crewLeasesNow({ ...L, me: 'C', max: 2, now: now + 2000 }).mining, 1)
  assert.deepEqual([IO.crewTakeMining('C', 2, null, { ...L, now: now + 2000 }).slot], [2])
})
test('LEASES: a holder that dies or disconnects stops renewing -- its slot lapses at the TTL (+ the reclaim) and another bot takes it', () => {
  const L = lease(), now = 1_000_000
  IO.crewTakeMining('A', 1, null, { ...L, now })
  assert.equal(IO.crewTakeMining('B', 1, null, { ...L, now: now + MC.CREW.ttlMs - 1 }).ok, false, 'inside the TTL')
  // (review r1 B1) HELD IS WHAT A TAKE WOULD REFUSE: lapsed but inside its reclaim the slot still reads held -- never an offer
  // that every take loses
  const mid = now + MC.CREW.ttlMs + 1
  assert.equal(IO.crewLeasesNow({ ...L, me: 'B', max: 1, now: mid }).mining, 1); assert.equal(IO.crewTakeMining('B', 1, null, { ...L, now: mid }).ok, false)
  assert.equal(IO.crewLeasesNow({ ...L, me: 'A', max: 1, now: mid }).mine, null, 'its old holder no longer HOLDS it')
  const late = now + MC.CREW.ttlMs + 61_000
  assert.equal(IO.crewLeasesNow({ ...L, me: 'B', max: 1, now: late }).mining, 0, 'past the reclaim: free, and a take succeeds')
  assert.equal(IO.crewTakeMining('B', 1, null, { ...L, now: late }).ok, true)
})
test('LEASES: a renewal keeps the slot and its meta; a slot lost to another bot does not renew', () => {
  const L = lease(), now = 1_000_000
  const a = IO.crewTakeMining('A', 1, { since: now, for: 'coal' }, { ...L, now })
  const g = IO.crewRenew('A', { slot: 1, gen: a.gen, meta: { since: now, for: 'coal' } }, { ...L, now: now + 60_000 })
  assert.ok(Number.isInteger(g) && g > a.gen); assert.deepEqual(IO.crewMeta(1, L), { since: now, for: 'coal' })
  assert.equal(IO.crewTakeMining('B', 1, null, { ...L, now: now + 60_000 + MC.CREW.ttlMs - 1 }).ok, false, 'the renewal moved the TTL on')
  assert.equal(IO.crewRenew('A', { slot: 1, gen: a.gen }, { ...L, now: now + 61_000 }), null, 'a stale generation is not ours to renew')
  assert.equal(IO.crewRenew('B', { slot: 1, gen: g }, { ...L, now: now + 61_000 }), null)
})
test('LEASES: the material run has slot 3 alone; with MINECREW_MAX=3 the miners may hold it too -- never a fourth body', () => {
  const L = lease(), now = 1_000_000
  IO.crewTakeMining('A', 2, null, { ...L, now }); IO.crewTakeMining('B', 2, null, { ...L, now })
  const r = IO.crewTakeRun('R', { run: true }, { ...L, now })
  assert.deepEqual([r.ok, r.slot], [true, 3])
  assert.equal(IO.crewTakeRun('S', null, { ...L, now }).ok, false, 'one run below ground at a time')
  const n = IO.crewLeasesNow({ ...L, me: 'x', max: 2, now })
  assert.deepEqual([n.mining, n.run, Object.keys(n.holders).length], [2, true, 3])
  IO.crewRelease('R', { slot: 3, gen: r.gen }, L)
  assert.equal(IO.crewLeasesNow({ ...L, me: 'x', max: 2, now: now + 1 }).run, false)
  const M = lease()
  for (const b of ['A', 'B', 'C']) assert.equal(IO.crewTakeMining(b, 3, null, { ...M, now }).ok, true)
  assert.equal(IO.crewTakeMining('D', 3, null, { ...M, now }).ok, false)
  assert.equal(IO.crewTakeRun('R', null, { ...M, now }).ok, false, 'three miners: the run waits')
  assert.equal(Object.keys(IO.crewLeasesNow({ ...M, me: 'x', max: 3, now }).holders).length, 3)
})
test('LEASES: old generations are pruned (the directory stays small); an unreadable directory fails CLOSED', () => {
  const L = lease()
  let now = 1_000_000, g = IO.crewTakeMining('A', 1, null, { ...L, now })
  for (let i = 0; i < 12; i++) { now += 1000; g = { gen: IO.crewRenew('A', { slot: 1, gen: g.gen }, { ...L, now }) } }
  assert.ok(fs.readdirSync(L.dir).length <= 5, `files left: ${fs.readdirSync(L.dir).length}`)
  assert.equal(IO.crewLeasesNow({ ...L, me: 'A', max: 1, now }).mine.slot, 1)
  const bad = path.join(tmp, 'a-file'); fs.writeFileSync(bad, 'x')
  const n = IO.crewLeasesNow({ dir: bad, key: L.key, me: 'A', max: 2, now })
  assert.deepEqual([n.ok, n.mining, n.run], [false, 2, true])
})
test('CENSUS FILES: one small file per bot, replaced in place; a torn file is skipped; no directory yet is "nobody", not "unread"', () => {
  const dir = path.join(tmp, `census${dseq++}`)
  assert.deepEqual(IO.censusRead({ dir }), [])
  assert.equal(IO.censusWrite('showcase-Alpha', false, { dir, now: 5 }), true); assert.equal(IO.censusWrite('showcase-Bravo', true, { dir, now: 6 }), true)
  assert.equal(IO.censusWrite('showcase-Alpha', true, { dir, now: 7 }), true)
  fs.writeFileSync(path.join(dir, 'census.torn.json'), '{"holder":')
  assert.deepEqual(IO.censusRead({ dir }).sort((a, b) => a.holder.localeCompare(b.holder)), [{ holder: 'showcase-Alpha', at: 7, ironPick: 1 }, { holder: 'showcase-Bravo', at: 6, ironPick: 1 }])
  assert.equal(IO.censusRead({ dir: path.join(tmp, 'a-file') }), null)
})

// ================================================================= the admission clause, through the real gate
const gateBot = (hook, at = [10, 70, 10]) => { const b = fieldBot({ at }); if (hook) b.mineCrewGate = hook; return b }
test('ADMISSION: the hook is asked after the argument checks and its refusal is `mine_crew` with the hook\'s detail; no hook asks nothing', () => {
  const seen = []
  const hook = (skill, args, o) => { seen.push([skill, { ...args }, o]); return skill === 'mine' ? { ok: false, why: 'no_need', detail: 'mining is a town crew job: x. Work at the surface instead: home, deposit' } : null }
  const ac = new AdmissionControl(null)
  const r = ac.check({ skill: 'mine', args: { y: 16 } }, gateBot(hook))
  assert.deepEqual([r.ok, r.reason, r.detail, r.crew.why], [false, 'mine_crew', 'mining is a town crew job: x. Work at the surface instead: home, deposit', 'no_need'])
  assert.deepEqual(seen[0], ['mine', { y: 16 }, { dry: false, fromOrder: false }])
  assert.equal(new AdmissionControl(null).check({ skill: 'mine', args: { y: 16 } }, gateBot(null)).ok, true, 'the positive control: with no hook the same proposal is admitted')
  // the argument checks still answer first: an upward target is the old bad_args, the hook never asked
  seen.length = 0
  assert.equal(ac.check({ skill: 'mine', args: { y: 90 } }, gateBot(hook)).reason, 'bad_args'); assert.equal(seen.length, 0)
  // a gather's name is resolved before the hook sees it; a non-refusal lets the gate go on
  const g = ac.check({ skill: 'gather', args: { item: 'cobblestone', count: 4 } }, gateBot(hook))
  assert.equal(g.ok, true); assert.deepEqual(seen.at(-1)[1], { block: 'cobblestone', count: 4 })
})
test('ADMISSION: the safety orders and an open deep trip never reach the hook; an order says it is one; a dry run says it is dry and never an order', () => {
  const seen = []
  const hook = (skill, _a, o) => { seen.push([skill, o]); return { ok: false, why: 'no_need', detail: 'no' } }
  const ac = new AdmissionControl(null)
  for (const skill of ['keepout_exit', 'sky_descend', 'deep_mine']) assert.equal(ac.check({ skill, args: {} }, gateBot(hook)).ok, true, skill)
  assert.equal(seen.length, 0)
  ac.fromOrder = true
  ac.check({ skill: 'gather', args: { block: 'coal_ore', count: 16, coalrun: true } }, gateBot(hook))
  assert.deepEqual(seen.at(-1), ['gather', { dry: false, fromOrder: true }])
  ac.dryCheck({ skill: 'gather', args: { block: 'coal_ore', count: 16 } }, gateBot(hook))
  assert.deepEqual(seen.at(-1), ['gather', { dry: true, fromOrder: false }])
  const stuck = gateBot(hook); stuck.inventoryUnsettled = { why: 'cursor' }
  seen.length = 0
  assert.equal(ac.check({ skill: 'mine', args: { y: 16 } }, stuck).reason, 'inventory_unsettled'); assert.equal(seen.length, 0)
})
test('ADMISSION MUTANT KILLED: with the clause\'s return gone the refused proposal is admitted', async () => {
  await withMutant(ADM_PATH, "      if (mc && mc.ok === false) return { ok: false, reason: 'mine_crew', detail: mc.detail, crew: mc }\n", '', async M => {
    const r = new M.AdmissionControl(null).check({ skill: 'mine', args: { y: 16 } }, gateBot(() => ({ ok: false, why: 'no_need', detail: 'no' })))
    assert.equal(r.ok, true)
  })
})

// ================================================================= crew_up and the idle ask (skills.mjs)
test('CREW_UP: registered, never the model\'s, housekeeping; with no stair walk it moves nothing, digs nothing, places nothing', async () => {
  assert.equal(SK.SKILLS.crew_up.chatOnly, true); assert.equal(SK.SKILLS.crew_up.rescue, true); assert.ok(SK.SKILL_CONTRACTS.crew_up.maxMs >= 124_000)
  const { isHousekeeping } = await import('../src/hygiene.mjs'); assert.equal(isHousekeeping('crew_up'), true)
  const bot = fieldBot({ at: [10, 16, 10], roof: [20, 60] })
  const touched = []
  bot.dig = async () => { touched.push('dig') }; bot.placeBlock = async () => { touched.push('place') }; bot.setControlState = (n, on) => { if (on) touched.push(n) }
  bot.pathfinder = { goto: async () => { touched.push('goto') }, setGoal: () => { touched.push('goal') }, movements: {} }
  const r = await SK.SKILLS.crew_up.run({ bot, runner: {} }, {}, new AbortController().signal)
  assert.deepEqual([r.status, r.stop], ['no_effect', 'no_stair_walk']); assert.match(r.detail, /nothing was dug/)
  assert.deepEqual(touched, [], 'no town stair here: the bot did not move')
})
test('CREW_UP: its body is the stair\'s ascent and nothing else (structural: no climb, no dig, no placement can be reached from it)', () => {
  const src = strip(fs.readFileSync(SK_PATH, 'utf8'))
  const i = src.indexOf('async function crewUp (ctx, _args, signal) {')
  assert.ok(i > 0 && src.indexOf('async function crewUp (', i + 1) < 0, 'crewUp: present and unique')
  const body = src.slice(i, src.indexOf('\n}\n', i))
  assert.ok(body.includes('const up = await stairAscend(ctx, signal)'))
  for (const bad of ['surface(', 'surfaceClimb(', 'shaftAscend(', '.dig(', 'placeBlock(', 'goto(', 'mine(', 'tunnelOut(', 'setControlState(']) assert.ok(!body.includes(bad), `crewUp must not call ${bad}`)
})
test('IDLE ASK: groundsIdleAsk never throws and answers { ok, why }; where the grounds are off it says so', () => {
  const a = SK.groundsIdleAsk(fieldBot(), Date.now())
  assert.equal(typeof a.ok, 'boolean'); assert.ok(a.ok || typeof a.why === 'string')
  assert.deepEqual(SK.groundsIdleAsk(null), { ok: false, why: 'grounds_off' })
})
test('S2 AND AN OPEN EXPEDITION: `home` walks the open trail back before any direct walk (structural), so the steer\'s home is the trip\'s own return', () => {
  const src = strip(fs.readFileSync(SK_PATH, 'utf8'))
  const i = src.indexOf('async function home(ctx, _args, signal) {')
  assert.ok(i > 0)
  const body = src.slice(i, src.indexOf('\n}\n', i))
  const leg = body.indexOf('exLeg = await expeditionHomeLeg(ctx, signal'), walk = body.indexOf('last = await goto(ctx, { x: homeX')
  assert.ok(leg > 0 && walk > leg, 'home: the expedition trail leg comes first')
})

// ================================================================= the REAL loop
const ldir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcai-crew-l-'))
let lseq = 0
const freshLessons = () => { const L = new Lessons(path.join(ldir, `l${lseq++}.json`)); L.data.avoid = {}; L.data.worked = {}; return L }
/** The crew's file calls, faked: one shared town (`st`) any number of loops may be given. */
function mkTown ({ iron = 200, coal = 200, lacking = [], mining = 0, max = 2, grounds = { ok: true, why: null }, run = null, stair = true, jitter = 0, own = null, lie = false } = {}) {
  // `lie`: the leases read free but every take is lost (another bot's lapsed slot inside its reclaim); `own`: this bot's kept census line
  const st = { stair, jitter, own, lie, kept: [], stock: stock(iron, coal), lacking, slots: {}, run, grounds, groundsAsks: 0, takes: [], releases: [], renews: 0, census: [], gen: 0, max, buildBusy: false, others: mining }
  const mineOf = me => { const k = Object.keys(st.slots).find(s => st.slots[s].holder === me); return k ? { slot: Number(k), gen: st.slots[k].gen, at: st.slots[k].at } : null }
  const count = () => st.others + Object.keys(st.slots).length
  const io = {
    leases: ({ me }) => ({ ok: true, mining: st.lie ? 0 : count(), run: !!st.run, mine: mineOf(me), holders: st.run ? { slot3: st.run } : {} }),
    meta: slot => st.slots[slot]?.meta ?? null,
    takeMining: (me, mx, meta) => {
      if (st.lie) return { ok: false, why: 'held by another (inside its reclaim)' }
      const own = mineOf(me)
      if (own) { st.slots[own.slot] = { holder: me, gen: ++st.gen, at: Date.now(), meta }; st.takes.push({ me, meta, again: true }); return { ok: true, slot: own.slot, gen: st.gen } }
      if (count() >= mx) return { ok: false, why: `all ${mx} slots held` }
      let k = 1; while (st.slots[k]) k++
      st.slots[k] = { holder: me, gen: ++st.gen, at: Date.now(), meta }; st.takes.push({ me, meta }); return { ok: true, slot: k, gen: st.gen }
    },
    takeRun: (me, meta) => { if (st.run && st.run !== me) return { ok: false, why: 'held' }; st.run = me; st.takes.push({ me, meta, run: true }); return { ok: true, slot: 3, gen: ++st.gen } },
    renew: (me, hold) => { st.renews++; if (st.slots[hold.slot]?.holder !== me) return null; st.slots[hold.slot].gen = ++st.gen; return st.gen },
    release: (me, hold) => { st.releases.push({ me, slot: hold.slot }); if (hold.slot === 3 && st.run === me) st.run = null; if (st.slots[hold.slot]?.holder === me) delete st.slots[hold.slot] },
    stock: () => st.stock, censusWrite: (me, has, o) => { st.census.push([me, has]); if (o?.keep) st.kept.push(JSON.parse(JSON.stringify(o.keep))); return true }, censusRead: () => st.lacking,
    censusOwn: () => st.own, jitter: () => st.jitter,
    buildBusy: () => st.buildBusy, grounds: () => { st.groundsAsks++; return st.grounds }, stair: () => st.stair,
  }
  return { st, io }
}
const lacks = () => [{ holder: 'showcase-Other', at: Date.now(), ironPick: 0 }]
/** Drive the real loop: a fake runner (`effect(skill, args, bot)` may move the bot / set what a visit did), a fake model. */
async function drive (mod, { bot, town, propose = () => ({ skill: 'status', args: {}, reason: 'p' }), effect = null, ms = 700, before = null, during = null, cooldown = null, latency = 1, fewer = null, pipe = null }) {
  const rows = [], runs = [], asked = [], all = [], skips = [], cancels = []
  const untap = tapRecords(r => { all.push(r); if (r?.skill?.name === '_minecrew') rows.push(r.skill.detail); if (r?.skill?.name === '_decision_skipped') skips.push(r.skill.detail) })
  const runner = { paused: false, pausedAt: null, isBusy: () => false, cancel: why => { cancels.push(why); return true },
    run: async (skill, args, opts) => { runs.push({ skill, args: { ...args }, trigger: opts?.trigger, t: Date.now() }); const e = effect ? await effect(skill, args, bot) : null; return e ?? { status: 'success', detail: 'ok', contractEvidence: ['position: moved 3 blocks'] } } }
  const was = config.llm.decisionCooldownMs
  if (cooldown != null) config.llm.decisionCooldownMs = cooldown
  try {
    const loop = new mod.CognitiveLoop(bot, runner, freshLessons(), null)
    loop.crewIo = town.io
    if (fewer) loop.fewerDec = fewer
    if (pipe) loop.pipe = pipe
    let n = 0
    loop.llm = { decide: async ({ user }) => { asked.push(user); n++; if (latency > 1) await sleep(latency); return { schemaValid: true, latencyMs: latency, raw: '{}', proposal: { ...propose(n, user) } } } }
    if (before) before(loop)
    loop.start()
    if (during) await during(loop, { rows, runs, cancels }); else await sleep(ms)
    loop.stop(); untap()
    await sleep(60)
    return { rows, runs, asked, loop, all, skips, cancels, runner, of: op => rows.filter(d => d.startsWith(`op=${op} `) || d === `op=${op}`) }
  } finally { untap(); config.llm.decisionCooldownMs = was }
}
const worked = (skill, args, bot) => { if (skill === 'build_shop') bot.tidyLast = { placed: 3, cleared: 1, outcome: 'deadline' }; return null }
const isIdle = r => r.skill === 'build_shop' && r.args.grounds === true && r.args.why === 'idle'

test('LOOP, THE COMPOSED BEHAVIOUR: surplus town, bot at the surface near home -- the steer orders the grounds AHEAD of the model; a model `mine` is refused and followed at once by the same order', async () => {
  const town = mkTown({})
  const out = await drive(COG, { bot: fieldBot(), town, effect: worked, propose: () => ({ skill: 'mine', args: { y: 16 }, reason: 'iron is at y=16' }), ms: 900 })
  assert.ok(out.runs.length >= 3, `runs: ${out.runs.map(r => r.skill)}`)
  assert.equal(out.runs.filter(r => r.skill === 'mine').length, 0, 'mine never ran')
  assert.ok(isIdle(out.runs[0]), `the FIRST run is the idle grounds visit, before the model spoke: ${JSON.stringify(out.runs[0])}`)
  assert.ok(out.runs.every(isIdle), `every run is the steer's: ${out.runs.map(r => r.skill)}`)
  const refused = out.of('refuse')
  assert.ok(refused.length >= 1, 'the model did propose mine between two visits, and it was refused')
  for (const d of refused) assert.match(d, /^op=refuse skill=mine why=no_need kind=mine src=model then=build_shop y=70 below=0 short=- held=0\/2$/)
  const steers = out.of('steer')
  assert.ok(steers.some(d => /kind=grounds why=idle skill=build_shop/.test(d)) && steers.some(d => /kind=grounds why=forced skill=build_shop/.test(d)), `idle and forced: ${steers}`)
  assert.ok(out.of('steer_end').every(d => /kind=grounds skill=build_shop status=success placed=3 cleared=1 out=deadline/.test(d)), String(out.of('steer_end')))
  assert.ok(out.of('next').some(d => /^op=next skill=build_shop src=steer status=success y=70 below=0$/.test(d)), 'what the refused bot did next is a row')
  assert.equal(out.loop.shopState, undefined, 'the idle visit never moved the build order\'s clock')
  assert.match(out.asked.find(u => /MINING:/.test(u)) ?? '', /MINING: closed for you \(the town has a surplus of everything mined\)/)
  assert.equal(typeof out.loop.bot.mineCrewGate, 'function'); assert.equal(out.loop.bot.mineCrewView.closed, true)
  assert.deepEqual(town.st.takes, [], 'no slot was ever taken')
  assert.ok(town.st.census.length >= 1 && town.st.census[0][0] === 'CrewBot' && town.st.census[0][1] === false, 'the bot wrote its own census line (a stone pickaxe: it lacks an iron one)')
})
test('LOOP DEAD END 8 MUTANT KILLED: without the idle exemption every idle visit restarts the build order\'s 10-minute clock', async () => {
  await withMutant(COG_PATH, "if (!declined && admitted.skill === 'build_shop' && !crewIdleVisit(admitted.args)) this.shopState", "if (!declined && admitted.skill === 'build_shop') this.shopState", async M => {
    const out = await drive(M, { bot: fieldBot(), town: mkTown({}), effect: worked, ms: 300 })
    assert.ok(out.runs.some(isIdle)); assert.ok(Number.isFinite(out.loop.shopState?.lastAt), 'the mutant wrote lastAt')
  })
})
test('LOOP DEAD END 8, THE DECLINED SIBLING: an idle visit the runner DECLINED is not the build order\'s to refund -- its clock stands, and the steer\'s own rhythm goes back', async () => {
  const declinedRun = s => (s === 'build_shop' ? { status: 'failed', failClass: 'runner_reserved', detail: 'reserved for a rescue' } : null)
  const out = await drive(COG, { bot: fieldBot(), town: mkTown({}), effect: declinedRun, before: l => { l.shopState = { lastAt: 12345, lastStop: 'complete' } }, ms: 300 })
  assert.ok(out.runs.filter(isIdle).length >= 2, 'not a try: asked again at the next tick, not after the rhythm')
  assert.deepEqual(out.loop.shopState, { lastAt: 12345, lastStop: 'complete' })
  assert.ok(out.of('steer_end').every(d => /status=declined/.test(d))); assert.deepEqual(out.of('idle_backoff'), [], 'a declined visit is no evidence: never a back-off')
  await withMutant(COG_PATH, "        if (order?.crewSteer) this.shopState = crewShopWas\n", '', async M => {
    const m = await drive(M, { bot: fieldBot(), town: mkTown({}), effect: declinedRun, before: l => { l.shopState = { lastAt: 12345, lastStop: 'complete' } }, ms: 300 })
    assert.equal(m.loop.shopState.lastAt, -Infinity, 'the mutant wipes the build order\'s cooldown at every declined idle visit')
  })
})
test('LOOP DEAD END 3 (the gate\'s memory): six idle visits in a row are all admitted -- the steer takes no place in the repeat window', async () => {
  const out = await drive(COG, { bot: fieldBot(), town: mkTown({}), effect: worked, ms: 1500 })
  const issued = out.of('steer').filter(d => /kind=grounds/.test(d)).length, ran = out.runs.filter(isIdle).length
  assert.ok(issued >= 5, `issued ${issued}`); assert.equal(ran, issued, 'every issued visit ran')
})
test('LOOP DEAD END 3 MUTANT KILLED: with the steer counted in the repeat window the visits stop at four (its own fifth order reads as a repeat loop)', async () => {
  await withMutant(COG_PATH, "      if (order?.crewSteer && admitted.kind === 'normal') this.admission.forgetLastAdmitted(AdmissionControl.key(admitted.skill, admitted.args))\n", '', async M => {
    const out = await drive(M, { bot: fieldBot(), town: mkTown({}), effect: worked, ms: 1500 })
    const issued = out.of('steer').filter(d => /kind=grounds/.test(d)).length, ran = out.runs.filter(isIdle).length
    assert.ok(ran <= 4, `the mutant ran ${ran} of ${issued}`)
    assert.ok(out.of('steer').some(d => /kind=none why=memory/.test(d)), 'and then finds its own order refused by the window: the visits stop for good')
  })
})
test('LOOP DEAD END 3, THE LEARNED SIBLING: learned failures of build_shop do not close the grounds to the bot for good -- the order is issued and the gate\'s own probation lets it through', async () => {
  const learned = l => { l.admission.lessons = { failCount: sk => (sk === 'build_shop' ? 9 : 0), entryFor: () => null } }
  const out = await drive(COG, { bot: fieldBot(), town: mkTown({}), effect: worked, before: learned, ms: 1700 })
  assert.ok(out.runs.filter(isIdle).length >= 1, `an idle visit ran: ${out.runs.map(r => r.skill)}`)
  assert.ok(out.of('steer').filter(d => /kind=grounds/.test(d)).length > out.runs.filter(isIdle).length, 'the positive control: the gate did veto some of them first (learned_avoid)')
  await withMutant(COG_PATH, "    return m === 'learned_avoid' ? null : m\n", '    return m\n', async M => {
    const m = await drive(M, { bot: fieldBot(), town: mkTown({}), effect: worked, before: learned, ms: 1700 })
    assert.equal(m.runs.filter(isIdle).length, 0, 'the mutant never issues the order: no attempt can ever clear the learned rule')
    assert.ok(m.of('steer').some(d => /kind=none why=memory/.test(d)))
  })
})
test('LOOP DEAD ENDS 4 + 7 + C3 (a bot under rock in town with no build order): crew_up three times, then ONE climb for the back-off (a bot the stair does not reach must still come up) -- and a refused `mine` names the way up', async () => {
  const town = mkTown({})
  const bot = fieldBot({ at: [10, 16, 10], roof: [20, 60] })
  const out = await drive(COG, { bot, town, effect: s => (s === 'crew_up' ? { status: 'no_effect', stop: 'no_stair_walk', detail: 'no walk' } : null), propose: () => ({ skill: 'mine', args: { y: 10 }, reason: 'deeper' }), ms: 1300 })
  assert.deepEqual(out.runs.slice(0, 4).map(r => r.skill), ['crew_up', 'crew_up', 'crew_up', 'surface'], `runs: ${out.runs.map(r => r.skill)}`)
  assert.equal(out.runs.filter(r => r.skill === 'crew_up').length, 3, 'three stair tries, then no more for the back-off')
  assert.equal(out.runs.filter(r => r.skill === 'surface').length, 1, 'ONE climb per back-off, never a climb at every tick')
  assert.equal(out.runs.filter(r => r.skill === 'mine').length, 0, 'mine never runs')
  assert.deepEqual(out.of('up_backoff'), ['op=up_backoff inside=1 y=16 min=10 climb_owed=1'])
  assert.ok(out.of('steer_end').slice(0, 3).every(d => /kind=up skill=crew_up status=no_effect out=no_stair_walk arrived=0 y=16 below=1/.test(d)), String(out.of('steer_end')))
  assert.ok(out.of('steer').some(d => /^op=steer kind=up why=climb skill=surface/.test(d)), String(out.of('steer')))
  const refused = out.of('refuse')
  assert.ok(refused.length >= 1 && refused.every(d => /skill=mine why=no_need kind=mine src=model then=none:up_backoff y=16 below=1/.test(d)), String(refused))
  assert.match(MC.crewRefusal({ why: 'no_need', below: true }), /Come up: run surface/)
})
test('LOOP: the way up that arrives ends the episode -- and the bot is then ordered to the grounds; outside the town the order is `surface`', async () => {
  const bot = fieldBot({ at: [10, 16, 10], roof: [20, 60] })
  const up = (s, _a, b) => { if (s === 'crew_up') b.entity.position = new Vec3(10, 70, 10); if (s === 'build_shop') b.tidyLast = { placed: 1, cleared: 0, outcome: 'deadline' }; return null }
  const out = await drive(COG, { bot, town: mkTown({}), effect: up, ms: 500 })
  assert.equal(out.runs[0].skill, 'crew_up'); assert.ok(isIdle(out.runs[1]), `then the grounds: ${out.runs.map(r => r.skill)}`)
  assert.match(out.of('steer_end')[0], /kind=up skill=crew_up status=success .*arrived=1 y=70 below=0/)
  const far = await drive(COG, { bot: fieldBot({ at: [60, 16, 0], roof: [20, 60] }), town: mkTown({}), effect: (s, _a, b) => { if (s === 'surface') b.entity.position = new Vec3(60, 70, 0); return null }, ms: 300 })
  assert.equal(far.runs[0].skill, 'surface', 'beyond 48 blocks of home the climb is outside the town')
  const noStair = await drive(COG, { bot: fieldBot({ at: [10, 16, 10], roof: [20, 60] }), town: mkTown({ stair: false }), effect: (s, _a, b) => { if (s === 'surface') b.entity.position = new Vec3(10, 70, 10); return null }, ms: 300 })
  assert.equal(noStair.runs[0].skill, 'surface', 'a town with no stair: the climb is the only way up, and it is ordered (never crew_up, which could not move the bot)')
})
test('LOOP DEAD ENDS 1 + 2 (a prerequisite is the task): the steer stands aside, stone is gathered below ground with no turn -- and an ore is still refused there', async () => {
  const prereq = () => ({ items: ['dirt'], count: 8, since: Date.now(), fromSkill: 'surface', describe: 'Gather 8 dirt or cobblestone to climb out.', because: 'scaffold' })
  const mk = () => fieldBot({ at: [10, 16, 10], roof: [20, 60] })
  const a = await drive(COG, { bot: mk(), town: mkTown({}), before: l => { l.prereq = prereq() }, propose: () => ({ skill: 'gather', args: { block: 'stone', count: 8 }, reason: 'scaffold' }), ms: 400 })
  assert.ok(a.runs.length >= 1 && a.runs.every(r => r.skill === 'gather' && r.args.block === 'stone'), `runs: ${JSON.stringify(a.runs)}`)
  assert.deepEqual(a.of('refuse'), []); assert.ok(a.of('steer').every(d => /kind=none why=prereq/.test(d)), String(a.of('steer')))
  assert.match(a.asked[0], /TASK: Gather 8 dirt or cobblestone to climb out\./)
  const b = await drive(COG, { bot: mk(), town: mkTown({}), before: l => { l.prereq = prereq() }, propose: () => ({ skill: 'gather', args: { block: 'iron_ore', count: 3 }, reason: 'ore' }), ms: 400 })
  assert.equal(b.runs.length, 0, 'the positive control: the same bot is refused the ore'); assert.ok(b.of('refuse').length >= 1)
  const c = await drive(COG, { bot: mk(), town: mkTown({}), effect: s => (s === 'crew_up' ? { status: 'no_effect', stop: 'no_stair_walk', detail: 'x' } : null), ms: 300 })
  assert.equal(c.runs[0].skill, 'crew_up', 'the positive control: with no prerequisite the steer does take the tick')
})
test('LOOP DEAD END 2 (entombed with no pickaxe): the reflex\'s prerequisite becomes the task, the steer stands aside, and the cobble for the pickaxe is gathered below ground', async () => {
  // (outside the town's 48 blocks: no town order for a missing pickaxe takes the tick; the steer's way up there would be `surface`)
  const bot = fieldBot({ at: [60, 16, 0], roof: [20, 60], inv: [{ name: 'dirt', count: 2, slot: 10, type: mcData.itemsByName.dirt.id }] })
  bot.pendingPrereq = { items: ['stone_pickaxe', 'wooden_pickaxe'], count: 1, describe: 'Make a pickaxe to dig out.', because: 'entombed with no pickaxe' }
  const out = await drive(COG, { bot, town: mkTown({}), propose: n => ({ skill: 'gather', args: { block: 'cobblestone', count: 3 + (n % 3) }, reason: 'for the pickaxe' }), ms: 400 })
  assert.ok(out.runs.length >= 2 && out.runs.every(r => r.skill === 'gather' && r.args.block === 'cobblestone'), `runs: ${JSON.stringify(out.runs)}`)
  assert.equal(out.runs.filter(r => r.skill === 'crew_up' || r.skill === 'surface').length, 0); assert.deepEqual(out.of('refuse'), [])
  assert.match(out.asked[0], /TASK: Make a pickaxe to dig out\./)
  const none = await drive(COG, { bot: fieldBot({ at: [60, 16, 0], roof: [20, 60], inv: [{ name: 'dirt', count: 2, slot: 10, type: mcData.itemsByName.dirt.id }] }), town: mkTown({}), ms: 200 })
  assert.equal(none.runs[0].skill, 'surface', 'the positive control: with no prerequisite the same bot is sent up')
})
test('LOOP DEAD END 5 (the milestone\'s wants never re-admit ore): a rung that wants iron, four learned failures -- the gate\'s milestone exemption would admit the gather; the crew refuses it first', () => {
  const lessons = { failCount: () => 5, entryFor: () => null }
  const wanted = new Set(['iron_ore', 'raw_iron'])
  const p = () => ({ skill: 'gather', args: { block: 'iron_ore', count: 3 } })
  const free = new AdmissionControl(lessons).check(p(), gateBot(null), wanted)
  assert.deepEqual([free.ok, free.kind], [true, 'milestone_critical'], 'the positive control: with no crew the exemption does admit it')
  const r = new AdmissionControl(lessons).check(p(), gateBot(() => ({ ok: false, why: 'no_need', detail: 'mining is a town crew job' })), wanted)
  assert.deepEqual([r.ok, r.reason], [false, 'mine_crew'])
  const src = strip(fs.readFileSync(ADM_PATH, 'utf8'))
  assert.ok(src.indexOf("if (typeof bot?.mineCrewGate === 'function') {") < src.indexOf("return { ok: true, skill, args, kind: 'milestone_critical',"), 'the crew is asked before the exemption')
  assert.ok(src.indexOf("if (typeof bot?.mineCrewGate === 'function') {") > src.indexOf("if (!mineTargetOk(here, y)) {"), '...and after the argument checks')
})
test('LOOP, S2 STANDS ASIDE FOR AN OPEN DEEP TRIP: far from home with a trip open, every tick is the trip\'s own call -- never `home`', async () => {
  const bot = fieldBot({ at: [400, 70, 400] })
  bot.deepTrip = { id: 'CrewBot-t1', target: 'iron', phase: 'work', startedAt: Date.now(), calls: 1, trail: [] }
  const town = mkTown({ iron: 5, lacking: lacks() })
  const out = await drive(COG, { bot, town, ms: 300 })
  assert.ok(out.runs.length >= 2 && out.runs.every(r => r.skill === 'deep_mine'), `runs: ${out.runs.map(r => r.skill)}`)
  assert.equal(out.of('steer').filter(d => /kind=home|kind=grounds|kind=up/.test(d)).length, 0)
  assert.equal(town.st.takes.filter(t => !t.again).length, 1, 'the open trip took ONE crew slot (an open trip is counted, never cut)')
  assert.equal(town.st.takes[0].meta.deep, true)
  const far = await drive(COG, { bot: fieldBot({ at: [400, 70, 400] }), town: mkTown({}), ms: 200 })
  assert.equal(far.runs[0].skill, 'home', 'the positive control: the same bot with no trip is sent home')
})
test('LOOP, A NEW DEEP TRIP (the glue: #crewDeepStart over the real loop\'s readings): the need, the build lease and the crew\'s count decide; the slot is taken before the trip exists', async () => {
  const mk = async (townOpts, tweak = null) => {
    const town = mkTown({ grounds: { ok: false, why: 'full' }, ...townOpts })
    if (tweak) tweak(town.st)
    const out = await drive(COG, { bot: fieldBot(), town, ms: 120 })
    const rows = []; const untap = tapRecords(r => { if (r?.skill?.name === '_minecrew') rows.push(r.skill.detail) })
    const start = target => out.loop.crewDeepStartForTest({ skill: 'deep_mine', args: { target }, why: 'town deep miner' })
    return { town, out, rows, untap, start }
  }
  // a surplus town: an iron trip and a diamond trip are closed, the town mine's build trip goes on
  const a = await mk({})
  assert.equal(a.start('iron'), null); assert.equal(a.start('diamond'), null); assert.deepEqual(a.town.st.takes, [])
  assert.match(a.rows[0], /^op=refuse skill=deep_mine why=no_need src=order target=iron$/)
  const built = a.start('build')
  assert.equal(built?.skill, 'deep_mine'); assert.deepEqual(a.town.st.takes.map(t => [t.meta.for, t.meta.deep]), [['build', true]])
  assert.ok(a.rows.some(d => /^op=grant for=build kind=deep target=build slot=1 held=1\/2$/.test(d)), String(a.rows)); a.untap()
  // ...unless another bot holds the build lease: this bag (a stone pickaxe) would make an IRON trip inside the skill -- closed
  const b = await mk({}, st => { st.buildBusy = true })
  assert.equal(b.start('build'), null); assert.deepEqual(b.town.st.takes, []); b.untap()
  // the town short of iron: the iron trip is admitted and holds ONE of the two slots; with the crew full it is not ordered
  const c = await mk({ iron: 5, lacking: lacks() })
  assert.equal(c.start('iron')?.skill, 'deep_mine'); assert.deepEqual(c.town.st.takes.map(t => [t.meta.for, t.meta.deep]), [['iron', true]]); c.untap()
  const d = await mk({ iron: 5, lacking: lacks(), mining: 2 })
  assert.equal(d.start('iron'), null); assert.ok(d.rows.some(r => /^op=refuse skill=deep_mine why=crew_full src=order target=iron$/.test(r)), String(d.rows)); d.untap()
  await withMutant(COG_PATH, "      if (!g.ok) return quiet(g.why, { target })\n", '', async M => {
    const town = mkTown({ grounds: { ok: false, why: 'full' } })
    const out = await drive(M, { bot: fieldBot(), town, ms: 120 })
    assert.equal(out.loop.crewDeepStartForTest({ skill: 'deep_mine', args: { target: 'iron' }, why: 'x' })?.skill, 'deep_mine', 'the mutant orders an iron trip into a surplus town')
  })
})
test('LOOP: the need opens -- the model\'s `mine` takes a slot (the grant names the material), the turn is its; a full crew refuses the next bot', async () => {
  const town = mkTown({ iron: 5, lacking: lacks(), grounds: { ok: false, why: 'full' } })
  const out = await drive(COG, { bot: fieldBot(), town, propose: n => (n <= 2 ? { skill: 'mine', args: { y: 16 }, reason: 'iron' } : { skill: 'status', args: {}, reason: 's' }), ms: 400 })
  assert.equal(out.runs[0].skill, 'mine'); assert.deepEqual(out.runs[0].args, { y: 16 })
  assert.equal(town.st.takes.filter(t => !t.again).length, 1); assert.equal(town.st.takes[0].meta.for, 'iron')
  assert.match(out.of('grant')[0], /^op=grant for=iron kind=mine slot=1 held=1\/2 y=70$/)
  assert.match(out.asked[0], /MINING: the town is short of iron and a mine-crew turn is free \(0 of 2 taken\)/)
  assert.ok(out.asked.some(u => /MINING: you hold a mine-crew turn for iron/.test(u)), 'the holder is told so')
  assert.ok(out.of('steer').every(d => !/kind=grounds|kind=up|kind=home/.test(d)), 'a holder is not steered')
  // ...and with the grounds OPEN (the steer would keep the bot busy for good) the offer still reaches the model: it takes the turn
  const busy = mkTown({ iron: 5, lacking: lacks() })
  const o3 = await drive(COG, { bot: fieldBot({ name: 'CrewThree' }), town: busy, effect: worked, propose: () => ({ skill: 'mine', args: { y: 16 }, reason: 'iron' }), ms: 400 })
  assert.equal(o3.runs[0].skill, 'mine', `the first decision is the model's (the offer), and it takes the turn: ${o3.runs.map(r => r.skill)}`)
  assert.equal(busy.st.takes.filter(t => !t.again).length, 1)
  const full = mkTown({ iron: 5, lacking: lacks(), mining: 2, grounds: { ok: false, why: 'full' } })
  const two = await drive(COG, { bot: fieldBot({ name: 'CrewTwo' }), town: full, propose: () => ({ skill: 'mine', args: { y: 16 }, reason: 'iron' }), ms: 300 })
  assert.equal(two.runs.filter(r => r.skill === 'mine').length, 0); assert.deepEqual(full.st.takes, [])
  assert.match(two.asked[0], /MINING: closed for you \(the crew is full or you are resting; short of iron\)/)
})
test('LOOP: a holder gathers the SHORT material\'s ore only; copper is refused it', async () => {
  const town = mkTown({ iron: 5, lacking: lacks(), grounds: { ok: false, why: 'full' } })
  const out = await drive(COG, { bot: fieldBot(), town, propose: n => (n % 2 ? { skill: 'gather', args: { block: 'iron_ore', count: n }, reason: 'i' } : { skill: 'gather', args: { block: 'copper_ore', count: n }, reason: 'c' }), ms: 400 })
  assert.ok(out.runs.length >= 1 && out.runs.every(r => r.args.block === 'iron_ore'), JSON.stringify(out.runs))
  assert.ok(out.of('refuse').some(d => /skill=gather why=not_short kind=ore material=copper src=model/.test(d)), String(out.of('refuse')))
})
test('LOOP DEAD END 7 (a turn that ends below ground) and a death: the slot is let go, the bot rests, and the SAME way up is ordered', async () => {
  const town = mkTown({ iron: 5, lacking: lacks(), grounds: { ok: false, why: 'full' } })
  const bot = fieldBot()
  const down = (s, _a, b) => { if (s === 'mine') { b.entity.position = new Vec3(10, 16, 10); b.blockAt = p => (p.y >= 20 && p.y <= 60 ? { name: 'stone', boundingBox: 'block' } : { name: 'air', boundingBox: 'empty' }) } if (s === 'crew_up') return { status: 'no_effect', stop: 'no_stair_walk', detail: 'x' }; return null }
  const out = await drive(COG, { bot, town, effect: down, propose: n => (n === 1 ? { skill: 'mine', args: { y: 16 }, reason: 'iron' } : { skill: 'gather', args: { block: 'stone', count: n }, reason: 's' }),
    during: async loop => { await sleep(250); assert.ok(loop.crew.hold, 'it holds a turn'); loop.crew.hold.since = Date.now() - MC.CREW.termMs - 1; await sleep(500) } })
  assert.deepEqual(out.of('release').filter(d => /why=turn_over/.test(d)).length, 1, String(out.rows))
  assert.ok(out.loop.crew.restUntil > Date.now() + MC.CREW.restMs - 5000, 'it rests 20 min')
  assert.ok(town.st.releases.length >= 1); assert.ok(out.runs.some(r => r.skill === 'crew_up'), `the way up follows the turn: ${out.runs.map(r => r.skill)}`)
  // a death ends a model miner's turn at once
  const t2 = mkTown({ iron: 5, lacking: lacks(), grounds: { ok: false, why: 'full' } })
  const o2 = await drive(COG, { bot: fieldBot(), town: t2, propose: n => (n === 1 ? { skill: 'mine', args: { y: 16 }, reason: 'iron' } : { skill: 'status', args: {}, reason: 's' }),
    during: async loop => { await sleep(200); assert.ok(loop.crew.hold); loop.notify('death', 'died and respawned'); await sleep(250) } })
  assert.ok(o2.of('release').some(d => /why=death/.test(d)), String(o2.rows)); assert.equal(Object.keys(t2.st.slots).length, 0)
})
test('LOOP: the need closes under a holder -- its slot is closed (row), and its next mining proposal is refused', async () => {
  const town = mkTown({ iron: 5, lacking: lacks(), grounds: { ok: false, why: 'full' } })
  const out = await drive(COG, { bot: fieldBot(), town, propose: () => ({ skill: 'mine', args: { y: 16 }, reason: 'iron' }),
    during: async loop => { await sleep(200); assert.ok(loop.crew.hold); town.st.stock = stock(300, 300); loop.crew.readAt = -Infinity; await sleep(350) } })
  assert.ok(out.of('closed').some(d => /^op=closed why=no_need slot=1 for=iron/.test(d)), String(out.rows))
  assert.ok(out.of('refuse').some(d => /why=no_need/.test(d))); assert.equal(Object.keys(town.st.slots).length, 0)
})
test('LOOP S2: far from home at the surface -- one `home` order per rhythm; with a prerequisite open, none (dead end 9: the patrol rung is not this bot\'s task)', async () => {
  const far = () => fieldBot({ at: [400, 70, 400] })
  const a = await drive(COG, { bot: far(), town: mkTown({}), ms: 500 })
  assert.equal(a.runs[0].skill, 'home'); assert.equal(a.runs.filter(r => r.skill === 'home').length, 1, `runs: ${a.runs.map(r => r.skill)}`)
  assert.match(a.of('steer')[0], /^op=steer kind=home why=idle skill=home y=70 below=0 home_d=566$/)
  assert.ok(a.asked.every(u => !/TASK: Scout terrain away from home/.test(u)), 'the patrol rung is stepped over: the model is never told to walk away')
  const b = await drive(COG, { bot: far(), town: mkTown({}), before: l => { l.prereq = { items: ['dirt'], count: 8, since: Date.now(), fromSkill: 'surface', describe: 'Gather 8 dirt.', because: 'x' } }, ms: 300 })
  assert.equal(b.runs.filter(r => r.skill === 'home').length, 0)
})
test('LOOP: an aborting idle visit is not ordered for ever -- two that fix nothing and the steer backs off; the reason it then finds no order is counted', async () => {
  const town = mkTown({})
  const out = await drive(COG, { bot: fieldBot(), town, effect: s => (s === 'build_shop' ? { status: 'aborted', detail: 'interrupted' } : null), ms: 1200 })
  assert.equal(out.runs.filter(isIdle).length, 2, `runs: ${out.runs.map(r => r.skill)}`)
  assert.deepEqual(out.of('idle_backoff'), ['op=idle_backoff n=2 min=10'])
  assert.ok(out.of('steer_end').every(d => /status=aborted .*out=aborted .*idle_n=[12]/.test(d)), String(out.of('steer_end')))
  assert.ok(out.of('steer').some(d => /^op=steer kind=none why=backoff forced=0 y=70 below=0/.test(d)), 'why the steer found no order is a row')
  assert.ok((out.loop.crew.tally.backoff ?? 0) >= 1, 'and a tally for the state row')
})
test('LOOP: why the grounds had nothing is the steer\'s reason (full / spent), row and tally; the model is then asked, with mining closed', async () => {
  for (const why of ['full', 'spent', 'record_stuck']) {
    const out = await drive(COG, { bot: fieldBot(), town: mkTown({ grounds: { ok: false, why } }), ms: 300 })
    assert.ok(out.of('steer').some(d => d.startsWith(`op=steer kind=none why=${why} forced=0`)), `${why}: ${out.of('steer')}`)
    assert.ok(out.loop.crew.tally[why] >= 1); assert.ok(out.runs.every(r => r.skill === 'status'))
    assert.match(MC.tallyLine({ full: 3, spent: 10 }), /^spent:10,full:3$/)
  }
})
test('LOOP: the material run -- an order\'s ore gather takes slot 3 only when its ore lies below the line; held by another, it is refused its turn', async () => {
  const town = mkTown({})
  const bot = fieldBot({ ores: [{ name: 'coal_ore', at: [14, 30, 10] }] })
  const out = await drive(COG, { bot, town, effect: worked, ms: 150 })
  const hook = out.loop.bot.mineCrewGate
  bot.mineCrewPending = null
  assert.deepEqual(hook('gather', { block: 'coal_ore', count: 16, coalrun: true }, { fromOrder: true }), { ok: true })
  assert.deepEqual(bot.mineCrewPending, { take: 'run', for: 'run', kind: 'run' })
  bot.mineCrewPending = null
  assert.deepEqual(hook('gather', { block: 'coal_ore', count: 16 }, { fromOrder: true, dry: true }), { ok: true }); assert.equal(bot.mineCrewPending, null, 'a dry run leaves nothing')
  const ore = bot.findBlock; bot.findBlock = () => ({ position: new Vec3(14, 64, 10) })
  hook('gather', { block: 'coal_ore', count: 16, coalrun: true }, { fromOrder: true }); assert.equal(bot.mineCrewPending, null, 'ore above the line: no slot')
  bot.findBlock = ore
  const model = hook('gather', { block: 'coal_ore', count: 16 }, { fromOrder: false })
  assert.deepEqual([model.ok, model.why, model.kind, model.material], [false, 'no_need', 'ore', 'coal'], 'the model\'s gather of the same ore is the crew\'s')
  town.st.run = 'showcase-Other'; out.loop.crew.read = town.io.leases({ me: 'CrewBot' })
  const busy = hook('gather', { block: 'coal_ore', count: 16, coalrun: true }, { fromOrder: true })
  assert.deepEqual([busy.ok, busy.why], [false, 'run_busy']); assert.match(busy.detail, /waits its normal retry/)
  assert.equal(hook('gather', { block: 'stone', count: 8 }, {}), null); assert.equal(hook('explore', { blocks: 60 }, {}), null); assert.equal(hook('surface', {}, {}), null)
  assert.equal(hook('mine', { y: 70 }, {}), null, 'a descent that ends above the line is nobody\'s business')
})
test('LOOP: the state row carries what a one-hour read counts -- position against the line, the holders, the need, why the steer found nothing', async () => {
  const out = await drive(COG, { bot: fieldBot({ at: [10, 16, 10], roof: [20, 60] }), town: mkTown({ grounds: { ok: false, why: 'full' } }), effect: s => (s === 'crew_up' ? { status: 'no_effect', stop: 'no_stair_walk', detail: 'x' } : null),
    during: async loop => { await sleep(300); loop.crew.stateAt = -Infinity; await sleep(150) } })
  const st = out.of('state')
  assert.ok(st.length >= 1, String(out.rows))
  assert.match(st[0], /^op=state y=16 below=1 deep=1 holds=0 held=0\/2 run=0 short=- iron=200 coal=200 lacking=1 why_iron=stocked why_coal=stocked steer_none=\S+$/)
})
// ================================================================= review round 1 (two engines; the reviewer's probes x-hot / x-long / x-band)
const tapCrew = () => { const rows = []; const untap = tapRecords(r => { if (r?.skill?.name === '_minecrew') rows.push(r.skill.detail) }); return { rows, untap, of: op => rows.filter(d => d.startsWith(`op=${op} `)) } }
const MINE = () => ({ skill: 'mine', args: { y: 16 }, reason: 'iron is at y=16' })
const underRock = (o = {}) => fieldBot({ at: [10, 16, 10], roof: [20, 60], ...o })

test('LOOP B1 (review r1), NO HOT LOOP: with nothing to order after a refusal the next decision waits the COOLDOWN -- in every state the reviewer named the refusals come at the cooldown\'s rate, not the model\'s latency', async () => {
  // a 400 ms cooldown (8x the re-tick), the model proposing mine at every ask, 2.4 s: at most one refusal per cooldown
  const prereq = l => { l.prereq = { items: ['dirt'], count: 8, since: Date.now(), fromSkill: 'surface', describe: 'Gather 8 dirt.', because: 'x' } }
  const states = {
    'grounds spent': { bot: fieldBot(), town: mkTown({ grounds: { ok: false, why: 'spent' } }), then: 'none:spent' },
    'grounds full': { bot: fieldBot(), town: mkTown({ grounds: { ok: false, why: 'full' } }), then: 'none:full' },
    'an open prerequisite, under rock': { bot: underRock(), town: mkTown({}), before: prereq, propose: () => ({ skill: 'mine', args: { y: 10 }, reason: 'deeper' }), then: 'none:prereq' },
    'a lost take (the leases read free, every take is refused)': { bot: fieldBot(), town: mkTown({ iron: 5, lacking: lacks(), lie: true, grounds: { ok: false, why: 'full' } }), then: 'none:' },
  }
  for (const [name, st] of Object.entries(states)) {
    const out = await drive(COG, { bot: st.bot, town: st.town, before: st.before ?? null, propose: st.propose ?? MINE, cooldown: 400, ms: 2400 })
    const refused = out.of('refuse')
    assert.ok(refused.length >= 3 && refused.length <= 8, `${name}: ${refused.length} refusals in 2.4 s at a 400 ms cooldown (one per cooldown is 6-7; a hot loop is 40+)`)
    assert.ok(out.asked.length <= 8, `${name}: the model was asked ${out.asked.length} times`)
    assert.ok(refused.every(d => d.includes(` then=${st.then}`)), `${name}: ${refused[0]}`)
    assert.equal(out.runs.filter(r => r.skill === 'mine').length, 0, name)
    // ...and the crew's refusals never set the livelock breaker off (its relocation is a walk, then a DIG: under the town, a tunnel)
    assert.deepEqual(out.all.filter(r => /livelock/.test(String(r?.skill?.name))).map(r => r.skill.name), [], `${name}: no livelock row`)
    assert.equal(out.runs.filter(r => r.skill === 'goto').length, 0, name); assert.equal(out.loop.consecutiveRejections ?? 0, 0, name)
  }
  await withMutant(COG_PATH, "      const crewQuiet = MINECREW.on && rejection?.reason === 'mine_crew' && !this.#crewStranded()\n", '      const crewQuiet = false\n', async M => {
    const m = await drive(M, { bot: underRock(), town: mkTown({}), before: prereq, propose: () => ({ skill: 'mine', args: { y: 10 }, reason: 'deeper' }), cooldown: 400, ms: 2400 })
    assert.ok(m.loop.consecutiveRejections >= 3 && (m.all.some(r => /livelock/.test(String(r?.skill?.name))) || m.runs.some(r => r.skill === 'goto')), 'the mutant: three crew refusals and the breaker is asked to relocate a bot under the town')
  })
})
test('LOOP B1: when the steer HAS an order the refusal is still followed at once (the 50 ms tick, not the cooldown) -- and only then', async () => {
  // under rock inside the deploy jitter: unforced the steer has nothing (`jitter`), forced it has the way up (C3)
  const out = await drive(COG, { bot: underRock(), town: mkTown({ jitter: 60_000 }), effect: s => (s === 'crew_up' ? { status: 'no_effect', stop: 'no_stair_walk', detail: 'x' } : null),
    propose: () => ({ skill: 'mine', args: { y: 10 }, reason: 'deeper' }), cooldown: 400, ms: 1000 })
  const first = out.all.find(r => r?.skill?.name === '_minecrew' && r.skill.detail.startsWith('op=refuse '))
  assert.ok(first && first.skill.detail.includes(' then=crew_up '), String(out.of('refuse')))
  const up = out.runs.find(r => r.skill === 'crew_up')
  assert.ok(up && up.t - Date.parse(first['@timestamp']) < 250, `the order follows the refusal ${up ? up.t - Date.parse(first['@timestamp']) : '?'} ms later (the cooldown is 400)`)
})
test('LOOP B1 MUTANT KILLED: with the early tick set for every refusal, the "grounds spent" state asks and refuses at the re-tick\'s pace', async () => {
  await withMutant(COG_PATH, 'if (d.order) { this.crewForce = true; this.crewRetick = true }', 'this.crewForce = true; this.crewRetick = true', async M => {
    const out = await drive(M, { bot: fieldBot(), town: mkTown({ grounds: { ok: false, why: 'spent' } }), propose: MINE, cooldown: 400, ms: 2400 })
    assert.ok(out.of('refuse').length >= 15, `the mutant refused ${out.of('refuse').length} times in 2.4 s`)
  })
})
test('LOOP B1 + VETOSKIP: a `mine_crew` veto arms fewerdec\'s skip -- the tick after a refused mining pick, with nothing changed, is not asked again', async () => {
  const fewer = FD.fewerDecConfig({ FEWERDEC_VETOSKIP_DELAY_MS: '150', FEWERDEC_CONTINUE: '0', FEWERDEC_PAUSEWAIT: '0' })
  assert.deepEqual([...fewer.vetoReasons], ['repeat_loop'], 'fewerdec\'s own default is untouched: the crew adds its reason at the call')
  const out = await drive(COG, { bot: fieldBot(), town: mkTown({ grounds: { ok: false, why: 'spent' } }), propose: MINE, fewer, cooldown: 300, ms: 2600 })
  const vs = out.skips.filter(d => /rule=vetoskip mine_crew: mine/.test(d))
  assert.ok(vs.length >= 2, `skips: ${out.skips}`)
  assert.ok(out.of('refuse').length <= vs.length + 1 && out.of('refuse').length >= 2, `one skip per veto: ${out.of('refuse').length} refusals, ${vs.length} skips`)
  await withMutant(COG_PATH, "    if (!MINECREW.on || !cfg?.vetoSkip || !cfg.vetoReasons || cfg.vetoReasons.has('mine_crew')) return cfg\n", '    if (cfg) return cfg\n', async M => {
    const m = await drive(M, { bot: fieldBot(), town: mkTown({ grounds: { ok: false, why: 'spent' } }), propose: MINE, fewer, cooldown: 300, ms: 1500 })
    assert.equal(m.skips.filter(d => /vetoskip mine_crew/.test(d)).length, 0)
  })
})
test('LOOP B1, THE LOST TAKE: a take another bot wins is the crew\'s refusal (never an uncounted miner), and the reading that offered the slot is corrected at once', async () => {
  const mk = () => mkTown({ iron: 5, lacking: lacks(), lie: true, grounds: { ok: false, why: 'full' } })
  const out = await drive(COG, { bot: fieldBot(), town: mk(), propose: MINE, ms: 500 })
  assert.equal(out.runs.filter(r => r.skill === 'mine').length, 0)
  assert.match(out.of('refuse')[0], /^op=refuse skill=mine why=crew_full kind=mine src=model then=none:\S+ y=70 below=0 short=iron held=2\/2$/)
  assert.equal(out.loop.crew.read.mining, 2, 'the crew reads full until the next reading of the files')
  assert.match(out.asked[0], /a mine-crew turn is free/); assert.match(out.asked[1], /MINING: closed for you \(the crew is full or you are resting; short of iron\)/)
  await withMutant(COG_PATH, "          check = { ok: false, reason: 'mine_crew', crew: { ok: false, why: t.why, kind: this.bot.mineCrewPending.kind },\n            detail: crewRefusal({ why: t.why, need: this.crew?.need, held: MINECREW.max, below: !!this.#crewPos()?.below }) }\n", '', async M => {
    const m = await drive(M, { bot: fieldBot(), town: mk(), propose: MINE, ms: 300 })
    assert.ok(m.runs.some(r => r.skill === 'mine'), 'the mutant lets a miner the crew never counted go down')
  })
  await withMutant(COG_PATH, "          if (this.crew?.read) this.crew.read = t.why === 'run_busy' ?", "          if (false) this.crew.read = t.why === 'run_busy' ?", async M => {
    const m = await drive(M, { bot: fieldBot(), town: mk(), propose: MINE, ms: 500 })
    assert.equal(m.loop.crew.read.mining, 0, 'the mutant keeps offering a turn that cannot be taken'); assert.match(m.asked[1], /a mine-crew turn is free/)
  })
})

test('LOOP B2 (review r1), THE BAND: a bot under rock at y 58 (below the grounds\' line 62, above the crew\'s 55) is sent up; its refusal says "come up"; under no roof there it is sent home', async () => {
  const band = () => fieldBot({ at: [10, 58, 10], roof: [60, 68] })
  const out = await drive(COG, { bot: band(), town: mkTown({ grounds: { ok: false, why: 'underground' } }), effect: s => (s === 'crew_up' ? { status: 'no_effect', stop: 'no_stair_walk', detail: 'x' } : null), ms: 200 })
  assert.equal(out.runs[0].skill, 'crew_up', `runs: ${out.runs.map(r => r.skill)}`)
  assert.match(out.of('steer')[0], /^op=steer kind=up why=idle skill=crew_up try=1 y=58 below=1/)
  const hook = out.loop.bot.mineCrewGate
  assert.match(hook('mine', { y: 40 }, {}).detail, /Come up: run surface/)
  assert.match(hook('mine', { y: 57 }, {}).detail, /mine below y=62 is the crew's\)\. Come up: run surface/, 'review r2: a descent INTO the band is the crew\'s too -- judged against the way-up line, never free and then sent up')
  const low = await drive(COG, { bot: fieldBot({ at: [40, 58, 0] }), town: mkTown({ grounds: { ok: false, why: 'underground' } }), ms: 200 })
  assert.equal(low.runs[0].skill, 'home'); assert.match(low.of('steer')[0], /^op=steer kind=home why=low skill=home y=58 below=0/)
  assert.match(low.loop.bot.mineCrewGate('mine', { y: 40 }, {}).detail, /Work at the surface instead: home/, 'no roof: nothing to climb out of')
  await withMutant(COG_PATH, ' upLineY: pos?.upLineY ?? null, roofed:', ' roofed:', async M => {
    const m = await drive(M, { bot: band(), town: mkTown({ grounds: { ok: false, why: 'underground' } }), ms: 200 })
    assert.equal(m.runs.filter(r => r.skill === 'crew_up' || r.skill === 'surface').length, 0, 'the mutant: neither the grounds nor the way up -- the band strands the bot')
  })
})

const RAW = () => ({ items: ['raw_iron'], count: 1, describe: 'Get 1 raw_iron before smelting -- the furnace has nothing to work on.', because: 'smelt has no input' })
test('PREREQUISITES (review r1 B3): one whose every item is an ore or an ore\'s drop the crew refuses the bot is BLOCKED; scaffold, a pickaxe, a mixed list, and an ore the bot may gather are not', () => {
  const closed = view({}), ironTurn = view({ hold: { since: 900, for: 'iron' }, need: open('iron') }), coalOffer = view({ need: open('coal') })
  assert.equal(MC.prereqBlocked(RAW(), closed), true); assert.equal(MC.prereqBlocked({ items: ['raw_copper'] }, ironTurn), true, 'raw copper can never be admitted')
  assert.equal(MC.prereqBlocked({ items: ['iron_ore', 'deepslate_iron_ore', 'raw_iron'] }, closed), true)
  assert.equal(MC.prereqBlocked(RAW(), ironTurn), false, 'its own turn is for iron'); assert.equal(MC.prereqBlocked({ items: ['coal'] }, coalOffer), false); assert.equal(MC.prereqBlocked(RAW(), coalOffer), true)
  for (const items of [['dirt', 'cobblestone'], ['stone_pickaxe', 'wooden_pickaxe'], ['raw_iron', 'iron_ingot'], ['oak_log'], []]) assert.equal(MC.prereqBlocked({ items }, closed), false, String(items))
  assert.equal(MC.prereqBlocked(RAW(), null), false); assert.equal(MC.prereqBlocked(RAW(), { on: false }), false, 'the crew off: every prerequisite as before')
  assert.deepEqual(['raw_iron', 'iron_ore', 'coal', 'raw_copper', 'diamond', 'cobblestone', 'iron_ingot'].map(MC.minedMaterial), ['iron', 'iron', 'coal', 'copper', 'diamond', null, null])
})
test('LOOP B3: `smelt raw_iron` with none held answers "get raw_iron" -- it is NOT adopted (the gate refuses its only means), the steer is not silenced; a scaffold prerequisite still is adopted', async () => {
  const smeltFails = need => (s => (s === 'smelt' ? { status: 'failed', failClass: 'no_input', detail: 'no raw_iron to smelt', need } : null))
  const propose = n => (n === 1 ? { skill: 'smelt', args: { item: 'raw_iron', count: 1 }, reason: 'iron' } : { skill: 'gather', args: { block: 'iron_ore', count: 1 }, reason: 'the task: 1 raw_iron' })
  // the model is asked first because the grounds have nothing (spent) for the first tick, then they open
  const town = mkTown({ grounds: { ok: false, why: 'spent' } })
  const out = await drive(COG, { bot: fieldBot({ ores: [{ name: 'iron_ore', at: [12, 70, 10] }] }), town, effect: smeltFails(RAW()), propose,
    during: async () => { await sleep(100); town.st.grounds = { ok: true, why: null }; await sleep(700) } })
  assert.equal(out.runs[0].skill, 'smelt', `runs: ${out.runs.map(r => r.skill)}`)
  assert.equal(out.loop.prereq, null, 'not adopted')
  assert.deepEqual(out.of('prereq_dropped'), ['op=prereq_dropped items=raw_iron from=smelt when=adopt'], `runs: ${out.runs.map(r => r.skill + JSON.stringify(r.args))} rows: ${out.rows.join(' || ')}`)
  assert.ok(out.asked.every(u => !/TASK: Get 1 raw_iron/.test(u)), 'the refused ore is never the task')
  assert.ok(out.runs.some(isIdle), 'the steer went on: the idle visit was ordered'); assert.ok(out.of('steer').every(d => !/why=prereq/.test(d)))
  const ok = await drive(COG, { bot: fieldBot(), town: mkTown({ grounds: { ok: false, why: 'spent' } }), effect: smeltFails({ items: ['dirt'], count: 8, describe: 'Gather 8 dirt.', because: 'x' }), propose, ms: 400 })
  assert.deepEqual(ok.loop.prereq?.items, ['dirt'], 'the positive control: a prerequisite the bot may meet is adopted'); assert.ok(ok.of('steer').some(d => /why=prereq/.test(d)))
  await withMutant(COG_PATH, "    if (MINECREW.on && prereqBlocked(need, this.bot.mineCrewView)) { this.#crewRow('prereq_dropped', { items: need.items.slice(0, 3).join('|'), from: fromSkill, when: 'adopt' }, 'no_effect'); return }\n", '', async M => {
    const m = await drive(M, { bot: fieldBot(), town: mkTown({ grounds: { ok: false, why: 'spent' } }), effect: smeltFails(RAW()), propose, ms: 400 })
    assert.deepEqual(m.of('prereq_dropped').filter(d => /when=adopt/.test(d)), []); assert.ok(m.asked.some(u => /TASK: Get 1 raw_iron/.test(u)) || m.of('prereq_dropped').some(d => /when=held/.test(d)), 'the mutant adopts it (the tick then has to drop it)')
  })
})
test('LOOP B3: a blocked prerequisite already held (adopted before the crew closed to the bot) is dropped at the next decision', async () => {
  const held = l => { l.prereq = { ...RAW(), since: Date.now(), fromSkill: 'smelt' } }
  const out = await drive(COG, { bot: underRock(), town: mkTown({}), before: held, effect: s => (s === 'crew_up' ? { status: 'no_effect', stop: 'no_stair_walk', detail: 'x' } : null), ms: 250 })
  assert.equal(out.loop.prereq, null); assert.deepEqual(out.of('prereq_dropped'), ['op=prereq_dropped items=raw_iron from=smelt when=held'])
  assert.equal(out.runs[0].skill, 'crew_up', 'and the steer is not silenced by it')
  await withMutant(COG_PATH, "      if (this.prereq && prereqBlocked(this.prereq, bot.mineCrewView)) {", '      if (false) {', async M => {
    const m = await drive(M, { bot: underRock(), town: mkTown({}), before: held, ms: 250 })
    assert.deepEqual(m.loop.prereq?.items, ['raw_iron']); assert.equal(m.runs.filter(r => r.skill === 'crew_up').length, 0, 'the mutant: fifteen minutes of a task the gate refuses, the steer aside')
  })
})

test('LOOP B4 (review r1): only COAL is short and the bot holds the coal turn below ground -- iron ore is refused it with what its turn IS for, never "come up"; its task and its prompt name no iron ore', async () => {
  const bot = underRock({ ores: [{ name: 'iron_ore', at: [12, 16, 10] }, { name: 'coal_ore', at: [13, 16, 10] }] })
  const town = mkTown({ coal: 5 })
  const out = await drive(COG, { bot, town, propose: n => (n === 1 ? { skill: 'mine', args: { y: 10 }, reason: 'take the turn' } : { skill: 'gather', args: { block: 'iron_ore', count: 2 + (n % 3) }, reason: 'iron' }), ms: 700 })
  assert.equal(out.runs[0].skill, 'mine'); assert.equal(town.st.takes[0].meta.for, 'coal')
  assert.equal(out.runs.filter(r => r.skill === 'gather').length, 0)
  assert.ok(out.of('refuse').length >= 1 && out.of('refuse').every(d => /skill=gather why=not_short kind=ore material=iron src=model then=none:crew y=16 below=1 short=coal/.test(d)), String(out.of('refuse')))
  const last = out.asked.at(-1)
  assert.match(last, /MINING: you hold a mine-crew turn for coal \(\d+ min left\): mine with y=16 walks down the town stair; gather coal_ore\./)
  assert.doesNotMatch(last.match(/NEARBY: [^\n]*/)[0] + last.match(/BLOCK CHECKS[^\n]*/)[0], /iron_ore/, 'iron ore is named in neither scan')
  assert.match(last, /NEARBY: [^\n]*coal_ore@/)
  const d = out.loop.bot.mineCrewGate('gather', { block: 'iron_ore', count: 3 }, {}).detail
  assert.match(d, /Your turn is for coal: gather coal_ore, or mine deeper for it\.$/); assert.doesNotMatch(d, /Come up|surface|home/)
  assert.deepEqual(out.loop.bot.mineCrewGate('gather', { block: 'coal_ore', count: 3 }, { dry: true }), { ok: true })
})
test('LOOP B4: the turn is per material -- when the town is no longer short of ITS material the slot closes, though another material is still short', async () => {
  const town = mkTown({ iron: 5, coal: 5, lacking: lacks(), grounds: { ok: false, why: 'full' } })
  const out = await drive(COG, { bot: fieldBot(), town, propose: n => ({ skill: 'gather', args: { block: 'iron_ore', count: 1 + (n % 4) }, reason: 'iron' }),
    during: async loop => { await sleep(200); assert.equal(loop.crew.hold?.for, 'iron'); town.st.stock = stock(300, 5); loop.crew.readAt = -Infinity; await sleep(300) } })
  assert.ok(out.of('closed').some(d => /^op=closed why=no_need slot=1 for=iron/.test(d)), String(out.rows))
  assert.equal(out.loop.crew.need.short.join(), 'coal')
})

test('LOOP C1 (review r1): an open deep trip the crew can no longer count does no more WORK -- between two calls it is put into its own return phase; one that keeps its slot works on', async () => {
  const trip = () => ({ id: 'CrewBot-t1', target: 'iron', phase: 'work', startedAt: Date.now(), calls: 1, trail: [] })
  const far = () => { const b = fieldBot({ at: [400, 70, 400] }); b.deepTrip = trip(); return b }
  const lost = await drive(COG, { bot: far(), town: mkTown({ mining: 2 }), ms: 300 })
  assert.deepEqual([lost.loop.bot.deepTrip.phase, lost.loop.bot.deepTrip.returnWhy], ['return', 'crew_lost'])
  assert.match(lost.of('over')[0], /^op=over trip=CrewBot-t1 phase=work to=return$/)
  assert.ok(lost.runs.length >= 2 && lost.runs.every(r => r.skill === 'deep_mine'), 'never cut: the trip\'s own calls go on (they are return steps now)')
  const kept = await drive(COG, { bot: far(), town: mkTown({}), ms: 300 })
  assert.equal(kept.loop.bot.deepTrip.phase, 'work', 'the positive control'); assert.deepEqual(kept.of('over'), [])
  // a slot it HELD and lost (a long pause: lapsed, retaken by others)
  const t2 = mkTown({})
  const paused = await drive(COG, { bot: far(), town: t2, during: async loop => { await sleep(200); assert.ok(loop.crew.hold?.deep); delete t2.st.slots[1]; t2.st.others = 2; loop.crew.beatAt = -Infinity; await sleep(250) } })
  assert.equal(paused.loop.bot.deepTrip.phase, 'return'); assert.equal(paused.loop.crew.hold, null)
  const b = far(); b.deepTrip.phase = 'bank'
  const banking = await drive(COG, { bot: b, town: mkTown({ mining: 2 }), ms: 200 })
  assert.equal(banking.loop.bot.deepTrip.phase, 'bank', 'a trip already going home is left as it is')
  await withMutant(COG_PATH, "      if (t && ['descend', 'deepen', 'work', 'build'].includes(t.phase)) { t.phase = 'return'; t.returnWhy = 'crew_lost' }\n", '', async M => {
    const m = await drive(M, { bot: far(), town: mkTown({ mining: 2 }), ms: 300 })
    assert.equal(m.loop.bot.deepTrip.phase, 'work', 'the mutant: a fourth miner works on')
  })
  assert.ok(strip(fs.readFileSync(SK_PATH, 'utf8')).includes("trip.phase = 'return'; trip.returnWhy = 'lease_lost'"), 'skills.mjs deepMine no longer turns a trip home by this assignment: #crewDeepRenew must follow it')
})

test('LOOP C2 (review r1): a material run admitted with no slot is WATCHED -- below the crew\'s line it takes slot 3 at once, or stands down', async () => {
  const run = () => ({ order: { skill: 'gather', args: { block: 'coal_ore', count: 16, coalrun: true }, why: 'coal' }, admitted: { skill: 'gather', args: { block: 'coal_ore', count: 16, coalrun: true } } })
  const town = mkTown({}), bot = fieldBot()
  const out = await drive(COG, { bot, town, effect: worked, ms: 150 })
  const loop = out.loop, T = tapCrew()
  try {
    let w = run(), t = loop.crewRunWatchForTest(w.order, w.admitted)
    assert.ok(t, 'watched'); await sleep(150)
    assert.deepEqual([town.st.takes.filter(x => x.run).length, out.cancels.length], [0, 0], 'above the line: nothing')
    bot.entity.position = new Vec3(10, 40, 10); await sleep(150)
    assert.equal(town.st.takes.filter(x => x.run).length, 1); assert.equal(loop.crew.runHold?.slot, 3)
    assert.match(T.of('grant')[0], /^op=grant for=run kind=run slot=3 y=40 late=1$/); assert.equal(out.cancels.length, 0)
    clearInterval(t)
    // slot 3 is another bot's: the run stands down (the runner's own cancel), once
    loop.crew.runHold = null; town.st.run = 'showcase-Other'
    w = run(); t = loop.crewRunWatchForTest(w.order, w.admitted); await sleep(200); clearInterval(t)
    assert.deepEqual(out.cancels, ['minecrew_run']); assert.match(T.of('run_stood_down')[0], /^op=run_stood_down skill=gather block=coal_ore y=40 why=run_busy$/)
    // no watch: not a run, a continuation, a steer order, a bot that holds a slot already
    assert.equal(loop.crewRunWatchForTest({ skill: 'gather', args: { block: 'stone', count: 8 } }, { skill: 'gather', args: { block: 'stone', count: 8 } }), null)
    assert.equal(loop.crewRunWatchForTest({ ...run().order, continuation: true }, run().admitted), null)
    loop.crew.runHold = { slot: 3, gen: 1 }; assert.equal(loop.crewRunWatchForTest(run().order, run().admitted), null); loop.crew.runHold = null
  } finally { T.untap() }
  const cog = strip(fs.readFileSync(COG_PATH, 'utf8'))
  const a = cog.indexOf('const crewWatch = this.#crewRunWatch(order, admitted)'), b = cog.indexOf("const r = await this.runner.run(admitted.skill, admitted.args, { trigger: `llm:${trigger}` })"), c = cog.indexOf('if (crewWatch) clearInterval(crewWatch)')
  assert.ok(a > 0 && b > a && c > b, 'the watch is armed before the run and cleared after it')
  for (const [old, neu, what] of [["          this.runner.cancel?.('minecrew_run')\n", '', 'cancel'], ['          if (!Number.isFinite(y) || y >= lineY || C.runHold || C.hold) return\n', '          if (y !== -999) return\n', 'take']]) {
    await withMutant(COG_PATH, old, neu, async M => {
      const tn = mkTown({ run: what === 'cancel' ? 'showcase-Other' : null }), bt = fieldBot({ at: [10, 40, 10] })
      const o = await drive(M, { bot: bt, town: tn, effect: worked, ms: 100 })
      const tm = o.loop.crewRunWatchForTest(run().order, run().admitted); await sleep(200); clearInterval(tm)
      if (what === 'cancel') assert.deepEqual(o.cancels, [], 'the mutant lets the uncounted run go on below the line')
      else assert.equal(tn.st.takes.filter(x => x.run).length, 0)
    })
  }
})

test('NEED C4 (review r1): an index that has not read for 30 min (TOWNINDEX=off, a file that never opens) opens iron as a town with no stock does -- still only when a bot lacks an iron pickaxe', async () => {
  const unread = { ok: false }
  assert.equal(MC.mineNeed({ stock: unread, lacking: 2, unreadMs: MC.CREW.indexUnreadMs - 1 }).open, false)
  const n = MC.mineNeed({ stock: unread, lacking: 2, unreadMs: MC.CREW.indexUnreadMs })
  assert.deepEqual([n.short, n.why], [['iron'], { iron: 'index_unread_long', coal: 'index_unread' }])
  assert.equal(MC.mineNeed({ stock: unread, lacking: 0, unreadMs: 10 * MC.CREW.indexUnreadMs }).why.iron, 'no_one_lacks')
  assert.equal(MC.mineNeed({ stock: stock(200, 200), lacking: 2, unreadMs: 10 * MC.CREW.indexUnreadMs }).open, false, 'a reading index is believed whatever the clock says')
  await withMutant(MC_PATH, '    if (!stock?.ok && Number(unreadMs) >= T.indexUnreadMs) {\n', '    if (false) {\n', async M => {
    assert.equal(M.mineNeed({ stock: unread, lacking: 2, unreadMs: 10 * MC.CREW.indexUnreadMs }).open, false, 'the mutant: mining closed for good where the index is off')
  })
  // through the loop: the clock runs from the loop's first decision (or the last good read)
  const town = mkTown({ lacking: lacks(), grounds: { ok: false, why: 'full' } }); town.st.stock = MC.crewStock(null)
  const out = await drive(COG, { bot: fieldBot(), town, during: async loop => { await sleep(150); assert.equal(loop.crew.need.open, false, 'unread a moment: closed'); loop.crew.t0 = Date.now() - MC.CREW.indexUnreadMs - 1; loop.crew.readAt = -Infinity; await sleep(200) } })
  assert.deepEqual([out.loop.crew.need.short, out.loop.crew.need.why.iron], [['iron'], 'index_unread_long'])
  await withMutant(COG_PATH, 'unreadMs: now - (C.stockOkAt ?? C.t0), noFuelMs:', 'unreadMs: 0, noFuelMs:', async M => {
    const tn = mkTown({ lacking: lacks(), grounds: { ok: false, why: 'full' } }); tn.st.stock = MC.crewStock(null)
    const m = await drive(M, { bot: fieldBot(), town: tn, during: async loop => { await sleep(150); loop.crew.t0 = Date.now() - MC.CREW.indexUnreadMs - 1; loop.crew.readAt = -Infinity; await sleep(200) } })
    assert.equal(m.loop.crew.need.open, false)
  })
})

test('RESTART (review r1): a bot\'s rest from the crew and the need\'s hysteresis are kept in its own census line and read back by a new loop', async () => {
  const dir = path.join(tmp, `census${dseq++}`)
  assert.deepEqual(IO.censusOwn('A', { dir }), { restUntil: 0, was: {} })
  IO.censusWrite('A', true, { dir, now: 5, keep: { restUntil: 99_000, was: { iron: true, coal: false } } })
  assert.deepEqual(IO.censusOwn('A', { dir }), { restUntil: 99_000, was: { iron: true } })
  assert.deepEqual(IO.censusRead({ dir }), [{ holder: 'A', at: 5, ironPick: 1 }], 'the census line itself is what it was')
  IO.censusWrite('A', false, { dir, now: 6 }); assert.deepEqual(IO.censusOwn('A', { dir }), { restUntil: 0, was: {} })
  // the rest: a restarted bot still rests (the town short, a slot free: without the kept line it would be offered the turn)
  const resting = mkTown({ iron: 5, lacking: lacks(), grounds: { ok: false, why: 'full' }, own: { restUntil: Date.now() + 600_000, was: {} } })
  const a = await drive(COG, { bot: fieldBot(), town: resting, propose: MINE, ms: 300 })
  assert.match(a.asked[0], /MINING: closed for you \(the crew is full or you are resting; short of iron\)/); assert.match(a.of('refuse')[0], /why=resting/); assert.deepEqual(resting.st.takes, [])
  // the hysteresis: 30 iron is between the floor and the ceiling -- open only because it WAS open before the restart
  const was = mkTown({ iron: 30, lacking: lacks(), grounds: { ok: false, why: 'full' }, own: { restUntil: 0, was: { iron: true } } })
  const b = await drive(COG, { bot: fieldBot(), town: was, ms: 200 })
  assert.deepEqual([b.loop.crew.need.short, b.loop.crew.need.why.iron], [['iron'], 'refilling'])
  const fresh = await drive(COG, { bot: fieldBot(), town: mkTown({ iron: 30, lacking: lacks(), grounds: { ok: false, why: 'full' } }), ms: 200 })
  assert.equal(fresh.loop.crew.need.open, false, 'the positive control: with nothing kept, 30 iron reads stocked')
  assert.ok(was.st.kept.length >= 1 && was.st.kept.at(-1).was.iron === true, 'and it is written back')
  await withMutant(COG_PATH, 'restUntil: Number(own?.restUntil) || 0, steer: {},', 'restUntil: 0, steer: {},', async M => {
    const m = await drive(M, { bot: fieldBot(), town: mkTown({ iron: 5, lacking: lacks(), grounds: { ok: false, why: 'full' }, own: { restUntil: Date.now() + 600_000, was: {} } }), propose: MINE, ms: 300 })
    assert.ok(m.runs.some(r => r.skill === 'mine'), 'the mutant forgets the rest at a restart')
  })
  await withMutant(COG_PATH, 'was: { ...(own?.was ?? {}) }, stock: null', 'was: {}, stock: null', async M => {
    const m = await drive(M, { bot: fieldBot(), town: mkTown({ iron: 30, lacking: lacks(), grounds: { ok: false, why: 'full' }, own: { restUntil: 0, was: { iron: true } } }), ms: 200 })
    assert.equal(m.loop.crew.need.open, false)
  })
})

test('LOOP (review r1): a holder whose admitted `mine` keeps failing at the surface does not hold the slot for its whole term -- three such runs, the slot is let go and the bot rests', async () => {
  const failing = s => (s === 'mine' ? { status: 'failed', failClass: 'no_path', detail: 'no way down here' } : null)
  const town = mkTown({ iron: 5, lacking: lacks(), grounds: { ok: false, why: 'full' } })
  const out = await drive(COG, { bot: fieldBot(), town, effect: failing, propose: n => ({ skill: 'mine', args: { y: 16 - (n % 9) }, reason: 'iron' }), ms: 900 })
  assert.equal(out.runs.filter(r => r.skill === 'mine').length, 3, `runs: ${out.runs.map(r => r.skill)}`)
  assert.deepEqual(out.of('release').map(d => d.replace(/ age_min=\d+/, '')), ['op=release why=no_descent slot=1 for=iron'])
  assert.ok(out.loop.crew.restUntil > Date.now() + MC.CREW.restMs - 5000); assert.ok(town.st.kept.some(k => k.restUntil > Date.now()), 'the rest is written to its census line')
  assert.equal(town.st.takes.filter(t => !t.again).length, 1, 'it does not take the slot again at once'); assert.ok(out.of('refuse').some(d => /why=resting/.test(d)))
  const works = await drive(COG, { bot: fieldBot(), town: mkTown({ iron: 5, lacking: lacks(), grounds: { ok: false, why: 'full' } }), propose: n => ({ skill: 'mine', args: { y: 16 - (n % 9) }, reason: 'iron' }), ms: 250 })
  assert.deepEqual(works.of('release'), [], 'the positive control: a mine that succeeds keeps its turn')
  await withMutant(COG_PATH, "        else if ((C.hold.fails = (C.hold.fails ?? 0) + 1) >= CREW.holderFails) {", '        else if (false) {', async M => {
    const m = await drive(M, { bot: fieldBot(), town: mkTown({ iron: 5, lacking: lacks(), grounds: { ok: false, why: 'full' } }), effect: failing, propose: n => ({ skill: 'mine', args: { y: 16 - (n % 9) }, reason: 'iron' }), ms: 900 })
    assert.ok(m.runs.filter(r => r.skill === 'mine').length >= 5 && m.of('release').length === 0, 'the mutant holds the slot at the surface for as long as it keeps proposing')
  })
})
test('LOOP (review r1): a FAILED idle visit puts no cooldown on `build_shop` -- the key is the bot\'s real build order\'s too', async () => {
  const failed = s => (s === 'build_shop' ? { status: 'failed', failClass: 'other', detail: 'visit failed' } : null)
  const out = await drive(COG, { bot: fieldBot(), town: mkTown({}), effect: failed, ms: 250 })
  assert.ok(out.runs.some(isIdle)); assert.equal(out.loop.admission.memoryRefuses('build_shop', {}), null)
  await withMutant(COG_PATH, "      } else if (r.status === 'failed') {\n        if (!order?.crewSteer) this.admission.noteFailure(admitted.skill, admitted.args)", "      } else if (r.status === 'failed') {\n        this.admission.noteFailure(admitted.skill, admitted.args)", async M => {
    const m = await drive(M, { bot: fieldBot(), town: mkTown({}), effect: failed, ms: 250 })
    assert.equal(m.loop.admission.memoryRefuses('build_shop', {}), 'cooldown')
  })
})

test('LOOP, THE JITTER\'S WIRING (review r1 gap): the first UNFORCED way-up order waits the bot\'s share; a refusal\'s forced steer does not (C3)', async () => {
  const quiet = await drive(COG, { bot: underRock(), town: mkTown({ jitter: 60_000 }), ms: 450 })
  assert.equal(quiet.runs.filter(r => r.skill === 'crew_up' || r.skill === 'surface').length, 0, `runs: ${quiet.runs.map(r => r.skill)}`)
  assert.ok((quiet.loop.crew.tally.jitter ?? 0) >= 2); assert.ok(quiet.of('steer').some(d => /^op=steer kind=none why=jitter/.test(d)))
  const forced = await drive(COG, { bot: underRock(), town: mkTown({ jitter: 60_000 }), effect: s => (s === 'crew_up' ? { status: 'no_effect', stop: 'no_stair_walk', detail: 'x' } : null), propose: () => ({ skill: 'mine', args: { y: 10 }, reason: 'deeper' }), ms: 450 })
  assert.match(forced.of('refuse')[0], / then=crew_up /); assert.equal(forced.runs[0].skill, 'crew_up', 'a refused bot gets its way up NOW')
  assert.match(forced.of('steer').find(d => /kind=up/.test(d)), /why=forced skill=crew_up/)
  await withMutant(COG_PATH, 'jitterMs: this.#crewJitter() })', 'jitterMs: 0 })', async M => {
    const m = await drive(M, { bot: underRock(), town: mkTown({ jitter: 60_000 }), effect: s => (s === 'crew_up' ? { status: 'no_effect', stop: 'no_stair_walk', detail: 'x' } : null), ms: 300 })
    assert.equal(m.runs[0]?.skill, 'crew_up', 'the mutant: every bot is ordered up at the first tick -- the deploy herd')
  })
})
const goesDown = (s, _a, b) => { if (s === 'mine') { b.entity.position = new Vec3(10, 16, 10); b.blockAt = p => (p.y >= 20 && p.y <= 60 ? { name: 'stone', boundingBox: 'block' } : { name: 'air', boundingBox: 'empty' }) } return null }
const firstMine = n => (n === 1 ? MINE() : { skill: 'gather', args: { block: 'stone', count: 1 + (n % 5) }, reason: 's' })
const shortTown = (o = {}) => mkTown({ iron: 5, lacking: lacks(), grounds: { ok: false, why: 'full' }, ...o })
test('LOOP, THE HOLDER\'S HEARTBEAT (review r1 gap): below the line its slot is renewed on the heartbeat, with no mining proposal at all; a slot it finds gone is `expired`', async () => {
  const town = shortTown()
  const out = await drive(COG, { bot: fieldBot(), town, effect: goesDown, propose: firstMine, ms: 700 })
  assert.ok(town.st.renews >= 2, `renews: ${town.st.renews}`); assert.ok(out.loop.crew.hold, 'still its turn'); assert.deepEqual(out.of('release'), [])
  const t2 = shortTown()
  const gone = await drive(COG, { bot: fieldBot(), town: t2, effect: goesDown, propose: firstMine, during: async loop => { await sleep(250); assert.ok(loop.crew.hold); delete t2.st.slots[1]; await sleep(350) } })
  assert.match(gone.of('expired')[0], /^op=expired slot=1 for=iron$/); assert.equal(gone.loop.crew.hold, null)
  await withMutant(COG_PATH, '          if (now - C.beatAt >= CREW.heartbeatMs) {', '          if (false) {', async M => {
    const tn = shortTown()
    await drive(M, { bot: fieldBot(), town: tn, effect: goesDown, propose: firstMine, ms: 700 })
    assert.equal(tn.st.renews, 0, 'the mutant never renews: the slot would lapse under a working miner')
  })
})
test('LOOP, THE `up` RELEASE (review r1 gap): a holder that stays above the way-up line gives its slot back; one below keeps it', async () => {
  const town = shortTown()
  const out = await drive(COG, { bot: fieldBot(), town, propose: n => (n === 1 ? MINE() : { skill: 'status', args: {}, reason: 's' }), ms: 900 })
  assert.deepEqual(out.of('release').map(d => d.replace(/ age_min=\d+/, '')), ['op=release why=up slot=1 for=iron']); assert.equal(Object.keys(town.st.slots).length, 0)
  await withMutant(COG_PATH, "          if (now - C.aboveSince >= CREW.upAfterMs) this.#crewDrop('up')\n", '', async M => {
    const tn = shortTown()
    const m = await drive(M, { bot: fieldBot(), town: tn, propose: n => (n === 1 ? MINE() : { skill: 'status', args: {}, reason: 's' }), ms: 900 })
    assert.deepEqual(m.of('release'), []); assert.equal(Object.keys(tn.st.slots).length, 1)
  })
})
test('LOOP, A RESTART (review r1 gap): a slot of this bot\'s own that the new loop does not know is ADOPTED with its term; a material run\'s is let go (`stale_run`); the read finds a lost one `expired`', async () => {
  const mine = (meta, k = 1) => { const t = shortTown(); t.st.slots[k] = { holder: 'CrewBot', gen: 5, at: Date.now(), meta }; return t }
  const town = mine({ since: Date.now() - 10 * 60_000, for: 'iron' })
  const out = await drive(COG, { bot: underRock(), town, ms: 250 })
  assert.match(out.asked[0], /MINING: you hold a mine-crew turn for iron \(30 min left\)/); assert.deepEqual(town.st.takes, [], 'adopted, not taken again')
  assert.equal(out.runs.filter(r => r.skill === 'crew_up').length, 0, 'a holder is not sent up')
  const t3 = mine({ since: Date.now(), for: 'run', run: true }, 3)
  const stale = await drive(COG, { bot: fieldBot(), town: t3, ms: 250 })
  assert.deepEqual(stale.of('release').map(d => d.replace(/ age_min=\d+/, '')), ['op=release why=stale_run slot=3 for=run']); assert.equal(t3.st.slots[3], undefined); assert.equal(stale.loop.crew.hold, null)
  const t4 = shortTown()
  const lost = await drive(COG, { bot: fieldBot(), town: t4, effect: goesDown, propose: firstMine, before: () => {}, during: async loop => { await sleep(150); assert.ok(loop.crew.hold); loop.crew.beatAt = Date.now() + 60_000; delete t4.st.slots[1]; loop.crew.readAt = -Infinity; await sleep(250) } })
  assert.match(lost.of('expired')[0], /^op=expired slot=1 for=iron$/); assert.equal(lost.loop.crew.hold, null)
  await withMutant(COG_PATH, '        if (!C.hold && C.read?.mine) {', '        if (false) {', async M => {
    const m = await drive(M, { bot: underRock(), town: mine({ since: Date.now() - 10 * 60_000, for: 'iron' }), ms: 250 })
    assert.doesNotMatch(m.asked[0] ?? '', /you hold a mine-crew turn/); assert.equal(m.loop.crew.hold, null)
  })
  await withMutant(COG_PATH, "          if (m.run === true) this.#crewDrop('stale_run')\n", '', async M => {
    const tn = mine({ since: Date.now(), for: 'run', run: true }, 3)
    const m = await drive(M, { bot: fieldBot(), town: tn, ms: 250 })
    assert.equal(m.of('release').filter(d => /stale_run/.test(d)).length, 0); assert.ok(tn.st.slots[3], 'the mutant keeps a dead run\'s slot 3 held')
  })
  await withMutant(COG_PATH, "        } else if (C.hold && C.read?.ok && !C.read.mine) { this.#crewRow('expired', { slot: C.hold.slot, for: C.hold.for }, 'no_effect'); C.hold = null }", '        }', async M => {
    const tn = shortTown()
    const m = await drive(M, { bot: fieldBot(), town: tn, effect: goesDown, propose: firstMine, during: async loop => { await sleep(150); loop.crew.beatAt = Date.now() + 60_000; delete tn.st.slots[1]; loop.crew.readAt = -Infinity; await sleep(250) } })
    assert.ok(m.loop.crew.hold, 'the mutant goes on believing in a slot it lost')
  })
})
test('LOOP, A DISPLACED STEER ORDER (review r1 gap): a safety order that takes the tick gives the steer\'s rhythm back and leaves the build order\'s clock as it was', async () => {
  const inColumn = () => { const b = fieldBot(); b.fireSitesNow = () => [{ kind: 'death:fire', x: 10, y: 62, z: 10, count: 4, deaths: 1, last: Date.now(), by: ['x'] }]; b.keepoutYields = () => false; return b }
  const shop = l => { l.shopState = { lastAt: 777, lastStop: 'complete' } }
  const out = await drive(COG, { bot: inColumn(), town: mkTown({}), effect: worked, before: shop, ms: 400 })
  assert.ok(out.runs.length >= 2 && out.runs.every(r => r.skill === 'keepout_exit'), `runs: ${out.runs.map(r => r.skill)}`)
  assert.ok(out.of('steer').filter(d => /kind=grounds/.test(d)).length >= 2, 'the steer issued its order at every tick (never waiting a rhythm it did not use)')
  assert.equal(out.loop.crew.steer.idleAt, -Infinity); assert.deepEqual(out.loop.shopState, { lastAt: 777, lastStop: 'complete' })
  await withMutant(COG_PATH, '    if (crewSteer0 && order !== crewSteer0) { this.#crewSteerDisplaced(crewSteer0); this.shopState = crewShop0 }\n', '', async M => {
    const m = await drive(M, { bot: inColumn(), town: mkTown({}), effect: worked, before: shop, ms: 400 })
    assert.ok(Number.isFinite(m.loop.crew.steer.idleAt), 'the mutant charges the rhythm for an order that never ran')
  })
})
test('REAL FILES (review r1 gap): crewStockNow folds the town index on disk; crewBuildBusy reads the town mine\'s build lease', () => {
  const dir = path.join(tmp, `town${dseq++}`), home = { x: 0, y: 70, z: 0 }, hk = TI.indexHomeKey(home), bot = { worldId: 'W1' }
  assert.deepEqual(IO.crewStockNow(bot, { dir, home, now: 30 }), { ok: true, containers: 0, have: { iron: 0, coal: 0 }, obsidian: null, stale: 0 }, 'no index yet: a town with no container')
  const O = (k, at, names, w = 'W1') => TI.appendIndex(dir, hk, w, { t: 'obs', k, at, id: `o${at}`, h: [k], size: 27, used: 1, names })
  assert.ok(O('a', 10, { iron_ingot: [30, 1], coal: [7, 1] })); assert.ok(O('b', 11, { raw_iron: [4, 1], obsidian: [2, 1], iron_block: [1, 1] })); assert.ok(O('c', 12, { iron_ingot: [999, 16] }, 'W2'))
  assert.deepEqual(IO.crewStockNow(bot, { dir, home, now: 30 }), { ok: true, containers: 2, have: { iron: 43, coal: 7 }, obsidian: 2, stale: 0 })
  assert.deepEqual(IO.crewStockNow(bot, { dir, home, now: 30 + MC.CREW.stockFreshMs }).have, { iron: 0, coal: 0 }, 'review r3: the same files 6 h on -- nothing seen since counts as stock')
  assert.ok(O('a', 20, { coal: [40, 1] })); assert.deepEqual(IO.crewStockNow(bot, { dir, home, now: 30 }).have, { iron: 13, coal: 40 }, 'a container\'s LATEST observation')
  assert.deepEqual(MC.mineNeed({ stock: IO.crewStockNow(bot, { dir, home, now: 30 }), lacking: 1 }).short, ['iron'])
  const now = 1_000_000, key = BP.projKey(home, DM.MINE_BUILD_PLOT)
  assert.equal(IO.crewBuildBusy('Me', { dir, home, now }), false, 'no lease: free')
  const l = BP.takeSlot(dir, key, 'Other', 1, { now, ttl: DM.LEASE_TTL_MS })
  assert.equal(l.ok, true); assert.equal(IO.crewBuildBusy('Me', { dir, home, now: now + 1000 }), true); assert.equal(IO.crewBuildBusy('Other', { dir, home, now: now + 1000 }), false, 'the builder itself is not "another"')
  assert.equal(IO.crewBuildBusy('Me', { dir, home, now: now + DM.LEASE_TTL_MS + 61_000 }), false, 'lapsed past its reclaim')
  BP.releaseLease(dir, key, 'slot1', 'Other', l.gen); assert.equal(IO.crewBuildBusy('Me', { dir, home, now: now + 2000 }), false)
})
test('LOOP WITH THE NEIGHBOURS ON (review r1 gap: vetoskip, continue and the pipeline\'s prefetch at their production defaults): the steer still orders the grounds, mining never runs, and the refusals stay at the cooldown\'s pace', async () => {
  const fewer = FD.fewerDecConfig({ FEWERDEC_VETOSKIP_DELAY_MS: '150' })
  assert.equal(fewer.cont && fewer.vetoSkip && fewer.pauseWait, true)
  const pipe = PL.pipelineConfig({ PIPELINE: 'on', PIPELINE_NEXT_DELAY_MS: '60', PIPELINE_MIN_RUN_MS: '0', PIPELINE_MAX_PER_MIN: '1000' })
  const slowWorked = async (s, a, b) => { await sleep(60); return worked(s, a, b) }
  const propose = n => (n % 3 === 0 ? { skill: 'gather', args: { block: 'dirt', count: 1 + (n % 5) }, reason: 'd' } : MINE())
  const out = await drive(COG, { bot: fieldBot(), town: mkTown({}), effect: slowWorked, propose, fewer, pipe, cooldown: 300, latency: 20, ms: 3000 })
  assert.equal(out.runs.filter(r => r.skill === 'mine').length, 0, `runs: ${out.runs.map(r => r.skill)}`)
  assert.ok(out.runs.filter(isIdle).length >= 4, `idle visits: ${out.runs.filter(isIdle).length}`)
  assert.ok(out.of('refuse').every(d => / then=(build_shop|none:\w+) /.test(d)))
  assert.ok(out.of('refuse').length <= out.runs.filter(isIdle).length + 2, `every refusal is followed by the steer's visit: ${out.of('refuse').length} refusals, ${out.runs.filter(isIdle).length} visits`)
  const spent = await drive(COG, { bot: fieldBot(), town: mkTown({ grounds: { ok: false, why: 'spent' } }), effect: slowWorked, propose: MINE, fewer, pipe, cooldown: 300, latency: 20, ms: 2400 })
  assert.ok(spent.of('refuse').length >= 2 && spent.of('refuse').length <= 8, `nothing to order, every neighbour on: ${spent.of('refuse').length} refusals in 2.4 s`)
  assert.equal(spent.runs.filter(r => r.skill === 'mine').length, 0)
})

// ================================================================= REVIEW ROUND 2
const UPL = 62   // HOME_Y 70 - 8: the way-up line
test('KIND R1 (review r2), ONE LINE FOR `mine` AND THE WAY UP: a descent that ends below the WAY-UP line (home - 8) is the crew\'s; one that ends at it is free; the refusal and the MINING line name that line', async () => {
  assert.deepEqual(MC.crewKind('mine', { y: 58 }, { y: 70, lineY: LINE, upLineY: UPL }), { kind: 'mine', material: null, target: 58, line: UPL })
  for (const y of [61, 60, 57, 56, 55, 54, 16]) assert.equal(MC.crewKind('mine', { y }, { y: 70, lineY: LINE, upLineY: UPL })?.kind, 'mine', `mine to y=${y}`)
  assert.equal(MC.crewKind('mine', { y: 62 }, { y: 70, lineY: LINE, upLineY: UPL }), null, 'at the way-up line is not below it')
  assert.equal(MC.crewKind('mine', { y: 70 }, { y: 200, lineY: LINE, upLineY: UPL }), null, 'a bot stranded high still mines down to the ground')
  assert.equal(MC.crewKind('mine', { y: 58 }, { y: 70, lineY: LINE }), null, 'the positive control: against the crew\'s line alone y=58 is free (the band)')
  assert.equal(MC.crewKind('mine', { y: 63 }, { y: 70, lineY: 65, upLineY: UPL }).line, 65, 'MINECREW_Y above the way-up line: the higher line limits')
  assert.equal(MC.crewKind('gather', { block: 'deepslate_coal_ore' }, { lineY: LINE, upLineY: UPL, fromOrder: true }).kind, 'run', 'a material run is untouched')
  const kind = MC.crewKind('mine', { y: 58 }, { y: 70, lineY: LINE, upLineY: UPL })
  const text = MC.crewRefusal({ why: 'no_need', kind, below: false })
  assert.match(text, /^mining is a town crew job: the town is not short of anything mined \(mine below y=62 is the crew's\)\. Work at the surface instead/); assert.ok(text.length < 300)
  assert.match(MC.miningLine(view({ lineY: UPL })), /Do not choose mine to go underground \(below y=62\), or gather an ore/)
  assert.doesNotMatch(MC.crewRefusal({ why: 'not_short', kind: { kind: 'ore', material: 'iron' }, need: open('coal'), hold: { since: 0, for: 'coal' } }), /y=/, 'a holder is not named a line')
  await withMutant(MC_PATH, '    const line = Number.isFinite(upLineY) ? Math.max(lineY, upLineY) : lineY\n', '    const line = lineY\n', async M => {
    assert.equal(M.crewKind('mine', { y: 58 }, { y: 70, lineY: LINE, upLineY: UPL }), null, 'the mutant: the band is free again')
  })
})
test('LOOP R1 (review r2), NO PING-PONG: a model that keeps choosing `mine` to y 56..60 from the surface is refused every time -- no descent, no way-up run, nothing dug under the town', async () => {
  const roofed = () => fieldBot({ at: [10, 70, 10], roof: [60, 66] })
  const eff = (s, a, b) => { if (s === 'mine') b.entity.position.y = Number(a.y); if (s === 'crew_up' || s === 'surface' || s === 'home') b.entity.position.y = 70; if (s === 'build_shop') b.tidyLast = { placed: 2, cleared: 1, outcome: 'deadline' }; return null }
  const ys = [58, 60, 57, 59, 56]; let i = 0
  const out = await drive(COG, { bot: roofed(), town: mkTown({}), effect: eff, propose: () => ({ skill: 'mine', args: { y: ys[i++ % ys.length] }, reason: 'stone' }), cooldown: 120, ms: 1500 })
  const n = k => out.runs.filter(r => r.skill === k).length
  assert.deepEqual([n('mine'), n('crew_up'), n('surface')], [0, 0, 0], `runs: ${out.runs.map(r => r.skill)}`)
  assert.ok(out.of('refuse').length >= 3, `refusals: ${out.of('refuse').length}`)
  assert.ok(out.of('refuse').every(d => / skill=mine why=no_need kind=mine /.test(d)), out.of('refuse')[0])
  assert.match(out.asked.find(u => /rejected: mine_crew/.test(u)) ?? '', /mine below y=62 is the crew's/, 'the model is told the line')
  assert.match(out.asked[0], /MINING: closed for you [^\n]*\(below y=62\)/, 'the MINING line names the same line')
  assert.equal(out.loop.bot.mineCrewGate('mine', { y: 62 }, {}), null, 'a descent that ends AT the line is free')
  let j = 0
  await withMutant(COG_PATH, ' upLineY: pos?.upLineY ?? crewUpLineOf(config.world.homeY), fromOrder })', ' fromOrder })', async M => {
    const m = await drive(M, { bot: roofed(), town: mkTown({}), effect: eff, propose: () => ({ skill: 'mine', args: { y: ys[j++ % ys.length] }, reason: 'stone' }), cooldown: 120, ms: 1500 })
    const c = k => m.runs.filter(r => r.skill === k).length
    assert.ok(c('mine') >= 2 && c('crew_up') >= 1 && m.of('refuse').length === 0, `the mutant: mine, way up, mine, ... with no refusal: ${m.runs.map(r => r.skill)}`)
  })
})
test('STEER R1 (review r2): the deploy jitter counts from the SPAWN, not from the first time the bot is under rock', async () => {
  const late = MC.crewSteer({ on: true, y: 16, lineY: LINE, roofed: true, distHome: 10, now: 5_000_000, state: {}, jitterMs: 60_000, jitterFrom: 1_000_000 })
  assert.deepEqual([late.kind, late.order?.skill, late.state.upNotBefore], ['up', 'crew_up', 1_060_000], 'an hour after the spawn there is no herd to spread')
  assert.equal(MC.crewSteer({ on: true, y: 16, lineY: LINE, roofed: true, distHome: 10, now: 1_059_999, state: {}, jitterMs: 60_000, jitterFrom: 1_000_000 }).why, 'jitter', 'inside its share of the deploy hour it waits')
  await withMutant(MC_PATH, 's.upNotBefore = (Number.isFinite(jitterFrom) ? jitterFrom : now) + Math.max', 's.upNotBefore = now + Math.max', async M => {
    assert.equal(M.crewSteer({ on: true, y: 16, lineY: LINE, roofed: true, distHome: 10, now: 5_000_000, state: {}, jitterMs: 60_000, jitterFrom: 1_000_000 }).why, 'jitter')
  })
  // through the loop: a bot whose spawn is a jitter share ago, under rock for the first time now
  const first = async M => drive(M, { bot: underRock(), town: mkTown({ jitter: 60_000 }), effect: s => (s === 'crew_up' ? { status: 'no_effect', stop: 'no_stair_walk', detail: 'x' } : null),
    during: async loop => { await sleep(120); assert.equal(loop.crew.tally.jitter >= 1, true, 'just spawned: it waits its share'); loop.crew.t0 = Date.now() - 60_001; loop.crew.steer = {}; await sleep(250) } })
  const out = await first(COG)
  assert.ok(out.runs.some(r => r.skill === 'crew_up'), `runs: ${out.runs.map(r => r.skill)}`)
  await withMutant(COG_PATH, ' jitterFrom: C.t0, jitterMs: this.#crewJitter() })', ' jitterMs: this.#crewJitter() })', async M => {
    assert.equal((await first(M)).runs.filter(r => r.skill === 'crew_up').length, 0, 'the mutant: the share starts again at the first time under rock')
  })
})
test('STEER R2 (review r2): the way up is not held by the REPEAT WINDOW (a cooldown still holds it; the grounds order is held as before -- the home order: STEER R3)', async () => {
  const rep = () => 'repeat_loop'
  let s = { upNotBefore: 0 }
  for (let i = 0; i < 3; i++) s = MC.steerAfter(s, { kind: 'up', skill: 'crew_up', arrived: false, now: 1000 })
  const c = steer({ y: 16, roofed: true, state: s, now: 2000, refuses: rep })
  assert.deepEqual([c.kind, c.order?.skill, c.why], ['up', 'surface', 'climb'], 'the owed climb, with the window full of the model\'s own `surface`')
  assert.equal(steer({ y: 16, roofed: true, state: { upNotBefore: 0 }, refuses: rep }).order?.skill, 'crew_up')
  assert.equal(steer({ y: 16, roofed: true, state: s, now: 2000, refuses: () => 'cooldown' }).why, 'memory', 'a cooldown expires: it holds')
  assert.equal(steer({ refuses: rep }).why, 'memory', 'the positive control: the grounds order is the window\'s')
  await withMutant(MC_PATH, "return !!m && m !== 'repeat_loop' } catch { return true } }", 'return !!m } catch { return true } }', async M => {
    assert.equal(M.crewSteer({ on: true, y: 16, lineY: LINE, roofed: true, distHome: 10, now: 2000, state: s, refuses: rep }).why, 'memory', 'the mutant: none:memory for good')
  })
})
test('LOOP R2 (review r2): four model-chosen `surface` in the repeat window do not suppress the stair fallback -- three `crew_up` that do not arrive, then the ONE owed `surface` runs', async () => {
  const stuck = s => (s === 'crew_up' ? { status: 'no_effect', stop: 'no_stair_walk', detail: 'x' } : s === 'surface' ? { status: 'no_effect', stop: 'no_progress', detail: 'x' } : null)
  const full = loop => { const k = loop.admission.constructor.key('surface', {}); loop.admission.recent = [k, k, k, k] }
  const out = await drive(COG, { bot: underRock(), town: mkTown({}), effect: stuck, before: full, ms: 700 })
  assert.deepEqual(out.runs.map(r => r.skill).slice(0, 4), ['crew_up', 'crew_up', 'crew_up', 'surface'], `runs: ${out.runs.map(r => r.skill)}`)
  assert.equal(out.runs.filter(r => r.skill === 'surface').length, 1, 'one climb for the back-off'); assert.equal(out.loop.crew.steer.upClimbOwed, false)
  assert.equal(out.loop.admission.memoryRefuses('surface', {}), 'repeat_loop', 'the positive control: the window IS full for anyone else')
  assert.equal(out.loop.admission.check({ skill: 'surface', args: {}, reason: 'x' }, out.loop.bot, null).reason, 'repeat_loop', '...and the model\'s own `surface` is still refused by it')
  await withMutant(COG_PATH, "      this.admission.crewWayUp = MINECREW.on && order?.crewSteer === 'up'", '      this.admission.crewWayUp = false', async M => {
    const m = await drive(M, { bot: underRock(), town: mkTown({}), effect: stuck, before: full, ms: 700 })
    assert.equal(m.runs.filter(r => r.skill === 'surface').length, 0, `the mutant: the gate refuses the owed climb for good: ${m.runs.map(r => r.skill)}`)
    assert.equal(m.loop.crew.steer.upClimbOwed, true)
  })
})
test('LOOP R2, THE RESCUE: under rock below the way-up line with no turn for CREW.strandedMs, the crew\'s refusals count for the livelock breaker again; before that, and at the surface, never', async () => {
  assert.equal(MC.CREW.strandedMs, 2 * MC.CREW.upBackoffMs, 'two back-offs')
  const prereq = l => { l.prereq = { items: ['dirt'], count: 8, since: Date.now(), fromSkill: 'surface', describe: 'Gather 8 dirt.', because: 'x' } }
  const deeper = () => ({ skill: 'mine', args: { y: 10 }, reason: 'deeper' })
  const long = async (M, bot) => drive(M, { bot, town: mkTown({ grounds: { ok: false, why: 'spent' } }), before: prereq, propose: deeper, cooldown: 100,
    during: async loop => { await sleep(150); loop.crew.belowSince = loop.crew.belowSince == null ? null : Date.now() - MC.CREW.strandedMs - 1; await sleep(700) } })
  const out = await long(COG, underRock())
  assert.ok(out.loop.consecutiveRejections >= 3 || out.all.some(r => /livelock/.test(String(r?.skill?.name))), `stranded: the breaker is asked (count ${out.loop.consecutiveRejections})`)
  const up = await long(COG, fieldBot())
  assert.equal(up.loop.crew.belowSince, null, 'at the surface nothing is counted'); assert.equal(up.loop.consecutiveRejections ?? 0, 0)
  assert.deepEqual(up.all.filter(r => /livelock/.test(String(r?.skill?.name))), [])
  const fresh = await drive(COG, { bot: underRock(), town: mkTown({}), before: prereq, propose: deeper, cooldown: 100, ms: 700 })
  assert.ok(Number.isFinite(fresh.loop.crew.belowSince), 'under rock the clock runs'); assert.equal(fresh.loop.consecutiveRejections ?? 0, 0, 'inside the bound the way up is the remedy, not the breaker')
  await withMutant(COG_PATH, " && rejection?.reason === 'mine_crew' && !this.#crewStranded()\n", " && rejection?.reason === 'mine_crew'\n", async M => {
    const m = await long(M, underRock())
    assert.equal(m.loop.consecutiveRejections ?? 0, 0, 'the mutant: no rescue ever sees the bot'); assert.deepEqual(m.all.filter(r => /livelock/.test(String(r?.skill?.name))), [])
  })
})
test('LOOP (review r2, minor): a crew refusal does not enter the breaker on a count that OTHER rejections left at 3', async () => {
  const three = l => { l.consecutiveRejections = 3 }
  const out = await drive(COG, { bot: fieldBot(), town: mkTown({ grounds: { ok: false, why: 'spent' } }), before: three, propose: MINE, cooldown: 100, ms: 600 })
  assert.ok(out.of('refuse').length >= 2); assert.equal(out.loop.consecutiveRejections, 3)
  assert.deepEqual(out.all.filter(r => /livelock/.test(String(r?.skill?.name))).map(r => r.skill.name), [])
  await withMutant(COG_PATH, "      if (!crewQuiet && (rejection?.reason === 'repeat_loop' || this.consecutiveRejections >= 3)) {", "      if ((rejection?.reason === 'repeat_loop' || this.consecutiveRejections >= 3)) {", async M => {
    const m = await drive(M, { bot: fieldBot(), town: mkTown({ grounds: { ok: false, why: 'spent' } }), before: three, propose: MINE, cooldown: 100, ms: 600 })
    assert.ok(m.all.some(r => /livelock/.test(String(r?.skill?.name))) || m.runs.some(r => r.skill === 'goto'), 'the mutant: the breaker is asked about a crew refusal')
  })
})
test('NEED R3 (review r2): with the index unread for 30 min COAL opens while this bot\'s own smelt job ended `no_fuel` within the hour -- and closes again by itself', async () => {
  const unread = { ok: false }, long = MC.CREW.indexUnreadMs
  const n = MC.mineNeed({ stock: unread, lacking: 0, unreadMs: long, noFuelMs: 1000 })
  assert.deepEqual([n.short, n.why.coal, n.why.iron], [['coal'], 'index_unread_no_fuel', 'no_one_lacks'])
  assert.equal(MC.mineNeed({ stock: unread, lacking: 0, unreadMs: long, noFuelMs: null }).open, false, 'no smelt job said so: closed')
  assert.equal(MC.mineNeed({ stock: unread, lacking: 0, unreadMs: long, noFuelMs: MC.CREW.noFuelFreshMs }).open, false, 'bounded: an hour-old reading says nothing')
  assert.equal(MC.mineNeed({ stock: unread, lacking: 0, unreadMs: long - 1, noFuelMs: 1000 }).open, false, 'an index unread a moment is waited for')
  assert.equal(MC.mineNeed({ stock: stock(200, 200), lacking: 0, unreadMs: long, noFuelMs: 1000 }).why.coal, 'stocked', 'a reading index is believed')
  assert.equal(MC.deepTripGate({ on: true, target: 'iron', need: n }).for, 'coal', 'the deep miner\'s ore trip may go for it')
  await withMutant(MC_PATH, '      open = !!def.newTown || dry; why[m]', '      open = !!def.newTown; why[m]', async M => {
    assert.equal(M.mineNeed({ stock: unread, lacking: 0, unreadMs: long, noFuelMs: 1000 }).open, false, 'the mutant: coal closed for good where the index is off')
  })
  // through the loop: the reading is the bot's own `smelt_town` run that stopped `no_fuel`; a later success clears it
  const town = () => { const t = mkTown({ grounds: { ok: false, why: 'full' } }); t.st.stock = MC.crewStock(null); return t }
  const smelt = n => ({ skill: 'smelt_town', args: {}, reason: 's' })
  const dry = async (M, eff) => drive(M, { bot: fieldBot(), town: town(), propose: smelt, effect: eff, cooldown: 60,
    during: async loop => { await sleep(300); loop.crew.t0 = Date.now() - long - 1; loop.crew.readAt = -Infinity; await sleep(250) } })
  const noFuel = s => (s === 'smelt_town' ? { status: 'no_effect', stop: 'no_fuel', detail: 'no coal in town' } : null)
  const out = await dry(COG, noFuel)
  assert.ok(out.runs.some(r => r.skill === 'smelt_town'), `the smelt job ran: ${out.runs.map(r => r.skill)}`)
  assert.deepEqual([out.loop.crew.need.short.includes('coal'), out.loop.crew.need.why.coal], [true, 'index_unread_no_fuel'])
  const fine = await dry(COG, null)
  assert.ok(fine.runs.some(r => r.skill === 'smelt_town'))
  assert.deepEqual([fine.loop.crew.need.short.includes('coal'), fine.loop.crew.need.why.coal, fine.loop.crew.noFuelAt ?? null], [false, 'index_unread', null], 'the positive control: a smelt job that works opens no coal')
  await withMutant(COG_PATH, ', noFuelMs: C.noFuelAt == null ? null : now - C.noFuelAt })', ' })', async M => {
    assert.equal((await dry(M, noFuel)).loop.crew.need.short.includes('coal'), false, 'the mutant: the reading is never asked')
  })
})
test('LOOP R4 (review r2): a crew slot labelled `build` under an ORE trip (the build lease was lost inside the skill) is judged as a new ore trip -- a surplus sends the trip home through its own return phase; a need re-labels the slot', async () => {
  const withTrip = target => { const b = fieldBot({ at: [400, 70, 400] }); b.deepTrip = { id: 'CrewBot-t9', target, phase: 'work', startedAt: Date.now(), calls: 1, trail: [] }; return b }
  const labelled = o => { const t = mkTown(o); t.st.slots[1] = { holder: 'CrewBot', gen: ++t.st.gen, at: Date.now(), meta: { since: Date.now(), for: 'build', deep: true } }; return t }
  const surplus = await drive(COG, { bot: withTrip('iron'), town: labelled({}), ms: 300 })
  assert.deepEqual([surplus.loop.bot.deepTrip.phase, surplus.loop.bot.deepTrip.returnWhy], ['return', 'crew_no_need'])
  assert.deepEqual([surplus.loop.crew.hold?.for, surplus.loop.crew.hold?.meta?.for, surplus.loop.crew.hold?.deep], ['return', 'return', true], 'the body is still counted until it is up')
  assert.equal(surplus.of('trip_is').length, 1, 'said once'); assert.match(surplus.of('trip_is')[0], /^op=trip_is trip=CrewBot-t9 target=iron was=build for=return why=no_need phase=work to=return$/)
  assert.ok(surplus.runs.length >= 2 && surplus.runs.every(r => r.skill === 'deep_mine'), 'never cut: the trip\'s own calls go on (return steps now)')
  const short = await drive(COG, { bot: withTrip('iron'), town: labelled({ iron: 5, lacking: lacks() }), ms: 300 })
  assert.deepEqual([short.loop.bot.deepTrip.phase, short.loop.crew.hold?.for, short.loop.crew.hold?.meta?.for], ['work', 'iron', 'iron'], 'the town is short of iron: the trip works on, the slot says what for')
  const build = await drive(COG, { bot: withTrip('build'), town: labelled({}), ms: 300 })
  assert.deepEqual([build.loop.bot.deepTrip.phase, build.loop.crew.hold?.for, build.of('trip_is').length], ['work', 'build', 0], 'the positive control: a build trip under a build label is left alone')
  await withMutant(COG_PATH, "      if (admitted.skill === 'deep_mine' && !declined && C.hold?.deep && bot.deepTrip) this.#crewDeepIs()\n", '', async M => {
    const m = await drive(M, { bot: withTrip('iron'), town: labelled({}), ms: 300 })
    assert.deepEqual([m.loop.bot.deepTrip.phase, m.loop.crew.hold?.for], ['work', 'build'], 'the mutant: an unchecked ore trip in a surplus, on a slot that says build')
  })
})

test('WIRING (structural): the steer sits at the end of the order chain, ahead of the continuation; the re-tick is one tick; the crew is read before the rungs', () => {
  const cog = strip(fs.readFileSync(COG_PATH, 'utf8'))
  const steerAt = cog.indexOf('if (MINECREW.on) { if (order) this.crewForce = false; else { const so = this.#crewSteerOrder(); if (so) order = so } }'), contAt = cog.indexOf('const co = continueOrder({'), plantAt = cog.indexOf('order = plantingOrder({'), deepAt = cog.indexOf('order = this.#crewDeepStart(r.order)'), buildAt = cog.indexOf('const r = buildOrder({')
  assert.ok(buildAt > 0 && deepAt > buildAt && plantAt > deepAt && steerAt > plantAt && contAt > steerAt, 'build order < deep miner < planting < STEER < continuation')
  const skyAt = cog.indexOf('const sd = this.#skyDescendOrder(order)'), koAt = cog.indexOf('const ko = this.#keepoutExitOrder(order)')
  assert.ok(skyAt > steerAt && koAt > skyAt, 'the sky descent and the keep-out exit still override the steer')
  assert.ok(cog.includes('if (this.crewRetick === true) { this.crewRetick = false; delay = Math.min(delay, 50) }'))
  const tickAt = cog.indexOf('this.#crewTick(trigger)'), refreshAt = cog.indexOf('const wasChainDone = this.milestones.allDone')
  assert.ok(tickAt > 0 && refreshAt > tickAt)
  assert.ok(cog.includes('this.admission.fromOrder = !!order && !order.continuation'))
})

// ================================================================= review round 3 (Codex): two dead ends
test('STOCK R3: a container not observed for CREW.stockFreshMs is still a container but its mined materials no longer count -- a destroyed chest\'s 64 ingots and 64 coal do not close mining for good', () => {
  const now = 100 * 3600_000, old = now - MC.CREW.stockFreshMs, full = { iron_ingot: [64, 1], coal: [64, 1], obsidian: [2, 1] }
  assert.equal(MC.CREW.stockFreshMs, TI.INDEX_STALE_MS, 'the index\'s own line between known and stale')
  const gone = { goneChest: { obs: { at: old, names: full } }, emptyChest: { obs: { at: now - 1000, names: {} } } }
  const st = MC.crewStock(gone, { now })
  assert.deepEqual(st, { ok: true, containers: 2, have: { iron: 0, coal: 0 }, obsidian: 2, stale: 1 })
  const need = MC.mineNeed({ stock: st, lacking: 1 })
  assert.deepEqual([need.open, need.short, need.why], [true, ['iron', 'coal'], { iron: 'low', coal: 'low' }], 'the town IS short: the crew opens')
  assert.equal(MC.crewGate({ on: true, kind: MC.crewKind('gather', { block: 'iron_ore' }), need, now }).ok, true, 'the refused bot of the review is admitted')
  // the positive control: the same chest seen a millisecond inside the line still closes mining; and a town whose every chest is
  // stale is not a NEW town (coal has `no_container` there, closed for good): it reads low and opens
  const fresh = MC.crewStock({ ...gone, goneChest: { obs: { at: old + 1, names: full } } }, { now })
  assert.deepEqual(fresh.have, { iron: 64, coal: 64 }); assert.equal(MC.mineNeed({ stock: fresh, lacking: 1 }).open, false)
  const allStale = MC.crewStock({ goneChest: gone.goneChest }, { now })
  assert.deepEqual([allStale.containers, MC.mineNeed({ stock: allStale, lacking: 0 }).why.coal], [1, 'low'])
  assert.equal(MC.crewStock({ x: { obs: { names: full } } }, { now }).have.iron, 0, 'an observation with no time is not evidence of stock')
})
test('STOCK R3 MUTANT KILLED: without the age line the destroyed chest refuses every miner for ever', async () => {
  await withMutant(MC_PATH, "    if (!(Number.isFinite(e.obs.at) && now - e.obs.at < freshMs)) { stale++; continue }\n", '', async M => {
    const now = 100 * 3600_000
    const st = M.crewStock({ goneChest: { obs: { at: 1, names: { iron_ingot: [64, 1], coal: [64, 1] } } }, emptyChest: { obs: { at: now, names: {} } } }, { now })
    const need = M.mineNeed({ stock: st, lacking: 1, unreadMs: 1e12, noFuelMs: null })
    assert.deepEqual([st.have, need.open], [{ iron: 64, coal: 64 }, false], 'the mutant: stocked, whatever the time')
    assert.equal(M.crewGate({ on: true, kind: M.crewKind('gather', { block: 'iron_ore' }), need, now }).why, 'no_need')
  })
})
test('STEER R3: the HOME order of a bot far from town is not held by the REPEAT WINDOW (a cooldown still holds it); nor is the low-ground one', async () => {
  const rep = () => 'repeat_loop'
  const far = steer({ distHome: 200, force: true, refuses: rep })
  assert.deepEqual([far.kind, far.order?.skill, far.why], ['home', 'home', 'forced'])
  assert.equal(steer({ distHome: 200, refuses: rep }).order?.skill, 'home', 'unforced too, on its own rhythm')
  assert.equal(steer({ distHome: 200, state: { homeAt: 1_000_000 - 1000 }, refuses: rep }).why, 'rhythm', 'its bound: one every CREW.homeEveryMs')
  assert.equal(steer({ distHome: 200, force: true, refuses: () => 'cooldown' }).why, 'memory', 'a walk that just failed is cooling down: that expires, and holds')
  const low = steer({ y: 50, distHome: 60, refuses: sk => (sk === 'home' ? 'repeat_loop' : null), grounds: () => ({ ok: false, why: 'underground' }) })
  assert.deepEqual([low.kind, low.why], ['home', 'low'])
  await withMutant(MC_PATH, "    if (askedUp('home')) return none('memory')\n", "    if (asked('home')) return none('memory')\n", async M => {
    assert.equal(M.crewSteer({ on: true, y: 70, lineY: LINE, roofed: false, distHome: 200, now: 1_000_000, state: {}, force: true, refuses: rep }).why, 'memory', 'the mutant: none:memory for good')
  })
})
test('LOOP R3 (review r3): 200 blocks from town, four model-chosen `home` in the repeat window, the model keeps choosing `mine` -- each refusal is followed by the steer\'s `home`, and the gate admits it', async () => {
  const farBot = () => fieldBot({ at: [config.world.homeX + 200, 70, config.world.homeZ] })
  const full = loop => { const k = loop.admission.constructor.key('home', {}); loop.admission.recent = [k, k, k, k] }
  const noArrive = s => (s === 'home' ? { status: 'success', detail: 'walked some', contractEvidence: ['position: moved 3 blocks'] } : null)
  const mine = () => ({ skill: 'mine', args: { y: 16 }, reason: 'iron' })
  const out = await drive(COG, { bot: farBot(), town: mkTown({}), effect: noArrive, before: full, propose: mine, ms: 700 })
  assert.equal(out.runs.filter(r => r.skill === 'mine').length, 0, 'mine never ran (the surplus town)')
  assert.ok(out.runs.some(r => r.skill === 'home'), `the way to the town's work ran: ${out.runs.map(r => r.skill)} / ${out.of('refuse').slice(0, 2)}`)
  assert.ok(out.of('refuse').some(d => /then=home/.test(d)), 'the refusal row names the order that follows')
  assert.equal(out.loop.admission.memoryRefuses('home', {}), 'repeat_loop', 'the positive control: the window IS full of `home` for anyone else')
  assert.equal(out.loop.admission.check({ skill: 'home', args: {}, reason: 'x' }, out.loop.bot, null).reason, 'repeat_loop', '...and the model\'s own fifth `home` is still refused by it')
  await withMutant(COG_PATH, "      if (MINECREW.on && order?.crewSteer === 'home') this.admission.crewWayUp = true", '', async M => {
    const m = await drive(M, { bot: farBot(), town: mkTown({}), effect: noArrive, before: full, propose: mine, ms: 700 })
    assert.equal(m.runs.filter(r => r.skill === 'home').length, 0, `the mutant: the gate refuses the steer's home for good: ${m.runs.map(r => r.skill)}`)
  })
  await withMutant(MC_PATH, "    if (askedUp('home')) return none('memory')\n", "    if (asked('home')) return none('memory')\n", async M2 => {
    assert.equal(M2.crewSteer({ on: true, y: 70, lineY: LINE, roofed: false, distHome: 200, now: 5, state: {}, force: true, refuses: () => 'repeat_loop' }).order, null)
  })
})
