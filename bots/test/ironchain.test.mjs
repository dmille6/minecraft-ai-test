// IRONCHAIN-01 (B): THE ORE TUNNEL AIMS ONLY AT ORE GATHER MAY TAKE (oretunnel.mjs tunnelTargets, skills.mjs tunnelEligibleOf +
// tunnelToOre's `eligible`; design docs/reports/ironchain-2026-11-09.md).
//
// The defect, measured on the fleet: the town stair's wall holds an exposed iron ore (a `lining` cell of the stair's record).
// gather never takes a record cell, but the tunnel chose its target with its own filter, so from the landing it picked that
// ore every time, "arrived" with 0 breaks, and gather's rescan found nothing it may take: "every candidate is buried
// [mine said: tunnelled to iron at <the lining cell>]", up to 13 times in a row per bot.
//
// The tests: the pure rule (tunnelTargets), gather's per-cell rule (tunnelEligibleOf) cell by cell, then tunnelToOre itself on
// the REAL pathfinder over a fake world -- the stair's ore beside the bot and a buried ore 7 blocks away -- asserting which one
// the tunnel plans for, with the switch on and off. The wiring (gather hands its rule to the tunnel) is a structural source
// assertion with an anchored mutant that must turn it red.
process.env.LOG_DIR ??= '/tmp/mcbot-test-logs-ironchain'
process.env.STATE_DIR ??= '/tmp'
process.env.BOT_NAME ??= 'TestBot'
process.env.HOME_X = '500'; process.env.HOME_Y = '65'; process.env.HOME_Z = '500'   // home far from the scene: no town ground here

import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { EventEmitter } from 'node:events'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { Vec3 } = require('vec3')
const registry = require('prismarine-registry')('1.21.8')
const Block = require('prismarine-block')(registry)
const { pathfinder } = require('mineflayer-pathfinder')

const OT = await import('../src/oretunnel.mjs')
const SK = await import('../src/skills.mjs')
const { tapRecords } = await import('../src/logger.mjs')
const IC = await import('../src/ironchain.mjs')
const SKILLS_URL = new URL('../src/skills.mjs', import.meta.url)
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')

// ---- the pure rule -------------------------------------------------------------------------------------------------------
test('tunnelTargets: hazard and the home radius count as unsafe (as before); gather\'s rule counts as ineligible; the rest stay, in order', () => {
  const A = { x: 1, y: 64, z: 0 }, B = { x: 0, y: 58, z: 6 }, W = { x: 9, y: 58, z: 0 }, H = { x: 100, y: 58, z: 100 }
  const r = OT.tunnelTargets([A, B, W, H], { hazard: q => (q === W ? 100 : 0), home: { x: 100.5, z: 100.5 }, eligible: q => q !== A })
  assert.deepEqual(r.safe, [B]); assert.equal(r.unsafe, 2); assert.equal(r.ineligible, 1)
  const base = OT.tunnelTargets([A, B, W, H], { hazard: q => (q === W ? 100 : 0), home: { x: 100.5, z: 100.5 } })
  assert.deepEqual(base.safe, [A, B], 'no rule given: exactly the old filter (positive control for the rule)')
  assert.equal(base.ineligible, 0)
  assert.deepEqual(OT.tunnelTargets([], {}), { safe: [], unsafe: 0, ineligible: 0 })
})

test('the switch: IRONCHAIN_TUNNEL unset or 1 is on; 0 is the rollback', () => {
  assert.equal(IC.ironchainTunnelOn({}), true)
  assert.equal(IC.ironchainTunnelOn({ IRONCHAIN_TUNNEL: '1' }), true)
  assert.equal(IC.ironchainTunnelOn({ IRONCHAIN_TUNNEL: ' 0 ' }), false)
})

// ---- gather's per-cell rule ----------------------------------------------------------------------------------------------
test('tunnelEligibleOf: a record cell (the stair\'s lining), town ground, a keep-out column and a cave floor are refused; a plain ore is taken; a throw refuses', () => {
  const home = { x: 500, y: 65, z: 500 }
  const rule = SK.tunnelEligibleOf({ nameAt: () => 'iron_ore', home, shopCells: new Set(['1,64,0']),
    koSites: [{ kind: 'death:fire', x: 40, y: 50, z: 40, count: 4, deaths: 1, last: Date.now() }], caveSkip: q => q.x === 7 })
  assert.equal(rule({ x: 1, y: 64, z: 0 }), false, 'the stair\'s lining cell')
  assert.equal(rule({ x: 0, y: 58, z: 6 }), true, 'a plain buried ore')
  assert.equal(rule({ x: 40, y: 55, z: 40 }), false, 'in a keep-out column')
  assert.equal(rule({ x: 7, y: 58, z: 0 }), false, 'a cave floor')
  // town ground: a terrain name inside the town box. Positive control first: the box test says this cell IS ground for dirt
  const ground = SK.tunnelEligibleOf({ nameAt: () => 'dirt', home })
  assert.equal(ground({ x: 505, y: 64, z: 505 }), false, 'town ground')
  assert.equal(SK.tunnelEligibleOf({ nameAt: () => { throw new Error('boom') }, home })({ x: 0, y: 58, z: 6 }), false, 'an unreadable cell is never a target')
  assert.equal(SK.tunnelEligibleOf({})({ x: 0, y: 58, z: 6 }), true, 'nothing known: a plain cell is eligible')
})

// ---- tunnelToOre on the real pathfinder ------------------------------------------------------------------------------------
// flat stone to y=63, air above; the bot stands at -3,64,0 on the stone (the landing). The STAIR'S ORE: iron at 1,64,0 (foot
// level, exposed, 4 blocks along: the nearest ore; a bot already beside it gets an empty route, so it starts a few steps off). The REAL ORE: iron at 0,58,6, buried. The walk is refused at once (no physics here): the tunnel's own
// `_ore_tunnel` row names the target it planned for, which is the claim under test.
function scene () {
  const ov = { '1,64,0': 'iron_ore', '0,58,6': 'iron_ore' }
  const at = (x, y, z) => ov[`${x},${y},${z}`] ?? (y <= 63 ? 'stone' : 'air')
  const bot = new EventEmitter()
  Object.assign(bot, { registry, version: '1.21.8', game: { minY: -64 }, entities: {}, world: { raycast: () => null }, username: 'TestBot' })
  bot.entity = { position: new Vec3(-2.5, 64, 0.5), effects: {}, onGround: true, velocity: new Vec3(0, 0, 0), yaw: 0, pitch: 0 }
  const it = registry.itemsByName.stone_pickaxe
  const items = [{ name: 'stone_pickaxe', type: it.id, count: 1, slot: 36, maxDurability: it.maxDurability, durabilityUsed: 0 }]
  bot.inventory = { items: () => items, emptySlotCount: () => 30, slots: [] }
  bot.blockAt = p => {
    const f = p.floored ? p.floored() : new Vec3(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z))
    if (Math.abs(f.x) > 60 || Math.abs(f.z) > 60) return null
    const b = Block.fromStateId(registry.blocksByName[at(f.x, f.y, f.z)].defaultState, 0)
    b.position = new Vec3(f.x, f.y, f.z)
    return b
  }
  bot.findBlocks = ({ matching, maxDistance = 16, count = 1 }) => {
    const ids = Array.isArray(matching) ? matching : [matching]
    return Object.entries(ov).filter(([, n]) => ids.includes(registry.blocksByName[n].id)).map(([k]) => new Vec3(...k.split(',').map(Number)))
      .filter(q => q.distanceTo(bot.entity.position) <= maxDistance)
      .sort((a, b) => a.distanceTo(bot.entity.position) - b.distanceTo(bot.entity.position)).slice(0, count)
  }
  pathfinder(bot)
  bot.pathfinder.goto = async () => { throw new Error('test: no walk') }
  return bot
}
async function tunnelTarget (eligible, tunnel = SK.tunnelToOre) {
  const bot = scene(), rows = []
  const untap = tapRecords(r => { if (r?.skill?.name === '_ore_tunnel' || r?.skill?.name === '_ironchain_tunnel') rows.push(r.skill) })
  let res
  try { res = await tunnel({ bot, runner: null }, new AbortController().signal, { deadlineMs: 120_000, eligible }) } finally { untap() }
  const row = rows.find(r => r.name === '_ore_tunnel')
  const m = /to (-?\d+),(-?\d+),(-?\d+), cluster/.exec(row?.detail ?? '')
  return { res, target: m ? m.slice(1, 4).join(',') : null, rows }
}
const STAIR = new Set(['1,64,0'])
const stairRule = () => SK.tunnelEligibleOf({ nameAt: () => 'iron_ore', home: null, shopCells: STAIR })

test('POSITIVE CONTROL: with no rule the tunnel plans for the stair\'s ore beside the bot (the fleet\'s defect, reproduced)', async () => {
  const { target, res } = await tunnelTarget(null)
  assert.equal(target, '1,64,0', `planned for ${target}: ${JSON.stringify(res).slice(0, 200)}`)
})

test('THE FIX: with gather\'s rule the tunnel plans for the real ore, never the stair\'s, and writes its change row', async () => {
  assert.equal(IC.IRONCHAIN_B, true, 'the suite runs with the switch on')
  const { target, rows, res } = await tunnelTarget(stairRule())
  assert.equal(target, '0,58,6', `planned for ${target}: ${JSON.stringify(res).slice(0, 200)}`)
  assert.ok(rows.some(r => r.name === '_ironchain_tunnel' && /skipped 1 ore/.test(r.detail)), 'the change row')
})

test('THE REFUSAL CHAIN: only the stair\'s ore in range -> no_tunnel that names it and a move from here (mine down), no "liquid" claim', async () => {
  const only = SK.tunnelEligibleOf({ nameAt: () => 'iron_ore', shopCells: new Set(['1,64,0', '0,58,6']) })
  const { res } = await tunnelTarget(only)
  assert.equal(res.status, 'failed'); assert.equal(res.failClass, 'no_tunnel')
  assert.match(res.detail, /none gather may take: 2 in a town structure/)
  assert.match(res.detail, /mine down to new rock/)
  assert.doesNotMatch(res.detail, /every ore has liquid/)
  // gather's escalation reads exactly this shape: a non-success with no `need` and no pickaxe_short falls through to its own
  // "buried -- use mine" answer (its mine hint names a y the gate accepts: idlework.mjs idleDepthHint) rather than returning it
  assert.equal(res.need, undefined)
})

// ---- the wiring: gather hands its rule to the tunnel; the switch gates it ---------------------------------------------------
async function withMutant (url, old, neu, fn) {
  const src = readFileSync(url, 'utf8')
  assert.equal(src.split(old).length, 2, `ANCHOR MISSING OR NOT UNIQUE: ${JSON.stringify(old.slice(0, 90))}`)
  const out = new URL(`./_mutant-ironchain-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, src.replace(old, neu).replace(/from '\.\//g, "from '../src/"))
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}
const GATHER_CALL = 'kinds: tk.kinds, label: tk.label, eligible: tunnelEligible })'
const SWITCH = 'eligible: IRONCHAIN_B ? eligible : null'
test('WIRING (structural): gather passes its round\'s rule to the tunnel; the tunnel applies it only under the switch', () => {
  const s = strip(readFileSync(SKILLS_URL, 'utf8'))
  assert.equal(s.split(GATHER_CALL).length, 2, 'gather hands `eligible: tunnelEligible` to tunnelToOre exactly once')
  assert.match(s, /const tunnelEligible = tunnelEligibleOf\(\{ nameAt: q => bot\.blockAt\(q\)\?\.name, home: townHome\(\), shopCells, koSites: ko\?\.sites \?\? null, caveSkip: cave\.skip \}\)/)
  assert.equal(s.split(SWITCH).length, 2, 'the switch gates the rule inside tunnelToOre')
})
test('MUTANT: a tunnel that ignores the rule plans for the stair\'s ore again (the behaviour test sees it)', async () => {
  await withMutant(SKILLS_URL, SWITCH, 'eligible: null', async M => {
    const { target } = await tunnelTarget(stairRule(), M.tunnelToOre)
    assert.equal(target, '1,64,0', 'with the rule dropped inside the tunnel, the defect returns')
  })
})
test('MUTANT: the record-cell clause removed from gather\'s rule -> the stair\'s lining is eligible again', async () => {
  await withMutant(SKILLS_URL, "      if (shopCells && shopCells.has(`${q.x},${q.y},${q.z}`)) return false\n", '', async M => {
    const rule = M.tunnelEligibleOf({ nameAt: () => 'iron_ore', shopCells: STAIR })
    assert.equal(rule({ x: 1, y: 64, z: 0 }), true)
  })
})
