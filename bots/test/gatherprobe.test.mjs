// GATHERPROBE-01 (telemetry only): the barren-round row's detail, its never-throw guarantee against a hostile bot, and the
// structural invariants that keep it telemetry -- one guarded call site, capped per run, and nothing reads its output.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
process.env.OLLAMA_MODEL ??= 'qwen2.5:7b-instruct'
process.env.LOG_DIR = process.env.LOG_DIR || '/tmp/mcbot-test-logs-gatherprobe'
process.env.BOT_NAME = process.env.BOT_NAME || 'GatherProbeBot'
const SKM = await import('../src/skills.mjs')

let pass = 0, fail = 0
const t = (name, fn) => { try { fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) } }
const V = (x, y, z) => ({ x, y, z, distanceTo (o) { return Math.hypot(this.x - o.x, this.y - o.y, this.z - o.z) } })

t('DETAIL: states still_there / broken / now_X / unloaded, drops nearest first with dy, capped at 300 chars', () => {
  const base = { block: 'dirt', at: V(-41, 68, -76), botPos: V(-40.7, 67, -76.4), ms: 812, round: 2 }
  assert.match(SKM.gatherProbeDetail({ ...base, after: 'dirt' }), /after=still_there drops=0:- bot=-41,67,-77 ms=812 below=0$/)
  assert.match(SKM.gatherProbeDetail({ ...base, after: 'air', drops: [{ name: 'dirt', dy: 1, dist: 3.7 }], fromBelow: true }),
    /after=broken drops=1:dirt@dy1\.0\/d3\.7 .* below=1/)
  assert.match(SKM.gatherProbeDetail({ ...base, after: 'grass_block' }), /after=now_grass_block/)
  assert.match(SKM.gatherProbeDetail({ ...base, after: null, err: 'Took to long to decide path to goal!' }), /after=unloaded .* err=Took_to_long_to_decide_path_to_goal!/)
  const long = SKM.gatherProbeDetail({ ...base, block: 'x'.repeat(400), round: '9'.repeat(400), after: 'air' })
  assert.ok(long.length <= 300, `length ${long.length}`)
  assert.doesNotThrow(() => SKM.gatherProbeDetail({}))
})

t('BOUNDED: a pile of 5,000 drops is scanned to the cap and only the 3 nearest are named', () => {
  const ents = {}
  let touched = 0
  for (let i = 0; i < 5000; i++) Object.defineProperty(ents, i, { enumerable: true, get () { touched++; return { name: 'item', position: V(0, 1, (i % 50) / 10), getDroppedItem: () => ({ name: 'dirt' }) } } })
  const bot = { entity: { position: V(0, 0, 0) }, entities: ents, blockAt: () => ({ name: 'air' }) }
  const t0 = Date.now()
  const out = SKM.gatherBarrenProbe(bot, { target: { position: V(0, 0, 0) }, blockName: 'dirt', ms: 5, round: 1 })
  assert.ok(Date.now() - t0 < 500, 'slow')
  assert.ok(touched <= 2048, `scanned ${touched} entities`)
  assert.match(out, /drops=2048:/)
  assert.equal((out.match(/dirt@dy/g) ?? []).length, 3, out)
  const d = SKM.gatherProbeDetail({ block: 'dirt', at: V(0, 0, 0), after: 'air', botPos: V(0, 0, 0), drops: Object.assign([{ name: 'dirt', dy: 1, dist: 1 }], { total: 2048 }), ms: 1 })
  assert.match(d, /drops=2048:dirt@dy1\.0\/d1\.0 /)
})

t('NEVER THROWS: a hostile bot (throwing getters, broken entities, no blockAt) is swallowed', () => {
  const hostile = { get entity () { throw new Error('boom') }, entities: { 1: { name: 'item', position: { y: 1 } }, 2: null, get 3 () { throw new Error('x') } } }
  assert.doesNotThrow(() => SKM.gatherBarrenProbe(hostile, { target: { position: V(0, 0, 0) }, blockName: 'dirt', ms: 1, round: 1 }))
  assert.doesNotThrow(() => SKM.gatherBarrenProbe(null, {}))
  assert.doesNotThrow(() => SKM.gatherBarrenProbe(undefined, undefined))
})

const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
const SK = strip(readFileSync(new URL('../src/skills.mjs', import.meta.url), 'utf8'))
t('TELEMETRY ONLY: one call site, capped per run, its result unused; the probe vars are only written and passed to it', () => {
  const calls = SK.match(/gatherBarrenProbe\(/g) ?? []
  assert.equal(calls.length, 1, 'exactly one call site')
  assert.match(SK, /\n\s+if \(\+\+probeRows <= GATHER_PROBE_MAX\) gatherBarrenProbe\([^\n]*\)\n/, 'the call is a bare statement: its return value is discarded')
  assert.match(SK, /\n\s+if \(\+\+probeRows <= GATHER_PROBE_MAX\) gatherBarrenProbe\(bot, \{ target, blockName, ms: Date\.now\(\) - probeT0, err: probeErr, fromBelow: probeBelow, round: barren \}\)\n/)
  assert.match(SK, /probeBelow = tdGap != null\n\s+if \(mustCollectManually\(target\.name\)\)/, 'set before the manual/collectBlock split')
  assert.match(SK, /try \{ probeErr = String\(e\?\.message \?\? e\)\.slice\(0, 40\) \} catch \{ probeErr = '\?' \}/)
  for (const v of ['probeErr', 'probeBelow', 'probeT0', 'probeRows']) {
    const reads = (SK.match(new RegExp(`\\b${v}\\b`, 'g')) ?? []).length
    const writes = (SK.match(new RegExp(`\\b${v} = `, 'g')) ?? []).length
    assert.ok(reads - writes <= 2, `${v} is read somewhere other than the probe call (${reads} uses, ${writes} writes)`)
    assert.doesNotMatch(SK, new RegExp(`if \\(!?${v}\\b`), `${v} steers a branch`)
  }
  assert.match(SK, /export function gatherBarrenProbe \(bot, args\) \{\n\s+try \{\n\s+const \{ target, blockName, ms, err, fromBelow, round \} = args \?\? \{\}/)
})

console.log(`\ngatherprobe: ${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
