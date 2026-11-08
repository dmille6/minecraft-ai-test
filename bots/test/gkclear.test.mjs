// GKCLEAR-01 (control session 11-07, the roughground 2-h read): the showcase tidy stage sat `stage_held clears:11` -- 11 trunk logs no stand
// reaches (buildrun.mjs clears skips them uncounted) -- with ONE keeper tidy visit in 2 h (Lumen 21:07Z, strike 1/3). Lumen released
// `no_work_visit`; the next keeper (Alpha 21:11Z) carried no per-bot `gkwPending`, its order led with the forest, and the tidy never came
// back, so the stage never closed and the inside-the-wall rough re-survey (sited only with the next stage) never ran. Now the TOWN's
// strikes (every holder's file) say the stage is closing: the keeper's order leads with the tidy and its tidy order is never quieted.
import assert from 'node:assert'
import fs from 'node:fs'
const W = await import('../src/gkwork.mjs')
const GK = await import('../src/groundskeeper.mjs')
const SHOP = await import('../src/shop.mjs')

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 6).join('\n        ')}`) }
}
async function withMutant (file, old, neu, fn) {
  const src = fs.readFileSync(file, 'utf8')
  assert.ok(src.includes(old), `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 70))}`)
  assert.ok(src.split(old).length === 2, 'ANCHOR MISSING OR NOT UNIQUE')
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  fs.writeFileSync(out, src.replace(old, neu).replace(/from '\.\//g, "from '../src/"))
  try { return await fn(await import(out.href)) } finally { try { fs.unlinkSync(out) } catch {} }
}
const killedBy = async (file, real, old, neu, scenario) => {
  await scenario(real)
  let why = null
  await withMutant(file, old, neu, async M => { try { await scenario(M) } catch (err) { why = err } })
  assert.ok(why instanceof assert.AssertionError, `the mutant survived or died for another reason: ${why?.stack?.split('\n')[0] ?? 'survived'}`)
}
const W_PATH = new URL('../src/gkwork.mjs', import.meta.url)
const GK_PATH = new URL('../src/groundskeeper.mjs', import.meta.url)
const T0 = Date.parse('2026-11-07T21:07:19Z'), MIN = 60_000
const STAGE = { sitedAt: 1793892876060, stage: 1, stageId: 'inwall', cells: new Array(1366).fill(0).map((_, i) => ({ at: [i, 66, 0] })), cut: new Array(77).fill(0).map((_, i) => ({ at: [i, 67, 1] })) }
const SIG = W.gkwSig(STAGE)
const CLOSE_G = { ...W.GKW, windowMs: W.CLOSING_MS }

console.log('THE TOWN SAYS CLOSING (gkwork.mjs strikesClosing / CLOSING_MS)')
await t('1 or 2 strikes: closing; none, or the 3 that close it: not', async () => {
  await killedBy(W_PATH, W, 'export const strikesClosing = (total, G = GKW) => Number(total) >= 1 && Number(total) < G.emptyVisits', 'export const strikesClosing = (total, G = GKW) => false', M => {
    assert.strictEqual(M.strikesClosing(1), true)
  })
  assert.deepStrictEqual([0, 1, 2, 3, 4].map(n => W.strikesClosing(n)), [false, true, true, false, false])
})
await t('LIVE Lumen 21:07Z strike 1 read by Alpha at 21:12Z (another bot, no memory): closing; a strike 70 min old: not (the forest gets its turn back)', () => {
  const lumen = W.strikeNext(null, { sig: SIG, empty: true, now: T0 })
  assert.strictEqual(W.strikesClosing(W.strikesTotal([lumen], { sig: SIG, now: T0 + 5 * MIN, G: CLOSE_G })), true)
  assert.strictEqual(W.strikesClosing(W.strikesTotal([lumen], { sig: SIG, now: T0 + 70 * MIN, G: CLOSE_G })), false)
})

console.log('THE KEEPER ORDER (groundskeeper.mjs keeperOrderPure tidyClosing)')
const states = [{ plot: 'shop', exists: true, complete: true }, { plot: 'tidy', exists: true, complete: false }, { plot: 'forest', exists: true, complete: false }, { plot: 'hall', exists: true, complete: false }]
const list = [{ plot: 'shop' }, { plot: 'hall' }, { plot: 'forest' }, { plot: 'tidy' }]
const ord = (M, o) => M.keeperOrderPure(states, list, { d: 'mine', forestPlot: 'forest', ...o }).order.map(p => p.plot)
await t('the keeper of a closing stage works the tidy first, then the forest; otherwise the forest first (control); a non-keeper unchanged', async () => {
  await killedBy(GK_PATH, GK, '    if (forestP && forestWants(out[fi]) && tidyClosing) {', '    if (forestP && forestWants(out[fi]) && false) {', M => {
    assert.deepStrictEqual(ord(M, { tidyClosing: true }).slice(0, 2), ['tidy', 'forest'])
  })
  assert.deepStrictEqual(ord(GK, {}).slice(0, 2), ['forest', 'tidy'], 'control: forest first')
  assert.deepStrictEqual(GK.keeperOrderPure(states, list, { d: 'other', forestPlot: 'forest', tidyClosing: true }).order.map(p => p.plot), list.map(p => p.plot))
})

console.log('THE CHAIN (Lumen strikes, releases; Alpha and Bravo keep closing; the stage completes)')
await t('three keepers, one empty tidy visit each, minutes apart: every reader sees closing until the third strike closes it; the clears hold gives way', () => {
  const files = new Map()
  const visit = (who, now) => { files.set(who, W.strikeNext(files.get(who) ?? null, { sig: SIG, empty: true, now })); return W.strikesTotal([...files.values()], { sig: SIG, now }) }
  const closing = now => W.strikesClosing(W.strikesTotal([...files.values()], { sig: SIG, now, G: CLOSE_G }))
  assert.strictEqual(visit('Lumen', T0), 1)
  assert.strictEqual(closing(T0 + 5 * MIN), true, 'Alpha (new keeper) reads closing: tidy first, not quiet')
  assert.strictEqual(SHOP.tidyQuiet({ idle: true, keeper: true, closing: closing(T0 + 5 * MIN) }), false)
  assert.strictEqual(visit('Alpha', T0 + 6 * MIN), 2)
  const tot = visit('Alpha', T0 + 8 * MIN)
  assert.strictEqual(W.strikesClose(tot), true)
  assert.deepStrictEqual(W.softHoldsGive({ clearsOk: false, close: true }), { clearsOk: true, crewHolds: false })
  assert.strictEqual(closing(T0 + 9 * MIN), false, 'closed: the forest first again')
})

console.log('THE STALE STRIKE (gkwork.mjs tidyFirstNow; gkclear-02)')
await t('LIVE 23:55Z: Lumen\'s 21:07Z strike is 3 h old -- the keeper still leads with the tidy (gkclear-01: never); once per 30 min per unchanged count', async () => {
  const NOW = Date.parse('2026-11-08T00:10:00Z')
  const lumen = W.strikeNext(null, { sig: SIG, empty: true, now: T0 })
  const total = W.strikesTotal([lumen], { sig: SIG, now: NOW })
  assert.strictEqual(total, 1, 'the 6-h window still holds it')
  await killedBy(W_PATH, W, '  if (!strikesClosing(total, G)) return false\n  if (tried', '  if (!strikesClosing(total, G) || total < 99) return false\n  if (tried', M => {
    assert.strictEqual(M.tidyFirstNow({ total, sig: SIG, tried: null, now: NOW }), true)
  })
  const tried = { sig: SIG, total: 1, at: NOW }
  assert.strictEqual(W.tidyFirstNow({ total: 1, sig: SIG, tried, now: NOW + 5 * MIN }), false, 'its visit laid no strike: the forest\'s turn')
  assert.strictEqual(W.tidyFirstNow({ total: 2, sig: SIG, tried, now: NOW + 5 * MIN }), true, 'its visit laid a strike: the tidy again at once')
  assert.strictEqual(W.tidyFirstNow({ total: 1, sig: SIG, tried, now: NOW + 31 * MIN }), true, 'after RETRY_MS: once more')
  assert.strictEqual(W.tidyFirstNow({ total: 1, sig: SIG, tried: { ...tried, sig: 'other' }, now: NOW + 5 * MIN }), true, 'a new stage: no stamp')
  assert.strictEqual(W.tidyFirstNow({ total: 3, sig: SIG, now: NOW }), false, 'closed')
  assert.strictEqual(W.tidyFirstNow({ total: 0, sig: SIG, now: NOW }), false, 'no strike: the forest first')
})
await t('the chain from the stale strike: keepers rotate, each tidy visit strikes, the third closes -- no deadlock, no endless tidy-first', async () => {
  await killedBy(W_PATH, W, '  if (tried && tried.sig === sig && tried.total === total &&', '  if (false && tried && tried.sig === sig && tried.total === total &&', M => {
    // the starvation bound: a keeper whose tidy visit lays nothing (unread) is not sent back at once
    assert.strictEqual(M.tidyFirstNow({ total: 1, sig: SIG, tried: { sig: SIG, total: 1, at: 0 }, now: 60_000 }), false)
  })
  const NOW = Date.parse('2026-11-08T00:10:00Z')
  const files = new Map([['Lumen', W.strikeNext(null, { sig: SIG, empty: true, now: T0 })]])
  let tried = null, n = 0
  for (const [who, dt] of [['Kite', 0], ['Kite', 3]]) {
    const now = NOW + dt * MIN, total = W.strikesTotal([...files.values()], { sig: SIG, now })
    assert.strictEqual(W.tidyFirstNow({ total, sig: SIG, tried: tried?.[who] ?? null, now }), true, `${who} leads with the tidy at +${dt} min`)
    tried = { ...(tried ?? {}), [who]: { sig: SIG, total, at: now } }   // the visit's start stamp
    files.set(who, W.strikeNext(files.get(who) ?? null, { sig: SIG, empty: true, now }))
    n = W.strikesTotal([...files.values()], { sig: SIG, now })
  }
  assert.strictEqual(W.strikesClose(n), true, 'closed by the third strike')
  assert.strictEqual(W.tidyFirstNow({ total: n, sig: SIG, tried: null, now: NOW + 6 * MIN }), false, 'closed: Echo leads with the forest again')
})

console.log('WIRING (skills.mjs, comments stripped)')
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
const wiring = s => {
  const one = re => { const m = s.match(new RegExp(re, 'g')); assert.strictEqual(m?.length, 1, `${re}: ${m?.length ?? 0}`) }
  one("tidyClosing: d === 'mine' && GKW_ON && gkwTownClosing\\(bot, now\\)")
  one('closing: GKW_ON && \\(gkwClosing\\(b\\?\\.gkwPending \\?\\? null\\) \\|\\| gkwTownClosing\\(b\\)\\)')
  one('return !!t\\.sig && tidyFirstNow\\(\\{ total: t\\.total, sig: t\\.sig, tried: bot\\.gkwTried \\?\\? null, now \\}\\)')   // gkclear-02
  one('v = \\{ sig, total: strikesTotal\\(strikeReadAll\\(dir, key\\), \\{ sig, now \\}\\) \\}')
  one("if \\(GKW_ON && role === 'keeper'\\) \\{ try \\{ bot\\.gkwTown = null; const t = gkwTownRead\\(bot\\); if \\(t\\.sig\\) bot\\.gkwTried = \\{ sig: t\\.sig, total: t\\.total, at: Date\\.now\\(\\) \\}")
  one('bot\\.gkwTown = null   ')
}
await t('keeperOrder and the quiet hook read the town; the visit drops the cache after its strike; a cut line fails', () => {
  const s = strip(fs.readFileSync(new URL('../src/skills.mjs', import.meta.url), 'utf8'))
  wiring(s)
  const cut = "tidyClosing: d === 'mine' && GKW_ON && gkwTownClosing(bot, now)"
  assert.ok(s.split(cut).length === 2, 'ANCHOR MISSING OR NOT UNIQUE')
  assert.throws(() => wiring(s.replace(cut, '')), assert.AssertionError)
})

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exitCode = 1
