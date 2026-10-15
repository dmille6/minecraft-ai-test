// WITHDRAW BEFORE DIG + GOTO'S DIG-RETRY EVIDENCE (stonewithdraw-01; design docs/reports/ziggurat-mineshaft-2026-10-15.md
// 5.1 and 5.2 step 1). Behaviour only: the pure decision (stonesource.mjs) case by case, each refusal beside the
// positive control that differs from it in ONE field; the real stoneWithdrawFor on a fake town whose chest count is
// written to the cobble journal by the real cobbleObserve; the rewrite; the rung credit; the retry evidence helpers.
// Source text is read only for WIRING (cognitive calls the rewrite on the admitted action), comments stripped, with a
// mutant that must fail it.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
process.env.LOG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-sw-logs-'))
process.env.BOT_NAME = 'StoneBot'
process.env.OLLAMA_MODEL ??= 'qwen2.5:7b-instruct'
process.env.HOME_X = '0'; process.env.HOME_Y = '64'; process.env.HOME_Z = '0'
process.env.POOL_STATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-sw-pool-'))
const S = await import('../src/stonesource.mjs')
const { servesRung } = await import('../src/milestones.mjs')
const SK = await import('../src/skills.mjs')
const { fakeWorld, stack } = await import('./fakeworld.mjs')

let n = 0
const t = async (name, fn) => { await fn(); n++; console.log(`ok ${n} ${name}`) }
const home = { x: 0, y: 64, z: 0 }
const base = { block: 'stone', count: 16, pos: { x: 6, y: 64, z: 0 }, home, town: { avail: 200 }, trigger: 'idle', cooling: null, probe: () => { throw new Error('probe must not run at the surface') } }

await t('POSITIVE CONTROL: a stone gather at the surface near a stocked town is a withdrawal', () => {
  const v = S.stoneSource(base)
  assert.deepEqual(v, { source: 'withdraw', reason: 'surface', count: 16 })
})
await t('every stone-family block is covered; a non-stone gather is never touched', () => {
  for (const b of ['stone', 'cobblestone', 'cobbled_deepslate', 'deepslate']) assert.equal(S.stoneSource({ ...base, block: b }).source, 'withdraw', b)
  for (const b of ['dirt', 'oak_log', 'iron_ore', 'andesite']) assert.equal(S.stoneSource({ ...base, block: b }).reason, 'not_stone', b)
})
await t('far from town (Chebyshev > 48) keeps the gather; at 48 it still withdraws', () => {
  assert.equal(S.stoneSource({ ...base, pos: { x: 49, y: 64, z: 0 } }).reason, 'far_from_town')
  assert.equal(S.stoneSource({ ...base, pos: { x: 48, y: 64, z: -48 } }).source, 'withdraw')
})
await t('a stuck trigger keeps the gather (the bot gathers to climb OUT; a walk home is the wrong remedy)', () => {
  for (const tr of ['entombed', 'stuck', 'stranded_high', 'marooned', 'drowning', 'low_health']) assert.equal(S.stoneSource({ ...base, trigger: tr }).reason, 'stuck_trigger', tr)
  assert.equal(S.stoneSource({ ...base, trigger: 'stagnation' }).source, 'withdraw', 'stagnation is not stuck')
})
await t('the town floor: withdraw only if 64 stay behind; an unknown town keeps the gather', () => {
  assert.equal(S.stoneSource({ ...base, town: { avail: 79 } }).reason, 'town_short')
  assert.equal(S.stoneSource({ ...base, town: { avail: 80 } }).source, 'withdraw')
  assert.equal(S.stoneSource({ ...base, town: null }).reason, 'town_unknown')
})
await t('a cooling withdraw (the admission memory refuses it) keeps the gather -- no loop of failed withdrawals', () => {
  assert.equal(S.stoneSource({ ...base, cooling: 'cooldown' }).reason, 'withdraw_cooldown')
})
await t('below the surface band: withdraw only when the zero-edit walk probe reaches the town; the probe failing (or throwing) keeps the gather', () => {
  const deep = { ...base, pos: { x: 6, y: 50, z: 0 } }
  assert.equal(S.stoneSource({ ...deep, probe: () => true }).reason, 'deep_walk_ok')
  assert.equal(S.stoneSource({ ...deep, probe: () => false }).reason, 'deep_no_walk')
  assert.equal(S.stoneSource({ ...deep, probe: () => { throw new Error('x') } }).reason, 'deep_no_walk')
  assert.equal(S.stoneSource({ ...base, pos: { x: 6, y: 56, z: 0 } }).reason, 'surface', 'home.y-8 is still the surface band')
})
await t('count: the gather\'s count, clamped 1..64', () => {
  assert.equal(S.stoneSource({ ...base, count: 200 }).count, 64)
  assert.equal(S.stoneSource({ ...base, count: 0 }).count, 16)
  assert.deepEqual(S.withdrawWant({ count: 5 }), { item: 'cobblestone', count: 5 })
})
await t('rewriteForStone: only an admitted stone gather with a withdraw verdict changes, and the original is kept', () => {
  const g = { ok: true, skill: 'gather', args: { block: 'stone', count: 16 } }
  const w = S.rewriteForStone(g, { source: 'withdraw', count: 16 })
  assert.equal(w.skill, 'withdraw'); assert.deepEqual(w.args, { item: 'cobblestone', count: 16 }); assert.deepEqual(w.rewrittenFrom, { skill: 'gather', args: g.args })
  assert.equal(S.rewriteForStone(g, { source: 'gather' }), g)
  const d = { ok: true, skill: 'gather', args: { block: 'dirt', count: 16 } }
  assert.equal(S.rewriteForStone(d, { source: 'withdraw', count: 16 }), d)
  const c = { ok: true, skill: 'craft', args: { item: 'furnace' } }
  assert.equal(S.rewriteForStone(c, { source: 'withdraw', count: 16 }), c)
})
await t('the stockpile rung credits a cobble withdrawal (else the rewrite would starve its own rung); not a log withdrawal', () => {
  const task = { id: 'stockpile_stone' }
  assert.equal(servesRung('withdraw', { item: 'cobblestone', count: 16 }, task, null), true)
  assert.equal(servesRung('withdraw', { item: 'oak_log', count: 16 }, task, null), false)
  assert.equal(servesRung('gather', { block: 'stone', count: 16 }, task, null), true, 'positive control: gather still serves')
})

// ---- the real stoneWithdrawFor on a fake town: the chest's count reaches the journal through the real cobbleObserve
const townWith = async cobble => {
  process.env.POOL_STATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-sw-pool-'))
  const w = fakeWorld({ bag: [] })
  w.set(5, 64, 0, 'chest')
  const stacks = []; for (let left = cobble; left > 0; left -= 64) stacks.push(stack('cobblestone', Math.min(64, left)))
  w.stock(5, 64, 0, stacks)
  SK.installCobbleCap(w.bot)
  await SK.cobbleObserve(w.bot, { x: 5, y: 64, z: 0 }, await w.bot.openContainer(w.bot.blockAt({ x: 5, y: 64, z: 0 })))
  return w
}
await t('stoneWithdrawFor (real town view): 192 cobble in the chest + a gather of 16 -> withdraw (positive control)', async () => {
  const w = await townWith(192)
  const v = SK.stoneWithdrawFor(w.bot, { block: 'stone', count: 16 }, { trigger: 'idle' })
  assert.equal(v.source, 'withdraw', JSON.stringify(v))
})
await t('stoneWithdrawFor (real town view): 70 cobble -> the floor of 64 refuses a 16 withdrawal; an empty town too', async () => {
  const w = await townWith(70)
  assert.equal(SK.stoneWithdrawFor(w.bot, { block: 'stone', count: 16 }, { trigger: 'idle' }).reason, 'town_short')
  const e = await townWith(0)
  assert.equal(SK.stoneWithdrawFor(e.bot, { block: 'stone', count: 16 }, { trigger: 'idle' }).reason, 'town_short')
})
await t('stoneWithdrawFor: a deep bot with no probe profile (none installed) fails closed to the gather', async () => {
  const w = await townWith(192)
  w.bot.entity.position.y = 40
  assert.equal(SK.stoneWithdrawFor(w.bot, { block: 'stone', count: 16 }, { trigger: 'idle' }).reason, 'deep_no_walk')
  w.bot.noEditMovements = {}; w.bot.pathfinder.getPathTo = () => ({ status: 'success' })
  assert.equal(SK.stoneWithdrawFor(w.bot, { block: 'stone', count: 16 }, { trigger: 'idle' }).reason, 'deep_walk_ok', 'positive control: a probe that reaches -> withdraw')
})

// ---- goto's dig-retry evidence
await t('gotoRetryEvidence: only a planner verdict stamped after the leg started counts; cobble and digs are read', () => {
  const bot = { lastPathVerdict: { t: 1000, status: 'noPath', visited: 1, len: 0, ms: 0, profile: 'walk' },
                inventory: { items: () => [{ name: 'cobblestone', count: 100 }, { name: 'cobbled_deepslate', count: 20 }, { name: 'dirt', count: 5 }] },
                digTownStats: { wrapped: 7 } }
  const ev = SK.gotoRetryEvidence(bot, 900)
  assert.equal(ev.walk.status, 'noPath'); assert.equal(ev.cobble, 120); assert.equal(ev.dig0, 7)
  assert.equal(SK.gotoRetryEvidence(bot, 1001).walk, null, 'a verdict from before the leg is not this leg\'s')
  bot.digTownStats.wrapped = 12
  const a = SK.gotoRetryArgs(bot, ev, 3.04)
  assert.deepEqual(a, { walk_status: 'noPath', walk_visited: 1, walk_len: 0, walk_ms: 0, walk_profile: 'walk', bag_cobble: 120, retry_digs: 5, moved: 3 })
  const none = SK.gotoRetryArgs({}, SK.gotoRetryEvidence({}, 0), NaN)
  assert.equal(none.walk_status, 'none'); assert.equal(none.retry_digs, null); assert.equal(none.bag_cobble, 0)
})

// ---- wiring (comments stripped; each with a mutant that must fail it)
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
const wired = src => /admitted\s*=\s*rewriteForStone\(\s*asked\s*,\s*v\s*\)/.test(src) && /stoneWithdrawFor\(this\.bot,\s*asked\.args/.test(src)
await t('WIRING: cognitive applies the rewrite to the admitted action, with a mutant that removes it', () => {
  const src = strip(fs.readFileSync(new URL('../src/cognitive.mjs', import.meta.url), 'utf8'))
  assert.equal(wired(src), true)
  const old = 'admitted = rewriteForStone(asked, v)'
  assert.equal(src.split(old).length - 1, 1, 'ANCHOR present and unique')
  assert.equal(wired(src.replace(old, 'void rewriteForStone(asked, v)')), false, 'the mutant (rewrite computed, not applied) fails')
})
await t('WIRING: goto\'s two retry rows carry the evidence args (mutant: one row without them)', () => {
  const src = strip(fs.readFileSync(new URL('../src/skills.mjs', import.meta.url), 'utf8'))
  const rows = src.match(/kind: 'goto_dig_retry', status: '(success|failed)', args: gotoRetryArgs\(bot, retryEv, moved\)/g) ?? []
  assert.equal(rows.length, 2)
  const old = "kind: 'goto_dig_retry', status: 'failed', args: gotoRetryArgs(bot, retryEv, moved)"
  assert.equal(src.split(old).length - 1, 1, 'ANCHOR present and unique')
  const m = src.replace(old, "kind: 'goto_dig_retry', status: 'failed'")
  assert.equal((m.match(/kind: 'goto_dig_retry', status: '(success|failed)', args: gotoRetryArgs\(bot, retryEv, moved\)/g) ?? []).length, 1, 'the mutant is seen')
})
console.log(`stonewithdraw: ${n} passed`)
