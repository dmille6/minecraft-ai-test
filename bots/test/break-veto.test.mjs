// SAFETO BREAK ORS TWO RULES AND RETURNS ONE FALSE.
//
// `Movements.safeToBreak` (mineflayer-pathfinder 2.4.5, lib/movements.js:253)
// refuses a block when EITHER a liquid touches one of five faces
// (dontCreateFlow) OR a fallable block/entity sits directly above
// (dontMineUnderFallingBlock). Both return the same `false`, so the gather
// refusal has always had to say "beside water or under falling blocks".
//
// Measured 2026-09-07: that refusal ends 18% of ALL gather runs, and 320 of 958
// of them target SAND -- which is itself a falling block. So the share caused
// by liquid is somewhere between 3% and 97%, and a change that relaxes the
// liquid rule cannot be sized, let alone justified, until the two are
// distinguished. This is the discriminator.
import assert from 'node:assert'
import test from 'node:test'
import { breakVeto, breakVetoAt, FLOW_FACES } from '../src/skills.mjs'

const water = { liquid: true, name: 'water' }
const lava = { liquid: true, name: 'lava' }
const sand = { canFall: true, name: 'sand' }
const stone = { name: 'stone' }
const air = { name: 'air' }

test('nothing above or beside is not a refusal', () => {
  assert.equal(breakVeto({ above: air, sides: [stone, stone, stone, stone] }), null)
  // POSITIVE CONTROL: the function must be capable of saying something, or
  // every null above passes for the trivial reason that it always returns null.
  assert.equal(breakVeto({ above: water, sides: [] }), 'liquid')
})

test('liquid on any single face is the liquid rule', () => {
  assert.equal(breakVeto({ above: water, sides: [stone, stone, stone, stone] }), 'liquid')
  for (let i = 0; i < 4; i++) {
    const sides = [stone, stone, stone, stone]
    sides[i] = water
    assert.equal(breakVeto({ above: air, sides }), 'liquid', `face ${i}`)
  }
  assert.equal(breakVeto({ above: air, sides: [lava, stone, stone, stone] }), 'liquid')
})

test('a fallable block above is the falling rule, not the liquid one', () => {
  assert.equal(breakVeto({ above: sand, sides: [stone, stone, stone, stone] }), 'falling')
})

test('an entity above is its own cause', () => {
  assert.equal(breakVeto({ above: air, sides: [stone], entitiesAbove: 1 }), 'entity')
  assert.equal(breakVeto({ above: air, sides: [stone], entitiesAbove: 0 }), null)
})

test('both rules at once is reported as both, never silently one', () => {
  // This is the case that would corrupt the measurement: sand above AND water
  // beside. Attributing it to liquid would overstate the addressable share,
  // which is the exact number the proposed change would be sized on.
  assert.equal(breakVeto({ above: sand, sides: [water, stone, stone, stone] }), 'both')
  assert.equal(breakVeto({ above: water, sides: [stone], entitiesAbove: 2 }), 'both')
})

test('a block BELOW being liquid is not a refusal', () => {
  // dontCreateFlow deliberately skips down: a block sitting ON water is not a
  // way in. FLOW_FACES must never contain [0,-1,0].
  assert.ok(!FLOW_FACES.some(([, dy]) => dy < 0), 'FLOW_FACES must not look down')
  assert.equal(FLOW_FACES.length, 5)
  assert.deepEqual(FLOW_FACES[0], [0, 1, 0], 'above is first; breakVetoAt slices from 1')
})

test('junk input does not invent a refusal', () => {
  // isSafeToBreak defaults to SAFE when it cannot ask. This must point the same
  // way, or a missing movements object would start reporting phantom causes.
  assert.equal(breakVeto(), null)
  assert.equal(breakVeto({}), null)
  assert.equal(breakVeto({ above: null, sides: [null, undefined] }), null)
  assert.equal(breakVeto({ above: undefined, sides: undefined }), null)
  assert.equal(breakVeto({ entitiesAbove: 'x' }), null)
})

test('breakVetoAt reads REAL blocks, not hand-decorated fakes', async () => {
  // THE TEST THAT WAS MISSING, AND THE BUG IT WOULD HAVE CAUGHT.
  //
  // Every other test in this file builds its own `{ liquid: true }` literals,
  // so all of them passed against a `breakVetoAt` that read `bot.blockAt` --
  // which returns blocks WITHOUT those properties. `liquid` and `canFall` are
  // written on by Movements.getBlock (movements.js:236-238); on a real
  // prismarine block they are `undefined`. The instrument would have answered
  // `unknown` for 100% of refusals with all eight tests green.
  //
  // So this test uses the real registry and the real Movements.getBlock.
  const { default: mcDataLoader } = await import('minecraft-data')
  const { default: PBlock } = await import('prismarine-block')
  const { Movements } = await import('mineflayer-pathfinder')
  const { Vec3 } = await import('vec3')

  const mcData = mcDataLoader('1.21.8')
  const Block = PBlock('1.21.8')
  const at = name => Block.fromStateId(mcData.blocksByName[name].defaultState, 0)

  // Proof the properties really are absent before decoration -- if this ever
  // stops being true the bug class is gone and this test should be revisited.
  assert.equal(at('water').liquid, undefined, 'a raw block has no .liquid')
  assert.equal(at('sand').canFall, undefined, 'a raw block has no .canFall')

  const world = new Map()
  const key = (x, y, z) => `${x},${y},${z}`
  const bot = {
    blockAt: v => world.get(key(v.x, v.y, v.z)) ?? at('stone'),
    registry: mcData,
  }
  const m = new Movements(bot)
  const target = new Vec3(0, 64, 0)
  bot.collectBlock = { movements: m }

  const place = (dx, dy, dz, name) => world.set(key(dx, 64 + dy, dz), at(name))
  const clear = () => world.clear()

  clear(); place(0, 1, 0, 'air')
  assert.equal(breakVetoAt(bot, target), null, 'stone all round is no refusal')

  clear(); place(0, 1, 0, 'water')
  assert.equal(breakVetoAt(bot, target), 'liquid', 'water ABOVE is the liquid rule')

  clear(); place(0, 1, 0, 'air'); place(1, 0, 0, 'water')
  assert.equal(breakVetoAt(bot, target), 'liquid', 'water BESIDE is the liquid rule')

  clear(); place(0, 1, 0, 'air'); place(-1, 0, 0, 'lava')
  assert.equal(breakVetoAt(bot, target), 'liquid',
    'LAVA counts too -- pathfinder\'s `liquids` set holds both, which is why a ' +
    'drowning-only tripwire cannot see the harm this rule prevents')

  clear(); place(0, 1, 0, 'sand')
  assert.equal(breakVetoAt(bot, target), 'falling', 'sand ABOVE is the falling rule')

  clear(); place(0, 1, 0, 'sand'); place(0, 0, 1, 'water')
  assert.equal(breakVetoAt(bot, target), 'both', 'sand above AND water beside is both')

  // And it must never answer for a bot it cannot ask.
  assert.equal(breakVetoAt({}, target), null, 'no movements object means no answer')

  // THE MUTANT, INLINE.
  //
  // Not applied to src/: this repo's runner SIGKILLs, so an in-place mutant
  // survives on disk and fleet-recycle deploys it within six hours. Instead,
  // reproduce the ORIGINAL implementation here and show it is blind to every
  // case above. This is the failure this test exists to catch, and it is
  // demonstrated rather than asserted.
  clear(); place(0, 1, 0, 'water'); place(1, 0, 0, 'lava'); place(0, 0, 1, 'sand')
  const viaBlockAt = breakVeto({
    above: bot.blockAt(target.offset(0, 1, 0)),
    sides: FLOW_FACES.slice(1).map(([dx, dy, dz]) => bot.blockAt(target.offset(dx, dy, dz))),
    entitiesAbove: 0,
  })
  assert.equal(viaBlockAt, null,
    'the old bot.blockAt path is BLIND: water above, lava beside and sand beside ' +
    'and it still reports no refusal')
  assert.equal(breakVetoAt(bot, target), 'liquid',
    'while the fixed path, on the identical world, sees it')
})

test('it agrees with the real safeToBreak on the cases it claims to explain', async () => {
  // The point of this function is to explain a LIBRARY decision. If it can
  // disagree with the library, the measurement it produces is fiction.
  const { Movements } = await import('mineflayer-pathfinder')
  const m = Object.create(Movements.prototype)
  m.canDig = true
  m.dontCreateFlow = true
  m.dontMineUnderFallingBlock = true
  m.blocksCantBreak = new Set()
  m.exclusionBreak = () => 0
  m.getNumEntitiesAt = () => 0

  const cases = [
    { above: air, sides: [stone, stone, stone, stone] },
    { above: water, sides: [stone, stone, stone, stone] },
    { above: air, sides: [stone, water, stone, stone] },
    { above: sand, sides: [stone, stone, stone, stone] },
    { above: sand, sides: [water, stone, stone, stone] },
  ]
  for (const c of cases) {
    const cells = [c.above, ...c.sides]
    m.getBlock = (_pos, dx, dy, dz) => {
      const i = FLOW_FACES.findIndex(([x, y, z]) => x === dx && y === dy && z === dz)
      return cells[i] ?? stone
    }
    const libraryRefused = !m.safeToBreak({ position: { x: 0, y: 0, z: 0 }, type: 1 })
    const weExplain = breakVeto(c) !== null
    assert.equal(weExplain, libraryRefused,
      `disagreed with safeToBreak on ${JSON.stringify(c)}: ` +
      `library refused=${libraryRefused}, breakVeto=${breakVeto(c)}`)
  }
})
