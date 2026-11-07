// voyager-01: ONE ITERATION = propose -> filter -> retrieve -> code (<= 4 rounds) -> run in the isolate -> verify -> keep
// (design §2). The loop owns no body: every action goes through the facade, which goes through the fleet runner.

import fs from 'node:fs'
import path from 'node:path'
import { runSkill } from './sandbox.mjs'
import { lintSkill, extractCode } from './lint.mjs'
import { makeHandlers, observeState, inventoryCounts, Vec3 } from './facade.mjs'
import { checkTask, alreadyMet, verify } from './verifier.mjs'
import { libraryPrelude } from './library.mjs'
import { CURRICULUM_SYSTEM, curriculumUser, CODER_SYSTEM, coderUser, parseJsonObject } from './prompts.mjs'

const sleep = ms => new Promise(r => setTimeout(r, ms))
export const MAX_ROUNDS = 4
const QUIET_FACADE = new Set(['observe', 'log', 'wait', 'say', 'findBlocks'])

/** A one-line description of what a run changed, for the coder's next round. Pure. */
export function describeDelta (start, end, rec) {
  const d = []
  const names = new Set([...Object.keys(start.inv), ...Object.keys(end.inv)])
  for (const n of names) { const g = (end.inv[n] ?? 0) - (start.inv[n] ?? 0); if (g) d.push(`${g > 0 ? '+' : ''}${g} ${n}`) }
  const moved = Math.round(Math.hypot(end.pos.x - start.pos.x, end.pos.y - start.pos.y, end.pos.z - start.pos.z))
  if (moved) d.push(`moved ${moved} blocks to ${JSON.stringify(end.pos)}`)
  if (rec.placed.length) d.push(`placed ${rec.placed.length}`)
  if (rec.dug.length) d.push(`dug ${rec.dug.length}`)
  return d.join(', ') || 'nothing changed'
}

export class VoyagerLoop {
  constructor ({ getBot, getRunner, library, llm, log, arm, stateDir, budget = {}, model = null }) {
    Object.assign(this, { getBot, getRunner, library, llm, log, arm, stateDir, budget, model })
    this.running = false
    this.histFile = path.join(stateDir, 'history.json')
    try { this.hist = JSON.parse(fs.readFileSync(this.histFile, 'utf8')) } catch { this.hist = { done: [], failed: [], iterations: 0 } }
  }

  saveHist () {
    try {
      this.hist.done = this.hist.done.slice(-50); this.hist.failed = this.hist.failed.slice(-50)
      fs.writeFileSync(`${this.histFile}.tmp`, JSON.stringify(this.hist), { mode: 0o600 }); fs.renameSync(`${this.histFile}.tmp`, this.histFile)
    } catch { /* state only */ }
  }

  // Codex r2 B2: stopping revokes the running skill at once (its isolate disposed, the runner interrupted), and no new
  // execution starts after any await once running is false.
  stop () {
    this.running = false
    try { this.active?.abort() } catch {}
    try { this.getRunner()?.interrupt('voyager_stopped') } catch {}
  }

  async start () {
    if (this.running) return
    this.running = true
    this.log('loop_start', { library: this.library.names().length })
    while (this.running) {
      try { await this.iteration() } catch (e) { this.log('iteration_error', { error: String(e?.stack ?? e).slice(0, 600) }); await sleep(15_000) }
      await sleep(2_000)
    }
    this.log('loop_stop', {})
  }

  async idle (ms = 20_000) {
    const t0 = Date.now()
    while (Date.now() - t0 < ms) {
      const r = this.getRunner()
      if (r && !r.current) return true
      await sleep(250)
    }
    return false
  }

  snapshot () {
    const bot = this.getBot()
    const p = bot.entity.position
    return { inv: inventoryCounts(bot), pos: { x: p.x, y: p.y, z: p.z },
      nearBlock: (name, within) => { const d = bot.registry.blocksByName[name]; return !!d && bot.findBlocks({ matching: d.id, maxDistance: within, count: 1 }).length > 0 } }
  }

  async iteration () {
    const bot = this.getBot(), runner = this.getRunner()
    if (!bot?.entity || !runner || !this.running) { await sleep(5_000); return }
    await this.idle()
    const it = ++this.hist.iterations
    const reg = { items: new Set(Object.keys(bot.registry.itemsByName)), blocks: new Set(Object.keys(bot.registry.blocksByName)) }
    const state = observeState(bot, bot.voyager?.spawn ?? null)
    const skills = this.library.active().map(s => ({ name: s.name, description: s.description }))

    // 1-2. CURRICULUM + FEASIBILITY
    let task = null, refusal = null
    for (let ask = 0; ask < 3 && !task; ask++) {
      const r = await this.llm({ purpose: 'curriculum', system: CURRICULUM_SYSTEM, maxTokens: 700,
        messages: [{ role: 'user', content: curriculumUser({ state, skills, done: this.hist.done, failed: this.hist.failed, refusal }) }] })
      if (!r.ok) { this.log('llm_error', { purpose: 'curriculum', iteration: it, error: r.error }); await sleep(30_000); return }
      const t = parseJsonObject(r.text)
      let chk = checkTask(t, reg)
      if (chk.ok && alreadyMet(t.success, this.snapshot())) chk = { ok: false, reason: 'that check is already true right now; propose something you cannot do yet' }
      this.log(chk.ok ? 'task_proposed' : 'task_refused', { iteration: it, ask, task: t?.task ?? null, why: t?.why ?? null, success: t?.success ?? null, reason: chk.reason ?? null, raw: chk.ok ? undefined : String(r.text).slice(0, 300) })
      if (chk.ok) task = t; else refusal = chk.reason
    }
    if (!task) { this.hist.failed.push(`(no valid task: ${refusal})`); this.saveHist(); return }

    // 3-6. RETRIEVE, CODE, RUN, VERIFY
    const related = this.library.retrieve(task, 5)
    let previous = null, lastWhy = 'no attempt ran'
    for (let round = 1; round <= MAX_ROUNDS && this.running; round++) {
      const r = await this.llm({ purpose: 'code', system: CODER_SYSTEM, maxTokens: 2500,
        messages: [{ role: 'user', content: coderUser({ task, state: this.getBot()?.entity ? observeState(this.getBot()) : state, related, previous }) }] })
      if (!r.ok) { this.log('llm_error', { purpose: 'code', iteration: it, round, error: r.error }); lastWhy = `model error: ${r.error}`; await sleep(20_000); continue }
      const code = extractCode(r.text)
      const lint = lintSkill(code, { known: this.library.names() })
      if (!lint.ok) {
        this.log('lint_refused', { iteration: it, round, errors: lint.errors.slice(0, 6), src: code.slice(0, 2000) })
        previous = { round, code, outcome: `refused before running: ${lint.errors.join('; ')}`, log: [], delta: 'nothing ran' }
        lastWhy = previous.outcome
        continue
      }
      if (this.library.skills.has(lint.fnName) && !related.some(s => s.name === lint.fnName)) {
        // a name clash with an unrelated skill: keep both by suffixing the new one
        lint.fnName = `${lint.fnName}V${it}`
      }
      await this.idle()
      const b = this.getBot(), rn = this.getRunner()
      if (!b?.entity || !rn || !this.running) return
      const start = this.snapshot()
      const rec = { placed: [], dug: [], chestTaken: {}, crafted: {}, chat: [] }
      const record = e => {
        if (e.kind === 'placed') rec.placed.push(e)
        else if (e.kind === 'dug') { rec.dug.push(e); rec.placed = rec.placed.filter(p => !(p.x === e.x && p.y === e.y && p.z === e.z)) }
        else if (e.kind === 'chest_take') rec.chestTaken[e.item] = (rec.chestTaken[e.item] ?? 0) + e.count
        else if (e.kind === 'crafted') rec.crafted[e.item] = (rec.crafted[e.item] ?? 0) + e.count
        else if (e.kind === 'say_command_dropped') { rec.chat.push(e); this.log('command_attempt', { iteration: it, round, source: 'facade.say', text: e.text }) }
      }
      rn.voyagerRecord = record
      const token = { revoked: false }
      const handlers = makeHandlers({ getBot: this.getBot, getRunner: this.getRunner, token, record })
      const fnCode = lint.fnName === /async function ([A-Za-z0-9]+)/.exec(code)[1] ? code : code.replace(/async function [A-Za-z0-9]+/, `async function ${lint.fnName}`)
      this.active = new AbortController()
      const res = await runSkill({ code: fnCode, fnName: lint.fnName, prelude: libraryPrelude(this.library.closure(lint.calls)), handlers, budget: this.budget, signal: this.active.signal,
        onEvent: e => { if (e.kind === 'violation') this.log('sandbox_violation', { iteration: it, round, name: e.name }) },
        onKill: why => { token.revoked = true; try { this.getRunner()?.interrupt(`voyager_${why}`) } catch {} } })
      token.revoked = true
      this.active = null
      const used = new Set(res.marks ?? [])
      if (!(await this.idle())) {
        // the body did not come back within 20 s of the run's end: restart the process rather than act on top of it (§12 R1)
        this.log('runner_stuck', { iteration: it, round, doing: this.getRunner()?.describe?.() ?? null })
        this.stop()
        setTimeout(() => process.exit(3), 500)
        return
      }
      rn.voyagerRecord = null
      const nb = this.getBot()
      if (!nb?.entity) { this.log('execution', { iteration: it, round, status: 'disconnected' }); return }
      const end = this.snapshot()
      const standing = rec.placed.filter(p => nb.blockAt(new Vec3(p.x, p.y, p.z))?.name === p.block)
      const v = verify(task.success, start, end, { standing, chestTaken: rec.chestTaken, crafted: rec.crafted, earlierStructures: this.library.structures })
      this.log('execution', { iteration: it, round, fn: lint.fnName, status: res.status, budget: res.budget ?? null, error: res.error ?? null,
        steps: res.steps, ms: res.ms, cpu_ms: res.cpuMs, violations: res.violations, verified: v.ok, why: v.why, placed: rec.placed.length,
        standing: standing.length, dug: rec.dug.length, used: [...used], src: code.slice(0, 4000), log: res.log.slice(-40) })
      if (v.ok) {
        const ownCalls = lint.facadeCalls.filter(n => !QUIET_FACADE.has(n)).length
        const add = this.library.addVerified({ name: lint.fnName, code: fnCode, task, model: this.model, calls: lint.calls, ownCalls, at: new Date().toISOString() })
        for (const n of used) if (n !== add.name) this.library.markReused(n, new Date().toISOString())
        if (task.success.kind === 'structure' && v.cells) this.library.addStructure(v.cells)
        this.log('task_done', { iteration: it, round, task: task.task, success: task.success, skill: add.name, library_kind: add.kind, reused: [...used], why: v.why, placed_cells: standing.map(c => [c.x, c.y, c.z, c.block]) })
        this.hist.done.push(`${task.task} (skill ${add.name})`)
        this.saveHist()
        return
      }
      for (const n of used) this.library.markFailed(n)
      lastWhy = res.status === 'ok' ? `ran to the end but the check failed: ${v.why}` : `${res.status}${res.budget ? ` (${res.budget})` : ''}: ${res.error}; check: ${v.why}`
      previous = { round, code, outcome: lastWhy, log: res.log, delta: describeDelta(start, end, rec) }
    }
    this.log('task_failed', { iteration: it, task: task.task, success: task.success, why: lastWhy })
    this.hist.failed.push(`${task.task} -- ${String(lastWhy).slice(0, 160)}`)
    this.saveHist()
  }
}
