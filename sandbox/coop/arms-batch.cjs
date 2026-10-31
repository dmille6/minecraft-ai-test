// SANDBOX-ONLY: the B5 Paper arms BATCH -- every arm of every pair, one run per sandbox at a time, servers in parallel.
//   node sandbox/coop/arms-batch.cjs <botRoot> <pairs, e.g. 1-6> <servers, e.g. sandbox5,sandbox6> [arms]
// Arm order inside a pair is shuffled by the pair's seed (design s.6.2: order randomized within pairs). A job already in
// sandbox/log/arms-e2e/results.jsonl (same arm, seed and sha) is skipped, so a killed batch resumes where it stopped.
// Each run is `arms-e2e.cjs` (which checks the `coop` sandbox lock itself). A failed run is logged and retried once.
'use strict'
const { spawn, execFileSync } = require('child_process')
const fs = require('fs'); const path = require('path')
const [BOT_ROOT, PAIRS_S, SERVERS_S, ARMS_S] = process.argv.slice(2)
if (!BOT_ROOT || !PAIRS_S || !SERVERS_S) throw new Error('usage: node arms-batch.cjs <botRoot> <pairs a-b> <servers,...> [arms,...]')
const R = path.resolve(__dirname, '../..')
const RES = `${R}/sandbox/log/arms-e2e/results.jsonl`
const LOG = `${R}/sandbox/log/arms-e2e/batch.log`
const ARMS = (ARMS_S || 'rotation,random,greedy,oracle,frontier:claude-sonnet-5-5,frontier:gpt-6.1-sol,frontier:claude-haiku-5-5').split(',')
const [p0, p1] = PAIRS_S.split('-').map(Number)
const sha = execFileSync('git', ['-C', BOT_ROOT, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
const log = s => fs.appendFileSync(LOG, `${new Date().toISOString()} ${s}\n`)
function shuffled (arr, seed) {
  let a = seed >>> 0
  const rnd = () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
  const o = [...arr]; for (let i = o.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [o[i], o[j]] = [o[j], o[i]] } return o
}
const jobs = []
for (let p = p0; p <= (p1 || p0); p++) for (const arm of shuffled(ARMS, p * 7 + 3)) jobs.push({ arm, seed: p })
const done = () => { try { return fs.readFileSync(RES, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)).filter(r => r.sha === sha) } catch { return [] } }
const isDone = j => done().some(r => r.arm === j.arm && r.seed === j.seed)
let next = 0
const take = () => { while (next < jobs.length && isDone(jobs[next])) next++; return next < jobs.length ? jobs[next++] : null }
function runOne (j, server) {
  return new Promise(resolve => {
    const out = fs.openSync(`${R}/sandbox/log/arms-e2e/run-${j.arm.replace(':', '-')}-p${j.seed}-${server}.out`, 'a')
    const c = spawn(process.execPath, [`${R}/sandbox/coop/arms-e2e.cjs`, BOT_ROOT, j.arm, String(j.seed), server], { cwd: R, stdio: ['ignore', out, out], env: process.env })
    c.on('exit', code => resolve(code))
  })
}
async function worker (server) {
  for (let j; (j = take());) {
    log(`${server} start ${j.arm} p${j.seed}`)
    let code = await runOne(j, server)
    if (code !== 0 && !isDone(j)) { log(`${server} FAILED ${j.arm} p${j.seed} code=${code}; retry once in 60 s`); await new Promise(r => setTimeout(r, 60000)); code = await runOne(j, server) }
    log(`${server} end ${j.arm} p${j.seed} code=${code} recorded=${isDone(j)}`)
    await new Promise(r => setTimeout(r, 20000))
  }
  log(`${server} idle: no jobs left`)
}
log(`batch sha=${sha.slice(0, 8)} pairs=${PAIRS_S} servers=${SERVERS_S} arms=${ARMS.join(',')} jobs=${jobs.length}`)
Promise.all(SERVERS_S.split(',').map((s, i) => new Promise(r => setTimeout(r, i * 45000)).then(() => worker(s)))).then(() => log('batch done'))
