// ON THE SHOWCASE VM: replay real bench prompts through the showcase brain path with the RELEASE's OWN client code.
// Design: docs/reports/showcase-2026-10-20.md section 2 (verification before any bot starts).
//
//   cd /srv/showcase/harness && env $(cat env/showcase-Alpha.env | xargs) node /srv/showcase/bin/replay-prompts.mjs \
//       /srv/showcase/ops/feed-last.json /srv/showcase/ops/replay-last.json
//
// For each WHOLE prompt the feed shipped (under the logger's 6000-char cut, carrying its saw_end sentinel): the system
// prompt is rebuilt from this release (buildSystemPrompt over the same skill list the bot uses) and its template hash
// compared with the row's system_hash -- the positive control that the replay sends what the bench sent -- then
// LlmClient.decide() runs against the env's endpoint (127.0.0.1:11612). PASS: >= 48 of 50 schema-valid with the
// matching sentinel and EVERY served model gemma4:26b.
import fs from 'node:fs'
import path from 'node:path'

const harness = process.cwd()
const imp = p => import(path.join(harness, 'src', p))
const { config } = await imp('config.mjs')
const { LlmClient, skillSchema } = await imp('llm.mjs')
const { buildSystemPrompt } = await imp('prompt.mjs')
const { SKILLS } = await imp('skills.mjs')
const { promptTemplateHash } = await imp('logger.mjs')

const [feedPath, outPath] = process.argv.slice(2)
const feed = JSON.parse(fs.readFileSync(feedPath, 'utf8'))
const rows = (feed.prompts || []).slice(0, 50)
const HAS_BOARD = config.memory.scope === 'board' || config.memory.scope === 'checkpoint'
const names = Object.keys(SKILLS).filter(n => !SKILLS[n].chatOnly).filter(n => n !== 'board' || HAS_BOARD)
const system = buildSystemPrompt(names)
const schema = skillSchema(names)
const myHash = promptTemplateHash(system)
const client = new LlmClient({ baseUrls: config.llm.baseUrls, model: config.llm.model, numCtx: config.llm.numCtx,
  maxTokens: config.llm.maxTokens, temperature: config.llm.temperature, timeoutMs: config.llm.timeoutMs })
let valid = 0, hashMatch = 0
const served = {}, lat = []
for (const r of rows) {
  if (r.system_hash === myHash) hashMatch++
  const res = await client.decide({ system, user: r.text, sentinel: r.sentinel, schema })
  if (res.schemaValid) valid++
  served[res.model ?? 'none'] = (served[res.model ?? 'none'] || 0) + 1
  lat.push(res.latencyMs)
}
lat.sort((a, b) => a - b)
const n = rows.length
const pass = n >= 50 && valid >= 48 && Object.keys(served).length === 1 && served['gemma4:26b'] === n
const out = { t: new Date().toISOString().replace(/\.\d+Z$/, 'Z'), release: (process.env.CODE_VERSION || '').slice(0, 40),
  n, valid, served, system_hash: myHash, system_hash_matches: hashMatch, endpoint: config.llm.baseUrls,
  p50_ms: lat[Math.floor(n / 2)] ?? null, p95_ms: lat[Math.floor(n * 0.95)] ?? null, pass }
fs.writeFileSync(outPath, JSON.stringify(out, null, 1) + '\n')
console.log(JSON.stringify(out))
process.exit(pass ? 0 : 1)
