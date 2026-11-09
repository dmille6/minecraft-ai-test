// HERD-01: THE PENS' ANIMALS (villager economy 11-09; pens.mjs builds the rings; design docs/reports/villagecon-2026-11-09/design.md).
// PURE decisions: the census of each pen, the next job (shear, breed, fetch), the lure's legs, the sightings. The visit is skills.mjs
// herdVisit, run by the pens' own build visit once the rings stand (UPKEEP, as the crop farm's harvest).
//
// PROVEN (Paper 1.21.8 / mineflayer 4.37.1 + the bots' Movements, sandbox7 11-09, sandbox/econ/herd-proof.cjs, 4/4):
//   LURE   a sheep 50 b out, the bot holding wheat in legs of <= 5 b, waiting while it is > 5 b behind: into the ring in 42-45 s (twice,
//          straight and diagonal); the gate opened, the bot walked in (the pathfinder passes an OPEN gate), wheat put away, out, the
//          gate closed from the apron; the first sheep still inside when the second came in.
//   BREED  INSIDE the ring (across the fence the sheep never came within reach: 0 of 2 fed): in, gate closed behind, wheat to two
//          adults (activateEntity), a lamb in 9 s, out, gate closed: 3 inside.
//   SHEAR  inside: both adults sheared (server Sheared=1b), 5 wool picked up, both still inside, the gate closed, the bot out.
// Vanilla: an animal follows a player holding its food within 10 b (TemptGoal); wheat breeds sheep and cows; a parent waits 5 min
// (6000 ticks) to breed again and a lamb grows up in 20 min; a sheared sheep regrows its wool by eating grass (the pen's floor).
export const HERD = Object.freeze({
  cap: 6,                    // animals per pen, babies included (the owner's farms design: 6 a species)
  breedMinAdults: 2,
  breedEveryMs: 6 * 60_000,  // a pen is bred at most this often (vanilla parents wait 5 min)
  wheatKeep: 32,             // the town's wheat after a breeding draw (the hay plan's floor; the bread's keep is 48)
  breedWheat: 2,             // one wheat per parent
  woolCap: 64,               // the town's wool: at or above, no shearing (a stack covers 21 beds)
  fetchR: 160,               // a wild animal remembered within this of the pens may be fetched
  fetchPer: 2,               // adults wanted per pen before fetching stops (breeding does the rest)
  sightMs: 30 * 60_000,      // a sighting is used this long
  leg: 5,                    // the lure's legs
  near: 5,                   // the animal within this of the bot before the next leg
  lost: 10,                  // further than this: lost (vanilla TemptGoal range)
  legWaitMs: 1_500,
  fetchFailMs: 30 * 60_000,  // an animal lost on a fetch is not chased again this long
  resumeMs: 20 * 60_000,     // a fetch cut short by the visit's clock is resumed from where the animal was left, this long
})
const SPECIES = ['sheep', 'cow']
const k2 = (x, z) => `${x},${z}`
/** An entity's herd reading -> { id, uuid, species, x, y, z, baby, woolly } | null. Pure (metadata 16 = baby; sheep 17 = colour | 0x10 sheared). */
export function animalOf (e) {
  if (!e?.position || !SPECIES.includes(e.name)) return null
  const md = e.metadata ?? []
  const baby = md[16] === true
  const woolly = e.name === 'sheep' ? !((Number(md[17]) || 0) & 0x10) : false
  return { id: e.id, uuid: e.uuid ?? String(e.id), species: e.name, x: e.position.x, y: e.position.y, z: e.position.z, baby, woolly }
}
/** The pen's floor columns as a Set of "x,z". Pure. */
const floorSet = (rec, sp) => new Set((rec?.pens?.[sp]?.floor ?? []).map(p => k2(p[0], p[2])))
/**
 * THE CENSUS -> { sheep: { adults, babies, woolly, n }, cow: { ... }, wild: [animal] }. Pure. An animal on a pen's floor is that pen's
 * (any species: a stray in the wrong pen counts where it stands); the rest are wild.
 */
export function herdCensus (animals, rec) {
  const out = { sheep: { adults: [], babies: [], woolly: [], n: 0 }, cow: { adults: [], babies: [], woolly: [], n: 0 }, wild: [] }
  const fl = Object.fromEntries(SPECIES.map(sp => [sp, floorSet(rec, sp)]))
  for (const a of animals ?? []) {
    if (!a) continue
    const k = k2(Math.floor(a.x), Math.floor(a.z))
    const pen = SPECIES.find(sp => fl[sp].has(k))
    if (!pen) { out.wild.push(a); continue }
    const p = out[pen]
    p.n++
    if (a.baby) p.babies.push(a); else p.adults.push(a)
    if (a.woolly && !a.baby && a.species === 'sheep') p.woolly.push(a)
  }
  return out
}
/** THE HERD FILE, read defensively -> { seen, bredAt, failed, resume }. Pure. */
export function herdState (raw) {
  const o = raw && typeof raw === 'object' ? raw : {}
  const obj = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : {})
  return { seen: obj(o.seen), bredAt: obj(o.bredAt), failed: obj(o.failed), resume: o.resume && typeof o.resume === 'object' ? o.resume : null }
}
/** NOTE WILD ANIMALS a bot sees (within fetchR of the pens' box centre) -> new state. Pure. Pen animals are never "wild" sightings. */
export function noteAnimals (state0, census, rec, now, { r = HERD.fetchR, max = 200 } = {}) {
  const s = herdState(state0)
  const [x0, z0, x1, z1] = rec?.box ?? [0, 0, 0, 0]
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2
  const seen = { ...s.seen }
  for (const a of census?.wild ?? []) {
    if (a.baby || Math.hypot(a.x - cx, a.z - cz) > r) continue
    seen[a.uuid] = { species: a.species, x: Math.round(a.x * 10) / 10, y: Math.floor(a.y), z: Math.round(a.z * 10) / 10, at: now }
  }
  // the pens' own animals are not wild any more
  for (const sp of SPECIES) for (const a of [...(census?.[sp]?.adults ?? []), ...(census?.[sp]?.babies ?? [])]) delete seen[a.uuid]
  const keep = Object.entries(seen).filter(([, v]) => now - (v.at ?? 0) < HERD.sightMs).sort((a, b) => b[1].at - a[1].at).slice(0, max)
  return { ...s, seen: Object.fromEntries(keep) }
}
/**
 * THE NEXT JOB -> { op: 'shear' | 'breed' | 'fetch' | null, species, why, target? }. Pure.
 *   census      herdCensus (the bot standing within sight of the pens: `known` false -> null, never a guess)
 *   state       herdState (sightings, last breed per pen, failed fetches, a fetch to resume)
 *   townWheat / bagWheat, townWool, shears (the bag has or can make shears)
 * Order: SHEAR (a woolly adult sheep in the pen, the town under its wool cap) -> BREED (>= 2 adults, the pen under its cap, not bred
 * within breedEveryMs, wheat above the keep) -> FETCH (a pen with fewer than fetchPer adults: a resumable fetch first, else the
 * nearest remembered wild animal of its species within fetchR, not failed lately).
 */
export function herdWork ({ census, known = true, state = null, now = 0, townWheat = 0, bagWheat = 0, townWool = 0, shears = false, penCentre = null } = {}) {
  if (!known || !census) return { op: null, why: 'unknown' }
  const s = herdState(state)
  const sh = census.sheep
  if (sh.woolly.length && townWool < HERD.woolCap && shears) return { op: 'shear', species: 'sheep', why: `woolly${sh.woolly.length}` }
  const wheat = townWheat - HERD.wheatKeep + bagWheat
  for (const sp of SPECIES) {
    const p = census[sp]
    if (p.adults.length >= HERD.breedMinAdults && p.n < HERD.cap && now - (s.bredAt[sp] ?? -Infinity) >= HERD.breedEveryMs && wheat >= HERD.breedWheat) return { op: 'breed', species: sp, why: `adults${p.adults.length}/n${p.n}` }
  }
  for (const sp of SPECIES) {
    if (census[sp].adults.length >= HERD.fetchPer) continue
    const r = s.resume
    if (r && r.species === sp && now - (r.at ?? 0) < HERD.resumeMs) return { op: 'fetch', species: sp, why: 'resume', target: r }
    const c = penCentre ?? { x: 0, z: 0 }
    const cand = Object.entries(s.seen).filter(([u, v]) => v.species === sp && now - (v.at ?? 0) < HERD.sightMs && !(now - (s.failed[u] ?? -Infinity) < HERD.fetchFailMs))
      .map(([uuid, v]) => ({ uuid, ...v, d: Math.hypot(v.x - c.x, v.z - c.z) })).filter(v => v.d <= HERD.fetchR).sort((a, b) => a.d - b.d)
    if (cand.length) return { op: 'fetch', species: sp, why: `seen${cand.length}`, target: cand[0] }
  }
  return { op: null, why: 'idle' }
}
/**
 * THE LURE'S NEXT MOVE -> { act: 'leg', to } | { act: 'wait' } | { act: 'arrived' } | { act: 'lost' }. Pure.
 * me, animal: positions; dest: the apron stand. A leg of at most HERD.leg toward dest while the animal is within HERD.near; a wait
 * while it is within HERD.lost; lost beyond. Arrived within `arrive` (2.5) of dest.
 */
export function lureStep (me, animal, dest, { leg = HERD.leg, near = HERD.near, lost = HERD.lost, arrive = 2.5 } = {}) {
  if (!me || !dest) return { act: 'lost' }
  // within 2.5 of the stand is THERE (pens-e2e 11-09 run 1: a goto with range 1 to a floored leg ends up to ~1.6 from the stand's centre,
  // and the lure re-legged 337 times beside the gate, the sheep 2-4 b from it, until the visit's clock)
  if (Math.hypot(me.x - dest.x, me.z - dest.z) < arrive) return { act: 'arrived' }
  if (!animal) return { act: 'lost' }
  const da = Math.hypot(animal.x - me.x, animal.z - me.z)
  if (da > lost) return { act: 'lost' }
  if (da > near) return { act: 'wait' }
  const d = Math.hypot(dest.x - me.x, dest.z - me.z), st = Math.min(leg, d)
  return { act: 'leg', to: { x: me.x + (dest.x - me.x) / d * st, z: me.z + (dest.z - me.z) / d * st } }
}
/** The `_herd` row detail. */
export const herdDetail = o => [`op=${o.op}`, o.species ? `species=${o.species}` : null, o.why ? `why=${o.why}` : null, o.uuid ? `uuid=${o.uuid}` : null,
  o.n != null ? `n=${o.n}` : null, o.wool != null ? `wool=${o.wool}` : null, o.legs != null ? `legs=${o.legs}` : null, o.d != null ? `d=${Math.round(o.d)}` : null,
  o.census ? `pens=sheep:${o.census.sheep.n},cow:${o.census.cow.n}` : null, o.gate ? `gate=${o.gate}` : null, o.stop ? `stop=${o.stop}` : null].filter(Boolean).join(' ')
