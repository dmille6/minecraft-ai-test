// THE TRIP, AND THE THREE WAYS IT COULD QUIETLY BECOME A DIFFERENT EXPERIMENT.
//
// board.test.mjs argues with the town's rules. This file argues with the visit:
// the proximity gate that makes sharing cost a walk, the provenance that makes
// an adopted belief distinguishable from a learned one, and the placebo arm
// that pays the same cost while sharing nothing. If any of the three is wrong,
// Block 2 still produces numbers -- they just answer a different question.
import assert from 'node:assert'

process.env.LOG_DIR = '/tmp/mcbot-test-logs-boardvisit'
process.env.STATE_DIR = '/tmp/mcbot-test-state-boardvisit'
process.env.BOT_NAME = 'TestBot'
process.env.BOARD_X = '26'; process.env.BOARD_Y = '79'; process.env.BOARD_Z = '0'
process.env.BOARD_RADIUS = '8'

const { withinBoard, pendingReports, adoptInto, doVisit } = await import('../src/board-visit.mjs')
const { Board } = await import('../src/board.mjs')

let pass = 0, fail = 0
const t = (name, fn) => {
  try { fn(); pass++; console.log(`  PASS  ${name}`) }
  catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) }
}

const BOARD = { boardX: 26, boardY: 79, boardZ: 0, boardRadius: 8 }
function memfs() {
  const files = {}
  return { readFileSync: f => { if (!(f in files)) throw new Error('ENOENT'); return files[f] },
           writeFileSync: (f, d) => { files[f] = d }, mkdirSync: () => {} }
}
const lessonsStub = (avoid = {}) => ({ data: { avoid }, dirty: false, save() { this.saved = true } })

// ---- the proximity gate IS the treatment ----------------------------------

t('standing at the lectern is within the board', () => {
  assert.equal(withinBoard({ x: 26, y: 79, z: 0 }, BOARD), true)
})

t('a bot 200 blocks away is not', () => {
  assert.equal(withinBoard({ x: 226, y: 79, z: 0 }, BOARD), false)
})

t('the gate is spherical -- height counts too', () => {
  // A bot in a mine directly under town must not be able to read the board
  // through 40 blocks of rock; that would delete the walk and make this the
  // hive arm with extra steps.
  assert.equal(withinBoard({ x: 26, y: 39, z: 0 }, BOARD), false)
})

t('no position means no access, never a crash', () => {
  assert.equal(withinBoard(null, BOARD), false)
})

// ---- what a bot offers the board ------------------------------------------

t('only beliefs backed by real failures are filed', () => {
  const l = lessonsStub({ 'gather:{"block":"oak_log"}': { fails: 3, classes: { noPath: 3 } },
                          'craft:{"item":"stick"}': { fails: 0, classes: {} } })
  const out = pendingReports(l)
  assert.equal(out.length, 1)
  assert.match(out[0].subject, /oak_log/)
})

t('the dominant failure class becomes the claim type (typed quorum needs it)', () => {
  const l = lessonsStub({ 'gather:{"block":"oak_log"}':
    { fails: 5, classes: { noPath: 4, inventory: 1 } } })
  assert.equal(pendingReports(l)[0].failClass, 'noPath')
})

t('already-filed beliefs are not re-offered', () => {
  const l = lessonsStub({ 'gather:{"block":"oak_log"}': { fails: 3, classes: { noPath: 3 } } })
  const filed = new Set(pendingReports(l).map(r => r.id))
  assert.equal(pendingReports(l, filed).length, 0)
})

// ---- provenance: the field the hypothesis turns on -------------------------

t('adopting a claim records WHO reported it, not just the rule', () => {
  const l = lessonsStub()
  const claim = { subject: 'gather:{"block":"oak_log"}',
                  reports: [{ reporter: 'A', failClass: 'noPath' }, { reporter: 'B', failClass: 'noPath' }] }
  adoptInto(l, claim, 'TestBot')
  const e = l.data.avoid['gather:{"block":"oak_log"}']
  assert.deepEqual(e.reporters, ['A', 'B'],
    'memory.inherited is derived from this; without it the board arm cannot be measured')
  assert.equal(e.adopted_from_board, true)
})

t('a bot does not adopt its own report back as inherited belief', () => {
  // Otherwise every bot inherits from itself and the inherited-belief count --
  // the cleanest evidence for the whole mechanism -- becomes meaningless.
  const l = lessonsStub()
  const claim = { subject: 's', reports: [{ reporter: 'TestBot', failClass: 'noPath' }] }
  assert.equal(adoptInto(l, claim, 'TestBot'), false)
  assert.equal(Object.keys(l.data.avoid).length, 0)
})

t('adoption grants the claim WEIGHT, not the sum of every reporter tally', () => {
  // Copying raw counts would let a well-travelled claim outvote first-hand
  // experience; the board says "two bots hit this", so it is worth two.
  const l = lessonsStub()
  adoptInto(l, { subject: 's', reports: [
    { reporter: 'A', failClass: 'n' }, { reporter: 'B', failClass: 'n' }] }, 'Me')
  assert.equal(l.data.avoid['s'].fails, 2)
})

t('adoption never lowers a bot\'s own hard-won count', () => {
  const l = lessonsStub({ s: { fails: 9, classes: { n: 9 } } })
  adoptInto(l, { subject: 's', reports: [{ reporter: 'A', failClass: 'n' }] }, 'Me')
  assert.equal(l.data.avoid['s'].fails, 9, 'first-hand evidence outranks hearsay')
})

// ---- a full visit ----------------------------------------------------------

t('a visit files pending beliefs and reports the count for the evidence gate', () => {
  const b = new Board('/tmp/b.json', memfs())
  const l = lessonsStub({ 'gather:{"block":"oak_log"}': { fails: 2, classes: { noPath: 2 } } })
  const r = doVisit({ board: b, lessons: l, self: 'TestBot', pos: { x: 26, y: 79, z: 0 } })
  assert.equal(r.filed, 1)
  assert.equal(r.adopted, 0, 'nothing else has been filed by anyone yet')
})

t('a second bot filing the same class reaches quorum and the first can adopt', () => {
  const fsx = memfs()
  const b = new Board('/tmp/b.json', fsx)
  const lA = lessonsStub({ 'gather:{"block":"oak_log"}': { fails: 2, classes: { noPath: 2 } } })
  const lB = lessonsStub({ 'gather:{"block":"oak_log"}': { fails: 2, classes: { noPath: 2 } } })
  doVisit({ board: b, lessons: lA, self: 'A', pos: { x: 26, y: 79, z: 0 }, filed: new Set() })
  doVisit({ board: b, lessons: lB, self: 'B', pos: { x: 26, y: 79, z: 0 }, filed: new Set() })
  const lC = lessonsStub()
  const r = doVisit({ board: b, lessons: lC, self: 'C', pos: { x: 26, y: 79, z: 0 }, filed: new Set() })
  assert.equal(r.adopted, 1, 'two same-class witnesses should be adoptable by a third bot')
  assert.deepEqual(lC.data.avoid['gather:{"block":"oak_log"}'].reporters, ['A', 'B'])
})

t('a visit that changes nothing reports zeroes', () => {
  // The evidence gate turns this into `unknown`, so "walk to the board a lot"
  // cannot become a way to look productive.
  const b = new Board('/tmp/b.json', memfs())
  const r = doVisit({ board: b, lessons: lessonsStub(), self: 'TestBot', pos: { x: 26, y: 79, z: 0 } })
  assert.equal(r.filed, 0)
  assert.equal(r.adopted, 0)
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
