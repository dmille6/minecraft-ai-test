// voyager-01: THE VERIFIER AND THE FEASIBILITY FILTER (design §2.1, §12 B4). Pure functions: state in, verdict out.
// Success comes only from what the harness measured (inventory snapshots, its own read-back of placed cells, chest
// takes) -- never from the skill's return value or the model's claim.

export const KINDS = Object.freeze(['have', 'placed', 'structure', 'reach', 'craft'])

// Peaceful, no Nether, no End (11-06 internal research §1). Prefix or exact matches.
const INFEASIBLE_PREFIX = ['nether', 'crimson_', 'warped_', 'soul_', 'blaze_', 'ghast_', 'magma_cream', 'ender_pearl', 'ender_eye',
  'end_', 'purpur_', 'chorus_', 'shulker_', 'elytra', 'dragon_', 'wither_', 'quartz', 'glowstone', 'respawn_anchor', 'lodestone',
  'ancient_debris', 'piglin_', 'strider_', 'basalt', 'polished_basalt', 'blackstone', 'gilded_blackstone', 'crying_obsidian',
  'shroomlight', 'twisting_vines', 'weeping_vines', 'command_block', 'chain_command_block', 'repeating_command_block',
  'structure_block', 'structure_void', 'jigsaw', 'barrier', 'light', 'debug_stick', 'knowledge_book', 'bedrock', 'spawner',
  'trial_spawner', 'vault', 'reinforced_deepslate', 'budding_amethyst', 'petrified_oak_slab', 'player_head', 'dragon_head',
  'comparator', 'observer', 'daylight_detector', 'brewing_stand', 'beacon', 'conduit', 'nether_star', 'totem_of_undying',
  'phantom_membrane', 'gunpowder', 'slime_ball', 'spider_eye', 'rotten_flesh', 'bone', 'arrow', 'trident', 'heart_of_the_sea',
  'breeze_rod', 'wind_charge', 'heavy_core', 'mace', 'trial_key', 'ominous_']
const INFEASIBLE_SUFFIX = ['_spawn_egg']

/** Is this id impossible to get in a peaceful, no-Nether survival world? Pure. */
export function infeasibleName (name) {
  const n = String(name ?? '')
  return INFEASIBLE_PREFIX.some(p => n === p || n.startsWith(p)) || INFEASIBLE_SUFFIX.some(s => n.endsWith(s))
}

const int = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi

// ---------------------------------------------------------------------------------------------------------------------
// HARNESS 2 REFUSALS (11-12). Each names something the proposer can do next, from where it is.

/**
 * A sword cannot be made here: the fleet's craft skill refuses every sword in a peaceful world (owner 10-07,
 * bots/src/peacefulkit.mjs), and every voyager world is peaceful. Harness 1's filter did not know, so the task went to
 * four rounds of code that could not work: on the 3b arms 1,066 of 3,321 qwen proposals (32 %) and 264 of 4,664 of
 * Haiku's were sword tasks, and not one of the 1,330 was ever verified. Pure.
 * @returns {{ok:boolean, reason?:string}}
 */
export function swordRefusal (success) {
  const item = success?.kind === 'craft' || success?.kind === 'have' ? String(success.item ?? '') : ''
  if (!/_sword$/.test(item)) return { ok: true }
  return { ok: false, reason: `${item} cannot be made in this peaceful world (no sword can); propose a pickaxe, axe, shovel or hoe, or something to build or gather` }
}

export const REPEAT_FAILS = 3          // this many failures in a row of one outcome ...
export const REPEAT_REST = 12          // ... set it aside for this many of the bot's next tasks
/** Outcomes the repeat rule never sets aside: every structure of a size class shares one signature. Pure. */
export const repeatExempt = sig => String(sig).startsWith('structure:')

/**
 * Note a task's end in the repeat record `rep` = {streak:{sig:n}, rest:{sig:untilIteration}, why:{sig:text}} (mutated and
 * returned). A success clears the outcome; the REPEAT_FAILS-th failure in a row sets it aside until `it + REPEAT_REST`.
 * On the 3b arms 1,273 of 3,322 qwen proposals (38 %) and 215 of 2,443 of h1's asked again for the outcome that had just
 * failed (q2: craft iron_pickaxe 471 times, verified 4). Replayed over the real sequences, this rule and the sword rule
 * refuse 50 % / 59 % of q1 / q2's proposals (56 % / 63 % of their code calls) for 7 % / 6 % of their verified tasks, and
 * 15 % / 17 % of h1 / h2's for 3 %. Pure apart from mutating `rep`.
 */
export function noteOutcome (rep, sig, it, ok, why = '') {
  rep.streak ??= {}; rep.rest ??= {}; rep.why ??= {}
  if (ok) { delete rep.streak[sig]; delete rep.rest[sig]; delete rep.why[sig]; return rep }
  if (repeatExempt(sig)) return rep
  rep.streak[sig] = (rep.streak[sig] ?? 0) + 1
  rep.why[sig] = String(why).slice(0, 120)
  if (rep.streak[sig] >= REPEAT_FAILS) { rep.rest[sig] = it + REPEAT_REST; rep.streak[sig] = 0 }
  return rep
}

/** The outcomes set aside at iteration `it` (expired ones are dropped from `rep`). Pure apart from that pruning. */
export function setAside (rep, it) {
  const out = []
  for (const [sig, until] of Object.entries(rep?.rest ?? {})) {
    if (until > it) out.push(sig); else { delete rep.rest[sig]; delete rep.why?.[sig] }
  }
  return out.sort()
}

/**
 * Is this outcome set aside right now? The reason says for how long, why it last failed, and what to propose instead.
 * It is never a dead end: the rest ends by itself after REPEAT_REST tasks, and one success clears it. Pure.
 * @returns {{ok:boolean, reason?:string}}
 */
export function repeatRefusal (rep, sig, it) {
  const until = rep?.rest?.[sig]
  if (!(until > it)) return { ok: true }
  const why = rep.why?.[sig] ? ` (last time: ${rep.why[sig]})` : ''
  return { ok: false, reason: `that outcome failed ${REPEAT_FAILS} times in a row${why} and is set aside for your next ${until - it} tasks; propose a different outcome -- if it lacked an ingredient or a tool, propose getting that first` }
}

export const TASK_MAX_CHARS = 240
/**
 * Harness 2: is the task text ONE plain sentence? On the 3b Haiku arms a quarter of the proposals were a thought revised inside
 * the sentence ("craft a stone_hoe-free useful item ... no, instead"): 1,104 of 4,626 (24 %) carried an "<id>-free" word,
 * and 0.5 % of the rest ran past 240 characters. The reason names what to write instead, so the next ask can do it. Pure.
 * @returns {{ok:boolean, reason?:string}}
 */
export function plainTask (text) {
  const t = String(text ?? '')
  const remedy = 'write "task" as one plain sentence of at most 200 characters that says only what to do; decide before you write'
  if (t.length > TASK_MAX_CHARS) return { ok: false, reason: `the task text is ${t.length} characters long; ${remedy}` }
  if (/\b[a-z][a-z0-9_]*-free\b/i.test(t)) return { ok: false, reason: `the task text says what to avoid ("...-free"); ${remedy}` }
  if (/\.\.\.|\u2026/.test(t)) return { ok: false, reason: `the task text trails off and restarts ("..."); ${remedy}` }
  return { ok: true }
}

/**
 * Check a curriculum task before any code is written. Pure.
 * @param {object} task {task, why, success:{kind,...}}
 * @param {{items:Set<string>, blocks:Set<string>}} reg
 * @returns {{ok:boolean, reason?:string}}
 */
export function checkTask (task, reg) {
  if (!task || typeof task !== 'object') return { ok: false, reason: 'reply with one JSON object {task, why, success}' }
  if (typeof task.task !== 'string' || task.task.trim().length < 4) return { ok: false, reason: '`task` must be a short sentence' }
  const s = task.success
  if (!s || typeof s !== 'object' || !KINDS.includes(s.kind)) return { ok: false, reason: `success.kind must be one of: ${KINDS.join(', ')}` }
  const item = (n) => reg.items.has(n), block = (n) => reg.blocks.has(n)
  switch (s.kind) {
    case 'have': case 'craft':
      if (typeof s.item !== 'string' || !item(s.item)) return { ok: false, reason: `"${s.item}" is not a Minecraft item id` }
      if (infeasibleName(s.item)) return { ok: false, reason: `${s.item} cannot be obtained here (peaceful world, no Nether or End)` }
      if (s.kind === 'have' && !int(s.count, 1, 64)) return { ok: false, reason: 'success.count must be 1-64' }
      return { ok: true }
    case 'placed':
      if (typeof s.block !== 'string' || !block(s.block)) return { ok: false, reason: `"${s.block}" is not a block id` }
      if (infeasibleName(s.block)) return { ok: false, reason: `${s.block} cannot be obtained here` }
      if (!int(s.count, 1, 64)) return { ok: false, reason: 'success.count must be 1-64' }
      return { ok: true }
    case 'structure':
      if (!int(s.min_blocks, 4, 200)) return { ok: false, reason: 'success.min_blocks must be 4-200' }
      if (!int(s.max_span, 3, 24)) return { ok: false, reason: 'success.max_span must be 3-24' }
      return { ok: true }
    case 'reach':
      if (s.y != null) return int(s.y, -60, 300) && (s.dir === 'below' || s.dir === 'above') ? { ok: true } : { ok: false, reason: 'reach needs {y: -60..300, dir: "below"|"above"} or {block, within: 1-8}' }
      if (typeof s.block !== 'string' || !block(s.block) || !int(s.within, 1, 8)) return { ok: false, reason: 'reach needs {y, dir} or {block, within: 1-8}' }
      if (infeasibleName(s.block)) return { ok: false, reason: `${s.block} does not exist in this world` }
      return { ok: true }
    default: return { ok: false, reason: 'unknown success.kind' }
  }
}

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)

/**
 * Is the check already met before the run starts? (§12 B4: an already-satisfied target is not a task.) Pure.
 * @param {object} s success
 * @param {{inv:object, pos:object, nearBlock?:(name:string, within:number)=>boolean}} start
 */
export function alreadyMet (s, start) {
  if (s.kind === 'reach') {
    if (s.y != null) return s.dir === 'below' ? start.pos.y <= s.y : start.pos.y >= s.y
    return !!start.nearBlock?.(s.block, s.within)
  }
  return false   // have/craft/placed/structure are measured as gains during the run, so they cannot be pre-met
}

/** Largest 6-connected component of cells. Pure. */
export function largestCluster (cells) {
  const key = c => `${c.x},${c.y},${c.z}`
  const set = new Map(cells.map(c => [key(c), c]))
  const seen = new Set()
  let best = []
  for (const c of cells) {
    const k0 = key(c)
    if (seen.has(k0)) continue
    const comp = []
    const stack = [c]
    seen.add(k0)
    while (stack.length) {
      const u = stack.pop()
      comp.push(u)
      for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
        const k = key({ x: u.x + dx, y: u.y + dy, z: u.z + dz })
        if (set.has(k) && !seen.has(k)) { seen.add(k); stack.push(set.get(k)) }
      }
    }
    if (comp.length > best.length) best = comp
  }
  return best
}

export function span (cells) {
  if (!cells.length) return 0
  const ax = ['x', 'y', 'z'].map(a => Math.max(...cells.map(c => c[a])) - Math.min(...cells.map(c => c[a])) + 1)
  return Math.max(...ax)
}

/** Fraction of `cells` that are in any earlier structure. Pure. */
export function overlapWith (cells, earlier) {
  if (!cells.length) return 0
  const keys = new Set()
  for (const s of earlier ?? []) for (const c of s) keys.add(`${c.x},${c.y},${c.z}`)
  return cells.filter(c => keys.has(`${c.x},${c.y},${c.z}`)).length / cells.length
}

/**
 * Judge a finished run. Pure.
 * @param {object} s       the task's success check
 * @param {object} start   {inv:{name:n}, pos:{x,y,z}}
 * @param {object} end     {inv, pos, nearBlock?:fn}
 * @param {object} run     {standing:[{x,y,z,block}] -- this run's placed cells that the harness read back as still there,
 *                          chestTaken:{item:n}, crafted:{item:n}, earlierStructures:[[cells]]}
 * @returns {{ok:boolean, why:string, cells?:object[]}}
 */
export function verify (s, start, end, run = {}) {
  const gain = (item) => (end.inv[item] ?? 0) - (start.inv[item] ?? 0) - (run.chestTaken?.[item] ?? 0)
  switch (s.kind) {
    case 'have': {
      const g = gain(s.item)
      return g >= s.count ? { ok: true, why: `+${g} ${s.item} (chest takes excluded)` } : { ok: false, why: `${s.item} rose by ${g}, needed ${s.count}${run.chestTaken?.[s.item] ? ` (${run.chestTaken[s.item]} taken from a chest do not count)` : ''}` }
    }
    case 'craft': {
      const g = gain(s.item)
      const made = run.crafted?.[s.item] ?? 0
      return g >= 1 && made >= 1 ? { ok: true, why: `crafted ${s.item}, +${g}` } : { ok: false, why: `no new ${s.item} from a craft (gain ${g}, crafts ${made})` }
    }
    case 'placed': {
      const n = (run.standing ?? []).filter(c => c.block === s.block).length
      return n >= s.count ? { ok: true, why: `${n} ${s.block} placed and still standing` } : { ok: false, why: `${n} ${s.block} placed and still standing, needed ${s.count}` }
    }
    case 'structure': {
      const cluster = largestCluster(run.standing ?? [])
      if (cluster.length < s.min_blocks) return { ok: false, why: `the largest connected group of placed blocks is ${cluster.length}, needed ${s.min_blocks}` }
      const sp = span(cluster)
      if (sp > s.max_span) return { ok: false, why: `the structure spans ${sp} blocks, more than ${s.max_span}` }
      const ov = overlapWith(cluster, run.earlierStructures)
      if (ov > 0.5) return { ok: false, why: `${Math.round(ov * 100)}% of it is an earlier structure: a rebuild, not a new project` }
      return { ok: true, why: `${cluster.length} connected blocks within ${sp}`, cells: cluster }
    }
    case 'reach': {
      if (s.y != null) {
        const ok = s.dir === 'below' ? end.pos.y <= s.y : end.pos.y >= s.y
        return ok ? { ok: true, why: `ended at y=${Math.round(end.pos.y)}` } : { ok: false, why: `ended at y=${Math.round(end.pos.y)}, not ${s.dir} ${s.y}` }
      }
      const near = !!end.nearBlock?.(s.block, s.within)
      return near ? { ok: true, why: `within ${s.within} of ${s.block}` } : { ok: false, why: `not within ${s.within} of any ${s.block}` }
    }
    default: return { ok: false, why: 'unknown check' }
  }
}

/** The outcome signature that makes a skill "invented" (§12 B4 e). Pure. */
export function outcomeSignature (s) {
  switch (s?.kind) {
    case 'have': case 'craft': return `${s.kind}:${s.item}`
    case 'placed': return `placed:${s.block}`
    case 'structure': return `structure:${s.min_blocks >= 30 ? 'large' : s.min_blocks >= 12 ? 'medium' : 'small'}`
    case 'reach': return s.y != null ? `reach:y${s.dir}${Math.round(s.y / 16) * 16}` : `reach:${s.block}`
    default: return 'unknown'
  }
}

export { dist }
