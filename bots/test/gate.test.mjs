import { Lessons } from '../src/lessons.mjs'
import { AdmissionControl } from '../src/admission.mjs'

let pass = 0, fail = 0
const t = (name, got, want) => {
  const ok = got === want; ok ? pass++ : fail++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  (got ${got}, want ${want})`}`)
}

// --- decay -----------------------------------------------------------------
console.log('failCount decays with idle time')
const L = new Lessons('/tmp/test-lessons.json')
L.data.avoid['gather:{"block":"oak_log","count":1}'] =
  { skill: 'gather', args: { block: 'oak_log', count: 1 }, fails: 6, classes: {}, last: Date.now() }
t('fresh failures counted in full', L.failCount('gather', { block: 'oak_log', count: 1 }), 6)

L.data.avoid['gather:{"block":"oak_log","count":1}'].last = Date.now() - 60 * 60 * 1000  // 1h idle
t('1h idle forgives 3', L.failCount('gather', { block: 'oak_log', count: 1 }), 3)

L.data.avoid['gather:{"block":"oak_log","count":1}'].last = Date.now() - 6 * 60 * 60 * 1000
t('6h idle clears it (never negative)', L.failCount('gather', { block: 'oak_log', count: 1 }), 0)

// --- migration -------------------------------------------------------------
console.log('\nmigrateActionKeys drops records under the old key')
const M = new Lessons('/tmp/test-lessons2.json')
M.data.avoid['craft:{"item":"stick","player":"agent"}'] = { skill: 'craft', args: { item: 'stick', player: 'agent' }, fails: 17 }
M.data.avoid['craft:{"item":"stick"}']                  = { skill: 'craft', args: { item: 'stick' }, fails: 13 }
const dropped = M.migrateActionKeys()
t('one stale record dropped', dropped, 1)
t('the well-formed one survives', Object.keys(M.data.avoid).length, 1)
t('and it is not re-dropped (idempotent)', M.migrateActionKeys(), 0)

// --- pressure valve --------------------------------------------------------
console.log('\nthe gate cannot veto forever')
const G = new Lessons('/tmp/test-lessons3.json')
G.data.avoid['gather:{"block":"oak_log","count":1}'] =
  { skill: 'gather', args: { block: 'oak_log', count: 1 }, fails: 99, classes: {}, last: Date.now() }
const gate = new AdmissionControl(G)
const bot = { registry: { blocksByName: { oak_log: {} }, itemsByName: {} }, entity: { position: { y: 70 } }, players: {}, inventory: { items: () => [] } }

let vetoes = 0, admitted = 0
for (let i = 0; i < 12; i++) {
  const r = gate.check({ skill: 'gather', args: { block: 'oak_log', count: 1 } }, bot)
  r.ok ? admitted++ : vetoes++
}
console.log(`  over 12 identical proposals for a 99-fail action: ${admitted} admitted, ${vetoes} vetoed`)
t('the gate let something through', admitted > 0, true)
t('and it still mostly resists', vetoes > admitted, true)

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
