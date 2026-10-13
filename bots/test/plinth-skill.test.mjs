// plinth-01 (10-13): build_plinth, the skill, driven through the REAL SKILLS table on a fake town of dug-out ground.
//
// The chain this proves (CLAUDE.md: test the refusal CHAIN, not the single guard): the town's no-site record starts a plan;
// the plan is a town record; visits build it bounded and resume from the world; the placement that walls the column in
// is owned (row first, a cover kept) and covered when the visit cannot finish; an abort leaves it to a visitor's
// close_well; the next build digs the cover out and finishes; the finished plinth hands its cap to the well-site record
// and lifts the no-site hold; one builder at a time; a foreign block voids the plan; no funds names the remedy.
// The fake server refuses what Paper refuses: a place into a full cell, into a body, out of reach; and the test asserts
// what the plan promises: never a bottom-face click, never a stand in the well column, never a block outside the plan.
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, mkdtempSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

process.env.LOG_DIR = `/tmp/mcbot-test-logs-plinth-${process.pid}`
process.env.BOT_NAME = 'TestBot'
process.env.HOME_X = '0'; process.env.HOME_Y = '64'; process.env.HOME_Z = '0'
process.env.MEMORY_POOL = 'plinthtest'
const STORE = mkdtempSync(path.join(tmpdir(), 'plinth-store-'))
process.env.POOL_STATE_DIR = STORE
const { Vec3 } = await import('vec3')
const P = await import('../src/plinth.mjs')
const W = await import('../src/well.mjs')
const S = await import('../src/skills.mjs')
const { SKILLS, SKILL_CONTRACTS } = S
const { isHousekeeping } = await import('../src/hygiene.mjs')
const { readTownSite } = await import('../src/composter.mjs')
const require = createRequire(import.meta.url)
const REG = require('minecraft-data')('1.21.11')
const PBlock = require('prismarine-block')('1.21.11')

let pass = 0, fail = 0
const failed = []
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) {
    fail++; failed.push(name); console.log(`  FAIL  ${name}\n        ${String(e?.stack ?? e).split('\n').slice(0, 5).join('\n        ')}`)
  }
}
const SLAB_Y = 63
const HOME = { x: 0, y: 64, z: 0 }
const KEY = (x, y, z) => `${x},${y},${z}`
const NOSITE = path.join(STORE, 'junkwell-nosite-0_64_0.json')
const PLINTH = path.join(STORE, 'junkwell-plinth-0_64_0.json')
const LEASE = path.join(STORE, 'junkwell-plinth-0_64_0.lease.g1.json')
const leaseFiles = () => require('node:fs').readdirSync(STORE).filter(f => /^junkwell-plinth-0_64_0\.lease\.g\d+\.json$/.test(f))
const rowsNow = kind => { try { return readFileSync(`${process.env.LOG_DIR}/skill-TestBot.jsonl`, 'utf8').trim().split('\n').map(l => JSON.parse(l)).filter(r => r.skill?.name === kind) } catch { return [] } }
const rowsOf = async kind => { await new Promise(r => setTimeout(r, 200)); return rowsNow(kind) }
const field = (d, k) => { const m = new RegExp(`(?:^| )${k}=(\\S+)`).exec(d ?? ''); return m ? m[1] : null }
const reset = () => { for (const f of [NOSITE, PLINTH]) rmSync(f, { force: true }); for (const f of leaseFiles()) rmSync(path.join(STORE, f), { force: true }); for (const f of (existsSync(STORE) ? require('node:fs').readdirSync(STORE) : [])) if (/^junkwell-site-/.test(f)) rmSync(path.join(STORE, f), { force: true }) }
const noSite = () => writeFileSync(NOSITE, JSON.stringify({ at: Date.now(), world: 'w1', by: 'someone', tally: 'cols:672' }))

const STATE = {}
const stateOf = name => STATE[name] ??= (REG.blocksByName[name].defaultState ?? REG.blocksByName[name].minStateId)
/** A fake town on a one-thick slab (dug-out ground), with the world kept in a Map and the server's refusals asserted. */
function fakeTown ({ items = [], name = 'b-Alpha', extra = {}, at = null } = {}) {
  const world = new Map(Object.entries(extra))
  const nameAt = (x, y, z) => world.get(KEY(x, y, z)) ?? (Math.abs(x) > 40 || Math.abs(z) > 40 ? null : y === SLAB_Y ? 'grass_block' : y === SLAB_Y - 10 ? 'stone' : 'air')
  const blockAt = p => {
    const x = Math.floor(p.x), y = Math.floor(p.y), z = Math.floor(p.z)
    if (y < 40 || y > 100) return null
    const n = nameAt(x, y, z)
    if (!n) return null
    const b = PBlock.fromStateId(stateOf(n), 0); b.position = new Vec3(x, y, z); return b
  }
  const slots = Array(46).fill(null)
  let si = 9
  for (const [n, c] of items) { slots[si] = { name: n, count: c, slot: si, type: REG.itemsByName[n].id, stackSize: 64 }; si++ }
  const st = { places: [], digs: [], goals: [], placeHook: null, abortAfter: null, refused: [] }
  const bot = {
    username: name, worldId: 'w1', registry: REG, quickBarSlot: 0, entities: {}, players: {}, currentWindow: null,
    entity: { position: at ?? new Vec3(0.5, SLAB_Y + 1, 0.5), height: 1.8, width: 0.6 },
    get heldItem () { return slots[36 + bot.quickBarSlot] ?? null },
    inventory: { slots, items: () => slots.slice(9, 45).filter(s => s && s.count > 0) },
    blockAt,
    findBlocks: ({ matching, maxDistance, point, count = 1 }) => {
      const from = point ?? bot.entity.position
      return [...world.keys()].map(k => new Vec3(...k.split(',').map(Number))).filter(v => v.distanceTo(from) <= maxDistance && matching(blockAt(v))).slice(0, count)
    },
    findBlock: o => { const r = bot.findBlocks({ ...o, count: 1 })[0]; return r ? blockAt(r) : null },
    equip: async (item, dest) => {
      assert.equal(dest, 'hand')
      if (!item || slots[item.slot] !== item) throw new Error('not in inventory')
      if (item.slot >= 36) { bot.quickBarSlot = item.slot - 36; return }
      const d = 36, other = slots[d], from = item.slot
      slots[d] = item; item.slot = d; slots[from] = other; if (other) other.slot = from
      bot.quickBarSlot = 0
    },
    lookAt: async () => {}, setControlState () {}, clearControlStates () {}, waitForTicks: async () => { st.ticks = (st.ticks ?? 0) + 1; await st.tickHook?.(); await new Promise(r => setImmediate(r)) },
    pathfinder: {
      setGoal () {}, stop () {},
      goto: async goal => {
        st.goals.push([goal.x, goal.y, goal.z])
        if (st.gotoFail?.(goal)) throw new Error('no path')
        const ok = blockAt(new Vec3(goal.x, goal.y, goal.z))?.boundingBox === 'empty' && blockAt(new Vec3(goal.x, goal.y + 1, goal.z))?.boundingBox === 'empty' && blockAt(new Vec3(goal.x, goal.y - 1, goal.z))?.boundingBox === 'block'
        if (!ok) throw new Error('no path')
        bot.entity.position = new Vec3(goal.x + 0.5, goal.y, goal.z + 0.5)
      },
    },
    _placeBlockWithOptions: async (ref, face) => {
      const at = ref.position.plus(face)
      const h = bot.heldItem
      assert.ok(h, 'placing with an empty hand')
      assert.notEqual(face.y, -1, 'a BOTTOM face was clicked')
      const target = blockAt(at)
      const eye = bot.entity.position.offset(0, 1.62, 0)
      const fc = ref.position.offset(0.5 + face.x * 0.5, 0.5 + face.y * 0.5, 0.5 + face.z * 0.5)
      if (eye.distanceTo(fc) > 5.5) { st.refused.push('reach'); throw new Error('out of reach') }
      if (!['air', 'cave_air', 'short_grass'].includes(target.name)) { st.refused.push('full'); throw new Error('placing into a full cell') }
      const f = bot.entity.position
      if (f.x + 0.3 > at.x && f.x - 0.3 < at.x + 1 && f.z + 0.3 > at.z && f.z - 0.3 < at.z + 1 && f.y + 1.8 > at.y && f.y < at.y + 1) { st.refused.push('body'); throw new Error('a body in the cell') }
      world.set(KEY(at.x, at.y, at.z), h.name); h.count--; if (!h.count) slots[h.slot] = null
      st.places.push(KEY(at.x, at.y, at.z))
      await st.placeHook?.(at)
    },
    dig: async b => { st.digs.push(KEY(b.position.x, b.position.y, b.position.z)); world.set(KEY(b.position.x, b.position.y, b.position.z), 'air') },
  }
  const read = (x, y, z) => { const b = blockAt(new Vec3(x, y, z)); return b ? { name: b.name, boundingBox: b.boundingBox, shapes: b.shapes, hardness: b.hardness, props: null } : null }
  return { bot, st, world, read, slots }
}
/** A plan is not built before every peer has had it WELL_RECORD_SETTLE_MS (25 s): a test ages the record by default. */
const ageRecord = () => { try { const r = JSON.parse(readFileSync(PLINTH, 'utf8')); if (r.state === 'plan' && Date.now() - r.at < 60_000) writeFileSync(PLINTH, JSON.stringify({ ...r, at: Date.now() - 60_000 })) } catch {} }
const visit = async (town, signal = { aborted: false }, { age = true } = {}) => { if (age) ageRecord(); return SKILLS.build_plinth.run({ bot: town.bot }, {}, signal) }
const recNow = () => JSON.parse(readFileSync(PLINTH, 'utf8'))
const bag = town => town.bot.inventory.items().reduce((m, it) => ({ ...m, [it.name]: (m[it.name] ?? 0) + it.count }), {})

await t('registered: build_plinth is chatOnly housekeeping with a world_change contract', () => {
  assert.ok(SKILLS.build_plinth?.run); assert.equal(SKILLS.build_plinth.chatOnly, true)
  assert.equal(isHousekeeping('build_plinth'), true)
  assert.deepEqual(SKILL_CONTRACTS.build_plinth.expects, ['world_change'])
})

await t('NO TRIGGER, NO PLAN (positive control for the trigger): without the town\'s no-site record a visit does nothing', async () => {
  reset()
  const town = fakeTown({ items: [['cobblestone', 200], ['dirt', 4]] })
  const r = await visit(town)
  assert.equal(r.status, 'no_effect'); assert.match(r.detail, /no raised junk well is wanted/)
  assert.equal(existsSync(PLINTH), false)
})

let PLAN = null
await t('THE CHAIN: no-site record -> plan visit (record, no block) -> build visits bounded at 40 -> complete: the oracle passes, the cap is the well site, the hold is lifted, the pit covered by its owner', async () => {
  reset(); noSite()
  const town = fakeTown({ items: [['cobblestone', 64], ['cobblestone', 64], ['cobblestone', 64], ['andesite', 20], ['dirt', 4]] })
  const r1 = await visit(town)
  assert.equal(r1.status, 'no_effect', r1.detail); assert.match(r1.detail, /^planned the town's raised junk well/)
  assert.equal(town.st.places.length, 0, 'the planning visit places nothing (peers learn the plan first)')
  const rec = recNow()
  assert.equal(rec.state, 'plan'); assert.equal(rec.world, 'w1'); PLAN = rec.plan
  assert.equal(PLAN.k, 3)
  assert.ok(S.knownWellCells(town.bot).some(c => c.x === PLAN.cap.x && c.y === PLAN.cap.y && c.z === PLAN.cap.z), 'the plan is a well column for every path from the moment it is recorded')
  let n = 0
  for (; n < 6 && recNow().state === 'plan'; n++) {
    const r = await visit(town)
    assert.equal(r.status, 'success', r.detail)
  }
  assert.ok(n >= 2, 'bounded: more than one visit for ~60 blocks')
  assert.equal(recNow().state, 'complete')
  const planned = new Set(PLAN.steps.map(s => s.c.join(',')))
  const cap = PLAN.cap
  const outside = town.st.places.filter(k => !planned.has(k) && k !== KEY(cap.x, cap.y, cap.z))
  assert.deepEqual(outside, [], 'no block outside the plan (the cap cell takes only the pit cover)')
  assert.equal(new Set(town.st.places).size, town.st.places.length - (town.st.places.filter(k => k === KEY(cap.x, cap.y, cap.z)).length > 1 ? 1 : 0), 'no plan cell placed twice')
  assert.deepEqual(town.st.refused, [], 'the server never refused a placement')
  assert.ok(!town.st.goals.some(([x, y, z]) => P.inColumn(cap, x, y, z)), 'no walk goal in the well column')
  // the world: the plan passes the oracle (with the cover in the cap cell, stage 'covered', which build_well digs out)
  const stage = W.wellStage(town.read, cap)
  assert.equal(stage, 'covered', 'the owner covered the finished, open column')
  assert.equal(W.wellSiteRefusal(town.read, cap, HOME), null)
  const site = readTownSite(STORE, 'junkwell-site-0_64_0')
  assert.deepEqual(site.site, { x: cap.x, y: cap.y, z: cap.z }, 'the well-site record names the plinth cap')
  assert.equal(existsSync(NOSITE), false, 'the no-site hold is lifted: build_well may run')
  assert.ok(W.reserveStone(town.bot.inventory.items()) >= W.STONE_GUARD, 'the reserve is kept')
  const dug = (await rowsOf('_well_pit_dug')).filter(r => /from=plinth/.test(r.skill.detail))
  assert.equal(dug.length, 1, 'the pit was owned once, before the placement that walled it in')
  assert.ok((await rowsOf('_well_pit_covered')).some(r => /stage=plinth by=build/.test(r.skill.detail)))
  const done = (await rowsOf('_plinth')).find(r => field(r.skill.detail, 'stage') === 'complete')
  assert.ok(done, 'the complete row')
})

await t('a complete plinth wants nothing more; the town\'s well order takes over (the site is a covered pit build_well digs out)', async () => {
  const town = fakeTown({ items: [['cobblestone', 200], ['dirt', 4]] })
  for (const k of PLAN.steps.map(s => s.c.join(','))) town.world.set(k, 'cobblestone')
  town.world.set(KEY(PLAN.cap.x, PLAN.cap.y, PLAN.cap.z), 'dirt')
  const r = await visit(town)
  assert.equal(r.status, 'no_effect'); assert.match(r.detail, /wanted here \(complete\)/)
  assert.equal(S.townPlinthState(town.bot).want.want, null)
})

await t('RESUME: a visit aborted mid-build leaves no hazard (not yet walled in) and the next visit continues from the world', async () => {
  reset(); noSite()
  const town = fakeTown({ items: [['cobblestone', 64], ['cobblestone', 64], ['cobblestone', 64], ['dirt', 4]] })
  await visit(town)
  const sig = { aborted: false }
  town.st.placeHook = () => { if (town.st.places.length === 15) sig.aborted = true }
  await assert.rejects(visit(town, sig))
  assert.equal(town.st.places.length, 15)
  assert.equal(P.plinthHazard(town.read, recNow().plan.cap), false)
  town.st.placeHook = null
  for (let n = 0; n < 6 && recNow().state === 'plan'; n++) await visit(town)
  assert.equal(recNow().state, 'complete')
  assert.equal(new Set(town.st.places.filter(k => k !== KEY(recNow().plan.cap.x, recNow().plan.cap.y, recNow().plan.cap.z))).size, town.st.places.filter(k => k !== KEY(recNow().plan.cap.x, recNow().plan.cap.y, recNow().plan.cap.z)).length, 'nothing placed twice')
})

await t('THE HAZARD, ABORTED: the walled-in pit is not covered by an aborted run (the preemption owns the body); _well_pit_open says so; a VISITOR\'s close_well covers it; the builder digs the cover out and finishes', async () => {
  reset(); noSite()
  const town = fakeTown({ items: [['cobblestone', 64], ['cobblestone', 64], ['cobblestone', 64], ['dirt', 4]] })
  await visit(town)
  const plan = recNow().plan, cap = plan.cap
  const hz = plan.steps[plan.hazardStep].c.join(',')
  const sig = { aborted: false }
  town.st.placeHook = at => { if (KEY(at.x, at.y, at.z) === hz) sig.aborted = true }
  for (let n = 0; n < 4 && !sig.aborted; n++) { try { await visit(town, sig) } catch (e) { if (!sig.aborted) throw e } }
  assert.equal(sig.aborted, true)
  assert.equal(P.plinthHazard(town.read, cap), true, 'walled in, open')
  assert.ok((await rowsOf('_well_pit_open')).some(r => /stage=plinth why=aborted/.test(r.skill.detail)))
  assert.equal(S.townPlinthState(town.bot).lease.free, true, 'the lease is released even on an abort')
  // a VISITOR (another bot, at the plinth's foot) sees the pit and covers it
  const ps = S.townPitState(town.bot)
  assert.ok(ps?.plinth && ps.coverable && !ps.attended, JSON.stringify(ps))
  const visitor = fakeTown({ items: [['dirt', 3]], name: 'b-Bravo', at: new Vec3(town.bot.entity.position.x, town.bot.entity.position.y, town.bot.entity.position.z) })
  for (const [k, v] of town.world) visitor.world.set(k, v)
  const rv = await SKILLS.close_well.run({ bot: visitor.bot }, {}, { aborted: false })
  assert.equal(rv.status, 'success', rv.detail)
  assert.equal(P.plinthHazard(visitor.read, cap), false)
  assert.equal(visitor.read(cap.x, cap.y, cap.z).name, 'dirt')
  // the builder (sharing the visitor's world) resumes: digs the cover out (owning the pit again) and finishes
  for (const [k, v] of visitor.world) town.world.set(k, v)
  town.st.placeHook = null
  for (let n = 0; n < 4 && recNow().state === 'plan'; n++) await visit(town)
  assert.equal(recNow().state, 'complete')
  assert.ok(town.st.digs.includes(KEY(cap.x, cap.y, cap.z)), 'the cover was dug out')
  assert.ok((await rowsOf('_well_pit_dug')).some(r => /from=plinth_cover/.test(r.skill.detail)))
})

await t('RESUME OF AN UNCOVERED HAZARD WITH NO FUNDS: the builder owns it from the start and covers it before it reports unfunded', async () => {
  reset(); noSite()
  const town = fakeTown({ items: [['cobblestone', 64], ['cobblestone', 64], ['cobblestone', 64], ['dirt', 4]] })
  await visit(town)
  const plan = recNow().plan, cap = plan.cap
  const hz = plan.steps[plan.hazardStep].c.join(',')
  const sig = { aborted: false }
  town.st.placeHook = at => { if (KEY(at.x, at.y, at.z) === hz) sig.aborted = true }
  for (let n = 0; n < 4 && !sig.aborted; n++) { try { await visit(town, sig) } catch (e) { if (!sig.aborted) throw e } }
  assert.equal(P.plinthHazard(town.read, cap), true)
  town.st.placeHook = null
  // the same builder comes back with only its reserve and a cover block
  for (const it of town.bot.inventory.items()) if (it.name === 'cobblestone') { it.count = 0; town.slots[it.slot] = null }
  town.slots[20] = { name: 'cobblestone', count: 64, slot: 20, type: 1, stackSize: 64 }; town.slots[21] = { name: 'dirt', count: 1, slot: 21, type: 2, stackSize: 64 }
  const r = await visit(town)
  assert.equal(r.failClass, 'plinth_unfunded', r.detail)
  assert.equal(P.plinthHazard(town.read, cap), false, 'covered on the way out')
  assert.ok((await rowsOf('_well_pit_dug')).some(x => /from=plinth_resume/.test(x.skill.detail)))
})

// ---- REVIEW r1 (Codex REJECT, Claude APPROVE-WITH-CHANGES): each finding as a behaviour of the real skill ----
const buildTo = async (town, pred, n = 8) => { for (let i = 0; i < n && !pred(); i++) await visit(town) }
await t('SETTLE (Codex r1 P1-5): a plan younger than WELL_RECORD_SETTLE_MS is not built -- by any bot -- and nothing is placed', async () => {
  reset(); noSite()
  const a = fakeTown({ items: [['cobblestone', 200], ['dirt', 4]] })
  await visit(a)
  const b = fakeTown({ items: [['cobblestone', 200], ['dirt', 4]], name: 'b-Bravo' })
  const r = await visit(b, { aborted: false }, { age: false })
  assert.equal(r.status, 'no_effect'); assert.match(r.detail, /plan is too new/)
  assert.equal(b.st.places.length, 0)
  ageRecord()
  assert.equal((await visit(b)).status, 'success', 'once the plan has settled')
})
await t('ONE BUILDER, RACED (Codex r1 P1-2): two bots ordered at once -- exactly one holds the town; a lease generation is created exclusively', async () => {
  reset(); noSite()
  const a = fakeTown({ items: [['cobblestone', 200], ['dirt', 4]] }), b = fakeTown({ items: [['cobblestone', 200], ['dirt', 4]], name: 'b-Bravo' })
  await visit(a); ageRecord()
  const [ra, rb] = await Promise.all([visit(a), visit(b)])
  assert.deepEqual([ra.failClass === 'plinth_lease', rb.failClass === 'plinth_lease'].filter(Boolean).length, 1, `${ra.detail} | ${rb.detail}`)
  assert.equal(leaseFiles().length >= 1, true)
})
await t('A LOST LEASE STOPS THE BUILDER (Codex r1 P1-2): another generation taken mid-visit ends the visit at the next step', async () => {
  reset(); noSite()
  const town = fakeTown({ items: [['cobblestone', 64], ['cobblestone', 64], ['cobblestone', 64], ['dirt', 4]] })
  await visit(town)
  town.st.placeHook = () => { if (town.st.places.length === 5) { const n = Math.max(...leaseFiles().map(f => Number(/g(\d+)/.exec(f)[1]))); writeFileSync(path.join(STORE, `junkwell-plinth-0_64_0.lease.g${n + 1}.json`), JSON.stringify({ by: 'b-Thief', token: 'x', at: Date.now(), until: Date.now() + 60_000, n: n + 1 })) } }
  const r = await visit(town)
  town.st.placeHook = null
  assert.equal(town.st.places.length, 5, 'not one block after the lease was lost')
  assert.match(r.detail, /stopped: lease/)
})
await t('STUCK (Claude r1 P2-1): a step whose stand can never be reached voids the plan within PLINTH_STUCK_VISITS visits; the town plans again', async () => {
  reset(); noSite()
  const town = fakeTown({ items: [['cobblestone', 200], ['dirt', 4]] })
  await visit(town)
  town.st.gotoFail = () => true
  town.bot.entity.position = new Vec3(-20.5, SLAB_Y + 1, -20.5)    // far from every stand: each click needs a walk
  const rs = []
  for (let n = 0; n < P.PLINTH_STUCK_VISITS && recNow().state === 'plan'; n++) rs.push(await visit(town))
  town.st.gotoFail = null
  assert.equal(recNow().state, 'void', rs.map(r => r.detail).join(' | '))
  assert.match(recNow().why, /^stuck at step 0 \(unreachable\)/)
  assert.equal(S.townPlinthState(town.bot).want.want, 'plan')
})
await t('THE HAND-OFF IS RETRIED (Codex r1 P2-6): a well-site write that fails leaves the record a plan and the hold in place; the next visit hands off', async () => {
  reset(); noSite()
  const town = fakeTown({ items: [['cobblestone', 64], ['cobblestone', 64], ['cobblestone', 64], ['dirt', 4]] })
  await visit(town)
  const last = recNow().plan.steps.at(-1).c.join(',')
  const fsm = require('node:fs')
  town.st.placeHook = at => { if (KEY(at.x, at.y, at.z) === last) fsm.chmodSync(STORE, 0o555) }
  let r
  try { await buildTo(town, () => recNow().state !== 'plan' || /hand-off/.test(r?.detail ?? ''), 6); r = r } finally { fsm.chmodSync(STORE, 0o755) }
  town.st.placeHook = null
  assert.equal(recNow().state, 'plan', 'not complete while the site record could not be written')
  assert.equal(existsSync(NOSITE), true, 'the hold stays')
  assert.equal(readTownSite(STORE, 'junkwell-site-0_64_0').site, null)
  for (const f of leaseFiles()) writeFileSync(path.join(STORE, f), JSON.stringify({ ...JSON.parse(readFileSync(path.join(STORE, f), 'utf8')), until: Date.now() - 1 }))
  r = await visit(town)
  assert.equal(r.status, 'success', r.detail)
  assert.equal(recNow().state, 'complete'); assert.equal(existsSync(NOSITE), false)
  assert.ok(readTownSite(STORE, 'junkwell-site-0_64_0').site)
})
await t('THE LIVE ORACLE BEFORE THE HAND-OFF (Codex r1 P2-8): a natural cell the plan kept, dug out meanwhile, voids the plan instead of handing it off', async () => {
  reset(); noSite()
  const town = fakeTown({ items: [['cobblestone', 64], ['cobblestone', 64], ['cobblestone', 64], ['dirt', 4]] })
  await visit(town)
  const plan = recNow().plan, cap = plan.cap
  // a g-3 ring cell of the k=3 plan is the slab itself (kept, not placed): dig it before the last step
  const kept = `${cap.x + 2},${SLAB_Y},${cap.z + 2}`
  assert.ok(!plan.steps.some(s => s.c.join(',') === kept), 'a kept cell')
  const last = plan.steps.at(-1).c.join(',')
  town.st.placeHook = at => { if (KEY(at.x, at.y, at.z) === last) town.world.set(kept, 'air') }
  await buildTo(town, () => recNow().state !== 'plan')
  town.st.placeHook = null
  assert.equal(recNow().state, 'void'); assert.match(recNow().why, /^oracle: underground air/)
  assert.equal(readTownSite(STORE, 'junkwell-site-0_64_0').site, null, 'no site handed off')
})
await t('RESUME AFTER THE LAST PLACEMENT (Codex r1 P2-7): the pit left walled in by a kill is owned at once and covered after the hand-off', async () => {
  reset(); noSite()
  const town = fakeTown({ items: [['cobblestone', 64], ['cobblestone', 64], ['cobblestone', 64], ['dirt', 4]] })
  await visit(town)
  const plan = recNow().plan, cap = plan.cap
  for (const s of plan.steps) town.world.set(s.c.join(','), 'cobblestone')   // as if a killed builder placed them all
  assert.equal(P.plinthHazard(town.read, cap), true)
  const r = await visit(town)
  assert.equal(r.status, 'success', r.detail)
  assert.equal(recNow().state, 'complete')
  assert.equal(P.plinthHazard(town.read, cap), false, 'covered on the way out')
  assert.ok((await rowsOf('_well_pit_dug')).some(x => /from=plinth_resume/.test(x.skill.detail)))
})
await t('A LEAF CLEAR THAT OPENS THE PIT IS OWNED TOO (Codex r1 P1-4): a natural site whose cap and shaft are leaves -- the clear that walls it in takes the pit first, and it is covered', async () => {
  reset(); noSite()
  // natural ground 4 deep under the slab; at the site (10, SLAB_Y, 0) the cap and the shaft are leaves (the walls are ground)
  const extra = {}
  for (let x = -30; x <= 30; x++) for (let z = -30; z <= 30; z++) for (let y = SLAB_Y - 4; y < SLAB_Y; y++) extra[KEY(x, y, z)] = 'dirt'
  for (const y of [SLAB_Y, SLAB_Y - 1]) extra[KEY(10, y, 0)] = 'oak_leaves'
  const town = fakeTown({ items: [['cobblestone', 200], ['dirt', 4]], extra })
  const cand = P.plinthCandidate(town.read, { home: HOME, x: 10, z: 0, t: SLAB_Y - 2, k: 2 })
  assert.ok(cand.cap, cand.why)
  const sq = P.sequencePlinth(town.read, cand, { home: HOME })
  assert.ok(sq.plan, sq.why)
  assert.equal(sq.plan.steps[sq.plan.hazardStep].op, 'clear', 'the planner\'s hazard step is a clear')
  writeFileSync(PLINTH, JSON.stringify({ v: P.PLINTH_VERSION, state: 'plan', id: 'leafy-1', world: 'w1', at: Date.now() - 60_000, by: 'test', plan: sq.plan, prev: [], left: sq.plan.cost, stuck: null }))
  await buildTo(town, () => recNow().state !== 'plan')
  assert.equal(recNow().state, 'complete')
  const dug = (await rowsOf('_well_pit_dug')).filter(x => new RegExp(`at=10,${SLAB_Y},0 from=plinth_clear step=${sq.plan.hazardStep}`).test(x.skill.detail))
  assert.equal(dug.length, 1, 'owned at the clear, before it')
  assert.equal(P.plinthHazard(town.read, sq.plan.cap), false, 'covered on the way out')
})
await t('A FAILED SEARCH KEEPS WATCHING (Codex r1 P1-3): a voided plinth with a walled-in pit, then no plan anywhere -> the none record carries its cap; it stays excluded and a visitor still covers it', async () => {
  reset(); noSite()
  const town = fakeTown({ items: [['cobblestone', 64], ['cobblestone', 64], ['cobblestone', 64], ['dirt', 4]] })
  await visit(town)
  const plan = recNow().plan, cap = plan.cap
  const hz = plan.steps[plan.hazardStep].c.join(',')
  const sig = { aborted: false }
  town.st.placeHook = at => { if (KEY(at.x, at.y, at.z) === hz) sig.aborted = true }
  for (let n = 0; n < 4 && !sig.aborted; n++) { try { await visit(town, sig) } catch (e) { if (!sig.aborted) throw e } }
  town.st.placeHook = null
  writeFileSync(PLINTH, JSON.stringify({ ...recNow(), state: 'void', why: 'test' }))
  // flood the town: no candidate passes now (water everywhere at the slab, outside the old plinth)
  for (let x = -24; x <= 40; x++) for (let z = -24; z <= 24; z++) if (Math.abs(x - cap.x) > 2 || Math.abs(z - cap.z) > 2) town.world.set(KEY(x, SLAB_Y + 1, z), 'water')
  const poor = fakeTown({ items: [['dirt', 1]], name: 'b-Charlie', at: new Vec3(0.5, SLAB_Y + 1, 0.5) })
  for (const [k, v] of town.world) poor.world.set(k, v)
  const r = await visit(poor)
  assert.equal(r.failClass, 'plinth_none', r.detail)
  assert.equal(recNow().state, 'none')
  assert.deepEqual(recNow().prev.map(c => ({ x: c.x, y: c.y, z: c.z })), [cap], 'the walled-in column is carried')
  assert.ok(S.knownWellCells(poor.bot).some(c => c.x === cap.x && c.y === cap.y && c.z === cap.z))
  assert.ok(S.townPitState(poor.bot)?.plinth, 'still a pit a visitor covers')
})
await t('A BODY IN THE COLUMN (Claude r1 P3-2): the click that would wall it in is not made; nothing is owned over a body', async () => {
  reset(); noSite()
  const town = fakeTown({ items: [['cobblestone', 64], ['cobblestone', 64], ['cobblestone', 64], ['dirt', 4]] })
  await visit(town)
  const plan = recNow().plan, cap = plan.cap
  town.bot.entities[42] = { id: 42, name: 'chicken', position: new Vec3(cap.x + 0.5, cap.y - 1, cap.z + 0.5), width: 0.4, height: 0.7 }
  await buildTo(town, () => P.plinthProgress(town.read, plan).done >= plan.hazardStep, 4)
  const r = await visit(town)
  assert.match(r.detail, /stopped: body|no progress this visit \(body\)/, r.detail)
  assert.equal(P.plinthHazard(town.read, cap), false, 'not walled in over the chicken')
  delete town.bot.entities[42]
})

// ---- REVIEW r2 (Claude APPROVE-WITH-CHANGES) ----
await t('LEAVES GROWN INTO A CELL TO PLACE (Claude r2 P2-A): the builder clears them (the approved leaf clear) and places -- no stall, no void', async () => {
  reset(); noSite()
  const town = fakeTown({ items: [['cobblestone', 64], ['cobblestone', 64], ['cobblestone', 64], ['dirt', 4]] })
  await visit(town)
  const plan = recNow().plan
  const s5 = plan.steps[5].c.join(',')
  town.world.set(s5, 'oak_leaves')
  assert.equal(P.plinthProgress(town.read, plan).blocked, null, 'leaves are not a foreign block')
  await buildTo(town, () => recNow().state !== 'plan')
  assert.equal(recNow().state, 'complete')
  assert.equal(town.read(...plan.steps[5].c).name, 'cobblestone')
  assert.ok(town.st.digs.includes(s5), 'cleared first')
})
await t('OWNED BUT NEVER OPENED (Claude r2 P2-B): the walling-in click that never happens leaves a closing row (by=closed), so the read\'s open-pit clock stops', async () => {
  reset(); noSite()
  const town = fakeTown({ items: [['cobblestone', 64], ['cobblestone', 64], ['cobblestone', 64], ['dirt', 4]] })
  await visit(town)
  const plan = recNow().plan, cap = plan.cap
  const pre = plan.steps[plan.hazardStep - 1].c.join(',')
  const sig = { aborted: false }
  town.st.placeHook = at => { if (KEY(at.x, at.y, at.z) === pre) sig.aborted = true }
  for (let n = 0; n < 4 && !sig.aborted; n++) { try { await visit(town, sig) } catch (e) { if (!sig.aborted) throw e } }
  town.st.placeHook = null
  assert.equal(P.plinthProgress(town.read, plan).next, plan.hazardStep, 'the walling-in step is next')
  // every walk now fails and the bot stands far off: the hazard step is owned (row first) but its click never happens
  town.st.gotoFail = () => true
  town.bot.entity.position = new Vec3(-20.5, SLAB_Y + 1, -20.5)
  const before = (await rowsOf('_well_pit_covered')).length
  await visit(town)
  town.st.gotoFail = null
  assert.equal(P.plinthHazard(town.read, cap), false, 'never opened')
  const closed = (await rowsOf('_well_pit_covered')).slice(before).filter(x => /stage=plinth by=closed/.test(x.skill.detail))
  assert.equal(closed.length, 1, 'the closing row')
  const last = (await rowsOf('_well_pit_dug')).at(-1)
  assert.match(last.skill.detail, new RegExp(`at=${cap.x},${cap.y},${cap.z} from=plinth step=${plan.hazardStep}`), 'owned at the walling-in step')
})
await t('THE STALL COUNTER HOLDS FOR CAUSES A PLAN OUTGROWS (Claude r2 P3-4): unfunded visits neither count nor clear; only a stand, a support or a click that never lands counts', async () => {
  reset(); noSite()
  const rich = fakeTown({ items: [['cobblestone', 200], ['dirt', 4]] })
  await visit(rich)
  const poor = fakeTown({ items: [['cobblestone', 65]], name: 'b-Poor' })
  for (let n = 0; n < 3; n++) { const r = await visit(poor); assert.equal(r.failClass, 'plinth_unfunded') }
  assert.equal(recNow().state, 'plan', 'three unfunded visits void nothing')
  assert.equal(recNow().stuck ?? null, null)
  rich.st.gotoFail = () => true
  rich.bot.entity.position = new Vec3(-20.5, SLAB_Y + 1, -20.5)
  await visit(rich)
  assert.deepEqual(recNow().stuck, { step: 0, n: 1 })
})

// ---- REVIEW r2 (Codex REJECT) ----
await t('A LEASE LOST DURING THE PRE-CLICK WAIT (Codex r2 P1-2): the click itself is fenced -- no block after the lease is gone', async () => {
  reset(); noSite()
  const town = fakeTown({ items: [['cobblestone', 64], ['cobblestone', 64], ['cobblestone', 64], ['dirt', 4]] })
  await visit(town)
  let stolen = false
  town.st.placeHook = () => { if (town.st.places.length === 3) town.st.tickHook = () => {
    if (stolen) return
    stolen = true
    const n = Math.max(...leaseFiles().map(f => Number(/g(\d+)/.exec(f)[1])))
    writeFileSync(path.join(STORE, `junkwell-plinth-0_64_0.lease.g${n + 1}.json`), JSON.stringify({ by: 'b-Thief', token: 'x', at: Date.now(), until: Date.now() + 60_000, n: n + 1 }))
  } }
  const r = await visit(town)
  town.st.placeHook = null; town.st.tickHook = null
  assert.equal(stolen, true)
  assert.equal(town.st.places.length, 3, 'nothing placed after the lease was taken in the wait before the click')
  assert.match(r.detail, /stopped: lease/)
})
await t('A BODY ARRIVING IN THE COLUMN DURING THE PRE-CLICK WAIT (Codex r2 P1-3): the walling-in click is refused at the click', async () => {
  reset(); noSite()
  const town = fakeTown({ items: [['cobblestone', 64], ['cobblestone', 64], ['cobblestone', 64], ['dirt', 4]] })
  await visit(town)
  const plan = recNow().plan, cap = plan.cap
  const pre = plan.steps[plan.hazardStep - 1].c.join(',')
  town.st.placeHook = at => { if (KEY(at.x, at.y, at.z) === pre) town.st.tickHook = () => { town.bot.entities[43] = { id: 43, name: 'chicken', position: new Vec3(cap.x + 0.5, cap.y - 1, cap.z + 0.5), width: 0.4, height: 0.7 } } }
  await buildTo(town, () => recNow().state !== 'plan' || !!town.bot.entities[43], 4)
  if (recNow().state === 'plan') await visit(town)
  town.st.placeHook = null; town.st.tickHook = null
  assert.ok(town.bot.entities[43], 'the chicken arrived in the wait')
  assert.equal(P.plinthHazard(town.read, cap), false, 'not walled in over it')
  assert.equal(recNow().state, 'plan')
  delete town.bot.entities[43]
})
await t('PARTIAL HAND-OFF RECOVERY (Codex r2 P2-6): the site generation written and the hold lifted but the record still a plan -> the next visit completes it, needing no funds', async () => {
  reset(); noSite()
  const town = fakeTown({ items: [['cobblestone', 64], ['cobblestone', 64], ['cobblestone', 64], ['dirt', 4]] })
  await visit(town)
  const rec = recNow(), cap = rec.plan.cap
  for (const s of rec.plan.steps) town.world.set(s.c.join(','), 'cobblestone')
  town.world.set(KEY(cap.x, cap.y, cap.z), 'dirt')                                 // covered, as the owner left it
  const { createSiteGen } = await import('../src/composter.mjs')
  assert.ok(createSiteGen(STORE, 'junkwell-site-0_64_0', 1, cap, 'w1'))
  rmSync(NOSITE)
  writeFileSync(PLINTH, JSON.stringify({ ...rec, left: 1 }))                         // the stale count of the failed write
  assert.equal(S.townPlinthState(town.bot).want.want, 'build')
  const poor = fakeTown({ items: [['dirt', 1]], name: 'b-Poor' })
  for (const [k, v] of town.world) poor.world.set(k, v)
  const r = await visit(poor)
  assert.equal(r.status, 'success', r.detail)
  assert.equal(recNow().state, 'complete')
})
await t('NO EVICTION (Codex r2 P2-4): a town already carrying PLINTH_PREV_MAX unresolved columns starts no new plan; every one stays carried', async () => {
  reset(); noSite()
  const town = fakeTown({ items: [['cobblestone', 200], ['dirt', 4]] })
  const prev = Array.from({ length: P.PLINTH_PREV_MAX }, (_, i) => ({ x: 100 + i, y: 70, z: 100, stair: [] }))   // unloaded: unknown, kept
  writeFileSync(PLINTH, JSON.stringify({ v: P.PLINTH_VERSION, state: 'none', world: 'w1', at: Date.now() - 3 * 3600_000, why: 'test', prev }))
  const r = await visit(town)
  assert.equal(r.failClass, 'plinth_none'); assert.match(r.detail, /too_many_unresolved/)
  assert.equal(recNow().prev.length, P.PLINTH_PREV_MAX)
})

await t('ONE BUILDER: a live lease held by another bot -> no_effect plinth_lease, nothing placed; an expired one is taken', async () => {
  reset(); noSite()
  const town = fakeTown({ items: [['cobblestone', 200], ['dirt', 4]] })
  writeFileSync(LEASE, JSON.stringify({ by: 'b-Other', token: 'b-Other-1', at: Date.now(), until: Date.now() + 60_000, n: 1 }))
  const r = await visit(town)
  assert.equal(r.status, 'no_effect'); assert.equal(r.failClass, 'plinth_lease'); assert.match(r.detail, /b-Other is building/)
  writeFileSync(LEASE, JSON.stringify({ by: 'b-Other', token: 'b-Other-1', at: Date.now() - 600_000, until: Date.now() - 1, n: 1 }))
  assert.match((await visit(town)).detail, /^planned the town's raised junk well/)
})

await t('NO FUNDS: a bag at the reserve with no town chest -> failed plinth_unfunded naming the remedy; nothing placed; the reserve untouched', async () => {
  reset(); noSite()
  const rich = fakeTown({ items: [['cobblestone', 200], ['dirt', 4]] })
  await visit(rich)
  const town = fakeTown({ items: [['cobblestone', 65]] })
  const r = await visit(town)
  assert.equal(r.status, 'failed'); assert.equal(r.failClass, 'plinth_unfunded')
  assert.match(r.detail, /mine stone with a pickaxe/)
  assert.equal(town.st.places.length, 0)
  assert.equal(bag(town).cobblestone, 65)
})

await t('A FOREIGN BLOCK IN A PLAN CELL (a chest put there) voids the plan: failed plinth_blocked; the town plans again', async () => {
  reset(); noSite()
  const town = fakeTown({ items: [['cobblestone', 200], ['dirt', 4]] })
  await visit(town)
  const s = recNow().plan.steps[3]
  town.world.set(s.c.join(','), 'chest')
  const r = await visit(town)
  assert.equal(r.status, 'failed'); assert.equal(r.failClass, 'plinth_blocked')
  assert.equal(recNow().state, 'void')
  assert.equal(S.townPlinthState(town.bot).want.want, 'plan')
})

await t('A VOIDED PLAN WITH A WALLED-IN PIT: the voiding visit covers it; the next plan keeps the old cap excluded and watched (prev)', async () => {
  reset(); noSite()
  const town = fakeTown({ items: [['cobblestone', 64], ['cobblestone', 64], ['cobblestone', 64], ['dirt', 4]] })
  await visit(town)
  const plan = recNow().plan, cap = plan.cap
  const hz = plan.steps[plan.hazardStep].c.join(',')
  const sig = { aborted: false }
  town.st.placeHook = at => { if (KEY(at.x, at.y, at.z) === hz) sig.aborted = true }
  for (let n = 0; n < 4 && !sig.aborted; n++) { try { await visit(town, sig) } catch (e) { if (!sig.aborted) throw e } }
  town.st.placeHook = null
  assert.equal(P.plinthHazard(town.read, cap), true)
  town.world.set(plan.steps[plan.steps.length - 1].c.join(','), 'chest')   // a foreign block in a cell still to place
  const r = await visit(town)
  assert.equal(r.failClass, 'plinth_blocked')
  assert.equal(P.plinthHazard(town.read, cap), false, 'covered by the visit that voided it')
  await visit(town)                                                        // plans again
  const rec = recNow()
  assert.equal(rec.state, 'plan')
  assert.deepEqual(rec.prev.map(c => ({ x: c.x, y: c.y, z: c.z })), [cap])
  assert.ok(S.knownWellCells(town.bot).some(c => c.x === cap.x && c.y === cap.y && c.z === cap.z), 'the old column stays out of every path')
})

await t('THE PLAN IS NOT THE WORLD: a block a bot dug out of the finished part is placed again on the next visit', async () => {
  reset(); noSite()
  const town = fakeTown({ items: [['cobblestone', 64], ['cobblestone', 64], ['cobblestone', 64], ['dirt', 4]] })
  await visit(town); await visit(town)
  const s = recNow().plan.steps[2]
  assert.equal(town.read(...s.c).name, 'cobblestone')
  town.world.set(s.c.join(','), 'air')
  await visit(town)
  assert.equal(town.read(...s.c).name, 'cobblestone')
})

await t('a usable well in town: nothing to build (the order and the skill agree)', async () => {
  reset(); noSite()
  const town = fakeTown({ items: [['cobblestone', 200], ['dirt', 4]] })
  assert.equal(S.townPlinthState(town.bot).want.want, 'plan', 'positive control')
})

// =====================================================================================================================
// MUTANTS (skills.mjs): each anchor present and unique; each must change an outcome the chain above asserts
// =====================================================================================================================
const SP = new URL('../src/skills.mjs', import.meta.url)
async function withMutant (file, old, neu, fn) {
  const src = readFileSync(file, 'utf8')
  assert.ok(src.includes(old), `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 60))} is not in ${file.pathname}`)
  assert.equal(src.split(old).length, 2, 'the mutation target is not unique; the mutant is ambiguous')
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, src.replace(old, neu).replace(/from '\.\//g, "from '../src/"))
  try { return await fn(await import(out.href)) } finally { try { rmSync(out) } catch {} }
}
const buildAll = async (m, town) => {
  await m.SKILLS.build_plinth.run({ bot: town.bot }, {}, { aborted: false })
  for (let n = 0; n < 6 && recNow().state === 'plan'; n++) { ageRecord(); await m.SKILLS.build_plinth.run({ bot: town.bot }, {}, { aborted: false }) }
}
await t('MUTANT (skills): no ownership at the walling-in click -> the click guard refuses it ("changed"): the column is never walled in unowned, the build stops there', async () => {
  await withMutant(SP, "    owned = true\n    logEvent({ kind: 'well_pit_dug', status: 'success', snapshot: snapshot(bot), detail: `at=${cap.x},${cap.y},${cap.z} from=${from}` })\n",
    "    logEvent({ kind: 'well_pit_dug', status: 'success', snapshot: snapshot(bot), detail: `at=${cap.x},${cap.y},${cap.z} from=${from}` })\n", async m => {
      reset(); noSite()
      const town = fakeTown({ items: [['cobblestone', 64], ['cobblestone', 64], ['cobblestone', 64], ['dirt', 4]] })
      await buildAll(m, town)
      assert.equal(recNow().state, 'plan', 'the mutant never finishes')
      assert.equal(P.plinthHazard(town.read, recNow().plan.cap), false, 'and never walls the column in')
      assert.equal(P.plinthProgress(town.read, recNow().plan).next, recNow().plan.hazardStep, 'it stops at the walling-in step')
    })
})
await t('MUTANT (skills): the handoff keeps the no-site hold -> build_well would wait 2 h for a site that exists', async () => {
  await withMutant(SP, "  try { fs.unlinkSync(wellNoSiteFile()) } catch (e) { if (e?.code !== 'ENOENT') return false }\n", '', async m => {
    reset(); noSite()
    const town = fakeTown({ items: [['cobblestone', 64], ['cobblestone', 64], ['cobblestone', 64], ['dirt', 4]] })
    await buildAll(m, town)
    assert.equal(recNow().state, 'complete')
    assert.equal(existsSync(NOSITE), true, 'the mutant keeps the hold')
  })
})
await t('MUTANT (skills): the lease not honoured -> a second builder builds while another holds the town', async () => {
  await withMutant(SP, "  if (!lease.ok) return skip('lease', `${lease.holder ?? 'another bot'} is building the town's raised junk well`, 'plinth_lease')\n", '', async m => {
    reset(); noSite()
    const town = fakeTown({ items: [['cobblestone', 200], ['dirt', 4]] })
    writeFileSync(LEASE, JSON.stringify({ by: 'b-Other', token: 'b-Other-1', at: Date.now(), until: Date.now() + 60_000, n: 1 }))
    const r = await m.SKILLS.build_plinth.run({ bot: town.bot }, {}, { aborted: false })
    assert.notEqual(r.failClass, 'plinth_lease', 'the mutant builds anyway')
  })
})
await t('MUTANT (skills): the finally does not cover -> an unfinished, walled-in pit is left open by a run that could cover it', async () => {
  await withMutant(SP, "        else { const res = await coverPlinthPit(bot, { cap, recId: null, g, signal, by: 'build', start }); why = res.ok ? null : res.why; coveredHere = !!res.ok }\n", "        else why = 'mutant'\n", async m => {
    reset(); noSite()
    const town = fakeTown({ items: [['cobblestone', 64], ['cobblestone', 64], ['cobblestone', 64], ['dirt', 4]] })
    await buildAll(m, town)
    assert.equal(W.wellStage(town.read, recNow().plan.cap), 'dug', 'the mutant leaves it open')
    assert.ok((await rowsOf('_well_pit_open')).some(r => /why=mutant/.test(r.skill.detail)), 'and says so')
  })
})

await t('MUTANT (skills): the walling-in ownership only for placements -> the leaf clear that would wall the column in is refused by the click guard; the build stops there', async () => {
  await withMutant(SP, "      if (!owned && plinthHazard(read, cap) === false && plinthHazard(post, cap) === true) {\n", "      if (s.op === 'place' && !owned && plinthHazard(read, cap) === false && plinthHazard(post, cap) === true) {\n", async m => {
    reset(); noSite()
    const extra = {}
    for (let x = -30; x <= 30; x++) for (let z = -30; z <= 30; z++) for (let y = SLAB_Y - 4; y < SLAB_Y; y++) extra[KEY(x, y, z)] = 'dirt'
    for (const y of [SLAB_Y, SLAB_Y - 1]) extra[KEY(10, y, 0)] = 'oak_leaves'
    const town = fakeTown({ items: [['cobblestone', 200], ['dirt', 4]], extra })
    const sq = P.sequencePlinth(town.read, P.plinthCandidate(town.read, { home: HOME, x: 10, z: 0, t: SLAB_Y - 2, k: 2 }), { home: HOME })
    writeFileSync(PLINTH, JSON.stringify({ v: P.PLINTH_VERSION, state: 'plan', id: 'leafy-m', world: 'w1', at: Date.now() - 60_000, by: 'test', plan: sq.plan, prev: [], left: sq.plan.cost, stuck: null }))
    for (let n = 0; n < 4 && recNow().state === 'plan'; n++) { ageRecord(); await m.SKILLS.build_plinth.run({ bot: town.bot }, {}, { aborted: false }) }
    assert.equal(recNow().state, 'plan', 'the mutant never finishes')
    assert.equal(P.plinthHazard(town.read, sq.plan.cap), false, 'the column is not opened unowned')
  })
})
await t('MUTANT (skills): no settle wait -> a second bot builds the instant the plan is recorded (the SETTLE test asserts it does not)', async () => {
  await withMutant(SP, "    for (let age = Date.now() - Number(rec.at); age < WELL_RECORD_SETTLE_MS; age = Date.now() - Number(rec.at)) {\n", "    for (let age = Infinity; age < 0;) {\n", async m => {
    reset(); noSite()
    const a = fakeTown({ items: [['cobblestone', 200], ['dirt', 4]] })
    await m.SKILLS.build_plinth.run({ bot: a.bot }, {}, { aborted: false })
    const b = fakeTown({ items: [['cobblestone', 200], ['dirt', 4]], name: 'b-Bravo' })
    await m.SKILLS.build_plinth.run({ bot: b.bot }, {}, { aborted: false })
    assert.ok(b.st.places.length > 0, 'the mutant builds at once')
  })
})

// =====================================================================================================================
// WIRING (structural: comments stripped, unique anchors, a mutant each)
// =====================================================================================================================
const strip = src => src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map(l => l.replace(/(^|\s)\/\/.*$/, '')).join('\n')
const once = (src, needle, where) => { const n = src.split(needle).length - 1; assert.equal(n, 1, `${where}: expected exactly one "${needle}", found ${n}`) }
const IDX = strip(readFileSync(new URL('../src/index.mjs', import.meta.url), 'utf8'))
const COG = strip(readFileSync(new URL('../src/cognitive.mjs', import.meta.url), 'utf8'))
const idxPlinth = src => {
  once(src, 'moves.exclusionAreasBreak.push((block) => plinthBreakCost(plinthStair, block))', 'index')
  once(src, 'try { plinthStair = knownPlinthStair(bot) } catch { plinthStair = [] }', 'index')
  const clone = src.indexOf('Object.assign(gatherMoves, moves)')
  const at = src.indexOf('moves.exclusionAreasBreak.push((block) => plinthBreakCost')
  assert.ok(at > 0 && at < clone, 'the stair veto is on the shared break array before the clones copy it')
}
const cogPlinth = src => {
  once(src, 'order = this.#plinthOrder() ?? this.#townDepositOrder(milestone) ?? order', 'cognitive')
  once(src, "if (admitted.skill === 'build_plinth') this.plinthState = plinthOrderOutcome(r.status, Date.now(), this.plinthState ?? {}, r.failClass ?? null)", 'cognitive')
  once(src, 'const r = plinthOrder({', 'cognitive')
  once(src, 'chestSlots: () => Math.max(1, Math.ceil(plinthShortfall(items, PLINTH_MIN_FUND) / 64))', 'cognitive')
}
await t('index.mjs: the stair veto rides the shared break array (before the clones); refreshed with the wells', () => idxPlinth(IDX))
await t('MUTANT (index): the stair veto pushed after the clones, or dropped, is detected', () => {
  const line = 'moves.exclusionAreasBreak.push((block) => plinthBreakCost(plinthStair, block))'
  const m1 = IDX.replace(line, '')
  assert.notEqual(m1, IDX, 'MUTATION DID NOT APPLY'); assert.throws(() => idxPlinth(m1), /found 0/)
  const m2 = IDX.replace(line, '').replace('Object.assign(gatherMoves, moves)', 'Object.assign(gatherMoves, moves)\n' + line)
  assert.notEqual(m2, IDX, 'MUTATION DID NOT APPLY'); assert.throws(() => idxPlinth(m2), /before the clones/)
})
await t('cognitive.mjs: the plinth order goes before the town deposit, and its outcome is fed back', () => cogPlinth(COG))
await t('MUTANT (cognitive): the deposit first, or the outcome line removed, is detected', () => {
  const m1 = COG.replace('order = this.#plinthOrder() ?? this.#townDepositOrder(milestone) ?? order', 'order = this.#townDepositOrder(milestone) ?? this.#plinthOrder() ?? order')
  assert.notEqual(m1, COG, 'MUTATION DID NOT APPLY'); assert.throws(() => cogPlinth(m1), /found 0/)
  const m2 = COG.replace("if (admitted.skill === 'build_plinth') this.plinthState = plinthOrderOutcome(r.status, Date.now(), this.plinthState ?? {}, r.failClass ?? null)", '')
  assert.notEqual(m2, COG, 'MUTATION DID NOT APPLY'); assert.throws(() => cogPlinth(m2), /found 0/)
})

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) console.log('FAILED:\n  ' + failed.join('\n  '))
try { rmSync(STORE, { recursive: true, force: true }) } catch {}
process.exit(fail ? 1 : 0)
