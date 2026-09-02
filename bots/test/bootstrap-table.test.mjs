// A GATE MUST ASK THE QUESTION THE SKILL WILL ANSWER.
//
// admission.mjs's bootstrap exemption exists so that a bot holding no pickaxe
// at all is never hard-blocked from making its first one. It guarded itself
// with `recipesFor(wooden_pickaxe, null, 1, null)` -- passing `null` for
// mineflayer's fourth argument, `craftingTable`. requirementsMetForRecipe
// (mineflayer/lib/plugins/craft.js:224) opens with
//
//     if (recipe.requiresTable && !craftingTable) return false
//
// and ALL TWELVE wooden_pickaxe recipes have requiresTable = true. So the guard
// returned [] on every call it ever made and the exemption never once fired in
// production. The number is asserted below against real minecraft-data, with a
// positive control -- crafting_table, stick and oak_planks DO have table-free
// recipes -- because a count of zero from a query that cannot return anything
// else is not a measurement.
//
// The fix has two halves and needs both:
//
//   `true` for the table argument, because the craft skill will walk to a
//   table, place one from the pack, or MAKE one and place it;
//
//   tableRoute() to check it actually can, because a blanket `true` is the
//   3f1e942 regression -- 160 craft calls, 150 missing_ingredients, crafting
//   output down from 37 successes in 69 bot-hours to 1 in 27.
//
// The stub in gate-deadlock.test.mjs is `recipesFor: () => [{id:1}]`, which
// IGNORES ITS ARGUMENTS and therefore could never have seen this. Everything
// here runs against real recipes and a real inventory-aware recipesFor.
import assert from 'node:assert'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { createRequire } from 'node:module'

process.env.LOG_DIR = process.env.LOG_DIR || '/tmp/mcbot-test-logs-bootstrap'
process.env.BOT_NAME = process.env.BOT_NAME || 'BootstrapBot'

const require_ = createRequire(import.meta.url)
const mcData = require_('minecraft-data')('1.21.8')
const { Recipe } = require_('prismarine-recipe')('1.21.8')

const { AdmissionControl, tableRoute, recipeCost, affordsBootstrap, heldCounts } =
  await import('../src/admission.mjs')
const { Lessons } = await import('../src/lessons.mjs')
const { actionKey } = await import('../src/skills.mjs')

let pass = 0, fail = 0
const t = (name, fn) => {
  try { fn(); pass++; console.log(`  PASS  ${name}`) }
  catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) }
}
const ta = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) }
  catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) }
}

// --- the premise, measured rather than asserted from memory -----------------

t('all twelve wooden_pickaxe recipes require a table (and the control finds table-free ones)', () => {
  const count = name => {
    const rs = Recipe.find(mcData.itemsByName[name].id, null)
    return { total: rs.length, needsTable: rs.filter(r => r.requiresTable).length }
  }
  const pick = count('wooden_pickaxe')
  assert.equal(pick.total, 12, 'the recipe count moved; the comment in admission.mjs says twelve')
  assert.equal(pick.needsTable, 12, 'if any were table-free the old guard could have worked')
  // POSITIVE CONTROL. The same query, on the items this fix depends on being
  // table-free, must find table-free recipes -- otherwise `needsTable === total`
  // above proves nothing but a broken query.
  for (const [name, want] of [['crafting_table', 12], ['stick', 13], ['oak_planks', 1]]) {
    const c = count(name)
    assert.equal(c.total, want, `${name} recipe count moved`)
    assert.equal(c.needsTable, 0, `${name} must be craftable with no table, or the whole route is fiction`)
  }
})

// --- a bot with real recipe semantics ---------------------------------------

/** @param inv {name:count}  @param tableOnGround does findBlock see a table? */
function botWith (inv, { tableOnGround = false } = {}) {
  const items = Object.entries(inv).map(([name, count], slot) => ({
    name, count, slot, type: mcData.itemsByName[name]?.id,
  }))
  const held = id => items.filter(i => i.type === Number(id)).reduce((t, i) => t + i.count, 0)
  return {
    entity: { position: { x: 0, y: 70, z: 0 } },
    health: 20, food: 20, players: {},
    inventory: { items: () => items },
    registry: mcData,
    // Mineflayer's requirementsMetForRecipe, reproduced exactly -- including the
    // table check that the old guard tripped over.
    recipesFor: (id, meta, min, table) => Recipe.find(id, meta).filter(r => {
      if (r.requiresTable && !table) return false
      const need = {}
      for (const d of r.delta) if (d.count < 0) need[d.id] = (need[d.id] ?? 0) - d.count
      return Object.entries(need).every(([rid, n]) => held(rid) >= n)
    }),
    findBlock: () => (tableOnGround ? { position: { x: 2, y: 70, z: 0 }, type: 1 } : null),
    findBlocks: () => [],
    blockAt: () => ({ name: 'stone', boundingBox: 'block' }),
  }
}

// The measured modal blocked bot, from the craft skill's own comment:
//     Miner01   4 oak_log, 14 oak_planks, 5 stick   -- and no table
const MODAL = { oak_log: 4, oak_planks: 14, stick: 5 }

// --- tableRoute: the question the first draft did not ask -------------------

t('a table on the ground is reachable', () =>
  assert.equal(tableRoute(botWith(MODAL, { tableOnGround: true })), 'reach'))
t('a table in the pack is placeable', () =>
  assert.equal(tableRoute(botWith({ ...MODAL, crafting_table: 1 })), 'pack'))
t('THE MODAL BOT: no table anywhere, but it can make one', () =>
  assert.equal(tableRoute(botWith(MODAL)), 'craft',
    'this is the bot the narrow "do I have a table" check refused'))
t('a bot with no planks has no route to a table', () =>
  assert.equal(tableRoute(botWith({ stick: 24 })), null))
t('a bot holding raw logs only cannot make a table THIS INSTANT', () =>
  assert.equal(tableRoute(botWith({ oak_log: 4 })), null,
    'the craft skill would sub-craft planks first; the gate deliberately does not model that'))
t('a bot with a broken registry gets null, not a throw', () =>
  assert.equal(tableRoute({}), null))

// --- affordsBootstrap: two recipes, one inventory ---------------------------

t('the table is free when it is already placed or in the pack', () =>
  assert.equal(affordsBootstrap({ oak_planks: 3, stick: 2 },
    [{ oak_planks: 3, stick: 2 }], null), true))
t('but not free when it must be crafted from the same planks', () =>
  assert.equal(affordsBootstrap({ oak_planks: 4, stick: 2 },
    [{ oak_planks: 3, stick: 2 }], [{ oak_planks: 4 }]), false,
    '4 planks pays for the pickaxe OR the table, and recipesFor prices each alone'))
t('seven planks pays for both', () =>
  assert.equal(affordsBootstrap({ oak_planks: 7, stick: 2 },
    [{ oak_planks: 3, stick: 2 }], [{ oak_planks: 4 }]), true))
t('the woods need not match: any table recipe will do', () =>
  assert.equal(affordsBootstrap({ oak_planks: 3, birch_planks: 4, stick: 2 },
    [{ oak_planks: 3, stick: 2 }], [{ oak_planks: 4 }, { birch_planks: 4 }]), true))
t('no affordable pickaxe recipe means no exemption', () =>
  assert.equal(affordsBootstrap({ oak_planks: 99 }, [], [{ oak_planks: 4 }]), false))
// An unpriceable cost is PAYABLE: mineflayer already said the recipe is
// satisfiable alone, and with no data about the interaction there are no
// grounds for an extra refusal. The failure direction matters -- if this
// returned false, a registry without an `items` map would silently restore the
// original bug of an exemption that never fires.
t('an unpriceable recipe does not manufacture a refusal', () =>
  assert.equal(affordsBootstrap({ oak_planks: 1 }, [null], [null]), true))

t('recipeCost prices a real crafting_table at four planks', () => {
  const r = Recipe.find(mcData.itemsByName.crafting_table.id, null)
    .find(x => x.delta.some(d => d.count < 0 && mcData.items[d.id]?.name === 'oak_planks'))
  assert.deepEqual(recipeCost(r, mcData), { oak_planks: 4 })
})
t('recipeCost returns null when it cannot name an ingredient', () =>
  assert.equal(recipeCost({ delta: [{ id: 999999, count: -1 }] }, mcData), null))
t('heldCounts sums stacks of the same item', () =>
  assert.deepEqual(heldCounts({ inventory: { items: () => [
    { name: 'oak_planks', count: 30 }, { name: 'oak_planks', count: 14 }] } }),
    { oak_planks: 44 }))

// --- the exemption itself, through the real gate ----------------------------

const CRAFT_PICK = { skill: 'craft', args: { item: 'wooden_pickaxe' }, reason: 'x' }

// A REAL LESSONS STORE, not a failCount stub that answers 40 to everything.
//
// The first draft of the chain test below used such a stub and "proved" that
// the one-step remedy was blocked too -- which was an artifact of the
// instrument, exactly the class of wrong finding CLAUDE.md is mostly about.
// With a real store only the key that actually failed is blocked, which is the
// condition the live fleet is in.
let seq = 0
function blockedStore () {
  const L = new Lessons(`/tmp/mcai-bootstrap-${process.pid}-${seq++}.json`)
  L.data.avoid = {}
  L.data.worked = {}
  L.data.avoid[actionKey('craft', { item: 'wooden_pickaxe' })] = {
    skill: 'craft', args: { item: 'wooden_pickaxe' },
    fails: 40, classes: { missing_ingredients: 40 }, since: Date.now(), last: Date.now(),
  }
  return L
}
function blockedGate () { return new AdmissionControl(blockedStore()) }
const bootstraps = bot => {
  const r = blockedGate().check(CRAFT_PICK, bot, null)
  return r.ok === true && r.kind === 'bootstrap'
}

t('THE CASE THAT HAS NEVER FIRED: the modal bot is admitted', () =>
  assert.equal(bootstraps(botWith(MODAL)), true,
    'planks, sticks, no table -- it can make the table; the veto was the last door'))
t('a table in the pack works too', () =>
  assert.equal(bootstraps(botWith({ ...MODAL, crafting_table: 1 })), true))
t('a table on the ground works too', () =>
  assert.equal(bootstraps(botWith(MODAL, { tableOnGround: true })), true))

// The 3f1e942 regression, in both of its shapes. These are the assertions that
// must stay red-if-widened, so each gets a mutant below.
t('THE REGRESSION: a bot with no wood at all is still refused', () =>
  assert.equal(bootstraps(botWith({ dirt: 64, stick: 24 })), false,
    'a blanket exemption cost 150 missing_ingredients failures out of 160 craft calls'))
t('and a bot that can pay for the table OR the pickaxe but not both', () =>
  assert.equal(bootstraps(botWith({ oak_planks: 4, stick: 2 })), false))
t('one more plank and it can pay for both', () =>
  assert.equal(bootstraps(botWith({ oak_planks: 7, stick: 2 })), true))
t('a bot that already holds a pickaxe takes no bootstrap door', () =>
  assert.equal(bootstraps(botWith({ ...MODAL, stone_pickaxe: 1 })), false))

// --- THE REFUSAL CHAIN, not the single guard --------------------------------
//
// CLAUDE.md: a new refusal must name a remedy that is EXECUTABLE from here,
// REACHABLE, and COMPOSED. The bot the gate now refuses is the logs-only one,
// so that is the chain to walk. Every trap this repo has shipped passed its own
// unit test and died where two correct guards met.

t('CHAIN 1/3 executable: the refused bot can still craft the planks it lacks', () => {
  const bot = botWith({ oak_log: 4 })
  assert.equal(bootstraps(bot), false, 'precondition: this is the bot we refused')
  // oak_planks needs no table and is a DIFFERENT avoid key, so the veto that
  // blocked wooden_pickaxe cannot reach it.
  const gate = blockedGate()
  const r = gate.check({ skill: 'craft', args: { item: 'oak_planks' }, reason: 'x' }, bot, null)
  assert.ok(r.ok, `the one-step remedy is itself blocked: ${r.reason} ${r.detail ?? ''}`)
  assert.ok(bot.recipesFor(mcData.itemsByName.oak_planks.id, null, 1, null).length > 0,
    'and the remedy is executable from where it stands -- no table, no walk')
})

t('CHAIN 2/3 reachable: probation still opens the door every fifth attempt', () => {
  // Advice printed is not advice taken, so the way out must not depend on the
  // model reading anything. Probation is deterministic: n % 5 === 0 falls
  // through the learned_avoid branch entirely.
  const ac = blockedGate()
  const bot = botWith({ oak_log: 4 })
  const outcomes = []
  for (let i = 0; i < 10; i++) outcomes.push(ac.check(CRAFT_PICK, bot, null).ok)
  assert.ok(outcomes.some(Boolean),
    'ten attempts and not one door: the exemption has closed the last one')
})

t('CHAIN 3/3 composed: the milestone exemption still outranks the gate', () => {
  // milestone_critical is checked BEFORE the bootstrap exemption, so a bot whose
  // current milestone names the pickaxe is admitted whatever this fix decides.
  const bot = botWith({ oak_log: 4 })
  const r = blockedGate().check(CRAFT_PICK, bot, ['wooden_pickaxe'])
  assert.ok(r.ok, 'the milestone-critical door must not have been narrowed')
  assert.equal(r.kind, 'milestone_critical')
})

// --- MUTANTS ----------------------------------------------------------------
//
// withMutant, verbatim from bots/test/climb-escape.test.mjs:447. It writes a
// SEPARATE _mutant-<pid>-<rand>.mjs and never touches src/. The previous
// attempt at this work overwrote bots/src/*.mjs in place and restored in a
// `finally` -- and scripts/run-tests.mjs kills a slow file with SIGKILL, which
// is uncatchable, so the restore never ran and a permanently mutated
// placeMoved() was left on disk. With fleet-recycle restarting every bot onto
// $H/src every six hours, that is a fleet hazard, not a test-hygiene nit.
const ADMISSION_PATH = new URL('../src/admission.mjs', import.meta.url)

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

const bootstrapsWith = (mod, bot) => {
  const ac = new mod.AdmissionControl(blockedStore())
  const r = ac.check(CRAFT_PICK, bot, null)
  return r.ok === true && r.kind === 'bootstrap'
}

await ta('MUTANT KILLED: craftingTable=null makes the exemption unreachable again', async () => {
  await withMutant(ADMISSION_PATH,
    'const picks = bot.recipesFor?.(def.id, null, 1, true) ?? []',
    'const picks = bot.recipesFor?.(def.id, null, 1, null) ?? []',
    async mod => assert.equal(bootstrapsWith(mod, botWith(MODAL)), false,
      'the modal-bot assertion above would pass even with the original bug'))
})

await ta('MUTANT KILLED: without the craft route, the modal bot is refused', async () => {
  // This is exactly the first draft's narrowness: count tables, do not ask
  // whether one can be made.
  await withMutant(ADMISSION_PATH,
    "if (t && (bot.recipesFor?.(t.id, null, 1, null) ?? []).length > 0) return 'craft'",
    "if (false) return 'craft'",
    async mod => {
      assert.equal(mod.tableRoute(botWith(MODAL)), null)
      assert.equal(bootstrapsWith(mod, botWith(MODAL)), false,
        'the modal-bot assertion is what distinguishes this fix from the rejected one')
    })
})

await ta('MUTANT KILLED: skipping joint affordability re-admits the doomed bot', async () => {
  await withMutant(ADMISSION_PATH,
    "        if (route !== 'craft') return true",
    '        return true',
    async mod => assert.equal(bootstrapsWith(mod, botWith({ oak_planks: 4, stick: 2 })), true,
      'the 4-plank assertion above would pass for the wrong reason'))
})

await ta('MUTANT KILLED: dropping the route check restores the blanket exemption', async () => {
  await withMutant(ADMISSION_PATH,
    '        const route = tableRoute(bot)\n        if (!route) return false',
    '        const route = tableRoute(bot)',
    async mod => assert.equal(bootstrapsWith(mod, botWith({ oak_planks: 99, stick: 99 })), true,
      'a bot with planks and no possible table must be refused for THIS reason'))
})

console.log(`\n  ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
