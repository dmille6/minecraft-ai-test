#!/usr/bin/env python3
"""showcase-feed.py: the control bot is still named after the nightly rotation empties every live log of a stopped fleet
(11-19: piece stages refused, "the bench now reads policy None"). Behaviour tests plus anchored mutants."""
import gzip, importlib.util, json, os, sys, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, 'showcase-feed.py')


def load(src_text=None):
    path = SRC
    if src_text is not None:
        path = os.path.join(tempfile.mkdtemp(), 'feed_mut.py')
        open(path, 'w').write(src_text)
    spec = importlib.util.spec_from_file_location('feed_under_test', path)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def fixture():
    d = tempfile.mkdtemp()
    env = os.path.join(d, 'env'); os.makedirs(env)
    for b in ('board-a-Alpha', 'board-a-Bravo', 'hive-a-Kit'):
        open(os.path.join(env, b + '.env'), 'w').write(f'BOT={b}\n')
    logs = os.path.join(d, 'logs'); os.makedirs(logs)
    live = os.path.join(logs, 'skill-board-a-Alpha.jsonl')
    open(live, 'w').close()                                     # the live log after the rotation: empty
    with gzip.open(live + '-20261118.gz', 'wt') as f:           # older
        f.write(json.dumps({'code': {'version': 'OLD'}}) + '\n')
    with gzip.open(live + '-20261119.gz', 'wt') as f:           # newest: two rows and a torn tail
        f.write(json.dumps({'code': {'version': 'X1'}}) + '\n' + json.dumps({'code': {'version': 'X2'}}) + '\n')
    plain = os.path.join(logs, 'skill-board-a-Bravo.jsonl')
    open(plain, 'w').close()
    open(plain + '-20261119', 'w').write(json.dumps({'code': {'version': 'P'}}) + '\n')   # delaycompress: not yet .gz
    return env, live, plain, os.path.join(logs, 'skill-nobody.jsonl')


def check(m):
    env, live, plain, none = fixture()
    fails = []
    def ok(cond, what):
        if not cond:
            fails.append(what)
    ok(m.newest_row(live) is None, 'the live log is empty, so the live reader finds nothing (the 11-19 state)')
    r = m.rotated_newest_row(live)
    ok(r is not None and r['code']['version'] == 'X2', f'newest rotated .gz copy, its LAST row: got {r}')
    r = m.rotated_newest_row(plain)
    ok(r is not None and r['code']['version'] == 'P', f'an uncompressed rotated copy is read too: got {r}')
    ok(m.rotated_newest_row(none) is None, 'no rotated copy -> None')
    pick = m.pick_control([{'bot': 'board-a-Bravo', 'version': 'V'}, {'bot': 'board-a-Alpha', 'version': 'V'},
                           {'bot': 'board-b-Cy', 'version': 'W'}], env)
    ok(pick is not None and pick[:2] == ('board-a-Alpha', 'V'), f'majority build, first board bot by name: got {pick}')
    pick = m.pick_control([{'bot': 'hive-a-Kit', 'version': 'V'}], env)
    ok(pick is None, f'only board bots can be the control: got {pick}')
    ok(m.pick_control([], env) is None, 'no bots -> no control')
    pick = m.pick_control([{'bot': 'board-a-Zed', 'version': 'V'}], env)
    ok(pick is None, 'a board bot with no env file is not the control')
    # feedprompts-01: an empty live llm log falls back to the rotated copies, newest first (11-21: brain replay 0/0)
    d = tempfile.mkdtemp(); llm = os.path.join(d, 'llm-b.jsonl')
    open(llm, 'w').close()
    P = lambda i: json.dumps({'@timestamp': 'T%d' % i, 'prompt': {'system_hash': 'h', 'text': 'x\nsaw_end: END-A%d' % i}})
    with gzip.open(llm + '-20261119.gz', 'wt') as f:
        f.write(P(1) + '\n' + P(2) + '\n')
    open(llm + '-20261120', 'w').write(P(3) + '\n')
    chunks = list(m.prompt_sources(llm))
    flat = [json.loads(x)['@timestamp'] for c in chunks for x in c if x.strip()]
    ok(flat == ['T3', 'T1', 'T2'], f'live (empty) then the newest rotated copy first: got {flat}')
    open(llm, 'w').write('\n'.join(P(i) for i in (7, 8, 9)) + '\n')
    ok(len(list(m.prompt_sources(llm, max_rotated=0))) == 1, 'max_rotated=0 reads only the live log')
    return fails


MUTANTS = [
    ('newest rotated copy -> oldest', "for p in sorted(glob.glob(path + '-*'), reverse=True)[:1]:",
     "for p in sorted(glob.glob(path + '-*'))[:1]:"),
    ('gz: first row instead of last', "                    if line.strip():\n                        last = line\n",
     "                    if line.strip() and last is None:\n                        last = line\n"),
    ('board-only rule dropped', "if c.get('version') == major and c['bot'].startswith('board-') and os.path.isfile(p):",
     "if c.get('version') == major and os.path.isfile(p):"),
    ('rotated prompt copies never read', "    for rp in sorted(glob.glob(path + '-*'), reverse=True)[:max_rotated]:",
     "    for rp in sorted(glob.glob(path + '-*'), reverse=True)[:0]:"),
    ('rotated prompt copies oldest first', "    for rp in sorted(glob.glob(path + '-*'), reverse=True)[:max_rotated]:",
     "    for rp in sorted(glob.glob(path + '-*'))[:max_rotated]:"),
]


def main():
    fails = check(load())
    for f in fails:
        print('FAIL', f)
    src = open(SRC).read()
    killed = 0
    for name, old, new in MUTANTS:
        assert src.count(old) == 1, f'ANCHOR MISSING OR NOT UNIQUE: {name}'
        mf = check(load(src.replace(old, new)))
        if mf:
            killed += 1
        else:
            fails.append(f'mutant survived: {name}')
            print('SURVIVED', name)
    print(f'{"OK" if not fails else "FAILED"}: {len(fails)} failure(s); mutants killed {killed}/{len(MUTANTS)}')
    sys.exit(1 if fails else 0)


if __name__ == '__main__':
    main()
