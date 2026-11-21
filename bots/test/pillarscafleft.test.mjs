// SCAFFOLD-01show x PILLARS-01show: the pillar lap reads the take-back's hand-off files (`scafleft-<bot>.json`, pillarclean.mjs
// scafLeftPillars / pillarListWith; skills.mjs pillarListNow). Behaviour first: the pure reader, then its pillars through the lap's
// own job builder (pillarPassJobs) on a small world; the wiring by source (comments stripped) with an anchored mutant each.
process.env.LOG_DIR ??= '/tmp'
process.env.STATE_DIR ??= '/tmp'
import assert from 'node:assert'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import * as PC from '../src/pillarclean.mjs'

const PC_URL = new URL('../src/pillarclean.mjs', import.meta.url)
const SK_URL = new URL('../src/skills.mjs', import.meta.url)
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
let pass = 0, fail = 0
const t = async (name, fn) => { try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 6).join('\n        ')}`) } }
/** climb-escape.test.mjs's withMutant: the anchor present AND unique, or the mutant is never written. */
async function withMutant (url, old, neu, fn) {
  const src = readFileSync(url, 'utf8')
  assert.ok(src.includes(old), `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 70))}`)
  assert.ok(src.split(old).length === 2, 'the mutation target is not unique')
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, src.replace(old, neu).replace(/from '\.\//g, "from '../src/"))
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}
const NOW = 10 * 60 * 60_000
const E = (at, o = {}) => ({ at, block: 'dirt', t: NOW - 60_000, shape: 'pillar', zone: null, ...o })

await t('scafLeftPillars: one pillar a column, top down, the placing bot named; stale, future, malformed and non-scaffold entries dropped; a listed cell skipped', () => {
  const files = [{ holder: 'showcase-Kite', entries: [E([10, 70, 5]), E([10, 71, 5]), E([12, 70, 5], { t: NOW - PC.SCAFLEFT.keepMs - 1 }), E([13, 70, 5], { t: NOW + 3_600_000 }),
    E([14, 70, 5], { block: 'oak_door' }), E([15, 70]), E([16, 70, 5], { t: 'x' })] }, { holder: 'showcase-Juno', entries: [E([20, 66, -4]), E([30, 66, 1])] }]
  const ps = PC.scafLeftPillars(files, NOW, { skip: k => k === '30,66,1' })
  assert.deepStrictEqual(ps.map(p => [p.x, p.z, p.take.map(t => t.slice(0, 3).join(','))]), [[10, 5, ['10,71,5', '10,70,5']], [20, -4, ['20,66,-4']]])
  assert.strictEqual(ps[0].take[0][4], 'showcase-Kite', 'the placer, as the dig row names it')
  assert.strictEqual(ps[0].med, 69); assert.strictEqual(ps[0].top, 71); assert.ok(ps.every(p => p.id >= PC.SCAFLEFT.idBase && p.kind === 'scafleft'))
  const list = PC.pillarListOk({ ...PC.pillarListWith(null, ps, 'showcase') }, 'showcase')
  assert.strictEqual(list.pillars.length, 2, 'the merged list passes the lap\'s own validation')
  assert.strictEqual(PC.pillarListWith(null, [], 'showcase'), null, 'nothing handed, no list')
  const host = { v: 1, pool: 'showcase', surveyedAt: 5, pillars: [{ id: 0, x: 1, z: 1, med: 60, top: 63, take: [[1, 63, 1, 'dirt']] }] }
  assert.strictEqual(PC.pillarListWith(host, ps, 'showcase').pillars.length, 3)
})
await t('THROUGH THE LAP\'S JOBS: a handed two-block tower is offered top first; one built on, or no longer the handed block, is never taken', () => {
  const cells = new Map([['10,70,5', 'dirt'], ['10,71,5', 'dirt'], ['20,66,-4', 'dirt'], ['20,67,-4', 'oak_fence'], ['30,66,1', 'stone']])
  const read = (x, y, z) => { const n = cells.get(`${x},${y},${z}`) ?? (y <= 60 ? 'stone' : 'air'); return { name: n, boundingBox: n === 'air' ? 'empty' : 'block' } }
  const ps = PC.scafLeftPillars([{ holder: 'Kite', entries: [E([10, 70, 5]), E([10, 71, 5]), E([20, 66, -4]), E([30, 66, 1])] }], NOW)
  const pj = PC.pillarPassJobs(PC.pillarListWith(null, ps, 'showcase'), read, { pos: { x: 0, y: 70, z: 0 } })
  assert.deepStrictEqual(pj.take.map(q => q.at.join(',')), ['10,71,5', '10,70,5'], 'the tower, top first')
  assert.ok(pj.held.some(h => h.job.at.join(',') === '20,66,-4'), 'something on it: held')
  assert.ok(!pj.take.some(q => q.at.join(',') === '30,66,1'), 'it reads stone now: gone, never dug')
})
await t('MUTANTS (pillarclean.mjs): the freshness bound and the material rule each let a wrong entry in (killed)', async () => {
  await withMutant(PC_URL, '      if (!(now - e.t <= T.keepMs) || e.t > now + 60_000) continue\n', '', async M => {
    assert.strictEqual(M.scafLeftPillars([{ holder: 'K', entries: [E([1, 70, 1], { t: NOW - M.SCAFLEFT.keepMs - 1 })] }], NOW).length, 1)
  })
  await withMutant(PC_URL, '      if (!PILLAR_TOPS.test(e.block)) continue\n', '', async M => {
    assert.strictEqual(M.scafLeftPillars([{ holder: 'K', entries: [E([1, 70, 1], { block: 'oak_door' })] }], NOW).length, 1)
  })
})
await t('WIRING skills.mjs (comments stripped): the lap\'s list is the host\'s list plus the hand-off files, the listed cells skipped -- and the mutant without it is caught', () => {
  const src = strip(readFileSync(SK_URL, 'utf8'))
  const ok = s => /return pillarListWith\(list, scafLeftPillars\(c\.sl, Date\.now\(\), \{ skip: q => named\.has\(q\) \}\), pool\)/.test(s) &&
    /c = \{ at: Date\.now\(\), d, sl: scafLeftFiles\(dir\) \}/.test(s) && /\/\^scafleft-\[A-Za-z0-9_\.-\]\+\\\.json\$\//.test(s)
  assert.ok(ok(src), 'wired')
  const old = 'return pillarListWith(list, scafLeftPillars(c.sl, Date.now(), { skip: q => named.has(q) }), pool)'
  assert.strictEqual(src.split(old).length, 2, 'ANCHOR MISSING OR NOT UNIQUE')
  assert.strictEqual(ok(src.replace(old, 'return list')), false)
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
