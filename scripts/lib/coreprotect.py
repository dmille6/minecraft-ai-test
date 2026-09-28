"""Server-side ground truth for block changes, read from CoreProtect's SQLite store.

WHY THIS EXISTS. mineflayer 4.37.1 finishes a dig on a LOCAL TIMER and writes air into
its own block cache (`lib/plugins/digging.js`). So a resolved `bot.dig()` is a PREDICTION,
not a server confirmation, and `skills.mjs` re-reading that cache 250 ms later re-reads the
prediction. Every claim of the form "the bot broke the block" has rested on that. CoreProtect
records what the SERVER actually applied, with the actor, so the two can finally be compared.

CONTRACT, because this library exists in a project that has repeatedly published confident
zeros from dead instruments:
  * `breaks()` RAISES `NotRecording` when the store holds no rows at all for the window --
    an empty result is never returned as "nothing happened" without proof the pipe is live.
  * `NoSuchWorld` when the world name is not in co_world, rather than silently matching none.
  * Every query is read-only (`mode=ro`); this must never be able to alter a live world's log.

Actions are CoreProtect's own encoding: 0 = broken, 1 = placed.
"""
import sqlite3
import collections

BREAK, PLACE = 0, 1

Change = collections.namedtuple(
    'Change', 'ts actor world x y z material action rolled_back')


class NotRecording(Exception):
    """The store has no rows for this window -- the instrument is not proven live."""


class NoSuchWorld(Exception):
    """The world name is absent from co_world, so any filter on it matches nothing."""


def _conn(path):
    return sqlite3.connect(f'file:{path}?mode=ro', uri=True)


def _maps(cur):
    cur.execute('select id, world from co_world')
    worlds = {i: w for i, w in cur.fetchall()}
    cur.execute('select id, material from co_material_map')
    mats = {i: m for i, m in cur.fetchall()}
    cur.execute('select id, user from co_user')
    users = {i: u for i, u in cur.fetchall()}
    return worlds, mats, users


def changes(db, since_ts, until_ts=None, world=None, box=None, action=None,
            allow_empty=False):
    """Block changes the SERVER applied in a window.

    `box` is ((x0,y0,z0),(x1,y1,z1)) inclusive. `since_ts`/`until_ts` are unix seconds.
    Raises NotRecording unless the store has at least one row in the window, so that a
    caller cannot mistake "not instrumented" for "did not happen". Pass allow_empty=True
    only once you have separately shown the pipe is live.
    """
    with _conn(db) as c:
        cur = c.cursor()
        worlds, mats, users = _maps(cur)

        sql = ['select time, user, wid, x, y, z, type, action, rolled_back from co_block',
               'where time >= ?']
        args = [int(since_ts)]
        if until_ts is not None:
            sql.append('and time <= ?'); args.append(int(until_ts))
        if world is not None:
            wid = next((i for i, w in worlds.items() if w == world), None)
            if wid is None:
                raise NoSuchWorld(f'{world!r} not in co_world (have {sorted(worlds.values())})')
            sql.append('and wid = ?'); args.append(wid)
        if box is not None:
            (x0, y0, z0), (x1, y1, z1) = box
            sql.append('and x between ? and ? and y between ? and ? and z between ? and ?')
            args += [min(x0, x1), max(x0, x1), min(y0, y1), max(y0, y1), min(z0, z1), max(z0, z1)]
        if action is not None:
            sql.append('and action = ?'); args.append(int(action))

        cur.execute(' '.join(sql), args)
        rows = cur.fetchall()

        if not rows and not allow_empty:
            cur.execute('select count(*) from co_block where time >= ?', [int(since_ts)])
            if cur.fetchone()[0] == 0:
                raise NotRecording(
                    f'co_block holds no rows at all since ts={int(since_ts)} -- '
                    f'CoreProtect may not be loaded, or this is the wrong database. '
                    f'Prove the pipe is live before reading an empty result as evidence.')

        return [Change(ts=r[0], actor=users.get(r[1], f'#{r[1]}'),
                       world=worlds.get(r[2], f'#{r[2]}'),
                       x=r[3], y=r[4], z=r[5],
                       material=mats.get(r[6], f'#{r[6]}'),
                       action=r[7], rolled_back=bool(r[8]))
                for r in rows]


def broke(db, actor, since_ts, **kw):
    """Did `actor` break anything in the window -> the Changes, newest first."""
    out = [c for c in changes(db, since_ts, action=BREAK, **kw) if c.actor == actor]
    return sorted(out, key=lambda c: -c.ts)


def confirmed_break(db, actor, pos, since_ts, world=None, slack=1):
    """SERVER-SIDE confirmation that `actor` broke the block at `pos`.

    This is the check mineflayer cannot make. `pos` is (x,y,z); `slack` widens the box
    because a bot's reported target and the applied change should coincide exactly, and a
    disagreement is itself the finding.
    """
    x, y, z = pos
    box = ((x - slack, y - slack, z - slack), (x + slack, y + slack, z + slack))
    for c in changes(db, since_ts, world=world, box=box, action=BREAK):
        if c.actor == actor and not c.rolled_back:
            return c
    return None
