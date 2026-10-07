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
  const d = B.foldForCraft({ items: REPRO(), recipe: PICKAXE })
  assert.deepEqual([d.fold, d.crafts, d.freed, d.before, d.after], [true, 32, 1, 36, 35], d.why)
})

await t('INGREDIENT PROTECTION: a craft that consumes bamboo never folds (positive control: the same bag and shape without bamboo folds)', () => {
  const bag = [S('bamboo', 64), S('bamboo', 10), S('stick', 32), S('string', 2), ...fill(32)]
  assert.equal(bag.length, 36)
  const ctl = B.foldForCraft({ items: bag, recipe: LEAD })
  assert.equal(ctl.fold, true, `positive control: ${ctl.why}`)
  const d = B.foldForCraft({ items: bag, recipe: SCAFFOLD })
  assert.deepEqual([d.fold, d.reason], [false, 'craft_uses_bamboo'], d.why)
  const p = B.foldForCraft({ items: bag, recipe: LEAD, protect: [{ name: 'bamboo', count: 9 }] })
  assert.deepEqual([p.fold, p.reason], [false, 'craft_uses_bamboo'], 'a plan\'s later step needs bamboo: protected too')
})

await t('STICK CAP: a fold that frees a slot only by passing 64 sticks with a NEW stick slot is refused (control: no sticks -> it folds)', () => {
  // 35/36 and one slot held back (a table to take back): the furnace needs 2 more; 64 crafts empty both bamboo stacks
  const capped = [S('bamboo', 64), S('bamboo', 64), S('stick', 40), S('cobblestone', 10), ...fill(31)]
  assert.equal(capped.length, 35)
  const d = B.foldForCraft({ items: capped, recipe: FURNACE, reserve: 1 })
  assert.deepEqual([d.fold, d.reason], [false, 'stick_cap'], d.why)
  const ctl = B.foldForCraft({ items: [S('bamboo', 64), S('bamboo', 64), S('cobblestone', 10), ...fill(32)], recipe: FURNACE, reserve: 1 })
  assert.deepEqual([ctl.fold, ctl.crafts, ctl.freed], [true, 64, 1], `positive control: ${ctl.why}`)
})

await t('STICKS AT THE CAP (64): nothing a fold makes frees a slot -> no fold', () => {
  const d = B.foldForCraft({ items: [S('bamboo', 64), S('stick', 64), S('cobblestone', 10), ...fill(33)], recipe: PICKAXE })
  assert.equal(d.fold, false, d.why)
})

await t('THE CRAFT MUST FIT ON THE BAG THE FOLD LEAVES: a held-back slot the fold cannot also cover -> no fold (control: no reserve -> fold)', () => {
  const d = B.foldForCraft({ items: REPRO(), recipe: PICKAXE, reserve: 1 })
  assert.deepEqual([d.fold, d.reason], [false, 'not_enough'], d.why)
  assert.equal(B.foldForCraft({ items: REPRO(), recipe: PICKAXE, reserve: 0 }).fold, true, 'positive control')
})

await t('NOTHING TO SOLVE: a craft that fits, a craft short of an ingredient, a fold that frees nothing (bamboo x63: an odd remainder)', () => {
  assert.equal(B.foldForCraft({ items: [S('bamboo', 64), S('stick', 32), S('cobblestone', 10), ...fill(30)], recipe: PICKAXE }).reason, 'fits')
  assert.equal(B.foldForCraft({ items: [S('bamboo', 64), S('stick', 32), ...fill(34)], recipe: PICKAXE }).reason, 'ingredients')
  const odd = B.foldForCraft({ items: [S('bamboo', 63), S('stick', 32), S('cobblestone', 10), ...fill(33)], recipe: PICKAXE })
  assert.equal(odd.fold, false, odd.why)
  assert.equal(B.foldForCraft({ items: [S('stick', 32), S('cobblestone', 10), ...fill(34)], recipe: PICKAXE }).reason, 'no_bamboo')
})

await t('THE WINDOW: a fold that cannot finish in the time the craft has left is refused (32 crafts need 46.6 s)', () => {
  const d = B.foldForCraft({ items: REPRO(), recipe: PICKAXE, leftMs: 20_000 })
  assert.deepEqual([d.fold, d.reason], [false, 'too_long'], d.why)
  assert.equal(B.foldForCraft({ items: REPRO(), recipe: PICKAXE, leftMs: 60_000 }).fold, true, 'positive control')
})

await t('simulateFold\'s `bags` option is additive: the same steps without it, and the last bag matches the counts', () => {
  const plain = B.simulateFold(REPRO(), 32)
  const withBags = B.simulateFold(REPRO(), 32, { bags: true })
  assert.deepEqual(withBags.steps.map(({ bag, ...s }) => s), plain.steps)
  const last = withBags.steps.at(-1).bag
  assert.equal(last.length, 35)
  assert.equal(last.filter(s => s.name === 'stick').reduce((n, s) => n + s.count, 0), 64)
  assert.equal(last.some(s => s.name === 'bamboo'), false)
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
async function setup (inv, { table = '1,64,0' } = {}) {
  const server = new FakePaper({ lagClicks: 3, fallbackMs: FAST.fallbackMs, inventory: inv })
  const bot = craftBot(server)
  const placed = fakeWorld(bot, server)
  if (table) placed.set(table, 'crafting_table')
  bot.entities = {}; bot.health = 20; bot.food = 20
  await server.sync()
  const rows = []
  CS.installCraftSync(bot, { log: r => rows.push(r), quietMs: FAST.quietMs })
  learnAll(bot, server, ['stone_pickaxe', 'stick', 'crafting_table'])
  return { server, bot, rows }
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
  assert.equal(B.foldForCraft({ items: SPLIT_ITEMS(), recipe: PICKAXE }).crafts, 1, 'the split bag folds in one craft')
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
  assert.ok(B.foldForCraft({ items: bot.inventory.items(), recipe: PICKAXE }).fold, 'positive control: a second fold WAS available')
})

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
    assert.equal(M.foldForCraft({ items: bag, recipe: SCAFFOLD }).fold, true, 'the mutant still protects bamboo: the test proves nothing')
  })
})

await t('MUTANT KILLED: without the stick cap the 104-stick fold is chosen', async () => {
  await withMutant(BAMBOO_PATH,
    "if (!(sticks + k <= stickCap || st.stickSlots <= sim.stickSlotsBefore)) {\n      note('stick_cap'",
    "if (false) {\n      note('stick_cap'", async M => {
      const capped = [S('bamboo', 64), S('bamboo', 64), S('stick', 40), S('cobblestone', 10), ...fill(31)]
      assert.equal(M.foldForCraft({ items: capped, recipe: FURNACE, reserve: 1 }).fold, true, 'the mutant still caps sticks')
    })
})

await t('MUTANT KILLED: without the after-bag check a fold that cannot cover the held-back slot is chosen', async () => {
  await withMutant(BAMBOO_PATH, 'if (!craftRoom(st.bag, recipe, 1, { capacity: capacity - reserve }).ok) {', 'if (false) {', async M => {
    assert.equal(M.foldForCraft({ items: REPRO(), recipe: PICKAXE, reserve: 1 }).fold, true, 'the mutant still checks the after-bag')
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
  await withMutant(SKILLS_PATH, 'const enabled = witnessed && craftRoomNow(bot, plan, owed, bag).ok', 'const enabled = true', async M => {
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

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
