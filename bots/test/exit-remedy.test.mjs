/**
 * THE EXIT CONTRACT REFUSES FOR THREE REASONS AND ANSWERED ONE.
 *
 * The brief for this file asked for a NEW refusal: require a pickaxe before
 * descending. That refusal already exists, twice, and this file pins both so
 * nobody adds a third:
 *
 *   - `mine` refuses outright, before its loop, if no pickaxe is carried and
 *     the target is more than two blocks down (skills.mjs, failClass
 *     missing_tool). Admission refuses the same proposal earlier still.
 *   - `canContinueDescent` demands `debt + 2 + pickReserve` pickaxe SWINGS
 *     before EVERY tread. With an empty inventory that is unsatisfiable at any
 *     depth, including above sea level where the reserve is zero and the bare
 *     `+ 2` still bites.
 *
 * What was actually missing is the REMEDY. The abort site read
 *
 *     need: exit.reason === 'scaffold' ? scaffoldPrereqFor(exit) : undefined
 *
 * so a descent stopped for a TOOL adopted no prerequisite at all, and the prose
 * it did get said "Run surface now, or gather blocks before going deeper."
 * That is the wrong remedy told to the bot for whom it is most wrong, and it is
 * a bug this repo has already documented one layer over -- climbPrereqFor's
 * comment reads "Answering it with 'gather blocks' sends a bot that is short a
 * TOOL to go and fetch gravel."
 *
 * THIS ADDS NO REFUSAL, which is the property that makes it safe. Four traps in
 * this project were two individually-correct guards meeting where the bot had
 * no legal move; a change that only rewrites the advice attached to an existing
 * refusal cannot make one. The bot's legal moves are identical before and after,
 * and there is a test below that says so.
 */
import assert from 'node:assert'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { canContinueDescent, SEA_LEVEL } from '../src/exit-contract.mjs'
import { SKILLS, exitPrereqFor, exitAdviceFor } from '../src/skills.mjs'
import { V } from './helpers/microworld.mjs'

let pass = 0, fail = 0
const t = (name, fn) => Promise.resolve()
  .then(fn)
  .then(() => { pass++; console.log(`  PASS  ${name}`) })
  .catch(e => { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) })

const SKILLS_PATH = new URL('../src/skills.mjs', import.meta.url)

// VERBATIM from climb-escape.test.mjs:447-458.
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

const dirt = n => ({ name: 'dirt', count: n })
const pick = (name, used, max) => ({ name, count: 1, durabilityUsed: used, maxDurability: max })

// --- what the contract already does, pinned ---------------------------------

await t('POSITIVE CONTROL — a fully equipped bot is admitted at every depth', () => {
  // Every "always refused" claim below is a negative. This is the same sweep
  // returning a presence: without it, a contract that refused unconditionally
  // would make all of them pass for the wrong reason.
  const kit = [{ name: 'cobblestone', count: 320 }, pick('netherite_pickaxe', 0, 2031)]
  let ok = 0
  for (let y = 320; y >= -59; y -= 7) if (canContinueDescent({ y, health: 20, items: kit }).ok) ok++
  assert.ok(ok >= 50, `only ${ok} depths admitted; the sweep is not reaching the ok branch`)
})

await t('THE TOOL REQUIREMENT ALREADY EXISTS: no pickaxe is refused at every depth', () => {
  // Including above sea level, where debt is 0 and the reserve is 0 -- the bare
  // `+ 2` for the dig itself still refuses. This is why the brief's fix is
  // redundant, and it is pinned rather than asserted in prose.
  const blocks = [{ name: 'cobblestone', count: 320 }]
  for (let y = 320; y >= -59; y -= 7) {
    const r = canContinueDescent({ y, health: 20, items: blocks })
    assert.equal(r.ok, false, `a toolless bot was admitted at y=${y}`)
    assert.equal(r.reason, 'pickaxe',
      `at y=${y} the refusal was ${r.reason}, so this sweep is not testing the tool`)
  }
})

await t('a pickaxe one swing from breaking counts as no pickaxe', () => {
  // The discounted-swing rule in pickaxeUses. This is the state that produces
  // the refusal the remedy is for: `mine`'s own precondition sees a pickaxe in
  // the inventory and waves it through, and the contract then says no.
  const r = canContinueDescent({ y: 64, health: 20,
                                 items: [dirt(64), pick('stone_pickaxe', 130, 131)] })
  assert.equal(r.ok, false)
  assert.equal(r.reason, 'pickaxe')
  assert.equal(r.have, 0)
})

await t('REGRESSION PIN 2ec9df5 — a reserve may not exceed the climb it insures', () => {
  // Nothing in this change touches canContinueDescent, and this is the table
  // from that commit message, re-derived. If a later "require a tool" patch
  // reaches into the arithmetic, this is what catches it.
  const shortfall = (y, blocks, uses) => canContinueDescent({
    y, health: 20,
    items: [{ name: 'cobblestone', count: blocks }, pick('netherite_pickaxe', 2031 - uses - 1, 2031)],
  })
  // debt 1 -> 2 blocks, 4 uses.  debt 4 -> 8 and 10.  debt 48 -> 60 and 62.
  for (const [debt, wantBlocks, wantUses] of [[1, 2, 4], [4, 8, 10], [8, 16, 18],
                                              [12, 20, 26], [48, 60, 62]]) {
    const y = SEA_LEVEL - debt
    assert.equal(shortfall(y, wantBlocks - 1, 9999).want, wantBlocks,
      `blockReserve moved at debt ${debt}`)
    assert.equal(shortfall(y, 9999, wantUses - 1).want, wantUses,
      `pickReserve moved at debt ${debt}`)
    assert.equal(shortfall(y, wantBlocks, wantUses).ok, true,
      `exactly the priced amount is refused at debt ${debt}`)
  }
})

// --- the remedy, as a pure function -----------------------------------------

await t('a TOOL shortfall asks for a TOOL', () => {
  const need = exitPrereqFor({ ok: false, reason: 'pickaxe', debt: 43, have: 0, want: 57 })
  assert.ok(need, 'a pickaxe refusal still adopts no prerequisite')
  assert.ok(need.items.every(i => /_pickaxe$/.test(i)),
    `the tool shortfall asks for ${need.items.join('/')}`)
  assert.equal(need.count, 1)
  assert.ok(need.items.includes('wooden_pickaxe'), 'the only rung a toolless bot can actually reach')
  assert.ok(!/gather \d+ blocks/i.test(need.describe),
    `the tool remedy still says "${need.describe}"`)
})

await t('a BLOCK shortfall still asks for blocks, unchanged', () => {
  const need = exitPrereqFor({ ok: false, reason: 'scaffold', debt: 43, have: 3, want: 54 })
  assert.equal(need.count, 51)
  assert.ok(need.items.includes('cobblestone') && need.items.includes('dirt'))
  assert.ok(!need.items.some(i => /_pickaxe$/.test(i)))
  // The Math.max(8, ...) floor, preserved.
  assert.equal(exitPrereqFor({ ok: false, reason: 'scaffold', have: 15, want: 16 }).count, 8)
})

await t('health invents no shopping list', () => {
  // The bus fetches ITEMS. There is no item whose acquisition is "wait", and
  // one invented here would send a hurt bot mining.
  assert.equal(exitPrereqFor({ ok: false, reason: 'health', debt: 4 }), undefined)
})

await t('NO REFUSAL, NO REMEDY — a passing contract never adopts a prerequisite', () => {
  // The property that makes this change incapable of creating a trap: it only
  // ever speaks where the descent was already stopped.
  assert.equal(exitPrereqFor({ ok: true, debt: 43, blocks: 128, uses: 249 }), undefined)
  assert.equal(exitPrereqFor(undefined), undefined)
  assert.equal(exitAdviceFor({ ok: true, debt: 0 }), '')
  assert.equal(exitAdviceFor(null), '')
})

await t('the tool advice does not tell a tool-short bot to gather blocks', () => {
  const a = exitAdviceFor({ ok: false, reason: 'pickaxe', have: 0, want: 57 })
  assert.ok(/pickaxe/.test(a), `advice was "${a}"`)
  assert.ok(!/gather/i.test(a), `advice still sends it for blocks: "${a}"`)
  // And the block case is untouched.
  assert.ok(/gather blocks/i.test(exitAdviceFor({ ok: false, reason: 'scaffold' })))
})

// --- the CHAIN, not the guard ------------------------------------------------

/**
 * Stone below y=64, a bot standing on it holding plenty of scaffold and a
 * pickaxe with `swings` usable swings left. This is the exact live state: the
 * tool exists, so `mine`'s own missing_tool precondition passes, and the exit
 * contract then refuses on durability.
 */
function minerWith (swings, { y = 64 } = {}) {
  const carved = new Set()
  const k = (x, a, z) => `${x},${a},${z}`
  const blockAt = p => (carved.has(k(p.x, p.y, p.z)) ? { name: 'air', boundingBox: 'empty' }
                        : p.y < 64 ? { name: 'stone', boundingBox: 'block' }
                        : { name: 'air', boundingBox: 'empty' })
  const bot = {
    entity: { position: new V(200, y, 200), yaw: 0 },
    health: 20, food: 20, oxygenLevel: 300,
    heldItem: { type: 1 },
    blockAt: p => ({ ...blockAt(p), position: new V(p.x, p.y, p.z), canHarvest: () => true,
                     digTime: () => 100, harvestTools: undefined, material: 'rock' }),
    inventory: { items: () => [
      pick('stone_pickaxe', 131 - swings - 1, 131),
      { name: 'cobblestone', count: 512 },
    ] },
    equip: async () => {},
    dig: async b => { carved.add(k(b.position.x, b.position.y, b.position.z)) },
    // A pathfinder that only moves the bot when there is somewhere to move to,
    // and that swings the yaw the way a real one does. Same shape as
    // mine-staircase.test.mjs, because a fixture that teleports on demand
    // cannot tell a descent that worked from one that stood still.
    pathfinder: {
      goto: async goal => {
        const at = new V(goal.x, goal.y, goal.z)
        if (blockAt(at).name !== 'air' || blockAt(at.offset(0, 1, 0)).name !== 'air') return
        bot.entity.position = at
        bot.entity.yaw += 0.9
      },
      setGoal: () => {}, stop: () => {},
    },
    setControlState: () => {}, clearControlStates: () => {},
    registry: { blocksByName: {}, itemsByName: {} }, players: {},
  }
  return bot
}

const runMine = (bot, y) => SKILLS.mine.run({ bot }, { y }, new AbortController().signal)

await t('CHAIN: mine -> exit contract -> the prerequisite the bot is actually short of', async () => {
  // One swing left: past mine's missing_tool precondition, into the loop,
  // refused by the contract on the FIRST iteration before any dig.
  const r = await runMine(minerWith(1), 52)
  assert.equal(r.status, 'failed')
  assert.equal(r.failClass, 'exit_capability_reserve', `got ${r.failClass}: ${r.detail}`)
  assert.ok(r.need, 'the refusal reached the model with no prerequisite at all')
  assert.ok(r.need.items.every(i => /_pickaxe$/.test(i)),
    `the bot is short a tool and was sent for ${r.need.items.join('/')}`)
  assert.ok(!/gather \d+ blocks/i.test(r.detail), `detail still says: ${r.detail}`)
  assert.ok(/pickaxe/.test(r.detail))
})

await t('CHAIN: the same refusal for BLOCKS still asks for blocks', async () => {
  const bot = minerWith(200)
  bot.inventory.items = () => [pick('diamond_pickaxe', 0, 1561), { name: 'cobblestone', count: 2 }]
  const r = await runMine(bot, 52)
  assert.equal(r.failClass, 'exit_capability_reserve', `got ${r.failClass}: ${r.detail}`)
  assert.ok(r.need.items.includes('cobblestone'))
  assert.ok(!r.need.items.some(i => /_pickaxe$/.test(i)))
})

await t('CHAIN: THE REMEDY MUST NOT REPLACE A REFUSAL THE BOT CAN ALREADY PASS', async () => {
  // The trap this project keeps building is a guard that leaves a bot with no
  // legal move. This change adds no guard: a bot that could descend before
  // still descends, and is told nothing.
  const r = await runMine(minerWith(200), 54)
  assert.equal(r.status, 'success', `got ${r.status}: ${r.detail}`)
  assert.equal(r.need, undefined, 'a successful descent adopted a prerequisite')
})

await t('CHAIN: a toolless bot is refused EARLIER, and that refusal is unchanged', async () => {
  // The remedy above is for the durability case. A bot carrying no pickaxe at
  // all never reaches the contract -- it is stopped by mine's own precondition,
  // which already names the recipe. Nothing here moved it.
  const bot = minerWith(200)
  bot.inventory.items = () => [{ name: 'cobblestone', count: 512 }]
  const r = await runMine(bot, 52)
  assert.equal(r.failClass, 'missing_tool', `got ${r.failClass}: ${r.detail}`)
  assert.ok(/craft a wooden_pickaxe/.test(r.detail))
})

// --- mutants ----------------------------------------------------------------

await t('MUTANT KILLED: the old ternary — a tool shortfall adopts nothing', async () => {
  await withMutant(SKILLS_PATH,
    '        need: exitPrereqFor(exit),',
    "        need: exit.reason === 'scaffold' ? exitPrereqFor(exit) : undefined,",
    async mod => {
      const r = await mod.SKILLS.mine.run({ bot: minerWith(1) }, { y: 52 },
                                          new AbortController().signal)
      assert.equal(r.failClass, 'exit_capability_reserve', `got ${r.failClass}: ${r.detail}`)
      assert.equal(r.need, undefined,
        'the mutant still produced a prerequisite; the wiring test proves nothing')
    })
})

await t('MUTANT KILLED: the old one-size advice — "gather blocks" to a tool-short bot', async () => {
  await withMutant(SKILLS_PATH,
    '                `${exit.detail}.${exitAdviceFor(exit)}`,',
    '                `${exit.detail}. Run surface now, or gather blocks before going deeper.`,',
    async mod => {
      const r = await mod.SKILLS.mine.run({ bot: minerWith(1) }, { y: 52 },
                                          new AbortController().signal)
      assert.ok(/gather blocks/i.test(r.detail),
        'the mutant did not restore the old advice; this test is not exercising it')
    })
})

await t('MUTANT KILLED: the tool branch handing back the block list', async () => {
  // The historical shape of this bug, written out: a pickaxe shortfall answered
  // with cobblestone. It has to fail loudly, not read as a near-miss.
  await withMutant(SKILLS_PATH,
    "      items: ['wooden_pickaxe', 'stone_pickaxe', 'iron_pickaxe', 'diamond_pickaxe'],\n      count: 1,\n      describe: 'Get a pickaxe before descending further",
    "      items: ['cobblestone', 'dirt'],\n      count: 1,\n      describe: 'Get a pickaxe before descending further",
    async mod => {
      const need = mod.exitPrereqFor({ ok: false, reason: 'pickaxe', have: 0, want: 57 })
      assert.ok(!need.items.every(i => /_pickaxe$/.test(i)),
        'the mutant did not apply where the assertion looks')
    })
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
