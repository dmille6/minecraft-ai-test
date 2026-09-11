// A DESCENDING STAIR IS THREE CELLS, NOT TWO.
//
// The cutter opened the tread and the headroom over it and then asked the bot
// to walk in from one block higher. Its head passes through the cell above the
// headroom on the way down; that cell was left solid, and the bot walked into
// a ceiling: 388 `mine_stair_step_failed` in 90 minutes on 2026-09-11, every
// one "moved 0.19 blocks", tread and headroom air at every probed site, the
// cell above them grass or dirt.
import assert from 'node:assert'
import { readFileSync } from 'node:fs'
import { Vec3 } from 'vec3'
import { descentStepCells } from '../src/skills.mjs'
let pass = 0, fail = 0
const t = (name, fn) => { try { fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) } }
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

t('descentStepCells: tread one down and along, headroom over it, the third cell at the bot\'s own head height', () => {
  const c = descentStepCells(new Vec3(10, 64, 20), { x: 1, z: 0 })
  assert.deepEqual([c.feet.x, c.feet.y, c.feet.z], [11, 63, 20])
  assert.deepEqual([c.head.x, c.head.y, c.head.z], [11, 64, 20])
  assert.deepEqual([c.above.x, c.above.y, c.above.z], [11, 65, 20], 'the cell the head passes through on the way down')
  assert.deepEqual([c.floor.x, c.floor.y, c.floor.z], [11, 62, 20])
  const z = descentStepCells(new Vec3(0, 0, 0), { x: 0, z: -1 })
  assert.deepEqual([z.above.x, z.above.y, z.above.z], [0, 1, -1])
})

const RAW = readFileSync(new URL('../src/skills.mjs', import.meta.url), 'utf8')
const mineStep = code => {
  const i = code.indexOf('const cells = descentStepCells(p0, bear)')
  const j = code.indexOf("what: 'stepping down the stair'", i)
  assert.ok(i > 0 && j > i, 'mine step block not found'); return code.slice(i, j)
}
t('mine digs all three cells, in order from the top, and checks the third for liquid like the other two', () => {
  const b = mineStep(strip(RAW))
  assert.match(b, /for \(const pos of \[cellAbove, cellHead, cellFeet\]\)/, 'the third cell must be opened, and first (a dig from the top cannot bury the tread)')
  assert.match(b, /\[cellAbove, 'ceiling'\]/, 'the liquid check must cover the third cell too')
})
t('the bearing chooser and the flow-risk count model the third cell too (Codex: chooser and guard must agree)', () => {
  const c = strip(RAW)
  const runway = c.slice(c.indexOf('export function stairRunway'), c.indexOf('export function stairRunway') + 700)
  assert.match(runway, /stand\.offset\(bear\.x, 1, bear\.z\)/, 'stairRunway must stop at a wet third cell')
  const flow = c.slice(c.indexOf('export function stairFlowRisk'), c.indexOf('export function stairFlowRisk') + 700)
  assert.match(flow, /stand\.offset\(bear\.x, 1, bear\.z\)/, 'stairFlowRisk must count faces around the third cell')
})
t('before opening the ceiling cell its exposed faces are checked for liquid, and a falling column above it is settled and re-opened once', () => {
  const b = mineStep(strip(RAW))
  assert.match(b, /const n = bot\.blockAt\(cellAbove\.offset\(dx, dy, dz\)\)/, 'FLOW_NEIGHBOURS of the ceiling cell are read before it is dug')
  assert.match(b, /beside the ` \+\s*`ceiling cell ahead/)
  const det = b.indexOf('const fallingAbove = FALLING.has(bot.blockAt(cellAbove.offset(0, 1, 0))?.name)'), dig = b.indexOf('for (const pos of [cellAbove, cellHead, cellFeet])')
  assert.ok(det > 0 && det < dig, 'the falling column is detected BEFORE the excavation (afterwards it is already an entity)')
  assert.match(b, /falling_block/, 'the settle waits for falling entities, not a fixed sleep')
  assert.match(b, /settled = \[cellAbove, cellHead, cellFeet\]\.every/, 'the passage is verified before the bot moves')
  assert.match(b, /a falling column keeps refilling the step/)
})
t('MUTANT: leaving the third cell out of the dig is caught', () => {
  const anchor = 'for (const pos of [cellAbove, cellHead, cellFeet])'
  assert.equal(RAW.split(anchor).length - 1, 1, 'ANCHOR MISSING or not unique')
  assert.ok(!/for \(const pos of \[cellAbove, cellHead, cellFeet\]\)/.test(mineStep(strip(RAW.replace(anchor, 'for (const pos of [cellHead, cellFeet])')))), 'the mutant (two-cell dig loop) must be visible as the missing third cell')
})
console.log(`\n${pass} passed, ${fail} failed`); if (fail) process.exit(1)
