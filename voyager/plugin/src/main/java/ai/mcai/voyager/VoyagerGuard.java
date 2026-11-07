package ai.mcai.voyager;

// voyager-01 VoyagerGuard (docs/reports/voyager-01-design-2026-11-06.md §3.4, §12).
//  1. NO PLAYER COMMAND RUNS: every PlayerCommandPreprocessEvent is cancelled at LOWEST and again at HIGHEST (a later
//     listener cannot un-cancel it for good), logged at MONITOR. Tab completion is cancelled and the command tree the
//     client receives is emptied. The voyager servers run no other plugin.
//  2. THE SERVER'S RECORD: every player block place/break and death goes to plugins/VoyagerGuard/events.jsonl.
//  3. 24-HOUR SURVIVAL READ ON THE SERVER: 24 h after each placement the block is read back from the world (physics and
//     fluids included) and the answer goes to plugins/VoyagerGuard/survival.jsonl.

import com.destroystokyo.paper.event.server.AsyncTabCompleteEvent;
import org.bukkit.Bukkit;
import org.bukkit.GameRule;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.World;
import org.bukkit.block.Block;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.block.BlockBreakEvent;
import org.bukkit.event.block.BlockPlaceEvent;
import org.bukkit.event.entity.PlayerDeathEvent;
import org.bukkit.event.player.PlayerCommandPreprocessEvent;
import org.bukkit.event.player.PlayerCommandSendEvent;
import org.bukkit.event.server.TabCompleteEvent;
import org.bukkit.plugin.java.JavaPlugin;

import java.io.BufferedWriter;
import java.io.File;
import java.io.FileWriter;
import java.io.IOException;
import java.nio.file.Files;
import java.time.Instant;
import java.util.ArrayDeque;
import java.util.Deque;
import java.util.List;

public final class VoyagerGuard extends JavaPlugin implements Listener {
    private static final long DAY_MS = 24L * 3600L * 1000L;
    private File events;
    private File survival;
    private final Deque<long[]> pending = new ArrayDeque<>();   // {placedAtMs, x, y, z}
    private final Deque<String> pendingType = new ArrayDeque<>();
    private final Deque<String> pendingWorld = new ArrayDeque<>();

    @Override
    public void onEnable() {
        getDataFolder().mkdirs();
        events = new File(getDataFolder(), "events.jsonl");
        survival = new File(getDataFolder(), "survival.jsonl");
        reloadPending();
        // the fleet's gamerules (11-06 internal research §1), set in code at every start: no console needed
        for (World w : Bukkit.getWorlds()) {
            w.setGameRule(GameRule.KEEP_INVENTORY, true);
            w.setGameRule(GameRule.MOB_GRIEFING, false);
            w.setGameRule(GameRule.DO_FIRE_TICK, false);
            w.setGameRule(GameRule.DO_WEATHER_CYCLE, false);
            w.setGameRule(GameRule.DO_INSOMNIA, false);
            w.setGameRule(GameRule.DO_IMMEDIATE_RESPAWN, true);
            w.setGameRule(GameRule.PLAYERS_SLEEPING_PERCENTAGE, 100);
        }
        getServer().getPluginManager().registerEvents(this, this);
        // every 10 minutes: read back placements that are now 24 h old
        Bukkit.getScheduler().runTaskTimer(this, this::checkSurvival, 20L * 60L, 20L * 600L);
        write(events, "{\"t\":\"" + Instant.now() + "\",\"kind\":\"guard_enabled\",\"pending\":" + pending.size() + "}");
    }

    static String esc(String s) {
        if (s == null) return "";
        StringBuilder b = new StringBuilder();
        for (char c : s.toCharArray()) {
            if (c == '"' || c == '\\') b.append('\\').append(c);
            else if (c < 0x20) b.append(String.format("\\u%04x", (int) c));
            else b.append(c);
        }
        return b.toString();
    }

    private synchronized void write(File f, String line) {
        try (BufferedWriter w = new BufferedWriter(new FileWriter(f, true))) { w.write(line); w.write('\n'); }
        catch (IOException e) { getLogger().warning("VoyagerGuard write failed: " + e.getMessage()); }
    }

    // ---- 1. commands ------------------------------------------------------------------------------------------
    @EventHandler(priority = EventPriority.LOWEST)
    public void denyFirst(PlayerCommandPreprocessEvent e) { e.setCancelled(true); }

    @EventHandler(priority = EventPriority.HIGHEST)
    public void denyAgain(PlayerCommandPreprocessEvent e) { e.setCancelled(true); }

    @EventHandler(priority = EventPriority.MONITOR)
    public void logCommand(PlayerCommandPreprocessEvent e) {
        e.setCancelled(true);
        String msg = e.getMessage();
        if (msg.length() > 120) msg = msg.substring(0, 120);
        write(events, "{\"t\":\"" + Instant.now() + "\",\"kind\":\"command_denied\",\"player\":\"" + esc(e.getPlayer().getName())
            + "\",\"command\":\"" + esc(msg) + "\"}");
        e.getPlayer().sendMessage("Commands are disabled on this server.");
    }

    @EventHandler(priority = EventPriority.LOWEST)
    public void noAsyncTab(AsyncTabCompleteEvent e) { e.setCancelled(true); }

    @EventHandler(priority = EventPriority.LOWEST)
    public void noTab(TabCompleteEvent e) { e.setCancelled(true); }

    @EventHandler(priority = EventPriority.HIGHEST)
    public void noCommandTree(PlayerCommandSendEvent e) { e.getCommands().clear(); }

    // ---- 2. the record -----------------------------------------------------------------------------------------
    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void onPlace(BlockPlaceEvent e) {
        Block b = e.getBlockPlaced();
        long now = System.currentTimeMillis();
        write(events, "{\"t\":\"" + Instant.ofEpochMilli(now) + "\",\"kind\":\"place\",\"player\":\"" + esc(e.getPlayer().getName())
            + "\",\"block\":\"" + b.getType().getKey().getKey() + "\",\"world\":\"" + esc(b.getWorld().getName())
            + "\",\"x\":" + b.getX() + ",\"y\":" + b.getY() + ",\"z\":" + b.getZ() + "}");
        synchronized (pending) {
            pending.addLast(new long[]{now, b.getX(), b.getY(), b.getZ()});
            pendingType.addLast(b.getType().getKey().getKey());
            pendingWorld.addLast(b.getWorld().getName());
        }
    }

    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void onBreak(BlockBreakEvent e) {
        Block b = e.getBlock();
        write(events, "{\"t\":\"" + Instant.now() + "\",\"kind\":\"break\",\"player\":\"" + esc(e.getPlayer().getName())
            + "\",\"block\":\"" + b.getType().getKey().getKey() + "\",\"world\":\"" + esc(b.getWorld().getName())
            + "\",\"x\":" + b.getX() + ",\"y\":" + b.getY() + ",\"z\":" + b.getZ() + "}");
    }

    @EventHandler(priority = EventPriority.MONITOR)
    @SuppressWarnings("deprecation")
    public void onDeath(PlayerDeathEvent e) {
        Location l = e.getEntity().getLocation();
        write(events, "{\"t\":\"" + Instant.now() + "\",\"kind\":\"death\",\"player\":\"" + esc(e.getEntity().getName())
            + "\",\"message\":\"" + esc(e.getDeathMessage()) + "\",\"x\":" + l.getBlockX() + ",\"y\":" + l.getBlockY() + ",\"z\":" + l.getBlockZ() + "}");
    }

    // ---- 3. survival read ------------------------------------------------------------------------------------------
    private void checkSurvival() {
        long now = System.currentTimeMillis();
        int done = 0;
        while (done < 2000) {
            long[] p; String type; String wname;
            synchronized (pending) {
                p = pending.peekFirst();
                if (p == null || now - p[0] < DAY_MS) break;
                pending.pollFirst(); type = pendingType.pollFirst(); wname = pendingWorld.pollFirst();
            }
            World w = Bukkit.getWorld(wname);
            if (w == null) continue;
            Block b = w.getBlockAt((int) p[1], (int) p[2], (int) p[3]);   // loads the chunk if needed: a server read
            String now_ = b.getType().getKey().getKey();
            write(survival, "{\"t\":\"" + Instant.ofEpochMilli(now) + "\",\"placed_at\":\"" + Instant.ofEpochMilli(p[0])
                + "\",\"world\":\"" + esc(wname) + "\",\"x\":" + p[1] + ",\"y\":" + p[2] + ",\"z\":" + p[3]
                + ",\"placed\":\"" + type + "\",\"now\":\"" + now_ + "\",\"survived\":" + (now_.equals(type) && b.getType() != Material.AIR) + "}");
            done++;
        }
    }

    // Rebuild the 24-h queue after a restart: placements in events.jsonl not yet in survival.jsonl.
    private void reloadPending() {
        java.util.Set<String> checked = new java.util.HashSet<>();
        try {
            if (survival.exists()) for (String l : Files.readAllLines(survival.toPath())) {
                String k = field(l, "placed_at") + "|" + num(l, "x") + "|" + num(l, "y") + "|" + num(l, "z");
                checked.add(k);
            }
            if (!events.exists()) return;
            List<String> lines = Files.readAllLines(events.toPath());
            for (String l : lines) {
                if (!l.contains("\"kind\":\"place\"")) continue;
                String t = field(l, "t");
                String k = t + "|" + num(l, "x") + "|" + num(l, "y") + "|" + num(l, "z");
                if (checked.contains(k)) continue;
                long at = Instant.parse(t).toEpochMilli();
                pending.addLast(new long[]{at, Long.parseLong(num(l, "x")), Long.parseLong(num(l, "y")), Long.parseLong(num(l, "z"))});
                pendingType.addLast(field(l, "block"));
                pendingWorld.addLast(field(l, "world"));
            }
        } catch (Exception ex) { getLogger().warning("VoyagerGuard reload: " + ex.getMessage()); }
    }

    static String field(String l, String k) {
        String key = "\"" + k + "\":\"";
        int i = l.indexOf(key); if (i < 0) return "";
        int j = l.indexOf('"', i + key.length());
        return j < 0 ? "" : l.substring(i + key.length(), j);
    }

    static String num(String l, String k) {
        String key = "\"" + k + "\":";
        int i = l.indexOf(key); if (i < 0) return "0";
        int j = i + key.length(), e = j;
        while (e < l.length() && (Character.isDigit(l.charAt(e)) || l.charAt(e) == '-')) e++;
        return l.substring(j, e);
    }
}
