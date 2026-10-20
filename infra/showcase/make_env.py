#!/usr/bin/env python3
"""Build the showcase bots' env files from a bench CONTROL bot's env. Pure core (tested).

Every policy knob is the fleet's own value (copied from the control env read through the .31 feed); only the
keys in SHOWCASE_KEYS are the showcase's, for the reasons in docs/reports/showcase-2026-10-20.md section 1.

    make_env.py --control control.env --site /srv/showcase/town-site.json --sha <40-hex> --out-dir DIR
"""
import argparse, json, os, re, sys

NAMES = ['Alpha', 'Bravo', 'Comet', 'Delta', 'Echo', 'Frost', 'Gale', 'Haven', 'Iris', 'Juno']
PREFIX = 'showcase-'
LABEL = 'showcase'
BRAIN = 'http://127.0.0.1:11612'            # the VM's tunnel to the Studio's showcase proxy
BRAIN_MODEL = 'gemma4:26b'
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


def build_env(control, i, site, sha, preview=False):
    """-> ordered list of (key, value) for bot NAMES[i]."""
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
        ('OLLAMA_MODEL', BRAIN_MODEL),
        ('OLLAMA_BASE_URLS', f'{BRAIN}|{BRAIN_MODEL}'),
        ('OLLAMA_BASE_URL', BRAIN),
        ('CODE_VERSION', sha),
        ('VIEWER_PORT', str(3200 + i)),
        ('LOG_DIR', f'/var/log/mcai/{name}'), ('STATE_DIR', f'/var/lib/mcai/{name}'),
    ]
    rows = sorted(pol.items()) + mine
    text = '\n'.join(f'{k}={v}' for k, v in rows)
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
        rows = build_env(control, i, site, a.sha, a.preview)
        p = os.path.join(a.out_dir, f'{PREFIX}{n}.env')
        with open(p + '.tmp', 'w') as f:
            f.write('\n'.join(f'{k}={v}' for k, v in rows) + '\n')
        os.replace(p + '.tmp', p)
    print(f'wrote {len(NAMES)} env files for {a.sha[:8]} to {a.out_dir}')


if __name__ == '__main__':
    sys.exit(main())
