// SINKFIX-02 (LIVE showcase 11-04 01:25-03:25Z, batch 1 add2dcdd): sinks got visits but placed almost nothing --
//   road: 21 visits, 6 placed: 16 ABORTED (13 the stuck reflex at the same approach under the canopy, 3 ordered in a mine at y 23-26
//         and entombed); the one open road instance headed the sink order the whole time (aborts were never idle-marked, sinks never)
//   tower: 6 visits, 0 placed: `no_proven_site corner:proof_no_step6` -- every proof spent on one corner whose base had a 3-deep
//         1-wide hole (offline on the 11-04 03:30Z world copy: `no_step: T1-F ... T1-core@47,67,-28`, no stand reaches its bottom)
//   dress: never visited (behind the open road, then the tower and the shrine); tidy: 39 keeper visits `complete`, 0 placed.
// Reproduced and fixed through the exported decisions (shop.mjs noteIdle / activeProject / buildOrder, sinks.mjs screenStepped /
// siteSink / stoneOpenCount / sinkNextGate), each with its positive control and an anchored mutant.
import assert from 'node:assert'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
const { server, G, HOME } = await import('./helpers/buildfake.mjs')
const S = await import('../src/sinks.mjs')
const SH = await import('../src/shop.mjs')
let pass = 0, fail = 0
const t = async (name, fn) => { try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 5).join('\n        ')}`) } }
async function withMutants (file, pairs, fn) {
  let src = readFileSync(file, 'utf8')
  for (const [old, neu] of pairs) {
    assert.ok(src.includes(old), `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 70))}`)
    assert.ok(src.split(old).length === 2, 'the mutation target is not unique')
    src = src.replace(old, neu)
  }
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, src.replace(/from '\.\//g, "from '../src/"))
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}
const SHOP_PATH = new URL('../src/shop.mjs', import.meta.url), SINKS_PATH = new URL('../src/sinks.mjs', import.meta.url)

// ---- the logged pick: the open road first, its visits aborting ------------------------------------------------------------------
const PLOTS = ['shop', 'shaft', 'monument', 'storehouse', 'yard', 'road', 'tower', 'shrine', 'dress', 'tidy']
const LIST = SH.PROJECTS.filter(p => PLOTS.includes(p.plot))
const LOGGED = () => LIST.map(p => {
  if (p.plot === 'road') return { plot: 'road', exists: true, complete: false, damaged: false, sink: true, sinkOpen: true }
  if (p.sink) return { plot: p.plot, exists: false, complete: false, damaged: false, sink: true, sinkNext: true }
  if (p.plot === 'tidy') return { plot: 'tidy', exists: true, complete: false, damaged: false, free: false }
  return { plot: p.plot, exists: true, complete: true, damaged: false }
})
function run (M, n = 8) {
  const mem = new Map(), picks = []
  let now = Date.parse('2026-11-04T01:25:00Z')
  for (let i = 0; i < n; i++, now += 4 * 60_000) {
    const pick = M.activeProject(M.idleMarks(LOGGED(), mem, now), LIST)
    picks.push(pick.plot)
    // what the logs show each of them doing: the road's visit aborts (the stuck reflex), the others would build
    M.noteIdle(mem, pick.plot, pick.plot === 'road' ? { status: 'aborted', stop: 'aborted' } : { status: 'success', placed: 30 }, now)
  }
  return picks
}
await t('THE LOGGED PICK: the open road first, every visit aborting -- old rule: road forever; now: the next sink kind after one abort', async () => {
  const picks = run(SH)
  assert.strictEqual(picks[0], 'road')
  assert.ok(picks.slice(1).every(p => p !== 'road'), picks.join(','))
  assert.ok(picks.slice(1).every(p => ['tower', 'shrine', 'dress'].includes(p)), picks.join(','))
  await withMutants(SHOP_PATH, [["  if (result.status === 'aborted') { if (isSinkPlot(plot)) mem.set(plot, now + IDLE_MS); return }\n", '']], async M => {
    assert.ok(run(M).every(p => p === 'road'), 'MUTANT: an abort unmarked -- road forever, as live')
  })
  await withMutants(SHOP_PATH, [['&& !st(p).stuck && st(p).idle !== true) ?? null', '&& !st(p).stuck) ?? null']], async M => {
    assert.ok(run(M).every(p => p === 'road'), 'MUTANT: the sink tier blind to the mark -- road forever')
  })
})
await t('a finite project\'s abort still marks nothing; the mark lapses after IDLE_MS (the road is asked again)', () => {
  const m = new Map(), T = 1000
  SH.noteIdle(m, 'house1', { status: 'aborted' }, T); assert.ok(!m.has('house1'))
  SH.noteIdle(m, 'road', { status: 'aborted' }, T); assert.strictEqual(m.get('road'), T + SH.IDLE_MS)
  assert.strictEqual(SH.activeProject(SH.idleMarks(LOGGED(), m, T + SH.IDLE_MS + 1), LIST).plot, 'road')
})

// ---- a sink visit starts at the surface ---------------------------------------------------------------------------------------
await t('buildOrder: a sink visit is not ordered in a mine (feet 8+ under the town\'s ground); at the surface it is; a finite project as before', () => {
  const base = { on: true, shared: true, atTown: true, planned: true, now: 1e12, state: {}, record: null, complete: false, freeSlots: 10, groundY: 70 }
  SH.setActivePlot(() => 'road')
  try {
    assert.strictEqual(SH.buildOrder({ ...base, feet: [-3, 26, 26] }).skip, 'underground', 'the live y 23-26')
    assert.deepStrictEqual(SH.buildOrder({ ...base, feet: [-3, 70, 26] }).order, { skill: 'build_shop', args: {} })
    assert.deepStrictEqual(SH.buildOrder({ ...base, feet: [-3, 64, 26] }).order, { skill: 'build_shop', args: {} }, 'a dip in town is not a mine')
    SH.setActivePlot(() => 'house1')
    assert.deepStrictEqual(SH.buildOrder({ ...base, feet: [-3, 26, 26] }).order, { skill: 'build_shop', args: {} }, 'POSITIVE CONTROL: a finite project unchanged')
  } finally { SH.setActivePlot(() => null) }
})

// ---- the tower's siting ---------------------------------------------------------------------------------------------------------
const g5 = { B: 5, S: 1, H: 2, n: 2, W: 1, stairs: 'perp', spin: 1, face0: 's', all4: false }
const pit = (srv, x, z, deep) => { for (let y = G - deep + 1; y <= G; y++) srv.set([x, y, z], 'air') }
const fillDepths = r => { const m = new Map(); for (const [x, , z] of r.fill ?? []) m.set(`${x},${z}`, (m.get(`${x},${z}`) ?? 0) + 1); return [...m.values()] }
await t('screenStepped: no base column is filled more than 2 deep (a 3-deep hole: levelled lower by cuts, or refused); old rule: filled 3', async () => {
  const s3 = server(); pit(s3, 22, 22, 3)
  const r = S.screenStepped(s3.read, { x0: 20, z0: 20, g: g5, hy: HOME.y })
  assert.ok(!r.ok || Math.max(0, ...fillDepths(r)) <= 2, JSON.stringify(r).slice(0, 160))
  const s2 = server(); pit(s2, 22, 22, 2)
  const r2 = S.screenStepped(s2.read, { x0: 20, z0: 20, g: g5, hy: HOME.y })
  assert.ok(r2.ok && r2.L === G && r2.fill.length === 2, 'POSITIVE CONTROL: a 2-deep hole is filled at the ground level')
  await withMutants(SINKS_PATH, [["if (L - y > SITE_LIM.baseFillCol || !inBase(x, z))", "if (L - y > SITE_LIM.fillCol || !inBase(x, z))"]], async M => {
    const m = M.screenStepped(s3.read, { x0: 20, z0: 20, g: g5, hy: HOME.y })
    assert.ok(m.ok && m.L === G && Math.max(...fillDepths(m)) === 3, 'MUTANT: the old rule fills the 3-deep hole')
    // (the live hole, on the 11-04 03:30Z world copy, then had no stand: `first:no_step:T1-F ... T1-core@47,67,-28` -- bots/scripts/sinks-offline.mjs)
  })
})
await t('siteSink: a candidate that screens but cannot be proven spends at most 2 proofs; the next is sited (live: 6 of 6 on one corner)', async () => {
  // the seed's first ring candidate walled off from the town walk (a 3-high ring 11 out): every spot there screens, none proves
  const bad = S.towerCandidates(null, HOME, 5, S.sinkSeed('tower', 'test', HOME, 1))[0]
  const world = () => { const w = server(); for (let d = -11; d <= 11; d++) for (const [x, z] of [[bad.cx + d, bad.cz - 11], [bad.cx + d, bad.cz + 11], [bad.cx - 11, bad.cz + d], [bad.cx + 11, bad.cz + d]]) for (let y = G + 1; y <= G + 3; y++) w.set([x, y, z], 'stone'); return w }
  const site = M => M.siteSink(world().read, { kind: 'tower', n: 1, id: 'T1', home: HOME, pool: 'test', avail: {}, stood: [] })
  const r = site(S)
  assert.ok(r.ok, JSON.stringify({ why: r.why, tried: r.tried }))
  assert.ok(Math.max(Math.abs(r.meta.centre[0] - bad.cx), Math.abs(r.meta.centre[1] - bad.cz)) > 11, 'sited at another candidate')
  assert.ok(r.tried[0].startsWith('ring:proof_unreachable2'), r.tried.join(' '))
  await withMutants(SINKS_PATH, [['        if (candProofs >= SINK.proofsPerCandidate) break\n', ''], ['  proofTries: 12,', '  proofTries: 6,']], async M => {
    const m = site(M)
    assert.strictEqual(m.ok, false, 'MUTANT (the live rule): every proof spent on the first candidate')
    assert.ok(m.tried.some(x => /^first:unreachable/.test(x)), 'the row names the first failure')
  })
})

// ---- dress is not held back by the stone sinks ------------------------------------------------------------------------------
await t('stoneOpenCount leaves dress out; two open stone sinks never hold a dress batch back (and dress never holds them)', () => {
  const open = { instances: [{ id: 'X' }], structure_complete: false }
  assert.strictEqual(S.stoneOpenCount({ road: open, tower: open, dress: open }), 2)
  const n = S.stoneOpenCount({ road: open, tower: open })
  assert.strictEqual(S.sinkNextGate({ kind: 'dress', openCount: n, pressure: { p: 1 } }).why, 'ok')
  assert.strictEqual(S.sinkNextGate({ kind: 'shrine', openCount: n, pressure: { p: 1 } }).why, 'max_open', 'POSITIVE CONTROL: a third stone sink waits')
  assert.strictEqual(S.sinkNextGate({ kind: 'shrine', openCount: S.stoneOpenCount({ road: open, dress: open }), pressure: { p: 1 } }).why, 'ok')
})

// ---- the wiring (skills.mjs, structural) --------------------------------------------------------------------------------------
const strip = src => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/[ \t]\/\/ .*$/gm, '')
await t('skills.mjs: an aborted visit is noted, then rethrown; the keeper\'s own visits are no longer exempt; open counts are stone only', () => {
  const sk = strip(readFileSync(new URL('../src/skills.mjs', import.meta.url), 'utf8'))
  assert.ok(/try \{ r = await buildShopVisit\(ctx, args, signal\) \} catch \(e\) \{ if \(e\?\.aborted \|\| signal\?\.aborted\) \{ note\(\{ status: 'aborted', stop: 'aborted' \}\); serviceEnd\(ctx\.bot, 'aborted'\) \} throw e \}/.test(sk))
  assert.ok(!/pl === TIDY_PLOT && keeperNow\(ctx\.bot\)/.test(sk), 'the keeper exemption is gone')
  assert.strictEqual(sk.split('stoneOpenCount(recs)').length - 1, 2, 'both open counts')
})
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
