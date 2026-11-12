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
for (const k of ['GROUNDS2', 'GROUNDSKEEPER', 'TIDY', 'GKLEASE', 'GKCREW4', 'GKCREWCUT', 'GKFILLSHARE', 'COUNTRY', 'LANDPLAN']) delete process.env[k]
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
  assert.strictEqual(G2.groundsModeDetail(true), 'on=1 v=1 big=500:2 small=100:4 empty_ms=600000 max_bots=4')
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
  await withMutant(G2_PATH, '  return worker ? Math.max(1, all - 1) : all\n', '  return all\n', async M => {
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
  assert.deepStrictEqual(Object.keys(G2.GROUNDS2).sort(), ['big', 'emptyMs', 'maxBots', 'shareBig', 'shareSmall', 'small', 'workerLiveMs'])
})

console.log('THE WIRING (skills.mjs; structural: what the fakes cannot reach -- comments stripped, each line once, a cut line fails)')
const WIRES = [
  // the visit: decided before the pick, framed by the row; the quota visit first, passed turns go on to the order
  'const g2 = groundsBegin(ctx.bot)',
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
  assert.deepStrictEqual(rowsOf('grounds_mode'), ['on=1 v=1 big=500:2 small=100:4 empty_ms=600000 max_bots=4'])
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
