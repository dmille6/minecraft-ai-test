// THE FLEET TALKED AND NOTHING LISTENED.
//
// comms.mjs filtered incoming chat through a literal roster regex before
// parsing anything. It had gone stale once already (the Hive/Solo rename) and
// went stale again at the arm-pool rename -- this time excluding EVERY bot:
// Block 2 names are `hive-a-Alpha`, and
// /^(Scout|Miner|Gather|Builder|Crafter|Hive|Solo)\d{2}$/ rejects all of them.
//
// Verified across 4.6 GB of telemetry and every store on disk: the ingestion
// marker "reported over chat" appears ZERO times. `say()` has no filter, so
// hazards were broadcast normally and every listener dropped them at the door.
// Cross-host propagation -- the one path the world-facts file cannot serve --
// was dead for the entire block.
//
// The pattern is now DERIVED FROM THE BOT'S OWN NAME. These tests exist to make
// a third rename impossible to break.
import assert from 'node:assert'
import { readFileSync } from 'node:fs'

let pass = 0, fail = 0
const t = (name, fn) => {
  try { fn(); pass++; console.log(`  PASS  ${name}`) }
  catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) }
}

// peerPattern is module-private; lift it out rather than exporting machinery
// only a test would use.
const SRC = readFileSync(new URL('../src/comms.mjs', import.meta.url), 'utf8')
const peerPattern = (() => {
  const i = SRC.indexOf('function peerPattern')
  const body = SRC.slice(i, SRC.indexOf('\n}\n', i) + 3)
  // eslint-disable-next-line no-new-func
  return new Function(`${body}; return peerPattern`)()
})()

t('a Block 2 bot recognises its own poolmates', () => {
  const re = peerPattern('hive-a-Alpha')
  for (const peer of ['hive-a-Bravo', 'hive-a-Comet', 'board-d-Echo',
                      'isolated-b-Delta', 'placebo-c-Alpha']) {
    assert.ok(re.test(peer), `${peer} rejected — this is the outage`)
  }
})

t('THE EXACT BUG: the old literal roster rejected the entire fleet', () => {
  const old = /^(Scout|Miner|Gather|Builder|Crafter|Hive|Solo)\d{2}$/
  for (const real of ['hive-a-Alpha', 'board-d-Comet', 'isolated-a-Bravo']) {
    assert.equal(old.test(real), false, 'sanity: the old pattern really did reject these')
    assert.ok(peerPattern('hive-a-Alpha').test(real), `${real} still rejected`)
  }
})

t('IT SURVIVES A RENAME, which is the property both previous versions lacked', () => {
  // A fleet renamed to any new scheme keeps working, because the pattern is
  // built from whatever this bot is called.
  const re = peerPattern('alpha-1-Runner')
  assert.ok(re.test('beta-2-Walker'), 'a renamed fleet would be deaf again')
  const legacy = peerPattern('Scout01')
  assert.ok(legacy.test('Miner02'), 'the historical shape must still work')
})

t('a plain player name is still not a source of truth', () => {
  const re = peerPattern('hive-a-Alpha')
  for (const human of ['Notch', 'steve', 'xX_miner_Xx', 'Player123']) {
    assert.equal(re.test(human), false, `${human} accepted as a fleet peer`)
  }
})

t('an unusable own-name degrades to the historical roster, not to trusting nobody', () => {
  // A misconfigured bot must not silently distrust its whole fleet — that is
  // the outage this file exists to prevent, arriving by a different door.
  const re = peerPattern('')
  assert.ok(re.test('Scout01'))
  assert.equal(re.test('Notch'), false)
})

console.log(`  ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
