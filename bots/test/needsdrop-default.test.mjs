// THE HARVEST WATCHDOG WAS ARMED ON SIXTEEN SITES THAT WERE NOT DIGGING FOR A DROP.
//
// `withTimeout`'s `needsDrop` option installs `watchDigging`, which polls at 1 Hz
// and calls pathfinder.stop() + stopDigging() on any dig whose block the HELD item
// cannot harvest. It used to default to TRUE. But withTimeout wraps far more than
// digs, and watchDigging polls the PROCESS-GLOBAL bot.targetDigBlock -- so arming
// it puts a 1 Hz killer around whatever dig any subsystem has in flight.
//
// Census on cfc1c58 of the sites the old default armed: 11 x pathfinder.goto,
// 4 x placeBlock, 1 x openFurnace, and 2 that genuinely want the drop (gather's
// target dig, collectBlock). Every dig that wants the HOLE already passed
// needsDrop:false and was correct. So the default was wrong at sixteen sites and
// right at two, and it is now false with those two opting in.
//
// The placement sites are the mechanism: placeBlock equips the block it is about
// to place, so the hand holds dirt; the watchdog then asks whether DIRT can
// harvest stone and cancels somebody else's dig. Fleet-wide after digwatch-02
// reached all 80 bots: 682 of 1,258 dig collisions are this watchdog (54.2%),
// 682/682 with a harvesting pickaxe in the inventory, held item dirt 67.9% and
// empty 19.8%.
//
// These are BEHAVIOUR tests. The decision is "does withTimeout install the
// watchdog", so they drive withTimeout and observe whether the dig dies -- no
// grep can tell you that, and this file's sibling dig-approach-watchdog.test.mjs
// exists because the same composition was got wrong before.
import assert from 'node:assert'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { EventEmitter } from 'node:events'
import { withTimeout } from '../src/skills.mjs'

process.env.OLLAMA_MODEL ??= 'qwen2.5:7b-instruct'

let pass = 0, fail = 0
const ta = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) }
  catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) }
}
const sleep = ms => new Promise(r => setTimeout(r, ms))

// A bot mid-dig on a block its held item cannot harvest -- exactly the state the
// watchdog exists to notice. `holds` is what is in the hand; a placement path
// holds the block it is placing, which is the 67.9%-dirt case.
function midDig ({ harvestable = false } = {}) {
  const bot = new EventEmitter()
  const seen = { stopDigging: 0, pathStop: 0 }
  Object.assign(bot, {
    heldItem: { type: 7, name: 'dirt' },
    targetDigBlock: { name: 'stone', canHarvest: () => harvestable },
    pathfinder: { stop: () => { seen.pathStop++ } },
    stopDigging: () => { seen.stopDigging++ },
  })
  return { bot, seen }
}

// A dig that takes 1400 ms: long enough for the 1000 ms poll to land on it.
const slowDig = () => sleep(1400)

await ta('DEFAULT: withTimeout does NOT arm the harvest watchdog', async () => {
  const { bot, seen } = midDig()
  await withTimeout(slowDig(), 5000, bot)
  assert.strictEqual(seen.stopDigging, 0,
    `default armed the watchdog: stopDigging called ${seen.stopDigging}x`)
  assert.strictEqual(seen.pathStop, 0, 'default called pathfinder.stop()')
})

await ta('needsDrop:true DOES arm it -- gather still gets its guard', async () => {
  const { bot, seen } = midDig()
  await withTimeout(slowDig(), 5000, bot, { needsDrop: true })
  assert.ok(seen.stopDigging >= 1,
    'needsDrop:true failed to arm the watchdog; gather lost its guard')
  assert.ok(seen.pathStop >= 1, 'needsDrop:true did not stop the path')
})

await ta('needsDrop:true leaves a HARVESTABLE dig alone', async () => {
  const { bot, seen } = midDig({ harvestable: true })
  await withTimeout(slowDig(), 5000, bot, { needsDrop: true })
  assert.strictEqual(seen.stopDigging, 0,
    'the watchdog cancelled a dig the held item CAN harvest')
})

await ta('needsDrop:false stays explicit and off', async () => {
  const { bot, seen } = midDig()
  await withTimeout(slowDig(), 5000, bot, { needsDrop: false })
  assert.strictEqual(seen.stopDigging, 0, 'explicit false armed the watchdog')
})

await ta('a PLACEMENT holding dirt does not kill another dig (the 54.2% case)', async () => {
  // placeBlock equips the block it places, so the hand holds dirt while some
  // other subsystem's dig is in flight. Under the old default this cancelled it.
  const { bot, seen } = midDig()
  await withTimeout(sleep(1400), 6000, bot, { what: 'placing' })
  assert.strictEqual(seen.stopDigging, 0,
    'a placement cancelled an unrelated in-flight dig')
})

await ta('a goto does not kill an in-flight dig', async () => {
  const { bot, seen } = midDig()
  await withTimeout(sleep(1400), 25000, bot)
  assert.strictEqual(seen.stopDigging, 0, 'a goto cancelled an in-flight dig')
})

await ta('the watchdog still fires on the SECOND poll, not just the first', async () => {
  // Guards against a fix that merely delays the first poll past the usual dig.
  const { bot, seen } = midDig()
  await withTimeout(sleep(2400), 6000, bot, { needsDrop: true })
  assert.ok(seen.stopDigging >= 2,
    `expected repeated polls, saw ${seen.stopDigging}`)
})

await ta('no pathfinder and no targetDigBlock: nothing is armed, nothing throws', async () => {
  const bot = new EventEmitter()
  let stopped = 0
  Object.assign(bot, { stopDigging: () => { stopped++ } })
  await withTimeout(sleep(200), 3000, bot, { needsDrop: true })
  assert.strictEqual(stopped, 0, 'armed a watchdog with nothing to watch')
})

// ------------------------------------------------------------------ mutants ---
//
// A test never seen to fail is not a test, and this project has scored a mutant
// that silently failed to apply as "killed". withMutant asserts its anchor is
// PRESENT and UNIQUE, and writes the mutant to its own file rather than into src,
// because the runner SIGKILLs and an in-place mutant survives on disk.

async function withMutant (path, old, neu, fn) {
  const src = readFileSync(path, 'utf8')
  assert.ok(src.includes(old),
    `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 60))} is not in the source. ` +
    'A mutant that was never written reads as killed.')
  assert.ok(src.split(old).length === 2,
    'the mutation target is not unique; the mutant is ambiguous')
  const body = src.replace(old, neu).replace(/from '\.\//g, "from '../src/")
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, body)
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}

const SKILLS = new URL('../src/skills.mjs', import.meta.url)

await ta('MUTANT KILLED: restoring `needsDrop = true` as the default re-arms every goto', async () => {
  await withMutant(SKILLS,
    "onTimeout = null,\n                                        needsDrop = false } = {}) {",
    "onTimeout = null,\n                                        needsDrop = true } = {}) {",
    async mod => {
      const { bot, seen } = midDig()
      await mod.withTimeout(sleep(1400), 5000, bot)
      assert.ok(seen.stopDigging >= 1,
        'the mutant did NOT re-arm the watchdog, so the default test proves nothing')
    })
})

await ta('MUTANT KILLED: dropping the watch entirely would disarm gather too', async () => {
  await withMutant(SKILLS,
    "const watch = needsDrop && (bot?.targetDigBlock !== undefined || bot?.pathfinder)",
    "const watch = false && (bot?.targetDigBlock !== undefined || bot?.pathfinder)",
    async mod => {
      const { bot, seen } = midDig()
      await mod.withTimeout(sleep(1400), 5000, bot, { needsDrop: true })
      assert.strictEqual(seen.stopDigging, 0,
        'the mutant still armed the watchdog; the needsDrop:true test proves nothing')
    })
})

// ---- the two opt-in call sites -----------------------------------------------
//
// Behaviour cannot reach these from here (driving the whole gather path needs a
// world), and CLAUDE.md allows a source assertion for exactly this: a config
// value wired into a call site. So it is anchored on the EXECUTABLE line with
// comments stripped -- this file's comments quote the code they explain, and a
// naive grep matches the explanation -- and each is proved with a mutant.

const stripComments = t => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const SRC = stripComments(readFileSync(SKILLS, 'utf8'))

await ta("gather's target dig opts IN to the drop guard", async () => {
  const optIns = (SRC.match(/needsDrop: true/g) || []).length
  assert.strictEqual(optIns, 2,
    `expected exactly 2 needsDrop:true opt-ins (gather's dig and collectBlock), found ${optIns}`)
})

await ta('MUTANT KILLED: removing an opt-in is detected', async () => {
  await withMutant(SKILLS, '    needsDrop: true,\n  })', '  })', async () => {
    const mutated = stripComments(readFileSync(SKILLS, 'utf8').replace('    needsDrop: true,\n  })', '  })'))
    const n = (mutated.match(/needsDrop: true/g) || []).length
    assert.strictEqual(n, 1, `the mutant left ${n} opt-ins; the count assertion is blind`)
  })
})

console.log(`\n  ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
