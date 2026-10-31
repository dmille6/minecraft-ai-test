// SHAFT-03: THE TOWN STAIR GETS BUILT (LIVE 10-31, 02:45-13:26Z, 11 of 16 towns' stairs with no progress; 49 stair visits read
// from the files). Each cause, tested by what the code DOES:
//   1. 19 of 21 aborted visits were the entombment reflex inside the stair -> the visit and the use walks hold the runner's
//      'stair' body claim (withStairClaim; reflex.mjs reads only that typed claim).
//   2. 14 of 21 `walk_failed` visits started from a mine far under the town (atTown is a horizontal circle) -> no stair order
//      for a bot below ground outside the stair (stairStartRefusal, buildOrder skip 'underground').
//   3. one failed visit held the whole pool's stair 6 h (the stamp is the project's) -> a stair stamp holds 30 min.
//   4. `no_reach` on step 0's tread from the collar exit (3 visits) -> step 0's stand is a ground cell beside it (step0Stand).
//   5. `no_support` on a lining cell over a cave pocket (2 visits) -> a support is placed beside it first (supportFor).
import assert from 'node:assert'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import * as G from '../src/shaftgeom.mjs'
import { runStairVisit, withStairClaim } from '../src/shaftvisit.mjs'
import * as S from '../src/shop.mjs'

let pass = 0, fail = 0
const t = async (name, fn) => { try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 5).join('\n        ')}`) } }
const k3 = (x, y, z) => `${x},${y},${z}`
const N6 = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

// ---- a fake world (stone at and below g, air above) and effects with the REAL bot's reach rule -----------------------------
function world (g, over = new Map()) {
  const at = new Map(over)
  const name = (x, y, z) => at.get(k3(x, y, z)) ?? (y <= g ? 'stone' : 'air')
  const BB = n => (/^(air|cave_air|water|lava|torch|wall_torch|short_grass)$/.test(n) ? 'empty' : 'block')
  return { at, name, read: (x, y, z) => { const n = name(x, y, z); return { name: n, boundingBox: BB(n) } }, set: (c, n) => at.set(k3(...c), n) }
}
const full = (w, c) => { const b = w.read(...c); return b.boundingBox === 'block' && !/water|lava/.test(b.name) }
/** shaftvisit.mjs stairBotEffects' click, on the fake: a full neighbour face within 4.5 of the eye, else no_reach; none, no_support. */
function fx (w, feet0, { reach = 4.5 } = {}) {
  let feet = feet0
  const rows = []
  return {
    rows,
    get read () { return w.read },
    feet: () => feet,
    walkTo: async c => { const f = w.read(...c), h = w.read(c[0], c[1] + 1, c[2]), fl = w.read(c[0], c[1] - 1, c[2]); if (f.boundingBox === 'empty' && h.boundingBox === 'empty' && fl.boundingBox === 'block') feet = c; return true },
    dig: async c => { w.set(c, 'air'); return 'confirmed' },
    place: async c => {
      const refs = N6.map(([a, b, d]) => [c[0] + a, c[1] + b, c[2] + d]).filter(r => full(w, r))
      if (!refs.length) return 'no_support'
      const eye = { x: feet[0] + 0.5, y: feet[1] + 1.62, z: feet[2] + 0.5 }
      const near = refs.some(r => { const f = [c[0] - r[0], c[1] - r[1], c[2] - r[2]]; return Math.hypot(r[0] + 0.5 + f[0] * 0.5 - eye.x, r[1] + 0.5 + f[1] * 0.5 - eye.y, r[2] + 0.5 + f[2] * 0.5 - eye.z) <= reach })
      if (!near) return 'no_reach'
      w.set(c, 'cobblestone'); return 'confirmed'
    },
    toolOk: () => true, fence: () => true, now: () => 0, aborted: () => false,
    log: (op, d) => rows.push([op, d]),
  }
}
const SITE = (g, away) => ({ origin: G.originFor(100, 100, away), away, g, center: [100, 100] })
/** The live shape (placebo-a: exit feet 72 over ground 70): one block of ground raised on every collar-exit column, so the exit
 *  stands at g+2 -- the eye higher and as far out as before. */
function raiseExits (site, w) {
  for (const [u, v] of [[1, -2], [0, -2], [2, -2], [-2, 1], [4, 1], [-2, 0], [4, 0]]) { const p = G.toWorld(site.origin, site.away, u, v); w.set([p.x, site.g + 1, p.z], 'stone') }
  return w
}
const recOf = (site, w) => G.stairRecord({ site, K: G.planStair(site).K, landings: G.planStair(site).landings.map(l => l.feet), lining: 0, digs: 0, stopK: null, exit: G.collarExit(w.read, site) }, { home: { x: 100, y: 71, z: 78 } })
const visitWith = async (run, rec, e) => {
  let r, n = 0
  do { r = await run({ rec, exit: rec.exit, built: new Set(), onLanding: async () => true, onStop: async () => {}, onDropLanding: async () => {} }, e, { unitsMax: 30 }) } while (r.stop === 'units' && ++n < 40)
  return r
}
/** A copy of shaftvisit.mjs with `edit` applied, importing the given shaftgeom (a mutant's), in test/ -> its module. */
async function visitModule (edit = s => s, geom = new URL('../src/shaftgeom.mjs', import.meta.url).href) {
  const src = readFileSync(new URL('../src/shaftvisit.mjs', import.meta.url), 'utf8')
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}-v.mjs`, import.meta.url)
  writeFileSync(out, edit(src).replace("from './shaftgeom.mjs'", `from '${geom}'`).replace("from './digtown.mjs'", `from '${new URL('../src/digtown.mjs', import.meta.url).href}'`))
  return { mod: await import(out.href), out }
}

console.log('1. THE STAIR BODY CLAIM')
function fakeRunner () {
  const r = { claims: [], current: { skill: 'build_shop' }, bodyClaim: null }
  r.claimBody = what => { const c = { what, renewed: 0, released: false }; r.bodyClaim = c; r.claims.push(c); return { renew: () => { c.renewed++ }, release: () => { c.released = true; if (r.bodyClaim === c) r.bodyClaim = null } } }
  return r
}
await t("withStairClaim holds a 'stair' claim while fn runs, renews it, and releases it on return AND on a throw", async () => {
  const r = fakeRunner()
  let seen = null
  await withStairClaim(r, async () => { seen = r.bodyClaim?.what; await new Promise(res => setTimeout(res, 45)) }, { every: 10 })
  assert.strictEqual(seen, 'stair', 'held during fn')
  assert.ok(r.claims[0].renewed >= 2, `renewed while fn ran (${r.claims[0].renewed})`)
  assert.ok(r.claims[0].released && r.bodyClaim === null, 'released after')
  const r2 = fakeRunner()
  await assert.rejects(withStairClaim(r2, async () => { throw new Error('boom') }), /boom/)
  assert.ok(r2.claims[0].released && r2.bodyClaim === null, 'released after a throw')
  assert.strictEqual(await withStairClaim(null, async () => 7), 7, 'no runner: fn still runs (the claim is inert)')
})
await t('WIRED: the stair visit and both use walks run inside withStairClaim(ctx.runner, ...); reflex.mjs stands down on the stair claim', () => {
  const src = strip(readFileSync(new URL('../src/skills.mjs', import.meta.url), 'utf8'))
  for (const a of ['const r = await withStairClaim(ctx.runner, () => runStairVisit({',
    'const arrived = await withStairClaim(ctx.runner, () => stairWalk(bot, use.stand, STAIR_DOWN_MS, signal))',
    'const ok = await withStairClaim(ctx.runner, () => stairWalk(bot, rec.exit, STAIR_UP_MS, signal))']) assert.strictEqual(src.split(a).length, 2, `missing or not unique: ${a}`)
  assert.strictEqual(src.split('await runStairVisit(').length, 1, 'no unclaimed visit call')
  assert.strictEqual(src.split('await stairWalk(').length, 1, 'no unclaimed stair walk')
  const rx = strip(readFileSync(new URL('../src/reflex.mjs', import.meta.url), 'utf8'))
  assert.match(rx, /const climbing = !!runner\?\.bodyClaimFor\?\.\('climb'\) \|\| !!runner\?\.bodyClaimFor\?\.\('stair'\)/)
  assert.match(rx, /!escaping && !marooned && !climbing && !inDanger && isEntombed\(bot\)/)
})

console.log('2. NO STAIR ORDER FROM A MINE')
const REC = { blueprint: G.SHAFT_BLUEPRINT, plot: 'shaft', state: 'open', site: { origin: { x: 367, z: 122 }, away: 'n', g: 70, center: [366, 121] }, K: 55, box: [364, 116, 368, 123], landings: [48, 32, 16] }
await t('stairStartRefusal: the surface yes, a mine under the town no, the stair itself yes; unsited, the town height stands in', () => {
  assert.strictEqual(G.stairStartRefusal(REC, [360, 69, 148], 73), null, 'at the surface')
  assert.strictEqual(G.stairStartRefusal(REC, [360, 64, 148], 73), null, 'ground - 6')
  assert.strictEqual(G.stairStartRefusal(REC, [343, 19, 122], 73), 'underground', 'LIVE board-d-Alpha 12:20Z')
  assert.strictEqual(G.stairStartRefusal(REC, [390, -23, 148], 73), 'underground', 'LIVE isolated-a-Delta 08:52Z')
  assert.strictEqual(G.stairStartRefusal(REC, [366, 35, 119], 73), null, 'on the stair (its box): a builder resumes')
  assert.strictEqual(G.stairStartRefusal(REC, [369, 35, 124], 73), null, 'the box + 1')
  assert.strictEqual(G.stairStartRefusal(REC, [371, 35, 124], 73), 'underground', 'POSITIVE CONTROL: two out is not the stair')
  assert.strictEqual(G.stairStartRefusal(null, [358, 34, 122], 73), 'underground', 'unsited: LIVE hive-a-Comet sited from y=34 and failed its walk')
  assert.strictEqual(G.stairStartRefusal(null, [358, 70, 122], 73), null)
  assert.strictEqual(G.stairStartRefusal(REC, null, 73), null, 'no feet: no refusal (the order behaves as before)')
})
const BASE = { on: true, shared: true, atTown: true, now: 10 * 3600_000, state: {}, slotsFree: true, health: 20, freeSlots: 36, planned: true }
await t('buildOrder: the stair is not ordered for a bot under the town; it is at the surface; the other projects are not gated', () => {
  assert.strictEqual(S.buildOrder({ ...BASE, record: REC, feet: [343, 19, 122], groundY: 73 }).skip, 'underground')
  assert.deepStrictEqual(S.buildOrder({ ...BASE, record: REC, feet: [360, 69, 148], groundY: 73 }).order, { skill: 'build_shop', args: {} })
  assert.ok(S.buildOrder({ ...BASE, record: { plot: 'house1' }, feet: [343, 19, 122], groundY: 73 }).order, 'a house order is not gated by depth')
  assert.ok(S.buildOrder({ ...BASE, record: REC }).order, 'no feet given: as before')
})
await t('WIRED: cognitive passes the bot\'s feet and the town height to buildOrder', () => {
  const src = strip(readFileSync(new URL('../src/cognitive.mjs', import.meta.url), 'utf8'))
  const i = src.indexOf('const r = buildOrder({ on: SHOP.on'), j = src.indexOf('\n', src.indexOf('stuckAt: shopStuckAt', i) + 30)
  assert.ok(i > 0 && j > i, 'ANCHOR MISSING')
  assert.match(src.slice(i, j), /feet: \[Math\.floor\(p\.x\), Math\.floor\(p\.y \+ 1e-6\), Math\.floor\(p\.z\)\], groundY: config\.world\.homeY \}\)/)
})

console.log('3. A STAIR STAMP HOLDS 30 MIN, NOT 6 H')
await t('stuckBackoff: a stair stamp 31 min old frees the stair; 10 min old holds it; a workshop stamp 31 min old still holds', () => {
  const now = 10 * 3600_000
  const st = [{ plot: 'shop', exists: true, complete: false }, { plot: 'shaft', exists: true, complete: false }]
  const w = S.stuckBackoff(st, () => now - 31 * 60_000, now)
  assert.strictEqual(w.find(s => s.plot === 'shaft').free, undefined, 'the stair is free again')
  assert.strictEqual(w.find(s => s.plot === 'shop').free, false, 'POSITIVE CONTROL: the workshop keeps its 6 h')
  assert.strictEqual(S.stuckBackoff(st, () => now - 10 * 60_000, now).find(s => s.plot === 'shaft').free, false, '10 min: held')
})
await t('buildOrder: the F4 hold on the stair ends at 30 min; on the workshop at 6 h', () => {
  const now = 10 * 3600_000
  assert.strictEqual(S.buildOrder({ ...BASE, record: REC, now, stuckAt: now - 20 * 60_000 }).skip, 'stuck_on_cell')
  assert.ok(S.buildOrder({ ...BASE, record: REC, now, stuckAt: now - S.SHAFT_STUCK_RETRY_MS - 1 }).order)
  assert.strictEqual(S.buildOrder({ ...BASE, record: { plot: 'shop' }, now, stuckAt: now - S.SHAFT_STUCK_RETRY_MS - 1 }).skip, 'stuck_on_cell')
})

console.log('4. STEP 0 FROM A GROUND CELL BESIDE IT')
await t('step0Stand: face-adjacent to step 0, outside the 3x3, feet on the ground, not over a stair air cell -- 4 orientations, ground 40..100', () => {
  for (const away of ['n', 's', 'e', 'w']) for (let g = 40; g <= 100; g += 3) {
    const site = SITE(g, away), plan = G.planStair(site), w = world(g)
    const s = G.step0Stand(w.read, plan)
    assert.ok(s, `${away} g=${g}: a stand`)
    const t0 = plan.steps[0].tread
    assert.strictEqual(Math.abs(s[0] - t0[0]) + Math.abs(s[2] - t0[2]), 1, 'face-adjacent column')
    assert.strictEqual(s[1], g + 1, 'feet on the ground')
    assert.ok(!plan.air.has(k3(...s)) && !plan.air.has(k3(s[0], s[1] - 1, s[2])), 'never in or over a stair air cell')
  }
})
await t('LIVE GEOMETRY (g=70): from the exit step 0\'s tread is out of reach somewhere; with step0Stand every orientation completes', async () => {
  let farFromExit = 0
  for (const away of ['n', 's', 'e', 'w']) {
    const site = SITE(70, away), w = raiseExits(site, world(70)), rec = recOf(site, w)
    assert.strictEqual(rec.exit[1], 72, 'the exit stands at g+2')
    const t0 = G.planStair(site).steps[0].tread
    w.set(t0, 'air')                                            // the tread to place (as at placebo-a 228,70,-118)
    if ((await fx(w, rec.exit).place(t0)) === 'no_reach') farFromExit++
    w.set(t0, 'air')
    const r = await visitWith(runStairVisit, rec, fx(w, rec.exit))
    assert.strictEqual(r.stop, 'complete', `${away}: ${r.stop} ${r.why}`)
  }
  assert.ok(farFromExit >= 1, `POSITIVE CONTROL: the exit really is out of reach of step 0's tread (${farFromExit}/4)`)
})
await t('MUTANT KILLED: standFor ignoring its read (the exit for step 0, as shaft-02) ends the same visit `no_reach`', async () => {
  const src = readFileSync(new URL('../src/shaftgeom.mjs', import.meta.url), 'utf8')
  const old = "  if (work.kind === 'step') return work.k === 0 ? ((read && step0Stand(read, plan)) ?? exit) : standOf(plan, work.k - 1)\n"
  assert.strictEqual(src.split(old).length, 2, 'ANCHOR MISSING OR NOT UNIQUE')
  const geom = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}-g.mjs`, import.meta.url)
  writeFileSync(geom, src.replace(old, "  if (work.kind === 'step') return work.k === 0 ? exit : standOf(plan, work.k - 1)\n"))
  const { mod: V, out } = await visitModule(s => s, geom.href)
  try {
    let refused = 0
    for (const away of ['n', 's', 'e', 'w']) {
      const site = SITE(70, away), w = raiseExits(site, world(70)), rec = recOf(site, w)
      w.set(G.planStair(site).steps[0].tread, 'air')
      if ((await visitWith(V.runStairVisit, rec, fx(w, rec.exit))).stop === 'no_reach') refused++
    }
    assert.ok(refused >= 1, 'the mutant refuses where the real code builds')
  } finally { for (const f of [geom, out]) try { unlinkSync(f) } catch {} }
})

console.log('5. A SUPPORT FOR A CELL OVER A CAVE POCKET')
/** A cave pocket round a lining cell of step k: the cell and all six of its face neighbours are air. */
function pocket (plan, w, k) {
  const c = plan.steps[k].lining[0]
  w.set(c, 'air')
  for (const [a, b, d] of N6) w.set([c[0] + a, c[1] + b, c[2] + d], 'air')
  return c
}
await t('supportFor: a neighbour that is not stair air, not the body, open, and itself touching a full block; null when none', () => {
  const site = SITE(70, 's'), plan = G.planStair(site), w = world(70)
  const c = pocket(plan, w, 10)
  assert.ok(!N6.some(([a, b, d]) => full(w, [c[0] + a, c[1] + b, c[2] + d])), 'the cell really has no support')
  const s = G.supportFor(w.read, plan, c, null)
  assert.ok(s, 'a support')
  assert.ok(!plan.air.has(k3(...s)), 'never a stair air cell')
  assert.strictEqual(Math.abs(s[0] - c[0]) + Math.abs(s[1] - c[1]) + Math.abs(s[2] - c[2]), 1, 'a face neighbour')
  assert.ok(N6.some(([a, b, d]) => full(w, [s[0] + a, s[1] + b, s[2] + d])), 'held by a full block')
  assert.ok(!G.supportFor(w.read, plan, c, [s[0], s[1], s[2]]) || k3(...G.supportFor(w.read, plan, c, [s[0], s[1], s[2]])) !== k3(...s), 'never the bot\'s feet')
  const lone = world(70)
  for (let dx = -3; dx <= 3; dx++) for (let dy = -3; dy <= 3; dy++) for (let dz = -3; dz <= 3; dz++) lone.set([100 + dx, 50 + dy, 100 + dz], 'air')
  assert.strictEqual(G.supportFor(lone.read, plan, [100, 50, 100], null), null, 'POSITIVE CONTROL: a cell two deep in open air has none')
})
await t('a visit over a cave pocket places the support, then the cell, and completes (shaft-02 ended `no_support`)', async () => {
  for (const away of ['n', 'e']) {
    const site = SITE(70, away), plan = G.planStair(site), w = world(70), rec = recOf(site, w)
    const c = pocket(plan, w, 12)
    const e = fx(w, rec.exit)
    const r = await visitWith(runStairVisit, rec, e)
    assert.strictEqual(r.stop, 'complete', `${away}: ${r.stop} ${r.why}`)
    assert.ok(e.rows.some(([op, d]) => op === 'place' && d.why === 'support'), 'a support row')
    assert.ok(full(w, c), 'the pocket cell is lined')
  }
})
await t('MUTANT KILLED: without the support branch the same visit ends `no_support`', async () => {
  const old = "        if (r === 'no_support' && !supported.has(key)) {\n"
  const { mod: V, out } = await visitModule(s => { assert.strictEqual(s.split(old).length, 2, 'ANCHOR MISSING OR NOT UNIQUE'); return s.replace(old, '        if (false) {\n') })
  try {
    const site = SITE(70, 'n'), plan = G.planStair(site), w = world(70), rec = recOf(site, w)
    pocket(plan, w, 12)
    assert.strictEqual((await visitWith(V.runStairVisit, rec, fx(w, rec.exit))).stop, 'no_support')
  } finally { try { unlinkSync(out) } catch {} }
})

console.log(`\n${pass} passed, ${fail} failed`); if (fail) process.exit(1)
