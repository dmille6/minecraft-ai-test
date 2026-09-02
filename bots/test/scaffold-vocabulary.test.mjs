/**
 * ONE REGEX, TWO QUESTIONS, AND THE WRONG ANSWER TO THE SECOND ONE.
 *
 * `harvestAdjacent` is the last thing a marooned bot can do for itself: dig a
 * neighbour, hold the drop, pillar out. Measured over a full walk of the fleet
 * logs -- 75 files carrying self-sourcing records, 37,392 failures and 150
 * successes parsed -- it succeeds 150 of 37,542 times. 0.4%.
 *
 *     tried=0    20.5%    nothing adjacent was even in the vocabulary
 *     tried=8    71.6%    all eight placeable, none harvestable bare-handed
 *
 *     by depth               tried=0   tried>=6
 *       y>=63 (surface)       92.3%      5.5%
 *       y 0-39                 0.2%     98.4%
 *
 * The two buckets are distinguishable because `tried++` sits between the
 * PLACEABLE test and the canHarvest test. This file is about the FIRST bucket,
 * the surface one, which is a vocabulary defect and nothing else. The second
 * bucket is stone with no pickaxe and no widening can touch it.
 *
 * Two independent gaps produce it, and on flat ground NEITHER fix works alone:
 *
 *   1. grass_block breaks bare-handed and DROPS DIRT, which is the first entry
 *      in PLACEABLE -- but grass_block itself is not in PLACEABLE, so it was
 *      skipped without a swing.
 *   2. HARVEST_OFFSETS never looked below the feet, and on flat ground the only
 *      solid blocks near a standing bot are at foot-1 level.
 *
 * The trap one layer down, which is what most of this file is about: a
 * candidate is only useful if what it DROPS is placeable. clay drops clay_ball
 * and snow_block drops snowball -- ITEMS. mud, packed_mud and moss_block drop
 * themselves and are not placeable by this bot. Digging for those is the same
 * bug in a smaller font: the bot pays the swing and receives something it
 * cannot stack under its feet.
 *
 * So the set is DERIVED from minecraft-data rather than listed, and this file
 * checks the derivation against the vendored data for both protocol versions
 * the fleet has run.
 */
import assert from 'node:assert'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import mcdata from 'minecraft-data'
import { scaffoldCandidate, harvestAdjacent } from '../src/reflex.mjs'
import { harvestSafe } from '../src/scaffold.mjs'
import { dropsOf } from '../src/drops.mjs'

let pass = 0, fail = 0
const t = (name, fn) => Promise.resolve()
  .then(fn)
  .then(() => { pass++; console.log(`  PASS  ${name}`) })
  .catch(e => { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) })

const REFLEX_PATH = new URL('../src/reflex.mjs', import.meta.url)

// VERBATIM from climb-escape.test.mjs:447-458. It writes a separate module and
// never touches src/, which matters more than style here: run-tests.mjs kills a
// slow file with an uncatchable SIGKILL, so a patch that mutates src/ in place
// can leave corrupted source on disk -- and fleet-recycle restarts every bot
// onto $H/src every six hours.
async function withMutant (path, old, neu, fn) {
  const src = readFileSync(path, 'utf8')
  assert.ok(src.includes(old),
    `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 60))} is not in ${path.pathname}. ` +
    'A mutant that was never written reads as killed.')
  assert.ok(src.split(old).length === 2, 'the mutation target is not unique; the mutant is ambiguous')
  // test/ is one level under bots/, so './x.mjs' has to become '../src/x.mjs'.
  const body = src.replace(old, neu).replace(/from '\.\//g, "from '../src/")
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, body)
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}

// --- the fixture ------------------------------------------------------------

const V = (x, y, z) => ({ x, y, z, offset: (a, b, c) => V(x + a, y + b, z + c) })

const BARE_HANDED = /^(dirt|coarse_dirt|rooted_dirt|grass_block|podzol|mycelium|dirt_path|farmland|sand|red_sand|gravel|clay|snow_block|mud|moss_block|warped_nylium|crimson_nylium)$/

/**
 * A bot at y=64 whose world is a function of the offset from its feet.
 * Digging yields the block's DROP, not the block -- which is the entire point;
 * a fixture that hands back the block name would hide the clay_ball bug.
 */
function bot ({ world = () => null, registry = mcdata('1.21.8'), tool = null } = {}) {
  const inv = []
  if (tool) inv.push({ name: tool, type: 101, count: 1 })
  const dug = []
  return {
    dug, inv, registry,
    entity: { position: V(0, 64, 0) },
    heldItem: tool ? { name: tool, type: 101 } : null,
    inventory: { items: () => inv },
    blockAt (p) {
      const name = world(p.x, p.y - 64, p.z)
      if (!name) return { name: 'air', boundingBox: 'empty' }
      // Liquids have an EMPTY boundingBox. A fixture that hands lava back as a
      // solid would be caught by the `boundingBox !== 'block'` guard and the
      // lava tests below would pass without the guard they exist to prove.
      if (name === 'lava' || name === 'water') return { name, boundingBox: 'empty', position: p }
      return {
        name, boundingBox: 'block', position: p,
        canHarvest: type => (BARE_HANDED.test(name) ? true : type === 101),
        digTime: () => 100,
      }
    },
    async equip (item) { this.heldItem = item },
    async dig (block) {
      dug.push(`${block.position.x},${block.position.y - 64},${block.position.z}`)
      for (const drop of dropsOf(registry, block.name)) inv.push({ name: drop, type: 1, count: 1 })
    },
    stopDigging () {}, clearControlStates () {},
    pathfinder: { setGoal () {} },
  }
}

/** Flat ground: solid at foot-1 and below, air at and above the feet. */
const flat = name => (x, dy, z) => (dy <= -1 ? name : null)

// --- the derivation, against the vendored data ------------------------------

for (const version of ['1.21.8', '1.21.11']) {
  const reg = mcdata(version)

  await t(`${version}: POSITIVE CONTROL — the drop query can see drops at all`, () => {
    // Every exclusion below is a NEGATIVE claim about a block. Before making
    // one, show the same query returning a presence: if dropsOf answered a
    // uniform "itself" for everything, every exclusion here would pass for the
    // wrong reason and the whole file would be theatre.
    assert.deepEqual(dropsOf(reg, 'stone'), ['cobblestone'], 'the query cannot see a renamed drop')
    assert.deepEqual(dropsOf(reg, 'grass_block'), ['dirt'], 'the query cannot see the case this fix is for')
    assert.deepEqual(dropsOf(reg, 'clay'), ['clay_ball'], 'the query cannot see an ITEM drop')
    assert.notDeepEqual(dropsOf(reg, 'clay'), ['clay'], 'the query is answering with the block name')
  })

  await t(`${version}: the five blocks that drop dirt or netherrack are now candidates`, () => {
    for (const name of ['grass_block', 'podzol', 'mycelium', 'dirt_path', 'farmland']) {
      assert.deepEqual(dropsOf(reg, name), ['dirt'], `${name} no longer drops dirt in ${version}`)
      assert.equal(scaffoldCandidate(name, reg), true, `${name} is still being skipped`)
    }
    for (const name of ['warped_nylium', 'crimson_nylium']) {
      assert.deepEqual(dropsOf(reg, name), ['netherrack'])
      assert.equal(scaffoldCandidate(name, reg), true)
    }
  })

  await t(`${version}: THE TRAP — a block whose drop is an ITEM is not a candidate`, () => {
    // Getting this wrong makes the bot dig for scaffold and receive something
    // it cannot place. Same class of bug, one layer down.
    for (const [name, drop] of [['clay', 'clay_ball'], ['snow_block', 'snowball']]) {
      assert.deepEqual(dropsOf(reg, name), [drop], `${name} drop table moved`)
      assert.equal(scaffoldCandidate(name, reg), false, `${name} yields an item, not a block`)
    }
  })

  await t(`${version}: a block that drops ITSELF but is not placeable is not a candidate`, () => {
    for (const name of ['mud', 'packed_mud', 'moss_block']) {
      assert.deepEqual(dropsOf(reg, name), [name], `${name} drop table moved`)
      assert.equal(scaffoldCandidate(name, reg), false,
        `${name} drops ${name}, which pillarOut will not place — the dig is wasted`)
    }
    // snow drops nothing modelled, so dropsOf falls back to its own name. That
    // fallback must not become an accidental admission.
    assert.equal(scaffoldCandidate('snow', reg), false)
  })

  await t(`${version}: what was already placeable is still a candidate`, () => {
    for (const name of ['dirt', 'cobblestone', 'stone', 'gravel', 'sand', 'oak_log',
                        'deepslate', 'cobbled_deepslate', 'netherrack']) {
      assert.equal(scaffoldCandidate(name, reg), true, `${name} regressed out of the dig set`)
    }
  })

  await t(`${version}: the whole derived set is exactly seven blocks, and it is small`, () => {
    // The real assertion is that widening the vocabulary did NOT quietly admit
    // half the block registry. A hand-written list cannot make this claim.
    const added = Object.keys(reg.blocksByName)
      .filter(n => scaffoldCandidate(n, reg) && !scaffoldCandidate(n, null))
      .sort()
    assert.deepEqual(added, ['crimson_nylium', 'dirt_path', 'farmland', 'grass_block',
                             'mycelium', 'podzol', 'warped_nylium'],
      `the derived set changed in ${version}: ${added.join(' ')}`)
  })
}

await t('with no registry it degrades to the OLD behaviour, not to a wider one', () => {
  // A silent no-op is survivable. A silent widening is the clay bug shipping
  // itself the day bot.registry is undefined.
  assert.equal(scaffoldCandidate('grass_block', null), false)
  assert.equal(scaffoldCandidate('clay', null), false)
  assert.equal(scaffoldCandidate('dirt', null), true)
  assert.equal(scaffoldCandidate('', null), false)
  assert.equal(scaffoldCandidate(null, null), false)
})

// --- behaviour: the bot on flat grass ---------------------------------------

await t('A BOT STANDING ON FLAT GRASS SOURCES ITS OWN SCAFFOLD', () => {
  // This is the 92.3% case. Nothing at foot or head level in any direction;
  // grass_block underneath and all around, one level down.
  return harvestAdjacent(bot({ world: flat('grass_block') }), 2, 8000).then(r => {
    assert.ok(r.tried > 0, `tried=${r.tried}: the neighbours are still not in the vocabulary`)
    assert.ok(r.dug >= 2, `dug=${r.dug}`)
    assert.ok(r.gained >= 2, `gained=${r.gained}: the drops are not placeable`)
  })
})

await t('BOTH HALVES ARE REQUIRED — vocabulary alone does nothing on flat ground', async () => {
  // Kills the temptation to ship only the regex change: with the old eight
  // offsets there is nothing at foot or head level to test the vocabulary on.
  const OLD_OFFSETS = `const HARVEST_OFFSETS = [
  [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1],
  [1, 1, 0], [-1, 1, 0], [0, 1, 1], [0, 1, -1],
  [1, -1, 0], [-1, -1, 0], [0, -1, 1], [0, -1, -1],
]`
  const NO_BELOW = `const HARVEST_OFFSETS = [
  [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1],
  [1, 1, 0], [-1, 1, 0], [0, 1, 1], [0, 1, -1],
]`
  await withMutant(REFLEX_PATH, OLD_OFFSETS, NO_BELOW, async mod => {
    const r = await mod.harvestAdjacent(bot({ world: flat('grass_block') }), 2, 8000)
    assert.equal(r.tried, 0, 'the mutant found something; this test no longer isolates the offsets')
    assert.equal(r.gained, 0)
  })
})

await t('a bot in a dirt-walled pit still works — the old path is untouched', async () => {
  const walls = (x, dy, z) => (dy === 0 && (Math.abs(x) === 1 || Math.abs(z) === 1) ? 'dirt' : null)
  const r = await harvestAdjacent(bot({ world: walls }), 2, 8000)
  assert.ok(r.gained >= 2, `gained=${r.gained}`)
})

await t('A CLAY PIT IS STILL REFUSED — the bot does not dig for an item', async () => {
  // clay breaks bare-handed, so nothing but the drop check stands between the
  // bot and four clay_balls it cannot place.
  const b = bot({ world: flat('clay') })
  const r = await harvestAdjacent(b, 2, 8000)
  assert.equal(r.tried, 0, `tried=${r.tried}: clay entered the vocabulary`)
  assert.equal(r.dug, 0)
  assert.ok(!b.inv.some(i => i.name === 'clay_ball'), 'the bot is holding clay_ball')
})

await t('A SNOW FIELD IS STILL REFUSED', async () => {
  const b = bot({ world: flat('snow_block') })
  const r = await harvestAdjacent(b, 2, 8000)
  assert.equal(r.tried, 0, `tried=${r.tried}`)
  assert.ok(!b.inv.some(i => i.name === 'snowball'))
})

await t('IT NEVER DIGS THE BLOCK IT IS STANDING ON', async () => {
  // pillarOut places against blockAt(offset(0,-1,0)) and gives up with
  // `if (!below) break`. Digging the floor deletes what the next step needs,
  // and drops the bot -- trading the one thing a marooned bot is short of.
  const onlyUnderfoot = (x, dy, z) => (x === 0 && dy === -1 && z === 0 ? 'grass_block' : null)
  const b = bot({ world: onlyUnderfoot })
  const r = await harvestAdjacent(b, 2, 8000)
  assert.equal(r.tried, 0, `tried=${r.tried}: something reached the block underfoot`)
  assert.deepEqual(b.dug, [], `dug ${b.dug.join(' ')}`)
})

await t('IT NEVER DIGS THE CEILING — that column is pillarOut\'s escape route', async () => {
  const onlyAbove = (x, dy, z) => (x === 0 && z === 0 && dy >= 2 ? 'dirt' : null)
  const b = bot({ world: onlyAbove })
  const r = await harvestAdjacent(b, 2, 8000)
  assert.equal(r.tried, 0)
  assert.deepEqual(b.dug, [])
})

await t('stone underground is still refused bare-handed — no widening reaches it', async () => {
  // The other 79.5% of failures. Stated here so the scope of this fix is a
  // tested fact rather than a claim in a commit message.
  const b = bot({ world: flat('stone') })
  const r = await harvestAdjacent(b, 2, 8000)
  assert.ok(r.tried > 0, 'stone should be tried — it IS placeable')
  assert.equal(r.dug, 0, 'bare-handed stone drops nothing; digging it only widens the pit')
})

// --- the lava guard on the four new cells -----------------------------------

await t('harvestSafe: POSITIVE CONTROL — an ordinary below-level cell is allowed', () => {
  // Every refusal below is a negative claim. If this predicate refused
  // everything, all of them would pass for the wrong reason.
  const solid = { name: 'grass_block', boundingBox: 'block' }
  const at = () => solid
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    assert.equal(harvestSafe({ at, dx, dy: -1, dz }), null)
  }
})

await t('harvestSafe: lava on ANY of the six faces refuses the cell', () => {
  const FACES = [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0], [0, -1, 0]]
  for (const [nx, ny, nz] of FACES) {
    const at = (a, c, d) => (a === 1 + nx && c === -1 + ny && d === nz
      ? { name: 'lava', boundingBox: 'empty' }
      : { name: 'grass_block', boundingBox: 'block' })
    const risk = harvestSafe({ at, dx: 1, dy: -1, dz: 0 })
    assert.ok(risk, `lava at face ${nx},${ny},${nz} was allowed`)
    assert.ok(/lava/.test(risk), risk)
  }
})

await t('harvestSafe: WATER DOES NOT REFUSE — the 99.1% opinion is not repeated', () => {
  // dryColumnStep's asymmetry, verbatim: water beside your feet is harmless,
  // and believing otherwise refused 561 of 566 pillar attempts. A liquid
  // predicate here would be the kelp widening again.
  const at = (a, c, d) => (a === 2 && c === -1 && d === 0
    ? { name: 'water', boundingBox: 'empty' }
    : { name: 'grass_block', boundingBox: 'block' })
  assert.equal(harvestSafe({ at, dx: 1, dy: -1, dz: 0 }), null)
  // ...and flowing lava still does, by name.
  const lav = (a, c, d) => (a === 2 && c === -1 && d === 0
    ? { name: 'flowing_lava', boundingBox: 'empty' }
    : { name: 'grass_block', boundingBox: 'block' })
  assert.ok(harvestSafe({ at: lav, dx: 1, dy: -1, dz: 0 }))
})

await t('BEHAVIOUR: lava behind a diagonal-down candidate stops that dig', async () => {
  // Flat grass, with lava sitting behind the +x below-level neighbour.
  const world = (x, dy, z) => {
    if (x === 2 && dy === -1 && z === 0) return 'lava'
    return dy <= -1 ? 'grass_block' : null
  }
  const b = bot({ world })
  const r = await harvestAdjacent(b, 4, 8000)
  assert.equal(r.unsafe, 1, `unsafe=${r.unsafe}: the lava cell was not refused`)
  assert.ok(!b.dug.includes('1,-1,0'), `dug the lava-adjacent cell: ${b.dug.join(' ')}`)
  // AND IT IS NOT A BLANKET REFUSAL. The other three below-level cells are
  // still taken -- a guard that stopped the whole routine would re-create the
  // trap this patch exists to remove.
  assert.ok(r.dug >= 3, `dug=${r.dug}: the safe cells were refused too`)
})

await t('a lava refusal is NOT counted as a vocabulary miss', () => {
  // `tried` is the number this whole fix was diagnosed from: tried=0 means the
  // vocabulary, tried>=6 means the tool. A safety refusal contaminating it
  // would blind the next person reading the same telemetry.
  const world = (x, dy, z) => {
    if (x === 2 && dy === -1 && z === 0) return 'lava'
    return (x === 1 && dy === -1 && z === 0) ? 'grass_block' : null
  }
  return harvestAdjacent(bot({ world }), 4, 8000).then(r => {
    assert.equal(r.tried, 0, `tried=${r.tried}: the refused cell was counted as tried`)
    assert.equal(r.unsafe, 1)
    assert.equal(r.dug, 0)
  })
})

await t('THE GUARD IS SCOPED TO THE FOUR NEW CELLS — foot and head are untouched', async () => {
  // The eight original offsets have shipped for weeks. Guarding them would
  // change behaviour this patch was not asked to change, and an over-strict
  // guard on the pillar path is how 561 of 566 attempts were refused once.
  const wallsWithLavaBehind = (x, dy, z) => {
    if (x === 2 && dy === 0 && z === 0) return 'lava'      // behind the +x WALL
    return (dy === 0 && x === 1 && z === 0) ? 'dirt' : null
  }
  const b = bot({ world: wallsWithLavaBehind })
  const r = await harvestAdjacent(b, 1, 8000)
  assert.equal(r.unsafe, 0, 'a foot-level offset was put through the guard')
  assert.equal(r.dug, 1, `dug=${r.dug}: the pre-existing foot-level behaviour changed`)
})

// --- mutants ----------------------------------------------------------------

await t('MUTANT KILLED: line 2067 back on PLACEABLE — flat grass finds nothing', async () => {
  await withMutant(REFLEX_PATH,
    'if (!b || b.boundingBox !== \'block\' || !scaffoldCandidate(b.name, bot.registry)) continue',
    'if (!b || b.boundingBox !== \'block\' || !PLACEABLE.test(b.name)) continue',
    async mod => {
      const r = await mod.harvestAdjacent(bot({ world: flat('grass_block') }), 2, 8000)
      assert.equal(r.tried, 0, 'the reverted vocabulary still found a candidate')
      assert.equal(r.gained, 0)
    })
})

await t('MUTANT KILLED: drop the drop-check — the bot digs clay for clay_balls', async () => {
  await withMutant(REFLEX_PATH,
    '  return drops.length > 0 && drops.every(n => PLACEABLE.test(n))',
    '  return drops.length > 0',
    async mod => {
      const b = bot({ world: flat('clay') })
      await mod.harvestAdjacent(b, 2, 8000)
      assert.ok(b.inv.some(i => i.name === 'clay_ball'),
        'the mutant did not reach the clay; this test is not exercising the drop check')
    })
})

await t('MUTANT KILLED: adding [0,-1,0] — the bot digs its own floor out', async () => {
  await withMutant(REFLEX_PATH,
    '  [1, -1, 0], [-1, -1, 0], [0, -1, 1], [0, -1, -1],',
    '  [0, -1, 0], [1, -1, 0], [-1, -1, 0], [0, -1, 1], [0, -1, -1],',
    async mod => {
      const onlyUnderfoot = (x, dy, z) => (x === 0 && dy === -1 && z === 0 ? 'grass_block' : null)
      const b = bot({ world: onlyUnderfoot })
      await mod.harvestAdjacent(b, 2, 8000)
      assert.deepEqual(b.dug, ['0,-1,0'],
        'the mutant did not dig underfoot; the floor test is not proving what it claims')
    })
})

await t('MUTANT KILLED: remove the lava guard — the bot digs beside lava', async () => {
  await withMutant(REFLEX_PATH,
    '    if (dy < 0) {\n      const risk = harvestSafe({',
    '    if (false) {\n      const risk = harvestSafe({',
    async mod => {
      const world = (x, dy, z) => {
        if (x === 2 && dy === -1 && z === 0) return 'lava'
        return dy <= -1 ? 'grass_block' : null
      }
      const b = bot({ world })
      const r = await mod.harvestAdjacent(b, 4, 8000)
      assert.equal(r.unsafe, 0, 'the mutant still refused; the guard test proves nothing')
      assert.ok(b.dug.includes('1,-1,0'),
        `the mutant did not reach the lava-adjacent cell: ${b.dug.join(' ')}`)
    })
})

await t('MUTANT KILLED: guard on lava only, not liquid — water must still be dug', async () => {
  // The inverse mistake, and the more expensive one historically. If someone
  // widens isLava into a liquid test, a bot beside harmless water stops
  // self-sourcing -- the exact shape that refused 99.1% of pillar attempts.
  await withMutant(new URL('../src/scaffold.mjs', import.meta.url),
    '  isLava = b => /lava/.test(b?.name ?? \'\'),\n} = {}) {\n  const here = at(dx, dy, dz)',
    '  isLava = b => /lava|water/.test(b?.name ?? \'\'),\n} = {}) {\n  const here = at(dx, dy, dz)',
    async mod => {
      const at = (a, c, d) => (a === 2 && c === -1 && d === 0
        ? { name: 'water', boundingBox: 'empty' }
        : { name: 'grass_block', boundingBox: 'block' })
      assert.ok(mod.harvestSafe({ at, dx: 1, dy: -1, dz: 0 }),
        'the mutant did not widen the predicate; the water test proves nothing')
    })
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
