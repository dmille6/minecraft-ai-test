"""Where the mayor may write, and how. (Codex review #1, 2026-10-03.)

The shadow runs ON THE BOTS' HOST. A mistyped --out-dir must not be able to append into a bot's
state or logs, so:
  - the out dir is resolved with realpath (symlinks and '..' resolved) BEFORE it is checked;
  - anything at or under the bots' trees is refused, even if an allow root contains it;
  - anything not under an allowlisted mayor dir is refused (default: /var/lib/mcai-mayor);
  - files are created with O_NOFOLLOW, so a symlink planted in the out dir is never followed.
"""
import os

FORBIDDEN = ('/var/log/mcai', '/var/lib/mcai', '/srv/mcbots', '/opt/minecraft-ai')
DEFAULT_ALLOW = ('/var/lib/mcai-mayor',)


class UnsafeOutput(ValueError):
    pass


def _under(path, root):
    try:
        return os.path.commonpath([path, root]) == root
    except ValueError:
        return False


def safe_out_dir(path, allow_roots=None):
    """realpath(path) if it is under an allowlisted root and under no bot tree, else UnsafeOutput."""
    real = os.path.realpath(path)
    for bad in FORBIDDEN:
        for b in {bad, os.path.realpath(bad)}:
            if _under(real, b):
                raise UnsafeOutput('%s resolves to %s, inside %s (bot state/logs/code)' % (path, real, bad))
    roots = [os.path.realpath(r) for r in (allow_roots or DEFAULT_ALLOW)]
    if not any(_under(real, r) for r in roots):
        raise UnsafeOutput('%s resolves to %s, not under an allowlisted mayor dir (%s); add one with --allow-out-root'
                           % (path, real, ', '.join(roots)))
    return real


def make_dir(path):
    os.makedirs(path, exist_ok=True)
    if os.path.islink(path):
        raise UnsafeOutput('%s is a symlink' % path)


_FLAGS_APPEND = os.O_WRONLY | os.O_APPEND | os.O_CREAT | getattr(os, 'O_NOFOLLOW', 0)
_FLAGS_TRUNC = os.O_WRONLY | os.O_TRUNC | os.O_CREAT | getattr(os, 'O_NOFOLLOW', 0)


def append_line(path, text):
    fd = os.open(path, _FLAGS_APPEND, 0o644)
    try:
        os.write(fd, (text + '\n').encode())
    finally:
        os.close(fd)


def write_atomic(path, text):
    tmp = path + '.tmp'
    fd = os.open(tmp, _FLAGS_TRUNC, 0o644)
    try:
        os.write(fd, text.encode())
    finally:
        os.close(fd)
    os.replace(tmp, path)


def dir_bytes(path, prefixes=('snap-', 'assign-', 'mayor-')):
    total = 0
    try:
        with os.scandir(path) as it:
            for e in it:
                if e.name.startswith(prefixes) and e.is_file(follow_symlinks=False):
                    total += e.stat(follow_symlinks=False).st_size
    except FileNotFoundError:
        pass
    return total
