// ZIGTIDY-01 (OWNER 10-30, the showcase's finished ziggurat@1 with dirt on its treads): the climbing pillars the bots leave on a
// finished build are dug -- ziggurat.mjs zigTidy names them (never a record cell, never a listed clear, never furniture), and
// buildrun.mjs runVisit digs them after the record's own clears, under the clear lease, with the clears' per-call bound.
import assert from 'node:assert'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
const { R, G, HOME, k3, server } = await import('./helpers/buildfake.mjs')
const { Z, G12, siteOn, zigProject, zigDone, KITZ, zbot } = await import('./helpers/zigfake.mjs')

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 5).join('\n        ')}`) }
}
const RPATH = new URL('../src/buildrun.mjs', import.meta.url)
async function withRunMutant (old, neu, fn) {
  const src = readFileSync(RPATH, 'utf8')
  assert.ok(src.includes(old), `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 70))}`)
  assert.strictEqual(src.split(old).length, 2, 'ANCHOR MISSING OR NOT UNIQUE')
  const out = new URL(`./_mutant-tidy-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, src.replace(old, neu).replace(/from '\.\//g, "from '../src/"))
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}
/** The B=12 ziggurat built to completion on the fake server -> { srv, rec, p, e }. */
async function built () {
  const srv = server()
  const rec = Z.zigRecord(siteOn(srv).site, srv.read, { home: HOME, g: G12 })
  const { p } = zigProject(rec)
  const e = zbot(srv, 'A', { inv: KITZ(), feet: [-5, G + 1, -5] })
  for (let v = 0; v < 12 && !zigDone(srv, rec); v++) await R.runVisit(p('A'), e, { maxSteps: 400 })
  assert.ok(zigDone(srv, rec), 'built')
  return { srv, rec, p, e }
}
/** Pillars on the finished build: two dirt on tier 0's tread, one cobblestone in the apron, one dirt on the summit; a chest and a
 *  torch beside them (never dug). */
function litter (srv, rec) {
  const [x0, z0] = rec.corner, y0 = rec.baseY
  const tread = [x0 + 1, y0 + 2, z0 + 1]                          // tier 0's top is layer 1: the tread is y0 + 2
  const pillar = [tread, [tread[0], tread[1] + 1, tread[2]], [x0 - 1, y0, z0 + 4], [x0 + 5, y0 + 4, z0 + 5]]
  srv.set(pillar[0], 'dirt'); srv.set(pillar[1], 'dirt'); srv.set(pillar[2], 'cobblestone'); srv.set(pillar[3], 'dirt')
  srv.set([x0 + 2, y0 + 2, z0 + 1], 'chest'); srv.set([x0 + 3, y0 + 2, z0 + 1], 'torch')
  return pillar
}
console.log('ZIGTIDY-01')
await t('zigTidy names exactly the pillar blocks above the finished build (highest first); never a record cell, a chest or a torch', async () => {
  const { srv, rec } = await built()
  assert.deepStrictEqual(Z.zigTidy(rec, srv.read), [], 'a clean finished build: nothing')
  const pillar = litter(srv, rec)
  const list = Z.zigTidy(rec, srv.read)
  assert.deepStrictEqual(list.map(c => k3(c.at)).sort(), pillar.map(k3).sort())
  assert.ok(list.every((c, i) => i === 0 || list[i - 1].at[1] >= c.at[1]), 'highest first')
  assert.ok(list.every(c => c.kind === 'tidy' && c.name === srv.read(...c.at).name))
  const cells = new Set(rec.cells.map(c => k3(c.at)))
  assert.ok(list.every(c => !cells.has(k3(c.at))))
  // a cell the record lists as a clear is the clears' own; `skip` drops a cell
  assert.ok(!Z.zigTidy({ ...rec, clear: [{ at: pillar[2], kind: 'cut', name: 'cobblestone' }] }, srv.read).some(c => k3(c.at) === k3(pillar[2])))
  assert.strictEqual(Z.zigTidy(rec, srv.read, { skip: k => k === pillar[3].join(',') }).length, 3)
})
await t('THE VISIT DIGS THEM: op=clear kind=tidy rows, the build untouched, complete; the next visit has nothing to tidy', async () => {
  const { srv, rec, p, e } = await built()
  const pillar = litter(srv, rec)
  const tidy = Z.zigTidy(rec, srv.read)
  const before = rec.cells.map(c => srv.read(...c.at).name)
  const r = await R.runVisit({ ...p('A'), tidy }, e, { maxSteps: 400 })
  assert.strictEqual(r.stop, 'complete'); assert.strictEqual(r.cleared, 4)
  for (const c of pillar) assert.strictEqual(srv.read(...c).name, 'air', `${c} dug`)
  assert.strictEqual(srv.read(rec.corner[0] + 2, rec.baseY + 2, rec.corner[1] + 1).name, 'chest')
  assert.deepStrictEqual(rec.cells.map(c => srv.read(...c.at).name), before, 'no record cell touched')
  const rows = e.logs.filter(([k, d]) => k === '_build' && d.op === 'clear' && d.kind === 'tidy')
  assert.strictEqual(rows.length, 4)
  assert.deepStrictEqual(Z.zigTidy(rec, srv.read), [])
})
await t('NEVER A RECORD CELL, whatever the list says (the visit\'s own filter, over the clears\' built-cell guard)', async () => {
  const { srv, rec, p, e } = await built()
  const top = rec.cells.reduce((a, c) => (c.at[1] > a.at[1] ? c : a))
  await R.runVisit({ ...p('A'), tidy: [{ at: top.at, kind: 'tidy', name: 'cobblestone' }] }, e, { maxSteps: 400 })
  assert.strictEqual(srv.read(...top.at).name, 'cobblestone', 'the summit cell stands')
})
await t('THE SUMMIT\'S PILLAR (top + 1) is named (killed with the scan stopping at the top)', async () => {
  const scenario = async ZM => {
    const { srv, rec } = await built()
    const pillar = litter(srv, rec)
    assert.ok(ZM.zigTidy(rec, srv.read).some(c => k3(c.at) === k3(pillar[3])))
  }
  await scenario(Z)
  const src = readFileSync(new URL('../src/ziggurat.mjs', import.meta.url), 'utf8')
  const old = 'y <= top + 2; y++) {'
  assert.strictEqual(src.split(old).length, 2, 'ANCHOR MISSING OR NOT UNIQUE')
  const out = new URL(`./_mutant-tidyz-${process.pid}.mjs`, import.meta.url)
  writeFileSync(out, src.replace(old, 'y <= top; y++) {').replace(/from '\.\//g, "from '../src/"))
  let killed = false
  try { await scenario(await import(out.href)) } catch { killed = true } finally { try { unlinkSync(out) } catch {} }
  assert.ok(killed, 'the mutant survived')
})
await t('BOUNDED: the clears\' per-call bound holds for the tidy too (clearMax 2: two digs a visit)', async () => {
  const { srv, rec, p, e } = await built()
  litter(srv, rec)
  const r = await R.runVisit({ ...p('A'), tidy: Z.zigTidy(rec, srv.read), clearMax: 2 }, e, { maxSteps: 400 })
  assert.strictEqual(r.cleared, 2)
  assert.strictEqual(Z.zigTidy(rec, srv.read).length, 2)
})
await t('skills.mjs (structural): the damage test asks for a tidy, bounded by ZIG_TIDY_VISITS a bot; the visit passes the list', async () => {
  const src = readFileSync(new URL('../src/skills.mjs', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  const fn = name => { const i = src.indexOf(`function ${name} (`); assert.ok(i >= 0, name); return src.slice(i, src.indexOf('\n}\n', i)) }
  assert.ok(/if \(mon && zigTidyNow\(bot, r, read\)\.length\) return true/.test(fn('recordDamaged')))
  assert.ok(/skip: k => \(seen\.get\(k\) \?\? 0\) >= ZIG_TIDY_VISITS/.test(fn('zigTidyNow')))
  const bm = fn('buildMonument')
  assert.ok(/tidy = zigTidyNow\(bot, rec, read\)/.test(bm) && /record: rec, tidy,/.test(bm))
})
console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
