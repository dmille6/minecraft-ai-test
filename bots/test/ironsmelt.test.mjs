// IRONSMELT-01: THE TOWN SMELT JOB SMELTS RAW IRON (FIRST), AND DOES NOT DISPATCH INTO A TOWN IT HAS SEEN EMPTY
// (docs/reports/ironsmelt-01-design-2026-10-23.md; OWNER 2026-10-23 ~12:40Z "yes build now").
//
// Behaviour, not text: the decisions are smeltjob.mjs's pure exports (ironsmeltMode, indexRuledOut, ironSmeltCount,
// ironBankPlan, smeltTownOrder's gate), driven directly; then the REAL smelt_town skill over the fake world (real withdraw
// clicks, real holds, real deposits; the fake's furnace does not smelt, so a job that took its input and coal ends at the
// furnace and BANKS -- the exit every ownership claim is about); then the REFUSAL CHAIN through the REAL CognitiveLoop: a town
// the index knows is empty gets no smelt_town (the bot keeps its other moves), and one deposit re-opens it; and anchored
// mutants (withMutant: the anchor present and unique, or the mutant is no kill).
//
// MEASURED 10-23: 1,359 of 1,661 jobs in 24 h ended town_has_none; of the 1,574 opens those jobs made that the index saw,
// 1,322 were of a container the index already KNEW held no raw copper, and 466 of 570 such jobs opened a container holding
// raw iron. The index's false-empty rate (13 h, 13 pools): 1 of 3,511 clean pairs for raw copper, 0 of 1,536 for raw iron.
import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'

process.env.LOG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-ironsmelt-logs-'))
process.env.BOT_NAME = 'IronSmeltBot'
process.env.OLLAMA_MODEL ??= 'qwen2.5:7b-instruct'
process.env.HOME_X = '0'; process.env.HOME_Y = '64'; process.env.HOME_Z = '0'
process.env.MEMORY_SCOPE = 'shared'; process.env.MEMORY_POOL = 'hive-test'
process.env.SKILL_TIMEOUT_MS = '180000'   // withdraw's clock is the skill timeout; the suite's 300 ms leaves no walk
process.env.LLM_DECISION_COOLDOWN_MS = '50'
process.env.LOG_LEVEL = 'error'
process.env.BOT_ROLE = 'gatherer'
process.env.PLINTH_FIRST = '0'            // as toolkit/kitsearch: this fake town has no junk well by construction
delete process.env.IRONSMELT; delete process.env.SMELT_RULEOUT; delete process.env.SMELT_JOB
const freshPool = () => { process.env.POOL_STATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-ironsmelt-pool-')) }
freshPool()

const SJ = await import('../src/smeltjob.mjs')
const S0 = await import('../src/skills.mjs')
const CF = await import('../src/chestfull.mjs')
const TI = await import('../src/townindex.mjs')
const { clearWithdrawHolds } = await import('../src/bankable.mjs')
const { tapRecords } = await import('../src/logger.mjs')
const { fakeWorld, stack } = await import('./fakeworld.mjs')

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 4).join('\n        ')}`) }
}
const RECS = []
tapRecords(r => RECS.push(r))
const sig = () => new AbortController().signal
const SKILLS_PATH = new URL('../src/skills.mjs', import.meta.url)
const SJ_PATH = new URL('../src/smeltjob.mjs', import.meta.url)
// climb-escape.test.mjs's withMutant: the anchor must be present AND unique, or the "kill" is no kill
async function withMutant (p, old, neu, fn) {
  const src = readFileSync(p, 'utf8')
  assert.ok(src.includes(old), `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 70))} is not in ${p.pathname}. A mutant that was never written reads as killed.`)
  assert.ok(src.split(old).length === 2, 'the mutation target is not unique; the mutant is ambiguous')
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, src.replace(old, neu).replace(/from '\.\//g, "from '../src/"))
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}
const killedBy = async fn => { try { await fn(); return false } catch (e) { if (e instanceof assert.AssertionError) return true; throw e } }

const realNow = Date.now
let offset = 0
Date.now = () => realNow() + offset
const later = ms => { offset += ms }

const HOME = { x: 0, y: 64, z: 0 }
const memDir = () => process.env.POOL_STATE_DIR
const HK = TI.indexHomeKey(HOME)
const count = (slots, name) => slots.filter(Boolean).reduce((n, it) => n + (it.name === name ? it.count : 0), 0)
const kOf = ([x, y, z]) => `${x},${y},${z}`
const withServer = w => {
  w.bot.craftSync = { lockstep: fn => fn(), recount: async () => ({ source: 'server', items: w.bot.inventory.items() }), inflight: () => 0,
    confirmCursor: async win => ({ answered: true, cursorEmpty: !win.selectedItem, carried: win.selectedItem ? { itemCount: win.selectedItem.count } : null }) }
  return w
}
/** smeltsearch.test.mjs's town: 9 single chests (the bot at 6.5,64,0.5), each holding dirt unless set; COPPER the nearest. */
const CHESTS = [[5, 64, 3], [8, 64, -3], [2, 64, -5], [10, 64, 4], [0, 64, 6], [12, 64, -2], [-2, 64, 2], [4, 64, 9], [-5, 64, -4]]
const NEAR = CHESTS[0], FAR = CHESTS[7]
function town ({ bag = [stack('cobblestone', 3)], stock = {} } = {}) {
  freshPool(); clearWithdrawHolds(); TI.resetIndexCache(); offset += 3 * 60 * 60_000      // a fresh town; every earlier miss stale
  const w = withServer(fakeWorld({ bag: bag.map((s, i) => ({ ...s, slot: 9 + i })) }))
  for (const c of CHESTS) { w.set(...c, 'chest'); w.stock(...c, [stack('dirt', 5)]) }
  for (const [k, items] of Object.entries(stock)) w.stock(...k.split(',').map(Number), items)
  return w
}
const chest = (w, c) => w.containers.get(kOf(c)).slots
const townTotal = (w, name) => CHESTS.reduce((n, c) => n + count(chest(w, c), name), 0)
const job = (S, w, ctx = {}) => S.SKILLS.smelt_town.run({ bot: w.bot, ...ctx }, {}, sig())
const lastRow = () => RECS.filter(x => x?.skill?.name === '_smelt_town').at(-1)?.skill?.detail ?? ''
const field = (row, k) => (row.match(new RegExp(`(?:^| )${k}=(\\S+)`)) || [])[1]
/** An index observation of container `c` (what an open by any skill writes: townindex.mjs), with `names` the server's contents. */
const seenByIndex = (c, names = { dirt: [5, 1] }, at = Date.now()) =>
  TI.appendIndex(memDir(), HK, null, { t: 'obs', id: `o-${at}-${kOf(c)}-${Math.random().toString(36).slice(2, 6)}`, k: kOf(c), h: [kOf(c)], at, bot: 'Other', by: 'count_town', names, used: 1, size: 27 })
const dirtyByIndex = (c, at = Date.now()) =>
  TI.appendIndex(memDir(), HK, null, { t: 'dirty', id: `d-${at}-${kOf(c)}`, k: kOf(c), h: [kOf(c)], at, bot: 'Other', by: 'deposit', phase: 'post', op: `op-${at}` })

// ---- the pure decisions ----------------------------------------------------------------------------------------------
await t('THE SWITCHES: IRONSMELT on by default (off|0|false|no -> off; unreadable -> on, said); SMELT_RULEOUT rides on it; the mode row names both', () => {
  assert.deepEqual(SJ.ironsmeltMode({}), { on: true, mode: 'on', note: 'IRONSMELT unset' })
  for (const v of ['off', 'OFF', '0', 'false', 'no']) assert.equal(SJ.ironsmeltMode({ IRONSMELT: v }).on, false, v)
  assert.equal(SJ.ironsmeltMode({ IRONSMELT: 'maybe' }).on, true)
  assert.match(SJ.ironsmeltMode({ IRONSMELT: 'maybe' }).note, /unreadable/)
  assert.equal(SJ.ruleoutMode({}, { on: true }).on, true)
  assert.equal(SJ.ruleoutMode({ SMELT_RULEOUT: 'off' }, { on: true }).on, false)
  assert.equal(SJ.ruleoutMode({}, { on: false }).on, false, 'IRONSMELT=off is the base exactly: no rule-out either')
  assert.deepEqual([...SJ.jobInputs(true)], ['raw_iron', 'raw_copper'], 'iron FIRST')
  assert.deepEqual([...SJ.jobInputs(false)], ['raw_copper'])
  assert.equal(SJ.IRONSMELT.on, true); assert.equal(SJ.SMELT_RULEOUT.on, true)
  assert.match(SJ.ironsmeltModeDetail(), /^phase=mode on=1 mode=on inputs=raw_iron,raw_copper miss_h=2 rule_out=index_known_none/)
  assert.match(SJ.ironsmeltModeDetail({ on: false, mode: 'off' }, { on: false }), /on=0 mode=off inputs=raw_copper .*rule_out=off/)
})

const NOW = 1_800_000_000_000
const entry = ({ names = { dirt: [5, 1] }, at = NOW - 60_000, h = null, dirtyAfter = false, k = '1,64,1' } = {}) => {
  const recs = [{ t: 'obs', id: 'o1', k, h: h ?? [k], at, names, used: 1, size: 27, w: null }]
  if (dirtyAfter) recs.push({ t: 'dirty', id: 'd1', k, h: [k], at: at + 1000, phase: 'post', op: 'x', w: null })
  return TI.foldIndex(recs).worlds.null
}
await t('indexRuledOut: KNOWN + fresh (< the miss life) + holds none -> ruled out (both halves); holding it, dirty, stale, future-dated, or deposited into since -> NOT', () => {
  const ru = (e, opts = {}) => SJ.indexRuledOut(e, 'raw_iron', NOW, { ttl: SJ.IRON_MISS_TTL_MS, ...opts })
  assert.deepEqual([...ru(entry()).keys], ['1,64,1']); assert.equal(ru(entry()).n, 1)
  assert.deepEqual([...ru(entry({ h: ['1,64,1', '1,64,2'] })).keys].sort(), ['1,64,1', '1,64,2'], 'a double chest: both halves')
  assert.equal(ru(entry({ names: { raw_iron: [3, 1] } })).n, 0, 'holds the input')
  assert.equal(SJ.indexRuledOut(entry({ names: { raw_iron: [3, 1] } }), 'raw_copper', NOW).n, 1, 'per need: iron there says nothing about copper')
  assert.equal(ru(entry({ dirtyAfter: true })).n, 0, 'a mutation mark after the observation')
  assert.equal(ru(entry({ at: NOW - SJ.IRON_MISS_TTL_MS - 1 })).n, 0, 'older than the miss life (2 h), though the index calls it known to 6 h')
  assert.equal(ru(entry({ at: NOW - SJ.IRON_MISS_TTL_MS + 60_000 })).n, 1, 'CONTROL: inside the miss life')
  assert.equal(ru(entry({ at: NOW + SJ.INDEX_FUTURE_SLACK_MS + 1 })).n, 0, 'stamped in the future')
  assert.equal(ru(entry(), { tookAt: { '1,64,1': NOW - 60_000 + SJ.RULE_OUT_TOOK_SLACK_MS + 1 } }).n, 0, 'a deposit recorded after it (town memory)')
  assert.equal(ru(entry(), { tookAt: { '1,64,1': NOW - 60_000 + 1 } }).n, 1, 'CONTROL: the took of the verifying re-open itself (1 ms after)')
  assert.equal(SJ.indexRuledOut({}, 'raw_iron', NOW).n, 0); assert.equal(SJ.indexRuledOut(entry(), null, NOW).n, 0)
})
await t('ironSmeltCount: at most the batch, the town take, and the bag ABOVE its opening count -- the bag\'s own raw iron is never fed', () => {
  assert.equal(SJ.ironSmeltCount({ withdrawn: 8, raw0: 3, rawNow: 11 }), 8)
  assert.equal(SJ.ironSmeltCount({ withdrawn: 5, raw0: 3, rawNow: 8 }), 5, 'own 3 + town 5: smelt 5, not 8')
  assert.equal(SJ.ironSmeltCount({ withdrawn: 12, raw0: 0, rawNow: 12 }), 8, 'the batch')
  assert.equal(SJ.ironSmeltCount({ withdrawn: 8, raw0: 3, rawNow: 5 }), 2, 'a take that went missing (a pickup lost, a toss): only what is above the own')
  assert.equal(SJ.ironSmeltCount({ withdrawn: 8, raw0: 3, rawNow: 2 }), 0)
})
await t('ironBankPlan: per name, exactly above the opening count; own held back; prior raw input bounded by take + prior', () => {
  // own 3 raw + 2 ingots; took 8, smelted 8 (the furnace also had 2 prior ingots taken): bank 10 ingots, 0 raw; hold 2 / 3
  assert.deepEqual(SJ.ironBankPlan({ raw0: 3, ingot0: 2, rawNow: 3, ingotNow: 12, withdrawn: 8 }), { iron_ingot: { deposit: 10, own: 2 }, raw_iron: { deposit: 0, own: 3 } })
  // a partial smelt: 5 of 8 made, 3 raw back from the furnace
  assert.deepEqual(SJ.ironBankPlan({ raw0: 3, ingot0: 2, rawNow: 6, ingotNow: 7, withdrawn: 8 }), { iron_ingot: { deposit: 5, own: 2 }, raw_iron: { deposit: 3, own: 3 } })
  // a raw iron picked up on the walk is not the town's to bank beyond the take (+ prior)
  assert.deepEqual(SJ.ironBankPlan({ raw0: 0, ingot0: 0, rawNow: 9, ingotNow: 0, withdrawn: 8 }).raw_iron, { deposit: 8, own: 1 })
  assert.deepEqual(SJ.ironBankPlan({ raw0: 0, ingot0: 0, rawNow: 9, ingotNow: 0, withdrawn: 8, priorRaw: 1 }).raw_iron, { deposit: 9, own: 0 })
  // the bag lost own iron meanwhile: nothing is banked, nothing goes negative
  assert.deepEqual(SJ.ironBankPlan({ raw0: 3, ingot0: 2, rawNow: 1, ingotNow: 1, withdrawn: 8 }), { iron_ingot: { deposit: 0, own: 1 }, raw_iron: { deposit: 0, own: 1 } })
})
const orderOf = (o = {}) => SJ.smeltTownOrder({ now: 1e12, atTown: true, freeSlots: 5, held: {}, townMiss: true, ironMiss: true, state: {}, ...o })
await t('THE GATE (smeltTownOrder): iron in town -> an order (iron first, even with copper carried); neither input anywhere and no copper -> town_has_none; IRONSMELT off -> the base', () => {
  assert.match(orderOf({ ironMiss: false }).order?.why ?? '', /raw iron .* iron ingots/)
  assert.match(orderOf({ ironMiss: false, held: { raw_copper: 4 } }).order?.why ?? '', /raw iron/, 'iron first, even with copper carried')
  assert.equal(orderOf().skip, 'town_has_none')
  assert.equal(orderOf().state.lastIssuedAt, 1e12, 'the look is charged the cooldown (base)')
  assert.match(orderOf({ held: { raw_copper: 4 } }).order?.why ?? '', /4 raw_copper/, 'the bag\'s copper still dispatches')
  assert.ok(orderOf({ held: { copper_ingot: 4 } }).order, 'carried ingots still dispatch (the carry return)')
  assert.ok(orderOf({ townMiss: false }).order, 'copper in town still dispatches')
  // IRONSMELT off: the iron reading is never even taken
  let asked = 0
  const off = orderOf({ iron: false, ironMiss: () => { asked++; return false } })
  assert.equal(off.skip, 'town_has_none'); assert.equal(asked, 0, 'the base gate exactly')
  // the cheap gates still come first (the look is lazy)
  assert.equal(orderOf({ freeSlots: 1, ironMiss: () => { throw new Error('read before room') } }).skip, 'room')
})

// ---- the real skill over the fake world ----------------------------------------------------------------------------
const ironFirst = async S => {
  // the NEAR chest holds raw copper; the FAR chest raw iron and coal: the job takes the IRON
  const w = town({ stock: { [kOf(NEAR)]: [stack('raw_copper', 8)], [kOf(FAR)]: [stack('raw_iron', 8), stack('coal', 4)] } })
  const r = await job(S, w)
  const row = lastRow()
  assert.equal(field(row, 'in'), 'fe', row)
  assert.equal(field(row, 'withdrawn'), '8', row)
  assert.equal(r.stop, 'no_furnace', `${r.status} ${r.stop} ${r.detail}`)
  assert.equal(count(chest(w, NEAR), 'raw_copper'), 8, 'the copper is not touched')
  assert.equal(townTotal(w, 'raw_iron'), 8, 'no furnace: the town\'s raw iron goes back')
  assert.equal(townTotal(w, 'coal'), 4, 'and its coal')
  assert.equal(count(w.bag, 'raw_iron'), 0); assert.equal(w.dropped.length, 0)
  assert.match(row, /verdict=ok/, row)
}
await t('IRON FIRST: raw copper in the NEAREST chest, raw iron + coal in a far one -> the job takes the 8 raw iron (in=fe), never the copper; the no-furnace exit banks the iron and coal back', async () => {
  await ironFirst(S0)
})
const ownIron = async S => {
  const w = town({ bag: [stack('cobblestone', 3), stack('raw_iron', 3), stack('iron_ingot', 2)], stock: { [kOf(FAR)]: [stack('raw_iron', 8), stack('coal', 4)] } })
  const r = await job(S, w)
  const row = lastRow()
  assert.equal(r.stop, 'no_furnace', `${r.status} ${r.stop} ${r.detail}`)
  assert.equal(count(w.bag, 'raw_iron'), 3, `the bag keeps its OWN 3 raw iron: ${row}`)
  assert.equal(count(w.bag, 'iron_ingot'), 2, 'and its own 2 ingots')
  assert.equal(townTotal(w, 'raw_iron'), 8, 'exactly the town\'s 8 back in town')
  assert.equal(townTotal(w, 'iron_ingot'), 0, 'none of the bag\'s ingots banked')
  assert.equal(field(row, 'fe'), '3/2>3/2', row); assert.match(row, /verdict=ok/, row)
}
await t('OWN IRON: a bag holding its own 3 raw iron + 2 ingots -> the job takes the town\'s 8, and every exit banks exactly the town\'s; fe=3/2>3/2, verdict=ok', async () => {
  await ownIron(S0)
})
const smeltCountScene = async S => {
  // a furnace in reach (past the furnace check); the town holds 5 raw iron; the bag its own 3: the furnace is fed 5, never 8
  const w = town({ bag: [stack('cobblestone', 3), stack('raw_iron', 3)], stock: { [kOf(FAR)]: [stack('raw_iron', 5), stack('coal', 4)] } })
  w.set(1, 64, -1, 'furnace')
  const r = await job(S, w, { runner: { current: { startedAt: Date.now() } } })
  const row = lastRow()
  assert.equal(field(row, 'withdrawn'), '5', row)
  assert.equal(field(row, 'n'), '5', `the smelt is sized to the town take, never the bag's own: ${row} (${r.stop})`)
  assert.equal(count(w.bag, 'raw_iron'), 3, 'the bag ends with its own 3')
}
await t('THE SMELT COUNT: town 5 raw iron + the bag\'s own 3 -> the job asks the furnace for 5 (n=5), never 8; the bag ends with its own 3', async () => {
  await smeltCountScene(S0)
})
const roomKeepScene = async S => {
  // a full bag (34 dirt stacks + own raw iron + own ingots): the take of raw iron merges into the bag's raw stack, the coal needs
  // a slot -- the room-making deposit must never bank the bag's OWN ingots for it
  const bag = [...Array.from({ length: 34 }, () => stack('dirt', 64)), stack('raw_iron', 3), stack('iron_ingot', 2)]
  const w = town({ bag, stock: { [kOf(FAR)]: [stack('raw_iron', 8), stack('coal', 4)] } })
  await job(S, w)
  assert.equal(count(w.bag, 'iron_ingot'), 2, `the bag's own ingots stay: ${lastRow()}`)
  assert.equal(townTotal(w, 'iron_ingot'), 0, 'none banked to make room')
}
await t('THE ROOM KEEP: a full bag whose only bankable stack is its own iron ingots -> the take never banks them to make room', async () => {
  await roomKeepScene(S0)
})
const cutWithCopper = async S => {
  // a town of more containers than one pass covers, no iron anywhere: the iron pass is CUT with candidates left. With raw copper
  // carried, the job smelts the copper (in=cu) instead of idling it; CONTROL: no copper carried -> search_more (no strike)
  const extra = w => {
    for (let x = -12; x <= 12; x += 3) for (let z = -12; z <= 12; z += 3) {
      if (Math.hypot(x, z) > 13 || CHESTS.some(c => c[0] === x && c[2] === z) || (x === 6 && z === 0)) continue
      w.set(x, 64, z, 'chest'); w.stock(x, 64, z, [stack('dirt', 5)])
    }
    w.stock(...FAR, [stack('coal', 4)])
  }
  const w = town({ bag: [stack('cobblestone', 3), stack('raw_copper', 5)] }); extra(w)
  const r = await job(S, w)
  assert.equal(field(lastRow(), 'in'), 'cu', `${r.stop} ${lastRow()}`)
  const w2 = town(); extra(w2)
  const r2 = await job(S, w2)
  assert.equal(r2.stop, SJ.SMELT_SEARCH_MORE, `${r2.status} ${r2.stop} ${r2.detail}`)
  assert.equal(field(lastRow(), 'more'), 'fe', lastRow())
  assert.equal(count(w2.bag, 'coal'), 0, 'no coal carried away without input in hand')
}
await t('AN UNFINISHED IRON SEARCH never idles copper in hand: cut with candidates + carried copper -> a copper job; CONTROL: nothing carried -> search_more, more=fe, no coal taken', async () => {
  await cutWithCopper(S0)
})
const ruledOutGate = async S => {
  // every container's latest index observation: no raw iron, no raw copper, fresh, no mutation since -> nothing to look at
  const w = town()
  for (const c of CHESTS) seenByIndex(c)
  assert.equal(S.townIronMiss(w.bot), true, 'the iron search has no candidate: every container index-known empty')
  assert.equal(S.townCopperMiss(w.bot), true, 'nor the copper search')
  assert.equal(S.jobRuledOut(w.bot, 'raw_iron').n, CHESTS.length)
  // the job itself agrees with the gate: it opens NOTHING
  const r = await job(S, w)
  assert.equal(r.stop, 'town_has_none', `${r.status} ${r.stop} ${r.detail}`); assert.equal(w.spy.opened.length, 0, `${w.spy.opened}`)
  // ONE MUTATION MARK re-opens that container at once (a deposit: the index's dirty mark)
  dirtyByIndex(CHESTS[4])
  assert.equal(S.townIronMiss(w.bot), false, 'a deposit into one container makes it a candidate again')
  // CONTROL: the same town with NO index -> both searches have candidates (the base: an order that opens and finds nothing)
  const w2 = town()
  assert.equal(S.townIronMiss(w2.bot), false); assert.equal(S.townCopperMiss(w2.bot), false)
}
await t('THE RULE-OUT IS THE GATE AND THE SEARCH: a town the index knows empty -> both gates true and the job opens nothing; one dirty mark re-opens; CONTROL: no index -> candidates (the base churn)', async () => {
  await ruledOutGate(S0)
})
const ruledHolder = async S => {
  // the index rules out the near containers only; the FAR one is index-known to HOLD raw iron -> the job goes straight there
  const w = town({ stock: { [kOf(FAR)]: [stack('raw_iron', 8), stack('coal', 4)] } })
  for (const c of CHESTS) if (c !== FAR) seenByIndex(c)
  const r = await job(S, w)
  assert.equal(r.stop, 'no_furnace', `${r.status} ${r.stop} ${r.detail}`)
  assert.equal(w.spy.opened[0], kOf(FAR), `the first open is the one container not ruled out: ${w.spy.opened}`)
  assert.equal(field(lastRow(), 'ru'), String(CHESTS.length - 1), lastRow())
}
await t('THE RULE-OUT NARROWS THE SEARCH: the index knows 8 of 9 containers hold no raw iron -> the first open is the 9th (ru=8); the iron is taken there', async () => {
  await ruledHolder(S0)
})
await t('THE IRON MISS IS READ (Claude design r1 P3-1): every container a live iron miss -> townIronMiss true (with the index unread); CONTROL: one not -> false', async () => {
  const w = town()
  const keys = CHESTS.map(kOf)
  CF.updateTownMemory(memDir(), CF.townKey(HOME), null, e => CF.noteItemMisses(e, SJ.IRON_MISS_KEY, SJ.IRON_MISS_TTL_MS, keys.slice(1)))
  assert.equal(S0.townIronMiss(w.bot), false)
  CF.updateTownMemory(memDir(), CF.townKey(HOME), null, e => CF.noteItemMisses(e, SJ.IRON_MISS_KEY, SJ.IRON_MISS_TTL_MS, keys))
  assert.equal(S0.townIronMiss(w.bot), true)
})

// ---- THE REFUSAL CHAIN, through the REAL decision loop ----------------------------------------------------------------
const { Lessons } = await import('../src/lessons.mjs')
const { CognitiveLoop } = await import('../src/cognitive.mjs')
const ldir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcai-is-'))
let lseq = 0
const freshLessons = () => { const L = new Lessons(path.join(ldir, `l${lseq++}.json`)); L.data.avoid = {}; L.data.worked = {}; return L }
const T = (name, used) => ({ ...stack(name, 1), maxDurability: { stone_pickaxe: 131, iron_pickaxe: 250 }[name], durabilityUsed: used })
function chainWorld (opts = {}) {
  // kitsearch's chain bag (no ready rung), with an iron pickaxe so the toolkit has nothing to make
  const w = town({ bag: [stack('dirt', 16), stack('oak_log', 64), stack('oak_log', 64), stack('sand', 8), stack('cobblestone', 64), stack('cobblestone', 20),
    stack('crafting_table', 1), T('iron_pickaxe', 10), stack('iron_axe', 1), stack('iron_shovel', 1), stack('stick', 8)], ...opts })
  Object.assign(w.bot, {
    oxygenLevel: 300, time: { day: 1, age: 1, timeOfDay: 1000 }, game: { dimension: 'overworld' }, username: 'IronSmeltBot', players: {}, experience: { level: 0 },
    recipesFor: () => [], recipesAll: () => [], clearControlStates: () => {},
  })
  const fb = w.bot.findBlock.bind(w.bot), fbs = w.bot.findBlocks.bind(w.bot)
  w.bot.findBlock = o => (typeof o?.matching === 'function' ? fb(o) : null)
  w.bot.findBlocks = o => (typeof o?.matching === 'function' ? fbs(o) : [])
  return w
}
/** The REAL loop over the chain world; `phases` [{ until(ran) -> bool, then?() }]: each waited for in turn, `then` run at once
 *  after it (the world changed mid-run, as a deposit would change it), one loop throughout. */
async function runLoop (w, phases) {
  const ran = []
  const runner = { isBusy: () => false, run: async (skill, args) => {
    if (skill === 'smelt_town') {
      const r = await S0.SKILLS.smelt_town.run({ bot: w.bot }, args ?? {}, null)
      ran.push({ skill, status: r.status, stop: r.stop })
      return { ...r, delta: { smelted: r.smelted ?? 0 }, contractEvidence: r.status === 'success' ? ['smelt_effect: probe'] : [] }
    }
    ran.push({ skill, status: 'no_effect' })
    return { status: 'no_effect', detail: 'probe', delta: {}, contractEvidence: [] }
  } }
  const L = new CognitiveLoop(w.bot, runner, freshLessons(), null)
  L.llm = { decide: async () => ({ schemaValid: true, latencyMs: 1, proposal: { skill: 'status', args: {}, reason: 'probe' } }) }
  L.milestones.cycle = 540
  L.start()
  const marks = []
  try {
    for (const ph of phases) {
      let ok = false
      for (let i = 0; i < 1500 && !(ok = ph.until(ran)); i++) await new Promise(r => setTimeout(r, 30))
      assert.ok(ok, `the loop never reached its phase (a stalled loop would pass every negative): ${JSON.stringify(ran)}`)
      marks.push(ran.length)
      if (ph.then) ph.then(L, ran)
    }
  } finally { L.stop() }
  return { ran, loop: L, marks }
}
const chainScene = async S => {
  // a town the index knows holds no raw iron and no raw copper, whose FAR chest later takes a deposit of raw iron
  const w = chainWorld()
  for (const c of CHESTS) seenByIndex(c)
  let before = null
  const { ran, marks } = await runLoop(w, [
    { until: r => r.length >= 6, then: (L, r) => {
      before = { ran: r.slice(), streak: L.smeltJobState?.streak ?? null }
      // the town changes: raw iron and coal deposited into the FAR chest (its mutation mark), and the cooldown passes
      w.stock(...FAR, [stack('raw_iron', 8), stack('coal', 4)])
      dirtyByIndex(FAR)
      later(SJ.SMELT_JOB_COOLDOWN_MS + 1000)
    } },
    { until: r => r.some(x => x.skill === 'smelt_town') },
  ])
  assert.ok(!before.ran.some(x => x.skill === 'smelt_town'), `no smelt_town into a town the index knows is empty: ${JSON.stringify(before.ran)}`)
  assert.ok(before.ran.some(x => x.skill === 'status'), 'the bot keeps its other moves (the model\'s turns)')
  assert.equal(before.streak, null, 'a skip is no strike (no outcome was recorded)')
  assert.ok(ran.slice(marks[0]).some(x => x.skill === 'smelt_town'), 'the job runs once the town shows a change')
  assert.match(lastRow(), / withdrawn=8 .* in=fe /, lastRow())
  assert.equal(w.spy.opened.filter(k => k !== kOf(FAR)).length, 0, `it opened only the changed container: ${w.spy.opened}`)
}
await t('THE REFUSAL CHAIN (real loop): a town the index knows empty -> no smelt_town, the bot keeps its other moves, no strike; a deposit of raw iron (a dirty mark) + the cooldown -> the job runs, opens only that container, takes the iron', async () => {
  await chainScene(S0)
})
const chainControl = async () => {
  // CONTROL (the base churn): the same town with no index -> smelt_town IS dispatched, and finds nothing
  const w = chainWorld()
  const a = await runLoop(w, [{ until: r => r.length >= 6 }])
  const j = a.ran.find(x => x.skill === 'smelt_town')
  assert.ok(j, `CONTROL: with no index the job is dispatched: ${JSON.stringify(a.ran)}`)
  assert.equal(j.stop, 'town_has_none')
}
await t('CHAIN CONTROL: no index -> the job is dispatched into the same town and ends town_has_none (the churn the rule-out removes)', async () => {
  await chainControl()
})

// ---- mutants -----------------------------------------------------------------------------------------------------------
await t('MUTANTS: each removes one part of the change and a behaviour test above fails for it', async () => {
  const kills = {}
  kills.noIronPass = await withMutant(SKILLS_PATH, 'const w = await jobWithdraw(ctx, { iron: IRONSMELT.on ? SMELT_JOB_BATCH : 0,', 'const w = await jobWithdraw(ctx, { iron: 0,', S => killedBy(() => ironFirst(S)))
  kills.noOwnHold = await withMutant(SKILLS_PATH, "const restore = swapWithdrawHold(name, plan[name].own, Date.now() + 10 * 60_000)\n        try { await deposit(ctx, { item: name }, signal, { noRecovery: true, preferAt }) } finally { restore() }",
    "const restore = () => {}\n        try { await deposit(ctx, { item: name }, signal, { noRecovery: true, preferAt }) } finally { restore() }", S => killedBy(() => ownIron(S)))
  kills.bagCount = await withMutant(SKILLS_PATH, 'f.n = IN === SMELT_IRON_INPUT ? ironSmeltCount({ withdrawn: f.withdrawn, raw0, rawNow: have }) : Math.min(SMELT_JOB_BATCH, have)',
    'f.n = Math.min(SMELT_JOB_BATCH, have)', S => killedBy(() => smeltCountScene(S)))
  kills.noRoomKeep = await withMutant(SKILLS_PATH, 'const keep = IRONSMELT.on ? [...roomKeep(bot.currentWants ?? []), SMELT_IRON_INPUT, SMELT_IRON_OUTPUT] : roomKeep(bot.currentWants ?? [])',
    'const keep = roomKeep(bot.currentWants ?? [])', S => killedBy(() => roomKeepScene(S)))
  kills.idleCopper = await withMutant(SKILLS_PATH, 'if (cut && !(carried > 0)) { out.ironMore = true; return out }', 'if (cut) { out.ironMore = true; return out }', S => killedBy(() => cutWithCopper(S)))
  kills.noRuleOutGate = await withMutant(SKILLS_PATH, 'tried: jobRuledOut(bot, SMELT_IRON_INPUT).keys }) } catch { return false }', '}) } catch { return false }', S => killedBy(() => ruledOutGate(S)))
  kills.noRuleOutSearch = await withMutant(SKILLS_PATH, "const ro = nd === SMELT_JOB_FUEL ? null : jobRuledOut(bot, nd)", 'const ro = null', S => killedBy(() => ruledHolder(S)))
  kills.ruleOutNoTtl = await withMutant(SJ_PATH, ' || now - at >= ttl) continue', ') continue', async SJm => killedBy(() => {
    assert.equal(SJm.indexRuledOut(entry({ at: NOW - SJ.IRON_MISS_TTL_MS - 1 }), 'raw_iron', NOW, { ttl: SJ.IRON_MISS_TTL_MS }).n, 0)
  }))
  kills.ruleOutNoTook = await withMutant(SJ_PATH, '    if (halves.some(h => Number.isFinite(tookAt?.[h]) && tookAt[h] > at + RULE_OUT_TOOK_SLACK_MS)) continue\n', '', async SJm => killedBy(() => {
    assert.equal(SJm.indexRuledOut(entry(), 'raw_iron', NOW, { tookAt: { '1,64,1': NOW } }).n, 0)
  }))
  kills.gateIgnoresIron = await withMutant(SJ_PATH, '  const townIron = !!iron && !lazy(ironMiss)', '  const townIron = false', async SJm => killedBy(() => {
    assert.ok(SJm.smeltTownOrder({ now: 1e12, atTown: true, freeSlots: 5, held: {}, townMiss: true, ironMiss: false, state: {} }).order)
  }))
  const alive = Object.entries(kills).filter(([, k]) => !k).map(([n]) => n)
  assert.deepEqual(alive, [], `mutants that survived: ${alive}`)
  console.log(`        mutants killed: ${Object.keys(kills).join(', ')}`)
})

Date.now = realNow
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
