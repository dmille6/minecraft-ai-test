// SHOWCASE RELEASE TOOL (owner 11-14: "clean up this test, implement, stage, queue, fix loop"). infra/showcase/test_showcase.py
// holds the behaviour tests of the release tool's pure decisions (the follow rule, the piece and main gates, the tripwire's
// remedies, and from 11-14 the one-change-at-a-time gate). Nothing ran it from `npm test`: its mutant file sat with a stale
// anchor from 11-10 to 11-14 and nobody saw. It runs here so the suite cannot be green while it is red. The mutants
// (test_showcase_mutants.py, 92, several minutes) stay a by-hand run before a release-tool change.
import assert from 'node:assert'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const r = spawnSync('python3', ['-W', 'ignore', path.join(REPO, 'infra/showcase/test_showcase.py')], { encoding: 'utf8', timeout: 240_000 })
const out = (r.stdout || '') + (r.stderr || '')
console.log(out.split('\n').filter(l => /^(FAIL|ERROR|Ran |OK|FAILED)/.test(l)).join('\n'))
assert.equal(r.status, 0, out.slice(-2500))
const m = /Ran (\d+) tests/.exec(out)
assert.ok(m && Number(m[1]) >= 176, `expected at least 176 tests, ran ${m && m[1]}`)
console.log(`showcase release tool: ok (${m[1]} tests)`)
