// THE COMPOSTER BUILD ON CRAFTSYNC + CRAFTROOM, end to end: skills.mjs's build_composter -> craftExecutions (the room
// check, craftsync's admission after its baseline resync, its verdict) -> craftsync.mjs -> mineflayer 4.37.1's REAL
// craft.js and inventory.js -> the fake Paper (helpers/fake-paper-craft.mjs), whose slots are the oracle.
//
// The build is ordered when wood is held and the bag has room for the worst case of the chain; it is the thing that
// will free slots, and it does not exist yet. So: never craft into a full bag (the toss), never refuse with a remedy
// that is the composter itself, and never let a pickup during a craft cost the result.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Vec3 } from 'vec3'

process.env.LOG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-test-composter-sync-'))
process.env.SKILL_TIMEOUT_MS = '180000'   // the craft deadline is the skill timeout; the suite's 300 ms leaves none
process.env.HOME_X = '0'; process.env.HOME_Y = '64'; process.env.HOME_Z = '0'   // the fake world's surface
const CS = await import('../src/craftsync.mjs')
const { FakePaper, craftBot, learnAll, fakeWorld, registry, Item } = await import('./helpers/fake-paper-craft.mjs')
const { SKILLS } = await import('../src/skills.mjs')
const C = await import('../src/composter.mjs')
const { depositPlan } = await import('../src/bankable.mjs')
const { formatOutcome } = await import('../src/cognitive.mjs')
const { depositTarget } = await import('../src/craftroom.mjs')

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) }
  catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) }
}
const nameOf = it => registry.items[it.type].name
const key = p => `${Math.floor(p.x)},${Math.floor(p.y)},${Math.floor(p.z)}`

/** `stacks` at the given slots, every other bag slot (9..44) up to `used` a FULL stack of `filler`. */
function bag (stacks, used, filler = 'cobblestone') {
  const inv = { ...stacks }
  for (let s = 9; s <= 44 && Object.keys(inv).length < used; s++) if (!inv[s]) inv[s] = [filler, 64]
  return inv
}

async function town (inv) {
  process.env.POOL_STATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'composter-sync-store-'))
  const server = new FakePaper({ lagClicks: 3, fallbackMs: 60, inventory: inv })
  const bot = craftBot(server)
  const placed = fakeWorld(bot, server)
  // THE HAND: equip remembers what place() asked for, placeBlock puts THAT down (taking it from the server's bag).
  let holding = null
  bot.equip = async item => { holding = item?.name ?? null }
  bot.placeBlock = async (ref, face) => {
    const at = ref.position.offset(face.x, face.y, face.z)
    const i = server.p.findIndex((it, k) => k >= 9 && it && nameOf(it) === holding)
    if (i < 0) throw new Error(`fake world: no ${holding} to place`)
    server.p[i].count--; if (!server.p[i].count) server.p[i] = null
    placed.set(key(at), holding)
    await server.sync()
  }
  bot.username = 'b-Alpha'; bot.players = {}; bot.entities = {}; bot.health = 20; bot.food = 20
  // stand beside the town's canonical site, so the approach is satisfied where the bot is
  const read = (x, y, z) => { const b = bot.blockAt(new Vec3(x, y, z)); return { name: b.name, boundingBox: b.boundingBox } }
  const { site } = C.canonicalComposterSite({ home: new Vec3(0, 64, 0), read })
  assert.ok(site, 'no canonical site in the flat fake world')
  const stand = C.standableBeside(read, site)
  bot.entity.position = new Vec3(stand.x + 0.5, stand.y, stand.z + 0.5)
  await server.sync()
  const rows = []
  CS.installCraftSync(bot, { log: r => rows.push(r) })
  learnAll(bot, server, ['oak_planks', 'oak_slab', 'crafting_table', 'composter'])
  return { server, bot, placed, site, rows }
}
const build = async (bot, server) => {
  const out = await SKILLS.build_composter.run({ bot }, {}, new AbortController().signal)
  await server.settle(); server.stop()
  return out
}
const craftClicks = server => server.writes.filter(w => w.name === 'window_click' && w.params.stateId !== -1).length
const composterAt = (placed, site) => placed.get(`${site.x},${site.y},${site.z}`) === 'composter'

// ------------------------------------------------------------------ the build works through craftsync
await t('BUILD from 3 logs at 30/36 through REAL craftsync: every craft confirmed by the server, the composter placed, nothing dropped', async () => {
  const { server, bot, placed, site, rows } = await town(bag({ 36: ['oak_log', 3] }, 30))
  const out = await build(bot, server)
  assert.equal(out.status, 'success', out.detail)
  assert.ok(composterAt(placed, site), 'no composter at the site')
  assert.deepEqual(server.dropped, [], 'crafted output was thrown on the ground')
  assert.equal(server.count('composter'), 0, 'the composter stayed in the bag')
  assert.ok(rows.length >= 5 && rows.every(r => r.args.confirmed === 'yes'), JSON.stringify(rows.map(r => [r.args.item, r.args.confirmed])))
  assert.deepEqual(rows.map(r => r.args.count), rows.map(() => 1), 'ONE execution per bot.craft (count = crafts there, not items)')
  assert.deepEqual([server.count('oak_slab'), server.count('oak_planks')], [5, 2], '3 logs -> 12 planks -> table + 12 slabs -> composter')
})

// ------------------------------------------------------------------ never into a full bag; never a circular remedy
await t('35/36 from logs: refused BEFORE any craft click (the simulated chain needs 2, 1 is free); the remedy leads and is a deposit that spares the wood', async () => {
  const { server, bot, placed, site } = await town(bag({ 36: ['oak_log', 3] }, 35))
  const out = await build(bot, server)
  assert.equal(out.status, 'no_effect', out.detail)
  assert.equal(craftClicks(server), 0); assert.deepEqual(server.dropped, []); assert.ok(!composterAt(placed, site))
  assert.match(out.detail, /^deposit cobblestone -- it walks home to the town chest/, 'the remedy leads')
  assert.match(out.detail, /Not started: building needs 2 free slots for the craft chain and the bag has 1/)
  assert.match(out.detail, /the town has no composter yet, so composting cannot free them/)
  assert.doesNotMatch(out.detail.split('. Not started')[0], /compost/, 'the remedy names composting')
  assert.ok(formatOutcome('build_composter', out, null).includes('deposit cobblestone'), 'the remedy is cut from the prompt')
})

await t('36/36 from logs: refused before any craft click; with nothing bankable it says honestly that nothing frees a slot here', async () => {
  const { server, bot } = await town(bag({ 36: ['oak_log', 3] }, 36, 'dirt'))
  const out = await build(bot, server)
  assert.equal(out.status, 'no_effect', out.detail); assert.equal(craftClicks(server), 0); assert.deepEqual(server.dropped, [])
  assert.match(out.detail, /^no slot can be freed from here/)
})

await t('C4 34/36 from logs now BUILDS: the chain empties the log stack before its peak (the worst case said 4 and refused)', async () => {
  const { server, bot, placed, site } = await town(bag({ 36: ['oak_log', 3] }, 34))
  const { townBuildPlan } = await import('../src/skills.mjs')
  assert.equal(townBuildPlan(bot).slotsNeeded, 2)
  assert.equal(C.composterBuildPlan({ oak_log: 3 }).slotsNeeded, 4, 'positive control: the counts-only worst case')
  const out = await build(bot, server)
  assert.equal(out.status, 'success', out.detail); assert.ok(composterAt(placed, site)); assert.deepEqual(server.dropped, [])
})

await t('C4 36/36 holding 7 slabs + a carried table: the simulated chain needs NO free slot -- ordered, built, nothing dropped', async () => {
  const { server, bot, placed, site } = await town(bag({ 36: ['oak_slab', 7], 37: ['crafting_table', 1] }, 36))
  const { townBuildPlan } = await import('../src/skills.mjs')
  const plan = townBuildPlan(bot)
  assert.equal(plan.slotsNeeded, 0, JSON.stringify(plan))
  assert.equal(C.townOrder({ now: 1e9, slots: 36, freeSlots: 0, junk: 0, distHome: 0, storageNear: true, composterAtTown: false,
                             buildPlan: plan, myName: 'b-Alpha', peers: [] }).order?.skill, 'build_composter')
  const out = await build(bot, server)
  assert.equal(out.status, 'success', out.detail); assert.ok(composterAt(placed, site)); assert.deepEqual(server.dropped, [])
})

await t('C3 THE REAL DECISION PATH: townOrder orders the build for a roomy bot, never for a full one; full bots then COMPOST', async () => {
  const { townBuildPlan } = await import('../src/skills.mjs')
  const order = (b, composterAtTown, junk = 0) => {
    const used = b.inventory.items().length
    return C.townOrder({ now: 1e9, slots: used, freeSlots: 36 - used, junk, distHome: 0, storageNear: true, composterAtTown,
                         composterRipe: false, room: used < 36, buildPlan: townBuildPlan(b), myName: 'b-Alpha', peers: [] }).order?.skill
  }
  const roomy = await town(bag({ 36: ['oak_log', 3] }, 20)); roomy.server.stop()
  const full = await town(bag({ 36: ['oak_log', 3], 37: ['leaf_litter', 64] }, 36)); full.server.stop()
  assert.equal(order(roomy.bot, false), 'build_composter', 'a roomy bot with wood builds')
  assert.equal(order(full.bot, false), undefined, 'a full bot is never sent to build (it would be refused)')
  assert.equal(order(full.bot, true, 64), 'compost', 'once the town has a composter, the full bot composts')
})

await t('COMPOSED CHAIN (the skill called directly -- production reaches this refusal only if the bag filled between the order and the run): its remedy is executable and spares the wood, and repeating it brings the order back', async () => {
  const { server, bot, placed, site } = await town(bag({ 36: ['oak_log', 3] }, 36))
  const { townBuildPlan } = await import('../src/skills.mjs')
  const ordered = () => {
    const free = 36 - bot.inventory.items().length
    return C.townOrder({ now: 1e9, slots: 36 - free, freeSlots: free, junk: 0, distHome: 0, storageNear: true,
                         composterAtTown: false, buildPlan: townBuildPlan(bot), myName: 'b-Alpha', peers: [] }).order?.skill
  }
  assert.equal(ordered(), undefined, 'positive control: at 36/36 the town order is not issued')
  let rounds = 0
  while (ordered() !== 'build_composter') {
    assert.ok(++rounds <= 4, 'the remedy never made room')
    const refused = await SKILLS.build_composter.run({ bot }, {}, new AbortController().signal)
    assert.equal(refused.status, 'no_effect', refused.detail)
    const item = /^deposit (\w+) -- it walks home/.exec(refused.detail)?.[1]
    assert.equal(item, 'cobblestone', `round ${rounds}: the remedy must lead with a deposit that spares the wood: ${refused.detail}`)
    // THE REMEDY, as deposit(<item>) runs its plan: stacks in slot order, min(left, stack) from each (the chest walk is not modelled)
    for (const { name, count } of depositPlan(bot.inventory.items(), item, { wants: [] })) {
      let left = count
      for (let s = 9; s <= 44 && left > 0; s++) {
        const it = server.p[s]; if (!it || nameOf(it) !== name) continue
        const n = Math.min(left, it.count); it.count -= n; left -= n; if (!it.count) server.p[s] = null
      }
    }
    await server.sync()
    assert.equal(server.count('oak_log'), 3, 'the advised deposit took the wood the build needs')
  }
  assert.equal(rounds, 2, 'one stack per deposit visit: 0 free -> 2 free')
  const out = await build(bot, server)
  assert.equal(out.status, 'success', out.detail); assert.ok(composterAt(placed, site)); assert.deepEqual(server.dropped, [])
})

// ------------------------------------------------------------------ a pickup during the build
/** Every empty bag slot fills (a burst of pickups) at the n-th close_window(0) once `when()` holds. */
function burstAt (server, when, nth = 1) {
  const receive = server.receive.bind(server)
  let seen = 0, done = false
  server.receive = (name, params) => {
    if (!done && name === 'close_window' && params.windowId === 0 && when() && ++seen === nth) {
      done = true
      for (let s = 9; s <= 44; s++) {
        if (server.p[s]) continue
        server.p[s] = new Item(registry.itemsByName.dirt.id, 64)
        server.sid[0]++
        server.send([['set_slot', { windowId: 0, stateId: server.sid[0], slot: s, item: Item.toNotch(server.p[s]) }]])
      }
    }
    return receive(name, params)
  }
  return () => done
}

await t('PICKUPS DURING THE COMPOSTER CRAFT\'S BASELINE: craftsync\'s admission refuses -> composter_no_room, no click, nothing dropped', async () => {
  const { server, bot, placed, site, rows } = await town(bag({ 36: ['oak_log', 3] }, 30))
  // the 2nd close_window(0) once 12 slabs exist: the 1st is the last slab craft's after-resync, the 2nd the composter's baseline
  const fired = burstAt(server, () => server.count('oak_slab') >= 12, 2)
  const out = await build(bot, server)
  assert.ok(fired(), 'the burst never happened')
  assert.equal(out.status, 'failed'); assert.equal(out.failClass, 'composter_no_room', out.detail)
  assert.match(out.detail, /not built yet, so composting cannot free the slot/)
  assert.match(formatOutcome('build_composter', out, null), /^build_composter -> failed: (deposit \w+|place \w+|eat|no slot can be freed from here) -- /,
    `the refusal's remedy does not lead the prompt line: ${out.detail}`)
  assert.deepEqual(server.dropped, [], 'a crafted item was thrown on the ground')
  assert.equal(server.count('composter'), 0); assert.ok(!composterAt(placed, site))
  assert.deepEqual(rows.at(-1).args.outcome, 'refused'); assert.equal(rows.at(-1).args.stop, 'admission: no_room_after_resync')
  assert.equal(C.townOrderOutcome('build_composter', out.status, 0, {}, out.failClass).buildBackoffUntil > 0, true, 'a refused build backs off')
})

await t('PICKUPS BETWEEN TWO CRAFTS: the pre-execution room check refuses the composter craft -> composter_no_room, nothing clicked for it', async () => {
  const { server, bot, rows } = await town(bag({ 36: ['oak_log', 3] }, 30))
  const fired = burstAt(server, () => server.count('oak_slab') >= 12, 1)   // during the last slab craft's after-resync
  const out = await build(bot, server)
  assert.ok(fired(), 'the burst never happened')
  assert.equal(out.failClass, 'composter_no_room', out.detail); assert.match(out.detail, /No room for composter/)
  assert.deepEqual(server.dropped, [])
  assert.match(formatOutcome('build_composter', out, null), /^build_composter -> failed: (deposit \w+|place \w+|eat|no slot can be freed from here) -- /)
  // C1: THE CHAIN IS PROTECTED. With only the composter step's own ingredient kept, the advice WOULD bank the chain's planks.
  const items = bot.inventory.items()
  const unprotected = depositTarget(items, depositPlan(items, null, { wants: [] }), [{ name: 'oak_slab' }])
  assert.ok(['oak_planks', 'oak_log'].includes(unprotected), `positive control: the step-only target is ${unprotected}`)
  assert.doesNotMatch(out.detail, /deposit (oak_planks|oak_log|oak_slab)\b/, 'advised depositing the chain\'s own wood')
  assert.ok(!rows.some(r => r.args.item === 'composter'), 'craftsync was entered for the composter')
})

await t('#4 SCENE 2c: pickups fill the bag on the planks craft\'s result click -> the planks are tossed (the known limit) and it is filed composter_no_room, not composter_craft', async () => {
  const { server, bot } = await town(bag({ 36: ['oak_log', 3] }, 30))
  const receive = server.receive.bind(server)
  let fired = false
  server.receive = (name, params) => {
    if (!fired && name === 'window_click' && params.slot === 0 && params.stateId !== -1 && server.count('oak_planks') === 0) {
      fired = true
      for (let s = 9; s <= 44; s++) {
        if (server.p[s]) continue
        server.p[s] = new Item(registry.itemsByName.dirt.id, 64); server.sid[0]++
        server.send([['set_slot', { windowId: 0, stateId: server.sid[0], slot: s, item: Item.toNotch(server.p[s]) }]])
      }
    }
    return receive(name, params)
  }
  const out = await build(bot, server)
  assert.ok(fired, 'the burst never happened')
  assert.deepEqual(server.dropped.map(nameOf), ['oak_planks'], 'positive control: the planks were tossed (craftsync can only detect this)')
  assert.equal(out.failClass, 'composter_no_room', out.detail)
  assert.ok(C.townOrderOutcome('build_composter', out.status, 0, {}, out.failClass).buildBackoffUntil === C.BUILD_NO_ROOM_BACKOFF_MS, 'not the room family\'s backoff')
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
