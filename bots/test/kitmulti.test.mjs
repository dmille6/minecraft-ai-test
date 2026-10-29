// KITMULTI-01: the toolkit's iron draw comes from SEVERAL town containers, and the keep is the TOWN's (TOWN_IRON_RESERVE by the
// index), not 4 per container. Behaviour: the pure decisions, then the REAL toolkit skill over the fake world in the measured
// town (every container at exactly 4), the reserve, the order's gate, the no-index fallback, and anchored mutants.
import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'

delete process.env.TOOLKIT_MULTI
process.env.LOG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-kitmulti-logs-'))
process.env.BOT_NAME = 'KitMultiBot'
process.env.OLLAMA_MODEL ??= 'qwen2.5:7b-instruct'
process.env.HOME_X = '0'; process.env.HOME_Y = '64'; process.env.HOME_Z = '0'
process.env.LLM_DECISION_COOLDOWN_MS = '50'
process.env.LOG_LEVEL = 'error'
process.env.BOT_ROLE = 'gatherer'
process.env.PLINTH_FIRST = '0'            // as toolkit.test.mjs: this fake town has no junk well by construction
process.env.SKILL_TIMEOUT_MS = '180000'   // withdraw's clock is the skill timeout; the suite's 300 ms leaves no walk
const freshPool = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-kitmulti-pool-')); process.env.POOL_STATE_DIR = d; return d }
freshPool()

const K = await import('../src/toolkit.mjs')
const { kitVisitStep, kitSearchEnd, toolkitOrder, toolkitOutcome, toolkitRow, kitSearchModeDetail, KIT, KIT_SEARCH_VISITS, KIT_CRAFT_RESERVE_MS,
        TOOLKIT_COOLDOWN_MS, TOOLKIT_BACKOFF_MS, KIT_IRON_NEED, kitTakes, kitIronNeed, kitIronMissNeeds, KIT_MORE_MAX } = K
const S0 = await import('../src/skills.mjs')
const CF = await import('../src/chestfull.mjs')
const CC = await import('../src/cobblecap.mjs')
const { SEARCH_MISS_TTL_MS } = await import('../src/withdrawpick.mjs')
const { clearWithdrawHolds } = await import('../src/bankable.mjs')
const { tapRecords } = await import('../src/logger.mjs')
const { fakeWorld, stack, tool } = await import('./fakeworld.mjs')

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 4).join('\n        ')}`) }
}
const RECS = []
tapRecords(r => RECS.push(r))
const kitRows = () => RECS.filter(r => r.skill?.name === '_toolkit' && /^phase=kit/.test(r.skill?.detail ?? ''))
const SKILLS_PATH = new URL('../src/skills.mjs', import.meta.url)
const TK_PATH = new URL('../src/toolkit.mjs', import.meta.url)
async function withMutant (p, old, neu, fn) {
  const src = readFileSync(p, 'utf8')
  assert.ok(src.includes(old), `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 70))} is not in ${p.pathname}. A mutant that was never written reads as killed.`)
  assert.ok(src.split(old).length === 2, 'the mutation target is not unique; the mutant is ambiguous')
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, src.replace(old, neu).replace(/from '\.\//g, "from '../src/"))
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}
/** Did the mutant change the behaviour the test pins? -> true when the test FAILS under the mutant (killed). */
const killedBy = async fn => { try { await fn(); return false } catch (e) { if (e instanceof assert.AssertionError) return true; throw e } }   // a crash is not a kill

// A CLOCK THE TEST MOVES: every Date.now in the skill code, the town memory and the journal moves with it.
const realNow = Date.now
let offset = 0
Date.now = () => realNow() + offset
const later = ms => { offset += ms }

const HOME = { x: 0, y: 64, z: 0 }
const memDir = () => process.env.POOL_STATE_DIR
const journalCount = (k, m) => CC.recordCount(memDir(), CF.townKey(HOME), null, { obs: { k, n: m.cobble ?? 0, m, cap: Date.now() }, bot: 'other' })
const withServer = w => {
  w.bot.craftSync = { lockstep: fn => fn(), recount: async () => ({ source: 'server', items: w.bot.inventory.items() }), inflight: () => 0,
    confirmCursor: async win => ({ answered: true, cursorEmpty: !win.selectedItem, carried: win.selectedItem ? { itemCount: win.selectedItem.count } : null }) }
  return w
}
const count = (bag, name) => bag.filter(Boolean).reduce((n, it) => n + (it.name === name ? it.count : 0), 0)
const slotted = list => list.map((it, i) => ({ ...it, slot: it.slot ?? 9 + i }))
const T = (name, left) => { const c = tool(name); c.durabilityUsed = c.maxDurability - left; return c }
const kOf = ([x, y, z]) => `${x},${y},${z}`
const ironIn = (w, c) => count(w.containers.get(kOf(c)).slots.filter(Boolean), 'iron_ingot')
/** A crafter for the fake (it cannot craft): the recipe's ingots and sticks leave the bag, one fresh tool arrives. */
const fakeCraft = w => async (_ctx, { item }) => {
  const take = (name, n) => { for (const it of w.bag.filter(x => x?.name === name)) { const k = Math.min(n, it.count); it.count -= k; n -= k; if (!it.count) w.bag.splice(w.bag.indexOf(it), 1); if (!n) break } }
  take('iron_ingot', KIT[item].ingots); take('stick', KIT[item].sticks)
  w.bag.push({ ...tool(item), slot: 40 })
  return { status: 'success', detail: `crafted 1 ${item}` }
}

/** THE OWNER'S SCENE: 10 single chests inside town (16 of home), none adjacent; the bot at 6.5,64,0.5; iron ONLY in FAR, the
 *  farthest from the bot (20 away). The nearest chest by home and by bot holds none. */
const NEAR = [[5, 64, 3], [8, 64, -3], [2, 64, -5], [10, 64, 4], [0, 64, 6], [12, 64, -2], [-2, 64, 2], [4, 64, 9], [-5, 64, -4]]
const FAR = [-13, 64, 5]
const BAG = () => [T('iron_pickaxe', 200), stack('stick', 9)]
function farTown ({ bag = BAG(), far = [stack('iron_ingot', 20)], rest = [stack('dirt', 5)], near = NEAR, at = undefined } = {}) {
  freshPool(); clearWithdrawHolds(); offset += 61 * 60_000   // a fresh town and every earlier test's cache is stale
  const w = withServer(fakeWorld({ bag: slotted(bag), ...(at ? { at } : {}) }))
  for (const c of near) { w.set(...c, 'chest'); w.stock(...c, rest.map(s => ({ ...s }))) }
  w.set(...FAR, 'chest'); w.stock(...FAR, far.map(s => ({ ...s })))
  return w
}
const kit = (S, w, ctx = {}) => S.SKILLS.toolkit.run({ bot: w.bot, kitCraft: fakeCraft(w), ...ctx }, {}, new AbortController().signal)
const lastRow = () => kitRows().at(-1)?.skill?.detail ?? ''


const TI = await import('../src/townindex.mjs')
const { TOOLKIT_MULTI, toolkitMultiMode, TOWN_IRON_RESERVE, KIT_IRON_ANY, townIronSpare, kitTakesMulti, kitLeftAfter, kitMultiOn, kitTownShort } = K
const HK = TI.indexHomeKey(HOME)
/** What any bot's open of `c` would have written to the town index (the latest observation). */
const seen = (c, names) => TI.appendIndex(memDir(), HK, null, { t: 'obs', id: `o-${Date.now()}-${kOf(c)}-${Math.random().toString(36).slice(2, 6)}`, k: kOf(c), h: [kOf(c)], at: Date.now(), bot: 'Other', by: 'count_town', names, used: 1, size: 27 })
/** THE MEASURED TOWN (10-28): every container holding exactly TOWN_IRON_KEEP (4) ingots, the index knowing it. */
const CH = [[5, 64, 3], [8, 64, -3], [2, 64, -5], [10, 64, 4], [0, 64, 6], [12, 64, -2]]
function fourTown ({ chests = CH, each = 4, bag = [stack('stick', 9)], index = true } = {}) {
  freshPool(); clearWithdrawHolds(); TI.resetIndexCache(); offset += 61 * 60_000
  const w = withServer(fakeWorld({ bag: slotted(bag) }))
  for (const c of chests) { w.set(...c, 'chest'); w.stock(...c, [stack('iron_ingot', each), stack('dirt', 3)]) }
  if (index) for (const c of chests) seen(c, { iron_ingot: [each, 1], dirt: [3, 1] })
  return w
}
const townIron = (w, chests = CH) => chests.reduce((t, c) => t + ironIn(w, c), 0)
const field = (d, k) => (String(d).match(new RegExp(`(?:^| )${k}=(\\S+)`)) ?? [])[1]

await t('THE SWITCH: TOOLKIT_MULTI on by default; off|on; unreadable -> on, said; the mode row names it and the reserve', () => {
  assert.equal(TOOLKIT_MULTI.on, true)
  assert.deepEqual(toolkitMultiMode({}), { on: true, mode: 'on', note: 'TOOLKIT_MULTI unset' })
  assert.equal(toolkitMultiMode({ TOOLKIT_MULTI: 'off' }).on, false)
  assert.match(toolkitMultiMode({ TOOLKIT_MULTI: 'maybe' }).note, /unreadable/)
  assert.match(K.kitSearchModeDetail(), / multi=1 town_reserve=16$/)
})

await t('townIronSpare: the latest observations summed (any state), less the reserve; no entries -> null', () => {
  const e = (n, at = 1) => ({ last: { t: 'obs', at }, obs: { at, names: n == null ? {} : { iron_ingot: [n, 1] } } })
  assert.deepEqual(townIronSpare({ a: e(4), b: e(4), c: e(null), d: e(30) }), { total: 38, spare: 22, containers: 3 })
  assert.deepEqual(townIronSpare({ a: e(4), b: e(4) }), { total: 8, spare: 0, containers: 2 })
  assert.equal(townIronSpare({}), null); assert.equal(townIronSpare(null), null)
  assert.equal(kitMultiOn(null), false); assert.equal(kitMultiOn({ spare: 0 }), true); assert.equal(kitMultiOn({ spare: 9 }, false), false)
  assert.equal(kitTownShort({ spare: 6 }, 7), true); assert.equal(kitTownShort({ spare: 7 }, 7), false); assert.equal(kitTownShort(null, 7), false)
  assert.equal(kitTownShort({ spare: 0 }, 0), false, 'a sticks-only draw is never short of iron')
})

await t('kitTakesMulti: what the container holds up to the draw left and the town budget; no per-container floor; sticks ride with iron', () => {
  const chest = [stack('iron_ingot', 4), stack('stick', 3)]
  assert.deepEqual(kitTakesMulti(chest, { ingots: 7, sticks: 8 }).takes, [{ name: 'iron_ingot', count: 4 }, { name: 'stick', count: 3 }])
  assert.deepEqual(kitTakesMulti(chest, { ingots: 3, sticks: 0 }).takes, [{ name: 'iron_ingot', count: 3 }])
  assert.deepEqual(kitTakesMulti(chest, { ingots: 7, sticks: 0 }, { budget: 2 }).takes, [{ name: 'iron_ingot', count: 2 }])
  const r = kitTakesMulti(chest, { ingots: 7, sticks: 0 }, { budget: 0 })
  assert.deepEqual(r.takes, []); assert.equal(r.reserve, true, 'held back by the reserve, not empty')
  assert.deepEqual(kitTakesMulti([stack('stick', 9)], { ingots: 3, sticks: 2 }).takes, [], 'sticks never come alone')
  assert.equal(kitTakesMulti([stack('iron_ingot', 4)], { ingots: 3, sticks: 4 }, { sticksMakeable: 0 }).noSticks, true)
  // CONTROL: the one-container rule refuses the same chest for the same draw
  assert.deepEqual(K.kitTakes(chest, { ingots: 7, sticks: 8 }).takes, [])
  assert.deepEqual(kitLeftAfter({ ingots: 7, sticks: 4 }, { iron_ingot: 4, stick: 9 }), { ingots: 3, sticks: 0 })
})

const measuredTown = async S => {
  // the whole kit (7 ingots) from a town of six containers of 4 (24 in all, spare 8 above the reserve)
  const w = fourTown()
  const r = await kit(S, w)
  const d = lastRow()
  assert.equal(r.status, 'success', `${r.detail} | ${d}`)
  assert.equal(field(d, 'outcome'), 'crafted', d)
  assert.equal(field(d, 'drew'), '7', d); assert.equal(field(d, 'parts'), '2', d)
  assert.equal(townIron(w), 24 - 7, 'exactly the draw left the town')
  assert.ok(townIron(w) >= TOWN_IRON_RESERVE, 'the town keeps its reserve')
  for (const n of ['iron_pickaxe', 'iron_axe', 'iron_shovel']) assert.equal(count(w.bag, n), 1, n)
  assert.equal(count(w.bag, 'iron_ingot'), 0, 'every drawn ingot was used')
}
await t('SKILL, THE MEASURED TOWN: every container holds 4 -> the kit draws 4 + 3 from two containers and makes all three tools', async () => {
  await measuredTown(S0)
})

await t('SKILL, THE RESERVE: a town of 20 (spare 4) gives a 7-ingot draw only 4 -- the pickaxe is made, 1 ingot stays as credit; the town keeps 16', async () => {
  const w = fourTown({ chests: CH.slice(0, 5) })
  const r = await kit(S0, w)
  const d = lastRow()
  assert.equal(r.status, 'success', `${r.detail} | ${d}`)
  assert.equal(field(d, 'outcome'), 'partial', d)
  assert.equal(field(d, 'drew'), '4', d)
  assert.equal(townIron(w, CH.slice(0, 5)), TOWN_IRON_RESERVE)
  assert.equal(count(w.bag, 'iron_pickaxe'), 1, 'the pickaxe first')
  assert.equal(r.kitCredit, 1, 'the ingot no craft used is credit')
})

await t('SUCCESSIVE RUNS keep the reserve (Claude code r1): a container a draw took from is dirty and counts 0 until reopened', async () => {
  const w = fourTown({ chests: CH.slice(0, 5) })   // 20 in town, spare 4
  const pick = () => K.kitDraw(w.bot.inventory.items(), { limit: 1 })
  assert.equal(S0.townKitIronMiss(w.bot, pick()), false)
  await kit(S0, w, {})                               // takes 4 (spare), makes the pickaxe, 1 credit
  assert.equal(townIron(w, CH.slice(0, 5)), TOWN_IRON_RESERVE)
  // a second bot (an empty bag) asks for the pickaxe: the index's latest observations still show 20 at the open, but the
  // container drawn from is dirty -> the town's spare is 0 -> no order
  const sp = townIronSpare(S0.townIndexEntries(w.bot))
  assert.ok(sp.spare < 3, JSON.stringify(sp))
  w.bag.splice(0, w.bag.length, ...slotted([stack('stick', 9)]))
  assert.equal(S0.townKitIronMiss(w.bot, pick()), true, 'refused: the town is at its reserve')
  const e = (n, at, last) => ({ last, obs: { at, names: { iron_ingot: [n, 1] } }, ops: {} })
  assert.equal(townIronSpare({ a: e(30, 1000, { t: 'dirty', at: 2000 }), b: e(20, 1000, { t: 'obs', at: 1000 }) }, 16, 5000).total, 20)
})

await t('THE GATE (townKitIronMiss): the spare above the reserve must fund the draw; the pickaxe prefix still meets it; no index -> the one-container rule', async () => {
  const w = fourTown({ chests: CH.slice(0, 5) })   // 20 in town, spare 4
  const items = w.bot.inventory.items()
  const whole = K.kitDraw(items), pick = K.kitDraw(items, { limit: 1 })
  assert.equal(whole.ingots, 7); assert.equal(pick.ingots, 3)
  assert.equal(S0.townKitIronMiss(w.bot, whole), true, 'the town cannot give 7 above its reserve')
  assert.equal(S0.townKitIronMiss(w.bot, pick), false, 'it can give the pickaxe its 3')
  // the order composes: whole kit short -> the prefix n=1 is ordered
  const o = toolkitOrder({ now: Date.now(), atTown: true, items, container: true, townMiss: d => S0.townKitIronMiss(w.bot, d), room: () => true, tableNear: true, state: {} })
  assert.equal(o.order?.skill, 'toolkit'); assert.equal(o.order.args.n, 1)
  const w2 = fourTown({ index: false })
  assert.equal(S0.townKitIronMiss(w2.bot, K.kitDraw(w2.bot.inventory.items())), false, 'no index: the base search (candidates, unknown)')
})

await t('SKILL, NO INDEX: the town index unread -> the one-container rule exactly (no_iron in the four-town)', async () => {
  const w = fourTown({ index: false })
  const r = await kit(S0, w)
  // the base's answer (narrow: its own opens have now indexed the town, so the next order is the multi draw's)
  assert.equal(r.status, 'failed', r.detail); assert.ok(['kit_no_iron', K.KIT_NARROW].includes(r.failClass), r.detail)
  assert.equal(townIron(w), 24, 'no iron moved'); assert.equal(field(lastRow(), 'parts'), undefined, 'no multi row field')
})

await t('MUTANTS: each removes one part of the change and a behaviour test above fails for it', async () => {
  const kills = {}
  kills.noMulti = await withMutant(SKILLS_PATH, 'const multi = draw.ingots > 0 && kitMultiOn(spare)', 'const multi = false', S => killedBy(() => measuredTown(S)))
  kills.stopAtFirst = await withMutant(SKILLS_PATH, "          if (left.ingots <= 0 || budget() <= 0) { got = v.moved; break }", "          got = v.moved; break", S => killedBy(() => measuredTown(S)))
  kills.noBudget = await withMutant(TK_PATH, 'const n = Math.max(0, Math.min(ingots, have, Math.floor(Number(budget))))', 'const n = Math.max(0, Math.min(ingots, have))', KK => killedBy(() => {
    assert.deepEqual(KK.kitTakesMulti([stack('iron_ingot', 4)], { ingots: 7, sticks: 0 }, { budget: 2 }).takes, [{ name: 'iron_ingot', count: 2 }])
  }))
  kills.noTownGate = await withMutant(SKILLS_PATH, 'if (kitMultiOn(spare)) return kitTownShort(spare, d.ingots) || townSearchEmpty(bot, [KIT_IRON_ANY], { tried: held })',
    'if (kitMultiOn(spare)) return townSearchEmpty(bot, [KIT_IRON_ANY], { tried: held })', S => killedBy(() => {
      const w = fourTown({ chests: CH.slice(0, 5) })
      assert.equal(S.townKitIronMiss(w.bot, K.kitDraw(w.bot.inventory.items())), true)
    }))
  kills.dirtyCounts = await withMutant(TK_PATH, "const n = indexStateOf(e, now) === 'dirty' ? 0 : Math.max(0, Number(e?.obs?.names?.iron_ingot?.[0]) || 0)",
    'const n = Math.max(0, Number(e?.obs?.names?.iron_ingot?.[0]) || 0)', KK => killedBy(() => {
      const e = (n, at, last) => ({ last, obs: { at, names: { iron_ingot: [n, 1] } }, ops: {} })
      assert.equal(KK.townIronSpare({ a: e(30, 1000, { t: 'dirty', at: 2000 }), b: e(20, 1000, { t: 'obs', at: 1000 }) }, 16, 5000).total, 20)
    }))
  const alive = Object.entries(kills).filter(([, k]) => !k).map(([n]) => n)
  assert.deepEqual(alive, [], `mutants that survived: ${alive}`)
  console.log(`        mutants killed: ${Object.keys(kills).join(', ')}`)
})

Date.now = realNow
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
