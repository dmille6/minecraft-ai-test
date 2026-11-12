/**
 * CHESTMERGE-01 (OWNER 2026-11-12, "Yes, build merging"): A TOWN CHEST WITH NO EMPTY SLOT MAKES ITS OWN ROOM.
 *
 * The town deposit banks every stack into an EMPTY container slot and never tops up a partial one (towndeposit.mjs
 * fitToContainer: a merge that does not go as the client predicts leaves a stack on the cursor). Bags bank small
 * stacks, so the town's chests filled with them. Measured 11-12 (the town index on the canary host, the latest
 * observation of each container: 306 containers in 7 towns, 8,559 slots): 7,797 slots used, 239 containers full --
 * and 2,689 of the used slots (34%) would be free if the partial stacks of one kind in each container were one stack.
 * Coal sat at 15 a slot (13,268 in 883), bone meal at 5 (3,558 in 744), jungle logs at 3 (1,225 in 401).
 *
 * So when the plan needs more empty slots than the open container has, the run first merges partial stacks INSIDE
 * the container -- only as many as it needs, at most MERGE_MAX -- and then banks into the slots that freed, exactly
 * as before. No item changes kind, none leaves the container, and the deposit's own moves stay whole stacks into
 * empty slots.
 *
 * WHY THIS MERGE IS SAFE WHERE THE DEPOSIT'S WAS NOT (Codex review 1 P1 on towndeposit, the two hazards):
 *   - "a stack whose components differ swaps instead of merging": a pair is planned only when the two stacks have
 *     the same name AND the same metadata, nbt and component lists as the server sent them (mergeKey);
 *   - "a stack that does not fit leaves the rest on the cursor": a pair is planned only when the WHOLE picked-up
 *     stack fits (count + count <= stackSize), so a merge that goes as planned ends with an empty cursor.
 * EVERY MERGE IS JUDGED ON THE SERVER'S WORD (independent review r1). mineflayer never applies the server's cursor, so
 * after a click that went differently there the client's own cursor is a wrong guess. After each merge the run asks the
 * server (craftsync confirmCursor: the window's full state, cursor and slots) and counts the merge only when the cursor
 * is empty, the slot it came from is empty and the destination holds the sum. Anything else: what the server's cursor
 * holds goes back into the slot it came from (one click, while the server shows that slot empty), the merging ends,
 * and the run makes no deposit click in that container this visit. An abort between the two clicks is rescued the same
 * way by the caller (Codex review r1). Whatever is then left is the caller's server-confirmed settleCursor, as for
 * every other click of the town deposit.
 *
 * Rollback: CHESTMERGE=off (the run is then exactly the base's).
 */
export const CHESTMERGE = Object.freeze({ on: String(process.env.CHESTMERGE ?? '').trim().toLowerCase() !== 'off' })

/** The most merges one container visit makes (two clicks each, in craftsync's lockstep). */
export const MERGE_MAX = 8

/**
 * WHAT MAKES TWO STACKS ONE KIND TO THE SERVER -> a key, or null for a stack that is never merged. Pure.
 * Null: not a stack (no name, a stack size of 1, a tool), or data that cannot be compared (then it is left alone).
 * Two stacks merge on the server only when item and components are equal; the client holds both as sent, so equal
 * keys here are equal stacks there. Component lists are compared as sent: a different order is a different key (no
 * merge), never a wrong one.
 */
export function mergeKey (it) {
  if (!it || typeof it.name !== 'string' || !it.name) return null
  if (!(Number(it.stackSize) > 1) || it.maxDurability) return null
  try {
    return `${it.name}|${JSON.stringify([it.type ?? null, it.metadata ?? 0, it.nbt ?? null, it.components ?? [], it.removedComponents ?? []])}`
  } catch { return null }
}

/**
 * THE MERGES THAT FREE `need` SLOTS -> [{ name, from, to, count, into, sum }], at most min(need, max). Pure.
 *   containerSlots  the window's slots [0, inventoryStart): Item | null
 * Each step picks up the WHOLE stack in `from` (`count` items) and puts it onto the stack in `to` (`into` items, then
 * `sum`), and frees exactly one slot. Within a kind the smallest stack moves first, onto the fullest stack that takes
 * all of it; when the smallest fits nowhere, no pair of that kind fits. Kinds in name order, slots in slot order:
 * the same container gives the same plan.
 */
export function mergePlan (containerSlots = [], { need = 1, max = MERGE_MAX } = {}) {
  const want = Math.max(0, Math.min(Math.floor(Number(need) || 0), Math.floor(Number(max) || 0)))
  if (!want || !Array.isArray(containerSlots)) return []
  const groups = new Map()
  containerSlots.forEach((it, slot) => {
    const k = mergeKey(it)
    if (k == null) return
    const count = Number(it.count), size = Number(it.stackSize)
    if (!Number.isInteger(count) || count < 1 || count >= size) return   // a full stack takes nothing and frees nothing
    if (!groups.has(k)) groups.set(k, [])
    groups.get(k).push({ slot, count, size, name: it.name })
  })
  const steps = []
  for (const k of [...groups.keys()].sort()) {
    const g = groups.get(k)
    while (steps.length < want && g.length >= 2) {
      g.sort((a, b) => a.count - b.count || a.slot - b.slot)
      const from = g[0]
      let to = null
      for (let i = g.length - 1; i >= 1; i--) if (g[i].count + from.count <= g[i].size) { to = g[i]; break }
      if (!to) break
      steps.push({ name: from.name, from: from.slot, to: to.slot, count: from.count, into: to.count, sum: from.count + to.count })
      to.count += from.count
      g.shift()
      if (to.count >= to.size) g.splice(g.indexOf(to), 1)
    }
    if (steps.length >= want) break
  }
  return steps
}

/**
 * HOW MANY OF THE MERGES THE SERVER SHOWS -> a count. Pure. `done` are the merges the client saw through; `slots` the
 * container's slots on the re-open (the server's copy). A merge counts when its `to` slot holds the kind at the count
 * the LAST merge into that slot left (the deposit that follows never touches a slot that holds something).
 */
export function mergeVerified (done = [], slots = []) {
  const last = new Map()
  for (const m of done) last.set(m.to, m)
  return done.filter(m => { const f = last.get(m.to), s = slots?.[m.to]; return !!s && s.name === f.name && s.count === f.sum }).length
}

/** The `_chestmerge` row's detail: key=value. Under the logger's 300-character cap. Pure. */
export function mergeDetail ({ at = '-', need = 0, free = 0, planned = 0, merged = 0, verified = null, banked = 0, err = null, ms = 0 } = {}) {
  const e = err ? String(err).replace(/\s+/g, '_').slice(0, 60) : 'none'
  return `at=${at} need=${need} free=${free} planned=${planned} merged=${merged} verified=${verified == null ? 'unread' : verified} banked_stacks=${banked} stop=${e} ms=${Math.max(0, Math.round(ms))}`
}
