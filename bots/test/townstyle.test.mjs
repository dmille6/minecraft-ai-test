// TOWNSTYLE-01: the style library (townstyle.mjs), the cottage (cottage.mjs, blueprints cottage@1s/f) and the state-bearing build
// (buildsite.mjs stepFor's aim, buildrun.mjs cellDone with a state, the misoriented cell's `reorient` dig, buildbot.mjs's aimed click).
// Behaviour first: what a click on a face makes (orientAim against a small VANILLA model of the 1.21 rules, the rules the Paper proof
// sandbox/townstyle/orient-proof.mjs measured 312/312), the roof's geometry, a whole cottage sited and BUILT on the fake server with
// every stair's facing right, a misoriented stair taken down and placed again. Mutants assert their anchor is present and unique.
import assert from 'node:assert'
import fs from 'node:fs'
import { EventEmitter } from 'node:events'

const T = await import('../src/townstyle.mjs')
const C = await import('../src/cottage.mjs')
const BB = await import('../src/buildbot.mjs')
const F = await import('./helpers/buildfake.mjs')
const { B, R, PJ, G, HOME, k3, withMutant } = F

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 6).join('\n        ')}`) }
}

// ---- A SMALL VANILLA: what the server makes of one click (Minecraft 1.21 BlockItem placement, as measured on Paper 1.21.8) ----------
const FACING = { '1,0': 'east', '-1,0': 'west', '0,1': 'south', '0,-1': 'north' }
const yawFacing = yaw => { const d = ((Math.round(yaw / 90) % 4) + 4) % 4; return ['south', 'west', 'north', 'east'][d] }
const OPP = { north: 'south', south: 'north', east: 'west', west: 'east' }
/** -> the placed block's properties. `face` the clicked face's normal, `cursorY` on the support (0..1), `yaw` the server's yaw. */
export function vanilla (name, face, cursorY, yaw) {
  const side = face[1] === 0
  const top = face[1] < 0 || (side && cursorY > 0.5)
  if (/_stairs$/.test(name)) return { facing: yawFacing(yaw), half: top ? 'top' : 'bottom', shape: 'straight', waterlogged: false }
  if (/_slab$/.test(name)) return { type: top ? 'top' : 'bottom', waterlogged: false }
  if (/_log$/.test(name)) return { axis: face[1] !== 0 ? 'y' : face[0] !== 0 ? 'x' : 'z' }
  if (/_trapdoor$/.test(name)) return side ? { facing: FACING[`${face[0]},${face[2]}`], half: top ? 'top' : 'bottom', open: false, powered: false, waterlogged: false } : { facing: OPP[yawFacing(yaw)], half: face[1] > 0 ? 'bottom' : 'top', open: false, powered: false, waterlogged: false }
  if (/^lantern$/.test(name)) return { hanging: face[1] < 0, waterlogged: false }
  return {}
}

console.log('ORIENTATION: WHAT ONE CLICK MAKES')
await t('orientAim: every stair state from every face it can come from, checked against the vanilla rule', () => {
  const faces = [[0, 1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]]
  let made = 0
  for (const facing of ['north', 'east', 'south', 'west']) for (const half of ['bottom', 'top']) for (const f of faces) {
    const aim = T.orientAim('spruce_stairs', { facing, half }, f)
    if (half === 'top' && f[1] > 0) { assert.strictEqual(aim, null, 'a top face never makes a top half'); continue }
    assert.ok(aim, `${facing}/${half} from ${f}`)
    const got = vanilla('spruce_stairs', f, aim.cursor[1], aim.yaw)
    assert.ok(T.stateOk(got, { facing, half }), `${facing}/${half} from ${f}: vanilla made ${JSON.stringify(got)}`)
    made++
  }
  assert.strictEqual(made, 36)
})
await t('orientAim: slabs by the cursor\'s height, never double; logs by the face\'s axis; trapdoors from a side face only', () => {
  assert.strictEqual(T.orientAim('oak_slab', { type: 'top' }, [0, 1, 0]), null)
  assert.strictEqual(vanilla('oak_slab', [1, 0, 0], T.orientAim('oak_slab', { type: 'top' }, [1, 0, 0]).cursor[1], 0).type, 'top')
  assert.strictEqual(vanilla('oak_slab', [1, 0, 0], T.orientAim('oak_slab', { type: 'bottom' }, [1, 0, 0]).cursor[1], 0).type, 'bottom')
  assert.strictEqual(T.orientAim('oak_slab', { type: 'double' }, [0, 1, 0]), null)
  assert.ok(T.orientAim('spruce_log', { axis: 'y' }, [0, 1, 0]))
  assert.strictEqual(T.orientAim('spruce_log', { axis: 'y' }, [1, 0, 0]), null)
  assert.ok(T.orientAim('spruce_log', { axis: 'x' }, [-1, 0, 0]))
  assert.strictEqual(T.orientAim('spruce_log', { axis: 'z' }, [-1, 0, 0]), null)
  assert.strictEqual(T.orientAim('spruce_trapdoor', { facing: 'north', half: 'top', open: false }, [0, 1, 0]), null)
  assert.strictEqual(T.orientAim('spruce_trapdoor', { facing: 'north', half: 'top', open: false }, [0, 0, 1]), null, 'facing is the clicked face: a south face makes south')
  const a = T.orientAim('spruce_trapdoor', { facing: 'north', half: 'top', open: false }, [0, 0, -1])
  assert.ok(T.stateOk(vanilla('spruce_trapdoor', [0, 0, -1], a.cursor[1], 0), { facing: 'north', half: 'top', open: false }))
  assert.strictEqual(T.orientAim('lantern', { hanging: true }, [0, 1, 0]), null)
  assert.ok(T.orientAim('lantern', { hanging: false }, [0, 1, 0]))
  assert.deepStrictEqual(T.orientAim('stone_bricks', null, [1, 0, 0]), { yaw: null, cursor: [1, 0.5, 0.5] }, 'a plain block: the face centre, any yaw')
})
await t('worldState: a local facing and axis turn with the record; half/type/open pass through', () => {
  // rot: E (u,v)->(x,z); S (u,v)->(-v,u); W (-u,-v); N (v,-u)
  assert.deepStrictEqual(T.worldState({ facing: '+v', half: 'bottom' }, 'E'), { facing: 'south', half: 'bottom' })
  assert.deepStrictEqual(T.worldState({ facing: '+v' }, 'S'), { facing: 'west' })
  assert.deepStrictEqual(T.worldState({ facing: '+v' }, 'W'), { facing: 'north' })
  assert.deepStrictEqual(T.worldState({ facing: '+v' }, 'N'), { facing: 'east' })
  assert.deepStrictEqual(T.worldState({ facing: '-u', open: false }, 'N'), { facing: 'south', open: false })
  assert.deepStrictEqual(T.worldState({ axis: 'u' }, 'S'), { axis: 'z' })
  assert.deepStrictEqual(T.worldState({ axis: 'y' }, 'S'), { axis: 'y' })
  assert.strictEqual(T.worldState(null, 'E'), null)
  assert.strictEqual(T.stateKey('oak_stairs', { half: 'top', facing: 'north' }), 'oak_stairs[facing=north,half=top]')
  assert.strictEqual(T.stateTag({ half: 'top', facing: 'north' }), 'north/top')
})
await t('stateOk / cellDone: the named properties only; booleans as the world reports them; no state -> the name rule alone', () => {
  const pal = { roof: ['spruce_stairs'] }
  const b = props => ({ name: 'spruce_stairs', boundingBox: 'block', props })
  const ws = { facing: 'north', half: 'bottom' }
  assert.strictEqual(R.cellDone(b({ facing: 'north', half: 'bottom', shape: 'outer_left', waterlogged: false }), pal, 'roof', ws), true)
  assert.strictEqual(R.cellDone(b({ facing: 'south', half: 'bottom' }), pal, 'roof', ws), false, 'facing away')
  assert.strictEqual(R.cellDone(b({ facing: 'north', half: 'top' }), pal, 'roof', ws), false, 'upside down')
  assert.strictEqual(R.cellDone(b(null), pal, 'roof', ws), false, 'unread properties are never done')
  assert.strictEqual(R.cellDone(b(null), pal, 'roof'), true, 'no state named: the name rule as before')
  assert.strictEqual(R.cellDone({ name: 'oak_stairs', props: { facing: 'north', half: 'bottom' } }, pal, 'roof', ws), false, 'the name rule first')
  assert.strictEqual(R.cellDone({ name: 'spruce_trapdoor', props: { facing: 'north', half: 'top', open: false } }, { s: ['spruce_trapdoor'] }, 's', { facing: 'north', half: 'top', open: false }), true)
})

console.log('THE ROOF AND THE COTTAGE')
await t('gableRoof: courses one up and one in, stairs face the ridge, an odd span ends in a slab ridge, the gables fill under it', () => {
  const box = { u0: 1, u1: 5, v0: 1, v1: 5 }
  for (const ridge of ['u', 'v']) {
    const cells = T.gableRoof(box, 3, { ridge, over: 1 })
    const s = ridge === 'u' ? 'v' : 'u', r = ridge
    const roof = cells.filter(c => c.role === 'roof'), top = cells.filter(c => c.role === 'ridge'), gab = cells.filter(c => c.role === 'gable')
    assert.strictEqual(roof.length, 42); assert.strictEqual(top.length, 7); assert.strictEqual(gab.length, 8)
    for (const c of roof) {
      const d = Math.min(c[s] - 0, 6 - c[s])
      assert.strictEqual(c.y, 3 + d, 'one up per course')
      assert.strictEqual(c.st.facing, c[s] < 3 ? `+${s}` : `-${s}`, 'the tall side toward the ridge')
      assert.strictEqual(c.st.half, 'bottom')
      assert.ok(c[r] >= 0 && c[r] <= 6, 'one block of overhang at the gable ends')
    }
    assert.ok(top.every(c => c.y === 6 && c[s] === 3 && c.st.type === 'bottom'))
    // every gable cell is under a roof cell of its column, on an end wall line
    for (const g of gab) {
      assert.ok([1, 5].includes(g[r]), 'on an end wall')
      assert.ok(cells.some(c => (c.role === 'roof' || c.role === 'ridge') && c.u === g.u && c.v === g.v && c.y === g.y + 1) || gab.some(o => o.u === g.u && o.v === g.v && o.y === g.y + 1), 'under the roof')
    }
  }
})
await t('the cottage blueprints on disk are the generator\'s (make-cottage.mjs) and keep the house plot\'s footprint and an open doorway', () => {
  for (const v of ['s', 'f']) {
    const disk = JSON.parse(fs.readFileSync(new URL(`../src/blueprints/cottage@1${v}.json`, import.meta.url), 'utf8'))
    assert.deepStrictEqual(disk, JSON.parse(JSON.stringify(T.cottageBlueprint(v))), `cottage@1${v}.json is stale: node bots/scripts/make-cottage.mjs`)
    const at = new Set(disk.cells.map(c => `${c.u},${c.v},${c.y}`))
    for (const [u, w, y] of disk.doorway) assert.ok(!at.has(`${u},${w},${y}`), 'the doorway stays open')
    assert.ok(disk.cells.every(c => disk.palette[c.role]), 'every role has a palette')
    assert.ok(disk.cells.every(c => c.u >= 0 && c.u < 7 && c.v >= 0 && c.v < 7), 'inside the 7 x 7 pad')
    assert.ok(Math.max(...disk.cells.map(c => c.y)) === 6, 'the ridge at y 6')
  }
})
await t('styleOf / stylePalette: the town\'s most-stocked log builds the walls, a contrasting stocked wood the roof; one wood per roof', () => {
  const town = { spruce_log: 400, dark_oak_log: 30, oak_log: 12, stone_bricks: 340, cobblestone: 930 }
  const st = T.styleOf(town, { key: 'showcase/cottage1/X3', need: C.COTTAGE_NEED, variants: ['s', 'f'] })
  assert.strictEqual(st.wood, 'spruce'); assert.strictEqual(st.roof, 'dark_oak')
  assert.strictEqual(T.styleOf({ spruce_log: 400, dark_oak_log: 5 }, { need: C.COTTAGE_NEED }).roof, 'spruce', 'too few of the contrast: the wall wood')
  assert.strictEqual(T.styleOf({}, {}).wood, 'oak', 'no logs at all: oak (the bill then waits for wood)')
  assert.strictEqual(T.styleOf({ spruce_log: 93, oak_log: 23 }, { need: C.COTTAGE_NEED }).roof, 'spruce', 'THE SHOWCASE 11-04 (93 spruce, 23 oak): oak is lighter than spruce -- the roof is the walls\' spruce')
  assert.strictEqual(T.styleOf({ oak_log: 93, spruce_log: 23 }, { need: C.COTTAGE_NEED }).roof, 'spruce', 'oak walls take a darker spruce roof')
  assert.strictEqual(T.styleOf(town, { key: 'k', variants: ['s', 'f'] }).variant, T.styleOf(town, { key: 'k', variants: ['s', 'f'] }).variant, 'the seed is stable')
  const variants = new Set(['X3', 'X4', 'X5', 'X6', 'X7', 'X8'].map(id => T.styleOf(town, { key: `showcase/cottage1/${id}`, variants: ['s', 'f'] }).variant))
  assert.strictEqual(variants.size, 2, 'plots differ: both variants occur')
  const pal = T.stylePalette(T.cottageBlueprint('s').palette, st)
  assert.deepStrictEqual(pal.roof, ['dark_oak_stairs']); assert.deepStrictEqual(pal.ridge, ['dark_oak_slab']); assert.deepStrictEqual(pal.post, ['spruce_log'])
  assert.deepStrictEqual(pal.wall, ['spruce_planks', '$planks'])
})
await t('woodPartsPlan: whole recipes of each part beyond what is had, and the planks of its species', () => {
  const p = T.woodPartsPlan({ dark_oak_stairs: 42, dark_oak_slab: 7, spruce_trapdoor: 4, cobblestone: 60, spruce_planks: 25 }, { have: n => (n === 'dark_oak_stairs' ? 2 : 0) })
  assert.deepStrictEqual(p.crafts, [{ item: 'dark_oak_stairs', count: 40 }, { item: 'dark_oak_slab', count: 12 }, { item: 'spruce_trapdoor', count: 4 }])
  assert.deepStrictEqual(p.planks, { dark_oak_planks: 60 + 6, spruce_planks: 12 })
  assert.strictEqual(T.woodPartsPlan({ cobblestone: 5 }), null)
})

// ---- the cottage sited and built on the fake server ---------------------------------------------------------------------------
const STYLE = { wood: 'spruce', roof: 'dark_oak', stone: 'cobblestone' }
const sited = v => {
  const bp = C.styledBlueprint(B.loadBlueprint(`cottage@1${v}`), STYLE)
  const s = B.siteBlueprint(F.server().read, F.plan(), bp, { tries: 3, plot: 'cottage1' })
  return { bp, s }
}
await t('the cottage SITES on flat ground in both variants: every roof cell has a stand and a face that makes its state (the proof)', () => {
  for (const v of ['s', 'f']) {
    const { bp, s } = sited(v)
    assert.ok(s.ok, `${v}: ${s.why} ${JSON.stringify(s.sectors?.map(r => r.proofEx))}`)
    const oriented = s.record.cells.filter(c => c.ws)
    assert.strictEqual(oriented.length, 42 + 7 + 12 + bp.cells.filter(c => c.role === 'sill').length, 'every stair, slab, post and sill carries its world state')
    for (const c of oriented) {
      const name = R.roleFirst(bp.palette, c.role)
      assert.ok(T.orientAim(name, c.ws, c.face), `${v} ${c.role}@${c.at}: the proof's face makes ${JSON.stringify(c.ws)}`)
    }
    // the upper courses are reached from INSIDE (under the open attic), the eaves from outside
    const ridge = s.record.cells.filter(c => c.role === 'ridge')
    assert.ok(ridge.some(c => c.stand[1] === s.record.s + 1), 'a ridge cell is placed from the floor')
  }
})

/** A bot on the fake server whose clicks the SMALL VANILLA judges: the yaw is the aim's, else the bot's look toward the face. */
function vanillaBot (srv, name, { inv, feet = [2, G + 1, 0], aimless = false } = {}) {
  const e = F.bot(srv, name, { inv, feet })
  const props = srv.props ??= new Map()
  const read0 = srv.read
  srv.read = (x, y, z) => { const b = read0(x, y, z); return b ? { ...b, props: props.get(k3([x, y, z])) ?? null } : b }
  e.read = srv.read
  let held = null
  const hold = e.hold
  e.hold = async n => { const ok = await hold(n); if (ok) held = n; return ok }
  const send = e.send
  e.send = (support, face, seq, aim = null) => {
    const target = support.map((q, i) => q + face[i])
    const before = srv.read(...target)?.name
    const at = e.feet()
    // the look toward the face (what the current actuator sends): its horizontal direction is the yaw
    const dx = support[0] + 0.5 + face[0] * 0.5 - (at[0] + 0.5), dz = support[2] + 0.5 + face[2] * 0.5 - (at[2] + 0.5)
    const lookYaw = Math.abs(dx) >= Math.abs(dz) ? (dx > 0 ? -90 : 90) : (dz > 0 ? 0 : 180)
    const yaw = !aimless && Number.isFinite(aim?.yaw) ? aim.yaw : lookYaw
    const cursorY = !aimless && Array.isArray(aim?.cursor) ? aim.cursor[1] : 0.5 + face[1] * 0.5
    send(support, face, seq)
    if (before === 'air' && held) props.set(k3(target), vanilla(held, face, cursorY, yaw))
  }
  const dig = e.dig
  e.dig = async (c, expect) => { const r = await dig(c, expect); if (r === 'confirmed') props.delete(k3(c)); return r }
  return e
}
const COTTAGE_KIT = () => ({ cobblestone: 128, spruce_planks: 64, spruce_log: 16, glass_pane: 8, dark_oak_stairs: 48, dark_oak_slab: 12, spruce_trapdoor: 8, torch: 4 })
async function buildCottage (v, { aimless = false, Mod = R, pre = null } = {}) {
  const { bp, s } = sited(v)
  const srv = F.server()
  const pr = F.project(s.record)
  if (pre) pre(srv, s.record)
  const e = vanillaBot(srv, 'A', { inv: COTTAGE_KIT(), aimless })
  let r = null
  for (let i = 0; i < 6; i++) {
    const h = PJ.recordHead(pr.dir, pr.key)
    r = await Mod.runVisit({ ...pr.p('A'), record: h.head.rec, recordGen: h.head.gen, palette: bp.palette, ...C.cottageVisitOpts(h.head.rec) }, e, { maxSteps: 6000 })
    if (r.stop === 'complete') break
  }
  const done = s.record.cells.filter(c => R.cellDone(srv.read(...c.at), bp.palette, c.role, c.ws)).length
  return { r, done, total: s.record.cells.length, e, srv, rec: s.record, bp }
}
await t('a WHOLE COTTAGE is built on the fake server (vanilla placement rules): complete, every stair facing its ridge', async () => {
  for (const v of ['s', 'f']) {
    const { r, done, total, e, srv, rec } = await buildCottage(v)
    assert.strictEqual(r.stop, 'complete', `${v}: ${r.stop} ${r.why ?? ''} ${done}/${total}`)
    assert.strictEqual(done, total)
    const stairs = rec.cells.filter(c => c.role === 'roof')
    assert.ok(stairs.every(c => srv.read(...c.at).props.facing === c.ws.facing), 'every stair as recorded')
    // the place rows say the state they made
    const rows = e.logs.filter(([k, d]) => k === '_build' && d.op === 'place' && d.st)
    assert.strictEqual(rows.length, rec.cells.filter(c => c.ws).length)
  }
})
await t('POSITIVE CONTROL: the same build with the CURRENT actuator (no aim: the look toward the face) never completes the roof', async () => {
  const { r, done, total } = await buildCottage('s', { aimless: true })
  assert.notStrictEqual(r.stop, 'complete', 'the instrument can see a wrong state')
  assert.ok(done < total)
})
await t('a MISORIENTED stair in a roof cell is dug (`reorient`) and placed again, aimed', async () => {
  const { r, e, srv } = await buildCottage('s', {
    pre: (sv, rec) => {
      const c = rec.cells.find(q => q.role === 'roof' && q.seg === 'roof-edge')
      sv.set(c.at, 'dark_oak_stairs')
      ;(sv.props ??= new Map()).set(k3(c.at), { facing: { north: 'south', south: 'north', east: 'west', west: 'east' }[c.ws.facing], half: 'bottom' })
    },
  })
  assert.strictEqual(r.stop, 'complete', `${r.stop} ${r.why ?? ''}`)
  const re = e.logs.filter(([k, d]) => k === '_build' && d.op === 'clear' && d.kind === 'reorient')
  assert.strictEqual(re.length, 1, 'one reorient dig')
  assert.ok(srv.placedAt.get(k3(re[0][1].cell)) >= 1, 'placed again')
})
await t('MUTANT the aim dropped from the send: the roof never completes', () => withMutant(
  "        e.send(here.support, here.face, seq, here.aim ?? null)",
  "        e.send(here.support, here.face, seq)", async M => {
    const { r } = await buildCottage('s', { Mod: M })
    assert.notStrictEqual(r.stop, 'complete')
  }))
await t('MUTANT the state dropped from cellDone: a misoriented stair reads done (the roof completes wrong)', () => withMutant(
  "  if (ws) return stateOk(propsOf(b), ws)\n",
  "", async M => {
    const pal = { roof: ['spruce_stairs'] }
    assert.strictEqual(M.cellDone({ name: 'spruce_stairs', props: { facing: 'south', half: 'bottom' } }, pal, 'roof', { facing: 'north', half: 'bottom' }), true, 'the mutant cannot see it')
    const { r, e } = await buildCottage('s', { Mod: M, aimless: true })
    assert.strictEqual(r.stop, 'complete', 'the mutant calls a wrong roof complete')
    assert.ok(!e.logs.some(([k, d]) => d?.kind === 'reorient'))
  }))
await t('MUTANT the reorient dig dropped: a misoriented stair blocks its cell for good', () => withMutant(
  "  const misorientedAt = c => { if (!c.ws) return false;",
  "  const misorientedAt = c => { if (c.ws) return false;", async M => {
    const { r } = await buildCottage('s', {
      Mod: M,
      pre: (sv, rec) => { const c = rec.cells.find(q => q.role === 'roof' && q.seg === 'roof-edge'); sv.set(c.at, 'dark_oak_stairs'); (sv.props ??= new Map()).set(k3(c.at), { facing: 'up', half: 'top' }) },
    })
    assert.notStrictEqual(r.stop, 'complete')
  }))

/** A mutant of a src module (anchor present and unique), imported from the test directory. */
async function withSrcMutant (file, old, neu, fn) {
  const url = new URL(`../src/${file}`, import.meta.url)
  const src = fs.readFileSync(url, 'utf8')
  assert.strictEqual(src.split(old).length, 2, `ANCHOR MISSING OR NOT UNIQUE in ${file}: ${JSON.stringify(old.slice(0, 70))}`)
  const out = new URL(`./_mutant-ts-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  fs.writeFileSync(out, src.replace(old, neu).replace(/from '\.\//g, "from '../src/"))
  try { return await fn(await import(out.href)) } finally { try { fs.unlinkSync(out) } catch {} }
}
const siteWith = (Bm, v = 's') => Bm.siteBlueprint(F.server().read, F.plan(), C.styledBlueprint(B.loadBlueprint(`cottage@1${v}`), STYLE), { tries: 3, plot: 'cottage1' })
await t('MUTANT the reach-only rule dropped (buildsite stepFor): the cottage has no proven site -- its upper courses are above every eye', () => withSrcMutant('buildsite.mjs',
  "    const blind = !!want?.blind", "    const blind = false", async Bm => {
    assert.ok(siteWith(B).ok, 'control: the real module sites it')
    const s = siteWith(Bm)
    assert.strictEqual(s.ok, false)
    assert.ok(JSON.stringify(s.sectors).includes('no_step'), JSON.stringify(s.sectors).slice(0, 200))
  }))
await t('MUTANT the state filter dropped (buildsite stepFor): the proof picks a face that cannot make a sill\'s state', () => withSrcMutant('buildsite.mjs',
  "    if (want?.ws && !aim) continue\n", "", async Bm => {
    const s = siteWith(Bm, 's')
    assert.ok(s.ok)
    const pal = C.styledBlueprint(B.loadBlueprint('cottage@1s'), STYLE).palette
    const wrong = s.record.cells.filter(c => c.ws && !T.orientAim(R.roleFirst(pal, c.role), c.ws, c.face))
    assert.ok(wrong.length > 0, 'a state cell whose recorded face cannot make its state')
  }))

console.log('THE AIMED CLICK ON THE WIRE (buildbot.mjs)')
await t('an aimed send writes the LOOK (the yaw) and then the block_place, in one synchronous write, the cursor at the half', () => {
  const writes = []
  const client = new EventEmitter(); client.write = (n, p) => writes.push([n, p])
  const bot = Object.assign(new EventEmitter(), { _client: client, entity: { position: { x: 0, y: 0, z: 0 }, pitch: 0.3, yaw: 0, onGround: true }, blockAt: () => null, inventory: { items: () => [] }, players: {} })
  const e = BB.botBuildEffects(bot, {})
  e.send([10, 70, 10], [1, 0, 0], 7, { yaw: 180, cursor: [1, 0.75, 0.5] })
  const mine = writes.filter(([n]) => n === 'look' || n === 'block_place')
  assert.deepStrictEqual(mine.map(([n]) => n), ['look', 'block_place'])
  assert.strictEqual(mine[0][1].yaw, 180)
  assert.strictEqual(mine[1][1].cursorY, 0.75); assert.strictEqual(mine[1][1].cursorX, 1); assert.strictEqual(mine[1][1].sequence, 7)
  writes.length = 0
  e.send([10, 70, 10], [0, 1, 0], 8)
  assert.deepStrictEqual(writes.filter(([n]) => n === 'look' || n === 'block_place').map(([n]) => n), ['block_place'], 'no aim: the click alone, as before')
  assert.strictEqual(writes.find(([n]) => n === 'block_place')[1].cursorY, 1)
  assert.ok(Math.abs(BB.yawRad(0) - Math.PI) < 1e-9 && Math.abs(BB.yawRad(180)) < 1e-9, 'the notchian yaw -> mineflayer radians')
  e.close()
})

console.log('THE PROJECT')
await t('the cottage waits for a house plot of the extension; takes the first one no other record holds; COTTAGE=off', () => {
  assert.strictEqual(C.cottageOpening(null).why, 'no_extension')
  const ext = { plots: [{ id: 'X1', kind: 'hall', box: [0, 0, 18, 12] }, { id: 'X3', kind: 'house', box: [30, 0, 40, 10] }, { id: 'X4', kind: 'house', box: [50, 0, 60, 10] }] }
  assert.strictEqual(C.cottageOpening(ext).plot.id, 'X3')
  assert.strictEqual(C.cottageOpening(ext, ['X3']).plot.id, 'X4')
  assert.strictEqual(C.cottageOpening(ext, ['X3', 'X4']).why, 'no_house_plot')
  assert.strictEqual(C.cottageOpening({ plots: [{ id: 'X3', kind: 'house', box: [0, 0, 7, 7] }] }).why, 'plot_8x8')
  assert.strictEqual(C.cottageSwitches({}, 'showcase').on, true)
  assert.strictEqual(C.cottageSwitches({}, 'hive-a').on, false)
  assert.strictEqual(C.cottageSwitches({ COTTAGE: 'off' }, 'showcase').on, false)
  assert.ok(C.isCottageBlueprint('cottage@1f') && C.isCottageBlueprint('cottage@1s') && !C.isCottageBlueprint('house@1'))
  const rec = { blueprint: 'cottage@1f', palette: { roof: ['oak_stairs'] } }
  assert.deepStrictEqual(C.recordPalette(rec, { palette: { roof: ['%roof_stairs'] } }), { roof: ['oak_stairs'] }, 'a styled record: its own palette')
  assert.deepStrictEqual(C.recordPalette({ blueprint: 'house@1', palette: { x: [] } }, { palette: { roof: ['$planks'] } }), { roof: ['$planks'] }, 'any other: the blueprint\'s')
})
await t('the cottage comes after the enchanting workshop in the order, and only with the extension\'s switches on', async () => {
  const S = await import('../src/shop.mjs')
  const p = S.PROJECTS.find(q => q.plot === 'cottage1')
  assert.ok(p && p.after === 'enchantshop')
  const on = S.projectsOn(true, false, true, true, false, false, false, true, false, false, false, false, [], false, true, true, false, true, false, true).map(q => q.plot)
  assert.ok(on.includes('cottage1'))
  const off = S.projectsOn(true, false, true, true, false, false, false, true, false, false, false, false, [], false, true, true, false, true, false, false).map(q => q.plot)
  assert.ok(!off.includes('cottage1'))
  const noEnch = S.projectsOn(true, false, true, true, false, false, false, true, false, false, false, false, [], false, true, true, false, false, false, true).map(q => q.plot)
  assert.ok(!noEnch.includes('cottage1'), 'the enchanting workshop off: no cottage')
})

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
