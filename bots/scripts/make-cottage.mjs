// townstyle-01: writes bots/src/blueprints/cottage@1s.json and cottage@1f.json from bots/src/townstyle.mjs cottageBlueprint, and
// (with --render) prints each variant's elevations and plan in ASCII. `node bots/scripts/make-cottage.mjs [--render] [--check]`
// --check: exit 1 when a written file differs from the generator (the test suite's freshness check runs the same comparison).
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { cottageBlueprint } from '../src/townstyle.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const out = v => path.join(here, '..', 'src', 'blueprints', `cottage@1${v}.json`)
const text = v => JSON.stringify(cottageBlueprint(v), null, 1) + '\n'
const CH = { base: '#', course: '=', post: '|', wall: 'W', window: 'o', gable: 'G', gablewin: 'o', roof: null, ridge: '-', sill: '_', light: '*' }
const stairCh = (st, axis) => { const f = st?.facing ?? ''; return f.endsWith(axis) ? (f[0] === '+' ? '/' : '\\') : '=' }
/** One elevation: looking along `along` ('u' looks at the u-v... ) -> lines, top row first. The nearest non-air cell wins. */
export function elevation (bp, look = 'front') {
  const cells = bp.cells
  const X = look === 'front' ? c => c.u : c => c.v      // the horizontal axis on the picture
  const depth = look === 'front' ? c => c.v : c => c.u    // nearer = smaller
  const axis = look === 'front' ? 'u' : 'v'
  const xs = cells.map(X), ys = cells.map(c => c.y)
  const lines = []
  for (let y = Math.max(...ys); y >= Math.min(...ys); y--) {
    let row = ''
    for (let x = Math.min(...xs); x <= Math.max(...xs); x++) {
      const here = cells.filter(c => X(c) === x && c.y === y).sort((a, b) => depth(a) - depth(b))[0]
      row += here ? (CH[here.role] ?? stairCh(here.st, axis)) : ' '
    }
    lines.push(`y${y} ${row}`)
  }
  return lines
}
if (process.argv.includes('--check')) {
  let bad = 0
  for (const v of ['s', 'f']) if (!fs.existsSync(out(v)) || fs.readFileSync(out(v), 'utf8') !== text(v)) { console.log(`STALE ${out(v)}`); bad++ }
  process.exit(bad ? 1 : 0)
}
for (const v of ['s', 'f']) {
  if (!process.argv.includes('--render')) { fs.writeFileSync(out(v), text(v)); console.log(`wrote ${out(v)} (${cottageBlueprint(v).cells.length} cells)`) }
  else {
    const bp = cottageBlueprint(v)
    console.log(`\n${bp.id}  FRONT (looking at the doorway side, v 0)`); for (const l of elevation(bp, 'front')) console.log('  ' + l)
    console.log(`${bp.id}  SIDE (looking from u < 0)`); for (const l of elevation(bp, 'side')) console.log('  ' + l)
  }
}
