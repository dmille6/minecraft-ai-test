// STEPWELL-05 (LIVE showcase 11-06: the stepwell at builders_max 1 -- felling 23 of 50 logs, then 3,653 cut cells and 2,168 build
// cells, every one serial). THE TANK'S CREW: STEPWELL_CREW builders (default 2) once every listed log is down; the felling stays one
// builder. A layer is shared by sector (crewSector); a builder whose sector is done takes the rest only when no other builder holds
// a slot (else `shared`); never the next layer before this one stands. Behaviour on the fake world of stepwell.test.mjs: two visits
// run CONCURRENTLY (interleaved at every await) to completion, no cell worked by both, every dig in the first undone layer, the rim's
// posts before any deeper cut. Mutants anchored (present and unique).
import assert from 'node:assert'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
const S = await import('../src/stepwell.mjs')
const V = await import('../src/stepwellvisit.mjs')
let pass = 0, fail = 0
const t = async (name, fn) => { try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 6).join('\n        ')}`) } }
const SV_PATH = new URL('../src/stepwellvisit.mjs', import.meta.url), SW_PATH = new URL('../src/stepwell.mjs', import.meta.url)
async function withMutant (p, old, neu, fn, more = null, fn2 = null) {
  let src = readFileSync(p, 'utf8')
  for (const [a, b] of [[old, neu], ...(more ? [more] : [])]) {
    assert.ok(src.includes(a), `MUTATION DID NOT APPLY: ${JSON.stringify(a.slice(0, 70))}`)
    assert.ok(src.split(a).length === 2, 'ANCHOR MISSING OR NOT UNIQUE')
    src = src.replace(a, b)
  }
  if (fn2) fn = fn2
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, src.replace(/from '\.\//g, "from '../src/"))
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}
const strip = src => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/[ \t]\/\/ .*$/gm, '')

// ---- the fake world (stepwell.test.mjs's) ------------------------------------------------------------------------------------
const G = 64
const EMPTY = /^(air|cave_air|torch|short_grass)$/
const mk = n => (n == null ? null : { name: n, boundingBox: EMPTY.test(n) || /_sapling$/.test(n) ? 'empty' : (/water|lava/.test(n) ? 'empty' : 'block') })
function world () {
  const m = new Map()
  const base = (x, y, z) => (y > G ? 'air' : y === G ? 'grass_block' : y >= G - 3 ? 'dirt' : y >= G - 40 ? 'stone' : 'bedrock')
  const get = (x, y, z) => { const k = `${x},${y},${z}`; return m.has(k) ? m.get(k) : base(x, y, z) }
  return { read: (x, y, z) => mk(get(x, y, z)), set: (c, n) => m.set(c.join(','), n), get: c => get(...c), m }
}
const SITE = { origin: { x: 0, z: 0 }, away: 's', g: G, W: 21, T: 1 }
const placedOf = role => ({ floor: 'stone_bricks', trim: 'stone_bricks', wall: 'cobblestone', body: 'cobblestone', under: 'cobblestone', post: 'cobblestone_wall', light: 'torch', dlight: 'torch', tread: 'cobblestone', seal: 'cobblestone' }[role])
const inUnit = (u, c) => ['cut', 'faces', 'tops', 'under', 'posts', 'lights'].some(k => u[k].some(q => q[0] === c[0] && q[1] === c[1] && q[2] === c[2]))
function fakeBot (w, plan, M, { start, name, log, bodies }) {
  let feet = [...start]
  let t = 0
  const tick = async () => { t += 1; await new Promise(r => setImmediate(r)) }   // a real yield: the other visit runs between steps
  return {
    get read () { return w.read },
    feet: () => feet,
    walkTo: async c => {
      const fl = w.read(c[0], c[1] - 1, c[2]), f = w.read(...c), h = w.read(c[0], c[1] + 1, c[2])
      if (!(fl?.boundingBox === 'block' && f?.boundingBox === 'empty' && h?.boundingBox === 'empty')) return false
      if ([...bodies.entries()].some(([n, b]) => n !== name && b.join(',') === c.join(','))) return false
      feet = [...c]; bodies.set(name, feet); await tick(); return true
    },
    dig: async c => {
      const fu = M.firstUndoneUnit(w.read, plan)
      if (!fu || !inUnit(fu.unit, c)) log.push(['out_of_layer', name, c, fu?.unit?.y])
      await tick()   // the dig takes time (the server's break): the other builder decides meanwhile, on the world as it stands
      w.set(c, 'air'); log.push(['dig', name, c]); return 'confirmed'
    },
    place: async (c, role) => { await tick(); w.set(c, placedOf(role)); log.push(['place', name, c, role]); return 'confirmed' },
    occupied: c => [...bodies.entries()].some(([n, b]) => n !== name && (b.join(',') === c.join(',') || [b[0], b[1] - 1, b[2]].join(',') === c.join(','))),
    toolOk: () => true, fence: () => true, log: () => {}, now: () => t, aborted: () => false,
  }
}
/** Two builders (slots 1, 2) visiting concurrently, visit after visit, until the tank stands. -> { log, w, P, stops, rounds } */
async function crew (M = V, SM = S, { n = 2, maxRounds = 40 } = {}) {
  const P = SM.planTank(SITE)
  const w = world(), log = [], bodies = new Map()
  const centre = [(P.box[0] + P.box[2]) / 2, (P.box[1] + P.box[3]) / 2]
  const live = new Set()
  const bots = Array.from({ length: n }, (_, i) => ({ slot: i + 1, name: `B${i + 1}`, e: fakeBot(w, P, SM, { start: [10 + 2 * i, G + 1, -2], name: `B${i + 1}`, log, bodies }) }))
  const stops = []
  let rounds = 0
  for (; rounds < maxRounds && SM.firstUndoneUnit(w.read, P) !== null; rounds++) {
    await Promise.all(bots.map(async b => {
      live.add(b.slot)
      const share = { mine: c => SM.crewSector(centre, c, n) === b.slot - 1, othersBusy: () => [...live].some(j => j !== b.slot), lead: () => ![...live].some(j => j < b.slot) }
      try {
        const r = await M.runStepwellVisit({ plan: P, exit: P.exit, share, onStop: async () => { throw new Error('stopped') } }, b.e, { opsMax: 120 })
        stops.push(`${b.name}:${r.stop}`)
      } finally { live.delete(b.slot) }
    }))
  }
  return { log, w, P, stops, rounds }
}

console.log('THE SETTING AND THE RECORD (pure)')
await t('STEPWELL_CREW: unset 2, 1..3 as written, above 3 clamps, off/1 one builder, junk 2', () => {
  assert.strictEqual(S.stepwellCrew({}), 2)
  assert.strictEqual(S.stepwellCrew({ STEPWELL_CREW: '3' }), 3)
  assert.strictEqual(S.stepwellCrew({ STEPWELL_CREW: '9' }), S.STEPWELL_CREW_MAX)
  assert.strictEqual(S.stepwellCrew({ STEPWELL_CREW: 'off' }), 1)
  assert.strictEqual(S.stepwellCrew({ STEPWELL_CREW: '1' }), 1)
  assert.strictEqual(S.stepwellCrew({ STEPWELL_CREW: 'x' }), 2)
})
await t('the crew is raised only once every log is down, never on a stopped tank, once; the admission reads the record, capped by the setting', () => {
  const rec = { state: 'open', builders_max: 1 }
  assert.strictEqual(S.stepwellCrewDue(rec, 27, 2), null, 'the live record: 27 logs left -> the felling stays one builder')
  assert.strictEqual(S.stepwellCrewDue(rec, null, 2), null, 'unread felling: no raise')
  assert.strictEqual(S.stepwellCrewDue(rec, 0, 2), 2)
  assert.strictEqual(S.stepwellCrewDue({ ...rec, builders_max: 2 }, 0, 2), null, 'already')
  assert.strictEqual(S.stepwellCrewDue({ ...rec, state: 'stopped' }, 0, 2), null)
  assert.strictEqual(S.stepwellCrewDue(rec, 0, 1), null, 'STEPWELL_CREW=1: never')
  assert.strictEqual(S.stepwellBuildersNow(rec, 2), 1, 'before the raise: one builder (the felling)')
  assert.strictEqual(S.stepwellBuildersNow({ builders_max: 2 }, 2), 2)
  assert.strictEqual(S.stepwellBuildersNow({ builders_max: 3 }, 2), 2, 'never above the setting')
  assert.strictEqual(S.stepwellBuildersNow({ builders_max: 2 }, 1), 1, 'the rollback: one builder whatever the record says')
})
await t('crewSector splits the tank\'s cells into n non-empty, balanced sectors (every cell exactly one)', () => {
  const P = S.planTank(SITE)
  const centre = [(P.box[0] + P.box[2]) / 2, (P.box[1] + P.box[3]) / 2]
  for (const n of [2, 3]) {
    const cnt = Array(n).fill(0)
    for (const u of P.units) for (const k of ['cut', 'faces', 'tops', 'under', 'posts', 'lights']) for (const c of u[k]) cnt[S.crewSector(centre, c, n)]++
    assert.ok(cnt.every(x => x > 0), JSON.stringify(cnt))
    assert.ok(Math.max(...cnt) / Math.min(...cnt) < 1.5, `unbalanced ${cnt}`)
  }
  assert.strictEqual(S.crewSector(centre, [0, G, 0], 1), 0)
})

console.log('TWO BUILDERS, CONCURRENT (the real visit loop on the fake world)')
await t('the tank completes; no cell is dug or placed by both; every dig is in the first undone layer; the rim posts stand before any deeper cut', async () => {
  const { log, w, P, stops } = await crew()
  assert.strictEqual(S.firstUndoneUnit(w.read, P), null, stops.join(' '))
  assert.deepStrictEqual(log.filter(x => x[0] === 'out_of_layer'), [], 'a dig outside the first undone layer')
  const by = new Map()
  for (const [op, nm, c] of log) if (op === 'dig' || op === 'place') { const k = `${op}:${c.join(',')}`; (by.get(k) ?? by.set(k, new Set()).get(k)).add(nm) }
  const both = [...by.entries()].filter(([, s]) => s.size > 1).map(([k]) => k)
  assert.deepStrictEqual(both, [], `worked by both: ${both.slice(0, 5)}`)
  const ops = n => log.filter(x => (x[0] === 'dig' || x[0] === 'place') && x[1] === n).length
  assert.ok(ops('B1') > 0.3 * (ops('B1') + ops('B2')) && ops('B2') > 0.3 * (ops('B1') + ops('B2')), `the work was not shared: B1 ${ops('B1')} B2 ${ops('B2')}`)
  assert.ok(stops.some(s => /:shared$/.test(s)), `a builder whose sector was done waited (shared): ${stops.join(' ')}`)
  const rimPosts = new Set(P.cells.filter(q => q.role === 'post' && q.t === 0).map(q => q.at.join(',')))
  const firstDeep = log.findIndex(x => x[0] === 'dig' && x[2][1] <= G - 1)
  const lastRimPost = Math.max(...log.map((x, i) => (x[0] === 'place' && rimPosts.has(x[2].join(',')) ? i : -1)))
  assert.ok(firstDeep > lastRimPost, `a cut at ${log[firstDeep]?.[2]} went before the last rim post`)
})
await t('ONE builder with a share (the other slot empty): it takes the whole layer and completes as before (never `shared`)', async () => {
  const { w, P, stops } = await crew(V, S, { n: 1 })
  assert.strictEqual(S.firstUndoneUnit(w.read, P), null, stops.join(' '))
  assert.ok(!stops.some(s => /shared/.test(s)), stops.join(' '))
})
await t('MUTANT KILLED: the sector view cut (both builders work the whole layer) -- cells worked by both', async () => {
  await withMutant(SV_PATH, "      const unit = sharing && !w.unit.station ? shareView(w.unit, p.share.mine) : w.unit", '      const unit = w.unit', async M => {
    const { log } = await crew(M, S, { maxRounds: 6 })
    const by = new Map()
    for (const [op, nm, c] of log) if (op === 'dig' || op === 'place') { const k = `${op}:${c.join(',')}`; (by.get(k) ?? by.set(k, new Set()).get(k)).add(nm) }
    assert.ok([...by.values()].some(s => s.size > 1), 'the mutant shared no cell: the overlap test proves nothing')
  })
})
await t('MUTANT KILLED: a done sector moving on while the other builder still works (no `shared` wait) -- digs outside the first undone layer, or the same cell twice', async () => {
  // both anchors (the re-check would flip a builder that moved on straight back: with only the first cut the visit spins)
  await withMutant(SV_PATH, "          if (p.share.othersBusy()) return end('shared',", "          if (false) return end('shared',", async M0 => M0, ['      if (shareOff && p.share?.othersBusy()) shareOff = false', ''], async M => {
    const { log } = await crew(M, S, { maxRounds: 6 })
    const by = new Map()
    for (const [op, nm, c] of log) if (op === 'dig' || op === 'place') { const k = `${op}:${c.join(',')}`; (by.get(k) ?? by.set(k, new Set()).get(k)).add(nm) }
    assert.ok([...by.values()].some(s => s.size > 1) || log.some(x => x[0] === 'out_of_layer'), 'the mutant kept the crew apart: the wait test proves nothing')
  })
})
await t('MUTANT KILLED: a builder that took the whole layer keeps it after the other builder returns -- cells worked by both', async () => {
  await withMutant(SV_PATH, '      if (shareOff && p.share?.othersBusy()) shareOff = false', '', async M => {
    const { log } = await crew(M)
    const by = new Map()
    for (const [op, nm, c] of log) if (op === 'dig' || op === 'place') { const k = `${op}:${c.join(',')}`; (by.get(k) ?? by.set(k, new Set()).get(k)).add(nm) }
    assert.ok([...by.values()].some(s => s.size > 1), 'the mutant shared no cell: the re-check test proves nothing')
  })
})
await t('MUTANT KILLED: the crew raised during the felling', async () => {
  await withMutant(SW_PATH, "  if (!rec || rec.state === 'stopped' || pending !== 0 || !(crew > 1)) return null", "  if (!rec || rec.state === 'stopped' || !(crew > 1)) return null", async M => {
    assert.notStrictEqual(M.stepwellCrewDue({ state: 'open', builders_max: 1 }, 27, 2), null, 'the mutant still held the felling to one builder')
  })
})

console.log('WIRING (source, comments stripped)')
const SKS = strip(readFileSync(new URL('../src/skills.mjs', import.meta.url), 'utf8'))
const WIRES = [
  'const crewTo = stepwellCrewDue(rec, pending, crew)',
  'const nBuilders = stepwellBuildersNow(rec, crew)',
  'const slot = takeSlot(dir, key, me, nBuilders)',
  "if (slot.slot > 1 && (pending == null || pending > 0)) { releaseLease(dir, key, `slot${slot.slot}`, me, slotRef.gen); return out('no_effect', 'felling_one'",
  'plan, exit: rec.exit, share,',
  'for (let k = 1; k <= buildersFor(p); k++) {',
  'for (let k = 1; k <= buildersFor(shopActive()); k++) {',
  'if (p?.plot !== STEPWELL_PLOT) return buildersOf(p)',
]
const wired = src => { for (const w of WIRES) assert.strictEqual(src.split(w).length, 2, `wiring ${JSON.stringify(w.slice(0, 60))}: ${src.split(w).length - 1}`) }
await t('buildStepwellRun raises the crew, takes the slot from the record, never a second faller, passes the share; admission reads buildersFor', () => {
  wired(SKS)
  assert.throws(() => wired(SKS.replace('plan, exit: rec.exit, share,', 'plan, exit: rec.exit,')), assert.AssertionError, 'a cut share must fail the wiring check')
})

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
