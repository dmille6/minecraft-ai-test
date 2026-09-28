# readjson.py -- the read scripts' structured evidence (canary loop v3): one JSON object per read, bound to the active
# experiment (sha, pools, run_id, declared_at, window) and to the registration text (sha256 of ~/digest/RULE.md).
import json, os, hashlib, datetime as dt
def emit(name, window_min, fields, man_path='/srv/mcbots/trial-manifest.json', rule_path=os.path.expanduser('~/digest/RULE.md'), out_dir=os.path.expanduser('~/digest/reads')):
    try: man = json.load(open(man_path))
    except Exception: man = {}
    try: reg = hashlib.sha256(open(rule_path, 'rb').read()).hexdigest()
    except Exception: reg = None
    obj = {'read': name, 'sha': man.get('canary_code_version'), 'pools': man.get('canary_pool'), 'run_id': man.get('run_id'), 'declared_at': man.get('declared_at'),
           'window_min': int(window_min), 'registration_sha256': reg, 'emitted_at': dt.datetime.now(dt.timezone.utc).isoformat(), 'fields': fields}
    os.makedirs(out_dir, exist_ok=True)
    p = os.path.join(out_dir, f"{man.get('run_id') or 'none'}-{name}-{int(window_min)}.json")
    json.dump(obj, open(p, 'w'), indent=1, default=str)
    print('VERDICT_JSON ' + json.dumps({k: obj[k] for k in ('read', 'sha', 'pools', 'window_min')}) + ' -> ' + p)
    return p
