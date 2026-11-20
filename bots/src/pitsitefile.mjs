// PIT-01SHOW: THE PIT'S SITE FOR THIS PROCESS (whsitefile.mjs's rule). The showcase's environment is a fixed list, so the site comes
// from the TOWN'S OWN SITE FILE: `town-site.json` in the town's directory, under an optional key
//     "pit": { "centre": [-51, -99], "size": [15, 21], "floor": 60 }
// PIT_SITE in the environment comes first (the rig, the tests; `off` there forces no project whatever the file says). No key, a
// malformed key, another town's file, no file: NO PROJECT. Read ONCE, at this module's load (shop.mjs builds its project list from it).
import fs from 'node:fs'
import path from 'node:path'
import { PITSITE, pitSiteOf, pitSiteOfSeed, pitSiteEnvOff } from './pit.mjs'
import { townDirOf, homeOf } from './whsitefile.mjs'

/** The site for an environment and a town directory -> site | null. Never throws. */
export function pitSiteNow (env = process.env, dir = null, home = null) {
  try {
    const fromEnv = pitSiteOf(env)
    if (fromEnv || pitSiteEnvOff(env)) return fromEnv
    let json = null
    try { json = JSON.parse(fs.readFileSync(path.join(dir ?? townDirOf(env), 'town-site.json'), 'utf8')) } catch { return null }
    return pitSiteOfSeed(json, home ?? homeOf(env))
  } catch { return null }
}
PITSITE.site = pitSiteNow()
