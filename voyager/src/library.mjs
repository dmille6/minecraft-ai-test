// voyager-01: THE SKILL LIBRARY (design §2.2, §12 B4). Only the harness writes it: one JSON file per skill, written
// atomically after the verifier passes. It is read with JSON.parse; its code only ever runs inside the isolate. No outside
// checkpoint is ever loaded (Voyager issue #194).

import fs from 'node:fs'
import path from 'node:path'
import * as acorn from 'acorn'
import { outcomeSignature } from './verifier.mjs'

const words = s => new Set(String(s ?? '').toLowerCase().replace(/([a-z])([A-Z])/g, '$1 $2').split(/[^a-z0-9]+/).filter(w => w.length > 2))

/** Token-overlap score between a task and a skill. Pure. */
export function relevance (task, skill) {
  const a = words(`${task.task} ${task.success?.item ?? ''} ${task.success?.block ?? ''}`)
  const b = words(`${skill.name} ${skill.description} ${skill.signature}`)
  let n = 0
  for (const w of a) if (b.has(w)) n++
  return n / Math.max(1, Math.sqrt(a.size * b.size))
}

/** How proven a skill is: verified runs and later reuse count for it, failed re-runs against it. Small next to relevance. Pure. */
export function reliability (s) {
  return Math.min(s.verified ?? 1, 5) * 0.02 + Math.min(s.reused ?? 0, 5) * 0.05 - Math.min(s.fails ?? 0, 3) * 0.05
}

/** Word overlap of two skills' names and descriptions, 0..1 (Jaccard). Pure. */
export function similarity (a, b) {
  const x = words(`${a.name} ${a.description}`), y = words(`${b.name} ${b.description}`)
  let n = 0
  for (const w of x) if (y.has(w)) n++
  return n / Math.max(1, x.size + y.size - n)
}

/**
 * Harness 2 retrieval: DIFFERENT abilities, not rewrites of one. Harness 1 took the top 5 by word overlap; with 74
 * near-identical "small structure" skills and 57 "place a torch" ones in a 3b Haiku library that was five lookalikes.
 * Here: a skill with the task's own outcome signature ranks first; then by word overlap plus a little for being proven;
 * and a candidate is skipped when a skill already picked has the same signature -- except that two structures count as
 * the same only when their texts also overlap (a bridge and a hut are both "structure:small").
 * `related` are shown with code, `more` by name only. Pure and deterministic (ties break on the name).
 * @returns {{related: object[], more: object[]}}
 */
export function pickRelated (skills, task, { k = 4, more = 8 } = {}) {
  const want = outcomeSignature(task.success)
  const cands = []
  for (const s of skills) {
    const r = relevance(task, s)
    const same = s.signature === want
    if (r <= 0 && !same) continue
    cands.push({ s, score: r + (same ? 1 : 0) + reliability(s) })
  }
  cands.sort((a, b) => b.score - a.score || (a.s.name < b.s.name ? -1 : a.s.name > b.s.name ? 1 : 0))
  const picked = []
  for (const { s } of cands) {
    if (picked.length >= k + more) break
    const dup = picked.some(p => p.signature === s.signature && (!String(s.signature).startsWith('structure:') || similarity(p, s) > 0.4))
    if (!dup) picked.push(s)
  }
  return { related: picked.slice(0, k), more: picked.slice(k) }
}

/** Normalise code for duplicate detection: no comments, no whitespace runs, the function name blanked. Pure. */
export function normalise (code) {
  return String(code).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '').replace(/\s+/g, ' ')
    .replace(/^\s*async function [A-Za-z0-9]+\s*\(/, 'async function _(').trim()
}

/**
 * The library prelude for one run: each skill renamed to __impl_<name> and wrapped so that a call at run time reports
 * itself to the host through a PRIVATE callback the skill code cannot reach -- reuse is counted from that, not from the
 * text, and generated code cannot fake it (§12 B4 d; Claude review finding 5). Pure.
 */
export function libraryPrelude (skills) {
  const parts = []
  const names = []
  for (const s of skills) {
    let ast
    try { ast = acorn.parse(s.code, { ecmaVersion: 2023, sourceType: 'script' }) } catch { continue }
    const fn = ast.body[0]
    if (ast.body.length !== 1 || !fn || fn.type !== 'FunctionDeclaration' || !fn.async || fn.id.name !== s.name || !/^[a-z][a-zA-Z0-9]{2,47}$/.test(s.name)) continue
    // a named function EXPRESSION assigned to a temporary global: the sandbox's trusted publish step wraps and removes it
    parts.push(`globalThis.__vy_impl_${s.name} = (${s.code.slice(fn.start, fn.end)});`)
    names.push(s.name)
  }
  return names.length ? { source: parts.join('\n'), names } : null
}

export class Library {
  constructor (dir) {
    this.dir = dir
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
    this.skills = new Map()
    this.structures = []           // cell lists of verified structures (for the rebuild rule)
    for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort()) {
      try {
        const s = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))
        if (s && typeof s.name === 'string' && typeof s.code === 'string') this.skills.set(s.name, s)
      } catch { /* a torn file is skipped, never executed */ }
    }
    try { this.structures = JSON.parse(fs.readFileSync(path.join(dir, '_structures.jsonx'), 'utf8')) } catch { this.structures = [] }
  }

  names () { return [...this.skills.keys()] }
  active () { return [...this.skills.values()].filter(s => !s.demoted) }
  signatures () { return new Set([...this.skills.values()].map(s => s.signature)) }

  retrieve (task, k = 5) {
    return this.active().map(s => ({ s, r: relevance(task, s) })).filter(x => x.r > 0).sort((a, b) => b.r - a.r).slice(0, k).map(x => x.s)
  }

  /** Harness 2: see pickRelated. */
  retrieve2 (task, opts) { return pickRelated(this.active(), task, opts) }

  /** The library skills a code body names (so they must be in its prelude), transitively. */
  closure (names) {
    const out = new Map()
    const visit = n => {
      const s = this.skills.get(n)
      if (!s || out.has(n)) return
      out.set(n, s)
      for (const c of s.calls ?? []) visit(c)
    }
    for (const n of names) visit(n)
    return [...out.values()]
  }

  _write (s) {
    const f = path.join(this.dir, `${s.name}.json`)
    const tmp = `${f}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(s, null, 1), { mode: 0o600 })
    fs.renameSync(tmp, f)
  }

  /**
   * Record a verified skill. Returns {kind:'invented'|'reuse'|'composition'|'update', name}.
   * invented = a new outcome signature with its own facade calls; composition = it only called library skills;
   * a duplicate body or an existing name is a reuse/update.
   */
  addVerified ({ name, code, task, model, calls, ownCalls, at }) {
    const signature = outcomeSignature(task.success)
    const norm = normalise(code)
    for (const s of this.skills.values()) {
      if (normalise(s.code) === norm) { s.verified++; s.last_success = at; this._write(s); return { kind: 'reuse', name: s.name } }
    }
    if (this.skills.has(name)) {
      const s = this.skills.get(name)
      Object.assign(s, { code, description: task.task, verified: s.verified + 1, last_success: at, calls, fails: 0, demoted: false })
      this._write(s)
      return { kind: 'update', name }
    }
    const novel = !this.signatures().has(signature)
    const kind = ownCalls === 0 ? 'composition' : novel ? 'invented' : 'variant'
    const s = { name, description: task.task, signature, code, task, model, calls, created: at, verified: 1, fails: 0,
      last_success: at, reused: 0, demoted: false, kind }
    this.skills.set(name, s)
    this._write(s)
    return { kind, name }
  }

  markReused (name, at) {
    const s = this.skills.get(name)
    if (!s) return
    s.reused = (s.reused ?? 0) + 1
    s.last_reused = at
    this._write(s)
  }

  markFailed (name) {
    const s = this.skills.get(name)
    if (!s) return
    s.fails = (s.fails ?? 0) + 1
    if (s.fails >= 3) s.demoted = true
    this._write(s)
  }

  addStructure (cells) {
    this.structures.push(cells.map(c => ({ x: c.x, y: c.y, z: c.z })))
    const f = path.join(this.dir, '_structures.jsonx')
    fs.writeFileSync(`${f}.tmp`, JSON.stringify(this.structures), { mode: 0o600 })
    fs.renameSync(`${f}.tmp`, f)
  }
}
