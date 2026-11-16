// THE SHOWCASE PLOTPREP-02 + ACCESS-02 FOLD (Codex fold review BLOCKER): access-02's ledger stairs kept off plotprep's WORKED columns
// only -- a flat, unsited reserved plot beside a 2-4 high ledge has none, and the tidy's `avoid` leaves the land plan's reservations
// out, so a ledger stair could cross a future building pad. The stair's `free` now refuses every wall-extension plot's box, whole
// (base, cells, landing and destination all go through `free` in spotStair / planAccessStair). Structural (the decision is a closure
// inside siteStage's inwall branch): the line, its source, and that spotStair consults `free` for the destination; one anchored mutant.
import assert from 'node:assert'
import { readFileSync } from 'node:fs'
let pass = 0, fail = 0
const t = (name, fn) => { try { fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) } }
const strip = src => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/[ \t]\/\/ .*$/gm, '')
const TD = strip(readFileSync(new URL('../src/tidy.mjs', import.meta.url), 'utf8'))
const LINE = 'const freeA = (x, z) => inBox(x, z) && !inPlotA(x, z) && !usedA.has(k2(x, z))'
t('the ledger stair\'s free refuses every reserved plot\'s box (the line, once)', () => {
  assert.strictEqual(TD.split(LINE).length, 2, 'ANCHOR MISSING OR NOT UNIQUE')
  assert.ok(TD.includes('const plotBoxesA = (terrace?.wallext?.plots ?? []).map(q => q?.box)'))
})
t('spotStair passes `free` to the destination and to planAccessStair (so the refusal covers landings and cells)', () => {
  const i = TD.indexOf('export function spotStair'), body = TD.slice(i, TD.indexOf('\nexport ', i + 10))
  assert.ok(body.includes('!free(hx, hz)') && /planAccessStair\(read, \{[^}]*free/.test(body))
})
t('MUTANT KILLED: the line without the plot refusal fails the first check', () => {
  const m = TD.replace(LINE, 'const freeA = (x, z) => inBox(x, z) && !usedA.has(k2(x, z))')
  assert.strictEqual(m.split(LINE).length, 1)
})
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
