// test-result.test.mjs -- run-tests.mjs's SKIP contract (phase 1 item 3, 11-06): a git-only test on a tree with no .git
// exits 77 after `SKIP (<why>)` and is reported SKIPPED, never as a pass and never as a failure; anything else that exits
// 77 is a FAILURE. Behaviour: the pure classifier, then the real runner on a scratch test directory.
import assert from 'node:assert'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { isSkip, SKIP_CODE, gitContext } from '../scripts/test-result.mjs'

let pass = 0, fail = 0
const t = async (n, f) => { try { await f(); pass++; console.log(`  PASS  ${n}`) } catch (e) { fail++; console.log(`  FAIL  ${n}\n        ${e.message}`) } }

await t('isSkip: exit 77 + a SKIP line is a skip', () => assert.equal(isSkip(77, 'x\nSKIP (no git checkout here)\n', false), true))
await t('isSkip: exit 77 without the line is NOT a skip', () => assert.equal(isSkip(77, 'crashed', false), false))
await t('isSkip: a FAIL line wins over the skip', () => assert.equal(isSkip(77, '  FAIL  a\nSKIP (x)\n', false), false))
await t('isSkip: a timeout wins over the skip', () => assert.equal(isSkip(77, 'SKIP (x)', true), false))
await t('isSkip: exit 0 is not a skip', () => assert.equal(isSkip(0, 'SKIP (x)', false), false))
await t('the code is 77', () => assert.equal(SKIP_CODE, 77))
await t('gitContext: this checkout has git (positive control)', async () => {
  const c = await gitContext(fileURLToPath(new URL('.', import.meta.url)))
  assert.ok(c.ok || process.env.SUITE_NO_GIT, `no git context: ${c.why}`)
})
await t('gitContext: a plain directory has none', async () => {
  const d = mkdtempSync(path.join(os.tmpdir(), 'nogit-'))
  try {
    const c = await gitContext(d)
    assert.equal(c.ok, false)
    assert.match(c.why, /no git checkout/)
  } finally { rmSync(d, { recursive: true, force: true }) }
})
await t('the runner reports a skip as SKIPPED, a pass as passed, and a bare exit 77 as FAILED', () => {
  const d = mkdtempSync(path.join(os.tmpdir(), 'rt-'))
  try {
    mkdirSync(path.join(d, 'test'))
    writeFileSync(path.join(d, 'test', 'a-skip.test.mjs'), "console.log('SKIP (no git checkout here)'); process.exit(77)\n")
    writeFileSync(path.join(d, 'test', 'b-pass.test.mjs'), "console.log('1 passed'); process.exit(0)\n")
    writeFileSync(path.join(d, 'test', 'c-bare77.test.mjs'), "process.exit(77)\n")
    const runner = fileURLToPath(new URL('../scripts/run-tests.mjs', import.meta.url))
    const r = spawnSync(process.execPath, [runner], { cwd: d, encoding: 'utf8', env: { ...process.env, TEST_JOBS: '2' }, timeout: 60_000 })
    const out = r.stdout + r.stderr
    assert.match(out, /^skip a-skip\.test\.mjs/m, out)
    assert.match(out, /^SKIPPED \(1\): a-skip\.test\.mjs -- not run here, NOT passed$/m, out)
    assert.match(out, /^FAILED \(1\): c-bare77\.test\.mjs$/m, out)
    assert.match(out, /^1\/3 files passed$/m, out)            // the skip is not counted as passed
    assert.equal(r.status, 1, 'the bare 77 fails the run')
  } finally { rmSync(d, { recursive: true, force: true }) }
})
await t('MUTANT: a runner that ignores the SKIP line would pass the bare 77', () => {
  const src = readFileSync(new URL('../scripts/test-result.mjs', import.meta.url), 'utf8')
  const anchor = "code === SKIP_CODE && /^SKIP \\(/m.test(out || '')"
  assert.equal(src.split(anchor).length - 1, 1, 'ANCHOR MISSING OR NOT UNIQUE')
  const d = mkdtempSync(path.join(os.tmpdir(), 'mut-'))
  try {
    const f = path.join(d, 'm.mjs')
    writeFileSync(f, src.replace(anchor, 'code === SKIP_CODE'))
    return import(f).then(m => assert.equal(m.isSkip(77, 'crashed', false), true, 'the mutant must change the verdict'))
  } finally { setTimeout(() => rmSync(d, { recursive: true, force: true }), 1000) }
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
