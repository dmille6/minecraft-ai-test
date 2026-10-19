// BAMBOO FOLD ABORTS (split from bamboo.test.mjs for the runner's 120 s per-file budget, foldwatch-01): bamboo-03's
// in-flight craft at a stop (foldTally, the fleet's three G3 rows, the two abort shapes through REAL craftsync + the
// fake Paper) and foldwatch-01's watchdog credit (only server-confirmed crafts are booked).
//
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

process.env.LOG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-test-bamboo-'))
process.env.SKILL_TIMEOUT_MS = '180000'   // the craft deadline is the skill timeout; the suite's 300 ms leaves none
process.env.STATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-test-bamboo-state-'))
const B = await import('../src/bamboo.mjs')
const CS = await import('../src/craftsync.mjs')
const { FakePaper, craftBot, learnAll, registry, Item } = await import('./helpers/fake-paper-craft.mjs')
const { SKILLS, SKILL_CONTRACTS } = await import('../src/skills.mjs')
const { evidenceScope } = await import('../src/cognitive.mjs')
const { isHousekeeping } = await import('../src/hygiene.mjs')
const { createRequire } = await import('node:module')
const { Recipe } = createRequire(import.meta.url)('prismarine-recipe')('1.21.8')

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) }
  catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) }
}
const S = (name, count) => ({ name, count })
const fill = (n, name = 'cobblestone') => Array.from({ length: n }, () => S(name, 64))

const nameOf = it => registry.items[it.type].name
function bag (stacks, used, filler = 'dirt') {
  const inv = { ...stacks }
  for (let s = 9; s <= 44 && Object.keys(inv).length < used; s++) if (!inv[s]) inv[s] = [filler, 64]
  return inv
}
async function setup (inv, opts = {}) {
  const server = new FakePaper({ lagClicks: 3, fallbackMs: 60, inventory: inv })
  const bot = craftBot(server)
  bot.entities = {}; bot.health = 20; bot.food = 20
  await server.sync()
  const rows = []
  CS.installCraftSync(bot, { log: r => rows.push(r), ...opts })
  learnAll(bot, server, ['stick'])
  return { server, bot, rows }
}
const fold = async (bot, server) => {
  const out = await SKILLS.bamboo_sticks.run({ bot }, {}, new AbortController().signal)
  await server.settle(); server.stop()
  return out
}
const craftClicks = server => server.writes.filter(w => w.name === 'window_click' && w.params.stateId !== -1).length
const used = server => server.p.slice(9, 45).filter(Boolean).length
const LOG = () => path.join(process.env.LOG_DIR, `skill-${process.env.BOT_NAME ?? 'TestBot'}.jsonl`)
const rowsOf = kind => {
  try { return fs.readFileSync(fs.readdirSync(process.env.LOG_DIR).map(f => path.join(process.env.LOG_DIR, f)).find(f => /^skill-/.test(path.basename(f))) ?? LOG(), 'utf8')
    .trim().split('\n').map(l => JSON.parse(l)).filter(r => r.skill?.name === kind) } catch { return [] }
}

const rowAt = () => rowsOf('_bamboo_sticks').at(-1)?.skill

await t('foldwatch-01 NEGATIVE CONTROL (Codex r2): an UNMADE craft with an optimistic, unconfirmed count books NO watchdog credit', async () => {
  // the 3rd execution never reaches the server; craftsync reports produced 1 but NOT authoritatively (its after-resync
  // unanswered) -- the watchdog credit must take only the 2 crafts the server confirmed
  const { server, bot } = await setup(bag({ 36: ['bamboo', 64], 37: ['bamboo', 10], 38: ['stick', 32] }, 36))
  const real = bot.craft
  let n = 0
  bot.craft = async (...a) => {
    if (++n === 3) throw new CS.CraftSyncError('mineflayer reported the craft done, but the server did not answer', { failClass: 'craft_unconfirmed', produced: 1, requested: 1, reason: 'unverified', authoritative: false })
    return real(...a)
  }
  await fold(bot, server)
  await new Promise(r => setTimeout(r, 100))
  const row = rowsOf('_bamboo_sticks').at(-1)?.skill
  assert.equal(server.count('stick') - 32, 2, 'POSITIVE CONTROL: the server made exactly 2 sticks')
  assert.equal(bot.foldItemsSpent, 2, `the watchdog credit took an unmade craft (${bot.foldItemsSpent})`)
  assert.equal(row?.args?.crafts, 2, 'nor did the row count it')
  assert.equal(bot.foldWindowUntil, 0)
})

await t('foldTally: the THREE fleet G3 rows (stagnation aborts, hive-b) each credit the one craft in flight -- bamboo gone = 2 x the tally', () => {
  const rows = [  // [claimed, planned, b0, b1, s0, s1] exactly as the canary logged them (Bravo 04:12, Alpha 04:25, Comet 04:32)
    [0, 32, 128, 126, 11, 12], [6, 32, 64, 50, 25, 32], [7, 36, 263, 247, 0, 8]]
  for (const [claimed, planned, b0, b1, s0, s1] of rows) {
    const t = B.foldTally({ claimed, planned, before: { bamboo: b0, sticks: s0 }, after: { bamboo: b1, sticks: s1 }, status: 'aborted' })
    assert.deepEqual(t, { crafts: claimed + 1, inflight: 1 }, JSON.stringify({ claimed, b0, b1, s0, s1 }))
    assert.equal(b0 - b1, 2 * t.crafts, 'the read\'s G3 identity holds on the corrected tally')
    assert.ok(b0 - b1 > 2 * claimed, 'POSITIVE CONTROL: the uncorrected tally trips G3 on this row')
  }
})

await t('foldTally never hides lost bamboo: a stranded grid (bamboo gone, no stick), a stick pickup alone, a success, the plan, at most ONE', () => {
  const at = (claimed, b, s, status = 'aborted', planned = 32) =>
    B.foldTally({ claimed, planned, before: { bamboo: b[0], sticks: s[0] }, after: { bamboo: b[1], sticks: s[1] }, status })
  assert.deepEqual(at(6, [64, 48], [25, 31]), { crafts: 6, inflight: 0 }, 'grid stranded 4 bamboo: no stick to show, nothing credited')
  assert.deepEqual(at(6, [64, 50], [25, 31]), { crafts: 6, inflight: 0 }, 'grid stranded 2 bamboo (the in-flight craft never made): nothing credited')
  assert.deepEqual(at(6, [64, 52], [25, 40]), { crafts: 6, inflight: 0 }, 'sticks picked up, bamboo as claimed: nothing credited')
  assert.deepEqual(at(3, [64, 54], [25, 30]), { crafts: 4, inflight: 1 }, 'the bag shows 5: still only ONE execution can be in flight')
  assert.deepEqual(at(32, [64, 0], [32, 64], 'success'), { crafts: 32, inflight: 0 })
  assert.deepEqual(at(4, [64, 54], [25, 30], 'success'), { crafts: 4, inflight: 0 }, 'a success verified every execution: nothing is added')
  assert.deepEqual(at(32, [66, 0], [32, 65], 'aborted', 32), { crafts: 32, inflight: 0 }, 'never past the plan')
  assert.deepEqual(at(32, [66, 0], [32, 65], 'aborted', 33), { crafts: 33, inflight: 1 }, 'POSITIVE CONTROL: the same bag one under the plan is credited')
  assert.deepEqual(at(0, [undefined, undefined], [0, 0]), { crafts: 0, inflight: 0 }, 'an unreadable bag credits nothing')
  for (const status of ['no_effect', 'failed']) assert.equal(at(2, [10, 4], [0, 3], status).crafts, 3, status)
})

await t('THE ABORT PATH (bamboo-02 fleet REVERT): a stop that lands while the 3rd craft is in flight -- after the server made it, before craftsync attributed it -- leaves the stick in the bag, nothing in the grid, cursor or on the ground, and the row counts it', async () => {
  const { server, bot, rows } = await setup(bag({ 36: ['bamboo', 64], 37: ['stick', 32], 38: ['oak_planks', 10] }, 36))
  const ac = new AbortController()
  const recv = server.receive.bind(server)
  let takes = 0, fired = false
  server.receive = (name, params) => {
    const out = recv(name, params)
    // the 3rd RESULT-SLOT click: the server has consumed the grid and holds the 3rd stick on its cursor; mineflayer's
    // put-away and craftsync's verification are still to come -- the stagnation abort's moment on the fleet
    if (name === 'window_click' && params.windowId === 0 && params.slot === 0 && params.stateId !== -1 && ++takes === 3 && !fired) {
      fired = true; ac.abort()
    }
    return out
  }
  await assert.rejects(SKILLS.bamboo_sticks.run({ bot, runner: { interruptedReason: 'stagnation' } }, {}, ac.signal), e => e?.aborted === true)
  await server.settle(); server.stop()
  await new Promise(r => setTimeout(r, 100))
  assert.ok(fired, 'the abort never landed on the 3rd craft')
  // THE WORLD (the fake Paper's own slots): the made stick is in the bag; bamboo spent exactly 2 per stick; nothing stranded
  assert.equal(server.count('stick') - 32, 3, 'the server should hold exactly 3 new sticks')
  assert.equal(server.count('bamboo'), 64 - 6, 'bamboo left the bag without becoming sticks')
  assert.equal(server.cursor, null, 'the cursor still holds an item')
  assert.deepEqual(server.gridOf(0).slice(1).filter(Boolean), [], 'the 2x2 grid still holds items')
  assert.deepEqual(server.dropped, [], 'an item was thrown')
  assert.equal(server.count('oak_planks'), 10)
  // POSITIVE CONTROL: this is the fleet's shape -- craftsync could not attribute the 3rd craft (aborted, produced null)
  const last = rows.at(-1)?.args
  assert.equal(last?.outcome, 'aborted', JSON.stringify(last))
  assert.equal(last?.produced ?? null, null, 'craftsync attributed the craft: this scene is not the fleet\'s')
  // THE ROW: the tally is the server's, the in-flight craft credited and flagged; the read's G3 identity holds
  const row = rowsOf('_bamboo_sticks').at(-1)?.skill
  assert.equal(row?.args?.stop, 'aborted:stagnation')
  assert.equal(row?.args?.crafts, 3, `row crafts=${row?.args?.crafts}, server +${server.count('stick') - 32}`)
  assert.equal(row?.args?.inflight, 1)
  // foldwatch-01 NEGATIVE CONTROL (Codex): the in-flight craft is the row's INFERENCE from the bag, not the server's word --
  // the stagnation credit books only the 2 server-confirmed crafts
  assert.equal(bot.foldItemsSpent, 2, 'the watchdog credit took the inferred in-flight craft')
  assert.equal(bot.foldWindowUntil, 0)
  assert.equal(row.args.b0 - row.args.b1, 2 * row.args.crafts, 'G3: bamboo gone > 2 x crafts')
  assert.equal(row.args.s1 - row.args.s0, row.args.crafts, 'G2: sticks gained < crafts')
})

await t('THE ABORT PATH, BRAVO\'S SHAPE (Claude review): the stop lands as craftsync starts verifying the 3rd craft -- its after-resync is skipped, the count only local -- and the row still counts the made craft, nothing stranded', async () => {
  const { server, bot, rows } = await setup(bag({ 36: ['bamboo', 64], 37: ['stick', 32], 38: ['oak_planks', 10] }, 36))
  const ac = new AbortController()
  const recv = server.receive.bind(server)
  let closes = 0, fired = false, sticksAtStop = null
  server.receive = (name, params) => {
    const out = recv(name, params)
    // each craft closes window 0 twice (the baseline, then the verification): the 6th close is the 3rd craft's
    // verification -- the abort lands inside that write, so the resync that would follow it is skipped
    if (name === 'close_window' && params.windowId === 0 && ++closes === 6 && !fired) {
      fired = true; sticksAtStop = server.count('stick'); ac.abort()
    }
    return out
  }
  await assert.rejects(SKILLS.bamboo_sticks.run({ bot, runner: { interruptedReason: 'stagnation' } }, {}, ac.signal), e => e?.aborted === true)
  await server.settle(); server.stop()
  await new Promise(r => setTimeout(r, 100))
  assert.ok(fired, 'the abort never landed')
  assert.equal(sticksAtStop - 32, 3, 'POSITIVE CONTROL: the 3rd stick was made before the stop')
  assert.equal(server.count('stick') - 32, 3); assert.equal(server.count('bamboo'), 64 - 6)
  assert.equal(server.cursor, null); assert.deepEqual(server.gridOf(0).slice(1).filter(Boolean), []); assert.deepEqual(server.dropped, [])
  const last = rows.at(-1)?.args
  assert.equal(last?.outcome, 'aborted', JSON.stringify(last))
  assert.match(String(last?.verify_source), /^local/, 'POSITIVE CONTROL: the fleet\'s Bravo shape -- the count is not the server\'s')
  assert.match(String(last?.grid_clear), /^unverified/, 'the read\'s Bravo path is "clean", not "server": the grid clear was not verified')
  const row = rowsOf('_bamboo_sticks').at(-1)?.skill
  assert.equal(row?.args?.crafts, 3, `row crafts=${row?.args?.crafts}`)
  assert.equal(row?.args?.inflight, 1)
  assert.equal(row.args.b0 - row.args.b1, 2 * row.args.crafts)
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
