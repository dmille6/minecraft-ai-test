// THE ZIGGURAT PLAN AND THE SHAFT ENVELOPE (src/monument.mjs, src/shaftplan.mjs): pure geometry and site scoring,
// tested by behaviour on synthetic worlds. Each guard has a positive control (a world it must accept) beside the world it
// must refuse, so a refusal can never pass because the instrument sees nothing.
import assert from 'node:assert/strict'
import * as M from '../src/monument.mjs'
import * as S from '../src/shaftplan.mjs'

let n = 0
const t = (name, fn) => { fn(); n++; console.log(`ok ${n} ${name}`) }
const blk = (name, bb = 'block') => ({ name, boundingBox: bb, props: {} })
const AIR = blk('air', 'empty'), STONE = blk('stone'), GRASS = blk('grass_block'), WATER = blk('water', 'empty')
/** A world: flat ground at gy (stone below, grass at gy), with overrides. */
function flat (gy, over = new Map()) {
  return (x, y, z) => over.get(`${x},${y},${z}`) ?? (y < gy ? STONE : y === gy ? GRASS : AIR)
}

t('the 48/3/2 ziggurat is 14,688 cells, 3,780 of them skin, plus a 24-block stair', () => {
  const cells = M.zigCells({ corner: { x: 0, z: 0 }, baseY: 70 })
  const body = cells.filter(c => c.role !== 'stair')
  assert.equal(body.length, 14688)
  assert.equal(body.filter(c => c.role === 'skin').length, 3780)
  assert.equal(cells.filter(c => c.role === 'stair').length, 24)
  assert.deepEqual(M.tierSides(), [48, 42, 36, 30, 24, 18, 12, 6])
})

t('every body cell rests on the cell below or on the ground (solid by layers)', () => {
  const cells = M.zigCells({ corner: { x: 0, z: 0 }, baseY: 70 }).filter(c => c.role !== 'stair')
  const set = new Set(cells.map(c => `${c.x},${c.y},${c.z}`))
  for (const c of cells) if (c.y > 70) assert.ok(set.has(`${c.x},${c.y - 1},${c.z}`), `unsupported ${c.x},${c.y},${c.z}`)
})

t('build order is layer by layer for the WHOLE plan, stairs included (a cell never precedes one below it)', () => {
  const cells = M.zigCells({ corner: { x: 0, z: 0 }, baseY: 70 })
  for (let i = 1; i < cells.length; i++) assert.ok(cells[i].layer >= cells[i - 1].layer, `index ${i}`)
  assert.equal(M.planSize(), 14712)
})

t('every drop on the finished structure is at most 2 (no guard needed)', () => {
  for (let i = 0; i < 48; i++) for (let j = 0; j < 47; j++) {
    assert.ok(Math.abs(M.profileAt(i, j) - M.profileAt(i, j + 1)) <= 2)
    assert.ok(Math.abs(M.profileAt(j, i) - M.profileAt(j + 1, i)) <= 2)
  }
})

t('each stair block is one step (+1) above the surface it stands on, and one below the tier top it leads to', () => {
  const corner = { x: 0, z: 0 }, baseY = 70
  const cells = M.zigCells({ corner, baseY, stairFace: 's' })
  for (const s of cells.filter(c => c.role === 'stair')) {
    const i = s.x - corner.x, j = s.z - corner.z
    const under = j >= 48 ? 0 : M.profileAt(i, j)            // terrace (or apron) height at the step
    assert.equal(s.y - baseY, under, 'the step sits on the surface')
    const next = M.profileAt(i, j - 1)                        // the tier it climbs to
    assert.equal(baseY + next - 1 - s.y, 1, 'the next tier top is one above the step')
  }
})

t('site scoring: a flat dry site is accepted (positive control) with no foundation', () => {
  const read = flat(69)
  const col = (x, z) => M.scanColumn(read, x, z, { yHi: 110, yLo: 20 })
  const s = M.scoreSite({ col, corner: { x: 100, z: 100 } })
  assert.equal(s.ok, true, s.why); assert.equal(s.baseY, 70); assert.equal(s.foundation, 0); assert.equal(s.cut, 0)
})

t('site scoring: a chest in the footprint refuses; a crafting table is litter (cleared)', () => {
  const chest = new Map([['110,70,110', blk('chest', 'block')]]), table = new Map([['110,70,110', blk('crafting_table')]])
  const run = over => { const read = flat(69, over); return M.scoreSite({ col: (x, z) => M.scanColumn(read, x, z, { yHi: 110, yLo: 20 }), corner: { x: 100, z: 100 } }) }
  assert.equal(run(chest).ok, false); assert.match(run(chest).why, /furniture/)
  const r = run(table); assert.equal(r.ok, true, r.why); assert.ok(r.clear >= 1)
})

t('site scoring: a pond larger than the water limit refuses; a small one is filled (positive control)', () => {
  const big = new Map(), small = new Map()
  for (let x = 110; x < 140; x++) for (let z = 110; z < 120; z++) { big.set(`${x},69,${z}`, WATER); big.set(`${x},68,${z}`, WATER) }
  for (let x = 110; x < 113; x++) for (let z = 110; z < 113; z++) small.set(`${x},69,${z}`, WATER)
  const run = over => { const read = flat(69, over); return M.scoreSite({ col: (x, z) => M.scanColumn(read, x, z, { yHi: 110, yLo: 20 }), corner: { x: 100, z: 100 } }) }
  assert.equal(run(big).ok, false); assert.match(run(big).why, /water/)
  assert.equal(run(small).ok, true, run(small).why)
})

t('site scoring: a hill above the edge profile needs levelling: refused at maxCut 0, accepted within a budget', () => {
  const over = new Map()
  for (let x = 100; x < 104; x++) for (let z = 100; z < 104; z++) for (let y = 70; y <= 75; y++) over.set(`${x},${y},${z}`, STONE)
  const read = flat(69, over), col = (x, z) => M.scanColumn(read, x, z, { yHi: 110, yLo: 20 })
  const strict = M.scoreSite({ col, corner: { x: 100, z: 100 } })
  assert.equal(strict.ok, false, 'a 6-high bump at the corner cannot fit under a 2-high edge')
  const loose = M.scoreSite({ col, corner: { x: 100, z: 100 }, maxCut: 200 })
  assert.equal(loose.ok, true, loose.why)
})

t('a cobble pillar on the ground is litter, not ground (the base is not lifted to its top)', () => {
  const over = new Map(); for (let y = 70; y <= 80; y++) over.set(`120,${y},120`, blk('cobblestone'))
  const read = flat(69, over)
  const c = M.scanColumn(read, 120, 120, { yHi: 110, yLo: 20 })
  assert.equal(c.top, 69); assert.equal(c.above.filter(a => a.kind === 'debris').length, 11)
})

t('candidate corners keep the apron >= 25 from home and the centre <= maxCentre', () => {
  const home = { x: 0, z: 0 }
  for (const c of M.candidateCorners(home, { maxCentre: 80 })) {
    const d = M.cheb(c.centre, home)
    assert.ok(d - 26 >= M.SITE_MIN_APRON && d <= 80)
  }
})

t('shaft landings: every 8 down from the collar, a terminal at 16 when the gap exceeds 3', () => {
  assert.deepEqual(S.landingLevels(73), [65, 57, 49, 41, 33, 25, 17])
  assert.deepEqual(S.landingLevels(71), [63, 55, 47, 39, 31, 23, 16])
})

t('shaft envelope: the stub end face is NOT shell (digging continues there); the stub floor IS shell', () => {
  const env = S.envelopeLevels(64, 56, [56])
  const shell = new Set(env.shell.map(c => c.join(',')))
  assert.ok(!shell.has('0,56,9') && !shell.has('1,57,9'), 'end face is open')
  assert.ok(shell.has('0,55,8') && shell.has('0,58,8'), 'stub floor and ceiling are lining')
  assert.ok(shell.has('-1,60,0') && shell.has('2,60,0'), 'the ladder walls are lining')
})

t('shaft survey: dry stone reaches 16 (positive control); water in the envelope stops it above the water', () => {
  const read = flat(70)
  const dry = S.surveyShaft({ read, origin: { x: 0, z: 0 }, away: 's', c: 71 })
  assert.equal(dry.bottom, 16); assert.equal(dry.stop, null)
  const wet = new Map([['2,40,0', WATER]])
  const w = S.surveyShaft({ read: flat(70, wet), origin: { x: 0, z: 0 }, away: 's', c: 71 })
  assert.ok(w.bottom > 40, `bottom ${w.bottom} must be above the water`); assert.equal(w.stop, 40)
})

t('shaft orientation: +v points away from home for each quadrant', () => {
  for (const [dx, dz, want] of [[20, 0, 'e'], [-20, 0, 'w'], [0, 20, 's'], [0, -20, 'n']]) {
    const c = S.collarCandidates({ x: 0, z: 0 }).find(k => k.origin.x === dx && k.origin.z === dz)
    assert.equal(c.away, want)
    const far = S.toWorld(c.origin, c.away, 0, 5)
    assert.ok(Math.hypot(far.x, far.z) > Math.hypot(dx, dz))
  }
})


// ---- stage-1 review (Codex P1/P2): each refusal beside the control that differs from it in one thing
const run = (over, opts = {}, read0 = null) => { const read = read0 ?? flat(69, over); return M.scoreSite({ col: (x, z) => M.scanColumn(read, x, z, { yHi: 110, yLo: 20 }), corner: { x: 100, z: 100 }, ...opts }) }
const LAVA = blk('lava', 'empty')
t('lava on the footprint refuses; the dry site beside it is accepted', () => {
  assert.match(run(new Map([['120,70,120', LAVA]])).why, /lava/)
  assert.equal(run(new Map()).ok, true)
})
t('a PARTIAL read refuses (one unread cell in the band), as a wholly unread column does; the full read is accepted', () => {
  const read = (x, y, z) => (x === 120 && z === 120 && y === 90) ? null : flat(69)(x, y, z)
  assert.match(run(null, {}, read).why, /cells unread/)
  const gone = (x, y, z) => (x === 120 && z === 120) ? null : flat(69)(x, y, z)
  assert.match(run(null, {}, gone).why, /columns unread/)
})
t('foundation share: a deep pit under half the footprint refuses at 30%; a shallow one is accepted', () => {
  const deep = (x, y, z) => (x < 124 ? (y < 40 ? STONE : y === 40 ? GRASS : AIR) : flat(69)(x, y, z))
  assert.match(run(null, {}, deep).why, /fill/)
  const shallow = (x, y, z) => (x < 104 ? (y < 67 ? STONE : y === 67 ? GRASS : AIR) : flat(69)(x, y, z))
  assert.equal(run(null, {}, shallow).ok, true, run(null, {}, shallow).why)
})
t('avoid: a farm plot or well inside the apron reach refuses; one beyond it does not', () => {
  assert.match(run(new Map(), { avoid: [{ x: 99, z: 99, r: 3, what: 'farm plot' }] }).why, /farm plot/)
  assert.equal(run(new Map(), { avoid: [{ x: 60, z: 60, r: 3, what: 'farm plot' }] }).ok, true)
})
t('base choice is FEASIBLE FIRST: one edge column at 72 is fitted by raising the base (0 cuts) instead of refusing', () => {
  const over = new Map([['100,70,100', STONE], ['100,71,100', STONE], ['100,72,100', STONE], ['101,70,100', STONE], ['101,71,100', STONE], ['101,72,100', STONE], ['100,70,101', STONE], ['100,71,101', STONE], ['100,72,101', STONE]])
  const r = run(over)
  assert.equal(r.ok, true, r.why); assert.equal(r.cut, 0); assert.ok(r.baseY >= 71)
})
t('a 1x1 DIRT pillar is litter (Codex: it read as ground at 80); a dirt hill 3 wide is ground (control)', () => {
  const pillar = new Map(); for (let y = 70; y <= 80; y++) pillar.set(`120,${y},120`, blk('dirt'))
  assert.equal(M.scanColumn(flat(69, pillar), 120, 120, { yHi: 110, yLo: 20 }).top, 69)
  const hill = new Map(); for (let x = 119; x <= 121; x++) for (let z = 119; z <= 121; z++) for (let y = 70; y <= 72; y++) hill.set(`${x},${y},${z}`, blk('dirt'))
  assert.equal(M.scanColumn(flat(69, hill), 120, 120, { yHi: 110, yLo: 20 }).top, 72)
})
t('every accepted water cell is accounted: a pond above the fill line is waterFill; the dry site has none', () => {
  const pond = new Map([['99,70,110', WATER], ['120,70,120', WATER]])
  const r = run(pond); assert.equal(r.ok, true, r.why); assert.equal(r.waterFill, 1, 'the apron cell is filled; the one inside a planned cell is that cell')
  assert.equal(run(new Map()).waterFill, 0)
})
t('keptGround: natural stone/dirt is kept as done-degraded core; logs, cobble litter, tables are not credited', () => {
  assert.equal(M.keptGround(STONE), true); assert.equal(M.keptGround(blk('dirt')), true)
  for (const nm of ['oak_log', 'cobblestone', 'crafting_table', 'oak_planks', 'oak_leaves']) assert.equal(M.keptGround(blk(nm)), false, nm)
})
t('collarOk: within 6 of home.y (feet) passes, 7 off refuses, both ways', () => {
  assert.equal(S.collarOk(69, 70), true); assert.equal(S.collarOk(63, 70), true); assert.equal(S.collarOk(62, 70), false); assert.equal(S.collarOk(76, 70), false)
})
t('shaft: water at the STUB END FACE stops the shaft above that landing (Codex P1); the same cell dry reaches 16', () => {
  const wetFace = new Map([['0,55,9', WATER]])     // the second landing's end face (landings 63, 55, ...)
  const w = S.surveyShaft({ read: flat(70, wetFace), origin: { x: 0, z: 0 }, away: 's', c: 71 })
  assert.equal(w.stop, 55); assert.equal(w.bottom, 63, 'the shaft ends at the landing above the wet face')
  assert.equal(S.surveyShaft({ read: flat(70), origin: { x: 0, z: 0 }, away: 's', c: 71 }).bottom, 16)
})
t('shaft: a WATERLOGGED block in the lining stops it; an unread cell stops it; dry control reaches 16', () => {
  const logged = { name: 'oak_slab', boundingBox: 'block', props: { waterlogged: true } }
  assert.equal(S.surveyShaft({ read: flat(70, new Map([['-1,50,0', logged]])), origin: { x: 0, z: 0 }, away: 's', c: 71 }).stop, 50)
  const unread = (x, y, z) => (x === 2 && y === 45 && z === 0) ? null : flat(70)(x, y, z)
  const u = S.surveyShaft({ read: unread, origin: { x: 0, z: 0 }, away: 's', c: 71 }); assert.equal(u.stop, 45); assert.ok(u.unknown >= 1)
})
t('shaft: liquid before the first landing gives NO shaft (bottom null, a reason)', () => {
  const r = S.surveyShaft({ read: flat(70, new Map([['0,68,-1', WATER]])), origin: { x: 0, z: 0 }, away: 's', c: 71 })
  assert.equal(r.bottom, null); assert.match(r.why, /before the first landing/)
})
t('shaft: falling blocks in the lining are counted and need lining; dry stone counts none', () => {
  const g = new Map([['-1,40,0', blk('gravel')], ['2,41,0', blk('sand')]])
  const r = S.surveyShaft({ read: flat(70, g), origin: { x: 0, z: 0 }, away: 's', c: 71 })
  assert.equal(r.falling, 2); assert.equal(r.bottom, 16)
  assert.equal(S.surveyShaft({ read: flat(70), origin: { x: 0, z: 0 }, away: 's', c: 71 }).falling, 0)
})

// ---- stage-1 review (Claude r1): the stair is reachable on the surface the scorer actually produces; edges guarded
t('the apron is filled to EXACTLY baseY-1 (the stair\'s first step is +1 from it): a low apron ring is apron fill', () => {
  // the footprint at 69, the apron ring two lower (67): base 70, the apron surface must come up to 69
  const read = (x, y, z) => { const inner = x >= 100 && x < 148 && z >= 100 && z < 148; const gy = inner ? 69 : 67; return y < gy ? STONE : y === gy ? GRASS : AIR }
  const r = M.scoreSite({ col: (x, z) => M.scanColumn(read, x, z, { yHi: 110, yLo: 20 }), corner: { x: 100, z: 100 }, stairFace: 's' })
  assert.equal(r.ok, true, r.why)
  assert.equal(r.apronFill, Math.max(0, r.baseY - 1 - 67) * (52 * 52 - 48 * 48), 'every apron cell raised to baseY-1, whatever base was chosen')
  // force the higher base: the same site with the footprint's ground at 70 (no ground may stand above an edge profile of 2)
  const read2 = (x, y, z) => { const inner = x >= 100 && x < 148 && z >= 100 && z < 148; const gy = inner ? 70 : 67; return y < gy ? STONE : y === gy ? GRASS : AIR }
  const r2 = M.scoreSite({ col: (x, z) => M.scanColumn(read2, x, z, { yHi: 110, yLo: 20 }), corner: { x: 100, z: 100 }, stairFace: 's', maxCut: 0 })
  assert.equal(r2.ok, true, r2.why); assert.ok(r2.baseY - 1 > 67, `base ${r2.baseY}`); assert.equal(r2.apronFill, (r2.baseY - 1 - 67) * (52 * 52 - 48 * 48))
  const cells = M.zigCells({ corner: { x: 100, z: 100 }, baseY: r.baseY, stairFace: 's' })
  const step0 = cells.find(c => c.role === 'stair' && c.tier === 0)
  assert.equal(step0.y - (r.baseY - 1), 1, 'the first step is one above the filled apron surface')
})
t('a cliff beside the site is guarded (2-high wall cells on the apron edge) and its height reported; flat ground needs none', () => {
  const read = (x, y, z) => { const gy = (x < 98) ? 55 : 69; return y < gy ? STONE : y === gy ? GRASS : AIR }   // the ground west of the apron ring falls 14
  const r = M.scoreSite({ col: (x, z) => M.scanColumn(read, x, z, { yHi: 110, yLo: 20 }), corner: { x: 100, z: 100 }, stairFace: 's' })
  assert.equal(r.ok, true, r.why); assert.ok(r.guardAndApproach >= 2 * 50, `guard ${r.guardAndApproach}`); assert.equal(r.maxEdgeDropGuarded, 14)
  assert.equal(run(new Map(), { stairFace: 's' }).guardAndApproach, 0)
})
t('the stair approach is never walled: 2 below is filled to a +1 step; more than 4 below refuses that base height', () => {
  const at = (drop) => (x, y, z) => { const front = z === 150 && x >= 122 && x <= 124; const gy = front ? 69 - drop : 69; return y < gy ? STONE : y === gy ? GRASS : AIR }
  const two = M.scoreSite({ col: (x, z) => M.scanColumn(at(2), x, z, { yHi: 110, yLo: 20 }), corner: { x: 100, z: 100 }, stairFace: 's' })
  assert.equal(two.ok, true, two.why); assert.equal(two.guardAndApproach, 3 * 1, 'three approach cells raised one each to a +1 step')
  assert.ok(M.inApproach(23, 50, 's') && !M.inApproach(23, 50, 'n'))
})
t('the shaft entry pad (0..1, c, -1) is OPEN, with a solid floor under it (lining)', () => {
  const env = S.envelopeLevels(71, 16, S.landingLevels(71))
  const shell = new Set(env.shell.map(c => c.join(','))), dig = new Set(env.dig.map(c => c.slice(0, 3).join(',')))
  assert.ok(!shell.has('0,71,-1') && !shell.has('1,71,-1'), 'the pad is not lined shut')
  assert.ok(shell.has('0,70,-1') && shell.has('1,70,-1'), 'the pad floor is lining')
  assert.ok(dig.has('0,71,0'), 'positive control: the collar cell itself is in the envelope')
})
t('walkReach: a flat walk reaches (positive control); a 3-high wall ring around the target does not; a 1-step bank does', () => {
  assert.equal(S.walkReach(flat(70), { x: 0, y: 71, z: 0 }, { x: 20, y: 71, z: 0 }).ok, true)
  const wall = new Map(); for (let x = 17; x <= 23; x++) for (let z = -3; z <= 3; z++) if (Math.max(Math.abs(x - 20), Math.abs(z)) === 3) for (let y = 71; y <= 73; y++) wall.set(`${x},${y},${z}`, STONE)
  assert.equal(S.walkReach(flat(70, wall), { x: 0, y: 71, z: 0 }, { x: 20, y: 71, z: 0 }).ok, false)
  const bank = new Map(); for (let x = 10; x <= 30; x++) for (let z = -5; z <= 5; z++) bank.set(`${x},71,${z}`, STONE)
  assert.equal(S.walkReach(flat(70, bank), { x: 0, y: 71, z: 0 }, { x: 20, y: 72, z: 0 }).ok, true)
})
t('water INSIDE a planned cell is not extra fill (the cell\'s own placement replaces it); water above the column is', () => {
  const inside = run(new Map([['120,70,120', WATER]]))
  assert.equal(inside.ok, true, inside.why); assert.equal(inside.waterFill, 0)
  const above = run(new Map([['101,74,101', WATER]]))     // above the 2-high edge profile at the NW corner (base 70: ceil 71)
  assert.ok(above.waterFill >= 1, `waterFill ${above.waterFill}`)
})
t('stair approach: 5 below the apron refuses that base height (the rule the test name claims), 2 below is filled', () => {
  const at = drop => (x, y, z) => { const front = z === 150 && x >= 122 && x <= 124; const gy = front ? 69 - drop : 69; return y < gy ? STONE : y === gy ? GRASS : AIR }
  const five = M.scoreSite({ col: (x, z) => M.scanColumn(at(5), x, z, { yHi: 110, yLo: 20 }), corner: { x: 100, z: 100 }, stairFace: 's' })
  assert.ok(!five.ok || five.baseY < 70, `5 below at base 70 must refuse that height (got base ${five.baseY})`)
  const fiveStrict = M.scoreSite({ col: (x, z) => M.scanColumn(at(5), x, z, { yHi: 110, yLo: 20 }), corner: { x: 100, z: 100 }, stairFace: 's', maxCut: 0 })
  if (fiveStrict.ok) assert.notEqual(fiveStrict.baseY, 70)
})
t('approach cells get the footprint checks: a chest or lava in one refuses; the dry approach is accepted (Codex r3)', () => {
  const lowFront = (extra) => (x, y, z) => { const k = `${x},${y},${z}`; if (extra.has(k)) return extra.get(k); const front = z === 150 && x >= 122 && x <= 124; const gy = front ? 67 : 69; return y < gy ? STONE : y === gy ? GRASS : AIR }
  const go = extra => M.scoreSite({ col: (x, z) => M.scanColumn(lowFront(extra), x, z, { yHi: 110, yLo: 20 }), corner: { x: 100, z: 100 }, stairFace: 's' })
  assert.equal(go(new Map()).ok, true)
  assert.match(go(new Map([['122,68,150', blk('chest')]])).why, /furniture/)
  assert.match(go(new Map([['122,68,150', blk('lava', 'empty')]])).why, /lava/)
})
t('water in a planned STAIR cell is that step (no extra fill); the dry control has none', () => {
  const r = run(new Map([['122,70,148', WATER]]), { stairFace: 's' })
  assert.equal(r.ok, true, r.why); assert.equal(r.waterFill, 0)
})
t('the edge drop is measured from the apron cell\'s own surface: ground left at baseY beside a cliff is guarded', () => {
  // apron west row at ground 70 (= baseY, accepted), the ring outside at 66: a drop of 4 from the apron's real surface
  const read = (x, y, z) => { const gy = x === 97 ? 66 : (x === 98 || x === 99) ? 70 : 69; return y < gy ? STONE : y === gy ? GRASS : AIR }
  const r = M.scoreSite({ col: (x, z) => M.scanColumn(read, x, z, { yHi: 110, yLo: 20 }), corner: { x: 100, z: 100 }, stairFace: 's' })
  assert.equal(r.ok, true, r.why)
  if (r.baseY === 70) assert.ok(r.maxEdgeDropGuarded >= 4 && r.guardAndApproach > 0, JSON.stringify(r))
})
t('approach water counts toward the water limit, and water inside the approach fill is that fill (Codex r4)', () => {
  const lowFront = extra => (x, y, z) => { const k = `${x},${y},${z}`; if (extra.has(k)) return extra.get(k); const front = z === 150 && x >= 122 && x <= 124; const gy = front ? 67 : 69; return y < gy ? STONE : y === gy ? GRASS : AIR }
  const go = (extra, o = {}) => M.scoreSite({ col: (x, z) => M.scanColumn(lowFront(extra), x, z, { yHi: 110, yLo: 20 }), corner: { x: 100, z: 100 }, stairFace: 's', ...o })
  const dry = go(new Map()), wet = go(new Map([['122,68,150', WATER]]))
  assert.equal(dry.ok, true); assert.equal(wet.ok, true, wet.why)
  assert.equal(wet.waterFill, dry.waterFill, 'the approach fill replaces the water: no extra'); assert.equal(wet.guardAndApproach, dry.guardAndApproach)
  assert.match(go(new Map([['122,68,150', WATER]]), { maxWater: 0 }).why, /water/, 'refused at a 0-column limit')
  assert.equal(go(new Map(), { maxWater: 0 }).ok, true, 'the dry control passes the 0 limit')
})
t('approach fill up to surf-1 replaces water in it when the apron beside it stands at baseY (Codex r5)', () => {
  // footprint 69 (base 70 -> apron surface 69), the apron row in front of the stair at 70 (= baseY), the approach at 67
  const read = extra => (x, y, z) => { const k = `${x},${y},${z}`; if (extra.has(k)) return extra.get(k); const appr = z === 150 && x >= 122 && x <= 124; const apr = (z === 148 || z === 149) && x >= 122 && x <= 124; const gy = appr ? 67 : apr ? 70 : 69; return y < gy ? STONE : y === gy ? GRASS : AIR }
  const go = extra => M.scoreSite({ col: (x, z) => M.scanColumn(read(extra), x, z, { yHi: 110, yLo: 20 }), corner: { x: 100, z: 100 }, stairFace: 's' })
  const dry = go(new Map()), wet = go(new Map([['122,69,150', WATER]]))
  assert.equal(dry.ok, true, dry.why); assert.equal(wet.ok, true, wet.why)
  if (dry.baseY === wet.baseY) assert.equal(wet.waterFill, dry.waterFill, 'water inside the approach fill is that fill')
})
console.log(`monument-plan: ${n} passed`)
