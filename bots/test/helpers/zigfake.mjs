// THE ZIGGURAT'S FAKES for ziggurat*.test.mjs (monument-01): a site, a record and a project on buildfake's fake server, the
// builders with their own bodies, and a mutant loader for ziggurat.mjs. Not a test file (the runner takes *.test.mjs only).
import assert from 'node:assert'
import fs from 'node:fs'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
export const Z = await import('../../src/ziggurat.mjs')
const F = await import('./buildfake.mjs')
const { R, PJ, G, HOME, bot, plan } = F
export const G12 = Object.freeze({ B: 12, S: 3, H: 2, STAIR_W: 3 })
const ZPATH = new URL('../../src/ziggurat.mjs', import.meta.url)
/** A mutant of ziggurat.mjs, its anchor present and unique (CLAUDE.md), imported from the test directory. */
export async function withZigMutant (old, neu, fn) {
  const src = readFileSync(ZPATH, 'utf8')
  assert.ok(src.includes(old), `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 70))}`)
  assert.ok(src.split(old).length === 2, 'the mutation target is not unique')
  const out = new URL(`../_mutant-zig-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, src.replace(old, neu).replace(/from '\.\//g, "from '../src/"))
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}
export const colOf = read => (x, z) => Z.columnOf(read, x, z, { yHi: G + 30, yLo: G - 18 })
export function siteOn (srv, { g = G12, avoid = () => null, box = Z.monumentBox(plan()) } = {}) {
  return Z.siteZiggurat(colOf(srv.read), avoid, { box, home: HOME, g })
}
export function zigProject (record0, names = ['A']) {
  // as buildMonument runs it: the foundation in four segments (the record file keeps `F`)
  const record = Z.zigSplitFoundation(record0)
  const dir = fs.mkdtempSync(`${process.env.TMPDIR ?? '/tmp'}/zig-`)
  const key = PJ.projKey(HOME, Z.MONUMENT_PLOT)
  const pub = PJ.publishRecord(dir, key, () => ({ ...record }))
  const slots = {}
  for (const n of names) slots[n] = PJ.takeSlot(dir, key, n, Z.MONUMENT_BUILDERS)
  const p = n => ({ dir, key, me: n, home: HOME, stood: [], record, recordGen: pub.gen, palette: Z.ZIG_PALETTE, slot: slots[n].slot, slotGen: slots[n].gen,
    domain: Z.zigDomain(record, HOME), walkR: Z.zigWalkR(record, HOME), foreign: Z.ZIG_FOREIGN, blockLayer: false, feetIn: Z.zigFeetIn, alsoDone: Z.zigHidden, clearMax: Z.ZIG_CLEAR_MAX, leaveIf: Z.zigOnSite(record), leaveTo: [2, HOME.y, 0] })
  return { dir, key, p }
}
export const zigDone = (srv, record) => record.cells.every(c => R.cellDone(srv.read(...c.at), Z.ZIG_PALETTE, c.role) || Z.zigHidden(c, srv.read))
export const KITZ = () => ({ cobblestone: 2000, dirt: 64 })
/** buildfake's bot with its OWN body (`self`: a builder never places into the cell it stands in). */
export const zbot = (srv, n, o) => { const e = bot(srv, n, o); e.self = () => { const f = e.feet(); return { x: f[0] + 0.5, y: f[1], z: f[2] + 0.5, w: 0.6, h: 1.8 } }; return e }
