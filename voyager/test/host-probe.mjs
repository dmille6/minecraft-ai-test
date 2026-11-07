// voyager-01 stage 1: THE HOST PROBE. Run AS the bot unit (VOYAGER_ENTRY=this file) to prove the outer walls from the
// inside: what the bot process itself can reach, read, write and execute. Every line is an expectation and a result;
// the process exits 0 only if every wall held AND the positive controls (its own Paper server, its own state dir) worked.

import net from 'node:net'
import fs from 'node:fs'
import dns from 'node:dns/promises'
import { spawnSync } from 'node:child_process'

const ARM = process.env.VOYAGER_ARM ?? 'c'
const results = []
const want = (name, expectOk, ok, detail) => { results.push({ name, expect: expectOk ? 'works' : 'blocked', got: ok ? 'works' : 'blocked', pass: ok === expectOk, detail: String(detail ?? '').slice(0, 120) }) }

const tcp = (host, port, ms = 3000) => new Promise(res => {
  const s = net.connect({ host, port })
  const t = setTimeout(() => { s.destroy(); res({ ok: false, why: 'timeout' }) }, ms)
  s.once('connect', () => { clearTimeout(t); s.destroy(); res({ ok: true, why: 'connected' }) })
  s.once('error', e => { clearTimeout(t); res({ ok: false, why: e.code ?? e.message }) })
})
const unix = (p) => new Promise(res => {
  const s = net.connect(p)
  s.once('connect', () => { s.destroy(); res({ ok: true, why: 'connected' }) })
  s.once('error', e => res({ ok: false, why: e.code ?? e.message }))
})
const tryFs = (fn) => { try { return { ok: true, why: String(fn() ?? 'ok').slice(0, 80) } } catch (e) { return { ok: false, why: e.code ?? e.message } } }

let r
r = await tcp('127.0.0.1', 25565); want('own Paper server 127.0.0.1:25565 (positive control)', true, r.ok, r.why)
for (const p of [25570, 25571, 25599, 25670, 25706, 22, 9100]) { r = await tcp('127.0.0.1', p); want(`host loopback port ${p} (fleet / host services)`, false, r.ok, r.why) }
for (const [h, p] of [['10.0.0.30', 25571], ['10.0.0.31', 22], ['10.0.0.1', 443], ['1.1.1.1', 443], ['76.165.200.8', 11438], ['160.79.104.10', 443]]) {
  r = await tcp(h, p); want(`network ${h}:${p}`, false, r.ok, r.why)
}
try { const a = await dns.lookup('api.anthropic.com'); want('DNS lookup', false, true, a.address) } catch (e) { want('DNS lookup', false, false, e.code) }

r = tryFs(() => fs.readFileSync('/etc/voyager/anthropic.key', 'utf8').length); want('read the API key file', false, r.ok, r.why)
r = tryFs(() => fs.readFileSync('/etc/voyager/proxy.json', 'utf8').length); want('read the proxy config', false, r.ok, r.why)
const sockets = []
const walk = (d, depth = 0) => { if (depth > 6) return; let es = []; try { es = fs.readdirSync(d, { withFileTypes: true }) } catch { return } for (const e of es) { const p = `${d}/${e.name}`; if (e.isSocket()) sockets.push(p); else if (e.isDirectory()) walk(p, depth + 1) } }
walk('/run'); walk('/var'); walk('/tmp'); walk('/srv')
want('the only unix sockets visible are this arm\'s proxy socket', true, sockets.every(p => p === `/run/voyager/${ARM}/llm.sock`), sockets.join(',') || 'none')
r = tryFs(() => fs.readdirSync('/run/voyager').join(',')); want(`/run/voyager shows only this arm (${ARM})`, true, r.ok && r.why === ARM, r.why)
r = tryFs(() => fs.statSync('/run/dbus/system_bus_socket')); want('the D-Bus system socket', false, r.ok, r.why)
r = tryFs(() => fs.statSync('/run/systemd/private')); want('the systemd private socket', false, r.ok, r.why)
r = await unix('/run/systemd/journal/stdout'); want('the journal socket by path', false, r.ok, r.why)
r = tryFs(() => fs.readdirSync('/srv').join(',')); want('/srv shows only voyager', true, r.ok && r.why === 'voyager', r.why)
r = tryFs(() => fs.readdirSync('/srv/voyager').sort().join(',')); want('/srv/voyager shows code,logs,node,state only', true, r.ok && r.why === 'code,logs,node,state', r.why)
r = tryFs(() => fs.readdirSync('/srv/voyager/state').join(',')); want('only this arm\'s state dir', true, r.ok && r.why === ARM, r.why)
r = tryFs(() => fs.readdirSync('/home').join(',')); want('/home (ProtectHome)', false, r.ok && r.why !== '', r.why)
r = tryFs(() => fs.readdirSync('/var').join(',')); want('/var holds only its private tmp', true, r.ok && (r.why === '' || r.why === 'tmp'), r.why)
r = tryFs(() => fs.writeFileSync('/srv/voyager/code/x', 'x')); want('write into the code tree', false, r.ok, r.why)
r = tryFs(() => fs.writeFileSync('/etc/voyager-probe', 'x')); want('write into /etc', false, r.ok, r.why)
r = tryFs(() => { fs.writeFileSync(`/srv/voyager/state/${ARM}/probe.txt`, 'x'); fs.rmSync(`/srv/voyager/state/${ARM}/probe.txt`) }); want('write own state dir (positive control)', true, r.ok, r.why)
r = tryFs(() => fs.readdirSync('/srv/block2')); want('the fleet worlds /srv/block2', false, r.ok, r.why)
for (const bin of ['/bin/sh', '/usr/bin/python3', '/usr/bin/curl', '/usr/bin/sudo']) {
  const s = spawnSync(bin, ['-c', 'echo hi'], { timeout: 3000 })
  want(`execute ${bin}`, false, !s.error && s.status === 0, s.error?.code ?? `status ${s.status}`)
}
r = tryFs(() => { fs.writeFileSync(`/srv/voyager/state/${ARM}/x.sh`, '#!/bin/sh\necho hi\n', { mode: 0o700 }); const s = spawnSync(`/srv/voyager/state/${ARM}/x.sh`); fs.rmSync(`/srv/voyager/state/${ARM}/x.sh`); if (s.error) throw s.error; return s.status })
want('execute a file it wrote', false, r.ok, r.why)
let ivOk = false, ivWhy = ''
try { const m = await import('/srv/voyager/code/voyager/node_modules/isolated-vm/isolated-vm.js'); const iso = new (m.default ?? m).Isolate({ memoryLimit: 8 }); ivOk = (await iso.createContext()) != null; iso.dispose(); ivWhy = 'loaded' } catch (e) { ivWhy = e.message }
want('load the isolated-vm native addon (positive control)', true, ivOk, ivWhy)
r = await unix(`/run/voyager/${ARM}/llm.sock`); want('this arm\'s proxy socket (positive control: the proxy must be running)', true, r.ok, r.why)
r = await unix('/run/voyager/a/llm.sock'); want('another arm\'s proxy socket', false, r.ok, r.why)

const failed = results.filter(x => !x.pass)
for (const x of results) console.log(`${x.pass ? 'PASS' : 'FAIL'}  ${x.name}: expected ${x.expect}, got ${x.got} (${x.detail})`)
console.log(`host-probe: ${results.length - failed.length}/${results.length} held`)
try { fs.writeFileSync(`/srv/voyager/logs/${ARM}/host-probe.json`, JSON.stringify({ t: new Date().toISOString(), results }, null, 1)) } catch {}
process.exit(failed.length ? 1 : 0)
