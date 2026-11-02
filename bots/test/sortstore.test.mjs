// SORTSTORE-01: THE SORTED STOREHOUSE (bots/src/sortstore.mjs + its skills.mjs wiring). Pure: the switches; the category homes read
// from a town plan (greenfield placed store cells, retrofit groups); the deposit order and what each container takes; the deposit
// verb's first chest; the search's preference; the tidy's moves (only from KNOWN entries, only into a home with room, one source,
// bounded); the labels' spots on the REAL showcase storehouse record (11-01 fixture: six interior chests, each on a wall cell, never
// a window). On the town deposit's fake server (towndeposit.test.mjs's world, copied): a SORTED town deposit puts each group in its
// own home, a homeless group in the overflow, a full home's stacks in the overflow -- and the same bag unsorted goes to the nearest.
// Mutants assert their anchors present and unique (CLAUDE.md).
process.env.LOG_DIR = process.env.LOG_DIR || '/tmp/mcbot-test-logs-sortstore'
process.env.BOT_NAME = process.env.BOT_NAME || 'SortBot'
process.env.MEMORY_SCOPE = 'board'   // a town plan is read only outside isolated (skills.mjs planOn)
process.env.LOG_LEVEL = 'error'
process.env.BOT_ROLE = 'gatherer'
process.env.SORTSTORE = 'on'
process.env.POOL_STATE_DIR = (await import('node:fs')).mkdtempSync((await import('node:path')).join((await import('node:os')).tmpdir(), 'sort-pool-'))
process.env.HOME_X = '0'; process.env.HOME_Y = '70'; process.env.HOME_Z = '0'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { createRequire } from 'node:module'
const require_ = createRequire(import.meta.url)
const mcData = require_('minecraft-data')('1.21.8')
const { Vec3 } = require_('vec3')
const S = await import('../src/sortstore.mjs')
const { SKILLS } = await import('../src/skills.mjs')
const { tapRecords } = await import('../src/logger.mjs')
const SORT_PATH = new URL('../src/sortstore.mjs', import.meta.url)
const SKILLS_PATH = new URL('../src/skills.mjs', import.meta.url)
const FIX = JSON.parse(readFileSync(new URL('./fixtures/sortstore-showcase-1101.json', import.meta.url), 'utf8'))

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 6).join('\n        ')}`) }
}
async function withMutant (old, neu, fn, file = SORT_PATH) {
  const src = readFileSync(file, 'utf8')
  assert.ok(src.includes(old), `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 70))}`)
  assert.ok(src.split(old).length === 2, 'ANCHOR MISSING OR NOT UNIQUE')
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, src.replace(old, neu).replace(/from '\.\//g, "from '../src/"))
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}
const killed = async (old, neu, scenario) => {
  await scenario(S)
  let k = false
  await withMutant(old, neu, async M => { try { await scenario(M) } catch { k = true } })
  assert.ok(k, 'the mutant survived')
}

// ---- the homes ---------------------------------------------------------------------------------------------------------
const cell = (at, role, group = null, state = 'placed', extra = {}) => ({ at, kind: 'chest', stand: [at[0] + 1, at[1], at[2]], role, group, state, ...extra })
const planOf = cells => ({ mode: 'greenfield', groups: { v: 1, status: 'greenfield', homes: {} }, plots: [{ id: 'store', kind: 'storehouse', cells }] })
const SHOW = () => S.sortHomes(FIX.plan)

await t('switches: SORTSTORE on/off wins; unset = the pools (default showcase); SORT_TIDY / SORT_SIGNS off alone', () => {
  assert.deepEqual(S.sortSwitches({}, 'showcase'), { on: true, tidy: true, signs: true })
  assert.deepEqual(S.sortSwitches({}, 'hive-a'), { on: false, tidy: false, signs: false })
  assert.equal(S.sortSwitches({ SORTSTORE: 'off' }, 'showcase').on, false)
  assert.equal(S.sortSwitches({ SORTSTORE: 'on' }, 'hive-a').on, true)
  assert.equal(S.sortSwitches({ SORTSTORE_POOLS: 'hive-a,board-b' }, 'board-b').on, true)
  assert.deepEqual(S.sortSwitches({ SORT_TIDY: 'off' }, 'showcase'), { on: true, tidy: false, signs: true })
  assert.deepEqual(S.sortSwitches({ SORT_SIGNS: 'off' }, 'showcase'), { on: true, tidy: true, signs: false })
})

await t('homes from the showcase plan (gen 27): six group homes + the overflow inside, three outside; free cells are no home', () => {
  const h = SHOW()
  assert.deepEqual(Object.fromEntries([...h.homeOf].map(([g, ks]) => [g, ks])), {
    stone: ['-9,71,-2'], metal: ['-11,71,-2'], fuel: ['-13,71,0'], tools: ['-13,71,2'], wood: ['-13,71,-2'], valuable: ['-8,71,6'], earth: ['-7,71,8'], build: ['-5,71,8'] })
  assert.deepEqual(h.overflow, ['-9,71,2'])
  assert.equal(h.byKey.has('-11,71,2'), false)   // free (no chest yet)
  assert.equal(h.byKey.has('-4,71,-8'), false)
})
await t('homes: only PLACED chest cells count; a retrofit plan reads groups.homes/overflow once allocated; no plan = nothing sorts', () => {
  const h = S.sortHomes(planOf([cell([1, 70, 1], 'home', 'stone', 'reserved'), cell([3, 70, 1], 'home', 'wood')]))
  assert.deepEqual([...h.homeOf.keys()], ['wood'])
  const r = S.sortHomes({ mode: 'retrofit', groups: { status: 'allocated', homes: { metal: ['5,70,5', '6,70,5'], fuel: [] }, overflow: ['7,70,5'] }, plots: [{ id: 'store', kind: 'cluster', cells: [] }] })
  assert.deepEqual(r.homeOf.get('metal'), ['5,70,5', '6,70,5']); assert.deepEqual(r.overflow, ['7,70,5']); assert.equal(r.homeOf.has('fuel'), false)
  assert.equal(S.sortHomes({ mode: 'retrofit', groups: { status: 'waiting', homes: { metal: ['5,70,5'] } }, plots: [] }).homeOf.size, 0)
  assert.equal(S.sortsAnything(S.sortHomes(null)), false)
})

// ---- the deposit order -------------------------------------------------------------------------------------------------
await t('deposit order: own homes (each its own group only), the overflow, unnamed, then other homes -- nearest first within a tier', async () => {
  await killed("  return groups.includes(e.group) ? 0 : 3", "  return groups.includes(e.group) ? 0 : 2", M => {
    const h = M.sortHomes(FIX.plan)
    const list = ['-13,71,2', '0,70,9', '-9,71,2', '-13,71,-2', '-9,71,-2'].map(k => ({ k }))   // tools, unnamed, overflow, wood, stone
    assert.deepEqual(M.depositOrder(h, list, ['stone', 'wood']).map(c => c.k), ['-13,71,-2', '-9,71,-2', '-9,71,2', '0,70,9', '-13,71,2'])
  })
  const h = SHOW()
  const stone = S.acceptsFor(h, '-9,71,-2', ['stone', 'wood']), over = S.acceptsFor(h, '-9,71,2', ['stone']), tools = S.acceptsFor(h, '-13,71,2', ['stone'])
  assert.equal(stone('cobblestone'), true); assert.equal(stone('spruce_log'), false)
  assert.equal(over('spruce_log'), true); assert.equal(tools('cobblestone'), true)   // a fallback takes anything
  assert.equal(S.depositTier(h, '0,0,0', ['stone'], '-9,71,-2'), 0)                   // a double chest's other half is its key
})
await t('tries: one per own home + overflow + one fallback + the last any-name pass, between 2 and 7', () => {
  const h = SHOW()
  assert.equal(S.sortTries(h, []), 3); assert.equal(S.sortTries(h, ['stone', 'wood', 'farm']), 5); assert.equal(S.sortTries(h, ['stone', 'wood', 'metal', 'fuel', 'tools', 'build']), 7)
})
await t('deposit verb target: the home of the group banked most (items); none homed -> the overflow', async () => {
  await killed('  const ranked = [...by.entries()].filter(([g]) => homes.homeOf.has(g)).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))',
    '  const ranked = [...by.entries()].filter(([g]) => homes.homeOf.has(g)).sort((a, b) => a[1] - b[1] || (a[0] < b[0] ? -1 : 1))', M => {
      const h = M.sortHomes(FIX.plan)
      assert.equal(M.sortDepositTarget(h, [{ name: 'cobblestone', count: 100 }, { name: 'spruce_log', count: 20 }]), '-9,71,-2')
    })
  const h = SHOW()
  assert.equal(S.sortDepositTarget(h, [{ name: 'bone_meal', count: 5 }]), '-9,71,2')
  assert.equal(S.sortDepositTarget(S.sortHomes(null), [{ name: 'cobblestone', count: 1 }]), null)
})
await t('search preference: the needs\' homes (pick -> tools, stick/planks -> wood, iron_ingot -> metal, coal -> fuel)', () => {
  const h = SHOW()
  assert.deepEqual([...S.searchPrefer(h, ['pick'])], ['-13,71,2'])
  assert.deepEqual([...S.searchPrefer(h, ['stick', 'planks'])], ['-13,71,-2'])
  assert.deepEqual([...S.searchPrefer(h, ['iron_ingot', 'coal'])], ['-11,71,-2', '-13,71,0'])
  assert.deepEqual(S.withdrawPrefer(h, 'stick'), ['-13,71,-2'])
})
await t('townSearchOrder: within its tier the home first; a container KNOWN to hold the need still beats a home that does not', async () => {
  const W = await import('../src/withdrawpick.mjs')
  const now = Date.now()
  const cs = [{ k: 'a', d: 1 }, { k: 'home', d: 9 }, { k: 'b', d: 2 }]
  assert.deepEqual(W.townSearchOrder(cs, ['stick'], { now, prefer: new Set(['home']) }).map(r => r.k), ['home', 'a', 'b'])
  const counts = { stick: { b: { n: 5, at: now - 1000 } } }
  assert.deepEqual(W.townSearchOrder(cs, ['stick'], { now, counts, prefer: new Set(['home']) }).map(r => r.k), ['b', 'home', 'a'])
  assert.deepEqual(W.townSearchOrder(cs, ['stick'], { now }).map(r => r.k), ['a', 'b', 'home'])   // no preference: as before
})

// ---- the tidy ------------------------------------------------------------------------------------------------------------
// the showcase index 11-01 22:10Z (counts, slots), five of the interior chests
const E = {
  '-9,71,-2': { names: { spruce_log: [111, 2], iron_ingot: [13, 1], cobblestone: [126, 2], coal: [19, 1], torch: [12, 1] }, used: 26, size: 27 },   // stone
  '-13,71,-2': { names: { stone_bricks: [63, 1], glass_pane: [6, 1], cobblestone: [174, 3] }, used: 6, size: 27 },                                  // wood
  '-13,71,2': { names: { spruce_log: [196, 4], cobblestone: [78, 2] }, used: 14, size: 27 },                                                        // tools
  '-9,71,2': { names: { spruce_log: [70, 2], lapis_lazuli: [62, 1], bone_meal: [3, 1] }, used: 25, size: 27 },                                     // overflow
  '-11,71,-2': { names: { cobblestone: [127, 2], copper_ingot: [29, 1] }, used: 3, size: 27 },                                                     // metal
}
await t('tidy: the source with the most misplaced slots; each stack to its home with room; homeless groups -> overflow; at most the budget', async () => {
  await killed("      const misplaced = e.role === 'overflow' ? homes.homeOf.has(g) : e.group !== g", "      const misplaced = e.role === 'overflow' ? !homes.homeOf.has(g) : e.group !== g", M => {
    const h = M.sortHomes(FIX.plan)
    const r = M.tidyMoves(h, { '-9,71,2': { names: { spruce_log: [70, 2] }, used: 2, size: 27 }, '-13,71,-2': { names: {}, used: 0, size: 27 } })
    assert.equal(r?.moves?.[0]?.to, '-13,71,-2', 'the overflow\'s logs go to the wood home')
  })
  const h = SHOW()
  const r = S.tidyMoves(h, E)
  assert.equal(r.from, '-13,71,2')   // the tools home: 4 log slots + 2 cobble slots misplaced (the wood home has 5)
  const to = Object.fromEntries(r.moves.map(m => [m.name, m.to]))
  assert.equal(to.spruce_log, '-13,71,-2'); assert.equal(r.moves.find(m => m.name === 'spruce_log').slots, 4)
  assert.equal(to.cobblestone, '-9,71,-2')   // the stone home has 1 free slot ...
  assert.equal(r.moves.find(m => m.name === 'cobblestone').slots, 1)   // ... so one slot of two
  assert.ok(r.moves.reduce((a, m) => a + m.slots, 0) <= S.SORT_MOVE_STACKS)
  // the wood home's bricks and glass: their homes (stone, build) have no index entry -- room unknown -- so nothing moves (never to
  // an unknown target, and never to the overflow while the group has a home)
  assert.equal(S.tidyMoves(h, { '-13,71,-2': E['-13,71,-2'], '-9,71,2': { names: {}, used: 0, size: 27 } }), null)
})
await t('tidy: an unknown target is never chosen; a back-off skips a move; no budget -> nothing; the overflow keeps a homeless group', () => {
  const h = SHOW()
  assert.equal(S.tidyMoves(h, { '-9,71,2': { names: { bone_meal: [3, 1] }, used: 1, size: 27 } }), null)   // farm has no home
  assert.equal(S.tidyMoves(h, { '-9,71,2': { names: { spruce_log: [70, 2] }, used: 2, size: 27 } }), null)  // wood home unknown
  const both = { '-9,71,2': { names: { spruce_log: [70, 2] }, used: 2, size: 27 }, '-13,71,-2': { names: {}, used: 0, size: 27 } }
  assert.equal(S.tidyMoves(h, both).moves[0].to, '-13,71,-2')
  assert.equal(S.tidyMoves(h, both, { skip: (f, n) => f === '-9,71,2' && n === 'spruce_log' }), null)
  assert.equal(S.tidyMoves(h, both, { maxSlots: 0 }), null)
  const full = { '-9,71,2': { names: { spruce_log: [70, 2] }, used: 2, size: 27 }, '-13,71,-2': { names: {}, used: 27, size: 27 } }
  assert.equal(S.tidyMoves(h, full), null)   // the wood home is full
})

// ---- the labels -------------------------------------------------------------------------------------------------------
await t('labels on the REAL showcase storehouse: one per interior chest (6), on a wall cell above it, never a window, facing in', async () => {
  const stands = new Map(FIX.plan.plots[0].cells.map(c => [c.at.join(','), c.stand]))
  const walls = new Map(FIX.rec.cells.map(c => [c.at.join(','), c.role]))
  const sp = S.signSpots(FIX.rec, SHOW(), stands)
  assert.deepEqual(sp.map(s => `${s.chest}:${s.lines[0]}`).sort(), ['-11,71,-2:METAL', '-13,71,-2:WOOD', '-13,71,0:FUEL', '-13,71,2:TOOLS', '-9,71,-2:STONE', '-9,71,2:OVERFLOW'])
  for (const s of sp) {
    const [x, y, z] = s.chest.split(',').map(Number)
    assert.deepEqual(s.at, [x, y + 1, z])
    assert.ok(['base', 'upper', 'corner'].includes(walls.get(s.wall.join(','))), `${s.chest} wall ${s.wall} is ${walls.get(s.wall.join(','))}`)
    assert.equal(Math.abs(s.face[0]) + Math.abs(s.face[2]), 1)
    assert.ok(!walls.has(s.at.join(',')), 'the label cell is no record cell')
    for (const l of s.lines) assert.ok(l.length <= 15, l)
  }
  // -9,71,2's straight-past wall along x is the plaza wall's WINDOW: the side wall is used instead
  assert.deepEqual(sp.find(s => s.chest === '-9,71,2').wall, [-9, 72, 3])
  await killed("const WALL_ROLES = new Set(['base', 'upper', 'corner'])", "const WALL_ROLES = new Set(['base', 'upper', 'corner', 'window'])", M => {
    assert.deepEqual(M.signSpots(FIX.rec, M.sortHomes(FIX.plan), stands).find(s => s.chest === '-9,71,2').wall, [-9, 72, 3])
  })
})
await t('label need: a matching wall sign ok, a wrong or blank one edit, air place (a solid wall), anything else blocked, unloaded unknown', () => {
  const sp = { lines: ['STONE', 'cobble, bricks', 'stone'] }
  assert.equal(S.spotNeed(sp, { name: 'oak_wall_sign' }, 'STONE\ncobble, bricks\nstone\n'), 'ok')
  assert.equal(S.spotNeed(sp, { name: 'spruce_wall_sign' }, '\n\n\n'), 'edit')
  assert.equal(S.spotNeed(sp, { name: 'spruce_wall_sign' }, 'WOOD\nlogs, planks\nsticks\n'), 'edit')
  assert.equal(S.spotNeed(sp, { name: 'air' }, null, true), 'place')
  assert.equal(S.spotNeed(sp, { name: 'air' }, null, false), 'blocked')
  assert.equal(S.spotNeed(sp, { name: 'torch' }), 'blocked')
  assert.equal(S.spotNeed(sp, null), 'unknown')
  assert.equal(S.labelText(['A', 'B']), 'A\nB')
})

// ---- the sorted town deposit on the fake server ------------------------------------------------------------------------
// (towndeposit.test.mjs world(), verbatim)
function world ({ items, containers, botAt = new Vec3(3, 70, 0), failDest = null, refuse = null, cursorStuck = false, onClick = null, openNever = false, fillDest = null, reopenFails = false, stealOnClose = false, swapAfter = null }) {
  const bagSlots = Array(46).fill(null)                      // the CLIENT's bag (bot.inventory)
  for (const it of items) bagSlots[it.slot] = { ...it }
  const server = { bag: bagSlots.map(x => (x ? { ...x } : null)) }
  const st = { opened: [], dropped: 0, clicks: 0, closes: 0, loadedCloses: 0, late: null, walks: [] }
  const contAt = p => containers.find(c => c.pos.x === p.x && c.pos.y === p.y && c.pos.z === p.z)
  const blk = c => ({ name: c.type ?? 'chest', type: mcData.blocksByName[c.type ?? 'chest'].id, position: c.pos, boundingBox: 'block',
                      getProperties: () => c.props ?? { type: 'single', facing: 'north' } })
  const left = (w, slot) => {                                  // one vanilla left click on window-like {slots, selectedItem}
    const at = w.slots[slot], cur = w.selectedItem
    if (!cur) { if (at) { w.selectedItem = { ...at }; w.slots[slot] = null } return }
    if (!at) { w.slots[slot] = { ...cur, slot }; w.selectedItem = null; return }
    if (at.name === cur.name) { const size = mcData.itemsByName[cur.name].stackSize; const m = Math.min(size - at.count, cur.count); at.count += m; cur.count -= m; if (!cur.count) w.selectedItem = null; return }
    w.slots[slot] = { ...cur, slot }; w.selectedItem = { ...at }
  }
  const bot = {
    entity: { position: botAt, velocity: { x: 0, y: 0, z: 0 } },
    registry: mcData,
    controlState: {},
    currentWindow: null,
    // A CRAFTSYNC STAND-IN (as withdraw-pick.test.mjs): lockstep runs the clicks; the cursor confirmation answers with
    // the SERVER's cursor -- the fake server's own window copy -- never the client's.
    craftSync: {
      lockstep: fn => fn(), inflight: () => 0, invalidate: () => 0,
      recount: async () => ({ source: 'server', items: server.bag.slice(9, 45).filter(Boolean) }),
      confirmCursor: async win => { const c = win?.server?.selectedItem; return { answered: true, cursorEmpty: !c, carried: c ? { itemCount: c.count } : null } },
    },
    equip: async () => {}, unequip: async () => {}, moveSlotItem: async () => {}, toss: async () => {}, tossStack: async () => {}, closeWindow: () => {},
    removeListener: () => {}, once: () => {}, _client: {},
    inventory: { inventoryStart: 9, items: () => bagSlots.slice(9, 45).filter(Boolean) },
    findBlocks: ({ maxDistance }) => containers.map(c => c.pos).filter(p => bot.entity.position.distanceTo(p) <= maxDistance),
    blockAt: p => {
      const c = contAt(p); if (c) return blk(c)
      const under = contAt({ x: p.x, y: p.y - 1, z: p.z })
      if (under && under.lid) return { name: under.lid, boundingBox: 'block', shapes: [[0, 0, 0, 1, 1, 1]] }
      return { name: 'air', boundingBox: 'empty' }
    },
    pathfinder: { goto: async g => { st.walks.push(g) }, setGoal: () => {} },
    setControlState: () => {}, lookAt: async () => {}, waitForTicks: async () => {},
    openContainer: (b) => {
      const c = contAt(b.position)
      st.opened.push(`${c.pos.x},${c.pos.y},${c.pos.z}`)
      if (c.unopenable || (reopenFails && st.opened.filter(x => x === `${c.pos.x},${c.pos.y},${c.pos.z}`).length > 1)) return Promise.reject(new Error('windowOpen did not fire'))
      const n = c.size ?? 27
      const mk = () => {
        const w = { slots: Array(n + 36).fill(null), selectedItem: null }
        for (let i = 0; i < n; i++) w.slots[i] = c.items[i] ? { ...c.items[i], slot: i } : null
        for (let s = 9; s < 45; s++) w.slots[s - 9 + n] = server.bag[s] ? { ...server.bag[s], slot: s - 9 + n } : null
        return w
      }
      const win = { id: st.opened.length, inventoryStart: n, inventoryEnd: n + 36, ...mk() }
      // prismarine-windows' own lookups, which withdraw's settleCursor uses to put a cursor back
      win.items = () => win.slots.slice(n, n + 36).filter(Boolean)
      win.containerItems = () => win.slots.slice(0, n).filter(Boolean)
      win.firstEmptySlotRange = (a, b) => { for (let i = a; i < b; i++) if (!win.slots[i]) return i; return null }
      win.findItemRange = (a, b, type, _m, notFull) => { for (let i = a; i < b; i++) { const x = win.slots[i]; if (x && x.type === type && (!notFull || x.count < (x.stackSize ?? 64))) return { ...x, slot: i } } return null }
      win.server = mk()
      win.close = () => {
        st.closes++
        for (let i = 0; i < n; i++) c.items[i] = win.server.slots[i] ? { ...win.server.slots[i] } : null
        for (let s = 9; s < 45; s++) {
          bagSlots[s] = win.slots[s - 9 + n] ? { ...win.slots[s - 9 + n], slot: s } : null
          server.bag[s] = win.server.slots[s - 9 + n] ? { ...win.server.slots[s - 9 + n], slot: s } : null
        }
        if (win.server.selectedItem) {
          st.loadedCloses++
          const free = [...Array(36).keys()].map(i => i + 9).find(s => !server.bag[s])
          if (free != null) server.bag[free] = { ...win.server.selectedItem, slot: free }
          else st.dropped += win.server.selectedItem.count
          if (free != null) bagSlots[free] = { ...win.server.selectedItem, slot: free }
        }
        win.selectedItem = null; win.server.selectedItem = null
        if (bot.currentWindow === win) bot.currentWindow = null
        if (stealOnClose && st.closes === 1) for (let i = 0; i < n; i++) if (c.items[i] && c.items[i].name !== 'dirt') c.items[i] = null   // another bot empties what was put in (the first chest only)
      }
      if (openNever) return new Promise(res => { st.late = () => { bot.currentWindow = win; res(win) } })
      bot.currentWindow = win
      return Promise.resolve(win)
    },
    clickWindow: async (slot, btn, mode) => {
      const win = bot.currentWindow
      // logbank-01: a right click (btn 1) is allowed ONLY as the log half-split's pickup: an empty cursor on a bag stack
      assert.equal(mode, 0, 'mode 0 clicks only'); assert.ok(btn === 0 || btn === 1)
      if (btn === 1) {
        assert.ok(!win.selectedItem && slot >= win.inventoryStart && /_log$|^coal$/.test(win.slots[slot]?.name ?? ''), 'a right click only lifts half a bag log (or, coalfirst-01, coal) stack')
        st.rightClicks = (st.rightClicks ?? 0) + 1; st.clicks++
        for (const w of [win, win.server]) { const at = w.slots[slot]; const take = Math.ceil(at.count / 2); w.selectedItem = { ...at, count: take }; at.count -= take; if (!at.count) w.slots[slot] = null }
        return
      }
      st.clicks++
      if (win?.foreign) { st.foreignClicks = (st.foreignClicks ?? 0) + 1; return }
      if (onClick) onClick(slot, win)
      const cur = win.selectedItem
      if (!cur && fillDest) { const d = fillDest(slot, win); if (d != null) { win.slots[d] = item('dirt', 64, d); win.server.slots[d] = item('dirt', 64, d) } }
      if (cur && slot < win.inventoryStart && failDest && failDest(cur)) throw new Error('simulated click failure')
      if (cur && !win.slots[slot] && cursorStuck && (slot >= win.inventoryStart || failDest?.(cur))) return   // the stuck stack goes nowhere
      const refused = cur && slot < win.inventoryStart && !win.slots[slot] && refuse && refuse(cur)
      left(win, slot)
      if (refused) {   // the server keeps the stack in its source slot: put its cursor back there
        const src = win.server.slots.findIndex((x, i) => i >= win.inventoryStart && !x)
        win.server.slots[src] = { ...win.server.selectedItem, slot: src }; win.server.selectedItem = null
      } else left(win.server, slot)
    },
  }
  if (swapAfter) {   // after click N lands, another window becomes the open one (a late open, a server-opened screen)
    const inner = bot.clickWindow
    bot.clickWindow = async (...a) => { await inner(...a); if (st.clicks === swapAfter) bot.currentWindow = { foreign: true, slots: [], selectedItem: null } }
  }
  return { bot, st, bagSlots, server }
}

const chest = (x, z, extra = {}) => ({ pos: new Vec3(x, 70, z), items: Array(27).fill(null), ...extra })
function item (name, count = 1, slot = 9, extra = {}) {
  const def = mcData.itemsByName[name]
  return { name, count, slot, type: def.id, stackSize: def.stackSize, ...extra }
}
const fill = (n, s0 = 0) => Array.from({ length: n }, (_, i) => item('white_wool', 1 + (i % 3), 9 + s0 + i))
// 36 slots: oak logs (a visit banks 64 of a name), copper ingots (metal), coal and lapis (fuel, valuable: no home here), wool filler
const sortBag = () => [item('oak_log', 64, 9), item('oak_log', 64, 10), item('oak_log', 16, 11), item('copper_ingot', 30, 12), item('coal', 20, 13),
  item('lapis_lazuli', 20, 14), ...fill(30, 6)]
// the plan: overflow nearest the bot (2,70,0), the metal home (4,70,2), the wood home (6,70,-2)
const sortPlan = planOf([cell([2, 70, 0], 'overflow'), cell([4, 70, 2], 'home', 'metal'), cell([6, 70, -2], 'home', 'wood')])
const names = c => { const o = {}; for (const it of c.items) if (it) o[it.name] = (o[it.name] ?? 0) + it.count; return o }
const deposit = async (w, plan) => {
  w.bot.townPlan = plan ? { gen: 1, plan, at: Date.now() } : null
  const rows = []
  const untap = tapRecords(r => { if (r?.skill?.name === '_sort_deposit') rows.push(r) })
  try { return { r: await SKILLS.town_deposit.run({ bot: w.bot }, {}, null), rows } } finally { untap() }
}
await t('SKILL: a SORTED town deposit puts the copper in the metal home, the logs in the wood home, the homeless coal + lapis in the overflow', async () => {
  const cs = [chest(2, 0), chest(4, 2), chest(6, -2)]
  const w = world({ items: sortBag(), containers: cs })
  const { r, rows } = await deposit(w, sortPlan)
  assert.equal(r.status, 'success', r.detail)
  assert.deepEqual(names(cs[1]), { copper_ingot: 30 })
  assert.deepEqual(names(cs[2]), { oak_log: 64 })
  assert.deepEqual(names(cs[0]), { coal: 20, lapis_lazuli: 20 })
  assert.equal(rows.length, 1); assert.match(rows[0].skill.detail, /4,70,2:t0:copper_ingot/); assert.match(rows[0].skill.detail, /2,70,0:t1:/)
})
await t('SKILL: unsorted (no plan) the same bag goes to the nearest container -- the positive control for the routing above', async () => {
  const cs = [chest(2, 0), chest(4, 2), chest(6, -2)]
  const w = world({ items: sortBag(), containers: cs })
  const { r } = await deposit(w, null)
  assert.equal(r.status, 'success', r.detail)
  assert.deepEqual(names(cs[0]), { oak_log: 64, copper_ingot: 30, coal: 20, lapis_lazuli: 20 })
  assert.deepEqual(names(cs[1]), {})
})
await t('SKILL: a FULL home never refuses the deposit: its stacks go down the order (the overflow)', async () => {
  const cs = [chest(2, 0), chest(4, 2, { items: Array.from({ length: 27 }, () => item('dirt', 64)) }), chest(6, -2)]
  const w = world({ items: sortBag(), containers: cs })
  const { r } = await deposit(w, sortPlan)
  assert.equal(r.status, 'success', r.detail)
  assert.equal(names(cs[0]).copper_ingot, 30)
  assert.deepEqual(names(cs[2]), { oak_log: 64 })
})
await t('SKILL (Codex r1 BLOCK): the overflow AND the metal home full -> the roomy wood home takes the rest on the last pass; nothing refused', async () => {
  const full = () => Array.from({ length: 27 }, () => item('dirt', 64))
  const cs = [chest(2, 0, { items: full() }), chest(4, 2, { items: full() }), chest(6, -2)]
  const w = world({ items: sortBag(), containers: cs })
  const { r, rows } = await deposit(w, sortPlan)
  assert.equal(r.status, 'success', r.detail)
  assert.deepEqual(names(cs[2]), { oak_log: 64, copper_ingot: 30, coal: 20, lapis_lazuli: 20 })
  assert.match(rows[0].skill.detail, /6,70,-2:t4:/)
})
await t('MUTANT KILLED: a home that takes anything (acceptsFor) -- the pure rule the skill scene above routes by', async () => {
  await killed("  if (e?.role === 'home' && groups.includes(e.group)) return name => itemGroup(name) === e.group", "  if (false) return () => true", M => {
    const h = M.sortHomes(sortPlan)
    assert.equal(M.acceptsFor(h, '4,70,2', ['metal', 'wood'])('oak_log'), false, 'the metal home refuses logs')
    assert.equal(M.acceptsFor(h, '4,70,2', ['metal', 'wood'])('copper_ingot'), true)
  })
})
await t('order: a `dueFirst` upkeep (the storehouse) goes ahead of an earlier project\'s `due`; open projects and repairs still first', async () => {
  const SHOP = await import('../src/shop.mjs')
  const list = [{ plot: 'monument' }, { plot: 'paths' }, { plot: 'storehouse' }]
  const st = (plot, o) => ({ plot, exists: true, complete: true, damaged: false, due: false, ...o })
  assert.equal(SHOP.activeProject([st('monument', { due: true }), st('paths'), st('storehouse', { due: true, dueFirst: true })], list).plot, 'storehouse')
  assert.equal(SHOP.activeProject([st('monument', { due: true }), st('paths'), st('storehouse', { due: true })], list).plot, 'monument')   // control
  assert.equal(SHOP.activeProject([st('monument', { due: true }), st('paths', { complete: false }), st('storehouse', { due: true, dueFirst: true })], list).plot, 'paths')
  assert.equal(SHOP.activeProject([st('monument', { damaged: true }), st('paths'), st('storehouse', { due: true, dueFirst: true })], list).plot, 'monument')
})
await t('WIRED (structure): the deposit verb, the withdraw sweep, the search, the storehouse due and visit read the sort', () => {
  const src = readFileSync(SKILLS_PATH, 'utf8').replace(/\/\/[^\n]*/g, '')
  for (const s of ['const k = sh ? sortDepositTarget(sh, depositPlan(bot.inventory.items(), item, { wants: bot.currentWants ?? [] })) : null',
    "const sweep = withdrawSweep(bot, { prefer: (() => { const sh = sortHomesNow(bot); return sh ? withdrawPrefer(sh, item) : [] })() })",
    'prefer: sh ? searchPrefer(sh, needs) : null',
    'if (tidy && r.blueprint === STORE_BLUEPRINT && storeUpkeepDue(bot, r)) return true',
    'storeUpkeepDue(bot, rec)) return storeUpkeepVisit(ctx, rec, signal, out)']) assert.equal(src.split(s).length, 2, s)
})

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
