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
import { depositItemArg, DEPOSIT_WILDCARDS } from '../src/admission.mjs'

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

test('the gate refuses BEFORE the walk, and names what would move instead', () => {
  const a = strip(readFileSync(ADM, 'utf8'))
  assert.ok(a.includes("reason: 'deposit_item_unbankable'"),
    'the gate must have its own reason, distinguishable from deposit_item_missing')
  assert.ok(a.includes('bankableInventory(items, { wants: argWants }).detail'),
    'the bankable set must be computed at the gate, or the refusal cannot happen before the walk')
  assert.ok(/deposit \$\{would\.join\(', '\)\} instead/.test(a),
    'a refusal must name a remedy the bot can perform from where it stands')
  // The set is computed in a try/catch and an unknown must not refuse.
  assert.ok(a.includes('catch { argBankable = null }'),
    'an uncomputable bankable set must fall back to null, which cannot refuse')
})

test('the SKILL message states the held count instead of denying it', () => {
  const s = strip(readFileSync(SK, 'utf8'))
  assert.ok(s.includes('you hold ${heldNow} ${item} but it is not worth banking'),
    'the skill must say the true thing when it holds the item')
  assert.ok(s.includes('nothing matching ${item} to hand over'),
    'and must keep the genuinely-absent wording for the genuinely-absent case')
})

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
