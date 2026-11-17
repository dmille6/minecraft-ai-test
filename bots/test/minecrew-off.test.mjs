// MINECREW-01SHOW, THE SWITCH'S OFF SIDE (MINECREW is read once, at import: this file sets it before anything loads). MINECREW=off
// must restore the behaviour before the piece EXACTLY: the prompt's bytes, the rungs, the admission gate and the order chain -- no
// hook, no steer, no crew row, no file. minecrew.test.mjs holds the ON side and is this file's positive control, test by test.
process.env.MINECREW = 'off'
process.env.LOG_DIR = process.env.LOG_DIR || '/tmp/mcbot-test-logs-minecrew-off'
process.env.BOT_NAME = process.env.BOT_NAME || 'CrewBot'
process.env.MEMORY_SCOPE = process.env.MEMORY_SCOPE || 'isolated'
process.env.LOG_LEVEL = 'error'
process.env.BOT_ROLE = 'gatherer'
process.env.LLM_DECISION_COOLDOWN_MS = '40'
process.env.HOME_X = '0'; process.env.HOME_Y = '70'; process.env.HOME_Z = '0'
process.env.WORLD_BORDER_RADIUS = '100000'
process.env.PIPELINE = 'off'
process.env.FEWERDEC_CONTINUE = '0'; process.env.FEWERDEC_VETOSKIP = '0'; process.env.FEWERDEC_PAUSEWAIT = '0'
process.env.MINECREW_IDLE_MS = '200'; process.env.MINECREW_UP_JITTER_MS = '1'
import assert from 'node:assert/strict'
import nodeTest from 'node:test'
// the runner prints a failing file's last 40 lines: every failure is said again at the very end, with its message
const failures = []
const test = (name, fn) => nodeTest(name, async (...a) => { try { await fn(...a) } catch (e) { failures.push(`${name}\n    ${String(e?.message ?? e).split('\n').slice(0, 14).join('\n    ')}`); throw e } })
process.on('exit', () => { if (failures.length) console.log(`\nFAILED TESTS (${failures.length}):\n${failures.map(f => `- ${f}`).join('\n')}`) })
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mcai-crewoff-'))
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
const COG = await import('../src/cognitive.mjs')
const sleep = ms => new Promise(r => setTimeout(r, ms))

const NAMES = ['gather', 'goto', 'deposit', 'withdraw', 'home', 'status', 'eat', 'craft', 'smelt', 'place', 'bucket', 'build', 'mine', 'explore', 'surface']
const OLD_RULES = ['- Iron: mine down to find iron ore, gather it (you get raw_iron), then', '  smelt item=raw_iron to get iron_ingot. 3 iron_ingot + 2 sticks ->', '  iron_pickaxe. Smelting needs a furnace (8 cobblestone) and fuel.',
  '- Iron ore is most common deep down, around y=16. If your town has a', '  mineshaft stair, mine with y=16 walks down it with no digging.',
  '- "reason" must be one short sentence explaining the choice.'].join('\n')
function fieldBot ({ at = [10, 70, 10], roof = null, ores = [], cobble = 20 } = {}) {
  const inv = [{ name: 'stone_pickaxe', count: 1, slot: 9, type: mcData.itemsByName.stone_pickaxe.id, maxDurability: 131, durabilityUsed: 11 },
    ...(cobble ? [{ name: 'cobblestone', count: cobble, slot: 10, type: mcData.itemsByName.cobblestone.id }] : [])]
  return {
    entity: { position: new Vec3(...at), velocity: { x: 0, y: 0, z: 0 } }, health: 20, food: 20, oxygenLevel: 300,
    time: { day: 1, age: 1, timeOfDay: 1000 }, game: { dimension: 'overworld' }, serverDifficulty: 'peaceful',
    inventory: { items: () => inv }, registry: mcData, recipesFor: () => [], recipesAll: () => [],
    findBlock: ({ matching } = {}) => { const o = ores.find(q => mcData.blocksByName[q.name]?.id === matching); return o ? { name: o.name, position: new Vec3(...o.at) } : null },
    findBlocks: ({ matching } = {}) => ores.filter(q => mcData.blocksByName[q.name]?.id === matching).map(q => new Vec3(...q.at)),
    blockAt: p => (roof && p && p.y >= roof[0] && p.y <= roof[1] ? { name: 'stone', boundingBox: 'block', position: p } : { name: 'air', boundingBox: 'empty' }),
    setControlState: () => {}, clearControlStates: () => {}, players: {}, entities: {}, experience: { level: 0 }, username: 'CrewBot',
  }
}

test('OFF: the switch reads off, and the licence row says so', () => {
  assert.equal(MC.MINECREW.on, false)
  assert.match(MC.crewModeDetail(undefined, 55), /^on=0 max=2 /)
})
test('OFF, THE PROMPT\'S BYTES: the system prompt carries the two old iron rules verbatim and in place, and no crew rule; it is what `mineCrew: false` builds', () => {
  const off = PR.buildSystemPrompt(NAMES)
  assert.equal(off, PR.buildSystemPrompt(NAMES, { mineCrew: false }))
  assert.ok(off.includes(OLD_RULES), 'the five old lines, contiguous, followed by the line that always followed them')
  for (const l of MC.CREW_RULE_LINES) assert.ok(!off.includes(l))
  assert.ok(!off.includes('MINING'))
  assert.notEqual(off, PR.buildSystemPrompt(NAMES, { mineCrew: true }), 'the positive control: on, the prompt is another')
})
test('OFF, THE RUNGS: the iron-ore rung, the stone stockpile and the patrol stand exactly as before', () => {
  const rung = id => MS.SUSTAINING.find(m => m.id === id)
  const b = fieldBot({ cobble: 0, ores: [{ name: 'iron_ore', at: [14, 70, 10] }] })
  assert.equal(rung('gather_iron_ore_3').done(b), false); assert.equal(rung('stockpile_stone').done(b, 0), false); assert.equal(rung('patrol').done(b), false)
  assert.equal(rung('stockpile_stone').done(fieldBot({ cobble: 20 }), 0), true, 'and they complete as before: 20 of 16 cobblestone')
  assert.equal(rung('stockpile_stone').fulfilled(fieldBot({ cobble: 20 }), 0), true, 'a completion is genuine exactly when the rung is met')
  assert.equal(rung('patrol').done(fieldBot({ at: [200, 70, 0] })), true); assert.equal(rung('patrol').fulfilled(fieldBot({ at: [200, 70, 0] })), true)
  assert.equal(rung('gather_iron_ore_3').done(fieldBot({ cobble: 0 })), true, 'no ore in reach: stepped over, as before')
})
test('OFF, ADMISSION: nothing asks about the crew -- `mine` to y=16 and an ore gather are admitted as before', () => {
  const ac = new AdmissionControl(null)
  const b = fieldBot()
  assert.equal(b.mineCrewGate, undefined)
  assert.deepEqual(ac.check({ skill: 'mine', args: { y: 16 } }, b).ok, true)
  assert.deepEqual(ac.check({ skill: 'gather', args: { block: 'iron_ore', count: 3 } }, b).ok, true)
  assert.equal(ac.check({ skill: 'mine', args: { y: 90 } }, b).reason, 'bad_args')
})
const ldir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcai-crewoff-l-'))
let lseq = 0
async function drive ({ bot, propose, ms = 500 }) {
  const rows = [], runs = [], asked = [], ioCalls = []
  const untap = tapRecords(r => { if (String(r?.skill?.name ?? '').startsWith('_minecrew')) rows.push(r.skill.detail) })
  const runner = { paused: false, pausedAt: null, isBusy: () => false, run: async (skill, args) => { runs.push({ skill, args: { ...args } }); return { status: 'success', detail: 'ok', contractEvidence: ['position: moved 3 blocks'] } } }
  const L = new Lessons(path.join(ldir, `l${lseq++}.json`)); L.data.avoid = {}; L.data.worked = {}
  const loop = new COG.CognitiveLoop(bot, runner, L, null)
  loop.crewIo = new Proxy({}, { get: (_t, k) => (...a) => { ioCalls.push(String(k)); return k === 'grounds' ? { ok: true, why: null } : null } })
  let n = 0
  loop.llm = { decide: async ({ user }) => { asked.push(user); n++; return { schemaValid: true, latencyMs: 1, raw: '{}', proposal: { ...propose(n) } } } }
  loop.start(); await sleep(ms); loop.stop(); untap(); await sleep(60)
  return { rows, runs, asked, loop, ioCalls }
}
test('OFF, THE ORDER CHAIN at the surface near home: no steer -- the model is asked every tick and its `mine` to y=16 RUNS, as today', async () => {
  const out = await drive({ bot: fieldBot({ ores: [{ name: 'iron_ore', at: [14, 70, 10] }] }), propose: n => ({ skill: 'mine', args: { y: 16 - (n % 3) }, reason: 'iron' }) })
  assert.ok(out.runs.length >= 3, `runs: ${out.runs.map(r => r.skill)}`)
  assert.ok(out.runs.every(r => r.skill === 'mine'), `every run is the model's mine: ${out.runs.map(r => r.skill)}`)
  assert.equal(out.asked.length >= out.runs.length, true)
  assert.deepEqual(out.rows, [], 'no _minecrew row of any kind')
  assert.deepEqual(out.ioCalls, [], 'no crew file call, no grounds ask')
  assert.equal(out.loop.bot.mineCrewGate, undefined); assert.equal(out.loop.bot.mineCrewView, undefined); assert.equal(out.loop.crew, undefined)
  assert.equal('mineCrewPending' in out.loop.bot, false, 'nothing of the crew\'s is left on the bot'); assert.equal(out.loop.crewForce, undefined); assert.equal(out.loop.crewRetick, undefined)
  assert.ok(out.asked.every(u => !/MINING:/.test(u)), 'no MINING line')
  assert.ok(out.asked.some(u => /NEARBY: .*iron_ore@/.test(u)), 'the ore is named, as before')
  assert.equal(fs.existsSync(IO.crewDir()), false, 'no crew directory was made')
})
test('OFF, THE ORDER CHAIN under rock and far from home: no way-up order, no home order', async () => {
  const under = await drive({ bot: fieldBot({ at: [10, 16, 10], roof: [20, 60] }), propose: n => ({ skill: 'gather', args: { block: 'stone', count: n }, reason: 's' }), ms: 350 })
  assert.ok(under.runs.length >= 2 && under.runs.every(r => r.skill === 'gather'), `runs: ${under.runs.map(r => r.skill)}`)
  const far = await drive({ bot: fieldBot({ at: [400, 70, 400] }), propose: n => ({ skill: 'gather', args: { block: 'dirt', count: n }, reason: 'd' }), ms: 350 })
  assert.ok(far.runs.length >= 2 && far.runs.every(r => r.skill === 'gather'), `runs: ${far.runs.map(r => r.skill)}`)
  assert.deepEqual([...under.rows, ...far.rows], []); assert.deepEqual([...under.ioCalls, ...far.ioCalls], [])
})
test('OFF: a build_shop visit moves the build order\'s clock whatever its args (the idle exemption is the crew\'s alone)', () => {
  assert.equal(MC.crewIdleVisit({ grounds: true, why: 'idle' }), false)
  assert.equal(MC.crewIdleVisit({ grounds: true, why: 'idle' }, true), true, 'the positive control')
  assert.equal(MC.crewRungClosed({ mineCrewView: undefined }), false)
  assert.equal(MC.crewSteer({ y: 16, lineY: 55, roofed: true, distHome: 10 }).why, 'off')
  assert.deepEqual(MC.crewGate({ kind: { kind: 'mine' }, need: { open: false, short: [] } }), { ok: true, take: null, for: null })
  assert.equal(MC.deepTripGate({ target: 'iron', need: { open: false, short: [] } }).ok, true)
  assert.equal(MC.miningLine(MC.crewView({})), '')
})
