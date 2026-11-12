// PROJFIX-01: FOUR STALLED PROJECTS, EACH A FEW LINES (owner 11-12: "see why the projects are stalled or not making progress and
// work on getting through these projects"). Diagnosed read-only on the live showcase, 24 h to 11-12 17:55Z (339k rows, 14 bots):
//   country   0 of 528 fills in 49 visits -- every click refused `fence:beat`: the heartbeat never beat the countryside's key
//   stepwell  0 of 2,168 cells for 92 h -- six sand cells with no stand: every floor in reach is sand, and a stand refused sand
//   wood      6 fences in 66 visits -- 55 aborted by the stuck reflex at 35 s while the kit was crafting
//   landmarks the first one (civicF) can never be sited, and five more waited behind it
// The pure rules, each with its positive control (the behaviour before) and an anchored mutant; the fence and the order through
// their real code (buildproj.mjs fenceRefusal on real lease files, shop.mjs activeProject).
import assert from 'node:assert'
import fs from 'node:fs'
const { PJ, project } = await import('./helpers/buildfake.mjs')
const { withMutant } = await import('./helpers/mutant.mjs')
const SW = await import('../src/stepwell.mjs')
const WW = await import('../src/woodworks.mjs')
const N = await import('../src/ordernowait.mjs')
const S = await import('../src/shop.mjs')
const { stuckDecision } = await import('../src/reflex.mjs')

const src = f => new URL(`../src/${f}`, import.meta.url)
const code = f => fs.readFileSync(src(f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 6).join('\n        ')}`) }
}

console.log('1. THE COUNTRYSIDE: the heartbeat covers the key of the visit in progress (buildproj.mjs beatKeys)')
await t('beatKeys: every listed project, and the visit\'s own key only while a visit runs', () => {
  assert.deepStrictEqual(PJ.beatKeys(['a', 'b'], 'country', true), ['a', 'b', 'country'])
  assert.deepStrictEqual(PJ.beatKeys(['a', 'b'], 'country', false), ['a', 'b'], 'no visit running: only the listed ones')
  assert.deepStrictEqual(PJ.beatKeys(['a', 'b'], 'a', true), ['a', 'b'], 'a listed key is beaten once')
  assert.deepStrictEqual(PJ.beatKeys(['a'], null, true), ['a'])
  assert.deepStrictEqual(PJ.beatKeys(null, 'country', true), ['country'])
})
await t('THE CHAIN on real lease files: a visit under an unlisted key is refused `beat` at 16 s (the live dead end), and is not once the heartbeat covers it', () => {
  const pr = project(), p = pr.p('A'), dir = pr.dir, key = pr.key
  const t0 = Date.now()
  const seg = PJ.takeLease(dir, key, 'seg-x', 'A', { now: t0 })
  assert.ok(seg.ok)
  const ask = at => PJ.fenceRefusal(dir, key, 'A', { slot: p.slot, slotGen: p.slotGen, seg: 'x', segGen: seg.gen, recordGen: p.recordGen, beatConn: 'c1', now: at })
  PJ.presenceWrite(dir, key, 'A', { conn: 'c1', now: t0, beat: t0 })              // the visit's one write at its start
  assert.strictEqual(ask(t0 + 5_000), null, 'fresh: the first clicks pass')
  assert.strictEqual(ask(t0 + 16_000), 'beat', 'POSITIVE CONTROL: no heartbeat for this key -> every click after 15 s is refused')
  // the heartbeat's tick at 10 s: the listed keys (none here is this one) plus the visit in progress
  for (const k of PJ.beatKeys([], key, true)) PJ.presenceWrite(dir, k, 'A', { conn: 'c1', now: t0, beat: t0 + 10_000, sync: false })
  assert.strictEqual(ask(t0 + 16_000), null, 'with the visit\'s key in the beat the click passes')
  // and a tick that leaves the key out (no visit running) changes nothing for it
  const pr2 = project(), p2 = pr2.p('A')
  const seg2 = PJ.takeLease(pr2.dir, pr2.key, 'seg-x', 'A', { now: t0 })
  PJ.presenceWrite(pr2.dir, pr2.key, 'A', { conn: 'c1', now: t0, beat: t0 })
  for (const k of PJ.beatKeys([], pr2.key, false)) PJ.presenceWrite(pr2.dir, k, 'A', { conn: 'c1', now: t0, beat: t0 + 10_000, sync: false })
  assert.strictEqual(PJ.fenceRefusal(pr2.dir, pr2.key, 'A', { slot: p2.slot, slotGen: p2.slotGen, seg: 'x', segGen: seg2.gen, recordGen: p2.recordGen, beatConn: 'c1', now: t0 + 16_000 }), 'beat')
})
await t('MUTANT: the visit\'s key left out of the beat (killed); and skills.mjs\'s heartbeat asks beatKeys with the visit in progress', async () => {
  let why = null
  await withMutant(src('buildproj.mjs'), "  if (busy && typeof visitKey === 'string' && visitKey) out.add(visitKey)\n", '', async M => {
    try { assert.deepStrictEqual(M.beatKeys(['a'], 'country', true), ['a', 'country']) } catch (err) { why = err }
  })
  assert.ok(why instanceof assert.AssertionError, 'the mutant survived')
  const sk = code('skills.mjs')
  assert.strictEqual(sk.split('for (const k of beatKeys(projectsOn().map(p => projKeyOf(p.plot)), bot.shopVisitKey ?? null, !!bot.shopVisitBusy)) presenceWrite(townDir(), k, me(),').length, 2, 'the one heartbeat, the visit\'s key in it')
})

console.log('2. THE STEPWELL: a stand on sand, outside the tank\'s own columns (stepwell.mjs fallingFloorOk / standsFor)')
// a sand beach: sandstone to y 62, sand at y 63 (the floor), air above; the tank's box is x 0..4, z 0..4 and it cuts the sand cell
// at 0,63,2 from the west -- every floor within reach is sand
const B = (name, bb = 'block') => ({ name, boundingBox: bb })
const beach = over => (x, y, z) => over?.[`${x},${y},${z}`] ?? (y <= 62 ? B('sandstone') : y === 63 ? B('sand') : B('air', 'empty'))
const PLAN = () => ({ box: [0, 0, 4, 4], top: 64, minY: 58, cells: [], cut: [0, 1, 2, 3, 4].flatMap(x => [0, 1, 2, 3, 4].map(z => ({ at: [x, 63, z] }))) })
await t('fallingFloorOk: only a column the tank never touches, and only on a full block', () => {
  const own = SW.planColumns(PLAN())
  assert.strictEqual(own.has('2,2'), true); assert.strictEqual(own.has('-1,2'), false)
  assert.strictEqual(SW.fallingFloorOk(own, -1, 2, B('sandstone')), true)
  assert.strictEqual(SW.fallingFloorOk(own, 2, 2, B('sandstone')), false, 'inside the tank\'s own columns: a cut under it would drop the bot')
  assert.strictEqual(SW.fallingFloorOk(own, -1, 2, B('air', 'empty')), false, 'sand over a hollow')
  assert.strictEqual(SW.fallingFloorOk(own, -1, 2, null), false, 'unread below')
  assert.strictEqual(SW.fallingFloorOk(null, -1, 2, B('sandstone')), false)
})
await t('the live shape: every floor in reach is sand -- a stand is found beside the tank, never in its own columns', () => {
  const plan = PLAN(), c = [0, 63, 2]
  const st = SW.standsFor(beach(), plan, c, { feet: [-2, 64, 2] })
  assert.ok(st.length > 0, 'a stand exists')
  const own = SW.planColumns(plan)
  assert.ok(st.every(s => !own.has(`${s[0]},${s[2]}`)), `every stand is outside the tank's columns: ${JSON.stringify(st)}`)
  assert.ok(st.every(s => s[0] < 0 || s[0] > 4 || s[2] < 0 || s[2] > 4))
  // a firm floor is still a stand anywhere, as before
  const firm = SW.standsFor((x, y, z) => (y <= 63 ? B('sandstone') : B('air', 'empty')), plan, c, { feet: [-2, 64, 2] })
  assert.ok(firm.length > 0)
})
await t('POSITIVE CONTROL + MUTANTS: without the rule no stand at all (the 92-hour stall); a mutant that takes sand anywhere stands the bot on a cut', async () => {
  const plan = PLAN(), c = [0, 63, 2]
  await withMutant(src('stepwell.mjs'), "        if (isFalling(fl) && !fallingFloorOk(own, x, z, read(x, y - 2, z))) continue\n", '        if (isFalling(fl)) continue\n', async M => {
    assert.deepStrictEqual(M.standsFor(beach(), PLAN(), c, { feet: [-2, 64, 2] }), [], 'the old rule: no stand on a sand beach')
  })
  let why = null
  await withMutant(src('stepwell.mjs'), "  return !!own && !own.has(`${x},${z}`) && !!under && isFull(under)\n", '  return !!under && isFull(under)\n', async M => {
    try { const own = M.planColumns(plan); assert.ok(M.standsFor(beach(), plan, c, { feet: [-2, 64, 2], max: 60 }).every(s => !own.has(`${s[0]},${s[2]}`))) } catch (err) { why = err }
  })
  assert.ok(why instanceof assert.AssertionError, 'MUTANT (sand anywhere) survived')
})

console.log('3. THE WOOD KIT: its crafting is a declared stationary window (woodworks.mjs woodKitStillMs)')
await t('woodKitStillMs: nothing owed, nothing declared; a kit of 24 fences and 2 gates covers the live 36 s; never more than two minutes', () => {
  assert.strictEqual(WW.woodKitStillMs({ fences: 0, gates: 0 }), 0)
  assert.ok(WW.woodKitStillMs({ fences: 24, gates: 2 }) >= 60_000, 'the live median kit (22 crafts, 36 s) with a margin')
  assert.ok(WW.woodKitStillMs({ fences: 3, gates: 0 }) >= 20_000)
  assert.strictEqual(WW.woodKitStillMs({ fences: 3000, gates: 100 }), WW.WOODKIT_STILL_MAX_MS)
  assert.strictEqual(WW.WOODKIT_STILL_MAX_MS, 120_000)
})
await t('the watchdog (reflex.mjs stuckDecision): 36 s still while busy is `stuck` (the live abort), and is not inside the declared window', () => {
  const now = 1_000_000, base = { busy: true, digging: false, moved: false, inDanger: false, now, stillSince: now - 36_000, stuckMs: 35_000 }
  const undeclared = stuckDecision({ ...base, stationaryUntil: 0 })
  const declared = stuckDecision({ ...base, stationaryUntil: now + WW.woodKitStillMs({ fences: 24, gates: 2 }) - 36_000 })
  assert.notDeepStrictEqual(undeclared, declared, 'the declaration changes the watchdog\'s answer')
  const acts = d => (typeof d === 'object' && d ? d.stuck ?? d.act ?? d.fire ?? JSON.stringify(d) : d)
  assert.ok(acts(undeclared) && acts(undeclared) !== acts(declared), `POSITIVE CONTROL: undeclared reads stuck (${JSON.stringify(undeclared)} vs ${JSON.stringify(declared)})`)
})
await t('the wiring: woodKit declares the window before its crafts and gives it back (structural), and a mutant that declares nothing is seen', async () => {
  const sk = code('skills.mjs')
  const a = sk.indexOf('still = Date.now() + woodKitStillMs(need)'), b = sk.indexOf('if (still > Date.now()) bot.stationaryUntil = Math.max(bot.stationaryUntil ?? 0, still)')
  const c1 = sk.indexOf("await craft(ctx, { item: `${spNow}_fence`,"), back = sk.indexOf('finally { if (still && bot.stationaryUntil === still) bot.stationaryUntil = 0 }')
  assert.ok(a > 0 && b > a && c1 > b && back > c1, 'declared, then crafted, then given back')
  let why = null
  await withMutant(src('woodworks.mjs'), '  return Math.min(WOODKIT_STILL_MAX_MS, 15_000 + crafts * 2_500)\n', '  return 0\n', async M => {
    try { assert.ok(M.woodKitStillMs({ fences: 24, gates: 2 }) >= 60_000) } catch (err) { why = err }
  })
  assert.ok(why instanceof assert.AssertionError, 'the mutant survived')
})

console.log('4. THE LANDMARKS: one whose predecessor found no site does not wait behind it (ordernowait.mjs chainSkipOk)')
await t('chainSkipOk / afterMet: only in the chain, only while the predecessor is unsited AND waiting', () => {
  assert.strictEqual(N.chainSkipOk(true, { exists: false, waiting: true }), true)
  assert.strictEqual(N.chainSkipOk(true, { exists: false, waiting: false }), false, 'never tried, or its wait is over: it comes first')
  assert.strictEqual(N.chainSkipOk(true, { exists: true, complete: false, waiting: true }), false, 'building: one landmark at a time')
  assert.strictEqual(N.chainSkipOk(false, { exists: false, waiting: true }), false, 'not a landmark after a landmark')
  assert.strictEqual(N.chainSkipOk(true, null), false)
  // review r1 (Claude): a landmark that already STANDS is never paused again by the one before it coming up for another try
  assert.strictEqual(N.chainSkipOk(true, { exists: false, waiting: false }, { exists: true, complete: false }), true)
  assert.strictEqual(N.chainSkipOk(false, { exists: false, waiting: false }, { exists: true }), false, 'only in the chain')
  assert.strictEqual(N.chainSkipOk(true, { exists: false, waiting: false }, { exists: false }), false, 'an unsited successor still waits for a predecessor never tried')
  assert.strictEqual(N.afterMet({ plot: 'civicM', after: 'civicS' }, false, { chainSkip: true }), true)
  assert.strictEqual(N.afterMet({ plot: 'civicM', after: 'civicS' }, false, {}), false, 'the gate as before without it')
})
await t('THE ORDER (shop.mjs activeProject): the first two landmarks found no site and wait -- the third is offered; while the first builds, none is', async () => {
  const civ = S.PROJECTS.filter(p => /^civic/.test(p.plot))
  assert.ok(civ.length >= 3, `the landmark chain is listed (${civ.length})`)
  const paths = S.PROJECTS.find(p => p.plot === civ[0].after)
  const list = [paths, ...civ]
  const done = plot => ({ plot, exists: true, complete: true, damaged: false })
  const waits = plot => ({ plot, exists: false, complete: false, damaged: false, waiting: true })
  const fresh = plot => ({ plot, exists: false, complete: false, damaged: false })
  const pick = st => S.activeProject(st, list, {})?.plot ?? null
  assert.strictEqual(pick([done(paths.plot), waits(civ[0].plot), waits(civ[1].plot), ...civ.slice(2).map(p => fresh(p.plot))]), civ[2].plot, 'the third landmark is tried')
  assert.strictEqual(pick([done(paths.plot), fresh(civ[0].plot), ...civ.slice(1).map(p => fresh(p.plot))]), civ[0].plot, 'never tried: the first comes first')
  assert.strictEqual(pick([done(paths.plot), { plot: civ[0].plot, exists: true, complete: false, damaged: false }, ...civ.slice(1).map(p => fresh(p.plot))]), civ[0].plot, 'building: one at a time')
  // a landmark half built keeps its turn while the first one's wait has just ended (it is tried again, and fails again, beside it)
  assert.strictEqual(pick([done(paths.plot), fresh(civ[0].plot), waits(civ[1].plot), { plot: civ[2].plot, exists: true, complete: false, damaged: false }, ...civ.slice(3).map(p => fresh(p.plot))]), civ[0].plot, 'the retry comes first in the order')
  const noF = [done(paths.plot), fresh(civ[0].plot), waits(civ[1].plot), { plot: civ[2].plot, exists: true, complete: false, damaged: false, free: true }, ...civ.slice(3).map(p => fresh(p.plot))]
  assert.strictEqual(S.activeProject(noF.map(x => (x.plot === civ[0].plot ? { ...x, free: false } : x)), list, {})?.plot ?? null, civ[2].plot, 'and a bot the retry has no slot for goes on building the one that stands')
  let why = null
  await withMutant(src('ordernowait.mjs'), "(!!afterState && afterState.exists === false && afterState.waiting === true) || selfState?.exists === true)", 'false)', async M => {
    try { assert.strictEqual(M.chainSkipOk(true, { exists: false, waiting: true }), true) } catch (err) { why = err }
  })
  assert.ok(why instanceof assert.AssertionError, 'the mutant survived')
  // POSITIVE CONTROL through the order itself: the gate without the skip offers no landmark at all (the live stall)
  await withMutant(src('shop.mjs'), 'chainSkip: chainSkipOk(isCivicPlot(p.plot) && isCivicPlot(p.after), sa, s)', 'chainSkip: false', async M => {
    const l2 = [M.PROJECTS.find(p => p.plot === paths.plot), ...M.PROJECTS.filter(p => /^civic/.test(p.plot))]
    const got = M.activeProject([done(paths.plot), waits(civ[0].plot), waits(civ[1].plot), ...civ.slice(2).map(p => fresh(p.plot))], l2, {})?.plot ?? null
    assert.notStrictEqual(got, civ[2].plot, 'without the skip the third landmark waits behind two that can never be sited')
  })
})

await t('REVIEW r1 (Codex): ONE landmark is sited at a time -- the town-wide lease on real files, and skills.mjs holds it round the siting AND the publish', () => {
  const pr = project(), dir = pr.dir, key = pr.key
  const a = PJ.takeLease(dir, key, N.CIVIC_SITE_LEASE, 'A')
  assert.ok(a.ok, 'the first bot sites')
  assert.strictEqual(PJ.takeLease(dir, key, N.CIVIC_SITE_LEASE, 'B').ok, false, 'a second bot does not site meanwhile')
  PJ.releaseLease(dir, key, N.CIVIC_SITE_LEASE, 'A', a.gen)
  assert.ok(PJ.takeLease(dir, key, N.CIVIC_SITE_LEASE, 'B').ok, 'and does once the first has published')
  const sk = code('skills.mjs')
  const take = sk.indexOf('const siteLease = projTakeLease(dir, siteKey, CIVIC_SITE_LEASE, me)')
  const busy = sk.indexOf("if (!siteLease.ok) return out('no_effect', 'site_busy',")
  const site = sk.indexOf('ss = await civicSiteFor(bot,'), pub = sk.indexOf("if (ss.ok) pub = publishRecord(dir, key, cur => (cur ? null : { ...ss.record, plan: { gen: h.head.gen }, state: 'open' }), { by: me })")
  const rel = sk.indexOf('} finally { releaseLease(dir, siteKey, CIVIC_SITE_LEASE, me, siteLease.gen) }')
  assert.ok(take > 0 && busy > take && site > busy && pub > site && rel > pub, 'taken, refused when held, sited, published, THEN released')
  assert.strictEqual(sk.split('await civicSiteFor(').length, 2, 'the one landmark siting, inside the lease')
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
