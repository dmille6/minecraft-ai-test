// FLEETPATHS-01 (zigfleet-02's fleet rollout, 11-01 01:42Z on: every fleet paths visit ended `site_unread ... no_path_network
// (unrouted: ...:unreachable)` and no fleet town ever reached its wall, which waits on the paths). Measured on the 16 fleet towns'
// region copies (bots/scripts/pathsite-offline.mjs): every town's composter stands INSIDE its core plaza (cluttered with chests,
// furnaces and torches, so no 2-wide leg reaches its sides), and the ground round the plaza is pillared and pitted (34-40% of
// 4-adjacent ground columns differ by 2+, 9-17% by 5+; the showcase: 14% by 2+). The fix: a destination inside the hub is served
// by the plaza (no leg); a siting that fails on READ ground writes a NO-SITE record once for the town (complete: the order moves
// on and the wall may start; re-sited after 24 h); an unread column met keeps the old `site_unread`. FLEETPATHS=off is the rollback.
// Pure: buildfake's flat world (stone below G, grass at G) with cells set per scene.
import assert from 'node:assert'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
const { G, server, plan } = await import('./helpers/buildfake.mjs')
const P = await import('../src/paths.mjs')
const SHOPM = await import('../src/shop.mjs')
const { placeBlueprint } = await import('../src/buildsite.mjs')

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 5).join('\n        ')}`) }
}
const PATHS_PATH = new URL('../src/paths.mjs', import.meta.url)
const SKILLS_PATH = new URL('../src/skills.mjs', import.meta.url)
async function withMutant (path, old, neu, fn) {
  const src = readFileSync(path, 'utf8')
  assert.ok(src.includes(old), `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 60))} is not in ${path.pathname}`)
  assert.ok(src.split(old).length === 2, 'ANCHOR NOT UNIQUE: the mutant is ambiguous')
  const body = src.replace(old, neu).replace(/from '\.\//g, "from '../src/")
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, body)
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}
const CORE = [-6, -6, 6, 6]
const corePlan = () => ({ ...plan(), plots: [{ id: 'core', kind: 'plaza', box: CORE, keepout: false }] })
/** A fleet plaza: the composter inside the core, every other plaza cell a chest (furniture refuses its column). */
const clutteredPlaza = () => {
  const srv = server()
  for (let x = CORE[0]; x <= CORE[2]; x++) for (let z = CORE[1]; z <= CORE[3]; z++) if (!(x === 0 && z === 0)) srv.set([x, G + 1, z], 'chest')
  srv.set([0, G + 1, 0], 'composter')
  return srv
}

console.log('A DESTINATION INSIDE THE HUB (every fleet town: the composter in the plaza)')
await t('atHub: inside the core box (its edge included) only -- a column beside it is not (the showcase\'s chest stands keep their legs)', async () => {
  assert.strictEqual(P.atHub(CORE, [[0, 0]]), true)
  assert.strictEqual(P.atHub(CORE, [[6, -6]]), true, 'the edge is inside')
  assert.strictEqual(P.atHub(CORE, [[7, 0]]), false, 'beside the edge is outside')
  assert.strictEqual(P.atHub(CORE, [[20, 20], [0, 1]]), true, 'any column of the set')
  assert.strictEqual(P.atHub(CORE, []), false)
})
await t('sitePaths: a composter in a cluttered plaza is served by the hub; the well\'s leg is laid (control: hubDests off -> farm unreachable)', async () => {
  const srv = clutteredPlaza()
  const o = { plan: corePlan(), caps: [[5, G + 1, 20]], composter: [0, G + 1, 0], place: placeBlueprint }
  const s = P.sitePaths(srv.read, o)
  assert.ok(s.ok, s.why)
  const farm = s.net.legs.find(l => l.id === 'farm')
  assert.deepStrictEqual([farm.ok, farm.why, farm.join, farm.nodes.length], [true, 'at_hub', 'hub', 0])
  assert.ok(s.net.legs.find(l => l.id === 'well').ok, 'the well is still routed')
  assert.ok(s.record.cells.length > 0)
  const off = P.sitePaths(srv.read, { ...o, hubDests: false })
  assert.strictEqual(off.ok, false, 'CONTROL: the plaza really is closed to a 2-wide leg')
  assert.match(off.why, /farm:unreachable/)
})
await t('MUTANT KILLED: without the hub branch the cluttered plaza\'s farm is unrouted again', async () => {
  await withMutant(PATHS_PATH, 'if (hubDests && atHub(hub, d.cols)) {', 'if (false) {', async M => {
    const s = M.sitePaths(clutteredPlaza().read, { plan: corePlan(), caps: [[5, G + 1, 20]], composter: [0, G + 1, 0], place: placeBlueprint })
    assert.strictEqual(s.ok, false); assert.match(s.why, /farm:unreachable/)
  })
})
await t('a town whose every destination is at the hub has nothing to lay: no_route -> a no-site record (board-c and hive-d\'s shape)', async () => {
  const s = P.sitePaths(clutteredPlaza().read, { plan: corePlan(), composter: [0, G + 1, 0], place: placeBlueprint })
  assert.deepStrictEqual([s.ok, s.why], [false, 'no_route'])
  assert.strictEqual(P.pathsSiteStop(s), 'paths_no_site')
})

console.log('A FAILED SITING: READ GROUND -> A NO-SITE RECORD; AN UNREAD COLUMN -> ASKED AGAIN')
const moatWorld = () => { const srv = server(); for (let x = 14; x <= 26; x++) for (let z = 14; z <= 26; z++) if (Math.max(Math.abs(x - 20), Math.abs(z - 20)) >= 4) srv.set([x, G, z], 'water'); return srv }
await t('read ground no leg crosses (a moat): unrouted, unread 0 -> paths_no_site', async () => {
  const s = P.sitePaths(moatWorld().read, { plan: corePlan(), composter: [20, G + 1, 20], place: placeBlueprint })
  assert.strictEqual(s.ok, false); assert.match(s.why, /unrouted:farm:unreachable/)
  assert.strictEqual(s.unread, 0)
  assert.strictEqual(P.pathsSiteStop(s), 'paths_no_site')
})
/** An unloaded chunk band (x 16..31 reads null) between the core and a composter at x 40: the routing meets unread columns. */
const bandRead = srv => (x, y, z) => (x >= 16 && x <= 31 ? null : srv.read(x, y, z))
await t('an unread band the routing meets: unrouted, unread > 0 -> site_unread (no record; control: the band read -> routed)', async () => {
  const srv = server()
  const o = { plan: corePlan(), composter: [40, G + 1, 0], place: placeBlueprint }
  const s = P.sitePaths(bandRead(srv), o)
  assert.strictEqual(s.ok, false); assert.match(s.why, /unrouted:farm/)
  assert.ok(s.unread > 0, `unread ${s.unread}`)
  assert.strictEqual(P.pathsSiteStop(s), 'site_unread')
  assert.ok(P.sitePaths(srv.read, o).ok, 'CONTROL: the same ground read routes')
})
await t('MUTANT KILLED: without the unread count an unloaded chunk would write a no-site record for a day', async () => {
  await withMutant(PATHS_PATH, "if (Number(s?.unread) > 0 || /unknown/.test(String(s?.why))) return 'site_unread'", "if (/unknown/.test(String(s?.why))) return 'site_unread'", async M => {
    const s = M.sitePaths(bandRead(server()), { plan: corePlan(), composter: [40, G + 1, 0], place: placeBlueprint })
    assert.strictEqual(M.pathsSiteStop(s), 'paths_no_site')
  })
})
await t('Codex r1 BLOCK 1: every required destination at the hub, an optional chest beyond an unread band: no_route but unread > 0 -> site_unread (control: read -> routed)', async () => {
  const srv = server()
  const p = { ...corePlan(), plots: [...corePlan().plots, { id: 'store', cells: [{ kind: 'chest', state: 'placed', at: [40, G + 1, 0], stand: [39, G + 1, 0] }] }] }
  const o = { plan: p, composter: [0, G + 1, 0], place: placeBlueprint }
  const s = P.sitePaths(bandRead(srv), o)
  assert.deepStrictEqual([s.ok, s.why], [false, 'no_route'])
  assert.ok(s.unread > 0, `unread ${s.unread}`)
  assert.strictEqual(P.pathsSiteStop(s), 'site_unread')
  assert.ok(P.sitePaths(srv.read, o).ok, 'CONTROL: the same ground read routes the chest')
})
await t('pathsSiteStop: no plan / no core keep the order\'s daily no_site; ok -> null', async () => {
  assert.strictEqual(P.pathsSiteStop({ ok: false, why: 'no_plan' }), 'no_site')
  assert.strictEqual(P.pathsSiteStop({ ok: false, why: 'no_core' }), 'no_site')
  assert.strictEqual(P.pathsSiteStop({ ok: true }), null)
  assert.strictEqual(P.pathsSiteStop({ ok: false, why: 'unrouted:well:search_bound', unread: 0 }), 'paths_no_site')
})

console.log('THE NO-SITE RECORD')
await t('pathsNoSite: complete, no cells or zones, retried after 24 h (pathsDue); an extension of it is refused', async () => {
  const now = 1_000_000
  const r = P.pathsNoSite({ home: { x: 1, y: 70, z: 2 }, now, by: 'A', why: 'unrouted:shop:unreachable' })
  assert.deepStrictEqual([r.blueprint, r.plot, r.state, r.structure_complete], [P.PATHS_BLUEPRINT, P.PATHS_PLOT, 'no_site', true])
  assert.deepStrictEqual([r.cells.length, r.zones.length, r.legs.length], [0, 0, 0])
  assert.strictEqual(P.pathsNoSiteRec(r), true)
  assert.strictEqual(P.pathsDue(r, now + P.PATHS_NO_SITE_RETRY_MS - 1), false)
  assert.strictEqual(P.pathsDue(r, now + P.PATHS_NO_SITE_RETRY_MS), true)
  assert.strictEqual(P.pathsNoSiteRec({ blueprint: P.PATHS_BLUEPRINT, state: 'open', cells: [] }), false, 'a laid record is not one')
  assert.deepStrictEqual(P.extendPaths(server().read, r, { plan: corePlan(), place: placeBlueprint }).why, 'no_site')
  assert.deepStrictEqual(SHOPM.recordZones([r]), [], 'no siting zone for later projects')
})
await t('COMPOSED: with the paths\' no-site record complete, the order\'s next open project is the wall (it waited on the paths)', async () => {
  const list = SHOPM.projectsOn(true, true, true, true, true, false)
  assert.ok(list.some(p => p.plot === 'wall'), 'the wall is in the list')
  const states = [{ plot: 'shop', exists: true, complete: true }, { plot: 'shaft', exists: true, complete: true }, { plot: 'house1', exists: true, complete: true }, { plot: 'monument', exists: true, complete: true }]
  // CONTROL: no paths record -> the paths are the open project, the wall waits
  assert.strictEqual(SHOPM.activeProject([...states, { plot: 'paths', exists: false, complete: false }], list).plot, 'paths')
  const r = P.pathsNoSite({ home: { x: 0, y: 70, z: 0 }, now: 0 })
  assert.strictEqual(SHOPM.activeProject([...states, { plot: 'paths', exists: true, complete: !!r.structure_complete }], list).plot, 'wall')
})
await t('the switch: FLEETPATHS=off|0|false|no is the rollback; unset is on', async () => {
  assert.strictEqual(P.fleetPathsOn({}), true)
  for (const v of ['off', '0', 'false', 'no', ' OFF ']) assert.strictEqual(P.fleetPathsOn({ FLEETPATHS: v }), false, v)
  assert.strictEqual(P.fleetPathsOn({ FLEETPATHS: 'on' }), true)
})

console.log('THE WIRING (structural: skills.mjs, comments stripped)')
const code = readFileSync(SKILLS_PATH, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1')
await t('buildPaths publishes the no-site record on read ground, honours one before its retry, and re-sites after it', async () => {
  assert.match(code, /if \(stop !== 'paths_no_site'\) return out\('no_effect', stop, why, \{ stop \}\)/)
  assert.match(code, /publishRecord\(dir, key, cur => \(fresh\(cur\) \? pathsNoSite\(\{ home, now: Date\.now\(\), by: me, why: s\.why \}\) : null\)/)
  assert.match(code, /if \(rh\.head && pathsNoSiteRec\(rh\.head\.rec\) && !noSiteGone\(rh\.head\.rec\)\) return out\('no_effect', 'paths_no_site'/)
  assert.match(code, /if \(!rh\.head \|\| noSiteGone\(rh\.head\.rec\)\) \{/)
  assert.match(code, /const stop = fleetPathsOn\(\) \? pathsSiteStop\(s\) :/)
})
await t('a no-site record is never damaged, only due after its retry; never extended; FLEETPATHS=off reads it absent', async () => {
  assert.match(code, /if \(r\.blueprint === PATHS_BLUEPRINT && pathsNoSiteRec\(r\)\) return tidy && pathsDue\(r\)/)
  assert.match(code, /if \(pathsNoSiteRec\(rec\)\) return false/)
  assert.match(code, /const rec = !fleetPathsOn\(\) && pathsNoSiteRec\(rec0\) \? null : rec0/)
  assert.match(code, /hubDests: fleetPathsOn\(\) \}/)
  assert.match(code, /if \(h\.ok && h\.head && !fleetPathsOn\(\) && pathsNoSiteRec\(h\.head\.rec\)\) return \{ \.\.\.h, head: null \}/, 'Codex r1 BLOCK 2: the order\'s own read (shopRecordHead) too')
})

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
