#!/usr/bin/env python3
"""nullrun.py <read.py> <window_min>  -- run a canary read as a DRY RUN (CANARY_DRYRUN must be set) and print the
fields dict it would have emitted, as one line `NULLFIELDS {...}`. Nothing is emitted: readjson.emit is replaced by a
stub before the read imports it, and the read's own dry-run refusal (the one line that raises before emit) is removed
in memory only. The read file on disk is not touched."""
import sys, os, json, types
path, W = sys.argv[1], sys.argv[2]
assert os.environ.get('CANARY_DRYRUN'), 'CANARY_DRYRUN must be set (pools:sha:iso)'
src = open(path).read()
needle = "raise RuntimeError('CANARY_DRYRUN set -- not emitting')"
if os.environ.get('NULLRUN_NO_REFUSAL') == '1':
    # a read with no dry-run refusal (immobiledid emits even under CANARY_DRYRUN): the stub below still catches emit
    assert src.count(needle) == 0, 'ANCHOR: NULLRUN_NO_REFUSAL set but the read has a refusal'
else:
    assert src.count(needle) == 1, 'ANCHOR: the read has %d dry-run refusals' % src.count(needle)
    src = src.replace(needle, 'pass')
fake = types.ModuleType('readjson')


def emit(name, window_min, fields, *a, **k):
    print('NULLFIELDS ' + json.dumps({'read': name, 'window_min': window_min, 'fields': fields}, default=str))
    return None


fake.emit = emit
sys.modules['readjson'] = fake
sys.argv = [path, W]
exec(compile(src, path, 'exec'), {'__name__': '__main__', '__file__': path})
