// SHIPPING A SKILL IS NOT THE SAME AS SHIPPING A CAPABILITY.
//
// "A capability is not shipped until the OBSERVATION names it" cost this
// project four failures in one day. `smelt` touches six components, and five of
// them fail SILENTLY when they are not updated -- there is no error, the verb
// simply never works or never gets picked:
//
//   1. minecraft-data ships no smelting table, so smelting.mjs carries a
//      hand-written one, and a typo in it is a permanent wrong smelt
//   2. SKILL_CONTRACTS -- a missing entry downgrades every success to `unknown`,
//      so the -1 side of the learned-avoid counter is dead while +1 still fires
//   3. AdmissionControl.#output -- returns null for any verb it does not know,
//      so smelt can never receive the milestone_critical exemption
//   4. cognitive.#wantedItems -- expands the milestone target through the
//      CRAFTING graph, which does not contain raw_iron
//   5. the TECH_LADDER rungs -- and their vacuous-satisfaction property, which
//      is the whole reason iron was kept off the ladder until now
//   6. the prompt usage line -- the model cannot emit what it is not told about
//
// Each is asserted by BEHAVIOUR here, and the two that can only be asserted
// structurally carry a mutant proving the assertion fails for the right reason.
import assert from 'node:assert'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { createRequire } from 'node:module'
import { SKILLS, SKILL_CONTRACTS, actionKey, classifyOutcome,
         equivalentTools, strictlyBetterTools } from '../src/skills.mjs'
import { fuelTicks, smeltInputsFor, smeltRecipeFor } from '../src/smelting.mjs'
import { SUSTAINING } from '../src/milestones.mjs'
import { AdmissionControl } from '../src/admission.mjs'
import { Lessons } from '../src/lessons.mjs'
import { buildSystemPrompt } from '../src/prompt.mjs'

let pass = 0, fail = 0
const t = (name, fn) => {
  try { fn(); pass++; console.log(`  PASS  ${name}`) }
  catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) }
}
const ta = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) }
  catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) }
}

// VERBATIM from test/climb-escape.test.mjs:447-458.
async function withMutant (path, old, neu, fn) {
  const src = readFileSync(path, 'utf8')
  assert.ok(src.includes(old),
    `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 60))} is not in ${path.pathname}. ` +
    'A mutant that was never written reads as killed.')
  assert.ok(src.split(old).length === 2, 'the mutation target is not unique; the mutant is ambiguous')
  const body = src.replace(old, neu).replace(/from '\.\//g, "from '../src/")
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, body)
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}

// --- 1. the hand-written table, against the registry the fleet actually loads ---

t('EVERY NAME IN THE SMELT TABLE IS A REAL 1.21.8 ITEM', () => {
  // smelting.mjs is hand-maintained because minecraft-data ships NO smelting
  // and NO fuel data for any version -- proven in that file's header. A
  // hand-written table's failure mode is a typo, and a typo here is a refusal
  // the bot can never satisfy. So the table is checked against the vendored
  // registry the bots connect with, which is the only thing that can catch it.
  const require = createRequire(import.meta.url)
  const items = require('minecraft-data/minecraft-data/data/pc/1.21.8/items.json')
  const names = new Set(items.map(i => i.name))

  // POSITIVE CONTROL FIRST. An empty or wrong registry would make every check
  // below vacuously pass, which is precisely the "cheap negative" this repo
  // keeps buying. Prove the instrument can both find and reject.
  assert.ok(names.size > 1000, `registry looks wrong: ${names.size} items`)
  assert.ok(names.has('iron_ingot'), 'control: the registry knows iron_ingot')
  assert.ok(!names.has('definitely_not_an_item'), 'control: the registry rejects nonsense')

  const probes = [
    'raw_iron', 'iron_ore', 'deepslate_iron_ore', 'raw_copper', 'copper_ore',
    'raw_gold', 'gold_ore', 'nether_gold_ore', 'ancient_debris', 'coal_ore',
    'redstone_ore', 'lapis_ore', 'diamond_ore', 'emerald_ore', 'nether_quartz_ore',
    'sand', 'red_sand', 'cobblestone', 'stone', 'cobbled_deepslate', 'clay_ball',
    'netherrack', 'cactus', 'wet_sponge', 'sea_pickle', 'chorus_fruit',
    'bamboo_block', 'porkchop', 'beef', 'chicken', 'mutton', 'rabbit', 'cod',
    'salmon', 'potato', 'kelp', 'oak_log', 'cherry_log', 'warped_stem',
  ]
  const bad = []
  for (const p of probes) {
    if (!names.has(p)) bad.push(`input not an item: ${p}`)
    const r = smeltRecipeFor(p)
    if (!r) { bad.push(`no recipe: ${p}`); continue }
    if (!names.has(r.output)) bad.push(`output not an item: ${p} -> ${r.output}`)
  }
  for (const f of ['coal', 'charcoal', 'coal_block', 'blaze_rod', 'dried_kelp_block',
                   'stick', 'bamboo', 'oak_planks', 'cherry_planks', 'oak_log']) {
    if (!names.has(f)) bad.push(`fuel not an item: ${f}`)
    if (!fuelTicks(f)) bad.push(`fuel burns for 0 ticks: ${f}`)
  }
  assert.deepEqual(bad, [], `${bad.length} of ${probes.length} probes bad:\n  ${bad.join('\n  ')}`)
})

t('charcoal proves the table cannot be replaced by the registry', () => {
  // This is the argument for the hand-written table, stated as a test rather
  // than as prose. charcoal has ZERO crafting recipes in 1.21.8, so it is
  // invisible to bot.recipesFor/recipesAll -- the mechanism drops.mjs uses.
  // There is nothing to read; the table is forced.
  const require = createRequire(import.meta.url)
  const items = require('minecraft-data/minecraft-data/data/pc/1.21.8/items.json')
  const recipes = require('minecraft-data/minecraft-data/data/pc/1.21.8/recipes.json')
  const id = n => items.find(i => i.name === n).id
  // Control: the recipe file is populated and this lookup works.
  assert.ok((recipes[id('furnace')] ?? []).length > 0, 'control: furnace HAS crafting recipes')
  assert.equal((recipes[id('charcoal')] ?? []).length, 0,
    'charcoal must have no crafting recipe, or the table has a cheaper alternative')
  assert.equal(smeltRecipeFor('oak_log').output, 'charcoal')
})

// --- 2. the contract -------------------------------------------------------

t('every callable skill has a contract, smelt included', () => {
  const missing = Object.keys(SKILLS).filter(n => !SKILL_CONTRACTS[n])
  assert.deepEqual(missing, [], `no contract: ${missing.join(', ')}`)
  // And it must be the RIGHT contract: only an inventory_gain is falsifiable.
  assert.deepEqual(classifyOutcome('smelt', 'success', { inventory: { iron_ingot: 2 } }).because,
                   ['inventory_gain: iron_ingot +2'])
  // Loading a furnace changes the world and produces no ingot. It must not score.
  assert.deepEqual(classifyOutcome('smelt', 'success', { placed: 1, inventory: {} }).because, [])
})

// --- 3. the admission gate -------------------------------------------------

const gateBot = () => ({
  registry: { blocksByName: {}, itemsByName: { raw_iron: { id: 1 }, iron_ingot: { id: 2 } } },
  entity: { position: { y: 70 } }, players: {}, inventory: { items: () => [] },
})

t('THE GATE MAY NOT SHUT THE ONLY ROUTE TO IRON', () => {
  // A brand-new verb is the worst case for the learned-avoid ratchet: no
  // record, four failures over the threshold, and -- without the exemption --
  // permanently vetoed before the fleet ever smelted once.
  const L = new Lessons('/tmp/test-smelt-lessons.json')
  const key = actionKey('smelt', { item: 'raw_iron', count: 1 })
  L.data.avoid[key] = { skill: 'smelt', args: { item: 'raw_iron', count: 1 },
                        fails: 99, classes: {}, last: Date.now() }
  const gate = new AdmissionControl(L)
  const proposal = { skill: 'smelt', args: { item: 'raw_iron', count: 1 } }

  // CONTROL: with no milestone wanting the output, a 99-fail action is vetoed.
  const cold = new AdmissionControl(L).check(proposal, gateBot(), null)
  assert.equal(cold.ok, false, 'control: an unwanted 99-fail smelt must be vetoed')
  assert.equal(cold.reason, 'learned_avoid')

  // And with the milestone wanting iron_ingot, it is admitted -- because the
  // only thing that can ever clear the rule is an attempt.
  const hot = gate.check(proposal, gateBot(), new Set(['iron_ingot']))
  assert.equal(hot.ok, true, `milestone_critical did not fire: ${JSON.stringify(hot)}`)
  assert.equal(hot.kind, 'milestone_critical')
  assert.ok(/iron_ingot/.test(hot.forced), hot.forced)
})

t('the avoid key is per-item, so one bad input cannot poison the verb', () => {
  // `args: []` would have collapsed every smelt failure onto `smelt:{}` -- the
  // defect that made `explore:{}` the most suppressed action in the system at
  // 35,304 vetoes.
  assert.notEqual(actionKey('smelt', { item: 'raw_iron', count: 1 }),
                  actionKey('smelt', { item: 'sand', count: 1 }))
  assert.ok(/raw_iron/.test(actionKey('smelt', { item: 'raw_iron', count: 1 })))
})

await ta('MUTANT KILLED: with #output blind to smelt, iron is vetoed forever',
  () => withMutant(new URL('../src/admission.mjs', import.meta.url),
    "    if (skill === 'smelt') return smeltRecipeFor(args?.item)?.output ?? null\n",
    '',
    m => {
      const L = new Lessons('/tmp/test-smelt-lessons2.json')
      L.data.avoid[actionKey('smelt', { item: 'raw_iron', count: 1 })] =
        { skill: 'smelt', args: { item: 'raw_iron', count: 1 }, fails: 99, classes: {}, last: Date.now() }
      const r = new m.AdmissionControl(L).check(
        { skill: 'smelt', args: { item: 'raw_iron', count: 1 } }, gateBot(), new Set(['iron_ingot']))
      assert.equal(r.ok, false,
        'the mutant must veto: without the smelt case #output returns null')
      assert.equal(r.reason, 'learned_avoid')
    }))

// --- 4. the wanted set -----------------------------------------------------

t('THE ORE COUNTS AS PROGRESS TOWARD THE INGOT', () => {
  // cognitive.#wantedItems seeds from the milestone target and expands through
  // bot.recipesAll -- the CRAFTING graph. iron_ingot's crafting graph is
  // iron_nugget and iron_block; it does NOT contain raw_iron, because the
  // furnace route is not a recipe the registry models. Without smeltInputsFor
  // in that set, a bot doing exactly the right thing -- mining down and
  // gathering the ore -- has its raw_iron scored `off-target gain`.
  assert.ok(smeltInputsFor('iron_ingot').includes('raw_iron'))

  // Behaviour, through the function that actually reads the set.
  const wanted = new Set(['iron_ingot', 'iron_nugget', ...smeltInputsFor('iron_ingot')])
  const withOre = classifyOutcome('gather', 'success', { inventory: { raw_iron: 3 } }, wanted)
  assert.equal(withOre.value, 'valuable', 'gathering the ore must be real progress')

  // CONTROL: the crafting-only set is what the defect looked like.
  const craftingOnly = new Set(['iron_ingot', 'iron_nugget', 'iron_block'])
  const without = classifyOutcome('gather', 'success', { inventory: { raw_iron: 3 } }, craftingOnly)
  assert.equal(without.value, 'neutral', 'control: without the smelt inputs it scores as busywork')
})

// --- 5. the ladder ---------------------------------------------------------

const bagBot = bag => ({
  inventory: { items: () => Object.entries(bag).map(([name, count]) => ({ name, count })) },
  entity: { position: { x: 0, y: 64, z: 0, distanceTo: () => 0 } },
})

t('THE IRON RUNGS EXIST', () => {
  const ids = SUSTAINING.map(r => r.id)
  assert.ok(ids.includes('smelt_iron_ingot_1'), `SUSTAINING is ${ids.join(', ')}`)
  assert.ok(ids.includes('craft_iron_pickaxe_1'), `SUSTAINING is ${ids.join(', ')}`)
  // Ordered after the furnace rung -- a bot is asked for the station before the
  // thing the station makes.
  assert.ok(ids.indexOf('craft_furnace_1') < ids.indexOf('smelt_iron_ingot_1'))
  assert.ok(ids.indexOf('smelt_iron_ingot_1') < ids.indexOf('craft_iron_pickaxe_1'))
})

t('AND THEY CANNOT COST A FAILED ATTEMPT, which is why iron was kept off', () => {
  // The note above TECH_LADDER refuses `gather iron_ore` because a well-equipped
  // bot with no ore would burn 25 attempts on it EVERY lap of SUSTAINING -- the
  // lap that produces the primary endpoint. These rungs must be VACUOUSLY
  // satisfied for exactly those bots, or the change breaks the rule it claims
  // to respect.
  const ingot = SUSTAINING.find(r => r.id === 'smelt_iron_ingot_1')
  const pick  = SUSTAINING.find(r => r.id === 'craft_iron_pickaxe_1')

  const naked = bagBot({})
  assert.equal(ingot.done(naked), true, 'a bot with nothing is DONE, not stuck')
  assert.equal(pick.done(naked), true, 'a bot with nothing is DONE, not stuck')

  // The well-equipped-but-oreless bot the note names by name.
  const equipped = bagBot({ stone_pickaxe: 1, crafting_table: 1, cobblestone: 64,
                            oak_planks: 32, stick: 16, furnace: 1, coal: 8 })
  assert.equal(ingot.done(equipped), true, 'no ore in hand: the rung must not bite')

  // Ore, furnace and fuel in hand: NOW it bites. A rung that never fires is
  // not a rung, so the negative above needs this positive beside it.
  const ready = bagBot({ raw_iron: 3, furnace: 1, coal: 1 })
  assert.equal(ingot.done(ready), false, 'with everything in hand the rung must fire')

  // And it completes the moment the ingot exists.
  assert.equal(ingot.done(bagBot({ iron_ingot: 1 })), true)

  // Same shape for the pickaxe.
  assert.equal(pick.done(bagBot({ iron_ingot: 3, stick: 2, crafting_table: 1 })), false)
  assert.equal(pick.done(bagBot({ iron_pickaxe: 1 })), true)
  assert.equal(pick.done(bagBot({ iron_ingot: 3, stick: 2 })), true, 'no table: vacuous')
})

t('the ingot rung tells the bot to SMELT, not to craft an impossible recipe', () => {
  const ingot = SUSTAINING.find(r => r.id === 'smelt_iron_ingot_1')
  assert.ok(/smelt with item=raw_iron/.test(ingot.hint), ingot.hint)
  assert.ok(!/craft item=iron_ingot/.test(ingot.hint),
    'there is no crafting recipe for an ingot; naming one is advice the model cannot take')
  assert.equal(ingot.wants, 'iron_ingot', 'wants drives the gate exemption and the value classifier')
})

t("milestones' fuel list and smelting.mjs cannot disagree silently", () => {
  // The ladder decides whether the iron rung is ACTIONABLE from its own FUELS
  // list; the skill decides what to burn from smelting.mjs. A name in one and
  // not the other would make the rung fire for a bot the skill then refuses.
  const ingot = SUSTAINING.find(r => r.id === 'smelt_iron_ingot_1')
  for (const f of ['coal', 'charcoal', 'oak_planks', 'oak_log']) {
    assert.ok(fuelTicks(f) > 0, `${f} is offered by the ladder but does not burn`)
    assert.equal(ingot.done(bagBot({ raw_iron: 1, furnace: 1, [f]: 1 })), false,
      `holding ${f} must make the rung actionable`)
  }
  // CONTROL: something that is not fuel must NOT make the rung actionable.
  assert.equal(ingot.done(bagBot({ raw_iron: 1, furnace: 1, dirt: 64 })), true,
    'control: dirt is not fuel, so the rung stays vacuous')
})

// --- 7. the bug that shipping smelt would otherwise un-dormant --------------

t('SMELT MUST NOT RESURRECT THE golden_pickaxe LIE', () => {
  // TOOL_RANK gives gold the SAME mining rank as wood, so equivalentTools --
  // correctly at-least-as-good, for the capability test M.craft needs -- returns
  // golden_pickaxe to a bot that asked for a wooden one. craftableAlternative
  // then calls it "strictly better", which is false.
  //
  // That was harmless only because it was unreachable: the branch is gated on
  // recipesFor, which checks the inventory, and no bot in this fleet's history
  // has ever held a gold ingot. raw_gold and gold_ore smelt to gold_ingot, so
  // adding this verb makes the branch routine. Fixing it is part of shipping.
  assert.ok(smeltRecipeFor('raw_gold'), 'gold is reachable through the furnace now')

  // The capability test keeps its at-least-as-good semantics: a golden pickaxe
  // really does satisfy "craft a wooden pickaxe", and M.craft depends on that.
  assert.ok(equivalentTools('wooden_pickaxe').includes('golden_pickaxe'),
    'the capability test must still accept a gold pickaxe for a wooden one')

  // THE REMEDY IS WRITTEN AND TESTED BUT NOT WIRED IN. craftableAlternative
  // still calls equivalentTools, because test/craftable-alternative.test.mjs:127
  // deliberately asserts the gold suggestion SHOULD fire, and gold is genuinely
  // the fastest-mining tier -- so overruling it is a real decision about
  // Minecraft tool semantics that belongs in its own review, not smuggled into
  // a change about furnaces. This test pins the remedy so it cannot rot while
  // it waits.
  assert.ok(strictlyBetterTools('wooden_pickaxe').includes('stone_pickaxe'), 'control')
  assert.ok(strictlyBetterTools('wooden_pickaxe').includes('iron_pickaxe'), 'control')
  assert.ok(!strictlyBetterTools('wooden_pickaxe').includes('golden_pickaxe'),
    'gold ties with wood on mining rank; calling it strictly better is a lie')
  assert.ok(!strictlyBetterTools('golden_pickaxe').includes('wooden_pickaxe'))
  assert.deepEqual(strictlyBetterTools('netherite_pickaxe'), [], 'nothing beats netherite')

  // And the CURRENT wiring is asserted as it actually is, so this file states
  // the live behaviour rather than the intended one.
  assert.ok(equivalentTools('wooden_pickaxe').includes('golden_pickaxe'),
    'craftableAlternative still uses the at-least-as-good list; this is the open item')
})

// --- 6. the prompt ---------------------------------------------------------

t('THE MODEL IS TOLD THE VERB EXISTS AND WHAT IT TAKES', () => {
  // A capability is not shipped until the observation names it. The schema enum
  // and the "Available skills" line both come from Object.keys(SKILLS), so the
  // model can EMIT smelt the moment it is registered -- the usage line is the
  // only thing that tells it what for.
  const names = Object.keys(SKILLS).filter(n => !SKILLS[n].chatOnly)
  assert.ok(names.includes('smelt'))
  const sys = buildSystemPrompt(names)
  assert.ok(/^\s+smelt\s+args:/m.test(sys), 'smelt has no usage line in the system prompt')
  assert.ok(/raw_iron/.test(sys), 'the prompt must name the input the bots are actually carrying')
  // The iron route has to be spelled out: `craft iron_pickaxe` is not something
  // the model can reason its way to, because the ingot is in no crafting recipe.
  assert.ok(/smelt item=raw_iron/.test(sys), 'the prompt must name the smelt route to iron')
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
