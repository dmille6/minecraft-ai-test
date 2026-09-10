/**
 * THE ESCAPE RAMP MUST NOT BURY THE BOT IT IS RESCUING.
 *
 * `entombed-escape.test.mjs` proves the ramp can open a sealed ceiling and
 * climb out. This file is about what the first version of that fix did when the
 * ceiling had gravel resting on it, and it is a separate file because it is a
 * different claim: not "does the rescue work" but "can the rescue kill".
 *
 * THE PHYSICS, WHICH IS THE WHOLE BUG. A falling-block entity is not stopped by
 * a bot. It passes through every entity and every non-solid cell and
 * materialises on top of the first SOLID block beneath it. A bot standing on a
 * floor has that floor at (0,-1,0), so a gravel column released at (0,3,0) does
 * not stop at the ceiling the ramp just opened -- it lands in (0,0,0), the
 * bot's own feet cell. Three blocks of it fill (0,0,0), (0,1,0) and (0,2,0).
 * That is suffocation at 1 HP per half second: dead in about ten seconds,
 * inside a routine that holds the body for up to a minute, and more entombed at
 * the end than at the start. Strictly worse than the no-op it replaced.
 *
 * The repo already knew. `shaftAscend` (skills.mjs) has waited 500ms and
 * re-checked whenever this exact cell held a falling block since long before
 * the ramp existed. The patch reviewed here watched the wrong cell -- it looked
 * for a REFILL of (0,2,0) rather than for the column landing below it -- and
 * sampled for 200ms, which is shorter than the ~350ms a single block takes to
 * fall at 0.04 blocks/tick^2 before spawn and round trip are counted.
 *
 * WHAT THIS FILE GUARDS:
 *   1. THE PHYSICS FIXTURE ITSELF, first, with a positive control -- a world
 *      where gravel does not fall cannot show a bot being buried by gravel.
 *   2. THE ORDER. The cell above the ceiling is taken while the ceiling still
 *      holds the rest of the column up, and only then the ceiling.
 *   3. THE DEPTH. A column is not one block. The breach re-plans after every
 *      swing, so three blocks of sand are as safe as one.
 *   4. THE MUTANT. The guard removed, and the bot buried, in the same world.
 *   5. THE OTHER THREE HAZARDS the review found in the same loop: no deadline,
 *      no body claim, and a `catch` whose comment claimed a verification that
 *      did not exist.
 */
import assert from 'node:assert'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { headroomBreach, isFallingBlock, bodyPassable } from '../src/scaffold.mjs'
import { escapeStairUp, unburySelf, isEntombedForTest,
         FALLING_SETTLE_MS, BREACH_MAX_SWINGS } from '../src/reflex.mjs'

let pass = 0, fail = 0
const t = (name, fn) => Promise.resolve()
  .then(fn)
  .then(() => { pass++; console.log(`  PASS  ${name}`) })
  .catch(e => { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) })

const REFLEX_PATH = new URL('../src/reflex.mjs', import.meta.url)

/** Verbatim from climb-escape.test.mjs. Writes a sibling module, never src/. */
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

// --- the world, WITH GRAVITY ------------------------------------------------
//
// The fixture in entombed-escape.test.mjs is a static block map: digging a cell
// makes it air and nothing else moves. That world cannot express the defect
// this file is about, so this one adds the one rule that matters -- a falling
// block with a non-solid cell under it drops until something solid stops it,
// passing straight through wherever the bot happens to be standing.

const DIG_MS = {
  stone: 7500, deepslate: 15_000, dirt: 750, gravel: 3000, sand: 2500,
  obsidian: 250_000,
}

function blk (name, pos) {
  if (name === 'air' || !name) return { name: 'air', boundingBox: 'empty', position: pos }
  if (name === 'water' || name === 'lava') return { name, boundingBox: 'empty', position: pos }
  if (name === 'bedrock') {
    return { name, boundingBox: 'block', position: pos, diggable: false, digTime: () => null }
  }
  return {
    name, boundingBox: 'block', position: pos, diggable: true,
    digTime: () => DIG_MS[name] ?? 7500,
    canHarvest: () => true,
  }
}

const V = (x, y, z) => ({
  x, y, z,
  offset: (a, b, c) => V(x + a, y + b, z + c),
  clone: () => V(x, y, z),
})

const TOP = 10, FLOOR = -1

function world (cells = {}, { fill = 'stone' } = {}) {
  const m = new Map(Object.entries(cells))
  const w = {
    get (x, y, z) { const k = `${x},${y},${z}`; return m.has(k) ? m.get(k) : fill },
    set (x, y, z, name) { m.set(`${x},${y},${z}`, name) },
    /**
     * GRAVITY, AND DELIBERATELY BLIND TO THE BOT. Bottom-up so a column
     * collapses in one pass. A block stops on the first cell whose occupant is
     * not passable -- which for a bot standing on its floor is the floor, so
     * the block lands in the bot's own cell. That is the fact the guard exists
     * for, and a fixture that quietly stopped the gravel at the bot would prove
     * the opposite of what this file claims.
     */
    settle (x, z) {
      for (let y = FLOOR + 1; y <= TOP; y++) {
        const n = w.get(x, y, z)
        if (!isFallingBlock({ name: n, boundingBox: 'block' })) continue
        let ly = y
        while (ly - 1 > FLOOR && bodyPassable(blk(w.get(x, ly - 1, z), V(x, ly - 1, z)))) ly--
        if (ly !== y) { w.set(x, y, z, 'air'); w.set(x, ly, z, n) }
      }
    },
  }
  return w
}

const atOf = w => (dx, dy, dz) => blk(w.get(dx, dy, dz), V(dx, dy, dz))

/** A sealed 1x1 pocket, with `above` stacked in the column over the ceiling. */
const TOMB = (above = []) => {
  const cells = { '0,0,0': 'air', '0,1,0': 'air' }
  above.forEach((name, i) => { cells[`0,${3 + i},0`] = name })
  return world(cells)
}

function makeBot (w, { y = 44, inv = [], held = null, canPath = false, digHook = null } = {}) {
  const digs = []
  let yaw = 0
  let clears = 0
  const bot = {
    digs, world: w,
    get clears () { return clears },
    entity: { position: V(0, y, 0), get yaw () { return yaw } },
    heldItem: held,
    inventory: { items: () => inv },
    blockAt (p) { return blk(w.get(p.x, p.y - y, p.z), p) },
    async unequip () { bot.heldItem = null },
    async equip (item) { bot.heldItem = item },
    async dig (b) {
      if (digHook) await digHook(b, digs.length)
      digs.push({ name: b.name, held: bot.heldItem?.name ?? null })
      w.set(b.position.x, b.position.y - y, b.position.z, 'air')
      w.settle(b.position.x, b.position.z)
    },
    stopDigging () {},
    clearControlStates () { clears++ },
    async look (a) { yaw = a },
    setControlState (name, on) {
      if (name !== 'forward' || !on) return
      const q = ((Math.round(yaw / (Math.PI / 2)) % 4) + 4) % 4
      const bear = [{ x: 0, z: -1 }, { x: -1, z: 0 }, { x: 0, z: 1 }, { x: 1, z: 0 }][q]
      const rel = { x: bot.entity.position.x, z: bot.entity.position.z }
      const dy = bot.entity.position.y - y
      const at = (dx, ddy, dz) => blk(w.get(dx, ddy, dz), V(dx, ddy, dz))
      const tread = at(rel.x + bear.x, dy, rel.z + bear.z)
      const feet = at(rel.x + bear.x, dy + 1, rel.z + bear.z)
      const head = at(rel.x + bear.x, dy + 2, rel.z + bear.z)
      if (tread.boundingBox !== 'block' || !bodyPassable(feet) || !bodyPassable(head)) return
      bot.entity.position = V(rel.x + bear.x, bot.entity.position.y + 1, rel.z + bear.z)
    },
    pathfinder: {
      thinkTimeout: 1000,
      setGoal () {},
      getPathTo () { return canPath ? { path: [1, 2, 3] } : { path: [] } },
    },
  }
  return bot
}

/** The cells a bot's body occupies. Buried means one of them is not passable. */
const buriedIn = bot => {
  const y = 44
  for (const dy of [0, 1]) {
    const b = bot.blockAt(bot.entity.position.offset(0, dy, 0))
    if (!bodyPassable(b)) return b.name
  }
  return null
}

// ============================================================================
// A. THE FIXTURE HAS THE PHYSICS. Every claim below rests on this.
// ============================================================================

await t('POSITIVE CONTROL: this world drops a gravel column into the bot\'s own cell', () => {
  // The instrument, before the measurement. A world where gravel does not fall
  // cannot show a bot being buried by gravel, and a mutant run in one would
  // read as killed while proving nothing at all.
  const w = TOMB(['gravel', 'gravel'])
  w.set(0, 2, 0, 'air')                       // the ceiling, as if just breached
  w.settle(0, 0)
  assert.strictEqual(w.get(0, 0, 0), 'gravel',
    'the feet cell should hold gravel: a falling block passes through a bot and ' +
    'lands on the first solid cell, which is the floor')
  assert.strictEqual(w.get(0, 1, 0), 'gravel', 'and the head cell holds the second')
  assert.strictEqual(w.get(0, 3, 0), 'air', 'the column came out of where it was')
})

await t('POSITIVE CONTROL: stone in the same place does NOT fall', () => {
  const w = TOMB(['stone', 'stone'])
  w.set(0, 2, 0, 'air')
  w.settle(0, 0)
  assert.strictEqual(w.get(0, 0, 0), 'air',
    'stone moved, so the fixture drops everything and the gravel result above ' +
    'is not about gravel')
  assert.strictEqual(w.get(0, 3, 0), 'stone')
})

await t('isFallingBlock knows the family, not just the two obvious members', () => {
  for (const n of ['gravel', 'sand', 'red_sand', 'suspicious_gravel',
                   'white_concrete_powder', 'anvil', 'pointed_dripstone']) {
    assert.strictEqual(isFallingBlock({ name: n }), true, `${n} falls and was not caught`)
  }
  for (const n of ['stone', 'dirt', 'deepslate', 'oak_leaves', 'sandstone', 'water']) {
    assert.strictEqual(isFallingBlock({ name: n }), false, `${n} does not fall but was caught`)
  }
  assert.strictEqual(isFallingBlock(null), false, 'an unloaded cell is not a falling block')
})

// ============================================================================
// B. THE DECISION. headroomBreach, by behaviour.
// ============================================================================

await t('gravel ON the ceiling is taken FIRST, while the ceiling still holds it up', () => {
  const r = headroomBreach({ at: atOf(TOMB(['gravel'])), canBreak: () => true })
  assert.strictEqual(r.ok, true, r.reason)
  assert.deepStrictEqual(r.dig, [[0, 3, 0]],
    'the ceiling must not be the first swing: opening it releases the column ' +
    'into the cell the bot is standing in')
  assert.strictEqual(r.settling, true, 'the caller has to know to re-plan and wait')
})

await t('with nothing unstable above, the ceiling is still the one cell taken', () => {
  const r = headroomBreach({ at: atOf(TOMB(['stone'])), canBreak: () => true })
  assert.deepStrictEqual(r.dig, [[0, 2, 0]],
    'the guard must not have turned every breach into a two-cell excavation')
})

await t('gravel over an ALREADY-OPEN ceiling is a refusal, not a plan', () => {
  // A column mid-fall. There is nothing to break and nothing safe to do but
  // wait, and saying "ok, dig nothing" would send the ramp straight under it.
  const w = TOMB(['gravel']); w.set(0, 2, 0, 'air')
  const r = headroomBreach({ at: atOf(w) })
  assert.strictEqual(r.ok, false)
  assert.match(r.reason, /falling column is settling/)
})

await t('an unbreakable falling block overhead is named, not silently released', () => {
  const r = headroomBreach({ at: atOf(TOMB(['gravel'])), canBreak: () => false })
  assert.strictEqual(r.ok, false)
  assert.match(r.reason, /cannot clear the gravel resting on the ceiling/)
})

await t('not seeing the cell above the ceiling is a refusal, not open sky', () => {
  const at = (dx, dy, dz) => (dy === 3 ? null : blk('stone', V(dx, dy, dz)))
  const r = headroomBreach({ at })
  assert.strictEqual(r.ok, false)
  assert.match(r.reason, /not loaded above the ceiling/)
})

// ============================================================================
// C. THE CHAIN, in a world with gravity.
// ============================================================================

await t('THE CHAIN: a bot under three blocks of sand gets out and is NOT buried', async () => {
  const w = TOMB(['sand', 'sand', 'sand'])
  const bot = makeBot(w, { y: 44 })
  assert.strictEqual(isEntombedForTest(bot), true,
    'the fixture is not a tomb, so this is not about entombed bots')

  const r = await escapeStairUp(bot, { maxSteps: 4, budgetMs: 30_000 })

  assert.strictEqual(buriedIn(bot), null,
    `the rescue buried the bot in its own escape hole: ${buriedIn(bot)}`)
  assert.ok(r.steps > 0, `no step was cut: ${r.stopped}`)
  assert.ok(bot.entity.position.y > 44, 'reported steps without gaining height')
  assert.ok(bot.digs.some(d => d.name === 'sand'),
    'no sand was ever dug, so the column was not what the ramp dealt with')
})

await t('ONE block of gravel, the single-block case, also leaves the bot standing', async () => {
  const bot = makeBot(TOMB(['gravel']), { y: 44 })
  const r = await escapeStairUp(bot, { maxSteps: 3, budgetMs: 30_000 })
  assert.strictEqual(buriedIn(bot), null, r.stopped)
  assert.ok(r.steps > 0, r.stopped)
})

await t('THE MUTANT, KILLED: without the guard the same bot ends buried in sand', async () => {
  // The pre-fix shape, restored exactly: one swing at the ceiling, planned by
  // hand, with nothing asked about the cell above it. Same world, same bot.
  const GUARDED = '    const plan = headroomBreach({ at, canBreak })'
  const NAIVE = '    const plan = { ok: true, dig: [[0, 2, 0]] }'
  await withMutant(REFLEX_PATH, GUARDED, NAIVE, async mod => {
    const w = TOMB(['sand', 'sand', 'sand'])
    const bot = makeBot(w, { y: 44 })
    await mod.escapeStairUp(bot, { maxSteps: 4, budgetMs: 30_000 })
    const stuck = buriedIn(bot)
    assert.ok(stuck,
      'the mutant did NOT bury the bot, so the guard is not what stands between ' +
      'this fleet and a suffocation -- and the test above is passing for some ' +
      'other reason')
    assert.strictEqual(stuck, 'sand',
      `expected the column in the bot's own cell, found ${stuck}`)
  })
})

await t('THE SETTLE IS LONG ENOUGH TO SEE THE FALL', () => {
  // Not a style point. A block falls at 0.04 blocks/tick^2, so one block is
  // ~7 ticks -- about 350ms -- before the spawn tick and the round trip. The
  // patch reviewed here sampled at 200ms, which is an instrument that could not
  // have seen the event it was sampling for. skills.mjs uses 500ms for the same
  // cell in `shaftAscend`.
  assert.ok(FALLING_SETTLE_MS >= 500,
    `${FALLING_SETTLE_MS}ms is shorter than one block's fall plus a round trip`)
  const shaft = readFileSync(new URL('../src/skills.mjs', import.meta.url), 'utf8')
  assert.ok(shaft.includes('if (FALLING.has(head.name)) { await sleep(500); continue }'),
    'shaftAscend no longer sets the precedent this constant is anchored to; ' +
    're-derive the number rather than deleting this line')
})

// ============================================================================
// D. THE LAST LINE OF DEFENCE. Prevention is allowed to be wrong.
// ============================================================================

await t('unburySelf digs a bot out of a column that landed on it, top down', async () => {
  const w = TOMB(); w.set(0, 0, 0, 'gravel'); w.set(0, 1, 0, 'gravel')
  const bot = makeBot(w, { y: 44 })
  assert.strictEqual(buriedIn(bot), 'gravel', 'the fixture did not bury the bot')
  const r = await unburySelf(bot, {
    deadline: Date.now() + 10_000,
    digWithin: async b => { await bot.dig(b); return null },
  })
  assert.strictEqual(r.stopped, null, r.stopped)
  assert.ok(r.dug >= 2, `dug ${r.dug}; both body cells had to come out`)
  assert.strictEqual(buriedIn(bot), null, 'still buried after unburying')
  assert.deepStrictEqual(bot.digs.map(d => d.name), ['gravel', 'gravel'])
})

await t('unburySelf leaves STONE alone: a walled-in bot is not a buried one', async () => {
  const w = TOMB(); w.set(0, 1, 0, 'stone')
  const bot = makeBot(w, { y: 44 })
  const r = await unburySelf(bot, {
    deadline: Date.now() + 10_000,
    digWithin: async b => { await bot.dig(b); return null },
  })
  assert.strictEqual(r.dug, 0,
    'digging blindly around a body turns a rescue into an excavation')
  assert.strictEqual(r.stopped, null)
})

await t('a bot it cannot free says so, rather than climbing on regardless', async () => {
  const w = TOMB(); w.set(0, 1, 0, 'gravel')
  const bot = makeBot(w, { y: 44 })
  const r = await unburySelf(bot, {
    deadline: Date.now() + 10_000,
    digWithin: async () => 'dig failed on gravel: Digging aborted',
  })
  assert.match(r.stopped, /buried in gravel/,
    'a rescue that cannot free the bot must not report a ramp it can go on climbing')
})

// ============================================================================
// E. THE OTHER THREE, from the same review.
// ============================================================================

await t('THE DEADLINE BINDS THE BREACH LOOP, not only the step loop', async () => {
  // The patch computed `deadline` and never checked it here. `planDig` can
  // return up to ~47s of budget, so a bot could pay the whole minute breaking
  // its ceiling and then trip `budget spent` on the first step -- returning
  // steps: 0, which the caller logs as a FAILURE and backs off up to ten
  // minutes for.
  const w = TOMB(['sand', 'sand', 'sand', 'sand'])
  const bot = makeBot(w, { y: 44 })
  const t0 = Date.now()
  const r = await escapeStairUp(bot, { maxSteps: 4, budgetMs: 600 })
  const took = Date.now() - t0
  assert.match(r.stopped, /budget spent breaching the ceiling/,
    `the breach ran past its own deadline: stopped=${r.stopped}`)
  assert.ok(took < 4000, `${took}ms for a 600ms budget`)
})

await t('A SETTLING COLUMN CANNOT LOOP FOREVER: the breach is bounded and says so', async () => {
  const bot = makeBot(TOMB(Array(30).fill('sand')), { y: 44 })
  const r = await escapeStairUp(bot, { maxSteps: 4, budgetMs: 60_000 })
  assert.match(r.stopped, new RegExp(`outlasted ${BREACH_MAX_SWINGS} swings`),
    `expected the bound to be what stopped it: ${r.stopped}`)
  assert.strictEqual(buriedIn(bot), null, 'and giving up must not leave the bot buried')
})

await t('THE RAMP YIELDS THE BODY, and stops wiping the controls when it does', async () => {
  // The drowning rescue seizes and then re-asserts a stroke every tick, in the
  // same interval loop this runs from. This loop clears the controls at every
  // step boundary and can hold for a minute, so without a yield it deletes a
  // stroke a drowning bot is depending on. It yields rather than claiming
  // because standing the water rescue down is the change that multiplied
  // drownings 7.5x.
  const bot = makeBot(TOMB(), { y: 44 })
  let owner = null
  let clearsAtYield = null
  const r = await escapeStairUp(bot, {
    maxSteps: 6,
    budgetMs: 30_000,
    yieldTo: () => {
      if (bot.digs.length >= 3 && !owner) { owner = 'the drowning rescue'; clearsAtYield = bot.clears }
      return owner
    },
  })
  assert.ok(owner, 'the yield never fired, so this test proves nothing')
  assert.match(r.stopped, /yielded the body to the drowning rescue/)
  assert.strictEqual(r.yielded, 'the drowning rescue')
  assert.strictEqual(bot.clears, clearsAtYield,
    'the ramp cleared the controls AFTER handing the body over, which is exactly ' +
    'the stroke-wipe the yield exists to prevent')
})

await t('MUTANT KILLED: an unconditional clear on the way out wipes the new owner', async () => {
  // Releasing is done by NOT touching the controls -- the owner has already set
  // the stroke it wants. This mutant restores the unconditional
  // `clearControlStates()` the patch had on every exit path, which is the exact
  // wipe the yield exists to prevent, and shows the yield alone does not stop
  // it.
  const GUARDED = '    if (!yielded) bot.clearControlStates()'
  const ALWAYS = '    bot.clearControlStates()'
  await withMutant(REFLEX_PATH, GUARDED, ALWAYS, async mod => {
    const bot = makeBot(TOMB(), { y: 44 })
    let owner = null
    let clearsAtYield = null
    const r = await mod.escapeStairUp(bot, {
      maxSteps: 6,
      budgetMs: 30_000,
      yieldTo: () => {
        if (bot.digs.length >= 3 && !owner) { owner = 'x'; clearsAtYield = bot.clears }
        return owner
      },
    })
    assert.ok(owner, 'the mutant never reached the point of contention')
    assert.strictEqual(r.yielded, 'x', 'the mutant changed the yield decision, not the wipe')
    assert.ok(bot.clears > clearsAtYield,
      'the mutant did NOT wipe the controls, so the guard in `finish` is not what ' +
      'protects them and the test above is passing for another reason')
  })
})

await t('A RE-CLEAR THAT FAILS IS NAMED, not swallowed under a comment', async () => {
  // The patch had `catch { /* verified below */ }` around the re-clear, and
  // nothing below verified anything -- the only downstream check is a y-gain
  // test, so a cell that refused to clear arrived as a mysterious refusal to
  // climb. CLAUDE.md is explicit that a comment quoting a verification that
  // does not exist is how greps and readers both pass for the wrong reason.
  const w = TOMB()
  // A sand column over the FIRST step's cells, so the step refills after it is
  // cut and the re-clear has something to fail on.
  w.set(0, 3, -1, 'sand'); w.set(0, 4, -1, 'sand'); w.set(0, 5, -1, 'sand')
  let swings = 0
  const bot = makeBot(w, {
    y: 44,
    digHook: async (b) => {
      swings++
      if (swings > 3 && b.name === 'sand') throw new Error('Digging aborted')
    },
  })
  const r = await escapeStairUp(bot, { maxSteps: 2, budgetMs: 30_000 })
  assert.ok(/re-clearing the step|falling column kept refilling|closed behind the dig/.test(r.stopped),
    `the failure was swallowed and reported as something else: ${r.stopped}`)
})

await t('AN ALREADY-OWNED BODY IS NOT SEIZED AT ALL', async () => {
  // `seizeBody` clears every control state, and it is the first thing this
  // routine did. Checking the yield only inside the loop would still wipe the
  // owner's stroke on the way in.
  const bot = makeBot(TOMB(), { y: 44 })
  const r = await escapeStairUp(bot, {
    maxSteps: 4, budgetMs: 20_000, yieldTo: () => 'the drowning rescue',
  })
  assert.strictEqual(r.yielded, 'the drowning rescue')
  assert.strictEqual(bot.clears, 0, 'the body was seized from its owner before anything was asked')
  assert.strictEqual(bot.digs.length, 0, 'and a yielded ramp must not dig')
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
