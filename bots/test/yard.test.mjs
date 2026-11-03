// STOCKYARD-01: THE TOWN STOCKPILE YARD (bots/src/yard.mjs; blueprints/yard@1.json; skills.mjs yardVisit / yardWorkNow wiring).
// Behaviour: the yard sited by the real planner on the fake flat world, its floor built end to end by the real visit runner, a whole
// bay's ramp pile placed by the runner on the fake server (every slot a stand reaches), a refill dug back top first, the aisle
// clutter cleared; the pure plan (bag surplus, clerk, refill, bays). STRUCTURAL source assertions only for the wiring (comments
// stripped, anchored on executable lines), each shown to fail by an anchored mutant.
import assert from 'node:assert'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
const { B, R, HOME, G, server, bot, plan, project } = await import('./helpers/buildfake.mjs')
const Y = await import('../src/yard.mjs')
const S = await import('../src/shop.mjs')

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 5).join('\n        ')}`) }
}
const YARD_PATH = new URL('../src/yard.mjs', import.meta.url)
async function withMutant (path, old, neu, fn) {
  const src = readFileSync(path, 'utf8')
  assert.ok(src.includes(old), `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 60))}`)
  assert.ok(src.split(old).length === 2, 'ANCHOR MISSING OR NOT UNIQUE')
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, src.replace(old, neu).replace(/from '\.\//g, "from '../src/"))
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}
const strip = src => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/[ \t]\/\/ .*$/gm, '')
const k3 = a => a.join(',')

const BP = B.loadBlueprint(Y.YARD_BLUEPRINT)
console.log('THE BLUEPRINT')
await t('an 18 x 15 paved floor, four 2 x 11 bays, eight lights; every aisle cell an interior cell to walk to', () => {
  assert.deepStrictEqual(BP.footprint, { u: 18, v: 15 })
  const pad = BP.cells.filter(c => c.y === 0)
  assert.strictEqual(pad.length, 18 * 15)
  for (let i = 0; i < 4; i++) assert.strictEqual(pad.filter(c => c.role === `bay${i}`).length, 22)
  assert.strictEqual(BP.cells.filter(c => c.role === 'light').length, 8)
  assert.ok(BP.palette.base.includes('cobblestone') && BP.palette.base.every(n => !/grass|dirt|_log|_leaves|sand/.test(n)), 'stone paving only: nothing roots on it')
  assert.strictEqual(BP.interior.length, 18 * 15 - 88 - 8)
})

const SITE = B.siteBlueprint(server().read, plan(), BP, { tries: 2, plot: Y.YARD_PLOT, earth: Y.YARD_EARTH })
const KITY = () => ({ cobblestone: 600, cobbled_deepslate: 200, torch: 8, bamboo_block: 40 })
const buildFresh = async () => {
  const srv = server(), { p } = project(SITE.record)
  const e = bot(srv, 'A', { inv: KITY() })
  const r = await R.runVisit({ ...p('A'), palette: BP.palette }, e, { maxSteps: 3000 })
  return { srv, e, r, p }
}
// the built yard's world, once (the suite runs this file under load: a full build per scenario passed 300 s on the CI host);
// every scenario gets its own copy of the cells and its own project directory
let BUILT = null
const built = async () => {
  if (!BUILT) { const b = await buildFresh(); BUILT = { cells: new Map(b.srv.cells), r: b.r } }
  const srv = server(Object.fromEntries(BUILT.cells)), { p } = project(SITE.record)
  return { srv, r: BUILT.r, p }
}
console.log('SITED AND BUILT (the real planner and visit runner, the fake server)')
await t('the planner sites the yard on flat ground and proves every aisle reachable', () => {
  assert.ok(SITE.ok, JSON.stringify(SITE.sectors?.map(s => [s.sector, s.screened, s.tried, s.proofFails])))
  assert.strictEqual(SITE.record.plot, Y.YARD_PLOT)
  assert.strictEqual(SITE.record.interior.open, SITE.record.interior.reachable)
})
await t('the floor and lights are built end to end: complete, 278 placements, each cell once', async () => {
  const { srv, r } = await buildFresh()
  BUILT = { cells: new Map(srv.cells), r }
  assert.strictEqual(r.stop, 'complete', JSON.stringify({ stop: r.stop, why: r.why, placed: r.placed }))
  assert.strictEqual(r.placed, 278)
  assert.ok([...srv.placedAt.values()].every(n => n === 1))
})

console.log('THE PILES')
const SLOTS = Y.pileSlots(SITE.record, BP)
await t('four bays of 76 slots: layer k on rows v0 + k - 1 .. v1, far end first; the highest stand 3 above the floor', () => {
  assert.strictEqual(SLOTS.length, 4)
  for (const b of SLOTS) assert.strictEqual(b.slots.length, 2 * (11 + 10 + 9 + 8))
  const ys = SLOTS[0].slots.map(s => s[1] - SITE.record.s)
  assert.deepStrictEqual([...new Set(ys)], [1, 2, 3, 4])
  for (let i = 1; i < ys.length; i++) assert.ok(ys[i] >= ys[i - 1], 'bottom layer first')
  assert.ok(Y.YARD_H - 1 <= 3, 'a fall from the highest stand costs nothing')
  const floor = new Set(SITE.record.cells.filter(c => c.role === 'bay0').map(c => `${c.at[0]},${c.at[2]}`))
  assert.ok(SLOTS[0].slots.every(s => floor.has(`${s[0]},${s[2]}`)), 'bay 0 piles over its own floor')
})
const bayRun = async (H) => {
  const { srv, p } = await built()
  const states = Y.bayStates(H ?? SLOTS, srv.read)
  const pc = Y.pileCells(states, { cobblestone: 76 })
  const e = bot(srv, 'A', { inv: { cobblestone: 200 } })
  const rec = { ...SITE.record, cells: pc.cells, segments: [{ seg: 'pile', layer: 0, deps: [] }], clear: [], replant: [] }
  const r = await R.runVisit({ ...p('A'), record: rec, palette: { ...BP.palette, ...pc.palette } }, e, { maxSteps: 3000 })
  return { srv, r, pc, p }
}
await t('A WHOLE BAY of cobblestone, placed by the runner: 76 placed, every slot a stand reached (the ramp is walkable)', async () => {
  const { srv, r, pc } = await bayRun()
  assert.strictEqual(pc.cells.length, 76); assert.strictEqual(pc.bays.cobblestone, 0)
  assert.strictEqual(r.stop, 'complete'); assert.strictEqual(r.placed, 76, JSON.stringify({ stop: r.stop, why: r.why, placed: r.placed }))
  const st = Y.bayStates(SLOTS, srv.read)
  assert.strictEqual(st[0].name, 'cobblestone'); assert.strictEqual(st[0].filled, 76); assert.strictEqual(st[0].free, 0)
  assert.strictEqual(st[1].name, null); assert.strictEqual(Y.yardHeld(st).cobblestone, 76)
})
await t('MUTANT KILLED: a flat stack (no ramp) leaves the layers above the eye with no stand', async () => {
  await withMutant(YARD_PATH, 'for (let v = v1; v >= v0 + (k - 1); v--) {', 'for (let v = v1; v >= v0; v--) {', async M => {
    const flat = M.pileSlots(SITE.record, BP)
    const { srv, p } = await built()
    const pc = M.pileCells(M.bayStates(flat, srv.read), { cobblestone: 88 })
    const e = bot(srv, 'A', { inv: { cobblestone: 200 } })
    const rec = { ...SITE.record, cells: pc.cells, segments: [{ seg: 'pile', layer: 0, deps: [] }], clear: [], replant: [] }
    const r = await R.runVisit({ ...p('A'), record: rec, palette: { ...BP.palette, ...pc.palette } }, e, { maxSteps: 3000 })
    assert.ok(r.placed < 88, `the flat stack placed ${r.placed} of 88`)
  })
})
await t('a second name goes to the next empty bay; a full yard takes nothing more', async () => {
  const { srv } = await bayRun()
  let st = Y.bayStates(SLOTS, srv.read)
  const pc = Y.pileCells(st, { cobblestone: 10, cobbled_deepslate: 20 })
  assert.strictEqual(pc.bays.cobblestone, 1, 'bay 0 is full: the overflow takes the next empty bay'); assert.strictEqual(pc.bays.cobbled_deepslate, 2)
  // every slot of every bay filled: no room
  for (const b of SLOTS) for (const s of b.slots) srv.set(s, 'cobblestone')
  st = Y.bayStates(SLOTS, srv.read)
  assert.strictEqual(Y.yardRoomFor(st, 'cobblestone'), 0)
  assert.strictEqual(Y.pileCells(st, { cobblestone: 64 }).cells.length, 0)
})
await t('A REFILL digs the top of the pile back, highest first, under the clear lease', async () => {
  const { srv, p } = await bayRun()
  const st = Y.bayStates(SLOTS, srv.read)
  const digs = Y.refillDigs(st, { cobblestone: 20 })
  assert.strictEqual(digs.length, 20)
  assert.ok(digs.slice(0, 16).every(d => d.at[1] === SITE.record.s + 4), 'the top layer first (2 x 8)')
  for (let i = 1; i < digs.length; i++) assert.ok(digs[i].at[1] <= digs[i - 1].at[1], 'never below a cell still to dig')
  const rec = { ...SITE.record, cells: [], segments: [], clear: [], replant: [] }
  const r = await R.runVisit({ ...p('A'), record: rec, palette: BP.palette, tidy: digs, clearMax: 64 }, bot(srv, 'A', { inv: {} }), { maxSteps: 400 })
  assert.strictEqual(r.cleared, 20, JSON.stringify({ stop: r.stop, why: r.why }))
  assert.strictEqual(Y.yardHeld(Y.bayStates(SLOTS, srv.read)).cobblestone, 56)
})
await t('THE AISLES: leaves, a sapling and a stray table over the aisle floor are listed and cleared; torches and chests stay', async () => {
  const { srv, p } = await built()
  const aisle = SITE.record.cells.filter(c => c.role === 'base')
  const at = i => [aisle[i].at[0], aisle[i].at[1] + 1, aisle[i].at[2]]
  srv.set([aisle[40].at[0], aisle[40].at[1] + 2, aisle[40].at[2]], 'oak_leaves')
  srv.set(at(60), 'oak_sapling'); srv.set(at(80), 'crafting_table'); srv.set(at(100), 'chest')
  const cl = Y.yardClutter(SITE.record, srv.read)
  assert.deepStrictEqual(cl.map(c => c.name).sort(), ['crafting_table', 'oak_leaves', 'oak_sapling'])
  const rec = { ...SITE.record, cells: [], segments: [], clear: [], replant: [] }
  const r = await R.runVisit({ ...p('A'), record: rec, palette: BP.palette, tidy: cl, clearMax: Y.YARD_CLEAR_MAX }, bot(srv, 'A', { inv: {} }), { maxSteps: 200 })
  assert.strictEqual(r.cleared, 3)
  assert.deepStrictEqual(Y.yardClutter(SITE.record, srv.read), [])
  assert.strictEqual(srv.read(...at(100)).name, 'chest')
})

console.log('THE PLAN (pure)')
const empty = () => Y.bayStates(SLOTS, (x, y, z) => ({ name: 'air' }))
await t('the bag keeps 128 of the cobble family, cobblestone first; every bamboo block goes; bamboo above 64 becomes blocks', () => {
  assert.deepStrictEqual(Y.bagSurplus({ cobblestone: 394, cobbled_deepslate: 92 }), { cobblestone: 266, cobbled_deepslate: 92 })
  assert.deepStrictEqual(Y.bagSurplus({ cobblestone: 50, cobbled_deepslate: 100 }), { cobbled_deepslate: 22 })
  assert.deepStrictEqual(Y.bagSurplus({ cobblestone: 100, dirt: 300, bamboo_block: 5 }), { bamboo_block: 5 })
  assert.strictEqual(Y.bambooBlocks({ bamboo: 398 }), 37); assert.strictEqual(Y.bambooBlocks({ bamboo: 70 }), 0)
})
await t('stock: a stack of surplus is a visit, bounded by YARD_VISIT_MAX; urgent when the bag is under pressure', () => {
  const w = Y.yardWork({ held: { cobblestone: 563 }, slots: 34, states: empty() })
  assert.strictEqual(w.kind, 'stock'); assert.strictEqual(w.urgent, true); assert.deepStrictEqual(w.place, { cobblestone: Y.YARD_VISIT_MAX })
  assert.strictEqual(Y.yardWork({ held: { cobblestone: 563 }, slots: 20, states: empty() }).urgent, false)
  assert.strictEqual(Y.yardWork({ held: { cobblestone: 150 }, slots: 20, states: empty() }).kind, null, 'a partial stack frees no slot: no trip')
})
await t('the clerk: chests above their keep are drawn and placed; a town unknown is never guessed', () => {
  const w = Y.yardWork({ held: {}, slots: 10, freeSlots: 26, town: { cobblestone: 700 }, states: empty() })
  assert.strictEqual(w.kind, 'clerk'); assert.deepStrictEqual(w.draw, { cobblestone: 64 })
  assert.strictEqual(Y.yardWork({ held: {}, slots: 10, freeSlots: 26, town: { cobblestone: 350 }, states: empty() }).kind, null, '30 over the keep: no trip')
  assert.strictEqual(Y.yardWork({ held: {}, slots: 10, freeSlots: 26, town: null, states: empty() }).kind, null)
})
await t('the refill: a town below its build reserve gets cobblestone dug back when the piles hold it; none when they are empty', () => {
  const some = Y.bayStates(SLOTS, (x, y, z) => ({ name: SLOTS[0].slots.slice(0, 50).some(s => s[0] === x && s[1] === y && s[2] === z) ? 'cobblestone' : 'air' }))
  const w = Y.yardWork({ held: {}, slots: 10, freeSlots: 26, town: { cobblestone: 100 }, states: some })
  assert.strictEqual(w.kind, 'refill'); assert.deepStrictEqual(w.dig, { cobblestone: Y.YARD_REFILL_MAX })
  assert.strictEqual(Y.yardWork({ held: {}, slots: 10, freeSlots: 26, town: { cobblestone: 100 }, states: empty() }).kind, null)
})
await t('a refill needs a pickaxe in the bag (a cobblestone dug by hand drops nothing); the cheapest usable one is the tool', () => {
  const some = Y.bayStates(SLOTS, (x, y, z) => ({ name: SLOTS[0].slots.slice(0, 50).some(s => s[0] === x && s[1] === y && s[2] === z) ? 'cobblestone' : 'air' }))
  assert.strictEqual(Y.yardWork({ held: {}, slots: 10, freeSlots: 26, town: { cobblestone: 100 }, states: some, pick: false }).kind, null)
  const left = i => i.left
  const items = [{ name: 'iron_pickaxe', left: 200 }, { name: 'stone_pickaxe', left: 1 }, { name: 'stone_pickaxe', left: 90 }, { name: 'wooden_pickaxe', left: 1 }]
  assert.deepStrictEqual(Y.refillPick(items, left), { name: 'stone_pickaxe', left: 90 })
  assert.strictEqual(Y.refillPick([{ name: 'stone_pickaxe', left: 1 }], left), null)
  assert.strictEqual(Y.refillPick([{ name: 'cobblestone', left: 9 }], left), null)
})
await t('a full yard turns a surplus into no trip (never a visit that cannot place)', () => {
  const full = Y.bayStates(SLOTS, () => ({ name: 'cobblestone' }))
  assert.strictEqual(Y.yardWork({ held: { cobblestone: 563 }, slots: 34, states: full }).kind, null)
})
await t('the order: a full bag is never refused for room at the yard (it is why the yard visit exists); any other project still is', () => {
  const base = { on: true, shared: true, atTown: true, holds: false, now: 1e9, state: {}, slotsFree: true, health: 20, complete: false }
  assert.deepStrictEqual(S.buildOrder({ ...base, record: { plot: Y.YARD_PLOT }, freeSlots: 0 }).order, { skill: 'build_shop', args: {} })
  assert.strictEqual(S.buildOrder({ ...base, record: { plot: 'monument' }, freeSlots: 0 }).skip, 'room')
})
await t('the switch: on in the showcase pool by default, off elsewhere; YARD=on|off wins', () => {
  assert.strictEqual(Y.yardOn({}, 'showcase'), true); assert.strictEqual(Y.yardOn({}, 'board-a'), false)
  assert.strictEqual(Y.yardOn({ YARD: 'on' }, 'board-a'), true); assert.strictEqual(Y.yardOn({ YARD: 'off' }, 'showcase'), false)
})

console.log('THE ORDER SEES THE WORK (skills.mjs shopDamaged: the order reads `complete` through it -- Claude r1 BLOCK 1)')
const SKM = await import('../src/skills.mjs')
const yardBot = async (stacks) => {
  const { srv } = await built()
  const items = stacks.map((c, i) => ({ name: 'cobblestone', count: c, slot: 9 + i }))
  return { srv, bot: { username: 'A', blockAt: v => { const b = srv.read(v.x, v.y, v.z); return b ? { name: b.name, boundingBox: b.boundingBox } : null }, inventory: { items: () => items } } }
}
const done = { ...SITE.record, structure_complete: true }
await t('a complete yard and a bag with a stack of surplus: the order reads it NOT complete (build_shop is offered); a light bag: complete', async () => {
  const { bot: full } = await yardBot([64, 64, 64, 64, 64, 64, 64, 64, 51])
  assert.strictEqual(SKM.shopDamaged(full, done), true)
  const { bot: light } = await yardBot([64, 36])
  assert.strictEqual(SKM.shopDamaged(light, done), false)
})
await t('MUTANT KILLED: without the yard branch in recordDamaged (r0), the full bag reads complete and the order offers nothing', async () => {
  await withMutant(new URL('../src/skills.mjs', import.meta.url), '    if (tidy && isYardBlueprint(r.blueprint) && yardWorkNow(bot, r)?.kind) return true', '    if (false) return true', async M => {
    const { bot: full } = await yardBot([64, 64, 64, 64, 64, 64, 64, 64, 51])
    assert.strictEqual(M.shopDamaged(full, done), false)
  })
})
await t('a visit that did nothing RESTS the work (yardRestUntil): the same bag reads complete until it ends', async () => {
  const { bot: full } = await yardBot([64, 64, 64, 64, 64, 64, 64, 64, 51])
  full.yardRestUntil = Date.now() + 60_000
  assert.strictEqual(SKM.shopDamaged(full, done), false)
})

console.log('THE WIRING (skills.mjs, structural)')
const SK = strip(readFileSync(new URL('../src/skills.mjs', import.meta.url), 'utf8'))
const W1 = /if \(plot === YARD_PLOT && rec\.structure_complete && !recordDamaged\(bot, rec, \{ tidy: false \}\)\) return yardVisit\(ctx, rec, rh\.head\.gen, signal, out, t0\)/
const W2 = /const yw = complete && b && p\.plot === YARD_PLOT \? yardWorkNow\(b, rec\) : null\n\s*const damaged = complete && b \? \(recordDamaged\(b, rec, \{ tidy: tidyFirst \}\) \|\| !!yw\?\.urgent\) : false/
const W3 = /plot, \.\.\.\(plot === YARD_PLOT \? \{ earth: YARD_EARTH \} : \{\}\) \}/
const W4 = /fx = \{ \.\.\.effects, dig: async \(c, expect\) => \{\n\s*const pk = refillPick\(bot\.inventory\?\.items\?\.\(\) \?\? \[\], remaining\)\n\s*if \(!pk\) return 'refused'/
await t('a complete yard gets its own visit; its urgent stock goes first; its siting names its earthwork; a refill digs with a pickaxe', () => {
  for (const re of [W1, W2, W3, W4]) { assert.ok(re.test(SK), String(re).slice(0, 60)); assert.strictEqual(SK.split(SK.match(re)[0]).length, 2, 'unique') }
})
await t('MUTANTS KILLED: each wiring check fails on its line one character off', () => {
  for (const re of [W1, W2, W3, W4]) { const m = SK.match(re)[0]; assert.ok(!re.test(SK.replace(m, m.replace(/[A-Za-z]/, '#')))) }
})

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
