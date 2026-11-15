#!/usr/bin/env python3
"""Build the showcase bots' env files from a bench CONTROL bot's env. Pure core (tested).

Every policy knob is the fleet's own value (copied from the control env read through the .31 feed); only the
keys in SHOWCASE_KEYS are the showcase's, for the reasons in docs/reports/showcase-2026-10-20.md section 1.

    make_env.py --control control.env --site /srv/showcase/town-site.json --sha <40-hex> --out-dir DIR
"""
import argparse, json, os, re, sys

# 10 -> 15 bots 11-04 (ledger showcase-15bots-1103): Kite..Onyx added; test_showcase Roster keeps every copy equal
NAMES = ['Alpha', 'Bravo', 'Comet', 'Delta', 'Echo', 'Frost', 'Gale', 'Haven', 'Iris', 'Juno',
         'Kite', 'Lumen', 'Maple', 'Nova', 'Onyx']
PREFIX = 'showcase-'
LABEL = 'showcase'
BRAIN = 'http://127.0.0.1:11612'            # the VM's tunnel to the Studio's showcase proxy
BRAIN_MODEL = 'gemma4:26b'
# THE BRAIN SETTING (11-15). The showcase's model endpoint is ONE setting, read by everything that names the brain: the
# bots' env files (build_env), the start gate's health check and replay (showcase_ops.py), the replay itself
# (replay-prompts.sh) and the start's served-model share (start-bots.sh). Absent: the Studio proxy above, as designed
# 10-20. Present: the owner's word for another endpoint (11-14: the Studio went unreachable and the owner put the
# showcase on qwen2.5 at the 5080; the 15 env files were then edited by hand, every activation regenerated them to
# gemma4, and three checks of start-bots.sh still tested the Studio, so the town could not be started through it).
BRAIN_FILE = '/srv/showcase/BRAIN.json'
BRAIN_KINDS = ('proxy', 'ollama')           # proxy: showcaseproxy.py (/healthz); ollama: a plain Ollama (/api/tags)
# The only hosts a setting may name (consolidation 11-14: no new hosts, no outside model endpoints): the tunnel, the
# 5080 and the 3090. Naming a bench host is the owner's call alone, which is why a setting must say whose word it is.
BRAIN_HOSTS = ('127.0.0.1', '10.0.0.72', '10.0.0.16')
DEFAULT_BRAIN = {'url': BRAIN, 'model': BRAIN_MODEL, 'kind': 'proxy', 'owner': None}
# NO bench endpoint, ever: the 3090 (10.0.0.16) is the PRIMARY of the 20 *-d bench bots and the fallback of the rest,
# and 10.0.0.72 serves the others; showcase load there would differ between canary arms. The fallback lives on the
# Studio, inside showcaseproxy.py (design section 2).
FORBIDDEN_HOSTS = ('10.0.0.16', '10.0.0.72', '192.168.19')

# Keys the showcase sets itself. Everything else must come from the control env.
IDENTITY = ('BOT_NAME', 'LOG_DIR', 'STATE_DIR', 'VIEWER_PORT', 'MINECRAFT_HOST', 'MINECRAFT_PORT',
            'HOME_X', 'HOME_Y', 'HOME_Z', 'BOARD_X', 'BOARD_Y', 'BOARD_Z', 'WORLD_BORDER_RADIUS',
            'MEMORY_POOL', 'MEMORY_SCOPE', 'EXP_ARM', 'EXP_INSTANCE', 'EXP_BLOCK', 'RUN_ID',
            'OLLAMA_MODEL', 'OLLAMA_BASE_URLS', 'OLLAMA_BASE_URL', 'CODE_VERSION')
# Keys the control env must carry (a control env without them is not a fleet env file).
REQUIRED_POLICY = ('LLM_ENABLED', 'LLM_TIMEOUT_MS', 'LLM_DECISION_COOLDOWN_MS', 'OLLAMA_NUM_CTX',
                   'SKILL_TIMEOUT_MS', 'MINECRAFT_VERSION', 'MINECRAFT_AUTH', 'BOT_ROLE')


def brain_of(setting):
    """The brain everything uses -> {'url', 'model', 'kind', 'owner'}. Pure. setting: None (no BRAIN.json: the designed
    Studio proxy) or the parsed file. A malformed setting RAISES: a brain nobody can name is not a default."""
    if setting is None:
        return dict(DEFAULT_BRAIN)
    if not isinstance(setting, dict):
        raise ValueError(f'{BRAIN_FILE} must be a JSON object')
    url, model, kind, owner = (setting.get(k) for k in ('url', 'model', 'kind', 'owner'))
    m = re.fullmatch(r'http://(\d{1,3}(?:\.\d{1,3}){3}):(\d{2,5})', url if isinstance(url, str) else '')
    if not m:
        raise ValueError(f'{BRAIN_FILE}: url must be http://<ipv4>:<port> with no path, got {url!r}')
    if m.group(1) not in BRAIN_HOSTS:
        raise ValueError(f'{BRAIN_FILE}: {m.group(1)} is not a host the showcase may use ({", ".join(BRAIN_HOSTS)})')
    if not isinstance(model, str) or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._:-]*', model):
        raise ValueError(f'{BRAIN_FILE}: model must be a model name, got {model!r}')
    if kind not in BRAIN_KINDS:
        raise ValueError(f'{BRAIN_FILE}: kind must be one of {BRAIN_KINDS}, got {kind!r}')
    if not isinstance(owner, str) or len(owner.strip()) < 12:
        raise ValueError(f'{BRAIN_FILE}: owner must say whose word this is and when (the setting overrides the '
                         f'designed endpoint)')
    return {'url': url, 'model': model, 'kind': kind, 'owner': owner.strip()}


def load_brain(path=None):
    """brain_of() of the setting file; no file -> the designed default. A file that does not parse RAISES."""
    path = path or BRAIN_FILE
    if not os.path.exists(path):
        return brain_of(None)
    try:
        setting = json.load(open(path))
    except json.JSONDecodeError as e:
        raise ValueError(f'{path} is not JSON: {e}')
    if not isinstance(setting, dict):       # a file holding `null` is a broken setting: brain_of(None) is for NO file only
        raise ValueError(f'{path} must be a JSON object, got {type(setting).__name__}')
    return brain_of(setting)


def model_family(model):
    """'gemma4:26b' -> 'gemma4'. The served-model share counts a family (the 10-20 check counted names starting gemma4)."""
    return str(model).split(':', 1)[0]


def parse_env(text):
    out = {}
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith('#') or '=' not in line:
            continue
        k, v = line.split('=', 1)
        out[k.strip()] = v
    return out


def policy_of(control):
    """The fleet's policy knobs: the control env minus every key the showcase sets."""
    missing = [k for k in REQUIRED_POLICY if k not in control]
    if missing:
        raise ValueError(f'control env lacks {missing}: not a fleet env file (remedy: re-read the feed)')
    return {k: v for k, v in control.items() if k not in IDENTITY}


BRAIN_KEYS = ('OLLAMA_MODEL', 'OLLAMA_BASE_URLS', 'OLLAMA_BASE_URL')


def build_env(control, i, site, sha, preview=False, brain=None):
    """-> ordered list of (key, value) for bot NAMES[i]. brain: brain_of() (None = the designed Studio proxy)."""
    brain = dict(DEFAULT_BRAIN) if brain is None else brain
    if not re.fullmatch(r'[0-9a-f]{40}', sha or ''):
        raise ValueError(f'sha must be 40 hex, got {sha!r}')
    name = PREFIX + NAMES[i]
    if len(name) > 16:
        raise ValueError(f'{name} is longer than the 16-character Minecraft limit')
    pol = policy_of(control)
    home, board = site['home'], site['board']
    block = LABEL + ('-preview' if preview else '')
    mine = [
        ('BOT_NAME', name),
        ('MINECRAFT_HOST', '127.0.0.1'), ('MINECRAFT_PORT', str(site.get('port', 25565))),
        ('HOME_X', str(home[0])), ('HOME_Y', str(home[1])), ('HOME_Z', str(home[2])),
        ('BOARD_X', str(board[0])), ('BOARD_Y', str(board[1])), ('BOARD_Z', str(board[2])),
        ('WORLD_BORDER_RADIUS', str(site['border_radius'])),
        ('MEMORY_POOL', LABEL), ('MEMORY_SCOPE', 'board'),
        ('EXP_ARM', LABEL), ('EXP_INSTANCE', LABEL), ('EXP_BLOCK', block),
        ('RUN_ID', f"{block}-{sha[:8]}"),
        ('OLLAMA_MODEL', brain['model']),
        ('OLLAMA_BASE_URLS', f"{brain['url']}|{brain['model']}"),
        ('OLLAMA_BASE_URL', brain['url']),
        ('CODE_VERSION', sha),
        ('VIEWER_PORT', str(3200 + i)),
        ('LOG_DIR', f'/var/log/mcai/{name}'), ('STATE_DIR', f'/var/lib/mcai/{name}'),
    ]
    rows = sorted(pol.items()) + mine
    # The three brain keys are exempt ONLY under an owner setting (brain_of refused any host outside BRAIN_HOSTS, and
    # 192.168.19x is not one). Every other key is held to the rule as before: a bench host in a policy key still refuses.
    exempt = BRAIN_KEYS if brain.get('owner') else ()
    text = '\n'.join(f'{k}={v}' for k, v in rows if k not in exempt)
    for h in FORBIDDEN_HOSTS:
        if h in text:
            raise ValueError(f'refusing: the env would name {h} (never used by the showcase); remedy: the control '
                             f'env carries it in a key the showcase does not override -- add that key to IDENTITY')
    return rows


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--control', required=True, help='a bench control bot env file (from the feed)')
    ap.add_argument('--site', required=True, help='town-site.json (home, board, border_radius)')
    ap.add_argument('--sha', required=True)
    ap.add_argument('--out-dir', required=True)
    ap.add_argument('--preview', action='store_true')
    a = ap.parse_args()
    control = parse_env(open(a.control).read())
    site = json.load(open(a.site))
    os.makedirs(a.out_dir, exist_ok=True)
    for i, n in enumerate(NAMES):
        rows = build_env(control, i, site, a.sha, a.preview, brain=load_brain())
        p = os.path.join(a.out_dir, f'{PREFIX}{n}.env')
        with open(p + '.tmp', 'w') as f:
            f.write('\n'.join(f'{k}={v}' for k, v in rows) + '\n')
        os.replace(p + '.tmp', p)
    print(f'wrote {len(NAMES)} env files for {a.sha[:8]} to {a.out_dir}')


if __name__ == '__main__':
    sys.exit(main())
