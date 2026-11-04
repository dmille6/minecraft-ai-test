// ACCESS-01: a proper staircase where bots built a dirt climb against a build (owner 11-04 "if a bot needs to place a dirt block to get
// somewhere that means there isnt access"; groundskeeper piece 3). Behaviour on buildfake's flat world (stone below G, grass at G).
import assert from 'node:assert'
import fs, { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
const { G, HOME, server, bot, PJ, R } = await import('./helpers/buildfake.mjs')
const T = await import('../src/tidy.mjs')
const LP = await import('../src/landplan.mjs')

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 5).join('\n        ')}`) }
}
const TIDY_PATH = new URL('../src/tidy.mjs', import.meta.url)
async function withMutant (p, old, neu, fn) {
  const src = readFileSync(p, 'utf8')
  assert.ok(src.includes(old), `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 60))}`)
  assert.ok(src.split(old).length === 2, 'ANCHOR NOT UNIQUE')
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, src.replace(old, neu).replace(/from '\.\//g, "from '../src/"))
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}
const PAL = T.TIDY_PALETTE
// a wall along z = 0, x -3..3, four high; a dirt climb against it at (0, z 1), `h` high
const scene = (h = 2) => {
  const srv = server()
  const cells = new Set()
  for (let x = -3; x <= 3; x++) for (let y = G + 1; y <= G + 4; y++) { srv.set([x, y, 0], 'stone_bricks'); cells.add(`${x},${y},0`) }
  for (let y = G + 1; y <= G + h; y++) srv.set([0, y, 1], 'dirt')
  const avoid = (x, z) => (z >= -1 && z <= 1 && x >= -4 && x <= 4 ? 'project:wall' : null)
  return { srv, cells, avoid }
}
const survey = (s, extra = {}) => T.surveyInwall(s.srv.read, { home: HOME, box: [-8, -8, 8, 8], avoid: s.avoid, cells: s.cells, ...extra })

await t('a 2-high dirt climb against the wall becomes a 2-step stone staircase running away from it; the climb is not cut', async () => {
  const s = scene(2)
  const sv = survey(s)
  assert.strictEqual(sv.access.length, 1)
  assert.deepStrictEqual(sv.access[0].dir, [0, 1], 'away from the wall (the wall is at -z)')
  assert.deepStrictEqual(sv.access[0].cells.map(c => c.join(',')).sort(), [`0,${G + 1},1`, `0,${G + 2},1`, `0,${G + 1},2`].sort())
  assert.ok(!sv.cut.some(c => c.at[0] === 0 && c.at[2] === 1), 'the climb\'s dirt stays (its cells are the stair\'s: dug out and laid in stone)')
  // each step one up: the landing (0, 3) is ground G, the steps G+1 then G+2
})
await t('no room for the stair (a house behind the landing, no head room, a door) -> the climb is cut as inwall does', async () => {
  const a = scene(2); a.srv.set([0, G + 1, 3], 'oak_planks'); a.srv.set([0, G + 2, 3], 'oak_planks'); a.cells.add(`0,${G + 1},3`); a.cells.add(`0,${G + 2},3`)
  const sa = survey(a)
  assert.strictEqual(sa.access.length, 0); assert.ok(sa.cut.some(c => c.at[0] === 0 && c.at[2] === 1), 'cut instead')
  const b = scene(2); b.srv.set([0, G + 3, 2], 'stone')                 // no head room over the lower step
  assert.strictEqual(survey(b).access.length, 0)
  const c = scene(2)
  assert.strictEqual(survey(c, { noStair: T.accessNoStair([{ door: [1, G + 1, 0] }]) }).access.length, 0, 'beside a door: never a stair')
  assert.strictEqual(survey(c, { T: { ...T.INWALL, access: false } }).access.length, 0, 'the switch')
})
await t('a 3-high climb: three steps, each column filled from its ground; the landing one below the last step', async () => {
  const s = scene(3)
  const a = survey(s).access[0]
  assert.ok(a, 'a stair')
  const ks = a.cells.map(c => c.join(',')).sort()
  assert.deepStrictEqual(ks, [`0,${G + 1},1`, `0,${G + 2},1`, `0,${G + 3},1`, `0,${G + 1},2`, `0,${G + 2},2`, `0,${G + 1},3`].sort())
})
await t('siteStage inwall: the stair cells are role `access` in layered segments; dirt there reads open, stone done', async () => {
  const s = scene(2)
  const st = LP.landStages().find(q => q.id === 'inwall')
  const r = T.siteStage(s.srv.read, { home: HOME, land: { seed: 1 }, stage: st, avoid: s.avoid, cells: s.cells, terrace: { wall: { ring: [-9, -9, 9, 9] }, records: [] } })
  const acc = r.record.cells.filter(c => c.role === 'access')
  assert.strictEqual(acc.length, 3)
  assert.strictEqual(r.record.inwall.access.length, 1)
  const segOf = k => acc.find(c => c.at.join(',') === k).seg
  assert.notStrictEqual(segOf(`0,${G + 2},1`), segOf(`0,${G + 1},1`), 'the top step waits on the one under it')
  assert.strictEqual(R.cellDone({ name: 'dirt', boundingBox: 'block' }, PAL, 'access'), false, 'never a dirt step')
  assert.strictEqual(R.cellDone({ name: 'cobblestone', boundingBox: 'block' }, PAL, 'access'), true)
})
await t('BUILT by runVisit on the fake server: the climb\'s dirt dug out and the whole stair laid in cobblestone', async () => {
  const s = scene(2)
  const st = LP.landStages().find(q => q.id === 'inwall')
  const r = T.siteStage(s.srv.read, { home: HOME, land: { seed: 1 }, stage: st, avoid: s.avoid, cells: s.cells, terrace: { wall: { ring: [-9, -9, 9, 9] }, records: [] } })
  const record = { ...r.record, cells: r.record.cells.filter(c => c.role === 'access'), segments: r.record.segments.filter(sg => r.record.cells.some(c => c.role === 'access' && c.seg === sg.seg)), cut: [], clear: [] }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'access-'))
  const key = PJ.projKey(HOME, 'tidy')
  const pub = PJ.publishRecord(dir, key, () => ({ ...record }))
  const slot = PJ.takeSlot(dir, key, 'K', 3)
  const e = bot(s.srv, 'K', { inv: { cobblestone: 32 }, feet: [3, G + 1, 4] })
  const out = await R.runVisit({ dir, key, me: 'K', home: HOME, stood: [], record, recordGen: pub.gen, palette: PAL, slot: slot.slot, slotGen: slot.gen, domain: () => true, walkR: 64, skipOpenDeps: true }, e, { maxSteps: 200 })
  for (const k of [[0, G + 1, 1], [0, G + 2, 1], [0, G + 1, 2]]) assert.strictEqual(s.srv.read(...k).name, 'cobblestone', `${k} (${out.stop}: ${out.why})`)
  assert.ok(e.logs.some(([k, d]) => k === '_build' && d.op === 'clear' && d.kind === 'foreign' && d.block === 'dirt'), 'the dirt was dug as a foreign block in a record cell (the read\'s rule: a cell of the chain)')
})
await t('Codex r1 BLOCKERS: the stone bill ignores spare dirt; a plank or netherrack climb is cut, never a stair; never into a footprint, a stand or a road', async () => {
  assert.strictEqual(T.fillWant({ open: 0, openAccess: 3, dirt: 3, cobble: 0 }), 3, 'three steps, three spare dirt: still 3 cobblestone')
  assert.strictEqual(T.fillWant({ open: 2, openAccess: 3, dirt: 2, cobble: 1 }), 2, 'the earth takes the dirt; one spare cobble covers one step')
  assert.strictEqual(T.fillWant({ open: 4, openAccess: 0, dirt: 1, cobble: 1 }), 2, 'the earth bill as before')
  for (const n of ['oak_planks', 'netherrack']) {
    const s = scene(2); s.srv.set([0, G + 1, 1], n); s.srv.set([0, G + 2, 1], n)
    const sv = survey(s)
    assert.strictEqual(sv.access.length, 0, n); assert.ok(sv.cut.some(c => c.at[0] === 0 && c.at[2] === 1), `${n}: cut instead`)
  }
  const fp = scene(2)
  const house = { plot: 'house1', cells: [{ at: [-1, G + 1, 2] }, { at: [1, G + 1, 2] }] }    // a footprint over the stair's lower step
  assert.strictEqual(survey(fp, { noStair: T.accessNoStair([house]) }).access.length, 0, 'never into a build\'s footprint')
  assert.strictEqual(survey(scene(2), { noStair: T.accessNoStair([{ plot: 'house1', cells: [{ at: [-1, G + 1, 3] }, { at: [1, G + 1, 4] }] }]) }).access.length, 0, 'never a landing inside one')
  assert.strictEqual(survey(scene(2), { noStair: T.accessNoStair([{ plot: 'wall', cells: [{ at: [-30, G, -30] }, { at: [30, G, 30] }] }]) }).access.length, 1, 'the ring wall\'s box is no footprint')
  const plan = { plots: [{ cells: [{ at: [5, G + 1, 9], stand: [0, G + 1, 2] }] }] }
  assert.strictEqual(survey(scene(2), { noStair: T.accessNoStair([], { plan }) }).access.length, 0, 'never on a chest\'s stand')
  const land = { corridors: [{ box: [-1, -64, 2, 1, 320, 2] }] }
  assert.strictEqual(survey(scene(2), { noStair: T.accessNoStair([], { land }) }).access.length, 0, 'never on a road corridor')
})
console.log('ACCESS-02: THE BOTS\' OWN CLIMBS (placeaudit -> the climbs ledger -> inwall staircases)')
const PA = await import('../src/placeaudit.mjs')
const climbSpots = (...a) => T.climbSpots(...a)
await t('climbOf: placed, in town, pathfinder or reflex, a pillar or a step, at the surface band; never a mine below town, a failed one, a skill\'s', async () => {
  const ok = { outcome: 'placed', zone: 'town', reason: 'pathfinder', shape: 'pillar', y: 70 }
  assert.strictEqual(PA.climbOf(ok, HOME), true)
  assert.strictEqual(PA.climbOf({ ...ok, y: HOME.y - 5 }, HOME), false, 'in a mine under town (the LIVE rows: most at y 58-65)')
  for (const bad of [{ outcome: 'failed' }, { zone: 'margin' }, { reason: 'skill' }, { shape: 'bridge' }]) assert.strictEqual(PA.climbOf({ ...ok, ...bad }, HOME), false, JSON.stringify(bad))
})
await t('the ledger: appended per bot, read across bots by time, trimmed to its newest lines past the bound', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'climbs-'))
  PJ.climbAppend(dir, 'showcase-Echo', { x: 1, y: 70, z: 2, shape: 'pillar', reason: 'pathfinder', t: 100 })
  PJ.climbAppend(dir, 'showcase-Haven', { x: 3, y: 70, z: 4, shape: 'step', reason: 'reflex', t: 200 })
  assert.strictEqual(PJ.climbRead(dir).length, 2); assert.strictEqual(PJ.climbRead(dir, { since: 150 }).length, 1)
  for (let i = 0; i < 30; i++) PJ.climbAppend(dir, 'showcase-Kite', { x: i, y: 70, z: 0, shape: 'pillar', reason: 'pathfinder', t: 300 + i }, { maxLines: 10, keepLines: 5 })
  const k = PJ.climbRead(dir).filter(c => c.by === 'showcase-Kite')
  assert.ok(k.length <= 10 && k.length >= 5 && k.at(-1).t === 329, `trimmed (${k.length})`)
})
await t('climbSpots: two or more climbs within one column make a spot, busiest first, spots apart; old ones age out', async () => {
  const cl = [...Array(17)].map((_, i) => ({ x: 16, y: 70, z: 22, t: 1000 + i })).concat([{ x: 1, y: 70, z: 7, t: 1000 }, { x: 2, y: 70, z: 8, t: 1000 }, { x: -30, y: 70, z: 0, t: 1000 }])
  const sp = climbSpots(cl, { now: 2000 })
  assert.deepStrictEqual(sp[0].col, [16, 22]); assert.strictEqual(sp[0].n, 17)
  assert.ok(sp.some(q => Math.abs(q.col[0] - 1.5) <= 1.5 && Math.abs(q.col[1] - 7.5) <= 1.5), 'the pair')
  assert.ok(!sp.some(q => q.col[0] === -30), 'a lone climb is no spot')
  assert.strictEqual(climbSpots(cl, { now: 2000 + 49 * 3600_000 }).length, 0, 'aged out')
})
// a raised terrace: x >= 6 three higher (ground G+3), the low ground G west of it; the bots pillared up at x 5
const ledge = () => { const srv = server(); for (let x = 6; x <= 12; x++) for (let z = -6; z <= 6; z++) for (let y = G + 1; y <= G + 3; y++) srv.set([x, y, z], 'stone'); return srv }
await t('spotStair: a stair of the town\'s stone up a 3-high ledge where the bots climbed -- its top step one below the ledge, run away from it', async () => {
  const srv = ledge()
  const yHi = HOME.y + 14, yLo = HOME.y - 14, memo = new Map()
  const col = (x, z) => { const k = `${x},${z}`; if (!memo.has(k)) memo.set(k, T.tidyColumn(srv.read, x, z, { yHi, yLo })); return memo.get(k) }
  const st = T.spotStair(srv.read, [5, 0], { col })
  assert.ok(st, 'a stair')
  assert.deepStrictEqual(st.dir, [-1, 0], 'away from the ledge')
  const top = st.cells.filter(c => c[0] === 5).map(c => c[1]).sort()
  assert.deepStrictEqual(top, [G + 1, G + 2], 'the top step at G+2: the step onto the ledge (G+3) is one block')
  assert.ok(st.cells.some(c => c[0] === 4 && c[1] === G + 1), 'the lower step')
  const flat = server(); const memo2 = new Map()
  assert.strictEqual(T.spotStair(flat.read, [5, 0], { col: (x, z) => { const k = `${x},${z}`; if (!memo2.has(k)) memo2.set(k, T.tidyColumn(flat.read, x, z, { yHi, yLo })); return memo2.get(k) } }), null, 'no edge: no stair')
})
await t('siteStage inwall with the ledger: a busy spot at the ledge gets its staircase (role access, ledger-marked); no climbs -> none', async () => {
  const srv = ledge()
  const st = LP.landStages().find(q => q.id === 'inwall')
  const climbs = [...Array(5)].map((_, i) => ({ x: 5, y: G + 1, z: 0, t: Date.now() - i }))
  const r = T.siteStage(srv.read, { home: HOME, land: { seed: 1 }, stage: st, terrace: { wall: { ring: [-15, -15, 15, 15] }, records: [], climbs } })
  assert.ok(r.record, r.why)
  assert.ok(r.record.cells.filter(c => c.role === 'access').length >= 3)
  assert.ok(r.record.inwall.access.some(a => a.ledger), JSON.stringify(r.record.inwall.access))
  const r0 = T.siteStage(srv.read, { home: HOME, land: { seed: 1 }, stage: st, terrace: { wall: { ring: [-15, -15, 15, 15] }, records: [] } })
  assert.ok(!(r0.record?.cells ?? []).some(c => c.role === 'access'), 'control: without the ledger no stair')
})
await t('mutant: the ledger taking a mine\'s pillars (no surface band) is caught; the wiring feeds the ledger and reads it', async () => {
  await withMutant(new URL('../src/placeaudit.mjs', import.meta.url), "Number.isFinite(args.y) && !!home && args.y >= Math.floor(home.y) - T.band", "Number.isFinite(args.y)", async M => {
    assert.strictEqual(M.climbOf({ outcome: 'placed', zone: 'town', reason: 'pathfinder', shape: 'pillar', y: HOME.y - 10 }, HOME), true)
  })
  const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1')
  const f = strip(readFileSync(new URL('../src/features.mjs', import.meta.url), 'utf8'))
  assert.ok(/if \(climbOf\(args, configuredHome\(config\.world\)\)\) climbAppend\(poolStateDir\(config\.memory\.pool\)/.test(f), 'the feed')
  const sk = strip(readFileSync(new URL('../src/skills.mjs', import.meta.url), 'utf8'))
  assert.ok(/climbs = climbRead\(dir, \{ since: Date\.now\(\) - 48 \* 60 \* 60_000 \}\)/.test(sk) && /caps: I\.caps, climbs, have,/.test(sk), 'the read')
})

await t('mutant: the stair planner never reached (the climb always cut) is caught', async () => {
  await withMutant(TIDY_PATH, '      if (stair) {\n', '      if (false) {\n', async M => {
    const s = scene(2)
    assert.strictEqual(M.surveyInwall(s.srv.read, { home: HOME, box: [-8, -8, 8, 8], avoid: s.avoid, cells: s.cells }).access.length, 0)
  })
  await withMutant(TIDY_PATH, "    if (!ground(lc) || cellCols.has(k2(lx, lz)) || !free(lx, lz) || last - lc.y > 1 || lc.y > last) continue\n", '', async M => {
    const s = scene(2); for (let y = G - 2; y <= G; y++) s.srv.set([0, y, 3], 'air')      // the landing is a 3-deep hole
    assert.strictEqual(M.surveyInwall(s.srv.read, { home: HOME, box: [-8, -8, 8, 8], avoid: s.avoid, cells: s.cells }).access.length, 1, 'the mutant builds a stair onto a drop')
    assert.strictEqual(T.surveyInwall(s.srv.read, { home: HOME, box: [-8, -8, 8, 8], avoid: s.avoid, cells: s.cells }).access.length, 0, 'the real one refuses it')
  })
})

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
