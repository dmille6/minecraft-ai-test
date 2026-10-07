// TOOL HYGIENE MUTANTS: every guard term in the change, removed or weakened one at a time, must turn a behaviour red.
// withMutant (climb-escape.test.mjs's pattern) asserts each anchor is PRESENT and UNIQUE before writing the mutant, so
// a mutation that silently failed to apply can never read as "killed". Plus the wiring checks (comment-stripped source),
// each shown to fail on a mutated source.
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { createRequire } from 'node:module'
process.env.OLLAMA_MODEL ??= 'qwen2.5:7b-instruct'
process.env.LOG_DIR = process.env.LOG_DIR || '/tmp/mcbot-test-logs-toolhygiene-mut'
process.env.BOT_NAME = process.env.BOT_NAME || 'HygieneMutBot'
delete process.env.TOOL_HYGIENE

const require_ = createRequire(import.meta.url)
const mcData = require_('minecraft-data')('1.21.8')
const { Recipe } = require_('prismarine-recipe')('1.21.8')
const { Lessons } = await import('../src/lessons.mjs')
const { SUSTAINING } = await import('../src/milestones.mjs')

const SRC = name => new URL(`../src/${name}`, import.meta.url)
async function withMutant (path, old, neu, fn) {
  const src = readFileSync(path, 'utf8')
  assert.ok(src.includes(old), `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 60))} is not in ${path.pathname}. A mutant that was never written reads as killed.`)
  assert.ok(src.split(old).length === 2, `the mutation target is not unique; the mutant is ambiguous: ${JSON.stringify(old.slice(0, 60))}`)
  const body = src.replace(old, neu).replace(/from '\.\//g, "from '../src/")
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, body)
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}

let pass = 0, fail = 0
const ta = async (name, fn) => { try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) } }
/** A mutant is KILLED when the behaviour check throws on it. The same check passes on the real module first. */
async function killed (label, path, old, neu, load, check) {
  await ta(`real module passes: ${label}`, async () => check(await load()))
  await ta(`MUTANT KILLED: ${label}`, async () => {
    await withMutant(path, old, neu, async mod => {
      let threw = false
      try { await check(mod) } catch { threw = true }
      assert.ok(threw, 'the mutant survived: the behaviour check passed without the guard')
    })
  })
}

// fixtures
const ID = { wooden_pickaxe: 1, stone_pickaxe: 2, iron_pickaxe: 3, diamond_pickaxe: 4 }
const MAXD = { wooden_pickaxe: 59, stone_pickaxe: 131, iron_pickaxe: 250, diamond_pickaxe: 1561 }
const NAME = Object.fromEntries(Object.entries(ID).map(([n, i]) => [i, n]))
const SPEED = { 1: 2, 2: 4, 3: 6, 4: 8 }
const remaining = it => it.maxDurability - it.durabilityUsed
const item = (name, left) => ({ name, type: ID[name], count: 1, maxDurability: MAXD[name], durabilityUsed: MAXD[name] - left })
const block = (name, hardness, ids, cls = 'pickaxe') => ({
  name, harvestTools: ids ? Object.fromEntries(ids.map(i => [i, true])) : undefined,
  digTime: (typeId) => typeId && SPEED[typeId] && NAME[typeId].endsWith('_' + cls) ? Math.round(1500 * hardness / SPEED[typeId]) : Math.round(1500 * hardness * (ids ? 5 : 1.5)),
})
const STONE = block('stone', 1.5, [1, 2, 3, 4]), DIRT = block('dirt', 0.5, undefined, 'shovel')
const pk = (name, left) => ({ name, count: 1, maxDurability: MAXD[name], durabilityUsed: MAXD[name] - left })
function botWith (inv, y = 70) {
  const items = inv.map((x, slot) => ({ ...x, slot, type: mcData.itemsByName[x.name]?.id }))
  const held = id => items.filter(i => i.type === Number(id)).reduce((s, i) => s + i.count, 0)
  return {
    entity: { position: { x: 0, y, z: 0 } }, health: 20, food: 20, players: {},
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
const lessons = () => { const L = new Lessons(`/tmp/mcai-toolhygiene-mut-${process.pid}-${seq++}.json`); L.data.avoid = {}; L.data.worked = {}; return L }
const MATS = [{ name: 'cobblestone', count: 3 }, { name: 'stick', count: 2 }, { name: 'crafting_table', count: 1 }]
const craft = (mod, inv, itemName, wanted = new Set(['dirt']), y = 70) => new mod.AdmissionControl(lessons()).check({ skill: 'craft', args: { item: itemName }, reason: 'x' }, botWith(inv, y), wanted)

const ADM = SRC('admission.mjs'), TH = SRC('toolhygiene.mjs'), TF = SRC('toolfor.mjs'), PR = SRC('prompt.mjs'), EX = SRC('exit-contract.mjs')
const load = p => () => import(p.href)

// ---- part 1 -------------------------------------------------------------------------------------------------------
const W30 = pk('wooden_pickaxe', 30)   // a second usable pickaxe: the escape reserve is met, so the refusal can fire
await killed('admission refuses a redundant craft (stone@52 + wooden@30, task gather dirt)', ADM,
  "      if (redundant) return { ok: false, reason: 'redundant_craft', detail: redundant.detail, redundant }\n", '\n', load(ADM),
  m => assert.equal(craft(m, [pk('stone_pickaxe', 52), W30, ...MATS], 'stone_pickaxe').reason, 'redundant_craft'))
await killed('admission passes the bot\'s y (stone@40 + wooden@10 at y=15: 48 swings < 62, the craft is admitted)', ADM,
  '{ wanted, y: bot.entity?.position?.y }', '{ wanted }', load(ADM),
  m => {
    assert.equal(craft(m, [pk('stone_pickaxe', 40), pk('wooden_pickaxe', 10), ...MATS], 'stone_pickaxe', new Set(['dirt']), 70).reason, 'redundant_craft', 'premise: refused at the surface')
    assert.equal(craft(m, [pk('stone_pickaxe', 40), pk('wooden_pickaxe', 10), ...MATS], 'stone_pickaxe', new Set(['dirt']), 15).ok, true)
  })
await killed('never refuse what the task wants', TH,
  "if (!on || typeof item !== 'string' || taskWants(wanted, item)) return null", "if (!on || typeof item !== 'string') return null", load(TH),
  m => {
    assert.ok(m.redundantCraft('stone_pickaxe', [pk('stone_pickaxe', 131), W30]), 'premise: refused without a task')
    assert.equal(m.redundantCraft('stone_pickaxe', [pk('stone_pickaxe', 131), W30], { wanted: new Set(['stone_pickaxe']) }), null)
  })
const RUNG = SUSTAINING.find(r => r?.id === 'craft_stone_pickaxe_1')
await killed('stone needs MIN_TRIP_USES: refused => the stone rung is met (25 uses is not)', TH,
  "return item === 'stone_pickaxe' ? Math.max(FLOOR + 1, MIN_TRIP_USES) : FLOOR + 1", 'return FLOOR + 1', load(TH),
  m => { const bag = [pk('stone_pickaxe', 25), W30]; if (m.redundantCraft('stone_pickaxe', bag)) assert.ok(RUNG.fulfilled(botWith(bag)), 'refused while the rung is unmet') })
await killed('a lower tier never covers a higher craft (iron stays craftable beside stone)', TH,
  'return r != null && r >= rank && remaining(it) >= need', 'return r != null && remaining(it) >= need', load(TH),
  m => assert.equal(m.redundantCraft('iron_pickaxe', [pk('stone_pickaxe', 131), W30]), null))
await killed('THE ESCAPE RESERVE: one usable pickaxe never covers a craft', TH,
  '  if (usable < ESCAPE_RESERVE) return null\n', '\n', load(TH),
  m => assert.equal(m.redundantCraft('stone_pickaxe', [pk('stone_pickaxe', 131)]), null))
await killed('the escape reserve counts only the names the escape ask names (gold is not one)', TH,
  'bag.filter(it => ESCAPE_PICK_NAMES.has(it.name) && remaining(it) > HARD_STOP)', 'bag.filter(it => pickRank(it.name) != null && remaining(it) > HARD_STOP)', load(TH),
  m => assert.equal(m.redundantCraft('stone_pickaxe', [pk('stone_pickaxe', 131), { name: 'golden_pickaxe', count: 1, maxDurability: 32, durabilityUsed: 0 }]), null))
await killed('the exit-contract exemption (y=15, 48 swings < 62)', TH,
  '  if (exitNeed != null && pickUses < exitNeed) return null\n', '\n', load(TH),
  m => {
    const bag = [pk('stone_pickaxe', 40), pk('wooden_pickaxe', 10)]
    assert.ok(m.redundantCraft('stone_pickaxe', bag, { y: 70 }), 'premise: refused at the surface')
    assert.equal(m.redundantCraft('stone_pickaxe', bag, { y: 15 }), null)
  })
await killed('a station is refused only when one is carried', TH,
  '    if (n < 1) return null\n', '    if (n < 0) return null\n', load(TH),
  m => assert.equal(m.redundantCraft('furnace', [{ name: 'crafting_table', count: 1 }]), null))
await killed('descentPickNeed keeps the deployed arithmetic (y=15 -> 62)', EX,
  '  return debt + 2 + pickReserve\n', '  return debt + pickReserve\n', load(EX),
  m => assert.equal(m.descentPickNeed(15), 62))
await killed('the prompt does not advertise a refused pickaxe', PR,
  "      if (name.endsWith('_pickaxe') && redundantCraft(name, items, { wanted, y: bot.entity?.position?.y })) continue\n", '\n', load(PR),
  m => {
    assert.match(m.craftableNow(botWith([pk('stone_pickaxe', 25), W30, ...MATS]), null), /stone_pickaxe/, 'positive control: listed when not covered')
    assert.doesNotMatch(m.craftableNow(botWith([pk('stone_pickaxe', 52), W30, ...MATS]), null), /stone_pickaxe/)
  })

// ---- part 2 -------------------------------------------------------------------------------------------------------
const on = (m, b, inv, o = {}) => m.toolFor(b, inv, { ...o, hygiene: true })
await killed('the keeper is same-or-higher tier (a worn iron beside wood stays reserved)', TF,
  'y.it !== x.it && isPickaxe(y.name) && y.tier >= x.tier && y.r > FLOOR', 'y.it !== x.it && isPickaxe(y.name) && y.r > FLOOR', load(TF),
  m => assert.equal(on(m, STONE, [item('iron_pickaxe', 5), item('wooden_pickaxe', 50), item('wooden_pickaxe', 9)]).item.name, 'wooden_pickaxe'))   // two deposit-proof others, but only a LOWER-tier keeper
await killed('the keeper is above FLOOR (three worn copies do not keep each other)', TF,
  'y.it !== x.it && isPickaxe(y.name) && y.tier >= x.tier && y.r > FLOOR', 'y.it !== x.it && isPickaxe(y.name) && y.tier >= x.tier && y.r > 1', load(TF),
  m => assert.equal(on(m, STONE, [item('stone_pickaxe', 9), item('stone_pickaxe', 8), item('stone_pickaxe', 7)]).reason, 'reserved_required'))
await killed('THE ESCAPE RESERVE: two OTHER deposit-proof pickaxes, or the worn copy stays (a two-copy bag is unchanged)', TF,
  'return depositSurvivors(items.filter(it => it !== x.it)) >= ESCAPE_RESERVE',
  'return depositSurvivors(items.filter(it => it !== x.it)) >= 1', load(TF),
  m => { const s120 = item('stone_pickaxe', 120); assert.equal(on(m, STONE, [s120, item('stone_pickaxe', 8)]).item, s120) })
await killed('a worn copy beside a keeper and two deposit-proof others is open', TF,
  ' || (hygiene && x.pk && hasKeeper(x, timed, tools))', '', load(TF),
  m => { const s5 = item('stone_pickaxe', 5); assert.equal(on(m, STONE, [item('stone_pickaxe', 120), item('stone_pickaxe', 8), s5]).item, s5) })
await killed('a deposit can bank all but one copy of a name above FLOOR: two of one name are ONE survivor (Codex round 2)', TF,
  '    if (r > FLOOR) names.add(it.name)\n', '    if (r > FLOOR) worn += (it.count ?? 1)\n', load(TF),
  m => { const s120 = item('stone_pickaxe', 120); assert.equal(on(m, STONE, [s120, item('stone_pickaxe', 60), item('stone_pickaxe', 8)]).item.name, 'stone_pickaxe'); assert.notEqual(remaining(on(m, STONE, [s120, item('stone_pickaxe', 60), item('stone_pickaxe', 8)]).item), 8) })
await killed('the most-worn copy of the chosen name digs', TF,
  'const worn = x => x.spend || (hygiene && x.pk)', 'const worn = x => x.spend', load(TF),
  m => { const s50 = item('stone_pickaxe', 50); assert.equal(on(m, STONE, [item('stone_pickaxe', 120), s50]).item, s50) })
await killed('the travel fallback takes the most-worn copy of the name', TF,
  'return (hygiene && isPickaxe(first.name) ? mostWornOfName(first, open) : first).it', 'return first.it', load(TF),
  m => { const s60 = item('stone_pickaxe', 60), s120 = item('stone_pickaxe', 120); assert.equal(m.travelTool(DIRT, [s120, s60], s120, { hygiene: true }), s60) })
await killed('the travel fallback opens a worn copy beside a keeper and two deposit-proof others', TF,
  '(hygiene && isPickaxe(x.name) && x.r > HARD_STOP && hasKeeper(x, pool, list))', 'false', load(TF),
  m => { const s5 = item('stone_pickaxe', 5), s120 = item('stone_pickaxe', 120); assert.equal(m.travelTool(DIRT, [s120, item('stone_pickaxe', 8), s5], s120, { hygiene: true }), s5) })
await killed('harvest/reflex digs tally the changed pick (the _worn_first liveness)', TF,
  "  try { noteWornFirst(block, items, d, opts, opts?.lastSwing ? 'harvest' : 'dig') } catch {}\n", '\n', load(TF),
  m => { m.takeWornFirst(); const s50 = item('stone_pickaxe', 50); m.applyToolPolicy({ heldItem: null, inventory: { items: () => [item('stone_pickaxe', 120), s50], emptySlotCount: () => 5 } }, STONE); assert.equal(m.takeWornFirst().n, 1) })
await killed('TOOL_HYGIENE=off reads as off', TF,
  "if (v === 'on' || v === 'off') return { on: v === 'on', mode: v, note: null }", "if (v === 'on' || v === 'off') return { on: true, mode: v, note: null }", load(TF),
  m => assert.equal(m.toolHygieneMode({ TOOL_HYGIENE: 'off' }).on, false))

// ---- wiring (structural: the rows exist on the executable path), each check proven to fail on a mutated source -------
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const cognitiveWired = code => {
  const c = strip(code)
  const i = c.indexOf("if (rejection?.reason === 'redundant_craft' && rejection.redundant)")
  assert.ok(i > 0, 'the refusal branch exists')
  const body = c.slice(i, i + 700)
  assert.match(body, /logEvent\(\{ kind: 'redundant_craft'[^\n]*args: row\.args/, 'the refusal writes its row with structured args')
  assert.match(body, /redundantRow\(rejection\.redundant/, 'the row is built from the refusal itself')
}
const indexWired = code => {
  const c = strip(code)
  assert.match(c, /logEvent\(\{ kind: 'tool_hygiene'/, 'the licence row')
  assert.match(c, /const w = takeWornFirst\(\)\s*\n\s*if \(w\.n > 0\) logEvent\(\{ kind: 'worn_first'/, 'the worn-first row reads the tally')
  assert.match(c, /\}, WORN_FIRST_ROW_MS\)/, 'on its timer')
}
await ta('WIRED: cognitive logs every redundant_craft refusal; index logs tool_hygiene and worn_first', async () => {
  cognitiveWired(readFileSync(SRC('cognitive.mjs'), 'utf8'))
  indexWired(readFileSync(SRC('index.mjs'), 'utf8'))
})
await ta('the wiring checks can fail: each rejects its source with the row removed', async () => {
  const cog = readFileSync(SRC('cognitive.mjs'), 'utf8'), idx = readFileSync(SRC('index.mjs'), 'utf8')
  const cogMut = "          logEvent({ kind: 'redundant_craft', status: 'no_effect', detail: row.detail, args: row.args, snapshot: snapshot(this.bot) })"
  assert.equal(cog.split(cogMut).length, 2, 'cognitive anchor present and unique')
  assert.throws(() => cognitiveWired(cog.replace(cogMut, '          // logEvent removed')))
  const idxMut = "        if (w.n > 0) logEvent({ kind: 'worn_first'"
  assert.equal(idx.split(idxMut).length, 2, 'index anchor present and unique')
  assert.throws(() => indexWired(idx.replace(idxMut, "        if (w.n > 0) void ({ kind: 'worn_first'")))
  const licMut = "      logEvent({ kind: 'tool_hygiene'"
  assert.equal(idx.split(licMut).length, 2)
  assert.throws(() => indexWired(idx.replace(licMut, "      void ({ kind: 'tool_hygiene'")))
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
