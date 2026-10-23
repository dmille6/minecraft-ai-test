// Behavioural probe (scratch, not a test): which everyday geometries does isEntombed call a tomb?
// Fixtures follow bots/test/entombed-escape.test.mjs (stone fill, cells relative to the feet).
const SRC = new URL('../../../bots/src/reflex.mjs', import.meta.url).href   // this file lives in docs/reports/<name>.measure/
const { isEntombedForTest } = await import(SRC)

function blk (name, pos) {
  if (name === 'air' || !name) return { name: 'air', boundingBox: 'empty', position: pos }
  if (name === 'water' || name === 'lava') return { name, boundingBox: 'empty', position: pos }
  return { name, boundingBox: 'block', position: pos, diggable: true, digTime: () => 7500, canHarvest: () => true }
}
const V = (x, y, z) => ({ x, y, z, offset: (a, b, c) => V(x + a, y + b, z + c), clone: () => V(x, y, z) })
function world (air) { const s = new Set(air); return { get: (x, y, z) => s.has(`${x},${y},${z}`) ? 'air' : 'stone' } }
function bot (w, y = 44) { return { entity: { position: V(0, y, 0) }, blockAt: p => blk(w.get(p.x, p.y - y, p.z), p) } }
const cases = {
  // the sealed pocket the test suite uses (positive control)
  'sealed 1x2 pocket (control)': ['0,0,0', '0,1,0'],
  // the dig face of a 1-wide 2-high tunnel running +z: the bot can walk back along -z at feet AND head level
  'dead end of a 1x2 tunnel (open behind)': ['0,0,0', '0,1,0', '0,0,-1', '0,1,-1', '0,0,-2', '0,1,-2', '0,0,-3', '0,1,-3'],
  // middle of the same tunnel: two walls
  'middle of a 1x2 tunnel': ['0,0,0', '0,1,0', '0,0,-1', '0,1,-1', '0,0,1', '0,1,1'],
  // a 1-wide staircase going down +z, bot on a tread: the step above/behind it is open (it walked down from there)
  'tread of a 1-wide down-stair (came from -z, one up)': ['0,0,0', '0,1,0', '0,1,-1', '0,2,-1', '0,2,-2', '0,3,-2'],
  // a 2-wide room's corner: walls on two sides
  'corner of a 2x2 room': ['0,0,0', '0,1,0', '1,0,0', '1,1,0', '0,0,1', '0,1,1', '1,0,1', '1,1,1'],
  // a nook beside a corridor: bot steps sideways into a 1-block alcove (open side is the corridor)
  'alcove off a corridor': ['0,0,0', '0,1,0', '1,0,0', '1,1,0', '1,0,1', '1,1,1', '1,0,-1', '1,1,-1'],
}
for (const [name, air] of Object.entries(cases)) {
  console.log(String(isEntombedForTest(bot(world(air)))).padEnd(6), name)
}
