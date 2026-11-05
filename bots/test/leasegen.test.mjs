// LEASEGEN-01 (LIVE showcase 11-04 22:06Z on: Paper "Timed out" 13-18/h -> 287-516/h): every lease, mutex, barrier and record
// lookup in buildproj.mjs listed the whole town directory -- 35,384 entries, 34,034 of them lease generations nobody pruned,
// 56-74 ms a listing -- several times a placement fence, so a groundskeeper visit held the event loop past the 30 s keepalive.
// This file measures the SYNCHRONOUS budget of the lookups in a 35k-file directory (and kills the no-memo mutant), proves a memo
// at most LIST_TTL_MS old never lets a stale view take a lease or the mutex (both reviewers' r1 repros: an out-of-order prune's
// holes, a paused taker's re-created island), and pins the sweep's keep rules.
import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'

const P = await import('../src/buildproj.mjs')
const PATH = new URL('../src/buildproj.mjs', import.meta.url)
let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 5).join('\n        ')}`) }
}
async function withMutant (old, neu, fn) {
  const src = readFileSync(PATH, 'utf8')
  assert.ok(src.split(old).length === 2, `ANCHOR MISSING OR NOT UNIQUE: ${JSON.stringify(old.slice(0, 70))}`)
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, src.replace(old, neu))
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}
const dirs = []
const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'leasegen-')); dirs.push(d); return d }
const KEY = 'project-0_70_0.tidy'
const lf = (dir, name, n) => path.join(dir, `${KEY}.${name}.lease.g${n}.json`)
const old = (f, ageMs) => { const s = (Date.now() - ageMs) / 1000; fs.utimesSync(f, s, s) }
const gensIn = (d, name) => fs.readdirSync(d).filter(x => x.startsWith(`${KEY}.${name}.lease.g`) && x.endsWith('.json')).map(x => Number(/\.g(\d+)\.json$/.exec(x)[1])).sort((a, b) => a - b)

// ---- the synchronous budget ---------------------------------------------------------------------------------------------------

// the showcase's shape: ~35k lease generations of other leases beside the ones a fence asks about
const BIG = tmp()
for (let i = 1; i <= 35_000; i++) fs.writeFileSync(path.join(BIG, `project-0_70_0.shop.slot${1 + (i % 4)}.lease.g${i}.json${i % 2 ? '' : '.released'}`), '')
const scenarioBudget = async M => {
  M._resetGenHints()
  const me = 'showcase-Delta'
  const a = M.takeLease(BIG, KEY, 'seg-a', me)
  const s = M.takeLease(BIG, KEY, 'slot1', me)
  assert.ok(a.ok && s.ok)
  const N = 200
  const t0 = process.hrtime.bigint()
  for (let i = 0; i < N; i++) {
    assert.ok(M.holdsLease(BIG, KEY, 'slot1', me, s.gen))
    assert.ok(M.holdsLease(BIG, KEY, 'seg-a', me, a.gen))
  }
  const per = Number(process.hrtime.bigint() - t0) / 1e6 / (2 * N)
  console.log(`        holdsLease in a ${fs.readdirSync(BIG).length}-entry directory: ${per.toFixed(3)} ms a call`)
  // a 35k listing costs ~20 ms here and 56-74 ms on the showcase VM; one listing serves LIST_TTL_MS of lookups
  assert.ok(per < 3, `holdsLease took ${per.toFixed(2)} ms a call -- the lookup is listing the directory every time again`)
}
await t('BUDGET: holdsLease in a 35k-file directory stays under 3 ms a call (one listing per LIST_TTL_MS, not one per lookup)', () => scenarioBudget(P))
await t('MUTANT KILLED: without the memo (a listing per lookup, the live 11-04 code) the budget is blown', async () => {
  let killed = false
  await withMutant('  if (c && t0 >= c.at && t0 - c.at < LIST_TTL_MS) return c.names',
    '  if (false) return c.names', async M => { try { await scenarioBudget(M) } catch { killed = true } })
  assert.ok(killed, 'the listing mutant stayed inside the budget: the test measures nothing')
})

// ---- exactness --------------------------------------------------------------------------------------------------------------

const sleep = ms => new Promise(r => setTimeout(r, ms))
const live = (holder, ms = 600_000) => JSON.stringify({ holder, at: Date.now(), until: Date.now() + ms })
await t('another process\'s newer generation: a take on the stale view fails at once; the view itself is fresh within LIST_TTL_MS', async () => {
  P._resetGenHints()
  const d = tmp()
  const r = P.takeLease(d, KEY, 'seg-b', 'A')
  assert.ok(P.holdsLease(d, KEY, 'seg-b', 'A', r.gen))
  // B takes it from another process (written directly: this process's memo does not know)
  fs.writeFileSync(lf(d, 'seg-b', r.gen + 1), live('B'))
  assert.equal(P.takeLease(d, KEY, 'seg-b', 'A').ok, false, 'the stale view writes an existing generation: EEXIST')
  await sleep(P.LIST_TTL_MS + 50)
  assert.equal(P.leaseState(d, KEY, 'seg-b').gen, r.gen + 1)
  assert.equal(P.holdsLease(d, KEY, 'seg-b', 'A', r.gen), false)
})
await t('REVIEW r1 REPRO (Codex + Claude): an out-of-order prune leaves holes above an old generation; no stale take succeeds', async () => {
  P._resetGenHints()
  const d = tmp()
  fs.writeFileSync(lf(d, 'seg-h', 1), JSON.stringify({ holder: 'A', at: 0, until: 0 }))
  fs.writeFileSync(lf(d, 'seg-h', 2), JSON.stringify({ holder: 'A', at: 0, until: 0 }))
  assert.equal(P.leaseState(d, KEY, 'seg-h').gen, 2)          // A has seen g2
  for (let g = 3; g <= 10; g++) fs.writeFileSync(lf(d, 'seg-h', g), live('Z'))   // Z holds g10
  for (const g of [5, 6, 1]) fs.unlinkSync(lf(d, 'seg-h', g))   // the cron, in its own order
  const tk = P.takeLease(d, KEY, 'seg-h', 'A')
  assert.equal(tk.ok, false, `a stale take succeeded: ${JSON.stringify(tk)}`)
  await sleep(P.LIST_TTL_MS + 50)
  assert.equal(P.leaseState(d, KEY, 'seg-h').gen, 10)
  const tk2 = P.takeLease(d, KEY, 'seg-h', 'A')
  assert.equal(tk2.ok, false, 'Z holds it'); assert.match(tk2.why, /held by Z/)
  for (const g of [3, 4, 5, 6]) assert.equal(P.holdsLease(d, KEY, 'seg-h', 'A', g), false)
})
await t('REVIEW r1 REPRO (Codex + Claude): a re-created old mutex generation (an island) never yields a second holder', async () => {
  P._resetGenHints()
  const d = tmp()
  const mf = g => path.join(d, `${KEY}.mutate.g${g}.json`)
  fs.writeFileSync(mf(1), JSON.stringify({ holder: 'X', pid: process.pid, at: 0 })); fs.writeFileSync(`${mf(1)}.released`, '1')
  fs.writeFileSync(mf(2), JSON.stringify({ holder: 'X', pid: process.pid, at: 0 })); fs.writeFileSync(`${mf(2)}.released`, '1')
  assert.equal(P.mutexState(d, KEY, { alive: () => true }).held, false)   // P has seen g2 released
  for (let g = 25; g <= 40; g++) fs.writeFileSync(mf(g), JSON.stringify({ holder: 'Q', pid: process.pid, at: Date.now() }))
  for (let g = 25; g < 40; g++) fs.writeFileSync(`${mf(g)}.released`, '1')   // Q holds g40; g3..g24 pruned
  const r = P.mutexTake(d, KEY, 'P', { alive: () => true })
  assert.equal(r.ok, false, `a second mutex holder: ${JSON.stringify(r)}`)
  await sleep(P.LIST_TTL_MS + 50)
  const st = P.mutexState(d, KEY, { alive: () => true })
  assert.equal(st.gen, 40); assert.equal(st.held, true)
})
await t('a newest generation gone with the directory reads as no lease once the memo has lapsed', async () => {
  P._resetGenHints()
  const d = tmp()
  for (let g = 1; g <= 6; g++) fs.writeFileSync(lf(d, 'seg-c', g), JSON.stringify({ holder: 'A', at: 0, until: 0 }))
  assert.equal(P.leaseState(d, KEY, 'seg-c').gen, 6)
  fs.rmSync(d, { recursive: true, force: true })
  await sleep(P.LIST_TTL_MS + 50)
  assert.equal(P.leaseState(d, KEY, 'seg-c'), null)
})
await t('the record chain still walks every generation, including ones another process published', () => {
  P._resetGenHints()
  const d = tmp()
  assert.equal(P.publishRecord(d, KEY, () => ({ cells: [1] })).result, 'accepted')
  assert.equal(P.recordHead(d, KEY).head.gen, 1)
  assert.equal(P.publishRecord(d, KEY, r => ({ ...r, cells: [1, 2] })).result, 'accepted')
  const h = P.recordHead(d, KEY)
  assert.equal(h.head.gen, 2); assert.deepEqual(h.gens, [1, 2]); assert.deepEqual(h.head.rec.cells, [1, 2])
  assert.equal(P.recordGenNow(d, KEY), 2)
})
await t('the mutex still keeps its MUTEX_KEEP newest generations', () => {
  P._resetGenHints()
  const d = tmp()
  for (let i = 0; i < P.MUTEX_KEEP + 8; i++) { const r = P.mutexTake(d, KEY, 'A', { alive: () => true }); assert.ok(r.ok, r.why); P.mutexRelease(d, KEY, 'A') }
  const gens = fs.readdirSync(d).filter(n => /\.mutate\.g\d+\.json$/.test(n)).map(n => Number(/g(\d+)\.json$/.exec(n)[1])).sort((a, b) => a - b)
  assert.equal(gens.length, P.MUTEX_KEEP); assert.equal(gens.at(-1), P.MUTEX_KEEP + 8)
})

// ---- the sweep --------------------------------------------------------------------------------------------------------------

const H = 3600_000
const sweepScene = M => {
  M._resetGenHints()
  const d = tmp()
  // seg-d: 1..5 five hours old (released), 6..10 young; slot2: 1..4 all old
  for (let g = 1; g <= 10; g++) { const f = lf(d, 'seg-d', g); fs.writeFileSync(f, '{}'); if (g <= 5) { fs.writeFileSync(`${f}.released`, '1'); old(f, 5 * H); old(`${f}.released`, 5 * H) } }
  for (let g = 1; g <= 4; g++) { const f = lf(d, 'slot2', g); fs.writeFileSync(f, '{}'); old(f, 5 * H) }
  const n = M.leaseSweep(d, Date.now(), { force: true })
  return { d, n }
}
await t('SWEEP: superseded generations older than 4 h go with their markers; the newest 3 and anything younger stay', () => {
  const { d, n } = sweepScene(P)
  assert.equal(n, 11, 'seg-d 1..5 with their 5 markers, and slot2 g1')
  assert.deepEqual(gensIn(d, 'seg-d'), [6, 7, 8, 9, 10])
  assert.equal(fs.readdirSync(d).filter(x => x.endsWith('.released')).length, 0)
  assert.deepEqual(gensIn(d, 'slot2'), [2, 3, 4], 'old, but the newest 3')
})
await t('SWEEP: at most once an hour per directory unless forced (one listing an hour, not a listing a take)', () => {
  P._resetGenHints()
  const d = tmp()
  const now = Date.now()
  P.leaseSweep(d, now)
  for (let g = 1; g <= 6; g++) { const f = lf(d, 'seg-e', g); fs.writeFileSync(f, '{}'); old(f, 5 * H) }
  assert.equal(P.leaseSweep(d, now + 60_000), 0)
  assert.equal(P.leaseSweep(d, now + H + 1), 3)
  assert.deepEqual(gensIn(d, 'seg-e'), [4, 5, 6])
})
await t('SWEEP runs from takeLease (the pile-up stops without a host cron)', () => {
  P._resetGenHints()
  const d = tmp()
  for (let g = 1; g <= 8; g++) { const f = lf(d, 'slot1', g); fs.writeFileSync(f, JSON.stringify({ holder: 'A', at: 0, until: 0 })); old(f, 5 * H) }
  assert.ok(P.takeLease(d, KEY, 'slot1', 'B').ok)
  assert.deepEqual(gensIn(d, 'slot1'), [7, 8, 9])
  assert.ok(P.holdsLease(d, KEY, 'slot1', 'B', 9))
})
await t('MUTANT KILLED: a sweep without the age floor deletes the tripwire\'s recent history', async () => {
  let killed = false
  await withMutant('      if (now - m < LEASE_PRUNE_AGE_MS) break', '      if (false) break', async M => {
    const { d } = sweepScene(M)
    try { assert.deepEqual(gensIn(d, 'seg-d'), [6, 7, 8, 9, 10]) } catch { killed = true }
  })
  assert.ok(killed)
})
await t('MUTANT KILLED: a sweep that keeps no newest generations deletes a live lease', async () => {
  let killed = false
  await withMutant('export const LEASE_KEEP = 3', 'export const LEASE_KEEP = 0', async M => {
    const { d } = sweepScene(M)
    try { assert.deepEqual(gensIn(d, 'slot2'), [2, 3, 4]) } catch { killed = true }
  })
  assert.ok(killed)
})

// ---- the reconnect leak (structural: the timers are per connection; behaviour needs a live server) ---------------------------

await t('index.mjs clears the memory sampler and the wedged-goal watchdog at the connection\'s end', () => {
  const src = readFileSync(new URL('../src/index.mjs', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/[^\n]*$/gm, '')
  assert.equal(src.split("bot.once('end', () => clearInterval(memTimer))").length, 2)
  assert.equal(src.split("bot.once('end', () => clearInterval(posTimer))").length, 2)
  assert.equal(src.split('const posTimer = setInterval(').length, 2)
})

for (const d of dirs) { try { fs.rmSync(d, { recursive: true, force: true }) } catch {} }
console.log(`\nleasegen: ${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
