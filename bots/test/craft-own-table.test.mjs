// A CRAFTING TABLE IN THE PACK IS A REMEDY THE BOT CAN PERFORM WHERE IT STANDS.
//
// craft finds the nearest table within 32 blocks, walks, and checks the reach
// it actually achieved. When the walk fell short it failed with "move to x,z
// first" -- while the resolver's place() branch ran only when NO table had
// been found. Measured 2026-09-10 over 3h (full walk of /var/log/mcai): 77
// craft runs failed on exactly this across 23 bots, and 58 of them were
// carrying a crafting_table at the time. 66 of the 77 were furnace,
// stone_pickaxe and iron_pickaxe.
//
// smelt fixed the same shape on e2b18f0 (test/smelt-own-furnace.test.mjs);
// this is the craft half. Source assertions, comments stripped first, anchored
// on the executable lines, and the mutant below proves the anchor is live.
import assert from 'node:assert'
import test from 'node:test'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
process.env.OLLAMA_MODEL ??= 'qwen2.5:7b-instruct'
const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src')
const RAW = fs.readFileSync(path.join(SRC, 'skills.mjs'), 'utf8')
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const CODE = strip(RAW)

// The reach check lives after the table walk. Cut the region so the anchors
// cannot match smelt's copy of the same idea.
const start = CODE.indexOf("matching: b => bot.registry.blocks[b.type]?.name === 'crafting_table'")
const region = CODE.slice(start, CODE.indexOf('await bot.craft(recipe, count, table ?? undefined)'))
assert.ok(start > 0 && region.length > 0, 'craft region moved; re-read this test')

const PLACES = /if \(reach > STATION_REACH && carried\)[\s\S]{0,200}?place\(ctx, \{ item: 'crafting_table' \}, signal\)/

test('an unreachable table makes craft place the one it carries, before it gives up', () => {
  assert.match(region, PLACES)
  const placeAt = region.search(PLACES)
  const failAt = region.indexOf("failClass: 'no_path'")
  assert.ok(placeAt > 0 && failAt > placeAt, 'the placement must come BEFORE the no_path refusal')
})

test('after placing, it uses the table at the coordinate place() returned, then re-measures reach', () => {
  assert.match(region, /put\.at && bot\.blockAt\(put\.at\)\?\.name === 'crafting_table'/,
    'the table it just put down, by coordinate -- a nearest-search could name a different one')
  assert.match(region, /table = mine[\s\S]{0,200}?reach = bot\.entity\.position\.distanceTo\(table\.position/)
})

test('the refusal carries place()\'s own reason, and says nothing about placing when nothing was placed', () => {
  assert.match(region, /putting down the one you carry failed: \$\{put\.detail \|\| put\.failClass/,
    'a dropped reason sends the model to redo the thing that just failed (see the stationOnly branch)')
  assert.match(region, /\(putSaid \? ` \(\$\{putSaid\}\)` : ''\)/,
    'a bot with no table must not be told its placement failed')
})

test('MUTANT: with the placement removed, the first assertion fails for the intended reason', () => {
  const anchor = "if (reach > STATION_REACH && carried) {"
  assert.equal(RAW.split(anchor).length - 1, 1, 'ANCHOR MISSING or not unique')
  const mutant = strip(RAW.replace(anchor, 'if (false) {'))
  const s = mutant.indexOf("matching: b => bot.registry.blocks[b.type]?.name === 'crafting_table'")
  const r = mutant.slice(s, mutant.indexOf('await bot.craft(recipe, count, table ?? undefined)'))
  assert.doesNotMatch(r, PLACES, 'the anchor did not carry the assertion')
})
