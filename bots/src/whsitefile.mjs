// WHSITE-01 rc2: THE STOREHOUSE'S SITE FOR THIS PROCESS. The showcase's bots get their environment from a fixed list (no switch can
// be added per release), so the site comes from the TOWN'S OWN SITE FILE: `town-site.json` in the town's directory (the pool's state
// directory: the file skills.mjs townPlanSeed reads), under an optional key
//     "warehouse": { "core": [38, -51, 62, -27], "grow": [38, -58, 78, -18], "floor": 68 }
// WAREHOUSE_SITE in the environment comes first (the rig, the tests; `off` there forces no project whatever the file says). No
// key, a malformed key, another town's file, no file: NO PROJECT -- exactly as an unset switch. Read ONCE, at this module's load
// (shop.mjs builds its project list from it): the key is added to the file, then the bots restart.
import fs from 'node:fs'
import path from 'node:path'
import { WHSITE, whSiteOf, whSiteOfSeed, whSiteEnvOff } from './whsite.mjs'

// The town's directory and home, from the environment alone (config.mjs' own names and defaults: MEMORY_POOL 'hive', STATE_DIR,
// HOME_X / HOME_Y / HOME_Z 0 / 70 / 0; worldfacts.mjs poolStateDir's rule). This module is loaded by shop.mjs, which must stay
// loadable without the bot's whole configuration -- a test asserts the two agree.
export const townDirOf = (env = process.env) => env.POOL_STATE_DIR || path.join(path.dirname(env.STATE_DIR ?? '/srv/minecraft/bots/state'), `_pool-${env.MEMORY_POOL ?? 'hive'}`)
export const homeOf = (env = process.env) => ({ x: Number(env.HOME_X ?? '0'), y: Number(env.HOME_Y ?? '70'), z: Number(env.HOME_Z ?? '0') })
/** The site for an environment and a town directory -> { core, grow, floor } | null. Never throws. */
export function whSiteNow (env = process.env, dir = null, home = null) {
  try {
    const fromEnv = whSiteOf(env)
    if (fromEnv || whSiteEnvOff(env)) return fromEnv
    const d = dir ?? townDirOf(env)
    let json = null
    try { json = JSON.parse(fs.readFileSync(path.join(d, 'town-site.json'), 'utf8')) } catch { return null }
    return whSiteOfSeed(json, home ?? homeOf(env))
  } catch { return null }
}
WHSITE.site = whSiteNow()
