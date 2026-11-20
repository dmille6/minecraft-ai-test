// STEPWELL-03SHOW: A CUT NO WALK REACHES IS SET ASIDE, AND THE LAYER BELOW GOES ON; THE STEP WELL'S HOLD ENDS WITH ITS RELEASE.
// (stepwell.mjs asideRefusal / asideFor / stampStale, stepwellvisit.mjs runStepwellVisit's set-aside, projturn.mjs turnView codeOf /
// turnAfter code; trace docs/reports/stepwell-trace-2026-11-20.md: one bridge dirt block floating 8 above the pit held the tank.)
// Behaviour through THE CHAIN on a fake world with the real visit loop: a floating dirt cut with no stand -> refused no_stand twice ->
// set aside (a row) -> the next layers are dug in the same visit; the next visit reuses the bot's own proof without walking; with
// SWASIDE off (the positive control) the same world ends `passed` with nothing done, as LIVE. What must still hold the layer: a
// falling block, a liquid beside the cell, a cell refused for another reason, the bot's own floor. Then the hold: a stamp from another
// code version (or none) is stale, a stamp of this version naming no cell holds; a turn back-off of another version holds nothing
// and does not carry into this version's count. Anchored mutants (each asserts its anchor present and unique) for every guard.
import assert from 'node:assert'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
const S = await import('../src/stepwell.mjs')
const V = await import('../src/stepwellvisit.mjs')
const PT = await import('../src/projturn.mjs')

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 6).join('\n        ')}`) }
}
const SW_PATH = new URL('../src/stepwell.mjs', import.meta.url)
const SV_PATH = new URL('../src/stepwellvisit.mjs', import.meta.url)
const PT_PATH = new URL('../src/projturn.mjs', import.meta.url)
async function withMutant (p, old, neu, fn) {
  const src = readFileSync(p, 'utf8')
  assert.ok(src.includes(old), `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 60))}`)
  assert.ok(src.split(old).length === 2, 'ANCHOR MISSING OR NOT UNIQUE')
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, src.replace(old, neu).replace(/from '\.\//g, "from '../src/"))
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}
const strip = src => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/[ \t]\/\/ .*$/gm, '')

// ---- a fake world: grass at G, dirt G-1..G-3, stone below; overrides by "x,y,z" -> name (stepwell.test.mjs's) --------------------
const G = 64
const EMPTY = /^(air|cave_air|torch|short_grass)$/
const mk = n => (n == null ? null : { name: n, boundingBox: EMPTY.test(n) || /_sapling$/.test(n) ? 'empty' : (/water|lava/.test(n) ? 'empty' : 'block') })
function world (over = {}) {
  const m = new Map(Object.entries(over))
  const base = (x, y, z) => (y > G ? 'air' : y === G ? 'grass_block' : y >= G - 3 ? 'dirt' : y >= G - 40 ? 'stone' : 'bedrock')
  const get = (x, y, z) => { const k = `${x},${y},${z}`; return m.has(k) ? m.get(k) : base(x, y, z) }
  return { read: (x, y, z) => mk(get(x, y, z)), set: (c, n) => m.set(c.join(','), n), get: c => get(...c), m }
}
const SITE = { origin: { x: 0, z: 0 }, away: 's', g: G, W: 21, T: 1 }
// THE LIVE SHAPE: a cut seven above the ground in the middle of the tank (the bridge block 8 above the pit), nothing under it
const FLOAT = [10, G + 7, 10]
/** A fake bot (stepwell.test.mjs's): walkTo arrives on a valid stand (floor full, feet and head open); dig / place mutate the world. */
function fakeBot (w, { start, log = [] } = {}) {
  let feet = [...start]
  let t = 0
  const placed = role => ({ floor: 'stone_bricks', trim: 'stone_bricks', wall: 'cobblestone', body: 'cobblestone', under: 'cobblestone', post: 'cobblestone_wall', light: 'torch', dlight: 'torch', tread: 'cobblestone', seal: 'cobblestone' }[role])
  return {
    get read () { return w.read },
    feet: () => feet,
    walks: 0,
    walkTo: async function (c) {
      this.walks++
      const fl = w.read(c[0], c[1] - 1, c[2]), f = w.read(...c), h = w.read(c[0], c[1] + 1, c[2])
      if (!(fl?.boundingBox === 'block' && f?.boundingBox === 'empty' && h?.boundingBox === 'empty')) return false
      // no route onto a FLOATING floor (air under it): the live bridge stands, which no walk reaches (the trace's real-route replay)
      if (w.read(c[0], c[1] - 2, c[2])?.boundingBox === 'empty') return false
      feet = [...c]; t += 1; return true
    },
    dig: async c => { w.set(c, 'air'); log.push(['dig', c]); t += 1; return 'confirmed' },
    place: async (c, role) => { w.set(c, placed(role)); log.push(['place', c, role]); t += 1; return 'confirmed' },
    toolOk: () => true,
    fence: () => true,
    log: (op, d) => log.push([op, d]),
    now: () => t,
    aborted: () => false,
  }
}
const kOf = a => a.join(',')
const START = [10, G + 1, -2]
const visit = (M, P, e, opts = {}, p = {}) => M.runStepwellVisit({ plan: P, exit: P.exit, onStop: async () => {}, ...p }, e, { opsMax: 400, ...opts })

console.log('THE RULE (pure)')
await t('asideRefusal: a floating dirt cut may be set aside; sand, a liquid beside it, an open cell, a plan cell, an unread one may not', () => {
  const P = S.planTank(SITE)
  assert.ok(P.cutKeys.has(kOf(FLOAT)), 'the floating cell is a cut of the plan')
  assert.strictEqual(S.asideRefusal(world({ [kOf(FLOAT)]: 'dirt' }).read, P, FLOAT), null)
  assert.strictEqual(S.asideRefusal(world({ [kOf(FLOAT)]: 'sand' }).read, P, FLOAT), 'falling')
  assert.strictEqual(S.asideRefusal(world({ [kOf(FLOAT)]: 'gravel' }).read, P, FLOAT), 'falling')
  assert.strictEqual(S.asideRefusal(world({ [kOf(FLOAT)]: 'dirt', [kOf([11, G + 7, 10])]: 'water' }).read, P, FLOAT), 'liquid')
  assert.strictEqual(S.asideRefusal(world({ [kOf(FLOAT)]: 'dirt', [kOf([10, G + 8, 10])]: 'lava' }).read, P, FLOAT), 'liquid')
  assert.strictEqual(S.asideRefusal(world({ [kOf(FLOAT)]: 'water' }).read, P, FLOAT), 'liquid')
  assert.strictEqual(S.asideRefusal(world().read, P, FLOAT), 'open')
  const cell = P.cells.find(e => e.role === 'floor').at
  assert.strictEqual(S.asideRefusal(world({ [kOf(cell)]: 'dirt' }).read, P, cell), 'not_cut')
  assert.strictEqual(S.asideRefusal(() => null, P, FLOAT), 'unread')
})
await t('asideFor: only when EVERY cell holding the unit was proven unreachable (no_stand / walk_failed) and may be left', () => {
  const P = S.planTank(SITE)
  const w = world({ [kOf(FLOAT)]: 'dirt' })
  const u = P.units.find(q => q.y === FLOAT[1])
  assert.deepStrictEqual(S.unitHolding(w.read, P, u).map(kOf), [kOf(FLOAT)])
  assert.deepStrictEqual(S.asideFor(w.read, P, u, new Map([[kOf(FLOAT), 'no_stand']])), [{ at: FLOAT, why: 'no_stand' }])
  assert.deepStrictEqual(S.asideFor(w.read, P, u, new Map([[kOf(FLOAT), 'walk_failed']])), [{ at: FLOAT, why: 'walk_failed' }])
  assert.strictEqual(S.asideFor(w.read, P, u, new Map()), null, 'never proven: holds')
  assert.strictEqual(S.asideFor(w.read, P, u, new Map([[kOf(FLOAT), 'dig:refused']])), null, 'reached and refused: holds')
  // a second holding cell that was never proven holds the unit: nothing is set aside
  const w2 = world({ [kOf(FLOAT)]: 'dirt', [kOf([3, G + 7, 3])]: 'dirt' })
  assert.strictEqual(S.asideFor(w2.read, P, u, new Map([[kOf(FLOAT), 'no_stand']])), null)
  // already set aside: holds nothing more
  assert.strictEqual(S.asideFor(w.read, P, u, new Map([[kOf(FLOAT), 'no_stand']]), { aside: new Set([kOf(FLOAT)]) }), null)
  assert.strictEqual(S.unitDone(w.read, P, u, { aside: new Set([kOf(FLOAT)]) }), true)
  assert.strictEqual(S.unitDone(w.read, P, u), false)
})

console.log('THE CHAIN (the real visit loop)')
await t('POSITIVE CONTROL (SWASIDE off = LIVE): the floating cut is refused no_stand twice and the visit ends passed with nothing done', async () => {
  const P = S.planTank(SITE)
  const w = world({ [kOf(FLOAT)]: 'dirt' })
  const log = []
  const e = fakeBot(w, { start: START, log })
  const r = await visit(V, P, e, { swAside: false })
  assert.strictEqual(r.stop, 'passed')
  assert.strictEqual(r.y, FLOAT[1])
  assert.strictEqual(r.dug + r.placed, 0)
  assert.deepStrictEqual(log.filter(q => q[0] === 'refused').map(q => q[1].why), ['no_stand', 'no_stand'])
  assert.deepStrictEqual(r.passed, [kOf(FLOAT)])
  assert.strictEqual(r.aside, 0)
})
await t('the floating cut is SET ASIDE (one row) and the layers below are dug in the same visit; the cell stays owed', async () => {
  const P = S.planTank(SITE)
  const w = world({ [kOf(FLOAT)]: 'dirt' })
  const log = []
  const e = fakeBot(w, { start: START, log })
  const mem = new Map()
  const r = await visit(V, P, e, { swAside: true }, { aside: mem })
  assert.strictEqual(r.aside, 1)
  assert.deepStrictEqual(log.filter(q => q[0] === 'set_aside').map(q => [kOf(q[1].at), q[1].why, q[1].y]), [[kOf(FLOAT), 'no_stand', FLOAT[1]]])
  assert.ok(r.dug > 50, `the layers below were dug: ${r.dug}`)
  assert.ok(log.some(q => q[0] === 'dig' && q[1][1] <= G), 'a cut at or below the ground was dug')
  assert.notStrictEqual(r.stop, 'passed')
  assert.strictEqual(w.get(FLOAT), 'dirt', 'never dug, never removed')
  assert.ok(mem.has(kOf(FLOAT)), 'the proof is remembered')
  // still owed on the record's own tests: no tier is built over it
  assert.ok(!S.tiersDone(w.read, P).includes(1))
  assert.strictEqual(S.firstUndoneUnit(w.read, P).unit.y, FLOAT[1], 'without the set-aside the scan still offers it first')
})
await t('the NEXT visit reuses the proof: set aside as remembered, no walk at it; an old proof (ASIDE_MS) is walked at again', async () => {
  const P = S.planTank(SITE)
  const w = world({ [kOf(FLOAT)]: 'dirt' })
  const mem = new Map([[kOf(FLOAT), 0]])
  const log = []
  const e = fakeBot(w, { start: START, log })
  const r = await visit(V, P, e, { swAside: true }, { aside: mem })
  assert.deepStrictEqual(log.filter(q => q[0] === 'set_aside').map(q => q[1].why), ['remembered'])
  assert.ok(!log.some(q => q[0] === 'refused' && kOf(q[1].at) === kOf(FLOAT)), 'no walk at the remembered cell')
  assert.ok(r.dug > 0)
  // an expired proof: the cell is offered first and proven again
  const mem2 = new Map([[kOf(FLOAT), -S.ASIDE_MS - 1]])
  const log2 = []
  await visit(V, P, fakeBot(world({ [kOf(FLOAT)]: 'dirt' }), { start: START, log: log2 }), { swAside: true }, { aside: mem2 })
  assert.deepStrictEqual(log2.filter(q => q[0] === 'set_aside').map(q => q[1].why), ['no_stand'])
  // a remembered cell that can no longer be left (sand now) is dropped from the memory and holds
  const mem3 = new Map([[kOf(FLOAT), 0]])
  const r3 = await visit(V, P, fakeBot(world({ [kOf(FLOAT)]: 'sand' }), { start: START }), { swAside: true }, { aside: mem3 })
  assert.ok(!mem3.has(kOf(FLOAT)))
  assert.strictEqual(r3.stop, 'passed')
})
await t('what still HOLDS the layer: a floating SAND cut, a cut beside water, a second unproven cell', async () => {
  const P = S.planTank(SITE)
  for (const over of [{ [kOf(FLOAT)]: 'sand' }, { [kOf(FLOAT)]: 'gravel' }]) {
    const r = await visit(V, P, fakeBot(world(over), { start: START }), { swAside: true }, { aside: new Map() })
    assert.strictEqual(r.stop, 'passed', JSON.stringify(over)); assert.strictEqual(r.dug + r.placed, 0); assert.strictEqual(r.aside, 0)
  }
  // water beside it: the survey seals first; the seal has no stand either; the layer never opens past it
  const rw = await visit(V, P, fakeBot(world({ [kOf(FLOAT)]: 'dirt', [kOf([11, G + 7, 10])]: 'water' }), { start: START }), { swAside: true }, { aside: new Map() })
  assert.strictEqual(rw.aside, 0); assert.strictEqual(rw.dug, 0)
  assert.ok(['passed', 'unsealed'].includes(rw.stop), rw.stop)
})
await t('a cell the bot REACHED and was refused (dig refused) is never set aside', async () => {
  const P = S.planTank(SITE)
  // the cut sits on a pillar of stone from the ground: stands exist, the dig is refused twice
  const over = { [kOf(FLOAT)]: 'dirt' }
  for (let y = G + 1; y < FLOAT[1]; y++) over[kOf([9, y, 10])] = 'stone'
  const w = world(over)
  const e = fakeBot(w, { start: START })
  const dig0 = e.dig
  e.dig = async c => (kOf(c) === kOf(FLOAT) ? 'refused' : dig0(c))
  const r = await visit(V, P, e, { swAside: true }, { aside: new Map() })
  assert.strictEqual(r.aside, 0)
  assert.strictEqual(r.stop, 'passed')
})

// three floating stands round the cut (the live shape: the bridge's other blocks); `ok(c)` says which walks arrive
const threeStands = () => { const over = { [kOf(FLOAT)]: 'dirt' }; for (const c of [[9, G + 6, 10], [10, G + 6, 9], [11, G + 6, 10]]) over[kOf(c)] = 'stone'; return over }
await t('Codex r1 BLOCKER 1: every stand is walked at before a proof -- the THIRD stand arrives, the cut is dug, nothing is set aside', async () => {
  const P = S.planTank(SITE)
  const w = world(threeStands())
  assert.strictEqual(S.standsFor(w.read, P, FLOAT, { feet: START }).length, 3, 'three stands offered')
  const log = []
  const e = fakeBot(w, { start: START, log })
  const tried = []
  e.walkTo = async c => { tried.push(kOf(c)); if (tried.length < 3) return false; return true }
  let feet = START
  e.feet = () => feet
  const walk0 = e.walkTo
  e.walkTo = async c => { const ok = await walk0(c); if (ok) feet = [...c]; return ok }
  const r = await visit(V, P, e, { swAside: true, opsMax: 1 }, { aside: new Map() })
  assert.strictEqual(r.aside, 0)
  assert.strictEqual(tried.length, 3)
  assert.strictEqual(w.get(FLOAT), 'air', 'the cut was dug from the third stand')
})
await t('...and when all three walks fail the cell is proven (walk_failed) and set aside', async () => {
  const P = S.planTank(SITE)
  const w = world(threeStands())
  const log = []
  const e = fakeBot(w, { start: START, log })
  const tried = []
  e.walkTo = async c => { tried.push(kOf(c)); return false }
  const r = await visit(V, P, e, { swAside: true, opsMax: 5 }, { aside: new Map() })
  assert.deepStrictEqual(tried.slice(0, 3).sort(), [[9, G + 7, 10], [10, G + 7, 9], [11, G + 7, 10]].map(kOf).sort(), 'the cut\'s three stands first')
  // (every walk fails in this world, so other cells are proven too: the floating cut is the first)
  const sa = log.filter(q => q[0] === 'set_aside')
  assert.deepStrictEqual([kOf(sa[0][1].at), sa[0][1].why], [kOf(FLOAT), 'walk_failed'])
  assert.ok(r.aside >= 1)
})
await t('POSITIVE CONTROL (SWASIDE off): the same three stands, two walks, the cell passed -- the old rule', async () => {
  const P = S.planTank(SITE)
  const e = fakeBot(world(threeStands()), { start: START })
  const tried = []
  e.walkTo = async c => { tried.push(kOf(c)); return false }
  const r = await visit(V, P, e, { swAside: false }, { aside: new Map() })
  assert.strictEqual(tried.length, 2); assert.strictEqual(r.stop, 'passed')
})
await t('Codex r1 BLOCKER 2: a set-aside cell that turns to SAND mid-visit is revoked; nothing more is dug below it', async () => {
  const P = S.planTank(SITE)
  const w = world({ [kOf(FLOAT)]: 'dirt' })
  const log = []
  const e = fakeBot(w, { start: START, log })
  const dig0 = e.dig
  let n = 0, after = -1
  e.dig = async c => { const r = await dig0(c); if (++n === 1) { w.set(FLOAT, 'sand'); after = log.length } return r }
  const r = await visit(V, P, e, { swAside: true }, { aside: new Map([[kOf(FLOAT), 0]]) })
  const rev = log.filter(q => q[0] === 'aside_revoked')
  assert.deepStrictEqual(rev.map(q => [kOf(q[1].at), q[1].why]), [[kOf(FLOAT), 'falling']])
  const below = log.slice(after).filter(q => q[0] === 'dig' && q[1][1] < FLOAT[1])
  assert.strictEqual(below.length, 0, `dug below the revoked cell: ${below.length}`)
  assert.strictEqual(r.stop, 'passed')
})
await t('...a set-aside cell dug open since is simply done (no revoke row)', async () => {
  const P = S.planTank(SITE)
  const w = world({ [kOf(FLOAT)]: 'dirt' })
  const log = []
  const e = fakeBot(w, { start: START, log })
  const dig0 = e.dig
  let n = 0
  e.dig = async c => { const r = await dig0(c); if (++n === 1) w.set(FLOAT, 'air'); return r }
  await visit(V, P, e, { swAside: true, opsMax: 30 }, { aside: new Map([[kOf(FLOAT), 0]]) })
  assert.strictEqual(log.filter(q => q[0] === 'aside_revoked').length, 0)
})

console.log('MUTANTS (each guard, anchored)')
await t('mutant: falling blocks allowed -> the sand cut is set aside (the falling guard is what holds it)', async () => {
  await withMutant(SW_PATH, "  if (isFalling(b)) return 'falling'", '  void 0', async M => {
    const P = M.planTank(SITE)
    assert.strictEqual(M.asideRefusal(world({ [kOf(FLOAT)]: 'sand' }).read, P, FLOAT), null)
    const u = P.units.find(q => q.y === FLOAT[1])
    assert.deepStrictEqual(M.asideFor(world({ [kOf(FLOAT)]: 'sand' }).read, P, u, new Map([[kOf(FLOAT), 'no_stand']])), [{ at: FLOAT, why: 'no_stand' }])
  })
})
await t('mutant: the neighbour liquid check removed -> a cut beside water may be set aside', async () => {
  await withMutant(SW_PATH, "    if (isLava(nb) || isWet(nb)) return 'liquid'", '    void nb', async M => {
    const P = M.planTank(SITE)
    assert.strictEqual(M.asideRefusal(world({ [kOf(FLOAT)]: 'dirt', [kOf([11, G + 7, 10])]: 'water' }).read, P, FLOAT), null)
  })
})
await t('mutant: any refusal counted as a proof -> a reached, refused cell is set aside', async () => {
  await withMutant(SV_PATH, "    if (proof) unreach.set(k, walkFails.get(k) ? 'walk_failed' : why)\n    else unreach.delete(k)", "    unreach.set(k, 'no_stand')", async M => {
    const P = S.planTank(SITE)
    const over = { [kOf(FLOAT)]: 'dirt' }
    for (let y = G + 1; y < FLOAT[1]; y++) over[kOf([9, y, 10])] = 'stone'
    const e = fakeBot(world(over), { start: START })
    const dig0 = e.dig
    e.dig = async c => (kOf(c) === kOf(FLOAT) ? 'refused' : dig0(c))
    const r = await visit(M, P, e, { swAside: true }, { aside: new Map() })
    assert.ok(r.aside >= 1, 'the mutant sets it aside: the guard is what kept it')
  })
})
await t('mutant: the set-aside step removed -> the floating cut ends the visit passed again (the LIVE dead end)', async () => {
  await withMutant(SV_PATH, '        if (sa) { for (const q of sa) setAside(q.at, q.why, w.unit.y); continue }', '        void sa', async M => {
    const P = S.planTank(SITE)
    const r = await visit(M, P, fakeBot(world({ [kOf(FLOAT)]: 'dirt' }), { start: START }), { swAside: true }, { aside: new Map() })
    assert.strictEqual(r.stop, 'passed'); assert.strictEqual(r.dug, 0)
  })
})
await t('mutant: firstUndoneUnit blind to the set-aside -> the loop ends passed on the same unit (the scan is what moves on)', async () => {
  await withMutant(SV_PATH, '      const w = firstUndoneUnit(read, plan, { lights: lit, aside })', '      const w = firstUndoneUnit(read, plan, { lights: lit })', async M => {
    const P = S.planTank(SITE)
    const r = await visit(M, P, fakeBot(world({ [kOf(FLOAT)]: 'dirt' }), { start: START }), { swAside: true }, { aside: new Map() })
    assert.strictEqual(r.dug, 0)
  })
})

await t('mutant: a failed walk counted at once (no stand exhaustion) -> the third stand is never tried', async () => {
  await withMutant(SV_PATH, "            if (nw < ASIDE_WALKS) { e.log('refused', { at: op.at, why: 'walk_failed' }); continue }", '            void nw', async M => {
    const P = S.planTank(SITE)
    const e = fakeBot(world(threeStands()), { start: START })
    const tried = []
    e.walkTo = async c => { tried.push(kOf(c)); return tried.length >= 3 }
    await visit(M, P, e, { swAside: true, opsMax: 1 }, { aside: new Map() })
    assert.strictEqual(tried.length, 2)
  })
})
await t('mutant: no revalidation -> digs continue below the cell turned to sand', async () => {
  await withMutant(SV_PATH, "        if (why == null) continue\n        aside.delete(k)", "        continue", async M => {
    const P = S.planTank(SITE)
    const w = world({ [kOf(FLOAT)]: 'dirt' })
    const log = []
    const e = fakeBot(w, { start: START, log })
    const dig0 = e.dig
    let n = 0, after = -1
    e.dig = async c => { const r = await dig0(c); if (++n === 1) { w.set(FLOAT, 'sand'); after = log.length } return r }
    await visit(M, P, e, { swAside: true }, { aside: new Map([[kOf(FLOAT), 0]]) })
    assert.ok(log.slice(after).filter(q => q[0] === 'dig' && q[1][1] < FLOAT[1]).length > 0)
  })
})

console.log('THE HOLD ENDS WITH ITS RELEASE')
await t('stampStale: another version or none -> stale; this version with no cell -> holds; this version, every named cell done -> stale', () => {
  assert.strictEqual(S.stampStale({ stuckAt: 1 }, [], { code: 'v2' }), true, 'a stamp from before the rule')
  assert.strictEqual(S.stampStale({ stuckAt: 1, code: 'v1' }, [], { code: 'v2' }), true)
  assert.strictEqual(S.stampStale({ stuckAt: 1, code: 'v2' }, [], { code: 'v2' }), false)
  assert.strictEqual(S.stampStale({ stuckAt: 1, code: 'v2' }, ['1,2,3'], { code: 'v2', cellDone: () => true }), true)
  assert.strictEqual(S.stampStale({ stuckAt: 1, code: 'v2' }, ['1,2,3', '4,5,6'], { code: 'v2', cellDone: k => k === '1,2,3' }), false)
  assert.strictEqual(S.stampStale({ stuckAt: 1 }, [], { code: null }), false, 'no version known: as before')
})
await t('turnView codeOf: a step well back-off of another version holds nothing; this version\'s counts; other plots unchanged', () => {
  const now = 10_000_000
  const files = [{ holder: 'A', plots: { stepwell: { at: now - 1000, n: 4, noAt: now - 1000, stop: 'passed' }, wall: { at: now - 1000, n: 2, noAt: now - 1000 } } },
    { holder: 'B', plots: { stepwell: { at: now - 500, n: 1, noAt: now - 500, stop: 'passed', code: 'v2' } } }]
  const codeOf = p => (p === 'stepwell' ? 'v2' : null)
  const v = PT.turnView(files, { now, codeOf })
  assert.strictEqual(v.get('stepwell').n, 1)
  assert.strictEqual(v.get('wall').n, 2)
  assert.strictEqual(PT.turnView(files, { now }).get('stepwell').n, 5, 'control: without codeOf every entry counts')
})
await t('turnAfter code: a no-progress visit under a new version starts its own count at 1 (the old count never carries)', () => {
  const own = { at: 1, n: 4, noAt: 100, gen: 28, stop: 'passed' }
  const e1 = PT.turnAfter(own, { okAt: null }, 'no_progress', { now: 200, stop: 'passed', gen: 28, code: 'v2' })
  assert.strictEqual(e1.n, 1); assert.strictEqual(e1.code, 'v2')
  const e2 = PT.turnAfter(e1, { okAt: null }, 'no_progress', { now: 300, stop: 'passed', gen: 28, code: 'v2' })
  assert.strictEqual(e2.n, 2)
  assert.strictEqual(PT.turnAfter(own, { okAt: null }, 'no_progress', { now: 200, stop: 'passed', gen: 28 }).n, 5, 'control: no code, as before')
})
await t('mutant: turnView ignores codeOf -> the old version\'s back-off counts again', async () => {
  await withMutant(PT_PATH, "if (code != null && String(e.code ?? '') !== String(code)) continue", 'void code', async M => {
    const now = 10_000_000
    const files = [{ holder: 'A', plots: { stepwell: { at: now - 1000, n: 4, noAt: now - 1000 } } }]
    assert.strictEqual(M.turnView(files, { now, codeOf: () => 'v2' }).get('stepwell').n, 4)
  })
})
await t('mutant: stampStale ignores the version -> the old no-cell stamp holds', async () => {
  await withMutant(SW_PATH, "  if (code != null && String(stamp?.code ?? '') !== String(code)) return true", '  void code', async M => {
    assert.strictEqual(M.stampStale({ stuckAt: 1 }, [], { code: 'v2' }), false)
  })
})

console.log('THE WIRING (structural: comments stripped, executable lines)')
const SKS = strip(readFileSync(new URL('../src/skills.mjs', import.meta.url), 'utf8'))
const BP = strip(readFileSync(new URL('../src/buildproj.mjs', import.meta.url), 'utf8'))
const WIRES = [
  ['skills: the tank visit gets the bot\'s set-aside memory', SKS, /plan, exit: rec\.exit, share, aside: \(bot\.stepwellAside \?\?= new Map\(\)\),/],
  ['skills: the step well\'s stamp is stale by the version rule', SKS, /if \(swStampStale\(stamp, keys, \{ code: config\.code\?\.version \?\? null, cellDone: k => swCellDone\(rd, pl, k\.split\(','\)\.map\(Number\)\) \}\)\) return true/],
  ['skills: the stamp carries the passed cells and the version', SKS, /projStuckWrite\(dir, key, me, cells, \{ stuckAt: at, \.\.\.\(swAsideOn\(\) \? \{ code: config\.code\?\.version \?\? null \} : \{\}\) \}\)/],
  ['skills: the turn view counts the step well by version', SKS, /codeOf: plot => \(plot === STEPWELL_PLOT && swAsideOn\(\) \? config\.code\?\.version \?\? null : null\)/],
  ['skills: the turn entry is stamped for the step well', SKS, /code: plot === STEPWELL_PLOT && swAsideOn\(\) \? config\.code\?\.version \?\? null : null \}\)/],
  ['buildproj: the stale rule is handed the stamp', BP, /s = !!stale\(Object\.keys\(stuckCells\(j\)\), j\)/],
]
for (const [name, src, re] of WIRES) {
  await t(`${name} (and a one-character mutant of it is not matched)`, () => {
    assert.ok(re.test(src), 'wired')
    const m = src.match(re)[0]
    assert.strictEqual(src.split(m).length, 2, 'ANCHOR MISSING OR NOT UNIQUE')
    assert.ok(!re.test(src.replace(m, m.replace(/[A-Za-z]/, '#'))), 'a one-character mutant of the executable line is not matched')
  })
}
await t('the comment stripper is not fooled: a wiring line only in a comment does not match (control)', () => {
  assert.ok(!WIRES[5][2].test(strip('// s = !!stale(Object.keys(stuckCells(j)), j)\n')))
})

console.log(`\nstepwell-aside: ${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
