// B5 (cooperation tier): THE ROLE LEASE READER. Unit: leaseFor's binding rules (every refusal reason, each with its positive
// control). Composed, through the REAL CognitiveLoop (mats-chain.test.mjs's harness): a bot at town carrying raw copper gets
// the town smelt job BEFORE the materials job today; with a MAKE lease for it, make_material comes first; a lease for another
// bot, an expired one, one bound to another record generation or another world changes nothing; a lease whose job refuses is
// released (one `_role_released` row) and the chain runs as today -- the smelt job next, never a stall.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
process.env.LOG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-roles-logs-'))
process.env.BOT_NAME = 'RolesBot'
process.env.MEMORY_SCOPE = 'shared'
process.env.MEMORY_POOL = 'roles-chain'
process.env.PLINTH_FIRST = '0'
process.env.LOG_LEVEL = 'error'
process.env.BOT_ROLE = 'gatherer'
process.env.LLM_DECISION_COOLDOWN_MS = '50'
process.env.FAILED_COOLDOWN_MS = '1'
process.env.OLLAMA_MODEL ??= 'qwen2.5:7b-instruct'
process.env.POOL_STATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-roles-pool-'))
process.env.HOME_X = '0'; process.env.HOME_Y = '70'; process.env.HOME_Z = '0'
process.env.ROLES = 'on'
delete process.env.MATS; delete process.env.SMELT_JOB

import assert from 'node:assert/strict'
import test from 'node:test'
import { createRequire } from 'node:module'
const require_ = createRequire(import.meta.url)
const mcData = require_('minecraft-data')('1.21.8')
const { Vec3 } = require_('vec3')

const R = await import('../src/roles.mjs')
const TI = await import('../src/townindex.mjs')
const { Lessons } = await import('../src/lessons.mjs')
const { CognitiveLoop } = await import('../src/cognitive.mjs')
const S = await import('../src/skills.mjs')

const NOW = 1_800_000_000_000
const doc = (leases, over = {}) => ({ v: 1, gen: 7, issued_at: NOW - 60_000, world: 'w1', home: '0_70_0', arm: 'greedy', leases, ...over })
const L = (over = {}) => ({ bot: 'A', job: 'MAKE', expires_at: NOW + 20 * 60_000, project: 'shop', record_gen: 3, segment: null, snapshot_gen: 41, reason: 'parts_short', ...over })
const ask = (d, over = {}) => R.leaseFor({ on: true, doc: d, bot: 'A', world: 'w1', home: '0_70_0', now: NOW, project: { plot: 'shop', gen: 3 }, ...over })

test('leaseFor: a valid lease binds (positive control), and each binding rule refuses with its own reason', () => {
  const ok = ask(doc([L()]))
  assert.equal(ok.why, null); assert.equal(ok.lease.job, 'MAKE'); assert.equal(ok.lease.gen, 7); assert.equal(ok.lease.arm, 'greedy')
  assert.equal(ask(doc([L()]), { on: false }).why, 'off')
  assert.equal(ask(null).why, 'no_file')
  assert.equal(ask(doc([L()]), { maxGen: 8 }).why, 'old_gen')
  assert.equal(ask(doc([L()]), { maxGen: 7 }).why, null, 'the same gen again is fine (re-read)')
  assert.equal(ask(doc([L()], { world: 'w2' })).why, 'world')
  assert.equal(ask(doc([L()], { home: '1_70_0' })).why, 'home')
  assert.equal(ask(doc([L()], { issued_at: NOW + 120_000 })).why, 'future')
  assert.equal(ask(doc([L({ bot: 'B' })])).why, 'none')
  assert.equal(ask(doc([L({ job: 'DEEP_MINER' })])).why, 'job')
  assert.equal(ask(doc([L({ expires_at: NOW })])).why, 'expired')
  assert.equal(ask(doc([L({ expires_at: NOW + 60 * 60_000 })])).why, 'ttl', 'a lease longer than 30 min is not the contract')
  assert.equal(ask(doc([L()]), { project: null }).why, 'no_project')
  assert.equal(ask(doc([L({ project: 'house1' })])).why, 'project')
  assert.equal(ask(doc([L({ record_gen: 2 })])).why, 'record_gen')
  // an unsited project binds with record_gen null on both sides
  assert.equal(ask(doc([L({ record_gen: null })]), { project: { plot: 'shop', gen: null } }).why, null)
  assert.equal(ask(doc([L({ record_gen: null })])).why, 'record_gen', 'a sited project does not take an unsited lease')
  // two leases for one bot: the first in file order (deterministic)
  assert.equal(ask(doc([L({ job: 'BUILD' }), L()])).lease.job, 'BUILD')
})

test('readRoles: missing, unparseable and wrong-shape files are refusals, never throws', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'roles-read-'))
  assert.equal(R.readRoles(d, '0_70_0').why, 'missing')
  fs.writeFileSync(R.rolesFile(d, '0_70_0'), '{"v":1,')
  assert.equal(R.readRoles(d, '0_70_0').why, 'unparseable')
  fs.writeFileSync(R.rolesFile(d, '0_70_0'), JSON.stringify({ v: 2, gen: 1, leases: [] }))
  assert.equal(R.readRoles(d, '0_70_0').why, 'shape')
  fs.writeFileSync(R.rolesFile(d, '0_70_0'), JSON.stringify(doc([L()])))
  assert.equal(R.readRoles(d, '0_70_0').ok, true)
})

test('leasedFirst: a released lease is not tried again for the hold, then is; the skill follows the job', () => {
  const lease = { ...L({ job: 'BUILD' }), gen: 7 }
  assert.equal(R.leasedFirst({ lease, now: NOW }).skill, 'build_shop')
  const rel = { [R.leaseId(lease)]: NOW - 1000 }
  assert.equal(R.leasedFirst({ lease, released: rel, now: NOW }), null)
  assert.equal(R.leasedFirst({ lease, released: rel, now: NOW + R.ROLE_RELEASE_HOLD_MS }).skill, 'build_shop')
  assert.deepEqual(R.pruneReleased(rel, NOW + R.ROLE_RELEASE_HOLD_MS), {})
  assert.equal(R.leasedFirst({ lease: { ...L(), gen: 7 }, now: NOW }).skill, 'make_material')
})

// ---- the composed chain (the real CognitiveLoop) ----------------------------------------------------------------------------
const CHEST = [2, 70, 2], FURNACE = [-2, 70, 3]
const HK = TI.indexHomeKey({ x: 0, y: 70, z: 0 })
const HOME = '0_70_0'
const item = (name, count, slot) => ({ name, count, slot, type: mcData.itemsByName[name].id, stackSize: mcData.itemsByName[name].stackSize })
function seedIndex (names) {
  TI.appendIndex(process.env.POOL_STATE_DIR, HK, null, { t: 'obs', id: `o-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, k: CHEST.join(','), h: [CHEST.join(',')], at: Date.now(), bot: 'Other', by: 'count_town', names, used: 9, size: 27 })
  TI.resetIndexCache()
}
const ldir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcai-roles-l-'))
let lseq = 0
const freshLessons = () => { const Ls = new Lessons(path.join(ldir, `l${lseq++}.json`)); Ls.data.avoid = {}; Ls.data.worked = {}; return Ls }
function chainBot ({ at = new Vec3(1, 70, 0) } = {}) {
  const rows = [['bread', 5], ['torch', 8], ['iron_pickaxe', 1], ['iron_axe', 1], ['iron_shovel', 1], ['coal', 3], ['raw_copper', 6]]
  const items = rows.map(([n, c], i) => item(n, c, 9 + i))
  for (const t of items.filter(i => /_(pickaxe|axe|shovel)$/.test(i.name))) { t.maxDurability = mcData.itemsByName[t.name].maxDurability; t.durabilityUsed = 10 }
  const cells = { [CHEST.join(',')]: 'chest', [FURNACE.join(',')]: 'furnace' }
  const blockAt = p => {
    const k = `${Math.floor(p.x)},${Math.floor(p.y)},${Math.floor(p.z)}`
    const name = cells[k] ?? 'air'
    return { type: mcData.blocksByName[name].id, name, position: new Vec3(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z)), boundingBox: name === 'air' ? 'empty' : 'block',
             getProperties: () => (name === 'furnace' ? { lit: 'false', facing: 'north' } : {}) }
  }
  const match = (m, b) => (typeof m === 'function' ? m(b) : Array.isArray(m) ? m.includes(b.type) : m === b.type)
  const findBlocks = ({ matching, point, maxDistance = 16, count = 1 } = {}) => Object.keys(cells).map(k => blockAt(new Vec3(...k.split(',').map(Number))))
    .filter(b => match(matching, b) && b.position.distanceTo(point ?? at) <= maxDistance).slice(0, count).map(b => b.position)
  return {
    entity: { position: at, velocity: { x: 0, y: 0, z: 0 } }, registry: mcData, controlState: {}, currentWindow: null,
    inventory: { inventoryStart: 9, items: () => items },
    health: 20, food: 20, oxygenLevel: 300, time: { day: 1, age: 1, timeOfDay: 1000 }, game: { dimension: 'overworld' },
    recipesFor: () => [], recipesAll: () => [],
    findBlock: o => { const ps = findBlocks({ ...o, count: 1 }); return ps.length ? blockAt(ps[0]) : null }, findBlocks, blockAt,
    clearControlStates: () => {}, setControlState: () => {}, players: {}, entities: {}, experience: { level: 0 }, username: 'RolesBot',
    pathfinder: { goto: async () => {}, setGoal: () => {} }, removeListener: () => {}, once: () => {}, on: () => {}, _client: {},
  }
}
async function decisions (bot, n, answer = () => ({ status: 'success', detail: 'ok' })) {
  const ran = []
  const runner = { isBusy: () => false, run: async (skill, args) => {
    ran.push({ skill, args })
    const r = answer(skill, args)
    return { delta: {}, contractEvidence: r.status === 'success' ? [`${skill}: probe`] : [], ...r }
  } }
  const loop = new CognitiveLoop(bot, runner, freshLessons(), null)
  loop.llm = { decide: async () => ({ schemaValid: true, latencyMs: 1, proposal: { skill: 'status', args: {}, reason: 'probe' } }) }
  loop.milestones.cycle = 540
  loop.start()
  for (let i = 0; i < 300 && ran.length < n; i++) await new Promise(r => setTimeout(r, 20))
  loop.stop()
  return { ran, loop }
}
const TOWN_FIRST = new Set(['build_well', 'dispose_well', 'close_well', 'town_deposit', 'count_town', 'compost', 'build_composter', 'withdraw_pick', 'wear_out', 'prune_town', 'toolkit'])
const skipTown = skill => (TOWN_FIRST.has(skill) ? { status: 'no_effect', detail: 'skip' } : { status: 'success', detail: 'ok' })
const order = ran => ran.map(r => r.skill).filter(s => !TOWN_FIRST.has(s))
const writeRoles = d => fs.writeFileSync(R.rolesFile(process.env.POOL_STATE_DIR, HOME), JSON.stringify(d))
const clearRoles = () => fs.rmSync(R.rolesFile(process.env.POOL_STATE_DIR, HOME), { force: true })
const activePlot = () => S.shopActive().plot
const lease = (over = {}) => ({ bot: 'RolesBot', job: 'MAKE', expires_at: Date.now() + 20 * 60_000, project: activePlot(), record_gen: null, segment: null, snapshot_gen: 1, reason: 'parts_short', ...over })
const file = (leases, over = {}) => ({ v: 1, gen: 1, issued_at: Date.now() - 1000, world: 'roles-chain', home: HOME, arm: 'test', leases, ...over })
const rowsOf = kind => {
  const out = []
  for (const f of fs.readdirSync(process.env.LOG_DIR, { recursive: true })) {
    if (!/skill-.*\.jsonl$/.test(String(f))) continue
    for (const l of fs.readFileSync(path.join(process.env.LOG_DIR, String(f)), 'utf8').split('\n')) { try { const r = JSON.parse(l); if (r.skill?.name === `_${kind}` || r.skill?.name === kind) out.push(r) } catch { /* torn */ } }
  }
  return out
}

test('CHAIN TODAY (positive control): copper carried at town -> smelt_town BEFORE make_material; no file, no role row', async () => {
  clearRoles()
  seedIndex({ cobblestone: [400, 7], oak_log: [600, 10] })
  const { ran } = await decisions(chainBot(), 6, skipTown)
  const o = order(ran)
  assert.ok(o.includes('smelt_town') && o.includes('make_material'), `both jobs are real competitors here: ${JSON.stringify(o)}`)
  assert.ok(o.indexOf('smelt_town') < o.indexOf('make_material'), JSON.stringify(o))
})

test('CHAIN WITH A MAKE LEASE: make_material comes FIRST (ahead of the smelt job), and a `_role_honoured` row says so', async () => {
  seedIndex({ cobblestone: [400, 7], oak_log: [600, 10] })
  writeRoles(file([lease()]))
  try {
    const before = rowsOf('role_honoured').length
    const { ran } = await decisions(chainBot(), 6, skipTown)
    const o = order(ran)
    assert.equal(o[0], 'make_material', JSON.stringify(o))
    assert.ok(o.includes('smelt_town'), `the smelt job still runs after it: ${JSON.stringify(o)}`)
    assert.ok(rowsOf('role_honoured').length > before, 'the honoured row is written')
  } finally { clearRoles() }
})

test('CHAIN, STALE LEASES CHANGE NOTHING: another bot, expired, another record generation, another world -> smelt first', async () => {
  seedIndex({ cobblestone: [400, 7], oak_log: [600, 10] })
  for (const [why, d] of [['bot', file([lease({ bot: 'Other' })])], ['expired', file([lease({ expires_at: Date.now() - 1 })])],
    ['record_gen', file([lease({ record_gen: 4 })])], ['world', file([lease()], { world: 'elsewhere' })]]) {
    writeRoles(d)
    try {
      const o = order((await decisions(chainBot(), 6, skipTown)).ran)
      assert.ok(o.indexOf('smelt_town') >= 0 && (o.indexOf('make_material') < 0 || o.indexOf('smelt_town') < o.indexOf('make_material')), `${why}: ${JSON.stringify(o)}`)
    } finally { clearRoles() }
  }
})

test('CHAIN, A REFUSED LEASE IS RELEASED, NOT A DEAD END: the job gives no order -> `_role_released`, the smelt job runs next', async () => {
  // the town at its reserve: the materials job has nothing to make (its own refusal), so the lease cannot be performed
  seedIndex({ cobblestone: [256, 4], oak_log: [512, 8] })
  writeRoles(file([lease()]))
  try {
    const before = rowsOf('role_released').length
    const { ran } = await decisions(chainBot(), 4, skipTown)
    const o = order(ran)
    assert.ok(!o.includes('make_material'), JSON.stringify(o))
    assert.equal(o[0], 'smelt_town', `today's next job, in the same decision: ${JSON.stringify(o)}`)
    const rel = rowsOf('role_released')
    assert.ok(rel.length > before, 'the release row is written')
    assert.match(rel.at(-1).skill.detail, /reason=refused/)
    assert.ok(rel.length - before <= 1, `released once, then held (not re-tried every decision): ${rel.length - before}`)
  } finally { clearRoles() }
})

test('CHAIN, AWAY FROM TOWN A LEASE NEVER CAUSES TRAVEL: the same lease at 200 blocks -> no make_material, no smelt', async () => {
  seedIndex({ cobblestone: [400, 7], oak_log: [600, 10] })
  writeRoles(file([lease()]))
  try {
    const { ran } = await decisions(chainBot({ at: new Vec3(200, 70, 0) }), 3)
    assert.ok(!ran.some(r => r.skill === 'make_material' || r.skill === 'smelt_town'), JSON.stringify(ran.map(r => r.skill)))
  } finally { clearRoles() }
})

test('ROLES is OFF unless ROLES=on: unset and any other value read no file (today\'s chain)', async () => {
  const { execFileSync } = await import('node:child_process')
  const probe = v => execFileSync(process.execPath, ['--input-type=module', '-e', "import('./src/roles.mjs').then(m => process.stdout.write(String(m.ROLES.on)))"],
    { cwd: path.resolve(import.meta.dirname, '..'), env: { ...process.env, ROLES: v ?? '' }, encoding: 'utf8' })
  assert.equal(probe(undefined), 'false'); assert.equal(probe('1'), 'false'); assert.equal(probe('true'), 'false'); assert.equal(probe('on'), 'true')
})
