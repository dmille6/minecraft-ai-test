#!/usr/bin/env node
// THE TOWN WALL, OFFLINE (wall-01): the bots' own siting (wall.mjs siteWall) run on COPIES of a world's region files and pool
// state, so where a town's wall goes -- its gateways, sally ports, materials and what it cuts off -- is known before any bot sites
// it; then the same record LAID END TO END by the bots' own visit (buildrun.mjs runVisit, as skills.mjs buildWall runs it) with
// fake builders, and the walk proven on the finished wall.
//
//   node scripts/wall-offline.mjs <dump.json> <pool-state-dir> [--torches N] [--out record.json] [--svg map.svg]
//        [--build] [--builders 4] [--rounds 80] [--rows rows.jsonl]
//
// <dump.json>: scripts/host/townplan_blockdump.py over COPIES of the region files (y home-14 .. home+28 at least). <pool-state-dir>:
// a COPY of /var/lib/mcai/_pool-<pool>. Nothing is written but --out, --svg and --rows.
//
// THE WALK PROOF (--build): from home, the builders' stand walk (wall.mjs walkSet: 4 neighbours, up or down one with head room)
// and a pathfinder-like walk (up one, down up to three), on the world before and after: every outside feet cell reached before is
// reached after (`cut`), and the detour to it (the walk's distance after / before) -- its median, p95 and worst.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { EventEmitter } from 'node:events'
import { dumpReader, poolRecords } from './buildsite-offline.mjs'
import { recordHead } from '../src/buildproj.mjs'
import * as PJ from '../src/buildproj.mjs'
import { runVisit, cellDone } from '../src/buildrun.mjs'
import { installAckTracker } from '../src/buildack.mjs'
import { recordZones, buildRowDetail, buildSegDetail } from '../src/shop.mjs'
import { MONUMENT_BLUEPRINT } from '../src/ziggurat.mjs'
import * as W from '../src/wall.mjs'

const argv = process.argv.slice(2)
const opt = (k, d = null) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d }
const flag = k => argv.includes(`--${k}`)
const [dumpPath, poolDir] = argv
if (!dumpPath || !poolDir) { console.error('usage: wall-offline.mjs <dump.json> <pool-state-dir> [--torches N] [--out f] [--svg f] [--build]'); process.exit(2) }
const dump = JSON.parse(fs.readFileSync(dumpPath, 'utf8'))
const base = dumpReader(dump)
const R = poolRecords(poolDir)
if (!R.head) { console.error('the pool records cannot be read:', R.why); process.exit(1) }
const plan = { ...R.head.plan, gen: R.head.gen }
const home = plan.home
const hk = `${home.x}_${home.y}_${home.z}`
const files = fs.readdirSync(poolDir)
const readJ = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')) } catch { return null } }
const gen = f => Number(/\.g(\d+)\./.exec(f)?.[1] ?? 0)
const plots = [...new Set(files.map(f => /^project-[-\d_]+\.([A-Za-z0-9]+)\.g\d+\.json$/.exec(f)?.[1]).filter(Boolean))].filter(p => p !== W.WALL_PLOT).sort()
const records = plots.map(plot => ({ plot, rec: recordHead(poolDir, `project-${hk}.${plot}`).head?.rec ?? null })).filter(r => r.rec)
const plinthRec = readJ(path.join(poolDir, `junkwell-plinth-${hk}.json`))
const caps = []
if (plinthRec?.plan?.cap) caps.push([plinthRec.plan.cap.x, plinthRec.plan.cap.y, plinthRec.plan.cap.z])
const comps = files.filter(f => f.startsWith(`composter-site-${hk}.g`)).sort((a, b) => gen(b) - gen(a))
const cs = comps.length ? readJ(path.join(poolDir, comps[0])) : null
const composter = cs && [cs.x, cs.y, cs.z].every(Number.isFinite) ? [cs.x, cs.y, cs.z] : ((plan.plots ?? []).find(p => p.kind === 'farm')?.composter ?? null)
const t0 = Date.now()
const inputs = { plan, zones: R.zones, caps, plinth: R.wells, composter, farm: R.farm, records, pzones: recordZones(records.map(r => r.rec)), zig: r => r?.blueprint === MONUMENT_BLUEPRINT, lights: Number(opt('torches', 0)) }
const s = W.siteWall(base, inputs)
const ms = Date.now() - t0
const rec = s.record
const roles = rec ? rec.cells.reduce((m, c) => (m[c.role] = (m[c.role] ?? 0) + 1, m), {}) : {}
console.log(JSON.stringify({
  ok: s.ok, why: s.why, ms, inside: s.inside, tried: s.tried, projects: records.map(r => `${r.plot}:${r.rec.blueprint}:${r.rec.structure_complete ? 'complete' : 'open'}`),
  ...(rec ? { ring: rec.ring, margin: rec.margin, counts: rec.counts, ports: rec.ports, posts: rec.posts, lights: rec.lights, gates: rec.gates.map(g => `${g.why}:${g.cols[0].join(',')}..${g.cols.at(-1).join(',')}(${g.cols.length})`),
    gaps: Object.entries(rec.cols.filter(c => c.s === 'gap' || c.s === 'open').reduce((m, c) => (m[c.why] = (m[c.why] ?? 0) + 1, m), {})),
    cells: rec.cells.length, roles, segments: rec.segments.length, clear: rec.clear.length, clearKinds: rec.clear.reduce((m, c) => (m[c.kind] = (m[c.kind] ?? 0) + 1, m), {}), felled: rec.felled, bom: rec.bom, escape: rec.escape,
    ys: [Math.min(...rec.cells.map(c => c.at[1])), Math.max(...rec.cells.map(c => c.at[1]))] } : {}),
}, null, 1))
if (opt('out') && rec) fs.writeFileSync(opt('out'), JSON.stringify(rec))

// THE MAP: the dump's top surface with the wall's columns over it (state colours), the gateways, the other projects
if (opt('svg') && rec) {
  const [x0, z0, x1, z1] = dump.box, S = 8
  const Wd = (x1 - x0 + 1) * S, H = (z1 - z0 + 1) * S
  const colour = n => /leaves/.test(n) ? '#2f5d34' : /_log/.test(n) ? '#5b3a1e' : n === 'grass_block' ? '#7fb24f' : /dirt/.test(n) ? '#8a6a45' : /sand/.test(n) ? '#dccf96'
    : /^(stone|andesite|diorite|granite|tuff|gravel)$/.test(n) ? '#8d8d8d' : n === 'cobblestone' ? '#6e6e6e' : /brick|planks|glass|copper/.test(n) ? '#b07a4a' : /chest|table|furnace|composter/.test(n) ? '#d23' : /water/.test(n) ? '#3a6fd8' : '#aaa'
  const PLANT = /^(air|cave_air|short_grass|tall_grass|fern|large_fern|snow.*|.*_sapling|brown_mushroom|sweet_berry_bush|wall_torch|torch|dandelion|poppy)$/
  let out = `<svg xmlns="http://www.w3.org/2000/svg" width="${Wd}" height="${H + 40}" viewBox="0 0 ${Wd} ${H + 40}" font-family="monospace" font-size="11">\n<rect width="100%" height="100%" fill="#222"/>\n`
  for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
    let n = '?'
    for (let y = dump.y[1]; y >= dump.y[0]; y--) { const b = base(x, y, z); if (!b) break; if (PLANT.test(b.name)) continue; n = b.name; break }
    out += `<rect x="${(x - x0) * S}" y="${(z - z0) * S}" width="${S}" height="${S}" fill="${colour(n)}" opacity="0.6"/>`
  }
  for (const r of records) for (const c of r.rec.cells) out += `<rect x="${(c.at[0] - x0) * S}" y="${(c.at[2] - z0) * S}" width="${S}" height="${S}" fill="none" stroke="#ffd34d" stroke-width="0.5"/>`
  const fill = { wall: '#e8e8e8', post: '#c9a46b', gate: '#ff2bd6', open: '#29d3ff', gap: '#ff7f50' }
  const steps = new Set(rec.cells.filter(c => c.role === 'step').map(c => `${c.at[0]},${c.at[2]}`))
  for (const k of steps) { const [x, z] = k.split(',').map(Number); out += `<rect x="${(x - x0) * S + 1}" y="${(z - z0) * S + 1}" width="${S - 2}" height="${S - 2}" fill="#9a9a9a"/>` }
  for (const c of rec.cols) out += `<rect x="${(c.x - x0) * S}" y="${(c.z - z0) * S}" width="${S}" height="${S}" fill="${fill[c.s] ?? '#fff'}"/>`
  for (const c of rec.cells.filter(q => q.role === 'light')) out += `<circle cx="${(c.at[0] - x0) * S + S / 2}" cy="${(c.at[2] - z0) * S + S / 2}" r="2.5" fill="#ffef5c"/>`
  for (const c of rec.clear.filter(q => q.kind === 'tree')) out += `<circle cx="${(c.at[0] - x0) * S + S / 2}" cy="${(c.at[2] - z0) * S + S / 2}" r="1.6" fill="#5b3a1e"/>`
  out += `<text x="6" y="${H + 16}" fill="#ddd">wall-01 record (offline): ring ${rec.ring.join(',')} m${rec.margin}; ${rec.cells.length} cells; ${rec.counts.gate} gateway cols, ${rec.ports} sally ports. x ${x0}..${x1}, z ${z0}..${z1}, north up</text>`
  out += `<text x="6" y="${H + 32}" fill="#ddd">white = wall, tan = gate post, magenta = gateway, cyan = opening (Q7 / short), orange = gap (water, zone, project), grey = steps, yellow = light, outline = projects</text>`
  out += '\n</svg>\n'
  fs.writeFileSync(opt('svg'), out)
}

if (!flag('build') || !rec) process.exit(0)

// ---- THE BUILD: fake builders run the bots' own visit on a copy of the blocks ---------------------------------------------------
const over = new Map()
const AIRB = { name: 'air', boundingBox: 'empty' }
const SOLIDB = n => ({ name: n, boundingBox: n === 'torch' || n === 'wall_torch' ? 'empty' : 'block' })
const read = (x, y, z) => over.get(`${x},${y},${z}`) ?? base(x, y, z)
const set = (a, n) => over.set(a.join(','), n === 'air' ? AIRB : SOLIDB(n))
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wallbuild-'))
const key = PJ.projKey(home, W.WALL_PLOT)
const pub = PJ.publishRecord(dir, key, () => ({ ...rec }))
const rows = []
let t = Date.parse('2026-10-30T06:00:00Z')
function builder (name, feet) {
  const client = new EventEmitter(); client.write = () => {}
  const fb = new EventEmitter(); fb._client = client; fb.players = {}
  const acks = installAckTracker(fb)
  let at = feet.slice(), held = 'cobblestone'
  const inv = { cobblestone: 2000, stone_bricks: 64, torch: 16 }
  const has = n => (inv[n] ?? 0) > 0
  has.planks = () => null
  const e = {
    read, feet: () => at.slice(), bodies: () => [], self: () => ({ x: at[0] + 0.5, y: at[1], z: at[2] + 0.5, w: 0.6, h: 1.8 }),
    walkTo: async s => { at = s.slice(); return true },
    hold: async n => { if (!has(n)) return false; held = n; return true },
    has, look: async () => {},
    nextSeq: () => acks.tracker.next(),
    send: (support, face, seq) => {
      const tg = support.map((v, i) => v + face[i]), tb = read(...tg)
      if (tb && tb.boundingBox === 'empty' && has(held)) { set(tg, held === 'torch' && face[1] !== 1 ? 'wall_torch' : held); inv[held]-- }
      setImmediate(() => acks.tracker.ack(seq))
    },
    waitAck: (seq, ms) => acks.tracker.wait(seq, ms),
    track: (id, seq) => acks.track(id, seq), untrack: id => acks.untrack(id),
    conn: () => `${name}-c1`, acked: () => acks.tracker.acked, seen: () => ({ online: true, offlineSince: null, leftAt: null }),
    dig: async (c, expect) => { const b = read(...c); if (expect && b?.name !== expect) return 'refused'; set(c, 'air'); return 'confirmed' },
    probe: async () => null, aborted: () => false,
    log: (k, d) => rows.push({ t: new Date(t).toISOString(), bot: name, name: k, feet: at.slice(), detail: k === '_build_seg' ? buildSegDetail({ project: W.WALL_PLOT, ...d }) : buildRowDetail({ project: W.WALL_PLOT, ...d }) }),
    now: () => t, sleep: async ms => { t += ms }, spawnedAt: () => 0,
  }
  return { name, e, inv, stands: { pending: null, bans: {} }, unknown: new Set(), blocked: new Map() }
}
const n = Number(opt('builders', 4)), rounds = Number(opt('rounds', 80))
const bs = Array.from({ length: n }, (_, i) => builder(`B${i}`, [home.x + i, home.y, home.z]))
const isDone = c => cellDone(read(...c.at), W.WALL_PALETTE, c.role)
const doneN = () => rec.cells.filter(isDone).length
const stops = {}
let r = 0
for (; r < rounds && doneN() < rec.cells.length; r++) {
  for (const b of bs) {
    const slot = PJ.takeSlot(dir, key, b.name, W.WALL_BUILDERS, { now: t })
    if (!slot.ok) { stops.slots_full = (stops.slots_full ?? 0) + 1; continue }
    const v = await runVisit({ dir, key, me: b.name, home, stood: [], record: W.wallVisitRecord(rec, b.blocked, t), recordGen: pub.gen, palette: W.WALL_PALETTE, res: null, resFailed: false, slot: slot.slot, slotGen: slot.gen, stands: b.stands, unknown: b.unknown,
      domain: () => true, walkR: W.wallWalkR(rec, home), foreign: W.WALL_FOREIGN, blockLayer: false, clearMax: W.WALL_CLEAR_MAX }, b.e, { maxSteps: 400 })
    PJ.releaseLease(dir, key, `slot${slot.slot}`, b.name, slot.gen)
    stops[v.stop] = (stops[v.stop] ?? 0) + 1
    { const bs = W.blockedSeg(v.stop, v.why); if (bs) b.blocked.set(bs, t) }
    rows.push({ t: new Date(t).toISOString(), bot: b.name, name: '_build_visit', feet: b.e.feet(), detail: `project=wall outcome=${v.stop} stop=${v.stop} placed=${v.placed} cleared=${v.cleared}` })
    if (v.stop !== 'complete' && process.env.VERBOSE) console.error(b.name, r, v.stop, v.why)
    t += 60_000
  }
  t += 10 * 60_000
}
const open = rec.cells.filter(c => !isDone(c))
const placedBy = {}
for (const b of bs) for (const [k, v] of Object.entries(b.inv)) placedBy[k] = (placedBy[k] ?? 0) + ({ cobblestone: 2000, stone_bricks: 64, torch: 16 }[k] - v)
const builds = rows.filter(q => q.name === '_build')
const clearsLeft = rec.clear.filter(c => read(...c.at)?.name === c.name)
// THE WALK PROOF on the finished world
const R0 = Math.max(...rec.cols.map(c => Math.max(Math.abs(c.x - home.x), Math.abs(c.z - home.z)))) + 8
const [rx0, rz0, rx1, rz1] = rec.ring
const outside = (x, z) => x < rx0 || x > rx1 || z < rz0 || z > rz1
function dist (rd, drops) {
  const passable = b => !!b && b.boundingBox === 'empty' && !/water|lava/.test(b.name)
  const node = (x, y, z) => { const f = rd(x, y - 1, z); return !!f && f.boundingBox === 'block' && !/water|lava/.test(f.name) && passable(rd(x, y, z)) && passable(rd(x, y + 1, z)) }
  let st = null
  for (let dy = 0; !st && dy <= 4; dy++) for (const y of [home.y + dy, home.y - dy]) if (!st && node(home.x, y, home.z)) st = [home.x, y, home.z]
  const d = new Map([[st.join(','), 0]]), q = [st]
  for (let h = 0; h < q.length; h++) {
    const [x, y, z] = q[h], dv = d.get(q[h].join(','))
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, nz = z + dz
      if (Math.max(Math.abs(nx - home.x), Math.abs(nz - home.z)) > R0) continue
      const cand = [0, 1, ...Array.from({ length: drops }, (_, i) => -(i + 1))]
      for (const dy of cand) {
        const ny = y + dy
        if (dy === 1 && !passable(rd(x, y + 2, z))) continue
        if (dy < 0 && ![...Array(-dy).keys()].every(j => passable(rd(nx, y + 1 - j, nz)))) continue
        if (!node(nx, ny, nz)) continue
        const k = `${nx},${ny},${nz}`
        if (!d.has(k)) { d.set(k, dv + 1); q.push([nx, ny, nz]) }
        break
      }
    }
  }
  return d
}
const proof = {}
for (const [model, drops] of [['stand_walk', 1], ['pathfinder_like', 3]]) {
  const a = dist(base, drops), b = dist(read, drops)
  let cut = 0, outN = 0
  const ratios = [], extra = []
  for (const [k, d0] of a) {
    const [x, , z] = k.split(',').map(Number)
    if (!outside(x, z)) continue
    if (rec.cells.some(c => c.at[0] === x && c.at[2] === z)) continue
    outN++
    const d1 = b.get(k)
    if (d1 == null) { cut++; continue }
    ratios.push(d1 / Math.max(1, d0)); extra.push(d1 - d0)
  }
  ratios.sort((p, q) => p - q); extra.sort((p, q) => p - q)
  const pc = (arr, p) => arr.length ? Math.round(arr[Math.min(arr.length - 1, Math.floor(p * arr.length))] * 100) / 100 : null
  proof[model] = { outside_reached_before: outN, cut, detour_extra_blocks: { median: pc(extra, 0.5), p95: pc(extra, 0.95), max: extra.at(-1) ?? null }, detour_ratio: { median: pc(ratios, 0.5), p95: pc(ratios, 0.95), max: pc(ratios, 1) } }
}
console.log(JSON.stringify({ build: { cells: rec.cells.length, done: doneN(), rounds: r, stops, open: open.length, openBySeg: open.reduce((m, c) => (m[c.seg] = (m[c.seg] ?? 0) + 1, m), {}), openSample: open.slice(0, 10).map(c => `${c.at.join(',')}:${c.role}:${c.seg}:${read(...c.at)?.name}`),
  clearsLeft: clearsLeft.length, clearsLeftSample: clearsLeft.slice(0, 6).map(c => `${c.at.join(',')}:${c.kind}:${c.name}`), placedBy,
  rows: builds.reduce((m, q) => { const op = /op=(\S+)/.exec(q.detail)?.[1]; const kind = /kind=(\S+)/.exec(q.detail)?.[1]; const kk = `${op}${kind ? ':' + kind : ''}`; m[kk] = (m[kk] ?? 0) + 1; return m }, {}) },
proof }, null, 1))
if (opt('rows')) fs.writeFileSync(opt('rows'), rows.map(q => JSON.stringify(q)).join('\n') + '\n')
if (opt('world')) fs.writeFileSync(opt('world'), JSON.stringify([...over.entries()].map(([k, v]) => [k, v.name])))
