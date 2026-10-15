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
const base = { block: 'stone', count: 16, pos: { x: 6, y: 64, z: 0 }, home, town: { avail: 200 }, trigger: 'idle', cooling: null, from: '5,64,0', probe: () => { throw new Error('probe must not run at the surface') } }

await t('POSITIVE CONTROL: a stone gather at the surface near a stocked town is a withdrawal', () => {
  const v = S.stoneSource(base)
  assert.deepEqual(v, { source: 'withdraw', reason: 'surface', count: 16, from: '5,64,0', d: 6, dy: 0 })
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
  assert.equal(S.stoneSource({ ...base, town: { avail: 200, known: false } }).reason, 'town_unknown', 'no journal is unknown, not short')
  assert.equal(S.stoneSource({ ...base, from: null }).reason, 'no_counted_container', 'no counted container holding it -> gather')
})
await t('a cooling withdraw (the admission memory refuses it) keeps the gather -- no loop of failed withdrawals', () => {
  assert.equal(S.stoneSource({ ...base, cooling: 'cooldown' }).reason, 'withdraw_cooldown')
})
await t('below the surface band the gather is kept (no probe: the withdraw route is not proven from depth); home.y-8 is still the surface', () => {
  assert.equal(S.stoneSource({ ...base, pos: { x: 6, y: 50, z: 0 } }).reason, 'below_surface')
  assert.equal(S.stoneSource({ ...base, pos: { x: 6, y: 56, z: 0 } }).reason, 'surface')
})
await t('count: the gather\'s count, clamped 1..64', () => {
  assert.equal(S.stoneSource({ ...base, count: 200 }).count, 64)
  assert.equal(S.stoneSource({ ...base, count: 0 }).count, 16)
  assert.deepEqual(S.withdrawWant({ count: 5 }), { item: 'cobblestone', count: 5 })
})
await t('rewriteForStone: only an admitted stone gather with a withdraw verdict changes, and the original is kept', () => {
  const g = { ok: true, skill: 'gather', args: { block: 'stone', count: 16 } }
  const w = S.rewriteForStone(g, { source: 'withdraw', count: 16 })
  assert.equal(w.skill, 'withdraw'); assert.deepEqual(w.args, { item: 'cobblestone', count: 16, alt: 'cobbled_deepslate' }); assert.deepEqual(w.rewrittenFrom, { skill: 'gather', args: g.args })
  assert.deepEqual(S.rewriteForStone(g, { source: 'withdraw', count: 16, from: '5,64,0' }).args, { item: 'cobblestone', count: 16, alt: 'cobbled_deepslate', from: '5,64,0' })
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
await t('stoneWithdrawFor: a deep bot keeps its gather; the same town at the surface withdraws (control)', async () => {
  const w = await townWith(192)
  assert.equal(SK.stoneWithdrawFor(w.bot, { block: 'stone', count: 16 }, { trigger: 'idle' }).from, '5,64,0', 'the counted container is named')
  w.bot.entity.position.y = 40
  assert.equal(SK.stoneWithdrawFor(w.bot, { block: 'stone', count: 16 }, { trigger: 'idle' }).reason, 'below_surface')
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
  assert.deepEqual(a, { walk_status: 'noPath', walk_visited: 1, walk_len: 0, walk_ms: 0, walk_profile: 'walk', bag_cobble: 120, retry_dig_attempts: 5, moved: 3 })
  const none = SK.gotoRetryArgs({}, SK.gotoRetryEvidence({}, 0), NaN)
  assert.equal(none.walk_status, 'none'); assert.equal(none.retry_dig_attempts, null); assert.equal(none.bag_cobble, 0)
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

const { AdmissionControl } = await import('../src/admission.mjs')
await t('the cooldown key of a rewritten withdraw is the key the rewrite checks (memoryRefuses(withdraw, withdrawWant))', () => {
  const g = { block: 'stone', count: 32 }
  const rw = S.rewriteForStone({ ok: true, skill: 'gather', args: g }, { source: 'withdraw', count: 32, from: '5,64,0' })
  assert.equal(AdmissionControl.key(rw.skill, rw.args), AdmissionControl.key('withdraw', S.withdrawWant(g)))
  assert.notEqual(AdmissionControl.key('withdraw', S.withdrawWant({ count: 16 })), AdmissionControl.key('withdraw', S.withdrawWant(g)), 'positive control: the key does see the count')
})
await t('a rewrite that did not succeed backs off 10 min whatever its count; a success leaves the backoff as it was', () => {
  assert.equal(S.stoneBackoffAfter('failed', 1000, 0), 1000 + S.STONE_BACKOFF_MS)
  assert.equal(S.stoneBackoffAfter('unknown', 1000, 0), 1000 + S.STONE_BACKOFF_MS)
  assert.equal(S.stoneBackoffAfter('success', 1000, 0), 0)
  assert.equal(S.stoneBackoffAfter('failed', 1000, 5e6), 5e6, 'never shortens a longer backoff')
})
await t('cobbleContainer: the nearest fresh count holding the need; a stale or short one is not chosen', () => {
  const now = 10_000_000
  const obs = { '5,64,0': { n: 200, at: now - 1000 }, '9,64,0': { n: 200, at: now - 2 * 3600e3 }, '2,64,0': { n: 10, at: now - 1000 }, '40,64,0': { n: 64, at: now - 1000 } }
  assert.equal(S.cobbleContainer(obs, { x: 0, y: 64, z: 0 }, 16, now), '5,64,0')
  assert.equal(S.cobbleContainer({ '9,64,0': obs['9,64,0'] }, { x: 0, y: 64, z: 0 }, 16, now), null)
  assert.equal(S.cobbleContainer(obs, { x: 0, y: 64, z: 0 }, 100, now), '5,64,0')
  assert.equal(S.cobbleContainer(obs, { x: 0, y: 64, z: 0 }, 300, now), null)
})
await t('WIRING: the rewrite passes the cooling memory AND the backoff (mutant: cooling dropped)', () => {
  const src = strip(fs.readFileSync(new URL('../src/cognitive.mjs', import.meta.url), 'utf8'))
  const ok = s => /stoneWithdrawFor\(this\.bot, asked\.args, \{ trigger, cooling \}\)/.test(s) && /this\.stoneBackoffUntil \?\? 0/.test(s) && /this\.stoneBackoffUntil = stoneBackoffAfter\(r\.status/.test(s)
  assert.equal(ok(src), true)
  const old = '{ trigger, cooling }'
  assert.equal(src.split(old).length - 1, 1, 'ANCHOR present and unique')
  assert.equal(ok(src.replace(old, '{ trigger }')), false)
})
await t('the repeat window holds the action RUN: a rewrite retargets the last entry from the gather to the withdraw', () => {
  const ac = new AdmissionControl(null)
  const g = { block: 'stone', count: 16 }, wd = { item: 'cobblestone', count: 16, alt: 'cobbled_deepslate', from: '5,64,0' }
  ac.recent.push(AdmissionControl.key('gather', g))
  ac.retargetRecent('gather', g, 'withdraw', wd)
  assert.deepEqual(ac.recent, [AdmissionControl.key('withdraw', wd)])
  ac.retargetRecent('gather', g, 'withdraw', wd)
  assert.deepEqual(ac.recent, [AdmissionControl.key('withdraw', wd)], 'only when the last entry is the proposal')
})
await t('the withdraw takes whichever of cobblestone / cobbled_deepslate the chest holds more of (withdrawItemName)', () => {
  const chest = n => n.map(([name, count]) => ({ name, count }))
  assert.equal(SK.withdrawItemName(chest([['cobbled_deepslate', 64]]), 'cobblestone', 'cobbled_deepslate'), 'cobbled_deepslate')
  assert.equal(SK.withdrawItemName(chest([['cobbled_deepslate', 64], ['cobblestone', 5]]), 'cobblestone', 'cobbled_deepslate'), 'cobbled_deepslate', 'the larger count')
  assert.equal(SK.withdrawItemName(chest([['cobbled_deepslate', 5], ['cobblestone', 64]]), 'cobblestone', 'cobbled_deepslate'), 'cobblestone')
  assert.equal(SK.withdrawItemName(chest([['cobbled_deepslate', 64]]), 'cobblestone'), 'cobblestone', 'no alt: the item as asked (positive control)')
  assert.equal(SK.withdrawItemName(chest([['oak_log', 64]]), 'cobblestone', 'cobbled_deepslate'), 'cobblestone')
})
await t('WIRING: a rewritten failure never reaches the lessons store; the named container is retried after the walk home (mutants)', () => {
  const cog = strip(fs.readFileSync(new URL('../src/cognitive.mjs', import.meta.url), 'utf8'))
  const okC = c => /if \(admitted\.rewrittenFrom\) \{[\s\S]{0,300}?\} else if \(EVIDENCE_ABOUT_THE_ACTION/.test(c)
  assert.equal(okC(cog), true)
  const oldC = 'if (admitted.rewrittenFrom) {'
  assert.equal(cog.split(oldC).length - 1, 1, 'ANCHOR present and unique')
  assert.equal(okC(cog.replace(oldC, 'if (false) {')), false)
  const sk = strip(fs.readFileSync(new URL('../src/skills.mjs', import.meta.url), 'utf8'))
  const n2 = (sk.match(/namedContainer\(bot, from\) \?\? sweep\.next\(48\)/g) ?? []).length
  assert.equal(n2, 2, 'before and after the walk home')
})
console.log(`stonewithdraw: ${n} passed`)
