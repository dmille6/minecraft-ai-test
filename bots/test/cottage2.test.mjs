// COTTAGE2-01 (owner 11-08 "charm and uniqueness ... chests and beds"): the generated family (every look builds, beds pair with their heads,
// mirrored looks are mirrors), the orientation of beds and chests, the look a new cottage takes (never a neighbour's twin), the
// furnishing's wait, the wool, and OFFLINE BUILDS on the fake vanilla (a furnished cottage completes with every state right; with no wool,
// no flower and no lantern it completes WITHOUT them and they wait). Anchored mutants for the head rule, the chest yaw and the wait.
import assert from 'node:assert'

const T = await import('../src/townstyle.mjs')
const C = await import('../src/cottage.mjs')
const K = await import('../src/cottage2.mjs')
const F = await import('./helpers/buildfake.mjs')
const { B, R, PJ, G, k3, withMutant } = F
const { vanilla, vanillaBot, withSrcMutant } = await import('./helpers/townstylefake.mjs')

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 6).join('\n        ')}`) }
}
const D = { north: [0, 0, -1], south: [0, 0, 1], east: [1, 0, 0], west: [-1, 0, 0] }
const OPP = { north: 'south', south: 'north', east: 'west', west: 'east' }
const yawFacing = yaw => ['south', 'west', 'north', 'east'][((Math.round(yaw / 90) % 4) + 4) % 4]

// ---- the family ------------------------------------------------------------------------------------------------------------
await t('every look generates: unique cells, 2 or 3 beds each paired with its head one cell toward +v, 1 or 2 chests, the doorway open', () => {
  const looks = K.allLooks()
  assert.strictEqual(looks.length, 24)
  assert.strictEqual(new Set(looks.map(K.lookCode)).size, 24)
  for (const l of looks) {
    const bp = K.cottage2Blueprint(l)
    assert.ok(K.isCottage2Blueprint(bp.id), bp.id)
    assert.strictEqual(new Set(bp.cells.map(c => `${c.u},${c.v},${c.y}`)).size, bp.cells.length, `${bp.id} duplicate cells`)
    const beds = bp.cells.filter(c => c.role === 'bed')
    assert.strictEqual(beds.length, l.body === 'L' ? 3 : 2, bp.id)
    assert.strictEqual(bp.cells.filter(c => c.role === 'chest').length, l.body === 'L' ? 2 : 1, bp.id)
    for (const f of beds) {
      const h = K.bedHeadOf(bp.cells, f)
      assert.ok(h && h.byFoot && h.u === f.u && h.v === f.v + 1 && h.y === f.y, `${bp.id} head of ${f.bed}`)
      assert.deepStrictEqual([f.st, h.st], [{ facing: '+v', part: 'foot' }, { facing: '+v', part: 'head' }])
    }
    for (const [u, v, y] of bp.doorway) assert.ok(!bp.cells.some(c => c.u === u && c.v === v && c.y === y), `${bp.id} doorway`)
    // the furnishing is the last segment; the roof never climbs past y 6
    assert.strictEqual(bp.segments.at(-1).seg, 'furnish')
    assert.ok(Math.max(...bp.cells.map(c => c.y)) <= 6, bp.id)
    assert.ok(B.loadBlueprint(bp.id).cells.length === bp.cells.length, 'loadBlueprint generates the family')
  }
})
await t('a mirrored look is the mirror image (u -> W-1-u, facings along u swapped)', () => {
  for (const l of K.allLooks().filter(x => !x.mirror)) {
    const a = K.cottage2Blueprint(l), b = K.cottage2Blueprint({ ...l, mirror: true })
    const W = a.footprint.u
    const sw = f => (f === '+u' ? '-u' : f === '-u' ? '+u' : f)
    const key = c => `${c.u},${c.v},${c.y},${c.role},${c.st?.facing ?? ''}`
    const mir = new Set(a.cells.map(c => key({ ...c, u: W - 1 - c.u, st: c.st ? { ...c.st, facing: sw(c.st.facing) } : null })))
    for (const c of b.cells) assert.ok(mir.has(key(c)), `${b.id} ${key(c)}`)
  }
})
await t('a chimney only on an eave front; a gable front has the awning (fence posts + a bottom-slab canopy), an eave front none', () => {
  for (const l of K.allLooks()) {
    const bp = K.cottage2Blueprint(l)
    assert.strictEqual(bp.cells.some(c => c.role === 'chimney'), l.chim)
    if (l.chim) assert.strictEqual(l.front, 's')
    assert.strictEqual(bp.cells.some(c => c.role === 'canopy'), l.front === 'f')
    if (l.front === 'f') assert.ok(bp.cells.filter(c => c.role === 'canopy').every(c => c.st?.type === 'bottom'), 'a hanging lantern needs a full underside (Paper 11-08)')
    // a hanging lantern hangs under a gable eave's stair or the canopy, never under the low roof's TOP slab eave
    for (const lamp of bp.cells.filter(c => c.role === 'lamp' && c.st?.hanging)) {
      const above = bp.cells.find(c => c.u === lamp.u && c.v === lamp.v && c.y === lamp.y + 1)
      assert.ok(above && (above.role === 'roof' || above.role === 'canopy'), `${bp.id} lamp at ${lamp.u},${lamp.v} hangs under ${above?.role}`)
      assert.ok(!(above.st?.type === 'top'), `${bp.id} never under a top slab`)
    }
  }
})

await t('the inside torch is never on a window (a pane refuses it: Paper 11-08) and never over a chest; a bed is never a support', () => {
  for (const l of K.allLooks()) {
    const bp = K.cottage2Blueprint(l)
    const light = bp.cells.find(c => c.role === 'light')
    const behind = bp.cells.find(c => c.u === light.u && c.v === light.v + 1 && c.y === light.y)
    assert.ok(behind && ['wall', 'post'].includes(behind.role), `${bp.id} light on ${behind?.role}`)
  }
  assert.strictEqual(B.refUsable({ name: 'white_bed', boundingBox: 'block' }), false, 'a bed is used, never clicked as a support')
  assert.strictEqual(B.refUsable({ name: 'stone', boundingBox: 'block' }), true)
})
await t('the order: cottage2 after cottage1 stands, cottage3 after cottage2; a later cottage takes the NEXT free house plot; COTTAGE2=off', async () => {
  const S = await import('../src/shop.mjs')
  const P = S.PROJECTS.filter(p => ['shop', 'cottage1', 'cottage2', 'cottage3'].includes(p.plot))
  const st = (plot, exists, complete = false) => ({ plot, exists, complete, damaged: false })
  assert.deepStrictEqual(P.map(p => [p.plot, p.after]), [['shop', undefined], ['cottage1', 'enchantshop'], ['cottage2', 'cottage1'], ['cottage3', 'cottage2']])
  const done = [st('shop', true, true), st('enchantshop', true, true)]
  assert.strictEqual(S.activeProject([...done, st('cottage1', true)], P, { noWait: false }).plot, 'cottage1', 'the first stands open: no second yet')
  assert.strictEqual(S.activeProject([...done, st('cottage1', true, true)], P, { noWait: false }).plot, 'cottage2', 'then the second')
  assert.strictEqual(S.activeProject([...done, st('cottage1', true, true), st('cottage2', true, true)], P, { noWait: false }).plot, 'cottage3')
  const ext = { plots: [{ id: 'X3', kind: 'house', box: [0, 0, 10, 10] }, { id: 'X4', kind: 'house', box: [20, 0, 30, 10] }, { id: 'X5', kind: 'house', box: [40, 0, 50, 10] }] }
  assert.strictEqual(C.cottageOpening(ext, ['X3']).plot.id, 'X4', 'cottage2: X3 is cottage1\'s')
  assert.strictEqual(C.cottageOpening(ext, ['X3', 'X4']).plot.id, 'X5')
  assert.strictEqual(C.cottageOpening(ext, ['X3', 'X4', 'X5']).open, false, 'no plot: it waits')
  assert.deepStrictEqual(C.cottage2Switches({}, 'showcase'), { on: true })
  assert.deepStrictEqual(C.cottage2Switches({}, 'hive-a'), { on: false }, 'the fleet: off until its port')
  assert.deepStrictEqual(C.cottage2Switches({ COTTAGE2: 'off' }, 'showcase'), { on: false })
  assert.ok(!S.projectsOn(true, true, true, true, true, true, true, true, true, true, true, true, undefined, true, true, true, true, true, true, true, true, true, true, true, true, false).some(p => ['cottage2', 'cottage3'].includes(p.plot)), 'COTTAGE2=off: never offered')
  assert.ok(S.projectsOn(true, true, true, true, true, true, true, true, true, true, true, true, undefined, true, true, true, true, true, true, true, true, true, true, true, true, true).some(p => p.plot === 'cottage2'), 'positive control: on, offered')
  assert.ok(S.projectsGuarded().some(p => p.plot === 'cottage2'), 'a sited later cottage stays guarded')
})
await t('wired (structural, comments stripped): the visit treats a waiting furnishing as done, bills no bed head, runs the shear errand; the registry names the cottage chests', async () => {
  const fs = await import('node:fs')
  const src = fs.readFileSync(new URL('../src/skills.mjs', import.meta.url), 'utf8').replace(/\/\/[^\n]*/g, '')
  for (const line of ["if (isCottage2Blueprint(rec.blueprint)) storeOpts.alsoDone = c => cottageCellWaits(bot, rec, c)",
    "const recB = cot2 ? { ...rec, cells: (rec.cells ?? []).filter(c => !c.byFoot && !cottageCellWaits(bot, rec, c)) } : rec",
    "&& cottageShearDueFor(bot, rec).due) return cottageShearVisit(ctx, rec, signal, out)",
    "setTownExtra(homeVec(), [...hubChestKeys(hubRecMemo, { on: HUB.on }), ...cottageKeys()])",
    "if (b && cottageCellWaits(bot, r, c)) continue"]) assert.strictEqual(src.split(line).length, 2, `wired once: ${line.slice(0, 70)}`)
})
// ---- orientation --------------------------------------------------------------------------------------------------------------
await t('a bed is clicked with the yaw OF its facing; a head is never clicked; a chest with the yaw OPPOSITE its facing (Paper 56/56)', () => {
  for (const f of ['north', 'south', 'east', 'west']) {
    assert.strictEqual(T.orientAim('white_bed', { facing: f, part: 'foot' }, [0, 1, 0]).yaw, T.YAW_OF[f])
    assert.strictEqual(T.orientAim('white_bed', { facing: f, part: 'head' }, [0, 1, 0]), null)
    assert.strictEqual(T.orientAim('chest', { facing: f }, [0, 1, 0]).yaw, T.YAW_OF[OPP[f]])
  }
  assert.ok(T.oriented('red_bed') && T.oriented('chest'))
})

// ---- the look a new cottage takes -------------------------------------------------------------------------------------------
await t('a new cottage differs from EVERY sited cottage in at least 2 axes (body, front, roof, chimney, wood), and the pick is stable', () => {
  const first = K.recordLook({ blueprint: 'cottage@1f', style: { wood: 'spruce' } })
  assert.deepStrictEqual(first, { body: 'C', front: 'f', roof: 'g', mirror: false, chim: false, wood: 'spruce' })
  for (const woods of [['spruce'], ['spruce', 'oak']]) for (const key of ['showcase/cottage2/X4', 'showcase/cottage3/X5', 'p/q/r']) {
    const a = K.cottageLookFor(key, woods, [first])
    assert.ok(K.lookDiff({ ...a.look, wood: a.wood }, first) >= 2, `${key} ${JSON.stringify(a)}`)
    assert.deepStrictEqual(K.cottageLookFor(key, woods, [first]), a, 'stable')
    const b = K.cottageLookFor(`${key}b`, woods, [first, { ...a.look, wood: a.wood }])
    assert.ok(K.lookDiff({ ...b.look, wood: b.wood }, first) >= 2 && K.lookDiff({ ...b.look, wood: b.wood }, { ...a.look, wood: a.wood }) >= 2)
  }
  assert.strictEqual(K.cottageLookFor('k', [], []), null, 'no wood, no cottage')
})
await t('the style of a later cottage: the wall wood a species the town holds 40 logs of; the roof darker when stocked; null with no wood', () => {
  const st = C.cottage2Style({ spruce_log: 505, oak_log: 76, stone_bricks: 358 }, { pool: 'showcase', plot: 'cottage2', plotId: 'X4', others: [{ blueprint: 'cottage@1f', style: { wood: 'spruce' } }] })
  assert.ok(['spruce', 'oak'].includes(st.style.wood))
  if (st.style.wood === 'oak') assert.strictEqual(st.style.roof, 'spruce', 'spruce is darker than oak')
  assert.ok(K.isCottage2Blueprint(st.id))
  assert.strictEqual(C.cottage2Style({ spruce_log: 10 }, { plot: 'cottage2', plotId: 'X4' }), null)
})

// ---- the furnishing's wait; the wool --------------------------------------------------------------------------------------------
await t('a furnishing WAITS while the bag + town cannot supply it: a bed without a bed or 3 wool of one colour, a flower, a lantern', () => {
  const cell = role => ({ role, seg: 'furnish' })
  const h = m => n => m[n] ?? 0
  assert.strictEqual(C.furnishWaits(cell('bed'), h({})), true)
  assert.strictEqual(C.furnishWaits(cell('bed'), h({ white_wool: 2, black_wool: 2 })), true, '2 + 2 of two colours is no bed')
  assert.strictEqual(C.furnishWaits(cell('bed'), h({ black_wool: 3 })), false)
  assert.strictEqual(C.furnishWaits(cell('bedhead'), h({ red_bed: 1 })), false)
  assert.strictEqual(C.furnishWaits(cell('flower'), h({})), true)
  assert.strictEqual(C.furnishWaits(cell('flower'), h({ fern: 1 })), false)
  assert.strictEqual(C.furnishWaits(cell('lamp'), h({ torch: 5 })), true)
  assert.strictEqual(C.furnishWaits(cell('lamp'), h({ torch: 5, iron_ingot: 1 })), false)
  assert.strictEqual(C.furnishWaits(cell('chest'), h({})), false, 'a chest never waits')
  assert.strictEqual(C.furnishWaits({ role: 'bed', seg: 'fit-out' }, h({})), false, 'only the furnish segment waits')
  assert.deepStrictEqual(C.bedColourFor(h({ white_wool: 3, black_wool: 7 })), { colour: 'black', wool: 'black_wool', bed: 'black_bed' })
  assert.strictEqual(C.bedColourFor(h({ white_wool: 2 })), null)
})
await t('the shear errand: due only with a bed owed AND waiting, shears, a sheep in sight, the rest over; the sheep byte read', () => {
  const base = { owed: 2, waiting: true, shears: true, sheep: 1, lastAt: 0, now: 1e9 }
  assert.strictEqual(C.shearDue(base).due, true)
  for (const [k, v, why] of [['owed', 0, 'no_bed_owed'], ['waiting', false, 'wool_in_town'], ['shears', false, 'no_shears'], ['sheep', 0, 'no_sheep_in_sight'], ['lastAt', 1e9 - 1000, 'rested']]) assert.strictEqual(C.shearDue({ ...base, [k]: v }).why, why)
  const meta = []; meta[16] = false; meta[17] = 15
  assert.deepStrictEqual(C.sheepWool(meta), { sheared: false, colour: 15 })
  meta[17] = 0x10 | 4
  assert.deepStrictEqual(C.sheepWool(meta), { sheared: true, colour: 4 })
})
await t('the cottage chests are town containers (chestfull setTownExtra keys); wool is never well junk', async () => {
  const bp = K.cottage2Blueprint('Lfg0-')
  const cells = B.placeBlueprint(bp, { x: 10, z: 10 }, G, 'N')
  assert.strictEqual(C.cottageChestKeys({ blueprint: bp.id, cells }).length, 2)
  const W = await import('../src/well.mjs')
  assert.strictEqual(W.isWellJunk('white_wool'), false)
  assert.strictEqual(W.isWellJunk('white_stained_glass'), true, 'positive control: a decoration is still junk')
})

await t('the furniture crafts are booked: a withdrawn name crafted away entirely is booked crafted (Codex r1 BLOCKER: G8 white_wool -6)', async () => {
  const S = await import('../src/shop.mjs')
  // the bag: nothing; drawn 6 white wool + 2 spruce logs; crafted 8 planks, 2 beds (6 wool + 6 planks); left 2 planks, 2 beds
  const pre = {}, post = { white_bed: 2, spruce_planks: 2 }, took = { white_wool: 6, spruce_log: 2 }
  const fc = C.furnitureCrafted(pre, post, took, {})
  assert.deepStrictEqual(fc, { white_bed: 2, spruce_planks: 2, white_wool: -6, spruce_log: -2 })
  if (typeof S.bagBalance === 'function') {
    const bb = S.bagBalance({ bag0: pre, took, crafted: fc, placed: {}, back: {}, bag1: post })
    for (const [n, v] of Object.entries(bb ?? {})) if (v && typeof v === 'object' && 'unexplained' in v) assert.strictEqual(v.unexplained, 0, `${n} unexplained ${v.unexplained}`)
  }
  // the control: the old union (bag snapshots only) leaves the wool and the logs unbooked
  const old = {}; for (const k of new Set([...Object.keys(pre), ...Object.keys(post)])) { const d = (post[k] ?? 0) - (pre[k] ?? 0) - (took[k] ?? 0); if (d) old[k] = d }
  assert.strictEqual(old.white_wool, undefined, 'positive control: the old booking misses the wool')
})
// ---- OFFLINE BUILDS on the fake vanilla ----------------------------------------------------------------------------------------
const STYLE = { wood: 'spruce', roof: 'dark_oak', stone: 'cobblestone' }
/** The fake vanilla with BEDS (the head one cell along the yaw's facing, refused when that cell is not air) and CHESTS (facing the
 *  yaw's opposite). */
function furnishBot (srv, inv) {
  const e = vanillaBot(srv, 'A', { inv })
  const props = srv.props
  const send = e.send
  let held = null
  const hold = e.hold
  e.hold = async n => { const ok = await hold(n); if (ok) held = n; return ok }
  e.send = (support, face, seq, aim = null) => {
    const target = support.map((q, i) => q + face[i])
    const yaw = Number.isFinite(aim?.yaw) ? aim.yaw : 0
    // VANILLA: a click on a BED is a sleep, never a placement (Paper 11-08)
    if (/_bed$/.test(srv.read(...support)?.name ?? '')) return send(support, [0, 0, 0], seq)
    if (held && /_bed$/.test(held) && srv.read(...target)?.name === 'air') {
      const f = yawFacing(yaw), head = target.map((q, i) => q + D[f][i])
      if (srv.read(...head)?.name !== 'air') return send(support, [0, 0, 0], seq)   // refused: nothing placed
      send(support, face, seq, aim)
      props.set(k3(target), { facing: f, part: 'foot', occupied: false })
      srv.set(head, held); props.set(k3(head), { facing: f, part: 'head', occupied: false })
      return
    }
    send(support, face, seq, aim)
    if (held === 'chest' && !props.get(k3(target))?.facing) props.set(k3(target), { facing: OPP[yawFacing(yaw)], type: 'single', waterlogged: false })
  }
  return e
}
const fullKit = bp => { const k = {}; for (const c of bp.cells) { if (c.byFoot) continue; let n = R.roleFirst(bp.palette, c.role); if (n === 'oak_planks') n = 'spruce_planks'; if (n) k[n] = (k[n] ?? 0) + 1 } for (const n of Object.keys(k)) k[n] += 8; return k }
async function buildLook (code, { kit = null, alsoDone = null, Mod = R, refuse = null } = {}) {
  const bp = C.styledBlueprint(B.loadBlueprint(`cottage@2-${code}`), STYLE)
  const s = B.siteBlueprint(F.server().read, F.plan(), bp, { tries: 3, plot: 'cottage2' })
  assert.ok(s.ok, `${code} sites on flat ground: ${s.why}`)
  const srv = F.server()
  const pr = F.project(s.record)
  const e = furnishBot(srv, kit ? kit(bp) : fullKit(bp))
  // `refuse(target)`: the server refuses a click into that cell (nothing placed: the slab-merge shape)
  if (refuse) { const send = e.send; e.send = (support, face, seq, aim = null) => (refuse(support.map((q, i) => q + face[i]), s.record) ? send(support, [0, 0, 0], seq, aim) : send(support, face, seq, aim)) }
  let r = null
  for (let i = 0; i < 6; i++) {
    const h = PJ.recordHead(pr.dir, pr.key)
    r = await Mod.runVisit({ ...pr.p('A'), record: h.head.rec, recordGen: h.head.gen, palette: bp.palette, ...C.cottageVisitOpts(h.head.rec), walkR: 48, ...(alsoDone ? { alsoDone } : {}) }, e, { maxSteps: 4000, barrierWaitMs: 50, deadline: Date.now() + 60_000 })
    if (r.stop === 'complete') break
  }
  const read = (x, y, z) => srv.read(x, y, z)
  const doneCells = s.record.cells.filter(c => R.cellDone(read(...c.at), bp.palette, c.role, c.ws))
  return { r, s, srv, e, bp, doneCells }
}
for (const code of ['Csg0c', 'Cfl1-', 'Lsg1c', 'Lfl0-']) {
  await t(`OFFLINE ${code}: a furnished cottage completes, every cell in its state (bed feet AND heads, chests facing the aisle)`, async () => {
    const { r, s, doneCells, e } = await buildLook(code)
    assert.strictEqual(r.stop, 'complete', `${r.stop} ${r.why ?? ''}`)
    assert.strictEqual(doneCells.length, s.record.cells.length, 'every cell done in its state')
    assert.ok(!e.logs.some(([k, d]) => k === '_build' && d.op === 'place' && s.record.cells.find(c => k3(c.at) === k3(d.cell))?.byFoot), 'no click into a bed head')
  })
}
await t('OFFLINE with NO wool, flower or lantern: the cottage completes WITHOUT them (they wait); with them later they are placed', async () => {
  const noFurn = bp => { const k = fullKit(bp); for (const n of Object.keys(k)) if (/_bed$/.test(n) || n === 'lantern' || K.BOX_PLANTS.includes(n)) delete k[n]; return k }
  const waits = c => C.furnishWaits(c, () => 0)
  const { r, s, srv, bp } = await buildLook('Csg0-', { kit: noFurn, alsoDone: c => waits(c) })
  assert.strictEqual(r.stop, 'complete', `${r.stop} ${r.why ?? ''}`)
  const waiting = s.record.cells.filter(c => waits(c))
  assert.ok(waiting.length >= 8, `beds, heads, flowers, lamps wait (${waiting.length})`)
  for (const c of waiting) assert.strictEqual(srv.read(...c.at)?.name, 'air', `${c.role} not placed`)
  assert.ok(s.record.cells.filter(c => c.role === 'chest').every(c => srv.read(...c.at)?.name === 'chest'), 'the chest never waits')
  void bp
})
// ---- anchored mutants ----------------------------------------------------------------------------------------------------------
await t('a bed whose FOOT the server refuses: no click ever lands in its head cell (the candidate rule and orientAim both refuse a head)', async () => {
  const refuse = (at, rec) => rec.cells.some(c => c.role === 'bed' && k3(c.at) === k3(at))
  const res = await buildLook('Csg0-', { refuse })
  assert.notStrictEqual(res.r.stop, 'complete', 'positive control: the refused feet keep the cottage open')
  assert.ok(res.e.logs.some(([k, d]) => k === '_build' && d.op === 'place'), 'the visit placed the rest')
  assert.ok(!res.e.logs.some(([k, d]) => k === '_build' && d.op === 'place' && res.s.record.cells.find(c => k3(c.at) === k3(d.cell))?.byFoot), 'no head clicked')
})
// MUTANT (run by hand 11-08, the anchor `|^lectern$|_bed$/` in buildsite.mjs USES cut to `|^lectern$/`): 5 of 21 failed -- the support
// rule above and three OFFLINE builds (Cfl1-, Lsg1c, Lfl0-), whose fake vanilla, like Paper, sleeps on a clicked bed
await t('Lsl1c (two beds side by side, the Paper 11-08 failure) completes on the fake vanilla that sleeps on a clicked bed', async () => {
  const { r } = await buildLook('Lsl1c')
  assert.strictEqual(r.stop, 'complete', `${r.stop} ${r.why ?? ''}`)
})
await t('MUTANT the head refusal dropped from orientAim: a head cell gets an aim (only the candidate rule would stand between)', () => withSrcMutant('townstyle.mjs',
  "    if (ws.part && ws.part !== 'foot') return null\n", '', async M => {
    assert.ok(M.orientAim('white_bed', { facing: 'north', part: 'head' }, [0, 1, 0]))
    assert.strictEqual(T.orientAim('white_bed', { facing: 'north', part: 'head' }, [0, 1, 0]), null)
  }))
await t('MUTANT the chest yaw not reversed: the chest lands facing the wrong way (never done in its state)', () => withSrcMutant('townstyle.mjs',
  'return { yaw: ws.facing ? YAW_OF[OPP_FACING[ws.facing]] : null, cursor: centre }',
  'return { yaw: ws.facing ? YAW_OF[ws.facing] : null, cursor: centre }', async M => {
    assert.strictEqual(M.orientAim('chest', { facing: 'north' }, [0, 1, 0]).yaw, M.YAW_OF.north, 'the mutant applied')
    const yaw = M.orientAim('chest', { facing: 'north' }, [0, 1, 0]).yaw
    assert.notStrictEqual(OPP[yawFacing(yaw)], 'north', 'the fake vanilla would face it south')
  }))
await t('MUTANT the bed wait inverted: a bed with 3 wool in town WAITS (the cottage would never get its beds)', () => withSrcMutant('cottage.mjs',
  "return !(BEDS.some(b => h(b) >= 1) || WOOLS.some(w => h(w) >= 3))",
  "return BEDS.some(b => h(b) >= 1) || WOOLS.some(w => h(w) >= 3)", async M => {
    assert.strictEqual(M.furnishWaits({ role: 'bed', seg: 'furnish' }, n => (n === 'white_wool' ? 3 : 0)), true)
    assert.notStrictEqual(M.furnishWaits({ role: 'bed', seg: 'furnish' }, n => (n === 'white_wool' ? 3 : 0)), C.furnishWaits({ role: 'bed', seg: 'furnish' }, n => (n === 'white_wool' ? 3 : 0)))
  }))
await t('MUTANT the head never pushed by the proof: the record has no head cell and the bed\'s head lands on an unlisted cell', () => withSrcMutant('buildsite.mjs',
  "      if (hd) {\n        over.set(", "      if (false) {\n        over.set(", async M => {
    const bp = C.styledBlueprint(M.loadBlueprint('cottage@2-Csg0-'), STYLE)
    const s = M.siteBlueprint(F.server().read, F.plan(), bp, { tries: 3, plot: 'cottage2' })
    assert.ok(!s.ok || !s.record.cells.some(c => c.byFoot), 'the mutant loses the head cells (or never sites)')
    const s0 = B.siteBlueprint(F.server().read, F.plan(), bp, { tries: 3, plot: 'cottage2' })
    assert.ok(s0.ok && s0.record.cells.filter(c => c.byFoot).length === 2, 'the real proof keeps both heads')
  }))

console.log(`\ncottage2: ${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
