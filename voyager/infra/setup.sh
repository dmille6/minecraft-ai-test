#!/bin/bash
# voyager-01 setup on the worlds host. Idempotent. Run as root from a copy:  sudo bash setup.sh <stage-dir>
# <stage-dir> holds: code/ (bots + voyager with node_modules), node/ (node 22 runtime), paper.jar, VoyagerGuard.jar
# Touches only: /srv/voyager, /etc/voyager, /var/log/voyager, /var/lib/voyager-proxy, voyager-* units and users.
set -euo pipefail
STAGE="$1"
REG="$STAGE/code/voyager/infra/arms.conf"
ARMS="$(grep -v '^#' "$REG" | awk 'NF{print $1}' | tr '\n' ' ')"
field () { grep -v '^#' "$REG" | awk -v a="$1" -v f="$2" '$1==a{print $f}'; }
id voyager-mc >/dev/null 2>&1 || useradd --system --no-create-home --shell /usr/sbin/nologin voyager-mc
id voyager-proxy >/dev/null 2>&1 || useradd --system --no-create-home --shell /usr/sbin/nologin voyager-proxy
for a in $ARMS; do
  id voyager-$a >/dev/null 2>&1 || useradd --system --no-create-home --shell /usr/sbin/nologin voyager-$a
  usermod -aG voyager-$a voyager-proxy
done
install -d -m 0755 -o root -g root /srv/voyager /srv/voyager/worlds /srv/voyager/state /srv/voyager/logs
install -d -m 0750 -o root -g voyager-proxy /etc/voyager
install -d -m 0750 -o voyager-proxy -g voyager-proxy /var/log/voyager /var/lib/voyager-proxy
# code and runtime: root-owned, read-only to everyone else
rm -rf /srv/voyager/code.new /srv/voyager/node.new
cp -a "$STAGE/code" /srv/voyager/code.new && cp -a "$STAGE/node" /srv/voyager/node.new
chown -R root:root /srv/voyager/code.new /srv/voyager/node.new && chmod -R go-w,a+rX /srv/voyager/code.new /srv/voyager/node.new
rm -rf /srv/voyager/code.old /srv/voyager/node.old
[ -d /srv/voyager/code ] && mv /srv/voyager/code /srv/voyager/code.old
[ -d /srv/voyager/node ] && mv /srv/voyager/node /srv/voyager/node.old
mv /srv/voyager/code.new /srv/voyager/code && mv /srv/voyager/node.new /srv/voyager/node
for a in $ARMS; do
  W=/srv/voyager/worlds/$a
  install -d -m 0750 -o voyager-mc -g voyager-mc $W $W/plugins
  install -m 0640 -o voyager-mc -g voyager-mc "$STAGE/paper.jar" $W/paper.jar
  install -m 0640 -o voyager-mc -g voyager-mc "$STAGE/VoyagerGuard.jar" $W/plugins/VoyagerGuard.jar
  [ -f $W/server.properties ] || sed -e "s/__ARM__/$a/" -e "s/__SEED__/$(field $a 4)/" /srv/voyager/code/voyager/infra/server.properties.tmpl > $W/server.properties
  echo 'eula=true' > $W/eula.txt
  echo '[]' > $W/ops.json
  echo "[{\"uuid\":\"$(python3 -c "import hashlib,uuid,sys; n='vy-$a'; h=bytearray(hashlib.md5(('OfflinePlayer:'+n).encode()).digest()); h[6]=h[6]&0x0f|0x30; h[8]=h[8]&0x3f|0x80; print(uuid.UUID(bytes=bytes(h)))")\",\"name\":\"vy-$a\"}]" > $W/whitelist.json
  chown voyager-mc:voyager-mc $W/server.properties $W/eula.txt $W/ops.json $W/whitelist.json
  # world dirs readable by root and the watcher only
  install -d -m 0700 -o voyager-$a -g voyager-$a /srv/voyager/state/$a
  install -d -m 0750 -o voyager-$a -g voyager-$a /srv/voyager/logs/$a
done
install -m 0644 /srv/voyager/code/voyager/infra/voyager.slice /srv/voyager/code/voyager/infra/voyager-paper@.service \
  /srv/voyager/code/voyager/infra/voyager-bot@.service /srv/voyager/code/voyager/infra/voyager-proxy.service \
  /srv/voyager/code/voyager/infra/voyager-watch.service /srv/voyager/code/voyager/infra/voyager-watch.timer /etc/systemd/system/
{ echo "# voyager-01 (generated from arms.conf): one socket dir per arm, readable only by that arm's group"; echo "d /run/voyager 0755 root root -"
  for a in $ARMS; do echo "d /run/voyager/$a 0750 voyager-proxy voyager-$a -"; done; } > /etc/tmpfiles.d/voyager.conf
systemd-tmpfiles --create /etc/tmpfiles.d/voyager.conf
systemctl daemon-reload
echo "setup done: $(ls /srv/voyager/worlds | tr '\n' ' ')"
# per-arm env files (rewritten each setup: CODE_VERSION follows the staged sha)
SHA="$(cat "$STAGE/SHA")"
for a in $ARMS; do
  if [ "$(field $a 2)" = control ]; then E=control-entry.mjs; L=true; MF=3; else E=entry.mjs; L=false; MF=1000; fi
  # the harness version is the registry's optional 5th column; anything but 2 is harness 1 (the stage 3 / 3b / 4 harness)
  H="$(field $a 5)"; [ "$H" = 2 ] || H=1
  sed -e "s/__ARM__/$a/g" -e "s#__ENTRY__#$E#" -e "s/__LLM__/$L/" -e "s/__MODEL__/$(field $a 3)/g" -e "s/__SHA__/$SHA/" -e "s/__MAXFAIL__/$MF/" -e "s/__HARNESS__/$H/" \
    /srv/voyager/code/voyager/infra/bot.env.tmpl > /etc/voyager/bot-$a.env
  chmod 0644 /etc/voyager/bot-$a.env
  install -d -m 0700 -o voyager-$a -g voyager-$a /srv/voyager/state/$a/bot /srv/voyager/state/$a/pool /srv/voyager/state/$a/voyager
done
# Paper's patched jar and libraries, copied so the server never needs the network (it has none)
for a in $ARMS; do
  for d in cache libraries versions; do
    [ -d "/srv/voyager/worlds/$a/$d" ] || { cp -a "$STAGE/paperbase/$d" "/srv/voyager/worlds/$a/$d"; chown -R voyager-mc:voyager-mc "/srv/voyager/worlds/$a/$d"; }
  done
done
echo "env + paper base done (sha $SHA)"
# the proxy's config (no key in it; the key file is separate, 0400 voyager-proxy, installed by hand)
if [ ! -f /etc/voyager/proxy.json ]; then
  G() { getent group "voyager-$1" | cut -d: -f3; }
  cat > /etc/voyager/proxy.json <<JSON
{
 "socketDir": "/run/voyager",
 "logFile": "/var/log/voyager/proxy.jsonl",
 "spendFile": "/var/lib/voyager-proxy/spend.json",
 "anthropicKeyFile": "/etc/voyager/anthropic.key",
 "guardFile": "/etc/voyager/guard.json",
 "groups": {"studio": {"arms": ["a", "b"], "slotMinutes": 60, "url": "http://ai.ticrcorp.com:11436"}},
 "arms": {
  "a":   {"backend": "ollama", "url": "http://ai.ticrcorp.com:11436", "model": "qwen3.6:35b-a3b", "think": false, "numCtx": 12288, "keepAlive": "15m", "inflight": 1, "perHour": 60, "maxTokens": 4096, "group": "studio", "guarded": true, "dutyFactor": 2, "gid": $(G a), "paused": true},
  "b":   {"backend": "ollama", "url": "http://ai.ticrcorp.com:11436", "model": "qwen2.5-coder:32b", "numCtx": 12288, "keepAlive": "15m", "inflight": 1, "perHour": 60, "maxTokens": 4096, "group": "studio", "guarded": true, "dutyFactor": 2, "gid": $(G b), "paused": true},
  "c":   {"backend": "anthropic", "model": "claude-haiku-5-5", "inUsdPerMTok": 0.10, "outUsdPerMTok": 0.50, "capUsd": 20, "effort": "low", "inflight": 1, "perHour": 400, "maxTokens": 4096, "gid": $(G c)},
  "ctl": {"backend": "ollama-raw", "url": "http://ai.ticrcorp.com:11436", "model": "qwen2.5:7b-instruct", "keepAlive": "15m", "inflight": 1, "perHour": 300, "gid": $(G ctl), "paused": true}
 }
}
JSON
  chown root:voyager-proxy /etc/voyager/proxy.json; chmod 0640 /etc/voyager/proxy.json
fi
echo "proxy config present"
# stage 3b+: every arm in arms.conf has a proxy entry (added PAUSED when missing; existing entries are never changed here)
python3 - "$REG" <<'PY'
import json, sys, grp
p = "/etc/voyager/proxy.json"; d = json.load(open(p))
for line in open(sys.argv[1]):
    if not line.strip() or line.startswith("#"): continue
    parts = line.split()
    arm, kind, model, seed = parts[:4]
    h2 = len(parts) > 4 and parts[4] == "2"
    if arm in d["arms"]: continue
    gid = grp.getgrnam(f"voyager-{arm}").gr_gid
    if model.startswith("claude-") and h2:
        # harness 2 asks for 10,000-token code replies: an arm left at 4,096 would be clamped back to harness 1's cut-offs
        # without a word. Its own cap, not 3b's spend group. Prices are Haiku's: an operator sets any other model's by hand.
        e = {"backend": "anthropic", "model": model, "inUsdPerMTok": 0.10, "outUsdPerMTok": 0.50, "capUsd": 20, "effort": "low", "inflight": 1, "perHour": 400, "maxTokens": 12000}
    elif model.startswith("claude-"):
        e = {"backend": "anthropic", "model": model, "inUsdPerMTok": 0.10, "outUsdPerMTok": 0.50, "capUsd": 70, "spendGroup": "haiku-3b", "effort": "low", "inflight": 1, "perHour": 400, "maxTokens": 4096}
    elif kind == "control":
        e = {"backend": "ollama-raw", "url": "http://ai.ticrcorp.com:11436", "model": model, "keepAlive": "15m", "inflight": 1, "perHour": 300, "guarded": True}
    else:
        e = {"backend": "ollama", "url": "http://ai.ticrcorp.com:11438", "model": model, "numCtx": 12288, "keepAlive": -1, "think": False, "inflight": 1, "perHour": 400, "maxTokens": 12000 if h2 else 4096, "dutyFactor": 0}
    e.update({"gid": gid, "paused": True})
    d["arms"][arm] = e
json.dump(d, open(p + ".new", "w"), indent=1)
PY
chown root:voyager-proxy /etc/voyager/proxy.json.new && chmod 0640 /etc/voyager/proxy.json.new && mv /etc/voyager/proxy.json.new /etc/voyager/proxy.json
echo "proxy arms: $(python3 -c 'import json;print(" ".join(json.load(open("/etc/voyager/proxy.json"))["arms"]))')"
