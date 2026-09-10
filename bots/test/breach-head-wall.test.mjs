// THE ONLY LATERAL RUNG IN THE TABLE.
//
// Two bots -- hive-b-Comet at 1809,61,666 and hive-c-Alpha at 355,61,187 -- sit
// in a 1x1 waterlogged chimney OF THEIR OWN MAKING: dirt and cobblestone they
// placed, feet in a one-block puddle, head in a one-block air pocket, all four
// cardinals solid. Reconstructed over RCON and run against the real Movements
// class: ZERO A* successors in six configs, including canDig=true and 64
// scaffold blocks. Removing ANY SINGLE head-height cardinal restores 2-3.
//
// Every other rung is vertical -- pillarOut, harvestUnderfoot, rideFloorDown,
// stair_up -- which is why none of them touches this. The bot does not need to
// go up or down. It needs one block sideways.
import assert from 'node:assert'
import test from 'node:test'
process.env.OLLAMA_MODEL ??= 'qwen2.5:7b-instruct'
const { escapePlan, ESCAPES } = await import('../src/escape.mjs')

const TRAP = {
  trapped: true, afloat: true, health: 20, columnOpen: true,
  lateralHeadOpen: false, breachable: true,
  underfootSolid: false, underfootDrop: null, floorBelowSolid: false,
  lateralTread: false, blocks: 0,
}

test('the rung exists in the closed enum', () => {
  assert.ok(ESCAPES.includes('breach_head_wall'))
})

test('the reconstructed trap chooses it', () => {
  assert.equal(escapePlan(TRAP), 'breach_head_wall')
})

test('it OUTRANKS float_up, which cannot change this state', () => {
  // float_up is `jump` until dry. The existing water posture already ran that
  // 920 times in 131 minutes on hive-b-Comet, each ending with feet clear, and
  // the bot never moved. A rung that wins a state and cannot change it must not
  // sit in front of one that can.
  assert.notEqual(escapePlan(TRAP), 'float_up')
  assert.equal(escapePlan({ ...TRAP, breachable: false }), 'float_up',
    'and float_up still takes the state when nothing is breakable')
})

test('nothing breakable means it does NOT fire', () => {
  // The predicate is "one adjacent head-height block this bot can actually
  // break", computed from the same test the dig uses. Promising a break the
  // executor then refuses is the arrived_out_of_reach shape.
  assert.notEqual(escapePlan({ ...TRAP, breachable: false }), 'breach_head_wall')
})

test('open water is untouched — surface_swim still wins', () => {
  assert.equal(escapePlan({ ...TRAP, lateralHeadOpen: true }), 'surface_swim')
})

test('a dry bot never breaches', () => {
  assert.notEqual(
    escapePlan({ ...TRAP, afloat: false, underfootSolid: true, underfootDrop: 2 }),
    'breach_head_wall')
})

test('it can be excluded and the lattice stays total', () => {
  const alt = escapePlan({ ...TRAP, exclude: ['breach_head_wall'] })
  assert.notEqual(alt, 'breach_head_wall')
  assert.ok(ESCAPES.includes(alt), `fell through to a real rung, got ${alt}`)
})

test('the routine is wired into the table', async () => {
  // The enum is closed and module load asserts routine coverage, but assert it
  // here too: adding to escapePlan without ESCAPE_ROUTINES is the single most
  // predicted way this ships inert.
  const fs = await import('node:fs')
  const path = await import('node:path')
  const { fileURLToPath } = await import('node:url')
  const src = fs.readFileSync(path.join(
    path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'reflex.mjs'), 'utf8')
  const exec = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  assert.match(exec, /breach_head_wall: async \(bot\)/, 'a routine exists')
  assert.match(exec, /breachable: \[\[1, 0\]/, 'and the input is observed')
  // Success must be ROUTE RESTORED, not "the dig resolved" -- bot.dig() has no
  // server ack and resolves on a local timer.
  assert.match(exec, /const opened = !solid\(after\)/,
    'the postcondition re-reads the block after a settle')
})

// ---- THE GATE, which is what made the previous rung inert -----------------
//
// float_up shipped and fired ZERO times because escapePlan's acting call site
// is gated on a 45-minute IN-MEMORY clock that every deploy resets. Measured:
// the 45-minute mark was reached for 10 of 80 bots in 5.4 hours, and
// hive-b-Comet peaked at 43.7 minutes across five deploys without crossing it.
// A rung behind a gate that never opens is decoration.
test('a SECOND, shorter clock exists for the state we can PROVE', async () => {
  const fs = await import('node:fs')
  const path = await import('node:path')
  const { fileURLToPath } = await import('node:url')
  const src = fs.readFileSync(path.join(
    path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'reflex.mjs'), 'utf8')
  const exec = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

  const m = exec.match(/const SEALED_ESCAPE_MS = (\d+) \* 60 \* 1000/)
  assert.ok(m, 'the sealed clock is a named constant')
  const sealed = Number(m[1])
  const long = Number(exec.match(/const LAST_RESORT_STRANDED_MS = (\d+) \* 60 \* 1000/)[1])
  assert.ok(sealed < long, `the proven state must not wait as long as the inferred one (${sealed} vs ${long})`)
  assert.ok(sealed >= 1, 'but not so short that a transient trips it')

  // The gate must be a DISJUNCTION -- the long clock still governs the inferred
  // case. Replacing it rather than adding to it would widen the last resort for
  // every bot, which is the opposite of the intent.
  assert.match(exec, /const longEnough =[\s\S]{0,240}?LAST_RESORT_STRANDED_MS\)[\s\S]{0,120}?\|\|/,
    'the original clock still gates the inferred case')
  assert.match(exec, /longEnough &&/, 'and the branch consumes it')
  // AND THE SEALED CLOCK MUST BE INSIDE IT. The first version of this asserted
  // only that `longEnough` existed, so a mutant that replaced the sealed
  // disjunct with `false` passed 9/9 -- the assertion proved the variable was
  // there, not that it did anything.
  assert.match(exec, /const longEnough =[\s\S]{0,300}?SEALED_ESCAPE_MS/,
    'the sealed clock must actually appear in the gate expression')

  // Position-anchored: any real displacement clears it, or a bot slowly working
  // its way out would accrue the timer and get seized mid-escape.
  assert.match(exec, /sealedSince = 0\s/, 'the sealed clock is cleared')
  assert.match(exec, /strandedFrom = p\.clone\(\); strandedSince = Date\.now\(\)\s*\n\s*sealedSince = 0/,
    'cleared by the SAME displacement test that resets the long clock')
})
