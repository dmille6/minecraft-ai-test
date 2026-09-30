// THE TOSS, AGAINST MINEFLAYER'S OWN CODE: the real simple_inventory plugin (equipEmpty) on a real prismarine window,
// full (36/36) and with one free slot. Positive control: the RAW unequip tosses the pickaxe on the full bag -- the defect
// the sandbox proved on Paper 1.21.11 (2026-09-30). emptyHand must toss nothing and keep the pickaxe. (Claude review sim.)
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { emptyHand } from '../src/toolfor.mjs'
const req = createRequire(import.meta.url)
const ver = '1.21.4'
const Item = req('prismarine-item')(ver)
const windows = req('prismarine-windows')(ver)
const mcd = req('minecraft-data')(ver)
const inject = req('mineflayer/lib/plugins/simple_inventory.js')

let pass = 0, fail = 0
const t = async (name, fn) => { try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) } }

function mk (full) {
  const inv = windows.createWindow(0, 'minecraft:inventory', 'inv', 46)
  const it = n => new Item(mcd.itemsByName[n].id, n.endsWith('pickaxe') ? 1 : (n === 'dirt' ? 64 : 16))
  for (let s = 9; s < 45; s++) inv.updateSlot(s, it(s === 36 ? 'stone_pickaxe' : (s === 9 ? 'dirt' : (s === 37 ? 'wooden_sword' : 'cobblestone'))))
  if (!full) inv.updateSlot(20, null)
  const tossed = []
  const bot = {
    inventory: inv, quickBarSlot: 0, currentWindow: null, supportFeature: () => false, _client: { write () {} }, updateHeldItem () {},
    get heldItem () { return inv.slots[36 + this.quickBarSlot] },
    async clickWindow (slot, btn, mode) { if (slot === -999) tossed.push(inv.selectedItem?.name); inv.acceptClick({ slot, mouseButton: btn, mode, windowId: 0, item: slot === -999 ? null : inv.slots[slot] }) },
    closeWindow () {},
    async moveSlotItem (a, b) { await this.clickWindow(a, 0, 0); await this.clickWindow(b, 0, 0); if (inv.selectedItem) await this.clickWindow(a, 0, 0) },
  }
  inject(bot); bot.tossStack = async item => { tossed.push(item.name) }
  return { bot, inv, tossed }
}
const picks = inv => inv.items().filter(i => i.name === 'stone_pickaxe').length

await t('POSITIVE CONTROL: mineflayer\'s own unequip on a FULL bag tosses the held pickaxe; with a free slot it does not', async () => {
  let { bot, tossed } = mk(true); await bot.unequip('hand'); assert.deepEqual(tossed, ['stone_pickaxe'])
  ;({ bot, tossed } = mk(false)); await bot.unequip('hand'); assert.deepEqual(tossed, [])
})
await t('emptyHand on the FULL bag: swaps a filler in, tosses nothing, keeps the pickaxe, leaves the cursor empty', async () => {
  const { bot, inv, tossed } = mk(true)
  assert.equal(await emptyHand(bot), 'filler')
  assert.deepEqual(tossed, []); assert.equal(picks(inv), 1); assert.equal(inv.selectedItem ?? null, null)
  assert.notEqual(bot.heldItem?.name, 'stone_pickaxe')
})
await t('emptyHand with a free slot: a plain unequip, nothing tossed, pickaxe kept', async () => {
  const { bot, inv, tossed } = mk(false)
  assert.equal(await emptyHand(bot), 'unequip'); assert.deepEqual(tossed, []); assert.equal(picks(inv), 1)
})
console.log(`\n${pass} passed, ${fail} failed`); if (fail) process.exit(1)
