// THE FLEET BANKS ITS GOOD TOOLS AND KEEPS THE WORN ONES, AND NOBODY CHOSE THAT.
//
// MEASURED 2026-09-27: held pickaxes sit at a MEDIAN 1.7% durability (237 of 295 at <=10%, one bot
// carrying twelve) while BANKED pickaxes sit at a median 48.1% -- 676 of 1,382 above 50%, 484 above
// 75%, and 112 with no damage tag at all, i.e. never used. A durability-blind split cannot produce a
// 28x asymmetry by chance.
//
// It was the absence of a decision. `bankableInventory` does `avail -= 1` per tool NAME
// (bankable.mjs) and nothing in the chain reads durability, so which copy survives was decided by
// mineflayer: `transfer` picks source stacks with `findItemRange`, which scans ASCENDING from
// inventoryStart (prismarine-windows Window.js:308), and in a container window the hotbar is the last
// range -- so the main-inventory copies are banked and the hotbar copy is kept, whatever its wear.
//
// The second defect in the same loop: mineflayer lifts the stack onto the CURSOR
// (`clickWindow(sourceItem.slot, 0, 0)`, inventory.js:301) and only puts it back on the count===0
// path (:288). `destination full` throws from clickDest (:323) AFTER the lift, deposit's `catch {}`
// swallowed it, and `finally { chest.close() }` then closed the window with an item on the cursor --
// which vanilla drops into the world.
import assert from 'node:assert'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { toolBankOrder } from '../src/bankable.mjs'
import { returnCursor } from '../src/skills.mjs'

let pass = 0, fail = 0
const t = (n, f) => { try { f(); pass++; console.log(`  PASS  ${n}`) } catch (e) { fail++; console.log(`  FAIL  ${n}\n        ${e.message}`) } }
const ta = async (n, f) => { try { await f(); pass++; console.log(`  PASS  ${n}`) } catch (e) { fail++; console.log(`  FAIL  ${n}\n        ${e.message}`) } }
const pick = (slot, used, max = 131) => ({ name: 'stone_pickaxe', slot, count: 1, durabilityUsed: used, maxDurability: max })

t('the FULLEST copy stays and the worn ones are banked, worst first', () => {
  const r = toolBankOrder([pick(12, 130), pick(44, 2), pick(13, 60)])
  assert.equal(r.keep.slot, 44, 'the 129-use copy must be the one kept')
  assert.deepEqual(r.bank.map(b => b.slot), [12, 13], 'banked worst-first: 1 use, then 71')
})

t('it beats the slot order rather than riding it — the keeper can be in main inventory', () => {
  // slot 20 is main inventory, slot 44 is the hotbar. Today the hotbar copy survives by accident.
  const r = toolBankOrder([pick(44, 129), pick(20, 1)])
  assert.equal(r.keep.slot, 20, 'the fullest copy must win even when it is NOT in the hotbar')
})

t('unknown durability counts as FULL, never as spent', () => {
  // toolfor.mjs `remaining` returns Infinity when maxDurability is absent, and this must agree with
  // it -- a producer and a consumer disagreeing about one predicate is how eight defects happened.
  const r = toolBankOrder([pick(1, 2), { name: 'stone_pickaxe', slot: 2, count: 1 }])
  assert.equal(r.keep.slot, 2, 'an unknown-durability copy is kept over a 98%-worn one')
})

t('a single copy is never banked, and an empty list does not throw', () => {
  assert.deepEqual(toolBankOrder([pick(9, 130)]).bank, [], 'banking your only pickaxe is the entombment bug')
  assert.equal(toolBankOrder([pick(9, 130)]).keep.slot, 9)
  assert.deepEqual(toolBankOrder([]), { bank: [], keep: null })
  assert.deepEqual(toolBankOrder(), { bank: [], keep: null })
})

t('ties fall back to slot order, so the result is deterministic', () => {
  const r = toolBankOrder([pick(30, 65), pick(11, 65), pick(20, 65)])
  assert.deepEqual(r.bank.map(b => b.slot), [11, 20], 'equal wear must order by slot, not by input order')
  assert.equal(r.keep.slot, 30)
})

// ---- the cursor rescue, behaviourally ----
const fakeWindow = (held, emptyAt) => ({
  selectedItem: held, inventoryStart: 9, inventoryEnd: 45,
  firstEmptySlotRange: () => emptyAt,
})

await ta('returnCursor puts a held stack back into a guaranteed-empty slot', async () => {
  const clicks = []
  const bot = { clickWindow: async (s, b, m) => clicks.push([s, b, m]) }
  const r = await returnCursor(bot, fakeWindow({ name: 'oak_log', count: 32 }, 17))
  assert.equal(r.returned, true)
  assert.equal(r.slot, 17)
  assert.deepEqual(clicks, [[17, 0, 0]], 'one left-click on the empty destination')
})

await ta('an empty cursor is a no-op, not a spurious click', async () => {
  const clicks = []
  const bot = { clickWindow: async s => clicks.push(s) }
  const r = await returnCursor(bot, fakeWindow(null, 17))
  assert.equal(r.returned, false)
  assert.deepEqual(clicks, [], 'nothing must be clicked when the cursor is empty')
})

await ta('a full inventory reports honestly instead of clicking into nowhere', async () => {
  const bot = { clickWindow: async () => { throw new Error('should not be called') } }
  const r = await returnCursor(bot, fakeWindow({ name: 'cobblestone' }, null))
  assert.equal(r.returned, false)
  assert.match(r.reason, /no empty slot/)
})

await ta('returnCursor never throws into the deposit loop', async () => {
  const bot = { clickWindow: async () => { throw new Error('window closed') } }
  const r = await returnCursor(bot, fakeWindow({ name: 'dirt' }, 12))
  assert.equal(r.returned, false, 'it reports the failure')
  assert.match(r.reason, /window closed/)
})

// ---- structural: the wiring, which behaviour cannot reach without a server ----
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const SRC = strip(readFileSync(new URL('../src/skills.mjs', import.meta.url), 'utf8'))

t('deposit banks tools by EXACT SLOT, not by type', () => {
  assert.ok(/toolBankOrder\(stacks\)/.test(SRC), 'the keeper is not consulted in deposit')
  assert.ok(/bot\.moveSlotItem\(copy\.slot, dest\)/.test(SRC), 'tools must move by slot, or the keeper is decorative')
  const i = SRC.indexOf('toolBankOrder(stacks)')
  const j = SRC.indexOf('chest.deposit(it.type', i)
  assert.ok(j > i, 'the type-based path must remain for materials, after the tool branch')
})

t('every catch around a transfer returns the cursor before the window can close', () => {
  const body = SRC.slice(SRC.indexOf('async function deposit'), SRC.indexOf('async function deposit') + 6000)
  const catches = (body.match(/catch \(e\) \{/g) || []).length
  const rescues = (body.match(/await returnCursor\(bot, chest\)/g) || []).length
  assert.ok(rescues >= 2, `expected a rescue in both transfer paths, found ${rescues}`)
  assert.ok(!/catch \{ \/\* chest full \*\/ \}/.test(body), 'the swallowing catch is still there')
  assert.ok(catches >= rescues, 'a rescue outside a catch would run on the success path')
})

async function withMutant (url, old, neu, fn) {
  const src = readFileSync(url, 'utf8')
  assert.ok(src.includes(old), `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 60))} absent`)
  assert.equal(src.split(old).length, 2, 'the mutation target is not unique; the mutant is ambiguous')
  const body = src.replace(old, neu).replace(/from '\.\//g, "from '../src/")
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, body)
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}
const BANK = new URL('../src/bankable.mjs', import.meta.url)
const SKIL = new URL('../src/skills.mjs', import.meta.url)

await ta('MUTANT KILLED: reversing the sort keeps the WORN copy — the live defect', async () => {
  await withMutant(BANK, 'remaining(a) - remaining(b) || (a.slot ?? 0) - (b.slot ?? 0)',
                         'remaining(b) - remaining(a) || (a.slot ?? 0) - (b.slot ?? 0)',
    async m => {
      const r = m.toolBankOrder([pick(12, 130), pick(44, 2)])
      assert.equal(r.keep.slot, 12,
        'the mutant is not reproducing the keep-the-worn-copy defect; this test proves nothing')
    })
})

await ta('MUTANT KILLED: slicing the wrong end banks the keeper and keeps the junk', async () => {
  await withMutant(BANK, 'return { bank: sorted.slice(0, -1), keep: sorted.at(-1) ?? null }',
                         'return { bank: sorted.slice(1), keep: sorted.at(0) ?? null }',
    async m => {
      const r = m.toolBankOrder([pick(12, 130), pick(44, 2)])
      assert.equal(r.keep.slot, 12, 'the mutant is not reproducing the boundary error')
      assert.deepEqual(r.bank.map(b => b.slot), [44], 'the mutant must bank the good copy')
    })
})

await ta('MUTANT KILLED: without a destination check the cursor is clicked into nowhere', async () => {
  await withMutant(SKIL, "    if (dest == null) return { returned: false, reason: 'no empty slot to return it to' }",
                         '    if (false) return { returned: false }',
    async m => {
      let called = null
      const bot = { clickWindow: async s => { called = s } }
      await m.returnCursor(bot, fakeWindow({ name: 'dirt' }, null))
      assert.equal(called, null, 'the mutant should click null — if it did not, the guard is untested')
    })
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
