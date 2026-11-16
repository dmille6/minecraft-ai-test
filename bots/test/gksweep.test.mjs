// GKSWEEP-01: the groundskeeper picks up what lies inside the walls (owner 11-04, piece 6: "if the bot drops dirt it can pick it
// up"). The choice (gksweep.mjs sweepPick) on lists; the walk (skills.mjs gkSweep) on a fake bot whose walk onto a drop collects it.
import assert from 'node:assert'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
const S = await import('../src/gksweep.mjs')
const { gkSweep } = await import('../src/skills.mjs')

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 5).join('\n        ')}`) }
}
const SWEEP_PATH = new URL('../src/gksweep.mjs', import.meta.url)
const SKILLS_PATH = new URL('../src/skills.mjs', import.meta.url)
async function withMutant (p, old, neu, fn) {
  const src = readFileSync(p, 'utf8')
  assert.ok(src.includes(old), `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 60))}`)
  assert.ok(src.split(old).length === 2, 'ANCHOR NOT UNIQUE')
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, src.replace(old, neu).replace(/from '\.\//g, "from '../src/"))
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1')
const HOME = { x: 0, y: 70, z: 0 }
const BOX = [[-20, -20, 20, 20]]
const drop = (id, name, x, z, count = 1, y = 70) => ({ id, name, count, pos: { x: x + 0.5, y, z: z + 0.5 } })

console.log('THE CHOICE (sweepPick)')
await t('inside the walls, nearest first; never outside the boxes, deep below, at a well, nor the fleet\'s junk', async () => {
  const r = S.sweepPick([drop(1, 'dirt', 5, 0), drop(2, 'dirt', 2, 0), drop(3, 'dirt', 30, 0), drop(4, 'cobblestone', 3, 3, 1, 50),
    drop(5, 'dirt', 11, 10), drop(6, 'wheat_seeds', 1, 1), drop(7, 'oak_sapling', -4, -4)], { boxes: BOX, home: HOME, caps: [[10, 70, 10]], free: 20, never: new Set(['wheat_seeds']) })
  assert.deepStrictEqual(r.picks.map(d => d.id), [2, 7, 1])
  assert.deepStrictEqual(r.skipped, { outside: 1, depth: 1, well: 1, junk: 1 })
  assert.strictEqual(r.seen, 7)
})
await t('THE BAG: a drop goes into the room of the bag\'s own stack first; a new slot only while more than freeMin stay free; a station over its allowance never', async () => {
  const T = S.GKSWEEP
  // 7 free: one new slot leaves 6 (= freeMin): allowed; the second would leave 5
  const r = S.sweepPick([drop(1, 'dirt', 1, 0, 10), drop(2, 'cobblestone', 2, 0), drop(3, 'gravel', 3, 0), drop(4, 'crafting_table', 4, 0)],
    { boxes: BOX, home: HOME, free: T.freeMin + 1, stacks: [{ name: 'dirt', count: 60, stackSize: 64 }], over: n => n === 'crafting_table' })
  // the dirt (10 > the 4 left in its stack) takes the one new slot that leaves freeMin free; the cobblestone and the gravel find none
  assert.deepStrictEqual(r.picks.map(d => d.id), [1], JSON.stringify(r))
  assert.deepStrictEqual(r.skipped, { bag_full: 2, allowance: 1 })
  // the dirt's own new stack has room left (64 - 6): a second dirt drop fits it without a slot
  const r2 = S.sweepPick([drop(1, 'dirt', 1, 0, 10), drop(2, 'dirt', 2, 0, 30)], { boxes: BOX, home: HOME, free: T.freeMin + 1, stacks: [{ name: 'dirt', count: 60, stackSize: 64 }] })
  assert.deepStrictEqual(r2.picks.map(d => d.id), [1, 2])
})
await t('the bag at freeMin: only drops that fit the bag\'s own stacks; at most GKSWEEP.max picks', async () => {
  const T = S.GKSWEEP
  const r = S.sweepPick([drop(1, 'dirt', 1, 0, 3), drop(2, 'cobblestone', 2, 0)], { boxes: BOX, home: HOME, free: T.freeMin, stacks: [{ name: 'dirt', count: 10, stackSize: 64 }] })
  assert.deepStrictEqual(r.picks.map(d => d.id), [1])
  assert.deepStrictEqual(r.skipped, { bag_full: 1 })
  const many = [...Array(10)].map((_, i) => drop(i, 'dirt', i, 0))
  const m = S.sweepPick(many, { boxes: BOX, home: HOME, free: 30 })
  assert.strictEqual(m.picks.length, T.max); assert.strictEqual(m.skipped.max, 10 - T.max)
  // the mutant: no bag check -> the full bag takes the cobblestone
  await withMutant(SWEEP_PATH, "    if (slots - 1 < T.freeMin) { skip('bag_full'); continue }\n", '', async M => {
    assert.strictEqual(M.sweepPick([drop(1, 'dirt', 1, 0, 3), drop(2, 'cobblestone', 2, 0)], { boxes: BOX, home: HOME, free: T.freeMin, stacks: [{ name: 'dirt', count: 10, stackSize: 64 }] }).picks.length, 2)
  })
})
await t('no boxes (no home or no wall read): nothing', async () => {
  assert.deepStrictEqual(S.sweepPick([drop(1, 'dirt', 1, 0)], { boxes: [], home: HOME }).picks, [])
  assert.deepStrictEqual(S.sweepPick([drop(1, 'dirt', 1, 0)], { boxes: BOX, home: null }).picks, [])
})
await t('sweepAfter: a keeper or a helper, after a visit that did not fail and still holds the grounds; never another bot', async () => {
  assert.strictEqual(S.sweepAfter('keeper', { status: 'no_effect', stop: 'complete' }), true)
  assert.strictEqual(S.sweepAfter('helper', { status: 'success', stop: 'budget' }), true)
  assert.strictEqual(S.sweepAfter(null, { status: 'no_effect', stop: 'complete' }), false)
  assert.strictEqual(S.sweepAfter('keeper', { status: 'failed', stop: 'error' }), false)
  for (const stop of ['keeper_held', 'keeper_term', 'keeper_rest', 'record_unreadable']) assert.strictEqual(S.sweepAfter('keeper', { status: 'no_effect', stop }), false, stop)
  assert.strictEqual(S.gkSweepOn({}), true); assert.strictEqual(S.gkSweepOn({ GKSWEEP: 'off' }), false)
  // Codex r1 BLOCKER: the leases as they are NOW (helperDecision's words): the keeper's, or one of the helper leases -- else no sweep
  assert.strictEqual(S.holdsGrounds('keeper'), true); assert.strictEqual(S.holdsGrounds('mine'), true)
  for (const d of ['take', 'full', 'none', 'no_keeper', undefined]) assert.strictEqual(S.holdsGrounds(d), false, String(d))
})

console.log('THE WALK (skills.mjs gkSweep on a fake bot)')
const V = (x, y, z) => ({ x, y, z, distanceTo (o) { return Math.hypot(this.x - o.x, this.y - o.y, this.z - o.z) } })
function fakeBot (drops, { inv = [], free = 20, unreachable = new Set(), stuck = new Set() } = {}) {
  const bag = inv.map(i => ({ ...i }))
  const entities = Object.fromEntries(drops.map(d => [d.id, { id: d.id, name: 'item', position: V(d.pos.x, d.pos.y, d.pos.z), getDroppedItem: () => ({ name: d.name, count: d.count }) }]))
  const walked = []
  const bot = {
    username: 'showcase-Test', entity: { position: V(0, 70, 0) }, entities,
    inventory: { items: () => bag, emptySlotCount: () => free },
    pathfinder: {
      async goto (goal) {
        const e = Object.values(entities).find(q => Math.floor(q.position.x) === Math.floor(goal.x) && Math.floor(q.position.z) === Math.floor(goal.z))
        walked.push(e?.id)
        if (!e) return
        if (unreachable.has(e.id)) throw new Error('NoPath')
        if (stuck.has(e.id)) return
        bot.entity.position = V(goal.x, goal.y, goal.z)
        const d = e.getDroppedItem()
        const s = bag.find(i => i.name === d.name)
        if (s) s.count += d.count; else bag.push({ name: d.name, count: d.count, stackSize: 64 })
        delete entities[e.id]
      },
    },
  }
  return { bot, walked, bag }
}
const INPUTS = () => ({ home: HOME, wall: { ring: [-21, -21, 21, 21] }, wallext: null, caps: [[10, 70, 10]] })
await t('it walks to the drops inside the walls and counts what the BAG gained (a drop it could not reach is not counted)', async () => {
  const { bot, walked, bag } = fakeBot([drop(1, 'dirt', 3, 0, 2), drop(2, 'cobblestone', 6, 0), drop(3, 'dirt', 40, 0), drop(4, 'dirt', 10, 11), drop(5, 'oak_sapling', -5, 0)],
    { unreachable: new Set([5]) })
  const r = await gkSweep(bot, null, { inputs: INPUTS, until: Date.now() + 60_000 })
  assert.deepStrictEqual(walked.sort(), [1, 2, 5])
  assert.strictEqual(r.took, 3); assert.strictEqual(r.kinds, 'dirt:2,cobblestone:1')
  assert.deepStrictEqual(bag.map(i => `${i.name}:${i.count}`), ['dirt:2', 'cobblestone:1'])
  assert.deepStrictEqual(r.skipped, { outside: 1, well: 1 })
})
await t('nothing in view near the town: no read of the records at all; an unreadable read: nothing walked', async () => {
  let read = 0
  const { bot, walked } = fakeBot([drop(1, 'dirt', 300, 0)])
  const r = await gkSweep(bot, null, { inputs: () => { read++; return INPUTS() } })
  assert.strictEqual(read, 0); assert.strictEqual(r.took, 0); assert.deepStrictEqual(walked, [])
  const b2 = fakeBot([drop(1, 'dirt', 3, 0)])
  const r2 = await gkSweep(b2.bot, null, { inputs: () => { throw new Error('unreadable') } })
  assert.strictEqual(r2.took, 0); assert.deepStrictEqual(b2.walked, [])
})
await t('the budget: past `until` no walk starts', async () => {
  const { bot, walked } = fakeBot([drop(1, 'dirt', 3, 0)])
  const r = await gkSweep(bot, null, { inputs: INPUTS, until: Date.now() + 1000 })
  assert.deepStrictEqual(walked, []); assert.strictEqual(r.skipped.budget, 1)
})

console.log('THE WIRING (structural)')
await t('buildTidy runs the visit, then the sweep for its crew role; the visit leaves the role; a sweep that took turns no_effect into success', async () => {
  const s = strip(readFileSync(SKILLS_PATH, 'utf8'))
  assert.ok(/const res = await buildTidyVisit\(ctx, args, signal\)\n\s*if \(!GROUNDS\.on \|\| !gkSweepOn\(\) \|\| !sweepAfter\(ctx\.bot\.gkSweepRole, res\)\) return res/.test(s), 'the wrapper')
  // grounds-03 (review r1): the end is grounds2.mjs lateUntil's -- t0 + budget - 5 s for an ordinary visit (its test: grounds2.test.mjs), less the time a late leg had used
  assert.ok(/sw = await gkSweep\(ctx\.bot, signal, \{ until: lateUntil\(t0, budget, used0\) \}\)/.test(s), 'the sweep call within the budget')
  assert.ok(/!sweepAfter\(ctx\.bot\.gkSweepRole, res\)\) return res\n\s*if \(!holdsGrounds\(crewState\(ctx\.bot, true\)\.d\)\) return res\n[\s\S]{0,200}sw = await gkSweep/.test(s), 'the lease read again before the sweep (Codex r1)')
  assert.ok(/const caps = crewCaps\(role\)\n\s*bot\.gkSweepRole = GROUNDS\.on \? role : null/.test(s), 'the role left by the visit')
  assert.ok(/if \(proj\.plot === TIDY_PLOT\) return buildTidy\(ctx, args, signal\)/.test(s), 'the tidy project runs the wrapper')
  assert.strictEqual(s.split('async function buildTidyVisit (ctx, args, signal) {').length, 2)
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
