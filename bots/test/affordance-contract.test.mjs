// DOCUMENTED IS NOT DISCOVERABLE.
//
// prompt-usage-coverage.test.mjs asserts every selectable skill has a usage
// line. That caught `build`, `withdraw`, `explore` and `surface` being offered
// with no explanation -- and it is still not enough, because the next failure
// along happened four times in one day:
//
//   swim_to shipped documented, and was used ZERO times, because nothing in the
//   observation ever told the model it was in water.
//   The IN WATER line then shipped without a destination, and the model asked
//   for zero-block crossings with its own coordinates.
//   Tool equivalence surfaced the better pickaxe only inside a craft failure a
//   trapped bot never triggered; one sat entombed for ten hours carrying the
//   materials for its own rescue.
//   deposit_surplus was added to the milestone chain behind a rung requiring 15
//   blocks from home, when the median bot is 804 blocks away. Zero deposits.
//
// In all four the capability existed, was documented, and was silent -- and the
// silence was indistinguishable from the model declining to use it. So this file
// asserts the other half of the contract: for every skill that only applies in
// some states, a prompt rendered from a REAL bot in one of those states must
// name it, and a prompt rendered from a bot outside them must not.
//
// The negative half is not decoration. An observation line that is always on
// carries no information and costs tokens on every decision; `IN WATER` firing
// on dry land is the same defect as it never firing at all, wearing the opposite
// mask.
import assert from 'node:assert'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { SKILLS } from '../src/skills.mjs'
import { buildUserPrompt } from '../src/prompt.mjs'

const require_ = createRequire(import.meta.url)
const mcData = require_('minecraft-data')('1.21.8')
// REAL Vec3s. shoreRoute walks .offset() and depositSituation calls
// .distanceTo(); a plain {x,y,z} makes the fixture pass by not being a bot.
const Vec3 = require_('vec3')
const { Recipe } = require_('prismarine-recipe')('1.21.8')
const REG = JSON.parse(readFileSync(new URL('../src/affordances.json', import.meta.url)))

let pass = 0, fail = 0
const t = (name, fn) => {
  try { fn(); pass++; console.log(`  PASS  ${name}`) }
  catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) }
}

// --- canonical bot states ----------------------------------------------------
//
// Real enough to render a real prompt: an inventory-aware recipesFor, a blockAt
// that answers about the whole neighbourhood (shoreRoute walks rings of it), and
// a findBlock that can be told whether storage is in sight. Anything less and
// the fixture proves the fixture.

function botIn ({ block = 'stone', inv = {}, at = [633, 70, 276],
                  storageAt = null, food = 20 } = {}) {
  const pos = Vec3(at[0], at[1], at[2])
  const items = Object.entries(inv).map(([name, count], slot) => ({
    name, count, slot, type: mcData.itemsByName[name]?.id,
  }))
  const held = id => items.filter(i => i.type === Number(id)).reduce((t, i) => t + i.count, 0)
  const solid = block !== 'water' && block !== 'air'
  return {
    entity: { position: pos, isInWater: block === 'water' },
    health: 20, food, time: { day: 1, age: 1 },
    inventory: { items: () => items },
    registry: mcData,
    recipesFor: (id, meta, min, table) => Recipe.find(id, meta).filter(r => {
      if (r.requiresTable && !table) return false
      const need = {}
      for (const d of r.delta) if (d.count < 0) need[d.id] = (need[d.id] ?? 0) - d.count
      return Object.entries(need).every(([rid, n]) => held(rid) >= n)
    }),
    // Uniform terrain: whatever the bot is standing in, it is standing in it for
    // as far as any ring scan can see. That is what makes "open water with no
    // shore" a state a fixture can actually express.
    blockAt: (v) => ({ name: block, boundingBox: solid ? 'block' : 'empty',
                       position: v ?? pos, type: mcData.blocksByName[block]?.id }),
    findBlock: () => storageAt,
    findBlocks: () => [],
    entities: {},
    players: {},
  }
}

const render = (bot, memory = { locations: {}, events: [] }) => buildUserPrompt({
  bot, milestone: { describe: 'test', progress: '0/1' }, memory,
  lastOutcome: null, trigger: 'test', sentinel: 'x', lessons: [],
}).user

// The entombed bot's real inventory, and a bot carrying nothing makeable.
const CRAFTABLE = { cobbled_deepslate: 24, stick: 6, crafting_table: 99 }
const CHEST = { position: Vec3(640, 70, 280) }

const STATES = {
  in_water: {
    eligible: () => botIn({ block: 'water', at: [900, 62, 900] }),
    ineligible: () => botIn({ block: 'stone' }),
  },
  can_craft_stone_tier: {
    eligible: () => botIn({ inv: CRAFTABLE }),
    ineligible: () => botIn({ inv: { dirt: 3 } }),
  },
  can_smelt: {
    // The state 13 bots in this fleet are ACTUALLY IN right now: ore in the
    // pocket, a furnace in the pocket, coal in the pocket, and iron_ingot has
    // never once existed. Nothing in the prompt could tell them, because the
    // registry has no smelting recipe for CAN CRAFT NOW to find.
    eligible: () => botIn({ inv: { raw_iron: 5, furnace: 1, coal: 3 } }),
    // Ore and a furnace and NOTHING THAT BURNS. The line must stay silent: it
    // exists to say "you can do this now", and saying it to a bot that cannot
    // is the swim_to zero-block-crossing bug wearing the other mask.
    ineligible: () => botIn({ inv: { raw_iron: 5, furnace: 1 } }),
  },
  bankable_surplus: {
    // Carrying real output with a chest in sight: worth banking, cheaply.
    eligible: () => {
      const b = botIn({ inv: { oak_log: 32, cobblestone: 40, iron_ore: 6 } })
      b.findBlock = () => CHEST
      return b
    },
    // The same load 804 blocks from town with no storage in sight -- the median
    // bot. Advising a deposit here is advice it should not take.
    ineligible: () => botIn({ inv: { oak_log: 32, cobblestone: 40 },
                              at: [1437, 70, 276] }),
  },
}

// --- every selectable skill is accounted for ---------------------------------

const SELECTABLE = Object.keys(SKILLS).filter(n => !SKILLS[n].chatOnly)
const contracted = REG.contracts.map(c => c.skill)
const bucketed = new Set([...contracted, ...Object.keys(REG.unconditional), ...Object.keys(REG.gaps)])

t('every selectable skill is in exactly one bucket', () => {
  const missing = SELECTABLE.filter(n => !bucketed.has(n))
  assert.deepEqual(missing, [],
    `unaccounted for: ${missing.join(', ')}. Add a contract (an observation ` +
    `names when this applies), an unconditional entry with a reason, or a gap ` +
    `with a reason. A new skill defaults to invisible, and invisible reads as ` +
    `the model choosing not to use it.`)
  const counts = {}
  for (const n of [...contracted, ...Object.keys(REG.unconditional), ...Object.keys(REG.gaps)]) {
    counts[n] = (counts[n] ?? 0) + 1
  }
  const dup = Object.entries(counts).filter(([, c]) => c > 1).map(([n]) => n)
  assert.deepEqual(dup, [], `in more than one bucket: ${dup.join(', ')}`)
})

t('nothing is bucketed that the model cannot select', () => {
  const ghosts = [...bucketed].filter(n => !SELECTABLE.includes(n))
  assert.deepEqual(ghosts, [],
    `bucketed but not selectable: ${ghosts.join(', ')} — a stale entry here is ` +
    `a claim about an affordance that no longer exists`)
})

// --- the anti-paperwork clause ----------------------------------------------
//
// An opt-out list is only worth having if the opt-outs are arguable. "n/a" and
// "not needed" are how a coverage gate becomes a junk drawer, which is the named
// failure mode of this entire approach.
const ARGUABLE = 40
t('every opt-out gives a reason someone could disagree with', () => {
  const thin = []
  for (const [n, why] of Object.entries(REG.unconditional)) {
    if (String(why).length < ARGUABLE) thin.push(`unconditional.${n}`)
  }
  for (const [n, g] of Object.entries(REG.gaps)) {
    if (String(g.why ?? '').length < ARGUABLE) thin.push(`gaps.${n}.why`)
    if (!g.watch) thin.push(`gaps.${n}.watch`)
  }
  assert.deepEqual(thin, [],
    `these read as paperwork, not reasons: ${thin.join(', ')}`)
})

// --- the contracts themselves ------------------------------------------------

for (const c of REG.contracts) {
  const st = STATES[c.eligibility]

  t(`${c.skill}: a canonical eligible state exists`, () => {
    assert.ok(st, `no fixture for eligibility rule ${c.eligibility!==undefined?c.eligibility:''}`)
  })
  if (!st) continue

  t(`${c.skill}: THE OBSERVATION FIRES when the situation is real`, () => {
    const u = render(st.eligible())
    assert.ok(u.includes(c.observation),
      `a bot in the ${c.eligibility} state got no "${c.observation}" line. This ` +
      `is swim_to's zero-use bug exactly: the skill is documented, the state is ` +
      `real, and nothing connects them.\n--- prompt ---\n${u.slice(0, 700)}`)
  })

  t(`${c.skill}: the observation NAMES THE SKILL, not just the situation`, () => {
    const u = render(st.eligible())
    const line = u.split('\n').find(l => l.includes(c.observation)) ?? ''
    assert.ok(line.includes(c.skill),
      `"${c.observation}" describes the situation without naming ${c.skill}. ` +
      `Telling a bot it is in water without telling it what to do about it is ` +
      `what produced 0-block crossings.\n        ${line.trim().slice(0, 200)}`)
  })

  t(`${c.skill}: the observation is SILENT when it does not apply`, () => {
    const u = render(st.ineligible())
    assert.ok(!u.includes(c.observation),
      `"${c.observation}" appears for a bot that is not in the ${c.eligibility} ` +
      `state. An always-on line is not an observation, it is a preamble — and it ` +
      `costs tokens on every one of ~60 decisions per bot-hour.`)
  })
}

// --- the funnel's rules must exist -------------------------------------------

t('every contract names an eligibility rule the funnel implements', () => {
  const src = readFileSync(new URL('../../scripts/affordance-funnel.py', import.meta.url), 'utf8')
  const missing = REG.contracts.filter(c => !new RegExp(`["']${c.eligibility}["']`).test(src))
  assert.deepEqual(missing.map(c => c.eligibility), [],
    `scripts/affordance-funnel.py has no rule for: ${missing.map(c => c.eligibility).join(', ')}. ` +
    `The funnel measures eligibility from the LOGGED SNAPSHOT, deliberately not ` +
    `from the prompt renderer — two independent sources, so their disagreement ` +
    `is visible. A contract with no rule is a contract nothing checks in flight.`)
})

console.log(`  ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
