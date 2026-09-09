// THE BLOCK UNDER THE BOT'S OWN FEET WAS NEVER PROBED.
//
// place() searched eight horizontal offsets across three heights -- 24 cells --
// and [0,0] was not among them. So a bot standing on a narrow perch (a mountain
// spine, a one-wide pillar, a peak) found nothing solid anywhere and reported
// "no solid block with a free space above it" while standing on solid ground.
//
// Measured on the fleet: 83 refusals reading `no_support=24 [air]`, ALL at full
// health with y unchanged on both sides, so not one of them was falling --
// which is what I assumed for most of a day. board-a-Bravo produced 44 of them
// and had failed all 57 of its place attempts, every one a crafting_table.
// That single unprobed cell was holding it off the tech tree.
//
// The remedy is what a player does there: build off the SIDE of the block you
// are standing on. That needs placeBlock(ref, face) with a horizontal face, and
// the old top-face-only candidate list could not express it.
import assert from 'node:assert'
import test from 'node:test'
import { Vec3 } from 'vec3'

process.env.OLLAMA_MODEL ??= 'qwen2.5:7b-instruct'
const { SKILLS } = await import('../src/skills.mjs')

/** A bot on a one-block perch: solid directly underfoot, air in every direction. */
function perchedBot ({ underfootSolid = true, floorBelow = false } = {}) {
  const feet = new Vec3(100, 200, 100)
  const calls = []
  return {
    calls,
    entity: { position: feet, onGround: true },
    inventory: { items: () => [{ name: 'crafting_table', count: 1, type: 7 }] },
    blockAt (p) {
      if (!p) return null
      // `floorBelow` is a REAL floor at foot level, not a distant one: the
      // neighbour search only looks at dy of -1, 0 and -2, so a floor four
      // blocks down is invisible to it and would fake a perch by accident.
      const solidHere =
        (floorBelow && p.y === feet.y - 1) ||
        (underfootSolid && p.x === feet.x && p.y === feet.y - 1 && p.z === feet.z)
      return solidHere
        ? { name: 'stone', position: p.clone(), boundingBox: 'block' }
        : { name: 'air', position: p.clone(), boundingBox: 'empty' }
    },
    async equip () {},
    async lookAt () {},
    async placeBlock (ref, face) { calls.push({ ref: ref.position.clone(), face: face.clone() }) },
  }
}
const run = bot => SKILLS.place.run({ bot }, { item: 'crafting_table' }, { aborted: false })

test('a bot on a one-block perch can still put a table down', async () => {
  const bot = perchedBot()
  // Make the read-back see the block once it has been "placed".
  const raw = bot.blockAt.bind(bot)
  bot.blockAt = p => {
    const hit = bot.calls.find(c => {
      const t = c.ref.plus(c.face)
      return p && t.x === p.x && t.y === p.y && t.z === p.z
    })
    return hit ? { name: 'crafting_table', position: p, boundingBox: 'block' } : raw(p)
  }
  const r = await run(bot)
  assert.equal(r.status, 'success', `perched bot should place, got: ${r.detail}`)
  assert.ok(bot.calls.length, 'placeBlock was actually called')
  const { ref, face } = bot.calls[0]
  assert.deepEqual({ x: ref.x, y: ref.y, z: ref.z }, { x: 100, y: 199, z: 100 },
    'it builds off the block under its own feet')
  assert.equal(face.y, 0, 'using a SIDE face — the top face is where the bot is standing')
  assert.ok(Math.abs(face.x) + Math.abs(face.z) === 1, 'exactly one horizontal step')
})

test('with nothing underfoot either, it still refuses', async () => {
  // The fallback must not invent support. A bot genuinely in open air has no
  // reference block and must still fail rather than place into nothing.
  const bot = perchedBot({ underfootSolid: false })
  const r = await run(bot)
  assert.equal(r.status, 'failed', 'no reference block means no placement')
  assert.equal(bot.calls.length, 0, 'and placeBlock is never attempted')
})

test('an ordinary bot on open ground still uses a neighbour, not the fallback', async () => {
  // The fallback is a LAST resort; it must not pre-empt the normal path, or
  // every table ends up jammed against the bot's own feet.
  const bot = perchedBot({ underfootSolid: true, floorBelow: true })
  const raw = bot.blockAt.bind(bot)
  bot.blockAt = p => {
    const hit = bot.calls.find(c => {
      const t = c.ref.plus(c.face)
      return p && t.x === p.x && t.y === p.y && t.z === p.z
    })
    return hit ? { name: 'crafting_table', position: p, boundingBox: 'block' } : raw(p)
  }
  const r = await run(bot)
  assert.equal(r.status, 'success')
  assert.equal(bot.calls[0].face.y, 1,
    'a normal surface bot places on TOP of a neighbouring block, as before')
})
