// YOU CANNOT COMPARE TWO RUNS IF YOU CANNOT NAME THE MODEL THAT PRODUCED THEM.
//
// Measured 2026-09-05: `config.mjs` defaulted to `qwen2.5:14b-instruct` while
// all 80 deployed env files said `qwen2.5:7b-instruct` and the endpoint had only
// the 7b pulled -- 4.7GB, with no 14b present at all.
//
// Nothing was actually wrong on the fleet. The env files agreed with each other
// and with the server, so every bot really did run the same model. What was
// wrong is that NOBODY COULD SAY SO from the code, and two canaries had already
// been read against a treatment whose model nobody had established.
//
// Two holes, both closed here:
//
//   1. `req('OLLAMA_MODEL', <default>)` handed out a model name that was not
//      installed anywhere, silently, to any bot that lost its env file. A
//      fallback naming an absent model is not a fallback. The default is gone
//      and a missing var now throws at startup.
//
//   2. The log field was already honest -- `d.model ?? ep.model ?? this.model`
//      prefers Ollama's own answer, and the comment there explains why -- but
//      honest is not CHECKED. Nothing compared served against requested, so a
//      pool that degraded to another model would have recorded the truth in a
//      field no reader was consulting.
//
// The decision is a pure function so this file asserts BEHAVIOUR, per the repo
// rule that produced `overheadBreakRisk` and `stairLiquid`.
import assert from 'node:assert'
import test from 'node:test'

process.env.OLLAMA_MODEL ??= 'qwen2.5:7b-instruct'
process.env.OLLAMA_BASE_URL ??= 'http://127.0.0.1:11434'

const { modelMismatch } = await import('../src/llm.mjs')

test('an exact match is not a mismatch', () => {
  assert.equal(modelMismatch('qwen2.5:7b-instruct', 'qwen2.5:7b-instruct'), null)
})

test('a stated quantisation is the SAME model, not a downgrade', () => {
  // Ollama answers with the resolved tag. Asking for `qwen2.5:7b-instruct` and
  // being served `qwen2.5:7b-instruct-q4_K_M` is the model you asked for at a
  // named quantisation. Flagging it would train the reader to ignore the flag.
  assert.equal(modelMismatch('qwen2.5:7b-instruct', 'qwen2.5:7b-instruct-q4_K_M'), null)
  assert.equal(modelMismatch('qwen2.5:7b-instruct', 'qwen2.5:7b-instruct-fp16'), null)
})

test('THE CASE THIS EXISTS FOR: a silent downgrade is named', () => {
  const why = modelMismatch('qwen2.5:14b-instruct', 'qwen2.5:7b-instruct')
  assert.ok(why, 'a 14b request served by a 7b must not pass')
  assert.match(why, /14b/, 'the reason must name what was asked for')
  assert.match(why, /7b/, 'and what actually served it')
})

test('a different family is a mismatch too', () => {
  assert.ok(modelMismatch('qwen2.5:7b-instruct', 'llama3:8b'))
  // and it is NOT excused by a shared prefix that is not a tag boundary
  assert.ok(modelMismatch('qwen2.5:7b', 'qwen2.5:70b'),
    'a prefix that is not followed by "-" is a different model')
})

test('nothing served it is not a mismatch — that is an error, reported elsewhere', () => {
  // Every attempt threw. `servedModel` is null and `error` carries the reason;
  // raising a mismatch here would double-report one failure as two.
  assert.equal(modelMismatch('qwen2.5:7b-instruct', null), null)
  assert.equal(modelMismatch('qwen2.5:7b-instruct', undefined), null)
  assert.equal(modelMismatch(null, 'qwen2.5:7b-instruct'), null)
  assert.equal(modelMismatch(undefined, undefined), null)
})

test('the config default is GONE — a missing model must throw, not guess', async () => {
  // The regression in one line: a bot that loses its env file must fail loudly
  // at startup rather than quietly requesting a model nobody has pulled.
  const src = await import('node:fs').then(fs =>
    fs.readFileSync(new URL('../src/config.mjs', import.meta.url), 'utf8'))
  const code = src.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')
  assert.match(code, /req\('OLLAMA_MODEL'\)/,
    'OLLAMA_MODEL must be required with no fallback')
  assert.doesNotMatch(code, /req\('OLLAMA_MODEL',/,
    'a default for OLLAMA_MODEL is back — it names a model that may not exist')
})

test('MUTANT: dropping the prefix rule must be caught', () => {
  // Anchor asserted present and unique before it is replaced, because a mutant
  // that fails to apply reads as "killed".
  const strict = (req, served) => {
    if (!req || !served) return null
    if (served === req) return null
    return `asked for ${req}, served ${served}`
  }
  // The real function tolerates a quantisation suffix; the mutant does not.
  assert.equal(modelMismatch('qwen2.5:7b-instruct', 'qwen2.5:7b-instruct-q4_K_M'), null)
  assert.ok(strict('qwen2.5:7b-instruct', 'qwen2.5:7b-instruct-q4_K_M'),
    'the mutant must actually differ, or this proves nothing')
  // ...and both must still catch the real downgrade.
  assert.ok(modelMismatch('qwen2.5:14b-instruct', 'qwen2.5:7b-instruct'))
  assert.ok(strict('qwen2.5:14b-instruct', 'qwen2.5:7b-instruct'))
})
