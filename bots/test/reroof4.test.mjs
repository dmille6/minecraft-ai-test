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
await t('r5 stairSupportOk / reroofAccess: a pillar never stands on a dirt path, farmland or ANY record\'s cell (the storehub\'s path P-storehub-2)', () => {
  const air = { name: 'air', boundingBox: 'empty' }
  assert.strictEqual(RR.stairSupportOk({ name: 'dirt_path', boundingBox: 'block' }, [0, 0, 0]), false)
  assert.strictEqual(RR.stairSupportOk({ name: 'farmland', boundingBox: 'block' }, [0, 0, 0]), false)
  assert.strictEqual(RR.stairSupportOk({ name: 'stone', boundingBox: 'block' }, [0, 0, 0]), true)
  assert.strictEqual(RR.stairSupportOk({ name: 'stone', boundingBox: 'block' }, [1, 2, 3], (x, y, z) => x === 1 && y === 2 && z === 3), false, 'a record cell')
  const walked = a => a[1] === 1 && a[0] >= 11
  const path = (x, y, z) => (y < 0 ? { name: 'stone', boundingBox: 'block' } : y === 0 ? { name: x <= 13 ? 'dirt_path' : 'stone', boundingBox: 'block' } : air)
  assert.deepStrictEqual(RR.reroofAccess(path, { eaves: [[10, 4, 5]], box: [0, 0, 10, 10], walked }), [], 'every step would stand on the path: no stair')
  const stone = (x, y, z) => (y <= 0 ? { name: 'stone', boundingBox: 'block' } : air)
  assert.strictEqual(RR.reroofAccess(stone, { eaves: [[10, 4, 5]], box: [0, 0, 10, 10], walked }).length, 1, 'positive control: on stone the stair stands')
  assert.deepStrictEqual(RR.reroofAccess(stone, { eaves: [[10, 4, 5]], box: [0, 0, 10, 10], walked, recordAt: (x, y, z) => y === 0 && x === 12 }), [], 'a record cell under a pillar: none')
})
await t('r5 reroofApproach: the cheapest fills+cuts from the door front to the town walk, never into the pad, never a record cell, never under the roof', () => {
  // ground y 0 (feet 1) except a TRENCH at z -1 (ground y -2: feet -1) between the door front (z 0, feet 1) and the walk (z <= -2)
  const air = { name: 'air', boundingBox: 'empty' }, grass = { name: 'grass_block', boundingBox: 'block' }, stone = { name: 'stone', boundingBox: 'block' }
  const ground = (x, z) => (z === -1 ? -2 : 0)
  const read = (x, y, z) => (y > ground(x, z) ? air : y === ground(x, z) ? grass : stone)
  const walked = new Set(); for (let x = -5; x <= 5; x++) for (let z = -6; z <= -2; z++) walked.add(`${x},1,${z}`)
  const box = [-3, 1, 3, 7]
  const a = RR.reroofApproach(read, { from: [[0, 1, 0]], walked, box })
  assert.deepStrictEqual(a, { fills: [[0, -1, -1]], cuts: [], cost: 1 }, 'one fill in the trench: down 1, up 1 to the walk')
  const rec = RR.reroofApproach(read, { from: [[0, 1, 0]], walked, box, recordAt: (x, y, z) => z === -1 })
  assert.ok(rec && rec.fills.every(f => f[2] !== -1) && rec.cuts.every(c => c.at[2] !== -1), 'the trench is a record\'s: nothing placed or cut in it ' + JSON.stringify(rec))
  assert.strictEqual(RR.reroofApproach(read, { from: [[0, 1, 0]], walked, box, max: 0 }), null, 'bounded')
  const block = new Set(); for (let x = -12; x <= 12; x++) for (const y of [-1, 0, 1, 2]) block.add(`${x},${y},-1`)
  assert.strictEqual(RR.reroofApproach(read, { from: [[0, 1, 0]], walked, box, block }), null, 'never through a cell of the new roof')
  assert.deepStrictEqual(RR.reroofApproach(read, { from: [], walked, box }), null)
})
await t('r5 reroofFallRisk + walkFrom `avoid`: a ledge whose fall lands off the town walk is avoided; a fall onto the walk or a wall side is not', () => {
  // a 1-wide ledge (x 0, z 0..4, feet 6 on a pillar of stone) beside the building box; east of it a pit to y 0 (feet 1) NOT walked;
  // west of it the walk at feet 5 (a step down: an ordinary step, no fall)
  const air = { name: 'air', boundingBox: 'empty' }, stone = { name: 'stone', boundingBox: 'block' }
  const read = (x, y, z) => (x === 0 && y <= 5 ? stone : x < 0 && y <= 4 ? stone : x > 0 && y <= 0 ? stone : air)
  const walked = new Set(); for (let z = 0; z <= 4; z++) walked.add(`0,6,${z}`)
  for (let z = -4; z <= 8; z++) for (let x = -6; x <= -1; x++) walked.add(`${x},5,${z}`)
  const risk = RR.reroofFallRisk(read, walked, { box: [-1, 0, 0, 4] })
  for (let z = 0; z <= 4; z++) assert.ok(risk.has(`0,6,${z}`), `the ledge 0,6,${z} is avoided: ${[...risk].join(' ')}`)
  assert.ok(![...risk].some(k => k.startsWith('-')), 'the walk beside it (its falls land on the walk, or it has none) is not')
  const walked2 = new Set([...walked]); for (let z = -4; z <= 8; z++) { walked2.add(`1,1,${z}`); walked2.add(`0,6,${z}`) }
  const risk2 = RR.reroofFallRisk(read, walked2, { box: [-1, 0, 0, 4] })
  for (let z = 0; z <= 4; z++) assert.ok(!risk2.has(`0,6,${z}`), 'the landing is walked: a way back exists ' + [...risk2].join(' '))
  assert.strictEqual(RR.reroofFallRisk(read, walked, { box: [20, 20, 30, 30] }).size, 0, 'far from the building: not judged')
  const w = B.walkFrom(read, { x: -1, y: 5, z: 2 }, new Set(), 20, { stood: [[0, 6, 2]] }), wa = B.walkFrom(read, { x: -1, y: 5, z: 2 }, new Set(), 20, { stood: [[0, 6, 2]], avoid: risk })
  assert.ok(w.has('0,6,2') && !wa.has('0,6,2'), 'walkFrom avoid takes the ledge out')
})
await t('r5 reroofExitLeaves: the natural leaves over the step back up from a one-block slip are listed; a placed hedge, a record cell, no landing: never', () => {
  // the ledge: feet 6 at x 0 (floor y 5); east a terrace one below (floor y 4, feet 5); the spruce's leaves at the step's head room 1,7,z
  const air = { name: 'air', boundingBox: 'empty' }, stone = { name: 'stone', boundingBox: 'block' }
  const mk = persistent => (x, y, z) => (x === 0 && y <= 5 ? stone : x > 0 && y <= 4 ? stone : x === 1 && y === 7 ? { name: 'spruce_leaves', boundingBox: 'block', props: { persistent } } : air)
  const walked = new Set(); for (let z = 0; z <= 2; z++) { walked.add(`0,6,${z}`) }
  const ex = RR.reroofExitLeaves(mk('false'), walked, { box: [-3, 0, 0, 2] })
  assert.deepStrictEqual(ex.map(c => c.at.join(',')).sort(), ['1,7,0', '1,7,1', '1,7,2'])
  assert.ok(ex.every(c => c.kind === 'leaves' && c.name === 'spruce_leaves'))
  assert.deepStrictEqual(RR.reroofExitLeaves(mk('true'), walked, { box: [-3, 0, 0, 2] }), [], 'a placed hedge stays')
  assert.deepStrictEqual(RR.reroofExitLeaves(mk('false'), walked, { box: [-3, 0, 0, 2], recordAt: (x, y, z) => z === 1 }).map(c => c.at.join(',')).sort(), ['1,7,0', '1,7,2'], 'a record cell stays')
  const deep = (x, y, z) => (x === 0 && y <= 5 ? stone : x > 0 && y <= 1 ? stone : x === 1 && y === 7 ? { name: 'spruce_leaves', boundingBox: 'block', props: { persistent: 'false' } } : air)
  assert.deepStrictEqual(RR.reroofExitLeaves(deep, walked, { box: [-3, 0, 0, 2] }), [], 'no one-block landing: nothing listed (the fall guard judges deeper drops)')
  assert.deepStrictEqual(RR.reroofExitLeaves(mk('false'), walked, { box: [20, 20, 30, 30] }), [], 'far from the building: nothing')
})
await t('reroofRecord marks the stair `temp`; reroofDismantleDue only once every other new cell is done; reroofDismantle moves it to kind=temp clears', () => {
  const rec = { cells: [{ at: [0, 1, 0], role: 'wall', seg: 'walls' }], segments: [{ seg: 'walls', deps: [] }], palette: {} }
  const added = [{ at: [9, 1, 9], role: 'fill', seg: 'earth' }, { at: [1, 5, 1], role: 'roofslab', seg: 'roof-edge', ws: { type: 'top' } }]
  const r2 = RR.reroofRecord(rec, added, { id: 'x@1r', palette: {}, segments: [{ seg: 'roof-edge', deps: [] }] }, {}, { temp: new Set(['9,1,9']), notch: 3 })
  assert.deepStrictEqual(RR.reroofTempCells(r2).map(c => c.at), [[9, 1, 9]])
  assert.strictEqual(r2.restyle.notch, 3); assert.strictEqual(r2.restyle.temp, 1)
  assert.deepStrictEqual(r2.palette.fill, ['cobblestone', 'cobbled_deepslate', 'stone'], 'a blueprint with no fill role still names the stair\'s block (Paper storehub: no_material fill)')
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
await t('the access remedies: the hall PROVES with its WHOLE roof -- slabs as floors, the door-side eave kept over a one-cut approach (r5)', async () => {
  const r = await prove()
  assert.ok(r.ok, `${r.why} ${r.detail}`)
  assert.strictEqual(r.notch, 0, 'the overhang stays (owner: looks matter)')
  assert.deepStrictEqual(r.approach, { fills: 0, cuts: 1 })
  assert.ok(r.clear.some(c => c.kind === 'cut' && c.at.join(',') === '-13,66,20'), 'the approach cut is a listed clear of the head')
  assert.strictEqual(r.p.cells.filter(c => c.seg !== 'earth').length, bpAdd.cells.length, 'every cell of the new roof, the eave included')
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
await t('r5 the live hall lists its way back up (exit leaves) as clears; MUTANT without them the list shrinks (killed for that reason)', async () => {
  const r = await prove()
  const real = r.clear.length
  await withMutant(RR_PATH, "  const take = at => { const b = read(...at); if (b && LEAVES_RX.test(nmOf(b)) && naturalLeafBlock(b) && !recordAt(...at)) out.set(at.join(','), { at, name: nmOf(b), kind: 'leaves' }) }\n", '  const take = () => {}\n', async M => {
    const q = await prove(M)
    assert.ok(q.ok && q.clear.length < real, `real ${real}, mutant ${q.clear.length}`)
  })
})
await t('FALLBACK ONLY: REROOF_APPROACH=off -> the door-side eave is notched (15) as before; with no notch either the door is cut off', async () => {
  const r = await prove(RR, { REROOF_APPROACH: 'off' })
  assert.ok(r.ok, `${r.why} ${r.detail}`); assert.strictEqual(r.notch, 15); assert.strictEqual(r.approach, undefined)
  await withMutant(RR_PATH, "  if (!notch.size) return { ...full, notch: 0 }\n", '  return { ...full, notch: 0 }\n', async M => {
    const q = await prove(M, { REROOF_APPROACH: 'off' })
    assert.strictEqual(q.ok, false); assert.strictEqual(q.why, 'interior_unreachable', `${q.why} ${q.detail}`)
  })
})
await t('MUTANT: the approach never found (reroofApproach null) -- the hall falls back to the notch and loses its overhang (killed for that reason)', async () => {
  await withMutant(RR_PATH, "  const starts = from.filter(a => Array.isArray(a) && a.length === 3)\n  if (!starts.length) return null\n", '  return null\n', async M => {
    const r = await prove(M)
    assert.ok(r.ok); assert.strictEqual(r.notch, 15, 'the mutant cuts the overhang')
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
await t('r5 runVisit `p.avoid` (Codex r5 BLOCKER): every walk of the visit carries the avoided ledges in its step fence, and no stand is one', async () => {
  const { R, PJ, G, server, bot, SITE, project } = await import('./helpers/buildfake.mjs')
  const srv = server()
  const stair = [[20, G + 1, 0], [20, G + 2, 0]]
  const rec = { ...SITE.record, cells: stair.map(at => ({ at, role: 'fill', seg: 'reroof-earth' })), segments: [{ seg: 'reroof-earth', layer: -1, deps: [] }], clear: [], restyle: { id: 'x@1r' } }
  const run = async (avoid, M = R) => {
    const pr = project(rec), h = PJ.recordHead(pr.dir, pr.key)
    srv.cells.clear()
    const e = bot(srv, 'A', { feet: [10, G + 1, 0] })
    const walks = [], w0 = e.walkTo
    e.walkTo = async (st, o = {}) => { walks.push({ st, avoid: o.avoid ?? null }); return w0(st, o) }
    const r = await M.runVisit({ ...pr.p('A'), record: h.head.rec, recordGen: h.head.gen, palette: { fill: ['cobblestone'] }, ...(avoid ? { avoid } : {}) }, e, { maxSteps: 200 })
    return { r, walks }
  }
  const risky = new Set([`21,${G + 1},0`, `19,${G + 1},0`])
  const a = await run(() => risky)
  assert.ok(a.walks.length > 0, 'it walked')
  assert.ok(a.walks.every(w => w.avoid && [...risky].every(k => w.avoid.has(k))), 'every walk fences the ledges')
  assert.ok(a.walks.every(w => !risky.has(w.st.join(','))), 'no stand is an avoided cell')
  const b = await run(null)
  assert.ok(b.walks.length > 0 && b.walks.every(w => ![...risky].some(k => w.avoid?.has(k))), 'positive control: without the guard no walk fences them')
})
await t('r5 MUTANT: the walk fence dropped -- a walk no longer carries the avoided ledges (killed for that reason)', async () => {
  const { R, PJ, G, server, bot, SITE, project, withMutant: wm } = await import('./helpers/buildfake.mjs')
  await wm("  if (avoidSet?.size) { const e0 = e; e = {", "  if (false) { const e0 = e; e = {", async M => {
    const srv = server()
    const rec = { ...SITE.record, cells: [[20, G + 1, 0]].map(at => ({ at, role: 'fill', seg: 'reroof-earth' })), segments: [{ seg: 'reroof-earth', layer: -1, deps: [] }], clear: [], restyle: { id: 'x@1r' } }
    const pr = project(rec), h = PJ.recordHead(pr.dir, pr.key)
    const e = bot(srv, 'A', { feet: [10, G + 1, 0] })
    const walks = [], w0 = e.walkTo
    e.walkTo = async (st, o = {}) => { walks.push(o.avoid ?? null); return w0(st, o) }
    await M.runVisit({ ...pr.p('A'), record: h.head.rec, recordGen: h.head.gen, palette: { fill: ['cobblestone'] }, avoid: () => new Set([`21,${G + 1},0`]) }, e, { maxSteps: 200 })
    assert.ok(walks.length && walks.every(a => !a?.has(`21,${G + 1},0`)), 'the mutant walks unfenced')
  })
})
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
  assert.ok(sk.includes("    Object.assign(storeOpts, reroofVisitOpts(rec, stood, home))"))
  assert.ok(sk.includes('...(REROOF_FIX.fallSafe && home ? { avoid: rd => reroofFallRisk(rd, siteWalkFrom(rd, home, new Set(), Number.isFinite(rec.walkR) ? rec.walkR : 90,'), 'the visit avoids the risky ledges')
  assert.ok(sk.includes('walkRead: reroofNoLeafFloor, stairFirst: true, ...(Array.isArray(stood) ? { stood: reroofSeeds(stood, rec.box) } : {}) } : {})'))
  assert.ok(sk.includes("    if (reroofTempState(bot, rec) === 'due') reroofTempDown(bot, dir, key, me, plot)"), 'the teardown on any stop (Codex r1 BLOCKER)')
  assert.ok(sk.includes('    if (r?.restyle && reroofTempState(bot, r)) return true'))
  const br = strip('../src/buildrun.mjs')
  assert.ok(br.includes('walkFrom(walkRd, home, block, walkR, { stood, noFloor, floors: p.floors ?? null, avoid: avoidSet })'))
  assert.ok(br.includes('  if (!stairOpen) { const s = await clears(); if (s) { out.stop = s; return out } }'))
  assert.strictEqual(RR.reroofFixes({ REROOF_ACCESS: 'off' }).access, false)
})

// ---- r6 (round 3, Paper sandbox4 11-08) ---------------------------------------------------------------------------------------------
// the storehub's north strip (Paper/replay 11-08): a stair top 0,6,2; east of it a ledge strip 1..3,1,z (feet 1 over stone y 0) between
// a wall (x 4) and a ditch; the strip is not on the town walk; with a drop out of the ditch west (to feet -1) the walk is reached
const air = { name: 'air', boundingBox: 'empty' }, stone = { name: 'stone', boundingBox: 'block' }
const stripRead = exit => (x, y, z) => {
  if (x === 0 && z === 2 && y <= 5) return stone              // the stair pillar
  if (x === 4) return y <= 9 ? stone : air                    // a wall east
  if (x >= 1 && x <= 3 && z === 2) return y <= 0 ? stone : air   // the strip (feet 1)
  if (x < 0 && !exit) return y <= 4 ? stone : air             // the town ground west (feet 5): no way up from the strip's ditch
  return y <= (exit ? -2 : -6) ? stone : air                  // the ditch round the strip: feet -1 (exit: a 2-block drop, then west) or deep
}
await t('r6 reroofRecoverable: a landing a body can walk and drop back from reaches the walk; a closed pocket does not', () => {
  const walkedClosed = new Set(['-1,5,2', '-2,5,2'])
  assert.strictEqual(RR.reroofRecoverable(stripRead(false), '1,1,2', walkedClosed), false, 'POSITIVE CONTROL: the strip with no way back')
  const walkedExit = new Set(['-1,-1,2', '-2,-1,2'])
  assert.strictEqual(RR.reroofRecoverable(stripRead(true), '1,1,2', walkedExit), true, 'a drop west then the walk')
  assert.strictEqual(RR.reroofRecoverable(stripRead(true), 'x', walkedExit), false)
})
await t('r6 reroofFallRisk `recover` + `floors`: a ledge over a recoverable landing is not avoided; a roof slab is a landing', () => {
  const walked = new Set(['0,6,2', '-1,-1,2', '-2,-1,2'])
  assert.ok(RR.reroofFallRisk(stripRead(true), walked, { box: [-1, 0, 4, 4] }).has('0,6,2'), 'POSITIVE CONTROL: without recover the stair top is avoided')
  assert.ok(!RR.reroofFallRisk(stripRead(true), walked, { box: [-1, 0, 4, 4], recover: true }).has('0,6,2'), 'with the way back it is not')
  assert.ok(RR.reroofFallRisk(stripRead(false), new Set(['0,6,2', '-1,5,2']), { box: [-1, 0, 4, 4], recover: true }).has('0,6,2'), 'a closed pocket stays a trap')
  // a ledge 0,6,0 ringed by the roof's top slabs at y 3 (feet 4, walked), deep air below them: a slab is the landing only with `floors`
  const ring = [[1, 0], [-1, 0], [0, 1], [0, -1]]
  const slab = (x, y, z) => (x === 0 && z === 0 ? (y <= 5 ? stone : air) : ring.some(([a, b]) => a === x && b === z) && y === 3 ? { name: 'spruce_slab', boundingBox: 'block', props: { type: 'top' } } : y <= -6 ? stone : air)
  const w2 = new Set(['0,6,0', ...ring.map(([a, b]) => `${a},4,${b}`)])
  assert.ok(RR.reroofFallRisk(slab, w2, { box: [-2, -2, 2, 2] }).has('0,6,0'), 'POSITIVE CONTROL: without floors the fall passes the slab')
  assert.ok(!RR.reroofFallRisk(slab, w2, { box: [-2, -2, 2, 2], floors: new Set(ring.map(([a, b]) => `${a},3,${b}`)) }).has('0,6,0'), 'the slab is the landing')
})
await t('r6e reroofFallRisk `keep` + reroofStairFeet: the record\'s own (proof-verified) stair is not avoided; without keep it is -- the control', () => {
  const walked = new Set(['0,6,2', '-1,-1,2', '-2,-1,2'])
  assert.ok(RR.reroofFallRisk(stripRead(false), walked, { box: [-1, 0, 4, 4] }).has('0,6,2'), 'POSITIVE CONTROL: the stair top over the strip is avoided')
  assert.ok(!RR.reroofFallRisk(stripRead(false), walked, { box: [-1, 0, 4, 4], keep: new Set(['0,6,2']) }).has('0,6,2'))
  const rec = { cells: [{ at: [0, 4, 2], temp: 1 }, { at: [0, 5, 2], temp: 1 }, { at: [3, 3, 3] }] }
  assert.deepStrictEqual([...RR.reroofStairFeet(rec)], ['0,6,2'])
})
await t('r6e MUTANT: the keep test dropped -- the stair top is avoided again (killed for that reason)', async () => {
  await withMutant(RR_PATH, '    if (keep?.has(key)) continue\n', '', async M => {
    assert.ok(M.reroofFallRisk(stripRead(false), new Set(['0,6,2', '-1,-1,2']), { box: [-1, 0, 4, 4], keep: new Set(['0,6,2']) }).has('0,6,2'))
  })
})
await t('r6 reroofStairSafe: a stair whose step drops into a closed pocket is unsafe; with a way back it is safe; stairFeetOf the tops', () => {
  assert.deepStrictEqual([...RR.stairFeetOf(['0,4,2', '0,5,2', '0,3,1'])].sort(), ['0,4,1', '0,6,2'])
  const keys = new Set(['0,5,2'])
  const homeC = { x: -1, y: 5, z: 2 }
  const un = RR.reroofStairSafe(stripRead(false), homeC, [], keys, { box: [-1, 0, 4, 4], walkR: 12 })
  assert.strictEqual(un.ok, false); assert.ok(un.risky.includes('0,6,2'))
  const ok = RR.reroofStairSafe(stripRead(true), { x: -1, y: -1, z: 2 }, [], keys, { box: [-1, 0, 4, 4], walkR: 12, stood: [[0, 6, 2]] })
  assert.strictEqual(ok.ok, true, JSON.stringify(ok))
})
await t('r6 MUTANT: the recovery path dropped from the fall guard -- the stair top is avoided again (killed for that reason)', async () => {
  await withMutant(RR_PATH, " && !(recover && reroofRecoverable(read, land, walked, { floors }))", '', async M => {
    const walked = new Set(['0,6,2', '-1,-1,2', '-2,-1,2'])
    assert.ok(M.reroofFallRisk(stripRead(true), walked, { box: [-1, 0, 4, 4], recover: true }).has('0,6,2'))
  })
})
// the workshop pit (Paper 11-08): the slip lands at 32,68,-71; the way back is the jump-up to 31,69,-71 under the natural leaf 31,71,-71
const leafAt = (persistent = 'false') => ({ name: 'spruce_leaves', boundingBox: 'block', props: { persistent } })
const pitRead = (persistent = 'false') => (x, y, z) => {
  const air = { name: 'air', boundingBox: 'empty' }, stone = { name: 'stone', boundingBox: 'block' }
  if (x === 31 && y === 71 && z === -71) return leafAt(persistent)
  if (x <= 31 && y <= 68) return stone          // the terrace (feet 69) west of the pit
  if (x >= 32 && y <= 67) return stone          // the pit floor (feet 68)
  return air
}
await t('r6 reroofApexLeaves: the jump-apex leaf out to box + 6 is listed (apex: 1); one the inner list has, a placed hedge, a record cell: never', () => {
  const walked = new Set(['31,69,-71', '30,69,-71'])
  const box = [11, -74, 27, -64]                      // the workshop's pad box: x 31 is box + 4 (r5e's box + 3 missed it)
  const ap = RR.reroofApexLeaves(pitRead(), walked, { box })
  assert.deepStrictEqual(ap.map(c => [c.at.join(','), c.apex, c.kind]), [['31,71,-71', 1, 'leaves']])
  assert.deepStrictEqual(RR.reroofExitLeaves(pitRead(), walked, { box }).filter(c => c.at.join(',') === '31,71,-71'), [], 'POSITIVE CONTROL: the r5e exit list (box + 3) misses it')
  assert.deepStrictEqual(RR.reroofApexLeaves(pitRead('true'), walked, { box }), [], 'a placed hedge stays')
  assert.deepStrictEqual(RR.reroofApexLeaves(pitRead(), walked, { box, inner: [{ at: [31, 71, -71] }] }), [], 'already listed')
  assert.deepStrictEqual(RR.reroofApexLeaves(pitRead(), walked, { box, recordAt: () => true }), [], 'a record cell stays')
  assert.deepStrictEqual(RR.reroofApexLeaves(pitRead(), walked, { box: [100, 100, 110, 110] }), [], 'far: nothing')
  const rec = RR.reroofRecord({ v: 1, cells: [], segments: [], structure_complete: true, palette: {} }, [], { id: 'x@1r', segments: [], palette: {} }, { roof: 'spruce' }, { clear: RR.withApex([], ap) })
  assert.ok(rec.clear.some(c => c.apex === 1), 'the record keeps the tag')
  assert.deepStrictEqual([...RR.reroofApexKeys(rec)], [['31,71,-71', 'spruce_leaves']])
})
await t('r6 apexDigs (buildbot): a planned jump-up under a LISTED natural leaf is dug first from the lower cell; unlisted, level, or no leaf: nothing', async () => {
  const { apexDigs } = await import('../src/buildbot.mjs')
  const path = [{ x: 31.5, y: 69, z: -70.5 }, { x: 30.5, y: 69, z: -70.5 }]
  const d = apexDigs({ x: 32, y: 68, z: -71 }, path, pitRead(), k => (k === '31,71,-71' ? 'spruce_leaves' : null))
  assert.deepStrictEqual(d.map(q => [q.lower, q.at, q.name]), [[[32, 68, -71], [31, 71, -71], 'spruce_leaves']])
  assert.deepStrictEqual(apexDigs({ x: 32, y: 68, z: -71 }, path, pitRead(), () => null), [], 'unlisted: never dug')
  // Codex r6 BLOCKER: a PLACED leaf (persistent true), or another kind than the record listed, is never dug
  assert.deepStrictEqual(apexDigs({ x: 32, y: 68, z: -71 }, path, pitRead('true'), () => 'spruce_leaves'), [], 'a placed leaf')
  assert.deepStrictEqual(apexDigs({ x: 32, y: 68, z: -71 }, path, pitRead(), () => 'oak_leaves'), [], 'another kind than listed')
  assert.deepStrictEqual(apexDigs({ x: 31, y: 69, z: -71 }, [{ x: 30.5, y: 69, z: -70.5 }], pitRead(), () => 'spruce_leaves'), [], 'a level step: no jump')
  assert.deepStrictEqual(apexDigs({ x: 32, y: 68, z: -71 }, path, (x, y, z) => (y === 71 ? { name: 'air', boundingBox: 'empty' } : pitRead()(x, y, z)), () => 'spruce_leaves'), [], 'no leaf')
})
await t('r6 MUTANT (Codex r6 BLOCKER): the natural-leaf test dropped from apexDigs -- a placed leaf would be dug (killed for that reason)', async () => {
  const BB_PATH = new URL('../src/buildbot.mjs', import.meta.url)
  const src = readFileSync(BB_PATH, 'utf8')
  const old = "return want && want === b.name && (p === false || p === 'false') ? String(b.name) : null }"
  assert.ok(src.split(old).length === 2, 'ANCHOR MISSING OR NOT UNIQUE')
  const out = new URL(`./_mutant-${process.pid}-bb6.mjs`, import.meta.url)
  writeFileSync(out, src.replace(old, "return want && want === b.name ? String(b.name) : null }").replace(/from '\.\//g, "from '../src/"))
  try { const M = await import(out.href); assert.strictEqual(M.apexDigs({ x: 32, y: 68, z: -71 }, [{ x: 31.5, y: 69, z: -70.5 }], pitRead('true'), () => 'spruce_leaves').length, 1) } finally { try { unlinkSync(out) } catch {} }
})
await t('r6 runVisit clears skip an apex leaf (the walk digs it); the same leaf without the tag is dug -- the positive control', async () => {
  const { R, PJ, G, server, bot, SITE, project } = await import('./helpers/buildfake.mjs')
  const run = async (M, tag) => {
    const leaf = [2, G + 2, -4]
    const srv = server({ [leaf.join(',')]: 'spruce_leaves' })
    const record = { ...SITE.record, clear: [{ at: leaf, kind: 'leaves', name: 'spruce_leaves', ...(tag ? { apex: 1 } : {}) }] }
    const pr = project(record)
    const h = PJ.recordHead(pr.dir, pr.key)
    await M.runVisit({ ...pr.p('A'), record: h.head.rec, recordGen: h.head.gen }, bot(srv, 'A'), { maxSteps: 400 })
    return srv.read(...leaf).name
  }
  assert.notStrictEqual(await run(R, false), 'spruce_leaves', 'POSITIVE CONTROL: an ordinary listed leaf is dug')
  assert.strictEqual(await run(R, true), 'spruce_leaves', 'the apex leaf stays for the walk')
})
await t('r6 MUTANT: the clears pass ignores the apex tag -- it digs the apex leaf again (killed for that reason)', async () => {
  const { PJ, G, server, bot, SITE, project, withMutant: wm } = await import('./helpers/buildfake.mjs')
  await wm('filter(c => c?.apex !== 1 && (unknown.has(kOf(c.at)) || nm(e.read(...c.at)) === c.name))', 'filter(c => (unknown.has(kOf(c.at)) || nm(e.read(...c.at)) === c.name))', async M => {
    const leaf = [2, G + 2, -4]
    const srv = server({ [leaf.join(',')]: 'spruce_leaves' })
    const record = { ...SITE.record, clear: [{ at: leaf, kind: 'leaves', name: 'spruce_leaves', apex: 1 }] }
    const pr = project(record)
    const h = PJ.recordHead(pr.dir, pr.key)
    await M.runVisit({ ...pr.p('A'), record: h.head.rec, recordGen: h.head.gen }, bot(srv, 'A'), { maxSteps: 400 })
    assert.notStrictEqual(srv.read(...leaf).name, 'spruce_leaves')
  })
})
await t('r6 wired (structural, comments stripped): the shop visit\'s fall guard keeps the proof-verified stair; the proof takes only safe stairs; the apex keys; the walk digs apex leaves only when asked', () => {
  const strip = f => readFileSync(new URL(f, import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  const sk = strip('../src/skills.mjs')
  assert.ok(/\{ box: rec\.box, keep: reroofStairFeet\(rec\) \}\) \} : \{\}\),/.test(sk), 'the visit guard: the r5 rule, the proof-verified stair kept')
  assert.ok(/if \(fx\.fallSafe\) \{ await tick\(\); const sf = reroofStairSafe\(read, home, q\.cells, keys, \{ stood, walkR, box: rec\.box \}\); if \(!sf\.ok\)/.test(strip('../src/reroof.mjs')), 'the proof takes no unsafe stair')
  assert.ok(/apexDig: REROOF_FIX\.apex && rec\?\.restyle \? \(keys => k => keys\.get\(k\) \?\? null\)\(reroofApexKeys\(rec\)\) : null,/.test(sk))
  const bb = strip('../src/buildbot.mjs')
  assert.ok(/if \(typeof apexDig === 'function'\) \{/.test(bb) && /for \(const d of apexDigs\(\{ x: f0\[0\], y: f0\[1\], z: f0\[2\] \}, path0, read, apexDig\)\)/.test(bb))
  assert.ok(/const apex = walk0 && fx\.apex \? reroofApexLeaves\(/.test(strip('../src/reroof.mjs')))
  assert.strictEqual(RR.reroofFixes({ REROOF_APEX: 'off' }).apex, false); assert.strictEqual(RR.reroofFixes({}).apex, true)
})

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
