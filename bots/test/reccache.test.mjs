// RECCACHE-01 (docs/reports/keeperstall-2026-11-10.md, piece 3). LIVE showcase 11-10, the keeper's CPU profile: recordHead was 35% of a
// bot's busy CPU, one shopActive pass 7-10 s of synchronous record reading -- every call read, parsed and hashed EVERY generation file
// (435 files, 35 MB). buildproj.mjs now keeps PER-FILE FACTS (what one read generation says, under the stat it was read with) and makes
// the walk again on every call. What this file holds it to, on REAL files in REAL temp directories:
//   EQUIVALENCE   after every step of a scripted history the cached walk (asked twice: the read and the served repeat) deep-equals the
//                 walk with RECCACHE=off -- publishes, a foreign generation, a broken chain, a wrong gen, an unparseable file, a middle
//                 generation and the root removed, a same-size replacement by rename, an in-place rewrite with its mtime restored, an
//                 unreadable file, the head moving back.
//   COUNTERS      an unchanged history that is not racily clean reads 0 generation files; a publish reads exactly the new one.
//   RACY          a just-written file is read on every call until it is older than REC_RACY_MS.
//   NOTHING SHARED  the caller may mutate head.rec, rejected and gens.
//   NO KEPT FAILURE  an unreadable or unparseable file is read again on every call.
//   RECCACHE=off  every file read on every call, nothing kept.
// THE CLOCK. A file's ctime cannot be set, so a fixture is racily clean for REC_RACY_MS after it is made. The cached calls here pass
// `now` 10 s ahead (recordHead's third argument: the racy rule's clock) instead of sleeping for seconds. That defeats the racy rule
// on purpose, so every step that changes a file IN PLACE (same inode) first waits 30 ms and then PROVES the ctime moved.
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
/** The scenario passes on the real module and fails ITS OWN ASSERTION on the mutant (a throw of another kind is not a kill). */
async function killedBy (pairs, scenario) {
  await scenario(P)
  let why = null
  await withMutants(PROJ_URL, pairs, async M => { try { await scenario(M) } catch (e) { why = e } })
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
const T0 = 1_700_000_000                                              // whole seconds: utimesSync restores such an mtime exactly
const age = (f, n = 0) => fs.utimesSync(f, T0 + n, T0 + n)
const AHEAD_MS = 10_000
/** The cached walk, its racy clock 10 s ahead (every fixture reads as long still). */
const on = (M, d, key = KEY) => M.recordHead(d, key, { now: Date.now() + AHEAD_MS })
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
/** Other bytes of the SAME size that still parse (one letter of the pad). */
const twin = buf => { const s = buf.toString('utf8'), o = s.replace('"pad":"p', '"pad":"q'); assert.notStrictEqual(o, s); assert.strictEqual(Buffer.byteLength(o), buf.length); return Buffer.from(o) }
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
  const fd = fs.openSync(f, 'r+')
  try { fs.writeSync(fd, bytes, 0, bytes.length, 0); fs.fsyncSync(fd) } finally { fs.closeSync(fd) }
  fs.utimesSync(f, Number(st.mtimeNs / 1_000_000_000n), Number(st.mtimeNs / 1_000_000_000n))
  const now = bstat(f)
  assert.strictEqual(now.ino, st.ino, 'CONTROL: not the same inode'); assert.strictEqual(now.size, st.size, 'CONTROL: the size moved')
  assert.strictEqual(now.mtimeNs, st.mtimeNs, 'CONTROL: the mtime was not restored')
  assert.notStrictEqual(now.ctimeNs, st.ctimeNs, 'CONTROL: the ctime did not move')
}

console.log('RECCACHE-01: THE SWITCH AND THE TWO DECISIONS')
await t('the switch: RECCACHE=off|0|false|no is the rollback; unset is on; the racy window is 2 s', () => {
  for (const v of ['off', 'OFF', ' 0', 'false', 'no']) assert.strictEqual(P.recCacheOn({ RECCACHE: v }), false, v)
  for (const v of [undefined, '', 'on', '1']) assert.strictEqual(P.recCacheOn({ RECCACHE: v }), true, String(v))
  assert.strictEqual(P.REC_RACY_MS, 2000)
})
/** recFactFresh on a REAL file's stat: the fact answers only for the same inode, size, mtime and ctime, and only for a stat. */
const scenFresh = M => {
  const d = tmp(); fs.writeFileSync(path.join(d, 'f'), 'x')
  const st = bstat(path.join(d, 'f'))
  const c = { ino: st.ino, size: st.size, mtimeNs: st.mtimeNs, ctimeNs: st.ctimeNs, recGen: 1, prev: null, prevSha: null, sha: 'x' }
  assert.strictEqual(M.recFactFresh(c, st), true, 'CONTROL: a fact read under this very stat is not served')
  for (const k of ['ino', 'size', 'mtimeNs', 'ctimeNs']) assert.strictEqual(M.recFactFresh({ ...c, [k]: c[k] + 1n }, st), false, `another ${k} was served`)
  assert.strictEqual(M.recFactFresh(c, null), false, 'a failed stat was served'); assert.strictEqual(M.recFactFresh(undefined, st), false)
}
await t('a kept fact answers only for the SAME inode, size, mtime and ctime, and never for a failed stat (recFactFresh)', () => scenFresh(P))
await t('racily clean (recRacy): mtime OR ctime within the window, or stamped in the future; both long still is clean', () => {
  const now = 1_800_000_000_000, ns = ms => BigInt(ms) * 1_000_000n
  assert.strictEqual(P.recRacy({ mtimeNs: ns(now - 60_000), ctimeNs: ns(now - 60_000) }, now), false)
  assert.strictEqual(P.recRacy({ mtimeNs: ns(now - 60_000), ctimeNs: ns(now - 100) }, now), true, 'a recent ctime under an old mtime (utimes)')
  assert.strictEqual(P.recRacy({ mtimeNs: ns(now - 100), ctimeNs: ns(now - 60_000) }, now), true)
  assert.strictEqual(P.recRacy({ mtimeNs: ns(now + 3_600_000), ctimeNs: ns(now - 60_000) }, now), true, 'a future stamp')
  assert.strictEqual(P.recRacy({ mtimeNs: ns(now - P.REC_RACY_MS), ctimeNs: ns(now - P.REC_RACY_MS) }, now), false, 'exactly the window: still')
  assert.strictEqual(P.recRacy({ mtimeNs: ns(now - P.REC_RACY_MS + 1), ctimeNs: ns(now - 60_000) }, now), true)
})

console.log('EQUIVALENCE: THE CACHED WALK IS THE UNCACHED WALK, AFTER EVERY STEP')
await t('a scripted history: publishes, a foreign generation, chain / gen / unparseable rejections, a middle generation and the root removed and put back, a same-size replacement by rename, an in-place rewrite with its mtime restored, an unreadable file, the head moving back', async () => {
  P.recCacheReset()
  const d = tmp()
  let n = 0
  const step = async (label, fn, check) => { await fn?.(); await turn(); const r = same(P, d, `step ${++n} (${label})`); check?.(r); return r }
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
  note(`history, chmod 000 step: ${chmodSeen ? 'run' : 'SKIPPED (running as root, or the filesystem ignores the mode)'}`)
  // the head moves BACK to a generation that was not read in this call: its bytes are read again and checked against its fact
  await turn(); on(P, d)
  fs.unlinkSync(gf(d, 11)); await turn()
  let r0 = P.recStats.reads
  const moved = on(P, d)
  assert.strictEqual(P.recStats.reads - r0, 2, 'the head moved back: the unparseable g8 (never kept) and the new head\'s bytes, nothing else')
  r0 = P.recStats.reads
  const plain = off(P, d)
  assert.strictEqual(P.recStats.reads - r0, 10, 'CONTROL: the uncached walk reads all ten generations')
  eq(moved, plain, 'the head moved back'); assert.strictEqual(moved.head.gen, 10)
  r0 = P.recStats.reads
  eq(on(P, d), plain, 'the head moved back, served'); assert.strictEqual(P.recStats.reads - r0, 1, 'the new head\'s bytes are kept now: only g8 is read')
  // POSITIVE CONTROL: the history was really served from kept facts, not read afresh every time
  assert.ok(P.recStats.hits > 100, `the cached walk served ${P.recStats.hits} facts over the history`)
  // a directory that cannot be listed is ok: false either way
  const notdir = path.join(d, 'a-file'); fs.writeFileSync(notdir, 'x')
  eq(on(P, notdir), off(P, notdir), 'not a directory'); assert.strictEqual(on(P, notdir).ok, false)
})
await t('odd bodies are judged alike: null, a number, a string, an array, an object for gen / prev / prevSha, a second root', async () => {
  P.recCacheReset()
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
  M.recCacheReset()
  const d = tmp(); chain(M, d, 4); await turn()
  on(M, d); const r0 = M.recStats.reads; on(M, d)
  assert.strictEqual(M.recStats.reads - r0, 0, 'CONTROL: the four generations were not kept before the replacement')
  replaceByRename(gf(d, 2), twin(fs.readFileSync(gf(d, 2)))); await turn()
  const r = same(M, d, 'replaced by rename')
  assert.strictEqual(r.head.gen, 2); assert.strictEqual(r.head.rec.pad[0], 'q'); eq(r.rejected, [{ gen: 3, why: 'chain' }, { gen: 4, why: 'chain' }], 'rejected')
}
await t('a generation replaced by rename with other bytes of the SAME size and mtime: the replacement is the head, the kept later generations are no link', () => scenReplaced(P))
/** The same, in place: the same inode, size and mtime -- only the ctime moved. */
const scenInPlace = async M => {
  M.recCacheReset()
  const d = tmp(); chain(M, d, 4); await turn()
  on(M, d); const r0 = M.recStats.reads; on(M, d)
  assert.strictEqual(M.recStats.reads - r0, 0, 'CONTROL: the four generations were not kept before the rewrite')
  await rewriteInPlace(gf(d, 3), twin(fs.readFileSync(gf(d, 3)))); await turn()
  const r = same(M, d, 'rewritten in place')
  assert.strictEqual(r.head.gen, 3); assert.strictEqual(r.head.rec.pad[0], 'q'); eq(r.rejected, [{ gen: 4, why: 'chain' }], 'rejected')
}
await t('a generation rewritten IN PLACE with its mtime restored (the same inode, size, mtime; the ctime moved) is read again', () => scenInPlace(P))
/** TWO INODES, ONE STAT. Two directories hold the same record but for g2's bytes; the two g2 files are stamped back to back so the
 *  kernel's coarse clock gives them the same ctime (and mtime, and size). The directories are then swapped by rename (which touches
 *  no file's ctime): the path's file differs from the kept fact ONLY by its inode. -> false when the filesystem would not give it. */
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
  M.recCacheReset()
  const tw = twins()
  if (!tw) return false
  const live = path.join(tw.base, 'live')
  fs.renameSync(tw.A, live); await turn()
  assert.strictEqual(same(M, live, 'twin A').head.rec.tag, 'AAAA')
  const r0 = M.recStats.reads; on(M, live); assert.strictEqual(M.recStats.reads - r0, 0, 'CONTROL: twin A was not kept')
  fs.renameSync(live, path.join(tw.base, 'old')); fs.renameSync(tw.B, live); await turn()
  assert.strictEqual(same(M, live, 'twin B under the same path, the same size, mtime and ctime').head.rec.tag, 'BBBB')
  return true
}
let twinsReached = false
await t('two inodes with ONE size, mtime and ctime under the same path (a directory swap): the other inode is read', async () => {
  twinsReached = await scenTwins(P)
  note(`two inodes, one stat: ${twinsReached ? 'REACHED' : 'NOT REACHED on this filesystem (fine-grained ctime); recFactFresh covers the inode'}`)
})
/** The kept head's bytes are gone (the head moved back) and the file is no longer the bytes its fact was read from, with a stat that
 *  did not move (an in-place rewrite inside the ctime's tick, which only the test's 10-s-ahead clock lets a fact survive): the
 *  re-read does not hash to the fact, the fact is dropped and the walk is made again. -> false when the ctime moved every time. */
const scenHeadMoved = async M => {
  for (let i = 0; i < 200; i++) {
    M.recCacheReset()
    const d = tmp()
    let ps = null
    for (let g = 1; g <= 5; g++) { const buf = Buffer.from(JSON.stringify({ ...BODY(g), gen: g, prev: g === 1 ? null : g - 1, prevSha: ps })); fs.writeFileSync(gf(d, g), buf); age(gf(d, g), g); ps = sha(buf) }
    const f = gf(d, 4), other = twin(fs.readFileSync(f))
    age(f, 4); on(M, d); fs.unlinkSync(gf(d, 5))                       // every fact kept; the kept bytes are g5's
    const st = bstat(f), fd = fs.openSync(f, 'r+')
    try { fs.writeSync(fd, other, 0, other.length, 0) } finally { fs.closeSync(fd) }
    age(f, 4)
    const now = bstat(f)
    if (!(now.ino === st.ino && now.size === st.size && now.mtimeNs === st.mtimeNs && now.ctimeNs === st.ctimeNs)) { fs.rmSync(d, { recursive: true, force: true }); continue }
    M.dropListings()
    const r0 = M.recStats.reads
    const a = on(M, d), reads = M.recStats.reads - r0
    eq(a, off(M, d), 'the head re-read under a stale fact')
    assert.strictEqual(a.head.gen, 4); assert.strictEqual(a.head.rec.pad[0], 'q')
    assert.strictEqual(reads, 2, 'the re-read that did not hash to the fact, then the fresh read of the walk made again')
    return true
  }
  return false
}
await t('the head moved back and its file is not the bytes its fact was read from: the fact is dropped, the walk made again', async () => {
  const reached = await scenHeadMoved(P)
  note(`the head's stale fact (a rewrite inside one ctime tick): ${reached ? 'REACHED' : 'NOT REACHED on this filesystem (the ctime moved every time): the drop-and-walk-again path did not run'}`)
})

console.log('COUNTERS: WHAT A CALL READS')
/** An unchanged history that is not racily clean reads nothing; a publish reads exactly the new generation. */
const scenCounters = async M => {
  M.recCacheReset()
  const d = tmp(); chain(M, d, 5); await turn()
  const S = M.recStats
  let r = S.reads, h = S.hits
  const d1 = () => { const x = [S.reads - r, S.hits - h]; r = S.reads; h = S.hits; return x }
  on(M, d); eq(d1(), [5, 0], 'the first walk reads every generation')
  for (let i = 0; i < 3; i++) { const a = on(M, d); eq(d1(), [0, 5], `repeat ${i}: an unchanged history reads no generation file`); assert.strictEqual(a.head.gen, 5) }
  assert.strictEqual(M.recordHead(d, KEY).head.gen, 5); eq(d1(), [0, 5], 'the caller\'s own clock: kept facts are served')
  assert.strictEqual(M.recordHead(d, KEY, null).head.gen, 5); d1()
  const p = M.publishRecord(d, KEY, rec => ({ ...rec, n: 6 }))
  assert.strictEqual(p.result, 'accepted'); assert.strictEqual(p.gen, 6); assert.strictEqual(p.head.rec.n, 6)
  eq(d1(), [1, 10], 'a publish on a kept history reads only the generation it linked')
  await turn()
  on(M, d); eq(d1(), [1, 5], 'after the publish exactly the new generation is read')
  const a = on(M, d); eq(d1(), [0, 6], 'and then none'); assert.strictEqual(a.head.gen, 6); assert.strictEqual(a.head.rec.n, 6)
  eq(a, off(M, d), 'the served walk'); eq(d1(), [6, 0], 'CONTROL: the uncached walk reads every generation')
  assert.deepStrictEqual(M.recCacheSize().facts, 6); assert.strictEqual(M.recCacheSize().heads, 1)
}
await t('an unchanged history that is not racily clean reads 0 generation files; a publish, and the call after it, read exactly the new one', () => scenCounters(P))
await t('RECCACHE=off: every generation read on every call, nothing served, nothing kept', async () => {
  P.recCacheReset()
  const d = tmp(); chain(P, d, 5); await turn()
  P.recCacheReset()
  for (let i = 1; i <= 3; i++) { assert.strictEqual(off(P, d).head.gen, 5); eq([P.recStats.reads, P.recStats.hits], [5 * i, 0], `call ${i}`) }
  eq(P.recCacheSize(), { facts: 0, heads: 0, headBytes: 0 }, 'kept under RECCACHE=off')
})

console.log('RACILY CLEAN: A JUST-WRITTEN FILE IS NOT KEPT')
/** With the caller's own clock a just-written generation is read on every call; it is kept once it is older than the window. */
const scenRacy = async M => {
  M.recCacheReset()
  const d = tmp()
  for (let i = 1; i <= 3; i++) assert.strictEqual(M.publishRecord(d, KEY, () => BODY(i)).result, 'accepted')
  await turn(); M.recCacheReset()
  const S = M.recStats
  for (let i = 1; i <= 3; i++) fs.utimesSync(gf(d, i), Date.now() / 1000, Date.now() / 1000)      // written NOW (a loaded host may have stalled since the publish)
  for (let i = 1; i <= 3; i++) { assert.strictEqual(M.recordHead(d, KEY).head.gen, 3); eq([S.reads, S.hits], [3 * i, 0], `call ${i}: a just-written file is read again`) }
  assert.strictEqual(M.recordHead(d, KEY, { now: Date.now() + M.REC_RACY_MS / 4 }).head.gen, 3); eq([S.reads, S.hits], [12, 0], 'a quarter of the window on: still racy')
  assert.strictEqual(M.recCacheSize().facts, 0, 'a racily clean file was kept')
  assert.strictEqual(M.recordHead(d, KEY, { now: Date.now() + M.REC_RACY_MS + 500 }).head.gen, 3); eq([S.reads, S.hits], [15, 0], 'past the window: read once more')
  assert.strictEqual(M.recCacheSize().facts, 3, 'CONTROL: a file older than the window is kept')
  assert.strictEqual(M.recordHead(d, KEY).head.gen, 3); eq([S.reads, S.hits], [15, 3], 'and served from then on')
  // a file stamped in the FUTURE never stops being racy
  fs.utimesSync(gf(d, 2), Date.now() / 1000 + 3600, Date.now() / 1000 + 3600); await turn()
  for (let i = 1; i <= 2; i++) { eq(on(M, d), off(M, d), 'future mtime'); assert.strictEqual(M.recCacheSize().facts, 2, 'a file stamped in the future was kept') }
}
await t('a just-written generation is read on every call until it is older than REC_RACY_MS; a future stamp is never kept', () => scenRacy(P))

console.log('NOTHING SHARED: THE CALLER MAY MUTATE WHAT IT GETS')
/** head.rec, head, rejected and gens are the caller's: wrecking them changes no later call. */
const scenMutate = async M => {
  M.recCacheReset()
  const d = tmp(); chain(M, d, 3); linkGen(d, 4, { ...BODY(4), gen: 4, prev: 3, prevSha: 'not it' }); await turn()
  const want = off(M, d)
  assert.strictEqual(want.head.gen, 3); eq(want.rejected, [{ gen: 4, why: 'chain' }], 'CONTROL: the scene')
  const wreck = r => { r.head.rec.cells.push('X'); r.head.rec.zones.a = 'wrecked'; r.head.rec.gen = 77; delete r.head.rec.prevSha; r.head.sha = 'zzz'; r.head.gen = -1; r.rejected[0].why = 'wrecked'; r.rejected.push({ gen: 0, why: 'x' }); r.gens.length = 0 }
  const seen = []
  for (let i = 0; i < 4; i++) {
    const r0 = M.recStats.reads
    const a = on(M, d)
    if (i >= 1) assert.strictEqual(M.recStats.reads - r0, 0, 'CONTROL: this call was not served from the kept facts and bytes')
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
  M.recCacheReset()
  const d = tmp(); chain(M, d, 2)
  const good = Buffer.from(JSON.stringify({ ...BODY(3), gen: 3, prev: 2, prevSha: off(M, d).head.sha }))
  linkGen(d, 3, good.subarray(0, good.length - 7)); await turn()        // a torn write
  on(M, d)
  for (let i = 0; i < 3; i++) {
    const r0 = M.recStats.reads, a = on(M, d)
    eq(a.rejected, [{ gen: 3, why: 'unparseable' }], `call ${i}`); assert.strictEqual(a.head.gen, 2)
    assert.strictEqual(M.recStats.reads - r0, 1, `call ${i}: the unparseable file was not read again (and only it)`)
  }
  eq(on(M, d), off(M, d), 'unparseable')
  await nap(30); fs.writeFileSync(gf(d, 3), good); age(gf(d, 3), 3); await turn()     // fixed in place
  const r = same(M, d, 'the file fixed'); assert.strictEqual(r.head.gen, 3); eq(r.rejected, [], 'rejected')
}
await t('an unparseable generation is read again on every call; fixed, the next call sees it', () => scenUnparseable(P))
const scenUnreadable = async M => {
  M.recCacheReset()
  const d = tmp(); chain(M, d, 2)
  fs.mkdirSync(gf(d, 3)); age(gf(d, 3), 3); await turn()                 // EISDIR: unreadable whoever runs this
  on(M, d)
  for (let i = 0; i < 3; i++) {
    const r0 = M.recStats.reads, a = on(M, d)
    eq(a.rejected, [{ gen: 3, why: 'unreadable' }], `call ${i}`); assert.strictEqual(a.head.gen, 2)
    assert.strictEqual(M.recStats.reads - r0, 1, `call ${i}: the unreadable file was not tried again (and only it)`)
  }
  eq(on(M, d), off(M, d), 'unreadable')
  fs.rmdirSync(gf(d, 3)); linkGen(d, 3, { ...BODY(3), gen: 3, prev: 2, prevSha: off(M, d).head.sha }); await turn()
  const r = same(M, d, 'a file there now'); assert.strictEqual(r.head.gen, 3); eq(r.rejected, [], 'rejected')
}
await t('an unreadable generation is tried again on every call; readable, the next call sees it', () => scenUnreadable(P))
await t('a generation without read permission (chmod 000) is tried again on every call; chmod back, the next call sees it', async () => {
  if (ROOT_USER) { note('chmod 000 test: SKIPPED (running as root)'); return }
  P.recCacheReset()
  const d = tmp(); chain(P, d, 3); await turn()
  on(P, d); await nap(30); fs.chmodSync(gf(d, 2), 0o000)
  let denied = false; try { fs.readFileSync(gf(d, 2)) } catch { denied = true }
  if (!denied) { fs.chmodSync(gf(d, 2), 0o644); note('chmod 000 test: SKIPPED (the filesystem ignores the mode)'); return }
  await turn()
  for (let i = 0; i < 4; i++) {
    const r0 = P.recStats.reads, a = on(P, d)
    assert.strictEqual(a.head.gen, 1); eq(a.rejected, [{ gen: 2, why: 'unreadable' }, { gen: 3, why: 'chain' }], `call ${i}`)
    // the first call also reads the bytes of the head it fell back to (g1: kept as a fact, its bytes never kept)
    assert.strictEqual(P.recStats.reads - r0, i === 0 ? 2 : 1, `call ${i}: the unreadable file is tried again (and only it)`)
  }
  eq(on(P, d), off(P, d), 'chmod 000')
  await nap(30); fs.chmodSync(gf(d, 2), 0o644); await turn()
  assert.strictEqual(same(P, d, 'chmod back').head.gen, 3)
})

console.log('BOUNDS: THE KEPT FACTS AND THE KEPT HEAD BYTES')
await t('at most REC_FACTS_MAX facts (least recently used out first) and REC_HEADS_MAX head Buffers; past them the walk is still the uncached walk', async () => {
  assert.ok(P.REC_FACTS_MAX >= 1024 && P.REC_HEADS_MAX >= 31, 'the live pool: 435 generation files, 31 records')
  await withMutants(PROJ_URL, [['export const REC_FACTS_MAX = 8192', 'export const REC_FACTS_MAX = 6'], ['export const REC_HEADS_MAX = 64', 'export const REC_HEADS_MAX = 2']], async M => {
    const d = tmp(), keys = ['a', 'b', 'c', 'd'].map(pl => M.projKey({ x: 0, y: 70, z: 0 }, pl))
    for (const k of keys) chain(M, d, 5, k)
    await turn(); M.recCacheReset()
    for (const k of keys) { same(M, d, `record ${k}`, k); const z = M.recCacheSize(); assert.ok(z.facts <= 6 && z.heads <= 2, JSON.stringify(z)) }
    eq(M.recCacheSize().facts, 6, 'CONTROL: the bound was reached')
    const r0 = M.recStats.reads; on(M, d, keys[3])
    assert.strictEqual(M.recStats.reads - r0, 0, 'the record used last was pushed out')
    const r1 = M.recStats.reads; same(M, d, 'the record used first', keys[0])
    assert.ok(M.recStats.reads - r1 >= 5, 'CONTROL: the record used first was still kept (the bound is not biting)')
  })
})
await t('a head too big for REC_HEAD_BYTES_MAX is not kept: its file is read again each call and must hash to its fact', async () => {
  await withMutants(PROJ_URL, [['export const REC_HEAD_BYTES_MAX = 32 * 1024 * 1024', 'export const REC_HEAD_BYTES_MAX = 16']], async M => {
    M.recCacheReset()
    const d = tmp(); chain(M, d, 4); await turn()
    on(M, d)
    for (let i = 0; i < 3; i++) { const r0 = M.recStats.reads; eq(on(M, d), off(M, d), `call ${i}`); assert.strictEqual(M.recStats.reads - r0 - 4, 1, 'only the head is read again') }
    eq(M.recCacheSize(), { facts: 4, heads: 0, headBytes: 0 }, 'kept')
  })
})

console.log('MUTANTS (each anchor present and unique; each killed by the test named)')
await t('MUTANT the inode dropped from the key -> "a kept fact answers only for the SAME inode..." (and the two-inode directory swap, where reached)', async () => {
  const pair = [['!!c && !!st && c.ino === st.ino && c.size === st.size', '!!c && !!st && c.size === st.size']]
  await killedBy(pair, scenFresh)
  let real = 'not reached'
  if (twinsReached) {
    let why = null, reached = null
    await withMutants(PROJ_URL, pair, async M => { try { reached = await scenTwins(M) } catch (e) { why = e } })
    if (reached !== false) { assert.ok(why instanceof assert.AssertionError, `the mutant survived the directory swap: ${why?.stack?.split('\n')[0] ?? 'survived'}`); real = 'yes' }
  }
  note(`the inode mutant killed on real files by the directory swap: ${real}`)
})
await t('MUTANT the ctime dropped from the key -> "a generation rewritten IN PLACE with its mtime restored..."', () =>
  killedBy([['c.mtimeNs === st.mtimeNs && c.ctimeNs === st.ctimeNs', 'c.mtimeNs === st.mtimeNs']], scenInPlace))
await t('MUTANT an unparseable file kept -> "an unparseable generation is read again on every call..."', () =>
  killedBy([["catch { return { why: 'unparseable' } }", "catch { return recKeep(p, st0, { why: 'unparseable' }, now) }"]], scenUnparseable))
await t('MUTANT a failed read kept -> "an unreadable generation is tried again on every call..."', () =>
  killedBy([["catch { return { why: 'unreadable' } }", "catch { return recKeep(p, st0, { why: 'unreadable' }, now) }"]], scenUnreadable))
await t('MUTANT the parsed head kept and handed out again (no fresh parse) -> "mutating head.rec, head, rejected and gens changes no later call..."', () =>
  killedBy([["if (hb && hb.fact === e) return JSON.parse(hb.buf.toString('utf8'))", "if (hb && hb.fact === e) return (hb.rec ??= JSON.parse(hb.buf.toString('utf8')))"]], scenMutate))
await t('MUTANT the racy rule skipped -> "a just-written generation is read on every call until it is older than REC_RACY_MS..."', () =>
  killedBy([['if (!st0 || !recFactFresh(st0, st1) || recRacy(st1, now)) return fact', 'if (!st0 || !recFactFresh(st0, st1)) return fact']], scenRacy))
await t('MUTANT a kept fact trusted without the stat -> "a generation replaced by rename with other bytes of the SAME size and mtime..."', () =>
  killedBy([['if (c && recFactFresh(c, st0)) { recStats.hits++', 'if (c) { recStats.hits++']], scenReplaced))
await t('MUTANT the prevSha check skipped for a kept fact -> "a generation replaced by rename with other bytes of the SAME size and mtime..."', () =>
  killedBy([['if (e.prev !== head.gen || e.prevSha !== head.e.sha)', 'if (e.prev !== head.gen || (e.buf && e.prevSha !== head.e.sha))']], scenReplaced))

console.log('MICRO-BENCHMARK (printed, never asserted): 100 generations of ~100 KB, 20 calls')
await t('the cached walk against the uncached walk on a tidy-sized record', async () => {
  P.recCacheReset()
  const d = tmp(), N = 100, CALLS = 20
  let prevSha = null, bytes = 0
  for (let g = 1; g <= N; g++) {
    const cells = Array.from({ length: 3600 }, (_, i) => [i + g, 64, i % 97, 'cobblestone'])
    const buf = Buffer.from(JSON.stringify({ v: 1, plot: 'tidy', cells, gen: g, prev: g === 1 ? null : g - 1, prevSha, at: g, by: 'bench' }))
    fs.writeFileSync(gf(d, g), buf); age(gf(d, g), g); prevSha = sha(buf); bytes += buf.length
  }
  await turn()
  const timed = fn => { const a = performance.now(); let r; for (let i = 0; i < CALLS; i++) r = fn(); return [performance.now() - a, r] }
  const [offMs, want] = timed(() => off(P, d))
  P.recCacheReset()
  const c0 = performance.now(); on(P, d); const coldMs = performance.now() - c0
  const r0 = P.recStats.reads
  const [onMs, got] = timed(() => on(P, d))
  const reads = P.recStats.reads - r0
  assert.strictEqual(got.head.gen, N); assert.strictEqual(got.head.sha, want.head.sha); assert.strictEqual(got.head.sha, prevSha); eq(got.rejected, [], 'rejected')
  assert.strictEqual(reads, 0, 'the timed cached calls read generation files')
  note(`benchmark: ${N} generations, ${(bytes / 1e6).toFixed(1)} MB (${Math.round(bytes / N / 1000)} KB each), ${CALLS} calls`)
  note(`benchmark: uncached (RECCACHE=off) ${offMs.toFixed(1)} ms = ${(offMs / CALLS).toFixed(2)} ms a call`)
  note(`benchmark: cached, the first call (reads all ${N}) ${coldMs.toFixed(1)} ms`)
  note(`benchmark: cached ${onMs.toFixed(1)} ms = ${(onMs / CALLS).toFixed(3)} ms a call (${reads} generation files read; ${(offMs / onMs).toFixed(0)}x)`)
  fs.rmSync(d, { recursive: true, force: true })
})

console.log(`\nNOTES (what depended on this host):\n${notes.map(s => `  ${s}`).join('\n')}`)
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
