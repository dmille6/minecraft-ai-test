// REROOF-04 (bots/src/reroof.mjs reroofProve / reroofFloors / reroofEaveNotch / reroofDoorSide / reroofAccess / reroofDismantle*,
// buildsite.mjs walkFrom `floors` + proveSite `gone` / `interiorNow`, buildrun.mjs runVisit `p.floors`; skills.mjs buildReroof,
// reroofVisitOpts, reroofTempState). LIVE showcase 11-08: the hall's slab retrofit failed `no_step roof-edge 5 left, first
// roofslab@-18,70,23` on every try (the enchanting workshop's `no_step roof-inner 27 left`): no ground eye reaches the inner courses and
// a placed slab was no floor. The fixture is the LIVE region round the hall (bots/test/fixtures/reroof4-hall-1108.json); Paper sandbox4
// (sandbox/townstyle/reroof4-e2e.mjs) built the hall's 200 new cells there, every one server-verified, the bot standing on 64 of its slabs.
import assert from 'node:assert'
import fs from 'node:fs'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { createRequire } from 'node:module'
const B = await import('../src/buildsite.mjs')
const RR = await import('../src/reroof.mjs')
const { rot } = await import('../src/townplan.mjs')
const RR_PATH = new URL('../src/reroof.mjs', import.meta.url)
const BS_PATH = new URL('../src/buildsite.mjs', import.meta.url)
const md = createRequire(import.meta.url)('minecraft-data')('1.21.8')

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 5).join('\n        ')}`) }
}
async function withMutant (file, old, neu, fn) {
  const src = readFileSync(file, 'utf8')
  assert.ok(src.includes(old), `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 70))}`)
  assert.ok(src.split(old).length === 2, 'ANCHOR MISSING OR NOT UNIQUE')
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, src.replace(old, neu).replace(/from '\.\//g, "from '../src/"))
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}
// the buildsite mutant is read by a COPY of reroof.mjs that imports it (reroof.mjs -> ./buildsite.mjs)
async function withBuildsiteMutant (old, neu, fn) {
  const src = readFileSync(BS_PATH, 'utf8')
  assert.ok(src.includes(old) && src.split(old).length === 2, 'ANCHOR MISSING OR NOT UNIQUE')
  const tag = `${process.pid}-${Math.random().toString(36).slice(2)}`
  const bsOut = new URL(`./_mutant-bs-${tag}.mjs`, import.meta.url), rrOut = new URL(`./_mutant-rr-${tag}.mjs`, import.meta.url)
  writeFileSync(bsOut, src.replace(old, neu).replace(/from '\.\//g, "from '../src/"))
  writeFileSync(rrOut, readFileSync(RR_PATH, 'utf8').replace(/from '\.\/buildsite\.mjs'/g, `from './_mutant-bs-${tag}.mjs'`).replace(/from '\.\/(?!_mutant)/g, "from '../src/"))
  try { return await fn(await import(rrOut.href)) } finally { for (const f of [bsOut, rrOut]) { try { unlinkSync(f) } catch {} } }
}

// ---- THE LIVE HALL (fixture) ------------------------------------------------------------------------------------------------------
const FX = JSON.parse(fs.readFileSync(new URL('./fixtures/reroof4-hall-1108.json', import.meta.url), 'utf8'))
const [fx0, fx1, fy0, fy1, fz0, fz1] = FX.box, fny = fy1 - fy0 + 1, fnz = fz1 - fz0 + 1
const PAL = FX.pal.map(n => { const base = n.replace(/\[.*$/, ''); const b = md.blocksByName[base]; const props = {}; const m = n.match(/\[(.*)\]/); if (m) for (const kv of m[1].split(',')) { const [k, v] = kv.split('='); props[k] = v } return b ? { name: base, boundingBox: b.boundingBox, props } : null })
const liveRead = (x, y, z) => (x < fx0 || x > fx1 || y < fy0 || y > fy1 || z < fz0 || z > fz1) ? null : PAL[FX.d[((x - fx0) * fny + (y - fy0)) * fnz + (z - fz0)]]
const HALL = FX.hall, HOME = { x: FX.home[0], y: FX.home[1], z: FX.home[2] }
const OTHER = new Set(FX.otherCells)
const bpOld = B.loadBlueprint('hall@1'), bpNew = RR.reroofBlueprint(bpOld, 'slab')
const STYLE = { wood: 'spruce', roof: 'spruce', stone: 'cobblestone' }
const occupied = (u, v, y) => { const { dx, dz } = rot(HALL.orient, u, v); const b = liveRead(HALL.anchor[0] + dx, HALL.s + y, HALL.anchor[1] + dz); return !!b && b.boundingBox === 'block' }
const bpAdd = RR.reroofProofBlueprint(bpOld, bpNew, STYLE, { occupied })
const domain = (x, z) => x >= HALL.box[0] - 4 && x <= HALL.box[2] + 4 && z >= HALL.box[1] - 4 && z <= HALL.box[3] + 4
const prove = async (M = RR, env = {}) => M.reroofProve(liveRead, HOME, HALL, bpOld, bpAdd, { stood: FX.stood, walkR: 90, domain, recordAt: (x, y, z) => OTHER.has(`${x},${y},${z}`), fx: M.reroofFixes(env) })

console.log('THE PURE RULES')
await t('slabTopFloor: a slab reading top, double or bottom is a floor to the walk when its cell is listed; anything else never', () => {
  assert.strictEqual(B.slabTopFloor({ name: 'spruce_slab', props: { type: 'top' } }), true)
  assert.strictEqual(B.slabTopFloor({ name: 'spruce_slab', props: { type: 'bottom' } }), true)
  assert.strictEqual(B.slabTopFloor({ name: 'spruce_slab' }), false, 'unread state: never')
  assert.strictEqual(B.slabTopFloor({ name: 'spruce_stairs', props: { type: 'top' } }), false)
})
await t('walkFrom `floors`: a slab is walked on ONLY when its cell is listed (the record\'s own new roof); the old rule otherwise', () => {
  const cells = new Map([['5,0,0', { name: 'spruce_slab', boundingBox: 'block', props: { type: 'top' } }]])
  const read = (x, y, z) => cells.get(`${x},${y},${z}`) ?? (y < 0 ? { name: 'stone', boundingBox: 'block' } : y === 0 && x !== 5 ? { name: 'stone', boundingBox: 'block' } : { name: 'air', boundingBox: 'empty' })
  const home = { x: 0, y: 1, z: 0 }
  assert.ok(!B.walkFrom(read, home, new Set(), 10).has('5,1,0'), 'not listed: no floor')
  assert.ok(B.walkFrom(read, home, new Set(), 10, { floors: new Set(['5,0,0']) }).has('5,1,0'), 'listed: walked')
})
await t('reroofFloors: the cells whose world state is a slab (top/bottom/double); never a stair, a full block, a cell without a state', () => {
  const f = RR.reroofFloors([{ at: [1, 2, 3], ws: { type: 'top' } }, { at: [1, 3, 3], ws: { type: 'bottom' } }, { at: [2, 2, 3], ws: { facing: 'north', half: 'bottom' } }, { at: [3, 2, 3] }])
  assert.deepStrictEqual([...f].sort(), ['1,2,3', '1,3,3'])
})
await t('reroofDoorSide / reroofEaveNotch: only the lowest course, only the door\'s edge, only over a walked cell (head, or one above it)', () => {
  assert.deepStrictEqual(RR.reroofDoorSide({ orient: 'E' }), (() => { const a = rot('E', 0, 0), b = rot('E', 0, -1); return [Math.sign(b.dx - a.dx), Math.sign(b.dz - a.dz)] })())
  const box = [0, 0, 10, 10]
  const placed = [{ at: [5, 9, 0] }, { at: [6, 9, 0] }, { at: [7, 9, 0] }, { at: [5, 9, 10] }, { at: [5, 10, 1] }]
  const walked = new Set(['5,8,0', '6,7,0', '5,8,10', '5,9,1'])
  const n = RR.reroofEaveNotch(placed, walked, { box, side: [0, -1] })
  assert.deepStrictEqual([...n].sort(), [0, 1], 'the z=0 eave over a walked head (5) and one above a walked feet (6); never 7 (unwalked), the far side, or a higher course')
  assert.deepStrictEqual([...RR.reroofEaveNotch(placed, walked)].sort(), [0, 1, 3], 'no side: every edge')
})
await t('reroofAccess: a cobblestone stair out from an eave, a pillar per step down to the walk; bounded; never a record cell or a taken cell', () => {
  // ground at y 0 (feet 1) outside the box; the eave at (10, 4, 5) (box edge x 10): columns x 11..14 step 4..1, x 15 is the walk (dy 1)
  const solid = { name: 'stone', boundingBox: 'block' }, air = { name: 'air', boundingBox: 'empty' }
  const read = (x, y, z) => (y <= 0 ? solid : air)
  const walked = a => a[1] === 1 && a[0] >= 11
  const s = RR.reroofAccess(read, { eaves: [[10, 4, 5]], box: [0, 0, 10, 10], walked })
  assert.strictEqual(s.length, 1)
  assert.deepStrictEqual(s[0].cells.map(c => c.join(',')), ['11,1,5', '11,2,5', '11,3,5', '11,4,5', '12,1,5', '12,2,5', '12,3,5', '13,1,5', '13,2,5', '14,1,5'], JSON.stringify(s[0].cells))
  assert.deepStrictEqual(RR.reroofAccess(read, { eaves: [[10, 4, 5]], box: [0, 0, 10, 10], walked, max: 9 }), [], 'over the stone bound (10 > 9): none')
  assert.deepStrictEqual(RR.reroofAccess(read, { eaves: [[10, 4, 5]], box: [0, 0, 10, 10], walked, recordAt: (x, y, z) => x === 12 && y === 2 }), [], 'a record cell in the way: none')
  assert.deepStrictEqual(RR.reroofAccess(read, { eaves: [[10, 4, 10]], box: [0, 0, 10, 10], walked }), [], 'a corner eave names no side')
})
await t('reroofRecord marks the stair `temp`; reroofDismantleDue only once every other new cell is done; reroofDismantle moves it to kind=temp clears', () => {
  const rec = { cells: [{ at: [0, 1, 0], role: 'wall', seg: 'walls' }], segments: [{ seg: 'walls', deps: [] }], palette: {} }
  const added = [{ at: [9, 1, 9], role: 'fill', seg: 'earth' }, { at: [1, 5, 1], role: 'roofslab', seg: 'roof-edge', ws: { type: 'top' } }]
  const r2 = RR.reroofRecord(rec, added, { id: 'x@1r', palette: {}, segments: [{ seg: 'roof-edge', deps: [] }] }, {}, { temp: new Set(['9,1,9']), notch: 3 })
  assert.deepStrictEqual(RR.reroofTempCells(r2).map(c => c.at), [[9, 1, 9]])
  assert.strictEqual(r2.restyle.notch, 3); assert.strictEqual(r2.restyle.temp, 1)
  assert.strictEqual(RR.reroofDismantleDue(r2, c => c.seg !== 'reroof-roof-edge'), false, 'the roof is open: the stair stays')
  assert.strictEqual(RR.reroofDismantleDue(r2, () => true), true)
  const r3 = RR.reroofDismantle(r2, { now: 7 })
  assert.deepStrictEqual(RR.reroofTempCells(r3), [])
  assert.ok(!r3.cells.some(c => c.at.join(',') === '9,1,9'))
  assert.deepStrictEqual(r3.clear.filter(c => c.kind === 'temp'), [{ at: [9, 1, 9], kind: 'temp', name: 'cobblestone' }])
  assert.strictEqual(RR.reroofDismantle(r3), null, 'nothing more to tear down')
  assert.deepStrictEqual(RR.reroofTempStanding(r3, () => ({ name: 'cobblestone' })).length, 1)
  assert.deepStrictEqual(RR.reroofTempStanding(r3, () => ({ name: 'air' })).length, 0)
  assert.deepStrictEqual(RR.reroofTempView(r3).cells, []); assert.strictEqual(RR.reroofTempView(r3).clear.length, 1)
})

console.log('THE LIVE HALL (fixture: the region round it, 11-08)')
await t('POSITIVE CONTROL (the live answer): REROOF_ACCESS=off -> no_step roof-edge 5 left, first roofslab@-18,70,23', async () => {
  const r = await prove(RR, { REROOF_ACCESS: 'off' })
  assert.strictEqual(r.ok, false)
  assert.strictEqual(`${r.why} ${r.detail}`, 'no_step roof-edge 5 left, first roofslab@-18,70,23')
})
await t('the access remedies: the hall PROVES -- the new roof\'s slabs as floors, its door-side eave notched over the walked porch row', async () => {
  const r = await prove()
  assert.ok(r.ok, `${r.why} ${r.detail}`)
  assert.strictEqual(r.notch, 15)
  const floors = RR.reroofFloors(r.p.cells)
  const onRoof = r.p.cells.filter(c => floors.has(`${c.stand[0]},${c.stand[1] - 1},${c.stand[2]}`))
  assert.ok(onRoof.length > 20, `cells placed from a stand on the roof's own slabs: ${onRoof.length}`)
  assert.ok(r.p.cells.every(c => Array.isArray(c.stand)), 'every cell has its stand')
})
await t('MUTANT: the slab floor rule dropped (walkFrom) -- the hall is unproven again (killed for that reason)', async () => {
  await withBuildsiteMutant("const floor = fullCube(f) || (!!floors && floors.has(k3(x, y - 1, z)) && slabTopFloor(f))", 'const floor = fullCube(f)', async M => {
    const r = await prove(M)
    assert.strictEqual(r.ok, false); assert.strictEqual(r.why, 'no_step')
  })
})
await t('MUTANT: no eave notch -- the finished roof cuts the door off (interior_unreachable): the notch is what keeps the hall walked', async () => {
  await withMutant(RR_PATH, "  if (!notch.size) return { ...full, notch: 0 }\n", '  return { ...full, notch: 0 }\n', async M => {
    const r = await prove(M)
    assert.strictEqual(r.ok, false); assert.strictEqual(r.why, 'interior_unreachable', `${r.why} ${r.detail}`)
  })
})

console.log('THE TEARDOWN CHAIN (fake server, the real runVisit)')
await t('a stair placed as the proof\'s first segment, the roof done, the teardown generation, a visit digs it: no stair block is left', async () => {
  const { R, PJ, G, server, bot, SITE, project } = await import('./helpers/buildfake.mjs')
  const srv = server()
  const stair = [[20, G + 1, 0], [20, G + 2, 0], [21, G + 1, 0]]
  const rec = { ...SITE.record, cells: stair.map(at => ({ at, role: 'fill', seg: 'reroof-earth', temp: 1 })), segments: [{ seg: 'reroof-earth', layer: -1, deps: [] }], clear: [], restyle: { id: 'x@1r' } }
  const pal = { fill: ['cobblestone'] }
  const pr = project(rec)
  const run = async r0 => { const h = PJ.recordHead(pr.dir, pr.key); const e = bot(srv, 'A', { feet: [10, G + 1, 0] }); return R.runVisit({ ...pr.p('A'), record: r0 ?? h.head.rec, recordGen: h.head.gen, palette: pal }, e, { maxSteps: 200 }) }
  const r1 = await run()
  assert.strictEqual(r1.stop, 'complete', r1.stop + ' ' + r1.why)
  assert.ok(stair.every(a => srv.read(...a).name === 'cobblestone'), 'the stair stands')
  const head = PJ.recordHead(pr.dir, pr.key).head.rec
  assert.strictEqual(RR.reroofDismantleDue(head, () => true), true)
  PJ.publishRecord(pr.dir, pr.key, cur => RR.reroofDismantle(cur))
  const h2 = PJ.recordHead(pr.dir, pr.key).head.rec
  assert.strictEqual(RR.reroofTempStanding(h2, srv.read).length, 3, 'listed, standing: the visit is due')
  const r2 = await run(h2)
  assert.ok(stair.every(a => srv.read(...a).name === 'air'), `the stair is gone (${r2.stop} cleared ${r2.cleared})`)
  assert.strictEqual(RR.reroofTempStanding(h2, srv.read).length, 0)
})
async function stairFirstScene (M) {
  const { PJ, G, server, bot, SITE, project } = await import('./helpers/buildfake.mjs')
  const srv = server({ [`24,${G + 1},0`]: 'oak_leaves' })
  const stair = [[20, G + 1, 0], [20, G + 2, 0]]
  const rec = { ...SITE.record, cells: stair.map(at => ({ at, role: 'fill', seg: 'reroof-earth', temp: 1 })), segments: [{ seg: 'reroof-earth', layer: -1, deps: [] }],
    clear: [{ at: [24, G + 1, 0], kind: 'leaves', name: 'oak_leaves' }], restyle: { id: 'x@1r' } }
  const pr = project(rec)
  const h = PJ.recordHead(pr.dir, pr.key)
  const e = bot(srv, 'A', { feet: [10, G + 1, 0] })
  await M.runVisit({ ...pr.p('A'), record: h.head.rec, recordGen: h.head.gen, palette: { fill: ['cobblestone'] }, stairFirst: true }, e, { maxSteps: 200 })
  const rows = e.logs.filter(([k, d]) => k === '_build' && (d.op === 'place' || d.op === 'clear')).map(([, d]) => d.op)
  return { rows, srv, stair }
}
await t('runVisit `stairFirst`: an open temporary stair is built BEFORE any listed clear is dug (the proof reached the digs over it)', async () => {
  const { R } = await import('./helpers/buildfake.mjs')
  const { rows, srv, stair } = await stairFirstScene(R)
  assert.ok(stair.every(a => srv.read(...a).name === 'cobblestone'))
  assert.ok(rows.indexOf('place') >= 0 && rows.indexOf('clear') > rows.lastIndexOf('place'), JSON.stringify(rows))
})
await t('MUTANT: `stairFirst` ignored -- the clear comes first again (killed for that reason)', async () => {
  const { withMutant: wm } = await import('./helpers/buildfake.mjs')
  await wm("  const stairOpen = !!p.stairFirst && record.cells.some(c => c?.temp === 1 && !isDone(c))\n", '  const stairOpen = false\n', async M => {
    const { rows } = await stairFirstScene(M)
    assert.ok(rows.indexOf('clear') < rows.indexOf('place'), JSON.stringify(rows))
  })
})
await t('wired (structural, comments stripped): buildReroof asks reroofProve and publishes temp+notch; the shop visit passes the floors and tears the stair down; recordDamaged asks the stair\'s state', () => {
  const strip = f => readFileSync(new URL(f, import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  const sk = strip('../src/skills.mjs')
  assert.strictEqual(sk.split('const pr = await reroofProve(read, home, rec, bpOld, bpAdd, { stood, walkR, domain, decor: decorRec, recordAt, fx: REROOF_FIX })').length, 2)
  assert.ok(sk.includes('reroofRecord(cur, p.cells, bpNew, style, { clear, temp: pr.temp, notch: pr.notch })'))
  assert.ok(sk.includes("    Object.assign(storeOpts, reroofVisitOpts(rec, stood))"))
  assert.ok(sk.includes('walkRead: reroofNoLeafFloor, stairFirst: true, ...(Array.isArray(stood) ? { stood: reroofSeeds(stood, rec.box) } : {}) } : {})'))
  assert.ok(sk.includes("    if (r.stop === 'complete' && reroofTempState(bot, rec) === 'due') reroofTempDown(bot, dir, key, me, plot)"))
  assert.ok(sk.includes('    if (r?.restyle && reroofTempState(bot, r)) return true'))
  const br = strip('../src/buildrun.mjs')
  assert.ok(br.includes('walkFrom(walkRd, home, block, walkR, { stood, noFloor, floors: p.floors ?? null })'))
  assert.ok(br.includes('  if (!stairOpen) { const s = await clears(); if (s) { out.stop = s; return out } }'))
  assert.strictEqual(RR.reroofFixes({ REROOF_ACCESS: 'off' }).access, false)
})

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
