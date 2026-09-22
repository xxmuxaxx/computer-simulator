# Real DOOM WASM engine goes here

This folder is where the runtime fetches the real DOOM engine from at install time
(`DoomEngineAdapter`/`DoomRuntimeAdapter` in `src/core/runtime/doom/`).

Download the official release build from the project this was sourced from:

- Project: https://github.com/jacobenget/doom.wasm (GPL-2.0)
- Release: https://github.com/jacobenget/doom.wasm/releases/tag/v0.1.0
- Direct download: https://github.com/jacobenget/doom.wasm/releases/download/v0.1.0/doom-v0.1.0.wasm

Save the downloaded file into this folder as:

```
public/runtime/doom/doom.wasm
```

The file is intentionally **not** committed to this repository (see `.gitignore`) - it's a
~4.5 MB third-party GPL-2.0 binary, fetched from its own upstream release rather than vendored
into this repo's history. The engine embeds id Software's officially freely-distributable Doom
Shareware WAD (`DOOM1.WAD`, Episode 1: "Knee-Deep in the Dead") as its built-in fallback, so the
game plays immediately once this file is in place - no separate IWAD download is required. A
player can still supply their own legally obtained retail `DOOM.WAD`/`DOOM2.WAD` through the
in-app "Select File" picker, which takes priority over the built-in shareware episode.

See `docs/runtime.md` for the full integration details (interface, licensing, attribution).
