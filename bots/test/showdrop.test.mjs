// SHOWDROP-01 (LIVE showcase 11-08, release 0d560d4b: 57 "lost connection: Timed out" in a day). A CPU profile of showcase-Delta /
// -Gale: 13-17 s busy runs in the decision's shopActive, 38-40% of them readdirSync of the town directory (6,777 files). THREE CHANGES,
// each tested by what it does, each killed by an anchored mutant:
//   1. buildproj.mjs: one directory listing a synchronous stretch (listDir/listMatch), dropped after every own write, at the next turn
//   2. skills.mjs shopActivePrime: the order's per-project pass one project a turn, off the decision (features.mjs timer)
//   3. buildproj.mjs prunePool: superseded lease / barrier generations (never a newest one, never a record), dry first, POOLPRUNE=off
// The scene: real files in a temp pool dir (POOL_STATE_DIR) shaped like the showcase's (6,800 lease/barrier generations).
import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { performance } from 'node:perf_hooks'

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'showdrop-'))
process.env.POOL_STATE_DIR = dir
process.env.LOG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'showdrop-logs-'))
process.env.BOT_NAME = 'DropBot'
process.env.OLLAMA_MODEL ??= 'qwen2.5:7b-instruct'
process.env.HOME_X = '0'; process.env.HOME_Y = '64'; process.env.HOME_Z = '0'
process.env.MEMORY_SCOPE = 'shared'
const { config } = await import('../src/config.mjs')
const P = await import('../src/buildproj.mjs')
const K = await import('../src/skills.mjs')

let pass = 0, fail = 0
const t = async (name, fn) => { try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 6).join('\n        ')}`) } }
const withEnv = async (name, v, fn) => { const prev = process.env[name]; if (v == null) delete process.env[name]; else process.env[name] = v; try { return await fn() } finally { if (prev === undefined) delete process.env[name]; else process.env[name] = prev } }
const turn = () => new Promise(r => setImmediate(r))
const still = () => new Promise(r => setTimeout(r, 120))   // the directory still for longer than LIST_RACY_MS
const SRC = new URL('../src/', import.meta.url)
/** A mutant of a src module: the anchor asserted present and unique, the copy (and the modules it imports) loaded fresh. */
async function withModMutant (file, old, neu, fn) {
  const src = fs.readFileSync(new URL(file, SRC), 'utf8')
  assert.strictEqual(src.split(old).length - 1, 1, `ANCHOR MISSING OR NOT UNIQUE in ${file}: ${old.slice(0, 70)}`)
  const f = new URL(`.mut-${process.pid}-${Date.now().toString(36)}-${file}`, SRC)
  fs.writeFileSync(f, src.replace(old, neu))
  try { return await fn(await import(f.href)) } finally { fs.unlinkSync(f) }
}
const killedBy = async (file, old, neu, scenario, real) => {
  await scenario(real)
  let why = null
  await withModMutant(file, old, neu, async M => { try { await scenario(M) } catch (err) { why = err } })
  assert.ok(why instanceof assert.AssertionError, `the mutant survived or died for another reason: ${why?.stack?.split('\n')[0] ?? 'survived'}`)
}

// ---- THE SCENE: the showcase's directory shape (every project of the order, a record each, thousands of old generations) -------
const home = { x: config.world.homeX, y: config.world.homeY, z: config.world.homeZ }
const plots = K.projectsList ? K.projectsList().map(p => p.plot) : null
function scene (d, { gens = 6800 } = {}) {
  fs.mkdirSync(d, { recursive: true })
  const keys = (plots ?? ['shop', 'house1', 'monument', 'wall', 'paths', 'tidy', 'storehub', 'hall', 'enchantshop', 'deepmine']).map(pl => P.projKey(home, pl))
  const old = Date.now() - 72 * 3600_000
  let n = 0
  for (let i = 0; n < gens; i++) {
    const key = keys[i % keys.length], fam = i % 3 === 0 ? `${key}.barrier` : `${key}.seg-T-${i % 7}.lease`
    const g = Math.floor(i / keys.length) + 1
    const f = path.join(d, `${fam}.g${g}.json`)
    fs.writeFileSync(f, JSON.stringify({ holder: 'X', at: old, until: old + 60_000 })); fs.writeFileSync(`${f}.released`, String(old))
    fs.utimesSync(f, old / 1000, old / 1000); fs.utimesSync(`${f}.released`, old / 1000, old / 1000)
    n += 2
  }
  return keys
}
const keys = scene(dir)
console.log(`        (scene: ${fs.readdirSync(dir).length} files in the pool dir)`)
/** The decision's directory reads for one tick, as the profile showed them: per project the record head, its generation, the stuck
 *  stamp and three slot leases; then the intents and the barrier. */
function decisionReads (B, d = dir) {
  for (const k of keys) { B.recordHead(d, k); B.recordGenNow(d, k); B.stuckAt(d, k); for (const s of [1, 2, 3]) B.leaseState(d, k, `slot${s}`); B.barrierState(d, k); B.openIntents(d, k) }
}

console.log('SHOWDROP-01 (1): ONE LISTING A SYNCHRONOUS STRETCH')
await t('the switch: LISTCACHE=off|0|false|no is the rollback; unset is on', () => {
  for (const v of ['off', 'OFF', ' 0', 'false', 'no']) assert.strictEqual(P.listCacheOn({ LISTCACHE: v }), false, v)
  for (const v of [undefined, '', 'on', '1']) assert.strictEqual(P.listCacheOn({ LISTCACHE: v }), true, String(v))
})
await t('BEFORE / AFTER: one decision tick of directory reads lists the directory once, not once per read; the same answers', async () => {
  await still()
  const r0 = P.listStats.reads
  const offT = await withEnv('LISTCACHE', 'off', async () => { const a = performance.now(); decisionReads(P); return performance.now() - a })
  const offReads = P.listStats.reads - r0
  await turn()
  const r1 = P.listStats.reads
  const a = performance.now(); decisionReads(P); const onT = performance.now() - a
  const onReads = P.listStats.reads - r1
  console.log(`        (decision tick: ${offReads} listings ${offT.toFixed(0)} ms with LISTCACHE=off -> ${onReads} listing(s) ${onT.toFixed(0)} ms)`)
  assert.ok(offReads >= keys.length * 6, `POSITIVE CONTROL: the rollback listed only ${offReads} times`)
  assert.strictEqual(onReads, 1)
  assert.ok(onT * 3 < offT, `${onT.toFixed(0)} ms vs ${offT.toFixed(0)} ms`)
  // the same answers
  await turn()
  const ans = B => keys.map(k => JSON.stringify([B.recordGenNow(dir, k), B.leaseState(dir, k, 'slot1')?.gen ?? null, B.barrierState(dir, k)?.gen ?? null]))
  const off = await withEnv('LISTCACHE', 'off', () => ans(P))
  assert.deepStrictEqual(ans(P), off)
})
await t('an OWN write is seen by the next read at once (two lease takes in one stretch: gens 1 then 2), and the listing is dropped at the next turn', async () => {
  const scenario = async B => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'showdrop-own-'))
    await turn()
    B.leaseState(d, 'project-0_64_0.wall', 'slot1')              // a listing kept
    const a = B.takeLease(d, 'project-0_64_0.wall', 'slot1', 'A')
    assert.ok(a.ok && a.gen === 1, JSON.stringify(a))
    B.releaseLease(d, 'project-0_64_0.wall', 'slot1', 'A', 1)
    const b = B.takeLease(d, 'project-0_64_0.wall', 'slot1', 'B')
    assert.ok(b.ok && b.gen === 2, `the second take in the same stretch: ${JSON.stringify(b)}`)
    assert.strictEqual(B.leaseState(d, 'project-0_64_0.wall', 'slot1').rec.holder, 'B')
    // ANOTHER process's file (written past this module): seen after the turn
    fs.writeFileSync(path.join(d, 'project-0_64_0.wall.slot1.lease.g3.json'), JSON.stringify({ holder: 'C', at: Date.now(), until: Date.now() + 60_000 }))
    await turn()
    assert.strictEqual(B.leaseState(d, 'project-0_64_0.wall', 'slot1').gen, 3, 'a foreign generation after the next turn')
  }
  await killedBy('buildproj.mjs', '(...a) => { try { return t[k](...a) } finally { dropListings() } }', '(...a) => t[k](...a)', scenario, P)
})
await t('the listing is dropped at the next turn: the same directory, unchanged, is listed again after a turn (never held across an await)', async () => {
  const scenario = async B => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'showdrop-turn-'))
    fs.writeFileSync(path.join(d, 'k.g1.json'), '{}')
    await still()
    const r0 = B.listStats.reads
    B.listDir(d); B.listDir(d)
    assert.strictEqual(B.listStats.reads - r0, 1, 'POSITIVE CONTROL: the second read of the stretch was not served from the listing')
    await turn()
    B.listDir(d)
    assert.strictEqual(B.listStats.reads - r0, 2, 'the listing outlived the turn')
  }
  await killedBy('buildproj.mjs', 'setImmediate(() => { listDropQueued = false; listMem.clear() })', 'setImmediate(() => { listDropQueued = false })', scenario, P)
})
await t('RACILY CLEAN: a file written by another writer in the same mtime tick as the listing is seen by the very next read', async () => {
  const scenario = async B => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'showdrop-racy-'))
    await still()
    fs.writeFileSync(path.join(d, 'k.g1.json'), '{}')                  // the directory moved just now
    const tick = new Date(Date.now())                                    // one exact mtime (whole ms) for both reads
    fs.utimesSync(d, tick, tick)
    assert.strictEqual(B.listDir(d).length, 1)
    fs.writeFileSync(path.join(d, 'k.g2.json'), '{}')                  // a foreign create (past this module's wfs)
    fs.utimesSync(d, tick, tick)                                         // ...in the same coarse tick: the mtime does not move
    assert.strictEqual(B.listDir(d).length, 2, 'a racy listing was served')
  }
  await killedBy('buildproj.mjs', '  if (m && !m.racy && mt != null', '  if (m && mt != null', scenario, P)
})
console.log('SHOWDROP-01 (2): THE ORDER\'S PROJECT STATES, ONE PROJECT A TURN (shopActivePrime)')
await t('the switch: SHOPPRIME=off is the rollback', () => {
  for (const v of ['off', '0', 'false', 'no']) assert.strictEqual(K.shopPrimeOn({ SHOPPRIME: v }), false, v)
  assert.strictEqual(K.shopPrimeOn({}), true)
})
await t('BEFORE / AFTER: the decision\'s shopActive pass vs the primer\'s longest turn; the same pick; the decision then skips the pass', async () => {
  const bot = { username: 'T', blockAt: () => null }
  const run = async () => {
    K.shopActiveForget(); await turn()
    const a = performance.now(); const pick0 = K.shopActive(bot).plot; const sync = performance.now() - a
    K.shopActiveForget(); await turn()
    let longest = 0, last = performance.now()
    const pause = async () => { const n = performance.now(); longest = Math.max(longest, n - last); await turn(); last = performance.now() }
    const wrote = await K.shopActivePrime(bot, Date.now(), { pause })
    longest = Math.max(longest, performance.now() - last)
    const b = performance.now(); const pick1 = K.shopActive(bot).plot; const after = performance.now() - b
    return { sync, longest, after, pick0, pick1, wrote }
  }
  const off = await withEnv('LISTCACHE', 'off', run)
  const on = await run()
  console.log(`        (shopActive pass: ${off.sync.toFixed(0)} ms in one turn [LISTCACHE=off], ${on.sync.toFixed(0)} ms [on]; primer's longest turn ${off.longest.toFixed(0)} / ${on.longest.toFixed(0)} ms; the decision after the primer ${on.after.toFixed(0)} ms)`)
  assert.ok(on.wrote, 'the primer wrote the memo')
  assert.strictEqual(on.pick1, on.pick0, 'the same project picked')
  assert.ok(on.longest <= on.sync, `the primer's longest turn ${on.longest.toFixed(1)} ms is no longer than the whole pass ${on.sync.toFixed(1)} ms`)
  assert.ok(on.after < on.sync, `the decision after the primer still ran the pass: ${on.after.toFixed(1)} vs ${on.sync.toFixed(1)} ms`)
})
await t('a record generation that moves during the pauses: the memo is NOT written (the decision reads it fresh)', async () => {
  const scenario = async M => {
    M.shopActiveForget(); await turn()
    let moved = false
    const pause = async () => { if (!moved) { moved = true; P.publishRecord(dir, keys[0], cur => ({ ...(cur ?? {}), v: 1, plot: 'x', cells: [], structure_complete: false })) } await turn() }
    const wrote = await M.shopActivePrime({ username: 'T', blockAt: () => null }, Date.now(), { pause })
    assert.ok(moved, 'POSITIVE CONTROL: the pause never ran')
    assert.strictEqual(wrote, false, 'a memo written over a moved record')
  }
  await killedBy('skills.mjs', "    if (activeSig(dir, list) !== sig) return false        // a record moved during the pauses: the decision reads it fresh\n", '', scenario, K)
})
await t('SHOPPRIME=off: the primer does nothing', async () => {
  K.shopActiveForget()
  assert.strictEqual(await withEnv('SHOPPRIME', 'off', () => K.shopActivePrime({ username: 'T' })), false)
})

console.log('SHOWDROP-01 (3): THE PRUNE (prunePool)')
await t('the switch: POOLPRUNE=off|dry; unset is on', () => {
  assert.strictEqual(P.poolPruneMode({ POOLPRUNE: 'off' }), 'off'); assert.strictEqual(P.poolPruneMode({ POOLPRUNE: 'dry' }), 'dry'); assert.strictEqual(P.poolPruneMode({}), 'on')
})
await t('pruneCandidates: never a newest generation, never a record, never young, never an unreleased barrier, a lease only when long expired', () => {
  const now = 1e12, old = now - 72 * 3600_000, young = now - 3600_000
  const names = ['k.seg-A.lease.g1.json', 'k.seg-A.lease.g1.json.released', 'k.seg-A.lease.g2.json', 'k.seg-A.lease.g2.json.released', 'k.seg-A.lease.g3.json',
    'k.barrier.g1.json', 'k.barrier.g2.json', 'k.barrier.g2.json.released', 'k.barrier.g3.json',
    'k.g1.json', 'k.g2.json', 'k.slot1.lease.g1.json', 'k.slot1.lease.g2.json', 'k.slot2.lease.g1.json', 'k.slot2.lease.g2.json', 'k.mutate.g1.json', 'k.mutate.g2.json']
  const mt = { 'k.seg-A.lease.g2.json.released': young }
  const read = f => ({ 'k.slot1.lease.g1.json': { until: old }, 'k.slot2.lease.g1.json': { until: young } })[f] ?? null
  const got = P.pruneCandidates(names, { now, mtime: f => mt[f] ?? old, read }).map(c => c.file).sort()
  // seg-A g2's marker is young: kept; the barrier g1 is unreleased: kept, its g2 released and old: pruned; slot2 g1 expired 1 h ago: kept
  assert.deepStrictEqual(got, ['k.barrier.g2.json', 'k.seg-A.lease.g1.json', 'k.slot1.lease.g1.json'].sort())
})
await t('pruneCandidates: a released old barrier below the newest is pruned; the newest of every family never is', () => {
  const scenario = M => {
    const now = 1e12, old = now - 72 * 3600_000
    const names = ['k.barrier.g1.json', 'k.barrier.g1.json.released', 'k.barrier.g2.json', 'k.barrier.g2.json.released']
    const got = M.pruneCandidates(names, { now, mtime: () => old, read: () => null }).map(c => c.file)
    assert.deepStrictEqual(got, ['k.barrier.g1.json'])
  }
  return killedBy('buildproj.mjs', '      if (g.gen >= top) continue                                   // the newest generation: never\n', '', scenario, P)
})
await t('THE SCENE: the first pass is dry (counts, deletes nothing); the next deletes up to PRUNE_MAX; every family keeps its newest; POOLPRUNE=off does nothing', async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'showdrop-prune-'))
  const ks = scene(d, { gens: 3000 })
  const before = fs.readdirSync(d).length
  const top = () => { const m = new Map(); for (const n of fs.readdirSync(d)) { const x = /^(.+)\.g(\d+)\.json$/.exec(n); if (x) m.set(x[1], Math.max(m.get(x[1]) ?? 0, Number(x[2]))) } return m }
  const top0 = top()
  assert.strictEqual(P.prunePool(d, { env: { POOLPRUNE: 'off' } }).candidates, 0)
  const dry = P.prunePool(d, { dry: true, env: {} })
  assert.ok(dry.candidates > 1000 && dry.deleted === 0 && fs.readdirSync(d).length === before, JSON.stringify(dry))
  const wet = P.prunePool(d, { env: {}, max: 100000 })
  console.log(`        (prune scene: ${before} files, dry count ${dry.candidates}, deleted ${wet.deleted}, left ${fs.readdirSync(d).length})`)
  assert.ok(wet.deleted > 0 && wet.errors === 0)
  assert.deepStrictEqual(top(), top0, 'a newest generation was pruned')
  for (const k of ks) assert.ok(top().has(`${k}.barrier`) || ![...top0.keys()].includes(`${k}.barrier`))
  // the records stay (none in the scene's families: a record file is never a candidate)
  fs.writeFileSync(path.join(d, `${ks[0]}.g1.json`), '{}'); const old = Date.now() / 1000 - 72 * 3600; fs.utimesSync(path.join(d, `${ks[0]}.g1.json`), old, old)
  P.prunePool(d, { env: {}, max: 100000 })
  assert.ok(fs.existsSync(path.join(d, `${ks[0]}.g1.json`)), 'a record generation was pruned')
})
await t('installPoolPrune: the first pass of a connection is DRY and logged; the second deletes', async () => {
  const F = await import('../src/features.mjs')
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'showdrop-inst-'))
  scene(d, { gens: 200 })
  const n0 = fs.readdirSync(d).length
  const h = F.installPoolPrune({ once: () => {} }, { dir: d, first: 1e9, every: 1e9, env: {} })
  const r1 = h.pass(); assert.ok(r1.mode === 'dry' && r1.deleted === 0 && fs.readdirSync(d).length === n0, JSON.stringify(r1))
  const r2 = h.pass(); assert.ok(r2.deleted > 0, JSON.stringify(r2))
  h.stop()
  assert.strictEqual(F.installPoolPrune({ once: () => {} }, { dir: d, env: { POOLPRUNE: 'off' } }), null)
})
await t('THE WIRING: features.mjs runs the primer on a timer and the prune on shared pools; both stop on end', () => {
  const src = fs.readFileSync(new URL('features.mjs', SRC), 'utf8').replace(/^\s*\/\/.*$/gm, '')
  assert.strictEqual(src.split('shopActivePrime(bot).catch(() => false)').length - 1, 1)
  assert.strictEqual(src.split("if (config.memory.scope !== 'isolated') installPoolPrune(bot)").length - 1, 1)
  assert.ok(/clearInterval\(primeTimer\)/.test(src))
})

fs.rmSync(dir, { recursive: true, force: true })
console.log(`\n  ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
