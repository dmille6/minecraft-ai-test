/**
 * WHAT A BLOCK ACTUALLY GIVES YOU.
 *
 * `gather` graded itself with `countItem(bot, blockName) - startHeld`. Stone
 * does not drop stone; it drops cobblestone. Iron ore drops raw_iron. So for
 * every block whose drop is named differently the counter could never rise, and
 * the skill reported failure every single time it worked. Lifetime, full walk:
 *
 *     gather stone      13,550 attempts /  0 successes EVER
 *     gather coal_ore        266 /  0
 *     gather iron_ore        106 /  0
 *     gather oak_sapling     169 /  0
 *
 * 707 records show `gather stone` returning `failed` while the bot's inventory
 * gained cobblestone in the very next record.
 *
 * The cost of that was not only a wrong success rate. It produced a FALSE
 * FINDING -- "zero iron ore in 23 days" -- which was quoted for days and drove
 * two separate pieces of work, while 33 bots across all four arms had in fact
 * been carrying raw_iron since 2026-08-26 and one had smelted an iron pickaxe.
 * A counter that can only ever return zero carries no information, and its zero
 * must never be read as evidence.
 *
 * There is no hand-maintained table here on purpose. minecraft-data already
 * ships the mapping for the exact protocol version the bot is connected to, so
 * it cannot rot against a server upgrade the way a literal list would.
 */

const dropCache = new WeakMap()
const sourceCache = new WeakMap()

function itemNames (registry, block) {
  const out = []
  for (const d of block?.drops ?? []) {
    // minecraft-data gives either a bare item id or {drop: id|{id}, ...}.
    const id = (d && typeof d === 'object') ? (d.drop?.id ?? d.drop ?? d.id) : d
    const name = registry?.items?.[id]?.name
    if (name) out.push(name)
  }
  return out
}

/** Item names a block yields when mined. Falls back to the block's own name. */
export function dropsOf (registry, blockName) {
  if (!registry?.blocksByName) return [blockName]
  let per = dropCache.get(registry)
  if (!per) { per = new Map(); dropCache.set(registry, per) }
  if (per.has(blockName)) return per.get(blockName)
  const block = registry.blocksByName[blockName]
  const names = block ? itemNames(registry, block) : []
  // A block with no drop entry (leaves, and anything minecraft-data does not
  // model) falls back to its own name rather than to nothing: an empty list
  // would make every gather of it unscoreable, which is the bug again.
  const result = names.length ? names : [blockName]
  per.set(blockName, result)
  return result
}

/**
 * Blocks that yield a wanted item. The reverse direction, and the one that
 * un-traps `gather dirt`.
 *
 * Natural dirt on a plain is capped by grass_block, so every dirt candidate
 * reads as "buried" and the skill refuses -- 66,170 lifetime calls at 10.5%
 * success, for the single item the exit contract, climbAdvice and
 * climbPrerequisite all demand. grass_block drops dirt. So does podzol,
 * farmland, mycelium and dirt_path. The bot was standing on its answer.
 */
export function sourcesOf (registry, itemName) {
  if (!registry?.blocksByName) return [itemName]
  let per = sourceCache.get(registry)
  if (!per) { per = new Map(); sourceCache.set(registry, per) }
  if (per.has(itemName)) return per.get(itemName)
  const out = []
  for (const block of Object.values(registry.blocksByName)) {
    if (itemNames(registry, block).includes(itemName)) out.push(block.name)
  }
  // Put an exact name-match first: asking for cobblestone should still prefer
  // picking up actual cobblestone over mining stone for it.
  out.sort((a, b) => (a === itemName ? -1 : b === itemName ? 1 : 0))
  const result = out.length ? out : [itemName]
  per.set(itemName, result)
  return result
}

// A NAME THE MODEL MEANT, NOT A NAME IT INVENTED.
//
// Over 1,813,691 logged decisions, 741 carried a block/item name absent from the
// registry. That is 0.041% of decisions and only 0.68% of `bad_args` -- but of
// those 741, the overwhelming majority are not hallucinations:
//
//   44.5% (329)  a real ITEM handed to `gather`, which takes a BLOCK.
//                coal, flint, stick, raw_copper, raw_iron, tropical_fish.
//   35.8% (265)  a missing trailing "s". bamboo_plank -> bamboo_planks,
//                oak_plank -> oak_planks. Edit distance 1.
//   19.7% (147)  everything else: bamboo_log, wood, oak_木.
//
// The first two are resolvable without guessing. Asking to gather `coal` is not
// ambiguous -- coal_ore is the block that drops it, and `sourcesOf` already knows
// the mapping. Asking for `oak_plank` when only `oak_planks` exists is a typo with
// exactly one candidate.
//
// This resolves ONLY those two shapes and refuses everything else, so a genuinely
// invented name still fails. It never picks between candidates by preference: a
// plural must be a real block, and a drop-source must be a real block, or the
// resolution does not happen. Intent is read, never invented.

/**
 * Resolve a proposed block name to a real one, or null if it cannot be.
 * @returns {{block: string, via: 'exact'|'plural'|'drop_source'} | null}
 */
export function resolveBlockName (registry, name) {
  if (!registry?.blocksByName) return null
  if (typeof name !== 'string' || !name) return null
  if (registry.blocksByName[name]) return { block: name, via: 'exact' }

  // Missing plural. One candidate or none -- there is nothing to choose between.
  if (registry.blocksByName[name + 's']) return { block: name + 's', via: 'plural' }

  // A real item, handed to a verb that takes a block. `sourcesOf` returns
  // [itemName] as its own fallback, so every candidate is re-checked against
  // blocksByName rather than trusted.
  if (registry.itemsByName?.[name]) {
    // The names must be evidently RELATED, or this is guessing at intent rather
    // than reading it. `stick` is dropped by `dead_bush`, and resolving it would
    // send a bot hunting dead bushes when sticks come from crafting; `string`
    // resolves to `cobweb` the same way. Both share no token with their source.
    // The cases worth recovering all do: coal->coal_ore, raw_iron->iron_ore,
    // raw_copper->copper_ore.
    //
    // Craftability is NOT the discriminator -- coal and raw_iron are craftable
    // too, from their block forms, so that rule would reject the good cases.
    const parts = new Set(name.split('_').filter(w => w.length > 2))
    for (const cand of sourcesOf(registry, name)) {
      if (!registry.blocksByName[cand]) continue
      const shares = cand.split('_').some(w => parts.has(w))
      if (shares) return { block: cand, via: 'drop_source' }
    }
  }
  return null
}

/** How much of what `blockName` yields does this bot hold right now? */
export function heldFromBlock (bot, blockName) {
  const names = new Set(dropsOf(bot?.registry, blockName))
  let n = 0
  for (const it of (bot?.inventory?.items?.() ?? [])) {
    if (names.has(it.name)) n += it.count
  }
  return n
}
