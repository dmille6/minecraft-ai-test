// A RUNAWAY GENERATION IS A FLEET-WIDE OUTAGE.
//
// Measured over 14.1 hours on the inference host: 68 generations ran away,
// median 6,199 tokens decoded, 58 of them holding the slot for the full 45s
// client timeout. 2,836 slot-seconds blocked in total.
//
// With OLLAMA_NUM_PARALLEL=1 there is exactly one slot, so every one of those
// stalls the WHOLE fleet, and that is the entire latency tail:
//
//   99.4% of slow decisions fall within +/-15s of a runaway window
//    4.7% of fast decisions do                       -- a 21x separation
//   arrival-rate check: 169 decisions expected to land during a block, 177 seen
//   on slow calls, Ollama's own total_duration is 28.3s while load+prefill+
//   decode is 0.63s -- 27.7s of scheduler queue wait inside the server
//
// The bots were never GPU-starved. Utilisation was ~4%. One unbounded string
// field was taking the fleet down for 45 seconds at a time.
//
// The real logged runaway:
//   {"skill":"mine","args":{"y":62,"player":"Gather01}}<tool_call>
//    \n fkkend: END-X5HYR8<tool_call>\n fkkend: END-X5HYR8...
//
// `player` opens and never closes. The grammar Ollama compiles from our schema
// permitted an arbitrarily long string there, so nothing could stop it.
import assert from 'node:assert'
import { skillSchema } from '../src/llm.mjs'

let pass = 0, fail = 0
const t = (name, fn) => {
  try { fn(); pass++; console.log(`  PASS  ${name}`) }
  catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) }
}

const S = skillSchema(['mine', 'gather', 'craft', 'goto'])

t('every string in the schema is length-bounded', () => {
  const unbounded = []
  const walk = (node, path) => {
    if (!node || typeof node !== 'object') return
    if (node.type === 'string' && node.maxLength == null && !node.enum) unbounded.push(path)
    for (const [k, v] of Object.entries(node.properties ?? {})) walk(v, `${path}.${k}`)
  }
  walk(S, 'root')
  assert.deepEqual(unbounded, [],
    `an unbounded string is a field the model can loop in forever: ${unbounded.join(', ')}`)
})

t('the fields the live runaway used are bounded', () => {
  // Named explicitly so a future refactor cannot quietly drop the cap on the
  // exact field that took the fleet down.
  assert.ok(S.properties.args.properties.player.maxLength, 'args.player')
  assert.ok(S.properties.saw_end.maxLength, 'saw_end')
  assert.ok(S.properties.args.properties.item.maxLength, 'args.item')
  assert.ok(S.properties.args.properties.block.maxLength, 'args.block')
})

t('the caps still admit every legitimate value', () => {
  // Longest real names in play, so the bound cannot be tightened into a bug.
  const longestBlock = 'polished_blackstone_brick_slab'   // 30
  const longestItem = 'netherite_upgrade_smithing_template' // 35 -- see below
  assert.ok(longestBlock.length <= S.properties.args.properties.block.maxLength,
    `${longestBlock} (${longestBlock.length}) must fit in ${S.properties.args.properties.block.maxLength}`)
  // Bot names in this lab are 8 characters.
  assert.ok('Gather01'.length < S.properties.args.properties.player.maxLength)
  // The end sentinel is END- plus 6 characters.
  assert.ok('END-X5HYR8'.length <= S.properties.saw_end.maxLength)
  // Recorded so the one name that does NOT fit is a deliberate, visible choice
  // rather than a surprise: no skill takes a smithing template as an argument.
  assert.ok(longestItem.length > S.properties.args.properties.item.maxLength)
})

t('reason keeps the cap it already had', () => {
  assert.equal(S.properties.reason.maxLength, 60)
})

console.log(`  ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
