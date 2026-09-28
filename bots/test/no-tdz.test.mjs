/**
 * No `let`/`const` is read in its own scope before its declaration.
 *
 * Such a read is not a style problem: it is a ReferenceError the first time the line runs. In the death
 * handler it read `cause` five lines above `const cause = freshDeathCause()`, so every death more than 3 blocks
 * below the recent peak threw out of mineflayer's packet handler and killed the process. Measured 2026-09-28:
 * 17 crashes across 15 bots in the 36 hours after 8f1e037 reached the fleet (859af48, 09-27). The restarted
 * bot rejoined dead and logged the death a second time as "unknown; idle", so the death COUNT survived and
 * its cause, fall distance and death site were lost -- `after falling` went from 6-45 rows a day to 0.
 * No test saw it because `npm run lint` is not part of `npm test`, and the line only runs on such a death.
 *
 * WHAT THIS DOES AND DOES NOT PROVE. `variables: false` flags a read that comes before the declaration in
 * the SAME FUNCTION (nested blocks, switch cases and static class fields included); a closure that reads a
 * later `const` is not flagged, because it is legal when it runs later. It is a regression guard for this
 * class, NOT a proof of no TDZ: both reviews (2026-09-28) showed it misses an immediately-invoked arrow, a
 * synchronous callback, an instance class field and a default parameter, all of which do throw.
 */
import assert from 'node:assert'
import { readdirSync, readFileSync } from 'node:fs'
import { Linter } from 'eslint'

let n = 0
const ok = (name, fn) => {
  try { fn(); console.log(`  ok    ${name}`); n++ }
  catch (e) { console.log(`  FAIL  ${name}\n        ${e.message}`); process.exitCode = 1 }
}

const linter = new Linter()
const CONFIG = [{
  languageOptions: { ecmaVersion: 'latest', sourceType: 'module' },
  rules: { 'no-use-before-define': ['error', { functions: false, classes: false, variables: false }] },
}]
const tdz = src => linter.verify(src, CONFIG)

ok('the instrument sees a presence: the death-handler shape is flagged', () => {
  const found = tdz(`bot.on('death', () => {\n  record({ cause: deathClass(cause) })\n  const cause = freshDeathCause()\n})\n`)
  assert.equal(found.length, 1, `expected one finding, got ${JSON.stringify(found)}`)
  assert.equal(found[0].ruleId, 'no-use-before-define')
  assert.equal(found[0].line, 2)
})

ok('the instrument does not flag a closure that reads a later const when it runs later', () => {
  const found = tdz(`const f = () => later\nconst later = 1\nf()\n`)
  assert.deepEqual(found, [])
})

ok('no src/*.mjs reads a let/const in its own scope before declaring it', () => {
  const dir = new URL('../src/', import.meta.url)
  const files = readdirSync(dir).filter(f => f.endsWith('.mjs'))
  assert.ok(files.length > 20, `only ${files.length} source files found -- wrong directory?`)
  const bad = []
  for (const f of files) {
    for (const m of tdz(readFileSync(new URL(f, dir), 'utf8'))) {
      // a parse error is a finding too: an unparsed file was not checked
      bad.push(`${f}:${m.line} ${m.message}`)
    }
  }
  assert.deepEqual(bad, [])
})

console.log(`\n${n} passed`)
