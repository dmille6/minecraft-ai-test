// THE BUILDING FEATURES' SPAWN WORK LIVES IN features.mjs, AND index.mjs STILL RUNS IT ONCE PER SPAWN.
//
// Fun mode (2026-10-28): index.mjs is on config/protected-paths.txt whole, so every building feature that added a
// licence row there became tier 3. The rows and the cobble-cap install were moved VERBATIM into
// src/features.mjs::installFeatures, which index.mjs's spawn handler calls from the same place they ran.
//
// Behaviour first: installFeatures on a fake bot writes every moved licence row, once, in the old order, with the
// detail each feature's own mode function computes. Then the one structural fact behaviour cannot reach: index.mjs's
// spawn handler calls installFeatures(bot) on the executable path (comments stripped; mutants prove it can fail),
// and none of the moved rows is still written from index.mjs (two writers would double every licence row).
import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

process.env.LOG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-features-logs-'))
process.env.BOT_NAME = 'FeatBot'
process.env.OLLAMA_MODEL ??= 'qwen2.5:7b-instruct'
process.env.HOME_X = '0'; process.env.HOME_Y = '64'; process.env.HOME_Z = '0'
process.env.POOL_STATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-features-pool-'))

const { tapRecords } = await import('../src/logger.mjs')
const { fakeWorld } = await import('./fakeworld.mjs')
const F = await import('../src/features.mjs')
const CC = await import('../src/cobblecap.mjs')
const L = await import('../src/lidrule.mjs')
const W = await import('../src/withdrawpick.mjs')
const TK = await import('../src/toolkit.mjs')
const PL = await import('../src/plinth.mjs')
const WC = await import('../src/wellcare.mjs')
const TI = await import('../src/townindex.mjs')
const SJ = await import('../src/smeltjob.mjs')
const BA = await import('../src/bagallowance.mjs')
const FD = await import('../src/found.mjs')

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 3).join('\n        ')}`) }
}
const RECS = []
tapRecords(r => RECS.push(r))

const MOVED = ['cobblecap_mode', 'lidclear_mode', 'townsearch_mode', 'toolkit_search_mode', 'toolkit_ironpick_mode',
  'plinth_mode', 'plinth021_mode', 'plinthfirst_mode', 'wellcare_mode', 'cobblekeep_mode', 'townindex_mode',
  'ironsmelt_mode', 'townplan_mode', 'junkout_mode']   // + found_mode, written only while FOUND.on
const SAFETY_KEPT = ['poolescape_mode', 'lavastep_mode', 'keepout_mode']
const kindOf = r => String(r.skill?.name ?? r.kind ?? '').replace(/^_/, '')

await t('BEHAVIOUR: installFeatures writes every moved licence row once, in the old order, with its feature\'s own detail', () => {
  const w = fakeWorld()
  w.bot.worldId = 'w-1'
  RECS.length = 0
  F.installFeatures(w.bot)
  const kinds = RECS.map(kindOf)
  // POSITIVE CONTROL: the tap sees rows at all (an instrument that could not see a row would pass nothing below)
  assert.ok(RECS.length >= MOVED.length, `rows seen: ${kinds.join(',')}`)
  for (const k of MOVED) assert.equal(kinds.filter(x => x === k).length, 1, `${k} written once (${kinds.join(',')})`)
  assert.equal(kinds.filter(x => x === 'found_mode').length, FD.FOUND.on ? 1 : 0, 'found_mode only while FOUND.on')
  for (const k of SAFETY_KEPT) assert.equal(kinds.includes(k), false, `${k} is NOT written here (it stays in index.mjs)`)
  const detail = k => { const r = RECS.find(x => kindOf(x) === k); return r?.skill?.detail ?? r?.detail }
  assert.equal(detail('cobblecap_mode'), CC.cobbleCapModeDetail())
  assert.equal(detail('lidclear_mode'), L.lidClearModeDetail())
  assert.equal(detail('townsearch_mode'), W.townSearchModeDetail())
  assert.equal(detail('toolkit_search_mode'), TK.kitSearchModeDetail())
  assert.equal(detail('toolkit_ironpick_mode'), TK.ironpickModeDetail())
  assert.equal(detail('plinth_mode'), PL.plinthModeDetail('w-1'))
  assert.equal(detail('wellcare_mode'), WC.wellcareModeDetail())
  assert.equal(detail('cobblekeep_mode'), CC.cobbleKeepModeDetail())
  assert.equal(detail('townindex_mode'), TI.townIndexModeDetail())
  assert.equal(detail('ironsmelt_mode'), SJ.ironsmeltModeDetail())
  assert.equal(detail('junkout_mode'), BA.junkoutModeDetail())
  assert.deepEqual(kinds.filter(k => MOVED.includes(k)), MOVED, 'same order as before the move')
})

const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const IDX = fs.readFileSync(new URL('../src/index.mjs', import.meta.url), 'utf8')
const FEAT = fs.readFileSync(new URL('../src/features.mjs', import.meta.url), 'utf8')
const wired = src => {
  const c = strip(src)
  assert.match(c, /^import \{ installFeatures \} from '\.\/features\.mjs'/m, 'imported')
  const i = c.indexOf("bot.once('spawn', () => {")
  assert.ok(i > 0, 'the spawn handler exists')
  assert.match(c.slice(i, i + 6000), /\n\s*installFeatures\(bot\)\n/, 'called in the spawn handler, on the executable path')
  for (const k of MOVED.concat('found_mode')) assert.equal(c.includes(`kind: '${k}'`), false, `${k} is no longer written from index.mjs`)
  for (const k of SAFETY_KEPT) assert.ok(c.includes(`kind: '${k}'`), `${k} still written from index.mjs (protected)`)
}

await t('WIRED (structural, comments stripped): index.mjs\'s spawn handler calls installFeatures(bot); no moved row is left there', () => {
  wired(IDX)
  const call = '    installFeatures(bot)\n'
  assert.equal(IDX.split(call).length, 2, 'ANCHOR MISSING or not unique')
  assert.throws(() => wired(IDX.replace(call, '    // installFeatures(bot)\n')), 'a commented-out call is caught')
  assert.throws(() => wired(IDX.replace(call, "    installFeatures(bot)\n    try { logEvent({ kind: 'lidclear_mode' }) } catch {}\n")), 'a row written from index.mjs again is caught')
  const keep = "kind: 'keepout_mode'"
  assert.equal(IDX.split(keep).length, 2, 'ANCHOR MISSING or not unique (keepout)')
  assert.throws(() => wired(IDX.replace(keep, "kind: 'x_mode'")), 'a safety row moved out of index.mjs is caught')
})

await t('features.mjs is not on the protected list, and index.mjs is (the call site stays tier 3)', () => {
  const list = fs.readFileSync(new URL('../../config/protected-paths.txt', import.meta.url), 'utf8')
  const entries = list.split('\n').map(l => l.split('#')[0].trim()).filter(Boolean)
  assert.ok(entries.includes('bots/src/index.mjs'), 'index.mjs listed (positive control: the parse finds entries)')
  assert.equal(entries.some(e => /features\.mjs/.test(e)), false, 'features.mjs not listed')
  assert.ok(/export function installFeatures \(bot\) \{/.test(FEAT))
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
