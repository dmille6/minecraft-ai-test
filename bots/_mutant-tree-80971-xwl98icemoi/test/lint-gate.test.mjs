// THE NO-UNDEF GATE WAS NEVER WIRED TO THE FLEET.
//
// eslint.config.mjs says "Deploys run it and refuse to install a harness that fails". Only
// deploy-harness.sh (instance #1) ever did; deploy-fleet.sh, fleet-deploy.sh and fleet-deploy-host.sh
// never ran it, and the fleet sha 8453c09 itself fails it. Found 2026-10-03 when logpickup, rebased
// from 93b3892 onto 8453c09, referenced `gatherT0` -- declared only by the ore-tunnel change, absent on
// that base. Every log gather would have thrown a ReferenceError; logpickup's own tests happened to
// catch it, but a rebased diff touching an UNTESTED path would have deployed.
//
// So the gate lives here: the suite is the one thing that always runs, on every variant.
import assert from 'node:assert'
import { ESLint } from 'eslint'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

let pass = 0, fail = 0
const t = async (n, f) => { try { await f(); pass++; console.log(`  PASS  ${n}`) } catch (e) { fail++; console.log(`  FAIL  ${n}\n        ${e.message}`) } }

const BOTS = join(dirname(fileURLToPath(import.meta.url)), '..')
const eslint = new ESLint({ cwd: BOTS, overrideConfigFile: join(BOTS, 'eslint.config.mjs') })

// POSITIVE CONTROL: the configured linter sees an undeclared identifier. Without this, a config that
// silently stopped loading would read as a clean tree.
await t('control: an undeclared identifier is an error', async () => {
  const [r] = await eslint.lintText('export function g () { return gatherT0 + 1 }\n', { filePath: join(BOTS, 'src', 'zz-control.mjs') })
  assert.deepStrictEqual(r.messages.map(m => `${m.ruleId}:${m.message}`), ["no-undef:'gatherT0' is not defined."])
})

await t('src/ has no undeclared identifiers and no floating promises', async () => {
  const results = await eslint.lintFiles(['src/*.mjs'])
  assert.ok(results.length > 20, `linted only ${results.length} files -- the glob found nothing`)
  const errs = results.flatMap(r => r.messages.filter(m => m.severity === 2).map(m => `${r.filePath.split('/src/')[1]}:${m.line} ${m.ruleId} ${m.message}`))
  assert.deepStrictEqual(errs, [])
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
