// ledger-01 PAPER DRIVER (2026-10-23). SANDBOX ONLY (10.0.0.30; sandbox/sandboxes.json, sandbox4 excluded: the model
// benchmark's). Design: docs/reports/cooperation-tier-2026-10-23.md 4.3 ("Paper") and 6.4 (Claude r9 #4, #5).
//
// THE WHOLE BOT, UNMODIFIED, from <botRoot> (run-bot.sh; the scripted `status`/short-walk brain in this process, so every
// furnace open is the bot's OWN town job: the drain, smelt_town). THE QUESTION: does every window record the ledger writes
// equal what the SERVER held in that furnace at the open? The server's truth is RCON `data get block`, never the bot's claim.
//
//   node sandbox/ledger/ledger-e2e.cjs <botRoot> <scene,...> [server] [rounds]
//   node sandbox/ledger/ledger-e2e.cjs --selftest                       (the parity rule and the scene checker, offline)
//
// scenes:
//   drains   12 town furnaces set to QUIESCENT states by RCON (never input and fuel together, unlit: nothing can change
//            between the read and the open), a town chest with no copper (smelt_town stands aside); one fresh bot per
//            round drains them. Each drain's open record must equal the furnace's RCON read taken before the bot joined
//            (EXACT, one mismatch fails); a drain row that read a window must name its record. The ledger persists across
//            rounds (one pool dir), so repeats coalesce into the newest entry and the coalesced references are checked.
//   frozen   smelt_town at ONE town furnace (quiescent preset) with the server's tick FROZEN (`tick freeze`) across the
//            load and the RCON read: the open record equals the preset, the LOAD record equals the frozen furnace exactly.
//   live     the same, unfrozen: the RCON read after the load is compared by the TIMING RULE (Claude r9 #4): a difference
//            counts as timing only when k cooking steps explain it (input -k, output +k of the recipe's result, fuel use
//            consistent with k, lit allowed); anything else is a parity failure.
//   seen     furnaceseen-01 (B3) ONLY -- run it with a furnaceseen build as <botRoot>: two bots, one empty furnace; A drains it
//            empty, B (started after) SKIPS it (a skip row naming A's entry, no open); raw copper in the chest -> smelt_town
//            loads it (newer contrary evidence); B then walks to it. B's walks replay through the bot's OWN seenSkip.
// Refuses unless a sandbox lock covering SERVER (global or per-server, on 10.0.0.31) has `ledger` as its owner's first word.
// World edits on its own arena only (900,120,900 +-16); cleanup clears it, unfreezes the tick and removes the forceload.
'use strict'
const { execFileSync, spawn } = require('child_process')
const http = require('http')
const fs = require('fs'); const path = require('path')

// ---------------------------------------------------------------- the parity rule and the scene checker (pure)
const RECIPE = { raw_copper: 'copper_ingot', raw_iron: 'iron_ingot', raw_gold: 'gold_ingot', cobblestone: 'stone', sand: 'glass' }
const BURN_ITEMS = { coal: 8, charcoal: 8, oak_planks: 1.5, stick: 0.5 }
const sameSlot = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
/** Slots equal, lit equal. */
const exactly = (r, s) => sameSlot(r.in, s.in) && sameSlot(r.fuel, s.fuel) && sameSlot(r.out, s.out) && !!r.lit === !!s.lit
/**
 * A record's slots `r` vs the server's `s` -> { verdict: 'exact' | 'timing' | 'fail', k, why }. Pure.
 * timing (only when allowTiming): k >= 0 cooking steps, input -k (same item), output +k of RECIPE[input], fuel used f with
 * 0 <= f <= floor(k / burn items) + 1 (one item ignites the furnace) AND enough burn for the k steps: f x burn items, plus at
 * most one item's worth of residual burn when the record shows the furnace LIT (Codex r1 P2-7), and something moved.
 */
function parity (r, s, { allowTiming = false } = {}) {
  if (exactly(r, s)) return { verdict: 'exact', k: 0 }
  if (!allowTiming) return { verdict: 'fail', why: `slots differ: record ${JSON.stringify(r)} server ${JSON.stringify(s)}` }
  const nm = x => x?.[0] ?? null, ct = x => x?.[1] ?? 0
  const inName = nm(r.in)
  if (!inName || !RECIPE[inName]) return { verdict: 'fail', why: 'no smeltable input in the record: no cooking explains a difference' }
  if (s.in && nm(s.in) !== inName) return { verdict: 'fail', why: `input changed item ${inName} -> ${nm(s.in)}` }
  const k = ct(r.in) - ct(s.in)
  if (k < 0) return { verdict: 'fail', why: `input grew ${ct(r.in)} -> ${ct(s.in)}` }
  const res = RECIPE[inName]
  if ((r.out && nm(r.out) !== res) || (s.out && nm(s.out) !== res) || (!s.out && k > 0)) return { verdict: 'fail', why: `output is not ${res}` }
  if (ct(s.out) - ct(r.out) !== k) return { verdict: 'fail', why: `output +${ct(s.out) - ct(r.out)} for ${k} input used` }
  if (r.fuel && s.fuel && nm(r.fuel) !== nm(s.fuel)) return { verdict: 'fail', why: 'fuel changed item' }
  if (!r.fuel && s.fuel) return { verdict: 'fail', why: 'fuel appeared' }
  const f = ct(r.fuel) - ct(s.fuel)
  const per = BURN_ITEMS[nm(r.fuel)] ?? 1
  if (f < 0 || f > Math.floor(k / per) + 1) return { verdict: 'fail', why: `fuel used ${f} for ${k} steps` }
  // a lit furnace may finish up to one fuel item's burn already under way (an unknown item: a coal's 8)
  if (f * per + (r.lit ? Math.max(per, 8) : 0) < k) return { verdict: 'fail', why: `${k} steps cooked on ${f} fuel item(s)${r.lit ? ' and one residual burn' : ' from an unlit furnace'}` }
  // ONLY THE LIT FLAG differs: timing when the record holds input AND fuel (the furnace lights on the next tick, and the
  // window's lit property can arrive after the slot update -- Claude r1 P3-4); otherwise a parity failure
  if (k === 0 && f === 0) return r.in && r.fuel && !r.lit && s.lit ? { verdict: 'timing', k: 0, f: 0 } : { verdict: 'fail', why: 'only the lit flag differs' }
  return { verdict: 'timing', k, f }
}
/** RCON `data get block <f> Items` reply -> { in, fuel, out } in the record's [name, count] form. Pure. */
function parseFurnaceItems (reply) {
  const out = { in: null, fuel: null, out: null }
  const key = { 0: 'in', 1: 'fuel', 2: 'out' }
  for (const m of String(reply).matchAll(/\{[^{}]*?Slot: (\d)b[^{}]*?\}/g)) {
    const seg = m[0]
    const id = (/id: "minecraft:([a-z0-9_]+)"/.exec(seg) || [])[1]
    const n = Number((/count: (\d+)/.exec(seg) || [])[1] || 1)
    if (id && key[m[1]]) out[key[m[1]]] = [id, n]
  }
  return out
}
/**
 * THE SCENE CHECK -> { opens, exact, timing, fails: [why], coalesced, drops }. Pure.
 *   records  the ledger's station records (this run's pool dir), drains  the `_furnace_drain` rows {detail},
 *   oracle   { f: { slots, allowTiming } } the server's read for the record ids it covers ({ byId: { id: {slots, allowTiming} } })
 *   expect   { loads: [f...] } furnaces whose smelt session must carry a load record
 */
function checkScene ({ records = [], drains = [], oracle = {}, expect = {} }) {
  const res = { opens: 0, exact: 0, timing: 0, fails: [], coalesced: 0, drops: 0, checked: 0 }
  const byId = Object.fromEntries(records.map(r => [r.id, r]))
  // every record maps to exactly one valid outcome; a coalesced one names an entry with equal slots that was the furnace's
  // newest entry at its time
  const entriesByF = {}
  for (const r of [...records].sort((a, b) => a.at - b.at || String(a.id).localeCompare(String(b.id)))) {
    if (!['entry', 'coalesced', 'drop'].includes(r.outcome)) { res.fails.push(`${r.id}: outcome ${r.outcome}`); continue }
    if (r.phase === 'open') res.opens++
    if (r.outcome === 'drop') { res.drops++; continue }
    if (r.outcome === 'coalesced') {
      res.coalesced++
      const into = byId[r.into]
      const newest = (entriesByF[r.f] ?? []).at(-1)
      if (!into || into.outcome !== 'entry') res.fails.push(`${r.id}: coalesced into ${r.into}, not an entry`)
      else if (!exactly(into.slots, r.slots)) res.fails.push(`${r.id}: coalesced into ${r.into} with different slots`)
      else if (!newest || newest.id !== into.id) res.fails.push(`${r.id}: coalesced into ${r.into}, not the newest entry (${newest?.id})`)
      continue
    }
    (entriesByF[r.f] ??= []).push(r)
  }
  // the drain row names its record, and the row's window fields equal it (L1's drain comparison: serialization)
  for (const d of drains) {
    const g = k => (new RegExp(`(?:^| )${k}=(\\S+)`).exec(d.detail) ?? [])[1]
    if ((g('out') ?? '-') === '-') continue                   // never read a window: not an open
    const id = g('ledger')
    const rec = id && byId[id]
    if (!rec) { res.fails.push(`drain at ${g('furnace')}: read a window but names no record (ledger=${id ?? 'absent'})`); continue }
    const asRow = x => (x ? x.join(':') : '0')
    if (asRow(rec.slots.out) !== g('out') || asRow(rec.slots.in) !== g('in') || asRow(rec.slots.fuel) !== g('fuel')) res.fails.push(`${id}: the drain row's out/in/fuel differ from its record`)
  }
  // the server's truth
  for (const [id, o] of Object.entries(oracle.byId ?? {})) {
    const rec = byId[id]
    if (!rec) { res.fails.push(`${id}: oracle for a record that does not exist`); continue }
    res.checked++
    const p = parity(rec.slots, o.slots, { allowTiming: !!o.allowTiming })
    if (p.verdict === 'exact') res.exact++
    else if (p.verdict === 'timing') res.timing++
    else res.fails.push(`${id} (${rec.f} ${rec.phase}): ${p.why}`)
  }
  for (const f of expect.loads ?? []) if (!records.some(r => r.f === f && r.phase === 'load')) res.fails.push(`${f}: a loading session with no post-load record`)
  return res
}

/**
 * THE `seen` SCENE CHECK (furnaceseen-01, design 6.3 B3's Paper driver) -> { pass, why: [] }. Pure.
 *   aEmpty   A's open record on F (state empty), bRows  B's rows [{ ts, name, detail }], loadAt  the first load record's time on F
 *   replay   (detail of a B drain row) -> the skip decision on its logged inputs (the bot's own seenSkip)
 */
function checkSeen ({ aEmpty, bRows = [], loadAt = null, f, replay = () => ({ skip: false }) }) {
  const why = []
  const g = (d, k) => (new RegExp(`(?:^| )${k}=(\\S+)`).exec(d) ?? [])[1]
  if (!aEmpty) why.push('A never recorded F empty')
  const skips = bRows.filter(r => r.name === '_furnace_seen_skip' && g(r.detail, 'f') === f)
  if (!skips.some(r => aEmpty && g(r.detail, 'se') === aEmpty.id)) why.push('no B skip row naming A\'s empty entry')
  const walks = bRows.filter(r => r.name === '_furnace_drain' && g(r.detail, 'furnace') === f && g(r.detail, 'out') !== '-')
  if (walks.some(r => loadAt == null || r.ts < loadAt)) why.push('B opened F before any load (the skip did not hold)')
  if (loadAt == null) why.push('no load record on F')
  else if (!walks.some(r => r.ts > loadAt)) why.push('B never walked to F after the load (the contrary evidence did not release it)')
  for (const r of walks) if (replay(r.detail).skip) why.push(`a B walk whose logged inputs replay to SKIP: ${r.detail.slice(0, 120)}`)
  return { pass: !why.length, why }
}

function selftest () {
  let bad = 0
  const ok = (name, got, want) => { const g = JSON.stringify(got), w = JSON.stringify(want); if (g !== w) { bad++; console.log(`  !! ${name}: got ${g} want ${w}`) } else console.log(`  ok ${name}`) }
  const E = { in: null, fuel: null, out: null, lit: false }
  const L = { in: ['raw_copper', 8], fuel: ['coal', 1], out: null, lit: false }
  ok('parity: identical -> exact', parity(L, { ...L }).verdict, 'exact')
  ok('parity: a wrong slot, frozen -> fail', parity(L, { ...L, in: ['raw_copper', 7] }).verdict, 'fail')
  ok('parity: ignition (fuel -1, lit) live -> timing k=0', parity(L, { ...L, fuel: null, lit: true }, { allowTiming: true }), { verdict: 'timing', k: 0, f: 1 })
  ok('parity: 2 steps cooked live -> timing k=2', parity(L, { in: ['raw_copper', 6], fuel: null, out: ['copper_ingot', 2], lit: true }, { allowTiming: true }).k, 2)
  ok('parity: output +3 for 2 used -> fail', parity(L, { in: ['raw_copper', 6], fuel: null, out: ['copper_ingot', 3], lit: true }, { allowTiming: true }).verdict, 'fail')
  ok('parity: wrong output item -> fail', parity(L, { in: ['raw_copper', 7], fuel: null, out: ['iron_ingot', 1], lit: true }, { allowTiming: true }).verdict, 'fail')
  ok('parity: 3 coal used for 1 step -> fail', parity({ ...L, fuel: ['coal', 4] }, { in: ['raw_copper', 7], fuel: ['coal', 1], out: ['copper_ingot', 1], lit: true }, { allowTiming: true }).verdict, 'fail')
  ok('parity: an UNLIT furnace with no fuel cooking 8 items -> fail (Codex r1 P2-7)', parity({ in: ['raw_copper', 8], fuel: null, out: null, lit: false }, { in: null, fuel: null, out: ['copper_ingot', 8], lit: false }, { allowTiming: true }).verdict, 'fail')
  ok('parity: a LIT furnace (residual burn) finishing 2 items with no fuel -> timing', parity({ in: ['raw_copper', 2], fuel: null, out: null, lit: true }, { in: null, fuel: null, out: ['copper_ingot', 2], lit: false }, { allowTiming: true }).verdict, 'timing')
  ok('parity: only lit differs, the record holds input and fuel -> timing (about to light)', parity(L, { ...L, lit: true }, { allowTiming: true }).verdict, 'timing')
  ok('parity: only lit differs, the record holds no fuel -> fail', parity({ ...L, fuel: null }, { ...L, fuel: null, lit: true }, { allowTiming: true }).verdict, 'fail')
  ok('parity: an empty record vs a holding server, live -> fail (no cooking explains it)', parity(E, L, { allowTiming: true }).verdict, 'fail')
  ok('RCON parse', parseFurnaceItems('900 120 905 has the following block data: [{count: 8, Slot: 0b, id: "minecraft:raw_copper"}, {count: 2, Slot: 2b, id: "minecraft:copper_ingot"}]'),
    { in: ['raw_copper', 8], fuel: null, out: ['copper_ingot', 2] })
  ok('RCON parse: an empty furnace', parseFurnaceItems('900 120 905 has the following block data: []'), { in: null, fuel: null, out: null })
  // the scene checker's fixtures (design 4.3): a correct entry; a wrong slot; a missing entry; a coalesced repeat; a capped
  // drop; an empty -> loaded session with a correct and with a missing post-load record
  const rec = (id, f, at, slots, outcome, extra = {}) => ({ t: 'station', id, f, at, slots, outcome, phase: 'open', ...extra })
  const good = [rec('a', 'F', 1, E, 'entry'), rec('b', 'F', 2, E, 'coalesced', { into: 'a' }), rec('c', 'G', 3, L, 'entry'), rec('d', 'G', 4, L, 'drop')]
  const drains = [{ detail: 'stop=empty furnace=F lease=1 out=0 in=0 fuel=0 taken=0 left=- t0=1 ledger=a' }, { detail: 'stop=busy furnace=H lease=busy out=- in=- fuel=- taken=0 left=- t0=1' }]
  const r0 = checkScene({ records: good, drains, oracle: { byId: { a: { slots: { ...E } }, c: { slots: { ...L } } } } })
  ok('scene: a correct entry, a coalesced repeat and a capped drop pass', [r0.fails, r0.exact, r0.coalesced, r0.drops, r0.opens], [[], 2, 1, 1, 4])
  ok('scene: a WRONG SLOT fails', checkScene({ records: good, oracle: { byId: { c: { slots: { ...L, fuel: ['coal', 2] } } } } }).fails.length, 1)
  ok('scene: a drain that read a window with NO record fails', checkScene({ records: good, drains: [{ detail: 'stop=empty furnace=F lease=1 out=0 in=0 fuel=0 taken=0 left=- t0=1 ledger=-' }] }).fails.length, 1)
  ok('scene: a drain row whose fields differ from its record fails', checkScene({ records: good, drains: [{ detail: 'stop=empty furnace=F lease=1 out=iron_ingot:1 in=0 fuel=0 taken=0 left=- t0=1 ledger=a' }] }).fails.length, 1)
  ok('scene: a coalesce into a NON-newest entry fails', checkScene({ records: [rec('a', 'F', 1, E, 'entry'), rec('x', 'F', 2, L, 'entry'), rec('y', 'F', 3, E, 'coalesced', { into: 'a' })] }).fails.length, 1)
  ok('scene: a coalesce with different slots fails', checkScene({ records: [rec('a', 'F', 1, E, 'entry'), rec('y', 'F', 3, L, 'coalesced', { into: 'a' })] }).fails.length, 1)
  const sess = [rec('o', 'S', 1, E, 'entry'), { ...rec('l', 'S', 2, L, 'entry'), phase: 'load' }]
  ok('scene: empty -> loaded with its post-load record passes', checkScene({ records: sess, expect: { loads: ['S'] }, oracle: { byId: { l: { slots: { ...L } } } } }).fails, [])
  ok('scene: empty -> loaded with the post-load record MISSING fails', checkScene({ records: sess.slice(0, 1), expect: { loads: ['S'] } }).fails.length, 1)
  ok('scene: cooking between two unfrozen reads is TIMING, not a failure', (() => { const r = checkScene({ records: sess, oracle: { byId: { l: { slots: { in: ['raw_copper', 7], fuel: null, out: ['copper_ingot', 1], lit: true }, allowTiming: true } } } }); return [r.fails, r.timing] })(), [[], 1])
  const A = { id: 'A-1' }
  const sk = { ts: 10, name: '_furnace_seen_skip', detail: 'f=F why=townmate_empty now=10 se=A-1 sl=- so=- off=1:9' }
  const walk = ts => ({ ts, name: '_furnace_drain', detail: `stop=empty furnace=F lease=1 out=0 in=0 fuel=0 taken=0 left=- t0=${ts} ledger=x se=L sl=- so=- off=1:9` })
  ok('seen: skip, load, walk after -> pass', checkSeen({ aEmpty: A, bRows: [sk, walk(50)], loadAt: 30, f: 'F' }).pass, true)
  ok('seen: B walked BEFORE the load -> fail', checkSeen({ aEmpty: A, bRows: [sk, walk(20), walk(50)], loadAt: 30, f: 'F' }).pass, false)
  ok('seen: no walk after the load -> fail', checkSeen({ aEmpty: A, bRows: [sk], loadAt: 30, f: 'F' }).pass, false)
  ok('seen: no skip row -> fail', checkSeen({ aEmpty: A, bRows: [walk(50)], loadAt: 30, f: 'F' }).pass, false)
  ok('seen: a walk whose inputs replay to skip -> fail', checkSeen({ aEmpty: A, bRows: [sk, walk(50)], loadAt: 30, f: 'F', replay: () => ({ skip: true }) }).pass, false)
  const dr = { scene: 'drains', pass: true, check: { exact: 36, fails: [] } }
  ok('gate: 36 drain opens alone are NOT a pass (no frozen / live load)', gateOf([dr]).gate, 'FAIL')
  ok('gate: drains + a frozen exact load + a live timing load pass', gateOf([dr, { scene: 'frozen', pass: true, openExact: true, loadVerdict: 'exact', check: { fails: [] } },
    { scene: 'live', pass: true, openExact: true, loadVerdict: 'timing', check: { fails: [] } }]).gate, 'PASS')
  ok('gate: 29 exact opens fail', gateOf([{ ...dr, check: { exact: 27, fails: [] } }, { scene: 'frozen', pass: true, openExact: true, loadVerdict: 'exact', check: { fails: [] } },
    { scene: 'live', pass: true, openExact: true, loadVerdict: 'timing', check: { fails: [] } }]).gate, 'FAIL')
  console.log(bad ? `SELFTEST FAILED (${bad})` : 'SELFTEST OK')
  return !bad
}
if (process.argv[2] === '--selftest') process.exit(selftest() ? 0 : 1)

// ---------------------------------------------------------------- the run
const sbx = require('../lib/sbxlock.cjs')
const [BOT_ROOT, SCENES_S, SERVER = 'sandbox5', ROUNDS_S = '3'] = process.argv.slice(2)
if (!BOT_ROOT || !SCENES_S) throw new Error('usage: node ledger-e2e.cjs <botRoot> <drains,frozen,live> [server] [rounds]')
const PORTS = Object.fromEntries(Object.entries(sbx.PORTS).filter(([n]) => n !== 'sandbox4'))
if (!PORTS[SERVER]) throw new Error(`sandbox servers only (${Object.keys(PORTS).join(', ')})`)
const ROUNDS = Math.max(1, Number(ROUNDS_S) || 3)
const R = process.env.LEDGER_REPO || path.resolve(__dirname, '../..')
const BOT_NAME = 'sandbox-Ledger'
const BOT_B = 'sandbox-LedgerB'
const OUTDIR = `${R}/sandbox/log/ledger-e2e`
const RES = `${OUTDIR}/results.jsonl`
const BRAIN_PORT = Number(process.env.LEDGER_BRAIN_PORT || 11493)
const RUN = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)
const POOL = `${R}/sandbox/state/ledger-${RUN}/pool`
const sleep = ms => new Promise(r => setTimeout(r, ms))
fs.mkdirSync(OUTDIR, { recursive: true }); fs.mkdirSync(POOL, { recursive: true })
let sha = '?'
try { sha = execFileSync('git', ['-C', BOT_ROOT, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() } catch {}

const SSH = ['-o', 'BatchMode=yes', '-o', 'ControlMaster=auto', '-o', `ControlPath=${process.env.HOME}/.ssh/cm-ld-%C`, '-o', 'ControlPersist=600', 'mike@10.0.0.30']
function rcon (...cmds) {
  const out = execFileSync('ssh', [...SSH, `python3 /tmp/sbx-rcon.py ${SERVER} -`], { input: cmds.join('\n') + '\n', encoding: 'utf8', timeout: 60000 })
  const res = []; let cur = null
  for (const line of out.split('\n')) { if (line.startsWith('> ')) { cur = { cmd: line.slice(2), reply: '' }; res.push(cur) } else if (cur) cur.reply += (cur.reply ? '\n' : '') + line }
  return res
}
const BAD = /not loaded|Cannot place|Unknown|Incorrect|Expected|Invalid/i
function batch (cmds) { const r = rcon(...cmds); const b = r.filter(x => BAD.test(x.reply) && !/^(kill|forceload) /.test(x.cmd)); if (b.length) throw new Error('rcon: ' + b.slice(0, 3).map(x => `${x.cmd} => ${x.reply}`).join('; ')); return r }

// ---------------------------------------------------------------- arena
const HOME = { x: 900, y: 120, z: 900 }
const HK = `${HOME.x}_${HOME.y}_${HOME.z}`
const CHEST = { x: 902, y: 120, z: 900 }
const STAND = { x: 900.5, y: 120, z: 900.5 }
const at = c => `${c.x} ${c.y} ${c.z}`
const key = c => `${c.x},${c.y},${c.z}`
const ROW = Array.from({ length: 12 }, (_, i) => ({ x: 894 + 2 * i, y: 120, z: 906 }))
const ONE = { x: 900, y: 120, z: 904 }
// QUIESCENT presets (slot 0 input, 1 fuel, 2 output): never input and fuel together, nothing a furnace could cook. No raw
// copper, so smelt_town (the copper job) stands aside in `drains`.
const PRESETS = [[], [[2, 'copper_ingot', 5]], [[0, 'raw_iron', 3]], [[1, 'coal', 2]], [[0, 'raw_gold', 4], [2, 'gold_ingot', 1]],
  [[1, 'charcoal', 1], [2, 'iron_ingot', 2]], [], [[2, 'iron_ingot', 7]], [[0, 'cobblestone', 6]], [], [[1, 'coal', 5], [2, 'copper_ingot', 3]], [[0, 'raw_iron', 1]]]
const wool = n => Array.from({ length: n }, (_, i) => ['white_wool', 1 + (i % 3)])
const BAG = [['stone_pickaxe', 1], ['torch', 8], ['bread', 5], ...wool(4)]
const arenaCmds = () => ['forceload add 880 880 920 920', 'kill @e[type=!player,x=900,y=120,z=900,distance=..24]',
  'fill 884 120 884 916 126 916 minecraft:air', 'fill 884 119 884 916 119 916 minecraft:stone']
const furnaceCmds = (f, preset) => [`setblock ${at(f)} minecraft:air`, `setblock ${at(f)} minecraft:furnace[facing=north]`,
  ...preset.map(([s, id, n]) => `item replace block ${at(f)} container.${s} with minecraft:${id} ${n}`)]
const readFurnace = f => {
  const [items, lit] = rcon(`data get block ${at(f)} Items`, `execute if block ${at(f)} minecraft:furnace[lit=true]`)
  if (!/has the following block data/.test(items?.reply ?? '')) throw new Error(`furnace ${key(f)} unreadable: ${items?.reply}`)
  return { ...parseFurnaceItems(items.reply), lit: /Test passed/.test(lit?.reply ?? '') }
}

// ---------------------------------------------------------------- logs and the ledger
const jl = f => { try { return fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean) } catch { return [] } }
const rowsOf = f => jl(f).filter(r => r.skill).map(r => ({ ts: Date.parse(r['@timestamp']), name: r.skill.name, status: r.skill.status, detail: String(r.skill.detail || '') }))
const ledger = () => fs.readdirSync(POOL).filter(n => new RegExp(`^ledger-${HK}\\.g\\d+\\.jsonl$`).test(n)).sort()
  .flatMap(n => jl(path.join(POOL, n))).filter(r => r.t === 'station')
async function waitFor (pred, ms, step = 500) { for (const t0 = Date.now(); Date.now() - t0 < ms;) { const v = pred(); if (v) return v; await sleep(step) } return null }

// ---------------------------------------------------------------- the brain (nothing queued: `status`, and two short walks)
const WANDER = [{ x: 896, y: 120, z: 895 }, { x: 904, y: 120, z: 895 }]
let brainN = 0
const brain = http.createServer((req, res) => {
  let body = ''; req.on('data', c => { body += c })
  req.on('end', () => {
    if (req.url.startsWith('/api/version')) { res.end(JSON.stringify({ version: '0.0.0-sandbox' })); return }
    if (!req.url.startsWith('/api/chat')) { res.statusCode = 404; res.end('ledger brain'); return }
    let msgs = []; try { msgs = JSON.parse(body).messages || [] } catch {}
    const sentinel = (msgs.map(m => String(m.content || '')).join('\n').match(/END-[A-Z0-9]{4,12}/g) || []).pop() || ''
    let decision = { skill: 'status', args: {} }
    if (brainN++ % 2) { const c = WANDER[(brainN >> 1) % 2]; decision = { skill: 'goto', args: { x: c.x, y: c.y, z: c.z } } }
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ model: 'sandbox-script', created_at: new Date().toISOString(), message: { role: 'assistant', content: JSON.stringify({ ...decision, reason: 'sandbox: idle', saw_end: sentinel }) },
      done: true, total_duration: 1e6, load_duration: 0, prompt_eval_count: 10, prompt_eval_duration: 5e5, eval_count: 5, eval_duration: 5e5 }))
  })
})

let procs = []
let frozen = false
async function stopBot () {
  for (const b of procs) { try { b.kill('SIGTERM') } catch {} }
  procs = []
  await waitFor(() => /There are 0 of/.test(rcon('list')[0].reply), 30000, 1000)
}
async function startBot (tag, NAME = BOT_NAME) {
  const logRel = `./sandbox/log/ledger-e2e/${tag}`
  const envRel = `sandbox/.env.ledger-${NAME}`
  let env = fs.readFileSync(`${R}/sandbox/sandbox-bot-scripted.env`, 'utf8')
  const set = (k, v) => { env = new RegExp(`^${k}=`, 'm').test(env) ? env.replace(new RegExp(`^${k}=.*$`, 'm'), `${k}=${v}`) : env + `\n${k}=${v}` }
  set('BOT_NAME', NAME); set('LOG_DIR', logRel); set('STATE_DIR', `./sandbox/state/ledger-${RUN}/${tag}-${NAME}`); set('MEMORY_POOL', `sbxld-${RUN}`)
  set('MEMORY_SCOPE', 'shared'); set('POOL_STATE_DIR', POOL); set('MINECRAFT_PORT', PORTS[SERVER]); set('STUCK_SECONDS', 20); set('PLANT_ENABLED', 0)
  set('SMELT_JOB_COOLDOWN_MS', 10000); set('DRAIN_COOLDOWN_MS', 10000)        // sandbox pacing only
  set('OLLAMA_BASE_URL', `http://127.0.0.1:${BRAIN_PORT}`); set('OLLAMA_BASE_URLS', `http://127.0.0.1:${BRAIN_PORT}`); set('MAX_CONSECUTIVE_FAILURES', 50)
  for (const a of ['X', 'Y', 'Z']) { set(`HOME_${a}`, HOME[a.toLowerCase()]); set(`BOARD_${a}`, HOME[a.toLowerCase()]) }
  fs.writeFileSync(`${R}/${envRel}`, env + '\n')
  const botOut = `${OUTDIR}/bot-${tag}-${NAME}.out`
  const bo = fs.openSync(botOut, 'a')
  procs.push(spawn('bash', [`${R}/sandbox/run-bot.sh`, envRel], { cwd: R, env: { ...process.env, BOT_ROOT }, stdio: ['ignore', bo, bo] }))
  const spawned = () => { try { return /spawned pos=/.test(fs.readFileSync(botOut, 'utf8')) } catch { return false } }
  if (!await waitFor(spawned, 90000, 300)) { await stopBot(); throw new Error('no spawn') }
  rcon(`gamemode survival ${NAME}`, `effect clear ${NAME}`, `clear ${NAME}`, `tp ${NAME} ${STAND.x} ${STAND.y} ${STAND.z}`,
       ...BAG.map(([id, n], s) => `item replace entity ${NAME} container.${s} with minecraft:${id} ${n}`))
  return `${R}/sandbox/log/ledger-e2e/${tag}/skill-${NAME}.jsonl`
}

async function drains (round) {
  const tag = `drains-r${round}-${RUN.slice(9)}`
  const presets = ROW.map((_, i) => PRESETS[(i + 5 * round) % PRESETS.length])
  batch([...arenaCmds(), `setblock ${at(CHEST)} minecraft:chest[facing=west]`, `item replace block ${at(CHEST)} container.0 with minecraft:coal 4`,
         `item replace block ${at(CHEST)} container.1 with minecraft:oak_sapling 3`, ...ROW.flatMap((f, i) => furnaceCmds(f, presets[i]))])
  await sleep(1500)
  const pre = Object.fromEntries(ROW.map(f => [key(f), readFurnace(f)]))       // the server's truth BEFORE the bot exists
  const before = new Set(ledger().map(r => r.id))
  const log = await startBot(tag)
  const t0 = Date.now()
  // every furnace opened once (12 drain rows that read a window), or the window ends
  const done = await waitFor(() => rowsOf(log).filter(r => r.name === '_furnace_drain' && !/ out=- /.test(` ${r.detail} `)).length >= ROW.length, Number(process.env.LEDGER_WINDOW_MS || 900000), 2000)
  await sleep(3000)
  const rows = rowsOf(log)
  await stopBot()
  const recs = ledger()
  const mine = recs.filter(r => !before.has(r.id))
  const firstOpen = {}
  for (const r of mine.filter(x => x.phase === 'open').sort((a, b) => a.at - b.at)) firstOpen[r.f] ??= r
  // the oracle covers the FIRST open of each furnace this round (the quiescent preset); a second open of a drained
  // furnace is reported, not compared (its state is the drain's own result)
  const oracle = { byId: Object.fromEntries(Object.entries(firstOpen).filter(([f]) => pre[f]).map(([f, r]) => [r.id, { slots: pre[f] }])) }
  const v = checkScene({ records: recs, drains: rows.filter(r => r.name === '_furnace_drain'), oracle })
  const reopened = mine.filter(r => r.phase === 'open').length - Object.keys(firstOpen).length
  const out = { scene: 'drains', round, tag, sha, server: SERVER, done: !!done, windowMs: Date.now() - t0, furnaces: ROW.length, opened: Object.keys(firstOpen).length,
    reopened, records: mine.length, outcomes: countBy(mine, r => r.outcome), check: v, mode: rows.find(r => r.name === '_ledger_mode')?.detail ?? null,
    stationRows: rows.filter(r => r.name === '_ledger_station').length }
  out.pass = !!done && !v.fails.length && v.checked === ROW.length && out.stationRows === mine.length && /on=on/.test(out.mode ?? '')
  return out
}

async function smelt (scene, round) {
  const tag = `${scene}-r${round}-${RUN.slice(9)}`
  const preset = [[], [[2, 'copper_ingot', 2]], [[1, 'coal', 1]]][round % 3]
  batch([...arenaCmds(), `setblock ${at(CHEST)} minecraft:chest[facing=west]`, `item replace block ${at(CHEST)} container.0 with minecraft:raw_copper 8`,
         `item replace block ${at(CHEST)} container.1 with minecraft:coal 4`, ...furnaceCmds(ONE, preset)])
  await sleep(1500)
  const pre = readFurnace(ONE)
  const before = new Set(ledger().map(r => r.id))
  if (scene === 'frozen') { const r = rcon('tick freeze')[0]?.reply ?? ''; if (!/frozen/i.test(r)) throw new Error('tick freeze refused: ' + r); frozen = true }
  let post = null, loadAt = null, rows = []
  try {
    const log = await startBot(tag)
    const t0 = Date.now()
    const load = await waitFor(() => ledger().find(r => !before.has(r.id) && r.f === key(ONE) && r.phase === 'load'), Number(process.env.LEDGER_WINDOW_MS || 600000), 250)
    if (load) { post = readFurnace(ONE); loadAt = Date.now() - load.at }
    if (frozen) { rcon('tick unfreeze'); frozen = false }
    await waitFor(() => rowsOf(log).some(r => r.name === '_smelt_town' && r.ts >= t0), 240000, 2000)
    await sleep(3000)
    rows = rowsOf(log)
  } finally { if (frozen) { try { rcon('tick unfreeze') } catch {} frozen = false } await stopBot() }
  const recs = ledger()
  const mine = recs.filter(r => !before.has(r.id) && r.f === key(ONE))
  const open = mine.filter(r => r.phase === 'open').sort((a, b) => a.at - b.at)[0]
  const load = mine.filter(r => r.phase === 'load').sort((a, b) => a.at - b.at)[0]
  const byId = {}
  if (open) byId[open.id] = { slots: pre }
  if (load && post) byId[load.id] = { slots: post, allowTiming: scene === 'live' }
  const v = checkScene({ records: recs, oracle: { byId }, expect: { loads: [key(ONE)] } })
  const sess = rows.filter(r => r.name === '_furnace_session' && r.detail.includes(`furnace=${key(ONE)}`)).map(r => r.detail)
  const out = { scene, round, tag, sha, server: SERVER, preset, pre, post, readAfterLoadMs: loadAt, records: mine.length, open: open ?? null, load: load ?? null, check: v,
    sessionRow: sess[0] ?? null, smeltTown: rows.filter(r => r.name === '_smelt_town').map(r => r.detail.slice(0, 200)) }
  out.openExact = !!open && parity(open.slots, pre).verdict === 'exact'
  out.loadVerdict = load && post ? parity(load.slots, post, { allowTiming: scene === 'live' }).verdict : null
  out.pass = !!open && !!load && !!post && !v.fails.length && (!open || (sess[0] ?? '').includes(` open=${open.id} `))
  return out
}
// THE `seen` SCENE (furnaceseen-01): two bots, one empty furnace. A drains it and finds it empty; B (started after) SKIPS it
// (a `_furnace_seen_skip` row naming A's entry, no open); raw copper in the chest -> smelt_town LOADS it (a load record:
// newer contrary evidence); B then walks to it on its next drain. B's walks are replayed through the BOT'S OWN seenSkip.
async function seen (round) {
  const tag = `seen-r${round}-${RUN.slice(9)}`
  batch([...arenaCmds(), `setblock ${at(CHEST)} minecraft:chest[facing=west]`, `item replace block ${at(CHEST)} container.0 with minecraft:coal 4`,
         `item replace block ${at(CHEST)} container.1 with minecraft:oak_sapling 3`, ...furnaceCmds(ONE, [])])
  await sleep(1500)
  const F = key(ONE)
  const before = new Set(ledger().map(r => r.id))
  let aEmpty = null, loadAt = null, bRows = []
  try {
    await startBot(tag, BOT_NAME)
    aEmpty = await waitFor(() => ledger().find(r => !before.has(r.id) && r.f === F && r.phase === 'open' && r.state === 'empty' && r.bot === BOT_NAME), 300000, 1000)
    if (!aEmpty) throw new Error('A never drained F')
    const logB = await startBot(tag, BOT_B)
    const skipped = await waitFor(() => rowsOf(logB).some(r => r.name === '_furnace_seen_skip'), 240000, 1000)
    await sleep(30000)                         // B's drain cooldown passes at least twice with the skip in force
    rcon(`item replace block ${at(CHEST)} container.2 with minecraft:raw_copper 2`)
    const load = await waitFor(() => ledger().find(r => !before.has(r.id) && r.f === F && r.phase === 'load'), 300000, 1000)
    loadAt = load?.at ?? null
    if (skipped && load) await waitFor(() => rowsOf(logB).some(r => r.name === '_furnace_drain' && r.ts > load.at && r.detail.includes(`furnace=${F} `) && !/ out=- /.test(` ${r.detail} `)), 420000, 2000)
    await sleep(3000)
    bRows = rowsOf(logB)
  } finally { await stopBot() }
  process.env.OLLAMA_MODEL ??= 'qwen2.5:7b-instruct'
  const SJ = await import(path.join(BOT_ROOT, 'bots/src/smeltjob.mjs'))
  const recs = ledger()
  const byId = Object.fromEntries(recs.map(r => [r.id, r]))
  const g = (d, k) => (new RegExp(`(?:^| )${k}=(\\S+)`).exec(d) ?? [])[1]
  const replay = d => {
    const se = g(d, 'se'); const e = se && se !== '-' ? byId[se] : null
    const so = g(d, 'so'); const own = so && so !== '-' ? { empty: so[0] === 'e', at: Number(so.split(':')[1]) } : null
    const sl = g(d, 'sl')
    return SJ.seenSkip({ entry: e ? { id: e.id, at: e.at, bot: e.bot, state: e.state } : null, litAt: sl && sl !== '-' ? Number(sl) : null, own, me: BOT_B, now: Number(g(d, 't0')) })
  }
  const v = checkSeen({ aEmpty, bRows, loadAt, f: F, replay })
  return { scene: 'seen', round, tag, sha, server: SERVER, pass: v.pass, why: v.why, aEmpty: aEmpty?.id ?? null, loadAt,
    bSkips: bRows.filter(r => r.name === '_furnace_seen_skip').map(r => r.detail), bDrains: bRows.filter(r => r.name === '_furnace_drain').map(r => `${r.ts} ${r.detail.slice(0, 200)}`),
    check: { checked: 0, fails: v.why } }
}
/**
 * THE PAPER GATE (design 4.3) -> { gate, opensExact, loadsFrozen, loadsLive, fails, missing }. Pure. PASS needs >= 30 opens
 * checked EXACTLY against the server (drain opens + smelt opens), at least one frozen-tick LOAD checked exactly, at least one
 * live LOAD read by the timing rule, every round passing, and no failure (Codex r1 P2-8: drains alone are not the gate).
 */
function gateOf (all) {
  const opensExact = all.reduce((n, r) => n + (r.scene === 'drains' ? (r.check?.exact ?? 0) : 0) + (['frozen', 'live'].includes(r.scene) && r.openExact ? 1 : 0), 0)
  const loadsFrozen = all.filter(r => r.scene === 'frozen' && r.pass && r.loadVerdict === 'exact').length
  const loadsLive = all.filter(r => r.scene === 'live' && r.pass && ['exact', 'timing'].includes(r.loadVerdict)).length
  const fails = all.reduce((n, r) => n + (r.check?.fails?.length ?? 0) + (r.error ? 1 : 0), 0)
  const smeltOpens = all.filter(r => ['frozen', 'live'].includes(r.scene) && r.openExact).length
  const missing = [opensExact >= 30 ? null : `opens checked exactly ${opensExact} < 30`, smeltOpens ? null : 'no smelt-type open checked exactly',
    loadsFrozen ? null : 'no frozen load checked',
    loadsLive ? null : 'no live load checked'].filter(Boolean)
  return { gate: !missing.length && !fails && all.every(r => r.pass) ? 'PASS' : 'FAIL', opensExact, loadsFrozen, loadsLive, fails, missing }
}
const countBy = (xs, f) => xs.reduce((m, x) => { m[f(x)] = (m[f(x)] || 0) + 1; return m }, {})

let armed = false                 // the lock is ours AND the server was empty: only then may cleanup touch the world
async function main () {
  sbx.requireSandboxLock(SERVER, 'ledger')
  const pl = rcon('list')[0].reply; if (!/There are 0 of/.test(pl)) throw new Error('sandbox not empty: ' + pl)
  armed = true
  await new Promise((resolve, reject) => { brain.once('error', reject); brain.listen(BRAIN_PORT, '127.0.0.1', resolve) })
  console.log(`root=${BOT_ROOT} sha=${sha} server=${SERVER} scenes=${SCENES_S} rounds=${ROUNDS} pool=${POOL}`)
  const all = []
  for (const s of SCENES_S.split(',')) {
    for (let k = 0; k < ROUNDS; k++) {
      let r
      try { r = s === 'drains' ? await drains(k) : s === 'seen' ? await seen(k) : await smelt(s, k) } catch (e) { r = { scene: s, round: k, pass: false, error: e.message }; await stopBot().catch(() => {}) }
      fs.appendFileSync(RES, JSON.stringify({ at: new Date().toISOString(), ...r }) + '\n')
      console.log(`${s} r${k} ${r.pass ? 'PASS' : 'FAIL'} ${r.error ?? ''} checked=${r.check?.checked} exact=${r.check?.exact} timing=${r.check?.timing} coalesced=${r.check?.coalesced} drops=${r.check?.drops}` +
        (r.check?.fails?.length ? `\n   fails: ${r.check.fails.join('; ')}` : '') + (r.outcomes ? ` outcomes=${JSON.stringify(r.outcomes)} reopened=${r.reopened}` : ''))
      all.push(r)
    }
  }
  const summary = { at: new Date().toISOString(), summary: true, sha, server: SERVER, ...gateOf(all), rounds: all.length, passed: all.filter(r => r.pass).length,
    synthetic: 'arena and furnace presets by RCON; bot teleported to town with a light bag; scripted brain (status/short walks); sandbox pacing 10 s' }
  fs.appendFileSync(RES, JSON.stringify(summary) + '\n')
  console.log('SUMMARY ' + JSON.stringify(summary))
  return summary.gate === 'PASS'
}
async function cleanup () {
  if (!armed) { try { brain.close() } catch {} return }        // refused before the lock or on a busy server: touch nothing
  await stopBot().catch(() => {})
  try { brain.close() } catch {}
  for (const n of [BOT_NAME, BOT_B]) { try { fs.unlinkSync(`${R}/sandbox/.env.ledger-${n}`) } catch {} }
  try { rcon('tick unfreeze', 'kill @e[type=!player,x=900,y=120,z=900,distance=..24]', 'fill 884 120 884 916 126 916 minecraft:air', 'forceload remove 880 880 920 920') } catch {}
}
let cleaning = false
const finish = code => { if (cleaning) return; cleaning = true; cleanup().then(() => process.exit(code)) }
main().then(ok => finish(ok ? 0 : 2), e => { console.error('FATAL', e.message); finish(1) })
process.on('SIGINT', () => finish(1))
process.on('SIGTERM', () => finish(1))
