// THE ESCAPE REFLEX IS WHAT BUILDS THE TRAP.
//
// Forensics over 12 hours, 6,262,866 records: 23 of 26 permanently-stuck bots
// emitted a marooned or entombed diagnostic within fifteen minutes of going
// still, and 20 of 26 GAINED ALTITUDE at onset. The machine is always the same
// — the bot cannot travel, the escape seizes the body and pillars up, it runs
// out of material partway, and it is sealed in the column it just dug, higher
// than it started and holding nothing.
//
// Fleet-wide the machinery spent 68,457 oak_log, 35,580 sand, 34,932
// cobblestone and 22,471 dirt, and destroyed 434 pickaxes across 574 events.
// 24 of the 26 stuck bots now hold zero pickaxes, at which point
// harvestAdjacent fails 99.4% of the time with "0/8 dug" — the walls are stone
// and there is nothing left to break them with.
//
// These two guards do not rescue anyone. They stop the rescue from
// manufacturing unrecoverable states.
import assert from 'node:assert'
import { canFinishClimb, mayDigForEscape } from '../src/reflex.mjs'

let pass = 0, fail = 0
const t = (name, fn) => {
  try { fn(); pass++; console.log(`  PASS  ${name}`) }
  catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) }
}
const pick = (used = 0, max = 59) =>
  ({ name: 'wooden_pickaxe', count: 1, maxDurability: max, durabilityUsed: used })

// --- a climb you cannot finish is worse than no climb ----------------------

t('a climb that cannot be completed is refused before it starts', () => {
  // board-a-Echo climbed y=30->54 and stopped, sealed, holding nothing. The
  // blocks were spent AND it ended further from the ground it needed.
  assert.equal(canFinishClimb({ have: 6, need: 24 }), false)
})

t('a climb with the material to finish proceeds', () => {
  assert.equal(canFinishClimb({ have: 30, need: 24 }), true)
})

t('one spare block is required, because the top placement often mistimes', () => {
  assert.equal(canFinishClimb({ have: 24, need: 24 }), false,
    'exactly enough is not enough — running out on the last block is the case')
  assert.equal(canFinishClimb({ have: 25, need: 24 }), true)
})

t('blocked headroom costs one more block', () => {
  assert.equal(canFinishClimb({ have: 25, need: 24, headroomBlocked: true }), false)
  assert.equal(canFinishClimb({ have: 26, need: 24, headroomBlocked: true }), true)
})

t('a zero-block climb is always fine', () => {
  assert.equal(canFinishClimb({ have: 0, need: 0 }), true)
})

// --- never spend the last pickaxe -----------------------------------------

t('THE LAST PICKAXE IS NOT SPENDABLE', () => {
  // Breaking it here ends every future escape this bot could make.
  assert.equal(mayDigForEscape([pick()]), false)
  assert.equal(mayDigForEscape([]), false)
})

t('a spare pickaxe makes digging out permissible', () => {
  assert.equal(mayDigForEscape([pick(), pick()]), true)
})

t('a pickaxe with one swing left is already gone', () => {
  // Durability metadata lags a tick, and a tool that breaks one swing early is
  // the entire failure being prevented.
  assert.equal(mayDigForEscape([pick(58), pick(58)]), false,
    'two nearly-dead pickaxes are not two pickaxes')
  assert.equal(mayDigForEscape([pick(0), pick(58)]), false,
    'one healthy and one spent leaves exactly one usable — still the last')
})

t('non-pickaxes are not counted', () => {
  assert.equal(mayDigForEscape([pick(), { name: 'wooden_axe', count: 5 },
                                { name: 'cobblestone', count: 64 }]), false)
})

t('a pickaxe with no durability metadata is counted as usable, not discarded', () => {
  // Erring the other way would refuse every escape on a server that does not
  // report durability, which is a different total outage.
  assert.equal(mayDigForEscape([{ name: 'stone_pickaxe', count: 1 },
                                { name: 'stone_pickaxe', count: 1 }]), true)
})

t('SOFT BLOCKS NEED NO TOOL, so digging through them is never refused', () => {
  // The first version refused all escape digging without a spare pickaxe, and
  // on the canary that turned two bots which were at least TRYING into two bots
  // doing nothing — 33 and 39 refusals, both stationary. Dirt, sand and gravel
  // break bare-handed; the pickaxe only matters for stone.
  for (const name of ['dirt', 'sand', 'gravel', 'grass_block', 'clay']) {
    assert.equal(mayDigForEscape([pick()], { name, boundingBox: 'block' }), true,
      `${name} breaks bare-handed and must not be refused`)
  }
})

t('stone still requires the spare, because that is what ends escapes', () => {
  assert.equal(mayDigForEscape([pick()], { name: 'stone', boundingBox: 'block' }), false)
  assert.equal(mayDigForEscape([pick(), pick()], { name: 'stone', boundingBox: 'block' }), true)
})

t('an unidentifiable ceiling is treated as needing the tool', () => {
  // Erring toward the stone case: that is the one that ends escapes permanently.
  assert.equal(mayDigForEscape([pick()], null), false)
})

t('air overhead is not a dig at all', () => {
  assert.equal(mayDigForEscape([pick()], { name: 'air', boundingBox: 'empty' }), true)
})

console.log(`  ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
