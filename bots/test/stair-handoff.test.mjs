// SHAFTTRAP-02: THE REFLEXES HAND A BOT ON THE TOWN STAIR TO THE EGRESS FIRST (bots/src/shaftgeom.mjs egressHandoff / egressDue /
// stairTrapOn, bots/src/reflex.mjs deepTripOnStair + the marooned and entombed arms' hooks, bots/src/skills.mjs stairStandingOn /
// stairEgressReflex / stairAscend). LIVE fleet 11-02 00:00Z..11-03 22:00Z (46 h, 80 bots, 14 of 16 towns with a complete stair):
// 1,429 trap episodes began ON a stair (first row `_entombed` 995, `_marooned` 431), mostly after gather/goto/explore rather than
// a stair visit; 553 pillared into the stair's air cells, 749 met the escape guard, 163 ended in `_needs_rescue record=shaft`.
// THE REFUSAL CHAIN tested here, on the real mineflayer-pathfinder A* over a fleet stair's geometry (board-a: origin from the
// record, K 55): the arm's probe is false in the spiral -> the hand-over runs the egress -> out (the probe succeeds at the exit,
// no pillar) | nothing gained -> today's escape, at once, and not the egress again from that step for EGRESS_RETRY_MS (no loop,
// no new dead end) | progress -> the next firing starts higher | pre-empted -> no escape either (the new owner keeps the body).
import assert from 'node:assert'
import { createRequire } from 'node:module'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import * as G from '../src/shaftgeom.mjs'
import { runStairEgress, stairBotEffects } from '../src/shaftvisit.mjs'
const require_ = createRequire(import.meta.url)
const { Movements, goals } = require_('mineflayer-pathfinder')
const AStar = require_('mineflayer-pathfinder/lib/astar')
const Move = require_('mineflayer-pathfinder/lib/move')
const { Vec3 } = require_('vec3')
const registry = require_('prismarine-registry')('1.21.8')
const Block = require_('prismarine-block')(registry)

let pass = 0, fail = 0
const t = async (name, fn) => { try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 6).join('\n        ')}`) } }
const k3 = (x, y, z) => `${x},${y},${z}`
const GEOM = new URL('../src/shaftgeom.mjs', import.meta.url)
const REFLEX = new URL('../src/reflex.mjs', import.meta.url)
const SKILLS = new URL('../src/skills.mjs', import.meta.url)
const VISIT = new URL('../src/shaftvisit.mjs', import.meta.url)

// ---- a fleet stair (board-a's record 11-03: g 70, K 55, landings 48/32/16) on a fake world -------------------------------
const SITE = { origin: { x: 367, z: 122 }, away: 'n', g: 70 }
const PLAN = G.planStair({ ...SITE, K: 55, landings: [48, 32, 16] })
function world (plan = PLAN) {
  const at = new Map()
  for (const c of plan.cells) at.set(k3(...c.at), c.role === 'air' ? 'air' : 'stone')
  const name = (x, y, z) => at.get(k3(x, y, z)) ?? (y <= plan.g ? 'stone' : 'air')
  const BB = n => (/^(air|cave_air|water|lava|torch|wall_torch)$/.test(n) ? 'empty' : 'block')
  const read = (x, y, z) => { const n = name(x, y, z); return { name: n, boundingBox: BB(n) } }
  const blockAt = p => { const b = Block.fromStateId(registry.blocksByName[name(p.x, p.y, p.z)].defaultState, 0); b.position = new Vec3(p.x, p.y, p.z); return b }
  return { at, name, read, blockAt, set: (c, n) => at.set(k3(...c), n) }
}
function movesFor (blockAt) {
  const bot = { registry, version: '1.21.8', blockAt, entity: { position: new Vec3(0.5, 64, 0.5), effects: {} }, entities: {},
    inventory: { items: () => [] }, pathfinder: { bestHarvestTool: () => null }, game: { minY: -64, height: 384 } }
  const m = new Movements(bot); m.canDig = false; m.allowParkour = false; m.allow1by1towers = false; m.scafoldingBlocks = []; m.maxDropDown = 6
  return m
}
function astar (m, from, goal) {
  const a = new AStar(new Move(from[0], from[1], from[2], 0, 0), m, goal, 5_000, 40, -1)
  let r = a.compute(), n = 0
  while (r.status === 'partial' && n++ < 400) r = a.compute()
  return r
}
function body (w, feet, { aborted = () => false } = {}) {
  const st = { feet: [...feet], walks: [], digs: [] }
  const e = {
    get read () { return w.read },
    feet: () => [...st.feet],
    walkTo: async c => {
      st.walks.push(c)
      const r = astar(movesFor(w.blockAt), st.feet, new goals.GoalBlock(c[0], c[1], c[2]))
      if (r.status !== 'success') return false
      st.feet = [...c]
      return true
    },
    dig: async c => { st.digs.push(c); w.set(c, 'air'); return 'confirmed' },
    now: () => 0, aborted, log: () => {},
  }
  return { st, e }
}
const probe = (w, feet) => astar(movesFor(w.blockAt), feet, new goals.GoalNear(feet[0] + 8, feet[1], feet[2] + 8, 3)).status === 'success'
const exitCell = [366, 71, 124]   // board-a's record `exit`
/**
 * THE ARM, AS WIRED (reflex.mjs): the egress first, then egressHandoff decides; 'fallthrough' runs today's escape (here: a
 * marker), every other answer ends the firing without it. The memo is the arm's; `now` the arm's clock. -> { h, escaped, r }.
 */
async function armFiring (G_, w, st, e, memo, now) {
  const on = G.stairStepAt(PLAN, st.feet)
  if (!on || !G_.egressDue(memo, on.k, now)) return { h: 'skip', escaped: true, r: null }
  let r
  try { r = { ran: true, ...(await runStairEgress(PLAN, e, { exit: exitCell })) } } catch (err) { r = err?.aborted ? { ran: true, aborted: true } : { ran: true, ok: false, why: 'threw' } }
  const h = G_.egressHandoff(r)
  if (h === 'fallthrough' || (h === 'retry' && (Number(r?.hops) || 0) > 0)) { memo.k = on.k; memo.at = now } else if (h === 'out') memo.k = null
  return { h, escaped: h === 'fallthrough' || h === 'skip', r }
}

console.log('1. THE DECISIONS (pure)')
await t('egressHandoff: not run -> skip; pre-empted -> yield; out -> out; progress -> retry; nothing gained -> fallthrough', () => {
  assert.strictEqual(G.egressHandoff(null), 'skip')
  assert.strictEqual(G.egressHandoff({ ran: false, why: 'off_stair' }), 'skip')
  assert.strictEqual(G.egressHandoff({ ran: true, aborted: true }), 'yield')
  assert.strictEqual(G.egressHandoff({ ran: true, ok: true, why: 'arrived', hops: 15 }), 'out')
  assert.strictEqual(G.egressHandoff({ ran: true, ok: false, why: 'wet', hops: 3, cleared: 0 }), 'retry')
  assert.strictEqual(G.egressHandoff({ ran: true, ok: false, why: 'time', hops: 0, cleared: 1 }), 'retry')
  for (const why of ['wet', 'tread', 'unknown', 'occupied', 'hop', 'dig_refused', 'clears', 'exit_walk', 'via', 'time', 'threw:x']) {
    assert.strictEqual(G.egressHandoff({ ran: true, ok: false, why, hops: 0, cleared: 0 }), 'fallthrough', why)
  }
})
await t('egressDue: a failed step waits EGRESS_RETRY_MS; another step, or after the wait, is due; no step is never due', () => {
  const m = { k: 40, at: 1_000 }
  assert.strictEqual(G.egressDue(m, 40, 1_000 + G.EGRESS_RETRY_MS - 1), false)
  assert.strictEqual(G.egressDue(m, 40, 1_000 + G.EGRESS_RETRY_MS), true)
  assert.strictEqual(G.egressDue(m, 39, 1_001), true, 'a higher step is a new place')
  assert.strictEqual(G.egressDue({ k: null, at: 0 }, 40, 0), true)
  assert.strictEqual(G.egressDue(m, null, 0), false)
})
await t('stairTrapOn: on by default; SHAFTTRAP=0/off/false/no restores the base', () => {
  assert.strictEqual(G.stairTrapOn({}), true)
  for (const v of ['0', 'off', 'false', 'no', ' OFF ']) assert.strictEqual(G.stairTrapOn({ SHAFTTRAP: v }), false, v)
  assert.strictEqual(G.stairTrapOn({ SHAFTTRAP: '1' }), true)
})
await t('deepTripOnStair: a deep miner\'s open trip (descend/deepen/work/return) is never walked up; closed or stale is', async () => {
  const { deepTripOnStair } = await import('../src/reflex.mjs')
  const now = 10 * 3_600_000
  for (const phase of ['descend', 'deepen', 'work', 'return']) assert.strictEqual(deepTripOnStair({ phase, startedAt: now - 60_000 }, now), true, phase)
  assert.strictEqual(deepTripOnStair({ phase: 'closed', startedAt: now - 60_000 }, now), false)
  assert.strictEqual(deepTripOnStair({ phase: 'descend', startedAt: now - 2 * 3_600_000 }, now), false, 'a stale descent')
  assert.strictEqual(deepTripOnStair(null, now), false)
})

await t('stairWalkThroughNow: only a running skill whose pathfinder is moving the bot on the stair', () => {
  assert.strictEqual(G.stairWalkThroughNow({ busy: true, moving: true, on: true }), true)
  for (const x of [{ busy: false, moving: true, on: true }, { busy: true, moving: false, on: true }, { busy: true, moving: true, on: false }, {}]) assert.strictEqual(G.stairWalkThroughNow(x), false, JSON.stringify(x))
})

console.log('2. THE CHAIN ON A FLEET STAIR (the real A*)')
await t('BEFORE: idle at step 44 the arm\'s probe is false (it would pillar), the walk out exists', () => {
  const w = world()
  const s = G.standOf(PLAN, 44)
  assert.strictEqual(probe(w, s), false, 'the maroon arm\'s probe in the spiral')
  assert.strictEqual(astar(movesFor(w.blockAt), s, new goals.GoalBlock(...exitCell)).status, 'success', 'the stair walk out')
})
await t('AFTER: dirt an earlier escape pillared into three air cells -> the hand-over digs them out and ends at the collar: out, no escape', async () => {
  const w = world()
  const blocks = [PLAN.steps[44].air[2], PLAN.steps[30].air[0], PLAN.steps[9].air[1]]
  for (const c of blocks) w.set(c, 'dirt')
  const { st, e } = body(w, G.standOf(PLAN, 44))
  const memo = { k: null, at: 0 }
  const f = await armFiring(G, w, st, e, memo, 0)
  assert.strictEqual(f.h, 'out', JSON.stringify(f.r))
  assert.strictEqual(f.escaped, false, 'no pillar, no ramp')
  assert.strictEqual(f.r.cleared, 3)
  assert.deepStrictEqual(new Set(st.digs.map(c => c.join(','))), new Set(blocks.map(c => c.join(','))), 'only the foreign blocks')
  for (const c of PLAN.cells) if (c.role !== 'air') assert.strictEqual(w.name(...c.at), 'stone', `record cell ${c.at} untouched`)
  assert.strictEqual(G.stairStepAt(PLAN, st.feet)?.k ?? 0, 0, 'at the collar')
})
await t('REFUSAL CHAIN: water beside the bot -> nothing gained -> today\'s escape runs NOW; the next firings go straight to it until the wait ends', async () => {
  const w = world()
  w.set(PLAN.steps[43].air[1], 'water')
  const { st, e } = body(w, G.standOf(PLAN, 44))
  const memo = { k: null, at: 0 }
  const f1 = await armFiring(G, w, st, e, memo, 0)
  assert.strictEqual(f1.h, 'fallthrough', JSON.stringify(f1.r)); assert.strictEqual(f1.r.why, 'wet')
  assert.strictEqual(f1.escaped, true, 'the escape the arm had before still runs: no new dead end')
  assert.strictEqual(st.digs.length, 0, 'the water\'s barrier is never dug')
  const f2 = await armFiring(G, w, st, e, memo, 15_000)
  assert.strictEqual(f2.h, 'skip', 'no egress again from the same step inside the wait (no loop)'); assert.strictEqual(f2.r, null)
  assert.strictEqual(f2.escaped, true)
  const f3 = await armFiring(G, w, st, e, memo, G.EGRESS_RETRY_MS)
  assert.strictEqual(f3.h, 'fallthrough', 'after the wait it is tried again (the water may be gone)')
})
await t('PROGRESS THEN A STOP: water higher up -> retry (the firing ends higher), then the next firing falls through: bounded', async () => {
  const w = world()
  w.set(PLAN.steps[20].air[1], 'water')
  const { st, e } = body(w, G.standOf(PLAN, 44))
  const memo = { k: null, at: 0 }
  const f1 = await armFiring(G, w, st, e, memo, 0)
  assert.strictEqual(f1.h, 'retry', JSON.stringify(f1.r)); assert.ok(f1.r.hops > 0)
  const k1 = G.stairStepAt(PLAN, st.feet).k
  assert.ok(k1 < 44 && k1 >= 20, `climbed to ${k1}`)
  const f2 = await armFiring(G, w, st, e, memo, 60_000)
  assert.strictEqual(f2.h, 'fallthrough', JSON.stringify(f2.r))
  assert.strictEqual(f2.escaped, true)
})
await t('PRE-EMPTED: the drowning rescue takes the body mid-way -> yield: no escape is started over the new owner', async () => {
  const w = world()
  let n = 0
  const { st, e } = body(w, G.standOf(PLAN, 44), { aborted: () => ++n > 3 })
  const f = await armFiring(G, w, st, e, { k: null, at: 0 }, 0)
  assert.strictEqual(f.h, 'yield'); assert.strictEqual(f.escaped, false)
  assert.ok(st.walks.length >= 1, 'POSITIVE CONTROL: it had started walking')
})
await t('OFF THE STAIR: a cave beside it is not handed over (skip -> today\'s escape, unchanged)', async () => {
  const w = world()
  const { st, e } = body(w, [SITE.origin.x + 12, 40, SITE.origin.z + 12])
  const f = await armFiring(G, w, st, e, { k: null, at: 0 }, 0)
  assert.strictEqual(f.h, 'skip'); assert.strictEqual(f.escaped, true)
  assert.strictEqual(st.walks.length, 0)
})

/** stairBotEffects' dig on a fake bot: counts equips and server digs; `during` runs inside the equip (a rescue taking the body). */
async function digWith (SVmod, signal, during = () => {}, { dig = 'confirmed', probes = [] } = {}) {
  const n = { equip: 0, dig: 0, probe: 0 }
  const bot = { blockAt: () => ({ name: 'dirt' }), heldItem: null, inventory: { items: () => [{ name: 'stone_pickaxe', maxDurability: 131, durabilityUsed: 0 }] },
    equip: async () => { n.equip++; during() } }
  const e = SVmod.stairBotEffects(bot, { dig: async () => { n.dig++; return dig }, probe: async () => { n.probe++; return probes.shift() ?? null }, feet: () => [0, 0, 0] }, { signal })
  const r = await e.dig([0, 0, 0])
  return { r, n }
}
await t('Codex r1 blocker 2: no equip and no dig once the signal is aborted; a rescue taking the body during the equip stops the dig', async () => {
  const a = await digWith({ stairBotEffects }, { aborted: true })
  assert.strictEqual(a.r, 'aborted'); assert.deepStrictEqual(a.n, { equip: 0, dig: 0, probe: 0 })
  const sig = { aborted: false }
  const b = await digWith({ stairBotEffects }, sig, () => { sig.aborted = true })
  assert.strictEqual(b.r, 'aborted'); assert.deepStrictEqual(b.n, { equip: 1, dig: 0, probe: 0 })
  const c = await digWith({ stairBotEffects }, { aborted: false })
  assert.strictEqual(c.r, 'confirmed', 'POSITIVE CONTROL: owned, it digs'); assert.deepStrictEqual(c.n, { equip: 1, dig: 1, probe: 0 })
})

await t('Paper 11-03: an unconfirmed dig asks the server (the probe, at most twice): air confirms, a block stands, silence stays unconfirmed', async () => {
  assert.strictEqual((await digWith({ stairBotEffects }, { aborted: false }, () => {}, { dig: 'unconfirmed', probes: ['dirt'] })).r, 'standing')
  assert.strictEqual((await digWith({ stairBotEffects }, { aborted: false }, () => {}, { dig: 'unconfirmed', probes: [null, 'air'] })).r, 'confirmed')
  const q = await digWith({ stairBotEffects }, { aborted: false }, () => {}, { dig: 'unconfirmed', probes: [] })
  assert.strictEqual(q.r, 'unconfirmed'); assert.strictEqual(q.n.probe, 2)
  assert.strictEqual((await digWith({ stairBotEffects }, { aborted: false }, () => {}, { dig: 'confirmed' })).n.probe, 0, 'a confirmed dig is not probed')
})

console.log('3. WIRING (comments stripped; anchored on executable lines)')
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map(l => l.replace(/(^|[^:'"`])\/\/.*$/, '$1')).join('\n')
const RSRC = strip(readFileSync(REFLEX, 'utf8'))
const SSRC = strip(readFileSync(SKILLS, 'utf8'))
const span = (src, from, to) => { const a = src.indexOf(from); assert.ok(a >= 0, `anchor ${from}`); const b = src.indexOf(to, a); assert.ok(b > a, `anchor ${to}`); return src.slice(a, b) }
await t('the marooned arm: the hand-over runs after the state and BEFORE the scaffold branch and the climb\'s pillar', () => {
  const arm = span(RSRC, 'let mstate = (!upIsOpen || entombedNow)', "if (mstate === 'climb' && !pocketing")
  const hook = arm.indexOf("h = await stairExitFirst('marooned'")
  assert.ok(hook > 0, 'the hook is in the arm')
  assert.ok(hook < arm.indexOf("mstate === 'need_scaffold' && !inDanger"), 'before the scaffold/ramp branch')
  assert.ok(/if \(h === 'out' \|\| h === 'yield' \|\| h === 'retry'\) mstate = 'none'/.test(arm), 'out/yield/retry stand the lattice down')
})
await t('the entombed arm: the hand-over runs after takeBody and BEFORE pillarOut; out clears the counters and returns', () => {
  const arm = span(RSRC, "entombedGrant = await takeBody(bot, runner, 'entombed', PRIORITY.escape)", 'climbed = await pillarOut(')
  assert.ok(arm.includes("await stairExitFirst('entombed', () => entombedGrant, stairOn)"))
  assert.ok(/if \(h === 'out'\) \{ escapeFailures = 0;[^}]*return \}/.test(arm))
  assert.ok(arm.includes("if (h === 'yield' || h === 'retry') return"))
})
await t('the entombed arm\'s give-up (the pickaxe ask) waits while a hand-over is due; after a fall-through it runs as before', () => {
  assert.ok(RSRC.includes('if (escapeFailures >= ESCAPE_GIVE_UP_AFTER && !ceilingFloodRisk(bot) && !stairExitCandidate()) {'))
  const h = span(RSRC, 'const stairExitFirst = async', 'return h\n')
  assert.ok(h.includes("if (h === 'fallthrough' || (h === 'retry' && (Number(r?.hops) || 0) > 0)) { stairEgressMemo.k = on.k; stairEgressMemo.at = Date.now() }"), 'the memo makes the candidate null for that step')
})
await t('the egress runs only with the arm\'s grant and stops when the drowning rescue or the air pocket wants the body', () => {
  const h = span(RSRC, 'const stairExitFirst = async', 'return h\n')
  assert.ok(h.includes('!grantOf()'), 'no grant (the arbiter refused) -> skip')
  assert.ok(h.includes('alive: () => ownsBody(grantOf)() && !airPocketWanted() && !drowningOwnsBody()'))
  const c = span(RSRC, 'const stairExitCandidate = () =>', 'const stairExitFirst')
  assert.ok(c.includes("deepTripOnStair(bot.deepTrip) || runner?.bodyClaimFor?.('stair')"), 'a deep trip or a stair claim is never walked up')
})
await t('stairAscend: on the stair the egress (visitEgress) replaces the plan; off it the plan runs as before', () => {
  const a = span(SSRC, 'export async function stairAscend', '\n}\n')
  const on = a.indexOf('if (stairStandingOn(bot)) {')
  assert.ok(on > 0 && on < a.indexOf('const plan = async'), 'before the plan')
  assert.ok(a.slice(on, a.indexOf('const plan = async')).includes('visitEgress(bot, rec, signal'))
})

await t('the entombed arm waits while a walk moves through the stair (before tombDeclines, so a decline is not paid for it)', () => {
  const cond = span(RSRC, "if (!escaping && !marooned && !climbing && !inDanger && isEntombed(bot)", '!tombDeclines()) {')
  assert.ok(cond.includes('!stairWalkThrough() &&'), 'in the arm\'s condition')
  assert.ok(cond.indexOf('!stairWalkThrough()') > 0, 'before the decline (the span ends at it)')
  const w = span(RSRC, 'const stairWalkThrough = () =>', 'const stairExitFirst')
  assert.ok(w.includes('stairWalkThroughNow({ busy: runner.isBusy(), moving: !!bot.pathfinder?.isMoving?.(), on: !!stairStandingOn(bot) })'))
})

console.log('4. MUTANTS (each anchor present and unique)')
async function withMutant (url, old, neu, fn) {
  const src = readFileSync(url, 'utf8')
  assert.strictEqual(src.split(old).length, 2, 'ANCHOR MISSING OR NOT UNIQUE')
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, src.replace(old, neu).replace(/from '\.\//g, "from '../src/"))
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch { /* gone */ } }
}
await t('MUTANT KILLED: without the same-step wait the arm re-runs a failing egress before every escape (a loop)', async () => {
  await withMutant(GEOM, 'return !(memo.k === k && now - (Number(memo.at) || 0) < retryMs)', 'return true', async M => {
    const w = world(); w.set(PLAN.steps[43].air[1], 'water')
    const { st, e } = body(w, G.standOf(PLAN, 44))
    const memo = { k: null, at: 0 }
    await armFiring(M, w, st, e, memo, 0)
    const f2 = await armFiring(M, w, st, e, memo, 15_000)
    assert.strictEqual(f2.h, 'fallthrough', 'the mutant runs the egress again at once')
    assert.notStrictEqual(f2.r, null)
  })
})
await t('MUTANT KILLED: a pre-emption read as nothing gained starts the escape over the new owner', async () => {
  await withMutant(GEOM, "if (r.aborted) return 'yield'\n", '', async M => {
    let n = 0
    const w = world()
    const { st, e } = body(w, G.standOf(PLAN, 44), { aborted: () => ++n > 3 })
    const f = await armFiring(M, w, st, e, { k: null, at: 0 }, 0)
    assert.strictEqual(f.escaped, true, 'the mutant escapes after a pre-emption')
  })
})
await t('MUTANT KILLED: progress read as nothing gained pillars from a step the egress already left behind', async () => {
  await withMutant(GEOM, "if ((Number(r.hops) || 0) > 0 || (Number(r.cleared) || 0) > 0) return 'retry'\n", '', async M => {
    const w = world(); w.set(PLAN.steps[20].air[1], 'water')
    const { st, e } = body(w, G.standOf(PLAN, 44))
    const f = await armFiring(M, w, st, e, { k: null, at: 0 }, 0)
    assert.strictEqual(f.h, 'fallthrough', 'the mutant falls through after climbing')
  })
})

await t('MUTANT KILLED: without the check after the equip, the dig starts after a rescue took the body', async () => {
  await withMutant(VISIT, "      await equipFor(c)\n      if (signal?.aborted) return 'aborted'\n", '      await equipFor(c)\n', async M => {
    const sig = { aborted: false }
    const b = await digWith(M, sig, () => { sig.aborted = true })
    assert.strictEqual(b.n.dig, 1, 'the mutant digs')
  })
})

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
