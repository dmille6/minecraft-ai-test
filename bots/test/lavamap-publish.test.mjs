// LAVASIGHT-01's host publisher (scripts/host/lavasight/lavamap_publish.py) runs inside the ONE test command (CLAUDE.md):
// its behaviour tests and anchored mutants are python because the tool is, and `npm test` must not be green while they are
// red. The file it writes is also read here by the BOT's parser, so the two halves of the contract are tested together.
import assert from 'node:assert'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseLavaMap, hashedSeedOf } from '../src/lavasight.mjs'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const PUB = path.join(REPO, 'scripts/host/lavasight/lavamap_publish.py')
let pass = 0, fail = 0
const t = (name, fn) => { try { fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) } }

t('test_lavamap_publish.py: every behaviour test passes and every mutant is killed', () => {
  const r = spawnSync('python3', ['-B', path.join(REPO, 'scripts/host/lavasight/test_lavamap_publish.py')], { encoding: 'utf8', timeout: 60_000 })
  const out = (r.stdout || '') + (r.stderr || '')
  assert.equal(r.status, 0, out.split('\n').filter(l => /FAIL|SURVIVED|Error|ANCHOR/.test(l)).slice(0, 8).join('\n') || out.slice(-800))
  const m = /(\d+) of (\d+) mutants killed/.exec(out)
  assert.ok(m && m[1] === m[2] && Number(m[2]) >= 10, `mutant line: ${m && m[0]}`)
  assert.match(out, /(\d+) of \1 passed/)
})

t('lavasightread.py --selftest: every gate fails on its fixture and passes its control', () => {
  const r = spawnSync('python3', ['-B', path.join(REPO, 'scripts/host/lavasightread.py'), '--selftest'], { encoding: 'utf8', timeout: 60_000 })
  assert.equal(r.status, 0, ((r.stdout || '') + (r.stderr || '')).slice(-800))
  assert.match(r.stdout, /SELFTEST ok/)
})

t('ONE CONTRACT: what the publisher writes, the bot parses as ok for that world and pool (and for no other)', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'lavamap-contract-'))
  mkdirSync(path.join(root, '_pool-board-a'))
  const stale = new Date(Date.now() + 36 * 3600e3).toISOString().replace(/\.\d+Z$/, 'Z')
  const gen = new Date(Date.now() - 3600e3).toISOString().replace(/\.\d+Z$/, 'Z')
  const map = { schema: 'mcai.hazardmap', schema_version: 1, generated_at: gen, stale_after: stale,
                seeds: { 1239381899: { worlds: { 'board-a': {} }, hazards: [{ kind: 'lava', sightings: { cells: [[396, 69, 109, 5]] }, deaths: { total: 1, cells: [] }, exists: {} }] } } }
  writeFileSync(path.join(root, 'map.json'), JSON.stringify(map))
  // the publisher writes only after a good refresh of THIS map (its heartbeat): first without one, then with it
  const hb = path.join(root, 'heartbeat.json')
  writeFileSync(hb, JSON.stringify({ status: 'gate_failed', at: gen }))
  const w = spawnSync('python3', ['-B', PUB, 'publish', '--map', path.join(root, 'map.json'), '--root', root, '--hazard-heartbeat', hb], { encoding: 'utf8' })
  assert.equal(w.status, 0, w.stderr); assert.match(w.stdout, /"status": "waiting"/)
  writeFileSync(hb, JSON.stringify({ status: 'ok', at: gen }))
  const r = spawnSync('python3', ['-B', PUB, 'publish', '--map', path.join(root, 'map.json'), '--root', root, '--hazard-heartbeat', hb], { encoding: 'utf8' })
  assert.equal(r.status, 0, r.stderr)
  const raw = JSON.parse(readFileSync(path.join(root, '_pool-board-a', 'lava-map.json'), 'utf8'))
  const wid = hashedSeedOf('1239381899')
  const ok = parseLavaMap(raw, { worldId: wid, pool: 'board-a' })
  assert.equal(ok.state, 'ok'); assert.deepEqual(ok.cells, [{ x: 396, y: 69, z: 109 }])
  assert.equal(parseLavaMap(raw, { worldId: wid, pool: 'board-d' }).state, 'world_label')
  assert.equal(parseLavaMap(raw, { worldId: hashedSeedOf('8948499624371160708'), pool: 'board-a' }).state, 'world_mismatch')
})

console.log(`\nlavamap-publish: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
