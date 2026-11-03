#!/usr/bin/env node
// EXPWATER-01 OFFLINE: the showcase's water on the expedition spokes, measured on a COPY of the world (townplan_blockdump.py over
// the timelapse mirror's region files; nothing here touches a world).
//
//   node scripts/expwater-offline.mjs <dump.json> [--home x,y,z] [--map] [--ring 300]
//
// Per bearing (expedition.mjs bearingVec), every block along the spoke from home is read with expedition.mjs surfaceAt (the very
// function the legs use): each WATER RUN's start, width and deepest column, and what lies on the far side. --map prints the ground
// at 8-block resolution (. land, ~ water, ? unread, # none).
import fs from 'node:fs'
import { dumpReader } from './buildsite-offline.mjs'
import * as E from '../src/expedition.mjs'

const argv = process.argv.slice(2)
const opt = (k, d = null) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d }
const [dumpPath] = argv
if (!dumpPath) { console.error('usage: expwater-offline.mjs <dump.json> [--home x,y,z] [--map] [--ring 300]'); process.exit(2) }
const [hx, hy, hz] = (opt('home', '0,70,0')).split(',').map(Number)
const home = { x: hx, y: hy, z: hz }
const ring = Number(opt('ring', 300))
const read = dumpReader(JSON.parse(fs.readFileSync(dumpPath, 'utf8')))

/** Water depth of a column whose surface scan met water at y -> blocks of liquid down to the bed. */
function depthAt (x, y, z) { let d = 0; while (d < 40) { const b = read(x, y - d, z); if (!b || !/^(water|bubble_column)$/.test(b.name) && !/\[waterlogged\]$/.test(b.name) && !/^(seagrass|tall_seagrass|kelp|kelp_plant)$/.test(b.name)) break; d++ } return d }

const out = []
for (let k = 0; k < E.BEARINGS; k++) {
  const v = E.bearingVec(k)
  let y = home.y, runs = [], cur = null, unread = null
  for (let s = 1; s <= ring + 40; s++) {
    const x = Math.floor(home.x + v.dx * s), z = Math.floor(home.z + v.dz * s)
    const c = E.surfaceAt(read, x, z, y, { up: 20, down: 20 })
    if (!c) { unread = s; break }
    if (c.water) {
      const d = depthAt(x, c.y, z)
      if (!cur) cur = { from: s, to: s, deep: d, at: [x, c.y, z] }
      else { cur.to = s; cur.deep = Math.max(cur.deep, d) }
      continue
    }
    if (cur) { cur.width = cur.to - cur.from + 1; cur.far = c.none ? 'none' : `land y=${c.y}`; cur.near_y = y; runs.push(cur); cur = null }
    if (!c.none) y = c.y
  }
  if (cur) { cur.width = cur.to - cur.from + 1; cur.far = 'open'; runs.push(cur) }
  out.push({ bearing: k, runs: runs.map(r => ({ from: r.from, width: r.width, deep: r.deep, at: r.at, far: r.far })), unread })
}
for (const o of out) console.log(`bearing ${o.bearing}: ${o.runs.length ? o.runs.map(r => `water@${r.from} w=${r.width} deep=${r.deep} at=${r.at.join(',')} far=${r.far}`).join(' | ') : 'dry'}${o.unread ? ` unread@${o.unread}` : ''}`)
if (argv.includes('--map')) {
  const R = 400
  for (let z = -R; z <= R; z += 8) {
    let line = ''
    for (let x = -R; x <= R; x += 8) {
      if (Math.abs(x) < 8 && Math.abs(z) < 8) { line += 'H'; continue }
      const c = E.surfaceAt(read, home.x + x, home.z + z, home.y, { up: 30, down: 25 })
      line += !c ? '?' : c.water ? '~' : c.none ? '#' : '.'
    }
    console.log(line)
  }
}
if (argv.includes('--json')) console.log(JSON.stringify(out))

// --at x,y,z,bearing[;...]: AT A LIVE TURN POINT, the crossing ahead: for each direction within +-60 degrees of the bearing (5-degree
// steps), the water columns from the first wet column to the far shore (a standable dry cell), the deepest column, and the far
// shore's height over the water; then the narrowest crossing, and whether a DRY walk round exists (a BFS over standable columns,
// step up 1 / down 3, inside `--walk R` blocks of the turn) to a cell 40 blocks further out along the bearing.
const ats = opt('at', null)
if (ats) {
  const R = Number(opt('walk', 120))
  for (const spec of ats.split(';')) {
    const [ax, ay, az, kb] = spec.split(',').map(Number)
    const v = E.bearingVec(kb)
    const rows = []
    for (let deg = -60; deg <= 60; deg += 5) {
      const a = deg * Math.PI / 180
      const dx = v.dx * Math.cos(a) - v.dz * Math.sin(a), dz = v.dx * Math.sin(a) + v.dz * Math.cos(a)
      let y = ay, wet = null, deep = 0, far = null, lastY = ay
      for (let s = 1; s <= 160; s++) {
        const x = Math.floor(ax + dx * s), z = Math.floor(az + dz * s)
        const c = E.surfaceAt(read, x, z, y, { up: 20, down: 25 })
        if (!c) { far = { s, why: 'unread' }; break }
        if (c.water) { if (wet == null) wet = s; deep = Math.max(deep, depthAt(x, c.y, z)); y = c.y; continue }
        if (wet != null && !c.none) { far = { s, y: c.y, x, z }; break }
        if (!c.none) { y = c.y; lastY = c.y }
      }
      rows.push({ deg, wet, width: wet != null && far?.y != null ? far.s - wet : null, deep, far, bankY: lastY })
    }
    const cross = rows.filter(r => r.width != null).sort((a, b) => a.width - b.width)
    console.log(`AT ${ax},${ay},${az} bearing ${kb}: ${rows.map(r => `${r.deg}:${r.wet == null ? 'dry' : r.width == null ? `wet@${r.wet}/${r.far?.why ?? 'nofar'}` : `w${r.width}d${r.deep}`}`).join(' ')}`)
    if (cross.length) { const c = cross[0]; console.log(`  narrowest: ${c.width} water columns at ${c.deg} deg (starts ${c.wet} out, deepest ${c.deep}, far shore ${c.far.x},${c.far.y},${c.far.z})`) }
    // the dry walk round
    const goal = { x: ax + v.dx * 40, z: az + v.dz * 40 }
    const key = (x, z) => `${x},${z}`
    const start = { x: Math.floor(ax), z: Math.floor(az), y: ay }
    const seen = new Map([[key(start.x, start.z), 0]]); let q = [start], hit = null, n = 0
    while (q.length && !hit) {
      const nq = []
      for (const p of q) {
        for (const [ox, oz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const x = p.x + ox, z = p.z + oz
          if (Math.hypot(x - ax, z - az) > R || seen.has(key(x, z))) continue
          const c = E.surfaceAt(read, x, z, p.y, { up: 2, down: 4 })
          if (!c || c.water || c.none || c.y - p.y > 1 || p.y - c.y > 3) continue
          seen.set(key(x, z), seen.get(key(p.x, p.z)) + 1); n++
          const np = { x, z, y: c.y }
          if ((x - ax) * v.dx + (z - az) * v.dz >= 40) { hit = np; break }
          nq.push(np)
        }
        if (hit) break
      }
      q = nq
    }
    console.log(`  dry walk round within ${R}: ${hit ? `YES, ${seen.get(key(hit.x, hit.z))} steps to ${hit.x},${hit.y},${hit.z}` : `NO (${n} dry cells reached)`}`)
  }
}

// --trip x,y,z,bearing[;...]: THE REAL PLANNER from a live turn point onward, swim off (the 11-02 planner) and on: legTarget leg by
// leg (each leg's target taken as reached), up to --legs N legs or the ring, with the leg kinds, the crossings and the turn reason.
const trips = opt('trip', null)
if (trips) {
  const N = Number(opt('legs', 12))
  for (const spec of trips.split(';')) {
    const [ax, ay, az, kb] = spec.split(',').map(Number)
    for (const swim of [0, E.SWIM_MAX]) {
      let pos = { x: ax, y: ay, z: az }, detour = null
      const kinds = []
      let end = 'legs'
      for (let i = 0; i < N; i++) {
        if (Math.hypot(pos.x - home.x, pos.z - home.z) >= ring) { end = 'reached'; break }
        const lt = E.legTarget(read, { pos, home, bearing: kb, detour, swim })
        if (!lt.ok) { end = `${lt.why}(${lt.whys})`; break }
        kinds.push(lt.via === 'swim' ? `swim${lt.wet}` : lt.via)
        detour = lt.detour?.waypoints?.length ? lt.detour : null
        pos = lt.target
      }
      console.log(`TRIP from ${ax},${az} b${kb} swim=${swim}: ${kinds.join(' ') || '-'} -> ${end} at ${pos.x},${pos.y},${pos.z} dist=${Math.round(Math.hypot(pos.x - home.x, pos.z - home.z))}`)
    }
  }
}
