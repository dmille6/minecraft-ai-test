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

const LOGS = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-chestfull-logs-'))
process.env.LOG_DIR = LOGS
process.env.BOT_NAME = 'ChestBot'
process.env.OLLAMA_MODEL ??= 'qwen2.5:7b-instruct'
process.env.HOME_X = '0'; process.env.HOME_Y = '64'; process.env.HOME_Z = '0'
const freshPool = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-chestfull-pool-')); process.env.POOL_STATE_DIR = d; return d }
freshPool()

const CF = await import('../src/chestfull.mjs')
const { fullChestNext, chestSiteRefusal, chestCap, claimTownChest, chestClaimKey, readChestClaims, returnCursor, bankClosed, closeBank,
        chestPartnerOffset, isChestPartner, pickChestSite, MAX_TOWN_CONTAINERS, TOWN_CHEST_INTERVAL_MS } = CF
const { SKILLS, adviseDeposit } = await import('../src/skills.mjs')
const { AdmissionControl } = await import('../src/admission.mjs')
const { roomAdvice } = await import('../src/craftroom.mjs')
const { fakeWorld, stack, total } = await import('./fakeworld.mjs')

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 3).join('\n        ')}`) }
}
// Every record as the logger writes it (its file stream is asynchronous; the tap sees each record once written).
const { tapRecords } = await import('../src/logger.mjs')
const RECS = []
tapRecords(r => RECS.push(r))
const rows = kind => RECS.filter(r => r.skill?.name === `_${kind}`)
const run = (bot, args = {}) => SKILLS.deposit.run({ bot }, args, new AbortController().signal)

// ---------------------------------------------------------------- pure: what next ---
await t('fullChestNext: a carried chest is PLACED; a chest is crafted only when none is carried', () => {
  const ok = { ok: true }, no = { ok: false }
  const T = [
    // nearHome, unknown, cap, carried -> next
    [false, 0, ok, true, 'far'], [false, 0, ok, false, 'far'], [false, 3, ok, true, 'far'],
    [true, 1, ok, true, 'defer'], [true, 1, ok, false, 'defer'], [true, 2, no, true, 'defer'],
    [true, 0, no, true, 'refuse_cap'], [true, 0, no, false, 'refuse_cap'],
    [true, 0, ok, true, 'place_carried'], [true, 0, ok, false, 'craft'],
  ]
  for (const [nearHome, unknown, cap, carried, want] of T) {
    assert.equal(fullChestNext({ nearHome, unknown, cap, carried }), want, JSON.stringify({ nearHome, unknown, cap, carried }))
  }
  assert.equal(fullChestNext({}), 'far', 'nothing known: nothing built')
})

await t('chestCap: the container limit, one chest per town per interval, another world\'s claim ignored, malformed fails closed', () => {
  const now = 10_000_000
  assert.equal(chestCap({ containers: 0, last: { gen: 0 }, now }).ok, true)
  assert.equal(chestCap({ containers: MAX_TOWN_CONTAINERS - 1, last: { gen: 0 }, now }).ok, true)
  assert.equal(chestCap({ containers: MAX_TOWN_CONTAINERS, last: { gen: 0 }, now }).ok, false)
  const recent = { gen: 3, at: now - 60_000, world: 'w1' }
  assert.equal(chestCap({ containers: 1, last: recent, now, world: 'w1' }).ok, false, 'a claim a minute ago')
  assert.equal(chestCap({ containers: 1, last: recent, now, world: 'w1' }).until, recent.at + TOWN_CHEST_INTERVAL_MS)
  assert.equal(chestCap({ containers: 1, last: { ...recent, at: now - TOWN_CHEST_INTERVAL_MS }, now, world: 'w1' }).ok, true, 'the interval has passed')
  assert.equal(chestCap({ containers: 1, last: recent, now, world: 'w2' }).ok, true, 'a claim from another world (a reseed) does not count')
  assert.equal(chestCap({ containers: 1, last: { gen: 2, malformed: true }, now }).ok, false, 'an unreadable record fails closed')
})

await t('claimTownChest: write-once -- the second claim in an interval loses; an unwritable directory fails closed', () => {
  const dir = freshPool(), key = chestClaimKey({ x: 0, y: 64, z: 0 }), site = { x: 3, y: 64, z: 3 }
  const now = Date.now()
  const a = claimTownChest({ dir, key, site, containers: 2, now })
  assert.equal(a.ok, true, a.why)
  assert.equal(readChestClaims(dir, key).gen, 1)
  const b = claimTownChest({ dir, key, site, containers: 2, now: now + 1000 })
  assert.equal(b.ok, false, 'one chest per town per interval')
  const blocked = path.join(dir, 'a-file'); fs.writeFileSync(blocked, 'x')
  const c = claimTownChest({ dir: path.join(blocked, 'sub'), key, site, containers: 2, now })
  assert.equal(c.ok, false, 'nothing written, no chest')
  assert.match(c.why, /could not be written/)
})

await t('chestPartnerOffset / isChestPartner: vanilla getConnectedDirection (LEFT clockwise of facing)', () => {
  assert.deepEqual(chestPartnerOffset({ facing: 'north', type: 'left' }), { x: 1, z: 0 })
  assert.deepEqual(chestPartnerOffset({ facing: 'north', type: 'right' }), { x: -1, z: 0 })
  assert.deepEqual(chestPartnerOffset({ facing: 'east', type: 'left' }), { x: 0, z: 1 })
  assert.equal(chestPartnerOffset({ facing: 'north', type: 'single' }), null)
  const L = { name: 'chest', props: { facing: 'north', type: 'left' } }, R = { name: 'chest', props: { facing: 'north', type: 'right' } }
  assert.equal(isChestPartner(L, R), true)
  assert.equal(isChestPartner(L, { ...R, props: { facing: 'south', type: 'right' } }), false, 'another facing is another chest')
  assert.equal(isChestPartner(L, { ...R, name: 'trapped_chest' }), false)
})

// ---------------------------------------------------------------- pure: where ---
const flat = (extra = {}) => (x, y, z) => {
  const k = `${x},${y},${z}`
  if (k in extra) return extra[k]
  return y <= 63 ? { name: 'grass_block', boundingBox: 'block' } : { name: 'air', boundingBox: 'empty' }
}
const C = { name: 'chest', boundingBox: 'block' }, STONE = { name: 'stone', boundingBox: 'block' }
const home = { x: 0, y: 64, z: 0 }

await t('chestSiteRefusal: truth table', () => {
  const read = flat({ '5,64,0': C })
  const cases = [
    [{ x: 5, y: 64, z: 2 }, {}, null, 'open ground two from the chest'],
    [{ x: 6, y: 64, z: 0 }, {}, /beside it/, 'beside a chest: it would merge into a double chest'],
    [{ x: 1, y: 64, z: 1 }, {}, /home point/, 'on the home point'],
    [{ x: 30, y: 64, z: 0 }, {}, /from home/, 'outside STORAGE_NEAR: the cap could not count it'],
    [{ x: 8, y: 64, z: 3 }, { composterSites: [{ x: 9, y: 64, z: 4 }] }, /composter site/, 'within 3 of the composter site'],
    [{ x: 8, y: 64, z: 3 }, { bodies: [{ x: 8.5, y: 64, z: 3.5 }] }, /standing in it/, 'a body in the cell'],
  ]
  for (const [site, opts, want, why] of cases) {
    const r = chestSiteRefusal(read, site, { home, ...opts })
    if (want === null) assert.equal(r, null, `${why}: ${r}`)
    else assert.match(String(r), want, `${why}: ${r}`)
  }
  // NEVER ON A LID: the floor is a chest.
  assert.match(String(chestSiteRefusal(flat({ '5,63,0': C }), { x: 5, y: 64, z: 0 }, { home })), /floor is chest/)
  // THE LID MUST STAY FREE: a solid block above the cell.
  assert.match(String(chestSiteRefusal(flat({ '5,65,2': STONE }), { x: 5, y: 64, z: 2 }, { home })), /lid blocked/)
  // A COMPOSTER BLOCK within 3, not only the recorded site.
  assert.match(String(chestSiteRefusal(flat({ '6,64,4': { name: 'composter', boundingBox: 'block' } }), { x: 5, y: 64, z: 2 }, { home })), /composter within 3/)
  // UNKNOWN is never a yes.
  assert.equal(chestSiteRefusal((x, y, z) => (x === 5 && z === 3 ? null : flat()(x, y, z)), { x: 5, y: 64, z: 2 }, { home }), 'unknown')
})

await t('chestSiteRefusal: never the ONLY standing cell of an existing container (a barrel walled in on three sides)', () => {
  // barrel at 5,64,0 with stone on +x, -x and -z: its only standing cell is 5,64,1.
  const read = flat({ '5,64,0': { name: 'barrel', boundingBox: 'block' }, '6,64,0': STONE, '4,64,0': STONE, '5,64,-1': STONE })
  assert.match(String(chestSiteRefusal(read, { x: 5, y: 64, z: 1 }, { home })), /only standing cell of the barrel/)
  // Control: with a second open side the same cell is allowed (as far as this rule goes).
  const read2 = flat({ '5,64,0': { name: 'barrel', boundingBox: 'block' }, '6,64,0': STONE, '5,64,-1': STONE })
  assert.doesNotMatch(String(chestSiteRefusal(read2, { x: 5, y: 64, z: 1 }, { home })), /only standing cell/)
})

await t('chestSiteRefusal reuses the composter checks but NOT its container clearance (a chest may stand two from a chest)', () => {
  const read = flat({ '5,64,0': C, '3,64,0': C })
  assert.equal(chestSiteRefusal(read, { x: 4, y: 64, z: 2 }, { home }), null)
  // and the composter's own rule still refuses that cell, which is the point of the mask
  return import('../src/composter.mjs').then(({ siteRefusal }) => assert.match(String(siteRefusal(read, { x: 4, y: 64, z: 2 }, home)), /chest within 3/))
})

await t('pickChestSite: rings around the full chest; the first acceptable cell, with where to stand', () => {
  const r = pickChestSite({ read: flat({ '5,64,0': C }), anchor: { x: 5, y: 64, z: 0 }, home })
  assert.ok(r.site, r.why)
  assert.ok(Math.max(Math.abs(r.site.x - 5), Math.abs(r.site.z)) <= 4)
  assert.equal(chestSiteRefusal(flat({ '5,64,0': C }), r.site, { home }), null)
  assert.ok(r.stand)
  const none = pickChestSite({ read: () => STONE, anchor: { x: 5, y: 64, z: 0 }, home })
  assert.equal(none.site, null)
})

// ---------------------------------------------------------------- returnCursor ---
await t('returnCursor puts a lifted stack back in the bag; nothing is dropped on close', async () => {
  const w = fakeWorld({ bag: [stack('cobblestone', 64)] })
  w.set(5, 64, 0, 'chest'); w.fill(5, 64, 0)
  const win = await w.bot.openContainer(w.bot.blockAt({ x: 5, y: 64, z: 0 }))
  await assert.rejects(win.deposit(w.bag[0].type, null, 64), /destination full/)
  assert.ok(win.selectedItem, 'the fake behaves as mineflayer does: the stack is on the cursor')
  const r = await returnCursor(w.bot, win)
  assert.equal(r.returned, true)
  win.close()
  assert.equal(w.dropped.length, 0)
  assert.equal(total(w.bag), 64)
  // Control: without the rescue the close drops it -- the instrument can see a drop.
  const w2 = fakeWorld({ bag: [stack('cobblestone', 64)] })
  w2.set(5, 64, 0, 'chest'); w2.fill(5, 64, 0)
  const win2 = await w2.bot.openContainer(w2.bot.blockAt({ x: 5, y: 64, z: 0 }))
  await assert.rejects(win2.deposit(w2.bag[0].type, null, 64))
  win2.close()
  assert.equal(w2.dropped.length, 1, 'positive control: the fake drops a cursor stack on close')
})

// ---------------------------------------------------------------- THE CHAIN ---
await t('THE CHAIN: room advice names deposit -> admitted -> full chest throws -> cursor returned -> no other container has room -> the CARRIED chest is placed -> the retry banks; craft never called, items conserved', async () => {
  freshPool()
  const w = fakeWorld({ bag: [stack('cobblestone', 64), stack('oak_log', 30), stack('chest', 1), stack('apple', 5)] })
  w.set(5, 64, 0, 'chest'); w.fill(5, 64, 0)
  const items = w.bot.inventory.items()
  // 1. craft's room refusal: the deposit it names
  const item = adviseDeposit(w.bot, items, [{ name: 'stick' }])
  const advice = roomAdvice({ items, consumes: [{ name: 'stick' }], depositItem: item })
  assert.equal(advice.kind, 'deposit', advice.text)
  // 2. admitted (near the chest, the bank open)
  const adm = new AdmissionControl().check({ skill: 'deposit', args: { item } }, w.bot)
  assert.equal(adm.ok, true, JSON.stringify(adm))
  // 3. the deposit, driven through the real skill
  const before = total(w.bag), chestsBefore = w.bag.find(i => i.name === 'chest').count
  const r = await run(w.bot, { item })
  assert.equal(r.status, 'success', r.detail)
  assert.equal(w.spy.recipesFor + w.spy.craft, 0, 'craft was never called: the carried chest was placed')
  assert.equal(w.spy.placed.length, 1, 'exactly one chest went down')
  assert.equal(w.nameAt(...w.spy.placed[0].split(',').map(Number)), 'chest')
  assert.equal(w.dropped.length, 0, 'nothing dropped at the full chest')
  assert.equal(w.bag.find(i => i.name === 'chest')?.count ?? 0, chestsBefore - 1, 'the carried chest is the one placed')
  const newChest = w.containers.get(w.spy.placed[0])
  const banked = newChest.slots.filter(Boolean).reduce((n, s) => n + s.count, 0)
  assert.ok(banked > 0, 'the retry banked into the NEW chest')
  assert.equal(total(w.bag), before - banked - 1, 'conservation: the bag fell by what was banked plus the chest placed')
  // 4. the row a read can count
  const row = rows('deposit_new_chest').at(-1)
  assert.ok(row, 'a deposit_new_chest row')
  assert.match(row.skill.detail, /^decision=place_carried /)
  assert.match(row.skill.detail, /source=carried/)
  assert.match(row.skill.detail, new RegExp(`bag=${before}->${before - banked - 1}`))
  assert.match(row.skill.detail, /tried=\[5,64,0:full\]/)
  assert.equal(rows('deposit_cursor_rescue').filter(x => x.skill.status === 'success').length > 0, true, 'the cursor rescue ran on the full chest')
})

await t('another container in town WITH ROOM is used before anything is placed', async () => {
  freshPool()
  const w = fakeWorld({ bag: [stack('cobblestone', 64), stack('chest', 1)] })
  w.set(5, 64, 0, 'chest'); w.fill(5, 64, 0)
  w.set(-5, 64, 0, 'barrel')
  const r = await run(w.bot)
  assert.equal(r.status, 'success', r.detail)
  assert.equal(w.spy.placed.length, 0, 'no new chest while a town container has room')
  assert.ok(w.containers.get('-5,64,0').slots.some(Boolean))
})

await t('UNKNOWN capacity defers: a town container that will not open means nothing is built, and the bank closes', async () => {
  freshPool()
  const w = fakeWorld({ bag: [stack('cobblestone', 64), stack('chest', 1)] })
  w.set(5, 64, 0, 'chest'); w.fill(5, 64, 0)
  w.set(-5, 64, 0, 'barrel')
  const open = w.bot.openContainer
  w.bot.openContainer = async b => { if (b.position.x === -5) throw new Error('windowOpen did not fire'); return open(b) }
  const r = await run(w.bot)
  assert.equal(r.status, 'failed'); assert.equal(r.failClass, 'storage_full')
  assert.match(r.detail, /^keep working/)
  assert.equal(w.spy.placed.length, 0)
  assert.ok(bankClosed(w.bot), 'closed after the refusal')
  assert.match(rows('deposit_new_chest').at(-1).skill.detail, /^decision=defer .*unknown=1/)
})

await t('THE CAP: a town at its container limit gets no new chest; the bank closes with a refusal the bot can act on from anywhere', async () => {
  freshPool()
  const w = fakeWorld({ bag: [stack('cobblestone', 64), stack('oak_log', 30), stack('chest', 1)] })
  // Positive control for the advice check below: with the bank open, the room advice names a deposit.
  assert.equal(adviseDeposit(w.bot, w.bot.inventory.items(), []), 'oak_log')
  for (let i = 0; i < MAX_TOWN_CONTAINERS; i++) { const x = -6 + (i % 6) * 2, z = i < 6 ? 6 : -6; w.set(x, 64, z, 'chest'); w.fill(x, 64, z) }
  w.set(5, 64, 0, 'chest'); w.fill(5, 64, 0)
  const r = await run(w.bot)
  assert.equal(r.failClass, 'storage_full')
  assert.match(r.detail, /^keep working; the town is at its chest limit/)
  assert.equal(w.spy.placed.length, 0)
  assert.equal(w.bag.find(i => i.name === 'chest').count, 1, 'the chest stays in the bag')
  const adm = new AdmissionControl().check({ skill: 'deposit', args: {} }, w.bot)
  assert.equal(adm.ok, false); assert.equal(adm.reason, 'bank_closed')
  assert.match(adm.detail, /^keep working/)
  assert.equal(adviseDeposit(w.bot, w.bot.inventory.items(), []), null, 'craft\'s room advice stops naming a deposit while the bank is closed')
})

await t('THE CAP, by time: a second full-chest recovery in the same town inside the interval places nothing', async () => {
  const dir = freshPool()
  const key = chestClaimKey({ x: 0, y: 64, z: 0 })
  assert.equal(claimTownChest({ dir, key, site: { x: 9, y: 64, z: 9 }, containers: 1 }).ok, true)
  const w = fakeWorld({ bag: [stack('cobblestone', 64), stack('chest', 1)] })
  w.set(5, 64, 0, 'chest'); w.fill(5, 64, 0)
  const r = await run(w.bot)
  assert.match(r.detail, /made \d+s ago/)
  assert.equal(w.spy.placed.length, 0)
})

await t('NO CHEST CARRIED and none can be crafted: storage_full, nothing placed, the bank closes -- and the craft\'s own advice is not quoted', async () => {
  freshPool()
  const w = fakeWorld({ bag: [stack('cobblestone', 64)] })
  w.set(5, 64, 0, 'chest'); w.fill(5, 64, 0)
  const r = await run(w.bot)
  assert.equal(r.failClass, 'storage_full')
  assert.ok(w.spy.recipesFor > 0, 'the craft was tried: no chest was carried')
  assert.equal(w.spy.placed.length, 0)
  assert.doesNotMatch(r.detail, /walks home to the town chest/, `no circular "deposit X" remedy inside a deposit refusal: ${r.detail}`)
  assert.ok(bankClosed(w.bot))
})

await t('FAR FROM HOME: never a new chest in a mine', async () => {
  freshPool()
  const w = fakeWorld({ bag: [stack('cobblestone', 64), stack('chest', 1)], at: [101.5, 64, 0.5] })
  w.set(100, 64, 0, 'chest'); w.fill(100, 64, 0)
  const r = await run(w.bot)
  assert.equal(r.failClass, 'storage_full')
  assert.equal(w.spy.placed.length, 0)
  assert.match(rows('deposit_new_chest').at(-1).skill.detail, /^decision=far /)
})

await t('THE LID FILTER: place() with no coordinates never puts a block on a chest, and refuses explicit coordinates there', async () => {
  // A bot boxed in by stone whose ONLY open cell sits on a chest's lid.
  const w = fakeWorld({ bag: [stack('cobblestone', 10)], at: [0.5, 64, 0.5] })
  for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
    if (dx || dz) { w.set(dx, 64, dz, 'stone'); w.set(dx, 65, dz, 'stone') }
  }
  w.set(1, 64, 0, 'air'); w.set(1, 63, 0, 'chest')
  const r = await SKILLS.place.run({ bot: w.bot }, { item: 'cobblestone' }, new AbortController().signal)
  assert.equal(r.status, 'failed', `placed on the lid: ${r.detail}`)
  assert.equal(w.nameAt(1, 64, 0), 'air', 'the lid is still clear')
  const r2 = await SKILLS.place.run({ bot: w.bot }, { item: 'cobblestone', x: 1, y: 64, z: 0 }, new AbortController().signal)
  assert.equal(r2.status, 'failed'); assert.match(r2.detail, /on top of a container/)
  // Control: the same cell with dirt under it is used.
  w.set(1, 63, 0, 'dirt')
  const r3 = await SKILLS.place.run({ bot: w.bot }, { item: 'cobblestone' }, new AbortController().signal)
  assert.equal(r3.status, 'success', r3.detail)
})

await t('closeBank / bankClosed: closes for the given time, then reopens', () => {
  const bot = {}
  closeBank(bot, 'x', 1000, 0)
  assert.equal(bankClosed(bot, 500), 'x')
  assert.equal(bankClosed(bot, 1000), '')
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
