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
test('THE VERTICAL ARRIVAL (Codex jit-1022b P1): a target one block above the column\'s top is refused -- goto would count a landing inside the column as arrived', async () => {
  const { arrivedAt } = await import('../src/skills.mjs')
  const site = fire(50, 60, 0)   // the column y 60..72
  const target = { x: 50, y: 73, z: 0 }, landing = { x: 50.5, y: 72, z: 1.5 }
  assert.equal(arrivedAt(landing, target), true, 'goto accepts this landing')
  assert.ok(KO.columnAt([site], landing), 'and it is inside the column')
  assert.equal(KO.relocationForbidden([site], target.x, target.y, target.z), true, 'so the target is refused')
  assert.equal(KO.relocationForbidden([site], target.x, target.y, target.z, KO.RELOCATION_ARRIVAL_REACH, 0), false, 'MUTANT (the feet height only, the old rule): accepted')
  assert.equal(KO.relocationForbidden([site], 50, 72 + 1 + KO.RELOCATION_ARRIVAL_DY, 0), false, 'CONTROL: 6 clear above the top -> allowed')
  assert.equal(KO.relocationForbidden([site], 50, 60 - 1 - KO.RELOCATION_ARRIVAL_DY, 0), false, 'CONTROL: 6 clear below the site -> allowed')
})
test('THE REGION IS arrivedAt\'s: every landing goto accepts that lies in a column refuses its target (exhaustive around a site)', async () => {
  const { arrivedAt } = await import('../src/skills.mjs')
  const site = fire(0, 60, 0)
  let checked = 0, refused = 0
  for (let tx = -12; tx <= 12; tx += 3) for (let tz = -12; tz <= 12; tz += 4) for (let ty = 50; ty <= 82; ty += 2) {
    const target = { x: tx, y: ty, z: tz }
    const intoColumn = []
    for (let lx = tx - 4; lx <= tx + 4; lx++) for (let lz = tz - 4; lz <= tz + 4; lz++) for (let ly = ty - 8; ly <= ty + 8; ly++) {
      const pos = { x: lx + 0.5, y: ly, z: lz + 0.5 }
      if (arrivedAt(pos, target) && KO.columnAt([site], pos)) intoColumn.push(pos)
    }
    checked++
    if (intoColumn.length) { refused++; assert.equal(KO.relocationForbidden([site], tx, ty, tz), true, `target ${tx},${ty},${tz} can land at ${JSON.stringify(intoColumn[0])}`) }
  }
  assert.ok(refused > 0 && refused < checked, `both kinds of target seen (${refused} of ${checked} refusable)`)
})
test('WIRED: the watchdog passes the forbid; MUTANT KILLED without it', () => {
  // lavasight-01: the forbid is composed (lavasight.mjs composeRelocationForbid, behaviour-tested in lavasight.test.mjs:
  // fire alone answers exactly as relocationForbidden did) and passed whenever there is anything to forbid
  const raw = readFileSync(new URL('../src/watchdog.mjs', import.meta.url), 'utf8')
  const wired = s => /const forbid = composeRelocationForbid\(fire, lava, relocationForbidden\)/.test(strip(s)) &&
                     /pickRelocationTargetAsync\(\{ p, read, \.\.\.\(forbid \? \{ forbid \} : \{\}\) \}\)/.test(strip(s))
  assert.equal(wired(raw), true)
  const anchor = '...(forbid ? { forbid } : {})'
  assert.ok(raw.includes(anchor) && raw.split(anchor).length === 2, 'ANCHOR MISSING or not unique')
  assert.equal(wired(raw.replace(anchor, '')), false)
  const rl = readFileSync(new URL('../src/relocate.mjs', import.meta.url), 'utf8')
  assert.match(strip(rl), /const fb = typeof opts\.forbid === 'function' \? opts\.forbid\(x, fy, z\) : false\s*if \(fb\) return \{ ok: false, why: typeof fb === 'string' \? fb : 'keepout' \}/)
})
