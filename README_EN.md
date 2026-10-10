# Light Giant: A Voxel Sandbox Survival Game

**[中文](./README.md) | English**

A 3D voxel sandbox inspired by Minecraft: explore a block world, build, and transform into a giant to fight monsters. **No external art assets are required** — textures, characters, monsters, and sound effects are generated in code. The browser version is a single-file game that can be played locally or online.

![Daytime world](screenshots/day-world.jpg)

**Giant form** · **Night-time monster invasion** · **Mining and building**

| Giant form | Night boss | Mining and building |
|---|---|---|
| ![Giant form](screenshots/giant-form.jpg) | ![Night monster](screenshots/night-boss.jpg) | ![Mining](screenshots/mining.jpg) |

## Play online

Open the [GitHub Pages game](https://liuzhiqiang23.github.io/light-giant/) in a desktop browser. Nothing needs to be installed; use the mouse and keyboard. Local setup is described below.

## Highlights

- **512 × 512 procedural world** with grassland, desert, forest, snowy mountains, rivers, beaches, and ocean.
- **Temple and floating islands:** a protected temple with a teleportation ring, plus a sky realm inhabited by deer, unicorns, and phoenixes.
- **Waterfall:** water flows from the sky realm to the ground, with translucent water, a rainbow, and night-time glow.
- **Monster ecosystem:** four small-monster variants, three night bosses, and a 300-HP super boss every fifth night.
- **Giant combat:** energy shots, charged red lasers, a targeted flying kick, combo punches, and a second giant transformation — with hit-stop, screen shake, and flying voxel fragments.
- **Sanctuary and warning system:** monsters stay out of the temple's 22-block sanctuary; the boss joins only after six small monsters are defeated.
- **Dawn restoration:** terrain destroyed at night is restored at dawn; player-built structures remain.
- **Procedural audio** and per-instance ambient occlusion.
- **Performance:** about 869,000 block instances at 60 FPS through chunked rendering, frustum/distance culling, and pooled lighting/effects.

## Quick start

### Browser version

No build step or external CDN is required; Three.js r128 is included locally.

~~~bash
# Windows: double-click the launcher
启动游戏.cmd

# Any system with Python
python -m http.server 8930
~~~

Then open http://127.0.0.1:8930.

### WeChat Mini Game version

The minigame/ directory contains a touch-enabled port with a virtual joystick and action buttons:

1. Install [WeChat Developer Tools](https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html).
2. Import the minigame/ directory and enter your own Mini Game AppID.
3. Build and preview the project.

## Controls (browser version)

| Input | Action |
|---|---|
| W A S D | Move |
| Mouse | Look around; click the game to lock the pointer, press Esc to release |
| Space | Jump / fly upward as the giant |
| Shift | Sprint |
| Left mouse button | Human: mine or attack. Giant: target the block or monster under the crosshair (within 70 blocks). |
| Right mouse button | Place a block |
| G | Switch between fists and machine gun (unlimited ammo) |
| T | Transform into or out of the giant (requires 6 energy) |
| F | Tap for an energy projectile; hold 2 seconds for a sustained red laser |
| V | Flying kick after targeting; charge for a penetrating kick |
| R | Three-punch combo: jab, hook, uppercut |
| B | Grow to 3.2× size and deal 1.6× punch damage; press again to revert |
| Space / C | Giant flight: rise / descend |
| 1–8 | Select a block |
| M | Toggle sound |

## World loop

1. **Day:** gather resources, build, and explore. Stand on the temple teleport ring for two seconds to reach the sky sanctuary.
2. **Night:** monsters attack in groups. Defend from inside the temple or defeat them to gain energy.
3. **Boss arrival:** clouds gather and lightning strikes. Defeat six small monsters to trigger the boss; a red directional warning appears before its charged beam.
4. **Dawn:** damaged terrain is restored. With six energy, press T to transform into the silver-and-red giant.

## Technical notes

- Three.js r128 is local; the full browser game is in index.html, with no build step.
- The world uses 64 chunks of 32 × 32 blocks, procedural value-noise terrain, and pooled instances.
- Textures are drawn procedurally on 16 × 16 canvases; no bundled external textures are needed.
- Daybreak restoration uses a voxel snapshot and rebuilds only affected chunks.
- Audio uses procedural synthesis with a shared reverb and compressor bus.

## Project structure

~~~text
├── index.html          # Complete browser game
├── three.min.js        # Local Three.js r128
├── 启动游戏.cmd         # Windows launcher
├── screenshots/        # Game screenshots
└── minigame/           # WeChat Mini Game port
    ├── game.js         # Mini Game entry point
    ├── game-code.js    # Shared game logic
    ├── adapter.js      # DOM and Web Audio compatibility layer
    ├── hud.js          # Touch controls
    └── libs/three.min.js
~~~

## License

[MIT](LICENSE) © Liu Zhiqiang (Alvis)
