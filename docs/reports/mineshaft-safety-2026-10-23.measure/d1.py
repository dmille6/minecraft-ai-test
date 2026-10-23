import json, collections, re, os
D = os.path.dirname(os.path.abspath(__file__)) + '/'
rows = json.load(open(D + 'deaths7d.json'))
C = collections.Counter


def cls(r):
    d = r['skill']['detail']; fc = r['skill'].get('fail_class')
    if fc == 'fire':
        return 'lava-fall' if 'after falling' in d else ('magma' if 'floor was lava' in d else 'lava')
    if 'stalagmite' in d or 'stalactite' in d:
        return 'dripstone'
    return fc


def run(r):
    d = r['skill']['detail']
    m = re.search(r'was running (\w+)', d)
    if m:
        return m.group(1)
    if 'idle at the moment' in d:
        return 'idle'
    return '?'


def ybin(y):
    for lo in (64, 48, 32, 16, 0, -16, -32, -48, -64):
        if y >= lo:
            return f'{lo}..{lo+15}' if lo < 64 else '>=64'
    return '<-64'


if __name__ == '__main__':
    by = collections.defaultdict(C)
    for r in rows:
        c = cls(r); y = r['bot']['pos']['y']
        by['ybin'][(c, ybin(y))] += 1
        by['run'][(c, run(r))] += 1
    cs = ['lava', 'lava-fall', 'magma', 'drowning', 'fall', 'dripstone', 'suffocation']
    bins = ['>=64', '48..63', '32..47', '16..31', '0..15', '-16..-1', '-32..-17', '-48..-33', '-64..-49']
    print('y-bin'.ljust(10), *[c[:9].rjust(9) for c in cs])
    for b in bins:
        print(b.ljust(10), *[str(by['ybin'][(c, b)]).rjust(9) for c in cs])
    print()
    runs = sorted({k[1] for k in by['run']}, key=lambda s: -sum(by['run'][(c, s)] for c in cs))
    print('running'.ljust(14), *[c[:9].rjust(9) for c in cs])
    for s in runs:
        print(s.ljust(14), *[str(by['run'][(c, s)]).rjust(9) for c in cs])
    fh = [int(re.search(r'falling (\d+)', r['skill']['detail']).group(1)) for r in rows if cls(r) == 'lava-fall']
    print('lava-fall heights', sorted(fh))
    hp = C()
    for r in rows:
        if cls(r) == 'lava':
            m = re.search(r'hp (\d+)->0 over (\d+)s', r['skill']['detail'])
            if m:
                hp[int(m.group(2)) <= 5] += 1
    print('lava deaths hp->0 within 5s:', hp)
    lu = C()
    for r in rows:
        if cls(r) in ('lava', 'lava-fall'):
            m = re.search(r'leading up: ([^|]*)', r['skill']['detail'])
            if m:
                lu[m.group(1).strip().split(', ')[-1]] += 1
    print('last skill before (lava)', lu.most_common(20))
    print('pools lava', C(r['exp']['pool'] for r in rows if cls(r) in ('lava', 'lava-fall', 'magma')).most_common())
