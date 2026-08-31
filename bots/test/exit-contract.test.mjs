// NEVER SPEND THE EXIT.
//
// Two bots became permanently unrecoverable on 2026-08-23. The full chain for
// isolated-a-Alpha, verified against the server rather than inferred:
//
//   lost its last pickaxe at y=-4 at 05:03, kept working, ended sealed at y=2
//   carries cobbled_deepslate 24, stick 6, crafting_table 64
//   craft stone_pickaxe  -> "no recipe available; place the crafting_table first"
//   place crafting_table -> "nowhere to place: no solid block with a free space
//                            above it within reach"
//   cannot dig that space, because it has no pickaxe
//
// `mine` ALREADY refused to descend without a pickaxe, and that check PASSED.
// The capability EXPIRED mid-task. Nothing re-checked it. That is the entire
// defect: a precondition tested once is not a contract.
//
// Cave diving turns on a RESERVE, never on empty, in overhead environments where
// the only way out is back the way you came. These tests pin the reserve, and --
// just as importantly -- pin that shallow ordinary mining is still allowed,
// because a contract that stops bots working would look like a fix while
// destroying the primary endpoint.
import assert from 'node:assert'
import { canContinueDescent, pickaxeUses, scaffoldCount, SEA_LEVEL } from '../src/exit-contract.mjs'

let pass = 0, fail = 0
const t = (name, fn) => {
  try { fn(); pass++; console.log(`  PASS  ${name}`) }
  catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) }
}
const pick = (name, used = 0, max = null) =>
  ({ name, count: 1, durabilityUsed: used, ...(max ? { maxDurability: max } : {}) })
const blocks = (name, count) => ({ name, count })

// --- the reserve --------------------------------------------------------------

t('a nearly-dead pickaxe deep underground stops the descent', () => {
  // The exact shape of the bot that died: deep, one worn wooden pickaxe.
  const r = canContinueDescent({
    y: 10, health: 20,
    items: [pick('wooden_pickaxe', 50, 59), blocks('cobblestone', 64)],
  })
  assert.equal(r.ok, false, 'this is the descent that entombed a bot for ten hours')
})

t('SHALLOW ORDINARY MINING IS STILL ALLOWED', () => {
  // The productivity guard. A contract that refuses everything looks like a fix
  // -- traps go to zero -- while the primary endpoint collapses.
  const r = canContinueDescent({
    y: 62, health: 20,
    items: [pick('stone_pickaxe', 0, 131), blocks('cobblestone', 32)],
  })
  assert.equal(r.ok, true, `a shallow descent with a fresh pickaxe was refused: ${r.detail}`)
})

t('a well-supplied bot may go deep', () => {
  const r = canContinueDescent({
    y: 20, health: 20,
    items: [pick('iron_pickaxe', 0, 250), blocks('cobblestone', 128)],
  })
  assert.equal(r.ok, true, r.detail)
})

t('the reserve scales with depth, so deeper demands more', () => {
  const kit = () => [pick('iron_pickaxe', 0, 250), blocks('cobblestone', 40)]
  assert.equal(canContinueDescent({ y: 55, health: 20, items: kit() }).ok, true,
    '8 blocks below sea level with 40 blocks should be fine')
  assert.equal(canContinueDescent({ y: 5, health: 20, items: kit() }).ok, false,
    '58 blocks below sea level with 40 blocks must not be')
})

t('EXACTLY enough is NOT enough — the reserve is the whole point', () => {
  // THE DEFINING TEST. A mutation that sets needBlocks = debt (turn back on
  // empty rather than on reserve) survived every other assertion in this file.
  //
  // A bot 30 blocks down carrying exactly 30 blocks can pillar out only if
  // nothing goes wrong: no misplaced block, no gravel falling, no lava detour,
  // no block spent on anything else. Cave divers reserve a third precisely
  // because "exactly enough" is how people die in overhead environments.
  const debt = SEA_LEVEL - 33          // 30 blocks below sea level
  const exactly = canContinueDescent({
    y: 33, health: 20,
    items: [pick('iron_pickaxe', 0, 250), blocks('cobblestone', debt)],
  })
  assert.equal(exactly.ok, false,
    `${debt} blocks for a ${debt}-block climb was accepted — there is no reserve`)
  assert.equal(exactly.reason, 'scaffold')
  assert.ok(exactly.want > debt, 'the requirement must exceed the bare climb')

  // and with the reserve on top, it is allowed
  const withReserve = canContinueDescent({
    y: 33, health: 20,
    items: [pick('iron_pickaxe', 0, 250), blocks('cobblestone', debt + Math.ceil(debt / 4) + 8)],
  })
  assert.equal(withReserve.ok, true, withReserve.detail)
})

t('the same is true of pickaxe swings', () => {
  // Exactly enough durability to dig the climb, with nothing spare.
  const debt = SEA_LEVEL - 43          // 20 below
  const r = canContinueDescent({
    y: 43, health: 20,
    items: [{ name: 'wooden_pickaxe', count: 1, maxDurability: 59, durabilityUsed: 59 - (debt + 3) },
            blocks('cobblestone', 512)],
  })
  assert.equal(r.ok, false, 'a pickaxe with exactly the climb-out budget left was accepted')
  assert.equal(r.reason, 'pickaxe')
})

t('low health stops a descent before blocks or tools are even counted', () => {
  const r = canContinueDescent({
    y: 30, health: 6,
    items: [pick('diamond_pickaxe', 0, 1561), blocks('cobblestone', 512)],
  })
  assert.equal(r.ok, false)
  assert.equal(r.reason, 'health', 'the climb out costs more than the dig down')
})

// --- what counts as capability ------------------------------------------------

t('a stack of half-broken pickaxes IS real capability', () => {
  // Requiring one tool to cover the whole exit would ground a bot that can
  // genuinely get out.
  const many = [pick('wooden_pickaxe', 50, 59), pick('wooden_pickaxe', 50, 59),
                pick('wooden_pickaxe', 45, 59), blocks('cobblestone', 128)]
  assert.ok(pickaxeUses(many) > 25, `expected the swings to sum, got ${pickaxeUses(many)}`)
  assert.equal(canContinueDescent({ y: 55, health: 20, items: many }).ok, true)
})

t('each tool is discounted, because durability metadata lags', () => {
  // A tool that breaks one swing earlier than advertised is the whole failure
  // being prevented here.
  assert.equal(pickaxeUses([pick('wooden_pickaxe', 58, 59)]), 0,
    'a pickaxe with one swing left must count as zero')
})

t('cobbled_deepslate counts as scaffold, because that is what deep bots have', () => {
  // The trapped bot was carrying 24 of exactly this.
  assert.equal(scaffoldCount([blocks('cobbled_deepslate', 24)]), 24)
  assert.equal(scaffoldCount([blocks('crafting_table', 99)]), 0, 'you cannot pillar on tables')
  assert.equal(scaffoldCount([blocks('stick', 64)]), 0)
})

t('a non-pickaxe tool is not a pickaxe', () => {
  assert.equal(pickaxeUses([pick('iron_axe', 0, 250), pick('iron_shovel', 0, 250)]), 0)
})

// --- the refusal has to be actionable ----------------------------------------

t('a refusal names what would fix it', () => {
  const r = canContinueDescent({
    y: 20, health: 20, items: [pick('iron_pickaxe', 0, 250), blocks('cobblestone', 4)],
  })
  assert.equal(r.ok, false)
  assert.equal(r.reason, 'scaffold')
  assert.ok(r.want > r.have, 'the refusal must say how short the bot is')
  assert.match(r.detail, /climb out/, 'the reason must be legible to the model')
})

t('above sea level there is no debt at all', () => {
  const r = canContinueDescent({ y: SEA_LEVEL + 20, health: 20, items: [pick('wooden_pickaxe', 0, 59)] })
  assert.equal(r.debt, 0)
})

// --- THE RESERVE MAY NOT EXCEED THE CLIMB IT INSURES -------------------------
//
// The floors were written for a deep bot, where losing the tool is fatal.
// Applied unchanged to a shallow one they inverted into nonsense: at debt 1 the
// old form demanded 9 scaffold and 15 pickaxe swings to climb ONE block.
// Measured over 24h: 580 `mine` refusals carried a stated debt, median debt 1,
// and 69% were at debt <= 4. The floor, not the depth, did the refusing.

t('a one-block climb costs a one-block reserve, not nine', () => {
  const r = canContinueDescent({
    y: SEA_LEVEL - 1, health: 20,
    items: [blocks('cobblestone', 2), pick('stone_pickaxe', 0, 131)],
  })
  assert.ok(r.ok, `refused a one-block climb: ${r.detail ?? r.reason}`)
})

t('MUTANT: the old floor refused exactly this bot', () => {
  // Guards the test above against passing for the wrong reason. Under the old
  // form needBlocks was 1 + max(8, 1) = 9, so 2 cobblestone was a refusal.
  const oldNeedBlocks = 1 + Math.max(8, Math.ceil(1 / 4))
  assert.equal(oldNeedBlocks, 9, 'the old arithmetic is not what this test claims')
  assert.ok(2 < oldNeedBlocks, 'the fixture must be one the old floor rejected')
})

t('THE DEEP END IS UNCHANGED, bit for bit', () => {
  // The floors exist for the deep case and must not be relaxed there. At and
  // beyond debt 12, min(FLOOR, debt) is just FLOOR.
  for (const debt of [12, 20, 32, 48, 60, 81]) {
    const wantBlocks = debt + Math.max(8, Math.ceil(debt / 4))
    const wantUses = debt + 2 + Math.max(12, Math.ceil(debt / 4))
    const short = canContinueDescent({
      y: SEA_LEVEL - debt, health: 20,
      items: [blocks('cobblestone', wantBlocks - 1), pick('diamond_pickaxe', 0, 1561)],
    })
    assert.ok(!short.ok && short.reason === 'scaffold',
      `debt ${debt}: one block short of the old requirement must still refuse`)
    assert.equal(short.want, wantBlocks, `debt ${debt}: block requirement moved`)

    const exact = canContinueDescent({
      y: SEA_LEVEL - debt, health: 20,
      items: [blocks('cobblestone', wantBlocks), pick('diamond_pickaxe', 0, 1561)],
    })
    assert.ok(exact.ok, `debt ${debt}: the old exact requirement must still pass`)

    const thin = canContinueDescent({
      y: SEA_LEVEL - debt, health: 20,
      items: [blocks('cobblestone', wantBlocks), pick('stone_pickaxe', 131 - (wantUses - 1), 131)],
    })
    assert.ok(!thin.ok && thin.reason === 'pickaxe',
      `debt ${debt}: one swing short must still refuse`)
    assert.equal(thin.want, wantUses, `debt ${debt}: pickaxe requirement moved`)
  }
})

t('the reserve never exceeds the debt at any shallow depth', () => {
  for (let debt = 1; debt <= 11; debt++) {
    const r = canContinueDescent({
      y: SEA_LEVEL - debt, health: 20,
      items: [blocks('cobblestone', 2 * debt), pick('diamond_pickaxe', 0, 1561)],
    })
    assert.ok(r.ok, `debt ${debt}: carrying twice the climb was still refused (${r.detail})`)
  }
})

t('a bot ABOVE sea level still owes nothing', () => {
  // The debt>0 guard this sits inside was added for bots at the build limit;
  // clamping must not disturb it. Note the bot still needs a TOOL: needUses is
  // debt + 2 even at debt 0, because the two swings pay for the dig itself, not
  // for a climb. Zero debt means zero RESERVE, not zero requirement.
  const r = canContinueDescent({
    y: SEA_LEVEL + 250, health: 20,
    items: [pick('stone_pickaxe', 0, 131)],
  })
  assert.ok(r.ok, `descending toward safety must never be refused: ${r.detail ?? ''}`)
  assert.ok(canContinueDescent({ y: SEA_LEVEL + 250, health: 20, items: [] }).reason === 'pickaxe',
    'and with no tool at all it is the TOOL that is missing, never a scaffold reserve')
})

t('THE WOODEN-TIER IRON GATE IS UNCHANGED, and deliberately so', () => {
  // At y=15 the contract prices 62 pickaxe swings; a wooden pickaxe has 59.
  // That gate is real and is NOT what this change addresses -- pinned here so
  // nobody reads the shallow fix as having opened iron to wooden-tier bots.
  const r = canContinueDescent({
    y: 15, health: 20,
    items: [blocks('cobblestone', 64), pick('wooden_pickaxe', 0, 59)],
  })
  assert.ok(!r.ok && r.reason === 'pickaxe', 'wooden tier must still be refused at iron depth')
  assert.equal(r.want, 62)
})


console.log(`  ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
