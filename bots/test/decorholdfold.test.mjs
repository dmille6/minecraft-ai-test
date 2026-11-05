// THE SHOWCASE ATLAS + DECORATOR FOLD (decorator-01show onto 8b4ea9cc, which carries wallext-02's demolition hold; Codex fold review
// BLOCKER): the decorator's reservations (skills.mjs decorReservedFor) left out the `hold:walldemo` zones -- a retired wall cell leaves
// the record's cells, so the cell guard does not keep it, and a border or the nursery could take a held column before the demolition
// digs. The decorator now reads the wall record as held (wall.mjs holdAt); fail closed on an error. Behaviour of holdAt on a held
// record + the wiring (decorReservedFor is a closure over live records), with an anchored mutant of the wiring line.
import assert from 'node:assert'
import { readFileSync } from 'node:fs'
const W = await import('../src/wall.mjs')
let pass = 0, fail = 0
const t = (name, fn) => { try { fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) } }
const held = { plot: 'wall', zones: W.demoHoldZones([{ at: [5, 71, -20] }, { at: [6, 71, -20] }]), cells: [] }
t('holdAt: a held column is held, a neighbour is not; a released wall holds nothing', () => {
  const h = W.holdAt(held)
  assert.strictEqual(h(5, -20), true); assert.strictEqual(h(6, -20), true); assert.strictEqual(h(8, -20), false)
  assert.strictEqual(W.holdAt({ plot: 'wall', zones: [], cells: [] })(5, -20), false)
})
const strip = src => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/[ \t]\/\/ .*$/gm, '')
const SK = strip(readFileSync(new URL('../src/skills.mjs', import.meta.url), 'utf8'))
const LINE = "return (x, z) => base(x, z) ?? (held(x, z) ? WALLDEMO_HOLD : null) ?? (Array.isArray(park)"
t('WIRED: decorReservedFor refuses a held column (the wall as held, fail closed), once', () => {
  const i = SK.indexOf('function decorReservedFor'), body = SK.slice(i, SK.indexOf('\n}\n', i))
  assert.strictEqual(body.split(LINE).length, 2, 'ANCHOR MISSING OR NOT UNIQUE')
  assert.ok(body.includes("held = holdAt(projectHeads().find(x => x.plot === WALL_PLOT)?.head?.rec ?? null)"))
  assert.ok(body.includes('catch { held = () => true }'), 'an unreadable record holds everything')
})
t('MUTANT KILLED: the line without the hold fails the wiring check', () => {
  const m = SK.replace(LINE, "return (x, z) => base(x, z) ?? (Array.isArray(park)")
  assert.strictEqual(m.split(LINE).length, 1)
})
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
