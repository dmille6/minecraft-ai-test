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
