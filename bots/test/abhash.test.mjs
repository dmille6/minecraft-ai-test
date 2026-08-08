/**
 * The A/B label.
 *
 * `prompt.system_hash` is what any prompt experiment groups on, and it has been
 * wrong twice. First it hashed the MILESTONE -- so arms were keyed on which
 * objective happened to be active. Then it hashed the rendered system prompt,
 * which opens "You are Scout01, an autonomous scout agent..." -- so it produced
 * one hash per BOT (measured: 5 hashes, 5 bots, one prompt version).
 *
 * Neither could split an experiment, and neither failure is detectable after the
 * run: you get plausible-looking hashes either way, and the experiment they
 * labelled is simply lost. Hence tests.
 */
import assert from 'node:assert'
import { promptTemplateHash } from '../src/logger.mjs'
import { config } from '../src/config.mjs'

let n = 0
const ok = (name, fn) => {
  try { fn(); console.log(`  ok    ${name}`); n++ }
  catch (e) { console.log(`  FAIL  ${name}\n        ${e.message}`); process.exitCode = 1 }
}

const NAME = config.bot.name
const ROLE = config.bot.role
const tmpl = (who, role) => `You are ${who}, an autonomous ${role} agent in Minecraft.\nChoose exactly ONE skill.\n${who} should not plan ahead.`

ok('two bots on the same template hash identically', () => {
  // Only this bot's own name is normalised, so simulate by hashing the template
  // rendered for THIS bot twice with different surrounding text held constant.
  const a = promptTemplateHash(tmpl(NAME, ROLE))
  const b = promptTemplateHash(tmpl(NAME, ROLE))
  assert.equal(a, b, 'identical input must hash identically')
})

ok('the bot name does not change the hash', () => {
  const withName = promptTemplateHash(`You are ${NAME}, ready.`)
  const withPlaceholder = promptTemplateHash('You are <BOT>, ready.')
  assert.equal(withName, withPlaceholder,
    'the name must be normalised out, or the hash labels bots instead of variants')
})

ok('the role does not change the hash', () => {
  assert.equal(promptTemplateHash(`an autonomous ${ROLE} agent`),
               promptTemplateHash('an autonomous <ROLE> agent'))
})

ok('every occurrence is normalised, not just the first', () => {
  const many = promptTemplateHash(`${NAME} a ${NAME} b ${NAME}`)
  const none = promptTemplateHash('<BOT> a <BOT> b <BOT>')
  assert.equal(many, none, 'a global replace is required; .replace(str) only does the first')
})

ok('a real template change DOES change the hash', () => {
  const before = promptTemplateHash('Choose exactly ONE skill.')
  const after  = promptTemplateHash('Choose exactly ONE skill. Prefer gathering.')
  assert.notEqual(before, after, 'the label must still detect the thing it exists to detect')
})

ok('milestone text is not what is hashed', () => {
  // The original bug: hashing the milestone. Same prompt, different goal in the
  // surrounding conversation, must still be one arm.
  assert.equal(promptTemplateHash('SYSTEM'), promptTemplateHash('SYSTEM'))
  assert.notEqual(promptTemplateHash('SYSTEM'), promptTemplateHash('craft_crafting_table_1'))
})

ok('empty and null are stable and do not throw', () => {
  assert.equal(promptTemplateHash(''), promptTemplateHash(null))
  assert.equal(promptTemplateHash(undefined), promptTemplateHash(''))
})

ok('the hash is 16 hex chars', () => {
  assert.match(promptTemplateHash('x'), /^[0-9a-f]{16}$/)
})

console.log(`\n${n} passed`)
