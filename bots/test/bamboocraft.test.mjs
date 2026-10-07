// BAMBOO FOLD AS CRAFT'S MAKE-ROOM STEP (bamboocraft-01). A room-blocked milestone craft wins the decision every time,
// so bamboo_sticks' housekeeping order is never asked even when a fold would free the slot the craft needs. craft()'s
// make-room step now folds FIRST (bamboo.mjs foldForCraft decides, skills.mjs foldForRoom acts through the same
// executor bamboo_sticks uses), verifies on the server's bag, and retries the craft once.
//
// Two halves: the pure decision (foldForCraft) on the worked cases, then the REFUSAL CHAIN through skills.mjs craft ->
// makeCraftRoom -> the fold -> REAL craftsync -> mineflayer 4.37.1's craft.js -> the fake Paper, whose slots are the
// oracle. Mutants at the end: each guard is removed and a test above is shown to fail.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

process.env.LOG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-test-bamboocraft-'))
process.env.SKILL_TIMEOUT_MS = '180000'   // the craft deadline is the skill timeout; the suite's 300 ms leaves none
process.env.STATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-test-bamboocraft-state-'))
const B = await import('../src/bamboo.mjs')
const CS = await import('../src/craftsync.mjs')
const { FakePaper, craftBot, learnAll, fakeWorld, registry, Item } = await import('./helpers/fake-paper-craft.mjs')
const { SKILLS } = await import('../src/skills.mjs')

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) }
  catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) }
}
const S = (name, count, stackSize) => ({ name, count, ...(stackSize ? { stackSize } : {}) })
const fill = (n, name = 'dirt') => Array.from({ length: n }, () => S(name, 64))
const PICKAXE = { consumes: [{ name: 'cobblestone', count: 3 }, { name: 'stick', count: 2 }], outputs: [{ name: 'stone_pickaxe', count: 1, stackSize: 1 }] }
const FURNACE = { consumes: [{ name: 'cobblestone', count: 8 }], outputs: [{ name: 'furnace', count: 1, stackSize: 64 }] }
const SCAFFOLD = { consumes: [{ name: 'bamboo', count: 6 }, { name: 'string', count: 1 }], outputs: [{ name: 'scaffolding', count: 6, stackSize: 64 }] }
const LEAD = { consumes: [{ name: 'string', count: 1 }], outputs: [{ name: 'lead', count: 6, stackSize: 64 }] }   // same shape, no bamboo

// ------------------------------------------------------------------ foldForCraft: the pure decision
const REPRO = () => [S('bamboo', 64), S('stick', 32), S('cobblestone', 10), ...fill(33)]

await t('THE REVIEWER\'S REPRO: 36/36, bamboo x64 + sticks x32, stone_pickaxe blocked by room -> fold 32, frees 1, the craft fits after', () => {
  const d = B.foldForCraft({ verifiable: true, items: REPRO(), recipe: PICKAXE })
  assert.deepEqual([d.fold, d.crafts, d.freed, d.before, d.after], [true, 32, 1, 36, 35], d.why)
})

await t('INGREDIENT PROTECTION: a craft that consumes bamboo never folds (positive control: the same bag and shape without bamboo folds)', () => {
  const bag = [S('bamboo', 64), S('bamboo', 10), S('stick', 32), S('string', 2), ...fill(32)]
  assert.equal(bag.length, 36)
  const ctl = B.foldForCraft({ verifiable: true, items: bag, recipe: LEAD })
  assert.equal(ctl.fold, true, `positive control: ${ctl.why}`)
  const d = B.foldForCraft({ verifiable: true, items: bag, recipe: SCAFFOLD })
  assert.deepEqual([d.fold, d.reason], [false, 'craft_uses_bamboo'], d.why)
  const p = B.foldForCraft({ verifiable: true, items: bag, recipe: LEAD, protect: [{ name: 'bamboo', count: 9 }] })
  assert.deepEqual([p.fold, p.reason], [false, 'craft_uses_bamboo'], 'a plan\'s later step needs bamboo: protected too')
})

await t('STICK CAP: a fold that frees a slot only by passing 64 sticks with a NEW stick slot is refused (control: no sticks -> it folds)', () => {
  // 35/36 and one slot held back (a table to take back): the furnace needs 2 more; 64 crafts empty both bamboo stacks
  const capped = [S('bamboo', 64), S('bamboo', 64), S('stick', 40), S('cobblestone', 10), ...fill(31)]
  assert.equal(capped.length, 35)
  const d = B.foldForCraft({ verifiable: true, items: capped, recipe: FURNACE, reserve: 1 })
  assert.deepEqual([d.fold, d.reason], [false, 'stick_cap'], d.why)
  const ctl = B.foldForCraft({ verifiable: true, items: [S('bamboo', 64), S('bamboo', 64), S('cobblestone', 10), ...fill(32)], recipe: FURNACE, reserve: 1 })
  assert.deepEqual([ctl.fold, ctl.crafts, ctl.freed], [true, 64, 1], `positive control: ${ctl.why}`)
})

await t('STICKS AT THE CAP (64): nothing a fold makes frees a slot -> no fold', () => {
  const d = B.foldForCraft({ verifiable: true, items: [S('bamboo', 64), S('stick', 64), S('cobblestone', 10), ...fill(33)], recipe: PICKAXE })
  assert.equal(d.fold, false, d.why)
})

await t('THE CRAFT MUST FIT ON THE BAG THE FOLD LEAVES: a held-back slot the fold cannot also cover -> no fold (control: no reserve -> fold)', () => {
  const d = B.foldForCraft({ verifiable: true, items: REPRO(), recipe: PICKAXE, reserve: 1 })
  assert.deepEqual([d.fold, d.reason], [false, 'not_enough'], d.why)
  assert.equal(B.foldForCraft({ verifiable: true, items: REPRO(), recipe: PICKAXE, reserve: 0 }).fold, true, 'positive control')
})

await t('NOTHING TO SOLVE: a craft that fits, a craft short of an ingredient, a fold that frees nothing (bamboo x63: an odd remainder)', () => {
  assert.equal(B.foldForCraft({ verifiable: true, items: [S('bamboo', 64), S('stick', 32), S('cobblestone', 10), ...fill(30)], recipe: PICKAXE }).reason, 'fits')
  assert.equal(B.foldForCraft({ verifiable: true, items: [S('bamboo', 64), S('stick', 32), ...fill(34)], recipe: PICKAXE }).reason, 'ingredients')
  const odd = B.foldForCraft({ verifiable: true, items: [S('bamboo', 63), S('stick', 32), S('cobblestone', 10), ...fill(33)], recipe: PICKAXE })
  assert.equal(odd.fold, false, odd.why)
  assert.equal(B.foldForCraft({ verifiable: true, items: [S('stick', 32), S('cobblestone', 10), ...fill(34)], recipe: PICKAXE }).reason, 'no_bamboo')
})

await t('THE WINDOW: a fold that cannot finish in the time the craft has left is refused (32 crafts need 46.6 s)', () => {
  const d = B.foldForCraft({ verifiable: true, items: REPRO(), recipe: PICKAXE, leftMs: 20_000 })
  assert.deepEqual([d.fold, d.reason], [false, 'too_long'], d.why)
  assert.equal(B.foldForCraft({ verifiable: true, items: REPRO(), recipe: PICKAXE, leftMs: 60_000 }).fold, true, 'positive control')
})

await t('simulateFold\'s `bags` option is additive: the same steps without it, and the last bag matches the counts', () => {
  const plain = B.simulateFold(REPRO(), 32)
  const withBags = B.simulateFold(REPRO(), 32, { bags: true })
  assert.deepEqual(withBags.steps.map(({ bag, ...s }) => s), plain.steps)
  const last = withBags.steps.at(-1).bag
  assert.equal(last.length, 35)
  assert.equal(last.filter(s => s.name === 'stick').reduce((n, s) => n + s.count, 0), 64)
  assert.equal(last.some(s => s.name === 'bamboo'), false)
  const named = B.simulateFold([S('bamboo', 4), { name: 'dirt', count: 1, nbt: { named: true } }], 1, { bags: true }).steps[0].bag
  assert.equal(named.find(s => s.name === 'dirt')?.nbt, true, 'nbt dropped from the bag a craft is tested on')
})

// ------------------------------------------------------------------ the chain: craft -> makeCraftRoom -> fold -> retry
const nameOf = it => registry.items[it.type].name
/** `stacks` at the given slots, `free` slots left empty, every other bag slot (9..44) a FULL stack of dirt. */
const fullBag = (stacks, free = 0) => {
  const inv = { ...stacks }
  let left = free
  for (let s = 9; s <= 44; s++) {
    if (inv[s]) continue
    if (left > 0) { left--; continue }
    inv[s] = ['dirt', 64]
  }
  return inv
}
/** The fake's refresh fallback and craftsync's quiet wait, scaled down for speed (CRAFT_SYNC: "pass smaller ones"):
 *  a 32-craft fold at the defaults takes ~40 s, past the runner's per-file budget with five of them. */
const FAST = { fallbackMs: 20, quietMs: 40 }
async function setup (inv, { table = '1,64,0', learn = [], sync = true } = {}) {
  const server = new FakePaper({ lagClicks: 3, fallbackMs: FAST.fallbackMs, inventory: inv })
  const bot = craftBot(server)
  const placed = fakeWorld(bot, server)
  if (table) placed.set(table, 'crafting_table')
  bot.entities = {}; bot.health = 20; bot.food = 20
  await server.sync()
  const rows = []
  if (sync) CS.installCraftSync(bot, { log: r => rows.push(r), quietMs: FAST.quietMs })
  learnAll(bot, server, ['stone_pickaxe', 'stick', 'crafting_table', ...learn])
  return { server, bot, rows, placed }
}
const craftWith = async (skills, bot, server, item = 'stone_pickaxe') => {
  const out = await skills.craft.run({ bot }, { item, count: 1 }, new AbortController().signal)
  await server.settle(); server.stop()
  return out
}
const craftClicks = server => server.writes.filter(w => w.name === 'window_click' && w.params.stateId !== -1).length
const used = server => server.p.slice(9, 45).filter(Boolean).length
const allRows = () => {
  const out = []
  for (const f of fs.readdirSync(process.env.LOG_DIR).filter(f => /^skill-/.test(f))) {
    for (const l of fs.readFileSync(path.join(process.env.LOG_DIR, f), 'utf8').trim().split('\n')) { if (l) try { out.push(JSON.parse(l)) } catch {} }
  }
  return out
}
const rowsOf = (kind, since = 0) => allRows().slice(since).filter(r => r.skill?.name === kind).map(r => r.skill)
const mark = async () => { await new Promise(r => setTimeout(r, 50)); return allRows().length }
/** The remedy a refusal leads with (refuseNoRoom: "<remedy>. No room for <item>: ..."). */
const remedyOf = out => String(out.detail ?? '').split('. No room for')[0]
/** THE SERVER'S AUTO-PICKUP right after the fold, before craft's verification recount: the freed slot is refilled. */
function refillAfterFold (bot, server, { times = 1 } = {}) {
  const real = bot.craftSync.recount
  let n = 0
  bot.craftSync.recount = async (...a) => {
    if (n++ < times) {
      const slot = server.p.findIndex((it, i) => i >= 9 && i <= 44 && !it)
      if (slot >= 0) {
        server.p[slot] = new Item(registry.itemsByName.dirt.id, 64); server.sid[0]++
        server.send([['set_slot', { windowId: 0, stateId: server.sid[0], slot, item: Item.toNotch(server.p[slot]) }]])
        await server.settle()
      }
    }
    return real(...a)
  }
}
/** The same pickup, but AFTER the verification recount answered: the fold is verified, then the slot fills. */
function refillAfterVerify (bot, server) {
  const real = bot.craftSync.recount
  let n = 0
  bot.craftSync.recount = async (...a) => {
    const r = await real(...a)
    if (n++ === 0) {
      const slot = server.p.findIndex((it, i) => i >= 9 && i <= 44 && !it)
      server.p[slot] = new Item(registry.itemsByName.dirt.id, 64); server.sid[0]++
      server.send([['set_slot', { windowId: 0, stateId: server.sid[0], slot, item: Item.toNotch(server.p[slot]) }]])
      await server.settle()
    }
    return r
  }
}
const REPRO_INV = () => fullBag({ 36: ['stick', 32], 37: ['cobblestone', 10], 38: ['bamboo', 64] })
/** SPLIT bamboo [64, 10, 10]: the put-away consolidates, so ONE craft frees a slot -- and a 9-craft fold would free
 *  another afterwards. Fast chains (~0.6 s a craft through the fake) for the cases that need more than the repro. */
const SPLIT_INV = () => fullBag({ 36: ['stick', 32], 37: ['cobblestone', 10], 38: ['bamboo', 64], 39: ['bamboo', 10], 40: ['bamboo', 10] })
const SPLIT_ITEMS = () => [{ slot: 36, ...S('stick', 32) }, { slot: 37, ...S('cobblestone', 10) }, { slot: 38, ...S('bamboo', 64) },
  { slot: 39, ...S('bamboo', 10) }, { slot: 40, ...S('bamboo', 10) }, ...fill(31)]

async function reproCase (skills) {
  const { server, bot } = await setup(REPRO_INV())
  assert.equal(used(server), 36)
  const since = await mark()
  const out = await craftWith(skills, bot, server)
  await new Promise(r => setTimeout(r, 50))
  return { out, server, rows: rowsOf('_bamboo_room', since) }
}

await t('(1) THE REPRO THROUGH THE SKILL: 36/36, no spent tool -> the fold runs, a slot frees, the craft is retried and the server holds the pickaxe', async () => {
  const { out, server, rows } = await reproCase(SKILLS)
  assert.equal(out.status, 'success', out.detail)
  assert.deepEqual([server.count('stone_pickaxe'), server.count('bamboo'), server.count('stick'), server.count('cobblestone')], [1, 0, 62, 7])
  assert.deepEqual(server.dropped, [], 'something was thrown on the ground')
  assert.equal(used(server), 36)
  assert.match(out.detail, /made room by folding 64 bamboo into 32 sticks/)
  assert.equal(rows.length, 1, `${rows.length} _bamboo_room rows`)
  assert.deepEqual([rows[0].args.attempted, rows[0].args.enabled, rows[0].args.crafts, rows[0].args.planned, rows[0].args.o0, rows[0].args.o1],
    ['yes', 'yes', 32, 32, 36, 35], rows[0].detail)
  assert.equal(rows[0].args.source, 'server', 'the verification must be the server\'s bag')
})

await t('(1b) A CARRIED TABLE (outside town): the table is put down and owed a slot; the fold covers the pickaxe AND keeps the table\'s slot', async () => {
  const { server, bot } = await setup(fullBag({ 36: ['stick', 32], 37: ['cobblestone', 10], 38: ['bamboo', 64], 39: ['bamboo', 10], 40: ['bamboo', 10], 41: ['crafting_table', 1] }), { table: null })
  assert.equal(used(server), 36)
  const since = await mark()
  const out = await craftWith(SKILLS, bot, server)
  await new Promise(r => setTimeout(r, 50))
  assert.equal(out.status, 'success', out.detail)
  assert.deepEqual([server.count('stone_pickaxe'), server.count('bamboo')], [1, 82])
  assert.deepEqual(server.dropped, [])
  // THE TABLE'S SLOT WAS HONOURED: 36 - table put down - fold's freed slot + pickaxe = 35, one slot left to carry it
  // back. (The flat fake world has no bot.dig, so the retake itself is not modelled here: craft-room.test.mjs covers it.)
  assert.equal(used(server), 35)
  assert.match(out.detail, /placed a crafting_table; made room by folding/)
  assert.equal(rowsOf('_bamboo_room', since)[0]?.args?.enabled, 'yes')
})

await t('(3) STICKS AT THE CAP through the skill: no fold, no click, the existing refusal names another remedy (never the fold)', async () => {
  const { server, bot } = await setup(fullBag({ 36: ['stick', 64], 37: ['cobblestone', 10], 38: ['bamboo', 64] }))
  const since = await mark()
  const out = await craftWith(SKILLS, bot, server)
  await new Promise(r => setTimeout(r, 50))
  assert.equal(out.failClass, 'inventory_full', out.detail)
  assert.equal(craftClicks(server), 0); assert.deepEqual([server.count('bamboo'), server.count('stick')], [64, 64])
  assert.doesNotMatch(remedyOf(out), /fold|bamboo_sticks|into sticks/i, remedyOf(out))
  assert.ok(remedyOf(out).length > 0, 'the refusal must lead with a remedy')
  const rows = rowsOf('_bamboo_room', since)
  assert.deepEqual(rows.map(r => r.args.attempted), ['no'], 'the decision is recorded, the fold not attempted')
})

await t('(4) A FOLD THAT FREES NOTHING (bamboo x63 + sticks x32): no fold, no click, the existing remedy', async () => {
  const { server, bot } = await setup(fullBag({ 36: ['stick', 32], 37: ['cobblestone', 10], 38: ['bamboo', 63] }))
  const out = await craftWith(SKILLS, bot, server)
  assert.equal(out.failClass, 'inventory_full', out.detail)
  assert.equal(craftClicks(server), 0); assert.equal(server.count('bamboo'), 63)
  assert.doesNotMatch(remedyOf(out), /fold|bamboo_sticks|into sticks/i)
})

await t('(5) A FOLD THAT RUNS BUT DOES NOT FREE THE SLOT (a pickup refills it): ONE fold, no craft, the refusal names another remedy', async () => {
  assert.equal(B.foldForCraft({ verifiable: true, items: SPLIT_ITEMS(), recipe: PICKAXE }).crafts, 1, 'the split bag folds in one craft')
  const { server, bot } = await setup(SPLIT_INV())
  refillAfterFold(bot, server)
  const since = await mark()
  const out = await craftWith(SKILLS, bot, server)
  await new Promise(r => setTimeout(r, 50))
  assert.equal(out.failClass, 'inventory_full', out.detail)
  assert.equal(server.count('stone_pickaxe'), 0); assert.deepEqual(server.dropped, [])
  assert.deepEqual([server.count('bamboo'), server.count('stick')], [82, 33], 'positive control: the fold did run')
  const rows = rowsOf('_bamboo_room', since)
  assert.deepEqual(rows.map(r => [r.args.attempted, r.args.enabled]), [['yes', 'no']], 'one fold, judged not enabled')
  assert.doesNotMatch(remedyOf(out), /fold|bamboo_sticks|into sticks/i, remedyOf(out))
  assert.match(out.detail, /folding bamboo into sticks did not make room/)
})

await t('(5b) NO SECOND FOLD IN A LEVEL: verified, then a pickup refills the slot before the craft -> the 2nd make-room try does not fold again', async () => {
  // the split bag: one craft frees a slot, and after the refill a 9-craft fold would free another on its own
  const { server, bot } = await setup(SPLIT_INV())
  refillAfterVerify(bot, server)
  const since = await mark()
  const out = await craftWith(SKILLS, bot, server)
  await new Promise(r => setTimeout(r, 50))
  assert.equal(out.failClass, 'inventory_full', out.detail)
  const rows = rowsOf('_bamboo_room', since)
  assert.deepEqual(rows.map(r => [r.args.attempted, r.args.enabled]), [['yes', 'yes']], JSON.stringify(rows.map(r => r.detail)))
  assert.equal(server.count('bamboo'), 82, 'a second fold ran')
  assert.ok(B.foldForCraft({ verifiable: true, items: bot.inventory.items(), recipe: PICKAXE }).fold, 'positive control: a second fold WAS available')
})

// ------------------------------------------------------------------ round 1 (Codex): ancestors, the server's word, composed remedies
const SCAFFOLD_INV = () => fullBag({ 36: ['bamboo', 64], 37: ['stick', 32], 38: ['oak_planks', 8], 39: ['string', 1] })
/** The same with the bamboo split [64, 10, 10]: a ONE-craft fold frees the slot (the mutants run this one: 32 crafts
 *  through the fake take ~20 s each). The chain tests run both bags. */
const SCAFFOLD_SPLIT = () => fullBag({ 36: ['bamboo', 64], 37: ['stick', 32], 38: ['oak_planks', 8], 39: ['string', 1], 40: ['bamboo', 10], 41: ['bamboo', 10] })
const bambooOf = server => server.count('bamboo')

await t('R1-P1 A FAR TABLE\'S SUB-CRAFT NEVER FOLDS THE PARENT\'S BAMBOO: scaffolding at 36/36, table out of reach -> the room-blocked crafting_table sub-craft refuses, 64 bamboo kept', async () => {
  // The parent (scaffolding) finds a table 9.5 blocks away it cannot reach, so it crafts a replacement from the planks
  // (skills.mjs: "NO TABLE IN THE PACK BUT WOOD IN IT"). That sub-craft is room-blocked at 36/36 -- and the bag holds
  // bamboo x64 + sticks x32, a fold that frees exactly the slot the table needs.
  for (const [inv, bamboo] of [[SCAFFOLD_INV, 64], [SCAFFOLD_SPLIT, 84]]) {
    const { server, bot } = await setup(inv(), { table: '10,64,0', learn: ['scaffolding'] })
    assert.equal(used(server), 36)
    const since = await mark()
    const out = await craftWith(SKILLS, bot, server, 'scaffolding')
    await new Promise(r => setTimeout(r, 50))
    assert.equal(out.failClass, 'inventory_full', out.detail)
    assert.match(out.detail, /making a crafting_table for scaffolding/, 'the refusal must come from the table sub-craft')
    assert.deepEqual([bambooOf(server), server.count('string'), server.count('oak_planks')], [bamboo, 1, 8], 'the parent\'s ingredients were spent')
    const rows = rowsOf('_bamboo_room', since)
    assert.deepEqual(rows.map(r => [r.args.item, r.args.attempted, r.args.reason]), [['crafting_table', 'no', 'craft_uses_bamboo']], JSON.stringify(rows.map(r => r.detail)))
  }
})

await t('R1-P1 recipeIngredients/keepWith: the chosen recipe\'s names, else every variant\'s; one entry per name', async () => {
  const { server, bot } = await setup(SCAFFOLD_INV(), { learn: ['scaffolding'] })
  server.stop()
  const { recipeIngredients, keepWith } = await import('../src/skills.mjs')
  const def = registry.itemsByName.scaffolding
  const chosen = bot.recipesFor(def.id, null, 1, true)[0]
  assert.deepEqual(recipeIngredients(bot, def, chosen).map(k => k.name).sort(), ['bamboo', 'string'])
  assert.deepEqual(recipeIngredients(bot, def, null).map(k => k.name).sort(), ['bamboo', 'string'], 'no recipe chosen: every variant')
  assert.ok(recipeIngredients(bot, registry.itemsByName.stick, null).some(k => k.name === 'bamboo'), 'stick\'s variants include bamboo')
  assert.deepEqual(keepWith([{ name: 'bamboo', count: 6 }], [{ name: 'bamboo', count: 1 }, { name: 'string', count: 1 }]),
    [{ name: 'bamboo', count: 1 }, { name: 'string', count: 1 }])
})

await t('R1-P2 NO craftsync, NO FOLD: the repro without craftsync -> not attempted (unverifiable), no click, the existing refusal', async () => {
  const { server, bot } = await setup(REPRO_INV(), { sync: false })
  assert.equal(bot.craftSync, undefined, 'positive control: craftsync is really absent')
  const since = await mark()
  const out = await craftWith(SKILLS, bot, server)
  await new Promise(r => setTimeout(r, 50))
  assert.equal(out.failClass, 'inventory_full', out.detail)
  assert.equal(craftClicks(server), 0); assert.equal(server.count('bamboo'), 64)
  assert.deepEqual(rowsOf('_bamboo_room', since).map(r => [r.args.attempted, r.args.reason]), [['no', 'unverifiable']])
  assert.equal(B.foldForCraft({ items: bot.inventory.items(), recipe: PICKAXE }).reason, 'unverifiable', 'the default is NOT verifiable')
})

await t('R1-P2 AN UNANSWERED RECOUNT IS NOT ENABLED: the fold runs, enabled=no, "craft again" (unverified, no tool spent) -- and craft again then succeeds', async () => {
  const { server, bot } = await setup(SPLIT_INV())
  const real = bot.craftSync.recount
  let n = 0
  bot.craftSync.recount = async (...a) => (n++ === 0 ? { source: 'unanswered', items: null } : real(...a))
  const since = await mark()
  const out = await craftWith(SKILLS, bot, server)
  await new Promise(r => setTimeout(r, 50))
  assert.equal(out.failClass, 'unverified', out.detail)
  assert.match(out.detail, /^craft again: /)
  assert.equal(server.count('stone_pickaxe'), 0, 'crafted on an unconfirmed fold')
  assert.equal(server.count('bamboo'), 82, 'positive control: the fold did run')
  assert.deepEqual(rowsOf('_bamboo_room', since).map(r => [r.args.attempted, r.args.enabled, r.args.source]), [['yes', 'no', 'unanswered']])
  // THE REMEDY IT NAMED, executed: craft again (the recount answers now)
  const again = await craftWith(SKILLS, bot, server)
  assert.equal(again.status, 'success', again.detail)
  assert.equal(server.count('stone_pickaxe'), 1); assert.deepEqual(server.dropped, [])
})

/** THE SERVER EATS: bot.consume as the server does it (one food gone from its slot, hunger up), for the eat skill. */
function serverEats (bot, server) {
  bot.food = 10
  bot.consume = async () => {
    const s = server.p.findIndex((it, i) => i >= 9 && i <= 44 && it && nameOf(it) === 'bread')
    if (s < 0) throw new Error('fake: nothing to eat')
    server.p[s].count--; if (!server.p[s].count) server.p[s] = null
    server.sid[0]++
    server.send([['set_slot', { windowId: 0, stateId: server.sid[0], slot: s, item: Item.toNotch(server.p[s]) }]])
    await server.settle()
    bot.food = 15
  }
}
async function refuseEatRetry (inv, prepare = () => {}) {
  const { server, bot } = await setup(inv)
  serverEats(bot, server)
  prepare(bot, server)
  const out = await craftWith(SKILLS, bot, server)
  assert.equal(out.failClass, 'inventory_full', out.detail)
  assert.match(remedyOf(out), /^eat -- eating your one bread frees its slot/, `the remedy named: ${remedyOf(out)}`)
  const ate = await SKILLS.eat.run({ bot }, {}, new AbortController().signal)
  assert.equal(ate.status, 'success', ate.detail)
  assert.equal(used(server), 35, 'positive control: the named remedy freed the slot')
  const again = await craftWith(SKILLS, bot, server)
  assert.equal(again.status, 'success', again.detail)
  assert.equal(server.count('stone_pickaxe'), 1); assert.deepEqual(server.dropped, [])
  return { server, bot }
}

await t('R1-P3 (3) COMPOSED: sticks at the cap -> the refusal names eat -> eat runs -> the craft is retried and succeeds (bamboo untouched)', async () => {
  const { server } = await refuseEatRetry(fullBag({ 36: ['stick', 64], 37: ['cobblestone', 10], 38: ['bamboo', 64], 39: ['bread', 1] }))
  assert.equal(server.count('bamboo'), 64)
})

await t('R1-P3 (4) COMPOSED: a fold that frees nothing -> eat -> the craft succeeds', async () => {
  const { server } = await refuseEatRetry(fullBag({ 36: ['stick', 32], 37: ['cobblestone', 10], 38: ['bamboo', 63], 39: ['bread', 1] }))
  assert.equal(server.count('bamboo'), 63)
})

await t('R1-P3 (5) COMPOSED: the fold runs, a pickup refills its slot -> the refusal names eat -> eat -> the craft succeeds', async () => {
  const { server } = await refuseEatRetry(fullBag({ 36: ['stick', 32], 37: ['cobblestone', 10], 38: ['bamboo', 64], 39: ['bamboo', 10], 40: ['bamboo', 10], 41: ['bread', 1] }),
    (bot, srv) => refillAfterFold(bot, srv))
  assert.equal(server.count('bamboo'), 82, 'the fold ran once')
})

/**
 * THE SERVER'S SIDE OF A WEAR-OUT, which the flat fake world does not model: durability does not survive the fake's
 * item encoding (prismarine-item 1.21.8 round-trips no damage component here), so the spent copy is re-marked on every
 * slot update, a stone block stands beside the bot (with its registry hardness), and the dig breaks the tool on the
 * server. Only what wearOutOne reads is supplied; the choice and the guards are the skill's own.
 */
function spentAxeWorld (bot, server, placed) {
  const spent = it => { if (it?.name === 'wooden_axe') it.durabilityUsed = it.maxDurability - 1 }
  for (const it of bot.inventory.items()) spent(it)
  bot.inventory.on('updateSlot', (_s, _o, it) => spent(it))
  placed.set('-1,64,0', 'stone')
  const blockAt = bot.blockAt
  bot.blockAt = p => { const b = blockAt(p); return b && { ...b, hardness: registry.blocksByName[b.name]?.hardness } }
  bot.equip = async it => { bot.quickBarSlot = it.slot - bot.QUICK_BAR_START }   // mineflayer's heldItem reads the hotbar
  const dug = []
  bot.dig = async block => {
    const s = server.p.findIndex((it, i) => i >= 9 && i <= 44 && it && nameOf(it) === 'wooden_axe')
    server.p[s] = null; server.sid[0]++
    server.send([['set_slot', { windowId: 0, stateId: server.sid[0], slot: s, item: Item.toNotch(null) }]])
    placed.delete(`${block.position.x},${block.position.y},${block.position.z}`)
    dug.push(block.name)
    await server.settle()
  }
  return dug
}

await t('R1-P3 (5) COMPOSED WITH WEAR-OUT: the fold does not make room (refilled) -> craft\'s own wear-out runs -> the craft succeeds', async () => {
  const { server, bot, placed } = await setup(fullBag({ 36: ['stick', 32], 37: ['cobblestone', 10], 38: ['bamboo', 64], 39: ['bamboo', 10], 40: ['bamboo', 10], 41: ['wooden_axe', 1] }))
  const dug = spentAxeWorld(bot, server, placed)
  refillAfterFold(bot, server)
  const since = await mark()
  const out = await craftWith(SKILLS, bot, server)
  await new Promise(r => setTimeout(r, 50))
  assert.equal(out.status, 'success', out.detail)
  assert.deepEqual(dug, ['stone'], 'the wear-out did not dig')
  assert.deepEqual([server.count('stone_pickaxe'), server.count('wooden_axe'), server.count('bamboo')], [1, 0, 82])
  assert.deepEqual(rowsOf('_bamboo_room', since).map(r => [r.args.attempted, r.args.enabled]), [['yes', 'no']])
  assert.match(out.detail, /folding bamboo into sticks did not make room \(stop=done, source=server\); made room by wearing out a spent wooden_axe on stone/)
})

await t('R1-P3 positive control for the wear-out world: the same axe NOT marked spent -> no tool to wear, refusal', async () => {
  const { server, bot } = await setup(fullBag({ 36: ['stick', 64], 37: ['cobblestone', 10], 38: ['wooden_axe', 1] }))
  const out = await craftWith(SKILLS, bot, server)
  assert.equal(out.failClass, 'inventory_full', out.detail)
  assert.match(out.detail, /no spent tool that can be spared/)
})


await t('R1-CLAUDE PROTECT THROUGH THE CHAIN: a whole-tree plan (table, then scaffolding) at 36/36 -> the table step is room-blocked and does NOT fold the bamboo its later step needs', async () => {
  // No table anywhere: craftplan.mjs plans planks -> crafting_table -> scaffolding, and the plan's `protect` (every step's
  // ingredients) is all that stands between the table step's make-room and the scaffolding's 64 bamboo.
  for (const [inv, bamboo] of [[SCAFFOLD_INV, 64], [SCAFFOLD_SPLIT, 84]]) {
    const { server, bot } = await setup(inv(), { table: null, learn: ['scaffolding'] })
    const since = await mark()
    const out = await craftWith(SKILLS, bot, server, 'scaffolding')
    await new Promise(r => setTimeout(r, 50))
    assert.equal(out.failClass, 'inventory_full', out.detail)
    assert.match(out.detail, /\[making crafting_table for scaffolding\]/, 'the refusal must come from the plan\'s table step')
    assert.equal(bambooOf(server), bamboo, 'the later step\'s bamboo was folded')
    assert.deepEqual(rowsOf('_bamboo_room', since).map(r => [r.args.item, r.args.reason]), [['crafting_table', 'craft_uses_bamboo']])
  }
  const { server, bot } = await setup(SCAFFOLD_INV(), { table: null, learn: ['scaffolding'] })
  server.stop()
  assert.ok(B.foldForCraft({ verifiable: true, items: bot.inventory.items(), recipe: { consumes: [{ name: 'oak_planks', count: 4 }], outputs: [{ name: 'crafting_table', count: 1, stackSize: 64 }] } }).fold,
    'positive control: without the plan\'s protection this table step WOULD fold')
})

await t('R1-CLAUDE FOLD BEFORE WEAR-OUT: a spent axe AND foldable bamboo -> the fold runs, the axe survives, the craft succeeds', async () => {
  const { server, bot, placed } = await setup(fullBag({ 36: ['stick', 32], 37: ['cobblestone', 10], 38: ['bamboo', 64], 39: ['bamboo', 10], 40: ['bamboo', 10], 41: ['wooden_axe', 1] }))
  const dug = spentAxeWorld(bot, server, placed)
  const out = await craftWith(SKILLS, bot, server)
  assert.equal(out.status, 'success', out.detail)
  assert.deepEqual(dug, [], 'a tool was worn out although a fold made the room')
  assert.deepEqual([server.count('stone_pickaxe'), server.count('wooden_axe'), server.count('bamboo')], [1, 1, 82])
  assert.match(out.detail, /made room by folding 2 bamboo into 1 sticks/)
})

await t('R1-CLAUDE A NON-ABORT THROW FROM THE FOLD is a fold that did not make room: recorded (refused, reason=error), and the craft goes on to its other remedy', async () => {
  const { server, bot } = await setup(SPLIT_INV())
  // foldExecute's first act on the bot is declaring its stationary window: make that throw
  Object.defineProperty(bot, 'stationaryUntil', { configurable: true, get: () => 0, set: () => { throw new Error('fake: window refused') } })
  const since = await mark()
  const out = await craftWith(SKILLS, bot, server)
  await new Promise(r => setTimeout(r, 50))
  assert.equal(out.failClass, 'inventory_full', out.detail)
  assert.match(out.detail, /folding bamboo into sticks failed: fake: window refused; no spent tool that can be spared/)
  assert.deepEqual(rowsOf('_bamboo_room', since).map(r => [r.skill?.status ?? r.status, r.args.reason]), [['refused', 'error']])
  assert.equal(server.count('bamboo'), 84, 'nothing was folded')
})

await t('R1-CLAUDE the _bamboo_room rows of one craft level share a run id; another craft has another', async () => {
  const a = await setup(fullBag({ 36: ['stick', 64], 37: ['cobblestone', 10], 38: ['bamboo', 64] }))
  const s1 = await mark()
  await craftWith(SKILLS, a.bot, a.server)
  const b = await setup(fullBag({ 36: ['stick', 64], 37: ['cobblestone', 10], 38: ['bamboo', 64] }))
  await craftWith(SKILLS, b.bot, b.server)
  await new Promise(r => setTimeout(r, 50))
  const runs = rowsOf('_bamboo_room', s1).map(r => r.args.run)
  assert.equal(runs.length, 2); assert.ok(runs.every(Boolean)); assert.notEqual(runs[0], runs[1])
})

// DEPOSIT is not composed here: it walks home to the town chest, and the flat fake world has no town, no chest and no
// pathing. Its precondition rules are covered where they live (craft-room.test.mjs: depositTarget / roomAdvice).

// ------------------------------------------------------------------ (6) control: bamboo_sticks is unchanged (bamboo.test.mjs runs it too)
await t('(6) CONTROL: the housekeeping bamboo_sticks order still folds [64,10] + sticks 32 in 5 crafts and frees one slot, through the shared core', async () => {
  const server = new FakePaper({ lagClicks: 3, fallbackMs: FAST.fallbackMs, inventory: fullBag({ 36: ['bamboo', 64], 37: ['bamboo', 10], 38: ['stick', 32] }) })
  const bot = craftBot(server)
  bot.entities = {}; bot.health = 20; bot.food = 20
  await server.sync()
  CS.installCraftSync(bot, { log: () => {}, quietMs: FAST.quietMs })
  learnAll(bot, server, ['stick'])
  const out = await SKILLS.bamboo_sticks.run({ bot }, {}, new AbortController().signal)
  await server.settle(); server.stop()
  assert.equal(out.status, 'success', out.detail)
  assert.deepEqual([server.count('bamboo'), server.count('stick'), used(server)], [64, 37, 35])
  assert.equal(bot.stationaryUntil, 0)
})

// ------------------------------------------------------------------ mutants: each guard removed, a test above fails
const { readFileSync, writeFileSync, unlinkSync } = fs
async function withMutant (file, old, neu, fn) {
  const src = readFileSync(file, 'utf8')
  assert.ok(src.includes(old),
    `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 60))} is not in ${file.pathname}. A mutant that was never written reads as killed.`)
  assert.ok(src.split(old).length === 2, 'the mutation target is not unique; the mutant is ambiguous')
  const body = src.replace(old, neu).replace(/from '\.\//g, "from '../src/")
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, body)
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}
const BAMBOO_PATH = new URL('../src/bamboo.mjs', import.meta.url)
const SKILLS_PATH = new URL('../src/skills.mjs', import.meta.url)

await t('MUTANT KILLED: without ingredient protection a bamboo-consuming craft folds', async () => {
  await withMutant(BAMBOO_PATH, "if (uses.includes('bamboo')) return none(", "if (false) return none(", async M => {
    const bag = [S('bamboo', 64), S('bamboo', 10), S('stick', 32), S('string', 2), ...fill(32)]
    assert.equal(M.foldForCraft({ verifiable: true, items: bag, recipe: SCAFFOLD }).fold, true, 'the mutant still protects bamboo: the test proves nothing')
  })
})

await t('MUTANT KILLED: without the stick cap the 104-stick fold is chosen', async () => {
  await withMutant(BAMBOO_PATH,
    "if (!(sticks + k <= stickCap || st.stickSlots <= sim.stickSlotsBefore)) {\n      note('stick_cap'",
    "if (false) {\n      note('stick_cap'", async M => {
      const capped = [S('bamboo', 64), S('bamboo', 64), S('stick', 40), S('cobblestone', 10), ...fill(31)]
      assert.equal(M.foldForCraft({ verifiable: true, items: capped, recipe: FURNACE, reserve: 1 }).fold, true, 'the mutant still caps sticks')
    })
})

await t('MUTANT KILLED: without the after-bag check a fold that cannot cover the held-back slot is chosen', async () => {
  await withMutant(BAMBOO_PATH, 'if (!craftRoom(st.bag, recipe, 1, { capacity: capacity - reserve }).ok) {', 'if (false) {', async M => {
    assert.equal(M.foldForCraft({ verifiable: true, items: REPRO(), recipe: PICKAXE, reserve: 1 }).fold, true, 'the mutant still checks the after-bag')
  })
})

await t('MUTANT KILLED: craft without the fold hook refuses the reviewer\'s repro', async () => {
  await withMutant(SKILLS_PATH, '  if (rs?.fold && !rs.folded) {', '  if (false) {', async M => {
    const { out, server } = await reproCase(M.SKILLS)
    assert.equal(out.failClass, 'inventory_full', `the mutant crafted anyway: ${out.detail}`)
    assert.equal(server.count('stone_pickaxe'), 0)
  })
})

await t('MUTANT KILLED: without the server verification a refilled bag is recorded as enabled', async () => {
  await withMutant(SKILLS_PATH, 'const enabled = answered && craftRoomNow(bot, plan, owed, bag).ok', 'const enabled = true', async M => {
    const { server, bot } = await setup(SPLIT_INV())
    refillAfterFold(bot, server)
    const since = await mark()
    await craftWith(M.SKILLS, bot, server)
    await new Promise(r => setTimeout(r, 50))
    assert.deepEqual(rowsOf('_bamboo_room', since).map(r => r.args.enabled), ['yes'], 'the mutant still verified')
  })
})

await t('MUTANT KILLED: without the one-fold bound the second make-room try folds again', async () => {
  await withMutant(SKILLS_PATH, '  if (rs?.fold && !rs.folded) {', '  if (rs?.fold) {', async M => {
    const { server, bot } = await setup(SPLIT_INV())
    refillAfterVerify(bot, server)
    const since = await mark()
    await craftWith(M.SKILLS, bot, server)
    await new Promise(r => setTimeout(r, 50))
    assert.equal(rowsOf('_bamboo_room', since).filter(r => r.args.attempted === 'yes').length, 2, 'the mutant folded once only')
    assert.equal(server.count('bamboo'), 64, 'the second fold is the 9-craft one')
  })
})

const withMutantsAll = async (file, pairs, fn) => {
  let src = readFileSync(file, 'utf8')
  for (const [old, neu] of pairs) {
    assert.ok(src.includes(old), `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 60))}`)
    assert.ok(src.split(old).length === 2, 'the mutation target is not unique; the mutant is ambiguous')
    src = src.replace(old, neu)
  }
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, src.replace(/from '\.\//g, "from '../src/"))
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}
const PEAK = "if (peak > capacity) { note('needs_room'"
const TOSS = "if (st.tossed > 0) { note('needs_room'"
// bamboo [64, 2], no sticks, at 36/36: the slot-order fold consolidates and never throws, but craftRoom's conservative
// largest-first PEAK needs a 37th slot on the first craft -- only the peak check refuses it
const PEAK_BAG = () => [S('bamboo', 64), S('bamboo', 2), S('cobblestone', 10), ...fill(33)]
// bamboo [64, 64], no sticks, at 36/36: the first craft's stick has nowhere to go -- thrown -- and the peak is over too
const TOSS_BAG = () => [S('bamboo', 64), S('bamboo', 64), S('cobblestone', 10), ...fill(33)]

await t('MUTANT KILLED: without the PEAK check a fold needing a temporary 37th slot is chosen', async () => {
  assert.equal(B.foldForCraft({ verifiable: true, items: PEAK_BAG(), recipe: FURNACE }).reason, 'needs_room', 'the real decision refuses')
  await withMutant(BAMBOO_PATH, PEAK, "if (false) { note('needs_room'", async M => {
    assert.equal(M.foldForCraft({ verifiable: true, items: PEAK_BAG(), recipe: FURNACE }).fold, true, 'the mutant still checks the peak')
  })
})

await t('MUTANT KILLED: the TOSS check is the guard once the peak check is gone (both removed -> a throwing fold is chosen)', async () => {
  // EQUIVALENT ON ITS OWN: every bag where the slot-order fold throws also overruns craftRoom's conservative peak, so a
  // toss-only mutant cannot be told apart from the original by any bag. Shown instead: with the peak check removed the
  // toss check alone still refuses, and removing both lets the throwing fold through.
  await withMutant(BAMBOO_PATH, PEAK, "if (false) { note('needs_room'", async M => {
    assert.equal(M.foldForCraft({ verifiable: true, items: TOSS_BAG(), recipe: FURNACE }).fold, false, 'the toss check alone must refuse')
  })
  await withMutantsAll(BAMBOO_PATH, [[PEAK, "if (false) { note('needs_room'"], [TOSS, "if (false) { note('needs_room'"]], async M => {
    assert.equal(M.foldForCraft({ verifiable: true, items: TOSS_BAG(), recipe: FURNACE }).fold, true, 'the mutant still refuses the toss')
  })
})

await t('MUTANT KILLED: the TOSS check alone (the reviewer\'s surviving mutant) -- the throw guard does not depend on the capacity the peak is measured against', async () => {
  // The bag's 36 physical slots (simulateFold) are fixed; craftRoom's peak is checked against `capacity`. With a
  // looser capacity the peak passes and only the toss check stands between the fold and a stick on the ground.
  assert.equal(B.foldForCraft({ verifiable: true, items: TOSS_BAG(), recipe: FURNACE, capacity: 37, reserve: 1 }).fold, false, 'the real decision refuses')
  await withMutant(BAMBOO_PATH, TOSS, "if (false) { note('needs_room'", async M => {
    assert.equal(M.foldForCraft({ verifiable: true, items: TOSS_BAG(), recipe: FURNACE, capacity: 37, reserve: 1 }).fold, true, 'the mutant still refuses the toss')
  })
})

await t('MUTANT KILLED: without the plan\'s `protect` the table step folds the scaffolding\'s bamboo', async () => {
  await withMutant(SKILLS_PATH, 'protect: keepWith(protect, rs.keep) })', 'protect: keepWith([], rs.keep) })', async M => {
    const { server, bot } = await setup(SCAFFOLD_SPLIT(), { table: null, learn: ['scaffolding'] })
    await craftWith(M.SKILLS, bot, server, 'scaffolding')
    assert.ok(bambooOf(server) < 84, `the mutant kept the bamboo (${bambooOf(server)})`)
  })
})

await t('MUTANT KILLED: wear-out first (the fold only when no spent tool) spends the axe the fold would have saved', async () => {
  await withMutant(SKILLS_PATH, '  if (rs?.fold && !rs.folded) {', '  if (rs?.fold && !rs.folded && !craftRoomRemedy(bot.inventory.items(), item)) {', async M => {
    const { server, bot, placed } = await setup(fullBag({ 36: ['stick', 32], 37: ['cobblestone', 10], 38: ['bamboo', 64], 39: ['bamboo', 10], 40: ['bamboo', 10], 41: ['wooden_axe', 1] }))
    const dug = spentAxeWorld(bot, server, placed)
    const out = await craftWith(M.SKILLS, bot, server)
    assert.equal(out.status, 'success', out.detail)
    assert.deepEqual([dug, server.count('wooden_axe'), server.count('bamboo')], [['stone'], 0, 84], 'the mutant still folded first')
  })
})

await t('MUTANT KILLED: accepting an unanswered recount as the server\'s word crafts on an unconfirmed fold', async () => {
  await withMutant(SKILLS_PATH, "const answered = source === 'server'", "const answered = source === 'server' || source === 'unanswered'", async M => {
    const { server, bot } = await setup(SPLIT_INV())
    const real = bot.craftSync.recount
    let n = 0
    bot.craftSync.recount = async (...a) => (n++ === 0 ? { source: 'unanswered', items: null } : real(...a))
    const out = await craftWith(M.SKILLS, bot, server)
    assert.equal(out.status, 'success', `the mutant still refused: ${out.detail}`)
  })
})

await t('MUTANT KILLED: without the verifiable gate a fold runs with no craftsync to confirm it', async () => {
  await withMutant(BAMBOO_PATH, "if (!verifiable) return none('unverifiable'", "if (false) return none('unverifiable'", async M => {
    assert.equal(M.foldForCraft({ items: REPRO(), recipe: PICKAXE }).fold, true, 'the mutant still requires verifiable')
  })
})

await t('MUTANT KILLED: without the ancestors\' ingredients the far-table sub-craft folds the scaffolding\'s bamboo', async () => {
  await withMutant(SKILLS_PATH, 'protect: keepWith(protect, rs.keep) })', 'protect })', async M => {
    const { server, bot } = await setup(SCAFFOLD_SPLIT(), { table: '10,64,0', learn: ['scaffolding'] })
    await craftWith(M.SKILLS, bot, server, 'scaffolding')
    assert.ok(bambooOf(server) < 84, `the mutant kept the bamboo (${bambooOf(server)}): the chain test proves nothing`)
  })
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
