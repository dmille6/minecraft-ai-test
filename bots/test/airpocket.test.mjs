// AIRPOCKET (docs/reports/airpocket-design-2026-10-07.md): the dig step inside the drowning rescue.
//
// What this file proves, by BEHAVIOUR (CLAUDE.md: decisions extracted and driven, never matched as text):
//   A. airPocketPlan, cell by cell, on the measured geometries (hive-c's stone roof over deep water, hive-d's ice),
//      with the positive control that the dry roof IS planned for every refusal;
//   B. the envelope and the admission budget (peaceful 0.5 HP/s, anything else 2.0, 4 HP reserve, x1.5 + 3 s);
//   C. the breach detector on the SANDBOX's own peaceful health series (must not fire) and on `easy` (must fire);
//   D. breathing confirmation: flat health is NOT success; rising or at-maximum is;
//   E. the trigger: never with an up route, at once when sealed, after 8 s otherwise, never during a cooldown;
//   F. the step itself on a fake bot: success, abort on a breach (dig stopped), ice, never-rose, roof changed;
//   G. the wiring in reflex.mjs (structural, comments stripped, each assertion seen to fail on a mutant);
//   H. anchored mutants (present AND unique, `withMutant`) for every decision line.
import assert from 'node:assert'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { airPocketInputs, airPocketAfter, airPocketPreempt, AP_FAIL_COOLDOWN_MS } from '../src/airpocket.mjs'
import { airPocketPlan, airPocketEnvelope, airPocketAdmit, airPocketBudgetMs, envelopeBreached, airPocketConfirmed,
         airPocketTrigger, pickFastestTool, airPocketStep, airPocketDetail, AP_TRIGGER_AFTER_MS } from '../src/airpocket.mjs'

let pass = 0, fail = 0
const t = (name, fn) => Promise.resolve()
  .then(fn)
  .then(() => { pass++; console.log(`  PASS  ${name}`) })
  .catch(e => { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) })

const AP_PATH = new URL('../src/airpocket.mjs', import.meta.url)
const REFLEX_PATH = new URL('../src/reflex.mjs', import.meta.url)

async function withMutant (path, old, neu, fn) {
  const src = readFileSync(path, 'utf8')
  assert.ok(src.includes(old),
    `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 60))} is not in ${path.pathname}. ` +
    'A mutant that was never written reads as killed.')
  assert.ok(src.split(old).length === 2, 'the mutation target is not unique; the mutant is ambiguous')
  const body = src.replace(old, neu).replace(/from '\.\//g, "from '../src/")
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, body)
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}

// ---------------------------------------------------------------- fixtures
const B = (name, extra = {}) => ({ name, boundingBox: /^(air|cave_air|water|lava|kelp|kelp_plant|seagrass|tall_seagrass|bubble_column)$/.test(name) ? 'empty' : 'block', ...extra })
// cells relative to the FEET cell; anything not listed is stone
function world (cells = {}, dflt = 'stone') {
  return (dx, dy, dz) => {
    const k = `${dx},${dy},${dz}`
    if (k in cells) return cells[k] === null ? null : B(cells[k])
    return B(dflt)
  }
}
// hive-c, -67,60,-64: feet + head in water, stone roof at +2 with stone around and above, deep water below
const HIVE_C = { '0,0,0': 'water', '0,1,0': 'water', '0,2,0': 'stone', '0,3,0': 'stone' }
// hive-d, 111,60,133: feet + head water, water at +2, ICE at +3 (the lake's frozen surface), air above
const HIVE_D = { '0,0,0': 'water', '0,1,0': 'water', '0,2,0': 'water', '0,3,0': 'ice', '0,4,0': 'air',
                 '1,3,0': 'ice', '-1,3,0': 'water', '0,3,1': 'ice', '0,3,-1': 'ice' }

// ---------------------------------------------------------------- A. the plan
await t('A1 hive-c: a stone roof over the head with stone around and above is planned as a POCKET at +2', () => {
  const p = airPocketPlan(world(HIVE_C))
  assert.deepEqual([p.ok, p.kind, p.dy, p.name], [true, 'pocket', 2, 'stone'])
})
await t('A2 one water cell between head and roof: the roof at +3 is planned (within 2 of the head)', () => {
  const p = airPocketPlan(world({ ...HIVE_C, '0,2,0': 'water' }))
  assert.deepEqual([p.ok, p.kind, p.dy], [true, 'pocket', 3])
})
await t('A3 water at +2 and +3: no roof within 2 -> refused', () => {
  const p = airPocketPlan(world({ ...HIVE_C, '0,2,0': 'water', '0,3,0': 'water' }))
  assert.equal(p.ok, false); assert.match(p.why, /no roof within 2/)
})
await t('A4 air above the head: refused (the rescue swims; nothing to dig)', () => {
  const p = airPocketPlan(world({ ...HIVE_C, '0,2,0': 'air' }))
  assert.equal(p.ok, false); assert.match(p.why, /air above/)
})
await t('A5 water BESIDE the roof cell: refused (the pocket would flood) -- and the dry roof is the positive control', () => {
  for (const side of ['1,2,0', '-1,2,0', '0,2,1', '0,2,-1']) {
    const p = airPocketPlan(world({ ...HIVE_C, [side]: 'water' }))
    assert.equal(p.ok, false, side); assert.match(p.why, /beside the roof cell/)
  }
  assert.equal(airPocketPlan(world(HIVE_C)).ok, true)
})
await t('A6 water / lava / sand ABOVE the roof cell: refused', () => {
  for (const [above, rx] of [['water', /above the roof cell would fill/], ['lava', /above the roof cell would fill/], ['sand', /would fall in/]]) {
    const p = airPocketPlan(world({ ...HIVE_C, '0,3,0': above }))
    assert.equal(p.ok, false, above); assert.match(p.why, rx)
  }
})
await t('A7 the roof cell itself lava / gravel / bedrock / chest / a torch: refused', () => {
  for (const [roof, rx] of [['lava', /lava above the head/], ['gravel', /would fall/], ['bedrock', /not dug/], ['chest', /not dug/]]) {
    const p = airPocketPlan(world({ ...HIVE_C, '0,2,0': roof }))
    assert.equal(p.ok, false, roof); assert.match(p.why, rx)
  }
  const torch = airPocketPlan((dx, dy, dz) => (dx === 0 && dy === 2 && dz === 0) ? { name: 'torch', boundingBox: 'empty' } : world(HIVE_C)(dx, dy, dz))
  assert.equal(torch.ok, false); assert.match(torch.why, /not a full block/)
})
await t('A8 hive-d: ICE with air directly above is planned as ICE; ice with stone above is refused', () => {
  const p = airPocketPlan(world(HIVE_D))
  assert.deepEqual([p.ok, p.kind, p.dy, p.name], [true, 'ice', 3, 'ice'])
  const q = airPocketPlan(world({ ...HIVE_D, '0,4,0': 'stone' }))
  assert.equal(q.ok, false); assert.match(q.why, /ice with stone above/)
})
await t('A9 packed ice does not melt: it takes the POCKET rule (sides and top checked)', () => {
  const p = airPocketPlan(world({ ...HIVE_C, '0,2,0': 'packed_ice' }))
  assert.deepEqual([p.ok, p.kind], [true, 'pocket'])
})
await t('A10 the head cell solid (the hive-d "ice in the head cell" sites): refused', () => {
  const p = airPocketPlan(world({ ...HIVE_C, '0,1,0': 'ice' }))
  assert.equal(p.ok, false); assert.match(p.why, /head cell is ice/)
})
await t('A11 unknown cells refuse: the roof, a side, the top', () => {
  for (const k of ['0,2,0', '1,2,0', '0,3,0']) {
    const p = airPocketPlan(world({ ...HIVE_C, [k]: null }))
    assert.equal(p.ok, false, k); assert.match(p.why, /unknown/)
  }
})
await t('A12 a WATERLOGGED side is water', () => {
  const wl = (dx, dy, dz) => (dx === 1 && dy === 2 && dz === 0) ? { name: 'oak_stairs', boundingBox: 'block', getProperties: () => ({ waterlogged: true }) } : world(HIVE_C)(dx, dy, dz)
  const p = airPocketPlan(wl)
  assert.equal(p.ok, false); assert.match(p.why, /beside the roof cell/)
})

// ---------------------------------------------------------------- B. envelope and admission
await t('B1 envelope: peaceful 0.5; easy / normal / unknown 2.0; peaceful with Hunger 2.0', () => {
  assert.equal(airPocketEnvelope({ difficulty: 'peaceful' }), 0.5)
  for (const d of ['easy', 'normal', 'hard', null, undefined]) assert.equal(airPocketEnvelope({ difficulty: d }), 2.0, String(d))
  assert.equal(airPocketEnvelope({ difficulty: 'peaceful', hungerActive: true }), 2.0)
})
await t('B2 a floating stone dig (14,100 ms, sandbox) at 19 HP: admitted on peaceful, refused on easy', () => {
  const p = airPocketAdmit({ health: 19, difficulty: 'peaceful', digMs: 14100 })
  assert.equal(p.ok, true); assert.equal(Math.round(p.requiredMs), 24150); assert.equal(Math.round(p.budgetMs), 30000)
  const e = airPocketAdmit({ health: 19, difficulty: 'easy', digMs: 14100 })
  assert.equal(e.ok, false); assert.equal(Math.round(e.budgetMs), 7500)
})
await t('B3 the 4 HP reserve: at 6 HP on peaceful the budget is 4 s, so even a 2.9-s floor dig is refused', () => {
  assert.equal(Math.round(airPocketBudgetMs({ health: 6, envelope: 0.5 })), 4000)
  assert.equal(airPocketAdmit({ health: 6, difficulty: 'peaceful', digMs: 2900 }).ok, false)
  assert.equal(airPocketAdmit({ health: 19, difficulty: 'peaceful', digMs: 2900 }).ok, true)
  assert.equal(airPocketBudgetMs({ health: 3, envelope: 0.5 }), 0)
})
await t('B4 an unknown dig time is refused', () => {
  assert.equal(airPocketAdmit({ health: 20, difficulty: 'peaceful', digMs: null }).ok, false)
  assert.equal(airPocketAdmit({ health: 20, difficulty: 'peaceful', digMs: Infinity }).ok, false)
})

// ---------------------------------------------------------------- C. breach
// ON THE SANDBOX'S OWN SERVER-SIDE HEALTH SERIES (sandbox/drown/run1.jsonl.gz, Paper sandbox2 10-07, polled every 0.5 s):
// the peaceful trials (A_full x3, A_sat0 x2) must never breach from Air 0 to death; the easy trials (A_easy x2) must.
const RUNS = gunzipSync(readFileSync(new URL('../../sandbox/drown/run1.jsonl.gz', import.meta.url))).toString().split('\n')
  .filter(Boolean).map(l => JSON.parse(l)).filter(r => /^A_(full|sat0|easy)$/.test(r.arm))
const seriesOf = r => {
  const P = r.polls.filter(p => typeof p.hp === 'number')
  const a0 = P.find(p => p.air <= 0)?.dgt ?? 0
  const s = P.filter(p => p.dgt >= a0 && p.hp > 0).map(p => ({ t: p.dgt * 1000, hp: p.hp }))
  // the polls continue after the respawn at 20 HP: cut the series at its lowest point (the last poll before death)
  let lo = 0; for (let i = 0; i < s.length; i++) if (s[i].hp <= s[lo].hp) lo = i
  return s.slice(0, lo + 1)
}
const firstBreach = s => s.findIndex((_, i) => envelopeBreached(s.slice(0, i + 1), s[i].t))
await t('C1 the sandbox PEACEFUL series (5 trials, Air 0 to death) never breaches -- and has data (positive control)', () => {
  const peaceful = RUNS.filter(r => r.diff === 'peaceful')
  assert.equal(peaceful.length, 5)
  for (const r of peaceful) {
    const s = seriesOf(r)
    assert.ok(s.length > 100, `${r.arm}#${r.k}: only ${s.length} samples`)
    assert.ok(s[0].hp - s[s.length - 1].hp > 15, `${r.arm}#${r.k}: the series does not reach death`)
    assert.equal(firstBreach(s), -1, `${r.arm}#${r.k} breached`)
  }
})
await t('C2 the sandbox EASY series (2 trials) breaches before death (about 11 s after Air 0, ~7 s of saturation buffer first)', () => {
  const easy = RUNS.filter(r => r.diff === 'easy')
  assert.equal(easy.length, 2)
  for (const r of easy) {
    const s = seriesOf(r); const i = firstBreach(s)
    assert.ok(i > 0, `${r.arm}#${r.k} never breached`)
    assert.ok(s[s.length - 1].t - s[i].t >= 3000, `${r.arm}#${r.k} breached only ${s[s.length - 1].t - s[i].t} ms before death`)
  }
})
await t('C3 one 2-HP step is not a breach; samples older than 10 s are ignored', () => {
  assert.equal(envelopeBreached([{ t: 0, hp: 20 }, { t: 100, hp: 18 }], 100), false)
  assert.equal(envelopeBreached([{ t: 0, hp: 20 }, { t: 11000, hp: 12 }], 11000), false)
  assert.equal(envelopeBreached([{ t: 0, hp: 20 }, { t: 9000, hp: 12 }], 9000), true)
})

// ---------------------------------------------------------------- D. confirmation
await t('D1 flat health with the eye in air is NOT success; rising or at maximum is; under 2 s is not yet', () => {
  assert.equal(airPocketConfirmed({ eyeInAirSince: 0, now: 2500, health: 18, healthAtEyeIn: 18 }), false)
  assert.equal(airPocketConfirmed({ eyeInAirSince: 0, now: 2500, health: 18.5, healthAtEyeIn: 18 }), true)
  assert.equal(airPocketConfirmed({ eyeInAirSince: 0, now: 2500, health: 20, healthAtEyeIn: 20 }), true)
  assert.equal(airPocketConfirmed({ eyeInAirSince: 0, now: 1500, health: 19, healthAtEyeIn: 18 }), false)
  assert.equal(airPocketConfirmed({ eyeInAirSince: null, now: 9000, health: 20, healthAtEyeIn: 18 }), false)
})

// ---------------------------------------------------------------- E. trigger
await t('E1 the trigger: sealed at once; capped otherwise after 8 s; never with an up route, a cooldown or while active', () => {
  const base = { rescuing: true, routeDir: null, routeSealed: false, heldMs: 0, active: false, now: 1000, cooldownUntil: 0 }
  assert.equal(airPocketTrigger({ ...base, routeSealed: true }), true)
  assert.equal(airPocketTrigger({ ...base, heldMs: AP_TRIGGER_AFTER_MS - 1 }), false)
  assert.equal(airPocketTrigger({ ...base, heldMs: AP_TRIGGER_AFTER_MS }), true)
  assert.equal(airPocketTrigger({ ...base, routeDir: 'out', heldMs: AP_TRIGGER_AFTER_MS }), true)
  assert.equal(airPocketTrigger({ ...base, routeDir: 'up', routeSealed: true, heldMs: 99999 }), false)
  assert.equal(airPocketTrigger({ ...base, routeSealed: true, rescuing: false }), false)
  assert.equal(airPocketTrigger({ ...base, routeSealed: true, active: true }), false)
  assert.equal(airPocketTrigger({ ...base, routeSealed: true, cooldownUntil: 2000 }), false)
})
await t('E2 pickFastestTool: the fastest of hand and tools by the prediction; nothing predicted -> null', () => {
  const pick = { name: 'stone_pickaxe' }, shovel = { name: 'stone_shovel' }
  const r = pickFastestTool([pick, shovel], it => (it === pick ? 2850 : it === shovel ? 9000 : 7500))
  assert.equal(r.item, pick); assert.equal(r.ms, 2850)
  assert.equal(pickFastestTool([pick], () => null), null)
})

// ---------------------------------------------------------------- F. the step on a fake bot
class V { constructor (x, y, z) { this.x = x; this.y = y; this.z = z } equals (o) { return !!o && o.x === this.x && o.y === this.y && o.z === this.z } }
function fakeBot ({ cells = HIVE_C, health = 19, digMs = 300, rise = true, riseTo = 0.6, healthTick = 0.1, onDig = null } = {}) {
  const map = new Map(); const base = { x: 100, y: 60, z: 100 }
  for (const [k, v] of Object.entries(cells)) { const [dx, dy, dz] = k.split(',').map(Number); map.set(`${base.x + dx},${base.y + dy},${base.z + dz}`, v) }
  const get = (x, y, z) => { const k = `${x},${y},${z}`; return map.has(k) ? (map.get(k) === null ? null : B(map.get(k))) : B('stone') }
  const bot = { health, entity: { position: new V(base.x + 0.5, base.y + 0.2, base.z + 0.5) }, controls: {}, stopped: 0, digging: null,
                inventory: { items: () => [{ name: 'stone_pickaxe' }] }, equipped: null }
  bot.blockAt = v => get(Math.floor(v.x), Math.floor(v.y), Math.floor(v.z))
  bot.heldItem = null
  bot.equip = async it => { bot.equipped = it.name; bot.heldItem = it }
  bot.setControlState = (n, on) => { bot.controls[n] = on }
  bot.stopDigging = () => { bot.stopped++; if (bot.digging) { const d = bot.digging; bot.digging = null; d.rej(new Error('Digging aborted')) } }
  bot.dig = blk => new Promise((res, rej) => {
    const key = `${base.x},${base.y + (blk._dy ?? 0)},${base.z}`
    bot.digging = { rej }
    if (onDig) onDig(bot)
    setTimeout(() => {
      if (!bot.digging) return
      bot.digging = null
      // what the roof becomes: ice over water -> water, anything else -> air
      for (const [k, v] of map) if (k === key) map.set(k, v === 'ice' ? 'water' : 'air')
      if (rise) setTimeout(() => { bot.entity.position = new V(base.x + 0.5, base.y + riseTo, base.z + 0.5) }, 50)
      res()
    }, digMs)
  })
  // the roof block carries its dy so the fake knows which cell to open
  const realBlockAt = bot.blockAt
  bot.blockAt = v => { const b = realBlockAt(v); if (b) b._dy = Math.floor(v.y) - base.y; return b }
  bot._healthTimer = setInterval(() => { if (healthTick) bot.health = Math.min(20, bot.health + healthTick) }, 100)
  return bot
}
const fast = () => { const s = Date.now(); return () => s + (Date.now() - s) * 10 }   // the step's clock at 10x
const deps = (extra = {}) => ({ Vec3: V, predict: (b, item) => (/_pickaxe$/.test(item?.name ?? '') ? 300 : 7500), envelope: 0.5, now: fast(), sleep: ms => new Promise(r => setTimeout(r, ms / 10)), ...extra })

await t('F1 hive-c pocket: dig, rise, breathing confirmed with health rising -> success; jump STAYS held for the rescue release', async () => {
  const bot = fakeBot({})
  const plan = airPocketPlan(world(HIVE_C))
  const r = await airPocketStep(bot, plan, deps()); clearInterval(bot._healthTimer)
  assert.equal(r.ok, true, r.why); assert.equal(r.outcome, 'success'); assert.equal(r.tool, 'stone_pickaxe')
  assert.equal(bot.controls.jump, true)
  assert.match(airPocketDetail(r), /outcome=success kind=pocket/)
})
await t('F2 a breach during the dig stops it (stopDigging) and reports aborted, never success', async () => {
  const bot = fakeBot({ digMs: 5000, healthTick: 0, onDig: b => { const h = setInterval(() => { b.health -= 1 }, 100); setTimeout(() => clearInterval(h), 2000) } })
  // a tiny envelope makes the budget effectively infinite, so ONLY the breach can stop this dig (Codex r1: F2 accepted
  // either reason, so a mutant that deleted the breach watch could still pass it)
  const r = await airPocketStep(bot, airPocketPlan(world(HIVE_C)), deps({ now: () => Date.now(), envelope: 0.05 }))
  clearInterval(bot._healthTimer)
  assert.equal(r.ok, false); assert.equal(r.outcome, 'aborted'); assert.equal(r.why, 'envelope breached (> 7 HP in 10 s)')
  assert.ok(bot.stopped >= 1, 'the dig was not stopped')
})
await t('F3 hive-d ice: the ice opens to water and the eye rises into the air above -> success', async () => {
  const bot = fakeBot({ cells: HIVE_D, riseTo: 2.6 })   // the eye must clear the ice cell (now water) into the air above
  const r = await airPocketStep(bot, airPocketPlan(world(HIVE_D)), deps()); clearInterval(bot._healthTimer)
  assert.equal(r.ok, true, r.why); assert.equal(r.kind, 'ice')
})
await t('F4 the dig opens but the eye never reaches air -> OPENED (the pocket exists), not success', async () => {
  const bot = fakeBot({ rise: false })
  const r = await airPocketStep(bot, airPocketPlan(world(HIVE_C)), deps()); clearInterval(bot._healthTimer)
  assert.equal(r.ok, false); assert.equal(r.outcome, 'opened'); assert.match(r.why, /had not reached air/)
})
await t('F5 breathing with FLAT health is not confirmed -> OPENED, not success', async () => {
  const bot = fakeBot({ healthTick: 0 })
  const r = await airPocketStep(bot, airPocketPlan(world(HIVE_C)), deps()); clearInterval(bot._healthTimer)
  assert.equal(r.ok, false); assert.equal(r.outcome, 'opened'); assert.match(r.why, /not confirmed/)
})
await t('F6 the roof changed since the plan -> failed without digging', async () => {
  const bot = fakeBot({ cells: { ...HIVE_C, '0,2,0': 'dirt' } })
  let dug = 0; bot.dig = async () => { dug++ }
  const r = await airPocketStep(bot, airPocketPlan(world(HIVE_C)), deps()); clearInterval(bot._healthTimer)
  assert.equal(r.ok, false); assert.match(r.why, /roof cell changed/); assert.equal(dug, 0)
})
await t('F7 a held FORWARD from an `out` rescue is released before the dig; a bot carried off the column is not dug for', async () => {
  const bot = fakeBot({}); bot.controls.forward = true; bot.controls.sprint = true
  let forwardAtDig = null; const dig0 = bot.dig; bot.dig = blk => { forwardAtDig = bot.controls.forward; return dig0(blk) }
  const r = await airPocketStep(bot, airPocketPlan(world(HIVE_C)), deps()); clearInterval(bot._healthTimer)
  assert.equal(forwardAtDig, false); assert.equal(bot.controls.sprint, false); assert.equal(r.ok, true, r.why)
  const moved = fakeBot({}); let dug = 0
  moved.equip = async it => { moved.heldItem = it; moved.entity.position = new V(101.5, 60.2, 100.5) }
  moved.dig = async () => { dug++ }
  const r2 = await airPocketStep(moved, airPocketPlan(world(HIVE_C)), deps()); clearInterval(moved._healthTimer)
  assert.equal(r2.ok, false); assert.match(r2.why, /moved off the planned column/); assert.equal(dug, 0)
})
await t('F8 a REJECTED equip re-prices the dig with what is actually held: fits on peaceful, refused when it does not fit', async () => {
  const bot = fakeBot({}); bot.heldItem = { name: 'cobblestone' }; bot.equip = async () => { throw new Error('nope') }
  const r = await airPocketStep(bot, airPocketPlan(world(HIVE_C)), deps()); clearInterval(bot._healthTimer)
  assert.equal(r.tool, 'cobblestone'); assert.equal(r.predictedMs, 7500); assert.equal(r.ok, true, r.why)
  const tight = fakeBot({}); tight.heldItem = { name: 'cobblestone' }; tight.equip = async () => { throw new Error('nope') }
  let dug = 0; tight.dig = async () => { dug++ }
  const r2 = await airPocketStep(tight, airPocketPlan(world(HIVE_C)), deps({ envelope: 2.0 })); clearInterval(tight._healthTimer)
  assert.equal(r2.ok, false); assert.match(r2.why, /over the budget after equip/); assert.equal(dug, 0)
})
await t('F9 a HUNG equip is bounded (1.5 s), then priced with what is held', async () => {
  const bot = fakeBot({}); bot.equip = () => new Promise(() => {})
  const t0 = Date.now()
  const r = await airPocketStep(bot, airPocketPlan(world(HIVE_C)), deps()); clearInterval(bot._healthTimer)
  assert.ok(Date.now() - t0 < 6000, 'equip was not bounded'); assert.equal(r.tool, 'hand')
})

await t('F10 a STANDING bot digs with jump released (on-ground time, no ghost air); a FLOATING bot holds jump; both hold it for the rise', async () => {
  for (const [onGround, jumpAtDig] of [[true, false], [false, true]]) {
    const bot = fakeBot({}); bot.entity.onGround = onGround
    let atDig = null; const dig0 = bot.dig; bot.dig = blk => { atDig = bot.controls.jump; return dig0(blk) }
    let afterDig = null; const realSleep = ms => new Promise(r => setTimeout(r, ms / 10))
    const r = await airPocketStep(bot, airPocketPlan(world(HIVE_C)), deps({ sleep: async ms => { if (afterDig == null) afterDig = bot.controls.jump; return realSleep(ms) } }))
    clearInterval(bot._healthTimer)
    assert.equal(atDig, jumpAtDig, `onGround=${onGround}`); assert.equal(afterDig, true, `rise onGround=${onGround}`); assert.equal(r.standing, onGround)
  }
})
await t('F11 a skill the guard reports, or a dig on ANOTHER block, aborts the step (and stops the dig)', async () => {
  const a = fakeBot({ digMs: 3000 }); let calls = 0
  const r1 = await airPocketStep(a, airPocketPlan(world(HIVE_C)), deps({ now: () => Date.now(), guard: () => (++calls > 2 ? 'a skill took the body' : null) }))
  clearInterval(a._healthTimer)
  assert.equal(r1.outcome, 'aborted'); assert.equal(r1.why, 'a skill took the body'); assert.ok(a.stopped >= 1)
  const b = fakeBot({ digMs: 3000, onDig: bb => setTimeout(() => { bb.targetDigBlock = { position: new V(1, 2, 3) } }, 300) })
  const r2 = await airPocketStep(b, airPocketPlan(world(HIVE_C)), deps({ now: () => Date.now() }))
  clearInterval(b._healthTimer)
  assert.equal(r2.outcome, 'aborted'); assert.equal(r2.why, 'another dig took over')
})

await t('F12 jump is RE-ASSERTED when something else clears it mid-dig (floating bot)', async () => {
  const bot = fakeBot({ digMs: 1500 }); bot.entity.onGround = false
  bot.controlState = new Proxy(bot.controls, {})
  const dig0 = bot.dig
  bot.dig = blk => { setTimeout(() => { bot.controls.jump = false }, 300); return dig0(blk) }
  let jumpLate = null
  setTimeout(() => { jumpLate = bot.controls.jump }, 1000)
  const r = await airPocketStep(bot, airPocketPlan(world(HIVE_C)), deps({ now: () => Date.now() }))
  clearInterval(bot._healthTimer)
  assert.equal(jumpLate, true, 'jump was not re-asserted after an outside clear'); assert.equal(r.ok, true, r.why)
})
await t('F13 MUTANT KILLED: without the watch re-asserting jump, an outside clear sticks (F12 catches it)', () =>
  withMutant(AP_PATH, "      try { if (bot.controlState?.jump !== wantJump) bot.setControlState('jump', wantJump) } catch { /* not connected */ }\n", '', async m => {
    const bot = fakeBot({ digMs: 1500 }); bot.entity.onGround = false; bot.controlState = bot.controls
    const dig0 = bot.dig; bot.dig = blk => { setTimeout(() => { bot.controls.jump = false }, 300); return dig0(blk) }
    let jumpLate = null; setTimeout(() => { jumpLate = bot.controls.jump }, 1000)
    await m.airPocketStep(bot, airPocketPlan(world(HIVE_C)), deps({ now: () => Date.now() })); clearInterval(bot._healthTimer)
    assert.equal(jumpLate, false)
  }))
await t('J5 an OPENED pocket clears the fail memory like a success (the reflex passes ok || opened)', () => {
  const st = { drownFails: 3, drownFailPos: { x: 1 }, drownFailHealth: 12, seizedAt: 5, lastProgressAt: 5, cooldownUntil: 0 }
  assert.equal(airPocketAfter(true, st, 1000).drownFails, 0)
  assert.ok(readFileSync(REFLEX_PATH, 'utf8').includes("const st = airPocketAfter(r.ok || r.outcome === 'opened', {"))
})

// ---------------------------------------------------------------- I. the world's inputs, read the way 1.21.8 needs
await t('I1 difficulty comes from the server packet (bot.serverDifficulty): mineflayer game.difficulty is undefined on 1.21.8', () => {
  const real = { serverDifficulty: 'peaceful', game: { difficulty: undefined }, registry: { effectsByName: { Hunger: { id: 16 } } }, entity: { effects: {} } }
  assert.deepEqual(airPocketInputs(real), { difficulty: 'peaceful', hungerActive: false })
  assert.equal(airPocketEnvelope(airPocketInputs(real)), 0.5)
  assert.deepEqual(airPocketInputs({ game: { difficulty: 'easy' } }), { difficulty: 'easy', hungerActive: false })
  assert.equal(airPocketInputs({}).difficulty, null); assert.equal(airPocketEnvelope(airPocketInputs({})), 2.0)
})
await t('I2 the Hunger effect is found under minecraft-data 1.21.8 name `Hunger` (id 16), keyed by id or by value', () => {
  const reg = { effectsByName: { Hunger: { id: 16 }, Speed: { id: 1 } } }
  assert.equal(airPocketInputs({ serverDifficulty: 'peaceful', registry: reg, entity: { effects: { 16: { id: 16, amplifier: 0 } } } }).hungerActive, true)
  assert.equal(airPocketInputs({ serverDifficulty: 'peaceful', registry: reg, entity: { effects: { 1: { id: 1 } } } }).hungerActive, false)
  assert.equal(airPocketEnvelope(airPocketInputs({ serverDifficulty: 'peaceful', registry: reg, entity: { effects: { 16: { id: 16 } } } })), 2.0)
})
await t('I3 MUTANT KILLED: reading mineflayer game.difficulty (the pilot bug) loses peaceful (I1 catches it)', () =>
  withMutant(AP_PATH, 'return { difficulty: difficultyOf(bot), hungerActive }', 'return { difficulty: bot?.game?.difficulty, hungerActive }', m => {
    assert.notEqual(m.airPocketInputs({ serverDifficulty: 'peaceful', game: { difficulty: undefined } }).difficulty, 'peaceful')
  }))
await t('I4 MUTANT KILLED: a case-sensitive `hunger` lookup misses Hunger (I2 catches it)', () =>
  withMutant(AP_PATH, "const key = Object.keys(byName).find(k => k.toLowerCase() === 'hunger')", "const key = byName.hunger ? 'hunger' : null", m => {
    assert.equal(m.airPocketInputs({ registry: { effectsByName: { Hunger: { id: 16 } } }, entity: { effects: { 16: { id: 16 } } } }).hungerActive, false)
  }))

await t('E3 a non-sealed capped rescue that is still CLOSING on air is never cut off; sealed ignores it', () => {
  const base = { rescuing: true, routeDir: 'out', routeSealed: false, heldMs: 9000, now: 1000 }
  assert.equal(airPocketTrigger({ ...base, msSinceClosing: 1000 }), false)
  assert.equal(airPocketTrigger({ ...base, msSinceClosing: 5000 }), true)
  assert.equal(airPocketTrigger({ ...base, routeSealed: true, msSinceClosing: 0 }), true)
})
await t('E4 MUTANT KILLED: dropping the closing-on-air condition cuts off a working swim (E3 catches it)', () =>
  withMutant(AP_PATH, 'return routeSealed === true || (heldMs >= AP_TRIGGER_AFTER_MS && msSinceClosing >= AP_NOT_CLOSING_MS)',
    'return routeSealed === true || heldMs >= AP_TRIGGER_AFTER_MS', m => {
      assert.equal(m.airPocketTrigger({ rescuing: true, routeDir: 'out', routeSealed: false, heldMs: 9000, now: 1, msSinceClosing: 1000 }), true)
    }))

// ---------------------------------------------------------------- K. pre-empting an in-flight escape (sandbox 10-07)
await t('K1 inside a SEALED rescue an in-flight escape or maroon climb is pre-empted; never the rung, never without sealed, never with up', () => {
  const base = { rescuing: true, routeDir: null, routeSealed: true, escaping: true, now: 1000 }
  assert.equal(airPocketPreempt(base), true)
  assert.equal(airPocketPreempt({ ...base, escaping: false, marooned: true }), true)
  assert.equal(airPocketPreempt({ ...base, escaping: false }), false)            // nothing to pre-empt
  assert.equal(airPocketPreempt({ ...base, pocketing: true }), false)           // the rung is a rescue of its own
  assert.equal(airPocketPreempt({ ...base, routeSealed: false }), false)        // unscanned/out: the swim may work
  assert.equal(airPocketPreempt({ ...base, routeDir: 'up' }), false)
  assert.equal(airPocketPreempt({ ...base, rescuing: false }), false)
  assert.equal(airPocketPreempt({ ...base, active: true }), false)
  assert.equal(airPocketPreempt({ ...base, cooldownUntil: 2000 }), false)       // a failed step here does not re-preempt
})
await t('K2 MUTANT KILLED: pre-empting the flooded-pocket rung (K1 catches it)', () =>
  withMutant(AP_PATH, 'if (!rescuing || active || pocketing || now < cooldownUntil) return false', 'if (!rescuing || active || now < cooldownUntil) return false', m => {
    assert.equal(m.airPocketPreempt({ rescuing: true, routeSealed: true, escaping: true, pocketing: true, now: 1 }), true)
  }))
await t('K3 MUTANT KILLED: pre-empting outside a sealed verdict (K1 catches it)', () =>
  withMutant(AP_PATH, "if (routeDir === 'up' || routeSealed !== true) return false", "if (routeDir === 'up') return false", m => {
    assert.equal(m.airPocketPreempt({ rescuing: true, routeSealed: false, escaping: true, now: 1 }), true)
  }))

// ---------------------------------------------------------------- J. the rescue state after a step, and the busy guard
await t('J1 after SUCCESS the fail memory is cleared and the clocks restart; after FAILURE a 60-s cooldown, memory kept', () => {
  const st = { drownFails: 3, drownFailPos: { x: 1 }, drownFailHealth: 12, seizedAt: 5, lastProgressAt: 5, cooldownUntil: 0 }
  assert.deepEqual(airPocketAfter(true, st, 1000), { ...st, drownFails: 0, drownFailPos: null, drownFailHealth: null, seizedAt: 1000, lastProgressAt: 1000 })
  assert.deepEqual(airPocketAfter(false, st, 1000), { ...st, cooldownUntil: 1000 + AP_FAIL_COOLDOWN_MS })
})
await t('J2 MUTANT KILLED: a success that keeps the fail memory leaves the rescue suppressed at the pocket (J1 catches it)', () =>
  withMutant(AP_PATH, 'if (ok) return { ...state, drownFails: 0, drownFailPos: null, drownFailHealth: null, seizedAt: now, lastProgressAt: now }',
    'if (ok) return { ...state, seizedAt: now, lastProgressAt: now }', m => {
      assert.equal(m.airPocketAfter(true, { drownFails: 3 }, 1).drownFails, 3)
    }))
await t('J3 the trigger waits while an escape / the rung / a maroon climb is in flight', () => {
  const base = { rescuing: true, routeDir: null, routeSealed: true, heldMs: 0, active: false, now: 1000, cooldownUntil: 0 }
  assert.equal(airPocketTrigger({ ...base, othersBusy: true }), false)
  assert.equal(airPocketTrigger({ ...base, othersBusy: false }), true)
})
await t('J4 MUTANT KILLED: ignoring othersBusy lets the step start under an in-flight escape (J3 catches it)', () =>
  withMutant(AP_PATH, 'if (!rescuing || active || othersBusy || now < cooldownUntil) return false', 'if (!rescuing || active || now < cooldownUntil) return false', m => {
    assert.equal(m.airPocketTrigger({ rescuing: true, routeSealed: true, othersBusy: true, now: 1 }), true)
  }))

// ---------------------------------------------------------------- G. wiring (structural; comments stripped)
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1')
function wiring (src) {
  const code = strip(src)
  const tickStart = code.indexOf('const timer = setInterval(async () => {')
  const earlyReturn = code.indexOf('if (airPocketing) return', tickStart)
  const drowningBranch = code.indexOf('const ctl = drowningControls({ losing: true', tickStart)
  const trigger = code.indexOf('airPocketTrigger({ rescuing, routeDir: route.dir', tickStart)
  return { tickStart, earlyReturn, drowningBranch, trigger,
           ok: tickStart > 0 && earlyReturn > tickStart && earlyReturn < drowningBranch && trigger > 0 && trigger < drowningBranch &&
               /await runAirPocket\(route, /.test(code.slice(trigger, drowningBranch)) &&
               /airPocketing = true[\s\S]{0,900}airPocketStep\(/.test(code) && /finally \{ airPocketing = false \}/.test(code) &&
               /airPocketAfter\(r\.ok \|\| r\.outcome === 'opened', /.test(code) && /othersBusy: escaping \|\| pocketing \|\| marooned/.test(code) &&
               /const inputs = airPocketInputs\(bot\)/.test(code) && !/bot\.game\?\.difficulty/.test(code.slice(code.indexOf('const runAirPocket'), code.indexOf('const rescueExpired'))) &&
               code.indexOf("kind: 'air_pocket_start'") > 0 && code.indexOf("kind: 'air_pocket_start'") < code.indexOf('r = await airPocketStep(') &&
               /msSinceClosing: Date\.now\(\) - lastClosingAt/.test(code) && /if \(closingOnAir\) lastClosingAt = Date\.now\(\)/.test(code) &&
               /guard: \(\) => \{ try \{ if \(runner\?\.isBusy\?\.\(\)\) runner\.interrupt\('air_pocket'\)/.test(code) &&
               /const ran = await runAirPocket\(route, Date\.now\(\) - seizedAt\)\s*if \(ran\) return/.test(code) &&
               code.indexOf('airPocketPreempt({ rescuing, routeDir: route.dir') > 0 && code.indexOf('airPocketPreempt({ rescuing, routeDir: route.dir') < trigger &&
               /airPocketWants = Date\.now\(\)\s*try \{ if \(bot\.targetDigBlock\) bot\.stopDigging\(\) \}/.test(code) &&
               (code.match(/\(\) => ownsBody\(\(\) => (entombedGrant|maroonGrant)\)\(\) && !airPocketWanted\(\)/g) || []).length === 2 }
}
await t('G1 wiring: the tick returns while the step runs; the rescue asks the trigger before steering; success clears the fail memory', () => {
  const w = wiring(readFileSync(REFLEX_PATH, 'utf8'))
  assert.ok(w.ok, JSON.stringify(w))
})
await t('G2 MUTANT KILLED: without the early return the wiring check fails', () => {
  const src = readFileSync(REFLEX_PATH, 'utf8')
  const old = '      if (airPocketing) return\n'
  assert.ok(src.split(old).length === 2, 'anchor missing or not unique')
  assert.equal(wiring(src.replace(old, '')).ok, false)
})
await t('G3 MUTANT KILLED: without the trigger call the wiring check fails', () => {
  const src = readFileSync(REFLEX_PATH, 'utf8')
  const old = 'const ran = await runAirPocket(route, Date.now() - seizedAt)'
  assert.ok(src.split(old).length === 2, 'anchor missing or not unique')
  assert.equal(wiring(src.replace(old, 'const ran = false')).ok, false)
})
for (const [name, old, neu] of [
  ['the after-state', "const st = airPocketAfter(r.ok || r.outcome === 'opened', {", 'const st = ({'],
  ['the busy guard', 'othersBusy: escaping || pocketing || marooned', 'othersBusy: false'],
  ['the packet difficulty', 'const inputs = airPocketInputs(bot)', 'const inputs = { difficulty: bot.game?.difficulty, hungerActive: false }'],
  ['the closing-on-air clock', 'if (closingOnAir) lastClosingAt = Date.now()', ''],
  ['the skill guard', "guard: () => { try { if (runner?.isBusy?.()) runner.interrupt('air_pocket') } catch {} return null }", 'guard: () => null'],
  ['the return after a step', '            if (ran) return\n', ''],
  ['the pre-empt stopping the escape dig', '            airPocketWants = Date.now()\n', ''],
  ['the entombed pillar yielding', '{ alive: () => ownsBody(() => entombedGrant)() && !airPocketWanted() }', '{ alive: ownsBody(() => entombedGrant) }'],
  ['the maroon pillar yielding', '{ alive: () => ownsBody(() => maroonGrant)() && !airPocketWanted() }', '{ alive: ownsBody(() => maroonGrant) }'],
]) {
  await t(`G4 MUTANT KILLED: without ${name} the wiring check fails`, () => {
    const src = readFileSync(REFLEX_PATH, 'utf8')
    assert.ok(src.split(old).length === 2, `anchor missing or not unique: ${old}`)
    assert.equal(wiring(src.replace(old, neu)).ok, false)
  })
}

// ---------------------------------------------------------------- H. anchored mutants of the decision lines
await t('H1 MUTANT KILLED: dropping the side-liquid check plans a pocket that would flood (A5 catches it)', () =>
  withMutant(AP_PATH, 'if (wet) return refuse(', 'if (false) return refuse(', m => {
    assert.equal(m.airPocketPlan(world({ ...HIVE_C, '1,2,0': 'water' })).ok, true)
  }))
await t('H2 MUTANT KILLED: dropping the ice air-above check plans ice under stone (A8 catches it)', () =>
  withMutant(AP_PATH, "if (!isAir(top)) return refuse(`ice with", "if (false) return refuse(`ice with", m => {
    assert.equal(m.airPocketPlan(world({ ...HIVE_D, '0,4,0': 'stone' })).ok, true)
  }))
await t('H3 MUTANT KILLED: the peaceful envelope everywhere admits the easy floating dig (B2 catches it)', () =>
  withMutant(AP_PATH, 'export const AP_ENVELOPE_DEFAULT = 2.0', 'export const AP_ENVELOPE_DEFAULT = 0.5', m => {
    assert.equal(m.airPocketAdmit({ health: 19, difficulty: 'easy', digMs: 14100 }).ok, true)
  }))
await t('H4 MUTANT KILLED: no reserve admits the 6-HP floor dig (B3 catches it)', () =>
  withMutant(AP_PATH, 'Math.max(0, health - AP_RESERVE_HP)', 'Math.max(0, health)', m => {
    assert.equal(m.airPocketAdmit({ health: 6, difficulty: 'peaceful', digMs: 2900 }).ok, true)
  }))
await t('H5 MUTANT KILLED: a breach threshold that never fires misses easy (C2 catches it)', () =>
  withMutant(AP_PATH, 'return peak - last > AP_BREACH_HP', 'return peak - last > 999', m => {
    assert.equal(m.envelopeBreached([{ t: 0, hp: 20 }, { t: 9000, hp: 12 }], 9000), false)
  }))
await t('H6 MUTANT KILLED: "health not falling" as success accepts flat health (D1 catches it)', () =>
  withMutant(AP_PATH, 'return health > healthAtEyeIn || health >= maxHealth', 'return health >= healthAtEyeIn', m => {
    assert.equal(m.airPocketConfirmed({ eyeInAirSince: 0, now: 2500, health: 18, healthAtEyeIn: 18 }), true)
  }))
await t('H7 MUTANT KILLED: dropping the up-route exclusion digs during a working swim (E1 catches it)', () =>
  withMutant(AP_PATH, "if (routeDir === 'up') return false", '', m => {
    assert.equal(m.airPocketTrigger({ rescuing: true, routeDir: 'up', routeSealed: true, heldMs: 99999, now: 1 }), true)
  }))
await t('H8 MUTANT KILLED: dropping the falling-above check plans under sand (A6 catches it)', () =>
  withMutant(AP_PATH, 'if (FALLING.test(top.name)) return refuse(', 'if (false) return refuse(', m => {
    assert.equal(m.airPocketPlan(world({ ...HIVE_C, '0,3,0': 'sand' })).ok, true)
  }))
await t('H9 MUTANT KILLED: a step that never checks the breach completes a doomed dig (F2 catches it)', () =>
  withMutant(AP_PATH, "if (envelopeBreached(samples, now())) aborted = aborted ?? 'envelope breached (> 7 HP in 10 s)'",
    "if (false) aborted = aborted ?? 'x'", async m => {
      const bot = fakeBot({ digMs: 5000, healthTick: 0, onDig: b => { const h = setInterval(() => { b.health -= 1 }, 100); setTimeout(() => clearInterval(h), 1200) } })
      const r = await m.airPocketStep(bot, airPocketPlan(world(HIVE_C)), deps({ now: () => Date.now(), envelope: 0.05 }))
      clearInterval(bot._healthTimer)
      assert.notEqual(r.why, 'envelope breached (> 7 HP in 10 s)', 'F2 asserts exactly this reason, so F2 fails on the mutant')
    }))

await t('H10 SWITCH (not a safety mutant): AP_ICE_ENABLED=false refuses hive-d ice by name (the off switch works)', () =>
  withMutant(AP_PATH, 'export const AP_ICE_ENABLED = true', 'export const AP_ICE_ENABLED = false', m => {
    const p = m.airPocketPlan(world(HIVE_D)); assert.equal(p.ok, false); assert.match(p.why, /ice branch disabled/)
    assert.equal(m.airPocketPlan(world(HIVE_C)).ok, true)
  }))

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
