// GROUNDS-01 (bots/src/grounds2.mjs; skills.mjs buildShop / buildShopVisit / shopActive / keeperOrder / buildTidyVisit). Owner 11-12:
// "is there a better approach to grounds keeping ... lets get this working we've been fighting it for days". Measured on the live
// showcase (14 bots, 24 h to 11-12 13:39Z): the tidy got 218 of 20,160 bot-minutes (1.1%), fixed 269 cells, 49 of its 131 visits ended
// `helper_idle`, and its backlog (fills left 2,431 of 4,751, cuts left 496 of 2,110) grew by about 380 cells. Cleanup is now ordinary,
// funded project work: no role gate for the work, a guaranteed share decided in code, the stairs first.
//
// The pure rules at their boundaries; then the CHAINS (two correct guards composing into a dead end is this repo's repeated failure:
// the chain is tested, not the single guard) -- on buildfake's world through the real runVisit, on real record and lease files
// through the real glue (skills.mjs _grounds2, shopActive), and through shop.mjs's real buildOrder; each with its positive control
// and anchored mutants. GROUNDS2=off is shown to restore the keeper and its helpers (a second copy of skills.mjs under the switch).
// GROUNDS-03 (cleanup as the true fallback: the fall-through, the order's ask, the remembered back-off) has its own section below.
import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
process.env.LOG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-grounds2-logs-'))
process.env.BOT_NAME = 'GroundsBot'
process.env.OLLAMA_MODEL ??= 'qwen2.5:7b-instruct'
process.env.HOME_X = '0'; process.env.HOME_Y = '70'; process.env.HOME_Z = '0'
process.env.MEMORY_POOL = 'hive-a'   // a named pool: the tidy and the groundskeeper on by default
process.env.POOL_STATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-grounds2-pool-'))
for (const k of ['GROUNDS2', 'GROUNDSFALL', 'GROUNDSKEEPER', 'TIDY', 'GKLEASE', 'GKCREW4', 'GKCREWCUT', 'GKFILLSHARE', 'COUNTRY', 'LANDPLAN']) delete process.env[k]
const { withMutant } = await import('./helpers/mutant.mjs')
const { EventEmitter } = await import('node:events')
const { Vec3 } = await import('vec3')
const { G, HOME, server, bot: fakeBot, plan: fakePlan, PJ, R } = await import('./helpers/buildfake.mjs')
const PS = await import('../src/planstore.mjs')
const G2 = await import('../src/grounds2.mjs')
const GK = await import('../src/groundskeeper.mjs')
const GKW = await import('../src/gkwork.mjs')
const T = await import('../src/tidy.mjs')
const S = await import('../src/shop.mjs')
const { tapRecords } = await import('../src/logger.mjs')
const SK = await import('../src/skills.mjs')

const G2_PATH = new URL('../src/grounds2.mjs', import.meta.url)
const SKILLS_FILE = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'src', 'skills.mjs')
let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 7).join('\n        ')}`) }
}
/** The scenario passes on the real module and FAILS (an assertion, not a crash) on the anchored mutant. */
const killedBy = async (old, neu, scenario) => {
  await scenario(G2)
  let why = null
  await withMutant(G2_PATH, old, neu, async M => { try { await scenario(M) } catch (err) { why = err } })
  assert.ok(why instanceof assert.AssertionError, `the mutant survived or died for another reason: ${why?.stack?.split('\n')[0] ?? 'survived'}`)
}
/** A copy of skills.mjs (anchored replacements, each present and unique; none: the file itself under another env), in src/ (it reads
 *  files beside itself), imported fresh. */
async function withSkills (pairs, fn) {
  let src = fs.readFileSync(SKILLS_FILE, 'utf8')
  for (const [old, neu] of pairs) { assert.ok(src.split(old).length === 2, `ANCHOR MISSING OR NOT UNIQUE: ${JSON.stringify(old.slice(0, 70))}`); src = src.replace(old, neu) }
  const out = path.join(path.dirname(SKILLS_FILE), `_mutant-skills-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`)
  fs.writeFileSync(out, src)
  try { return await fn(await import(out)) } finally { try { fs.unlinkSync(out) } catch {} }
}
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1')
const MIN = 60_000
const H70 = { x: 0, y: 70, z: 0 }

console.log('THE PURE RULES (grounds2.mjs)')
await t('groundsShare: every 2nd visit above 500 open, every 4th above 100, none at or below (100/101, 500/501); an unknown count funds nothing', async () => {
  await killedBy('return n > G.big ? G.shareBig : n > G.small ? G.shareSmall : 0', 'return n >= G.big ? G.shareBig : n > G.small ? G.shareSmall : 0', M => {
    assert.deepStrictEqual([100, 101, 500, 501].map(n => M.groundsShare(n)), [0, 4, 4, 2])
  })
  assert.deepStrictEqual([0, 99, 2927, 1e6].map(n => G2.groundsShare(n)), [0, 0, 2, 2], 'the live backlog (2,431 + 496 = 2,927) is every second visit')
  for (const u of [null, undefined, '', NaN, 'x', Infinity]) assert.strictEqual(G2.groundsShare(u), 0, `unknown ${u}`)
  assert.deepStrictEqual([G2.GROUNDS2.big, G2.GROUNDS2.small, G2.GROUNDS2.shareBig, G2.GROUNDS2.shareSmall, G2.GROUNDS2.emptyMs, G2.GROUNDS2.maxBots], [500, 100, 2, 4, 10 * MIN, 4])
})
await t('groundsTurn: the turn arithmetic per bot -- 2, 4, 6 above 500; 4, 8 above 100; never below; the 10-minute spend', async () => {
  const due = (open, n) => Array.from({ length: n }, (_, i) => i + 1).filter(turn => G2.groundsTurn({ turn, open, now: 1000 }).due)
  assert.deepStrictEqual(due(501, 8), [2, 4, 6, 8])
  assert.deepStrictEqual(due(101, 9), [4, 8])
  assert.deepStrictEqual(due(100, 9), [])
  assert.deepStrictEqual(G2.groundsTurn({ turn: 3, open: 2927, now: 1000 }), { share: 2, due: false, why: 'off_turn' })
  assert.deepStrictEqual(G2.groundsTurn({ turn: 4, open: 60, now: 1000 }), { share: 0, due: false, why: 'low' })
  assert.deepStrictEqual(G2.groundsTurn({ turn: 4, open: null, now: 1000 }), { share: 0, due: false, why: 'open_unknown' })
  assert.strictEqual(G2.groundsTurn({ turn: 0, open: 2927, now: 1000 }).due, false, 'no visit counted yet')
  // the spend: while this bot's turns are spent a due turn is the order's; at the end of it, the grounds' again
  await killedBy("  if (now < (Number(emptyUntil) || 0)) return { share, due: false, why: 'spent' }\n", '', M => {
    assert.deepStrictEqual(M.groundsTurn({ turn: 4, open: 2927, emptyUntil: 5000, now: 4999 }), { share: 2, due: false, why: 'spent' })
  })
  assert.deepStrictEqual(G2.groundsTurn({ turn: 4, open: 2927, emptyUntil: 5000, now: 5000 }), { share: 2, due: true, why: 'turn' })
})
await t('groundsEligible: at the town\'s surface; not underground, not away, not from an unknown position', () => {
  const e = feet => G2.groundsEligible({ feet, home: H70 })
  assert.deepStrictEqual(e([5, 71, -9]), { ok: true, why: null })
  assert.deepStrictEqual(e([5, 62, -9]), { ok: true, why: null }, `${GK.GK_FIT.surfaceDy} under the town's ground is still its surface (a dirt pit, the stepwell)`)
  assert.deepStrictEqual(e([5, 61, -9]), { ok: false, why: 'underground' })
  assert.deepStrictEqual(e([5, 14, -9]), { ok: false, why: 'underground' }, 'LIVE: a keeper took the lease at y 14 mining iron')
  assert.deepStrictEqual(e([128, 71, 0]), { ok: true, why: null })
  assert.deepStrictEqual(e([129, 71, 0]), { ok: false, why: 'away' })
  for (const f of [null, undefined, [1, 2], [1, NaN, 3]]) assert.deepStrictEqual(e(f), { ok: false, why: 'unknown' })
  assert.deepStrictEqual(G2.groundsEligible({ feet: [0, 70, 0], home: null }), { ok: false, why: 'unknown' })
})
await t('groundsAfter: a grounds visit that ran and fixed nothing spends 10 minutes; work, an interrupted visit, the keeper\'s and another project\'s do not', async () => {
  const now = 1_000_000
  assert.deepStrictEqual(G2.groundsAfter({ took: 'tidy', placed: 0, cleared: 0, now }), { empty: true, emptyUntil: now + 10 * MIN })
  assert.deepStrictEqual(G2.groundsAfter({ took: 'tidy', placed: 0, cleared: 2, emptyUntil: 7, now }), { empty: false, emptyUntil: 7 }, 'a cut is work (and yields dirt)')
  assert.deepStrictEqual(G2.groundsAfter({ took: 'tidy', placed: 3, cleared: 0, now }), { empty: false, emptyUntil: 0 })
  assert.deepStrictEqual(G2.groundsAfter({ took: 'other', placed: 0, cleared: 0, emptyUntil: 7, now }), { empty: false, emptyUntil: 7 })
  assert.deepStrictEqual(G2.groundsAfter({ took: 'tidy', keeper: true, placed: 0, cleared: 0, now }), { empty: true, emptyUntil: 0 }, 'the keeper has no quota to spend')
  // LIVE: 34 of 131 tidy visits were interrupted; their counts never come back -- no evidence of an empty grounds
  await killedBy("const empty = took === 'tidy' && !aborted && ", "const empty = took === 'tidy' && ", M => {
    assert.deepStrictEqual(M.groundsAfter({ took: 'tidy', aborted: true, placed: 0, cleared: 0, emptyUntil: 7, now }), { empty: false, emptyUntil: 7 })
  })
})
await t('groundsRecord / groundsOrderD / groundsRole / groundsSlots / groundsNone / groundsPassed: each answer', () => {
  const open = { structure_complete: false }
  assert.strictEqual(G2.groundsRecord({ shopDone: true, readable: true, rec: open }), 'open')
  assert.strictEqual(G2.groundsRecord({ shopDone: false, readable: true, rec: open }), 'no_workshop', 'a new town builds its workshop with every bot first')
  assert.strictEqual(G2.groundsRecord({ shopDone: true, readable: false, rec: null }), 'unreadable')
  assert.strictEqual(G2.groundsRecord({ shopDone: true, readable: true, rec: null }), 'none')
  assert.strictEqual(G2.groundsRecord({ shopDone: true, readable: true, rec: { structure_complete: true } }), 'complete')
  assert.strictEqual(G2.groundsRecord({ shopDone: true, readable: true, rec: open, stuck: true }), 'stuck')
  assert.deepStrictEqual([G2.groundsOrderD('mine', false), G2.groundsOrderD('other', true), G2.groundsOrderD('take', true), G2.groundsOrderD('none', true), G2.groundsOrderD('other', false)], ['mine', 'helper', 'helper', 'helper', 'none'])
  assert.strictEqual(G2.groundsRole({ d: 'mine', kept: true }), 'keeper')
  assert.strictEqual(G2.groundsRole({ d: 'take', kept: true }), 'keeper', 'a free lease taken at the visit, as before')
  for (const d of ['other', 'none', 'release']) assert.strictEqual(G2.groundsRole({ d, kept: true }), 'worker', d)
  assert.strictEqual(G2.groundsRole({ d: 'take', kept: false }), 'worker', 'the take lost: it works on, never keeper_held')
  assert.deepStrictEqual([G2.groundsSlots(5), G2.groundsSlots(3), G2.groundsSlots(undefined)], [4, 3, 4])
  // review r1 (Claude): the last slot is the keeper's -- a worker counts one fewer, never below one
  assert.deepStrictEqual([G2.groundsSlots(5, { worker: true }), G2.groundsSlots(3, { worker: true }), G2.groundsSlots(1, { worker: true })], [3, 2, 1])
  assert.strictEqual(G2.groundsNone({ seg: null, cuts: 0, clearFree: true }), true)
  assert.strictEqual(G2.groundsNone({ seg: null, cuts: 9, clearFree: false }), true, 'the one clear lease is another bot\'s')
  assert.strictEqual(G2.groundsNone({ seg: null, cuts: 9, clearFree: true }), false, 'no fill, but a cut it may dig')
  assert.strictEqual(G2.groundsNone({ seg: 'T-00-0', cuts: 0, clearFree: false }), false)
  assert.strictEqual(G2.groundsPassed({ status: 'no_effect', stop: 'grounds_none' }), true)
  assert.strictEqual(G2.groundsPassed({ status: 'no_effect', stop: 'slots_full' }), true)
  assert.strictEqual(G2.groundsPassed({ status: 'no_effect', stop: 'deadline' }), false, 'a visit that ran is a visit')
  assert.strictEqual(G2.groundsPassed({ status: 'success', stop: 'grounds_none' }), false)
  assert.strictEqual(G2.groundsPassed(undefined), false)
})
await t('the rows: `_grounds_quota` names every field; `_grounds_mode` says on=0|1 and the numbers', () => {
  assert.strictEqual(G2.groundsQuotaDetail({ on: true, turn: 6, open: 2927, share: 2, took: 'tidy', why: 'turn', placed: 3, cleared: 2, empty: false, out: 'deadline' }), 'on=1 turn=6 open=2927 share=2 took=tidy why=turn placed=3 cleared=2 empty=0 out=deadline')
  assert.strictEqual(G2.groundsQuotaDetail({ on: true, turn: 5, open: null, share: 0, took: 'other', why: 'open_unknown' }), 'on=1 turn=5 open=- share=0 took=other why=open_unknown placed=- cleared=- empty=0 out=-')
  assert.strictEqual(G2.groundsModeDetail(true), 'on=1 v=1 big=500:2 small=100:4 empty_ms=600000 max_bots=4 fall=1')
  assert.strictEqual(G2.groundsModeDetail(false).startsWith('on=0 '), true)
  assert.strictEqual(G2.grounds2On({}), true, 'default ON')
  for (const v of ['off', '0', 'false', 'no', ' OFF ']) assert.strictEqual(G2.grounds2On({ GROUNDS2: v }), false, v)
})

console.log('THE CREW\'S PANTRY (crewPantrySum): a worker holds no lease, and its flowers still hold the stage open (review r1)')
await t('a worker\'s fresh pantry counts with no lease; a stale one, and my own, do not; GROUNDS2=off keeps the lease rule', async () => {
  const P = await import('../src/park.mjs')
  const now = 10_000_000, min = 60_000
  const flower = [...P.PARK_ITEMS].find(n => /poppy|dandelion|tulip|daisy|cornflower|allium/.test(n)) ?? [...P.PARK_ITEMS][0]
  const pantry = { Worker: { at: now - 20 * min, items: { [flower]: 3 } }, Gone: { at: now - 46 * min, items: { [flower]: 5 } }, Me: { at: now, items: { [flower]: 9 } } }
  assert.deepStrictEqual(G2.crewPantrySum(pantry, { on: true, now, me: 'Me' }), { [flower]: 3 }, 'the worker\'s, 20 min old: counted; 46 min old: not; mine: never')
  assert.deepStrictEqual(G2.crewPantrySum(pantry, { on: false, now, me: 'Me', leased: () => false }), {}, 'off: no lease, no pantry (the old rule, and the positive control for the blocker)')
  assert.deepStrictEqual(G2.crewPantrySum({ Helper: { at: now - 5 * min, items: { [flower]: 2 } } }, { on: false, now, me: 'Me', leased: h => h === 'Helper' }), { [flower]: 2 }, 'off: a lease holder\'s fresh pantry')
  assert.deepStrictEqual(G2.crewPantrySum({ Helper: { at: now - 20 * min, items: { [flower]: 2 } } }, { on: false, now, me: 'Me', leased: () => true }), {}, 'off: 12 minutes is the lease rule\'s window')
  // the chain the review named: the keeper's visit passed a planting `no_flowers`; a worker's pantry holds the flowers -> the cell is
  // HELD (park.mjs parkHeldByCrew), so the keeper does not count the stage complete over it
  const role = [...P.PARK_PLACE_ROLES].find(r => P.elementOf(r) && P.PARK_ITEMS.has(flower) && P.haveOf({ [flower]: 1 }, P.elementOf(r)) > 0)
  if (role) {
    const rec = { cells: [{ at: [1, 70, 1], role, seg: 's' }] }
    const skip = () => `no_${P.elementOf(role)}`
    assert.strictEqual(P.parkHeldByCrew(rec, { skip, others: G2.crewPantrySum(pantry, { on: true, now, me: 'Me' }) }).length, 1, 'held: the worker carries it')
    assert.strictEqual(P.parkHeldByCrew(rec, { skip, others: G2.crewPantrySum(pantry, { on: false, now, me: 'Me', leased: () => false }) }).length, 0, 'the lease rule dropped it: the stage would complete over the cell')
  }
  let why = null
  await withMutant(G2_PATH, '  return on ? pantrySum(pantry, { now, fresh: G.workerLiveMs, live: () => true, me })', '  return false ? pantrySum(pantry, { now, fresh: G.workerLiveMs, live: () => true, me })', async M => {
    try { assert.deepStrictEqual(M.crewPantrySum(pantry, { on: true, now, me: 'Me' }), { [flower]: 3 }) } catch (err) { why = err }
  })
  assert.ok(why, 'MUTANT (the lease rule under grounds-01) survived')
})
await t('the wiring: skills.mjs crewPantry asks crewPantrySum with the switch (structural; a cut line fails)', () => {
  const src = fs.readFileSync(SKILLS_FILE, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  const line = 'return crewPantrySum(pantryRead(dir, key), { on: G2.on, now, me, leased: h => live.has(h), leaseFresh: GK.helperTtlMs })'
  assert.strictEqual(src.split(line).length, 2, 'the one call, on the executable path')
  assert.ok(!/pantrySum\(pantryRead\(dir, key\)/.test(src), 'the lease-only sum is gone from crewPantry')
})

await t('REVIEW r2 (Codex): a bot CARRYING the park\'s plants keeps a turn below the small backlog -- it comes back inside the pantry window', async () => {
  const base = { turn: 2, now: 1_000_000 }
  assert.deepStrictEqual(G2.groundsTurn({ ...base, open: 40 }), { share: 0, due: false, why: 'low' }, 'positive control: below 100 a bot with nothing gets no turn (how the carrier went stale)')
  assert.deepStrictEqual(G2.groundsTurn({ ...base, open: 40, carrying: true }), { share: 2, due: true, why: 'carry' })
  assert.deepStrictEqual(G2.groundsTurn({ ...base, open: null, carrying: true }), { share: 2, due: true, why: 'carry' }, 'an unknown count too: it holds what the park waits for')
  assert.deepStrictEqual(G2.groundsTurn({ ...base, turn: 3, open: 40, carrying: true }), { share: 2, due: false, why: 'off_turn' }, 'every SECOND visit: the other projects keep theirs')
  assert.deepStrictEqual(G2.groundsTurn({ ...base, open: 40, carrying: true, emptyUntil: base.now + 1 }), { share: 2, due: false, why: 'spent' }, 'a visit that planted nothing spends the turns: never a loop')
  assert.deepStrictEqual(G2.groundsTurn({ ...base, open: 900, carrying: true }), { share: 2, due: true, why: 'turn' }, 'above the thresholds the share is the backlog\'s own')
  const d = G2.groundsDecide({ record: 'open', open: 40, turn: 2, carrying: true, feet: [0, 70, 0], home: { x: 0, y: 70, z: 0 }, now: base.now })
  assert.deepStrictEqual([d.took, d.why], ['tidy', 'carry'])
  assert.strictEqual(G2.groundsDecide({ record: 'complete', open: 40, turn: 2, carrying: true, feet: [0, 70, 0], home: { x: 0, y: 70, z: 0 } }).took, 'other', 'a closed record is the keeper\'s to reopen')
  // 2 build orders at the non-crew cadence (10 min) is 20 min: inside the 45-minute window the pantry counts for
  assert.ok(2 * 10 * 60_000 < G2.GROUNDS2.workerLiveMs)
  let why = null
  await withMutant(G2_PATH, "  const share = own || (carrying ? G.shareBig : 0)\n", '  const share = own\n', async M => {
    try { assert.strictEqual(M.groundsTurn({ ...base, open: 40, carrying: true }).due, true) } catch (err) { why = err }
  })
  assert.ok(why, 'MUTANT (the carrier loses its turn) survived')
})
await t('REVIEW r2 (Codex): the country lane\'s last slot is the keeper\'s too (workerSlots), and skills.mjs takes its slot through it', () => {
  assert.deepStrictEqual([G2.workerSlots(3, false), G2.workerSlots(3, true), G2.workerSlots(1, true), G2.workerSlots(undefined, true)], [3, 2, 1, 1])
  const src = fs.readFileSync(SKILLS_FILE, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  assert.strictEqual(src.split("takeSlot(dir, key, me, lane === 'country' ? workerSlots(COUNTRY.builders, G2.on && worker) : buildersFor(").length, 2, 'the one takeSlot of the visit, both lanes counted for a worker')
  assert.ok(!/lane === 'country' \? COUNTRY\.builders :/.test(src), 'the country lane no longer hands a worker every slot')
})

console.log('STUCK LAST (stuckSegs / stuckLast): the segments nobody can reach go to the end of a visit\'s order')
const STUCK_REC = () => ({
  segments: [{ seg: 'T-0' }, { seg: 'T-1' }, { seg: 'T-2', deps: ['T-1'] }, { seg: 'T-3' }, { seg: 'T-4' }],
  cells: [{ at: [0, 64, 0], seg: 'T-0', role: 'core' }, { at: [1, 64, 0], seg: 'T-1', role: 'core' }, { at: [1, 65, 0], seg: 'T-2', role: 'earth' },
    { at: [3, 64, 0], seg: 'T-3', role: 'core' }, { at: [3, 64, 1], seg: 'T-3', role: 'core', prev: true }, { at: [4, 64, 0], seg: 'T-4', role: 'earth' }],
})
await t('the live shape (11-12 16:30Z): the head of the order is segments whose first cell was tried hundreds of times -- they go last, the rest keep their order', () => {
  const rec = STUCK_REC()
  // the showcase's own counts: 366 and 101 visits, and one below the threshold
  const stuck = { '0,64,0': { visits: 366 }, '3,64,0': { visits: 101 }, '4,64,0': { visits: 5 } }
  const late = G2.stuckSegs(rec, stuck)
  assert.deepStrictEqual([...late].sort(), ['T-0', 'T-3'])
  assert.deepStrictEqual(G2.stuckLast(rec, late).segments.map(x => x.seg), ['T-1', 'T-2', 'T-4', 'T-0', 'T-3'], 'the workable ones first, in the survey\'s order; a dep keeps its place before its dependant')
  // review r1 (both engines): a segment that WAITS ON a stuck one goes with it, after it -- T-2 waits on T-1
  assert.deepStrictEqual(G2.stuckLast(rec, new Set(['T-1'])).segments.map(x => x.seg), ['T-0', 'T-3', 'T-4', 'T-1', 'T-2'])
  const chain = { segments: [{ seg: 'a' }, { seg: 'b', deps: ['a'] }, { seg: 'c', deps: ['b'] }, { seg: 'd' }], cells: [] }
  assert.deepStrictEqual(G2.stuckLast(chain, new Set(['a'])).segments.map(x => x.seg), ['d', 'a', 'b', 'c'], 'transitively: the layer above the layer above')
  assert.deepStrictEqual(rec.segments.map(x => x.seg), ['T-0', 'T-1', 'T-2', 'T-3', 'T-4'], 'positive control: the survey\'s order had the stuck ones first; the record is not mutated')
  assert.strictEqual(G2.stuckLast(rec, new Set()), rec, 'none stuck: the record itself')
  assert.strictEqual(G2.stuckLast(rec, new Set(['T-9'])), rec, 'a name the record does not hold: the record itself')
  assert.strictEqual(G2.GROUNDS2.stuckMin, 6)
})
await t('stuckSegs: only an OPEN cell of this generation at the threshold counts; a done cell, a prev cell and five visits do not', () => {
  const rec = STUCK_REC()
  assert.deepStrictEqual([...G2.stuckSegs(rec, { '4,64,0': { visits: 5 } })], [], 'five visits: still tried')
  assert.deepStrictEqual([...G2.stuckSegs(rec, { '4,64,0': { visits: 6 } })], ['T-4'])
  assert.deepStrictEqual([...G2.stuckSegs(rec, { '3,64,1': { visits: 50 } })], [], 'a previous generation\'s cell')
  assert.deepStrictEqual([...G2.stuckSegs(rec, { '0,64,0': { visits: 366 } }, c => c.at[0] !== 0)], [], 'laid or waived since: the segment is workable again')
  assert.deepStrictEqual([...G2.stuckSegs(rec, {})], []); assert.deepStrictEqual([...G2.stuckSegs(rec, null)], []); assert.deepStrictEqual([...G2.stuckSegs(null, { a: { visits: 9 } })], [])
})
await t('REVIEW r1 (both engines), through the real runVisit: a stuck segment with a layer waiting on it, moved last -- the project still reads STALLED and ends stuck_on_cell; without the dependants it never does', async () => {
  const { SITE, project, KIT, k3 } = await import('./helpers/buildfake.mjs')
  // buildrun-stuck.test.mjs's scene: a cell sealed in bedrock (no stand reaches it), and a second segment that waits on it
  const X = [5, G + 1, 25], Y = [9, G + 1, 25]
  const sealed = () => Object.fromEntries([[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]].map(d => [k3(X.map((v, i) => v + d[i])), 'bedrock']))
  const RECORD = { ...SITE.record,
    cells: [{ at: X, role: 'base', seg: 'extra', stand: [X[0] - 1, G + 1, X[2]], support: [X[0], G, X[2]], face: [0, 1, 0], order: -2 },
      { at: Y, role: 'base', seg: 'extra2', stand: [Y[0] - 1, G + 1, Y[2]], support: [Y[0], G, Y[2]], face: [0, 1, 0], order: -1 }, ...SITE.record.cells],
    segments: [{ seg: 'extra', deps: [] }, { seg: 'extra2', deps: ['extra'] }, ...SITE.record.segments] }
  const scenario = async M => {
    const srv = server(sealed()), pr = project(RECORD)
    const stops = []
    for (let i = 0; i < R.STUCK_VISITS + 1; i++) {
      const h = PJ.recordHead(pr.dir, pr.key), e = fakeBot(srv, 'A', { inv: { ...KIT(), stone_bricks: 91 } })
      const rec = M.stuckLast(h.head.rec, new Set(['extra']))          // the tidy visit's reorder, as skills.mjs applies it
      const r = await R.runVisit({ ...pr.p('A'), record: rec, recordGen: h.head.gen, stuckStalledOnly: true, skipOpenDeps: true }, e, { maxSteps: 4000 })
      stops.push(r.stop)
    }
    return stops
  }
  const stops = await scenario(G2)
  assert.strictEqual(stops.at(-1), 'stuck_on_cell', `with only the stuck segment and its dependant left the project is stalled: ${stops}`)
  let why = null
  await withMutant(G2_PATH, "    for (const s of segs) if (!all.has(s.seg) && (s.deps ?? []).some(d => all.has(d))) { all.add(s.seg); grew = true }\n", '', async M => {
    try { const m = await scenario(M); assert.strictEqual(m.at(-1), 'stuck_on_cell', `${m}`) } catch (err) { why = err }
  })
  assert.ok(why instanceof assert.AssertionError, `MUTANT (the dependants left in place: never stalled) survived or died for another reason: ${why?.message ?? 'survived'}`)
})
await t('MUTANT: stuckLast keeps the survey\'s order -- the stuck segments stay at the head (killed); and skills.mjs wires it after the stairs', async () => {
  const rec = STUCK_REC(), late = new Set(['T-0', 'T-3'])
  let why = null
  await withMutant(G2_PATH, "  return { ...record, segments: [...segs.filter(s => !all.has(s.seg)), ...segs.filter(s => all.has(s.seg))] }", '  return { ...record, segments: [...segs] }', async M => {
    try { assert.strictEqual(M.stuckLast(rec, late).segments[0].seg, 'T-1') } catch (err) { why = err }
  })
  assert.ok(why, 'the mutant survived')
  const src = fs.readFileSync(SKILLS_FILE, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  const stairs = src.indexOf('visitRec = stairsFirst(v0, stairOpenQ,'), last = src.indexOf('visitRec = stuckLast(visitRec, late)')
  assert.ok(stairs > 0 && last > stairs, 'stuckLast runs on the visit\'s record, after stairsFirst (a stuck staircase is last too)')
  assert.strictEqual(src.split('stuckSegs(visitRec, vfStuckRead(dir, key, { since: Date.now() - BUILD_STUCK_FORGET_MS + 1 }), stairOpenQ)').length, 2, 'from the project\'s own stuck map, the 24-hour window the runner counts in')
  assert.strictEqual(G2.groundsQuotaDetail({ took: 'tidy', late: 7 }).endsWith(' late=7'), true, 'the proof: the quota row says how many segments the visit left for last')
  assert.ok(!/late=/.test(G2.groundsQuotaDetail({ took: 'other' })), 'absent when nothing was reordered')
})

console.log('THE DECISION (groundsDecide): every link, and what each broken link falls back to -- the order, never a refusal')
const D0 = { on: true, keeper: false, decor: false, record: 'open', open: 2927, turn: 2, emptyUntil: 0, feet: [3, 71, 4], home: H70, slotFree: true, now: 1_000_000 }
await t('the turn is the grounds\' only when every link holds; each broken link names itself and is `other`', () => {
  assert.deepStrictEqual(G2.groundsDecide(D0), { took: 'tidy', why: 'turn', share: 2, due: true })
  const other = (patch, why) => { const d = G2.groundsDecide({ ...D0, ...patch }); assert.strictEqual(d.took, 'other', why); assert.strictEqual(d.why, why) }
  other({ on: false }, 'off')
  other({ keeper: true }, 'keeper')
  other({ decor: true }, 'decor')
  other({ record: 'complete' }, 'record_complete')
  other({ record: 'none' }, 'record_none')
  other({ record: 'stuck' }, 'record_stuck')
  other({ record: 'no_workshop' }, 'record_no_workshop')
  other({ record: 'unreadable' }, 'record_unreadable')
  other({ open: null }, 'open_unknown')
  other({ open: 100 }, 'low')
  other({ turn: 3 }, 'off_turn')
  other({ emptyUntil: D0.now + 1 }, 'spent')
  other({ feet: [3, 20, 4] }, 'underground')
  other({ feet: [300, 71, 4] }, 'away')
  other({ feet: null }, 'unknown')
  other({ slotFree: false }, 'full')
})

// ---- the chains ----------------------------------------------------------------------------------------------------------------
const PAL = T.TIDY_PALETTE
const tmp = tag => fs.mkdtempSync(path.join(os.tmpdir(), `g2-${tag}-`))
/** runVisit as skills.mjs buildTidyVisit calls it for a crew bot: the crew's segment rule, the cuts as `tidy`, the visit's share. */
function crewHooks (dir, key, me, cols) {
  const live = () => { const L0 = PJ.liveLeases(dir, key, 'seg-', Date.now()); if (!L0) return null; const o = {}; for (const [n, v] of Object.entries(L0)) if (n !== 'seg-clear') o[n.slice(4)] = v; return o }
  const segFree = sg => { const st = PJ.leaseState(dir, key, `seg-${sg}`); return !st || st.rec?.holder === me || Date.now() >= st.blocksUntil }
  const segOk = sg => { const L0 = live(); return !!L0 && GK.crewSegOk({ cols, seg: sg, me, live: L0 }) }
  return { segFree, tidySegOk: sg => segFree(sg) && segOk(sg), hooks: { segOk, segYield: sg => { const L0 = live(); return !L0 || GK.crewYield({ cols, seg: sg, me, live: L0 }) }, skipOpenDeps: true } }
}
async function workerVisit ({ record, cuts = [], inv = {}, srv = server(), me = 'W', dir = tmp('run'), share = { clearMax: GK.GK.clearMax, clearsLast: false }, held = [], Rm = R } = {}) {
  const key = PJ.projKey(HOME, 'tidy')
  const pub = PJ.publishRecord(dir, key, () => ({ ...record }))
  for (const [name, holder] of held) PJ.takeLease(dir, key, name, holder, { now: Date.now() - 1000 })
  const cols = GK.segColumns(record)
  const C = crewHooks(dir, key, me, cols)
  const seg0 = R.workableSeg(record, srv.read, PAL, C.tidySegOk, null, { skipOpenDeps: true })
  const slot = PJ.takeSlot(dir, key, me, G2.GROUNDS2.maxBots)
  const ops = []
  const e = fakeBot(srv, me, { inv, feet: [0, G + 1, 2] })
  const log0 = e.log
  e.log = (k, d) => { if (k === '_build' && (d.op === 'place' || d.op === 'clear')) ops.push(`${d.op}:${(d.cell ?? []).join(',')}`); return log0(k, d) }
  const r = await Rm.runVisit({ dir, key, me, home: HOME, stood: [], record, tidy: cuts, recordGen: pub.gen, palette: PAL, slot: slot.slot, slotGen: slot.gen, domain: () => true, walkR: 64,
    clearMax: share.clearMax, ...(share.clearsLast ? { clearsLast: true } : {}), tidyKeepOrder: true, deferSpent: true, stuckStalledOnly: true, ...C.hooks }, e, { maxSteps: 200 })
  return { r, ops, srv, seg0, clearFree: C.segFree('clear'), dir, key }
}
const pitRec = () => ({
  cells: [10, 11].map(x => ({ at: [x, G + 1, 0], role: 'earth', seg: 'T-00-0' })),
  segments: [{ seg: 'T-00-0', deps: [] }], clear: [], cut: [], replant: [],
})
const bumps = srv => [-5, -6, -7].map(x => { const at = [x, G + 1, 0]; srv.set(at, 'dirt'); return { at, kind: 'tidy', name: 'dirt' } })
const base = { on: true, shared: true, atTown: true, holds: false, state: {}, record: null, complete: false, slotsFree: true, health: 20, freeSlots: 20 }

console.log('CHAIN 1: quota turn -> no fill material -> cuts only -> still nothing -> empty -> spent 10 min -> the order (never a loop)')
await t('no fill material: the visit digs the cuts (which yield dirt) -- work, the turns are not spent', async () => {
  const srv = server()
  const { r, ops } = await workerVisit({ record: pitRec(), srv, cuts: bumps(srv), inv: {} })
  assert.strictEqual(r.placed, 0, `nothing to fill with (${ops.join(' ')})`)
  assert.strictEqual(r.cleared, 3, `the three bumps cut: ${ops.join(' ')} stop ${r.stop}`)
  assert.deepStrictEqual(G2.groundsAfter({ took: 'tidy', placed: r.placed, cleared: r.cleared, emptyUntil: 0, now: 5 }), { empty: false, emptyUntil: 0 })
  // positive control: the same visit with earth in the bag fills the pit too
  const srv2 = server()
  const c = await workerVisit({ record: pitRec(), srv: srv2, cuts: bumps(srv2), inv: { cobblestone: 8 } })
  assert.strictEqual(c.r.placed, 2, `control: with cobblestone the pit is filled (${c.ops.join(' ')})`)
})
await t('still nothing (no material, no cut left): the visit is EMPTY, the bot\'s turns are spent 10 minutes, every due turn inside them is the order\'s, and the next after them is the grounds\' again', async () => {
  const { r, seg0 } = await workerVisit({ record: pitRec(), cuts: [], inv: {} })
  assert.strictEqual(seg0, 'T-00-0', 'the fill segment WAS workable: this is a visit that ran, not one turned away')
  assert.deepStrictEqual([r.placed, r.cleared], [0, 0], `stop ${r.stop}`)
  const scenario = M => {
    let now = 1_000_000, emptyUntil = 0, turn = 0
    const visits = []
    const one = () => {
      turn++
      const d = M.groundsDecide({ ...D0, turn, emptyUntil, now })
      // a grounds visit here is the empty one above; another project's visit changes nothing
      emptyUntil = M.groundsAfter({ took: d.took, placed: r.placed, cleared: r.cleared, emptyUntil, now }).emptyUntil
      visits.push(`${d.took}:${d.why}`)
    }
    one(); one()                                   // turn 2: the grounds', empty
    assert.strictEqual(emptyUntil, now + 10 * MIN)
    for (let i = 0; i < 6; i++) { now += MIN; one() }   // six more build visits inside the 10 minutes
    assert.deepStrictEqual(visits, ['other:off_turn', 'tidy:turn', 'other:off_turn', 'other:spent', 'other:off_turn', 'other:spent', 'other:off_turn', 'other:spent'], 'never a second empty grounds visit inside the spend')
    now += 5 * MIN; one(); one()                   // past it
    assert.deepStrictEqual(visits.slice(-2), ['other:off_turn', 'tidy:turn'], 'and the grounds get their turn again')
  }
  scenario(G2)
  // the anchored mutant: without the spend every second visit is an empty grounds visit, for good
  let why = null
  await withMutant(G2_PATH, 'return { empty, emptyUntil: empty && !keeper ? now + G.emptyMs : Number(emptyUntil) || 0 }', 'return { empty, emptyUntil: Number(emptyUntil) || 0 }', async M => { try { scenario(M) } catch (err) { why = err } })
  assert.ok(why instanceof assert.AssertionError, `the mutant survived: ${why}`)
})
await t('THE COMPOSED TRAP: a quota visit\'s stop never reaches the order\'s back-offs (stuck_on_cell: the WHOLE build order held 6 h; no_material: an expedition)', async () => {
  const now = 1e9, lastAt = now - 20 * MIN   // past the order's 10-minute cooldown, far inside the 6 h
  S.setGroundsFall(null)                     // grounds-01's rule alone (grounds-03's hooks into the order have their own chains below)
  // positive control: the raw stops DO trip shop.mjs's real order
  assert.deepStrictEqual(S.buildOrder({ ...base, now, state: { lastAt, lastStop: 'stuck_on_cell' } }), { order: null, skip: 'stuck_on_cell' })
  assert.strictEqual(S.buildIdle({ lastStop: 'no_material' }), true)
  assert.strictEqual(S.buildIdle({ lastStop: 'keeper_held' }), true)
  await killedBy("export const groundsResult = r => (r && typeof r === 'object' ? { ...r, stop: GROUNDS_STOP } : r)", 'export const groundsResult = r => r', M => {
    for (const stop of ['stuck_on_cell', 'no_material', 'keeper_held', 'no_site', 'complete', 'deadline']) {
      const seen = M.groundsResult({ status: 'no_effect', detail: 'x', stop })
      assert.deepStrictEqual(S.buildOrder({ ...base, now, state: { lastAt, lastStop: seen.stop } }), { order: { skill: 'build_shop', args: {} }, skip: null }, `${stop}: the bot goes on building`)
      assert.strictEqual(S.buildIdle({ lastStop: seen.stop }), false, `${stop}: the town still has a use for it`)
      assert.strictEqual(seen.status, 'no_effect'); assert.strictEqual(seen.detail, 'x')
    }
  })
  assert.strictEqual(G2.groundsResult(undefined), undefined)
})

console.log('CHAIN 3: quota turn -> every ready segment conflicts with another bot\'s -> the next segment, else the order')
const farRec = () => ({
  cells: [...[10, 11].map(x => ({ at: [x, G + 1, 0], role: 'earth', seg: 'A' })), ...[13, 14].map(x => ({ at: [x, G + 1, 0], role: 'earth', seg: 'B' })), ...[30, 31].map(x => ({ at: [x, G + 1, 0], role: 'earth', seg: 'C' }))],
  segments: [{ seg: 'A', deps: [] }, { seg: 'B', deps: [] }, { seg: 'C', deps: [] }], clear: [], cut: [], replant: [],
})
await t('another bot holds B: A (2 columns from it) is never worked, the worker takes the NEXT segment C; control: with B free it starts at A', async () => {
  const x = await workerVisit({ record: farRec(), inv: { cobblestone: 16 }, held: [['seg-B', 'X']] })
  assert.strictEqual(x.seg0, 'C', 'the next segment that is not beside another bot\'s')
  const done = (srv, seg) => farRec().cells.filter(c => c.seg === seg).every(c => R.cellDone(srv.read(...c.at), PAL, c.role))
  assert.deepStrictEqual([done(x.srv, 'A'), done(x.srv, 'B'), done(x.srv, 'C')], [false, false, true], x.ops.join(' '))
  assert.strictEqual(G2.groundsNone({ seg: x.seg0, cuts: 0, clearFree: x.clearFree }), false)
  const c = await workerVisit({ record: farRec(), inv: { cobblestone: 16 } })
  assert.strictEqual(c.seg0, 'A', 'control')
})
await t('every open segment is another bot\'s or beside one, and the clear lease is another\'s: NOTHING is ready -> the turn is passed to the order (no visit, nothing spent)', async () => {
  const srv = server()
  const rec = { ...farRec(), cells: farRec().cells.filter(c => c.seg !== 'C'), segments: farRec().segments.filter(s => s.seg !== 'C') }
  const x = await workerVisit({ record: rec, srv, cuts: bumps(srv), inv: { cobblestone: 16 }, held: [['seg-B', 'X'], ['seg-clear', 'X']] })
  assert.strictEqual(x.seg0, null)
  assert.strictEqual(x.clearFree, false)
  assert.strictEqual(G2.groundsNone({ seg: x.seg0, cuts: 3, clearFree: x.clearFree }), true)
  assert.deepStrictEqual([x.r.placed, x.r.cleared], [0, 0], 'and the runner agrees: such a visit would have been an empty one')
  // what buildTidyVisit returns then, and what buildShopVisit does with it: passed, the order's own pick in the same visit
  const turned = { status: 'no_effect', detail: 'nothing of the grounds is ready', stop: 'grounds_none' }
  assert.strictEqual(G2.groundsPassed(turned), true)
  // control: the clear lease free -> the cuts are this bot's work, the visit runs
  const srv2 = server()
  const c = await workerVisit({ record: rec, srv: srv2, cuts: bumps(srv2), inv: {}, held: [['seg-B', 'X']] })
  assert.strictEqual(G2.groundsNone({ seg: c.seg0, cuts: 3, clearFree: c.clearFree }), false)
  assert.strictEqual(c.r.cleared, 3)
})

console.log('STAIRS FIRST (stairsFirst / stairSeg / stairsShare)')
// the survey's order (tidy.mjs tidyRecord): every group's ground layer, then every group's next. Group 0 is plain fill; group 1 a
// two-step staircase; group 2 a staircase cell standing on a plain fill of its own group (a pit under a stair).
const stairRec = () => ({
  cells: [
    ...[10, 11].map(x => ({ at: [x, G + 1, 0], role: 'earth', seg: 'T-00-0' })),
    { at: [30, G + 1, 0], role: 'access', seg: 'T-01-0' }, { at: [30, G + 2, 0], role: 'access', seg: 'T-01-1' },
    { at: [-20, G + 1, 0], role: 'earth', seg: 'T-02-0' }, { at: [-20, G + 2, 0], role: 'access', seg: 'T-02-1' },
  ],
  segments: [{ seg: 'T-00-0', deps: [] }, { seg: 'T-01-0', deps: [] }, { seg: 'T-02-0', deps: [] }, { seg: 'T-01-1', deps: ['T-01-0'] }, { seg: 'T-02-1', deps: ['T-02-0'] }],
  clear: [], cut: [], replant: [],
})
await t('stairsFirst: the staircase segments and the layers they wait on go first, in their own order; the rest after; no open staircase -> the record itself', async () => {
  await killedBy('  for (const s of [...want]) add(s)\n', '', M => {
    assert.deepStrictEqual(M.stairsFirst(stairRec()).segments.map(s => s.seg), ['T-01-0', 'T-02-0', 'T-01-1', 'T-02-1', 'T-00-0'])
  })
  const rec = stairRec()
  assert.strictEqual(G2.stairsFirst(rec, () => false), rec, 'every staircase cell laid or waived: untouched')
  assert.strictEqual(G2.stairsFirst(rec, () => true, false), rec, 'no stone in the bag: the survey\'s order')
  const plain = pitRec()
  assert.strictEqual(G2.stairsFirst(plain), plain)
  assert.deepStrictEqual(G2.stairsFirst(rec, c => c.at[0] === 30).segments.map(s => s.seg), ['T-01-0', 'T-01-1', 'T-00-0', 'T-02-0', 'T-02-1'], 'only the staircase still open')
  assert.deepStrictEqual(G2.stairsFirst(rec).cells, rec.cells, 'the cells are never touched')
  assert.strictEqual(G2.stairSeg(rec, 'T-01-0'), true); assert.strictEqual(G2.stairSeg(rec, 'T-00-0'), false); assert.strictEqual(G2.stairSeg(rec, null), false)
  assert.deepStrictEqual(G2.stairsShare({ clearMax: 16, clearsLast: false, behind: false }, true), { clearMax: 16, clearsLast: true, behind: false, stairs: true })
  const sh = { clearMax: 16, clearsLast: false, behind: false }
  assert.strictEqual(G2.stairsShare(sh, false), sh)
})
await t('IN A VISIT: the stairs are laid before any cut and before the plain fill, every step in one visit; control (the survey\'s order, cuts first): a cut is first', async () => {
  const stairCells = new Set(stairRec().cells.filter(c => c.role === 'access').map(c => c.at.join(',')))
  const run = async (M, first) => {
    const srv = server()
    const rec = first ? M.stairsFirst(stairRec(), c => !R.cellDone(srv.read(...c.at), PAL, c.role)) : stairRec()
    const sh = { clearMax: GK.GK.clearMax, clearsLast: false }
    const share = first ? M.stairsShare(sh, M.stairSeg(rec, R.workableSeg(rec, srv.read, PAL, () => true, null, { skipOpenDeps: true }))) : sh
    return workerVisit({ record: rec, srv, cuts: bumps(srv), inv: { cobblestone: 32 }, share })
  }
  const scenario = async M => {
    const x = await run(M, true)
    const places = x.ops.filter(o => o.startsWith('place:')).map(o => o.slice(6))
    assert.ok(x.ops[0]?.startsWith('place:') && stairCells.has(places[0]), `the first op is a stair step: ${x.ops.join(' ')}`)
    for (const k of stairCells) assert.ok(R.cellDone(x.srv.read(...k.split(',').map(Number)), PAL, 'access'), `step ${k} laid in this visit: ${x.ops.join(' ')}`)
    const lastStair = Math.max(...[...stairCells].map(k => x.ops.indexOf(`place:${k}`)))
    const firstCut = x.ops.findIndex(o => o.startsWith('clear:')), firstPlain = x.ops.indexOf(`place:10,${G + 1},0`)
    assert.ok(firstCut > lastStair, `every step before the first cut: ${x.ops.join(' ')}`)
    assert.ok(firstPlain > lastStair, `every step before the plain fill: ${x.ops.join(' ')}`)
  }
  await scenario(G2)
  const c = await run(G2, false)
  assert.ok(c.ops[0].startsWith('clear:'), `control: ${c.ops.join(' ')}`)
  // the anchored mutant: without the layers a staircase waits on, the step over a pit is passed (its layer below is open) and the
  // visit never comes back to it
  let why = null
  await withMutant(G2_PATH, '  for (const s of [...want]) add(s)\n', '', async M => { try { await scenario(M) } catch (err) { why = err } })
  assert.ok(why instanceof assert.AssertionError, `the mutant survived: ${why}`)
})
await t('THE COMPOSED TRAP: stairs first with NO STONE would end the visit `no_material` before a single fill -- so without stone the survey\'s order stands and the dirt is laid', async () => {
  const fills = x => x.ops.filter(o => o.startsWith('place:')).length
  const scenario = async M => {
    const srv = server()
    const has = n => n === 'dirt'                    // the bag: dirt only
    const rec = M.stairsFirst(stairRec(), () => true, T.TIDY_PALETTE.access.some(has))
    const x = await workerVisit({ record: rec, srv, inv: { dirt: 8 } })
    assert.ok(fills(x) >= 2, `the plain fill is laid with the dirt (${x.ops.join(' ')}; stop ${x.r.stop})`)
  }
  await scenario(G2)
  // positive control: the same bag with the stairs forced first lays nothing at all
  const c = await workerVisit({ record: G2.stairsFirst(stairRec()), inv: { dirt: 8 } })
  assert.deepStrictEqual([fills(c), c.r.stop], [0, 'no_material'], c.ops.join(' '))
  let why = null
  await withMutant(G2_PATH, '  if (!stone) return record\n', '', async M => { try { await scenario(M) } catch (err) { why = err } })
  assert.ok(why instanceof assert.AssertionError, `the mutant survived: ${why}`)
})

console.log('THE ORDER (keeperOrderPure over groundsOrderD): a bot underground or away is offered nothing and refused nothing')
await t('eligible: the tidy in its own (last) place with its slot; underground / away: it reads full; the keeper: first, as before', () => {
  const list = [{ plot: 'shop' }, { plot: 'house1' }, { plot: 'tidy' }]
  const states = [{ plot: 'shop', exists: true, complete: true }, { plot: 'house1', exists: true, complete: false, free: true }, { plot: 'tidy', exists: true, complete: false, free: true }]
  const as = (d, feet) => GK.keeperOrderPure(states, list, { d: G2.groundsOrderD(d, G2.groundsEligible({ feet, home: H70 }).ok) })
  for (const d of ['other', 'none', 'take']) {
    const up = as(d, [0, 71, 0]), down = as(d, [0, 20, 0])
    assert.deepStrictEqual(up.order.map(p => p.plot), ['shop', 'house1', 'tidy']); assert.strictEqual(up.states[2].free, true, d)
    assert.strictEqual(down.states[2].free, false, `${d}: underground`)
    assert.strictEqual(S.activeProject(down.states, down.order).plot, 'house1', 'and its order is its own project')
  }
  assert.strictEqual(as('mine', [0, 20, 0]).order[0].plot, 'tidy', 'the keeper lease\'s rules are its own (not touched here)')
})

// ---- the glue, on real files ---------------------------------------------------------------------------------------------------
const RECS = []
tapRecords(r => RECS.push(r))
const kindOf = r => String(r.skill?.name ?? r.kind ?? '').replace(/^_/, '')
const detailOf = r => String(r.skill?.detail ?? r.detail ?? '')
const quotaRows = () => RECS.filter(r => kindOf(r) === 'grounds_quota').map(detailOf)
const TKEY = PJ.projKey(H70, 'tidy')
const tidyRec = (extra = {}) => ({ v: 1, blueprint: 'tidy@1', plot: 'tidy', stageId: 'inwall', terraceV: 1, sitedAt: 1234, cells: [{ at: [10, 70, 0], role: 'earth', seg: 'T-00-0' }], cut: [], clear: [], replant: [], segments: [{ seg: 'T-00-0', deps: [] }], structure_complete: false, ...extra })
/** A fresh town: the workshop standing, the tidy record, a keeper (another bot) on the lease, the newest visit's open count. */
function town ({ tidy = tidyRec(), open = 2927, keeper = 'K', shop = true } = {}) {
  const dir = process.env.POOL_STATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-grounds2-pool-'))
  PS.publishPlan(dir, PS.planKey(H70), 'w', () => fakePlan(), { by: 'X' })
  if (shop) PJ.publishRecord(dir, PJ.projKey(H70, 'shop'), () => ({ v: 1, blueprint: 'workshop@1', plot: 'shop', cells: [], segments: [], structure_complete: true, completeAt: 1 }))
  if (tidy) PJ.publishRecord(dir, TKEY, () => tidy)
  if (keeper) PJ.takeLease(dir, TKEY, GK.GK_LEASE, keeper, { now: Date.now(), ttl: GK.GK.leaseTtlMs, meta: { term0: Date.now() } })
  if (tidy && open != null) GKW.openWrite(dir, TKEY, keeper ?? 'K', tidy, open)
  SK.shopActiveForget()
  return dir
}
const mkBot = (name = 'GroundsBot', pos = { x: 3, y: 71, z: 4 }) => ({ username: name, blockAt: () => null, entities: {}, inventory: { items: () => [], emptySlotCount: () => 30 }, entity: { position: pos } })
const X = SK._grounds2
/** One build visit as buildShop frames it: the decision, the visit (a result and, for the tidy, its counts), the row. */
function visitOf (M, b, now, tidyRun = { placed: 2, cleared: 1, outcome: 'deadline' }) {
  const g = M._grounds2.groundsBegin(b, now)
  const picked = !!b.groundsPick
  if (picked) { b.shopVisitPlot = 'tidy'; b.tidyLast = { ...tidyRun } } else b.shopVisitPlot = 'house1'
  M._grounds2.groundsEnd(b, g, { status: tidyRun.placed || tidyRun.cleared ? 'success' : 'no_effect', stop: picked ? G2.GROUNDS_STOP : 'deadline' })
  return { g, picked }
}

console.log('THE GLUE ON REAL FILES (skills.mjs groundsBegin / groundsEnd / shopActive)')
await t('positive control: the switch is ON here, the tidy has 4 slots (the listing has 5), and the tap sees rows', () => {
  assert.strictEqual(X.G2.on, true)
  assert.strictEqual(X.buildersFor(S.projectsOn().find(p => p.plot === 'tidy')), 4)
  assert.strictEqual(S.buildersOf(S.projectsOn().find(p => p.plot === 'tidy')), 5, 'control: the listing')
})
await t('a worker at the surface, 2,927 open: visits 2 and 4 are the grounds\' (marked; shopActive names the tidy while the visit runs), 1 and 3 the order\'s; one row a visit', async () => {
  const scenario = async M => {
    town()
    const b = mkBot(), now = Date.now()
    RECS.length = 0
    const seen = []
    for (let i = 1; i <= 4; i++) {
      const g = M._grounds2.groundsBegin(b, now)
      const marked = !!b.groundsPick
      b.shopVisitBusy = true
      const plot = M.shopActive(b, now).plot
      b.shopVisitBusy = false
      seen.push(`${g.turn}:${g.took}:${g.why}:${marked ? 'mark' : '-'}:${plot === 'tidy' ? 'tidy' : 'other'}`)
      if (marked) { b.shopVisitPlot = 'tidy'; b.tidyLast = { placed: 2, cleared: 1, outcome: 'deadline' } } else b.shopVisitPlot = plot
      M._grounds2.groundsEnd(b, g, { status: 'success', stop: 'deadline' })
      assert.strictEqual(b.groundsPick, null, 'the mark comes off with the visit')
    }
    assert.deepStrictEqual(seen, ['1:other:off_turn:-:other', '2:tidy:turn:mark:tidy', '3:other:off_turn:-:other', '4:tidy:turn:mark:tidy'])
  }
  await scenario(SK)
  assert.deepStrictEqual(quotaRows(), [
    'on=1 turn=1 open=2927 share=2 took=other why=off_turn placed=- cleared=- empty=0 out=deadline',
    'on=1 turn=2 open=2927 share=2 took=tidy why=turn placed=2 cleared=1 empty=0 out=deadline',
    'on=1 turn=3 open=2927 share=2 took=other why=off_turn placed=- cleared=- empty=0 out=deadline',
    'on=1 turn=4 open=2927 share=2 took=tidy why=turn placed=2 cleared=1 empty=0 out=deadline'])
  // the anchored mutant (a copy of skills.mjs without the mark): the turn is decided and nothing follows it
  let why = null
  await withSkills([['    if (d.took === \'tidy\') { bot.groundsPick = { at: now }; if (bot.projReserve) bot.projReserve.at = -Infinity }\n', '']], async M => { try { await scenario(M) } catch (err) { why = err } })
  assert.ok(why instanceof assert.AssertionError, `the mutant survived or died for another reason: ${why?.stack?.split('\n')[0] ?? 'survived'}`)
})
await t('every fourth visit between 101 and 500 open; none at 100', () => {
  for (const [open, want] of [[101, [4, 8]], [500, [4, 8]], [501, [2, 4, 6, 8]], [100, []]]) {
    town({ open })
    const b = mkBot(), got = []
    for (let i = 1; i <= 8; i++) { const v = visitOf(SK, b, Date.now()); if (v.picked) got.push(v.g.turn) }
    assert.deepStrictEqual(got, want, `open ${open}`)
  }
})
await t('CHAIN 2: a due turn underground or far away -> not eligible -> the order: no mark, no lease taken or let go, no keeper row, no visit row', () => {
  for (const [pos, why] of [[{ x: 3, y: 14, z: 4 }, 'underground'], [{ x: 400, y: 71, z: 4 }, 'away']]) {
    const dir = town()
    const b = mkBot('GroundsBot', pos)
    visitOf(SK, b, Date.now())                    // turn 1
    const files0 = fs.readdirSync(dir).sort()
    RECS.length = 0
    const g = X.groundsBegin(b, Date.now())       // turn 2: due
    assert.deepStrictEqual([g.turn, g.took, g.why, g.due, b.groundsPick], [2, 'other', why, true, null])
    b.shopVisitPlot = 'house1'
    X.groundsEnd(b, g, { status: 'success', stop: 'deadline' })
    assert.deepStrictEqual(fs.readdirSync(dir).sort(), files0, 'not one file of the town changed: no lease taken, none released')
    assert.deepStrictEqual(RECS.map(kindOf), ['grounds_quota'], 'the one row is the proof row -- no `_keeper` release, no refusal')
    assert.strictEqual(detailOf(RECS[0]), `on=1 turn=2 open=2927 share=2 took=other why=${why} placed=- cleared=- empty=0 out=deadline`)
    // positive control: the same bot at the surface gets that same turn
    town()
    const b2 = mkBot()
    visitOf(SK, b2, Date.now())
    assert.strictEqual(X.groundsBegin(b2, Date.now()).took, 'tidy')
  }
})
await t('CHAIN 4: the tidy record complete, absent, or the workshop not standing -> the order; an unknown open count funds nothing', () => {
  for (const [opts, why] of [[{ tidy: tidyRec({ structure_complete: true, completeAt: Date.now() }) }, 'record_complete'], [{ tidy: null }, 'record_none'], [{ shop: false }, 'record_no_workshop'], [{ open: null }, 'open_unknown']]) {
    town(opts)
    const b = mkBot()
    const got = []
    for (let i = 1; i <= 4; i++) { const v = visitOf(SK, b, Date.now()); got.push(`${v.g.took}:${v.g.why}`); assert.strictEqual(v.picked, false) }
    assert.deepStrictEqual(got, Array(4).fill(`other:${why}`))
  }
})
await t('the keeper\'s order is its own (never the quota\'s); four bots on the grounds -> a fifth\'s turn is the order\'s', () => {
  town({ keeper: 'GroundsBot' })
  const k = mkBot()
  for (let i = 1; i <= 2; i++) { const v = visitOf(SK, k, Date.now()); assert.deepStrictEqual([v.g.took, v.g.why, v.picked], ['other', 'keeper', false]) }
  const dir = town()
  for (let n = 1; n <= 4; n++) PJ.takeLease(dir, TKEY, `slot${n}`, `B${n}`, { now: Date.now() })
  const b = mkBot()
  visitOf(SK, b, Date.now())
  const v = visitOf(SK, b, Date.now())
  assert.deepStrictEqual([v.g.took, v.g.why, v.picked], ['other', 'full', false])
  // review r1 (Claude BLOCKER): THE LAST SLOT IS THE KEEPER'S. Three workers on the grounds -> a fourth worker's turn is the
  // order's (it may not take slot 4), so the keeper is never locked out of the waivers and the completion only it may do
  const dir2 = town()
  for (let n = 1; n <= 3; n++) PJ.takeLease(dir2, TKEY, `slot${n}`, `B${n}`, { now: Date.now() })
  const b2 = mkBot()
  visitOf(SK, b2, Date.now())
  const v2 = visitOf(SK, b2, Date.now())
  assert.deepStrictEqual([v2.g.took, v2.g.why, v2.picked], ['other', 'full', false], 'three workers hold the worker slots: the fourth slot is not a worker\'s')
  assert.strictEqual(SK._grounds2.buildersFor({ plot: 'tidy', builders: 5 }), 4, 'the keeper counts all four')
  assert.strictEqual(SK._grounds2.buildersFor({ plot: 'tidy', builders: 5 }, { worker: true }), 3, 'a worker counts three')
  // control: two on them -> the third slot is this bot's
  const dir3 = town()
  for (let n = 1; n <= 2; n++) PJ.takeLease(dir3, TKEY, `slot${n}`, `B${n}`, { now: Date.now() })
  const b3 = mkBot()
  visitOf(SK, b3, Date.now())
  assert.strictEqual(visitOf(SK, b3, Date.now()).picked, true)
})
await t('MUTANT: a worker counts every slot -- with three workers on the grounds a fourth takes the keeper\'s slot (killed)', async () => {
  let why = null
  await withMutant(G2_PATH, 'return worker ? Math.max(1, all - 1) : all }', 'return all }', async M => {
    try { assert.deepStrictEqual([M.groundsSlots(4, { worker: true }), M.groundsSlots(4)], [3, 4]) } catch (err) { why = err }
  })
  assert.ok(why, 'the mutant survived')
})
await t('CHAIN 1 on the glue: an empty grounds visit spends the bot\'s turns 10 minutes (row empty=1), then the grounds again; an interrupted visit spends nothing', () => {
  town()
  const b = mkBot(), t0 = Date.now()
  RECS.length = 0
  visitOf(SK, b, t0)
  const e = visitOf(SK, b, t0, { placed: 0, cleared: 0, outcome: 'no_material' })
  assert.strictEqual(e.picked, true)
  assert.ok(Math.abs(b.g2EmptyUntil - (Date.now() + 10 * MIN)) < 5000, `spent until ${b.g2EmptyUntil}`)
  assert.strictEqual(quotaRows().at(-1), 'on=1 turn=2 open=2927 share=2 took=tidy why=turn placed=0 cleared=0 empty=1 out=no_material')
  const until = b.g2EmptyUntil
  const got = []
  for (let i = 3; i <= 6; i++) { const v = visitOf(SK, b, until - 1); got.push(`${v.g.why}:${v.picked}`) }
  assert.deepStrictEqual(got, ['off_turn:false', 'spent:false', 'off_turn:false', 'spent:false'])
  visitOf(SK, b, until)
  town()   // (the count is at most 2 h old: a fresh town for the later clock)
  const v8 = visitOf(SK, b, until)
  assert.deepStrictEqual([v8.g.turn, v8.g.why, v8.picked], [8, 'turn', true], 'at the end of the spend the turn is the grounds\' again')
  // interrupted: the visit threw (no result), its counts never came back
  town()
  const b2 = mkBot()
  visitOf(SK, b2, Date.now())
  const g = X.groundsBegin(b2, Date.now())
  b2.shopVisitPlot = 'tidy'; b2.tidyLast = { placed: 0, cleared: 0, outcome: 'aborted' }
  RECS.length = 0
  X.groundsEnd(b2, g, undefined)
  assert.strictEqual(b2.g2EmptyUntil, 0)
  assert.strictEqual(quotaRows()[0], 'on=1 turn=2 open=2927 share=2 took=tidy why=turn placed=- cleared=- empty=0 out=aborted')
})

// ---- end to end: the real build_shop skill on a fake bot ------------------------------------------------------------------------
// The runner's SKILL_TIMEOUT_MS (300 ms) puts a visit's deadline before its first step, so a visit that RUNS ends `deadline` with
// nothing placed: what is read here is the role, the leases, the rows and the result -- the placing itself is the runVisit chains'.
console.log('END TO END (skills.mjs SKILLS.build_shop on real files): the worker, the turn given back, and the old crew under GROUNDS2=off')
const FILL2 = () => tidyRec({ home: H70, r: 32, sitedAt: Date.now(), refreshAt: Date.now(), inwallAt: Date.now(), cells: [10, 11].map(x => ({ at: [x, G + 1, 0], role: 'earth', seg: 'T-00-0' })) })
const BAG = () => [10, 11].map(slot => ({ name: 'dirt', count: 64, stackSize: 64, type: 1, slot })).concat([12, 13].map(slot => ({ name: 'cobblestone', count: 64, stackSize: 64, type: 2, slot })))
function liveBot (name = 'GroundsBot', pos = [3.5, 71, 4.5], items = BAG) {
  const srv = server()
  return Object.assign(new EventEmitter(), { username: name, worldId: 'w', entities: {}, players: {}, _client: Object.assign(new EventEmitter(), { write: () => {} }),
    blockAt: p => { const b = srv.read(p.x, p.y, p.z); return b ? { ...b, position: new Vec3(p.x, p.y, p.z), type: 1, shapes: b.boundingBox === 'block' ? [[0, 0, 0, 1, 1, 1]] : [] } : null },
    inventory: { items, emptySlotCount: () => 30, slots: [] }, entity: { position: new Vec3(...pos) } })
}
const rowsOf = kind => RECS.filter(r => kindOf(r) === kind).map(detailOf)
const leaseFiles = dir => fs.readdirSync(dir).filter(n => /\.(helper\d|keeper)\.lease\./.test(n)).map(n => n.replace(/^.*\.tidy\./, '')).sort()
const runBuild = async (M, b, args = {}) => { RECS.length = 0; return M.SKILLS.build_shop.run({ bot: b }, args, new AbortController().signal) }
await t('the runner\'s clock: SKILL_TIMEOUT_MS is the suite\'s 300 ms (run this file through scripts/run-tests.mjs)', () => {
  assert.ok(Number(process.env.SKILL_TIMEOUT_MS) > 0 && Number(process.env.SKILL_TIMEOUT_MS) <= 1000, `SKILL_TIMEOUT_MS=${process.env.SKILL_TIMEOUT_MS}`)
})
await t('a quota turn: the visit is a WORKER\'s -- crew=worker, no helper lease taken, none let go, no keeper row; the order sees stop grounds_turn and its streaks untouched; the worker writes the open count', async () => {
  const rec = FILL2()
  const dir = town({ tidy: rec })
  const b = liveBot()
  b.g2Turn = 1; b.sinkStreak = 2; b.finiteStreak = 3
  const r = await runBuild(SK, b)
  assert.deepStrictEqual([r.status, r.stop], ['no_effect', G2.GROUNDS_STOP], JSON.stringify(r))
  const vis = rowsOf('build_visit')
  assert.strictEqual(vis.length, 1, vis.join(' | '))
  assert.ok(/^project=tidy outcome=deadline stop=deadline .* crew=worker /.test(vis[0]), vis[0])
  assert.deepStrictEqual(rowsOf('keeper'), [], 'no lease row at all')
  assert.deepStrictEqual(leaseFiles(dir), ['keeper.lease.g1.json'], 'the keeper\'s lease (another bot\'s) is the only crew lease on disk')
  assert.deepStrictEqual(quotaRows(), ['on=1 turn=2 open=2927 share=2 took=tidy why=turn placed=0 cleared=0 empty=1 out=deadline'])
  assert.deepStrictEqual([b.sinkStreak, b.finiteStreak], [2, 3], 'the order\'s own counts')
  assert.strictEqual(GKW.openNewest(GKW.openReadAll(dir, TKEY), GKW.gkwSig(rec), Date.now() + 1000), 2, 'the newest open count is this visit\'s (2 fills left), not the keeper\'s 2,927')
  assert.strictEqual(S.buildOrder({ ...base, now: Date.now() + 20 * MIN, state: { lastAt: Date.now(), lastStop: r.stop } }).order?.skill, 'build_shop', 'and the bot goes on building')
})
await t('CHAIN 3 end to end: every ready segment is another bot\'s and there is no cut -> the turn is given back and the ORDER\'S project is worked in the same visit: no tidy visit row, no bag row, no lease, nothing spent', async () => {
  const scenario = async M => {
    const dir = town({ tidy: FILL2() })
    PJ.takeLease(dir, TKEY, 'seg-T-00-0', 'X', { now: Date.now() })
    const b = liveBot()
    b.g2Turn = 1
    const r = await runBuild(M, b)
    const vis = rowsOf('build_visit')
    assert.strictEqual(vis.filter(v => v.startsWith('project=tidy ')).length, 0, `no grounds visit: ${vis.join(' | ')}`)
    assert.strictEqual(vis.length, 1, 'one visit: the order\'s own project')
    assert.notStrictEqual(r.stop, 'grounds_none'); assert.notStrictEqual(r.stop, G2.GROUNDS_STOP)
    assert.strictEqual(rowsOf('build_bag').filter(v => v.startsWith('project=tidy')).length, 0)
    assert.deepStrictEqual(rowsOf('keeper'), [])
    assert.deepStrictEqual(leaseFiles(dir), ['keeper.lease.g1.json'])
    const q = quotaRows()
    assert.strictEqual(q.length, 1)
    assert.ok(q[0].startsWith('on=1 turn=2 open=2927 share=2 took=other why=grounds_none placed=- cleared=- empty=0 '), q[0])
    assert.strictEqual(b.g2EmptyUntil ?? 0, 0, 'nothing spent: the next due turn asks again')
  }
  await scenario(SK)
  // anchored mutants (copies of skills.mjs): without the check the bot walks an empty grounds visit; without the pass the turn is lost
  for (const [old, neu] of [
    ["    if (worker && bot.groundsPick && groundsNone({ seg: g2Seg0, cuts: cuts.length, clearFree: segFree('clear') })) {", '    if (false) {'],
    ['    if (!groundsPassed(gr)) return groundsResult(gr)\n', '    return groundsResult(gr)\n'],
  ]) {
    let why = null
    await withSkills([[old, neu]], async M => { try { await scenario(M) } catch (err) { why = err } })
    assert.ok(why instanceof assert.AssertionError, `the mutant survived or died for another reason (${old.slice(4, 50)}): ${why?.stack?.split('\n')[0] ?? 'survived'}`)
  }
})
await t('STAIRS FIRST end to end: with stone in the bag the visit\'s first segment is the staircase; with dirt only it is the survey\'s first (the plain fill)', async () => {
  const withStair = () => tidyRec({ home: H70, r: 32, sitedAt: Date.now(), refreshAt: Date.now(), inwallAt: Date.now(),
    cells: [...[10, 11].map(x => ({ at: [x, G + 1, 0], role: 'earth', seg: 'T-00-0' })), { at: [30, G + 1, 0], role: 'access', seg: 'T-01-0' }],
    segments: [{ seg: 'T-00-0', deps: [] }, { seg: 'T-01-0', deps: [] }] })
  const firstSeg = async (M, items) => {
    town({ tidy: withStair() })
    const b = liveBot('GroundsBot', [3.5, 71, 4.5], items)
    b.g2Turn = 1
    await runBuild(M, b)
    assert.ok(rowsOf('build_visit')[0]?.startsWith('project=tidy '), `positive control: the grounds visit ran (${rowsOf('build_visit').join(' | ')})`)
    return /seg=(\S+)/.exec(rowsOf('build_seg')[0] ?? '')?.[1] ?? null
  }
  const dirtOnly = () => BAG().filter(i => i.name === 'dirt')
  const scenario = async M => { assert.strictEqual(await firstSeg(M, BAG), 'T-01-0', 'stone in the bag: the staircase first') }
  await scenario(SK)
  assert.strictEqual(await firstSeg(SK, dirtOnly), 'T-00-0', 'dirt only: the survey\'s order (a staircase first would end the visit no_material)')
  let why = null
  await withSkills([['visitRec = stairsFirst(v0, stairOpenQ, TIDY_PALETTE.access.some(n => !!effects?.has?.(n))); ', '']], async M => { try { await scenario(M) } catch (err) { why = err } })
  assert.ok(why instanceof assert.AssertionError, `the mutant survived or died for another reason: ${why?.stack?.split('\n')[0] ?? 'survived'}`)
})
await t('CHAIN 2 end to end: a due turn in a mine under the town -> the order\'s own project, in one visit: no grounds visit, no lease file, no keeper row', async () => {
  const dir = town({ tidy: FILL2() })
  const b = liveBot('GroundsBot', [3.5, 20, 4.5])
  b.g2Turn = 1
  await runBuild(SK, b)
  const vis = rowsOf('build_visit')
  assert.strictEqual(vis.length, 1); assert.ok(!vis[0].startsWith('project=tidy '), vis[0])
  assert.deepStrictEqual(rowsOf('keeper'), [])
  assert.deepStrictEqual(leaseFiles(dir), ['keeper.lease.g1.json'])
  assert.ok(quotaRows()[0]?.startsWith('on=1 turn=2 open=2927 share=2 took=other why=underground placed=- cleared=- empty=0 '), quotaRows().join(' | '))
})
await t('GROUNDS2=off POSITIVE CONTROL (behaviour): the same town, bot and order end `helper_idle` -- helper1 taken, then let go idle -- on the copy under the switch; ON it is a worker\'s visit with no lease', async () => {
  // the order names the tidy (the room fallback's args): the one visit both builds are sure to make to the grounds
  const forced = { plot: 'tidy', why: 'room_fallback' }
  const setup = () => { const dir = town({ tidy: FILL2() }); PJ.takeLease(dir, TKEY, 'seg-T-00-0', 'X', { now: Date.now() }); return dir }
  const dirOn = setup()
  const on = await runBuild(SK, liveBot(), forced)
  assert.ok(/^project=tidy outcome=(?!helper_idle)\S+ .* crew=worker /.test(rowsOf('build_visit')[0] ?? ''), rowsOf('build_visit').join(' | '))
  assert.deepStrictEqual(rowsOf('keeper'), []); assert.deepStrictEqual(leaseFiles(dirOn), ['keeper.lease.g1.json'])
  assert.notStrictEqual(on.stop, 'keeper_held')
  process.env.GROUNDS2 = 'off'
  try {
    await withSkills([], async M => {
      assert.strictEqual(M._grounds2.G2.on, false)
      const dir = setup()
      const r = await runBuild(M, liveBot(), forced)
      assert.deepStrictEqual([r.status, r.stop], ['no_effect', 'keeper_held'], JSON.stringify(r))
      assert.ok(/^project=tidy outcome=helper_idle stop=keeper_held .* crew=helper1 /.test(rowsOf('build_visit')[0] ?? ''), rowsOf('build_visit').join(' | '))
      assert.deepStrictEqual(rowsOf('keeper'), ['project=tidy op=helper_take kind=helper1 gen=1', 'project=tidy op=helper_release kind=helper1 gen=1 why=idle'])
      assert.deepStrictEqual(leaseFiles(dir), ['helper1.lease.g1.json', 'helper1.lease.g1.json.released', 'keeper.lease.g1.json'])
      assert.deepStrictEqual(quotaRows(), [], 'and no quota row')
    })
  } finally { delete process.env.GROUNDS2 }
})

console.log('THE GIVE-UP RULE IS AS BEFORE (a cell stuck after its tries)')
await t('a cut is given up by a bot after TIDY_CUT_TRIES evaluated visits that left it standing -- 3, unchanged; grounds2.mjs holds no knob over it', () => {
  const mem = new Map()
  for (let i = 1; i <= T.TIDY_CUT_TRIES; i++) { assert.strictEqual(T.tidyGivenUp(mem, '5,71,5'), false, `try ${i}`); T.tidyNoteCuts(mem, ['5,71,5'], () => true) }
  assert.strictEqual(T.tidyGivenUp(mem, '5,71,5'), true)
  assert.strictEqual(T.TIDY_CUT_TRIES, 3)
  assert.deepStrictEqual(Object.keys(G2.GROUNDS2).sort(), ['big', 'emptyMs', 'maxBots', 'shareBig', 'shareSmall', 'small', 'stuckMin', 'workerLiveMs'])
})

console.log('THE WIRING (skills.mjs; structural: what the fakes cannot reach -- comments stripped, each line once, a cut line fails)')
const WIRES = [
  // the visit: decided before the pick, framed by the row; the quota visit first, passed turns go on to the order
  'const g2 = groundsBegin(ctx.bot, Date.now(), args)',
  '} finally { groundsEnd(ctx.bot, g2, r) }',
  'if (!groundsPassed(gr)) return groundsResult(gr)',
  // the order and the slots
  'if (G2.on) d = groundsOrderD(d, !decorHeld && g2Eligible(bot).ok)',
  'if (p?.plot === TIDY_PLOT && G2.on) return groundsSlots(buildersOf(p), { worker })',
  // the role: no helper lease, no turning away -- and the OLD crew path still there, under the switch
  "worker = groundsRole({ d: k.d, kept: (k.d === 'mine' || k.d === 'take') && takeKeeper(bot, k.lease).ok }) === 'worker'",
  '} else if (GROUNDS.on) {',
  // nothing ready: the turn back before a draw; the stairs; no park gather for a worker; the open count
  "if (worker && bot.groundsPick && groundsNone({ seg: g2Seg0, cuts: cuts.length, clearFree: segFree('clear') })) {",
  'visitRec = stairsFirst(v0, stairOpenQ, TIDY_PALETTE.access.some(n => !!effects?.has?.(n))); stairsHead = visitRec !== v0',
  'if (stairsHead) { try { share = stairsShare(share, stairSeg(visitRec, workableSeg(visitRec, read, palette, tidySegOk, waivedK, { skipOpenDeps: true }), stairOpenQ)) }',
  'if (GROUNDS.on && caps.gather && !worker && r.placed === 0 && r.cleared === 0',
  'if (worker) { try { openWrite(dir, key, me, rw, tidyLeftKeys(rw, read2, progOpts).length + prog.cutLeft) }',
  // grounds-03: the switch and the order's hooks; the remembered stop (dropped, then set by a visit of the bot's own project); the
  // fall-through's leg; a visit ordered for the grounds; the late visit's budget
  'const G3 = Object.freeze({ on: G2.on && groundsFallOn() })',
  'if (G3.on) setGroundsFall({ ask: groundsAsk, hold: groundsHeld })',
  'if (!g3Only(args)) ctx.bot.g3Hold = null',
  'ctx.bot.g3Hold = groundsHoldOf(r?.stop)',
  'try { await groundsFallLeg(ctx, args, signal, g2, r, t0) } catch (e) { r = undefined; throw e }',
  'const d = only ? groundsOnly({ ...L, why: only }) : groundsDecide({ ...L, open, turn, carrying: g2Carrying(bot) })',
  'if (g3Only(args)) { bot.tidyLast = { placed: 0, cleared: 0, outcome: String(gr.stop) }; return groundsResult(gr) }',
  'const budget = Math.min(SHOP_SKILL_MS, Number(config.skills?.defaultTimeoutMs) > 0 ? Number(config.skills.defaultTimeoutMs) : SHOP_SKILL_MS) - (Number(bot.groundsPick?.used) || 0)',
]
const wired = src => { for (const w of WIRES) assert.strictEqual(src.split(w).length, 2, `wiring ${JSON.stringify(w.slice(0, 70))}: ${src.split(w).length - 1}`) }
await t('every wire is in place exactly once; a cut wire fails the check', () => {
  const s = strip(fs.readFileSync(SKILLS_FILE, 'utf8'))
  wired(s)
  for (const w of WIRES) assert.throws(() => wired(s.replace(w, '')), assert.AssertionError, w)
})
await t('GROUNDS2=off POSITIVE CONTROL (structure): the old crew path stands whole under the switch -- the helper lease, keeper_held, helper_idle', () => {
  const s = strip(fs.readFileSync(SKILLS_FILE, 'utf8'))
  const from = s.indexOf('} else if (GROUNDS.on) {'), to = s.indexOf('const caps = crewCaps(role)')
  assert.ok(from > 0 && to > from, 'the old role block, between the switch and the caps')
  const old = s.slice(from, to)
  for (const w of ["if (k.d === 'release') { releaseKeeper(bot, k.lease, 'term'); return out('no_effect', 'keeper_term'", 'const h = crewState(bot, true)', "if (h.d !== 'mine' && h.d !== 'take') return out('no_effect', 'keeper_held'", 'const hr = takeHelper(bot, h.name)', "role = 'helper'; helper = { name: h.name, gen: hr.gen }; f.crew = h.name", "if (k.d === 'none') return out('no_effect', 'keeper_rest'"]) assert.strictEqual(old.split(w).length, 2, w)
  for (const w of ["if (helper && !helperWorked(r, gathered?.n ?? 0)) { releaseHelper(bot, helper.name, helper.gen, 'idle'); helper = null; idleHelper = true }", "if (idleHelper) return out(status, 'helper_idle',", "if (h.d === 'mine' || (h.d === 'take' && !decorHeld && !(GKL_ON && unfit))) d = 'helper'"]) assert.strictEqual(s.split(w).length, 2, w)
  // and the new role block never reaches it: `helper` is only ever set inside the old block
  assert.strictEqual(s.split('helper = {').length, 2)
})

console.log('GROUNDS2=off (a second copy of skills.mjs under the switch): nothing decided, no row, the listing\'s slots')
await t('off: no decision, no mark, no `_grounds_quota` row, the tidy\'s 5 listed slots; control: ON decides in the same town', async () => {
  town()
  const on = visitOf(SK, mkBot(), Date.now())
  assert.strictEqual(on.g.why, 'off_turn', 'control: the live module decides')
  process.env.GROUNDS2 = 'off'
  try {
    await withSkills([], async M => {
      assert.strictEqual(M._grounds2.G2.on, false)
      town()
      const b = mkBot()
      RECS.length = 0
      for (let i = 1; i <= 4; i++) {
        const g = M._grounds2.groundsBegin(b, Date.now())
        assert.strictEqual(g, null); assert.strictEqual(b.groundsPick, null)
        b.shopVisitBusy = true
        assert.notStrictEqual(M.shopActive(b, Date.now()).plot, 'tidy', 'a non-keeper\'s visit is never the tidy by quota')
        b.shopVisitBusy = false
        M._grounds2.groundsEnd(b, g, { status: 'success', stop: 'deadline' })
      }
      assert.strictEqual(b.g2Turn, undefined, 'not even counted')
      assert.deepStrictEqual(quotaRows(), [])
      assert.strictEqual(M._grounds2.buildersFor(S.projectsOn().find(p => p.plot === 'tidy')), 5)
    })
  } finally { delete process.env.GROUNDS2 }
})

console.log('THE LICENCE ROW (features.mjs installFeatures)')
await t('`_grounds_mode` is written once at spawn, on=1 with the numbers', async () => {
  const { fakeWorld } = await import('./fakeworld.mjs')
  const F = await import('../src/features.mjs')
  RECS.length = 0
  F.installFeatures(fakeWorld().bot)
  assert.ok(RECS.length > 3, 'positive control: the tap sees the spawn\'s rows')
  assert.deepStrictEqual(rowsOf('grounds_mode'), ['on=1 v=1 big=500:2 small=100:4 empty_ms=600000 max_bots=4 fall=1'])
})


// ================================================================================================================================
// GROUNDS-03 (owner 11-12: "when all projects are complete, bots should be cleaning up and teraforming"; "yes, lets do both"):
// CLEANUP AS THE TRUE FALLBACK. LIVE showcase, 24 h to 11-12 17:00Z: 625 of 1,270 build visits ended `no_effect` and simply ended,
// beside a tidy with about 2,900 open cells. The pure rules at their boundaries; then the chains -- the first project's back-off
// still reaches the order, the grounds visit's own stop never does, an empty grounds cannot loop -- through the real build_shop and
// shop.mjs's real buildOrder. The runner's 300 ms clock is the TIME GATE's positive control on the real module (no fall-through
// ever has the time); the chains run on a copy of skills.mjs with that one gate opened (GATE_OPEN, anchored like a mutant).
// ================================================================================================================================
console.log('GROUNDS-03 THE PURE RULES (grounds2.mjs fallStops / groundsWork / groundsFall / groundsNoOrder / groundsOnly / groundsHold)')
const SHOP_PATH = new URL('../src/shop.mjs', import.meta.url)
const L0 = { record: 'open', emptyUntil: 0, feet: [3, 71, 4], home: H70, slotFree: true, now: 1_000_000 }
const F0 = { status: 'no_effect', stop: 'no_site', msLeft: 150_000, tailMs: 60_000, ...L0 }
const N0 = { skip: 'stuck_on_cell', sinceMs: 10 * MIN, cooldownMs: 10 * MIN, health: 20, healthMin: 10, freeSlots: 20, roomMin: 2, ...L0 }
const LINKS = [[{ keeper: true }, 'keeper'], [{ decor: true }, 'decor'], [{ record: 'complete' }, 'record_complete'], [{ record: 'stuck' }, 'record_stuck'], [{ record: 'none' }, 'record_none'],
  [{ emptyUntil: L0.now + 1 }, 'spent'], [{ feet: [3, 20, 4] }, 'underground'], [{ feet: [300, 71, 4] }, 'away'], [{ feet: null }, 'unknown'], [{ slotFree: false }, 'full']]
await t('fallStops: the stops that mean "nothing here for this bot now" fall through; a stop that used the time, an interruption, an unread town file, a plan step and the grounds\' own never do', () => {
  for (const s of ['no_site', 'site_wait', 'paths_no_site', 'copper_wait', 'waiting', 'no_material', 'no_tool', 'stuck_on_cell', 'cell_deferred', 'deps_open', 'body_wait', 'slots_full', 'keeper_held', 'complete', 'upkeep']) assert.strictEqual(G2.fallStops(s), true, s)
  for (const s of ['deadline', 'time', 'aborted', 'error', 'record_unreadable', 'lost_record', 'lost_lease', 'state_unwritable', 'site_unread', 'zones_unknown', 'no_plan', 'off', 'fence:slot', 'fence:segment',
    'replanned', 'replant_wait', 'land_planned', 'grounds_none', 'grounds_turn', 'helper_idle', 'blocked', 'underground', 'room', '', null, undefined]) assert.strictEqual(G2.fallStops(s), false, String(s))
  assert.strictEqual(G2.FALL_STOPS.length, 20); assert.ok(Object.isFrozen(G2.FALL_STOPS))
  assert.strictEqual(new Set(G2.FALL_STOPS).size, 20)
})
await t('groundsWork: every link the fall-through and the ask share -- keeper, decorator, the record, the spent turns, the bot\'s place, a slot', () => {
  assert.deepStrictEqual(G2.groundsWork(L0), { ok: true, why: null })
  for (const [patch, why] of LINKS) assert.deepStrictEqual(G2.groundsWork({ ...L0, ...patch }), { ok: false, why }, why)
  assert.deepStrictEqual(G2.groundsWork({ ...L0, on: false }), { ok: false, why: 'off' })
  assert.deepStrictEqual(G2.groundsWork({ ...L0, emptyUntil: L0.now }), { ok: true, why: null }, 'the spend ends AT emptyUntil')
  assert.deepStrictEqual(G2.groundsWork(), { ok: false, why: 'record_none' }, 'nothing read: not the grounds\'')
})
await t('groundsFall: no work + a fall stop + the time -> the grounds; THE TIME: 90 s of the skill\'s clock left (a 60 s tail + 30 s of work), 89.999 is short', async () => {
  assert.deepStrictEqual(G2.groundsFall(F0), { fall: true, why: 'fallback:no_site', asked: true })
  for (const stop of ['no_material', 'stuck_on_cell', 'complete', 'slots_full', 'deps_open']) assert.strictEqual(G2.groundsFall({ ...F0, stop }).why, `fallback:${stop}`)
  await killedBy("  if (!(Number(msLeft) - Number(tailMs) >= G.workMs)) return no('short', true)\n", '', M => {
    assert.deepStrictEqual(M.groundsFall({ ...F0, msLeft: 90_000 }), { fall: true, why: 'fallback:no_site', asked: true })
    assert.deepStrictEqual(M.groundsFall({ ...F0, msLeft: 89_999 }), { fall: false, why: 'short', asked: true })
  })
  assert.strictEqual(G2.GROUNDS3.workMs, 30_000)
  // of the showcase's 180 s: a first project that used 90 s still falls through, one that used 91 s does not
  assert.strictEqual(G2.groundsFall({ ...F0, msLeft: 180_000 - 90_000 }).fall, true); assert.strictEqual(G2.groundsFall({ ...F0, msLeft: 180_000 - 91_000 }).why, 'short')
  assert.strictEqual(G2.groundsFall({ ...F0, msLeft: undefined }).why, 'short', 'an unknown clock is no time')
  // WORK DONE (placed, cleared or planted -- the generic visit's status counts only `placed`): never a fall-through
  await killedBy(" || [placed, cleared, planted].some(n => (Number(n) || 0) > 0)) return no('worked')", ") return no('worked')", M => {
    for (const did of [{ placed: 1 }, { cleared: 3 }, { planted: 1 }]) assert.deepStrictEqual(M.groundsFall({ ...F0, stop: 'no_material', ...did }), { fall: false, why: 'worked', asked: false }, JSON.stringify(did))
  })
  assert.deepStrictEqual(G2.groundsFall({ ...F0, status: 'success' }), { fall: false, why: 'worked', asked: false })
  assert.deepStrictEqual(G2.groundsFall({ ...F0, status: 'failed' }), { fall: false, why: 'worked', asked: false }, 'only a visit that ran and changed nothing')
  assert.deepStrictEqual(G2.groundsFall({ ...F0, stop: 'deadline' }), { fall: false, why: 'stop', asked: false })
  assert.deepStrictEqual(G2.groundsFall({ ...F0, grounds: true }), { fall: false, why: 'grounds', asked: false }, 'the visit was the grounds\' already')
  assert.deepStrictEqual(G2.groundsFall({ ...F0, passed: true }), { fall: false, why: 'passed', asked: true }, 'its quota turn was turned away moments ago')
  assert.deepStrictEqual(G2.groundsFall({ ...F0, on: false }), { fall: false, why: 'off', asked: false })
  for (const [patch, why] of LINKS) assert.deepStrictEqual(G2.groundsFall({ ...F0, ...patch }), { fall: false, why, asked: true }, why)
})
await t('groundsNoOrder: asked for complete / no_site / stuck_on_cell / slots_full, after the cooldown, with health and 2 free slots; never for idle, underground, health, room', () => {
  assert.deepStrictEqual(G2.groundsNoOrder(N0), { ask: true, why: 'no_order:stuck_on_cell' })
  assert.deepStrictEqual([...G2.NO_ORDER_SKIPS], ['complete', 'no_site', 'stuck_on_cell', 'slots_full'])
  for (const skip of G2.NO_ORDER_SKIPS) assert.deepStrictEqual(G2.groundsNoOrder({ ...N0, skip }), { ask: true, why: `no_order:${skip}` })
  for (const skip of ['idle', 'underground', 'health', 'room', null, undefined, '']) assert.deepStrictEqual(G2.groundsNoOrder({ ...N0, skip }), { ask: false, why: 'skip' }, String(skip))
  assert.deepStrictEqual(G2.groundsNoOrder({ ...N0, sinceMs: 10 * MIN - 1 }), { ask: false, why: 'cooldown' })
  assert.deepStrictEqual(G2.groundsNoOrder({ ...N0, sinceMs: 3 * MIN, cooldownMs: 3 * MIN }).ask, true, 'the showcase\'s 3-minute cooldown')
  assert.deepStrictEqual([G2.groundsNoOrder({ ...N0, health: 10 }).why, G2.groundsNoOrder({ ...N0, health: 11 }).ask], ['health', true])
  assert.deepStrictEqual([G2.groundsNoOrder({ ...N0, freeSlots: 1 }).why, G2.groundsNoOrder({ ...N0, freeSlots: 2 }).ask], ['room', true])
  assert.deepStrictEqual(G2.groundsNoOrder({ ...N0, on: false }), { ask: false, why: 'off' })
  for (const [patch, why] of LINKS) assert.deepStrictEqual(G2.groundsNoOrder({ ...N0, ...patch }), { ask: false, why }, why)
})
await t('groundsOnly / groundsHold / the rows: a visit ordered for the grounds; the remembered stop; `why=fallback:` `why=no_order:` `fall=`; the switch', () => {
  assert.deepStrictEqual(G2.groundsOnly({ ...L0, why: 'no_order:no_site' }), { took: 'tidy', why: 'no_order:no_site', share: 0, due: true })
  assert.deepStrictEqual(G2.groundsOnly({ ...L0, why: 'no_order:no_site', slotFree: false }), { took: 'other', why: 'no_order:no_site', share: 0, due: true, fall: 'full' })
  assert.deepStrictEqual(G2.groundsHoldOf('stuck_on_cell', 5), { stop: 'stuck_on_cell', at: 5 }); assert.deepStrictEqual(G2.groundsHoldOf('no_site', 6), { stop: 'no_site', at: 6 })
  for (const s of ['no_material', 'deadline', 'complete', 'grounds_turn', 'aborted', undefined]) assert.strictEqual(G2.groundsHoldOf(s, 5), null, String(s))
  const st = { lastAt: 900, lastStop: 'grounds_turn', x: 1 }
  assert.strictEqual(G2.groundsHold(st, null), st, 'no hold: the state itself, exactly as before')
  assert.deepStrictEqual(G2.groundsHold(st, { stop: 'stuck_on_cell', at: 100 }), { lastAt: 100, lastStop: 'stuck_on_cell', x: 1 }, 'the held stop AND its own time')
  for (const bad of [{ stop: 'deadline', at: 100 }, { stop: 'no_site', at: NaN }, { stop: 'no_site' }, {}]) assert.strictEqual(G2.groundsHold(st, bad), st, JSON.stringify(bad))
  assert.strictEqual(G2.groundsQuotaDetail({ on: true, turn: 3, open: 2927, share: 2, took: 'tidy', why: 'fallback:no_site', placed: 4, cleared: 1, empty: false, out: 'deadline' }), 'on=1 turn=3 open=2927 share=2 took=tidy why=fallback:no_site placed=4 cleared=1 empty=0 out=deadline')
  assert.strictEqual(G2.groundsQuotaDetail({ on: true, turn: 3, open: 2927, share: 2, took: 'other', why: 'off_turn', out: 'no_site', fall: 'short' }), 'on=1 turn=3 open=2927 share=2 took=other why=off_turn placed=- cleared=- empty=0 out=no_site fall=short')
  assert.strictEqual(G2.groundsQuotaDetail({ took: 'tidy', why: 'turn', late: 7, fall: 'x' }).endsWith(' late=7 fall=x'), true)
  assert.strictEqual(G2.groundsFallOn({}), true, 'default ON')
  for (const v of ['off', '0', 'false', 'no', ' OFF ']) assert.strictEqual(G2.groundsFallOn({ GROUNDSFALL: v }), false, v)
  assert.strictEqual(G2.groundsModeDetail(true, G2.GROUNDS2, false).endsWith(' max_bots=4 fall=0'), true, 'the rollback is visible at spawn')
  assert.strictEqual(G2.groundsModeDetail(false).endsWith(' fall=0'), true, 'it acts only where GROUNDS2 is on')
})

console.log('GROUNDS-03 CHAIN (item 6): a blocked project AND an empty grounds -> the turns are spent 10 minutes: no fall-through, no order for the grounds, no quota turn -- never a loop')
await t('pure chain: the empty fall-through shuts every route to the grounds for 10 minutes, and all three open again after them; MUTANT (no spend in groundsWork): killed', async () => {
  await killedBy("  if (now < (Number(emptyUntil) || 0)) return no('spent')\n", '', M => {
    let now = 1_000_000, emptyUntil = 0
    const q = () => ({ ...L0, emptyUntil, now })
    assert.strictEqual(M.groundsFall({ ...F0, stop: 'stuck_on_cell', ...q() }).fall, true, 'visit 1: the project is stuck, the visit goes on to the grounds')
    emptyUntil = M.groundsAfter({ took: 'tidy', placed: 0, cleared: 0, emptyUntil, now }).emptyUntil   // ...which fixed nothing
    assert.strictEqual(emptyUntil, now + 10 * MIN)
    for (let i = 1; i <= 3; i++) {           // the order comes back every 3 minutes (the showcase's cooldown)
      now += 3 * MIN
      assert.deepStrictEqual(M.groundsFall({ ...F0, stop: 'stuck_on_cell', ...q() }), { fall: false, why: 'spent', asked: true }, `+${3 * i} min: no second empty fall-through`)
      assert.deepStrictEqual(M.groundsNoOrder({ ...N0, sinceMs: 3 * MIN, cooldownMs: 3 * MIN, ...q() }), { ask: false, why: 'spent' }, `+${3 * i} min: the order is not asked for the grounds`)
      assert.strictEqual(M.groundsDecide({ ...D0, turn: 2, emptyUntil, now }).why, 'spent', 'nor is its quota turn')
    }
    now += MIN                               // +10 min
    assert.strictEqual(M.groundsFall({ ...F0, stop: 'stuck_on_cell', ...q() }).fall, true)
    assert.strictEqual(M.groundsNoOrder({ ...N0, sinceMs: 3 * MIN, cooldownMs: 3 * MIN, ...q() }).ask, true)
  })
})

console.log('GROUNDS-03 CHAIN (items 2 + 3) through shop.mjs\'s real buildOrder and the real glue: the bot\'s own back-off holds, and EVERY build visit inside it is the grounds\'')
/** What cognitive.mjs keeps of a build visit: the order charges `lastAt` at issue; the visit's end writes both. */
const ordOf = (Sx, now, state, o = {}) => Sx.buildOrder({ ...base, now, state, ...o })
const GROUNDS_ORDER = why => ({ order: { skill: 'build_shop', args: { grounds: true, why } }, skip: null })
const OWN_ORDER = { order: { skill: 'build_shop', args: {} }, skip: null }
await t('the bot\'s project ended stuck_on_cell: for 6 h the order has nothing for it -- now every cooldown is a grounds visit (5 of 5, not every second), each hidden from the order, and the 6 h end when they did before; MUTANTS (no hold; the order reads the raw state): killed', async () => {
  const H6 = S.SHOP_STUCK_RETRY_MS
  const scenario = async (P, Sx) => {
    town()
    const b = mkBot(), T0 = Date.now(), rec = { plot: 'house1' }
    SK.shopActive(b, T0)                                    // the hooks read the bot the order last saw
    b.g3Hold = P.groundsHoldOf('stuck_on_cell', T0)         // as buildShop leaves it when the bot's own project ends stuck_on_cell (end to end below)
    const st0 = { lastAt: T0, lastStop: 'stuck_on_cell' }
    // positive control -- grounds-01/02: nothing for 6 h
    Sx.setGroundsFall(null)
    for (const dt of [11 * MIN, 3 * 3600_000, H6 - 1]) assert.deepStrictEqual(ordOf(Sx, T0 + dt, st0, { record: rec }), { order: null, skip: 'stuck_on_cell' })
    assert.deepStrictEqual(ordOf(Sx, T0 + H6, st0, { record: rec }), OWN_ORDER)
    Sx.setGroundsFall({ ask: X.groundsAsk, hold: P === G2 ? X.groundsHeld : st => P.groundsHold(st, b.g3Hold ?? null) })
    RECS.length = 0
    let state = st0
    const seen = []
    for (let k = 1; k <= 5; k++) {
      const now = T0 + k * (10 * MIN + 1000)
      const o = ordOf(Sx, now, state, { record: rec })
      seen.push(o.order ? (o.order.args?.grounds === true ? o.order.args.why : 'own') : `skip:${o.skip}`)
      if (o.order?.args?.grounds !== true) break
      // the visit, as buildShop frames it; a grounds visit that worked
      const g = X.groundsBegin(b, now, o.order.args)
      assert.deepStrictEqual([g.took, g.why, !!b.groundsPick], ['tidy', 'no_order:stuck_on_cell', true])
      b.shopVisitPlot = 'tidy'; b.tidyLast = { placed: 2, cleared: 1, outcome: 'stuck_on_cell' }   // the TIDY's own stuck stop...
      const r = P.groundsResult({ status: 'success', stop: 'stuck_on_cell' })
      X.groundsEnd(b, g, r)
      state = { lastAt: now, lastStop: r.stop }             // ...reaches the order as `grounds_turn`
      assert.strictEqual(state.lastStop, G2.GROUNDS_STOP)
    }
    assert.deepStrictEqual(seen, Array(5).fill('no_order:stuck_on_cell'), 'EVERY build visit inside the back-off is the grounds\'')
    assert.deepStrictEqual(quotaRows(), Array(5).fill('on=1 turn=0 open=2927 share=0 took=tidy why=no_order:stuck_on_cell placed=2 cleared=1 empty=0 out=stuck_on_cell'))
    assert.strictEqual(b.g2Turn, 0, 'none of them a turn of the quota\'s count')
    // (a) the ORIGINAL back-off, as before: 6 h from the project's stop -- not from the last grounds visit, and not erased by one
    assert.deepStrictEqual(ordOf(Sx, T0 + H6 - 1, state, { record: rec }), GROUNDS_ORDER('no_order:stuck_on_cell'))
    assert.deepStrictEqual(ordOf(Sx, T0 + H6, state, { record: rec }), OWN_ORDER, 'the project is asked again exactly when it was before')
    Sx.setGroundsFall({ ask: () => null, hold: X.groundsHeld })
    assert.deepStrictEqual(ordOf(Sx, T0 + H6 - 1, state, { record: rec }), { order: null, skip: 'stuck_on_cell' }, 'no grounds to offer: the skip as before')
  }
  try {
    await scenario(G2, S)
    let why = null
    await withMutant(G2_PATH, 'export const groundsHold = (state, hold) => (hold && HOLD_STOPS.includes(hold.stop) && Number.isFinite(hold.at) ? { ...(state ?? {}), lastStop: hold.stop, lastAt: hold.at } : state)', 'export const groundsHold = (state, hold) => state', async M => { try { await scenario(M, S) } catch (err) { why = err } })
    assert.ok(why instanceof assert.AssertionError, `MUTANT (no hold: the first grounds visit erases the 6-hour back-off) survived or died for another reason: ${why?.stack?.split('\n')[0] ?? 'survived'}`)
    why = null
    await withMutant(SHOP_PATH, "  if (own.lastStop === 'stuck_on_cell' && now - (own.lastAt ?? -Infinity) < SHOP_STUCK_RETRY_MS) return { order: null, skip: 'stuck_on_cell' }", "  if (state.lastStop === 'stuck_on_cell' && now - (state.lastAt ?? -Infinity) < SHOP_STUCK_RETRY_MS) return { order: null, skip: 'stuck_on_cell' }", async Sm => { try { await scenario(G2, Sm) } catch (err) { why = err } })
    assert.ok(why instanceof assert.AssertionError, `MUTANT (the order's back-off reads the raw state) survived or died for another reason: ${why?.stack?.split('\n')[0] ?? 'survived'}`)
  } finally { S.setGroundsFall({ ask: X.groundsAsk, hold: X.groundsHeld }) }
})
await t('the ask reads the bot the order last saw: underground, the worker slots full, a spent bot or a closed record are asked nothing (the skip as before); the refusal read from the town\'s files stands 30 s', () => {
  const state = { lastAt: 0, lastStop: 'stuck_on_cell' }
  const ask = (b, now = Date.now()) => { SK.shopActive(b, now); return X.groundsAsk({ skip: 'stuck_on_cell', now, state, health: 20, freeSlots: 20 }) }
  town()
  assert.deepStrictEqual(ask(mkBot()), { order: { skill: 'build_shop', args: { grounds: true, why: 'no_order:stuck_on_cell' } } }, 'positive control')
  assert.strictEqual(ask(mkBot('GroundsBot', { x: 3, y: 14, z: 4 })), null, 'in a mine under the town')
  const spent = mkBot(); spent.g2EmptyUntil = Date.now() + 5 * MIN
  assert.strictEqual(ask(spent), null)
  assert.strictEqual(X.groundsAsk({ skip: 'idle', now: Date.now(), state }), null)
  assert.strictEqual(X.groundsAsk({ skip: 'stuck_on_cell', now: Date.now(), state: { lastAt: Date.now() - MIN } }), null, 'inside the cooldown')
  const dir = town()
  for (let n = 1; n <= 3; n++) PJ.takeLease(dir, TKEY, `slot${n}`, `B${n}`, { now: Date.now() })
  const b = mkBot()
  assert.strictEqual(ask(b), null, 'three workers on the grounds: the last slot is the keeper\'s')
  for (let n = 1; n <= 3; n++) PJ.releaseLease(dir, TKEY, `slot${n}`, `B${n}`, PJ.leaseState(dir, TKEY, `slot${n}`).gen)
  assert.strictEqual(ask(b), null, 'the refusal stands 30 s (the town\'s files are not read at every decision)')
  assert.notStrictEqual(ask(b, Date.now() + 31_000), null, 'and is asked again after them')
  town({ tidy: tidyRec({ structure_complete: true, completeAt: Date.now() }) })
  assert.strictEqual(ask(mkBot()), null, 'the inside complete: the next stage is the keeper\'s')
})

// ---- end to end: the real build_shop, the order's own project blocked ------------------------------------------------------------
console.log('GROUNDS-03 END TO END (skills.mjs SKILLS.build_shop on real files; shop.mjs buildOrder): the paths cannot be sited -> the same visit goes on to the grounds')
const DONE = (dir, plot) => PJ.publishRecord(dir, PJ.projKey(H70, plot), () => ({ v: 1, plot, cells: [], segments: [], structure_complete: true, completeAt: 1 }))
/** A town whose order's own pick is the PATHS, which end `no_site` in milliseconds (no destination to route to): the workshop, the
 *  stair, the house and the monument stand; the tidy is open with two fills. */
function blockedTown (M = SK, opts = {}) { const dir = town({ tidy: FILL2(), ...opts }); for (const p of ['shaft', 'house1', 'monument']) DONE(dir, p); M.shopActiveForget(); return dir }
/** THE TIME GATE OPENED (a copy of skills.mjs, the anchor present and unique): under the runner's 300 ms clock no visit has 90 s left. */
const GATE_OPEN = ['tailMs: ZIG_VISIT_TAIL_MS }', 'tailMs: -1e9 }']
const TAP = { onRow: null }
tapRecords(r => TAP.onRow?.(r))
await t('THE TIME GATE, on the real module (positive control): the paths end no_site with 300 ms on the clock -- the visit just ends, the row says `fall=short`, the back-off is remembered all the same', async () => {
  blockedTown(SK)
  const b = liveBot()
  const r = await runBuild(SK, b)
  assert.deepStrictEqual([r.status, r.stop], ['no_effect', 'no_site'], JSON.stringify(r))
  const vis = rowsOf('build_visit')
  assert.strictEqual(vis.length, 1, vis.join(' | ')); assert.ok(vis[0].startsWith('project=paths outcome=no_site stop=no_site '), vis[0])
  assert.deepStrictEqual(quotaRows(), ['on=1 turn=1 open=2927 share=2 took=other why=off_turn placed=- cleared=- empty=0 out=no_site fall=short'])
  assert.strictEqual(b.g2EmptyUntil ?? 0, 0)
  assert.strictEqual(b.g3Hold?.stop, 'no_site')
})
/** The fall-through visit and what it must leave behind. -> { dir, b, r } */
async function fallVisit (M) {
  const dir = blockedTown(M)
  const b = liveBot()
  const r = await runBuild(M, b)
  // (a) the visit's result is the FIRST project's: its stop, its detail
  assert.deepStrictEqual([r.status, r.stop], ['no_effect', 'no_site'], JSON.stringify(r))
  assert.ok(String(r.detail).startsWith('no path network'), r.detail)
  const vis = rowsOf('build_visit')
  assert.strictEqual(vis.length, 2, `the paths' visit, then the grounds': ${vis.join(' | ')}`)
  assert.ok(vis[0].startsWith('project=paths outcome=no_site stop=no_site '), vis[0])
  assert.ok(/^project=tidy outcome=deadline stop=deadline .* crew=worker /.test(vis[1]), vis[1])
  assert.deepStrictEqual(rowsOf('keeper'), [], 'a WORKER: no lease row'); assert.deepStrictEqual(leaseFiles(dir), ['keeper.lease.g1.json'])
  assert.deepStrictEqual(quotaRows(), ['on=1 turn=1 open=2927 share=2 took=tidy why=fallback:no_site placed=0 cleared=0 empty=1 out=deadline'])
  assert.ok(Math.abs((b.g2EmptyUntil ?? 0) - (Date.now() + 10 * MIN)) < 5000, 'ITEM 6: the grounds leg fixed nothing (the clock) -- the bot\'s grounds turns are spent 10 minutes')
  assert.strictEqual(b.g3Hold?.stop, 'no_site', 'the bot\'s stop on its OWN project is remembered for the order')
  assert.strictEqual(b.shopNoSitePlot, 'paths', 'the failed siting is the paths\', as before')
  assert.ok((b.shopIdle?.get('paths') ?? 0) > Date.now() && !b.shopIdle.has('tidy'), 'the no-effect visit is noted against the first project, as before')
  assert.deepStrictEqual([b.groundsPick, b.shopVisitBusy], [null, false], 'the marks come off')
  return { dir, b, r }
}
await t('ITEM 1 + 2: no_site -> the grounds in the SAME visit as a worker; the result, the site retry and the idle mark stay the paths\'; then the order (real buildOrder): a day\'s site retry from the paths\' stop, a grounds visit at every cooldown inside it, the tidy\'s own stop never seen; MUTANT (the stop not remembered): killed', async () => {
  const scenario = async M => {
    const { b, r } = await fallVisit(M)
    S.setGroundsFall({ ask: M._grounds2.groundsAsk, hold: M._grounds2.groundsHeld })
    const t1 = Date.now(), st1 = { lastAt: t1, lastStop: r.stop }                 // what cognitive.mjs writes after the visit
    assert.deepStrictEqual(ordOf(S, t1 + 5 * MIN, st1), { order: null, skip: null }, 'inside the cooldown: nothing, as before')
    // ITEM 6 at the glue: inside the spend the grounds are not ordered (the order's skip stands: the bot's turn is its other jobs' and
    // the model's, as in any back-off); at its end they are
    const asked = now => M._grounds2.groundsAsk({ skip: 'no_site', now, state: { lastAt: now - 10 * MIN - 1 }, health: 20, freeSlots: 20 })
    assert.strictEqual(asked(b.g2EmptyUntil - 1), null, 'spent'); assert.notStrictEqual(asked(b.g2EmptyUntil), null)
    const o1 = ordOf(S, t1 + 10 * MIN + 1000, st1)
    assert.deepStrictEqual(o1, GROUNDS_ORDER('no_order:no_site'), 'the paths wait a day: the grounds are ordered (the spend of the empty leg is over too)')
    // that visit, end to end (ten minutes on: the visit's own clock is the real one)
    b.g2EmptyUntil = 0
    const hold0 = { ...b.g3Hold }
    const r2 = await runBuild(M, b, o1.order.args)
    assert.deepStrictEqual([r2.status, r2.stop], ['no_effect', G2.GROUNDS_STOP], JSON.stringify(r2))
    const vis = rowsOf('build_visit')
    assert.strictEqual(vis.length, 1, vis.join(' | ')); assert.ok(/^project=tidy .* crew=worker /.test(vis[0]), `the grounds only -- never the paths inside their back-off: ${vis[0]}`)
    assert.deepStrictEqual(quotaRows(), ['on=1 turn=1 open=2 share=0 took=tidy why=no_order:no_site placed=0 cleared=0 empty=1 out=deadline'])
    assert.deepStrictEqual(b.g3Hold, hold0, 'a visit ordered for the grounds leaves the remembered stop alone')
    // (b) the order now holds `grounds_turn` as its last stop -- and the paths' site retry still holds, from the paths' own stop
    const t2 = Date.now(), st2 = { lastAt: t2, lastStop: r2.stop }
    S.setGroundsFall({ ask: () => null, hold: M._grounds2.groundsHeld })
    for (const dt of [20 * MIN, 12 * 3600_000]) assert.deepStrictEqual(ordOf(S, t2 + dt, st2), { order: null, skip: 'no_site' }, `+${dt / MIN} min`)
    assert.deepStrictEqual(ordOf(S, hold0.at + S.SHOP_SITE_RETRY_MS - 1, st2), { order: null, skip: 'no_site' })
    assert.deepStrictEqual(ordOf(S, hold0.at + S.SHOP_SITE_RETRY_MS, st2), OWN_ORDER, 'a day after the PATHS\' stop the siting is tried again -- not a day after the last grounds visit')
    // positive control: without the hold, the grounds visit's stop has erased the back-off -- the bot is sent to site the paths again
    S.setGroundsFall({ ask: () => null, hold: st => st })
    assert.deepStrictEqual(ordOf(S, t2 + 20 * MIN, st2), OWN_ORDER)
  }
  try {
    await withSkills([GATE_OPEN], scenario)
    let why = null
    await withSkills([GATE_OPEN, ['      ctx.bot.g3Hold = groundsHoldOf(r?.stop)\n', '']], async M => { try { await scenario(M) } catch (err) { why = err } })
    assert.ok(why instanceof assert.AssertionError, `the mutant survived or died for another reason: ${why?.stack?.split('\n')[0] ?? 'survived'}`)
  } finally { S.setGroundsFall({ ask: X.groundsAsk, hold: X.groundsHeld }) }
})
await t('an INTERRUPTED grounds leg: the visit throws, the row says out=aborted and nothing is spent -- and the paths\' back-off survives the `aborted` the order then sees', async () => {
  try {
    await withSkills([GATE_OPEN], async M => {
      blockedTown(M)
      const b = liveBot(), ac = new AbortController()
      TAP.onRow = rec => { if (kindOf(rec) === 'grounds_lane') ac.abort() }   // interrupted inside the grounds leg (its lane row is written, no step walked yet)
      RECS.length = 0
      let threw = null
      try { await M.SKILLS.build_shop.run({ bot: b }, {}, ac.signal) } catch (e) { threw = e } finally { TAP.onRow = null }
      assert.ok(threw, 'the interruption is the runner\'s to see')
      assert.strictEqual(rowsOf('build_visit').filter(v => v.startsWith('project=paths outcome=no_site ')).length, 1, 'positive control: the paths\' visit had ended')
      assert.deepStrictEqual(quotaRows(), ['on=1 turn=1 open=2927 share=2 took=tidy why=fallback:no_site placed=- cleared=- empty=0 out=aborted'])
      assert.strictEqual(b.g2EmptyUntil ?? 0, 0, 'an interrupted visit is no evidence of an empty grounds')
      assert.deepStrictEqual([b.groundsPick, b.shopVisitBusy], [null, false])
      assert.strictEqual(b.g3Hold?.stop, 'no_site')
      const t1 = Date.now(), st = { lastAt: t1, lastStop: 'aborted' }
      S.setGroundsFall({ ask: () => null, hold: M._grounds2.groundsHeld })
      assert.deepStrictEqual(ordOf(S, t1 + 20 * MIN, st), { order: null, skip: 'no_site' })
      S.setGroundsFall({ ask: () => null, hold: s0 => s0 })
      assert.deepStrictEqual(ordOf(S, t1 + 20 * MIN, st), OWN_ORDER, 'positive control: the raw state has lost the stop')
      // interrupted BEFORE the grounds leg (as the paths' visit ends): nothing new is begun, the first project's result stands
      blockedTown(M)
      const b2 = liveBot(), ac2 = new AbortController()
      TAP.onRow = rec => { if (kindOf(rec) === 'build_visit' && detailOf(rec).startsWith('project=paths ')) ac2.abort() }
      RECS.length = 0
      let r2 = null
      try { r2 = await M.SKILLS.build_shop.run({ bot: b2 }, {}, ac2.signal) } finally { TAP.onRow = null }
      assert.strictEqual(r2?.stop, 'no_site')
      assert.strictEqual(rowsOf('build_visit').length, 1, rowsOf('build_visit').join(' | '))
      assert.deepStrictEqual(quotaRows(), ['on=1 turn=1 open=2927 share=2 took=other why=off_turn placed=- cleared=- empty=0 out=no_site'])
    })
  } finally { TAP.onRow = null; S.setGroundsFall({ ask: X.groundsAsk, hold: X.groundsHeld }) }
})
await t('a visit ORDERED for the grounds never goes on to the project its back-off holds: turned away (nothing ready) it ends empty and spends the turns; its links broken at the visit (the worker slots full) it ends at once; MUTANTS (each guard cut): killed', async () => {
  const ARGS = { grounds: true, why: 'no_order:no_site' }
  const turnedAway = async M => {
    const dir = blockedTown(M)
    PJ.takeLease(dir, TKEY, 'seg-T-00-0', 'X', { now: Date.now() })       // the one open segment is another bot's, and there is no cut
    const b = liveBot()
    b.g3Hold = { stop: 'no_site', at: 123 }
    const r = await runBuild(M, b, ARGS)
    assert.deepStrictEqual([r.status, r.stop], ['no_effect', G2.GROUNDS_STOP], JSON.stringify(r))
    assert.deepStrictEqual(rowsOf('build_visit'), [], 'no visit to the paths (their back-off holds), none to the grounds (nothing ready)')
    assert.deepStrictEqual(quotaRows(), ['on=1 turn=0 open=2927 share=0 took=tidy why=no_order:no_site placed=0 cleared=0 empty=1 out=grounds_none'])
    assert.ok(Math.abs((b.g2EmptyUntil ?? 0) - (Date.now() + 10 * MIN)) < 5000, 'spent: the order is not asked for the grounds again for 10 minutes')
    assert.deepStrictEqual(b.g3Hold, { stop: 'no_site', at: 123 })
  }
  const linksBroken = async M => {
    const dir = blockedTown(M)
    for (let n = 1; n <= 3; n++) PJ.takeLease(dir, TKEY, `slot${n}`, `B${n}`, { now: Date.now() })   // taken between the ask and the visit
    const b = liveBot()
    const r = await runBuild(M, b, ARGS)
    assert.deepStrictEqual([r.status, r.stop], ['no_effect', G2.GROUNDS_STOP], JSON.stringify(r))
    assert.deepStrictEqual(rowsOf('build_visit'), [], 'no visit at all: the order had nothing else for this bot')
    assert.deepStrictEqual(quotaRows(), ['on=1 turn=0 open=2927 share=0 took=other why=no_order:no_site placed=- cleared=- empty=0 out=grounds_turn fall=full'])
  }
  await turnedAway(SK); await linksBroken(SK)
  // positive control: the same order with the segment free IS a grounds visit
  blockedTown(SK)
  await runBuild(SK, liveBot(), ARGS)
  assert.ok(/^project=tidy .* crew=worker /.test(rowsOf('build_visit')[0] ?? ''), rowsOf('build_visit').join(' | '))
  for (const [old, scenario] of [
    ['    if (g3Only(args)) { bot.tidyLast = { placed: 0, cleared: 0, outcome: String(gr.stop) }; return groundsResult(gr) }\n', turnedAway],
    ["  if (g3Only(args)) { bot.shopVisitPlot = null; return groundsResult({ status: 'no_effect', detail: 'the grounds have no work for this bot now, and its order has nothing else', stop: 'grounds_none' }) }\n", linksBroken],
  ]) {
    let why = null
    await withSkills([[old, '']], async M => { try { await scenario(M) } catch (err) { why = err } })
    assert.ok(why instanceof assert.AssertionError, `the mutant survived or died for another reason (${old.slice(2, 40)}): ${why?.stack?.split('\n')[0] ?? 'survived'}`)
  }
  S.setGroundsFall({ ask: X.groundsAsk, hold: X.groundsHeld })
})
await t('GROUNDSFALL=off POSITIVE CONTROL (a copy of skills.mjs under the switch, the time gate opened too): the visit just ENDS as today -- one visit, grounds-01\'s row, nothing remembered, no hook installed, the order\'s skip', async () => {
  S.setGroundsFall(null)                                     // a process started under the switch never had the hooks
  process.env.GROUNDSFALL = 'off'
  try {
    await withSkills([GATE_OPEN], async M => {
      assert.deepStrictEqual([M._grounds2.G2.on, M._grounds2.G3.on], [true, false])
      blockedTown(M)
      const b = liveBot()
      const r = await runBuild(M, b)
      assert.deepStrictEqual([r.status, r.stop], ['no_effect', 'no_site'])
      const vis = rowsOf('build_visit')
      assert.strictEqual(vis.length, 1, vis.join(' | ')); assert.ok(vis[0].startsWith('project=paths '), vis[0])
      assert.deepStrictEqual(quotaRows(), ['on=1 turn=1 open=2927 share=2 took=other why=off_turn placed=- cleared=- empty=0 out=no_site'], 'grounds-01\'s row exactly: no `fall=`')
      assert.strictEqual(b.g3Hold ?? null, null); assert.strictEqual(b.g2EmptyUntil ?? 0, 0)
      const t1 = Date.now(), st = { lastAt: t1, lastStop: r.stop }
      assert.deepStrictEqual(ordOf(S, t1 + 20 * MIN, st), { order: null, skip: 'no_site' }, 'the copy installed no hook: the order as before')
      assert.strictEqual(M._grounds2.groundsAsk({ skip: 'no_site', now: t1 + 20 * MIN, state: st }), null)
      // and an order for the grounds means nothing under the switch: an ordinary build visit (a fresh bot's first: the order's own pick)
      await runBuild(M, liveBot(), { grounds: true, why: 'no_order:no_site' })
      assert.ok(rowsOf('build_visit')[0]?.startsWith('project=paths '), rowsOf('build_visit').join(' | '))
      assert.deepStrictEqual(quotaRows(), ['on=1 turn=1 open=2927 share=2 took=other why=off_turn placed=- cleared=- empty=0 out=no_site'])
    })
  } finally { delete process.env.GROUNDSFALL; S.setGroundsFall({ ask: X.groundsAsk, hold: X.groundsHeld }) }
})

console.log('GROUNDS-03 ITEM 4: the inside complete, a country band open -- the ORDER\'s own visit works the band as a worker; the quota, the fall-through and the ask do not (they read the inside\'s record alone)')
await t('inside complete + country open: shopActive offers the tidy and the visit borrows the country lane (crew=worker lane=country); groundsBegin / groundsAsk answer record_complete', async () => {
  const C = await import('../src/country.mjs')
  const dir = town({ tidy: tidyRec({ home: H70, r: 32, sitedAt: Date.now(), refreshAt: Date.now(), inwallAt: Date.now(), structure_complete: true, completeAt: Date.now() }) })
  for (const p of ['shaft', 'house1', 'monument', 'paths', 'wall']) DONE(dir, p)
  PJ.publishRecord(dir, PJ.projKey(H70, C.COUNTRY_PLOT), () => ({ v: 1, blueprint: 'country@1', plot: C.COUNTRY_PLOT, stageId: C.countryStages()[0].id, sitedAt: Date.now(), home: H70,
    cells: [10, 11].map(x => ({ at: [x, G + 1, 40], role: 'earth', seg: 'C-00-0' })), cut: [], clear: [], replant: [], segments: [{ seg: 'C-00-0', deps: [] }], structure_complete: false }))
  SK.shopActiveForget()
  const b = liveBot()
  assert.strictEqual(SK.shopActive(b, Date.now()).plot, 'tidy', 'the order: the grounds, for the band (country.mjs groundsState)')
  assert.strictEqual(SK.shopActiveStates().find(x => x.plot === 'tidy').country, 'open')
  // the pure lane rule for a worker (a helper with no lease name)
  assert.deepStrictEqual(C.groundsLane({ role: 'helper', helper: null, cap: 0, inside: { open: false, due: false }, country: { demand: 'open' } }), { lane: 'country', why: 'borrow:country' })
  assert.strictEqual(C.groundsLane({ role: 'helper', helper: null, cap: 0, inside: { open: false, due: false }, country: { demand: 'site' } }).lane, 'inside', 'a band to SITE is the keeper\'s')
  // what stops the quota, the fall-through and the ask: skills.mjs g2Record reads the INSIDE's head alone -> groundsRecord `complete`
  b.g2Turn = 1
  const g = X.groundsBegin(b, Date.now())
  assert.deepStrictEqual([g.turn, g.took, g.why], [2, 'other', 'record_complete'])
  X.groundsEnd(b, g, { status: 'no_effect', stop: 'deadline' })
  assert.strictEqual(X.groundsAsk({ skip: 'stuck_on_cell', now: Date.now(), state: { lastAt: 0 } }), null)
  assert.deepStrictEqual(G2.groundsFall({ ...F0, record: 'complete' }), { fall: false, why: 'record_complete', asked: true })
  // the order's own visit, end to end
  const r = await runBuild(SK, b)
  assert.strictEqual(r.stop, 'deadline', JSON.stringify(r))
  assert.deepStrictEqual(rowsOf('grounds_lane'), ['lane=country why=borrow:country role=helper country=open'])
  assert.ok(/^project=country outcome=deadline .* crew=worker lane=country /.test(rowsOf('build_visit')[0] ?? ''), rowsOf('build_visit').join(' | '))
  assert.ok(rowsOf('build_seg')[0]?.startsWith('project=country seg=C-00-0 '), 'the band\'s open segment is the visit\'s')
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
