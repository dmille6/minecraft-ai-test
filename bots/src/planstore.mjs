// THE TOWN PLAN'S FILES (townplan-01; design docs/reports/town-plan-2026-10-20.md section 4.1, build spec
// docs/reports/townplan-found-spec-2026-10-21.md section 1.2). Pure over a directory: no bot, no world.
//
// ONE SITING FILE PER TOWN, AS GENERATIONS: `townplan-<hx>_<hy>_<hz>.g<N>.json`, each a FULL snapshot, created ONLY with
// link(tmp, gN) -- which fails when N exists, so exactly one writer gets each number -- and never rewritten or pruned.
// Generation N+1 names its predecessor (`prev`) and the sha256 of its bytes (`prevSha`).
//
// THE HEAD (the current plan) IS A WALK OVER THE FILES' CONTENTS, ascending, never the reader's clock (design 4.1):
//   - a file of another world is ABSENT (skipped, not rejected): a reseeded world gets a fresh root;
//   - the ROOT is the lowest file of this world with prev: null that parses and passes the schema;
//   - each later file becomes the head only if it parses, its prev IS the head at that point, its prevSha is the head's
//     sha, and transitionRefusal(head, it) is null; anything else is REJECTED: skipped, never deleted.
// So two writers that both read head V cannot both win: the first link (V+1) is accepted, the second (prev V, at V+2) is
// rejected because the head is V+1 by then, and its writer rebases. A reservation leaves the plan only through an explicit
// transition the file itself carries (`released` by its holder, or `expired` judged on the file's OWN `at`), so the same
// files always give the same head, before or after any expiry.
//
// NO ON-DISK CHECKPOINT (Codex spec r2 P2: a hash proves a file's bytes, not its membership in the accepted chain). Each
// process continues from its OWN last full walk while the listing only grew above its last number; anything else re-walks.
//
// TOWNPLAN=off lives in townplan.mjs; this module only reads and writes what it is asked to.

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

export const PLAN_V = 1
/** A reservation may be written `expired` (or observed `placed` by another bot) only by a generation whose own `at` is this
 *  far past its `until` (design 4.1: the hosts run NTP; a wrong expiry costs only a retry). */
export const EXPIRE_MARGIN_MS = 60_000
/** An OBSERVATION (a block adopted as placed, or a placed one written gone) needs two reads this far apart (build spec 1.2: craft
 *  puts its own table down for seconds and takes it back; one read made a station `placed` for ever with nothing there). */
export const OBSERVE_MS = 10 * 60_000
/** A writer's compare-and-swap tries per visit (design 4.1 / section 8 P4). */
export const PUBLISH_TRIES = 3
/** A walk reads at most this many bytes of plan files (a plan is a few KB; a flood of files fails closed: no head). */
export const PLAN_MAX_READ_BYTES = 32 * 1024 * 1024

export const CELL_STATES = Object.freeze(['free', 'reserved', 'placed'])
export const MODES = Object.freeze(['greenfield', 'retrofit'])

export const planKey = home => `townplan-${home.x}_${home.y}_${home.z}`
export const genFile = (dir, key, n) => path.join(dir, `${key}.g${n}.json`)
export const shaOf = buf => crypto.createHash('sha256').update(buf).digest('hex')
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** The generations on disk, ascending -> [N]. A missing directory is "none"; any other failure throws (never "empty"). */
export function planGens (dir, key) {
  const re = new RegExp(`^${esc(key)}\\.g(\\d+)\\.json$`)
  let names
  try { names = fs.readdirSync(dir) } catch (e) { if (e?.code === 'ENOENT') return []; throw e }
  return names.map(f => re.exec(f)).filter(Boolean).map(m => Number(m[1])).filter(Number.isSafeInteger).sort((a, b) => a - b)
}

const int = v => Number.isSafeInteger(v)
const xyz = a => Array.isArray(a) && a.length === 3 && a.every(int)
const ck = a => `${a[0]},${a[1]},${a[2]}`

/** Every cell of a plan (store cells and workshop stations), keyed "x,y,z" -> { plot, cell }. Pure. */
export function planCells (plan) {
  const out = new Map()
  for (const p of (Array.isArray(plan?.plots) ? plan.plots : [])) {
    for (const c of [...(Array.isArray(p?.cells) ? p.cells : []), ...(Array.isArray(p?.stations) ? p.stations : [])]) {
      if (c && xyz(c.at)) out.set(ck(c.at), { plot: p.id, cell: c })
    }
  }
  return out
}

/**
 * THE SCHEMA -> null, or why this object is not a v1 plan. Pure. Structure only (the geometry's sense is townplan.mjs's).
 */
export function planRefusal (plan) {
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) return 'not an object'
  if (plan.v !== PLAN_V) return `v ${plan.v}`
  if (plan.template !== 'ring@1') return `template ${plan.template}`
  if (!int(plan.gen) || plan.gen < 1) return 'gen'
  if (plan.prev !== null && !(int(plan.prev) && plan.prev >= 1 && plan.prev < plan.gen)) return 'prev'
  if ((plan.prev === null) !== (plan.prevSha === null)) return 'prevSha'
  if (plan.prevSha !== null && !/^[0-9a-f]{64}$/.test(String(plan.prevSha))) return 'prevSha'
  if (!plan.home || ![plan.home.x, plan.home.y, plan.home.z].every(int)) return 'home'
  if (!MODES.includes(plan.mode)) return `mode ${plan.mode}`
  if (!Number.isFinite(plan.at)) return 'at'
  if (!Array.isArray(plan.plots)) return 'plots'
  const ids = new Set()
  const seen = new Set()
  for (const p of plan.plots) {
    if (!p || typeof p.id !== 'string' || ids.has(p.id)) return 'plot id'
    ids.add(p.id)
    for (const c of [...(p.cells ?? []), ...(p.stations ?? [])]) {
      if (!c || !xyz(c.at) || typeof c.kind !== 'string') return `cell in ${p.id}`
      if (!CELL_STATES.includes(c.state)) return `cell state ${c.state}`
      if (seen.has(ck(c.at))) return `cell ${ck(c.at)} twice`
      seen.add(ck(c.at))
      if (c.state === 'reserved' && (typeof c.by !== 'string' || typeof c.visit !== 'string' || !Number.isFinite(c.until))) return `reservation ${ck(c.at)}`
    }
  }
  if (!plan.groups || typeof plan.groups !== 'object') return 'groups'
  if (!Array.isArray(plan.transitions ?? [])) return 'transitions'
  return null
}

const GEOMETRY_KEYS = ['kind', 'box', 'y', 'door', 'sector', 'keepout']
const plotGeometry = p => JSON.stringify(GEOMETRY_KEYS.map(k => p?.[k] ?? null))
const cellsOf = p => [...(p?.cells ?? []), ...(p?.stations ?? [])]
// a cell with a PENDING observation (seenSince) is pinned like a committed one: no re-fit may move or drop it (Codex spec r3 P1)
const isCommitted = c => c?.state === 'reserved' || c?.state === 'placed' || Number.isFinite(c?.seenSince)
const committed = p => cellsOf(p).some(isCommitted)
/** Stores whose FREE cells may be re-fitted around what is committed (build spec 1.2). */
export const FLEX_KINDS = Object.freeze(['annex', 'cluster', 'unplaced'])

/**
 * THE OBSERVATION MARKS' OWN RULES (Claude spec r3 P2) -> null, or why `n` may not follow `c`. A mark (seenSince on a free or
 * reserved cell, missingSince on a placed one) is SET only to the writing generation's own `at` (never backdated), never
 * changed while set, cleared freely (by a definite contrary read: the writer's word); on a reservation that has not expired
 * only its holder may touch either mark.
 */
function markRefusal (c, n, next, k) {
  for (const mark of ['seenSince', 'missingSince']) {
    const a = c[mark] ?? null, b = n[mark] ?? null
    if (a === b) continue
    if (b !== null && !Number.isFinite(b)) return `${mark} on ${k} not a time`
    if (a !== null && b !== null) return `${mark} on ${k} changed while set`
    if (b !== null && b !== Number(next.at)) return `${mark} on ${k} backdated (${b} vs the generation's ${next.at})`
    if (c.state === 'reserved' && !(Number(next.at) > Number(c.until) + EXPIRE_MARGIN_MS) && next.by !== c.by) return `${mark} on live reservation ${k} by a non-holder`
  }
  const target = n.state ?? c.state
  if (n.seenSince != null && target === 'placed' && c.state === 'placed') return `seenSince on placed ${k}`
  if (n.missingSince != null && target !== 'placed') return `missingSince on ${target} ${k}`
  return null
}

/**
 * MAY `next` FOLLOW `prev`? -> null, or why not. Pure (design 4.1; build spec 1.2). The rules:
 *   - v, template, world, home, mode unchanged;
 *   - a plot of `prev` is never dropped; its GEOMETRY (box, cells, stations, door, sector...) and the plan's s/orientation
 *     change only while `prev` has no cell of it reserved or placed (an unplaced store may be re-fitted, a committed one not);
 *   - a placed cell stays placed, same kind; a role/group, once set on it, never changes;
 *   - a reserved cell leaves only as: the same reservation (same by and visit, `until` not earlier); `placed` by its holder
 *     (next.by === its by, same visit) or by anyone once next.at > until + EXPIRE_MARGIN_MS; or `free` with a transition
 *     { at, why: 'released', by, visit } written by its holder, or { at, why: 'expired' } with next.at > until + margin;
 *   - a cell becomes reserved only from free, by the writer of `next`;
 *   - every transition names a cell reserved in `prev`;
 *   - retrofit groups: status never goes back from 'allocated'; a container in a home list stays in it.
 */
export function transitionRefusal (prev, next) {
  if (!prev || !next) return 'missing'
  for (const k of ['v', 'template', 'world', 'mode']) if (JSON.stringify(prev[k] ?? null) !== JSON.stringify(next[k] ?? null)) return `${k} changed`
  if (JSON.stringify(prev.home) !== JSON.stringify(next.home)) return 'home changed'
  const nextPlots = new Map((next.plots ?? []).map(p => [p.id, p]))
  const anyCommitted = (prev.plots ?? []).some(committed)
  if (anyCommitted && (prev.s !== next.s || prev.orientation !== next.orientation)) return 's/orientation changed with cells committed'
  for (const p of prev.plots ?? []) {
    const q = nextPlots.get(p.id)
    if (!q) return `plot ${p.id} dropped`
    if (!committed(p)) continue
    // A COMMITTED PLOT keeps its geometry and every existing cell (position, kind, stand); it may only APPEND cells. A flex
    // store (annex, cluster, unplaced) may also drop or move its FREE cells: a re-fit around what is committed.
    if (plotGeometry(p) !== plotGeometry(q)) return `plot ${p.id} geometry changed with cells committed`
    const qc = new Map(cellsOf(q).filter(c => xyz(c?.at)).map(c => [ck(c.at), c]))
    const flex = FLEX_KINDS.includes(p.kind)
    for (const c of cellsOf(p)) {
      const n = qc.get(ck(c.at))
      if (!n) { if (isCommitted(c) || !flex) return `cell ${ck(c.at)} of committed plot ${p.id} dropped`; continue }
      if (n.kind !== c.kind || JSON.stringify(n.stand ?? null) !== JSON.stringify(c.stand ?? null)) return `cell ${ck(c.at)} of committed plot ${p.id} changed`
    }
  }
  // NO CELL ON ANOTHER COMMITTED CELL'S STAND (an appended or re-fitted cell must not wall off what is reserved or placed)
  const stands = new Map()
  for (const p of next.plots ?? []) for (const c of cellsOf(p)) if (isCommitted(c) && xyz(c.stand)) stands.set(ck(c.stand), ck(c.at))
  for (const p of next.plots ?? []) for (const c of cellsOf(p)) if (xyz(c?.at) && stands.has(ck(c.at))) return `cell ${ck(c.at)} stands on the stand of ${stands.get(ck(c.at))}`
  const before = planCells(prev), after = planCells(next)
  const trans = new Map()
  for (const t of next.transitions ?? []) {
    if (!t || !xyz(t.at) || !['released', 'expired', 'gone'].includes(t.why)) return 'bad transition'
    const k = ck(t.at)
    const was = before.get(k)?.cell?.state
    if (t.why === 'gone' ? was !== 'placed' : was !== 'reserved') return `transition ${t.why} on ${k}, ${was ?? 'absent'}`
    if (trans.has(k)) return `two transitions on ${k}`
    trans.set(k, t)
  }
  const late = c => Number(next.at) > Number(c.until) + EXPIRE_MARGIN_MS
  // an observation: the PREVIOUS generation already carried the first read, and this one is OBSERVE_MS later
  const observed = (c, mark) => Number.isFinite(c?.[mark]) && Number(next.at) >= Number(c[mark]) + OBSERVE_MS
  const sameIntent = (c, n) => (c.role ?? null) === (n.role ?? null) && (c.group ?? null) === (n.group ?? null)
  // a role/group may be SET on a cell that has none (an unassigned container given a home), never changed once set
  const intentKept = (c, n) => (c.role ?? null) === null ? true : sameIntent(c, n)
  for (const [k, { cell: c }] of before) {
    const n = after.get(k)?.cell
    if (!n) {
      // a reserved or placed cell never leaves; a free one only as the plot rules above allow
      if (c.state !== 'free') return `cell ${k} (${c.state}) dropped`
      continue
    }
    if (n.kind !== c.kind) return `cell ${k} kind changed`
    const markWhy = markRefusal(c, n, next, k)
    if (markWhy) return markWhy
    const t = trans.get(k)
    if (c.state === 'placed') {
      if (!intentKept(c, n)) return `placed cell ${k} role changed`
      if (n.state === 'placed') { if (t) return `transition on placed ${k} that stays placed`; continue }
      // placed -> free only as GONE: two empty reads OBSERVE_MS apart (missingSince in prev), the intent kept for the next placement
      if (n.state !== 'free' || t?.why !== 'gone') return `placed cell ${k} -> ${n.state}`
      if (!observed(c, 'missingSince')) return `gone ${k} without two empty reads ${OBSERVE_MS / 60000} min apart`
      if (!sameIntent(c, n)) return `gone ${k} lost its intent`
      continue
    }
    if (c.state === 'reserved') {
      if (n.state === 'reserved') {
        if (t) return `transition on ${k} that stays reserved`
        if (n.by !== c.by || n.visit !== c.visit) return `live reservation ${k} taken`
        if (!(Number(n.until) >= Number(c.until))) return `reservation ${k} shortened`
        if (Number(n.until) > Number(c.until) && next.by !== c.by) return `reservation ${k} renewed by a non-holder`
        if (!sameIntent(c, n)) return `reservation ${k} intent changed`
        continue
      }
      if (n.state === 'placed') {
        if (t) return `transition on ${k} that is placed`
        // the HOLDER publishes its own placement at once; anyone else only after the expiry AND an observation
        const holder = next.by === c.by && n.visit === c.visit && n.by === c.by
        if (!holder && !(late(c) && observed(c, 'seenSince'))) return `reserved ${k} placed by another before expiry and observation`
        if (!sameIntent(c, n)) return `placement of ${k} lost the reservation's intent`
        continue
      }
      if (!t || t.why === 'gone') return `reservation ${k} dropped without a transition`
      if (t.why === 'released' && !(t.by === c.by && t.visit === c.visit && next.by === c.by)) return `release of ${k} by a non-holder`
      if (t.why === 'expired' && !late(c)) return `expiry of ${k} before until + margin`
      continue
    }
    // free
    if (t) return `transition on free ${k}`
    if (n.state === 'reserved' && (n.by !== next.by || !(Number(n.until) > Number(next.at)))) return `reservation ${k} not by the writer`
    // free -> placed is an OBSERVATION: two reads of its kind OBSERVE_MS apart (seenSince in prev)
    if (n.state === 'placed' && !observed(c, 'seenSince')) return `free ${k} placed without two reads ${OBSERVE_MS / 60000} min apart`
  }
  // new cells (an uncommitted re-fit, a new plot) may not arrive already reserved by someone else
  for (const [k, { cell: n }] of after) {
    if (before.has(k)) continue
    if (n.state === 'reserved' && n.by !== next.by) return `new cell ${k} reserved by another`
    if (n.state === 'placed') return `new cell ${k} arrives placed`
    if (n.seenSince != null || n.missingSince != null) return `new cell ${k} arrives marked`
  }
  const pg = prev.groups ?? {}, ng = next.groups ?? {}
  if ((pg.v ?? null) !== (ng.v ?? null)) return 'groups.v changed'
  if (pg.status === 'allocated' && ng.status !== 'allocated') return 'groups de-allocated'
  for (const [g, ks] of Object.entries(pg.homes ?? {})) {
    const have = new Set((ng.homes ?? {})[g] ?? [])
    for (const k of ks ?? []) if (!have.has(k)) return `home ${g} lost ${k}`
  }
  return null
}

/**
 * THE WALK -> { head: { gen, sha, plan } | null, accepted: [N], rejected: [{ gen, why }], absent: [N] }. Pure over
 * `files` = [{ gen, buf }] (any order). `start` = a previous walk of this process ({ head, accepted }) to continue, or null.
 */
export function walkPlans (files = [], { world = null, start = null } = {}) {
  const sorted = [...files].filter(f => f && int(f.gen)).sort((a, b) => a.gen - b.gen)
  let head = start?.head ?? null
  const accepted = [...(start?.accepted ?? [])], rejected = [...(start?.rejected ?? [])], absent = [...(start?.absent ?? [])]
  const last = start?.last ?? 0
  for (const f of sorted) {
    if (f.gen <= last) continue
    let plan = null
    try { plan = JSON.parse(Buffer.isBuffer(f.buf) ? f.buf.toString('utf8') : String(f.buf)) } catch { rejected.push({ gen: f.gen, why: 'unparseable' }); continue }
    if (!plan || typeof plan !== 'object') { rejected.push({ gen: f.gen, why: 'not an object' }); continue }
    if (JSON.stringify(plan.world ?? null) !== JSON.stringify(world ?? null)) { absent.push(f.gen); continue }
    const bad = planRefusal(plan)
    if (bad) { rejected.push({ gen: f.gen, why: `schema: ${bad}` }); continue }
    if (plan.gen !== f.gen) { rejected.push({ gen: f.gen, why: `gen ${plan.gen} in file ${f.gen}` }); continue }
    const sha = shaOf(Buffer.isBuffer(f.buf) ? f.buf : Buffer.from(String(f.buf)))
    if (!head) {
      if (plan.prev !== null) { rejected.push({ gen: f.gen, why: 'no root before it' }); continue }
      head = { gen: f.gen, sha, plan }; accepted.push(f.gen); continue
    }
    if (plan.prev !== head.gen) { rejected.push({ gen: f.gen, why: `prev ${plan.prev} is not the head ${head.gen}` }); continue }
    if (plan.prevSha !== head.sha) { rejected.push({ gen: f.gen, why: 'prevSha mismatch' }); continue }
    const why = transitionRefusal(head.plan, plan)
    if (why) { rejected.push({ gen: f.gen, why }); continue }
    head = { gen: f.gen, sha, plan }; accepted.push(f.gen)
  }
  return { head, accepted, rejected, absent, last: sorted.at(-1)?.gen ?? last }
}

function readBuf (f) {
  try { return fs.readFileSync(f) } catch (e) { if (e?.code === 'ENOENT') return null; throw e }
}

// THE PROCESS'S OWN WALKS (Codex spec r2 P2), per `${dir}|${key}|${world}`: { gens: [N] walked, walk }. Continued only while the
// listing still holds every number walked and every new number is above the last one; anything else walks from the root.
const WALKS = new Map()
/** Forget this process's walks (tests, and a reader that wants a fresh full walk). */
export const resetPlanWalks = () => WALKS.clear()

/**
 * THE TOWN'S PLAN NOW -> { ok, head, accepted, rejected, absent, gens, from }. `ok` false (and head null) when the directory or
 * a file could not be read: an unreadable plan is never "no plan" to a writer (it would write a second root).
 */
export function planHead (dir, key, world = null, { fresh = false } = {}) {
  const ck = `${dir}|${key}|${JSON.stringify(world ?? null)}`
  try {
    const gens = planGens(dir, key)
    let prior = fresh ? null : WALKS.get(ck) ?? null
    if (prior) {
      const have = new Set(gens)
      const lastWalked = prior.gens.at(-1) ?? 0
      const ok = prior.gens.every(g => have.has(g)) && gens.every(g => g > lastWalked || prior.set.has(g))
      if (!ok) prior = null
    }
    const files = []
    let bytes = prior?.bytes ?? 0
    for (const g of gens) {
      if (prior && g <= (prior.gens.at(-1) ?? 0)) continue
      const buf = readBuf(genFile(dir, key, g))
      if (!buf) continue
      bytes += buf.length
      if (bytes > PLAN_MAX_READ_BYTES) { WALKS.delete(ck); return { ok: false, head: null, accepted: [], rejected: [], absent: [], gens, from: 'too_big' } }
      files.push({ gen: g, buf })
    }
    const w = walkPlans(files, { world, start: prior?.walk ?? null })
    WALKS.set(ck, { gens: [...gens], set: new Set(gens), walk: w, bytes })
    return { ok: true, head: w.head, accepted: w.accepted, rejected: w.rejected, absent: w.absent, gens, from: prior ? `continued:${prior.gens.at(-1)}` : 'root' }
  } catch {
    WALKS.delete(ck)
    return { ok: false, head: null, accepted: [], rejected: [], absent: [], gens: [], from: 'error' }
  }
}

/** Write `buf` to a new file and fsync it (a power loss must never leave an accepted generation truncated: Claude spec r1 P2). */
function writeSynced (f, buf) {
  const fd = fs.openSync(f, 'wx')
  try { fs.writeSync(fd, buf); fs.fsyncSync(fd) } finally { fs.closeSync(fd) }
}
/** fsync a directory (the link itself), best effort: some filesystems refuse a directory fsync. */
function syncDir (dir) {
  try { const fd = fs.openSync(dir, 'r'); try { fs.fsyncSync(fd) } finally { fs.closeSync(fd) } } catch { /* best effort */ }
}

/** Link one generation file -> 'ok' | 'exists' | 'error'. The bytes are written privately and published whole. */
export function linkGen (dir, key, n, buf) {
  const f = genFile(dir, key, n)
  const tmp = `${f}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`
  try {
    fs.mkdirSync(dir, { recursive: true })
    writeSynced(tmp, buf)
    try { fs.linkSync(tmp, f) } catch (e) { return e?.code === 'EEXIST' ? 'exists' : 'error' }
    syncDir(dir)
    return 'ok'
  } catch { return 'error' } finally { try { fs.unlinkSync(tmp) } catch { /* gone */ } }
}

const clone = o => JSON.parse(JSON.stringify(o))

/**
 * THE WRITER'S CYCLE (design 4.1) -> { result, head, gen, tries, why }. `mutate(planOrNull)` returns the next plan's body (a
 * fresh object, or the clone it was given, changed) or null for "nothing to write". It is re-applied to the new head on every
 * retry (a rebase). result: 'accepted' | 'nothing' | 'lost' (gave up after `tries` lost races or rejections) | 'invalid' (our
 * own next generation would be rejected: never written) | 'error' (the directory could not be read or written).
 */
export function publishPlan (dir, key, world, mutate, { by = null, code = null, now = () => Date.now(), tries = PUBLISH_TRIES, onLinked = null } = {}) {
  let last = null
  for (let i = 1; i <= tries; i++) {
    const h = planHead(dir, key, world)
    if (!h.ok) return { result: 'error', head: null, gen: null, tries: i, why: `the plan could not be read (${h.from})` }
    const base = h.head
    const body = mutate(base ? { ...clone(base.plan), transitions: [] } : null, base)
    if (!body) return { result: 'nothing', head: base, gen: base?.gen ?? null, tries: i, why: null }
    const n = (h.gens.at(-1) ?? 0) + 1
    const next = { ...body, v: PLAN_V, gen: n, prev: base ? base.gen : null, prevSha: base ? base.sha : null,
                   world: world ?? null, at: now(), by, code, transitions: body.transitions ?? [] }
    // NEVER WRITE A GENERATION THE WALK WOULD REJECT (our own bug would otherwise burn a number and read as a lost race)
    const bad = planRefusal(next) ?? (base ? transitionRefusal(base.plan, next) : (next.prev !== null ? 'root with a prev' : null))
    if (bad) return { result: 'invalid', head: base, gen: null, tries: i, why: bad }
    const buf = Buffer.from(JSON.stringify(next))
    const linked = linkGen(dir, key, n, buf)
    if (linked === 'error') return { result: 'error', head: base, gen: null, tries: i, why: 'the generation could not be written' }
    if (linked === 'exists') { last = `generation ${n} was taken`; continue }
    if (typeof onLinked === 'function') onLinked(n)   // tests: another writer acts between the link and the re-walk
    const after = planHead(dir, key, world)
    // ACCEPTED = IN THE ACCEPTED CHAIN, not "still the head" (Codex spec r1 P2): another writer may already have extended
    // our generation; a retry would re-apply this change on top of its own accepted copy
    if (after.ok && after.accepted.includes(n)) return { result: 'accepted', head: after.head, gen: n, tries: i, why: null }
    last = after.ok ? `generation ${n} was not accepted (${after.rejected.find(r => r.gen === n)?.why ?? `head ${after.head?.gen}`})` : 'the plan could not be re-read'
  }
  return { result: 'lost', head: null, gen: null, tries, why: last }
}
