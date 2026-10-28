// plinth-02 (10-16): the raised junk well's FINISH, and the plinth hardening folded in from lidclear-01's f8daab3a variant.
//
// THE FLEET FAILURE this answers (plinth-01 canary, board-c + hive-d, 13:40-17:10Z): both plinths were built complete
// (board-c 60/60 at cap 365,73,137, k=4; hive-d 66/66 at cap 56,64,69, k=3; stair=[] in both), and then 23 of 30
// build_well visits failed "nowhere within 2 of the junk well's standing cell to put a crafting table" -- the old table rule
// wants a cell at the stand's own level, and a plinth's walls stand over air -- so no well was ever built (_well_built 0).
// The other 5 failed "could not reach the junk well site's standing cell": every one of them started 12-26 blocks BELOW the
// stand, in a mine (bot.pos y 48-55 against a stand at 65/74); the 25 visits that started in town all reached it.
//
// The fixture is the two towns as they stood at 16:50Z (read-only region copies), so the replay below is the fleet's own
// geometry, not a model of it.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'

process.env.LOG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-p02-logs-'))
process.env.BOT_NAME = 'P02Bot'
process.env.OLLAMA_MODEL ??= 'qwen2.5:7b-instruct'
process.env.HOME_X = '0'; process.env.HOME_Y = '64'; process.env.HOME_Z = '0'
process.env.POOL_STATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-p02-pool-'))

const P = await import('../src/plinth.mjs')
const W = await import('../src/well.mjs')
const C = await import('../src/composter.mjs')
const SK = await import('../src/skills.mjs')
const { SKILLS } = SK
const { stack, tool } = await import('./fakeworld.mjs')

let pass = 0, fail = 0
const failed = []
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; failed.push(name); console.log(`  FAIL  ${name}\n        ${String(e?.stack ?? e).split('\n').slice(0, 5).join('\n        ')}`) }
}
const PL_PATH = new URL('../src/plinth.mjs', import.meta.url)
const SKILLS_PATH = new URL('../src/skills.mjs', import.meta.url)
async function withMutant (p, old, neu, fn) {
  const src = readFileSync(p, 'utf8')
  assert.ok(src.includes(old), `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 70))} is not in ${p.pathname}. A mutant that was never written reads as killed.`)
  assert.ok(src.split(old).length === 2, 'the mutation target is not unique; the mutant is ambiguous')
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, src.replace(old, neu).replace(/from '\.\//g, "from '../src/"))
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}

// ---- the fleet fixture -------------------------------------------------------------------------------------------------
const FX = JSON.parse(readFileSync(new URL('./fixtures/plinth-fleet-2026-10-16.json', import.meta.url), 'utf8'))
const SHAPES = { block: [[0, 0, 0, 1, 1, 1]], empty: [] }
function fixtureRead (town, extra = new Map()) {
  const { box, chars, palette, rows } = town
  const nx = box.x1 - box.x0 + 1, nz = box.z1 - box.z0 + 1
  return (x, y, z) => {
    const k = `${x},${y},${z}`
    if (extra.has(k)) return extra.get(k)
    if (x < box.x0 || x > box.x1 || y < box.y0 || y > box.y1 || z < box.z0 || z > box.z1) return null
    const c = rows[(y - box.y0) * nz + (z - box.z0)][x - box.x0]
    if (c === ' ') return null
    const p = palette[chars.indexOf(c)]
    return { name: p.name, boundingBox: p.boundingBox, shapes: SHAPES[p.boundingBox] ?? [], hardness: p.boundingBox === 'block' ? 1.5 : 0, props: null }
  }
}
void Math.min
const FLEET_STAND = { 'board-c': { x: 365, y: 74, z: 136 }, 'hive-d': { x: 56, y: 65, z: 68 } }
const feetReach = (stand, c) => Math.hypot(c.x + 0.5 - (stand.x + 0.5), c.y + 0.5 - stand.y, c.z + 0.5 - (stand.z + 0.5))
const eyeClick = (stand, c) => Math.hypot(c.x + 0.5 - (stand.x + 0.5), c.y - (stand.y + P.EYE_HEIGHT), c.z + 0.5 - (stand.z + 0.5))

for (const [name, town] of Object.entries(FX.towns)) {
  await t(`FLEET REPLAY ${name}: the plinth passes the oracle, the stand is the fleet's, the OLD table rule finds nothing (the fleet failure, reproduced), wellTableCell finds a cell within the craft's reach, and the stand stays walkable from home with the table in place`, () => {
    const read = fixtureRead(town)
    const { cap, home } = town
    assert.equal(W.wellSiteRefusal(read, cap, home, { avoid: [] }), null, 'the finished plinth passes the well oracle')
    const st = W.wellStand(read, cap)
    assert.deepEqual(st.stand, FLEET_STAND[name], 'the stand the fleet rows name')
    assert.equal(C.tableCellFor({ site: { x: cap.x, y: st.stand.y, z: cap.z }, stand: st.stand, read }), null, 'POSITIVE CONTROL: the old rule fails here, as on the fleet')
    const start = P.startNear(read, home)
    const box = P.planBox(home, cap)
    const until = P.cellKey(st.stand.x, st.stand.y, st.stand.z)
    const forbid = (x, y, z) => P.inColumn(cap, x, y, z)
    assert.ok(P.walkReach(read, start, { box, forbid, until }).has(until), 'REACHABILITY: with stair=[] the stand is walkable from home (no stair needed)')
    const c = P.wellTableCell({ site: cap, stand: st.stand, read, start, box })
    assert.ok(c, 'a table cell')
    assert.ok(c.y < st.stand.y, 'below the stand (the old level has none)')
    assert.ok(Math.max(Math.abs(c.x - cap.x), Math.abs(c.z - cap.z)) >= 2, 'never the well\'s 3x3')
    assert.ok(feetReach(st.stand, c) <= P.WELL_TABLE_REACH, `craft reach ${feetReach(st.stand, c)}`)
    assert.ok(eyeClick(st.stand, c) <= P.WELL_TABLE_CLICK, `click ${eyeClick(st.stand, c)}`)
    assert.ok(C.PLACEABLE_INTO.has(read(c.x, c.y, c.z).name)); assert.equal(read(c.x, c.y - 1, c.z).boundingBox, 'block')
    const withTable = fixtureRead(town, new Map([[`${c.x},${c.y},${c.z}`, { name: 'crafting_table', boundingBox: 'block', shapes: SHAPES.block, hardness: 2.5, props: null }]]))
    assert.ok(P.walkReach(withTable, start, { box, forbid, until }).has(until), 'the stand is still walkable with the table down')
    assert.equal(W.wellSiteRefusal(withTable, cap, home, { avoid: [] }), null, 'the table does not break the oracle')
  })
}

await t('FLAT WELL: wellTableCell is exactly the old rule where the old rule finds a cell (no change for ground-level wells)', () => {
  const read = (x, y, z) => (y > 63 ? { name: 'air', boundingBox: 'empty' } : { name: y === 63 ? 'grass_block' : 'dirt', boundingBox: 'block', shapes: SHAPES.block })
  const site = { x: 10, y: 63, z: 10 }, stand = { x: 10, y: 64, z: 9 }
  const old = C.tableCellFor({ site: { x: site.x, y: stand.y, z: site.z }, stand, read })
  assert.ok(old)
  assert.deepEqual(P.wellTableCell({ site, stand, read }), old)
})

// THE ONLY WAY UP: a k=3 plinth on flat ground (top G), reachable only by one step block outside its 5x5 at (cap.x, G+1, cap.z-3).
// The best-sorted candidate is the feet cell ON that step -- a table there would take the only way up.
const G = 60, CAP3 = { x: 0, y: G + 3, z: 0 }
const shell = new Set(P.plinthShell(CAP3).map(c => `${c.x},${c.y},${c.z}`))
const stepWorld = (step = true, extra = new Map()) => (x, y, z) => {
  const k = `${x},${y},${z}`
  if (extra.has(k)) return extra.get(k)
  if (Math.abs(x) > 30 || Math.abs(z) > 30 || y < G - 5 || y > G + 20) return null
  const solidB = { name: 'cobblestone', boundingBox: 'block', shapes: SHAPES.block, hardness: 2, props: null }
  if (y <= G || shell.has(k) || (step && k === `0,${G + 1},-3`)) return y <= G ? { ...solidB, name: 'dirt' } : solidB
  if (x === CAP3.x && z === CAP3.z && y === CAP3.y) return { name: 'dirt', boundingBox: 'block', shapes: SHAPES.block, hardness: 0.5, props: null }   // the cover
  return { name: 'air', boundingBox: 'empty', shapes: [], hardness: 0, props: null }
}
const ST3 = { x: 0, y: G + 4, z: -1 }, START3 = { x: 0, y: G + 1, z: -10 }, BOX3 = { x0: -15, x1: 15, z0: -15, z1: 15, y0: G - 2, y1: G + 10 }
await t('THE TABLE NEVER TAKES THE ONLY WAY UP: the step\'s feet cell sorts first and is skipped; the cell chosen leaves the stand walkable (positive control: the step really is the only way)', () => {
  const read = stepWorld(true)
  const until = P.cellKey(ST3.x, ST3.y, ST3.z)
  const forbid = (x, y, z) => P.inColumn(CAP3, x, y, z)
  assert.equal(W.wellStand(read, CAP3)?.stand.z, -1, 'the north stand')
  assert.ok(P.walkReach(read, START3, { box: BOX3, forbid, until }).has(until), 'with the step: reachable')
  assert.ok(!P.walkReach(stepWorld(false), START3, { box: BOX3, forbid, until }).has(until), 'POSITIVE CONTROL: without the step, not reachable')
  const c = P.wellTableCell({ site: CAP3, stand: ST3, read, start: START3, box: BOX3 })
  assert.ok(c && !(c.x === 0 && c.y === G + 2 && c.z === -3), JSON.stringify(c))
  const withTable = stepWorld(true, new Map([[`${c.x},${c.y},${c.z}`, { name: 'crafting_table', boundingBox: 'block', shapes: SHAPES.block }]]))
  assert.ok(P.walkReach(withTable, START3, { box: BOX3, forbid, until }).has(until), 'still reachable with the chosen table')
})
await t('MUTANT KILLED: without the walk check, the table goes on the only way up', async () => {
  await withMutant(PL_PATH, '    if (!walkReach(withTable, start, { box, forbid: walkForbid, until }).has(until)) continue\n', '\n', async M => {
    assert.deepEqual(M.wellTableCell({ site: CAP3, stand: ST3, read: stepWorld(true), start: START3, box: BOX3 }), { x: 0, y: G + 2, z: -3 })
  })
})
await t('NO PROOF, NO TABLE (Codex r1 P2): without a start cell, or when the stand is not walkable from it today (no step), nothing is offered -- the first candidate would be the step\'s feet cell', () => {
  const r1 = {}, r2 = {}
  assert.equal(P.wellTableCell({ site: CAP3, stand: ST3, read: stepWorld(true), report: r1 }), null, 'no start'); assert.equal(r1.why, 'no_proof')
  assert.equal(P.wellTableCell({ site: CAP3, stand: ST3, read: stepWorld(false), start: START3, box: BOX3, report: r2 }), null, 'the stand not walkable today'); assert.equal(r2.why, 'no_proof')
  assert.ok(P.wellTableCell({ site: CAP3, stand: ST3, read: stepWorld(true), start: START3, box: BOX3 }), 'POSITIVE CONTROL: with the step and a start, a cell')
})
await t('MUTANT KILLED: the walk proof skipped when it fails (the r1 fail-open) -> a table with no proof, on the only way up', async () => {
  await withMutant(PL_PATH, "  if (!start || !walkReach(read, start, { box, forbid: walkForbid, until }).has(until)) return none('no_proof')\n", '  if (!start) return out[0] ? { x: out[0].x, y: out[0].y, z: out[0].z } : null\n', async M => {
    assert.deepEqual(M.wellTableCell({ site: CAP3, stand: ST3, read: stepWorld(true) }), { x: 0, y: G + 2, z: -3 })
  })
})
await t('A CHEST IS NOT A TABLE\'S FLOOR (Codex r1 P3): the step block made a chest -> its lid is never offered; the cell chosen is elsewhere', () => {
  const chest = { name: 'chest', boundingBox: 'block', shapes: [[0.0625, 0, 0.0625, 0.9375, 0.875, 0.9375]], hardness: 2.5, props: null }
  // a second way up (a step on the east), so the stand stays walkable with the chest standing where the north step was
  const extra = new Map([[`0,${G + 1},-3`, chest], [`3,${G + 1},0`, { name: 'cobblestone', boundingBox: 'block', shapes: SHAPES.block }]])
  const read = stepWorld(false, extra)
  const c = P.wellTableCell({ site: CAP3, stand: ST3, read, start: START3, box: BOX3 })
  assert.ok(c, 'a cell'); assert.ok(!(c.x === 0 && c.y === G + 2 && c.z === -3), `not on the chest's lid: ${JSON.stringify(c)}`)
  assert.notEqual(read(c.x, c.y - 1, c.z).name, 'chest')
})
await t('NOTHING IN REACH: a plinth hanging over a void with its ring top taken (water) -> null (build_well then names the carried-trapdoor remedy)', () => {
  const read = (x, y, z) => {
    const k = `${x},${y},${z}`
    if (shell.has(k)) return { name: 'cobblestone', boundingBox: 'block', shapes: SHAPES.block }
    if (Math.max(Math.abs(x), Math.abs(z)) === 2 && y === G + 3) return { name: 'water', boundingBox: 'empty', shapes: [] }   // the ring top taken (not placeable into, no floor above)
    return { name: 'air', boundingBox: 'empty', shapes: [] }
  }
  // the start and box are given, so the null is the empty candidate list, not the missing proof (Claude P3-1)
  const why = {}
  assert.equal(P.wellTableCell({ site: CAP3, stand: ST3, read, start: START3, box: BOX3, report: why }), null)
  assert.equal(why.why, 'no_cell')
})
await t('BUILD_WELL WIRING (structural, comments stripped): the table cell comes from wellTableCell with the town start and box, and the refusal names the carried-trapdoor remedy', () => {
  const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  const c = strip(readFileSync(SKILLS_PATH, 'utf8'))
  // townplan-01 (re-anchored): the same wellTableCell arguments, asked twice -- the plan's strict tier, then its loose tier
  const line = 'const tableArgs = { site, stand, read: tableRead, bodies: bodiesAround(bot), start: startNear(tableRead, home), box: planBox(home, site), forbid: plinthForbid(bot, site), report: tableWhy }'
  assert.equal(c.split(line).length, 2, 'ANCHOR MISSING or not unique')
  assert.equal(c.split('const cell = wellTableCell({ ...tableArgs, tableForbid: wellStrict }) ?? wellTableCell({ ...tableArgs, tableForbid: wellLoose })').length, 2, 'the call')
  assert.ok(!/tableCellFor\(\{ site: \{ x: site\.x, y: stand\.y, z: site\.z \}/.test(c), 'the old call is gone')
  assert.match(c, /carry \$\{need\} wooden trapdoor\(s\), crafted at any table in town/)
})

await t('THE LICENCE ROW (plinth-02): features.mjs::installFeatures (from the index.mjs spawn handler) writes `_plinth_mode` once per spawn from plinthModeDetail (a town with a finished plinth writes no _plinth row); the wiring check can fail', () => {
  assert.equal(P.plinthModeDetail(), 'phase=mode v=2 table=below_stand w=-')
  assert.equal(P.plinthModeDetail('-1909043226:-504800724'), 'phase=mode v=2 table=below_stand w=-1909043226:-504800724')
  assert.equal(P.plinthModeDetail('x'.repeat(50)).split('w=')[1].length, 40, 'cut at 40, as the no_site rows')
  const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  const wired = src => {
    const c = strip(src)
    assert.match(c, /^import \{ plinthModeDetail \} from '\.\/plinth\.mjs'/m, 'imported')
    const i = c.indexOf('export function installFeatures (bot) {')   // features.mjs: called once per spawn from index.mjs (test/features-wired)
    assert.ok(i > 0, 'installFeatures exists')
    assert.match(c.slice(i, i + 4000), /\n\s*try \{ logEvent\(\{ kind: 'plinth_mode', status: 'success', snapshot: snapshot\(bot\), detail: plinthModeDetail\(bot\.worldId\) \}\) \} catch \{\}/, 'written on spawn, on the executable path')
  }
  const idx = readFileSync(new URL('../src/features.mjs', import.meta.url), 'utf8')
  wired(idx)
  const row = "  try { logEvent({ kind: 'plinth_mode'"
  assert.equal(idx.split(row).length, 2, 'anchor present and unique')
  assert.throws(() => wired(idx.replace(row, "  try { void ({ kind: 'plinth_mode'")), 'a removed row is caught')
})

// ---- the plinth hardening folded in from lidclear-01 (51972f9a: 191ccc6d + 51e56968) ------------------------------------
// THE STAIR-LID GUARD (both rebase reviews: a plinth stair could be filled on a town chest's lid). The reviewers' pure
// reproduction: cap g=66 at 0,0; the ground's top at y=61; a chest at 3,62,0 -- the stair along +x counted the chest as
// ground and filled 3,63..64,0, the chest's lid.
const stairWorld = (chest = true) => (x, y, z) => {
  if (chest && x === 3 && y === 62 && z === 0) return { name: 'chest', boundingBox: 'block', shapes: [[0.0625, 0, 0.0625, 0.9375, 0.875, 0.9375]], hardness: 2.5, props: null }
  return y <= 61 ? { name: 'stone', boundingBox: 'block', shapes: [[0, 0, 0, 1, 1, 1]], hardness: 1.5, props: null } : { name: 'air', boundingBox: 'empty', shapes: [], hardness: 0, props: null }
}
const nearChest = c => Math.max(Math.abs(c.x - 3), Math.abs(c.y - 62), Math.abs(c.z)) <= 1
await t('PLINTH STAIR GUARD: no stair option has a cell on or beside a chest (the reviewers\' fixture); positive control: without the chest the +x stair fills 3,63,0; other stairs are still offered', () => {
  const cap = { x: 0, y: 66, z: 0 }
  const without = P.stairOptions(stairWorld(false), cap)
  assert.ok(without.some(o => o.some(c => c.x === 3 && c.y === 63 && c.z === 0)), 'positive control: the fixture builds a stair through that cell')
  const opts = P.stairOptions(stairWorld(true), cap)
  assert.ok(!opts.some(o => o.some(nearChest)), `a stair beside the chest: ${JSON.stringify(opts.filter(o => o.some(nearChest)))}`)
  assert.ok(opts.filter(o => o.length).length >= 1, 'the other directions still offer a stair')
  assert.equal(P.furnitureNear(stairWorld(true), 3, 63, 0), 'chest'); assert.equal(P.furnitureNear(stairWorld(true), 5, 63, 0), null)
})
await t('MUTANT KILLED: without the stair\'s furniture check, the plinth stair fills the chest\'s lid', async () => {
  await withMutant(PL_PATH, '      if (cells.some(c => furnitureNear(read, c.x, c.y, c.z))) continue\n', '\n', async M => {
    const opts = M.stairOptions(stairWorld(true), { x: 0, y: 66, z: 0 })
    assert.ok(opts.some(o => o.some(c => c.x === 3 && c.y === 63 && c.z === 0)), 'the mutant offers the lid')
  })
})
await t('PLINTH CLICK GUARD (structural, comments stripped): a placement is refused at click time when town furniture is beside the cell -- the plan\'s clearance re-asked on the world NOW', () => {
  const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  const c = strip(readFileSync(SKILLS_PATH, 'utf8'))
  const i = c.indexOf('const clickGuard = ({ op, target, post, ref = null }) => {')
  assert.ok(i > 0, 'ANCHOR MISSING')
  const body = c.slice(i, c.indexOf('\n    }\n', i))
  const place = body.slice(body.indexOf('} else {'))
  const RE = /if \(furnitureNear\(read, target\.x, target\.y, target\.z\)\) return 'furniture'/
  assert.match(place, RE, 'the place branch asks furnitureNear')
  const line = "if (furnitureNear(read, target.x, target.y, target.z)) return 'furniture'"
  assert.equal(place.split(line).length, 2, 'ANCHOR MISSING or not unique')
  assert.doesNotMatch(place.replace(line, 'void 0'), RE, 'the mutant is caught')
})
// WEAR_OUT never digs a well or a plinth: plinth walls are andesite/diorite/granite, which wearTarget accepts
const wearBot = ({ wells = [] } = {}) => {
  const V = (x, y, z) => ({ x, y, z, offset: (a, b, c) => V(x + a, y + b, z + c), floored: () => V(x, y, z) })
  const inv = [tool('stone_axe', 130), ...Array.from({ length: 35 }, () => stack('dirt', 64))]   // a full bag and one spent axe: wear_out's trigger
  const dug = []
  const bot = {
    heldItem: null, entity: { position: V(0, 64, 0) }, entities: {}, inventory: { items: () => inv },
    blockAt: p => (!(p.x === 0 && p.z === 0) ? { name: 'andesite', hardness: 1.5, boundingBox: 'block', position: p } : { name: 'air', hardness: 0, boundingBox: 'empty', position: p }),
    canDigBlock: () => true, equip: async x => { bot.heldItem = x },
    dig: async b => { dug.push(b.position); inv.splice(inv.indexOf(bot.heldItem), 1); bot.heldItem = null },
    waitForTicks: async () => {}, pathfinder: { setGoal () {}, stop () {} }, wellCellsNow: () => wells,
  }
  return { bot, dug }
}
await t('WEAR_OUT: no cell of a plinth (its 5x5 box g-3..g) is ever worn out on -- the shared well-cell test; positive control: the same andesite with no well is dug; unreadable wells refuse', async () => {
  { const { bot, dug } = wearBot({ wells: [{ x: 1, y: 65, z: 0 }] }); const r = await SKILLS.wear_out.run({ bot }, {}, new AbortController().signal)
    assert.equal(r.status, 'failed', r.detail); assert.equal(dug.length, 0); assert.match(r.detail, /well/) }
  { const { bot, dug } = wearBot(); const r = await SKILLS.wear_out.run({ bot }, {}, new AbortController().signal)
    assert.equal(r.status, 'success', r.detail); assert.equal(dug.length, 1) }
  { const { bot, dug } = wearBot(); bot.wellCellsNow = () => { throw new Error('boom') }; await SKILLS.wear_out.run({ bot }, {}, new AbortController().signal); assert.equal(dug.length, 0, 'fail closed') }
  assert.equal(SK.wellCellAt({ wellCellsNow: () => [{ x: 20, y: 70, z: 20, stair: [[3, 63, 0]] }] }, { x: 3, y: 63, z: 0 }), true, 'a stair cell')
  assert.equal(SK.wellCellAt({ wellCellsNow: () => [] }, { x: 3, y: 63, z: 0 }), false)
})
await t('MUTANT KILLED: without the well test, wear_out digs a plinth wall', async () => {
  await withMutant(SKILLS_PATH, "    if (inWell !== false) return inWell === null ? 'wells_unknown' : 'well'\n", '\n', async M => {
    const { bot, dug } = wearBot({ wells: [{ x: 1, y: 65, z: 0 }] })
    await M.SKILLS.wear_out.run({ bot }, {}, new AbortController().signal)
    assert.equal(dug.length, 1, 'the mutant digs the plinth')
  })
})

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) console.log('FAILED:\n  ' + failed.join('\n  '))
process.exit(fail ? 1 : 0)
