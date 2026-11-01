// STOREHOUSE-01 ON THE REAL GROUND (11-01 showcase false trip). The tripwire's G3 reads the bots' own `_townplan_audit`, which
// is auditPlan below. This runs that audit over the showcase's mirror region copy (fixtures/storehouse-01-mirror-20261101.json:
// the plan generation 27 and every non-air block within the walk radius, dumped read-only from the copy of 15:40-15:45Z, after
// the doorway at -10,71,3 was cleared) and proves: the five walled chests read REACHABLE through the doorway under the 2-high
// roof, past wall torches and glass panes; with the doorway filled (a genuinely sealed storehouse) the same audit names all
// the interior chests unreachable. Then a mutant on standFor's reach test (anchor present and unique) must flip the first.
import assert from 'node:assert'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { createRequire } from 'node:module'

const T = await import('../src/townplan.mjs')
const TP_PATH = new URL('../src/townplan.mjs', import.meta.url)
const mcData = createRequire(import.meta.url)('minecraft-data')('1.21.8')
const FX = JSON.parse(readFileSync(new URL('./fixtures/storehouse-01-mirror-20261101.json', import.meta.url), 'utf8'))
const INSIDE = ['-9,71,-2', '-13,71,0', '-13,71,2', '-11,71,-2', '-9,71,2']

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 5).join('\n        ')}`) }
}

function world (over = {}) {
  const cells = {}
  for (const [name, ks] of Object.entries(FX.blocks)) for (const k of ks) cells[k] = name
  Object.assign(cells, over)
  const [x0, y0, z0, x1, y1, z1] = FX.box
  const box = n => mcData.blocksByName[n]?.boundingBox ?? 'block'
  const shapes = n => box(n) === 'block' && !/(_slab|_stairs|_leaves|_pane|_wall|_fence)$/.test(n) ? [[0, 0, 0, 1, 1, 1]] : []
  return (x, y, z) => {
    if (x < x0 || x > x1 || y < y0 || y > y1 || z < z0 || z > z1) return null
    const name = cells[`${x},${y},${z}`] ?? 'air'
    return { name, boundingBox: box(name), shapes: shapes(name), props: null }
  }
}
const unreach = a => a.names.filter(n => n.startsWith('unreachable:')).map(n => n.slice('unreachable:'.length))

console.log('townplan: storehouse-01 on the mirror geometry')
await t('the fixture is the storehouse: walls, roof, chests, torches/panes, an open doorway (positive control on the dump)', () => {
  const r = world()
  for (const k of INSIDE) assert.equal(r(...k.split(',').map(Number))?.name, 'chest', k)
  assert.equal(r(-14, 71, 0).name, 'stone_bricks')
  assert.equal(r(-10, 73, 0).name, 'spruce_planks', 'the roof at y73')
  assert.equal(r(-10, 71, 3).name, 'air'); assert.equal(r(-10, 72, 3).name, 'air', 'the doorway, 2 high')
  const names = new Set(Object.keys(FX.blocks))
  assert.ok([...names].some(n => /wall_torch$/.test(n)) && [...names].some(n => /_pane$/.test(n)), `torches and panes present: ${[...names].filter(n => /torch|pane/.test(n))}`)
})
await t('the bots\' audit on the real ground: every placed chest reachable, unreachable=0', () => {
  const a = T.auditPlan(FX.plan, world(), { home: FX.home })
  assert.equal(a.unknown, 0, 'the dump covers every placed cell')
  assert.ok(a.present >= 11, `placed cells read present (${a.present} of ${a.placed})`)
  assert.equal(a.unreachable, 0, `unreachable: ${unreach(a)}`)
})
await t('SEALED: the doorway filled, the same audit names the interior chests unreachable', () => {
  const a = T.auditPlan(FX.plan, world({ '-10,71,3': 'stone_bricks', '-10,72,3': 'stone_bricks' }), { home: FX.home })
  const u = new Set(unreach(a))
  // six interior chests (-13,71,-2 too); the names list is capped at 6, so check the count and every listed name is inside
  assert.equal(a.unreachable, 6, `unreachable=${a.unreachable} ${[...u]}`)
  for (const k of INSIDE) assert.ok(u.has(k), `${k} named (${[...u]})`)
})
await t('mutant: standFor ignores reach -> the sealed storehouse reads reachable (the SEALED check is not vacuous)', async () => {
  const src = readFileSync(TP_PATH, 'utf8')
  const old = '    if (!reach.has(kOf(f)) || !within(f, at)) continue\n'
  assert.equal(src.split(old).length, 2, 'ANCHOR MISSING OR NOT UNIQUE')
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, src.replace(old, '    if (!within(f, at)) continue\n').replace(/from '\.\//g, "from '../src/"))
  try {
    const M = await import(out.href)
    const a = M.auditPlan(FX.plan, world({ '-10,71,3': 'stone_bricks', '-10,72,3': 'stone_bricks' }), { home: FX.home })
    assert.equal(a.unreachable, 0, 'the mutant must lose the sealed defect')
  } finally { try { unlinkSync(out) } catch {} }
})

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
