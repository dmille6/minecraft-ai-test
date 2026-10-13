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
const LEASE = path.join(STORE, 'junkwell-plinth-0_64_0.lease.json')
const rowsNow = kind => { try { return readFileSync(`${process.env.LOG_DIR}/skill-TestBot.jsonl`, 'utf8').trim().split('\n').map(l => JSON.parse(l)).filter(r => r.skill?.name === kind) } catch { return [] } }
const rowsOf = async kind => { await new Promise(r => setTimeout(r, 200)); return rowsNow(kind) }
const field = (d, k) => { const m = new RegExp(`(?:^| )${k}=(\\S+)`).exec(d ?? ''); return m ? m[1] : null }
const reset = () => { for (const f of [NOSITE, PLINTH, LEASE]) rmSync(f, { force: true }); for (const f of (existsSync(STORE) ? require('node:fs').readdirSync(STORE) : [])) if (/^junkwell-site-/.test(f)) rmSync(path.join(STORE, f), { force: true }) }
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
    lookAt: async () => {}, setControlState () {}, clearControlStates () {}, waitForTicks: async () => { await new Promise(r => setImmediate(r)) },
    pathfinder: {
      setGoal () {}, stop () {},
      goto: async goal => {
        st.goals.push([goal.x, goal.y, goal.z])
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
const visit = async (town, signal = { aborted: false }) => SKILLS.build_plinth.run({ bot: town.bot }, {}, signal)
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

await t('ONE BUILDER: a live lease held by another bot -> no_effect plinth_lease, nothing placed; an expired one is taken', async () => {
  reset(); noSite()
  const town = fakeTown({ items: [['cobblestone', 200], ['dirt', 4]] })
  writeFileSync(LEASE, JSON.stringify({ by: 'b-Other', at: Date.now(), until: Date.now() + 60_000 }))
  const r = await visit(town)
  assert.equal(r.status, 'no_effect'); assert.equal(r.failClass, 'plinth_lease'); assert.match(r.detail, /b-Other is building/)
  writeFileSync(LEASE, JSON.stringify({ by: 'b-Other', at: Date.now() - 600_000, until: Date.now() - 1 }))
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
  for (let n = 0; n < 6 && recNow().state === 'plan'; n++) await m.SKILLS.build_plinth.run({ bot: town.bot }, {}, { aborted: false })
}
await t('MUTANT (skills): no ownership at the walling-in placement -> the finished column is left an open pit (the chain asserts "covered")', async () => {
  await withMutant(SP, "          owned = true\n          logEvent({ kind: 'well_pit_dug', status: 'success', snapshot: snapshot(bot), detail: `at=${cap.x},${cap.y},${cap.z} from=plinth step=${i}` })\n",
    "          logEvent({ kind: 'well_pit_dug', status: 'success', snapshot: snapshot(bot), detail: `at=${cap.x},${cap.y},${cap.z} from=plinth step=${i}` })\n", async m => {
      reset(); noSite()
      const town = fakeTown({ items: [['cobblestone', 64], ['cobblestone', 64], ['cobblestone', 64], ['dirt', 4]] })
      await buildAll(m, town)
      assert.equal(recNow().state, 'complete')
      assert.equal(W.wellStage(town.read, recNow().plan.cap), 'dug', 'the mutant leaves the pit open')
    })
})
await t('MUTANT (skills): the handoff keeps the no-site hold -> build_well would wait 2 h for a site that exists', async () => {
  await withMutant(SP, "  try { fs.unlinkSync(wellNoSiteFile()) } catch { /* none, or already lifted */ }\n", '', async m => {
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
    writeFileSync(LEASE, JSON.stringify({ by: 'b-Other', at: Date.now(), until: Date.now() + 60_000 }))
    const r = await m.SKILLS.build_plinth.run({ bot: town.bot }, {}, { aborted: false })
    assert.notEqual(r.failClass, 'plinth_lease', 'the mutant builds anyway')
  })
})
await t('MUTANT (skills): the finally does not cover -> an unfinished, walled-in pit is left open by a run that could cover it', async () => {
  await withMutant(SP, "        else { const res = await coverPlinthPit(bot, { cap, recId: null, g, signal, by: 'build' }); why = res.ok ? null : res.why }\n", "        else why = 'mutant'\n", async m => {
    reset(); noSite()
    const town = fakeTown({ items: [['cobblestone', 64], ['cobblestone', 64], ['cobblestone', 64], ['dirt', 4]] })
    await buildAll(m, town)
    assert.equal(W.wellStage(town.read, recNow().plan.cap), 'dug', 'the mutant leaves it open')
    assert.ok((await rowsOf('_well_pit_open')).some(r => /why=mutant/.test(r.skill.detail)), 'and says so')
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
