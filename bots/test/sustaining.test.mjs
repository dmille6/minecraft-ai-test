// A milestone must never present an impossible goal.
//
// SUSTAINING targets scale by a cycle counter that was READ in three places and
// ASSIGNED in none, so every sustaining goal rendered "Stockpile NaN
// cobblestone" and done() could never be true -- every comparison against NaN
// is false. A bot reaching the sustaining loop was handed a goal it could
// neither complete nor fail. It went unnoticed because it only appears after a
// bot exhausts its fixed chain.
import { SUSTAINING, MILESTONES_BY_ROLE } from '../src/milestones.mjs'

let pass = 0, fail = 0
const t = (name, ok) => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}`) }

const bot = {
  entity: { position: { x: 0, y: 70, z: 0, distanceTo: () => 5 } },
  inventory: { items: () => [{ name: 'cobblestone', count: 3 }] },
}

console.log('no sustaining goal may render NaN, at any cycle')
for (const n of [0, 1, 5, 40]) {
  for (const m of SUSTAINING) {
    const desc = typeof m.describe === 'function' ? m.describe(n) : m.describe
    const prog = (() => { try { return String(m.progress(bot, n)) } catch (e) { return 'THREW ' + e.message } })()
    const bad = /NaN|undefined/.test(desc) || /NaN|undefined/.test(prog)
    if (bad) console.log(`        cycle=${n} ${m.id}: describe="${desc}" progress="${prog}"`)
    t(`cycle=${n} ${m.id}`, !bad)
  }
}

console.log('\nand done() must be a real boolean, never NaN-poisoned')
for (const m of SUSTAINING) {
  const v = (() => { try { return m.done(bot, 0) } catch { return 'threw' } })()
  t(`${m.id}.done() is boolean`, typeof v === 'boolean')
}

console.log('\nevery role chain ends in the sustaining loop, so every bot reaches this')
for (const [role, chain] of Object.entries(MILESTONES_BY_ROLE)) {
  t(`${role} chain is non-empty`, chain.length > 0)
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
