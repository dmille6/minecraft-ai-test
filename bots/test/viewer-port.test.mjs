// AN OPTIONAL SUBSYSTEM MUST NOT BE ABLE TO KILL THE AGENT.
//
// prismarine-viewer binds an HTTP port. A bot restarting before its previous
// process released that port gets EADDRINUSE -- and EADDRINUSE is delivered as
// an 'error' EVENT on the server, not as a throw. The try/catch wrapped around
// the viewer therefore could not catch it, Node's default for an unhandled
// 'error' event is to throw, and the bot exited.
//
// 2026-08-10: solo1 hit this on port 3015. systemd restarted it immediately,
// Paper replied "Connection throttled! Please wait before reconnecting", and it
// died again. With ten bots the loop drove the host to load average 20.48 --
// enough that sshd could no longer complete a banner exchange and the bots that
// had NOT crashed hung too. Roughly fifteen minutes of total fleet outage,
// caused by a debug viewer failing to bind a socket.
//
// The lesson is not "handle EADDRINUSE". It is that a try/catch around an
// asynchronous API is decoration: it reads as protection, so nobody looks
// again, and the failure it cannot catch is the only one that occurs.
import assert from 'node:assert'
import net from 'node:net'

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) }
  catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) }
}

const listen = port => new Promise((res, rej) => {
  const s = net.createServer()
  s.once('error', rej)
  s.once('listening', () => res(s))
  s.listen(port)
})

/** The guard as index.mjs applies it: probe, and only then start the viewer. */
function probePort(port) {
  return new Promise(resolve => {
    const probe = net.createServer()
    probe.once('error', () => resolve(false))
    probe.once('listening', () => probe.close(() => resolve(true)))
    probe.listen(port)
  })
}

await t('a free port is reported free', async () => {
  // 0 asks the OS for any free port; bind it, read it, release it.
  const tmp = await listen(0)
  const port = tmp.address().port
  await new Promise(r => tmp.close(r))
  assert.equal(await probePort(port), true)
})

await t('an OCCUPIED port is reported busy instead of throwing', async () => {
  const held = await listen(0)
  const port = held.address().port
  const free = await probePort(port)
  assert.equal(free, false,
    'this is the stale-listener case that killed solo1; it must resolve false, ' +
    'not reject and not throw')
  await new Promise(r => held.close(r))
})

await t('the probe never emits an unhandled error, whatever the port', async () => {
  // The whole point: no path through this may reach Node's default 'error'
  // behaviour. A privileged port fails for a DIFFERENT reason (EACCES) and must
  // still come back as a plain false.
  const before = process.listenerCount('uncaughtException')
  assert.equal(await probePort(1), false, 'port 1 is not bindable as an ordinary user')
  assert.equal(process.listenerCount('uncaughtException'), before,
    'the guard must not need a process-level handler to be safe')
})

await t('probing does not leave the port bound', async () => {
  const tmp = await listen(0)
  const port = tmp.address().port
  await new Promise(r => tmp.close(r))
  assert.equal(await probePort(port), true)
  // If the probe leaked its own listener, the second call would report busy and
  // every bot would silently lose its viewer forever.
  assert.equal(await probePort(port), true, 'the probe must release what it binds')
})

console.log(`  ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
