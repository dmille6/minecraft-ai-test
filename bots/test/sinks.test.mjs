// PICKER-01 + THE FIRST TOWN SINKS (bots/src/sinks.mjs; shop.mjs activeProject's sink tier, projectsOn, projectsGuarded, buildOrder;
// skills.mjs buildSink wiring). Behaviour: the switch, the pressure and the funding, the picker's gate and order, the project order
// with a sink in it (and exactly as before without one), the seeded designs (deterministic, varied, bounded, only stones the town can
// pay for, never a drop over 3 on a tower), the siting screen and the build proof on the fake flat world, the REAL visit runner
// (buildrun.mjs runVisit) building a tower and a shrine end to end -- and failing without their stairs -- the road segment's rules
// (raised, +-1 steps, stops at water, lamps), the growing record. Anchored mutants (each anchor present and unique) for every rule
// a test leans on; STRUCTURAL source assertions only for the skills.mjs wiring (comments stripped, executable lines).
import assert from 'node:assert'
import fs, { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
const { R, PJ, G, HOME, server, bot } = await import('./helpers/buildfake.mjs')
const S = await import('../src/sinks.mjs')
const SH = await import('../src/shop.mjs')

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 6).join('\n        ')}`) }
}
const strip = src => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/[ \t]\/\/ .*$/gm, '')
const SINKS_PATH = new URL('../src/sinks.mjs', import.meta.url)
const SHOP_PATH = new URL('../src/shop.mjs', import.meta.url)
/** A mutant of a module, its anchor present and unique (CLAUDE.md), imported from the test directory. */
async function withMutant (file, old, neu, fn) {
  const src = readFileSync(file, 'utf8')
  assert.ok(src.includes(old), `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 70))}`)
  assert.ok(src.split(old).length === 2, 'the mutation target is not unique; the mutant is ambiguous')
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, src.replace(old, neu).replace(/from '\.\//g, "from '../src/"))
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}
const killed = async (file, old, neu, scenario) => {
  await scenario(file === SINKS_PATH ? S : SH)
  let k = false
  await withMutant(file, old, neu, async M => { try { await scenario(M) } catch { k = true } })
  assert.ok(k, 'the mutant survived')
}
const AVAIL = { andesite: 400, diorite: 400, granite: 300, stone_bricks: 200, mossy_cobblestone: 200 }

console.log('THE SWITCH')
await t('SINKS: on in the showcase pool only by default; on/off override; SINK_KINDS narrows', () => {
  assert.strictEqual(S.sinksOn({}, 'showcase'), true)
  assert.strictEqual(S.sinksOn({}, 'hive-a'), false)
  assert.strictEqual(S.sinksOn({}, ''), false)
  assert.strictEqual(S.sinksOn({ SINKS: 'off' }, 'showcase'), false)
  assert.strictEqual(S.sinksOn({ SINKS: 'on' }, 'hive-a'), true)
  assert.strictEqual(S.sinksOn({ SINKS_POOLS: '*' }, 'hive-a'), true)
  assert.deepStrictEqual(S.sinkKindsOn({}), ['road', 'tower', 'shrine', 'dress'])   // towndress-01: the fourth sink
  assert.deepStrictEqual(S.sinkKindsOn({ SINK_KINDS: 'tower, shrine' }), ['tower', 'shrine'])
})
await t('projectsOn: the sinks before the tidy only when on (each kind its own); projectsGuarded keeps every sink plot when off', () => {
  const on = SH.projectsOn(true, true, true, true, true, true, true, true, true, true, true, true, ['road', 'tower', 'shrine']).map(p => p.plot)
  assert.deepStrictEqual(on.slice(-4), ['road', 'tower', 'shrine', 'tidy'])
  const off = SH.projectsOn(true, true, true, true, true, true, true, true, true, true, true, false)
  assert.ok(!off.some(p => p.sink), 'SINKS=off: no sink in the order')
  assert.deepStrictEqual(SH.projectsOn(true, true, true, true, true, true, true, true, true, true, true, true, ['tower']).filter(p => p.sink).map(p => p.plot), ['tower'])
  for (const plot of ['road', 'tower', 'shrine', 'dress']) assert.ok(SH.projectsGuarded(off).some(p => p.plot === plot), `${plot} guarded with SINKS off`)
  assert.ok(SH.PROJECTS.filter(p => p.sink).every(p => p.builders === 3), 'three builder slots each')
})
await t('MUTANT KILLED: a projectsGuarded that drops the sinks when off loses a sited tower\'s protection', async () => {
  await killed(SHOP_PATH, 'for (const p of PROJECTS) if (p.sink && !out.some(q => q.plot === p.plot)) out.push(p)', '', M => {
    assert.ok(M.projectsGuarded(M.projectsOn(true, true, true, true, true, true, true, true, true, true, true, false)).some(p => p.plot === 'tower'))
  })
})

console.log('THE PRESSURE, THE FUNDING, THE GATE AND THE ORDER')
await t('sinkPressure: the town\'s cobble family + this bot\'s bag above 64, against TARGET 1,000; an unread town counts as TARGET', () => {
  assert.strictEqual(S.sinkPressure({ town: { cobblestone: 1000 }, coverage: 1, bag: { cobblestone: 64 } }).p, 0, 'at target, the bag at its keep: no pressure')
  assert.ok(S.sinkPressure({ town: { cobblestone: 1000 }, coverage: 1, bag: { cobblestone: 600 } }).p > 0, 'the bag\'s surplus (the showcase: 420-810 a bag)')
  assert.ok(S.sinkPressure({ town: { cobblestone: 900, cobbled_deepslate: 300 }, coverage: 1, bag: {} }).p > 0, 'the family counts')
  assert.ok(S.sinkPressure({ town: { cobblestone: 400 }, coverage: 1, bag: { cobblestone: 300 } }).p < 0, 'below target: the stone goes to the chests, not a sink')
  const u = S.sinkPressure({ town: { cobblestone: 5000 }, coverage: 0.5, bag: { cobblestone: 64 } })
  assert.strictEqual(u.known, false); assert.strictEqual(u.p, 0, 'an unread town is no surplus')
  assert.ok(S.sinkPressure({ town: null, bag: { cobblestone: 400 } }).p > 0, 'an unread town: the bag\'s own surplus still opens a sink')
})
await t('sinkFundable: the bill out of the town ABOVE LOW (256) plus the bag above 64; an unread town gives nothing', () => {
  assert.strictEqual(S.sinkFundable(300, { town: { cobblestone: 556 }, coverage: 1, bag: {} }), true)
  assert.strictEqual(S.sinkFundable(301, { town: { cobblestone: 556 }, coverage: 1, bag: { cobblestone: 64 } }), false)
  assert.strictEqual(S.sinkFundable(300, { town: { cobblestone: 9999 }, coverage: 0.1, bag: { cobblestone: 364 } }), true)
  assert.strictEqual(S.sinkFundable(301, { town: { cobblestone: 9999 }, coverage: 0.1, bag: { cobblestone: 364 } }), false)
})
await t('sinkNextGate: every refusal named; ok only with a positive pressure', () => {
  const P = { p: 0.5 }, rec1 = { instances: [{ id: 'T1' }], structure_complete: true }
  const g = o => S.sinkNextGate({ kind: 'tower', pressure: P, ...o }).why
  assert.strictEqual(g({}), 'ok')
  assert.strictEqual(g({ rec: rec1 }), 'ok', 'a standing record wants its next instance')
  assert.strictEqual(g({ rec: { instances: [{ id: 'T1' }], structure_complete: false } }), 'open')
  assert.strictEqual(g({ openCount: 2 }), 'max_open')
  assert.strictEqual(g({ rec: { instances: Array.from({ length: 8 }, (_, i) => ({ id: `T${i}` })), structure_complete: true } }), 'max_instances')
  assert.strictEqual(g({ noSiteUntil: 10, now: 5 }), 'no_site_wait')
  assert.strictEqual(g({ pressure: { p: 0 } }), 'no_pressure')
  assert.strictEqual(g({ ready: false }), 'not_ready')
  assert.strictEqual(g({ on: false }), 'off')
})
await t('sinkOrder: an open instance first (the oldest), then the rotation after the kind sited last (road -> tower -> shrine)', () => {
  assert.deepStrictEqual(S.sinkOrder({ road: { want: true }, tower: { want: true }, shrine: { want: true } }, null), ['road', 'tower', 'shrine'])
  assert.deepStrictEqual(S.sinkOrder({ road: { want: true }, tower: { want: true }, shrine: { want: true } }, 'road'), ['tower', 'shrine', 'road'])
  assert.deepStrictEqual(S.sinkOrder({ road: { want: true }, tower: { open: true, sitedAt: 5 }, shrine: { open: true, sitedAt: 3 } }, 'tower'), ['shrine', 'tower', 'road'])
  assert.deepStrictEqual(S.sinkOrder({ road: { want: false }, tower: { want: true } }, 'tower'), ['tower'])
  assert.strictEqual(S.lastSitedKind({ road: { instances: [{ sitedAt: 9 }] }, tower: { instances: [{ sitedAt: 12 }] } }), 'tower')
})

console.log('THE PROJECT ORDER WITH A SINK IN IT (shop.mjs activeProject)')
const LIST = SH.PROJECTS.filter(p => ['shop', 'monument', 'storehouse', 'yard', 'road', 'tower', 'shrine', 'tidy'].includes(p.plot))
const done = plot => ({ plot, exists: true, complete: true, damaged: false })
const base = () => [done('shop'), done('monument'), done('storehouse'), done('yard'), { plot: 'road', exists: false, complete: false, damaged: false, sink: true }, { plot: 'tower', exists: false, complete: false, damaged: false, sink: true }, { plot: 'shrine', exists: false, complete: false, damaged: false, sink: true }, { plot: 'tidy', exists: true, complete: false, damaged: false, free: false }]
const set = (st, plot, more) => st.map(s => (s.plot === plot ? { ...s, ...more } : s))
await t('the keeper\'s grounds (another bot\'s, free: false) and a wanted sink: the sink -- not the keeper_held visit (LIVE 11-03: 67 of 101)', () => {
  assert.strictEqual(SH.activeProject(set(base(), 'tower', { sinkNext: true }), LIST).plot, 'tower')
  assert.strictEqual(SH.activeProject(base(), LIST).plot, 'tidy', 'POSITIVE CONTROL: with no sink wanted, exactly as before (the open project, full)')
})
await t('a finite project with a slot comes first; a damaged project (a finished sink too) is a repair, first', () => {
  const st = set(set(base(), 'tower', { sinkNext: true }), 'storehouse', { complete: false })
  assert.strictEqual(SH.activeProject(st, LIST).plot, 'storehouse')
  assert.strictEqual(SH.activeProject(set(set(base(), 'tower', { sinkNext: true }), 'road', { exists: true, complete: true, damaged: true, sinkOpen: false }), LIST).plot, 'road')
})
await t('the bounded upkeep that goes first (dueFirst) before a sink; an ordinary upkeep only on the upkeep turn; no sink when stuck or full', () => {
  const st = set(base(), 'tower', { sinkNext: true })
  assert.strictEqual(SH.activeProject(set(st, 'storehouse', { due: true, dueFirst: true }), LIST).plot, 'storehouse')
  assert.strictEqual(SH.activeProject(set(st, 'monument', { due: true }), LIST).plot, 'tower', 'the ziggurat\'s endless tidy `due` never starves the sink')
  assert.strictEqual(SH.activeProject(set(st, 'monument', { due: true }), LIST, { upkeepTurn: true }).plot, 'monument', '...and the sinks never starve it')
  assert.strictEqual(SH.activeProject(set(st, 'tower', { free: false }), LIST).plot, 'tidy', 'a full sink is not offered')
  assert.strictEqual(SH.activeProject(set(st, 'tower', { stuck: true }), LIST).plot, 'tidy', 'a stuck sink is not offered')
  assert.strictEqual(SH.activeProject(set(st, 'shrine', { sinkOpen: true, exists: true }), SH.PROJECTS.filter(p => LIST.includes(p))).plot, 'tower', 'the list order is the picker\'s (shopActive sorts it): the first offered')
})
await t('never a sink as the fallback (everything stands, nothing wanted)', () => {
  const st = base().map(s => (s.plot === 'tidy' ? done('tidy') : s))
  assert.strictEqual(SH.activeProject(st, LIST).plot, 'tidy')
  assert.strictEqual(SH.activeProject(st, LIST.filter(p => p.plot !== 'tidy')).plot, 'yard')
})
await t('MUTANT KILLED: the old `open.find(free) ?? open[0]` sends the bot to the keeper\'s grounds', async () => {
  await killed(SHOP_PATH, '  if (open.length && !sink) return open[0]\n', '  if (open.length) return open[0]\n', M => {
    assert.strictEqual(M.activeProject(set(base(), 'tower', { sinkNext: true }), LIST).plot, 'tower')
  })
})
await t('MUTANT KILLED: without the upkeep turn an ordinary upkeep never runs while a sink is wanted', async () => {
  await killed(SHOP_PATH, '    if (upkeepTurn) for (const p of list)', '    if (false) for (const p of list)', M => {
    assert.strictEqual(M.activeProject(set(set(base(), 'tower', { sinkNext: true }), 'monument', { due: true }), LIST, { upkeepTurn: true }).plot, 'monument')
  })
})
await t('buildOrder: with a sink active the copper run is asked first and the expedition is told the projects are done; a sink is a light plot', () => {
  const asks = []
  SH.setActivePlot(() => 'tower')
  SH.setCopperAsk(() => { asks.push('copper'); return null })
  SH.setExpeditionAsk(a => { asks.push(`exp:${a.complete}`); return null })
  const r = SH.buildOrder({ on: true, atTown: true, now: 1e12, state: {}, record: null, complete: false, freeSlots: 3 })
  assert.deepStrictEqual(asks, ['copper', 'exp:true'])
  assert.deepStrictEqual(r.order, { skill: 'build_shop', args: {} }, 'a bag with 3 free slots still builds a sink (bag cobble)')
  assert.strictEqual(SH.orderCooldown('tower'), S.SINK.cooldownMs)
  SH.setActivePlot(() => 'house1'); asks.length = 0
  SH.buildOrder({ on: true, atTown: true, now: 1e12, state: {}, record: null, complete: false })
  assert.deepStrictEqual(asks, [], 'POSITIVE CONTROL: a finite project open: no ask')
  SH.setCopperAsk(null); SH.setExpeditionAsk(null); SH.setActivePlot(() => null)
})

console.log('THE SEEDED DESIGNS (owner 10-29/11-02: shape, palette and details fixed at siting, never one template)')
const seeds = Array.from({ length: 40 }, (_, i) => S.sinkSeed('tower', 'showcase', HOME, i + 1))
await t('deterministic: the same seed and stock give the same design (a restart never re-rolls a sited design)', () => {
  for (const sd of seeds.slice(0, 5)) assert.deepStrictEqual(S.towerDesign(sd, { avail: AVAIL, torch: true }), S.towerDesign(sd, { avail: AVAIL, torch: true }))
  assert.notStrictEqual(S.sinkSeed('tower', 'showcase', HOME, 1), S.sinkSeed('tower', 'hive-a', HOME, 1), 'the pool is in the seed')
})
await t('varied: 40 towers give >= 12 distinct designs over >= 3 bases, 2 tier heights, both spirals, 4 crowns, 4 patterns, >= 4 stones', () => {
  const ds = seeds.map(sd => S.towerDesign(sd, { avail: AVAIL, torch: true }))
  const u = f => new Set(ds.map(f)).size
  assert.ok(u(d => S.designSummary(d)) >= 12, `distinct ${u(d => S.designSummary(d))}`)
  assert.ok(u(d => d.g.B) >= 3 && u(d => d.g.H) >= 2 && u(d => d.g.spin) === 2 && u(d => d.crown) === 4 && u(d => d.palette.pattern) === 4)
  assert.ok(new Set(ds.flatMap(d => [d.palette.a, d.palette.b])).size >= 4)
  const zs = seeds.map(sd => S.shrineDesign(sd, { avail: AVAIL, torch: true }))
  assert.ok(new Set(zs.map(d => S.designSummary(d))).size >= 12 && new Set(zs.map(d => `${d.g.S}${d.g.H}`)).size >= 3 && new Set(zs.map(d => d.g.all4)).size === 2)
})
await t('bounded and safe: every design valid (stepShapeWhy), its body under the bill cap, no tower tier over 3 (no fall damage)', () => {
  for (const sd of seeds) {
    for (const d of [S.towerDesign(sd, { avail: AVAIL, torch: true }), S.shrineDesign(sd, { avail: AVAIL })]) {
      assert.strictEqual(S.stepShapeWhy(d.g), null, S.designSummary(d))
      assert.ok(S.stepBody(d.g).length + S.stepCrown(d.g, d.crown, { lights: true, fire: true }).length <= S.SINK.billMax, S.designSummary(d))
      assert.ok(d.g.H <= 3)
    }
  }
})
await t('only stones the town can pay for; cobblestone alone with an empty stock; every role ends in cobblestone (no cell waits on a stone)', () => {
  for (const sd of seeds.slice(0, 15)) {
    const d = S.towerDesign(sd, { avail: { andesite: 1000 } })
    assert.ok([d.palette.a, d.palette.b].every(n => n == null || n === 'cobblestone' || n === 'andesite'))
    const e = S.towerDesign(sd, { avail: {} })
    assert.strictEqual(e.palette.b, null); assert.strictEqual(e.palette.a, 'cobblestone'); assert.strictEqual(e.palette.pattern, 'solid')
    const inst = S.stepInstance('T1', d, { corner: { x: 0, z: 0 }, baseY: 70 })
    for (const [role, names] of Object.entries(inst.palette)) if (!/-(light|fire)$/.test(role)) assert.ok(names.includes('cobblestone'), role)
  }
  assert.deepStrictEqual(S.affordable({ diorite: 10 }, 7), [], '60% of the stock is the share a design may spend')
  assert.deepStrictEqual(S.affordable({ diorite: 12 }, 7), ['diorite'])
})

console.log('THE BODY: EVERY CLIMB +1')
const climbable = g => {
  // the walk over the finished body, from the ground: every summit cell reached by 4-neighbour steps of -1..+1 (a stand is a solid
  // with two free cells above), the shape's own geometry only
  const solid = new Set(), B = g.B
  for (const c of S.stepBody(g)) solid.add(`${c.i},${c.l},${c.j}`)
  const sol = (i, l, j) => l < 0 || solid.has(`${i},${l},${j}`)
  const node = (i, l, j) => sol(i, l - 1, j) && !sol(i, l, j) && !sol(i, l + 1, j)
  const seen = new Set(), q = []
  for (let i = -3; i < B + 3; i++) for (let j = -3; j < B + 3; j++) if ((i < 0 || j < 0 || i >= B || j >= B) && node(i, 0, j)) { seen.add(`${i},0,${j}`); q.push([i, 0, j]) }
  while (q.length) {
    const [i, l, j] = q.pop()
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) for (const dl of [0, 1, -1]) {
      const a = i + di, b = j + dj, c = l + dl
      if (a < -3 || b < -3 || a > B + 2 || b > B + 2 || c < 0) continue
      if (dl === 1 && sol(i, l + 2, j)) continue
      if (dl === -1 && sol(a, l + 1, b)) continue
      if (!node(a, c, b)) continue
      const k = `${a},${c},${b}`; if (!seen.has(k)) { seen.add(k); q.push([a, c, b]) }
      break
    }
  }
  const top = g.n * g.H, o = g.S * (g.n - 1)
  return seen.has(`${o + (B - 2 * o - 1) / 2},${top},${o + (B - 2 * o - 1) / 2}`)
}
await t('every tower and shrine summit is walked to from the ground by +-1 steps (the stairs: perp and along, both spirals, 4 faces)', () => {
  for (const sd of seeds) for (const d of [S.towerDesign(sd, { avail: AVAIL }), S.shrineDesign(sd, { avail: AVAIL })]) assert.ok(climbable(d.g), S.designSummary(d))
})
await t('MUTANT KILLED: four stair faces on 1-wide terraces stack one stair on the next (a +2): refused by the shape rule', async () => {
  const g = { B: 9, S: 1, H: 2, n: 3, W: 3, stairs: 'perp', spin: 1, face0: 's', all4: true }
  assert.strictEqual(S.stepShapeWhy(g), 'all4_needs_S2')
  assert.strictEqual(climbable(g), false, 'the shape the rule refuses is indeed unclimbable')
  await withMutant(SINKS_PATH, "  if (g.all4 && g.S === 1 && g.H > 1 && g.n > 1) return 'all4_needs_S2'\n", '', async M => {
    assert.ok(seeds.some(sd => !climbable(M.shrineDesign(sd, { avail: AVAIL }).g)), 'without the rule a seeded shrine cannot be climbed')
  })
})
await t('MUTANT KILLED: without the `along` stair run a 3-high tier cannot be climbed', async () => {
  const g = { B: 7, S: 1, H: 3, n: 3, W: 1, stairs: 'along', spin: 1, face0: 's', all4: false }
  assert.ok(climbable(g))
  await withMutant(SINKS_PATH, '      for (let k = 0; k < run; k++) { const [i, j] = at(start + dir * k, 1); for (let h = 0; h <= k; h++) out.push({ i, j, l: l0 + h }) }', '', async M => {
    const solid = new Set(M.stepBody(g).map(c => `${c.i},${c.l},${c.j}`))
    assert.ok(![...solid].some(k => M.stairCells(g, 1).length), 'the mutant drops the run')
    assert.strictEqual(M.stairCells(g, 1).length, 0)
  })
})

console.log('THE SITE AND THE PROOF (sinks.mjs siteSink on the fake flat world)')
const flatSite = (kind, more = {}) => S.siteSink(server().read, { kind, n: 1, id: `${S.SINK_LETTER[kind]}1`, home: HOME, pool: 'test', avail: AVAIL, torch: true, wall: null, zig: null, land: null, stood: [], ...more })
await t('a tower sites on open flat ground, proven (reach from home, every cell a step), clear of a reservation', () => {
  const r = flatSite('tower')
  assert.ok(r.ok, JSON.stringify(r))
  assert.ok(r.inst.cells.length > 50 && r.meta.box.every(Number.isFinite))
  const guard = (x, z) => (Math.abs(x) >= 18 ? 'zone' : null)
  assert.strictEqual(flatSite('tower', { guard }).ok, false, 'every candidate reserved: no site')
})
await t('screenStepped: fill <= 3 a column, never a cut under sand, liquid within one column refuses', () => {
  const srv = server()
  const g = { B: 5, S: 1, H: 2, n: 2, W: 1, stairs: 'perp', spin: 1, face0: 's', all4: false }
  assert.ok(S.screenStepped(srv.read, { x0: 20, z0: 20, g, hy: HOME.y }).ok)
  srv.set([18, G, 22], 'water')
  assert.match(S.screenStepped(srv.read, { x0: 20, z0: 20, g, hy: HOME.y }).why, /liquid/)
  const s2 = server(); for (let y = G - 4; y <= G; y++) s2.set([22, y, 22], 'air')
  assert.ok(['fill_deep', 'cut_deep'].includes(S.screenStepped(s2.read, { x0: 20, z0: 20, g, hy: HOME.y }).why) || S.screenStepped(s2.read, { x0: 20, z0: 20, g, hy: HOME.y }).L < G, 'a 5-deep hole under the base is never filled')
  // Codex r1 BLOCKER 1: water beside the TOP of a cut (L+3 here) refuses -- the cut would release it
  const s5 = server(); for (let y = G + 1; y <= G + 3; y++) s5.set([22, y, 22], 'dirt'); s5.set([22, G + 3, 27], 'water')
  assert.strictEqual(S.screenStepped(s5.read, { x0: 20, z0: 20, g, hy: HOME.y }).why, 'liquid', 'water at L+3 beside a cut to L+3')
  const s6 = server(); for (let y = G + 1; y <= G + 3; y++) s6.set([22, y, 22], 'dirt')
  assert.ok(S.screenStepped(s6.read, { x0: 20, z0: 20, g, hy: HOME.y }).ok, 'POSITIVE CONTROL: the same cut with no water is sited')
  const s3 = server(); s3.set([21, G + 1, 21], 'dirt'); s3.set([21, G + 2, 21], 'sand')
  const r3 = S.screenStepped(s3.read, { x0: 20, z0: 20, g, hy: HOME.y })
  assert.ok(!r3.ok || !r3.clear.some(c => c.kind === 'cut' && c.at[0] === 21 && c.at[2] === 21), 'sand, and the dirt under it, are never cut: built over at its level or refused')
  const s4 = server(); s4.set([21, G + 1, 21], 'dirt')
  const r4 = S.screenStepped(s4.read, { x0: 20, z0: 20, g, hy: HOME.y })
  assert.ok(r4.ok && r4.L === G && r4.clear.some(c => c.kind === 'cut' && c.at.join() === [21, G + 1, 21].join()), 'POSITIVE CONTROL: the same bump of dirt alone is cut')
})

await t('MUTANT KILLED: a liquid check that stops at L+2 sites a cut to L+3 beside water (Codex r1 BLOCKER 1)', async () => {
  const g = { B: 5, S: 1, H: 2, n: 2, W: 1, stairs: 'perp', spin: 1, face0: 's', all4: false }
  const site = M => { const w = server(); for (let y = G + 1; y <= G + 3; y++) w.set([22, y, 22], 'dirt'); w.set([22, G + 3, 27], 'water'); return M.screenStepped(w.read, { x0: 20, z0: 20, g, hy: HOME.y }) }
  assert.strictEqual(site(S).why, 'liquid')
  await withMutant(SINKS_PATH, '  const yTop = Math.max(L + 2, ...cols.map(([, , gr]) => gr.y + 1))\n', '  const yTop = L + 2\n', async M => {
    const r = site(M)
    assert.ok(r.ok && r.clear.some(c => c.kind === 'cut' && c.at[1] === G + 3), 'the mutant cuts beside the water')
  })
})

console.log('THE REAL VISIT RUNNER BUILDS IT (buildrun.mjs runVisit on the fake server)')
const runAll = async (rec, { names = ['A'], inv = () => ({ cobblestone: 3000, ...AVAIL, torch: 40, campfire: 2 }), steps = 4000 } = {}) => {
  const srv = server()
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sinks-'))
  const key = PJ.projKey(HOME, rec.plot)
  const pub = PJ.publishRecord(dir, key, () => ({ ...rec }))
  const out = []
  for (let round = 0; round < 6; round++) {
    const rs = await Promise.all(names.map(async n => {
      const sl = PJ.takeSlot(dir, key, n, 3)
      const e = bot(srv, n, { inv: inv(), feet: [2, HOME.y, 0] })
      const r = await R.runVisit({ dir, key, me: n, home: HOME, stood: [], record: rec, recordGen: pub.gen, palette: rec.palette, slot: sl.slot, slotGen: sl.gen, ...S.sinkVisitOpts(rec, HOME) }, e, { maxSteps: steps })
      PJ.releaseLease(dir, key, `slot${sl.slot}`, n, sl.gen)
      return r
    }))
    out.push(...rs)
    if (rs.some(r => r.stop === 'complete')) break
  }
  const doneN = rec.cells.filter(c => R.cellDone(srv.read(...c.at), rec.palette, c.role)).length
  return { srv, out, doneN }
}
const towerRec = () => { const r = flatSite('tower'); assert.ok(r.ok); return S.appendInstance(null, { kind: 'tower', home: HOME, inst: r.inst, meta: { ...r.meta, sitedAt: 1 } }) }
await t('one builder builds a sited tower end to end: every cell done, `complete`', async () => {
  const rec = towerRec()
  const { out, doneN } = await runAll(rec)
  assert.strictEqual(doneN, rec.cells.length, JSON.stringify(out.map(r => [r.stop, r.why, r.placed])))
  assert.ok(out.some(r => r.stop === 'complete'))
})
await t('three builders together build it too (3 slots, quadrant segments: no lease conflict stops them)', async () => {
  const rec = towerRec()
  const { out, doneN } = await runAll(rec, { names: ['A', 'B', 'C'] })
  assert.strictEqual(doneN, rec.cells.length, JSON.stringify(out.map(r => [r.stop, r.why, r.placed])))
  assert.ok(out.filter(r => r.placed > 0).length >= 2, 'more than one builder placed')
})
await t('a shrine beside a ziggurat sites in its slots, clear of the ziggurat box, and builds end to end', async () => {
  const zig = { plot: 'monument', box: [-12, -12, 12, 12], face: 'e' }
  const guard = (x, z) => (x >= -15 && x <= 15 && z >= -15 && z <= 15 ? 'project:monument' : null)
  const r = flatSite('shrine', { zig, guard, guardShrine: guard })
  assert.ok(r.ok, JSON.stringify(r))
  const b = r.meta.box
  assert.ok(b[2] < -15 || b[0] > 15 || b[3] < -15 || b[1] > 15, 'outside the ziggurat\'s zone')
  assert.ok(r.meta.slot !== 'e', 'never in front of the stair face')
  const rec = S.appendInstance(null, { kind: 'shrine', home: HOME, inst: r.inst, meta: { ...r.meta, sitedAt: 1 } })
  const { doneN, out } = await runAll(rec)
  assert.strictEqual(doneN, rec.cells.length, JSON.stringify(out.map(x => [x.stop, x.why])))
  // twins: the next free slot of the same pair carries the same design
  const r2 = flatSite('shrine', { n: 2, id: 'Z2', zig, guard: (x, z) => guard(x, z) ?? (x >= b[0] - 3 && x <= b[2] + 3 && z >= b[1] - 3 && z <= b[3] + 3 ? 'Z1' : null), guardShrine: (x, z) => guard(x, z) ?? (x >= b[0] - 3 && x <= b[2] + 3 && z >= b[1] - 3 && z <= b[3] + 3 ? 'Z1' : null), rec })
  assert.ok(r2.ok)
  if (r2.meta.pair === r.meta.pair) assert.strictEqual(r2.meta.summary.replace(/cw|ccw|4/, ''), r.meta.summary.replace(/cw|ccw|4/, ''), 'a pair shares its design')
})
await t('MUTANT KILLED: a tower without its ground stair is never finished from the ground (the proof refuses it; the visit cannot complete it)', async () => {
  await withMutant(SINKS_PATH, '  if (g.H <= 1) return []\n', '  if (g.H >= 1) return []\n', async M => {
    const r = M.siteSink(server().read, { kind: 'tower', n: 1, id: 'T1', home: HOME, pool: 'test', avail: AVAIL, torch: true, stood: [] })
    if (r.ok) {
      const rec = M.appendInstance(null, { kind: 'tower', home: HOME, inst: r.inst, meta: { ...r.meta, sitedAt: 1 } })
      const { doneN } = await runAll(rec)
      assert.ok(doneN < rec.cells.length, 'without stairs the upper tiers stay open')
    } else assert.match(r.why, /no_proven_site|no_site/)
  })
})

console.log('ROADS')
const RAIL = { spoke: 's0', from: [0, -20], to: [0, -400] }
const STYLE = S.roadStyle(7, { avail: AVAIL, torch: true })
await t('a road segment: 16 cross-sections 3 wide, raised 1 over the ground, lamps on alternating edges, its own segments', () => {
  const r = S.roadSegment(server().read, { id: 'R1', rail: RAIL, k: 0, style: STYLE, hy: HOME.y, home: HOME })
  assert.ok(r.ok && r.full, JSON.stringify(r).slice(0, 200))
  const surf = r.cells.filter(c => !/-(post|light)$/.test(c.role))
  assert.strictEqual(surf.length, 48)
  assert.ok(surf.every(c => c.at[1] === G + 1), 'one above the flat ground')
  assert.strictEqual(r.cells.filter(c => c.role === 'R1-light').length, 2)
  assert.deepStrictEqual(r.end, { t: 15, y: G + 1 })
})
await t('the surface steps +-1 at most (a 3-high bump is ramped), stops before water, refuses a start 2 off the last segment', () => {
  const srv = server()
  for (let x = -1; x <= 1; x++) for (let y = G + 1; y <= G + 3; y++) srv.set([x, y, -28], 'stone')
  const r = S.roadSegment(srv.read, { id: 'R1', rail: RAIL, k: 0, style: { ...STYLE, lamp: false }, hy: HOME.y, home: HOME })
  const ys = [...new Set(r.cells.filter(c => c.at[0] === 0 && !/-core$/.test(c.role)).map(c => `${c.at[2]}:${c.at[1]}`))].map(s => s.split(':').map(Number)).sort((a, b) => b[0] - a[0])
  for (let i = 1; i < ys.length; i++) assert.ok(Math.abs(ys[i][1] - ys[i - 1][1]) <= 1, JSON.stringify(ys))
  const w = server(); w.set([0, G, -30], 'water')
  const rw = S.roadSegment(w.read, { id: 'R1', rail: RAIL, k: 0, style: STYLE, hy: HOME.y, home: HOME })
  assert.ok(rw.ok && !rw.full && rw.cells.every(c => c.at[2] > -29), 'it stops a column short of the water')
  assert.strictEqual(S.roadSegment(server().read, { id: 'R2', rail: RAIL, k: 1, style: STYLE, prevY: G - 2, hy: HOME.y, home: HOME }).why, 'step_from_prev')
  assert.strictEqual(S.roadSegment(server().read, { id: 'R2', rail: RAIL, k: 1, style: STYLE, prevY: G + 3, hy: HOME.y, home: HOME }).ok, true, 'a higher last end is ramped down to')
})
await t('a road grows: segment k+1 starts where k ended, clear of every record but the road\'s own (Codex r1 BLOCKER 2)', () => {
  const k0 = S.roadSegment(server().read, { id: 'R1', rail: RAIL, k: 0, style: STYLE, hy: HOME.y, home: HOME })
  const road = S.appendInstance(null, { kind: 'road', home: HOME, inst: k0, meta: { id: 'R1', n: 1, spoke: 's0', k: 0, box: k0.box, end: k0.end, sitedAt: 1 } })
  const tower = { plot: 'tower', zones: [{ box: [40, -64, 40, 45, 320, 45], why: 'project:tower:T1' }] }
  const guardOf = recs => { const zs = SH.recordZones(recs); return (x, z) => zs.find(q => x >= q.box[0] && x <= q.box[3] && z >= q.box[2] && z <= q.box[5])?.why ?? null }
  const land = { roads: [{ id: 's0', kind: 'spoke', rail: { from: RAIL.from, to: RAIL.to } }] }
  const site = recs => S.siteSink(server().read, { kind: 'road', n: 2, id: 'R2', home: HOME, pool: 'test', avail: AVAIL, torch: true, land, rec: road, guard: guardOf(recs), stood: [] })
  assert.strictEqual(site([road, tower]).ok, false, 'the bug: with the road\'s own zone the next segment is reserved')
  const r = site(S.guardRecords([road, tower], 'road'))
  assert.ok(r.ok && r.meta.k === 1, JSON.stringify(r.tried))
  assert.ok(Math.max(...r.inst.cells.map(c => c.at[2])) < Math.min(...k0.cells.map(c => c.at[2])) + 1, 'it continues outward')
  assert.deepStrictEqual(S.guardRecords([road, tower], 'tower'), [road, tower], 'every other kind keeps every record')
})
await t('MUTANT KILLED: without the envelope the road climbs a 3-high bump in one step', async () => {
  const srv = server()
  for (let x = -1; x <= 1; x++) for (let y = G + 1; y <= G + 3; y++) srv.set([x, y, -28], 'stone')
  const steep = M => { const r = M.roadSegment(srv.read, { id: 'R1', rail: RAIL, k: 0, style: { ...STYLE, lamp: false }, hy: HOME.y, home: HOME }); const m = new Map(r.cells.filter(c => c.at[0] === 0 && !/-core$/.test(c.role)).map(c => [c.at[2], c.at[1]])); for (const [z, y] of m) if (m.has(z - 1) && Math.abs(m.get(z - 1) - y) > 1) return true; return false }
  assert.strictEqual(steep(S), false)
  await withMutant(SINKS_PATH, '  for (let i = secs.length - 2; i >= 0; i--) secs[i].y = Math.max(secs[i].y, secs[i + 1].y - 1)\n', '\n', async M => assert.strictEqual(steep(M), true))
})

console.log('THE GROWING RECORD')
await t('appendInstance: cells, segments, roles and one zone per instance accumulate; nothing is removed; complete marks only the newest', () => {
  const a = flatSite('tower')
  const r1 = S.appendInstance(null, { kind: 'tower', home: HOME, inst: a.inst, meta: { ...a.meta, sitedAt: 1 } })
  assert.strictEqual(r1.blueprint, 'tower@1'); assert.strictEqual(r1.builders_max, 3); assert.strictEqual(r1.structure_complete, false)
  assert.ok(!('box' in r1), 'no whole-record box (recordZones reads its zones)')
  const c1 = S.completeInstance(r1, 5)
  assert.strictEqual(c1.instances[0].completeAt, 5); assert.strictEqual(S.completeInstance(c1), null, 'a standing record is not completed twice')
  const b = flatSite('tower', { n: 2, id: 'T2', guard: (x, z) => (x >= a.meta.box[0] - 3 && x <= a.meta.box[2] + 3 && z >= a.meta.box[1] - 3 && z <= a.meta.box[3] + 3 ? 'T1' : null) })
  assert.ok(b.ok)
  const r2 = S.appendInstance(c1, { kind: 'tower', home: HOME, inst: b.inst, meta: { ...b.meta, sitedAt: 2 } })
  assert.strictEqual(r2.cells.length, a.inst.cells.length + b.inst.cells.length)
  assert.strictEqual(r2.zones.length, 2); assert.strictEqual(r2.instances.length, 2); assert.strictEqual(r2.structure_complete, false)
  assert.ok(r1.cells.every(c => r2.cells.some(q => q.at.join() === c.at.join())), 'every earlier cell kept')
  assert.ok(new Set(r2.segments.map(s => s.seg)).size === r2.segments.length && r2.segments.every(s => /^[A-Za-z0-9-]+$/.test(s.seg)), 'lease-safe, unique segment names')
  assert.deepStrictEqual(SH.recordZones([r2]).length, 2)
})

console.log('THE WIRING (skills.mjs, structural)')
const SK = strip(readFileSync(new URL('../src/skills.mjs', import.meta.url), 'utf8'))
const W = [
  /if \(isSinkPlot\(proj\.plot\)\) return buildSink\(ctx, args, signal, proj\)/,
  /if \(h\.ok && h\.head\?\.rec\?\.structure_complete && isSinkPlot\(h\.head\.rec\.plot\) && sinkNextNow\(h\.head\.rec\.plot\)\) return \{ \.\.\.h, head: null \}/,
  /: isSinkBlueprint\(r\.blueprint\) \? \{ palette: r\.palette \?\? \{\} \} : blueprintOf\(r\.blueprint \?\? SHOP_BLUEPRINT\)/,
  /const pick = activeProject\(waited, order, \{ upkeepTurn: \(b\?\.sinkStreak \?\? 0\) >= SINK_STREAK, sinkTurn: \(b\?\.finiteStreak \?\? 0\) >= SINK_TURN_AFTER \}\)/,
  /\.\.\.sinkVisitOpts\(rec, home\), \.\.\.leave \}, effects/,
  /const others = guardRecords\(projectHeads\(\)\.map\(x => x\.head\.rec\)\.filter\(Boolean\), kind\)/,
  /guard: kind === 'dress' \? \(\) => null : sinkGuardFor\(c, plan, \{ kind \}\), guardShrine: kind === 'dress' \? \(\) => null : sinkGuardFor\(c, plan, \{ noZ0: true, kind \}\)/,
]
await t('build_shop dispatches a sink plot to buildSink; a sink wanting its next instance reads unsited; its palette judges damage; the picker\'s order and upkeep turn reach activeProject; the visit takes the sink options', () => {
  for (const re of W) assert.ok(re.test(SK), String(re))
})
await t('mutants: each wiring line, once broken, fails its assertion', () => {
  const breaks = ['if (isSinkPlot(proj.plot)) return buildSink(ctx, args, signal, proj)', 'sinkNextNow(h.head.rec.plot)) return { ...h, head: null }', '{ upkeepTurn: (b?.sinkStreak ?? 0) >= SINK_STREAK, sinkTurn']
  for (const b of breaks) {
    assert.strictEqual(SK.split(b).length, 2, `anchor unique: ${b}`)
    const m = SK.replace(b, 'BROKEN')
    assert.ok(W.some(re => !re.test(m)), b)
  }
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
