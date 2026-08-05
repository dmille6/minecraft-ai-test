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
import { log } from './logger.mjs'
import { countItem, horizontalDistanceFromSpawn } from './state.mjs'

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
async function goto(ctx, { x, y, z, range = 1 }, signal) {
  const { bot } = ctx
  assertInsideBorder(x, z)
  check(signal)
  const goal = new goals.GoalNear(x, y, z, range)
  const done = bot.pathfinder.goto(goal)
  signal?.addEventListener('abort', () => { try { bot.pathfinder.stop() } catch {} }, { once: true })
  await done
  const p = bot.entity.position
  return { status: 'success', detail: `arrived at ${p.x.toFixed(0)},${p.y.toFixed(0)},${p.z.toFixed(0)}` }
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
async function gather(ctx, { block: blockName, count = 16, maxDistance = 96 }, signal) {
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
    const target = bot.blockAt(positions[0])
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
async function status(ctx) {
  const { bot } = ctx
  const p = bot.entity.position
  const inv = bot.inventory.items().length
  return {
    status: 'success',
    detail: `hp ${bot.health?.toFixed(0)} food ${bot.food} at ${p.x.toFixed(0)},${p.y.toFixed(0)},${p.z.toFixed(0)} | ${inv} stacks`,
  }
}

export const SKILLS = {
  goto:    { run: goto,    usage: 'goto <x> <y> <z>',              args: ['x', 'y', 'z'] },
  gather:  { run: gather,  usage: 'gather <count> <block_name>',   args: ['count', 'block'] },
  come:    { run: come,    usage: 'come',                          args: [] },
  follow:  { run: follow,  usage: 'follow [seconds]',              args: [] },
  home:    { run: home,    usage: 'home',                          args: [] },
  deposit: { run: deposit, usage: 'deposit [item_name]',           args: [] },
  status:  { run: status,  usage: 'status',                        args: [] },
}

export { Aborted }
