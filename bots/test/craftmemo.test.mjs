// THE CRAFT REFUSAL MEMO (craftmemo-01show; docs/reports/craft-failures-2026-11-17.md). Behaviour against the real modules:
// the pure memo, the chain through the real AdmissionControl (refused -> the remedy is admitted -> a changed bag or a move
// lifts it), CAN CRAFT NOW hiding it, and the zone walk parsed from place()'s own refusal words.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
process.env.OLLAMA_MODEL ??= 'qwen2.5:7b-instruct'
process.env.LOG_DIR = process.env.LOG_DIR || '/tmp/mcbot-test-logs-craftmemo'
process.env.BOT_NAME = process.env.BOT_NAME || 'CraftMemoBot'

const require_ = createRequire(import.meta.url)
const mcData = require_('minecraft-data')('1.21.8')
const M = await import('../src/craftmemo.mjs')
const { AdmissionControl } = await import('../src/admission.mjs')
const { Lessons } = await import('../src/lessons.mjs')
const { craftableNow } = await import('../src/prompt.mjs')

let pass = 0, fail = 0
const t = (name, fn) => { try { fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) } }

// The refusal texts as craft() returns them (skills.mjs runCraftPlan / craftLevel / refusePickup).
const STATION = { status: 'failed', failClass: 'needs_station', gap: 'crafting_table',
  detail: 'could not put down a crafting_table for stone_pickaxe: reason=protected_zone goto 146 54 -63 (4 past taiga village\'s north side) and place crafting_table there: the 9 free cell(s) here are protected scenery' }
const SHORT = { status: 'failed', failClass: 'missing_ingredients', gap: 'iron_ingot', detail: 'cannot craft iron_pickaxe -- short 2x iron_ingot for the whole tree (you have 1 iron_ingot)' }
const ROOM = { status: 'failed', failClass: 'inventory_full', gap: 'inventory_space', detail: 'no room ... deposit cobblestone -- walks home' }

t('KIND: station / short / room are memoed; success, an abort-ish other and a busy craft are not', () => {
  assert.equal(M.craftRefusalKind(STATION), 'station')
  assert.equal(M.craftRefusalKind(SHORT), 'short')
  assert.equal(M.craftRefusalKind(ROOM), 'room')
  assert.equal(M.craftRefusalKind({ status: 'failed', failClass: 'other', detail: 'cannot craft stone_pickaxe -- gather cobblestone first, nothing crafts it' }), 'short')
  assert.equal(M.craftRefusalKind({ status: 'success' }), null)
  assert.equal(M.craftRefusalKind({ status: 'failed', failClass: 'craft_busy', detail: 'another craft is still finishing' }), null)
  assert.equal(M.craftRefusalKind({ status: 'failed', failClass: 'no_path', detail: 'could not open the crafting_table' }), null)
})

t('SIGNATURE: order-free, counts summed per name; a count change changes it', () => {
  const a = M.bagSignature([{ name: 'stick', count: 2 }, { name: 'cobblestone', count: 3 }, { name: 'stick', count: 1 }])
  assert.equal(a, M.bagSignature([{ name: 'cobblestone', count: 3 }, { name: 'stick', count: 3 }]))
  assert.notEqual(a, M.bagSignature([{ name: 'cobblestone', count: 4 }, { name: 'stick', count: 3 }]))
})

t('CELL: 8-block cells, negatives floor (-1 and 0 differ), non-finite is null', () => {
  assert.equal(M.memoCell({ x: 0, y: 64, z: 7.9 }), '0,8,0')
  assert.equal(M.memoCell({ x: -0.5, y: 64, z: 0 }), '-1,8,0')
  assert.equal(M.memoCell({ x: NaN, y: 1, z: 1 }), null)
})

const bag = [{ name: 'cobblestone', count: 3 }, { name: 'stick', count: 2 }]
const here = { x: 146.5, y: 54, z: -50.5 }
t('HOLDS: same bag + same cell + fresh -> held; any of the three changing lifts it; a success clears it', () => {
  const memo = new Map(), now = 1_000_000
  M.noteCraftResult(memo, { item: 'stone_pickaxe', result: STATION, items: bag, pos: here, now })
  assert.ok(M.craftMemoHolds(memo, { item: 'stone_pickaxe', items: bag, pos: { x: 147, y: 55, z: -51 }, now: now + 60_000 }), 'same cell, same bag')
  assert.equal(M.craftMemoHolds(memo, { item: 'stone_pickaxe', items: [...bag, { name: 'dirt', count: 1 }], pos: here, now }), null, 'bag changed')
  assert.equal(M.craftMemoHolds(memo, { item: 'stone_pickaxe', items: bag, pos: { x: 146, y: 54, z: -63 }, now }), null, 'moved to the cell the refusal named')
  assert.equal(M.craftMemoHolds(memo, { item: 'stone_pickaxe', items: bag, pos: here, now: now + M.MEMO_TTL_MS }), null, 'expired')
  assert.equal(M.craftMemoHolds(memo, { item: 'wooden_pickaxe', items: bag, pos: here, now }), null, 'another item')
  M.noteCraftResult(memo, { item: 'stone_pickaxe', result: { status: 'success' }, items: bag, pos: here, now })
  assert.equal(memo.size, 0)
})

t('NOT MEMOED: a failure that is not a refusal (no_path) leaves no entry', () => {
  const memo = new Map()
  M.noteCraftResult(memo, { item: 'x', result: { status: 'failed', failClass: 'no_path', detail: 'window' }, items: bag, pos: here })
  assert.equal(memo.size, 0)
})

t('ZONE WALK: parsed from place()\'s refusal as craft prefixes it; any other refusal is null', () => {
  assert.deepEqual(M.zoneWalkTarget(STATION.detail), { x: 146, y: 54, z: -63 })
  assert.equal(M.zoneWalkTarget('reason=protected_zone step 3+ blocks away from taiga village and place crafting_table there'), null)
  assert.equal(M.zoneWalkTarget('nowhere to place crafting_table'), null)
})

// ---- the chain through the real admission gate ------------------------------------------------------------------------------
function botAt (items, pos) {
  return { entity: { position: { ...pos } }, health: 20, food: 20, players: {}, registry: mcData,
           inventory: { items: () => items }, recipesFor: () => [{}], recipesAll: () => [],
           findBlock: () => null, findBlocks: () => [], blockAt: () => ({ name: 'stone', boundingBox: 'block' }) }
}
let seq = 0
const gate = () => { const L = new Lessons(`/tmp/mcai-craftmemo-${process.pid}-${seq++}.json`); L.data.avoid = {}; L.data.worked = {}; return new AdmissionControl(L) }

t('THE CHAIN: refused craft_memo after the refusal; the named remedy (goto, gather) is admitted; after the move or a bag change the craft is admitted', () => {
  const items = [{ name: 'iron_ingot', count: 1 }, { name: 'stick', count: 2 }]
  const bot = botAt(items, here)
  const g = gate()
  assert.equal(g.check({ skill: 'craft', args: { item: 'iron_pickaxe' }, reason: 'x' }, bot, new Set()).ok, true, 'positive control: admitted before any refusal')
  M.noteCraftOutcome(bot, 'iron_pickaxe', SHORT)
  const r = g.check({ skill: 'craft', args: { item: 'iron_pickaxe' }, reason: 'x' }, bot, new Set())
  assert.equal(r.ok, false); assert.equal(r.reason, 'craft_memo'); assert.match(r.detail, /gather the missing input/)
  assert.equal(g.check({ skill: 'goto', args: { x: 146, y: 54, z: -70 }, reason: 'x' }, bot, new Set()).ok, true, 'the walk is admitted')
  items.push({ name: 'iron_ingot', count: 2 })
  assert.equal(g.check({ skill: 'craft', args: { item: 'iron_pickaxe' }, reason: 'x' }, bot, new Set()).ok, true, 'a changed bag lifts it')
  items.pop(); bot.entity.position = { x: 146, y: 54, z: -70 }
  assert.equal(gate().check({ skill: 'craft', args: { item: 'iron_pickaxe' }, reason: 'x' }, bot, new Set()).ok, true, 'a move lifts it')
})

t('PROMPT: CAN CRAFT NOW drops a memoed craft and lists it again once the bag changes', () => {
  const items = [{ name: 'crafting_table', count: 1 }]
  const bot = botAt(items, here)
  const before = craftableNow(bot)
  assert.match(before, /stone_pickaxe/, 'positive control')
  M.noteCraftOutcome(bot, 'stone_pickaxe', SHORT)
  assert.doesNotMatch(craftableNow(bot), /stone_pickaxe/)
  items.push({ name: 'dirt', count: 1 })
  assert.match(craftableNow(bot), /stone_pickaxe/)
})

// ---- structural: the craft wiring (behaviour of placeTableOrWalk needs a world; the parse it rests on is tested above) -----
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
const SK = strip(readFileSync(new URL('../src/skills.mjs', import.meta.url), 'utf8'))
t('WIRED: all three table placements in craft go through placeTableOrWalk; craft() notes its top-level outcome', () => {
  assert.equal((SK.match(/const put = await placeTableOrWalk\(ctx, signal\)/g) ?? []).length, 3)
  assert.equal((SK.match(/await place\(ctx, \{ item: 'crafting_table' \}, signal\)/g) ?? []).length, 2, 'only inside placeTableOrWalk')
  assert.match(SK, /if \(depth === 0 && args\?\.item\) noteCraftOutcome\(ctx\.bot, args\.item, res, args\.count\)/)
})

const countProbe = mod => {   // codex review r1: 'short for 2' must not hold back 1 from the same bag and spot
  const memo = new Map(), now = 1_000_000
  mod.noteCraftResult(memo, { item: 'iron_pickaxe', result: SHORT, items: bag, pos: here, count: 2, now })
  assert.equal(mod.craftMemoHolds(memo, { item: 'iron_pickaxe', items: bag, pos: here, count: 1, now }), null, 'a smaller craft is held')
  assert.ok(mod.craftMemoHolds(memo, { item: 'iron_pickaxe', items: bag, pos: here, count: 2, now }), 'the same request is not held')
  assert.ok(mod.craftMemoHolds(memo, { item: 'iron_pickaxe', items: bag, pos: here, count: 3, now }), 'a larger request is not held')
  mod.noteCraftResult(memo, { item: 'p', result: STATION, items: bag, pos: here, count: 2, now })
  assert.ok(mod.craftMemoHolds(memo, { item: 'p', items: bag, pos: here, count: 1, now }), 'a station refusal holds any count')
}
t('COUNT: a refusal for 2 short does not hold back a craft of 1; admission admits it', () => {
  countProbe(M)
  const bot = botAt([{ name: 'iron_ingot', count: 3 }, { name: 'stick', count: 2 }], here)
  M.noteCraftOutcome(bot, 'iron_pickaxe', SHORT, 2)
  const L = new Lessons(`/tmp/mcai-craftmemo-${process.pid}-c.json`); L.data.avoid = {}; L.data.worked = {}
  const A = new AdmissionControl(L)
  assert.notEqual(A.check({ skill: 'craft', args: { item: 'iron_pickaxe', count: 1 }, reason: 'x' }, bot, new Set()).reason, 'craft_memo')
  assert.equal(A.check({ skill: 'craft', args: { item: 'iron_pickaxe', count: 2 }, reason: 'x' }, bot, new Set()).reason, 'craft_memo')
})

// ---- mutants: each anchor present and unique (CLAUDE.md), each must turn a test above red -----------------------------------
import { writeFileSync, unlinkSync } from 'node:fs'
async function withMutant (rel, old, neu, fn) {
  const path = new URL(rel, import.meta.url)
  const src = readFileSync(path, 'utf8')
  assert.equal(src.split(old).length, 2, `ANCHOR MISSING OR NOT UNIQUE: ${JSON.stringify(old.slice(0, 60))}`)
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, src.replace(old, neu).replace(/from '\.\//g, "from '../src/"))
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}
const killed = async (name, rel, old, neu, probe) => {
  try {
    const survived = await withMutant(rel, old, neu, async mod => { try { await probe(mod); return true } catch { return false } })
    assert.equal(survived, false, 'the mutant SURVIVED')
    pass++; console.log(`  PASS  MUTANT KILLED: ${name}`)
  } catch (e) { fail++; console.log(`  FAIL  MUTANT: ${name}\n        ${e.message}`) }
}
const holdsProbe = mod => {   // the HOLDS test's assertions against a mutated craftmemo
  const memo = new Map(), now = 1_000_000
  mod.noteCraftResult(memo, { item: 'p', result: STATION, items: bag, pos: here, now })
  assert.ok(mod.craftMemoHolds(memo, { item: 'p', items: bag, pos: here, now }))
  assert.equal(mod.craftMemoHolds(memo, { item: 'p', items: [...bag, { name: 'dirt', count: 1 }], pos: here, now }), null)
  assert.equal(mod.craftMemoHolds(memo, { item: 'p', items: bag, pos: { x: 146, y: 54, z: -63 }, now }), null)
  assert.equal(mod.craftMemoHolds(memo, { item: 'p', items: bag, pos: here, now: now + mod.MEMO_TTL_MS }), null)
  mod.noteCraftResult(memo, { item: 'p', result: { status: 'success' }, items: bag, pos: here, now }); assert.equal(memo.size, 0)
}
await killed('the bag check dropped', '../src/craftmemo.mjs', "  if (e.sig !== bagSignature(items)) return null\n", '', holdsProbe)
await killed('the cell check dropped', '../src/craftmemo.mjs', "  if (e.cell !== memoCell(pos)) return null\n", '', holdsProbe)
await killed('no expiry', '../src/craftmemo.mjs', "  if (!(now - e.at < MEMO_TTL_MS)) return null\n", '', holdsProbe)
await killed('a success does not clear', '../src/craftmemo.mjs', "  if (result?.status === 'success') { memo.delete(item); return null }\n", '', holdsProbe)
await killed('station refusal not recognised', '../src/craftmemo.mjs', "  if (r.failClass === 'needs_station' || /could not put down a crafting_table|putting it down failed/.test(d)) return 'station'\n", '', mod => assert.equal(mod.craftRefusalKind(STATION), 'station'))
await killed('zone walk parse anchored wrong', '../src/craftmemo.mjs', '(-?\\d+)/.exec', '(\\d+)/.exec', mod => assert.deepEqual(mod.zoneWalkTarget(STATION.detail), { x: 146, y: 54, z: -63 }))
await killed('admission ignores the memo', '../src/admission.mjs', "      if (memo) return { ok: false, reason: 'craft_memo', detail: craftMemoDetail(memo), memo }\n", '', mod => {
  const bot = botAt([{ name: 'iron_ingot', count: 1 }], here); M.noteCraftOutcome(bot, 'iron_pickaxe', SHORT)
  const L = new Lessons(`/tmp/mcai-craftmemo-${process.pid}-m${seq++}.json`); L.data.avoid = {}; L.data.worked = {}
  assert.equal(new mod.AdmissionControl(L).check({ skill: 'craft', args: { item: 'iron_pickaxe' }, reason: 'x' }, bot, new Set()).reason, 'craft_memo')
})
await killed('the prompt lists a memoed craft', '../src/prompt.mjs', "      if (craftMemoFor(bot, name)) continue", '', mod => {
  const bot = botAt([{ name: 'crafting_table', count: 1 }], here); M.noteCraftOutcome(bot, 'stone_pickaxe', SHORT)
  assert.doesNotMatch(mod.craftableNow(bot), /stone_pickaxe/)
})

await killed('a smaller request is held', '../src/craftmemo.mjs', "  if (e.kind === 'short' && reqCount(count) < (e.count ?? 1)) return null\n", '', countProbe)
console.log(`\ncraftmemo: ${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
