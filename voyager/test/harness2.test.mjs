// voyager-01 HARNESS 2 (11-12): the proposer's whole-library summary and plain-sentence rule, one-skill-per-outcome
// retrieval, the cut-off reply path, the cache split, and one arm with two models. Harness 1 is PINNED here: stages 3, 3b
// and 4 are compared on it, so its prompts must not move by a byte.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { CURRICULUM_SYSTEM, CODER_SYSTEM, curriculumUser, coderUser, CURRICULUM_SYSTEM_V2, CODER_SYSTEM_V2, CURRICULUM_FORMAT,
  curriculumUserV2, coderUserV2, describeOutcome, abilitySummary, ABILITY_IDS_PER_KIND, promptSet } from '../src/prompts.mjs'
import { checkTask, plainTask, TASK_MAX_CHARS, KINDS, outcomeSignature, swordRefusal, noteOutcome, setAside, repeatRefusal, repeatExempt, REPEAT_FAILS, REPEAT_REST } from '../src/verifier.mjs'
import { Library, pickRelated, reliability, similarity } from '../src/library.mjs'
import { VoyagerLoop } from '../src/loop.mjs'
import { chat } from '../src/llmclient.mjs'
import { Vec3 } from '../src/facade.mjs'

process.env.VOYAGER_PROXY_NO_LISTEN = '1'
const { armFor, userContent, reserveUsd, usageUsd } = await import('../proxy/proxy.mjs')

const sha = s => crypto.createHash('sha256').update(s).digest('hex')
const here = path.dirname(new URL(import.meta.url).pathname)
const stripComments = src => src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n')

// One fixed input for the pinned prompts.
const FIX = {
  state: { pos: { x: 1, y: 64, z: -2 }, health: 20, food: 18, biome: 'plains', day: true, inventory: { oak_log: 3, dirt: 12 }, holding: 'stone_axe', blocks: { grass_block: 40, oak_log: 6 }, nearby: { cow: 2 } },
  skills: [{ name: 'getWood', description: 'collect oak logs' }],
  task: { task: 'craft a lantern', success: { kind: 'craft', item: 'lantern' } },
  related: [{ name: 'getWood', description: 'collect oak logs', code: 'async function getWood(bot) { await bot.mine("oak_log", 3) }' }],
  previous: { round: 1, code: 'x', outcome: 'o', log: ['l1'], delta: 'd' },
}
// sha256 of the harness-1 prompts at origin/main 36ddd1508, computed from THAT tree on ci2 (11-12), not from this branch.
// voyager/src and voyager/proxy there are identical to 4482bc8b, the code the 3b arms run (git diff: empty).
const GOLD = {
  CURRICULUM_SYSTEM: 'ce5fd2d62f2c58539cd1939dabbdd69ba854c6fa0cba71498f957b231869b109',
  CODER_SYSTEM: '993035baf18ed8d539923ea7a51a193caa89ddd09b7aeffd4ab87d658213c54f',
  curriculumUser: 'd83ac9f1f1b20c423a3394fdac8332fe4c06b06dfc5834e5486d7643f3d1c5c6',
  coderUser: '3e68ae919c1aca3a42a306564f583f2c511e7b47c9a82e74df422f155dc46f79',
}
const actualV1 = () => ({
  CURRICULUM_SYSTEM: sha(CURRICULUM_SYSTEM),
  CODER_SYSTEM: sha(CODER_SYSTEM),
  curriculumUser: sha(curriculumUser({ state: FIX.state, skills: FIX.skills, done: ['a (skill x)'], failed: ['b -- why'], refusal: 'no' })),
  coderUser: sha(coderUser({ task: FIX.task, state: FIX.state, related: FIX.related, previous: FIX.previous })),
})
if (process.env.VOYAGER_PRINT_GOLD === '1') console.log('GOLD ' + JSON.stringify(actualV1()))

test('harness 1 is pinned: its prompts are byte-identical to the stage 3 / 3b harness', () => {
  assert.deepEqual(actualV1(), GOLD)
  for (const h of [1, undefined, null, '1', 0, 'x', NaN]) {
    const p = promptSet(h)
    assert.equal(p.version, 1)
    assert.equal(p.curriculumSystem, CURRICULUM_SYSTEM)
    assert.equal(p.coderSystem, CODER_SYSTEM)
    assert.deepEqual([p.curriculumMaxTokens, p.codeMaxTokens], [700, 4000])
  }
  for (const h of [2, '2', 3]) {
    const p = promptSet(h)
    assert.equal(p.version, 2)
    assert.equal(p.curriculumSystem, CURRICULUM_SYSTEM_V2)
    assert.equal(p.coderSystem, CODER_SYSTEM_V2)
    assert.ok(p.curriculumMaxTokens >= 2000 && p.codeMaxTokens >= 8000)
  }
})

test('the switch is wired: the entry reads VOYAGER_HARNESS, setup renders it from the 5th registry column, default 1', () => {
  const entry = stripComments(fs.readFileSync(path.join(here, '../src/entry.mjs'), 'utf8'))
  assert.match(entry, /harness: Number\(env\.VOYAGER_HARNESS\) >= 2 \? 2 : 1/)
  assert.equal(fs.readFileSync(path.join(here, '../infra/bot.env.tmpl'), 'utf8').split('\n').filter(l => l === 'VOYAGER_HARNESS=__HARNESS__').length, 1)
  const setup = fs.readFileSync(path.join(here, '../infra/setup.sh'), 'utf8').split('\n').filter(l => !/^\s*#/.test(l)).join('\n')
  assert.match(setup, /H="\$\(field \$a 5\)"; \[ "\$H" = 2 \] \|\| H=1/)
  assert.match(setup, /-e "s\/__HARNESS__\/\$H\/"/)
  // a harness 2 arm's proxy entry is created with a reply cap above the 10,000 tokens the loop asks for (else the proxy
  // clamps it back to 4,096 and the cut-offs return without a word), and outside 3b's spend group
  const h2Entry = /if model\.startswith\("claude-"\) and h2:\n(?:\s*#.*\n)*\s*e = (\{.*\})/.exec(setup)
  assert.ok(h2Entry, 'the harness 2 proxy entry is missing from setup.sh')
  const entry2 = JSON.parse(h2Entry[1].replace('"model": model', '"model": "m"'))     // the one Python name in the literal
  assert.ok(entry2.maxTokens >= promptSet(2).codeMaxTokens && entry2.maxTokens >= promptSet(2).curriculumMaxTokens)
  assert.equal('spendGroup' in entry2, false)
  assert.ok(entry2.capUsd > 0 && entry2.capUsd <= 20)
  assert.match(setup, /"maxTokens": 12000 if h2 else 4096/)
  assert.match(setup, /h2 = len\(parts\) > 4 and parts\[4\] == "2"/)
  // every arm registered today is harness 1: no 5th column on any of them
  const arms = fs.readFileSync(path.join(here, '../infra/arms.conf'), 'utf8').split('\n').filter(l => l.trim() && !l.startsWith('#'))
  assert.ok(arms.length >= 10)
  for (const l of arms) assert.equal(l.trim().split(/\s+/).length, 4, `a registered arm changed harness: ${l}`)
})

test('describeOutcome says each check in plain words', () => {
  assert.equal(describeOutcome({ kind: 'have', item: 'oak_log', count: 4 }), 'got 4 oak_log')
  assert.equal(describeOutcome({ kind: 'craft', item: 'lantern' }), 'crafted lantern')
  assert.equal(describeOutcome({ kind: 'placed', block: 'torch', count: 2 }), 'placed 2 torch')
  assert.equal(describeOutcome({ kind: 'structure', min_blocks: 30, max_span: 8 }), 'built a connected structure of 30+ blocks within a span of 8')
  assert.equal(describeOutcome({ kind: 'reach', y: 40, dir: 'below' }), 'ended below y=40')
  assert.equal(describeOutcome({ kind: 'reach', block: 'water', within: 3 }), 'ended within 3 of water')
  assert.equal(describeOutcome(null), 'unknown outcome')
  assert.equal(describeOutcome({ kind: 'teleport' }), 'unknown outcome')
  // a FAILED task is written as its goal: it must not read as something the bot has done
  assert.deepEqual([{ kind: 'have', item: 'oak_log', count: 4 }, { kind: 'craft', item: 'lantern' }, { kind: 'placed', block: 'torch', count: 2 }, { kind: 'structure', min_blocks: 30, max_span: 8 },
    { kind: 'reach', y: 40, dir: 'below' }, { kind: 'reach', block: 'water', within: 3 }].map(s => describeOutcome(s, false)),
  ['get 4 oak_log', 'craft lantern', 'place 2 torch', 'build a connected structure of 30+ blocks within a span of 8', 'end below y=40', 'end within 3 of water'])
})

test('abilitySummary: every outcome once, repeats counted, most repeated first, bounded', () => {
  assert.equal(abilitySummary([]), '(nothing yet)')
  const sk = sig => ({ signature: sig, description: 'MODEL TEXT must not appear' })
  const s = abilitySummary([sk('craft:lantern'), sk('placed:torch'), sk('placed:torch'), sk('placed:torch'), sk('placed:chest'), sk('have:oak_log'), sk('have:oak_log'),
    sk('structure:small'), sk('reach:ybelow64'), sk('unknown'), sk(''), sk('craft:'), sk(':x'), {}, null])
  assert.deepEqual(s.split('\n'), [
    'gathered or made: oak_log x2',
    'placed: torch x3, chest',
    'built structures: small',
    'reached: ybelow64',
    'crafted: lantern',
  ])
  assert.equal(s.includes('MODEL TEXT'), false)
  // the order of the lines is the order of KINDS, so a new kind cannot be silently dropped
  assert.deepEqual(KINDS, ['have', 'placed', 'structure', 'reach', 'craft'])
  // a real-sized library: 950 skills over 160 outcomes stays a few thousand characters
  const big = []
  for (let i = 0; i < 950; i++) big.push(sk(`${['craft', 'have', 'placed'][(i % 160) % 3]}:item_${i % 160}`))
  const out = abilitySummary(big)
  assert.ok(out.length < 6000, `summary is ${out.length} characters`)
  for (let i = 0; i < 160; i++) assert.ok(out.includes(`item_${i}`), `outcome item_${i} is missing`)
  // over the per-kind cap the tail is counted, not dropped silently
  const many = []
  for (let i = 0; i < ABILITY_IDS_PER_KIND + 7; i++) many.push(sk(`craft:thing_${String(i).padStart(3, '0')}`))
  assert.ok(abilitySummary(many).endsWith(', and 7 more'))
})

test('the harness 2 proposer prompt: the same checks as harness 1, the whole library, no model-written text', () => {
  assert.ok(CURRICULUM_FORMAT.startsWith('Reply with ONLY one JSON object'))
  assert.ok(CURRICULUM_SYSTEM.endsWith(CURRICULUM_FORMAT))
  assert.ok(CURRICULUM_SYSTEM_V2.endsWith(CURRICULUM_FORMAT))
  for (const k of KINDS) assert.ok(CURRICULUM_SYSTEM_V2.includes(`"kind":"${k}"`), k)
  assert.match(CURRICULUM_SYSTEM_V2, /ONE plain sentence of at most 200 characters/)
  assert.ok(CODER_SYSTEM_V2.startsWith(CODER_SYSTEM))
  assert.match(CODER_SYSTEM_V2, /call it \(`await itsName\(bot\)`\) instead of writing that step again/)

  const skills = []
  for (let i = 0; i < 950; i++) skills.push({ name: `skill${i}`, signature: `craft:item_${i % 150}`, description: `Craft a stone_hoe-free useful item number ${i}` })
  const u = curriculumUserV2({ state: FIX.state, skills, done: ['crafted lantern (skill makeLantern)'], failed: ['got 3 raw_iron -- no_path'], refusal: null })
  assert.ok(u.includes('WHAT YOU HAVE ALREADY DONE (950 skills)'))
  assert.equal(u.includes('-free'), false)                       // descriptions (model text) never reach the proposer
  assert.ok(u.includes('item_149'))                               // the LAST outcome is visible, not only the first 40 skills
  assert.ok(u.includes('- crafted lantern (skill makeLantern)') && u.includes('- got 3 raw_iron -- no_path'))
  assert.ok(u.includes('inventory: oak_log x3, dirt x12') && u.includes('holding: stone_axe'))
  assert.ok(u.length < 9000, `the proposer message is ${u.length} characters`)
  // positive control: harness 1 shows only the first 40 skills, with their descriptions
  const v1 = curriculumUser({ state: FIX.state, skills, done: [], failed: [], refusal: null })
  assert.ok(v1.includes('skill39:') && !v1.includes('skill40:') && v1.includes('-free'))
  assert.ok(curriculumUserV2({ state: FIX.state, skills: [], done: [], failed: [], refusal: 'because' }).includes('YOUR LAST PROPOSAL WAS REFUSED: because\nPropose a different task.'))
})

// Real task texts from the 3b Haiku logs (h1/h2, 11-09..11-12).
const CLEAN = [
  'Walk to the nearest water edge and place a row of 4 dirt blocks as a short bridge out over the water, then stand at its end.',
  'Craft an iron_shovel at the crafting table using 1 of my iron_ingot and 2 sticks.',
  'Build a connected hollow cobblestone shelter with walls at least 2 blocks high on flat grass near the crafting table, using the cobblestone I carry, and leave a 1-block doorway.',
  'Gather 4 birch_log from the nearby birch trees, craft them into birch_planks, and build a connected 2x2 birch_planks pad on the grass beside the crafting table.',
  'Clear the tree-free space beside the table',   // "free" as a plain word after a hyphenated NON-id is still refused: see below
]
const GARBLED = [
  'Craft a bucket-free useful item: use the 3 raw_iron and 1 coal in the furnace to smelt iron_ingot, then craft an iron_ingot-based item by crafting an iron_nugget-free iron_block-adjacent piece, specifically smelt the raw_iron into iron_ingot beside the furnace.',
  'Craft a crafting table-free useful item: use the 4 oak planks and 1 stick to craft a wooden shovel-free... no, instead craft a bucket-free iron tool set',
  'Mine 4 cobblestone from the nearby stone face, then craft a stone_hoe-free useful item: build a 2-high cobblestone pillar on the grass and place one torch on top.',
  'Mine 4 stone blocks from the nearby stone face and place them as a 2x2 stone bricks platform... instead, collect 3 andesite and 3 diorite',
]

test('plainTask: one plain sentence passes; a thought revised in mid-sentence is refused with what to write instead', () => {
  for (const t of CLEAN.slice(0, 4)) assert.deepEqual(plainTask(t), { ok: true }, t)
  for (const t of ['Find free space on the grass and place a chest', 'Build a freestanding wall 3 blocks long', 'Carefree walk to the lake', 'a'.repeat(TASK_MAX_CHARS)]) assert.equal(plainTask(t).ok, true, t)
  for (const t of GARBLED) {
    const r = plainTask(t)
    assert.equal(r.ok, false, t)
    assert.match(r.reason, /write "task" as one plain sentence of at most 200 characters that says only what to do/)   // the remedy is in every reason
  }
  assert.match(plainTask('a'.repeat(TASK_MAX_CHARS + 1)).reason, /^the task text is 241 characters long/)
  assert.match(plainTask(CLEAN[4]).reason, /says what to avoid/)
  assert.match(plainTask('Dig down… then come back').reason, /trails off/)
  assert.equal(plainTask(null).ok, true)        // an absent text is checkTask's refusal, not this one's
})

test('the refusal chain: checkTask passes, plainTask refuses, the reason reaches the next ask, and following it passes both', () => {
  const reg = { items: new Set(['iron_ingot', 'lantern']), blocks: new Set(['torch']) }
  const bad = { task: GARBLED[0], why: 'x', success: { kind: 'have', item: 'iron_ingot', count: 3 } }
  assert.equal(checkTask(bad, reg).ok, true)                     // the check itself is valid: only the text is not
  const r = plainTask(bad.task)
  assert.equal(r.ok, false)
  const next = curriculumUserV2({ state: FIX.state, skills: [], done: [], failed: [], refusal: r.reason })
  assert.ok(next.includes(`YOUR LAST PROPOSAL WAS REFUSED: ${r.reason}`))
  // the remedy is executable from here: the same goal, written the way the reason asks
  const good = { task: 'Smelt the 3 raw_iron in the furnace with coal to get 3 iron_ingot.', why: 'x', success: bad.success }
  assert.equal(checkTask(good, reg).ok, true)
  assert.equal(plainTask(good.task).ok, true)
})

const skill = (name, description, success, extra = {}) => ({ name, description, signature: outcomeSignature(success), task: { task: description, success },
  code: `async function ${name}(bot) { await bot.observe() }`, verified: 1, fails: 0, reused: 0, demoted: false, ...extra })

test('pickRelated: different abilities, the task\'s own outcome first, the proven one of each', () => {
  const lantern = { kind: 'craft', item: 'lantern' }
  const lib = [
    skill('craftLanternFromIngot', 'Craft a lantern from iron nuggets and a torch at the crafting table', lantern, { fails: 2 }),
    skill('craftLanternNow', 'Craft a lantern from iron nuggets and a torch at the crafting table', lantern, { reused: 2, verified: 2 }),
    skill('craftLanternAgain', 'Craft a lantern from iron nuggets and a torch at the crafting table again', lantern),
    skill('craftLanternV4', 'Craft one lantern at the crafting table from iron nuggets and a torch', lantern),
    skill('craftLanternV5', 'Craft a lantern at the table using iron nuggets and a torch', lantern),
    skill('craftLanternV6', 'Craft a lantern from nuggets and a torch at the crafting table', lantern),
    skill('craftIronNuggets', 'Craft iron nuggets from an iron ingot at the crafting table', { kind: 'craft', item: 'iron_nugget' }),
    skill('craftTorches', 'Craft a torch from coal and a stick', { kind: 'craft', item: 'torch' }),
    skill('smeltIron', 'Smelt raw iron into an iron ingot in the furnace', { kind: 'have', item: 'iron_ingot', count: 2 }),
    skill('plantSapling', 'Plant an oak sapling', { kind: 'placed', block: 'oak_sapling', count: 1 }),
  ]
  const task = { task: 'Craft a lantern from iron nuggets and a torch at the crafting table', success: lantern }
  // positive control: harness 1's top 5 by word overlap is five lantern rewrites
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vyh2-'))
  const L = new Library(dir)
  for (const s of lib) L.skills.set(s.name, s)
  const v1 = L.retrieve(task, 5)
  assert.equal(v1.filter(s => s.signature === 'craft:lantern').length, 5)

  const { related, more } = pickRelated(lib, task, { k: 4, more: 8 })
  const all = [...related, ...more]
  assert.equal(all.filter(s => s.signature === 'craft:lantern').length, 1)
  assert.equal(related[0].name, 'craftLanternNow')                 // same outcome first; of the six rewrites, the proven one
  assert.equal(new Set(all.map(s => s.signature)).size, all.length)
  assert.deepEqual(related.map(s => s.name).sort(), ['craftIronNuggets', 'craftLanternNow', 'craftTorches', 'smeltIron'])
  assert.equal(all.some(s => s.name === 'plantSapling'), false)    // no word in common and another outcome: not offered
  assert.deepEqual(L.retrieve2(task), { related, more })           // the library method is the same function over active()
  // a demoted skill is never offered
  lib[1].demoted = true
  assert.equal(L.retrieve2(task).related.some(s => s.name === 'craftLanternNow'), false)
  lib[1].demoted = false

  // the exact outcome ranks first even when another skill shares more words with the task
  const t2 = { task: 'Go to the lake shore and fill it', success: { kind: 'have', item: 'water_bucket', count: 1 } }
  const lib2 = [
    skill('walkLakeShore', 'Go to the lake shore and look around the lake shore', { kind: 'reach', block: 'water', within: 2 }),
    skill('scoopWater', 'Use the bucket on a pond', { kind: 'have', item: 'water_bucket', count: 1 }),
  ]
  assert.deepEqual(pickRelated(lib2, t2).related.map(s => s.name), ['scoopWater', 'walkLakeShore'])

  // k and more split the list; ties break on the name, so the pick is deterministic
  const tied = ['delta', 'alpha', 'charlie', 'bravo'].map(n => skill(`${n}Skill`, 'gather some wood', { kind: 'have', item: `${n}_log`, count: 1 }))
  const p = pickRelated(tied, { task: 'gather some wood', success: { kind: 'craft', item: 'stick' } }, { k: 2, more: 1 })
  assert.deepEqual(p.related.map(s => s.name), ['alphaSkill', 'bravoSkill'])
  assert.deepEqual(p.more.map(s => s.name), ['charlieSkill'])
  assert.deepEqual(pickRelated([...tied].reverse(), { task: 'gather some wood', success: { kind: 'craft', item: 'stick' } }, { k: 2, more: 1 }), p)
  assert.deepEqual(pickRelated([], task), { related: [], more: [] })
})

test('pickRelated: two different structures are both offered; two rewrites of one structure are not', () => {
  const small = { kind: 'structure', min_blocks: 4, max_span: 4 }
  const lib = [
    skill('buildLakeBridge', 'Build a cobblestone bridge out over the lake from the shore', small),
    skill('buildLakeBridgeV2', 'Build a cobblestone bridge out over the lake from the shore again', small),
    skill('buildOakHut', 'Build a small oak planks hut with a doorway beside the crafting table', small),
  ]
  const task = { task: 'Build a cobblestone bridge and an oak hut by the lake', success: small }
  const names = pickRelated(lib, task).related.map(s => s.name)
  assert.equal(names.includes('buildOakHut'), true)
  assert.equal(names.filter(n => n.startsWith('buildLakeBridge')).length, 1)
  assert.ok(similarity(lib[0], lib[1]) > 0.4 && similarity(lib[0], lib[2]) < 0.4)
  assert.ok(reliability({ verified: 2, reused: 2 }) > reliability({ verified: 1 }) && reliability({ fails: 2 }) < reliability({}))
})

test('coderUserV2: the prefix is the same on every round of a task; a cut-off reply is told so, without its code', () => {
  const related = [skill('craftTorches', 'MODEL TEXT a stone_hoe-free thing', { kind: 'craft', item: 'torch' })]
  const more = [skill('smeltIron', 'MODEL TEXT', { kind: 'have', item: 'iron_ingot', count: 2 })]
  const r1 = coderUserV2({ task: FIX.task, state: FIX.state, related, more, previous: null })
  const r2 = coderUserV2({ task: FIX.task, state: { ...FIX.state, pos: { x: 9, y: 70, z: 9 }, inventory: { torch: 1 } }, related, more, previous: FIX.previous })
  const r3 = coderUserV2({ task: FIX.task, state: FIX.state, related, more, previous: { round: 2, truncated: true, code: '', outcome: 'cut', log: [], delta: 'nothing ran' } })
  assert.equal(r1.prefix, r2.prefix)
  assert.equal(r1.prefix, r3.prefix)
  assert.notEqual(r1.rest, r2.rest)
  assert.ok(r1.prefix.startsWith('TASK: craft a lantern\nDONE WHEN: {"kind":"craft","item":"lantern"}'))
  assert.ok(r1.prefix.includes('// craftTorches: crafted torch\nasync function craftTorches(bot)'))
  assert.ok(r1.prefix.includes('MORE SKILLS YOU CAN CALL (by name; code not shown, each takes only `bot`):\n- smeltIron: got 2 iron_ingot'))
  assert.equal((r1.prefix + r1.rest).includes('MODEL TEXT'), false)
  assert.ok(r1.rest.startsWith('STATE: position {"x":1,"y":64,"z":-2}') && !r1.rest.includes('PREVIOUS'))
  assert.ok(r2.rest.includes('YOUR PREVIOUS ATTEMPT (round 1) FAILED.') && r2.rest.includes('WHAT HAPPENED: o') && r2.rest.includes('"torch":1'))
  assert.ok(r3.rest.includes('YOUR PREVIOUS REPLY (round 2) WAS CUT OFF at the length limit') && r3.rest.includes('Write a much shorter function'))
  assert.equal(r3.rest.includes('```'), false)
  const none = coderUserV2({ task: FIX.task, state: FIX.state, related: [], more: [], previous: null })
  assert.ok(none.prefix.includes('(none yet)') && !none.prefix.includes('MORE SKILLS'))
})

test('proxy: the cache split makes two blocks or changes nothing; one arm can use two models, and nothing else', () => {
  const text = 'PREFIX-PART' + 'rest part'
  assert.deepEqual(userContent(text, 11), [{ type: 'text', text: 'PREFIX-PART', cache_control: { type: 'ephemeral' } }, { type: 'text', text: 'rest part' }])
  for (const bad of [undefined, null, 0, -1, text.length, text.length + 5, 1.5, '11', NaN, {}]) assert.equal(userContent(text, bad), text, String(bad))
  assert.equal(userContent(42, 5), '42')                          // not a string: read as one, and 5 is past its end
  assert.deepEqual(userContent(42, 1).map(b => b.text), ['4', '2'])

  const arm = { backend: 'anthropic', model: 'claude-haiku-5-5', inUsdPerMTok: 0.1, outUsdPerMTok: 0.5, capUsd: 30, effort: 'low', maxTokens: 12000, perHour: 400, inflight: 1, gid: 7,
    byPurpose: { curriculum: { model: 'claude-sonnet-5-5', inUsdPerMTok: 2, outUsdPerMTok: 10, effort: 'medium', maxTokens: 4000,
      backend: 'ollama', capUsd: 9999, perHour: 99999, inflight: 50, url: 'http://elsewhere', spendGroup: 'other', paused: false, gid: 0 } } }
  assert.equal(armFor(arm, 'code'), arm)
  assert.equal(armFor(arm, '?'), arm)
  assert.equal(armFor({ model: 'm' }, 'curriculum').model, 'm')
  const c = armFor(arm, 'curriculum')
  assert.deepEqual([c.model, c.inUsdPerMTok, c.outUsdPerMTok, c.effort, c.maxTokens], ['claude-sonnet-5-5', 2, 10, 'medium', 4000])
  // the backend, the cap, the pace, the socket group and the pause stay the arm's
  assert.deepEqual([c.backend, c.capUsd, c.perHour, c.inflight, c.url, c.spendGroup, c.paused, c.gid], ['anthropic', 30, 400, 1, undefined, undefined, undefined, 7])
  assert.equal(arm.model, 'claude-haiku-5-5')                      // the arm itself is not changed
  // dollars are reserved and settled at the model that answers: 20x Haiku for the same call
  assert.ok(Math.abs(reserveUsd(c, 20000, 2000) / reserveUsd({ ...arm, maxTokens: 4000 }, 20000, 2000) - 20) < 1e-9)
  assert.ok(Math.abs(usageUsd(c, { input_tokens: 5000, output_tokens: 300 }) - (5000 * 2 + 300 * 10) / 1e6) < 1e-12)
  assert.equal(armFor(null, 'code'), null)
  assert.equal(armFor({ model: 'm', byPurpose: { code: 'not an object' } }, 'code').model, 'm')
})

test('llm client: the message is always whole, cache_split rides beside it, and the stop reason comes back', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vysock-'))
  const sock = path.join(dir, 'llm.sock')
  const seen = []
  const server = http.createServer((req, res) => {
    let raw = ''
    req.on('data', d => { raw += d })
    req.on('end', () => { seen.push(JSON.parse(raw)); const out = JSON.stringify(seen.length === 1 ? { text: 'hi', usage: { output_tokens: 3 }, ms: 5, stop: 'max_tokens' } : { text: 'old proxy', usage: null, ms: 1 }); res.writeHead(200, { 'content-type': 'application/json' }); res.end(out) })
  })
  await new Promise(r => server.listen(sock, r))
  try {
    const a = await chat({ socketPath: sock, purpose: 'code', system: 's', messages: [{ role: 'user', content: 'PREFIXrest' }], maxTokens: 10000, cacheSplit: 6 })
    assert.deepEqual(a, { ok: true, text: 'hi', usage: { output_tokens: 3 }, ms: 5, stop: 'max_tokens' })
    assert.deepEqual(seen[0], { purpose: 'code', system: 's', messages: [{ role: 'user', content: 'PREFIXrest' }], max_tokens: 10000, cache_split: 6 })
    // harness 1 sends no cache_split at all, and a proxy that returns no stop reads as null
    const b = await chat({ socketPath: sock, purpose: 'code', system: 's', messages: [{ role: 'user', content: 'x' }], maxTokens: 4000 })
    assert.equal(b.stop, null)
    assert.equal('cache_split' in seen[1], false)
    assert.equal(seen[1].max_tokens, 4000)
  } finally { await new Promise(r => server.close(r)) }
})

// ---------------------------------------------------------------------------------------------------------------------
// ONE WHOLE ITERATION against a fake body and a scripted model: propose -> filter -> retrieve -> code -> run in the real
// isolate -> verify -> keep. The body stands at y=64; the scripted model "climbs" it to y=90 when it is asked for code.

function rig ({ harness, replies, seed = [] }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vyloop-'))
  const library = new Library(path.join(dir, 'library'))
  for (const s of seed) library.addVerified(s)
  const bot = {
    entity: { position: new Vec3(0.5, 64, 0.5) }, entities: {}, health: 20, food: 20, time: { timeOfDay: 1000, isDay: true }, heldItem: null,
    registry: { itemsByName: { lantern: { id: 1 }, oak_log: { id: 2 }, torch: { id: 3 } }, blocksByName: { stone: { id: 1 }, torch: { id: 3 } } },
    inventory: { items: () => [{ name: 'oak_log', count: 3 }] },
    blockAt: () => null, findBlocks: () => [], voyager: { spawn: null },
  }
  const runner = { current: null, interrupt () {} }
  const calls = [], rows = []
  const llm = async (req) => {
    calls.push(req)
    const r = replies[calls.length - 1]
    if (!r) throw new Error(`the scripted model has no reply ${calls.length}`)
    if (r.climb) bot.entity.position = new Vec3(0.5, 90, 0.5)
    return { ok: true, usage: null, ms: 1, stop: 'end_turn', ...r }
  }
  const loop = new VoyagerLoop({ getBot: () => bot, getRunner: () => runner, library, llm, log: (kind, o) => rows.push({ kind, ...o }), arm: 't', stateDir: dir, harness, budget: { wallMs: 5000 } })
  loop.running = true
  return { loop, calls, rows, library, dir }
}
const propose = (task, y = 80) => ({ text: JSON.stringify({ task, why: 'to see far', success: { kind: 'reach', y, dir: 'above' } }) })
const CODE = '```javascript\nasync function climbHigh(bot) {\n  const o = await bot.observe()\n  bot.log("at " + o.pos.y)\n  return o.pos\n}\n```'
const SEED = [
  { name: 'climbHill', code: 'async function climbHill(bot) { await bot.observe() }', task: { task: 'Climb the hill to see far', success: { kind: 'reach', y: 80, dir: 'above' } }, calls: [], ownCalls: 1, at: 't' },
  { name: 'climbHillAgain', code: 'async function climbHillAgain(bot) { await bot.observe(); await bot.observe() }', task: { task: 'Climb the hill again to see far', success: { kind: 'reach', y: 82, dir: 'above' } }, calls: [], ownCalls: 1, at: 't' },
]

test('a whole iteration on harness 1: the pinned prompts, 700 / 4000 tokens, no cache split, the task text in the history', async () => {
  const { loop, calls, rows, library } = rig({ harness: 1, seed: SEED, replies: [propose('Climb the hill to see far'), { text: CODE, climb: true }] })
  await loop.iteration()
  assert.equal(calls.length, 2)
  assert.deepEqual([calls[0].purpose, calls[0].system, calls[0].maxTokens], ['curriculum', CURRICULUM_SYSTEM, 700])
  assert.ok(calls[0].messages[0].content.includes('SKILLS YOU HAVE (name: what it did)\n- climbHill: Climb the hill to see far'))
  assert.deepEqual([calls[1].purpose, calls[1].system, calls[1].maxTokens, calls[1].cacheSplit], ['code', CODER_SYSTEM, 4000, null])
  assert.ok(calls[1].messages[0].content.startsWith('TASK: Climb the hill to see far\nDONE WHEN:'))
  assert.equal(calls[1].messages[0].content.includes('MORE SKILLS'), false)
  // harness 1 offers both rewrites of the one ability
  assert.ok(calls[1].messages[0].content.includes('// climbHill: ') && calls[1].messages[0].content.includes('// climbHillAgain: '))
  const done = rows.find(r => r.kind === 'task_done')
  assert.equal(done?.skill, 'climbHigh')
  assert.equal(library.skills.has('climbHigh'), true)
  assert.deepEqual(loop.hist.done, ['Climb the hill to see far (skill climbHigh)'])
})

test('a whole iteration on harness 2: garbled task refused with the remedy, cut-off reply told so, one skill per outcome, plain history', async () => {
  const { loop, calls, rows, library } = rig({ harness: 2, seed: SEED, replies: [
    propose(GARBLED[2]),                                   // 1: a thought revised in mid-sentence
    { text: '{"task": "Climb the hill to', stop: 'max_tokens' },   // 2: cut off before the JSON ended
    propose('Climb the hill to see far'),                  // 3: accepted
    { text: '```javascript\nasync function climbHigh(bot) {\n  const o = await bot.obs', stop: 'max_tokens' },   // 4: cut off in mid-function
    { text: CODE, climb: true },                           // 5: runs and verifies
  ] })
  await loop.iteration()
  assert.equal(calls.length, 5)
  // the proposer: harness 2 prompt and limit, the library as outcomes
  assert.deepEqual([calls[0].system, calls[0].maxTokens], [CURRICULUM_SYSTEM_V2, 2000])
  assert.ok(calls[0].messages[0].content.includes('WHAT YOU HAVE ALREADY DONE (2 skills)\nreached: yabove80 x2'))
  // refusal 1 names the remedy and reaches ask 2; refusal 2 says the reply was cut off and reaches ask 3
  const refused = rows.filter(r => r.kind === 'task_refused')
  assert.equal(refused.length, 2)
  assert.match(refused[0].reason, /says what to avoid.*write "task" as one plain sentence/)
  assert.ok(calls[1].messages[0].content.includes(`YOUR LAST PROPOSAL WAS REFUSED: ${refused[0].reason}`))
  assert.match(refused[1].reason, /cut off at the length limit before the JSON ended/)
  assert.ok(calls[2].messages[0].content.includes(`YOUR LAST PROPOSAL WAS REFUSED: ${refused[1].reason}`))
  // the coder: harness 2 prompt and limit, the cache split at the end of the stable part, one skill per outcome
  const m1 = calls[3].messages[0].content, m2 = calls[4].messages[0].content
  assert.deepEqual([calls[3].system, calls[3].maxTokens], [CODER_SYSTEM_V2, 10000])
  assert.ok(Number.isInteger(calls[3].cacheSplit) && calls[3].cacheSplit > 0 && calls[3].cacheSplit < m1.length)
  assert.equal(calls[3].cacheSplit, calls[4].cacheSplit)
  assert.equal(m1.slice(0, calls[3].cacheSplit), m2.slice(0, calls[4].cacheSplit))
  assert.ok(m1.slice(calls[3].cacheSplit).startsWith('STATE: position'))
  assert.equal((m1.match(/^\/\/ climbHill/gm) ?? []).length, 1)
  // the cut-off code reply: a row of its own, no lint refusal, and the next round is told to write a shorter function
  assert.equal(rows.filter(r => r.kind === 'reply_truncated').length, 1)
  assert.equal(rows.filter(r => r.kind === 'lint_refused').length, 0)
  assert.ok(m2.includes('YOUR PREVIOUS REPLY (round 1) WAS CUT OFF at the length limit') && !m2.includes('bot.obs\n'))
  // it ran, verified and was kept; the history line is the harness's words, not the model's
  const done = rows.find(r => r.kind === 'task_done')
  assert.deepEqual([done?.skill, done?.round], ['climbHigh', 2])
  assert.equal(library.skills.get('climbHigh').signature, 'reach:yabove80')
  assert.deepEqual(loop.hist.done, ['ended above y=80 (skill climbHigh)'])
})

test('harness 2: a task that fails every round leaves a plain line, and a cut-off final round is named as the reason', async () => {
  const cut = { text: '```javascript\nasync function climbHigh(bot) {\n  const o = await bot.obs', stop: 'max_tokens' }
  const { loop, calls, rows } = rig({ harness: 2, replies: [propose('Climb the hill to see far'), cut, cut, cut, cut] })
  await loop.iteration()
  assert.equal(calls.length, 5)
  assert.equal(rows.filter(r => r.kind === 'reply_truncated').length, 4)
  assert.match(rows.find(r => r.kind === 'task_failed').why, /^refused before running: the reply was cut off at the length limit/)
  assert.equal(loop.hist.failed.length, 1)
  assert.match(loop.hist.failed[0], /^end above y=80 -- refused before running: the reply was cut off/)
  assert.deepEqual(loop.hist.rep, {})                              // nothing ran, so nothing counts against the outcome
  // positive control: on harness 1 the same replies are lint refusals ("syntax error"), as measured on the 3b arms
  const h1 = rig({ harness: 1, replies: [propose('Climb the hill to see far'), cut, cut, cut, cut] })
  await h1.loop.iteration()
  assert.equal(h1.rows.filter(r => r.kind === 'lint_refused').length, 4)
  assert.equal(h1.rows.filter(r => r.kind === 'reply_truncated').length, 0)
  assert.match(h1.loop.hist.failed[0], /^Climb the hill to see far -- refused before running: syntax error/)
})

test('harness 2: a reply cut off after the function was complete still runs', async () => {
  const whole = { text: '```javascript\nasync function climbHigh(bot) {\n  const o = await bot.observe()\n  return o.pos\n}\n', stop: 'max_tokens', climb: true }
  const { loop, rows } = rig({ harness: 2, replies: [propose('Climb the hill to see far'), whole] })
  await loop.iteration()
  assert.equal(rows.filter(r => r.kind === 'reply_truncated').length, 0)
  assert.equal(rows.find(r => r.kind === 'task_done')?.skill, 'climbHigh')
})

// ---------------------------------------------------------------------------------------------------------------------
// The two refusals added after reading the qwen arms (11-12): swords, and an outcome that keeps failing.

test('swordRefusal: no sword task reaches the coder; every other tool does; the reason names what to propose', () => {
  for (const item of ['wooden_sword', 'stone_sword', 'iron_sword', 'golden_sword', 'diamond_sword']) {
    for (const s of [{ kind: 'craft', item }, { kind: 'have', item, count: 1 }]) {
      const r = swordRefusal(s)
      assert.equal(r.ok, false, JSON.stringify(s))
      assert.match(r.reason, new RegExp(`^${item} cannot be made in this peaceful world.*propose a pickaxe, axe, shovel or hoe`))
    }
  }
  for (const s of [{ kind: 'craft', item: 'iron_pickaxe' }, { kind: 'craft', item: 'stone_axe' }, { kind: 'have', item: 'stick', count: 2 }, { kind: 'placed', block: 'torch', count: 1 },
    { kind: 'reach', block: 'water', within: 2 }, { kind: 'structure', min_blocks: 8, max_span: 4 }, { kind: 'craft', item: 'swordfish' }, null, {}]) assert.deepEqual(swordRefusal(s), { ok: true }, JSON.stringify(s))
  // the fleet rule this mirrors: the craft skill refuses exactly the items that end in _sword
  const kit = fs.readFileSync(path.join(here, '../../bots/src/peacefulkit.mjs'), 'utf8')
  assert.ok(stripComments(kit).includes("export const isSword = name => typeof name === 'string' && /_sword$/.test(name)"))
  assert.match(CURRICULUM_SYSTEM_V2, /Swords\ncannot be made in a peaceful world: never propose one\./)
})

test('the repeat rule: three failures in a row rest an outcome, a success clears it, the rest ends by itself', () => {
  assert.deepEqual([REPEAT_FAILS, REPEAT_REST], [3, 12])
  const rep = {}
  const sig = 'craft:iron_pickaxe'
  noteOutcome(rep, sig, 10, false, 'missing_ingredients')
  noteOutcome(rep, sig, 11, false, 'missing_ingredients')
  assert.deepEqual(repeatRefusal(rep, sig, 12), { ok: true })      // two failures: still allowed
  assert.deepEqual(setAside(rep, 12), [])
  noteOutcome(rep, sig, 12, false, 'craft iron_pickaxe failed: missing_ingredients')
  const r = repeatRefusal(rep, sig, 13)
  assert.equal(r.ok, false)
  assert.match(r.reason, /^that outcome failed 3 times in a row \(last time: craft iron_pickaxe failed: missing_ingredients\) and is set aside for your next 11 tasks; propose a different outcome -- if it lacked an ingredient or a tool, propose getting that first$/)
  assert.deepEqual(setAside(rep, 13), [sig])
  assert.deepEqual(repeatRefusal(rep, 'have:iron_ingot', 13), { ok: true })     // the remedy is open: another outcome is not refused
  // it ends by itself: REPEAT_REST tasks later the outcome may be tried again, and the record is pruned
  assert.equal(repeatRefusal(rep, sig, 12 + REPEAT_REST - 1).ok, false)
  assert.deepEqual(repeatRefusal(rep, sig, 12 + REPEAT_REST), { ok: true })
  assert.deepEqual(setAside(rep, 12 + REPEAT_REST), [])
  assert.equal(sig in rep.rest, false)
  // after the rest the count starts again from zero (one more failure does not rest it at once)
  noteOutcome(rep, sig, 30, false, 'x')
  assert.deepEqual(repeatRefusal(rep, sig, 31), { ok: true })
  // a success clears a streak and a rest
  const rep2 = {}
  noteOutcome(rep2, sig, 1, false); noteOutcome(rep2, sig, 2, false); noteOutcome(rep2, sig, 3, true); noteOutcome(rep2, sig, 4, false)
  assert.deepEqual(repeatRefusal(rep2, sig, 5), { ok: true })
  assert.equal(rep2.streak[sig], 1)
  noteOutcome(rep2, sig, 5, false); noteOutcome(rep2, sig, 6, false)
  assert.equal(repeatRefusal(rep2, sig, 7).ok, false)
  noteOutcome(rep2, sig, 7, true)
  assert.deepEqual(repeatRefusal(rep2, sig, 8), { ok: true })
  // structures of one size class share a signature and are never rested
  assert.ok(repeatExempt('structure:small') && !repeatExempt('craft:lantern'))
  const rep3 = {}
  for (let i = 0; i < 9; i++) noteOutcome(rep3, 'structure:small', i, false)
  assert.deepEqual(repeatRefusal(rep3, 'structure:small', 9), { ok: true })
  assert.deepEqual(repeatRefusal(undefined, sig, 1), { ok: true })
  assert.deepEqual(repeatRefusal({}, sig, 1), { ok: true })
  // the proposer is told what rests
  const u = curriculumUserV2({ state: FIX.state, skills: [], done: [], failed: [], refusal: null, aside: ['craft:iron_pickaxe', 'have:raw_gold'] })
  assert.ok(u.includes('SET ASIDE (failed several times in a row; refused for now): craft:iron_pickaxe, have:raw_gold'))
  assert.equal(curriculumUserV2({ state: FIX.state, skills: [], done: [], failed: [], refusal: null }).includes('SET ASIDE'), false)
})

const proposeCraft = (item, text = `Craft one ${item} at the table`) => ({ text: JSON.stringify({ task: text, why: 'x', success: { kind: 'craft', item } }) })
const RUNS_AND_FAILS = { text: '```javascript\nasync function tryIt(bot) {\n  const o = await bot.observe()\n  return o.pos\n}\n```' }

test('harness 2 loop: a sword is refused before any code is written, and the remedy reaches the next ask; harness 1 still tries it', async () => {
  const { loop, calls, rows } = rig({ harness: 2, replies: [{ text: JSON.stringify({ task: 'Craft a wooden sword at the table', why: 'x', success: { kind: 'craft', item: 'wooden_sword' } }) },
    propose('Climb the hill to see far'), { text: CODE, climb: true }] })
  loop.getBot().registry.itemsByName.wooden_sword = { id: 9 }
  await loop.iteration()
  const refused = rows.filter(r => r.kind === 'task_refused')
  assert.equal(refused.length, 1)
  assert.match(refused[0].reason, /^wooden_sword cannot be made in this peaceful world/)
  assert.ok(calls[1].messages[0].content.includes(`YOUR LAST PROPOSAL WAS REFUSED: ${refused[0].reason}`))
  assert.deepEqual(calls.map(c => c.purpose), ['curriculum', 'curriculum', 'code'])     // no coder call was spent on the sword
  assert.equal(rows.find(r => r.kind === 'task_done')?.skill, 'climbHigh')
  // positive control: harness 1 hands the sword to the coder (four rounds on the 3b arms)
  const h1 = rig({ harness: 1, replies: [{ text: JSON.stringify({ task: 'Craft a wooden sword', why: 'x', success: { kind: 'craft', item: 'wooden_sword' } }) }, RUNS_AND_FAILS, RUNS_AND_FAILS, RUNS_AND_FAILS, RUNS_AND_FAILS] })
  h1.loop.getBot().registry.itemsByName.wooden_sword = { id: 9 }
  await h1.loop.iteration()
  assert.deepEqual(h1.calls.map(c => c.purpose), ['curriculum', 'code', 'code', 'code', 'code'])
  assert.equal(h1.rows.filter(r => r.kind === 'task_refused').length, 0)
})

test('harness 2 loop: an outcome that fails three tasks in a row is refused on the fourth, the proposer is told, another outcome goes through', async () => {
  const fail5 = [proposeCraft('lantern'), RUNS_AND_FAILS, RUNS_AND_FAILS, RUNS_AND_FAILS, RUNS_AND_FAILS]
  const { loop, calls, rows } = rig({ harness: 2, replies: [...fail5, ...fail5, ...fail5,
    proposeCraft('lantern'),                               // 16: the fourth ask for the same outcome -> refused
    propose('Climb the hill to see far'), { text: CODE, climb: true }] })
  await loop.iteration(); await loop.iteration(); await loop.iteration()
  assert.equal(rows.filter(r => r.kind === 'task_failed').length, 3)
  assert.equal(rows.filter(r => r.kind === 'task_refused').length, 0)
  assert.deepEqual(loop.hist.failed.map(l => l.split(' -- ')[0]), ['craft lantern', 'craft lantern', 'craft lantern'])
  assert.deepEqual(Object.keys(loop.hist.rep.rest), ['craft:lantern'])
  await loop.iteration()
  // the proposer was told before it asked, the ask was refused with the remedy, and the next ask carried it
  assert.ok(calls[15].messages[0].content.includes('SET ASIDE (failed several times in a row; refused for now): craft:lantern'))
  const refused = rows.filter(r => r.kind === 'task_refused')
  assert.equal(refused.length, 1)
  assert.match(refused[0].reason, /^that outcome failed 3 times in a row .* set aside for your next 11 tasks; propose a different outcome/)
  assert.ok(calls[16].messages[0].content.includes(`YOUR LAST PROPOSAL WAS REFUSED: ${refused[0].reason}`))
  assert.equal(rows.find(r => r.kind === 'task_done')?.skill, 'climbHigh')
  assert.equal(calls.length, 18)                                   // 15 + refused ask + accepted ask + one code call
  // the record survives a restart: it is in history.json
  const saved = JSON.parse(fs.readFileSync(loop.histFile, 'utf8'))
  assert.deepEqual(Object.keys(saved.rep.rest), ['craft:lantern'])
  // positive control: harness 1 keeps no such record and would hand the fourth ask to the coder
  const h1 = rig({ harness: 1, replies: [...fail5, ...fail5, ...fail5, ...fail5] })
  for (let i = 0; i < 4; i++) await h1.loop.iteration()
  assert.equal(h1.rows.filter(r => r.kind === 'task_failed').length, 4)
  assert.equal(h1.rows.filter(r => r.kind === 'task_refused').length, 0)
  assert.equal(h1.loop.hist.rep, undefined)
})

test('harness 2 loop: a success between failures clears the count, so the outcome is not rested', async () => {
  const fail5 = [propose('Climb the hill to see far'), RUNS_AND_FAILS, RUNS_AND_FAILS, RUNS_AND_FAILS, RUNS_AND_FAILS]
  const { loop, rows } = rig({ harness: 2, replies: [...fail5, ...fail5, propose('Climb the hill to see far'), { text: CODE, climb: true }, ...fail5] })
  await loop.iteration(); await loop.iteration()
  assert.equal(loop.hist.rep.streak['reach:yabove80'], 2)
  await loop.iteration()                                           // verified
  assert.equal(rows.filter(r => r.kind === 'task_done').length, 1)
  assert.equal('reach:yabove80' in loop.hist.rep.streak, false)
  loop.getBot().entity.position = new Vec3(0.5, 64, 0.5)           // back down, so the check is not already true
  await loop.iteration()                                           // fails again: the first of a new count, not the third
  assert.equal(rows.filter(r => r.kind === 'task_failed').length, 3)
  assert.equal(loop.hist.rep.streak['reach:yabove80'], 1)
  assert.deepEqual(loop.hist.rep.rest, {})
})
