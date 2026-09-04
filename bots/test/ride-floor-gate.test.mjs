// `rideFloorDown` WAS GATED ON MATERIAL ONLY ITS FALLBACK BRANCH SPENDS.
//
// The function has two branches:
//   needsBridge = !under || under.boundingBox !== 'block'
//     true  -> place a carried block   (consults rescueBlocks)
//     false -> break the floor, land on it  -- FREE, no material
// Its own comment calls the free branch "98% of reality", because a bot that
// pillared to the build limit is standing on the pillar it built, so the block
// two below its feet is its own column.
//
// Its ONLY call site required `rescueBlocks(bot).length > 0`, which tests for
// material the free branch never touches -- and so refused exactly the bots the
// free branch exists for. Measured 2026-09-04 over 6h: of 8 marooned-high frozen
// bots, SIX held zero rescue blocks and failed on that line. Two of those passed
// every other precondition. `_ride_floor_down` fired 0 times across all 17.
//
// This is a source assertion because a removed precondition is not reachable by
// behaviour: the shape being asserted is the ABSENCE of a call. Comments are
// stripped first, because this codebase's comments quote the code they explain
// and a naive grep matches the explanation.
import assert from 'node:assert'
import test from 'node:test'
import fs from 'node:fs'

const SRC = new URL('../src/skills.mjs', import.meta.url).pathname
const raw = fs.readFileSync(SRC, 'utf8')

/** Executable text only: no line comments, no block comments. */
function stripComments (s) {
  return s
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map(l => l.replace(/(^|\s)\/\/.*$/, ''))
    .join('\n')
}
const code = stripComments(raw)

test('POSITIVE CONTROL: the stripper leaves executable code and removes prose', () => {
  // Without this, every assertion below could pass on an empty string.
  assert.ok(code.includes('export async function rideFloorDown'),
    'stripper destroyed the executable text')
  assert.ok(code.includes('rescueBlocks'), 'rescueBlocks must still exist somewhere')
  assert.ok(!/98% of reality/.test(code), 'prose survived the stripper')
  assert.ok(/98% of reality/.test(raw), 'the prose really is in the file')
})

test('rideFloorDown is still reachable -- exactly one call site', () => {
  const calls = code.match(/\brideFloorDown\s*\(/g) ?? []
  // one definition + one call
  assert.ok(calls.length >= 2, `rideFloorDown appears ${calls.length}x; it must be called`)
})

test('the call site does NOT gate on rescueBlocks', () => {
  // Find the guard that precedes the call and assert the material test is gone.
  const i = code.indexOf('await rideFloorDown(')
  assert.ok(i > 0, 'call site not found')
  const window = code.slice(Math.max(0, i - 400), i)
  assert.ok(!/rescueBlocks\s*\(\s*bot\s*\)\s*\.length\s*>\s*0/.test(window),
    'the material gate is back on the call site — the free branch is refused again')
})

test('the bridge branch still consults rescueBlocks -- we removed a gate, not a check', () => {
  const j = code.indexOf('export async function rideFloorDown')
  assert.ok(j > 0)
  const body = code.slice(j, j + 4000)
  assert.ok(/needsBridge/.test(body), 'the two-branch structure must survive')
  assert.ok(/rescueBlocks/.test(body),
    'the bridge branch must still refuse cleanly when there is nothing to place')
})

test('the free branch is guarded by needsBridge, not by inventory', () => {
  const j = code.indexOf('export async function rideFloorDown')
  const body = code.slice(j, j + 4000)
  const k = body.indexOf('needsBridge')
  assert.ok(k > 0)
  // rescueBlocks must appear AFTER the needsBridge test, i.e. inside the branch
  // that needs it -- never as a precondition on the whole manoeuvre.
  const firstRescue = body.indexOf('rescueBlocks')
  assert.ok(firstRescue > k,
    'rescueBlocks is consulted before needsBridge — that gates the free branch too')
})
