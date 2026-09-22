// A refusal the model cannot believe is a refusal it cannot learn from.
//
// Measured 24 h to 2026-09-22: 1,069 deposit runs returned "nothing matching <item> to
// hand over — nothing to deposit", and in **1,068 of them the bot WAS HOLDING the item**.
// A bot with 21 wheat_seeds was told there was no such thing, so it asked again: apple
// 543, wheat_seeds 116, dirt 99, chest 78, oak_sapling 77, cooked_beef 47. That is 37%
// of all 2,866 deposit runs, each of which walked to a chest and opened it first.
//
// The POLICY is right and is not changed here: bankableInventory counts anything that is
// neither a tool nor a standing target as junk, so food and saplings are correctly kept
// out of the chest. What changes is that the bot says so, and says so BEFORE the walk.
import assert from 'node:assert/strict'
import test from 'node:test'
import { depositItemArg, unbankableRefusal, DEPOSIT_WILDCARDS } from '../src/admission.mjs'
import { depositNoopDetail } from '../src/skills.mjs'

const it_ = (name, count) => ({ name, count })
const HELD = [it_('wheat_seeds', 21), it_('oak_log', 6), it_('stone_pickaxe', 1)]
const BANKABLE = { oak_log: 6 }          // what bankableInventory would actually move

test('THE BUG: held but not bankable is its own answer, not "you have none"', () => {
  const r = depositItemArg(HELD, 'wheat_seeds', BANKABLE)
  assert.equal(r.missing, false, 'the bot holds 21 of them; missing would be a lie')
  assert.equal(r.unbankable, true)
  assert.equal(r.held, 21, 'the count must be carried so the refusal can state it')
})

test('a name the bot genuinely does not hold is still missing', () => {
  const r = depositItemArg(HELD, 'diamond', BANKABLE)
  assert.equal(r.missing, true)
  assert.equal(r.unbankable, false)
  assert.equal(r.held, 0)
})

test('a held AND bankable name passes through untouched', () => {
  const r = depositItemArg(HELD, 'oak_log', BANKABLE)
  assert.deepEqual(r, { item: 'oak_log', missing: false, unbankable: false, held: 6 })
})

test('PRESENCE AND COUNT ARE TWO QUESTIONS: an entry with no count is still held', () => {
  // The first version derived `missing` from the summed count, so {name:'apple'} with no
  // count read as missing. Real mineflayer always sets one; the scripted doubles do not,
  // and a guard that answers differently under test than in production is worthless.
  const noCount = [{ name: 'apple' }]
  assert.equal(depositItemArg(noCount, 'apple', { apple: 1 }).missing, false)
  assert.equal(depositItemArg([{ name: 'apple', count: 0 }], 'apple', { oak_log: 1 }).unbankable, true,
    'count 0 is held-but-unbankable, not absent')
})

test('UNKNOWN MUST NOT REFUSE: a null bankable set cannot make anything unbankable', () => {
  // The caller computes the set in a try/catch. If it could not, the old behaviour is
  // the safe one -- refusing on a set nobody computed would be a detector that answers
  // uniformly, which is this repo's most repeated bug.
  const r = depositItemArg(HELD, 'wheat_seeds', null)
  assert.equal(r.unbankable, false)
  assert.equal(r.missing, false)
})

test('every wildcard still means "everything bankable" and is never unbankable', () => {
  for (const w of DEPOSIT_WILDCARDS) {
    const r = depositItemArg(HELD, w, BANKABLE)
    assert.equal(r.item, null, `wildcard ${JSON.stringify(w)} should mean everything`)
    assert.equal(r.missing, false)
    assert.equal(r.unbankable, false)
  }
})

test('counts are summed across stacks, because a refusal that says "1" when it is 64 is another lie', () => {
  const split = [it_('dirt', 64), it_('dirt', 64), it_('dirt', 3)]
  assert.equal(depositItemArg(split, 'dirt', { oak_log: 1 }).held, 131)
})

test('the match stays EXACT -- cobblestone must not answer for stone', () => {
  const inv = [it_('cobblestone', 30)]
  assert.equal(depositItemArg(inv, 'stone', { cobblestone: 30 }).missing, true)
})

test('case and whitespace are still normalised', () => {
  assert.equal(depositItemArg(HELD, '  Wheat_Seeds ', BANKABLE).unbankable, true)
})

// ------------------------------------------------- the gate and the message
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
const ADM = new URL('../src/admission.mjs', import.meta.url)
const SK  = new URL('../src/skills.mjs', import.meta.url)
const strip = t => t.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')

async function withMutant (path, old, neu, fn) {
  const src = readFileSync(path, 'utf8')
  assert.ok(src.includes(old), `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 60))}`)
  assert.ok(src.split(old).length === 2, 'the mutation target is not unique; the mutant is ambiguous')
  const body = src.replace(old, neu).replace(/from '\.\//g, "from '../src/")
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, body)
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}

test('THE ORDER IS THE FIX: the unbankable refusal sits BELOW the due check', () => {
  // Structural, because behaviour cannot reach "which guard runs first" without driving
  // the whole gate. This is the assertion that matters: review pass 1 put the refusal
  // above `due` and executed the consequence -- a bot 804 blocks out holding 21
  // wheat_seeds and 6 oak_log was told "deposit oak_log instead", and depositDue then
  // refused oak_log too because 6 < minBankable 12. A remedy the next guard rejects is
  // this repo's named bug class, and it REPLACED a true refusal with a false one.
  const a = strip(readFileSync(ADM, 'utf8'))
  const due = a.indexOf("reason: 'deposit_not_worth_it'")
  const unb = a.indexOf("reason: 'deposit_item_unbankable'")
  const miss = a.indexOf("reason: 'deposit_item_missing'")
  assert.ok(due > 0 && unb > 0 && miss > 0, 'all three deposit refusals must exist')
  assert.ok(unb > due,
    'the unbankable refusal must come AFTER deposit_not_worth_it, or it prints a remedy the next guard refuses')
  assert.ok(miss < due, 'holding none of it is still refused before the trip is priced')
})

test('the gate computes ONE wants, by spreading, and hands the same one to the skill', () => {
  // `[wanted].flat()` does not spread a Set, and #wantedItems returns a Set -- so the
  // gate's bankable set never contained a milestone want. Harmless while it only decided
  // whether to walk; a hard refusal would have promoted it to a bug. Two copies of the
  // expression would also let a later edit fix one and not the other.
  const a = strip(readFileSync(ADM, 'utf8'))
  const block = a.slice(a.indexOf("if (skill === 'deposit') {"), a.indexOf("reason: 'deposit_not_worth_it'"))
  assert.equal((block.match(/\.\.\.\(wanted \?\? \[\]\), \.\.\.DEPOSIT_ALWAYS/g) || []).length, 1,
    'wants must be built exactly once, by spreading rather than flattening')
  assert.equal(/\[wanted\]\.flat\(\)/.test(block), false,
    'flat() leaves a Set unspread; that is the bug this replaced')
  assert.ok(block.includes('bot.currentWants = wants'),
    'the skill must receive the same wants the gate judged with')
  assert.ok(block.includes('catch { bankDetail = null }'),
    'an uncomputable bankable set must fall back to null, which cannot refuse')
})

// The structural grep that used to sit here asserted both branches of the skill's
// ternary appeared in the source. Review pass 1 reverted the entire fix by changing
// `heldNow > 0` to `heldNow > 1e9` and that grep still passed -- CLAUDE.md's named
// failure, "a hardcoded ternary whose branches both still appeared in the text". It is
// replaced by the behavioural test and mutant on `depositNoopDetail` at the end of this
// file, not repaired.

test('MUTANT KILLED: dropping the bankable check restores the lie', async () => {
  await withMutant(ADM,
    "  if (bankableDetail && !(name in bankableDetail)) {\n    return { item: name, missing: false, unbankable: true, held }\n  }\n",
    "",
    async mod => {
      const r = mod.depositItemArg(HELD, 'wheat_seeds', BANKABLE)
      assert.equal(r.unbankable, false,
        'the mutant did not remove the check, so the test above proves nothing')
      assert.equal(r.missing, false, 'and it would pass the walk-to-a-chest through again')
    })
})

test('MUTANT KILLED: treating a null bankable set as empty refuses everything', async () => {
  await withMutant(ADM,
    "  if (bankableDetail && !(name in bankableDetail)) {",
    "  if (!(name in (bankableDetail || {}))) {",
    async mod => {
      assert.equal(mod.depositItemArg(HELD, 'wheat_seeds', null).unbankable, true,
        'the mutant did not make an unknown set refuse')
      assert.equal(mod.depositItemArg(HELD, 'oak_log', null).unbankable, true,
        'and it would refuse a perfectly bankable log too')
    })
})


// ------------------------------- the two message decisions, now killable

test('the refusal names OTHER items, never the one it just refused', () => {
  const m = unbankableRefusal('wheat_seeds', 21, { wheat_seeds: 21, oak_log: 6, raw_iron: 3 })
  assert.match(m, /you hold 21 wheat_seeds, but it is not worth banking/)
  assert.match(m, /deposit oak_log, raw_iron instead/)
  assert.equal(/deposit [^—]*wheat_seeds/.test(m), false,
    'suggesting the refused item would be the same lie in a new place')
})

test('with nothing else bankable the refusal still names a move the bot can make', () => {
  const m = unbankableRefusal('apple', 5, { apple: 5 })
  assert.match(m, /say deposit with no item/)
  assert.equal(/deposit apple instead/.test(m), false)
})

test('MUTANT KILLED: emptying the suggestion list deletes the remedy', async () => {
  await withMutant(ADM,
    "export function unbankableRefusal (item, held, bankableDetail, { limit = 4 } = {}) {",
    "export function unbankableRefusal (item, held, bankableDetail, { limit = 0 } = {}) {",
    async mod => {
      const m = mod.unbankableRefusal('wheat_seeds', 21, { oak_log: 6 })
      assert.equal(/deposit oak_log instead/.test(m), false,
        'the mutant did not remove the remedy, so the test above proves nothing')
    })
})

test('depositNoopDetail states the held count, and normalises the CHAT path', () => {
  const inv = [it_('wheat_seeds', 21)]
  assert.match(depositNoopDetail('wheat_seeds', inv), /you hold 21 wheat_seeds but it is not worth banking/)
  // commands.mjs bypasses admission, so the name arrives with its original casing.
  assert.match(depositNoopDetail(' Wheat_Seeds ', inv), /you hold 21 wheat_seeds but it is not worth banking/)
  assert.match(depositNoopDetail('diamond', inv), /nothing matching diamond to hand over/)
  assert.equal(depositNoopDetail(null, inv), 'nothing worth banking — nothing to deposit')
})

test('MUTANT KILLED: disabling the held branch restores the original lie', async () => {
  // This is the mutant that mattered: review pass 1 reverted the whole fix this way and
  // every test passed, because they grepped for both branches of the ternary.
  await withMutant(SK,
    "  return held > 0\n", "  return held > 1e9\n",
    async mod => {
      assert.match(mod.depositNoopDetail('wheat_seeds', [it_('wheat_seeds', 21)]),
        /nothing matching wheat_seeds to hand over/,
        'the mutant did not restore the lie, so the test above proves nothing')
    })
})
