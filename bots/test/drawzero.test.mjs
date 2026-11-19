// T11REACH2-01show (rig run 25, 11-19): two of three bots placed nothing -- every clean-up visit's draw opened the town's containers
// for dirt (~14 a visit) while the town index showed 0 dirt in all 35, and the walks ate the visit's clock. A kind the readable index
// shows at 0 in EVERY container is no longer searched for (indexsearch2.mjs stockZero, skills.mjs matsWithdraw): the draw returns
// at once, short, with a `skip_zero_stock` row, and the visit keeps its clock for the cuts and the bag's fills. Unreadable / unknown
// index: today's search. Behaviour through the REAL draw on the fake world and the real index file; anchored mutants.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
process.env.LOG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-drawzero-logs-'))
process.env.BOT_NAME = 'DrawZeroBot'
process.env.MEMORY_SCOPE = 'shared'
process.env.MEMORY_POOL = 'drawzero'
process.env.OLLAMA_MODEL ??= 'qwen2.5:7b-instruct'
process.env.HOME_X = '0'; process.env.HOME_Y = '64'; process.env.HOME_Z = '0'
process.env.SKILL_TIMEOUT_MS = '180000'
import assert from 'node:assert/strict'
const { withMutant } = await import('./helpers/mutant.mjs')
const IX = await import('../src/indexsearch2.mjs')
const TI = await import('../src/townindex.mjs')
const { fakeWorld, stack } = await import('./fakeworld.mjs')
const { tapRecords } = await import('../src/logger.mjs')
const RECS = []
tapRecords(r => RECS.push(r))

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; if (process.env.TEST_VERBOSE) console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${String(e.stack ?? e).split('\n').slice(0, 4).join('\n        ')}`) }
}
const HK = TI.indexHomeKey({ x: 0, y: 64, z: 0 })
const obs = (k, names, at = Date.now()) => ({ t: 'obs', id: `o-${k}-${at}-${Math.random()}`, k, h: [k], at, bot: 'Other', by: 'count_town', names, used: Object.keys(names).length, size: 27 })
// a fresh pool each scenario (the index is a file in it)
const pool = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-drawzero-pool-')); process.env.POOL_STATE_DIR = d; TI.resetIndexCache(); return d }
function town ({ chest = [stack('cobblestone', 10)], index = 'zero' } = {}) {
  const dir = pool()
  const w = fakeWorld({ bag: [stack('dirt', 35), stack('cobblestone', 64)], at: [6.5, 64, 0.5] })
  w.bot.username = 'DrawZeroBot'
  w.set(5, 64, 0, 'chest'); w.stock(5, 64, 0, chest)
  if (index === 'zero') TI.appendIndex(dir, HK, null, obs('5,64,0', { cobblestone: [10, 1] }))
  if (index === 'dirt') TI.appendIndex(dir, HK, null, obs('5,64,0', { dirt: [20, 1], cobblestone: [10, 1] }))
  if (index === 'dirty') TI.appendIndex(dir, HK, null, { t: 'dirty', id: 'd1', k: '5,64,0', h: ['5,64,0'], at: Date.now(), bot: 'Other', by: 'x', phase: 'pre', op: 'op1' })
  return w
}
const draw = async (S, w, take = { dirt: 14 }, zeroSkip = true) => {
  RECS.length = 0
  const t0 = Date.now()
  const out = await S._draw.matsWithdraw({ bot: w.bot }, take, new AbortController().signal, 0, {}, (n, want) => want, null, null, { zeroSkip })
  return { out, ms: Date.now() - t0, skip: RECS.map(r => String(r.skill?.detail ?? '')).filter(d => /op=skip_zero_stock/.test(d)) }
}
const S0 = await import('../src/skills.mjs')

await t('stockZero: 0 in every entry (fresh or stale) -> true; any holder, a dirty or unknown entry, no index, a non-plain name -> false', () => {
  const now = Date.now()
  const e = (names, at = now) => ({ last: { t: 'obs', at }, obs: { at, names, h: ['k'] }, ops: {} })
  assert.equal(IX.stockZero({ a: e({ cobblestone: [9, 1] }), b: e({}, now - 7 * 3600e3) }, 'dirt', { now }), true)
  assert.equal(IX.stockZero({ a: e({ cobblestone: [9, 1] }), b: e({ dirt: [1, 1] }) }, 'dirt', { now }), false)
  assert.equal(IX.stockZero({ a: e({}), b: { last: { t: 'dirty', at: now } } }, 'dirt', { now }), false)
  assert.equal(IX.stockZero({ a: e({}), b: { last: { t: 'obs', at: now } } }, 'dirt', { now }), false, 'an entry with no observation')
  assert.equal(IX.stockZero({ a: e({}, now + 3600e3) }, 'dirt', { now }), false, 'an observation from the future')
  assert.equal(IX.stockZero(null, 'dirt'), false); assert.equal(IX.stockZero({}, 'dirt'), false)
  assert.equal(IX.stockZero({ a: e({}, now - 25 * 3600e3) }, 'dirt', { now }), false, 'a zero older than a day is no evidence (Codex r4)')
  assert.equal(IX.stockZeroCovers({ a: e({}) }, ['a']), true); assert.equal(IX.stockZeroCovers({ a: e({}) }, ['b']), false)
  assert.equal(IX.stockZero({ a: e({}) }, 'pick', { now }), true, '(a plain name is judged by name)')
  assert.equal(IX.stockZero({ a: e({}) }, 'minecraft:dirt', { now }), false)
})
const scenZero = async S => {
  const w = town({ index: 'zero' })
  const { out, skip } = await draw(S, w)
  assert.equal(out.looked, 0, `no container opened for a kind the index shows nowhere: ${JSON.stringify(out.tried)}`)
  assert.equal(w.spy.opened.length, 0)
  assert.equal(out.short, true, 'still short: the refill and the bag row say so')
  assert.deepEqual(out.zero, ['dirt'])
  assert.equal(skip.length, 1); assert.match(skip[0], /kinds=dirt n=14/)
  assert.equal(w.bot.drawLog?.short?.dirt, 14, 'the bag row\'s draw names it short')
}
await t('THE DRAW (real matsWithdraw, fake world, real index file): the index shows 0 dirt in every container -> no container opened, short, a skip_zero_stock row', () => scenZero(S0))
await t('CONTROLS: the index shows dirt -> the chest is opened and the dirt taken; a dirty entry or no index -> today\'s search (opened)', async () => {
  const w1 = town({ chest: [stack('dirt', 20)], index: 'dirt' })
  const r1 = await draw(S0, w1)
  assert.ok(r1.out.looked >= 1, 'the index shows dirt: the chest is searched'); assert.equal(r1.skip.length, 0); assert.ok(!r1.out.zero)
  const w2 = town({ index: 'dirty' })
  const r2 = await draw(S0, w2)
  assert.ok(r2.out.looked >= 1, 'a dirty index: searched as today'); assert.equal(r2.skip.length, 0)
  const w3 = town({ index: 'none' })
  const r3 = await draw(S0, w3)
  assert.ok(r3.out.looked >= 1, 'no index: searched as today'); assert.equal(r3.skip.length, 0)
})
await t('CODEX r4: a town container the index never observed -> today\'s search; a draw that is not the clean-up\'s -> today\'s search', async () => {
  const w = town({ index: 'zero' })
  w.set(8, 64, 0, 'chest'); w.stock(8, 64, 0, [stack('dirt', 30)])   // a chest the index has never seen
  const r = await draw(S0, w)
  assert.ok(r.out.looked >= 1, 'searched: an unobserved container may hold it'); assert.equal(r.skip.length, 0)
  const w2 = town({ index: 'zero' })
  const r2 = await draw(S0, w2, { dirt: 14 }, false)
  assert.ok(r2.out.looked >= 1, 'another caller: today\'s search'); assert.equal(r2.skip.length, 0)
})
await t('MIXED: dirt skipped, cobblestone (which the index shows) still searched for', async () => {
  const w = town({ chest: [stack('cobblestone', 10)], index: 'zero' })
  const { out } = await draw(S0, w, { dirt: 14, cobblestone: 5 })
  assert.ok(out.looked >= 1, 'the cobblestone search still runs'); assert.deepEqual(out.zero, ['dirt'])
})
await t('MUTANT KILLED: the unobserved-container check removed (Codex r4)', async () => {
  await withMutant(new URL('../src/skills.mjs', import.meta.url), 'if (view.containers.every(c => stockZeroCovers(ents, c.halves?.length ? c.halves : [c.k]))) zero.add(n)', 'zero.add(n)', async M => {
    const w = town({ index: 'zero' }); w.set(8, 64, 0, 'chest'); w.stock(8, 64, 0, [stack('dirt', 30)])
    const r = await draw(M, w)
    assert.ok(r.out.looked === 0, 'killed: the mutant skips the unseen chest')
  })
})
await t('MUTANT KILLED: the zero-stock skip removed (the draw searches the town for dirt it does not have)', async () => {
  await withMutant(new URL('../src/skills.mjs', import.meta.url), 'if (!(left[n] > 0) || !stockZero(ents, n)) continue', 'continue', async M => {
    let died = null
    try { await scenZero(M) } catch (e) { died = e }
    assert.ok(died instanceof assert.AssertionError, `the mutant survived or died of something else: ${died}`)
  })
})
await t('WIRED (structural): the clean-up visit starts its own draw log (its bag row is this visit\'s draw only)', () => {
  const src = fs.readFileSync(new URL('../src/skills.mjs', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
  const i = src.indexOf('async function buildTidyVisit (ctx, args, signal) {')
  assert.ok(i > 0)
  assert.match(src.slice(i, i + 200), /bot\.drawLog = null/)
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
