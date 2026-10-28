// WORKBENCH-01 (owner-approved 10-28; building tier section 4.2: the finished workshop is "the town's make_material site from
// then on"). Pure: which stations a complete workshop record owns, and the ORDER a job tries station candidates in -- the
// workshop's own first when usable, then everything else exactly as the caller already ordered it. The callers keep every
// fallback they had (a busy lease, a lit or foreign-filled furnace, an unreachable station -> the next candidate), so a town
// with no complete workshop, or one whose stations are all unusable, orders exactly as before.

/** The fit-out stations of a COMPLETE workshop record -> { furnaces: Set "x,y,z", tables: Set "x,y,z" } (empty otherwise). Pure. */
export function workshopStations (record) {
  const out = { furnaces: new Set(), tables: new Set() }
  if (!record?.structure_complete) return out
  for (const c of record.cells ?? []) {
    if (!Array.isArray(c?.at)) continue
    if (c.role === 'furnace') out.furnaces.add(c.at.join(','))
    else if (c.role === 'table') out.tables.add(c.at.join(','))
  }
  return out
}

/**
 * THE ORDER -> a new array: the candidates whose key is in `preferred` AND `usable(c)` first (in their given order), then the
 * rest in their given order; duplicates by key dropped (first kept). Pure and stable: with nothing preferred (no workshop) the
 * output is the input, deduplicated.
 */
export function preferWorkshop (cands = [], keyOf = c => c, preferred = null, usable = () => true) {
  const seen = new Set(), first = [], rest = []
  for (const c of cands ?? []) {
    const k = keyOf(c)
    if (seen.has(k)) continue
    seen.add(k)
    if (preferred?.has?.(k) && usable(c)) first.push(c)
    else rest.push(c)
  }
  return [...first, ...rest]
}

/** Which kind of station a key is, for the rows: 'w' (the workshop's), 'o' (any other), '-' (none used). Pure. */
export const stationKind = (k, preferred) => (k == null || k === '-' || k === '' ? '-' : preferred?.has?.(String(k)) ? 'w' : 'o')
