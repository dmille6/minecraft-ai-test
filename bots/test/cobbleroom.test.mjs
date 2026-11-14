// COBBLEROOM-01: the third band -- cobble BELOW the town cap with NO ROOM to bank it (measured 11-09, fleet .31, 6 h, 80 bots).
// `_cobble_bank` refused 670 whole stacks for want of room and 0 at the cap (701 rows); the deposit said "the cobble stays: no
// container here has room for a whole stack, and cobble never opens a new chest" 261 times; the junk well on the same visits
// said 'below' or 'unknown' and threw no cobble (avg 187-307 cobble left in the bag vs 76 at 'at_cap'). Town chests 87-100%
// full. So surplus cobble had NO exit, and bots at 34+ of 36 slots carried 6.7 cobble stacks vs 3.6 fleet-wide.
// The fix: a deposit that found no town container with room for a whole cobble stack (and banked none) leaves a 30-min note;
// the well's cobble switch then says 'no_room', which every in-town well consumer treats as it treats 'at_cap'.
// Behaviour first (the pure rules, then THE CHAIN through the real deposit and the real well switch), then anchored mutants.
import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'

process.env.LOG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-cr-logs-'))
process.env.BOT_NAME = 'RoomBot'
process.env.OLLAMA_MODEL ??= 'qwen2.5:7b-instruct'
process.env.HOME_X = '0'; process.env.HOME_Y = '64'; process.env.HOME_Z = '0'
process.env.SKILL_TIMEOUT_MS = '180000'
process.env.POOL_STATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-cr-pool-'))

const CC = await import('../src/cobblecap.mjs')
const W = await import('../src/well.mjs')
const SK = await import('../src/skills.mjs')
const { tapRecords } = await import('../src/logger.mjs')
const { fakeWorld, stack } = await import('./fakeworld.mjs')
const { SKILLS, cobbleWellCap } = SK

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 4).join('\n        ')}`) }
}
const RECS = []
tapRecords(r => RECS.push(r))
const SKILLS_PATH = new URL('../src/skills.mjs', import.meta.url)
const CAP_PATH = new URL('../src/cobblecap.mjs', import.meta.url)
async function withMutant (p, old, neu, fn) {
  const src = readFileSync(p, 'utf8')
  assert.ok(src.includes(old), `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 70))} is not in ${p.pathname}. A mutant that was never written reads as killed.`)
  assert.ok(src.split(old).length === 2, 'ANCHOR NOT UNIQUE: the mutant is ambiguous')
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, src.replace(old, neu).replace(/from '\.\//g, "from '../src/"))
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}
const CAP = CC.TOWN_COBBLE_CAP
const v = (lb, extra = {}) => ({ lb, lbLo: lb, avail: 0, taking: 0, reserved: 0, complete: true, ...extra })
const cobbleIn = items => items.filter(Boolean).reduce((n, x) => n + (/^(cobblestone|cobbled_deepslate)$/.test(x.name) ? x.count : 0), 0)
const withSlots = items => items.map((x, i) => ({ ...x, slot: 9 + i }))

// ------------------------------------------------------------------------------------------------ the pure rules
await t('SWITCH: below the cap with a fresh no-room note -> no_room (both complete and incomplete counts); without it, unchanged', () => {
  const S = CC.wellCobbleSwitch
  assert.equal(S(v(300), 64), 'below', 'positive control: below the cap, no note')
  assert.equal(S(v(300), 64, { noRoom: true }), 'no_room')
  assert.equal(S(v(300, { complete: false }), 64), 'unknown', 'positive control: an uncounted container')
  assert.equal(S(v(300, { complete: false }), 64, { noRoom: true }), 'no_room', 'no room is no room whatever the count')
  assert.equal(S(v(984), 30, { noRoom: true }), 'at_cap', 'the proven cap still reads at_cap (the rows keep their meaning)')
  assert.equal(S(v(CAP, { avail: CAP }), 64, { held: 64, noRoom: true }), 'held', 'a withdraw hold is never thrown')
  assert.equal(S(v(300), 0, { noRoom: true }), 'none', 'no surplus stack')
  assert.equal(S(v(300), 64, { noRoom: true, floorOnly: true }), 'below', 'FROM AFAR unchanged: no new trip home is licensed')
})
await t('WELL TAKES COBBLE at the two exits only', () => {
  assert.equal(CC.wellTakesCobble('at_cap'), true)
  assert.equal(CC.wellTakesCobble('no_room'), true)
  for (const c of ['below', 'unknown', 'held', 'none', null, undefined]) assert.equal(CC.wellTakesCobble(c), false, String(c))
})
await t('NOTE: set by a town refusal for room with nothing banked; cleared by a stack banked; a mine chest and a row-less deposit change nothing', () => {
  const N = CC.cobbleRoomNote, now = 1_000_000
  assert.deepEqual(N(null, [{ noRoom: 1, went: 0 }], { inTown: true, now }), { at: now })
  assert.equal(N({ at: 5 }, [{ noRoom: 1, went: 0 }, { noRoom: 0, went: 30 }], { inTown: true, now }), null, 'room was found for one stack: the town had room')
  assert.deepEqual(N({ at: 5 }, [{ noRoom: 1, went: 0 }], { inTown: false, now }), { at: 5 }, 'outside town: says nothing about the town')
  assert.equal(N(null, [{ noRoom: 1, went: 0 }], { inTown: false, now }), null)
  assert.deepEqual(N({ at: 5 }, [], { inTown: true, now }), { at: 5 }, 'no cobble rows: unchanged')
  assert.deepEqual(N({ at: 5 }, [{ noRoom: 0, went: 0, atCap: 1 }], { inTown: true, now }), { at: 5 }, 'a cap refusal is not a room refusal')
})
await t('FRESH for COBBLE_NOROOM_TTL_MS (chestfull\'s full-container memory), not after; a note from the future is not evidence', () => {
  const T = CC.COBBLE_NOROOM_TTL_MS, now = 10 * T
  assert.equal(T, 30 * 60 * 1000)
  assert.equal(CC.cobbleNoRoomFresh({ at: now - T + 1 }, now), true)
  assert.equal(CC.cobbleNoRoomFresh({ at: now - T }, now), false)
  assert.equal(CC.cobbleNoRoomFresh({ at: now + 1000 }, now), false)
  assert.equal(CC.cobbleNoRoomFresh(null, now), false)
})
await t('COMPOSED with the well\'s plan: at no_room the surplus whole stacks go and the bot keeps its 64; below, nothing cobble goes', () => {
  const bag = withSlots([stack('cobblestone', 64), stack('cobblestone', 64), stack('cobblestone', 40), stack('dirt', 3)])
  const take = cap => W.disposePlan(bag, { cobbleAtCap: CC.wellTakesCobble(cap) }).stacks.filter(s => s.name === 'cobblestone')
  assert.deepEqual(take('below'), [], 'positive control: below the cap the well keeps the cobble')
  const went = take('no_room')
  assert.ok(went.length >= 1, 'something goes')
  assert.equal(cobbleIn(bag) - went.reduce((n, s) => n + s.count, 0) >= 64, true, 'the bot\'s own 64 stay')
})

// ------------------------------------------------------------------------------------------------ THE CHAIN
// the fake bag carries no slot outside a window: give each stack the slot a real bag would (the well's stacks need one)
const town = (bag, setup) => { process.env.POOL_STATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-cr-pool-')); bag.forEach((x, i) => { x.slot = 9 + i }); const w = fakeWorld({ bag }); w.set(5, 64, 0, 'chest'); setup?.(w); return w }
const run = bot => SKILLS.deposit.run({ bot }, {}, new AbortController().signal)

await t('THE CHAIN: a full town chest refuses the cobble ("no container here has room") -> the note -> the well\'s switch says no_room -> the well\'s plan takes the surplus', async () => {
  const w = town([stack('cobblestone', 64), stack('cobblestone', 64), stack('cobblestone', 64)], w => w.fill(5, 64, 0, 'stone', 64))
  const before = cobbleWellCap(w.bot)
  assert.ok(before === 'below' || before === 'unknown', `positive control: before the deposit the well keeps it (${before})`)
  const r = await run(w.bot)
  assert.equal(r.status, 'no_effect', JSON.stringify(r)); assert.match(r.detail, /no container here has room/)
  assert.ok(CC.cobbleNoRoomFresh(w.bot.cobbleNoRoom), `the note is set: ${JSON.stringify(w.bot.cobbleNoRoom)}`)
  assert.equal(cobbleWellCap(w.bot), 'no_room', 'the well may now take it')
  const plan = W.disposePlan(withSlots(w.bag.filter(Boolean)), { cobbleAtCap: CC.wellTakesCobble(cobbleWellCap(w.bot)) })
  assert.ok(plan.stacks.some(s => s.name === 'cobblestone'), 'the well\'s plan names a cobble stack')
})
await t('POSITIVE CONTROL: a town chest WITH room banks the stack, leaves no note, and the switch stays below/unknown', async () => {
  const w = town([stack('cobblestone', 64), stack('cobblestone', 30)])
  w.bot.cobbleNoRoom = { at: Date.now() - 1000 }
  const r = await run(w.bot)
  assert.equal(r.status, 'success', r.detail)
  assert.equal(w.bot.cobbleNoRoom, null, 'a stack banked clears the note')
  assert.notEqual(cobbleWellCap(w.bot), 'no_room')
})
await t('A STALE note is not evidence: 31 min after the refusal the well keeps the cobble again', async () => {
  const w = town([stack('cobblestone', 64), stack('cobblestone', 64)])
  w.bot.cobbleNoRoom = { at: Date.now() - CC.COBBLE_NOROOM_TTL_MS - 60_000 }
  assert.notEqual(cobbleWellCap(w.bot), 'no_room')
  w.bot.cobbleNoRoom = { at: Date.now() - 60_000 }
  assert.equal(cobbleWellCap(w.bot), 'no_room', 'positive control: a fresh note')
})

// ------------------------------------------------------------------------------------------------ wiring (structural)
await t('EVERY IN-TOWN WELL CONSUMER reads the switch through wellTakesCobble (comments stripped); only the from-afar guess keeps === at_cap', () => {
  const c = readFileSync(SKILLS_PATH, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  const raw = [...c.matchAll(/cobbleWellCap\([^)]*\)(?:\)*) === 'at_cap'/g)].map(m => m[0])
  assert.deepEqual(raw, ["cobbleWellCap(bot, items, { floorOnly: true }) === 'at_cap'"], 'the one raw comparison left is the from-afar guess')
  assert.equal((c.match(/wellTakesCobble\(/g) ?? []).length, 6, 'valveProof, the click loop, the visit plan, cobbleAllowed, the entry plan, the prune rule')
  assert.match(c, /if \(!wellTakesCobble\(acc\.capLast\)\) continue/, 'the per-click re-read')
})

await t('THE 34-SLOT ORDER (Codex r1 blocker): a full bag holding only surplus cobble at no_room gets dispose_well; below, it gets nothing (the dead end)', () => {
  const bag = withSlots([stack('cobblestone', 64), stack('cobblestone', 64), stack('cobblestone', 64),
    ...Array.from({ length: 31 }, () => stack('oak_log', 64))])   // 34 slots, nothing listed but the cobble
  const order = cap => {
    const plan = W.disposePlan(bag, { cobbleAtCap: CC.wellTakesCobble(cap) })
    return W.wellOrder({ now: 10 ** 12, distHome: 3, well: () => ({ open: false, attended: false, breached: false }), state: {},
      slots: plan.slots, freeSlots: 36 - plan.slots, junkStacks: plan.junkStacks, buildJunkStacks: 0 }).order?.skill ?? null
  }
  assert.equal(order('below'), null, 'positive control: the base\'s dead end -- no junk, no order')
  assert.equal(order('no_room'), 'dispose_well')
  assert.equal(order('at_cap'), 'dispose_well', 'the cap, unchanged')
})
await t('THE SCHEDULER (cognitive.mjs, comments stripped) counts cobble through wellTakesCobble at town', () => {
  const c = readFileSync(new URL('../src/cognitive.mjs', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  assert.match(c, /^import \{ wellTakesCobble \} from '\.\/cobblecap\.mjs'/m)
  assert.match(c, /cobbleAtCap: atTown && wellTakesCobble\(cobbleWellCap\(bot, items\)\), stock:/)
  assert.doesNotMatch(c, /cobbleWellCap\([^)]*\) === 'at_cap'/, 'no raw at_cap comparison left in the scheduler')
})

// ------------------------------------------------------------------------------------------------ mutants
await t('MUTANT KILLED: without the no_room exit in the switch, the chain\'s note changes nothing', async () => {
  await withMutant(CAP_PATH, "  if (noRoom) return 'no_room'\n", '', async M => {
    assert.equal(M.wellCobbleSwitch(v(300), 64, { noRoom: true }), 'below', 'the mutant keeps the cobble below the cap')
  })
})
await t('MUTANT KILLED: a deposit that does not write the note leaves the well keeping the cobble', async () => {
  await withMutant(SKILLS_PATH,
    'try { bot.cobbleNoRoom = cobbleRoomNote(bot.cobbleNoRoom, cobbleRows, { inTown: inTown(homeVec(), chestBlock.position) }) } catch { /* the note is advisory */ }',
    '', async M => {
      const w = town([stack('cobblestone', 64), stack('cobblestone', 64), stack('cobblestone', 64)], w => w.fill(5, 64, 0, 'stone', 64))
      const r = await M.SKILLS.deposit.run({ bot: w.bot }, {}, new AbortController().signal)
      assert.match(r.detail ?? '', /no container here has room/, 'positive control: the same refusal')
      assert.notEqual(M.cobbleWellCap(w.bot), 'no_room', 'no note, no exit')
    })
})
await t('MUTANT KILLED: a note cleared by nothing (went ignored) would keep throwing after the town found room', async () => {
  await withMutant(CAP_PATH, '  if (list.some(r => (Number(r?.went) || 0) > 0)) return null\n', '', async M => {
    assert.deepEqual(M.cobbleRoomNote(null, [{ noRoom: 1, went: 0 }, { noRoom: 0, went: 30 }], { inTown: true, now: 7 }), { at: 7 }, 'the mutant sets it although a stack went in')
  })
})

console.log(`\ncobbleroom: ${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
