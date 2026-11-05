// jobsite-01 ("make jobs"): jobsite.mjs's pure decisions on block grids shaped like a village edge, and the wiring into the
// trade trip (structural, comment-stripped, mutants).
import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
process.env.LOG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-job-logs-'))
process.env.BOT_NAME = 'JobBot'
process.env.OLLAMA_MODEL ??= 'qwen2.5:7b-instruct'
process.env.POOL_STATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-job-pool-'))
const J = await import('../src/jobsite.mjs')
let pass = 0, fail = 0
const t = async (name, fn) => { try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 3).join('\n        ')}`) } }
const V = (uuid, x, z, profession = 'none', extra = {}) => ({ uuid, x: x + 0.5, y: 64, z: z + 0.5, profession, baby: false, ...extra })
// a flat grass world at y 63 (feet 64), with overrides { 'x,y,z': name }
const world = (over = {}) => (x, y, z) => { const k = `${x},${y},${z}`; if (k in over) return { name: over[k] }; return { name: y < 64 ? 'grass_block' : 'air' } }

await t('unemployedClusters: jobless adults only, grouped within 16 b, biggest first', () => {
  const c = J.unemployedClusters([V('a', 0, 0), V('b', 5, 0), V('c', 100, 0), V('d', 2, 2, 'farmer'), V('e', 1, 1, 'none', { baby: true }), V('f', 104, 3)])
  assert.deepEqual(c.map(g => [g.n, g.uuids.sort().join('')]), [[2, 'ab'], [2, 'cf']])
  assert.deepEqual(J.unemployedClusters([V('d', 2, 2, 'farmer'), V('n', 0, 0, 'nitwit')]), [], 'POSITIVE: employed villagers and nitwits are no cluster')
})

await t('jobsiteAdmit: the day cap, one per cluster (32 b), the town iron keep (64)', () => {
  const now = 1e9
  assert.deepEqual(J.jobsiteAdmit({ ledger: [], now, at: { x: 0, z: 0 }, townIron: 65 }), { ok: true, why: 'go' })
  assert.equal(J.jobsiteAdmit({ ledger: [{ x: 500, z: 0, at: now - 1000 }, { x: 900, z: 0, at: now - 2000 }], now, at: { x: 0, z: 0 }, townIron: 99 }).why, 'day_cap')
  assert.equal(J.jobsiteAdmit({ ledger: [{ x: 500, z: 0, at: now - 25 * 3600_000 }, { x: 900, z: 0, at: now - 26 * 3600_000 }], now, at: { x: 0, z: 0 }, townIron: 99 }).ok, true, 'yesterday does not count')
  assert.equal(J.jobsiteAdmit({ ledger: [{ x: 20, z: 0, at: 0 }], now, at: { x: 0, z: 0 }, townIron: 99 }).why, 'cluster_done')
  assert.equal(J.jobsiteAdmit({ ledger: [], now, at: { x: 0, z: 0 }, townIron: 64 }).why, 'iron_keep')
  assert.equal(J.jobsiteAdmit({ ledger: [], now, at: { x: 0, z: 0 }, townIron: 0, haveBlock: true }).ok, true, 'a stonecutter already carried needs no iron')
})

await t('pickJobCell: open grass beside the villagers; never on the villager, a path, beside a door / bed / chest / job site; one reachable side', () => {
  const cl = J.unemployedClusters([V('a', 0, 0)])[0]
  const p = J.pickJobCell(world(), cl)
  assert.ok(p.cell, JSON.stringify(p))
  assert.ok(p.d >= 1.5 && p.d <= J.JOB.near, `${p.d}`)
  assert.equal(p.cell.y, 64)
  // everything near the villager is dirt_path at the floor: no cell
  const paths = {}; for (let x = -6; x <= 6; x++) for (let z = -6; z <= 6; z++) paths[`${x},63,${z}`] = 'dirt_path'
  assert.equal(J.pickJobCell(world(paths), cl).cell, null, 'never on a village path')
  // a door beside the first choice pushes the cell away from it
  const first = p.cell
  const door = { [`${first.x + 1},64,${first.z}`]: 'oak_door', [`${first.x + 1},65,${first.z}`]: 'oak_door' }
  const p2 = J.pickJobCell(world(door), cl)
  assert.ok(p2.cell && !(Math.abs(p2.cell.x - (first.x + 1)) <= 1 && Math.abs(p2.cell.z - first.z) <= 1), 'nothing beside a door')
  for (const blk of ['red_bed', 'chest', 'composter', 'lectern', 'bell']) {
    const p3 = J.pickJobCell(world({ [`${first.x},64,${first.z + 1}`]: blk }), cl)
    assert.ok(p3.cell && !(p3.cell.x === first.x && p3.cell.z === first.z), `not beside ${blk}`)
  }
  assert.equal(J.pickJobCell(world({ [`${first.x},64,${first.z}`]: 'oak_planks' }), cl).cell?.x === first.x && J.pickJobCell(world({ [`${first.x},64,${first.z}`]: 'oak_planks' }), cl).cell?.z === first.z, false, 'an occupied cell is never chosen (no block is broken)')
  assert.equal(J.pickJobCell(world(), cl, { existing: [{ x: 10, z: 0 }] }).why, 'jobsite_near', 'a stonecutter already within 32 b: none')
  assert.equal(J.pickJobCell(() => null, cl).why, 'unloaded')
})

await t('claimOf: a cluster member with a profession now', () => {
  const cl = J.unemployedClusters([V('a', 0, 0), V('b', 3, 0)])[0]
  assert.equal(J.claimOf(cl, [V('a', 0, 0), V('b', 3, 0, 'mason')]), 'claimed:mason')
  assert.equal(J.claimOf(cl, [V('a', 0, 0), V('z', 3, 0, 'mason')]), 'unclaimed')
})

await t('STRUCTURAL: the trade trip places once per trip at the village, and crafts the stonecutter in the stock step; mutants fail', () => {
  const src = fs.readFileSync(new URL('../src/skills.mjs', import.meta.url), 'utf8')
  const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map(l => l.replace(/(^|[^:'"`])\/\/.*$/, '$1')).join('\n')
  const A1 = "if (trip.jobsite && !trip.jobsiteTried && bagCount(bot, JOB.block) > 0) { trip.jobsiteTried = true; await placeJobsite(ctx, near, signal) }"
  const A2 = "if (bagCount(bot, 'iron_ingot') >= 1 && bagCount(bot, 'stone') >= 3) await craft(ctx, { item: JOB.block, count: 1 }, signal)"
  const A3 = "if (JOBSITE_ON.on && masons < 2 && ironOk && day.ok) { bot.tradeTrip.jobsite = true; bot.tradeTrip.phase = 'stock' }"
  for (const a of [A1, A2, A3]) {
    assert.equal(src.split(a).length - 1, 1, 'ANCHOR MISSING OR NOT UNIQUE: ' + a.slice(0, 50))
    assert.ok(strip(src).includes(a))
    assert.equal(strip(src.replace(a, '// ' + a)).includes(a), false, 'mutant (commented out) must fail')
  }
})

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
