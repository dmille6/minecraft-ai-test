// VETO REMEDY (vetoremedy.mjs; idlegap): the rule as pure decisions, then through the REAL cognitive loop (a fake runner, a
// scripted model, the real admission gate), then mutants of the rule and of the wiring.
process.env.LOG_DIR = process.env.LOG_DIR || '/tmp/mcbot-test-logs-vetoremedy'
process.env.BOT_NAME = process.env.BOT_NAME || 'RemedyBot'
process.env.MEMORY_SCOPE = process.env.MEMORY_SCOPE || 'isolated'
process.env.LOG_LEVEL = 'error'
process.env.BOT_ROLE = 'gatherer'
process.env.LLM_DECISION_COOLDOWN_MS = '400'
process.env.HOME_X = '0'; process.env.HOME_Y = '70'; process.env.HOME_Z = '0'
import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
const require_ = createRequire(import.meta.url)
const mcData = require_('minecraft-data')('1.21.8')
const { Vec3 } = require_('vec3')
const VR = await import('../src/vetoremedy.mjs')
const FD = await import('../src/fewerdec.mjs')
const { Lessons } = await import('../src/lessons.mjs')
const { tapRecords } = await import('../src/logger.mjs')

const VR_PATH = new URL('../src/vetoremedy.mjs', import.meta.url)
const COG_PATH = new URL('../src/cognitive.mjs', import.meta.url)
/** The repo's withMutant (climb-escape.test.mjs): the anchor must be present AND unique, or the mutant reads as killed. */
async function withMutant (p, old, neu, fn) {
  const src = fs.readFileSync(p, 'utf8')
  assert.ok(src.includes(old), `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 60))} is not in ${p.pathname}`)
  assert.ok(src.split(old).length === 2, 'ANCHOR NOT UNIQUE: the mutant is ambiguous')
  const out = new URL(`./_mutant-vr-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  fs.writeFileSync(out, src.replace(old, neu).replace(/from '\.\//g, "from '../src/"))
  try { return await fn(await import(out.href)) } finally { try { fs.unlinkSync(out) } catch {} }
}

const cfg = (env = {}) => VR.vetoRemedyConfig(env)
const free = () => null
const GOTO_UP = { skill: 'goto', args: { x: 0, y: 120, z: 0 } }
const UNREACH = { ok: false, reason: 'unreachable_elevation', detail: 'y=120 is 50 blocks ABOVE your y=70' }
const ask = (over = {}) => VR.vetoRemedy({ cfg: cfg(), trigger: 'idle', milestoneId: 'return#12', proposal: GOTO_UP, rejection: UNREACH, memoryRefuses: free, ...over })

test('CONFIG: unset = on with both rules; VETOREMEDY=0 is off; VETOREMEDY_RULES picks rules', () => {
  const c = cfg(); assert.equal(c.on, true); assert.deepEqual([...c.rules].sort(), ['deposit_all', 'return_home'])
  assert.equal(cfg({ VETOREMEDY: '0' }).on, false)
  assert.deepEqual([...cfg({ VETOREMEDY_RULES: 'deposit_all' }).rules], ['deposit_all'])
  assert.ok(VR.REMEDY_DELAY_MS < 1000 && VR.REMEDY_TTL_MS >= VR.REMEDY_DELAY_MS)
})

test('RUNG: sustaining ids map to their family; a prerequisite override is not the rung', () => {
  assert.equal(VR.rungOf('return#1232'), 'return'); assert.equal(VR.rungOf('return'), 'return')
  assert.equal(VR.rungOf('deposit_surplus#3207'), 'deposit_surplus')
  assert.equal(VR.rungOf('return#1232+prereq'), null); assert.equal(VR.rungOf(null), null)
})

test('RETURN_HOME: a vetoed goto / deposit / anything on `return` -> home, whatever the reason', () => {
  const r = ask(); assert.equal(r.skill, 'home'); assert.deepEqual(r.args, {}); assert.equal(r.rule, 'return_home'); assert.equal(r.remedy, true)
  assert.match(r.why, /^veto remedy return_home/)
  for (const reason of ['learned_avoid', 'repeat_loop', 'cooldown', 'deposit_nothing_to_bank', 'bad_args']) {
    assert.equal(ask({ rejection: { ok: false, reason }, proposal: { skill: 'deposit', args: { item: 'iron_axe' } } })?.skill, 'home', reason)
  }
})

test('RETURN_HOME: never for a vetoed home itself, a refused ORDER, a non-idle trigger, another rung, a prereq, or off', () => {
  assert.equal(ask({ proposal: { skill: 'home', args: {} }, rejection: { ok: false, reason: 'cooldown' } }), null)
  assert.equal(ask({ fromOrder: true }), null)
  for (const t of ['death', 'entombed', 'drowning', 'startup', 'stagnation', 'liveness_restart']) assert.equal(ask({ trigger: t }), null, t)
  assert.equal(ask({ milestoneId: 'patrol#3' }), null)
  assert.equal(ask({ milestoneId: 'return#3+prereq' }), null)
  assert.equal(ask({ cfg: cfg({ VETOREMEDY: '0' }) }), null)
  assert.equal(ask({ cfg: cfg({ VETOREMEDY_RULES: 'deposit_all' }) }), null)
  assert.equal(ask({ rejection: null }), null, 'admitted: nothing to remedy')
})

test('GATE MEMORY: a remedy the gate would refuse (cooldown, learned_avoid, repeat_loop, or an unreadable memory) is not queued', () => {
  for (const why of ['cooldown', 'learned_avoid', 'repeat_loop']) assert.equal(ask({ memoryRefuses: (s) => (s === 'home' ? why : null) }), null, why)
  assert.equal(ask({ memoryRefuses: () => { throw new Error('x') } }), null)
  const seen = []; ask({ memoryRefuses: (s, a) => { seen.push([s, a]); return null } })
  assert.deepEqual(seen, [['home', {}]], 'the memory is asked about the REMEDY, not the vetoed proposal')
})

test('DEPOSIT_ALL: on deposit_surplus a NAMED deposit refused as nothing-to-bank or item-missing -> deposit everything bankable', () => {
  const base = { milestoneId: 'deposit_surplus#3207', proposal: { skill: 'deposit', args: { item: 'apple' } } }
  for (const reason of ['deposit_nothing_to_bank', 'deposit_item_missing']) {
    const r = ask({ ...base, rejection: { ok: false, reason } })
    assert.equal(r.skill, 'deposit'); assert.deepEqual(r.args, {}, 'no item = everything bankable'); assert.equal(r.rule, 'deposit_all')
  }
  // not for: an unnamed deposit (that IS the remedy), a wildcard word, another reason, another skill, another rung, rule off
  assert.equal(ask({ ...base, proposal: { skill: 'deposit', args: {} }, rejection: { ok: false, reason: 'deposit_nothing_to_bank' } }), null)
  assert.equal(ask({ ...base, proposal: { skill: 'deposit', args: { item: 'any' } }, rejection: { ok: false, reason: 'deposit_nothing_to_bank' } }), null)
  assert.equal(ask({ ...base, rejection: { ok: false, reason: 'deposit_not_worth_it' } }), null)
  assert.equal(ask({ ...base, proposal: { skill: 'craft', args: { item: 'chest' } }, rejection: { ok: false, reason: 'deposit_nothing_to_bank' } }), null)
  assert.equal(ask({ ...base, milestoneId: 'idle', rejection: { ok: false, reason: 'deposit_nothing_to_bank' } }), null)
  assert.equal(ask({ ...base, cfg: cfg({ VETOREMEDY_RULES: 'return_home' }), rejection: { ok: false, reason: 'deposit_nothing_to_bank' } }), null)
})

test('BUDGET: one remedy per rule per 45 s, at most 20 per rule per hour; another rule has its own budget', () => {
  const now = 10_000_000
  assert.ok(ask({ history: [], now }))
  assert.equal(ask({ history: [{ rule: 'return_home', at: now - 30_000 }], now }), null, 'inside the gap')
  assert.ok(ask({ history: [{ rule: 'return_home', at: now - 46_000 }], now }), 'after the gap')
  assert.ok(ask({ history: [{ rule: 'deposit_all', at: now - 1_000 }], now }), 'another rule does not count')
  const full = Array.from({ length: 20 }, (_, i) => ({ rule: 'return_home', at: now - 50_000 - i * 60_000 }))
  assert.equal(ask({ history: full, now }), null, '20 in the last hour')
  assert.ok(ask({ history: full.map(h => ({ ...h, at: h.at - 3_600_000 })), now }), 'an hour later the budget is back')
})
test('MUTANT KILLED: without the budget a remedy every veto would be queued', async () => {
  await withMutant(VR_PATH, '  if (!remedyBudgetOk({ cfg, rule: out.rule, history, now })) return null\n', '', async M => {
    assert.equal(M.vetoRemedy({ cfg: M.vetoRemedyConfig({}), trigger: 'idle', milestoneId: 'return#1', proposal: GOTO_UP, rejection: UNREACH, memoryRefuses: free, history: [{ rule: 'return_home', at: 999 }], now: 1000 })?.skill, 'home')
  })
})
test('TAKE: the queued remedy is used only on an idle tick, inside its TTL, on the same rung', () => {
  const order = { skill: 'home', args: {}, remedy: true }
  const pending = { order, at: 1000, milestoneId: 'return#12' }
  const take = (over = {}) => VR.takeRemedy({ cfg: cfg(), pending, trigger: 'idle', milestoneId: 'return#12', now: 1250, ...over })
  assert.equal(take(), order)
  assert.equal(take({ trigger: 'death' }), null)
  assert.equal(take({ now: 1000 + VR.REMEDY_TTL_MS + 1 }), null)
  assert.equal(take({ milestoneId: 'deposit_surplus#3' }), null)
  assert.equal(take({ pending: null }), null)
  assert.equal(take({ cfg: cfg({ VETOREMEDY: '0' }) }), null)
})

test('MUTANT KILLED: without the idle-only guard a death would be answered by the stale home', async () => {
  await withMutant(VR_PATH, "fromOrder || trigger !== 'idle' ||", 'fromOrder ||', async M => {
    assert.equal(M.vetoRemedy({ cfg: M.vetoRemedyConfig({}), trigger: 'death', milestoneId: 'return#1', proposal: GOTO_UP, rejection: UNREACH, memoryRefuses: free })?.skill, 'home')
  })
})
test('MUTANT KILLED: without the gate-memory check a cooling-down home would be queued', async () => {
  await withMutant(VR_PATH, '  if (refused) return null\n', '', async M => {
    assert.equal(M.vetoRemedy({ cfg: M.vetoRemedyConfig({}), trigger: 'idle', milestoneId: 'return#1', proposal: GOTO_UP, rejection: UNREACH, memoryRefuses: () => 'cooldown' })?.skill, 'home')
  })
})
test('MUTANT KILLED: without the self-guard a vetoed home would queue home again', async () => {
  await withMutant(VR_PATH, " && proposal.skill !== 'home'", '', async M => {
    assert.equal(M.vetoRemedy({ cfg: M.vetoRemedyConfig({}), trigger: 'idle', milestoneId: 'return#1', proposal: { skill: 'home', args: {} }, rejection: { ok: false, reason: 'learned_avoid' }, memoryRefuses: free })?.skill, 'home')
  })
})

// ---------------------------------------------------------------- the REAL loop
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcai-vr-'))
let seq = 0
function fieldBot () {
  // 400 blocks from home (no town orders), a pickaxe (no withdraw), a few slots used (no hygiene)
  const inv = [{ name: 'stone_pickaxe', count: 1, slot: 9, type: mcData.itemsByName.stone_pickaxe.id, maxDurability: 131, durabilityUsed: 11 },
    { name: 'cobblestone', count: 20, slot: 10, type: mcData.itemsByName.cobblestone.id }]
  return {
    entity: { position: new Vec3(400, 70, 400), velocity: { x: 0, y: 0, z: 0 } }, health: 20, food: 20, oxygenLevel: 300,
    time: { day: 1, age: 1, timeOfDay: 1000 }, game: { dimension: 'overworld' }, serverDifficulty: 'peaceful',
    inventory: { items: () => inv }, registry: mcData, recipesFor: () => [], recipesAll: () => [],
    findBlock: () => null, findBlocks: () => [], blockAt: () => ({ name: 'air', boundingBox: 'empty' }),
    setControlState: () => {}, clearControlStates: () => {}, players: {}, entities: {}, experience: { level: 0 }, username: 'RemedyBot',
  }
}
const RETURN = { id: 'return#7', wants: null, wantsAny: null, describe: 'Return home with what you gathered.', progress: '566 blocks from home', hint: 'use the home skill.' }
/** The loop on a `return` rung whose model always asks for a goto 50 blocks up (the gate refuses it: unreachable_elevation).
 *  -> the sequence: c = a model call, h = a home run, x = any other run. */
async function driveReturn (mod, { remedy, homeStatus = 'success', ms = 1300, proposal = GOTO_UP, rung = RETURN, extraInv = [], chest = false } = {}) {
  const { config } = await import('../src/config.mjs')
  const was = config.llm.decisionCooldownMs
  config.llm.decisionCooldownMs = 400
  const rows = []
  const untap = tapRecords(r => { if (r?.skill?.name === '_work_order') rows.push(r.skill.detail) })
  try {
    const out = { seq: '', at: [] }
    const runner = { isBusy: () => false, run: async (skill) => { out.seq += skill === 'home' ? 'h' : skill === 'deposit' ? 'd' : 'x'; out.at.push(Date.now())
      return homeStatus === 'success' ? { status: 'success', detail: 'home (3b from the town centre)', contractEvidence: ['position: moved 40 blocks'] }
                                      : { status: 'failed', failClass: 'no_path', detail: 'no route exists toward 0,0' } } }
    const L = new Lessons(path.join(dir, `l${seq++}.json`)); L.data.avoid = {}; L.data.worked = {}
    const bot = fieldBot(); bot.inventory.items().push(...extraInv)
    if (chest) { const blk = { position: new Vec3(402, 70, 400), type: mcData.blocksByName.chest.id, name: 'chest' }; bot.findBlock = (o) => { try { return o?.matching?.(blk) ? blk : null } catch { return null } } }
    const loop = new mod.CognitiveLoop(bot, runner, L, null)
    loop.fewerDec = FD.fewerDecConfig({ FEWERDEC_PAUSEWAIT: '0', FEWERDEC_VETOSKIP: '0' })
    if (remedy) loop.vetoRemedy = remedy
    loop.milestones.status = () => ({ ...rung })
    loop.milestones.refresh = () => false
    loop.llm = { decide: async ({ user }) => { if (!/TRIGGER: startup/.test(user ?? '')) { out.seq += 'c'; out.at.push(Date.now()) } return { schemaValid: true, latencyMs: 1, raw: '{}', proposal: { ...proposal, reason: 'p' } } } }
    loop.start(); await new Promise(r => setTimeout(r, ms)); loop.stop()
    return { ...out, rows }
  } finally { untap(); config.llm.decisionCooldownMs = was }
}

test('LOOP RETURN_HOME: a vetoed goto on `return` is followed by home on the next tick, not by the cooldown and another call', async () => {
  const r = await driveReturn((await import('../src/cognitive.mjs')))
  assert.match(r.seq, /ch/, r.seq)
  const i = r.seq.indexOf('ch')
  assert.ok(r.at[i + 1] - r.at[i] < 300, `home ran ${r.at[i + 1] - r.at[i]} ms after the veto (cooldown is 400)`)
  assert.ok(r.rows.some(d => /^home \{\} — veto remedy return_home/.test(d)), `the work_order row names the remedy: ${r.rows}`)
})
test('LOOP RETURN_HOME OFF (positive control): the same model on the old loop only waits and asks again', async () => {
  const r = await driveReturn((await import('../src/cognitive.mjs')), { remedy: VR.vetoRemedyConfig({ VETOREMEDY: '0' }) })
  assert.ok(r.seq.length >= 2 && /^c+$/.test(r.seq), r.seq)
})
test('LOOP RETURN_HOME: model calls do not rise -- with the remedy at most as many calls as without it', async () => {
  const COG = await import('../src/cognitive.mjs')
  const on = await driveReturn(COG), offR = await driveReturn(COG, { remedy: VR.vetoRemedyConfig({ VETOREMEDY: '0' }) })
  const n = s => (s.match(/c/g) ?? []).length
  assert.ok(n(on.seq) <= n(offR.seq), `calls on ${n(on.seq)} (${on.seq}) vs off ${n(offR.seq)} (${offR.seq})`)
})
test('LOOP RETURN_HOME: a SUCCEEDING home is still budgeted -- one remedy per 45 s, the vetoes in between take the old path', async () => {
  const r = await driveReturn((await import('../src/cognitive.mjs')), { ms: 1500 })
  assert.equal((r.seq.match(/h/g) ?? []).length, 1, r.seq)
  assert.ok((r.seq.match(/c/g) ?? []).length >= 2, r.seq)
})
test('LOOP RETURN_HOME: a failing home is not re-issued while it cools down (the gate memory), so the loop cannot spin', async () => {
  const r = await driveReturn((await import('../src/cognitive.mjs')), { homeStatus: 'failed', ms: 1500 })
  assert.equal((r.seq.match(/h/g) ?? []).length, 1, `one home inside the 45 s failed-cooldown: ${r.seq}`)
  assert.ok(!/hh/.test(r.seq), r.seq)
})
test('LOOP RETURN_HOME WIRING MUTANT KILLED: with the take unwired, no home ever runs', async () => {
  await withMutant(COG_PATH, "      if (!order) { const vr = takeRemedy(", "      if (false) { const vr = takeRemedy(", async M => {
    const r = await driveReturn(M)
    assert.ok(!/h/.test(r.seq), r.seq)
  })
})
test('LOOP RETURN_HOME SCHEDULE MUTANT KILLED: with the short delay unwired, home waits out the cooldown', async () => {
  await withMutant(COG_PATH, 'this.#scheduleNext(this.pendingRemedy ? Math.min(cs.delayMs, this.vetoRemedy.delayMs) : cs.delayMs)', 'this.#scheduleNext(cs.delayMs)', async M => {
    const r = await driveReturn(M)
    const i = r.seq.indexOf('ch')
    assert.ok(i < 0 || r.at[i + 1] - r.at[i] >= 350, `home ${i < 0 ? 'never ran' : `ran ${r.at[i + 1] - r.at[i]} ms after the veto`}`)
  })
})

test('DEPOSIT_ALL x THE REAL GATE: the named kept item is refused and the unnamed deposit of the same bag is not refused as empty', async () => {
  const { AdmissionControl } = await import('../src/admission.mjs')
  const A = new AdmissionControl(null)
  A.activeMilestoneId = 'deposit_surplus#3'
  const bot = fieldBot()
  const inv = bot.inventory.items()
  inv.push({ name: 'apple', count: 4, slot: 11, type: mcData.itemsByName.apple.id })
  inv.push({ name: 'raw_copper', count: 12, slot: 12, type: mcData.itemsByName.raw_copper.id })   // always banked (bankable.mjs DEPOSIT_ALWAYS)
  const named = A.check({ skill: 'deposit', args: { item: 'apple' } }, bot, null)
  assert.equal(named.ok, false); assert.equal(named.reason, 'deposit_nothing_to_bank', JSON.stringify(named))
  const r = VR.vetoRemedy({ cfg: cfg(), trigger: 'idle', milestoneId: 'deposit_surplus#3', proposal: { skill: 'deposit', args: { item: 'apple' } }, rejection: named, memoryRefuses: (s, a) => A.memoryRefuses(s, a) })
  assert.equal(r?.skill, 'deposit')
  const all = A.check({ skill: r.skill, args: { ...r.args } }, bot, null)
  assert.notEqual(all.reason, 'deposit_nothing_to_bank', `the remedy banks the surplus: ${JSON.stringify(all)}`)
})

const SURPLUS = { id: 'deposit_surplus#3', wants: null, wantsAny: null, describe: 'Put your surplus in the town chest before heading out again.', progress: '12 bankable items carried', hint: 'deposit' }
const SURPLUS_BAG = [{ name: 'apple', count: 4, slot: 11, type: mcData.itemsByName.apple.id }, { name: 'raw_copper', count: 12, slot: 12, type: mcData.itemsByName.raw_copper.id }]
test('LOOP DEPOSIT_ALL: a named kept-item deposit on deposit_surplus is followed by deposit-everything on the next tick', async () => {
  const r = await driveReturn((await import('../src/cognitive.mjs')), { rung: SURPLUS, extraInv: SURPLUS_BAG, chest: true, proposal: { skill: 'deposit', args: { item: 'apple' } } })
  assert.match(r.seq, /^cd/, r.seq)
  assert.ok(r.at[1] - r.at[0] < 300, `deposit ran ${r.at[1] - r.at[0]} ms after the veto`)
  assert.ok(r.rows.some(d => /^deposit \{\} — veto remedy deposit_all/.test(d)), `${r.rows}`)
})
test('LOOP DEPOSIT_ALL OFF (positive control): the old loop only waits and asks again', async () => {
  const r = await driveReturn((await import('../src/cognitive.mjs')), { rung: SURPLUS, extraInv: SURPLUS_BAG, chest: true, proposal: { skill: 'deposit', args: { item: 'apple' } }, remedy: VR.vetoRemedyConfig({ VETOREMEDY_RULES: 'return_home' }) })
  assert.ok(r.seq.length >= 2 && /^c+$/.test(r.seq), r.seq)
})
test('LOOP DROPPED REMEDY: a remedy the next tick cannot use (rung changed) never brings the model call forward', async () => {
  const COG = await import('../src/cognitive.mjs')
  const { config } = await import('../src/config.mjs')
  const was = config.llm.decisionCooldownMs; config.llm.decisionCooldownMs = 400
  try {
    const at = []
    const runner = { isBusy: () => false, run: async () => ({ status: 'success', detail: 'ok', contractEvidence: ['position: moved 3 blocks'] }) }
    const L = new Lessons(path.join(dir, `l${seq++}.json`)); L.data.avoid = {}; L.data.worked = {}
    const loop = new COG.CognitiveLoop(fieldBot(), runner, L, null)
    loop.fewerDec = FD.fewerDecConfig({ FEWERDEC_PAUSEWAIT: '0', FEWERDEC_VETOSKIP: '0' })
    let n = 0
    loop.milestones.status = () => ({ ...RETURN, id: `return#${n}` })   // the rung id changes after every call
    loop.milestones.refresh = () => false
    loop.llm = { decide: async ({ user }) => { if (!/TRIGGER: startup/.test(user ?? '')) at.push(Date.now()); n++; return { schemaValid: true, latencyMs: 1, raw: '{}', proposal: { ...GOTO_UP, reason: 'p' } } } }
    loop.start(); await new Promise(r => setTimeout(r, 1500)); loop.stop()
    assert.ok(at.length >= 2, `calls ${at.length}`)
    for (let i = 1; i < at.length; i++) assert.ok(at[i] - at[i - 1] >= 380, `model asked ${at[i] - at[i - 1]} ms after the previous veto`)
  } finally { config.llm.decisionCooldownMs = was }
})
test('LOOP DROPPED REMEDY MUTANT KILLED: without the drop wait the model is asked ~250 ms after the veto', async () => {
  await withMutant(COG_PATH, "        else if (pend && trigger === 'idle') remedyDropUntil = (pend.at ?? 0) + config.llm.decisionCooldownMs } }\n", '  } }\n', async M => {
    const { config } = await import('../src/config.mjs')
    const was = config.llm.decisionCooldownMs; config.llm.decisionCooldownMs = 400
    try {
      const at = []
      const runner = { isBusy: () => false, run: async () => ({ status: 'success', detail: 'ok' }) }
      const L = new Lessons(path.join(dir, `l${seq++}.json`)); L.data.avoid = {}; L.data.worked = {}
      const loop = new M.CognitiveLoop(fieldBot(), runner, L, null)
      loop.fewerDec = FD.fewerDecConfig({ FEWERDEC_PAUSEWAIT: '0', FEWERDEC_VETOSKIP: '0' })
      let n = 0
      loop.milestones.status = () => ({ ...RETURN, id: `return#${n}` })
      loop.milestones.refresh = () => false
      loop.llm = { decide: async ({ user }) => { if (!/TRIGGER: startup/.test(user ?? '')) at.push(Date.now()); n++; return { schemaValid: true, latencyMs: 1, raw: '{}', proposal: { ...GOTO_UP, reason: 'p' } } } }
      loop.start(); await new Promise(r => setTimeout(r, 1500)); loop.stop()
      assert.ok(at.some((t, i) => i > 0 && t - at[i - 1] < 350), `gaps ${at.map((t, i) => i ? t - at[i - 1] : 0)}`)
    } finally { config.llm.decisionCooldownMs = was }
  })
})
