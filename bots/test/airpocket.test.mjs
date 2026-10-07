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
class V { constructor (x, y, z) { this.x = x; this.y = y; this.z = z } }
function fakeBot ({ cells = HIVE_C, health = 19, digMs = 300, rise = true, riseTo = 0.6, healthTick = 0.1, onDig = null } = {}) {
  const map = new Map(); const base = { x: 100, y: 60, z: 100 }
  for (const [k, v] of Object.entries(cells)) { const [dx, dy, dz] = k.split(',').map(Number); map.set(`${base.x + dx},${base.y + dy},${base.z + dz}`, v) }
  const get = (x, y, z) => { const k = `${x},${y},${z}`; return map.has(k) ? (map.get(k) === null ? null : B(map.get(k))) : B('stone') }
  const bot = { health, entity: { position: new V(base.x + 0.5, base.y + 0.2, base.z + 0.5) }, controls: {}, stopped: 0, digging: null,
                inventory: { items: () => [{ name: 'stone_pickaxe' }] }, equipped: null }
  bot.blockAt = v => get(Math.floor(v.x), Math.floor(v.y), Math.floor(v.z))
  bot.equip = async it => { bot.equipped = it.name }
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
const deps = (extra = {}) => ({ Vec3: V, predict: (b, item) => (item ? 300 : 7500), envelope: 0.5, now: fast(), sleep: ms => new Promise(r => setTimeout(r, ms / 10)), ...extra })

await t('F1 hive-c pocket: dig, rise, breathing confirmed with health rising -> success; jump released at the end', async () => {
  const bot = fakeBot({})
  const plan = airPocketPlan(world(HIVE_C))
  const r = await airPocketStep(bot, plan, deps()); clearInterval(bot._healthTimer)
  assert.equal(r.ok, true, r.why); assert.equal(r.outcome, 'success'); assert.equal(r.tool, 'stone_pickaxe')
  assert.equal(bot.controls.jump, false)
  assert.match(airPocketDetail(r), /outcome=success kind=pocket/)
})
await t('F2 a breach during the dig stops it (stopDigging) and reports aborted, never success', async () => {
  const bot = fakeBot({ digMs: 5000, healthTick: 0, onDig: b => { const h = setInterval(() => { b.health -= 1 }, 100); setTimeout(() => clearInterval(h), 2000) } })
  const r = await airPocketStep(bot, airPocketPlan(world(HIVE_C)), deps({ now: () => Date.now() }))
  clearInterval(bot._healthTimer)
  assert.equal(r.ok, false); assert.equal(r.outcome, 'aborted'); assert.match(r.why, /envelope breached|budget spent/)
  assert.ok(bot.stopped >= 1, 'the dig was not stopped')
})
await t('F3 hive-d ice: the ice opens to water and the eye rises into the air above -> success', async () => {
  const bot = fakeBot({ cells: HIVE_D, riseTo: 2.6 })   // the eye must clear the ice cell (now water) into the air above
  const r = await airPocketStep(bot, airPocketPlan(world(HIVE_D)), deps()); clearInterval(bot._healthTimer)
  assert.equal(r.ok, true, r.why); assert.equal(r.kind, 'ice')
})
await t('F4 the dig opens but the eye never reaches air -> failed, not success', async () => {
  const bot = fakeBot({ rise: false })
  const r = await airPocketStep(bot, airPocketPlan(world(HIVE_C)), deps()); clearInterval(bot._healthTimer)
  assert.equal(r.ok, false); assert.match(r.why, /never reached air/)
})
await t('F5 breathing with FLAT health is not confirmed -> failed', async () => {
  const bot = fakeBot({ healthTick: 0 })
  const r = await airPocketStep(bot, airPocketPlan(world(HIVE_C)), deps()); clearInterval(bot._healthTimer)
  assert.equal(r.ok, false); assert.match(r.why, /not confirmed/)
})
await t('F6 the roof changed since the plan -> failed without digging', async () => {
  const bot = fakeBot({ cells: { ...HIVE_C, '0,2,0': 'dirt' } })
  let dug = 0; bot.dig = async () => { dug++ }
  const r = await airPocketStep(bot, airPocketPlan(world(HIVE_C)), deps()); clearInterval(bot._healthTimer)
  assert.equal(r.ok, false); assert.match(r.why, /roof cell changed/); assert.equal(dug, 0)
})

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
               /airPocketing = true[\s\S]{0,200}airPocketStep\(/.test(code) && /finally \{ airPocketing = false \}/.test(code) &&
               /drownFails = 0; drownFailPos = null/.test(code) }
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
await t('G4 MUTANT KILLED: without clearing the fail memory on success the wiring check fails', () => {
  const src = readFileSync(REFLEX_PATH, 'utf8')
  const old = 'drownFails = 0; drownFailPos = null; drownFailHealth = null'
  assert.ok(src.split(old).length === 2, 'anchor missing or not unique')
  assert.equal(wiring(src.replace(old, 'drownFailHealth = null')).ok, false)
})

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
      assert.notEqual(r.why, 'envelope breached (> 7 HP in 10 s)')
    }))

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
