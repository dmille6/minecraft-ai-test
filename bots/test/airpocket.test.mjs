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
         airPocketTrigger, pickFastestTool, airPocketStep, airPocketDetail, AP_TRIGGER_AFTER_MS,
         standGate, standInPocket, digGate, standRef, standCandidates, airPocketRow, AP_ROW_MAX,
         poseEye, planBaseY, routeUpBlocked, AP_REDIG_MAX, boxCollides, standsOn } from '../src/airpocket.mjs'

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
const ser = (...hp) => hp.map((h, i) => ({ t: i * 250, hp: h }))   // a health series sampled every 250 ms from t=0
await t('D1 flat health with the eye in air is NOT success; rising or at maximum is; under 2.5 s is not yet', () => {
  assert.equal(airPocketConfirmed({ eyeInAirSince: 0, now: 2600, samples: ser(18, 18, 18, 18, 18, 18, 18, 18, 18, 18, 18) }), false)
  assert.equal(airPocketConfirmed({ eyeInAirSince: 0, now: 2600, samples: ser(18, 18, 18, 18, 18.5, 18.5, 18.5, 18.5, 18.5, 18.5, 18.5) }), true)
  assert.equal(airPocketConfirmed({ eyeInAirSince: 0, now: 2600, samples: ser(20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20) }), true)
  assert.equal(airPocketConfirmed({ eyeInAirSince: 0, now: 2000, samples: ser(18, 19, 19, 19, 19, 19, 19, 19, 19) }), false)   // under 2.5 s
  assert.equal(airPocketConfirmed({ eyeInAirSince: null, now: 9000, samples: ser(18, 20) }), false)
})
await t('D2 SERVER-GROUNDED (Paper freeze-probe trial 2): a drowning flicker 18 <-> 20 is NOT success, though health "rose"', () => {
  assert.equal(airPocketConfirmed({ eyeInAirSince: 0, now: 2600, samples: ser(18, 18, 20, 20, 18, 18, 20, 20, 18, 18, 20) }), false)
  assert.equal(airPocketConfirmed({ eyeInAirSince: 0, now: 2600, samples: ser(20, 20, 20, 18, 18, 18, 19, 19, 19, 19, 19) }), false)  // a drop at max
  // only the samples since the eye reached air count: an earlier drop does not veto a clean window
  assert.equal(airPocketConfirmed({ eyeInAirSince: 500, now: 3100, samples: ser(20, 18, 18, 18, 18, 18.5, 18.5, 18.5, 19, 19, 19, 19, 19) }), true)
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
class V { constructor (x, y, z) { this.x = x; this.y = y; this.z = z } equals (o) { return !!o && o.x === this.x && o.y === this.y && o.z === this.z } offset (a, b, c) { return new V(this.x + a, this.y + b, this.z + c) } }
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
  // mineflayer's dig, modelled: unless forceLook is 'ignore' it awaits its own look BEFORE start-dig is sent
  bot.digSends = []
  bot.dig = (blk, forceLook) => forceLook === 'ignore' ? startDig(blk) : bot.lookAt().then(() => startDig(blk))
  const startDig = blk => new Promise((res, rej) => {
    bot.digSends.push(Date.now())
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
  bot.blockAt = v => { const b = realBlockAt(v); if (b) { b._dy = Math.floor(v.y) - base.y; b.position = new V(Math.floor(v.x), Math.floor(v.y), Math.floor(v.z)) } return b }
  bot._place = (dx, dy, dz, name) => { map.set(`${base.x + dx},${base.y + dy},${base.z + dz}`, name) }
  // mineflayer's place, modelled: unless forceLook is 'ignore' it awaits its own look BEFORE the packet is sent
  bot.lookMs = 0; bot.sends = []
  bot.lookAt = () => new Promise(r => setTimeout(r, bot.lookMs))
  bot.placeBehaviour = 'solid'   // what the server does with a sent place: 'solid' | 'nothing'
  bot._placeBlockWithOptions = async (ref, face, opts = {}) => {
    if (opts.forceLook !== 'ignore') await bot.lookAt()
    bot.sends.push({ y: ref.position.y + face.y, at: Date.now() })
    if (bot.placeBehaviour === 'solid') bot._place(0, ref.position.y + face.y - base.y, 0, 'cobblestone')
  }
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
    let atDig = null, dug = false; const dig0 = bot.dig; bot.dig = blk => { atDig = bot.controls.jump; dug = true; return dig0(blk) }
    let afterDig = null; const realSleep = ms => new Promise(r => setTimeout(r, ms / 10))
    const r = await airPocketStep(bot, airPocketPlan(world(HIVE_C)), deps({ sleep: async ms => { if (afterDig == null && dug) afterDig = bot.controls.jump; return realSleep(ms) } }))
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

await t('F14 on a FLOOR the bot stands on a placed block with its eye in the pocket (A-floor); in a DEEP column it places against the wall; open water places none', async () => {
  const floorCells = { ...HIVE_C, '0,-1,0': 'stone' }   // stone under the feet cell: the A-floor geometry
  const bot = fakeBot({ cells: floorCells, riseTo: 1.1 })
  const r = await airPocketStep(bot, airPocketPlan(world(floorCells)), deps({ standItem: () => ({ name: 'cobblestone' }) }))
  clearInterval(bot._healthTimer)
  assert.equal(r.ok, true, r.why); assert.equal(r.stand, 'placed:1'); assert.deepEqual(bot.sends.map(x => x.y), [60])
  const deepCells = { ...HIVE_C, '0,-1,0': 'water', '0,-2,0': 'water' }   // deep water under the feet cell (hive-c column)
  const deep = fakeBot({ cells: deepCells, riseTo: 1.1 })   // the column's sides at the feet cell are stone (the default)
  const r2 = await airPocketStep(deep, airPocketPlan(world(deepCells)), deps({ standItem: () => ({ name: 'cobblestone' }) }))
  clearInterval(deep._healthTimer)
  assert.equal(r2.ok, true, r2.why); assert.equal(r2.stand, 'placed:1'); assert.deepEqual(deep.sends.map(x => x.y), [60])
  // open water at the feet: water below AND on every side -> nothing to place against -> none, nothing sent
  const open = { ...deepCells, '1,0,0': 'water', '-1,0,0': 'water', '0,0,1': 'water', '0,0,-1': 'water' }
  const ow = fakeBot({ cells: open, riseTo: 1.1 })
  const r3 = await airPocketStep(ow, airPocketPlan(world(open)), deps({ standItem: () => ({ name: 'cobblestone' }) }))
  clearInterval(ow._healthTimer)
  assert.equal(r3.ok, true, r3.why); assert.equal(r3.stand, 'none'); assert.equal(ow.sends.length, 0)
})
await t('F15 the stand stops (and says why) when no block is held or the place does not read back solid', async () => {
  const floorCells = { ...HIVE_C, '0,-1,0': 'stone' }
  const a = fakeBot({ cells: floorCells, riseTo: 1.1 })
  const r = await airPocketStep(a, airPocketPlan(world(floorCells)), deps({ standItem: () => null })); clearInterval(a._healthTimer)
  assert.equal(r.ok, true); assert.match(r.stand, /^stopped:no placeable block/)
  const b = fakeBot({ cells: floorCells, riseTo: 1.1 }); b.placeBehaviour = 'nothing'
  const r2 = await airPocketStep(b, airPocketPlan(world(floorCells)), deps({ standItem: () => ({ name: 'cobblestone' }) })); clearInterval(b._healthTimer)
  assert.equal(r2.ok, true); assert.match(r2.stand, /did not turn solid/)
})

await t('F24 standRef (pure): the floor first; else a solid side wall, with the face that touches the cell; else none', () => {
  const S = B('stone'), W = B('water')
  assert.deepEqual(standRef({ below: S, sides: [[1, 0, S]] }), { dx: 0, dy: -1, dz: 0, face: [0, 1, 0], supported: true })
  assert.deepEqual(standRef({ below: W, sides: [[1, 0, W], [-1, 0, S]] }), { dx: -1, dy: 0, dz: 0, face: [1, 0, 0], supported: false })
  assert.deepEqual(standRef({ below: W, sides: [[0, 1, S]] }), { dx: 0, dy: 0, dz: 1, face: [0, 0, -1], supported: false })
  // never against something a place would OPEN or TOGGLE (both r7 reviews): below or beside
  for (const name of ['chest', 'barrel', 'furnace', 'crafting_table', 'oak_door', 'oak_trapdoor', 'iron_trapdoor', 'oak_fence_gate', 'stone_button', 'lever', 'red_bed', 'oak_sign', 'anvil', 'red_shulker_box']) {
    const X = B(name)
    assert.equal(standRef({ below: X, sides: [[1, 0, X]] }), null, name)
    assert.deepEqual(standRef({ below: X, sides: [[1, 0, X], [0, 1, S]] }), { dx: 0, dy: 0, dz: 1, face: [0, 0, -1], supported: false }, name)
  }
  assert.equal(standRef({ below: W, sides: [[1, 0, W], [-1, 0, W], [0, 1, W], [0, -1, W]] }), null)
  assert.equal(standRef({ below: null, sides: [] }), null)
})
await t('F26 a WALL place never uses a falling block (sand over water drops); a floor place may', async () => {
  const items = [{ name: 'sand', count: 64 }, { name: 'gravel', count: 9 }, { name: 'cobblestone', count: 3 }]
  assert.deepEqual(standCandidates(items, { unsupported: true }).map(i => i.name), ['cobblestone'])
  assert.deepEqual(standCandidates(items, { unsupported: false }).map(i => i.name), ['sand', 'gravel', 'cobblestone'])
  assert.deepEqual(standCandidates([{ name: 'sand' }, { name: 'red_concrete_powder' }], { unsupported: true }), [])
  // the stand asks for an unsupported block in a deep column, and refuses a falling one if that is all it is given
  const deepCells = { ...HIVE_C, '0,-1,0': 'water', '0,-2,0': 'water' }
  const asked = []
  const d = fakeBot({ cells: deepCells, riseTo: 1.1 })
  const r = await airPocketStep(d, airPocketPlan(world(deepCells)), deps({ standItem: o => { asked.push(o); return { name: 'sand' } } }))
  clearInterval(d._healthTimer)
  assert.deepEqual(asked, [{ unsupported: true }]); assert.equal(r.stand, 'stopped:sand would fall (0 placed)'); assert.equal(d.sends.length, 0)
  // on a floor it is supported, and sand is placed
  const floorCells = { ...HIVE_C, '0,-1,0': 'stone' }
  const f = fakeBot({ cells: floorCells, riseTo: 1.1 }); const askedF = []
  const rf = await airPocketStep(f, airPocketPlan(world(floorCells)), deps({ standItem: o => { askedF.push(o); return { name: 'sand' } } }))
  clearInterval(f._healthTimer)
  assert.deepEqual(askedF, [{ unsupported: false }]); assert.equal(rf.stand, 'placed:1')
  await withMutant(AP_PATH, "  return (Array.isArray(items) ? items : []).filter(it => it?.name && !(unsupported && FALLING.test(it.name)))",
    '  return (Array.isArray(items) ? items : []).filter(it => it?.name)', m => {
      assert.ok(m.standCandidates(items, { unsupported: true }).some(i => i.name === 'sand'))
    })
  await withMutant(AP_PATH, "      if (!pick.supported && FALLING.test(item.name || '')) return `stopped:${item.name} would fall (${placed} placed)`\n", '', async m => {
    const d2 = fakeBot({ cells: deepCells, riseTo: 1.1 })
    const r2 = await m.airPocketStep(d2, m.airPocketPlan(world(deepCells)), deps({ standItem: () => ({ name: 'sand' }) }))
    clearInterval(d2._healthTimer)
    assert.equal(r2.stand, 'placed:1')   // the falling block goes through: what the guard prevents
  })
})
await t('F25 mutant: a stand that only uses a floor leaves the deep column floating (the Paper sink-back)', async () => {
  const deepCells = { ...HIVE_C, '0,-1,0': 'water', '0,-2,0': 'water' }
  await withMutant(AP_PATH, '  for (const [dx, dz, b] of sides ?? []) if (ok(b)) return { dx, dy: 0, dz, face: [-dx, 0, -dz], supported: false }\n', '', async m => {
    const deep = fakeBot({ cells: deepCells, riseTo: 1.1 })
    const r = await m.airPocketStep(deep, m.airPocketPlan(world(deepCells)), deps({ standItem: () => ({ name: 'cobblestone' }) }))
    clearInterval(deep._healthTimer)
    assert.equal(r.stand, 'none'); assert.equal(deep.sends.length, 0)
  })
})
await t('F27 THE ROW FITS THE LOGGER (Paper 562d9e7 logs: every stand= row lost its required tail at 300 chars)', async () => {
  const worst = { outcome: 'success', kind: 'pocket', cell: '-12345,-59,-12345', block: 'cobbled_deepslate', tool: 'netherite_pickaxe', standing: false,
                  predictedMs: 14100, digMs: 14103, ms: 16381, envelope: 0.5, healthStart: 16.666677474975586, healthEnd: 17.000011444091797,
                  eye: 'cave_air', stand: 'stopped:aborted: envelope breached (> 7 HP in 10 s) (2 placed)', why: 'breathing in the dug pocket' }
  const args = { id: 'muyncxigzz', r: worst, requiredMs: 24150.4, budgetMs: 30000, difficulty: 'peaceful' }
  const row = airPocketRow(args)
  assert.ok(row.length <= AP_ROW_MAX, `row is ${row.length}`)
  // every field the read needs is intact, in full, before anything optional
  assert.match(row, /^id=muyncxigzz outcome=success kind=pocket cell=-12345,-59,-12345 block=cobbled_deepslate tool=netherite_pickaxe predicted_ms=14100 dig_ms=14103 ms=16381 envelope=0\.5 health=16\.6->17 \| required_ms=24150 budget_ms=30000 difficulty=peaceful \| /)
  // C3 READS `health < 3` (Codex r9): the row must never lift a value across that line -- floored, never rounded
  for (const [h, want] of [[2.99, '2.9'], [2.95, '2.9'], [3, '3'], [3.04, '3'], [16.666677474975586, '16.6']]) {
    const row3 = airPocketRow({ ...args, r: { ...worst, outcome: 'aborted', healthEnd: h } })
    assert.ok(row3.includes(`health=16.6->${want} |`), `${h}: ${row3.slice(150, 200)}`)
  }
  await withMutant(AP_PATH, 'Math.floor(h * 10) / 10', 'Math.round(h * 10) / 10', m => {
    assert.ok(m.airPocketRow({ ...args, r: { ...worst, outcome: 'aborted', healthEnd: 2.99 } }).includes('->3 |'), 'rounding lifts 2.99 to 3')
  })
  // a realistic row keeps the optional tail too
  const real = airPocketRow({ ...args, id: 'muyncxig', r: { ...worst, cell: '700,42,700', block: 'stone', tool: 'stone_pickaxe', stand: 'placed:1' } })
  assert.match(real, / standing=0 pose=na eye=cave_air stand=placed:1 -- $/)
  // a realistic FAILURE keeps its diagnosis
  const fail = airPocketRow({ ...args, id: 'muyncxig', r: { ...worst, outcome: 'failed', cell: '700,42,700', block: 'stone', tool: 'stone_pickaxe', stand: undefined, why: 'dig failed: dig exceeded 28200 ms' } })
  assert.match(fail, / stand=none -- dig failed: dig exceeded 28200 ms$/)
  await withMutant(AP_PATH, 'health=${r1(r.healthStart)}->${r1(r.healthEnd)} | required_ms', 'health=${r.healthStart}->${r.healthEnd} | required_ms', m => {
    const f = m.airPocketRow({ ...args, id: 'muyncxig', r: { ...worst, outcome: 'failed', cell: '700,42,700', block: 'stone', tool: 'stone_pickaxe', stand: undefined, why: 'dig failed: dig exceeded 28200 ms' } })
    assert.doesNotMatch(f, /dig exceeded 28200 ms$/)   // unrounded health pushes a failure's diagnosis past the cap
  })
})
await t('F16 standGate (pure): aborted, wrong item in hand, off the column, feet below the cell each refuse; all clear passes', () => {
  const ok = { aborted: null, held: 'cobblestone', want: 'cobblestone', pos: { x: 100.5, y: 61.1, z: 100.5 }, fx: 100, fz: 100, cellY: 60 }
  assert.equal(standGate(ok), null)
  assert.match(standGate({ ...ok, aborted: 'envelope breached' }), /^aborted: envelope breached/)
  assert.match(standGate({ ...ok, held: 'stone_pickaxe' }), /cobblestone not held \(holding stone_pickaxe\)/)
  assert.match(standGate({ ...ok, held: null }), /not held \(holding nothing\)/)
  assert.equal(standGate({ ...ok, pos: { x: 101.2, y: 61.1, z: 100.5 } }), 'moved off the planned column')
  assert.equal(standGate({ ...ok, pos: { x: 100.5, y: 61.0, z: 100.5 } }), 'feet fell below y=61')
})
await t('F17 NO PLACE AFTER RETURN (Codex r4): with a look slower than every timeout, the packet is sent inside the stand or never', async () => {
  const floorCells = { ...HIVE_C, '0,-1,0': 'stone' }
  const bot = fakeBot({ cells: floorCells, riseTo: 1.1 }); bot.lookMs = 400   // 10x clock: 4 s of step time, past the 500-ms look bound
  const r = await airPocketStep(bot, airPocketPlan(world(floorCells)), deps({ standItem: () => ({ name: 'cobblestone' }) }))
  const returnedAt = Date.now()
  await new Promise(res => setTimeout(res, 700))   // outlive the slow look
  clearInterval(bot._healthTimer)
  assert.equal(r.ok, true, r.why)
  assert.ok(bot.sends.every(x => x.at <= returnedAt), `a place was sent ${bot.sends.map(x => x.at - returnedAt)} ms after the step returned`)
  assert.equal(r.stand, 'placed:1')   // positive control: the stand still works with a slow look
})
await t('F18 the stand honours an abort, an equip that did not take, and a bot pushed off the column -- and sends nothing', async () => {
  const floorCells = { ...HIVE_C, '0,-1,0': 'stone' }
  const plan = airPocketPlan(world(floorCells))
  const at = { fx: 100, fy: 60, fz: 100, Vec3: V, sleep: ms => new Promise(r => setTimeout(r, ms / 10)), now: fast() }
  // abort flips between the loop-top check and the gate
  const a = fakeBot({ cells: floorCells }); a.entity.position = new V(100.5, 61.1, 100.5); clearInterval(a._healthTimer)
  let calls = 0
  const ra = await standInPocket(a, plan, { ...at, standItem: () => ({ name: 'cobblestone' }), isAborted: () => (++calls > 1 ? 'guard: a skill started' : null) })
  assert.match(ra, /^stopped:aborted: guard: a skill started/); assert.equal(a.sends.length, 0)
  // an equip that never lands
  const b = fakeBot({ cells: floorCells }); b.entity.position = new V(100.5, 61.1, 100.5); clearInterval(b._healthTimer); b.equip = () => new Promise(() => {})
  const rb = await standInPocket(b, plan, { ...at, standItem: () => ({ name: 'cobblestone' }) })
  assert.match(rb, /^stopped:cobblestone not held/); assert.equal(b.sends.length, 0)
  // pushed off the column during the look
  const c = fakeBot({ cells: floorCells }); c.entity.position = new V(100.5, 61.1, 100.5); clearInterval(c._healthTimer)
  c.lookAt = async () => { c.entity.position = new V(101.4, 61.1, 100.5) }
  const rc = await standInPocket(c, plan, { ...at, standItem: () => ({ name: 'cobblestone' }) })
  assert.match(rc, /^stopped:moved off the planned column/); assert.equal(c.sends.length, 0)
  // positive control: the same setup, nothing wrong, places one
  const d = fakeBot({ cells: floorCells }); d.entity.position = new V(100.5, 61.1, 100.5); clearInterval(d._healthTimer)
  assert.equal(await standInPocket(d, plan, { ...at, standItem: () => ({ name: 'cobblestone' }) }), 'placed:1'); assert.equal(d.sends.length, 1)
})
await t('F19 mutants: a looked place, a dropped abort check, a dropped held check each let a place through', async () => {
  const floorCells = { ...HIVE_C, '0,-1,0': 'stone' }
  await withMutant(AP_PATH, "{ swingArm: 'right', forceLook: 'ignore' }", "{ swingArm: 'right' }", async m => {
    const bot = fakeBot({ cells: floorCells, riseTo: 1.1 }); bot.lookMs = 400
    const r = await m.airPocketStep(bot, m.airPocketPlan(world(floorCells)), deps({ standItem: () => ({ name: 'cobblestone' }) }))
    const returnedAt = Date.now(); await new Promise(res => setTimeout(res, 700)); clearInterval(bot._healthTimer)
    assert.ok(r.ok && bot.sends.some(x => x.at > returnedAt), 'the looked place must land after the step returned')
  })
  await withMutant(AP_PATH, '  if (aborted) return `aborted: ${aborted}`\n', '', async m => {
    assert.equal(m.standGate({ aborted: 'x', held: 'cobblestone', want: 'cobblestone', pos: { x: 100.5, y: 61.1, z: 100.5 }, fx: 100, fz: 100, cellY: 60 }), null)
  })
  await withMutant(AP_PATH, "  if (!held || held !== want) return `${want} not held (holding ${held ?? 'nothing'})`\n", '', async m => {
    assert.equal(m.standGate({ aborted: null, held: 'stone_pickaxe', want: 'cobblestone', pos: { x: 100.5, y: 61.1, z: 100.5 }, fx: 100, fz: 100, cellY: 60 }), null)
  })
})

await t('F20 digGate (pure): aborted, a changed roof, a changed tool, off the column each refuse; all clear passes', () => {
  const ok = { aborted: null, block: 'stone', want: 'stone', held: 'stone_pickaxe', priced: 'stone_pickaxe', pos: { x: 100.5, y: 60.2, z: 100.5 }, fx: 100, fy: 60, fz: 100 }
  assert.equal(digGate(ok), null)
  assert.equal(digGate({ ...ok, held: null, priced: null }), null)   // bare hand priced bare hand
  assert.equal(digGate({ ...ok, aborted: 'a skill took the body' }), 'a skill took the body')
  assert.equal(digGate({ ...ok, block: 'water' }), 'roof cell changed to water')
  assert.match(digGate({ ...ok, held: 'cobblestone' }), /held item changed \(stone_pickaxe -> cobblestone\)/)
  assert.equal(digGate({ ...ok, pos: { x: 99.9, y: 60.2, z: 100.5 } }), 'moved off the planned column')
  assert.equal(digGate({ ...ok, pos: { x: 100.5, y: 58.9, z: 100.5 } }), 'moved off the planned column')
})
await t('F21 NO DIG AFTER RETURN (Codex r5): with a look that stalls past the deadline, start-dig is sent inside the step or never', async () => {
  const bot = fakeBot({}); bot.lookMs = 2600   // real ms: past the bounded look (50 real) and the dig deadline (2300, a real timer)
  const r = await airPocketStep(bot, airPocketPlan(world(HIVE_C)), deps())
  const returnedAt = Date.now(); await new Promise(res => setTimeout(res, 2700)); clearInterval(bot._healthTimer)
  assert.ok(bot.digSends.every(at => at <= returnedAt), 'a dig was started after the step returned')
  assert.equal(r.ok, true, r.why); assert.equal(bot.digSends.length, 1)   // positive control: the stalled look does not stop the dig
  await withMutant(AP_PATH, "bot.dig(cur, 'ignore'),", 'bot.dig(cur),', async m => {
    const b = fakeBot({}); b.lookMs = 2600
    const r2 = await m.airPocketStep(b, m.airPocketPlan(world(HIVE_C)), deps())
    const back = Date.now(); await new Promise(res => setTimeout(res, 2700)); clearInterval(b._healthTimer)
    assert.equal(r2.ok, false); assert.ok(b.digSends.some(at => at > back), 'the looked dig must start after the step returned')
  })
})
await t('F23 the step asks digGate after its look: a bot pushed off the column, or a roof that changed, during the look is never dug', async () => {
  const a = fakeBot({}); a.lookAt = async () => { a.entity.position = new V(101.4, 60.2, 100.5) }
  const ra = await airPocketStep(a, airPocketPlan(world(HIVE_C)), deps()); clearInterval(a._healthTimer)
  assert.equal(ra.why, 'moved off the planned column'); assert.equal(a.digSends.length, 0)
  const b = fakeBot({}); b.lookAt = async () => { b._place(0, 2, 0, 'gravel') }
  const rb = await airPocketStep(b, airPocketPlan(world(HIVE_C)), deps()); clearInterval(b._healthTimer)
  assert.equal(rb.why, 'roof cell changed to gravel'); assert.equal(b.digSends.length, 0)
  await withMutant(AP_PATH, '    if (noDig) { res.why = noDig;', '    if (false) { res.why = noDig;', async m => {
    const c = fakeBot({}); c.lookAt = async () => { c.entity.position = new V(101.4, 60.2, 100.5) }
    await m.airPocketStep(c, m.airPocketPlan(world(HIVE_C)), deps()); clearInterval(c._healthTimer)
    assert.equal(c.digSends.length, 1, 'without the gate the pushed bot digs')
  })
})
await t('F22 the stand reports an abort that lands during the rise or after a place, keeping the count', async () => {
  const floorCells = { ...HIVE_C, '0,-1,0': 'stone' }
  const plan = airPocketPlan(world(floorCells))
  const at = { fx: 100, fy: 60, fz: 100, Vec3: V, sleep: ms => new Promise(r => setTimeout(r, ms / 10)), now: fast() }
  const a = fakeBot({ cells: floorCells }); clearInterval(a._healthTimer)   // never rises: feet stay at 60.2
  let ca = 0
  const ra = await standInPocket(a, plan, { ...at, standItem: () => ({ name: 'cobblestone' }), isAborted: () => (++ca >= 2 ? 'envelope breached' : null) })
  assert.equal(ra, 'stopped:aborted: envelope breached (0 placed)'); assert.equal(a.sends.length, 0)
  const b = fakeBot({ cells: floorCells }); b.entity.position = new V(100.5, 61.1, 100.5); clearInterval(b._healthTimer)
  let cb = 0
  const rb = await standInPocket(b, plan, { ...at, standItem: () => ({ name: 'cobblestone' }), isAborted: () => (++cb >= 4 ? 'guard: a skill started' : null) })
  assert.equal(rb, 'stopped:aborted: guard: a skill started (1 placed)'); assert.equal(b.sends.length, 1)
  await withMutant(AP_PATH, "      if (isAborted()) return `stopped:aborted: ${isAborted()} (${placed} placed)`\n      if (bot.entity.position.y", '      if (bot.entity.position.y', async m => {
    const c = fakeBot({ cells: floorCells }); clearInterval(c._healthTimer); let cc = 0
    const rc = await m.standInPocket(c, plan, { ...at, standItem: () => ({ name: 'cobblestone' }), isAborted: () => (++cc >= 2 ? 'x' : null) })
    assert.match(rc, /did not rise/)
  })
})


// ================================================================ airpocket-02
// L. THE POSE-AWARE EYE (Paper freeze-probe trial 2 / hive-d: y 61.395 under ice at 62, the server's eye in water)
const solidSet = ys => cy => ys.includes(cy)
await t('AP2-L1 under ice at 62 a bot at 61.395 is SWIMMING: eye 61.795, cell 61; the plan base is 60 (airpocket-01 used 61)', () => {
  const pe = poseEye({ y: 61.395, solidAt: solidSet([62]) })
  assert.equal(pe.pose, 'swim'); assert.ok(Math.abs(pe.eyeY - 61.795) < 1e-9); assert.equal(pe.eyeCell, 61)
  assert.equal(planBaseY({ y: 61.395, pose: pe.pose, eyeY: pe.eyeY }), 60)
})
await t('AP2-L2 open water stands (eye +1.62, base = the feet cell); Bravo 60.5 under ice at 62 crouches (eye 61.77, base 60)', () => {
  const st = poseEye({ y: 60.3, solidAt: solidSet([]) })
  assert.equal(st.pose, 'stand'); assert.equal(st.eyeCell, 61); assert.equal(planBaseY({ y: 60.3, ...st }), 60)
  const cr = poseEye({ y: 60.5, solidAt: solidSet([62]) })
  assert.equal(cr.pose, 'crouch'); assert.equal(cr.eyeCell, 61); assert.equal(planBaseY({ y: 60.5, ...cr }), 60)
  // the feet cell itself is never what decides the pose
  assert.equal(poseEye({ y: 60.3, solidAt: solidSet([60]) }).pose, 'stand')
})
await t('AP2-L3 the plan on the trap: relative to the pose-aware base it is the ICE plan; relative to the feet cell it refuses', () => {
  const rel60 = { '0,0,0': 'water', '0,1,0': 'water', '0,2,0': 'ice', '0,3,0': 'air' }        // base 60: 60 61 62 63
  const p = airPocketPlan(world(rel60))
  assert.equal(p.ok, true, p.why); assert.equal(p.kind, 'ice'); assert.equal(p.dy, 2)
  const rel61 = { '0,0,0': 'water', '0,1,0': 'ice', '0,2,0': 'air' }                          // airpocket-01's base 61
  assert.match(airPocketPlan(world(rel61)).why, /head cell is ice/)
})
await t('AP2-L5 a 1-tall water gap under ice (floor below): swimming, the plan accepts the floor under the eye cell; standing does not', () => {
  const gap = { '0,0,0': 'stone', '0,1,0': 'water', '0,2,0': 'ice', '0,3,0': 'air' }   // base 119: floor 119, water 120, ice 121, air 122
  const p = airPocketPlan(world(gap), { pose: 'swim' })
  assert.equal(p.ok, true, p.why); assert.equal(p.kind, 'ice'); assert.equal(p.dy, 2)
  assert.match(airPocketPlan(world(gap)).why, /feet cell is stone/)
  const pe = poseEye({ y: 120.0, solidAt: solidSet([119, 121]) })
  assert.equal(pe.pose, 'swim'); assert.equal(planBaseY({ y: 120.0, ...pe }), 119)
})
await t('AP2-L6 MUTANT KILLED: requiring water under a swimming bot refuses the 1-tall gap (L5 catches it)', () =>
  withMutant(AP_PATH, "  if (pose === 'stand' && !feetSupport && !isWater(feet) && !isAir(feet)) return refuse(", "  if (!isWater(feet) && !isAir(feet)) return refuse(", m => {
    assert.equal(m.airPocketPlan(world({ '0,0,0': 'stone', '0,1,0': 'water', '0,2,0': 'ice', '0,3,0': 'air' }), { pose: 'swim' }).ok, false)
  }))
await t('AP2-L4 MUTANT KILLED: a stand-only pose model puts the eye in air under the ice (L1 catches it)', () =>
  withMutant(AP_PATH, "['stand', 1.8, 1.62], ['crouch', 1.5, 1.27], ['swim', 0.6, 0.4]", "['stand', 1.8, 1.62]", m => {
    assert.notEqual(m.poseEye({ y: 61.395, solidAt: solidSet([62]) })?.eyeCell, 61)
  }))

// M. THE BLOCKED UP ROUTE
await t('AP2-M1 an up route through the head cell\'s ice is BLOCKED (by ice@62); a real up route is not; an unread cell proves nothing', () => {
  const col = { 62: B('ice'), 63: B('air') }
  assert.deepEqual(routeUpBlocked({ routeDir: 'up', targetY: 63, eyeCell: 61, cellAt: y => col[y] ?? null }), { blocked: true, by: { name: 'ice', y: 62 } })
  assert.deepEqual(routeUpBlocked({ routeDir: 'up', targetY: 62, eyeCell: 61, cellAt: () => B('air') }), { blocked: false, by: null })
  assert.equal(routeUpBlocked({ routeDir: 'up', targetY: 63, eyeCell: 61, cellAt: y => (y === 62 ? B('water') : B('air')) }).blocked, false)
  assert.equal(routeUpBlocked({ routeDir: 'up', targetY: 63, eyeCell: 61, cellAt: () => null }).blocked, false)   // never on a guess
  assert.equal(routeUpBlocked({ routeDir: 'out', targetY: 63, eyeCell: 61, cellAt: () => B('ice') }).blocked, false)
})
await t('AP2-M2 MUTANT KILLED: a scan that only refuses unknown cells reads the ice as a route (M1 catches it)', () =>
  withMutant(AP_PATH, '    if (isSolid(b)) return { blocked: true, by: { name: b.name, y } }\n', '', m => {
    assert.equal(m.routeUpBlocked({ routeDir: 'up', targetY: 63, eyeCell: 61, cellAt: y => (y === 62 ? B('ice') : B('air')) }).blocked, false)
  }))
await t('AP2-M3 upblocked TRIGGERS after the 8-s rule (never `up`); it PRE-EMPTS an escape only after 8 s held and 4 s not closing', () => {
  const trig = { rescuing: true, routeSealed: false, heldMs: 9000, now: 1, msSinceClosing: 5000 }
  assert.equal(airPocketTrigger({ ...trig, routeDir: 'upblocked' }), true)
  assert.equal(airPocketTrigger({ ...trig, routeDir: 'up' }), false)
  assert.equal(airPocketTrigger({ ...trig, routeDir: 'upblocked', heldMs: 3000 }), false)
  const pre = { rescuing: true, routeDir: 'upblocked', routeSealed: false, marooned: true, now: 1, stepWouldRun: () => true }
  assert.equal(airPocketPreempt({ ...pre, heldMs: 9000, msSinceClosing: 5000 }), true)
  assert.equal(airPocketPreempt({ ...pre, heldMs: 3000, msSinceClosing: 5000 }), false)
  assert.equal(airPocketPreempt({ ...pre, heldMs: 9000, msSinceClosing: 1000 }), false)
  assert.equal(airPocketPreempt({ ...pre, routeDir: 'up', heldMs: 9000, msSinceClosing: 5000 }), false)
  assert.equal(airPocketPreempt({ ...pre, heldMs: 9000, msSinceClosing: 5000, stepWouldRun: () => false }), false)
})
await t('AP2-M4 MUTANT KILLED: without the upblocked pre-empt the maroon climb holds the step off (M3 catches it)', () =>
  withMutant(AP_PATH, "  const blockedLong = routeDir === 'upblocked' && heldMs >= AP_TRIGGER_AFTER_MS && msSinceClosing >= AP_NOT_CLOSING_MS", '  const blockedLong = false', m => {
    assert.equal(m.airPocketPreempt({ rescuing: true, routeDir: 'upblocked', routeSealed: false, marooned: true, now: 1, stepWouldRun: () => true, heldMs: 9000, msSinceClosing: 5000 }), false)
  }))

// N. THE STEP ON THE TRAP (fake bot: base y 60; ice at 62, air at 63; the bot embedded at 61.395)
const TRAP = { '0,-1,0': 'water', '0,0,0': 'water', '0,1,0': 'water', '0,2,0': 'ice', '0,3,0': 'air' }
await t('AP2-N1 the step digs the ice over the SWIMMING bot from the pose-aware base and confirms breathing', async () => {
  const bot = fakeBot({ cells: TRAP, riseTo: 1.4 }); bot.entity.position = new V(100.5, 61.395, 100.5)
  const plan = { ...airPocketPlan(world({ '0,0,0': 'water', '0,1,0': 'water', '0,2,0': 'ice', '0,3,0': 'air' })), baseY: 60 }
  const r = await airPocketStep(bot, plan, deps()); clearInterval(bot._healthTimer)
  assert.equal(r.ok, true, r.why); assert.equal(r.kind, 'ice'); assert.equal(r.cell, '100,62,100'); assert.equal(r.pose, 'stand')
})
await t('AP2-N2 FALSE SUCCESS REFUSED: eye "in air" by the client\'s 1.62 but the bot stays swimming under re-formed ice -> not success', async () => {
  // the ice re-forms at once and the bot never rises: airpocket-01 read eye 63.02 = air and logged success (trial 2)
  const bot = fakeBot({ cells: TRAP, rise: false }); bot.entity.position = new V(100.5, 61.395, 100.5)
  const dig0 = bot.dig; bot.dig = (blk, fl) => dig0(blk, fl).then(() => { setTimeout(() => bot._place(0, 2, 0, 'ice'), 20) })
  const plan = { ...airPocketPlan(world({ '0,0,0': 'water', '0,1,0': 'water', '0,2,0': 'ice', '0,3,0': 'air' })), baseY: 60 }
  const r = await airPocketStep(bot, plan, deps()); clearInterval(bot._healthTimer)
  // re-digs exhausted and the cell is back: FAILED (never 'opened' over a roof), asking for the short cooldown (Codex r1 P1)
  assert.equal(r.ok, false); assert.equal(r.outcome, 'failed'); assert.equal(r.refrozen, true); assert.equal(r.redigs, AP_REDIG_MAX)
})

// O. RE-DIG ON REFREEZE
await t('AP2-O1 the dug ice re-forms once while the bot is still under it: the step digs AGAIN and then confirms (redig=1)', async () => {
  const bot = fakeBot({ cells: TRAP, rise: false }); bot.entity.position = new V(100.5, 61.395, 100.5)
  let n = 0
  const dig0 = bot.dig
  bot.dig = (blk, fl) => dig0(blk, fl).then(() => {
    n++
    if (n === 1) setTimeout(() => bot._place(0, 2, 0, 'ice'), 20)                                  // refreezes
    else setTimeout(() => { bot.entity.position = new V(100.5, 61.4, 100.5) }, 30)                 // stands: eye 63.02 in air
  })
  const plan = { ...airPocketPlan(world({ '0,0,0': 'water', '0,1,0': 'water', '0,2,0': 'ice', '0,3,0': 'air' })), baseY: 60 }
  const r = await airPocketStep(bot, plan, deps()); clearInterval(bot._healthTimer)
  assert.equal(r.ok, true, r.why); assert.equal(r.redigs, 1); assert.equal(n, 2)
  await withMutant(AP_PATH, 'export const AP_REDIG_MAX = 2 ', 'export const AP_REDIG_MAX = 0 ', async m => {
    const b2 = fakeBot({ cells: TRAP, rise: false }); b2.entity.position = new V(100.5, 61.395, 100.5)
    let k = 0; const d0 = b2.dig
    b2.dig = (blk, fl) => d0(blk, fl).then(() => { k++; if (k === 1) setTimeout(() => b2._place(0, 2, 0, 'ice'), 20); else setTimeout(() => { b2.entity.position = new V(100.5, 61.4, 100.5) }, 30) })
    const r2 = await m.airPocketStep(b2, plan, deps()); clearInterval(b2._healthTimer)
    assert.equal(r2.ok, false); assert.equal(k, 1)
  })
})

// P. THE WINDOW HANDOFF: owned by a separate owner-started session (task "Fix airpocket's equip during an open window");
//    pulled in when it lands on main, never duplicated here.

// Q. THE WELL-FLOOR GUARD
await t('AP2-Q1 a roof under a junk well (floor trapdoor above, cap two above) is never dug; the same roof under stone is', () => {
  const base = { '0,0,0': 'water', '0,1,0': 'water', '0,2,0': 'stone' }
  assert.match(airPocketPlan(world({ ...base, '0,3,0': 'oak_trapdoor', '0,4,0': 'oak_trapdoor' })).why, /well block \(oak_trapdoor\) above the roof cell/)
  assert.match(airPocketPlan(world({ ...base, '0,3,0': 'stone', '0,4,0': 'spruce_trapdoor' })).why, /well block \(spruce_trapdoor\)/)
  assert.match(airPocketPlan(world({ '0,0,0': 'water', '0,1,0': 'water', '0,2,0': 'oak_trapdoor' })).why, /is a well block/)
  assert.equal(airPocketPlan(world({ ...base, '0,3,0': 'stone', '0,4,0': 'stone' })).ok, true)        // positive control
  assert.match(airPocketPlan(world({ ...base, '0,3,0': 'stone', '0,4,0': null })).why, /two above the roof cell unknown/)
})
await t('AP2-Q2 MUTANT KILLED: without the guard the rescue digs into the well shaft (Q1 catches it)', () =>
  withMutant(AP_PATH, "    if (WELL_MARK.test(top.name) || WELL_MARK.test(top2.name)) return refuse(", '    if (false) return refuse(', m => {
    assert.equal(m.airPocketPlan(world({ '0,0,0': 'water', '0,1,0': 'water', '0,2,0': 'stone', '0,3,0': 'oak_trapdoor', '0,4,0': 'oak_trapdoor' })).ok, true)
  }))

// R. THE DIG CANDIDATES: toolhygiene-01's airPocketTools (on this base, kept fleet-wide 10-10) is tested by its own block below.

// S. airpocket-02 round 1 (Codex): the collision model, a slab, the refrozen cooldown, re-pricing, the ice well guard,
// and health EVENTS
const SH = (name, shapes) => ({ name, boundingBox: 'block', shapes })
await t('AP2-S1 boxCollides uses the body footprint and the block shapes: a top slab above the head collides, a bottom slab at the feet does not', () => {
  const cells = { '100,62,100': SH('stone_slab', [[0, 0.5, 0, 1, 1, 1]]), '100,60,100': SH('stone_slab', [[0, 0, 0, 1, 0.5, 1]]) }
  const blockAt = v => cells[`${v.x},${v.y},${v.z}`] ?? null
  assert.equal(boxCollides({ px: 100.5, pz: 100.5, y0: 60.5, y1: 62.3, blockAt, Vec3: V }), false)    // the top slab starts at 62.5
  assert.equal(boxCollides({ px: 100.5, pz: 100.5, y0: 60.5, y1: 62.6, blockAt, Vec3: V }), true)
  assert.equal(boxCollides({ px: 100.5, pz: 100.5, y0: 60.5 + 1e-6, y1: 61, blockAt, Vec3: V }), false) // standing ON the bottom slab
  // the footprint: a full block in the NEIGHBOUR column, under the edge of a body at x 100.75, counts
  const nb = { '101,62,100': B('ice') }
  assert.equal(boxCollides({ px: 100.75, pz: 100.5, y0: 61.4, y1: 63.2, blockAt: v => nb[`${v.x},${v.y},${v.z}`] ?? null, Vec3: V }), true)
  assert.equal(boxCollides({ px: 100.5, pz: 100.5, y0: 61.4, y1: 63.2, blockAt: v => nb[`${v.x},${v.y},${v.z}`] ?? null, Vec3: V }), false)
})
await t('AP2-S2 standing ON a slab: standsOn, the plan accepts the slab feet cell (Codex r1 slab probe); a full block in the feet cell is not "stood on"', () => {
  assert.equal(standsOn({ y: 60.5, block: SH('stone_slab', [[0, 0, 0, 1, 0.5, 1]]) }), true)
  assert.equal(standsOn({ y: 60.2, block: SH('stone_slab', [[0, 0, 0, 1, 0.5, 1]]) }), false)
  assert.equal(standsOn({ y: 60.5, block: B('stone') }), false)
  const slab = { '0,0,0': 'stone_slab', '0,1,0': 'water', '0,2,0': 'stone' }
  assert.equal(airPocketPlan(world(slab), { feetSupport: true }).ok, true)
  assert.match(airPocketPlan(world(slab)).why, /feet cell is stone_slab/)
})
await t('AP2-S3 poseEye with a collision model: under ice the swim pose; a top slab at 62 lets a bot at 60.5 stand only if the box clears it', () => {
  const ice = { '100,62,100': B('ice') }
  const col = cells => (y0, y1) => boxCollides({ px: 100.5, pz: 100.5, y0, y1, blockAt: v => cells[`${v.x},${v.y},${v.z}`] ?? null, Vec3: V })
  assert.equal(poseEye({ y: 61.395, collides: col(ice) }).pose, 'swim')
  assert.equal(poseEye({ y: 60.2, collides: col({ '100,62,100': SH('stone_slab', [[0, 0.5, 0, 1, 1, 1]]) }) }).pose, 'stand')   // 60.2 + 1.8 = 62.0 < 62.5
  assert.equal(poseEye({ y: 60.9, collides: col({ '100,62,100': SH('stone_slab', [[0, 0.5, 0, 1, 1, 1]]) }) }).pose, 'crouch')  // 62.7 > 62.5, 62.4 fits
})
await t('AP2-S4 a refrozen failure gets the SHORT cooldown (5 s), any other failure 60 s; mutant (refrozen ignored) caught', async () => {
  const st = { drownFails: 2 }
  assert.equal(airPocketAfter(false, st, 1000, { refrozen: true }).cooldownUntil, 1000 + 5000)
  assert.equal(airPocketAfter(false, st, 1000).cooldownUntil, 1000 + AP_FAIL_COOLDOWN_MS)
  await withMutant(AP_PATH, 'cooldownUntil: now + (refrozen ? AP_REFUSE_COOLDOWN_MS : AP_FAIL_COOLDOWN_MS)', 'cooldownUntil: now + AP_FAIL_COOLDOWN_MS', m => {
    assert.equal(m.airPocketAfter(false, st, 1000, { refrozen: true }).cooldownUntil, 1000 + 60000)
  })
})
await t('AP2-S5 a re-dig is RE-PRICED: if the refrozen cell now costs more than the budget the step stops FAILED/refrozen without digging again', async () => {
  const bot = fakeBot({ cells: TRAP, rise: false }); bot.entity.position = new V(100.5, 61.395, 100.5)
  let n = 0; const dig0 = bot.dig
  let expensive = false
  bot.dig = (blk, fl) => { n++; return dig0(blk, fl).then(() => { expensive = true; setTimeout(() => bot._place(0, 2, 0, 'ice'), 20) }) }
  const plan = { ...airPocketPlan(world({ '0,0,0': 'water', '0,1,0': 'water', '0,2,0': 'ice', '0,3,0': 'air' })), baseY: 60 }
  const r = await airPocketStep(bot, plan, deps({ predict: () => (expensive ? 999999 : 300) })); clearInterval(bot._healthTimer)
  assert.equal(r.outcome, 'failed'); assert.equal(r.refrozen, true); assert.match(r.why, /re-dig needs 999999 ms: over the budget/); assert.equal(n, 1)
})
await t('AP2-S6 the well guard applies to ICE too: ice with air above and a trapdoor two above is never broken', () => {
  assert.match(airPocketPlan(world({ '0,0,0': 'water', '0,1,0': 'water', '0,2,0': 'ice', '0,3,0': 'air', '0,4,0': 'oak_trapdoor' })).why, /well block \(oak_trapdoor\) above the ice/)
  assert.equal(airPocketPlan(world({ '0,0,0': 'water', '0,1,0': 'water', '0,2,0': 'ice', '0,3,0': 'air', '0,4,0': 'air' })).ok, true)
})
await t('AP2-S7 health EVENTS are sampled: a hit and a heal between two 250-ms polls still vetoes the confirmation', async () => {
  const bot = fakeBot({ healthTick: 0, health: 18 })
  const handlers = []; bot.on = (ev, f) => { if (ev === 'health') handlers.push(f) }; bot.removeListener = () => {}
  // after the dig: every 300 ms (real; the step's clock is 10x) a 2-HP hit then a heal within 5 ms -- the poll misses it
  const iv = setInterval(() => { bot.health = 16; handlers.forEach(f => f()); setTimeout(() => { bot.health = 18.5; handlers.forEach(f => f()) }, 5) }, 30)
  const r = await airPocketStep(bot, airPocketPlan(world(HIVE_C)), deps()); clearInterval(bot._healthTimer); clearInterval(iv)
  assert.equal(r.ok, false); assert.equal(r.outcome, 'opened')
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
  const base = { rescuing: true, routeDir: null, routeSealed: true, escaping: true, now: 1000, stepWouldRun: () => true }
  assert.equal(airPocketPreempt(base), true)
  assert.equal(airPocketPreempt({ ...base, stepWouldRun: () => false }), false)  // a site the step would REFUSE: never pre-empt
  assert.equal(airPocketPreempt({ ...base, escaping: false, marooned: true }), true)
  assert.equal(airPocketPreempt({ ...base, escaping: false }), false)            // nothing to pre-empt
  assert.equal(airPocketPreempt({ ...base, pocketing: true }), false)           // the rung is a rescue of its own
  assert.equal(airPocketPreempt({ ...base, routeSealed: false }), false)        // unscanned/out: the swim may work
  assert.equal(airPocketPreempt({ ...base, routeDir: 'up' }), false)
  assert.equal(airPocketPreempt({ ...base, rescuing: false }), false)
  assert.equal(airPocketPreempt({ ...base, active: true }), false)
  assert.equal(airPocketPreempt({ ...base, cooldownUntil: 2000 }), false)       // a failed step here does not re-preempt
})
await t('K6 MUTANT KILLED: pre-empting for a step that would refuse (the r2 dead end; K1 catches it)', () =>
  withMutant(AP_PATH, 'return stepWouldRun() === true', 'return true', m => {
    assert.equal(m.airPocketPreempt({ rescuing: true, routeSealed: true, escaping: true, now: 1, stepWouldRun: () => false }), true)
  }))
await t('K2 MUTANT KILLED: pre-empting the flooded-pocket rung (K1 catches it)', () =>
  withMutant(AP_PATH, 'if (!rescuing || active || pocketing || now < cooldownUntil) return false', 'if (!rescuing || active || now < cooldownUntil) return false', m => {
    assert.equal(m.airPocketPreempt({ rescuing: true, routeSealed: true, escaping: true, pocketing: true, now: 1, stepWouldRun: () => true }), true)
  }))
await t('K3 MUTANT KILLED: pre-empting outside a sealed verdict (K1 catches it)', () =>
  withMutant(AP_PATH, "if (!blockedLong && (routeDir === 'up' || routeDir === 'upblocked' || routeSealed !== true)) return false", "if (!blockedLong && (routeDir === 'up' || routeDir === 'upblocked')) return false", m => {
    assert.equal(m.airPocketPreempt({ rescuing: true, routeSealed: false, escaping: true, now: 1, stepWouldRun: () => true }), true)
  }))

await t('K4 a pre-empted climb YIELDS: digStraightUp and pillarOut return "preempted" when alive is false (no dig, no place)', async () => {
  const { digStraightUp, pillarOut } = await import('../src/reflex.mjs')
  const mk = () => {
    const bot = fakeBot({}); let dug = 0, placed = 0
    bot.entity.position = Object.assign(new V(100.5, 60.2, 100.5), { offset (dx, dy, dz) { return new V(this.x + dx, this.y + dy, this.z + dz) } })
    bot.dig = async () => { dug++ }; bot.placeBlock = async () => { placed++ }
    bot.inventory = { items: () => [{ name: 'stone_pickaxe', type: 1 }, { name: 'cobblestone', count: 64 }] }
    return { bot, counts: () => [dug, placed] }
  }
  const a = mk()
  const r1 = await digStraightUp(a.bot, 60, 20, { alive: () => false }); clearInterval(a.bot._healthTimer)
  assert.equal(r1, 'preempted'); assert.deepEqual(a.counts(), [0, 0])
  const b = mk()
  const r2 = await pillarOut(b.bot, 6, { alive: () => false }); clearInterval(b.bot._healthTimer)
  assert.equal(r2, 'preempted'); assert.deepEqual(b.counts(), [0, 0])
})
await t('K5 MUTANT KILLED: digStraightUp without its first alive check refuses for a pickaxe instead of yielding (K4 catches it)', () =>
  withMutant(REFLEX_PATH, "  // A PRE-EMPTED CLIMB STOPS BEFORE ANYTHING ELSE (airpocket-01): no refusal row, no pickaxe request, no dig.\n  if (!alive()) return 'preempted'\n", '', async m => {
    const bot = fakeBot({}); let acted = 0
    bot.entity.position = Object.assign(new V(100.5, 60.2, 100.5), { offset (dx, dy, dz) { return new V(this.x + dx, this.y + dy, this.z + dz) } })
    bot.dig = async () => { acted++ }; bot.placeBlock = async () => { acted++ }
    bot.inventory = { items: () => [{ name: 'stone_pickaxe', type: 1 }, { name: 'cobblestone', count: 64 }] }
    const r = await m.digStraightUp(bot, 60, 1, { alive: () => false }).catch(e => 'threw:' + e.message); clearInterval(bot._healthTimer)
    assert.notEqual(r, 'preempted')
  }))

// A pillar bot in a dry 1x1 shaft with headroom and 64 cobblestone: the pre-empt arrives MID-CLIMB (alive turns false on
// its 5th call = the new check after the jump sleep, before the first placeBlock).
function pillarBot () {
  const bot = fakeBot({ cells: { '0,0,0': 'air', '0,1,0': 'air', '0,2,0': 'air', '0,3,0': 'air', '0,-1,0': 'stone' } })
  bot.entity.position = Object.assign(new V(100.5, 60, 100.5), { offset (dx, dy, dz) { return new V(this.x + dx, this.y + dy, this.z + dz) } })
  bot.entity.onGround = true
  bot.inventory = { items: () => [{ name: 'cobblestone', count: 64, type: 2 }] }
  bot.clearControlStates = () => {}; bot.pathfinder = { setGoal () {} }
  let placed = 0; bot.placeBlock = async () => { placed++ }
  return { bot, placed: () => placed }
}
const lateAlive = (n) => { let c = 0; return () => ++c < n }
await t('K7 a climb pre-empted MID-CLIMB (after its jump sleep) places nothing', async () => {
  const { pillarOut } = await import('../src/reflex.mjs')
  const pb = pillarBot()
  const r = await pillarOut(pb.bot, 3, { alive: lateAlive(5) }); clearInterval(pb.bot._healthTimer)
  assert.equal(r, 'preempted'); assert.equal(pb.placed(), 0)
  const ctl = pillarBot()   // POSITIVE CONTROL: the same climb, never pre-empted, does place
  await pillarOut(ctl.bot, 1, { alive: () => true }).catch(() => {}); clearInterval(ctl.bot._healthTimer)
  assert.ok(ctl.placed() >= 1, 'the fixture never reaches a placement, so K7 proves nothing')
})
await t('K8 MUTANT KILLED: without the after-sleep check the pre-empted climb still places (K7 catches it)', () =>
  withMutant(REFLEX_PATH, "    if (!alive()) { bot.setControlState('jump', false); return 'preempted' }   // airpocket-01 (Codex r3): never place after a yield\n", '', async m => {
    const pb = pillarBot()
    await m.pillarOut(pb.bot, 3, { alive: lateAlive(5) }).catch(() => {}); clearInterval(pb.bot._healthTimer)
    assert.ok(pb.placed() >= 1)
  }))

// ---------------------------------------------------------------- J. the rescue state after a step, and the busy guard
await t('J1 after SUCCESS the fail memory is cleared and the clocks restart; after FAILURE a 60-s cooldown, memory kept', () => {
  const st = { drownFails: 3, drownFailPos: { x: 1 }, drownFailHealth: 12, seizedAt: 5, lastProgressAt: 5, cooldownUntil: 0 }
  assert.deepEqual(airPocketAfter(true, st, 1000), { ...st, drownFails: 0, drownFailPos: null, drownFailHealth: null, seizedAt: 1000, lastProgressAt: 1000, breatheUntil: 11000 })
  assert.deepEqual(airPocketAfter(false, st, 1000), { ...st, cooldownUntil: 1000 + AP_FAIL_COOLDOWN_MS })
})
await t('J2 MUTANT KILLED: a success that keeps the fail memory leaves the rescue suppressed at the pocket (J1 catches it)', () =>
  withMutant(AP_PATH, 'if (ok) return { ...state, drownFails: 0, drownFailPos: null, drownFailHealth: null, seizedAt: now, lastProgressAt: now, breatheUntil: now + AP_BREATHE_HOLD_MS }',
    'if (ok) return { ...state, seizedAt: now, lastProgressAt: now, breatheUntil: now + AP_BREATHE_HOLD_MS }', m => {
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
  const trigger = code.indexOf('airPocketTrigger({ rescuing, routeDir: apRoute.dir', tickStart)
  return { tickStart, earlyReturn, drowningBranch, trigger,
           ok: tickStart > 0 && earlyReturn > tickStart && earlyReturn < drowningBranch && trigger > 0 && trigger < drowningBranch &&
               /await runAirPocket\(apRoute, /.test(code.slice(trigger, drowningBranch)) &&
               /airPocketing = true[\s\S]{0,900}airPocketStep\(/.test(code) && /finally \{ airPocketing = false; airPocketWants = 0 \}/.test(code) &&
               /airPocketAfter\(r\.ok \|\| r\.outcome === 'opened', /.test(code) && /othersBusy: escaping \|\| pocketing \|\| marooned/.test(code) &&
               /const inputs = airPocketInputs\(bot\)/.test(code) && !/bot\.game\?\.difficulty/.test(code.slice(code.indexOf('const runAirPocket'), code.indexOf('const rescueExpired'))) &&
               code.indexOf("kind: 'air_pocket_start'") > 0 && code.indexOf("kind: 'air_pocket_start'") < code.indexOf('r = await airPocketStep(') &&
               /msSinceClosing: Date\.now\(\) - lastClosingAt/.test(code) && /if \(closingOnAir\) lastClosingAt = Date\.now\(\)/.test(code) &&
               /guard: \(\) => \{ try \{ if \(runner\?\.isBusy\?\.\(\)\) runner\.interrupt\('air_pocket'\); if \(bot\.pathfinder\?\.goal\) haltPath\(bot\)/.test(code) &&
               /stepWouldRun: \(\) => prepareAirPocket\(\{ worstCase: true \}\)\.ok \}\)\) \{/.test(code) &&
               /const env = worstCase \? \{ \.\.\.digEnv\(bot\), inWater: true, notOnGround: true \} : digEnv\(bot\)/.test(code) &&
               /standItem: \(\{ unsupported = false \} = \{\}\) => unsupported\s*\? pickScaffold\(standCandidates\(bot\.inventory\?\.items\?\.\(\) \?\? \[\], \{ unsupported: true \}\), PLACEABLE\)\s*: scaffoldFor\(bot, 'air_pocket'\)/.test(code) &&
               /isEntombed\(bot\) && Date\.now\(\) >= airPocketBreatheUntil &&/.test(code) && /!runner\.isBusy\(\) && Date\.now\(\) >= airPocketBreatheUntil &&/.test(code) && /\} else if \(rescuing && route\.sealed === true && route\.dir !== 'up' && \(escaping \|\| marooned\) && !pocketing && !airPocketing &&\s*throttled\('air_pocket_held_off'/.test(code) && /Date\.now\(\) - airPocketWants < AP_WANT_LAPSE_MS/.test(code) &&
               /airPocketWants = 0 {16}\/\/ a refused step/.test(src) && /finally \{ airPocketing = false; airPocketWants = 0 \}/.test(code) &&
               /const ran = await runAirPocket\(apRoute, Date\.now\(\) - seizedAt, apBlockedBy\)\s*if \(ran\) return/.test(code) &&
               code.indexOf('airPocketPreempt({ rescuing, routeDir: apRoute.dir') > 0 && code.indexOf('airPocketPreempt({ rescuing, routeDir: apRoute.dir') < trigger &&
               /airPocketWants = Date\.now\(\)\s*try \{ if \(bot\.targetDigBlock\) bot\.stopDigging\(\) \}/.test(code) &&
               (code.match(/\(\) => ownsBody\(\(\) => (entombedGrant|maroonGrant)\)\(\) && !airPocketWanted\(\)/g) || []).length === 2 &&
               /if \(ub\.blocked\) \{\s*apRoute = \{ \.\.\.route, dir: 'upblocked', sealed: false \}; apBlockedBy = ub\.by/.test(code) &&
               /const fy = planBaseY\(\{ y: at\.y, pose: pe\.pose, eyeY: pe\.eyeY \}\)/.test(code) && /, \{ pose: pe\.pose, feetSupport \}\)/.test(code) && /, Date\.now\(\), \{ refrozen: r\.refrozen === true \}\)/.test(code) &&
               /heldMs: Date\.now\(\) - seizedAt, msSinceClosing: Date\.now\(\) - lastClosingAt,\s*stepWouldRun/.test(code) }
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
  const old = 'const ran = await runAirPocket(apRoute, Date.now() - seizedAt, apBlockedBy)'
  assert.ok(src.split(old).length === 2, 'anchor missing or not unique')
  assert.equal(wiring(src.replace(old, 'const ran = false')).ok, false)
})
for (const [name, old, neu] of [
  ['the after-state', "const st = airPocketAfter(r.ok || r.outcome === 'opened', {", 'const st = ({'],
  ['the busy guard', 'othersBusy: escaping || pocketing || marooned', 'othersBusy: false'],
  ['the packet difficulty', 'const inputs = airPocketInputs(bot)', 'const inputs = { difficulty: bot.game?.difficulty, hungerActive: false }'],
  ['the closing-on-air clock', 'if (closingOnAir) lastClosingAt = Date.now()', ''],
  ['the skill guard', "guard: () => { try { if (runner?.isBusy?.()) runner.interrupt('air_pocket'); if (bot.pathfinder?.goal) haltPath(bot) } catch {} return null }", 'guard: () => null'],
  ['the pre-empt asking the plan first', 'stepWouldRun: () => prepareAirPocket({ worstCase: true }).ok })) {', 'stepWouldRun: () => true })) {'],
  ['the worst-case price for the pre-empt', 'const env = worstCase ? { ...digEnv(bot), inWater: true, notOnGround: true } : digEnv(bot)', 'const env = digEnv(bot)'],
  ['the stand item', ": scaffoldFor(bot, 'air_pocket') })", ": null })"],
  ['the non-falling stand item off a floor', '? pickScaffold(standCandidates(bot.inventory?.items?.() ?? [], { unsupported: true }), PLACEABLE)', "? scaffoldFor(bot, 'air_pocket')"],
  ['the request lapse', 'Date.now() - airPocketWants < AP_WANT_LAPSE_MS', 'Date.now() - airPocketWants < 30_000'],
  ['the held-off refusal row', "throttled('air_pocket_held_off', 30_000)) {", "false) {"],
  ['the breathe hold on the entombed arm', 'isEntombed(bot) && Date.now() >= airPocketBreatheUntil &&', 'isEntombed(bot) &&'],
  ['the breathe hold on the maroon arm', '!runner.isBusy() && Date.now() >= airPocketBreatheUntil &&', '!runner.isBusy() &&'],
  ['clearing the request on refusal', '      airPocketWants = 0                // a refused step never keeps an escape held off\n', ''],
  ['clearing the request after the step', 'finally { airPocketing = false; airPocketWants = 0 }', 'finally { airPocketing = false }'],
  ['the return after a step', '            if (ran) return\n', ''],
  ['the pre-empt stopping the escape dig', '            airPocketWants = Date.now()\n', ''],
  ['the entombed pillar yielding', '{ alive: () => ownsBody(() => entombedGrant)() && !airPocketWanted() }', '{ alive: ownsBody(() => entombedGrant) }'],
  ['the maroon pillar yielding', '{ alive: () => ownsBody(() => maroonGrant)() && !airPocketWanted() }', '{ alive: ownsBody(() => maroonGrant) }'],
  ['the upblocked route', "apRoute = { ...route, dir: 'upblocked', sealed: false }; apBlockedBy = ub.by", 'apBlockedBy = ub.by'],
  ['the pose-aware plan base', 'const fy = planBaseY({ y: at.y, pose: pe.pose, eyeY: pe.eyeY })', 'const fy = Math.floor(at.y)'],
  ['the pose passed to the plan', ', { pose: pe.pose, feetSupport })', ')'],
  ['the refrozen short cooldown', ', Date.now(), { refrozen: r.refrozen === true })', ')'],
  ['the pre-empt clocks', 'heldMs: Date.now() - seizedAt, msSinceClosing: Date.now() - lastClosingAt,\n', ''],
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
  withMutant(AP_PATH, 'return last > first || last >= maxHealth', 'return true', m => {
    assert.equal(m.airPocketConfirmed({ eyeInAirSince: 0, now: 2600, samples: ser(18, 18, 18, 18, 18, 18, 18, 18, 18, 18, 18) }), true)
  }))
await t('H6b MUTANT KILLED: dropping the no-drop rule accepts the drowning flicker (D2 catches it)', () =>
  withMutant(AP_PATH, '  for (let i = 1; i < since.length; i++) if (since[i].hp < since[i - 1].hp) return false\n', '', m => {
    assert.equal(m.airPocketConfirmed({ eyeInAirSince: 0, now: 2600, samples: ser(18, 18, 20, 20, 18, 18, 20, 20, 18, 18, 20) }), true)
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

// ---------------------------------------------------------------- L. tool hygiene composition (toolhygiene-01 on this base)
// Rebase reviews 10-08 (Codex P1, Claude P2): hygiene drains worn copies to 1 use; a copy the server already broke still
// shows at 1 use for > 1.5 s, and a step that digs with it digs bare-handed server-side. One candidate list
// (airPocketTools) for the price and the step; with hygiene ON a <= HARD_STOP copy goes when a same-kind copy above it is held.
const { TOOL_HYGIENE: TH } = await import('../src/toolfor.mjs')
const { airPocketTools } = await import('../src/airpocket.mjs')
const SPK = left => ({ name: 'stone_pickaxe', maxDurability: 131, durabilityUsed: 131 - left })
const SSH = left => ({ name: 'stone_shovel', maxDurability: 131, durabilityUsed: 131 - left })
const L1 = tools => {
  const p1 = SPK(1), p90 = SPK(90), sh = SSH(50), plain = { name: 'iron_pickaxe' }
  assert.deepEqual(tools([p1, p90], { hygiene: true }), [p90], 'a 1-use pickaxe beside a healthy one is dropped')
  assert.deepEqual(tools([p1], { hygiene: true }), [p1], 'a sole 1-use pickaxe stays (a real 1-use copy still digs once)')
  assert.deepEqual(tools([p1, sh], { hygiene: true }), [p1, sh], 'a healthy SHOVEL does not drop the 1-use pickaxe')
  assert.deepEqual(tools([p1, p90, sh, { name: 'cobblestone' }], { hygiene: false }), [p1, p90, sh], 'hygiene off: every tool, in bag order')
  assert.deepEqual(tools([plain, p1], { hygiene: true }), [plain], 'no durability data = full (remaining Infinity)')
}
await t('L1 airPocketTools: hygiene on drops a <= HARD_STOP copy only beside a same-kind copy above it; off = every tool', () => L1(airPocketTools))
const L2 = async step => {
  assert.equal(TH.on, true, 'the suite runs with TOOL_HYGIENE unset (production default: on)')
  const p1 = SPK(1), p90 = SPK(90)
  const bot = fakeBot({}); bot.inventory = { items: () => [p1, p90] }
  const r = await step(bot, airPocketPlan(world(HIVE_C)), deps()); clearInterval(bot._healthTimer)
  assert.equal(r.ok, true, r.why); assert.equal(bot.heldItem, p90, 'the healthy copy is equipped, not the 1-use one first by slot')
  const solo = fakeBot({}); solo.inventory = { items: () => [p1] }
  const r2 = await step(solo, airPocketPlan(world(HIVE_C)), deps()); clearInterval(solo._healthTimer)
  assert.equal(r2.ok, true, r2.why); assert.equal(solo.heldItem, p1, 'alone, the 1-use copy is still used')
}
await t('L2 the step equips the healthy copy over a 1-use one of the same name ahead of it in the bag', () => L2(airPocketStep))
const L3 = async step => {
  // MIXED TIERS (Codex r2): a FASTER 1-use iron copy ahead of a healthy stone one -- the step digs with the healthy stone
  // copy (toolfor: reflex digs keep HARD_STOP even when the worn copy is faster); alone, the iron@1 is used.
  const i1 = { name: 'iron_pickaxe', maxDurability: 250, durabilityUsed: 249 }, s90 = SPK(90)
  const pr = (b, item) => (/^iron_pickaxe$/.test(item?.name ?? '') ? 150 : /_pickaxe$/.test(item?.name ?? '') ? 300 : 7500)
  assert.deepEqual(airPocketTools([i1, s90], { hygiene: true }), [s90])
  const bot = fakeBot({}); bot.inventory = { items: () => [i1, s90] }
  const r = await step(bot, airPocketPlan(world(HIVE_C)), deps({ predict: pr })); clearInterval(bot._healthTimer)
  assert.equal(r.ok, true, r.why); assert.equal(bot.heldItem, s90); assert.equal(r.predictedMs, 300)
  const solo = fakeBot({}); solo.inventory = { items: () => [i1] }
  const r2 = await step(solo, airPocketPlan(world(HIVE_C)), deps({ predict: pr })); clearInterval(solo._healthTimer)
  assert.equal(r2.ok, true, r2.why); assert.equal(solo.heldItem, i1); assert.equal(r2.predictedMs, 150)
}
await t('L3 mixed tiers: a faster 1-use iron copy is skipped for a healthy stone one; alone it is used', () => L3(airPocketStep))
const apWired = src => {
  const code = strip(src)
  const i = code.indexOf('const prepareAirPocket')
  assert.ok(i > 0, 'prepareAirPocket exists')
  const body = code.slice(i, code.indexOf('const runAirPocket', i))
  assert.match(body, /const items = airPocketTools\(bot\.inventory\?\.items\?\.\(\) \?\? \[\]\)/, 'the price uses the step\'s candidate list')
  assert.ok(!/_\(pickaxe\|shovel\|axe\)/.test(body), 'no private candidate filter in the price')
}
await t('L4 WIRED: the admission/pre-empt price (reflex prepareAirPocket) uses airPocketTools -- and the check fails on the old filter', () => {
  const src = readFileSync(REFLEX_PATH, 'utf8')
  apWired(src)
  const anchor = 'const items = airPocketTools(bot.inventory?.items?.() ?? [])   // the step\'s own candidates'
  assert.equal(src.split(anchor).length, 2, 'anchor present and unique')
  assert.throws(() => apWired(src.replace(anchor, "const items = (bot.inventory?.items?.() ?? []).filter(it => /_(pickaxe|shovel|axe)$/.test(it.name))   // x")))
})
const mustFail = async (label, fn) => { let threw = false; try { await fn() } catch { threw = true } assert.ok(threw, `the mutant survived: ${label}`) }
await t('L5 MUTANT KILLED: airPocketTools without the hygiene filter (L1 catches it)', () =>
  withMutant(AP_PATH, '  return all.filter(it => remaining(it) > HARD_STOP || !healthy.has(kind(it)))\n', '  return all\n', m => mustFail('L1', () => L1(m.airPocketTools))))
await t('L6 MUTANT KILLED: the step with its own unfiltered list (L2 and L3 catch it)', () =>
  withMutant(AP_PATH, '    const items = airPocketTools(bot.inventory?.items?.() ?? [])\n',
    "    const items = (bot.inventory?.items?.() ?? []).filter(it => /_(pickaxe|shovel|axe)$/.test(it.name))\n", async m => {
      await mustFail('L2', () => L2(m.airPocketStep)); await mustFail('L3', () => L3(m.airPocketStep))
    }))

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
