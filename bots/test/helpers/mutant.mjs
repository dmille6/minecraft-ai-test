// withMutant, as in test/climb-escape.test.mjs (CLAUDE.md: mutants assert their anchor is present AND unique; a mutant
// that silently fails to apply reads as killed). Shared here for the homefix-01 suites; the mutant is written next to
// the tests (test/), so './x.mjs' imports become '../src/x.mjs'.
import assert from 'node:assert'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'

export async function withMutant (path, old, neu, fn) {
  return withMutantsAll(path, [[old, neu]], fn)
}

/** Several anchored replacements in one mutant (each present AND unique). */
export async function withMutantsAll (path, pairs, fn) {
  let src = readFileSync(path, 'utf8')
  for (const [old, neu] of pairs) {
    assert.ok(src.includes(old),
      `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 60))} is not in ${path.pathname ?? path}. ` +
      'A mutant that was never written reads as killed.')
    assert.ok(src.split(old).length === 2, `the mutation target is not unique; the mutant is ambiguous: ${JSON.stringify(old.slice(0, 60))}`)
    src = src.replace(old, neu)
  }
  const out = new URL(`../_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, src.replace(/from '\.\//g, "from '../src/"))
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}
