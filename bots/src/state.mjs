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
      // ABSOLUTE inventory, on every document that carries a snapshot.
      //
      // Until now the only inventory telemetry was the per-skill DELTA, so
      // there was no ground truth anywhere in the index -- only differences.
      // That is why the fleet's first stone_pickaxe could be crafted at
      // 17:53:39 and be gone twenty minutes later with no death recorded by
      // either the bot or the server, and nothing able to say when it left.
      // Deltas cannot be reconciled without periodic absolute state; two
      // consecutive snapshots now bound any disappearance to a known window.
      //
      // `flattened` in the mapping, so item names never inflate the field count.
      inventory: inventorySummary(bot),
      // What is actually in hand. A tool that broke and a tool that vanished
      // look identical without this.
      held: bot.heldItem?.name ?? null,
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

  // Ordered most-specific first. Every branch below was derived from the actual
  // unclassified strings in Elasticsearch, not guessed: `other` was the LARGEST
  // class at 36% of all failures, which makes a failure taxonomy decorative --
  // you cannot act on "something went wrong, 1076 times".

  // Reflex interruptions. The skill did not fail; it was preempted to stop the
  // bot dying, and counting that as a skill failure blames the skill for being
  // rescued.
  if (d.includes('entombed') || d.includes('drowning') || d.includes('suffocat')
      || d.includes('lava') || d.includes('low health')) return 'hazard_interrupt'

  // The stagnation watchdog aborting a skill that stopped making progress. Was
  // 62 records of 'other'; it is its own thing and the distinction matters --
  // this is the bot not moving, not the world refusing.
  if (d.includes('stagnation')) return 'stagnation'

  if (d.includes('exceeded') && d.includes('ms')) return 'path_timeout'
  // "no route" is what goto actually says. The classifier matched only "no path"
  // and "unreachable", so 189 genuine routing failures -- the second largest
  // group in `other` -- were invisible. The skill's wording and the classifier
  // are two encodings of one concept, and they drifted the moment one changed.
  if (d.includes('no path') || d.includes('no route') || d.includes('unreachable')) return 'no_path'
  if (d.includes('goal was changed')) return 'preempted'
  if (d.includes('stopped before') || d.includes('stalled')) return 'path_interrupted'
  if (d.includes('stuck') || d.includes('wedged')) return 'stuck'

  // A precondition refusal, not a failure to execute. `mine` declining to
  // descend without a pickaxe is the guard working.
  if (d.includes('no pickaxe') || d.includes('no axe') || d.includes('no shovel')
      || d.includes('tool')) return 'missing_tool'

  // The material is there but under solid ground -- a genuinely different
  // problem from "there is none nearby", and the fix is different too.
  if (d.includes('buried')) return 'buried'

  // Has the ingredients, lacks the station.
  if (d.includes('place the crafting_table') || d.includes('crafting table')) return 'needs_station'
  if (d.includes('missing ingredients') || d.includes('cannot craft')
      || d.includes('no recipe')) return 'missing_ingredients'

  // follow/come pointed at a player that is not there. "cannot see undefined"
  // is also a bug worth seeing in its own bucket rather than buried in `other`.
  if (d.includes('cannot see')) return 'bad_target'

  if (d.includes('no ') && d.includes('within')) return 'nothing_found'
  if (d.includes('could not explore')) return 'nothing_found'
  if (d.includes('inventory')) return 'inventory'
  if (d.includes('timeout')) return 'timeout'
  return 'other'
}

