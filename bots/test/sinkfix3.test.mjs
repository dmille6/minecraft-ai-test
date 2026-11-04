// SINKFIX-03 (LIVE showcase 11-04 07:09-08:09Z, 15 bots on c39a1128): build work fell from 145 to 23 blocks/h. The pick rows still
// wanted sinks (`tower:ok`, p 0.2-0.7, open 0) -- but after ONE `no_site` (the unsiteable crop farm's, or the road's: `s1:proof_
// unreachable s2:start_liquid s0:ended`) every bot's order said `_shop_skip why=no_site` for SHOP_SITE_RETRY_MS (24 h): shop.mjs
// buildOrder's site retry was keyed on the bot's last STOP, and a sink wanting its next instance reads unsited. Logged: Alpha,
// road no_site 07:29:58; picks 07:40:20 / 07:50:58 `order=tower,shrine,dress ... tower:ok`; `_shop_skip why=no_site` 07:35:59.
// Now the retry holds only the plot that failed (siteRetryHolds; skills.mjs records it). Anchored mutant, positive controls.
import assert from 'node:assert'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
const SH = await import('../src/shop.mjs')
let pass = 0, fail = 0
const t = async (name, fn) => { try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 5).join('\n        ')}`) } }
const SHOP_PATH = new URL('../src/shop.mjs', import.meta.url)
async function withMutant (old, neu, fn) {
  const src = readFileSync(SHOP_PATH, 'utf8')
  assert.ok(src.includes(old), `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 70))}`)
  assert.ok(src.split(old).length === 2, 'the mutation target is not unique')
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, src.replace(old, neu).replace(/from '\.\//g, "from '../src/"))
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}
const T = s => Date.parse(`2026-11-04T${s}Z`)
const ALPHA = { on: true, shared: true, atTown: true, planned: true, record: null, complete: false, freeSlots: 10, groundY: 70, feet: [2, 71, 0], state: { lastStop: 'no_site', lastAt: T('07:29:58') } }
const order = (M, active, failed, now = T('07:40:20')) => {
  M.setActivePlot(() => active); M.setNoSitePlot(() => failed)
  try { return M.buildOrder({ ...ALPHA, now }) } finally { M.setActivePlot(() => null); M.setNoSitePlot(() => null) }
}
await t('THE LOGGED ORDER: the road failed to site, the tower is wanted -- the tower is ordered (live: `_shop_skip why=no_site` for 24 h)', () => {
  assert.deepStrictEqual(order(SH, 'tower', 'road').order, { skill: 'build_shop', args: {} })
  assert.deepStrictEqual(order(SH, 'tower', 'road', T('07:50:58')).order, { skill: 'build_shop', args: {} })
})
await t('POSITIVE CONTROLS: the plot that failed still waits its day; an unknown failed plot (a restart, no hook) holds as before', () => {
  assert.strictEqual(order(SH, 'road', 'road').skip, 'no_site')
  assert.strictEqual(order(SH, 'cropfarm', 'cropfarm').skip, 'no_site', 'the crop farm that cannot site is asked again in a day')
  assert.strictEqual(order(SH, 'tower', null).skip, 'no_site')
  assert.deepStrictEqual(order(SH, 'tower', 'road', T('07:29:58') + SH.SHOP_SITE_RETRY_MS + 1).order, { skill: 'build_shop', args: {} }, 'after the day: as before')
})
await t('MUTANT KILLED: the retry blind to the plot holds the wanted tower (the live 24 h)', async () => {
  await withMutant(' && siteRetryHolds(plot0, failedSite)) return { order: null, skip: \'no_site\' }', ") return { order: null, skip: 'no_site' }", async M => {
    assert.strictEqual(order(M, 'tower', 'road').skip, 'no_site')
  })
})
await t('the crop farm that failed to site (an unsited finite project, idle-marked) yields to the wanted tower, which is then ordered', () => {
  const LIST = SH.PROJECTS.filter(p => ['shop', 'house1', 'paths', 'treefarm', 'storehouse', 'cropfarm', 'road', 'tower', 'shrine', 'tidy'].includes(p.plot))
  const states = LIST.map(p => p.plot === 'cropfarm' ? { plot: 'cropfarm', exists: false, complete: false, damaged: false }
    : p.plot === 'tower' ? { plot: 'tower', exists: true, complete: true, damaged: false, sink: true, sinkNext: true }
      : p.sink ? { plot: p.plot, exists: false, complete: false, damaged: false, sink: true }
        : p.plot === 'tidy' ? { plot: 'tidy', exists: true, complete: false, damaged: false, free: false } : { plot: p.plot, exists: true, complete: true, damaged: false })
  if (!LIST.some(p => p.plot === 'cropfarm')) return   // a tree without the crop farm: the order test above covers it
  const mem = new Map(); SH.noteIdle(mem, 'cropfarm', { status: 'no_effect', stop: 'no_site' }, T('07:13:11'))
  const pick = SH.activeProject(SH.idleMarks(states, mem, T('07:40:20')), LIST)
  assert.strictEqual(pick.plot, 'tower')
  assert.deepStrictEqual(order(SH, pick.plot, 'cropfarm').order, { skill: 'build_shop', args: {} })
  assert.strictEqual(SH.activeProject(states, LIST).plot, 'cropfarm', 'POSITIVE CONTROL: unmarked, the finite crop farm first')
})
const strip = src => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/[ \t]\/\/ .*$/gm, '')
await t('skills.mjs: a no_site visit records its plot; the hook reads it', () => {
  const sk = strip(readFileSync(new URL('../src/skills.mjs', import.meta.url), 'utf8'))
  assert.ok(/if \(r\?\.stop === 'no_site'\) ctx\.bot\.shopNoSitePlot = ctx\.bot\.shopVisitPlot \?\? null/.test(sk))
  assert.ok(/setNoSitePlot\(\(\) => activeMem\?\.bot\?\.shopNoSitePlot \?\? null\)/.test(sk))
})
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
