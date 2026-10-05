// THE TOWN CHEST IS FULL (chestfull.mjs + deposit's recovery). Behaviour only: the pure decisions by truth table, and
// the deposit driven through the real skill code against a fake world (fakeworld.mjs) whose chest window throws
// `destination full` the way mineflayer 4.37.1 does -- with the stack still on the cursor.
//
// Measured (24 h, 1,970 deposits): 90 full-chest blocks, 75 of them by a bot CARRYING a chest; the recovery crafted
// unconditionally and placed only after a successful craft.
import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

process.env.LOG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-chestfull-logs-'))
process.env.BOT_NAME = 'ChestBot'
process.env.OLLAMA_MODEL ??= 'qwen2.5:7b-instruct'
process.env.HOME_X = '0'; process.env.HOME_Y = '64'; process.env.HOME_Z = '0'
// THE PRODUCTION WATCHDOG, set here on purpose: the recovery's clock IS config.skills.defaultTimeoutMs, and the test
// runner sets it to 300 ms for every file. These tests are about that clock, so they state it.
process.env.SKILL_TIMEOUT_MS = '180000'
const freshPool = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-chestfull-pool-')); process.env.POOL_STATE_DIR = d; return d }
freshPool()

const CF = await import('../src/chestfull.mjs')
const { fullChestNext, chestSiteRefusal, chestBudget, claimNewChest, readClaims, reconcileClaims, writeClaimState, townKey,
        containerStatus, recordOutcome, updateTownMemory, returnCursor, bankClosed, closeBank, setTownRoomReader,
        chestPartnerOffset, isChestPartner, pickChestSite, timeLeft, NEW_CHEST_INTERVAL_MS, NEW_CHESTS_PER_DAY, MAX_RECOVERY_CHESTS,
        DAY_MS, UNKNOWN_BACKOFF_MS, FULL_TTL_MS, REOPEN_THROTTLE_MS, RECONCILE_AFTER_MS,
        inTown, depositTargetOk, walkFailure, backsOffTarget, travelTimeoutAction, closesBank, TOWN_DY, TOWN_SCAN_RADIUS } = CF
const { SKILLS, adviseDeposit, slotRemedy, withTimeout } = await import('../src/skills.mjs')
const { SUSTAINING } = await import('../src/milestones.mjs')
const { depositSituation } = await import('../src/prompt.mjs')
const { AdmissionControl } = await import('../src/admission.mjs')
const { roomAdvice } = await import('../src/craftroom.mjs')
const { tapRecords } = await import('../src/logger.mjs')
const { fakeWorld, stack, total } = await import('./fakeworld.mjs')

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 3).join('\n        ')}`) }
}
// Every record as the logger writes it (its file stream is asynchronous; the tap sees each record once written).
const RECS = []
tapRecords(r => RECS.push(r))
const rows = kind => RECS.filter(r => r.skill?.name === `_${kind}`)
const lastRow = () => rows('deposit_new_chest').at(-1)?.skill?.detail ?? ''
const run = (bot, args = {}, runner = undefined) => SKILLS.deposit.run({ bot, runner }, args, new AbortController().signal)
const HOME = { x: 0, y: 64, z: 0 }
const KEY = townKey(HOME)
const town = (bag, at) => { freshPool(); const w = fakeWorld({ bag, at }); w.set(5, 64, 0, 'chest'); w.fill(5, 64, 0); return w }
const ledger = dir => readClaims(dir, KEY)
/** The town's memory entry for a container, or undefined (no file, or no entry). */
const memEntry = k => { try { return JSON.parse(fs.readFileSync(path.join(process.env.POOL_STATE_DIR, `${KEY}.containers.json`), 'utf8')).entries[k] } catch { return undefined } }
/** A claim file written directly (a claim another bot made earlier). */
const pastClaim = (dir, n, at, site = { x: 20 + n, y: 64, z: 20 }, state = null) => {
  fs.writeFileSync(path.join(dir, `${KEY}.c${n}.json`), JSON.stringify({ ...site, world: null, at: new Date(at).toISOString() }))
  if (state) writeClaimState(dir, KEY, n, state, at)
}

// ---------------------------------------------------------------- pure: what next ---
await t('fullChestNext: unknown defers; the budget comes before ANY placement; a carried chest is placed, else crafted', () => {
  const ok = { ok: true }, no = { ok: false }
  const T = [
    [false, 0, ok, true, 'far'], [false, 3, ok, false, 'far'],
    [true, 1, ok, true, 'defer'], [true, 2, no, true, 'defer'],
    [true, 0, no, true, 'refuse_cap'], [true, 0, no, false, 'refuse_cap'],
    [true, 0, ok, true, 'place_carried'], [true, 0, ok, false, 'craft'],
  ]
  for (const [nearHome, unknown, budget, carried, want] of T) {
    assert.equal(fullChestNext({ nearHome, unknown, budget, carried }), want, JSON.stringify({ nearHome, unknown, budget, carried }))
  }
})

// ---------------------------------------------------------------- the budget on NEW chests ---
await t('chestBudget: 10 min apart, 4 per rolling 24 h, 12 standing; not_placed/gone stop standing; another world ignored; malformed fails closed', () => {
  const now = 100 * DAY_MS
  const c = (at, state = 'placed', world = null) => ({ n: 1, at, state, world })
  assert.equal(chestBudget({ claims: [], now }).ok, true, 'a town with no new chests may make one -- whatever already stands')
  assert.equal(chestBudget({ claims: [c(now - 60_000)], now }).ok, false, 'one a minute ago')
  assert.equal(chestBudget({ claims: [c(now - NEW_CHEST_INTERVAL_MS)], now }).ok, true, 'the interval has passed')
  const four = [1, 2, 3, 4].map(h => c(now - h * 3600_000))
  const b4 = chestBudget({ claims: four, now })
  assert.equal(b4.ok, false); assert.match(b4.why, /used its new-chest budget \(4 in 24 h\)/)
  assert.equal(b4.until, now - 4 * 3600_000 + DAY_MS, 'the next comes when the oldest of the four leaves the window')
  assert.equal(chestBudget({ claims: [1, 2, 3, 4].map(h => c(now - DAY_MS - h * 3600_000)), now }).ok, true, 'four, but more than a day ago')
  const twelve = Array.from({ length: MAX_RECOVERY_CHESTS }, (_, i) => c(now - DAY_MS - i * 3600_000))
  assert.match(String(chestBudget({ claims: twelve, now }).why), /12 chests made for overflow standing/)
  assert.equal(chestBudget({ claims: twelve.map(x => ({ ...x, state: 'gone' })), now }).ok, true, 'gone chests do not stand')
  assert.equal(chestBudget({ claims: twelve.map(x => ({ ...x, state: 'not_placed' })), now }).ok, true)
  assert.equal(chestBudget({ claims: twelve.map(x => ({ ...x, state: 'unresolved' })), now }).ok, false, 'UNRESOLVED counts until reconciled')
  assert.equal(chestBudget({ claims: [c(now - 60_000, 'placed', 'w1')], now, world: 'w2' }).ok, true, 'a claim from another world')
  assert.equal(chestBudget({ claims: [{ n: 1, at: now, state: 'unresolved', malformed: true }], now }).ok, false, 'malformed: counted, as made now')
  assert.equal(NEW_CHESTS_PER_DAY, 4)
})

await t('claimNewChest: write-once; the ledger keeps every claim (no pruning); unwritable fails closed', () => {
  const dir = freshPool()
  for (let n = 1; n <= 5; n++) pastClaim(dir, n, Date.now() - 2 * DAY_MS - n * 1000, undefined, 'gone')
  const a = claimNewChest({ dir, key: KEY, site: { x: 3, y: 64, z: 3 } })
  assert.equal(a.ok, true, a.why); assert.equal(a.n, 6)
  assert.equal(ledger(dir).length, 6, 'all six claims are still there (composter generations keep three)')
  assert.equal(claimNewChest({ dir, key: KEY, site: { x: 3, y: 64, z: 3 } }).ok, false, 'one per interval')
  const blocked = path.join(dir, 'a-file'); fs.writeFileSync(blocked, 'x')
  const c = claimNewChest({ dir: path.join(blocked, 'sub'), key: KEY, site: { x: 3, y: 64, z: 3 } })
  assert.equal(c.ok, false); assert.match(c.why, /could not be written/)
})

await t('reconcileClaims: a chest at the cell is placed; a placed one that is gone is gone; an old unresolved miss is not_placed; unloaded is left', () => {
  const dir = freshPool(), now = Date.now()
  pastClaim(dir, 1, now - 5 * 60_000, { x: 1, y: 64, z: 1 })                  // unresolved, chest there
  pastClaim(dir, 2, now - 5 * 60_000, { x: 2, y: 64, z: 2 }, 'placed')        // placed, gone now
  pastClaim(dir, 3, now - 5 * 60_000, { x: 3, y: 64, z: 3 })                  // unresolved, nothing there, old
  pastClaim(dir, 4, now - 30_000, { x: 4, y: 64, z: 4 })                      // unresolved, nothing there, recent
  pastClaim(dir, 5, now - 5 * 60_000, { x: 5, y: 64, z: 5 })                  // unloaded
  const read = (x) => (x === 1 ? 'chest' : x === 5 ? null : 'air')
  const claims = ledger(dir)
  reconcileClaims({ dir, key: KEY, claims, read, now })
  const st = Object.fromEntries(ledger(dir).map(c => [c.n, c.state]))
  assert.deepEqual(st, { 1: 'placed', 2: 'gone', 3: 'not_placed', 4: 'unresolved', 5: 'unresolved' })
  assert.ok(RECONCILE_AFTER_MS > 30_000)
})

// ---------------------------------------------------------------- the town's container memory ---
await t('containerStatus: full and unavailable are known for a while; one unknown is a backoff; two >= 10 min apart are unusable', () => {
  const now = 10 * DAY_MS
  assert.equal(containerStatus(undefined, now), 'visit')
  assert.equal(containerStatus({ o: 'full', at: now - 60_000 }, now), 'full')
  assert.equal(containerStatus({ o: 'full', at: now - FULL_TTL_MS }, now), 'visit')
  assert.equal(containerStatus({ o: 'unavailable', at: now - 60_000 }, now), 'unavailable')
  const one = recordOutcome(undefined, 'unknown', now - 60_000)
  assert.equal(containerStatus(one, now), 'backoff')
  assert.equal(containerStatus(one, now + UNKNOWN_BACKOFF_MS), 'visit', 'the backoff ends: visit it again')
  const two = recordOutcome(recordOutcome(undefined, 'unknown', now - UNKNOWN_BACKOFF_MS - 1), 'unknown', now)
  assert.equal(containerStatus(two, now), 'unusable')
  const close = recordOutcome(recordOutcome(undefined, 'unknown', now - 60_000), 'unknown', now)
  assert.equal(containerStatus(close, now), 'backoff', 'two strikes a minute apart are still only a backoff')
  assert.deepEqual(recordOutcome(two, 'full', now).strikes, [], 'a container that opened clears its strikes')
})

// ---------------------------------------------------------------- pure: where ---
const flat = (extra = {}) => (x, y, z) => {
  const k = `${x},${y},${z}`
  if (k in extra) return extra[k]
  return y <= 63 ? { name: 'grass_block', boundingBox: 'block' } : { name: 'air', boundingBox: 'empty' }
}
const C = { name: 'chest', boundingBox: 'block' }, STONE = { name: 'stone', boundingBox: 'block' }

await t('chestSiteRefusal: truth table', () => {
  const read = flat({ '5,64,0': C })
  const cases = [
    [{ x: 5, y: 64, z: 2 }, {}, null, 'open ground two from the chest'],
    [{ x: 6, y: 64, z: 0 }, {}, /beside it/, 'beside a chest: it would merge into a double chest'],
    [{ x: 1, y: 64, z: 1 }, {}, /home point/, 'on the home point'],
    [{ x: 30, y: 64, z: 0 }, {}, /from home/, 'outside STORAGE_NEAR'],
    [{ x: 8, y: 64, z: 3 }, { composterSites: [{ x: 9, y: 64, z: 4 }] }, /composter site/, 'within 3 of the composter site'],
    [{ x: 8, y: 64, z: 3 }, { bodies: [{ x: 8.5, y: 64, z: 3.5 }] }, /standing in it/, 'a body in the cell'],
  ]
  for (const [site, opts, want, why] of cases) {
    const r = chestSiteRefusal(read, site, { home: HOME, ...opts })
    if (want === null) assert.equal(r, null, `${why}: ${r}`)
    else assert.match(String(r), want, `${why}: ${r}`)
  }
  assert.match(String(chestSiteRefusal(flat({ '5,63,0': C }), { x: 5, y: 64, z: 0 }, { home: HOME })), /floor is chest/, 'never on a lid')
  assert.match(String(chestSiteRefusal(flat({ '5,65,2': STONE }), { x: 5, y: 64, z: 2 }, { home: HOME })), /lid blocked/)
  assert.match(String(chestSiteRefusal(flat({ '6,64,4': { name: 'composter', boundingBox: 'block' } }), { x: 5, y: 64, z: 2 }, { home: HOME })), /composter within 3/)
  assert.equal(chestSiteRefusal((x, y, z) => (x === 5 && z === 3 ? null : flat()(x, y, z)), { x: 5, y: 64, z: 2 }, { home: HOME }), 'unknown')
})

await t('chestSiteRefusal: never the ONLY standing cell of a container; never ANY standing cell of a crafting table (diagonal is fine)', () => {
  const read = flat({ '5,64,0': { name: 'barrel', boundingBox: 'block' }, '6,64,0': STONE, '4,64,0': STONE, '5,64,-1': STONE })
  assert.match(String(chestSiteRefusal(read, { x: 5, y: 64, z: 1 }, { home: HOME })), /only standing cell of the barrel/)
  const read2 = flat({ '5,64,0': { name: 'barrel', boundingBox: 'block' }, '6,64,0': STONE, '5,64,-1': STONE })
  assert.doesNotMatch(String(chestSiteRefusal(read2, { x: 5, y: 64, z: 1 }, { home: HOME })), /only standing cell/, 'control: a second side open')
  const table = flat({ '8,64,5': { name: 'crafting_table', boundingBox: 'block' } })
  assert.match(String(chestSiteRefusal(table, { x: 8, y: 64, z: 6 }, { home: HOME })), /standing cell of the crafting_table/)
  assert.equal(chestSiteRefusal(table, { x: 9, y: 64, z: 6 }, { home: HOME }), null, 'diagonal to the table: its access is untouched')
})

await t('chestSiteRefusal: the composter builder\'s crafting-table cell is reserved', async () => {
  const { tableCellFor, standableBeside } = await import('../src/composter.mjs')
  const site = { x: 10, y: 64, z: 10 }, read = flat()
  const cell = tableCellFor({ site, stand: standableBeside(read, site), read })
  assert.ok(cell && Math.hypot(cell.x - site.x, cell.z - site.z) >= 2)
  const r = chestSiteRefusal(read, cell, { home: HOME, composterSites: [site] })
  assert.ok(r, `the reserved table cell must be refused (it is ${Math.hypot(cell.x - site.x, cell.z - site.z).toFixed(2)} from the site)`)
})

await t('chestSiteRefusal reuses the composter checks but NOT its container clearance', async () => {
  const read = flat({ '5,64,0': C, '3,64,0': C })
  assert.equal(chestSiteRefusal(read, { x: 4, y: 64, z: 2 }, { home: HOME }), null)
  const { siteRefusal } = await import('../src/composter.mjs')
  assert.match(String(siteRefusal(read, { x: 4, y: 64, z: 2 }, HOME)), /chest within 3/, 'control: the composter rule does refuse it')
})

await t('chestPartnerOffset / isChestPartner: vanilla getConnectedDirection (LEFT clockwise of facing)', () => {
  assert.deepEqual(chestPartnerOffset({ facing: 'north', type: 'left' }), { x: 1, z: 0 })
  assert.deepEqual(chestPartnerOffset({ facing: 'north', type: 'right' }), { x: -1, z: 0 })
  assert.equal(chestPartnerOffset({ facing: 'north', type: 'single' }), null)
  const L = { name: 'chest', props: { facing: 'north', type: 'left' } }, R = { name: 'chest', props: { facing: 'north', type: 'right' } }
  assert.equal(isChestPartner(L, R), true)
  assert.equal(isChestPartner(L, { ...R, props: { facing: 'south', type: 'right' } }), false)
})

await t('pickChestSite: rings around the full chest; the first acceptable cell, with where to stand', () => {
  const r = pickChestSite({ read: flat({ '5,64,0': C }), anchor: { x: 5, y: 64, z: 0 }, home: HOME })
  assert.ok(r.site && r.stand, r.why)
  assert.equal(pickChestSite({ read: () => STONE, anchor: { x: 5, y: 64, z: 0 }, home: HOME }).site, null)
})

await t('timeLeft: the watchdog\'s clock', () => {
  assert.equal(timeLeft({ startedAt: 0, timeoutMs: 180_000, now: 150_000 }), 30_000)
  assert.equal(timeLeft({ startedAt: 0, timeoutMs: 180_000, now: 200_000 }), 0)
})

// ---------------------------------------------------------------- returnCursor ---
const cursorWindow = ({ effective = true, partial = null } = {}) => {
  const bag = []
  const w = { inventoryStart: 27, inventoryEnd: 63, selectedItem: { name: 'cobblestone', type: 8, count: 40 },
              findItemRange: () => partial, firstEmptySlotRange: () => 27 + bag.length }
  const bot = {
    clicks: [],
    async clickWindow (slot) {
      bot.clicks.push(slot)
      if (!effective) return
      if (partial && slot === partial.slot) {
        const mv = Math.min(64 - partial.count, w.selectedItem.count); partial.count += mv; w.selectedItem.count -= mv
        if (!w.selectedItem.count) w.selectedItem = null
      } else { bag.push(w.selectedItem); w.selectedItem = null }
    },
  }
  return { w, bot, bag }
}
await t('returnCursor: VERIFIED -- returned only when the cursor reads empty; a compatible partial stack is filled first', async () => {
  const a = cursorWindow()
  assert.deepEqual(await returnCursor(a.bot, a.w), { returned: true, slot: 27 })
  const b = cursorWindow({ effective: false })
  const rb = await returnCursor(b.bot, b.w)
  assert.equal(rb.returned, false, 'a click that resolved and changed nothing is NOT a return')
  assert.match(rb.reason, /still holds 40x cobblestone/)
  const c = cursorWindow({ partial: { slot: 40, count: 50, stackSize: 64 } })
  const rc = await returnCursor(c.bot, c.w)
  assert.equal(rc.returned, true, JSON.stringify(rc))
  assert.deepEqual(c.bot.clicks, [40, 27], 'the partial stack first (14 fit), then an empty slot for the other 26')
})

await t('a stack that cannot be put back is a TRANSFER FAILURE, not a full chest: nothing else is tried, nothing placed', async () => {
  const w = town([stack('cobblestone', 64), stack('chest', 1)])
  w.bot.clickWindow = async () => {}   // resolves, changes nothing
  const r = await run(w.bot)
  assert.equal(r.failClass, 'transfer_unsettled', r.detail)
  assert.equal(w.spy.placed.length, 0)
  assert.equal(bankClosed(w.bot), '', 'no bank closure: this is not capacity')
})

// ---------------------------------------------------------------- THE CHAIN ---
await t('THE CHAIN: room advice names deposit -> admitted -> full chest throws -> cursor returned -> no other container has room -> the CARRIED chest is placed -> the retry banks; craft never called, items conserved', async () => {
  const w = town([stack('cobblestone', 64), stack('oak_log', 30), stack('chest', 1), stack('apple', 5)])
  const items = w.bot.inventory.items()
  const item = adviseDeposit(w.bot, items, [{ name: 'stick' }])
  const advice = roomAdvice({ items, consumes: [{ name: 'stick' }], depositItem: item })
  assert.equal(advice.kind, 'deposit', advice.text)
  const adm = new AdmissionControl().check({ skill: 'deposit', args: { item } }, w.bot)
  assert.equal(adm.ok, true, JSON.stringify(adm))
  const before = total(w.bag)
  const r = await run(w.bot, { item })
  assert.equal(r.status, 'success', r.detail)
  assert.equal(w.spy.recipesFor + w.spy.craft, 0, 'craft was never called: the carried chest was placed')
  assert.equal(w.spy.placed.length, 1)
  assert.equal(w.dropped.length, 0, 'nothing left on the cursor at the full chest')
  assert.equal(w.bag.find(i => i.name === 'chest')?.count ?? 0, 0, 'the carried chest is the one placed')
  const banked = w.containers.get(w.spy.placed[0]).slots.filter(Boolean).reduce((n, s) => n + s.count, 0)
  assert.ok(banked > 0, 'the retry banked into the NEW chest')
  assert.equal(total(w.bag), before - banked - 1, 'conservation: the bag fell by what was banked plus the chest placed')
  const d = lastRow()
  assert.match(d, /^decision=place_carried /); assert.match(d, /source=carried/); assert.match(d, /claim=1/)
  assert.match(d, new RegExp(`bag=${before}->${before - banked - 1}`))
  assert.equal(ledger(process.env.POOL_STATE_DIR)[0].state, 'placed')
  assert.ok(rows('deposit_cursor_rescue').some(x => x.skill.status === 'success'))
})

await t('A 16-CONTAINER TOWN GETS ONE BOUNDED EXPANSION: what stands does not count; the second, inside 10 min, is refused plainly', async () => {
  const w = town([stack('cobblestone', 64), stack('oak_log', 64), stack('chest', 2)])
  for (let i = 0; i < 15; i++) { const x = -9 + (i % 5) * 3, z = i < 5 ? 8 : i < 10 ? -8 : -12; w.set(x, 64, z, 'chest'); w.fill(x, 64, z) }
  const r1 = await run(w.bot)
  assert.equal(r1.status, 'success', r1.detail)
  assert.equal(w.spy.placed.length, 1, 'one new chest in a town of 16')
  assert.match(lastRow(), /containers=16 /)
  // The new chest is filled by someone else; the bot comes back with more.
  w.fill(...w.spy.placed[0].split(',').map(Number))
  w.bag.push(stack('cobblestone', 64))
  w.bot.bankClosed = null
  const r2 = await run(w.bot)
  assert.equal(r2.failClass, 'storage_full')
  assert.match(r2.detail, /^keep working; the town is at its chest limit -- the chests are full and the town made a new chest/)
  assert.equal(w.spy.placed.length, 1, 'still one: 10 min between new chests')
  assert.equal(w.bag.find(i => i.name === 'chest').count, 1, 'the second chest stays in the bag')
})

await t('the day\'s budget: four new chests in 24 h and no fifth, said plainly', async () => {
  const w = town([stack('cobblestone', 64), stack('chest', 1)])
  for (let n = 1; n <= 4; n++) pastClaim(process.env.POOL_STATE_DIR, n, Date.now() - n * 3600_000)
  const r = await run(w.bot)
  assert.match(r.detail, /used its new-chest budget \(4 in 24 h\)/)
  assert.equal(w.spy.placed.length, 0)
})

await t('another container in town WITH ROOM is used before anything is placed; a container found full is not re-opened for 30 min', async () => {
  const w = town([stack('cobblestone', 64), stack('chest', 1)])
  w.set(-5, 64, 0, 'barrel'); w.set(-5, 64, 5, 'chest'); w.fill(-5, 64, 5)
  updateTownMemory(process.env.POOL_STATE_DIR, KEY, null, e => { e['-5,64,5'] = recordOutcome(undefined, 'full', Date.now() - 60_000) })
  const r = await run(w.bot)
  assert.equal(r.status, 'success', r.detail)
  assert.equal(w.spy.placed.length, 0)
  assert.ok(!w.spy.opened.includes('-5,64,5'), 'the chest the town found full a minute ago was not opened')
})

await t('UNKNOWN: an open failure defers ONCE (nothing built, the BANK STAYS OPEN, the barrel is backed off); the same failure 10+ min later makes it unusable and the town expands', async () => {
  const w = town([stack('cobblestone', 64), stack('chest', 1)])
  w.set(-5, 64, 0, 'barrel')
  const open = w.bot.openContainer
  w.bot.openContainer = async b => { if (b.position.x === -5) throw new Error('windowOpen did not fire'); return open(b) }
  const r = await run(w.bot)
  assert.equal(r.failClass, 'storage_full'); assert.match(r.detail, /^deposit again later -- 1 container/)
  assert.equal(w.spy.placed.length, 0)
  // chestfull-02: a defer closes nothing -- the failed target is backed off in the town's memory instead.
  assert.equal(bankClosed(w.bot), '', 'a defer does not close the bank')
  assert.equal(new AdmissionControl().check({ skill: 'deposit', args: {} }, w.bot).reason !== 'bank_closed', true)
  assert.equal(memEntry('-5,64,0')?.o, 'unknown', 'the barrel carries the strike: its backoff')
  assert.match(lastRow(), /^decision=defer .*unknown=1/)
  const opens = w.spy.opened.filter(k => k === '-5,64,0').length
  await run(w.bot)
  assert.equal(w.spy.opened.filter(k => k === '-5,64,0').length, opens, 'inside its backoff the barrel is not tried again')
  assert.equal(bankClosed(w.bot), '')
  // Ten minutes later (its strike moved back in the town's memory), the barrel fails again.
  updateTownMemory(process.env.POOL_STATE_DIR, KEY, null, e => { e['-5,64,0'] = recordOutcome(undefined, 'unknown', Date.now() - UNKNOWN_BACKOFF_MS - 1000) })
  w.bot.bankClosed = null
  const r2 = await run(w.bot)
  assert.equal(r2.status, 'success', r2.detail)
  assert.equal(w.spy.placed.length, 1, 'two unknowns >= 10 min apart: unusable, no longer waited for')
  assert.match(lastRow(), /-5,64,0:unusable/)
})

await t('a VERIFIED BLOCKED LID is unavailable, not unknown: the sweep goes on and the town may expand -- also when it is the FIRST chest', async () => {
  // first chest: stone on its lid, water beside the lid (unsafe to break)
  freshPool()
  const w = fakeWorld({ bag: [stack('cobblestone', 64), stack('chest', 1)] })
  w.set(5, 64, 0, 'chest'); w.set(5, 65, 0, 'stone'); w.set(6, 65, 0, 'water')
  w.set(-5, 64, 0, 'chest'); w.fill(-5, 64, 0)
  const r = await run(w.bot)
  assert.equal(r.status, 'success', r.detail)
  assert.equal(w.spy.placed.length, 1)
  assert.match(lastRow(), /5,64,0:unavailable/)
  assert.match(lastRow(), /unknown=0/)
})

await t('a blocked lid found IN THE SWEEP is unavailable too: the town expands past it', async () => {
  const w = town([stack('cobblestone', 64), stack('chest', 1)])
  w.set(-5, 64, 0, 'chest'); w.set(-5, 65, 0, 'stone'); w.set(-4, 65, 0, 'water')
  const r = await run(w.bot)
  assert.equal(r.status, 'success', r.detail)
  assert.equal(w.spy.placed.length, 1)
  assert.match(lastRow(), /-5,64,0:unavailable/)
})

await t('a scan that throws DEFERS -- it is never "no containers"', async () => {
  const w = town([stack('cobblestone', 64), stack('chest', 1)])
  w.bot.findBlocks = () => { throw new Error('chunk not loaded') }
  const r = await run(w.bot)
  assert.match(r.detail, /could not be listed/)
  assert.equal(w.spy.placed.length, 0)
  assert.match(lastRow(), /^decision=defer .*scan=failed/)
  assert.equal(bankClosed(w.bot), '', 'a scan that throws closes nothing (chestfull-02)')
})

await t('THE WATCHDOG\'S CLOCK (180 s, not the 240 s contract): 150 s in, an untried container is not reached and nothing is built', async () => {
  const w = town([stack('cobblestone', 64), stack('chest', 1)])
  w.set(-5, 64, 0, 'barrel')
  const r = await run(w.bot, {}, { current: { startedAt: Date.now() - 150_000 } })
  // (Codex round 4) time alone is the clamped timeout's own answer: deposit again, nothing paused.
  assert.equal(r.status, 'unknown', r.detail); assert.equal(r.failClass, 'path_budget')
  assert.match(lastRow(), /^decision=out_of_time .*-5,64,0:unknown:time/)
  assert.equal(w.spy.placed.length, 0)
  assert.equal(bankClosed(w.bot), '')
})

await t('ONE SUBMISSION PER CLAIM: a placement that never lands is tried once and stays UNRESOLVED in the ledger (no refund)', async () => {
  const w = town([stack('cobblestone', 64), stack('chest', 2)])
  let calls = 0
  w.bot.placeBlock = async () => { calls++; throw new Error('Event blockUpdate did not fire') }
  const r = await run(w.bot)
  assert.equal(calls, 1)
  assert.match(r.detail, /could not be put down/)
  const l = ledger(process.env.POOL_STATE_DIR)
  assert.equal(l.length, 1); assert.equal(l[0].state, 'unresolved')
})

await t('FAR FROM HOME: never a new chest, town storage is NOT closed, and the far chest is skipped next time', async () => {
  freshPool()
  const w = fakeWorld({ bag: [stack('cobblestone', 64), stack('chest', 1)], at: [101.5, 64, 0.5] })
  w.set(100, 64, 0, 'chest'); w.fill(100, 64, 0)
  const r = await run(w.bot)
  assert.equal(r.failClass, 'storage_full')
  assert.match(r.detail, /^deposit at the town chest/)
  assert.equal(w.spy.placed.length, 0)
  assert.equal(bankClosed(w.bot), '', 'a far full chest does not close town storage')
  assert.ok(w.bot.skipContainers.get('100,64,0') > Date.now())
})

await t('THE CAP\'S REFUSAL pauses deposits; admission says to keep working; craft\'s room advice names NO deposit while closed', async () => {
  const w = town([stack('cobblestone', 64), stack('oak_log', 30), stack('chest', 1)])
  assert.equal(adviseDeposit(w.bot, w.bot.inventory.items(), []), 'oak_log', 'control: with the bank open the advice names a deposit')
  pastClaim(process.env.POOL_STATE_DIR, 1, Date.now() - 60_000)
  await run(w.bot)
  const adm = new AdmissionControl().check({ skill: 'deposit', args: {} }, w.bot)
  assert.equal(adm.ok, false); assert.equal(adm.reason, 'bank_closed'); assert.match(adm.detail, /^keep working/)
  const { remedy, kind } = slotRemedy(w.bot, w.bot.inventory.items(), [{ name: 'stick' }])
  assert.equal(kind, 'closed', remedy)
  assert.match(remedy, /^keep working and craft later/)
  assert.doesNotMatch(remedy, /deposit/, 'no deposit named')
  assert.doesNotMatch(remedy, /no deposit would/)
  assert.ok(`craft -> failed: ${remedy}`.length <= 220, `fits formatOutcome's 220 characters (${remedy.length})`)
})

await t('THE BANK REOPENS EARLY when its reason goes away -- after the throttle, never before', () => {
  const items = []
  const bot = { inventory: { items: () => items } }
  closeBank(bot, 'no chest could be crafted', 30 * 60_000, 0, 'craft_failed')
  items.push({ name: 'chest', count: 1 })
  assert.ok(bankClosed(bot, REOPEN_THROTTLE_MS - 1), 'inside the throttle: still closed')
  assert.equal(bankClosed(bot, REOPEN_THROTTLE_MS), '', 'carrying a chest now: reopened')
  const bot2 = { inventory: { items: () => [] } }
  closeBank(bot2, 'full', 30 * 60_000, 0, 'refuse_cap')
  setTownRoomReader(() => 1000)
  assert.equal(bankClosed(bot2, REOPEN_THROTTLE_MS), '', 'a town container took items after the closure: reopened')
  const bot3 = { inventory: { items: () => [] } }
  closeBank(bot3, 'full', 30 * 60_000, 5000, 'refuse_cap')
  assert.ok(bankClosed(bot3, 5000 + REOPEN_THROTTLE_MS), 'room seen BEFORE the closure does not reopen it')
})

// ---------------------------------------------------------------- round 2 (Codex's probes as regressions) ---
await t('R2.1 STANDING-CAP BYPASS: twelve claimed cells holding chests, one dismissed as not_placed -> reconciled back to placed; no thirteenth', () => {
  const dir = freshPool(), now = Date.now()
  for (let n = 1; n <= 12; n++) pastClaim(dir, n, now - 2 * DAY_MS - n * 1000, { x: n, y: 64, z: 30 }, n === 7 ? 'not_placed' : 'placed')
  assert.equal(chestBudget({ claims: ledger(dir), now }).standing, 11, 'the probe: the dismissed claim had released one')
  const claims = ledger(dir)
  reconcileClaims({ dir, key: KEY, claims, read: () => 'chest', now })
  const b = chestBudget({ claims: ledger(dir), now })
  assert.equal(b.standing, 12); assert.equal(b.ok, false)
  assert.equal(claimNewChest({ dir, key: KEY, site: { x: 3, y: 64, z: 3 }, now }).ok, false, 'and the claim itself is refused')
})

await t('R2.1 MONOTONIC: an older observation never overwrites a newer one; placed becomes gone only on a fresh read', () => {
  const dir = freshPool()
  pastClaim(dir, 1, 1000, { x: 1, y: 64, z: 1 })
  writeClaimState(dir, KEY, 1, 'placed', 5000)
  writeClaimState(dir, KEY, 1, 'not_placed', 4000)            // a stale observation written late
  assert.equal(ledger(dir)[0].state, 'placed')
  writeClaimState(dir, KEY, 1, 'gone', 5000)                  // a tie: the capacity-holding side wins
  assert.equal(ledger(dir)[0].state, 'placed')
  reconcileClaims({ dir, key: KEY, claims: ledger(dir), read: () => null, now: 9000 })
  assert.equal(ledger(dir)[0].state, 'placed', 'unloaded: no fresh read, no change')
  reconcileClaims({ dir, key: KEY, claims: ledger(dir), read: () => 'air', now: 9000 })
  assert.equal(ledger(dir)[0].state, 'gone', 'a fresh read showing no chest')
})

await t('R2.2 STRIKES ARE STICKY: failures at 0, 600001 and 600002 ms leave it unusable (keeping only two used to undo it)', () => {
  let e = recordOutcome(undefined, 'unknown', 0)
  e = recordOutcome(e, 'unknown', 600_001)
  assert.equal(containerStatus(e, 600_001), 'unusable')
  e = recordOutcome(e, 'unknown', 600_002)
  assert.equal(containerStatus(e, 600_003), 'unusable')
  assert.equal(containerStatus(recordOutcome(e, 'full', 600_004), 600_005), 'full', 'a container that opened is usable again')
})

await t('R2.2 THE FIRST CHEST BY THE TOWN\'S MEMORY: one found full a minute ago is neither walked to nor opened', async () => {
  const w = town([stack('cobblestone', 64), stack('chest', 1)])
  w.set(-5, 64, 0, 'barrel')
  updateTownMemory(process.env.POOL_STATE_DIR, KEY, null, e => { e['5,64,0'] = recordOutcome(undefined, 'full', Date.now() - 60_000) })
  const r = await run(w.bot)
  assert.equal(r.status, 'success', r.detail)
  assert.ok(!w.spy.opened.includes('5,64,0'), 'not opened')
  assert.ok(!w.spy.gotos.some(g => g.x === 5 && g.z === 0), 'not walked to')
  assert.ok(w.containers.get('-5,64,0').slots.some(Boolean))
})

await t('R2.3 AN UNREACHABLE FIRST CHEST goes on to the town\'s other containers (it was a dead end)', async () => {
  const w = town([stack('cobblestone', 64), stack('chest', 1)])
  w.set(-5, 64, 0, 'barrel')
  const goto = w.bot.pathfinder.goto
  w.bot.pathfinder.goto = async g => { if (g.x === 5 && g.z === 0) throw new Error('No path to the goal!'); return goto(g) }
  const r = await run(w.bot)
  assert.equal(r.status, 'success', r.detail)
  assert.ok(w.containers.get('-5,64,0').slots.some(Boolean), 'the barrel took it')
  const mem = JSON.parse(fs.readFileSync(path.join(process.env.POOL_STATE_DIR, `${KEY}.containers.json`), 'utf8')).entries
  assert.equal(mem['5,64,0'].o, 'unknown', 'the unreachable chest has a strike')
})

await t('R2.4 THE FIRST OPEN IS CLAMPED TO THE WATCHDOG: with 1 s left a hung open costs about 1 s, not 8', async () => {
  const w = town([stack('cobblestone', 64), stack('chest', 1)])
  w.bot.openContainer = () => new Promise(() => {})
  const t0 = Date.now()
  const r = await run(w.bot, {}, { current: { startedAt: Date.now() - 179_000 } })
  const ms = Date.now() - t0
  assert.ok(ms < 3000, `took ${ms} ms`)
  assert.equal(w.spy.placed.length, 0, r.detail)
  // and a timeout of OUR clock strikes nothing (Claude round 3)
  assert.equal(r.status, 'unknown'); assert.equal(r.failClass, 'path_budget'); assert.match(r.detail, /^deposit again/)
  assert.equal(memEntry('5,64,0'), undefined, 'no strike in the town\'s memory')
  assert.equal(bankClosed(w.bot), '')
})

await t('R2.5 transfer_unsettled AT THE NEW CHEST is returned unchanged', async () => {
  const w = town([stack('cobblestone', 64), stack('chest', 1)])
  const place = w.bot.placeBlock, click = w.bot.clickWindow, open = w.bot.openContainer
  let at = null
  w.bot.placeBlock = async (ref, face) => { await place(ref, face); w.fill(...w.spy.placed.at(-1).split(',').map(Number)) }
  w.bot.openContainer = async b => { at = `${b.position.x},${b.position.y},${b.position.z}`; return open(b) }
  w.bot.clickWindow = async slot => { if (at === w.spy.placed[0]) return; return click(slot) }
  const r = await run(w.bot)
  assert.equal(w.spy.placed.length, 1)
  assert.equal(r.failClass, 'transfer_unsettled', r.detail)
})

// ---------------------------------------------------------------- round 3 (Codex's probes as regressions) ---
await t('R3.C A LONG TRIP HOME LEAVING 3 s: the walk to the chest times out on OUR clock -- no strike, no recovery, bank open', async () => {
  const w = town([stack('cobblestone', 64), stack('chest', 1)])
  w.set(-5, 64, 0, 'barrel')
  const goto = w.bot.pathfinder.goto
  w.bot.pathfinder.goto = g => (g.x === 5 && g.z === 0 ? new Promise(() => {}) : goto(g))
  const r = await run(w.bot, {}, { current: { startedAt: Date.now() - 177_000 } })
  assert.equal(r.status, 'unknown', r.detail); assert.equal(r.failClass, 'path_budget')
  assert.match(r.detail, /^deposit again: this attempt ran out of time before reaching the chest at 5,64,0/)
  assert.equal(memEntry('5,64,0'), undefined, 'a good chest is not struck for our clock')
  assert.equal(bankClosed(w.bot), '')
  assert.ok(!w.spy.opened.includes('-5,64,0'), 'no recovery sweep')
  assert.equal(w.spy.placed.length, 0)
})

await t('R3.C A NO-PATH WALK THAT BEGAN OUTSIDE TOWN strikes nothing: the travel failure, as before', async () => {
  const w = town([stack('cobblestone', 64), stack('chest', 1)], [40.5, 64, 0.5])
  const goto = w.bot.pathfinder.goto
  w.bot.pathfinder.goto = async g => { if (g.x === 5 && g.z === 0) throw new Error('No path to the goal!'); return goto(g) }
  const r = await run(w.bot)
  assert.equal(r.status, 'failed'); assert.match(r.detail, /could not reach the chest at 5,64,0/)
  assert.equal(memEntry('5,64,0'), undefined)
  assert.equal(w.spy.placed.length, 0)
  assert.equal(w.bot.skipContainers?.get?.('5,64,0'), undefined, 'a TOWN chest is never hidden from this bot\'s next walk home')
})

await t('R3.1 A CONFIRMING READ IS WRITTEN: 12 placed, a fresh read sees 12 chests, then a DELAYED OLDER absence arrives -> still 12, no claim 13', () => {
  const dir = freshPool(), now = Date.now()
  for (let n = 1; n <= 12; n++) pastClaim(dir, n, now - 2 * DAY_MS - n * 1000, { x: n, y: 64, z: 30 }, 'placed')
  reconcileClaims({ dir, key: KEY, claims: ledger(dir), read: () => 'chest', now })
  writeClaimState(dir, KEY, 7, 'gone', now - 60_000)          // an observation made a minute ago, written only now
  const b = chestBudget({ claims: ledger(dir), now })
  assert.equal(b.standing, 12); assert.equal(b.ok, false)
  assert.equal(claimNewChest({ dir, key: KEY, site: { x: 3, y: 64, z: 3 }, now }).ok, false)
})

await t('R3.2 PRUNING KEEPS THE WINNER: one placed and four gone at the same time -> still placed', () => {
  const dir = freshPool()
  pastClaim(dir, 1, 1000, { x: 1, y: 64, z: 1 })
  writeClaimState(dir, KEY, 1, 'placed', 5000)
  for (let i = 0; i < 4; i++) writeClaimState(dir, KEY, 1, 'gone', 5000)
  assert.equal(ledger(dir)[0].state, 'placed')
  assert.ok(fs.readdirSync(dir).filter(f => f.startsWith(`${KEY}.c1.o`)).length <= 4, 'and it did prune')
})

// ---------------------------------------------------------------- round 4 (Codex's probes as regressions) ---
await t('R4.1 A CLAMPED OPEN AT THE NEW CHEST is returned unchanged: no storage_full, no bank pause', async () => {
  const w = town([stack('cobblestone', 64), stack('chest', 1)])
  const runner = { current: { startedAt: Date.now() } }
  const place = w.bot.placeBlock, open = w.bot.openContainer
  // The placement uses the clock up: when it lands the watchdog has ~2 s left, and the new chest never opens.
  w.bot.placeBlock = async (ref, face) => { await place(ref, face); runner.current.startedAt = Date.now() - 178_000 }
  w.bot.openContainer = b => (w.spy.placed.includes(`${b.position.x},${b.position.y},${b.position.z}`) ? new Promise(() => {}) : open(b))
  const r = await run(w.bot, {}, runner)
  assert.equal(w.spy.placed.length, 1)
  assert.equal(r.status, 'unknown', r.detail); assert.equal(r.failClass, 'path_budget')
  assert.equal(bankClosed(w.bot), '', 'nothing paused')
  assert.match(lastRow(), /out_of_time=1/)
})

await t('R4.1 A CLAMPED OPEN IN THE SWEEP is returned unchanged: no strike, no bank pause', async () => {
  const w = town([stack('cobblestone', 64), stack('chest', 1)])
  w.set(-5, 64, 0, 'barrel')
  const open = w.bot.openContainer
  w.bot.openContainer = b => (b.position.x === -5 ? new Promise(() => {}) : open(b))
  const r = await run(w.bot, {}, { current: { startedAt: Date.now() - 118_000 } })
  assert.equal(r.status, 'unknown', r.detail); assert.equal(r.failClass, 'path_budget')
  assert.equal(memEntry('-5,64,0'), undefined, 'the barrel is not struck')
  assert.equal(bankClosed(w.bot), '')
  assert.equal(w.spy.placed.length, 0)
})

await t('R4.2 WHERE THE WALK BEGAN is read before the walk: a live position that moves into town does not strike', async () => {
  const w = town([stack('cobblestone', 64), stack('chest', 1)], [40.5, 64, 0.5])
  w.bot.pathfinder.goto = async g => {
    if (g.x === 5 && g.z === 0) { w.bot.entity.position.x = 6.5; throw new Error('No path to the goal!') }   // mutated IN PLACE
  }
  const r = await run(w.bot)
  assert.equal(r.status, 'failed'); assert.match(r.detail, /could not reach the chest at 5,64,0/)
  assert.equal(memEntry('5,64,0'), undefined, 'no strike')
  assert.equal(bankClosed(w.bot), '')
})

await t('THE LID FILTER: place() with no coordinates never puts a block on a chest, and refuses explicit coordinates there', async () => {
  const w = fakeWorld({ bag: [stack('cobblestone', 10)], at: [0.5, 64, 0.5] })
  for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
    if (dx || dz) { w.set(dx, 64, dz, 'stone'); w.set(dx, 65, dz, 'stone') }
  }
  w.set(1, 64, 0, 'air'); w.set(1, 63, 0, 'chest')
  const r = await SKILLS.place.run({ bot: w.bot }, { item: 'cobblestone' }, new AbortController().signal)
  assert.equal(r.status, 'failed', `placed on the lid: ${r.detail}`)
  assert.equal(w.nameAt(1, 64, 0), 'air')
  const r2 = await SKILLS.place.run({ bot: w.bot }, { item: 'cobblestone', x: 1, y: 64, z: 0 }, new AbortController().signal)
  assert.equal(r2.status, 'failed'); assert.match(r2.detail, /on top of a container/)
  w.set(1, 63, 0, 'dirt')
  const r3 = await SKILLS.place.run({ bot: w.bot }, { item: 'cobblestone' }, new AbortController().signal)
  assert.equal(r3.status, 'success', `control: ${r3.detail}`)
})

// ---------------------------------------------------------------- chestfull-02 (the 10-05 revert's mechanisms) ---
await t('C2 inTown: ONE boundary -- 16 horizontally AND 12 above or below home; the old 3-D memory boundary disagreed', () => {
  const T = [
    [{ x: 16, y: 64, z: 0 }, true], [{ x: 17, y: 64, z: 0 }, false],
    [{ x: 0, y: 76, z: 0 }, true], [{ x: 0, y: 77, z: 0 }, false], [{ x: 0, y: 52, z: 0 }, true], [{ x: 0, y: 51, z: 0 }, false],
    [{ x: 15, y: 74, z: 0 }, true],    // 3-D distance 18 (townDistance said NOT town for the memory write)
    [{ x: 10, y: 50, z: 0 }, false],   // 10 out, 14 below: horizontally "town" to chestfull-01's recovery
    [{ x: 0.5, y: 64.9, z: 0.5 }, true], [null, false], [{ x: NaN, y: 64, z: 0 }, false],
  ]
  for (const [q, want] of T) assert.equal(inTown(HOME, q), want, JSON.stringify(q))
  assert.equal(TOWN_DY, 12); assert.equal(TOWN_SCAN_RADIUS, 20, 'the scan sphere reaches the cylinder\'s corner')
})

await t('C2 depositTargetOk: a DEEP container (|dy| > 12 from home) is never a target, however far out; a palette block (no position) passes', () => {
  const T = [[{ x: 0, y: 44, z: 20 }, false], [{ x: 0, y: 52, z: 0 }, true], [{ x: 0, y: 76, z: 0 }, true], [{ x: 0, y: 77, z: 0 }, false],
             [{ x: 500, y: 64, z: 0 }, true], [{ x: 500, y: 6, z: 0 }, false], [null, true]]
  for (const [q, want] of T) assert.equal(depositTargetOk(HOME, q), want, JSON.stringify(q))
  assert.equal(depositTargetOk({ x: 355, y: 73, z: 147 }, { x: 365, y: 15, z: 184 }), false, 'the 10-05 chest: 58 below board-a\'s home')
})

await t('C2 closesBank: only a TRULY closed bank pauses deposits -- a defer never does', () => {
  for (const k of ['refuse_cap', 'no_site', 'craft_failed', 'place_failed', 'retry_failed']) assert.equal(closesBank(k), true, k)
  for (const k of ['defer', 'far', 'out_of_time', 'other', undefined]) assert.equal(closesBank(k), false, String(k))
})

await t('C2 walkFailure / backsOffTarget / travelTimeoutAction: truth tables', () => {
  assert.equal(walkFailure(new Error('The goal was changed before it could be completed!')), 'interrupted')
  assert.equal(walkFailure(new Error('path to 1,2 was stopped')), 'interrupted')
  assert.equal(walkFailure(new Error('No path to the goal!')), 'no_path')
  assert.equal(walkFailure(Object.assign(new Error('cannot break obsidian on the way there'), { failClass: 'undiggable_en_route' })), 'no_path')
  assert.equal(walkFailure(Object.assign(new Error('pathfinding exceeded 60000ms'), { budgetExceeded: true })), 'timeout')
  assert.equal(walkFailure(new Error('something else')), 'other')
  const B = [['no_path', false, true], ['timeout', false, true], ['interrupted', false, false], ['other', false, false],
             ['no_path', true, false], ['timeout', true, false]]
  for (const [kind, targetInTown, want] of B) assert.equal(backsOffTarget({ kind, targetInTown }), want, `${kind} ${targetInTown}`)
  const g = {}, h = {}
  assert.equal(travelTimeoutAction({ ours: g, current: g }), 'halt')
  assert.equal(travelTimeoutAction({ ours: g, current: h }), 'leave', 'a reflex took the pathfinder')
  assert.equal(travelTimeoutAction({ ours: g, current: null }), 'leave')
  assert.equal(travelTimeoutAction({ ours: null, current: null }), 'leave')
})

// A held tool that cannot HARVEST what is being dug -- the state watchDigging cancels. `slowWalks` holds each walk
// 1.3 s, past watchDigging's first 1000 ms poll.
const undiggableDig = w => {
  const calls = { stopDigging: 0, stop: 0 }
  w.bot.targetDigBlock = { name: 'obsidian', canHarvest: () => false }
  w.bot.stopDigging = () => { calls.stopDigging++ }
  w.bot.pathfinder.stop = () => { calls.stop++ }
  return calls
}
const slowWalks = w => { const goto = w.bot.pathfinder.goto; w.bot.pathfinder.goto = async g => { await new Promise(r => setTimeout(r, 1300)); return goto(g) } }
await t('C2 THE WALK NEVER WATCHES DIGS: a dig the held tool cannot harvest is not stopped by the walk to the chest, nor by the walk to the new chest\'s cell', async () => {
  // POSITIVE CONTROL: the same fake, under withTimeout's default (what chestfull-01's walk used), IS stopped.
  const c = fakeWorld({ bag: [] }); const cc = undiggableDig(c)
  await withTimeout(new Promise(r => setTimeout(r, 1300)), 5000, c.bot)
  assert.ok(cc.stopDigging >= 1 && cc.stop >= 1, `control: the default watches digs (${JSON.stringify(cc)})`)
  const w = town([stack('cobblestone', 64), stack('chest', 1)])
  const calls = undiggableDig(w); slowWalks(w)
  const r = await run(w.bot)
  assert.equal(r.status, 'success', r.detail)
  assert.equal(w.spy.placed.length, 1, 'the recovery walked to the new chest\'s cell and placed it')
  assert.deepEqual(calls, { stopDigging: 0, stop: 0 }, 'nothing stopped the dig or the path')
})

await t('C2 OUR CLOCK LEAVES A REFLEX\'S GOAL ALONE: a walk that times out clears the goal only while it is still the walk\'s own', async () => {
  for (const reflexTookIt of [false, true]) {
    const w = town([stack('cobblestone', 64), stack('chest', 1)])
    const set = []
    w.bot.pathfinder.setGoal = g => { set.push(g); w.bot.pathfinder.goal = g }
    const other = { reflex: true }
    w.bot.pathfinder.goto = g => { w.bot.pathfinder.goal = g; if (reflexTookIt) setTimeout(() => { w.bot.pathfinder.goal = other }, 200); return new Promise(() => {}) }
    const r = await run(w.bot, {}, { current: { startedAt: Date.now() - 178_500 } })
    assert.equal(r.status, 'unknown', r.detail); assert.equal(r.failClass, 'path_budget')
    if (reflexTookIt) {
      assert.deepEqual(set, [], 'the reflex keeps the pathfinder')
      assert.equal(w.bot.pathfinder.goal, other)
    } else assert.deepEqual(set, [null], 'control: its own goal is cleared')
  }
})

await t('C2 A DEEP CONTAINER IS NEVER A TARGET: from a mine, the chest 20 below home is passed over for the town chest', async () => {
  for (const deepY of [44, 56]) {   // 44: deep (dy -20); 56: the control (dy -8), nearest, and used
    freshPool()
    const w = fakeWorld({ bag: [stack('oak_log', 30)], at: [0.5, deepY, 21.5] })
    w.set(5, 64, 0, 'chest'); w.set(0, deepY, 20, 'chest')
    w.set(1, deepY, 20, 'air'); w.set(1, deepY + 1, 20, 'air'); w.set(0, deepY + 1, 20, 'air')   // a mined pocket: room to stand, a free lid
    const r = await run(w.bot)
    assert.equal(r.status, 'success', r.detail)
    const near = `0,${deepY},20`
    if (deepY === 44) {
      assert.ok(!w.spy.opened.includes(near) && !w.spy.gotos.some(g => g.y === 44), 'never walked to or opened')
      assert.ok(w.spy.opened.includes('5,64,0'), 'the town chest took it')
    } else assert.deepEqual(w.spy.opened, [near], 'control: the nearest non-deep chest is the one used')
  }
})

await t('C2 A DEEP CHEST IS NOT STORAGE ANYWHERE: admission, deposit_surplus.done(), the prompt and the deposit agree (no bot sent to a chest the deposit skips)', async () => {
  const surplus = SUSTAINING.find(m => m.id === 'deposit_surplus')
  for (const [y, deep] of [[30, true], [60, false]]) {
    freshPool()
    const w = fakeWorld({ bag: [stack('oak_log', 30), stack('apple', 20)], at: [150.5, y, 0.5] })
    w.set(150, y, 5, 'chest')
    const adm = new AdmissionControl().check({ skill: 'deposit', args: {} }, w.bot)
    assert.equal(adm.ok, !deep, `${deep ? 'deep' : 'control'}: ${JSON.stringify(adm)}`)
    if (deep) assert.equal(adm.reason, 'deposit_not_worth_it')
    assert.equal(surplus.done(w.bot), deep, deep ? 'beside only a deep chest: nothing to do here; `return` follows' : 'control: a usable chest in reach')
    const line = depositSituation(w.bot, {})
    if (deep) assert.equal(line, '', `the prompt does not advertise the deep chest: ${line}`)
    else assert.match(line, /^CARRYING: \d+ items worth banking and storage is \d+ blocks away/, 'control')
  }
})

await t('C2 THE TOWN SWEEP SKIPS A DEEP CONTAINER under home: the full town expands instead of banking 14 below', async () => {
  const w = town([stack('cobblestone', 64), stack('chest', 1)])
  w.set(3, 50, 0, 'chest')    // 3 out, 14 below: inside chestfull-01's horizontal "town", with room
  const r = await run(w.bot)
  assert.equal(r.status, 'success', r.detail)
  assert.ok(!w.spy.opened.includes('3,50,0'), 'the deep chest was not opened')
  assert.equal(w.spy.placed.length, 1, 'the town placed its carried chest')
})

await t('C2 ONE BOUNDARY FOR READ AND WRITE: a town chest 10 above home and 15 out, found full, is REMEMBERED (3-D distance 18 refused the write)', async () => {
  freshPool()
  const w = fakeWorld({ bag: [stack('cobblestone', 64), stack('chest', 1)], at: [14.5, 74, 1.5] })
  w.set(15, 74, 0, 'chest'); w.fill(15, 74, 0)
  w.set(-5, 64, 0, 'barrel')
  const r = await run(w.bot)
  assert.equal(r.status, 'success', r.detail)
  assert.equal(memEntry('15,74,0')?.o, 'full', 'its backoff is written, so the next deposit does not walk to it')
  assert.equal(memEntry('-5,64,0')?.o, 'took')
})

await t('C2 A WALK THAT BEGINS DEEP UNDER TOWN is not a town walk: a no-path strikes nothing (the same boundary as the chest\'s)', async () => {
  for (const [y, strikes] of [[44, false], [64, true]]) {   // 20 below home, under the town; control: in town
    const w = town([stack('cobblestone', 64), stack('chest', 1)], [3.5, y, 0.5])
    const goto = w.bot.pathfinder.goto
    w.bot.pathfinder.goto = async g => { if (g.x === 5 && g.z === 0) throw new Error('No path to the goal!'); return goto(g) }
    await run(w.bot)
    assert.equal(memEntry('5,64,0')?.o, strikes ? 'unknown' : undefined, `began at y=${y}`)
  }
})

await t('C2 A FAILED WALK TO A FAR CHEST backs THAT chest off for this bot (no path); an interrupted walk backs off nothing', async () => {
  for (const [msg, backs] of [['No path to the goal!', true], ['The goal was changed before it could be completed!', false]]) {
    freshPool()
    const w = fakeWorld({ bag: [stack('oak_log', 30)], at: [101.5, 64, 0.5] })
    w.set(100, 64, 5, 'chest')
    w.bot.pathfinder.goto = async () => { throw new Error(msg) }
    const r = await run(w.bot)
    assert.equal(r.status, 'failed', r.detail)
    const until = w.bot.skipContainers?.get?.('100,64,5')
    if (backs) assert.ok(until > Date.now() + 9 * 60_000, 'backed off ~10 min')
    else assert.equal(until, undefined, 'an interruption says nothing about the chest')
    assert.equal(bankClosed(w.bot), '')
  }
})

await t('C2 AN INTERRUPTED WALK TO A TOWN CHEST strikes nothing and sweeps nothing: someone else has the pathfinder', async () => {
  const w = town([stack('cobblestone', 64), stack('chest', 1)])
  w.set(-5, 64, 0, 'barrel')
  const goto = w.bot.pathfinder.goto
  w.bot.pathfinder.goto = async g => { if (g.x === 5 && g.z === 0) throw new Error('The goal was changed before it could be completed!'); return goto(g) }
  const r = await run(w.bot)
  assert.equal(r.status, 'failed'); assert.equal(r.failClass, 'path_interrupted', r.detail)
  assert.equal(memEntry('5,64,0'), undefined, 'no strike')
  assert.ok(!w.spy.opened.includes('-5,64,0'), 'no sweep')
  assert.equal(bankClosed(w.bot), '')
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
