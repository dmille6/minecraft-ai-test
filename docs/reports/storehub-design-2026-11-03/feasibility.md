# Feasibility facts for storehub (searched 2026-11-03; no server run)

The mineflayer source checked is 4.37.1, in `bots/node_modules/mineflayer/lib/plugins/`. Each fact is marked **confirmed** (seen in
docs or source) or **unverified** (belief or memory). Unverified facts must be proven in the Paper sandbox.

## Hoppers

**Recipe, facing, pickup** (<https://minecraft.wiki/w/Hopper>)
- Recipe: 5 iron ingots + 1 chest. **Confirmed.**
- The output faces the block face it was placed against. **Confirmed.**
- It pulls item entities from the whole block space above it. **Confirmed.**
- A full solid block on top stops the pull; since 1.20.5 it no longer even tries. **Confirmed.**
- A container on top makes it pull from that container instead. **Confirmed.**
- Partial blocks on top do not block the pull. **Confirmed.**
- Items resting on a hopper's top face are collected. **Unverified:** the wiki does not say so; it is a memory of decompiled code.

**Rate** (wiki; spigot docs <https://docs.papermc.io/paper/reference/spigot-configuration/>)
- One item per 8-tick cooldown, so 2.5 items/s per hopper. **Confirmed.**
- spigot defaults: `ticks-per.hopper-transfer: 8`, `ticks-per.hopper-check: 1`, `hopper-amount: 1`, `hopper-can-load-chunks: false`.
  **Confirmed.**
- Paper defaults (<https://docs.papermc.io/paper/reference/world-configuration/>): `hopper.cooldown-when-full: true`,
  `hopper.disable-move-event: false`, `hopper.ignore-occluding-blocks: false`. **Confirmed.**
- The live servers' `spigot.yml` and `paper-world` values were **not read**. Read them before the proof.

## Item entities

**Despawn and merging** (spigot docs; <https://minecraft.wiki/w/Item_(entity)>)
- Despawn after 6000 ticks (5 min, `item-despawn-rate`). **Confirmed.**
- `merge-radius.item` defaults to **0.5**. **Confirmed.**
- The despawn timer pauses when the chunk is not entity-ticking. **Confirmed.**
- Paper's `alt-item-despawn-rate` is off by default. **Confirmed.**

**Pickup** (wiki)
- Ordinary drops have a 10-tick pickup delay; **player-thrown items have 40 ticks**. **Confirmed.**
- A player picks up within 1 block horizontally and 0.5 blocks vertically beyond its hitbox. **Confirmed.**

**Activation range**
- Paper `entity-activation-range.misc: 16` covers items, so items tick slowly beyond 16 blocks of a player. **Confirmed.**
- Paper keeps the despawn age running for those slowed items: patch
  <https://ayakael.net/mirrors/papermc/commit/a1b0dffb199b255bf40353045713ed318bf6ca10>, and SPIGOT-7934. **Confirmed.**
- Whether a hopper still pulls a slowed item is **unknown**.

## mineflayer

**Placing**
- `placeBlock` sends block_place with the clicked face. **Confirmed (source).**
- It never sends sneak: the `_genericPlace` TODO says "tell the server that we are sneaking". **Confirmed (source).**
- So clicking a chest opens it, and `placeBlock` throws after its 5 s wait. **Confirmed (source).**
- `setControlState('sneak', true)` sends the sneak packet at once (`physics.js`). **Confirmed (source).**
- This repo's builder (`bots/src/buildbot.mjs`) sends its own packet and never clicks an `INTERACTABLE` block (chests included).
  Hence the placeholder method in the design. **Confirmed.**

**Windows**
- `openChest` is the same function as `openContainer`. **Confirmed (source).**
- Known failures:
  - "Server rejected transaction": mineflayer #3249, #3048, #1556, #2280.
  - windowOpen timeout: #3360, #3399, and #3459 (a Paper permission issue).
  - 1.21.8 chest opening: #3769.
- Unknown: whether a hopper feeding a chest while a bot has its window open causes a desync.

**Signs**
- `bot.updateSign(block, text, back)` exists. **Confirmed (source).**
- Paper 1.21.8 accepts a sign edit only from the open editor. **Confirmed here:** `sandbox/sortstore/sign-proof.cjs`, 11-01.

**Tossing**
- `toss` is `transfer()` to slot -999. **Confirmed (source).**
- `tossStack` is two clicks plus a window close. **Confirmed (source).**
- Real throughput was not measured.

## Chests

- A chest does not open under a redstone-conducting block.
- **A chest opens under glass.** Proven on Paper 10-19 (lidglass); see `bots/src/lidrule.mjs` `LID_OPENS`, which also covers
  leaves.
- Whether a chest opens under a slab is not proven.
- The builder places a block against the **block below first** (`bots/src/buildsite.mjs` `SUPPORTS`). A hopper cell therefore needs a
  forced support, or it faces down. This came from the Claude review.
- Adjacent single chests merge into a double chest. Keep them one cell apart. **Unverified:** prove it.

## Comparators

- Comparators need Nether quartz (<https://minecraft.wiki/w/Redstone_Comparator>). **Confirmed.**
- Hopper item-sorters need comparators. **Confirmed.**
- With no Nether there is no hopper sorting, so the bots do the sorting. **Confirmed.**
