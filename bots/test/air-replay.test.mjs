// VALIDATED AGAINST A RECORDED PACKET TRACE, WHICH IS THE POINT.
//
// Four fixes to this signal went straight to forty live bots against a
// prediction I only checked afterwards. All four failed; the last made
// `drowning_surfaced_stranded` 5.7x worse. The review's verdict was that I
// optimized the estimator before validating the sensor.
//
// So this replays 4,653 entity_metadata packets recorded from eight live bots
// (five of them stuck in water, three healthy controls) and asserts the reader
// produces the air supply the wire actually carried. If the fixture is missing
// the suite says so rather than passing on nothing -- a green test over absent
// data is exactly the confident zero this repo keeps paying for.
import assert from 'node:assert'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { airFromPacket, airFraction, installOwnAir, AIR_FULL } from '../src/own-air.mjs'

let pass = 0, fail = 0
const t = (name, fn) => {
  try { fn(); pass++; console.log(`  PASS  ${name}`) }
  catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) }
}

const here = path.dirname(fileURLToPath(import.meta.url))
const dir = path.join(here, 'fixtures', 'air-trace')

function loadTrace () {
  if (!fs.existsSync(dir)) return null
  const rows = []
  for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.jsonl'))) {
    for (const line of fs.readFileSync(path.join(dir, f), 'utf8').split('\n')) {
      if (!line.trim()) continue
      try { rows.push(JSON.parse(line)) } catch { /* truncated tail */ }
    }
  }
  return rows
}

const trace = loadTrace()

t('THE FIXTURE EXISTS. A replay test with no recording proves nothing', () => {
  assert.ok(trace && trace.length > 1000,
    `expected a recorded trace in ${dir}; got ${trace ? trace.length : 'no directory'} rows`)
})

if (trace && trace.length) {
  // Reconstruct the packets the recorder saw. It kept raw numeric metadata for
  // our own rows, which is exactly what the reader consumes.
  const own = trace.filter(r => r.own && r.meta && '1' in r.meta)
  const packets = own.map(r => ({
    entityId: 7,
    metadata: Object.entries(r.meta).map(([k, v]) => ({ key: Number(k), value: v })),
    expected: r.meta['1'],
  }))

  t('the recording contains real air packets to replay', () => {
    assert.ok(packets.length > 1000, `only ${packets.length} own packets carrying key 1`)
  })

  t('EVERY recorded packet yields the air the wire carried', () => {
    let read = 0, wrong = 0
    for (const p of packets) {
      const got = airFromPacket(p, 7)
      if (got == null) { wrong++; continue }
      if (got !== p.expected) wrong++
      else read++
    }
    assert.equal(wrong, 0, `${wrong} of ${packets.length} packets misread`)
    assert.equal(read, packets.length)
  })

  t('the replayed values are a player air supply and nothing else', () => {
    const vals = packets.map(p => airFromPacket(p, 7))
    const max = Math.max(...vals), min = Math.min(...vals)
    assert.ok(max <= AIR_FULL, `max ${max} exceeds a full breath`)
    assert.ok(min >= -60, `min ${min} is implausible even for a drowning player`)
    assert.ok(max >= 250, `max ${max} — the trace should contain near-full breaths`)
    assert.ok(min <= 0, `min ${min} — the trace should contain bots actually drowning`)
  })

  t('THE SIGNAL MOVES, which is what the old one did not', () => {
    // bot.oxygenLevel changed in 0 of 4058 packets carrying key 1. That is the
    // defect: a frozen number under a fleet that was drowning.
    const vals = packets.map(p => airFromPacket(p, 7))
    const falls = vals.slice(1).filter((v, i) => v < vals[i]).length
    assert.ok(falls > vals.length * 0.4,
      `only ${falls} of ${vals.length - 1} steps fall; the reader is not tracking the drain`)
  })

  t('a foreign packet yields nothing, whatever it carries', () => {
    const p = { ...packets[0], entityId: 999 }
    assert.equal(airFromPacket(p, 7), null)
  })

  t('replaying through installOwnAir mirrors onto the 0..20 scale the code reads', () => {
    const handlers = []
    const bot = {
      entity: { id: 7 }, oxygenLevel: null,
      _client: { on: (e, f) => e === 'entity_metadata' && handlers.push(f), removeListener: () => {} },
    }
    installOwnAir(bot)
    for (const p of packets) for (const h of handlers) h(p)
    assert.equal(bot.ownAirStats.updates, packets.length)
    assert.ok(bot.airTicks != null)
    assert.ok(bot.oxygenLevel >= 0 && bot.oxygenLevel <= 20,
      `mirrored oxygen ${bot.oxygenLevel} is off the scale the rest of the code assumes`)
    assert.ok(bot.ownAirStats.lowest <= 0,
      `lowest air seen was ${bot.ownAirStats.lowest}; the trace has drowning bots in it`)
  })

  t('IT NEVER STARTS AT NULL — that is exactly how the last attempt failed', () => {
    // assessAir returns "not losing air" on a null reading, so a guard that
    // leaves the value unset deletes the signal rather than cleaning it.
    // Air metadata is only sent when air changes, so a dry bot hears nothing.
    const bot = { entity: { id: 7 }, oxygenLevel: null, _client: { on: () => {}, removeListener: () => {} } }
    installOwnAir(bot)
    assert.equal(bot.airTicks, AIR_FULL)
    assert.equal(bot.oxygenLevel, 20, 'a bot that has heard nothing must read as breathing')
  })

  t('mineflayer cannot leave a stale value behind on a packet we ignore', () => {
    const handlers = []
    const bot = {
      entity: { id: 7 }, oxygenLevel: null,
      _client: { on: (e, f) => e === 'entity_metadata' && handlers.push(f), removeListener: () => {} },
    }
    installOwnAir(bot)
    for (const h of handlers) h(packets[0])          // real air packet
    const good = bot.oxygenLevel
    bot.oxygenLevel = 400                            // mineflayer writes nonsense
    for (const h of handlers) h({ entityId: 7, metadata: [{ key: 0, value: 8 }] })
    assert.equal(bot.oxygenLevel, good,
      `a packet carrying no air left mineflayer's ${400} standing`)
  })

  t('an implausible air value is refused, though the trace never contained one', () => {
    // Defence against data I have not seen. Nothing in 4,645 recorded packets
    // violates this bound, so mutation testing cannot reach it from the replay
    // alone -- and an untested guard is a guard I would delete next year while
    // tidying, which is how the metadata-key assumptions got here in the first
    // place. 4800 is a fish's air; 6000 is an axolotl's.
    const bad = (v) => airFromPacket({ entityId: 7, metadata: [{ key: 1, value: v }] }, 7)
    assert.equal(bad(4800), null, 'a fish-sized air supply was accepted as ours')
    assert.equal(bad(6000), null)
    assert.equal(bad(301), null, 'above a full breath')
    assert.equal(bad(-500), null, 'far below drowning damage')
    assert.equal(bad(300), 300, 'a full breath is still accepted')
    assert.equal(bad(-19), -19, 'and so is a bot about to take damage')
  })

  t('THE FIVE PERCENT CASE, from real data', () => {
    // The release logged 184 times as "oxygen 20, health 20" and read as safe.
    // On the real signal a bot at 15 ticks of 300 is at 5%, and the fraction
    // says so without any calibration at all.
    assert.equal(airFraction(15).toFixed(2), '0.05')
    assert.equal(airFraction(300), 1)
    assert.equal(airFraction(-19), 0)
  })
}

console.log(`  ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
