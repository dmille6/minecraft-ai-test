// A RESCUE SKILL MUST NEVER BECOME AN AVOID RULE, AND A FAILED CLIMB MUST
// SAY WHAT WOULD FIX IT.
//
// Avoid keys are skill+args, and surface/home take no args -- so every failure
// anywhere pooled into ONE context-free rule ("surfacing fails"), observed
// live as explore:{} fails=29 blocking exploration fleet-wide. A bot that
// failed to climb out of one wet cave learned not to try climbing ANYWHERE:
// learned helplessness, implemented by accident. Measured consequence,
// 2026-08-11/12: four of four isolated bots stuck deep underground while the
// watchdog's forced climb-outs fought the bots' own learned reluctance.
//
// Layer two: the shaft KNOWS why it stopped ("no scaffold blocks left") and
// the model used to see only that a climb failed. A failure that carries its
// own recipe is a lesson; one that does not is just a bruise.
import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcai-rescue-'))
process.env.LOG_DIR ??= dir
process.env.LOG_LEVEL ??= 'error'
const { Lessons } = await import('../src/lessons.mjs')
const { climbAdvice, SKILLS } = await import('../src/skills.mjs')

let pass = 0, fail = 0
const t = (name, fn) => {
  try { fn(); pass++; console.log(`  PASS  ${name}`) }
  catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) }
}

// --- the exemption ---------------------------------------------------------
t('surface and home are marked rescue in the registry', () => {
  assert.equal(SKILLS.surface.rescue, true)
  assert.equal(SKILLS.home.rescue, true)
  assert.ok(!SKILLS.gather.rescue, 'gather is not a rescue skill')
})

t('a surface failure records NO avoid rule', () => {
  const l = new Lessons(path.join(dir, 'a.json'))
  l.recordFailure('surface', {}, 'stranded', { x: 0, y: -42, z: 0 })
  l.recordFailure('surface', {}, 'stranded', { x: 0, y: -42, z: 0 })
  assert.equal(l.failCount('surface', {}), 0,
    'the one class of action whose suppression can only hurt must never be suppressed')
  assert.equal(l.entryFor('surface', {}), null)
})

t('home failures are exempt too, ordinary skills still accrue', () => {
  const l = new Lessons(path.join(dir, 'b.json'))
  l.recordFailure('home', {}, 'no_path', { x: 0, y: 60, z: 0 })
  l.recordFailure('gather', { block: 'oak_log' }, 'nothing_found', { x: 0, y: 60, z: 0 })
  assert.equal(l.failCount('home', {}), 0)
  assert.ok(l.failCount('gather', { block: 'oak_log' }) > 0,
    'the exemption must not become a blanket amnesty')
})

// --- the purge: bots already poisoned must be cured on load ----------------
t('existing surface/home avoid entries are purged when the file loads', () => {
  const f = path.join(dir, 'c.json')
  fs.writeFileSync(f, JSON.stringify({
    schema: 1,
    avoid: {
      'surface:{}': { skill: 'surface', args: {}, fails: 9, last: Date.now(), since: Date.now(), classes: { stranded: 9 } },
      'home:{}': { skill: 'home', args: {}, fails: 4, last: Date.now(), since: Date.now(), classes: { no_path: 4 } },
      'gather:{"block":"oak_log"}': { skill: 'gather', args: { block: 'oak_log' }, fails: 3, last: Date.now(), since: Date.now(), classes: {} },
    },
    worked: {}, sites: [], runs: 5, progress: {}, skillVersions: {},
  }))
  const l = new Lessons(f)
  assert.equal(l.failCount('surface', {}), 0, 'the old "surfacing fails" rule must die on load')
  assert.equal(l.failCount('home', {}), 0)
  assert.ok(l.failCount('gather', { block: 'oak_log' }) > 0, 'non-rescue entries survive')
  // The clear must survive a hive merge: deletions only propagate via forgiven.
  l.save()
  const back = JSON.parse(fs.readFileSync(f, 'utf8'))
  assert.ok(!('surface:{}' in (back.avoid ?? {})),
    'a purged rule that reappears after save() would resurrect helplessness through the hive')
})

// --- the advice: every stopping reason carries its recipe ------------------
t('each shaft stop reason maps to an actionable next step', () => {
  assert.match(climbAdvice('no scaffold blocks left'), /gather 8\+ dirt or cobblestone/, 'blocks')
  assert.match(climbAdvice('liquid overhead (water)'), /away from the water/, 'water')
  assert.match(climbAdvice('liquid beside the shaft (water)'), /away from the water/)
  assert.match(climbAdvice('dig failed on deepslate'), /craft a pickaxe/, 'tool')
  assert.match(climbAdvice('cannot break obsidian'), /craft a pickaxe/)
  assert.match(climbAdvice('no height gained over 4 steps'), /somewhere more open/)
  assert.equal(climbAdvice(null), '', 'no stop, no advice')
  // Every recipe must end by telling the bot to TRY AGAIN -- advice that fixes
  // the blocker but never re-proposes the climb still strands the bot.
  for (const r of ['no scaffold blocks left', 'liquid overhead (water)', 'dig failed on stone']) {
    assert.match(climbAdvice(r), /surface again/, `"${r}" must loop back to the climb`)
  }
})

fs.rmSync(dir, { recursive: true, force: true })
console.log(`  ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
