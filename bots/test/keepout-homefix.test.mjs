// KEEPOUT-01 x HOMEFIX-02: the watchdog's level-1 relocation (relocate.mjs, homefix-02 C2) never targets a cell whose goto
// arrival region lies in the column above a live fire death site (keepout.mjs relocationForbidden). The composition the
// design names (comms design 4.6, homefix-02 design 4 C2): a relocation INTO a column would hand the bot straight to
// `_keepout_exit`, and the two rescues would undo each other.
process.env.LOG_DIR ??= '/tmp'
process.env.STATE_DIR ??= '/tmp'
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const KO = await import('../src/keepout.mjs')
const RL = await import('../src/relocate.mjs')
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
const read = (x, y, z) => (y < 65 ? { name: 'stone', boundingBox: 'block' } : { name: 'air', boundingBox: 'empty' })
const seq = vals => { let i = 0; return () => vals[i++ % vals.length] }
const p = { x: 0.5, y: 65, z: 0.5 }
const fire = (x, y, z) => ({ kind: 'death:fire', x, y, z, count: 4, deaths: 1, last: Date.now(), by: ['x'] })

test('the base rule picks the first dry candidate; with its arrival region in a fire column the next one is taken', () => {
  const rand = () => seq([0.1, 0.2, 0.6, 0.7, 0.3, 0.9])
  const base = RL.pickRelocationTarget({ p, read, rand: rand() })
  assert.equal(base.ok, true, 'positive control: the base rule takes the first draw')
  const site = fire(base.x + 2, 60, base.z)   // its column covers the first target's arrival region
  const ko = RL.pickRelocationTarget({ p, read, rand: rand(), forbid: (x, y, z) => KO.relocationForbidden([site], x, y, z) })
  assert.equal(ko.ok, true)
  assert.ok(ko.x !== base.x || ko.z !== base.z, 'a different target')
  assert.equal(KO.relocationForbidden([site], ko.x, ko.y, ko.z), false, 'outside every column')
  assert.equal(ko.reasons.keepout, 1, 'the refusal is counted by name')
})
test('no site: the forbid never refuses (the base exactly)', () => {
  assert.equal(KO.relocationForbidden([], 10, 65, 10), false)
  assert.equal(KO.relocationForbidden([fire(100, 60, 100)], 10, 65, 10), false)
  assert.equal(KO.relocationForbidden([fire(13, 60, 10)], 10, 65, 10), true, 'within reach 3 + radius 6')
})
test('WIRED: the watchdog passes the forbid; MUTANT KILLED without it', () => {
  const raw = readFileSync(new URL('../src/watchdog.mjs', import.meta.url), 'utf8')
  const wired = s => /pickRelocationTargetAsync\(\{ p, read, \.\.\.\(fire\.length \? \{ forbid: \(x, y, z\) => relocationForbidden\(fire, x, y, z\) \} : \{\}\) \}\)/.test(strip(s))
  assert.equal(wired(raw), true)
  const anchor = '...(fire.length ? { forbid: (x, y, z) => relocationForbidden(fire, x, y, z) } : {})'
  assert.ok(raw.includes(anchor) && raw.split(anchor).length === 2, 'ANCHOR MISSING or not unique')
  assert.equal(wired(raw.replace(anchor, '')), false)
  const rl = readFileSync(new URL('../src/relocate.mjs', import.meta.url), 'utf8')
  assert.match(strip(rl), /if \(typeof opts\.forbid === 'function' && opts\.forbid\(x, fy, z\)\) return \{ ok: false, why: 'keepout' \}/)
})
