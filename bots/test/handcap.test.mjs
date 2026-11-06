// HANDCAP-01 (bots/src/handcap.mjs): A SHAFT CAP THE BARE HAND BREAKS IS A CLIMB, NOT A PICKAXE ASK.
//
// LIVE showcase 11-05/06: showcase-Gale 22.3 h at 64.5,58,38.5 under a stone cap 5 overhead, 540 cobblestone, one
// iron_pickaxe at 1 of 250 uses, 608 `_marooned_needs_pickaxe` rows. reflex.mjs shaftCapNeedsTool called the cap a tool
// problem because nothing could HARVEST it; the climb (pillarOut) only needs to BREAK it, and does so bare-handed. The ask's
// remedy (place a table, craft two pickaxes) was not executable there (no room for the table; inside the taiga village's
// box protectzone refuses `craft` at a table for every purpose).
//
// Proven by BEHAVIOUR: the pure rule over the registry's dig times; the switch; the CHAIN on Gale's geometry (the cap is not
// a tool problem -> maroonState says climb -> pillarOut breaks the cap bare-handed, keeps the 1-use pickaxe, gains the
// height); the positive controls (switch off, obsidian, unknown dig time keep need_pickaxe); anchored mutants.
process.env.MAROON_HANDCAP = 'on'
import assert from 'node:assert'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'

let pass = 0, fail = 0
const t = (name, fn) => Promise.resolve()
  .then(fn)
  .then(() => { pass++; console.log(`  PASS  ${name}`) })
  .catch(e => { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) })

const { pillarOut, climbNeedAbove, shaftCapNeedsTool, maroonState } = await import('../src/reflex.mjs')
const { handBreaksCap, handCapSwitch, handCapModeDetail, HANDCAP } = await import('../src/handcap.mjs')
const { tapRecords } = await import('../src/logger.mjs')
const REFLEX_PATH = new URL('../src/reflex.mjs', import.meta.url)
const HANDCAP_PATH = new URL('../src/handcap.mjs', import.meta.url)
const FEATURES_PATH = new URL('../src/features.mjs', import.meta.url)

// VERBATIM shape of climb-flood-chain.test.mjs's withMutant: a separate module, never src/ in place, the anchor present
// AND unique -- a mutant that silently fails to apply reads as killed.
async function withMutant (path, old, neu, fn) {
  const src = readFileSync(path, 'utf8')
  assert.ok(src.includes(old), `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 60))} is not in ${path.pathname}`)
  assert.ok(src.split(old).length === 2, 'the mutation target is not unique; the mutant is ambiguous')
  const body = src.replace(old, neu).replace(/from '\.\//g, "from '../src/")
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, body)
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}

// --- terrain ---------------------------------------------------------------------------------------------------

const DIG_MS = { obsidian: 250_000, cobbled_deepslate: 17_500, stone: 7500, cobblestone: 10_000, deepslate: 15_000, dirt: 750, gravel: 3000, sand: 2500 }
const BARE_HANDED = /^(dirt|sand|gravel)$/
const WATERLOGGED = { oak_stairs_wl: 'oak_stairs' }
function blk (name, pos) {
  if (name === null) return null                      // an unloaded chunk
  if (name === 'air' || !name) return { name: 'air', boundingBox: 'empty', position: pos }
  if (/^(water|lava|flowing_lava|flowing_water|bubble_column|kelp)$/.test(name)) return { name, boundingBox: 'empty', position: pos }
  if (name === 'bedrock') return { name, boundingBox: 'block', position: pos, diggable: false, digTime: () => null }
  if (WATERLOGGED[name]) {
    return { name: WATERLOGGED[name], boundingBox: 'block', isWaterlogged: true, position: pos, diggable: true,
             digTime: () => 3000, canHarvest: () => true }
  }
  return { name, boundingBox: 'block', position: pos, diggable: true,
           digTime: () => DIG_MS[name] ?? 7500,
           canHarvest: type => (BARE_HANDED.test(name) ? true : type === 101) }
}
const V = (x, y, z) => ({ x, y, z, offset: (a, b, c) => V(x + a, y + b, z + c), clone: () => V(x, y, z),
                          floored: () => V(Math.floor(x), Math.floor(y), Math.floor(z)),
                          distanceTo: o => Math.hypot(x - o.x, y - o.y, z - o.z) })
function world (cells = {}, { fill = 'stone' } = {}) {
  const m = new Map(Object.entries(cells))
  return {
    get (x, y, z) { const k = `${x},${y},${z}`; return m.has(k) ? m.get(k) : fill },
    set (x, y, z, name) { m.set(`${x},${y},${z}`, name) },
  }
}
/** `at` relative to the BLOCK TO BE BROKEN, from a world keyed on the bot's feet, for the pure predicate. */
const atCell = (w, cx, cy, cz) => (x, y, z) => blk(w.get(cx + x, cy + y, cz + z), V(cx + x, cy + y, cz + z))
const atFeet = w => (x, y, z) => blk(w.get(x, y, z), V(x, y, z))

/** The design's fixture (sandbox/fixtures/synthetic-entombed.json in shape): a 1x1 stone cell, ceiling at feet+2. */
const TOMB = (extra = {}) => world({ '0,0,0': 'air', '0,1,0': 'air', ...extra })
const WET_POCKET = { '0,3,0': 'water', '1,3,0': 'water', '0,4,0': 'water', '1,4,0': 'water',
                     '0,3,1': 'water', '1,3,1': 'water', '0,4,1': 'water', '1,4,1': 'water' }   // scene A: 2x2x2 above
const WET_ALL = {}                                                                              // scene C: 3x3x2 above
for (const x of [-1, 0, 1]) for (const z of [-1, 0, 1]) for (const y of [3, 4]) WET_ALL[`${x},${y},${z}`] = 'water'
const rows = []
tapRecords(r => { if (/^_maroon_handcap$/.test(r?.skill?.name ?? '')) rows.push(r.skill) })

const Y0 = 40
const COBBLE = n => ({ name: 'cobblestone', count: n, type: 1 })
const PICK = (left = 100) => ({ name: 'stone_pickaxe', count: 1, type: 101, maxDurability: 131, durabilityUsed: 131 - left })
const BUCKET = { name: 'bucket', count: 1, type: 900 }

/** A bot that digs, pillars (a placed block lifts it one), and walks a ramp step when the geometry allows. */
function makeBot (w, { y = Y0, inv = [], held = null, canPath = false, onDig = null, onHand = null, onLook = null,
                         digThrows = null } = {}) {
  const digs = [], placed = [], controls = []
  let yaw = 0
  const rel = p => ({ x: Math.floor(p.x), y: Math.floor(p.y) - y, z: Math.floor(p.z) })
  const bot = {
    digs, placed, controls, world: w, pendingPrereq: undefined,
    entity: { position: V(0, y, 0), get yaw () { return yaw }, onGround: true, isInWater: false },
    health: 20,
    heldItem: held,
    inventory: { items: () => inv.filter(i => i.count > 0), emptySlotCount: () => 36 - inv.length },
    blockAt (p) { const r = rel(p); return blk(w.get(r.x, r.y, r.z), V(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z))) },
    async unequip () { bot.heldItem = null; onHand?.(w, bot) },
    async equip (item) { bot.heldItem = item; onHand?.(w, bot) },
    async dig (b) {
      const r = rel(b.position)
      if (digThrows?.(`${r.x},${r.y},${r.z}`, bot)) throw new Error('Digging aborted')
      digs.push({ cell: `${r.x},${r.y},${r.z}`, name: b.name, held: bot.heldItem?.name ?? null })
      w.set(r.x, r.y, r.z, 'air')
      onDig?.(`${r.x},${r.y},${r.z}`, w)
    },
    async placeBlock (below, face) {
      const r = rel(below.position ?? below)
      const it = inv.find(i => i.name === bot.heldItem?.name && i.count > 0)
      if (!it) throw new Error('nothing to place')
      it.count--
      w.set(r.x, r.y + 1, r.z, it.name)
      placed.push(`${r.x},${r.y + 1},${r.z}`)
      const p = bot.entity.position
      bot.entity.position = V(p.x, p.y + 1, p.z)
    },
    stopDigging () {}, clearControlStates () { controls.push('clear') },
    async look (a) { yaw = a; onLook?.(w, bot) }, async lookAt () {},
    setControlState (name, on) {
      controls.push(`${name}:${on}`)
      if (name !== 'forward' || !on) return
      const bear = [{ x: 0, z: -1 }, { x: -1, z: 0 }, { x: 0, z: 1 }, { x: 1, z: 0 }][((Math.round(yaw / (Math.PI / 2)) % 4) + 4) % 4]
      const p = rel(bot.entity.position)
      const at = (dx, dy, dz) => blk(w.get(p.x + dx, p.y + dy, p.z + dz), null)
      const clear = b => b && b.boundingBox === 'empty'
      const q = bot.entity.position
      // a LEVEL step (the flood sidestep: tread below, feet and head clear) or a step UP (the ramp)
      if (at(bear.x, -1, bear.z)?.boundingBox === 'block' && clear(at(bear.x, 0, bear.z)) && clear(at(bear.x, 1, bear.z))) {
        bot.entity.position = V(q.x + bear.x, q.y, q.z + bear.z); return
      }
      if (at(bear.x, 0, bear.z)?.boundingBox !== 'block' || !clear(at(bear.x, 1, bear.z)) || !clear(at(bear.x, 2, bear.z))) return
      bot.entity.position = V(q.x + bear.x, q.y + 1, q.z + bear.z)
    },
    pathfinder: { thinkTimeout: 1000, setGoal () {}, stop () {},
                  getPathTo () { return canPath ? { path: [1, 2, 3] } : { path: [] } } },
  }
  return bot
}

const IRON1 = () => ({ name: 'iron_pickaxe', count: 1, type: 101, maxDurability: 250, durabilityUsed: 249 })
/** Gale's column: feet 0,0,0; open to dy 4; the cap at dy 5 (`cap`), stone at dy 6, then an opening at dy 7-8 with a way off. */
const GALE = (cap = 'stone', extra = {}) => world({ '0,0,0': 'air', '0,1,0': 'air', '0,2,0': 'air', '0,3,0': 'air', '0,4,0': 'air',
  '0,5,0': cap, '0,7,0': 'air', '0,8,0': 'air', '1,7,0': 'air', '1,8,0': 'air', ...extra })
const stateOf = bot => {
  const inv = bot.inventory.items()
  const blockCount = inv.filter(i => /cobblestone/.test(i.name)).reduce((n, i) => n + i.count, 0)
  return maroonState({ upIsOpen: true, haveBlocks: blockCount > 0, blockCount, entombed: false, canStartPath: false,
                       cappedNeedsTool: !!shaftCapNeedsTool(bot), y: bot.entity.position.y,
                       climbNeed: climbNeedAbove((x, y, z) => bot.blockAt(V(x, y, z)), bot.entity.position) })
}

await t('THE RULE: a known bare-hand break under MAX_DIG_MS breaks the cap; obsidian, unknown and off do not', () => {
  for (const ms of [750, 7500, 10_000, 15_000, 17_500, 30_000]) assert.strictEqual(handBreaksCap(ms, { on: true }), true, String(ms))
  for (const ms of [30_001, 250_000]) assert.strictEqual(handBreaksCap(ms, { on: true }), false, String(ms))
  for (const ms of [null, undefined, NaN, 0, -1, Infinity]) assert.strictEqual(handBreaksCap(ms, { on: true }), false, `unknown ${ms}`)
  assert.strictEqual(handBreaksCap(7500, { on: false }), false, 'the rollback still turned a cap into a climb')
})

await t('THE SWITCH: on in the showcase pool by default, off elsewhere; MAROON_HANDCAP=off/on overrides', () => {
  assert.strictEqual(handCapSwitch({}, 'showcase').on, true)
  assert.strictEqual(handCapSwitch({}, 'board-a').on, true, 'fleet variant: every pool by default')
  assert.strictEqual(handCapSwitch({ MAROON_HANDCAP_POOLS: 'showcase' }, 'board-a').on, false, 'a named list narrows it')
  assert.strictEqual(handCapSwitch({ MAROON_HANDCAP: 'off' }, 'showcase').on, false)
  assert.strictEqual(handCapSwitch({ MAROON_HANDCAP: '0' }, 'showcase').on, false)
  assert.strictEqual(handCapSwitch({ MAROON_HANDCAP: 'on' }, 'board-a').on, true)
  assert.strictEqual(handCapSwitch({ MAROON_HANDCAP_POOLS: 'board-a,showcase' }, 'board-a').on, true)
  assert.strictEqual(HANDCAP.on, true, 'this file forces it on')
  assert.match(handCapModeDetail({ on: true, why: 'x' }), /^on=1 why=x /)
})

await t('THE CHAIN ON GALE\'S SHAFT: not a tool problem -> climb -> the cap broken bare-handed, the 1-use pickaxe kept, out', async () => {
  rows.length = 0
  const inv = [IRON1(), COBBLE(540)]
  const bot = makeBot(GALE(), { inv })
  assert.strictEqual(shaftCapNeedsTool(bot), null, 'a stone cap the hand breaks in 7.5 s was still a tool problem')
  assert.strictEqual(stateOf(bot), 'climb')
  assert.strictEqual(rows.length >= 1, true, 'no _maroon_handcap row')
  assert.match(rows[0].detail, /cap stone at 0,45,0 \(5 overhead\) breaks bare-handed in ~7500ms .*pickaxes=iron_pickaxe:1/)
  const y0 = bot.entity.position.y
  const out = await pillarOut(bot, climbNeedAbove((x, y, z) => bot.blockAt(V(x, y, z)), bot.entity.position))
  assert.ok(!['needs_blocks', 'needs_pickaxe', 'exhausted'].includes(out), `the climb refused: ${out}`)
  const capDig = bot.digs.find(d => d.cell === '0,5,0')
  assert.ok(capDig, `the cap was never dug: ${JSON.stringify(bot.digs)}`)
  assert.notStrictEqual(capDig.held, 'iron_pickaxe', 'the climb spent the last use of the pickaxe')
  assert.ok(bot.entity.position.y >= y0 + 7, `no way up: y ${bot.entity.position.y - y0} above the floor`)
  assert.strictEqual(inv[0].durabilityUsed, 249)
})

await t('POSITIVE CONTROLS: off, an obsidian cap and an unknown dig time keep need_pickaxe (the old ask)', async () => {
  const bot = makeBot(GALE('obsidian'), { inv: [IRON1(), COBBLE(540)] })
  assert.ok(shaftCapNeedsTool(bot), 'obsidian (250 s bare) is a tool problem')
  assert.strictEqual(stateOf(bot), 'need_pickaxe')
  const unk = makeBot(GALE(), { inv: [IRON1(), COBBLE(540)] })
  const real = unk.blockAt
  unk.blockAt = p => { const b = real(p); if (b && b.name === 'stone') delete b.digTime; return b }
  assert.ok(shaftCapNeedsTool(unk), 'an unpriced cap became a climb')
  await withMutant(REFLEX_PATH, "import { handBreaksCap } from './handcap.mjs'",
    "const handBreaksCap = (ms) => _hb(ms, { on: false }); import { handBreaksCap as _hb } from './handcap.mjs'", async mod => {
      const b = makeBot(GALE(), { inv: [IRON1(), COBBLE(540)] })
      assert.ok(mod.shaftCapNeedsTool(b), 'MAROON_HANDCAP off: the stone cap must stay a tool problem (the base behaviour)')
    })
})

await t('MUTANT: the reflex hook removed -> Gale is need_pickaxe again (the hook is what changes the state)', async () => {
  await withMutant(REFLEX_PATH, '  if (handBreaksCap(bareMs)) {', '  if (false) {', async mod => {
    const b = makeBot(GALE(), { inv: [IRON1(), COBBLE(540)] })
    assert.ok(mod.shaftCapNeedsTool(b), 'the mutant did not restore the tool problem')
  })
})

await t('MUTANT: the refusal rule dropped -> obsidian would be a climb (the test above would catch it)', async () => {
  await withMutant(HANDCAP_PATH, '  return !planDigSplit({ hardnessMs: p }).refuse', '  return true', async mod => {
    assert.strictEqual(mod.handBreaksCap(250_000, { on: true }), true, 'mutant not live')
  })
  assert.strictEqual(handBreaksCap(250_000, { on: true }), false)
})

await t('MUTANT: unknown treated as breakable -> an unpriced cap would become a climb', async () => {
  await withMutant(HANDCAP_PATH, '  if (bareMs == null || !Number.isFinite(p) || p <= 0) return false', '', async mod => {
    assert.notStrictEqual(mod.handBreaksCap(null, { on: true }), false, 'mutant not live')
  })
})

await t('WIRING: the licence row is installed at spawn (features.mjs), comments stripped', () => {
  const src = readFileSync(FEATURES_PATH, 'utf8').replace(/\/\/[^\n]*/g, '')
  assert.match(src, /logEvent\(\{ kind: 'handcap_mode', status: 'success', snapshot: snapshot\(bot\), detail: handCapModeDetail\(\) \}\)/)
  const r = readFileSync(REFLEX_PATH, 'utf8').replace(/^\s*\/\/[^\n]*$/gm, '')
  assert.match(r, /const bareMs = predictedDigMs\(cap\.block, null\)\n\s*if \(handBreaksCap\(bareMs\)\) \{/)
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
