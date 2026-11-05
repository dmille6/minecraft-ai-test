// SANDBOX-ONLY (townstyle-01, 2026-11-04): CAN A BOT PLACE EACH ORIENTED BLOCK A PITCHED ROOF NEEDS, IN EACH STATE, RELIABLY?
//   BOT_ROOT=<worktree> SBX=sandbox4 PORT=25602 REPS=2 node sandbox/townstyle/orient-proof.mjs [--arm cand|lookat|race|all]
// The code under test is the bots' own: townstyle.mjs orientAim (which face, which yaw, which cursor) and buildbot.mjs botBuildEffects
// (the aimed look + block_place with a sequence, acknowledged). Arena (RCON on a sandbox only): a stone floor at y=Y-1 far from spawn;
// for each CASE one empty cell, one support block (below = the floor, or a stone block beside the cell); the bot is set (RCON tp)
// SOUTH-WEST of the cell, 2 blocks away on the floor, so its natural look at the face points north-east (the controls' bias).
// Every case is read back BY THE SERVER (`execute if block x y z <name>[state]`), and by the client's own model (getProperties).
// ARMS
//   cand    the aimed click: e.look(support, face, aim) then e.send(support, face, seq, aim) (look packet + block_place in one write)
//   lookat  the CURRENT actuator (positive control of the instrument): look at the face centre, cursor at the face centre, no aim
//   race    the yaw set by bot.look(yaw, force) and the click sent in the same tick WITHOUT the look packet (the race the aim removes)
// PASS (cand): every case's server state equals the target, every click acknowledged. The controls must MISS some cases, or the
// instrument could not have seen a wrong state.
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { createRequire } from 'node:module'

const BOT_ROOT = process.env.BOT_ROOT || '.'
const req = createRequire(path.join(path.resolve(BOT_ROOT), 'bots', 'package.json'))
const mineflayer = req('mineflayer')
const { Vec3 } = req('vec3')
const TS = await import(path.resolve(BOT_ROOT, 'bots/src/townstyle.mjs'))
const BB = await import(path.resolve(BOT_ROOT, 'bots/src/buildbot.mjs'))

const SERVER = process.env.SBX || 'sandbox4'
const PORT = Number(process.env.PORT || 25602)
const REPS = Number(process.env.REPS || 2)
const NAME = 'sbx-OrientProof'
const ARMARG = (process.argv.find(a => a.startsWith('--arm=')) ?? '--arm=all').slice(6)
const ARMS = ARMARG === 'all' ? ['cand', 'lookat', 'race'] : ARMARG.split(',')
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

const X0 = 40, Y = 150, Z0 = 40
const PER_ROW = 13
// the CELL of case i: a grid 13 wide, 5 apart
const cellOf = i => [X0 + 5 * (i % PER_ROW), Y, Z0 + 5 * Math.floor(i / PER_ROW)]
// SIDE supports: the support's offset from the cell (the face normal is its negation)
const SIDES = { west: [-1, 0, 0], east: [1, 0, 0], north: [0, 0, -1], south: [0, 0, 1] }
const BELOW = [0, -1, 0]
const FACINGS = ['north', 'east', 'south', 'west']
function cases () {
  const out = []
  for (const name of ['oak_stairs', 'stone_brick_stairs']) for (const facing of FACINGS) for (const half of ['bottom', 'top']) {
    if (half === 'bottom') out.push({ name, ws: { facing, half }, sup: BELOW })
    for (const s of Object.values(SIDES)) out.push({ name, ws: { facing, half }, sup: s })
  }
  for (const name of ['oak_slab', 'cobblestone_slab']) for (const type of ['bottom', 'top']) {
    if (type === 'bottom') out.push({ name, ws: { type }, sup: BELOW })
    for (const s of Object.values(SIDES)) out.push({ name, ws: { type }, sup: s })
  }
  for (const name of ['spruce_log']) {
    out.push({ name, ws: { axis: 'y' }, sup: BELOW })
    for (const s of Object.values(SIDES)) out.push({ name, ws: { axis: s[0] !== 0 ? 'x' : 'z' }, sup: s })
  }
  for (const name of ['spruce_trapdoor']) for (const half of ['bottom', 'top']) for (const s of Object.values(SIDES)) {
    const face = s.map(v => (v === 0 ? 0 : -v))
    out.push({ name, ws: { facing: { '1,0': 'east', '-1,0': 'west', '0,1': 'south', '0,-1': 'north' }[`${face[0]},${face[2]}`], half, open: 'false' }, sup: s })
  }
  out.push({ name: 'lantern', ws: { hanging: 'false' }, sup: BELOW })
  return out
}
// THE BLIND SCENE (--scene=blind): clicks a client could not SEE -- a top face ABOVE the eye, a side face from BEHIND its plane, a
// face whose sight line crosses a solid block -- each with the bot's feet at the case's origin (`stand` relative to the cell), the
// state still asked of it. The question: does Paper place on reach alone (the rule a pitched roof's upper courses need from the floor)?
function blindCases () {
  const out = []
  const kinds = [['spruce_stairs', f => ({ facing: f, half: 'bottom' })], ['spruce_stairs', f => ({ facing: f, half: 'top' })], ['spruce_slab', () => ({ type: 'bottom' })], ['spruce_planks', () => null]]
  for (const [name, st] of kinds) for (const facing of FACINGS) {
    const ws = st(facing)
    if (!ws && facing !== 'north') continue
    // B1 a top face above the eye: the support's top 1.38 / 2.38 / 3.38 above the eye (cell y+2/+3/+4 over the feet), 1-2 out
    for (const [dx, dy] of [[1, 2], [2, 3], [1, 4]]) if (!(ws?.half === 'top')) out.push({ blind: 'above', name, ws, sup: BELOW, stand: [-dx, -dy, 0], obstruct: null })
    // B2 a side face from behind: the support between the bot and the cell, its FAR face clicked (the eye behind the face's plane)
    out.push({ blind: 'behind', name, ws, sup: [-1, 0, 0], stand: [-3, -1, 0], obstruct: null })
    // B3 a face whose sight line crosses a solid: the support below the cell, a stone in the way at eye height
    if (!(ws?.half === 'top')) out.push({ blind: 'through', name, ws, sup: BELOW, stand: [-2, -1, 0], obstruct: [-1, 0, 0] })
  }
  return out
}
const ITEMS = { oak_stairs: 64, stone_brick_stairs: 64, oak_slab: 64, cobblestone_slab: 64, spruce_log: 64, spruce_trapdoor: 64, lantern: 16, spruce_stairs: 64, spruce_slab: 64, spruce_planks: 64 }

async function main () {
  const SCENE = (process.argv.find(a => a.startsWith('--scene=')) ?? '--scene=orient').slice(8)
  const all = SCENE === 'blind' ? blindCases() : cases()
  P('cases per arm per rep', all.length, 'arms', ARMS, 'reps', REPS)
  const W = 5 * PER_ROW + 4, D = 5 * Math.ceil(all.length / PER_ROW) + 4
  rcon(`forceload add ${X0 - 8} ${Z0 - 8} ${X0 + W} ${Z0 + D}`, `gamerule doTileDrops false`)
  const bot = mineflayer.createBot({ host: '10.0.0.30', port: PORT, username: NAME, auth: 'offline', version: '1.21.8' })
  await new Promise((res, rej) => { bot.once('spawn', res); bot.once('error', rej); setTimeout(() => rej(new Error('no spawn')), 60000) })
  P('spawned')
  rcon(`gamemode survival ${NAME}`, `clear ${NAME}`, `effect give ${NAME} minecraft:resistance infinite 5 true`)
  const e = BB.botBuildEffects(bot, {})
  const results = []
  for (const arm of ARMS) for (let rep = 0; rep < REPS; rep++) {
    // a clean strip: air above a stone floor
    rcon(`fill ${X0 - 4} ${Y - 1} ${Z0 - 4} ${X0 + W} ${Y - 1} ${Z0 + D} minecraft:stone`,
      `fill ${X0 - 4} ${Y} ${Z0 - 4} ${X0 + W} ${Y + 4} ${Z0 + D} minecraft:air`,
      `kill @e[type=item,x=${X0 - 6},y=${Y - 3},z=${Z0 - 6},dx=${W + 12},dy=12,dz=${D + 12}]`,
      `clear ${NAME}`, ...Object.entries(ITEMS).map(([n, c]) => `give ${NAME} minecraft:${n} ${c}`))
    const setup = []
    all.forEach((c, i) => {
      const q = cellOf(i)
      if (c.stand) {
        // the cell sits -stand[1] above the feet; the support (and a pillar under it down to the floor) is stone
        const cell = [q[0], q[1] - c.stand[1], q[2]]
        const sup = [cell[0] + c.sup[0], cell[1] + c.sup[1], cell[2] + c.sup[2]]
        for (let y = Y; y <= sup[1]; y++) setup.push(`setblock ${sup[0]} ${y} ${sup[2]} minecraft:stone`)
        if (c.obstruct) setup.push(`setblock ${cell[0] + c.obstruct[0]} ${cell[1] + c.obstruct[1]} ${cell[2] + c.obstruct[2]} minecraft:stone`)
      } else if (c.sup !== BELOW) setup.push(`setblock ${q[0] + c.sup[0]} ${q[1] + c.sup[1]} ${q[2] + c.sup[2]} minecraft:stone`)
    })
    rcon(...setup)
    await sleep(1500)
    for (let i = 0; i < all.length; i++) {
      const c = all[i]
      const q0 = cellOf(i)
      const cell = c.stand ? [q0[0], q0[1] - c.stand[1], q0[2]] : q0
      const support = [cell[0] + c.sup[0], cell[1] + c.sup[1], cell[2] + c.sup[2]]
      const face = [-c.sup[0], -c.sup[1], -c.sup[2]].map(v => v + 0)
      // stand SOUTH-WEST of the cell, 2 away (the natural look points north-east); a blind case at its own stand
      if (c.stand) rcon(`tp ${NAME} ${cell[0] + c.stand[0] + 0.5} ${Y} ${cell[2] + c.stand[2] + 0.5} 0 0`)
      else rcon(`tp ${NAME} ${cell[0] - 2 + 0.5} ${Y} ${cell[2] + 2 + 0.5} 0 0`)
      await sleep(700)
      const aim = TS.orientAim(c.name, c.ws, face)
      const eyeAt = c.stand ? [cell[0] + c.stand[0] + 0.5, Y + 1.62, cell[2] + c.stand[2] + 0.5] : null
      const fc = [support[0] + 0.5 + face[0] * 0.5, support[1] + 0.5 + face[1] * 0.5, support[2] + 0.5 + face[2] * 0.5]
      const row = { arm, rep, i, name: c.name, want: TS.stateKey(c.name, c.ws), face, aim, ...(c.blind ? { blind: c.blind, eyeToFace: Number(Math.hypot(fc[0] - eyeAt[0], fc[1] - eyeAt[1], fc[2] - eyeAt[2]).toFixed(2)), eyeBelowFace: Number((fc[1] - eyeAt[1]).toFixed(2)) } : {}) }
      if (!aim) { row.result = 'no_aim'; results.push(row); P(row); continue }
      if (!(await e.hold(c.name))) { row.result = 'no_item'; results.push(row); P(row); continue }
      const seq = e.nextSeq()
      if (arm === 'cand') {
        await e.look(support, face, aim)
        e.send(support, face, seq, aim)
      } else if (arm === 'lookat') {
        await e.look(support, face)
        e.send(support, face, seq)
      } else if (arm === 'race') {
        await e.look(support, face)
        if (Number.isFinite(aim.yaw)) await bot.look(BB.yawRad(aim.yaw), bot.entity.pitch, true)
        e.send(support, face, seq, { cursor: aim.cursor })   // the cursor right, the yaw left to mineflayer's next tick
      }
      row.ack = await e.waitAck(seq, 3000)
      await sleep(250)
      const r = rcon(`execute if block ${cell[0]} ${cell[1]} ${cell[2]} minecraft:${row.want}`, `execute if block ${cell[0]} ${cell[1]} ${cell[2]} minecraft:${c.name}`)
      row.server = /passed/i.test(r[0].reply) ? 'ok' : /passed/i.test(r[1].reply) ? 'wrong_state' : 'absent'
      const b = e.read(...cell)
      row.client = b ? `${b.name}${JSON.stringify(b.props)}` : null
      row.clientOk = !!b && b.name === c.name && TS.stateOk(b.props, c.ws)
      results.push(row)
      if (row.server !== 'ok') P('MISS', row)
    }
    const mine = results.filter(r => r.arm === arm && r.rep === rep)
    P(`ARM ${arm} rep ${rep}: server ok ${mine.filter(r => r.server === 'ok').length}/${mine.length}, client ok ${mine.filter(r => r.clientOk).length}, acked ${mine.filter(r => r.ack === 'acked').length}, wrong_state ${mine.filter(r => r.server === 'wrong_state').length}, absent ${mine.filter(r => r.server === 'absent').length}`)
  }
  const fs = await import('node:fs')
  const out = process.env.OUT || `orient-proof-${Date.now()}.jsonl`
  fs.writeFileSync(out, results.map(r => JSON.stringify(r)).join('\n') + '\n')
  for (const arm of ARMS) {
    const a = results.filter(r => r.arm === arm)
    const byKind = {}
    for (const r of a) { const k = r.blind ? `${r.blind}:${r.name.replace(/^(oak|stone_brick|cobblestone|spruce)_/, '')}` : r.name.replace(/^(oak|stone_brick|cobblestone|spruce)_/, ''); byKind[k] = byKind[k] ?? [0, 0]; byKind[k][1]++; if (r.server === 'ok') byKind[k][0]++ }
    P(`SUMMARY ${arm}: server ok ${a.filter(r => r.server === 'ok').length}/${a.length}; client agrees ${a.filter(r => r.clientOk === (r.server === 'ok')).length}/${a.length}; acked ${a.filter(r => r.ack === 'acked').length}/${a.length}; by kind ${JSON.stringify(byKind)}`)
  }
  P('wrote', out)
  bot.quit(); await sleep(500)
  rcon(`fill ${X0 - 4} ${Y - 1} ${Z0 - 4} ${X0 + W} ${Y + 4} ${Z0 + D} minecraft:air`, `gamerule doTileDrops true`, `forceload remove ${X0 - 8} ${Z0 - 8} ${X0 + W} ${Z0 + D}`)
  e.close()
  process.exit(0)
}
main().catch(err => { P('FAIL', err.stack); process.exit(1) })
