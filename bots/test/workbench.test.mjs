// WORKBENCH-01: the finished workshop is the town's workbench (bots/src/workbench.mjs; skills.mjs matsFurnaceCandidates,
// pickLeasedFurnace for smelt_town, craftLevel's table for make_material's crafts). Behaviour of the pure order and of the
// furnace pick on a fake world; the wiring that behaviour cannot reach from here is asserted structurally (comments stripped).
import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Vec3 } from 'vec3'

const W = await import('../src/workbench.mjs')
const S = await import('../src/skills.mjs')
const { acquireFurnaceLease } = await import('../src/furnacelease.mjs')
let pass = 0, fail = 0
const t = async (name, fn) => { try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 4).join('\n        ')}`) } }

// the LIVE showcase record's fit-out (10-28 18:37Z complete): two furnaces, one table
const rec = { structure_complete: true, cells: [{ at: [22, 73, 30], role: 'light', seg: 'fit-out' }, { at: [23, 73, 30], role: 'furnace', seg: 'fit-out' },
  { at: [24, 73, 30], role: 'table', seg: 'fit-out' }, { at: [25, 73, 30], role: 'furnace', seg: 'fit-out' }, { at: [26, 73, 30], role: 'light', seg: 'fit-out' },
  { at: [21, 73, 28], role: 'wall', seg: 'wall-L' }] }

await t('workshopStations: a complete record names its fit-out furnaces and table; an incomplete or missing one names none', () => {
  const s = W.workshopStations(rec)
  assert.deepStrictEqual([...s.furnaces], ['23,73,30', '25,73,30'])
  assert.deepStrictEqual([...s.tables], ['24,73,30'])
  for (const r of [{ ...rec, structure_complete: false }, null, undefined, {}]) { const e = W.workshopStations(r); assert.strictEqual(e.furnaces.size + e.tables.size, 0) }
})
await t('preferWorkshop: preferred and usable first in given order, the rest in given order; no workshop -> unchanged; duplicates dropped', () => {
  const near = ['1,70,1', '2,70,2', '25,73,30', '23,73,30']
  const s = W.workshopStations(rec)
  assert.deepStrictEqual(W.preferWorkshop(near, k => k, s.furnaces), ['25,73,30', '23,73,30', '1,70,1', '2,70,2'])
  assert.deepStrictEqual(W.preferWorkshop(near, k => k, new Set()), near, 'a town with no workshop: exactly as before')
  assert.deepStrictEqual(W.preferWorkshop(near, k => k, null), near)
  assert.deepStrictEqual(W.preferWorkshop(near, k => k, s.furnaces, k => k !== '25,73,30'), ['23,73,30', '1,70,1', '2,70,2', '25,73,30'], 'an unusable workshop furnace keeps its old place')
  assert.deepStrictEqual(W.preferWorkshop(['a', 'b', 'a'], k => k, new Set(['a'])), ['a', 'b'])
  assert.deepStrictEqual(W.preferWorkshop([], k => k, s.furnaces), [])
})
await t('stationKind: w / o / - for the rows', () => {
  const s = W.workshopStations(rec)
  assert.strictEqual(W.stationKind('23,73,30', s.furnaces), 'w')
  assert.strictEqual(W.stationKind('-8,71,-7', s.furnaces), 'o')
  assert.strictEqual(W.stationKind('-', s.furnaces), '-')
  assert.strictEqual(W.stationKind(null, s.furnaces), '-')
  assert.strictEqual(W.stationKind('23,73,30', undefined), 'o')
})

// a fake world for pickLeasedFurnace (smelt_town's pick): furnaces at the given cells, lit as given
const world = (furnaces, lit = new Set()) => {
  const reg = { blocks: { 1: { name: 'furnace' }, 0: { name: 'air' } } }
  const at = new Map(furnaces.map(k => [k, true]))
  return {
    registry: reg, username: 'tester',
    entity: { position: new Vec3(0, 71, 0) },
    findBlocks: () => furnaces.map(k => { const [x, y, z] = k.split(',').map(Number); return new Vec3(x, y, z) }),
    blockAt: p => { const k = `${p.x},${p.y},${p.z}`; return at.has(k) ? { type: 1, position: p, getProperties: () => ({ lit: lit.has(k) }) } : null },
  }
}
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'workbench-'))
const ws = W.workshopStations(rec).furnaces
await t('pickLeasedFurnace: the workshop furnace over a nearer town one; lit -> the nearest; leased by another -> the next; no prefer -> nearest', () => {
  const near = '-8,71,-7'
  let r = S.pickLeasedFurnace(world([near, '23,73,30']), { dir: tmp(), prefer: ws })
  assert.strictEqual(`${r.block.position.x},${r.block.position.y},${r.block.position.z}`, '23,73,30')
  r = S.pickLeasedFurnace(world([near, '23,73,30'], new Set(['23,73,30'])), { dir: tmp(), prefer: ws })
  assert.strictEqual(`${r.block.position.x},${r.block.position.y},${r.block.position.z}`, near, 'lit: the old order')
  const d = tmp()
  assert.ok(acquireFurnaceLease(d, new Vec3(23, 73, 30), 'someone-else:1').ok)
  r = S.pickLeasedFurnace(world([near, '23,73,30', '25,73,30']), { dir: d, prefer: ws })
  assert.strictEqual(`${r.block.position.x},${r.block.position.y},${r.block.position.z}`, '25,73,30', 'busy: the other workshop furnace')
  r = S.pickLeasedFurnace(world([near, '23,73,30']), { dir: tmp() })
  assert.strictEqual(`${r.block.position.x},${r.block.position.y},${r.block.position.z}`, near, 'no workshop preference: nearest, as today')
})
await t('preferredNow / skipAfterRun: a failed or foreign-filled workshop run drops that furnace from the preference for 30 min', () => {
  const pref = W.workshopStations(rec).furnaces
  assert.deepStrictEqual([...W.preferredNow(pref, { '23,73,30': 2000 }, 1000)], ['25,73,30'])
  assert.deepStrictEqual([...W.preferredNow(pref, { '23,73,30': 2000 }, 2000)], ['23,73,30', '25,73,30'], 'lapsed')
  assert.strictEqual(W.preferredNow(null, {}, 0).size, 0)
  assert.strictEqual(W.skipAfterRun({ kind: 'w', status: 'failed' }), true, 'no_path / unreachable')
  assert.strictEqual(W.skipAfterRun({ kind: 'w', status: 'success', prior: 3 }), true, 'foreign contents')
  assert.strictEqual(W.skipAfterRun({ kind: 'w', status: 'success', prior: 0 }), false)
  assert.strictEqual(W.skipAfterRun({ kind: 'o', status: 'failed' }), false, 'never another furnace')
  // composed: the pick then takes the nearest one (pickLeasedFurnace with the reduced preference)
  const r = S.pickLeasedFurnace(world(['-8,71,-7', '23,73,30']), { dir: tmp(), prefer: W.preferredNow(pref, { '23,73,30': Date.now() + 60_000 }) })
  assert.strictEqual(`${r.block.position.x},${r.block.position.y},${r.block.position.z}`, '-8,71,-7')
})
await t('WIRED: mats candidates, smelt_town, the order\'s crafts and the craft table all read the workshop; the rows carry ws=', () => {
  const strip = src => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1')
  const SK = strip(fs.readFileSync(new URL('../src/skills.mjs', import.meta.url), 'utf8'))
  assert.ok(/return preferWorkshop\(near, f => f\.k, bot\.shopStations\?\.furnaces\)/.test(SK), 'matsFurnaceCandidates')
  assert.ok(/prefer: preferredNow\(bot\.shopStations\?\.furnaces, bot\.wsFurnaceSkip, Date\.now\(\)\), by: 'smelt_town'/.test(SK), 'smelt_town passes the preference less its skips')
  assert.ok(/if \(skipAfterRun\(\{ kind: f\.ws, status: r\.status, prior: /.test(SK) && /bot\.wsFurnaceSkip = \{ \.\.\.\(bot\.wsFurnaceSkip \?\? \{\}\), \[r\.furnace\]: Date\.now\(\) \+ WORKSHOP_SKIP_MS \}/.test(SK), 'a failed run skips it')
  assert.ok(/pickLeasedFurnace\(bot, \{ avoid: session\.opts\?\.avoid \?\? \(\(\) => false\), prefer: session\.opts\?\.prefer \?\? null \}\)/.test(SK), 'smelt hands it to the pick')
  assert.ok(/const cw = \{ \.\.\.ctx, preferWorkshop: true, stations: \{\} \}/.test(SK) && /f\.made = await matsCrafts\(cw, kind/.test(SK), 'the order\'s crafts')
  assert.ok(/const wsTables = ctx\.preferWorkshop \?/.test(SK) && /const tableTries = preferWorkshop\(\[\.\.\.wsTables, nearTable\]\.filter\(Boolean\)/.test(SK), 'craftLevel orders its tables')
  assert.ok(/if \(tableBlock !== tableTries\.at\(-1\) && bot\.entity\.position\.distanceTo\(tableBlock\.position\.offset\(0\.5, 0\.5, 0\.5\)\) > STATION_REACH\) continue/.test(SK), 'unreachable -> the nearest')
  assert.ok(/bot\.shopStations = workshopStations\(h\.head\?\.rec \?\? null\)/.test(SK), 'refreshed with the record')
  const M = fs.readFileSync(new URL('../src/mats.mjs', import.meta.url), 'utf8'), J = fs.readFileSync(new URL('../src/smeltjob.mjs', import.meta.url), 'utf8')
  assert.ok(M.includes("`ws=${v(f.wsF ?? '-')}/${v(f.wsT ?? '-')}`") && J.includes("`ws=${v(f.ws ?? '-')}`"))
})

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
