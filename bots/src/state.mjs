// Snapshot of what the bot can perceive, captured at decision time.
//
// This exists so a log record answers "what did it know when it chose that?"
// Without it you have the decision but not the context, and the corpus becomes
// unanalysable -- see handoff doc S13 (working memory).

/** Compact inventory: { oak_log: 34, cobblestone: 12 } */
export function inventorySummary(bot) {
  const out = {}
  for (const item of bot.inventory?.items() ?? []) {
    out[item.name] = (out[item.name] ?? 0) + item.count
  }
  return out
}

export function countItem(bot, name) {
  return (bot.inventory?.items() ?? [])
    .filter(i => i.name === name)
    .reduce((n, i) => n + i.count, 0)
}

export function snapshot(bot) {
  const p = bot.entity?.position
  return {
    bot: {
      health: bot.health ?? null,
      hunger: bot.food ?? null,
      pos: p ? { x: round(p.x), y: round(p.y), z: round(p.z) } : undefined,
    },
    game: {
      tick: bot.time?.age ?? null,
      // bot.game.dimension arrives as "minecraft:overworld" on some versions
      dimension: (bot.game?.dimension ?? 'overworld').replace('minecraft:', ''),
      day: bot.time?.day != null ? Math.floor(bot.time.day) : null,
    },
  }
}

const round = n => Math.round(n * 10) / 10

/** Distance from origin on the XZ plane -- used for world-border checks. */
export function horizontalDistanceFromSpawn(pos) {
  return Math.sqrt(pos.x * pos.x + pos.z * pos.z)
}

export function isNight(bot) {
  const t = bot.time?.timeOfDay ?? 0
  return t >= 13000 && t <= 23000
}

/**
 * What the bot could actually SEE when it decided. Without this you cannot
 * distinguish "the model chose badly" from "the model chose the only sane
 * option given what was in front of it" -- which is the single most common
 * ambiguity when reading agent telemetry.
 */
export function perception(bot, radius = 40) {
  const want = ['oak_log', 'birch_log', 'spruce_log', 'dirt', 'grass_block', 'stone',
    'coal_ore', 'iron_ore', 'water', 'lava', 'sand', 'crafting_table', 'chest', 'bed']
  const seen = {}
  for (const name of want) {
    const t = bot.registry.blocksByName[name]
    if (!t) continue
    const b = bot.findBlock({ matching: t.id, maxDistance: radius })
    if (b) seen[name] = Math.round(bot.entity.position.distanceTo(b.position))
  }
  const mobs = {}
  for (const e of Object.values(bot.entities ?? {})) {
    if (e === bot.entity || !e.position) continue
    if (bot.entity.position.distanceTo(e.position) > 24) continue
    const n = e.name ?? e.displayName ?? e.type
    if (n) mobs[n] = (mobs[n] ?? 0) + 1
  }
  return { blocks: seen, entities: mobs, block_kinds: Object.keys(seen).length }
}

export function biomeAt(bot) {
  try {
    const b = bot.blockAt(bot.entity.position)
    const id = b?.biome?.name ?? b?.biome?.id
    return id != null ? String(id).replace('minecraft:', '') : null
  } catch { return null }
}

/** Classify a failure string into a small, aggregatable set. */
export function classifyFailure(detail = '') {
  const d = String(detail).toLowerCase()
  if (d.includes('exceeded') && d.includes('ms')) return 'path_timeout'
  if (d.includes('no path') || d.includes('unreachable')) return 'no_path'
  if (d.includes('stopped before')) return 'path_interrupted'
  if (d.includes('stuck')) return 'stuck'
  if (d.includes('tool')) return 'missing_tool'
  if (d.includes('missing ingredients') || d.includes('cannot craft')) return 'missing_ingredients'
  if (d.includes('no ') && d.includes('within')) return 'nothing_found'
  if (d.includes('inventory')) return 'inventory'
  if (d.includes('timeout')) return 'timeout'
  return 'other'
}
