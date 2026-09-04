// THE LAST RUNG, AND THE ONE BLOCK TYPE THAT WOULD KILL.
//
// Three bots pillared to the build limit and stayed eight hours. Over six of
// those hours they made 164 descent attempts -- 13% of every decision -- and
// not one was permitted. By the time the other four guards were fixed, one
// refusal was left, and it was CORRECT:
//
//     mine -> "stopped at y=320: open space at least 4 blocks under"
//
// There is a 250-block void under them. Digging is a fall.
//
// In open air the only placeable position is against a face of the block you
// stand on, and the only useful exposed face is its underside. So the move is
// not to dig into nothing: put something there first, break the floor, drop
// exactly one block onto what you placed. The void becomes ground, one block
// at a time, and fall exposure never exceeds one.
//
// Which makes the block list safety-critical rather than cosmetic. Place SAND
// beneath the floor and break the floor and the sand falls the instant it is
// unsupported -- the bot goes with it, 250 blocks, into the void it was
// bridging. The block that looks most like scaffold is the one that kills.
import assert from 'node:assert'
import { readFileSync } from 'node:fs'
import { RESCUE_BLOCK, rescueBlocks } from '../src/skills.mjs'

const code = f => readFileSync(new URL('../src/' + f, import.meta.url), 'utf8')
  .replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')
const skills = code('skills.mjs')

let pass = 0, fail = 0
const t = (name, fn) => {
  try { fn(); pass++; console.log(`  PASS  ${name}`) }
  catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) }
}
const inv = names => ({ inventory: { items: () => names.map(n => ({ name: n, count: 1 })) } })

t('SAND AND GRAVEL ARE REFUSED — this one is lethal, not untidy', () => {
  for (const n of ['sand', 'red_sand', 'gravel']) {
    assert.strictEqual(rescueBlocks(inv([n])).length, 0,
      `${n} was offered as a rescue block; placed under the floor it falls the ` +
      'moment the floor breaks and takes the bot down with it')
  }
})

t('logs ARE accepted, or the rescue never fires for the bots that need it', () => {
  // Between them the two stranded bots carry 327 logs and THREE blocks that
  // the ordinary SCAFFOLD list recognises. A careful list leaves them stranded.
  const got = rescueBlocks(inv(['oak_log', 'jungle_log', 'oak_planks', 'coarse_dirt', 'sandstone']))
  assert.strictEqual(got.length, 5, `expected all five usable, got ${got.map(i => i.name)}`)
})

t('non-blocks are not mistaken for building material', () => {
  const got = rescueBlocks(inv(['stick', 'wheat_seeds', 'bamboo', 'flint', 'torch', 'egg']))
  assert.strictEqual(got.length, 0, `offered non-blocks: ${got.map(i => i.name)}`)
})

t('the regex does not accidentally admit a falling block by suffix', () => {
  // `.*_log` and friends are broad. Anything that falls must fail regardless.
  for (const n of ['sand', 'gravel', 'red_sand'])
    assert.ok(!(RESCUE_BLOCK.test(n) && !['sand', 'gravel', 'red_sand'].includes(n)),
      `${n} slipped through the pattern`)
})

t('THE WIRING: it hangs off goto, after the pathfinder proved no route', () => {
  // Not a new skill. The model already proposes `goto <the ground>` and is
  // right to; a new verb would add prompt, admission and telemetry surface for
  // a state affecting 3 bots in 80.
  assert.ok(/rideFloorDown\(bot, \{ signal \}\)/.test(skills),
    'rideFloorDown is defined and never called — dead code, again')
  const call = skills.indexOf('rideFloorDown(bot, { signal })')
  const retry = skills.indexOf('withDescentMovements')
  assert.ok(retry > 0 && call > retry,
    'the rescue runs before the ordinary descent retry — it must be the LAST rung')
})

t('THE PRECONDITIONS: a normal bot on a cliff must never reach it', () => {
  const guard = skills.slice(skills.indexOf('if (!rodeDown'), skills.indexOf('rideFloorDown(bot, { signal })'))
  assert.ok(/SEA_LEVEL \+ 20/.test(guard), 'no altitude floor — a bot at y=64 could trigger it')
  assert.ok(/health \?\? 20\) >= 18/.test(guard), 'no health gate — 169 of 868 deaths are already falls')
  assert.ok(/!rodeDown/.test(guard), 'not latched — it could loop within one goto')

  // THE MATERIAL CHECK MOVED, AND ON PURPOSE.
  //
  // This used to also require `rescueBlocks(bot).length > 0` here, described as
  // "no check that it can build at all". That question is wrong at this altitude:
  // `rideFloorDown` has TWO branches and only the bridge one spends a block. The
  // free branch -- solid at y-2, break the floor, land on it -- is what this
  // function's own comment calls "98% of reality", and it needs nothing.
  //
  // Gating the whole manoeuvre on material refused exactly the bots the free
  // branch exists for. Measured 2026-09-04 over 6h: of 8 marooned-high frozen
  // bots, SIX held zero rescue blocks and died on this line; `_ride_floor_down`
  // fired 0 times across all 17 frozen bots.
  //
  // Note the irony recorded 40 lines below: these source-greps "passed for five
  // days against code that had never once worked". This one outlived its reason
  // the same way.
  assert.ok(!/rescueBlocks\(bot\)\.length > 0/.test(guard),
    'the material gate is back on the call site — it refuses the free branch')
})

t('...and the material check still exists, inside the branch that spends it', () => {
  // We removed a GATE, not a CHECK. The bridge branch must still refuse cleanly.
  const fn = skills.slice(skills.indexOf('export async function rideFloorDown'))
  const body = fn.slice(0, 4000)
  const needsBridge = body.indexOf('needsBridge')
  const firstRescue = body.indexOf('rescueBlocks')
  assert.ok(needsBridge > 0 && firstRescue > needsBridge,
    'rescueBlocks is consulted before needsBridge — that gates the free branch again')
  assert.ok(/no placeable blocks left/.test(body),
    'the bridge branch must still name why it stopped')
})

t('every attempt is logged, because a silent rescue is an unlogged confound', () => {
  assert.ok(/kind: 'ride_floor_down'/.test(skills),
    'the rescue emits no event — across four arms that is a confound nobody can see')
})

// ===========================================================================
// AND THEN IT RAN 1,917 TIMES AND DESCENDED 21 OF THEM.
//
// Everything above this line is true and none of it was the bug. The block
// list was right, the wiring was right, the placement primitive was right --
// 23 calls placed 140 blocks against the underside of the floor and 21 of them
// descended, three the full 16 steps. What was wrong was the guard that
// decided WHICH move to make:
//
//     if (under && under.boundingBox === 'block')
//       { stopped = 'solid below — ordinary digging applies'; break }
//
// 1,879 of 1,917 calls ended there. A bot that pillared to the build limit is
// standing on the pillar it built, so the block two below its feet is solid on
// every single attempt -- and the `ordinary digging` it deferred to is `mine`,
// which digs a STAIRCASE whose next tread hangs over the void and correctly
// refuses (`void_below`). board-c-Delta sat at 575,221,157 for days: 30,395
// noPath, 3,689 stranded_high, 1,626 goto failures, 810 of these, 0 descents.
//
// Solid below is not a reason to stop. It is the free step: break the floor,
// fall one block onto your own pillar, spend nothing.
//
// The tests above are all source-greps and inventory filters, which is exactly
// why they passed for five days against code that had never once worked. These
// drive the real function against a real (fake) world and assert on where the
// bot ENDS UP.
import { writeFileSync, unlinkSync } from 'node:fs'
import { rideFloorDown } from '../src/skills.mjs'

const ta = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) }
  catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) }
}

/**
 * Load a MUTATED copy of skills.mjs. Same shape as withMutant() in
 * climb-escape.test.mjs, for the same reason stated there:
 *
 * ASSERT THE MUTATION APPLIED BEFORE RUNNING IT. A replace() that matched
 * nothing produces an identical module, the test passes, and the mutant reads
 * as killed while nothing was ever tested.
 */
const SKILLS_PATH = new URL('../src/skills.mjs', import.meta.url)

async function withMutant (old, neu, fn) {
  const src = readFileSync(SKILLS_PATH, 'utf8')
  assert.ok(src.includes(old),
    `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 60))} is not in skills.mjs. ` +
    'A mutant that was never written reads as killed.')
  assert.ok(src.split(old).length === 2, 'the mutation target is not unique; the mutant is ambiguous')
  // test/ is one level under bots/, so './x.mjs' has to become '../src/x.mjs'.
  const body = src.replace(old, neu).replace(/from '\.\//g, "from '../src/")
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`,
                      import.meta.url)
  writeFileSync(out, body)
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}

class V {
  constructor (x, y, z) { this.x = x; this.y = y; this.z = z }
  offset (dx, dy, dz) { return new V(this.x + dx, this.y + dy, this.z + dz) }
  clone () { return new V(this.x, this.y, this.z) }
  distanceTo (o) { return Math.hypot(this.x - o.x, this.y - o.y, this.z - o.z) }
}

const AIR = { name: 'air', boundingBox: 'empty' }
// canHarvest/digTime exist because bestTool() and predictedDigMs() call them.
// digTime defaults cheap; the hard-block test overrides it.
const solid = (name, digMs = 1_000) => ({
  name, boundingBox: 'block',
  canHarvest: () => false,
  digTime: () => digMs,
})
const liquid = name => ({ name, boundingBox: 'empty', canHarvest: () => false, digTime: () => 1_000 })

const K = (x, y, z) => `${Math.floor(x)},${Math.floor(y)},${Math.floor(z)}`

/**
 * A world you can dig and place into, and a bot that falls when unsupported.
 *
 * Deliberately not a physics engine. It models the three facts this function
 * depends on: blockAt reads the world, placeBlock writes ref+face, and a bot
 * whose floor is removed sinks until something holds it.
 */
function makeWorld ({ pos, blocks, inventory = [], noOptionsApi = false }) {
  const w = new Map()
  const put = (x, y, z, b) => w.set(K(x, y, z), b)
  const get = (x, y, z) => w.get(K(x, y, z)) ?? blocks(x, y, z)
  const calls = { place: [], dig: [], equip: [] }
  const items = inventory.map((name, i) => ({ name, count: 64, slot: i, type: 100 + i }))

  const settle = () => {
    // Sink one block at a time until supported, or 8 -- enough to expose a
    // multi-block fall to the `fell > 3.5` guard without looping forever.
    for (let i = 0; i < 8; i++) {
      const below = get(bot.entity.position.x, bot.entity.position.y - 1, bot.entity.position.z)
      if (below && below.boundingBox === 'block') break
      bot.entity.position = bot.entity.position.offset(0, -1, 0)
    }
  }

  const doPlace = async (ref, face, opts) => {
    calls.place.push({ ref: `${ref.position.x},${ref.position.y},${ref.position.z}`,
                       face: `${face.x},${face.y},${face.z}`, held: calls.equip.at(-1), opts })
    const at = ref.position.offset(face.x, face.y, face.z)
    const target = get(at.x, at.y, at.z)
    if (target && target.boundingBox === 'block') return         // occupied: no-op, as the server would
    put(at.x, at.y, at.z, solid(calls.equip.at(-1) ?? 'oak_log'))
  }

  const bot = {
    entity: { position: pos },
    health: 20,
    inventory: { items: () => items },
    blockAt: p => {
      const b = get(p.x, p.y, p.z)
      return b ? { ...b, position: new V(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z)) } : null
    },
    equip: async it => { calls.equip.push(it.name) },
    placeBlock: async (ref, face) => doPlace(ref, face, null),
    // Present on mineflayer 4.37.1 (lib/plugins/place_block.js:37) and the only
    // way to pass forceLook. `noOptionsApi` drops it to exercise the fallback.
    ...(noOptionsApi ? {} : { _placeBlockWithOptions: (ref, face, opts) => doPlace(ref, face, opts) }),
    dig: async b => {
      calls.dig.push(`${b.position.x},${b.position.y},${b.position.z}`)
      put(b.position.x, b.position.y, b.position.z, AIR)
      settle()
    },
    stopDigging: () => {},
    setControlState: () => {},
  }
  return { bot, calls, get }
}

/** A 1-wide pillar of `mat` from `bottom` up to the bot's floor; air elsewhere. */
const pillar = ({ px = 0, pz = 0, bottom = 60, top = 220, mat = 'dirt', digMs = 1_000 } = {}) =>
  (x, y, z) => (Math.floor(x) === px && Math.floor(z) === pz && y >= bottom && y <= top
    ? solid(mat, digMs) : AIR)

/** A one-block-thick platform at `top`, nothing at all beneath it. */
const platform = ({ top = 220 } = {}) => (x, y, z) => (Math.floor(y) === top ? solid('stone') : AIR)

// --- THE DEFECT ------------------------------------------------------------

await ta('THE BUG: a bot on its own pillar rides it down and spends nothing', async () => {
  const { bot, calls } = makeWorld({
    pos: new V(0.5, 221, 0.5), blocks: pillar({ top: 220 }), inventory: ['oak_log'],
  })
  const r = await rideFloorDown(bot, { maxSteps: 4 })
  assert.strictEqual(r.descended, 4, `descended ${r.descended}, stopped: ${r.stopped}`)
  assert.strictEqual(r.stopped, null, `stopped early: ${r.stopped}`)
  assert.strictEqual(r.rode, 4, 'the free branch was not taken')
  assert.strictEqual(r.placed, 0, 'spent blocks bridging a gap that was already solid')
  assert.strictEqual(calls.place.length, 0, 'placed anyway')
  assert.strictEqual(bot.entity.position.y, 217)
})

await ta('MUTANT: the old solid-below guard reproduces 1,879 of 1,917 log lines', async () => {
  await withMutant(
    "const needsBridge = !under || under.boundingBox !== 'block'",
    "if (under && under.boundingBox === 'block') " +
      "{ stopped = 'solid below — ordinary digging applies'; break }\n" +
    "    const needsBridge = true",
    async mod => {
      const { bot } = makeWorld({
        pos: new V(0.5, 221, 0.5), blocks: pillar({ top: 220 }), inventory: ['oak_log'],
      })
      const r = await mod.rideFloorDown(bot, { maxSteps: 4 })
      // ANCHOR: the mutant must reproduce the OBSERVED production string, or
      // its death proves nothing about the bug that was actually shipped.
      assert.strictEqual(r.descended, 0, 'the mutant descended; it is not the bug')
      assert.strictEqual(r.stopped, 'solid below — ordinary digging applies',
        `the mutant stopped with ${JSON.stringify(r.stopped)}, not the string 810 of ` +
        'board-c-Delta\'s log lines carry')
      assert.strictEqual(r.placed, 0, 'the mutant placed a block; the real one never did')
    })
})

// --- THE OTHER BRANCH MUST STILL WORK --------------------------------------

await ta('over a true void it still bridges: place under the floor, break, fall one', async () => {
  const { bot, calls } = makeWorld({
    pos: new V(0.5, 221, 0.5), blocks: platform({ top: 220 }), inventory: ['oak_log'],
  })
  const r = await rideFloorDown(bot, { maxSteps: 3 })
  assert.strictEqual(r.descended, 3, `descended ${r.descended}, stopped: ${r.stopped}`)
  assert.strictEqual(r.placed, 3, `placed ${r.placed}`)
  assert.strictEqual(r.rode, 0, 'took the free branch over a void')
  assert.deepStrictEqual(calls.place.map(c => c.face), ['0,-1,0', '0,-1,0', '0,-1,0'],
    'the only usable face in open air is the UNDERSIDE of the floor')
  assert.deepStrictEqual(calls.place.map(c => c.ref), ['0,220,0', '0,219,0', '0,218,0'],
    'the reference block must be the floor underfoot, re-read each step')
  assert.ok(calls.place.every(c => c.held === 'oak_log'), 'placed without equipping the block')
  assert.ok(calls.place.every(c => c.opts?.forceLook === true),
    'placed without forceLook: bot.placeBlock slews the head first and the packet ' +
    'may never leave — mineflayer-pathfinder #296')
})

await ta('and it degrades to bot.placeBlock if the private options API disappears', async () => {
  const { bot, calls } = makeWorld({
    pos: new V(0.5, 221, 0.5), blocks: platform({ top: 220 }),
    inventory: ['oak_log'], noOptionsApi: true,
  })
  const r = await rideFloorDown(bot, { maxSteps: 2 })
  assert.strictEqual(r.descended, 2, `a mineflayer bump must not break the rescue: ${r.stopped}`)
  assert.ok(calls.place.every(c => c.opts === null), 'took the options path that is not there')
})

await ta('MUTANT: placing on the TOP face reproduces "could not place beneath the floor"', async () => {
  await withMutant(
    'bot._placeBlockWithOptions(floor, new Vec3(0, -1, 0),',
    'bot._placeBlockWithOptions(floor, new Vec3(0, 1, 0),',
    async mod => {
      const { bot } = makeWorld({
        pos: new V(0.5, 221, 0.5), blocks: platform({ top: 220 }), inventory: ['oak_log'],
      })
      const r = await mod.rideFloorDown(bot, { maxSteps: 3 })
      assert.strictEqual(r.stopped, 'could not place beneath the floor',
        `anchor: the wrong face must produce the observed string, got ${JSON.stringify(r.stopped)}`)
      assert.strictEqual(r.descended, 0)
    })
})

await ta('MUTANT: dropping forceLook is invisible to every assertion but one', async () => {
  // This mutant cannot change the OUTCOME in a fake world -- the head slew it
  // reintroduces only exists against a real server. It is here to prove the
  // forceLook assertion above is load-bearing rather than decorative.
  await withMutant(
    "{ swingArm: 'right', forceLook: true }",
    "{ swingArm: 'right' }",
    async mod => {
      const { bot, calls } = makeWorld({
        pos: new V(0.5, 221, 0.5), blocks: platform({ top: 220 }), inventory: ['oak_log'],
      })
      await mod.rideFloorDown(bot, { maxSteps: 2 })
      assert.ok(calls.place.length > 0, 'anchor: the mutant never reached a placement')
      assert.ok(calls.place.every(c => c.opts?.forceLook !== true),
        'the mutation did not remove forceLook')
    })
})

await ta('a pillar that runs out mid-descent switches to bridging without stopping', async () => {
  // Two blocks of pillar, then nothing: the composition case, which is what a
  // platform over a cave roof or the end of a built column actually looks like.
  const blocks = (x, y, z) =>
    (Math.floor(x) === 0 && Math.floor(z) === 0 && y >= 219 && y <= 220 ? solid('dirt') : AIR)
  const { bot } = makeWorld({ pos: new V(0.5, 221, 0.5), blocks, inventory: ['oak_log'] })
  const r = await rideFloorDown(bot, { maxSteps: 4 })
  assert.strictEqual(r.descended, 4, `descended ${r.descended}, stopped: ${r.stopped}`)
  assert.strictEqual(r.rode, 1, `rode ${r.rode} free step(s); expected the one solid block`)
  assert.strictEqual(r.placed, 3, `placed ${r.placed}`)
})

// --- THE SAFETY PROPERTIES THE NEW BRANCH MUST NOT COST US -----------------

await ta('lava two below still stops it, and now it cannot be reached by the free branch', async () => {
  const blocks = (x, y, z) => (y === 220 ? solid('stone') : y === 219 ? liquid('lava') : AIR)
  const { bot, calls } = makeWorld({ pos: new V(0.5, 221, 0.5), blocks, inventory: ['oak_log'] })
  const r = await rideFloorDown(bot, { maxSteps: 4 })
  assert.strictEqual(r.stopped, 'lava below')
  assert.strictEqual(r.descended, 0)
  assert.strictEqual(calls.dig.length, 0, 'it broke the floor over lava')
})

await ta('a water_cauldron underfoot is a floor, not a liquid', async () => {
  // The liquid check moved ahead of the solid check when the solid check was
  // deleted; a block named for water that you can stand on must not read as one.
  const blocks = (x, y, z) => (y === 220 ? solid('stone') : y === 219 ? solid('water_cauldron') : AIR)
  const { bot } = makeWorld({ pos: new V(0.5, 221, 0.5), blocks, inventory: ['oak_log'] })
  const r = await rideFloorDown(bot, { maxSteps: 1 })
  assert.notStrictEqual(r.stopped, 'water_cauldron below', 'refused to stand on a cauldron')
  assert.strictEqual(r.descended, 1)
})

await ta('an unaffordable floor is refused by name, not by running out the clock', async () => {
  // The free branch made bare-handed deepslate reachable for the first time.
  // A flat 10s budget could only ever report `could not break the floor`, which
  // names our budget rather than the cause.
  const { bot, calls } = makeWorld({
    pos: new V(0.5, 221, 0.5),
    blocks: pillar({ top: 220, mat: 'obsidian', digMs: 250_000 }),
    inventory: ['oak_log'],
  })
  const r = await rideFloorDown(bot, { maxSteps: 4 })
  assert.strictEqual(r.stopped, 'cannot break obsidian by hand')
  assert.strictEqual(calls.dig.length, 0, 'it started a dig it had already been told to refuse')
})

await ta('nothing underfoot is still a stop, not a place-into-nowhere', async () => {
  const { bot } = makeWorld({ pos: new V(0.5, 221, 0.5), blocks: () => AIR, inventory: ['oak_log'] })
  const r = await rideFloorDown(bot, { maxSteps: 2 })
  assert.strictEqual(r.stopped, 'nothing underfoot to stand on')
})

await ta('no blocks is only fatal to the bridge, never to the free ride', async () => {
  const empty = makeWorld({ pos: new V(0.5, 221, 0.5), blocks: platform({ top: 220 }), inventory: [] })
  assert.strictEqual((await rideFloorDown(empty.bot, { maxSteps: 2 })).stopped,
    'no placeable blocks left')

  const onPillar = makeWorld({ pos: new V(0.5, 221, 0.5), blocks: pillar({ top: 220 }), inventory: [] })
  const r = await rideFloorDown(onPillar.bot, { maxSteps: 3 })
  assert.strictEqual(r.stopped, null, `an empty-handed bot on solid ground stopped: ${r.stopped}`)
  assert.strictEqual(r.descended, 3)
})

await ta('an abort signal is still honoured before the first dig', async () => {
  const { bot, calls } = makeWorld({
    pos: new V(0.5, 221, 0.5), blocks: pillar({ top: 220 }), inventory: ['oak_log'],
  })
  const r = await rideFloorDown(bot, { maxSteps: 4, signal: { aborted: true } })
  assert.strictEqual(r.stopped, 'aborted')
  assert.strictEqual(calls.dig.length, 0)
})

// --- AND THE WIN HAS TO BE VISIBLE ------------------------------------------

t('the telemetry names the free step, or a 16-block ride reads as the bug', () => {
  // `using 0 placed block(s)` is the exact string all 1,879 failures carry. A
  // free descent places nothing either, so reporting only `placed` would make
  // the fix and the defect indistinguishable in Kibana.
  const line = skills.slice(skills.indexOf("kind: 'ride_floor_down'"),
                            skills.indexOf("kind: 'ride_floor_down'") + 700)
  assert.ok(/r\.rode/.test(line),
    'the event reports only placed blocks; a free ride is invisible to the arm it happened in')
})

console.log(`\n  ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
