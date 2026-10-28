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
  const walk = src.slice(src.indexOf('walkTo: async s =>'), src.indexOf('hold: async n =>'))
  assert.ok(/legs = cornerWaypoints\(\[Math\.floor\(p\.x\), Math\.floor\(p\.y \+ 1e-6\), Math\.floor\(p\.z\)\], s, plan, read\)/.test(walk), 'planned from the feet')
  assert.ok(/for \(const w of legs\) \{ if \(aborted\(\)\) return; await bot\.pathfinder\.goto\(new goals\.GoalBlock\(w\[0\], w\[1\], w\[2\]\)\) \}/.test(walk), 'each leg walked')
  assert.ok(walk.indexOf('Promise.race([') < walk.indexOf('for (const w of legs)') && walk.indexOf('for (const w of legs)') < walk.indexOf('timer = setTimeout'), 'inside the race with the clock')
})

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
