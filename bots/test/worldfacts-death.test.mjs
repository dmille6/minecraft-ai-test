// WorldFacts.reportDeath: one death is a site, weighted to outlive three decay periods; a second death of the same
// class within the merge radius adds to it; the decay halves ONCE per period, not once per write.
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
process.env.OLLAMA_MODEL ??= 'qwen2.5:7b-instruct'
const { WorldFacts } = await import('../src/worldfacts.mjs')
let pass = 0, fail = 0
const t = (name, fn) => { try { fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) } }
const dir = mkdtempSync(path.join(tmpdir(), 'wf-death-')); const file = path.join(dir, 'world-facts-test.json')
try {
  const wf = new WorldFacts(file)
  t('a death is a site on the first report, weighted 4, kind death:<class>, and deathSites() returns it', () => {
    const s = wf.reportDeath('fire', { x: 336.4, y: 35.2, z: 205.7 }, 'placebo-b-Alpha')
    assert.equal(s.kind, 'death:fire'); assert.equal(s.count, 4); assert.equal(s.deaths, 1); assert.deepEqual([s.x, s.y, s.z], [336, 35, 206])
    assert.equal(wf.deathSites().length, 1); assert.deepEqual(wf.deathSites()[0].by, ['placebo-b-Alpha'])
    assert.equal(wf.reportDeath('fire', null), null, 'no position, no site')
  })
  t('a second death of the same class within 3 blocks merges: count +4, deaths 2, both reporters; another class is another site', () => {
    const s = wf.reportDeath('fire', { x: 338, y: 36, z: 208 }, 'placebo-b-Delta')
    assert.equal(s.deaths, 2); assert.equal(s.count, 8); assert.deepEqual(s.by, ['placebo-b-Alpha', 'placebo-b-Delta'])
    wf.reportDeath('drowning', { x: 338, y: 36, z: 210 }, 'placebo-b-Echo')
    assert.equal(wf.deathSites().length, 2)
    assert.equal(wf.deathSites().filter(x => x.kind === 'death:drowning').length, 1)
    wf.reportDeath('fire', { x: 343, y: 35, z: 206 }, 'placebo-b-Comet')   // 7 blocks away: its own disc, not a merge into a centre that would not price it
    assert.equal(wf.deathSites().filter(x => x.kind === 'death:fire').length, 2)
  })
  t('decay halves once per 12-h period: a 13-h-old site survives two consecutive writes at half, not a quarter', () => {
    const raw = JSON.parse(readFileSync(file, 'utf8'))
    for (const s of raw.sites) s.last = Date.now() - 13 * 3600 * 1000
    writeFileSync(file, JSON.stringify(raw))
    wf.reportHazard('lava', { x: 900, y: 64, z: 900 }, 2, 'x')      // write 1: the stale sites halve once
    let d = JSON.parse(readFileSync(file, 'utf8')); const fire = () => d.sites.find(s => s.kind === 'death:fire')
    assert.equal(fire().count, 4, 'halved from 8 to 4 on the first write past the period')
    wf.reportHazard('lava', { x: 900, y: 64, z: 900 }, 3, 'y')      // write 2, seconds later: no second halving
    d = JSON.parse(readFileSync(file, 'utf8'))
    assert.equal(fire().count, 4, 'a second write inside the same period does not halve again')
    assert.ok(fire().decayedAt > Date.now() - 14 * 3600 * 1000, 'the halving is timestamped by whole periods')
  })
  t('deathSites() applies the elapsed periods on the way out, and a write after 40 quiet hours applies all three at once', () => {
    let raw = JSON.parse(readFileSync(file, 'utf8')); const f = raw.sites.find(s => s.kind === 'death:fire' && s.count === 4)
    f.last = Date.now() - 40 * 3600 * 1000; f.decayedAt = 0; writeFileSync(file, JSON.stringify(raw))
    const wf2 = new WorldFacts(file)
    assert.equal(wf2.deathSites().filter(s => s.x === f.x && s.z === f.z).length, 0, 'read: three periods elapsed, weight 4 -> 0, not returned')
    wf2.reportHazard('lava', { x: 900, y: 64, z: 900 }, 4, 'z')
    raw = JSON.parse(readFileSync(file, 'utf8'))
    assert.equal(raw.sites.filter(s => s.x === f.x && s.z === f.z).length, 0, 'write: pruned in one pass, not halved once')
  })
} finally { rmSync(dir, { recursive: true, force: true }) }
console.log(`\n${pass} passed, ${fail} failed`); if (fail) process.exit(1)
