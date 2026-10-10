// BAMBOO -> STICKS (bamboo.mjs + skills.mjs bamboo_sticks). The pure decisions on the worked cases both engines agreed,
// then the order through skills.mjs -> craftroom's executor -> REAL craftsync -> mineflayer 4.37.1's craft.js and
// inventory.js -> the fake Paper (helpers/fake-paper-craft.mjs), whose slots are the oracle.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

process.env.LOG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-test-bamboo-'))
process.env.SKILL_TIMEOUT_MS = '180000'   // the craft deadline is the skill timeout; the suite's 300 ms leaves none
process.env.STATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-test-bamboo-state-'))
const B = await import('../src/bamboo.mjs')
const CS = await import('../src/craftsync.mjs')
const { FakePaper, craftBot, learnAll, registry, Item } = await import('./helpers/fake-paper-craft.mjs')
const { SKILLS, SKILL_CONTRACTS } = await import('../src/skills.mjs')
const { evidenceScope } = await import('../src/cognitive.mjs')
const { isHousekeeping } = await import('../src/hygiene.mjs')
const { createRequire } = await import('node:module')
const { Recipe } = createRequire(import.meta.url)('prismarine-recipe')('1.21.8')

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) }
  catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) }
}
const S = (name, count) => ({ name, count })
const fill = (n, name = 'cobblestone') => Array.from({ length: n }, () => S(name, 64))

// ------------------------------------------------------------------ bambooPlan: the worked cases
await t('bamboo [64] + sticks [32] at 36/36 -> 32 crafts free 1 slot (the bamboo stack empties, the sticks top up to 64)', () => {
  const p = B.bambooPlan([S('bamboo', 64), S('stick', 32), ...fill(34)])
  assert.deepEqual([p.crafts, p.freed, p.after], [32, 1, 35])
})
await t('bamboo [64] with NO sticks -> nothing frees (the bamboo slot becomes the sticks\' slot): do nothing', () => {
  const p = B.bambooPlan([S('bamboo', 64), ...fill(35)])
  assert.deepEqual([p.crafts, p.freed], [0, 0])
  assert.match(p.why, /would need 1 more slot/, 'at 36/36 the first stick has no slot at all (the real fold would throw it)')
  const roomy = B.bambooPlan([S('bamboo', 64), ...fill(34)])
  assert.equal(roomy.crafts, 0); assert.match(roomy.why, /no batch .* frees a slot/, 'at 35/36: the bamboo slot becomes the sticks\' slot')
})
await t('bamboo [64,64] with no sticks -> 64 crafts free 1, but need a temporary slot: refused at 36/36, planned at 35/36', () => {
  const full = B.bambooPlan([S('bamboo', 64), S('bamboo', 64), ...fill(34)])
  assert.equal(full.crafts, 0); assert.match(full.why, /would need 1 more slot/)
  const roomy = B.bambooPlan([S('bamboo', 64), S('bamboo', 64), ...fill(33)])
  assert.deepEqual([roomy.crafts, roomy.freed, roomy.peak], [64, 1, 36])
})
await t('bamboo [63] + sticks [32] -> 31 crafts leave 1 bamboo: frees 0; an odd remainder never empties a stack', () => {
  assert.deepEqual([B.bambooPlan([S('bamboo', 63), S('stick', 32), ...fill(34)]).crafts], [0])
  assert.equal(B.bambooPlan([S('bamboo', 1), S('stick', 10), ...fill(34)]).crafts, 0, 'one bamboo makes nothing')
})
await t('the SMALLEST batch that frees a slot: bamboo [10] + sticks [32] -> 5 crafts', () => {
  const p = B.bambooPlan([S('bamboo', 10), S('stick', 32), ...fill(34)])
  assert.deepEqual([p.crafts, p.freed], [5, 1])
})
await t('STICK CAP: no fold past 64 sticks that needs a NEW stick slot -- bamboo [64,64] + sticks [60] at 35/36', () => {
  const bag = [S('bamboo', 64), S('bamboo', 64), S('stick', 60), ...fill(32)]
  assert.equal(B.bambooPlan(bag).crafts, 0, 'folded past the cap into a new stick slot')
  const uncapped = B.bambooPlan(bag, { stickCap: 1000 })
  assert.deepEqual([uncapped.crafts, uncapped.freed], [64, 1], 'positive control: without the cap the same bag would fold')
  assert.equal(B.bambooPlan([S('bamboo', 64), S('stick', 64), ...fill(34)]).crafts, 0, 'a full stick stack and nowhere to top up')
})
await t('PAST THE CAP ONLY TO TOP UP (#6): sticks [64,30] + bamboo [10] -> 5 crafts, no new stick slot', () => {
  const p = B.bambooPlan([S('stick', 64), S('stick', 30), S('bamboo', 10), ...fill(33)])
  assert.deepEqual([p.crafts, p.freed], [5, 1])
})
await t('SPLIT STACKS (#2): the put-away consolidates -- bamboo [64,10] + sticks [32] at 36/36 frees a slot in 5 crafts, either order', () => {
  for (const bag of [[S('bamboo', 64), S('bamboo', 10), S('stick', 32), ...fill(33)], [S('bamboo', 10), S('bamboo', 64), S('stick', 32), ...fill(33)]]) {
    const p = B.bambooPlan(bag)
    assert.deepEqual([p.crafts, p.freed], [5, 1], JSON.stringify(bag.slice(0, 2)))
  }
  const sim = B.simulateFold([S('bamboo', 64, 9), S('bamboo', 10, 10), S('stick', 32, 11)], 5)
  assert.deepEqual([sim.after, sim.tossed], [2, 0], 'the 64 is picked up first; its leftover tops the 10 up to 64 and the rest goes back')
})
await t('the PLAN AGREES WITH THE EXECUTOR: a fold the slot-order simulation accepts but whose first execution craftRoom refuses is not ordered (it would only fail and back off)', () => {
  // bamboo 1 + 1 ahead of a 57 at 36/36: as the bot runs it, the two singles empty and the stick takes one of their
  // slots -- but craftroom's executor checks each execution with craftRoom (the largest stack first), which predicts
  // no room for the first stick and refuses. Ordering it would buy a bamboo_no_room and a 30-minute backoff.
  const bag = [...fill(1), S('bamboo', 1, 10), S('bamboo', 1, 11), ...Array.from({ length: 17 }, (_, i) => S('cobblestone', 64, 12 + i)),
               S('bamboo', 57, 29), ...Array.from({ length: 15 }, (_, i) => S('cobblestone', 64, 30 + i))]
  bag[0].slot = 9
  assert.equal(bag.length, 36)
  const sim = B.simulateFold(bag, 1)
  assert.deepEqual([sim.after, sim.tossed], [35, 0], 'positive control: as the bot runs it, one craft frees a slot')
  assert.equal(B.bambooPlan(bag).crafts, 0, 'ordered a fold the executor would refuse')
})

await t('the GATE (#1): the rest of the batch must still free a slot and keep to the cap on the bag as it is NOW', () => {
  assert.equal(B.bambooGate([S('bamboo', 2), S('stick', 63), ...fill(34)], 1), null, 'positive control: as planned it frees')
  assert.equal(B.bambooGate([S('bamboo', 2), S('stick', 64), ...fill(34)], 1).reason, 'gate_no_longer_frees', 'a stick arrived: 65 sticks, nothing freed')
  assert.equal(B.bambooGate([S('bamboo', 1), S('stick', 10), ...fill(34)], 1).reason, 'gate_short')
})
await t('BELOW 34 SLOTS nothing is planned, whatever the bamboo', () => {
  assert.equal(B.bambooPlan([S('bamboo', 64), S('stick', 32), ...fill(31)]).crafts, 0)
  assert.equal(B.bambooPlan([S('bamboo', 64), S('stick', 32), ...fill(32)]).crafts, 32, 'positive control: at 34 it is')
})

// ------------------------------------------------------------------ the recipe and the order
await t('bambooStickRecipe picks the bamboo recipe -- never a planks one -- from the 13 real 1.21.8 stick recipes', () => {
  const rs = Recipe.find(registry.itemsByName.stick.id)
  assert.equal(rs.length, 13)
  const r = B.bambooStickRecipe(rs, registry)
  assert.deepEqual(r.delta.filter(d => d.count < 0).map(d => [registry.items[d.id].name, -d.count]), [['bamboo', 2]])
  assert.notEqual(rs[0], r, 'positive control: the first stick recipe is NOT the bamboo one')
  assert.equal(B.bambooStickRecipe(rs.filter(x => x !== r), registry), null)
})
await t('bambooOrder: issued at 34+ with a freeing batch; never below 34, inside the cooldown, or in a backoff; the cooldown is charged when issued', () => {
  const NOW = 1e9
  const bag = [S('bamboo', 64), S('stick', 32), ...fill(34)]
  const o = B.bambooOrder({ items: bag, now: NOW })
  assert.equal(o.order?.skill, 'bamboo_sticks'); assert.equal(o.lastAt, NOW)
  assert.equal(B.bambooOrder({ items: [S('bamboo', 64), S('stick', 32), ...fill(31)], now: NOW }).order, null, 'below 34')
  assert.equal(B.bambooOrder({ items: bag, now: NOW, lastAt: NOW - B.BAMBOO_COOLDOWN_MS + 1 }).order, null, 'cooldown')
  assert.equal(B.bambooOrder({ items: bag, now: NOW, backoffUntil: NOW + 1 }).order, null, 'backoff')
  assert.equal(B.bambooOrderOutcome('failed', NOW), NOW + B.BAMBOO_BACKOFF_MS)
  for (const s of ['success', 'no_effect', 'aborted']) assert.equal(B.bambooOrderOutcome(s, NOW), 0, s)
})
await t('registered chatOnly, housekeeping, with a freed-slot contract; its failure classes never vote', () => {
  assert.equal(SKILLS.bamboo_sticks?.chatOnly, true); assert.ok(isHousekeeping('bamboo_sticks'))
  assert.deepEqual(SKILL_CONTRACTS.bamboo_sticks.expects, ['slots_freed'])
  for (const fc of ['bamboo_no_room', 'bamboo_craft']) assert.equal(evidenceScope(fc), null, fc)
})

await t('PRECEDENCE (firstOrder): the milestone work order, then wear_out, then bamboo -- a later step is never asked once one issued', () => {
  const asked = []
  const step = (name, out) => () => { asked.push(name); return out }
  assert.equal(B.firstOrder({ skill: 'gather' }, step('wear', { skill: 'wear_out' }), step('bamboo', { skill: 'bamboo_sticks' })).skill, 'gather')
  assert.deepEqual(asked, [], 'a housekeeping step was asked under a milestone order')
  assert.equal(B.firstOrder(null, step('wear', { skill: 'wear_out' }), step('bamboo', { skill: 'bamboo_sticks' })).skill, 'wear_out')
  assert.deepEqual(asked, ['wear'], 'bamboo was asked (and its cooldown charged) although wear_out issued')
  assert.equal(B.firstOrder(null, step('wear', null), step('bamboo', { skill: 'bamboo_sticks' })).skill, 'bamboo_sticks')
  assert.equal(B.firstOrder(null, step('wear', null), step('bamboo', null)), null)
})

await t('THE STEPS (CognitiveLoop): bambooOrderStep charges its cooldown only when it issues, and respects it and the backoff', async () => {
  const { CognitiveLoop } = await import('../src/cognitive.mjs')
  const full = [S('bamboo', 64), S('stick', 32), ...fill(34)]
  const me = { bot: { inventory: { items: () => full } }, lastBambooAt: 0, bambooBackoffUntil: 0 }
  const o = CognitiveLoop.prototype.bambooOrderStep.call(me)
  assert.equal(o?.skill, 'bamboo_sticks'); assert.ok(me.lastBambooAt > 0, 'issued without charging the cooldown')
  assert.equal(CognitiveLoop.prototype.bambooOrderStep.call(me), null, 'issued again inside the cooldown')
  const idle = { bot: { inventory: { items: () => fill(20) } }, lastBambooAt: 0, bambooBackoffUntil: 0 }
  assert.equal(CognitiveLoop.prototype.bambooOrderStep.call(idle), null); assert.equal(idle.lastBambooAt, 0, 'charged for nothing')
  const backed = { bot: { inventory: { items: () => full } }, lastBambooAt: 0, bambooBackoffUntil: Date.now() + 60_000 }
  assert.equal(CognitiveLoop.prototype.bambooOrderStep.call(backed), null, 'issued during a backoff')
})

await t('WIRED (structural): the decision chain is firstOrder(order, wear_out step, bamboo step), and a failed fold backs off', () => {
  const src = fs.readFileSync(new URL('../src/cognitive.mjs', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter(l => !l.trim().startsWith('//')).join('\n')
  assert.match(src, /order = firstOrder\(order, \(\) => this\.wearOutOrderStep\(\), \(\) => this\.bambooOrderStep\(\)\)/)
  assert.ok(src.indexOf('order = firstOrder(order,') < src.indexOf('const r = townOrder({'), 'the town orders come after')
  assert.match(src, /if \(admitted\.skill === 'bamboo_sticks'\) this\.bambooBackoffUntil = bambooOrderOutcome\(r\.status, Date\.now\(\)\)/)
})

// ------------------------------------------------------------------ through REAL craftsync + fake Paper
const nameOf = it => registry.items[it.type].name
function bag (stacks, used, filler = 'dirt') {
  const inv = { ...stacks }
  for (let s = 9; s <= 44 && Object.keys(inv).length < used; s++) if (!inv[s]) inv[s] = [filler, 64]
  return inv
}
async function setup (inv, opts = {}) {
  const server = new FakePaper({ lagClicks: 3, fallbackMs: 60, inventory: inv })
  const bot = craftBot(server)
  bot.entities = {}; bot.health = 20; bot.food = 20
  await server.sync()
  const rows = []
  CS.installCraftSync(bot, { log: r => rows.push(r), ...opts })
  learnAll(bot, server, ['stick'])
  return { server, bot, rows }
}
const fold = async (bot, server) => {
  const out = await SKILLS.bamboo_sticks.run({ bot }, {}, new AbortController().signal)
  await server.settle(); server.stop()
  return out
}
const craftClicks = server => server.writes.filter(w => w.name === 'window_click' && w.params.stateId !== -1).length
const used = server => server.p.slice(9, 45).filter(Boolean).length
const LOG = () => path.join(process.env.LOG_DIR, `skill-${process.env.BOT_NAME ?? 'TestBot'}.jsonl`)
const rowsOf = kind => {
  try { return fs.readFileSync(fs.readdirSync(process.env.LOG_DIR).map(f => path.join(process.env.LOG_DIR, f)).find(f => /^skill-/.test(path.basename(f))) ?? LOG(), 'utf8')
    .trim().split('\n').map(l => JSON.parse(l)).filter(r => r.skill?.name === kind) } catch { return [] }
}

await t('PLANKS UNTOUCHED: bamboo [64] + sticks [32] + oak_planks [10] at 36/36 -> 32 crafts verified by the server, 1 slot freed, planks 10 -> 10', async () => {
  const { server, bot, rows } = await setup(bag({ 36: ['bamboo', 64], 37: ['stick', 32], 38: ['oak_planks', 10] }, 36))
  assert.equal(used(server), 36)
  const out = await fold(bot, server)
  assert.equal(out.status, 'success', out.detail)
  assert.deepEqual([server.count('bamboo'), server.count('stick'), server.count('oak_planks')], [0, 64, 10])
  assert.equal(used(server), 35, 'no slot freed'); assert.deepEqual(server.dropped, [])
  assert.ok(rows.length === 32 && rows.every(r => r.args.confirmed === 'yes'), `${rows.length} craftsync rows`)
  await new Promise(r => setTimeout(r, 100))
  const row = rowsOf('_bamboo_sticks').at(-1)?.skill?.detail ?? ''
  assert.match(row, /^bamboo=64->0 sticks=32->64 planks=10->10 slots=36->35 crafts=32\/32 freed=1/, row)
})

await t('REFUSED AT 36/36 when the output needs a new slot (bamboo [64,64], no sticks): no click, nothing spent', async () => {
  const { server, bot } = await setup(bag({ 36: ['bamboo', 64], 37: ['bamboo', 64] }, 36))
  const out = await fold(bot, server)
  assert.equal(out.status, 'no_effect', out.detail); assert.match(out.detail, /need 1 more slot/)
  assert.equal(craftClicks(server), 0); assert.equal(server.count('bamboo'), 128); assert.deepEqual(server.dropped, [])
})

await t('STICK CAP through the skill: bamboo [64] + sticks [40] at 36/36 -> nothing crafted', async () => {
  const { server, bot } = await setup(bag({ 36: ['bamboo', 64], 37: ['stick', 40] }, 36))
  const out = await fold(bot, server)
  assert.equal(out.status, 'no_effect'); assert.equal(craftClicks(server), 0); assert.equal(server.count('stick'), 40)
})

await t('THE CHAIN WITH A PICKUP RACE: at 35/36 the first stick needs the last slot; pickups fill it during craftsync\'s baseline -> the gate refuses at admission (a skip), nothing dropped', async () => {
  const { server, bot, rows } = await setup(bag({ 36: ['bamboo', 64], 37: ['bamboo', 64] }, 35))
  const receive = server.receive.bind(server)
  let fired = false
  server.receive = (name, params) => {
    if (!fired && name === 'close_window' && params.windowId === 0) {
      fired = true
      for (let s = 9; s <= 44; s++) {
        if (server.p[s]) continue
        server.p[s] = new Item(registry.itemsByName.dirt.id, 64); server.sid[0]++
        server.send([['set_slot', { windowId: 0, stateId: server.sid[0], slot: s, item: Item.toNotch(server.p[s]) }]])
      }
    }
    return receive(name, params)
  }
  const out = await fold(bot, server)
  assert.ok(fired, 'the pickup never happened')
  // the bag filled under the fold: the gate (asked first in craftsync's admission, on the resynced bag) sees the first
  // stick would be thrown -- a skip with the 2-minute cooldown, like any change of the bag under the batch
  assert.equal(out.status, 'no_effect', out.detail); assert.equal(B.bambooOrderOutcome(out.status, 0), 0)
  assert.equal(craftClicks(server), 0, 'a craft click went out after the admission refused')
  assert.deepEqual(server.dropped, []); assert.equal(server.count('bamboo'), 128); assert.equal(server.count('stick'), 0)
  assert.deepEqual(rows.map(r => [r.args.outcome, r.args.stop]), [['refused', 'admission: gate_no_room']])
})

const rowAt = () => rowsOf('_bamboo_sticks').at(-1)?.skill

await t('#6 an executor failure that would VOTE (a window error -> no_path) is filed bamboo_craft, which does not', async () => {
  const { server, bot } = await setup(bag({ 36: ['bamboo', 64], 37: ['stick', 32] }, 36))
  bot.craft = async () => { throw new Error('Event windowOpen did not fire within timeout of 20000ms') }
  delete bot.craftSync
  const out = await fold(bot, server)
  assert.equal(out.status, 'failed'); assert.equal(out.failClass, 'bamboo_craft', out.detail)
  assert.equal(evidenceScope(out.failClass), null)
  assert.equal(evidenceScope('no_path'), 'action', 'positive control: the executor\'s own class here would vote')
})

await t('#1 CODEX: 36 slots, bamboo x2, sticks x63; a stick arrives during the baseline -> the gate refuses on the resynced bag: no 65th stick, a skip', async () => {
  const { server, bot, rows } = await setup(bag({ 36: ['bamboo', 2], 37: ['stick', 63] }, 36))
  assert.equal(B.bambooPlan(bot.inventory.items()).crafts, 1, 'positive control: as planned, 1 craft frees the bamboo slot')
  const receive = server.receive.bind(server)
  let fired = false
  server.receive = (name, params) => {
    if (!fired && name === 'close_window' && params.windowId === 0) {
      fired = true
      server.p[37].count = 64; server.sid[0]++
      server.send([['set_slot', { windowId: 0, stateId: server.sid[0], slot: 37, item: Item.toNotch(server.p[37]) }]])
    }
    return receive(name, params)
  }
  const out = await fold(bot, server)
  assert.ok(fired)
  assert.equal(out.status, 'no_effect', out.detail); assert.equal(B.bambooOrderOutcome(out.status, 0), 0, 'a skip must not back off')
  assert.deepEqual([server.count('stick'), server.count('bamboo')], [64, 2], 'crafted the 65th stick')
  assert.equal(craftClicks(server), 0); assert.deepEqual(server.dropped, [])
  assert.deepEqual(rows.map(r => [r.args.outcome, r.args.stop]), [['refused', 'admission: gate_no_longer_frees']])
  await new Promise(r => setTimeout(r, 100))
  assert.equal(rowAt()?.args?.stop, 'gate_no_longer_frees')
})

await t('#2 SPLIT STACKS through REAL craftsync: bamboo [64,10] + sticks [32] at 36/36 -> 5 crafts, 35/36, nothing dropped', async () => {
  const { server, bot, rows } = await setup(bag({ 36: ['bamboo', 64], 37: ['bamboo', 10], 38: ['stick', 32] }, 36))
  const out = await fold(bot, server)
  assert.equal(out.status, 'success', out.detail)
  assert.equal(used(server), 35); assert.deepEqual([server.count('bamboo'), server.count('stick')], [64, 37]); assert.deepEqual(server.dropped, [])
  assert.equal(rows.length, 5)
})

await t('#3 a PICKUP HOLD-BACK at 36/36 is a skip (no_effect, 2-min cooldown), its row stop=pickup_pending, never stop=no_room', async () => {
  const { server, bot } = await setup(bag({ 36: ['bamboo', 64], 37: ['stick', 32] }, 36))
  const { Vec3 } = await import('vec3')
  bot.entities[9] = { id: 9, name: 'item', position: new Vec3(1.5, 64, 0.5), getDroppedItem: () => ({ name: 'dirt', count: 1 }) }
  const out = await fold(bot, server)
  assert.equal(out.status, 'no_effect', out.detail); assert.equal(B.bambooOrderOutcome(out.status, 0), 0)
  assert.equal(craftClicks(server), 0)
  await new Promise(r => setTimeout(r, 100))
  assert.equal(rowAt()?.args?.stop, 'pickup_pending')
})

await t('#5 the row is written in a FINALLY with durationMs and structured args -- an abort leaves one too', async () => {
  const { server, bot } = await setup(bag({ 36: ['bamboo', 64], 37: ['stick', 32] }, 36))
  const ac = new AbortController(); ac.abort()
  await assert.rejects(SKILLS.bamboo_sticks.run({ bot }, {}, ac.signal), e => e?.aborted === true)
  await server.settle(); server.stop()
  await new Promise(r => setTimeout(r, 100))
  const row = rowAt()
  assert.equal(row?.args?.stop, 'aborted')
  assert.equal(row?.status, 'aborted', 'the row must file an abort as aborted, not failed')
  for (const k of ['b0', 'b1', 's0', 's1', 'p0', 'p1', 'o0', 'o1', 'crafts', 'planned', 'freed', 'stop']) assert.ok(k in (row?.args ?? {}), `args.${k} missing`)
  assert.equal(typeof row?.duration_ms, 'number')
})

// ------------------------------------------------------------------ sandbox 10-04: the stuck watchdog, the tally, the outcome
const { stuckDecision } = await import('../src/reflex.mjs')
const { Runner } = await import('../src/runner.mjs')
const { classifyOutcome, DURABLE_EVIDENCE } = await import('../src/skills.mjs')

await t('2a foldWindow: crafts x 1.3 s + 5 s, capped at 90 s and at the time left; a batch that cannot finish does not fit', () => {
  assert.deepEqual(B.foldWindow(32), { ms: 46_600, fits: true, maxCrafts: 65 })
  assert.equal(B.foldWindow(64).fits, true, '64 crafts: 88.2 s, inside the 90 s cap')
  assert.deepEqual(B.foldWindow(70), { ms: 90_000, fits: false, maxCrafts: 65 })
  assert.deepEqual(B.foldWindow(32, { leftMs: 20_000 }), { ms: 20_000, fits: false, maxCrafts: 11 }, 'never past the skill deadline')
  assert.equal(B.foldWindow(0).fits, false)
})

await t('2a a 32-CRAFT FOLD COMPLETES under a stuck watchdog far shorter than the fold (the window is declared, then cleared)', async () => {
  const { server, bot } = await setup(bag({ 36: ['bamboo', 64], 37: ['stick', 32] }, 36))
  const ac = new AbortController()
  const stuckMs = 1000                                 // the fleet's 20 s against ~1.1 s/craft, scaled to the fake's pace
  const t0 = Date.now()
  let fired = false, wouldFire = false, sawWindow = false
  const tick = setInterval(() => {                    // reflex.mjs's own decision, as its loop asks it: busy, never moved
    const now = Date.now()
    if (Number(bot.stationaryUntil) > now) sawWindow = true
    if (stuckDecision({ busy: true, stationaryUntil: 0, now, stillSince: t0, stuckMs }).fire) wouldFire = true
    if (stuckDecision({ busy: true, stationaryUntil: bot.stationaryUntil, now, stillSince: t0, stuckMs }).fire && !fired) { fired = true; ac.abort() }
  }, 50)
  let out
  try { out = await SKILLS.bamboo_sticks.run({ bot }, {}, ac.signal) } finally { clearInterval(tick) }
  await server.settle(); server.stop()
  assert.ok(Date.now() - t0 > 2 * stuckMs, 'the fold was quicker than the watchdog: this proves nothing')
  assert.ok(wouldFire, 'POSITIVE CONTROL: without the window the watchdog would have cut this fold')
  assert.ok(sawWindow, 'no window was declared')
  assert.equal(fired, false, 'the watchdog cut the fold inside its declared window')
  assert.equal(out.status, 'success', out.detail)
  assert.deepEqual([server.count('bamboo'), server.count('stick'), used(server)], [0, 64, 35])
  assert.equal(bot.stationaryUntil, 0, 'the window must be cleared when the fold ends')
})

await t('2a a batch that cannot finish inside its window is refused before any click (stop=too_long)', async () => {
  const { server, bot } = await setup(bag({ 36: ['bamboo', 64], 37: ['stick', 32] }, 36))
  const out = await SKILLS.bamboo_sticks.run({ bot, runner: { current: { startedAt: Date.now() - 170_000 } } }, {}, new AbortController().signal)
  await server.settle(); server.stop()
  assert.equal(out.status, 'no_effect', out.detail); assert.match(out.detail, /cannot finish inside/)
  assert.equal(craftClicks(server), 0); assert.equal(server.count('bamboo'), 64)
  assert.equal(bot.stationaryUntil ?? 0, 0)
})

await t('2a A FOLD SLOWER THAN ITS PLAN STOPS AT ITS WINDOW (the exemption never outlives the work); what it made stays', async () => {
  // 5 crafts -> an 11.5 s window. craftsync's quiet wait at 600 ms makes each craft ~6 s, so the fold cannot finish
  // inside it: it must stop at the window (its deadline), not run on un-exempt to the skill's 180 s deadline.
  const { server, bot } = await setup(bag({ 36: ['bamboo', 64], 37: ['bamboo', 10], 38: ['stick', 32] }, 36), { quietMs: 600 })
  const t0 = Date.now()
  const out = await SKILLS.bamboo_sticks.run({ bot }, {}, new AbortController().signal)
  const ms = Date.now() - t0
  await server.settle(); server.stop()
  await new Promise(r => setTimeout(r, 100))
  const row = rowsOf('_bamboo_sticks').at(-1)?.skill
  assert.ok(ms < B.foldWindow(5).ms + 2000, `the fold ran ${ms} ms, past its ${B.foldWindow(5).ms} ms window`)
  assert.ok(row?.args?.crafts >= 1 && row.args.crafts < 5, `crafts=${row?.args?.crafts}: the slowed fold should stop part-way`)
  // the tally is SERVER-VERIFIED crafts; a craft the deadline cut before its verification resync is made but unverified
  assert.ok(row.args.crafts <= server.count('stick') - 32, `row crafts=${row.args.crafts} > server +${server.count('stick') - 32}`)
  assert.equal(row.args.s1 - row.args.s0, server.count('stick') - 32, 'what it made stays, and the row\'s bag says so')
  assert.notEqual(out.status, 'success')
  assert.equal(bot.stationaryUntil, 0)
})

await t('2c an execution that ENDS IN AN ERROR after the server confirmed its craft (a deadline) still counts', async () => {
  // Deterministic: the 3rd execution's real craft runs, then craftsync's answer is replaced by the deadline error it
  // gives when the deadline lands after the verification was answered (produced=1, authoritative).
  const { server, bot } = await setup(bag({ 36: ['bamboo', 64], 37: ['bamboo', 10], 38: ['stick', 32] }, 36))
  const real = bot.craft
  let n = 0
  bot.craft = async (...a) => {
    const got = await real(...a)
    if (++n === 3) throw new CS.CraftSyncError('craft stopped at the deadline: 1 of 1 made', { failClass: 'craft_deadline', produced: 1, requested: 1, reason: 'deadline', authoritative: true })
    return got
  }
  const out = await fold(bot, server)
  await new Promise(r => setTimeout(r, 100))
  const row = rowsOf('_bamboo_sticks').at(-1)?.skill
  assert.notEqual(out.status, 'success')
  assert.equal(server.count('stick') - 32, 3)
  assert.equal(row?.args?.crafts, 3, `row crafts=${row?.args?.crafts}, server +3`)
})

await t('2c A STOPPED EXECUTION IS CREDITED AT MOST ONE EXECUTION\'S YIELD (Codex 10-05: produced is the server\'s DELTA, a pickup inflates it)', async () => {
  // The 3rd execution's real craft runs (+1 stick), then craftsync reports the deadline with an authoritative delta of 3
  // -- as if two sticks had been picked up inside that craft's verification. The tally may take ONE craft from it.
  const { server, bot } = await setup(bag({ 36: ['bamboo', 64], 37: ['bamboo', 10], 38: ['stick', 32] }, 36))
  const real = bot.craft
  let n = 0
  bot.craft = async (...a) => {
    const got = await real(...a)
    if (++n === 3) throw new CS.CraftSyncError('craft stopped at the deadline: 3 of 1 made', { failClass: 'craft_deadline', produced: 3, requested: 1, reason: 'deadline', authoritative: true })
    return got
  }
  await fold(bot, server)
  await new Promise(r => setTimeout(r, 100))
  const row = rowsOf('_bamboo_sticks').at(-1)?.skill
  assert.equal(server.count('stick') - 32, 3, 'POSITIVE CONTROL: three real crafts were made')
  assert.equal(row?.args?.crafts, 3, `row crafts=${row?.args?.crafts}: 2 verified + at most 1 for the stopped execution`)
  assert.ok(row.args.crafts <= row.args.planned)
})

await t('2c THE TALLY IS THE SERVER\'S: an abort that lands after the server answered the 3rd craft\'s verification counts it', async () => {
  const { server, bot } = await setup(bag({ 36: ['bamboo', 64], 37: ['stick', 32] }, 36))
  const ac = new AbortController()
  const recv = server.receive.bind(server)
  let armed = false, fired = false
  server.receive = (name, params) => {   // the after-resync of the craft that made the 3rd stick
    if (!armed && name === 'window_click' && params.windowId === 0 && params.stateId === -1 && server.count('stick') >= 35) armed = true
    return recv(name, params)
  }
  bot._client.on('window_items', p => { if (armed && !fired && p.windowId === 0) { fired = true; ac.abort() } })
  await assert.rejects(SKILLS.bamboo_sticks.run({ bot, runner: { interruptedReason: 'stuck' } }, {}, ac.signal), e => e?.aborted === true)
  await server.settle(); server.stop()
  await new Promise(r => setTimeout(r, 100))
  const row = rowsOf('_bamboo_sticks').at(-1)?.skill
  assert.ok(fired, 'the abort never landed')
  assert.equal(server.count('stick') - 32, 3, 'the server should hold exactly 3 new sticks')
  assert.equal(row?.args?.crafts, 3, `row crafts=${row?.args?.crafts}, server +${server.count('stick') - 32}`)
  assert.equal(row?.args?.stop, 'aborted:stuck', 'the row names why it was aborted')
})

await t('2d A FOLD IS JUDGED BY THE SLOT IT FREED: spent bamboo alone is not the contract\'s change', () => {
  const spentOnly = classifyOutcome('bamboo_sticks', 'success', { inventory: { bamboo: -30, stick: 15 }, slotsFreed: 0 })
  assert.equal(spentOnly.value, 'neutral', 'bamboo -30 with no slot freed is not the change a fold exists for')
  const freed = classifyOutcome('bamboo_sticks', 'success', { inventory: { bamboo: -64, stick: 32 }, slotsFreed: 1 })
  assert.deepEqual(freed.because, ['inventory_slots: 1 slot(s) freed'])
  assert.ok(DURABLE_EVIDENCE.test(freed.because[0]), 'a freed slot is durable: the bot still has it afterwards')
})

const runnerBot = (inv) => ({ entity: { position: { x: 0, y: 64, z: 0, distanceTo: () => 0, clone () { return this } } }, health: 20, food: 20,
  entities: {}, inventory: { items: () => inv }, registry: { blocksByName: {}, itemsByName: {}, items: {}, blocks: {} },
  blockAt: () => ({ name: 'stone', boundingBox: 'block' }), findBlock: () => null, pathfinder: { setGoal () {} }, chat () {} })
async function runAborted (inv, act) {
  const real = SKILLS.bamboo_sticks.run
  SKILLS.bamboo_sticks.run = async () => { act(); const e = new Error('aborted'); e.aborted = true; throw e }
  try { return await new Runner(runnerBot(inv)).run('bamboo_sticks', {}) } finally { SKILLS.bamboo_sticks.run = real }
}
await t('2d THE RUNNER: a fold the watchdog cut at 15 crafts (bamboo -30, no slot freed) STAYS aborted -- not "so it worked"', async () => {
  const inv = [S('bamboo', 64), S('stick', 32), ...fill(34)]
  const r = await runAborted(inv, () => { inv[0] = S('bamboo', 34); inv[1] = S('stick', 47) })
  assert.equal(r.status, 'aborted', `${r.status}: ${r.detail}`)
  assert.doesNotMatch(String(r.detail), /so it worked/)
})
await t('2d THE RUNNER: an aborted fold that DID free a slot is credited, on the freed slot', async () => {
  const inv = [S('bamboo', 64), S('stick', 32), ...fill(34)]
  const r = await runAborted(inv, () => { inv.splice(0, 1); inv[0] = S('stick', 64) })
  assert.equal(r.status, 'success', `${r.status}: ${r.detail}`)
  assert.match(String(r.detail), /inventory_slots: 1 slot\(s\) freed/)
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
