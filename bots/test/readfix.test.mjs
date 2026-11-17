// readfix-01: the build visit's block read by state id (buildbot.mjs blockReader). Behaviour over a REAL 1.21.8 world model
// (prismarine-world + prismarine-chunk + the registry, the stack mineflayer's bot.world and bot.blockAt sit on), every state id.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { Vec3 } = require('vec3')
const registry = require('prismarine-registry')('1.21.8')
const Chunk = require('prismarine-chunk')(registry)
const World = require('prismarine-world')(registry)
const BB = new URL('../src/buildbot.mjs', import.meta.url)
const BR = new URL('../src/buildrun.mjs', import.meta.url)
const M = await import(BB.href)

/** A bot as mineflayer gives one: bot.world (WorldSync) and blockAt(pos, extraInfos) == world.getBlock(pos) + the painting lookup. */
function realBot () {
  const world = new World(null).sync
  const calls = { blockAt: 0 }
  const bot = { world, blockAt (p, extra = true) { calls.blockAt++; const b = world.getBlock(p); if (!b) return null; if (extra) b.painting = undefined; return b } }
  return { bot, world, calls }
}
const column = (world, cx, cz) => { const c = new Chunk({ minY: -64, worldHeight: 384 }); world.setColumn(cx, cz, c); return c }
const viewOf = b => (b ? { name: b.name, boundingBox: b.boundingBox, props: b.getProperties() } : null)

test('EQUALITY: every 1.21.8 state id reads the same name, boundingBox and props through the cache as through blockAt, at two places in two biomes', () => {
  const { bot, world } = realBot()
  const states = registry.blocksArray.flatMap(b => { const o = []; for (let s = b.minStateId; s <= b.maxStateId; s++) o.push(s); return o })
  assert.ok(states.length > 20000, `the registry's states (${states.length})`)
  // two columns, two biomes: the same state at two positions must give one view
  const ca = column(world, 0, 0), cb = column(world, 1, 0)
  const biomes = registry.biomesArray.map(b => b.id)
  const read = M.blockReader(bot)
  const differ = []
  let i = 0
  for (const sid of states) {
    const x = i % 16, z = Math.floor(i / 16) % 16, y = -64 + Math.floor(i / 256) % 384
    i++
    ca.setBlockStateId(new Vec3(x, y, z), sid); cb.setBlockStateId(new Vec3(x, y, z), sid)
    ca.setBiome?.(new Vec3(x, y, z), biomes[0]); cb.setBiome?.(new Vec3(x, y, z), biomes[biomes.length - 1])
    for (const p of [new Vec3(x, y, z), new Vec3(16 + x, y, z)]) {
      const want = viewOf(bot.blockAt(p)), got = read(p.x, p.y, p.z)
      try { assert.deepStrictEqual({ name: got.name, boundingBox: got.boundingBox, props: got.props }, want) } catch { differ.push(`${sid} ${want?.name}`) }
    }
    if (i % 98304 === 0) { /* a column holds 98,304 cells: never reached at 1.21.8's ~29k states */ }
  }
  assert.deepStrictEqual(differ, [], 'states whose view is not a function of the state id alone')
})

test('ONE blockAt per state, not per read; an unloaded column reads null; the view is frozen', () => {
  const { bot, world, calls } = realBot()
  const c = column(world, 0, 0)
  const stone = registry.blocksByName.stone.defaultState, oak = registry.blocksByName.oak_stairs.defaultState
  for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) c.setBlockStateId(new Vec3(x, 64, z), x < 8 ? stone : oak)
  const read = M.blockReader(bot)
  for (let k = 0; k < 3; k++) for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) read(x, 64, z)
  assert.equal(calls.blockAt, 2, '768 reads of two states ask blockAt twice')
  assert.equal(read(40, 64, 40), null, 'unloaded column')
  const v = read(0, 64, 0)
  assert.equal(v, read(1, 64, 1), 'one view a state')
  assert.throws(() => { v.name = 'dirt' }, TypeError)
  const st = read(12, 64, 0)
  assert.equal(st.props.facing, 'north')
  assert.throws(() => { st.props.facing = 'south' }, TypeError)
  assert.equal(read(13, 64, 0).props.facing, 'north')
})

test('READ_UNCACHED: a listed block is read through blockAt every time, with the same answer', () => {
  const { bot, world, calls } = realBot()
  const c = column(world, 0, 0)
  const sid = registry.blocksByName.chest.defaultState
  c.setBlockStateId(new Vec3(1, 64, 1), sid); c.setBlockStateId(new Vec3(2, 64, 1), sid)
  M.READ_UNCACHED.add('chest')
  try {
    const read = M.blockReader(bot)
    const a = read(1, 64, 1), b = read(2, 64, 1), a2 = read(1, 64, 1)
    assert.ok(calls.blockAt >= 4, `blockAt per read (${calls.blockAt})`)
    assert.equal(a.name, 'chest'); assert.equal(b.name, 'chest'); assert.equal(a2.props.facing, a.props.facing)
  } finally { M.READ_UNCACHED.delete('chest') }
})

test('a bot without the world state reads (a test fake) still reads through blockAt', () => {
  let n = 0
  const read = M.blockReader({ blockAt: () => { n++; return { name: 'stone', boundingBox: 'block', getProperties: () => ({}) } } })
  assert.equal(read(0, 0, 0).name, 'stone'); read(0, 0, 0)
  assert.equal(n, 2)
})

// ---- mutants (anchored: present and unique) ----------------------------------------------------------------------------------
async function withMutant (path, old, neu, fn) {
  const src = readFileSync(path, 'utf8')
  assert.ok(src.includes(old), `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 60))}`)
  assert.ok(src.split(old).length === 2, 'ANCHOR NOT UNIQUE')
  const out = new URL(`../src/_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, src.replace(old, neu))
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}
test('mutant: no cache (blockAt per read) is caught by the call count', async () => {
  await withMutant(BB, '    const r = byState.get(sid)\n', '    const r = undefined\n', async Mu => {
    const { bot, world, calls } = realBot(); const c = column(world, 0, 0)
    c.setBlockStateId(new Vec3(0, 64, 0), registry.blocksByName.stone.defaultState)
    const read = Mu.blockReader(bot); for (let k = 0; k < 10; k++) read(0, 64, 0)
    assert.equal(calls.blockAt, 10, 'the mutant asks blockAt every read (the real reader asks once)')
  })
})
test('mutant: an unfrozen view is caught (a write would change every later read of the state)', async () => {
  await withMutant(BB, '    const view = Object.freeze({', '    const view = ({', async Mu => {
    const { bot, world } = realBot(); const c = column(world, 0, 0)
    c.setBlockStateId(new Vec3(0, 64, 0), registry.blocksByName.stone.defaultState)
    const v = Mu.blockReader(bot)(0, 64, 0)
    assert.doesNotThrow(() => { v.name = 'dirt' })
    assert.equal(Mu.blockReader(bot)(0, 64, 0).name, 'stone', 'a fresh reader is unaffected')
  })
})
test('mutant: no column check asks blockAt for every unloaded read (the real reader asks the world first, never blockAt)', async () => {
  const { bot, calls } = realBot()
  for (let k = 0; k < 5; k++) assert.equal(M.blockReader(bot)(40, 64, 40), null)
  assert.equal(calls.blockAt, 0)
  await withMutant(BB, '    if (!w.getColumnAt(v)) return null\n', '', async Mu => {
    const { bot, calls } = realBot()
    for (let k = 0; k < 5; k++) assert.equal(Mu.blockReader(bot)(40, 64, 40), null)
    assert.equal(calls.blockAt, 5)
  })
})
test('mutant: a view cached under the wrong state is caught by the equality check', async () => {
  await withMutant(BB, '    byState.set(sid, view)\n', '    byState.set(sid, view); if (!byState.has(sid + 1)) byState.set(sid + 1, view)\n', async Mu => {
    const { bot, world } = realBot(); const c = column(world, 0, 0)
    const st = registry.blocksByName.oak_stairs
    let bad = 0, i = 0
    const read = Mu.blockReader(bot)
    for (let sid = st.minStateId; sid <= st.maxStateId; sid++, i++) {
      const p = new Vec3(i % 16, 64, Math.floor(i / 16)); c.setBlockStateId(p, sid)
      const g = read(p.x, p.y, p.z); try { assert.deepStrictEqual({ name: g.name, boundingBox: g.boundingBox, props: g.props }, viewOf(bot.blockAt(p))) } catch { bad++ }
    }
    assert.ok(bad > 0, 'the mutant gives some stair states the previous state\'s facing')
  })
})

// ---- buildrun: structural invariants the behaviour cannot reach cheaply (memory only: comments stripped, executable lines) ------
const code = src => src.split('\n').map(l => l.replace(/\s\/\/.*$/, '')).filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')
test('buildrun: the kept walk clears the stand-class memo when it is rebuilt, bounds its node maps, and builds no key while nothing is unknown', () => {
  const s = code(readFileSync(BR, 'utf8'))
  assert.equal(s.split('noStep.clear(); classMemo.clear()').length, 2, 'classMemo cleared with the walk')
  assert.equal(s.split("if (walkMem.by.size >= WALK_BY_MAX) { for (const k of walkMem.by.keys()) if (k !== '|') { walkMem.by.delete(k); break } }").length, 2, 'walkMem.by bounded')
  assert.equal(s.split('const rd = (x, y, z) => (unknown.size > 0 && unknown.has(k3(x, y, z)) ? null : e.read(x, y, z))').length, 2, 'rd: no key while nothing is unknown')
  assert.ok(/export const WALK_BY_MAX = [1-9]\d*/.test(s))
})
test('skills: buildTidyVisit reads every project record once (tidyGuardsNow), never three times in the visit\'s own frame', () => {
  const s = code(readFileSync(new URL('../src/skills.mjs', import.meta.url), 'utf8'))
  const visit = s.slice(s.indexOf('async function buildTidyVisit ('), s.indexOf('\n}\n', s.indexOf('async function buildTidyVisit (')))
  assert.equal((visit.match(/plotRecordsNow\(\)/g) ?? []).length, 0, 'no plotRecordsNow in the visit body')
  assert.equal(visit.split('const g3 = tidyGuardsNow(rec)').length, 2)
  const g = s.slice(s.indexOf('function tidyGuardsNow ('), s.indexOf('\n}\n', s.indexOf('function tidyGuardsNow (')))
  assert.equal((g.match(/plotRecordsNow\(\)/g) ?? []).length, 1, 'one read, behind the lazy prNow')
})
