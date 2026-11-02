// TIDY-01: THE TOWN-GROUND TIDY (tidy.mjs). The fleet towns' ground is wrecked by the bots (34-40% of 4-adjacent ground columns
// differ by 2+; the showcase 14%), so the paths route in 1 of 16 fleet towns. The tidy is the LAST project (no `after`: only a bot
// no other project admits works it): it cuts the bots' 1x1 spoil pillars, fills their small pits (layered, bottom-up) and grades
// the paths' corridors (the legs the paths' router finds with fill/cut 4 and spoil cuttable), then asks the paths again.
// Behaviour on buildfake's flat world (stone below G, grass at G); structural assertions only for wiring.
import assert from 'node:assert'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
const { G, HOME, server, plan, bot, PJ, R } = await import('./helpers/buildfake.mjs')
const T = await import('../src/tidy.mjs')
const P = await import('../src/paths.mjs')
const SHOPM = await import('../src/shop.mjs')
const { placeBlueprint } = await import('../src/buildsite.mjs')

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 5).join('\n        ')}`) }
}
const TIDY_PATH = new URL('../src/tidy.mjs', import.meta.url)
const SKILLS_PATH = new URL('../src/skills.mjs', import.meta.url)
const SHOP_PATH = new URL('../src/shop.mjs', import.meta.url)
async function withMutant (path, old, neu, fn) {
  const src = readFileSync(path, 'utf8')
  assert.ok(src.includes(old), `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 60))} is not in ${path.pathname}`)
  assert.ok(src.split(old).length === 2, 'ANCHOR NOT UNIQUE: the mutant is ambiguous')
  const body = src.replace(old, neu).replace(/from '\.\//g, "from '../src/")
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, body)
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}
const k = a => a.join(',')
const col = (srv, x, z, y0, y1, name) => { for (let y = y0; y <= y1; y++) srv.set([x, y, z], name) }
const dig = (srv, x, z, y0, y1) => col(srv, x, z, y0, y1, 'air')
const survey = (srv, o = {}) => T.surveyTidy(srv.read, { home: HOME, ...o })

console.log('THE SURVEY: PILLARS')
await t('a 1x1 DIRT pillar 3 above every neighbour is cut to the highest neighbour, top first (control: the flat ground has nothing)', async () => {
  const flat = survey(server())
  assert.deepStrictEqual([flat.cut.length, flat.fill.length], [0, 0], 'CONTROL: flat ground is tidy')
  const srv = server(); col(srv, 10, 10, G + 1, G + 3, 'dirt')
  const s = survey(srv)
  assert.strictEqual(s.pillars.length, 1)
  assert.deepStrictEqual(s.cut.map(c => c.at[1]).sort(), [G + 1, G + 2, G + 3])
  const rec = T.tidyRecord(s, { home: HOME })
  assert.deepStrictEqual(rec.cut.map(c => c.at[1]), [G + 3, G + 2, G + 1], 'top first')
  assert.ok(rec.cut.every(c => c.kind === 'tidy' && c.name === 'dirt'))
})
await t('cobblestone (a bot\'s scaffold) is cut; STONE is natural ground and is left; a pillar of 2 is cut, of 1 is not', async () => {
  const srv = server(); col(srv, 10, 10, G + 1, G + 2, 'cobblestone'); col(srv, -10, 10, G + 1, G + 3, 'stone'); col(srv, 10, -10, G + 1, G + 1, 'dirt')
  const s = survey(srv)
  assert.deepStrictEqual(s.cut.map(c => k(c.at)).sort(), [k([10, G + 1, 10]), k([10, G + 2, 10])])
  assert.strictEqual(s.skipped.pillar_natural, 1)
})
await t('a pillar taller than TIDY.pillarMax (out of a ground stand\'s dig reach) is left and named', async () => {
  const srv = server(); col(srv, 10, 10, G + 1, G + 1 + T.TIDY.pillarMax, 'dirt')
  const s = survey(srv)
  assert.deepStrictEqual([s.cut.length, s.skipped.pillar_tall], [0, 1])
})
await t('a NATURAL HILL (a raised 5x5 of dirt) is not a pillar: nothing is cut (smoothing, not flattening)', async () => {
  const srv = server()
  for (let x = 8; x <= 12; x++) for (let z = 8; z <= 12; z++) col(srv, x, z, G + 1, G + 3, 'dirt')
  const s = survey(srv)
  assert.strictEqual(s.cut.length, 0)
})
await t('a pillar in a guarded column (avoid) or holding a record cell is never cut', async () => {
  const srv = server(); col(srv, 10, 10, G + 1, G + 3, 'dirt'); col(srv, -10, -10, G + 1, G + 3, 'dirt')
  const s = survey(srv, { avoid: (x, z) => (x === 10 && z === 10 ? 'zone' : null), cells: new Set([k([-10, G + 2, -10])]) })
  assert.deepStrictEqual([s.cut.length, s.skipped.pillar_guarded], [0, 2])
})

console.log('THE SURVEY: PITS')
await t('a 2x1 hole 3 deep is filled to the lowest rim column, bottom-up layered (control: a 1-deep dip is left)', async () => {
  const srv = server(); dig(srv, -10, 5, G - 2, G); dig(srv, -9, 5, G - 2, G); dig(srv, 10, 5, G, G)
  const s = survey(srv)
  assert.strictEqual(s.pits.length, 1, JSON.stringify(s.skipped))
  assert.deepStrictEqual(s.fill.map(f => k(f.at)).sort(), [[-10, G - 2, 5], [-10, G - 1, 5], [-10, G, 5], [-9, G - 2, 5], [-9, G - 1, 5], [-9, G, 5]].map(k).sort())
  const rec = T.tidyRecord(s, { home: HOME })
  const segOf = new Map(rec.cells.map(c => [k(c.at), c.seg]))
  const s0 = segOf.get(k([-10, G - 2, 5])), s1 = segOf.get(k([-10, G - 1, 5])), s2 = segOf.get(k([-10, G, 5]))
  assert.deepStrictEqual(rec.segments.find(q => q.seg === s1).deps, [s0], 'layer 1 waits on layer 0')
  assert.deepStrictEqual(rec.segments.find(q => q.seg === s2).deps, [s1], 'layer 2 waits on layer 1')
  assert.ok(rec.cells.every(c => c.role === 'earth'))
})
await t('a pit beside WATER is never filled (no water bridging); one deeper than pitDepthMax is a mine, left; one wider than 3 is left', async () => {
  const srv = server(); dig(srv, -10, 5, G - 2, G); srv.set([-11, G, 5], 'water')
  dig(srv, 10, 5, G - 1 - T.TIDY.pitDepthMax, G)
  for (let x = 20; x <= 23; x++) for (let z = 20; z <= 23; z++) dig(srv, x, z, G - 2, G)
  const s = survey(srv)
  assert.strictEqual(s.fill.length, 0)
  assert.ok(s.skipped.pit_water >= 1 && s.skipped.pit_deep >= 1 && s.skipped.pit_wide >= 1, JSON.stringify(s.skipped))
})

console.log('THE VISIT (buildrun.mjs runVisit with the tidy record): cuts dug, fills laid bottom-up')
const visitScene = () => {
  const srv = server()
  col(srv, 8, 4, G + 1, G + 3, 'dirt')            // a pillar
  dig(srv, -8, 4, G - 2, G)                        // a 1x1 pit 3 deep
  const s = survey(srv)
  return { srv, rec: T.tidyRecord(s, { home: HOME }) }
}
const runTidy = async (RM, srv, rec, opts = {}) => {
  const os = await import('node:os'); const path = await import('node:path'); const fsm = await import('node:fs')
  const dir = fsm.mkdtempSync(path.join(os.tmpdir(), 'tidy-'))
  const key = PJ.projKey(HOME, 'tidy')
  const pub = PJ.publishRecord(dir, key, () => ({ ...rec }))
  const slot = PJ.takeSlot(dir, key, 'A', 3)
  const e = bot(srv, 'A', { inv: { dirt: 64, cobblestone: 64 }, feet: [0, G + 1, 0], others: opts.others ?? (() => []), ack: opts.ack ?? (() => 'ok') })
  const mem = new Map()
  let last = null
  for (let v = 0; v < (opts.visits ?? 4); v++) {
    last = await RM.runVisit({ dir, key, me: 'A', home: HOME, stood: [], record: rec, tidy: T.tidyCuts(rec, srv.read, mem), recordGen: pub.gen, palette: T.TIDY_PALETTE, slot: slot.slot, slotGen: slot.gen, domain: () => true, walkR: T.tidyWalkR(rec), clearMax: T.TIDY_CLEAR_MAX, stuckStalledOnly: true }, e, { maxSteps: 400 })
    T.tidyNoteCuts(mem, last.tidied ?? [], kk => { const c = rec.cut.find(q => k(q.at) === kk); return !!c && T.cutStanding(srv.read, c) })
  }
  return { e, last, mem }
}
await t('a visit digs the pillar top first and lays the pit bottom-up; tidyProgress reads it complete', async () => {
  const { srv, rec } = visitScene()
  assert.deepStrictEqual([rec.cut.length, rec.cells.length], [3, 3])
  await runTidy(R, srv, rec)
  for (let y = G + 1; y <= G + 3; y++) assert.strictEqual(srv.read(8, y, 4).name, 'air', `pillar cell ${y} dug`)
  for (let y = G - 2; y <= G; y++) assert.ok(R.cellDone(srv.read(-8, y, 4), T.TIDY_PALETTE, 'earth'), `pit cell ${y} filled`)
  assert.strictEqual(srv.read(-8, G - 2, 4).name, 'dirt', 'the bag\'s dirt first')
  const pr = T.tidyProgress(rec, srv.read, { fillDone: c => R.cellDone(srv.read(...c.at), T.TIDY_PALETTE, c.role) })
  assert.deepStrictEqual([pr.cutLeft, pr.fillLeft], [0, 0])
})
await t('A BOT STANDING IN THE 1x1 PIT is never sealed in: with a body in its bottom cells nothing above them is laid', async () => {
  const { srv, rec } = visitScene()
  // a body in the pit: feet at G-2 (it fills G-2 and G-1)
  await runTidy(R, srv, rec, { others: () => [[-8, G - 2, 4]], visits: 2 })
  assert.strictEqual(srv.read(-8, G, 4).name, 'air', 'the cell above the bot\'s head stays open')
})
// the server refuses the pit's bottom cell (a lag, an entity, a client desync): the layers above it wait -- never a fill set over an
// open cell (a hole under the fill, a 1x1 sealed above whoever stands in it)
const refuseBottom = target => (target[0] === -8 && target[1] === G - 2 && target[2] === 4 ? 'refuse' : 'ok')
await t('a fill whose lower cell cannot be laid waits: nothing is set over the open cell (layered segments)', async () => {
  const { srv, rec } = visitScene()
  await runTidy(R, srv, rec, { ack: refuseBottom, visits: 2 })
  assert.strictEqual(srv.read(-8, G - 2, 4).name, 'air', 'the refused bottom cell')
  assert.strictEqual(srv.read(-8, G - 1, 4).name, 'air', 'nothing over it')
  assert.strictEqual(srv.read(-8, G, 4).name, 'air', 'nothing over it')
})
// (runVisit itself stops at a refused segment, so the visit above cannot tell the layers from one flat segment: the record's own
// dependency is what holds once F4 defers the bottom cell and the visit goes on -- killed on the record)
await t('MUTANT KILLED: without the layer dependency an upper layer no longer waits on the one below', async () => {
  await withMutant(TIDY_PATH, "segments.push({ seg, deps: k > 0 ? [segOf(group, k - 1)] : [] })", 'segments.push({ seg, deps: [] })', async M => {
    const srv = server(); dig(srv, -8, 4, G - 2, G)
    const rec = M.tidyRecord(M.surveyTidy(srv.read, { home: HOME }), { home: HOME })
    const top = rec.cells.find(c => c.at[1] === G)
    assert.deepStrictEqual(rec.segments.find(q => q.seg === top.seg).deps, [], 'the mutant drops the wait')
    // and the deferral path: a deferred bottom segment holds its dependants (buildrun.mjs `deps.some(deferred)`) only with the deps
    const real = T.tidyRecord(T.surveyTidy(srv.read, { home: HOME }), { home: HOME })
    assert.notDeepStrictEqual(real.segments.find(q => q.seg === real.cells.find(c => c.at[1] === G).seg).deps, [])
  })
})
await t('a cut no stand reaches (unread around it) is given up after TIDY_CUT_TRIES evaluated visits; a dug one never is', async () => {
  const mem = new Map()
  for (let i = 0; i < T.TIDY_CUT_TRIES; i++) T.tidyNoteCuts(mem, ['1,2,3', '4,5,6'], kk => kk === '1,2,3')
  assert.strictEqual(T.tidyGivenUp(mem, '1,2,3'), true)
  assert.strictEqual(T.tidyGivenUp(mem, '4,5,6'), false)
  const rec = { cut: [{ at: [1, 2, 3], name: 'dirt' }, { at: [4, 5, 6], name: 'dirt' }] }
  const read = () => ({ name: 'dirt', boundingBox: 'block' })
  assert.deepStrictEqual(T.tidyCuts(rec, read, mem).map(c => k(c.at)), ['4,5,6'])
  assert.strictEqual(T.tidyProgress(rec, read, { fillDone: () => true, given: kk => T.tidyGivenUp(mem, kk) }).cutLeft, 1)
})

console.log('THE GRADING: the paths\' corridors (the refusal chain composed: the paths fail -> the tidy grades -> the paths route)')
// a town whose well stands beyond a 6-high COBBLESTONE terrace across the whole box: the paths' own router may fill or cut 2, and
// never cut cobblestone -- no leg crosses it
const terrace = () => {
  const srv = server()
  for (let x = -60; x <= 60; x++) for (let z = 14; z <= 60; z++) col(srv, x, z, G + 1, G + 6, 'cobblestone')
  return srv
}
const pinOf = () => ({ plan: { ...plan(), plots: [{ id: 'core', kind: 'plaza', box: [-6, -6, 6, 6], keepout: false }] }, caps: [[0, G + 7, 30]], place: placeBlueprint })
await t('CONTROL: the paths do not route over the terrace, and pillars/pits alone change nothing there', async () => {
  const srv = terrace()
  const s = P.sitePaths(srv.read, pinOf())
  assert.strictEqual(s.ok, false); assert.match(s.why, /well:unreachable/)
  const site = T.siteTidy(srv.read, { home: HOME, pin: null })
  const after = P.sitePaths(site.record ? T.tidyOverlay(srv.read, site.record) : srv.read, pinOf())
  assert.strictEqual(after.ok, false, 'no grading: still unrouted')
})
await t('siteTidy with the paths\' inputs grades a corridor; on the ground it leaves the paths\' OWN router routes the well', async () => {
  const srv = terrace()
  const site = T.siteTidy(srv.read, { home: HOME, pin: pinOf() })
  assert.ok(site.record, site.why)
  assert.ok(site.record.grade?.ok, JSON.stringify(site.record.grade))
  assert.ok(site.record.cut.length > 0, 'the terrace edge is cut through')
  const after = P.sitePaths(T.tidyOverlay(srv.read, site.record), pinOf())
  assert.ok(after.ok, after.why)
  assert.strictEqual(site.tried[0].left, 0)
})
await t('MUTANT KILLED: a grading that may not cut the bots\' spoil (cobblestone) leaves the terrace unrouted', async () => {
  await withMutant(TIDY_PATH, 'export const GRADE_CUT = new RegExp(`${NATURAL.source}|${SPOIL.source}`)', 'export const GRADE_CUT = NATURAL', async M => {
    const srv = terrace()
    const site = M.siteTidy(srv.read, { home: HOME, pin: pinOf(), grades: [4] })
    const after = P.sitePaths(site.record ? M.tidyOverlay(srv.read, site.record) : srv.read, pinOf())
    assert.strictEqual(after.ok, false)
  })
})
await t('a grading never cuts beside water (a cut there lets the water in) and never into a record cell', async () => {
  const srv = terrace()
  const site = T.siteTidy(srv.read, { home: HOME, pin: pinOf() })
  const cut0 = site.record.cut[0]
  const srv2 = terrace(); srv2.set([cut0.at[0] + 1, cut0.at[1], cut0.at[2]], 'water')
  const g2 = T.gradeTidy(srv2.read, pinOf(), { lim: T.gradeLim(srv2.read, 4) })
  assert.ok(!g2.cut.some(c => k(c.at) === k(cut0.at)), 'not the wet cell')
  const g3 = T.gradeTidy(srv.read, pinOf(), { cells: new Set(site.record.cut.map(c => k(c.at))), lim: T.gradeLim(srv.read, 4) })
  assert.ok(!g3.cut.some(c => site.record.cut.some(q => k(q.at) === k(c.at))), 'no record cell')
})
// Codex r1 BLOCKER: another project's RESERVATION (box + PROJECT_GAP) is never graded; the grading router goes round it
const RES = (x, z) => (x >= -12 && x <= 12 && z >= 8 && z <= 20 ? 'project:house1' : null)
const inRes = c => RES(c.at[0], c.at[2])
await t('a reservation across the direct line: no grading cell in it; the grading goes round and the paths still route (control: unreserved, the corridor runs through it)', async () => {
  const srv = terrace()
  const free = T.siteTidy(srv.read, { home: HOME, pin: pinOf() })
  assert.ok([...free.record.cut, ...free.record.cells].some(inRes), 'CONTROL: the direct corridor crosses the box')
  const site = T.siteTidy(srv.read, { home: HOME, pin: pinOf(), avoid: RES })
  assert.ok(site.record?.grade?.ok, JSON.stringify(site.tried))
  assert.ok(![...site.record.cut, ...site.record.cells].some(inRes), 'nothing graded in the reservation')
  const after = P.sitePaths(T.tidyOverlay(srv.read, site.record), pinOf())
  assert.ok(after.ok, after.why)
})
await t('MUTANT KILLED: a grading router that ignores the reservation lays a corridor the output guard then breaks: the paths fail', async () => {
  await withMutant(TIDY_PATH, "lim: { ...lim, avoid: (x, z) => (front.has(k2(x, z)) ? null : (reserved(x, z) ? 'reserved' : null)) }", 'lim', async M => {
    const srv = terrace()
    const site = M.siteTidy(srv.read, { home: HOME, pin: pinOf(), avoid: RES, grades: [4] })
    assert.ok(!site.record || ![...site.record.cut, ...site.record.cells].some(inRes), 'the output guard still holds')
    const after = P.sitePaths(site.record ? M.tidyOverlay(srv.read, site.record) : srv.read, pinOf())
    assert.strictEqual(after.ok, false)
  })
})
await t('paths.mjs columnCost: no `lim` is the paths\' own rule (fill/cut 2, natural cuts only); `lim` widens only when given', async () => {
  const srv = server(); col(srv, 0, 0, G + 1, G + 1, 'cobblestone')
  const c = P.pathColumn(srv.read, 0, 0, { yHi: G + 12, yLo: G - 12 })
  assert.strictEqual(P.columnCost(c, G, srv.read, 0, 0), Infinity, 'a cobblestone cut is refused')
  assert.ok(Number.isFinite(P.columnCost(c, G, srv.read, 0, 0, false, T.gradeLim(srv.read, 4))))
  const g = P.pathColumn(server().read, 0, 0, { yHi: G + 12, yLo: G - 12 })
  assert.strictEqual(P.columnCost(g, G + 3, srv.read, 0, 0), Infinity, 'fill 3 refused')
  assert.ok(Number.isFinite(P.columnCost(g, G + 3, server().read, 0, 0, false, T.gradeLim(server().read, 4))))
})

console.log('THE ORDER (shop.mjs): last, no `after`, guards nothing')
const st = (plot, o = {}) => ({ plot, exists: true, complete: false, damaged: false, ...o })
await t('activeProject: the tidy only when no other open project admits the bot; a complete tidy due its re-survey after every open one', async () => {
  const L = SHOPM.PROJECTS.filter(p => ['shop', 'house1', 'tidy'].includes(p.plot))
  assert.strictEqual(SHOPM.activeProject([st('shop', { complete: true }), st('house1'), st('tidy')], L).plot, 'house1')
  assert.strictEqual(SHOPM.activeProject([st('shop', { complete: true }), st('house1', { free: false }), st('tidy')], L).plot, 'tidy')
  assert.strictEqual(SHOPM.activeProject([st('shop', { complete: true }), st('house1', { complete: true }), { plot: 'tidy', exists: false }], L).plot, 'tidy', 'unsited: sited now')
  assert.strictEqual(SHOPM.activeProject([st('shop', { complete: true }), st('house1'), st('tidy', { complete: true, due: true })], L).plot, 'house1')
  assert.strictEqual(SHOPM.PROJECTS[SHOPM.PROJECTS.length - 1].plot, 'tidy')
  assert.strictEqual(SHOPM.PROJECTS.find(p => p.plot === 'tidy').after, undefined)
})
await t('projectsGuarded leaves the tidy out (no footprint, sapling box, zone or siting input); the switch; the light bag rule', async () => {
  const on = SHOPM.projectsOn(true, true, true, true, true, true, true)
  assert.ok(on.some(p => p.plot === 'tidy'))
  assert.ok(!SHOPM.projectsGuarded(on).some(p => p.plot === 'tidy'))
  assert.ok(!SHOPM.projectsOn(true, true, true, true, true, true, false).some(p => p.plot === 'tidy'))
  assert.strictEqual(T.tidyOn({}, 'board-a'), true)
  assert.strictEqual(T.tidyOn({}, 'showcase'), false)
  assert.strictEqual(T.tidyOn({ TIDY: 'off' }, 'board-a'), false)
  assert.strictEqual(T.tidyOn({ TIDY_POOLS: 'showcase' }, 'showcase'), true)
  assert.strictEqual(T.tidyOn({ TIDY_POOLS: 'hive-a' }, 'board-a'), false)
  assert.ok(SHOPM.LIGHT_PLOTS.has('tidy'))
})
await t('MUTANT KILLED: a projectsGuarded that keeps the tidy guards it', async () => {
  await withMutant(SHOP_PATH, '  const l = list.filter(p => p.plot !== TIDY_PLOT)', '  const l = list', async M => {
    assert.ok(M.projectsGuarded(M.projectsOn(true, true, true, true, true, true, true)).some(p => p.plot === 'tidy'))
  })
})
await t('the re-survey clock (48 h after completion; a future stamp is not due) and the paths asked again (a no-site record only)', async () => {
  const now = 10 * 86_400_000
  assert.strictEqual(T.tidyDue({ blueprint: T.TIDY_BLUEPRINT, structure_complete: true, completeAt: now - T.TIDY_RESURVEY_MS }, now), true)
  assert.strictEqual(T.tidyDue({ blueprint: T.TIDY_BLUEPRINT, structure_complete: true, completeAt: now - T.TIDY_RESURVEY_MS + 1000 }, now), false)
  assert.strictEqual(T.tidyDue({ blueprint: T.TIDY_BLUEPRINT, structure_complete: true, completeAt: now + 3_600_000 }, now), false)
  assert.strictEqual(T.tidyDue({ blueprint: T.TIDY_BLUEPRINT, structure_complete: false, completeAt: 0 }, now), false)
  const ns = P.pathsNoSite({ home: HOME, now: now - 1000, why: 'x' })
  const r = T.pathsRetryNow(ns, now, P.pathsNoSiteRec)
  assert.strictEqual(r.retryAt, now)
  assert.strictEqual(P.pathsDue(r, now), true, 'the paths are due at once')
  assert.strictEqual(T.pathsRetryNow({ ...ns, retryAt: now - 1 }, now, P.pathsNoSiteRec), null, 'already due: nothing written')
  assert.strictEqual(T.pathsRetryNow({ blueprint: P.PATHS_BLUEPRINT, state: 'open', cells: [] }, now, P.pathsNoSiteRec), null, 'a laid network is never touched')
  const nothing = T.tidyNothing({ home: HOME, now })
  assert.strictEqual(nothing.structure_complete, true)
})

console.log('WIRING (structural: build_shop reaches the visit; a finished tidy is only due; the paths are asked at completion)')
const code = readFileSync(SKILLS_PATH, 'utf8').split('\n').map(l => l.replace(/^\s*\/\/.*$/, '').replace(/\s+\/\/ .*$/, '')).join('\n')
await t('skills.mjs: build_shop dispatches the tidy; recordDamaged answers its re-survey; completion asks the paths again', async () => {
  assert.strictEqual(code.split('if (proj.plot === TIDY_PLOT) return buildTidy(ctx, args, signal)').length, 2)
  // stationkeep-01: ...or the plaza has a stray table to sweep (strayDue)
  assert.strictEqual(code.split('if (r?.blueprint === TIDY_BLUEPRINT) return tidy && (tidyDue(r) || strayDue(bot))').length, 2)
  assert.strictEqual(code.split('const pp = publishRecord(dir, pk, cur => pathsRetryNow(cur, now, pathsNoSiteRec), { by: me })').length, 2)
  assert.match(code, /async function buildTidy \(ctx, args, signal\)/)
})

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
