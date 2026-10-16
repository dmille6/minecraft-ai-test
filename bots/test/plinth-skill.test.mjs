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
    // the late block update arrives after the click's read-back window (11 reads), before its retry's guard reads it
    if (st.late && st.late.key === KEY(x, y, z) && ++st.late.reads >= 12) { st.late.land(); st.late = null }
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
      (st.refNames ??= []).push(ref.name); (st.placeTimes ??= []).push(Date.now())
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
      const land = () => { world.set(KEY(at.x, at.y, at.z), h.name); h.count--; if (!h.count) slots[h.slot] = null }
      // A LATE LANDING (the server's block update after the client's read-back window): the block appears 12 ticks on
      if (st.lateOnce) { st.lateOnce = false; st.late = { key: KEY(at.x, at.y, at.z), reads: 0, land } } else land()
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
  const at = recNow().at
  const r = await visit(b, { aborted: false }, { age: false })
  // under the suite's short budgets the visit gives up waiting ('too new'); under production budgets it waits the settle
  // out -- either way no block is placed before the plan is WELL_RECORD_SETTLE_MS old (Codex r8: env-independent)
  const first = (b.st.placeTimes ?? [])[0]
  assert.ok(first === undefined || first - at >= S.WELL_RECORD_SETTLE_MS, `a block ${first - at} ms after the plan`)
  if (first === undefined) { assert.equal(r.status, 'no_effect'); assert.match(r.detail, /plan is too new/) }
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

// ---- REVIEW r5 (Claude: the late landing) ----
await t('A LATE LANDING OF OUR OWN CLICK (Claude r5 P3): the retry finds the block there -- it is this run\'s step (row and count), not another hand\'s', async () => {
  reset(); noSite()
  const town = fakeTown({ items: [['cobblestone', 64], ['cobblestone', 64], ['cobblestone', 64], ['dirt', 4]] })
  await visit(town)
  const first = recNow().plan.steps[0].c.join(',')
  town.st.lateOnce = true
  const before = (await rowsOf('_plinth_step')).length
  await visit(town)
  const rows = (await rowsOf('_plinth_step')).slice(before)
  assert.ok(rows.some(x => x.skill.detail.includes(`at=${first} `)), 'the late-landed first step has its row')
  assert.equal(town.read(...recNow().plan.steps[0].c).name, 'cobblestone')
})

// ---- REVIEW r4 (Codex REJECT: N5) ----
/** A slab plinth whose pit was covered by its builder after an abort at the walling-in step (the cover: dirt). */
async function coveredPitTown () {
  reset(); noSite()
  const town = fakeTown({ items: [['cobblestone', 64], ['cobblestone', 64], ['cobblestone', 64], ['dirt', 4]] })
  await visit(town)
  const plan = recNow().plan, cap = plan.cap
  const hz = plan.steps[plan.hazardStep].c.join(',')
  town.st.placeHook = at => { if (KEY(at.x, at.y, at.z) === hz) town.world.set(KEY(cap.x, cap.y, cap.z), 'dirt') }   // covered at once
  const sig = { aborted: false }
  const h2 = town.st.placeHook
  town.st.placeHook = at => { h2(at); if (KEY(at.x, at.y, at.z) === hz) sig.aborted = true }
  for (let n = 0; n < 4 && !sig.aborted; n++) { try { await visit(town, sig) } catch (e) { if (!sig.aborted) throw e } }
  town.st.placeHook = null
  assert.equal(P.plinthProgress(town.read, plan).covered, true)
  return { town, plan, cap }
}
await t('N5 (Codex r4): the cover removal is guarded -- a chest in the cap cell voids the plan and is never dug; a cover swapped for a chest in the walk is not dug; a body arriving before the dig stops it; a dirt cover is dug (positive control)', async () => {
  { // positive control
    const { town, cap } = await coveredPitTown()
    await visit(town)
    assert.ok(town.st.digs.includes(KEY(cap.x, cap.y, cap.z)), 'the dirt cover is dug out')
  }
  { // a dirt cover that turned to grass (Claude r5 P2) is still a cover: dug, not voided
    const { town, cap } = await coveredPitTown()
    town.world.set(KEY(cap.x, cap.y, cap.z), 'grass_block')
    const r = await visit(town)
    assert.notEqual(r.failClass, 'plinth_blocked', r.detail)
    assert.ok(town.st.digs.includes(KEY(cap.x, cap.y, cap.z)), 'the grassed cover is dug out')
  }
  { // a chest already in the cap
    const { town, cap } = await coveredPitTown()
    town.world.set(KEY(cap.x, cap.y, cap.z), 'chest')
    const r = await visit(town)
    assert.equal(r.failClass, 'plinth_blocked'); assert.equal(recNow().state, 'void')
    assert.ok(!town.st.digs.includes(KEY(cap.x, cap.y, cap.z)))
  }
  { // swapped during the approach walk
    const { town, cap } = await coveredPitTown()
    town.bot.entity.position = new Vec3(-5.5, SLAB_Y + 1, -5.5)
    town.st.gotoFail = () => { town.world.set(KEY(cap.x, cap.y, cap.z), 'chest'); return false }
    await visit(town)
    town.st.gotoFail = null
    assert.ok(!town.st.digs.includes(KEY(cap.x, cap.y, cap.z)), 'the chest is not dug')
  }
  { // a body arrives in the column during the walk to the dig's stand (after own(), before the dig)
    const { town, cap } = await coveredPitTown()
    town.bot.entity.position = new Vec3(-5.5, SLAB_Y + 1, -5.5)
    town.st.gotoFail = () => { town.bot.entities[44] = { id: 44, name: 'chicken', position: new Vec3(cap.x + 0.5, cap.y - 1, cap.z + 0.5), width: 0.4, height: 0.7 }; return false }
    await visit(town)
    town.st.gotoFail = null
    assert.ok(!town.st.digs.includes(KEY(cap.x, cap.y, cap.z)), 'not dug with a body in the column')
    delete town.bot.entities[44]
  }
  { // a body arrives AFTER own(): during the equip of the dig's tool -- the guard at the dig stops it
    const { town, cap } = await coveredPitTown()
    town.slots[30] = { name: 'stone_shovel', count: 1, slot: 30, type: REG.itemsByName.stone_shovel.id, stackSize: 1, durabilityUsed: 0, maxDurability: 131 }
    const eq = town.bot.equip
    town.bot.equip = async (item, d) => { if (item?.name === 'stone_shovel') town.bot.entities[46] = { id: 46, name: 'chicken', position: new Vec3(cap.x + 0.5, cap.y - 1, cap.z + 0.5), width: 0.4, height: 0.7 }; return eq(item, d) }
    await visit(town)
    town.bot.equip = eq
    assert.ok(town.bot.entities[46], 'positive control: the shovel was equipped for the dig')
    assert.ok(!town.st.digs.includes(KEY(cap.x, cap.y, cap.z)), 'not dug over the chicken')
    delete town.bot.entities[46]
  }
})

// ---- REVIEW r3 (Codex REJECT: N1-N4) ----
/** The slab plan built through its first cardinal wall at g, then the FLOOR's block swapped for leaves (grown in): the next
 *  visit's first step is the floor, and clearing its leaf drops the column's bottom below the g-1 walls -> walled in. */
async function floorLeafTown () {
  reset(); noSite()
  const town = fakeTown({ items: [['cobblestone', 64], ['cobblestone', 64], ['cobblestone', 64], ['dirt', 4]] })
  await visit(town)
  const plan = recNow().plan, cap = plan.cap
  // stop right after the FIRST CARDINAL wall at g: a cover has something to go against, three cardinals are still exits
  const firstCard = plan.steps.findIndex(st => st.op === 'place' && st.c[1] === cap.y && Math.abs(st.c[0] - cap.x) + Math.abs(st.c[2] - cap.z) === 1)
  const stopAt = plan.steps[firstCard].c.join(',')
  const sig = { aborted: false }
  town.st.placeHook = at => { if (KEY(at.x, at.y, at.z) === stopAt) sig.aborted = true }
  for (let n = 0; n < 4 && !sig.aborted; n++) { try { await visit(town, sig) } catch (e) { if (!sig.aborted) throw e } }
  town.st.placeHook = null
  const floor = `${cap.x},${cap.y - 2},${cap.z}`
  town.world.set(floor, 'oak_leaves')
  const floorIdx = plan.steps.findIndex(st => st.c.join(',') === floor)
  void stopAt
  return { town, plan, cap, floor, floorIdx }
}
await t('N1 (Codex r3, Claude r4 mutant C): leaves grown into the FLOOR -- the clear that walls the column in is owned first (row from=plinth_clear) and the pit it opens is covered before the visit ends', async () => {
  const { town, cap, floor, floorIdx } = await floorLeafTown()
  const leafWorld = P.overlay(town.read, new Map())
  assert.equal(P.plinthHazard(leafWorld, cap), false, 'with the leaf floor the column has a step out')
  assert.equal(P.plinthHazard(P.overlay(town.read, new Map([[P.cellKey(cap.x, cap.y - 2, cap.z), P.AIR]])), cap), true, 'without it, walled in')
  await visit(town)
  const dug = (await rowsOf('_well_pit_dug')).filter(x => new RegExp(`from=plinth_clear step=${floorIdx}`).test(x.skill.detail))
  assert.equal(dug.length, 1, 'owned at the clear, before it')
  assert.ok(town.st.digs.includes(floor), 'the leaf was cleared')
  assert.equal(P.plinthHazard(town.read, cap), false, 'and the pit it opened is not left open (re-floored or covered)')
})
await t('N3/N4 (Codex r3): a planned leaf replaced by a chest during the walk is NOT dug; a support replaced by a crafting table in the wait is NOT clicked', async () => {
  reset(); noSite()
  const extra = {}
  for (let x = -30; x <= 30; x++) for (let z = -30; z <= 30; z++) for (let y = SLAB_Y - 4; y < SLAB_Y; y++) extra[KEY(x, y, z)] = 'dirt'
  for (const y of [SLAB_Y, SLAB_Y - 1]) extra[KEY(10, y, 0)] = 'oak_leaves'
  const town = fakeTown({ items: [['cobblestone', 200], ['dirt', 4]], extra })
  const sq = P.sequencePlinth(town.read, P.plinthCandidate(town.read, { home: HOME, x: 10, z: 0, t: SLAB_Y - 2, k: 2 }), { home: HOME })
  writeFileSync(PLINTH, JSON.stringify({ v: P.PLINTH_VERSION, state: 'plan', id: 'leafy-n3', world: 'w1', at: Date.now() - 60_000, by: 'test', plan: sq.plan, prev: [], left: sq.plan.cost, stuck: null }))
  const leaf = sq.plan.steps.find(st => st.op === 'clear').c.join(',')
  town.st.gotoFail = goal => { if (!town.st.swapped) { town.st.swapped = true; town.world.set(leaf, 'chest') } return false }
  town.bot.entity.position = new Vec3(-5.5, SLAB_Y + 1, -5.5)
  await visit(town)
  town.st.gotoFail = null
  assert.ok(!town.st.digs.includes(leaf), 'the chest was not dug')
  // N4: the support turns into a crafting table during the pre-click ticks
  reset(); noSite()
  const t2 = fakeTown({ items: [['cobblestone', 64], ['cobblestone', 64], ['cobblestone', 64], ['dirt', 4]] })
  await visit(t2)
  const s0 = recNow().plan.steps[0]
  let swapped = false
  t2.st.tickHook = () => { if (!swapped && t2.st.places.length === 0) { swapped = true; t2.world.set(s0.r.join(','), 'crafting_table') } }
  const r2 = await visit(t2)
  t2.st.tickHook = null
  assert.ok(swapped)
  assert.ok(!(t2.st.refNames ?? []).includes('crafting_table'), 'no click on the crafting table')
  assert.match(r2.detail, /\(support\)/, 'the visit stopped on the support, at the click')
})
await t('N2 WRITER (Claude r4): a void, then a search that finds nothing -> the none record carries trigger void; aged, with the no-site hold gone, the town plans again', async () => {
  reset(); noSite()
  const town = fakeTown({ items: [['cobblestone', 200], ['dirt', 4]] })
  await visit(town)
  const s3 = recNow().plan.steps[3]
  town.world.set(s3.c.join(','), 'chest')
  assert.equal((await visit(town)).failClass, 'plinth_blocked')
  assert.equal(recNow().state, 'void')
  rmSync(NOSITE)                                                                    // as a partial hand-off left it
  for (let x = -24; x <= 40; x++) for (let z = -24; z <= 24; z++) town.world.set(KEY(x, SLAB_Y + 1, z), 'water')   // no plan anywhere now
  const r = await visit(town)
  assert.equal(r.failClass, 'plinth_none', r.detail)
  assert.equal(recNow().state, 'none'); assert.equal(recNow().trigger, 'void')
  const aged = { ...recNow(), at: Date.now() - P.PLINTH_NONE_BACKOFF_MS - 1 }
  writeFileSync(PLINTH, JSON.stringify(aged))
  assert.equal(S.townPlinthState(town.bot).want.want, 'plan', 'the void is still the trigger')
})
await t('N2 (Codex r3): void -> a failed search -> aged none still plans again with the no-site hold gone (the void is carried as the trigger)', () => {
  const NOW = 100_000_000
  const none = { v: P.PLINTH_VERSION, state: 'none', world: 'w1', at: NOW - P.PLINTH_NONE_BACKOFF_MS - 1, trigger: 'void', prev: [] }
  assert.equal(P.plinthWant({ rec: none, noSite: null, world: 'w1', now: NOW }).want, 'plan')
  assert.equal(P.plinthWant({ rec: { ...none, trigger: null }, noSite: null, world: 'w1', now: NOW }).want, null, 'positive control: no trigger, no plan')
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
  await withMutant(SP, "      return own(from, afterItems)\n", "      return /clear/.test(from) ? null : own(from, afterItems)\n", async m => {
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

await t('MUTANT (skills): the opportunistic clear without ownIfWalls -> the guard refuses the dig ("changed"); nothing owned, nothing dug (Claude r4 mutant C)', async () => {
  await withMutant(SP, "        const ow = ownIfWalls(postClear, `plinth_clear step=${i}`, items())\n", "        const ow = null\n", async m => {
    const { town, floor } = await floorLeafTown()
    ageRecord()
    const r = await m.SKILLS.build_plinth.run({ bot: town.bot }, {}, { aborted: false })
    assert.ok(!town.st.digs.includes(floor), 'the mutant does not dig unowned')
    assert.match(r.detail, /changed/)
  })
})
await t('MUTANT (skills): the none record without its void trigger -> the N2 writer test sees trigger null (Claude r4 mutant D)', async () => {
  await withMutant(SP, "        const trigger = want.why === 'void' || mine?.trigger === 'void' ? 'void' : null\n", "        const trigger = null\n", async m => {
    reset(); noSite()
    const town = fakeTown({ items: [['cobblestone', 200], ['dirt', 4]] })
    await m.SKILLS.build_plinth.run({ bot: town.bot }, {}, { aborted: false })
    town.world.set(recNow().plan.steps[3].c.join(','), 'chest')
    ageRecord(); await m.SKILLS.build_plinth.run({ bot: town.bot }, {}, { aborted: false })
    rmSync(NOSITE)
    for (let x = -24; x <= 40; x++) for (let z = -24; z <= 24; z++) town.world.set(KEY(x, SLAB_Y + 1, z), 'water')
    await m.SKILLS.build_plinth.run({ bot: town.bot }, {}, { aborted: false })
    assert.equal(recNow().state, 'none'); assert.equal(recNow().trigger ?? null, null, 'the mutant drops the trigger')
  })
})

await t('MUTANT (skills): the cover dig without its guard -> a body that walked into the column meanwhile has the cover dug over it (Codex r4 N5)', async () => {
  await withMutant(SP, "            const gw = clickGuard({ op: 'uncover', target: c, post: plinthOverlay(read, new Map([[cellKey(c.x, c.y, c.z), PLINTH_AIR]])) })\n", "            const gw = null\n", async m => {
    reset(); noSite()
    const town = fakeTown({ items: [['cobblestone', 64], ['cobblestone', 64], ['cobblestone', 64], ['dirt', 4]] })
    await m.SKILLS.build_plinth.run({ bot: town.bot }, {}, { aborted: false })
    const plan = recNow().plan, cap = plan.cap
    const hz = plan.steps[plan.hazardStep].c.join(',')
    const sig = { aborted: false }
    town.st.placeHook = at => { if (KEY(at.x, at.y, at.z) === hz) { town.world.set(KEY(cap.x, cap.y, cap.z), 'dirt'); sig.aborted = true } }
    for (let n = 0; n < 4 && !sig.aborted; n++) { ageRecord(); try { await m.SKILLS.build_plinth.run({ bot: town.bot }, {}, sig) } catch (e) { if (!sig.aborted) throw e } }
    town.st.placeHook = null
    // the body arrives AFTER own() took the pit: during the equip of the dig's tool (a shovel for the dirt cover)
    town.slots[30] = { name: 'stone_shovel', count: 1, slot: 30, type: REG.itemsByName.stone_shovel.id, stackSize: 1, durabilityUsed: 0, maxDurability: 131 }
    const eq = town.bot.equip
    town.bot.equip = async (item, d) => { if (item?.name === 'stone_shovel') town.bot.entities[45] = { id: 45, name: 'chicken', position: new Vec3(cap.x + 0.5, cap.y - 1, cap.z + 0.5), width: 0.4, height: 0.7 }; return eq(item, d) }
    ageRecord(); await m.SKILLS.build_plinth.run({ bot: town.bot }, {}, { aborted: false })
    town.bot.equip = eq
    assert.ok(town.bot.entities[45], 'positive control: the shovel was equipped for the dig')
    assert.ok(town.st.digs.includes(KEY(cap.x, cap.y, cap.z)), 'the mutant digs the cover over the chicken')
    delete town.bot.entities[45]
  })
})

await t('MUTANT (skills): every retry-time "done" counted as another hand\'s -> the late-landed step loses its row (Claude r5 P3)', async () => {
  await withMutant(SP, "            if (why === 'done') { done = true; byOther = attempt === 0; break }   // a late landing of OUR first click is ours\n", "            if (why === 'done') { done = true; byOther = true; break }\n", async m => {
    reset(); noSite()
    const town = fakeTown({ items: [['cobblestone', 64], ['cobblestone', 64], ['cobblestone', 64], ['dirt', 4]] })
    await m.SKILLS.build_plinth.run({ bot: town.bot }, {}, { aborted: false })
    const first = recNow().plan.steps[0].c.join(',')
    town.st.lateOnce = true
    const before = (await rowsOf('_plinth_step')).length
    ageRecord(); await m.SKILLS.build_plinth.run({ bot: town.bot }, {}, { aborted: false })
    const rows = (await rowsOf('_plinth_step')).slice(before)
    assert.ok(!rows.some(x => x.skill.detail.includes(`at=${first} `)), 'the mutant drops the row')
  })
})

// =====================================================================================================================
// WIRING (structural: comments stripped, unique anchors, a mutant each)
// =====================================================================================================================
const strip = src => src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map(l => l.replace(/(^|\s)\/\/.*$/, '')).join('\n')
const once = (src, needle, where) => { const n = src.split(needle).length - 1; assert.equal(n, 1, `${where}: expected exactly one "${needle}", found ${n}`) }
const COG = strip(readFileSync(new URL('../src/cognitive.mjs', import.meta.url), 'utf8'))
const cogPlinth = src => {
  once(src, 'order = this.#plinthOrder() ?? this.#townDepositOrder(milestone) ?? order', 'cognitive')
  once(src, "if (admitted.skill === 'build_plinth') this.plinthState = plinthOrderOutcome(r.status, Date.now(), this.plinthState ?? {}, r.failClass ?? null)", 'cognitive')
  once(src, 'const r = plinthOrder({', 'cognitive')
  once(src, 'chestSlots: () => Math.max(1, Math.ceil(plinthShortfall(items, PLINTH_MIN_FUND) / 64))', 'cognitive')
}
await t('THE STAIR IS NEVER A PATH\'S DIG, through the well columns index.mjs already prices (no new array entry: townzone-01 forbids pushes on the shared arrays): knownWellCells carries the plan\'s stair and wellBreakCost refuses it', async () => {
  reset(); noSite()
  const town = fakeTown({ items: [['cobblestone', 200], ['dirt', 4]] })
  await visit(town)
  const plan = recNow().plan
  assert.ok(plan.stair.length >= 1, 'the slab plan has a stair')
  const cols = S.knownWellCells(town.bot)
  const col = cols.find(c => c.x === plan.cap.x && c.y === plan.cap.y && c.z === plan.cap.z)
  assert.ok(col && col.stair.length === plan.stair.length, 'the column carries its stair')
  const s0 = plan.stair[0]
  assert.equal(W.wellBreakCost(cols, { position: { x: s0[0], y: s0[1], z: s0[2] } }), 100)
  assert.equal(readFileSync(new URL('../src/index.mjs', import.meta.url), 'utf8').includes('plinth'), false, 'index.mjs is untouched by plinth-01')
})
await t('THE STAIR SURVIVES THE HAND-OFF (Claude r7): once the well-site record names the plinth cap, that column still carries the stair', async () => {
  reset(); noSite()
  const town = fakeTown({ items: [['cobblestone', 64], ['cobblestone', 64], ['cobblestone', 64], ['dirt', 4]] })
  await visit(town)
  for (let n = 0; n < 6 && recNow().state === 'plan'; n++) await visit(town)
  const plan = recNow().plan
  assert.equal(recNow().state, 'complete'); assert.ok(plan.stair.length >= 1)
  assert.deepEqual(readTownSite(STORE, 'junkwell-site-0_64_0').site, { x: plan.cap.x, y: plan.cap.y, z: plan.cap.z }, 'the site record names the cap')
  const cols = S.knownWellCells(town.bot).filter(c => c.x === plan.cap.x && c.y === plan.cap.y && c.z === plan.cap.z)
  assert.equal(cols.length, 1, 'one column, not two')
  assert.equal(cols[0].stair?.length, plan.stair.length, 'the recorded site\'s column carries the stair')
})
await t('MUTANT (skills): the stair not merged into an existing column -> the handed-off well loses its stair veto', async () => {
  await withMutant(SP, "    if (have) { if (p.stair.length) have.stair = p.stair } else cols.push(p)\n", "    if (!have) cols.push(p)\n", async m => {
    reset(); noSite()
    const town = fakeTown({ items: [['cobblestone', 64], ['cobblestone', 64], ['cobblestone', 64], ['dirt', 4]] })
    await m.SKILLS.build_plinth.run({ bot: town.bot }, {}, { aborted: false })
    for (let n = 0; n < 6 && recNow().state === 'plan'; n++) { ageRecord(); await m.SKILLS.build_plinth.run({ bot: town.bot }, {}, { aborted: false }) }
    const plan = recNow().plan
    const col = m.knownWellCells(town.bot).find(c => c.x === plan.cap.x && c.y === plan.cap.y && c.z === plan.cap.z)
    assert.ok(!col?.stair?.length, 'the mutant drops it')
  })
})
await t('cognitive.mjs: the plinth order goes before the town deposit, and its outcome is fed back', () => cogPlinth(COG))
await t('MUTANT (cognitive): the deposit first, or the outcome line removed, is detected', () => {
  const m1 = COG.replace('order = this.#plinthOrder() ?? this.#townDepositOrder(milestone) ?? order', 'order = this.#townDepositOrder(milestone) ?? this.#plinthOrder() ?? order')
  assert.notEqual(m1, COG, 'MUTATION DID NOT APPLY'); assert.throws(() => cogPlinth(m1), /found 0/)
  const m2 = COG.replace("if (admitted.skill === 'build_plinth') this.plinthState = plinthOrderOutcome(r.status, Date.now(), this.plinthState ?? {}, r.failClass ?? null)", '')
  assert.notEqual(m2, COG, 'MUTATION DID NOT APPLY'); assert.throws(() => cogPlinth(m2), /found 0/)
})

// ---- COMPOSITION with digtown-01 (the `_dig_town` instrument wraps bot.dig on 8cd0bc62) ----
await t('DIGTOWN (composition, 8cd0bc62): the plinth\'s own digs (no dig scope; the runner\'s context supplied as build_plinth) through the real wrapper -- a leaf clear is vegetation (class free: counted in the summary, never a _dig_town row), the dirt cover is town ground (one row), purpose other. (No pathfinder dig is possible: the plinth walks on townWalkMovements, canDig=false -- not exercised here.)', async () => {
  const D = await import('../src/digtown.mjs')
  const attach = (bot) => {
    const rows = [], sums = []
    const h = D.attachDigTown(bot, { home: HOME, context: () => ({ skill: 'build_plinth', args: {} }), emitDig: r => rows.push(r), emitSummary: r => sums.push(r), timers: false })
    assert.ok(h, 'the instrument attached')
    return { h, rows, sums }
  }
  { // the approved leaf clear
    reset(); noSite()
    const town = fakeTown({ items: [['cobblestone', 64], ['cobblestone', 64], ['cobblestone', 64], ['dirt', 4]] })
    await visit(town)
    const plan = recNow().plan
    const s5 = plan.steps[5].c.join(',')
    town.world.set(s5, 'oak_leaves')
    const I = attach(town.bot)
    await buildTo(town, () => recNow().state !== 'plan')
    I.h.final()
    assert.ok(town.st.digs.includes(s5), 'positive control: the leaf was dug through the wrapper')
    const z = I.sums.reduce((a, r) => ({ ...a, ...r.args }), {})
    const leafKeys = Object.keys(z).filter(k => /^z_(zone|margin)_free_other_/.test(k))
    assert.ok(leafKeys.length >= 1 && I.sums.reduce((n, r) => n + (r.args.all ?? 0), 0) >= 1, `counted in the summary as free/other: ${JSON.stringify(z)}`)
    assert.ok(!I.rows.some(r => r.args.block === 'oak_leaves'), 'no _dig_town row for vegetation')
    assert.ok(!Object.keys(z).some(k => /_(target|transit|survival)_/.test(k)), `never target/transit/survival: ${JSON.stringify(z)}`)
  }
  { // the cover dug out of the hazard-covered column (town ground: one row)
    const { town, cap } = await coveredPitTown()
    const I = attach(town.bot)
    await visit(town)
    I.h.final()
    assert.ok(town.st.digs.includes(KEY(cap.x, cap.y, cap.z)), 'positive control: the cover was dug')
    const cover = I.rows.filter(r => r.args.x === cap.x && r.args.y === cap.y && r.args.z === cap.z)
    assert.equal(cover.length, 1, JSON.stringify(I.rows.map(r => r.detail)))
    assert.equal(cover[0].args.cls, 'ground'); assert.equal(cover[0].args.purpose, 'other'); assert.match(cover[0].args.by, /^build_plinth/)
  }
})

// THE TOWN'S NO-DIG ZONE x PLINTH (composition, plinth-01 on 75cfb447 = townzone-01 on 8cd0bc62). The zone refuses
// DISCRETIONARY target digs of town ground (gather, mine's stair, the ore tunnel) within TOWN_GROUND_HALF of home. The
// plinth stands inside that box and digs town ground itself (the dirt pit cover in its cap cell). Expected: the zone is ON
// in this suite (positive control: it refuses that very cover as a discretionary dig), yet the real build_plinth digs it
// and completes -- the plinth's own clears are not a target dig. And the finished plinth (every placed cell and its stair)
// is town ground the zone keeps from gather / mine / the tunnel. MUTANT: the zone applied to the plinth's cover dig ->
// the cover is never dug and the plinth never completes.
const zoneOf = async () => {
  const TG = await import('../src/townground.mjs')
  const { config } = await import('../src/config.mjs')
  return { TG, home: TG.configuredHome(config.world) }
}
await t('TOWNZONE (composition, 75cfb447): the zone is ON here and refuses the plinth\'s dirt cover as a discretionary dig (positive control), yet the real build_plinth digs that cover and completes; every placed cell and the stair end up town ground the zone keeps', async () => {
  const { TG, home } = await zoneOf()
  assert.deepEqual(home, HOME, 'the zone is on in this suite (HOME_X/Y/Z set)')
  const { town, cap } = await coveredPitTown()
  const capKey = KEY(cap.x, cap.y, cap.z)
  assert.equal(town.world.get(capKey), 'dirt', 'the cap cell holds the dirt cover')
  assert.equal(TG.inTownBox(cap, home), true, 'the plinth stands inside the town box')
  assert.equal(TG.townTargetPermit(cap, 'dirt', home).ok, false, 'positive control: the zone refuses a discretionary dig of this very cover')
  await buildTo(town, () => recNow().state !== 'plan')
  assert.ok(town.st.digs.includes(capKey), `the plinth dug its own cover: ${JSON.stringify(town.st.digs)}`)
  assert.equal(recNow().state, 'complete', 'and completed')
  const plan = recNow().plan
  const cells = [...plan.steps.filter(s => s.op === 'place').map(s => s.c), ...(plan.stair ?? [])]
  assert.ok(cells.length > 10, `cells: ${cells.length}`)
  const kept = cells.filter(c => { const n = town.read(c[0], c[1], c[2])?.name; return TG.townTargetPermit({ x: c[0], y: c[1], z: c[2] }, n, home).ok === false })
  assert.equal(kept.length, cells.length, `every placed cell is town ground the zone keeps: ${cells.length - kept.length} are not`)
})
await t('MUTANT (townzone x plinth): the zone applied to the plinth\'s cover dig -> the cover is never dug and the plinth never completes (the composition test above sees it)', async () => {
  const old = "            else if (!gw) try { await g.bound(bot.dig(bot.blockAt(new Vec3(c.x, c.y, c.z)), true), HK_CRAFT_MS, 'dig') }"
  const neu = "            else if (!gw && townTargetPermit(c, read(c.x, c.y, c.z)?.name, townHome()).ok) try { await g.bound(bot.dig(bot.blockAt(new Vec3(c.x, c.y, c.z)), true), HK_CRAFT_MS, 'dig') }"
  await withMutant(SP, old, neu, async m => {
    const { town, cap } = await coveredPitTown()
    const capKey = KEY(cap.x, cap.y, cap.z)
    for (let n = 0; n < 6 && recNow().state === 'plan'; n++) { ageRecord(); await m.SKILLS.build_plinth.run({ bot: town.bot }, {}, { aborted: false }) }
    assert.ok(!town.st.digs.includes(capKey), 'the mutant never digs the cover')
    assert.notEqual(recNow().state, 'complete', 'and never completes (its stall voids the plan)')
  })
})

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) console.log('FAILED:\n  ' + failed.join('\n  '))
try { rmSync(STORE, { recursive: true, force: true }) } catch {}
process.exit(fail ? 1 : 0)
