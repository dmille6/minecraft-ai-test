// REQUESTS-01: THE TOWN'S REQUESTS BOARD, stage 3 piece 1 (comms stage 3; design docs/reports/requests-design-2026-11-03.md;
// owner 11-03 "yes design all ... implement and deploy where you feel is right"; owner 10-21/10-22: stage 3 without trades or rescue
// parties, peers inform and never command, the bench brain never writes a message, judge on behaviour).
//
// WHAT IT DOES. It turns the needs the bots ALREADY have, and the ways they ALREADY fill them, into typed request records the
// whole town can read, and that the showcase chat speaks:
//   project  the copper hall waiting for copper (`_copperhall_gate why=copper_wait need=N ingots=H`) opens ONE town request
//            "copper_ingot x (N - H) for the hall"; a bot sent to mine copper for it (`_copper_run issued`) is PRODUCING; a
//            verified town deposit of copper while it is open (`_town_deposit` banked raw_copper / copper_ingot / copper_block)
//            is a FILL from that bot's bag; the gate opening (`why=ok`) is MET, with the time it took.
//   kit      a bot's toolkit drawing iron from the town (`_kit_search outcome=took`, then `_toolkit phase=kit outcome=crafted
//            drew=N crafted=X`) is a request FILLED by a town chest (the first `:success` container the search names); a search
//            that found none (`_kit_search` any other outcome) is UNFILLED.
// Every event is one `_request` telemetry row (the showcase chat's catalogue speaks those) and one line in the town's journal
// `requests.jsonl` (what piece 2's bag hand-off reads). NOTHING HERE CHANGES WHAT A BOT DOES: it is made from records already
// written (the logger's read-only record tap), so a request cannot say what did not happen. No LLM, no prompt line.
//
// THE TOWN FILE `requests-town.json` (pool state dir, short exclusive lock, as showchat's): the open project requests, so ten
// processes and their restarts agree on one request per (project, item), its open time and its fills. A request not refreshed
// by its gate for STALE_MS expires (a project that stopped asking). A refresh is a row only when the shortfall moved by
// max(16, 25%) and REFRESH_MS passed (the gate writes ~180 rows a day).
//
// SWITCHES. REQUESTS=on|off overrides; otherwise on only in REQUESTS_POOLS (default `showcase`). REQUESTS=off is the rollback
// (no tap: today's behaviour). The chat lines go through showchat's own rate rules and kill switch.

import fs from 'node:fs'
import path from 'node:path'

export const REQUESTS_V = 1
export const STATE_FILE = 'requests-town.json'
export const JOURNAL_FILE = 'requests.jsonl'
export const JOURNAL_ROTATE_BYTES = 4 * 1024 * 1024
/** an open project request no gate row refreshed for this long expires */
export const STALE_MS = 6 * 3600_000
/** a refresh row: the shortfall moved by at least max(REFRESH_MIN, REFRESH_FRAC x the last said) and this long passed */
export const REFRESH_MS = 30 * 60_000
export const REFRESH_MIN = 16
export const REFRESH_FRAC = 0.25
/** the gate views a shortfall is read from (the best of them) */
export const VIEW_MS = 30 * 60_000
/** a kit draw's craft row must follow its search within this */
export const KIT_PAIR_MS = 120_000

/** On? REQUESTS=on|off overrides; otherwise only in REQUESTS_POOLS (default showcase). Pure. */
export function requestsOn (env = process.env, pool = '') {
  const v = String(env?.REQUESTS ?? '').trim().toLowerCase()
  if (['on', '1', 'true', 'yes'].includes(v)) return true
  if (['off', '0', 'false', 'no'].includes(v)) return false
  return String(env?.REQUESTS_POOLS ?? 'showcase').split(',').map(s => s.trim()).filter(Boolean).includes(String(pool))
}

// ---- pure: reading the records ------------------------------------------------------------------------------------------

const field = (d, k) => { const m = new RegExp(`(?:^|\\s)${k}=(\\S+)`).exec(String(d ?? '')); return m ? m[1] : null }
const num = (d, k) => { const v = Number(field(d, k)); return Number.isFinite(v) ? v : null }
/** copper counted as ingots (a block is 9); raw copper smelts 1:1 */
export const COPPER_UNITS = Object.freeze({ copper_ingot: 1, raw_copper: 1, copper_block: 9 })
const XYZ = /^-?\d+,-?\d+,-?\d+$/
export const KIT_UNFILLED = new Set(['no_iron', 'no_sticks', 'unseen', 'stalled'])

/**
 * ONE RECORD -> a request event | null. Pure. Events:
 *   { t:'gate', for, item, need, have }  { t:'met', for, item }  { t:'producing', for, item, block }
 *   { t:'deposit', units }  { t:'kit_took', chest }  { t:'kit_none', outcome }  { t:'kit_crafted', drew, crafted }
 */
export function eventFor (rec) {
  const s = rec?.skill ?? {}
  const kind = String(s.name ?? '')
  const st = String(s.status ?? '')
  const d = String(s.detail ?? '')
  if (kind === '_copperhall_gate') {
    const why = field(d, 'why')
    if (why === 'copper_wait') {
      const need = num(d, 'need'), have = num(d, 'ingots')
      if (need === null || have === null) return null
      return { t: 'gate', for: 'hall', item: 'copper_ingot', need, have }
    }
    if (why === 'ok') return { t: 'met', for: 'hall', item: 'copper_ingot' }
    return null
  }
  // enchantshop-01: a furnishing's gate (`_enchantshop_gate fit=<anvil|table|shelves> why=wait|ok|placed short=<item:n,...> need=<item:n,...>`)
  // opens ONE request per (furnishing, root input) the town lacks -- need = the root bill of its open slots, have = need - short -- and
  // closes the furnishing's requests whose input is no longer short (all of them when it is placed or its inputs are all held)
  if (kind === '_enchantshop_gate') {
    const fit = field(d, 'fit'), why = field(d, 'why')
    if (!fit || !/^[a-z_]+$/.test(fit) || !['wait', 'ok', 'placed'].includes(why)) return null
    const pairs = v => (v && v !== '-' ? v.split(',').map(x => x.split(':')).filter(([i, n]) => /^[a-z_]+$/.test(i ?? '') && Number.isFinite(Number(n))).map(([i, n]) => [i, Number(n)]) : [])
    const short = why === 'wait' ? pairs(field(d, 'short')) : []
    // r1 (Codex code r1 note): a wait row whose short= reads as nothing (malformed, cut) is no event -- never a close of every request
    if (why === 'wait' && !short.length) return null
    const need = Object.fromEntries(pairs(field(d, 'need')))
    const forP = `enchant_${fit}`
    const evs = short.map(([item, n]) => ({ t: 'gate', for: forP, item, need: Math.max(n, need[item] ?? n), have: Math.max(0, (need[item] ?? n) - n) }))
    evs.push({ t: 'met_for', for: forP, keep: short.map(([i]) => i) })
    return { t: 'multi', evs }
  }
  if (kind === '_copper_run' && st === 'success') {
    const block = /^issued block=([a-z_]+)/.exec(d)?.[1] ?? null
    return block ? { t: 'producing', for: 'hall', item: 'copper_ingot', block } : null
  }
  if (kind === '_town_deposit' && st === 'success') {
    const m = /\bbanked ([a-z0-9_]+:\d+(?:,[a-z0-9_]+:\d+)*)/.exec(d)
    if (!m) return null
    let units = 0
    for (const p of m[1].split(',')) { const [i, n] = p.split(':'); if (COPPER_UNITS[i]) units += COPPER_UNITS[i] * Number(n) }
    return units > 0 ? { t: 'deposit', units } : null
  }
  if (kind === '_kit_search') {
    const outcome = field(d, 'outcome')
    if (outcome === 'took') {
      const tried = /\btried=\[([^\]]*)\]/.exec(d)?.[1] ?? ''
      const hit = tried.split(';').map(x => x.split(':')).find(([c, r]) => r === 'success' && XYZ.test(c))
      return { t: 'kit_took', chest: hit ? hit[0] : null }
    }
    // toolkit.mjs kitSearchOutcome: more (progress, the search goes on) is no event; no_iron / no_sticks / unseen / stalled
    // are UNFILLED with that outcome (only no_iron is "the chests had none")
    return outcome && KIT_UNFILLED.has(outcome) ? { t: 'kit_none', outcome } : null
  }
  if (kind === '_toolkit' && field(d, 'phase') === 'kit' && field(d, 'outcome') === 'crafted') {
    const drew = num(d, 'drew'), crafted = field(d, 'crafted')
    if (!drew || drew <= 0 || !crafted || !/^[a-z_]+(\+[a-z_]+)*$/.test(crafted)) return null   // `iron_axe+iron_shovel` (Codex r1)
    return { t: 'kit_crafted', drew, crafted }
  }
  return null
}

// ---- pure: the town's project requests ------------------------------------------------------------------------------------

/** The request key: one per (project, item), town-wide. */
export const reqKey = (forP, item) => `project:${forP}:${item}`

/**
 * ONE PROJECT EVENT AGAINST THE TOWN STATE -> { state, rows }. Pure. `rows` are the `_request` rows to write (op + fields).
 * `state.open` maps reqKey -> { for, item, need, have, qty, openedAt, seenAt, saidQty, saidAt, fills, filled, producers }.
 * Expiry of stale requests runs first, on every event.
 */
export function stepProject (state, ev, bot, now) {
  const open = { ...(state?.open ?? {}) }
  const rows = []
  for (const [k, r] of Object.entries(open)) {
    if (now - (r.seenAt ?? 0) > STALE_MS) {
      rows.push({ op: 'expire', for: r.for, item: r.item, qty: r.qty, mins: Math.round((now - r.openedAt) / 60_000), fills: r.fills ?? 0, filled: r.filled ?? 0 })
      delete open[k]
    }
  }
  if (ev?.t === 'gate') {
    const k = reqKey(ev.for, ev.item)
    const r = open[k]
    // THE TOWN'S BEST VIEW: each bot's gate counts what ITS index knows, and an unknown container counts 0 -- on the showcase
    // 11-01..03 the same minute read have=0 need=427 from one bot and have=130 need=247 from another. So the shortfall is read
    // from the view with the MOST copper among the last VIEW_MS of gate rows (a partial view can only under-count)
    const views = [...(r?.views ?? []).filter(v => now - v.t < VIEW_MS), { t: now, need: ev.need, have: ev.have }]
    const best = views.reduce((a, v) => (v.have > a.have ? v : a))
    const qty = Math.max(0, best.need - best.have)
    if (qty <= 0) {
      if (r) open[k] = { ...r, views, seenAt: now }   // covered by the best view: the gate's next row says ok
    } else if (!r) {
      open[k] = { for: ev.for, item: ev.item, need: best.need, have: best.have, qty, openedAt: now, seenAt: now, saidQty: qty, saidAt: now, fills: 0, filled: 0, by: bot, views }
      rows.push({ op: 'open', for: ev.for, item: ev.item, qty, need: best.need, have: best.have })
    } else {
      const moved = Math.abs(qty - (r.saidQty ?? qty))
      const nr = { ...r, need: best.need, have: best.have, qty, seenAt: now, views }
      if (moved >= Math.max(REFRESH_MIN, REFRESH_FRAC * (r.saidQty ?? qty)) && now - (r.saidAt ?? 0) >= REFRESH_MS) {
        nr.saidQty = qty; nr.saidAt = now
        rows.push({ op: 'update', for: ev.for, item: ev.item, qty, need: best.need, have: best.have, was: r.saidQty })
      }
      open[k] = nr
    }
  } else if (ev?.t === 'met') {
    const k = reqKey(ev.for, ev.item)
    const r = open[k]
    if (r) {
      rows.push({ op: 'met', for: r.for, item: r.item, need: r.need, mins: Math.round((now - r.openedAt) / 60_000), fills: r.fills ?? 0, filled: r.filled ?? 0 })
      delete open[k]
    }
  } else if (ev?.t === 'met_for') {
    // enchantshop-01: every open request of the furnishing whose input is no longer short is met
    const keep = new Set(ev.keep ?? [])
    for (const [k, r] of Object.entries(open)) {
      if (r.for !== ev.for || keep.has(r.item)) continue
      rows.push({ op: 'met', for: r.for, item: r.item, need: r.need, mins: Math.round((now - r.openedAt) / 60_000), fills: r.fills ?? 0, filled: r.filled ?? 0 })
      delete open[k]
    }
  } else if (ev?.t === 'producing') {
    const r = open[reqKey(ev.for, ev.item)]
    if (r) rows.push({ op: 'producing', for: r.for, item: r.item, qty: r.qty, block: ev.block })
  } else if (ev?.t === 'deposit') {
    // a deposit of copper while the hall waits: a fill from this bot's bag (the verified town deposit is the transfer)
    const k = Object.keys(open).find(x => open[x].item === 'copper_ingot')
    if (k) {
      const r = open[k]
      open[k] = { ...r, fills: (r.fills ?? 0) + 1, filled: (r.filled ?? 0) + ev.units }
      rows.push({ op: 'fill', for: r.for, item: r.item, units: ev.units, src: 'bag', qty: r.qty })
    }
  }
  return { state: { v: REQUESTS_V, open }, rows }
}

/**
 * ONE KIT EVENT AGAINST THIS BOT'S PENDING DRAW -> { pend, rows }. Pure (per process: a kit is one bot's own need).
 * kit_took then kit_crafted within KIT_PAIR_MS -> `filled` from the chest; kit_none -> `unfilled`.
 */
export function stepKit (pend, ev, now) {
  if (ev?.t === 'kit_took') return { pend: { at: now, chest: ev.chest }, rows: [] }
  if (ev?.t === 'kit_none') return { pend: null, rows: [{ op: 'unfilled', kind: 'kit', item: 'iron_ingot', outcome: ev.outcome }] }
  if (ev?.t === 'kit_crafted') {
    if (!pend || now - pend.at > KIT_PAIR_MS) return { pend: null, rows: [] }
    return { pend: null, rows: [{ op: 'filled', kind: 'kit', item: 'iron_ingot', qty: ev.drew, src: 'chest', at: pend.chest ?? '-', for: ev.crafted }] }
  }
  return { pend, rows: [] }
}

/** A `_request` row's detail (enums, registry names, numbers, coordinates only: nothing free-text). Pure. */
export function requestDetail (row) {
  const order = ['op', 'kind', 'for', 'item', 'qty', 'need', 'have', 'was', 'units', 'src', 'at', 'block', 'outcome', 'mins', 'fills', 'filled']
  const r = { kind: 'project', ...row }
  return order.filter(k => r[k] !== undefined && r[k] !== null).map(k => `${k}=${r[k]}`).join(' ').slice(0, 300)
}

/** The `_requests_mode` licence row. Pure. */
export const requestsModeDetail = ({ on, pool }) =>
  `on=${on ? 1 : 0} v=${REQUESTS_V} pool=${pool} kinds=project:hall:copper_ingot,project:enchant_*,kit:iron_ingot stale_h=${STALE_MS / 3600_000} refresh_min=${REFRESH_MS / 60_000} llm=0 changes_behaviour=0`

// ---- the town file -----------------------------------------------------------------------------------------------------

const LOCK_STALE_MS = 10_000
/** Run fn(state) -> { state, ... } under a short exclusive lock on the town file. Never throws; -> fn's result or null. */
export function withState (dir, fn) {
  const file = path.join(dir, STATE_FILE)
  const lock = file + '.lock'
  let held = false
  try {
    fs.mkdirSync(dir, { recursive: true })
    try { fs.writeFileSync(lock, String(process.pid), { flag: 'wx' }); held = true } catch {
      try { if (Date.now() - fs.statSync(lock).mtimeMs > LOCK_STALE_MS) { fs.unlinkSync(lock); fs.writeFileSync(lock, String(process.pid), { flag: 'wx' }); held = true } } catch {}
    }
    if (!held) return null
    let state = { v: REQUESTS_V, open: {} }
    try { const j = JSON.parse(fs.readFileSync(file, 'utf8')); if (j && typeof j.open === 'object' && j.open) state = { v: REQUESTS_V, open: j.open } } catch {}
    const out = fn(state)
    if (out?.state) {
      const tmp = `${file}.${process.pid}.tmp`
      fs.writeFileSync(tmp, JSON.stringify(out.state))
      fs.renameSync(tmp, file)
    }
    return out
  } catch { return null } finally {
    if (held) try { fs.unlinkSync(lock) } catch {}
  }
}

// ---- the board (impure; installed once per spawn from features.mjs) ------------------------------------------------------

/**
 * Make the board for one bot. -> { onRecord(rec), stats }. Injectable for the tests: dir (the pool state dir), bot (username),
 * emit(row) (the telemetry writer: { kind: 'request', status, detail }), now().
 */
export function makeBoard ({ bot, dir, emit = () => {}, now = () => Date.now() }) {
  const stats = { events: 0, rows: 0, lock: 0 }
  let pend = null
  const me = () => String(bot?.username ?? '')
  const write = (rows) => {
    for (const row of rows) {
      stats.rows++
      const detail = requestDetail(row)
      try { emit({ kind: 'request', status: row.op === 'unfilled' || row.op === 'expire' ? 'no_effect' : 'success', detail }) } catch {}
      try {
        const jf = path.join(dir, JOURNAL_FILE)
        try { if (fs.statSync(jf).size > JOURNAL_ROTATE_BYTES) fs.renameSync(jf, jf + '.1') } catch {}
        fs.appendFileSync(jf, JSON.stringify({ v: REQUESTS_V, t: new Date(now()).toISOString(), by: me(), kind: 'project', ...row }) + '\n')
      } catch {}
    }
  }
  const onRecord = rec => {
    const name = rec?.skill?.name
    if (name === '_request' || name === '_requests_mode') return
    const ev = eventFor(rec)
    if (!ev) return
    stats.events++
    const t = now()
    if (ev.t.startsWith('kit_')) {
      const r = stepKit(pend, ev, t)
      pend = r.pend
      write(r.rows)
      return
    }
    // enchantshop-01: one record may carry several events (a furnishing's gate: one per input, then its closes), folded under one lock
    const evs = ev.t === 'multi' ? ev.evs : [ev]
    const res = withState(dir, state => evs.reduce((acc, e) => { const r = stepProject(acc.state, e, me(), t); return { state: r.state, rows: [...acc.rows, ...r.rows] } }, { state, rows: [] }))
    if (!res) { stats.lock++; return }
    write(res.rows)
  }
  return { onRecord, stats }
}
