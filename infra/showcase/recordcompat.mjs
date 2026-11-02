#!/usr/bin/env node
// RECORD COMPAT for a showcase restack (showcase-on-fleet): what a release's code DECIDES over a COPY of the showcase's
// project records, as JSON, so two releases can be diffed. Read-only by construction: it runs on a copy (POOL_STATE_DIR,
// STATE_DIR and LOG_DIR all point into the copy's scratch), and it hashes the copy before and after -- a release that
// writes a file during these reads is reported (`wrote`), which is itself a difference worth a look.
//
//   node recordcompat.mjs --src <release dir holding src/ and node_modules/> --pool-copy <dir> --env <bot env file> [--bot NAME]
//
// It prints { heads, active, damaged, zig, wrote } for three worlds the reads may see:
//   none   blockAt() answers null everywhere (the world unread: every damage test says nothing)
//   air    every block is air (a positive control: every complete record reads DAMAGED)
//   solid  every block is stone (a full cube)
// heads: every project's recordHead (gen, sha, state, complete, cells, rejected) through the release's own buildproj.mjs;
// active: shopActive()'s pick per world; damaged: shopDamaged() per project record per world; zig: zigProgress with
// every cell done. Same answers from both releases = the restack keeps the showcase's records and its build order.
// Used by restack_prep.py (the hourly showcase restack after a fleet promotion) and by hand (docs/PROCESS-fun-mode.md).
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { pathToFileURL } from 'node:url'

const arg = k => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null }
const src = path.resolve(arg('--src') ?? '.')
const copy = path.resolve(arg('--pool-copy') ?? '')
const envFile = arg('--env')
if (!copy || !fs.existsSync(copy)) { console.error('--pool-copy <dir> is required (a COPY of _pool-<pool>, never the live one)'); process.exit(2) }
if (/\/var\/lib\/mcai\//.test(copy + '/')) { console.error('refusing: --pool-copy points at a live state dir'); process.exit(2) }

// the bot's own env (the release's env/<bot>.env), then the copy's dirs: nothing reads or writes outside the copy
if (envFile) {
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
    if (m) process.env[m[1]] = m[2]
  }
}
if (arg('--bot')) process.env.BOT_NAME = arg('--bot')
const scratch = fs.mkdtempSync(path.join(path.dirname(copy), '.compat-'))
process.env.POOL_STATE_DIR = copy
process.env.STATE_DIR = path.join(scratch, 'state')
process.env.LOG_DIR = path.join(scratch, 'logs')
process.env.LLM_ENABLED = 'false'
fs.mkdirSync(process.env.STATE_DIR, { recursive: true }); fs.mkdirSync(process.env.LOG_DIR, { recursive: true })

function treeHash (dir) {
  const h = crypto.createHash('sha256')
  const walk = d => {
    for (const n of fs.readdirSync(d).sort()) {
      const p = path.join(d, n), st = fs.statSync(p)
      if (st.isDirectory()) walk(p)
      else { h.update(path.relative(copy, p)); h.update(fs.readFileSync(p)) }
    }
  }
  walk(dir)
  return h.digest('hex')
}

const before = treeHash(copy)
const mod = f => import(pathToFileURL(path.join(src, 'src', f)).href)
const shop = await mod('shop.mjs')
const proj = await mod('buildproj.mjs')
const skills = await mod('skills.mjs')
const zig = await mod('ziggurat.mjs').catch(() => null)
const vec3 = await import(pathToFileURL(path.join(src, 'node_modules', 'vec3', 'index.js')).href)
const Vec3 = vec3.Vec3 ?? vec3.default?.Vec3 ?? vec3.default

const home = [Number(process.env.HOME_X) || 0, Number(process.env.HOME_Y) || 70, Number(process.env.HOME_Z) || 0]
const WORLDS = {
  none: () => null,
  air: () => ({ name: 'air', boundingBox: 'empty' }),
  solid: () => ({ name: 'stone', boundingBox: 'block' }),
}
const fakeBot = world => ({
  username: process.env.BOT_NAME ?? 'showcase-Alpha',
  entity: { position: new Vec3(home[0] + 0.5, home[1], home[2] + 0.5), velocity: new Vec3(0, 0, 0), onGround: true },
  blockAt: p => { const b = WORLDS[world](p); return b ? { ...b, position: p } : null },
  inventory: { items: () => [], slots: [] },
  heldItem: null,
  game: { dimension: 'overworld' },
  on () {}, once () {}, removeListener () {}, off () {},
})

// the release's own key function is private (projKey(planHomeP(), plot)); the record files name the keys: list them
const files = fs.readdirSync(copy)
const keys = [...new Set(files.map(f => f.match(/^(project-[^.]+\.[A-Za-z0-9]+)\.g\d+\.json$/)?.[1]).filter(Boolean))].sort()

const heads = {}
for (const k of keys) {
  const h = proj.recordHead(copy, k)
  const r = h.head?.rec
  heads[k] = h.ok
    ? { gen: h.head?.gen ?? null, sha: h.head?.sha ?? null, state: r?.state ?? null, complete: !!r?.structure_complete, blueprint: r?.blueprint ?? null,
        cells: Array.isArray(r?.cells) ? r.cells.length : null, rejected: h.rejected.map(x => `${x.gen}:${x.why}`) }
    : { ok: false }
}

const active = {}, damaged = {}
for (const w of Object.keys(WORLDS)) {
  const bot = fakeBot(w)
  // shopActive caches 60 s per signature: a far clock per world keeps each read fresh
  const t = Date.now() + Object.keys(WORLDS).indexOf(w) * 3_600_000
  try { const p = skills.shopActive(bot, t); active[w] = p ? { plot: p.plot, blueprint: p.blueprint } : null } catch (e) { active[w] = `throw: ${String(e?.message ?? e).slice(0, 80)}` }
  damaged[w] = {}
  for (const k of keys) {
    const rec = proj.recordHead(copy, k).head?.rec
    if (!rec) continue
    try { damaged[w][k] = skills.shopDamaged(fakeBot(w), rec) } catch (e) { damaged[w][k] = `throw: ${String(e?.message ?? e).slice(0, 80)}` }
  }
}

const zigOut = {}
for (const k of keys.filter(k => /\.monument$/.test(k))) {
  const rec = proj.recordHead(copy, k).head?.rec
  try { const p = zig?.zigProgress?.(rec, () => true); zigOut[k] = p ? { open: p.open, total: p.total ?? null, done: p.done ?? null } : null } catch (e) { zigOut[k] = `throw: ${String(e?.message ?? e).slice(0, 80)}` }
}

const after = treeHash(copy)
fs.rmSync(scratch, { recursive: true, force: true })
console.log(JSON.stringify({ projects_on: shop.projectsOn().map(p => p.plot), heads, active, damaged, zig: zigOut, wrote: before !== after }, null, 1))
// a release whose modules keep timers alive must not hold the harness open
process.exit(0)
