#!/usr/bin/env node
// zigsite.mjs -- the OFFLINE siting gates Z0 (ziggurat) and M0 (shared mineshaft), docs/reports/ziggurat-mineshaft-2026-10-15.md.
//
//   node scripts/zigsite.mjs <worldsDir> <records.json> [pool ...] > out.json
//
// <worldsDir>/<pool>/r.X.Z.mca are READ-ONLY copies of the 10-15 04:14Z snapshots (/var/tmp/bm-worlds on 10.0.0.30; no
// world command runs). <records.json> holds each pool's composter / junk-well records (/var/lib/mcai, read-only).
// The SAME pure functions the jobs will run (monument.mjs, shaftplan.mjs, treefarm.mjs canonicalFarm) are applied.
import fs from 'node:fs'
import path from 'node:path'
import { loadRegion, reader } from './regionread.mjs'
import { scanColumn, scoreSite, candidateCorners, cheb, faceToward, zigCells, keptGround, ZIG } from '../src/monument.mjs'
import { surveyShaft, collarCandidates, collarOk, walkReach, toWorld } from '../src/shaftplan.mjs'
import { canonicalFarm, plotsOf } from '../src/treefarm.mjs'

const HOMES = {
  'board-a': [355, 73, 147], 'board-b': [-249, 65, 144], 'board-c': [355, 73, 147], 'board-d': [355, 73, 147],
  'hive-a': [355, 73, 147], 'hive-b': [355, 73, 147], 'hive-c': [-68, 68, -68], 'hive-d': [68, 65, 68],
  'placebo-a': [249, 75, -144], 'placebo-b': [282, 65, -388], 'placebo-c': [355, 73, 147], 'placebo-d': [177, 75, 73],
}
const [worldsDir, recFile, ...rest] = process.argv.slice(2)
const opt = Object.fromEntries(rest.filter(a => a.startsWith('--')).map(a => a.slice(2).split('=')).map(([k, v]) => [k, Number(v)]))
const only = rest.filter(a => !a.startsWith('--'))
const MAXC = opt.maxCentre ?? 64, RULES = { maxWater: opt.maxWater ?? 24, maxCut: opt.maxCut ?? 0 }
const recs = JSON.parse(fs.readFileSync(recFile, 'utf8'))
const pools = only.length ? only : Object.keys(HOMES)
const out = {}
for (const pool of pools) {
  const t0 = Date.now()
  const [hx, hy, hz] = HOMES[pool], home = { x: hx, y: hy, z: hz }
  const chunks = new Map()
  for (const f of fs.readdirSync(path.join(worldsDir, pool)).filter(f => f.endsWith('.mca'))) for (const [k, v] of loadRegion(path.join(worldsDir, pool, f))) chunks.set(k, v)
  const read = reader(chunks)
  // positive control: the town's own platform (stone_bricks under home) must read
  const platform = read(hx, hy - 2, hz)?.name ?? null
  const avoid = []
  for (const r of recs[pool] ?? []) if (r.rec && Number.isFinite(r.rec.x)) avoid.push({ x: r.rec.x, z: r.rec.z, r: 8, what: r.kind })
  // THE TOWN'S FARM, by treefarm-01's own canonicalFarm on the snapshot. A confirmed absence ("no farm site") excludes
  // nothing; an ERROR is unavailable evidence and refuses both gates for the world (Codex stage-1 P2: it failed open).
  let farm = null, farmCells = []
  try {
    const f = canonicalFarm({ home, read, avoid: avoid.map(a => ({ ...a, r: 4 })) })
    if (f.record) { farmCells = plotsOf(f.record); farm = farmCells.length }
    // only the farm code's own 'no farm site' is a confirmed absence; any other null (an unknown cell) is unavailable evidence
    else if (/^no farm site/.test(String(f.why))) farm = { absent: f.why }
    else farm = { err: `no record: ${f.why}` }
  } catch (e) { farm = { err: String(e.message ?? e) } }
  if (farm?.err) { out[pool] = { home, farm, ziggurat: null, shaft: null, why: 'farm siting unavailable: both gates refuse' }; console.error(`${pool}: farm error ${farm.err}`); continue }
  for (const p of farmCells) avoid.push({ x: p.x, z: p.z, r: 3, what: 'farm plot' })
  // ---- Z0: the ziggurat ----
  const span = MAXC + ZIG.B / 2 + ZIG.APRON + 2
  const colMap = new Map()
  const col = (x, z) => {
    const k = `${x},${z}`
    if (!colMap.has(k)) colMap.set(k, scanColumn(read, x, z, { yHi: hy + 40, yLo: hy - 50 }))
    return colMap.get(k)
  }
  const reasons = {}, oks = []
  for (const cand of candidateCorners(home, { step: 2, maxCentre: MAXC })) {
    if (Math.abs(cand.centre.x - hx) > span || Math.abs(cand.centre.z - hz) > span) continue
    const s = scoreSite({ col, corner: cand, avoid, ...RULES, stairFace: faceToward(cand.centre, home) })
    const why = s.ok ? 'ok' : s.why.replace(/\d+/g, 'N')
    reasons[why] = (reasons[why] ?? 0) + 1
    if (s.ok) oks.push({ ...s, corner: { x: cand.x, z: cand.z }, centre: cand.centre, dist: cheb(cand.centre, home), rank: s.score + 40 * (cheb(cand.centre, home) - 51) + 3 * s.tally.waterCols })
  }
  oks.sort((a, b) => a.rank - b.rank)
  const zig = oks[0] ?? null
  let zigOut = null
  if (zig) {
    const face = faceToward(zig.centre, home), cells = zigCells({ corner: zig.corner, baseY: zig.baseY, stairFace: face })
    // ground already inside the volume (counts as done-degraded core / foreign skin at build time)
    let preFilled = 0, preSkin = 0
    // credit only NATURAL GROUND AT OR BELOW THE COLUMN'S GROUND TOP: anything above the top is clearance (a pillar, a log),
    // whatever its material (Codex stage-1 r2: an 11-high dirt pillar was cleared AND credited)
    for (const c of cells) { const b = read(c.x, c.y, c.z), t = col(c.x, c.z)?.top; if (keptGround(b) && t != null && c.y <= t) { preFilled++; if (c.role === 'skin') preSkin++ } }
    zigOut = { centre: zig.centre, corner: zig.corner, baseY: zig.baseY, distFromHome: zig.dist, stairFace: face, planCells: cells.length,
               foundation: zig.foundation, apronFill: zig.apronFill, waterFill: zig.waterFill, guardAndApproach: zig.guardAndApproach, maxEdgeDropGuarded: zig.maxEdgeDropGuarded, foundationShare: +zig.share.toFixed(3), levellingDigs: zig.cut, voidsUnder: zig.tally.voids, liquidBelow: zig.tally.liquidBelow,
               clear: zig.clear, waterColumnsFilled: zig.tally.waterCols, groundInsideVolume: preFilled, groundInSkinCells: preSkin,
               blocksToPlace: cells.length - preFilled + zig.foundation + zig.apronFill + zig.waterFill + zig.guardAndApproach, alternatives: oks.length,
               next: oks.slice(1, 4).map(o => ({ centre: o.centre, baseY: o.baseY, foundation: o.foundation + o.apronFill, dist: o.dist })) }
  }
  // ---- M0: the shaft ----
  const zigApron = zig ? { x: zig.centre.x, z: zig.centre.z, half: ZIG.B / 2 + ZIG.APRON + 8 } : null
  const shafts = [], sreasons = {}
  // home's feet cell: the standable cell nearest home.y in home's column (the platform sits a block or two under home.y)
  let homeFeet = null
  for (const dy of [0, -1, 1, -2, 2, -3, 3]) { const y = hy + dy, b = read(hx, y, hz), h = read(hx, y + 1, hz), f = read(hx, y - 1, hz); if (b?.boundingBox === 'empty' && h?.boundingBox === 'empty' && f?.boundingBox === 'block') { homeFeet = { x: hx, y, z: hz }; break } }
  if (!homeFeet) sreasons['home not standable'] = 1
  for (const cand of collarCandidates(home)) {
    const o = cand.origin
    const near = avoid.find(a => Math.max(Math.abs(a.x - o.x), Math.abs(a.z - o.z)) <= a.r)
    if (near) { sreasons[`near ${near.what}`] = (sreasons[`near ${near.what}`] ?? 0) + 1; continue }
    if (farmCells.some(p => Math.max(Math.abs(p.x - o.x), Math.abs(p.z - o.z)) <= 6)) { sreasons['near the farm'] = (sreasons['near the farm'] ?? 0) + 1; continue }
    if (zigApron && Math.max(Math.abs(zigApron.x - o.x), Math.abs(zigApron.z - o.z)) <= zigApron.half) { sreasons['near the ziggurat'] = (sreasons['near the ziggurat'] ?? 0) + 1; continue }
    const top = col(o.x, o.z)
    if (top.top == null || top.above.some(a => a.kind !== 'tree' && a.kind !== 'debris')) { sreasons['bad surface'] = (sreasons['bad surface'] ?? 0) + 1; continue }
    // the collar sits at the town's surface level, never in a dug-out pit or on a pillar (a pit collar is a hole bots must
    // climb into; measured 10-15: the cleanest columns were often in 20-30-deep quarries beside town)
    if (!collarOk(top.top, hy)) { sreasons['collar off the surface level'] = (sreasons['collar off the surface level'] ?? 0) + 1; continue }
    const s = surveyShaft({ read, origin: o, away: cand.away, c: top.top + 1 })
    if (s.bottom == null) { sreasons['no landing'] = (sreasons['no landing'] ?? 0) + 1; continue }
    // THE PAD MUST BE WALKABLE FROM THE TOWN (Claude stage-1 P2): a zero-edit walk from home's feet cell to the pad cell
    if (!homeFeet) continue
    const pad = toWorld(o, cand.away, 0, -1)
    const w = walkReach(read, homeFeet, { x: pad.x, y: top.top + 1, z: pad.z })
    if (!w.ok) { sreasons[`pad not walkable (${w.why})`] = (sreasons[`pad not walkable (${w.why})`] ?? 0) + 1; continue }
    s.walkNodes = w.nodes
    shafts.push({ origin: o, away: cand.away, collar: top.top + 1, ...s })
  }
  shafts.sort((a, b) => a.bottom - b.bottom || (a.falling > 0) - (b.falling > 0) || Math.abs(a.collar - hy) - Math.abs(b.collar - hy) || a.lining - b.lining)
  out[pool] = { home, platform, farm, columnsScanned: colMap.size,
                ziggurat: zigOut, zigRejects: reasons, shaft: shafts[0] ?? null, shaftCandidates: shafts.length, shaftRejects: sreasons,
                shaftBottoms: shafts.reduce((m, s) => { m[s.bottom] = (m[s.bottom] ?? 0) + 1; return m }, {}), ms: Date.now() - t0 }
  console.error(`${pool}: ${Date.now() - t0} ms; zig ${zigOut ? `${zigOut.centre.x},${zigOut.centre.z} base ${zigOut.baseY} fill ${zigOut.foundation + zigOut.apronFill}` : 'NONE'}; shaft ${shafts[0] ? `${shafts[0].origin.x},${shafts[0].origin.z} bottom ${shafts[0].bottom}` : 'NONE'}`)
}
console.log(JSON.stringify({ rules: { maxCentre: MAXC, ...RULES }, worlds: out }, null, 1))
