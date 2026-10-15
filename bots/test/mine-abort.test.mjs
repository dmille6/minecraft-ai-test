// AN INTERRUPTED MINE STOPS TOUCHING THE WORLD (airpocket-03).
//
// Live, 10-13 11:00Z, hive-d-Delta: the drowning rescue interrupted `mine` and waited 1528 ms for it to unwind. mine never
// did -- its stair step equips and digs three cells, walks, and re-digs with no look at its abort signal in between -- and
// its next dig cancelled the rescue's ice dig (mineflayer rejects the older dig with "Digging aborted"). These tests run
// mine's stair step against a micro-world and fire the abort at each await of the step: after it, nothing may be
// equipped, dug, walked or shoved. Each guard has an anchored mutant that is seen to fail for its reason.
import assert from 'node:assert'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { V, AIR, STONE } from './helpers/microworld.mjs'
import { SKILLS, abortableDig } from '../src/skills.mjs'

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) }
}
const SP = new URL('../src/skills.mjs', import.meta.url)
async function withMutant (path, old, neu, fn) {
  const src = readFileSync(path, 'utf8')
  assert.ok(src.includes(old), `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 70))}. A mutant that was never written reads as killed.`)
  assert.ok(src.split(old).length === 2, 'the mutation target is not unique; the mutant is ambiguous')
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, src.replace(old, neu).replace(/from '\.\//g, "from '../src/"))
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}

const key = (x, y, z) => `${x},${y},${z}`
/** mine-staircase.test.mjs's micro-world, with a log of every world-touching call after the abort fired. */
function mineWorld ({ canMove = true, lookAt = true } = {}) {
  const carved = new Set(); const ac = new AbortController()
  const after = []                         // what was done after ac.abort()
  const note = what => { if (ac.signal.aborted) after.push(what) }
  const at = p => carved.has(key(p.x, p.y, p.z)) ? AIR : (p.y < 64 ? STONE : AIR)
  const bot = {
    entity: { position: new V(200, 64, 200), yaw: 0 }, health: 20, food: 20, oxygenLevel: 300, heldItem: { type: 1 },
    // a pickaxe that is faster than the hand, so toolFor picks it and the step really EQUIPS before each dig
    blockAt: p => ({ ...at(p), position: new V(p.x, p.y, p.z), canHarvest: () => true, digTime: type => (type === 274 ? 100 : 1500), harvestTools: undefined, material: 'rock' }),
    inventory: { items: () => [{ name: 'stone_pickaxe', type: 274, count: 1, maxDurability: 131, durabilityUsed: 0 }, { name: 'cobblestone', count: 512 }] },
    equip: async () => { note('equip'); await bot.hooks.equip?.() },
    dig: async b => { note('dig'); bot.digs++; await bot.hooks.dig?.(b); carved.add(key(b.position.x, b.position.y, b.position.z)) },
    pathfinder: {
      goto: async goal => {
        note('walk'); await bot.hooks.walk?.()
        if (!canMove) return
        const c = new V(goal.x, goal.y, goal.z)
        if (at(c) !== AIR || at(c.offset(0, 1, 0)) !== AIR) return
        bot.entity.position = c
      },
      setGoal: () => {}, stop: () => {},
    },
    setControlState: (n, on) => { if (on) note(`control:${n}`) }, clearControlStates: () => {},
    registry: { blocksByName: {}, itemsByName: {} }, players: {}, digs: 0, hooks: {},
  }
  if (lookAt) bot.lookAt = async () => { note('look'); await bot.hooks.look?.() }
  return { bot, ac, after }
}
const run = (S, w, y = 56) => S.mine.run({ bot: w.bot }, { y }, w.ac.signal).catch(e => ({ thrown: e }))

// ---------------------------------------------------------------- positive control
await t('CONTROL: with no abort the stair step equips, digs, walks (the instrument can see each kind of call)', async () => {
  const w = mineWorld(); const seen = new Set()
  w.bot.hooks = { equip: () => seen.add('equip'), dig: () => seen.add('dig'), walk: () => seen.add('walk') }
  const r = await run(SKILLS, w)
  assert.ok(seen.has('equip') && seen.has('dig') && seen.has('walk'), JSON.stringify([...seen]))
  assert.ok(w.bot.digs >= 6, `dug ${w.bot.digs}`); assert.equal(r.status, 'success', r.detail)
})

// ---------------------------------------------------------------- the guards
const abortAt = (where, n = 1) => w => { let k = 0; w.bot.hooks[where] = () => { if (++k === n) w.ac.abort() } }
const cases = [
  ['the abort lands during an EQUIP', abortAt('equip', 2), ['equip', 'dig', 'walk', 'control:forward']],
  ['the abort lands during the LOOK before a dig (mineflayer awaits its own look; abortableDig looks first)', abortAt('look', 2), ['dig', 'walk', 'equip', 'control:forward']],
  ['the abort lands during a DIG', abortAt('dig', 2), ['dig', 'walk', 'equip', 'control:forward']],
  ['the abort lands during the last dig of a step (the walk is next)', abortAt('dig', 3), ['walk', 'dig', 'equip', 'control:forward']],
]
for (const [name, arm, forbidden] of cases) {
  await t(`ABORTED MINE: ${name} -- nothing after it touches the world`, async () => {
    const w = mineWorld(); arm(w)
    const r = await run(SKILLS, w)
    assert.ok(w.ac.signal.aborted, 'the abort never fired: the fixture did not reach the await')
    assert.ok(r.thrown?.aborted === true || /abort/i.test(String(r.detail ?? r.status)), `mine did not end as aborted: ${JSON.stringify(r).slice(0, 160)}`)
    // the call during which the abort landed is already in flight; nothing NEW may start
    const started = w.after.filter(x => forbidden.includes(x))
    assert.deepEqual(started, [], `after the abort mine still did: ${started.join(', ')}`)
  })
}
await t('ABORTED MINE IN RECOVERY: the abort lands during a walk that went nowhere -- no re-dig, no shove into the tread', async () => {
  const w = mineWorld({ canMove: false }); abortAt('walk', 1)(w)
  const r = await run(SKILLS, w)
  assert.ok(w.ac.signal.aborted)
  assert.deepEqual(w.after.filter(x => x !== 'walk'), [], `after the abort: ${w.after.join(', ')}`)   // no look either (P3-2)
  assert.ok(r.thrown?.aborted === true || r.status !== 'success')
})
// the abort lands during the RECOVERY's own head turn (after a walk that went nowhere): no shove after it
const abortAtRecoveryLook = w => { w.bot.hooks.walk = () => { w.inRecovery = true }; w.bot.hooks.look = () => { if (w.inRecovery) w.ac.abort() } }
await t('ABORTED MINE IN RECOVERY: the abort lands during the recovery\'s look -- no shove', async () => {
  const w = mineWorld({ canMove: false }); abortAtRecoveryLook(w)
  await run(SKILLS, w)
  assert.ok(w.ac.signal.aborted, 'the recovery look never ran'); assert.deepEqual(w.after, [], `after the abort: ${w.after.join(', ')}`)
})

await t('abortableDig (unit): an aborted signal before or during its look sends no dig; a live one sends start-dig with forceLook ignore', async () => {
  const calls = []; const ac = new AbortController()
  const bot = { lookAt: async () => { calls.push('look') }, dig: async (b, fl) => { calls.push(`dig:${fl}`) } }
  const blk = { position: new V(1, 2, 3) }
  await abortableDig(bot, blk, ac.signal)
  assert.deepEqual(calls, ['look', 'dig:ignore'])
  const ac2 = new AbortController(); ac2.abort(); calls.length = 0
  await assert.rejects(abortableDig(bot, blk, ac2.signal), e => e.aborted === true); assert.deepEqual(calls, [])
  const ac3 = new AbortController(); calls.length = 0
  const bot3 = { lookAt: async () => { calls.push('look'); ac3.abort() }, dig: async () => { calls.push('dig') } }
  await assert.rejects(abortableDig(bot3, blk, ac3.signal), e => e.aborted === true); assert.deepEqual(calls, ['look'])
  // no lookAt (some fakes and a disconnected bot): still checks, still digs
  const calls4 = []; await abortableDig({ dig: async () => calls4.push('dig') }, blk, new AbortController().signal); assert.deepEqual(calls4, ['dig'])
})

// ---------------------------------------------------------------- mutants (anchors asserted present and unique)
const killed = async (name, old, neu, arm, forbidden, opts = {}) => t(`MUTANT KILLED: ${name}`, async () => {
  await withMutant(SP, old, neu, async m => {
    const w = mineWorld(opts); arm(w)
    await run(m.SKILLS, w)
    assert.ok(w.ac.signal.aborted, 'mutant inert: the abort never fired')
    assert.ok(w.after.some(x => forbidden.includes(x)), `mutant inert: after the abort only ${w.after.join(', ') || 'nothing'}`)
  })
})
await killed('without the check before the equip, an abort during a dig still equips the next cell\'s tool',
  "      check(signal)                                   // an interrupted mine touches neither the hand nor the block\n", '',
  abortAt('dig', 2), ['equip'])
await killed('without the check after abortableDig\'s look, an abort during the look still digs',
  "  check(signal)\n  // minewell-01: the look above is an await", "  // minewell-01: the look above is an await",   // minewell-01: the post-look check now precedes the shell guard
  abortAt('look', 2), ['dig'])
await killed('the stair dig as a bare bot.dig: an abort during the equip still digs',
  "      try { await abortableDig(bot, b, signal, { guard: () => (stopLook = shellStop(pos)) }) } catch (e) { if (e.aborted) throw e; break }\n",   // minewell-01 passes its shell guard
  "      try { await bot.dig(b) } catch (e) { if (e.aborted) throw e; break }\n",
  w => { w.bot.hooks.equip = () => w.ac.abort() }, ['dig'])
await killed('without the check before the walk, an abort during the step\'s last dig still walks',
  "    check(signal)                                     // no walk (and no pathfinder dig) after the abort\n", '',
  abortAt('dig', 3), ['walk'])
await killed('without the check before the recovery look, an abort during a walk that went nowhere still turns the head',
  "        check(signal)                                 // not even a head turn after the abort (Claude ap3 r1 P3-2)\n", '',
  abortAt('walk', 1), ['look'], { canMove: false })
await killed('without the check before the shove, an abort during the recovery look still pushes forward',
  "        check(signal)                                 // no shove into the tread after the abort\n", '',
  abortAtRecoveryLook, ['control:forward'], { canMove: false })

// ---------------------------------------------------------------- structural: no bare dig left in mine
const stripC = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1')
const mineBody = src => { const s = stripC(src); return s.slice(s.indexOf('async function mine('), s.indexOf('export function stairBearing')) }
await t('WIRED: mine has no bare bot.dig( left (every dig goes through abortableDig); the check fails on a re-inserted one', () => {
  const src = readFileSync(SP, 'utf8')
  assert.ok(mineBody(src).length > 5000, 'the mine body was not found')
  assert.equal((mineBody(src).match(/bot\.dig\(/g) || []).length, 0)
  const a = "          if (b && b.boundingBox === 'block') { try { await abortableDig(bot, b, signal, { guard: () => (stopReLook = shellStop(pos)) }) } catch (e) { if (e.aborted) throw e } }"
  assert.equal(src.split(a).length, 2, 'ANCHOR MISSING OR NOT UNIQUE')
  assert.ok((mineBody(src.replace(a, a.replace('abortableDig(bot, b, signal, { guard: () => (stopReLook = shellStop(pos)) })', 'bot.dig(b)'))).match(/bot\.dig\(/g) || []).length === 1)
})

console.log(`  ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
