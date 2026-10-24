#!/usr/bin/env node
// THE SCENE LIBRARY AS A GATE (failmine, 2026-10-24). A fix touching a failure family must pass every library scene of
// that family on the starts whose base proof reproduced the fleet's failure, and THE BASE MUST STILL FAIL THERE in the
// same session: the base run is the positive control that the scene still holds the failure today. A scene whose base
// passes is reported RETIRED (the world or the code moved under it) and is never counted as a candidate pass.
//
//   node sandbox/failmine/library-ab.mjs <baseRoot> <candidateRoot> <family|all> [server] [minutes]
//
// Runs sandbox/failmine/scene-e2e.mjs (which refuses without the `failmine` lock on SERVER) FM_REPEATS times (default 3) per
// (scene, start, build), base first, sequentially on one server (Claude r1 P2: one draw is not a verdict); per case:
//   PASS     the base matched the fleet in >= 2 of every 3 completed runs (and >= 2) AND the candidate passed every run
//   FAIL     the base reproduced and some candidate run failed the oracle
//   INVALID  the base did not reproduce (the scene is retired) or the runs did not complete; nothing is concluded from it
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const [BASE, CAND, FAMILY, SERVER = 'sandbox6', MIN] = process.argv.slice(2)
if (!BASE || !CAND || !FAMILY) throw new Error('usage: library-ab.mjs <baseRoot> <candidateRoot> <family|all> [server] [minutes]')
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const LIB = path.join(REPO, 'sandbox/scenes')
const index = JSON.parse(fs.readFileSync(path.join(LIB, 'INDEX.json'), 'utf8'))
const OUT = process.env.FM_OUT || fs.mkdtempSync(path.join(os.tmpdir(), 'failmine-ab-'))
const scenes = index.scenes.filter(s => FAMILY === 'all' || s.family === FAMILY)
if (!scenes.length) throw new Error(`no library scene of family ${FAMILY} (have: ${[...new Set(index.scenes.map(s => s.family))].join(', ')})`)
const R = Math.max(1, Number(process.env.FM_REPEATS || 3))
const run = (root, label, file, start) => {
  const r = spawnSync(process.execPath, [path.join(REPO, 'sandbox/failmine/scene-e2e.mjs'), root, label, path.join(LIB, file), SERVER, MIN || '', String(start)],
    { encoding: 'utf8', env: { ...process.env, FM_OUT: OUT }, timeout: 40 * 60_000 })
  const line = (r.stdout || '').split('\n').filter(l => l.includes(' RESULT ')).pop()
  return line ? JSON.parse(line.slice(line.indexOf(' RESULT ') + 8)) : { outcome: `no result (exit ${r.status})`, pass: null, matched_fleet: null }
}
const rows = []
for (const s of scenes) {
  for (const start of (s.reproducing_starts.length ? s.reproducing_starts : [0])) {
    const bs = [], cs = []
    for (let i = 0; i < R; i++) { bs.push(run(BASE, 'base', s.file, start)); cs.push(run(CAND, 'cand', s.file, start)) }
    const bDone = bs.filter(b => b.matched_fleet !== null && b.matched_fleet !== undefined)
    const bm = bDone.filter(b => b.matched_fleet === true).length
    const reproduced = bm >= Math.min(2, R) && bm * 3 >= bDone.length * 2 && !bs.some(b => b.pass === true)
    const cDone = cs.filter(c => c.pass === true || c.pass === false)
    const verdict = !reproduced || cDone.length < R ? 'INVALID' : cs.every(c => c.pass === true) ? 'PASS' : 'FAIL'
    rows.push({ scene: s.id, start, base: bs.map(b => b.outcome), cand: cs.map(c => c.outcome), verdict })
    console.log(`${verdict.padEnd(8)} ${s.id} start ${start}: base ${bs.map(b => b.outcome).join(', ')}${reproduced ? ` (${bm}/${bDone.length} as the fleet)` : ' (DID NOT REPRODUCE: retired)'}; candidate ${cs.map(c => c.outcome).join(', ')}`)
  }
}
const v = rows.some(r => r.verdict === 'FAIL') ? 'FAIL' : rows.every(r => r.verdict === 'PASS') ? 'PASS' : 'INVALID'
console.log(`\nLIBRARY ${FAMILY}: ${v} (${rows.filter(r => r.verdict === 'PASS').length} pass, ${rows.filter(r => r.verdict === 'FAIL').length} fail, ` +
  `${rows.filter(r => r.verdict === 'INVALID').length} invalid of ${rows.length}); results in ${OUT}/results.jsonl`)
process.exit(v === 'PASS' ? 0 : v === 'FAIL' ? 1 : 2)
