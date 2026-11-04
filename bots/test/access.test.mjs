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
await t('mutant: the stair planner never reached (the climb always cut) is caught', async () => {
  await withMutant(TIDY_PATH, '      if (stair) {\n', '      if (false) {\n', async M => {
    const s = scene(2)
    assert.strictEqual(M.surveyInwall(s.srv.read, { home: HOME, box: [-8, -8, 8, 8], avoid: s.avoid, cells: s.cells }).access.length, 0)
  })
  await withMutant(TIDY_PATH, "    if (!ground(lc) || cellCols.has(k2(lx, lz)) || last - lc.y > 1 || lc.y > last) continue\n", '', async M => {
    const s = scene(2); for (let y = G - 2; y <= G; y++) s.srv.set([0, y, 3], 'air')      // the landing is a 3-deep hole
    assert.strictEqual(M.surveyInwall(s.srv.read, { home: HOME, box: [-8, -8, 8, 8], avoid: s.avoid, cells: s.cells }).access.length, 1, 'the mutant builds a stair onto a drop')
    assert.strictEqual(T.surveyInwall(s.srv.read, { home: HOME, box: [-8, -8, 8, 8], avoid: s.avoid, cells: s.cells }).access.length, 0, 'the real one refuses it')
  })
})

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
