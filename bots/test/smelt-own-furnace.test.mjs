// THE REMEDY WAS IN ITS POCKET.
//
// `smelt` takes the nearest furnace within 32 blocks and walks to it. If the
// walk could not close the distance it FAILED -- while 68 of 80 bots carry a
// furnace item. Measured in one 70-minute window: 11 of 56 smelt attempts died
// on exactly this, against 13 successes. "Move to 1046,308 first" is advice
// about a place the bot has just failed to reach; putting down the one it is
// holding is a remedy it can perform where it stands.
import assert from 'node:assert'
import test from 'node:test'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
process.env.OLLAMA_MODEL ??= 'qwen2.5:7b-instruct'
const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src')
const CODE = fs.readFileSync(path.join(SRC, 'skills.mjs'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

// The bound is matched as `4.5|STATION_REACH`: it was spelled as a bare
// literal in three places until workorder.mjs needed exactly this number and
// guessed 32 instead. What these tests are about is `!placed` and the
// re-measure, not how the constant is written -- pinning the spelling turned a
// correct refactor red once already.
test('an unreachable furnace makes it place the one it carries', () => {
  assert.match(CODE, /if \(reach > (?:4\.5|STATION_REACH) && !placed\)[\s\S]{0,400}?place\(ctx, \{ item: 'furnace' \}, signal\)/,
    'the fallback must actually place')
  assert.match(CODE, /if \(reach > (?:4\.5|STATION_REACH) && !placed\)[\s\S]{0,500}?reach = bot\.entity\.position\.distanceTo/,
    'and RE-MEASURE reach against the new furnace, not assume it worked')
})

test('it cannot spend a furnace per attempt', () => {
  // `!placed` is the whole bound: without it a bot that places a furnace it
  // still cannot reach would place another on every call.
  assert.match(CODE, /reach > (?:4\.5|STATION_REACH) && !placed/, 'guarded on not having placed one already')
})

test('the refusal still names coordinates to walk to', () => {
  // A test in smelt-skill.test.mjs asserts this and is right to: "move to x,z"
  // is performable with goto. My first version replaced it with craft advice,
  // which is a WORSE remedy for a bot that owns no furnace.
  assert.match(CODE, /move to \$\{block\.position\.x\},\$\{block\.position\.z\} first/)
})

test('and it distinguishes the two failures', () => {
  // "could not reach it" and "could not reach it AND placing mine did not help"
  // are different situations with different next moves.
  assert.match(CODE, /placing the one you carry did not help either/)
  assert.match(CODE, /craft item=furnace \(8 cobblestone\)/)
})
