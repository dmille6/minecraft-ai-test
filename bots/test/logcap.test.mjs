// logcap-01 (OWNER 10-17 "Yup raise log limit"): the PRODUCTION wood target is 4000 -- proven in a child process with
// STOCK_WOOD_TARGET removed, because the runner pins it to 64 for the older stock tests.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'

const env = { ...process.env }; delete env.STOCK_WOOD_TARGET
const probe = `import('./src/stocktarget.mjs').then(m => console.log(JSON.stringify(['oak_log','birch_log','oak_planks','bamboo_planks','stick','stone','cobble'].map(m.targetOf))))`
const got = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', probe], { env, cwd: new URL('..', import.meta.url) }).toString().trim())
assert.deepEqual(got, [4000, 4000, 4000, 4000, 4000, 64, 1000], 'production: wood 4000, stone 64, cobble 1000')
// positive control: the env really is what the older suite runs with
const env64 = { ...process.env, STOCK_WOOD_TARGET: '64' }
const got64 = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', probe], { env: env64, cwd: new URL('..', import.meta.url) }).toString().trim())
assert.deepEqual(got64, [64, 64, 64, 64, 64, 64, 1000], 'the suite pin reproduces the old targets')
// a malformed value never zeroes the target (a 0 would prune every log)
const envBad = { ...process.env, STOCK_WOOD_TARGET: 'lots' }
const gotBad = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', probe], { env: envBad, cwd: new URL('..', import.meta.url) }).toString().trim())
assert.equal(gotBad[0], 4000, 'malformed env -> the production default')
console.log('  PASS  logcap: production wood target 4000; suite pin 64; malformed env -> 4000')
