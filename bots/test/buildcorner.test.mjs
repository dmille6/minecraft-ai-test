// shopwalls-02: THE CORNER CUT (bots/src/buildbot.mjs cornerCut / cornerWaypoints; the build visit's walkTo).
// LIVE showcase 10-28: builders wedged at 21.1,74,32.3 on the workshop's ring corner; the pathfinder's own A*, replayed on the
// live region, plans 21,74,32 -> 20,74,31 as ONE diagonal step across the wall corner 21,74,31.
import assert from 'node:assert'
import fs from 'node:fs'

const { cornerCut, cornerWaypoints } = await import('../src/buildbot.mjs')
let pass = 0, fail = 0
const t = async (name, fn) => { try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 4).join('\n        ')}`) } }

// the live geometry: the ring top (stone_bricks at y 73) at x 20..28 / z 32 and x 20 / z 26..32; the plank walls at x 21 and
// z 31 for y 73..74; everything else air above y 72, a full floor at y 72 inside
const solid = new Set()
for (let x = 20; x <= 28; x++) { solid.add(`${x},73,32`); solid.add(`${x},73,26`) }
for (let z = 26; z <= 32; z++) { solid.add(`20,73,${z}`); solid.add(`28,73,${z}`) }
for (let x = 21; x <= 27; x++) for (const y of [73, 74]) { solid.add(`${x},${y},31`); solid.add(`${x},${y},27`) }
for (let z = 27; z <= 31; z++) for (const y of [73, 74]) { solid.add(`21,${y},${z}`); solid.add(`27,${y},${z}`) }
const read = (x, y, z) => (y <= 72 || solid.has(`${x},${y},${z}`) ? { name: 'stone_bricks', boundingBox: 'block' } : { name: 'air', boundingBox: 'empty' })

await t('the live corner: 21,74,32 -> 20,74,31 cuts the wall corner; the step goes round by 20,74,32', () => {
  assert.deepStrictEqual(cornerCut({ x: 21, y: 74, z: 32 }, [{ x: 20, y: 74, z: 31 }], read), { i: 0, via: [20, 74, 32] })
  // later in a path: the step before it is walked first
  assert.deepStrictEqual(cornerCut({ x: 23, y: 74, z: 32 }, [{ x: 22, y: 74, z: 32 }, { x: 21, y: 74, z: 32 }, { x: 20, y: 74, z: 31 }, { x: 20, y: 74, z: 30 }], read), { i: 2, via: [20, 74, 32] })
})
await t('the pathfinder\'s own node shape (block centres, x.5 / z.5) and a fractional start are floored to cells', () => {
  assert.deepStrictEqual(cornerCut({ x: 21, y: 74, z: 32 }, [{ x: 20.5, y: 74, z: 31.5 }], read), { i: 0, via: [20, 74, 32] })
  assert.deepStrictEqual(cornerCut({ x: 21.1, y: 74, z: 32.3 }, [{ x: 20.5, y: 74, z: 31.5 }], read), { i: 0, via: [20, 74, 32] })
  const plan = from => (from.join(',') === '21,74,32' ? [{ x: 22.5, y: 74, z: 32.5 }, { x: 21.5, y: 74, z: 32.5 }, { x: 20.5, y: 74, z: 31.5 }] : [{ x: 20.5, y: 74, z: 31.5 }])
  assert.deepStrictEqual(cornerWaypoints([23, 74, 32], [20, 74, 31], f => plan(f.join(',') === '23,74,32' ? [21, 74, 32] : f), read), [[21, 74, 32], [20, 74, 32], [20, 74, 31]])
})
await t('no cut: straight steps; a diagonal with both sides clear; a clear side with no floor is left alone', () => {
  assert.strictEqual(cornerCut({ x: 20, y: 74, z: 32 }, [{ x: 20, y: 74, z: 31 }, { x: 20, y: 74, z: 30 }], read), null)
  const open = () => ({ name: 'air', boundingBox: 'empty' })
  const flat = (x, y, z) => (y <= 70 ? { name: 'stone', boundingBox: 'block' } : open())
  assert.strictEqual(cornerCut({ x: 0, y: 71, z: 0 }, [{ x: 1, y: 71, z: 1 }], flat), null, 'open field diagonal')
  const noFloor = (x, y, z) => (x === 1 && z === 0 && y < 71 ? open() : x === 0 && z === 1 && y >= 71 ? { name: 'stone', boundingBox: 'block' } : flat(x, y, z))
  assert.strictEqual(cornerCut({ x: 0, y: 71, z: 0 }, [{ x: 1, y: 71, z: 1 }], noFloor), null, 'the clear side is a hole')
  assert.strictEqual(cornerCut({ x: 0, y: 71, z: 0 }, [], flat), null)
  assert.strictEqual(cornerCut({ x: 0, y: 71, z: 0 }, null, flat), null)
})
await t('a head-height block on one side is a cut too (the body is 1.8 high)', () => {
  const r = (x, y, z) => (y <= 70 ? { name: 'stone', boundingBox: 'block' } : (x === 1 && z === 0 && y === 72) ? { name: 'oak_planks', boundingBox: 'block' } : { name: 'air', boundingBox: 'empty' })
  assert.deepStrictEqual(cornerCut({ x: 0, y: 71, z: 0 }, [{ x: 1, y: 71, z: 1 }], r), { i: 0, via: [0, 71, 1] })
})
await t('cornerWaypoints: round the corner, then re-planned from the via; no plan -> the goal alone; bounded', () => {
  const plans = []
  const plan = from => { plans.push(from.join(',')); return from.join(',') === '21,74,32' ? [{ x: 20, y: 74, z: 31 }, { x: 20, y: 74, z: 30 }, { x: 20, y: 74, z: 29 }] : [{ x: 20, y: 74, z: 31 }, { x: 20, y: 74, z: 30 }, { x: 20, y: 74, z: 29 }] }
  assert.deepStrictEqual(cornerWaypoints([21, 74, 32], [20, 74, 29], plan, read), [[20, 74, 32], [20, 74, 29]])
  assert.deepStrictEqual(plans, ['21,74,32', '20,74,32'])
  assert.deepStrictEqual(cornerWaypoints([21, 74, 32], [20, 74, 29], () => null, read), [[20, 74, 29]])
  // a plan that always cuts (a world that changed under it) stops after `max` detours, ending at the goal
  const always = () => [{ x: 20, y: 74, z: 31 }]
  const w = cornerWaypoints([21, 74, 32], [20, 74, 31], always, read, 3)
  assert.ok(w.length <= 4 && w.at(-1).join(',') === '20,74,31')
})
await t('WIRED: the build walk plans with cornerWaypoints and walks every leg inside the PATH_MS race', () => {
  const strip = src => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1')
  const src = strip(fs.readFileSync(new URL('../src/buildbot.mjs', import.meta.url), 'utf8'))
  const walk = src.slice(src.indexOf('walkTo: async (s, { avoid = null } = {}) =>'), src.indexOf('hold: async n =>'))
  assert.ok(/optimizePath: false/.test(walk), 'integer nodes asked for')
  assert.ok(/late = true/.test(walk) && /if \(aborted\(\) \|\| late\) return/.test(walk), 'no leg after the clock')
  assert.ok(/legs = cornerWaypoints\(\[Math\.floor\(p\.x\), Math\.floor\(p\.y \+ 1e-6\), Math\.floor\(p\.z\)\], s, plan, read\)/.test(walk), 'planned from the feet')
  assert.ok(/for \(const w of legs\) \{ if \(aborted\(\) \|\| late\) return; await bot\.pathfinder\.goto\(new goals\.GoalBlock\(w\[0\], w\[1\], w\[2\]\)\) \}/.test(walk), 'each leg walked')
  assert.ok(walk.indexOf('Promise.race([') < walk.indexOf('for (const w of legs)') && walk.indexOf('for (const w of legs)') < walk.indexOf('timer = setTimeout'), 'inside the race with the clock')
})

console.log('THE STANDS THAT FAILED (shopwalls-04)')
const R = await import('../src/buildrun.mjs')
const { stepFor } = await import('../src/buildsite.mjs')
await t('the live last roof cell 24,75,31: its stand banned -> the next-best stand; all banned -> none; bans lapse', () => {
  // the roof-edge around it is placed (LIVE 16:00Z: 19 of 20); the ring gap 24,73,32 and the interior 24,73,30 are both nodes
  for (const k of ['23,75,31', '25,75,31']) solid.add(k)
  solid.delete('24,73,32')
  const nodes = new Map([['24,32', [73]], ['24,30', [73]]])
  const home = { x: 0, y: 70, z: 0 }
  const first = stepFor(read, home, [24, 75, 31], nodes)
  assert.ok(first, 'a stand exists')
  const mem = { pending: null, bans: {} }
  R.banStand(mem, '24,75,31', first.stand.join(','), 1000)
  const second = stepFor(read, home, [24, 75, 31], R.nodesWithout(nodes, R.standBans(mem, '24,75,31', 2000)))
  assert.ok(second && second.stand.join(',') !== first.stand.join(','), `another stand (${first.stand} banned, got ${second?.stand})`)
  R.banStand(mem, '24,75,31', second.stand.join(','), 1000)
  assert.strictEqual(stepFor(read, home, [24, 75, 31], R.nodesWithout(nodes, R.standBans(mem, '24,75,31', 2000))), null, 'every stand banned')
  assert.strictEqual(R.standBans(mem, '24,75,31', 1000 + R.STAND_BAN_MS).size, 0, 'the bans lapse')
  assert.strictEqual(R.standBans(mem, '21,75,27', 2000).size, 0, 'per cell')
  assert.strictEqual(R.nodesWithout(nodes, new Set()), nodes, 'nothing banned: the same map')
})
await t('a walk the last visit never finished (the stuck reflex\'s abort) is banned by the next visit; a null memory is inert', () => {
  const mem = { pending: { cell: '24,75,31', stand: '24,73,32', at: 5 }, bans: {} }
  R.settlePendingStand(mem, 10)
  assert.strictEqual(mem.pending, null)
  assert.deepStrictEqual([...R.standBans(mem, '24,75,31', 20)], ['24,73,32'])
  R.settlePendingStand(null, 10); R.banStand(null, 'a', 'b', 1)
  assert.strictEqual(R.standBans(null, 'a', 1).size, 0)
})
await t('WIRED: runVisit settles a pending walk at its start, marks it at the click, bans on a failed arrival, and picks without bans', () => {
  const strip = src => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1')
  const src = strip(fs.readFileSync(new URL('../src/buildrun.mjs', import.meta.url), 'utf8'))
  const visit = src.slice(src.indexOf('export async function runVisit'))
  assert.ok(/const stands = p\.stands \?\? null\s*settlePendingStand\(stands, now\(\)\)/.test(visit))
  assert.ok(/if \(stands\) stands\.pending = \{ cell: kOf\(cell\), stand: kOf\(step\.stand\), at: now\(\) \}\s*await e\.walkTo\(step\.stand, avoid \? \{ avoid \} : undefined\)\s*if \(e\.aborted\(\)\) return 'aborted'\s*if \(stands\) stands\.pending = null/.test(visit))
  assert.ok(/if \(!here\) \{ banStand\(stands, kOf\(cell\), kOf\(step\.stand\), now\(\)\); return 'stand' \}/.test(visit))
  assert.ok(/const bans = standBans\(stands, kOf\(c\.at\), now\(\)\); const kept = bans\.size \? stepFor\(rd, home, c\.at, nodesWithout\(nodes, bans\), domain\) : null; step = kept \?\? stepFor\(rd, home, c\.at, nodes, domain\)/.test(visit), 'banned first, the unbanned pick as the fallback')
  const SK = strip(fs.readFileSync(new URL('../src/skills.mjs', import.meta.url), 'utf8'))
  assert.ok(/stands: \(bot\.shopStands \?\?= \{ pending: null, bans: \{\} \}\)/.test(SK), 'build_shop keeps the memory on the bot')
})

console.log('NOT THROUGH THE SEGMENT\'S OWN OPEN CELLS (shopwalls-06)')
const { pathCrosses } = await import('../src/buildbot.mjs')
await t('pathCrosses: the live route to the interior stand runs up through the open roof cell 24,75,31; the route along the ring does not', () => {
  const avoid = new Set(['24,75,31'])
  // replayed with the pathfinder's own A* on the live region (18:15Z): 23,74,32 -> 24,73,29
  assert.strictEqual(pathCrosses([{ x: 24, y: 75, z: 31 }, { x: 24, y: 73, z: 30 }, { x: 24, y: 73, z: 29 }], avoid), true, 'feet in the cell')
  assert.strictEqual(pathCrosses([{ x: 24.5, y: 74, z: 31.5 }], avoid), true, 'head in the cell (a centred node)')
  assert.strictEqual(pathCrosses([{ x: 22, y: 74, z: 32 }, { x: 23, y: 74, z: 32 }], avoid), false)
  assert.strictEqual(pathCrosses([{ x: 24, y: 75, z: 31 }], new Set()), false, 'nothing to avoid')
  assert.strictEqual(pathCrosses(null, avoid), false)
})
await t('WIRED: the build walk refuses a crossing plan before walking; the click passes the segment\'s open cells; PLAN_MS 150', () => {
  const strip = src => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1')
  const bb = strip(fs.readFileSync(new URL('../src/buildbot.mjs', import.meta.url), 'utf8'))
  const walk = bb.slice(bb.indexOf('walkTo: async (s, { avoid = null } = {}) =>'), bb.indexOf('hold: async n =>'))
  assert.ok(/if \(path && pathCrosses\(path, avoid\)\) crosses = true/.test(walk))
  assert.ok(walk.indexOf('if (crosses) return') > walk.indexOf('legs = cornerWaypoints(') && walk.indexOf('if (crosses) return') < walk.indexOf('for (const w of legs)'), 'refused before any leg')
  assert.ok(/export const PLAN_MS = 150\b/.test(bb))
  const br = strip(fs.readFileSync(new URL('../src/buildrun.mjs', import.meta.url), 'utf8'))
  assert.ok(/await click\(picked\.at, block, step, seg, segGen, \{ closer: CLOSER_SEGS\.has\(seg\), want: b => cellDone\(b, palette, picked\.role\), avoid: fellBack \|\| feetIn \? null : blocking \}\)/.test(br), 'the click passes avoid, except on the all-banned fallback')
  assert.ok(/step = kept \?\? stepFor\(rd, home, c\.at, nodes, domain\); if \(step\) \{ picked = c; fellBack = bans\.size > 0 && !kept; break \}/.test(br), 'fellBack marks the all-banned pick')
})

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
