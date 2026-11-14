// GKLEASE-01 (coordinator 11-06 ~18:30Z; LIVE showcase batch15 from 17:09Z): THE GROUNDS LEASE WAS HELD BY BOTS THAT DID NOT WORK
// THE GROUNDS. showcase-Alpha took the keeper lease 17:12:45Z and again 17:43:51Z (after its own lapse) and spent its visits on the
// town's paths/monument repairs; showcase-Kite took it 18:14:52Z at y 14-17 mining iron. 0 tidy and 0 forest visits 16:00-18:20Z.
// 30 h of the showcase: 38 keeper takes, 11 with no grounds visit in the term; fleet 3 h: 26 takes, 7 with none, 8 holders mostly
// below y 55. Behaviour (groundskeeper.mjs groundsUnfit / groundsIdle / groundsLeaseCheck / keeperGroundsFirst, with keeperOrderPure
// and shop.mjs activeProject), then the wiring (source, comments stripped). Mutants anchored (present + unique).
import assert from 'node:assert'
import fs from 'node:fs'
const GK = await import('../src/groundskeeper.mjs')
const SHOP = await import('../src/shop.mjs')

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 6).join('\n        ')}`) }
}
const GK_PATH = new URL('../src/groundskeeper.mjs', import.meta.url)
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
const HOME = { x: 0, y: 70, z: 0 }
const NOW = Date.parse('2026-11-06T18:20:00Z')
const MIN = 60_000

console.log('FIT (groundskeeper.mjs groundsUnfit)')
await t('LIVE: Kite at y 15 under the town is unfit (underground); a bot at the town surface, or in the forest 100 out, is fit; far away is unfit', () => {
  assert.strictEqual(GK.groundsUnfit({ feet: [26, 15, 6], home: HOME }), 'underground')
  assert.strictEqual(GK.groundsUnfit({ feet: [10, 70, -5], home: HOME }), null)
  assert.strictEqual(GK.groundsUnfit({ feet: [10, 63, -5], home: HOME }), null, 'a step down within surfaceDy is the surface')
  assert.strictEqual(GK.groundsUnfit({ feet: [100, 66, 0], home: HOME }), null)
  assert.strictEqual(GK.groundsUnfit({ feet: [300, 70, 40], home: HOME }), 'away')
  assert.strictEqual(GK.groundsUnfit({ feet: null, home: HOME }), null, 'an unknown position never releases')
  assert.strictEqual(GK.groundsUnfit({ feet: [0, NaN, 0], home: HOME }), null)
})
console.log('IDLE (groundskeeper.mjs groundsIdle)')
await t('LIVE: Alpha took at 17:12:45 and did no grounds work -- idle from 17:32:45; a grounds visit or a restart restarts the clock', () => {
  const term0 = Date.parse('2026-11-06T17:12:45Z')
  assert.strictEqual(GK.groundsIdle({ term0, now: term0 + 19 * MIN }), false)
  assert.strictEqual(GK.groundsIdle({ term0, now: term0 + 20 * MIN }), true)
  assert.strictEqual(GK.groundsIdle({ term0, workAt: term0 + 15 * MIN, now: term0 + 30 * MIN }), false, 'work 15 min in: 15 min idle')
  assert.strictEqual(GK.groundsIdle({ term0, spawnAt: term0 + 25 * MIN, now: term0 + 30 * MIN }), false, 'a restart grants a fresh window')
  assert.strictEqual(GK.groundsIdle({ term0: null, now: NOW }), false, 'an unknown term start is never idle')
})
console.log('THE LEASE CHECK (groundskeeper.mjs groundsLeaseCheck)')
await t('a holder unfit or idle releases (why named); a fit, working holder keeps it; an unfit bot never takes; other decisions untouched', () => {
  assert.deepStrictEqual(GK.groundsLeaseCheck({ d: 'mine', unfit: 'underground' }), { release: 'underground', take: false })
  assert.deepStrictEqual(GK.groundsLeaseCheck({ d: 'mine', idle: true }), { release: 'no_work_visit', take: false })
  assert.deepStrictEqual(GK.groundsLeaseCheck({ d: 'mine' }), { release: null, take: false })
  assert.deepStrictEqual(GK.groundsLeaseCheck({ d: 'take', unfit: 'underground' }), { release: null, take: false })
  assert.deepStrictEqual(GK.groundsLeaseCheck({ d: 'take' }), { release: null, take: true })
  assert.deepStrictEqual(GK.groundsLeaseCheck({ d: 'other', unfit: 'away' }), { release: null, take: false })
})
await t('THE CHAIN: Kite (y 15) holding -> released, rests; the next decision of a fit bot is `take` (the lease is free)', () => {
  const lease = { gen: 704, rec: { holder: 'showcase-Kite', at: NOW - 6 * MIN, until: NOW + 24 * MIN, meta: { term0: NOW - 6 * MIN } }, released: false, holdsUntil: NOW + 24 * MIN, blocksUntil: NOW + 25 * MIN }
  const d = GK.keeperDecision({ lease, me: 'showcase-Kite', now: NOW, work: true })
  assert.strictEqual(d, 'mine')
  const c = GK.groundsLeaseCheck({ d, unfit: GK.groundsUnfit({ feet: [26, 15, 6], home: HOME }), idle: GK.groundsIdle({ term0: lease.rec.meta.term0, now: NOW }) })
  assert.strictEqual(c.release, 'underground')
  const after = { ...lease, released: true, holdsUntil: 0, blocksUntil: 0 }   // buildproj releaseLease's marker
  assert.strictEqual(GK.keeperDecision({ lease: after, me: 'showcase-Alpha', now: NOW + 1000, work: true }), 'take')
  assert.strictEqual(GK.keeperDecision({ lease: after, me: 'showcase-Kite', now: NOW + 1000, work: true, restUntil: NOW + GK.GK_FIT.restMs }), 'none', 'the released holder rests')
})
console.log('THE KEEPER\'S GROUNDS FIRST (keeperGroundsFirst + keeperOrderPure + shop.mjs activeProject)')
const st = (plot, o = {}) => ({ plot, exists: true, complete: true, damaged: false, due: false, ...o })
const town = (...over) => SHOP.PROJECTS.filter(p => !p.sink).map(p => over.find(o => o.plot === p.plot) ?? st(p.plot))
await t('LIVE: the keeper\'s pick was the paths repair (Alpha 17:56Z `paths complete`); with its grounds first it is the tidy; another bot keeps the repair', () => {
  const states = town(st('paths', { damaged: true }), st('tidy', { complete: false }))
  const r = GK.keeperOrderPure(states, SHOP.PROJECTS, { d: 'mine' })
  assert.strictEqual(SHOP.activeProject(r.states, r.order).plot, 'paths', 'the live order: the repair first')
  const g = GK.keeperGroundsFirst(r.states, { grounds: ['tidy', 'forest'] })
  assert.strictEqual(SHOP.activeProject(g, r.order).plot, 'tidy')
  assert.ok(g.find(s => s.plot === 'paths').due, 'the repair stays as upkeep')
  const o = GK.keeperOrderPure(states, SHOP.PROJECTS, { d: 'other' })
  assert.strictEqual(SHOP.activeProject(o.states, o.order).plot, 'paths', 'every other bot: the repair first')
  assert.deepStrictEqual(GK.keeperGroundsFirst([st('tidy', { damaged: true })], { grounds: ['tidy'] })[0].damaged, true, 'the grounds\' own damage stays a repair')
})
await t('the switch: GKLEASE=off is the rollback; on by default', () => {
  assert.strictEqual(GK.gkleaseOn({}), true)
  assert.strictEqual(GK.gkleaseOn({ GKLEASE: 'off' }), false)
})
await t('MUTANTS: the underground rule, the idle clock, the take gate, the repair downgrade -- each killed', async () => {
  const deep = M => assert.strictEqual(M.groundsUnfit({ feet: [26, 15, 6], home: HOME }), 'underground')
  await killedBy(GK_PATH, GK, "  if (feet[1] < home.y - G.surfaceDy && (covered !== false || feet[1] < home.y - (G.deepDy ?? Infinity))) return 'underground'\n", '', deep)   // gklease-02: the open-sky clause
  const idle = M => assert.strictEqual(M.groundsIdle({ term0: NOW - 25 * MIN, now: NOW }), true)
  await killedBy(GK_PATH, GK, '  return now - t0 >= G.idleMs\n', '  return false\n', idle)
  const take = M => assert.strictEqual(M.groundsLeaseCheck({ d: 'take', unfit: 'underground' }).take, false)
  await killedBy(GK_PATH, GK, "  if (d === 'take') return { release: null, take: !unfit }\n", "  if (d === 'take') return { release: null, take: true }\n", take)
  const first = M => assert.strictEqual(M.keeperGroundsFirst([st('paths', { damaged: true })], { grounds: ['tidy'] })[0].damaged, false)
  await killedBy(GK_PATH, GK, '  return states.map(st => (st && st.complete && st.damaged && !grounds.includes(st.plot) ? { ...st, damaged: false, due: true } : st))\n', '  return states\n', first)
})

console.log('WIRING (source, comments stripped)')
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
const wiring = src => {
  const one = re => { const m = src.match(new RegExp(re, 'g')); assert.strictEqual(m?.length, 1, `${re}: ${m?.length ?? 0}`) }
  one("const c = groundsLeaseCheck\\(\\{ d, unfit, idle: d === 'mine' && groundsIdle\\(\\{ term0: Number\\(k\\.lease\\?\\.rec\\?\\.meta\\?\\.term0 \\?\\? k\\.lease\\?\\.rec\\?\\.at\\), workAt: bot\\.gkWorkAt \\?\\? null, spawnAt: bot\\.shopSpawnAt \\?\\? null, now \\}\\) \\}\\)")
  one("if \\(c\\.release\\) \\{ releaseKeeper\\(bot, k\\.lease, c\\.release, now\\); bot\\.gkRestUntil = now \\+ GK_FIT\\.restMs; d = 'none' \\} else if \\(d === 'take' && !c\\.take\\) d = 'none'")
  one("const st1 = GKL_ON && d === 'mine' && work \\? keeperGroundsFirst\\(r\\.states, \\{ grounds: \\[TIDY_PLOT[^\\]]*\\] \\}\\) : r\\.states")
  one("for \\(let i = 0; i < states\\.length; i\\+\\+\\) states\\[i\\] = st1\\[i\\]")
  one("\\.gkWorkAt = Date\\.now\\(\\)")
  one("groundsUnfit\\(\\{ feet, home: \\{ x: config\\.world\\.homeX, y: config\\.world\\.homeY, z: config\\.world\\.homeZ \\}, covered: GKL2_ON \\? gkCovered\\(bot, feet\\) : null \\}\\)")   // gklease-02
  // Codex r1 BLOCKER: the gate at the ACQUISITION boundary -- takeKeeper (the order's read AND buildTidy's visit start) refuses a new
  // take by an unfit bot; on the showcase takeHelper too
  one("function takeKeeper \\(bot, lease, now = Date\\.now\\(\\)\\) \\{\\n\\s*const me = keeperMe\\(bot\\)\\n\\s*const renewal = [^\\n]*\\n\\s*\\{ const u = renewal \\? null : gkUnfitNow\\(bot\\); if \\(u\\) return \\{ ok: false, why: `unfit:\\$\\{u\\}` \\} \\}")
  if (/function takeHelper \(/.test(src)) one("const renewal = prev\\?\\.rec\\?\\.holder === me && now < \\(prev\\.holdsUntil \\?\\? 0\\)\\n\\s*\\{ const u = renewal \\? null : gkUnfitNow\\(bot\\); if \\(u\\) return \\{ ok: false, why: `unfit:\\$\\{u\\}` \\} \\}[ \\t]*\\n\\s*const r = projTakeLease\\(dir, key, name, me, \\{ now, ttl: GK\\.helperTtlMs \\}\\)")
}
await t('keeperOrder checks the holder and the taker, rests a released holder, puts the keeper\'s grounds first; the work clock is set; a cut line fails', () => {
  const src = strip(fs.readFileSync(new URL('../src/skills.mjs', import.meta.url), 'utf8'))
  wiring(src)
  for (const cut of [' else if (d === \'take\' && !c.take) d = \'none\'', '  // gklease-01 (Codex r1 BLOCKER): the fitness gate at the ACQUISITION boundary']) {
    const c0 = cut.startsWith('  //') ? null : cut
    if (!c0) continue
    assert.ok(src.split(c0).length === 2, 'ANCHOR MISSING OR NOT UNIQUE')
    assert.throws(() => wiring(src.replace(c0, '')), assert.AssertionError)
  }
  // the keeper's acquisition gate cut (the first gate line: takeKeeper's) fails the check
  const gate = '{ const u = renewal ? null : gkUnfitNow(bot); if (u) return { ok: false, why: `unfit:${u}` } }'
  assert.ok(src.includes(gate))
  assert.throws(() => wiring(src.replace(gate, '')), assert.AssertionError, 'without the acquisition gate the wiring check fails')
})

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
