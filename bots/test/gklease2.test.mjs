// GKLEASE-02 (control session 11-07, the effect audit's gklease-01 question). Fleet 11-06 12Z..11-07 06Z (1,647,278 skill rows, 80 bots):
// tidy places fell 916/h (17-22Z) -> 485/491/477/286/198 (23-03Z). The towns that stopped (hive-d, isolated-a, board-c, placebo-c, hive-b)
// had ZERO tidy visits by ANY bot for ~6 h after a STALLED visit wrote the town's 6-h stuck stamp (hive-d 22:17Z, isolated-a 22:38Z), and
// the stamp held although its cells were later waived: a waived TIDY cell was not "done" for the stamp (paths and walls were). Towns with
// no stamp kept or raised their tidy visits (board-a 7 -> 197 in 4 h). Two smaller costs of gklease-01 / stations-01: 141 of 392 underground
// releases were 9-12 below a plinth-high home under open sky (lake shores); 1,868 failed sweep tries on 342 strays in 8 h (per-bot give-up).
import assert from 'node:assert'
import fs from 'node:fs'
const GK = await import('../src/groundskeeper.mjs')
const ST = await import('../src/stations.mjs')
const SH = await import('../src/shop.mjs')

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 6).join('\n        ')}`) }
}
async function withMutant (file, old, neu, fn) {
  const src = fs.readFileSync(file, 'utf8')
  assert.ok(src.includes(old), `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 70))}`)
  assert.ok(src.split(old).length === 2, 'ANCHOR MISSING OR NOT UNIQUE')
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  fs.writeFileSync(out, src.replace(old, neu).replace(/from '\.\//g, "from '../src/"))
  try { return await fn(await import(out.href)) } finally { try { fs.unlinkSync(out) } catch {} }
}
const killedBy = async (file, real, old, neu, scenario) => {
  await scenario(real)
  let why = null
  await withMutant(file, old, neu, async M => { try { await scenario(M) } catch (err) { why = err } })
  assert.ok(why instanceof assert.AssertionError, `the mutant survived or died for another reason: ${why?.stack?.split('\n')[0] ?? 'survived'}`)
}
const GK_PATH = new URL('../src/groundskeeper.mjs', import.meta.url)
const ST_PATH = new URL('../src/stations.mjs', import.meta.url)
const HOME = { x: 355, y: 73, z: 147 }   // board-c: a plinth-high home
const air = { name: 'air', boundingBox: 'empty' }, stone = { name: 'stone', boundingBox: 'block' }, leaves = { name: 'oak_leaves', boundingBox: 'block' }

console.log('OPEN SKY IS THE SURFACE (groundskeeper.mjs groundsUnfit covered, columnCovered)')
await t('LIVE board-c-Alpha 23:39:30Z afloat at y 62 under open sky: fit (was `underground`); under a roof: underground; unknown: as before', async () => {
  await killedBy(GK_PATH, GK, "(covered !== false || feet[1] < home.y - (G.deepDy ?? Infinity))", '(true)', M => {
    assert.strictEqual(M.groundsUnfit({ feet: [275, 62, 169], home: HOME, covered: false }), null)
  })
  assert.strictEqual(GK.groundsUnfit({ feet: [275, 62, 169], home: HOME, covered: true }), 'underground')
  assert.strictEqual(GK.groundsUnfit({ feet: [275, 62, 169], home: HOME }), 'underground', 'not passed: gklease-01 exactly')
  assert.strictEqual(GK.groundsUnfit({ feet: [275, 40, 169], home: HOME, covered: false }), 'underground', 'an open pit 33 down is still below')
  assert.strictEqual(GK.groundsUnfit({ feet: [600, 73, 147], home: HOME, covered: false }), 'away')
})
await t('columnCovered: open sky false, a stone roof true, a leaf canopy false, an unread cell null', async () => {
  const col = m => (x, y, z) => (m[y - 62] === undefined ? air : m[y - 62])
  await killedBy(GK_PATH, GK, "if (b.boundingBox === 'block' && !/_leaves$/.test(n)) return true", "if (b.boundingBox === 'block') return true", M => {
    assert.strictEqual(M.columnCovered(col({ 6: leaves, 7: leaves }), [0, 62, 0]), false)
  })
  assert.strictEqual(GK.columnCovered(col({}), [0, 62, 0]), false)
  assert.strictEqual(GK.columnCovered(col({ 5: stone }), [0, 62, 0]), true)
  assert.strictEqual(GK.columnCovered((x, y) => (y === 66 ? null : air), [0, 62, 0]), null)
  assert.strictEqual(GK.columnCovered(col({ 1: stone }), [0, 62, 0]), false, 'the head cell (feet+1) is not a roof')
})
await t('the refusal chain: an open-sky holder at the lake keeps the lease and works; a covered one releases after the gkstay hold', () => {
  const unfit = GK.groundsUnfit({ feet: [275, 62, 169], home: HOME, covered: false })
  assert.deepStrictEqual(GK.groundsLeaseCheck({ d: 'mine', unfit, idle: false }).release ?? null, null)
  const u2 = GK.groundsUnfit({ feet: [275, 62, 169], home: HOME, covered: true })
  assert.strictEqual(GK.groundsLeaseCheck({ d: 'mine', unfit: u2, idle: false }).release, 'underground')
})

console.log('A WAIVED TIDY CELL IS DONE FOR THE STAMP (groundskeeper.mjs tidyWaived x shop.mjs stuckStale)')
const REC = { blueprint: 'tidy@1', cells: [{ at: [-206, 62, 117], role: 'earth' }, { at: [-205, 62, 117], role: 'earth' }, { at: [-204, 62, 117], role: 'earth' }], waived: { '-206,62,117': { why: 'no_stand' }, '-205,62,117': { why: 'no_stand' } } }
await t('LIVE hive-d 22:17Z: the stamp on cells the record has since waived is stale -- the town works the tidy again, not in 6 h', async () => {
  await killedBy(GK_PATH, GK, "export const tidyWaived = (r, c) => !!r?.waived", 'export const tidyWaived = (r, c) => false && !!r?.waived', M => {
    assert.strictEqual(SH.stuckStale(['-206,62,117', '-205,62,117'], REC, c => M.tidyWaived(REC, c)), true)
  })
  assert.strictEqual(SH.stuckStale(['-206,62,117', '-204,62,117'], REC, c => GK.tidyWaived(REC, c)), false, 'a cell still stuck holds it')
  assert.strictEqual(GK.tidyWaived({ cells: REC.cells }, REC.cells[0]), false)
})

console.log("THE SWEEP'S GIVE-UP IS THE TOWN'S (stations.mjs sweepTownTries / sweepTownGiven)")
const T0 = Date.parse('2026-11-07T13:00:00Z'), H = 3600_000
await t('LIVE board-a 367,66,143 (58 tries in 8 h): two bots trying it once each give it up for the town; a restart keeps it given', async () => {
  await killedBy(ST_PATH, ST, 'v.at <= now + 60_000) n += Number(v.n) || 0 }', 'v.at <= now + 60_000) n = Math.max(n, Number(v.n) || 0) }', M => {
    const maps = [{ '367,66,143': { n: 1, at: T0 } }, { '367,66,143': { n: 1, at: T0 + 60_000 } }, {}]
    assert.strictEqual(M.sweepTownTries(maps, '367,66,143', T0 + 2 * 60_000), 2)
    assert.strictEqual(M.sweepTownGiven(maps, '367,66,143', T0 + 2 * 60_000), true)
  })
  assert.strictEqual(ST.sweepTownGiven([{ '367,66,143': { n: 1, at: T0 } }], '367,66,143', T0 + 60_000), false, 'one try is not a give-up')
  assert.strictEqual(ST.sweepTownGiven([{ k: { n: 5, at: T0 } }], 'k', T0 + 7 * H), false, 'older than SWEEP.giveUpMs: asked again')
})

console.log('WIRING (skills.mjs, comments stripped)')
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
const wiring = s => {
  const one = re => { const m = s.match(new RegExp(re, 'g')); assert.strictEqual(m?.length, 1, `${re}: ${m?.length ?? 0}`) }
  one("if \\(GKL2_ON && r\\.blueprint === TIDY_BLUEPRINT && tidyWaived\\(r, c\\)\\) return true")
  one('covered: GKL2_ON \\? gkCovered\\(bot, feet\\) : null')
  one('given: k => sweepGivenUp\\(mem, k\\) \\|\\| \\(GKL2_ON && sweepTownGiven\\(townMaps, k\\)\\)')
  one("if \\(GKL2_ON && tried\\.length\\) sweepMapWrite\\(bot\\.username \\?\\? 'bot', mem\\)")
  one("const mem = \\(bot\\.stnSweepGiven \\?\\?= GKL2_ON \\? sweepMapSeed\\(bot\\.username \\?\\? 'bot'\\) : new Map\\(\\)\\)")   // Codex r1 BLOCKER: a restart keeps its tries
}
await t('recordCellDone reads a waived tidy cell done; gkUnfitNow passes the roof; the sweep reads and writes the town maps; a cut line fails', () => {
  const s = strip(fs.readFileSync(new URL('../src/skills.mjs', import.meta.url), 'utf8'))
  wiring(s)
  const cut = 'covered: GKL2_ON ? gkCovered(bot, feet) : null'
  assert.ok(s.split(cut).length === 2, 'ANCHOR MISSING OR NOT UNIQUE')
  assert.throws(() => wiring(s.replace(cut, '')), assert.AssertionError)
})

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exitCode = 1
