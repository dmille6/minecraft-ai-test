// USELEDGER-01 (src/useledger.mjs): the town's use ledger -- the lines, the fold, the week's table, the refill rule's evidence, and the
// host script (scripts/host/useledger.py) held to the same fixture. Behaviour, mutants, then the wiring.
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, unlinkSync, mkdtempSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.LOG_DIR = `/tmp/mcbot-test-logs-useledger-${process.pid}`
process.env.BOT_NAME = 'TestBot'
const U = await import('../src/useledger.mjs')

let failed = 0
const t = async (name, fn) => { try { await fn(); console.log(`ok - ${name}`) } catch (e) { failed++; console.log(`not ok - ${name}\n  ${e?.stack ?? e}`) } }
const P = n => new URL(`../src/${n}.mjs`, import.meta.url)
async function withMutant (path, old, neu, fn) {
  const src = readFileSync(path, 'utf8')
  assert.ok(src.split(old).length === 2, `ANCHOR MISSING OR NOT UNIQUE: ${JSON.stringify(old.slice(0, 70))} in ${path.pathname} (a mutant that was never written reads as killed)`)
  const out = new URL(`../src/_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, src.replace(old, neu))
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}
const killedBy = async (path, real, old, neu, scenario) => {
  await scenario(real)
  let why = null
  await withMutant(path, old, neu, async M => { try { await scenario(M) } catch (err) { why = err } })
  assert.ok(why instanceof assert.AssertionError, `the mutant survived or died for another reason: ${why?.stack?.split('\n')[0] ?? 'survived'}`)
}
const strip = src => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
const one = (src, re, what) => assert.equal((src.match(new RegExp(re, 'g')) ?? []).length, 1, `${what}: expected exactly one executable line matching ${re}`)

const NOW = Date.parse('2026-11-23T12:00:00Z'), H = 3_600_000, D = 24 * H
const L = (d, names, why, ago, bot = 'Alpha') => U.ledgerLine({ d, names, why, bot, now: NOW - ago })
// a week of a town: cobblestone banked and drawn for builds; gravel banked and never drawn; coal drawn for smelts; andesite over its cap
const WEEK = [
  L('in', { cobblestone: 128, gravel: 40 }, 'yard', 6 * D), L('in', { gravel: 24, coal: 30 }, 'town_deposit', 5 * D),
  L('out', { cobblestone: 64 }, 'build', 4 * D), L('out', { cobblestone: 20 }, 'yard_draw', 3 * D), L('out', { coal: 8 }, 'smelt', 2 * D), L('out', { coal: 8, cobblestone: 4 }, 'smelt', 1 * D),
  L('move', { moss_block: 410 }, 'move', 2 * D), L('waste', { andesite: 64 }, 'over_cap', 1 * D),
  L('stock', { cobblestone: 900, gravel: 64, coal: 300, moss_block: 410, andesite: 328 }, 'index+yard', 3 * D), L('stock', { cobblestone: 944, gravel: 64, coal: 284, moss_block: 410, andesite: 328, tuff: 12 }, 'index+yard', 2 * H),
  L('in', { cobblestone: 999 }, 'yard', 30 * D),   // outside the week
  'not json', '',
]

await t('a line: the kind, the reason, the bot, positive whole counts only; nothing to say is no line; USELEDGER=off is the switch', () => {
  assert.deepEqual(JSON.parse(U.ledgerLine({ d: 'out', names: { coal: 8, air: 0, x: -3, stick: 2.9 }, why: 'smelt', bot: 'Alpha', now: 5, world: 'w1' })), { t: 5, d: 'out', w: 'smelt', b: 'Alpha', g: 'w1', n: { coal: 8, stick: 2 } })
  assert.equal(U.ledgerLine({ d: 'out', names: { coal: 0 } }), null)
  assert.equal(U.ledgerLine({ d: 'banana', names: { coal: 1 } }), null)
  assert.equal(U.useLedgerOn({}), true); assert.equal(U.useLedgerOn({ USELEDGER: 'off' }), false)
  assert.equal(U.ledgerFileName({ x: 0, y: 70, z: 0 }), 'use-ledger-0_70_0.jsonl')
})
await t('THE FOLD over a week: in, out by consumer, draws, last use, waste; a move is never a use; the newest stock line stands; lines outside the window do not count', () => {
  const f = U.foldLedger(WEEK, { since: NOW - 7 * D, until: NOW + 1 })
  assert.equal(f.lines, 8); assert.equal(f.bad, 1, 'the unreadable line is counted, never silently dropped')
  const c = f.kinds.cobblestone
  assert.deepEqual([c.in, c.out, c.draws, c.stock], [128, 88, 3, 944]); assert.deepEqual(c.by, { build: 64, yard_draw: 20, smelt: 4 })
  assert.equal(c.lastOut, NOW - 1 * D)
  assert.deepEqual([f.kinds.gravel.in, f.kinds.gravel.out, f.kinds.gravel.draws], [64, 0, 0])
  assert.deepEqual([f.kinds.moss_block.move, f.kinds.moss_block.out, f.kinds.moss_block.draws], [410, 0, 0], 'the clerk\'s merge is storage to storage')
  assert.equal(f.kinds.andesite.waste, 64)
  assert.equal(f.kinds.tuff.stock, 12, 'a kind only the stock line names is in the table')
  assert.deepEqual(Object.keys(c.days).sort(), ['2026-11-17', '2026-11-19', '2026-11-20', '2026-11-22'])
  assert.equal(U.foldLedger(WEEK, { since: NOW - 40 * D, until: NOW + 1 }).kinds.cobblestone.in, 1127, 'positive control: the older line is there')
  assert.equal(U.foldLedger([L('in', { coal: 5 }, 'x', D)].map(s => s.replace('{"t"', '{"g":"other","t"')), { since: 0, world: 'mine' }).lines, 0, 'another world\'s lines are not this one\'s')
})
await t('THE TABLE: the kinds nobody drew come first (the well\'s candidates), then by what was drawn; a kind drawn once is no candidate', () => {
  const rows = U.useTable(U.foldLedger(WEEK, { since: NOW - 7 * D, until: NOW + 1 }))
  assert.deepEqual(rows.filter(r => r.candidate).map(r => r.kind).sort(), ['andesite', 'gravel', 'moss_block', 'tuff'])
  assert.deepEqual(rows.filter(r => !r.candidate).map(r => r.kind), ['cobblestone', 'coal'], 'used kinds, most drawn first')
  assert.ok(rows.findIndex(r => r.kind === 'gravel') < rows.findIndex(r => r.kind === 'cobblestone'))
})
await t('USED REGULARLY (the refill rule\'s evidence): 3 draws or 64 items in the window by a named consumer; a kind nobody draws is never "used"', () => {
  const f2 = U.foldLedger(WEEK, { since: NOW - 4 * D - 1, until: NOW + 1 })
  assert.deepEqual(U.usedRegularly(f2, 'cobblestone', { days: 4 }), { used: true, draws: 3, items: 88, perDay: 22 })
  assert.equal(U.usedRegularly(f2, 'coal', { days: 4 }).used, false, '2 draws, 16 items: not yet')
  assert.equal(U.usedRegularly(f2, 'coal', { days: 4, minDraws: 2 }).used, true)
  assert.deepEqual(U.usedRegularly(f2, 'gravel'), { used: false, draws: 0, items: 0, perDay: 0 })
  assert.equal(U.usedRegularly(f2, 'moss_block').used, false, 'a move is not a use')
})
await t('THE HOST SCRIPT prints the same table from the same file (its fold is this fold); an empty window prints no table', () => {
  const dir = mkdtempSync(join(tmpdir(), 'useledger-'))
  const file = join(dir, 'use-ledger-0_70_0.jsonl')
  writeFileSync(file, WEEK.filter(Boolean).map(l => `\n${l}`).join(''))
  const py = new URL('../../scripts/host/useledger.py', import.meta.url).pathname
  const out = execFileSync('python3', [py, dir, '--days', '7', '--now', String(NOW)], { encoding: 'utf8' })
  assert.match(out, /^use ledger: 1 file\(s\), 8 line\(s\) in the last 7 d .*in 2, out 4, move 1, waste 1; stock lines 2 .*unreadable 1/m)
  assert.match(out, /^cobblestone\s+944\s+128\s+88\s+3\s+11-22 12:00Z\s+0\s+build:64 yard_draw:20 smelt:4$/m)
  assert.match(out, /^gravel\s+64\s+64\s+0\s+0\s+-\s+0\s+-- WELL CANDIDATE \(no draw\)$/m)
  assert.match(out, /^andesite\s+328\s+0\s+0\s+0\s+-\s+64\s+-- WELL CANDIDATE/m)
  assert.match(out, /^4 candidate\(s\) for the well .* of 6 kind\(s\) seen$/m)
  assert.ok(out.indexOf('gravel') < out.indexOf('cobblestone '), 'candidates first')
  // the same candidates as the module's table
  const mine = U.useTable(U.foldLedger(WEEK, { since: NOW - 7 * D, until: NOW + 1 })).filter(r => r.candidate).map(r => r.kind).sort()
  assert.deepEqual([...out.matchAll(/^(\S+)\s.*WELL CANDIDATE/gm)].map(m => m[1]).sort(), mine)
  let code = 0, text = ''
  try { text = execFileSync('python3', [py, dir, '--days', '0.0001', '--now', String(NOW - 400 * D)], { encoding: 'utf8' }) } catch (e) { code = e.status; text = String(e.stdout) }
  assert.equal(code, 1); assert.match(text, /NOTHING READ in the window: no table/)
})
await t('MUTANTS KILLED: a move counted as a use; the window ignored; an older stock line winning; a drawn kind called a candidate', async () => {
  const UP = P('useledger')
  const wk = M => M.foldLedger(WEEK, { since: NOW - 7 * D, until: NOW + 1 })
  await killedBy(UP, U, "      if (r.d === 'out') { k.by[r.w ?? '-']", "      if (r.d === 'out' || r.d === 'move') { k.by[r.w ?? '-']", M => assert.equal(wk(M).kinds.moss_block.draws, 0))
  await killedBy(UP, U, '    if (!(r.t >= since && r.t < until)) continue\n', '', M => assert.equal(wk(M).kinds.cobblestone.in, 128))
  await killedBy(UP, U, "if (r.t >= newestStock && r.t < until) { newestStock = r.t; stockNames = r.n }", "if (r.t < until) { newestStock = r.t; stockNames = r.n }", M => assert.equal(M.foldLedger([...WEEK].reverse(), { since: NOW - 7 * D, until: NOW + 1 }).kinds.cobblestone.stock, 944))
  await killedBy(UP, U, '    candidate: k.draws === 0 && ((k.stock ?? 0) > 0 || k.in > 0) }))', '    candidate: ((k.stock ?? 0) > 0 || k.in > 0) }))', M => assert.equal(M.useTable(wk(M)).find(r => r.kind === 'cobblestone').candidate, false))
})
await t('WIRED: every verified take and every deposit record writes its line; a clerk\'s is a move; the piles\' intake, the draw, the cap\'s waste, the stock', () => {
  const sk = strip(readFileSync(P('skills'), 'utf8'))
  one(sk, "if \\(v\\?\\.verified && v\\.moved\\?\\.took\\) useNote\\(ctx\\.bot, why === 'move' \\? 'move' : why === 'prune' \\? 'waste' : 'out', v\\.moved\\.took, why\\)", 'the takes')
  assert.equal((sk.match(/await withdrawVisit\(/g) ?? []).length, 10, 'ten callers (indexfetch-01show: the fetch trip), every one through the wrapper')
  one(sk, "const why = decide\\?\\.name === 'pickDecision' \\? 'tool' : decide\\?\\.name === 'ingredientDecision' \\? 'craft' : String\\(ctx\\?\\.bot\\?\\.useWhy \\?\\? 'other'\\)", 'the consumer is named')
  for (const w of ['withdraw', 'prune', 'toolkit', 'smelt']) assert.equal((sk.match(new RegExp(`\\.useWhy = '${w}'`, 'g')) ?? []).length, 1, w)
  assert.equal((sk.match(/ctx\.bot\.useWhy = 'move'/g) ?? []).length, 2, 'the two clerks')
  one(sk, 'bot\\.useWhy = why', 'a build\'s bill, or the caller\'s word')
  one(sk, 'if \\(!USELEDGER\\.on \\|\\| !LANES\\.on \\|\\| !bot\\) return false', 'only where the lanes are')
  one(sk, "useNote\\(bot, by === 'sort_tidy' \\|\\| by === 'compact' \\? 'move' : 'in', names, by\\)", 'the deposits')
  one(sk, "if \\(nPlaced > 0\\) useNote\\(bot, w\\.kind === 'clerk' \\? 'move' : 'in', f\\.placed, 'yard'\\)", 'the piles')
  one(sk, "useNote\\(bot, drawing \\? 'out' : 'move', \\{ cobblestone: got \\}, drawing \\? 'yard_draw' : 'yard_refill'\\)", 'a consumer\'s draw from the piles')
  one(sk, "if \\(k\\.over\\) useNote\\(bot, 'waste', \\{ \\[name\\]: n \\}, 'over_cap'\\)", 'the cap\'s waste')
  one(sk, "if \\(!st \\|\\| !\\(st\\.known > 0\\)\\) return", 'never a stock line of zeros from an unread index')
})

if (failed) { console.log(`\n${failed} FAILED`); process.exit(1) }
console.log('\nall useledger tests passed')
