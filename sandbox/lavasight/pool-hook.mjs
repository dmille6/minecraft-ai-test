// LAVASIGHT-01 PAPER: the failmine scene driver's FM_POOL_HOOK (sandbox/failmine/scene-e2e.mjs). It writes the per-world lava
// map the bot reads at spawn into THIS run's pool directory, made from the REAL map: LAVASIGHT_WORLD_MAP is the
// `lava-map.json` that scripts/host/lavasight/lavamap_publish.py wrote for the scene's fleet world (from
// ~/hazardmap/out/hazardmap.json). Its cells are translated by the arena's (DX, DZ) -- y is kept, as the driver keeps it --
// and kept only inside the cut grown by 4 (the rest of the world is not in the sandbox). The file is bound to the SANDBOX's
// own world: its seed comes from RCON `seed`, so the bot's hashedSeed check is exercised, not skipped; `world` is the run's
// pool name, so the pool-label check is too. stale_after: 36 h from now (a run never sees the clock expire).
//
// LAVASIGHT_HOOK_MODE: `real` (default) as above; `empty` (no cells: the file binds but prices nothing, a placebo); `none`
// (no file: the bot fails open). The base build never opens the file, so base runs see the same arena either way.
import fs from 'node:fs'
import path from 'node:path'

export async function prepare ({ poolDir, pool, DX, DZ, scene, rcon }) {
  const mode = process.env.LAVASIGHT_HOOK_MODE || 'real'
  if (mode === 'none') return { mode, wrote: null }
  const src = process.env.LAVASIGHT_WORLD_MAP
  if (!src) throw new Error('LAVASIGHT_WORLD_MAP must name the publisher\'s lava-map.json for the scene\'s world')
  const m = JSON.parse(fs.readFileSync(src, 'utf8'))
  if (m.schema !== 'mcai.lavamap' || m.schema_version !== 1) throw new Error(`not a lava map: ${src}`)
  if (scene.world && m.world !== scene.world) throw new Error(`the map is ${m.world}'s, the scene is ${scene.world}'s`)
  const seedReply = rcon('seed')
  const sm = /\[(-?\d+)\]/.exec(seedReply || '')
  if (!sm) throw new Error(`no seed from RCON: ${JSON.stringify(seedReply)}`)
  const [OX, OY, OZ] = scene.cells.origin, [SX, SY, SZ] = scene.cells.size, G = 4
  const inCut = ([x, y, z]) => x >= OX - G && x < OX + SX + G && z >= OZ - G && z < OZ + SZ + G && y >= OY - G && y < OY + SY + G
  const cells = mode === 'empty' ? [] : m.cells.filter(inCut).map(([x, y, z]) => [x + DX, y, z + DZ])
  const now = Date.now()
  const iso = t => new Date(t).toISOString().replace(/\.\d+Z$/, 'Z')
  const out = { schema: 'mcai.lavamap', schema_version: 1, world: pool, seed: sm[1], generated_at: iso(now), stale_after: iso(now + 36 * 3600e3),
                source: { map_sha256: m.source?.map_sha256 ?? null, map_generated_at: m.generated_at, fleet_world: m.world, translated: [DX, 0, DZ], mode },
                cells }
  const f = path.join(poolDir, 'lava-map.json')
  fs.writeFileSync(f, JSON.stringify(out))
  return { mode, wrote: f, cells: cells.length, of: m.cells.length, seed: sm[1] }
}
