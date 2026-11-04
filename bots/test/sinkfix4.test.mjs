// SINKFIX-04 (LIVE showcase 11-04 10:44-11:47Z, dcb702bc, 15 bots restarted 10:43): road 17, shrine 15, dress 12 visits, every one
// `no_site` (road `s1:proof_unreachable s2:start_liquid s0:ended`; shrine its eight slots reserved or low; dress `lit138 proofs0`:
// nothing left to light, not the torches) -- one a bot a kind, because the no-site wait lived only in each bot's memory; and tidy
// 46 visits, 0 placed (32 helpers `nothing of the grounds is this helper's now`, 11 `complete` with nothing done) -- the order
// re-offered the grounds every cooldown. Reproduced from that state; fixed by a town-wide no-site stamp (sinks.mjs noSiteStamped /
// noSiteUntilOf, a town file) and a quiet tidy order while this bot's tidy mark holds (shop.mjs buildOrder `idle`). Mutants anchored.
import assert from 'node:assert'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
const S = await import('../src/sinks.mjs')
const SH = await import('../src/shop.mjs')
let pass = 0, fail = 0
const t = async (name, fn) => { try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 5).join('\n        ')}`) } }
async function withMutant (file, old, neu, fn) {
  const src = readFileSync(file, 'utf8')
  assert.ok(src.includes(old), `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 70))}`)
  assert.ok(src.split(old).length === 2, 'the mutation target is not unique')
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, src.replace(old, neu).replace(/from '\.\//g, "from '../src/"))
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}
const SINKS_PATH = new URL('../src/sinks.mjs', import.meta.url), SHOP_PATH = new URL('../src/shop.mjs', import.meta.url)
const T0 = Date.parse('2026-11-04T10:44:00Z')
// 15 bots after the restart (empty memories), each asking the gate for road, shrine and dress in turn; a site always fails
function burst (M) {
  let town = {}, visits = 0
  const bots = Array.from({ length: 15 }, () => ({}))
  for (let i = 0; i < 15; i++) {
    const now = T0 + i * 4 * 60_000
    for (const kind of ['road', 'shrine', 'dress']) {
      const g = M.sinkNextGate({ kind, pressure: { p: 0.5 }, noSiteUntil: M.noSiteUntilOf(bots[i], town, kind), now })
      if (!g.want) continue
      visits++
      bots[i][kind] = now + M.SINK.noSiteMs          // the bot's own wait (as before)
      town = M.noSiteStamped(town, kind, now)         // sinkfix-04: the town's
    }
  }
  return visits
}
await t('THE LOGGED BURST: 15 fresh bots x 3 failing kinds -- 45 no_site visits under the old rule, 3 now (one a kind)', async () => {
  assert.strictEqual(burst(S), 3)
  await withMutant(SINKS_PATH, 'export const noSiteUntilOf = (own = {}, town = {}, kind) => Math.max(Number(own?.[kind]) || 0, Number(town?.[kind]) || 0)', 'export const noSiteUntilOf = (own = {}, town = {}, kind) => Number(own?.[kind]) || 0', async M => {
    assert.strictEqual(burst(M), 45, 'MUTANT (per-bot only, the live rule): every bot pays one visit a kind')
  })
})
await t('the town stamp lapses after TOWN_NOSITE_MS; the bot\'s own wait still holds a bot that tried', () => {
  const town = S.noSiteStamped({}, 'shrine', T0)
  assert.strictEqual(S.noSiteUntilOf({}, town, 'shrine'), T0 + S.TOWN_NOSITE_MS)
  assert.strictEqual(S.sinkNextGate({ kind: 'shrine', pressure: { p: 1 }, noSiteUntil: S.noSiteUntilOf({}, town, 'shrine'), now: T0 + S.TOWN_NOSITE_MS + 1 }).why, 'ok')
  assert.strictEqual(S.noSiteUntilOf({ shrine: T0 + S.SINK.noSiteMs }, town, 'shrine'), T0 + S.SINK.noSiteMs)
  assert.strictEqual(S.noSiteUntilOf({}, town, 'road'), 0, 'another kind is not held')
  assert.deepStrictEqual(S.noSiteStamped('junk', 'road', 5), { road: 5 + S.TOWN_NOSITE_MS }, 'an unreadable map is none')
})
const base = { on: true, shared: true, atTown: true, planned: true, now: T0, state: {}, record: null, complete: false, freeSlots: 10, groundY: 70, feet: [2, 71, 0] }
const order = (M, plot, idle) => { M.setActivePlot(() => plot); M.setIdleNow(p => idle && p === plot); try { return M.buildOrder({ ...base, record: plot === 'tidy' ? { plot: 'tidy', structure_complete: false } : null }) } finally { M.setActivePlot(() => null); M.setIdleNow(() => false) } }
await t('THE LOGGED TIDY: a helper whose last grounds visit did nothing gets no grounds order while its mark holds; unmarked, as before', async () => {
  assert.strictEqual(order(SH, 'tidy', true).skip, 'idle')
  assert.deepStrictEqual(order(SH, 'tidy', false).order, { skill: 'build_shop', args: {} }, 'POSITIVE CONTROL: unmarked')
  assert.deepStrictEqual(order(SH, 'house1', true).order, { skill: 'build_shop', args: {} }, 'every other project\'s order unchanged')
  await withMutant(SHOP_PATH, "  { let idle = false; try { idle = plot0 === TIDY_PLOT && !!idleOf(plot0) } catch { idle = false } if (idle) return { order: null, skip: 'idle' } }\n", '', async M => {
    assert.deepStrictEqual(order(M, 'tidy', true).order, { skill: 'build_shop', args: {} }, 'MUTANT: the grounds offered again (the live 46/0)')
  })
})
await t('the helpers\' and the keeper\'s no-effect grounds visits are the marks it reads (noteIdle: keeper_held, complete)', () => {
  const m = new Map()
  SH.noteIdle(m, 'tidy', { status: 'no_effect', stop: 'keeper_held' }, T0); assert.ok(m.get('tidy') > T0)
  m.clear(); SH.noteIdle(m, 'tidy', { status: 'no_effect', stop: 'complete' }, T0); assert.ok(m.get('tidy') > T0)
  SH.noteIdle(m, 'tidy', { status: 'success', placed: 4 }, T0); assert.ok(!m.has('tidy'), 'a grounds visit that did something clears it')
})
const strip = src => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/[ \t]\/\/ .*$/gm, '')
await t('skills.mjs: both gates read the town stamps; a no_site writes one; the idle hook reads the bot\'s marks', () => {
  const sk = strip(readFileSync(new URL('../src/skills.mjs', import.meta.url), 'utf8'))
  assert.strictEqual(sk.split('noSiteUntilOf(bot.sinkNoSite, townNoSiteRead(), kind)').length - 1, 2)
  assert.ok(/bot\.sinkNoSite = \{ \.\.\.\(bot\.sinkNoSite \?\? \{\}\), \[kind\]: Date\.now\(\) \+ SINK\.noSiteMs \}\n\s*townNoSiteWrite\(kind\)/.test(sk))
  assert.ok(/setIdleNow\(plot => \(activeMem\?\.bot\?\.shopIdle\?\.get\?\.\(plot\) \?\? -Infinity\) > Date\.now\(\)\)/.test(sk))
})
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
