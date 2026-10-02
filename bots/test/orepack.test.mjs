// ROOM BY CAPACITY + PACK THE BAG: the ore tunnel's inventory gate.
//
// oretunnel-03 (10-02): 9 of 12 tunnel attempts were refused `emptySlotCount() < 2 -> deposit first`; the 3 that ran
// all reached the ore. The refused bots had 0 empty slots but 176-252 spare room in stone stacks, and the bank chests
// that "deposit" needs are often full. These tests pin the capacity rule, the lossless pack, and -- through the real
// tunnelToOre -- that the refusal becomes a pack and the tunnel proceeds, with NOTHING thrown on the way.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
const LOG_DIR = `/tmp/mcbot-test-logs-orepack-${process.pid}`
process.env.LOG_DIR = LOG_DIR; process.env.BOT_NAME = 'PackBot'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { Vec3 } = require('vec3')
const VERSION = '1.21.11'   // config.mjs MINECRAFT_VERSION default: the fleet's version
const registry = require('prismarine-registry')(VERSION)
const Recipe = require('prismarine-recipe')(registry).Recipe
const { tunnelRoom, packPlan, isPackRecipe, resultHasRoom, bulkiest, STONE_DROPS, STONE_ROOM, CLUSTER_CAP, PACK_RECIPES, PACK_PROTECTED } =
  await import('../src/oretunnel.mjs')
const { tunnelToOre } = await import('../src/skills.mjs')

let pass = 0, fail = 0
const t = async (name, fn) => { try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) } }

// Items as mineflayer gives them: one entry per slot, with the registry's real stackSize.
const it = (name, count) => { const d = registry.itemsByName[name]; assert.ok(d, `no item ${name}`); return { name, count, type: d.id, stackSize: d.stackSize } }
const stacks = (name, total) => { const s = registry.itemsByName[name].stackSize, out = []; for (let n = total; n > 0; n -= s) out.push(it(name, Math.min(s, n))); return out }
// Filler: one FULL stack each of distinct junk, so no filler outranks the measured junk and none adds stone room.
const FILLER = ['netherrack', 'sand', 'sandstone', 'kelp', 'string', 'bone', 'feather', 'gunpowder', 'flint', 'clay_ball', 'sugar_cane',
                'cactus', 'wheat', 'beetroot', 'carrot', 'potato', 'apple', 'paper', 'leather', 'rotten_flesh', 'spider_eye', 'slime_ball',
                'glowstone_dust', 'redstone', 'lapis_lazuli', 'quartz', 'prismarine_shard', 'ink_sac', 'cocoa_beans', 'melon_slice',
                'pumpkin_seeds', 'melon_seeds', 'beetroot_seeds', 'dandelion', 'poppy', 'cornflower']
const FILL = n => { assert.ok(n <= FILLER.length); return FILLER.slice(0, n).map(name => it(name, registry.itemsByName[name].stackSize)) }
const to36 = items => [...items, ...FILL(36 - items.length)]
const stickSize = n => registry.itemsByName[n]?.stackSize

// The two measured refusals (oretunnel-03), rebuilt with their junk and stone spare; 0 empty slots, no raw_iron stack.
const DELTA = to36([...stacks('bamboo', 179), it('leaf_litter', 54), it('wheat_seeds', 39), it('oak_sapling', 8),
                    it('cobblestone', 30), it('cobblestone', 10), it('dirt', 20), it('andesite', 20)])          // stone spare 176
const ALPHA = to36([...stacks('leaf_litter', 221), it('egg', 15), it('oak_sapling', 5), it('birch_sapling', 3),
                    it('cobblestone', 2), it('cobblestone', 2), it('cobbled_deepslate', 12), it('tuff', 20), it('andesite', 32)])  // stone spare 252

// ---- tunnelRoom ----
await t('POSITIVE CONTROL: the measured inventories are full and carry the measured stone spare', () => {
  assert.equal(DELTA.length, 36); assert.equal(ALPHA.length, 36)
  assert.equal(tunnelRoom(DELTA, 0).stoneSpare, 176); assert.equal(tunnelRoom(ALPHA, 0).stoneSpare, 252)
})
await t('measured refusals: STONE room passes on held stacks, but the ore still needs a slot (no raw_iron stack, no empty slot)', () => {
  for (const [name, inv] of [['hive-a-Delta', DELTA], ['board-b-Alpha', ALPHA]]) {
    const r = tunnelRoom(inv, 0)
    assert.equal(r.stone, true, `${name}: stone`); assert.equal(r.ore, false, `${name}: ore`)
    assert.equal(r.ok, false); assert.equal(r.slotsShort, 1); assert.match(r.why, /raw_iron/)
    assert.equal(tunnelRoom(inv, 1).ok, true, `${name}: ONE empty slot is now enough (was two)`)
  }
})
await t('ore room from a held raw_iron stack: >= cluster cap spare passes with 0 empty slots; less does not', () => {
  const base = DELTA.slice(0, 35)
  assert.equal(tunnelRoom([...base, it('raw_iron', 64 - CLUSTER_CAP)], 0).ok, true)
  assert.equal(tunnelRoom([...base, it('raw_iron', 64 - CLUSTER_CAP + 1)], 0).ok, false)
})
await t('two empty slots pass as before, whatever the stacks hold', () => {
  assert.equal(tunnelRoom(FILL(34), 2).ok, true)
  assert.equal(tunnelRoom([], 2).ok, true)
})
await t('one empty slot and no stone spare fails (the slot is the ore\'s); a second slot or 32 stone spare passes', () => {
  const full = FILL(34).concat(stacks('cobblestone', 64))
  const r = tunnelRoom(full, 1)
  assert.equal(r.ok, false); assert.equal(r.ore, true); assert.equal(r.stone, false); assert.equal(r.slotsShort, 1)
  assert.equal(tunnelRoom(FILL(34).concat(it('cobblestone', 64 - STONE_ROOM)), 1).ok, true)
  assert.equal(tunnelRoom(FILL(34).concat(it('cobblestone', 64 - STONE_ROOM + 1)), 1).ok, false)
})
await t('real stack sizes: 15 eggs (stack 16) and junk stacks give no stone room; a stack with no stackSize counts as none', () => {
  assert.equal(tunnelRoom([it('egg', 1), it('leaf_litter', 1)], 1).stone, false)
  assert.equal(tunnelRoom([{ name: 'cobblestone', count: 1 }], 1).stone, false, 'never assume 64')
  assert.equal(tunnelRoom([it('snowball', 1)], 0).stoneSpare, 0)
})
await t('STONE_DROPS is what the tunnel\'s blocks actually drop (registry ' + VERSION + ')', () => {
  for (const b of ['stone', 'deepslate', 'dirt', 'grass_block', 'gravel', 'andesite', 'diorite', 'granite', 'tuff']) {
    const drops = (registry.blocksByName[b].drops ?? []).map(d => registry.items[typeof d === 'object' ? (d.drop?.id ?? d.id) : d]?.name)
    assert.ok(drops.length > 0, `${b} has no modelled drop`)
    for (const d of drops) assert.ok(STONE_DROPS.has(d), `${b} drops ${d}, not in STONE_DROPS`)
  }
})

// ---- packPlan ----
await t('the recipe is real: bamboo/bamboo -> 1 stick, inventory grid (no table), exactly one match among stick recipes', () => {
  const ids = { bamboo: registry.itemsByName.bamboo.id, stick: registry.itemsByName.stick.id }
  const all = Recipe.find(ids.stick, null)
  assert.ok(all.length > 5, `positive control: stick has ${all.length} recipes (planks variants included)`)
  const ok = all.filter(r => isPackRecipe(r, ids.bamboo, ids.stick, PACK_RECIPES[0]))
  assert.equal(ok.length, 1); assert.equal(ok[0].requiresTable, false)
  assert.ok(all.some(r => !isPackRecipe(r, ids.bamboo, ids.stick, PACK_RECIPES[0]) && r.delta.some(d => /_planks$/.test(registry.items[d.id].name))),
    'planks->stick exists and is NOT accepted')
})
await t('179 bamboo (3 slots) frees >= 1 slot when the first stick has somewhere to go (an empty slot, or a stick stack)', () => {
  const inv = DELTA.slice(0, 35)
  const p = packPlan(inv, { emptySlots: 1, stackSizeOf: stickSize })
  assert.ok(p && p.freed >= 1, JSON.stringify(p))
  assert.equal(p.from, 'bamboo'); assert.equal(p.to, 'stick'); assert.equal(p.crafts, 58, '58 crafts: 63 bamboo + 58 sticks = 2 slots')
  const withSticks = packPlan([...DELTA.slice(0, 35), it('stick', 3)].slice(1), { emptySlots: 0, stackSizeOf: stickSize })
  assert.ok(withSticks && withSticks.freed >= 1, `held sticks: ${JSON.stringify(withSticks)}`)
})
await t('NEVER THROWN: 0 empty slots and no stick stack -> null (mineflayer would toss the first stick)', () => {
  assert.equal(packPlan(DELTA, { emptySlots: 0, stackSizeOf: stickSize }), null)
  assert.equal(resultHasRoom(DELTA, 0, 'stick'), false)
  assert.equal(resultHasRoom([...DELTA, it('stick', 63)], 0, 'stick'), true)
  assert.equal(resultHasRoom([...DELTA, it('stick', 64)], 0, 'stick'), false)
})
await t('60 bamboo in one slot returns null (nothing to free)', () => {
  assert.equal(packPlan([it('bamboo', 60), ...FILL(34)], { emptySlots: 1, stackSizeOf: stickSize }), null)
})
await t('never proposes consuming tools, logs, planks, saplings, ores or raw drops', () => {
  const precious = [it('oak_log', 64), it('oak_log', 64), it('oak_planks', 64), it('oak_planks', 64), it('oak_sapling', 64), it('oak_sapling', 3),
                    it('iron_ore', 64), it('iron_ore', 2), it('raw_iron', 64), it('raw_iron', 1), it('coal', 64), it('coal', 5), it('stick', 3), it('stone_pickaxe', 1)]
  assert.equal(packPlan(precious, { emptySlots: 1, stackSizeOf: stickSize }), null)
  for (const n of ['oak_log', 'oak_planks', 'birch_sapling', 'iron_ore', 'deepslate_iron_ore', 'raw_iron', 'stone_pickaxe', 'wooden_axe', 'stick', 'crafting_table'])
    assert.ok(PACK_PROTECTED.test(n), `${n} must be protected`)
  for (const r of PACK_RECIPES) assert.ok(!PACK_PROTECTED.test(r.from), `${r.from} is a protected input`)
})
await t('bulkiest names the junk filling the bag, never stone or protected items', () => {
  const b = bulkiest(ALPHA).map(x => x.name)
  assert.equal(b[0], 'leaf_litter'); assert.ok(!b.includes('cobblestone') && !b.includes('oak_sapling'), b.join())
})

// ---- WIRED: the real tunnelToOre, a slot-faithful inventory, and mineflayer's craft semantics (tosses included) ----
// The fake inventory models what mineflayer's craft does: pick up the first matching slot, place the ingredients,
// put the rest back (merge first, then an empty slot), then put the result away -- and TOSS it when there is no
// room (inventory.js putSelectedItemRange). A toss is recorded so the test can forbid it.
function packBot (initial, empty) {
  const slots = [...initial.map(x => ({ ...x })), ...Array(empty).fill(null)]
  assert.equal(slots.length, 36)
  const tossed = [], crafted = []
  const put = (name, n) => {   // merge into stacks with room, then the first empty slot; leftover is TOSSED
    for (const s of slots) if (n > 0 && s?.name === name && s.count < s.stackSize) { const k = Math.min(n, s.stackSize - s.count); s.count += k; n -= k }
    while (n > 0) {
      const i = slots.indexOf(null)
      if (i < 0) { tossed.push({ name, n }); return }
      const k = Math.min(n, registry.itemsByName[name].stackSize); slots[i] = it(name, k); n -= k
    }
  }
  const bot = {
    registry, version: VERSION, entity: { position: new Vec3(0.5, 64, 0.5) }, health: 20, food: 20,
    inventory: { items: () => slots.filter(Boolean).map(x => ({ ...x })), emptySlotCount: () => slots.filter(s => !s).length },
    recipesFor (id, _m, count = 1, table = null) {
      const have = n => slots.filter(s => s?.type === n).reduce((a, s) => a + s.count, 0)
      return Recipe.find(id, null).filter(r => (!r.requiresTable || table) && r.delta.every(d => d.count >= 0 || have(d.id) >= -d.count * count))
    },
    async craft (recipe, count = 1) {
      for (let c = 0; c < count; c++) {
        for (const d of recipe.delta.filter(x => x.count < 0)) {
          let need = -d.count
          const name = registry.items[d.id].name
          const i = slots.findIndex(s => s?.type === d.id); if (i < 0) throw new Error('missing ingredient')
          let cursor = slots[i].count; slots[i] = null
          while (cursor < need) { const j = slots.findIndex(s => s?.type === d.id); if (j < 0) throw new Error('missing ingredient'); cursor += slots[j].count; slots[j] = null }
          cursor -= need; need = 0
          if (cursor > 0) put(name, cursor)
        }
        for (const d of recipe.delta.filter(x => x.count > 0)) { crafted.push(registry.items[d.id].name); put(registry.items[d.id].name, d.count) }
      }
    },
    findBlocks: () => [],   // the tunnel's NEXT step: no iron in range -> a no_tunnel refusal proves the room gate passed
    blockAt: () => null,
  }
  return { bot, slots, tossed, crafted }
}
const total = (slots, name) => slots.filter(s => s?.name === name).reduce((a, s) => a + s.count, 0)
const rows = () => { try { return fs.readFileSync(path.join(LOG_DIR, 'skill-PackBot.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)) } catch { return [] } }
const settle = () => new Promise(r => setTimeout(r, 150))

await t('WIRED: one empty slot + bamboo (refused by the old < 2 rule) -> packs, frees a slot, and the tunnel PROCEEDS; nothing thrown', async () => {
  const inv = [...stacks('bamboo', 179), ...stacks('cobblestone', 64), ...FILL(31)]
  const { bot, slots, tossed, crafted } = packBot(inv, 1)
  assert.equal(bot.inventory.emptySlotCount(), 1, 'positive control: the old rule refuses this bot')
  const r = await tunnelToOre({ bot, runner: null }, { aborted: false }, { deadlineMs: 150_000 })
  assert.notEqual(r.failClass, 'inventory_full', `still refused: ${r.detail}`)
  assert.equal(r.failClass, 'no_tunnel', `the next step should run: ${r.detail}`)
  assert.deepEqual(tossed, [], 'a craft threw items on the ground')
  assert.ok(crafted.length > 0 && crafted.every(n => n === 'stick'), `crafted ${crafted}`)
  assert.equal(total(slots, 'bamboo') + 2 * total(slots, 'stick'), 179, 'lossless: every bamboo is still bamboo or in a stick')
  assert.ok(bot.inventory.emptySlotCount() >= 2, `empty ${bot.inventory.emptySlotCount()}`)
  await settle()
  const packed = rows().filter(x => x.skill?.name === '_bag_packed')
  assert.equal(packed.length, 1, `one bag_packed row (got ${packed.length})`)
  assert.match(packed[0].skill?.detail ?? '', /bamboo->stick, empty slots 1->2/)
})
await t('WIRED: full bag, no bamboo -> refused inventory_full, the remedy names the junk, no craft, no toss', async () => {
  const inv = [...stacks('leaf_litter', 221), ...stacks('cobblestone', 64), ...FILL(31)]
  const { bot, tossed, crafted } = packBot(inv, 0)
  const r = await tunnelToOre({ bot, runner: null }, { aborted: false }, { deadlineMs: 150_000 })
  assert.equal(r.failClass, 'inventory_full'); assert.match(r.detail, /leaf_litter 221 \(4 slots\)/)
  assert.deepEqual(tossed, []); assert.equal(crafted.length, 0)
})
await t('WIRED: hive-a-Delta as measured (0 empty, no sticks) -> refused, and the toss guard keeps bamboo uncrafted', async () => {
  const { bot, tossed, crafted } = packBot(DELTA, 0)
  const r = await tunnelToOre({ bot, runner: null }, { aborted: false }, { deadlineMs: 150_000 })
  assert.equal(r.failClass, 'inventory_full'); assert.match(r.detail, /bamboo 179 \(3 slots\)/)
  assert.deepEqual(tossed, []); assert.equal(crafted.length, 0)
})

// ---- MUTANTS: each guard above must be SEEN to fail for its intended reason (anchor present and unique) ----
async function withMutant (file, old, neu, fn) {
  const url = new URL(`../src/${file}`, import.meta.url)
  const src = fs.readFileSync(url, 'utf8')
  assert.ok(src.includes(old), `ANCHOR MISSING in ${file}: ${JSON.stringify(old.slice(0, 60))} -- a mutant never written reads as killed`)
  assert.equal(src.split(old).length, 2, `anchor not unique in ${file}`)
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  fs.writeFileSync(out, src.replace(old, neu).replace(/from '\.\//g, "from '../src/"))
  try { return await fn(await import(out.href)) } finally { try { fs.unlinkSync(out) } catch {} }
}
const killed = async (fn) => { try { await fn() } catch { return true } return false }

await t('MUTANT KILLED: ignoring held stone stacks (the old slot-only rule) fails the measured-refusal test', async () => {
  await withMutant('oretunnel.mjs', 'const stone = stoneSpare >= stoneNeed || empty', 'const stone = empty', async m => {
    assert.ok(await killed(() => assert.equal(m.tunnelRoom(DELTA, 1).ok, true)), 'mutant survived: stone spare is not what passes Delta')
  })
})
await t('MUTANT KILLED: dropping the planner\'s result-room check proposes a craft whose first stick mineflayer would toss', async () => {
  await withMutant('oretunnel.mjs', '    if (!resultHasRoom(items, emptySlots, r.to, r.makes)) continue\n', '', async m => {
    assert.ok(await killed(() => assert.equal(m.packPlan(DELTA, { emptySlots: 0, stackSizeOf: stickSize }), null)), 'mutant survived')
  })
})
await t('MUTANT KILLED: unwiring the pack leaves the one-empty-slot bamboo bot refused', async () => {
  await withMutant('skills.mjs', 'const packed = await packBag(bot, signal, room)', 'const packed = { said: null }', async m => {
    const { bot } = packBot([...stacks('bamboo', 179), ...stacks('cobblestone', 64), ...FILL(31)], 1)
    const r = await m.tunnelToOre({ bot, runner: null }, { aborted: false }, { deadlineMs: 150_000 })
    assert.equal(r.failClass, 'inventory_full', `mutant should be refused, got ${r.failClass}: ${r.detail}`)
  })
})

try { fs.rmSync(LOG_DIR, { recursive: true, force: true }) } catch {}
console.log(`\n${pass} passed, ${fail} failed`); if (fail) process.exit(1)
