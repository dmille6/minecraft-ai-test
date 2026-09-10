process.env.OLLAMA_MODEL ??= 'qwen2.5:7b-instruct'
// ---- A PLACED TABLE COUNTS TOO -------------------------------------------
//
// `hasTable` used to mean "carried", full stop. But `craft` resolves its own
// prerequisites by crafting a table and PLACING it, so the commonest state
// right after a successful craft is: table on the ground, none in the pack.
// The affordance line then told the bot it could not make any 3x3 recipe while
// it was standing next to one. ChatGPT found this reading prompt.mjs:467-481.
//
// 32 blocks because that is the radius `craft` itself searches before walking,
// so the line promises exactly what the skill will deliver.
import assert2 from 'node:assert'
import test2 from 'node:test'
const { tableAccess } = await import('../src/prompt.mjs')

const bot = ({ carried = false, placed = null } = {}) => ({
  inventory: { items: () => carried ? [{ name: 'crafting_table', count: 1 }] : [] },
  registry: { blocks: { 7: { name: 'crafting_table' } } },
  findBlock: ({ matching }) => (placed && matching({ type: 7 }))
    ? { type: 7, position: { x: placed[0], y: placed[1], z: placed[2] } } : null,
})

test2('a carried table still counts, and is reported as carried', () => {
  const a = tableAccess(bot({ carried: true }))
  assert2.equal(a.has, true); assert2.equal(a.carried, true)
})

test2('a PLACED table within reach counts — this is the bug being fixed', () => {
  const a = tableAccess(bot({ placed: [10, 64, 10] }))
  assert2.equal(a.has, true, 'a bot beside a table can craft 3x3 recipes')
  assert2.equal(a.carried, false, 'and it must not be told to place one it does not carry')
  assert2.ok(a.near, 'the position is returned so the line can name it')
})

test2('neither means neither', () => {
  const a = tableAccess(bot())
  assert2.equal(a.has, false)
})

test2('a broken findBlock must not break the prompt', () => {
  // The prompt is built every decision; an exception here would cost the bot
  // its whole turn rather than one missing line.
  const b = { inventory: { items: () => [] }, registry: {},
              findBlock () { throw new Error('world not loaded') } }
  assert2.doesNotThrow(() => tableAccess(b))
  assert2.equal(tableAccess(b).has, false)
})
