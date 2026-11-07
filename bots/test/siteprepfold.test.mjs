// SHOWCASE SITEPREP FOLD (siteprep-01 on sinkfix-03 305057d0; Codex fold review BLOCKER): a prepared plot is claimed in buildSink, but a
// bot that had failed that kind was kept from ever reaching buildSink -- the picker's per-kind no-site wait (sinkNextGate noSiteUntil,
// 6 h) and the order's 24-h site retry (shop.mjs buildOrder, held for the failed plot by sinkfix-03). With every eligible bot failed,
// the prepared plot expired unclaimed after PREP.readyMs. Now a kind with a PREPARED request passes both waits. Anchored mutant.
import assert from 'node:assert'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
const SH = await import('../src/shop.mjs')
const SP = await import('../src/siteprep.mjs')
let pass = 0, fail = 0
const t = async (name, fn) => { try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 5).join('\n        ')}`) } }
const SHOP_PATH = new URL('../src/shop.mjs', import.meta.url)
async function withMutant (old, neu, fn) {
  const src = readFileSync(SHOP_PATH, 'utf8')
  assert.ok(src.includes(old), `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 70))}`)
  assert.ok(src.split(old).length === 2, 'ANCHOR MISSING OR NOT UNIQUE')
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, src.replace(old, neu).replace(/from '\.\//g, "from '../src/"))
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}
const T = s => Date.parse(`2026-11-04T${s}Z`)
const BOT = { on: true, shared: true, atTown: true, planned: true, record: null, complete: false, freeSlots: 10, groundY: 70, feet: [2, 71, 0], state: { lastStop: 'no_site', lastAt: T('09:00:00') } }
const order = (M, active, failed, claimed, now = T('10:00:00')) => {
  M.setActivePlot(() => active); M.setNoSitePlot(() => failed); M.setPrepClaimed(p => claimed.includes(p))
  try { return M.buildOrder({ ...BOT, now }) } finally { M.setActivePlot(() => null); M.setNoSitePlot(() => null); M.setPrepClaimed(() => false) }
}
await t('the bot whose tower failed to site is ordered to the tower once the keeper has PREPARED a tower plot', () => {
  assert.deepStrictEqual(order(SH, 'tower', 'tower', ['tower']).order, { skill: 'build_shop', args: {} })
})
await t('POSITIVE CONTROLS: no prepared plot -- the failed tower still waits its day; a prepared shrine does not lift the tower', () => {
  assert.strictEqual(order(SH, 'tower', 'tower', []).skip, 'no_site')
  assert.strictEqual(order(SH, 'tower', 'tower', ['shrine']).skip, 'no_site')
  assert.strictEqual(order(SH, 'tower', null, []).skip, 'no_site', 'an unknown failed plot holds as before')
})
await t('a throwing hook is no claim (the hold stands)', () => {
  SH.setActivePlot(() => 'tower'); SH.setNoSitePlot(() => 'tower'); SH.setPrepClaimed(() => { throw new Error('x') })
  try { assert.strictEqual(SH.buildOrder({ ...BOT, now: T('10:00:00') }).skip, 'no_site') } finally { SH.setActivePlot(() => null); SH.setNoSitePlot(() => null); SH.setPrepClaimed(() => false) }
})
await t('MUTANT KILLED: the site retry blind to the prepared claim holds the requester for 24 h', async () => {
  await withMutant(' && !prepClaimed(plot0) && siteRetryHolds(plot0, failedSite))', ' && siteRetryHolds(plot0, failedSite))', async M => {
    assert.strictEqual(order(M, 'tower', 'tower', ['tower']).skip, 'no_site')
  })
})
await t('prepClaimFor (the claim the hooks read): only a PREPARED request of that kind with a plot', () => {
  const rec = { requests: [{ id: 'SP1', state: 'prepared', requester: { kind: 'shrine' }, plot: { cx: 1, cz: 2, B: 9 } }, { id: 'SP2', state: 'filed', requester: { kind: 'tower' }, plot: null }] }
  assert.strictEqual(SP.prepClaimFor(rec, 'shrine')?.id, 'SP1')
  assert.strictEqual(SP.prepClaimFor(rec, 'tower'), null)
  assert.strictEqual(SP.prepClaimFor(null, 'shrine'), null)
})
const strip = src => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/[ \t]\/\/ .*$/gm, '')
await t('WIRED (skills.mjs): the order hook reads the prepared claim; the picker passes a prepared kind past this bot\'s no-site wait', () => {
  const sk = strip(readFileSync(new URL('../src/skills.mjs', import.meta.url), 'utf8'))
  assert.ok(/setPrepClaimed\(plot => isSinkPlot\(plot\) && !!prepClaimFor\(siteprepHead\(\), sinkKindOf\(plot\)\)\)/.test(sk))
  assert.strictEqual(sk.split('noSiteUntil: sp && prepClaimFor(sp, kind) ? 0 : noSiteUntilOf(bot.sinkNoSite, townNoSiteRead(), kind)').length, 2)   // sinkfix-04: the town's stamps too
})
// THE SITEPREP-02 FOLD on sinkfix-04 (Codex fold review BLOCKER): sinkfix-04 quiets the grounds order while the bot's idle mark holds;
// the keeper's prep tick that chooses nothing yet is a no-effect grounds visit, so its next tick waited an hour (LIVE 12:10-12:41Z: one
// SP1 tick in 30 min). The keeper with site-request work is never quiet; a helper, or the keeper with none, still is.
await t('tidyQuiet: the keeper with a request to search or prepare is never quiet; a helper is; no mark, never quiet', () => {
  assert.strictEqual(SH.tidyQuiet({ idle: true, keeper: true, prepWork: true }), false)
  assert.strictEqual(SH.tidyQuiet({ idle: true, keeper: false, prepWork: true }), true, 'a helper (no GK lease) stays quiet')
  assert.strictEqual(SH.tidyQuiet({ idle: true, keeper: true, prepWork: false }), true, 'the keeper with nothing to prep stays quiet (sinkfix-04)')
  assert.strictEqual(SH.tidyQuiet({ idle: false, keeper: true, prepWork: true }), false)
})
await t('prepKeeperWork: filed or prepping is keeper work; prepared waits on the requester; none, nothing', () => {
  assert.strictEqual(SP.prepKeeperWork({ requests: [{ state: 'filed' }] }), true)
  assert.strictEqual(SP.prepKeeperWork({ requests: [{ state: 'prepping' }] }), true)
  assert.strictEqual(SP.prepKeeperWork({ requests: [{ state: 'prepared' }, { state: 'handed' }] }), false)
  assert.strictEqual(SP.prepKeeperWork(null), false)
})
await t('the composition: the keeper\'s quiet order through buildOrder -- ordered with a request, skipped idle without', () => {
  const B = { ...BOT, state: { lastStop: 'complete', lastAt: T('09:00:00') } }
  const run = quiet => { SH.setActivePlot(() => 'tidy'); SH.setIdleNow(() => quiet); try { return SH.buildOrder({ ...B, now: T('10:00:00') }) } finally { SH.setActivePlot(() => null); SH.setIdleNow(() => false) } }
  assert.strictEqual(run(SH.tidyQuiet({ idle: true, keeper: true, prepWork: false })).skip, 'idle')
  assert.notStrictEqual(run(SH.tidyQuiet({ idle: true, keeper: true, prepWork: true })).skip, 'idle')
})
await t('MUTANT KILLED: a quiet order blind to the keeper\'s prep work holds its next tick', async () => {
  await withMutant('!!idle && !(keeper && (prepWork || closing))', '!!idle', async M => {
    assert.strictEqual(M.tidyQuiet({ idle: true, keeper: true, prepWork: true }), true)
  })
})
await t('WIRED (skills.mjs): the idle hook asks tidyQuiet with the GK lease alone and the request record', () => {
  const sk = strip(readFileSync(new URL('../src/skills.mjs', import.meta.url), 'utf8'))
  assert.ok(sk.includes('return tidyQuiet({ idle, keeper: keeperLeaseNow(b), prepWork: prepKeeperWork(siteprepHead()), closing: GKW_ON && (gkwClosing(b?.gkwPending ?? null) || gkwTownClosing(b)) })'))
  assert.ok(/function keeperLeaseNow[\s\S]{0,200}GK_LEASE/.test(sk), 'the keeper lease itself, never a helper lease')
})
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
