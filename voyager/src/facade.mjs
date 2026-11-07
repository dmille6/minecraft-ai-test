// voyager-01: THE FACADE -- everything generated code can make the bot do (design §4).
//
// Each handler takes the copied argument list from the sandbox and returns a JSON-clean object: never a mineflayer
// object, a Vec3, a Block or an Item. Body actions go through OUR runner (`runner.run`), so the reflex layer preempts them
// exactly as it preempts a fleet skill. Every refusal names a remedy the bot can perform from where it is.
//
// The vy_place / vy_dig / vy_chest skills are registered into the fleet's SKILLS table at start-up (registerVySkills),
// not written into skills.mjs: no protected file changes.

import { createRequire } from 'node:module'

const requireBots = createRequire(new URL('../../bots/src/index.mjs', import.meta.url))
const { Vec3 } = requireBots('vec3')
export { Vec3 }
const { resyncPacket } = await import('../../bots/src/craftsync.mjs')

export const NAME_RE = /^[a-z0-9_]{1,48}$/
export const SPAWN_GUARD = 8           // no place/dig within this many blocks (x and z) of world spawn
export const REACH = 4.5
export const WAIT_MAX_MS = 10_000
export const WORLD_LIMIT = 1000        // max-world-size in server.properties (design §12 B5)
const REPLACEABLE = new Set(['air', 'cave_air', 'void_air', 'water', 'short_grass', 'tall_grass', 'grass', 'fern', 'large_fern',
  'snow', 'dead_bush', 'vine', 'seagrass', 'tall_seagrass', 'glow_lichen', 'lava', 'leaf_litter', 'short_dry_grass',
  'tall_dry_grass', 'bush', 'firefly_bush', 'pink_petals', 'wildflowers'])

const round1 = v => Math.round(v * 10) / 10
const posOf = p => p ? { x: round1(p.x), y: round1(p.y), z: round1(p.z) } : null
const cell = (x, y, z) => ({ x: Math.floor(x), y: Math.floor(y), z: Math.floor(z) })

/** Validate the argument list against a tiny schema. Pure. Returns {args} or {error}. */
export function checkArgs (spec, args) {
  const out = []
  for (let i = 0; i < spec.length; i++) {
    const [kind, opt] = spec[i]
    const v = args[i]
    if (v === undefined || v === null) {
      if (opt?.default !== undefined) { out.push(opt.default); continue }
      return { error: `argument ${i + 1} is missing (${kind})` }
    }
    if (kind === 'name') {
      if (typeof v !== 'string' || !NAME_RE.test(v)) return { error: `argument ${i + 1} must be a Minecraft id like "oak_log" (lowercase, underscores)` }
      out.push(v)
    } else if (kind === 'int') {
      const n = Number(v)
      if (!Number.isInteger(n) || n < (opt?.min ?? 1) || n > (opt?.max ?? 64)) return { error: `argument ${i + 1} must be a whole number ${opt?.min ?? 1}-${opt?.max ?? 64}` }
      out.push(n)
    } else if (kind === 'coord') {
      const n = Number(v)
      const lim = opt?.y ? [-64, 319] : [-WORLD_LIMIT, WORLD_LIMIT]
      if (!Number.isFinite(n) || n < lim[0] || n > lim[1]) return { error: `argument ${i + 1} must be a coordinate ${lim[0]}..${lim[1]}` }
      out.push(n)
    } else if (kind === 'enum') {
      if (!opt.values.includes(v)) return { error: `argument ${i + 1} must be one of ${opt.values.join(', ')}` }
      out.push(v)
    } else if (kind === 'text') {
      if (typeof v !== 'string') return { error: `argument ${i + 1} must be text` }
      out.push(v)
    }
  }
  return { args: out }
}

// control characters, zero-width and bidi marks, line/paragraph separators, BOM (written as escapes on purpose)
const INVISIBLE = new RegExp('[\\u0000-\\u001f\\u007f-\\u009f\\u200b-\\u200f\\u2028-\\u202e\\u2066-\\u2069\\ufeff]', 'g')
const SLASHES = new RegExp('^[/\\uff0f\\u2215\\u2044\\u29f8]')

/** Chat filter (design §3.4). Pure. Returns the line to send, or null when it must be dropped (and why). */
export function filterSay (text) {
  const s = String(text ?? '').replace(INVISIBLE, '').trim()
  if (!s) return { line: null, why: 'empty' }
  // a slash, or a look-alike (fullwidth solidus, division slash, fraction slash, big solidus): a command attempt
  if (SLASHES.test(s.normalize('NFKC')) || SLASHES.test(s)) return { line: null, why: 'command' }
  return { line: s.slice(0, 100), why: null }
}

export function nearSpawn (spawn, x, z, guard = SPAWN_GUARD) {
  if (!spawn) return false
  return Math.abs(Math.floor(x) - Math.floor(spawn.x)) <= guard && Math.abs(Math.floor(z) - Math.floor(spawn.z)) <= guard
}

/** Inventory as {name: count}. */
export function inventoryCounts (bot) {
  const inv = {}
  for (const it of bot.inventory?.items?.() ?? []) inv[it.name] = (inv[it.name] ?? 0) + it.count
  return inv
}

/** The 17x9x17 block census around the bot: {name: count}, air excluded. */
export function census (bot, r = 8, h = 4) {
  const p = bot.entity?.position
  const out = {}
  if (!p) return out
  for (let dx = -r; dx <= r; dx++) for (let dy = -h; dy <= h; dy++) for (let dz = -r; dz <= r; dz++) {
    const b = bot.blockAt(p.offset(dx, dy, dz))
    if (!b || b.name === 'air' || b.name === 'cave_air') continue
    out[b.name] = (out[b.name] ?? 0) + 1
  }
  return out
}

/** A JSON-clean picture of the bot's state (the curriculum's input and `bot.observe()`). */
export function observeState (bot, spawn = null) {
  const p = bot.entity?.position
  const ents = {}
  for (const e of Object.values(bot.entities ?? {})) {
    if (!e || e === bot.entity || !e.position || !p) continue
    if (e.position.distanceTo(p) > 16) continue
    const n = e.name ?? e.type ?? 'entity'
    ents[n] = (ents[n] ?? 0) + 1
  }
  let biome = null
  try { biome = bot.blockAt(p)?.biome?.name ?? null } catch { biome = null }
  return {
    pos: posOf(p), health: round1(bot.health ?? 0), food: bot.food ?? null,
    inventory: inventoryCounts(bot), holding: bot.heldItem?.name ?? null,
    biome, time: bot.time?.timeOfDay ?? null, day: bot.time?.isDay ?? null,
    spawn: spawn ? posOf(spawn) : null, blocks: census(bot), nearby: ents,
  }
}

// ---------------------------------------------------------------------------------------------------------------
// The vy_ skills: one block placed, one block dug, one chest move. Each reads the world back before it says done.

function itemBlockName (bot, item) {
  const reg = bot.registry
  const it = reg.itemsByName?.[item]
  if (!it) return null
  if (reg.blocksByName?.[item]) return item
  // a few items place a differently named block
  const map = { redstone: 'redstone_wire', string: 'tripwire', wheat_seeds: 'wheat', carrot: 'carrots', potato: 'potatoes',
    beetroot_seeds: 'beetroots', sweet_berries: 'sweet_berry_bush', torch: 'torch', water_bucket: 'water', lava_bucket: 'lava' }
  return map[item] ?? null
}

const FACES = [[0, -1, 0], [0, 1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]]

function bodyCells (bot) {
  const p = bot.entity.position
  const f = cell(p.x, p.y, p.z)
  return [f, { ...f, y: f.y + 1 }]
}
const sameCell = (a, b) => a.x === b.x && a.y === b.y && a.z === b.z

// THE BAG CAN LIE (stage 2, 11-07 00:27-00:40Z): a crafting table left in the world by a craft stayed in mineflayer's
// inventory, and 12 placements of it came back "air". One no-op click with stateId -1 (craftsync.mjs resyncPacket) makes
// Paper send the whole inventory again. Only sent with an empty cursor, where it is a no-op.
export async function resyncInventory (bot, ms = 1000) {
  if (!bot._client || bot.inventory?.selectedItem) return false
  const got = new Promise(res => {
    const t = setTimeout(() => { bot._client.removeListener('window_items', on); res(false) }, ms)
    const on = p => { if (p.windowId === 0) { clearTimeout(t); bot._client.removeListener('window_items', on); res(true) } }
    bot._client.on('window_items', on)
  })
  try { bot._client.write('window_click', resyncPacket(0)) } catch { return false }
  const ok = await got
  await new Promise(r => setTimeout(r, 100))   // mineflayer applies the refresh on the same packet
  return ok
}

export async function vyPlace (ctx, { item, x, y, z }, signal) {
  const { bot } = ctx
  await resyncInventory(bot)
  const t = cell(x, y, z)
  const vy = bot.voyager
  if (nearSpawn(vy?.spawn, t.x, t.z)) return { status: 'failed', failClass: 'spawn_zone', detail: `(${t.x}, ${t.z}) is within ${SPAWN_GUARD} of spawn; build at least ${SPAWN_GUARD + 1} blocks away from spawn (${Math.floor(vy.spawn.x)}, ${Math.floor(vy.spawn.z)})` }
  const held = bot.inventory.items().find(i => i.name === item)
  if (!held) return { status: 'failed', failClass: 'inventory', detail: `no ${item} in inventory; get one first (mine, craft or chest take)` }
  const blockName = itemBlockName(bot, item)
  if (!blockName) return { status: 'failed', failClass: 'not_placeable', detail: `${item} is not a block that can be placed` }
  const tv = new Vec3(t.x, t.y, t.z)
  const eye = bot.entity.position.offset(0, 1.62, 0)
  if (eye.distanceTo(tv.offset(0.5, 0.5, 0.5)) > REACH) return { status: 'failed', failClass: 'reach', detail: `(${t.x}, ${t.y}, ${t.z}) is out of reach; goto within 3 blocks of it first` }
  if (bodyCells(bot).some(c => sameCell(c, t))) return { status: 'failed', failClass: 'body', detail: 'that cell is where the bot stands; step aside (goto a neighbouring cell) first' }
  const here = bot.blockAt(tv)
  if (!here) return { status: 'failed', failClass: 'unloaded', detail: 'that cell is not loaded; goto closer first' }
  if (!REPLACEABLE.has(here.name)) return { status: 'failed', failClass: 'occupied', detail: `(${t.x}, ${t.y}, ${t.z}) holds ${here.name}; digAt it first or pick an empty cell` }
  let ref = null, face = null
  for (const [dx, dy, dz] of FACES) {
    const nb = bot.blockAt(tv.offset(dx, dy, dz))
    if (nb && nb.boundingBox === 'block' && !REPLACEABLE.has(nb.name)) { ref = nb; face = new Vec3(-dx, -dy, -dz); break }
  }
  if (!ref) return { status: 'failed', failClass: 'no_support', detail: 'no solid block touches that cell; place a supporting block next to it first' }
  if (signal?.aborted) return { status: 'aborted', detail: 'interrupted' }
  try {
    await bot.equip(held, 'hand')
    if (signal?.aborted) return { status: 'aborted', detail: 'interrupted' }   // Codex r2 B1: no side effect after an abort
    await bot.placeBlock(ref, face)
  } catch (e) {
    // placeBlock can time out waiting for the update while the block did land: the read-back below decides
    if (signal?.aborted) return { status: 'aborted', detail: 'interrupted' }
  }
  await new Promise(r => setTimeout(r, 150))
  const after = bot.blockAt(tv)
  if (after && after.name === blockName) {
    ctx.runner?.voyagerRecord?.({ kind: 'placed', x: t.x, y: t.y, z: t.z, block: after.name })
    return { status: 'success', placed: 1, detail: `placed ${after.name} at (${t.x}, ${t.y}, ${t.z})`, vy: { ok: true } }
  }
  return { status: 'failed', failClass: 'not_placed', detail: `the server shows ${after?.name ?? 'nothing'} there, not ${blockName}`, vy: { ok: false } }
}

export async function vyDig (ctx, { x, y, z }, signal) {
  const { bot } = ctx
  const t = cell(x, y, z)
  const vy = bot.voyager
  if (nearSpawn(vy?.spawn, t.x, t.z)) return { status: 'failed', failClass: 'spawn_zone', detail: `(${t.x}, ${t.z}) is within ${SPAWN_GUARD} of spawn; dig at least ${SPAWN_GUARD + 1} blocks away from spawn` }
  const tv = new Vec3(t.x, t.y, t.z)
  const eye = bot.entity.position.offset(0, 1.62, 0)
  if (eye.distanceTo(tv.offset(0.5, 0.5, 0.5)) > REACH) return { status: 'failed', failClass: 'reach', detail: `(${t.x}, ${t.y}, ${t.z}) is out of reach; goto within 3 blocks of it first` }
  const f = bodyCells(bot)[0]
  if (sameCell({ ...f, y: f.y - 1 }, t)) return { status: 'failed', failClass: 'underfoot', detail: 'that is the block under the bot; stand beside it (goto a neighbouring cell) and dig it from there' }
  const b = bot.blockAt(tv)
  if (!b) return { status: 'failed', failClass: 'unloaded', detail: 'that cell is not loaded; goto closer first' }
  if (REPLACEABLE.has(b.name) && b.name !== 'short_grass' && b.name !== 'tall_grass') return { status: 'failed', failClass: 'empty', detail: `(${t.x}, ${t.y}, ${t.z}) is ${b.name}: nothing to dig` }
  if (b.diggable === false || b.hardness == null || b.hardness < 0) return { status: 'failed', failClass: 'unbreakable', detail: `${b.name} cannot be dug` }
  for (const [dx, dy, dz] of FACES) {
    const nb = bot.blockAt(tv.offset(dx, dy, dz))
    if (nb && (nb.name === 'lava' || nb.name === 'water')) return { status: 'failed', failClass: 'fluid', detail: `${nb.name} touches that block at (${t.x + dx}, ${t.y + dy}, ${t.z + dz}); placeAt a block over the ${nb.name} first, or dig a different block` }
  }
  const items = bot.inventory.items()
  if (b.harvestTools && !items.some(i => b.harvestTools[i.type])) {
    const need = Object.keys(b.harvestTools).map(id => bot.registry.items[id]?.name).filter(Boolean).sort()[0]
    return { status: 'failed', failClass: 'tool', detail: `${b.name} drops nothing without a ${need ?? 'better tool'}; craft one first` }
  }
  let best = null, bestT = Infinity
  for (const it of [null, ...items]) {
    let tm = Infinity
    try { tm = b.digTime(it ? it.type : null, false, false, false, [], bot.entity.effects ?? {}) } catch { tm = Infinity }
    if (tm < bestT) { bestT = tm; best = it }
  }
  if (signal?.aborted) return { status: 'aborted', detail: 'interrupted' }
  try {
    if (best) await bot.equip(best, 'hand')
    if (signal?.aborted) return { status: 'aborted', detail: 'interrupted' }
    const stop = () => { try { bot.stopDigging() } catch {} }
    signal?.addEventListener?.('abort', stop, { once: true })
    try { await bot.dig(b, true) } finally { signal?.removeEventListener?.('abort', stop) }
  } catch (e) {
    if (signal?.aborted) return { status: 'aborted', detail: 'interrupted' }
  }
  const after = bot.blockAt(tv)
  if (after && after.name !== b.name) {
    ctx.runner?.voyagerRecord?.({ kind: 'dug', x: t.x, y: t.y, z: t.z, block: b.name })
    return { status: 'success', dug: 1, detail: `dug ${b.name} at (${t.x}, ${t.y}, ${t.z})`, vy: { ok: true } }
  }
  return { status: 'failed', failClass: 'not_dug', detail: `${b.name} is still there`, vy: { ok: false } }
}

const CONTAINERS = new Set(['chest', 'trapped_chest', 'barrel'])

export async function vyChest (ctx, { x, y, z, mode, item, count }, signal) {
  const { bot } = ctx
  const tv = new Vec3(Math.floor(x), Math.floor(y), Math.floor(z))
  const b = bot.blockAt(tv)
  if (!b || !CONTAINERS.has(b.name)) return { status: 'failed', failClass: 'no_chest', detail: `no chest or barrel at (${tv.x}, ${tv.y}, ${tv.z}); findBlocks('chest') first` }
  if (bot.entity.position.offset(0, 1.62, 0).distanceTo(tv.offset(0.5, 0.5, 0.5)) > REACH) return { status: 'failed', failClass: 'reach', detail: 'the chest is out of reach; goto within 3 blocks of it first' }
  const it = bot.registry.itemsByName[item]
  if (!it) return { status: 'failed', failClass: 'unknown_item', detail: `unknown item ${item}` }
  if (signal?.aborted) return { status: 'aborted', detail: 'interrupted' }
  const before = inventoryCounts(bot)[item] ?? 0
  let win = null
  try {
    win = await bot.openContainer(b)
    if (signal?.aborted) { try { win.close() } catch {} return { status: 'aborted', detail: 'interrupted' } }
    if (mode === 'put') await win.deposit(it.id, null, count)
    else await win.withdraw(it.id, null, count)
  } catch (e) {
    try { win?.close() } catch {}
    return { status: 'failed', failClass: 'chest', detail: String(e?.message ?? e).slice(0, 120) }
  }
  try { win.close() } catch {}
  const after = inventoryCounts(bot)[item] ?? 0
  const moved = mode === 'put' ? before - after : after - before
  if (moved > 0) {
    ctx.runner?.voyagerRecord?.({ kind: mode === 'put' ? 'chest_put' : 'chest_take', item, count: moved })
    return { status: 'success', detail: `${mode} ${moved} ${item}`, vy: { ok: true, moved } }
  }
  return { status: 'failed', failClass: 'nothing_moved', detail: `no ${item} moved`, vy: { ok: false } }
}

/** Register the vy_ skills and their contracts into the fleet tables (plain objects). Idempotent. */
export function registerVySkills (SKILLS, SKILL_CONTRACTS) {
  SKILLS.vy_place = { run: vyPlace, usage: 'vy_place', args: ['item', 'x', 'y', 'z'], chatOnly: true }
  SKILLS.vy_dig = { run: vyDig, usage: 'vy_dig', args: ['x', 'y', 'z'], chatOnly: true }
  SKILLS.vy_chest = { run: vyChest, usage: 'vy_chest', args: ['x', 'y', 'z', 'mode', 'item', 'count'], chatOnly: true }
  SKILL_CONTRACTS.vy_place = { expects: ['world_change'], maxMs: 30_000 }
  SKILL_CONTRACTS.vy_dig = { expects: ['world_change', 'inventory_gain'], maxMs: 30_000 }
  SKILL_CONTRACTS.vy_chest = { expects: ['inventory_gain', 'inventory_loss'], maxMs: 30_000 }
}

// ---------------------------------------------------------------------------------------------------------------
// The handlers the sandbox calls.

/**
 * @param {object} o
 * @param {()=>object} o.getBot      the current bot (it changes on reconnect)
 * @param {()=>object} o.getRunner   the current runner
 * @param {{revoked:boolean}} o.token  this execution's capability token; revoked on a budget kill
 * @param {(e:object)=>void} o.record  facade telemetry (placements, chest takes, drops, chat drops)
 */
export function makeHandlers ({ getBot, getRunner, token, record, now = () => Date.now() }) {
  const bot = () => getBot()
  let lastSay = 0

  const viaRunner = async (skill, args) => {
    if (token.revoked) return { ok: false, reason: 'stopped' }
    const runner = getRunner()
    if (!runner) return { ok: false, reason: 'the bot is not connected yet; wait and try again' }
    const t0 = now()
    while (runner.current && now() - t0 < 20_000) {
      if (token.revoked) return { ok: false, reason: 'stopped' }
      await new Promise(r => setTimeout(r, 250))
    }
    if (token.revoked) return { ok: false, reason: 'stopped' }
    const r = await runner.run(skill, args, { trigger: 'voyager' })
    const interrupted = runner.interruptedReason && r.status === 'aborted' ? String(runner.interruptedReason) : null
    const ok = r.vy ? r.vy.ok === true : r.status === 'success'
    const out = { ok, status: r.status, detail: String(r.detail ?? '').slice(0, 240) }
    if (!ok) out.reason = interrupted ? `interrupted by reflex: ${interrupted}` : (r.failClass ?? r.status)
    return out
  }

  const known = (kind, name) => {
    const reg = bot()?.registry
    return kind === 'item' ? !!reg?.itemsByName?.[name] : !!reg?.blocksByName?.[name]
  }
  const bad = (msg) => ({ ok: false, reason: 'bad_arguments', remedy: msg })

  const H = {
    observe: async () => ({ ok: true, ...observeState(bot(), bot()?.voyager?.spawn ?? null) }),
    findBlocks: async (a) => {
      const c = checkArgs([['name'], ['int', { min: 1, max: 32, default: 16 }], ['int', { min: 1, max: 32, default: 8 }]], a)
      if (c.error) return bad(c.error)
      const [name, radius, max] = c.args
      const b = bot()
      const def = b.registry.blocksByName[name]
      if (!def) return { ok: false, reason: `unknown block "${name}"`, remedy: 'use a block id such as oak_log, stone, iron_ore' }
      const found = b.findBlocks({ matching: def.id, maxDistance: radius, count: max })
      return { ok: true, blocks: found.map(p => ({ x: p.x, y: p.y, z: p.z })) }
    },
    mine: async (a) => {
      const c = checkArgs([['name'], ['int', { min: 1, max: 64, default: 1 }]], a)
      if (c.error) return bad(c.error)
      if (!known('block', c.args[0])) return { ok: false, reason: `unknown block "${c.args[0]}"`, remedy: 'use a block id such as oak_log or stone' }
      return viaRunner('gather', { count: c.args[1], block: c.args[0] })
    },
    goto: async (a) => {
      const c = checkArgs([['coord'], ['coord', { y: true }], ['coord']], a)
      if (c.error) return bad(c.error)
      return viaRunner('goto', { x: Math.floor(c.args[0]), y: Math.floor(c.args[1]), z: Math.floor(c.args[2]) })
    },
    explore: async (a) => {
      const c = checkArgs([['int', { min: 8, max: 200, default: 64 }]], a)
      if (c.error) return bad(c.error)
      return viaRunner('explore', { blocks: c.args[0] })
    },
    craft: async (a) => {
      const c = checkArgs([['name'], ['int', { min: 1, max: 64, default: 1 }]], a)
      if (c.error) return bad(c.error)
      if (!known('item', c.args[0])) return { ok: false, reason: `unknown item "${c.args[0]}"`, remedy: 'use an item id such as wooden_pickaxe' }
      const r = await viaRunner('craft', { item: c.args[0], count: c.args[1] })
      if (r.ok) record({ kind: 'crafted', item: c.args[0], count: c.args[1] })
      return r
    },
    smelt: async (a) => {
      const c = checkArgs([['name'], ['int', { min: 1, max: 64, default: 1 }]], a)
      if (c.error) return bad(c.error)
      if (!known('item', c.args[0])) return { ok: false, reason: `unknown item "${c.args[0]}"`, remedy: 'name the item to smelt, e.g. raw_iron' }
      return viaRunner('smelt', { item: c.args[0], count: c.args[1] })
    },
    placeAt: async (a) => {
      const c = checkArgs([['name'], ['coord'], ['coord', { y: true }], ['coord']], a)
      if (c.error) return bad(c.error)
      const [item, x, y, z] = c.args
      return viaRunner('vy_place', { item, x, y, z })
    },
    digAt: async (a) => {
      const c = checkArgs([['coord'], ['coord', { y: true }], ['coord']], a)
      if (c.error) return bad(c.error)
      const [x, y, z] = c.args
      return viaRunner('vy_dig', { x, y, z })
    },
    chest: async (a) => {
      const c = checkArgs([['coord'], ['coord', { y: true }], ['coord'], ['enum', { values: ['put', 'take'] }], ['name'], ['int', { min: 1, max: 64, default: 1 }]], a)
      if (c.error) return bad(c.error)
      const [x, y, z, mode, item, count] = c.args
      return viaRunner('vy_chest', { x, y, z, mode, item, count })
    },
    equip: async (a) => {
      const c = checkArgs([['name']], a)
      if (c.error) return bad(c.error)
      if (token.revoked) return { ok: false, reason: 'stopped' }
      const rn = getRunner()
      if (rn?.current || rn?.arb?.holder) return { ok: false, reason: 'busy: a reflex or another action holds the body', remedy: 'wait a moment and try again' }
      const it = bot().inventory.items().find(i => i.name === c.args[0])
      if (!it) return { ok: false, reason: `no ${c.args[0]} in inventory`, remedy: 'get it first' }
      try { await bot().equip(it, 'hand'); return { ok: true, holding: it.name } } catch (e) { return { ok: false, reason: String(e?.message ?? e).slice(0, 120) } }
    },
    eat: async () => viaRunner('eat', {}),
    say: async (a) => {
      const f = filterSay(a[0])
      if (!f.line) {
        record({ kind: f.why === 'command' ? 'say_command_dropped' : 'say_dropped', text: String(a[0] ?? '').slice(0, 80) })
        return { ok: false, reason: f.why === 'command' ? 'chat commands are not allowed; say plain text' : 'nothing to say' }
      }
      if (now() - lastSay < 10_000) return { ok: false, reason: 'one chat line per 10 s' }
      lastSay = now()
      try { bot().chat(f.line) } catch { /* the wrapper may drop it */ }
      return { ok: true }
    },
    wait: async (a) => {
      const ms = Math.max(0, Math.min(WAIT_MAX_MS, Number(a[0]) || 0))
      const t0 = now()
      while (now() - t0 < ms && !token.revoked) await new Promise(r => setTimeout(r, Math.min(250, ms)))
      return { ok: !token.revoked }
    },
    // handled inside the sandbox's dispatcher (it never reaches here); listed so `bot.log` exists (review finding 4)
    log: async () => ({ ok: true }),
  }
  return H
}

/** The API text the coder sees (kept next to the handlers so the two cannot drift). */
export const FACADE_DOC = `Every call is async: always \`await\` it, one at a time (no Promise.all). Each returns an object with \`ok\`
(true/false); on false it has \`reason\` and often \`remedy\`. Item and block names are Minecraft ids (oak_log, cobblestone).
- bot.observe() -> {pos:{x,y,z}, health, food, inventory:{name:count}, holding, biome, time, day, spawn, blocks:{name:count within 8}, nearby:{entity:count}}
- bot.findBlocks(name, radius=16 (<=32), max=8 (<=32)) -> {blocks:[{x,y,z}]}  (loaded blocks only)
- bot.mine(blockName, count=1)          walks to, digs and collects that many of the block (uses the right tool if held)
- bot.goto(x, y, z)                     walks there (pathfinding, swimming, our safety reflexes underneath)
- bot.explore(blocks=64)                walks off in a new direction to discover terrain
- bot.craft(itemName, count=1)          crafts (places a crafting table from the inventory if the recipe needs one)
- bot.smelt(itemName, count=1)          smelts in a furnace (places one from the inventory if needed; needs fuel)
- bot.placeAt(itemName, x, y, z)        places ONE block in that empty cell; must be within 4 blocks and touch a solid block
- bot.digAt(x, y, z)                    digs ONE block within 4 blocks (not the one under the bot's feet)
- bot.chest(x, y, z, 'put'|'take', itemName, count=1)  moves items with a chest/barrel within 4 blocks
- bot.equip(itemName)                   holds an item
- bot.eat()                             eats something from the inventory
- bot.say(text)                         one short chat line (no commands; at most one per 10 s)
- bot.wait(ms)                          pauses up to 10000 ms
- bot.log(text)                         a note you will see in the execution log next round
There is nothing else: no require, no import, no timers, no network, no files, no process, no chat commands.
Limits per run: 80 bot calls, 240 s, a little CPU. Do the work in small steps and check \`ok\` after each call.
Within 8 blocks of the world spawn nothing can be placed or dug.`
