// DEPOSIT MUST WORK FROM A MINE, NOT JUST FROM THE TOWN SQUARE.
//
// Block 1's defining economic fact: the biggest producer drowned with full
// pockets, repeatedly, and nothing it gathered outlived it. The deposit skill
// existed the whole time -- but findBlock scans 48 blocks, the town chest sits
// at home, and a bot 200 blocks away got "no chest or barrel within 48
// blocks" and learned deposit was useless. The skill's reachability WAS its
// usefulness, and the reachable set was "already at town".
//
// These tests pin the walk-home fallback: far from a chest, deposit travels
// home first (reusing goto's own budget machinery -- visible here as the
// assertNav('goto') call the direct chest approach never makes), rescans, and
// only then gives up.
import assert from 'node:assert'

process.env.LOG_DIR = '/tmp/mcbot-test-logs-deposit'
process.env.BOT_NAME = 'TestBot'
process.env.HOME_X = '28'; process.env.HOME_Y = '79'; process.env.HOME_Z = '0'
const { SKILLS, SKILL_CONTRACTS } = await import('../src/skills.mjs')

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) }
  catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) }
}

const V = (x, y, z) => ({ x, y, z, offset: (a,b,c) => V(x+a,y+b,z+c),
                          distanceTo: o => Math.hypot(x-o.x,y-o.y,z-o.z), clone: () => V(x,y,z) })

function depositBot({ chestVisible, chestVisibleAfterWalk, items }) {
  const chestBlock = { position: V(30, 79, 0), type: 1 }
  const deposited = []
  const navAsserts = []
  let atHome = false
  const bot = {
    entity: { position: V(200, 62, 200), onGround: true, velocity: V(0, 0, 0) },
    health: 20, food: 20,
    version: '1.21.8',
    registry: { blocks: { 1: { name: 'chest' } }, blocksByName: {}, itemsByName: {} },
    inventory: { items: () => items },
    assertNav: (who) => navAsserts.push(who),
    findBlock: () => (chestVisible || (atHome && chestVisibleAfterWalk)) ? chestBlock : null,
    blockAt: () => ({ name: 'grass_block', boundingBox: 'block' }),
    pathfinder: {
      movements: {},
      setMovements() {}, setGoal() {}, stop() {},
      goto: async () => { atHome = true; bot.entity.position = V(28, 79, 0) },
    },
    openContainer: async () => ({
      deposit: async (type, _m, count) => deposited.push(count),
      close: () => {},
    }),
    on: () => {}, off: () => {}, once: () => {}, removeListener: () => {},
    waitForTicks: async () => {},
    chat() {},
  }
  return { bot, deposited, walkedHome: () => navAsserts.includes('goto') }
}

const run = (bot) => SKILLS.deposit.run({ bot }, {}, new AbortController().signal)

await t('far from any chest, deposit walks home and then deposits', async () => {
  const { bot, deposited, walkedHome } =
    depositBot({ chestVisible: false, chestVisibleAfterWalk: true, items: [{ type: 5, name: 'oak_log', count: 12 }] })
  const r = await run(bot)
  assert.equal(walkedHome(), true, `should travel home first; got ${JSON.stringify(r)}`)
  assert.equal(r.status, 'success', r.detail)
  assert.deepEqual(deposited, [12])
})

await t('chest already nearby: no walk-home, straight deposit', async () => {
  const { bot, deposited, walkedHome } =
    depositBot({ chestVisible: true, chestVisibleAfterWalk: true, items: [{ type: 5, name: 'oak_log', count: 3 }] })
  const r = await run(bot)
  assert.equal(walkedHome(), false, 'no goto-home when a chest is in range')
  assert.equal(r.status, 'success', r.detail)
  assert.deepEqual(deposited, [3])
})

await t('no chest even at home: fails with nothing_found, not a lie', async () => {
  const { bot } = depositBot({ chestVisible: false, chestVisibleAfterWalk: false, items: [] })
  const r = await run(bot)
  assert.equal(r.status, 'failed')
  assert.equal(r.failClass, 'nothing_found')
  assert.match(r.detail, /even at home/)
})

await t('contract budget covers the walk (travel skill, not a 60s errand)', () => {
  assert.ok(SKILL_CONTRACTS.deposit.maxMs >= 240_000,
    `deposit.maxMs=${SKILL_CONTRACTS.deposit.maxMs} cannot fit goto-home plus the transfer`)
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
