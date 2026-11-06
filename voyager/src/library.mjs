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
    if (!fn || fn.type !== 'FunctionDeclaration' || fn.id.name !== s.name || !/^[a-z][a-zA-Z0-9]{2,47}$/.test(s.name)) continue
    parts.push(s.code.slice(0, fn.id.start) + `__impl_${s.name}` + s.code.slice(fn.id.end))
    parts.push(`async function ${s.name}(b) { try { mark(${JSON.stringify(s.name)}) } catch (e) {} return __impl_${s.name}(b) }`)
    names.push(s.name)
  }
  if (!names.length) return ''
  // ONE IIFE: the mark callback is captured and removed from the global before any skill code runs; the wrappers are
  // published as non-writable globals so the skill can call them by name, and nothing else of the library is global.
  return `(function () {
  const mark = globalThis.__vy_mark; delete globalThis.__vy_mark;
${parts.join('\n')}
  for (const [n, f] of [${names.map(n => `[${JSON.stringify(n)}, ${n}]`).join(', ')}]) Object.defineProperty(globalThis, n, { value: f, writable: false, configurable: false, enumerable: false });
})();`
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
