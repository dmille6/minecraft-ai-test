// CLIMB FLOOD -- THE CHAIN, THE WIRING AND climbflood-02 (sections C, D, F of climb-flood.test.mjs, split out 10-06 so
// no file reaches the runner's 120 s per-file limit under load; the shared fixtures below are a verbatim copy).
//
// CLIMB FLOOD (climbflood-01): THE ESCAPE CLIMB MUST NOT DIG ITSELF INTO A SEALED POCKET.
//
// MEASURED 2026-10-05 (docs/reports/underground-safety-design-2026-10-05.md): every drowning in 72 h (109) was a
// sealed pocket, and the largest single way in -- 30 deaths, 28% of drownings -- was the bot's own escape climb
// breaking the block over its head with no water check. Four upward-dig paths did it: `pillarOut`'s head dig,
// `digStraightUp` (which pillarOut falls into), the escape ramp's ceiling breach and step digs, and the skill climb
// `shaftAscend`, whose guard read the block and its sides but not the cell ABOVE it.
//
// What this file proves, by BEHAVIOUR (CLAUDE.md: decisions extracted and driven, never matched as text):
//   A. the one predicate, cell by cell, with positive controls that a dry ceiling is still dug;
//   B. each of the four paths refuses water/lava above the block AND above that (the gravel case), digging nothing,
//      and digs a dry ceiling (the positive control for every refusal);
//   C. the refusal CHAIN end to end on the measured geometry: pillar refuses -> the ramp refuses the same cell ->
//      no prerequisite, a growing back-off, the bot dry and where it was, over repeated firings;
//   D. the wiring of both handlers (a structural source assertion, comments stripped, each seen to fail by a mutant);
//   E. anchored mutants (present AND unique, `withMutant`) for every decision line.
import assert from 'node:assert'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { createRequire } from 'node:module'
import { overheadBreakRisk, isWaterCell, isLavaCell, headroomBreach, stairUpStep, floodSidestep,
         chooseFloodSidestep } from '../src/scaffold.mjs'
import { pillarOut, digStraightUp, escapeStairUp, upwardDigFloodRisk, refusalEscalation,
         climbNeedAbove, floodBranch, ceilingFloodRisk, shaftCapNeedsTool, targetFloodRisk, unburyDigFor,
         unburySelf } from '../src/reflex.mjs'
import { FLOOD_RISK, FLOOD_REMEDY, climbOutcomeRoute, floodChainStep, watchClimbDig } from '../src/climbflood.mjs'
import { tapRecords } from '../src/logger.mjs'
import { shaftAscend } from '../src/skills.mjs'
const require_ = createRequire(import.meta.url)

let pass = 0, fail = 0
const t = (name, fn) => Promise.resolve()
  .then(fn)
  .then(() => { pass++; console.log(`  PASS  ${name}`) })
  .catch(e => { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) })

const SCAFFOLD_PATH = new URL('../src/scaffold.mjs', import.meta.url)
const REFLEX_PATH = new URL('../src/reflex.mjs', import.meta.url)
const CLIMBFLOOD_PATH = new URL('../src/climbflood.mjs', import.meta.url)
const SKILLS_PATH = new URL('../src/skills.mjs', import.meta.url)

// VERBATIM from escape-stair.test.mjs: a separate module, never src/ in place, and the anchor must be present AND
// unique -- a mutant that silently fails to apply reads as killed.
async function withMutant (path, old, neu, fn) {
  const src = readFileSync(path, 'utf8')
  assert.ok(src.includes(old),
    `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 60))} is not in ${path.pathname}. ` +
    'A mutant that was never written reads as killed.')
  assert.ok(src.split(old).length === 2, 'the mutation target is not unique; the mutant is ambiguous')
  const body = src.replace(old, neu).replace(/from '\.\//g, "from '../src/")
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, body)
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}

/** Several anchored replacements in one mutant module; every anchor present AND unique, applied in order. */
async function withMutants (path, pairs, fn) {
  let src = readFileSync(path, 'utf8')
  for (const [old, neu] of pairs) {
    assert.ok(src.includes(old), `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 60))}`)
    assert.ok(src.split(old).length === 2, 'the mutation target is not unique; the mutant is ambiguous')
    src = src.replace(old, neu)
  }
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, src.replace(/from '\.\//g, "from '../src/"))
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}

// --- terrain ---------------------------------------------------------------------------------------------------

const DIG_MS = { stone: 7500, cobblestone: 10_000, deepslate: 15_000, dirt: 750, gravel: 3000, sand: 2500 }
const BARE_HANDED = /^(dirt|sand|gravel)$/
const WATERLOGGED = { oak_stairs_wl: 'oak_stairs' }
function blk (name, pos) {
  if (name === null) return null                      // an unloaded chunk
  if (name === 'air' || !name) return { name: 'air', boundingBox: 'empty', position: pos }
  if (/^(water|lava|flowing_lava|flowing_water|bubble_column|kelp)$/.test(name)) return { name, boundingBox: 'empty', position: pos }
  if (name === 'bedrock') return { name, boundingBox: 'block', position: pos, diggable: false, digTime: () => null }
  if (WATERLOGGED[name]) {
    return { name: WATERLOGGED[name], boundingBox: 'block', isWaterlogged: true, position: pos, diggable: true,
             digTime: () => 3000, canHarvest: () => true }
  }
  return { name, boundingBox: 'block', position: pos, diggable: true,
           digTime: () => DIG_MS[name] ?? 7500,
           canHarvest: type => (BARE_HANDED.test(name) ? true : type === 101) }
}
const V = (x, y, z) => ({ x, y, z, offset: (a, b, c) => V(x + a, y + b, z + c), clone: () => V(x, y, z),
                          floored: () => V(Math.floor(x), Math.floor(y), Math.floor(z)),
                          distanceTo: o => Math.hypot(x - o.x, y - o.y, z - o.z) })
function world (cells = {}, { fill = 'stone' } = {}) {
  const m = new Map(Object.entries(cells))
  return {
    get (x, y, z) { const k = `${x},${y},${z}`; return m.has(k) ? m.get(k) : fill },
    set (x, y, z, name) { m.set(`${x},${y},${z}`, name) },
  }
}
/** `at` relative to the BLOCK TO BE BROKEN, from a world keyed on the bot's feet, for the pure predicate. */
const atCell = (w, cx, cy, cz) => (x, y, z) => blk(w.get(cx + x, cy + y, cz + z), V(cx + x, cy + y, cz + z))
const atFeet = w => (x, y, z) => blk(w.get(x, y, z), V(x, y, z))

/** The design's fixture (sandbox/fixtures/synthetic-entombed.json in shape): a 1x1 stone cell, ceiling at feet+2. */
const TOMB = (extra = {}) => world({ '0,0,0': 'air', '0,1,0': 'air', ...extra })
const WET_POCKET = { '0,3,0': 'water', '1,3,0': 'water', '0,4,0': 'water', '1,4,0': 'water',
                     '0,3,1': 'water', '1,3,1': 'water', '0,4,1': 'water', '1,4,1': 'water' }   // scene A: 2x2x2 above
const WET_ALL = {}                                                                              // scene C: 3x3x2 above
for (const x of [-1, 0, 1]) for (const z of [-1, 0, 1]) for (const y of [3, 4]) WET_ALL[`${x},${y},${z}`] = 'water'
const rows = []
tapRecords(r => { if (/^_climb_flood_/.test(r?.skill?.name ?? '')) rows.push(r.skill) })

const Y0 = 40
const COBBLE = n => ({ name: 'cobblestone', count: n, type: 1 })
const PICK = (left = 100) => ({ name: 'stone_pickaxe', count: 1, type: 101, maxDurability: 131, durabilityUsed: 131 - left })
const BUCKET = { name: 'bucket', count: 1, type: 900 }

/** A bot that digs, pillars (a placed block lifts it one), and walks a ramp step when the geometry allows. */
function makeBot (w, { y = Y0, inv = [], held = null, canPath = false, onDig = null, onHand = null, onLook = null,
                         digThrows = null } = {}) {
  const digs = [], placed = [], controls = []
  let yaw = 0
  const rel = p => ({ x: Math.floor(p.x), y: Math.floor(p.y) - y, z: Math.floor(p.z) })
  const bot = {
    digs, placed, controls, world: w, pendingPrereq: undefined,
    entity: { position: V(0, y, 0), get yaw () { return yaw }, onGround: true, isInWater: false },
    health: 20,
    heldItem: held,
    inventory: { items: () => inv.filter(i => i.count > 0), emptySlotCount: () => 36 - inv.length },
    blockAt (p) { const r = rel(p); return blk(w.get(r.x, r.y, r.z), V(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z))) },
    async unequip () { bot.heldItem = null; onHand?.(w, bot) },
    async equip (item) { bot.heldItem = item; onHand?.(w, bot) },
    async dig (b) {
      const r = rel(b.position)
      if (digThrows?.(`${r.x},${r.y},${r.z}`, bot)) throw new Error('Digging aborted')
      digs.push({ cell: `${r.x},${r.y},${r.z}`, name: b.name, held: bot.heldItem?.name ?? null })
      w.set(r.x, r.y, r.z, 'air')
      onDig?.(`${r.x},${r.y},${r.z}`, w)
    },
    async placeBlock (below, face) {
      const r = rel(below.position ?? below)
      const it = inv.find(i => i.name === bot.heldItem?.name && i.count > 0)
      if (!it) throw new Error('nothing to place')
      it.count--
      w.set(r.x, r.y + 1, r.z, it.name)
      placed.push(`${r.x},${r.y + 1},${r.z}`)
      const p = bot.entity.position
      bot.entity.position = V(p.x, p.y + 1, p.z)
    },
    stopDigging () {}, clearControlStates () { controls.push('clear') },
    async look (a) { yaw = a; onLook?.(w, bot) }, async lookAt () {},
    setControlState (name, on) {
      controls.push(`${name}:${on}`)
      if (name !== 'forward' || !on) return
      const bear = [{ x: 0, z: -1 }, { x: -1, z: 0 }, { x: 0, z: 1 }, { x: 1, z: 0 }][((Math.round(yaw / (Math.PI / 2)) % 4) + 4) % 4]
      const p = rel(bot.entity.position)
      const at = (dx, dy, dz) => blk(w.get(p.x + dx, p.y + dy, p.z + dz), null)
      const clear = b => b && b.boundingBox === 'empty'
      const q = bot.entity.position
      // a LEVEL step (the flood sidestep: tread below, feet and head clear) or a step UP (the ramp)
      if (at(bear.x, -1, bear.z)?.boundingBox === 'block' && clear(at(bear.x, 0, bear.z)) && clear(at(bear.x, 1, bear.z))) {
        bot.entity.position = V(q.x + bear.x, q.y, q.z + bear.z); return
      }
      if (at(bear.x, 0, bear.z)?.boundingBox !== 'block' || !clear(at(bear.x, 1, bear.z)) || !clear(at(bear.x, 2, bear.z))) return
      bot.entity.position = V(q.x + bear.x, q.y + 1, q.z + bear.z)
    },
    pathfinder: { thinkTimeout: 1000, setGoal () {}, stop () {},
                  getPathTo () { return canPath ? { path: [1, 2, 3] } : { path: [] } } },
  }
  return bot
}
const wetCells = (bot, w) => {
  const p = bot.entity.position
  return [0, 1].map(dy => w.get(Math.floor(p.x), Math.floor(p.y) - Y0 + dy, Math.floor(p.z))).filter(n => /water|lava/.test(n))
}

// ================================================================================================================
// C. THE CHAIN, NOT THE GUARD.
// ================================================================================================================

await t('ROUTE: a flood refusal has its own branch -- never the failure counter, never a material refusal', () => {
  assert.strictEqual(climbOutcomeRoute(FLOOD_RISK), 'flood')
  assert.strictEqual(climbOutcomeRoute('needs_blocks'), 'refusal')
  assert.strictEqual(climbOutcomeRoute('needs_pickaxe'), 'refusal')
  assert.strictEqual(climbOutcomeRoute('preempted'), 'preempted')
  for (const o of [undefined, null, 'exhausted', 'threw']) assert.strictEqual(climbOutcomeRoute(o), 'attempt', String(o))
})

await t('THE BRANCH NEVER ASKS FOR A PREREQUISITE, and backs off on the EXISTING curve without spinning', () => {
  let prev = 0
  for (let n = 1; n <= 60; n++) {
    const s = floodChainStep({ refusals: n, stair: { steps: 0 } })
    assert.strictEqual(s.prereq, null, `refusal ${n} asked for something`)
    assert.strictEqual(s.refused, true)
    assert.strictEqual(s.remedy, FLOOD_REMEDY)
    assert.ok(s.backoffMs >= prev, `the back-off fell at refusal ${n}`)
    assert.ok(s.backoffMs > 0 && s.backoffMs <= 10 * 60_000)
    assert.strictEqual(s.backoffMs, refusalEscalation({ refusals: n }).backoffMs,
      'not the same curve the material refusals use')
    prev = s.backoffMs
  }
  const ok = floodChainStep({ refusals: 7, stair: { steps: 2 } })
  assert.deepStrictEqual([ok.progressed, ok.refused, ok.backoffMs, ok.prereq], [true, false, 0, null],
    'a ramp that cut a step is progress: no row, no back-off')
})

await t('THE REMEDY IS ONE THE BOT CAN PERFORM FROM WHERE IT IS: sideways/down or wait, never "get" anything', () => {
  assert.match(FLOOD_REMEDY, /sideways|down/)
  assert.doesNotMatch(FLOOD_REMEDY, /pickaxe|gather|craft|blocks/)
})

/** One firing of the handlers' flood path, as the handlers run it: the pillar, its route, then `floodBranch`. */
async function firing (bot, refusals) {
  const out = await pillarOut(bot, climbNeedAbove((x, y, z) => bot.blockAt(V(x, y, z)), bot.entity.position))
  if (climbOutcomeRoute(out) !== 'flood') return { route: climbOutcomeRoute(out), out }
  return { route: 'flood', ...(await floodBranch(bot, { handler: 'entombed', refusals })) }
}

await t('THE CHAIN, SCENE C (six firings): dry, in place, nothing dug, no prerequisite, a growing back-off, one row each', async () => {
  // The kit the drowned bots carried: 100 of 109 held a pickaxe, 98 held >= 8 blocks, 89 an empty bucket.
  const w = TOMB(WET_ALL)
  const bot = makeBot(w, { inv: [PICK(100), COBBLE(64), BUCKET] })
  const p0 = { ...bot.entity.position }
  rows.length = 0
  let refusals = 0, last = 0
  for (let k = 0; k < 6; k++) {
    const f = await firing(bot, refusals)
    assert.strictEqual(f.route, 'flood', `firing ${k}: ${f.out}`)
    assert.strictEqual(f.progressed, false); assert.strictEqual(f.preempted, false)
    assert.strictEqual(f.prereq, null)
    assert.strictEqual(f.refusals, refusals + 1)
    assert.strictEqual(f.dry, true, 'the refusal row would claim dry for a wet bot')
    assert.ok(f.backoffMs >= last && f.backoffMs > 0, 'spin: the back-off shrank or vanished')
    refusals = f.refusals; last = f.backoffMs
  }
  assert.strictEqual(bot.pendingPrereq, undefined, 'something in the chain asked the goal layer for an item')
  assert.deepStrictEqual(bot.digs, [], 'the chain dug into the pocket')
  assert.deepStrictEqual(bot.placed, [])
  assert.strictEqual(w.get(0, 2, 0), 'stone', 'the refused cell was breached')
  assert.deepStrictEqual(wetCells(bot, w), [], 'the bot is wet')
  assert.deepStrictEqual([bot.entity.position.x, bot.entity.position.y, bot.entity.position.z], [p0.x, p0.y, p0.z])
  const refused = rows.filter(r => r.name === '_climb_flood_refused')
  assert.strictEqual(refused.length, 6, 'one refusal row per back-off')
  for (const r of refused) {
    assert.ok(r.detail.length <= 300)
    assert.match(r.detail, /prereq=none dry=1/)
    assert.ok(r.detail.includes(FLOOD_REMEDY), `the remedy was cut by the 300-char cap: ${r.detail}`)
  }
  assert.strictEqual(rows.filter(r => r.name === '_climb_flood_ramp').length, 6)
})

await t('THE CHAIN, SCENE A: the same kit leaves the wet cell sideways and climbs out dry; the refused cell is never dug', async () => {
  const w = TOMB(WET_POCKET)
  const bot = makeBot(w, { inv: [PICK(100), COBBLE(64), BUCKET] })
  const f = await firing(bot, 0)
  assert.strictEqual(f.route, 'flood')
  assert.strictEqual(f.progressed, true, `the ramp did not move the bot: ${f.stair?.stopped}`)
  assert.strictEqual(f.refusals, 0)
  assert.ok(f.stair.sidestepped === 1 && f.stair.steps > 0, JSON.stringify(f.stair))
  assert.ok(!bot.digs.some(d => d.cell === '0,2,0'))
  assert.ok(bot.entity.position.y > Y0, 'no height gained')
  assert.deepStrictEqual(wetCells(bot, w), [])
  assert.strictEqual(bot.pendingPrereq, undefined)
})

await t('PREEMPTED IS NOT A REFUSAL: the drowning rescue taking the body counts nothing and backs nothing off (Codex r1)', async () => {
  rows.length = 0
  const bot = makeBot(TOMB(WET_ALL), { inv: [PICK(), COBBLE(64)] })
  const f = await floodBranch(bot, { handler: 'entombed', refusals: 3, yieldTo: () => 'drowning' })
  assert.deepStrictEqual([f.preempted, f.progressed, f.refusals, f.backoffMs, f.prereq], [true, false, 3, 0, null])
  assert.strictEqual(rows.filter(r => r.name === '_climb_flood_refused').length, 0, 'a yielded ramp was logged as "stayed dry"')
})

await t('THE GIVE-UP ARM AND THE MAROON STATE SEE A WET CEILING AS NOT-A-TOOL-PROBLEM', async () => {
  const wet = makeBot(TOMB({ '0,3,0': 'water' }), { inv: [] })
  assert.match(String(ceilingFloodRisk(wet)), /liquid above/)
  assert.strictEqual(ceilingFloodRisk(makeBot(TOMB(), { inv: [] })), null)
  // an open shaft capped by stone 3 above, no tool: a dry cap asks for a pickaxe; a wet cap does not
  const shaft = extra => TOMB({ '0,2,0': 'air', ...extra })
  assert.ok(shaftCapNeedsTool(makeBot(shaft({}), { inv: [] })), 'POSITIVE CONTROL: a dry stone cap with no tool is a tool problem')
  assert.strictEqual(shaftCapNeedsTool(makeBot(shaft({ '0,4,0': 'water' }), { inv: [] })), null,
    'a wet cap was reported as needing a pickaxe')
})

await t('THE OUTCOME WATCH: a breach row only for the same live body, labelled exempt when submerged (Codex r1)', async () => {
  const w = TOMB({ '0,2,0': 'water' })
  const cell = V(0, Y0 + 2, 0)
  rows.length = 0
  const a = makeBot(w); watchClimbDig(a, { caller: 'pillar_out', cell, before: 'stone', delayMs: 5 })
  const b = makeBot(w); watchClimbDig(b, { caller: 'pillar_out', cell, before: 'stone', delayMs: 5 }); b.entity = { ...b.entity }
  const c = makeBot(w); watchClimbDig(c, { caller: 'pillar_out', cell, before: 'stone', delayMs: 5 }); c.health = 0
  const d = makeBot(w); watchClimbDig(d, { caller: 'pillar_out', cell, before: 'stone', submerged: true, delayMs: 5 })
  const e = makeBot(TOMB()); watchClimbDig(e, { caller: 'pillar_out', cell, before: 'stone', delayMs: 5 })
  await new Promise(r => setTimeout(r, 40))
  const br = rows.filter(r => r.name === '_climb_flood_breach' && r.detail.includes(`cell=0,${Y0 + 2},0 `)).map(r => r.detail)
  assert.strictEqual(br.length, 2, JSON.stringify(br))
  assert.match(br[0], /caller=pillar_out .*before=stone liquid=water submerged=0 exempt=0/)
  assert.match(br[1], /submerged=1 exempt=1/)
})

await t('POSITIVE CONTROL FOR THE CHAIN: the same kit under a DRY ceiling climbs (the regression arm, scene F)', async () => {
  const bot = makeBot(TOMB(), { inv: [PICK(100), COBBLE(64), BUCKET] })
  const out = await pillarOut(bot, 3)
  assert.notStrictEqual(climbOutcomeRoute(out), 'flood')
  assert.ok(bot.entity.position.y > Y0, 'it did not climb')
})

// ================================================================================================================
// D. WIRING. Behaviour cannot reach the two handlers: they live inside startReflexes' 500 ms interval behind
//    throttles and a live path search. Structural assertions, comments stripped (this codebase's comments quote the
//    code), anchored on executable lines, each seen to fail by a mutant below.
// ================================================================================================================

const strip = src => src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter(l => !l.trim().startsWith('//')).join('\n')
const ENT_FLOOD = "          else if (climbOutcomeRoute(climbed) === 'flood') {"
const GIVEUP = 'if (escapeFailures >= ESCAPE_GIVE_UP_AFTER && !ceilingFloodRisk(bot)) {'
const MAR_FLOOD = "          } else if (climbOutcomeRoute(pillarOutcome) === 'flood') {"
function branch (code, open, closeAt) {
  const i = code.indexOf(open)
  if (i < 0) return null
  const j = code.indexOf(closeAt, i + open.length)
  return code.slice(i, j < 0 ? i + 4000 : j)
}
function assertEntombedWired (code) {
  const b = branch(code, ENT_FLOOD, "else if (climbed === 'preempted')")
  assert.ok(b, 'the entombed handler has no flood branch: flood_risk falls into the failure counter and the pickaxe ask')
  assert.match(b, /await floodBranch\(bot, \{ handler: 'entombed'/, 'the flood branch does not run floodBranch')
  assert.match(b, /lastEscapeAt = Date\.now\(\) \+ fb\.backoffMs/, 'no back-off: the branch would spin')
  assert.match(b, /if \(fb\.preempted\) \{[^}]*\}\s*else if \(fb\.progressed\)/, 'preemption must be decided before progress (a preempted ramp resets nothing)')
  assert.doesNotMatch(b, /pendingPrereq/, 'the flood branch asks the goal layer for an item')
  assert.doesNotMatch(b, /escapeFailures\+\+/, 'the flood branch feeds the failure counter (four of those ask for a pickaxe)')
  assert.ok(code.indexOf(ENT_FLOOD) < code.indexOf("isEntombed(bot))) escapeFailures++"),
    'the flood branch must be decided before the failure counter')
  assert.ok(code.includes(GIVEUP), 'the give-up arm asks for a pickaxe even under a wet ceiling')
}
function assertMaroonedWired (code) {
  const b = branch(code, MAR_FLOOD, "noteReflexInventory(bot, invBefore, 'maroon_escape')")
  assert.ok(b, 'the marooned handler has no flood branch: the refusal is silently dropped')
  assert.match(b, /await floodBranch\(bot, \{ handler: 'marooned'/)
  assert.match(b, /lastMaroonCheck = Date\.now\(\) \+ fb\.backoffMs/)
  assert.doesNotMatch(b, /pendingPrereq/)
}

await t('WIRED: the entombed handler routes flood_risk to its own branch (ramp, back-off, no ask)', () => {
  assertEntombedWired(strip(readFileSync(REFLEX_PATH, 'utf8')))
})
await t('WIRED: the marooned handler routes flood_risk to the same branch', () => {
  assertMaroonedWired(strip(readFileSync(REFLEX_PATH, 'utf8')))
})
await t('MUTANT KILLED: unwiring the entombed flood branch is caught, for the right reason', () => {
  const src = readFileSync(REFLEX_PATH, 'utf8')
  assert.ok(src.includes(ENT_FLOOD), 'ANCHOR MISSING'); assert.strictEqual(src.split(ENT_FLOOD).length, 2, 'anchor not unique')
  const mutated = strip(src.replace(ENT_FLOOD, '          else if (false) {'))
  assert.throws(() => assertEntombedWired(mutated), /no flood branch/)
})
await t('MUTANT KILLED: unwiring the marooned flood branch is caught', () => {
  const src = readFileSync(REFLEX_PATH, 'utf8')
  assert.ok(src.includes(MAR_FLOOD), 'ANCHOR MISSING'); assert.strictEqual(src.split(MAR_FLOOD).length, 2, 'anchor not unique')
  assert.throws(() => assertMaroonedWired(strip(src.replace(MAR_FLOOD, '          } else if (false) {'))), /no flood branch/)
})
await t('MUTANT KILLED: a prerequisite ask inside the entombed flood branch is caught', () => {
  const src = readFileSync(REFLEX_PATH, 'utf8')
  const A = '            else { escapeFailures = 0; lastEscapeAt = Date.now() + fb.backoffMs }'
  assert.ok(src.includes(A), 'ANCHOR MISSING'); assert.strictEqual(src.split(A).length, 2, 'anchor not unique')
  const mutated = strip(src.replace(A, A + "\n            bot.pendingPrereq = { items: ['stone_pickaxe'], count: 2 }"))
  assert.throws(() => assertEntombedWired(mutated), /asks the goal layer/)
})
await t('MUTANT KILLED: progress decided before preemption in the entombed caller is caught', () => {
  const src = readFileSync(REFLEX_PATH, 'utf8')
  const P = '            if (fb.preempted) { /* the drowning rescue took the body: not this branch\'s outcome (Codex r3) */ }\n            else if (fb.progressed) {'
  assert.ok(src.includes(P), 'ANCHOR MISSING'); assert.strictEqual(src.split(P).length, 2, 'anchor not unique')
  const mutated = strip(src.replace(P, '            if (false) { }\n            else if (fb.progressed) {'))
  assert.throws(() => assertEntombedWired(mutated), /preemption must be decided before progress/)
})
await t('MUTANT KILLED: the give-up arm without the wet-ceiling skip is caught', () => {
  const src = readFileSync(REFLEX_PATH, 'utf8')
  assert.ok(src.includes(GIVEUP), 'ANCHOR MISSING'); assert.strictEqual(src.split(GIVEUP).length, 2, 'anchor not unique')
  assert.throws(() => assertEntombedWired(strip(src.replace(GIVEUP, 'if (escapeFailures >= ESCAPE_GIVE_UP_AFTER) {'))), /give-up arm/)
})

// ================================================================================================================
// F. climbflood-02: ICE, THE WHOLE FALLING COLUMN, THE SERVER'S ANSWER, SIDEWAYS BEFORE THE OWN CELL (fleet 10-06)
// ================================================================================================================

await t('ICE IS LATENT WATER: ice over a solid block refuses; ice over air (a ceiling) does not melt; packed ice is stone', () => {
  // fleet 10-06 04:59Z hive-d-Alpha: a ramp step broke ice that sat on sand and the cell was water 1.6 s later
  const w = TOMB({ '0,2,0': 'air', '0,3,0': 'air', '1,2,0': 'ice', '1,1,0': 'sand' })
  assert.match(String(overheadBreakRisk({ at: atCell(w, 1, 2, 0) })), /ice overhead melts into water/)
  assert.strictEqual(overheadBreakRisk({ at: atCell(TOMB({ '0,2,0': 'ice' }), 0, 2, 0) }), null,
    'a ceiling of ice over the bot\'s own (air) head cell vanishes when broken -- vanilla does not melt it')
  assert.strictEqual(overheadBreakRisk({ at: atCell(TOMB({ '1,2,0': 'packed_ice', '1,1,0': 'sand' }), 1, 2, 0) }), null,
    'packed ice never melts')
  assert.match(String(overheadBreakRisk({ at: atCell(TOMB({ '0,3,0': 'ice' }), 0, 2, 0) })), /liquid above the block overhead \(ice\)/,
    'ice beside or above an opened cell counts as water (conservative: the next dig or light melts it)')
  assert.strictEqual(overheadBreakRisk({ at: atCell(TOMB({ '1,2,0': 'ice', '1,1,0': 'sand' }), 1, 2, 0), submerged: true }), null,
    'the submerged exemption covers ice as it covers water')
})

await t('THE FLEET RAMP STEP (04:59:31Z): an ice headroom cell on sand closes the bearing; nothing on it is dug', async () => {
  const cells = { '0,0,0': 'air', '0,1,0': 'air', '0,2,0': 'air', '0,3,0': 'air', '1,2,0': 'ice', '1,1,0': 'sand' }
  for (const [x, z] of [[-1, 0], [0, 1], [0, -1]]) { cells[`${x},1,${z}`] = 'bedrock'; cells[`${x},2,${z}`] = 'bedrock' }
  const step = stairUpStep({ at: atFeet(world(cells)), bear: { x: 1, z: 0 } })
  assert.strictEqual(step.ok, false); assert.strictEqual(step.flood, true); assert.match(step.reason, /ice overhead melts/)
  const bot = makeBot(world(cells))
  const r = await escapeStairUp(bot, { maxSteps: 1, budgetMs: 20_000 })
  assert.ok(!bot.digs.some(d => d.cell === '1,2,0' || d.cell === '1,1,0'), `it dug the ice or the sand under it: ${JSON.stringify(bot.digs)}`)
  assert.strictEqual(r.flood, 'ramp_step')
})

await t('THE WHOLE FALLING COLUMN (03:09Z): sand three deep with water on top refuses; dry on top digs', () => {
  const wet = TOMB({ '0,2,0': 'sand', '0,3,0': 'sand', '0,4,0': 'sand', '0,5,0': 'water' })
  assert.match(String(overheadBreakRisk({ at: atCell(wet, 0, 2, 0) })), /over the falling block above the block overhead \(water\)/)
  const dry = TOMB({ '0,2,0': 'sand', '0,3,0': 'sand', '0,4,0': 'sand' })
  assert.strictEqual(overheadBreakRisk({ at: atCell(dry, 0, 2, 0) }), null, 'POSITIVE CONTROL: a dry column is dug')
  const side = TOMB({ '0,2,0': 'stone', '0,3,0': 'gravel', '0,4,0': 'gravel', '0,5,0': 'gravel', '1,5,0': 'water' })
  assert.match(String(overheadBreakRisk({ at: atCell(side, 0, 2, 0) })), /beside the falling block above/,
    'water beside the third block of the column: it is a face of the shaft once the column drops')
})

await t('THE SERVER\'S ANSWER (04:59:35Z): water arriving AFTER the dig resolved stops the next dig of the plan', async () => {
  // mineflayer marks the dug cell air at once; the melt/flow arrives later. 100 ms here, inside FLOW_SETTLE_MS.
  const cells = { '0,0,0': 'air', '0,1,0': 'air', '0,2,0': 'air', '0,3,0': 'air' }
  for (const [x, z] of [[-1, 0], [0, 1], [0, -1]]) { cells[`${x},1,${z}`] = 'bedrock'; cells[`${x},2,${z}`] = 'bedrock' }
  const late = (cell, ww) => { if (cell === '1,3,0') setTimeout(() => ww.set(1, 3, 0, 'water'), 100) }
  const bot = makeBot(world(cells), { onDig: late })
  await escapeStairUp(bot, { maxSteps: 1, budgetMs: 20_000 })
  assert.deepStrictEqual(bot.digs.map(d => d.cell), ['1,3,0'], `it dug under water the server sent after the dig: ${JSON.stringify(bot.digs)}`)
  await withMutant(REFLEX_PATH, '    if (!failed) await sleep(FLOW_SETTLE_MS)', '', async mod => {
    const m = makeBot(world({ ...cells }), { onDig: late })
    await mod.escapeStairUp(m, { maxSteps: 1, budgetMs: 20_000 })
    assert.ok(m.digs.some(d => d.cell === '1,2,0'), `the mutant still waited: ${JSON.stringify(m.digs)}`)
  })
})

await t('BURIED UNDER A WET FALLING COLUMN WITH AN OPEN SIDE: it steps out and never digs its own cell (03:10Z)', async () => {
  const open = () => TOMB({ '0,1,0': 'gravel', '0,2,0': 'gravel', '0,3,0': 'water', '-1,0,0': 'air', '-1,1,0': 'air' })
  const bot = makeBot(open(), { inv: [PICK(), COBBLE(64)] })
  const r = await escapeStairUp(bot, { maxSteps: 1, budgetMs: 30_000 })
  assert.strictEqual(r.sidestepped, 1, r.stopped)
  assert.ok(!bot.digs.some(d => d.cell === '0,1,0' || d.cell === '0,2,0'), `it dug into the wet column: ${JSON.stringify(bot.digs)}`)
  await withMutant(REFLEX_PATH, '        if (buriedAt() && !openSide) {', '        if (buriedAt()) {', async mod => {
    const m = makeBot(open(), { inv: [PICK(), COBBLE(64)] })
    await mod.escapeStairUp(m, { maxSteps: 1, budgetMs: 30_000 })
    assert.ok(m.digs.some(d => d.cell === '0,1,0'), 'the mutant did not dig the own cell first')
  })
})

await t('BURIED, AND THE ONLY SIDE MUST BE DUG FIRST: the own cell is dug BEFORE any side swing (Codex: ~15 s buried is not a rescue)', async () => {
  const bot = makeBot(TOMB({ '0,1,0': 'gravel', '0,2,0': 'gravel', '0,3,0': 'water' }), { inv: [PICK(), COBBLE(64)] })
  await escapeStairUp(bot, { maxSteps: 1, budgetMs: 30_000 })
  const own = bot.digs.findIndex(d => d.cell === '0,1,0')
  assert.ok(own === 0, `the first dig must be the bot's own head cell: ${JSON.stringify(bot.digs)}`)
})

await t('A FAILED SIDESTEP STILL UNBURIES: an open side the bot cannot walk into leaves the own-cell fallback to run', async () => {
  // the side is open in the world but the walk never lands (the fake refuses to move: a mob, a stale block)
  const bot = makeBot(TOMB({ '0,1,0': 'gravel', '0,2,0': 'gravel', '0,3,0': 'water', '-1,0,0': 'air', '-1,1,0': 'air' }), { inv: [PICK()] })
  bot.setControlState = (name, on) => { bot.controls.push(`${name}:${on}`) }
  const r = await escapeStairUp(bot, { maxSteps: 1, budgetMs: 30_000 })
  assert.match(String(r.stopped), /sidestep failed/)
  assert.ok(bot.digs.some(d => d.cell === '0,1,0'), `the buried head cell was left after the failed sidestep: ${JSON.stringify(bot.digs)}`)
  const FALLBACK = "            if (buriedAt() && await unburyHere()) { stopped = `yielded the body to ${yielded}`; return finish() }"
  await withMutant(REFLEX_PATH, FALLBACK, '', async mod => {
    const m = makeBot(TOMB({ '0,1,0': 'gravel', '0,2,0': 'gravel', '0,3,0': 'water', '-1,0,0': 'air', '-1,1,0': 'air' }), { inv: [PICK()] })
    m.setControlState = (name, on) => { m.controls.push(`${name}:${on}`) }
    await mod.escapeStairUp(m, { maxSteps: 1, budgetMs: 30_000 })
    assert.ok(!m.digs.some(d => d.cell === '0,1,0'), 'the mutant still unburied')
  })
})

const M_ICE_T = '  if (isMeltingIce(target) && !submerged) {'
const M_ICE_N = '  const wet = b => (isWaterCell(b) || isMeltingIce(b)) && !submerged'
const M_COL = '    while (k <= FALLING_COLUMN_CAP && isFallingBlock(at(0, k, 0))) k++'
await t('MUTANTS KILLED: ice target, ice neighbour, the column walk', async () => {
  await withMutant(SCAFFOLD_PATH, M_ICE_T, '  if (false) {', async mod => {
    assert.strictEqual(mod.overheadBreakRisk({ at: atCell(TOMB({ '1,2,0': 'ice', '1,1,0': 'sand' }), 1, 2, 0) }), null)
  })
  await withMutant(SCAFFOLD_PATH, M_ICE_N, '  const wet = b => isWaterCell(b) && !submerged', async mod => {
    assert.strictEqual(mod.overheadBreakRisk({ at: atCell(TOMB({ '0,3,0': 'ice' }), 0, 2, 0) }), null)
  })
  await withMutant(SCAFFOLD_PATH, M_COL, '    if (isFallingBlock(at(0, 1, 0))) k = 2', async mod => {
    assert.strictEqual(mod.overheadBreakRisk({ at: atCell(TOMB({ '0,2,0': 'sand', '0,3,0': 'sand', '0,4,0': 'sand', '0,5,0': 'water' }), 0, 2, 0) }), null)
  })
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
