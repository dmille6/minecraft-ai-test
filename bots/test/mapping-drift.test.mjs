// THE LOGGER MUST NOT KNOW MORE THAN ELASTICSEARCH IS MAPPED TO ACCEPT.
//
// mcai-skill-* and mcai-llm-* are `dynamic: strict`. Under strict mapping an
// unmapped field does not get dropped -- it rejects the ENTIRE document, and
// the only symptom is a dropped-events counter inside Filebeat. Telemetry does
// not degrade, it disappears, and the graphs keep drawing because the records
// that survive are the ones that changed least.
//
// This has already happened twice. The mapping in infra/elk/apply-mappings.sh
// drifted behind logger.mjs for `exp.pool`, `llm.admission`, `memory.*` and
// `board.*`: production was correct only because those were applied to both
// clusters BY HAND, so the repo could still rebuild a cluster that silently
// drops exactly the fields Block 2 pre-registered on. A new host gets built
// from these scripts, which is precisely when nobody is watching the field list.
//
// So the assertion is repo-against-repo: every field logger.mjs can emit must
// appear in the mapping file that builds the cluster.
import assert from 'node:assert'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const mapping = readFileSync(join(here, '../../infra/elk/apply-mappings.sh'), 'utf8')
const logger = readFileSync(join(here, '../src/logger.mjs'), 'utf8')

let pass = 0, fail = 0
const t = (name, fn) => {
  try { fn(); pass++; console.log(`  PASS  ${name}`) }
  catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) }
}

/** Field names the mapping file declares, at any nesting depth. */
const mapped = new Set(
  [...mapping.matchAll(/\\?"([a-z_][a-z0-9_]*)\\?"\s*:\s*\{\s*\\?"(?:type|properties)\\?"/gi)]
    .map(m => m[1]))

// Every leaf the logger writes into a strict-mapped index. Kept explicit rather
// than derived: the point is to notice when someone adds a field HERE without
// adding it to the mapping, and a clever extractor would just track the drift.
const EMITTED = {
  'skill index': ['run_id', 'trigger', 'code', 'version', 'config_hash', 'exp',
                  'memory_scope', 'arm', 'instance', 'block', 'pool',
                  'perception', 'bot', 'name', 'role', 'health', 'hunger',
                  'held', 'inventory', 'pos', 'game', 'tick', 'dimension',
                  'day', 'biome', 'skill', 'args', 'status', 'duration_ms',
                  'detail', 'fail_class', 'distance_moved', 'inventory_delta',
                  'board', 'id', 'event', 'claim', 'state', 'reporters',
                  'credit', 'carried_ms', 'distance'],
  'llm index':   ['llm', 'model', 'endpoint', 'prompt_tokens', 'completion_tokens',
                  'latency_ms', 'schema_valid', 'error', 'retry_count',
                  'admission', 'memory', 'cited_rule', 'cited_fails',
                  'cited_reporters', 'inherited', 'prompt', 'system_hash',
                  'text', 'response', 'messages', 'tool_calls', 'outcome'],
}

for (const [label, fields] of Object.entries(EMITTED)) {
  t(`${label}: every emitted field is mapped`, () => {
    const missing = fields.filter(f => !mapped.has(f))
    assert.deepEqual(missing, [],
      `apply-mappings.sh does not map: ${missing.join(', ')}. Under dynamic:strict ` +
      `these do not degrade the record, they REJECT it whole.`)
  })
}

t('the indices really are strict, so this test is load-bearing', () => {
  assert.ok(/\\?"dynamic\\?"\s*:\s*\\?"strict/.test(mapping),
    'if the templates stopped being strict this test could be relaxed -- but ' +
    'silently unmapped fields would then be silently unqueryable instead')
})

t('logger fields referenced here still exist in logger.mjs', () => {
  // Guards the other direction: if a field is renamed in the logger, this test
  // should fail rather than keep asserting a mapping nobody writes to.
  for (const f of ['admission', 'cited_rule', 'carried_ms', 'fail_class']) {
    assert.ok(logger.includes(f), `logger.mjs no longer emits ${f}; update this test`)
  }
})

console.log(`  ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
