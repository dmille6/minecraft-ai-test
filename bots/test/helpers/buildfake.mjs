// THE FAKE SERVER AND BOTS for buildrun.test.mjs and buildrun-r2.test.mjs (shop-01): `send` puts the held block (or the server's
// own variant, `as`) into the clicked face's cell and acknowledges the sequence through the REAL connection tracker
// (buildack.mjs installAckTracker over a fake client) after a delay, or refuses, or stays silent; digs clear the NAMED block.
// Not a test file (the runner takes *.test.mjs only).
import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { createRequire } from 'node:module'
import { EventEmitter } from 'node:events'

export const B = await import('../../src/buildsite.mjs')
export const R = await import('../../src/buildrun.mjs')
export const PJ = await import('../../src/buildproj.mjs')
const { installAckTracker } = await import('../../src/buildack.mjs')
const RUN_PATH = new URL('../../src/buildrun.mjs', import.meta.url)
const mcData = createRequire(import.meta.url)('minecraft-data')('1.21.8')

/** A mutant of buildrun.mjs, its anchor present and unique (CLAUDE.md), imported from the test directory. */
export async function withMutant (old, neu, fn) {
  const src = readFileSync(RUN_PATH, 'utf8')
  assert.ok(src.includes(old), `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 70))}`)
  assert.ok(src.split(old).length === 2, 'the mutation target is not unique')
  const out = new URL(`../_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, src.replace(old, neu).replace(/from '\.\//g, "from '../src/"))
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}
/** BOTH WAYS: the scenario passes on the real module, and throws on the mutant. */
export const both = async (old, neu, scenario) => {
  await scenario(R)
  let killed = false
  await withMutant(old, neu, async M => { try { await scenario(M) } catch { killed = true } })
  assert.ok(killed, 'the mutant survived')
}

export const G = 69
export const HOME = { x: 0, y: G + 1, z: 0 }
const box = n => mcData.blocksByName[n]?.boundingBox ?? 'block'
export const k3 = a => a.join(',')
/** THE FAKE SERVER: flat ground (stone below G, grass at G), a shared mutable cell map, placement counts per cell. */
export function server (cells0 = {}) {
  const cells = new Map(Object.entries(cells0))
  const placedAt = new Map()
  const read = (x, y, z) => {
    if (Math.abs(x) > 60 || Math.abs(z) > 60 || y < G - 20 || y > G + 40) return null
    const n = cells.get(`${x},${y},${z}`) ?? (y < G ? 'stone' : y === G ? 'grass_block' : 'air')
    return { name: n, boundingBox: box(n) }
  }
  return { read, cells, placedAt, seen: new Map(), set: (a, n) => cells.set(k3(a), n) }
}
export const KIT = () => ({ stone_bricks: 89, oak_planks: 49, glass_pane: 4, cut_copper: 20, torch: 2, furnace: 2, crafting_table: 1, cobblestone: 64, oak_sapling: 4 })
/** One bot's effects on the fake server. `ack(target)` -> 'ok' | 'refuse' | 'silent' | a delay in ms; `as(held)` the block the
 *  server actually places; `settle(id)` the connection's settler (skills.mjs closes the intent in the project's file). */
export function bot (srv, name, { inv = KIT(), feet = [2, G + 1, 0], ack = () => 'ok', capWait = null, others = () => [], aborted = () => false, as = n => n, settle = null, conn = `${name}-c1`, probe = async () => null, dig = null } = {}) {
  const client = new EventEmitter(); client.write = () => {}
  const fb = new EventEmitter(); fb._client = client; fb.players = {}
  const acks = installAckTracker(fb)
  if (settle) acks.onSettle(settle)
  const tr = acks.tracker
  let at = feet.slice(), held = null
  const logs = []
  const has = n => (inv[n] ?? 0) > 0
  has.planks = () => Object.keys(inv).find(k => /_planks$/.test(k) && inv[k] > 0) ?? null
  const e = {
    read: srv.read, logs, inv,
    feet: () => at.slice(),
    bodies: () => others().map(f => ({ x: f[0] + 0.5, y: f[1], z: f[2] + 0.5, w: 0.6, h: 1.8 })),
    walkTo: async s => { at = s.slice(); return true },
    hold: async n => { if (!has(n)) return false; held = n; return true },
    has,
    look: async () => {},
    nextSeq: () => tr.next(),
    send: (support, face, seq) => {
      const target = support.map((v, i) => v + face[i])
      const how = ack(target, held)
      const apply = () => {
        const b = srv.read(...target)
        if (how !== 'refuse' && b && (b.name === 'air' || b.name === 'short_grass') && has(held)) {
          srv.set(target, as(held)); inv[held]--; srv.placedAt.set(k3(target), (srv.placedAt.get(k3(target)) ?? 0) + 1)
        }
        client.emit('packet', { sequenceId: seq }, { name: 'acknowledge_player_digging' })
      }
      if (how === 'silent') return
      if (typeof how === 'number') setTimeout(apply, how); else setImmediate(apply)
    },
    waitAck: (seq, ms) => tr.wait(seq, capWait ?? ms),
    track: (id, seq) => acks.track(id, seq),
    untrack: id => acks.untrack(id),
    conn: () => conn,
    acked: () => tr.acked,
    seen: h => srv.seen.get(h) ?? { online: true, offlineSince: null, leftAt: null },
    dig: dig ?? (async (c, expect) => { if (expect && srv.read(...c)?.name !== expect) return 'refused'; srv.set(c, 'air'); return 'confirmed' }),
    probe,
    aborted,
    log: (k, d) => logs.push([k, d]),
    now: () => Date.now(),
    sleep: ms => new Promise(r => setTimeout(r, Math.min(ms, 5))),
    spawnedAt: () => 0,
    tracker: tr,
  }
  return e
}
const SECTORS = { gate: 'S', shaft: 'SW', monument: 'NW', well: 'W', farm: 'N' }
export const plan = () => ({
  v: 1, template: 'ring@1', gen: 3, prev: 2, home: HOME, s: G, mode: 'retrofit', at: 1, world: 'w',
  plots: [{ id: 'core', kind: 'plaza', box: [-6, -6, 6, 6], y: G, state: 'existing', keepout: false },
    ...Object.entries(SECTORS).map(([id, sector]) => ({ id, kind: id, sector, state: 'planned' })),
    { id: 'pavilion', kind: 'pavilion', sector: 'E', state: 'planned' }, { id: 'hall', kind: 'hall', sector: null, state: 'unsited' }],
  paths: [], groups: {}, transitions: [],
})
export const BP = B.loadBlueprint('workshop@1')
export const SITE = B.siteBlueprint(server().read, plan(), BP, { tries: 2 })
assert.ok(SITE.ok, 'the flat site')
/** A fresh project directory with the record published and a slot per builder. */
export function project (record = SITE.record, names = ['A']) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'buildrun-'))
  const key = PJ.projKey(HOME, 'shop')
  const pub = PJ.publishRecord(dir, key, () => ({ ...record }))
  const slots = {}
  for (const n of names) slots[n] = PJ.takeSlot(dir, key, n, 2)
  const p = n => ({ dir, key, me: n, home: HOME, stood: [], record, recordGen: pub.gen, palette: BP.palette, slot: slots[n].slot, slotGen: slots[n].gen })
  return { dir, key, p, slots }
}
export const allDone = (srv, record = SITE.record) => record.cells.every(c => R.cellDone(srv.read(...c.at), BP.palette, c.role))
