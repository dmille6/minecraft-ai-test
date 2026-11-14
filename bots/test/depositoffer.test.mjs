// DEPOSITOFFER-01 (depositoffer.mjs; idlegap): the gate's deposit decision as a pure function, the gate and the offer agreeing
// on it, the deposit rung's own floor, then the REAL cognitive loop (a scripted model that records the schema it was handed),
// then anchored mutants of the rule and of the wiring.
process.env.LOG_DIR = process.env.LOG_DIR || '/tmp/mcbot-test-logs-depositoffer'
process.env.BOT_NAME = process.env.BOT_NAME || 'OfferBot'
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
const DO = await import('../src/depositoffer.mjs')
const FD = await import('../src/fewerdec.mjs')
const { AdmissionControl } = await import('../src/admission.mjs')
const { Lessons } = await import('../src/lessons.mjs')
const { tapRecords } = await import('../src/logger.mjs')

const DO_PATH = new URL('../src/depositoffer.mjs', import.meta.url)
const ADM_PATH = new URL('../src/admission.mjs', import.meta.url)
const COG_PATH = new URL('../src/cognitive.mjs', import.meta.url)
/** The repo's withMutant (climb-escape.test.mjs): the anchor must be present AND unique, or the mutant reads as killed.
 *  `extra` rewrites further imports so a mutant of one module is the one its importer loads. */
async function withMutant (p, old, neu, fn, extra = []) {
  const src = fs.readFileSync(p, 'utf8')
  assert.ok(src.includes(old), `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 60))} is not in ${p.pathname}`)
  assert.ok(src.split(old).length === 2, 'ANCHOR NOT UNIQUE: the mutant is ambiguous')
  const out = new URL(`./_mutant-do-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  let body = src.replace(old, neu)
  for (const [from, to] of extra) body = body.replace(from, to)
  fs.writeFileSync(out, body.replace(/from '\.\//g, "from '../src/"))
  try { return await fn(await import(`${out.href}?${Date.now()}_${Math.random()}`), out) } finally { try { fs.unlinkSync(out) } catch {} }
}

// ---- the pure decision -------------------------------------------------------------------------------------------------
const V = (over = {}) => DO.depositVerdict({ planLength: 5, bankable: 5, occupiedSlots: 10, distHome: 500, storageWithin48: false, ...over })

test('CONFIG: unset = on; DEPOSITOFFER=0 is off', () => {
  assert.equal(DO.depositOfferConfig({}).on, true)
  assert.equal(DO.depositOfferConfig({ DEPOSITOFFER: '0' }).on, false)
  assert.equal(DO.depositOfferConfig({ DEPOSITOFFER: '1' }).on, true)
})

test('RUNG: deposit_surplus and its #N sustaining ids are the deposit rung; a prereq override and other rungs are not', () => {
  for (const id of ['deposit_surplus', 'deposit_surplus#3207', 'deposit_surplus#1']) assert.equal(DO.isDepositMilestone(id), true, id)
  for (const id of ['deposit_surplus#3+prereq', 'return#12', 'deposit', 'xdeposit_surplus', null, undefined, 7]) assert.equal(DO.isDepositMilestone(id), false, String(id))
})

test('VERDICT: the gate order -- closed, then nothing to bank, then the reconciliation exemption, then due', () => {
  assert.deepEqual(V({ closed: 'bank closed' }), { ok: false, reason: 'bank_closed' })
  assert.deepEqual(V({ planLength: 0 }), { ok: false, reason: 'deposit_nothing_to_bank' })
  assert.deepEqual(V({ planLength: 0, reconcile: true }), { ok: true })
  assert.deepEqual(V({ bankable: 0, planLength: 0, reconcile: true }), { ok: true }, 'the cap reconciliation is always due (the old `reconcile ||`)')
})

test('VERDICT = depositDue off the rung: 12-item floor (or 30 slots), then storage in reach / near home', () => {
  assert.equal(V({ bankable: 11 }).reason, 'deposit_not_worth_it')
  assert.equal(V({ bankable: 11, storageWithin48: true }).reason, 'deposit_not_worth_it', 'below the floor even at the chest')
  assert.equal(V({ bankable: 11, occupiedSlots: 30, storageWithin48: true }).ok, true, 'a full bag lifts the floor')
  assert.equal(V({ bankable: 12 }).reason, 'deposit_not_worth_it', 'far, no storage')
  assert.equal(V({ bankable: 12, storageWithin48: true }).ok, true)
  assert.equal(V({ bankable: 12, distHome: 96 }).ok, true)
  assert.equal(V({ bankable: 12, distHome: 97 }).ok, false)
})

test('VERDICT ON THE DEPOSIT RUNG: the floor is 1 -- the rung is current from 4 bankable, so 4..11 must be admitted', () => {
  for (const n of [1, 4, 9, 11]) assert.equal(V({ bankable: n, onDepositMilestone: true }).ok, true, `${n} bankable on the rung`)
  assert.equal(V({ bankable: 0, planLength: 0, onDepositMilestone: true }).reason, 'deposit_nothing_to_bank', 'nothing is never due')
})

test('VERDICT = THE OLD GATE OFF THE RUNG, over a grid (the old code: `!plan && !reconcile` -> nothing; `reconcile || depositDue(...)`)', async () => {
  const { depositDue } = await import('../src/bankable.mjs')
  let n = 0, oks = 0
  for (const planLength of [0, 1, 3]) for (const reconcile of [false, true]) for (const bankable of [0, 1, 4, 11, 12, 13, 40])
    for (const occupiedSlots of [0, 29, 30, 36]) for (const distHome of [0, 96, 97, 500, NaN]) for (const storage of [false, true]) {
      const v = DO.depositVerdict({ planLength, reconcile, bankable, occupiedSlots, distHome, storageWithin48: storage })
      const old = (!planLength && !reconcile) ? 'deposit_nothing_to_bank'
        : (reconcile || depositDue({ bankable, distHome, storageWithin48: storage, onDepositMilestone: false, occupiedSlots })) ? 'ok' : 'deposit_not_worth_it'
      assert.equal(v.ok ? 'ok' : v.reason, old, JSON.stringify({ planLength, reconcile, bankable, occupiedSlots, distHome, storage }))
      n++; if (v.ok) oks++
    }
  assert.ok(n > 1000 && oks > 100 && oks < n - 100, `${n} cases, ${oks} admitted`)
})

test('VERDICT: storage is read ONLY when the answer depends on it (the world scan is the cost)', () => {
  let n = 0; const s = () => { n++; return true }
  V({ bankable: 5, storageWithin48: s }); assert.equal(n, 0, 'below the floor: no scan')
  V({ bankable: 12, distHome: 10, storageWithin48: s }); assert.equal(n, 0, 'near home: no scan')
  V({ bankable: 5, onDepositMilestone: true, storageWithin48: s }); assert.equal(n, 0, 'on the rung: no scan')
  V({ planLength: 0, storageWithin48: s }); assert.equal(n, 0, 'nothing to bank: no scan')
  assert.equal(V({ bankable: 12, storageWithin48: s }).ok, true); assert.equal(n, 1)
  assert.equal(V({ bankable: 12, storageWithin48: () => false }).ok, false)
})

test('OFFER: the full list when off, when the verdict admits, or when it could not be read; else deposit leaves the list', () => {
  const names = ['gather', 'deposit', 'home']
  const on = DO.depositOfferConfig({})
  assert.deepEqual(DO.offeredSkills({ cfg: DO.depositOfferConfig({ DEPOSITOFFER: '0' }), names, verdict: { ok: false, reason: 'x' } }).skills, names)
  assert.deepEqual(DO.offeredSkills({ cfg: on, names, verdict: { ok: true } }).skills, names)
  assert.deepEqual(DO.offeredSkills({ cfg: on, names, verdict: null }).skills, names)
  const s = DO.offeredSkills({ cfg: on, names, verdict: { ok: false, reason: 'deposit_not_worth_it' } })
  assert.deepEqual(s.skills, ['gather', 'home']); assert.equal(s.suppressed, 'deposit'); assert.equal(s.why, 'deposit_not_worth_it')
  assert.deepEqual(names, ['gather', 'deposit', 'home'], 'the input list is not mutated')
})

test('TALLY: the read line names offers suppressed and why, refusals per call, calls/min, skills/bot-h', () => {
  const l = DO.tallyLine({ secs: 600, c: { model_calls: 30, model_refused: 12, deposit_refused: 3, skills_run: 20, offered: 25, suppressed: 5, sup_deposit_nothing_to_bank: 4, sup_deposit_not_worth_it: 1 } })
  for (const want of ['secs=600', 'model_calls=30', 'calls_per_min=3.00', 'model_refused=12', 'refusals_per_call=0.400', 'deposit_refused=3',
    'skills_run=20', 'skills_per_bot_h=120.0', 'offered=25', 'suppressed=5', 'sup_nothing=4', 'sup_not_worth=1', 'sup_closed=0']) assert.ok(l.includes(want), `${want} in ${l}`)
  assert.match(DO.tallyLine({ secs: 0, c: {} }), /calls_per_min=0 /)
})

// ---- the real gate -------------------------------------------------------------------------------------------------------
const it = (name, count, slot) => ({ name, count, slot, type: mcData.itemsByName[name].id })
function gateBot ({ pos = new Vec3(400, 70, 400), chest = false, extra = [] } = {}) {
  const inv = [{ ...it('stone_pickaxe', 1, 9), maxDurability: 131, durabilityUsed: 11 }, it('cobblestone', 20, 10), ...extra]
  const blk = { position: pos.offset(2, 0, 0), type: mcData.blocksByName.chest.id, name: 'chest' }
  let scans = 0
  const bot = {
    entity: { position: pos, velocity: { x: 0, y: 0, z: 0 } }, health: 20, food: 20, oxygenLevel: 300,
    time: { day: 1, age: 1, timeOfDay: 1000 }, game: { dimension: 'overworld' }, serverDifficulty: 'peaceful',
    inventory: { items: () => inv }, registry: mcData, recipesFor: () => [], recipesAll: () => [],
    findBlock: (o) => { scans++; if (!chest) return null; try { return o?.matching?.(blk) ? blk : null } catch { return null } },
    findBlocks: () => [], blockAt: () => ({ name: 'air', boundingBox: 'empty' }), players: {}, entities: {}, username: 'OfferBot',
  }
  Object.defineProperty(bot, 'scans', { get: () => scans })
  return bot
}
const COPPER = n => [it('raw_copper', n, 12)]   // always banked (bankable.mjs DEPOSIT_ALWAYS), not counted by the CARRYING line
const IRON = n => [it('raw_iron', n, 12)]       // counted by the gate AND by the CARRYING line
const CASES = []
for (const pos of [new Vec3(400, 70, 400), new Vec3(30, 70, 30)])
  for (const chest of [false, true])
    for (const extra of [[], COPPER(6), COPPER(12), [it('apple', 4, 13)], [...COPPER(3), it('iron_ingot', 9, 14)]])
      for (const ms of [null, 'return#4', 'deposit_surplus#3207', 'deposit_surplus#3+prereq']) CASES.push({ pos, chest, extra, ms })

test(`THE GATE AND THE OFFER AGREE: over ${CASES.length} bags x places x rungs, check() refuses deposit {} for exactly the reason depositRunnable names`, () => {
  let refused = 0, admitted = 0
  for (const c of CASES) {
    const A = new AdmissionControl(null); A.activeMilestoneId = c.ms
    const v = A.depositRunnable(gateBot(c), null, null, c.ms)
    const r = A.check({ skill: 'deposit', args: {} }, gateBot(c), null)
    const tag = JSON.stringify({ pos: c.pos, chest: c.chest, extra: c.extra.map(x => `${x.name}x${x.count}`), ms: c.ms })
    if (v.ok) { admitted++; assert.notEqual(['bank_closed', 'deposit_nothing_to_bank', 'deposit_not_worth_it'].includes(r.reason), true, `${tag} ${JSON.stringify(r)}`) }
    else { refused++; assert.equal(r.reason, v.reason, `${tag} ${JSON.stringify(r)}`) }
    // A NAMED deposit of anything in the bag is refused whenever the unnamed one is (the offer drops both at once)
    if (!v.ok) for (const x of gateBot(c).inventory.items()) {
      const n = new AdmissionControl(null); n.activeMilestoneId = c.ms
      assert.equal(n.check({ skill: 'deposit', args: { item: x.name } }, gateBot(c), null).ok, false, `${tag} named ${x.name}`)
    }
  }
  assert.ok(refused >= 10 && admitted >= 10, `both outcomes exercised: ${refused} refused, ${admitted} admitted`)
})

test('THE AGREEMENT MUTANT KILLED: a gate that stops deciding not_worth_it by the verdict disagrees with the offer', async () => {
  await withMutant(ADM_PATH, "      if (dv.reason === 'deposit_not_worth_it') {", '      if (false) {', async M => {
    const A = new M.AdmissionControl(null); A.activeMilestoneId = 'return#4'
    assert.equal(A.depositRunnable(gateBot({ extra: COPPER(12) }), null, null, 'return#4').reason, 'deposit_not_worth_it')
    assert.equal(A.check({ skill: 'deposit', args: {} }, gateBot({ extra: COPPER(12) }), null).ok, true, 'the mutant gate admits what the offer refuses')
  })
})

test('THE RUNG FIX: on deposit_surplus#N with 6 bankable at a chest, far from home, deposit {} is admitted; off the rung it is not', () => {
  const A = new AdmissionControl(null)
  A.activeMilestoneId = 'deposit_surplus#3207'
  assert.equal(A.check({ skill: 'deposit', args: {} }, gateBot({ chest: true, extra: COPPER(6) }), null).ok, true)
  A.activeMilestoneId = 'return#3'
  assert.equal(A.check({ skill: 'deposit', args: {} }, gateBot({ chest: true, extra: COPPER(6) }), null).reason, 'deposit_not_worth_it', 'positive control: the floor still holds off the rung')
})

test('THE RUNG FIX MUTANT KILLED (the `#N` compare): with === "deposit_surplus" the rung refuses its own deposit again', async () => {
  await withMutant(ADM_PATH, 'onDepositMilestone: onDepositRung(milestoneId),', "onDepositMilestone: milestoneId === 'deposit_surplus',", async M => {
    const A = new M.AdmissionControl(null); A.activeMilestoneId = 'deposit_surplus#3207'
    assert.equal(A.check({ skill: 'deposit', args: {} }, gateBot({ chest: true, extra: COPPER(6) }), null).reason, 'deposit_not_worth_it')
  })
})

test('DECBUNDLE-01 DEPOSITRUNG: unset = the fix; =0 is the old literal compare, and it turns the offer off too', () => {
  assert.equal(DO.depositRungFixOn({}), true)
  assert.equal(DO.depositRungFixOn({ DEPOSITRUNG: '0' }), false)
  assert.equal(DO.onDepositRung('deposit_surplus#3207', {}), true)
  assert.equal(DO.onDepositRung('deposit_surplus#3207', { DEPOSITRUNG: '0' }), false)
  assert.equal(DO.onDepositRung('deposit_surplus', { DEPOSITRUNG: '0' }), true, 'the old compare, exactly')
  assert.equal(DO.onDepositRung('return#3', {}), false)
  assert.equal(DO.depositOfferConfig({ DEPOSITRUNG: '0' }).on, false)
  assert.equal(DO.depositOfferConfig({ DEPOSITRUNG: '1' }).on, true)
})

test('DECBUNDLE-01 DEPOSITRUNG=0 restores the old gate: on deposit_surplus#N with 6 bankable at a chest, far from home, deposit {} is refused again', () => {
  const was = process.env.DEPOSITRUNG
  process.env.DEPOSITRUNG = '0'
  try {
    const A = new AdmissionControl(null); A.activeMilestoneId = 'deposit_surplus#3207'
    assert.equal(A.check({ skill: 'deposit', args: {} }, gateBot({ chest: true, extra: COPPER(6) }), null).reason, 'deposit_not_worth_it')
    assert.equal(A.check({ skill: 'deposit', args: {} }, gateBot({ chest: true, extra: COPPER(12) }), null).ok, true, 'positive control: 12 is due either way')
  } finally { if (was === undefined) delete process.env.DEPOSITRUNG; else process.env.DEPOSITRUNG = was }
})

test('DECBUNDLE-01 MUTANT KILLED (the flag\'s fixed branch): onDepositRung back to the literal compare refuses the rung\'s own deposit', async () => {
  await withMutant(DO_PATH, '  return isDepositMilestone(id)\n', "  return id === 'deposit_surplus'\n", async M => {
    assert.equal(M.onDepositRung('deposit_surplus#3207', {}), false)
  })
})

test('THE RUNG FIX MUTANT KILLED (the floor): with the 12-item floor on the rung, 6 bankable at the chest are refused', async () => {
  await withMutant(DO_PATH, 'const minBankable = onDepositMilestone ? 1 : MIN_BANKABLE', 'const minBankable = MIN_BANKABLE', async M => {
    assert.equal(M.depositVerdict({ planLength: 1, bankable: 6, occupiedSlots: 5, distHome: 500, storageWithin48: true, onDepositMilestone: true }).reason, 'deposit_not_worth_it')
  })
})

test('THE OFFER READ IS A READ: no wants written to the bot, and no storage scan when the bag has nothing to bank', () => {
  const A = new AdmissionControl(null)
  const bot = gateBot()
  assert.equal(A.depositRunnable(bot, null, null, null).reason, 'deposit_nothing_to_bank')
  assert.equal(bot.currentWants, undefined); assert.equal(bot.scans, 0)
  const b2 = gateBot({ extra: COPPER(12) })
  assert.equal(A.depositRunnable(b2, null, null, null).reason, 'deposit_not_worth_it'); assert.equal(b2.scans, 1, 'positive control: the scan runs when it decides')
})

// ---- the real cognitive loop ---------------------------------------------------------------------------------------------
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcai-do-'))
let seq = 0
const RETURN = { id: 'return#7', wants: null, wantsAny: null, describe: 'Return home with what you gathered.', progress: '566 blocks from home', hint: 'use the home skill.' }
const SURPLUS = { id: 'deposit_surplus#3', wants: null, wantsAny: null, describe: 'Put your surplus in the town chest before heading out again.', progress: '6 bankable items carried', hint: 'deposit — you are at the chest already' }
/** One model call on the real loop; returns the enum and the user message the model was handed, and the tally rows. */
async function driveOnce (mod, { rung = RETURN, extra = [], chest = false, pos, cfg = null, proposal = { skill: 'explore', args: {} }, ms = 900, tallyNow = false, verdict = undefined } = {}) {
  const { config } = await import('../src/config.mjs')
  const was = config.llm.decisionCooldownMs
  config.llm.decisionCooldownMs = 400
  const rows = []
  const untap = tapRecords(r => { if (r?.skill?.name === '_depositoffer_tally') rows.push(r.skill.detail) })
  try {
    const calls = []
    const runs = []
    const runner = { isBusy: () => false, run: async (skill) => { runs.push(skill); return { status: 'success', detail: 'ok', contractEvidence: ['position: moved 3 blocks'] } } }
    const L = new Lessons(path.join(dir, `l${seq++}.json`)); L.data.avoid = {}; L.data.worked = {}
    const loop = new mod.CognitiveLoop(gateBot({ chest, extra, pos }), runner, L, null)
    loop.fewerDec = FD.fewerDecConfig({ FEWERDEC_PAUSEWAIT: '0', FEWERDEC_VETOSKIP: '0', FEWERDEC_CONTINUE: '0' })
    if (cfg) loop.depositOffer = cfg
    if (verdict !== undefined) loop.admission.depositRunnable = () => verdict
    if (tallyNow) loop.doTally = { t0: Date.now() - 11 * 60 * 1000, c: {} }
    loop.milestones.status = () => ({ ...rung })
    loop.milestones.refresh = () => false
    loop.llm = { decide: async ({ user, schema }) => { if (!/TRIGGER: startup/.test(user ?? '')) calls.push({ user, skills: schema?.properties?.skill?.enum ?? [] }); return { schemaValid: true, latencyMs: 1, raw: '{}', proposal: { ...proposal, reason: 'p' } } } }
    loop.start(); await new Promise(r => setTimeout(r, ms)); loop.stop()
    return { calls, rows, runs }
  } finally { untap(); config.llm.decisionCooldownMs = was }
}

test('LOOP: far from home with nothing bankable, the model is not offered deposit (the enum the grammar compiles)', async () => {
  const r = await driveOnce(await import('../src/cognitive.mjs'))
  assert.ok(r.calls.length >= 1, 'the model was asked')
  for (const c of r.calls) { assert.ok(!c.skills.includes('deposit'), c.skills.join(',')); assert.ok(c.skills.includes('home') && c.skills.includes('gather')) }
})
test('LOOP POSITIVE CONTROL: DEPOSITOFFER=0 offers deposit in the same place', async () => {
  const r = await driveOnce(await import('../src/cognitive.mjs'), { cfg: DO.depositOfferConfig({ DEPOSITOFFER: '0' }) })
  assert.ok(r.calls.length >= 1 && r.calls.every(c => c.skills.includes('deposit')))
})
test('LOOP: a runnable deposit is offered -- 12 bankable at a chest; and on deposit_surplus#N with 6 (no dead end on the rung)', async () => {
  const COG = await import('../src/cognitive.mjs')
  const a = await driveOnce(COG, { extra: IRON(12), chest: true })
  assert.ok(a.calls.length >= 1 && a.calls.every(c => c.skills.includes('deposit')), 'at the chest')
  assert.ok(a.calls.some(c => /CARRYING: /.test(c.user)), 'and the CARRYING line is shown')
  const b = await driveOnce(COG, { rung: SURPLUS, extra: COPPER(6), chest: true, proposal: { skill: 'deposit', args: {} } })
  assert.ok(b.calls.length >= 1 && b.calls.every(c => c.skills.includes('deposit')), 'on its own rung')
  assert.ok(b.runs.includes('deposit'), `the rung's deposit is admitted and runs: ${b.runs}`)
})
test('LOOP: the CARRYING line goes with the option -- near home with 12 bankable it is shown; the same bag with the verdict refused, not', async () => {
  const COG = await import('../src/cognitive.mjs')
  const pos = new Vec3(30, 70, 30)
  const open = await driveOnce(COG, { extra: IRON(12), pos })
  assert.ok(open.calls.length >= 1 && open.calls.every(c => /CARRYING: /.test(c.user) && c.skills.includes('deposit')), 'positive control: shown and offered')
  const shut = await driveOnce(COG, { extra: IRON(12), pos, verdict: { ok: false, reason: 'deposit_not_worth_it' } })
  assert.ok(shut.calls.length >= 1)
  for (const c of shut.calls) { assert.ok(!c.skills.includes('deposit')); assert.ok(!/CARRYING: /.test(c.user), 'no CARRYING line when deposit is not offered') }
})
test('PROMPT: buildUserPrompt drops only the CARRYING line when depositOffered is false', async () => {
  const P = await import('../src/prompt.mjs')
  const bot = gateBot({ extra: IRON(12), pos: new Vec3(30, 70, 30) })
  const args = { bot, milestone: { ...RETURN }, memory: { locations: {}, events: [] }, lastOutcome: null, trigger: 'idle', sentinel: 'END-X', lessons: [] }
  const on = P.buildUserPrompt(args).user, off = P.buildUserPrompt({ ...args, depositOffered: false }).user
  assert.match(on, /CARRYING: /); assert.doesNotMatch(off, /CARRYING: /)
  assert.equal(on.split('\n').filter(l => !/^CARRYING: /.test(l)).join('\n'), off)
})
test('LOOP TALLY: the depositoffer_tally row carries the counts (a window older than 10 min is flushed on the next count)', async () => {
  const r = await driveOnce(await import('../src/cognitive.mjs'), { tallyNow: true, ms: 900 })
  assert.equal(r.rows.length, 1, 'one row: the stale window flushes on the first decision, the next window is young')
  // the first counted event is the startup MODEL call (explore, admitted): its keys land together in that one row
  const f = Object.fromEntries(r.rows[0].split(' ').map(kv => kv.split('=')))
  assert.equal(f.model_calls, '1'); assert.equal(f.suppressed, '1'); assert.equal(f.offered, '0')
  assert.equal(f.sup_nothing, '1'); assert.equal(f.model_refused, '0'); assert.equal(f.skills_run, '0', 'the run is counted after the decision row')
  assert.equal(f.picks, 'explore:1', 'what the suppressed call chose instead')
  assert.equal(Number(f.model_calls), Number(f.offered) + Number(f.suppressed))
})
test('LOOP WIRING MUTANT KILLED: with the per-call schema unwired, deposit is offered where the gate refuses it', async () => {
  await withMutant(COG_PATH, 'schema: depOffer.suppressed ? this.schemaNoDeposit : this.schema })', 'schema: this.schema })', async M => {
    const r = await driveOnce(M)
    assert.ok(r.calls.length >= 1 && r.calls.some(c => c.skills.includes('deposit')))
  })
})
test('LOOP WIRING MUTANT KILLED: with the offer read unwired (no verdict), deposit is offered where the gate refuses it', async () => {
  await withMutant(COG_PATH, 'verdict: this.admission.depositRunnable(this.bot, null, this.#wantedItems(milestone), milestone?.id ?? null) })', 'verdict: null })', async M => {
    const r = await driveOnce(M)
    assert.ok(r.calls.length >= 1 && r.calls.some(c => c.skills.includes('deposit')))
  })
})
test('LOOP PROMPT MUTANT KILLED: with the prompt flag unwired, a refused deposit still shows the CARRYING line', async () => {
  await withMutant(COG_PATH, ', depositOffered: !depOffer.suppressed,', ',', async M => {
    const r = await driveOnce(M, { extra: IRON(12), pos: new Vec3(30, 70, 30), verdict: { ok: false, reason: 'deposit_not_worth_it' } })
    assert.ok(r.calls.length >= 1 && r.calls.some(c => /CARRYING: /.test(c.user)))
  })
})
