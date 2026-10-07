// THE COBBLE RULE (stonecap; owner 10-04 "bank only when it frees a slot"; docs/reports/cobble-rule-design-2026-10-07.md).
// Behaviour only: the pure choice (bankable.mjs cobbleBankStacks), the one allowance every caller reads (depositPlan,
// bankableExclusion, the slot prediction craftroom and withdraw use), and the real deposit skill moving cobble by slot
// through the fake world's vanilla click rules (test/fakeworld.mjs) -- what lands in the chest and what stays in the bag.
import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

process.env.LOG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-cobble-logs-'))
process.env.BOT_NAME = 'CobbleBot'
process.env.OLLAMA_MODEL ??= 'qwen2.5:7b-instruct'
process.env.HOME_X = '0'; process.env.HOME_Y = '64'; process.env.HOME_Z = '0'
process.env.SKILL_TIMEOUT_MS = '180000'
process.env.POOL_STATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-cobble-pool-'))

const B = await import('../src/bankable.mjs')
const { depositFreesSlot, depositTarget } = await import('../src/craftroom.mjs')
const { SKILLS } = await import('../src/skills.mjs')
const { tapRecords } = await import('../src/logger.mjs')
const { fakeWorld, stack } = await import('./fakeworld.mjs')
const CC = await import('../src/cobblecap.mjs')
const CF = await import('../src/chestfull.mjs')
const { cobbleObserve, cobbleTownViewFor, installCobbleCap } = await import('../src/skills.mjs')

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 3).join('\n        ')}`) }
}
const RECS = []
tapRecords(r => RECS.push(r))
const it = (name, count, slot) => ({ name, count, slot })
const picks = items => B.cobbleBankStacks(items).map(s => `${s.name}:${s.count}@${s.slot}`).join(',')
const cobbleIn = items => items.filter(Boolean).reduce((n, x) => n + (B.isCobble(x.name) ? x.count : 0), 0)

await t('cobbleBankStacks: whole stacks, smallest first, only while 64 cobble + deepslate stay', () => {
  assert.equal(B.COBBLE_RESERVE, 64)
  assert.equal(picks([it('cobblestone', 64, 9), it('cobblestone', 30, 10)]), 'cobblestone:30@10', '[64, 30] -> the 30, 64 kept')
  assert.equal(picks([it('cobblestone', 64, 9), it('cobblestone', 10, 10)]), 'cobblestone:10@10')
  assert.equal(picks([it('cobblestone', 50, 9)]), '', 'under the reserve: nothing')
  assert.equal(picks([it('cobblestone', 64, 9)]), '', 'exactly the reserve: nothing')
  assert.equal(picks([it('cobblestone', 64, 9), it('cobblestone', 63, 10)]), 'cobblestone:63@10', '127: the 63 goes and leaves exactly 64')
  assert.equal(picks([it('cobblestone', 63, 9), it('cobblestone', 62, 10)]), '', '125: even the smallest would leave 63: nothing')
  assert.equal(picks([it('cobblestone', 64, 9), it('cobblestone', 64, 10), it('cobblestone', 64, 11)]), 'cobblestone:64@9', 'creditCap 64 per name per visit')
  assert.equal(picks([it('cobblestone', 40, 9), it('cobbled_deepslate', 40, 10), it('cobbled_deepslate', 64, 11)]),
    'cobblestone:40@9,cobbled_deepslate:40@10', 'the reserve is the two names together')
  assert.equal(picks([it('stone', 640, 9), it('cobblestone', 64, 10)]), '', 'stone is not cobble and never counts for its reserve')
  assert.equal(picks([{ name: 'cobblestone', count: 64 }, { name: 'cobblestone', count: 20 }]), 'cobblestone:20@null', 'no slot: the list index orders ties')
})

await t('ONE ALLOWANCE: depositPlan / bankableExclusion / bankableInventory say exactly those stacks, and name the rule otherwise', () => {
  const bag = [it('cobblestone', 64, 9), it('cobblestone', 30, 10), it('oak_log', 20, 11)]
  assert.deepEqual(B.depositPlan(bag).filter(e => B.isCobble(e.name)), [{ name: 'cobblestone', count: 30 }])
  assert.equal(B.bankableInventory(bag).detail.cobblestone, 30)
  const small = [it('cobblestone', 50, 9), it('oak_log', 20, 11)]
  assert.equal(B.depositPlan(small, 'cobblestone').length, 0)
  assert.equal(B.bankableExclusion(small, 'cobblestone'), 'cobble_reserve')
  assert.match(B.depositNoopReason(small, 'cobblestone'), /\(cobble reserve\)/)
  assert.equal(B.bankableInventory(small).junk, 0, 'reserve cobble is not ballast')
  // a withdraw hold on cobble holds every stack (a partial hold would turn a whole stack into a partial one)
  B.setWithdrawHold('cobblestone', 3, Date.now() + 60_000)
  try { assert.equal(B.bankableExclusion(bag, 'cobblestone'), 'withdraw_hold') } finally { B.clearWithdrawHolds() }
  assert.equal(B.bankableExclusion(bag, 'cobblestone'), null, 'positive control: the hold over, the 30 goes')
})

await t('THE SLOT PREDICTION walks cobble as the transfer does (smallest first): craftroom advice and withdraw room agree', () => {
  const bag = [it('cobblestone', 64, 9), it('cobblestone', 10, 10)]
  const plan = B.depositPlan(bag).filter(e => B.isCobble(e.name))
  assert.equal(depositFreesSlot(bag, plan), true)
  assert.equal(depositTarget(bag, plan, []), 'cobblestone')
  // positive control: a non-cobble name still walks in slot order (unchanged): 2 off the 40 frees nothing
  assert.equal(depositFreesSlot([it('stick', 40, 9), it('stick', 2, 10)], [{ name: 'stick', count: 2 }]), false)
})

await t('NO LOOP: a bag holding only reserve or partial cobble satisfies deposit_surplus (bankable count 0)', () => {
  for (const bag of [[it('cobblestone', 64, 9)], [it('cobblestone', 50, 9), it('cobbled_deepslate', 10, 10)]]) {
    assert.equal(B.bankableInventory(bag).count, 0, JSON.stringify(bag))
  }
})

// a fresh pool per town: the town's container memory (chestfull.mjs) must not carry one test's full chest into the next
const town = bag => { process.env.POOL_STATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-cobble-pool-')); const w = fakeWorld({ bag }); w.set(5, 64, 0, 'chest'); return w }
const run = bot => SKILLS.deposit.run({ bot }, {}, new AbortController().signal)

await t('THE TRANSFER: [64, 30] cobble -> the 30-stack is shift-clicked whole, 64 stay; a _cobble_bank row says so', async () => {
  const w = town([stack('cobblestone', 64), stack('oak_log', 3), stack('cobblestone', 30)])
  const n0 = RECS.length
  const r = await run(w.bot)
  assert.equal(r.status, 'success', r.detail)
  assert.equal(cobbleIn(w.bag), 64, 'the reserve stayed')
  assert.equal(w.bag.filter(x => x?.name === 'cobblestone').length, 1, 'one cobble slot left: a slot was freed')
  const row = RECS.slice(n0).find(x => x.skill?.name === '_cobble_bank')
  assert.ok(row, 'the row'); assert.match(row.skill.detail, /^name=cobblestone planned=30 tried=30 moved=30 before=94 kept=64 src=\S+ reserve=64 no_room=0 town_before=0 town_after=30 complete=1 cap=256 at_cap=0 unknown=0 outside=0 unknown_keys=0$/)
  assert.equal(w.spy.transfers, 1, 'one transfer, narrowed to the 30-stack\'s slot (mineflayer\'s own transfer, as chest.deposit)')
})

await t('MOVED IS CAPPED (Codex r2): another depositor adding cobble to the chest during the transfer is not credited to this bot', async () => {
  const w = town([stack('cobblestone', 64), stack('cobblestone', 30)])
  const orig = w.bot.transfer.bind(w.bot)
  w.bot.transfer = async o => { await orig(o); w.containers.get(w.key(5, 64, 0)).slots[20] = stack('cobblestone', 25) }   // someone else's 25
  const n0 = RECS.length
  const r = await run(w.bot)
  assert.equal(r.status, 'success', r.detail)
  assert.match(RECS.slice(n0).find(x => x.skill?.name === '_cobble_bank')?.skill?.detail ?? '', / moved=30 before=94 kept=64 /)
})

await t('ROOM FIRST: a chest with room for only part of a stack takes NONE of it (a partial would free no slot); the chest-full path follows', async () => {
  const w = town([stack('cobblestone', 64), stack('cobblestone', 30)])
  // room for 14 cobble only: 26 full stone stacks and one cobblestone x50 (vanilla would merge 14 and leave 16 in the slot)
  w.stock(5, 64, 0, [stack('cobblestone', 50), ...Array.from({ length: 26 }, () => stack('stone', 64))])
  const r = await run(w.bot)
  assert.equal(cobbleIn(w.bag), 94, 'nothing moved')
  assert.notEqual(r.status, 'success', JSON.stringify(r))
  // positive control: the same bag with one empty container slot banks the 30
  const ok = town([stack('cobblestone', 64), stack('cobblestone', 30)])
  const r2 = await run(ok.bot)
  assert.equal(r2.status, 'success', r2.detail); assert.equal(cobbleIn(ok.bag), 64)
})

await t('UNDER THE RESERVE NOTHING MOVES, and the refusal names the rule', async () => {
  const w = town([stack('cobblestone', 50)])
  const r = await SKILLS.deposit.run({ bot: w.bot }, { item: 'cobblestone' }, new AbortController().signal)
  assert.equal(cobbleIn(w.bag), 50)
  assert.match(r.detail ?? '', /cobble reserve/, JSON.stringify(r))
})

await t('COBBLE NEVER GROWS THE BANK (the 10-04 SYNTHESIS; both reviews): a full chest and a cobble-only plan -> no recovery, no chest placed, no closure', async () => {
  const w = town([stack('cobblestone', 64), stack('cobblestone', 64), stack('chest', 1)])
  w.fill(5, 64, 0, 'stone', 64)
  const n0 = RECS.length
  const r = await run(w.bot)
  assert.equal(r.status, 'no_effect', JSON.stringify(r)); assert.match(r.detail, /cobble never opens a new chest/)
  assert.equal(w.spy.placed.length, 0, 'no chest placed'); assert.equal(w.bag.filter(Boolean).find(x => x.name === 'chest')?.count, 1)
  assert.equal(RECS.slice(n0).filter(x => x.skill?.name === '_deposit_new_chest').length, 0)
  assert.ok(!w.bot.bankClosed, 'the bank stays open')
  assert.match(RECS.slice(n0).find(x => x.skill?.name === '_cobble_bank')?.skill?.detail ?? '', /moved=0 .* no_room=1 /)
  // positive control: the same full chest with an oak_log stack to bank DOES go to the recovery (the existing behaviour)
  const o = town([stack('oak_log', 64), stack('chest', 1)])
  o.fill(5, 64, 0, 'stone', 64)
  const r2 = await run(o.bot)
  assert.notEqual(r2.detail, r.detail); assert.doesNotMatch(r2.detail ?? '', /cobble never opens/)
})

await t('NOTHING BANKABLE IS NEVER DUE, and admission refuses an empty requested plan before any walk (the SYNTHESIS item both reviews asked for)', async () => {
  assert.equal(B.depositDue({ bankable: 0, distHome: 3, storageWithin48: true, occupiedSlots: 36 }), false)
  assert.equal(B.depositDue({ bankable: 30, distHome: 3, storageWithin48: true, occupiedSlots: 36 }), true, 'positive control')
  const { AdmissionControl } = await import('../src/admission.mjs')
  const { Lessons } = await import('../src/lessons.mjs')
  const ac = new AdmissionControl(new Lessons(path.join(os.tmpdir(), `mcai-cobble-lessons-${process.pid}.json`)))
  const w = town([stack('cobblestone', 50), stack('oak_log', 20)])
  const r = ac.check({ skill: 'deposit', args: { item: 'cobblestone' } }, w.bot, null)
  assert.equal(r.ok, false, JSON.stringify(r)); assert.equal(r.reason, 'deposit_nothing_to_bank'); assert.match(r.detail, /cobble reserve/)
  const ok = ac.check({ skill: 'deposit', args: { item: 'oak_log' } }, w.bot, null)
  assert.equal(ok.ok, true, `positive control: the logs are admitted: ${JSON.stringify(ok)}`)
})


// ================================================================================== THE TOWN COBBLE CAP (cobblecap.mjs)
const NOW = 1_000_000_000
const obs = (n, ago = 0) => ({ n, at: NOW - ago })
await t('CAP, pure: a lower bound at the cap needs no completeness; below it, an uncounted container is UNKNOWN; a stack that would pass 256 is at_cap', () => {
  const v = (lb, complete, reserved = 0) => ({ lb, complete, reserved })
  assert.equal(CC.cobbleAdmit(v(256, false), 1), 'at_cap', 'proven at the cap by what is known')
  assert.equal(CC.cobbleAdmit(v(300, true), 64), 'at_cap')
  assert.equal(CC.cobbleAdmit(v(10, false), 30), 'unknown', '"currently below 256" on a partial count is not enough')
  assert.equal(CC.cobbleAdmit(v(200, true), 56), 'bank', 'exactly 256 is allowed')
  assert.equal(CC.cobbleAdmit(v(200, true), 57), 'at_cap', 'one past 256 is not')
  assert.equal(CC.cobbleAdmit(v(150, true, 64), 64), 'at_cap', 'cobble on its way counts, this bot\'s own earlier stacks too')
  assert.deepEqual(CC.admitStacks(v(200, true), [20, 30, 64]), { bank: [20, 30], refused: { at_cap: 1, unknown: 0 } }, 'each admitted stack is charged before the next (220, 250; 314 refused)')
})
await t('CAP, pure: townCobble -- fresh counts sum to a lower bound; stale ones and unscanned keys are unknown; EVERY live admitted claim counts however old; a VOIDED one forces a recount', () => {
  const claim = (n, at, k, bot = 'x', st = 'live', extra = {}) => ({ n, at, k, bot, decision: 'bank', state: st, voidAt: null, voidSeq: null, ...extra })
  const state = { obs: { a: { n: 100, at: NOW, seq: 1 }, b: { n: 50, at: NOW - CC.OBS_TTL_MS - 1, seq: 2 }, c: { n: 30, at: NOW, seq: 3 }, d: { n: 40, at: NOW - 10, seq: 4 } },
                  claims: { r1: claim(64, NOW, 'a'), r2: claim(64, NOW - 50, 'd', 'y', 'void', { voidAt: NOW - 20, voidSeq: 5 }), r3: claim(10, NOW, 'c', 'me'),
                            r6: claim(5, NOW - 24 * 3600_000, 'c', 'z') } }
  const v = CC.townCobble(state, ['a', 'b', 'c', 'd'], NOW, { me: 'me' })
  assert.equal(v.lb, 130, 'a + c; b stale; d: its count was appended before the void of r2')
  assert.deepEqual(v.unknown.sort(), ['b', 'd']); assert.equal(v.complete, false)
  assert.equal(v.reserved, 79, 'r1 + r3 + r6: a live claim a day old still counts (Codex r3 P1: no clock fences a paused transfer)'); assert.equal(v.mine, 10)
  const s3 = { ...state, obs: { ...state.obs, d: { n: 104, at: NOW - 10, seq: 6 } } }
  const v3 = CC.townCobble(s3, ['a', 'c', 'd'], NOW)
  assert.equal(v3.complete, true, 'a count appended and captured after the void resolves it'); assert.equal(v3.lb, 234)
  assert.equal(CC.townCobble({ obs: {} }, [], NOW).complete, false, 'a town with no container scanned is never complete')
  assert.equal(CC.townCobble({ obs: { a: obs(10) } }, ['a'], NOW, { coverage: false }).complete, false, 'a scan that did not cover the town is never complete')
  assert.equal(CC.townCobble({ obs: { a: obs(10), g: obs(500) } }, ['a'], NOW, { gone: ['g'] }).lb, 10, 'a container that is gone no longer counts')
})
await t('CAP, the fold: the latest CAPTURE wins whatever the append order; an equal capture takes the larger count; claims are decided at their own place; a releasing count wins over earlier ones whatever the clock', () => {
  const rec = (t, o) => ({ t, ...o })
  const o1 = rec('obs', { k: 'a', n: 100, cap: 50 }), o2 = rec('obs', { k: 'a', n: 120, cap: 60 })
  assert.equal(CC.foldJournal([o2, o1]).state.obs.a.n, 120, 'appended late, captured early: the older count does not overwrite')
  const e1 = rec('obs', { k: 'a', n: 100, cap: 70 }), e2 = rec('obs', { k: 'a', n: 130, cap: 70 })
  assert.equal(CC.foldJournal([e1, e2]).state.obs.a.n, 130); assert.equal(CC.foldJournal([e2, e1]).state.obs.a.n, 130, 'equal capture times: the larger count, in either order')
  const base = rec('obs', { k: 'a', n: 150, cap: NOW - 5 })
  const c1 = rec('claim', { id: 'c1', n: 64, k: 'a', at: NOW, bot: 'p', keys: ['a'], coverage: true })
  const c2 = rec('claim', { id: 'c2', n: 64, k: 'a', at: NOW + 1, bot: 'q', keys: ['a'], coverage: true })
  assert.equal(CC.foldJournal([base, c1, c2], { upto: 'c1' }).decision, 'bank', '150 + 64')
  assert.equal(CC.foldJournal([base, c1, c2], { upto: 'c2' }).decision, 'at_cap', '150 + 64 reserved + 64 > 256: the later claim is refused')
  assert.equal(CC.foldJournal([base, c2, c1], { upto: 'c2' }).decision, 'bank', 'the order decides, and every reader sees the same order')
  const done = CC.foldJournal([base, c1, rec('cnt', { k: 'a', n: 214, cap: NOW + 2, ids: ['c1'] }), c2], { upto: 'c2' })
  assert.equal(done.decision, 'at_cap', 'released into a count of 214: 214 + 64 > 256'); assert.equal(done.state.claims.c1, undefined, 'a released claim is dropped')
  assert.equal(Object.keys(CC.foldJournal([base, c1, c2]).state.claims).join(), 'c1', 'a refused claim is not kept')
  // a clock step back (Codex r3 P1): 150 counted at 1000; the claim, its transfer and its releasing count at 900-901
  const back = CC.foldJournal([rec('obs', { k: 'a', n: 150, cap: 1000 }), rec('claim', { id: 'x', n: 64, k: 'a', at: 900, keys: ['a'], coverage: true }),
    rec('cnt', { k: 'a', n: 214, cap: 901, ids: ['x'] }), rec('claim', { id: 'y', n: 64, k: 'a', at: 902, keys: ['a'], coverage: true })], { upto: 'y' })
  assert.equal(back.state.obs.a.n, 214, 'the releasing count stands'); assert.equal(back.decision, 'at_cap', '214 + 64 > 256')
  assert.equal(CC.foldJournal([rec('claim', { id: 'c3', n: 10, k: 'a', at: NOW, keys: ['a'], coverage: false })], { upto: 'c3' }).decision, 'unknown', 'the claimant\'s scan did not cover the town')
})
await t('CAP, the journal: 4 processes each claiming 64 against a counted 150 -> exactly one admitted, every reader agrees, the town stays <= 256', async () => {
  const { spawn } = await import('node:child_process')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-cobble-journal-'))
  const key = 'town-x'
  CC.appendJournal(dir, key, null, { t: 'obs', k: 'a', n: 150, cap: Date.now() })
  const url = new URL('../src/cobblecap.mjs', import.meta.url).href
  const child = i => new Promise(res => {
    const code = `const C = await import(${JSON.stringify(url)});
      const r = C.claimStack(${JSON.stringify(dir)}, ${JSON.stringify(key)}, null, { id: 'b${i}', n: 64, k: 'a', bot: 'b${i}', keys: ['a'], coverage: true });
      console.log(r.decision)`
    const p = spawn(process.execPath, ['--input-type=module', '-e', code], { stdio: ['ignore', 'pipe', 'inherit'] })
    let out = ''; p.stdout.on('data', b => { out += b }); p.on('close', () => res(out.trim()))
  })
  const got = await Promise.all([0, 1, 2, 3].map(child))
  assert.equal(got.filter(x => x === 'bank').length, 1, JSON.stringify(got))
  assert.ok(got.every(x => ['bank', 'at_cap'].includes(x)), JSON.stringify(got))
  const recs = CC.readJournal(dir, key)
  for (let i = 0; i < 4; i++) assert.equal(CC.foldJournal(recs, { upto: `b${i}` }).decision, got[i], `a later reader decides b${i} as its claimant did`)
  const v = CC.townCobble(CC.readTown(dir, key), ['a'], Date.now())
  assert.ok(v.lb + v.reserved <= 256, JSON.stringify(v)); assert.equal(v.reserved, 64)
  assert.equal(recs.filter(r => r.t === 'rel').length, 3, 'every refused claim was released at once')
})
await t('CAP, an abandoned claim (Codex r3 P1): stays reserved however old; its bot\'s NEXT instance voids it; then its container is unknown until recounted', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-cobble-crash-'))
  const t0 = Date.now() - 24 * 3600_000 + 60_000
  CC.appendJournal(dir, 'k', null, { t: 'obs', k: 'a', n: 200, cap: Date.now() - 60_000 })
  CC.appendJournal(dir, 'k', null, { t: 'claim', id: 'A', n: 40, k: 'a', at: Date.now() - 50_000, bot: 'Ann', inst: 'dead-1', keys: ['a'], coverage: true })
  CC.appendJournal(dir, 'k', null, { t: 'obs', k: 'a', n: 200, cap: Date.now() - 40_000 })              // B counts 200: A paused, or crashed after?
  assert.equal(CC.claimStack(dir, 'k', null, { id: 'C', n: 40, k: 'a', keys: ['a'], coverage: true }).decision, 'at_cap', '200 + A\'s 40 still reserved + 40 > 256')
  assert.equal(CC.claimStack(dir, 'k', null, { id: 'C2', n: 16, k: 'a', keys: ['a'], coverage: true }).decision, 'bank', 'positive control: 200 + 40 + 16 = 256')
  CC.appendJournal(dir, 'k', null, { t: 'cnt', k: 'a', n: 216, cap: Date.now(), ids: ['C2'] })
  assert.equal(CC.voidOwnClaims(dir, 'k', null, { bot: 'Bob' }), 0, 'another bot never voids it')
  assert.equal(CC.voidOwnClaims(dir, 'k', null, { bot: 'Ann' }), 1, 'Ann\'s next instance voids its predecessor\'s claim')
  assert.equal(CC.claimStack(dir, 'k', null, { id: 'D', n: 16, k: 'a', keys: ['a'], coverage: true }).decision, 'unknown', 'did A\'s 40 land? the container is recounted first')
  CC.appendJournal(dir, 'k', null, { t: 'obs', k: 'a', n: 256, cap: Date.now() + 1 })                     // the recount: it had landed
  assert.equal(CC.claimStack(dir, 'k', null, { id: 'E', n: 1, k: 'a', keys: ['a'], coverage: true }).decision, 'at_cap')
  void t0
})
await t('CAP, the journal: a dead writer\'s fragment never swallows the next record; another world\'s records are not read; a journal too large fails CLOSED', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-cobble-torn-'))
  CC.appendJournal(dir, 'k', 'w1', { t: 'obs', k: 'a', n: 150, cap: 1 })
  CC.appendJournal(dir, 'k', 'w2', { t: 'obs', k: 'a', n: 99, cap: 2 })
  fs.appendFileSync(path.join(dir, 'k.cobble.jsonl'), '{"t":"obs","k":"a","n":500,"cap":3,"w":"w1"')   // a writer died mid-line
  assert.deepEqual(CC.readJournal(dir, 'k', 'w1').map(r => r.n), [150])
  CC.appendJournal(dir, 'k', 'w1', { t: 'cnt', k: 'a', n: 214, cap: 4, ids: [] })                       // the next record, after the fragment
  assert.equal(CC.readTown(dir, 'k', 'w1').obs.a.n, 214, 'the count after a fragment is read whole (Codex r3 P1)')
  assert.equal(CC.readTown(dir, 'k', 'w2').obs.a.n, 99)
  assert.equal(CC.readTown(dir, 'k', 'w1', { maxBytes: 64 }), null, 'too large to replay: unknown')
  assert.equal(CC.claimStack(dir, 'k', 'w1', { id: 'Z', n: 1, k: 'a', keys: ['a'], coverage: true }, { maxBytes: 64 }).decision, 'unknown')
})
await t('CAP, the checkpoint (Claude r3 P2): a reader folds only past it, the state equals a full replay, and a claimant still finds its own claim', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-cobble-ckpt-'))
  const now = Date.now()
  for (let i = 0; i < 400; i++) {                                                     // 400 counts and 400 released claims
    CC.appendJournal(dir, 'k', null, { t: 'claim', id: `q${i}`, n: 1, k: `c${i % 20}`, at: now, bot: 'x', inst: 'i', keys: [`c${i % 20}`], coverage: false })
    CC.appendJournal(dir, 'k', null, { t: 'cnt', k: `c${i % 20}`, n: i % 7, cap: now - 1000 + i, ids: [`q${i}`] })
  }
  const full = CC.foldJournal(CC.readJournal(dir, 'k')).state
  assert.equal(Object.keys(full.claims).length, 0, 'released claims are not carried'); assert.equal(Object.keys(full.obs).length, 20)
  const s1 = {}
  const st1 = CC.readTown(dir, 'k', null, { ckptEvery: 1024, stats: s1 })
  assert.deepEqual(st1, full); assert.equal(s1.folded, 800); assert.ok(fs.existsSync(path.join(dir, 'k.cobble.ckpt.json')), 'a checkpoint was written')
  const s2 = {}
  assert.deepEqual(CC.readTown(dir, 'k', null, { ckptEvery: 1024, stats: s2 }), full); assert.equal(s2.folded, 0, 'the second read folds nothing old')
  CC.appendJournal(dir, 'k', null, { t: 'obs', k: 'c0', n: 3, cap: now + 5 })
  const s3 = {}
  assert.equal(CC.readTown(dir, 'k', null, { stats: s3 }).obs.c0.n, 3); assert.equal(s3.folded, 1)
  assert.equal(CC.claimStack(dir, 'k', null, { id: 'mine', n: 1, k: 'c0', keys: Array.from({ length: 20 }, (_, i) => `c${i}`), coverage: true }).decision, 'bank', 'the claim is found past the checkpoint')
  fs.writeFileSync(path.join(dir, 'k.cobble.ckpt.json'), JSON.stringify({ v: 1, ino: -1, world: null, offset: 10, seq: 0, state: { obs: { c0: { n: 999, at: now + 9, seq: 1 } }, claims: {}, scan: null } }))
  assert.equal(CC.readTown(dir, 'k').obs.c0.n, 3, 'a checkpoint for another file is ignored')
})

const capTown = (bag, chestCobble = 0) => {
  const w = town(bag)
  if (chestCobble) w.stock(5, 64, 0, [stack('cobblestone', Math.min(64, chestCobble)), ...(chestCobble > 64 ? [stack('cobblestone', Math.min(64, chestCobble - 64))] : []),
    ...(chestCobble > 128 ? [stack('cobblestone', Math.min(64, chestCobble - 128))] : []), ...(chestCobble > 192 ? [stack('cobblestone', chestCobble - 192)] : [])])
  return w
}
await t('CAP, the deposit: a town chest holding 250 -> at the cap: no cobble moves, the sentence names the cap, nothing else happens', async () => {
  const w = capTown([stack('cobblestone', 64), stack('cobblestone', 30)], 250)
  const n0 = RECS.length
  const r = await run(w.bot)
  assert.equal(cobbleIn(w.bag), 94, 'nothing banked'); assert.equal(r.status, 'no_effect', JSON.stringify(r)); assert.match(r.detail, /town cobble cap/)
  assert.equal(w.spy.placed.length, 0)
  assert.match(RECS.slice(n0).find(x => x.skill?.name === '_cobble_bank')?.skill?.detail ?? '', /moved=0 .* town_before=250 .* at_cap=1 /)
})
await t('CAP, the deposit: a town chest holding 100 (counted, complete) -> the 30-stack is banked (130 <= 256), the row says town 100 -> 130', async () => {
  const w = capTown([stack('cobblestone', 64), stack('cobblestone', 30)], 100)
  const n0 = RECS.length
  const r = await run(w.bot)
  assert.equal(r.status, 'success', r.detail); assert.equal(cobbleIn(w.bag), 64)
  assert.match(RECS.slice(n0).find(x => x.skill?.name === '_cobble_bank')?.skill?.detail ?? '', /moved=30 .* town_before=100 town_after=130 complete=1 cap=256 at_cap=0 unknown=0 outside=0 unknown_keys=0$/)
})
await t('CAP, RECONCILIATION: a town container never counted -> the deposit counts it first (walk, open, count), then banks within the cap', async () => {
  const w = capTown([stack('cobblestone', 64), stack('cobblestone', 30)], 10)
  w.set(-6, 64, 0, 'barrel')                                           // in town, never opened
  const n0 = RECS.length
  const r = await run(w.bot)
  assert.ok(w.spy.opened.includes(w.key(-6, 64, 0)), 'the uncounted barrel was opened and counted')
  assert.match(RECS.slice(n0).find(x => x.skill?.name === '_cobble_reconcile')?.skill?.detail ?? '', /^counted=[12] of [12] tried \(max 3\)$/)
  assert.equal(r.status, 'success', r.detail); assert.equal(cobbleIn(w.bag), 64, 'counted and complete: the 30 goes')
})
await t('CAP, RECONCILIATION THAT CANNOT COUNT: an unopenable uncounted container -> UNKNOWN: no cobble moves, the sentence names it', async () => {
  const w = capTown([stack('cobblestone', 64), stack('cobblestone', 30), stack('oak_log', 10)], 10)
  w.set(-6, 64, 0, 'barrel')
  const open = w.bot.openContainer.bind(w.bot)
  w.bot.openContainer = async b => { if (b.position.x === -6) throw new Error('windowOpen did not fire'); return open(b) }
  const r = await run(w.bot)
  assert.equal(cobbleIn(w.bag), 94, 'unknown stock: nothing banked'); assert.equal(r.status, 'success', 'positive control: the logs still went')
})
await t('CAP, ADMISSION through the installed reader: in town with only uncounted-cobble surplus -> the deposit is ADMITTED (to count); out of town -> refused, rule named', async () => {
  const { AdmissionControl } = await import('../src/admission.mjs')
  const { Lessons } = await import('../src/lessons.mjs')
  const ac = new AdmissionControl(new Lessons(path.join(os.tmpdir(), `mcai-cobble-lessons2-${process.pid}.json`)))
  const w = capTown([stack('cobblestone', 64), stack('cobblestone', 30)], 10)
  w.set(-6, 64, 0, 'barrel')
  installCobbleCap(w.bot)
  try {
    assert.equal(B.bankableExclusion(w.bag.filter(Boolean), 'cobblestone'), 'town_cobble_unknown')
    const r = ac.check({ skill: 'deposit', args: {} }, w.bot, null)
    assert.equal(r.ok, true, JSON.stringify(r))
    w.bot.entity.position = w.bot.entity.position.offset(80, 0, 0)
    const far = ac.check({ skill: 'deposit', args: { item: 'cobblestone' } }, w.bot, null)
    assert.equal(far.ok, false); assert.match(far.detail, /town cobble not yet counted/)
  } finally { B.setCobbleTownReader(null) }
})
await t('CAP, a chest OUTSIDE town never takes cobble (the cap is the town\'s), and its reservation is never left behind', async () => {
  const w = capTown([stack('cobblestone', 64), stack('cobblestone', 30), stack('oak_log', 5)], 0)
  w.set(5, 64, 0, 'air'); w.set(40, 64, 0, 'chest')
  w.bot.entity.position = w.bot.entity.position.offset(34, 0, 0)
  const n0 = RECS.length
  const r = await run(w.bot)
  assert.equal(cobbleIn(w.bag), 94, 'no cobble into an out-of-town chest'); assert.equal(r.status, 'success', 'positive control: the logs went')
  assert.match(RECS.slice(n0).find(x => x.skill?.name === '_cobble_bank')?.skill?.detail ?? '', /moved=0 .* at_cap=0 unknown=0 outside=1 /, 'refused as OUTSIDE, by the rule (not by an accident of the view)')
  assert.deepEqual(Object.values(CC.readTown(process.env.POOL_STATE_DIR, CF.townKey({ x: 0, y: 64, z: 0 })).claims), [], 'no claim left behind')
})
await t('CAP, OBSERVED ON OPEN: a deposit that banks no cobble (logs only, cobble at the reserve) still records the chest\'s cobble count', async () => {
  const w = capTown([stack('cobblestone', 64), stack('oak_log', 20)], 0)
  w.stock(5, 64, 0, [stack('cobblestone', 40), stack('cobbled_deepslate', 17)])
  const key = CF.townKey({ x: 0, y: 64, z: 0 })
  assert.equal(CC.readTown(process.env.POOL_STATE_DIR, key).obs['5,64,0'], undefined, 'not counted before the visit')
  const r = await run(w.bot)
  assert.equal(r.status, 'success', r.detail); assert.equal(cobbleIn(w.bag), 64, 'positive control: no cobble moved (the reserve)')
  assert.equal(CC.readTown(process.env.POOL_STATE_DIR, key).obs['5,64,0']?.n, 57, 'the open counted the chest: 40 + 17')
})
await t('CAP, a DELAYED observation never overwrites a newer count of the same container', async () => {
  const w = capTown([stack('cobblestone', 64)], 100)
  const key = CF.townKey({ x: 0, y: 64, z: 0 })
  CC.appendJournal(process.env.POOL_STATE_DIR, key, null, { t: 'obs', k: '5,64,0', n: 164, cap: Date.now() + 60_000 })
  const b = w.bot.blockAt({ x: 5, y: 64, z: 0 })
  const win = await w.bot.openContainer(b); await cobbleObserve(w.bot, b.position, win); win.close()
  assert.equal(CC.readTown(process.env.POOL_STATE_DIR, key).obs['5,64,0'].n, 164, 'the newer count stood')
})
await t('CAP, the plan: installCobbleCap makes depositPlan / admission see the cap (town at 300 -> no cobble planned, the rule named)', async () => {
  const w = capTown([stack('cobblestone', 64), stack('cobblestone', 30)], 0)
  w.stock(5, 64, 0, Array.from({ length: 5 }, () => stack('cobblestone', 60)))
  const b = w.bot.blockAt({ x: 5, y: 64, z: 0 })
  const win = await w.bot.openContainer(b); await cobbleObserve(w.bot, b.position, win); win.close()
  assert.equal(cobbleTownViewFor(w.bot).lb, 300)
  installCobbleCap(w.bot)
  try {
    assert.equal(B.depositPlan(w.bag.filter(Boolean)).filter(e => B.isCobble(e.name)).length, 0)
    assert.equal(B.bankableExclusion(w.bag.filter(Boolean), 'cobblestone'), 'town_cobble_cap')
    assert.match(B.depositNoopReason(w.bag.filter(Boolean), 'cobblestone'), /\(town cobble cap\)/)
  } finally { B.setCobbleTownReader(null) }
  assert.deepEqual(B.depositPlan(w.bag.filter(Boolean)).filter(e => B.isCobble(e.name)), [{ name: 'cobblestone', count: 30 }], 'positive control: without the reader, the whole-stack rule alone')
})

// ---- round 3 (both reviews r2): the scan, the view from away, the dead ends, the backoff, the deadline ----------------
const S2 = await import('../src/skills.mjs')
const TK = () => CF.townKey({ x: 0, y: 64, z: 0 })
const countAt = async (w, x, y, z) => { const b = w.bot.blockAt({ x, y, z }); const win = await w.bot.openContainer(b); S2.cobbleObserve(w.bot, b.position, win); win.close() }
const admission = async () => {
  const { AdmissionControl } = await import('../src/admission.mjs')
  const { Lessons } = await import('../src/lessons.mjs')
  return new AdmissionControl(new Lessons(path.join(os.tmpdir(), `mcai-cobble-lessons3-${process.pid}-${Math.random()}.json`)))
}
await t('CAP, the scan: hitting the 256 cap is NOT coverage (a cut scan is not the town); 255 is', () => {
  const w = town([stack('cobblestone', 64)])
  const at = n => Array.from({ length: n }, (_, i) => ({ x: (i % 15) - 7, y: 64, z: Math.floor(i / 15) - 7 }))
  w.bot.findBlocks = () => at(256)
  assert.equal(S2.townCobbleScan(w.bot, Date.now(), { fresh: true }).coverage, false)
  w.bot.findBlocks = () => at(255)
  assert.equal(S2.townCobbleScan(w.bot, Date.now(), { fresh: true }).coverage, true, 'positive control')
})
await t('CAP, the scan: a chunk column under the town not loaded is NOT coverage', () => {
  const w = town([stack('cobblestone', 64)])
  w.bot.world = { getColumnAt: () => null }
  assert.equal(S2.townCobbleScan(w.bot, Date.now(), { fresh: true }).coverage, false)
  w.bot.world = { getColumnAt: () => ({}) }
  assert.equal(S2.townCobbleScan(w.bot, Date.now(), { fresh: true }).coverage, true, 'positive control: all loaded')
})
await t('CAP, the scan: a counted container the scan missed is still a key; a counted cell that is no longer a container is gone', async () => {
  const w = town([stack('cobblestone', 64)])
  w.set(-6, 64, 0, 'barrel')
  await countAt(w, -6, 64, 0); await countAt(w, 5, 64, 0)
  CC.appendJournal(process.env.POOL_STATE_DIR, TK(), null, { t: 'obs', k: '9,64,9', n: 500, cap: Date.now() })   // air there now
  const find = w.bot.findBlocks.bind(w.bot)
  w.bot.findBlocks = o => find(o).filter(p => p.x !== -6)                                                         // the scan misses the barrel
  const sc = S2.townCobbleScan(w.bot, Date.now(), { fresh: true })
  assert.ok(sc.keys.includes('-6,64,0'), JSON.stringify(sc)); assert.ok(sc.gone.includes('9,64,9'), JSON.stringify(sc))
  const v = S2.cobbleTownViewFor(w.bot)
  assert.equal(v.lb, 0, 'the 500 of a container that is gone does not count'); assert.equal(v.complete, true)
})
await t('CAP, the scan: a counted single chest that became half of a double -> the double\'s key, the old key gone (never stuck unknown)', async () => {
  process.env.POOL_STATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-cobble-pool-'))
  const w = fakeWorld({ bag: [stack('cobblestone', 64)] })
  w.set(6, 64, 0, 'chest'); w.stock(6, 64, 0, [stack('cobblestone', 40)])
  await countAt(w, 6, 64, 0)
  assert.equal(S2.cobbleTownViewFor(w.bot, Date.now() + 25_000).lb, 40)
  w.set(5, 64, 0, 'chest', { facing: 'north', type: 'left' }); w.set(6, 64, 0, 'chest', { facing: 'north', type: 'right' })
  const sc = S2.townCobbleScan(w.bot, Date.now(), { fresh: true })
  assert.deepEqual(sc.keys, ['5,64,0']); assert.deepEqual(sc.gone, ['6,64,0'])
  await countAt(w, 5, 64, 0)
  const v = S2.cobbleTownViewFor(w.bot, Date.now() + 25_000)
  assert.equal(v.complete, true, JSON.stringify(v)); assert.deepEqual(v.unknown, [])
})
await t('CAP, the view from AWAY: the journal\'s last covered scan stands in out of town -- and only there', async () => {
  const w = capTown([stack('cobblestone', 64), stack('cobblestone', 30)], 100)
  w.bot.world = { getColumnAt: () => ({}) }
  await countAt(w, 5, 64, 0)                                                                    // writes the count and a covered scan
  w.bot.world = { getColumnAt: () => null }                                                     // the town's chunks unloaded
  const later = Date.now() + 25_000
  assert.equal(S2.cobbleTownViewFor(w.bot, later).complete, false, 'in town, uncovered: not complete (no stand-in)')
  w.bot.entity.position = w.bot.entity.position.offset(80, 0, 0)
  const v = S2.cobbleTownViewFor(w.bot, later + 25_000)
  assert.equal(v.complete, true, JSON.stringify(v)); assert.equal(v.lb, 100)
})
await t('CAP, every claim is released after a normal cobble deposit (nothing left reserved)', async () => {
  const w = capTown([stack('cobblestone', 64), stack('cobblestone', 30), stack('cobblestone', 20)], 100)
  const r = await run(w.bot)
  assert.equal(r.status, 'success', r.detail); assert.ok(cobbleIn(w.bag) < 114, 'positive control: cobble moved')
  const st = CC.readTown(process.env.POOL_STATE_DIR, TK())
  assert.ok(CC.readJournal(process.env.POOL_STATE_DIR, TK()).filter(r => r.t === 'claim').length >= 1, 'positive control: claims were made')
  assert.deepEqual(st.claims, {}, 'every one released')
  assert.equal(CC.townCobble(st, ['5,64,0'], Date.now()).reserved, 0)
})
await t('CAP, OUTSIDE-TOWN DEAD END (Claude r2 P1, probe A): a cobble-only plan walks past the nearer chest outside town to the town chest', async () => {
  const w = capTown([stack('cobblestone', 64), stack('cobblestone', 30)], 10)
  await countAt(w, 5, 64, 0)
  w.set(20, 64, 0, 'chest')                                                                      // outside town, nearer
  w.bot.entity.position = w.bot.entity.position.offset(8, 0, 0)                                 // 14.5: in town
  const ac = await admission()
  installCobbleCap(w.bot)
  try {
    assert.equal(ac.check({ skill: 'deposit', args: {} }, w.bot, null).ok, true)
    const r = await run(w.bot)
    assert.equal(r.status, 'success', r.detail); assert.equal(cobbleIn(w.bag), 64, 'the 30 went into the town chest')
    assert.equal(cobbleIn(w.containers.get(w.key(20, 64, 0)).slots), 0, 'nothing into the chest outside town')
  } finally { B.setCobbleTownReader(null); B.setCobbleReconcileProbe(null) }
})
await t('CAP, admission\'s reconciliation uses the TOWN boundary (Claude r2 P2, probe C): 24 below town is not in town -- refused, the remedy named', async () => {
  const w = capTown([stack('cobblestone', 64), stack('cobblestone', 30)], 10)
  w.set(-6, 64, 0, 'barrel')
  const ac = await admission()
  installCobbleCap(w.bot)
  try {
    assert.equal(ac.check({ skill: 'deposit', args: {} }, w.bot, null).ok, true, 'positive control: in town it is admitted to count')
    w.bot.entity.position = w.bot.entity.position.offset(0, -24, 0)
    const r = ac.check({ skill: 'deposit', args: {} }, w.bot, null)
    assert.equal(r.ok, false, JSON.stringify(r)); assert.match(r.detail, /town cobble not yet counted.*a deposit at town counts/)
  } finally { B.setCobbleTownReader(null); B.setCobbleReconcileProbe(null) }
})
await t('CAP, a container that cannot be counted is BACKED OFF and named (Claude r2 P2, probe B): no second walk, admission refuses with the container', async () => {
  const w = capTown([stack('cobblestone', 64), stack('cobblestone', 30)], 10)
  await countAt(w, 5, 64, 0)
  w.set(-6, 64, 0, 'barrel')
  const open = w.bot.openContainer.bind(w.bot)
  let tries = 0
  w.bot.openContainer = async b => { if (b.position.x === -6) { tries++; throw new Error('windowOpen did not fire') } return open(b) }
  const ac = await admission()
  installCobbleCap(w.bot)
  try {
    assert.equal(ac.check({ skill: 'deposit', args: {} }, w.bot, null).ok, true, 'first: admitted to count')
    const r = await run(w.bot)
    assert.equal(tries, 1, JSON.stringify([r, RECS.filter(x => /cobble/.test(x.skill?.name ?? "")).slice(-3).map(x => x.skill.detail)])); assert.equal(cobbleIn(w.bag), 94, "unknown stock: nothing banked")
    assert.match(r.detail, /-6,64,0 \(unopenable\) could not be counted/)
    const again = ac.check({ skill: 'deposit', args: {} }, w.bot, null)
    assert.equal(again.ok, false, JSON.stringify(again)); assert.match(again.detail, /-6,64,0 \(unopenable\)/)
    await run(w.bot)
    assert.equal(tries, 1, 'a deposit run anyway does not walk to it again inside the backoff')
  } finally { B.setCobbleTownReader(null); B.setCobbleReconcileProbe(null) }
})
await t('CAP, a town PROVEN at the cap walks nowhere to count (Claude r2 P3)', async () => {
  const w = capTown([stack('cobblestone', 64), stack('cobblestone', 30)], 0)
  w.stock(5, 64, 0, Array.from({ length: 5 }, () => stack('cobblestone', 60)))
  await countAt(w, 5, 64, 0)
  w.set(-6, 64, 0, 'barrel')
  const n0 = RECS.length
  const r = await run(w.bot)
  assert.ok(!w.spy.opened.includes(w.key(-6, 64, 0)), 'the uncounted barrel was not visited'); assert.match(r.detail, /town cobble cap/)
  assert.equal(RECS.slice(n0).filter(x => x.skill?.name === '_cobble_reconcile').length, 0)
})
await t('CAP, the reconciliation honours the deadline (Codex r2 P2): no time left -> no walk, no open', async () => {
  const w = capTown([stack('cobblestone', 64), stack('cobblestone', 30)], 10)
  w.set(-6, 64, 0, 'barrel')
  const opened0 = w.spy.opened.length, gotos0 = w.spy.gotos.length
  assert.equal((await S2.reconcileCobble(w.bot, new AbortController().signal, () => 0)).counted, 0)
  assert.equal(w.spy.opened.length, opened0); assert.equal(w.spy.gotos.length, gotos0)
  assert.ok((await S2.reconcileCobble(w.bot, new AbortController().signal, cap => cap)).counted >= 1, 'positive control: with time it counts')
})
await t('CAP, a reconciliation open that answers LATE (Codex r3 P2): its own window is closed when it comes, nothing else is opened in that run', async () => {
  const w = capTown([stack('cobblestone', 64), stack('cobblestone', 30)], 10)
  w.set(-6, 64, 0, 'barrel'); w.set(-6, 64, 3, 'barrel')
  const open = w.bot.openContainer.bind(w.bot)
  let lateWin = null, opens = 0
  w.bot.openContainer = b => { if (b.position.x !== -6) return open(b); opens++; return new Promise(res => setTimeout(async () => { lateWin = await open(b); const c = lateWin.close.bind(lateWin); lateWin.closed = false; lateWin.close = () => { lateWin.closed = true; c() }; res(lateWin) }, 1500)) }
  const ms = cap => (cap === 8_000 ? 1_100 : cap)
  const r = await S2.reconcileCobble(w.bot, new AbortController().signal, ms)
  assert.equal(r.timedOut, true); assert.equal(opens, 1, 'one barrel open in flight, the second barrel never opened')
  await new Promise(res => setTimeout(res, 800))
  assert.ok(lateWin && lateWin.closed, 'the late window was closed by its own open')
})
await t('CAP, a count that cannot be WRITTEN backs its container off too (Codex r3 P2): no second walk', async () => {
  const w = capTown([stack('cobblestone', 64), stack('cobblestone', 30)], 10)
  await countAt(w, 5, 64, 0)
  w.set(-6, 64, 0, 'barrel')
  const jf = path.join(process.env.POOL_STATE_DIR, `${TK()}.cobble.jsonl`)
  const opened0 = () => w.spy.opened.filter(k => k === w.key(-6, 64, 0)).length
  fs.chmodSync(jf, 0o444)
  try {
    const r1 = await S2.reconcileCobble(w.bot, new AbortController().signal, cap => cap)
    assert.equal(r1.counted, 0); assert.equal(opened0(), 1, 'positive control: it was opened')
    await S2.reconcileCobble(w.bot, new AbortController().signal, cap => cap)
    assert.equal(opened0(), 1, 'backed off: not opened again')
  } finally { fs.chmodSync(jf, 0o644) }
})
await t('CAP, the scan record is written at most every 5 min per bot (Claude r3 P3: journal size)', async () => {
  const w = capTown([stack('cobblestone', 64)], 10)
  await countAt(w, 5, 64, 0); await countAt(w, 5, 64, 0); await countAt(w, 5, 64, 0)
  const recs = CC.readJournal(process.env.POOL_STATE_DIR, TK())
  assert.equal(recs.filter(r => r.t === 'cnt').length, 3, 'positive control: three counts')
  assert.equal(recs.filter(r => r.scan).length, 1)
})
await t('CAP, a deposit voids THIS bot\'s claims left by an earlier run (a crash mid-deposit) before it claims again; the container is then recounted', async () => {
  const w = capTown([stack('cobblestone', 64), stack('cobblestone', 30)], 100)
  w.bot.username = 'CobbleBot'
  await countAt(w, 5, 64, 0)
  CC.appendJournal(process.env.POOL_STATE_DIR, TK(), null, { t: 'claim', id: 'old', n: 64, k: '5,64,0', at: Date.now() - 60_000, bot: w.bot.username ?? null, inst: 'dead-9', keys: ['5,64,0'], coverage: true })
  assert.equal(S2.cobbleTownViewFor(w.bot, Date.now() + 25_000).reserved, 64, 'positive control: the old claim is reserved')
  const r = await run(w.bot)
  const st = CC.readTown(process.env.POOL_STATE_DIR, TK())
  assert.equal(st.claims.old, undefined, 'voided, then resolved by the deposit\'s own count')
  assert.equal(r.status, 'success', r.detail); assert.equal(cobbleIn(w.bag), 64, 'and the 30 went in after the recount')
})
await t('CAP r4: a claim of THIS process is never voided, however old (a skill the runner abandoned may still finish its transfer)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-cobble-self-'))
  CC.appendJournal(dir, 'k', null, { t: 'obs', k: 'a', n: 100, cap: Date.now() })
  CC.appendJournal(dir, 'k', null, { t: 'claim', id: 'pred', n: 10, k: 'a', at: Date.now(), bot: 'Ann', inst: 'dead-2', keys: ['a'], coverage: true })
  assert.equal(CC.claimStack(dir, 'k', null, { id: 'mine', n: 64, k: 'a', bot: 'Ann', keys: ['a'], coverage: true, at: Date.now() - 3600_000 }).decision, 'bank')
  assert.equal(CC.voidOwnClaims(dir, 'k', null, { bot: 'Ann' }), 1, 'the predecessor\'s claim is voided (positive control)')
  assert.equal(CC.townCobble(CC.readTown(dir, 'k'), ['a'], Date.now()).reserved, 64, 'this process\'s own claim is still reserved')
  assert.equal(CC.voidOwnClaims(dir, 'k', null, { bot: 'Ann' }), 0)
})
await t('CAP r5: THE FENCE (Codex r5 P1): after the void, a predecessor whose JavaScript outlived its connection cannot publish a stale count, release or claim', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-cobble-fence-'))
  CC.appendJournal(dir, 'k', null, { t: 'obs', k: 'a', n: 150, cap: Date.now() - 5000 })
  CC.appendJournal(dir, 'k', null, { t: 'claim', id: 'P', n: 64, k: 'a', at: Date.now() - 4000, bot: 'Ann', inst: 'dead-5', keys: ['a'], coverage: true })
  assert.equal(CC.voidOwnClaims(dir, 'k', null, { bot: 'Ann' }), 1)
  CC.appendJournal(dir, 'k', null, { t: 'obs', k: 'a', n: 214, cap: Date.now() })                 // the real recount (another bot)
  CC.appendJournal(dir, 'k', null, { t: 'cnt', k: 'a', n: 150, cap: Date.now() + 5, ids: ['P'], bot: 'Ann', inst: 'dead-5' })   // the zombie's stale window
  const st = CC.readTown(dir, 'k')
  assert.equal(st.obs.a.n, 214, 'the stale count is fenced out')
  assert.equal(CC.claimStack(dir, 'k', null, { id: 'Q', n: 64, k: 'a', keys: ['a'], coverage: true }).decision, 'at_cap', '214 + 64 > 256')
  CC.appendJournal(dir, 'k', null, { t: 'cnt', k: 'a', n: 150, cap: Date.now() + 10, ids: [], bot: 'Bob', inst: 'live-b' })
  assert.equal(CC.readTown(dir, 'k').obs.a.n, 150, 'positive control: another bot\'s later count is read')
})
await t('CAP r5: a release from a window that is no longer the bot\'s writes no count and makes the container UNKNOWN until a recount', async () => {
  const w = capTown([stack('cobblestone', 64)], 100)
  await countAt(w, 5, 64, 0)
  const key = TK()
  assert.equal(CC.claimStack(process.env.POOL_STATE_DIR, key, null, { id: 'Z', n: 30, k: '5,64,0', keys: ['5,64,0'], coverage: true }).decision, 'bank')
  const b = w.bot.blockAt({ x: 5, y: 64, z: 0 })
  const win = await w.bot.openContainer(b); win.close()                                           // the window is gone
  S2.cobbleObserve(w.bot, b.position, win, { release: 'Z' })
  const st = CC.readTown(process.env.POOL_STATE_DIR, key)
  assert.equal(st.obs['5,64,0'].n, 100, 'no count from a closed window')
  const v = CC.townCobble(st, ['5,64,0'], Date.now())
  assert.equal(v.reserved, 0, 'released'); assert.deepEqual(v.unknown, ['5,64,0'], 'and unknown until recounted')
})
await t('CAP r5: an ABORTED reconciliation leaves its open pending (Codex r5 P2): the next deposit waits until it settles', async () => {
  const w = capTown([stack('cobblestone', 64), stack('cobblestone', 30)], 10)
  await countAt(w, 5, 64, 0)
  w.set(-6, 64, 0, 'barrel')
  const open = w.bot.openContainer.bind(w.bot)
  let opens = 0
  w.bot.openContainer = b => { if (b.position.x !== -6) return open(b); opens++; return new Promise(res => setTimeout(async () => res(await open(b)), 2000)) }
  const ac = new AbortController()
  setTimeout(() => ac.abort(), 300)                                                              // aborted while the open hangs
  await assert.rejects(S2.reconcileCobble(w.bot, ac.signal, cap => (cap === 8_000 ? 1_100 : cap)))
  const d = await run(w.bot)
  assert.equal(d.status, 'no_effect'); assert.match(d.detail, /has not answered an earlier open/); assert.equal(opens, 1)
  await new Promise(res => setTimeout(res, 1200))
  assert.equal(w.bot.cobbleOpenPending, null)
})
await t('CAP r5: a void that could not be written is RETRIED at the next read (Codex r5 P2), and then the claim is voided', async () => {
  const w = capTown([stack('cobblestone', 64), stack('cobblestone', 30)], 200)
  w.bot.username = 'CobbleBot'
  await countAt(w, 5, 64, 0)
  CC.appendJournal(process.env.POOL_STATE_DIR, TK(), null, { t: 'claim', id: 'pred', n: 40, k: '5,64,0', at: Date.now(), bot: 'CobbleBot', inst: 'dead-7', keys: ['5,64,0'], coverage: true })
  const jf = path.join(process.env.POOL_STATE_DIR, `${TK()}.cobble.jsonl`)
  fs.chmodSync(jf, 0o444)
  try { assert.equal(S2.cobbleVoidStale(w.bot), false, 'the write failed: not done') } finally { fs.chmodSync(jf, 0o644) }
  assert.equal(S2.cobbleVoidStale(w.bot), true)
  assert.equal(CC.readTown(process.env.POOL_STATE_DIR, TK()).claims.pred.state, 'void')
})
await t('CAP r4: a recount that resolves a void IS the count, even against an older count with a later clock (Codex r4 P1)', () => {
  const rec = (t, o) => ({ t, ...o })
  const st = CC.foldJournal([
    rec('obs', { k: 'a', n: 150, cap: 1000 }),
    rec('claim', { id: 'A', n: 64, k: 'a', at: 900, bot: 'Ann', inst: 'dead', keys: ['a'], coverage: true }),
    rec('void', { ids: ['A'], at: 902 }),
    rec('cnt', { k: 'a', n: 214, cap: 903, ids: [] }),
    rec('claim', { id: 'B', n: 64, k: 'a', at: 904, keys: ['a'], coverage: true })], { upto: 'B' })
  assert.equal(st.state.obs.a.n, 214, 'the recount stands'); assert.equal(st.decision, 'at_cap', '214 + 64 > 256: never 150 + 64')
  const without = CC.foldJournal([rec('obs', { k: 'a', n: 150, cap: 1000 }), rec('cnt', { k: 'a', n: 214, cap: 903, ids: [] })])
  assert.equal(without.state.obs.a.n, 150, 'positive control: without a void the later clock wins as before')
})
await t('CAP r4: admission composition (Codex r4 P2): at 200 + a dead predecessor\'s 40 + a 30 surplus, the first read voids it, admission admits the deposit to recount, and the 30 goes', async () => {
  const w = capTown([stack('cobblestone', 64), stack('cobblestone', 30)], 200)
  w.bot.username = 'CobbleBot'
  await countAt(w, 5, 64, 0)
  CC.appendJournal(process.env.POOL_STATE_DIR, TK(), null, { t: 'claim', id: 'pred', n: 40, k: '5,64,0', at: Date.now(), bot: 'CobbleBot', inst: 'dead-3', keys: ['5,64,0'], coverage: true })
  const ac = await admission()
  installCobbleCap(w.bot)
  try {
    const r = ac.check({ skill: 'deposit', args: {} }, w.bot, null)
    assert.equal(r.ok, true, JSON.stringify(r))
    const d = await run(w.bot)
    assert.equal(d.status, 'success', d.detail); assert.equal(cobbleIn(w.bag), 64, '200 recounted + 30 = 230')
  } finally { B.setCobbleTownReader(null); B.setCobbleReconcileProbe(null) }
  const w2 = capTown([stack('cobblestone', 64), stack('cobblestone', 30)], 200)
  w2.bot.username = 'CobbleBot'
  await countAt(w2, 5, 64, 0)
  CC.appendJournal(process.env.POOL_STATE_DIR, TK(), null, { t: 'claim', id: 'pred', n: 40, k: '5,64,0', at: Date.now(), bot: 'CobbleBot', inst: 'dead-3', keys: ['5,64,0'], coverage: true })
  w2.bot.cobbleVoided = true                                                                   // positive control: no void
  installCobbleCap(w2.bot)
  try {
    assert.equal(ac.check({ skill: 'deposit', args: {} }, w2.bot, null).ok, false, 'without the void the plan is at the cap')
  } finally { B.setCobbleTownReader(null); B.setCobbleReconcileProbe(null) }
})
await t('CAP r4: a counting open still in flight blocks the NEXT deposit too (Codex r4 P2), until it settles', async () => {
  const w = capTown([stack('cobblestone', 64), stack('cobblestone', 30)], 10)
  await countAt(w, 5, 64, 0)
  w.set(-6, 64, 0, 'barrel')
  const open = w.bot.openContainer.bind(w.bot)
  let opens = 0
  w.bot.openContainer = b => { if (b.position.x !== -6) return open(b); opens++; return new Promise(res => setTimeout(async () => res(await open(b)), 1500)) }
  const r = await S2.reconcileCobble(w.bot, new AbortController().signal, cap => (cap === 8_000 ? 1_100 : cap))
  assert.equal(r.timedOut, true)
  const d = await run(w.bot)
  assert.equal(d.status, 'no_effect'); assert.match(d.detail, /has not answered an earlier open/); assert.equal(opens, 1, 'no second open')
  await new Promise(res => setTimeout(res, 800))
  assert.equal(w.bot.cobbleOpenPending, null, 'settled: the next deposit may open again')
})
await t('CAP r4: a claimant never folds from a checkpoint that already contains its own claim (maxOffset)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-cobble-maxoff-'))
  CC.appendJournal(dir, 'k', null, { t: 'obs', k: 'a', n: 10, cap: Date.now() })
  const before = fs.statSync(path.join(dir, 'k.cobble.jsonl')).size
  CC.appendJournal(dir, 'k', null, { t: 'claim', id: 'c', n: 5, k: 'a', at: Date.now(), keys: ['a'], coverage: true })
  CC.readTown(dir, 'k', null, { ckptEvery: 1 })                                                  // a checkpoint past the claim
  const j = CC.loadJournal(dir, 'k', null, { maxOffset: before })
  assert.ok(j.records.some(r => r.id === 'c'), 'the claim is in what the claimant folds')
  assert.equal(CC.foldJournal(j.records, { upto: 'c', state: j.base, seq: j.seq }).decision, 'bank')
  assert.ok(!CC.loadJournal(dir, 'k', null).records.some(r => r.id === 'c'), 'positive control: without maxOffset the checkpoint hides it')
})
await t('CAP r6: a RECONNECT inside one process is a new connection (Codex r6 P1): the old connection\'s claim is voided at the new login, and its late stale count is fenced', async () => {
  const w = capTown([stack('cobblestone', 64), stack('cobblestone', 30)], 150)
  w.bot.username = 'CobbleBot'
  installCobbleCap(w.bot)                                                      // connection 1
  try {
    await countAt(w, 5, 64, 0)
    const old = w.bot.cobbleInst
    assert.equal(CC.claimStack(process.env.POOL_STATE_DIR, TK(), null, { id: 'c1', n: 64, k: '5,64,0', bot: 'CobbleBot', keys: ['5,64,0'], coverage: true, inst: old }).decision, 'bank')
    const w2 = fakeWorld({ bag: [stack('cobblestone', 64)] }); w2.set(5, 64, 0, 'chest'); w2.bot.username = 'CobbleBot'
    installCobbleCap(w2.bot)                                                   // connection 2, same process
    assert.notEqual(w2.bot.cobbleInst, old)
    B.cobbleTownView()                                                         // the first read after login voids + fences
    assert.equal(CC.readTown(process.env.POOL_STATE_DIR, TK()).claims.c1.state, 'void')
    CC.recordCount(process.env.POOL_STATE_DIR, TK(), null, { obs: { k: '5,64,0', n: 99, cap: Date.now() + 5 }, release: ['c1'], bot: 'CobbleBot', inst: old })
    const st = CC.readTown(process.env.POOL_STATE_DIR, TK())
    assert.equal(st.claims.c1.state, 'void', 'the old connection\'s release is fenced out'); assert.equal(st.obs['5,64,0'].n, 150, 'the stale 99 is not the count')
    assert.deepEqual(CC.townCobble(st, ['5,64,0'], Date.now()).unknown, ['5,64,0'], 'and its stale count did not resolve the void')
  } finally { B.setCobbleTownReader(null); B.setCobbleReconcileProbe(null) }
})
await t('CAP r6: a connection that has ENDED writes no count from a window still marked current (Codex r6 P1): release + unknown', async () => {
  const w = capTown([stack('cobblestone', 64)], 100)
  await countAt(w, 5, 64, 0)
  assert.equal(CC.claimStack(process.env.POOL_STATE_DIR, TK(), null, { id: 'E', n: 30, k: '5,64,0', keys: ['5,64,0'], coverage: true }).decision, 'bank')
  const b = w.bot.blockAt({ x: 5, y: 64, z: 0 })
  const win = await w.bot.openContainer(b)                                     // still bot.currentWindow
  w.bot.cobbleEnded = true                                                     // the 'end' event's flag (installCobbleCap)
  S2.cobbleObserve(w.bot, b.position, win, { release: 'E' })
  win.close()
  const st = CC.readTown(process.env.POOL_STATE_DIR, TK())
  assert.equal(st.obs['5,64,0'].n, 100, 'no count'); assert.deepEqual(CC.townCobble(st, ['5,64,0'], Date.now()).unknown, ['5,64,0'])
})
await t('CAP r6: a failed void through the INSTALLED reader is retried by the next read (Codex r6 P4)', async () => {
  const w = capTown([stack('cobblestone', 64), stack('cobblestone', 30)], 200)
  w.bot.username = 'CobbleBot'
  await countAt(w, 5, 64, 0)
  CC.appendJournal(process.env.POOL_STATE_DIR, TK(), null, { t: 'claim', id: 'pred', n: 40, k: '5,64,0', at: Date.now(), bot: 'CobbleBot', inst: 'dead-8', keys: ['5,64,0'], coverage: true })
  const jf = path.join(process.env.POOL_STATE_DIR, `${TK()}.cobble.jsonl`)
  installCobbleCap(w.bot)
  try {
    fs.chmodSync(jf, 0o444)
    try { B.cobbleTownView() } finally { fs.chmodSync(jf, 0o644) }
    assert.notEqual(w.bot.cobbleVoided, true, 'not latched')
    assert.equal(CC.readTown(process.env.POOL_STATE_DIR, TK()).claims.pred.state, 'live')
    await new Promise(res => setTimeout(res, 5_100))                           // the view's 5 s cache
    B.cobbleTownView()
    assert.equal(w.bot.cobbleVoided, true); assert.equal(CC.readTown(process.env.POOL_STATE_DIR, TK()).claims.pred.state, 'void')
  } finally { B.setCobbleTownReader(null); B.setCobbleReconcileProbe(null) }
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
