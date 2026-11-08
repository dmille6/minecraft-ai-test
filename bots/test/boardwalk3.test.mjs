// BOARDWALK-03 (bots/src/boardwalk.mjs + buildrun.mjs `p.wet` + skills.mjs waterWalkVisit): the bots' dirt and cobble standing in
// the town's water -- PLANKS IN PLACE on a line the bots cross, DUG OUT far end first everywhere else; only cells the genesis
// evidence lists, only while the world still shows them. Behaviour on the fake server (test/helpers/buildfake.mjs), the visit run
// by the REAL runVisit; anchored mutants (CLAUDE.md) for the guards the scenarios rest on.
import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
const { R, PJ, G, HOME, k3, server, bot, withMutant: withRunMutant } = await import('./helpers/buildfake.mjs')
const W = await import('../src/boardwalk.mjs')
const W_PATH = new URL('../src/boardwalk.mjs', import.meta.url)

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 6).join('\n        ')}`) }
}
async function withMutant (old, neu, fn) {
  const src = readFileSync(W_PATH, 'utf8')
  assert.ok(src.includes(old), `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 70))}`)
  assert.ok(src.split(old).length === 2, 'ANCHOR MISSING OR NOT UNIQUE')
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, src.replace(old, neu).replace(/from '\.\//g, "from '../src/"))
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}
const killedBy = async (scenario, M) => { try { await scenario(M); return false } catch { return true } }

// ---- THE LAKE: water from x 5..14, z -3..3, two deep, at the ground's level G; the town (home 0) on the grass west of it, the far
// bank east of it (x >= 15). `line(x0, x1)` puts a dirt line along z = 0 -- the bots' old pathfinder bridge.
function lake (extra = {}, x1 = 14, zr = 3) {
  const cells = {}
  for (let x = 5; x <= x1; x++) for (let z = -zr; z <= zr; z++) for (const y of [G - 1, G]) cells[`${x},${y},${z}`] = 'water'
  return server({ ...cells, ...extra })
}
const lineCells = (x0, x1, name = 'dirt', y = G) => { const o = {}; for (let x = x0; x <= x1; x++) o[`${x},${y},0`] = name; return o }
const asLine = (x0, x1, { walk = false, name = 'dirt', id = 'L000' } = {}) => ({ id, walk, cells: Array.from({ length: x1 - x0 + 1 }, (_, i) => ({ at: [x0 + i, G, 0], name, row: false })) })
// the effects: a dig in the lake leaves WATER (the lake flows back); a click lands into water (the server replaces it)
function lakeBot (srv, name = 'A', opts = {}) {
  const e = bot(srv, name, { inv: { oak_planks: 64 }, feet: [1, G + 1, 0], ...opts })
  const ops = []
  e.dig = async (c, expect) => {
    if (expect && srv.read(...c)?.name !== expect) return 'refused'
    const wet = c[1] <= G
    srv.set(c, wet ? 'water' : 'air'); ops.push(['dig', k3(c), e.feet()]); return 'confirmed'
  }
  const send0 = e.send
  e.send = (support, face, seq) => {
    const target = support.map((v, i) => v + face[i])
    if (srv.read(...target)?.name === 'water') srv.set(target, 'air')   // the server replaces the water; the fake places into air
    ops.push(['place', k3(target), e.feet()])
    return send0(support, face, seq)
  }
  e.ops = ops
  return e
}
function visitP (record, name = 'A', extra = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bw3-'))
  const key = PJ.projKey(HOME, W.BW3_PLOT)
  const pub = PJ.publishRecord(dir, key, () => ({ ...record }))
  const slot = PJ.takeSlot(dir, key, name, 2)
  return { dir, key, me: name, home: HOME, stood: [], record, recordGen: pub.gen, palette: W.BW3_PALETTE, slot: slot.slot, slotGen: slot.gen,
    domain: () => true, walkR: 40, blockLayer: false, tidyKeepOrder: true, stuckStalledOnly: true, wet: true, ...extra }
}
const deckDone = (srv, rec) => rec.cells.every(c => R.cellDone(srv.read(...c.at), W.BW3_PALETTE, c.role))

const strip = s => s.split('\n').map(l => l.replace(/^\s*\/\/.*$/, '').replace(/\s\/\/ .*$/, '')).join('\n')
const SK = strip(fs.readFileSync(new URL('../src/skills.mjs', import.meta.url), 'utf8'))
console.log('THE EVIDENCE FILE')
const DOC = () => ({ v: 1, pool: 'hive-c', home: [0, G + 1, 0], generated: new Date().toISOString(), lines: [{ id: 'L000', walk: true, cells: [[5, G, 0, 'dirt'], [6, G, 0, 'grass_block', 1]] }] })
await t('a valid file reads ok; another pool, another home, a stale or future file, a non-bot material: refused WHOLE', async () => {
  const H = { x: 0.5, y: G + 1, z: 0.5 }
  const ok = W.bw3Evidence(DOC(), { pool: 'hive-c', home: H })
  assert.strictEqual(ok.ok, true); assert.strictEqual(ok.lines[0].cells[1].row, true); assert.strictEqual(ok.lines[0].walk, true)
  assert.strictEqual(W.bw3Evidence(DOC(), { pool: 'hive-d', home: H }).why, 'other_pool')
  assert.strictEqual(W.bw3Evidence(DOC(), { pool: 'hive-c', home: { x: 9, y: G + 1, z: 0 } }).why, 'other_home')
  assert.strictEqual(W.bw3Evidence({ ...DOC(), generated: new Date(Date.now() - 31 * 86400_000).toISOString() }, { pool: 'hive-c', home: H }).why, 'stale')
  assert.strictEqual(W.bw3Evidence({ ...DOC(), generated: new Date(Date.now() + 2 * 3600_000).toISOString() }, { pool: 'hive-c', home: H }).why, 'stale')
  const bad = DOC(); bad.lines[0].cells.push([7, G, 0, 'oak_planks'])
  assert.strictEqual(W.bw3Evidence(bad, { pool: 'hive-c', home: H }).why, 'malformed')
  assert.strictEqual(W.bw3Evidence(null, { pool: 'hive-c', home: H }).why, 'no_file')
})
await t('standingAs: the listed block, or the dirt family for a listed dirt (placed dirt greens); never another block, air or planks', async () => {
  const b = n => ({ name: n, boundingBox: n === 'air' ? 'empty' : 'block' })
  assert.strictEqual(W.standingAs(b('dirt'), 'dirt'), 'dirt')
  assert.strictEqual(W.standingAs(b('grass_block'), 'dirt'), 'grass_block')
  assert.strictEqual(W.standingAs(b('dirt'), 'grass_block'), 'dirt')
  assert.strictEqual(W.standingAs(b('stone'), 'cobblestone'), null)
  assert.strictEqual(W.standingAs(b('cobblestone'), 'dirt'), null)
  assert.strictEqual(W.standingAs(b('air'), 'dirt'), null)
  assert.strictEqual(W.standingAs(b('oak_planks'), 'dirt'), null)
  assert.strictEqual(W.standingAs(null, 'dirt'), null)
})
await t('EVERY SHIPPED FILE is self-consistent: its own pool and home pass, every cell a bot material within r of home, ids unique', async () => {
  const dirp = new URL('../src/waterstrays/', import.meta.url)
  const files = fs.readdirSync(dirp).filter(f => f.endsWith('.json'))
  assert.ok(files.length >= 16, `${files.length} files (the 16 fleet pools)`)
  let cells = 0
  for (const f of files) {
    const d = JSON.parse(fs.readFileSync(new URL(f, dirp), 'utf8'))
    assert.strictEqual(d.pool, f.replace(/\.json$/, ''))
    const home = { x: d.home[0], y: d.home[1], z: d.home[2] }
    const ev = W.bw3Evidence(d, { pool: d.pool, home, now: Date.parse(d.generated) + 1000 })
    assert.strictEqual(ev.ok, true, `${f}: ${ev.why}`)
    assert.strictEqual(new Set(d.lines.map(l => l.id)).size, d.lines.length)
    for (const l of ev.lines) for (const c of l.cells) { cells++; assert.ok(Math.max(Math.abs(c.at[0] - home.x), Math.abs(c.at[2] - home.z)) <= W.BW3.r, `${f} ${c.at}`) }
    assert.ok(d.controls && d.controls.far_ring_cols > 0 && d.controls.genesis_water_cols > 0, `${f}: the positive controls are recorded`)
  }
  assert.ok(cells > 1000, `${cells} cells listed`)
})

console.log('THE WORK LIST')
await t('a REMOVAL line is cut FAR END FIRST (a spur from the west bank: x 10 first, x 5 last); a walk line is a chained DECK', async () => {
  const srv = lake(lineCells(5, 10))
  const w = W.bw3Work([asLine(5, 10)], srv.read)
  assert.deepStrictEqual(w.cuts.map(c => c.at[0]), [10, 9, 8, 7, 6, 5])
  assert.strictEqual(w.record.cells.length, 0)
  const srv2 = lake(lineCells(5, 14))
  const w2 = W.bw3Work([asLine(5, 14, { walk: true })], srv2.read)
  assert.strictEqual(w2.cuts.length, 0); assert.strictEqual(w2.record.cells.length, 10)
  // both banks are shores: d 0 at x 5 and x 14, the middle last; each step waits on the one nearer a bank
  const seg = Object.fromEntries(w2.record.cells.map(c => [c.at[0], c.seg]))
  assert.strictEqual(seg[5], 'W000-0-5_0'); assert.strictEqual(seg[14], 'W000-0-14_0'); assert.strictEqual(seg[9], 'W000-4-9_0')
  assert.deepStrictEqual(w2.record.segments.find(s => s.seg === 'W000-3-8_0').deps, ['W000-2-7_0'])
  assert.deepStrictEqual(w2.record.segments.find(s => s.seg === 'W000-0-5_0').deps, [])
  // WALKWAYS=off: the same walk line is cut instead
  const w3 = W.bw3Work([asLine(5, 14, { walk: true })], srv2.read, { walkOn: false })
  assert.strictEqual(w3.record.cells.length, 0); assert.strictEqual(w3.cuts.length, 10)
})
await t('NEVER: a cell gone or turned another block, a cell another record names (guard); a planks deck cell reads done', async () => {
  const srv = lake({ ...lineCells(5, 10), '7,69,0': 'stone', '8,69,0': 'water' })
  const w = W.bw3Work([asLine(5, 10)], srv.read, { guard: k => k === `6,${G},0` })
  assert.deepStrictEqual(w.cuts.map(c => c.at[0]).sort((a, b) => a - b), [5, 9, 10])
  assert.strictEqual(w.stats.gone, 2); assert.strictEqual(w.stats.guarded, 1)
  const srv2 = lake({ ...lineCells(5, 14), '5,69,0': 'spruce_planks' })
  const w2 = W.bw3Work([asLine(5, 14, { walk: true })], srv2.read)
  assert.strictEqual(w2.stats.deckDone, 1); assert.strictEqual(W.bw3HasWork(w2), true)
  assert.strictEqual(W.bw3PlanksOwed(w2, 4), 5); assert.strictEqual(W.bw3PlanksOwed(w2, 0, 3), 3)
})
await t('an ISLAND (no bank beside any cell) is listed first and no stand reaches it: the visit digs nothing there and goes on', async () => {
  const srv = lake({ ...lineCells(14, 15), ...lineCells(5, 6) }, 24, 9)
  const w = W.bw3Work([asLine(14, 15, { id: 'L000' }), asLine(5, 6, { id: 'L001' })], srv.read)
  assert.strictEqual(w.stats.islands, 1)
  const e = lakeBot(srv)
  const r = await R.runVisit(visitP(w.record, 'A', { tidy: w.cuts }), e, { maxSteps: 200 })
  assert.strictEqual(srv.read(5, G, 0).name, 'water'); assert.strictEqual(srv.read(6, G, 0).name, 'water')
  assert.strictEqual(srv.read(14, G, 0).name, 'dirt', 'the island past reach stands'); assert.strictEqual(srv.read(15, G, 0).name, 'dirt')
  assert.notStrictEqual(r.stop, 'aborted')
})

console.log('THE VISIT (the real runVisit on the fake lake)')
const removal = async M => {
  const srv = lake(lineCells(5, 10))
  const w = M.bw3Work([asLine(5, 10)], srv.read)
  const e = lakeBot(srv)
  await R.runVisit(visitP(w.record, 'A', { tidy: w.cuts }), e, { maxSteps: 300 })
  for (let x = 5; x <= 10; x++) assert.strictEqual(srv.read(x, G, 0).name, 'water', `x ${x} dug out`)
  const digs = e.ops.filter(o => o[0] === 'dig')
  assert.deepStrictEqual(digs.map(o => Number(o[1].split(',')[0])), [10, 9, 8, 7, 6, 5], 'far end first')
  // the digger never stood past a cell it dug (it always had the line behind it to walk back on)
  for (const [, c, feet] of digs) assert.ok(feet[0] < Number(c.split(',')[0]), `dug ${c} from ${feet}`)
}
await t('A REMOVAL LINE comes out whole, far end first, the digger always on the town side of its cut; the lake is clean', async () => {
  await removal(W)
})
await t('MUTANT KILLED: cut NEAR end first -> the line beyond the first cut has no stand (cut off from town) and stays', async () => {
  assert.ok(await withMutant('live.sort((a, b) => b.dr - a.dr ||', 'live.sort((a, b) => a.dr - b.dr ||', M => killedBy(removal, M)), 'the mutant survived')
})
const walkway = async (Rm = R) => {
  const srv = lake(lineCells(5, 14))
  const w = W.bw3Work([asLine(5, 14, { walk: true })], srv.read)
  const e = lakeBot(srv)
  let r
  for (let i = 0; i < 3 && !deckDone(srv, w.record); i++) r = await Rm.runVisit(visitP(w.record), e, { maxSteps: 600 })
  assert.ok(deckDone(srv, w.record), `deck laid (${r?.stop}: ${r?.why}) ops ${JSON.stringify(e.ops)} logs ${JSON.stringify(e.logs.filter(l => l[0] === '_build').map(l => [l[1].op, l[1].cell, l[1].why ?? l[1].result]).slice(0, 30))}`)
  for (let x = 5; x <= 14; x++) assert.strictEqual(srv.read(x, G, 0).name, 'oak_planks')
  // IN PLACE, one cell at a time: every dig is followed by the plank into that same cell before any other cell is dug
  const ops = e.ops
  for (let i = 0; i < ops.length; i++) if (ops[i][0] === 'dig') assert.ok(ops[i + 1] && ops[i + 1][0] === 'place' && ops[i + 1][1] === ops[i][1], `dig ${ops[i][1]} then ${JSON.stringify(ops[i + 1])}`)
  return e
}
await t('A WALK LINE becomes planks IN PLACE, bank to bank: dig, plank into the same cell, next -- never two cells open', async () => {
  await walkway()
})
await t('MUTANT KILLED: without `p.wet` a dug deck cell (water) is never clear -> no plank is laid', async () => {
  await withRunMutant("(!!p.wet && WET_CLEAR.test(nm(b)))", 'false', async M => {
    let killed = false
    try { await walkway(M) } catch { killed = true }
    assert.ok(killed, 'the mutant survived')
  })
})
await t('MUTANT KILLED: the click\'s own re-read refuses a water cell (no `p.wet` there) -> no plank is laid', async () => {
  await withRunMutant(" && !(p.wet && WET_CLEAR.test(nm(rd(...cell))))) { cancel(); return 'refused' }", ") { cancel(); return 'refused' }", async M => {
    let killed = false
    try { await walkway(M) } catch { killed = true }
    assert.ok(killed, 'the mutant survived')
  })
})
await t('MUTANT KILLED: the deck segments not chained (no deps) -> a cell could open before the one it is reached from', async () => {
  const chained = M => {
    const srv = lake(lineCells(5, 14))
    const w = M.bw3Work([asLine(5, 14, { walk: true })], srv.read)
    for (const s of w.record.segments) { const k = Number(s.seg.split('-')[1]); assert.strictEqual(s.deps.length, k > 0 ? 1 : 0, s.seg); if (k > 0) assert.strictEqual(Number(s.deps[0].split('-')[1]), k - 1) }
    assert.strictEqual(new Set(w.record.cells.map(c => c.seg)).size, w.record.cells.length, 'one cell a segment')
  }
  chained(W)
  assert.ok(await withMutant("deps: par != null && low.has(par) ? [segOf(par)] : []", 'deps: []', M => killedBy(chained, M)), 'the mutant survived')
})
await t('MUTANT KILLED: the dirt family dropped from standingAs -> a listed dirt that greened is never dug', async () => {
  const greened = M => {
    const srv = lake({ ...lineCells(5, 6), '6,69,0': 'grass_block' })
    const w = M.bw3Work([asLine(5, 6)], srv.read)
    assert.strictEqual(w.cuts.length, 2)
    assert.strictEqual(w.cuts.find(c => c.at[0] === 6).name, 'grass_block', 'the cut names the block standing (digNamed checks it)')
  }
  greened(W)
  assert.ok(await withMutant('return DIRT.test(n) && DIRT.test(String(listed)) ? n : null', 'return null', M => killedBy(greened, M)), 'the mutant survived')
})
await t('MUTANT KILLED: the stale-file check removed -> an old file (a reseeded world) would be acted on', async () => {
  const stale = M => assert.strictEqual(M.bw3Evidence({ ...DOC(), generated: new Date(Date.now() - 40 * 86400_000).toISOString() }, { pool: 'hive-c', home: { x: 0, y: G + 1, z: 0 } }).ok, false)
  stale(W)
  assert.ok(await withMutant('if (!Number.isFinite(at) || now - at > maxAgeMs || at - now > 60 * 60_000)', 'if (!Number.isFinite(at))', M => killedBy(stale, M)), 'the mutant survived')
})

console.log('CODEX R1 BLOCKERS')
// a crossing in a lake that spans the whole map north to south: the far bank (x >= 15) is reached ONLY over the line
const crossing = async (M, Rm = R) => {
  const cells = {}
  for (let x = 5; x <= 14; x++) for (let z = -60; z <= 60; z++) for (const y of [G - 1, G]) cells[`${x},${y},${z}`] = 'water'
  const srv = server({ ...cells, ...lineCells(5, 14) })
  const w = M.bw3Work([asLine(5, 14)], srv.read, { home: HOME })
  assert.deepStrictEqual(w.cuts.map(c => c.at[0]), [14, 13, 12, 11, 10, 9, 8, 7, 6, 5], 'from the far bank back to town')
  const e = lakeBot(srv)
  for (let i = 0; i < 2; i++) await Rm.runVisit(visitP(w.record, 'A', { tidy: M.bw3Work([asLine(5, 14)], srv.read, { home: HOME }).cuts }), e, { maxSteps: 400 })
  for (let x = 5; x <= 14; x++) assert.strictEqual(srv.read(x, G, 0).name, 'water', `x ${x} dug out`)
}
await t('BLOCKER 3: a removal line joining BOTH banks is dug from the far bank back toward town (rooted), and comes out whole', async () => {
  await crossing(W)
})
await t('MUTANT KILLED: unrooted (both banks start) -> the middle goes first and the far half is stranded', async () => {
  assert.ok(await withMutant('live.sort((a, b) => b.dr - a.dr ||', 'live.sort((a, b) => b.d - a.d ||', M => killedBy(crossing, M)), 'the mutant survived')
})
await t('BLOCKER 2: a deck cell dug but not yet planked (WATER) stays a deck cell, and the next visit lays it', async () => {
  const srv = lake({ ...lineCells(5, 14), [`9,${G},0`]: 'water', [`10,${G},0`]: 'spruce_planks' })
  const w = W.bw3Work([asLine(5, 14, { walk: true })], srv.read)
  assert.strictEqual(w.record.cells.length, 10); assert.strictEqual(w.stats.deckDone, 1)
  // every other cell planked already: only the hole is open, and it is still work
  const srv2 = lake({ ...lineCells(5, 14, 'oak_planks'), [`9,${G},0`]: 'water' })
  const w2 = W.bw3Work([asLine(5, 14, { walk: true })], srv2.read)
  assert.strictEqual(W.bw3HasWork(w2), true)
  await R.runVisit(visitP(w2.record), lakeBot(srv2), { maxSteps: 200 })
  assert.strictEqual(srv2.read(9, G, 0).name, 'oak_planks')
})
await t('MUTANT KILLED: the deck kept only while its listed block stands -> a dug, unplanked hole is forgotten', async () => {
  const hole = M => { const srv = lake({ ...lineCells(5, 14, 'oak_planks'), [`9,${G},0`]: 'water' }); assert.strictEqual(M.bw3HasWork(M.bw3Work([asLine(5, 14, { walk: true })], srv.read)), true) }
  hole(W)
  assert.ok(await withMutant("if (!(standingAs(read(...c.at), c.name) || /_planks$/.test(n) || WATERN.test(n))) low.delete(k)", 'if (!standingAs(read(...c.at), c.name)) low.delete(k)', M => killedBy(hole, M)), 'the mutant survived')
})
await t('BLOCKER 1: a listed deck cell that holds anything else now (a log) is no deck cell: never dug, nothing above it touched', async () => {
  const srv = lake({ ...lineCells(5, 14), [`8,${G},0`]: 'oak_log', [`8,${G + 1},0`]: 'oak_log' })
  const w = W.bw3Work([asLine(5, 14, { walk: true })], srv.read)
  assert.ok(!w.record.cells.some(c => c.at[0] === 8)); assert.ok(!w.cuts.some(c => c.at[0] === 8))
  await R.runVisit(visitP(w.record), lakeBot(srv), { maxSteps: 400 })
  assert.strictEqual(srv.read(8, G, 0).name, 'oak_log'); assert.strictEqual(srv.read(8, G + 1, 0).name, 'oak_log')
})
const deckFor = async (M) => {
  // three open deck cells, ONE plank: the visit lays one and digs nothing else
  const srv = lake({ ...lineCells(5, 7) })
  const w = M.bw3Work([asLine(5, 7, { walk: true })], srv.read)
  const rec = M.bw3DeckFor(w.record, 1, q => R.cellDone(srv.read(...q.at), M.BW3_PALETTE, q.role))
  assert.strictEqual(rec.cells.length, 1); assert.deepStrictEqual(rec.cells[0].at, [5, G, 0]); assert.strictEqual(rec.segments.length, 1)
  const e = lakeBot(srv, 'A', { inv: { oak_planks: 1 } })
  await R.runVisit(visitP(rec), e, { maxSteps: 200 })
  assert.strictEqual(srv.read(5, G, 0).name, 'oak_planks'); assert.strictEqual(srv.read(6, G, 0).name, 'dirt'); assert.strictEqual(srv.read(7, G, 0).name, 'dirt')
  assert.strictEqual(M.bw3DeckFor(w.record, 0, () => false).cells.length, 0)
}
await t('BLOCKER 2 (r2): the visit opens only as many deck cells as the bag holds planks -- no cell is dug it cannot plank', async () => {
  await deckFor(W)
  const v = SK.slice(SK.indexOf('async function waterWalkVisit ('))
  assert.ok(/const rec = bw3DeckFor\(w\.record, planksNow,/.test(v)); assert.ok(/record: rec, tidy: cuts/.test(v)); assert.ok(/foreign: BOT_MAT_RE/.test(v))
})
await t('MUTANT KILLED: the plank budget ignored -> every open deck cell is opened and dug', async () => {
  assert.ok(await withMutant('if (left > 0) { left--; return true } return false', 'return true', M => killedBy(deckFor, M)), 'the mutant survived')
})
console.log('THE WIRING (structural: what behaviour cannot reach from here)')
await t('buildTidy runs the water visit when due, BEFORE the stage siting; the visit passes wet, the evidence file and the guard', async () => {
  const bt = SK.slice(SK.indexOf('async function buildTidy ('))
  const hook = bt.indexOf('if (bw3Due(bot)) {'), site = bt.indexOf("if (!rh.head || tidyDue(rh.head.rec) || gkNext) {")
  assert.ok(hook > 0 && site > 0 && hook < site, 'the hook precedes the siting')
  const v = SK.slice(SK.indexOf('async function waterWalkVisit ('), SK.indexOf('async function buildTidy ('))
  assert.ok(/stuckStalledOnly: true, wet: true,/.test(v)); assert.ok(/bw3Evidence\(bw3Doc\(config\.memory\.pool\)/.test(v)); assert.ok(/guard: k => guard\.has\(k\)/.test(v))
  assert.ok(/recordGen: rh\.head\.gen/.test(v))
})
await t('the bot\'s dig confirms a block dug out of water (it reads WATER once the lake flows back): buildbot dig and the probe', async () => {
  const BB = strip(fs.readFileSync(new URL('../src/buildbot.mjs', import.meta.url), 'utf8'))
  assert.ok(BB.includes("blocks.wait(c, x => x === 'air' || x === 'cave_air' || x === 'water', DIG_CONFIRM_MS)"))
  assert.strictEqual(R.DUG('water'), true); assert.strictEqual(R.DUG('air'), true); assert.strictEqual(R.DUG('dirt'), false)
})
await t('the switches: BOARDWALK3=off and WALKWAYS=off read off; unset reads on', async () => {
  assert.strictEqual(W.bw3On({}), true); assert.strictEqual(W.bw3On({ BOARDWALK3: 'off' }), false); assert.strictEqual(W.bw3On({ BOARDWALK3: '0' }), false)
  assert.strictEqual(W.bw3WalkOn({}), true); assert.strictEqual(W.bw3WalkOn({ WALKWAYS: 'no' }), false)
})
await t('the visit row keeps every key inside the logger\'s 300 characters', async () => {
  const d = W.bw3Detail({ stats: { lines: 977, walk: 117, standing: 2402, gone: 12, deck: 552, deckDone: 40 }, cuts: 2000, placed: 24, cleared: 24, planks: 64, stop: 'cell_deferred', why: 'x'.repeat(200) })
  assert.ok(d.length <= 300, d.length); assert.ok(/^op=visit lines=977 walk=117 standing=2402 .* stop=cell_deferred why=x+$/.test(d))
})

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
