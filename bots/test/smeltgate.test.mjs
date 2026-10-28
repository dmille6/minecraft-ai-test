// SMELTGATE-01: the smelt order is not issued when the town index shows no raw ore anywhere (smeltjob.mjs indexInputAbsent),
// counting the latest move INTO each container (townindex.mjs foldIndex `xin`), which the deposit verb's records are the only
// trace of. Behaviour: the predicate's truth table, the fold's xin (order-independent, idempotent, per world, the cached reader
// continuing a file), and the order's decision composed with the predicate.
import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const TI = await import('../src/townindex.mjs')
const SJ = await import('../src/smeltjob.mjs')
const { indexInputAbsent, smeltTownOrder, SMELT_GATE } = SJ

let n = 0
const test = (name, fn) => { fn(); n++; console.log(`ok - ${name}`) }

const NOW = 10_000_000
const obs = (k, at, names = {}, extra = {}) => ({ v: 1, t: 'obs', id: `o-${k}-${at}`, k, h: [k], at, bot: 'B', by: 'withdraw', names, used: 1, size: 27, w: null, ...extra })
const dirty = (k, at, phase, op) => ({ v: 1, t: 'dirty', id: `d-${k}-${at}-${phase}`, k, h: [k], at, bot: 'B', by: 'deposit', phase, op, w: null })
const xfer = (k, at, name, nn = 8, extra = {}) => ({ v: 1, t: 'xfer', id: `x-${k}-${at}-${name}`, op: 'op1', k, h: [k], at, name, n: nn, ok: 0, bot: 'B', by: 'deposit', w: null, ...extra })
const W = JSON.stringify(null)
const canon = v => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : 1))) : x))
const fold = recs => { const f = TI.foldIndex(recs); return { entries: f.worlds[W] ?? {}, xin: f.xin[W] ?? {} } }
const absent = (recs, need = 'raw_copper', keys = null) => { const f = fold(recs); return indexInputAbsent(f.entries, need, keys, NOW, f.xin) }

test('the gate is on by default', () => assert.equal(SMELT_GATE.on, true))

test('no raw ore in any latest observation, no move in since: absent', () => {
  const recs = [obs('a', NOW - 1000, { copper_ingot: [229, 4] }), obs('b', NOW - 9 * 3600e3, { coal: [3, 1] })]
  assert.equal(absent(recs), true)
  assert.equal(absent(recs, 'raw_iron'), true)
})

test('any container holding the input, in ANY state or age, is not absent', () => {
  assert.equal(absent([obs('a', NOW - 1000), obs('b', NOW - 20 * 3600e3, { raw_copper: [1, 1] })]), false)   // stale
  assert.equal(absent([obs('a', NOW - 1000), obs('b', NOW - 5000, { raw_iron: [3, 1] }), dirty('b', NOW - 4000, 'pre', 'p'), dirty('b', NOW - 3000, 'post', 'p')], 'raw_iron'), false)   // dirty since
  // ...but only the input asked about
  assert.equal(absent([obs('a', NOW - 1000, { raw_iron: [3, 1] })], 'raw_copper'), true)
})

test('an ore move INTO a container after its latest observation is not absent (the deposit verb never re-opens)', () => {
  const base = [obs('a', NOW - 5000), dirty('a', NOW - 4900, 'pre', 'op1')]
  assert.equal(absent([...base, xfer('a', NOW - 4800, 'raw_copper'), dirty('a', NOW - 4700, 'post', 'op1')]), false)
  // the move came BEFORE a later observation that showed none: that observation is the evidence (taken since)
  assert.equal(absent([...base, xfer('a', NOW - 4800, 'raw_copper'), dirty('a', NOW - 4700, 'post', 'op1'), obs('a', NOW - 100)]), true)
  // a move of something else, or of nothing, is no evidence
  const post = dirty('a', NOW - 4700, 'post', 'op1')
  assert.equal(absent([...base, xfer('a', NOW - 4800, 'cobblestone'), post]), true)
  assert.equal(absent([...base, xfer('a', NOW - 4800, 'raw_copper', 0), post]), true)
  // a move into a container the fold has no observation of
  assert.equal(absent([obs('a', NOW - 5000), xfer('z', NOW - 4800, 'raw_copper')]), false)
})

test('anything the index cannot vouch for is NOT absent: no entries, a scan key never opened, bad input', () => {
  assert.equal(indexInputAbsent({}, 'raw_copper', [], NOW, {}), false)
  assert.equal(indexInputAbsent(null, 'raw_copper', [], NOW, {}), false)
  assert.equal(indexInputAbsent(fold([obs('a', NOW)]).entries, null, [], NOW, {}), false)
  assert.equal(absent([obs('a', NOW - 1000)], 'raw_copper', ['a', 'q']), false)   // q: in the scan, never opened
  assert.equal(absent([obs('a', NOW - 1000)], 'raw_copper', ['a']), true)
})

test('an OPEN mutation (pre, no post, younger than OP_TTL_MS) is not absent; a closed one with no ore move is', () => {
  const base = [obs('a', NOW - 60_000)]
  assert.equal(absent([...base, dirty('a', NOW - 50_000, 'pre', 'p')]), false)
  assert.equal(absent([...base, dirty('a', NOW - 50_000, 'pre', 'p'), dirty('a', NOW - 49_000, 'post', 'p')]), true)
  assert.equal(absent([obs('a', NOW - 2 * TI.OP_TTL_MS), dirty('a', NOW - TI.OP_TTL_MS - 1000, 'pre', 'p')]), true)   // a crashed writer, past its protection
})

test('a mutation since the latest observation, unopened for SMELT_GATE_DIRTY_MS, is evidence (Codex code r1: unrecorded moves are bounded)', () => {
  const D = SJ.SMELT_GATE_DIRTY_MS
  const m = at => [obs('a', at - 2000), dirty('a', at - 1000, 'pre', 'p'), dirty('a', at, 'post', 'p')]
  assert.equal(absent(m(NOW - D + 60_000)), true, 'younger: trusted (the deposit verbs record their moves)')
  assert.equal(absent(m(NOW - D - 1)), false, 'older: whatever went in, the index may not have it')
  assert.equal(absent([...m(NOW - D - 1), obs('a', NOW - 1000)]), true, 'opened since: the observation decides again')
  // a move lost from xin (a rotation) cannot hide ore for longer than the bound: the entry is still dirty
  assert.equal(absent([obs('a', NOW - D - 5000), dirty('a', NOW - D - 4000, 'pre', 'p'), dirty('a', NOW - D - 3000, 'post', 'p')]), false)
})

test('a TOWN-MEMORY deposit mark after the latest observation is not absent (beyond the rule-out slack)', () => {
  const f = fold([obs('a', NOW - 60_000)])
  assert.equal(indexInputAbsent(f.entries, 'raw_copper', ['a'], NOW, f.xin, { tookAt: { a: NOW - 30_000 } }), false)
  assert.equal(indexInputAbsent(f.entries, 'raw_copper', ['a'], NOW, f.xin, { tookAt: { a: NOW - 60_000 + SJ.RULE_OUT_TOOK_SLACK_MS - 1 } }), true)
  assert.equal(indexInputAbsent(f.entries, 'raw_copper', ['a'], NOW, f.xin, { tookAt: { a: NOW - 90_000 } }), true)
})

test('the fold xin: latest per name, order-independent, idempotent, per world; entries unchanged', () => {
  const recs = [obs('a', 100), xfer('a', 200, 'raw_copper', 2), xfer('a', 300, 'raw_copper', 1), xfer('a', 250, 'raw_iron'), xfer('b', 150, 'raw_copper', 1, { w: 'w2' })]
  const want = canon(TI.foldIndex(recs).xin)
  for (const p of [recs.slice().reverse(), [recs[2], recs[0], recs[4], recs[1], recs[3]], [...recs, ...recs]]) assert.equal(canon(TI.foldIndex(p).xin), want)
  const f = TI.foldIndex(recs)
  assert.deepStrictEqual(f.xin[W], { a: { raw_copper: 300, raw_iron: 250 } })
  assert.deepStrictEqual(f.xin[JSON.stringify('w2')], { b: { raw_copper: 150 } })
  // the entries are exactly the base's (xfers never touched them)
  assert.equal(JSON.stringify(f.worlds), JSON.stringify(TI.foldIndex(recs.filter(r => r.t !== 'xfer')).worlds))
  // continued from an earlier fold
  const c = TI.foldIndex(recs.slice(3), { from: TI.foldIndex(recs.slice(0, 3)).worlds, fromXin: TI.foldIndex(recs.slice(0, 3)).xin })
  assert.equal(canon(c.xin), want)
})

test('readIndex returns xin, and a cached reader continuing the file sees a new move', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'smeltgate-'))
  TI.resetIndexCache()
  TI.appendIndex(dir, '0_64_0', null, obs('a', NOW - 5000))
  let r = TI.readIndex(dir, '0_64_0', null)
  assert.equal(r.ok, true)
  assert.equal(indexInputAbsent(r.entries, 'raw_copper', ['a'], NOW, r.xin), true)
  TI.appendIndex(dir, '0_64_0', null, xfer('a', NOW - 4000, 'raw_copper'))
  r = TI.readIndex(dir, '0_64_0', null)
  assert.deepStrictEqual(r.xin, { a: { raw_copper: NOW - 4000 } })
  assert.equal(indexInputAbsent(r.entries, 'raw_copper', ['a'], NOW, r.xin), false)
})

test('composed with the order: absent everywhere and nothing carried -> no order; carried copper or town iron -> an order', () => {
  const f = fold([obs('a', NOW - 1000, { copper_ingot: [64, 1] })])
  const none = need => () => indexInputAbsent(f.entries, need, ['a'], NOW, f.xin)
  const ask = held => smeltTownOrder({ now: NOW, on: true, atTown: true, held, freeSlots: 10, townMiss: none('raw_copper'), ironMiss: none('raw_iron'), iron: true, state: {} })
  assert.equal(ask({}).order, null)
  assert.equal(ask({}).skip, 'town_has_none')
  assert.equal(ask({ raw_copper: 3 }).order?.skill, 'smelt_town')
  const g = fold([obs('a', NOW - 1000, { raw_iron: [5, 1] })])
  const r = smeltTownOrder({ now: NOW, on: true, atTown: true, held: {}, freeSlots: 10, townMiss: () => indexInputAbsent(g.entries, 'raw_copper', ['a'], NOW, g.xin), ironMiss: () => indexInputAbsent(g.entries, 'raw_iron', ['a'], NOW, g.xin), iron: true, state: {} })
  assert.equal(r.order?.skill, 'smelt_town')
})

test('WIRED: both order gates ask the index first (a structural invariant: behaviour cannot reach the live bot here)', () => {
  const src = fs.readFileSync(new URL('../src/skills.mjs', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  for (const line of ['try { return townIndexNone(bot, SMELT_JOB_INPUT) || townSearchEmpty(bot, [SMELT_JOB_INPUT]',
                      'try { return townIndexNone(bot, SMELT_IRON_INPUT) || townSearchEmpty(bot, [SMELT_IRON_INPUT]',
                      'return indexInputAbsent(r.entries, need, townCobbleScan(bot).keys ?? [], Date.now(), r.xin ?? {}, { tookAt })']) {
    assert.equal(src.split(line).length - 1, 1, `ANCHOR MISSING OR NOT UNIQUE: ${line}`)
  }
})

console.log(`# smeltgate: ${n} passed`)
