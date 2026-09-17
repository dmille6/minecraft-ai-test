// Structural invariants for the fall record (behaviour: fallpath.test.mjs). Comments stripped; anchors unique; mutants.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
let pass = 0, fail = 0
const t = (name, fn) => { try { fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) } }
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map(l => l.replace(/(^|\s)\/\/.*$/, '')).join('\n')
const idx = strip(readFileSync(new URL('../src/index.mjs', import.meta.url), 'utf8'))
const once = (s, needle, where) => { const n = s.split(needle).length - 1; assert.equal(n, 1, `${where}: expected exactly one "${needle}", found ${n}`) }
t('the last planned path is kept from every accepted path_update, with the active profile, and read at a death after a fall and at fall damage', () => {
  once(idx, "lastPlannedPath = { t: Date.now(), status: r.status, profile: bot.movementProfile ?? 'walk'", 'index')
  once(idx, "if (fell != null && fell > 3) fallRecord(bot, runner, fell, 'death')", 'index')
  once(idx, "fallRecord(bot, runner, Math.round(peakY - y), 'damage')", 'index')
  once(idx, "logEvent({ kind: 'fall_path', status: kind === 'death' ? 'failed' : 'no_effect',", 'index')
  assert.ok(idx.indexOf("fallRecord(bot, runner, fell, 'death')") < idx.indexOf('const lost = inventorySummary(bot)'), 'the record is taken before the inventory summary, while the position is the death position')
})
t('every movement profile names itself and every helper restores the walk profile with the walk movements', () => {
  for (const [h, n] of [['gatherMoves', 'gather'], ['ascendMoves', 'ascend'], ['descendMoves', 'descend'], ['waterMoves', 'water']]) once(idx, `bot.pathfinder.setMovements(${h}); bot.movementProfile = '${n}'`, 'index')
  assert.equal(idx.split("finally { bot.pathfinder.setMovements(moves); bot.movementProfile = 'walk' }").length - 1, 4, 'four helpers restore walk')
})
t('mutant: dropping the death-time record is detected', () => {
  const m = idx.replace("if (fell != null && fell > 3) fallRecord(bot, runner, fell, 'death')\n", '')
  assert.notEqual(m, idx, 'MUTATION DID NOT APPLY'); assert.throws(() => once(m, "fallRecord(bot, runner, fell, 'death')", 'mutant'), /found 0/)
})
console.log(`\n${pass} passed, ${fail} failed`); if (fail) process.exit(1)
