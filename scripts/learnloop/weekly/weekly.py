#!/usr/bin/env python3
"""learning loop WEEKLY PIPELINE (round 3, owner 11-01 "keep training our own model, continuously"). Runs on 10.0.0.31.

    python3 -B weekly.py tick                 # cron (every 2 h): start a round when one is due, advance the current one
    python3 -B weekly.py status               # where the current round is, and why it waits
    python3 -B weekly.py new [--id R]         # start a round now (refuses while one is open)
    python3 -B weekly.py report [--round R]   # (re)write REPORT.md
    python3 -B weekly.py register --round R --marker <sha>   # a person adds the prepared HELD model-canary entry

ONE ROUND = these phases, in order, each resumable and recorded in ~/learnloop/rounds/<R>/state.json:
  harvest     build_dataset.py over the newest `window_days` of the M1 archive (~/learnloop/days, sealed by nightly.py),
              the 3 held-out worlds REUSED (the 600-item gate set's worlds never train), the newest `new_days` held out
  pool        build_clean.py pool: GOOD BY OUTPUT (G2-G4) + a stratified relabel pool (non-transient failures, post-veto)
  transform   prompt_transform.mjs: pool, good set (and the c2 buffer once) -> the promptcache-01 layout the fleet runs,
              using the bots' OWN exported functions (bots_dir = a git archive of main)
  teach       the LOCAL teacher (qwen3.8:27b, Apache-2.0) answers `budget_items` of the shuffled pool, blind, through
              the fleet client, on the 3090 Ollama (llgpu.sh claim/teacher-up; think:false proxy)
  referee     a seeded `referee.n` sample of the round's labelled items is written for the MAC referee job
              (referee.py: Claude + GPT batch, paid, quarantined there, NEVER trained on). Not a gate: its result is
              read into the report when it arrives (drift flag)
  assemble    build_clean.py assemble: this round's kept relabels first, the replay buffer (earlier rounds' kept
              relabels, LOCAL labels only) tops up to relabel_n, the 30% per-skill cap, good_n fleet examples; refuses
              any gate-set id, held-out world, paid provenance
  train:<c>   per candidate base: llgpu.sh put + train (LoRA, adapter only), polled
  export:<c>  llgpu.sh export (on-the-fly merge -> q8_0 GGUF); the untuned base through the same converter once
  replay      every model on llama-server b12020 (the serving path the fleet is moving to, servea flags), the 600-item
              gate set in the promptcache layout, the fleet client (batchload.mjs, api oai), T=0, concurrency 2:
              incumbent (qwen2.5:7b), the current BEST, each candidate, each candidate's untuned base
  latency     open-loop Poisson at the serving agent's rates (20/50/80/107/130 per min, 3 min each, server restarted
              before each), fleet client settings (T 0.7, 45 s timeout), candidates + best
  gate        vs incumbent (eval_offline s.4a), vs best (tolerances in config), vs own base (the training effect),
              paired sign tests, skill mix; a pass that is better (or as good and <= 60% of the parameters) becomes
              the new BEST in ~/learnloop/registry.json
  register    a HELD model-env queue entry is PREPARED in the round dir (never launched by this pipeline)
  report      REPORT.md + summary.json in the round dir, copied to ~/learnloop/weekly-latest.md
GPU: every GPU phase claims the 3090 through llgpu.sh, which refuses while ANY other GPU user (the serving agent's
llama-server or servea, another job) is on it -- the phase then waits for the next tick ("wait: GPU busy ...").
ethan-gpu is never touched. The Blackwell and 10.0.0.72 are never contacted.
"""
import argparse, collections, datetime as dt, fcntl, glob, gzip, hashlib, json, math, os, random, shlex, shutil, subprocess, sys, time, types

HERE = os.path.dirname(os.path.abspath(__file__))
LL = os.path.dirname(HERE)
sys.path.insert(0, LL); sys.path.insert(0, os.path.join(LL, 'train'))
HOME = os.path.expanduser('~/learnloop')
ROUNDS = os.path.join(HOME, 'rounds')
REGISTRY = os.path.join(HOME, 'registry.json')
GPU_HOST = os.environ.get('LLGPU_HOST', '10.0.0.16')
GPU_KEY = os.path.expanduser(os.environ.get('LLGPU_KEY', '~/.ssh/id_llgpu'))
GPU_URL = 'http://%s:18090' % GPU_HOST
OLLAMA_URL = 'http://%s:11434' % GPU_HOST
HOLDER = 'learnloop-weekly'
PHASES_HEAD = ['harvest', 'pool', 'transform', 'teach', 'referee', 'assemble']
PHASES_TAIL = ['replay', 'latency', 'gate', 'register', 'report']
FORBIDDEN_HOSTS = ('10.0.0.72', '192.168.19', 'ai.ticrcorp.com')


def now():
    return dt.datetime.now(dt.timezone.utc)


def iso(t=None):
    return (t or now()).strftime('%Y-%m-%dT%H:%M:%SZ')


def ex(p):
    return os.path.expanduser(p)


class Wait(Exception):
    """the phase cannot move now (GPU busy, a job running, a referee pending): try again next tick"""


class Fail(Exception):
    """the phase failed: the round stops here and the report says why (a person decides)"""


def phases(cfg):
    out = list(PHASES_HEAD)
    for c in cfg['candidates']:
        out += ['train:%s' % c['key'], 'export:%s' % c['key']]
    return out + PHASES_TAIL


# ---------------------------------------------------------------- pure decisions (tested in test_weekly.py)

def round_due(last_started, today, cadence_days):
    """A new round starts when there is no round yet, or the last one started >= cadence_days ago."""
    if last_started is None:
        return True
    return (today - last_started).total_seconds() >= cadence_days * 86400 - 3600


def window(newest_archived_day, window_days):
    """The round's days: the newest `window_days` sealed days ending at the newest archived day."""
    end = dt.date.fromisoformat(newest_archived_day)
    return (end - dt.timedelta(days=window_days - 1)).isoformat(), end.isoformat()


def forbid_files(cfg):
    """Every gate-set version's ids are forbidden in training: the current one and each older one (forbid_items)."""
    return [ex(cfg['eval_items'])] + [ex(f) for f in cfg.get('forbid_items') or []]


def eval_set_check(cfg):
    """The gate set the round replays and gates on must be the version the config names (eval_version + eval_sha256,
    owner 11-06: the 11-08 round reads m3-eval.v1). -> {'version', 'path', 'sha256'}; Fail on a mismatch. A config
    without a pin (rounds before v1) is reported as such, not refused."""
    p = ex(cfg['eval_items'])
    got = hashlib.sha256(open(p, 'rb').read()).hexdigest()
    want = cfg.get('eval_sha256')
    if want and got != want:
        raise Fail('gate set %s has sha256 %s, not the pinned %s (%s)' % (p, got, want, cfg.get('eval_version')))
    return {'version': cfg.get('eval_version') or 'unpinned', 'path': p, 'sha256': got}


G5_RULE = 'llpatrol-01'      # build_clean.G5_RULE; a pool or training file without this exact rule is refused


def pool_has_g5(m):
    """A POOL-MANIFEST built by a build_clean.py that applies G5 (llpatrol-01): the rule and its count are recorded."""
    return str((m.get('rules') or {}).get('G5', '')).startswith(G5_RULE + ':') and 'g_drop_patrol_lap' in (m.get('counts') or {})


def assembled_has_g5(m):
    """A train MANIFEST whose good rows build_clean re-checked against G5 (the count equals the fleet good examples)."""
    n = (m.get('filter') or {}).get('good G5 checked (%s)' % G5_RULE)
    return n is not None and n == (m.get('composition') or {}).get('good', 0)


def next_phase(state, plist):
    for p in plist:
        if state['phases'].get(p, {}).get('status') != 'done':
            return p
    return None


def gate_vs_incumbent(c, inc, g):
    """eval_offline s.4a: schema_valid >= incumbent - floor; hard <= incumbent; rep_fail <= incumbent; full coverage."""
    r = {'complete coverage': c['missing'] == 0 and inc['missing'] == 0 and c['n'] == inc['n'] and c['n'] > 0,
         'schema_valid >= incumbent - %.1f pp' % g['schema_valid_floor_pp']: c['schema_valid'] >= inc['schema_valid'] - g['schema_valid_floor_pp'],
         'hard <= incumbent': c['hard'] <= inc['hard'],
         'rep_fail <= incumbent': c['rep_fail'] <= inc['rep_fail']}
    return {'gates': r, 'pass': all(r.values())}


def gate_vs_best(c, best, g):
    """No worse than the current best within the stated tolerances (the noise of 300 / 100 / 600 items)."""
    if best is None:
        return {'gates': {'no best yet': True}, 'pass': True}
    r = {'complete coverage': c['missing'] == 0 and best['missing'] == 0 and c['n'] == best['n'] and c['n'] > 0,
         'rep_fail <= best + %.1f pp' % g['rep_fail_tol_pp']: c['rep_fail'] <= best['rep_fail'] + g['rep_fail_tol_pp'],
         'post_veto <= best + %.1f pp' % g['post_veto_tol_pp']: c['post_veto_repeat'] <= best['post_veto_repeat'] + g['post_veto_tol_pp'],
         'hard <= best + %.1f pp' % g['hard_tol_pp']: c['hard'] <= best['hard'] + g['hard_tol_pp'],
         'schema_valid >= %.0f' % g['schema_valid_min']: c['schema_valid'] >= g['schema_valid_min']}
    return {'gates': r, 'pass': all(r.values())}


def becomes_best(c, best, c_params, best_params, passed_inc, passed_best):
    """New BEST: passes both gates AND (strictly better on rep_fail + post_veto, OR <= 60% of best's parameters --
    the owner's 11-01 'a smaller model is a valid direction': equal quality at about half the prefill cost wins)."""
    if not (passed_inc and passed_best):
        return False, 'did not pass both gates'
    if best is None:
        return True, 'no best yet'
    s_c, s_b = c['rep_fail'] + c['post_veto_repeat'], best['rep_fail'] + best['post_veto_repeat']
    if s_c < s_b:
        return True, 'rep_fail + post_veto %.1f < best %.1f' % (s_c, s_b)
    if best_params and c_params and c_params <= 0.6 * best_params:
        return True, 'as good within tolerance at %.1fB vs %.1fB parameters' % (c_params, best_params)
    return False, 'within tolerance but not better (%.1f vs %.1f) and not smaller' % (s_c, s_b)


def pick_winner(winners, sc, gb):
    """winners: [(rep_fail + post_veto, params_b, alias, key)]. The lowest sum leads; a SMALLER winner (<= 60% of the
    leader's parameters) replaces it only when it passes the vs-best gate AGAINST the leader, metric by metric (Codex
    r1: a summed tolerance let a smaller model 6 pp worse on rep_fail replace the leader)."""
    w = sorted(winners)
    lead = w[0]
    small = min(w, key=lambda x: x[1])
    if small is not lead and small[1] <= 0.6 * lead[1] and gate_vs_best(sc[small[2]], sc[lead[2]], gb)['pass']:
        return small
    return lead


def drift(agree_n, n, base_pct, z_crit):
    """Referee drift: this round's local-vs-paid agreement against the pilot baseline (one-sided z, normal approx).
    -> (flag, z). A flag means the local teacher moved AWAY from the paid referees by more than chance."""
    if not n:
        return None, None
    p, p0 = agree_n / n, base_pct / 100.0
    se = math.sqrt(p0 * (1 - p0) / n)
    z = (p - p0) / se if se else 0.0
    return z < -z_crit, round(z, 2)


def latency_summary(recs, minutes, rate):
    ok = [r for r in recs if not r.get('transport_error') and r.get('schemaValid')]
    # percentiles over ALL requests (owner rule 11-02, the serving agent's stats.py): a timeout or error counts at its
    # full latency (the client timeout when the record has none), never dropped
    L = sorted((r.get('latencyMs') or TIMEOUT_MS) for r in recs)
    q = (lambda p: L[min(len(L) - 1, int(p * len(L)))] if L else None)
    done_t = [r['t_done_ms'] for r in recs if r.get('t_done_ms') is not None]
    span = max(done_t) / 60000.0 if done_t else None
    pt = sorted(r.get('prompt_tokens') or 0 for r in ok); ct = sorted(r.get('completion_tokens') or 0 for r in ok)
    cached = [((r.get('server') or {}).get('cache_n') or 0) / max(1, (r.get('server') or {}).get('prompt_n', 0) + ((r.get('server') or {}).get('cache_n') or 0)) for r in ok if r.get('server')]
    return {'rate_per_min': rate, 'n': len(recs), 'valid': len(ok), 'timeouts_or_errors': len(recs) - len(ok),
            'done_per_min': round(len(ok) / span, 1) if span else None, 'p50_ms': q(.5), 'p95_ms': q(.95), 'p99_ms': q(.99),
            'prompt_tokens_p50': pt[len(pt) // 2] if pt else None, 'completion_p50': ct[len(ct) // 2] if ct else None,
            'cached_share_mean': round(sum(cached) / len(cached), 3) if cached else None,
            # the fleet gate: p50 <= 2.5 s, p95 <= 5 s, >= 99% valid (a timeout is not valid)
            # and the run is COMPLETE: rate x minutes requests recorded, failures included (Codex r3: a truncated run
            # with one fast answer must not read as a held rate)
            'complete': len(recs) >= rate * minutes,
            'gates_p50_2500_p95_5000': bool(L) and q(.5) <= 2500 and q(.95) <= 5000 and len(ok) >= 0.99 * len(recs)
                                       and len(recs) >= rate * minutes}


TIMEOUT_MS = 45000


def sign_p(a, b):
    """Exact two-sided sign test on discordant pair counts a, b."""
    n = a + b
    if n == 0:
        return 1.0
    k = min(a, b)
    return min(1.0, 2 * sum(math.comb(n, i) for i in range(k + 1)) / 2 ** n)


def significantly_worse(disc, alpha):
    """disc: {metric: (cand_bad_best_ok, best_bad_cand_ok)}. -> {metric: {...}}; a metric is SIGNIFICANTLY WORSE when the
    candidate has more discordant failures AND the exact two-sided sign test gives p < alpha."""
    out = {}
    for m, (c, b) in disc.items():
        p = sign_p(c, b)
        out[m] = {'cand_only': c, 'best_only': b, 'p': round(p, 4), 'significantly_worse': c > b and p < alpha}
    return out


def within_gate_rate(by_rate, ladder):
    """The highest ladder rate at which the latency gates hold AND hold at every lower rung (a lucky pass above a
    failure does not count). by_rate: {rate: summary with 'gates_p50_2500_p95_5000'}. 0 = fails the lowest rung.
    None = the ladder was not measured from its first rung."""
    best = 0
    for r in sorted(ladder):
        if r not in by_rate:
            return best if best else None
        if not by_rate[r]['gates_p50_2500_p95_5000']:
            return best
        best = r
    return best


def capacity_rule(sw, cand_rate, best_rate, ladder, ratio):
    """OWNER 11-02 rule (written before round 3 was re-gated): a candidate may become BEST when it is NOT significantly
    worse than the best on hard, rep_fail and post_veto (paired sign test, p < alpha) AND serves >= ratio x the best's
    within-gate decisions/min on the fleet's serving card, same session. A best that fails the lowest rung counts as
    that rung (conservative: its true rate is lower). -> (ok, why)."""
    worse = [m for m, v in sw.items() if v['significantly_worse']]
    if worse:
        return False, 'significantly worse than best on %s' % worse
    if cand_rate is None or best_rate is None:
        return False, 'within-gate rate not measured (cand %s, best %s)' % (cand_rate, best_rate)
    floor = min(ladder)
    ref = best_rate if best_rate > 0 else floor
    if cand_rate >= ratio * ref and cand_rate > 0:
        return True, 'not significantly worse on any of %s, and %s/min within the gates vs best %s/min (>= %.1fx%s)' % (
            sorted(sw), cand_rate, best_rate, ratio, '' if best_rate else '; best fails the lowest rung %s/min' % floor)
    return False, 'capacity %s/min < %.1f x best %s/min' % (cand_rate, ratio, ref)


# ---------------------------------------------------------------- plumbing

def sh(cmd, check=True, timeout=None, **kw):
    r = subprocess.run(cmd, shell=isinstance(cmd, str), capture_output=True, text=True, timeout=timeout, **kw)
    if check and r.returncode != 0:
        raise Fail('command failed (%d): %s\n%s' % (r.returncode, cmd if isinstance(cmd, str) else ' '.join(cmd), (r.stdout + r.stderr)[-1500:]))
    return r


def gpu(*args, stdin=None, check=True, timeout=600):
    """llgpu.sh on the 3090 through the restricted key (forced command: only its verbs exist)."""
    cmd = ['ssh', '-i', GPU_KEY, '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', GPU_HOST] + [str(a) for a in args]
    r = subprocess.run(cmd, input=stdin, capture_output=True, text=not isinstance(stdin, bytes), timeout=timeout)
    out = r.stdout if isinstance(r.stdout, str) else r.stdout.decode()
    if r.returncode == 75:
        raise Wait('GPU busy: %s' % out.strip()[:300])
    if check and r.returncode != 0:
        err = r.stderr if isinstance(r.stderr, str) else r.stderr.decode()
        raise Fail('llgpu %s failed (%d): %s %s' % (' '.join(map(str, args)), r.returncode, out[-800:], err[-400:]))
    return out


def claim(phase):
    gpu('claim', HOLDER, phase.replace(':', '-'))


def release():
    gpu('release', HOLDER, check=False)


def alive(pidfile):
    try:
        os.kill(int(open(pidfile).read().strip()), 0)
        return True
    except (OSError, ValueError):
        return False


def spawn(cmd, log, pidfile, env=None):
    with open(log, 'a') as fh:
        p = subprocess.Popen(cmd, shell=True, stdout=fh, stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL,
                             start_new_session=True, env=dict(os.environ, **(env or {})))
    open(pidfile, 'w').write(str(p.pid))
    return p.pid


def lines(p):
    return [json.loads(l) for l in open(p) if l.strip()]


def answered(out, ids):
    got = {}
    if os.path.exists(out):
        for l in open(out):
            if l.strip():
                try:
                    r = json.loads(l)
                except ValueError:
                    continue
                got[r['id']] = r
    return {i for i, r in got.items() if not r.get('transport_error')} & set(ids)


class Round:
    def __init__(self, rid):
        self.id = rid; self.dir = os.path.join(ROUNDS, rid)
        self.state = json.load(open(os.path.join(self.dir, 'state.json')))
        self.cfg = json.load(open(os.path.join(self.dir, 'config.json')))

    def p(self, *a):
        return os.path.join(self.dir, *a)

    def save(self):
        tmp = self.p('state.json.tmp'); json.dump(self.state, open(tmp, 'w'), indent=1); os.replace(tmp, self.p('state.json'))

    def log(self, msg):
        with open(self.p('round.log'), 'a') as fh:
            fh.write('%s %s\n' % (iso(), msg))
        print(msg, flush=True)

    def mark(self, ph, status, **kw):
        e = self.state['phases'].setdefault(ph, {})
        if status == 'waiting' and e.get('status') != 'waiting':
            e['waiting_since'] = iso()
        if status != 'waiting':
            e.pop('waiting_since', None)
        e.update(kw); e['status'] = status; e['at'] = iso()
        self.save()


def code_dir():
    return LL


def scripts_root():
    return os.path.dirname(LL)


# ---------------------------------------------------------------- phases

def ph_harvest(R):
    hb = json.load(open(os.path.join(HOME, 'heartbeat.json')))
    if hb.get('status') != 'ok':
        raise Wait('the nightly archive heartbeat is %s (%s): harvest waits for a clean archive' % (hb.get('status'), hb.get('error')))
    a, b = window(hb['newest_archived_day'], R.cfg['window_days'])
    name = 'w' + b.replace('-', '')
    out = os.path.join(HOME, 'datasets', name)
    if not os.path.exists(os.path.join(out, 'MANIFEST.json')):
        sh(['nice', '-n', '19', sys.executable, '-B', os.path.join(LL, 'build_dataset.py'), '--name', name, '--days', '%s..%s' % (a, b),
            '--new-days', str(R.cfg['new_days']), '--heldout', ','.join(R.cfg['heldout_worlds'])], timeout=7200)
    m = json.load(open(os.path.join(out, 'MANIFEST.json')))
    if sorted(m['heldout']['worlds']) != sorted(R.cfg['heldout_worlds']):
        raise Fail('dataset %s held out %s, not the gate set worlds %s' % (name, m['heldout']['worlds'], R.cfg['heldout_worlds']))
    tg = m['train_good']['kept']
    if tg < 10000:
        raise Fail('only %d train-good decisions in %s..%s: a broken harvest, not a quiet week' % (tg, a, b))
    return {'dataset': out, 'days': [a, b], 'train_cell_rows': m['cells'].get('TRAIN'), 'train_good': tg}


def ph_pool(R):
    ds = R.state['phases']['harvest']['dataset']; out = R.p('data')
    if not os.path.exists(os.path.join(out, 'POOL-MANIFEST.json')):
        pc = R.cfg['pool']
        sh(['nice', '-n', '19', sys.executable, '-B', os.path.join(LL, 'build_clean.py'), 'pool', '--v0', ds, '--out', out,
            '--f-n', str(pc['f_n']), '--pv-n', str(pc['pv_n']), '--g-n', str(pc['g_n']), '--seed', str(R.state['seed'])], timeout=7200)
    m = json.load(open(os.path.join(out, 'POOL-MANIFEST.json')))
    if not pool_has_g5(m):
        raise Fail('the pool was built without the G5 patrol-lap rule (llpatrol-01): the good set would teach the idle lap')
    return {'selected': m['selected'], 'counts': m['counts'], 'g_drop_patrol_lap': m['counts']['g_drop_patrol_lap']}


def transform(R, src, dst):
    if os.path.exists(dst):
        return
    r = sh(['node', os.path.join(LL, 'prompt_transform.mjs'), ex(R.cfg['bots_dir']), src, dst + '.part'], check=False, timeout=3600)
    if r.returncode != 0:
        raise Fail('prompt_transform %s: %s' % (src, r.stderr[-600:]))
    os.replace(dst + '.part', dst)
    return r.stderr.strip()


def ph_transform(R):
    d = R.p('data'); info = {}
    for n in ('relabel-pool', 'good'):
        info[n] = transform(R, os.path.join(d, n + '.jsonl'), os.path.join(d, n + '.pc.jsonl'))
    # the shuffled teacher order (seeded): a time-boxed teacher stops on an unbiased prefix
    shuf = os.path.join(d, 'relabel-pool.pc.shuf.jsonl')
    if not os.path.exists(shuf):
        L = open(os.path.join(d, 'relabel-pool.pc.jsonl')).read().splitlines()
        random.Random(R.state['seed']).shuffle(L)
        open(shuf, 'w').write('\n'.join(L) + '\n')
    sb = R.cfg['assemble'].get('seed_buffer')
    if sb:
        bd = os.path.dirname(ex(sb['pool'])); os.makedirs(bd, exist_ok=True)
        if not os.path.exists(ex(sb['pool'])):
            transform(R, ex('~/learnloop/c2/data/v1/relabel-pool.jsonl'), ex(sb['pool']))
        if not os.path.exists(ex(sb['pilot'])):
            transform(R, ex('~/learnloop/datasets/v0/pilot-1000.jsonl'), ex(sb['pilot']))
    ev = ex(R.cfg['eval_items'])
    if not os.path.exists(ev):
        transform(R, ex(R.cfg.get('eval_items_src') or '~/learnloop/datasets/v0/m3-eval.jsonl'), ev)
    eval_set_check(R.cfg)
    return {'transform': info, 'eval_items': ev, 'eval_sha256': hashlib.sha256(open(ev, 'rb').read()).hexdigest()}


PROXY = r'''
import json, sys, urllib.request
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
UP = sys.argv[2]
class H(BaseHTTPRequestHandler):
    def _go(self, body=None):
        if body is not None and self.path.startswith("/api/chat"):
            j = json.loads(body); j["think"] = False; j.setdefault("options", {}); j["options"]["num_ctx"] = 4096; j["options"]["num_gpu"] = 999; j["keep_alive"] = "30m"; body = json.dumps(j).encode()
        req = urllib.request.Request(UP + self.path, data=body, method=self.command, headers={"Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=300) as r: code, data = r.status, r.read()
        except urllib.error.HTTPError as e: code, data = e.code, e.read()
        self.send_response(code); self.send_header("Content-Type", "application/json"); self.send_header("Content-Length", str(len(data))); self.end_headers(); self.wfile.write(data)
    def do_GET(self): self._go()
    def do_POST(self): self._go(self.rfile.read(int(self.headers.get("Content-Length", 0))))
    def log_message(self, *a): pass
ThreadingHTTPServer(("127.0.0.1", int(sys.argv[1])), H).serve_forever()
'''


def ph_teach(R):
    t = R.cfg['teacher']; d = R.p('data')
    items = R.p('data', 'teach-items.jsonl')
    if not os.path.exists(items):
        L = open(os.path.join(d, 'relabel-pool.pc.shuf.jsonl')).read().splitlines()[:t['budget_items']]
        open(items, 'w').write('\n'.join(L) + '\n')
    ids = [json.loads(l)['id'] for l in open(items) if l.strip()]
    out = R.p('data', 'labels-%s.jsonl' % t['model'].replace(':', '_').replace('.', '_'))
    pidf = R.p('teach.pid')
    if alive(pidf):
        n = len(answered(out, ids))
        raise Wait('teacher running: %d of %d labelled' % (n, len(ids)))
    if len(answered(out, ids)) >= len(ids):
        gpu('teacher-down', HOLDER, check=False); release()
        return {'labels': out, 'labelled': len(ids), 'model': t['model']}
    if R.state['phases'].get('teach', {}).get('attempts', 0) >= 3:
        raise Fail('teacher stopped 3 times before finishing (%d of %d)' % (len(answered(out, ids)), len(ids)))
    claim('teach'); gpu('teacher-up', HOLDER)
    open(R.p('proxy.py'), 'w').write(PROXY)
    port = 18460
    cmd = ('python3 %s %d %s & PX=$!; trap "kill $PX" EXIT; sleep 1; LLM_TEMPERATURE=0 nice -n 19 node %s %s %s %s http://127.0.0.1:%d %s %d'
           % (shlex.quote(R.p('proxy.py')), port, OLLAMA_URL, shlex.quote(os.path.join(LL, 'train', 'replay_client.mjs')),
              shlex.quote(ex(R.cfg['bots_dir'])), shlex.quote(items), shlex.quote(out), port, shlex.quote(t['model']), t['conc']))
    spawn(cmd, R.p('teach.log'), pidf)
    R.state['phases'].setdefault('teach', {})['attempts'] = R.state['phases'].get('teach', {}).get('attempts', 0) + 1; R.save()
    raise Wait('teacher started on %d items' % len(ids))


def ph_referee(R):
    """Write the referee sample for the Mac job. Not a gate: the paid answers arrive later (or never) and are read
    into the report. The sample carries the LOCAL label so the Mac can score agreement without pulling the pool."""
    lab = R.state['phases']['teach']['labels']; n = R.cfg['referee']['n']
    items = {json.loads(l)['id']: json.loads(l) for l in open(R.p('data', 'teach-items.jsonl')) if l.strip()}
    recs = {}
    for r in lines(lab):
        recs[r['id']] = r
    valid = sorted(i for i, r in recs.items() if r.get('schemaValid') and i in items)
    pick = random.Random(R.state['seed'] + 7).sample(valid, min(n, len(valid)))
    out = R.p('referee-sample.jsonl'); loc = R.p('referee-local.jsonl')
    with open(out, 'w') as fh, open(loc, 'w') as fl:
        for i in pick:
            fh.write(json.dumps(items[i]) + '\n'); fl.write(json.dumps(recs[i]) + '\n')
    return {'sample': out, 'local': loc, 'n': len(pick), 'note': 'the Mac referee job (referee.py) picks this up; drift is read at report time'}


def buffer_sources(R):
    """Earlier rounds' (pool, labels) pairs, newest first, up to buffer_rounds, plus the c2 seed buffer."""
    pools, labels = [], []
    rounds = sorted(d for d in os.listdir(ROUNDS) if d < R.id and os.path.exists(os.path.join(ROUNDS, d, 'state.json')))
    for rid in reversed(rounds[-R.cfg['assemble']['buffer_rounds']:]):
        st = json.load(open(os.path.join(ROUNDS, rid, 'state.json')))
        t = st['phases'].get('teach', {})
        if t.get('status') == 'done':
            pools.append(os.path.join(ROUNDS, rid, 'data', 'teach-items.jsonl')); labels.append(t['labels'])
    sb = R.cfg['assemble'].get('seed_buffer')
    if sb:
        pools += [ex(sb['pool']), ex(sb['pilot'])]; labels += [ex(x) for x in sb['labels']]
    return pools, labels


def ph_assemble(R):
    a = R.cfg['assemble']; d = R.p('data'); name = 'train-%s.jsonl' % R.id
    if not os.path.exists(os.path.join(d, name + '.MANIFEST.json')):
        bp, bl = buffer_sources(R)
        cmd = [sys.executable, '-B', os.path.join(LL, 'build_clean.py'), 'assemble', '--out', d, '--name', name,
               '--pool-file', R.p('data', 'teach-items.jsonl'), '--good-file', os.path.join(d, 'good.pc.jsonl'),
               '--labels', R.state['phases']['teach']['labels'], '--local-model', R.cfg['teacher']['model'],
               '--good-n', str(a['good_n']), '--relabel-n', str(a['relabel_n']), '--max-skill-share', str(a['max_skill_share']),
               '--seed', str(R.state['seed']), '--forbid-ids'] + forbid_files(R.cfg)
        if bp:
            cmd += ['--buffer-pool'] + bp + ['--buffer-labels'] + bl
        sh(cmd, timeout=3600)
    m = json.load(open(os.path.join(d, name + '.MANIFEST.json')))
    # the file's own assertions, re-checked here (the c2 report's s.2 list): no paid row, no gate id, no held-out world
    ev = {json.loads(l)['id'] for f in forbid_files(R.cfg) for l in open(f) if l.strip()}
    bad = collections.Counter()
    for r in lines(os.path.join(d, name)):
        bad['paid'] += (r.get('provenance') or '').startswith('teacher-paid:')
        bad['gate id'] += r['id'] in ev
        bad['held-out world'] += r.get('world') in set(R.cfg['heldout_worlds'])
        bad['old layout (identity in system)'] += 'You are %s, an autonomous' % r.get('bot', '\0') in r['system']
    if any(bad.values()):
        raise Fail('training file assertions failed: %s' % dict(bad))
    if not assembled_has_g5(m):
        raise Fail('the training file was assembled without the %s re-check of its good rows' % G5_RULE)
    return {'file': os.path.join(d, name), 'sha256': m['sha256'], 'examples': m['examples'], 'composition': m['composition'],
            'provenance': m['provenance'], 'assertions': dict(bad)}


def run_name(R, key):
    return '%s-%s' % (R.id, key)


def ph_train(R, key):
    c = next(x for x in R.cfg['candidates'] if x['key'] == key)
    run = run_name(R, key)
    st = gpu('job', run, 'train').strip().splitlines()[0]
    if st == 'running':
        raise Wait('training %s' % run)
    if st == 'done':
        m = json.loads(gpu('get', run, 'metrics.json'))
        release()
        return {'run': run, 'metrics': {k: m.get(k) for k in ('examples_used', 'dropped_too_long', 'steps', 'train_wall_s', 'tokens_per_s_timed',
                                                               'peak_vram_allocated_gib', 'loss_first5', 'loss_last5', 'grad_norm', 'verdict', 'quant', 'base')}}
    if st == 'failed':
        release(); raise Fail('training %s failed: %s' % (run, ' '.join(gpu('job', run, 'train').splitlines()[1:])[-600:]))
    claim('train-' + key)
    gpu('put-eval', stdin=open(ex(R.cfg['eval_items']), 'rb').read())
    f = R.state['phases']['assemble']['file']
    sha = gpu('put', run, stdin=open(f, 'rb').read(), check=False).strip()
    if 'exists' not in sha and sha != R.state['phases']['assemble']['sha256']:
        raise Fail('put %s: sha256 %s != %s' % (run, sha, R.state['phases']['assemble']['sha256']))
    gpu('train', HOLDER, run, c['base'], c['quant'])
    raise Wait('training %s started' % run)


def ph_export(R, key):
    c = next(x for x in R.cfg['candidates'] if x['key'] == key)
    run = run_name(R, key)
    out = {}
    jobs = [('export-q8_0', ('export', HOLDER, run, c['base'], 'q8_0'), run),
            ('convert-q8_0', ('convert-base', HOLDER, c['base'], 'q8_0'), 'base-' + c['base'])]
    if c.get('export_check'):
        # owner A1 (c2): the q8_0 that would ship must choose the same skill as its bf16 on >= 97% of items
        jobs.append(('export-bf16', ('export', HOLDER, run, c['base'], 'bf16'), run))
    for kind, args, need in jobs:
        st = gpu('job', need, kind).strip().splitlines()[0]
        if st == 'running':
            raise Wait('%s %s running' % (kind, need))
        if st == 'failed':
            raise Fail('%s %s failed: %s' % (kind, need, gpu('job', need, kind)[-600:]))
        if st == 'none':
            have = gpu('models')
            target = ('run:%s/cand-%s.gguf' % (run, kind.split('-', 1)[1])) if kind.startswith('export') else ('run:base-%s/base-q8_0.gguf' % c['base'])
            if target in have.split():
                out[kind] = target; continue
            gpu(*args)                      # CPU only on the 3090 host: no GPU claim
            raise Wait('%s %s started' % (kind, need))
        out[kind] = ('run:%s/cand-%s.gguf' % (run, kind.split('-', 1)[1])) if kind.startswith('export') else ('run:base-%s/base-q8_0.gguf' % c['base'])
    return {'cand_model': out['export-q8_0'], 'base_model': out['convert-q8_0'], 'bf16_model': out.get('export-bf16')}


def registry():
    if os.path.exists(REGISTRY):
        return json.load(open(REGISTRY))
    return {'best': None, 'history': []}


def model_list(R):
    """(alias, llgpu model key, role, params_b) for the replay."""
    reg = registry()
    L = [(R.cfg['incumbent']['name'].replace(':', '-'), R.cfg['incumbent']['model_key'], 'incumbent', 7.0)]
    if reg.get('best'):
        L.append((reg['best']['alias'], reg['best']['model_key'], 'best', reg['best'].get('params_b')))
    for c in R.cfg['candidates']:
        e = R.state['phases']['export:%s' % c['key']]
        L.append(('%s-%s' % (R.id, c['key']), e['cand_model'], 'candidate:%s' % c['key'], c['params_b']))
        L.append(('base-%s-q8' % c['base'], e['base_model'], 'base:%s' % c['key'], c['params_b']))
        if e.get('bf16_model'):
            L.append(('%s-%s-bf16' % (R.id, c['key']), e['bf16_model'], 'bf16:%s' % c['key'], c['params_b']))
    seen, out = set(), []
    for x in L:
        if x[0] not in seen:
            seen.add(x[0]); out.append(x)
    return out


def batchload(R, alias, items, out, mode, param, n, temperature, api='oai', bots_dir=None, offset=0):
    env = {'LLM_TEMPERATURE': str(temperature)}
    cmd = ['nice', '-n', '10', 'node', os.path.join(scripts_root(), 'host', 'batchload.mjs'), ex(bots_dir or R.cfg['bots_dir']), items, out,
           GPU_URL, alias, mode, str(param), str(n), str(offset), api]
    r = subprocess.run(cmd, capture_output=True, text=True, env=dict(os.environ, **env), timeout=7200)
    open(out + '.log', 'w').write(r.stdout + r.stderr)
    if r.returncode != 0:
        raise Fail('batchload %s %s: %s' % (alias, mode, r.stderr[-600:]))


def ph_replay(R):
    eval_set_check(R.cfg)
    items = ex(R.cfg['eval_items']); ids = [json.loads(l)['id'] for l in open(items) if l.strip()]
    os.makedirs(R.p('replay'), exist_ok=True)
    todo = [m for m in model_list(R) if len(answered(R.p('replay', m[0] + '.jsonl'), ids)) < len(ids)]
    if todo:
        claim('replay')
        for alias, key, role, _ in todo:
            out = R.p('replay', alias + '.jsonl')
            if os.path.exists(out):
                os.replace(out, out + '.incomplete-%d' % int(time.time()))
            R.log('replay %s (%s) %s' % (alias, role, key))
            gpu('serve', HOLDER, key, alias, timeout=900)
            batchload(R, alias, items, out, 'closed', R.cfg['replay']['conc'], len(ids), 0)
            got = len(answered(out, ids))
            if got < len(ids):
                raise Fail('replay %s answered %d of %d (transport errors are not scored)' % (alias, got, len(ids)))
        gpu('unserve', HOLDER, check=False); release()
    return {'models': [{'alias': a, 'key': k, 'role': r, 'params_b': p} for a, k, r, p in model_list(R)], 'items': len(ids)}


def ph_latency(R):
    if R.cfg['latency'].get('ladder'):
        return ph_latency_ladder(R)
    lc = R.cfg['latency']; items = ex(R.cfg['eval_items'])
    want = [m for m in model_list(R) if m[2].startswith('candidate') or (m[2] in ('best', 'incumbent') and m[2] in lc['models'])]
    os.makedirs(R.p('latency'), exist_ok=True)
    res = R.state['phases'].get('latency', {}).get('partial', {})
    pending = [(m, rate) for m in want for rate in lc['rates'] if '%s@%d' % (m[0], rate) not in res]
    if pending:
        claim('latency')
        for (alias, key, role, _), rate in pending:
            out = R.p('latency', '%s-r%d.jsonl' % (alias, rate))
            gpu('serve', HOLDER, key, alias, timeout=900)          # restarted before every run: no cache carried over
            batchload(R, alias, items, out, 'open', rate, rate * lc['minutes'], 0.7)
            s = latency_summary(lines(out), lc['minutes'], rate); s['role'] = role
            res['%s@%d' % (alias, rate)] = s
            R.state['phases'].setdefault('latency', {})['partial'] = res; R.save()
            R.log('latency %s @%d/min: p50 %s p95 %s valid %d/%d done/min %s' % (alias, rate, s['p50_ms'], s['p95_ms'], s['valid'], s['n'], s['done_per_min']))
        gpu('unserve', HOLDER, check=False); release()
    return {'partial': res, 'ethan_note': 'ethan-gpu shares the 3090: absolute numbers are pessimistic; compare models within the run'}


def ph_latency_ladder(R):
    """OWNER 11-02 capacity measurement: per model, ascending rungs of the ladder until the first rung that fails the
    gates (p50 <= 2.5 s, p95 <= 5 s over ALL requests, every request valid). Method = the serving agent's
    (serving-A-2026-11-01 drive.sh): server restarted before every rung (cold cache), open-loop Poisson for `minutes`,
    LIVE promptcache-layout items with the 80 real bot names, the bots' own oai+ client (batchload api native)."""
    lc = R.cfg['latency']; L = lc['ladder']
    if lc.get('card_rates'):
        # the fleet's serving card is not the loop's own GPU: its within-gate rates come from ladder runs measured ON
        # that card (card_rates.py, same functions), pinned by file hashes. No GPU use here.
        ev = json.load(open(ex(lc['card_rates'])))
        rungs = ev['ladder']                               # the card's ONE ladder (card_rates.py refuses a mixed one)
        return {'within_gate_rate': ev['rates'], 'ladder_used': rungs, 'card': ev['card'], 'method': 'card evidence (%s)' % ev['measured_by'],
                'evidence': ex(lc['card_rates']), 'evidence_sha256': hashlib.sha256(open(ex(lc['card_rates']), 'rb').read()).hexdigest(),
                'cannot': ev.get('cannot')}
    want = [m for m in model_list(R) if m[2].startswith('candidate') or (m[2] in ('best', 'incumbent') and m[2] in lc['models'])]
    os.makedirs(R.p('latency'), exist_ok=True)
    res = R.state['phases'].get('latency', {}).get('ladder_runs', {})
    def todo(alias):
        got = res.get(alias, {})
        for r in sorted(L):
            if str(r) not in got:
                return r
            if not got[str(r)]['gates_p50_2500_p95_5000']:
                return None
        return None
    if any(todo(m[0]) is not None for m in want):
        claim('latency')
        for alias, key, role, _ in want:
            off = 0                                            # every model sees the SAME items at each rung (Claude r1)
            while True:
                r = todo(alias)
                if r is None:
                    break
                out = R.p('latency', '%s-L%d.jsonl' % (alias, r))
                gpu('serve', HOLDER, key, alias, timeout=900)          # cold cache before every rung
                n = r * lc['minutes']
                batchload(R, alias, ex(lc['ladder_items']), out, 'open', r, n, 0.7, api='native', bots_dir=lc['ladder_bots_dir'], offset=off)
                off = (off + n) % 800
                sm = latency_summary(lines(out), lc['minutes'], r); sm['role'] = role
                res.setdefault(alias, {})[str(r)] = sm
                R.state['phases'].setdefault('latency', {})['ladder_runs'] = res; R.save()
                R.log('ladder %s @%d/min: p50 %s p95 %s valid %d/%d -> %s' % (alias, r, sm['p50_ms'], sm['p95_ms'], sm['valid'], sm['n'],
                                                                            'pass' if sm['gates_p50_2500_p95_5000'] else 'FAIL'))
        gpu('unserve', HOLDER, check=False); release()
    rates = {a: within_gate_rate({int(k): v for k, v in res.get(a, {}).items()}, L) for a, _, _, _ in want}
    return {'ladder_runs': res, 'within_gate_rate': rates, 'ladder_used': L, 'card': lc.get('card'), 'method': 'ladder, serving-A method'}


def disc_counts(items, cand, best, S):
    """Paired discordant counts (cand bad & best ok, best bad & cand ok) for hard (all items), rep_fail (fail items),
    post_veto (post-veto items)."""
    out = {'hard': [0, 0], 'rep_fail': [0, 0], 'post_veto': [0, 0]}
    for it in items:
        x, y = cand.get(it['id']) or {}, best.get(it['id']) or {}
        def flags(r):
            p = r.get('proposal') or {}; sk, args = p.get('skill'), p.get('args') or {}
            v = bool(r.get('schemaValid'))
            h = bool(S.check_action(sk, args, S.facts(it['user']))[0]) if v else False
            rf = v and it['eval_kind'] == 'fail' and S.key_of(sk, args) == S.key_of(it['logged']['skill'], it['logged']['args'])
            pv = v and it['eval_kind'] == 'post_veto' and S.key_of(sk, args) == S.key_of(it['vetoed'][0], it['vetoed'][1])
            return {'hard': h, 'rep_fail': rf, 'post_veto': pv}
        fx, fy = flags(x), flags(y)
        for m in out:
            out[m][0] += fx[m] and not fy[m]; out[m][1] += fy[m] and not fx[m]
    return {m: tuple(v) for m, v in out.items()}


def ph_gate(R):
    import eval_offline as E
    import bar_c2 as B
    g = R.cfg['gates']; es = eval_set_check(R.cfg); items = E.load(ex(R.cfg['eval_items']))
    models = model_list(R)
    sc, recs = {}, {}
    for alias, key, role, params in models:
        p = R.p('replay', alias + '.jsonl')
        recs[alias] = B.last_by_id(p); sc[alias] = E.table(E.score_one(items, E.load(p)))
    lg = E.table(E.score_one(items)); ic = (lg['hard_on_fail_items'] or 0) > (lg['hard_on_good_items'] or 0)
    inc = next(a for a, _, r, _ in models if r == 'incumbent')
    best = next((a for a, _, r, _ in models if r == 'best'), None)
    reg = registry(); best_params = (reg.get('best') or {}).get('params_b')
    out = {'instrument_check_ok': ic, 'scores': sc, 'logged': lg, 'candidates': {}, 'eval_set': es}
    if not ic:
        raise Fail('instrument check failed: hard does not fire more on the logged failure items than on good items')
    import collections as Co
    def mix(rr):
        o = {}
        for kind in ('good', 'fail', 'post_veto'):
            c = Co.Counter((rr.get(i['id'], {}).get('proposal') or {}).get('skill') for i in items if i['eval_kind'] == kind)
            n = sum(c.values()) or 1
            o[kind] = {k: round(100.0 * v / n, 1) for k, v in c.most_common(5)}
        return o
    out['skill_mix'] = {a: mix(recs[a]) for a, _, _, _ in models}
    winners = []
    for alias, key, role, params in models:
        if not role.startswith('candidate'):
            continue
        ck = role.split(':', 1)[1]
        base = next(a for a, _, r, _ in models if r == 'base:%s' % ck)
        vi = gate_vs_incumbent(sc[alias], sc[inc], g['vs_incumbent'])
        vb = gate_vs_best(sc[alias], sc[best] if best else None, g['vs_best'])
        nb, why = becomes_best(sc[alias], sc[best] if best else None, params, best_params, vi['pass'], vb['pass'])
        cap = None
        crule = g.get('capacity_rule')
        if not nb and crule and best and vi['pass'] and sc[alias]['schema_valid'] >= g['vs_best']['schema_valid_min']:
            sw = significantly_worse(disc_counts(items, recs[alias], recs[best], E.S), crule['alpha'])
            lat = R.state['phases'].get('latency') or {}
            wr = lat.get('within_gate_rate') or {}
            ok, cwhy = capacity_rule(sw, wr.get(alias), wr.get(best), lat.get('ladder_used') or R.cfg['latency'].get('ladder') or [1], crule['ratio'])
            cap = {'significance': sw, 'within_gate_rate': {'cand': wr.get(alias), 'best': wr.get(best)}, 'pass': ok, 'why': cwhy,
                   'card': lat.get('card'), 'method': lat.get('method'), 'evidence': lat.get('evidence'), 'rule': crule}
            if ok:
                nb, why = True, 'CAPACITY RULE (owner 11-02): ' + cwhy
        out['candidates'][alias] = {'key': key, 'params_b': params, 'vs_incumbent': vi, 'vs_best': vb, 'new_best': nb, 'why': why,
                                    'capacity_rule': cap,
                                    'paired_vs_base': B.paired(items, recs[alias], recs[base]),
                                    'paired_vs_best': B.paired(items, recs[alias], recs[best]) if best else None,
                                    'paired_vs_incumbent': B.paired(items, recs[alias], recs[inc]),
                                    'export_check_q8_vs_bf16': (E.export_check(E.load(R.p('replay', alias + '.jsonl')), E.load(R.p('replay', '%s-bf16.jsonl' % alias)), [i['id'] for i in items])
                                                                if os.path.exists(R.p('replay', '%s-bf16.jsonl' % alias)) else None),
                                    'training_effect_vs_own_base': {k: (sc[alias][k], sc[base][k]) for k in ('hard', 'rep_fail', 'post_veto_repeat', 'agree_skill')}}
        ec = out['candidates'][alias]['export_check_q8_vs_bf16']
        if ec is not None and not ec['pass']:
            nb = False; out['candidates'][alias]['new_best'] = False; out['candidates'][alias]['why'] = 'export check failed (q8_0 vs bf16)'
        if nb:
            winners.append((sc[alias]['rep_fail'] + sc[alias]['post_veto_repeat'], params, alias, key))
    if winners:
        s, params, alias, key = pick_winner(winners, sc, g['vs_best'])
        prev = reg.get('best')
        reg['history'].append({'at': iso(), 'round': R.id, 'from': prev, 'to': alias})
        reg['best'] = {'alias': alias, 'model_key': key, 'params_b': params, 'round': R.id, 'scores': sc[alias], 'eval_set': es}
        tmp = REGISTRY + '.tmp'; json.dump(reg, open(tmp, 'w'), indent=1); os.replace(tmp, REGISTRY)
        out['new_best'] = alias
    else:
        out['new_best'] = None
    json.dump(out, open(R.p('gate.json'), 'w'), indent=1)
    return {'new_best': out['new_best'], 'gate': R.p('gate.json')}


def ph_register(R):
    """PREPARE a HELD model-env entry for the new best (never queue-add or launch here: config register.queue_add)."""
    nb = R.state['phases']['gate'].get('new_best')
    if not nb:
        return {'prepared': None, 'why': 'no new best this round'}
    reg = registry()['best']
    entry = {'run': 'll%s-01' % R.id.replace('-', '')[2:], 'class': 'model-env', 'after': [], 'not_before': None,
             'hold': 'PREPARED BY THE WEEKLY LEARNING LOOP, NOT LAUNCHED (round %s). Model %s (%s) passed the replay gates '
                     '(%s). BEFORE RELEASE: a serving host for it (llama-server oai+ path or Ollama), its template check on '
                     'that server, a capacity test at the stage rate, an empty-tree marker on the fleet tip, then weekly.py '
                     'register --round %s --marker <sha> and a human queue release.' % (R.id, nb, reg['model_key'], R.p('gate.json'), R.id),
             'note': 'learning-loop weekly round %s; scores %s' % (R.id, json.dumps({k: reg['scores'][k] for k in ('schema_valid', 'hard', 'rep_fail', 'post_veto_repeat')})),
             'variants': {}}
    json.dump(entry, open(R.p('queue-entry.HELD.json'), 'w'), indent=1)
    return {'prepared': R.p('queue-entry.HELD.json'), 'run': entry['run'], 'queue_add': bool(R.cfg['register'].get('queue_add'))}


def referee_result(R):
    p = R.p('referee-result.json')
    if not os.path.exists(p):
        return None
    r = json.load(open(p)); rc = R.cfg['referee']
    for arm, key in (('B', 'local_vs_B_skill_pct'), ('C', 'local_vs_C_skill_pct')):
        a = (r.get('agreement') or {}).get(arm)
        if a and a.get('n'):
            a['drift_flag'], a['z_vs_pilot'] = drift(a['same_skill'], a['n'], rc['baseline'][key], rc['drift_z'])
    return r


def write_report(R):
    st = R.state; L = ['# Learning loop weekly round %s' % R.id, '',
                       '_Generated %s by scripts/learnloop/weekly/weekly.py on 10.0.0.31. State: `%s`._' % (iso(), R.p('state.json')), '']
    L.append('| phase | status | when | note |'); L.append('|---|---|---|---|')
    for p in phases(R.cfg):
        e = st['phases'].get(p, {})
        note = e.get('wait') or e.get('error') or ''
        L.append('| %s | %s | %s | %s |' % (p, e.get('status', 'pending'), e.get('at', ''), str(note).replace('|', '/')[:160]))
    a = st['phases'].get('assemble', {})
    if a.get('status') == 'done':
        L += ['', '**Training set** `%s`: %d examples, composition %s, provenance %s, sha256 %s.' % (
            os.path.basename(a['file']), a['examples'], a['composition'], a['provenance'], a['sha256'][:12])]
    gp = R.p('gate.json')
    if os.path.exists(gp):
        G = json.load(open(gp))
        L += ['', '## Replay (600 items, promptcache layout, llama-server b12020, fleet client, T=0)', '',
              '| model | schema | hard | rep_fail | post_veto | agree skill | agree key |', '|---|---|---|---|---|---|---|']
        for m, s in G['scores'].items():
            L.append('| %s | %s | %s | %s | %s | %s | %s |' % (m, s['schema_valid'], s['hard'], s['rep_fail'], s['post_veto_repeat'], s['agree_skill'], s['agree_key']))
        for c, v in G['candidates'].items():
            L += ['', '- **%s**: vs incumbent %s; vs best %s; new best: %s (%s)' % (
                c, 'PASS' if v['vs_incumbent']['pass'] else 'FAIL %s' % [k for k, x in v['vs_incumbent']['gates'].items() if not x],
                'PASS' if v['vs_best']['pass'] else 'FAIL %s' % [k for k, x in v['vs_best']['gates'].items() if not x], v['new_best'], v['why'])]
        L += ['', 'New best: **%s**.' % G.get('new_best')]
    lat = st['phases'].get('latency', {}).get('partial')
    if lat:
        L += ['', '## Latency (open loop, 3 min per rate, llama-server -np 8, beside ethan-gpu)', '',
              '| model@rate | valid/n | done/min | p50 ms | p95 ms | cached | gates |', '|---|---|---|---|---|---|---|']
        for k, s in lat.items():
            L.append('| %s | %d/%d | %s | %s | %s | %s | %s |' % (k, s['valid'], s['n'], s['done_per_min'], s['p50_ms'], s['p95_ms'], s['cached_share_mean'], 'PASS' if s['gates_p50_2500_p95_5000'] else 'fail'))
    rr = referee_result(R)
    L += ['', '## Referee (paid, evaluation only)', '']
    if rr:
        for arm, a in (rr.get('agreement') or {}).items():
            if arm == 'B_vs_C':
                L.append('- paid vs paid (Claude vs GPT): same skill %s/%s (%s%%; pilot 72.5%%)' % (a.get('same_skill'), a.get('n'), a.get('same_skill_pct')))
                continue
            L.append('- arm %s: local vs paid same skill %s/%s (pilot baseline %s); drift flag %s (z %s); cost $%s' % (
                arm, a.get('same_skill'), a.get('n'), R.cfg['referee']['baseline'].get('local_vs_%s_skill_pct' % arm), a.get('drift_flag'), a.get('z_vs_pilot'), a.get('usd')))
    else:
        L.append('- pending: the Mac referee job has not returned a result for this round')
    txt = '\n'.join(L) + '\n'
    open(R.p('REPORT.md'), 'w').write(txt)
    shutil.copy(R.p('REPORT.md'), os.path.join(HOME, 'weekly-latest.md'))
    return txt


def ph_report(R):
    write_report(R)
    return {'report': R.p('REPORT.md')}


def run_phase(R, ph):
    if ph.startswith('train:'):
        return ph_train(R, ph.split(':', 1)[1])
    if ph.startswith('export:'):
        return ph_export(R, ph.split(':', 1)[1])
    return globals()['ph_' + ph](R)


def current_round():
    if not os.path.isdir(ROUNDS):
        return None
    open_ = []
    for d in sorted(os.listdir(ROUNDS)):
        sp = os.path.join(ROUNDS, d, 'state.json')
        if os.path.exists(sp) and json.load(open(sp)).get('status') == 'open':
            open_.append(d)
    if len(open_) > 1:
        raise SystemExit('REFUSED: %d open rounds %s' % (len(open_), open_))
    return Round(open_[0]) if open_ else None


def new_round(rid=None, cfg_path=None):
    os.makedirs(ROUNDS, exist_ok=True)
    if current_round():
        raise SystemExit('REFUSED: a round is open')
    rid = rid or now().strftime('%Y%m%d')
    d = os.path.join(ROUNDS, rid)
    if os.path.exists(d):
        raise SystemExit('REFUSED: round %s exists' % rid)
    os.makedirs(d)
    cfg = json.load(open(cfg_path or os.path.join(os.path.dirname(scripts_root()), 'config', 'learnloop-weekly.json')))
    json.dump(cfg, open(os.path.join(d, 'config.json'), 'w'), indent=1)
    st = {'id': rid, 'status': 'open', 'started': iso(), 'seed': int(rid.replace('-', '')[:8]) if rid[:8].isdigit() else 20261101,
          'code_version': open(os.path.join(LL, 'VERSION')).read().strip() if os.path.exists(os.path.join(LL, 'VERSION')) else None, 'phases': {}}
    json.dump(st, open(os.path.join(d, 'state.json'), 'w'), indent=1)
    return Round(rid)


def advance(R, max_steps=50):
    for _ in range(max_steps):
        ph = next_phase(R.state, phases(R.cfg))
        if ph is None:
            R.state['status'] = 'closed'; R.state['closed'] = iso(); R.save(); write_report(R)
            R.log('round closed'); return 'closed'
        try:
            res = run_phase(R, ph)
            R.mark(ph, 'done', **(res or {}))
            R.state['phases'][ph].pop('wait', None); R.save()
            R.log('%s done' % ph)
        except Wait as w:
            R.mark(ph, 'waiting', wait=str(w)); R.log('%s waits: %s' % (ph, w)); write_report(R); return 'wait'
        except Fail as f:
            R.mark(ph, 'failed', error=str(f)[:2000]); R.state['status'] = 'failed'; R.save()
            R.log('%s FAILED: %s' % (ph, f)); write_report(R)
            try:
                release()
            except Exception:
                pass
            return 'failed'
    return 'steps'


def rescore_models(cfg, reg, also):
    """(alias, model key, role) to re-score on a new gate-set version: the incumbent, the registry best, extras."""
    L = [(cfg['incumbent']['name'].replace(':', '-'), cfg['incumbent']['model_key'], 'incumbent')]
    if reg.get('best'):
        L.append((reg['best']['alias'], reg['best']['model_key'], 'best'))
    for x in also:
        al, key = x.split('=', 1)
        L.append((al, key, 'extra'))
    seen, out = set(), []
    for m in L:
        if m[0] not in seen:
            seen.add(m[0]); out.append(m)
    return out


def rescore(cfg_path, also):
    """Fresh baselines on the CONFIG'S gate set (owner 11-06): replay incumbent + best (+ extras) exactly as ph_replay does
    (llama-server on the 3090 through llgpu.sh, fleet client, T=0, conc from config), score with eval_offline, and record
    them in the registry under eval_baselines[<eval_version>] (the older versions' scores stay). Refused while a round is
    open (it would compete for the GPU)."""
    import eval_offline as E
    if current_round() is not None:
        raise SystemExit('REFUSED: a round is open')
    cfg = json.load(open(cfg_path or os.path.join(os.path.dirname(scripts_root()), 'config', 'learnloop-weekly.json')))
    es = eval_set_check(cfg); items = ex(cfg['eval_items']); ids = [json.loads(l)['id'] for l in open(items) if l.strip()]
    d = os.path.join(HOME, 'evals', 'rescore-%s-%s' % (es['version'], es['sha256'][:12])); os.makedirs(d, exist_ok=True)
    R = types.SimpleNamespace(cfg=cfg)
    models = rescore_models(cfg, registry(), also)
    todo = [m for m in models if len(answered(os.path.join(d, m[0] + '.jsonl'), ids)) < len(ids)]
    if todo:
        claim('rescore')
        try:
            for alias, key, role in todo:
                out = os.path.join(d, alias + '.jsonl')
                if os.path.exists(out):
                    os.replace(out, out + '.incomplete-%d' % int(time.time()))
                print('rescore %s (%s) %s' % (alias, role, key), flush=True)
                gpu('serve', HOLDER, key, alias, timeout=900)
                batchload(R, alias, items, out, 'closed', cfg['replay']['conc'], len(ids), 0)
                if len(answered(out, ids)) < len(ids):
                    raise Fail('rescore %s answered %d of %d' % (alias, len(answered(out, ids)), len(ids)))
        finally:
            gpu('unserve', HOLDER, check=False); release()
    it = E.load(items)
    sc = {alias: E.table(E.score_one(it, E.load(os.path.join(d, alias + '.jsonl')))) for alias, _, _ in models}
    res = {'at': iso(), 'eval_set': es, 'models': [{'alias': a, 'key': k, 'role': r} for a, k, r in models], 'scores': sc,
           'logged': E.table(E.score_one(it))}
    json.dump(res, open(os.path.join(d, 'scores.json'), 'w'), indent=1)
    reg = registry(); reg.setdefault('eval_baselines', {})[es['version']] = res
    tmp = REGISTRY + '.tmp'; json.dump(reg, open(tmp, 'w'), indent=1); os.replace(tmp, REGISTRY)
    print(json.dumps({a: {k: v[k] for k in ('hard', 'rep_fail', 'post_veto_repeat', 'agree_skill', 'agree_key', 'schema_valid')} for a, v in sc.items()}, indent=1))
    return 0


def last_started():
    if not os.path.isdir(ROUNDS):
        return None
    t = None
    for d in os.listdir(ROUNDS):
        sp = os.path.join(ROUNDS, d, 'state.json')
        if os.path.exists(sp):
            s = dt.datetime.strptime(json.load(open(sp))['started'], '%Y-%m-%dT%H:%M:%SZ').replace(tzinfo=dt.timezone.utc)
            t = s if t is None or s > t else t
    return t


def heartbeat(status, R=None, note=''):
    hb = {'at': iso(), 'status': status, 'round': R.id if R else None, 'note': note,
          'phase': next_phase(R.state, phases(R.cfg)) if R else None, 'best': (registry().get('best') or {}).get('alias')}
    tmp = os.path.join(HOME, 'weekly-heartbeat.json.tmp'); json.dump(hb, open(tmp, 'w'), indent=1)
    os.replace(tmp, os.path.join(HOME, 'weekly-heartbeat.json'))


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument('verb', choices=('tick', 'status', 'new', 'report', 'register', 'regate', 'rescore'))
    ap.add_argument('--id'); ap.add_argument('--round'); ap.add_argument('--marker'); ap.add_argument('--config')
    ap.add_argument('--also', nargs='*', default=[], help='rescore: extra alias=model_key pairs (e.g. cand-c2-q8=cand-c2-q8)')
    a = ap.parse_args(argv)
    os.makedirs(HOME, exist_ok=True)
    lk = open(os.path.join(HOME, 'weekly.lock'), 'w')
    try:
        fcntl.flock(lk, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        print('another weekly.py holds the lock'); return 0
    if a.verb == 'status':
        R = current_round()
        print(json.dumps({'open_round': R.id if R else None, 'state': R.state if R else None, 'registry': registry(),
                          'last_started': iso(last_started()) if last_started() else None}, indent=1)); return 0
    if a.verb == 'new':
        R = new_round(a.id, a.config); print('round', R.id, advance(R)); heartbeat('ok', R); return 0
    if a.verb == 'report':
        R = Round(a.round) if a.round else current_round(); print(write_report(R)); return 0
    if a.verb == 'regate':
        # re-decide a CLOSED round under the CURRENT written gates (owner 11-02: the capacity rule is applied to round 3
        # only through the rule as committed). The round's data, training and replay stay; latency/gate/register/report
        # are re-run with the current config's `gates` and `latency` sections. The superseded decision is kept.
        R = Round(a.round)
        if current_round() is not None:
            raise SystemExit('REFUSED: another round is open')
        # a round that PROMOTED a best cannot be re-decided here (Codex + Claude r1): its model would re-enter as `best`,
        # not as a candidate, and the earlier promotion would stand unexamined
        if (R.state['phases'].get('gate') or {}).get('new_best') or (registry().get('best') or {}).get('round') == R.id:
            raise SystemExit('REFUSED: round %s promoted a best; reconcile the registry by hand first' % R.id)
        cur = json.load(open(a.config or os.path.join(os.path.dirname(scripts_root()), 'config', 'learnloop-weekly.json')))
        old = {k: R.state['phases'].pop(k) for k in ('latency', 'gate', 'register', 'report') if k in R.state['phases']}
        R.state.setdefault('superseded', []).append({'at': iso(), 'phases': old, 'gates': R.cfg.get('gates'), 'latency': R.cfg.get('latency'),
                                                    'why': 'regate under the written rule of config version %s' % (open(os.path.join(LL, 'VERSION')).read().strip() if os.path.exists(os.path.join(LL, 'VERSION')) else '?')})
        stamp = iso().replace(':', '')
        if os.path.exists(R.p('gate.json')):
            os.replace(R.p('gate.json'), R.p('gate.superseded-%s.json' % stamp))
        if os.path.isdir(R.p('latency')):                    # the raw requests behind the superseded decision stay
            os.replace(R.p('latency'), R.p('latency.superseded-%s' % stamp))
        R.cfg['gates'] = cur['gates']; R.cfg['latency'] = cur['latency']
        json.dump(R.cfg, open(R.p('config.json'), 'w'), indent=1)
        R.state['status'] = 'open'; R.save(); R.log('REGATE: latency/gate/register/report re-run under the current written gates')
        print('round', R.id, advance(R)); heartbeat('ok', R); return 0
    if a.verb == 'rescore':
        return rescore(a.config, a.also)
    if a.verb == 'register':
        raise SystemExit('register --marker is a human step: see the HELD entry in the round dir and canary-sched.py queue add')
    R = current_round()
    if R is None:
        if round_due(last_started(), now(), json.load(open(os.path.join(os.path.dirname(scripts_root()), 'config', 'learnloop-weekly.json')))['cadence_days']):
            R = new_round()
        else:
            heartbeat('ok', None, 'idle: next round due %d days after %s' % (7, iso(last_started()))); return 0
    r = advance(R)
    heartbeat({'closed': 'ok', 'wait': 'ok', 'failed': 'failed', 'steps': 'ok'}[r], R, R.state['phases'].get(next_phase(R.state, phases(R.cfg)) or '', {}).get('wait', ''))
    return 0


if __name__ == '__main__':
    sys.exit(main())
