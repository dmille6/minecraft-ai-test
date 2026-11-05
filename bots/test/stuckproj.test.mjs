// STUCKPROJ-01 (fleet 11-05, the stuck-projects read on aea83708): TWO REMEDIES, each tested by what it DOES.
//   canopy-01  a tree grown on or against a build: the natural leaves round a cell no stand reaches are cut back (canopy.mjs,
//              buildrun.mjs runVisit `p.canopy`). hive-d / placebo-c / isolated-a monuments, isolated-a wall, isolated-c L02-N.
//   starve-01  an open project no builder has taken in STARVE_MS is offered before the order (shop.mjs starveMark +
//              activeProject). board-d wall (1 visit vs 475 monument), isolated-b wall (0 in 18 h vs 425).
// The runVisit scenarios run on the fake server (test/helpers/buildfake.mjs); each control is the live behaviour; each remedy is
// killed by a mutant whose anchor is asserted present and unique (withMutant).
import assert from 'node:assert'
import fs from 'node:fs'
import { readFileSync } from 'node:fs'
const { R, PJ, G, HOME, server, bot, withMutant } = await import('./helpers/buildfake.mjs')
const C = await import('../src/canopy.mjs')
const S = await import('../src/shop.mjs')

let pass = 0, fail = 0
const t = async (name, fn) => { try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 6).join('\n        ')}`) } }
const k = a => a.join(',')
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
/** The scenario passes on the real module; the mutant fails the scenario's OWN assertion. */
const killedBy = async (old, neu, scenario) => {
  await scenario(R)
  let why = null
  await withMutant(old, neu, async M => { try { await scenario(M) } catch (err) { why = err } })
  assert.ok(why instanceof assert.AssertionError, `the mutant survived or died for another reason: ${why?.stack?.split('\n')[0] ?? 'survived'}`)
}
/** A mutant of a module other than buildrun.mjs: the anchor asserted present and unique, the copy imported fresh. */
async function withModMutant (file, old, neu, fn) {
  const src = readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8')
  assert.strictEqual(src.split(old).length - 1, 1, `ANCHOR MISSING OR NOT UNIQUE in ${file}: ${old.slice(0, 60)}`)
  const f = new URL(`../src/.mut-${process.pid}-${Date.now().toString(36)}-${file}`, import.meta.url)
  fs.writeFileSync(f, src.replace(old, neu))
  try { return await fn(await import(f.href)) } finally { fs.unlinkSync(f) }
}

// ================================================================================================================================
// CANOPY-01
// ================================================================================================================================
const PAL = Object.freeze({ wall: ['cobblestone'] })
const CELL = [10, G + 1, 10]
function projectOf (record) {
  const dir = fs.mkdtempSync(`${process.env.TMPDIR ?? '/tmp'}/stuckproj-`)
  const key = PJ.projKey(HOME, 'wall')
  const pub = PJ.publishRecord(dir, key, () => ({ ...record }))
  const slots = {}
  const p = (n, extra = {}) => {
    slots[n] ??= PJ.takeSlot(dir, key, n, 3)
    return { dir, key, me: n, home: HOME, stood: [], record, recordGen: pub.gen, palette: PAL, slot: slots[n].slot, slotGen: slots[n].gen, stands: { pending: null, bans: {} }, blockLayer: false, domain: () => true, walkR: 40, ...extra }
  }
  return { dir, key, p }
}
const rec = () => ({ v: 1, plot: 'wall', cells: [{ at: CELL, role: 'wall', seg: 'W-0' }], clear: [], replant: [], segments: [{ seg: 'W-0', deps: [] }] })
/** THE LIVE SHAPE: a tree's leaves on every side of the cell and over it (hive-d L01-W, the isolated-a wall) -- no stand's eye
 *  sees a support face; `inCell`: the cell itself holds leaves too (isolated-c L02-N). */
function treeScene ({ inCell = false } = {}) {
  const srv = server()
  for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) for (let dy = 0; dy <= 2; dy++) {
    const at = [CELL[0] + dx, CELL[1] + dy, CELL[2] + dz]
    if (k(at) !== k(CELL) || inCell) srv.set(at, 'oak_leaves')
  }
  return srv
}
const leavesLeft = srv => { let n = 0; for (const v of srv.cells.values()) if (v === 'oak_leaves') n++; return n }
const CAN = (extra = {}) => ({ canopy: { natural: () => true, mayDig: () => true, ...extra } })

console.log('CANOPY: THE CUT (canopy.mjs canopyCuts, pure)')
await t('natural leaves and vines round the cell, highest first; never unread, never a done record cell, never vetoed, never persistent', () => {
  const cells = new Map([['1,1,0', 'oak_leaves'], ['0,2,0', 'oak_leaves'], ['2,0,0', 'vine'], ['0,1,1', 'stone'], ['-1,1,0', 'oak_leaves'], ['0,1,-1', 'birch_leaves'], ['3,3,3', 'oak_leaves'], ['1,0,1', 'oak_leaves']])
  const read = (x, y, z) => (k([x, y, z]) === '0,4,0' ? null : { name: cells.get(k([x, y, z])) ?? 'air' })
  const got = C.canopyCuts([0, 1, 0], {
    read,
    natural: at => k(at) !== '0,1,-1',                      // the birch leaves were PLACED (persistent=true)
    mayDig: at => k(at) !== '-1,1,0',                       // another project's cell
    recordCell: kk => (kk === '1,0,1' ? { at: [1, 0, 1], role: 'wall' } : null),
    isDone: c => k(c.at) === '1,0,1',                       // the build
  })
  // 3,3,3 is dx 3 / dy +2 / dz 3: inside the box (inclusive); highest first
  assert.deepStrictEqual(got.map(q => [k(q.at), q.name]), [['3,3,3', 'oak_leaves'], ['0,2,0', 'oak_leaves'], ['1,1,0', 'oak_leaves'], ['2,0,0', 'vine']])
})
await t('the box: CANOPY_R across, CANOPY_DOWN below, CANOPY_UP above (inclusive); a skipped key is left', () => {
  const read = () => ({ name: 'oak_leaves' })
  const all = C.canopyCuts([0, 10, 0], { read, natural: () => true })
  const side = 2 * C.CANOPY_R + 1
  assert.strictEqual(all.length, side * side * (C.CANOPY_UP + C.CANOPY_DOWN + 1))
  assert.strictEqual(Math.max(...all.map(q => q.at[1])), 10 + C.CANOPY_UP)
  assert.strictEqual(Math.min(...all.map(q => q.at[1])), 10 - C.CANOPY_DOWN)
  assert.strictEqual(C.canopyCuts([0, 10, 0], { read, natural: () => true, skip: kk => kk === '0,13,0' }).length, all.length - 1)
  assert.deepStrictEqual(C.canopyCuts(null, { read }), [])
})
await t('naturalProps: leaves only when persistent is false (mineflayer gives a boolean; a string is accepted); a vine always; a log never', () => {
  assert.strictEqual(C.naturalProps('oak_leaves', { persistent: false, distance: 3 }), true)
  assert.strictEqual(C.naturalProps('spruce_leaves', { persistent: 'false' }), true)
  assert.strictEqual(C.naturalProps('oak_leaves', { persistent: true }), false, 'placed leaves (a hedge) are a build')
  assert.strictEqual(C.naturalProps('oak_leaves', undefined), false, 'unread properties: never')
  assert.strictEqual(C.naturalProps('vine', null), true)
  assert.strictEqual(C.naturalProps('oak_log', { persistent: false }), false)
  assert.strictEqual(C.naturalProps('cobblestone', {}), false)
})
await t('the switch: CANOPY=off|0|false|no is the rollback; unset is on', () => {
  for (const v of ['off', 'OFF', ' 0', 'false', 'no']) assert.strictEqual(C.canopyOn({ CANOPY: v }), false, v)
  for (const v of [undefined, '', 'on', '1']) assert.strictEqual(C.canopyOn({ CANOPY: v }), true, String(v))
})

console.log('CANOPY: THE VISIT (buildrun.mjs runVisit p.canopy, fake server)')
await t('CONTROL (the live behaviour): leaves round an open cell -> no stand, the cell deferred, nothing dug, nothing placed', async () => {
  const srv = treeScene(), pr = projectOf(rec()), e = bot(srv, 'A', { inv: { cobblestone: 8 } })
  const n0 = leavesLeft(srv)
  const r = await R.runVisit(pr.p('A'), e, { maxSteps: 200 })
  assert.notStrictEqual(r.stop, 'complete')
  assert.ok(e.logs.some(([kk, d]) => kk === '_build' && d.op === 'deferred'), 'the live row: deferred')
  assert.strictEqual(srv.read(...CELL).name, 'air')
  assert.strictEqual(leavesLeft(srv), n0)
})
await t('p.canopy: the leaves are cut back from outside in and the cell is PLACED in the same visit (`complete`), each cut a row', async () => {
  const scenario = async M => {
    const srv = treeScene(), pr = projectOf(rec()), e = bot(srv, 'A', { inv: { cobblestone: 8 } })
    const r = await M.runVisit(pr.p('A', CAN()), e, { maxSteps: 400 })
    assert.strictEqual(r.stop, 'complete', `stop ${r.stop} ${r.why ?? ''}`)
    assert.strictEqual(srv.read(...CELL).name, 'cobblestone')
    assert.ok(r.canopy > 0 && e.logs.filter(([kk, d]) => kk === '_build' && d.op === 'clear' && d.kind === 'canopy').length === r.canopy)
    assert.ok(e.logs.some(([kk, d]) => kk === '_build' && d.op === 'canopy'), 'the summary row')
    // passes repeat while one dug: the leaves an outer one hid from every stand come down too (one pass leaves them)
    assert.strictEqual(leavesLeft(srv), 0, 'the whole canopy round the cell')
  }
  await killedBy('          if (p.canopy && cand.length && cand.some(c => !canopied.has(kOf(c.at)))) {', '          if (false) {', scenario)
  await killedBy("        if (v === 'confirmed') { dug++; canopyDug++; out.cleared++; progress = true;", "        if (v === 'confirmed') { dug++; canopyDug++; out.cleared++; progress = false;", scenario)
})
await t('p.canopy: leaves IN the cell with the canopy round them (isolated-c L02-N: clear_failed no_stand x370) -> dug, placed', async () => {
  const scenario = async M => {
    const srv = treeScene({ inCell: true }), pr = projectOf(rec()), e = bot(srv, 'A', { inv: { cobblestone: 8 } })
    const r = await M.runVisit(pr.p('A', CAN()), e, { maxSteps: 400 })
    assert.strictEqual(r.stop, 'complete', `stop ${r.stop} ${r.why ?? ''}`)
    assert.strictEqual(srv.read(...CELL).name, 'cobblestone')
  }
  // CONTROL: without the canopy the cell's own leaves fail no_stand and nothing is placed
  { const srv = treeScene({ inCell: true }), pr = projectOf(rec()), e = bot(srv, 'A', { inv: { cobblestone: 8 } })
    const r = await R.runVisit(pr.p('A'), e, { maxSteps: 400 })
    assert.notStrictEqual(r.stop, 'complete')
    assert.ok(e.logs.some(([kk, d]) => kk === '_build' && d.op === 'clear_failed' && d.result === 'no_stand'), 'the live row') }
  await killedBy("          if ((v === 'no_stand' || v === 'unreached') && p.canopy && !canopied.has(kOf(f.at))) {", '          if (false) {', scenario)
})
await t('never PLACED leaves (natural false) and never a vetoed cell (mayDig false): nothing dug, the old deferral stands', async () => {
  for (const extra of [{ natural: () => false }, { mayDig: () => false }]) {
    const srv = treeScene(), pr = projectOf(rec()), e = bot(srv, 'A', { inv: { cobblestone: 8 } })
    const n0 = leavesLeft(srv)
    const r = await R.runVisit(pr.p('A', CAN(extra)), e, { maxSteps: 400 })
    assert.notStrictEqual(r.stop, 'complete')
    assert.strictEqual(leavesLeft(srv), n0, JSON.stringify(Object.keys(extra)))
    assert.ok(e.logs.some(([kk, d]) => kk === '_build' && d.op === 'deferred'))
  }
  await withModMutant('canopy.mjs', '      if (!natural(at) || !mayDig(at)) continue\n', '      if (!mayDig(at)) continue\n', async M => {
    const got = M.canopyCuts([0, 0, 0], { read: () => ({ name: 'oak_leaves' }), natural: () => false, r: 0, up: 0, down: 0 })
    assert.strictEqual(got.length, 1, 'the mutant digs placed leaves')
  })
})
await t('r1 (Codex r1 BLOCK): never an INDEPENDENT segment\'s record cell (another builder may hold it); a WAITING segment\'s cell is cut', async () => {
  const X = [CELL[0] + 1, CELL[1], CELL[2]], Y = [CELL[0], CELL[1] + 1, CELL[2]]
  const r = { v: 1, plot: 'wall', cells: [{ at: CELL, role: 'wall', seg: 'W-0' }, { at: X, role: 'wall', seg: 'W-1' }, { at: Y, role: 'wall', seg: 'W-2' }], clear: [], replant: [],
    segments: [{ seg: 'W-0', deps: [] }, { seg: 'W-1', deps: [] }, { seg: 'W-2', deps: ['W-0'] }] }
  const scenario = async M => {
    const srv = treeScene(), pr = projectOf(r)
    assert.ok(PJ.takeLease(pr.dir, pr.key, 'seg-W-1', 'B').ok, 'builder B holds W-1')
    const e = bot(srv, 'A', { inv: { cobblestone: 8 } })
    await M.runVisit(pr.p('A', CAN()), e, { maxSteps: 400 })
    assert.strictEqual(srv.read(...X).name, 'oak_leaves', 'B\'s cell is never dug by A')
    assert.ok(e.logs.some(([kk, d]) => kk === '_build' && d.op === 'clear' && d.kind === 'canopy' && k(d.cell) === k(Y)), 'the waiting segment\'s leaves are cut')
  }
  await killedBy('if (q && q.seg !== seg && !dependsOn(record, q.seg, seg)) return false; ', '', scenario)
})
await t('bounded: at most `max` cuts a visit, and each cell\'s canopy once a visit (a second visit goes on where the first stopped)', async () => {
  const srv = treeScene(), pr = projectOf(rec()), e = bot(srv, 'A', { inv: { cobblestone: 8 } })
  const r1 = await R.runVisit(pr.p('A', CAN({ max: 5 })), e, { maxSteps: 400 })
  assert.strictEqual(r1.canopy, 5)
  assert.notStrictEqual(r1.stop, 'complete')
  const r2 = await R.runVisit(pr.p('A', CAN()), e, { maxSteps: 400 })
  assert.strictEqual(r2.stop, 'complete', `stop ${r2.stop}`)
})
await t('a cut whose dig is refused (a transient) is not retried in a loop: the visit ends with the old deferral, leaves standing', async () => {
  const srv = treeScene(), pr = projectOf(rec())
  let digs = 0
  const e = bot(srv, 'A', { inv: { cobblestone: 8 }, dig: async () => { digs++; return 'refused' } })
  const r = await R.runVisit(pr.p('A', CAN()), e, { maxSteps: 400 })
  assert.notStrictEqual(r.stop, 'complete')
  assert.ok(digs > 0 && digs <= 26, `digs ${digs}: each canopy block tried at most once`)
})
await t('THE WIRING: the monument, wall, workshop/house and tidy visits pass canopyOf; canopyOf is {} with CANOPY=off', async () => {
  const src = strip(readFileSync(new URL('../src/skills.mjs', import.meta.url), 'utf8'))
  for (const a of ['const r = await runVisit({ ...canopyOf(bot, c, plot), dir, key,', 'const r = await runVisitCounted(bot, { ...canopyOf(bot, c, MONUMENT_PLOT), dir, key,', 'const r = await runVisit({ ...canopyOf(bot, c, WALL_PLOT), dir, key,', 'const r = await runVisit({ ...canopyOf(bot, c, TIDY_PLOT), dir, key,']) {
    assert.strictEqual(src.split(a).length - 1, 1, `wired once: ${a}`)
  }
  const SK = await import('../src/skills.mjs')
  assert.deepStrictEqual(SK.canopyOf({}, {}, 'wall', { CANOPY: 'off' }), {})
  const on = SK.canopyOf({ blockAt: () => ({ name: 'oak_leaves', getProperties: () => ({ persistent: false }) }) }, { zones: [{ box: [0, 0, 0, 5, 5, 5] }] }, 'wall', {})
  assert.strictEqual(on.canopy.natural([9, 9, 9]), true)
  assert.strictEqual(on.canopy.mayDig([1, 1, 1]), false, 'a protected zone')
  const placed = SK.canopyOf({ blockAt: () => ({ name: 'oak_leaves', getProperties: () => ({ persistent: true }) }) }, {}, 'wall', {})
  assert.strictEqual(placed.canopy.natural([9, 9, 9]), false)
})

// ================================================================================================================================
// STARVE-01
// ================================================================================================================================
console.log('STARVE: THE PICK (shop.mjs starveMark + activeProject, pure)')
const MIN = 60_000, NOW = 10_000_000
const LIST = S.PROJECTS.filter(p => ['shop', 'house1', 'monument', 'paths', 'wall', 'tidy'].includes(p.plot))
const done = plot => ({ plot, exists: true, complete: true, damaged: false })
const open = (plot, extra = {}) => ({ plot, exists: true, complete: false, damaged: false, free: true, ...extra })
// board-d 11-05: workshop, house and paths complete; the monument open (a free slot every order), the wall open since 13:27Z
const boardD = () => [done('shop'), done('house1'), open('monument'), done('paths'), open('wall'), open('tidy')]
const takes = (m) => plot => NOW - (m[plot] ?? 0) * MIN
await t('CONTROL (the live pick): the first open project with a free slot -- the monument, whatever the wall waits', () => {
  assert.strictEqual(S.activeProject(boardD(), LIST).plot, 'monument')
  assert.strictEqual(S.activeProject(S.starveMark(boardD(), { lastTakeOf: null, now: NOW }), LIST).plot, 'monument', 'no reader: unchanged')
})
await t('a wall nobody took in STARVE_MS is offered first; one taking it refreshes the stamp and the order goes back to the monument', () => {
  const scenario = M => {
    const m = M.starveMark(boardD(), { lastTakeOf: takes({ monument: 1, wall: 40, tidy: 300 }), now: NOW, ms: 30 * MIN })
    assert.strictEqual(M.activeProject(m, LIST).plot, 'wall')
    assert.strictEqual(m.find(s => s.plot === 'wall').starvedFor, 40 * MIN)
    const fresh = M.starveMark(boardD(), { lastTakeOf: takes({ monument: 1, wall: 2 }), now: NOW, ms: 30 * MIN })
    assert.strictEqual(M.activeProject(fresh, LIST).plot, 'monument')
  }
  scenario(S)
  return withModMutant('shop.mjs', '    return starved[0] ?? open.find(p => st(p).free !== false) ?? open[0]\n', '    return open.find(p => st(p).free !== false) ?? open[0]\n', async M => {
    assert.throws(() => scenario(M), assert.AssertionError)
  })
})
await t('the longest-starved first; never the tidy, never an unsited, complete, stuck (not free) or full project', () => {
  const st = [done('shop'), open('house1'), open('monument'), done('paths'), open('wall'), open('tidy')]
  const m = S.starveMark(st, { lastTakeOf: takes({ house1: 35, monument: 50, wall: 90, tidy: 999 }), now: NOW, ms: 30 * MIN })
  assert.strictEqual(S.activeProject(m, LIST).plot, 'wall')
  assert.strictEqual(m.find(s => s.plot === 'tidy').starved, undefined, 'the tidy is last by design')
  const unsited = [done('shop'), done('house1'), open('monument'), done('paths'), { plot: 'wall', exists: false, complete: false, damaged: false }]
  assert.strictEqual(S.activeProject(S.starveMark(unsited, { lastTakeOf: takes({ wall: 999 }), now: NOW }), LIST).plot, 'monument')
  const stuck = [done('shop'), done('house1'), open('monument'), done('paths'), open('wall', { free: false, stuck: true })]
  assert.strictEqual(S.activeProject(S.starveMark(stuck, { lastTakeOf: takes({ wall: 999 }), now: NOW }), LIST).plot, 'monument')
  const throws = S.starveMark(boardD(), { lastTakeOf: () => { throw new Error('unreadable') }, now: NOW })
  assert.ok(!throws.some(s => s.starved), 'an unreadable stamp is never starved')
  const nulls = S.starveMark(boardD(), { lastTakeOf: () => null, now: NOW })
  assert.ok(!nulls.some(s => s.starved), 'no evidence: never starved')
  const future = S.starveMark(boardD(), { lastTakeOf: () => NOW + 10 * MIN, now: NOW })
  assert.ok(!future.some(s => s.starved), 'a bad clock: never starved')
})
await t('`tried`: a bot sent to a starved project is not sent again for STARVE_MS (a visit that fails before it takes a slot)', () => {
  const scenario = M => {
    const tried = new Map([['wall', NOW - 10 * MIN]])
    assert.strictEqual(M.activeProject(M.starveMark(boardD(), { lastTakeOf: takes({ wall: 90 }), now: NOW, ms: 30 * MIN, tried }), LIST).plot, 'monument')
    tried.set('wall', NOW - 31 * MIN)
    assert.strictEqual(M.activeProject(M.starveMark(boardD(), { lastTakeOf: takes({ wall: 90 }), now: NOW, ms: 30 * MIN, tried }), LIST).plot, 'wall')
  }
  scenario(S)
  return withModMutant('shop.mjs', '    if (Number.isFinite(t0) && now - t0 < ms) return s\n', '', async M => { assert.throws(() => scenario(M), assert.AssertionError) })
})
await t('repairs still come first; a starved project never displaces a damaged complete one', () => {
  const st = [{ ...done('shop'), damaged: true }, done('house1'), open('monument'), done('paths'), open('wall')]
  assert.strictEqual(S.activeProject(S.starveMark(st, { lastTakeOf: takes({ wall: 999 }), now: NOW }), LIST).plot, 'shop')
})
await t('the switch: STARVE=off|0|false|no is the rollback; unset is on; STARVE_MS defaults to 30 min', () => {
  for (const v of ['off', '0', 'false', 'no']) assert.strictEqual(S.starveOn({ STARVE: v }), false, v)
  for (const v of [undefined, '', 'on']) assert.strictEqual(S.starveOn({ STARVE: v }), true, String(v))
  if (!(Number(process.env.STARVE_MS) > 0)) assert.strictEqual(S.STARVE_MS, 30 * MIN)
})
await t('THE WIRING: shopActive marks with the shared lease stamp and the bot\'s `tried`; a starved pick is held for its visit and cleared after', () => {
  const src = strip(readFileSync(new URL('../src/skills.mjs', import.meta.url), 'utf8'))
  const one = a => assert.strictEqual(src.split(a).length - 1, 1, `wired once: ${a}`)
  one("const marked = starve ? starveMark(waited, { lastTakeOf: lastTake, now, tried: (b.starveTried ??= new Map()) }) : waited")
  one("const v = projLastTake(dir, list.find(p => p.plot === plot), now); sc.set(plot, { at: now, v }); return v }")
  one('let pick = activeProject(marked, list)')
  one('if (st?.starved) { b.starveTried.set(pick.plot, now); b.starvePick = { plot: pick.plot, at: now } } else b.starvePick = null')
  one('try { return await buildShopVisit(ctx, args, signal) } finally { try { if (ctx?.bot) ctx.bot.starvePick = null }')
  one("for (const v of [Number(st?.rec?.at), Number(st?.releasedAt)])")
})

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
