// ZIGTIDY-02 (LIVE showcase 10-30): the finished ziggurat's tidy had not run since 07:16Z (wall-01 r3 made it `due`, after every
// open project, and the paths stood open all day), the voidfill repair's climbs left ten dirt pillars on the treads by 22:30Z, a
// tidy dig was sent from 47 blocks away (its walk stuck) while it held the clear lease, and a refused voidfill visit stamped a
// 6 h stuck back-off on two cells a racing visit filled the same minute.
import assert from 'node:assert'
import { readFileSync, writeFileSync, unlinkSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
const { R, G, HOME, k3, server } = await import('./helpers/buildfake.mjs')
const { Z, G12, siteOn, zigProject, zigDone, KITZ, zbot } = await import('./helpers/zigfake.mjs')
const S = await import('../src/shop.mjs')
const PJ = await import('../src/buildproj.mjs')

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 5).join('\n        ')}`) }
}
/** A source file with ONE anchored replacement, imported -> fn(module). */
async function withMutant (file, old, neu, fn) {
  const src = readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8')
  assert.strictEqual(src.split(old).length, 2, `ANCHOR MISSING OR NOT UNIQUE: ${JSON.stringify(old.slice(0, 70))}`)
  const out = new URL(`./_mutant-zt2-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, src.replace(old, neu).replace(/from '\.\//g, "from '../src/"))
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}
async function built () {
  const srv = server()
  const rec = Z.zigRecord(siteOn(srv).site, srv.read, { home: HOME, g: G12 })
  const { p } = zigProject(rec)
  const e = zbot(srv, 'A', { inv: KITZ(), feet: [-5, G + 1, -5] })
  for (let v = 0; v < 12 && !zigDone(srv, rec); v++) await R.runVisit(p('A'), e, { maxSteps: 400 })
  assert.ok(zigDone(srv, rec), 'built')
  return { srv, rec, p, e }
}
/** Two dirt pillars on tier 0's tread (where a 1x1 tower beside the tier wall leaves its block). */
function pillars (srv, rec) {
  const [x0, z0] = rec.corner, y0 = rec.baseY
  const ps = [[x0 + 1, y0 + 2, z0 + 1], [x0 + 6, y0 + 2, z0 + 1]]
  for (const c of ps) srv.set(c, 'dirt')
  return ps
}

console.log('ZIGTIDY-02')
await t('THE WINDOW: the tidy is a repair for 2 h after a repair completion, `due` after it; no stamp or a future one opens nothing', () => {
  const now = 1_000_000_000
  assert.strictEqual(S.tidyIsRepair(now - 60_000, now), true)
  assert.strictEqual(S.tidyIsRepair(now - S.TIDY_AFTER_REPAIR_MS + 1, now), true)
  assert.strictEqual(S.tidyIsRepair(now - S.TIDY_AFTER_REPAIR_MS, now), false)
  assert.strictEqual(S.tidyIsRepair(null, now), false)
  assert.strictEqual(S.tidyIsRepair(now + 10 * 60_000, now), false, 'a bad clock')
  // ...and a tidy read as damage is taken BEFORE an open project (the paths at 261/263 clears_wait all day); as `due`, after it
  const list = [{ plot: 'monument' }, { plot: 'paths' }]
  assert.strictEqual(S.activeProject([{ plot: 'monument', exists: true, complete: true, damaged: true }, { plot: 'paths', exists: true, complete: false }], list).plot, 'monument')
  assert.strictEqual(S.activeProject([{ plot: 'monument', exists: true, complete: true, damaged: false, due: true }, { plot: 'paths', exists: true, complete: false }], list).plot, 'paths')
})
await t('THE STALE STUCK STAMP: a complete record\'s stamp whose cells all read done is dropped; one open cell, or no reader, keeps it', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'zt2-'))
  try {
    const key = 'project-0_70_0.monument', now = Date.now()
    const cells = { '-33,67,-33': { visits: 1, firstAt: now, lastAt: now }, '-34,67,-33': { visits: 1, firstAt: now, lastAt: now } }
    assert.ok(PJ.stuckWrite(dir, key, 'showcase-Bravo', cells, { now, stuckAt: now }))
    const rec = { cells: [{ at: [-33, 67, -33], role: 'skin' }, { at: [-34, 67, -33], role: 'skin' }, { at: [0, 0, 0], role: 'core' }] }
    const reads = done => k => S.stuckStale(k, rec, c => done.has(c.at.join(',')))
    assert.strictEqual(PJ.stuckAt(dir, key), now, 'no predicate: as before')
    assert.strictEqual(PJ.stuckAt(dir, key, { stale: reads(new Set(['-33,67,-33', '-34,67,-33'])) }), null, 'both done: stale')
    assert.strictEqual(PJ.stuckAt(dir, key, { stale: reads(new Set(['-33,67,-33'])) }), now, 'one still open: the back-off holds')
    assert.strictEqual(PJ.stuckAt(dir, key, { stale: k => S.stuckStale(k, rec, () => false) }), now, 'unread is not done')
    assert.strictEqual(S.stuckStale(['9,9,9'], rec, () => true), false, 'a cell that is no record cell is never done')
    // another holder's live stamp still counts when this one is stale
    assert.ok(PJ.stuckWrite(dir, key, 'showcase-Gale', { '0,0,0': { visits: 2, firstAt: now - 5, lastAt: now - 5 } }, { now: now - 5, stuckAt: now - 5 }))
    assert.strictEqual(PJ.stuckAt(dir, key, { stale: reads(new Set(['-33,67,-33', '-34,67,-33'])) }), now - 5)
    // the mutant that never consults `stale`: Bravo's stamp holds the finished build 6 h (killed)
    await withMutant('buildproj.mjs', "if (typeof stale === 'function')", "if (false && typeof stale === 'function')", async M => {
      assert.strictEqual(M.stuckAt(dir, key, { stale: reads(new Set(['-33,67,-33', '-34,67,-33', '0,0,0'])) }), now, 'mutant: the stale stamp counts')
    })
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
await t('THE TREAD PRICE: a walk\'s scaffold on a finished tread costs ZIG_TREAD_PRICE (under the pathfinder\'s 100 cut), off it nothing', async () => {
  const { srv, rec } = await built()
  const tops = Z.zigTreadTops(rec)
  const cells = new Set(rec.cells.map(c => k3(c.at)))
  const ps = pillars(srv, rec)
  for (const c of ps) assert.strictEqual(tops.get(k3(c)), Z.ZIG_TREAD_PRICE, `${c} is a tread top`)
  assert.ok([...tops.keys()].every(k => !cells.has(k)), 'never a record cell')
  const fp = new Set(); fp.solidOnly = new Set(cells); fp.soft = tops
  const at = k => { const [x, y, z] = k.split(',').map(Number); return { position: { x, y, z }, boundingBox: 'empty' } }
  const tread = k3(ps[0])
  assert.strictEqual(S.footprintCost(fp, 'walk', at(tread)), Z.ZIG_TREAD_PRICE)
  assert.strictEqual(S.footprintCost(fp, 'ascend', at(tread)), 0, 'an escape profile is never priced')
  const [x, y, z] = tread.split(',').map(Number)
  assert.strictEqual(S.footprintCost(fp, 'walk', at(`${x},${y + 3},${z}`)), 0, 'the air above: nothing')
  // a 1x1 tower move is 1 + price + placeCost (5): still under mineflayer-pathfinder's 100 cut (a bot with no stair still climbs)
  assert.ok(1 + Z.ZIG_TREAD_PRICE + 5 < 100)
  await withMutant('shop.mjs', 'return cells.soft?.get?.(k) ?? 0', 'return 0', async M => assert.strictEqual(M.footprintCost(fp, 'walk', at(tread)), 0, 'mutant: unpriced'))
})
await t('THE WALK THAT DID NOT ARRIVE: no tidy dig from out of reach, no `unknown`, the tidy ends and the visit goes on (mutant: dug blind)', async () => {
  const scenario = async RM => {
    const { srv, rec, p } = await built()
    const ps = pillars(srv, rec)
    const far = zbot(srv, 'A', { inv: KITZ(), feet: [40, G + 1, 40] })
    const sent = []
    far.walkTo = async () => true                                        // stuck: the feet never move
    const dig0 = far.dig; far.dig = async (c, n) => { sent.push(k3(c)); return dig0(c, n) }
    const r = await RM.runVisit({ ...p('A'), tidy: Z.zigTidy(rec, srv.read) }, far, { maxSteps: 400 })
    return { r, sent, ps, srv }
  }
  const { r, sent, ps, srv } = await scenario(R)
  assert.deepStrictEqual(sent, [], 'no dig sent from 40 blocks away')
  assert.strictEqual(r.unknown, 0)
  for (const c of ps) assert.strictEqual(srv.read(...c).name, 'dirt', 'the pillars wait for a builder who reaches them')
  assert.strictEqual(r.stop, 'complete', 'the visit went on')
  await withMutant('buildrun.mjs', "if (!digReachFrom(e.feet?.(), at)) return 'unreached'", '', async M => {
    const m = await scenario(M)
    assert.ok(m.sent.length > 0, 'the mutant digs blind')
  })
  // in reach: dug (the guard is not a blanket refusal)
  const b = await built()
  const ps2 = pillars(b.srv, b.rec)
  const r2 = await R.runVisit({ ...b.p('A'), tidy: Z.zigTidy(b.rec, b.srv.read) }, b.e, { maxSteps: 400 })
  assert.strictEqual(r2.cleared, 2)
  for (const c of ps2) assert.strictEqual(b.srv.read(...c).name, 'air')
  assert.strictEqual(R.digReachFrom([0, 70, 0], [3, 71, 0]), true)
  assert.strictEqual(R.digReachFrom([0, 70, 0], [40, 71, 40]), false)
  assert.strictEqual(R.digReachFrom(null, [40, 71, 40]), true, 'unknown feet: the dig decides')
})
await t('skills.mjs (structural): the window wired into shopActive, the stamp written by a placing complete visit, the stale reader', () => {
  const src = readFileSync(new URL('../src/skills.mjs', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  const fnAt = sig => { const i = src.indexOf(sig); assert.ok(i >= 0, sig); return src.slice(i, src.indexOf('\n}\n', i)) }
  const sa = fnAt('export function shopActive (')
  assert.ok(/tidyIsRepair\(zigRepairedAt\(projKeyOf\(p\.plot\), now\), now\)/.test(sa) && /recordDamaged\(b, rec, \{ tidy: tidyFirst \}\)/.test(sa))
  assert.ok(/if \(\(r\.placed \?\? 0\) > 0 \|\| pub\.result === 'accepted'\) zigRepairedWrite\(key, Date\.now\(\)/.test(fnAt('async function buildMonument (')))
  assert.ok(/return projStuckLive\(shopKey\(\), now\)/.test(fnAt('export function shopStuckAt (')))
  assert.ok(/projStuckAt\(dir, key, \{ before: now \+ 60_000, stale \}\)/.test(fnAt('function projStuckLive (')))
  assert.ok(/fp\.soft\.set\(k, v\)/.test(fnAt('export function shopFootprintRefresh (')))
  // the showcase stack's stuckwait-01: the per-project back-off reads the same live stamp
  assert.ok(/stuckBackoff\(states, plot => projStuckLive\(projKeyOf\(plot\), now\), now\)/.test(sa))
})
console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
