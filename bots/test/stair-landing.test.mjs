// A step down that lands in the tolerated hollow is a step taken; a tread that is still solid gets dug again.
import assert from 'node:assert'
import { readFileSync } from 'node:fs'
import { stepLanding } from '../src/skills.mjs'
let pass = 0, fail = 0
const t = (name, fn) => { try { fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) } }
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const tread = { x: 10, y: 40, z: 10 }

t('in the tread cell: arrived', () => { assert.equal(stepLanding({ x: 10, y: 40, z: 10 }, tread, false), 'arrived') })
t('one or two LOWER in the tread column (the tolerated hollow): low, not failed', () => {
  assert.equal(stepLanding({ x: 10, y: 39, z: 10 }, tread, false), 'low')
  assert.equal(stepLanding({ x: 10, y: 38, z: 10 }, tread, false), 'low')
  assert.equal(stepLanding({ x: 10, y: 37, z: 10 }, tread, false), 'failed', 'three lower is a fall, not the hollow mine tolerates')
})
t('one HIGHER in the tread column with the tread still solid: redig; with the tread open: failed (the bot is floating or the settle was short)', () => {
  assert.equal(stepLanding({ x: 10, y: 41, z: 10 }, tread, true), 'redig')
  assert.equal(stepLanding({ x: 10, y: 41, z: 10 }, tread, false), 'failed')
})
t('beside the tread (any y): failed', () => {
  assert.equal(stepLanding({ x: 11, y: 41, z: 10 }, tread, true), 'failed')
  assert.equal(stepLanding({ x: 10, y: 40, z: 11 }, tread, false), 'failed')
  assert.equal(stepLanding(null, tread, false), 'failed')
})

const RAW = readFileSync(new URL('../src/skills.mjs', import.meta.url), 'utf8')
t('mine judges BOTH landings (after the goto and after the re-dig) with stepLanding, treats low as arrived, and re-digs on redig whatever the displacement', () => {
  const c = strip(RAW)
  const m = c.slice(c.indexOf('async function mine('), c.indexOf('async function mine(') + 60000)
  assert.equal((m.match(/stepLanding\(at, cellFeet, treadSolidNow\(\)\)/g) || []).length, 2, 'two landing checks')
  assert.equal((m.match(/arrived = landing === 'arrived' \|\| landing === 'low'/g) || []).length, 2, 'low counts as arrived at both checks')
  assert.match(m, /if \(!arrived && \(moved < 0\.3 \|\| landing === 'redig'\)\) \{/, 'the recovery runs on redig regardless of moved')
  assert.equal((m.match(/kind: 'mine_stair_step_low'/g) || []).length, 2, 'a low landing is logged at both checks')
  assert.ok(!/arrived = at\.x === cellFeet\.x && at\.y === cellFeet\.y && at\.z === cellFeet\.z/.test(m), 'no bare exact-cell arrival test survives')
})
t('MUTANT: restoring the exact-cell test at the first landing is caught', () => {
  const c = strip(RAW)
  const anchor = "let arrived = landing === 'arrived' || landing === 'low'"
  assert.equal(c.split(anchor).length - 1, 1, 'ANCHOR MISSING or not unique')
  const bad = c.replace(anchor, 'let arrived = at.x === cellFeet.x && at.y === cellFeet.y && at.z === cellFeet.z')
  const m = bad.slice(bad.indexOf('async function mine('), bad.indexOf('async function mine(') + 60000)
  assert.notEqual((m.match(/arrived = landing === 'arrived' \|\| landing === 'low'/g) || []).length, 2)
})

console.log(`\n${pass} passed, ${fail} failed`); if (fail) process.exit(1)
