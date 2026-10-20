// ISOLATED -> SHARED TOWNS (scripts/host/isolated2shared.mjs; docs/reports/isolated-to-shared-2026-10-20.md).
//
// The conversion is an env change plus a one-time seed of the town's state dir. These tests hold it to BEHAVIOUR:
//   * the seeded dir is read back through the bots' OWN readers (plinth.mjs, composter.mjs, chestfull.mjs, withdrawpick.mjs,
//     worldfacts.mjs), and the composed plinth decision on it is "complete" -- no second plinth;
//   * the env change does, in a real bot process, what the design table says (world model pooled, lessons per bot, smelt job
//     on, town records shared, the system prompt byte-identical to isolated's);
//   * plan writes nothing; apply backs up first, is idempotent and resumable; rollback restores only the three lines;
//   * refusals refuse, and anchored mutants show each test can fail for the reason it names.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
process.env.OLLAMA_MODEL ??= 'qwen2.5:7b-instruct'
const M = await import('../../scripts/host/isolated2shared.mjs')
const P = await import('../src/plinth.mjs')
const { readTownSite } = await import('../src/composter.mjs')
const { readTownMemory, containerStatus, containerPickMiss, PICK_MISS_KEY } = await import('../src/chestfull.mjs')
const { containerIngredientMiss, INGREDIENT_MISS_KEY } = await import('../src/withdrawpick.mjs')
const { WorldFacts } = await import('../src/worldfacts.mjs')

const here = path.dirname(fileURLToPath(import.meta.url))
const TOOL = path.join(here, '../../scripts/host/isolated2shared.mjs')
let pass = 0, fail = 0
const ta = async (name, fn) => { try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 3).join('\n        ')}`) } }

const POOL = 'isolated-b', BOTS = ['Alpha', 'Bravo', 'Comet', 'Delta', 'Echo'].map(n => `${POOL}-${n}`)
const H = '355_73_147', WORLD = '-1909043226:-504800724', CAP = { x: 357, y: 74, z: 160 }
const NOW = Date.UTC(2026, 9, 20, 12, 0, 0)
const plinthRec = (state, doneAt, extra = {}) => ({ v: 1, id: 'p1', state, world: WORLD, at: doneAt - 1000, by: 'x', left: 0, stuck: 0, prev: null,
  plan: { cap: { ...CAP }, k: 4, steps: [{ x: 357, y: 72, z: 160 }] }, ...(state === 'complete' ? { doneAt, doneBy: 'x' } : {}), ...extra })
const envText = (bot, over = {}) => Object.entries({
  BOT_ROLE: 'gatherer', MINECRAFT_HOST: '10.0.0.30', CODE_VERSION: '9e7d998003aeead7a2763958f1147f76e3b4a3f3', BOT_NAME: bot,
  MEMORY_SCOPE: 'isolated', MEMORY_POOL: `self-${bot}`, EXP_ARM: 'isolated', MINECRAFT_PORT: '25575', HOME_X: '355', HOME_Y: '73', HOME_Z: '147',
  RUN_ID: 'cobblekeep-01-promote', LOG_DIR: `/var/log/mcai/${bot}`, STATE_DIR: null, ...over,
}).map(([k, v]) => `${k}=${v}`).join('\n') + '\n'

/** A miniature /var/lib/mcai + env dir shaped like the host's (10-20 12:15Z): isolated-b's records as they are there. */
function fixture ({ caps = null, noComplete = false, envOver = {}, canary = null } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i2s-'))
  const o = { stateRoot: path.join(root, 'lib'), envDir: path.join(root, 'env'), manifest: path.join(root, 'manifest.json'),
    dropinRoot: path.join(root, 'systemd'), backupRoot: path.join(root, 'backups'), unitCheck: false, lock: null, now: NOW, stamp: '20261020T120000Z' }
  for (const d of [o.stateRoot, o.envDir, o.dropinRoot]) fs.mkdirSync(d, { recursive: true })
  fs.writeFileSync(o.manifest, JSON.stringify({ run_id: 'x', canary_pool: canary }))
  BOTS.forEach((bot, i) => {
    const sd = path.join(o.stateRoot, bot), pd = path.join(o.stateRoot, `_pool-self-${bot}`)
    fs.mkdirSync(sd, { recursive: true }); fs.mkdirSync(path.join(pd, 'furnace-leases'), { recursive: true })
    fs.writeFileSync(path.join(o.envDir, `${bot}.env`), envText(bot, { STATE_DIR: sd, ...(envOver[bot] ?? {}) }))
    // plinth: Alpha/Bravo/Comet complete (Comet newest), Delta/Echo none -- as isolated-b on the host
    if (i < 3) {
      const rec = plinthRec(noComplete ? 'plan' : 'complete', NOW - 70 * 3600e3 + i * 1000)
      if (caps?.[i]) rec.plan.cap = caps[i]
      fs.writeFileSync(path.join(pd, `junkwell-plinth-${H}.json`), JSON.stringify(rec))
      fs.writeFileSync(path.join(pd, `junkwell-site-${H}.g1.json`), JSON.stringify({ ...CAP, world: WORLD, at: '2026-10-17T13:35:31.395Z' }))
      fs.writeFileSync(path.join(pd, `junkwell-plinth-${H}.lease.g3.json`), JSON.stringify({ by: bot, until: NOW - 60e6 }))
    } else {
      // a no-site record NEWER than every doneAt (as isolated-a's Comet holds): copied, it would replan the finished plinth
      fs.writeFileSync(path.join(pd, `junkwell-nosite-${H}.json`), JSON.stringify({ at: NOW - 3600e3, world: WORLD, by: bot, tally: 'cols:672' }))
    }
    if (i === 2) fs.writeFileSync(path.join(pd, `composter-site-${H}.g1.json`), JSON.stringify({ x: 351, y: 72, z: 144, world: WORLD, at: '2026-10-04T18:52:40.417Z' }))
    fs.writeFileSync(path.join(pd, `town-chest-${H}.cobble.jsonl`), `\n{"t":"cnt","k":"355,72,147","n":64,"bot":"${bot}"}\n`)
    const entries = {
      '355,72,147': { o: i === 0 ? 'full' : 'took', at: NOW - (10 - i) * 60e3, strikes: [] },
      [`36${i},72,150`]: { o: 'took', at: NOW - 3 * 3600e3, strikes: [] },
      [PICK_MISS_KEY]: { '355,72,147': NOW - (30 - i) * 60e3 },
      [INGREDIENT_MISS_KEY]: { '356,72,147': { stick: NOW - (20 + i) * 60e3, ...(i === 4 ? { planks: NOW - 5 * 60e3 } : {}) } },
    }
    fs.writeFileSync(path.join(pd, `town-chest-${H}.containers.json`), JSON.stringify({ world: WORLD, entries }))
    fs.writeFileSync(path.join(sd, `lessons-${bot}.json`), JSON.stringify({ avoid: {}, worked: {} }))
    fs.writeFileSync(path.join(sd, `world-facts-${bot}.json`), JSON.stringify({ schema: 1,
      sites: [{ kind: 'entombed', x: 330 + i, y: 50, z: 170, count: 2, last: NOW - 3600e3, by: [bot] },
              { kind: 'death:fall', x: 340, y: 60, z: 150, count: 4, deaths: 1, last: NOW - 2 * 3600e3, by: [bot] },
              { kind: 'drowning', x: 300, y: 60, z: 100, count: 1, last: NOW - 30 * 3600e3, by: [bot] }],      // decays to 0: gone
      unreachable: { travel_150_0: { by: [bot], last: NOW - (i + 1) * 3600e3, detail: `d${i}`, where: { [bot]: { x: i, y: 70, z: 0 } } },
                     old_goal: { by: [bot], last: NOW - 30 * 3600e3, detail: 'expired', where: {} } },
      resources: [{ kind: 'iron_ore', x: 400 + i * 30, y: 40, z: 100, count: 3, last: NOW - i * 60e3, by: [bot] }] }))
  })
  return o
}
const treeHash = dir => {
  const h = crypto.createHash('sha256')
  const walk = d => { for (const f of fs.readdirSync(d).sort()) { const p = path.join(d, f); const st = fs.statSync(p); h.update(p); if (st.isDirectory()) walk(p); else h.update(fs.readFileSync(p)) } }
  walk(dir); return h.digest('hex')
}
const root = o => path.dirname(o.stateRoot)
const quiet = []
const say = l => quiet.push(l)
const run = (o, ...argv) => M.main(argv, o, say)
const town = o => path.join(o.stateRoot, `_pool-${POOL}`)
const env = (o, bot) => M.parseEnv(fs.readFileSync(path.join(o.envDir, `${bot}.env`), 'utf8'))

/** withMutant (bots/test/climb-escape.test.mjs): the anchor must be present AND unique, or the mutant reads as killed. */
async function withMutant (file, old, neu, fn) {
  const src = fs.readFileSync(file, 'utf8')
  assert.ok(src.includes(old), `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 70))} is not in ${file}`)
  assert.equal(src.split(old).length, 2, 'the mutation target is not unique; the mutant is ambiguous')
  const out = path.join(here, `_mutant-i2s-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`)
  fs.writeFileSync(out, src.replace(old, neu))
  try { return await fn(await import(out)) } finally { try { fs.unlinkSync(out) } catch {} }
}

// ---- constants and rules agree with the bots' own code (behaviour, not text) ---------------------------------------------
await ta('PLINTH_VERSION and recordState agree with plinth.mjs on every record shape', () => {
  assert.equal(M.PLINTH_VERSION, P.PLINTH_VERSION)
  for (const r of [plinthRec('complete', NOW), plinthRec('plan', NOW), { v: 1, state: 'none', at: 1 }, { v: 1, state: 'void' }, { v: 2, state: 'complete' }, null, { v: 1, state: 'complete', plan: { cap: CAP } }]) {
    assert.equal(M.recordState(r), P.plinthRecordState(r, WORLD), JSON.stringify(r))
  }
})
await ta('decay, MAX_SITES and MAX_RESOURCES match what the real WorldFacts class does on its next write', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'i2s-wf-')), file = path.join(dir, 'wf.json')
  const now = Date.now()
  const sites = Array.from({ length: 130 }, (_, i) => ({ kind: 'entombed', x: i * 20, y: 50, z: 0, count: 8, last: now - 25 * 3600e3 + i, by: ['a'] }))
  const resources = Array.from({ length: 210 }, (_, i) => ({ kind: 'coal_ore', x: i * 50, y: 40, z: 0, count: 2, last: now - i, by: ['a'] }))
  fs.writeFileSync(file, JSON.stringify({ schema: M.WF_SCHEMA, sites, unreachable: {}, resources }))
  const wf = new WorldFacts(file)
  wf.reportResource('gold_ore', { x: 99999, y: 1, z: 99999 }, 'b')      // any write runs #prune
  const after = JSON.parse(fs.readFileSync(file, 'utf8'))
  assert.equal(after.sites.length, M.MAX_SITES)
  assert.equal(after.resources.length, M.MAX_RESOURCES)
  assert.equal(after.sites[0].count, M.decayed(sites[10], now).count, 'two 12-h periods: 8 -> 2, as decayed() says')
  assert.equal(M.decayed(sites[10], now).count, 2)
})

// ---- pure merge rules ------------------------------------------------------------------------------------------------------
await ta('foldContainer: an opening clears strikes; unknowns from two bots are the town\'s strikes; newest wins', () => {
  const t = NOW
  assert.deepEqual(M.foldContainer([{ o: 'unknown', at: t - 9, strikes: [t - 9], unusableUntil: t + 5 }, { o: 'took', at: t - 1, strikes: [] }]), { o: 'took', at: t - 1, strikes: [] })
  const u = M.foldContainer([{ o: 'unknown', at: t - 20 * 60e3, strikes: [t - 20 * 60e3] }, { o: 'unknown', at: t - 60e3, strikes: [t - 60e3], unusableUntil: t + 3600e3 }])
  assert.deepEqual(u.strikes, [t - 20 * 60e3, t - 60e3]); assert.equal(containerStatus(u, t), 'unusable')
  assert.equal(M.foldContainer([{ o: 'took', at: t - 5, strikes: [] }, { o: 'full', at: t - 1, strikes: [] }]).o, 'full')
})
await ta('foldContainer re-derives unusable: two bots\' unknowns 700 s apart -> unusable (Codex r2); none kept from before a later opening (Claude r2)', () => {
  const t = NOW
  const two = M.foldContainer([{ o: 'unknown', at: t - 700e3, strikes: [t - 700e3] }, { o: 'unknown', at: t, strikes: [t] }])
  assert.equal(containerStatus(two, t), 'unusable', 'one shared file would have marked it unusable')
  const t0 = t - 3600e3, t1 = t - 1800e3, t2 = t - 60e3
  const f = M.foldContainer([{ o: 'took', at: t1, strikes: [] }, { o: 'unknown', at: t2, strikes: [t0, t2], unusableUntil: t2 + 6 * 3600e3 }])
  assert.deepEqual(f.strikes, [t2], 'the strike before A\'s took is gone'); assert.equal(containerStatus(f, t), 'backoff', 'not unusable')
})
await ta('foldContainer equals recordOutcome over the merged history whenever the snapshots hide no opening (randomized, 400 cases)', async () => {
  const { recordOutcome } = await import('../src/chestfull.mjs')
  let seed = 7; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648
  let compared = 0
  for (let c = 0; c < 400; c++) {
    let t = NOW - 5 * 3600e3; const ev = []
    for (let i = 0; i < 2 + Math.floor(rnd() * 6); i++) { t += Math.floor(rnd() * 25 * 60e3) + 1; ev.push({ t, bot: Math.floor(rnd() * 3), o: rnd() < 0.3 ? 'took' : 'unknown' }) }
    const per = [{}, {}, {}]
    for (const e of ev) per[e.bot].s = recordOutcome(per[e.bot].s, e.o, e.t)
    let truth; for (const e of ev) truth = recordOutcome(truth, e.o, e.t)
    // hidden opening: a bot whose own opening was overwritten by its later unknown -- not replayable from snapshots
    const hidden = per.some((p, b) => p.s && p.s.o === 'unknown' && ev.some(e => e.bot === b && e.o === 'took'))
    if (hidden) continue
    compared++
    const got = M.foldContainer(per.map(p => p.s).filter(Boolean))
    assert.equal(containerStatus(got, t), containerStatus(truth, t), `case ${c}: ${JSON.stringify(ev)}`)
    assert.deepEqual(got.strikes, truth.strikes, `case ${c} strikes`)
  }
  assert.ok(compared >= 100, `only ${compared} comparable cases: the generator is not testing anything`)
})
await ta('mergeContainers: the readers see the town state (pick miss cleared by a later took; ingredient misses per need)', () => {
  const m = M.mergeContainers([
    { bot: 'A', json: { world: WORLD, entries: { k1: { o: 'full', at: 100, strikes: [] }, [PICK_MISS_KEY]: { k1: 50, k2: NOW - 60e3 }, [INGREDIENT_MISS_KEY]: { k3: { stick: NOW - 120e3 } } } } },
    { bot: 'B', json: { world: WORLD, entries: { k1: { o: 'took', at: 200, strikes: [] }, k2: { o: 'full', at: 10, strikes: [] }, [PICK_MISS_KEY]: { k2: NOW - 30e3 }, [INGREDIENT_MISS_KEY]: { k3: { planks: NOW - 60e3, stick: NOW - 300e3 } } } } }])
  assert.ok(m.ok); const e = m.entries
  assert.equal(e.k1.o, 'took'); assert.equal(e[PICK_MISS_KEY].k2, NOW - 30e3, 'newest miss per container')
  assert.equal(e[INGREDIENT_MISS_KEY].k3.stick, NOW - 120e3); assert.equal(e[INGREDIENT_MISS_KEY].k3.planks, NOW - 60e3, 'per (container, need) leaf')
  assert.equal(containerPickMiss(e, 'k2', NOW), true); assert.equal(containerIngredientMiss(e, 'k3', 'planks', NOW), true)
  assert.equal(M.mergeContainers([{ bot: 'A', json: { world: 'w1', entries: {} } }, { bot: 'B', json: { world: 'w2', entries: {} } }]).ok, false, 'two worlds refuse')
})
await ta('mergeWorldFacts: a union on each entry\'s own clock (no summed count), decayed and expired as the class would', () => {
  const o = fixture()
  const files = BOTS.map(b => ({ bot: b, json: JSON.parse(fs.readFileSync(path.join(o.stateRoot, b, `world-facts-${b}.json`), 'utf8')) }))
  const { json } = M.mergeWorldFacts(files, NOW)
  assert.equal(json.sites.filter(s => s.kind === 'death:fall').length, 5, 'five deaths at one place stay five entries, each count 4 (no sum)')
  assert.ok(json.sites.every(s => s.count <= 4)); assert.equal(json.sites.filter(s => s.kind === 'drowning').length, 0, '30 h old count 1 decayed to 0')
  assert.deepEqual(Object.keys(json.unreachable), ['travel_150_0'], 'expired unreachable dropped')
  assert.equal(json.unreachable.travel_150_0.by.length, 5); assert.equal(json.unreachable.travel_150_0.detail, 'd0', 'the first reporter\'s detail')
  assert.equal(json.unreachable.travel_150_0.last, NOW - 3600e3)
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'i2s-wf2-')); fs.writeFileSync(path.join(dir, 'f.json'), JSON.stringify(json))
  assert.equal(new WorldFacts(path.join(dir, 'f.json')).deathSites(NOW).length, 5, 'the class reads the merged death sites (the pathfinder prices them)')
})
await ta('choosePlinth: newest complete wins; caps that disagree refuse with a remedy; plan-only refuses; override works', () => {
  const e = [{ bot: 'A', rec: plinthRec('complete', 10), text: 'a' }, { bot: 'B', rec: plinthRec('complete', 30), text: 'b' }, { bot: 'C', rec: plinthRec('plan', 20), text: 'c' }]
  const r = M.choosePlinth(e); assert.ok(r.ok); assert.equal(r.bot, 'B'); assert.deepEqual(r.cap, CAP)
  const two = M.choosePlinth([...e, { bot: 'D', rec: { ...plinthRec('plan', 5), plan: { cap: { x: 1, y: 2, z: 3 }, steps: [] } } }])
  assert.equal(two.ok, false); assert.match(two.remedy, /--plinth-from/)
  assert.equal(M.choosePlinth([{ bot: 'C', rec: plinthRec('plan', 1) }]).ok, false)
  assert.equal(M.choosePlinth(e, { from: 'A' }).bot, 'A'); assert.equal(M.choosePlinth(e, { from: 'none' }).rec, null)
  assert.equal(M.choosePlinth([{ bot: 'X', rec: null }]).ok, true, 'no record anywhere: the town plans its own')
})
await ta('rewriteEnv changes exactly the three lines and refuses a duplicated key', () => {
  const t = envText('isolated-b-Alpha', { STATE_DIR: '/x' })
  const r = M.rewriteEnv(t, M.NEW_VALUES(POOL))
  const a = t.split('\n'), b = r.text.split('\n')
  assert.equal(a.length, b.length); assert.equal(a.filter((l, i) => l !== b[i]).length, 3)
  assert.deepEqual(r.changed.sort(), ['EXP_ARM', 'MEMORY_POOL', 'MEMORY_SCOPE'])
  assert.throws(() => M.rewriteEnv(t + 'MEMORY_POOL=again\n', M.NEW_VALUES(POOL)), /exactly once/)
})

// ---- the tool end to end ---------------------------------------------------------------------------------------------------
await ta('plan writes NOTHING (whole tree hashed before and after)', () => {
  const o = fixture(), h = treeHash(root(o))
  assert.equal(run(o, 'plan', '--pool', POOL), 0)
  assert.equal(treeHash(root(o)), h)
})
await ta('apply: backups first, seeded town dir, three env lines per bot, old per-bot dirs untouched', () => {
  const o = fixture()
  const oldDirs = BOTS.map(b => treeHash(path.join(o.stateRoot, `_pool-self-${b}`)))
  assert.equal(run(o, 'apply', '--pool', POOL), 0, quiet.join('\n'))
  const bdir = path.join(o.backupRoot, `${o.stamp}-${POOL}`)
  for (const b of BOTS) {
    assert.ok(fs.existsSync(path.join(bdir, `${b}.env`))); assert.ok(fs.existsSync(path.join(bdir, 'pool-dirs', `_pool-self-${b}`, `town-chest-${H}.containers.json`)))
    assert.ok(fs.existsSync(path.join(bdir, 'world-facts', `world-facts-${b}.json`)))
    const e = env(o, b); assert.equal(e.MEMORY_SCOPE, 'private'); assert.equal(e.MEMORY_POOL, POOL); assert.equal(e.EXP_ARM, 'town')
    assert.equal(e.CODE_VERSION, '9e7d998003aeead7a2763958f1147f76e3b4a3f3')
  }
  assert.deepEqual(BOTS.map(b => treeHash(path.join(o.stateRoot, `_pool-self-${b}`))), oldDirs, 'per-bot dirs are the rollback: untouched')
  const files = fs.readdirSync(town(o)).sort()
  assert.deepEqual(files, [M.MARKER, `composter-site-${H}.g1.json`, `junkwell-plinth-${H}.json`, `junkwell-site-${H}.g1.json`, `town-chest-${H}.containers.json`, `world-facts-${POOL}.json`].sort())
  assert.ok(!files.some(f => f.includes('nosite') || f.includes('cobble') || f.includes('lease')), 'no no-site record, no journal, no lease')
  assert.equal(fs.readdirSync(o.stateRoot).filter(f => f.startsWith('_pool-') && !f.startsWith('_pool-self-')).length, 1, 'no stray _pool-* dir (tmp lives under _isolated2shared)')
})
await ta('THE COMPOSED CHAIN on the seeded dir: the bots\' readers see one well, and plinthWant answers complete (no second plinth)', () => {
  const o = fixture(); run(o, 'apply', '--pool', POOL)
  const d = town(o)
  const rec = JSON.parse(fs.readFileSync(path.join(d, `junkwell-plinth-${H}.json`), 'utf8'))
  assert.equal(P.plinthRecordState(rec, WORLD), 'complete')
  const site = readTownSite(d, `junkwell-site-${H}`); assert.equal(site.gen, 1); assert.deepEqual(site.site, CAP); assert.equal(site.world, WORLD)
  assert.deepEqual(readTownSite(d, `composter-site-${H}`).site, { x: 351, y: 72, z: 144 })
  const mem = readTownMemory(d, `town-chest-${H}`, WORLD); assert.equal(mem['355,72,147'].o, 'took', 'Echo\'s newer took over Alpha\'s full')
  const e = env(o, 'isolated-b-Alpha'), id = { scope: e.MEMORY_SCOPE, pool: e.MEMORY_POOL, name: 'isolated-b-Alpha' }
  assert.equal(P.townRecordsShared(id), true)
  let noSite = null; try { noSite = JSON.parse(fs.readFileSync(path.join(d, `junkwell-nosite-${H}.json`), 'utf8')) } catch { /* none seeded */ }
  const want = P.plinthWant({ wellUsable: false, rec, noSite, world: WORLD, now: NOW, shared: true, first: P.plinthFirstPolicy({ ...id, env: {} }), naturalPit: false, loaded: true })
  assert.deepEqual(want, { want: null, why: 'complete' })
  // positive control: the SAME decision with one of the sources' newer no-site records does replan -- so the test can see it
  const src = JSON.parse(fs.readFileSync(path.join(o.stateRoot, '_pool-self-isolated-b-Delta', `junkwell-nosite-${H}.json`), 'utf8'))
  assert.equal(P.plinthWant({ wellUsable: false, rec, noSite: src, world: WORLD, now: NOW, shared: true, first: true, naturalPit: false, loaded: true }).want, 'plan')
})
await ta('MUTANT KILLED: copying the no-site records seeds a town that replans its finished plinth', async () => {
  await withMutant(TOOL, "    if (ns.length) summary.push(",
    "    for (const b of src.bots) if (b.nosite) files[`junkwell-nosite-${H}.json`] = fs.readFileSync(path.join(b.oldDir, `junkwell-nosite-${H}.json`), 'utf8')\n    if (ns.length) summary.push(",
    async mod => {
      const o = fixture(); assert.equal(mod.main(['apply', '--pool', POOL], o, say), 0)
      const d = town(o), rec = JSON.parse(fs.readFileSync(path.join(d, `junkwell-plinth-${H}.json`), 'utf8'))
      const noSite = JSON.parse(fs.readFileSync(path.join(d, `junkwell-nosite-${H}.json`), 'utf8'))
      assert.equal(P.plinthWant({ wellUsable: false, rec, noSite, world: WORLD, now: NOW, shared: true, first: true, naturalPit: false, loaded: true }).want, 'plan',
        'the mutant did not reproduce the hazard, so the chain test above proves nothing')
    })
})
await ta('apply is idempotent (a second run changes nothing) and resumes a half-done env step from its marker', () => {
  const o = fixture(); run(o, 'apply', '--pool', POOL)
  const h = treeHash(root(o)); quiet.length = 0
  assert.equal(run(o, 'apply', '--pool', POOL), 0); assert.match(quiet.join('\n'), /already converted/); assert.equal(treeHash(root(o)), h)
  const f = path.join(o.envDir, 'isolated-b-Delta.env')   // a crash after the seed, before Delta's env line
  fs.writeFileSync(f, M.rewriteEnv(fs.readFileSync(f, 'utf8'), M.OLD_VALUES('isolated-b-Delta')).text)
  assert.equal(run(o, 'apply', '--pool', POOL), 0, quiet.join('\n')); assert.equal(env(o, 'isolated-b-Delta').MEMORY_POOL, POOL)
})
await ta('REFUSALS write nothing: a declared canary, a drop-in, a foreign town dir, disagreeing caps, plan-only, an override, a mixed env', () => {
  const cases = [
    ['canary', fixture({ canary: 'board-d,hive-a' }), /canary is declared/],
    ['dropin', (() => { const o = fixture(); fs.mkdirSync(path.join(o.dropinRoot, 'mcbot@hive-a-Alpha.service.d')); fs.writeFileSync(path.join(o.dropinRoot, 'mcbot@hive-a-Alpha.service.d', '10-canary.conf'), 'x'); return o })(), /drop-ins/],
    ['foreign', (() => { const o = fixture(); fs.mkdirSync(town(o)); return o })(), /without a isolated2shared marker/],
    ['caps', fixture({ caps: [null, { x: 1, y: 2, z: 3 }] }), /different caps/],
    ['planonly', fixture({ noComplete: true }), /no complete one/],
    ['override', fixture({ envOver: { 'isolated-b-Echo': { SMELT_JOB: '0' } } }), /SMELT_JOB=0 is set/],
    ['mixed', fixture({ envOver: { 'isolated-b-Echo': { MEMORY_SCOPE: 'private', MEMORY_POOL: POOL, EXP_ARM: 'town' } } }), /env is mixed/],
  ]
  for (const [name, o, re] of cases) {
    const h = treeHash(root(o)); quiet.length = 0
    assert.equal(run(o, 'apply', '--pool', POOL), 2, `${name}: ${quiet.join(' | ')}`)
    assert.match(quiet.join('\n'), re, name); assert.equal(treeHash(root(o)), h, `${name}: wrote something`)
  }
  const ok = fixture({ envOver: { 'isolated-b-Echo': { SMELT_JOB: '0' } } })
  assert.equal(run(ok, 'apply', '--pool', POOL, '--allow-override', 'SMELT_JOB'), 0, 'an accepted override applies')
})
await ta('MUTANT KILLED: without the canary check, apply converts a pool while a canary is declared', async () => {
  await withMutant(TOOL, "  const dc = declaredCanary(o); if (dc) refuse.push(dc)\n  const di = dropins(o); if (di.length) refuse.push(`canary drop-ins present (${di.slice",
    "  const dc = null\n  const di = dropins(o); if (di.length) refuse.push(`canary drop-ins present (${di.slice",
    async mod => { assert.equal(mod.main(['apply', '--pool', POOL], fixture({ canary: 'board-d' }), say), 0, 'the mutant should have applied') })
})
await ta('rollback: only the three lines go back (a later CODE_VERSION stays), the town dir and per-bot journals are set aside', () => {
  const o = fixture(); run(o, 'apply', '--pool', POOL)
  for (const b of BOTS) {                                         // a promotion between the apply and the rollback
    const f = path.join(o.envDir, `${b}.env`); fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace(/^CODE_VERSION=.*$/m, 'CODE_VERSION=newsha'))
  }
  quiet.length = 0
  assert.equal(run(o, 'rollback', '--pool', POOL), 0, quiet.join('\n'))
  for (const b of BOTS) {
    const e = env(o, b); assert.equal(e.MEMORY_SCOPE, 'isolated'); assert.equal(e.MEMORY_POOL, `self-${b}`); assert.equal(e.EXP_ARM, 'isolated')
    assert.equal(e.CODE_VERSION, 'newsha', 'a byte-exact restore would have put a stale CODE_VERSION back (three versions halt the tripper)')
    assert.equal(fs.readdirSync(path.join(o.stateRoot, `_pool-self-${b}`)).filter(f => f.includes('.cobble.')).length, 0, 'journal moved aside: a fresh recount')
  }
  assert.ok(!fs.existsSync(town(o))); assert.equal(fs.readdirSync(path.join(o.stateRoot, '_isolated2shared')).filter(f => f.startsWith('rolledback-')).length, 1)
  assert.equal(M.plan(POOL, M.defaults(o)).state, 'isolated')
})

await ta('rollback resumes after a crash between its env step and its dir step (the marker moves last)', () => {
  const o = fixture(); run(o, 'apply', '--pool', POOL)
  for (const b of BOTS) { const f = path.join(o.envDir, `${b}.env`); fs.writeFileSync(f, M.rewriteEnv(fs.readFileSync(f, 'utf8'), M.OLD_VALUES(b)).text) }
  quiet.length = 0
  assert.equal(run(o, 'rollback', '--pool', POOL), 0, quiet.join('\n')); assert.ok(!fs.existsSync(town(o)))
  quiet.length = 0
  assert.equal(run(o, 'rollback', '--pool', POOL), 2, 'a finished rollback is not repeated'); assert.match(quiet.join('\n'), /nothing to roll back/)
})
await ta('an interrupted rollback is only ever finished: apply refuses to resume it (Claude r2 P3-5)', () => {
  const o = fixture(); run(o, 'apply', '--pool', POOL)
  const mf = path.join(town(o), M.MARKER)
  fs.writeFileSync(mf, JSON.stringify({ ...JSON.parse(fs.readFileSync(mf, 'utf8')), rollback_started: '2026-10-20T12:00:00Z' }))
  for (const b of BOTS) { const f = path.join(o.envDir, `${b}.env`); fs.writeFileSync(f, M.rewriteEnv(fs.readFileSync(f, 'utf8'), M.OLD_VALUES(b)).text) }
  const h = treeHash(root(o)); quiet.length = 0
  assert.equal(run(o, 'apply', '--pool', POOL), 2); assert.match(quiet.join('\n'), /rollback .* did not finish/); assert.equal(treeHash(root(o)), h)
  assert.equal(run(o, 'rollback', '--pool', POOL), 0); assert.ok(!fs.existsSync(town(o)))
})
await ta('a half rollback with EVERY env still converted is refused too, not read as "already converted" (Codex r3 P2-3)', () => {
  const o = fixture(); run(o, 'apply', '--pool', POOL)
  const mf = path.join(town(o), M.MARKER)
  fs.writeFileSync(mf, JSON.stringify({ ...JSON.parse(fs.readFileSync(mf, 'utf8')), rollback_started: '2026-10-20T12:00:00Z' }))
  const h = treeHash(root(o)); quiet.length = 0
  assert.equal(run(o, 'apply', '--pool', POOL), 2); assert.match(quiet.join('\n'), /did not finish/); assert.equal(treeHash(root(o)), h)
})
await ta('foldContainer keeps a bot\'s own mark when its 8 retained strikes are all newer than the last opening (truncated history, Codex r3 P2-4)', async () => {
  const { recordOutcome } = await import('../src/chestfull.mjs')
  let e; const t0 = NOW - 3 * 3600e3
  e = recordOutcome(e, 'unknown', t0); e = recordOutcome(e, 'unknown', t0 + 11 * 60e3)            // qualifies: unusable
  for (let i = 0; i < 8; i++) e = recordOutcome(e, 'unknown', t0 + 12 * 60e3 + i * 1000)             // evicts the qualifying pair
  assert.equal(containerStatus(e, NOW), 'unusable'); assert.equal(e.strikes.length, 8)
  assert.equal(containerStatus(M.foldContainer([e]), NOW), 'unusable', 'the single snapshot keeps its valid mark')
  assert.equal(containerStatus(M.foldContainer([e, { o: 'took', at: t0 + 30 * 60e3, strikes: [] }]), NOW), 'visit', 'a later opening still clears it')
})
await ta('foldContainer never RESURRECTS a mark an opening cleared (Codex r4 P2-4: unknowns 0/11 min, took 11.5, eight unknowns ~12)', async () => {
  const { recordOutcome } = await import('../src/chestfull.mjs')
  const t0 = NOW - 60 * 60e3
  let a = recordOutcome(undefined, 'unknown', t0); a = recordOutcome(a, 'unknown', t0 + 11 * 60e3)
  for (let i = 0; i < 8; i++) a = recordOutcome(a, 'unknown', t0 + 12 * 60e3 + i * 1000)
  const b = recordOutcome(undefined, 'took', t0 + 11.5 * 60e3)
  let truth; for (const [o, t] of [['unknown', t0], ['unknown', t0 + 11 * 60e3], ['took', t0 + 11.5 * 60e3], ...Array.from({ length: 8 }, (_, i) => ['unknown', t0 + 12 * 60e3 + i * 1000])]) truth = recordOutcome(truth, o, t)
  assert.equal(containerStatus(truth, NOW), 'visit')
  assert.equal(containerStatus(M.foldContainer([a, b]), NOW), 'visit', 'the mark rests on strikes B\'s took cleared')
})
await ta('status names a started rollback (the wrapper\'s uniform() reads it: Codex r4 P2-3)', () => {
  const o = fixture(); run(o, 'apply', '--pool', POOL)
  const mf = path.join(town(o), M.MARKER)
  fs.writeFileSync(mf, JSON.stringify({ ...JSON.parse(fs.readFileSync(mf, 'utf8')), rollback_started: '2026-10-20T12:00:00Z' }))
  quiet.length = 0; run(o, 'status', '--pool', POOL)
  assert.match(quiet.join('\n'), /^isolated-b: env converted .*ROLLBACK STARTED 2026-10-20T12:00:00Z/m)
})
await ta('the hold helper\'s rules self-test, and the wrapper and the tripwire parse (bash -n, python import)', () => {
  execFileSync('python3', [path.join(here, '../../scripts/host/isolated2sharedhold.py'), 'selftest'], { encoding: 'utf8' })   // asserts run at import
  execFileSync('bash', ['-n', path.join(here, '../../scripts/host/isolated2shared-direct.sh')])
  execFileSync('python3', [path.join(here, '../../scripts/host/isolated2sharedtrip.py'), '--help'], { encoding: 'utf8' })
})
await ta('tripwire exposure: the trailing window is MEASURED from rows in it, never scaled from the whole POST (Codex r3 P2-5)', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'i2s-logs-')), bot = 'isolated-b-Alpha'
  fs.mkdirSync(path.join(d, bot))
  const now = new Date(), since = new Date(now - 240 * 60e3), rows = []
  for (let m = 6; m < 200; m += 1) rows.push(new Date(since.getTime() + m * 60e3))       // busy for 200 min, then silent
  rows.push(new Date(now - 10 * 60e3)); rows.push(new Date(now - 9 * 60e3))               // two rows 1 min apart in the tail
  fs.writeFileSync(path.join(d, bot, `skill-${bot}.jsonl`), rows.map(t => JSON.stringify({ '@timestamp': t.toISOString(), skill: { name: 'gather' }, bot: { name: bot } })).join('\n') + '\n')
  const out = execFileSync('python3', ['-c', `
import importlib.util,sys,datetime as dt
s=importlib.util.spec_from_file_location('t', sys.argv[1]); t=importlib.util.module_from_spec(s); s.loader.exec_module(t)
t.LOGS=sys.argv[2]; now=dt.datetime.now(dt.timezone.utc); since=dt.datetime.fromisoformat(sys.argv[3].replace('Z','+00:00'))
sel,exp,_=t.walk(since-dt.timedelta(hours=1), since, since+dt.timedelta(minutes=5), now, set(), now-dt.timedelta(minutes=120))
e=exp[sys.argv[4]]; print('%.4f %.4f' % (e['post'], e['tail']))`, path.join(here, '../../scripts/host/isolated2sharedtrip.py'), d, since.toISOString(), bot], { encoding: 'utf8' }).trim()
  const [post, tail] = out.split(' ').map(Number)
  assert.ok(post > 2.5, `post ${post}`); assert.ok(Math.abs(tail - 81 / 60) < 0.05, `the tail holds 80 busy min + 1 min = 1.35 h; measured ${tail} (scaled would be ${(post * 120 / 235).toFixed(2)})`)
})
await ta('more refusals that write nothing: a duplicated key in ONE env file (checked before any write), an unreadable drop-in dir', () => {
  const o = fixture(); const f = path.join(o.envDir, 'isolated-b-Echo.env')
  fs.appendFileSync(f, 'MEMORY_POOL=self-isolated-b-Echo\n')
  let h = treeHash(root(o)); quiet.length = 0
  assert.equal(run(o, 'apply', '--pool', POOL), 2); assert.match(quiet.join('\n'), /MEMORY_POOL is assigned 2 times/); assert.equal(treeHash(root(o)), h, 'no backup, no seed, no other bot converted')
  const o2 = fixture(); o2.dropinRoot = path.join(root(o2), 'no-such-dir'); h = treeHash(root(o2)); quiet.length = 0
  assert.equal(run(o2, 'apply', '--pool', POOL), 2); assert.match(quiet.join('\n'), /cannot inspect/); assert.equal(treeHash(root(o2)), h)
})
await ta('the caps the town had are frozen into the marker (I2 judges against them, not live records)', () => {
  const o = fixture(); run(o, 'apply', '--pool', POOL)
  const m = JSON.parse(fs.readFileSync(path.join(town(o), M.MARKER), 'utf8'))
  assert.deepEqual(m.known_caps, ['357,74,160'])
  const py = execFileSync('python3', ['-c', `import importlib.util,sys; s=importlib.util.spec_from_file_location('t', sys.argv[1]); t=importlib.util.module_from_spec(s); s.loader.exec_module(t); print(sorted(t.known_caps(sys.argv[2], sys.argv[3])))`,
    path.join(here, '../../scripts/host/isolated2sharedtrip.py'), POOL, o.stateRoot], { encoding: 'utf8' }).trim()
  assert.equal(py, '[(357, 74, 160)]', 'the tripwire reads the frozen caps from the marker')
  fs.writeFileSync(path.join(town(o), `junkwell-plinth-${H}.json`), JSON.stringify(plinthRec('plan', NOW, { plan: { cap: { x: 1, y: 2, z: 3 }, steps: [] } })))
  const py2 = execFileSync('python3', ['-c', `import importlib.util,sys; s=importlib.util.spec_from_file_location('t', sys.argv[1]); t=importlib.util.module_from_spec(s); s.loader.exec_module(t); print(sorted(t.known_caps(sys.argv[2], sys.argv[3])))`,
    path.join(here, '../../scripts/host/isolated2sharedtrip.py'), POOL, o.stateRoot], { encoding: 'utf8' }).trim()
  assert.equal(py2, '[(357, 74, 160)]', 'a NEW plan in the live record does not become a known cap')
})
await ta('MUTANT KILLED: a byte-exact env restore puts the stale CODE_VERSION back', async () => {
  await withMutant(TOOL, 'try { rewrites.push({ b, r: rewriteEnv(b.text, before[b.bot] ?? OLD_VALUES(b.bot)) }) }',
    "try { rewrites.push({ b, r: { text: fs.readFileSync(path.join(bdir, path.basename(b.envFile)), 'utf8'), changed: [] } }) }",
    async mod => {
      const o = fixture(); mod.main(['apply', '--pool', POOL], o, say)
      for (const b of BOTS) { const f = path.join(o.envDir, `${b}.env`); fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace(/^CODE_VERSION=.*$/m, 'CODE_VERSION=newsha')) }
      assert.equal(mod.main(['rollback', '--pool', POOL], o, say), 0)
      assert.notEqual(env(o, BOTS[0]).CODE_VERSION, 'newsha', 'the mutant kept the new CODE_VERSION, so the rollback test proves nothing')
    })
})
await ta('MUTANT KILLED: taking the first bot\'s entry instead of folding loses a newer outcome', async () => {
  await withMutant(TOOL, '  for (const [k, list] of Object.entries(lists)) entries[k] = foldContainer(list)',
    '  for (const [k, list] of Object.entries(lists)) entries[k] = list[0]',
    async mod => {
      const o = fixture(); assert.equal(mod.main(['apply', '--pool', POOL], o, say), 0)
      assert.equal(readTownMemory(town(o), `town-chest-${H}`, WORLD)['355,72,147'].o, 'full', 'the mutant kept the newest anyway')
    })
})

// ---- the env does in a real bot process what the design table says ---------------------------------------------------------
await ta('a bot process on the converted env: pooled world model (the seeded file), per-bot lessons, smelt on, records shared, same prompt', () => {
  const o = fixture(); run(o, 'apply', '--pool', POOL)
  const driver = path.join(root(o), 'driver.mjs')
  fs.writeFileSync(driver, `
import { config } from '${path.join(here, '../src/config.mjs')}'
import { openWorldFacts, poolStateDir } from '${path.join(here, '../src/worldfacts.mjs')}'
import { openLessons } from '${path.join(here, '../src/lessons.mjs')}'
import { smeltJobEnabled } from '${path.join(here, '../src/smeltjob.mjs')}'
import { townRecordsShared } from '${path.join(here, '../src/plinth.mjs')}'
import { buildSystemPrompt } from '${path.join(here, '../src/prompt.mjs')}'
import crypto from 'node:crypto'
const wf = openWorldFacts()
console.log(JSON.stringify({ wf: wf.file, sites: wf.read().sites.length, lessons: openLessons().file, town: poolStateDir(config.memory.pool),
  smelt: smeltJobEnabled(process.env, config.memory.scope).on, shared: townRecordsShared({ scope: config.memory.scope, pool: config.memory.pool, name: config.bot.name }),
  prompt: crypto.createHash('sha256').update(buildSystemPrompt(['gather', 'goto', 'board', 'surface'])).digest('hex') }))`)
  const bot = 'isolated-b-Alpha', sd = path.join(o.stateRoot, bot)
  const runAs = over => JSON.parse(execFileSync(process.execPath, [driver], { encoding: 'utf8', env: { ...process.env, ...M.parseEnv(fs.readFileSync(path.join(o.envDir, `${bot}.env`), 'utf8')), LOG_DIR: path.join(root(o), 'logs'), ...over } }).trim().split('\n').pop())
  const conv = runAs({})
  assert.equal(conv.wf, path.join(town(o), `world-facts-${POOL}.json`)); assert.ok(conv.sites > 5, 'the bot reads the seeded union')
  assert.equal(conv.lessons, path.join(sd, `lessons-${bot}.json`), 'lessons stay per bot under private, as under isolated')
  assert.equal(conv.town, town(o)); assert.equal(conv.smelt, true); assert.equal(conv.shared, true)
  const iso = runAs({ MEMORY_SCOPE: 'isolated', MEMORY_POOL: `self-${bot}`, EXP_ARM: 'isolated' })
  assert.equal(iso.wf, path.join(sd, `world-facts-${bot}.json`)); assert.equal(iso.smelt, false); assert.equal(iso.shared, false)
  assert.equal(iso.lessons, conv.lessons); assert.equal(iso.prompt, conv.prompt, 'the system prompt is byte-identical under private and isolated')
  assert.notEqual(runAs({ MEMORY_SCOPE: 'board' }).prompt, conv.prompt, 'POSITIVE CONTROL: the prompt hash does see a scope that changes it')
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
