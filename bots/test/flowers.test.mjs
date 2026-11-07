// FLOWERS-01: THE FLOWER SUPPLY AND THE BORDER UPGRADE (OWNER 11-07: "lawns with flowers and tall grass scattered, paths edged with
// flowers"; bots/src/decorator.mjs FLOWER, the composter's feed hook in composter.mjs, the skills.mjs wiring). Behaviour: the upgrade's
// candidates (one fern in three of a run kept, only a standing fern, never a held column), the re-role (as many as the bag's flowers, a
// fern-free palette, the history kept), the wait (a fern cell with no flower in the bag is done -- the refusal chain), the wild pick's
// targets (never a reservation, a record, the walls' inside, a nursery's spread, past the reach, off soil), the nursery's clearing (the
// whole spread; a covered centre is never ready), the flower work's ladder (ferns never count as flowers; no supply -> no work), the
// composter's feed (ferns above the keep, never a flower, nothing without the hook), and the REAL visit runner on the fake server:
// with no flower the upgraded run completes with its ferns standing, with flowers each fern is replaced. Anchored mutants (each anchor
// present and unique) for every rule a test leans on; STRUCTURAL source assertions only for the skills.mjs wiring, each with a mutant.
import assert from 'node:assert'
import fs, { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
const { R, PJ, G, HOME, server, bot } = await import('./helpers/buildfake.mjs')
const D = await import('../src/decorator.mjs')
const S = await import('../src/sinks.mjs')
const CM = await import('../src/composter.mjs')
const RR = await import('../src/reroof.mjs')

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 6).join('\n        ')}`) }
}
const strip = src => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/[ \t]\/\/ .*$/gm, '')
const DEC_PATH = new URL('../src/decorator.mjs', import.meta.url)
const CM_PATH = new URL('../src/composter.mjs', import.meta.url)
const SKILLS_PATH = new URL('../src/skills.mjs', import.meta.url)
/** A mutant of a module, its anchor present and unique (CLAUDE.md), imported from the test directory. */
async function withMutant (file, old, neu, fn) {
  const src = readFileSync(file, 'utf8')
  assert.ok(src.includes(old), `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 70))}`)
  assert.ok(src.split(old).length === 2, 'the mutation target is not unique; the mutant is ambiguous')
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, src.replace(old, neu).replace(/from '\.\//g, "from '../src/"))
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}
const SK = strip(readFileSync(SKILLS_PATH, 'utf8'))
const MODS = new Map([[DEC_PATH.href, D], [CM_PATH.href, CM]])
/** BOTH WAYS: the scenario passes on the real module and throws on the mutant. */
const killed = async (file, old, neu, scenario) => {
  await scenario(MODS.get(file.href))
  let k = false
  await withMutant(file, old, neu, async M => { try { await scenario(M) } catch { k = true } })
  assert.ok(k, 'the mutant survived')
}

// ---- a fern border: two runs of fern-cluster cells beside a path along z = 0 (the live showcase's D1-g/D2-g shape) ----------------
const fernRec = () => {
  const cells = []
  for (let i = 0; i < 6; i++) cells.push({ at: [i * 2 - 10, G + 1, 1], role: 'D1-g', seg: 'D1-B0' })
  for (let i = 0; i < 5; i++) cells.push({ at: [i * 2 + 4, G + 1, -1], role: 'D1-g', seg: 'D1-B1' })
  return { v: 1, plot: 'decor', blueprint: 'decor@1', kind: 'decor', home: HOME, structure_complete: true, state: 'complete', gen: 3,
    instances: [{ id: 'D1', n: 1, design: { kind: 'decor', pattern: 'alt', n: 2, phase: 0, scheme: 'warm', run: 6, fern: true, hedge: false }, box: [-10, -1, 12, 1] }],
    cells, segments: [{ seg: 'D1-B0', deps: [] }, { seg: 'D1-B1', deps: [] }], palette: { 'D1-g': ['fern'] }, clear: [], zones: [] }
}
const fernWorld = rec => { const srv = server(); for (const c of rec.cells) srv.set(c.at, 'fern'); return srv }

console.log('THE UPGRADE: candidates, the re-role, the wait')
await t('upgradeCandidates: every standing fern of a fern run but ONE IN THREE (its seeded keep phase), in the record\'s order; a dug or held cell is never one', async () => {
  const scenario = M => {
    const rec = fernRec(), srv = fernWorld(rec)
    const c = M.upgradeCandidates(rec, srv.read)
    const bySeg = s => rec.cells.filter(q => q.seg === s)
    for (const s of ['D1-B0', 'D1-B1']) {
      const cells = bySeg(s), kept = cells.filter((q, i) => i % M.FLOWER.keepEvery === M.keepPhase(s))
      assert.ok(kept.length >= 1, `POSITIVE CONTROL: run ${s} keeps a fern`)
      assert.strictEqual(c.filter(q => q.cell.seg === s).length, cells.length - kept.length, `run ${s}: the rest are candidates`)
      for (const k of kept) assert.ok(!c.some(q => q.cell === k), 'the kept fern is never a candidate')
    }
    assert.ok(c.every(q => D.decorFernRole(q.cell.role)))
    // a cell whose fern was dug (air) is a fern REPAIR, never an upgrade; a held column (the demolition) never
    const first = c[0].cell
    srv.set(first.at, 'air')
    assert.ok(!M.upgradeCandidates(rec, srv.read).some(q => q.cell === first), 'a dug fern cell is not upgraded')
    srv.set(first.at, 'fern')
    assert.ok(!M.upgradeCandidates(rec, srv.read, { held: (x, z) => x === first.at[0] && z === first.at[2] }).some(q => q.cell === first), 'a held column is not upgraded')
  }
  await killed(DEC_PATH, '    if (i % FLOWER.keepEvery === keepPhase(s)) continue\n', '', scenario)
})
await t('Codex r1 BLOCKER: REPEATED upgrades (one flower a visit) keep the same third of each run a fern -- never the last ferns', async () => {
  const scenario = M => {
    const rec0 = fernRec(), srv = fernWorld(rec0)
    const keptAt = new Set(rec0.cells.filter(q => { const cells = rec0.cells.filter(x => x.seg === q.seg); return cells.indexOf(q) % M.FLOWER.keepEvery === M.keepPhase(q.seg) }).map(q => q.at.join()))
    assert.ok(keptAt.size >= 2, 'POSITIVE CONTROL: both runs keep a fern')
    let rec = rec0
    for (let v = 0; v < 20; v++) { const nx = M.withUpgrade(rec, M.upgradeCandidates(rec, srv.read), { flowers: 1 }); if (!nx) break; rec = nx; for (const c of rec.cells) if (D.decorUpgradeRole(c.role)) srv.set(c.at, 'poppy') }
    const ferns = rec.cells.filter(q => D.decorFernRole(q.role)).map(q => q.at.join())
    assert.deepStrictEqual(new Set(ferns), keptAt, 'the kept third, no more, no less')
  }
  await killed(DEC_PATH, '    if (!(decorFernRole(c?.role) || decorUpgradeRole(c?.role)) || !Array.isArray(c.at)) continue\n    const s = String(c.seg ?? instOf(c.role))\n    if (!bySeg.has(s))', '    if (!decorFernRole(c?.role) || !Array.isArray(c.at)) continue\n    const s = String(c.seg ?? instOf(c.role))\n    if (!bySeg.has(s))', scenario)
})
await t('withUpgrade: as many candidates as the bag\'s flowers (at most upgradeMax) re-roled D1-u<k>, the palette the batch\'s scheme WITHOUT a fern, the history kept; no flower -> null', async () => {
  const scenario = M => {
    const rec = fernRec(), srv = fernWorld(rec)
    const c = M.upgradeCandidates(rec, srv.read)
    assert.strictEqual(M.withUpgrade(rec, c, { flowers: 0 }), null, 'no flower in the bag: nothing is re-roled')
    const r3 = M.withUpgrade(rec, c, { flowers: 3, now: 9 })
    const up = r3.cells.filter(q => D.decorUpgradeRole(q.role))
    assert.strictEqual(up.length, 3)
    assert.deepStrictEqual(up.map(q => q.at), c.slice(0, 3).map(q => q.cell.at), 'the first candidates in order')
    for (const q of up) { assert.ok(!r3.palette[q.role].includes('fern'), 'a fern never satisfies an upgraded cell'); assert.ok(r3.palette[q.role].length >= 12); assert.strictEqual(q.seg, rec.cells.find(x => x.at === q.at || x.at.join() === q.at.join()).seg) }
    assert.deepStrictEqual(r3.upgraded.map(u => [u.from, u.upgradedAt]), [['D1-g', 9], ['D1-g', 9], ['D1-g', 9]])
    assert.strictEqual(M.withUpgrade(rec, c, { flowers: 99 }).cells.filter(q => D.decorUpgradeRole(q.role)).length, Math.min(c.length, M.FLOWER.upgradeMax), 'capped at upgradeMax')
    assert.ok(D.decorFlowerRole('D1-u2') && RR.DECOR_ORNAMENT_RX.test('D1-u2') && S.sinkOpenRole('D1-u2'), 'an upgraded cell is a border flower: billed nothing, walked through, a retrofit\'s ornament')
  }
  await killed(DEC_PATH, '  const take = (cands ?? []).slice(0, Math.max(0, Math.min(Math.floor(Number(flowers) || 0), max)))\n', '  const take = (cands ?? []).slice(0, max)\n', scenario)
})
await t('upgradeWaits (THE REFUSAL CHAIN): an upgraded cell standing its fern (or bare) with NO flower in the bag is done for the visit; with a flower it is open; a flower there is the ordinary done', async () => {
  const scenario = M => {
    const c = { at: [0, G + 1, 1], role: 'D1-u0', seg: 'D1-B0' }
    assert.strictEqual(M.upgradeWaits(c, { name: 'fern' }, {}), true, 'no flower: the fern stays, nothing to do')
    assert.strictEqual(M.upgradeWaits(c, { name: 'fern' }, { fern: 20, short_grass: 9 }), true, 'ferns and grass in the bag are not flowers')
    assert.strictEqual(M.upgradeWaits(c, { name: 'air' }, {}), true, 'bare and no flower: waits (never a damage the bot cannot fix)')
    assert.strictEqual(M.upgradeWaits(c, { name: 'fern' }, { poppy: 1 }), false, 'a flower in the bag: the cell is open')
    assert.strictEqual(M.upgradeWaits(c, { name: 'poppy' }, {}), false, 'a flower stands: the ordinary done test answers')
    assert.strictEqual(M.upgradeWaits({ ...c, role: 'D1-g' }, { name: 'air' }, {}), false, 'a fern cell is never waived by this rule')
  }
  await killed(DEC_PATH, '  return flowersOf(held) <= 0\n}', '  return true\n}', scenario)
})

console.log('THE SUPPLY: the wild pick, the nursery\'s clearing, the work ladder, the feed')
await t('flowerTargets: a small flower on soil nearest first; never reserved, a record cell or column, inside the walls, a nursery\'s spread, past the reach, off soil or not a flower', async () => {
  const scenario = M => {
    const srv = server()
    const put = (x, z, n = 'poppy') => { srv.set([x, G + 1, z], n); return { at: [x, G + 1, z], name: n } }
    const near = put(20, 20), far = put(40, 40, 'dandelion'), res = put(22, 22), rec = put(24, 24), ins = put(26, 26), nur = put(30, 30), fern = put(28, 20, 'fern'), stone = put(21, 25)
    srv.set([21, G, 25], 'stone')
    const tg = M.flowerTargets([far, res, rec, ins, nur, fern, stone, near], {
      read: srv.read, home: HOME, from: [0, G + 1, 0], r: 128,
      reserved: (x, z) => (x === 22 && z === 22 ? 'zone:village' : null), guard: { cols: new Set(['24,24']), cells: new Set() },
      inside: (x, z) => x === 26 && z === 26, nurseries: [[30, G, 36]] })
    assert.deepStrictEqual(tg.map(q => q.at), [near.at, far.at], JSON.stringify(tg))
    assert.deepStrictEqual(M.flowerTargets([far, near], { read: srv.read, home: HOME, r: 30 }).map(q => q.at), [near.at], 'past the reach')
    assert.strictEqual(M.flowerTargets([far, near], { read: srv.read, home: HOME, want: 1 }).length, 1, 'at most want')
  }
  await killed(DEC_PATH, '    if (reserved(x, z) || inside(x, z)) continue\n', '', scenario)
})
await t('nurseryClearing: every bloom and grass on grass within the WHOLE spread (was clearR 2), the core first; a covered centre or a covered core is never ready', async () => {
  const scenario = M => {
    const srv = server()
    const n = { at: [0, G, 30] }
    assert.strictEqual(M.nurseryClearing(srv.read, n).ready, true, 'POSITIVE CONTROL: open grass is ready')
    srv.set([6, G + 1, 36], 'short_grass'); srv.set([1, G + 1, 30], 'tall_grass'); srv.set([-5, G + 1, 25], 'poppy')
    const c = M.nurseryClearing(srv.read, n)
    assert.deepStrictEqual(c.digs.map(q => q.at), [[1, G + 1, 30], [-5, G + 1, 25], [6, G + 1, 36]], 'the spread\'s plants, nearest the centre first')
    assert.strictEqual(c.ready, true, 'two plants outside the core do not hold the meal')
    srv.set([0, G + 1, 30], 'short_grass')
    assert.strictEqual(M.nurseryClearing(srv.read, n).ready, false, 'a covered centre refuses the meal (Paper M3)')
    srv.set([0, G + 1, 30], 'air')
    for (let dx = -4; dx <= 4; dx++) for (let dz = -4; dz <= 4; dz++) if (dx || dz) if ((dx + dz) % 2 === 0) srv.set([dx, G + 1, 30 + dz], 'short_grass')
    assert.strictEqual(M.nurseryClearing(srv.read, n).ready, false, 'half the core covered: wait')
    const g = { cells: new Set([`6,${G + 1},36`]) }
    assert.ok(!M.nurseryClearing(srv.read, n, { guard: g }).digs.some(q => q.at[0] === 6 && q.at[2] === 36), 'a record cell is never dug')
  }
  await killed(DEC_PATH, '    if (plant) digs.push({ at, name: n, d })\n', '    if (plant && d <= NURSERY.clearR) digs.push({ at, name: n, d })\n', scenario)
})
await t('flowerWork (the ladder): no border -> no work; flowers, meal, feed, a wild flower, a fern to cut for feed -> work; a bag of ferns is never flowers; nothing -> no_supply', async () => {
  const scenario = M => {
    assert.deepStrictEqual(M.flowerWork({ cands: 0, owed: 0, flowers: 9 }), { want: false, why: 'no_border' })
    assert.strictEqual(M.flowerWork({ cands: 4, flowers: 1 }).why, 'flowers')
    assert.strictEqual(M.flowerWork({ cands: 4, meal: 1 }).why, 'meal')
    assert.strictEqual(M.flowerWork({ owed: 2, feed: 8 }).why, 'feed')
    assert.strictEqual(M.flowerWork({ owed: 2, feed: 7 }).want, false, 'feed under DRIVE.feedMin is not a step')
    assert.strictEqual(M.flowerWork({ cands: 4, wild: 1 }).why, 'wild')
    assert.strictEqual(M.flowerWork({ cands: 4, shears: true, wildFerns: 30, townMeal: 4 }).why, 'fern_feed')
    assert.strictEqual(M.flowerWork({ cands: 4, shears: true, wildFerns: 30, townMeal: null }).want, false, 'an unread town never drives a feed')
    assert.strictEqual(M.flowerWork({ cands: 4, shears: true, wildFerns: 30, townMeal: 16 }).want, false, 'the town at DRIVE.target: no feed')
    assert.deepStrictEqual(M.flowerWork({ cands: 4, flowers: 0, meal: 0, feed: 0, wild: 0, wildFerns: 0 }), { want: false, why: 'no_supply' })
    assert.strictEqual(M.flowersOf({ fern: 30, poppy: 2, short_grass: 5 }), 2, 'the bag\'s flowers are never its ferns')
    assert.strictEqual(M.feedFernNeed({ held: { fern: 4 }, townMeal: 2, work: true }), M.FLOWER.feedKeep + M.FLOWER.feedWant - 4)
    assert.strictEqual(M.feedFernNeed({ held: { fern: 4 }, townMeal: 20, work: true }), 0, 'enough meal in town: no feed')
    assert.strictEqual(M.feedFernNeed({ held: { fern: 4 }, townMeal: 2, work: false }), 0, 'no border to upgrade: no feed')
  }
  await killed(DEC_PATH, "  if (Number(flowers) > 0) return { want: true, why: 'flowers' }\n", "  if (Number(flowers) > 0 || Number(cands) > 0) return { want: true, why: 'flowers' }\n", scenario)
})
await t('the composter\'s FEED: with the hook (the decorator\'s pools) the ferns above FLOWER.feedKeep go in and every flower stays; without it (the fleet) no kept name goes in', async () => {
  const scenario = M => {
    const items = [{ name: 'fern', count: 30 }, { name: 'poppy', count: 3 }, { name: 'short_grass', count: 5 }]
    const keeps = new Set(['fern', 'poppy'])
    assert.deepStrictEqual(M.compostAllowance(items, { decorKeeps: keeps, decorFeed: null }), { short_grass: 5 }, 'no hook: the fern and the poppy are the decorator\'s')
    assert.deepStrictEqual(M.compostAllowance(items, { decorKeeps: keeps, decorFeed: { fern: D.FLOWER.feedKeep } }), { fern: 30 - D.FLOWER.feedKeep, short_grass: 5 }, 'the feed: ferns above the keep')
    assert.deepStrictEqual(M.compostAllowance([{ name: 'fern', count: 5 }], { decorKeeps: keeps, decorFeed: { fern: 8 } }), {}, 'under the keep: none')
    assert.deepStrictEqual(M.compostAllowance([{ name: 'fern', count: 30 }], { decorKeeps: new Set(), decorFeed: { fern: 8 } }), { fern: 30 }, 'a pool where the decorator keeps nothing: as before (ferns are junk)')
  }
  await killed(CM_PATH, '    const a = isSapling(name) ? n - keep : name === \'apple\' ? n - APPLE_RESERVE : fed(name) ? n - decorFeed[name] : n\n', '    const a = isSapling(name) ? n - keep : name === \'apple\' ? n - APPLE_RESERVE : n\n', scenario)
})

await t('flowers-01 r4: the fern gather never cuts within FLOWER.fernMinR (32) of home -- 33..48 only; minR 0 (FLOWERS off) as before', async () => {
  const scenario = M => {
    const srv = server()
    const f = (x, z) => { srv.set([x, G + 1, z], 'fern'); return { at: [x, G + 1, z], name: 'fern' } }
    const c = [f(10, 10), f(32, 0), f(33, 5), f(-40, 40)]
    assert.deepStrictEqual(M.fernTargets(c, { read: srv.read, home: HOME, from: [0, G + 1, 0], minR: M.FLOWER.fernMinR }).map(q => q.at[0]), [33, -40])
    assert.strictEqual(M.fernTargets(c, { read: srv.read, home: HOME, from: [0, G + 1, 0] }).length, 4, 'POSITIVE CONTROL: no minR, all four')
  }
  await killed(DEC_PATH, '    if (dh > r || dh <= minR) continue\n', '    if (dh > r) continue\n', scenario)
})
await t('wired: the fern gather passes FLOWER.fernMinR', () => {
  const line = 'want: need, minR: FLOWERS_ON ? FLOWER.fernMinR : 0 })'
  assert.strictEqual(SK.split(line).length, 2); assert.strictEqual(SK.replace(line, '').split(line).length, 1)
})
console.log('THE REAL VISIT RUNNER (buildrun.mjs runVisit on the fake server; the server replaces a fern with a flower, Paper P2)')
/** One visit of the decorator over the upgraded record: alsoDone is skills.mjs's decor alsoDone (upgradeWaits over the live bag). */
async function visit (rec, srv, inv) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flowers-'))
  const key = PJ.projKey(HOME, rec.plot)
  const pub = PJ.publishRecord(dir, key, () => ({ ...rec }))
  let last = null
  for (let round = 0; round < 4 && last?.stop !== 'complete'; round++) {
    const sl = PJ.takeSlot(dir, key, 'A', 3)
    const e = bot(srv, 'A', { inv, feet: [0, G + 1, 0] })
    // the Paper fact (flower-proof P2): a flower placed on the soil of a fern cell replaces the fern
    let held = null
    const hold0 = e.hold, send0 = e.send
    e.hold = async n => { const ok = await hold0(n); if (ok) held = n; return ok }
    e.send = (support, face, seq) => { const at = support.map((v, i) => v + face[i]); if (srv.read(...at)?.name === 'fern' && D.flowersOf({ [held]: 1 }) > 0) srv.set(at, 'air'); return send0(support, face, seq) }
    last = await R.runVisit({ dir, key, me: 'A', home: HOME, stood: [], record: rec, recordGen: pub.gen, palette: rec.palette, slot: sl.slot, slotGen: sl.gen, ...S.sinkVisitOpts(rec, HOME), alsoDone: (q, rd) => D.upgradeWaits(q, (rd ?? srv.read)(...q.at), inv) }, e, { maxSteps: 4000 })
    PJ.releaseLease(dir, key, `slot${sl.slot}`, 'A', sl.gen)
  }
  return last
}
await t('NO FLOWERS: an upgraded run completes with every fern standing -- nothing dug, nothing placed, nothing refused (the ferns stay, nobody stalls)', async () => {
  const rec0 = fernRec(), srv = fernWorld(rec0)
  const rec = D.withUpgrade(rec0, D.upgradeCandidates(rec0, srv.read), { flowers: 4 })
  const inv = { fern: 3 }
  const last = await visit(rec, srv, inv)
  assert.strictEqual(last.stop, 'complete', JSON.stringify(last))
  assert.strictEqual(last.placed, 0); assert.strictEqual(last.refused ?? 0, 0)
  for (const c of rec.cells) assert.strictEqual(srv.read(...c.at).name, 'fern', `${c.role} ${c.at}`)
})
await t('WITH FLOWERS: the same run -- each upgraded cell\'s fern replaced by a flower of its palette, the kept ferns standing, `complete`', async () => {
  const rec0 = fernRec(), srv = fernWorld(rec0)
  const rec = D.withUpgrade(rec0, D.upgradeCandidates(rec0, srv.read), { flowers: 8 })
  const up = rec.cells.filter(c => D.decorUpgradeRole(c.role))
  assert.ok(up.length >= 6, `POSITIVE CONTROL: ${up.length} cells upgraded`)
  const inv = { poppy: 4, dandelion: 4 }
  const last = await visit(rec, srv, inv)
  assert.strictEqual(last.stop, 'complete', JSON.stringify(last))
  for (const c of rec.cells) {
    const n = srv.read(...c.at).name
    if (D.decorUpgradeRole(c.role)) assert.ok(['poppy', 'dandelion'].includes(n), `${c.role} ${c.at} ${n}`)
    else assert.strictEqual(n, 'fern', `the kept fern ${c.at}`)
    assert.ok(R.cellDone(srv.read(...c.at), rec.palette, c.role), `${c.role} done`)
  }
  assert.strictEqual(inv.poppy + inv.dandelion, 8 - up.length, 'one flower a cell')
})
await t('MUTANT KILLED: without the wait, a flowerless visit over an upgraded run never completes (the dead end the wait exists for)', async () => {
  await withMutant(DEC_PATH, '  return flowersOf(held) <= 0\n}', '  return false\n}', async M => {
    const rec0 = fernRec(), srv = fernWorld(rec0)
    const rec = M.withUpgrade(rec0, M.upgradeCandidates(rec0, srv.read), { flowers: 4 })
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flowers-m-'))
    const key = PJ.projKey(HOME, rec.plot)
    const pub = PJ.publishRecord(dir, key, () => ({ ...rec }))
    const sl = PJ.takeSlot(dir, key, 'A', 3)
    const inv = { fern: 3 }
    const r = await R.runVisit({ dir, key, me: 'A', home: HOME, stood: [], record: rec, recordGen: pub.gen, palette: rec.palette, slot: sl.slot, slotGen: sl.gen, ...S.sinkVisitOpts(rec, HOME), alsoDone: (q, rd) => M.upgradeWaits(q, (rd ?? srv.read)(...q.at), inv) }, bot(srv, 'A', { inv, feet: [0, G + 1, 0] }), { maxSteps: 4000 })
    assert.notStrictEqual(r.stop, 'complete', 'the mutant left the run open with no flower to place -- the test above proves the wait')
  })
})

console.log('FLOWERS-02: THE LAWN SCATTER (siting, the survey, the gate, the work, the reservations)')
// a walled lawn: inside x -30..30, z -30..30 (the fake server is all grass); a path along z = 0 x -30..30 (a record)
const lawnInside = (x, z) => Math.abs(x) <= 30 && Math.abs(z) <= 30
const pathGuard = () => ({ cols: new Set(Array.from({ length: 61 }, (_, i) => `${i - 30},0`)), cells: new Set() })
await t('lawnSurvey/lawnGate: a clear sparse window passes; a path column, a reservation, the walls\' outside, a nursery\'s box or an unread column anywhere in the 7-spread refuses; a covered centre refuses', async () => {
  const scenario = M => {
    const srv = server()
    const o = { guard: pathGuard(), inside: lawnInside }
    const ok = M.lawnSurvey(srv.read, [10, G, 15], o)
    assert.ok(ok.ok && M.lawnGate(ok).ok, `POSITIVE CONTROL ${JSON.stringify(ok)}`)
    assert.strictEqual(ok.L, 225); assert.strictEqual(ok.coreL, 81)
    assert.strictEqual(M.lawnSurvey(srv.read, [10, G, 7], o).why, 'refused:record', 'the path at z=0 is 7 away: in the spread')
    assert.ok(M.lawnSurvey(srv.read, [10, G, 8], o).ok, 'one further: clear')
    assert.match(M.lawnSurvey(srv.read, [10, G, 15], { ...o, reserved: (x, z) => (x === 16 && z === 20 ? 'zone:village' : null) }).why, /^refused:zone/)
    assert.strictEqual(M.lawnSurvey(srv.read, [25, G, 15], o).why, 'refused:outside', 'the spread past the wall')
    assert.strictEqual(M.lawnSurvey(srv.read, [10, G, 15], { ...o, avoid: (x, z) => x === 4 && z === 9 }).why, 'refused:avoid')
    assert.strictEqual(M.lawnSurvey(srv.read, [10, G, 15], { ...o, guard: { cols: new Set(), cells: new Set([`12,${G + 1},16`]) } }).why, 'refused:record_cell')
    srv.set([10, G + 1, 15], 'short_grass')
    assert.strictEqual(M.lawnSurvey(srv.read, [10, G, 15], o).why, 'centre', 'a covered centre refuses (Paper: the meal would be refused)')
    assert.strictEqual(M.lawnSurvey((x, y, z) => (x === 14 && z === 18 ? null : srv.read(x, y, z)), [0, G, -15], o).ok, true)
    assert.strictEqual(M.lawnSurvey((x, y, z) => (x === 3 && z === -12 ? null : srv.read(x, y, z)), [0, G, -15], o).why, 'unread', 'an unread column refuses')
  }
  await killed(DEC_PATH, "  if (guard?.cols?.has?.(k2(x, z))) return 'refused:record'\n  if (avoid(x, z)) return 'refused:avoid'\n", "  if (avoid(x, z)) return 'refused:avoid'\n", scenario)
})
await t('lawnGate (THE DENSITY CAP): sparse passes; a core over 10% planted, a spread over 12%, 4 flowers, or a thin lawn refuses -- a fed lawn (Paper ~25% core) is never fed again', async () => {
  const scenario = M => {
    const base = { ok: true, L: 225, P: 9, F: 1, T: 0, coreL: 81, coreP: 4 }
    assert.ok(M.lawnGate(base).ok, 'the showcase\'s measured 4% passes')
    assert.strictEqual(M.lawnGate({ ...base, coreP: 9 }).why, 'dense_core')
    assert.strictEqual(M.lawnGate({ ...base, coreP: 8 }).ok, true, 'at 9.9%: passes')
    assert.strictEqual(M.lawnGate({ ...base, P: 28 }).why, 'dense')
    assert.strictEqual(M.lawnGate({ ...base, F: 4 }).why, 'flowered')
    assert.strictEqual(M.lawnGate({ ...base, coreL: 59 }).why, 'thin_core:59')
    assert.strictEqual(M.lawnGate({ ...base, L: 149 }).why, 'thin:149')
    assert.strictEqual(M.lawnGate({ ...base, P: 23, coreP: 20 }).ok, false, 'after one vanilla meal (Paper L1: 20 plants, all in the core)')
  }
  await killed(DEC_PATH, "  if (s.coreP / s.coreL > LAWN.coreMax) return { ok: false, why: 'dense_core' }\n", '', scenario)
})
await t('siteLawn: by ring from home, inside the walls only, never within LAWN.gap of a lawn or 2 x spread of a nursery; nothing fits -> no_lawn with the reasons', async () => {
  const scenario = M => {
    const srv = server()
    const o = { guard: pathGuard(), inside: lawnInside }
    const a = M.siteLawn(srv.read, HOME, o)
    assert.ok(a.ok, JSON.stringify(a.tried))
    assert.ok(Math.abs(a.lawn.at[2]) >= 8 && lawnInside(a.lawn.at[0] - 7, a.lawn.at[2] - 7) && lawnInside(a.lawn.at[0] + 7, a.lawn.at[2] + 7), 'clear of the path, inside the walls')
    const b = M.siteLawn(srv.read, HOME, { ...o, lawns: [a.lawn.at] })
    assert.ok(b.ok && Math.max(Math.abs(b.lawn.at[0] - a.lawn.at[0]), Math.abs(b.lawn.at[2] - a.lawn.at[2])) >= M.LAWN.gap, 'the next keeps the gap')
    const c = M.siteLawn(srv.read, HOME, { ...o, nurseries: [a.lawn.at] })
    assert.ok(c.ok && Math.max(Math.abs(c.lawn.at[0] - a.lawn.at[0]), Math.abs(c.lawn.at[2] - a.lawn.at[2])) > 14, 'a nursery keeps twice its spread')
    const none = M.siteLawn(srv.read, HOME, { ...o, inside: (x, z) => Math.abs(x) <= 5 && Math.abs(z) <= 5 })
    assert.strictEqual(none.ok, false); assert.strictEqual(none.why, 'no_lawn')
  }
  await killed(DEC_PATH, '      if (nearLawn(x, z)) { tried.gap = (tried.gap ?? 0) + 1; continue }\n', '', scenario)
})
await t('withLawn claims the lawn on the record (kept by every later generation); lawnReserved keeps the fern gather / wild pick / a nursery off its spread', async () => {
  const rec = D.withLawn({ cells: [], lawns: [] }, { at: [10, G, 15], box: [3, 8, 17, 22], L: 225, P: 0 }, { now: 5, by: 'A' })
  assert.deepStrictEqual(rec.lawns, [{ at: [10, G, 15], box: [3, 8, 17, 22], sitedAt: 5, by: 'A', L: 225, P: 0 }])
  assert.deepStrictEqual(D.lawnCentres(rec), [[10, G, 15]])
  const r = D.lawnReserved(rec)
  assert.strictEqual(r(17, 22), 'lawn'); assert.strictEqual(r(18, 15), null)
})
await t('lawnWork (THE PRIORITY + REFUSAL CHAIN): the border first; stalled -> no; a meal, feed, or a feed fern -> work; nothing -> no_supply', async () => {
  const scenario = M => {
    assert.deepStrictEqual(M.lawnWork({ border: 3, meal: 9 }), { want: false, why: 'border_first' })
    assert.deepStrictEqual(M.lawnWork({ stalled: true, meal: 9 }), { want: false, why: 'stalled' })
    assert.strictEqual(M.lawnWork({ meal: 1 }).why, 'lawn_meal')
    assert.strictEqual(M.lawnWork({ feed: 8 }).why, 'lawn_feed')
    assert.strictEqual(M.lawnWork({ shears: true, wildFerns: 5, townMeal: 4 }).why, 'lawn_fern_feed')
    assert.deepStrictEqual(M.lawnWork({}), { want: false, why: 'no_supply' })
  }
  await killed(DEC_PATH, "  if (Number(border) > 0) return { want: false, why: 'border_first' }\n", '', scenario)
})

await t('Codex r1 BLOCKER: mealAllow judges the park\'s keep AT THE TRANSFER (this chest + the others, less outstanding draws): a stale 5 that is now 4 takes none', async () => {
  const scenario = M => {
    const a = M.mealAllow(4, 1)
    assert.strictEqual(a('bone_meal', 1, { here: { bone_meal: 5 }, others: {} }), 1, 'POSITIVE CONTROL: 5 in town, one above the keep')
    assert.strictEqual(a('bone_meal', 1, { here: { bone_meal: 4 }, others: {} }), 0, 'another bot drew meanwhile: the keep is whole')
    assert.strictEqual(a('bone_meal', 1, { here: { bone_meal: 2 }, others: { bone_meal: 3 } }), 1, 'the other chests count')
    assert.strictEqual(a('bone_meal', 1, { here: { bone_meal: 2 }, others: { bone_meal: 3 }, taking: { bone_meal: 1 } }), 0, 'an outstanding draw counts')
    assert.strictEqual(M.mealAllow(4, 3)('bone_meal', 3, { here: { bone_meal: 9 }, others: {} }), 3); assert.strictEqual(a('fern', 1, { here: { fern: 9 } }), 0)
  }
  await killed(DEC_PATH, '  return Math.max(0, Math.min(Number(want) || 0, Number(o?.here?.bone_meal) || 0, Number(cap) || 0, town - keep - out))\n', '  return Math.max(0, Math.min(Number(want) || 0, Number(o?.here?.bone_meal) || 0, Number(cap) || 0))\n', scenario)
})
await t('wired: the lawn and the nursery draw bone meal through mealAllow', () => {
  for (const line of ['matsReserve().table, mealAllow(NURSERY.mealKeep, 1))', 'FLOWERS_ON ? mealAllow(NURSERY.mealKeep, want - bagMeal) : decorAllow({ bone_meal: want - bagMeal })']) { assert.strictEqual(SK.split(line).length, 2, line); assert.strictEqual(SK.replace(line, '').split(line).length, 1) }
})

console.log('THE WIRING (structural: skills.mjs; each assertion proven by a mutant of the source text)')
const WIRES = [
  ['the damage loop waives a waiting upgraded cell', "if (b && r.plot === SINK_PLOTS.decor && upgradeWaits(c, b, heldMap(bot))) continue"],
  ['the decor upkeep is due for its flower work', "if (tidy && r.plot === SINK_PLOTS.decor && decorFlowerDue(bot, r)) return true"],
  ['the siting stall does not hold the flower work', "&& !(states[i]?.due && decorFlowerDue(bot, decorRecNow()))"],
  ['the decor visit\'s runner reads an upgraded cell\'s wait', "const leave0 = kind === 'decor' ? { alsoDone: (q, rd2) => upgradeWaits(q, (rd2 ?? read)(...q.at), heldMap(bot)) } : kind !== 'dress'"],
  ['a stall stamps the flower work too', 'townNoSiteWrite(FLOWER_STALL)'],
  ['the composter feed is wired where the decorator and FLOWERS are on', 'setDecorFeed(() => (DECORATE.on && FLOWERS_ON ? { fern: FLOWER.feedKeep } : null))'],
  ['a meal the server did not spend stops the nursery', "if (FLOWERS_ON) { await sleep(300, signal); if (countItem(bot, 'bone_meal') >= m0) { out.why = 'meal_refused'; break } }"],
  ['the nursery is asked for flowers, never ferns', "if ((FLOWERS_ON ? flowersOf(held0) : borderPlantsOf(held0)) >= need) return { ...out, why: 'enough' }"],
  ['the upgrade is published from the record read inside the publish', 'withUpgrade(cur, upgradeCandidates(cur, tidyRead(bot), { held: decorHeldNow() }), { flowers: fl })'],
  ['flowers-02: the lawn work only with no border work', 'if (LAWNS_ON && !w.want && !cands.length && !owed) {'],
  ['flowers-02: the lawn is claimed on the record before its meal', 'withLawn(cur, s.lawn, { by: me }) : null), { by: me })'],
  ['flowers-02: the gate is asked again just before the click', "if (!again.ok) { out.why = `gate_${again.why}`; return out }"],
  ['flowers-02: a lawn meal counts only when spent', "if (countItem(bot, 'bone_meal') >= m0) { out.why = 'meal_refused'; return out }"],
  ['flowers-02: no lawn site stamps the lawn stall', 'if (!s.ok) { townNoSiteWrite(LAWN_STALL);'],
  ['flowers-02: the nursery keeps off the lawns', 'reserved = decorReservedLawns(c, { ...h.head.plan, gen: h.head.gen }, rec0)'],
  ['flowers-02: the fern gather keeps off the lawns', 'reserved = decorReservedLawns(c, { ...h.head.plan, gen: h.head.gen }, decorRecNow())'],
  ['flowers-02: the visit runs the lawn after the upgrade', 'if (LAWNS_ON && rec0 && fw.lawn) { const lw = await decorLawn(ctx, signal, t0 + budget - ZIG_VISIT_TAIL_MS);'],
]
for (const [what, line] of WIRES) {
  await t(`wired: ${what}`, () => {
    assert.strictEqual(SK.split(line).length, 2, `the executable line is present exactly once: ${line.slice(0, 70)}`)
    assert.strictEqual(SK.replace(line, '').split(line).length, 1, 'MUTANT: the line removed -> the assertion fails')
  })
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
