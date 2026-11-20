// DEPFIX-01 (showcase; R0.1 docs/reports/llm-bots/r0-2026-11-19.md): the refused-deposit regression. One source of truth for
// a deposit -- AdmissionControl.depositRunnable with item = null -- decides both what the model is OFFERED (depositoffer.mjs,
// ported from the fleet) and what a NAMED deposit the gate would refuse as nothing-to-bank becomes (widenedDeposit). Tested on
// the composition: the same bag never gets `deposit` offered and then refused, over a grid and on the live bag that refused 422
// of Onyx's 549 calls; then the real cognitive loop; then anchored mutants.
process.env.LOG_DIR = process.env.LOG_DIR || '/tmp/mcbot-test-logs-depfix'
process.env.BOT_NAME = process.env.BOT_NAME || 'DepfixBot'
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
const { depositPlan, DEPOSIT_ALWAYS } = await import('../src/bankable.mjs')
const { Lessons } = await import('../src/lessons.mjs')
const { tapRecords } = await import('../src/logger.mjs')

const DO_PATH = new URL('../src/depositoffer.mjs', import.meta.url)
const ADM_PATH = new URL('../src/admission.mjs', import.meta.url)
/** The repo's withMutant (climb-escape.test.mjs): the anchor must be present AND unique, or the mutant reads as killed.
 *  `extra` rewrites further imports so a mutant of one module is the one its importer loads. */
async function withMutant (p, old, neu, fn, extra = []) {
  const src = fs.readFileSync(p, 'utf8')
  assert.ok(src.includes(old), `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 60))} is not in ${p.pathname}`)
  assert.ok(src.split(old).length === 2, 'ANCHOR NOT UNIQUE: the mutant is ambiguous')
  const out = new URL(`./_mutant-depfix-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  let body = src.replace(old, neu)
  for (const [from, to] of extra) body = body.replace(from, to)
  fs.writeFileSync(out, body.replace(/from '\.\//g, "from '../src/"))
  try { return await fn(await import(`${out.href}?${Date.now()}_${Math.random()}`), out) } finally { try { fs.unlinkSync(out) } catch {} }
}
/** An admission module whose depositoffer import is the mutant at `doMut` (the mutant file is written first). */
async function withDoMutant (old, neu, fn) {
  return withMutant(DO_PATH, old, neu, async (_m, doOut) => {
    return withMutant(ADM_PATH, "import { depositVerdict, onDepositRung, widenedDeposit, depositWidenConfig } from './depositoffer.mjs'",
      `import { depositVerdict, onDepositRung, widenedDeposit, depositWidenConfig } from '${doOut.href}'`, fn)
  })
}

// ---- the pure rule ---------------------------------------------------------------------------------------------------
test('WIDEN CONFIG: unset = on; DEPOSITWIDEN=0 is off', () => {
  assert.equal(DO.depositWidenConfig({}).on, true)
  assert.equal(DO.depositWidenConfig({ DEPOSITWIDEN: '0' }).on, false)
  assert.equal(DO.depositWidenConfig({ DEPOSITWIDEN: '1' }).on, true)
})

test('WIDEN: only a NAMED nothing-to-bank refusal widens, and only to an unnamed deposit that would run', () => {
  const on = { on: true }, NOTHING = { ok: false, reason: 'deposit_nothing_to_bank' }
  let reads = 0
  const yes = () => { reads++; return { ok: true } }
  assert.deepEqual(DO.widenedDeposit({ cfg: on, item: 'wheat_seeds', named: NOTHING, unnamed: yes }), { verdict: { ok: true }, widened: true })
  assert.equal(DO.widenedDeposit({ cfg: on, item: 'wheat_seeds', named: NOTHING, unnamed: () => ({ ok: false, reason: 'deposit_not_worth_it' }) }).widened, false)
  assert.equal(DO.widenedDeposit({ cfg: on, item: 'wheat_seeds', named: NOTHING, unnamed: () => NOTHING }).verdict, NOTHING, 'the named refusal stands')
  reads = 0
  for (const c of [{ cfg: { on: false }, item: 'x', named: NOTHING }, { cfg: on, item: null, named: NOTHING }, { cfg: on, item: 'x', named: { ok: true } },
    { cfg: on, item: 'x', named: { ok: false, reason: 'deposit_not_worth_it' } }, { cfg: on, item: 'x', named: { ok: false, reason: 'bank_closed' } }]) {
    const r = DO.widenedDeposit({ ...c, unnamed: yes })
    assert.equal(r.widened, false, JSON.stringify(c)); assert.equal(r.verdict, c.named)
  }
  assert.equal(reads, 0, 'the unnamed verdict (a world scan) is read only when it can change the answer')
})

// ---- the real gate -----------------------------------------------------------------------------------------------------
const it = (name, count, slot, extra = {}) => ({ name, count, slot, type: mcData.itemsByName[name].id, ...extra })
const tool = (name, slot, used = 0) => it(name, 1, slot, { maxDurability: mcData.itemsByName[name].maxDurability, durabilityUsed: used })
function gateBot ({ pos = new Vec3(400, 70, 400), chest = false, inv = null, extra = [] } = {}) {
  const items = inv ?? [tool('stone_pickaxe', 9, 11), it('cobblestone', 20, 10), ...extra]
  const blk = { position: pos.offset(2, 0, 0), type: mcData.blocksByName.chest.id, name: 'chest' }
  return {
    entity: { position: pos, velocity: { x: 0, y: 0, z: 0 } }, health: 20, food: 20, oxygenLevel: 300,
    time: { day: 1, age: 1, timeOfDay: 1000 }, game: { dimension: 'overworld' }, serverDifficulty: 'peaceful',
    inventory: { items: () => items }, registry: mcData, recipesFor: () => [], recipesAll: () => [],
    findBlock: (o) => { if (!chest) return null; try { return o?.matching?.(blk) ? blk : null } catch { return null } },
    findBlocks: () => [], blockAt: () => ({ name: 'air', boundingBox: 'empty' }), players: {}, entities: {}, username: 'DepfixBot',
  }
}
/** showcase-Onyx's bag on f7cc2a19 (llm row 11-19, deposit_surplus#N, chest 2 blocks away, 422 of its 549 calls refused). */
function onyxBag () {
  let s = 9
  const st = (name, n) => { const out = []; while (n > 0) { out.push(it(name, Math.min(64, n), s++)); n -= 64 } return out }
  return [tool('stone_axe', s++, 19), tool('iron_shovel', s++, 1), ...st('stick', 7), ...st('wheat_seeds', 55), ...st('spruce_log', 29),
    tool('wooden_axe', s++), ...st('spruce_sapling', 8), tool('shears', s++), ...st('sand', 66), ...st('crafting_table', 2), ...st('tropical_fish', 3),
    ...st('spruce_planks', 1), ...st('cobblestone', 356), ...st('chest', 1), ...st('cobbled_deepslate', 1), ...st('diorite', 1), ...st('composter', 1),
    tool('iron_axe', s++, 93), ...st('bucket', 1), ...st('furnace', 1), ...st('sugar_cane', 64), tool('stone_pickaxe', s++, 68), tool('stone_pickaxe', s++, 0),
    tool('iron_pickaxe', s++), ...st('ladder', 3), ...st('dirt', 9), tool('stone_shovel', s++), tool('stone_hoe', s++, 90)]
}
const ONYX = { pos: new Vec3(-6, 71, 10), chest: true }
const RUNG = 'deposit_surplus#1520'

test('THE LIVE BAG: Onyx on its deposit rung naming wheat_seeds -- admitted as the offered (unnamed) deposit, and it moves something', () => {
  const A = new AdmissionControl(null); A.activeMilestoneId = RUNG
  const bot = gateBot({ ...ONYX, inv: onyxBag() })
  assert.equal(A.depositRunnable(bot, null, null, RUNG).ok, true, 'the offer: deposit is offered on this bag')
  const r = A.check({ skill: 'deposit', args: { item: 'wheat_seeds' } }, bot, null)
  assert.equal(r.ok, true, JSON.stringify(r))
  assert.equal(r.args.item, null, 'the skill runs the unnamed plan')
  assert.equal(A.lastDepositWidened, 'wheat_seeds')
  const plan = depositPlan(onyxBag(), null, { wants: DEPOSIT_ALWAYS })
  assert.ok(plan.length > 0 && !plan.some(p => p.name === 'wheat_seeds'), `the plan banks surplus, not the named seeds: ${JSON.stringify(plan)}`)
})

test('THE LIVE BAG, POSITIVE CONTROL: DEPOSITWIDEN=0 reproduces the live refusal word for word', () => {
  const was = process.env.DEPOSITWIDEN
  process.env.DEPOSITWIDEN = '0'
  try {
    const A = new AdmissionControl(null); A.activeMilestoneId = RUNG
    const r = A.check({ skill: 'deposit', args: { item: 'wheat_seeds' } }, gateBot({ ...ONYX, inv: onyxBag() }), null)
    assert.equal(r.reason, 'deposit_nothing_to_bank')
    assert.equal(r.detail, 'not a banking target (no goal wants it): you are carrying wheat_seeds — nothing to deposit')
    assert.equal(A.lastDepositWidened, null)
  } finally { if (was === undefined) delete process.env.DEPOSITWIDEN; else process.env.DEPOSITWIDEN = was }
})

test('A NAMED ITEM WITH ITS OWN PLAN IS NOT WIDENED: Onyx naming cobblestone deposits cobblestone', () => {
  const A = new AdmissionControl(null); A.activeMilestoneId = RUNG
  const r = A.check({ skill: 'deposit', args: { item: 'cobblestone' } }, gateBot({ ...ONYX, inv: onyxBag() }), null)
  assert.equal(r.ok, true); assert.equal(r.args.item, 'cobblestone'); assert.equal(A.lastDepositWidened, null)
})

const COPPER = n => [it('raw_copper', n, 12)]
const CASES = []
for (const pos of [new Vec3(400, 70, 400), new Vec3(30, 70, 30), new Vec3(-6, 71, 10)])
  for (const chest of [false, true])
    for (const extra of [[], COPPER(6), COPPER(12), [it('apple', 4, 13)], [...COPPER(3), it('iron_ingot', 9, 14)], [it('wheat_seeds', 55, 15), ...COPPER(13)], 'onyx'])
      for (const ms of [null, 'return#4', RUNG]) CASES.push({ pos, chest, extra, ms })

test(`COMPOSITION: over ${CASES.length} bags x places x rungs, deposit is offered exactly when every deposit of a held item is admitted or refused only on its own name`, () => {
  let offered = 0, notOffered = 0, widened = 0, ownName = 0
  for (const c of CASES) {
    const mk = () => gateBot({ pos: c.pos, chest: c.chest, ...(c.extra === 'onyx' ? { inv: onyxBag() } : { extra: c.extra }) })
    const A = new AdmissionControl(null); A.activeMilestoneId = c.ms
    const v = A.depositRunnable(mk(), null, null, c.ms)
    const offer = DO.offeredSkills({ cfg: DO.depositOfferConfig({}), names: ['gather', 'deposit', 'home'], verdict: v })
    const tag = JSON.stringify({ pos: c.pos, chest: c.chest, extra: c.extra === 'onyx' ? 'onyx' : c.extra.map(x => `${x.name}x${x.count}`), ms: c.ms })
    assert.equal(offer.skills.includes('deposit'), !!v.ok, tag)
    const names = [...new Set(mk().inventory.items().map(x => x.name))].filter(n => !/_sword$/.test(n))
    for (const name of [null, ...names]) {
      const B = new AdmissionControl(null); B.activeMilestoneId = c.ms
      const r = B.check({ skill: 'deposit', args: name ? { item: name } : {} }, mk(), null)
      if (!v.ok) { assert.equal(r.ok, false, `${tag} ${name}: refused whenever not offered`); continue }
      assert.ok(!['deposit_nothing_to_bank', 'deposit_not_worth_it', 'bank_closed'].includes(r.reason), `${tag} ${name}: offered, then refused ${JSON.stringify(r)}`)
      if (!name || !r.ok) continue
      const own = depositPlan(mk().inventory.items(), name, { wants: DEPOSIT_ALWAYS }).length > 0
      if (own) { ownName++; assert.equal(r.args.item, name, `${tag} ${name} keeps its own plan`); assert.equal(B.lastDepositWidened, null) }
      else { widened++; assert.equal(r.args.item, null, `${tag} ${name} widened`); assert.equal(B.lastDepositWidened, name) }
    }
    if (v.ok) offered++; else notOffered++
  }
  assert.ok(offered >= 10 && notOffered >= 10 && widened >= 20 && ownName >= 10, `all exercised: offered ${offered}, not ${notOffered}, widened ${widened}, own ${ownName}`)
})

test('MUTANT KILLED (the widening unwired): Onyx naming wheat_seeds is refused again', async () => {
  await withMutant(ADM_PATH, '      if (wide.widened) { dv = wide.verdict; args.item = null; this.lastDepositWidened = arg.item }', '      if (false) {}', async M => {
    const A = new M.AdmissionControl(null); A.activeMilestoneId = RUNG
    assert.equal(A.check({ skill: 'deposit', args: { item: 'wheat_seeds' } }, gateBot({ ...ONYX, inv: onyxBag() }), null).reason, 'deposit_nothing_to_bank')
  })
})

test('MUTANT KILLED (the name kept): a widened deposit that keeps item=wheat_seeds would run a plan that moves nothing', async () => {
  await withMutant(ADM_PATH, 'if (wide.widened) { dv = wide.verdict; args.item = null;', 'if (wide.widened) { dv = wide.verdict;', async M => {
    const A = new M.AdmissionControl(null); A.activeMilestoneId = RUNG
    const r = A.check({ skill: 'deposit', args: { item: 'wheat_seeds' } }, gateBot({ ...ONYX, inv: onyxBag() }), null)
    assert.equal(r.ok, true); assert.equal(r.args.item, 'wheat_seeds')
    assert.equal(depositPlan(onyxBag(), r.args.item, { wants: DEPOSIT_ALWAYS }).length, 0, 'what the real test rules out')
  })
})

test('MUTANT KILLED (widen past a refused unnamed deposit): far from home, a named apple would lose its own refusal for the unnamed one', async () => {
  const bag = { pos: new Vec3(400, 70, 400), chest: false, extra: [it('apple', 4, 13), ...COPPER(6)] }
  const A = new AdmissionControl(null)
  assert.equal(A.depositRunnable(gateBot(bag), null, null, null).reason, 'deposit_not_worth_it', 'positive control: not offered here')
  const r = A.check({ skill: 'deposit', args: { item: 'apple' } }, gateBot(bag), null)
  assert.equal(r.reason, 'deposit_nothing_to_bank', 'the named refusal stands, naming its own rule')
  assert.match(r.detail, /carrying apple/)
  assert.equal(A.lastDepositWidened, null)
  await withDoMutant('  if (!u?.ok) return { verdict: named, widened: false }\n', '', async M => {
    const B = new M.AdmissionControl(null)
    const m = B.check({ skill: 'deposit', args: { item: 'apple' } }, gateBot(bag), null)
    assert.notEqual(m.reason, 'deposit_nothing_to_bank', 'the mutant swaps in the unnamed refusal and drops the name')
    assert.equal(B.lastDepositWidened, 'apple')
  })
})

test('MUTANT KILLED (widen a name with its own plan): Onyx naming cobblestone would bank everything instead', async () => {
  await withDoMutant("  if (!cfg?.on || !item || !named || named.ok || named.reason !== 'deposit_nothing_to_bank') return { verdict: named, widened: false }\n",
    "  if (!cfg?.on || !item || !named) return { verdict: named, widened: false }\n", async M => {
      const A = new M.AdmissionControl(null); A.activeMilestoneId = RUNG
      const r = A.check({ skill: 'deposit', args: { item: 'cobblestone' } }, gateBot({ ...ONYX, inv: onyxBag() }), null)
      assert.equal(r.args.item, null)
    })
})

// ---- the real cognitive loop ---------------------------------------------------------------------------------------------
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcai-depfix-'))
let seq = 0
const SURPLUS = { id: RUNG, wants: null, wantsAny: null, describe: 'Put your surplus in the town chest before heading out again.', progress: '5 bankable items carried', hint: 'deposit — you are at the chest already' }
const RETURN = { id: 'return#7', wants: null, wantsAny: null, describe: 'Return home with what you gathered.', progress: '566 blocks from home', hint: 'use the home skill.' }
/** The real loop with a scripted model that names `want` when the enum offers it, else explore; records what the gate saw. */
async function drive ({ rung = SURPLUS, bot, want = { skill: 'deposit', args: { item: 'wheat_seeds' } }, ms = 900, tallyNow = false }) {
  const { config } = await import('../src/config.mjs')
  const COG = await import('../src/cognitive.mjs')
  const was = config.llm.decisionCooldownMs
  config.llm.decisionCooldownMs = 400
  const rows = []
  const untap = tapRecords(r => { if (r?.skill?.name === '_depositoffer_tally') rows.push(r.skill.detail) })
  try {
    const calls = [], runs = [], gate = []
    const runner = { isBusy: () => false, run: async (skill, args) => { runs.push({ skill, args: { ...args } }); return { status: 'success', detail: 'ok', contractEvidence: ['position: moved 3 blocks'] } } }
    const L = new Lessons(path.join(dir, `l${seq++}.json`)); L.data.avoid = {}; L.data.worked = {}
    const loop = new COG.CognitiveLoop(bot, runner, L, null)
    loop.fewerDec = FD.fewerDecConfig({ FEWERDEC_PAUSEWAIT: '0', FEWERDEC_VETOSKIP: '0', FEWERDEC_CONTINUE: '0' })
    if (tallyNow) loop.doTally = { t0: Date.now() - 11 * 60 * 1000, c: {} }
    loop.milestones.status = () => ({ ...rung })
    loop.milestones.refresh = () => false
    const check = loop.admission.check.bind(loop.admission)
    loop.admission.check = (p, b, w) => { const r = check(p, b, w); gate.push({ skill: p?.skill, ok: r.ok, reason: r.reason ?? null }); return r }
    loop.llm = { decide: async ({ user, schema }) => {
      const skills = schema?.properties?.skill?.enum ?? []
      if (!/TRIGGER: startup/.test(user ?? '')) calls.push({ user, skills })
      const proposal = skills.includes(want.skill) ? want : { skill: 'explore', args: {} }
      return { schemaValid: true, latencyMs: 1, raw: '{}', proposal: { ...proposal, args: { ...proposal.args }, reason: 'p' } }
    } }
    loop.start(); await new Promise(r => setTimeout(r, ms)); loop.stop()
    return { calls, runs, gate, rows, tally: loop.doTally?.c ?? {} }
  } finally { untap(); config.llm.decisionCooldownMs = was }
}

test('LOOP: Onyx\'s bag on its rung -- deposit is offered, the named wheat_seeds deposit is admitted and RUNS unnamed; no deposit refusal', async () => {
  const r = await drive({ bot: gateBot({ ...ONYX, inv: onyxBag() }) })
  assert.ok(r.calls.length >= 1 && r.calls.every(c => c.skills.includes('deposit')), 'offered')
  const dep = r.runs.filter(x => x.skill === 'deposit')
  assert.ok(dep.length >= 1, `the deposit ran: ${JSON.stringify(r.runs)}`)
  for (const d of dep) assert.equal(d.args.item, null)
  assert.equal(r.gate.filter(g => g.skill === 'deposit' && !g.ok).length, 0, JSON.stringify(r.gate))
})

test('LOOP: nothing to bank, far from home -- deposit is not offered, so the gate is never asked a deposit (the same state, both sides)', async () => {
  const r = await drive({ rung: RETURN, bot: gateBot() })
  assert.ok(r.calls.length >= 1 && r.calls.every(c => !c.skills.includes('deposit')))
  assert.ok(r.gate.length >= 1, 'positive control: the gate was asked (explore)')
  assert.equal(r.gate.filter(g => g.skill === 'deposit').length, 0)
})

test('LOOP TALLY: the depositoffer counts carry the widened deposit, and the row prints it', async () => {
  const r = await drive({ bot: gateBot({ ...ONYX, inv: onyxBag() }) })
  const why = JSON.stringify(r.tally) + ' gate=' + JSON.stringify(r.gate)
  assert.ok((r.tally.model_calls ?? 0) >= 1 && (r.tally.deposit_widened ?? 0) >= 1, why)
  assert.equal(r.tally.deposit_widened, r.runs.filter(x => x.skill === 'deposit').length, why)
  assert.equal(r.tally.deposit_refused ?? 0, 0, why)
  assert.match(DO.tallyLine({ secs: 600, c: r.tally }), new RegExp(`deposit_widened=${r.tally.deposit_widened} `))
})
