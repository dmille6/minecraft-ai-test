// protectzone-01 x toolkit-03 (JIT 10-21b, protectzone-on-34d3e5e and its siblings): the protected-zone guard against the
// town search's container opens that toolkit-03 added (the kit's iron and sticks, through withdraw_pick's town search).
//
// protectzone-01 was reviewed on 9e7d9980, where only withdraw_pick searched the town. On 34d3e5e9 the kit's draw opens
// every town container in turn (townSearchNext over townSearchView -- townCobbleScan's keys: findBlocks, which the guard
// filters, PLUS the cobble journal's counted containers, which it does not see). Behaviour only, the REAL toolkit skill in
// the fake world with the REAL guard attached (attachProtectZone over a fake that opens as mineflayer 4.37.1 does:
// openContainer -> openBlock):
//   1. THE BENCH FIXTURE'S SHAPE (the only zone file the fleet will hold: a strip 20..44 east of home, outside the town's
//      16): the kit's search draws its iron in town exactly as without the guard; the strip's chest is never opened;
//      the guard refuses nothing. Positive control: the guard is live (a direct open of the strip's chest is refused).
//   2. A ZONE OVER AN IN-TOWN CONTAINER THE JOURNAL HAS COUNTED (no installed file does this; the composition's edge). Found
//      here, before the fix: the guard refused the open, container_open ended the run, the kit backed off 30 min -- and
//      the 30-min visit skip had expired by then, so every run returned to the same refused container and the kit was
//      never made from the containers outside (two correct guards, no legal move). Fixed in townSearchView: a container
//      in a zone (either half of a double) is not in the search, as findBlocks already keeps it out of the scan. Now the
//      FIRST run draws outside the zone and the guard is never asked; withdraw_pick (the same search) likewise; with no
//      zone file the search is the base exactly. Control: no zone -> the counted container gives the iron on run one.
//      Mutant: the skip removed -> the loop comes back (killed).
import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

process.env.LOG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-pzts-logs-'))
process.env.BOT_NAME = 'PzTsBot'
process.env.OLLAMA_MODEL ??= 'qwen2.5:7b-instruct'
process.env.HOME_X = '0'; process.env.HOME_Y = '64'; process.env.HOME_Z = '0'
process.env.LOG_LEVEL = 'error'
process.env.BOT_ROLE = 'gatherer'
process.env.PLINTH_FIRST = '0'            // as toolkit.test.mjs: this fake town has no junk well by construction
process.env.SKILL_TIMEOUT_MS = '180000'   // withdraw's clock is the skill timeout; the suite's 300 ms leaves no walk
const freshPool = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-pzts-pool-')); process.env.POOL_STATE_DIR = d; return d }
freshPool()

const K = await import('../src/toolkit.mjs')
const { KIT } = K
const S0 = await import('../src/skills.mjs')
const CF = await import('../src/chestfull.mjs')
const CC = await import('../src/cobblecap.mjs')
const PZ = await import('../src/protectzone.mjs')
const { clearWithdrawHolds } = await import('../src/bankable.mjs')
const { fakeWorld, stack, tool } = await import('./fakeworld.mjs')

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 4).join('\n        ')}`) }
}
const realNow = Date.now
let offset = 0
Date.now = () => realNow() + offset

const HOME = { x: 0, y: 64, z: 0 }
const memDir = () => process.env.POOL_STATE_DIR
const journalCount = (k, m) => CC.recordCount(memDir(), CF.townKey(HOME), null, { obs: { k, n: m.cobble ?? 0, m, cap: Date.now() }, bot: 'other' })
const count = (bag, name) => bag.filter(Boolean).reduce((n, it) => n + (it.name === name ? it.count : 0), 0)
const slotted = list => list.map((it, i) => ({ ...it, slot: it.slot ?? 9 + i }))
const T = (name, left) => { const c = tool(name); c.durabilityUsed = c.maxDurability - left; return c }
const kOf = ([x, y, z]) => `${x},${y},${z}`
const ironIn = (w, c) => count(w.containers.get(kOf(c)).slots.filter(Boolean), 'iron_ingot')
const fakeCraft = w => async (_ctx, { item }) => {
  const take = (name, n) => { for (const it of w.bag.filter(x => x?.name === name)) { const k = Math.min(n, it.count); it.count -= k; n -= k; if (!it.count) w.bag.splice(w.bag.indexOf(it), 1); if (!n) break } }
  take('iron_ingot', KIT[item].ingots); take('stick', KIT[item].sticks)
  w.bag.push({ ...tool(item), slot: 40 })
  return { status: 'success', detail: `crafted 1 ${item}` }
}
const withServer = w => {
  w.bot.craftSync = { lockstep: fn => fn(), recount: async () => ({ source: 'server', items: w.bot.inventory.items() }), inflight: () => 0,
    confirmCursor: async win => ({ answered: true, cursorEmpty: !win.selectedItem, carried: win.selectedItem ? { itemCount: win.selectedItem.count } : null }) }
  return w
}
/** mineflayer 4.37.1's shape: openContainer/openChest call bot.openBlock -- the cell the guard judges. */
const asMineflayer = w => {
  const open = w.bot.openContainer.bind(w.bot)
  w.bot.openBlock = b => open(b)
  w.bot.openContainer = function (b) { return this.openBlock(b) }
  return w
}
/** The REAL guard over `zones` (as index.mjs attaches it); its refusals are collected. */
const guarded = (w, zones) => {
  const refused = []
  w.bot.protectZones = () => zones
  PZ.attachProtectZone(w.bot, { zones: w.bot.protectZones, onRefuse: r => refused.push(r) })
  w.bot.protectZone = PZ.protectZoneCounters()
  return refused
}
const zoneOf = (id, box) => PZ.parseZones({ version: 1, zones: [{ id, kind: 'fixture', label: `the ${id}`, box }] }).zones
const BAG = () => [T('iron_pickaxe', 200), stack('stick', 9)]   // the kit's axe and shovel to make: a 4-ingot draw
function town ({ chests }) {
  freshPool(); clearWithdrawHolds(); offset += 61 * 60_000   // a fresh town; every earlier cache is stale
  const w = asMineflayer(withServer(fakeWorld({ bag: slotted(BAG()) })))
  for (const [c, slots] of chests) { w.set(...c, 'chest'); w.stock(...c, slots.map(s => ({ ...s }))) }
  return w
}
const kit = w => S0.SKILLS.toolkit.run({ bot: w.bot, kitCraft: fakeCraft(w) }, {}, new AbortController().signal)
const isKit = w => count(w.bag, 'iron_axe') === 1 && count(w.bag, 'iron_shovel') === 1

// ---- 1. the bench fixture's shape ----------------------------------------------------------------------------------------
const STRIP = zoneOf('fixture-strip', [20, -64, -10, 44, 88, 10])          // protectzone-fixture.py: home.x + 20..44, z +-10
const IN_TOWN = [-13, 64, 5], IN_STRIP = [25, 64, 0]
await t('BENCH FIXTURE: the kit draws its iron in town as without the guard; the strip\'s chest (iron in it too) is never opened; nothing refused', async () => {
  const w = town({ chests: [[IN_TOWN, [stack('iron_ingot', 20)]], [IN_STRIP, [stack('iron_ingot', 20)]]] })
  journalCount(kOf(IN_STRIP), { iron_ingot: 20 })              // even a counted strip chest: it is outside the town's 16
  const refused = guarded(w, STRIP)
  const r = await kit(w)
  assert.equal(r.status, 'success', r.detail); assert.ok(isKit(w), 'the kit was made')
  assert.equal(ironIn(w, IN_TOWN), 16, 'the town chest gave the 4')
  assert.ok(!w.spy.opened.includes(kOf(IN_STRIP)), `the strip's chest was never opened: ${w.spy.opened}`)
  assert.equal(ironIn(w, IN_STRIP), 20)
  assert.deepEqual(refused, [], 'the guard refused nothing: the search never reached the zone')
  // POSITIVE CONTROL: the guard is live -- a direct open of the strip's chest is refused, named, and nothing opens
  await assert.rejects(w.bot.openContainer(w.bot.blockAt(IN_STRIP.reduce((p, v, i) => ({ ...p, [['x', 'y', 'z'][i]]: v }), {}))), e => e instanceof PZ.ProtectedZoneError)
  assert.equal(refused.length, 1); assert.equal(refused[0].op, 'open')
})

// ---- 2. a zone over a counted in-town container -------------------------------------------------------------------------
const NEAREST = [5, 64, 3], OTHER = [-13, 64, 5]              // the nearest to the bot (6.5,64,0.5) holds the iron, and another
const OVER_NEAREST = zoneOf('over-nearest', [4, 60, 2, 6, 70, 4])
const edgeTown = () => {
  const w = town({ chests: [[NEAREST, [stack('iron_ingot', 20)]], [OTHER, [stack('iron_ingot', 20)]]] })
  journalCount(kOf(NEAREST), { iron_ingot: 20 })               // counted before the zone: the town search ranks it first
  return w
}
await t('EDGE, CONTROL: no zone -> the counted nearest container gives the iron on the first run', async () => {
  const w = edgeTown()
  const r = await kit(w)
  assert.equal(r.status, 'success', r.detail)
  assert.equal(w.spy.opened[0], kOf(NEAREST)); assert.equal(ironIn(w, NEAREST), 16)
})
/** The kit THROUGH ITS ORDER, as cognitive.mjs runs it: toolkitOrder (its cooldown, backoff and town gate) -> the run ->
 *  toolkitOutcome; the clock moves to the next moment the order can issue. -> the runs' `status:failClass` list. */
async function throughTheOrder (w, S, KK, n = 4) {
  let state = {}
  const runs = []
  for (let i = 0; i < n && !isKit(w); i++) {
    const o = KK.toolkitOrder({ now: Date.now(), atTown: true, items: w.bag, container: true, townMiss: () => S.townKitIronMiss(w.bot), tableNear: true, state })
    state = o.state
    if (!o.order) { runs.push('no_order'); offset += 5 * 60_000; continue }
    const r = await S.SKILLS.toolkit.run({ bot: w.bot, kitCraft: fakeCraft(w) }, o.order.args, new AbortController().signal)
    runs.push(`${r.status}:${r.failClass ?? '-'}`)
    state = KK.toolkitOutcome(r.status, Date.now(), state, r.failClass ?? null)
    offset = Math.max(offset + KK.TOOLKIT_COOLDOWN_MS, offset + Math.max(0, (state.backoffUntil ?? 0) - Date.now())) + 1
  }
  return runs
}
const edgeChain = async (S, KK) => {
  const w = edgeTown()
  const refused = guarded(w, OVER_NEAREST)
  const runs = await throughTheOrder(w, S, KK)
  return { w, refused, runs }
}
await t('EDGE THROUGH THE ORDER: a zone over the counted container -> the FIRST run draws outside the zone; the zone\'s container is never opened, nothing refused', async () => {
  const { w, refused, runs } = await edgeChain(S0, K)
  assert.deepEqual(runs, ['success:-'], `one run: ${runs.join(' ')}`)
  assert.ok(isKit(w)); assert.equal(ironIn(w, OTHER), 16, 'the container outside the zone gave the 4')
  assert.equal(ironIn(w, NEAREST), 20, 'nothing taken from the zone')
  assert.ok(!w.spy.opened.includes(kOf(NEAREST)))
  assert.deepEqual(refused, [], 'the search never asked the guard to open the zone\'s container')
})
await t('EDGE: a DOUBLE chest with one half in the zone is out of the search (the window is both halves); the kit draws from the other container', async () => {
  const L = [5, 64, 3], R = [6, 64, 3]                                  // facing north: left at x, right at x + 1
  freshPool(); clearWithdrawHolds(); offset += 61 * 60_000
  const w = asMineflayer(withServer(fakeWorld({ bag: slotted(BAG()) })))
  w.set(...L, 'chest', { facing: 'north', type: 'left' }); w.set(...R, 'chest', { facing: 'north', type: 'right' })
  w.stock(...L, [stack('iron_ingot', 20)]); w.set(...OTHER, 'chest'); w.stock(...OTHER, [stack('iron_ingot', 20)])
  journalCount(kOf(L), { iron_ingot: 20 })
  const refused = guarded(w, zoneOf('over-right-half', [6, 60, 3, 6, 70, 3]))
  const runs = await throughTheOrder(w, S0, K)
  assert.ok(isKit(w), runs.join(' '))
  assert.ok(!w.spy.opened.includes(kOf(L)) && !w.spy.opened.includes(kOf(R)), `neither half opened: ${w.spy.opened}`)
  assert.equal(ironIn(w, OTHER), 16); assert.deepEqual(refused, [])
})
await t('EDGE, withdraw_pick (the same search): a pickaxe in the zone\'s counted container and one outside -> the one outside is taken, nothing refused', async () => {
  const w = town({ chests: [[NEAREST, [tool('stone_pickaxe'), stack('dirt', 1)]], [OTHER, [tool('stone_pickaxe'), stack('dirt', 1)]]] })
  w.bag.splice(0, w.bag.length, ...slotted([stack('crafting_table', 1)]))
  journalCount(kOf(NEAREST), { dirt: 1 })
  const refused = guarded(w, OVER_NEAREST)
  const r = await S0.SKILLS.withdraw_pick.run({ bot: w.bot }, {}, new AbortController().signal)
  assert.equal(r.status, 'success', r.detail)
  assert.equal(count(w.bag, 'stone_pickaxe'), 1)
  assert.equal(count(w.containers.get(kOf(NEAREST)).slots.filter(Boolean), 'stone_pickaxe'), 1, 'the zone\'s pickaxe stays')
  assert.deepEqual(refused, [])
})
await t('NO ZONE FILE: the search is the base exactly -- the counted nearest container is opened first (pass-through)', async () => {
  const w = edgeTown()
  const refused = guarded(w, [])
  const runs = await throughTheOrder(w, S0, K)
  assert.deepEqual(runs, ['success:-']); assert.equal(w.spy.opened[0], kOf(NEAREST)); assert.deepEqual(refused, [])
})
const SKILLS_PATH = new URL('../src/skills.mjs', import.meta.url)
async function withMutant (p, old, neu, fn) {
  const src = fs.readFileSync(p, 'utf8')
  assert.ok(src.includes(old), `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 70))} is not in ${p.pathname}. A mutant that was never written reads as killed.`)
  assert.ok(src.split(old).length === 2, 'the mutation target is not unique; the mutant is ambiguous')
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  fs.writeFileSync(out, src.replace(old, neu).replace(/from '\.\//g, "from '../src/"))
  try { return await fn(await import(out.href)) } finally { try { fs.unlinkSync(out) } catch {} }
}
await t('MUTANT KILLED: without the zone skip the kit returns to the refused container every run (container_open, backed off 30 min, the 30-min visit skip expired) and never draws outside', async () => {
  await withMutant(SKILLS_PATH, '    if (halves.some(h => zoneShut(keyVec(h)))) continue\n', '', async mod => {
    const { w, refused, runs } = await edgeChain(mod, K)
    assert.ok(!isKit(w), `the mutant made the kit: ${runs.join(' ')}`)
    assert.ok(runs.every(r => r === 'failed:container_open'), runs.join(' '))
    assert.equal(refused.length, runs.length, 'one refusal per run: the loop')
  })
})
await t('MUTANT KILLED: judging only the half the search would open lets the window over the zone\'s half be opened', async () => {
  await withMutant(SKILLS_PATH, '    if (halves.some(h => zoneShut(keyVec(h)))) continue\n', '    if (zoneShut(p)) continue\n', async mod => {
    const L = [5, 64, 3], R = [6, 64, 3]
    freshPool(); clearWithdrawHolds(); offset += 61 * 60_000
    const w = asMineflayer(withServer(fakeWorld({ bag: slotted(BAG()) })))
    w.set(...L, 'chest', { facing: 'north', type: 'left' }); w.set(...R, 'chest', { facing: 'north', type: 'right' })
    w.stock(...L, [stack('iron_ingot', 20)]); w.set(...OTHER, 'chest'); w.stock(...OTHER, [stack('iron_ingot', 20)])
    journalCount(kOf(L), { iron_ingot: 20 })
    guarded(w, zoneOf('over-right-half', [6, 60, 3, 6, 70, 3]))
    await throughTheOrder(w, mod, K)
    assert.ok(w.spy.opened.includes(kOf(L)), `the mutant opens the double chest: ${w.spy.opened}`)
  })
})

console.log(`  ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
