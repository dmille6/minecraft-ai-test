// SANDBOX-ONLY (cottage2-01, 2026-11-08): CAN A BOT PLACE EACH NEW BLOCK KIND A FURNISHED COTTAGE NEEDS, IN ITS STATE, BY ITS OWN CLICK?
//   BOT_ROOT=<worktree> SBX=sandbox6 PORT=25604 REPS=2 node sandbox/cottage2/furnish-proof.mjs
// The code under test is the bots' own: townstyle.mjs orientAim (the face, the yaw, the cursor) and buildbot.mjs botBuildEffects (the
// aimed look + block_place with a sequence, acknowledged) -- the click a build visit sends. Arena (RCON on a sandbox only): a stone
// floor far from spawn; per CASE one empty cell, its support (the floor, a block in the floor's place, or a block above on a post),
// and any PRE blocks the case needs (a stone in a bed's head cell). The bot stands south-west of the cell.
// Every case is read back BY THE SERVER (`execute if block x y z <state>`) at every cell the case names (a bed's foot AND head; both
// halves of a chest pair), and a NEGATIVE case must leave its cell empty (a bed whose head cell is blocked; a lantern under a TOP
// slab). PASS: every positive case reads its states, every negative case reads its cell unchanged.
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

const BOT_ROOT = process.env.BOT_ROOT || '.'
const req = createRequire(path.join(path.resolve(BOT_ROOT), 'bots', 'package.json'))
const mineflayer = req('mineflayer')
const TS = await import(path.resolve(BOT_ROOT, 'bots/src/townstyle.mjs'))
const BB = await import(path.resolve(BOT_ROOT, 'bots/src/buildbot.mjs'))

const SERVER = process.env.SBX || 'sandbox6'
const PORT = Number(process.env.PORT || 25604)
const REPS = Number(process.env.REPS || 2)
const NAME = 'sbx-Cottage2F'
const SSH = ['-o', 'BatchMode=yes', 'mike@10.0.0.30']
const rcon = (...cmds) => {
  const out = execFileSync('ssh', [...SSH, `python3 /tmp/sbx-rcon.py ${SERVER} -`], { input: cmds.join('\n') + '\n', encoding: 'utf8', timeout: 180000 })
  const res = []; let cur = null
  for (const line of out.split('\n')) { if (line.startsWith('> ')) { cur = { cmd: line.slice(2), reply: '' }; res.push(cur) } else if (cur) cur.reply += (cur.reply ? '\n' : '') + line }
  return res
}
const sleep = ms => new Promise(r => setTimeout(r, ms))
const T0 = Date.now()
const P = (...a) => console.log(`[${((Date.now() - T0) / 1000).toFixed(1)}]`, ...a.map(x => (typeof x === 'string' ? x : JSON.stringify(x))))

const X0 = 240, Y = 150, Z0 = 240
const PER_ROW = 10
const cellOf = i => [X0 + 6 * (i % PER_ROW), Y, Z0 + 6 * Math.floor(i / PER_ROW)]
const BELOW = [0, -1, 0]
const ABOVE = [0, 1, 0]
const FACINGS = ['north', 'east', 'south', 'west']
const D = { north: [0, 0, -1], south: [0, 0, 1], east: [1, 0, 0], west: [-1, 0, 0] }
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]

function cases () {
  const out = []
  // BEDS: every facing clicked on the floor; every facing clicked on a SIDE support (never in the head's way); the head blocked (negative)
  for (const facing of FACINGS) {
    const ws = { facing, part: 'foot' }
    const side = facing === 'east' || facing === 'west' ? [0, 0, -1] : [-1, 0, 0]
    out.push({ id: `bed-${facing}-floor`, name: 'white_bed', ws, sup: BELOW, expect: [[[0, 0, 0], `white_bed[facing=${facing},part=foot]`], [D[facing], `white_bed[facing=${facing},part=head]`]] })
    out.push({ id: `bed-${facing}-side`, name: 'red_bed', ws, sup: side, expect: [[[0, 0, 0], `red_bed[facing=${facing},part=foot]`], [D[facing], `red_bed[facing=${facing},part=head]`]] })
  }
  out.push({ id: 'bed-north-head-blocked', name: 'white_bed', ws: { facing: 'north', part: 'foot' }, sup: BELOW, pre: [[D.north, 'stone']], negative: true, expect: [[[0, 0, 0], 'air']] })
  // CHESTS: every facing on the floor (single); a PAIR (two cells ACROSS the facing, the same facing) must JOIN into a double
  for (const facing of FACINGS) out.push({ id: `chest-${facing}`, name: 'chest', ws: { facing }, sup: BELOW, expect: [[[0, 0, 0], `chest[facing=${facing},type=single]`]] })
  for (const facing of ['west', 'north']) {
    const across = facing === 'west' ? [0, 0, 1] : [1, 0, 0]
    out.push({ id: `chestpair-${facing}`, name: 'chest', ws: { facing }, sup: BELOW, second: across, expect: [[[0, 0, 0], `chest[facing=${facing}]`], [across, `chest[facing=${facing}]`]], pairTypes: true })
  }
  // LANTERNS: standing on a FENCE top (the lamp post), hanging under a BOTTOM stair (an eave) and a BOTTOM slab (a canopy); under a TOP
  // slab it must FAIL (its underside is not a full face) -- the negative that shows the instrument sees a refusal
  out.push({ id: 'lantern-on-fence', name: 'lantern', ws: { hanging: 'false' }, sup: BELOW, supBlock: 'spruce_fence', expect: [[[0, 0, 0], 'lantern[hanging=false]'], [BELOW, 'spruce_fence']] })
  out.push({ id: 'lantern-under-bottom-stair', name: 'lantern', ws: { hanging: 'true' }, sup: ABOVE, supBlock: 'spruce_stairs[facing=south,half=bottom]', expect: [[[0, 0, 0], 'lantern[hanging=true]']] })
  out.push({ id: 'lantern-under-bottom-slab', name: 'lantern', ws: { hanging: 'true' }, sup: ABOVE, supBlock: 'spruce_slab[type=bottom]', expect: [[[0, 0, 0], 'lantern[hanging=true]']] })
  // run 1: with the floor under the cell the lantern did not refuse -- it LANDED STANDING (vanilla tries the other side): the cell's state
  // check (stateOk hanging=true) is what catches it. Here the floor under the cell is dug first (`pre` air) so the refusal shows.
  out.push({ id: 'lantern-under-top-slab', name: 'lantern', ws: { hanging: 'true' }, sup: ABOVE, supBlock: 'spruce_slab[type=top]', pre: [[BELOW, 'air']], negative: true, expect: [[[0, 0, 0], 'air']] })
  out.push({ id: 'lantern-under-top-slab-floor', name: 'lantern', ws: { hanging: 'true' }, sup: ABOVE, supBlock: 'spruce_slab[type=top]', negative: true, expect: [[[0, 0, 0], 'lantern[hanging=false]']] })
  // THE TORCH FALLBACK on a fence top; a FENCE on the floor; a BOTTOM SLAB on a fence top (the awning's first slab)
  out.push({ id: 'torch-on-fence', name: 'torch', ws: null, sup: BELOW, supBlock: 'spruce_fence', expect: [[[0, 0, 0], 'torch']] })
  out.push({ id: 'fence-on-floor', name: 'spruce_fence', ws: null, sup: BELOW, expect: [[[0, 0, 0], 'spruce_fence']] })
  out.push({ id: 'slab-on-fence', name: 'spruce_slab', ws: { type: 'bottom' }, sup: BELOW, supBlock: 'spruce_fence', expect: [[[0, 0, 0], 'spruce_slab[type=bottom]']] })
  // THE WINDOW BOX: a moss block on the floor, then a flower (and a fern) on the moss's top face
  out.push({ id: 'moss-on-floor', name: 'moss_block', ws: null, sup: BELOW, expect: [[[0, 0, 0], 'moss_block']] })
  for (const fl of ['poppy', 'dandelion', 'fern', 'cornflower']) out.push({ id: `${fl}-on-moss`, name: fl, ws: null, sup: BELOW, supBlock: 'moss_block', expect: [[[0, 0, 0], fl]] })
  return out
}
// beds do not stack: 16 of each filled the bag and the later cases had no item (run 1)
const ITEMS = { white_bed: 6, red_bed: 5, chest: 32, lantern: 16, torch: 16, spruce_fence: 16, spruce_slab: 16, moss_block: 16, poppy: 8, dandelion: 8, fern: 8, cornflower: 8 }

async function main () {
  const all = cases()
  P('cases', all.length, 'reps', REPS)
  const W = 6 * PER_ROW + 6, DD = 6 * Math.ceil(all.length / PER_ROW) + 6
  rcon(`forceload add ${X0 - 8} ${Z0 - 8} ${X0 + W} ${Z0 + DD}`, 'gamerule doTileDrops false')
  const bot = mineflayer.createBot({ host: '10.0.0.30', port: PORT, username: NAME, auth: 'offline', version: '1.21.8' })
  await new Promise((res, rej) => { bot.once('spawn', res); bot.once('error', rej); setTimeout(() => rej(new Error('no spawn')), 60000) })
  P('spawned')
  rcon(`gamemode survival ${NAME}`, `clear ${NAME}`, `effect give ${NAME} minecraft:resistance infinite 5 true`)
  const e = BB.botBuildEffects(bot, {})
  const results = []
  // the case's cell: BELOW + supBlock puts the support block IN the floor cell's place, so the cell is one up
  const cellFor = (c, i) => { const q = cellOf(i); return c.sup === BELOW && c.supBlock ? [q[0], q[1] + 1, q[2]] : q }
  for (let rep = 0; rep < REPS; rep++) {
    rcon(`fill ${X0 - 4} ${Y - 1} ${Z0 - 4} ${X0 + W} ${Y - 1} ${Z0 + DD} minecraft:stone`,
      `fill ${X0 - 4} ${Y} ${Z0 - 4} ${X0 + W} ${Y + 6} ${Z0 + DD} minecraft:air`,
      `kill @e[type=item,x=${X0 - 6},y=${Y - 3},z=${Z0 - 6},dx=${W + 12},dy=14,dz=${DD + 12}]`,
      `clear ${NAME}`, ...Object.entries(ITEMS).map(([n, c]) => `give ${NAME} minecraft:${n} ${c}`))
    const setup = []
    all.forEach((c, i) => {
      const cell = cellFor(c, i)
      const sup = add(cell, c.sup)
      if (c.sup === ABOVE) setup.push(`setblock ${sup[0] + 1} ${Y} ${sup[2]} minecraft:stone`, `setblock ${sup[0] + 1} ${Y + 1} ${sup[2]} minecraft:stone`)   // a post beside, the support on it
      if (c.sup !== BELOW || c.supBlock) setup.push(`setblock ${sup[0]} ${sup[1]} ${sup[2]} minecraft:${c.supBlock ?? 'stone'}`)
      for (const [off, b] of c.pre ?? []) { const q = add(cell, off); setup.push(`setblock ${q[0]} ${q[1]} ${q[2]} minecraft:${b}`) }
    })
    rcon(...setup)
    await sleep(1500)
    for (let i = 0; i < all.length; i++) {
      const c = all[i]
      const cell = cellFor(c, i)
      const q0 = cellOf(i)
      const face = c.sup.map(v => (v === 0 ? 0 : -v))
      rcon(`tp ${NAME} ${q0[0] - 2 + 0.5} ${Y} ${q0[2] + 2 + 0.5} 0 0`)
      await sleep(700)
      const row = { rep, i, id: c.id, name: c.name, ws: c.ws, face, negative: !!c.negative }
      const clickAt = async target => {
        const sp = add(target, c.sup)
        const aim = TS.orientAim(c.name, c.ws, face)
        if (!aim) return { result: 'no_aim' }
        if (!(await e.hold(c.name))) return { result: 'no_item' }
        const seq = e.nextSeq()
        await e.look(sp, face, aim)
        e.send(sp, face, seq, aim)
        return { aim, ack: await e.waitAck(seq, 3000) }
      }
      Object.assign(row, await clickAt(cell))
      if (c.second) {
        const c2 = add(cell, c.second)
        row.second = await clickAt(c2)
      }
      await sleep(300)
      row.reads = []
      for (const [off, want] of c.expect) {
        const q = add(cell, off)
        const r = rcon(`execute if block ${q[0]} ${q[1]} ${q[2]} minecraft:${want}`)
        row.reads.push({ at: q, want, ok: /passed/i.test(r[0].reply) })
      }
      if (c.pairTypes) {
        const a = rcon(`execute if block ${cell[0]} ${cell[1]} ${cell[2]} minecraft:chest[type=single]`)
        row.pairJoined = !/passed/i.test(a[0].reply)
      }
      // the client's own model of the cell (getProperties): what stateOk reads in a visit
      const b = e.read(...cell)
      row.client = b ? `${b.name}${JSON.stringify(b.props)}` : null
      row.clientOk = !c.negative && !!b && b.name === c.name && TS.stateOk(b.props, c.ws)
      row.server = row.reads.every(r => r.ok) && (!c.pairTypes || row.pairJoined) ? 'ok' : 'miss'
      results.push(row)
      if (row.server !== 'ok') P('MISS', row)
    }
    const mine = results.filter(r => r.rep === rep)
    P(`rep ${rep}: ok ${mine.filter(r => r.server === 'ok').length}/${mine.length} (negatives ${mine.filter(r => r.negative && r.server === 'ok').length}/${mine.filter(r => r.negative).length}), acked ${mine.filter(r => r.ack === 'acked').length}, client agrees ${mine.filter(r => !r.negative && r.clientOk === (r.server === 'ok')).length}/${mine.filter(r => !r.negative).length}`)
  }
  const out = process.env.OUT || path.join(path.dirname(new URL(import.meta.url).pathname), 'furnish-proof.jsonl')
  fs.writeFileSync(out, results.map(r => JSON.stringify(r)).join('\n') + '\n')
  const byId = {}
  for (const r of results) { byId[r.id] = byId[r.id] ?? [0, 0]; byId[r.id][1]++; if (r.server === 'ok') byId[r.id][0]++ }
  P(`SUMMARY ok ${results.filter(r => r.server === 'ok').length}/${results.length}; by case ${JSON.stringify(byId)}`)
  P('wrote', out)
  bot.quit(); await sleep(500)
  rcon(`fill ${X0 - 4} ${Y - 1} ${Z0 - 4} ${X0 + W} ${Y + 6} ${Z0 + DD} minecraft:air`, 'gamerule doTileDrops true', `forceload remove ${X0 - 8} ${Z0 - 8} ${X0 + W} ${Z0 + DD}`)
  e.close()
  process.exit(0)
}
main().catch(err => { P('FAIL', err.stack); process.exit(1) })
