// THE GENERIC PLACEMENT BUILDER (builder.mjs): behaviour on voxel worlds -- the walk probe both ways, the click rules,
// bottom-up, bodies, the walk-back after a click, the offline proof on a small ziggurat (monument.mjs zigCells), and the
// executor's loop with every effect faked (fence last, two attempts, out of material, a stand re-proved on arrival).
// Mutants with unique anchors (treefarm-minewell's withMutant).
import assert from 'node:assert'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const BP = path.join(here, '../src/builder.mjs')
const B = await import('../src/builder.mjs')
const MON = await import('../src/monument.mjs')

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${String(e?.stack ?? e).split('\n').slice(0, 3).join('\n        ')}`) }
}
async function withMutant (file, old, neu, fn) {
  let src = fs.readFileSync(file, 'utf8')
  assert.ok(src.includes(old), `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 70))}`)
  assert.equal(src.split(old).length, 2, 'the mutation target is not unique; the mutant is ambiguous')
  src = src.replace(old, neu)
  const out = path.join(here, `.mutant-builder-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`)
  fs.writeFileSync(out, src.replace(/from '\.\//g, `from '${path.join(here, '../src')}/`))
  try { return await fn(await import(pathToFileURL(out))) } finally { try { fs.unlinkSync(out) } catch {} }
}

const AIR = { name: 'air', boundingBox: 'empty' }
const STONE = { name: 'stone', boundingBox: 'block' }
const COBBLE = { name: 'cobblestone', boundingBox: 'block' }
const WATER = { name: 'water', boundingBox: 'empty' }
const CHEST = { name: 'chest', boundingBox: 'block' }
const TORCH = { name: 'wall_torch', boundingBox: 'empty' }
/** A voxel world: ground (stone) below `g`, air above, `set` overrides; unloaded beyond `lim`. */
function world ({ g = 64, lim = 200 } = {}) {
  const m = new Map()
  const k = (x, y, z) => `${x},${y},${z}`
  const read = (x, y, z) => {
    if (Math.abs(x) > lim || Math.abs(z) > lim) return null
    const v = m.get(k(x, y, z)); if (v) return v
    return y < g ? STONE : AIR
  }
  return { read, set: (x, y, z, b) => m.set(k(x, y, z), b), get: (x, y, z) => read(x, y, z) }
}
const START = { x: 0, y: 64, z: 0 }
/** A 1-wide, 2-high dead-end tunnel x=1..6 at z=0 (floor 63, roof 66) through a solid mass, entered at grade from the west. */
function tunnel () {
  const w = world({ g: 64 })
  for (let x = 1; x <= 6; x++) for (let z = -1; z <= 1; z++) for (let y = 64; y <= 66; y++) w.set(x, y, z, (z === 0 && y < 66) ? AIR : STONE)
  for (let z = -1; z <= 1; z++) for (let y = 64; y <= 66; y++) w.set(7, y, z, STONE)
  return { w, start: { x: -1, y: 64, z: 0 }, box: { x0: -4, x1: 8, y0: 58, y1: 70, z0: -4, z1: 4 } }
}

await t('WALK: reach and reach-back agree on random worlds (walkReachBack(r, t).has(c) iff walkReach(r, c).has(t))', () => {
  let rng = 7
  const rand = () => { rng = (rng * 1103515245 + 12345) % 2147483648; return rng / 2147483648 }
  let checked = 0, positive = 0
  for (let trial = 0; trial < 6; trial++) {
    const w = world()
    for (let x = -5; x <= 5; x++) for (let z = -5; z <= 5; z++) { const h = Math.floor(rand() * 4); for (let y = 64; y < 64 + h; y++) w.set(x, y, z, STONE) }
    const box = { x0: -5, x1: 5, y0: 60, y1: 72, z0: -5, z1: 5 }
    const cells = []
    for (let x = -5; x <= 5; x++) for (let z = -5; z <= 5; z++) for (let y = 64; y <= 68; y++) if (B.standable(w.read, x, y, z)) cells.push({ x, y, z })
    const tgt = cells[Math.floor(rand() * cells.length)]
    const back = B.walkReachBack(w.read, tgt, { box })
    for (const c of cells) {
      const fwd = B.walkReach(w.read, c, { box }).has(B.bk(tgt.x, tgt.y, tgt.z))
      assert.equal(back.has(B.bk(c.x, c.y, c.z)), fwd, `trial ${trial} ${c.x},${c.y},${c.z} -> ${tgt.x},${tgt.y},${tgt.z}`)
      checked++; if (fwd) positive++
    }
  }
  assert.ok(checked > 300 && positive > 50 && positive < checked, `both answers occur (${positive}/${checked})`)
})

await t('CLICK: supports are below then sides, never above; a chest is no support; a top face needs the eye above it', () => {
  const w = world()
  const cell = { x: 3, y: 64, z: 0 }
  w.set(3, 65, 0, STONE)                               // above: never a support
  w.set(4, 64, 0, CHEST)                               // a chest beside: never a support
  w.set(3, 64, 1, STONE)                               // a side support
  const s = B.supportsFor(w.read, cell)
  assert.deepEqual(s.map(x => x.face), [[0, 1, 0], [0, 0, -1]], 'the top face of the ground below, then the stone side; not the chest, not above')
  const reach = B.walkReach(w.read, START, { box: { x0: -8, x1: 8, y0: 60, y1: 70, z0: -8, z1: 8 } })
  const stand = B.standFor(w.read, { target: cell, point: B.faceCentre(s[0].ref, s[0].face), topFace: true, reach })
  assert.ok(stand && stand.y + B.EYE_HEIGHT > 64, 'a top-face stand has its eye above the face')
  // a cell in a pit 3 deep: the top face of its floor is below every reachable eye only if the stand is above; a stand IN the
  // pit next to it (feet 62) would have the eye at 63.62 > 62 -- fine; check the rule itself directly
  assert.equal(B.standOk(w.read, { stand: { x: 3, y: 64, z: -2 }, target: { x: 3, y: 66, z: -1 }, point: { x: 3.5, y: 66, z: -0.5 }, topFace: true, start: START }), 'below the top face')
})

await t('NEXT: bottom-up in every column; a body in the cell or the cell above waits; no work -> nothing_to_do', () => {
  const w = world()
  const box = { x0: -8, x1: 8, y0: 60, y1: 72, z0: -8, z1: 8 }
  const todo = [{ x: 3, y: 65, z: 0 }, { x: 3, y: 64, z: 0 }]
  const n = B.nextPlacement(w.read, { todo, start: START, box })
  assert.deepEqual([n.step.cell.x, n.step.cell.y], [3, 64], 'the lower cell first, though listed second')
  const nb = B.nextPlacement(w.read, { todo: [{ x: 3, y: 64, z: 0 }], start: START, box, bodies: [{ x: 3.5, y: 65, z: 0.5 }] })
  assert.equal(nb.step, null, 'a body whose feet are in the cell above blocks it'); assert.match(nb.stuck[0], /body/)
  const nc = B.nextPlacement(w.read, { todo: [{ x: 3, y: 64, z: 0 }], start: START, box, bodies: [{ x: 5.5, y: 64, z: 5.5 }] })
  assert.ok(nc.step, 'positive control: a body elsewhere does not')
  assert.equal(B.nextPlacement(w.read, { todo: [], start: START, box }).why, 'nothing_to_do')
})

await t('NEXT: a placement that would wall its builder in is never chosen (the trench); the open-ended one is', () => {
  const { w, start, box } = tunnel()
  assert.ok(B.walkReach(w.read, start, { box }).has(B.bk(6, 64, 0)), 'positive control: the tunnel end is reachable')
  assert.ok(B.walkReachBack(w.read, start, { box }).has(B.bk(6, 64, 0)), '...and walks back')
  // filling the tunnel cell at x=2 from a stand east of it (where the bot prefers to be) would cut the stand off from the start
  const n = B.nextPlacement(w.read, { todo: [{ x: 2, y: 64, z: 0 }], start, box, prefer: { x: 4, y: 64, z: 0 } })
  assert.ok(n.step, 'it can be placed')
  assert.ok(n.step.stand.x < 2, `from the start side only (stand ${JSON.stringify(n.step.stand)})`)
})

await t('MUTANT KILLED: without the after-click walk-back, the trench cell is placed from the far side (walled in)', async () => {
  await withMutant(BP, '    const usable = { has: k => r.has(k) && back.has(k) }\n', '    const usable = r\n', async m => {
    const { w, start, box } = tunnel()
    const n = m.nextPlacement(w.read, { todo: [{ x: 2, y: 64, z: 0 }], start, box, prefer: { x: 4, y: 64, z: 0 } })
    assert.ok(n.step.stand.x > 2, 'the mutant stands beyond the cell it seals')
  })
})

await t('MUTANT KILLED: without the body check, a cell under a bystander is placed', async () => {
  await withMutant(BP, "    if (bodyBlocks(bodies, c)) { stuck.push(`${c.x},${c.y},${c.z}:body`); continue }\n", '', async m => {
    const w = world()
    const n = m.nextPlacement(w.read, { todo: [{ x: 3, y: 64, z: 0 }], start: START, box: { x0: -8, x1: 8, y0: 60, y1: 72, z0: -8, z1: 8 }, bodies: [{ x: 3.5, y: 65, z: 0.5 }] })
    assert.ok(n.step, 'the mutant places under the body')
  })
})

await t('MUTANT KILLED: without bottom-up, the upper cell of a column is taken first', async () => {
  await withMutant(BP, "    if (openCols.get(`${c.x},${c.z}`) < c.y) continue                     // bottom-up in every column\n", '', async m => {
    const w = world()
    w.set(4, 64, 0, STONE)                                  // a side support so the upper cell is placeable on its own
    w.set(4, 65, 0, STONE)
    const n = m.nextPlacement(w.read, { todo: [{ x: 3, y: 65, z: 0 }, { x: 3, y: 64, z: 0 }], start: START, box: { x0: -8, x1: 8, y0: 60, y1: 72, z0: -8, z1: 8 } })
    assert.equal(n.step.cell.y, 65)
  })
})

// ---- the offline proof on a small ziggurat ----------------------------------------------------------------------------

const G = Object.freeze({ B: 12, S: 3, H: 2, STAIR_W: 3, APRON: 2 })
await t('SEQUENCE: a 12-wide solid ziggurat on flat ground builds layer by layer from the apron; every step walks back; the result is the plan', () => {
  const w = world()
  const corner = { x: 4, z: -6 }
  const plan = MON.zigCells({ corner, baseY: 64, stairFace: 'w' }, G)
  const cells = plan.cells ?? plan
  assert.ok(Array.isArray(cells) && cells.length > 100, `the plan (${cells.length} cells)`)
  const box = { x0: -6, x1: 22, y0: 60, y1: 80, z0: -14, z1: 12 }
  const r = B.sequence(w.read, cells.map(c => ({ x: c.x, y: c.y, z: c.z, layer: c.layer })), { start: START, box })
  assert.equal(r.why, undefined, `no refusal: ${r.why} ${JSON.stringify(r.stuck)}`)
  assert.equal(r.steps.length, cells.length)
  // replay: each step's stand walks back to the start in the world with it placed; layers never go down by more than... one
  const placed = new Map()
  const rd = B.overlay(w.read, placed)
  let maxLayer = -1
  for (const s of r.steps) {
    const [x, y, z] = s.c
    assert.equal(B.standOk(rd, { stand: { x: s.s[0], y: s.s[1], z: s.s[2] }, target: { x, y, z }, point: B.faceCentre({ x: s.r[0], y: s.r[1], z: s.r[2] }, s.f), topFace: s.f[1] === 1, start: START, box }), null, `step ${x},${y},${z}`)
    placed.set(B.bk(x, y, z), B.PLACED)
    maxLayer = Math.max(maxLayer, y - 64)
  }
  for (const c of cells) assert.ok(B.solid(rd(c.x, c.y, c.z)), 'every planned cell is placed')
  assert.equal(maxLayer, Math.max(...cells.map(c => c.y - 64)), `it reached the top layer (${maxLayer})`)
})

await t('SEQUENCE: a blocked cell is named, never dug; water is never a placeable cell', () => {
  const w = world()
  w.set(3, 64, 0, CHEST)
  assert.equal(B.sequence(w.read, [{ x: 3, y: 64, z: 0 }], { start: START }).steps.length, 0, 'wanting ANY solid, the chest already counts')
  const r = B.sequence(w.read, [{ x: 3, y: 64, z: 0, want: 'cobblestone' }], { start: START })
  assert.equal(r.why, 'blocked'); assert.deepEqual(r.stuck, ['3,64,0'])
  const w2 = world(); w2.set(3, 64, 0, WATER)
  assert.equal(B.sequence(w2.read, [{ x: 3, y: 64, z: 0 }], { start: START }).why, 'blocked')
  const p = B.buildProgress(w.read, [{ x: 3, y: 64, z: 0, want: 'cobblestone' }, { x: 2, y: 64, z: 0 }, { x: 0, y: 63, z: 0 }, { x: 999, y: 64, z: 0 }])
  assert.deepEqual([p.done, p.open, p.blocked, p.unknown], [1, 1, 1, 1], 'ground is done, air is open, a chest is blocked, unloaded is unknown')
  const t2 = world(); t2.set(3, 64, 0, TORCH)
  assert.equal(B.buildProgress(t2.read, [{ x: 3, y: 64, z: 0 }]).blocked, 1, 'a wall torch is not done and not replaceable')
})

// ---- the executor ------------------------------------------------------------------------------------------------------

function exec (w, { verdicts = null, material = Infinity, fenceAt = Infinity, bodiesAt = () => [] } = {}) {
  let feet = { ...START }, clicks = 0, fences = 0, held = 0
  const log = []
  return {
    log,
    run: (cells, extra = {}) => B.runPlacements({
      read: w.read, cells, start: START, box: { x0: -10, x1: 20, y0: 58, y1: 80, z0: -14, z1: 14 },
      feet: () => feet, bodies: () => bodiesAt(clicks),
      walkTo: async s => { log.push(`walk ${s.x},${s.y},${s.z}`); feet = { ...s } },
      hold: async () => { if (held >= material) return false; held++; return true },
      fence: () => { fences++; return fences < fenceAt },
      click: async s => {
        clicks++
        const v = verdicts ? verdicts(s, clicks) : 'confirmed'
        if (v === 'confirmed') w.set(s.cell.x, s.cell.y, s.cell.z, COBBLE)
        log.push(`click ${s.cell.x},${s.cell.y},${s.cell.z} ${v}`)
        return v
      },
      ...extra,
    }),
  }
}

await t('EXECUTOR: a 3x3 pad completes, every placement confirmed by the (fake) server; a re-run does nothing', async () => {
  const w = world()
  const cells = []; for (let x = 3; x <= 5; x++) for (let z = -1; z <= 1; z++) cells.push({ x, y: 64, z, want: 'cobblestone' })
  const e = exec(w)
  const r = await e.run(cells)
  assert.equal(r.stop, 'complete'); assert.equal(r.placed, 9)
  const again = await exec(w).run(cells)
  assert.equal(again.stop, 'complete'); assert.equal(again.placed, 0)
})

await t('EXECUTOR: a refused cell is tried at most twice, then left for the next visit; the rest still builds', async () => {
  const w = world()
  const cells = [{ x: 3, y: 64, z: 0 }, { x: 3, y: 64, z: 2 }]
  const e = exec(w, { verdicts: s => (s.cell.z === 0 ? 'refused' : 'confirmed') })
  const r = await e.run(cells)
  assert.equal(r.refused, 2); assert.equal(r.placed, 1)
  assert.equal(r.stop, 'no_step'); assert.equal(e.log.filter(l => l.startsWith('click 3,64,0')).length, 2)
})

await t('EXECUTOR: the fence is asked last before every click; a lost fence mutates nothing; out of material stops before the click', async () => {
  const w = world()
  const e = exec(w, { fenceAt: 2 })
  const r = await e.run([{ x: 3, y: 64, z: 0 }, { x: 3, y: 64, z: 2 }])
  assert.equal(r.stop, 'fence'); assert.equal(r.placed, 1); assert.equal(e.log.filter(l => l.startsWith('click')).length, 1)
  const w2 = world()
  const e2 = exec(w2, { material: 0 })
  const r2 = await e2.run([{ x: 3, y: 64, z: 0 }])
  assert.equal(r2.stop, 'no_material'); assert.equal(e2.log.filter(l => l.startsWith('click')).length, 0)
})

await t('EXECUTOR: a stand the bot did not reach is re-proved where it is -- never a click from out of reach', async () => {
  const w = world()
  let clicks = 0
  const r = await B.runPlacements({
    read: w.read, cells: [{ x: 8, y: 64, z: 0 }], start: START, feet: () => START,       // the walk never moves it
    walkTo: async () => {}, hold: async () => true, fence: () => true, click: async () => { clicks++; return 'confirmed' },
  })
  assert.equal(clicks, 0); assert.equal(r.unreachable, 2, 'two attempts, both refused on arrival')
})

await t('MUTANT KILLED: the fence moved after the click -- a lost lease still mutates', async () => {
  await withMutant(BP, "    if (!fence()) { out.stop = 'fence'; break }\n    const v = await click(s)\n",
    "    const v = await click(s)\n    if (!fence()) { out.stop = 'fence'; break }\n", async m => {
      const w = world()
      let clicks = 0
      await m.runPlacements({ read: w.read, cells: [{ x: 3, y: 64, z: 0 }], start: START, feet: () => ({ x: 1, y: 64, z: 0 }),
        walkTo: async () => {}, hold: async () => true, fence: () => false, click: async () => { clicks++; return 'confirmed' } })
      assert.equal(clicks, 1, 'the mutant clicked without the fence')
    })
})

await t('MUTANT KILLED: the arrival re-proof removed -- the bot clicks from where it stopped, out of reach', async () => {
  await withMutant(BP, "    if (bad) { out.unreachable++; fail(c, `stand:${bad}`); continue }\n", '', async m => {
    const w = world()
    let clicks = 0
    await m.runPlacements({ read: w.read, cells: [{ x: 8, y: 64, z: 0 }], start: START, feet: () => START, maxSteps: 3,
      walkTo: async () => {}, hold: async () => true, fence: () => true, click: async () => { clicks++; return 'refused' } })
    assert.ok(clicks > 0)
  })
})

console.log(`\n${pass} passed, ${fail} failed`); if (fail) process.exit(1)
