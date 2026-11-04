// SITEPREP-02: THE LIVE SP1 STALL, FROM THE LOGGED STATE (showcase 11-04 11:09-11:47Z: request SP1, shrine n=2; the keeper's five
// visits worked ranked candidates 0-19, every one `pin_kept`). The fixture is the showcase's own blocks round six of SP1's candidates
// (region copy ~11:50Z, bots/test/fixtures/siteprep-sp1-1104.json, written by the agent's extractor from the bots' own ranking: index
// = the live cursor order). Behaviour: the old screen passed candidates the grading could never pin (a trunk in a base column's fill,
// a frozen pond read as ground); the new screen refuses them before a keeper visit is spent; buried leaves no longer block a cut;
// the plot the old ranking reached only at index 31 still grades. Anchored mutants (present and unique, imported fresh).
import assert from 'node:assert'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
const { dumpReader } = await import('../scripts/buildsite-offline.mjs')
const P = await import('../src/siteprep.mjs')
const TR = await import('../src/terrace.mjs')

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 6).join('\n        ')}`) }
}
async function withMutant (rel, old, neu, fn) {
  const file = new URL(`../src/${rel}`, import.meta.url)
  const src = readFileSync(file, 'utf8')
  assert.ok(src.includes(old), `ANCHOR MISSING: ${JSON.stringify(old.slice(0, 70))}`)
  assert.strictEqual(src.split(old).length, 2, `ANCHOR NOT UNIQUE: ${JSON.stringify(old.slice(0, 70))}`)
  const out = new URL(`./_mutant-sp1-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, src.replace(old, neu).replace(/from '\.\//g, "from '../src/"))
  try { return await fn(await import(`${out.href}?${Date.now()}_${Math.random()}`)) } finally { try { unlinkSync(out) } catch {} }
}
const killed = async (rel, real, old, neu, scenario) => {
  await scenario(real)
  let k = false
  await withMutant(rel, old, neu, async M => { try { await scenario(M) } catch { k = true } })
  assert.ok(k, `the mutant survived: ${old.slice(0, 60)}`)
}

const FX = JSON.parse(readFileSync(new URL('./fixtures/siteprep-sp1-1104.json', import.meta.url), 'utf8'))
const home = FX.home
const box = tag => FX.boxes.find(b => b.tag === tag)
/** The showcase's blocks round one candidate; above the copied span air, below it stone (every column's ground lies inside it). */
const readerOf = b => { const r = dumpReader({ ...b, palette: FX.palette }); return (x, y, z) => (y > b.y[1] ? { name: 'air', boundingBox: 'empty' } : y < b.y[0] ? { name: 'stone', boundingBox: 'block' } : r(x, y, z)) }
const est = (M, b, withRead) => { const read = readerOf(b); return M.prepEstimate(b.cand, { ground: M.groundMemo(read, home.y), wetCol: M.wetMemo(read, home.y), hy: home.y, ...(withRead ? { read } : {}) }) }
const grade = (M, b, e) => M.prepGrade(readerOf(b), { ...b.cand, est: e ?? b.cand.est }, { home })

console.log('THE LOGGED STATE: SP1\'s candidates on the showcase\'s own blocks')
await t('reproduced: the old screen passes the live cursor-0 candidate (ne B9) and its grading cannot hold the pin -- `pin_kept`, as live', () => {
  const b = box('tree_in_earth')
  assert.strictEqual(b.i, 0)
  const e = est(P, b, false)
  assert.ok(e.ok, JSON.stringify(e))
  assert.strictEqual(grade(P, b, e).why, 'pin_kept')
})
await t('fixed: the new screen refuses it before a keeper visit -- a trunk stands in a pinned column\'s earth', () => {
  const e = est(P, box('tree_in_earth'), true)
  assert.strictEqual(e.ok, false)
  assert.strictEqual(e.why, 'tree_in_earth')
})
await t('mutant: without the trunk rule the screen passes cursor 0 again', () => killed('siteprep.mjs', P,
  '    if (cols.some(([x, z, g, ap]) => earthBlocked(read, x, z, g, L - ap, L + ap))) { why.tree_in_earth = 1; continue }\n', '',
  M => assert.strictEqual(est(M, box('tree_in_earth'), true).ok, false)))
await t('a frozen pond (ice: a floor to the sinks, water to the grading) was `pin_not_free` in every solve; refused now', () => {
  const b = box('pin_col_ice')
  assert.ok(est(P, b, false).ok)
  assert.strictEqual(grade(P, b).why, 'pin_not_free')
  const e = est(P, b, true)
  assert.strictEqual(e.ok, false); assert.strictEqual(e.why, 'pin_col_ice')
})
await t('mutant: without the grading\'s own column rule the ice candidate passes the screen', () => killed('siteprep.mjs', P,
  "if (tc.why && (tc.why !== 'water' || tc.name === 'ice')) return", 'if (false) return',
  M => assert.strictEqual(est(M, box('pin_col_ice'), true).ok, false)))
await t('buried leaves under dirt no longer block a cut: the candidate graded only with T.cutLeaves', () => {
  const b = box('leaves_only')
  const gr = grade(P, b)
  assert.ok(gr.ok, gr.why)
  assert.ok(gr.work.cut.some(c => /_leaves$/.test(c.name)), 'a leaves block is one of the cuts')
})
await t('mutant: without cutLeaves the leaves candidate is `pin_kept` again', () => killed('siteprep.mjs', P,
  'const T = { ...TERRACE, maxCut: P.colMax, maxFill: P.colMax, cutLeaves: true }', 'const T = { ...TERRACE, maxCut: P.colMax, maxFill: P.colMax }',
  M => assert.ok(grade(M, box('leaves_only')).ok)))
await t('the terrace stage keeps its rule: without the flag a leaves block in a cut span is still `cut_blocked` there', () => {
  const b = box('leaves_only'), read = readerOf(b), { pin, box: gb } = P.prepBoxes(b.cand)
  const pins = new Map()
  for (let x = pin[0] + 2; x <= pin[2] - 2; x++) for (let z = pin[1] + 2; z <= pin[3] - 2; z++) pins.set(`${x},${z}`, b.cand.est.L)
  const off = TR.gradeTerraces(read, gb, { home, levels: [], pin: pins, water: 'owner-1101', T: { ...TR.TERRACE, maxCut: 6, maxFill: 6 } })
  const on = TR.gradeTerraces(read, gb, { home, levels: [], pin: pins, water: 'owner-1101', T: { ...TR.TERRACE, maxCut: 6, maxFill: 6, cutLeaves: true } })
  assert.ok((off.skipped.cut_blocked ?? 0) > (on.skipped.cut_blocked ?? 0), `${JSON.stringify(off.skipped)} vs ${JSON.stringify(on.skipped)}`)
})
await t('the screen is a NECESSARY condition: the plot the live ranking reached only at index 31 passes it and grades', () => {
  const b = box('graded')
  assert.strictEqual(b.i, 31)
  const e = est(P, b, true)
  assert.ok(e.ok, e.why)
  const gr = grade(P, b, e)
  assert.ok(gr.ok, gr.why)
  assert.ok(gr.counts.fill > 0 && gr.counts.fill + gr.counts.seal + gr.counts.dam <= P.PREP.fillMax)
})
await t('a live cursor-4 candidate (sw2): `pin_kept` at the old level; the trunk rule moves its level to one the grading holds (Claude r1)', () => {
  const b = box('pin_kept')
  assert.strictEqual(grade(P, b).why, 'pin_kept')               // at the old screen's L (a trunk stands in its earth there)
  const e = est(P, b, true)
  assert.ok(e.ok && e.L !== b.cand.est.L, JSON.stringify(e))
  const t0 = Date.now()
  assert.ok(grade(P, b, e).ok)
  assert.ok(Date.now() - t0 < 2000)
  assert.ok(P.PREP.tickMs >= 1000 && P.PREP.tickMs <= 5000)
})
await t('a leaves cut beside water is dammed like a dirt cut (Claude + Codex r1); control: strict water refuses it', () => {
  const cells = new Map([['0,66,0', 'dirt'], ['0,65,0', 'spruce_leaves'], ['1,65,0', 'water'], ['1,64,0', 'stone'], ['1,66,0', 'air']])
  const rd = (x, y, z) => { const n = cells.get(`${x},${y},${z}`) ?? (y <= 64 ? 'dirt' : 'air'); return { name: n, boundingBox: /air|water/.test(n) ? 'empty' : 'block' } }
  const pin = new Map([['0,0', 64]])
  const T = { ...TR.TERRACE, maxCut: 6, maxFill: 6, cutLeaves: true }
  const g = TR.gradeTerraces(rd, [-3, -3, 3, 3], { home: { x: 0, y: 64, z: 0 }, levels: [], pin, water: 'owner-1101', T })
  assert.ok(g.pins.ok, g.pins.bad.join(' '))
  assert.ok(g.cut.some(c => c.at.join(',') === '0,65,0'), 'the leaves are cut')
  assert.ok(g.dam.some(d => d.at.join(',') === '1,65,0'), 'its water is dammed first')
  const st = TR.gradeTerraces(rd, [-3, -3, 3, 3], { home: { x: 0, y: 64, z: 0 }, levels: [], pin, water: 'strict', T })
  assert.strictEqual(st.pins.ok, false)
  assert.ok((st.skipped.cut_wet ?? 0) > 0, JSON.stringify(st.skipped))
})
await t('earthBlocked: a base column to L exactly, an apron column to the nearest of its range; no read, no claim', () => {
  const col = { 64: 'dirt', 65: 'spruce_log', 66: 'spruce_log' }
  const read = (x, y) => ({ name: col[y] ?? (y < 64 ? 'dirt' : 'air') })
  assert.strictEqual(P.earthBlocked(read, 0, 0, 64, 66), true)           // the base fills 65..66 through the trunk
  assert.strictEqual(P.earthBlocked(read, 0, 0, 64, 64), false)          // nothing to fill
  assert.strictEqual(P.earthBlocked(read, 0, 0, 64, 64, 66), false)      // an apron at 64 stands within L-1..L+1
  assert.strictEqual(P.earthBlocked(read, 0, 0, 64, 65, 67), true)       // an apron raised to 65 meets the trunk
  assert.strictEqual(P.earthBlocked(null, 0, 0, 64, 66), false)
})

console.log('THE KEEPER\'S TICK (skills.mjs, structural)')
const strip = src => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/[ \t]\/\/ .*$/gm, '')
const SK = strip(readFileSync(new URL('../src/skills.mjs', import.meta.url), 'utf8'))
await t('the tick grades in chunks until PREP.tickMs, handing the event loop back between them; the screen gets the reader and the grading\'s refusals', () => {
  assert.ok(/if \(ch\.why !== 'pending' \|\| Date\.now\(\) - tick0 >= PREP\.tickMs\) break\n\s*await new Promise\(resolve => setImmediate\(resolve\)\)\n\s*check\(signal\)/.test(SK))
  assert.ok(/still: \(x, y, z\) => stillWater\(read\(x, y, z\)\), guard, hy: home\.y, read, avoid \}\)\)/.test(SK))
  const b = "if (ch.why !== 'pending' || Date.now() - tick0 >= PREP.tickMs) break"
  assert.strictEqual(SK.split(b).length, 2)
  assert.ok(!/if \(ch\.why !== 'pending' \|\| Date\.now\(\) - tick0 >= PREP\.tickMs\) break\n\s*await new Promise/.test(SK.replace(b, 'BROKEN')))
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
