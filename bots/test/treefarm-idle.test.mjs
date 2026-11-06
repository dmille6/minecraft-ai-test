// TREEFARM-05: THE FLEET'S IDLE TREE FARM (owner 11-06: the tree farm for the towns that have built every project they have).
// Pure and on the fake server: the mode (on in the showcase, IDLE in every other pool, TREEFARM_IDLE=off the fleet rollback); the
// idle-only gate in shop.mjs activeProject (the farm opens only where every other project stands; the tidy does not count; a sited
// farm waits when a new project opens; a complete farm's upkeep still comes after every open project); the siting tries (the
// showcase's one, the idle farm's inside -> outside -> small inside -> small outside) and the tiered siting on ground where the
// wall's inside is full; the wiring in skills.mjs. Mutants assert their anchors present and unique (CLAUDE.md).
import assert from 'node:assert'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
const { G, HOME, server } = await import('./helpers/buildfake.mjs')
const F = await import('../src/treefarm.mjs')
const SH = await import('../src/shop.mjs')

const TF_PATH = new URL('../src/treefarm.mjs', import.meta.url)
const SHOP_PATH = new URL('../src/shop.mjs', import.meta.url)
const SKILLS_PATH = new URL('../src/skills.mjs', import.meta.url)
let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 5).join('\n        ')}`) }
}
/** A mutant of a source module (anchor present and unique), imported from the test directory. */
async function withMutant (file, old, neu, fn) {
  const src = readFileSync(file, 'utf8')
  assert.ok(src.split(old).length === 2, `ANCHOR MISSING OR NOT UNIQUE: ${JSON.stringify(old.slice(0, 70))}`)
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, src.replace(old, neu).replace(/from '\.\//g, "from '../src/"))
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}
/** The scenario passes on the real module and fails on the mutant. */
const killed = async (file, real, old, neu, scenario) => {
  await scenario(real)
  let k = false
  await withMutant(file, old, neu, async M => { try { await scenario(M) } catch { k = true } })
  assert.ok(k, `the mutant survived: ${old.slice(0, 60)}`)
}

// ---- the mode --------------------------------------------------------------------------------------------------------------
const modeScenario = M => {
  assert.strictEqual(M.treefarmMode({}, 'showcase'), 'on')
  assert.strictEqual(M.treefarmMode({}, 'board-b'), 'idle')
  assert.strictEqual(M.treefarmMode({ TREEFARM_IDLE: 'off' }, 'board-b'), 'off')
  assert.strictEqual(M.treefarmMode({ TREEFARM_IDLE: 'off' }, 'showcase'), 'on')
  assert.strictEqual(M.treefarmMode({ TREEFARM: 'off' }, 'board-b'), 'off')
  assert.strictEqual(M.treefarmMode({ TREEFARM: 'on' }, 'board-b'), 'on')
  assert.strictEqual(M.treefarmFallback({}, 'board-b'), true)
  assert.strictEqual(M.treefarmFallback({}, 'showcase'), false, 'the showcase sites as before')
  assert.strictEqual(M.treefarmFallback({ TREEFARM: 'on' }, 'board-b'), false, 'an explicit on is the showcase\'s siting')
  assert.strictEqual(M.treefarmFallback({ TREEFARM_FALLBACK: 'off' }, 'board-b'), false)
}
await t('the mode: on in the showcase, IDLE in a fleet pool, off with TREEFARM_IDLE=off; the fallback only for an idle farm', async () => {
  modeScenario(F)
  await killed(TF_PATH, F, "return OFF_WORDS.includes(String(env?.TREEFARM_IDLE ?? '').trim().toLowerCase()) ? 'off' : 'idle'", "return 'off'", modeScenario)
  await killed(TF_PATH, F, "export const treefarmFallback = (env = process.env, pool = '') => treefarmMode(env, pool) === 'idle' &&", "export const treefarmFallback = (env = process.env, pool = '') => treefarmMode(env, pool) !== 'off' &&", modeScenario)
})

// ---- the gate ---------------------------------------------------------------------------------------------------------------
// the fleet's project list with the farm on (every switch on, as in board-b / hive-b / placebo-a)
const LIST = SH.projectsOn(true, true, true, true, true, true, true)
const FARM = 'treefarm'
const done = plot => ({ plot, exists: true, complete: true, damaged: false })
const open = (plot, extra = {}) => ({ plot, exists: true, complete: false, damaged: false, ...extra })
/** The measured 11-06 state of the three towns: every project complete, no farm record. */
const allDone = () => LIST.filter(p => p.plot !== FARM).map(p => done(p.plot))
const gateScenario = M => {
  assert.ok(LIST.some(p => p.plot === FARM) && LIST.some(p => p.plot === 'tidy'), 'the list has the farm and the tidy')
  // the measured towns: everything stands -> the farm is the project
  assert.strictEqual(M.activeProject(allDone(), LIST, { idle: [FARM] }).plot, FARM)
  assert.strictEqual(M.idleOnlyOpen(allDone(), LIST, [FARM]), true)
  // the ziggurat open (hive-a / placebo-c today): the ziggurat, never the farm -- even with every ziggurat slot taken
  const zig = allDone().map(s => (s.plot === 'monument' ? open('monument', { free: false }) : s))
  assert.strictEqual(M.idleOnlyOpen(zig, LIST, [FARM]), false)
  assert.strictEqual(M.activeProject(zig, LIST, { idle: [FARM] }).plot, 'monument')
  // control: without the gate (the showcase), a full ziggurat sends the bot to the farm, the next open project
  assert.strictEqual(M.activeProject(zig, LIST, { idle: [] }).plot, FARM)
  // the tidy open (board-d / hive-d / placebo-b today) holds the farm back too: an open tidy is the town's work (Codex design)
  const tidy = allDone().map(s => (s.plot === 'tidy' ? open('tidy') : s))
  assert.strictEqual(M.idleOnlyOpen(tidy, LIST, [FARM]), false)
  assert.strictEqual(M.activeProject(tidy, LIST, { idle: [FARM] }).plot, 'tidy')
  // ...and the stair
  const stair = allDone().map(s => (s.plot === 'shaft' ? open('shaft') : s))
  assert.strictEqual(M.activeProject(stair, LIST, { idle: [FARM] }).plot, 'shaft')
  // a project with no record (unsited: board-a's ziggurat has no site) holds it back
  const unsited = allDone().filter(s => s.plot !== 'monument')
  assert.strictEqual(M.idleOnlyOpen(unsited, LIST, [FARM]), false)
  assert.notStrictEqual(M.activeProject(unsited, LIST, { idle: [FARM] }).plot, FARM)
  // a SITED farm (open) when a project reopens (the paths extended to a new destination): the paths, the farm waits
  const reopened = [...allDone().map(s => (s.plot === 'paths' ? open('paths', { free: false }) : s)), open(FARM)]
  assert.strictEqual(M.activeProject(reopened, LIST, { idle: [FARM] }).plot, 'paths')
  // ...and once it stands again, the farm
  assert.strictEqual(M.activeProject([...allDone(), open(FARM)], LIST, { idle: [FARM] }).plot, FARM)
  // a COMPLETE farm's upkeep (`due`) still comes after every open project, and is the pick when nothing is open
  const dueFarm = { ...done(FARM), due: true }
  assert.strictEqual(M.activeProject([...zig, dueFarm], LIST, { idle: [FARM] }).plot, 'monument')
  assert.strictEqual(M.activeProject([...allDone(), dueFarm], LIST, { idle: [FARM] }).plot, FARM)
}
await t('THE GATE: the idle farm opens only where every other project stands (the tidy too); a sited farm waits for a reopened project', async () => {
  gateScenario(SH)
  await killed(SHOP_PATH, SH, '    if (!idleOk && idle.includes(p.plot)) continue\n', '', gateScenario)
  await killed(SHOP_PATH, SH, "return list.every(p => idle.includes(p.plot) ||", "return list.every(p => p.plot === TIDY_PLOT || idle.includes(p.plot) ||", gateScenario)
  await killed(SHOP_PATH, SH, '(!!st(p)?.exists && !!st(p)?.complete))', '(!st(p)?.exists || !!st(p)?.complete))', gateScenario)
})
const guardScenario = M => {
  // the farm switched off (TREEFARM_IDLE=off: projectsOn without it) keeps its record guarded, as the stair
  const off = M.projectsOn(true, true, true, true, true, false, true)
  assert.ok(!off.some(p => p.plot === FARM), 'control: the farm is off')
  assert.ok(M.projectsGuarded(off).some(p => p.plot === FARM), 'the farm guarded while off')
  assert.ok(M.projectsGuarded(off).some(p => p.plot === 'shaft'))
  assert.strictEqual(M.projectsGuarded(LIST).filter(p => p.plot === FARM).length, 1, 'once when on')
  assert.ok(!M.projectsGuarded(LIST).some(p => p.plot === 'tidy'), 'the tidy still guards nothing')
}
await t('THE GUARD: a sited farm\'s record stays protected when the farm is switched off (the rollback)', async () => {
  guardScenario(SH)
  await killed(SHOP_PATH, SH, 'const always = [SHAFT_PLOT, TREEFARM_PLOT].filter', 'const always = [SHAFT_PLOT].filter', guardScenario)
})
await t('the process default: the farm is idle-only exactly when its mode is idle', () => {
  assert.deepStrictEqual(SH.idlePlots({ on: true, idle: true }), [FARM])
  assert.deepStrictEqual(SH.idlePlots({ on: true, idle: false }), [], 'the showcase: no gate')
  assert.deepStrictEqual(SH.idlePlots({ on: false, idle: true }), [])
  // this test process has no MEMORY_POOL: a fleet-like pool, so the default is the gate
  if (!process.env.TREEFARM && !process.env.TREEFARM_POOLS && !process.env.TREEFARM_IDLE) assert.deepStrictEqual(SH.idlePlots(), [FARM])
})

// ---- the siting -------------------------------------------------------------------------------------------------------------
await t('the tries: the showcase\'s one (inside, the big grids); the idle farm\'s inside -> outside -> small inside -> small outside', () => {
  const b = [-20, -20, 20, 20]
  assert.deepStrictEqual(F.farmSiteTries(b), [{ where: 'inside', bounds: b, grids: F.FARM.grids }])
  assert.deepStrictEqual(F.farmSiteTries(b, { fallback: true }).map(x => [x.where, x.bounds, x.grids === F.FARM_SMALL_GRIDS ? 'small' : 'big']),
    [['inside', b, 'big'], ['outside', null, 'big'], ['inside', b, 'small'], ['outside', null, 'small']])
  assert.deepStrictEqual(F.farmSiteTries(null, { fallback: true }).map(x => x.where), ['outside', 'outside'], 'no wall: no inside tries')
})
// THE MEASURED CASE (offline 11-06): the wall's inside is full (every column there reserved), open ground outside it
const WALL_IN = [-30, -30, 30, 30]
const fullInside = (x, z) => (x >= WALL_IN[0] - 1 && x <= WALL_IN[2] + 1 && z >= WALL_IN[1] - 1 && z <= WALL_IN[3] + 1 ? 'project' : null)
const tieredScenario = M => {
  const srv = server()
  const base = { home: HOME, blocked: fullInside, bounds: WALL_IN, lights: 4, species: 'birch_sapling' }
  const showcase = M.siteFarmTiered(srv.read, base, M.farmSiteTries(WALL_IN))
  assert.ok(!showcase.ok && /^inside: no fit/.test(showcase.why), `the showcase's siting refuses: ${showcase.why}`)
  const s = M.siteFarmTiered(srv.read, base, M.farmSiteTries(WALL_IN, { fallback: true }))
  assert.ok(s.ok, s.why)
  assert.strictEqual(s.where, 'outside')
  assert.strictEqual(s.record.where, 'outside')
  assert.deepStrictEqual(s.record.grid, [4, 4], 'open ground outside: the biggest grid')
  const [bx0, bz0, bx1, bz1] = s.record.box
  for (let x = bx0; x <= bx1; x++) for (let z = bz0; z <= bz1; z++) assert.strictEqual(fullInside(x, z), null, `${x},${z} is reserved`)
  const c = [(bx0 + bx1) / 2, (bz0 + bz1) / 2]
  assert.ok(Math.hypot(c[0] - HOME.x, c[1] - HOME.z) <= M.FARM.rMax, 'within rMax of home')
  assert.deepStrictEqual(M.siteFarmTiered(srv.read, base, M.farmSiteTries(WALL_IN, { fallback: true })).record, s.record, 'deterministic')
}
await t('THE TIERED SITING: the wall\'s inside full -> the showcase\'s siting refuses, the idle farm sites outside the wall, off every reservation', async () => {
  tieredScenario(F)
  await killed(TF_PATH, F, "    out.push({ where: 'outside', bounds: null, grids })\n", '', tieredScenario)
})
// HIVE-B's CASE (offline 11-06): ground that only a 3x2 grid's box fits
const smallScenario = M => {
  const srv = server()
  const x0 = 14, z0 = 14
  const fits = M.farmBox(x0, z0, 3, 2)
  const blocked = (x, z) => (x >= fits[0] && x <= fits[2] && z >= fits[1] && z <= fits[3] ? null : 'built')
  const big = M.siteFarmTiered(srv.read, { home: HOME, blocked, bounds: null }, [{ where: 'outside', bounds: null, grids: M.FARM.grids }])
  assert.ok(!big.ok, 'control: no big grid fits')
  const s = M.siteFarmTiered(srv.read, { home: HOME, blocked, bounds: null, lights: 2 }, M.farmSiteTries(null, { fallback: true }))
  assert.ok(s.ok, s.why)
  assert.deepStrictEqual(s.record.grid, [3, 2])
  assert.strictEqual(s.record.counts.plots, 6, 'every plot of a small grid')
  assert.deepStrictEqual(s.record.box, fits)
}
await t('THE SMALL GRIDS: ground only a 3x2 fits (hive-b) -> the idle farm is a 3x2, all six plots', async () => {
  smallScenario(F)
  await killed(TF_PATH, F, '  for (const [gx, gz] of grids) {\n', '  for (const [gx, gz] of FARM.grids) {\n', smallScenario)
})

// ---- the wiring (structural: the visit's siting call; comments stripped, the executable line anchored) -------------------------
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map(l => l.replace(/(^|[^:'"`])\/\/.*$/, '$1')).join('\n')
await t('the wiring: buildTreeFarm sites through the tiered siting with this process\'s fallback switch', () => {
  const src = strip(readFileSync(SKILLS_PATH, 'utf8'))
  const visit = src.slice(src.indexOf('async function buildTreeFarm'), src.indexOf('async function buildTreeFarm') + 6000)
  assert.ok(visit.length > 1000, 'the visit is found')
  const line = 's = siteFarmTiered(planReader(bot), { home, ...I }, farmSiteTries(I.bounds, { fallback: TREEFARM.fallback }))'
  assert.strictEqual(visit.split(line).length, 2, 'the siting call, once')
  assert.ok(!/\bsiteFarm\(/.test(visit), 'no untiered siting left in the visit')
  assert.ok(/import \{ SHOP, TREEFARM, /.test(src), 'TREEFARM imported from shop.mjs')
})

console.log(`\ntreefarm-idle: ${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
