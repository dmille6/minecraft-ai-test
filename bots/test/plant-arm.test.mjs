// THE PLANTING ARM IS CARRIED IN THE ENV, NOT IN A SECOND CODE VERSION.
//
// A tree needs days, so the effect of a planting obligation cannot be read by a
// three-hour canary on five bots -- the instrument and the mechanism are on
// different timescales. The split is therefore eight worlds planting against
// eight not, for a week, on ONE fleet-wide sha: the death tripper matches
// `canary_pool` literally and two live code versions halts eighty bots.
//
// The DEFAULT is the load-bearing decision and it is ON. Defaulting OFF would
// mean a failed env write ships an inert feature that reads as a refuted one.
import assert from 'node:assert'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { plantingEnabled } from '../src/workorder.mjs'

let pass = 0, fail = 0
const t = (name, fn) => { try { fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) } }
const ta = async (name, fn) => { try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) } }
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

t('an unset, empty or absent PLANT_ENABLED plants — the default is ON', () => {
  assert.equal(plantingEnabled({}), true, 'absent must plant')
  assert.equal(plantingEnabled(), true, 'no env object at all must plant')
  assert.equal(plantingEnabled({ PLANT_ENABLED: '' }), true, 'an empty value is an absent value')
  assert.equal(plantingEnabled({ PLANT_ENABLED: undefined }), true)
  assert.equal(plantingEnabled({ PLANT_ENABLED: null }), true)
})

t('only an explicit falsey word turns the arm off', () => {
  for (const v of ['0', 'false', 'FALSE', 'no', 'off', ' false ', 'Off']) {
    assert.equal(plantingEnabled({ PLANT_ENABLED: v }), false, `${JSON.stringify(v)} must disable`)
  }
  for (const v of ['1', 'true', 'TRUE', 'yes', 'on', 'anything']) {
    assert.equal(plantingEnabled({ PLANT_ENABLED: v }), true, `${JSON.stringify(v)} must NOT disable`)
  }
})

// STRUCTURAL, and it is legitimate here: behaviour cannot reach this without a
// live server. Comments are stripped first because this codebase's comments quote
// the code they explain, and the anchor is the executable line, not a constant.
t('the gate is WIRED into the decision, ahead of the 75-call sweep', () => {
  const src = strip(readFileSync(new URL('../src/cognitive.mjs', import.meta.url), 'utf8'))
  const line = src.split('\n').find(l => l.includes('plantingEnabled(process.env)'))
  assert.ok(line, 'plantingEnabled is not called on the decision path at all')
  assert.ok(/if \(plantingEnabled\(process\.env\) &&/.test(line),
    `the gate must be the FIRST term of the guard so a disabled arm never pays for the sweep; got: ${line.trim()}`)
  const gi = src.indexOf('plantingEnabled(process.env)')
  const si = src.indexOf('plantableSpotNear(this.bot')
  assert.ok(gi > 0 && si > gi, 'plantableSpotNear must be evaluated INSIDE the gated block, not before it')
})

t('the sweep reports its own result, so "no trees" has one cause and not three', () => {
  const src = strip(readFileSync(new URL('../src/cognitive.mjs', import.meta.url), 'utf8'))
  assert.ok(/kind: 'plant_spot'/.test(src), 'no plant_spot event: a null order would be invisible')
  // A new EVENT, never a new FIELD -- the ELK templates are dynamic:strict.
  const ev = src.slice(src.indexOf("kind: 'plant_spot'"))
  assert.ok(/detail:/.test(ev.slice(0, 400)), 'plant_spot must carry its counts in detail, not in a new field')
  assert.ok(/snapshot: snap/.test(ev.slice(0, 500)), 'plant_spot must carry the standard snapshot')
})

async function withMutant (url, old, neu, fn) {
  const src = readFileSync(url, 'utf8')
  assert.ok(src.includes(old), `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 60))} absent — a mutant never written reads as killed`)
  assert.equal(src.split(old).length, 2, 'the mutation target is not unique; the mutant is ambiguous')
  const body = src.replace(old, neu).replace(/from '\.\//g, "from '../src/")
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, body)
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}

const WORKORDER = new URL('../src/workorder.mjs', import.meta.url)

await ta('MUTANT KILLED: defaulting OFF ships the feature inert on a failed env write', async () => {
  await withMutant(WORKORDER,
    "  if (v === undefined || v === null || v === '') return true",
    "  if (v === undefined || v === null || v === '') return false",
    async mod => {
      assert.equal(mod.plantingEnabled({}), false,
        'the mutant is not reproducing the fail-closed default; this test proves nothing')
    })
})

await ta('MUTANT KILLED: a truthiness test makes the string "false" enable the arm', async () => {
  // This is the actual bug a hand-written gate has: env values are STRINGS, and
  // Boolean('false') is true, so the control arm would plant.
  await withMutant(WORKORDER,
    '  return !/^(0|false|no|off)$/i.test(String(v).trim())',
    '  return !!v',
    async mod => {
      assert.equal(mod.plantingEnabled({ PLANT_ENABLED: 'false' }), true,
        'the mutant is not reproducing the string-truthiness bug')
    })
})

// THE COOLDOWN MUST BE CHARGED FOR THE SCAN, NOT FOR THE ORDER.
//
// Both review engines found this independently, and it is the same bug the block's own
// comment claims to have fixed. `if (order) this.lastPlantedAt = Date.now()` leaves the
// clock untouched when no spot is found -- and a bot standing on stone never finds one,
// so it re-runs the sweep on EVERY decision, for ever. With the measured clearance
// check the sweep now reads a column per surviving candidate, so this is the difference
// between 6 sweeps per bot-hour and 41.
t('the cooldown clock is advanced unconditionally, before the order is known', () => {
  const src = strip(readFileSync(new URL('../src/cognitive.mjs', import.meta.url), 'utf8'))
  const i = src.indexOf('plantingEnabled(process.env)')
  assert.ok(i > 0, 'the planting block is not there at all')
  const block = src.slice(i, i + 1600)
  assert.ok(/this\.lastPlantedAt = Date\.now\(\)/.test(block), 'the clock is never advanced')
  assert.ok(!/if \(order\) this\.lastPlantedAt/.test(block),
    'the clock is still charged only when an order was produced — a bot with no spot re-sweeps every decision')
  const clock = block.indexOf('this.lastPlantedAt = Date.now()')
  const call  = block.indexOf('plantingOrder(')
  assert.ok(clock > 0 && call > clock,
    'the clock must be advanced BEFORE plantingOrder is consulted, so no branch can skip it')
})

t('plant_spot carries the coordinate, because the coordinate IS the growth instrument', () => {
  const src = strip(readFileSync(new URL('../src/cognitive.mjs', import.meta.url), 'utf8'))
  const ev = src.slice(src.indexOf("kind: 'plant_spot'"))
  const detail = ev.slice(0, 600)
  assert.ok(/at=\$\{spot \? `\$\{spot\.x\},\$\{spot\.y\},\$\{spot\.z\}`/.test(detail),
    'plant_spot must emit x,y,z: without it nothing can read back whether the sapling became a log')
  assert.ok(/item=/.test(detail), 'the species decides the clearance, so the row must name it')
})

// The sweep must be told which species it is looking for, or it prices oak's clearance
// for a birch sapling and admits a site birch measured 0/3 in.
t('the species reaches plantableSpotNear, not just plantingOrder', () => {
  const src = strip(readFileSync(new URL('../src/cognitive.mjs', import.meta.url), 'utf8'))
  assert.ok(/plantableSpotNear\(this\.bot, 2, best\)/.test(src),
    'plantableSpotNear is still called without the species; birch would be judged by oak\'s clearance')
})

const SKILLS_PATH = new URL('../src/skills.mjs', import.meta.url)

await ta('MUTANT KILLED: the one-block-above predicate admits a tunnel as open meadow', async () => {
  await withMutant(SKILLS_PATH,
    `  const need = saplingClearance(item)
  if (!Array.isArray(column) || column.length < need) return false
  for (let i = 0; i < need; i++) if (column[i] !== 'air') return false`,
    `  if (!Array.isArray(column) || column[0] !== 'air') return false`,
    async mod => {
      // A ceiling at +2 -> one air block. MEASURED: 0/3 grew there, 3/3 at +6.
      assert.equal(mod.isPlantable({ soil: 'grass_block', cell: 'air', column: ['air'] }), true,
        'the mutant is not reproducing the old under-strict predicate; this test proves nothing')
    })
})

await ta('MUTANT KILLED: dropping the per-species clearance judges birch by oak', async () => {
  await withMutant(SKILLS_PATH,
    '  return SAPLING_CLEARANCE[item] ?? SAPLING_CLEARANCE_DEFAULT',
    '  return 5',
    async mod => {
      assert.equal(mod.isPlantable({ soil: 'grass_block', cell: 'air', column: Array(5).fill('air'), item: 'birch_sapling' }), true,
        'the mutant is not reproducing the flat-clearance bug')
    })
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
