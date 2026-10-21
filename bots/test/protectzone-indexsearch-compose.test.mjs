// protectzone-01 x indexsearch-01 (JIT 10-21b, indexsearch-on-<townindex x protectzone tip>): the index's first pick against
// the zone guard.
//
// indexsearch-01 ranks FIRST the containers the town index says hold the need (known, fresh, enough). An index entry written
// before a zone was installed over its container stays KNOWN for INDEX_STALE_MS, so the strongest ranking the search has
// would point at a container the guard refuses to open. The town search's zone rule (protectzone-01 x toolkit-03,
// townSearchView) keeps it out of the view the index ranks over (indexSearchCounts is asked about view.containers only).
// Behaviour, the REAL toolkit through its REAL order, the REAL guard (openContainer -> openBlock, as mineflayer 4.37.1):
//   - CONTROL: no zone -> the index's holder is opened FIRST and gives the iron (the ranking is live in this scene);
//   - the zone over that holder: never opened, the guard never asked, the kit made from the far chest in one run;
//   - MUTANT: the zone rule removed -> the index's pick is refused at the guard and the kit is not made (killed).
import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

process.env.LOG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-pzis-logs-'))
process.env.BOT_NAME = 'PzIsBot'
process.env.OLLAMA_MODEL ??= 'qwen2.5:7b-instruct'
process.env.HOME_X = '0'; process.env.HOME_Y = '64'; process.env.HOME_Z = '0'
process.env.LOG_LEVEL = 'error'
process.env.BOT_ROLE = 'gatherer'
process.env.PLINTH_FIRST = '0'
process.env.SKILL_TIMEOUT_MS = '180000'
const freshPool = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-pzis-pool-')); process.env.POOL_STATE_DIR = d; return d }
freshPool()

const K = await import('../src/toolkit.mjs')
const { KIT } = K
const S0 = await import('../src/skills.mjs')
const TI = await import('../src/townindex.mjs')
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
const SKILLS_PATH = new URL('../src/skills.mjs', import.meta.url)
async function withMutant (p, old, neu, fn) {
  const src = fs.readFileSync(p, 'utf8')
  assert.ok(src.includes(old), `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 70))} is not in ${p.pathname}. A mutant that was never written reads as killed.`)
  assert.ok(src.split(old).length === 2, 'the mutation target is not unique; the mutant is ambiguous')
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  fs.writeFileSync(out, src.replace(old, neu).replace(/from '\.\//g, "from '../src/"))
  try { return await fn(await import(out.href)) } finally { try { fs.unlinkSync(out) } catch {} }
}

const HOME = { x: 0, y: 64, z: 0 }
const HK = TI.indexHomeKey(HOME)
const dir = () => process.env.POOL_STATE_DIR
const kOf = ([x, y, z]) => `${x},${y},${z}`
const count = (slots, name) => slots.filter(Boolean).reduce((n, it) => n + (it.name === name ? it.count : 0), 0)
const slotted = list => list.map((it, i) => ({ ...it, slot: it.slot ?? 9 + i }))
const T = (name, left) => { const c = tool(name); c.durabilityUsed = c.maxDurability - left; return c }
const withServer = w => {
  w.bot.craftSync = { lockstep: fn => fn(), recount: async () => ({ source: 'server', items: w.bot.inventory.items() }), inflight: () => 0,
    confirmCursor: async win => ({ answered: true, cursorEmpty: !win.selectedItem, carried: win.selectedItem ? { itemCount: win.selectedItem.count } : null }) }
  return w
}
const asMineflayer = w => {
  const open = w.bot.openContainer.bind(w.bot)
  w.bot.openBlock = b => open(b)
  w.bot.openContainer = function (b) { return this.openBlock(b) }
  return w
}
const guarded = (w, zones) => {
  const refused = []
  w.bot.protectZones = () => zones
  PZ.attachProtectZone(w.bot, { zones: w.bot.protectZones, onRefuse: r => refused.push(r) })
  w.bot.protectZone = PZ.protectZoneCounters()
  return refused
}
const fakeCraft = w => async (_ctx, { item }) => {
  const take = (name, n) => { for (const it of w.bag.filter(x => x?.name === name)) { const k = Math.min(n, it.count); it.count -= k; n -= k; if (!it.count) w.bag.splice(w.bag.indexOf(it), 1); if (!n) break } }
  take('iron_ingot', KIT[item].ingots); take('stick', KIT[item].sticks)
  w.bag.push({ ...tool(item), slot: 40 })
  return { status: 'success', detail: `crafted 1 ${item}` }
}
const isKit = w => count(w.bag, 'iron_axe') === 1 && count(w.bag, 'iron_shovel') === 1

// toolkit-03's far-chest town, plus the index's holder IX (farther than every dirt chest, nearer than FAR) with 20 iron KNOWN to the index, and
// counted by the journal before the zone (so the town scan names it although findBlocks never would under the zone)
const NEAR = [[5, 64, 3], [8, 64, -3], [2, 64, -5], [10, 64, 4], [0, 64, 6], [12, 64, -2], [-2, 64, 2], [4, 64, 9], [-5, 64, -4]]
const IX = [-9, 64, -6], FAR = [-13, 64, 5]   // IX: 17 from the bot, behind 9 nearer chests -- only the index ranks it first
const scene = () => {
  freshPool(); clearWithdrawHolds(); offset += 61 * 60_000; TI.resetIndexCache()
  const w = asMineflayer(withServer(fakeWorld({ bag: slotted([T('iron_pickaxe', 200), stack('stick', 9)]) })))
  for (const c of NEAR) { w.set(...c, 'chest'); w.stock(...c, [stack('dirt', 5)]) }
  w.set(...IX, 'chest'); w.stock(...IX, [stack('iron_ingot', 20)])
  w.set(...FAR, 'chest'); w.stock(...FAR, [stack('iron_ingot', 20)])
  CC.recordCount(dir(), CF.townKey(HOME), null, { obs: { k: kOf(IX), n: 0, m: { dirt: 0 }, cap: Date.now() - 120_000 }, bot: 'other' })
  const at = Date.now() - 60_000
  TI.appendIndex(dir(), HK, null, { t: 'obs', id: `seed-ix-${at}`, k: kOf(IX), h: [kOf(IX)], at, size: 27, used: 1, names: { iron_ingot: [20, 1] }, bot: 'Other', by: 'test' })
  TI.resetIndexCache()
  return w
}
const OVER_IX = PZ.parseZones({ version: 1, zones: [{ id: 'over-ix', kind: 'fixture', label: 'the zone over IX', box: [-10, 60, -7, -8, 70, -5] }] }).zones
async function oneOrder (S, w) {
  const o = K.toolkitOrder({ now: Date.now(), atTown: true, items: w.bag, container: true, townMiss: () => S.townKitIronMiss(w.bot), tableNear: true, state: {} })
  assert.equal(o.order?.skill, 'toolkit', 'the order issues')
  return S.SKILLS.toolkit.run({ bot: w.bot, kitCraft: fakeCraft(w) }, o.order.args, new AbortController().signal)
}

await t('CONTROL: no zone -> the index\'s holder is opened FIRST and gives the iron (the index ranking is live here)', async () => {
  const w = scene()
  const refused = guarded(w, [])
  const r = await oneOrder(S0, w)
  assert.equal(r.status, 'success', r.detail)
  assert.equal(w.spy.opened[0], kOf(IX), `opened: ${w.spy.opened}`)
  assert.equal(count(w.containers.get(kOf(IX)).slots, 'iron_ingot'), 16); assert.deepEqual(refused, [])
})
await t('THE ZONE OVER THE INDEX\'S HOLDER: never opened, the guard never asked; the kit made from outside the zone in one run', async () => {
  const w = scene()
  const refused = guarded(w, OVER_IX)
  const r = await oneOrder(S0, w)
  assert.equal(r.status, 'success', r.detail); assert.ok(isKit(w))
  assert.ok(!w.spy.opened.includes(kOf(IX)), `opened: ${w.spy.opened}`)
  assert.equal(count(w.containers.get(kOf(IX)).slots, 'iron_ingot'), 20, 'nothing taken in the zone')
  assert.equal(count(w.containers.get(kOf(FAR)).slots, 'iron_ingot'), 16, 'the far chest gave the 4')
  assert.deepEqual(refused, [])
})
await t('MUTANT KILLED: without the town search\'s zone rule the index\'s pick is refused at the guard and the run makes no kit', async () => {
  await withMutant(SKILLS_PATH, '    if (halves.some(h => zoneShut(keyVec(h)))) continue\n', '', async S => {
    const w = scene()
    const refused = guarded(w, OVER_IX)
    const r = await oneOrder(S, w)
    assert.ok(!isKit(w), `the mutant made the kit: ${r.status} ${r.failClass}`)
    assert.ok(refused.some(x => x.op === 'open' && x.at?.x === IX[0] && x.at?.z === IX[2]), JSON.stringify(refused))
  })
})

console.log(`  ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
