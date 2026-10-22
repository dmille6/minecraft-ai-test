// keepout-01 x chatgate-01 (JIT 10-22b): chatgate's prompt filter (worldfacts.mjs promptHazardKind: only the hazard kinds
// this code writes reach the model) against keep-out's world-facts writes. keep-out's fire site is a `death:fire` death site
// and its dispute is a flag on that site, not a new kind -- so the prompt still names the pool, disputed or not, and the
// file lock keep-out added never changes what is shown. Behaviour, the REAL WorldFacts on a temp file.
process.env.LOG_DIR ??= '/tmp'
process.env.STATE_DIR ??= '/tmp'
process.env.BOT_NAME = 'KoCgBot'
process.env.OLLAMA_MODEL ??= 'qwen2.5:7b-instruct'

import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const KO = await import('../src/keepout.mjs')
const { WorldFacts, promptHazardKind } = await import('../src/worldfacts.mjs')

const fresh = () => new WorldFacts(path.join(mkdtempSync(path.join(tmpdir(), 'mcai-kocg-')), 'world-facts.json'))
const here = { x: 110, y: 64, z: 100 }

test('a peer\'s fire death site is named in the prompt (positive control) and keeps out', () => {
  const wf = fresh()
  wf.reportDeath('fire', { x: 100, y: 60, z: 100 }, 'hive-b-Echo')
  assert.equal(KO.fireSites(wf.deathSites()).length, 1)
  assert.equal(promptHazardKind(KO.FIRE_KIND), true, 'death:fire is a known kind')
  assert.ok(wf.promptLines(here).some(l => l.includes(KO.FIRE_KIND) && l.includes('hive-b-Echo')), wf.promptLines(here).join(' | '))
})

test('DISPUTED by keep-out\'s lava read: it no longer keeps out, and the prompt still names it (the dispute is a flag, not a kind)', () => {
  const wf = fresh()
  wf.reportDeath('fire', { x: 100, y: 60, z: 100 }, 'hive-b-Echo')
  assert.ok(wf.disputeFireSite({ x: 100, y: 60, z: 100 }))
  assert.equal(KO.fireSites(wf.deathSites()).length, 0, 'disputed')
  assert.ok(wf.deathSites().every(s => s.kind === KO.FIRE_KIND), 'the kind is unchanged')
  assert.ok(wf.promptLines(here).some(l => l.includes(KO.FIRE_KIND)), wf.promptLines(here).join(' | '))
})

test('CONTROL: a kind this code never writes is never shown (chatgate\'s filter is live here)', () => {
  assert.equal(promptHazardKind('death:lava_party'), false)
  assert.equal(promptHazardKind('keepout'), false)
})
