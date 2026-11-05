// trading-scout-01 (merchantscout.mjs): the read-only merchant sightings + XP rows. Behaviour: the pure functions on entity
// tables shaped like the ones mineflayer 4.37 builds on Paper 1.21.8 (metadata index 18 = { villagerType, villagerProfession,
// level }, sandbox4 2026-11-03), then the installed tick on a fake bot through the logger's record tap. One structural fact
// behaviour cannot reach: installFeatures calls the install (mutant-proved).
import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

process.env.LOG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-scout-logs-'))
process.env.BOT_NAME = 'ScoutBot'
process.env.OLLAMA_MODEL ??= 'qwen2.5:7b-instruct'
process.env.POOL_STATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-scout-pool-'))

const M = await import('../src/merchantscout.mjs')
const { tapRecords } = await import('../src/logger.mjs')
let pass = 0, fail = 0
const t = async (name, fn) => { try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 3).join('\n        ')}`) } }
const V = (id, name, x, z, md = {}) => { const m = []; for (const [k, v] of Object.entries(md)) m[+k] = v; return { id, uuid: `u-${id}`, name, position: { x, y: 64, z }, metadata: m } }
const vd = (p, level = 1) => ({ 18: { villagerType: 3, villagerProfession: p, level } })
const HERE = { x: 0, y: 64, z: 0 }

await t('the profession table is the 1.21 registry order the sandbox proved (1 armorer, 5 farmer, 8 leatherworker, 14 weaponsmith)', () => {
  assert.equal(M.PROFESSIONS.length, 15)
  assert.deepEqual([0, 1, 5, 8, 9, 11, 13, 14].map(i => M.PROFESSIONS[i]), ['none', 'armorer', 'farmer', 'leatherworker', 'librarian', 'nitwit', 'toolsmith', 'weaponsmith'])
})

await t('sightings: villagers and wandering traders within the radius, nearest first, profession decoded; others ignored', () => {
  const ents = { 1: V(1, 'villager', 10, 0, vd(13, 2)), 2: V(2, 'wandering_trader', 3, 4), 3: V(3, 'cow', 1, 1), 4: V(4, 'villager', 100, 0, vd(5)), 5: V(5, 'villager', 0, 20, { 16: true, ...vd(0) }) }
  const s = M.merchantSightings(ents, HERE)
  assert.deepEqual(s.map(x => [x.uuid, x.profession, x.level]), [['u-2', 'wandering_trader', null], ['u-1', 'toolsmith', 2], ['u-5', 'none', 1]])
  assert.equal(s[2].baby, true)
  assert.equal(s[0].dist, 5)
  // POSITIVE CONTROL for the radius: the far farmer IS seen with a wider one
  assert.equal(M.merchantSightings(ents, HERE, { radius: 200 }).some(x => x.profession === 'farmer'), true)
  assert.deepEqual(M.merchantSightings(ents, null), [], 'no position -> nothing')
})

await t('a villager with NO villager_data is the default (plains, none, level 1: the server omits defaults; sandbox4 11-05), never employed; tradesPossible follows the profession', () => {
  const [u] = M.merchantSightings({ 1: V(1, 'villager', 1, 1) }, HERE)
  assert.equal(u.profession, 'none')
  assert.equal(u.level, 1)
  assert.equal(M.tradesPossible(u), false)
  const [w] = M.merchantSightings({ 1: V(1, 'wandering_trader', 1, 1) }, HERE)
  assert.equal(w.profession, 'wandering_trader', 'POSITIVE: a trader is unaffected')
  const [bad] = M.merchantSightings({ 1: V(1, 'villager', 1, 1, { 18: { villagerType: 3, level: 1 } }) }, HERE)
  assert.equal(bad.profession, 'unknown', 'villager_data present but no profession field: still unknown')
  const rows = M.merchantSightings({ 1: V(1, 'villager', 1, 1, vd(9)), 2: V(2, 'villager', 2, 2, vd(11)), 3: V(3, 'villager', 3, 3, vd(0)), 4: V(4, 'wandering_trader', 4, 4) }, HERE)
  assert.deepEqual(rows.map(M.tradesPossible), [true, false, false, true])
})

await t('dueRows: first sight, a changed profession/level, the refresh; nothing in between; capped per scan', () => {
  const seen = new Map()
  const a = M.merchantSightings({ 1: V(1, 'villager', 1, 1, vd(0)) }, HERE)
  assert.deepEqual(M.dueRows(seen, a, 0).map(r => r.why), ['new'])
  assert.deepEqual(M.dueRows(seen, a, 60_000).map(r => r.why), [], 'unchanged within the refresh: no row')
  const b = M.merchantSightings({ 1: V(1, 'villager', 1, 1, vd(13)) }, HERE)
  assert.deepEqual(M.dueRows(seen, b, 120_000).map(r => [r.why, r.profession]), [['changed', 'toolsmith']], 'took a job: a row')
  assert.deepEqual(M.dueRows(seen, b, 120_000 + M.REFRESH_MS).map(r => r.why), ['refresh'])
  const many = {}; for (let i = 0; i < 20; i++) many[i] = V(100 + i, 'villager', i, 0, vd(5))
  assert.equal(M.dueRows(new Map(), M.merchantSightings(many, HERE), 0).length, M.MAX_ROWS_PER_SCAN)
})

await t('the installed tick writes the mode row, one _merchant_seen per due merchant with its zone, and an _xp row; MERCHANTSCOUT=off writes only on=0', async () => {
  const recs = []; const untap = tapRecords(r => recs.push(r))
  const handlers = {}
  const bot = { username: 'ScoutBot', entity: { position: HERE }, entities: { 1: V(1, 'villager', 5, 5, vd(9)), 2: V(2, 'villager', 30, 0, vd(0)) },
    experience: { level: 7, points: 3, progress: 0.25 }, inventory: { items: () => [], slots: [] }, once: (ev, f) => { handlers[ev] = f } }
  let clock = 1_000_000
  // the shape features.mjs really passes: townPlanZones(bot).zones = [{ id, box: [x0,y0,z0,x1,y1,z1] }]
  const zones = [{ id: 'village-x', box: [20, 0, -10, 40, 100, 10] }]
  const h = M.merchantScoutInstall(bot, { env: {}, zonesOf: () => zones, now: () => clock, every: 1e9 })
  const kinds = () => recs.map(r => r.skill?.name)
  assert.deepEqual(kinds(), ['_merchantscout_mode'])
  assert.match(recs[0].skill.detail, /^on=1 /)
  h.tick()
  const seen = recs.filter(r => r.skill?.name === '_merchant_seen')
  assert.equal(seen.length, 2)
  assert.match(seen[0].skill.detail, /^villager librarian L1 at 5,64,5 .*trades=yes zone=none why=new$/)
  assert.match(seen[1].skill.detail, /villager none L1 at 30,64,0 .*trades=no zone=village-x why=new$/)
  assert.equal(seen[1].skill.args.zone, 'village-x')
  const xp = recs.filter(r => r.skill?.name === '_xp')
  assert.equal(xp.length, 1); assert.equal(xp[0].skill.detail, 'level=7 points=3 progress=0.3')
  clock += 60_000; h.tick()
  assert.equal(recs.length, 4, 'a minute later: nothing new, no second _xp row')
  clock += M.XP_EVERY_MS; h.tick()
  assert.equal(recs.filter(r => r.skill?.name === '_xp').length, 2)
  h.stop(); handlers.end?.()
  recs.length = 0
  assert.equal(M.merchantScoutInstall(bot, { env: { MERCHANTSCOUT: 'off' }, every: 1e9 }), null)
  assert.deepEqual(kinds(), ['_merchantscout_mode']); assert.match(recs[0].skill.detail, /^on=0 /)
  untap()
})

await t('zoneIdAt: both zone shapes (townPlanZones {id, box} and parsed x0..z1); outside -> null', () => {
  assert.equal(M.zoneIdAt([{ id: 'v', box: [49, -64, -59, 157, 90, 45] }], 80.3, 73, -3.7), 'v')
  assert.equal(M.zoneIdAt([{ id: 'v', box: [49, -64, -59, 157, 90, 45] }], 48.9, 73, 0), null)
  assert.equal(M.zoneIdAt([{ id: 'p', x0: 0, y0: 0, z0: 0, x1: 5, y1: 5, z1: 5 }], 5.9, 5, 0), 'p')
  assert.equal(M.zoneIdAt(null, 1, 1, 1), null)
})

await t('a throwing zone reader or a missing experience never throws out of the tick', () => {
  const bot = { entity: { position: HERE }, entities: { 1: V(1, 'villager', 1, 1, vd(4)) }, inventory: { items: () => [], slots: [] } }
  const h = M.merchantScoutInstall(bot, { env: {}, zonesOf: () => { throw new Error('boom') }, every: 1e9 })
  assert.equal(h.tick().length, 1)
  h.stop()
})

// STRUCTURAL: installFeatures runs the install on its executable path (comments stripped); a mutant without the call fails
await t('STRUCTURAL: features.mjs installFeatures calls merchantScoutInstall (mutant: the call removed -> the assertion fails)', () => {
  const src = fs.readFileSync(new URL('../src/features.mjs', import.meta.url), 'utf8')
  const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map(l => l.replace(/(^|[^:'"`])\/\/.*$/, '$1')).join('\n')
  const body = s => { const i = s.indexOf('export function installFeatures'); assert.ok(i >= 0, 'installFeatures present'); return s.slice(i) }
  const wired = s => /\n\s*try \{ merchantScoutInstall\(bot, \{ zonesOf: b => townPlanZones\(b\)\.zones \}\) \}/.test(body(strip(s)))
  assert.equal(wired(src), true)
  const anchor = "try { merchantScoutInstall(bot, { zonesOf: b => townPlanZones(b).zones }) }"
  assert.equal(src.split(anchor).length - 1, 1, 'ANCHOR MISSING OR NOT UNIQUE')
  assert.equal(wired(src.replace(anchor, 'try { }')), false, 'mutant (call removed) must fail')
  assert.equal(wired(src.replace(anchor, '// ' + anchor)), false, 'mutant (call commented out) must fail')
})

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
