#!/usr/bin/env python3
"""Qualification tests for scripts/lib/coreprotect.py.

This project's dominant failure mode is publishing from an instrument that was never shown
to produce a DIFFERENT answer on a known case. So every test here is a known-answer case,
and the suite includes the negative controls that make a pass meaningful:

  * a live store with a matching row      -> the break is found          (positive control)
  * a live store with NO matching row     -> None, not an exception      (true negative)
  * an EMPTY store                        -> NotRecording RAISES         (the dead-instrument case)
  * an unknown world name                 -> NoSuchWorld RAISES          (not a silent no-match)
  * a rolled-back row                     -> NOT counted as confirmed
  * a row belonging to another actor      -> NOT attributed to ours
  * the real fleet schema                 -> column names still match

Run: python3 scripts/test_coreprotect.py
"""
import os, sqlite3, sys, tempfile, time, traceback

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'lib'))
import coreprotect as cp

SCHEMA = """
create table co_world (id integer primary key, world text);
create table co_material_map (id integer primary key, material text);
create table co_user (id integer primary key, time integer, user text, uuid text);
create table co_block (time integer, user integer, wid integer, x integer, y integer,
                       z integer, type integer, data integer, meta blob, blockdata blob,
                       action integer, rolled_back integer);
"""

def make_db(rows, worlds=(('world',),), mats=(('minecraft:oak_log',),), users=(('hive-b-Comet',),)):
    fd, path = tempfile.mkstemp(suffix='.db'); os.close(fd)
    c = sqlite3.connect(path); cur = c.cursor()
    cur.executescript(SCHEMA)
    for i, (w,) in enumerate(worlds, 1): cur.execute('insert into co_world values (?,?)', (i, w))
    for i, (m,) in enumerate(mats, 1): cur.execute('insert into co_material_map values (?,?)', (i, m))
    for i, (u,) in enumerate(users, 1): cur.execute('insert into co_user values (?,?,?,?)', (i, 0, u, ''))
    for r in rows: cur.execute(
        'insert into co_block (time,user,wid,x,y,z,type,data,action,rolled_back) '
        'values (?,?,?,?,?,?,?,?,?,?)', r)
    c.commit(); c.close()
    return path

PASS = FAIL = 0
def check(name, fn):
    global PASS, FAIL
    try:
        fn(); print(f'  PASS  {name}'); PASS += 1
    except Exception as e:
        print(f'  FAIL  {name}: {e}'); traceback.print_exc(); FAIL += 1

NOW = int(time.time())

def t_positive():
    db = make_db([(NOW, 1, 1, 100, 64, 200, 1, 0, cp.BREAK, 0)])
    got = cp.confirmed_break(db, 'hive-b-Comet', (100, 64, 200), NOW - 60, world='world')
    assert got is not None, 'a matching server-side break must be FOUND'
    assert got.material == 'minecraft:oak_log', got.material
    assert got.actor == 'hive-b-Comet', got.actor

def t_true_negative():
    """A live store that simply has no break at that spot must return None, NOT raise."""
    db = make_db([(NOW, 1, 1, 999, 64, 999, 1, 0, cp.BREAK, 0)])
    got = cp.confirmed_break(db, 'hive-b-Comet', (100, 64, 200), NOW - 60, world='world')
    assert got is None, 'a live store with no matching row is a true negative, not an error'

def t_empty_store_raises():
    """THE case this library exists for: an empty store must never read as 'it did not happen'."""
    db = make_db([])
    try:
        cp.changes(db, NOW - 60)
    except cp.NotRecording:
        return
    raise AssertionError('an EMPTY store must raise NotRecording, not return []')

def t_empty_store_allow_empty():
    db = make_db([])
    assert cp.changes(db, NOW - 60, allow_empty=True) == [], 'opt-out must still work'

def t_unknown_world_raises():
    db = make_db([(NOW, 1, 1, 1, 1, 1, 1, 0, cp.BREAK, 0)])
    try:
        cp.changes(db, NOW - 60, world='nope')
    except cp.NoSuchWorld:
        return
    raise AssertionError('an unknown world must raise, not silently match nothing')

def t_rolled_back_not_confirmed():
    db = make_db([(NOW, 1, 1, 100, 64, 200, 1, 0, cp.BREAK, 1)])
    got = cp.confirmed_break(db, 'hive-b-Comet', (100, 64, 200), NOW - 60, world='world')
    assert got is None, 'a rolled-back change must not count as a confirmed break'

def t_other_actor_not_attributed():
    db = make_db([(NOW, 2, 1, 100, 64, 200, 1, 0, cp.BREAK, 0)],
                 users=(('hive-b-Comet',), ('someone-else',)))
    got = cp.confirmed_break(db, 'hive-b-Comet', (100, 64, 200), NOW - 60, world='world')
    assert got is None, "another actor's break must not be attributed to ours"

def t_place_is_not_break():
    db = make_db([(NOW, 1, 1, 100, 64, 200, 1, 0, cp.PLACE, 0)])
    got = cp.confirmed_break(db, 'hive-b-Comet', (100, 64, 200), NOW - 60, world='world')
    assert got is None, 'a PLACE must not satisfy a break query'

def t_real_schema_matches():
    """Guard against the schema drifting under us: check the REAL sandbox db if present."""
    real = os.environ.get('CP_DB')
    if not real or not os.path.exists(real):
        print('        (skipped: set CP_DB to the live CoreProtect database.db to run)')
        return
    c = sqlite3.connect(f'file:{real}?mode=ro', uri=True); cur = c.cursor()
    cur.execute('pragma table_info(co_block)')
    cols = {r[1] for r in cur.fetchall()}
    need = {'time','user','wid','x','y','z','type','action','rolled_back'}
    missing = need - cols
    assert not missing, f'co_block is missing {missing} -- the reader would break'

if __name__ == '__main__':
    print('coreprotect qualification:')
    for nm, fn in [
        ('a matching server-side break is FOUND (positive control)', t_positive),
        ('a live store with no match returns None (true negative)', t_true_negative),
        ('an EMPTY store RAISES NotRecording (dead-instrument case)', t_empty_store_raises),
        ('allow_empty=True opts out of that raise', t_empty_store_allow_empty),
        ('an unknown world RAISES NoSuchWorld', t_unknown_world_raises),
        ('a rolled-back change is not a confirmed break', t_rolled_back_not_confirmed),
        ("another actor's break is not attributed to ours", t_other_actor_not_attributed),
        ('a PLACE does not satisfy a break query', t_place_is_not_break),
        ('the real co_block schema still has the columns we read', t_real_schema_matches),
    ]:
        check(nm, fn)
    print(f'\n{PASS} passed, {FAIL} failed')
    sys.exit(1 if FAIL else 0)
