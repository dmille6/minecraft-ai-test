// COALFIRST-01, part 2 (MINE): the coal tunnel kinds and the coal run's cognitive slot -- protected scope (tier 3).
process.env.LOG_DIR = process.env.LOG_DIR || '/tmp/mcbot-test-logs-coalrun'
process.env.BOT_NAME = process.env.BOT_NAME || 'CoalBot'
process.env.LOG_LEVEL = 'error'
process.env.OLLAMA_MODEL ??= 'qwen2.5:7b-instruct'
process.env.POOL_STATE_DIR = (await import('node:fs')).mkdtempSync((await import('node:path')).join((await import('node:os')).tmpdir(), 'coal-pool-'))
process.env.HOME_X = '0'; process.env.HOME_Y = '70'; process.env.HOME_Z = '0'

import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const C = await import('../src/coalrun.mjs')
const TD = await import('../src/towndeposit.mjs')
const OT = await import('../src/oretunnel.mjs')
const { NEVER_KEEP, neverPickUp } = await import('../src/hygiene.mjs')
const { NEVER_BANKABLE, STANDING_TARGETS } = await import('../src/bankable.mjs')
const { isWellJunk } = await import('../src/well.mjs')
const { allowanceRow } = await import('../src/bagallowance.mjs')
const { skipFoodDrop } = await import('../src/foodskip.mjs')
const { SMELT_JOB_FUEL, JOB_FUELS } = await import('../src/smeltjob.mjs')

const drop = name => ({ name: 'item', getDroppedItem: () => ({ name }) })
let slot = 9
const it = (name, count) => ({ name, count, slot: slot++ })
const sum = (list, n) => list.filter(x => x.name === n).reduce((t, x) => t + x.count, 0)

// ---- 2. MINE -----------------------------------------------------------------------------------------------------------
test('TUNNEL KINDS: iron and coal tunnel (one planner); coal only while COALFIRST is on; stone never', () => {
  assert.deepEqual(OT.tunnelKindsFor('iron_ore'), { kinds: OT.IRON_KINDS, label: 'iron' })
  assert.deepEqual(OT.tunnelKindsFor('deepslate_iron_ore'), { kinds: OT.IRON_KINDS, label: 'iron' })
  assert.deepEqual(OT.tunnelKindsFor('coal_ore'), { kinds: C.COAL_KINDS, label: 'coal' })
  assert.deepEqual(OT.tunnelKindsFor('deepslate_coal_ore'), { kinds: C.COAL_KINDS, label: 'coal' })
  assert.equal(OT.tunnelKindsFor('coal_ore', { coal: false }), null, 'COALFIRST=off: the base (iron only)')
  assert.deepEqual(OT.tunnelKindsFor('iron_ore', { coal: false }).label, 'iron')
  for (const n of ['stone', 'coal', 'copper_ore', undefined]) assert.equal(OT.tunnelKindsFor(n), null, String(n))
  assert.equal(C.COAL_ORE_RADIUS, OT.CANDIDATE_RADIUS, 'the run looks exactly as far as the tunnel searches')
  // the cluster flood fill follows the kind it is given
  const V = (x, y, z) => ({ x, y, z, offset (a, b, c) { return V(x + a, y + b, z + c) } })
  const ore = new Set(['0,0,0', '1,0,0', '2,0,0'])
  const at = name => p => ({ name: ore.has(`${p.x},${p.y},${p.z}`) ? name : 'stone' })
  assert.equal(OT.clusterOf(at('coal_ore'), V(0, 0, 0), C.COAL_KINDS).length, 3)
  assert.equal(OT.clusterOf(at('coal_ore'), V(0, 0, 0)).length, 0, 'positive control: the iron default does not count coal')
})

// ---- the wiring the behaviour above cannot reach -----------------------------------------------------------------------
const strip = src => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
test('WIRING: cognitive issues the coal run after the workshop and before planting, records its outcome, refunds a decline', async () => {
  const src = strip(readFileSync(new URL('../src/cognitive.mjs', import.meta.url), 'utf8'))
  const run = src.indexOf('const r = coalRunOrder({')
  assert.ok(run > 0 && src.indexOf('const r = coalRunOrder({', run + 1) < 0, 'one coal-run slot')
  assert.ok(src.indexOf('const r = buildOrder({') < run, 'after the workshop')
  assert.ok(run < src.indexOf('const sap = {}'), 'before planting')
  assert.ok(src.includes('coalRunOutcome(r.status, coalNow, Date.now(), this.coalRunState ?? {}, { declined })'), 'the outcome is recorded')
  const { refundDeclined } = await import('../src/cognitive.mjs')
  assert.deepEqual(refundDeclined('gather', { coalRunState: { lastIssuedAt: 5, pending: true } }), { coalRunState: { lastIssuedAt: -Infinity, pending: false } })
  assert.deepEqual(refundDeclined('gather', { coalRunState: { lastIssuedAt: 5, pending: false } }), {}, 'a model gather refunds nothing')
  const sk = strip(readFileSync(new URL('../src/skills.mjs', import.meta.url), 'utf8'))
  assert.ok(sk.includes('const tk = tunnelKindsFor(viaSource ?? blockName)'), 'gather asks the tunnel kinds')
  assert.ok(sk.includes('kinds: tk.kinds, label: tk.label })'), 'and passes them to the tunnel')
  assert.ok(sk.includes('const cluster = clusterOf(at, plan.target, kinds)'), 'the cluster follows the kind')
})

// ---- mutants: each guarded change, reverted, fails its behaviour (anchors asserted present and unique) -----------------
const { writeFileSync, unlinkSync } = await import('node:fs')
async function withMutant (rel, old, neu, fn) {
  const path = new URL(`../src/${rel}`, import.meta.url)
  const src = readFileSync(path, 'utf8')
  assert.equal(src.split(old).length, 2, `ANCHOR MISSING OR NOT UNIQUE: ${JSON.stringify(old.slice(0, 60))}`)
  const out = new URL(`./_mutant-coal-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, src.replace(old, neu).replace(/from '\.\//g, "from '../src/"))
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}
test('MUTANT KILLED: without the coal kind, coal_ore does not tunnel', async () => {
  assert.deepEqual(OT.tunnelKindsFor('coal_ore')?.label, 'coal', 'the real module tunnels coal')
  await withMutant('oretunnel.mjs', "if (coal && COAL_KINDS.includes(name)) return { kinds: COAL_KINDS, label: 'coal' }", '', async M => assert.equal(M.tunnelKindsFor('coal_ore'), null))
})
