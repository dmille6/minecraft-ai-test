// TOOLRANK-01 (11-09, owner-approved: bots don't craft lower-tier tools they don't need). BEHAVIOUR against the real modules:
// redundantCraft's two additions (other tools; the pickaxe pair), every existing exemption still first (task wants, escape
// reserve, exit reserve, open exit shortfall), the refusal CHAIN through the real AdmissionControl with its remedy admitted next
// and executable (toolFor picks the held copy), the prompt's craft advice, the switch. Anchored mutants, each killed.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
process.env.OLLAMA_MODEL ??= 'qwen2.5:7b-instruct'
process.env.LOG_DIR = process.env.LOG_DIR || '/tmp/mcbot-test-logs-toolrank'
process.env.BOT_NAME = process.env.BOT_NAME || 'ToolrankBot'
delete process.env.TOOL_HYGIENE; delete process.env.TOOLRANK

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SRC = path.join(HERE, '..', 'src')
const require_ = createRequire(import.meta.url)
const mcData = require_('minecraft-data')('1.21.8')
const { Recipe } = require_('prismarine-recipe')('1.21.8')
const H = await import('../src/toolhygiene.mjs')
const { toolFor, FLOOR } = await import('../src/toolfor.mjs')
const { descentPickNeed } = await import('../src/exit-contract.mjs')
const { AdmissionControl } = await import('../src/admission.mjs')
const { Lessons } = await import('../src/lessons.mjs')
const { craftableNow } = await import('../src/prompt.mjs')

let pass = 0, fail = 0
const t = async (name, fn) => { try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) } }
const P = (name, left) => { const max = mcData.itemsByName[name].maxDurability; return { name, count: 1, type: mcData.itemsByName[name].id, maxDurability: max, durabilityUsed: max - left } }
const R = (item, bag, o = {}) => H.redundantCraft(item, bag, { y: 70, ...o })

// ---- other tools ----------------------------------------------------------------------------------------------------
await t('OTHER TOOLS: a stone axe/shovel/hoe/sword beside a working same-kind copy of the same tier or better is refused', () => {
  for (const [item, held] of [['stone_axe', 'iron_axe'], ['stone_shovel', 'iron_shovel'], ['wooden_hoe', 'stone_hoe'], ['stone_sword', 'diamond_sword'], ['stone_axe', 'stone_axe'], ['wooden_shovel', 'golden_shovel']]) {
    const v = R(item, [P(held, 40)])
    assert.equal(v?.kind, 'tool', `${item} beside ${held}`); assert.equal(v.held, held)
    assert.match(v.detail, new RegExp(`you already hold a ${held} with 40 uses left -- .*use it`))
  }
})
await t('OTHER TOOLS: never beside a worn copy (<= FLOOR), a lower tier, another kind, or an empty bag', () => {
  assert.equal(R('stone_axe', [P('iron_axe', FLOOR)]), null, 'worn: at FLOOR')
  assert.ok(R('stone_axe', [P('iron_axe', FLOOR + 1)]), 'one over FLOOR covers')
  assert.equal(R('stone_axe', [P('wooden_axe', 59)]), null, 'an upgrade is not redundant')
  assert.equal(R('stone_axe', [P('iron_shovel', 250), P('iron_pickaxe', 250)]), null, 'another kind')
  assert.equal(R('stone_axe', []), null)
  assert.equal(R('iron_axe', [P('stone_axe', 131)]), null, 'iron beside stone: the toolkit makes it')
})
await t('OTHER TOOLS: the task wants it -> admitted; TOOL_HYGIENE off or TOOLRANK off -> admitted', () => {
  const bag = [P('iron_axe', 200)]
  assert.equal(R('stone_axe', bag, { wanted: new Set(['stone_axe']) }), null)
  assert.equal(R('stone_axe', bag, { on: false }), null)
  assert.equal(R('stone_axe', bag, { toolrank: false }), null)
  assert.ok(R('stone_axe', bag, { wanted: new Set(['oak_log']) }))
})

// ---- the pickaxe pair -----------------------------------------------------------------------------------------------
await t('PAIR: stone pickaxe beside iron@242 + stone spare@29 (under the 40 line) is refused -- the toolkit pair is carried', () => {
  const v = R('stone_pickaxe', [P('iron_pickaxe', 242), P('stone_pickaxe', 29)])
  assert.equal(v?.kind, 'pickaxe_pair'); assert.equal(v.held, 'iron_pickaxe+stone_pickaxe')
  assert.match(v.detail, /toolkit's pair: a iron_pickaxe with 242 uses left and a stone_pickaxe spare with 29 uses left -- dig with them/)
  assert.equal(R('stone_pickaxe', [P('diamond_pickaxe', 1561), P('iron_pickaxe', 26), P('stone_pickaxe', 29)])?.kind, 'pickaxe_pair', 'measured: board-a-Alpha 10:07Z')
  assert.equal(R('wooden_pickaxe', [P('iron_pickaxe', 200), P('stone_pickaxe', 15)])?.kind, 'pickaxe', 'a wooden craft: the base rule already covers it (the pair only adds stone crafts)')
  assert.equal(R('wooden_pickaxe', [P('iron_pickaxe', 200), P('wooden_pickaxe', 30)])?.kind, 'pickaxe', 'control: the base rule already refuses this one')
})
await t('PAIR: admitted when the spare is spent or missing, only lower tier, or the main pick is under the trip line', () => {
  assert.equal(R('stone_pickaxe', [P('iron_pickaxe', 242), P('stone_pickaxe', 1), P('wooden_pickaxe', 30)]), null, 'the spare is spent (wooden is below stone)')
  assert.equal(R('stone_pickaxe', [P('iron_pickaxe', 242), P('wooden_pickaxe', 30)]), null, 'a wooden spare: the stone upgrades it')
  assert.equal(R('stone_pickaxe', [P('iron_pickaxe', 39), P('stone_pickaxe', 29)]), null, 'main under 40: the iron is nearly done')
  assert.equal(R('stone_pickaxe', [P('iron_pickaxe', 242), P('stone_pickaxe', FLOOR)]), null, 'spare at FLOOR is worn')
})
await t('PAIR COMPOSES: every existing exemption still wins -- escape reserve, exit reserve, open exit shortfall, task wants', () => {
  const pair = [P('iron_pickaxe', 60), P('stone_pickaxe', 15)]
  assert.ok(R('stone_pickaxe', pair), 'control: refused at the surface')
  assert.equal(R('stone_pickaxe', [P('iron_pickaxe', 242)]), null, 'one usable pickaxe: the escape asks for two')
  const deep = -50
  assert.ok(descentPickNeed(deep) > 75, `the exit reserve at y=${deep} is ${descentPickNeed(deep)}`)
  assert.equal(R('stone_pickaxe', pair, { y: deep }), null, 'deep: 75 swings under the exit reserve -> admitted (the exit contract\'s remedy)')
  assert.equal(R('stone_pickaxe', pair, { exitShort: { want: 200, at: Date.now() } }), null, 'mine refused for swings: admitted')
  assert.equal(R('stone_pickaxe', pair, { wanted: new Set(['stone_pickaxe']) }), null, 'the rung/prerequisite wants it')
  assert.equal(R('stone_pickaxe', pair, { toolrank: false }), null, 'off: the base (stone 15 < 40 is no cover)')
})

// ---- the chain through the real admission gate ---------------------------------------------------------------------
function botWith (inv) {
  const items = inv.map((x, slot) => ({ ...x, slot, type: mcData.itemsByName[x.name]?.id }))
  const held = id => items.filter(i => i.type === Number(id)).reduce((s, i) => s + i.count, 0)
  return {
    entity: { position: { x: 0, y: 70, z: 0 } }, health: 20, food: 20, players: {},
    inventory: { items: () => items }, registry: mcData,
    recipesFor: (id, meta, min, table) => Recipe.find(id, meta).filter(r => {
      if (r.requiresTable && !table) return false
      const need = {}
      for (const d of r.delta) if (d.count < 0) need[d.id] = (need[d.id] ?? 0) - d.count
      return Object.entries(need).every(([rid, n]) => held(rid) >= n)
    }),
    recipesAll: () => [], findBlock: () => null, findBlocks: () => [], blockAt: () => ({ name: 'stone', boundingBox: 'block' }),
  }
}
let seq = 0
const gate = () => { const L = new Lessons(`/tmp/mcai-toolrank-${process.pid}-${seq++}.json`); L.data.avoid = {}; L.data.worked = {}; return new AdmissionControl(L) }
const MATS = [{ name: 'cobblestone', count: 6 }, { name: 'stick', count: 4 }, { name: 'crafting_table', count: 1 }, { name: 'oak_planks', count: 6 }]
await t('THE CHAIN: model proposes craft stone_axe holding iron_axe@200 -> refused redundant_craft naming it; the remedy (gather logs) is admitted next', () => {
  const g = gate(), bot = botWith([P('iron_axe', 200), ...MATS])
  const r = g.check({ skill: 'craft', args: { item: 'stone_axe' }, reason: 'x' }, bot, new Set(['oak_log']))
  assert.equal(r.ok, false); assert.equal(r.reason, 'redundant_craft'); assert.match(r.detail, /iron_axe with 200 uses left/)
  assert.equal(g.check({ skill: 'gather', args: { block: 'oak_log', count: 3 }, reason: 'x' }, bot, new Set(['oak_log'])).ok, true, 'the remedy runs')
  assert.equal(gate().check({ skill: 'craft', args: { item: 'stone_axe' }, reason: 'work order' }, bot, new Set(['stone_axe', 'cobblestone', 'stick'])).ok, true, 'a task that wants it is admitted')
  assert.equal(gate().check({ skill: 'craft', args: { item: 'stone_axe' }, reason: 'x' }, botWith([P('iron_axe', 5), ...MATS]), new Set(['oak_log'])).ok, true, 'a worn iron axe: admitted')
})
await t('THE CHAIN: craft stone_pickaxe holding the pair -> refused; deep in a mine the same bag is admitted (the exit contract\'s ask)', () => {
  const bag = [P('iron_pickaxe', 120), P('stone_pickaxe', 20), ...MATS]
  const r = gate().check({ skill: 'craft', args: { item: 'stone_pickaxe' }, reason: 'x' }, botWith(bag), new Set(['dirt']))
  assert.equal(r.ok, false); assert.equal(r.redundant.kind, 'pickaxe_pair')
  const deep = botWith(bag); deep.entity.position.y = -50
  assert.equal(gate().check({ skill: 'craft', args: { item: 'stone_pickaxe' }, reason: 'x' }, deep, new Set(['dirt'])).ok, true)
})
await t('THE REMEDY IS EXECUTABLE: toolFor digs with the held better copy (dirt -> iron_shovel; stone -> the stone spare first)', () => {
  const blk = (name, cls, ids) => ({ name, harvestTools: ids ? Object.fromEntries(ids.map(i => [i, true])) : undefined,
    digTime: typeId => { const n = Object.values(mcData.items).find(i => i.id === typeId)?.name ?? ''; return n.endsWith('_' + cls) ? 200 : 1000 } })
  const dirt = blk('dirt', 'shovel')
  assert.equal(toolFor(dirt, [P('iron_shovel', 200)], { hygiene: true }).item?.name, 'iron_shovel')
  const ids = ['wooden_pickaxe', 'stone_pickaxe', 'iron_pickaxe', 'diamond_pickaxe'].map(n => mcData.itemsByName[n].id)
  const stone = blk('stone', 'pickaxe', ids)
  assert.ok(['stone_pickaxe', 'iron_pickaxe'].includes(toolFor(stone, [P('iron_pickaxe', 120), P('stone_pickaxe', 20)], { hygiene: true }).item?.name))
})
await t('THE PROMPT does not advertise a refused tool (craftableNow), and still lists it when not covered', () => {
  const inv = [P('iron_axe', 200), ...MATS]
  assert.doesNotMatch(craftableNow(botWith(inv), null) ?? '', /stone_axe/)
  assert.match(craftableNow(botWith([P('iron_axe', 3), ...MATS]), null) ?? '', /stone_axe/, 'positive control: listed beside a worn iron axe')
})
await t('switch: TOOLRANK=off in a fresh process', () => {
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', `import('${path.join(SRC, 'toolhygiene.mjs')}').then(m => console.log(JSON.stringify(m.TOOLRANK)))`], { env: { ...process.env, TOOLRANK: 'off' }, encoding: 'utf8' })
  assert.deepEqual(JSON.parse(r.stdout), { on: false })
  assert.deepEqual(H.TOOLRANK, { on: true })
})

// ---- mutants (anchors present and unique) --------------------------------------------------------------------------
async function withMutant (old, neu, fn) {
  const p = path.join(SRC, 'toolhygiene.mjs')
  const src = readFileSync(p, 'utf8')
  assert.equal(src.split(old).length - 1, 1, `ANCHOR MISSING OR NOT UNIQUE: ${old.slice(0, 70)}`)
  const tmp = path.join(SRC, `_mut_${process.pid}_${Math.random().toString(36).slice(2)}_toolhygiene.mjs`)
  writeFileSync(tmp, src.replace(old, neu))
  try { return await fn(await import(`${tmp}?${Date.now()}`)) } finally { unlinkSync(tmp) }
}
const killed = async (name, old, neu, probe) => t(`MUTANT KILLED: ${name}`, async () => {
  const died = await withMutant(old, neu, async M => { try { probe(M); return false } catch { return true } })
  assert.ok(died, 'the mutant survived')
})
const ok = (M, item, bag, o = {}) => M.redundantCraft(item, bag, { y: 70, ...o })
await killed('without the other-tools branch a stone axe beside an iron axe is admitted', '  if (ot) {\n    if (!toolrank) return null\n', '  if (false) {\n    if (!toolrank) return null\n',
  M => assert.ok(ok(M, 'stone_axe', [P('iron_axe', 200)])))
await killed('cover of ANY tier refuses an upgrade (stone axe beside a wooden one)', 'o.kind === ot.kind && o.rank >= ot.rank && remaining(it) > FLOOR', 'o.kind === ot.kind && remaining(it) > FLOOR',
  M => assert.equal(ok(M, 'stone_axe', [P('wooden_axe', 59)]), null))
await killed('a worn cover refuses (the FLOOR line dropped)', 'o.kind === ot.kind && o.rank >= ot.rank && remaining(it) > FLOOR', 'o.kind === ot.kind && o.rank >= ot.rank',
  M => assert.equal(ok(M, 'stone_axe', [P('iron_axe', 3)]), null))
await killed('without the pair a stone pickaxe beside iron + stone@29 is admitted', "  if (!cover) return toolrank && rank <= 2 ? pairCovers(item, rank, bag, exitNeed) : null\n", '  if (!cover) return null\n',
  M => assert.ok(ok(M, 'stone_pickaxe', [P('iron_pickaxe', 242), P('stone_pickaxe', 29)])))
await killed('a pair main under the trip line refuses (iron@39 is nearly done)', '(pickRank(it.name) ?? 0) >= 3 && remaining(it) >= PAIR_MAIN_USES', '(pickRank(it.name) ?? 0) >= 3',
  M => assert.equal(ok(M, 'stone_pickaxe', [P('iron_pickaxe', 39), P('stone_pickaxe', 29)]), null))
await killed('a lower-tier spare covers a stone craft (wooden spare refuses the upgrade)', 'return r != null && r >= rank && r <= 2 && remaining(it) > FLOOR', 'return r != null && r <= 2 && remaining(it) > FLOOR',
  M => assert.equal(ok(M, 'stone_pickaxe', [P('iron_pickaxe', 242), P('wooden_pickaxe', 30)]), null))

console.log(`\ntoolrank: ${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
