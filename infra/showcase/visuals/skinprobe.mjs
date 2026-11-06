// skinsfix-1106 probe: N mineflayer clients (showcase release node_modules) against SANDBOX8 ONLY; logs every error,
// kick, end, reconnect, parse error, and each player's skin as seen by the others. JSON lines to stdout.
import { createRequire } from 'module';
const require = createRequire(process.env.HOME + '/skinsfix-1106/harness/package.json');
const mineflayer = require('mineflayer');
const HOST = '10.0.0.30', PORT = 25606;               // sandbox8, nothing else
const names = process.argv.slice(2);
const log = (o) => console.log(JSON.stringify({ t: new Date().toISOString(), ...o }));
const origErr = console.error; console.error = (...a) => { log({ ev: 'console.error', msg: a.map(String).join(' ').slice(0, 600) }); };
const origWarn = console.warn; console.warn = (...a) => { log({ ev: 'console.warn', msg: a.map(String).join(' ').slice(0, 300) }); };
const stats = {};
function start(name) {
  const st = stats[name] ??= { spawns: 0, ends: 0, kicks: 0, errors: 0, parse: 0, skinsSeen: {} };
  const bot = mineflayer.createBot({ host: HOST, port: PORT, username: name, auth: 'offline' });
  bot._client.on('error', (e) => { st.errors++; if (/PartialReadError|Deserializ|parse/i.test(String(e?.stack || e))) st.parse++; log({ ev: 'client_error', bot: name, err: String(e?.stack || e).slice(0, 1500) }); });
  bot.on('error', (e) => log({ ev: 'bot_error', bot: name, err: String(e?.message || e).slice(0, 300) }));
  bot.on('kicked', (r) => { st.kicks++; log({ ev: 'kicked', bot: name, reason: JSON.stringify(r).slice(0, 500) }); });
  bot.on('spawn', () => { st.spawns++; log({ ev: 'spawn', bot: name, n: st.spawns, pos: bot.entity?.position?.toString() }); });
  const skin = (p) => { try { const prop = p?.skinData?.url || null; if (p?.username && p.username !== name && st.skinsSeen[p.username] !== prop) { st.skinsSeen[p.username] = prop; log({ ev: 'skin_seen', bot: name, of: p.username, url: prop }); } } catch (e) { log({ ev: 'skin_read_err', bot: name, err: String(e) }); } };
  bot.on('playerJoined', skin); bot.on('playerUpdated', skin);
  for (const k of ['player_info', 'player_remove', 'respawn', 'entity_destroy', 'named_entity_spawn', 'spawn_entity']) bot._client.on(k, (d) => log({ ev: 'pkt', bot: name, k, d: JSON.stringify(d, (kk, v) => typeof v === 'bigint' ? String(v) : (kk === 'value' && typeof v === 'string' && v.length > 80 ? v.slice(0, 40) + '..' + v.length : v)).slice(0, 700) }));
  let tick = null;
  bot.once('spawn', () => { tick = setInterval(() => { try { bot.look(Math.random() * 6.28, 0, false); bot.setControlState('forward', Math.random() < 0.5); bot.setControlState('jump', Math.random() < 0.3); } catch {} }, 3000); });
  bot.on('end', (r) => { st.ends++; clearInterval(tick); log({ ev: 'end', bot: name, reason: String(r), n: st.ends }); if (!stopping) setTimeout(() => start(name), 5000); });
  bots[name] = bot;
}
const bots = {}; let stopping = false;
setInterval(() => log({ ev: 'stats', stats }), 60000);
process.on('SIGTERM', () => { stopping = true; log({ ev: 'final', stats }); for (const b of Object.values(bots)) try { b.quit(); } catch {} setTimeout(() => process.exit(0), 1500); });
names.forEach((n, i) => setTimeout(() => start(n), i * 3000));
