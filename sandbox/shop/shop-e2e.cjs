// SANDBOX-ONLY end-to-end proof of shop-01 (the building tier's workshop: docs/reports/building-tier-2026-10-23.md sections 4-5;
// branch shop-on-7049da1). mats-e2e.cjs's harness: ONE FRESH BOT from <botRoot> (unmodified; trace.cjs only observes packets),
// the scene set by RCON, the SERVER's truth before and after. Nothing is queued to the model (every model decision is `status`
// or a short walk): the town plan, the siting and every placement must be the bot's OWN.
//
//   node shop-e2e.cjs <botRoot> <scene,...> [server]      (CRAFT_REPO=<this checkout, with sandbox/run-bot.sh>)
//
// THE BUILD decides the expectation: a <botRoot> whose bots/src/shop.mjs exists is the CANDIDATE (CANDIDATE_PASS / FAIL); any
// other is the BASE, run as the POSITIVE CONTROL of the instrument (BASE_SHAPE when nothing is built and the stock is as it was).
//
// scenes:
//   shop     SHOP-E2E: bare flat ground ±56 around home, two town chests holding the workshop's stock (89+ stone bricks, planks,
//            glass panes, cut copper, torches, 2 furnaces, a table -- every part at mats-01's buffer, so the materials job makes
//            nothing), NO plan and NO record. The bot plans the town (townplan-01), sites the workshop (buildsite.mjs on the live
//            world), draws the bill and builds it. PASS: a `_structure_complete` row; EVERY record cell reads, by RCON, as its
//            role's block (the server's word, cell by cell); the town and the bag together lost exactly the bill; nothing judged
//            on the ground; EVERY block_place the bot wrote carried a sequence and was ACKNOWLEDGED (acknowledge_player_digging
//            >= it) within 5 s (design 4.1: Paper must show the server acknowledges every use-item-on by sequence).
//   chain    CHAIN-1 (design 7): as shop but the town holds only 80 stone bricks (9 short of the bill), 320 cobblestone + 576 oak
//            logs above the reserve and one clean town furnace; MATS_COOLDOWN_MS=30000. PASS as shop, and the materials job MADE
//            stone bricks (verdict=ok rows) that the workshop used: the town + bag bricks changed by exactly made - 89, made >= 9.
//   coop2    SHOP-COOP2: TWO builders (sandbox-Shop, sandbox-Shop2) on one town, the stock doubled. PASS as shop (the stock: the
//            town + both bags lost exactly ONE bill) and: every record cell has exactly one `_build op=place` row across both
//            logs; both builders placed; the barrier was taken (closer clicks); no two holders live on one lease (the pool's
//            lease files, the generation rule).
//   tree     SHOP-CLEAR: as shop on a GRASS floor with a GRID of 5-log oaks (persistent leaves) over the arena, 6 apart in x and 8
//            in z so every workshop site fells at least one, 32 oak saplings in town. PASS as shop and: the record clears a tree; every replant row precedes the first tree clear
//            row; every replant cell holds a sapling at the end (RCON); every clear row names a cell of the record's clear list.
//   kill     SHOP-KILL: as shop; the builder is SIGKILLed after its 40th `_build op=place` row, then restarted on the same state.
//            PASS as shop and: no record cell has two place rows; no intent is left open at the end (the killed connection's
//            leftovers are closed by the next visit).
//   terrain-a, terrain-c
//            SHOP-TERRAIN: as shop on a FLEET WORLD'S OWN GROUND -- board-a's and hive-c's home +-50 (y home-16 .. +32), dumped
//            read-only from copied region files (terrain/dump-world.sh) and rebuilt in the arena by terrain/fixture.py with the
//            world's home at (760, 120, 760); the town's furniture, lava and face-hung blocks are not copied (fixture.py says
//            why). The stand and the two chests get a stone foot and air above. PASS as shop (the stock: the names the cells
//            HOLD, the wood family when the record fells a tree), and the record's ground work (fill / earthwork / clear) is shown.
//   On the BASE (every scene): no `_build*` row, no record file, the stock unchanged (chain: the names the materials job does
//   not touch): the base builds nothing.
//
// FOUND=off and SMELT_JOB=0 on BOTH arms: found-01's stations would be crafted from the bill's own planks and cobble in the bag,
// and the town smelt job's drain is not this scene's subject (their composition with the workshop is the unit tests' and the
// canary's). RCON only through `ssh mike@10.0.0.30 python3 /tmp/sbx-rcon.py <sandboxN> -`. sandbox5..8 only.
// Refuses to run unless a sandbox lock covering SERVER has `shop` as its owner's first word (sandbox/lib/sbxlock.cjs).
'use strict'
const { execFileSync, spawn } = require('child_process')
const http = require('http')
const sbx = require('../lib/sbxlock.cjs')
const fs = require('fs'); const path = require('path')
const [BOT_ROOT, SCENES_S, SERVER = 'sandbox5'] = process.argv.slice(2)
if (!BOT_ROOT || !SCENES_S) throw new Error('usage: node shop-e2e.cjs <botRoot> <scenes> [server]')
const PORTS = Object.fromEntries(Object.entries(sbx.PORTS).filter(([n]) => /^sandbox[5-8]$/.test(n)))
if (!PORTS[SERVER]) throw new Error(`sandbox servers only (${Object.keys(PORTS).join(', ')})`)
const R = process.env.CRAFT_REPO || path.resolve(__dirname, '../..')
const TRACE = path.join(R, 'sandbox/shop/trace.cjs')
const NAME = process.env.SH_BOT_NAME || 'sandbox-Shop'
if (!NAME.startsWith('sandbox-')) throw new Error('sandbox bot names only')
const OUTDIR = `${R}/sandbox/log/shop-e2e`
const RES = `${OUTDIR}/results.jsonl`
const BRAIN_PORT = Number(process.env.SH_BRAIN_PORT || (11690 + Number(String(SERVER).replace('sandbox', ''))))
const sleep = ms => new Promise(r => setTimeout(r, ms))
const ENV_REL = `sandbox/.env.shop-${SERVER}-${process.pid}`
const CANDIDATE = fs.existsSync(path.join(BOT_ROOT, 'bots/src/shop.mjs'))

const SSH = ['-o', 'ControlMaster=auto', '-o', `ControlPath=${process.env.HOME}/.ssh/cm-shop-%C`, '-o', 'ControlPersist=600', 'mike@10.0.0.30']
function rcon (...cmds) {
  const out = execFileSync('ssh', [...SSH, `python3 /tmp/sbx-rcon.py ${SERVER} -`], { input: cmds.join('\n') + '\n', encoding: 'utf8', timeout: 120000 })
  const res = []; let cur = null
  for (const line of out.split('\n')) { if (line.startsWith('> ')) { cur = { cmd: line.slice(2), reply: '' }; res.push(cur) } else if (cur) cur.reply += (cur.reply ? '\n' : '') + line }
  return res
}
const rconMany = (cmds, per = 40) => { const out = []; for (let i = 0; i < cmds.length; i += per) out.push(...rcon(...cmds.slice(i, i + per))); return out }

// ---------------------------------------------------------------- arena and scene
const HOME = { x: 760, y: 120, z: 760 }
const A0 = 704, A1 = 816, FLOOR = 119, TOP = 140
const CHEST_A = { x: 763, y: 120, z: 757 }
const CHEST_B = { x: 762, y: 120, z: 760 }
const STAND = { x: 760.5, y: 120, z: 760.5 }
const at = c => `${c.x} ${c.y} ${c.z}`
const stacks = (id, n) => { const o = []; while (n > 0) { o.push([id, Math.min(64, n)]); n -= 64 } return o }
const BAG = [['iron_pickaxe', 1], ['iron_axe', 1], ['iron_shovel', 1], ['bread', 5]]
const PARTS_B = [...stacks('glass_pane', 32), ...stacks('cut_copper', 32), ...stacks('torch', 64), ['furnace', 2], ['crafting_table', 1]]
const FURNACE_AT = { x: 760, y: 120, z: 763 }
const NAME2 = 'sandbox-Shop2'
const SPEC = {
  shop: {
    chestA: [...stacks('stone_bricks', 128), ...stacks('oak_planks', 128), ...stacks('cobblestone', 320)],
    chestB: PARTS_B,
  },
  chain: {
    chestA: [...stacks('stone_bricks', 80), ...stacks('oak_planks', 128), ...stacks('cobblestone', 320), ...stacks('oak_log', 576)],
    chestB: PARTS_B, furnace: true, env: { MATS_COOLDOWN_MS: 30000 }, windowMs: 75 * 60000, bricksMade: true,
  },
  coop2: {
    chestA: [...stacks('stone_bricks', 192), ...stacks('oak_planks', 192), ...stacks('cobblestone', 320)],
    chestB: [...stacks('glass_pane', 32), ...stacks('cut_copper', 64), ...stacks('torch', 64), ['furnace', 4], ['crafting_table', 2]],
    bots: 2, env: { SHOP_COOLDOWN_MS: 10000 },   // coop2 r1: at 60 s the first builder (deps_open at 15 s) never came back inside the second's 87 s build
  },
  tree: {
    chestA: [...stacks('stone_bricks', 128), ...stacks('oak_planks', 128), ...stacks('cobblestone', 320)],
    chestB: [...PARTS_B, ['oak_sapling', 32]], floor: 'grass_block',
    // a TRUNK GRID, 6 apart in x and 8 in z (a 7 x 9 pad always meets one), clear of home's square (the chests, the stand): the
    // tree scene's first run (a single tree) was simply sited around -- the planner prefers a site with no felling
    trees: (() => { const t = []; for (let x = A0 + 8; x <= A1 - 8; x += 6) for (let z = A0 + 8; z <= A1 - 8; z += 8) if (Math.max(Math.abs(x - HOME.x), Math.abs(z - HOME.z)) > 10) t.push([x, z]); return t })(),
  },
  kill: {
    chestA: [...stacks('stone_bricks', 128), ...stacks('oak_planks', 128), ...stacks('cobblestone', 320)],
    chestB: PARTS_B, killAfter: 40,
  },
  'terrain-a': {
    chestA: [...stacks('stone_bricks', 128), ...stacks('oak_planks', 128), ...stacks('cobblestone', 576)],
    chestB: PARTS_B, terrain: 'board-a',
  },
  'terrain-c': {
    chestA: [...stacks('stone_bricks', 128), ...stacks('oak_planks', 128), ...stacks('cobblestone', 576)],
    chestB: PARTS_B, terrain: 'hive-c',
  },
}
const TERRAIN_TOP = 152, TERRAIN_BED = 104
/** The fixture's commands (terrain/<world>.cmds.json, built by terrain/fixture.py from a read-only dump). */
const terrainCmds = world => {
  const f = path.join(__dirname, 'terrain', `${world}.cmds.json`)
  const raw = fs.existsSync(`${f}.gz`) ? require('zlib').gunzipSync(fs.readFileSync(`${f}.gz`)) : fs.readFileSync(f)
  return JSON.parse(raw.toString('utf8')).cmds
}
// the bill of workshop@1 on flat ground (no fill): the names the town + bag must lose exactly
const BILL = { stone_bricks: 89, oak_planks: 49, glass_pane: 4, cut_copper: 20, torch: 2, furnace: 2, crafting_table: 1 }
const ROLE_BLOCK = { base: 'stone_bricks', step: 'stone_bricks', wall: 'oak_planks', window: 'glass_pane', trim: 'cut_copper', roof: 'oak_planks', furnace: 'furnace', table: 'crafting_table', light: 'torch', fill: 'cobblestone' }
// THE SERVER'S OWN NAMES for a role's block (r2, Paper r2: a torch clicked onto a side face IS a wall_torch -- the instrument
// asked for `torch` and scored two correct cells wrong); cut copper may weather or be waxed. AND THE BLUEPRINT'S FALLBACKS (coop2
// r1: window -> $wall, trim -> $planks are the palette's own second choices, which billOf takes when the first is not in the town;
// the instrument asked for the first only and scored 24 legal plank cells wrong). The palette is the candidate's own blueprint.
const COPPER = ['cut_copper', 'exposed_cut_copper', 'weathered_cut_copper', 'oxidized_cut_copper', 'waxed_cut_copper', 'waxed_exposed_cut_copper', 'waxed_weathered_cut_copper', 'waxed_oxidized_cut_copper']
const PLANKS = ['oak', 'spruce', 'birch', 'jungle', 'acacia', 'dark_oak', 'mangrove', 'cherry', 'pale_oak', 'bamboo', 'crimson', 'warped'].map(w => `${w}_planks`)
const PALETTE = (() => { try { return JSON.parse(fs.readFileSync(path.join(BOT_ROOT, 'bots/src/blueprints/workshop@1.json'), 'utf8')).palette } catch { return null } })()
/** A role's server names in palette order ('$planks' any planks, '$role' that role's, once each); 'fill' is cobblestone. */
function ROLE_OK (role, seen = new Set([role])) {
  if (role === 'fill' || !PALETTE?.[role]) return role === 'light' ? ['torch', 'wall_torch'] : role === 'trim' ? COPPER : [ROLE_BLOCK[role]]
  const out = []
  for (const ch of PALETTE[role]) {
    if (ch === '$planks') out.push(...PLANKS)
    else if (ch.startsWith('$')) { const r = ch.slice(1); if (!seen.has(r)) { seen.add(r); out.push(...ROLE_OK(r, seen)) } } else if (ch === 'torch') out.push('torch', 'wall_torch')
    else if (ch === 'cut_copper') out.push(...COPPER)
    else out.push(ch)
  }
  return [...new Set(out)]
}
/** The stock name a standing block was drawn as (a wall torch is a torch; weathered or waxed copper is cut copper). */
const stockName = n => (n === 'wall_torch' ? 'torch' : COPPER.includes(n) ? 'cut_copper' : n)
const WINDOW_MS = Number(process.env.SH_WINDOW_MS || 40 * 60000)
const BASE_WINDOW_MS = Number(process.env.SH_BASE_WINDOW_MS || 12 * 60000)

function arenaCmds (floor = 'stone') {
  const c = [`forceload add ${A0} ${A0} ${A1} ${A1}`, `kill @e[type=!player,x=${HOME.x},y=${HOME.y},z=${HOME.z},distance=..80]`]
  // a terrain scene's ground runs y 104..152: solid under the floor, air to 152 above it (2 layers a fill: the 32768 limit)
  for (let y = TERRAIN_BED; y < FLOOR - 1; y += 2) c.push(`fill ${A0} ${y} ${A0} ${A1} ${Math.min(y + 1, FLOOR - 2)} ${A1} minecraft:stone`)
  c.push(`fill ${A0} ${FLOOR} ${A0} ${A1} ${FLOOR} ${A1} minecraft:${floor}`)
  for (let y = FLOOR + 1; y <= TERRAIN_TOP; y += 2) c.push(`fill ${A0} ${y} ${A0} ${A1} ${Math.min(y + 1, TERRAIN_TOP)} ${A1} minecraft:air`)
  // the fills pop an earlier build's attached blocks (a wall torch) as ITEMS: killed again after them (cand-9 after a SHOP_KEEP
  // run picked up a popped torch: town + bag -1 against a bill of -2, and banked it back)
  c.push(`kill @e[type=item,x=${HOME.x},y=${HOME.y},z=${HOME.z},distance=..80]`)
  c.push(`fill ${A0} ${FLOOR - 1} ${A0} ${A1} ${FLOOR - 1} ${A1} minecraft:stone`)
  return c
}
function bagCmds (nm = NAME) {
  const c = [`clear ${nm}`, `tp ${nm} ${STAND.x} ${STAND.y} ${STAND.z}`]
  BAG.forEach(([id, n], s) => c.push(`item replace entity ${nm} container.${s} with minecraft:${id} ${n}`))
  return c
}
/** A 5-log oak with persistent leaves (they never decay during a scene) on the arena floor at (x, z). */
const treeCmds = ([x, z]) => {
  const c = []
  for (let y = 123; y <= 125; y++) c.push(`fill ${x - 2} ${y} ${z - 2} ${x + 2} ${y} ${z + 2} minecraft:oak_leaves[persistent=true]`)
  c.push(`fill ${x} ${FLOOR + 1} ${z} ${x} ${FLOOR + 5} ${z} minecraft:oak_log`)
  return c
}
const sceneCmds = spec => [
  ...(spec.terrain ? terrainCmds(spec.terrain) : []),
  // on terrain: the stand and the chests on a stone foot with two air above (a chest lid needs air; a head in stone suffocates)
  ...(spec.terrain ? [STAND, CHEST_A, CHEST_B].flatMap(p => [`setblock ${Math.floor(p.x)} ${p.y - 1} ${Math.floor(p.z)} minecraft:stone`, `fill ${Math.floor(p.x)} ${p.y} ${Math.floor(p.z)} ${Math.floor(p.x)} ${p.y + 1} ${Math.floor(p.z)} minecraft:air`]) : []),
  ...(spec.terrain ? [`kill @e[type=item,x=${HOME.x},y=${HOME.y},z=${HOME.z},distance=..80]`] : []),
  ...(spec.furnace ? [`setblock ${at(FURNACE_AT)} minecraft:furnace[facing=north]`] : []),
  ...(spec.trees || []).flatMap(treeCmds),
  `setblock ${at(CHEST_A)} minecraft:chest[facing=west]`,
  `setblock ${at(CHEST_B)} minecraft:chest[facing=west]`,
  ...spec.chestA.map(([id, n], s) => `item replace block ${at(CHEST_A)} container.${s} with minecraft:${id} ${n}`),
  ...spec.chestB.map(([id, n], s) => `item replace block ${at(CHEST_B)} container.${s} with minecraft:${id} ${n}`),
]

// ---------------------------------------------------------------- oracle (the server's slots and cells, never the bot's claim)
const parseItem = seg => { const id = (seg.match(/id: "minecraft:([a-z0-9_]+)"/) || [])[1]; return id ? { id, count: +((seg.match(/count: (\d+)/) || [])[1] || 1) } : null }
function snapshot (names = [NAME]) {
  const cmds = []
  for (const nm of names) for (let s = 0; s < 36; s++) cmds.push(`data get entity ${nm} Inventory[{Slot:${s}b}]`)
  for (let s = 0; s < 27; s++) cmds.push(`data get block ${at(CHEST_A)} Items[{Slot:${s}b}]`)
  for (let s = 0; s < 27; s++) cmds.push(`data get block ${at(CHEST_B)} Items[{Slot:${s}b}]`)
  const iGround = cmds.length
  cmds.push(`execute as @e[type=item,x=${HOME.x},y=${HOME.y},z=${HOME.z},distance=..80] run data get entity @s Item`)
  const r = rconMany(cmds)
  const SLOT_OK = /has the following (entity|block) data|Found no elements matching/
  for (let i = 0; i < iGround; i++) if (!SLOT_OK.test(r[i]?.reply || '')) throw new Error(`oracle read failed: ${r[i]?.cmd} => ${JSON.stringify(r[i]?.reply ?? null)}`)
  const pick = (q, re) => (re.test(q?.reply || '') ? parseItem(q.reply) : null)
  const tot = list => { const t = {}; for (const it of list) if (it) t[it.id] = (t[it.id] || 0) + it.count; return t }
  const nb = 36 * names.length
  const bag = tot(r.slice(0, nb).map(q => pick(q, /has the following entity data/)))
  const a = tot(r.slice(nb, nb + 27).map(q => pick(q, /has the following block data/)))
  const b = tot(r.slice(nb + 27, nb + 54).map(q => pick(q, /has the following block data/)))
  const ground = tot((r[iGround]?.reply || '').split(/has the following entity data:/).slice(1).map(parseItem))
  return { bag, a, b, ground }
}
const sum = (...os) => { const t = {}; for (const o of os) for (const [k, v] of Object.entries(o)) t[k] = (t[k] || 0) + v; return t }
const diff = (a, b) => Object.keys({ ...a, ...b }).map(n => [n, (b[n] || 0) - (a[n] || 0)]).filter(([, d]) => d).map(([n, d]) => `${n}${d > 0 ? '+' : ''}${d}`).join(' ')
const AMBIENT = /^(stick|apple|[a-z_]+_sapling|[a-z_]+_leaves|leaf_litter)$/

/** The record's head in the bot's pool state (the chain's last generation that links: prev = the previous). */
function recordOf (poolDir) {
  let names = []
  try { names = fs.readdirSync(poolDir) } catch { return null }
  const gens = names.map(n => /^project-760_120_760\.shop\.g(\d+)\.json$/.exec(n)).filter(Boolean).map(m => Number(m[1])).sort((x, y) => x - y)
  let head = null
  for (const g of gens) { try { const r = JSON.parse(fs.readFileSync(path.join(poolDir, `project-760_120_760.shop.g${g}.json`), 'utf8')); if (!head ? r.prev === null : r.prev === head.gen) head = r } catch { /* skipped */ } }
  return head
}
/** Every record cell by RCON -> { ok, bad: [cell: want], standing: {stock name: n}, fallback: n }. `standing` is what the cells
 *  HOLD (the names the town + bags must have lost); `fallback` counts cells holding a later palette choice than the first. */
function cellsCheck (rec, placedCells = null) {
  const asks = rec.cells.flatMap((c, i) => ROLE_OK(c.role).map(n => ({ i, n, cmd: `execute if block ${c.at[0]} ${c.at[1]} ${c.at[2]} minecraft:${n}` })))
  const r = rconMany(asks.map(a => a.cmd))
  const held = new Map()
  asks.forEach((a, j) => { if (/Test passed/.test(r[j]?.reply || '') && !held.has(a.i)) held.set(a.i, a.n) })
  const bad = [], standing = {}, kept = {}
  let fallback = 0
  // THE TOWN'S OWN LITTER KEPT AS A CELL (r15: a clear-list block at a record cell that already reads its role's block is the
  // cell, never dug): no place row and in the record's clear list -- it stands, but the stock never paid it (terrain-a r16:
  // board-a's oak_planks litter at a wall cell read as one plank short)
  const litter = new Set((rec.clear ?? []).map(c => c.at.join(',')))
  rec.cells.forEach((c, i) => {
    if (!held.has(i)) { bad.push(`${c.at.join(',')}:${ROLE_BLOCK[c.role]}`); return }
    const n = stockName(held.get(i))
    if (placedCells && litter.has(c.at.join(',')) && !placedCells.has(c.at.join(','))) { kept[n] = (kept[n] || 0) + 1; return }
    standing[n] = (standing[n] || 0) + 1
    if (stockName(ROLE_OK(c.role)[0]) !== n) fallback++
  })
  return { ok: bad.length === 0, bad, n: rec.cells.length, standing, kept, fallback }
}
/** Every BUILDER click (a block_place carrying a sequence > 0: the builder's own) was acknowledged (an ack >= it) within 5 s.
 *  A sequence-0 block_place is mineflayer's own activateBlock (a chest open for the withdraw, Paper r2: 4 of them, held item a
 *  pickaxe) -- counted and shown as `foreign`, not judged (the builder never writes sequence 0). */
function acksCheck (trace, { deadFrom = null, deadTo = null } = {}) {
  const ev = lines(trace).map(l => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
  const all = ev.filter(e => e.pkt === 'block_place'), acks = ev.filter(e => e.pkt === 'ack')
  const places = all.filter(p => Number.isInteger(p.seq) && p.seq > 0)
  const unacked0 = places.filter(p => !acks.some(a => a.ts >= p.ts && a.ts - p.ts <= 5000 && a.seq >= p.seq))
  // an UNANSWERED click sent in the last 5 s of a SIGKILLed connection could never be answered to it (kill r13: seq 41, sent as
  // the kill landed): counted as `dead`, not judged; its cell is judged by RCON and the place-once rule. Answered ones count.
  const dead = unacked0.filter(p => deadFrom != null && p.ts >= deadFrom && p.ts <= deadTo)
  const unacked = unacked0.filter(p => !dead.includes(p))
  return { places: places.length, foreign: all.length - places.length, dead: dead.length, acks: acks.length, unacked: unacked.length, first: unacked.slice(0, 3).map(p => `seq=${p.seq}@${JSON.stringify(p.loc)}`) }
}

/** Two holders live on one lease (buildproj.mjs rule: another holder may take only after a release or until + 60 s) -> [why]. */
function leaseOverlaps (poolDir) {
  let names = []
  try { names = fs.readdirSync(poolDir) } catch { return ['pool dir unreadable'] }
  const by = {}
  for (const n of names) {
    const m = /^project-760_120_760\.shop\.(slot\d+|seg-[A-Za-z0-9-]+)\.lease\.g(\d+)\.json$/.exec(n)
    if (!m) continue
    let rec = null; try { rec = JSON.parse(fs.readFileSync(path.join(poolDir, n), 'utf8')) } catch {}
    let rel = null; try { rel = Number(fs.readFileSync(path.join(poolDir, n + '.released'), 'utf8')) || null } catch {}
    ;(by[m[1]] ??= []).push({ g: Number(m[2]), rec, rel })
  }
  const bad = []
  for (const [nm, gens] of Object.entries(by)) {
    if (/^slot(\d+)$/.test(nm) && Number(nm.slice(4)) > 2) bad.push(`${nm} beyond builders_max`)
    gens.sort((x, y) => x.g - y.g)
    for (let i = 1; i < gens.length; i++) {
      const p = gens[i - 1], q = gens[i]
      if (!p.rec || !q.rec || p.rec.holder === q.rec.holder) continue
      const until = p.rel ?? (Number(p.rec.until) + 60000)
      if (Number(q.rec.at) < until) bad.push(`${nm} g${q.g} ${q.rec.holder} at ${q.rec.at} < ${until} (${p.rec.holder})`)
    }
  }
  return bad
}
/** Every holder's OPEN intents in the pool (buildproj.mjs openIntents) -> n. */
function openIntentCount (poolDir) {
  let n = 0
  for (const f of (() => { try { return fs.readdirSync(poolDir) } catch { return [] } })().filter(x => /^project-760_120_760\.shop\.intents\..+\.jsonl$/.test(x))) {
    const open = new Set()
    for (const l of lines(path.join(poolDir, f))) { let r; try { r = JSON.parse(l) } catch { continue } if (r.op === 'open') open.add(r.id); else if (r.op === 'settled' || r.op === 'cancelled') open.delete(r.id) }
    n += open.size
  }
  return n
}
const lines = f => { try { return fs.readFileSync(f, 'utf8').split('\n').filter(Boolean) } catch { return [] } }
const jl = f => lines(f).map(l => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
const WANT = /^(_build|_build_seg|_build_visit|_build_bag|_build_mode|_structure_complete|_shop_skip|_townplan|_townplan_mode|_death|build_shop|_mats_skip|_make_material)$/
const skillRows = f => jl(f).filter(r => r.skill && WANT.test(r.skill.name)).map(r => ({ ts: Date.parse(r['@timestamp']), name: r.skill.name, status: r.skill.status, detail: String(r.skill.detail || '').slice(0, 400), bot: r.bot?.name }))
const kv1 = (d, k) => (new RegExp(`(?:^| )${k}=(\\S+)`).exec(d || '') || [])[1]
async function waitFor (pred, ms, step = 1000) { for (const t0 = Date.now(); Date.now() - t0 < ms;) { const v = pred(); if (v) return v; await sleep(step) } return null }

let brainN = 0
const WANDER = [{ x: 756, y: 120, z: 756 }, { x: 764, y: 120, z: 756 }]
const brain = http.createServer((req, res) => {
  let body = ''; req.on('data', c => { body += c })
  req.on('end', () => {
    if (req.url.startsWith('/api/version')) { res.end(JSON.stringify({ version: '0.0.0-sandbox' })); return }
    if (!req.url.startsWith('/api/chat')) { res.statusCode = 404; res.end('q brain'); return }
    let msgs = []; try { msgs = JSON.parse(body).messages || [] } catch {}
    const sentinel = (msgs.map(m => String(m.content || '')).join('\n').match(/END-[A-Z0-9]{4,12}/g) || []).pop() || ''
    let decision = { skill: 'status', args: {} }
    if (brainN++ % 2) { const c = WANDER[(brainN >> 1) % 2]; decision = { skill: 'goto', args: { x: c.x, y: c.y, z: c.z } } }
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ model: 'sandbox-script', created_at: new Date().toISOString(), message: { role: 'assistant', content: JSON.stringify({ ...decision, reason: 'sandbox: idle', saw_end: sentinel }) },
      done: true, total_duration: 1e6, load_duration: 0, prompt_eval_count: 10, prompt_eval_duration: 5e5, eval_count: 5, eval_duration: 5e5 }))
  })
})

const bots = new Map()   // name -> child (run-bot.sh execs node: the child IS the bot)
async function stopBot (signal = 'SIGTERM', only = null) {
  for (const [nm, b] of [...bots]) { if (only && nm !== only) continue; try { b.kill(signal) } catch {} bots.delete(nm) }
  await waitFor(() => (only ? !new RegExp(`\\b${only}\\b`).test(rcon('list')[0].reply) : /There are 0 of/.test(rcon('list')[0].reply)), 30000, 1000)
}
function startBot (nm, envRel, botOut, trace) {
  const bo = fs.openSync(botOut, 'a')
  const seen = lines(botOut).filter(l => /spawned pos=/.test(l)).length
  const b = spawn('bash', [`${R}/sandbox/run-bot.sh`, envRel], { cwd: R, env: { ...process.env, BOT_ROOT, NODE_OPTIONS: `--require ${TRACE}`, CRAFT_TRACE: trace }, stdio: ['ignore', bo, bo] })
  bots.set(nm, b)
  let spawnErr = null
  b.on('error', e => { spawnErr = e })
  return waitFor(() => spawnErr || lines(botOut).filter(l => /spawned pos=/.test(l)).length > seen, 90000, 300).then(v => { if (!v || spawnErr) throw new Error(`no spawn${spawnErr ? `: ${spawnErr.message}` : ''}`) })
}

async function runScene (scene) {
  const spec = SPEC[scene]
  if (!spec) throw new Error(`unknown scene ${scene}`)
  const tag = `${scene}-${CANDIDATE ? 'cand' : 'base'}-${SERVER}-${new Date().toISOString().replace(/[-:]/g, '').slice(9, 15)}`
  const logRel = `./sandbox/log/shop-e2e/${tag}`
  const names = spec.bots === 2 ? [NAME, NAME2] : [NAME]
  const skillLogs = names.map(nm => `${R}/sandbox/log/shop-e2e/${tag}/skill-${nm}.jsonl`)
  const pool = `sbxsh-${tag}`
  const poolDir = `${R}/sandbox/state/_pool-${pool}`
  // SH_SEED_POOL=<an earlier run's pool dir>: the town plan and the workshop record it SITED are copied in first, so the scene
  // runs a record an earlier build proved (F2: a record sited before the replant rule tightened, its replant cell unreachable)
  if (process.env.SH_SEED_POOL) {
    fs.mkdirSync(poolDir, { recursive: true })
    for (const n of fs.readdirSync(process.env.SH_SEED_POOL)) if (/^(project-760_120_760\.shop\.g\d+\.json|townplan-760_120_760\.g\d+\.json)$/.test(n)) fs.copyFileSync(path.join(process.env.SH_SEED_POOL, n), path.join(poolDir, n))
  }
  const per = names.map((nm, i) => {
    const sfx = i ? `-${i + 1}` : ''
    let env = fs.readFileSync(`${R}/sandbox/sandbox-bot-scripted.env`, 'utf8')
    const set = (key, v) => { env = new RegExp(`^${key}=`, 'm').test(env) ? env.replace(new RegExp(`^${key}=.*$`, 'm'), `${key}=${v}`) : env + `\n${key}=${v}` }
    set('BOT_NAME', nm); set('LOG_DIR', logRel); set('STATE_DIR', `./sandbox/state/shop-${tag}${sfx}`); set('MEMORY_POOL', pool)
    set('MEMORY_SCOPE', 'shared'); set('MINECRAFT_PORT', PORTS[SERVER]); set('STUCK_SECONDS', 20); set('PLANT_ENABLED', 0); set('PLINTH_FIRST', 0)
    set('OLLAMA_BASE_URL', `http://127.0.0.1:${BRAIN_PORT}`); set('OLLAMA_BASE_URLS', `http://127.0.0.1:${BRAIN_PORT}`); set('MAX_CONSECUTIVE_FAILURES', 50)
    set('FOUND', 'off'); set('SMELT_JOB', 0); set('SHOP_COOLDOWN_MS', 60000)
    for (const [k, v] of Object.entries(spec.env || {})) set(k, v)
    for (const ax of ['X', 'Y', 'Z']) { set(`HOME_${ax}`, HOME[ax.toLowerCase()]); set(`BOARD_${ax}`, HOME[ax.toLowerCase()]) }
    const envRel = `${ENV_REL}${sfx}`
    fs.writeFileSync(`${R}/${envRel}`, env + '\n')
    return { nm, envRel, botOut: `${OUTDIR}/bot-${tag}${sfx}.out`, trace: `${OUTDIR}/trace-${tag}${sfx}.jsonl` }
  })
  for (const p of per) await startBot(p.nm, p.envRel, p.botOut, p.trace)
  for (const nm of names) rcon(`gamemode survival ${nm}`, `tp ${nm} ${STAND.x} ${STAND.y} ${STAND.z}`, `effect clear ${nm}`)
  rcon('difficulty peaceful')
  await sleep(1500)
  // terrain r1 (base terrain-a): the fixture refills the whole volume around the stand, so a bot placed first fell into it and
  // died (its bag lost): on terrain the bags (clear + tp + items) come AFTER the scene
  const built = spec.terrain
    ? [...rconMany(arenaCmds(spec.floor)), ...rconMany(sceneCmds(spec), 400), ...names.flatMap(nm => rconMany(bagCmds(nm)))]
    : [...rconMany(arenaCmds(spec.floor)), ...names.flatMap(nm => rconMany(bagCmds(nm))), ...rconMany(sceneCmds(spec), 400)]
  const bad = built.filter(x => /not loaded|Cannot place|Unknown|Incorrect|Expected|Too many blocks/i.test(x.reply) && !/^(kill|forceload) /.test(x.cmd))
  if (bad.length) { await stopBot(); throw new Error('arena not built: ' + bad.slice(0, 3).map(x => x.cmd + ' => ' + x.reply).join('; ')) }
  await sleep(1500)
  const before = snapshot(names)
  const t0 = Date.now()
  const winMs = CANDIDATE ? (spec.windowMs || WINDOW_MS) : BASE_WINDOW_MS
  const allRows = () => skillLogs.flatMap(skillRows)
  const placeRows = () => allRows().filter(r => r.ts >= t0 && r.name === '_build' && kv1(r.detail, 'op') === 'place')
  let killed = null
  if (CANDIDATE && spec.killAfter) {
    const hit = await waitFor(() => placeRows().length >= spec.killAfter, winMs, 1000)
    if (hit) {
      const killAt = Date.now()   // the signal's moment (stopBot then waits for the server to drop the player)
      await stopBot('SIGKILL', NAME)
      killed = { at: killAt, places: placeRows().length }
      await sleep(3000)
      const p = per[0]
      await startBot(p.nm, p.envRel, p.botOut, p.trace)
      rcon(`gamemode survival ${NAME}`, `effect clear ${NAME}`)
    }
  }
  // a scene whose bot fells trees: the stock is read AT the completion (tree r19: 2 s after it build_composter crafted from the
  // bot's OWN felled logs -- the wood family moved by a job that is not the build; the leftovers' bank-back moves bag -> town,
  // which the town + bag sum does not see)
  const quick = !!(spec.trees || spec.terrain)
  const done = await waitFor(() => (CANDIDATE ? allRows().some(r => r.ts >= t0 && r.name === '_structure_complete') : false), winMs - (Date.now() - t0), quick ? 500 : 5000)
  if (done) await sleep(quick ? 500 : 8000)
  const after = snapshot(names)
  const rows = allRows().filter(r => r.ts >= t0 - 5000 || /_mode$/.test(r.name))
  await stopBot()
  for (const p of per) { try { fs.unlinkSync(`${R}/${p.envRel}`) } catch {} }
  const rec = recordOf(poolDir)
  const tb = sum(before.a, before.b, before.bag), ta = sum(after.a, after.b, after.bag)
  const out = { pass: false, why: [] }
  const need = (ok, why) => { if (!ok) out.why.push(why) }
  const judged = Object.fromEntries(Object.entries(after.ground).filter(([n]) => !AMBIENT.test(n)))
  const acks = per.map((p, i) => acksCheck(p.trace, killed && i === 0 ? { deadFrom: killed.at - 5000, deadTo: killed.at } : {})).reduce((a, b) => ({ places: a.places + b.places, foreign: a.foreign + b.foreign, dead: (a.dead ?? 0) + (b.dead ?? 0), acks: a.acks + b.acks, unacked: a.unacked + b.unacked, first: [...a.first, ...b.first].slice(0, 3) }))
  const extra = {}
  let cells = null
  // a DEATH in the window spoils either arm (terrain r1: a base bot died in the fixture and its lost bag read as the stock)
  const deaths = rows.filter(r => r.name === '_death' && r.ts >= t0 - 5000)
  need(!deaths.length, `no death in the window (${deaths.map(r => r.detail.slice(0, 60)).join('; ')})`)
  if (CANDIDATE) {
    need(!!done, 'a _structure_complete row inside the window')
    need(!!rec, 'the record exists in the pool state')
    const placedCells = new Set(rows.filter(r => r.name === '_build' && kv1(r.detail, 'op') === 'place').map(r => kv1(r.detail, 'cell')))
    if (rec) { cells = cellsCheck(rec, placedCells); need(cells.ok, `every record cell reads its role's block (${cells.bad.length} of ${cells.n} wrong: ${cells.bad.slice(0, 5).join(' ')})`) }
    const made = rows.filter(r => r.name === '_make_material' && /verdict=ok/.test(r.detail) && /(?:^| )kind=bricks/.test(r.detail)).reduce((t, r) => t + (Number(kv1(r.detail, 'made')) || 0), 0)
    // the names the town + bags must have lost: what the record's cells HOLD (a fallback cell is paid in its fallback's name),
    // every bill name not standing at zero
    const owed = Object.fromEntries([...Object.keys(BILL), ...Object.keys(cells?.standing || {})].map(n => [n, cells?.standing?.[n] || 0]))
    if (cells) { extra.fallback_cells = cells.fallback; if (Object.keys(cells.kept).length) extra.litter_kept = cells.kept }
    if (spec.terrain && cells) { for (const n of Object.keys(owed)) if (/_planks$/.test(n) && n !== 'oak_planks') { owed.oak_planks = (owed.oak_planks || 0) + owed[n]; delete owed[n] } }
    for (const [n, c] of Object.entries(cells ? owed : BILL)) {
      let d = (ta[n] || 0) - (tb[n] || 0)
      if (spec.bricksMade && n === 'stone_bricks') { extra.bricks_made = made; need(made >= 9 && d === made - c, `stone_bricks: town + bags ${d} = made ${made} - the bill ${c}, made >= 9`) } else if ((spec.trees || spec.terrain) && n === 'oak_planks') {
        // the WOOD FAMILY in planks (tree r1: the felled logs came home and some were crafted into planks): planks + 4 x logs moved
        // by exactly -the bill + 4 x the logs the tree clears felled
        const felled = rows.filter(r => r.name === '_build' && kv1(r.detail, 'op') === 'clear' && kv1(r.detail, 'kind') === 'tree').length
        // every species on terrain (a felled jungle or birch log may come home and be crafted into its own planks)
        const fam = (t, re) => Object.entries(t).filter(([k]) => re.test(k)).reduce((a, [, v]) => a + v, 0)
        const dl = spec.terrain ? fam(ta, /_log$/) - fam(tb, /_log$/) : (ta.oak_log || 0) - (tb.oak_log || 0)
        if (spec.terrain) d = fam(ta, /_planks$/) - fam(tb, /_planks$/)
        extra.wood = { planks: d, logs: dl, felled }
        need(d + 4 * dl === -c + 4 * felled, `wood (planks + 4 x logs): ${d} + 4 x ${dl} = -${c} + 4 x ${felled} felled`)
      } else need(d === -c, `${n}: town + bag ${d} (the bill ${-c})`)
    }
    need(!Object.keys(judged).length, `nothing judged on the ground (${diff({}, judged)})`)
    need(acks.places > 0 && acks.unacked === 0, `every block_place acknowledged by sequence (${acks.places} sent, ${acks.unacked} not: ${acks.first.join(' ')})`)
    // every record cell placed AT MOST once over the whole scene (every builder, before and after a kill)
    const per1 = {}
    for (const r of rows.filter(r => r.name === '_build' && kv1(r.detail, 'op') === 'place')) { const c = kv1(r.detail, 'cell'); per1[c] = (per1[c] || 0) + 1 }
    const twice = Object.entries(per1).filter(([, n]) => n > 1)
    extra.place_rows = Object.values(per1).reduce((a, b) => a + b, 0); extra.placed_twice = twice.length
    need(!twice.length, `no cell placed twice (${twice.slice(0, 3).map(([c, n]) => `${c}x${n}`).join(' ')})`)
    if (spec.bots === 2) {
      const by = {}; for (const r of rows.filter(r => r.name === '_build' && kv1(r.detail, 'op') === 'place')) by[r.bot] = (by[r.bot] || 0) + 1
      extra.places_by_bot = by
      let barriers = 0; try { barriers = fs.readdirSync(poolDir).filter(n => /\.barrier\.g\d+\.json$/.test(n)).length } catch {}
      const ov = leaseOverlaps(poolDir)
      extra.barriers = barriers; extra.lease_overlaps = ov.length
      need(names.every(nm => (by[nm] || 0) > 0), `both builders placed (${JSON.stringify(by)})`)
      need(barriers > 0, 'the barrier was taken by a closer')
      need(!ov.length, `no two holders on one lease (${ov.slice(0, 3).join('; ')})`)
      need(Object.keys(per1).length === (rec?.cells?.length || -1), `every record cell has a place row (${Object.keys(per1).length} of ${rec?.cells?.length})`)
    }
    if (spec.terrain) extra.ground_work = { fill: (rec?.fill || []).length, earthwork: Array.isArray(rec?.earthwork) ? rec.earthwork.length : rec?.earthwork ?? null, clear: (rec?.clear || []).length, felled: (rec?.felled || []).length, floor: rec?.floor ?? null }
    if (spec.killAfter) {
      const open = openIntentCount(poolDir)
      extra.killed = killed; extra.open_intents = open
      need(!!killed, `the builder was killed after its ${spec.killAfter}th placement`)
      need(open === 0, `no intent left open (${open})`)
    }
    if (spec.trees) {
      const trees = (rec?.clear || []).filter(c => c.kind === 'tree')
      const clears = rows.filter(r => r.name === '_build' && kv1(r.detail, 'op') === 'clear')
      const replants = rows.filter(r => r.name === '_build' && kv1(r.detail, 'op') === 'replant')
      const firstTree = clears.filter(r => kv1(r.detail, 'kind') === 'tree').map(r => r.ts).sort((a, b) => a - b)[0]
      const named = new Set((rec?.clear || []).map(c => c.at.join(','))), mine = new Set((rec?.cells || []).map(c => c.at.join(',')))
      const outside = clears.filter(r => !(named.has(kv1(r.detail, 'cell')) || (kv1(r.detail, 'kind') === 'foreign' && mine.has(kv1(r.detail, 'cell')))))
      const sap = (rec?.replant || []).map(rp => /Test passed/.test(rcon(`execute if block ${rp.cell.join(' ')} #minecraft:saplings`)[0].reply))
      extra.tree_clears = trees.length; extra.replant_cells = (rec?.replant || []).length; extra.replant_rows = replants.length
      need(trees.length > 0, 'the record clears a tree (the scene exercised the clear)')
      need(replants.length >= (rec?.replant || []).length && replants.every(r => firstTree == null || r.ts <= firstTree), 'every replant row precedes the first tree clear')
      need(sap.length > 0 && sap.every(Boolean), `every replant cell holds a sapling (${sap.filter(Boolean).length} of ${sap.length})`)
      need(!outside.length, `every clear row names a record clear cell (${outside.slice(0, 3).map(r => kv1(r.detail, 'cell')).join(' ')})`)
    }
    out.pass = !out.why.length
    out.verdict = out.pass ? 'CANDIDATE_PASS' : 'FAIL'
  } else {
    need(!rows.some(r => /^_build|^_structure/.test(r.name)), 'no _build row on the base')
    need(!rec, 'no record on the base')
    const untouched = spec.bricksMade ? ['glass_pane', 'cut_copper', 'torch', 'furnace', 'crafting_table'] : Object.keys(BILL)
    for (const n of untouched) need((ta[n] || 0) === (tb[n] || 0), `${n} unchanged (${(ta[n] || 0) - (tb[n] || 0)})`)
    out.pass = !out.why.length
    out.verdict = out.pass ? 'BASE_SHAPE' : 'BASE_UNEXPECTED'
  }
  const r = { scene, tag, candidate: CANDIDATE, server: SERVER, done: !!done, windowMs: Date.now() - t0, verdict: out,
    sha: (() => { try { return execFileSync('git', ['-C', BOT_ROOT, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() } catch { return '?' } })(),
    record: rec ? { sector: rec.sector, source: rec.sector_source, anchor: rec.anchor, orient: rec.orient, s: rec.s, gen: rec.gen, complete: rec.structure_complete, clear: (rec.clear || []).length, replant: (rec.replant || []).length } : null,
    cells: cells && { n: cells.n, bad: cells.bad.length }, acks, extra, d: { stock: diff(tb, ta), ground: diff({}, after.ground) }, rows }
  fs.appendFileSync(RES, JSON.stringify(r) + '\n')
  console.log(`${scene.padEnd(6)} ${out.verdict} done=${r.done} record=${JSON.stringify(r.record)} cells=${JSON.stringify(r.cells)} acks=${JSON.stringify({ places: acks.places, foreign: acks.foreign, dead: acks.dead, acks: acks.acks, unacked: acks.unacked })} extra=${JSON.stringify(extra)} d(stock){${r.d.stock}} ground{${r.d.ground}}` + (out.why.length ? `\n   why: ${out.why.join('; ')}` : ''))
  console.log('   rows: ' + rows.filter(x => /_build_visit|_structure_complete|_shop_skip|_townplan$|_make_material/.test(x.name)).map(x => `${x.bot || ''}${x.name}:${x.status}:${x.detail.slice(0, 160)}`).join(' || '))
  return out.pass
}

let arenaOwned = false
async function main () {
  sbx.requireSandboxLock(SERVER, 'shop')
  const pl = rcon('list')[0].reply; if (!/There are 0 of/.test(pl)) throw new Error('sandbox not empty: ' + pl)
  fs.mkdirSync(OUTDIR, { recursive: true })
  arenaOwned = true
  await new Promise((resolve, reject) => { brain.once('error', reject); brain.listen(BRAIN_PORT, '127.0.0.1', resolve) })
  console.log(`root=${BOT_ROOT} build=${CANDIDATE ? 'CANDIDATE' : 'BASE'} server=${SERVER} scenes=${SCENES_S}`)
  let ok = true
  for (const s of SCENES_S.split(',')) {
    try { ok = (await runScene(s)) && ok } catch (e) { ok = false; console.log(`${s} SCENE FAILED: ${e.message}`); await stopBot().catch(() => {}) }
  }
  return ok
}
async function cleanup () {
  if (arenaOwned) await stopBot().catch(() => {})
  try { brain.close() } catch {}
  for (const sfx of ['', '-2']) { try { fs.unlinkSync(`${R}/${ENV_REL}${sfx}`) } catch {} }
  // SHOP_KEEP=1 leaves the built workshop standing (and the arena force-loaded until a later scene's set-up clears it) for the
  // structure count's positive control on the saved world (read r2 review, Claude Q3); the next scene's set-up refills the arena
  if (arenaOwned && process.env.SHOP_KEEP === '1') { try { rconMany(['save-all flush']) } catch {} return }
  if (arenaOwned) { try { rconMany([`kill @e[type=!player,x=${HOME.x},y=${HOME.y},z=${HOME.z},distance=..80]`, ...arenaCmds().slice(2, -1), `forceload remove ${A0} ${A0} ${A1} ${A1}`]) } catch {} }
}
let cleaning = false
const finish = code => { if (cleaning) return; cleaning = true; cleanup().then(() => process.exit(code)) }
main().then(ok => finish(ok ? 0 : 2), e => { console.error('FATAL', e.message); finish(1) })
process.on('SIGINT', () => finish(1))
process.on('SIGTERM', () => finish(1))
process.on('SIGHUP', () => finish(1))
