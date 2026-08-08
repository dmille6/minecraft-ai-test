/**
 * Micro-worlds: a bot, a handful of blocks, no server.
 *
 * THE ARGUMENT FOR THIS FILE
 *
 * On 2026-08-07 six real defects were found by deploying to a live fleet and
 * reading logs for hours. Five of them were pure properties of the code:
 *
 *   isEntombed() counted water as a wall            -> one assertion
 *   the drowning rescue sat behind a log throttle   -> one assertion
 *   unstick graded itself on "am I on a new block"  -> one assertion
 *   pillarOut stopped when the head cleared         -> one assertion
 *   sightings rendered two numbers for a 3-slot arg -> one assertion
 *
 * Each cost a deploy, a fleet restart, and a measurement window -- and the
 * restarts perturbed the trial they were meant to measure. None of them needed
 * a Minecraft server to detect.
 *
 * So: build the smallest world that exhibits the condition, and assert on it.
 * A test here runs in under a millisecond and can be written from a log line.
 *
 * Deliberately NOT a simulator. It answers "given these blocks and this state,
 * what does the code decide" -- nothing about physics, mobs or time. Emergent
 * behaviour still needs the fleet; this covers everything that is a function of
 * the code, which is where the expensive bugs have actually been.
 */

/** Minimal Vec3 -- only the operations reflex/skills actually call. */
export class V {
  constructor(x, y, z) { this.x = x; this.y = y; this.z = z }
  offset(dx, dy, dz) { return new V(this.x + dx, this.y + dy, this.z + dz) }
  floored() { return new V(Math.floor(this.x), Math.floor(this.y), Math.floor(this.z)) }
  equals(o) { return this.x === o.x && this.y === o.y && this.z === o.z }
  clone() { return new V(this.x, this.y, this.z) }
  distanceTo(o) { return Math.hypot(this.x - o.x, this.y - o.y, this.z - o.z) }
}

export const AIR   = { name: 'air', boundingBox: 'empty' }
export const WATER = { name: 'water', boundingBox: 'empty' }
export const LAVA  = { name: 'lava', boundingBox: 'empty' }
export const STONE = { name: 'stone', boundingBox: 'block' }
export const DIRT  = { name: 'dirt', boundingBox: 'block' }
export const LEAVES = { name: 'oak_leaves', boundingBox: 'block' }

/**
 * Build a bot.
 *
 * `blocks` is a function (x,y,z) -> block, so a world is one arrow function.
 * Everything else defaults to a healthy bot standing in open air.
 */
export function makeBot({
  pos = new V(0, 64, 0),
  blocks = () => AIR,
  health = 20,
  food = 20,
  oxygen = 300,
  inventory = {},
  isInWater = undefined,
} = {}) {
  const items = Object.entries(inventory).map(([name, count], i) => ({ name, count, slot: i }))
  const controls = {}
  const bot = {
    entity: { position: pos, isInWater },
    health, food, oxygenLevel: oxygen,
    blockAt: p => blocks(p.x, p.y, p.z),
    inventory: { items: () => items },
    setControlState: (k, v) => { controls[k] = v },
    clearControlStates: () => { for (const k of Object.keys(controls)) controls[k] = false },
    controls,                                  // tests assert on this
    registry: { blocksByName: {}, itemsByName: {} },
    players: {},
  }
  return bot
}

/** A runner that records what was interrupted instead of doing anything. */
export function makeRunner() {
  const interrupts = []
  return {
    interrupts,
    isBusy: () => false,
    interrupt: reason => interrupts.push(reason),
    run: async () => ({ status: 'success' }),
  }
}

// --- world builders, one per real incident -------------------------------

/**
 * Ocean floor. Solid below `floor`, water up to `surface`, air above.
 * This is where Scout01 drowned 13 times in two hours.
 */
export const ocean = ({ floor = 48, surface = 62 } = {}) =>
  (x, y, z) => (y <= floor ? STONE : y <= surface ? WATER : AIR)

/**
 * Ocean floor as MINEFLAYER SAW IT during the real incident: the client
 * reported air at head height while the server was drowning the bot. The whole
 * point of the health-based trigger is that this case must still be caught.
 */
export const oceanWithStaleChunks = ({ floor = 48 } = {}) =>
  (x, y, z) => (y <= floor ? STONE : AIR)

/**
 * A 1-wide vertical shaft: solid everywhere except one column, open from
 * `bottom` to the sky. Miner01 sat at the bottom of one of these for 90 minutes
 * with 70 cobblestone in its pockets.
 */
export const shaft = ({ sx = 0, sz = 0, bottom = 24, top = 64 } = {}) =>
  (x, y, z) => {
    if (x === sx && z === sz && y >= bottom && y <= top) return AIR
    return y > top ? AIR : STONE
  }

/**
 * A pit with a floor: walkable inside, walls too high to climb, open sky.
 * unstick reported success 74/74 shuffling between corners of one of these.
 */
export const pit = ({ x0 = 0, z0 = 0, w = 2, floor = 70, rim = 73 } = {}) =>
  (x, y, z) => {
    const inside = x >= x0 && x < x0 + w && z >= z0 && z < z0 + w
    if (y <= floor) return STONE
    if (inside) return AIR
    return y <= rim ? STONE : AIR
  }

/** Fully sealed pocket -- genuine entombment, the case that SHOULD pillar. */
export const entombed = ({ at = new V(0, 40, 0) } = {}) =>
  (x, y, z) => (x === at.x && y === at.y && z === at.z ? AIR : STONE)

/** Flat open ground at `ground`; nothing above. The healthy baseline. */
export const plain = ({ ground = 63 } = {}) =>
  (x, y, z) => (y <= ground ? DIRT : AIR)
