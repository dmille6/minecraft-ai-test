// WHAT IS ACTUALLY WORTH BANKING.
//
// "deposited items per bot-hour" is a CO-PRIMARY endpoint of this experiment and
// NO milestone has ever asked a bot to deposit. The closest, `return`, is scored
// on POSITION: a bot satisfies it by standing within 15 blocks of home with a
// full inventory and walking away again. 647 deposit calls across 1.18M events is
// the model occasionally choosing it unprompted.
//
// The obvious fix -- "deposit when your inventory is full" -- fails twice on this
// fleet's measured state:
//
//   inventories sit at a MEDIAN OF 16 of 36 stacks, so a fullness trigger would
//   almost never fire; and the median distance from town is 804 BLOCKS, with only
//   9% of samples within 100, so "walk home and bank" is a six-minute round trip
//   through the exact travel failures that already kill deposits (156 stuck, 107
//   drowning, 53 stagnation).
//
// WHY VALUE IS DERIVED AND NOT LISTED. Hand-maintaining a Minecraft economy is
// both endless and wrong: what is worth carrying depends on what the bot is
// trying to do. So bankable means "part of declared work" -- the milestone's
// wants, the ingredients of those wants, and the standing stockpile targets.
// Everything else is ballast. A bot carrying 99 crafting tables, leaf_litter and
// brown_egg is carrying 13% junk at the median and 42% at p90, and depositing
// that would inflate a co-primary endpoint without meaning anything.

/** Ballast: things a bot accumulates that no goal ever asked for. */
const NEVER_BANKABLE = new Set([
  'leaf_litter', 'brown_egg', 'egg', 'oak_sapling', 'short_grass', 'dead_bush',
  'seagrass', 'vine', 'poppy', 'dandelion', 'pointed_dripstone', 'rail', 'bamboo',
])

/** Always worth keeping in the town chest, whatever the current rung asks for. */
const STANDING_TARGETS = new Set([
  'oak_log', 'birch_log', 'jungle_log', 'oak_planks', 'stick', 'cobblestone',
  'cobbled_deepslate', 'stone', 'coal', 'raw_iron', 'iron_ingot', 'diamond',
])

const TOOL_RE = /_(pickaxe|axe|shovel|sword|hoe)$/

/**
 * What could this bot bank right now, and how much of it is real?
 *
 * Reserves are subtracted BEFORE counting, because a bot that banks the pickaxe
 * it is mining with, or the blocks it needs to pillar out, has not made a
 * deposit -- it has disarmed itself. That is the same class of mistake as the
 * descent contract spending its own exit.
 *
 * `creditCap` stops one absurd stack from dominating the endpoint: 99 crafting
 * tables is worth at most what the goals actually want, not 99.
 */
export function bankableInventory (items = [], { wants = [], creditCap = 64,
                                                 reserveScaffold = 8 } = {}) {
  const want = new Set([...wants, ...STANDING_TARGETS].filter(Boolean))
  const counts = {}
  for (const it of items) {
    if (!it?.name) continue
    counts[it.name] = (counts[it.name] ?? 0) + (it.count ?? 0)
  }

  // Reserve the single best tool of each family. Banking your only pickaxe
  // underground is how a bot spends ten hours entombed with the answer in its
  // pockets.
  const keptTool = new Set()
  for (const name of Object.keys(counts)) {
    const m = TOOL_RE.exec(name)
    if (m && !keptTool.has(m[1])) keptTool.add(m[1])
  }

  const detail = {}
  let bankable = 0, junk = 0
  for (const [name, n] of Object.entries(counts)) {
    if (NEVER_BANKABLE.has(name)) { junk += n; continue }
    let avail = n
    const m = TOOL_RE.exec(name)
    if (m) avail -= 1                       // keep one of each tool family
    if (STANDING_TARGETS.has(name) && reserveScaffold > 0 &&
        /cobblestone|cobbled_deepslate|stone|dirt/.test(name)) {
      avail -= reserveScaffold              // keep enough to pillar out
    }
    if (avail <= 0) continue
    // A SPARE TOOL IS REAL OUTPUT. Tools are never in the standing-target list
    // (that list is materials), and without this a second pickaxe -- which costs
    // wood, sticks and a crafting table to make -- was scored as ballast.
    const isTool = !!m
    if (!isTool && !want.has(name)) { junk += avail; continue }
    const credited = Math.min(avail, creditCap)
    detail[name] = credited
    bankable += credited
  }
  return { count: bankable, junk, detail }
}

/**
 * Should this bot deposit NOW?
 *
 * The load-bearing clause is the second one. "Carrying a lot" alone would walk a
 * bot home from 1,000 blocks out to bank three cobblestone, and travel is where
 * deposits already die. So a deposit is due only when the bot has real surplus
 * AND banking is cheap -- storage in sight, already near town, or under a
 * deposit goal it accepted.
 */
export function depositDue ({ bankable, distHome, storageWithin48 = false,
                              onDepositMilestone = false, occupiedSlots = 0,
                              minBankable = 12, nearHome = 96 }) {
  if (bankable < minBankable && occupiedSlots < 30) return false
  return !!storageWithin48 || distHome <= nearHome || !!onDepositMilestone
}
