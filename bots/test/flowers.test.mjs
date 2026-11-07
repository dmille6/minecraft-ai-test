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

console.log('THE WIRING (structural: skills.mjs; each assertion proven by a mutant of the source text)')
const SK = strip(readFileSync(SKILLS_PATH, 'utf8'))
const WIRES = [
  ['the damage loop waives a waiting upgraded cell', "if (b && r.plot === SINK_PLOTS.decor && upgradeWaits(c, b, heldMap(bot))) continue"],
  ['the decor upkeep is due for its flower work', "if (tidy && r.plot === SINK_PLOTS.decor && decorFlowerDue(bot, r)) return true"],
  ['the siting stall does not hold the flower work', "&& !(states[i]?.due && decorFlowerDue(bot, decorRecNow()))"],
  ['the decor visit\'s runner reads an upgraded cell\'s wait', "kind === 'decor' ? { alsoDone: (q, rd2) => upgradeWaits(q, (rd2 ?? read)(...q.at), heldMap(bot)) } : {}"],
  ['a stall stamps the flower work too', 'townNoSiteWrite(FLOWER_STALL)'],
  ['the composter feed is wired where the decorator and FLOWERS are on', 'setDecorFeed(() => (DECORATE.on && FLOWERS_ON ? { fern: FLOWER.feedKeep } : null))'],
  ['a meal the server did not spend stops the nursery', "if (FLOWERS_ON) { await sleep(300, signal); if (countItem(bot, 'bone_meal') >= m0) { out.why = 'meal_refused'; break } }"],
  ['the nursery is asked for flowers, never ferns', "if ((FLOWERS_ON ? flowersOf(held0) : borderPlantsOf(held0)) >= need) return { ...out, why: 'enough' }"],
  ['the upgrade is published from the record read inside the publish', 'withUpgrade(cur, upgradeCandidates(cur, tidyRead(bot), { held: decorHeldNow() }), { flowers: fl })'],
]
for (const [what, line] of WIRES) {
  await t(`wired: ${what}`, () => {
    assert.strictEqual(SK.split(line).length, 2, `the executable line is present exactly once: ${line.slice(0, 70)}`)
    assert.strictEqual(SK.replace(line, '').split(line).length, 1, 'MUTANT: the line removed -> the assertion fails')
  })
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
