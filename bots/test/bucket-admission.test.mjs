// A BUCKET ACTION WITHOUT A BUCKET IS NOT A PLAN.
//
// `bucket` ran 177 times fleet-wide and failed 177 times. Sixty-eight of those
// were `no empty bucket` -- the bot simply did not have one. The skill refuses
// correctly (bucket.mjs:73), but only after the proposal has been admitted,
// dispatched, and burned a ~30s decision cycle. On a fleet where the cooldown
// is two thirds of every bot-hour, a decision spent learning something the
// inventory already knew is the most expensive possible no-op.
//
// placebo-b-Comet -- one of six bots that produced NOTHING in a 40-minute
// window -- spent 12 of its 50 skill runs here, 11 on this exact refusal,
// while stuck at y=-19 with three item kinds to its name.
import assert from 'node:assert'
import test from 'node:test'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
process.env.OLLAMA_MODEL ??= 'qwen2.5:7b-instruct'
const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src')
const CODE = fs.readFileSync(path.join(SRC, 'admission.mjs'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

test('the gate exists and is on the executable path', () => {
  assert.match(CODE, /if \(skill === 'bucket'\) \{/)
  assert.match(CODE, /reason: 'no_empty_bucket'/)
  assert.match(CODE, /reason: 'no_filled_bucket'/)
})

test('fill needs an EMPTY bucket; pour needs a FULL one', () => {
  // The two are different refusals with different remedies, and collapsing them
  // would tell a bot holding a full bucket to go craft another.
  const gate = CODE.slice(CODE.indexOf("if (skill === 'bucket')"))
  assert.match(gate, /action === 'pour'[\s\S]{0,160}?water_bucket/,
    'pour checks for a filled bucket')
  assert.match(gate, /action !== 'pour'[\s\S]{0,120}?has\('bucket'\)/,
    'fill checks for an empty one')
})

test('each refusal names a remedy the bot can actually perform', () => {
  // The repo rule: a refusal must name something doable from where the bot is.
  // "craft one from 3 iron ingots" is doable; "have a bucket" is not.
  const gate = CODE.slice(CODE.indexOf("if (skill === 'bucket')"))
  assert.match(gate, /craft one from 3 iron ingots/,
    'no bucket at all -> say how to get one')
  assert.match(gate, /pour it out before filling again/,
    'bucket already full -> say what to do with it, not to go get another')
})

test('it does not fire for other skills', () => {
  const gate = CODE.slice(CODE.indexOf("if (skill === 'bucket')"),
                          CODE.indexOf("if (skill === 'deposit')"))
  assert.ok(gate.length > 0 && gate.length < 1800,
    'the bucket branch is bounded and does not swallow the deposit gate below it')
})
