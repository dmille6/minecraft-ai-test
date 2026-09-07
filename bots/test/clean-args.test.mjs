// 28.1% OF `player` ARGS ARRIVED AS DEBRIS, ON 76 OF 80 BOTS.
//
// The schema caps these strings at 32 characters, which stopped the runaway
// that used to exhaust the context. It could not stop the CONTENT: `}` is legal
// inside a JSON string, so the model closes the object where it means to, the
// grammar keeps accepting, and the value fills to the cap with debris.
//
// The real fix is a grammar `pattern`, verified against qwen3.6:35b on
// 2026-09-07 -- ordered to append `}}` and trailing text, it returned
// "Alpha01}} Here is some extra" with maxLength alone and "Alpha01" with the
// pattern. This function is the second layer, and it doubles as the instrument
// that says whether the first layer took: once the grammar is live, `cleaned`
// must be empty on every call.
import assert from 'node:assert'
import test from 'node:test'
import { cleanArgs, ARG_PATTERNS } from '../src/llm.mjs'

// Verbatim from the fleet logs, 2026-09-07.
const REAL = [
  ['player', 'board-d-Alpha}}iệu\n팰', 'board-d-Alpha'],
  ['player', "placebo-d-Echo END-LA7Y1W'}}iska", 'placebo-d-Echo'],
  ['player', 'board-a-Delta}}vak8I22II8vak8I22', 'board-a-Delta'],
  ['player', 'board-a-Delta}}iskaag1234567890✿', 'board-a-Delta'],
  ['item', "cobblestone'}} END-LBDWB6", 'cobblestone'],
  ['item', "cobblestone'}} Łańcŭ'})", 'cobblestone'],
  ['item', "sand'}}", 'sand'],
  ['block', '60}} END-SQWCHB', '60'],
]

test('every corrupt value seen on the fleet is trimmed to what the model meant', () => {
  for (const [field, was, want] of REAL) {
    const { args, cleaned } = cleanArgs({ [field]: was })
    assert.equal(args[field], want, `${field}: ${JSON.stringify(was)}`)
    assert.equal(cleaned.length, 1, 'and it is REPORTED, not silently repaired')
    assert.equal(cleaned[0].field, field)
  }
})

test('clean values pass through untouched and are not reported', () => {
  // POSITIVE CONTROL. Without this the whole file is satisfied by a function
  // that mangles everything.
  for (const args of [
    { player: 'hive-a-Echo' }, { block: 'oak_log' }, { item: 'stone_pickaxe' },
    { block: 'cobbled_deepslate' }, { player: 'Alpha01' },
  ]) {
    const r = cleanArgs(args)
    assert.deepEqual(r.args, args, JSON.stringify(args))
    assert.equal(r.cleaned.length, 0, 'a clean arg must not be reported as cleaned')
  }
})

test('non-string args are never touched', () => {
  const args = { x: 12, y: -60, z: 4, count: 3, block: 'stone' }
  assert.deepEqual(cleanArgs(args).args, args)
})

test('a value with nothing legal in it is DROPPED, not passed through', () => {
  const { args, cleaned } = cleanArgs({ player: '}}}{{{' })
  assert.ok(!('player' in args), 'no legal prefix means no argument at all')
  assert.equal(cleaned.length, 1)
  assert.equal(cleaned[0].now, '')
})

test('junk input cannot throw', () => {
  // This sits on the decision path for every LLM call the fleet makes.
  for (const junk of [null, undefined, 'string', 42, []]) {
    assert.doesNotThrow(() => cleanArgs(junk), String(junk))
  }
  assert.deepEqual(cleanArgs(null), { args: {}, cleaned: [] })
})

test('the sanitizer and the grammar agree on what is legal', () => {
  // If these two drifted apart, the sanitizer would either undo values the
  // grammar allows or pass values it forbids -- and the `args_cleaned` counter
  // would stop meaning "the grammar did not hold".
  for (const [field, pat] of Object.entries(ARG_PATTERNS)) {
    const ok = { player: 'hive-a-Echo', block: 'oak_log', item: 'stone_pickaxe' }[field]
    assert.ok(pat.test(ok), `${field}: ${ok} must be legal`)
    const r = cleanArgs({ [field]: ok })
    assert.equal(r.args[field], ok)
  }
  assert.ok(!ARG_PATTERNS.player.test('a}b'), 'a brace is never legal in a name')
  assert.ok(!ARG_PATTERNS.block.test('OakLog'), 'block ids are lowercase')
  assert.ok(ARG_PATTERNS.player.test('placebo-d-Echo'), 'bot names carry hyphens')
})

test('a cleaned value is truncated, never lengthened or reordered', () => {
  for (const [field, was] of REAL.map(r => [r[0], r[1]])) {
    const got = cleanArgs({ [field]: was }).args[field] ?? ''
    assert.ok(was.startsWith(got), `${got} must be a PREFIX of ${JSON.stringify(was)}`)
  }
})
