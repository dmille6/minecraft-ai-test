// townstyle-01: the fake VANILLA placement and the cottage builders shared by townstyle.test.mjs and townstyle-build.test.mjs
// (split so each file stays well inside the runner's 300 s on a loaded suite host). Not a test file.
import assert from 'node:assert'
import fs from 'node:fs'
const T = await import('../../src/townstyle.mjs')
const C = await import('../../src/cottage.mjs')
const F = await import('./buildfake.mjs')
const { B, R, PJ, G, k3 } = F
export { T, C, F }
// ---- A SMALL VANILLA: what the server makes of one click (Minecraft 1.21 BlockItem placement, as measured on Paper 1.21.8) ----------
const FACING = { '1,0': 'east', '-1,0': 'west', '0,1': 'south', '0,-1': 'north' }
const yawFacing = yaw => { const d = ((Math.round(yaw / 90) % 4) + 4) % 4; return ['south', 'west', 'north', 'east'][d] }
const OPP = { north: 'south', south: 'north', east: 'west', west: 'east' }
/** -> the placed block's properties. `face` the clicked face's normal, `cursorY` on the support (0..1), `yaw` the server's yaw. */
export function vanilla (name, face, cursorY, yaw) {
  const side = face[1] === 0
  const top = face[1] < 0 || (side && cursorY > 0.5)
  if (/_stairs$/.test(name)) return { facing: yawFacing(yaw), half: top ? 'top' : 'bottom', shape: 'straight', waterlogged: false }
  if (/_slab$/.test(name)) return { type: top ? 'top' : 'bottom', waterlogged: false }
  if (/_log$/.test(name)) return { axis: face[1] !== 0 ? 'y' : face[0] !== 0 ? 'x' : 'z' }
  if (/_trapdoor$/.test(name)) return side ? { facing: FACING[`${face[0]},${face[2]}`], half: top ? 'top' : 'bottom', open: false, powered: false, waterlogged: false } : { facing: OPP[yawFacing(yaw)], half: face[1] > 0 ? 'bottom' : 'top', open: false, powered: false, waterlogged: false }
  if (/^lantern$/.test(name)) return { hanging: face[1] < 0, waterlogged: false }
  return {}
}

export const STYLE = { wood: 'spruce', roof: 'dark_oak', stone: 'cobblestone' }
export const sited = v => {
  const bp = C.styledBlueprint(B.loadBlueprint(`cottage@1${v}`), STYLE)
  const s = B.siteBlueprint(F.server().read, F.plan(), bp, { tries: 3, plot: 'cottage1' })
  return { bp, s }
}
/** A bot on the fake server whose clicks the SMALL VANILLA judges: the yaw is the aim's, else the bot's look toward the face. */
export function vanillaBot (srv, name, { inv, feet = [2, G + 1, 0], aimless = false } = {}) {
  const e = F.bot(srv, name, { inv, feet })
  const props = srv.props ??= new Map()
  const read0 = srv.read
  srv.read = (x, y, z) => { const b = read0(x, y, z); return b ? { ...b, props: props.get(k3([x, y, z])) ?? null } : b }
  e.read = srv.read
  let held = null
  const hold = e.hold
  e.hold = async n => { const ok = await hold(n); if (ok) held = n; return ok }
  const send = e.send
  e.send = (support, face, seq, aim = null) => {
    const target = support.map((q, i) => q + face[i])
    const before = srv.read(...target)?.name
    const at = e.feet()
    // the look toward the face (what the current actuator sends): its horizontal direction is the yaw
    const dx = support[0] + 0.5 + face[0] * 0.5 - (at[0] + 0.5), dz = support[2] + 0.5 + face[2] * 0.5 - (at[2] + 0.5)
    const lookYaw = Math.abs(dx) >= Math.abs(dz) ? (dx > 0 ? -90 : 90) : (dz > 0 ? 0 : 180)
    const yaw = !aimless && Number.isFinite(aim?.yaw) ? aim.yaw : lookYaw
    const cursorY = !aimless && Array.isArray(aim?.cursor) ? aim.cursor[1] : 0.5 + face[1] * 0.5
    send(support, face, seq)
    if (before === 'air' && held) props.set(k3(target), vanilla(held, face, cursorY, yaw))
  }
  const dig = e.dig
  e.dig = async (c, expect) => { const r = await dig(c, expect); if (r === 'confirmed') props.delete(k3(c)); return r }
  return e
}
export const COTTAGE_KIT = () => ({ cobblestone: 128, spruce_planks: 64, spruce_log: 16, glass_pane: 8, dark_oak_stairs: 48, dark_oak_slab: 12, spruce_trapdoor: 8, torch: 4 })
export async function buildCottage (v, { aimless = false, Mod = R, pre = null, hook = null } = {}) {
  const { bp, s } = sited(v)
  const srv = F.server()
  const pr = F.project(s.record)
  if (pre) pre(srv, s.record)
  const e = vanillaBot(srv, 'A', { inv: COTTAGE_KIT(), aimless })
  if (hook) hook(e)
  let r = null
  const placedBy = {}
  // bounded on a loaded host too (the w30 suite: a control that never completes must end by its clock, not the runner's 300 s)
  for (let i = 0; i < (aimless ? 1 : 6); i++) {
    const h = PJ.recordHead(pr.dir, pr.key)
    r = await Mod.runVisit({ ...pr.p('A'), record: h.head.rec, recordGen: h.head.gen, palette: bp.palette, placedBy, ...C.cottageVisitOpts(h.head.rec), walkR: 30 }, e, { maxSteps: 3000, barrierWaitMs: 50, deadline: Date.now() + 30_000 })
    if (r.stop === 'complete') break
  }
  const done = s.record.cells.filter(c => R.cellDone(srv.read(...c.at), bp.palette, c.role, c.ws)).length
  return { r, done, total: s.record.cells.length, e, srv, rec: s.record, bp }
}
/** The fake vanilla, its FIRST click on one roof cell judged with a wrong yaw (a bad click): -> the build and the bag's balance. */
export async function buildWithOneBadClick (Mod = R) {
  let bad = null
  const res = await buildCottage('s', {
    Mod,
    pre: (sv, rec) => { bad = rec.cells.find(q => q.role === 'roof' && q.seg === 'roof-edge') },
    hook: e => {
      const send = e.send
      let done = false
      e.send = (support, face, seq, aim = null) => {
        const target = support.map((q, i) => q + face[i])
        if (!done && bad && k3(target) === k3(bad.at) && aim) { done = true; return send(support, face, seq, { ...aim, yaw: aim.yaw + 180 }) }
        return send(support, face, seq, aim)
      }
    },
  })
  return { ...res, bad }
}
/** A mutant of a src module (anchor present and unique), imported from the test directory. */
export async function withSrcMutant (file, old, neu, fn) {
  const url = new URL(`../../src/${file}`, import.meta.url)
  const src = fs.readFileSync(url, 'utf8')
  assert.strictEqual(src.split(old).length, 2, `ANCHOR MISSING OR NOT UNIQUE in ${file}: ${JSON.stringify(old.slice(0, 70))}`)
  const out = new URL(`../_mutant-ts-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  fs.writeFileSync(out, src.replace(old, neu).replace(/from '\.\//g, "from '../src/"))
  try { return await fn(await import(out.href)) } finally { try { fs.unlinkSync(out) } catch {} }
}
export const siteWith = (Bm, v = 's') => Bm.siteBlueprint(F.server().read, F.plan(), C.styledBlueprint(B.loadBlueprint(`cottage@1${v}`), STYLE), { tries: 3, plot: 'cottage1' })
