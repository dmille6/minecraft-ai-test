// SITEPREP-01 (bots/src/siteprep.mjs; terrace.mjs gradeTerraces `pin`; sinks.mjs siteSink `prep` + `rejects`; skills.mjs wiring).
// Behaviour: the switch; what prep can fix (earth / water / reach, never a hard refusal); filing; the state table (every live state
// reaches a terminal, the re-preps bounded); expiry; the reservation (its margin, the ONE exempt request); the pinned grading; the
// never-worse walk (an empty baseline proves nothing); the tiers (water last); THE CHAIN on the fake world -- the requester refuses,
// the keeper chooses, the keeper's own runVisit lays the plot, the requester's pinned siting accepts it, and the same pinned siting on
// the untouched world refuses (the positive control); the work on the tidy record and its retirement. Anchored mutants (each anchor
// present and unique, imported fresh); STRUCTURAL assertions only for the skills.mjs wiring (comments stripped).
import assert from 'node:assert'
import { readFileSync, writeFileSync, unlinkSync, mkdtempSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
const { server, bot, HOME, G, PJ } = await import('./helpers/buildfake.mjs')
const RM = await import('../src/buildrun.mjs')
const S = await import('../src/sinks.mjs')
const T = await import('../src/tidy.mjs')
const TR = await import('../src/terrace.mjs')
const P = await import('../src/siteprep.mjs')

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 6).join('\n        ')}`) }
}
const strip = src => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/[ \t]\/\/ .*$/gm, '')
/** A mutant of a src module: its anchor present and UNIQUE (CLAUDE.md), written beside the tests, imported fresh. */
async function withMutant (rel, old, neu, fn) {
  const file = new URL(`../src/${rel}`, import.meta.url)
  const src = readFileSync(file, 'utf8')
  assert.ok(src.includes(old), `ANCHOR MISSING: ${JSON.stringify(old.slice(0, 70))}`)
  assert.strictEqual(src.split(old).length, 2, `ANCHOR NOT UNIQUE: ${JSON.stringify(old.slice(0, 70))}`)
  const out = new URL(`./_mutant-siteprep-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, src.replace(old, neu).replace(/from '\.\//g, "from '../src/"))
  try { return await fn(await import(`${out.href}?${Date.now()}_${Math.random()}`)) } finally { try { unlinkSync(out) } catch {} }
}
/** The scenario passes on the real module and throws on the mutant. */
const killed = async (rel, real, old, neu, scenario) => {
  await scenario(real)
  let k = false
  await withMutant(rel, old, neu, async M => { try { await scenario(M) } catch { k = true } })
  assert.ok(k, `the mutant survived: ${old.slice(0, 60)}`)
}
const AVAIL = { andesite: 400, diorite: 400, granite: 300, stone_bricks: 200 }
const k3 = a => a.join(',')

/** THE FIELD: flat ground with 1x1 holes 3 deep every 3 columns beyond 14 of home (a bot's dug-up surroundings). The requester's only
 *  levels sink its base below the ground (its fill limit is 2), and the sunken pad's approach is unreachable. */
const field = () => {
  const srv = server()
  for (let x = -60; x <= 60; x++) for (let z = -60; z <= 60; z++) if (Math.abs(x) >= 14 && Math.abs(z) >= 14 && ((x % 3) + 3) % 3 === 0 && ((z % 3) + 3) % 3 === 0) for (let y = G - 2; y <= G; y++) srv.set([x, y, z], 'air')
  return srv
}
const CTX = { kind: 'tower', n: 1, id: 'T1', home: HOME, pool: 'test', avail: AVAIL, torch: true, wall: null, zig: null, land: null, stood: [] }
const FROM = []
for (let x = -7; x <= 7; x++) for (let z = -7; z <= 7; z++) if (Math.max(Math.abs(x), Math.abs(z)) === 7) FROM.push([x, z])
const pinOf = (c, id = 'SP1') => ({ id, cx: c.cx, cz: c.cz, B: c.B, seed: c.seed })
const accept = (rd, c) => { const r = S.siteSink(rd, { ...CTX, prep: pinOf(c) }); return { ok: r.ok, why: r.ok ? 'ok' : Object.keys(r.rejects ?? {})[0] ?? r.why } }
const choose = (M, srv) => {
  const cands = M.prepCandidates({ kind: 'tower', home: HOME, pool: 'test', n: 1, avail: AVAIL, torch: true })
  const ranked = M.prepRank(cands, c => M.prepEstimate(c, { ground: M.groundMemo(srv.read, HOME.y), wetCol: M.wetMemo(srv.read, HOME.y), hy: HOME.y }))
  return { cands, ranked, ch: M.prepChoose(srv.read, ranked, { home: HOME, from: FROM, accept }) }
}

console.log('THE SWITCH AND THE CLASSES')
await t('siteprep is on in the showcase pool by default, off in a fleet pool; SITEPREP=on|off decides', () => {
  assert.strictEqual(P.siteprepOn({}, 'showcase'), true)
  assert.strictEqual(P.siteprepOn({}, 'board-b'), false)
  assert.strictEqual(P.siteprepOn({ SITEPREP: 'off' }, 'showcase'), false)
  assert.strictEqual(P.siteprepOn({ SITEPREP: 'on' }, 'board-b'), true)
  assert.strictEqual(P.siteprepOn({ SITEPREP_POOLS: 'board-b,hive-c' }, 'hive-c'), true)
})
await t('prep fixes the earth, the reach (the proof decides) and water (last); never a reservation, furniture, a tree or an unread chunk', () => {
  for (const w of ['fill_deep', 'apron_low', 'cut_deep', 'proof_no_step', 'fill_share']) assert.strictEqual(P.prepClass(w), 'earth', w)
  for (const w of ['liquid', 'base_liquid', 'start_liquid']) assert.strictEqual(P.prepClass(w), 'water', w)
  assert.strictEqual(P.prepClass('proof_unreachable'), 'reach')
  for (const w of ['reserved:project:paths', 'base_built', 'furniture', 'base_tree', 'unknown', 'bill', 'unfunded']) assert.strictEqual(P.prepClass(w), 'hard', w)
  assert.strictEqual(P.prepWorthy({ 'reserved:land:road': 9, base_built: 3 }), false)
  assert.strictEqual(P.prepWorthy({ 'reserved:land:road': 9, fill_deep: 1 }), true)
  assert.strictEqual(P.prepWorthy({ proof_unreachable: 8 }), true)
})

console.log('FILING AND THE STATE TABLE')
await t('a request is filed once a kind: not for a non-slice kind, not without a fixable refusal, not while one is live, not again within the refile wait', () => {
  const now = 1e12
  assert.strictEqual(P.prepFileDecision({ kind: 'road', rejects: { fill_deep: 1 }, now }).why, 'kind')
  assert.strictEqual(P.prepFileDecision({ kind: 'tower', rejects: { base_built: 1 }, now }).why, 'not_worthy')
  const req = P.siteRequest({ kind: 'tower', rejects: { fill_deep: 5 }, now })
  const rec = P.withRequest(null, req, HOME)
  assert.strictEqual(P.prepFileDecision({ kind: 'tower', rec, rejects: { fill_deep: 1 }, now }).why, 'live')
  assert.strictEqual(P.prepFileDecision({ kind: 'shrine', rec, rejects: { fill_deep: 1 }, now }).file, true)
  const dead = P.withStep(rec, P.prepStep(req, { type: 'refused', why: 'x' }, now))
  assert.strictEqual(P.prepFileDecision({ kind: 'tower', rec: dead, rejects: { fill_deep: 1 }, now: now + 3600_000 }).why, 'recent')
  assert.strictEqual(P.prepFileDecision({ kind: 'tower', rec: dead, rejects: { fill_deep: 1 }, now: now + P.PREP.refileMs + 1 }).file, true)
})
await t('mutant: without the live check a second request of the kind is filed', () => killed('siteprep.mjs', P,
  "  if (mine.some(r => LIVE.includes(r.state))) return { file: false, why: 'live' }\n", '',
  M => { const req = M.siteRequest({ kind: 'tower', rejects: { fill_deep: 5 }, now: 1 }); assert.strictEqual(M.prepFileDecision({ kind: 'tower', rec: M.withRequest(null, req, HOME), rejects: { fill_deep: 1 }, now: 2 }).file, false) }))
await t('every live state reaches a terminal; the re-preps are bounded; a terminal takes no event', () => {
  const now = 1
  const f = P.siteRequest({ kind: 'tower', rejects: { fill_deep: 1 }, now })
  for (const s of ['filed', 'prepping', 'prepared']) assert.strictEqual(P.prepStep({ ...f, state: s }, { type: 'expire' }, now).state, 'expired', s)
  const plot = { cx: 1, cz: 1 }
  let q = P.prepStep(f, { type: 'chosen', plot, zone: { box: [0, 0, 0, 0, 0, 0] } }, now)
  assert.strictEqual(q.state, 'prepping')
  q = P.prepStep(q, { type: 'verify_fail', why: 'x' }, now)
  assert.strictEqual(q.state, 'filed'); assert.strictEqual(q.zone, null)
  q = P.prepStep(P.prepStep(q, { type: 'chosen', plot, zone: {} }, now), { type: 'verify_fail', why: 'x' }, now)
  assert.strictEqual(q.state, 'abandoned')
  assert.strictEqual(P.prepStep(q, { type: 'chosen', plot }, now), q)
  let h = P.prepStep(P.prepStep(f, { type: 'chosen', plot, zone: {} }, now), { type: 'verified' }, now)
  assert.strictEqual(h.state, 'prepared')
  h = P.prepStep(h, { type: 'hand_fail', why: 'x' }, now); assert.strictEqual(h.state, 'prepared')
  h = P.prepStep(h, { type: 'hand_fail', why: 'x' }, now); assert.strictEqual(h.state, 'filed')
  assert.strictEqual(P.prepStep(P.prepStep(P.prepStep(f, { type: 'chosen', plot, zone: {} }, now), { type: 'verified' }, now), { type: 'handed', inst: 'T2' }, now).state, 'handed')
  let r = P.prepStep(f, { type: 'chosen', plot, zone: {} }, now)
  r = P.prepStep(P.prepStep(P.prepStep(r, { type: 'retire', why: 'p' }, now), { type: 'chosen', plot, zone: {} }, now), { type: 'retire', why: 'p' }, now)
  assert.strictEqual(r.state, 'abandoned')
})
await t('mutant: without the re-prep bound a failed verify loops for ever', () => killed('siteprep.mjs', P,
  'const back = (field, max, why) => ((Number(req[field]) || 0) + 1 > max', 'const back = (field, max, why) => (false',
  M => { const f = M.siteRequest({ kind: 'tower', now: 1 }); let q = f; for (let i = 0; i < 3; i++) q = M.prepStep(M.prepStep(q, { type: 'chosen', plot: {}, zone: {} }, 1), { type: 'verify_fail' }, 1); assert.strictEqual(q.state, 'abandoned') }))
await t('expiry: filed or prepping past its 48 h, prepared unclaimed past 6 h; a revisit never extends it', () => {
  const f = P.siteRequest({ kind: 'tower', now: 0 })
  assert.strictEqual(P.prepExpire(f, P.PREP.expireMs - 1), null)
  assert.strictEqual(P.prepExpire(f, P.PREP.expireMs).why, 'expired')
  assert.strictEqual(P.prepExpire({ ...f, state: 'prepared', readyAt: 10 }, 10 + P.PREP.readyMs).why, 'unclaimed')
  assert.strictEqual(P.prepExpire({ ...f, state: 'handed' }, 1e15), null)
})

console.log('THE RESERVATION')
await t('the zone is the graded box + the gap (the instance\'s own margin); only the ONE exempt request is dropped, never its kind', () => {
  const z = P.prepZoneOf([10, 10, 20, 20], { id: 'SP1', kind: 'tower' })
  const m = P.PREP.blend + P.PREP.gap
  assert.deepStrictEqual(z.box, [10 - m, -64, 10 - m, 20 + m, 320, 20 + m])
  const rec = { requests: [{ id: 'SP1', state: 'prepping', requester: { kind: 'tower' }, zone: z }, { id: 'SP2', state: 'prepared', requester: { kind: 'tower' }, zone: { ...z, id: 'SP2' } }, { id: 'SP3', state: 'handed', zone: z }] }
  assert.strictEqual(P.prepZones(rec).length, 2)
  assert.deepStrictEqual(P.prepZones(rec, 'SP1').map(q => q.id), ['SP2'])
  assert.strictEqual(P.prepReservation(rec).zones.length, 2)
  assert.strictEqual(P.boxMeetsAny([0, 0, 2, 2], [{ box: [3, 0, 3, 9, 0, 9] }]), false)
  assert.strictEqual(P.boxMeetsAny([0, 0, 4, 4], [{ box: [3, 0, 3, 9, 0, 9] }]), true)
})
await t('mutant: an exemption by more than the id drops every zone', () => killed('siteprep.mjs', P,
  ' && r.id !== except)', ')',
  M => { const rec = { requests: [{ id: 'SP1', state: 'prepping', zone: { box: [0, 0, 0, 1, 1, 1], id: 'SP1' } }] }; assert.strictEqual(M.prepZones(rec, 'SP1').length, 0); assert.strictEqual(M.prepZones(rec, 'SP9').length, 1) }))

console.log('THE PINNED GRADING (terrace.mjs gradeTerraces `pin`)')
await t('a pinned square on a 3-step bump ends exactly at its level, its ramp 1-Lipschitz, and a pin in a refusal fails the grading', () => {
  const srv = server()
  for (let x = 4; x <= 8; x++) for (let z = 4; z <= 8; z++) for (let y = G + 1; y <= G + 3; y++) srv.set([x, y, z], 'dirt')
  const pin = new Map()
  for (let x = 3; x <= 9; x++) for (let z = 3; z <= 9; z++) pin.set(`${x},${z}`, G)
  const gr = TR.gradeTerraces(srv.read, [0, 0, 12, 12], { home: HOME, levels: [], pin, water: 'owner-1101' })
  assert.ok(gr.pins.ok, gr.pins.bad.join(' '))
  for (const k of pin.keys()) assert.strictEqual(gr.H.get(k), G, k)
  assert.strictEqual(gr.cut.length, 75)
  for (const [k, h] of gr.H) { const [x, z] = k.split(',').map(Number); for (const n of [`${x + 1},${z}`, `${x},${z + 1}`]) if (gr.H.has(n)) assert.ok(Math.abs(gr.H.get(n) - h) <= 1, `${k}->${n}`) }
  const bad = TR.gradeTerraces(srv.read, [0, 0, 12, 12], { home: HOME, levels: [], pin, water: 'owner-1101', avoid: (x, z) => (x === 5 && z === 5 ? 'zone' : null) })
  assert.strictEqual(bad.pins.ok, false)
  assert.ok(bad.pins.bad.some(b => b.startsWith('5,5:')))
  const none = TR.gradeTerraces(srv.read, [0, 0, 12, 12], { home: HOME, levels: [], water: 'owner-1101' })
  assert.ok(none.pins.ok && !none.pins.bad.length)
})

console.log('THE NEVER-WORSE WALK')
await t('a walk that starts nowhere proves nothing (refused); a grading that loses a walked column is refused', () => {
  const srv = server()
  const box = [20, 20, 30, 30]
  const far = P.prepWalkOk(srv.read, srv.read, box, { home: HOME, from: [[200, 200]], P: { ...P.PREP, walkPad: 0 } })
  assert.strictEqual(far.why, 'walk_unproven')
  const ok = P.prepWalkOk(srv.read, srv.read, box, { home: HOME, from: FROM })
  assert.ok(ok.ok && ok.before.back > 0, ok.why)
  // a wall of 2-high pillars across the way loses the far columns
  const wall = new Map()
  for (let z = -60; z <= 60; z++) for (const y of [G + 1, G + 2]) wall.set(`10,${y},${z}`, { name: 'stone', boundingBox: 'block' })
  const after = (x, y, z) => wall.get(`${x},${y},${z}`) ?? srv.read(x, y, z)
  assert.strictEqual(P.prepWalkOk(srv.read, after, box, { home: HOME, from: FROM }).why, 'walk_lost')
})
await t('mutant: without the empty-baseline refusal a walk that starts nowhere passes', () => killed('siteprep.mjs', P,
  "  if (!w0.back) return { ok: false, why: 'walk_unproven', before: w0 }\n", '',
  M => { const srv = server(); assert.strictEqual(M.prepWalkOk(srv.read, srv.read, [20, 20, 30, 30], { home: HOME, from: [[200, 200]], P: { ...M.PREP, walkPad: 0 } }).ok, false) }))

console.log('THE TIERS AND THE LAST RESORT')
await t('still shallow water is the last tier; flowing or deep water never; a dry candidate always ranks first', () => {
  const srv = server()
  // a 3x3 still pond, 1 deep, at the first tower spot's centre; flowing water and a 3-deep pond elsewhere
  const pond = (cx, cz, depth, level) => { for (let x = cx - 1; x <= cx + 1; x++) for (let z = cz - 1; z <= cz + 1; z++) for (let y = G - depth + 1; y <= G; y++) srv.set([x, y, z], `water:${level}`) }
  const read = (x, y, z) => { const b = srv.read(x, y, z); if (!b || !String(b.name).startsWith('water:')) return b; return { name: 'water', boundingBox: 'empty', props: { level: Number(b.name.split(':')[1]) } } }
  const est = (cx, cz) => P.prepEstimate({ corner: { x: cx - 2, z: cz - 2 }, B: 5 }, { ground: P.groundMemo(read, HOME.y), wetCol: P.wetMemo(read, HOME.y), still: (x, y, z) => P.stillWater(read(x, y, z)), hy: HOME.y })
  pond(30, 30, 1, 0); pond(-30, 30, 1, 3); pond(30, -30, 3, 0)
  const s = est(30, 30)
  assert.ok(s.ok && s.wet === 9 && s.deep === 1, JSON.stringify(s))
  assert.strictEqual(est(-30, 30).why, 'water_flowing')
  assert.strictEqual(est(30, -30).why, 'water_deep')
  const cands = [{ spot: 0, B: 5, B0: 5, corner: { x: 28, z: 28 }, id: 'wet' }, { spot: 1, B: 5, B0: 5, corner: { x: -50, z: -50 }, id: 'dry' }]
  const ranked = P.prepRank(cands, c => (c.id === 'wet' ? { ok: true, wet: 9, deep: 1, cost: 0 } : { ok: true, wet: 0, deep: 0, cost: 50 }))
  assert.deepStrictEqual(ranked.map(c => [c.id, c.tier]), [['dry', 'same'], ['wet', 'water']])
})
await t('mutant: without the tier order a cheaper other spot outranks the requester\'s own first spot', () => killed('siteprep.mjs', P,
  '.sort((a, b) => tr(a) - tr(b) || ', '.sort((a, b) => ',
  M => { const ranked = M.prepRank([{ spot: 0, B: 7, B0: 7, id: 'same' }, { spot: 1, B: 7, B0: 7, id: 'other' }], c => (c.id === 'same' ? { ok: true, wet: 0, deep: 0, cost: 100 } : { ok: true, wet: 0, deep: 0, cost: 10 })).map(c => c.id); assert.deepStrictEqual(ranked, ['same', 'other']) }))

console.log('THE CHAIN ON THE FAKE WORLD (requester -> request -> keeper -> requester)')
const chainSrv = field()
const chain = choose(P, chainSrv)
await t('the requester refuses the field (its sunken pads are unreachable) and the refusal is one prep may fix', () => {
  const r0 = S.siteSink(chainSrv.read, CTX)
  assert.strictEqual(r0.ok, false)
  assert.ok(Object.keys(r0.rejects).length > 0, 'the tally is carried')
  assert.ok(P.prepWorthy(r0.rejects), JSON.stringify(r0.rejects))
})
await t('the keeper chooses the requester\'s first spot at its own base (tier same), and the plot is the requester\'s own acceptance on the after-world', () => {
  assert.ok(chain.ch.ok, JSON.stringify(chain.ch))
  assert.strictEqual(chain.ch.cand.tier, 'same')
  assert.strictEqual(chain.ch.cand.spot, 0)
  const plot = P.plotOf(chain.ch)
  assert.ok(plot.earth.fill > 0 && plot.earth.fill <= P.PREP.fillMax)
  // the positive control: the same pinned siting on the UNTOUCHED world refuses
  assert.strictEqual(S.siteSink(chainSrv.read, { ...CTX, prep: pinOf(chain.ch.cand) }).ok, false)
  assert.strictEqual(S.siteSink(P.prepAfter(chainSrv.read, chain.ch.grade.work), { ...CTX, prep: pinOf(chain.ch.cand) }).ok, true)
})
await t('the keeper\'s own tidy visit (buildrun.mjs runVisit) lays the prep on the fake server; then the requester\'s pinned siting accepts the REAL world', async () => {
  const req = { ...P.siteRequest({ kind: 'tower', now: 1 }), state: 'prepping', plot: P.plotOf(chain.ch) }
  const rec = P.withPrep(null, req, chain.ch.grade.work, { home: HOME, now: 1 })
  const dir = mkdtempSync(path.join(os.tmpdir(), 'sp-'))
  const key = PJ.projKey(HOME, 'tidy')
  let pub = PJ.publishRecord(dir, key, () => ({ ...rec }))
  const e = bot(chainSrv, 'A', { inv: { cobblestone: 300, dirt: 100 }, feet: [chain.ch.cand.cx, G + 1, chain.ch.cand.cz - 9] })
  for (let i = 0; i < 6; i++) {
    const open = P.prepOpen(rec, req.id, chainSrv.read, c => RM.cellDone(chainSrv.read(...c.at), T.TIDY_PALETTE, c.role))
    if (!open.n) break
    const slot = PJ.takeSlot(dir, key, 'A', 1)
    await RM.runVisit({ dir, key, me: 'A', home: HOME, stood: [], record: rec, tidy: P.prepCutOrder(rec.cut, [0, 0]), recordGen: pub.gen, palette: T.TIDY_PALETTE, slot: slot.slot, slotGen: slot.gen, domain: () => true, walkR: 64, clearMax: 16, tidyKeepOrder: true, deferSpent: true }, e, { maxSteps: 400 })
    PJ.releaseSlot?.(dir, key, 'A', slot.slot, slot.gen)
    pub = PJ.recordHead(dir, key).head ?? pub
  }
  const open = P.prepOpen(rec, req.id, chainSrv.read, c => RM.cellDone(chainSrv.read(...c.at), T.TIDY_PALETTE, c.role))
  assert.strictEqual(open.n, 0, `open after the visits: ${open.cells.length} cells, ${open.cuts.length} cuts`)
  assert.strictEqual(P.prepVerifyDecision({ open: open.n, acc: { ok: S.siteSink(chainSrv.read, { ...CTX, prep: pinOf(chain.ch.cand) }).ok } }), 'verified')
  const sited = S.siteSink(chainSrv.read, { ...CTX, prep: pinOf(chain.ch.cand) })
  assert.strictEqual(sited.meta.prep, 'SP1')
  assert.deepStrictEqual(sited.meta.centre, [chain.ch.cand.cx, chain.ch.cand.cz])
  // the buried fills are cobblestone (the sink), the tops dirt
  const roles = rec.cells.reduce((m, c) => ({ ...m, [c.role]: (m[c.role] ?? 0) + 1 }), {})
  assert.ok(roles.earth > 0)
})

console.log('THE WORK ON THE TIDY RECORD, AND ITS RETIREMENT')
await t('withPrep: dams first, fills in height layers bottom first, buried fills core and tops earth, every cell and cut tagged, the radius covers the plot', () => {
  const work = { dam: [{ at: [40, G, 40] }], fill: [{ at: [30, G - 1, 30] }, { at: [30, G, 30] }, { at: [31, G, 30] }], seal: [{ at: [32, G - 2, 30], opener: [32, G - 1, 30] }], cut: [{ at: [32, G - 1, 30], name: 'dirt' }], leaves: [] }
  const base = { cells: [{ at: [0, G, 0], role: 'earth', seg: 'T-00-0' }], cut: [], clear: [], segments: [{ seg: 'T-00-0', deps: [] }], r: 32, structure_complete: true }
  const r = P.withPrep(base, { id: 'SP4' }, work, { home: HOME, now: 5 })
  assert.deepStrictEqual(r.segments.map(s => s.seg), ['SP4-0D', 'SP4-0L00', 'SP4-0L01', 'SP4-0S', 'T-00-0'])
  assert.deepStrictEqual(r.segments[2].deps, ['SP4-0L00'])
  assert.strictEqual(r.prep.SP4.att, 0)
  // a RE-PREP (attempt 1) installs its own work beside the first attempt's: its own segments, its own attempt mark
  const r2 = P.withPrep(r, { id: 'SP4', verifyFails: 1 }, { dam: [], seal: [], cut: [], leaves: [], fill: [{ at: [50, G, 50] }] }, { home: HOME, now: 6 })
  assert.ok(r2.segments.some(s => s.seg === 'SP4-1L00') && r2.segments.some(s => s.seg === 'SP4-0L00'))
  assert.strictEqual(r2.prep.SP4.att, 1)
  assert.strictEqual(r.cells.find(c => k3(c.at) === k3([30, G - 1, 30])).role, 'core')
  assert.strictEqual(r.cells.find(c => k3(c.at) === k3([30, G, 30])).role, 'earth')
  assert.ok(r.cells.filter(c => c.seg.startsWith('SP4')).every(c => c.prep === 'SP4'))
  assert.strictEqual(r.cut[0].prep, 'SP4')
  assert.strictEqual(r.structure_complete, false)
  assert.ok(r.r >= 42)
  assert.ok(r.prep.SP4)
})
await t('the keeper\'s hold: nothing open verifies; a cell, a clear or a cut still tried is work; only given-up cuts are stuck (retired, never held to expiry)', () => {
  const cut = at => ({ at, name: 'dirt' })
  assert.strictEqual(P.prepHoldOf({ n: 0, cells: [], cuts: [], clears: [] }), 'none')
  assert.strictEqual(P.prepHoldOf(null), 'none')
  assert.strictEqual(P.prepHoldOf({ n: 1, cells: [{ at: [1, 2, 3] }], cuts: [], clears: [] }, () => true), 'work')
  assert.strictEqual(P.prepHoldOf({ n: 2, cells: [], cuts: [cut([1, 2, 3]), cut([4, 5, 6])], clears: [] }, k => k === '1,2,3'), 'work')
  assert.strictEqual(P.prepHoldOf({ n: 2, cells: [], cuts: [cut([1, 2, 3]), cut([4, 5, 6])], clears: [] }, () => true), 'stuck')
  assert.strictEqual(P.prepHoldOf({ n: 2, cells: [], cuts: [cut([1, 2, 3])], clears: [{ at: [0, 0, 0] }] }, () => true), 'work')
  // a seal waiting on a given-up cut is stuck with it; a seal whose cut is still tried, or a plain fill, is work
  assert.strictEqual(P.prepHoldOf({ n: 2, cells: [{ at: [1, 0, 3], opener: [1, 2, 3] }], cuts: [cut([1, 2, 3])], clears: [] }, () => true), 'stuck')
  assert.strictEqual(P.prepHoldOf({ n: 2, cells: [{ at: [1, 0, 3], opener: [1, 2, 3] }], cuts: [cut([1, 2, 3])], clears: [] }, () => false), 'work')
  assert.strictEqual(P.prepHoldOf({ n: 2, cells: [{ at: [1, 0, 3] }], cuts: [cut([1, 2, 3])], clears: [] }, () => true), 'work')
  // THE BACKSTOP: a seal whose opener greened (dirt -> grass: no cut names it, the visit skips the seal as standing) -- three visits
  // that moved nothing and the attempt is stuck; two, still work; nothing open, none whatever the count
  const greened = { n: 1, cells: [{ at: [1, 0, 3], opener: [1, 2, 3] }], cuts: [], clears: [] }
  assert.strictEqual(P.prepHoldOf(greened, () => false, { stalls: 2 }), 'work')
  assert.strictEqual(P.prepHoldOf(greened, () => false, { stalls: 3 }), 'stuck')
  assert.strictEqual(P.prepHoldOf({ n: 0, cells: [], cuts: [], clears: [] }, () => false, { stalls: 9 }), 'none')
})
await t('the stall count: the keeper placing nothing while the helpers fill (open work falling) is progress; three visits with nothing moved and nothing fallen stall', () => {
  let s = null
  for (const n of [40, 34, 28, 20]) { s = P.prepStallNext(s, n, 0); assert.strictEqual(s.stalls, s.n === 40 ? 1 : 0, `n ${n}`) }
  s = P.prepStallNext(s, 20, 0); s = P.prepStallNext(s, 20, 0); s = P.prepStallNext(s, 20, 0)
  assert.strictEqual(s.stalls, 3)
  assert.strictEqual(P.prepHoldOf({ n: 20, cells: [{ at: [0, 0, 0] }], cuts: [], clears: [] }, () => false, { stalls: s.stalls }), 'stuck')
  assert.strictEqual(P.prepStallNext(s, 20, 5).stalls, 0)
  // Codex r6: helpers fill DURING the keeper's third idle visit (20 -> 14, the count read after it): no stall; and fills between
  // visits void the held stalls before the hold is judged
  const two = { n: 20, min: 20, stalls: 2 }
  assert.strictEqual(P.prepStallNext(two, 14, 0).stalls, 0)
  assert.strictEqual(P.prepStallsNow({ n: 20, min: 20, stalls: 3 }, 14), 0)
  assert.strictEqual(P.prepStallsNow({ n: 20, min: 20, stalls: 3 }, 20), 3)
  // Claude r6: open work that rises and falls (an unloaded chunk read as open) resets only below its lowest
  let w = null
  for (const n of [20, 26, 22, 26, 22]) w = P.prepStallNext(w, n, 0)
  assert.strictEqual(w.stalls, 5)
})
await t('mutant: the held stalls blind to helpers filling between visits retire a productive prep', () => killed('siteprep.mjs', P,
  'export const prepStallsNow = (prev, n) => (prev && Number.isFinite(prev.min) && n < prev.min ? 0 : Number(prev?.stalls) || 0)', 'export const prepStallsNow = (prev, n) => (Number(prev?.stalls) || 0)',
  M => assert.strictEqual(M.prepStallsNow({ n: 20, min: 20, stalls: 3 }, 14), 0)))
await t('mutant: a stall count blind to the helpers\' progress retires a prep they are filling', () => killed('siteprep.mjs', P,
  '  if (moved > 0 || (Number.isFinite(lo) && n < lo)) return { n, min, stalls: 0 }', '  if (moved > 0) return { n, min, stalls: 0 }',
  M => { let s = null; for (const n of [40, 34, 28, 20]) s = M.prepStallNext(s, n, 0); assert.strictEqual(s.stalls, 0) }))
await t('mutant: without the stall backstop a greened opener holds the keeper to the expiry', () => killed('siteprep.mjs', P,
  "  if (stalls >= P.stallVisits) return 'stuck'\n", '',
  M => assert.strictEqual(M.prepHoldOf({ n: 1, cells: [{ at: [1, 0, 3], opener: [1, 2, 3] }], cuts: [], clears: [] }, () => false, { stalls: 3 }), 'stuck')))
await t('mutant: without the stuck rule a given-up cut holds the keeper to the expiry', () => killed('siteprep.mjs', P,
  "&& open.cells.every(blocked)) return 'stuck'", "&& false) return 'stuck'",
  M => assert.strictEqual(M.prepHoldOf({ n: 1, cells: [], cuts: [{ at: [1, 2, 3] }], clears: [] }, () => true), 'stuck')))
await t('mutant: without the seal rule a seal under a given-up cut holds the keeper to the expiry', () => killed('siteprep.mjs', P,
  "const blocked = c => Array.isArray(c.opener) && cutK.has(c.opener.join(',')) && given(c.opener.join(','))", 'const blocked = c => false',
  M => assert.strictEqual(M.prepHoldOf({ n: 2, cells: [{ at: [1, 0, 3], opener: [1, 2, 3] }], cuts: [{ at: [1, 2, 3] }], clears: [] }, () => true), 'stuck')))
await t('the cuts come in layers, the highest across the plot first (never a shaft mid-way)', () => {
  const cuts = [[0, 73, 0], [0, 72, 0], [0, 71, 0], [5, 72, 0], [5, 71, 0], [9, 71, 9]].map(at => ({ at, name: 'dirt' }))
  const ys = P.prepCutOrder(cuts, [0, 0]).map(c => c.at[1])
  assert.deepStrictEqual(ys, [73, 72, 72, 71, 71, 71])
})
await t('mutant: lowest layer first digs a shaft', () => killed('siteprep.mjs', P,
  'const ys = [...new Set(cuts.map(c => c.at[1]))].sort((a, b) => b - a)', 'const ys = [...new Set(cuts.map(c => c.at[1]))].sort((a, b) => a - b)',
  M => { const ys = M.prepCutOrder([[0, 73, 0], [0, 72, 0]].map(at => ({ at, name: 'dirt' })), [0, 0]).map(c => c.at[1]); assert.deepStrictEqual(ys, [73, 72]) }))
await t('retirePrep drops the dead request\'s standing cuts and unlaid fills, keeps what closes a dug cut (its seal) and the laid cells; nothing open: null', () => {
  const srv = server()
  const rec = {
    cells: [{ at: [1, G + 1, 1], role: 'core', seg: 'SP2-L00', prep: 'SP2' }, { at: [2, G - 3, 2], role: 'core', seg: 'SP2-S', prep: 'SP2', opener: [2, G, 2] }, { at: [3, G + 1, 3], role: 'earth', seg: 'SP2-L00', prep: 'SP2' }, { at: [0, G + 1, 0], role: 'earth', seg: 'T-00-0' }],
    cut: [{ at: [2, G, 2], name: 'grass_block', prep: 'SP2' }, { at: [4, G, 4], name: 'grass_block', prep: 'SP2' }], clear: [],
    segments: [{ seg: 'SP2-L00', deps: [] }, { seg: 'SP2-S', deps: [] }, { seg: 'T-00-0', deps: [] }],
  }
  srv.set([2, G, 2], 'air')            // the first cut is dug
  srv.set([3, G + 1, 3], 'dirt')       // one fill is laid
  const r = P.retirePrep(rec, 'SP2', srv.read, c => RM.cellDone(srv.read(...c.at), T.TIDY_PALETTE, c.role))
  assert.deepStrictEqual(r.cells.map(c => k3(c.at)).sort(), [k3([0, G + 1, 0]), k3([2, G - 3, 2]), k3([3, G + 1, 3])].sort())
  assert.deepStrictEqual(r.cut.map(c => k3(c.at)), [k3([2, G, 2])])
  assert.ok(r.prepRetired.SP2)
  assert.strictEqual(P.retirePrep(r, 'SP2', srv.read, c => RM.cellDone(srv.read(...c.at), T.TIDY_PALETTE, c.role)), null)
})
await t('mutant: retiring without keeping a dug cut\'s seal leaves the cave open', () => killed('siteprep.mjs', P,
  " || (c.opener && dug.has(c.opener.join(',')))", '',
  M => { const srv = server(); srv.set([2, G, 2], 'air'); const rec = { cells: [{ at: [2, G - 3, 2], role: 'core', seg: 'SP2-S', prep: 'SP2', opener: [2, G, 2] }], cut: [{ at: [2, G, 2], name: 'grass_block', prep: 'SP2' }, { at: [4, G, 4], name: 'grass_block', prep: 'SP2' }], clear: [], segments: [{ seg: 'SP2-S', deps: [] }] }; assert.strictEqual(M.retirePrep(rec, 'SP2', srv.read, () => false).cells.length, 1) }))
await t('successorDue: a finished ziggurat orders its first wanted stone sink (shrines first); none on, none', () => {
  assert.strictEqual(P.successorDue([{ plot: 'monument', complete: true }, { plot: 'shrine', sinkNext: true }, { plot: 'tower', sinkNext: true }]), 'shrine')
  assert.strictEqual(P.successorDue([{ plot: 'monument', complete: true }, { plot: 'tower', sinkNext: true }]), 'tower')
  assert.strictEqual(P.successorDue([{ plot: 'monument', complete: true }]), null)
  assert.strictEqual(P.successorDue([{ plot: 'monument', complete: false }, { plot: 'tower', sinkNext: true }]), null)
})
await t('the hand-over helpers: the claim of a kind, its pin (the plot\'s seed), an instance already tagged', () => {
  const rec = { requests: [{ id: 'SP1', state: 'prepared', requester: { kind: 'tower' }, plot: { cx: 3, cz: 4, B: 7, seed: 99 } }] }
  assert.strictEqual(P.prepClaimFor(rec, 'tower').id, 'SP1')
  assert.strictEqual(P.prepClaimFor(rec, 'shrine'), null)
  assert.deepStrictEqual(P.prepPin(P.prepClaimFor(rec, 'tower')), { id: 'SP1', cx: 3, cz: 4, B: 7, seed: 99 })
  assert.strictEqual(P.prepHandedIn({ instances: [{ id: 'T2', prep: 'SP1' }] }, 'SP1').id, 'T2')
  assert.strictEqual(P.prepHandedIn({ instances: [{ id: 'T2' }] }, 'SP1'), null)
})

console.log('THE WIRING (skills.mjs, structural)')
const SK = strip(readFileSync(new URL('../src/skills.mjs', import.meta.url), 'utf8'))
const W = [
  /if \(sp\) out\.push\(\{ plot: SITEPREP_PLOT, key: projKeyOf\(SITEPREP_PLOT\), head: \{ rec: prepReservation\(sp\) \} \}\)/,
  /const land = projectHeads\(\)\.filter\(x => x\.plot === LAND_PLOT \|\| x\.plot === SITEPREP_PLOT\)/,
  /\.\.\.recordZones\(others\)\.filter\(z => !\(prepExcept && z\?\.id === prepExcept\)\)/,
  /const claim = sp \? prepClaimFor\(sp, kind\) : null/,
  /noSiteUntil: claim \? 0 : \(bot\.sinkNoSite\?\.\[kind\] \?\? 0\)/,
  /const fd = prepFileDecision\(\{ on: true, kind, rec: cur, rejects: r\.rejects \?\? \{\}, now \}\)/,
  /if \(r\.meta\.prep\) \{ const hp = prepPublish\(dir, r\.meta\.prep, \{ type: 'handed', inst: r\.meta\.id \}, me\)/,
  /const r3 = await prepTick\(bot, dir, key, rec, me, signal\)/,
  /const cuts = !caps\.digs \|\| floorOnly \? \[\] : prepNow \? prepCutOrder\(/,
  /if \(q\.state === 'prepping' && !retire\(q\.id\)\) continue/,
  /given: k => guard\.has\(k\) \|\| tidyGivenUp\(mem, k\) \|\| \(isTerrace && !cutAt\.get\(k\)\?\.prep && /,
  /if \(caps\.complete && !crewHeld && !prog\.cutLeft && !prog\.fillLeft && !unread && clearsOk && !prepHold\) \{/,
  /if \(hold === 'stuck'\) \{\n\s*if \(!retire\(q\.id\)\) return head\(\)/,
  /const prepNow = prepSt\?\.hold === 'work' \? prepSt\.id : null/,
  /\[sk\]: prepStallNext\(bot\.prepStalls\?\.\[sk\] \?\? null, prepOpen\(rec, prepNow, fr, prepDoneIn\(fr\)\)\.n, \(r\.placed \?\? 0\) \+ \(r\.cleared \?\? 0\)\)/,
  /const prepSt = !floorOnly && SITEPREP\.on \? prepWorking\(dir, rec, read, prepDone, /,
  /cur\.prep\?\.\[q\.id\]\?\.att !== prepAttempt\(q\) \? withPrep\(/,
  /if \(name === 'snow' \|\| name === 'water'\) \{ try \{ props = b\.getProperties/,
]
await t('the reservation in projectHeads and the dress guard; the one exempt request; the claim first, its wait bypassed; filing; the hand-over; the keeper\'s tick; the layered cuts; retire before expire; the water level read', () => {
  for (const re of W) assert.ok(re.test(SK), String(re))
})
await t('mutants: each wiring line, once broken, fails its assertion', () => {
  const breaks = ['const r3 = await prepTick(bot, dir, key, rec, me, signal)', "if (q.state === 'prepping' && !retire(q.id)) continue", 'const claim = sp ? prepClaimFor(sp, kind) : null', '&& clearsOk && !prepHold) {', '(isTerrace && !cutAt.get(k)?.prep && ']
  for (const b of breaks) {
    assert.strictEqual(SK.split(b).length, 2, `anchor unique: ${b}`)
    assert.ok(W.some(re => !re.test(SK.replace(b, 'BROKEN'))), b)
  }
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
