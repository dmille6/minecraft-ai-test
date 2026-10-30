// COBBLEKEEP-01: why bots keep their cobble (measured 10-19, docs/reports/cobblekeep-01-cause-2026-10-19.md). Of 613 town
// deposits in 24 h, 609 refused the bag's cobble: 446 `town_cobble_unknown` (a town container never counted: lid=dirt on
// 3,774 of 4,200 `_lid_clear` refusals in 60 h, oak_leaves on 422) and 163 `town_cobble_cap`; and the well, the cap's
// only other exit, threw cobble on 33 of 232 visits, because its switch read the 1 h floor alone. Three changes:
//   1. lidrule.mjs LID_BREAKABLE: dirt and grass_block may be broken off a town chest's lid;
//   2. lidrule.mjs chestLidBlocked: a never-conductor block (leaves, glass) is not a lid -- the bot opens, the open is proof;
//   3. cobblecap.mjs wellCobbleSwitch: a stack the bank's own admission refuses at the cap on COUNTED stock goes down the
//      well (no incoming reservation; cobble a withdraw holds never does).
// Behaviour first: the pure rules, then THE REFUSAL CHAIN through the real count_town / town_deposit, then anchored mutants
// (the anchor present and unique, or the mutant does not count as killed).
import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'

process.env.LOG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-ck-logs-'))
process.env.BOT_NAME = 'KeepBot'
process.env.OLLAMA_MODEL ??= 'qwen2.5:7b-instruct'
process.env.HOME_X = '0'; process.env.HOME_Y = '64'; process.env.HOME_Z = '0'
process.env.SKILL_TIMEOUT_MS = '180000'
process.env.POOL_STATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-ck-pool-'))

const L = await import('../src/lidrule.mjs')
const B = await import('../src/bankable.mjs')
const CC = await import('../src/cobblecap.mjs')
const SK = await import('../src/skills.mjs')
const { tapRecords } = await import('../src/logger.mjs')
const { fakeWorld, stack, tool } = await import('./fakeworld.mjs')
const { SKILLS, installCobbleCap, cobbleObserve } = SK

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 4).join('\n        ')}`) }
}
const RECS = []
tapRecords(r => RECS.push(r))
const rowsSince = (n0, kind) => RECS.slice(n0).filter(x => x.skill?.name === kind).map(x => x.skill.detail)
const SKILLS_PATH = new URL('../src/skills.mjs', import.meta.url)
const LID_PATH = new URL('../src/lidrule.mjs', import.meta.url)
const CAP_PATH = new URL('../src/cobblecap.mjs', import.meta.url)
async function withMutant (p, old, neu, fn) {
  const src = readFileSync(p, 'utf8')
  assert.ok(src.includes(old), `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 70))} is not in ${p.pathname}. A mutant that was never written reads as killed.`)
  assert.ok(src.split(old).length === 2, 'the mutation target is not unique; the mutant is ambiguous')
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, src.replace(old, neu).replace(/from '\.\//g, "from '../src/"))
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}
const CAP = CC.TOWN_COBBLE_CAP
const AIR = { name: 'air', boundingBox: 'empty', shapes: [] }
const cube = name => ({ name, boundingBox: 'block', shapes: [[0, 0, 0, 1, 1, 1]] })
const sides4 = (b = AIR) => [b, b, b, b]

// ------------------------------------------------------------------------------------------------ the pure rules
await t('LID RULE: dirt and grass_block may be broken off a lid now (the fleet\'s blocker, named by the `_lid_clear` row); planks, logs, glass, leaves and storage still may not; the hazards still refuse dirt', () => {
  const ok = (lid, extra = {}) => L.lidClearRefusal({ lid: { name: lid }, above: AIR, sides: sides4(), ...extra })
  for (const n of ['cobblestone', 'cobbled_deepslate', 'dirt', 'grass_block']) assert.equal(ok(n), null, `${n} is clearable`)
  for (const n of ['coarse_dirt', 'rooted_dirt', 'podzol', 'stone_bricks', 'oak_planks', 'oak_log', 'chest', 'barrel', 'glass', 'oak_leaves', 'composter', 'farmland']) {
    assert.match(ok(n) ?? '', /is not a block a bot may break/, `${n} is refused`)
  }
  assert.match(ok('dirt', { well: true }), /junk well/)
  assert.match(L.lidClearRefusal({ lid: { name: 'dirt' }, above: { name: 'water' }, sides: sides4() }), /water or lava/)
  assert.match(L.lidClearRefusal({ lid: { name: 'dirt' }, above: { name: 'sand' }, sides: sides4() }), /would fall/)
  assert.equal(L.lidClearRefusal({ lid: { name: 'dirt' }, above: cube('dirt'), sides: sides4() }), null, 'a dirt column above stays up (dirt does not fall)')
  assert.ok(L.serverLidBlocks(cube('dirt')) && L.serverLidBlocks(cube('grass_block')), 'positive control: both DO block a chest on the server, so clearing them is needed')
})
await t('LID TEST: leaves and glass are not a lid to the bot -- the server opens a chest under them; dirt, stone, cobblestone, a shape-less solid, and the never-conductors NOT measured on Paper (observer, piston, redstone_block) still are', () => {
  for (const n of ['oak_leaves', 'birch_leaves', 'glass', 'white_stained_glass']) {
    assert.equal(L.chestLidBlocked(cube(n)), false, `${n} does not block`)
    assert.equal(L.serverLidBlocks(cube(n)), false, `${n}: the server rule agrees`)
  }
  for (const n of ['dirt', 'grass_block', 'stone', 'cobblestone']) assert.equal(L.chestLidBlocked(cube(n)), true, `${n} blocks`)
  assert.equal(L.chestLidBlocked({ name: 'dirt', boundingBox: 'block' }), true, 'a solid without shapes is assumed full')
  assert.equal(L.chestLidBlocked({ boundingBox: 'block' }), true, 'a nameless solid is assumed full (never on a guess)')
  assert.equal(L.chestLidBlocked(AIR), false)
  for (const n of ['observer', 'piston', 'redstone_block']) {
    assert.equal(L.chestLidBlocked(cube(n)), true, `${n}: unmeasured, still a lid to the bot`)
    assert.equal(L.serverLidBlocks(cube(n)), false, `${n}: the census rule still says the server would open it`)
  }
})
await t('WELL SWITCH, pure: the floor as before; the bank\'s own at-cap refusal of THIS stack on counted stock; incoming reservations never; outgoing takes come off; a withdraw hold keeps it', () => {
  const S = CC.wellCobbleSwitch
  const v = (lb, extra = {}) => ({ lb, lbLo: lb, avail: 0, taking: 0, reserved: 0, complete: true, ...extra })
  assert.equal(S(v(984), 0), 'none', 'no surplus stack')
  assert.equal(S(v(0, { avail: CAP }), 64), 'at_cap', 'the fresh floor at the cap (stonecap, unchanged)')
  // THE BAND: the bank refuses a stack that would pass the cap, so before this nothing moved it
  assert.equal(CC.cobbleAdmit(v(984), 30), 'at_cap', 'positive control: the bank refuses the 30 at 984')
  assert.equal(S(v(984), 30), 'at_cap', '984 counted, a 30: the bank refuses it, so the well takes it')
  assert.equal(S(v(970), 30), 'below', '970 + 30 = the cap: the bank admits it, the well keeps it')
  assert.equal(S(v(CAP - 64), 64), 'below', 'room for exactly the 64')
  assert.equal(S(v(CAP - 63), 64), 'at_cap', 'one short of room for the 64')
  assert.equal(S(v(CAP + 27), 64), 'at_cap', 'over the cap')
  // completeness: a partial count proves the cap only as a lower bound at or past it
  assert.equal(S(v(984, { complete: false }), 30), 'unknown', 'a partial 984 + 30: an uncounted container may hold anything -- not proof')
  assert.equal(S(v(CAP, { complete: false }), 30), 'at_cap', 'a partial count already AT the cap is proof (a lower bound)')
  assert.equal(S(v(500, { complete: false }), 64), 'unknown')
  // INCOMING never proves it (Codex r1 P1): 936 counted + 64 on its way is not the cap held
  assert.equal(CC.cobbleAdmit(v(CAP - 64, { reserved: 64 }), 64), 'at_cap', 'positive control: the bank refuses with the reservation')
  assert.equal(S(v(CAP - 64, { reserved: 64 }), 64), 'below', 'the well does not count it')
  // OUTGOING comes off: 1000 counted with 64 being taken out is 936 -- room for a 64
  assert.equal(S(v(CAP, { taking: 64 }), 64), 'below')
  assert.equal(S(v(CAP, { taking: 63 }), 64), 'at_cap')
  // a withdraw's hold (plinth funds, a smeltjob's cobble): never thrown, even at the cap
  assert.equal(S(v(CAP, { avail: CAP }), 64, { held: 64 }), 'held')
  assert.equal(S(v(CAP, { avail: CAP }), 64, { held: 0 }), 'at_cap', 'positive control')
  assert.equal(S(null, 64), 'unknown', 'no view')
  // THE CEILING NEVER AUTHORISES A DISPOSAL (Codex r1 P1): lb keeps the LARGER of two equal captures, lbLo the smaller
  assert.equal(S(v(CAP, { lbLo: CAP - 64 }), 64), 'below', 'two equal captures 936 / 1000: the well rests on the 936')
  assert.equal(S({ lb: CAP, avail: 0, complete: true }, 64), 'below', 'a view without lbLo counts 0 (fail closed)')
})
await t('WELL SWITCH, journal-level (Codex r1 P1): a withdrawal\'s releasing count 936 then a DELAYED equal-time count 1000 -> lb 1000 (the bank\'s ceiling) but the well reads 936 and keeps the 64', () => {
  const T1 = Date.now() - 60_000, T2 = Date.now() - 30_000, k = '5,64,0'
  const recs = [
    { t: 'obs', k, n: CAP, cap: T1 },
    { t: 'claim', id: 'draw1', n: 64, k, at: T1 + 1, kind: 'draw', g: 'cobble', bot: 'Other', keys: [k], coverage: true },
    { t: 'cnt', k, n: CAP - 64, cap: T2, ids: ['draw1'] },
    { t: 'obs', k, n: CAP, cap: T2 }   // another bot's window from before the withdrawal, appended late with the same capture time
  ]
  const { state } = CC.foldJournal(recs)
  const view = CC.townStock(state, [k], Date.now(), { coverage: true })
  assert.equal(view.lb, CAP, 'positive control: the ceiling took the larger')
  assert.equal(view.lbLo, CAP - 64, 'the smaller is kept for a disposal')
  assert.equal(view.taking, 0, 'the draw was released')
  assert.equal(CC.cobbleAdmit(view, 64), 'at_cap', 'the bank refuses on the ceiling (unchanged, conservative)')
  assert.equal(CC.wellCobbleSwitch(view, 64), 'below', 'the well does not destroy on it')
  assert.equal(CC.wellCobbleSwitch(view, 65), 'at_cap', 'positive control: 936 + 65 would pass the cap even on the smaller count')
})
await t('LICENCE: the mode detail names the rule; features.mjs::installFeatures (from the index.mjs spawn handler) writes `_cobblekeep_mode` once per spawn on the executable path (comments stripped)', () => {
  assert.equal(CC.cobbleKeepModeDetail(), `phase=mode well=admission lid=dirt,grass_block open=leaves,glass cap=${CAP}`)
  const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  const wired = src => {
    const c = strip(src)
    assert.match(c, /^import \{ cobbleKeepModeDetail \} from '\.\/cobblecap\.mjs'/m, 'imported')
    const i = c.indexOf('installCobbleCap(bot)')
    assert.ok(i > 0, 'anchor')
    assert.match(c.slice(i, i + 6000), /\n\s*try \{ logEvent\(\{ kind: 'cobblekeep_mode', status: 'success', snapshot: snapshot\(bot\), detail: cobbleKeepModeDetail\(\) \}\) \} catch \{\}/, 'written on spawn')
  }
  const idx = readFileSync(new URL('../src/features.mjs', import.meta.url), 'utf8')
  wired(idx)
  const row = "  try { logEvent({ kind: 'cobblekeep_mode'"
  assert.equal(idx.split(row).length, 2, 'ANCHOR MISSING or not unique')
  assert.throws(() => wired(idx.replace(row, "  try { void ({ kind: 'cobblekeep_mode'")), 'a removed row is caught')
  assert.throws(() => wired(idx.replace("detail: cobbleKeepModeDetail() }) } catch {}", "detail: 'phase=mode' }) } catch {}")), 'a literal detail is caught')
})

// ------------------------------------------------------------------------------- THE REFUSAL CHAIN, through real code
// A town chest at 5,64,0 (home 0,64,0) in the fake world, fenced (the journal reset) so the town is UNKNOWN until it is
// counted again; the fake server refuses an open under a block the server rule says blocks (lidrule.mjs serverLidBlocks).
const lidWorld = (bag = []) => {
  process.env.POOL_STATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-ck-pool-'))
  const w = fakeWorld({ bag })
  w.set(5, 64, 0, 'chest')
  w.digs = []
  const blockAt0 = w.bot.blockAt
  w.bot.blockAt = p => { const b = blockAt0(p); if (b?.name === 'chest') b.shapes = [[0.0625, 0, 0.0625, 0.9375, 0.875, 0.9375]]; return b }
  w.bot.digTime = () => 750
  w.bot.canDigBlock = () => true
  w.bot.dig = async b => { w.digs.push(w.key(b.position.x, b.position.y, b.position.z)); w.set(b.position.x, b.position.y, b.position.z, 'air') }
  const open0 = w.bot.openContainer.bind(w.bot)
  w.bot.openContainer = async b => {
    if (L.serverLidBlocks(w.bot.blockAt(b.position.offset(0, 1, 0)))) throw new Error('Event windowOpen did not fire within timeout of 20000ms')
    return open0(b)
  }
  return w
}
const fenced = async (bag, lid) => {
  const w = lidWorld(bag)
  installCobbleCap(w.bot); B.setStockWellProbe(() => true)
  await cobbleObserve(w.bot, { x: 5, y: 64, z: 0 }, await w.bot.openContainer(w.bot.blockAt({ x: 5, y: 64, z: 0 })))
  const dir = process.env.POOL_STATE_DIR
  const key = fs.readdirSync(dir).find(f => f.endsWith('.cobble.jsonl')).replace('.cobble.jsonl', '')
  await new Promise(r => setTimeout(r, 5))
  CC.appendJournal(dir, key, w.bot.worldId ?? null, { t: 'reset', at: Date.now() - 1 })
  if (lid) w.set(5, 65, 0, lid)
  return { w, dir, key }
}
// bag items carry their INVENTORY slot (mineflayer's Item.slot): the cobble rule chooses whole stacks by slot
const slotted = list => list.map((s, i) => ({ ...s, slot: 9 + i }))
const cobbleBag = () => slotted([stack('cobblestone', 64), stack('cobblestone', 64), stack('cobblestone', 64), stack('cobblestone', 40), tool('stone_pickaxe', 10)])
const runCount = (M, w) => M.SKILLS.count_town.run({ bot: w.bot }, {}, new AbortController().signal)
const capWhy = w => B.bankableExclusion(w.bot.inventory.items(), 'cobblestone')
const chain = async (M, lid) => {
  const { w } = await fenced(cobbleBag(), lid)
  M.resetCobbleReconcile?.(); SK.resetCobbleReconcile()
  const before = capWhy(w)
  const n0 = RECS.length
  const r = await runCount(M, w)
  return { w, before, r, after: capWhy(w), recount: rowsSince(n0, '_stock_recount')[0] ?? '', lid: rowsSince(n0, '_lid_clear')[0] ?? '', bank: B.bankableInventory(w.bot.inventory.items(), { wants: [] }).detail.cobblestone ?? 0 }
}

await t('CHAIN (dirt lid): count_town -> walks, digs the DIRT off the lid, opens, counts -> the town\'s cobble is no longer UNKNOWN and the bag\'s surplus is bankable', async () => {
  try {
    const c = await chain(SK, 'dirt')
    assert.equal(c.before, 'town_cobble_unknown', 'positive control: the town could not judge the cobble')
    assert.equal(c.r.status, 'success', c.r.detail)
    assert.deepEqual(c.w.digs, ['5,65,0'], 'the lid was dug')
    assert.match(c.lid, /^outcome=dug by=count_town at=5,64,0 .*lid=dirt /)
    assert.match(c.recount, /counted=1 tried=1 unknown_after=0 /)
    assert.equal(c.after, null, 'judged: nothing excludes the cobble now')
    assert.equal(c.bank, 40, 'judged on the count: whole stacks above the reserve, smallest first, within the visit\'s 64 credit')
  } finally { B.setStockReaders({ town: null, well: null }) }
})
await t('CHAIN (grass_block lid): the same -- lit dirt turns to grass', async () => {
  try {
    const c = await chain(SK, 'grass_block')
    assert.deepEqual(c.w.digs, ['5,65,0']); assert.equal(c.after, null)
  } finally { B.setStockReaders({ town: null, well: null }) }
})
await t('CHAIN (leaves on the lid): count_town opens WITHOUT a dig (the server opens a chest under leaves) and counts; no `_lid_clear` row', async () => {
  try {
    const c = await chain(SK, 'oak_leaves')
    assert.equal(c.before, 'town_cobble_unknown')
    assert.deepEqual(c.w.digs, [], 'nothing dug')
    assert.equal(c.lid, '', 'not judged a lid')
    assert.match(c.recount, /counted=1 tried=1 unknown_after=0 /)
    assert.equal(c.after, null)
  } finally { B.setStockReaders({ town: null, well: null }) }
})
await t('CHAIN, POSITIVE CONTROL OF THE INSTRUMENT: planks on the lid are still refused -- never walked, never counted, the cobble still UNKNOWN', async () => {
  try {
    // lidplank-01: unrecorded planks may be dug now (lidclear.test.mjs LIDPLANK-01); stone (not cobblestone) is a never-breakable lid
    const c = await chain(SK, 'stone')
    assert.deepEqual(c.w.digs, [])
    assert.match(c.lid, /^outcome=refused .*lid=stone /)
    assert.match(c.recount, /unknown_after=1 .*fails=lid_blocked:1 /)
    assert.equal(c.after, 'town_cobble_unknown')
  } finally { B.setStockReaders({ town: null, well: null }) }
})

// THE WELL'S SWITCH ON A COUNTED TOWN (the deposit -> well chain through the real town_deposit is in towndeposit.test.mjs,
// whose world models the deposit's clicks): one chest in town, counted complete at n two hours ago -- past the floor's hour,
// inside the cap's six -- which is how the fleet's towns look (the floor read 0-98% of the 6 h count on 10-19).
const atCapTown = async (n, bag) => {
  const w = lidWorld(bag)
  installCobbleCap(w.bot); B.setStockWellProbe(() => true)
  const dir = process.env.POOL_STATE_DIR
  // the chest's only count: n, captured 2 h ago (the key is the town's own: chestfull.mjs townKey of home)
  const { townKey } = await import('../src/chestfull.mjs')
  CC.appendJournal(dir, townKey({ x: 0, y: 64, z: 0 }), w.bot.worldId ?? null, { t: 'obs', k: '5,64,0', n, cap: Date.now() - 2 * 3600e3 })
  return w
}
const fullCobbleBag = () => slotted([stack('cobblestone', 30), ...Array.from({ length: 35 }, () => stack('cobblestone', 64))])
await t('WELL SWITCH, the bot\'s own view: a town counted complete at 984 two hours ago -> at_cap (floor 0: stonecap said `below`); at 936 -> below (the bank has room for the 30)', async () => {
  try {
    const w = await atCapTown(CAP - 16, fullCobbleBag())
    const v = SK.cobbleTownViewFor(w.bot)
    assert.equal(v.complete, true, 'positive control: the count is complete'); assert.equal(v.lb, CAP - 16); assert.equal(v.avail, 0, 'and off the 1 h floor')
    assert.equal(CC.cobbleAdmit(v, 30), 'at_cap', 'positive control: the bank refuses the 30')
    assert.equal(SK.cobbleWellCap(w.bot), 'at_cap')
    const w2 = await atCapTown(CAP - 64, fullCobbleBag())
    assert.equal(SK.cobbleWellCap(w2.bot), 'below')
  } finally { B.setStockReaders({ town: null, well: null }) }
})
await t('WELL SWITCH, THE STACK CHOSEN (Claude r1 P2-2): town at CAP-50, bag [30, 64 x 34] -> below (the 30 fits the bank); the switch must judge the SMALLEST surplus stack', async () => {
  try {
    const w = await atCapTown(CAP - 50, fullCobbleBag())
    assert.equal(CC.cobbleAdmit(SK.cobbleTownViewFor(w.bot), 30), 'bank', 'positive control: the bank admits the 30')
    assert.equal(SK.cobbleWellCap(w.bot), 'below')
    await withMutant(SKILLS_PATH, 'return wellCobbleSwitch(cobbleTownViewFor(bot), stacks[0].count,', 'return wellCobbleSwitch(cobbleTownViewFor(bot), stacks[stacks.length - 1].count,', async M => {
      assert.equal(M.cobbleWellCap(w.bot), 'at_cap', 'the mutant judges a 64 and throws what the bank would take')
    })
  } finally { B.setStockReaders({ town: null, well: null }) }
})
await t('FROM AFAR (Claude r1 P1-1): the room order\'s guess (townWellTakes) keeps stonecap\'s floor-only rule -- a town in the band sends no bot home; at town the switch is at_cap', async () => {
  try {
    const w = await atCapTown(CAP - 16, fullCobbleBag())
    assert.equal(SK.cobbleWellCap(w.bot), 'at_cap', 'positive control: at town, the band is at_cap')
    assert.equal(SK.cobbleWellCap(w.bot, w.bot.inventory.items(), { floorOnly: true }), 'below', 'the floor-only guess (floor 0: the count is 2 h old)')
    const site = () => ({ x: 9, y: 64, z: 9 })
    assert.equal(SK.townWellTakes(w.bot, w.bot.inventory.items(), [], { wellSite: site }), null, 'no well stack from afar: no trip home for the band')
    await withMutant(SKILLS_PATH, "cobbleAtCap: cobbleWellCap(bot, items, { floorOnly: true }) === 'at_cap', stock: stockWellOpts(bot, items, { assumeCap: true })",
      "cobbleAtCap: cobbleWellCap(bot, items) === 'at_cap', stock: stockWellOpts(bot, items, { assumeCap: true })", async M => {
        assert.equal(M.townWellTakes(w.bot, w.bot.inventory.items(), [], { wellSite: site }), 'cobblestone', 'the mutant sends the bot home for the band')
      })
  } finally { B.setStockReaders({ town: null, well: null }) }
})
await t('CHAIN (a withdraw hold): cobble a withdraw just took (plinth funds) is never thrown, even at the cap; the hold released, it is', async () => {
  try {
    const w = await atCapTown(CAP + 40, fullCobbleBag())
    B.setWithdrawHold('cobblestone', 64, Date.now() + 60_000)
    assert.equal(SK.cobbleWellCap(w.bot), 'held')
    B.clearWithdrawHolds()
    assert.equal(SK.cobbleWellCap(w.bot), 'at_cap', 'positive control')
  } finally { B.clearWithdrawHolds(); B.setStockReaders({ town: null, well: null }) }
})

// ------------------------------------------------------------------------------------------------- anchored mutants
await t('MUTANT KILLED: the old breakable set (cobble only) leaves the dirt lid -- the town stays UNKNOWN', async () => {
  await withMutant(LID_PATH, 'export const LID_BREAKABLE = /^(cobblestone|cobbled_deepslate|dirt|grass_block)$/', 'export const LID_BREAKABLE = /^(cobblestone|cobbled_deepslate)$/', async M => {
    assert.match(M.lidClearRefusal({ lid: { name: 'dirt' }, above: AIR, sides: sides4() }) ?? '', /is not a block a bot may break/, 'the mutant refuses dirt')
  })
})
await t('MUTANT KILLED: without the never-conductor exception, leaves read as a lid again', async () => {
  await withMutant(LID_PATH, "  if (typeof above.name === 'string' && LID_OPENS.test(above.name)) return false\n", '', async M => {
    assert.equal(M.chestLidBlocked(cube('oak_leaves')), true, 'the mutant calls leaves a lid')
  })
})
await t('MUTANT KILLED: opening under every never-conductor (unmeasured on Paper) instead of leaves and glass', async () => {
  await withMutant(LID_PATH, "  if (typeof above.name === 'string' && LID_OPENS.test(above.name)) return false\n", "  if (typeof above.name === 'string' && NOT_CONDUCTOR.test(above.name)) return false\n", async M => {
    assert.equal(M.chestLidBlocked(cube('observer')), false, 'the mutant opens under an observer')
  })
})
await t('MUTANT KILLED: counting incoming reservations in the well switch would destroy cobble on its way in', async () => {
  await withMutant(CAP_PATH, '  if (cobbleAdmit({ lb: counted, reserved: 0, complete: !!view?.complete }, s, cap) === \'at_cap\') return \'at_cap\'',
    '  if (cobbleAdmit({ lb: counted, reserved: Number(view?.reserved) || 0, complete: !!view?.complete }, s, cap) === \'at_cap\') return \'at_cap\'', async M => {
      assert.equal(M.wellCobbleSwitch({ lb: CAP - 64, lbLo: CAP - 64, reserved: 64, complete: true, avail: 0 }, 64), 'at_cap', 'the mutant throws on a reservation')
    })
})
await t('MUTANT KILLED: dropping the outgoing take would throw cobble a withdraw is taking out', async () => {
  await withMutant(CAP_PATH, '  const counted = Math.max(0, (Number(view?.lbLo) || 0) - (Number(view?.taking) || 0))', '  const counted = Math.max(0, Number(view?.lbLo) || 0)', async M => {
    assert.equal(M.wellCobbleSwitch({ lb: CAP, lbLo: CAP, taking: 64, complete: true, avail: 0 }, 64), 'at_cap')
  })
})
await t('MUTANT KILLED: reading the admission ceiling (lb) instead of the smaller equal capture would destroy on a stale-high tie', async () => {
  await withMutant(CAP_PATH, '  const counted = Math.max(0, (Number(view?.lbLo) || 0) - (Number(view?.taking) || 0))', '  const counted = Math.max(0, (Number(view?.lb) || 0) - (Number(view?.taking) || 0))', async M => {
    assert.equal(M.wellCobbleSwitch({ lb: CAP, lbLo: CAP - 64, taking: 0, complete: true, avail: 0 }, 64), 'at_cap', 'the mutant throws on the ceiling')
  })
})
await t('MUTANT KILLED: ignoring completeness would throw on a partial count inside the band', async () => {
  await withMutant(CAP_PATH, '  if (cobbleAdmit({ lb: counted, reserved: 0, complete: !!view?.complete }, s, cap) === \'at_cap\') return \'at_cap\'',
    '  if (cobbleAdmit({ lb: counted, reserved: 0, complete: true }, s, cap) === \'at_cap\') return \'at_cap\'', async M => {
      assert.equal(M.wellCobbleSwitch({ lb: CAP - 16, lbLo: CAP - 16, complete: false, avail: 0 }, 30), 'at_cap')
    })
})
await t('MUTANT KILLED: ignoring the withdraw hold would throw plinth funds', async () => {
  await withMutant(CAP_PATH, "  if ((Number(held) || 0) > 0) return 'held'\n", '', async M => {
    assert.equal(M.wellCobbleSwitch({ lb: CAP, lbLo: CAP, avail: CAP, complete: true }, 64, { held: 64 }), 'at_cap')
  })
})
await t('MUTANT KILLED: the skills.mjs switch not passing the hold', async () => {
  await withMutant(SKILLS_PATH, '{ cap: TOWN_COBBLE_CAP, held: (h.cobblestone ?? 0) + (h.cobbled_deepslate ?? 0), floorOnly })', '{ cap: TOWN_COBBLE_CAP, held: 0, floorOnly })', async M => {
    const w = await atCapTown(CAP + 40, fullCobbleBag())
    try {
      B.setWithdrawHold('cobblestone', 64, Date.now() + 60_000)
      assert.equal(M.cobbleWellCap(w.bot), 'at_cap', 'the mutant throws held cobble')
    } finally { B.clearWithdrawHolds(); B.setStockReaders({ town: null, well: null }) }
  })
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
