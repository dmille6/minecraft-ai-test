// PRODSERVE-01 (LIVE showcase, 15 bots, 11-04 08:00Z..11-06 14:20Z: 832,928 skill rows, 3,305 `_build_visit` rows): A FINISHED
// PRODUCTION PROJECT STOPPED BEING OFFERED. The cane bed (complete 11-04 21:38Z) got 0 visits in 1.7 d with 7 of 8 cells ripe; the crop
// farm (complete 11-04 08:29Z) 0 in 2.2 d; the storage hall's clerk never ran (0 `_storehub_clerk` rows). Their harvest / clerk is only
// `due`, and the picker offered `due` after every repair, free open project and sink -- the showcase always has one. And the dress
// batch L1-P3's wall-top torch (20,73,-20) lost its host when the old wall came down: 5 failed repair visits in 12 h.
// Behaviour first (prodserve.mjs servicePick / stampRelease, shop.mjs activeProject `service`, towndress.mjs dressOrphans, sinks.mjs
// sinkWaived), then the dress chain on the fake server, then the wiring (source, comments stripped). Mutants anchored (present + unique).
import assert from 'node:assert'
import fs from 'node:fs'
const P = await import('../src/prodserve.mjs')
const SHOP = await import('../src/shop.mjs')
const TD = await import('../src/towndress.mjs')
const S = await import('../src/sinks.mjs')
const { R, PJ, G, HOME, server, bot } = await import('./helpers/buildfake.mjs')

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 6).join('\n        ')}`) }
}
const PS_PATH = new URL('../src/prodserve.mjs', import.meta.url)
const SHOP_PATH = new URL('../src/shop.mjs', import.meta.url)
const TD_PATH = new URL('../src/towndress.mjs', import.meta.url)
const SINKS_PATH = new URL('../src/sinks.mjs', import.meta.url)
async function withMutant (file, old, neu, fn) {
  const src = fs.readFileSync(file, 'utf8')
  assert.ok(src.includes(old), `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 70))}`)
  assert.ok(src.split(old).length === 2, 'ANCHOR MISSING OR NOT UNIQUE')
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  fs.writeFileSync(out, src.replace(old, neu).replace(/from '\.\//g, "from '../src/"))
  try { return await fn(await import(out.href)) } finally { try { fs.unlinkSync(out) } catch {} }
}
/** The scenario passes on the real module and fails (an AssertionError) on the mutant. */
const killedBy = async (file, real, old, neu, scenario) => {
  await scenario(real)
  let why = null
  await withMutant(file, old, neu, async M => { try { await scenario(M) } catch (err) { why = err } })
  assert.ok(why instanceof assert.AssertionError, `the mutant survived or died for another reason: ${why?.stack?.split('\n')[0] ?? 'survived'}`)
}

const NOW = Date.parse('2026-11-06T14:20:00Z')
const MIN = 60_000
// the live states (11-06 14:20Z): every one complete; the cane bed ripe; the farm's bag reason; the hall's clerk
const live = (extra = {}) => [
  { plot: 'stepwell', exists: true, complete: false, damaged: false },
  { plot: 'cropfarm', exists: true, complete: true, damaged: false, due: 'seed', serve: 'seed' },
  { plot: 'canefarm', exists: true, complete: true, damaged: false, due: 'harvest', serve: 'harvest' },
  { plot: 'storehub', exists: true, complete: true, damaged: true, due: false, serve: 'clerk' },
].map(s => ({ ...s, ...(extra[s.plot] ?? {}) }))

console.log('THE SERVICE PICK (prodserve.mjs servicePick)')
await t('never served: the first service plot naming a SERVICE reason goes (the farm\'s seed gather is no service reason; the cane bed is)', () => {
  const p = P.servicePick(live(), { now: NOW })
  assert.strictEqual(p.plot, 'canefarm')
  assert.strictEqual(p.reason, 'harvest')
  assert.strictEqual(p.overdueMs, Infinity)
})
await t('the town schedule: a plot served inside its gap waits; the most overdue goes first', () => {
  const stamps = { canefarm: { at: NOW - 30 * MIN, by: 'showcase-Iris' }, storehub: { at: NOW - 40 * MIN, by: 'showcase-Onyx' } }
  assert.strictEqual(P.servicePick(live(), { now: NOW, stamps }).plot, 'storehub', 'cane served 30 min ago (gap 60): the hall (gap 30, 10 over) goes')
  const both = { canefarm: { at: NOW - 70 * MIN }, storehub: { at: NOW - 35 * MIN } }
  assert.strictEqual(P.servicePick(live(), { now: NOW, stamps: both }).plot, 'canefarm', 'cane 10 min over beats the hall 5 min over')
  assert.strictEqual(P.servicePick(live(), { now: NOW, stamps: { canefarm: { at: NOW - 5 * MIN }, storehub: { at: NOW - 5 * MIN } } }), null, 'both inside their gaps: none')
})
await t('the fair share: a bot that served inside SERVICE.botGapMs gets no service pick; after it, it does', () => {
  assert.strictEqual(P.servicePick(live(), { now: NOW, botLastAt: NOW - 5 * MIN }), null)
  assert.strictEqual(P.servicePick(live(), { now: NOW, botLastAt: NOW - P.SERVICE.botGapMs - 1 }).plot, 'canefarm')
})
await t('only a COMPLETE, sited service plot with a reason; a crop farm with seeds to plant is served (replant)', () => {
  assert.strictEqual(P.servicePick(live({ canefarm: { complete: false }, storehub: { serve: null } }), { now: NOW }), null, 'an open cane bed is a build, not a service')
  assert.strictEqual(P.servicePick(live({ canefarm: { exists: false }, storehub: { serve: null } }), { now: NOW }), null)
  assert.strictEqual(P.servicePick(live({ canefarm: { serve: null }, storehub: { serve: null }, cropfarm: { serve: 'replant' } }), { now: NOW }).plot, 'cropfarm')
  assert.strictEqual(P.servicePick([{ plot: 'stepwell', exists: true, complete: true, serve: 'due' }], { now: NOW }), null, 'not a service plot')
})
await t('a stamp in the future (a bad clock) is no stamp; serviceReason keeps a plot\'s own reasons', () => {
  assert.strictEqual(P.servicePick(live(), { now: NOW, stamps: { canefarm: { at: NOW + 3 * 60 * MIN } } }).plot, 'canefarm')
  assert.strictEqual(P.serviceReason('cropfarm', 'seed'), null)
  assert.strictEqual(P.serviceReason('cropfarm', 'harvest'), 'harvest')
  assert.strictEqual(P.serviceReason('storehub', true), 'due')
  assert.strictEqual(P.serviceReason('tower', 'harvest'), null)
})
await t('the switch: on in the showcase only by default; PRODSERVE=off wins', () => {
  assert.strictEqual(P.prodserveOn({}, 'showcase'), true)
  assert.strictEqual(P.prodserveOn({}, 'board-a'), false)
  assert.strictEqual(P.prodserveOn({ PRODSERVE: 'off' }, 'showcase'), false)
  assert.strictEqual(P.prodserveOn({ PRODSERVE_POOLS: 'board-a' }, 'board-a'), true)
})
await t('MUTANTS: the town gap cut, the fair share cut, the reason filter cut -- each killed', async () => {
  const gap = M => assert.strictEqual(M.servicePick(live(), { now: NOW, stamps: { canefarm: { at: NOW - 5 * MIN }, storehub: { at: NOW - 5 * MIN } } }), null)
  await killedBy(PS_PATH, P, '    if (lastAt != null && now - lastAt < gap) continue\n', '', gap)
  const share = M => assert.strictEqual(M.servicePick(live(), { now: NOW, botLastAt: NOW - 5 * MIN }), null)
  await killedBy(PS_PATH, P, '  if (Number.isFinite(botLastAt) && botLastAt <= now + S.skewMs && now - botLastAt < S.botGapMs) return null\n', '', share)
  const seed = M => assert.strictEqual(M.servicePick(live({ canefarm: { serve: null }, storehub: { serve: null } }), { now: NOW }), null)
  await killedBy(PS_PATH, P, '  return want.includes(r) ? r : null\n', '  return r\n', seed)
})

console.log('THE STUCK BACK-OFF AND THE OFFER GATE (Codex r1 BLOCKER 1)')
await t('a service plot in its stuck back-off is never picked (the order would refuse it for 6 h and hold the bot)', () => {
  assert.strictEqual(P.servicePick(live({ canefarm: { stuck: true } }), { now: NOW }).plot, 'storehub')
  assert.strictEqual(P.servicePick(live({ canefarm: { stuck: true }, storehub: { stuck: true } }), { now: NOW }), null)
})
await t('the offer gate: a pick no visit consumed in SERVICE.offerMs is dropped and charged to the share; a new plot starts a new offer', () => {
  const svc = { plot: 'canefarm', reason: 'harvest' }
  const a = P.serviceOffer(null, svc, NOW)
  assert.deepStrictEqual(a, { svc, offer: { plot: 'canefarm', at: NOW }, charge: false })
  assert.strictEqual(P.serviceOffer(a.offer, svc, NOW + P.SERVICE.offerMs).svc, svc, 'inside the window: still offered')
  const c = P.serviceOffer(a.offer, svc, NOW + P.SERVICE.offerMs + 1)
  assert.deepStrictEqual(c, { svc: null, offer: null, charge: true })
  assert.strictEqual(P.servicePick(live(), { now: NOW + P.SERVICE.offerMs + 2, botLastAt: NOW + P.SERVICE.offerMs + 1 }), null, 'charged: the share holds the next pick')
  assert.deepStrictEqual(P.serviceOffer(a.offer, { plot: 'storehub', reason: 'clerk' }, NOW + P.SERVICE.offerMs + 1).offer, { plot: 'storehub', at: NOW + P.SERVICE.offerMs + 1 })
  assert.deepStrictEqual(P.serviceOffer(a.offer, null, NOW), { svc: null, offer: null, charge: false })
})
await t('MUTANTS: the stuck skip cut, the offer window cut -- each killed', async () => {
  const stuck = M => assert.strictEqual(M.servicePick(live({ canefarm: { stuck: true }, storehub: { stuck: true } }), { now: NOW }), null)
  await killedBy(PS_PATH, P, '    if (s.stuck) continue\n', '', stuck)
  const win = M => assert.strictEqual(M.serviceOffer({ plot: 'canefarm', at: NOW }, { plot: 'canefarm' }, NOW + M.SERVICE.offerMs + 1).charge, true)
  await killedBy(PS_PATH, P, '    if (now - Number(prev.at) > S.offerMs) return { svc: null, offer: null, charge: true }\n', '', win)
})

console.log('THE CLAIM AND THE STAMP GIVEN BACK (Codex r1 BLOCKER 2: generations created exclusively; stampOfHead, stampReleaseDue)')
const SK = await import('../src/skills.mjs')
await t('15 bots claim the same generation: exactly one wins; the newest generation is the stamp; an unread generation never claims', () => {
  const dir = fs.mkdtempSync(`${process.env.TMPDIR ?? '/tmp'}/prodserve-claim-`)
  const h0 = SK.serviceHeadOf('canefarm', dir)
  assert.deepStrictEqual(h0, { gen: 0, rec: null, released: false })
  const wins = Array.from({ length: 15 }, (_, i) => SK.serviceClaim('canefarm', h0.gen, P.stampNext(null, { me: `B${i}`, now: NOW, reason: 'harvest' }), dir))
  assert.strictEqual(wins.filter(w => w.ok).length, 1, JSON.stringify(wins))
  assert.ok(wins.slice(1).every(w => w.why === 'lost'))
  const h1 = SK.serviceHeadOf('canefarm', dir)
  assert.strictEqual(h1.gen, 1)
  assert.deepStrictEqual(P.stampOfHead(h1), { at: NOW, by: 'B0', gen: 1 })
  assert.strictEqual(P.servicePick(live({ storehub: { serve: null } }), { now: NOW + 30 * MIN, stamps: { canefarm: P.stampOfHead(h1) } }), null, 'inside the gap')
  assert.strictEqual(SK.serviceClaim('canefarm', null, {}, dir).ok, false)
  for (let g = 1; g <= 6; g++) assert.ok(SK.serviceClaim('canefarm', g, P.stampNext(null, { me: 'B0', now: NOW + g }), dir).ok)
  assert.strictEqual(fs.readdirSync(dir).filter(n => /\.service\.g\d+\.json$/.test(n)).length, 4, 'the newest four generations are kept')
})
await t('a visit that did not happen (slots_full) releases its own generation: it reads as the previous start; a real visit or another bot\'s claim does not', () => {
  const rec = P.stampNext({ at: NOW - 90 * MIN, by: 'B' }, { me: 'A', now: NOW, reason: 'harvest' })
  assert.deepStrictEqual(rec, { at: NOW, by: 'A', reason: 'harvest', prevAt: NOW - 90 * MIN })
  assert.strictEqual(P.stampReleaseDue(rec, { me: 'A', at: NOW, stop: 'slots_full', notAVisit: SHOP.IDLE_NOT_A_VISIT }), true)
  assert.deepStrictEqual(P.stampOfHead({ gen: 7, rec, released: true }), { at: NOW - 90 * MIN, by: 'A', gen: 7, released: true })
  assert.strictEqual(P.servicePick(live({ storehub: { serve: null } }), { now: NOW + MIN, stamps: { canefarm: P.stampOfHead({ gen: 7, rec, released: true }) } }).plot, 'canefarm', 'due again at once')
  assert.strictEqual(P.stampReleaseDue(rec, { me: 'A', at: NOW, stop: 'complete', notAVisit: SHOP.IDLE_NOT_A_VISIT }), false)
  assert.strictEqual(P.stampReleaseDue(rec, { me: 'B', at: NOW, stop: 'slots_full', notAVisit: SHOP.IDLE_NOT_A_VISIT }), false)
  assert.strictEqual(P.stampReleaseDue(rec, { me: 'A', at: NOW - 1, stop: 'slots_full', notAVisit: SHOP.IDLE_NOT_A_VISIT }), false)
  assert.strictEqual(P.stampOfHead({ gen: 1, rec: P.stampNext(null, { me: 'A', now: NOW }), released: true }).at, null, 'never served before: no start')
})
await t('MUTANT KILLED: the exclusive create (wx) replaced by an overwrite -- two bots both win', async () => {
  const SKP = new URL('../src/skills.mjs', import.meta.url)
  const race = M => {
    const dir = fs.mkdtempSync(`${process.env.TMPDIR ?? '/tmp'}/prodserve-claim-`)
    const w = [0, 1].map(i => M.serviceClaim('canefarm', 0, { at: NOW, by: `B${i}` }, dir))
    assert.strictEqual(w.filter(x => x.ok).length, 1)
  }
  await killedBy(SKP, SK, "    const fd = fs.openSync(serviceGenFile(plot, n, dir), 'wx')\n", "    const fd = fs.openSync(serviceGenFile(plot, n, dir), 'w')\n", race)
})

console.log('THE PICKER (shop.mjs activeProject `service`)')
const LIST = SHOP.PROJECTS
const st = (plot, o = {}) => ({ plot, exists: true, complete: true, damaged: false, due: false, ...o })
// every other project stands (the live town: complete, nothing due), so the order is the one under test
const town = (...over) => LIST.filter(p => !p.sink).map(p => over.find(o => o.plot === p.plot) ?? st(p.plot))
await t('LIVE: an open stepwell, a damaged paths record, a ripe cane bed -- without a service pick the cane bed never comes; with one it comes FIRST', () => {
  const over = [st('stepwell', { complete: false }), st('canefarm', { due: 'harvest' }), st('storehub', { due: 'clerk', dueFirst: true })]
  const states = town(st('paths', { damaged: true }), ...over)
  assert.strictEqual(SHOP.activeProject(states, LIST).plot, 'paths', 'the repair tier first (the live order)')
  assert.strictEqual(SHOP.activeProject(town(...over), LIST).plot, 'stepwell', 'then the open project: the farm\'s due waits for good')
  assert.strictEqual(SHOP.activeProject(states, LIST, { service: 'canefarm' }).plot, 'canefarm')
  assert.strictEqual(SHOP.activeProject(states, LIST, { service: 'not-a-plot' }).plot, 'paths', 'a service plot not in the list changes nothing')
})
await t('MUTANT KILLED: the service tier cut from activeProject', async () => {
  const sc = M => assert.strictEqual(M.activeProject([st('paths', { damaged: true }), st('canefarm', { due: 'harvest' })], M.PROJECTS, { service: 'canefarm' }).plot, 'canefarm')
  await killedBy(SHOP_PATH, SHOP, '  if (service) { const sp = list.find(p => p.plot === service); if (sp) return sp }\n', '', sc)
})

console.log('DRESSHOST (towndress.mjs dressOrphans, sinks.mjs sinkWaived)')
// the live record's L1-P3 (project-0_70_0.dress g10) and a lamp on its own post; the world as read 11-06 14:30Z
const air = { name: 'air', boundingBox: 'empty' }, cob = { name: 'cobblestone', boundingBox: 'block' }, torch = { name: 'torch', boundingBox: 'empty' }
const dressRec = (extra = {}) => ({ v: 1, blueprint: 'dress@1', plot: 'dress', kind: 'dress', instances: [{ id: 'L1' }],
  cells: [{ at: [20, 73, -20], role: 'L1-light', seg: 'L1-P3' }, { at: [5, 70, 5], role: 'L1-post', seg: 'L1-P0' }, { at: [5, 71, 5], role: 'L1-light', seg: 'L1-P0' }], ...extra })
const world = (over = {}) => (x, y, z) => over[`${x},${y},${z}`] !== undefined ? over[`${x},${y},${z}`] : (y <= 66 ? cob : air)
await t('LIVE: the wall-top torch over the demolished wall is an orphan; the lamp whose own post is gone is NOT (its post is a repair)', () => {
  const o = TD.dressOrphans(dressRec(), world())
  assert.deepStrictEqual(o.map(c => c.at), [[20, 73, -20]])
})
await t('not an orphan: the host stands, another record\'s live cell is the host (its repair restores it), the light is lit, the read is unknown', () => {
  assert.deepStrictEqual(TD.dressOrphans(dressRec(), world({ '20,72,-20': cob })).map(c => c.at), [])
  assert.deepStrictEqual(TD.dressOrphans(dressRec(), world(), { held: c => c.join(',') === '20,72,-20' }).map(c => c.at), [])
  assert.deepStrictEqual(TD.dressOrphans(dressRec(), world({ '20,73,-20': torch })).map(c => c.at), [])
  assert.deepStrictEqual(TD.dressOrphans(dressRec(), world({ '20,72,-20': null })).map(c => c.at), [])
  assert.deepStrictEqual(TD.dressOrphans(dressRec(), world({ '20,73,-20': null })).map(c => c.at), [])
})
await t('a waived dress light reads waived (damage, the visit, completeness skip it); a decor record never does; SINKWAIVE=off never', () => {
  const rec = dressRec({ waived: { '20,73,-20': { why: 'host_gone' } } })
  assert.strictEqual(S.sinkWaived(rec, rec.cells[0]), true)
  assert.strictEqual(S.sinkWaived(rec, rec.cells[2]), false)
  assert.strictEqual(S.sinkWaived({ ...rec, blueprint: 'decor@1', plot: 'decor' }, rec.cells[0]), false)
  assert.strictEqual(S.sinkWaived(rec, rec.cells[0], false), false)
  assert.deepStrictEqual(S.sinkWaiveDue(rec, [{ k: '20,73,-20', visits: 9 }], { '20,73,-20': { visits: 9, firstAt: 0 } }, NOW), [], 'the stone sinks\' deferral waiver still never takes dress')
})
await t('MUTANTS: the post rule cut, the held rule cut, the host-stands rule cut, dress kept out of sinkWaived -- each killed', async () => {
  const post = M => assert.deepStrictEqual(M.dressOrphans(dressRec(), world()).map(c => c.at), [[20, 73, -20]])
  await killedBy(TD_PATH, TD, '    if (own.has(kOf(s))) continue\n', '', post)
  const held = M => assert.deepStrictEqual(M.dressOrphans(dressRec(), world(), { held: c => c.join(',') === '20,72,-20' }), [])
  await killedBy(TD_PATH, TD, '    if (held(s)) continue\n', '', held)
  const stands = M => assert.deepStrictEqual(M.dressOrphans(dressRec(), world({ '20,72,-20': cob })), [])
  await killedBy(TD_PATH, TD, "    if (!sb || sb.boundingBox === 'block') continue\n", '    if (!sb) continue\n', stands)
  const w = M => { const rec = dressRec({ waived: { '20,73,-20': { why: 'host_gone' } } }); assert.strictEqual(M.sinkWaived(rec, rec.cells[0]), true) }
  await killedBy(SINKS_PATH, S, "export const sinkWaivedKind = kind => sinkWaiveKind(kind) || kind === 'dress'", 'export const sinkWaivedKind = kind => sinkWaiveKind(kind)', w)
})

console.log('THE CHAIN (fake server: the floating light, the visit as buildSink runs it for dress)')
const PAL = { 'L1-light': ['torch'], 'L1-post': ['cobblestone'] }
function project (record) {
  const dir = fs.mkdtempSync(`${process.env.TMPDIR ?? '/tmp'}/prodserve-`)
  const key = PJ.projKey(HOME, 'dress')
  const pub = PJ.publishRecord(dir, key, () => ({ ...record }))
  const slot = PJ.takeSlot(dir, key, 'A', S.SINK_BUILDERS)
  const p = (cur, extra = {}) => ({ dir, key, me: 'A', home: HOME, stood: [], record: cur, recordGen: pub.gen, palette: PAL, slot: slot.slot, slotGen: slot.gen,
    domain: () => true, walkR: 40, foreign: S.SINK_FOREIGN, blockLayer: true, openRole: S.sinkOpenRole, stands: { pending: null, bans: {} }, ...extra })
  return { dir, key, p }
}
// L1-P3's torch 7 over the ground (G + 7: the live 73 over 66), its wall gone; a placed lamp on its post beside the path
const chainRec = () => ({ v: 1, blueprint: 'dress@1', plot: 'dress', kind: 'dress', instances: [{ id: 'L1' }], clear: [], replant: [],
  cells: [{ at: [20, G + 7, 10], role: 'L1-light', seg: 'L1-P3' }, { at: [6, G + 1, 4], role: 'L1-post', seg: 'L1-P0' }, { at: [6, G + 2, 4], role: 'L1-light', seg: 'L1-P0' }],
  segments: [{ seg: 'L1-P3', deps: [] }, { seg: 'L1-P0', deps: [] }] })
const srvRead = srv => (x, y, z) => srv.read(x, y, z)
await t('without the waiver the visit never completes (the live failure); dressOrphans + the waived alsoDone: COMPLETE, nothing placed in the air', async () => {
  const srv = server()
  srv.set([6, G + 1, 4], 'cobblestone'); srv.set([6, G + 2, 4], 'torch')
  const rec = chainRec()
  const pr = project(rec), e = bot(srv, 'A', { inv: { torch: 8, cobblestone: 8 }, feet: [2, G + 1, 2] })
  const stops = []
  for (let v = 0; v < 3; v++) stops.push((await R.runVisit(pr.p(rec, { alsoDone: q => TD.dressSignRole(q.role) }), e, { maxSteps: 400 })).stop)
  assert.ok(!stops.includes('complete'), `the control never completes: ${stops.join(',')}`)
  const o = TD.dressOrphans(rec, srvRead(srv))
  assert.deepStrictEqual(o.map(c => c.at), [[20, G + 7, 10]])
  const cur = { ...rec, waived: Object.fromEntries(o.map(c => [c.at.join(','), { why: 'host_gone' }])) }
  const r = await R.runVisit(pr.p(cur, { alsoDone: q => TD.dressSignRole(q.role) || S.sinkWaived(cur, q) }), e, { maxSteps: 400 })
  assert.strictEqual(r.stop, 'complete', `${r.stop}: ${r.why}`)
  for (let y = G + 1; y <= G + 8; y++) assert.strictEqual(srv.read(20, y, 10).name, 'air', `nothing placed in the column at y ${y}`)
})

console.log('WIRING (source, comments stripped)')
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
const wiring = src => {
  const one = re => { const m = src.match(new RegExp(re, 'g')); assert.strictEqual(m?.length, 1, `${re}: ${m?.length ?? 0}`) }
  one("const svc = PRODSERVE\\.on && b \\? servicePickNow\\(b, marked, now, visit\\) : null")
  one("const c = serviceClaim\\(svc\\.plot, st\\?\\.gen, stamp\\)\\n\\s*if \\(!c\\.ok\\) return null")
  one("const pick = activeProject\\(marked, order, \\{ upkeepTurn: \\(b\\?\\.sinkStreak \\?\\? 0\\) >= SINK_STREAK, service: svc\\?\\.plot \\?\\? null \\}\\)")
  one("if \\(visit && b\\) serviceBegin\\(b, svc, pick, now\\)")
  one("const serve = PRODSERVE\\.on && complete && b && isServicePlot\\(p\\.plot\\) \\? serviceDueOf\\(b, p\\.plot, rec, hubDue, now\\) : null")
  one("serviceEnd\\(ctx\\.bot, r\\?\\.stop\\)")
  one("if \\(plot === HUB_PLOT && rec\\.structure_complete && \\(!recordDamaged\\(bot, rec, \\{ tidy: false \\}\\) \\|\\| bot\\.serviceVisit\\?\\.plot === HUB_PLOT\\) && hubUpkeepDue\\(bot, rec\\)\\) return hubUpkeepVisit\\(ctx, rec, signal, out\\)")
  one("const orphans = held \\? dressOrphans\\(r0, planReader\\(bot\\), \\{ held: c => held\\.has\\(c\\.join\\(','\\)\\) \\}\\)\\.filter\\(c => !sinkWaived\\(r0, c\\)\\) : \\[\\]")
  one("kind === 'dress' \\? \\{ alsoDone: q => dressSignRole\\(q\\.role\\) \\|\\| sinkWaived\\(rec, q\\) \\} : \\{\\}")
}
await t('shopActive picks, stamps and gives back; the hall\'s service runs past a damaged cell; buildSink waives the dress orphans; a cut line fails', () => {
  const src = strip(fs.readFileSync(new URL('../src/skills.mjs', import.meta.url), 'utf8'))
  wiring(src)
  for (const cut of ['serviceEnd(ctx.bot, r?.stop)', ' || bot.serviceVisit?.plot === HUB_PLOT']) {
    assert.ok(src.split(cut).length === 2, `ANCHOR MISSING OR NOT UNIQUE: ${cut}`)
    assert.throws(() => wiring(src.replace(cut, '')), assert.AssertionError, `the mutant without ${cut} must fail the wiring check`)
  }
})

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
