// WHY DOES A GATHERING BOT STILL ARRIVE OUT OF REACH?
//
// The goal was fixed first: GoalNear(p,2) -> reachGoal took the rate from
// 17.35% to 11.99% of gather attempts. It then stopped moving. Measured on the
// fleet, 90-minute window, sha e2b18f0, full walk of /var/log/mcai/*/skill-*.jsonl:
// 480 of 2,561 gather runs (18.74%) across 70 of 80 bots carried at least one
// `arrived_out_of_reach`, 861 refusal segments in all -- against ZERO
// `dig_unconfirmed`, ZERO `target_changed` and ZERO `target_undiggable` from the
// same reachRefusal call in the same scan. Same query, so those are readings and
// not blind spots: the block is still there, it is still breakable, and once the
// bot is in reach the dig lands. It is purely an ARRIVAL problem.
//
// THE SCENES BELOW ARE REAL. test/fixtures/aoor-scenes.json is six of those 480
// refusals with the world around them: the bot's own recorded position, the
// block it was refused at, and every cell of the surrounding box read off the
// live servers over RCON (`execute if block ... run time query daytime`,
// read-only, four controls per pool, zero unloaded cells). The distance the
// fleet logged is reproduced from the fixture below, which is what makes them
// reconstructions rather than sketches.
//
// WHAT THE MEASUREMENT SAID, over 48 such scenes, real Movements + real AStar:
//
//   walk profile (canDig=false) + reachGoal    arrives 10/48   (20.8%)
//   gather profile (canDig=true) + reachGoal   arrives 47/48   (97.9%)
//
// In 35 of the 48 a legal mining stance EXISTED -- clear feet, clear head, solid
// footing, eye inside the server's 5.1 -- and was not walk-connected to the bot.
// The wall was the whole remaining defect, and `gather` lost its permission to
// break one when it stopped calling mineflayer-collectblock.
import assert from 'node:assert'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { createRequire } from 'node:module'
import { Vec3 } from 'vec3'
import { mkWorld, mkBot, fleetMovements, inReach, standable, goals } from './helpers/reachlab.mjs'
import { approachDigCount, approachVerdict, planDigApproach,
         APPROACH_SLACK, MAX_APPROACH_DIG, APPROACH_TIMEOUT_MS } from '../src/digapproach.mjs'
import { reachGoal, nodeToBlock, eyeToBlock, STANCE_REACH } from '../src/digreach.mjs'

process.env.OLLAMA_MODEL ??= 'qwen2.5:7b-instruct'
const require_ = createRequire(import.meta.url)
const AStar = require_('mineflayer-pathfinder/lib/astar')

let pass = 0, fail = 0
const t = (name, fn) => {
  try { fn(); pass++; console.log(`  PASS  ${name}`) }
  catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) }
}
const ta = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) }
  catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) }
}

// ------------------------------------------------------- the pure decisions ---

const mv = (...breaks) => ({ toBreak: breaks.map(([x, y, z]) => ({ x, y, z })) })

t('the dig count is DISTINCT blocks, not toBreak entries', () => {
  // pathfinder lists the same block on every move that needs it gone. Counting
  // those twice would refuse an approach that breaks one block.
  assert.equal(approachDigCount([mv([1, 2, 3]), mv([1, 2, 3]), mv([1, 2, 3])]), 1)
  assert.equal(approachDigCount([mv([1, 2, 3], [1, 3, 3]), mv([2, 2, 3])]), 3)
})

t('a path that breaks nothing counts zero, and junk does not throw', () => {
  assert.equal(approachDigCount([{ x: 1 }, { toBreak: [] }]), 0)
  assert.equal(approachDigCount([]), 0)
  assert.equal(approachDigCount(null), 0)
  assert.equal(approachDigCount([null, undefined, { toBreak: [null] }]), 0)
})

t('coordinates are floored before they are counted', () => {
  assert.equal(approachDigCount([mv([1.2, 2.9, 3.1]), mv([1.8, 2.1, 3.9])]), 1,
    'the same block reported at two sub-block offsets is one block')
})

t('a search that did not succeed is never walked', () => {
  for (const status of ['noPath', 'timeout', 'partial', undefined]) {
    const v = approachVerdict({ status, path: [], endsInReach: true })
    assert.equal(v.take, false, `${status} must not be walked`)
    assert.match(v.why, /approach search said/)
  }
})

t('a success that does not end in reach is refused', () => {
  // "the search succeeded" and "it succeeded at the thing I meant" are two
  // claims, and this repo has already paid for conflating them.
  const v = approachVerdict({ status: 'success', path: [mv([1, 2, 3])], endsInReach: false })
  assert.equal(v.take, false)
  assert.match(v.why, /does not end within reach/)
})

t('the block budget is a REFUSAL, not a preference', () => {
  const big = Array.from({ length: MAX_APPROACH_DIG + 1 }, (_, i) => mv([i, 64, 0]))
  const v = approachVerdict({ status: 'success', path: big, endsInReach: true })
  assert.equal(v.take, false)
  assert.match(v.why, new RegExp(`break ${MAX_APPROACH_DIG + 1} blocks`))
  // ...and exactly at the budget it is allowed, so the comparison is not off by one.
  const atCap = Array.from({ length: MAX_APPROACH_DIG }, (_, i) => mv([i, 64, 0]))
  const ok = approachVerdict({ status: 'success', path: atCap, endsInReach: true })
  assert.equal(ok.take, true)
  assert.equal(ok.dig, MAX_APPROACH_DIG)
})

t('a small breakthrough is taken and says how much it costs', () => {
  const v = approachVerdict({ status: 'success', path: [mv([1, 2, 3], [1, 3, 3])], endsInReach: true })
  assert.deepEqual([v.take, v.dig, v.why], [true, 2, null])
})

// ------------------------------------------------- the real fleet refusals ---

const SCENES = JSON.parse(readFileSync(new URL('./fixtures/aoor-scenes.json', import.meta.url)))
const CODE = { '.': 'air', '#': 'stone', '~': 'water', L: 'lava', ',': 'short_grass' }

function expand (s) {
  const cells = new Map()
  let i = 0, at = 0
  const { lo, hi, rle } = s
  const ny = hi[1] - lo[1] + 1, nz = hi[2] - lo[2] + 1
  while (i < rle.length) {
    let j = i
    while (j < rle.length && rle[j] >= '0' && rle[j] <= '9') j++
    const n = Number(rle.slice(i, j)), ch = rle[j]
    for (let k = 0; k < n; k++, at++) {
      if (ch === '.') continue
      const x = lo[0] + Math.floor(at / (ny * nz))
      const y = lo[1] + Math.floor((at % (ny * nz)) / nz)
      const z = lo[2] + (at % nz)
      cells.set(`${x},${y},${z}`, CODE[ch] ?? 'stone')
    }
    i = j + 1
  }
  // Outside the scanned box is treated as SOLID, which can only UNDER-state how
  // reachable anything is. Controlled: the same 16 scenes rescanned with a
  // 12-block margin instead of 4 grew the walkable set from 1-169 nodes to
  // 1-1806 and changed not one verdict below.
  const world = mkWorld((x, y, z) =>
    (x < lo[0] || x > hi[0] || y < lo[1] || y > hi[1] || z < lo[2] || z > hi[2])
      ? 'stone' : (cells.get(`${x},${y},${z}`) ?? 'air'))
  return world
}

function scene (s) {
  const world = expand(s)
  const bot = mkBot(world, new Vec3(s.pos.x, s.pos.y, s.pos.z))
  // canDig=true reaches for these two on the bot; an EMPTY-HANDED bot is the
  // honest stub, and it is the slowest case, so nothing here is flattered.
  bot.pathfinder = { bestHarvestTool: () => null }
  bot.entity.effects = {}
  const target = new Vec3(s.tgt[0], s.tgt[1], s.tgt[2])
  const start = new Vec3(Math.floor(s.pos.x), Math.floor(s.pos.y), Math.floor(s.pos.z))
  return { world, bot, target, start }
}

function search (m, start, goal, { think = 4000, slack = -1 } = {}) {
  const s = Object.assign(new Vec3(start.x, start.y, start.z),
    { remainingBlocks: 0, hash: `${start.x},${start.y},${start.z}` })
  const a = new AStar(s, m, goal, think, 40, slack)
  const t0 = Date.now()
  let r = a.compute()
  for (let i = 0; r.status === 'partial' && i < 20000 && Date.now() - t0 < think; i++) r = a.compute()
  const path = r.path ?? []
  return { status: r.status, visited: r.visitedNodes ?? 0, path,
           end: path.length ? path[path.length - 1] : s }
}
const arrives = r => r.status === 'success' && inReach(r.end, r.target)

function walk (s, { dig, slack = -1 }) {
  const { world, bot, target, start } = scene(s)
  const m = fleetMovements(bot)
  if (dig) m.canDig = true
  const r = search(m, start, reachGoal(goals, target), { slack })
  return { ...r, target, world, bot }
}

t('the fixture reproduces the distance the FLEET logged', () => {
  // If this drifts, the scenes are no longer the refusals they claim to be and
  // every number below is about something else.
  for (const s of SCENES) {
    const d = eyeToBlock(s.pos, { x: s.tgt[0], y: s.tgt[1], z: s.tgt[2] })
    assert.ok(Math.abs(d - s.loggedDist) < 0.6,
      `${s.bot}: fixture says ${d.toFixed(1)}, the fleet logged ${s.loggedDist}`)
    assert.ok(d > 5.1, `${s.bot} was not actually out of reach`)
  }
})

t('POSITIVE CONTROL: two of the six scenes ALREADY arrive on the walk profile', () => {
  // Without this the headline below ("the walk does not arrive") is unfalsifiable
  // -- a harness that cannot show an arrival cannot show a failure to arrive.
  const ok = SCENES.filter(s => arrives(walk(s, { dig: false })))
  assert.ok(ok.length >= 2,
    `only ${ok.length} scene(s) arrive on the walk profile; the lab may be walling the bot in`)
})

t('A LEGAL STANCE EXISTS in every scene the walk cannot reach', () => {
  // This is the claim that makes the fix a fix rather than a wish: the bot is
  // not being asked for the impossible, it is being refused a doorway.
  for (const s of SCENES) {
    const { world, target } = scene(s)
    let n = 0
    for (let x = s.lo[0]; x <= s.hi[0]; x++) {
      for (let y = s.lo[1]; y <= s.hi[1]; y++) {
        for (let z = s.lo[2]; z <= s.hi[2]; z++) {
          const q = new Vec3(x, y, z)
          if (inReach({ x, y, z }, target) && standable(world, q)) n++
        }
      }
    }
    assert.ok(n > 0, `${s.bot} at ${s.tgt}: no cell in the box can mine this block`)
  }
})

t('THE DEFECT: the walk profile does not arrive at four of the six', () => {
  const blocked = SCENES.filter(s => !arrives(walk(s, { dig: false })))
  assert.ok(blocked.length >= 4,
    `only ${blocked.length} of ${SCENES.length} scenes are blocked on the walk profile`)
})

t('THE FIX: the gather profile arrives at every scene the walk cannot', () => {
  const blocked = SCENES.filter(s => !arrives(walk(s, { dig: false })))
  for (const s of blocked) {
    const r = walk(s, { dig: true, slack: APPROACH_SLACK })
    assert.ok(arrives(r),
      `${s.bot} at ${s.tgt} (${s.block}): dig-enabled approach said ${r.status} ` +
      `after ${r.visited} nodes and still did not reach`)
  }
})

t('...and it breaks a WALL, not a tunnel', () => {
  for (const s of SCENES) {
    const r = walk(s, { dig: true, slack: APPROACH_SLACK })
    if (r.status !== 'success') continue
    const n = approachDigCount(r.path)
    assert.ok(n <= MAX_APPROACH_DIG,
      `${s.bot}: the approach would break ${n} blocks, over the ${MAX_APPROACH_DIG} budget`)
  }
})

t('the control scenes are NOT made to dig for something they could walk to', () => {
  // A dig-capable planner that tunnels where a walk exists is a regression, and
  // it is the exact behaviour canDig=false was turned off for.
  for (const s of SCENES.filter(x => arrives(walk(x, { dig: false })))) {
    const r = walk(s, { dig: true, slack: APPROACH_SLACK })
    assert.ok(arrives(r), `${s.bot}: the dig profile lost a scene the walk could do`)
    assert.equal(approachDigCount(r.path), 0,
      `${s.bot}: dug ${approachDigCount(r.path)} block(s) on a route that needed none`)
  }
})

t('THE COST CAP IS A COST CAP, NOT A DISTANCE', () => {
  // astar.js: this.maxCost = searchRadius < 0 ? -1 : startNode.h + searchRadius.
  // A barehanded stone dig prices near 24, so a "radius" of 16 forbids EVERY
  // dig and makes canDig=true measure identical to canDig=false. The first run
  // of this experiment did exactly that and read like "digging does not help".
  const blocked = SCENES.filter(s => !arrives(walk(s, { dig: false })))
  assert.ok(blocked.length > 0, 'no blocked scene to test the cap against')
  const tiny = blocked.filter(s => arrives(walk(s, { dig: true, slack: 16 })))
  assert.equal(tiny.length, 0,
    'slack 16 let a dig through, so this test is no longer demonstrating the trap')
  assert.ok(APPROACH_SLACK > 100,
    'APPROACH_SLACK is below the price of a single barehanded stone dig; it would be inert')
})

// -------------------------------------------------------------- the wiring ---
//
// Three times in this codebase a change read a property that did not exist,
// passed every unit test, and was caught only by a canary. So the planner is
// exercised against a fake bot that records exactly what it was handed.

const P = (x, y, z) => ({ x, y, z })
// `gatherMovements` is read with `in` rather than a destructuring default: an
// explicit `undefined` would otherwise pick the default back up, and the test
// for "the wiring rotted" would silently test a bot that still has the profile.
function fakeBot (result, opts = {}) {
  const gatherMovements = 'gatherMovements' in opts
    ? opts.gatherMovements
    : { canDig: true, tag: 'gather' }
  const seen = {}
  return {
    seen,
    entity: { position: P(0, 64, 0) },
    gatherMovements,
    pathfinder: {
      movements: { canDig: false, tag: 'travel' },
      getPathFromTo (moves, from, goal, opts) {
        seen.moves = moves; seen.goal = goal; seen.opts = opts; seen.from = from
        seen.pumps = 0
        const seq = Array.isArray(result) ? result : [result]
        return { next: () => {
          const r = seq[Math.min(seen.pumps, seq.length - 1)]
          seen.pumps++
          return { value: { result: r } }
        } }
      },
    },
  }
}
const ARGS = { goals, reachGoalFor: reachGoal, endsInReach: () => true }
const TARGET = P(3, 64, 0)

t('the search runs on the DIG profile, never the travel one', () => {
  const bot = fakeBot({ status: 'success', path: [P(2, 64, 0)] })
  planDigApproach(bot, TARGET, ARGS)
  assert.equal(bot.seen.moves.tag, 'gather', 'the approach searched with the walking movements')
  assert.equal(bot.seen.moves.canDig, true)
})

t('the search is bounded in cost AND in wall clock', () => {
  const bot = fakeBot({ status: 'success', path: [P(2, 64, 0)] })
  planDigApproach(bot, TARGET, ARGS)
  assert.equal(bot.seen.opts.searchRadius, APPROACH_SLACK)
  assert.equal(bot.seen.opts.timeout, APPROACH_TIMEOUT_MS)
})

t('the goal handed to A* is reachGoal, the same one the walk asks for', () => {
  const bot = fakeBot({ status: 'success', path: [P(2, 64, 0)] })
  planDigApproach(bot, TARGET, ARGS)
  assert.ok(bot.seen.goal instanceof goals.GoalGetToBlock)
  assert.equal(bot.seen.goal.reach, STANCE_REACH)
  assert.ok(bot.seen.goal.isEnd({ x: 2, y: 64, z: 0 }), 'the goal is not the reach test')
})

t('NO DIG PROFILE, NO APPROACH -- and that is what index.mjs can break', () => {
  // bot.gatherMovements is built in index.mjs. If that wiring rots, this must
  // become a no-op rather than a walk on the travel profile with a dig goal.
  assert.equal(planDigApproach(fakeBot({ status: 'success', path: [] },
    { gatherMovements: undefined }), TARGET, ARGS), null)
  assert.equal(planDigApproach(fakeBot({ status: 'success', path: [] },
    { gatherMovements: { canDig: false } }), TARGET, ARGS), null,
    'a profile that cannot dig is not an approach profile')
})

t('a partial search is pumped, bounded', () => {
  const bot = fakeBot([{ status: 'partial', path: [] },
                       { status: 'partial', path: [] },
                       { status: 'success', path: [P(2, 64, 0)] }])
  const r = planDigApproach(bot, TARGET, ARGS)
  assert.equal(r.status, 'success')
  assert.ok(bot.seen.pumps > 1 && bot.seen.pumps <= 5, `pumped ${bot.seen.pumps} times`)
})

t('a search that throws costs nothing', () => {
  const bot = fakeBot({ status: 'success', path: [] })
  bot.pathfinder.getPathFromTo = () => { throw new Error('boom') }
  assert.equal(planDigApproach(bot, TARGET, ARGS), null)
})

t('an over-budget plan comes back refused, not thrown away silently', () => {
  const path = Array.from({ length: MAX_APPROACH_DIG + 4 }, (_, i) => mv([i, 64, 0]))
  path.push(P(2, 64, 0))
  const r = planDigApproach(fakeBot({ status: 'success', path }), TARGET, ARGS)
  assert.equal(r.take, false)
  assert.match(r.why, /over the/)
  assert.equal(r.status, 'success', 'the caller still gets to say what A* found')
})

t('an EMPTY path on success is "already there", not "nowhere"', () => {
  const bot = fakeBot({ status: 'success', path: [] })
  const r = planDigApproach(bot, TARGET, { ...ARGS, endsInReach: n => n.x === 0 && n.y === 64 })
  assert.equal(r.take, true, 'the start node A* accepted was discarded')
})

// -------------------------------------------------- structural, and mutated ---
//
// Behaviour cannot reach these two: one is a property of index.mjs's spawn
// handler, the other is which module skills.mjs calls. Both are proved to fail
// by a mutant, because a source assertion that has never been seen to fail is
// not a test.

const INDEX_PATH = new URL('../src/index.mjs', import.meta.url)
const SKILLS_PATH = new URL('../src/skills.mjs', import.meta.url)
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

t('index.mjs builds the dig profile for EVERY bot, not only when collectBlock exists', () => {
  // It lived inside `if (bot.collectBlock)` and was handed to collectblock and
  // to nothing else, which is how gather lost its dig-capable approach without
  // anyone deciding to remove it.
  const src = strip(readFileSync(INDEX_PATH, 'utf8'))
  const i = src.indexOf('bot.gatherMovements = gatherMoves')
  const j = src.indexOf('if (bot.collectBlock)')
  assert.ok(i > 0, 'bot.gatherMovements is not assigned anywhere')
  assert.ok(j > i, 'the dig profile is still built inside the collectBlock branch')
  assert.ok(/bot\.withGatherMovements\s*=/.test(src), 'nothing can borrow the profile')
})

t('skills.mjs asks for the approach, and asks for it AFTER the cheap walk', () => {
  const src = strip(readFileSync(SKILLS_PATH, 'utf8'))
  const call = src.indexOf('planDigApproach(bot, p, {')
  const goto = src.indexOf('bot.pathfinder.goto(stance)')
  assert.ok(call > 0, 'collectManually never calls planDigApproach')
  assert.ok(goto > 0 && goto < call,
    'the dig approach runs before the free walk, which would dig where walking works')
})

async function withMutant (path, old, neu, fn) {
  const src = readFileSync(path, 'utf8')
  assert.ok(src.includes(old),
    `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 60))} is not in ${path.pathname}. ` +
    'A mutant that was never written reads as killed.')
  assert.ok(src.split(old).length === 2, 'the mutation target is not unique; the mutant is ambiguous')
  // Written into test/, never src/: the runner SIGKILLs, and an in-place mutant
  // survives on disk and fleet-recycle deploys it within six hours.
  const body = src.replace(old, neu).replace(/from '\.\//g, "from '../src/")
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, body)
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch { /* gone */ } }
}

await ta('MUTANT KILLED: dropping the block budget lets an approach tunnel', async () => {
  await withMutant(new URL('../src/digapproach.mjs', import.meta.url),
    'export const MAX_APPROACH_DIG = 16',
    'export const MAX_APPROACH_DIG = 100000',
    async mod => {
      const path = Array.from({ length: MAX_APPROACH_DIG + 4 }, (_, i) => mv([i, 64, 0]))
      const v = mod.approachVerdict({ status: 'success', path, endsInReach: true })
      assert.equal(v.take, true,
        'the mutant still refused, so the budget test above proves nothing')
    })
})

await ta('MUTANT KILLED: counting toBreak entries instead of blocks refuses a legal approach', async () => {
  await withMutant(new URL('../src/digapproach.mjs', import.meta.url),
    "      seen.add(`${Math.floor(b.x)},${Math.floor(b.y)},${Math.floor(b.z)}`)",
    '      seen.add(Math.random())',
    async mod => {
      const one = Array.from({ length: MAX_APPROACH_DIG + 1 }, () => mv([1, 2, 3]))
      assert.equal(mod.approachDigCount(one), MAX_APPROACH_DIG + 1,
        'the mutant still de-duplicated; the distinctness test proves nothing')
      assert.equal(mod.approachVerdict({ status: 'success', path: one, endsInReach: true }).take, false,
        'ONE block reported many times must be refusable only by the buggy count')
    })
})

await ta('MUTANT KILLED: searching on the travel profile answers the wrong question', async () => {
  await withMutant(new URL('../src/digapproach.mjs', import.meta.url),
    '  const moves = bot.gatherMovements',
    '  const moves = bot.pathfinder.movements',
    async mod => {
      const bot = fakeBot({ status: 'success', path: [P(2, 64, 0)] })
      const r = mod.planDigApproach(bot, TARGET, ARGS)
      assert.equal(r, null,
        'the mutant searched anyway -- with canDig=false movements the guard must refuse, ' +
        'and if it does not the profile assertion above is vacuous')
    })
})

await ta('MUTANT KILLED: putting the verdict last loses it to the 120-char cut', async () => {
  // The fleet cut for 90 minutes: `collectErrors.push(...slice(0, 120))`, and
  // the prose ahead of the verdict was 118 characters. 861 refusal segments
  // across 70 of 80 bots, not one with a readable `[pathfinder said: ...]`.
  // The mutant restores exactly that order, on the real string.
  await withMutant(new URL('../src/digreach.mjs', import.meta.url),
    "           detail: `arrived_out_of_reach: ${said}eye is ${d} blocks from the centre of ${at}, ` +\n" +
    '                   `over the ${reach} the server allows` }',
    '           detail: `arrived_out_of_reach: eye is ${d} blocks from the centre of ${at}, ` +\n' +
    '                   `over the ${reach} the server allows ${said}` }',
    async mod => {
      const before = mod.reachRefusal({ blockName: 'oak_log', wanted: 'oak_log',
        target: { x: 478, y: 58, z: 189 }, dist: 8.2, pathSaid: 'NoPath' })
      assert.match(before.detail, /pathfinder said: NoPath/,
        'the mutant did not reproduce the original message at all')
      assert.ok(!/pathfinder said: NoPath/.test(before.detail.slice(0, 120)),
        'the mutant survived the 120-char cut, so the ordering test proves nothing')
    })
})

// THE ORDERING, on the real function.
{
  const { reachRefusal } = await import('../src/digreach.mjs')
  for (const [kind, args] of [
    ['arrived_out_of_reach', { blockName: 'oak_log', wanted: 'oak_log', dist: 8.2 }],
    ['target_changed', { blockName: 'air', wanted: 'oak_log', dist: 2.0 }],
    ['target_undiggable', { blockName: 'bedrock', wanted: 'bedrock', dist: 2.0 }],
  ]) {
    t(`${kind} publishes the pathfinder verdict inside the first 120 characters`, () => {
      const r = reachRefusal({ ...args, target: { x: 478, y: 58, z: 189 }, pathSaid: 'NoPath' })
      assert.equal(r.failClass, kind)
      assert.match(r.detail.slice(0, 120), /pathfinder said: NoPath/,
        `the verdict is past the cut gather applies:\n        ${r.detail}`)
    })
  }
}

// ------------------------------------------------------------- the CHAIN ---
//
// "Every trap this week passed its own unit tests." So this drives the real
// collectManually with a fake bot and asserts the SEQUENCE: cheap walk, then
// escalate, then dig -- and that a bot with no gather profile still gets a
// truthful refusal rather than a crash.

const { collectManually } = await import('../src/skills.mjs')

function chainBot ({ arriveOn = 'dig', plan = { status: 'success', path: [{ x: 4, y: 64, z: 0 }] } } = {}) {
  const seen = { gotos: [], borrowed: 0, dug: [] }
  let at = { x: 0, y: 64, z: 0 }
  const TARGET = { x: 6, y: 64, z: 0 }
  const world = new Map([['6,64,0', 'oak_log']])
  const bot = {
    seen,
    entity: { position: at },
    gatherMovements: { canDig: true, tag: 'gather' },
    blockAt: p => {
      const n = world.get(`${Math.floor(p.x)},${Math.floor(p.y)},${Math.floor(p.z)}`)
      return n ? { name: n, position: p, diggable: true } : { name: 'air', position: p, diggable: false }
    },
    canDigBlock: b => !!b && b.name !== 'air' && eyeToBlock(at, b.position) <= 5.1,
    inventory: { items: () => [] },
    equip: async () => {},
    dig: async b => { seen.dug.push(`${b.position.x},${b.position.y},${b.position.z}`); world.delete('6,64,0') },
    stopDigging: () => {},
    nearestEntity: () => null,
    withGatherMovements: async fn => { seen.borrowed++; return fn() },
    pathfinder: {
      movements: { canDig: false, tag: 'travel' },
      stop: () => {},
      // The travel walk NEVER arrives; the borrowed one does. That is the fleet
      // shape: 10 of 48 on the walk profile, 47 of 48 on the gather profile.
      goto: async () => {
        seen.gotos.push(seen.borrowed > 0 ? 'gather' : 'travel')
        if (seen.borrowed > 0 && arriveOn === 'dig') at = Object.assign(at, { x: 4, y: 64, z: 0 })
      },
      getPathFromTo: () => ({ next: () => ({ value: { result: plan } }) }),
    },
  }
  return { bot, target: bot.blockAt(TARGET), seen }
}

await ta('THE CHAIN: walk first, then borrow the dig profile, then dig the target', async () => {
  const { bot, target, seen } = chainBot()
  await collectManually(bot, target, new AbortController().signal)
  assert.deepEqual(seen.gotos, ['travel', 'gather'],
    'the free walk must be tried before anything is broken')
  assert.equal(seen.borrowed, 1, 'the dig profile is borrowed exactly once')
  assert.deepEqual(seen.dug, ['6,64,0'], 'the target itself was never dug')
})

await ta('the cheap walk is not paid for twice when it already arrives', async () => {
  const { bot, target, seen } = chainBot()
  // Put the bot in reach from the start: no walk, no approach, no borrow.
  bot.entity.position.x = 5
  await collectManually(bot, target, new AbortController().signal)
  assert.deepEqual(seen.gotos, [], 'a bot already in reach must not path anywhere')
  assert.equal(seen.borrowed, 0)
})

await ta('A REFUSAL STILL NAMES WHAT HAPPENED when no approach is affordable', async () => {
  // The remedy rule: a refusal must say something the reader can act on. Here
  // the plan is over budget, so the bot is refused -- and the message has to
  // carry the pathfinder verdict AND why the approach was declined.
  // The path ENDS IN REACH deliberately: approachVerdict refuses an out-of-reach
  // end first, so a path that failed both tests would prove nothing about the
  // budget. This one is legal in every way except how much it digs.
  const over = { status: 'success',
                 path: [...Array.from({ length: MAX_APPROACH_DIG + 5 }, (_, i) => mv([i, 30, 0])),
                        { x: 5, y: 64, z: 0, toBreak: [] }] }
  const { bot, target, seen } = chainBot({ arriveOn: 'never', plan: over })
  const e = await collectManually(bot, target, new AbortController().signal).then(() => null, x => x)
  assert.ok(e, 'a bot that never arrived must not report success')
  assert.equal(e.failClass, 'arrived_out_of_reach')
  assert.match(e.message.slice(0, 120), /pathfinder said/, 'the verdict was cut off again')
  assert.match(e.message, /no dig-approach \(approach would break/,
    `the refusal does not say why the approach was declined:\n        ${e.message}`)
  assert.equal(seen.borrowed, 0, 'an over-budget plan must not be walked')
  assert.deepEqual(seen.dug, [])
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
