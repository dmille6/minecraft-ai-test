// villagefeed-01 (villagefeed.mjs; docs/reports/villagecon-2026-11-09/design.md): the feed's pure decisions.
// Behaviour: the villager reading (baby flag, sleeping, the default profession), the sightings and BIRTHS (a baby beside a fed adult
// is fed=1 and clears those adults to be fed again; a baby elsewhere is fed=0; a known baby never counts twice), the clusters (a lone
// adult is never fed; a fed cluster owes nothing; the hungriest first), the admission (night, the day cap, the wheat keep, the bag),
// the next target (hungry, awake, under the miss cap, nearest), the credit (whoever collected), the day's tosses.
// Structural (behaviour cannot reach it): the skill is registered with a contract, marketAsk asks it before the walk-in, the install
// logs its licence row. Mutants assert their anchor is present and unique.
import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'

process.env.LOG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-vfeed-logs-'))
const F = await import('../src/villagefeed.mjs')
let pass = 0, fail = 0
const t = async (name, fn) => { try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 3).join('\n        ')}`) } }
const SRC = new URL('../src/villagefeed.mjs', import.meta.url)
async function withMutant (url, old, neu, fn) {
  const src = readFileSync(url, 'utf8')
  assert.ok(src.includes(old), `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 60))}`)
  assert.ok(src.split(old).length === 2, 'ANCHOR MISSING OR NOT UNIQUE')
  const out = new URL(`./_mutant-vfeed-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, src.replace(old, neu).replace(/from '\.\//g, "from '../src/"))
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}
const E = (id, x, z, { baby = false, prof = null, sleeping = false, y = 73 } = {}) => ({ id, uuid: `u${id}`, name: 'villager', position: { x, y, z },
  metadata: { ...(baby ? { 16: true } : {}), ...(prof != null ? { 18: { villagerType: 0, villagerProfession: prof, level: 1 } } : {}), ...(sleeping ? { 6: 2 } : {}) } })
const HOME = { x: 0, y: 70, z: 0 }
const NOW = 1_000_000_000
// the 6_1 outdoor ring (4 adults) and the house ring (3), as the 11-09 census read them
const RING = [E(1, 81.8, -3.7), E(2, 80.3, -3.3), E(3, 81.0, -3.3), E(4, 82.4, -3.7), E(5, 87.3, 11.3), E(6, 88.0, 11.7), E(7, 87.4, 11.3)].map(F.villagerOf)

await t('villagerOf: a villager with no index 18 is the default (none); baby / sleeping read; another mob is null', () => {
  const v = F.villagerOf(E(1, 1, 2))
  assert.deepStrictEqual([v.uuid, v.baby, v.sleeping, v.profession], ['u1', false, false, 0])
  assert.strictEqual(F.villagerOf(E(2, 0, 0, { baby: true })).baby, true)
  assert.strictEqual(F.villagerOf(E(3, 0, 0, { sleeping: true })).sleeping, true)
  assert.strictEqual(F.villagerOf({ id: 9, name: 'cow', position: { x: 0, y: 0, z: 0 } }), null)
})

await t('clusters: the 6_1 rings (16 b apart) are ONE cluster of 7 owing 21; split rings are two, the hungrier first', () => {
  const { state } = F.noteVillagers(null, RING, NOW)
  assert.deepStrictEqual(F.feedClusters(state, HOME, NOW).map(c => [c.uuids.length, c.loaves]), [[7, 21]])
  const far = RING.map((v, i) => (i >= 4 ? { ...v, z: v.z + 30 } : v))
  const { state: s2 } = F.noteVillagers(null, far, NOW)
  assert.deepStrictEqual(F.feedClusters(s2, HOME, NOW).map(c => [c.uuids.length, c.loaves]), [[4, 12], [3, 9]])
})

await t('clusters: a LONE adult is never fed (it cannot breed); a stale sighting or one beyond the radius is not planned', () => {
  const { state } = F.noteVillagers(null, [F.villagerOf(E(1, 30, 30)), F.villagerOf(E(2, 300, 0)), F.villagerOf(E(3, 302, 1))], NOW)
  assert.deepStrictEqual(F.feedClusters(state, HOME, NOW), [], 'lone at 42 b; a pair at 300 b (> radius 160)')
  const { state: s2 } = F.noteVillagers(null, RING.slice(0, 2), NOW - F.FEED.freshMs - 1)
  assert.deepStrictEqual(F.feedClusters(s2, HOME, NOW), [], 'sightings older than freshMs')
})

await t('clusters: a cluster whose adults each hold 3 loaves owes nothing; a half-fed one owes the rest', () => {
  let { state } = F.noteVillagers(null, RING.slice(0, 2), NOW)
  for (let i = 0; i < 3; i++) state = F.creditLoaf(state, 'u1', NOW)
  assert.deepStrictEqual(F.feedClusters(state, HOME, NOW).map(c => c.loaves), [3])
  for (let i = 0; i < 3; i++) state = F.creditLoaf(state, 'u2', NOW)
  assert.deepStrictEqual(F.feedClusters(state, HOME, NOW), [])
})

await t('mutant: the lone-adult floor removed -> a lone adult is planned (killed)', async () => {
  await withMutant(SRC, '    if (g.length < minAdults) continue\n', '', async M => {
    const { state } = M.noteVillagers(null, [M.villagerOf(E(1, 30, 30))], NOW)
    assert.strictEqual(M.feedClusters(state, HOME, NOW).length, 1)
  })
})

await t('BIRTH: a new baby within birthR of a fed adult -> fed=1, and the adults within refeedR are hungry again', () => {
  let { state } = F.noteVillagers(null, RING.slice(0, 4), NOW)
  for (const u of ['u1', 'u2', 'u3', 'u4']) for (let i = 0; i < 3; i++) state = F.creditLoaf(state, u, NOW)
  assert.deepStrictEqual(F.feedClusters(state, HOME, NOW), [], 'all fed')
  const r = F.noteVillagers(state, [...RING.slice(0, 4), F.villagerOf(E(50, 81, -3, { baby: true }))], NOW + 60_000)
  assert.deepStrictEqual(r.births.map(b => [b.uuid, b.fed, b.near]), [['u50', true, 4]])
  assert.strictEqual(F.feedClusters(r.state, HOME, NOW + 60_000)[0].loaves, 12, 'the parents ate: owed again')
  const again = F.noteVillagers(r.state, [F.villagerOf(E(50, 81, -3, { baby: true }))], NOW + 120_000)
  assert.deepStrictEqual(again.births, [], 'a known baby never counts twice')
})

await t('BIRTH control: a baby far from any fed adult is fed=0 (and clears nobody); a baby with no fed adult anywhere is fed=0', () => {
  let { state } = F.noteVillagers(null, RING.slice(0, 2), NOW)
  for (let i = 0; i < 3; i++) state = F.creditLoaf(state, 'u1', NOW)
  const r = F.noteVillagers(state, [F.villagerOf(E(60, -100, 50, { baby: true }))], NOW + 1000)
  assert.deepStrictEqual(r.births.map(b => [b.fed, b.near]), [[false, 0]])
  assert.strictEqual(r.state.fed.u1.n, 3)
})

await t('mutant: refeed cleared for every fed adult, not only those beside the baby (killed)', async () => {
  await withMutant(SRC, 'if (Math.hypot(seen[u].x - v.x, seen[u].z - v.z) <= refeedR) fed[u]', 'if (true) fed[u]', async M => {
    let { state } = M.noteVillagers(null, [M.villagerOf(E(1, 80, 0)), M.villagerOf(E(2, 100, 0))], NOW)
    state = M.creditLoaf(M.creditLoaf(M.creditLoaf(state, 'u2', NOW), 'u2', NOW), 'u2', NOW)
    state = M.creditLoaf(M.creditLoaf(M.creditLoaf(state, 'u1', NOW), 'u1', NOW), 'u1', NOW)
    const r = M.noteVillagers(state, [M.villagerOf(E(9, 80, 2, { baby: true }))], NOW + 1)
    assert.strictEqual(r.state.fed.u2.n, 0, 'under the mutant u2 (20 b away) is cleared; the real code keeps it at 3 (next test)')
  })
  let { state } = F.noteVillagers(null, [F.villagerOf(E(1, 80, 0)), F.villagerOf(E(2, 100, 0))], NOW)
  for (const u of ['u1', 'u2']) for (let i = 0; i < 3; i++) state = F.creditLoaf(state, u, NOW)
  const r = F.noteVillagers(state, [F.villagerOf(E(9, 80, 2, { baby: true }))], NOW + 1)
  assert.deepStrictEqual([r.state.fed.u1.n, r.state.fed.u2.n], [0, 3], 'u1 beside the baby ate; u2 at 20 b did not')
})

const ADM = { on: true, atTown: true, now: NOW, timeOfDay: 3000, health: 20, freeSlots: 20, clusters: [{ x: 81, z: -3, uuids: ['u1', 'u2'], loaves: 6 }], bagBread: 0, bagWheat: 0, townWheat: 195, tossed: 0 }
await t('admit: day, wheat above the keep -> go, make = the cluster\'s loaves (6), bag bread first', () => {
  assert.deepStrictEqual([F.feedAdmit(ADM).ok, F.feedAdmit(ADM).make], [true, 6])
  assert.strictEqual(F.feedAdmit({ ...ADM, bagBread: 4 }).make, 2)
})
await t('admit refusals: night, cooldown, the day cap, no hungry cluster, leased, the bag', () => {
  assert.strictEqual(F.feedAdmit({ ...ADM, timeOfDay: 13000 }).why, 'night')
  assert.strictEqual(F.feedAdmit({ ...ADM, lastRunAt: NOW - 60_000 }).why, 'cooldown')
  assert.strictEqual(F.feedAdmit({ ...ADM, tossed: F.FEED.townPerDay }).why, 'day_cap')
  assert.strictEqual(F.feedAdmit({ ...ADM, clusters: [] }).why, 'no_hungry')
  assert.strictEqual(F.feedAdmit({ ...ADM, leased: true }).why, 'leased')
  assert.strictEqual(F.feedAdmit({ ...ADM, freeSlots: 2 }).why, 'bag')
})
await t('admit: the WHEAT KEEP -- town wheat 50 (keep 48) makes no loaf -> no_wheat; 57 makes 3 -> go with 3', () => {
  assert.strictEqual(F.feedAdmit({ ...ADM, townWheat: 50 }).why, 'no_wheat')
  const a = F.feedAdmit({ ...ADM, townWheat: 57 })
  assert.deepStrictEqual([a.ok, a.make], [true, 3])
})
await t('admit: the day cap bounds the run (22 tossed today -> want 2)', () => {
  assert.strictEqual(F.feedAdmit({ ...ADM, tossed: 22 }).want, 2)
})
await t('mutant: the wheat keep ignored -> a town at 50 wheat would be drawn (killed)', async () => {
  await withMutant(SRC, 'Math.max(0, townWheat - FEED.wheatKeep)', 'Math.max(0, townWheat)', async M => {
    assert.strictEqual(M.feedAdmit({ ...ADM, townWheat: 50 }).ok, true)
  })
})

await t('nextTarget: the nearest HUNGRY awake adult of the run; a fed one, a baby, a sleeper, one at the miss cap are skipped', () => {
  let { state } = F.noteVillagers(null, RING.slice(0, 4), NOW)
  for (let i = 0; i < 3; i++) state = F.creditLoaf(state, 'u2', NOW)
  const vs = [...RING.slice(0, 4), F.villagerOf(E(8, 80.5, -3.5, { baby: true })), F.villagerOf(E(9, 80.4, -3.4, { sleeping: true }))]
  const from = { x: 80, z: -3.3 }
  assert.strictEqual(F.nextTarget(vs, state, from).uuid, 'u3', 'u2 (nearest) is fed; the baby and the sleeper skipped')
  assert.strictEqual(F.nextTarget(vs, state, from, { misses: { u3: F.FEED.missMax } }).uuid, 'u1')
  assert.strictEqual(F.nextTarget(vs, state, from, { uuids: ['u4'] }).uuid, 'u4', 'only the run\'s cluster')
})

await t('nextTarget: a hungry adult standing CLEAR of the others (>= clearR) before a nearer one in a huddle', () => {
  const vs = [F.villagerOf(E(1, 10, 0)), F.villagerOf(E(2, 11, 0)), F.villagerOf(E(3, 20, 5))]
  const { state } = F.noteVillagers(null, vs, NOW)
  assert.strictEqual(F.nextTarget(vs, state, { x: 9, z: 0 }).uuid, 'u3', 'u1/u2 huddle 1 b apart; u3 stands clear')
  assert.strictEqual(F.isolation(vs[2], vs), Math.hypot(9, 5))
})

await t('tossStand: on the target\'s far side from its nearest neighbour; with none near, back along the approach', () => {
  const tgt = { uuid: 'a', x: 10, z: 0 }
  const p = F.tossStand(tgt, [tgt, { uuid: 'b', x: 11.5, z: 0 }, { uuid: 'c', x: 30, z: 0 }], { x: 0, z: 0 })
  assert.ok(Math.abs(p.x - 8.4) < 1e-9 && Math.abs(p.z) < 1e-9, JSON.stringify(p))
  const q = F.tossStand(tgt, [tgt], { x: 10, z: 20 })
  assert.ok(Math.abs(q.x - 10) < 1e-9 && Math.abs(q.z - 1.6) < 1e-9, JSON.stringify(q))
})

await t('credit: a loaf counts for whoever collected it (the neighbour too); tosses kept for the day cap only 24 h', () => {
  let s = F.creditLoaf(null, 'u7', NOW)
  s = F.creditLoaf(s, 'u7', NOW)
  assert.strictEqual(s.fed.u7.n, 2)
  assert.deepStrictEqual(F.creditLoaf(s, null, NOW), F.feedState(s), 'no collector: no credit')
  s = F.noteTosses(F.noteTosses(s, 5, NOW - 25 * 3600_000), 4, NOW)
  assert.strictEqual(F.tossedToday(s, NOW), 4)
})

await t('BED ROOM: 6_1 as counted (5 beds, 7 villagers) is no room; a cluster counted with no room is not fed for roomTtl', () => {
  assert.strictEqual(F.bedRoom({ beds: 5, villagers: 7 }), -2)
  assert.strictEqual(F.bedRoom({ beds: 3, villagers: 2 }), 1)
  let st = F.noteRoom(null, { x: 81, z: -3 }, { beds: 5, villagers: 7 }, NOW)
  assert.strictEqual(F.roomOf(st, { x: 85, z: 2 }, NOW + 1000).room, -2, 'a centre within roomR reads the count')
  assert.strictEqual(F.roomOf(st, { x: 81, z: -3 }, NOW + F.FEED.roomTtlMs + 1), null, 'stale after roomTtl')
  assert.strictEqual(F.feedAdmit({ ...ADM, state: st }).why, 'no_bed_room')
  st = F.noteRoom(st, { x: 81, z: -3 }, { beds: 8, villagers: 7 }, NOW + 2000)
  assert.strictEqual(F.feedAdmit({ ...ADM, state: st, now: NOW + 3000 }).ok, true, 'the newest count wins')
})
await t('BED ROOM: with wool in town a no-room cluster is visited with beds (1 - room, at most bedsPerRun) of the town\'s plenty colour', () => {
  const st = F.noteRoom(null, { x: 81, z: -3 }, { beds: 5, villagers: 7 }, NOW)
  assert.strictEqual(F.bedWool({ white_wool: 4, red_wool: 9, blue_wool: 2 }), 'red_wool')
  assert.strictEqual(F.bedWool({ white_wool: 2 }), null)
  const a = F.feedAdmit({ ...ADM, state: st, wool: 'red_wool' })
  assert.deepStrictEqual([a.ok, a.beds, a.wool], [true, 2, 'red_wool'])
  const fresh = F.feedAdmit({ ...ADM, state: null, wool: 'red_wool' })
  assert.deepStrictEqual([fresh.beds, fresh.wool], [0, null], 'an uncounted cluster brings no bed')
})
await t('mutant: the room memo ignored -> 6_1 (no room) would be fed (killed)', async () => {
  await withMutant(SRC, '.find(({ r }) => !r || r.room > 0 || wool)', '.find(() => true)', async M => {
    const st = M.noteRoom(null, { x: 81, z: -3 }, { beds: 5, villagers: 7 }, NOW)
    assert.strictEqual(M.feedAdmit({ ...ADM, state: st }).ok, true)
  })
})

await t('feedState: a corrupt file reads empty, never throws', () => {
  assert.deepStrictEqual(F.feedState('x'), { seen: {}, fed: {}, babies: {}, tosses: [], rooms: {} })
  assert.deepStrictEqual(F.feedState({ seen: [], fed: null, tosses: [{ at: 'x' }] }).tosses, [])
})

await t('vfUpdate: two bots (processes) updating the town file at once lose no update (Codex r1 BLOCKER 1)', async () => {
  const { spawn } = await import('node:child_process')
  const pool = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-vfeed-pool-'))
  const env = { ...process.env, POOL_STATE_DIR: pool, MEMORY_POOL: 'vfhammer', BOT_NAME: 'Hammer', OLLAMA_MODEL: 'none', HOME_X: '0', HOME_Y: '70', HOME_Z: '0', LOG_LEVEL: 'error' }
  const run = name => new Promise((res, rej) => {
    const c = spawn(process.execPath, [new URL('./fixtures/vfeed-hammer.mjs', import.meta.url).pathname, '40'], { env: { ...env, BOT_NAME: name }, stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''; c.stdout.on('data', d => { out += d }); c.on('exit', () => res(+(out.match(/OK (\d+)/)?.[1] ?? -1))); c.on('error', rej)
  })
  const [a, b] = await Promise.all([run('HamA'), run('HamB')])
  const files = []
  const walk = d => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (/^villagefeed-.*\.json$/.test(e.name)) files.push(p) } }
  walk(pool)
  assert.strictEqual(files.length, 1, `one town file: ${files}`)
  const tosses = JSON.parse(fs.readFileSync(files[0], 'utf8')).tosses.length
  assert.ok(a >= 30 && b >= 30, `both wrote most of their 40: ${a} ${b}`)
  assert.strictEqual(tosses, a + b, `every applied update is in the file (${a} + ${b})`)
})

// ---- structural (behaviour cannot reach the registration and the ask's order) -------------------------------------------------
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
const SK = strip(readFileSync(new URL('../src/skills.mjs', import.meta.url), 'utf8'))
await t('structural: village_feed registered (SKILLS + contract, chatOnly), asked before the walk-in, licence row at install', () => {
  assert.match(SK, /village_feed: \{ run: villageFeed, usage: 'village_feed', args: \[\], chatOnly: true \}/)
  assert.match(SK, /village_feed: \{ expects: \['position', 'inventory_loss'\], maxMs: 180_000 \}/)
  const ask = SK.indexOf("return { order: { skill: 'village_feed'"), walk = SK.indexOf("return { order: { skill: 'market_trip'")
  assert.ok(ask > 0 && walk > ask, 'the feed ask precedes the walk-in')
  assert.match(SK, /kind: 'villagefeed_mode'/)
  // every write of the town file goes through the mutex (Codex r2: no unlocked fallback): vfWrite is defined once and called once, inside vfUpdate
  assert.match(SK, /function vfWrite \(s\)/)
  assert.strictEqual(SK.split('vfWrite(').length - 1, 1, 'vfWrite: called once, inside vfUpdate')
  assert.match(SK, /const next = fn\(vfRead\(\)\); vfWrite\(next\)/)
  assert.match(SK, /bot\.on\?\.\('playerCollect', onCollect\)[\s\S]{0,6000}bot\.removeListener\?\.\('playerCollect', onCollect\)/)
})

console.log(`\nvillagefeed: ${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
