// TOOLKIT-03: the kit's iron draw is the TOWN SEARCH (toolkit.mjs kitVisitStep / kitSearchEnd; skills.mjs toolkit over
// townSearchNext / townSearchView, withdraw_pick's own search since townsearch-01/02). Behaviour first: the pure decisions by
// truth table, then the real `toolkit` skill in the fake world -- the far-chest town, a search cut by its budget that the next
// run continues, a walled-in double chest that costs ONE visit, the gate that agrees with the search, the crafts' reserve,
// the sticks-only draw -- then the REFUSAL CHAIN through the real order (toolkitOrder + townKitIronMiss + toolkitOutcome, and
// the real CognitiveLoop), and anchored mutants (withMutant: the anchor present and unique, or the mutant is not a kill).
//
// MEASURED 10-19 (ES 24 h; read-only RCON census 12:05Z): 521 kit runs ended no_iron, 156 crafted; the town chests held 2,343
// ingots and every town had 2-11 containers holding a kit's 4 + 4 kept -- the nearest of them the 1st-11th nearest home
// (median 7th). The draw looked in at most 3 containers nearest home.
import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'

process.env.LOG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-kitsearch-logs-'))
process.env.BOT_NAME = 'KitSearchBot'
process.env.OLLAMA_MODEL ??= 'qwen2.5:7b-instruct'
process.env.HOME_X = '0'; process.env.HOME_Y = '64'; process.env.HOME_Z = '0'
process.env.LLM_DECISION_COOLDOWN_MS = '50'
process.env.LOG_LEVEL = 'error'
process.env.BOT_ROLE = 'gatherer'
process.env.PLINTH_FIRST = '0'            // as toolkit.test.mjs: this fake town has no junk well by construction
process.env.SKILL_TIMEOUT_MS = '180000'   // withdraw's clock is the skill timeout; the suite's 300 ms leaves no walk
const freshPool = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-kitsearch-pool-')); process.env.POOL_STATE_DIR = d; return d }
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

// ------------------------------------------------------------------------------------------------- the pure decisions
await t('kitVisitStep: took / next (could not look inside, or the journal refused the claim) / skip / miss / stop', () => {
  assert.equal(kitVisitStep({ result: { status: 'success' } }), 'took')
  for (const fc of ['chest_unreachable', 'container_blocked', 'stock_unconfirmed']) assert.equal(kitVisitStep({ result: { status: 'failed', failClass: fc } }), 'next', fc)
  for (const fc of ['container_open', 'inventory_full', 'transfer_unsettled', 'recount_unanswered', undefined]) assert.equal(kitVisitStep({ result: { status: 'failed', failClass: fc } }), 'stop', String(fc))
  assert.equal(kitVisitStep({ result: null, skip: 'no_sticks', saw: [] }), 'skip')
  assert.equal(kitVisitStep({ result: null, skip: 'chest_no_room', saw: [] }), 'skip')
  assert.equal(kitVisitStep({ result: null, saw: [stack('dirt', 1)] }), 'miss')
  assert.equal(kitVisitStep({}), 'miss')
})
const pureEnd = (KK = K) => {
  assert.deepEqual(KK.kitSearchEnd({ left: 3 }), { outcome: 'more', failClass: 'kit_search_more' })
  assert.deepEqual(KK.kitSearchEnd({ left: 1, noSticks: true }), { outcome: 'more', failClass: 'kit_search_more' }, 'the rest may hold iron AND sticks')
  assert.deepEqual(KK.kitSearchEnd({ left: 0, noSticks: true }), { outcome: 'no_sticks', failClass: 'kit_no_sticks' })
  assert.deepEqual(KK.kitSearchEnd({ left: 0 }), { outcome: 'no_iron', failClass: 'kit_no_iron' })
  assert.deepEqual(KK.kitSearchEnd(), { outcome: 'no_iron', failClass: 'kit_no_iron' })
}
await t('kitSearchEnd: candidates left is never "no iron" (more, no backoff); an exhausted search: no_sticks when a holder lacked sticks, else no_iron', () => {
  pureEnd()
})
await t('toolkitOutcome: kit_search_more costs only the cooldown; kit_no_iron backs off; a success clears the backoff', () => {
  const now = 1e12
  assert.equal(toolkitOutcome('failed', now, {}, 'kit_search_more').backoffUntil ?? 0, 0)
  assert.equal(toolkitOutcome('failed', now, {}, 'kit_no_iron').backoffUntil, now + TOOLKIT_BACKOFF_MS)
  assert.equal(toolkitOutcome('success', now, { backoffUntil: now + 5 }).backoffUntil, 0)
})
await t(`toolkitOutcome: at most ${KIT_MORE_MAX} \`more\` runs in a row go without backoff; the next backs off and the streak starts over; any other outcome resets it (Claude r1 P2)`, () => {
  const now = 1e12
  let s = {}
  for (let i = 1; i <= KIT_MORE_MAX; i++) { s = toolkitOutcome('failed', now, s, 'kit_search_more'); assert.equal(s.backoffUntil ?? 0, 0, `more #${i}`) }
  s = toolkitOutcome('failed', now, s, 'kit_search_more')
  assert.equal(s.backoffUntil, now + TOOLKIT_BACKOFF_MS, `more #${KIT_MORE_MAX + 1} backs off`); assert.equal(s.moreStreak, 0)
  s = toolkitOutcome('failed', now, { moreStreak: 2 }, 'kit_draw'); assert.equal(s.moreStreak, 0)
  assert.equal(toolkitOutcome('failed', now, {}, 'kit_search_stalled').backoffUntil, now + TOOLKIT_BACKOFF_MS, 'stalled backs off')
  assert.equal(toolkitOutcome('failed', now, {}, 'kit_search_unseen').backoffUntil, now + TOOLKIT_BACKOFF_MS, 'unseen backs off')
})
await t('kitSearchEnd: candidates left WITHOUT progress is `stalled` (backs off); an exhausted search of a town not wholly seen is `unseen`, never no_iron (Codex r1 P1/P2)', () => {
  assert.deepEqual(kitSearchEnd({ left: 4, progressed: false }), { outcome: 'stalled', failClass: 'kit_search_stalled' })
  assert.deepEqual(kitSearchEnd({ left: 0, coverage: false }), { outcome: 'unseen', failClass: 'kit_search_unseen' })
  assert.deepEqual(kitSearchEnd({ left: 0, coverage: false, noSticks: true }), { outcome: 'no_sticks', failClass: 'kit_no_sticks' }, 'a known remedy first')
  assert.deepEqual(kitSearchEnd({ left: 0, coverage: true }), { outcome: 'no_iron', failClass: 'kit_no_iron' })
})
const ironFirst = (KK = K) => {
  const draw = { ingots: 4, sticks: 6 }
  const empty = KK.kitTakes([stack('dirt', 5)], draw, { sticksMakeable: 0 })
  assert.ok(!empty.noSticks, `an EMPTY chest is short of iron, not of sticks: ${empty.why}`)
  assert.deepEqual(empty.takes, [])
  assert.equal(KK.kitTakes([stack('iron_ingot', 20)], draw, { sticksMakeable: 0 }).noSticks, true, 'the iron there and no sticks: no_sticks')
  assert.deepEqual(KK.kitTakes([stack('iron_ingot', 20), stack('stick', 9)], draw, { sticksMakeable: 0 }).takes, [{ name: 'iron_ingot', count: 4 }, { name: 'stick', count: 6 }])
}
await t('kitTakes: the IRON is judged before the sticks -- a chest short of iron is a miss whatever the sticks (Codex r1 P1)', () => {
  ironFirst()
})
await t('THE MISS IS PER DRAW SIZE (Codex r1 P5): kit_iron for the whole kit\'s 4, kit_iron_<n> below; a container seen holding h is a miss for every n with n + 4 > h', () => {
  assert.equal(kitIronNeed(4), KIT_IRON_NEED); assert.equal(kitIronNeed(3), 'kit_iron_3'); assert.equal(kitIronNeed(1), 'kit_iron_1')
  // the base's sizes (max 4: the axe and the shovel, TOOLKIT_IRONPICK=off)
  assert.deepEqual(kitIronMissNeeds(0, 4, 4), ['kit_iron_1', 'kit_iron_2', 'kit_iron_3', 'kit_iron'])
  assert.deepEqual(kitIronMissNeeds(6, 4, 4), ['kit_iron_3', 'kit_iron'], '6 gives 1 or 2 with 4 kept')
  assert.deepEqual(kitIronMissNeeds(8, 4, 4), [], 'a whole axe-and-shovel kit\'s worth')
  // ironpick-01: the sizes run to 7 (pickaxe 3 + axe 3 + shovel 1); 4 keeps its name
  assert.deepEqual(kitIronMissNeeds(8), ['kit_iron_5', 'kit_iron_6', 'kit_iron_7'], '8 gives up to 4 with 4 kept')
  assert.deepEqual(kitIronMissNeeds(11), [], 'a whole kit\'s worth with the pickaxe')
  assert.equal(kitIronNeed(7), 'kit_iron_7'); assert.equal(kitIronNeed(9), 'kit_iron_7', 'clamped to the largest draw')
  assert.equal(kitIronNeed(9, 4), KIT_IRON_NEED, 'switch off: the base clamp')
})
await t('THE ROW: the search\'s counters come right after the gate fields, before the 300-character cut can reach them (long tool tags)', () => {
  const tags = Array.from({ length: 12 }, (_, i) => `stone_pickaxe@${i + 1}`).join(',')
  const d = toolkitRow({ needs: ['iron_axe', 'iron_shovel'], outcome: 'more', before: tags, after: tags, tried: ['1,2,3:none'],
                         search: { town: 31, cand: 30, visits: 12, vfail: 2, maxrep: 1, left: 18 } })
  assert.equal(d.length, 300)
  assert.match(d, /^phase=kit outcome=more needs=iron_axe\+iron_shovel drew=0 sticks=0 used=0 crafted=- credit=0->0 town=31 cand=30 visits=12 vfail=2 maxrep=1 left=18 stop=/)
  assert.match(toolkitRow({}), /credit=0->0 stop=/, 'no search (an early exit): the deployed layout')
  assert.match(kitSearchModeDetail(), new RegExp(`^phase=mode search=town need=${KIT_IRON_NEED} order=unknown,nearest visits=${KIT_SEARCH_VISITS} craft_reserve_s=60 `))
})

// ------------------------------------------------------------------------------------------------- the skill, end to end
const farChest = async S => {
  const w = farTown()
  let ksAtCraft = null
  const craft = fakeCraft(w)
  const r = await S.SKILLS.toolkit.run({ bot: w.bot, kitCraft: async (c, a) => { ksAtCraft ??= RECS.filter(x => x.skill?.name === '_kit_search').length; return craft(c, a) } }, {}, new AbortController().signal)
  assert.equal(r.status, 'success', r.detail)
  assert.equal(count(w.bag, 'iron_axe'), 1); assert.equal(count(w.bag, 'iron_shovel'), 1)
  assert.equal(ironIn(w, FAR), 16, 'the far chest gave the 4'); assert.equal(count(w.bag, 'iron_ingot'), 0)
  assert.equal(w.spy.opened.at(-1), kOf(FAR), 'taken in the far chest')
  assert.equal(w.spy.opened.length, 10, `every chest once: ${w.spy.opened}`)
  assert.equal(new Set(w.spy.opened).size, w.spy.opened.length, 'none twice')
  assert.match(lastRow(), / town=10 cand=10 visits=10 vfail=0 maxrep=1 left=0 /, lastRow())
  // THE CHANGE ROW: one `_kit_search` per searched run, spanning the walks (the death linkage's own row)
  const ks = RECS.filter(r => r.skill?.name === '_kit_search').at(-1)?.skill
  assert.match(ks?.detail ?? '', /^outcome=took need=kit_iron town=10 cand=10 visits=10 vfail=0 maxrep=1 left=0 tried=\[/, ks?.detail)
  assert.ok(Number.isFinite(ks.duration_ms) && ks.duration_ms >= 0)
  assert.equal(ksAtCraft, RECS.filter(x => x.skill?.name === '_kit_search').length, 'written when the search ENDED, before the first craft (Codex r1 P3)')
  return w
}
await t('THE FAR CHEST (the owner\'s scene): 10 chests, iron only in the farthest -- the draw walks chest to chest (nearest the bot) and crafts the kit there; no chest opened twice', async () => {
  await farChest(S0)
})
await t('THE FAR CHEST, CONTROL: the same town with the iron in the chest nearest the bot -- one open, the kit made', async () => {
  const w = farTown({ far: [stack('dirt', 5)] })
  w.stock(...NEAR[0], [stack('iron_ingot', 20)])
  const r = await kit(S0, w)
  assert.equal(r.status, 'success', r.detail)
  assert.deepEqual(w.spy.opened, [kOf(NEAR[0])])
})
await t('THE CHANGE ROW ON AN ABORT: a run aborted mid-search (a reflex, a death) still writes its `_kit_search` row (outcome=aborted, the visits so far) and rethrows', async () => {
  const w = farTown()
  const ac = new AbortController()
  const goto = w.bot.pathfinder.goto
  let walks = 0
  w.bot.pathfinder.goto = async g => { if (++walks === 3) { ac.abort(); const e = new Error('aborted: low_health'); e.aborted = true; throw e } return goto(g) }
  const n0 = RECS.length
  await assert.rejects(S0.SKILLS.toolkit.run({ bot: w.bot, kitCraft: fakeCraft(w) }, {}, ac.signal), e => e?.aborted)
  const ks = RECS.slice(n0).filter(r => r.skill?.name === '_kit_search')
  assert.equal(ks.length, 1)
  assert.match(ks[0].skill.detail, /^outcome=aborted need=kit_iron town=10 cand=10 visits=2 vfail=0 maxrep=1 left=-1 tried=\[5,64,3:none;10,64,4:none\]$/, ks[0].skill.detail)
  assert.equal(RECS.slice(n0).filter(r => r.skill?.name === '_kit_search').length, 1, 'once')
  // CONTROL: a run that never searched (the kit held) writes none
  const w2 = farTown({ bag: [T('iron_pickaxe', 200), T('iron_axe', 200), T('iron_shovel', 200)] })   // the whole kit (ironpick-01)
  const n1 = RECS.length
  await kit(S0, w2)
  assert.equal(RECS.slice(n1).filter(r => r.skill?.name === '_kit_search').length, 0)
})
// a town of more containers than one run may open, iron only in the farthest: run 1 stops at the budget with candidates left
// (outcome more, no backoff); the next run continues with the rest and crafts; nothing is opened twice
const GRID = (() => { const g = []; for (let x = -12; x <= 12; x += 3) for (let z = -12; z <= 12; z += 3) if (Math.hypot(x, z) <= 8 && !(x === 6 && z === 0)) g.push([x, 64, z]); return g })()   // 20: more than one run, fewer than two
const LAST = GRID.slice().sort((a, b) => Math.hypot(b[0] - 6.5, b[2] - 0.5) - Math.hypot(a[0] - 6.5, a[2] - 0.5))[0]
const resumes = async (S, KK = K) => {
  const w = farTown({ near: GRID.filter(c => kOf(c) !== kOf(LAST)) })
  w.set(...FAR, 'air'); w.containers.delete(kOf(FAR))
  w.set(...LAST, 'chest'); w.stock(...LAST, [stack('iron_ingot', 20)])
  assert.ok(GRID.length > KIT_SEARCH_VISITS, `${GRID.length} containers`)
  const r1 = await kit(S, w)
  assert.equal(r1.status, 'failed'); assert.equal(r1.failClass, 'kit_search_more', r1.detail)
  assert.equal(w.spy.opened.length, KIT_SEARCH_VISITS)
  assert.match(lastRow(), new RegExp(`^phase=kit outcome=more .* town=${GRID.length} cand=${GRID.length} visits=${KIT_SEARCH_VISITS} vfail=0 maxrep=1 left=${GRID.length - KIT_SEARCH_VISITS} `), lastRow())
  // the order: no backoff, the cooldown only -- and the gate says the town is NOT a known miss
  let state = KK.toolkitOutcome(r1.status, Date.now(), { lastIssuedAt: Date.now() }, r1.failClass)
  later(TOOLKIT_COOLDOWN_MS)
  const o = KK.toolkitOrder({ now: Date.now(), atTown: true, items: w.bag, container: true, townMiss: () => S.townKitIronMiss(w.bot), tableNear: true, state })
  assert.equal(o.order?.skill, 'toolkit', 'the next run is ordered after the cooldown alone')
  state = o.state
  const n0 = w.spy.opened.length
  const r2 = await kit(S, w)
  assert.equal(r2.status, 'success', r2.detail)
  assert.equal(w.spy.opened.at(-1), kOf(LAST))
  assert.equal(new Set(w.spy.opened).size, w.spy.opened.length, `nothing opened twice across the two runs: ${w.spy.opened}`)
  assert.ok(w.spy.opened.length - n0 <= GRID.length - KIT_SEARCH_VISITS, 'the second run looked only at the rest')
  assert.equal(ironIn(w, LAST), 16)
}
await t('THE SEARCH RESUMES: more containers than one run opens -- run 1 says `more` (no backoff, the town not a known miss), run 2 continues with the rest and crafts; nothing opened twice', async () => {
  await resumes(S0)
})
/** No path to these cells (a walled-in container): the walk throws, as mineflayer-pathfinder's does -> chest_unreachable. */
const unreachable = (w, cells) => {
  const goto = w.bot.pathfinder.goto, tries = []
  w.bot.pathfinder.goto = async g => { if (cells.some(([x, , z]) => g.x === x && g.z === z)) { tries.push(`${g.x},${g.y},${g.z}`); throw new Error('No path to the goal!') } return goto(g) }
  return tries
}
// a DOUBLE chest nearest the bot that cannot be reached: ONE visit (the old sweep marked the other half only after a window
// opened, so it spent two of its three tries on the two halves)
const doubleWalled = async S => {
  const w = farTown({ near: NEAR.slice(1) })
  const L = [7, 64, 2], R = [8, 64, 2]                                  // facing north: left at x, right at x + 1
  w.set(...L, 'chest', { facing: 'north', type: 'left' }); w.set(...R, 'chest', { facing: 'north', type: 'right' })
  w.stock(...L, [stack('iron_ingot', 20)]); w.stock(...R, [])
  const tries = unreachable(w, [L, R])
  const r = await kit(S, w)
  assert.equal(r.status, 'success', r.detail)
  assert.equal(tries.length, 1, `the double chest is ONE container: one walk to it, not one per half (${tries})`)
  assert.equal(ironIn(w, FAR), 16, 'the far chest gave the kit')
  assert.match(lastRow(), / vfail=1 maxrep=1 /, lastRow())
}
await t('A WALLED-IN DOUBLE CHEST nearest the bot costs ONE visit (both halves are one container), then the search goes on and the far chest gives the kit', async () => {
  await doubleWalled(S0)
})
// THE STICKLESS BOT (Codex/Claude r1 P1): 20 dirt chests, iron AND sticks only in the farthest, a bag with no sticks and no
// wood. Run 1 looks in 12 and says `more` (each a miss: the iron is judged first); run 2 continues and makes the kit there.
const stickless = async (S, KK = K) => {
  const w = farTown({ bag: [T('iron_pickaxe', 200), stack('crafting_table', 1)], near: GRID.filter(c => kOf(c) !== kOf(LAST)) })
  w.set(...FAR, 'air'); w.containers.delete(kOf(FAR))
  w.set(...LAST, 'chest'); w.stock(...LAST, [stack('iron_ingot', 20), stack('stick', 20)])
  let state = {}
  const runs = []
  for (let i = 0; i < 4 && !count(w.bag, 'iron_axe'); i++) {
    if (i) later(TOOLKIT_COOLDOWN_MS)
    const o = KK.toolkitOrder({ now: Date.now(), atTown: true, items: w.bag, container: true, townMiss: () => S.townKitIronMiss(w.bot), tableNear: true, state })
    state = o.state
    if (!o.order) { runs.push('none'); continue }
    const r = await kit(S, w); runs.push(r.failClass ?? r.status)
    state = KK.toolkitOutcome(r.status, Date.now(), state, r.failClass)
  }
  assert.deepEqual(runs, ['kit_search_more', 'success'], `runs ${runs}`)
  assert.equal(count(w.bag, 'iron_axe'), 1); assert.equal(ironIn(w, LAST), 16)
  assert.equal(new Set(w.spy.opened).size, w.spy.opened.length, 'nothing opened twice')
}
await t('THE STICKLESS BOT (Codex/Claude r1 P1): 20 chests, iron and sticks only in the farthest, no sticks or wood in the bag -- run 1 `more` (12 misses), run 2 makes the kit there', async () => {
  await stickless(S0)
})
// IRON WITHOUT STICKS EVERYWHERE, a stickless bag: no_sticks (the remedy named) and those holders leave THIS bot's search
// while the bag cannot make sticks -- the next run opens nothing and says no_sticks again; a log in the bag re-opens them
await t('NO STICKS: every holder has the iron but no sticks, the bag no wood -> no_sticks; the next run opens nothing (held back), and with a log in the bag the kit is made', async () => {
  const w = farTown({ bag: [T('iron_pickaxe', 200), stack('crafting_table', 1)], rest: [stack('iron_ingot', 20)], far: [stack('iron_ingot', 20)] })
  const r1 = await kit(S0, w)
  assert.equal(r1.failClass, 'kit_no_sticks', r1.detail); assert.match(r1.detail, /carry 1 log/)
  assert.equal(w.spy.opened.length, 10)
  later(TOOLKIT_COOLDOWN_MS + TOOLKIT_BACKOFF_MS)
  const r2 = await kit(S0, w)
  assert.equal(r2.failClass, 'kit_no_sticks', r2.detail); assert.equal(w.spy.opened.length, 10, 'held back: nothing opened')
  assert.equal(S0.townKitIronMiss(w.bot), true, 'the gate sees the hold-back: no order that opens nothing (Claude r2 P3-2)')
  w.bag.push({ ...stack('oak_log', 1), slot: 30 })
  assert.equal(S0.townKitIronMiss(w.bot), false, 'with a log the bag makes the sticks: the holders are candidates again')
  const r3 = await kit(S0, w)
  assert.equal(r3.status, 'success', r3.detail)
})
await t('PER-SIZE MISSES in the real search: a chest of 6 ingots is a miss for the whole kit (it keeps 4) but not for a shovel-only bot, which takes 1 from it; the gates agree per bot', async () => {
  const w = farTown({ far: [stack('dirt', 5)], near: [NEAR[0]], rest: [stack('iron_ingot', 6)] })
  const r = await kit(S0, w)
  assert.equal(r.failClass, 'kit_no_iron', r.detail)
  assert.equal(S0.townKitIronMiss(w.bot), true, 'the whole-kit bot: a known miss')
  w.bag.push({ ...T('iron_axe', 200), slot: 31 })                        // now only the shovel is wanted
  assert.equal(S0.townKitIronMiss(w.bot), false, 'the shovel-only bot: the 6 still give 1 with 4 kept')
  const r2 = await kit(S0, w)
  assert.equal(r2.status, 'success', r2.detail); assert.equal(ironIn(w, NEAR[0]), 5)
})
await t('UNSEEN (Codex r1 P2): every container in view a live miss but a town column not loaded -> the gate does not close, and the run says `unseen`, never no_iron', async () => {
  const w = farTown({ far: [stack('dirt', 5)] })
  CF.updateTownMemory(memDir(), CF.townKey(HOME), null, e => { for (const k of [...NEAR, FAR].map(kOf)) { e._ingredient_miss ??= {}; e._ingredient_miss[k] = { [KIT_IRON_NEED]: Date.now() } } })
  w.bot.world = { getColumnAt: p => (p.x > 10 ? null : {}) }                // the east columns not loaded
  assert.equal(S0.townKitIronMiss(w.bot), false)
  const r = await kit(S0, w)
  assert.equal(r.failClass, 'kit_search_unseen', r.detail); assert.equal(w.spy.opened.length, 0)
  w.bot.world = { getColumnAt: () => ({}) }                                 // CONTROL: all loaded -> the gate closes
  later(30_000)                                                              // past the scan's 20 s cache
  assert.equal(S0.townKitIronMiss(w.bot), true)
})
/** A world whose lid digs work (toolkit.test.mjs's lidReady): a pickaxe harvests stone-like lids, the hand digs dirt. */
const lidReady = w => {
  const PICKS = ['wooden_pickaxe', 'stone_pickaxe', 'iron_pickaxe', 'golden_pickaxe'].map(n => w.bot.registry.itemsByName[n]?.id).filter(x => x != null)
  const blockAt0 = w.bot.blockAt
  w.bot.blockAt = p => { const b = blockAt0(p); if (b?.name === 'cobblestone') b.canHarvest = id => PICKS.includes(id); if (b?.name === 'dirt' || b?.name === 'grass_block') b.canHarvest = () => true; if (b?.name === 'chest') b.shapes = [[0.0625, 0, 0.0625, 0.9375, 0.875, 0.9375]]; return b }
  w.bot.digTime = () => 750
  w.bot.canDigBlock = () => true
  w.digs = []
  w.bot.dig = async b => { w.digs.push(w.key(b.position.x, b.position.y, b.position.z)); w.set(b.position.x, b.position.y, b.position.z, 'air') }
  return w
}
// TOOLKIT-03 x COBBLEKEEP-01 (lids): the kit's search goes through withdraw's lid code. cobblekeep digs a DIRT lid and opens
// under LEAVES (no dig); a lid it may not break (oak_planks) is container_blocked and the search MOVES ON to the next container.
// The iron sits under the lid in the chest nearest the bot; a second holder further away is the fallback.
const lidScene = async (S, lid) => {
  const w = lidReady(farTown({ far: [stack('iron_ingot', 20)], rest: [stack('dirt', 5)] }))
  const L = NEAR[0]
  w.stock(...L, [stack('iron_ingot', 20)]); w.set(L[0], L[1] + 1, L[2], lid)
  const r = await kit(S, w)
  return { w, r, L }
}
// the blocked lid's own scene, reused by the mutant below (Claude ck P3-1: it must depend on the run treating the block as 'next')
const planksMovesOn = async S => {
  // lidplank-01: unrecorded planks may be dug now; stone is a lid no bot may break (the scene's intent: a blocked lid)
  const planks = await lidScene(S, 'stone')
  assert.equal(planks.r.status, 'success', planks.r.detail); assert.deepEqual(planks.w.digs, [], 'a never-breakable lid is never broken')
  assert.equal(ironIn(planks.w, planks.L), 20, 'the blocked chest gave nothing'); assert.equal(ironIn(planks.w, FAR), 16, 'the far chest gave the kit')
  assert.match(lastRow(), / vfail=1 /, lastRow())
}
await t('LIDS x COBBLEKEEP: a dirt lid is dug and the chest under it gives the kit; under leaves it opens with no dig; an oak_planks lid is blocked and the search moves on to the far chest', async () => {
  const dirt = await lidScene(S0, 'dirt')
  assert.equal(dirt.r.status, 'success', dirt.r.detail); assert.deepEqual(dirt.w.digs, [kOf([dirt.L[0], dirt.L[1] + 1, dirt.L[2]])], 'the dirt lid dug')
  assert.equal(ironIn(dirt.w, dirt.L), 16, 'the chest under the dug lid gave the 4')
  const leaves = await lidScene(S0, 'oak_leaves')
  assert.equal(leaves.r.status, 'success', leaves.r.detail); assert.deepEqual(leaves.w.digs, [], 'nothing dug under leaves')
  assert.equal(ironIn(leaves.w, leaves.L), 16, 'opened under the leaves')
  await planksMovesOn(S0)
})
// THE GATE IS THE SEARCH: every container a live kit_iron miss but ONE, which this bot could not reach lately -> the gate says
// "nothing here" and a forced run opens nothing (no false no_iron while uncounted containers remain, and no order for nothing)
const gateAgrees = async S => {
  const w = farTown({ far: [stack('dirt', 5)] })
  const keys = [...NEAR, FAR].map(kOf)
  CF.updateTownMemory(memDir(), CF.townKey(HOME), null, e => { for (const k of keys.slice(1)) { e._ingredient_miss ??= {}; e._ingredient_miss[k] = { [KIT_IRON_NEED]: Date.now() } } })
  assert.equal(S.townKitIronMiss(w.bot), false, 'one container not yet looked in: not a known miss')
  w.bot.withdrawSearchSkip = new Map([[keys[0], Date.now() + 30 * 60_000]])   // ...and this bot could not reach it lately
  assert.equal(S.townKitIronMiss(w.bot), true, 'the search has no candidate: the gate agrees')
  const r = await kit(S, w)
  assert.equal(r.failClass, 'kit_no_iron', r.detail); assert.equal(w.spy.opened.length, 0, 'and the run opens nothing')
  assert.match(lastRow(), / town=10 cand=0 visits=0 vfail=0 maxrep=0 left=0 /)
}
await t('THE GATE IS THE SEARCH: all but one container a live miss and that one out of this bot\'s search -> townKitIronMiss true and a run opens nothing; CONTROL: the one still in the search -> false', async () => {
  await gateAgrees(S0)
})
// THE CRAFTS' RESERVE: with 70 s left on the skill's clock no visit starts (60 s reserved + the 15 s a visit needs): the
// run learned nothing, so `stalled` (backs off), never no_iron
const reserve = async S => {
  const w = farTown()
  const ctx = { runner: { current: { startedAt: Date.now() - (180_000 - 70_000) } } }
  const r = await kit(S, w, ctx)
  assert.equal(r.failClass, 'kit_search_stalled', r.detail)
  assert.equal(w.spy.opened.length, 0, 'no visit inside the crafts\' reserve')
  const w2 = farTown()
  const r2 = await kit(S, w2, { runner: { current: { startedAt: Date.now() - (180_000 - 170_000) } } })
  assert.equal(r2.status, 'success', `CONTROL, 170 s left: ${r2.detail}`)
}
await t(`THE CRAFTS' RESERVE: ${KIT_CRAFT_RESERVE_MS / 1000} s of the clock stay the crafts' -- 70 s left opens nothing (stalled); CONTROL: 170 s left draws and crafts`, async () => {
  await reserve(S0)
})
await t('STICKS ONLY (the credit covers the iron): the search is for sticks, which the journal counts -- the counted holder first, the counted-empty never', async () => {
  const w = farTown({ bag: [T('iron_pickaxe', 200), stack('iron_ingot', 4)], far: [stack('stick', 20)] })
  w.bot.kitCredit = 4
  journalCount(kOf(FAR), { stick: 20 })
  for (const c of NEAR) journalCount(kOf(c), {})
  const r = await kit(S0, w)
  assert.equal(r.status, 'success', r.detail)
  assert.deepEqual(w.spy.opened, [kOf(FAR)])
  assert.equal(count(w.containers.get(kOf(FAR)).slots.filter(Boolean), 'stick'), 20 - 6, '4 for the recipes + the 2 kept')
})

// ------------------------------------------------------------------------------------------------- the REFUSAL CHAIN
// through the real order: toolkitOrder (cognitive.mjs #toolkitOrder's readings: the real gate) -> the skill -> toolkitOutcome
const noIronChain = async (S, KK = K) => {
  const w = farTown({ far: [stack('dirt', 5)] })
  let state = {}, issued = 0, last = null
  const order = () => KK.toolkitOrder({ now: Date.now(), atTown: true, items: w.bag, container: true, townMiss: () => S.townKitIronMiss(w.bot), tableNear: true, state })
  for (let i = 0; i < 2; i++) {                                         // t = 0, 40 min: inside one miss TTL
    if (i) later(TOOLKIT_COOLDOWN_MS + TOOLKIT_BACKOFF_MS)
    const o = order(); state = o.state
    if (o.order?.skill === 'toolkit') { issued++; last = await kit(S, w); state = KK.toolkitOutcome(last.status, Date.now(), state, last.failClass) }
  }
  assert.equal(last?.failClass, 'kit_no_iron', last?.detail)
  assert.equal(new Set(w.spy.opened).size, 10, 'every town container was looked in'); assert.equal(w.spy.opened.length, 10, 'none twice')
  assert.equal(issued, 1, `issued ${issued}: once the whole town is a known miss the order stops`)
  assert.equal(S.townKitIronMiss(w.bot), true)
  // A DEPOSIT (any bot) of iron into one chest: the town's memory says it took items -> the order re-opens, the kit is made
  w.stock(...NEAR[4], [stack('iron_ingot', 9)])
  CF.updateTownMemory(memDir(), CF.townKey(HOME), null, e => { e[kOf(NEAR[4])] = { o: 'took', at: Date.now() } })
  later(60_000)                                                         // t = 41 min: every other miss is still live
  const o = order(); state = o.state
  assert.equal(o.order?.skill, 'toolkit', 'the deposit re-opens the order')
  const n0 = w.spy.opened.length
  const r = await kit(S, w)
  assert.equal(r.status, 'success', r.detail)
  assert.deepEqual(w.spy.opened.slice(n0), [kOf(NEAR[4])], 'only the chest that took items')
}
await t('THE CHAIN, NO IRON ANYWHERE: the order issues once, the run looks in every container and says no_iron, backs off, and is NOT re-issued while the town is a known miss; a deposit re-opens it and ends in the kit', async () => {
  await noIronChain(S0)
})

// the REAL decision loop (toolkit.test.mjs's chain world): the toolkit order in a town whose iron is only in the far chest
const { Lessons } = await import('../src/lessons.mjs')
const { CognitiveLoop } = await import('../src/cognitive.mjs')
const { HOUSEKEEPING } = await import('../src/hygiene.mjs')
const ldir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcai-ks-'))
let lseq = 0
const freshLessons = () => { const L = new Lessons(path.join(ldir, `l${lseq++}.json`)); L.data.avoid = {}; L.data.worked = {}; return L }
function chainWorld ({ far = [stack('iron_ingot', 20)] } = {}) {
  const w = farTown({ bag: [stack('dirt', 16), stack('oak_log', 64), stack('oak_log', 64), stack('sand', 8), stack('cobblestone', 64), stack('cobblestone', 20),
    stack('crafting_table', 1), T('stone_pickaxe', 120), stack('stick', 8), stack('furnace', 1)], far })
  w.set(2, 64, 3, 'composter')
  Object.assign(w.bot, {
    oxygenLevel: 300, time: { day: 1, age: 1, timeOfDay: 1000 }, game: { dimension: 'overworld' }, username: 'KitSearchBot', players: {}, experience: { level: 0 },
    recipesFor: () => [], recipesAll: () => [], clearControlStates: () => {},
  })
  const fb = w.bot.findBlock.bind(w.bot), fbs = w.bot.findBlocks.bind(w.bot)
  w.bot.findBlock = o => (typeof o?.matching === 'function' ? fb(o) : null)
  w.bot.findBlocks = o => (typeof o?.matching === 'function' ? fbs(o) : [])
  return w
}
async function decisions (w, n) {
  const ran = []
  const runner = { isBusy: () => false, run: async (skill, args) => {
    if (skill === 'toolkit') {
      const r = await S0.SKILLS.toolkit.run({ bot: w.bot, kitCraft: fakeCraft(w) }, args ?? {}, null)
      ran.push({ skill, status: r.status, failClass: r.failClass })
      return { ...r, delta: { kitCrafted: r.kitCrafted ?? 0 } }
    }
    ran.push({ skill, status: 'success' })
    return { status: 'success', detail: 'ok', delta: {}, contractEvidence: [`${skill}: probe 1`] }
  } }
  const loop = new CognitiveLoop(w.bot, runner, freshLessons(), null)
  loop.llm = { decide: async () => ({ schemaValid: true, latencyMs: 1, proposal: { skill: 'status', args: {}, reason: 'probe' } }) }
  loop.milestones.cycle = 540
  loop.start()
  for (let i = 0; i < 600 && ran.length < n; i++) await new Promise(r => setTimeout(r, 30))
  loop.stop()
  assert.ok(ran.length >= n, `only ${ran.length} of ${n} decisions (a stalled loop would pass every negative): ${JSON.stringify(ran)}`)
  return ran
}
await t('CHAIN (real loop): at town with no kit and the iron only in the FAR chest, the toolkit order runs once and makes the kit from it', async () => {
  const w = chainWorld()
  const ran = await decisions(w, 6)
  const i = ran.findIndex(x => x.skill === 'toolkit')
  assert.ok(i >= 0, JSON.stringify(ran)); assert.ok(ran.slice(0, i).every(x => HOUSEKEEPING.has(x.skill)), `only housekeeping before it: ${JSON.stringify(ran)}`)
  assert.equal(ran[i].status, 'success', lastRow())
  // ironpick-01: the chain bot's best pickaxe is stone, so its kit is all three tools (7 ingots)
  assert.equal(count(w.bag, 'iron_axe'), 1); assert.equal(count(w.bag, 'iron_shovel'), 1); assert.equal(count(w.bag, 'iron_pickaxe'), 1); assert.equal(ironIn(w, FAR), 13)
  assert.equal(ran.filter(x => x.skill === 'toolkit').length, 1, 'the kit is held: no second order')
})
await t('CHAIN (real loop), NO IRON ANYWHERE: one toolkit run (no_iron after looking in all 10), then the bot goes on -- no second order, the model decides again', async () => {
  const w = chainWorld({ far: [stack('dirt', 5)] })
  const ran = await decisions(w, 6)
  const runs = ran.filter(x => x.skill === 'toolkit')
  assert.equal(runs.length, 1, JSON.stringify(ran)); assert.equal(runs[0].failClass, 'kit_no_iron')
  assert.equal(new Set(w.spy.opened).size, 10)
  assert.ok(ran.slice(ran.findIndex(x => x.skill === 'toolkit') + 1).some(x => x.skill === 'status'), 'the model decides again (no dead end)')
})

// ------------------------------------------------------------------------------------------------- wiring + mutants
const strip = src => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1')
await t('WIRED (structural, comments stripped): the licence row is written once per spawn from kitSearchModeDetail', () => {
  const idx = strip(readFileSync(new URL('../src/features.mjs', import.meta.url), 'utf8'))   // installFeatures, once per spawn (test/features-wired)
  assert.match(idx, /logEvent\(\{ kind: 'toolkit_search_mode', status: 'success', snapshot: snapshot\(bot\), detail: kitSearchModeDetail\(\) \}\)/)
  assert.match(idx, /import \{[^}]*\bkitSearchModeDetail\b[^}]*\} from '\.\/toolkit\.mjs'/)
})
await t('MUTANTS: each removes one part of the kit search and a behaviour test above fails for it', async () => {
  const kills = {}
  kills.budget3 = await withMutant(SKILLS_PATH, 'n < KIT_SEARCH_VISITS && next.block', 'n < 3 && next.block', S => killedBy(() => farChest(S)))
  kills.noMissMemory = await withMutant(SKILLS_PATH, 'e => noteIngredientMisses(e, halvesOf(bot, cb.position, v.double), kitIronMissNeeds(ironSeen)))', 'e => e)', S => killedBy(() => noIronChain(S)))
  // the old gate: every findBlocks key of the town, complete misses over them all (townContainerKeys, inlined)
  kills.oldGate = await withMutant(SKILLS_PATH, '    return townSearchEmpty(bot, [kitIronNeed(d.ingots)], { tried: held })',
    `    const home = homeVec()
    const found = bot.findBlocks?.({ point: home, maxDistance: TOWN_SCAN_RADIUS, count: 256,
      matching: b => ['chest', 'barrel', 'trapped_chest'].includes(bot.registry.blocks[b.type]?.name) && (!b.position || inTown(home, b.position)) }) ?? []
    return townIngredientMissComplete(readTownMemory(townDir(), homeTownKey(), bot.worldId ?? null), found.map(posKey), [kitIronNeed(d.ingots)])`, S => killedBy(() => gateAgrees(S)))
  kills.oneSizeMiss = await withMutant(SKILLS_PATH, 'kitIronMissNeeds(ironSeen)))', '[KIT_IRON_NEED]))', S => killedBy(async () => {
    const w = farTown({ far: [stack('dirt', 5)], near: [NEAR[0]], rest: [stack('iron_ingot', 3)] })
    await kit(S, w)                                                          // 3 held: short for every size
    w.bag.push({ ...T('iron_axe', 200), slot: 31 })
    assert.equal(S.townKitIronMiss(w.bot), true, 'a shovel-only bot knows 3 cannot give 1 with 4 kept')
  }))
  kills.noCoverage = await withMutant(SKILLS_PATH, 'coverage: !!last.view.coverage', 'coverage: true', S => killedBy(async () => {
    const w = farTown({ far: [stack('dirt', 5)] })
    CF.updateTownMemory(memDir(), CF.townKey(HOME), null, e => { for (const k of [...NEAR, FAR].map(kOf)) { e._ingredient_miss ??= {}; e._ingredient_miss[k] = { [KIT_IRON_NEED]: Date.now() } } })
    w.bot.world = { getColumnAt: p => (p.x > 10 ? null : {}) }
    const r = await kit(S, w)
    assert.equal(r.failClass, 'kit_search_unseen')
  }))
  kills.noStreakCap = await withMutant(TK_PATH, '(!more || s.moreStreak > KIT_MORE_MAX)', '(!more)', KK => killedBy(() => {
    let s = {}
    for (let i = 0; i <= KK.KIT_MORE_MAX; i++) s = KK.toolkitOutcome('failed', 1e12, s, 'kit_search_more')
    assert.ok(s.backoffUntil > 0, 'the streak is capped')
  }))
  kills.sticksFirst = await withMutant(TK_PATH, "  if (ingots > 0 && have < ingots + keep) return { takes: [], why: `holds ${have} iron_ingot, a kit draw needs ${ingots} + ${keep} kept`, ironHeld: have }\n", '', KK => killedBy(() => ironFirst(KK)))
  // re-anchored for ironpick-01 (the hold-back is now quantity-sensitive: kitStickHeld); the mutant still removes the whole line
  kills.noStickHoldBack = await withMutant(SKILLS_PATH, 'if (atRisk) for (const k of bot.kitNoSticks.keys()) { if (!kitStickHeld(bot.kitNoSticksHad.get(k), draw, makeable)) continue; kitTried.add(k); heldBack++ }', '', S => killedBy(async () => {
    const w = farTown({ bag: [T('iron_pickaxe', 200), stack('crafting_table', 1)], rest: [stack('iron_ingot', 20)], far: [stack('iron_ingot', 20)] })
    await kit(S, w); later(TOOLKIT_COOLDOWN_MS + TOOLKIT_BACKOFF_MS)
    await kit(S, w)
    assert.equal(w.spy.opened.length, 10, 'the second run held the no-stick holders back')
  }))
  kills.noReserve = await withMutant(SKILLS_PATH, 'const pc = passClock(deadline, KIT_CRAFT_RESERVE_MS)', 'const pc = passClock(deadline, 0)', S => killedBy(() => reserve(S)))
  kills.noFailSkip = await withMutant(SKILLS_PATH, "if (v.result && step !== 'took') searchFailSkip(bot, cb, v.result.failClass)", '', S => killedBy(async () => {
    // an unreachable chest nearest the bot: the next run must not walk there first again
    const w = farTown({ far: [stack('iron_ingot', 20)] })
    const tries = unreachable(w, [NEAR[0]])
    w.stock(...NEAR[1], [stack('iron_ingot', 9)])                     // the next nearest gives the first kit
    const r1 = await kit(S, w)
    assert.equal(r1.status, 'success', r1.detail); assert.equal(tries.length, 1)
    w.bag.splice(0, w.bag.length, ...slotted(BAG())); clearWithdrawHolds(); later(TOOLKIT_COOLDOWN_MS)
    const r2 = await kit(S, w)
    assert.equal(r2.status, 'success', r2.detail)
    assert.equal(tries.length, 1, 'the next run did not walk to the unreachable chest again')
  }))
  // the skill's use of it (the chain) and the pure rule (its truth table)
  kills.moreIsNoIron = await withMutant(SKILLS_PATH, 'const end = kitSearchEnd({ left: st.search.left, noSticks, progressed,', 'const end = kitSearchEnd({ left: 0, noSticks, progressed,', S => killedBy(() => resumes(S)))
  kills.pureMore = await withMutant(TK_PATH, "if (Number(left) > 0) return progressed ?", "if (false) return progressed ?", KK => killedBy(() => pureEnd(KK)))
  kills.moreBacksOff = await withMutant(TK_PATH, "const more = status === 'failed' && KIT_NO_BACKOFF.has(failClass)", 'const more = false', KK => killedBy(() => resumes(S0, KK)))
  // x cobblekeep's lids: a blocked lid must MOVE THE SEARCH ON, never end the run (toolkit.mjs KIT_VISIT_NEXT)
  // the pure rule (its truth table) AND the run's use of it, through the real lid scene (Claude ck P3-1)
  kills.blockedStops = await withMutant(TK_PATH, "new Set(['chest_unreachable', 'container_blocked', 'stock_unconfirmed'])", "new Set(['chest_unreachable', 'stock_unconfirmed'])", async KK => {
    return killedBy(() => assert.equal(KK.kitVisitStep({ result: { status: 'failed', failClass: 'container_blocked' } }), 'next'))
  })
  kills.blockedStopsRun = await withMutant(SKILLS_PATH, 'const step = kitVisitStep(v)', "const step = v.result?.failClass === 'container_blocked' ? 'stop' : kitVisitStep(v)", S => killedBy(() => planksMovesOn(S)))
  const alive = Object.entries(kills).filter(([, k]) => !k).map(([n]) => n)
  assert.deepEqual(alive, [], `mutants that survived: ${alive}`)
  console.log(`        mutants killed: ${Object.keys(kills).join(', ')}`)
})

Date.now = realNow
console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
