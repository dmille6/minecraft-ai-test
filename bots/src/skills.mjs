// Deterministic skill layer -- handoff doc S9.2.
//
// Every skill is a plain async function with the same contract:
//   run(ctx, args, signal) -> { status, detail }
// where status is 'success' | 'failed' | 'aborted'.
//
// Skills never call an LLM. In pass 2 the model's only job is to CHOOSE among
// these and supply arguments; it never writes movement or block code. That
// separation is what makes failures attributable -- if a skill misbehaves it is
// a bug in here, not a bad generation.
//
// Every long loop must check `signal.aborted`, because the reflex layer
// preempts skills and a skill that ignores that will fight it.

import pkg from 'mineflayer-pathfinder'
const { goals, Movements } = pkg
import { Vec3 } from 'vec3'
import { config } from './config.mjs'
import { log, logEvent } from './logger.mjs'
import { countItem, horizontalDistanceFromSpawn, snapshot } from './state.mjs'

class Aborted extends Error { constructor() { super('aborted'); this.aborted = true } }
const check = signal => { if (signal?.aborted) throw new Aborted() }
const sleep = (ms, signal) => new Promise((res, rej) => {
  const t = setTimeout(res, ms)
  signal?.addEventListener('abort', () => { clearTimeout(t); rej(new Aborted()) }, { once: true })
})

/**
 * Bound a pathfinding attempt. mineflayer-pathfinder will happily keep
 * re-planning toward an unreachable goal, during which the bot never moves --
 * indistinguishable from being stuck, and it burns the whole skill timeout.
 */
function withTimeout(promise, ms, bot) {
  let t
  return Promise.race([
    promise,
    new Promise((_, rej) => {
      t = setTimeout(() => {
        try { bot.pathfinder.stop() } catch {}
        rej(new Error(`pathfinding exceeded ${ms}ms`))
      }, ms)
    }),
  ]).finally(() => clearTimeout(t))
}

/** Refuse any destination outside the world border. */
function assertInsideBorder(x, z) {
  const d = horizontalDistanceFromSpawn({ x, z })
  if (d > config.world.borderRadius) {
    throw new Error(`target ${Math.round(d)} blocks out exceeds border ${config.world.borderRadius}`)
  }
}

function bestTool(bot, block) {
  let best = null, bestTime = Infinity
  for (const it of bot.inventory.items()) {
    if (!block.canHarvest(it.type)) continue
    const t = block.digTime(it.type, false, false, false)
    if (t < bestTime) { bestTime = t; best = it }
  }
  return best
}

// ---------------------------------------------------------------- goto -----
//
// Long hops are broken into waypoints. A single 140-block goal through dense
// forest is a far harder search than three 50-block ones, and when it fails it
// fails totally -- the bot ends up exactly where it started with nothing
// learned. Incremental legs make partial progress real and turn one opaque
// failure into a specific one ("leg 2 of 3 was unreachable").
const MAX_LEG = 45

async function goto(ctx, { x, y, z, range = 1 }, signal) {
  const { bot } = ctx
  assertInsideBorder(x, z)
  check(signal)

  const target = new Vec3(Number(x), Number(y), Number(z))
  let legs = 0, lastErr = null

  while (legs < 8) {
    check(signal)
    const here = bot.entity.position
    const dist = Math.hypot(target.x - here.x, target.z - here.z)
    if (dist <= Math.max(range, 2)) break

    // Aim at an intermediate point when the goal is far away.
    let leg = target
    if (dist > MAX_LEG) {
      const f = MAX_LEG / dist
      leg = new Vec3(
        Math.round(here.x + (target.x - here.x) * f),
        Math.round(here.y + (target.y - here.y) * f),
        Math.round(here.z + (target.z - here.z) * f))
    }

    const before = here.clone()
    try {
      const p = bot.pathfinder.goto(new goals.GoalNear(leg.x, leg.y, leg.z, Math.max(range, 2)))
      signal?.addEventListener('abort', () => { try { bot.pathfinder.stop() } catch {} }, { once: true })
      await withTimeout(p, 25000, bot)
      lastErr = null
    } catch (e) {
      if (e.aborted) throw e
      lastErr = e.message
      const moved = bot.entity.position.distanceTo(before)
      // Distinguish "could not find a route" from "was interrupted mid-route".
      // Both previously surfaced as "Path was stopped", which taught the
      // lessons store nothing useful and told the model nothing at all.
      const noRoute = /no path|took to long|timeout|exceeded/i.test(e.message) && moved < 2
      if (noRoute) {
        return {
          status: 'failed',
          detail: `no route toward ${target.x},${target.z} — blocked after ${legs} leg(s), ${Math.round(dist)} blocks short`,
        }
      }
      if (moved < 2) {
        return {
          status: 'failed',
          detail: `stalled ${Math.round(dist)} blocks short of ${target.x},${target.z}: ${e.message.slice(0, 70)}`,
        }
      }
      // Moved somewhat -- that is progress, so try the next leg.
    }
    legs++
  }

  const p = bot.entity.position
  const left = Math.hypot(target.x - p.x, target.z - p.z)
  if (left <= Math.max(range, 3)) {
    return { status: 'success', detail: `arrived at ${p.x.toFixed(0)},${p.y.toFixed(0)},${p.z.toFixed(0)}` }
  }
  return {
    status: 'failed',
    detail: `got within ${Math.round(left)} blocks of ${target.x},${target.z} after ${legs} legs${lastErr ? ` (${lastErr.slice(0, 50)})` : ''}`,
  }
}

/**
 * Tree canopies are walkable (leaves are solid), so a bot that pathfinds up a
 * hillside or gets knocked onto foliage ends up standing 8+ blocks in the air
 * with every trunk below it "unreachable" -- observed repeatedly, and the direct
 * cause of gather burning 20-45s per attempt and returning `stuck`.
 *
 * Descending to real ground first costs one short path and makes the rest of
 * the skill behave the way it does on flat terrain.
 */
async function descendToGround(ctx, signal) {
  const { bot } = ctx
  const FOLIAGE = /(_leaves|_log|vine)$/
  const under = bot.blockAt(bot.entity.position.offset(0, -1, 0))
  if (!under || !FOLIAGE.test(under.name)) return false

  const ground = bot.findBlocks({
    matching: b => {
      const n = bot.registry.blocks[b.type]?.name
      return n === 'grass_block' || n === 'dirt' || n === 'sand' || n === 'stone'
    },
    maxDistance: 24, count: 40,
  }).filter(p => p.y < bot.entity.position.y - 2)
    .sort((a, b) => bot.entity.position.distanceTo(a) - bot.entity.position.distanceTo(b))

  if (ground.length) {
    const t = ground[0]
    log('info', 'gather: standing on foliage, descending to ground', {
      from: Math.round(bot.entity.position.y), to: t.y })
    try {
      await withTimeout(bot.pathfinder.goto(new goals.GoalNear(t.x, t.y + 1, t.z, 1)), 10000, bot)
      const now = bot.blockAt(bot.entity.position.offset(0, -1, 0))
      if (now && !FOLIAGE.test(now.name)) return true
    } catch { /* fall through to digging */ }
  }

  // Walking down failed. The bot is stranded on canopy with no walkable route
  // to the ground -- navigation keeps canDig=false deliberately, so pathfinder
  // cannot cut through the leaves holding it up.
  //
  // Digging down IS allowed here: this is the skill layer making an explicit,
  // bounded decision, not the pathfinder rearranging terrain as a side effect.
  log('info', 'gather: no walkable route down, digging through foliage',
      { y: Math.round(bot.entity.position.y) })
  logEvent({ kind: 'trapped_in_canopy', status: 'failed',
             detail: `stranded on foliage at y=${Math.round(bot.entity.position.y)}, digging out`,
             snapshot: snapshot(bot) })
  for (let i = 0; i < 12; i++) {
    check(signal)
    const below = bot.blockAt(bot.entity.position.offset(0, -1, 0))
    if (!below) break
    if (!FOLIAGE.test(below.name)) return true          // reached solid ground
    if (below.name === 'air') { await sleep(400, signal); continue }   // falling
    try {
      const tool = bestTool(bot, below)
      if (tool) await bot.equip(tool, 'hand').catch(() => {})
      await bot.dig(below)
      await sleep(300, signal)
    } catch (e) {
      if (e.aborted) throw e
      break
    }
  }
  return false
}

// -------------------------------------------------------------- gather -----
//
// Delegates to mineflayer-collectblock rather than hand-rolling path->dig->pickup.
//
// The hand-rolled version hit a chicken-and-egg that is genuinely hard: with
// pathfinder digging enabled the bot tunnels into pits reaching for canopy
// logs; with it disabled the bot cannot get into a tree at all, and ends up
// standing on the leaves unable to descend to the trunk. collectblock owns
// exactly this problem -- it manages its own movements, tool selection, and
// drop collection, and is scoped to collection so navigation elsewhere stays
// non-destructive (index.mjs keeps canDig=false for goto/come/home).
// maxDistance was 96, and that number nearly took the host down four times.
//
// collectblock runs its own movements WITH digging enabled, so the search space
// A* explores is the VOLUME of a sphere of this radius, and almost every block
// in solid rock is a legal move. Volume scales cubically: 96 -> 32 is 1/27th of
// the space.
//
// Measured, four incidents, all with an underground target:
//   gather stone       -> 3.3GB, OOM
//   gather stone       -> 9.66GB, host down to 311MB free
//   gather stone       -> OOM
//   gather cobblestone -> 9.42GB, host down to 996MB free
//
// The exposed-face filter below is still correct but was never sufficient on its
// own: within 96 blocks there is always SOME exposed stone at a cave wall, so
// the filter passed and collectblock then tried to tunnel 90 blocks to reach it.
//
// 32 is also just a better plan. A bot walking 96 blocks to fetch one block was
// never going to finish inside the skill watchdog anyway.
async function gather(ctx, { block: blockName, count = 16, maxDistance = 32 }, signal) {
  maxDistance = Math.min(Number(maxDistance) || 32, 48)   // callers cannot opt back into the blowup
  const { bot } = ctx
  const type = bot.registry.blocksByName[blockName]
  if (!type) return { status: 'failed', detail: `unknown block "${blockName}"` }

  await descendToGround(ctx, signal).catch(() => {})
  check(signal)

  const startHeld = countItem(bot, blockName)
  let collected = 0, rounds = 0, barren = 0
  const maxRounds = count * 4 + 8

  while (collected < count && rounds < maxRounds) {
    check(signal)
    rounds++

    const positions = bot
      .findBlocks({ matching: type.id, maxDistance, count: 32 })
      .filter(p => horizontalDistanceFromSpawn(p) <= config.world.borderRadius)

    if (positions.length === 0) {
      return collected > 0
        ? { status: 'success', detail: `collected ${collected} ${blockName} (none left within ${maxDistance})` }
        : { status: 'failed', detail: `no ${blockName} within ${maxDistance} blocks` }
    }

    // ONE block per collect() call. Passing a batch makes collectblock work
    // through them sequentially inside a single await, so the timeout below
    // covers the whole batch rather than one attempt -- observed collecting 3
    // logs successfully and then reporting failure because block 4 ran the
    // clock out. One at a time also means every call ends in movement, which
    // keeps the stuck reflex's timer honest.
    // Skip targets that are fully enclosed. collectblock runs its own movements
    // WITH digging enabled, so an embedded block turns A* loose on a solid
    // volume where nearly every neighbour is a legal move. The open set explodes
    // and the process dies.
    //
    // Measured: `gather stone` at y=68 took Gather02 from 130MB to 3.3GB in
    // ~200s -- roughly 1GB/min, twenty times any other bot -- and killed it with
    // "JavaScript heap out of memory" four times in two hours. Raising
    // --max-old-space-size to 3GB did not help; it blew through that too,
    // because the search SPACE is the problem, not the ceiling.
    //
    // Deliberately a measurement rather than a list of banned blocks: any block
    // with no exposed face must be tunnelled to, whatever it is called.
    // Ubiquitous underground blocks are just where it surfaces first, and `mine`
    // is the skill that descends on purpose.
    const exposed = p => {
      for (const d of [[0, 1, 0], [0, -1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]]) {
        const n = bot.blockAt(p.offset(d[0], d[1], d[2]))
        if (!n || n.name === 'air' || n.name === 'water' || n.boundingBox === 'empty') return true
      }
      return false
    }
    // Prefer blocks the bot can STAND BESIDE. `exposed` only asks whether the
    // block has an air face, which is true of every log in a tree canopy -- so
    // findBlocks would return a trunk section five blocks up in the foliage,
    // collectblock would try to path into mid-air, and the skill returned
    // "oak_log found but unreachable after 4 attempts". That was the dominant
    // failure once the fleet finally reached a forest.
    //
    // Standing room means: feet clear, HEAD clear, solid ground underfoot --
    // the same test that took unstick from 0/16 to working. A block with a
    // standable neighbour is one the bot can walk up to and mine.
    const standable = q => {
      const pass = b => !b || b.name === 'air' || b.boundingBox === 'empty'
      const feet = bot.blockAt(q), head = bot.blockAt(q.offset(0, 1, 0)), under = bot.blockAt(q.offset(0, -1, 0))
      return pass(feet) && pass(head) && under && under.boundingBox === 'block'
    }
    const approachable = pos => {
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        for (const dy of [0, -1]) if (standable(pos.offset(dx, dy, dz))) return true
      }
      return false
    }
    // Approachable first, nearest first within that -- but keep merely-exposed
    // blocks as a fallback so a slightly awkward target still beats giving up.
    const exposedOnes = positions.filter(exposed)
    const reachable = [
      ...exposedOnes.filter(approachable),
      ...exposedOnes.filter(q => !approachable(q)),
    ]
    if (reachable.length === 0) {
      return collected > 0
        ? { status: 'success', detail: `collected ${collected} ${blockName} (the rest are buried)` }
        : { status: 'failed', failClass: 'unreachable',
            detail: `${blockName} found but every candidate is buried — use mine to dig down` }
    }

    const target = bot.blockAt(reachable[0])
    if (!target || target.name !== blockName) continue

    try {
      // collect one (10s) < stuck reflex (20s) < skill watchdog (180s)
      await withTimeout(bot.collectBlock.collect(target, { ignoreNoPath: true }), 10000, bot)
    } catch (e) {
      if (e.aborted) throw e
      log('debug', 'gather: target failed', { at: `${target.position}`, err: e.message })
    }

    const gained = countItem(bot, blockName) - startHeld
    if (gained === collected) {
      barren++
      if (barren >= 4) {
        return collected > 0
          ? { status: 'success', detail: `collected ${collected}/${count} ${blockName}, rest unreachable` }
          : { status: 'failed', detail: `${blockName} found but unreachable after ${barren} attempts` }
      }
      // Reposition so the next scan ranks different candidates first rather
      // than retrying the same unreachable block forever.
      await bot.pathfinder.goto(new goals.GoalNear(
        bot.entity.position.x + (Math.random() * 10 - 5), bot.entity.position.y,
        bot.entity.position.z + (Math.random() * 10 - 5), 2)).catch(() => {})
    } else {
      barren = 0
    }
    collected = gained
  }

  return collected >= count
    ? { status: 'success', detail: `collected ${collected} ${blockName}` }
    : { status: 'failed', detail: `collected ${collected}/${count} ${blockName} before giving up` }
}

// ---------------------------------------------------------------- come -----
async function come(ctx, { player }, signal) {
  const { bot } = ctx
  const target = bot.players[player]?.entity
  if (!target) return { status: 'failed', detail: `cannot see ${player}` }
  const p = target.position
  return goto(ctx, { x: p.x, y: p.y, z: p.z, range: 2 }, signal)
}

// -------------------------------------------------------------- follow -----
async function follow(ctx, { player, durationMs = 60000 }, signal) {
  const { bot } = ctx
  const target = bot.players[player]?.entity
  if (!target) return { status: 'failed', detail: `cannot see ${player}` }
  bot.pathfinder.setGoal(new goals.GoalFollow(target, 2), true)
  try {
    await sleep(durationMs, signal)
  } finally {
    bot.pathfinder.setGoal(null)
  }
  return { status: 'success', detail: `followed ${player}` }
}

// ---------------------------------------------------------------- home -----
async function home(ctx, _args, signal) {
  const { homeX, homeY, homeZ } = config.world
  return goto(ctx, { x: homeX, y: homeY, z: homeZ, range: 2 }, signal)
}

// ------------------------------------------------------------- deposit -----
async function deposit(ctx, { item = null }, signal) {
  const { bot } = ctx
  const chestBlock = bot.findBlock({
    matching: b => ['chest', 'barrel', 'trapped_chest'].includes(bot.registry.blocks[b.type]?.name),
    maxDistance: 48,
  })
  if (!chestBlock) return { status: 'failed', detail: 'no chest or barrel within 48 blocks' }

  await bot.pathfinder.goto(new goals.GoalNear(chestBlock.position.x, chestBlock.position.y, chestBlock.position.z, 2))
  check(signal)

  const chest = await bot.openContainer(chestBlock)
  let moved = 0
  try {
    for (const it of bot.inventory.items()) {
      check(signal)
      if (item && it.name !== item) continue
      try { await chest.deposit(it.type, null, it.count); moved += it.count } catch { /* chest full */ }
    }
  } finally {
    chest.close()
  }
  return { status: moved > 0 ? 'success' : 'failed', detail: `deposited ${moved} items` }
}

// -------------------------------------------------------------- status -----
// Reports state and changes nothing. Genuinely useful when the agent's picture
// of itself is stale, and pure procrastination otherwise -- one bot called it 17
// times and its memory now reads "status has worked 18x -- a reliable choice".
// Same treatment as a full-belly eat: real, allowed, never counted as progress.
async function status(ctx) {
  const { bot } = ctx
  const p = bot.entity.position
  const inv = bot.inventory.items().length
  return {
    status: 'no_effect',
    detail: `hp ${bot.health?.toFixed(0)} food ${bot.food} at ${p.x.toFixed(0)},${p.y.toFixed(0)},${p.z.toFixed(0)} | ${inv} stacks`,
  }
}


// ----------------------------------------------------------------- eat -----
const FOOD_PRIORITY = [
  'golden_carrot', 'cooked_beef', 'cooked_porkchop', 'cooked_mutton',
  'cooked_chicken', 'bread', 'baked_potato', 'cooked_cod', 'cooked_salmon',
  'apple', 'carrot', 'melon_slice', 'sweet_berries',
]

async function eat(ctx, _args, signal) {
  const { bot } = ctx
  // Eating when already full is a NO-OP, and reporting it as success taught the
  // fleet to do nothing. Measured live: 15 `eat -> success "not hungry"` in ten
  // minutes while every productive skill was blocked, and the lessons file duly
  // recorded "eat has worked 15x -- a reliable choice" and fed that back into
  // the prompt. All five bots stood motionless, succeeding.
  //
  // A skill that changes nothing must not be reinforced as achievement
  // (ADR-0003). `no_effect` is deliberately distinct from `failed`: the bot did
  // nothing wrong, there was simply nothing to do, and the admission layer
  // should not start avoiding `eat` for when it IS hungry.
  if ((bot.food ?? 20) >= 20) {
    return { status: 'no_effect', detail: 'already full — nothing to do', failClass: 'no_effect' }
  }
  const items = bot.inventory.items()
  const food = FOOD_PRIORITY.map(n => items.find(i => i.name === n)).find(Boolean)
  if (!food) return { status: 'failed', detail: 'no edible food in inventory' }
  check(signal)
  try {
    await bot.equip(food, 'hand')
    await bot.consume()
    return { status: 'success', detail: `ate ${food.name}, hunger now ${bot.food}` }
  } catch (e) {
    return { status: 'failed', detail: `could not eat ${food.name}: ${e.message}` }
  }
}

// --------------------------------------------------------------- craft -----
//
// Crafting is the first skill that can FAIL FOR A GOOD REASON -- missing
// ingredients is information, not a bug. The detail string names what is
// missing so the model can choose to gather it, which is the whole point of
// having a cognitive layer at all.
async function craft(ctx, { item, count = 1 }, signal) {
  const { bot } = ctx
  const def = bot.registry.itemsByName[item]
  if (!def) return { status: 'failed', detail: `unknown item "${item}"` }

  // Recipes needing no table first -- cheaper and always available.
  let recipe = bot.recipesFor(def.id, null, count, null)[0]
  let table = null

  if (!recipe) {
    const tableBlock = bot.findBlock({
      matching: b => bot.registry.blocks[b.type]?.name === 'crafting_table',
      maxDistance: 32,
    })
    if (tableBlock) {
      check(signal)
      try {
        await withTimeout(bot.pathfinder.goto(
          new goals.GoalNear(tableBlock.position.x, tableBlock.position.y, tableBlock.position.z, 2)), 12000, bot)
      } catch { /* try crafting anyway; we may already be close enough */ }
      table = tableBlock
      recipe = bot.recipesFor(def.id, null, count, table)[0]
    }
  }

  if (!recipe) {
    const hasTable = bot.inventory.items().some(i => i.name === 'crafting_table')

    // NAME THE MISSING INGREDIENT. "missing ingredients" taught the model
    // nothing, and it showed: a bot stood two blocks from the crafting table
    // holding 59 oak_log and asked for `stick` five times and `wooden_pickaxe`
    // four times, never once for `oak_planks` -- the intermediate step. It had
    // the raw material and no way to learn what the gap was.
    //
    // Ask the registry which ingredients ANY recipe for this item wants, and
    // report the ones the bot does not have. The model can act on a name.
    let missing = []
    try {
      const all = [
        ...bot.recipesAll(def.id, null, null),
        ...(bot.recipesAll(def.id, null, true) ?? []),
      ]
      // Report the CLOSEST recipe, not the union of every variant. Minecraft
      // has a plank recipe per wood type, so unioning them told a bot holding
      // oak_log that it needed "cherry_planks and bamboo_planks and
      // mangrove_planks" -- true of some recipe, useless as advice.
      //
      // Fewest-missing-ingredients is the recipe the bot is nearest to being
      // able to make, which is the one worth naming.
      let best = null
      for (const r of all.slice(0, 12)) {
        const gap = []
        for (const d of (r.delta ?? [])) {
          if (d.count >= 0) continue                       // positive = produced
          const n = bot.registry.items[d.id]?.name
          if (n && countItem(bot, n) < -d.count) gap.push(`${-d.count}x ${n}`)
        }
        // Tiebreak toward what this bot could ACTUALLY make. Every wood type
        // has its own plank recipe, so a bot holding oak_log was told it needed
        // "cherry_planks" -- true, and unreachable. Prefer a recipe whose
        // missing ingredients share a stem with something in the inventory
        // (oak_log -> oak_planks), because that is the one step it can take.
        const held = bot.inventory.items().map(i => i.name.split('_')[0])
        const affinity = g => g.filter(x => held.includes(x.split(' ').pop().split('_')[0])).length
        if (!best ||
            gap.length < best.length ||
            (gap.length === best.length && affinity(gap) > affinity(best))) best = gap
        if (best.length === 0) break
      }
      missing = best ?? []
    } catch { /* registry shape varies by version; fall back to the generic message */ }

    const why = missing.length
      ? `needs ${missing.join(' and ')} (you have ` +
        `${bot.inventory.items().slice(0, 3).map(i => `${i.count}x ${i.name}`).join(', ') || 'nothing'})`
      : 'missing ingredients or need a crafting_table nearby'

    return {
      status: 'failed',
      failClass: 'missing_ingredients',
      detail: hasTable && !missing.length
        ? `no recipe available for ${item}; place the crafting_table first`
        : `cannot craft ${item} -- ${why}`,
    }
  }

  check(signal)
  try {
    await bot.craft(recipe, count, table ?? undefined)
    return { status: 'success', detail: `crafted ${count}x ${item}` }
  } catch (e) {
    return { status: 'failed', detail: `craft ${item} failed: ${e.message}` }
  }
}

// --------------------------------------------------------------- place -----
async function place(ctx, { item, x, y, z }, signal) {
  const { bot } = ctx
  const held = bot.inventory.items().find(i => i.name === item)
  if (!held) return { status: 'failed', detail: `no ${item} in inventory` }

  // Place adjacent to the bot when no explicit spot is given -- the common case
  // (crafting table, bed) where "somewhere I can reach" is all that matters.
  let ref = null, face = null
  if ([x, y, z].every(v => Number.isFinite(Number(v)))) {
    assertInsideBorder(Number(x), Number(z))
    ref = bot.blockAt(new Vec3(Number(x), Number(y) - 1, Number(z)))
    face = new Vec3(0, 1, 0)
  } else {
    for (const d of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const under = bot.blockAt(bot.entity.position.offset(d[0], -1, d[1]))
      const at = bot.blockAt(bot.entity.position.offset(d[0], 0, d[1]))
      if (under && under.name !== 'air' && at && at.name === 'air') { ref = under; face = new Vec3(0, 1, 0); break }
    }
  }
  if (!ref || ref.name === 'air') return { status: 'failed', detail: 'no solid surface to place against' }

  check(signal)
  try {
    await bot.equip(held, 'hand')
    await bot.placeBlock(ref, face)
    return { status: 'success', detail: `placed ${item} at ${ref.position.offset(0, 1, 0)}` }
  } catch (e) {
    return { status: 'failed', detail: `place ${item} failed: ${e.message}` }
  }
}

// --------------------------------------------------------------- build -----
//
// The first skill whose output PERSISTS. Everything else the agents do is
// erased by the next restart -- gathered items get lost, positions get reset,
// milestones recompute. A placed block stays placed, which is what makes a
// settlement possible and what makes progress visible from inside the game.
//
// DELIBERATELY STATELESS. Three separate bugs tonight came from a counter kept
// somewhere other than where the truth lived: milestone attempts reset on
// restart, the probation countdown reset on reconnect, and lessons.save() was
// never called on the path that mattered. So this skill stores no progress at
// all -- it reads the world, skips what is already correct, and places what is
// missing. The structure IS the progress record, and it cannot disagree with
// itself.
//
// Every placement is READ BACK. bot.placeBlock resolves without throwing in
// cases where nothing was actually placed (occluded, entity in the way, server
// rejected it), and place() above reports success on that basis. A build that
// reports 20/20 while the wall has holes in it is worse than one that fails.

const BLUEPRINTS = {
  // Small open shelter: a 5x5 floor with 3-high walls and a doorway facing +x.
  shelter: (b = 'oak_planks') => {
    const out = []
    for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) out.push({ dx, dy: 0, dz, block: b })
    for (let dy = 1; dy <= 3; dy++) {
      for (let d = -2; d <= 2; d++) {
        out.push({ dx: d, dy, dz: -2, block: b })
        out.push({ dx: d, dy, dz: 2, block: b })
        out.push({ dx: -2, dy, dz: d, block: b })
        if (!(dy <= 2 && d === 0)) out.push({ dx: 2, dy, dz: d, block: b })  // doorway
      }
    }
    return out
  },
  // A straight wall, 7 long and 3 high, running along z.
  wall: (b = 'oak_planks') => {
    const out = []
    for (let dz = -3; dz <= 3; dz++) for (let dy = 1; dy <= 3; dy++) out.push({ dx: 0, dy, dz, block: b })
    return out
  },
  // Marker pillar -- cheap, unmistakable from a distance, good for testing.
  pillar: (b = 'oak_planks') => {
    const out = []
    for (let dy = 1; dy <= 6; dy++) out.push({ dx: 0, dy, dz: 0, block: b })
    return out
  },
}

async function build(ctx, { plan = 'pillar', block = 'oak_planks', x, y, z }, signal) {
  const { bot } = ctx
  const make = BLUEPRINTS[plan]
  if (!make) {
    return { status: 'failed', detail: `unknown plan "${plan}"; have ${Object.keys(BLUEPRINTS).join(', ')}` }
  }

  // Anchor at the given point, else the configured home -- so repeated calls
  // converge on ONE structure instead of scattering half-built stubs.
  const ax = Number.isFinite(Number(x)) ? Number(x) : config.world.homeX
  const ay = Number.isFinite(Number(y)) ? Number(y) : config.world.homeY
  const az = Number.isFinite(Number(z)) ? Number(z) : config.world.homeZ
  assertInsideBorder(ax, az)

  const spec = make(block)
  let already = 0, placed = 0, failed = 0, lastErr = null

  for (const cell of spec) {
    check(signal)
    const pos = new Vec3(ax + cell.dx, ay + cell.dy, az + cell.dz)

    const current = bot.blockAt(pos)
    if (current && current.name === cell.block) { already++; continue }
    if (current && current.name !== 'air' && !current.name.includes('leaves') &&
        !current.name.includes('grass') && current.name !== 'snow') {
      failed++; lastErr = `${current.name} in the way at ${pos.x},${pos.y},${pos.z}`; continue
    }

    const held = bot.inventory.items().find(i => i.name === cell.block)
    if (!held) {
      // Out of materials is not a failure of the plan -- report honestly and
      // stop, so the cognitive layer can go and gather rather than grind.
      break
    }

    // Must be adjacent to place. Do not fight the pathfinder over one block.
    if (bot.entity.position.distanceTo(pos) > 4) {
      try {
        await bot.pathfinder.goto(new goals.GoalNear(pos.x, pos.y, pos.z, 3))
      } catch {
        failed++; lastErr = `cannot reach ${pos.x},${pos.y},${pos.z}`; continue
      }
      check(signal)
    }

    const ref = bot.blockAt(pos.offset(0, -1, 0))
    if (!ref || ref.name === 'air') { failed++; lastErr = `nothing to place against under ${pos.x},${pos.y},${pos.z}`; continue }

    try {
      await bot.equip(held, 'hand')
      await bot.placeBlock(ref, new Vec3(0, 1, 0))
    } catch (e) {
      failed++; lastErr = e.message; continue
    }

    // READ IT BACK. This is the whole point.
    await new Promise(r => setTimeout(r, 120))
    const after = bot.blockAt(pos)
    if (after && after.name === cell.block) placed++
    else { failed++; lastErr = `placeBlock reported no error but ${pos.x},${pos.y},${pos.z} is ${after?.name ?? 'unknown'}` }
  }

  const done = already + placed
  const detail = `${plan} at ${ax},${ay},${az}: ${done}/${spec.length} in place (${placed} new, ${already} already, ${failed} failed)` +
                 (lastErr ? ` — last problem: ${lastErr}` : '')

  if (done === spec.length) return { status: 'success', detail }
  if (placed > 0) return { status: 'success', detail }          // real progress this call
  return { status: 'failed', detail }
}


// -------------------------------------------------------------- explore -----
//
// Travel outward to somewhere the fleet has not been, so the survey in the
// reflex layer has new ground to see.
//
// Why this exists: all five bots ended up standing within sixteen blocks of
// spawn, three of them on the identical block, deadlocked. Their memory was
// correct -- "crafting a stick is unreachable AT 1,0" is true, they had stripped
// the area -- but a correct fact about a stripped patch is a trap when you never
// leave the patch. They knew everything about where they were and nothing about
// anywhere else.
//
// Deliberately NOT random walking. It picks a heading away from spawn and from
// known hazards, moves in legs the pathfinder can actually finish, and reports
// honestly how far it got. A leg that fails is information, not a retry loop.
async function explore(ctx, { blocks = 60, heading = null }, signal) {
  const { bot } = ctx
  const start = bot.entity.position.clone()

  // Head away from SPAWN, not away from home.
  //
  // The original said "away from spawn" in the comment and computed away from
  // config.world.homeX/Z, which was the same point until the colony moved. Once
  // home became 28,0 and spawn stayed 0,0, a bot that drifted west of home was
  // sent FURTHER west -- straight back into the mined-out crater it had just been
  // moved out of. Observed: Scout01 and Gather01 both back at 0,75,0 and 2,73,0
  // with Scout01 down to 1 admitted decision in 10 and nothing left to try there.
  //
  // Spawn is the depleted origin in this world: it is where every bot started,
  // where the resources were stripped first, and where the cave damage is. Away
  // from it is the direction with unexplored ground, which is what the comment
  // always meant.
  let ang
  if (Number.isFinite(Number(heading))) ang = (Number(heading) * Math.PI) / 180
  else {
    const dx = start.x, dz = start.z            // spawn is the origin
    ang = (Math.hypot(dx, dz) < 12 ? Math.random() * Math.PI * 2 : Math.atan2(dz, dx))
      + (Math.random() - 0.5) * 0.8
  }

  const want = Math.min(Math.max(Number(blocks) || 60, 20), 120)
  // 12, not 25. At 25 blocks through forest, A* spends long enough planning that
  // the bot stands still past the 45s stuck threshold and the reflex cancels the
  // path -- measured, 8 explore attempts and 8 aborts, every single one killed
  // by `reflex: stuck`. Thinking was indistinguishable from being wedged again.
  //
  // Short legs keep the bot WALKING, which is both the point of the skill and
  // the thing that proves to the reflex layer it is not stuck. goto uses 45 for
  // open travel; forest needs less.
  const LEG = 12
  let travelled = 0, legs = 0, lastErr = null

  while (travelled < want && legs < 14) {
    check(signal)
    legs++
    const from = bot.entity.position.clone()
    const step = Math.min(LEG, want - travelled)
    const tx = Math.round(from.x + Math.cos(ang) * step)
    const tz = Math.round(from.z + Math.sin(ang) * step)
    try { assertInsideBorder(tx, tz) } catch { ang += Math.PI / 2; continue }

    try {
      // BOUNDED. The helper at the top of this file exists because
      // mineflayer-pathfinder re-plans toward an unreachable goal forever, and
      // the bot does not move while it does -- which is indistinguishable from
      // being stuck. I wrote this skill without it and paid for it: 11 explore
      // attempts, 11 aborts, every one killed by `reflex: stuck` at 45s while
      // the pathfinder churned on a goal it was never going to reach.
      //
      // 8s per leg, well inside the 45s stuck window, so a doomed leg costs one
      // heading change instead of the whole skill.
      await withTimeout(
        bot.pathfinder.goto(new goals.GoalNear(tx, Math.round(from.y), tz, 3)), 8000, bot)
    } catch (e) {
      lastErr = e.message
      ang += (Math.random() < 0.5 ? 1 : -1) * (Math.PI / 3)   // blocked: turn, do not give up
      // MOVE, even on failure. Each failed leg costs up to the pathfinder's
      // think timeout with the bot stationary, so three or four in a row
      // accumulate past the 45s stuck threshold and the reflex cancels the whole
      // skill -- measured, 8 explore attempts and 8 aborts, every one killed by
      // `reflex: stuck` while the bot was busy planning.
      //
      // A short walk in the new heading proves to the reflex layer that the bot
      // is working, and incidentally makes the next plan start from somewhere
      // different, which is often why the previous one failed.
      try {
        await bot.look(ang, 0, true)
        bot.setControlState('forward', true)
        bot.setControlState('jump', true)
        await sleep(1200, signal)
        bot.clearControlStates()
      } catch { bot.clearControlStates() }
      continue
    }
    check(signal)
    travelled += from.distanceTo(bot.entity.position)
  }

  const moved = Math.round(start.distanceTo(bot.entity.position))
  const p = bot.entity.position
  const detail = `explored ${moved} blocks to ${Math.round(p.x)},${Math.round(p.z)} in ${legs} legs` +
                 (lastErr ? ` (some legs blocked: ${String(lastErr).slice(0, 40)})` : '')
  // Movement IS the deliverable here, so the threshold is distance, not arrival
  // at any particular place.
  if (moved >= 20) return { status: 'success', detail }
  if (moved >= 5) return { status: 'no_effect', detail: `${detail} — barely moved`, failClass: 'stuck' }
  return { status: 'failed', detail: `could not explore: ${detail}`, failClass: 'no_path' }
}


// ------------------------------------------------------------- withdraw -----
//
// The inverse of deposit, and its absence was structural.
//
// `deposit` has existed since the storage work; `withdraw` never did. A bot
// could put items into a chest and no bot could ever take them out, so the
// shared chests were a one-way sink. Measured tonight: the two scouts held 25
// and 59 oak_log between them and are never told to craft, while Miner01 -- the
// one whose milestone chain IS planks -> sticks -> table -> pickaxe -- held five
// dirt. The materials and the job were in different bots with no path between
// them.
//
// Same shape as the rest of tonight's bugs: something could be added but never
// removed, a guard could trip with no way back. A colony needs both directions.
async function withdraw(ctx, { item = null, count = 16 }, signal) {
  const { bot } = ctx
  const chestBlock = bot.findBlock({
    matching: b => ['chest', 'barrel', 'trapped_chest'].includes(bot.registry.blocks[b.type]?.name),
    maxDistance: 48,
  })
  if (!chestBlock) return { status: 'failed', failClass: 'nothing_found', detail: 'no chest or barrel within 48 blocks' }

  check(signal)
  try {
    await withTimeout(bot.pathfinder.goto(
      new goals.GoalNear(chestBlock.position.x, chestBlock.position.y, chestBlock.position.z, 2)), 20000, bot)
  } catch {
    return { status: 'failed', failClass: 'no_path', detail: `could not reach the chest at ${chestBlock.position.x},${chestBlock.position.z}` }
  }
  check(signal)

  const chest = await bot.openContainer(chestBlock)
  try {
    const items = chest.containerItems()
    if (!items.length) {
      return { status: 'no_effect', detail: 'the chest is empty' }
    }
    // No item named -> take whatever is most plentiful. A bot that knows it
    // needs something specific should say so; one that just needs materials
    // should not have to guess what is in there.
    const want = item
      ? items.filter(i => i.name === item)
      : [items.slice().sort((a, b) => b.count - a.count)[0]]
    if (!want.length) {
      return {
        status: 'failed', failClass: 'nothing_found',
        detail: `no ${item} in the chest — it holds ${items.slice(0, 4).map(i => `${i.count}x ${i.name}`).join(', ')}`,
      }
    }
    let took = 0
    for (const it of want) {
      check(signal)
      const n = Math.min(it.count, Math.max(1, Number(count) || 16) - took)
      if (n <= 0) break
      await chest.withdraw(it.type, null, n)
      took += n
      if (took >= (Number(count) || 16)) break
    }
    return took > 0
      ? { status: 'success', detail: `withdrew ${took}x ${want[0].name} from the chest` }
      : { status: 'no_effect', detail: 'nothing withdrawn' }
  } catch (e) {
    return { status: 'failed', detail: `withdraw failed: ${e.message.slice(0, 70)}` }
  } finally {
    try { chest.close() } catch { /* already closed */ }
  }
}

// ---------------------------------------------------------------- mine -----
//
// Distinct from gather: gather goes to blocks it can already see, mine
// descends to reach ones it cannot. Staircase rather than straight down --
// digging straight down is how bots fall into lava.
async function mine(ctx, { y: targetY = 12 }, signal) {
  const { bot } = ctx
  const goalY = Math.max(-59, Math.min(Number(targetY) || 12, 120))

  // REFUSE THE DESCENT rather than failing partway down it.
  //
  // Measured over 30 minutes: `mine -> success "reached y=N"` five times and
  // `mine -> failed "need a better tool for stone"` eight times. The bot dug
  // itself 6-8 blocks down, arrived beside stone it could not harvest, and was
  // then stranded in the cave layer where unstick works worst and the watchdog
  // takes twelve minutes to notice. Every bot in the fleet ended up at y=69-71
  // this way while the base sat at y=77.
  //
  // The old check ran INSIDE the loop, so it only fired after the damage. Same
  // shape as the rest of tonight: a capability with no precondition, only a
  // post-hoc failure. Descending is easy and coming back is not, so the check
  // belongs before the first block is broken.
  //
  // The detail is written for the model: it names the thing to do instead.
  if (goalY < bot.entity.position.y - 2 && !bot.inventory.items().some(i => /_pickaxe$/.test(i.name))) {
    return {
      status: 'failed',
      failClass: 'missing_tool',
      detail: 'no pickaxe, so descending would strand this bot beside stone it cannot mine — ' +
              'craft a wooden_pickaxe first (3 oak_planks + 2 sticks, at a crafting_table)',
    }
  }

  let steps = 0
  while (bot.entity.position.y > goalY + 1 && steps < 90) {
    check(signal)
    steps++
    const ahead = bot.entity.position.offset(0, -1, 0)
    const below = bot.blockAt(ahead)
    if (!below) break
    if (below.name === 'lava' || below.name === 'water') {
      return { status: 'failed', detail: `stopped at y=${Math.round(bot.entity.position.y)}: ${below.name} below` }
    }
    if (below.name === 'air') { await sleep(300, signal); continue }
    const tool = bestTool(bot, below)
    if (tool) await bot.equip(tool, 'hand').catch(() => {})
    if (!below.canHarvest(bot.heldItem?.type ?? null)) {
      return { status: 'failed', detail: `need a better tool for ${below.name} at y=${Math.round(bot.entity.position.y)}` }
    }
    try { await bot.dig(below) } catch (e) { if (e.aborted) throw e; break }
    // Step sideways every few blocks so it is a staircase, not a shaft.
    if (steps % 3 === 0) {
      const side = bot.blockAt(bot.entity.position.offset(1, 0, 0))
      if (side && side.name !== 'air') { try { await bot.dig(side) } catch { /* optional */ } }
    }
    await sleep(150, signal)
  }
  return { status: 'success', detail: `reached y=${Math.round(bot.entity.position.y)}` }
}

// --------------------------------------------------------------- sleep -----
async function sleepSkill(ctx, _args, signal) {
  const { bot } = ctx
  if (!isNightTime(bot)) return { status: 'failed', detail: 'can only sleep at night' }

  let bed = bot.findBlock({ matching: b => bot.registry.blocks[b.type]?.name?.endsWith('_bed'), maxDistance: 32 })
  if (!bed) {
    const inBag = bot.inventory.items().find(i => i.name.endsWith('_bed'))
    if (!inBag) return { status: 'failed', detail: 'no bed nearby and none in inventory' }
    const placed = await place(ctx, { item: inBag.name }, signal)
    if (placed.status !== 'success') return { status: 'failed', detail: `could not place bed: ${placed.detail}` }
    bed = bot.findBlock({ matching: b => bot.registry.blocks[b.type]?.name?.endsWith('_bed'), maxDistance: 8 })
    if (!bed) return { status: 'failed', detail: 'placed a bed but cannot find it' }
  }

  check(signal)
  try {
    await withTimeout(bot.pathfinder.goto(
      new goals.GoalNear(bed.position.x, bed.position.y, bed.position.z, 2)), 12000, bot)
    await bot.sleep(bed)
    return { status: 'success', detail: 'sleeping through the night' }
  } catch (e) {
    return { status: 'failed', detail: `sleep failed: ${e.message}` }
  }
}

function isNightTime(bot) {
  const t = bot.time?.timeOfDay ?? 0
  return t >= 12542 && t <= 23458
}

export const SKILLS = {
  goto:    { run: goto,    usage: 'goto <x> <y> <z>',              args: ['x', 'y', 'z'] },
  gather:  { run: gather,  usage: 'gather <count> <block_name>',   args: ['count', 'block'] },
  come:    { run: come,    usage: 'come',                          args: [] },
  follow:  { run: follow,  usage: 'follow [seconds]',              args: [] },
  home:    { run: home,    usage: 'home',                          args: [] },
  deposit: { run: deposit, usage: 'deposit [item_name]',           args: [] },
  withdraw:{ run: withdraw,usage: 'withdraw [item_name] [count]',  args: ['item', 'count'] },
  status:  { run: status,  usage: 'status',                        args: [] },
  eat:     { run: eat,     usage: 'eat',                           args: [] },
  craft:   { run: craft,   usage: 'craft <count> <item_name>',     args: ['item', 'count'] },
  place:   { run: place,   usage: 'place <item_name>',             args: ['item'] },
  build:   { run: build,   usage: 'build <plan> [block_name]',      args: ['plan', 'block'] },
  explore: { run: explore, usage: 'explore [blocks]',              args: ['blocks'] },
  mine:    { run: mine,    usage: 'mine <target_y>',               args: ['y'] },
  sleep:   { run: sleepSkill, usage: 'sleep',                      args: [] },
}

export { Aborted }
