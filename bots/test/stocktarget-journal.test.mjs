// STOCK TARGETS: the table and the generalised journal (stocktarget.mjs, cobblecap.mjs; design
// docs/reports/stocktargets-design-2026-10-08.md r3). Behaviour only: the fold's decisions per group, the floor, the
// operator's fence, and ROTATION -- in one process and under many processes that are killed mid-append.
import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const ST = await import('../src/stocktarget.mjs')
const CC = await import('../src/cobblecap.mjs')
const { COMPOST_CHANCE } = await import('../src/composter.mjs')

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 4).join('\n        ')}`) }
}
const tmp = tag => fs.mkdtempSync(path.join(os.tmpdir(), `mcbot-stock-${tag}-`))
const NOW = Date.now()

// ------------------------------------------------------------------------------------------------------- the table
await t('TABLE: every targeted name is in exactly one group; no group names a protected kind, a tool outside class C, or anything the composter takes', () => {
  const seen = new Map()
  for (const g of ST.STOCK_GROUP_NAMES) {
    for (const n of ST.namesOf(g)) {
      assert.ok(!seen.has(n), `${n} is in ${seen.get(n)} and ${g}`); seen.set(n, g)
      assert.ok(!Object.hasOwn(COMPOST_CHANCE, n), `${n} is a composter input`)
      if (ST.kindOf(g) === 'bulk') assert.ok(!ST.isProtected(n), `${n} (bulk) is protected`)
      else assert.ok(/_(pickaxe|axe|shovel|hoe)$/.test(n), `${n} is a tool group but not a tool`)
    }
  }
  for (const n of ['iron_ingot', 'raw_copper', 'coal', 'oak_sapling', 'torch', 'crafting_table', 'chest', 'bucket', 'bamboo', 'iron_pickaxe', 'diamond'])
    assert.ok(!ST.isTargeted(n) || ST.isToolGroup(ST.groupOf(n)), `${n} must never be a bulk target`)
  assert.equal(ST.targetOf('cobble'), CC.TOWN_COBBLE_CAP, 'cobble is the owner\'s 256')
  assert.deepEqual(['oak_log', 'stick', 'stone', 'dirt', 'gravel', 'stone_pickaxe'].map(ST.targetOf), [64, 64, 64, 0, 0, 16])
  assert.equal(ST.targetOf('no_such_group'), 0, 'an unknown group is never admitted')
})
await t('TABLE: a tool counts toward its group only while usable (> FLOOR uses)', () => {
  const sp = used => ({ name: 'stone_pickaxe', count: 1, durabilityUsed: used, maxDurability: 131 })
  assert.deepEqual(ST.stockCounts([sp(0), sp(125), { name: 'oak_log', count: 30 }, { name: 'sand', count: 5 }, { name: 'red_sand', count: 2 }]),
    { stone_pickaxe: 1, oak_log: 30, sand: 7 })
})

// ------------------------------------------------------------------------------------------------- the fold, per group
const cnt = (k, cap, m, extra = {}) => ({ t: 'cnt', k, cap, n: m.cobble ?? 0, v: 2, m, ids: [], ...extra })
const claim = (id, k, n, g, extra = {}) => ({ t: 'claim', id, k, n, g, at: NOW, keys: ['a', 'b'], coverage: true, bot: 'x', ...extra })
await t('FOLD: a v2 count names every group (absent = a known 0); a legacy count is cobble only -- other groups unknown', () => {
  const st = CC.foldJournal([cnt('a', NOW - 10, { oak_log: 40, cobble: 10 }), { t: 'obs', k: 'b', n: 30, cap: NOW - 5 }]).state
  const oak = CC.townStock(st, ['a', 'b'], NOW, { group: 'oak_log' })
  assert.equal(oak.lb, 40); assert.deepEqual(oak.unknown, ['b'], 'the legacy count does not count oak'); assert.equal(oak.complete, false)
  const cob = CC.townStock(st, ['a', 'b'], NOW, { group: 'cobble' })
  assert.equal(cob.lb, 40, '10 + 30'); assert.equal(cob.complete, true)
  const st2 = CC.foldJournal([cnt('a', NOW - 10, { oak_log: 40 }), cnt('b', NOW - 5, { cobble: 30 })]).state
  assert.equal(CC.townStock(st2, ['a', 'b'], NOW, { group: 'stick' }).complete, true, 'no sticks anywhere is a complete count of 0')
})
await t('FOLD: bank claims are judged per group against that group\'s target; target 0 is never admitted; another group\'s claims do not reserve', () => {
  const base = [cnt('a', NOW - 10, { oak_log: 30, cobble: 200 }), cnt('b', NOW - 5, {})]
  const f = recs => CC.foldJournal([...base, ...recs], { upto: 'z' }).decision
  assert.equal(f([claim('z', 'a', 34, 'oak_log')]), 'bank', '30 + 34 = 64')
  assert.equal(f([claim('z', 'a', 35, 'oak_log')]), 'at_cap', 'one past 64')
  assert.equal(f([claim('y', 'a', 20, 'oak_log'), claim('z', 'a', 20, 'oak_log')]), 'at_cap', '30 + 20 reserved + 20 > 64')
  assert.equal(f([claim('y', 'a', 56, 'cobble'), claim('z', 'a', 34, 'oak_log')]), 'bank', 'a cobble claim reserves cobble only')
  assert.equal(f([claim('z', 'a', 1, 'dirt')]), 'at_cap', 'target 0')
  assert.equal(f([claim('z', 'a', 1, 'no_such')]), 'at_cap', 'unknown group: target 0')
})
await t('FLOOR: only counts younger than an hour; the smaller of two equal captures; takes and draws come off once; reset fences', () => {
  const H = CC.FLOOR_TTL_MS
  const st = CC.foldJournal([cnt('a', NOW - H - 1, { oak_log: 500 }), cnt('b', NOW - 10, { oak_log: 200 })]).state
  const v = CC.townStock(st, ['a', 'b'], NOW, { group: 'oak_log' })
  assert.equal(v.lb, 700, 'the ceiling still counts a 1 h+ count'); assert.equal(v.floor, 200, 'the floor does not')
  const tie = CC.foldJournal([cnt('a', NOW - 10, { oak_log: 300 }), cnt('a', NOW - 10, { oak_log: 100 })]).state
  const tv = CC.townStock(tie, ['a'], NOW, { group: 'oak_log' })
  assert.equal(tv.lb, 300, 'equal captures: the larger for the ceiling'); assert.equal(tv.floor, 100, 'and the smaller for the floor')
  const tie2 = CC.foldJournal([cnt('a', NOW - 10, { oak_log: 100 }), cnt('a', NOW - 10, { oak_log: 300 })]).state
  assert.equal(CC.townStock(tie2, ['a'], NOW, { group: 'oak_log' }).floor, 100, 'in either order')
  const take = (id, n, extra = {}) => claim(id, 'b', n, 'oak_log', { kind: 'take', ...extra })
  const base = [cnt('b', NOW - 10, { oak_log: 192 })]
  const d = recs => CC.foldJournal([...base, ...recs], { upto: 'z' }).decision
  assert.equal(d([take('z', 64)]), 'take', '192 - 64 = 128 >= 64')
  assert.equal(d([take('p', 64), take('z', 64)]), 'take', '192 - 64 - 64 = 64: exactly the target')
  assert.equal(d([take('p', 64), take('q', 64), take('z', 1)]), 'at_floor', 'never below the target')
  assert.equal(d([claim('w', 'b', 100, 'oak_log', { kind: 'draw' }), take('z', 64)]), 'at_floor', 'a withdraw\'s draw comes off the floor first')
  assert.equal(CC.foldJournal([claim('w', 'b', 100, 'oak_log', { kind: 'draw' })], { upto: 'w' }).decision, 'draw', 'a draw is always admitted')
  assert.equal(d([{ t: 'cnt', k: 'b', n: 0, cap: NOW - 5, v: 2, m: { oak_log: 128 }, ids: [] }, take('z', 64)]), 'take', 'a later count replaces')
  assert.equal(d([{ t: 'reset', at: NOW - 5, hold: 1 }, take('z', 64)]), 'held', 'the operator\'s fence holds every prune')
  const r = CC.foldJournal([...base, { t: 'reset', at: NOW - 5 }]).state
  assert.deepEqual(CC.townStock(r, ['b'], NOW, { group: 'oak_log' }).unknown, ['b'], 'a count captured before the reset is gone')
  // LATE-APPENDED (Claude/Codex code r2): a count captured BEFORE the reset but written AFTER it (a bot that read the chest,
  // then the clear, then its append) is fenced too; one captured after the reset (positive control) counts
  const late = CC.foldJournal([{ t: 'reset', at: NOW - 5 }, cnt('b', NOW - 10, { oak_log: 192 })]).state
  assert.deepEqual(CC.townStock(late, ['b'], NOW, { group: 'oak_log' }).unknown, ['b'], 'a pre-reset capture appended after the reset is ignored')
  const after = CC.foldJournal([{ t: 'reset', at: NOW - 5 }, cnt('b', NOW - 2, { oak_log: 192 })]).state
  assert.equal(CC.townStock(after, ['b'], NOW, { group: 'oak_log' }).floor, 192, 'positive control: a count captured after the reset counts')
})

await t('FOLD (Codex r4 1): a delayed releasing count older than a later draw\'s count cannot restore the stock -- the container goes unknown', () => {
  const T = NOW - 1000
  const recs = [cnt('a', T, { stick: 0 }),
    claim('A', 'a', 64, 'stick', { at: T + 1, keys: ['a'] }),                                    // A banks 64 under a claim
    claim('B', 'a', 64, 'stick', { at: T + 3, kind: 'draw', keys: ['a'] }),                     // B draws them
    { t: 'cnt', k: 'a', n: 0, cap: T + 4, v: 2, m: {}, ids: ['B'] },                              // B's count: 0, releasing its draw
    { t: 'cnt', k: 'a', n: 0, cap: T + 2, v: 2, m: { stick: 64 }, ids: ['A'] }]                   // A's DELAYED count: 64, captured earlier
  const st = CC.foldJournal(recs).state
  const v = CC.townStock(st, ['a'], NOW, { group: 'stick' })
  assert.equal(v.avail, 0, `the floor must not see the 64 again: ${JSON.stringify(v)}`); assert.deepEqual(v.unknown, ['a'])
  assert.equal(st.claims.A, undefined, 'A is released'); assert.equal(st.claims.B, undefined, 'B is released')
  // the EQUAL-capture schedule (Codex r5 1): A's delayed count captured in the same millisecond as B's
  const eq = recs.slice(0, 4).concat([{ t: 'cnt', k: 'a', n: 0, cap: T + 4, v: 2, m: { stick: 64 }, ids: ['A'] }])
  const ve = CC.townStock(CC.foldJournal(eq).state, ['a'], NOW, { group: 'stick' })
  assert.equal(ve.avail, 0, `equal captures: ${JSON.stringify(ve)}`); assert.deepEqual(ve.unknown, ['a'])
  // two pruners, the later release delayed: P1 takes 64 (count 128 -> 64 at +3), P2's count 64 -> 0 at +5, P1's late count 128-64 at +3
  const pr = [cnt('b', T, { stick: 192 }), claim('P1', 'b', 64, 'stick', { at: T + 1, kind: 'take', keys: ['b'] }), claim('P2', 'b', 64, 'stick', { at: T + 2, kind: 'take', keys: ['b'] }),
    { t: 'cnt', k: 'b', n: 0, cap: T + 5, v: 2, m: { stick: 64 }, ids: ['P2'] }, { t: 'cnt', k: 'b', n: 0, cap: T + 3, v: 2, m: { stick: 128 }, ids: ['P1'] }]
  const vp = CC.townStock(CC.foldJournal(pr).state, ['b'], NOW, { group: 'stick' })
  assert.ok(vp.avail <= 64, `the late count never raises the floor past the chest: ${JSON.stringify(vp)}`)
  // ...and the two pruners with EQUAL captures (Codex r6 P2): both released, the container unknown, floor 0; a recount restores 64
  const pe = pr.slice(0, 4).concat([{ t: 'cnt', k: 'b', n: 0, cap: T + 5, v: 2, m: { stick: 128 }, ids: ['P1'] }])
  const se = CC.foldJournal(pe).state
  const ve2 = CC.townStock(se, ['b'], NOW, { group: 'stick' })
  assert.equal(ve2.avail, 0); assert.deepEqual(ve2.unknown, ['b']); assert.equal(se.claims.P1, undefined); assert.equal(se.claims.P2, undefined)
  const rc = CC.foldJournal([...pe, cnt('b', T + 9, { stick: 64 })]).state
  assert.equal(CC.townStock(rc, ['b'], NOW, { group: 'stick' }).avail, 64, 'a recount after the dirty mark is the count')
  // positive control: a releasing count captured AFTER the standing one replaces it
  const ok = [cnt('a', T, { stick: 0 }), claim('A', 'a', 64, 'stick', { at: T + 1, keys: ['a'] }), { t: 'cnt', k: 'a', n: 0, cap: T + 2, v: 2, m: { stick: 64 }, ids: ['A'] }]
  assert.equal(CC.townStock(CC.foldJournal(ok).state, ['a'], NOW, { group: 'stick' }).avail, 64)
})

await t('CLAIMS THROUGH claimStack (Codex code r1 P1): a draw and a valve are written with their kind -- a draw is admitted and lowers the floor, a valve is admitted at target; a nowell is admitted at target', () => {
  const dir = tmp('kinds')
  CC.appendJournal(dir, 'k', null, cnt('a', Date.now() - 5, { oak_log: 64, stone_pickaxe: 16 }))
  const c = (id, extra) => CC.claimStack(dir, 'k', null, { id, n: 16, k: 'a', keys: ['a'], coverage: true, bot: 'x', ...extra }).decision
  assert.equal(c('d1', { g: 'oak_log', kind: 'draw' }), 'draw')
  assert.equal(c('v1', { n: 1, g: 'stone_pickaxe', kind: 'valve', proof: 'nothing_else' }), 'valve')
  assert.equal(c('w1', { g: 'oak_log', kind: 'nowell' }), 'nowell')
  assert.equal(c('b1', { g: 'oak_log' }), 'at_cap', 'positive control: a plain bank claim at target is refused')
  const v = CC.townStock(CC.readTown(dir, 'k'), ['a'], Date.now(), { group: 'oak_log' })
  assert.equal(v.taking, 16, 'the draw comes off the floor'); assert.equal(v.reserved, 16, 'the nowell reserves')
  assert.ok(CC.readJournal(dir, 'k').some(r => r.kind === 'valve' && r.proof === 'nothing_else'), 'the valve carries its proof')
})
await t('TIES (Codex code r1 P1): two equal-time v2 counts merge COMPONENTWISE -- maxima for the ceiling, minima for the floor', () => {
  const T = NOW - 100
  for (const [x, y] of [[{ cobble: 0, oak_log: 0 }, { cobble: 0, oak_log: 64 }], [{ cobble: 0, oak_log: 64 }, { cobble: 0, oak_log: 0 }], [{ cobble: 9, oak_log: 0 }, { cobble: 0, oak_log: 64 }]]) {
    const st = CC.foldJournal([cnt('a', T, x), cnt('a', T, y)]).state
    const v = CC.townStock(st, ['a'], NOW, { group: 'oak_log' })
    assert.equal(v.lb, 64, `ceiling ${JSON.stringify([x, y])}`); assert.equal(v.floor, 0, `floor ${JSON.stringify([x, y])}`)
  }
  const mixed = CC.foldJournal([cnt('a', T, { oak_log: 64 }), { t: 'obs', k: 'a', n: 0, cap: T }]).state
  assert.deepEqual(CC.townStock(mixed, ['a'], NOW, { group: 'oak_log' }).unknown, ['a'], 'a legacy side makes the merged count cobble-only')
})
await t('A DIRTY MARK ALONE is written (Codex code r1 P1) and makes its container unknown', () => {
  const dir = tmp('dirty')
  CC.appendJournal(dir, 'k', null, cnt('a', Date.now() - 5, { oak_log: 100 }))
  assert.equal(CC.recordCount(dir, 'k', null, { dirty: 'a', bot: 'x' }), true)
  assert.ok(CC.readJournal(dir, 'k').some(r => r.t === 'cnt' && r.dirty === 'a'), 'appended')
  assert.deepEqual(CC.townStock(CC.readTown(dir, 'k'), ['a'], Date.now(), { group: 'oak_log' }).unknown, ['a'])
})

// ------------------------------------------------------------------------------------------------- rotation, one process
const refFold = recs => CC.foldJournal(recs).state
await t('ROTATION: past the threshold a reader seals the next generation and publishes its base; the folded state equals the single-file fold; old generations go', () => {
  const dir = tmp('rot'), all = []
  const add = rec => { CC.appendJournal(dir, 'k', null, rec); all.push({ inst: CC.INSTANCE, ...rec, w: null }) }
  const st = {}
  for (let i = 0; i < 300; i++) {
    add(cnt(`c${i % 7}`, NOW - 1000 + i, { oak_log: i % 50, cobble: i % 9 }))
    if (i % 25 === 0) { const s = {}; CC.readTown(dir, 'k', null, { rotateBytes: 4096, ckptEvery: 1024, stats: s }); if (s.rotated) st[s.rotated] = true }
  }
  assert.ok(Object.keys(st).length >= 2, `rotated ${JSON.stringify(st)}`)
  const g = CC.currentGen(dir, 'k')
  assert.deepEqual(CC.readTown(dir, 'k', null, { rotateBytes: Infinity }).obs, refFold(all).obs, 'the same counts as one file folded whole')
  const files = fs.readdirSync(dir)
  assert.ok(files.every(f => { const m = /\.g(\d+)\./.exec(f); return m ? Number(m[1]) >= g - 1 : !/cobble\.jsonl$/.test(f) || g <= 1 }), files.join(' '))
  assert.equal(CC.loadJournal(dir, 'k', null, { gen: g - 2 }), null, 'a deleted generation is unknown, never empty')
})
await t('ROTATION: a seal without a base -> the next reader publishes it; a claim whose generation moves between its append and its re-read is UNKNOWN and released', () => {
  const dir = tmp('seal')
  CC.appendJournal(dir, 'k', null, cnt('a', Date.now(), { oak_log: 0 }))
  fs.writeFileSync(path.join(dir, 'k.cobble.g1.seal'), '')                      // a rotator that died before its base
  const st = CC.readTown(dir, 'k')
  assert.equal(st.obs.a.m.oak_log ?? 0, 0); assert.ok(fs.existsSync(path.join(dir, 'k.cobble.g1.base.json')), 'published by a reader')
  // the move: a claim appended to g1, then g2 sealed before the claimant re-reads -> the claimant must see 'unknown'
  const realExists = fs.existsSync
  let armed = true
  fs.existsSync = p => { if (armed && String(p).endsWith('k.cobble.g2.seal') && fs.statSync(path.join(dir, 'k.cobble.g1.jsonl'), { throwIfNoEntry: false })?.size > 0) { armed = false; fs.writeFileSync(path.join(dir, 'k.cobble.g2.seal'), '') } return realExists(p) }
  let r
  try { r = CC.claimStack(dir, 'k', null, { id: 'm1', n: 10, k: 'a', g: 'oak_log', keys: ['a'], coverage: true }) } finally { fs.existsSync = realExists }
  assert.equal(r.decision, 'unknown', JSON.stringify(r)); assert.equal(r.moved, true)
  const rels = fs.readFileSync(path.join(dir, 'k.cobble.g2.jsonl'), 'utf8').split('\n').filter(Boolean).map(JSON.parse)
  assert.ok(rels.some(x => x.t === 'rel' && x.ids.includes('m1')), 'released in the new generation')
})

// ------------------------------------------------------------------------------------------------- rotation, many processes
// Claude r2's schedule, generalised: writers keep appending claims (never released) and filler counts while the journal
// rotates every few KB and some writers are SIGKILLed mid-run. Every claimant reports its decision AFTER it is taken. The
// invariants are the safety ones: never more admitted bank stock than the target, never more taken than floor - target.
const { spawn } = await import('node:child_process')
const url = new URL('../src/cobblecap.mjs', import.meta.url).href
async function storm ({ dir, kind, n, k = 'a', target, procs = 8, perProc = 12, killEvery = 3 }) {
  const out = path.join(dir, 'decisions.txt')
  const child = i => new Promise(res => {
    const code = `const C = await import(${JSON.stringify(url)}); const fs = await import('node:fs');
      for (let j = 0; j < ${perProc}; j++) {
        for (let f = 0; f < 6; f++) C.appendJournal(${JSON.stringify(dir)}, 'k', null, { t: 'cnt', k: 'filler${i}', n: f, cap: Date.now(), v: 2, m: {}, ids: [] })
        C.readTown(${JSON.stringify(dir)}, 'k', null, { rotateBytes: 3000, ckptEvery: 1500 })
        const r = C.claimStack(${JSON.stringify(dir)}, 'k', null, { id: 'p${i}-' + j, n: ${n}, k: ${JSON.stringify(k)}, g: 'oak_log', kind: ${JSON.stringify(kind)}, bot: 'b${i}', keys: [${JSON.stringify(k)}], coverage: true });
        fs.appendFileSync(${JSON.stringify(out)}, 'p${i}-' + j + ' ' + r.decision + '\\n')
      }`
    const p = spawn(process.execPath, ['--input-type=module', '-e', code], { stdio: ['ignore', 'ignore', 'inherit'] })
    if (killEvery && i % killEvery === 0) setTimeout(() => { try { p.kill('SIGKILL') } catch { /* gone */ } }, 40 + 15 * i)
    p.on('close', () => res())
  })
  await Promise.all(Array.from({ length: procs }, (_, i) => child(i)))
  return fs.readFileSync(out, 'utf8').split('\n').filter(Boolean).map(l => l.split(' '))
}
await t('ROTATION STORM (bank): 8 processes, rotation every ~3 KB, a third SIGKILLed -- reported admissions never exceed the target; every reader agrees', async () => {
  const dir = tmp('storm-bank')
  CC.appendJournal(dir, 'k', null, cnt('a', Date.now(), { oak_log: 0 }))
  const got = await storm({ dir, kind: 'bank', n: 8, target: 64 })
  const admitted = got.filter(([, d]) => d === 'bank').length
  assert.ok(admitted <= 8, `${admitted} x 8 admitted against 64`)
  assert.ok(admitted >= 1, 'positive control: something was admitted')
  assert.ok(CC.currentGen(dir, 'k') >= 2, `rotated: generation ${CC.currentGen(dir, 'k')}`)
  const v = CC.townStock(CC.readTown(dir, 'k', null, { rotateBytes: Infinity }), ['a'], Date.now(), { group: 'oak_log' })
  assert.ok(v.reserved <= 64, JSON.stringify(v))
  assert.ok(v.reserved >= admitted * 8, `every admitted claim is still reserved (${v.reserved} vs ${admitted * 8})`)
})
await t('ROTATION STORM (take): a floor of 192 against a target of 64 -- reported takes never exceed 128', async () => {
  const dir = tmp('storm-take')
  CC.appendJournal(dir, 'k', null, cnt('a', Date.now(), { oak_log: 192 }))
  const got = await storm({ dir, kind: 'take', n: 16, target: 64 })
  const taken = got.filter(([, d]) => d === 'take').length
  assert.ok(taken <= 8, `${taken} x 16 taken from 192 against 64`); assert.ok(taken >= 1, 'positive control')
  assert.ok(CC.currentGen(dir, 'k') >= 2)
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
