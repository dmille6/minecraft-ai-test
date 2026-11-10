// RECCACHE-01 (docs/reports/keeperstall-2026-11-10.md, piece 3). LIVE showcase 11-10, the keeper's CPU profile: recordHead was 35% of a
// bot's busy CPU, one shopActive pass 7-10 s of synchronous record reading -- every call read, parsed and hashed EVERY generation file
// (435 files, 35 MB). buildproj.mjs now keeps PER-FILE FACTS (what one read generation says, under the stat it was read with) and makes
// the walk again on every call. What this file holds it to, on REAL files in REAL temp directories:
//   EQUIVALENCE   after every step of a scripted history the cached walk (asked twice: the read and the served repeat) deep-equals the
//                 walk with RECCACHE=off -- publishes, a foreign generation, a broken chain, a wrong gen, an unparseable file, a middle
//                 generation and the root removed, a same-size replacement by rename, an in-place rewrite with its mtime restored, an
//                 unreadable file, the head moving back.
//   COUNTERS      an unchanged history that is not racily clean reads 0 generation files; a publish reads exactly the new one.
//   RACY          a file is read on every call until it is REC_RACY_MS old, and a kept fact is not SERVED while its file reads racy.
//   THE CLOCK     a wall clock that fell back against the monotonic one empties the cache (r1, review BLOCKER A).
//   VERIFIED AGAIN  a fact is served for REC_VERIFY_MS + its path's jitter of MONOTONIC time, then its file is read again (r2): a
//                 change no stat can see is served stale for one verify interval at most -- "THE RESIDUAL" below is the one test
//                 in this file that tolerates a cached answer other than the uncached one, and only inside that interval.
//   ONE DESCRIPTOR  a fact binds the bytes to the inode they were read from, whatever the path did around the read (r1, BLOCKER B).
//   NO OLD CLOCK  both clocks are sampled at every fact's hit decision and once more before the answer is returned (r3): a walk
//                 resting on a fact whose deadline came meanwhile is made again; three such walks and the plain walk answers.
//   NOTHING SHARED  the caller may mutate head.rec, rejected and gens.
//   NO KEPT FAILURE  an unreadable or unparseable file is read again on every call.
//   RECCACHE=off  every file read on every call, nothing kept.
// NO TEST HERE DEPENDS ON WALL TIME. A file's ctime cannot be set, so the module's clocks are set instead, through its tests' seam
// (recTestSeam): AGED = the wall clock runs 10 s ahead of the real one (every file that exists reads long still, however slow the
// host; it never runs back) and the monotonic clock stands still (no verify deadline passes, however slow the host); or clocks
// the test steps by hand from the files' own stamps. The same seam's `at` hook is how a test moves a file BETWEEN two system
// calls of one read, and its `stat` is how a test makes every stat field repeat over other bytes. AGED defeats the racy rule on
// purpose, so every step that changes a file IN PLACE (same inode) first waits 30 ms and then PROVES the ctime moved.
// Anchored mutants (each anchor asserted present and unique, CLAUDE.md), each named after the test that must fail on it.
import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { performance } from 'node:perf_hooks'

delete process.env.RECCACHE
const P = await import('../src/buildproj.mjs')
const PROJ_URL = new URL('../src/buildproj.mjs', import.meta.url)
const SRC_URL = new URL('../src/', import.meta.url)

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 8).join('\n        ')}`) }
}
/** The source with every anchored replacement applied (each anchor PRESENT and UNIQUE: a mutant that did not apply reads as killed). */
function mutantText (url, pairs) {
  let src = fs.readFileSync(url, 'utf8')
  for (const [old, neu] of pairs) {
    assert.ok(src.includes(old), `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 70))}`)
    assert.ok(src.split(old).length === 2, `ANCHOR MISSING OR NOT UNIQUE: ${JSON.stringify(old.slice(0, 70))}`)
    src = src.replace(old, () => neu)
  }
  return src
}
/** A mutant of a src module (keeperstall.test.mjs withMutants), imported from the test directory: its own cache, its own counters. */
async function withMutants (url, pairs, fn) {
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  fs.writeFileSync(out, mutantText(url, pairs).replace(/from '\.\//g, "from '../src/"))
  try { return await fn(await import(out.href)) } finally { try { fs.unlinkSync(out) } catch {} }
}
/** The scenario passes on the real module (or on the `base` variant of it: a bound made small) and fails ITS OWN ASSERTION on the
 *  mutant (a throw of another kind is not a kill). */
async function killedBy (pairs, scenario, base = null) {
  if (base) await withMutants(PROJ_URL, base, scenario); else await scenario(P)
  let why = null
  await withMutants(PROJ_URL, [...(base ?? []), ...pairs], async M => { try { await scenario(M) } catch (e) { why = e } })
  assert.ok(why instanceof assert.AssertionError, `the mutant survived or died for another reason: ${why?.stack?.split('\n')[0] ?? 'survived'}`)
}
// what depended on the host (a step skipped, a filesystem that would not give a scene, the benchmark): printed where it happens and
// once more at the end, so a run's last lines say what it did NOT exercise
const notes = []
const note = s => { notes.push(s); console.log(`        (${s})`) }
const turn = () => new Promise(resolve => setImmediate(resolve))      // the kept directory listings are dropped at the next turn
const nap = ms => new Promise(resolve => setTimeout(resolve, ms))
const ROOT_USER = typeof process.getuid === 'function' && process.getuid() === 0
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'reccache-'))
const KEY = P.projKey({ x: 0, y: 70, z: 0 }, 'reccache')
const sha = buf => crypto.createHash('sha256').update(buf).digest('hex')
const gf = (d, n, key = KEY) => path.join(d, `${key}.g${n}.json`)
const bstat = f => fs.statSync(f, { bigint: true })
/** A file's racy stamp as the module reads it: the later of its mtime and ctime, whole ms. */
const stampMs = f => { const st = bstat(f); return Number((st.mtimeNs > st.ctimeNs ? st.mtimeNs : st.ctimeNs) / 1_000_000n) }
const T0 = 1_700_000_000                                              // whole seconds: utimesSync restores such an mtime exactly
const age = (f, n = 0) => fs.utimesSync(f, T0 + n, T0 + n)
const AHEAD_MS = 10_000, MONO0 = 1_000_000
/** A scenario's start: nothing kept, no hook, and the module's clocks AGED -- the wall clock 10 s ahead of the real one, so every
 *  file that exists reads long still however slow the host is, and it never runs back; the monotonic clock standing still, so no
 *  verify deadline passes however slow the host is. */
const begin = M => { M.recTestSeam(null); M.recCacheReset(); M.recTestSeam({ now: () => Date.now() + AHEAD_MS, mono: () => MONO0 }) }
/** A clock the test steps by hand: wall `t`, monotonic `m` (ms). */
const handClock = (M, t, m = 0) => { const c = { t, m }; M.recTestSeam(null); M.recCacheReset(); M.recTestSeam({ now: () => c.t, mono: () => c.m }); return c }
/** The cached walk. */
const on = (M, d, key = KEY) => M.recordHead(d, key)
/** The walk as it was: RECCACHE=off. */
const off = (M, d, key = KEY) => {
  const prev = process.env.RECCACHE
  process.env.RECCACHE = 'off'
  try { return M.recordHead(d, key) } finally { if (prev === undefined) delete process.env.RECCACHE; else process.env.RECCACHE = prev }
}
const eq = (a, b, label) => { try { assert.deepStrictEqual(a, b) } catch (e) { e.message = `${label}\n${e.message}`; throw e } }
/** EQUIVALENCE at this instant: the cached walk, the uncached walk, the cached walk again (now served where it may be). -> uncached */
function same (M, d, label, key = KEY) {
  const a = on(M, d, key), b = off(M, d, key), a2 = on(M, d, key)
  eq(a, b, `${label}: the cached walk is not the uncached walk`)
  eq(a2, b, `${label}: the repeat of the cached walk is not the uncached walk`)
  return b
}
/** [reads, hits] since the last call of the returned function. */
const meter = M => { const S = M.recStats; let r = S.reads, h = S.hits; return () => { const x = [S.reads - r, S.hits - h]; r = S.reads; h = S.hits; return x } }
const BODY = n => ({ v: 1, plot: 'reccache', n, cells: [[n, 64, n]], zones: { a: n }, pad: 'p'.repeat(64) })
/** n generations by the REAL publishRecord, each given an old whole-second mtime. */
function chain (M, d, n, key = KEY) {
  for (let i = (M.recordGenNow(d, key) ?? 0) + 1; i <= n; i++) {
    const r = M.publishRecord(d, key, () => BODY(i))
    assert.strictEqual(r.result, 'accepted'); assert.strictEqual(r.gen, i)
    age(gf(d, i, key), i)
  }
}
/** A generation by hand with the link protocol (publishRecord's, frontierpublish.py's): tmp 'wx' + fsync + link + unlink. */
function linkGen (d, n, body, key = KEY) {
  const f = gf(d, n, key), tmpf = `${f}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body))
  const fd = fs.openSync(tmpf, 'wx')
  try { fs.writeSync(fd, buf); fs.fsyncSync(fd) } finally { fs.closeSync(fd) }
  try { fs.linkSync(tmpf, f) } finally { fs.unlinkSync(tmpf) }
  age(f, n)
  return buf
}
/** n generations by hand, a valid chain. */
function byHand (d, n, key = KEY) { let ps = null; for (let g = 1; g <= n; g++) ps = sha(linkGen(d, g, { ...BODY(g), gen: g, prev: g === 1 ? null : g - 1, prevSha: ps }, key)) }
/** Other bytes of the SAME size that still parse (one letter of the pad). */
const twin = buf => { const s = buf.toString('utf8'), o = s.replace('"pad":"p', '"pad":"q'); assert.notStrictEqual(o, s); assert.strictEqual(Buffer.byteLength(o), buf.length); return Buffer.from(o) }
/** Other bytes over a file, the same inode and size; the mtime is NOT put back (it moves to now). */
const overwrite = (f, bytes) => { const fd = fs.openSync(f, 'r+'); try { fs.writeSync(fd, bytes, 0, bytes.length, 0) } finally { fs.closeSync(fd) } }
/** Replace a generation BY RENAME (a new inode), the mtime as it was. */
function replaceByRename (f, bytes) {
  const st = bstat(f), sw = `${f}.swap.tmp`
  fs.writeFileSync(sw, bytes)
  fs.utimesSync(sw, Number(st.mtimeNs / 1_000_000_000n), Number(st.mtimeNs / 1_000_000_000n))
  fs.renameSync(sw, f)
  const now = bstat(f)
  assert.notStrictEqual(now.ino, st.ino, 'CONTROL: the rename did not bring a new inode')
  assert.strictEqual(now.size, st.size, 'CONTROL: the replacement is not the same size'); assert.strictEqual(now.mtimeNs, st.mtimeNs, 'CONTROL: the mtime was not restored')
}
/** Rewrite a generation IN PLACE (the same inode, the same size), then put its mtime back: only the ctime tells. */
async function rewriteInPlace (f, bytes) {
  const st = bstat(f)
  assert.strictEqual(BigInt(bytes.length), st.size, 'CONTROL: not the same size')
  await nap(30)                                                       // past the coarsest timestamp tick: the ctime MUST move
  overwrite(f, bytes)
  fs.utimesSync(f, Number(st.mtimeNs / 1_000_000_000n), Number(st.mtimeNs / 1_000_000_000n))
  const now = bstat(f)
  assert.strictEqual(now.ino, st.ino, 'CONTROL: not the same inode'); assert.strictEqual(now.size, st.size, 'CONTROL: the size moved')
  assert.strictEqual(now.mtimeNs, st.mtimeNs, 'CONTROL: the mtime was not restored')
  assert.notStrictEqual(now.ctimeNs, st.ctimeNs, 'CONTROL: the ctime did not move')
}

console.log('RECCACHE-01: THE SWITCH, THE DECISIONS, THE SEAM')
await t('the switch: RECCACHE=off|0|false|no is the rollback; unset is on; the racy window is 2 s, the clock\'s tolerance less', () => {
  for (const v of ['off', 'OFF', ' 0', 'false', 'no']) assert.strictEqual(P.recCacheOn({ RECCACHE: v }), false, v)
  for (const v of [undefined, '', 'on', '1']) assert.strictEqual(P.recCacheOn({ RECCACHE: v }), true, String(v))
  assert.strictEqual(P.REC_RACY_MS, 2000)
  assert.ok(P.REC_CLOCK_BACK_MS > 0 && P.REC_CLOCK_BACK_MS < P.REC_RACY_MS, 'a fall the clock check lets pass must be shorter than the racy window')
})
/** recFactFresh on a REAL file's stat: the fact answers only for the same device, inode, size, mtime and ctime, and only for a stat. */
const scenFresh = M => {
  const d = tmp(); fs.writeFileSync(path.join(d, 'f'), 'x')
  const st = bstat(path.join(d, 'f'))
  const c = { dev: st.dev, ino: st.ino, size: st.size, mtimeNs: st.mtimeNs, ctimeNs: st.ctimeNs, recGen: 1, prev: null, prevSha: null, sha: 'x' }
  assert.strictEqual(M.recFactFresh(c, st), true, 'CONTROL: a fact read under this very stat is not served')
  for (const k of ['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs']) assert.strictEqual(M.recFactFresh({ ...c, [k]: c[k] + 1n }, st), false, `another ${k} was served`)
  assert.strictEqual(M.recFactFresh(c, null), false, 'a failed stat was served'); assert.strictEqual(M.recFactFresh(undefined, st), false)
  assert.strictEqual(M.recFactFresh(null, null), false)
}
await t('a kept fact answers only for the SAME device, inode, size, mtime and ctime, and never for a failed stat (recFactFresh)', () => scenFresh(P))
await t('racily clean (recRacy): mtime OR ctime within the window, or stamped in the future; both long still is clean', () => {
  const now = 1_800_000_000_000, ns = ms => BigInt(ms) * 1_000_000n
  assert.strictEqual(P.recRacy({ mtimeNs: ns(now - 60_000), ctimeNs: ns(now - 60_000) }, now), false)
  assert.strictEqual(P.recRacy({ mtimeNs: ns(now - 60_000), ctimeNs: ns(now - 100) }, now), true, 'a recent ctime under an old mtime (utimes)')
  assert.strictEqual(P.recRacy({ mtimeNs: ns(now - 100), ctimeNs: ns(now - 60_000) }, now), true)
  assert.strictEqual(P.recRacy({ mtimeNs: ns(now + 3_600_000), ctimeNs: ns(now - 60_000) }, now), true, 'a future stamp')
  assert.strictEqual(P.recRacy({ mtimeNs: ns(now - P.REC_RACY_MS), ctimeNs: ns(now - P.REC_RACY_MS) }, now), false, 'exactly the window: still')
  assert.strictEqual(P.recRacy({ mtimeNs: ns(now - P.REC_RACY_MS + 1), ctimeNs: ns(now - 60_000) }, now), true)
})
await t('the clock fell back (recClockBack): the wall-minus-monotonic offset more than the tolerance under its highest reading', () => {
  const B = P.REC_CLOCK_BACK_MS
  assert.strictEqual(P.recClockBack(null, 5), false, 'no reading yet')
  assert.strictEqual(P.recClockBack(1000, 1000), false); assert.strictEqual(P.recClockBack(1000, 99_999), false, 'forward')
  assert.strictEqual(P.recClockBack(1000, 1000 - B), false, 'exactly the tolerance'); assert.strictEqual(P.recClockBack(1000, 1000 - B - 1), true)
})
/** Where the seam's setter and its fields are written, over source texts. */
const seamWrites = texts => texts.flatMap(([name, text]) => [...text.matchAll(/recTestSeam|Object\.assign\(recSeam|recSeam\.(?:now|mono|at|stat)\s*=(?!=)/g)].map(m => `${name}: ${m[0]}`))
await t('STRUCTURE: nothing in src/ sets the tests\' seam -- the setter is named once (its definition), its fields are written nowhere else', () => {
  // the modules themselves: other tests park `_mutant-*` / `.mut-*` copies in src/ while they run beside this one
  const read = n => { try { return fs.readFileSync(new URL(n, SRC_URL), 'utf8') } catch { return null } }
  const texts = fs.readdirSync(SRC_URL).filter(n => /^[A-Za-z][\w-]*\.mjs$/.test(n)).map(n => [n, read(n)]).filter(([, x]) => x != null)
  assert.ok(texts.length > 50 && texts.some(([n]) => n === 'buildproj.mjs') && texts.some(([n]) => n === 'skills.mjs'), `CONTROL: ${texts.length} modules scanned`)
  // POSITIVE CONTROL: the scan sees the source (recordHead's callers), and sees a use when there is one
  assert.ok(texts.filter(([, x]) => x.includes('recordHead(')).length >= 2, 'CONTROL: the scan did not find recordHead\'s callers')
  eq(seamWrites([['x.mjs', 'import { recTestSeam } from "./buildproj.mjs"\nrecTestSeam({ now: () => 0 })\nrecSeam.at = f\nif (recSeam.at === f) g()\nrecSeam.stat = f']]).length, 4, 'CONTROL: the scan misses a use')
  eq(seamWrites(texts), ['buildproj.mjs: recTestSeam', 'buildproj.mjs: Object.assign(recSeam'], 'the seam is set in src/')
})

console.log('EQUIVALENCE: THE CACHED WALK IS THE UNCACHED WALK, AFTER EVERY STEP')
/** THE SCRIPTED HISTORY -> { reads, steps }. `cross`: both clocks jump CROSS_MS on before every step's comparison, so facts kept
 *  early in the history pass their verify deadlines in the middle of it; otherwise AGED (no deadline passes; the counters are exact). */
const CROSS_MS = 11_000
async function history (cross) {
  begin(P)
  let skew = 0
  if (cross) P.recTestSeam({ now: () => Date.now() + AHEAD_MS + skew, mono: () => MONO0 + skew })
  const d = tmp()
  let n = 0
  const step = async (label, fn, check) => { await fn?.(); await turn(); if (cross) skew += CROSS_MS; const r = same(P, d, `step ${++n} (${label})`); check?.(r); return r }
  await step('no record', null, r => { assert.strictEqual(r.ok, true); assert.strictEqual(r.head, null) })
  eq(on(P, path.join(d, 'nowhere')), off(P, path.join(d, 'nowhere')), 'a directory that does not exist')
  for (let i = 1; i <= 4; i++) await step(`publish g${i}`, () => chain(P, d, i), r => { assert.strictEqual(r.head.gen, i); assert.strictEqual(r.head.rec.n, i) })
  const orig = {}; for (let i = 1; i <= 4; i++) orig[i] = fs.readFileSync(gf(d, i))
  const h4 = off(P, d).head
  await step('a foreign generation, linked by hand', () => { orig[5] = linkGen(d, 5, { ...BODY(5), gen: 5, prev: 4, prevSha: h4.sha, at: 1, by: 'foreign' }) }, r => { assert.strictEqual(r.head.gen, 5); assert.strictEqual(r.head.rec.by, 'foreign'); eq(r.rejected, [], 'rejected') })
  const s5 = sha(orig[5])
  await step('a generation that breaks the chain (a wrong prevSha)', () => linkGen(d, 6, { ...BODY(6), gen: 6, prev: 5, prevSha: '0'.repeat(64) }), r => { assert.strictEqual(r.head.gen, 5); eq(r.rejected, [{ gen: 6, why: 'chain' }], 'rejected') })
  await step('a generation with a wrong gen', () => linkGen(d, 7, { ...BODY(7), gen: 99, prev: 5, prevSha: s5 }), r => eq(r.rejected, [{ gen: 6, why: 'chain' }, { gen: 7, why: 'gen' }], 'rejected'))
  await step('an unparseable generation', () => linkGen(d, 8, '{"gen":8,"prev":5,'), r => eq(r.rejected.at(-1), { gen: 8, why: 'unparseable' }, 'rejected'))
  await step('a valid generation past the rejected ones', () => { orig[9] = linkGen(d, 9, { ...BODY(9), gen: 9, prev: 5, prevSha: s5 }) }, r => { assert.strictEqual(r.head.gen, 9); assert.strictEqual(r.rejected.length, 3) })
  await step('the real publishRecord on top of it', () => { const r = P.publishRecord(d, KEY, rec => ({ ...rec, n: 10 })); assert.strictEqual(r.result, 'accepted'); assert.strictEqual(r.gen, 10); age(gf(d, 10), 10); orig[10] = fs.readFileSync(gf(d, 10)) }, r => { assert.strictEqual(r.head.gen, 10); assert.strictEqual(r.head.rec.n, 10) })
  const full = off(P, d)
  const back = r => eq(r, full, 'the history put back is not the history')
  // a removed ancestor: everything after it is no link
  await step('a middle generation removed', () => fs.unlinkSync(gf(d, 3)), r => { assert.strictEqual(r.head.gen, 2); assert.ok(r.rejected.some(x => x.gen === 4 && x.why === 'chain')); assert.ok(r.rejected.some(x => x.gen === 10 && x.why === 'chain')) })
  await step('the middle generation put back', () => linkGen(d, 3, orig[3]), back)
  await step('the root removed', () => fs.unlinkSync(gf(d, 1)), r => { assert.strictEqual(r.head, null); eq(r.rejected[0], { gen: 2, why: 'no root' }, 'rejected'); assert.strictEqual(r.rejected.length, r.gens.length) })
  await step('the root put back', () => linkGen(d, 1, orig[1]), back)
  // a replaced ancestor: the same name, the same size, the same mtime, other bytes
  await step('a generation replaced by rename, other bytes of the same size', () => replaceByRename(gf(d, 2), twin(orig[2])), r => { assert.strictEqual(r.head.gen, 2); assert.strictEqual(r.head.rec.pad[0], 'q'); assert.ok(r.rejected.some(x => x.gen === 3 && x.why === 'chain')) })
  await step('the replaced generation put back by rename', () => replaceByRename(gf(d, 2), orig[2]), back)
  await step('a generation rewritten in place, its mtime restored (only the ctime moved)', () => rewriteInPlace(gf(d, 4), twin(orig[4])), r => { assert.strictEqual(r.head.gen, 4); assert.strictEqual(r.head.rec.pad[0], 'q'); assert.ok(r.rejected.some(x => x.gen === 5 && x.why === 'chain')) })
  await step('the rewritten generation rewritten back', () => rewriteInPlace(gf(d, 4), orig[4]), back)
  // unreadable: a directory under a generation's name (EISDIR, whoever runs this), then a file without read permission
  await step('a directory under a generation\'s name', () => fs.mkdirSync(gf(d, 11)), r => { assert.strictEqual(r.head.gen, 10); eq(r.rejected.at(-1), { gen: 11, why: 'unreadable' }, 'rejected') })
  await step('the directory gone, a valid generation there', () => { fs.rmdirSync(gf(d, 11)); linkGen(d, 11, { ...BODY(11), gen: 11, prev: 10, prevSha: full.head.sha }) }, r => assert.strictEqual(r.head.gen, 11))
  let chmodSeen = false
  if (!ROOT_USER) {
    await nap(30); fs.chmodSync(gf(d, 3), 0o000)
    let denied = false; try { fs.readFileSync(gf(d, 3)) } catch { denied = true }
    if (denied) {
      chmodSeen = true
      await step('a generation made unreadable (chmod 000)', null, r => { assert.strictEqual(r.head.gen, 2); assert.ok(r.rejected.some(x => x.gen === 3 && x.why === 'unreadable')) })
      await step('and readable again', async () => { await nap(30); fs.chmodSync(gf(d, 3), 0o644) }, r => assert.strictEqual(r.head.gen, 11))
    } else fs.chmodSync(gf(d, 3), 0o644)
  }
  if (!cross) note(`history, chmod 000 step: ${chmodSeen ? 'run' : 'SKIPPED (running as root, or the filesystem ignores the mode)'}`)
  // the head moves BACK to a generation that was not read in this call: its bytes are read again and checked against its fact
  await turn(); on(P, d)
  fs.unlinkSync(gf(d, 11)); await turn()
  const m = meter(P)
  const moved = on(P, d)
  if (!cross) eq(m()[0], 2, 'the head moved back: the unparseable g8 (never kept) and the new head\'s bytes, nothing else')
  m()
  const plain = off(P, d)
  eq(m(), [10, 0], 'CONTROL: the uncached walk reads all ten generations')
  eq(moved, plain, 'the head moved back'); assert.strictEqual(moved.head.gen, 10)
  eq(on(P, d), plain, 'the head moved back, served'); if (!cross) eq(m()[0], 1, 'the new head\'s bytes are kept now: only g8 is read')
  // POSITIVE CONTROL: the history was really served from kept facts, not read afresh every time
  assert.ok(P.recStats.hits > 100, `the cached walk served ${P.recStats.hits} facts over the history`)
  assert.strictEqual(P.recStats.drops, 0, 'the clock check emptied the cache during the history')
  // a directory that cannot be listed is ok: false either way
  const notdir = path.join(d, 'a-file'); fs.writeFileSync(notdir, 'x')
  eq(on(P, notdir), off(P, notdir), 'not a directory'); assert.strictEqual(on(P, notdir).ok, false)
  return { reads: P.recStats.reads, steps: n }
}
let agedHistory = null
await t('a scripted history: publishes, a foreign generation, chain / gen / unparseable rejections, a middle generation and the root removed and put back, a same-size replacement by rename, an in-place rewrite with its mtime restored, an unreadable file, the head moving back', async () => { agedHistory = await history(false) })
await t('the same history with the verify window crossing in the middle of it (both clocks 11 s on at every step): still the uncached walk at every step', async () => {
  assert.ok(agedHistory, 'CONTROL: the history above did not finish')
  const r = await history(true)
  assert.ok(r.steps * CROSS_MS > 2 * (P.REC_VERIFY_MS + P.REC_VERIFY_JITTER_MS), `CONTROL: ${r.steps} steps do not span two verify windows`)
  assert.ok(r.reads > agedHistory.reads, `CONTROL: no fact was read again mid-history (${r.reads} reads against ${agedHistory.reads})`)
})
await t('odd bodies are judged alike: null, a number, a string, an array, an object for gen / prev / prevSha, a second root', async () => {
  begin(P)
  const root = { v: 1, gen: 1, prev: null, prevSha: null }, rs = sha(Buffer.from(JSON.stringify(root)))
  const odd = ['null', '5', '"str"', '[]', '{}', '0', 'false', '""', '{"gen":{"a":1}}', '{"gen":2,"prev":{"x":1},"prevSha":null}', '{"gen":2,"prev":[1]}',
    '{"gen":2,"prev":null,"prevSha":null}', `{"gen":2,"prev":1,"prevSha":{"s":"${rs}"}}`, `{"gen":2,"prev":1,"prevSha":["${rs}"]}`, `{"gen":2,"prev":"1","prevSha":"${rs}"}`,
    `{"gen":"2","prev":1,"prevSha":"${rs}"}`, `{"gen":2,"prev":1,"prevSha":"${rs}"}`, '{"gen":1,"prev":null}', '{"gen":2}', '']
  const whys = new Set()
  for (const [i, body] of odd.entries()) {
    const alone = tmp(), after = tmp()
    linkGen(alone, 2, body)                                          // no root before it
    linkGen(after, 1, root); linkGen(after, 2, body)                 // after a valid root
    await turn()
    for (const d of [alone, after]) for (const x of same(P, d, `odd body ${i} ${body.slice(0, 30)}`).rejected) whys.add(x.why)
  }
  eq([...whys].sort(), ['chain', 'gen', 'no root', 'unparseable'], 'CONTROL: the odd bodies did not reach every rejection')
  const d = tmp(); linkGen(d, 1, root); linkGen(d, 2, `{"gen":2,"prev":1,"prevSha":"${rs}"}`); await turn()
  assert.strictEqual(same(P, d, 'the valid one').head.gen, 2)
})
/** A generation replaced by rename (other bytes, the same size, the same mtime) while every later generation is KEPT: the head is
 *  the replacement and every later generation is no link. */
const scenReplaced = async M => {
  begin(M)
  const d = tmp(); chain(M, d, 4); await turn()
  on(M, d); const m = meter(M); on(M, d)
  eq(m(), [0, 4], 'CONTROL: the four generations were not kept before the replacement')
  replaceByRename(gf(d, 2), twin(fs.readFileSync(gf(d, 2)))); await turn()
  const r = same(M, d, 'replaced by rename')
  assert.strictEqual(r.head.gen, 2); assert.strictEqual(r.head.rec.pad[0], 'q'); eq(r.rejected, [{ gen: 3, why: 'chain' }, { gen: 4, why: 'chain' }], 'rejected')
}
await t('a generation replaced by rename with other bytes of the SAME size and mtime: the replacement is the head, the kept later generations are no link', () => scenReplaced(P))
/** The same, in place: the same inode, size and mtime -- only the ctime moved. */
const scenInPlace = async M => {
  begin(M)
  const d = tmp(); chain(M, d, 4); await turn()
  on(M, d); const m = meter(M); on(M, d)
  eq(m(), [0, 4], 'CONTROL: the four generations were not kept before the rewrite')
  await rewriteInPlace(gf(d, 3), twin(fs.readFileSync(gf(d, 3)))); await turn()
  const r = same(M, d, 'rewritten in place')
  assert.strictEqual(r.head.gen, 3); assert.strictEqual(r.head.rec.pad[0], 'q'); eq(r.rejected, [{ gen: 4, why: 'chain' }], 'rejected')
}
await t('a generation rewritten IN PLACE with its mtime restored (the same inode, size, mtime; the ctime moved) is read again', () => scenInPlace(P))

console.log('ONE DESCRIPTOR (r1, BLOCKER B): THE FACT IS BOUND TO THE INODE THAT WAS READ')
/** Two directories hold the same record but for g2's bytes (AAAA under `live`, BBBB beside it), every file long still. `swap` puts
 *  the other directory under the path, `back` undoes it: a rename of the PARENT moves no file's ctime. */
function pair () {
  const base = tmp(), live = path.join(base, 'live'), B = path.join(base, 'b'), parked = path.join(base, 'parked')
  const root = JSON.stringify({ v: 1, tag: 'root', gen: 1, prev: null, prevSha: null }), rs = sha(Buffer.from(root))
  for (const [D, tag] of [[live, 'AAAA'], [B, 'BBBB']]) {
    fs.mkdirSync(D); fs.writeFileSync(gf(D, 1), root); fs.writeFileSync(gf(D, 2), JSON.stringify({ v: 1, tag, gen: 2, prev: 1, prevSha: rs }))
    age(gf(D, 1), 1); age(gf(D, 2), 2)
  }
  return { base, live, swap: () => { fs.renameSync(live, parked); fs.renameSync(B, live) }, back: () => { fs.renameSync(live, B); fs.renameSync(parked, live) } }
}
/** "Another process" swaps the directory away at one stage of g2's read and back at a later one (the tests' seam: between two
 *  system calls of one synchronous read). Whatever that one call answered, every LATER call is the uncached walk: AAAA. */
const scenSwap = async M => {
  for (const [away, home] of [['open', 'opened'], ['open', 'read'], ['stat0', 'read']]) {
    begin(M)
    const s = pair(), target = gf(s.live, 2), seen = []
    await turn()
    M.recTestSeam({ at: (stage, p) => {
      if (p !== target) return
      if (stage === away && seen.length === 0) { s.swap(); seen.push('away') } else if (stage === home && seen.length === 1) { s.back(); seen.push('home') }
    } })
    const first = on(M, s.live)
    M.recTestSeam({ at: null })
    eq(seen, ['away', 'home'], `CONTROL ${away} -> ${home}: the directory was not swapped away and back inside the read`)
    // the read itself: `open` .. -> the descriptor is the OTHER directory's file (BBBB); `stat0` .. -> it is already this one's (AAAA)
    assert.strictEqual(first.head.rec.tag, away === 'open' ? 'BBBB' : 'AAAA', `${away} -> ${home}: the bytes of the descriptor that was opened`)
    for (let i = 0; i < 2; i++) { await turn(); assert.strictEqual(same(M, s.live, `${away} -> ${home}, call ${i + 1} after the swap`).head.rec.tag, 'AAAA') }
    fs.rmSync(s.base, { recursive: true, force: true })
  }
}
await t('a directory swapped away and back around one read (the path names another inode for one system call): every later call is the uncached walk', () => scenSwap(P))
/** The file is rewritten BETWEEN the read and the stat after it: the fact would bind the old bytes to the new stat -- not kept. */
const scenBetweenStats = async M => {
  begin(M)
  const d = tmp(); chain(M, d, 3); await turn(); M.recCacheReset()
  const target = gf(d, 2), other = twin(fs.readFileSync(target))
  let did = 0
  M.recTestSeam({ at: (stage, p) => { if (stage === 'read' && p === target && !did++) overwrite(p, other) } })
  const first = on(M, d)
  M.recTestSeam({ at: null })
  assert.strictEqual(did, 1, 'CONTROL: the file was not rewritten between the read and the second stat')
  assert.notStrictEqual(bstat(target).mtimeNs, BigInt(T0 + 2) * 1_000_000_000n, 'CONTROL: the rewrite did not move the stat')
  assert.strictEqual(first.head.gen, 3, 'the bytes read before the rewrite')
  assert.strictEqual(M.recCacheSize().facts, 2, 'a file that changed between the stat before its read and the stat after it was kept')
  await turn()
  const r = same(M, d, 'after the rewrite')
  assert.strictEqual(r.head.gen, 2); assert.strictEqual(r.head.rec.pad[0], 'q'); eq(r.rejected, [{ gen: 3, why: 'chain' }], 'rejected')
}
await t('a file rewritten between the stat before its read and the stat after it is not kept; the next call reads the rewrite', () => scenBetweenStats(P))
/** TWO INODES, ONE STAT (not every filesystem gives it). Two directories hold the same record but for g2's bytes; the two g2 files
 *  are stamped back to back so the kernel's coarse clock gives them the same ctime (and mtime, and size). The directories are then
 *  swapped by rename BETWEEN two calls: the path's file differs from the kept fact ONLY by its inode. -> null when not given. */
function twins () {
  for (let i = 0; i < 300; i++) {
    const base = tmp(), A = path.join(base, 'a'), B = path.join(base, 'b'); fs.mkdirSync(A); fs.mkdirSync(B)
    const root = JSON.stringify({ v: 1, tag: 'root', gen: 1, prev: null, prevSha: null }), rs = sha(Buffer.from(root))
    for (const [D, tag] of [[A, 'AAAA'], [B, 'BBBB']]) { fs.writeFileSync(gf(D, 1), root); fs.writeFileSync(gf(D, 2), JSON.stringify({ v: 1, tag, gen: 2, prev: 1, prevSha: rs })) }
    fs.utimesSync(gf(A, 2), T0, T0); fs.utimesSync(gf(B, 2), T0, T0)   // no stat between the two
    const a = bstat(gf(A, 2)), b = bstat(gf(B, 2))
    if (a.ino !== b.ino && a.size === b.size && a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs) return { base, A, B }
    fs.rmSync(base, { recursive: true, force: true })
  }
  return null
}
const scenTwins = async M => {
  begin(M)
  const tw = twins()
  if (!tw) return false
  const live = path.join(tw.base, 'live')
  fs.renameSync(tw.A, live); await turn()
  assert.strictEqual(same(M, live, 'twin A').head.rec.tag, 'AAAA')
  const m = meter(M); on(M, live); eq(m(), [0, 2], 'CONTROL: twin A was not kept')
  fs.renameSync(live, path.join(tw.base, 'old')); fs.renameSync(tw.B, live); await turn()
  assert.strictEqual(same(M, live, 'twin B under the same path, the same size, mtime and ctime').head.rec.tag, 'BBBB')
  return true
}
let twinsReached = false
await t('two inodes with ONE size, mtime and ctime under the same path (a directory swap between two calls): the other inode is read', async () => {
  twinsReached = await scenTwins(P)
  note(`two inodes, one stat (real files): ${twinsReached ? 'REACHED' : 'NOT REACHED on this filesystem (fine-grained ctime)'} -- the inode in the key is held deterministically by "a kept fact answers only for the SAME device, inode..." and "a directory swapped away and back around one read..."`)
})

console.log('THE HEAD\'S BYTES: READ AGAIN WHEN THEY ARE NOT KEPT, AND CHECKED AGAINST THE FACT')
/** The head moved back to g4 (its bytes are not kept) and g4 is rewritten between its stat and the re-read (the seam's `head`
 *  stage): the bytes do not hash to the fact -- the fact is dropped and the walk made again. */
const scenHeadReread = async M => {
  begin(M)
  const d = tmp(); chain(M, d, 5); await turn(); on(M, d)
  fs.unlinkSync(gf(d, 5)); await turn()
  const target = gf(d, 4), other = twin(fs.readFileSync(target))
  let did = 0
  M.recTestSeam({ at: (stage, p) => { if (stage === 'head' && p === target && !did++) overwrite(p, other) } })
  const m = meter(M)
  const a = on(M, d), counted = m()
  M.recTestSeam({ at: null })
  assert.strictEqual(did, 1, 'CONTROL: the head\'s file was not rewritten between its stat and its re-read')
  eq(a, off(M, d), 'the head re-read under a fact its bytes no longer hash to')
  assert.strictEqual(a.head.gen, 4); assert.strictEqual(a.head.rec.pad[0], 'q')
  eq(counted, [2, 7], 'the re-read that did not hash to the fact, then the fresh read of the walk made again (g1-g4 served, then g1-g3)')
  await turn(); eq(on(M, d), off(M, d), 'the call after')
}
await t('the head moved back and its file is no longer the bytes its fact was read from: the fact is dropped, the walk made again', () => scenHeadReread(P))
/** The same on real files without the seam: a rewrite inside one ctime tick leaves a stale fact (which only the AGED clock lets
 *  survive). -> false when the filesystem moved the ctime every time. */
const scenHeadMoved = async M => {
  for (let i = 0; i < 200; i++) {
    begin(M)
    const d = tmp()
    let ps = null
    for (let g = 1; g <= 5; g++) { const buf = Buffer.from(JSON.stringify({ ...BODY(g), gen: g, prev: g === 1 ? null : g - 1, prevSha: ps })); fs.writeFileSync(gf(d, g), buf); age(gf(d, g), g); ps = sha(buf) }
    const f = gf(d, 4), other = twin(fs.readFileSync(f))
    age(f, 4); on(M, d); fs.unlinkSync(gf(d, 5))                       // every fact kept; the kept bytes are g5's
    const st = bstat(f)
    overwrite(f, other); age(f, 4)
    const now = bstat(f)
    if (!(now.ino === st.ino && now.size === st.size && now.mtimeNs === st.mtimeNs && now.ctimeNs === st.ctimeNs)) { fs.rmSync(d, { recursive: true, force: true }); continue }
    M.dropListings()
    const m = meter(M)
    const a = on(M, d), reads = m()[0]
    eq(a, off(M, d), 'the head re-read under a stale fact')
    assert.strictEqual(a.head.gen, 4); assert.strictEqual(a.head.rec.pad[0], 'q')
    assert.strictEqual(reads, 2, 'the re-read that did not hash to the fact, then the fresh read of the walk made again')
    return true
  }
  return false
}
await t('the same on real files alone: a rewrite inside one ctime tick under the head that moved back', async () => {
  const reached = await scenHeadMoved(P)
  note(`the head's stale fact, a rewrite inside one ctime tick (real files): ${reached ? 'REACHED' : 'NOT REACHED on this filesystem (the ctime moved every time)'} -- the drop-and-walk-again path is held deterministically by "the head moved back and its file is no longer the bytes..."`)
})
await t('three walks in a row lose their head between its stat and its re-read: the answer is the plain walk\'s', async () => {
  await withMutants(PROJ_URL, [['export const REC_HEAD_BYTES_MAX = 32 * 1024 * 1024', 'export const REC_HEAD_BYTES_MAX = 16']], async M => {
    begin(M)
    const d = tmp(); chain(M, d, 3); await turn(); on(M, d)            // three facts kept, no head bytes (the bound made tiny)
    const lost = []
    M.recTestSeam({ at: (stage, p) => { if (stage === 'head') { lost.push(path.basename(p)); fs.unlinkSync(p); M.dropListings() } } })
    const a = on(M, d)
    M.recTestSeam({ at: null })
    eq(lost, [3, 2, 1].map(g => path.basename(gf(d, g))), 'CONTROL: each walk\'s head was not removed under its re-read')
    eq(a, { ok: true, head: null, gens: [], rejected: [] }, 'after three lost heads')
    eq(a, off(M, d), 'the plain walk')
  })
})

console.log('COUNTERS: WHAT A CALL READS')
/** An unchanged history that is not racily clean reads nothing; a publish reads exactly the generation it linked, once. */
const scenCounters = async M => {
  begin(M)
  const d = tmp(); chain(M, d, 5); await turn()
  M.recCacheReset()                                                   // what publishRecord's own walks kept is forgotten: count from nothing
  const m = meter(M)
  on(M, d); eq(m(), [5, 0], 'the first walk reads every generation')
  for (let i = 0; i < 3; i++) { const a = on(M, d); eq(m(), [0, 5], `repeat ${i}: an unchanged history reads no generation file`); assert.strictEqual(a.head.gen, 5) }
  const p = M.publishRecord(d, KEY, rec => ({ ...rec, n: 6 }))
  assert.strictEqual(p.result, 'accepted'); assert.strictEqual(p.gen, 6); assert.strictEqual(p.head.rec.n, 6)
  eq(m(), [1, 10], 'a publish on a kept history (two walks) reads only the generation it linked')
  await turn()
  const a = on(M, d); eq(m(), [0, 6], 'and the call after it reads none'); assert.strictEqual(a.head.gen, 6); assert.strictEqual(a.head.rec.n, 6)
  eq(a, off(M, d), 'the served walk'); eq(m(), [6, 0], 'CONTROL: the uncached walk reads every generation')
  eq(M.recCacheSize().facts, 6, 'facts kept'); eq(M.recCacheSize().heads, 1, 'head Buffers kept')
  assert.strictEqual(M.recStats.drops, 0)
}
await t('an unchanged history that is not racily clean reads 0 generation files; a publish reads exactly the generation it linked, once', () => scenCounters(P))
await t('RECCACHE=off: every generation read on every call, nothing served, nothing kept', async () => {
  begin(P)
  const d = tmp(); chain(P, d, 5); await turn()
  P.recCacheReset()
  for (let i = 1; i <= 3; i++) { assert.strictEqual(off(P, d).head.gen, 5); eq([P.recStats.reads, P.recStats.hits], [5 * i, 0], `call ${i}`) }
  eq(P.recCacheSize(), { facts: 0, heads: 0, headBytes: 0 }, 'kept under RECCACHE=off')
})

console.log('RACILY CLEAN: NOT KEPT, AND NOT SERVED (the clock is stepped by hand from the file\'s own stamp)')
/** One generation, its stamp c: read on every call while the clock is under c + REC_RACY_MS, kept at c + REC_RACY_MS. */
const scenRacy = async M => {
  const d = tmp(); linkGen(d, 1, { ...BODY(1), gen: 1, prev: null, prevSha: null }); await turn()
  const c = stampMs(gf(d, 1)), clock = handClock(M, c), m = meter(M)
  for (const dt of [0, 1, 1000, M.REC_RACY_MS - 1]) {
    clock.t = c + dt
    assert.strictEqual(on(M, d).head.gen, 1); eq(m(), [1, 0], `${dt} ms after its stamp: read again`)
    assert.strictEqual(M.recCacheSize().facts, 0, `${dt} ms after its stamp: a racily clean file was kept`)
  }
  clock.t = c + M.REC_RACY_MS
  assert.strictEqual(on(M, d).head.gen, 1); eq(m(), [1, 0], 'at the window: read once more')
  assert.strictEqual(M.recCacheSize().facts, 1, 'CONTROL: a file as old as the window is kept')
  assert.strictEqual(on(M, d).head.gen, 1); eq(m(), [0, 1], 'and served from then on')
  // a file stamped in the FUTURE is racy until the clock has passed its stamp by the window
  const ahead = c + 3_600_000
  fs.utimesSync(gf(d, 1), ahead / 1000, ahead / 1000); await turn()
  const f = stampMs(gf(d, 1)); assert.ok(f > c + 3_000_000, 'CONTROL: the mtime was not moved ahead')
  for (const t of [c + 60_000, f - 1, f + M.REC_RACY_MS - 1]) { clock.t = t; eq(on(M, d), off(M, d), 'future mtime'); assert.strictEqual(M.recCacheSize().facts, 0, 'a file stamped ahead of the clock was kept') }
  clock.t = f + M.REC_RACY_MS; on(M, d); assert.strictEqual(M.recCacheSize().facts, 1)
  assert.strictEqual(M.recStats.drops, 0, 'CONTROL: the clock only ran forward here')
}
await t('a generation is read on every call until the clock is REC_RACY_MS past its stamp, then kept; a future stamp likewise', () => scenRacy(P))
/** r1 BLOCKER A, the first clause: a KEPT fact is not served while its file reads racily clean (a clock that slipped back inside the
 *  tolerance): it is dropped, the file read afresh and not kept. */
const scenRacyHit = async M => {
  const d = tmp(); linkGen(d, 1, { ...BODY(1), gen: 1, prev: null, prevSha: null }); await turn()
  const c = stampMs(gf(d, 1)), clock = handClock(M, c + M.REC_RACY_MS), m = meter(M)
  on(M, d); eq(m(), [1, 0], 'kept'); on(M, d); eq(m(), [0, 1], 'CONTROL: the fact is kept and served while its file is long still')
  clock.t = c + M.REC_RACY_MS - 500                                   // 500 ms back: inside the clock check's tolerance
  for (let i = 0; i < 2; i++) {
    const a = on(M, d)
    eq(m(), [1, 0], `call ${i}: a kept fact was served while its file reads racily clean`)
    eq(a, off(M, d), 'racy at the hit'); m()
    assert.strictEqual(M.recCacheSize().facts, 0, 'the fact was not dropped (or the fresh read was kept)')
  }
  assert.strictEqual(M.recStats.drops, 0, 'CONTROL: it was the racy rule at the hit, not the clock check')
  clock.t = c + M.REC_RACY_MS; on(M, d); on(M, d); eq(m(), [1, 1], 'long still again: kept and served')
}
await t('a kept fact is NOT served while its file reads racily clean: dropped, read afresh, not kept; the answer is the uncached walk\'s', () => scenRacyHit(P))

console.log('THE CLOCK FELL BACK: THE CACHE IS EMPTIED BEFORE THE WALK')
/** r1 BLOCKER A, the second clause: wall and monotonic clocks stepped by hand; every file is a minute old throughout. */
const scenClockBack = async M => {
  const d = tmp(); for (let g = 1, ps = null; g <= 3; g++) ps = sha(linkGen(d, g, { ...BODY(g), gen: g, prev: g === 1 ? null : g - 1, prevSha: ps }))
  await turn()
  const hi = Math.max(...[1, 2, 3].map(g => stampMs(gf(d, g)))), B = M.REC_CLOCK_BACK_MS
  const clock = handClock(M, hi + 600_000), m = meter(M), S = M.recStats
  const t1 = clock.t
  on(M, d); eq(m(), [3, 0], 'kept'); on(M, d); eq(m(), [0, 3], 'CONTROL: served')
  clock.t = t1 - B
  on(M, d); eq(m(), [0, 3], 'back by exactly the tolerance: still served'); assert.strictEqual(S.drops, 0)
  clock.t = t1 - B - 1
  const a = on(M, d)
  eq(m(), [3, 0], 'the wall clock fell back past the tolerance: nothing kept is served'); assert.strictEqual(S.drops, 1)
  eq(a, off(M, d), 'after the fall'); m()
  on(M, d); eq(m(), [0, 3], 'CONTROL: kept again under the clock as it is now'); assert.strictEqual(S.drops, 1)
  // several small falls add up: the measure is the highest reading, not the last one
  const t2 = clock.t
  clock.t = t2 - 600; on(M, d); eq(m(), [0, 3], '600 ms back: inside the tolerance'); assert.strictEqual(S.drops, 1)
  clock.t = t2 - 1200; on(M, d); eq(m(), [3, 0], 'another 600 ms back: 1200 ms under the highest reading'); assert.strictEqual(S.drops, 2)
  // the wall clock stood still while the monotonic one ran on: the same fall, seen however much later the next call comes
  on(M, d); eq(m(), [0, 3], 'CONTROL: kept again')
  clock.m += 5000; clock.t += 3000
  const b = on(M, d); eq(m(), [3, 0], 'the wall clock lost 2 s against the monotonic one'); assert.strictEqual(S.drops, 3)
  eq(b, off(M, d), 'after the second fall'); m()
  // forward is no fall
  clock.t += 3_600_000; on(M, d); eq(m(), [0, 3], 'an hour forward: served'); assert.strictEqual(S.drops, 3)
  eq(M.recCacheSize().facts, 3, 'facts kept')
}
await t('a wall clock that fell back against the monotonic one by more than REC_CLOCK_BACK_MS empties the cache; the answer is the uncached walk\'s', () => scenClockBack(P))

console.log('VERIFIED AGAIN ON THE MONOTONIC CLOCK (r2): A FACT IS SERVED FOR REC_VERIFY_MS + ITS PATH\'S JITTER, NO LONGER')
/** Both clocks on to monotonic time `mono`, together: no call sees the wall clock fall. */
const goTo = (clock, mono) => { clock.t += mono - clock.m; clock.m = mono }
/** THE RESIDUAL (both reviews of r1). A fact is kept; the file is rewritten in place at the same size and -- as the cache is shown
 *  it (the seam's `stat`: a wall clock that fell back and recovered between two calls lets a real ctime repeat) -- with the same
 *  five stat fields; no call sees a clock fall. Inside the fact's verify window the cached answer is the answer from BEFORE the
 *  rewrite; from its deadline on it is the uncached walk's, for good. */
const scenResidual = async M => {
  for (const g of [2, 3]) {                                           // a middle generation (its fact), then the head (its fact and its kept bytes)
    const d = tmp(); byHand(d, 3); await turn()
    const hi = Math.max(...[1, 2, 3].map(i => stampMs(gf(d, i))))
    const clock = handClock(M, hi + 600_000, 3_000_000), m0 = clock.m
    const before = on(M, d); eq(on(M, d), before, 'CONTROL: kept and served')
    const target = gf(d, g), S0 = bstat(target)
    overwrite(target, twin(fs.readFileSync(target)))
    M.recTestSeam({ stat: (p, st) => (p === target ? S0 : st) })
    await turn()
    const plain = off(M, d)
    assert.notDeepStrictEqual(plain, before, 'CONTROL: the rewrite changed nothing'); assert.strictEqual(plain.head.gen, g); assert.strictEqual(plain.head.rec.pad[0], 'q')
    const deadline = m0 + M.REC_VERIFY_MS + M.recVerifyJitter(target)
    for (const at of [m0 + 1, m0 + M.REC_VERIFY_MS - 1, deadline - 1]) {
      goTo(clock, at)
      const a = on(M, d)
      // THE ONLY PLACE THIS FILE TOLERATES A CACHED ANSWER THAT IS NOT THE UNCACHED ONE -- and it is exactly the answer from before
      eq(a, before, `g${g}, ${at - m0} ms after the read: inside the verify window the answer is the one from before the rewrite`)
      assert.notDeepStrictEqual(a, plain, 'CONTROL: the scene is not stale (the test would prove nothing)')
    }
    goTo(clock, deadline)
    eq(on(M, d), plain, `g${g}: at the fact's verify deadline its file is read again`)
    for (let i = 1; i <= 30; i++) { goTo(clock, deadline + i * 9_000); eq(on(M, d), plain, `g${g}: for good (${i * 9} s past the deadline)`) }
    assert.strictEqual(M.recStats.drops, 0, 'CONTROL: no call saw the clock fall')
    M.recTestSeam({ stat: null })
  }
}
await t('THE RESIDUAL -- the one test that tolerates cached != uncached: a rewrite no stat can see is served stale INSIDE its fact\'s verify window only; from the deadline on the cached walk is the uncached walk for good', () => scenResidual(P))
/** An unchanged, long-still history: nothing is read until the first fact's deadline; then each generation is read again exactly
 *  once, in the call its own deadline (the read's monotonic time + REC_VERIFY_MS + its path's jitter) has passed. */
const scenVerify = async M => {
  const d = tmp(), N = 12; byHand(d, N); await turn()
  const hi = Math.max(...Array.from({ length: N }, (_, i) => stampMs(gf(d, i + 1))))
  const clock = handClock(M, hi + 600_000, 5_000_000), m0 = clock.m, m = meter(M)
  const want = on(M, d); eq(m(), [N, 0], 'kept')
  const jit = Array.from({ length: N }, (_, i) => M.recVerifyJitter(gf(d, i + 1)))
  assert.ok(jit.every(j => Number.isInteger(j) && j >= 0 && j < M.REC_VERIFY_JITTER_MS), `the jitter leaves [0, ${M.REC_VERIFY_JITTER_MS}): ${jit}`)
  const due = jit.map(j => m0 + M.REC_VERIFY_MS + j), order = [...new Set(due)].sort((a, b) => a - b)
  assert.ok(order.length >= 2, 'CONTROL: twelve paths, one jitter')
  for (const at of [m0, m0 + 1, m0 + M.REC_VERIFY_MS - 1, order[0] - 1]) { goTo(clock, at); eq(on(M, d), want, 'unchanged'); eq(m(), [0, N], `${at - m0} ms after the read: before the first deadline nothing is read`) }
  let most = 0
  for (const at of order) {
    const n = due.filter(x => x === at).length
    goTo(clock, at)
    eq(on(M, d), want, 'unchanged'); eq(m(), [n, N - n], `${at - m0} ms after the read: exactly the generation(s) whose own deadline this is`)
    eq(on(M, d), want, 'unchanged'); eq(m(), [0, N], `${at - m0} ms after the read, the next call: read again ONCE (the new fact carries the re-read's time)`)
    most = Math.max(most, n)
  }
  assert.ok(most < N, 'the jitter spread nothing: every generation was read again in one call')
  goTo(clock, order.at(-1) + 1); on(M, d); eq(m(), [0, N], 'each generation was read again exactly once')
  // the second round counts from each RE-READ's own time
  const due2 = due.map((x, i) => x + M.REC_VERIFY_MS + jit[i]), first2 = Math.min(...due2)
  goTo(clock, first2 - 1); on(M, d); eq(m(), [0, N], 'before the second round\'s first deadline')
  const n2 = due2.filter(x => x === first2).length
  goTo(clock, first2); eq(on(M, d), off(M, d), 'the second round'); eq(m(), [n2 + N, N - n2], 'the second round\'s first deadline (and the uncached walk\'s reads)')
  assert.strictEqual(M.recStats.drops, 0, 'CONTROL: no call saw the clock fall')
}
await t('an unchanged aged history: 0 reads until the first deadline, then each generation is read again exactly once as its own deadline passes, spread by the per-path jitter', () => scenVerify(P))
/** The deadline is on the MONOTONIC clock: hours of wall clock read nothing again; the monotonic clock past the deadlines does. */
const scenVerifyClock = async M => {
  const d = tmp(), N = 5; byHand(d, N); await turn()
  const hi = Math.max(...Array.from({ length: N }, (_, i) => stampMs(gf(d, i + 1))))
  const clock = handClock(M, hi + 600_000, 2_000_000), m = meter(M)
  on(M, d); eq(m(), [N, 0], 'kept'); on(M, d); eq(m(), [0, N], 'CONTROL: served')
  clock.t += 5 * 3_600_000
  on(M, d); eq(m(), [0, N], 'the wall clock five hours on, the monotonic clock where it was: nothing is read again')
  const all = M.REC_VERIFY_MS + M.REC_VERIFY_JITTER_MS
  clock.t += all; clock.m += all
  on(M, d); eq(m(), [N, 0], 'the monotonic clock past every deadline: every generation is read again')
  on(M, d); eq(m(), [0, N], 'once')
  assert.strictEqual(M.recStats.drops, 0, 'CONTROL: it was the verify age, not the clock check')
}
await t('the verify deadline is on the monotonic clock: the wall clock hours on reads nothing again; the monotonic clock past the deadlines does', () => scenVerifyClock(P))
await t('the jitter is the path\'s own (a hash, no dice): the same for a path every time, spread over [0, REC_VERIFY_JITTER_MS) for a record\'s generations', () => {
  const paths = Array.from({ length: 100 }, (_, i) => `/pool/project-0_70_0.tidy.g${i + 1}.json`)
  const j = paths.map(P.recVerifyJitter)
  eq(paths.map(P.recVerifyJitter), j, 'not the same twice')
  assert.ok(j.every(x => Number.isInteger(x) && x >= 0 && x < P.REC_VERIFY_JITTER_MS))
  assert.ok(new Set(j).size >= 95, `${new Set(j).size} distinct of 100`)
  const sixths = Array.from({ length: 6 }, (_, b) => j.filter(x => Math.floor(x * 6 / P.REC_VERIFY_JITTER_MS) === b).length)
  assert.ok(sixths.every(n => n >= 5 && n <= 35), `not spread: ${sixths} in each sixth of the range`)
  assert.strictEqual(P.REC_VERIFY_MS, 60_000); assert.strictEqual(P.REC_VERIFY_JITTER_MS, 30_000)
})

console.log('NO DECISION ON A CLOCK OLDER THAN THE DECISION (r3): THE CLOCK MOVES DURING ONE CALL')
/** A directory in which generation `first` of `n` has the EARLIEST verify deadline when all are kept in one call (the order of the
 *  deadlines is then the order of the paths' jitters, and a path's jitter is its hash). */
function dirWhereFirst (M, n, first) {
  for (let i = 0; i < 2000; i++) {
    const d = tmp(), j = g => M.recVerifyJitter(gf(d, g))
    if (Array.from({ length: n }, (_, k) => k + 1).every(g => g === first || j(first) < j(g))) return d
    fs.rmdirSync(d)
  }
  assert.fail(`no directory in 2000 gives generation ${first} the earliest deadline of ${n}`)
}
/** THE RESIDUAL FIXTURE: n generations kept in one call at monotonic m0; then generation `g` rewritten in place with other bytes of
 *  the same size and, as the cache is shown it, the same stat (the seam's `stat`, which `seen` may extend). So a SERVED fact of g
 *  answers with the old bytes and only a fresh READ answers as the uncached walk does: "== plain" tells the two apart.
 *  -> { d, clock, m0, before, plain, T, due: g's deadline, S0 } */
async function staleFixture (M, n, g, { first = g, make = byHand, bytes = twin } = {}) {
  const d = dirWhereFirst(M, n, first); make(d, n); await turn()
  const hi = Math.max(...Array.from({ length: n }, (_, i) => stampMs(gf(d, i + 1))))
  const clock = handClock(M, hi + 600_000, 7_000_000), m0 = clock.m
  const before = on(M, d); eq(on(M, d), before, 'CONTROL: kept and served')
  const T = gf(d, g), S0 = bstat(T)
  overwrite(T, bytes(fs.readFileSync(T)))
  M.recTestSeam({ stat: (p, st) => (p === T ? S0 : st) })
  await turn()
  const plain = off(M, d)
  assert.notDeepStrictEqual(plain, before, 'CONTROL: the rewrite changed nothing')
  return { d, clock, m0, before, plain, T, S0, due: m0 + M.REC_VERIFY_MS + M.recVerifyJitter(T) }
}
/** (i) The call enters 1 ms before g2's deadline; g2's own stat is slow and carries the clock to the deadline. Its hit decision is
 *  made on the clock AFTER the stat: the fact is not served, the file is read, in the same walk. */
const scenLateDecision = async M => {
  const f = await staleFixture(M, 3, 2)
  let slow = 0
  M.recTestSeam({ stat: (p, st) => { if (p !== f.T) return st; if (f.clock.m < f.due) { goTo(f.clock, f.due); slow++ } return f.S0 } })
  goTo(f.clock, f.due - 1)
  const m = meter(M), w0 = M.recStats.walks
  const a = on(M, f.d)
  assert.strictEqual(slow, 1, 'CONTROL: the clock did not pass the deadline inside the call')
  eq(a, f.plain, 'the deadline passed after the call began and before the fact\'s own decision')
  eq([...m(), M.recStats.walks - w0], [1, 2, 1], '[reads, hits, walks]: the file is read at its own decision -- no second walk was needed')
  assert.strictEqual(M.recStats.drops, 0)
}
await t('(i) a fact whose deadline passes after the call began but before its own hit decision is read again there and then; the answer is the uncached walk\'s', () => scenLateDecision(P))
/** (ii) g2's stale fact is served early in the walk (1 ms before its deadline); the clock reaches the deadline later in the same
 *  call -- (a) during a later generation's read, (b) while the head's bytes are read again. That walk's answer is not returned. */
const scenLateReturn = async M => {
  { // (a) a new generation g4 is read in this call; the clock passes g2's deadline inside that read
    const f = await staleFixture(M, 3, 2)
    const g3 = fs.readFileSync(gf(f.d, 3))
    linkGen(f.d, 4, { ...BODY(4), gen: 4, prev: 3, prevSha: sha(g3) }); await turn()
    const plain = off(M, f.d)
    assert.strictEqual(plain.head.gen, 2, 'CONTROL: the uncached walk')
    let jumped = 0
    M.recTestSeam({ at: (stage, p) => { if (stage === 'read' && p === gf(f.d, 4) && f.clock.m < f.due) { goTo(f.clock, f.due); jumped++ } } })
    goTo(f.clock, f.due - 1)
    const w0 = M.recStats.walks
    const a = on(M, f.d)
    M.recTestSeam({ at: null })
    assert.strictEqual(jumped, 1, 'CONTROL (a): the clock did not pass the deadline during the later read')
    eq(a, plain, '(a) the deadline of a fact served early passed during a later generation\'s read')
    assert.strictEqual(M.recStats.walks - w0, 2, '(a) the first walk was not returned; the second was')
  }
  { // (b) the head moved back to g3 (its bytes are not kept); the clock passes g2's deadline while they are read again
    const f = await staleFixture(M, 4, 2)
    fs.unlinkSync(gf(f.d, 4)); await turn()
    const plain = off(M, f.d)
    assert.strictEqual(plain.head.gen, 2, 'CONTROL: the uncached walk')
    let jumped = 0
    M.recTestSeam({ at: (stage, p) => { if (stage === 'head' && p === gf(f.d, 3) && f.clock.m < f.due) { goTo(f.clock, f.due); jumped++ } } })
    goTo(f.clock, f.due - 1)
    const w0 = M.recStats.walks
    const a = on(M, f.d)
    M.recTestSeam({ at: null })
    assert.strictEqual(jumped, 1, 'CONTROL (b): the clock did not pass the deadline while the head was materialised')
    eq(a, plain, '(b) the deadline of a fact served early passed while the head\'s bytes were read')
    assert.strictEqual(M.recStats.walks - w0, 2, '(b) the first walk was not returned; the second was')
    assert.strictEqual(M.recStats.drops, 0)
  }
}
await t('(ii) a fact served early in the walk whose deadline passes before the answer is returned (during a later read; while the head is materialised): that walk is not returned, the next one is the uncached walk', () => scenLateReturn(P))
/** (ii, a REJECTED generation) g3's kept fact says "no link" (a wrong prevSha); the file now holds the right one, invisibly to
 *  stat: the uncached walk makes g3 the head. g3's deadline (the earliest) passes just before the answer is returned. */
const scenLateRejected = async M => {
  const wrong = (d, n) => { byHand(d, n - 1); const prevSha = sha(fs.readFileSync(gf(d, n - 1))); linkGen(d, n, { ...BODY(n), gen: n, prev: n - 1, prevSha: 'f'.repeat(64) }); return prevSha }
  let right = null
  const f = await staleFixture(M, 3, 3, { make: (d, n) => { right = wrong(d, n) }, bytes: buf => { const o = Buffer.from(buf.toString('utf8').replace('f'.repeat(64), right)); assert.strictEqual(o.length, buf.length); return o } })
  assert.strictEqual(f.before.head.gen, 2); eq(f.before.rejected, [{ gen: 3, why: 'chain' }], 'CONTROL: the kept fact rejects g3')
  assert.strictEqual(f.plain.head.gen, 3); eq(f.plain.rejected, [], 'CONTROL: the uncached walk links g3')
  let returns = 0
  M.recTestSeam({ at: stage => { if (stage === 'return' && !returns++) goTo(f.clock, f.due) } })
  goTo(f.clock, f.due - 1)
  const w0 = M.recStats.walks
  const a = on(M, f.d)
  M.recTestSeam({ at: null })
  eq(a, f.plain, 'the deadline of a REJECTED generation\'s fact passed before the answer was returned')
  eq([returns, M.recStats.walks - w0], [2, 2], '[answers made ready, walks]')
}
await t('(ii) the same for a generation the walk REJECTED on a kept fact: its deadline passing before the return voids the walk too', () => scenLateRejected(P))
/** (iii) Every walk has the clock reach the next kept fact's deadline just before its answer is returned: three walks are not
 *  returned, then the plain walk answers. No throw, no fourth walk. */
const scenEveryWalk = async M => {
  const f = await staleFixture(M, 3, 2)
  const dues = [1, 2, 3].map(g => f.m0 + M.REC_VERIFY_MS + M.recVerifyJitter(gf(f.d, g))).sort((a, b) => a - b)
  assert.ok(dues[0] < dues[1] && dues[1] < dues[2], 'CONTROL: three generations, three deadlines')
  let returns = 0
  M.recTestSeam({ at: stage => { if (stage === 'return') goTo(f.clock, dues[Math.min(returns++, 2)]) } })
  goTo(f.clock, dues[0] - 1)
  const m = meter(M), w0 = M.recStats.walks
  const a = on(M, f.d)
  M.recTestSeam({ at: null })
  eq([returns, M.recStats.walks - w0], [3, 3], '[answers made ready, walks]: three walks, none returned, no fourth')
  eq(a, f.plain, 'after three walks the plain walk answers')
  // walk 1 serves all three; walks 2 and 3 each read the one that expired and serve two; then the plain walk reads all three
  eq(m(), [2 + 3, 3 + 2 + 2], '[reads, hits]')
  await turn(); eq(on(M, f.d), f.plain, 'the call after'); assert.strictEqual(M.recStats.walks - w0, 4, 'the call after: one walk')
  assert.strictEqual(M.recStats.drops, 0)
}
await t('(iii) the clock reaching a kept fact\'s deadline on EVERY walk: three walks are not returned, then the plain walk answers -- the uncached walk\'s answer, no throw, no loop', () => scenEveryWalk(P))
/** The wall clock falls (seen at g2's decision: the cache is emptied there) AFTER g1's stale fact was served in the same walk: the
 *  walk rests on a fact from before the fall and is not returned. */
const scenFallMidWalk = async M => {
  const f = await staleFixture(M, 3, 1, { first: 3 })
  let fell = 0
  M.recTestSeam({ stat: (p, st) => { if (p === f.T) return f.S0; if (p === gf(f.d, 2) && !fell++) f.clock.t -= M.REC_CLOCK_BACK_MS + 1; return st } })
  goTo(f.clock, f.m0 + 1000)
  const w0 = M.recStats.walks
  const a = on(M, f.d)
  assert.ok(fell >= 1, 'CONTROL: the clock did not fall inside the call'); assert.strictEqual(M.recStats.drops, 1, 'CONTROL: the clock check did not see it')
  eq(a, f.plain, 'a walk that served a fact and then saw the clock fall')
  assert.strictEqual(M.recStats.walks - w0, 2, 'the first walk was not returned; the second was')
}
await t('the clock check emptying the cache in the middle of a walk voids that walk: the next one, on nothing kept before the fall, is the uncached walk', () => scenFallMidWalk(P))
/** (iv) recVerifyOk: inside the window only for an age that is a finite number, not negative, and under a finite window. */
const scenAges = M => {
  const c = { verifiedAt: 1000, verifyFor: 60_000 }
  for (const [mono, want, what] of [[1000, true, 'age 0'], [60_999, true, 'the last ms'], [61_000, false, 'the deadline'], [999, false, 'a negative age'], [-5, false, 'a negative age'],
    [NaN, false, 'NaN'], [Infinity, false, 'Infinity'], [-Infinity, false, '-Infinity']]) assert.strictEqual(M.recVerifyOk(c, mono), want, `mono ${mono}: ${what}`)
  for (const v of [NaN, Infinity, -Infinity]) assert.strictEqual(M.recVerifyOk({ verifiedAt: v, verifyFor: 60_000 }, 2000), false, `verifiedAt ${v}`)
  for (const v of [NaN, Infinity, -Infinity, 0, -1]) assert.strictEqual(M.recVerifyOk({ verifiedAt: 1000, verifyFor: v }, 2000), false, `verifyFor ${v}`)
  assert.strictEqual(M.recVerifyOk({ verifiedAt: 1000, verifyFor: undefined }, 2000), false, 'no window at all')
}
await t('(iv) an age that is negative, NaN or infinite, and a window that is not a finite number, are misses (recVerifyOk)', () => scenAges(P))
/** (iv) on real files: the monotonic clock one ms BEHIND a fact's read, then NaN, then Infinity -- every generation is read, none served. */
const scenOddClock = async M => {
  const d = tmp(), N = 4; byHand(d, N); await turn()
  const hi = Math.max(...Array.from({ length: N }, (_, i) => stampMs(gf(d, i + 1))))
  const clock = handClock(M, hi + 600_000, 5_000_000), m = meter(M)
  const want = on(M, d); eq(m(), [N, 0], 'kept'); on(M, d); eq(m(), [0, N], 'CONTROL: served')
  clock.m -= 1
  eq(on(M, d), want, 'a negative age'); eq(m(), [N, 0], 'the monotonic clock 1 ms behind the read: a negative age is no hit'); assert.strictEqual(M.recStats.drops, 0)
  on(M, d); eq(m(), [0, N], 'CONTROL: kept again at the clock as it is')
  for (const odd of [NaN, Infinity]) {
    clock.m = odd
    const w0 = M.recStats.walks
    for (let i = 0; i < 2; i++) { eq(on(M, d), want, `mono ${odd}`); eq(m(), [N, 0], `mono ${odd}, call ${i}: nothing is served on a clock that is not a number`) }
    assert.strictEqual(M.recStats.walks - w0, 2, `mono ${odd}: one walk a call`)
  }
}
await t('(iv) on real files: a monotonic clock behind the fact\'s read, NaN or infinite serves nothing; every answer is still the uncached walk\'s', () => scenOddClock(P))

console.log('NOTHING SHARED: THE CALLER MAY MUTATE WHAT IT GETS')
/** head.rec, head, rejected and gens are the caller's: wrecking them changes no later call. */
const scenMutate = async M => {
  begin(M)
  const d = tmp(); chain(M, d, 3); linkGen(d, 4, { ...BODY(4), gen: 4, prev: 3, prevSha: 'not it' }); await turn()
  const want = off(M, d)
  assert.strictEqual(want.head.gen, 3); eq(want.rejected, [{ gen: 4, why: 'chain' }], 'CONTROL: the scene')
  const wreck = r => { r.head.rec.cells.push('X'); r.head.rec.zones.a = 'wrecked'; r.head.rec.gen = 77; delete r.head.rec.prevSha; r.head.sha = 'zzz'; r.head.gen = -1; r.rejected[0].why = 'wrecked'; r.rejected.push({ gen: 0, why: 'x' }); r.gens.length = 0 }
  const seen = []
  on(M, d)
  for (let i = 0; i < 4; i++) {
    const m = meter(M)
    const a = on(M, d)
    eq(m(), [0, 4], 'CONTROL: this call was not served from the kept facts and bytes')
    eq(a, want, `call ${i}: an earlier caller's mutation came back`)
    assert.ok(seen.every(o => o !== a.head.rec), 'the same parsed object was handed out twice')
    seen.push(a.head.rec); wreck(a)
  }
  eq(off(M, d), want, 'the uncached walk')
  // recordChain shares nothing with it either
  const ch = M.recordChain(d, KEY); assert.strictEqual(ch.length, 3); ch[2].zones.a = 'chain-wrecked'
  eq(on(M, d), want, 'after a mutated recordChain result')
}
await t('mutating head.rec, head, rejected and gens changes no later call; every call hands out a freshly parsed record', () => scenMutate(P))

console.log('NO KEPT FAILURE: AN UNPARSEABLE OR UNREADABLE FILE IS READ AGAIN EVERY CALL')
const scenUnparseable = async M => {
  begin(M)
  const d = tmp(); chain(M, d, 2)
  const good = Buffer.from(JSON.stringify({ ...BODY(3), gen: 3, prev: 2, prevSha: off(M, d).head.sha }))
  linkGen(d, 3, good.subarray(0, good.length - 7)); await turn()        // a torn write
  on(M, d)
  for (let i = 0; i < 3; i++) {
    const m = meter(M), a = on(M, d)
    eq(a.rejected, [{ gen: 3, why: 'unparseable' }], `call ${i}`); assert.strictEqual(a.head.gen, 2)
    eq(m(), [1, 2], `call ${i}: the unparseable file was not read again (and only it)`)
  }
  eq(on(M, d), off(M, d), 'unparseable')
  await nap(30); fs.writeFileSync(gf(d, 3), good); age(gf(d, 3), 3); await turn()     // fixed in place
  const r = same(M, d, 'the file fixed'); assert.strictEqual(r.head.gen, 3); eq(r.rejected, [], 'rejected')
}
await t('an unparseable generation is read again on every call; fixed, the next call sees it', () => scenUnparseable(P))
const scenUnreadable = async M => {
  begin(M)
  const d = tmp(); chain(M, d, 2)
  fs.mkdirSync(gf(d, 3)); age(gf(d, 3), 3); await turn()                 // EISDIR: unreadable whoever runs this
  on(M, d)
  for (let i = 0; i < 3; i++) {
    const m = meter(M), a = on(M, d)
    eq(a.rejected, [{ gen: 3, why: 'unreadable' }], `call ${i}`); assert.strictEqual(a.head.gen, 2)
    eq(m(), [1, 2], `call ${i}: the unreadable file was not tried again (and only it)`)
  }
  eq(on(M, d), off(M, d), 'unreadable')
  fs.rmdirSync(gf(d, 3)); linkGen(d, 3, { ...BODY(3), gen: 3, prev: 2, prevSha: off(M, d).head.sha }); await turn()
  const r = same(M, d, 'a file there now'); assert.strictEqual(r.head.gen, 3); eq(r.rejected, [], 'rejected')
}
await t('an unreadable generation is tried again on every call; readable, the next call sees it', () => scenUnreadable(P))
await t('a generation without read permission (chmod 000) is tried again on every call; chmod back, the next call sees it', async () => {
  if (ROOT_USER) { note('chmod 000 test: SKIPPED (running as root)'); return }
  begin(P)
  const d = tmp(); chain(P, d, 3); await turn()
  on(P, d); await nap(30); fs.chmodSync(gf(d, 2), 0o000)
  let denied = false; try { fs.readFileSync(gf(d, 2)) } catch { denied = true }
  if (!denied) { fs.chmodSync(gf(d, 2), 0o644); note('chmod 000 test: SKIPPED (the filesystem ignores the mode)'); return }
  await turn()
  for (let i = 0; i < 4; i++) {
    const m = meter(P), a = on(P, d)
    assert.strictEqual(a.head.gen, 1); eq(a.rejected, [{ gen: 2, why: 'unreadable' }, { gen: 3, why: 'chain' }], `call ${i}`)
    // the first call also reads the bytes of the head it fell back to (g1: kept as a fact, its bytes never kept)
    eq(m()[0], i === 0 ? 2 : 1, `call ${i}: the unreadable file is tried again (and only it)`)
  }
  eq(on(P, d), off(P, d), 'chmod 000')
  await nap(30); fs.chmodSync(gf(d, 2), 0o644); await turn()
  assert.strictEqual(same(P, d, 'chmod back').head.gen, 3)
})

console.log('BOUNDS: THE KEPT FACTS AND THE KEPT HEAD BYTES')
const FACTS_6 = ['export const REC_FACTS_MAX = 8192', 'export const REC_FACTS_MAX = 6']
const HEADS_2 = ['export const REC_HEADS_MAX = 64', 'export const REC_HEADS_MAX = 2']
await t('at most REC_FACTS_MAX facts (least recently used out first) and REC_HEADS_MAX head Buffers; past them the walk is still the uncached walk', async () => {
  assert.ok(P.REC_FACTS_MAX >= 1024 && P.REC_HEADS_MAX >= 31, 'the live pool: 435 generation files, 31 records')
  await withMutants(PROJ_URL, [FACTS_6, HEADS_2], async M => {
    begin(M)
    const d = tmp(), keys = ['a', 'b', 'c', 'd'].map(pl => M.projKey({ x: 0, y: 70, z: 0 }, pl))
    for (const k of keys) chain(M, d, 5, k)
    await turn(); M.recCacheReset()
    for (const k of keys) { same(M, d, `record ${k}`, k); const z = M.recCacheSize(); assert.ok(z.facts <= 6 && z.heads <= 2, JSON.stringify(z)) }
    eq(M.recCacheSize().facts, 6, 'CONTROL: the bound was reached')
    const m = meter(M); on(M, d, keys[3])
    eq(m(), [0, 5], 'the record used last was pushed out')
    same(M, d, 'the record used first', keys[0])
    assert.ok(m()[0] >= 5, 'CONTROL: the record used first was still kept (the bound is not biting)')
  })
})
/** Three records, two head Buffers: the one USED last stays, whichever was READ first. */
const scenHeadLru = async M => {
  begin(M)
  const d = tmp(), [a, b, c] = ['a', 'b', 'c'].map(pl => M.projKey({ x: 0, y: 70, z: 0 }, pl))
  for (const k of [a, b, c]) chain(M, d, 3, k)
  await turn(); M.recCacheReset()
  const m = meter(M)
  on(M, d, a); on(M, d, b); eq(m(), [6, 0], 'two records read, their head bytes kept'); eq(M.recCacheSize().heads, 2, 'heads')
  on(M, d, a); eq(m(), [0, 3], 'CONTROL: the first record is served, bytes and all')
  on(M, d, c); eq(m(), [3, 0], 'a third record'); eq(M.recCacheSize().heads, 2, 'heads')
  on(M, d, a); eq(m(), [0, 3], 'the head bytes used last were pushed out by the third record')
  on(M, d, b); eq(m(), [1, 3], 'CONTROL: the bound bit -- the record not used since had its head bytes read again')
}
await t('the head Buffers go least recently USED first: a served head is refreshed', () => withMutants(PROJ_URL, [HEADS_2], scenHeadLru))
await t('a head too big for REC_HEAD_BYTES_MAX is not kept: its file is read again each call and must hash to its fact', async () => {
  await withMutants(PROJ_URL, [['export const REC_HEAD_BYTES_MAX = 32 * 1024 * 1024', 'export const REC_HEAD_BYTES_MAX = 16']], async M => {
    begin(M)
    const d = tmp(); chain(M, d, 4); await turn()
    on(M, d)
    for (let i = 0; i < 3; i++) { const m = meter(M); const a = on(M, d); eq(m(), [1, 4], 'only the head is read again'); eq(a, off(M, d), `call ${i}`) }
    eq(M.recCacheSize(), { facts: 4, heads: 0, headBytes: 0 }, 'kept')
  })
})

console.log('MUTANTS (each anchor present and unique; each killed by the test named)')
await t('MUTANT the inode dropped from the key -> "a kept fact answers only for the SAME device, inode..." (and the two-inode directory swap, where reached)', async () => {
  const pair = [['c.dev === st.dev && c.ino === st.ino && c.size === st.size', 'c.dev === st.dev && c.size === st.size']]
  await killedBy(pair, scenFresh)
  let real = 'not reached'
  if (twinsReached) {
    let why = null, reached = null
    await withMutants(PROJ_URL, pair, async M => { try { reached = await scenTwins(M) } catch (e) { why = e } })
    if (reached !== false) { assert.ok(why instanceof assert.AssertionError, `the mutant survived the directory swap: ${why?.stack?.split('\n')[0] ?? 'survived'}`); real = 'yes' }
  }
  note(`the inode mutant killed on real files by the two-inode directory swap: ${real}`)
})
await t('MUTANT the device dropped from the key -> "a kept fact answers only for the SAME device, inode..."', () =>
  killedBy([['!!c && !!st && c.dev === st.dev && c.ino === st.ino', '!!c && !!st && c.ino === st.ino']], scenFresh))
await t('MUTANT the ctime dropped from the key -> "a generation rewritten IN PLACE with its mtime restored..."', () =>
  killedBy([['c.mtimeNs === st.mtimeNs && c.ctimeNs === st.ctimeNs', 'c.mtimeNs === st.mtimeNs']], scenInPlace))
await t('MUTANT an unparseable file kept -> "an unparseable generation is read again on every call..."', () =>
  killedBy([["catch { return { why: 'unparseable' } }", "catch { return recKeep(p, f0, f1, { why: 'unparseable' }, now, mono) }"]], scenUnparseable))
await t('MUTANT a failed read kept -> "an unreadable generation is tried again on every call..."', () =>
  killedBy([["  } catch { return { why: 'unreadable' } }", "  } catch { const fx = recStat(p); return recKeep(p, fx, fx, { why: 'unreadable' }, now, mono) }"]], scenUnreadable))
await t('MUTANT the parsed head kept and handed out again (no fresh parse) -> "mutating head.rec, head, rejected and gens changes no later call..."', () =>
  killedBy([["recHeads.set(hk, hb); return JSON.parse(hb.buf.toString('utf8')) }", "recHeads.set(hk, hb); return (hb.rec ??= JSON.parse(hb.buf.toString('utf8'))) }"]], scenMutate))
await t('MUTANT the racy rule skipped when a fact is KEPT -> "a generation is read on every call until the clock is REC_RACY_MS past its stamp..."', () =>
  killedBy([['if (!recFactFresh(f0, f1) || recRacy(f1, now)) return fact', 'if (!recFactFresh(f0, f1)) return fact']], scenRacy))
await t('MUTANT (r1 A) the racy rule skipped when a fact is SERVED -> "a kept fact is NOT served while its file reads racily clean..."', () =>
  killedBy([['recFactFresh(c, st0) && !recRacyMs(c.stampMs, now) && recVerifyOk', 'recFactFresh(c, st0) && recVerifyOk']], scenRacyHit))
await t('MUTANT (r1 A) a clock that fell back is not noticed -> "a wall clock that fell back against the monotonic one..."', () =>
  killedBy([['if (recClockBack(recOffsetMax, offset)) {', 'if (false) {']], scenClockBack))
await t('MUTANT (r1 A) the fall measured from the last reading, not the highest -> "a wall clock that fell back against the monotonic one..."', () =>
  killedBy([['else if (recOffsetMax == null || offset > recOffsetMax) recOffsetMax = offset', 'else recOffsetMax = offset']], scenClockBack))
await t('MUTANT a kept fact trusted without the stat -> "a generation replaced by rename with other bytes of the SAME size and mtime..."', () =>
  killedBy([['if (c && recFactFresh(c, st0) && !recRacyMs(c.stampMs, now)', 'if (c && !recRacyMs(c.stampMs, now)']], scenReplaced))
await t('MUTANT the prevSha check skipped for a kept fact -> "a generation replaced by rename with other bytes of the SAME size and mtime..."', () =>
  killedBy([['if (e.prev !== head.gen || e.prevSha !== head.e.sha)', 'if (e.prev !== head.gen || (e.buf && e.prevSha !== head.e.sha))']], scenReplaced))
await t('MUTANT (r1 B) the two stats taken by PATH again -> "a directory swapped away and back around one read..."', () =>
  killedBy([['f0 = recFstat(fd, p)', 'f0 = recStat(p)'], ['f1 = recFstat(fd, p)', 'f1 = recStat(p)']], scenSwap))
await t('MUTANT (r1 B) the read made by PATH again -> "a directory swapped away and back around one read..."', () =>
  killedBy([['buf = fs.readFileSync(fd)', 'buf = fs.readFileSync(p)']], scenSwap))
await t('MUTANT (r1 B) the stat before and the stat after not compared -> "a file rewritten between the stat before its read and the stat after it..."', () =>
  killedBy([['if (!recFactFresh(f0, f1) || recRacy(f1, now)) return fact', 'if (!f1 || recRacy(f1, now)) return fact']], scenBetweenStats))
await t('MUTANT (r2) the verify age dropped from the hit -> "THE RESIDUAL..." and "an unchanged aged history: 0 reads until the first deadline..."', async () => {
  const pair = [['!recRacyMs(c.stampMs, now) && recVerifyOk(c, mono)) {', '!recRacyMs(c.stampMs, now)) {']]
  await killedBy(pair, scenResidual); await killedBy(pair, scenVerify)
})
await t('MUTANT (r2) the stamp taken from the wall clock -> "the verify deadline is on the monotonic clock..."', () =>
  killedBy([['verifiedAt: mono,', 'verifiedAt: now,']], scenVerifyClock))
await t('MUTANT (r2) the stamp and the age both on the wall clock -> "the verify deadline is on the monotonic clock..."', () =>
  killedBy([['verifiedAt: mono,', 'verifiedAt: now,'], ['&& recVerifyOk(c, mono)) {', '&& recVerifyOk(c, now)) {']], scenVerifyClock))
await t('MUTANT (r2) the stamp not refreshed by a re-read (read again on every call for ever) -> "an unchanged aged history: 0 reads until the first deadline..."', () =>
  killedBy([['sha: sha(buf), rec, buf }, now, mono)', 'sha: sha(buf), rec, buf }, now, c ? c.verifiedAt : mono)']], scenVerify))
await t('MUTANT (r2) the jitter removed (every generation read again in one call) -> "an unchanged aged history: 0 reads until the first deadline..."', () =>
  killedBy([['verifyFor: REC_VERIFY_MS + recVerifyJitter(p),', 'verifyFor: REC_VERIFY_MS,']], scenVerify))
await t('MUTANT (r3) the hit decided on the walk\'s entry clock, not its own -> "(i) a fact whose deadline passes after the call began but before its own hit decision..."', () =>
  killedBy([['const st0 = recStat(p)\n  recClockTick()', 'const st0 = recStat(p)']], scenLateDecision))
await t('MUTANT (r3) the check before the answer is returned removed -> "(ii) a fact served early in the walk whose deadline passes before the answer is returned..."', async () => {
  const pair = [['  if (reused && !(recMono >= since && recMono < due)) return null\n', '']]
  await killedBy(pair, scenLateReturn); await killedBy(pair, scenEveryWalk)
})
await t('MUTANT (r3) the earliest deadline taken over the generations the walk ACCEPTED only -> "(ii) the same for a generation the walk REJECTED..."', () =>
  killedBy([['if (e.verifyFor !== undefined) {', 'if (e.verifyFor !== undefined && e.recGen === g && (head ? e.prev === head.gen && e.prevSha === head.e.sha : e.prev === null)) {']], scenLateRejected))
await t('MUTANT (r3) a negative age read as fresh -> "(iv) an age that is negative, NaN or infinite..." and "(iv) on real files..."', async () => {
  const pair = [['return age >= 0 && age < c.verifyFor', 'return age < c.verifyFor']]
  await killedBy(pair, scenAges); await killedBy(pair, scenOddClock)
})
await t('MUTANT (r3) a window that is not a finite number accepted -> "(iv) an age that is negative, NaN or infinite..."', () =>
  killedBy([['age < c.verifyFor && Number.isFinite(c.verifyFor)', 'age < c.verifyFor']], scenAges))
await t('MUTANT (r3) a clock fall seen in the middle of a walk does not void it -> "the clock check emptying the cache in the middle of a walk..."', () =>
  killedBy([['  if (recEpoch !== epoch) return null\n', '']], scenFallMidWalk))
await t('MUTANT the head\'s re-read bytes not checked against the fact\'s sha -> "the head moved back and its file is no longer the bytes..."', () =>
  killedBy([['  if (sha(buf) !== e.sha) { recFacts.delete(p); return undefined }\n', '']], scenHeadReread))
await t('MUTANT a served head Buffer not refreshed (first in, first out) -> "the head Buffers go least recently USED first..."', () =>
  killedBy([["{ recHeads.delete(hk); recHeads.set(hk, hb); return JSON.parse(hb.buf.toString('utf8')) }", "{ return JSON.parse(hb.buf.toString('utf8')) }"]], scenHeadLru, [HEADS_2]))

console.log('MICRO-BENCHMARK (printed, never asserted): 100 generations of ~100 KB, rounds of 20 calls')
await t('the cached walk against the uncached walk on a tidy-sized record', async () => {
  begin(P)
  const d = tmp(), N = 100, CALLS = 20
  let prevSha = null, bytes = 0
  for (let g = 1; g <= N; g++) {
    const cells = Array.from({ length: 3600 }, (_, i) => [i + g, 64, i % 97, 'cobblestone'])
    const buf = Buffer.from(JSON.stringify({ v: 1, plot: 'tidy', cells, gen: g, prev: g === 1 ? null : g - 1, prevSha, at: g, by: 'bench' }))
    fs.writeFileSync(gf(d, g), buf); age(gf(d, g), g); prevSha = sha(buf); bytes += buf.length
  }
  await turn()
  // ms a call, one figure a round of CALLS calls, lowest first (a loaded host and the collector make single rounds noisy)
  let last
  const rounds = (n, fn) => Array.from({ length: n }, () => { const a = performance.now(); for (let i = 0; i < CALLS; i++) last = fn(); return (performance.now() - a) / CALLS }).sort((x, y) => x - y)
  const offR = rounds(3, () => off(P, d)), want = last
  P.recCacheReset()
  const c0 = performance.now(); on(P, d); const coldMs = performance.now() - c0
  const m = meter(P)
  const onR = rounds(7, () => on(P, d)), got = last
  const counted = m()
  assert.strictEqual(got.head.gen, N); assert.strictEqual(got.head.sha, want.head.sha); assert.strictEqual(got.head.sha, prevSha); eq(got.rejected, [], 'rejected')
  eq(counted, [0, N * CALLS * 7], 'the timed cached calls read generation files')
  // what a served call is made of: the stats, and the one parse of the head
  const st0 = performance.now(); for (let i = 0; i < CALLS; i++) for (let g = 1; g <= N; g++) bstat(gf(d, g)); const statMs = (performance.now() - st0) / CALLS
  const headBuf = fs.readFileSync(gf(d, N)); const p0 = performance.now(); for (let i = 0; i < CALLS; i++) JSON.parse(headBuf.toString('utf8')); const parseMs = (performance.now() - p0) / CALLS
  note(`benchmark: ${N} generations, ${(bytes / 1e6).toFixed(1)} MB (${Math.round(bytes / N / 1000)} KB each), rounds of ${CALLS} calls, ms a call, lowest round first`)
  note(`benchmark: uncached (RECCACHE=off) ${offR.map(x => x.toFixed(2)).join(' / ')}`)
  note(`benchmark: cached, the first call (opens, fstats and reads all ${N}) ${coldMs.toFixed(1)} ms`)
  note(`benchmark: cached ${onR.map(x => x.toFixed(3)).join(' / ')} (0 generation files read; ${(offR[0] / onR[0]).toFixed(0)}x on the best rounds)`)
  note(`benchmark: of which ${N} stats ${statMs.toFixed(3)} ms and one parse of the head ${parseMs.toFixed(3)} ms, measured alone`)
  // r3: both clocks are sampled at every generation's decision
  let sink = 0
  const k0 = performance.now(); for (let i = 0; i < CALLS * 50; i++) for (let g = 0; g < N; g++) sink += performance.now() - Date.now(); const clockMs = (performance.now() - k0) / (CALLS * 50)
  assert.ok(Number.isFinite(sink))
  note(`benchmark: the clock samples, measured alone: ${N} x (performance.now() + Date.now()) = ${clockMs.toFixed(4)} ms a call (${(clockMs / N * 1e6).toFixed(0)} ns a generation)`)
  // the verify re-reads: both clocks past every deadline -> one call reads every generation again; amortised, each generation is
  // read once every REC_VERIFY_MS + half the jitter
  let bump = 0
  P.recTestSeam({ now: () => Date.now() + AHEAD_MS + bump, mono: () => MONO0 + bump })
  on(P, d); m()
  bump = P.REC_VERIFY_MS + P.REC_VERIFY_JITTER_MS
  const v0 = performance.now(); on(P, d); const verifyMs = performance.now() - v0
  eq(m(), [N, 0], 'CONTROL: the verify pass did not read every generation again'); assert.strictEqual(P.recStats.drops, 0)
  const everyS = (P.REC_VERIFY_MS + P.REC_VERIFY_JITTER_MS / 2) / 1000, perMin = N * 60 / everyS, perRead = verifyMs / N
  note(`benchmark: verify re-reads, amortised: ${N} generations, each read again every ${everyS} s on average = ${perMin.toFixed(0)} reads a minute x ${perRead.toFixed(3)} ms a read = ${(perMin * perRead).toFixed(1)} ms a minute (${(perMin * perRead / 600).toFixed(3)}% of one core)`)
  fs.rmSync(d, { recursive: true, force: true })
})

P.recTestSeam(null)
console.log(`\nNOTES (what depended on this host):\n${notes.map(s => `  ${s}`).join('\n')}`)
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
