// The rung's slot and its tool-free path: structural invariants (behaviour: floodpocket.test.mjs). Comments stripped;
// anchors unique; mutants for the two lines that matter.
//   1. a REFUSED plan does not stamp the ten-minute cooldown; only a plan that takes the body does (48 h to 16 Sep:
//      a drowning bot had ~100 s; one refusal used to silence the rung for 600 s).
//   2. a tool-free plan never digs: the ceiling dig and the notch both end/refuse without a pickaxe.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
let pass = 0, fail = 0
const t = (name, fn) => { try { fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) } }
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map(l => l.replace(/(^|\s)\/\/.*$/, '')).join('\n')
const src = strip(readFileSync(new URL('../src/reflex.mjs', import.meta.url), 'utf8'))
const once = (s, needle, where) => { const n = s.split(needle).length - 1; assert.equal(n, 1, `${where}: expected exactly one "${needle}", found ${n}`) }
const wiring = src.slice(src.indexOf("if (pocketWanted && Date.now() - pocketWanted < POCKET_WANT_MS && !escaping && !marooned && !pocketing)"), src.indexOf('const pocketPending = pocketWanted'))
const rung = src.slice(src.indexOf('async function floodedPocketRung'), src.indexOf('async function digBounded'))
t('the cooldown is stamped once, inside the granted-body branch: a refused plan and a denied grant spend nothing', () => {
  assert.ok(wiring.length > 200, 'the rung wiring block was found')
  once(wiring, 'lastPocketRungAt = Date.now()', 'wiring')
  const iRefuse = wiring.indexOf('if (!plan.ok) {'), iStamp = wiring.indexOf('lastPocketRungAt = Date.now()'), iTake = wiring.indexOf("await takeBody(bot, runner, 'flooded_pocket', PRIORITY.escape)"), iGrant = wiring.indexOf('if (pocketGrant) {'), iRun = wiring.indexOf('pocketing = true')
  assert.ok(iRefuse > 0 && iRefuse < iTake && iTake < iGrant && iGrant < iStamp && iStamp < iRun, `refuse@${iRefuse} < takeBody@${iTake} < grant@${iGrant} < stamp@${iStamp} < run@${iRun}: only a granted body spends the cooldown`)
  const refusal = wiring.slice(iRefuse, wiring.indexOf('} else {', iRefuse))
  assert.ok(!refusal.includes('lastPocketRungAt'), 'the refusal branch never touches the cooldown')
  assert.ok(refusal.includes("throttled('pocket_rung_refused', 60_000)"), 'the refusal row is throttled')
  once(wiring, 'pocketWanted = 0\n          const { plan, floorY, firstDryY, tool, columnCells } = pocketPlanFor(bot)', 'wiring')
})
t('mutant: stamping the cooldown before the plan (the old order) is detected', () => {
  const m = wiring.replace('pocketWanted = 0\n          const { plan', 'lastPocketRungAt = Date.now(); pocketWanted = 0\n          const { plan')
  assert.notEqual(m, wiring, 'MUTATION DID NOT APPLY')
  assert.throws(() => once(m, 'lastPocketRungAt = Date.now()', 'mutant'), /found 2/)
})
t('a tool-free plan never digs: the ceiling dig ends the rung without a pickaxe, and a notch exit is refused without one', () => {
  once(rung, "if (!tool) return end(false, `ceiling y=${feetY + 2} is ${ceil.name} and there is no pickaxe: the tool-free plan had no dig`)", 'rung')
  once(rung, 'if (ex.digs?.length && !tool) return `the only side exit is a notch (${ex.digs.length} dig(s)) and there is no pickaxe`', 'rung')
  assert.ok(rung.indexOf('if (!tool) return end(false, `ceiling') < rung.indexOf('await digBounded(bot, ceil'), 'the guard precedes the ceiling dig')
  assert.ok(rung.indexOf('if (ex.digs?.length && !tool) return') < rung.indexOf('for (const y of (ex.digs ?? []))'), 'the guard precedes the notch dig')
})
t('mutant: deleting the notch guard is detected', () => {
  const m = rung.replace('if (ex.digs?.length && !tool) return `the only side exit is a notch (${ex.digs.length} dig(s)) and there is no pickaxe`', '')
  assert.notEqual(m, rung, 'MUTATION DID NOT APPLY')
  assert.throws(() => once(m, 'if (ex.digs?.length && !tool) return', 'mutant'), /found 0/)
})
console.log(`\n${pass} passed, ${fail} failed`); if (fail) process.exit(1)
