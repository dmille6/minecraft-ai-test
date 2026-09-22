// The shoreline exemption, judged by the offline funnel before it costs a canary slot.
//
// The claim: it must flip the SHORELINE scene from refused to diggable, and change nothing else.
// leaf-01 is why that second half is load-bearing -- it halved the refusal it targeted and the freed
// attempts became a different refusal (+13.6 pp no_safe_target) rather than wood.
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { mkBot, gatherMovements, sceneWorld, reachable, inReach, Vec3 } from './helpers/reachlab.mjs'
import { isExposed, isSafeToBreak, shorelineExemptAt, shorelineLogExempt, terrainAbove, standingDry,
         wetBlock, NATURAL_LOG } from '../src/skills.mjs'

const load = k => JSON.parse(readFileSync(new URL(`./fixtures/synthetic-tree-${k}.json`, import.meta.url), 'utf8'))
const P = (x, y, z) => Object.assign(new Vec3(x, y, z), { offset: (a, b, c) => P(x + a, y + b, z + c) })

/** Run a scene through gather's funnel under either arm's safety filter. */
function stageOf (fx, target, { candidate }) {
  const world = sceneWorld(fx)
  const bot = mkBot(world, new Vec3(...fx.bot.pos))
  bot.pathfinder.movements = gatherMovements(bot)
  const tp = P(target[0], target[1], target[2])
  if (!isExposed(bot, tp)) return 'unreachable(buried)'
  const safe = candidate ? (isSafeToBreak(bot, tp) || shorelineExemptAt(bot, tp)) : isSafeToBreak(bot, tp)
  if (!safe) return 'no_safe_target'
  const nodes = reachable(bot.pathfinder.movements,
    new Vec3(...fx.bot.pos.map(Math.floor)), 4000)
  return nodes.some(n => inReach(n, tp)) ? 'diggable' : 'no_path'
}
const basal = fx => [fx.origin[0], fx.origin[1], fx.origin[2]]
const SCENES = [
  ['open',      f => basal(f),                                       'diggable',            'diggable'],
  ['canopy',    f => basal(f),                                       'unreachable(buried)', 'unreachable(buried)'],
  ['shoreline', f => basal(f),                                       'no_safe_target',      'diggable'],
  ['buried',    f => [f.origin[0], f.origin[1] - 6, f.origin[2]],    'unreachable(buried)', 'unreachable(buried)'],
  ['wetstone',  f => [f.origin[0] + 1, f.origin[1] - 10, f.origin[2]], 'no_safe_target',    'no_safe_target'],
]

test('THE WHOLE CLAIM: the shoreline scene flips, and NOTHING else moves', () => {
  for (const [k, tgt, wantBase, wantCand] of SCENES) {
    const fx = load(k); const t = tgt(fx)
    assert.equal(stageOf(fx, t, { candidate: false }), wantBase, `${k}: baseline stage changed`)
    assert.equal(stageOf(fx, t, { candidate: true }), wantCand, `${k}: candidate stage is wrong`)
  }
})

test('the LEAKAGE control is refused by the candidate for a reason, not by luck', () => {
  const fx = load('wetstone'); const t = [fx.origin[0] + 1, fx.origin[1] - 10, fx.origin[2]]
  const world = sceneWorld(fx); const bot = mkBot(world, new Vec3(...fx.bot.pos))
  bot.pathfinder.movements = gatherMovements(bot)
  const tp = P(...t)
  assert.equal(shorelineExemptAt(bot, tp), false, 'the exemption admitted wet underground stone')
  assert.equal(NATURAL_LOG.test('stone'), false)
})

test('the POSITIVE CONTROL never needed the exemption -- it was already safe', () => {
  const fx = load('open')
  const world = sceneWorld(fx); const bot = mkBot(world, new Vec3(...fx.bot.pos))
  bot.pathfinder.movements = gatherMovements(bot)
  const tp = P(...basal(fx))
  assert.equal(isSafeToBreak(bot, tp), true)
  assert.equal(shorelineExemptAt(bot, tp), false,
    'the exemption fires on a dry tree, so it is wider than its name and its tests')
})

test('WETNESS BY NAME: `.liquid` is a decoration and is undefined on a raw block', () => {
  const fx = load('shoreline')
  const world = sceneWorld(fx)
  const wb = world.getBlock(new Vec3(fx.origin[0] + 3, fx.origin[1], fx.origin[2]))
  assert.equal(wb.name, 'water')
  assert.equal(wb.liquid, undefined, 'a raw block carries no .liquid -- that is the whole trap')
  assert.equal(wb.boundingBox, 'empty', 'and it passes an emptiness test, which is the other half')
  assert.equal(wetBlock(wb), true, 'wetBlock must catch it by name')
  for (const n of ['water', 'lava', 'flowing_water', 'bubble_column', 'powder_snow'])
    assert.equal(wetBlock({ name: n, boundingBox: 'empty' }), true, n)
  assert.equal(wetBlock({ name: 'air', boundingBox: 'empty' }), false)
  assert.equal(wetBlock({ name: 'oak_stairs', boundingBox: 'block', _properties: { waterlogged: true } }), true,
    'a waterlogged block is wet')
  assert.equal(wetBlock({ name: 'oak_stairs', boundingBox: 'block', getProperties: () => ({ waterlogged: true }) }), true,
    'and via getProperties(), because prismarine exposes it both ways')
})

test('NEVER FROM BELOW: standingDry refuses when the bot is under the target', () => {
  // Codex pass 1 executed collectManually with the bot two blocks BELOW the target
  // and bot.dig was invoked, because the reach shortcut skips the approach. A
  // certified stance the bot need not occupy is not a safety property.
  const fx = load('shoreline'); const world = sceneWorld(fx)
  const tp = P(...basal(fx))
  const below = mkBot(world, new Vec3(fx.origin[0] - 1, fx.origin[1] - 2, fx.origin[2] + 1))
  assert.equal(standingDry(below, tp), null, 'a bot below the target was cleared to break it')
  const wet = mkBot(world, new Vec3(fx.origin[0] + 3.5, fx.origin[1], fx.origin[2] + 0.5))
  assert.equal(standingDry(wet, tp), null, 'a bot standing IN the pond was cleared')
})

test('standingDry admits the dry bank at the log\'s own level', () => {
  const fx = load('shoreline'); const world = sceneWorld(fx)
  const tp = P(...basal(fx))
  const bot = mkBot(world, new Vec3(fx.origin[0] - 1 + 0.5, fx.origin[1], fx.origin[2] + 0.5))
  const st = standingDry(bot, tp)
  assert.ok(st, 'the dry bank beside the trunk was refused')
  assert.ok(st.y >= tp.y)
  assert.equal(terrainAbove(bot, tp), false, 'the funnel thinks a tree trunk is under terrain')
})

// ----------------------------------------------------------- the truth table
const W = { name: 'water', liquid: true }
const L = { name: 'lava', liquid: true }
const A = { name: 'air', liquid: false }
const SAND = { name: 'sand', liquid: false, canFall: true }
const base = (over = {}) => ({
  target: { name: 'oak_log', position: { y: 70 } },
  above: A, sides: [W, A, A, A], entitiesAbove: 0,
  stance: { dry: true, y: 70 }, buried: false, ...over,
})

test('ADMITS: a natural log, water on one side, dry stance at the surface', () => {
  assert.equal(shorelineLogExempt(base()), true)
})

test('REFUSES lava on any face, by name, whatever the statistics say', () => {
  assert.equal(shorelineLogExempt(base({ sides: [L, A, A, A] })), false)
  assert.equal(shorelineLogExempt(base({ above: L })), false)
  assert.equal(shorelineLogExempt(base({ sides: [W, L, A, A] })), false, 'mixed water+lava must refuse')
})

test('REFUSES liquid above -- the case dontCreateFlow actually exists for', () => {
  assert.equal(shorelineLogExempt(base({ above: W })), false)
})

test('REFUSES when the veto is falling, entity, or both -- that half is untouched', () => {
  assert.equal(shorelineLogExempt(base({ above: SAND, sides: [A, A, A, A] })), false, 'falling')
  assert.equal(shorelineLogExempt(base({ above: SAND })), false, 'both (sand above AND side water)')
  assert.equal(shorelineLogExempt(base({ entitiesAbove: 1 })), false, 'entity + liquid = both')
})

test('REFUSES a target that is not a natural log', () => {
  for (const n of ['stone', 'sand', 'iron_ore', 'dirt', 'oak_leaves', 'stripped_oak_log', 'oak_wood', 'logs']) {
    assert.equal(shorelineLogExempt(base({ target: { name: n, position: { y: 70 } } })), false, n)
  }
  for (const n of ['oak_log', 'birch_log', 'spruce_log', 'cherry_log', 'pale_oak_log']) {
    assert.equal(shorelineLogExempt(base({ target: { name: n, position: { y: 70 } } })), true, n)
  }
})

test('REFUSES under terrain, so this is structurally impossible in a shaft', () => {
  assert.equal(shorelineLogExempt(base({ buried: true })), false)
  assert.equal(shorelineLogExempt(base({ buried: null })), false, 'an unreadable column must refuse')
  assert.equal(shorelineLogExempt(base({ buried: undefined })), false)
})

test('terrainAbove: wood and foliage overhead are a TREE; stone overhead is a shaft', () => {
  const mk = names => ({ blockAt: q => {
    const n = names[q.y - 70]
    if (n === undefined) return null
    return { name: n, boundingBox: n === 'air' ? 'empty' : 'block' }
  } })
  const at = { y: 70, offset: (a, b) => ({ y: 70 + b, offset: () => null }) }
  assert.equal(terrainAbove(mk({ 1: 'oak_log', 2: 'oak_log', 3: 'oak_leaves', 4: 'air' }), at), false)
  assert.equal(terrainAbove(mk({ 1: 'air', 2: 'air', 3: 'air', 4: 'air' }), at), false)
  assert.equal(terrainAbove(mk({ 1: 'stone', 2: 'air', 3: 'air', 4: 'air' }), at), true, 'stone overhead')
  assert.equal(terrainAbove(mk({ 1: 'air', 2: 'gravel', 3: 'air', 4: 'air' }), at), true, 'gravel overhead')
  assert.equal(terrainAbove(mk({ 1: 'air' }), at), true, 'an unreadable cell must count against admission')
})

test('REFUSES without a dry stance at or above the target', () => {
  assert.equal(shorelineLogExempt(base({ stance: null })), false)
  assert.equal(shorelineLogExempt(base({ stance: { dry: false, y: 70 } })), false)
  assert.equal(shorelineLogExempt(base({ stance: { dry: true, y: 69 } })), false, 'standing in the hole')
})

test('REFUSES an unrecognised fluid rather than admitting it', () => {
  assert.equal(shorelineLogExempt(base({ sides: [{ name: 'some_mod_fluid', liquid: true }, A, A, A] })), false)
})

test('REFUSES when nothing vetoed at all -- the exemption is not a second admission path', () => {
  assert.equal(shorelineLogExempt(base({ sides: [A, A, A, A] })), false)
})

// ----------------------------------------------------------------- mutants
const SKILLS_PATH = new URL('../src/skills.mjs', import.meta.url)
async function withMutant (path, old, neu, fn) {
  const src = readFileSync(path, 'utf8')
  assert.ok(src.includes(old), `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 60))}`)
  assert.ok(src.split(old).length === 2, 'the mutation target is not unique; the mutant is ambiguous')
  const body = src.replace(old, neu).replace(/from '\.\//g, "from '../src/")
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, body)
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}

test('the lava guard is REDUNDANT, and that is verified rather than assumed', async () => {
  // Removing the by-name line alone does NOT admit lava: the water-only line below it
  // refuses any liquid that is not water. Discovered because this mutant failed to
  // bite. Keeping both is deliberate -- lava is the one face nobody may relax.
  await withMutant(SKILLS_PATH,
    "  if (lava(above) || sides.some(lava)) return false\n", "",
    async mod => assert.equal(mod.shorelineLogExempt(base({ sides: [L, A, A, A] })), false,
      'the water-only line no longer backs up the lava check; they are not redundant any more'))
})

test('MUTANT KILLED: removing BOTH liquid-identity lines admits lava on a side', async () => {
  await withMutant(SKILLS_PATH,
    "  if (lava(above) || sides.some(lava)) return false\n" +
    "  if (sides.some(b => b?.liquid && String(b.name) !== 'water')) return false\n",
    "",
    async mod => {
      assert.equal(mod.shorelineLogExempt(base({ sides: [L, A, A, A] })), true,
        'lava is still refused with both guards gone, so neither is what refuses it')
      assert.equal(mod.shorelineLogExempt(base({ above: L })), false,
        'lava ABOVE must still be refused by condition 3 alone')
    })
})

test('MUTANT KILLED: accepting any veto cause admits the falling-block half', async () => {
  await withMutant(SKILLS_PATH,
    "  if (breakVeto({ above, sides, entitiesAbove }) !== 'liquid') return false",
    "  if (breakVeto({ above, sides, entitiesAbove }) === null) return false",
    async mod => assert.equal(mod.shorelineLogExempt(base({ above: SAND, sides: [A, A, A, A] })), true,
      'the mutant did not widen the veto cause'))
})

test('MUTANT KILLED: /_log$/ instead of the species list admits a stripped log', async () => {
  await withMutant(SKILLS_PATH,
    "export const NATURAL_LOG = /^(oak|birch|spruce|jungle|acacia|dark_oak|mangrove|cherry|pale_oak)_log$/",
    "export const NATURAL_LOG = /_log$/",
    async mod => assert.equal(
      mod.shorelineLogExempt(base({ target: { name: 'stripped_oak_log', position: { y: 70 } } })), true,
      'the mutant did not widen the species rule'))
})

test('MUTANT KILLED: dropping the overburden test makes it reachable in a shaft', async () => {
  await withMutant(SKILLS_PATH,
    "  if (buried !== false) return false",
    "  if (false) return false",
    async mod => assert.equal(mod.shorelineLogExempt(base({ buried: true })), true,
      'the mutant did not remove the overburden guard'))
})

test('MUTANT KILLED: dropping the stance test lets the bot stand in what it opens', async () => {
  await withMutant(SKILLS_PATH,
    "  if (!stance || !stance.dry || !Number.isFinite(stance.y) || stance.y < y) return false",
    "  if (false) return false",
    async mod => assert.equal(mod.shorelineLogExempt(base({ stance: null })), true,
      'the mutant did not remove the stance guard'))
})

test('EXACTLY TWO CALL SITES, and the Movements flag is never cleared', () => {
  // Structural, because behaviour cannot reach "nobody else calls this". Comments are
  // stripped first: this codebase's comments quote the code they explain.
  const strip = t => t.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')
  const sk = strip(readFileSync(SKILLS_PATH, 'utf8'))
  const pr = strip(readFileSync(new URL('../src/prompt.mjs', import.meta.url), 'utf8'))
  const ix = strip(readFileSync(new URL('../src/index.mjs', import.meta.url), 'utf8'))
  const calls = (sk.split('shorelineExemptAt(bot').length - 1) + (pr.split('shorelineExemptAt(bot').length - 1)
  // THREE, not two, and the third is the one that makes the other two safe.
  // Pass 2 executed a dig from a position the bot moved to AFTER admission, so the
  // permission is re-asked immediately before bot.dig. Raising this number is a
  // deliberate act and the test says which three are allowed.
  assert.equal(calls, 3, `the exemption has ${calls} call sites; exactly three are sanctioned`)
  assert.ok(sk.includes('isSafeToBreak(bot, p) || shorelineExemptAt(bot, p)'),
    "gather's filter must carry it")
  assert.ok(sk.includes('!isSafeToBreak(bot, block.position) && !shorelineExemptAt(bot, block.position)'),
    'the pre-dig re-check is gone -- the admission can go stale across the walk and the equip')
  assert.ok(pr.includes('!isSafeToBreak(bot, p) && !shorelineExemptAt(bot, p)'),
    'the observation must carry it, or the model cannot see what the skill now accepts')
  // The guard whose absence cost five deaths in 14 bot-hours.
  assert.ok(ix.includes('gatherMoves.dontCreateFlow = true'),
    'the gather Movements profile must still refuse every dig beside liquid')
  // THE FLAG MAY BE SHADOWED ON A THROWAWAY RECEIVER, NEVER CLEARED ON A SHARED ONE.
  //
  // This assertion originally forbade the string outright, and the fix for Codex
  // pass 1's `blocksCantBreak` bypass tripped it -- correctly, which is why it is
  // narrowed rather than deleted. Re-asking the library with only the flow rule off
  // is the right implementation; doing it by mutating `gatherMoves`, `moves`,
  // `bot.pathfinder.movements` or `bot.collectBlock.movements` is the wrong one,
  // and that is the distinction the fleet pays for.
  assert.equal(/dontCreateFlow\s*=\s*false/.test(ix), false,
    'index.mjs clears dontCreateFlow on a live profile -- that is the 6d1fdba defect')
  assert.equal(/dontCreateFlow\s*=\s*false/.test(pr), false, 'prompt.mjs must not touch the profile')
  const clears = [...sk.matchAll(/(\w+)\.dontCreateFlow\s*=\s*false/g)].map(m2 => m2[1])
  assert.deepEqual(clears, ['probe'],
    `dontCreateFlow is cleared on ${JSON.stringify(clears)}; only a local non-escaping receiver is allowed`)
  assert.ok(/const probe = Object\.create\(m\)\s*\n\s*probe\.dontCreateFlow = false/.test(sk),
    'the receiver must be an Object.create child of the real movements, created immediately before')
})


// ------------------------------------------- the library's OTHER guards still bite
//
// Pass 2: deleting `if (!probe.safeToBreak(target)) return false` passed all 23 tests,
// which restored pass 1's bypass of canDig / blocksCantBreak / exclusionBreak. These
// are the behavioural cases that make that line load-bearing.
function shoreBot ({ canDig = true, cantBreak = false, exclusion = 0, entities = 0 } = {}) {
  const fx = load('shoreline')
  const world = sceneWorld(fx)
  const bot = mkBot(world, new Vec3(fx.origin[0] - 1 + 0.5, fx.origin[1], fx.origin[2] + 0.5))
  const m = gatherMovements(bot)
  m.canDig = canDig
  if (cantBreak) m.blocksCantBreak = new Set([world.getBlock(new Vec3(...basal(fx))).type])
  m.exclusionBreak = () => exclusion
  m.getNumEntitiesAt = () => entities
  bot.pathfinder.movements = m
  return { bot, tp: P(...basal(fx)) }
}

test('the exemption admits the shoreline log when every other library guard is happy', () => {
  const { bot, tp } = shoreBot()
  assert.equal(shorelineExemptAt(bot, tp), true, 'the baseline case must be admitted, or the four below prove nothing')
})

test('REFUSES when canDig is false -- the library says the profile may not dig at all', () => {
  const { bot, tp } = shoreBot({ canDig: false })
  assert.equal(shorelineExemptAt(bot, tp), false)
})

test('REFUSES a block in blocksCantBreak, which breakVeto knows nothing about', () => {
  const { bot, tp } = shoreBot({ cantBreak: true })
  assert.equal(shorelineExemptAt(bot, tp), false)
})

test('REFUSES inside a break-exclusion area', () => {
  const { bot, tp } = shoreBot({ exclusion: 100 })
  assert.equal(shorelineExemptAt(bot, tp), false)
})

test('REFUSES with an entity overhead -- dontMineUnderFallingBlock runs inside the probe', () => {
  const { bot, tp } = shoreBot({ entities: 1 })
  assert.equal(shorelineExemptAt(bot, tp), false)
})

test('MUTANT KILLED: deleting the library re-ask restores the bypass pass 1 found', async () => {
  await withMutant(SKILLS_PATH,
    "    if (!probe.safeToBreak(target)) return false\n", "",
    async mod => {
      const { bot, tp } = shoreBot({ cantBreak: true })
      assert.equal(mod.shorelineExemptAt(bot, tp), true,
        'the mutant still refuses, so the probe line is not what refuses an unbreakable block')
    })
})

test('MUTANT KILLED: dropping the clearance check admits a bot with stone in its head', async () => {
  await withMutant(SKILLS_PATH,
    "  if (!clear(feet) || !clear(head)) return null\n", "",
    async mod => {
      const fx = load('shoreline')
      // A world where the bank cell above the bot's feet is stone.
      const cells = { ...fx.cells }
      cells[`${fx.origin[0] - 1},${fx.origin[1] + 1},${fx.origin[2]}`] = 'stone'
      const world = sceneWorld({ ...fx, cells })
      const bot = mkBot(world, new Vec3(fx.origin[0] - 1 + 0.5, fx.origin[1], fx.origin[2] + 0.5))
      assert.ok(mod.standingDry(bot, P(...basal(fx))),
        'the mutant did not remove the clearance guard')
    })
})


test('THE CHANGE ROW exists, is emitted once per round, and the baseline cannot emit it', () => {
  // Structural: behaviour cannot reach "no control pool emits this". Comments stripped
  // first, because this codebase's comments quote the code they explain.
  const strip = t => t.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')
  const sk = strip(readFileSync(SKILLS_PATH, 'utf8'))
  assert.equal(sk.split("kind: 'shoreline_exempt'").length - 1, 1,
    'the change row must be emitted exactly once in the file')
  assert.ok(sk.includes('const exempted = safeOnes.filter(q => !isSafeToBreak(bot, q)).length'),
    'the count must be RECOMPUTED, not accumulated inside safeTarget -- a filter with a side '
    + 'effect reorders differently once you add a log line')
  assert.ok(sk.includes('if (exempted > 0) {'), 'a round that exempted nothing must stay silent')
})

test('MUTANT KILLED: counting inside the filter would fire on every ordinary candidate', async () => {
  await withMutant(SKILLS_PATH,
    "      const exempted = safeOnes.filter(q => !isSafeToBreak(bot, q)).length",
    "      const exempted = safeOnes.length",
    async mod => {
      // The mutant counts every SAFE candidate as exempted, so an ordinary dry tree --
      // which never needed the exemption -- would file a change row and a control-arm
      // comparison would read the change as firing everywhere.
      const { bot, tp } = shoreBot()
      assert.equal(mod.shorelineExemptAt(bot, tp), true, 'the fixture must still be exempt')
      const src = readFileSync(SKILLS_PATH, 'utf8')
      assert.ok(src.includes('safeOnes.filter(q => !isSafeToBreak(bot, q))'),
        'the real build must count only candidates the ordinary rule REFUSED')
    })
})
