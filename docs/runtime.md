# Virtual Application & Game Runtime

This document describes `src/core/runtime/`: a sandboxed WASM application runtime layered on top
of the existing virtual OS primitives (`VirtualFileSystem`, `ProcessManager`, `WindowManager`,
`ApplicationRegistry`). DOOM is its first proof case, shipped with a small hand-assembled
placeholder engine instead of real game code (see [DOOM integration](#doom-integration)).

## Architecture

```
VirtualComputer
    │
    ├── fileSystem, processManager, windowManager, notifications   (existing)
    │
    └── runtime: RuntimeManager                                     (new peer subsystem)
            │
            ├── registry: RuntimeRegistry        - installed manifests, backed by /apps/<id>/
            ├── events: RuntimeEventBus           - lifecycle pub/sub (started/paused/crashed/...)
            └── instances: Map<pid, RuntimeInstance>
                    │
                    ├── ApplicationRuntime         - sandboxed WebAssembly.instantiate + tick()
                    ├── RuntimeDisplay              - RGBA frame buffer
                    ├── RuntimeInput                - buffered keyboard/mouse snapshot
                    ├── RuntimeFileProvider          - sandboxed FS facade, scoped + permission-gated
                    └── RuntimeResourceManager        - synthetic fps/cpu/memory sampling
```

`core/runtime/` has zero dependency on React, exactly like every other `core/` module. A
runtime-backed application (DOOM, and any future game) is registered as a completely ordinary
`ApplicationDefinition` (`src/apps/index.ts`) whose `component` is the generic
`RuntimeHostApp` (`src/apps/runtime/RuntimeHostApp.tsx`) - the same component for every runtime
application. Launching one goes through the **unmodified** `computer.launch(appId)` path:
`WindowManager`, `ProcessManager` and Task Manager needed **zero changes** to support this.

`RuntimeHostApp` mounts, calls `computer.runtime.attach(pid, windowId, appId)`, and from then on
just paints whatever is in `RuntimeDisplay`'s frame buffer onto a `<canvas>` and forwards
keyboard/mouse events into `RuntimeInput`. It never touches the WASM module directly.

## Manifest

```ts
interface RuntimeManifest {
  id: string;
  name: string;
  version: string;
  type: 'wasm' | 'game' | 'application';
  executable: string;              // path to the .wasm file, relative to /apps/<id>/
  icon?: string;
  description?: string;
  memoryUsage: number;             // MB, reserved at launch like any ApplicationDefinition
  cpuUsage?: number;                // baseline % reported once running
  display: { width: number; height: number };
  permissions: RuntimePermission[];
}
```

Installing a package (`RuntimeRegistry.install(manifest, files)`) writes `manifest.json` plus
every file in `files` under `/apps/<id>/` in the **existing** `VirtualFileSystem`, then locks the
directory down (`readonly: true`, `protected: true`) exactly like `seedFileSystem()` locks the
built-in `/apps/*.app` manifests. `/apps` itself is normally readonly too (set once at boot); the
registry briefly unlocks it for the duration of an install/remove and always re-locks it
afterwards, mirroring `seedFileSystem`'s own write-then-lock order.

There is **no separate manifest registry to keep in sync** - "installed" means
`/apps/<id>/manifest.json` exists. `RuntimeRegistry.list()` just walks `/apps/*/manifest.json`.

## Permissions

```ts
type RuntimePermission = 'fs:read' | 'fs:write' | 'input:keyboard' | 'input:mouse' | 'display:render';
```

Granted wholesale from the manifest at install time (no per-call prompt UI in this pass).
`RuntimeFileProvider`, `RuntimeInput` and `RuntimeDisplay` each check their own permission before
doing anything, throwing `SystemError('EPERMISSION', ...)` on a denied filesystem
read/write or a denied frame-buffer access. Input without permission fails closed (silently
ignored) rather than throwing, since it's driven by the host component, not by sandboxed code
that could be probing for a reaction.

## Filesystem adapter

`RuntimeFileProvider` is the *only* filesystem access a runtime application has. It is
constructed with a fixed root - `/home/user/games/<id>/` - and every path is resolved against
that root and rejected with `EPERMISSION` if it would escape it (checked via `utils/path.ts`'s
`isInside`), regardless of `..` segments or absolute-looking input. It never sees `/apps/<id>/`
(the installed package itself) or anything else on the real filesystem.

Save games, configuration and screenshots are just ordinary files under this root
(`saves/`, `config/`, `screenshots/`, created on first attach) - **not** a second persistence
system. They round-trip through the exact same `filesystem` key in `ComputerSnapshot` that every
other file already uses.

## Input adapter

`RuntimeInput` buffers `pushKey(code, down)` / `pushMouse(x, y, buttons)` calls from
`RuntimeHostApp`'s DOM event handlers and exposes a plain, serialisable `snapshot()`
(`{ keys, mouseX, mouseY, mouseButtons }`) plus a packed single-word form
(`packed()`) for the WASM import boundary. The sandboxed module never registers a real
`window`/`document` event listener - it only ever calls `env.get_input()`.

## Display adapter

`RuntimeDisplay` owns a plain `Uint8ClampedArray` RGBA frame buffer (`getFrameBuffer()`), sized
from the manifest's `display.width`/`height`. `core/` never constructs a browser `ImageData`
object itself (that's a DOM global, not something a UI-independent layer should depend on) -
`RuntimeHostApp` is what does `new ImageData(new Uint8ClampedArray(buffer), w, h)` and
`ctx.putImageData(...)`, once per animation frame, decoupled from the module's own update/render
cadence.

## Resource accounting

`RuntimeResourceManager` produces a synthetic `{ cpuUsage, memoryUsage, fps }` sample once per
tick, fed straight into a new, small, additive `ProcessManager.reportUsage(pid, usage)` method
(mirrors the existing `boost()` for CPU, but sets a *sustained* baseline rather than a decaying
spike). This is the same `cpuUsage`/`memoryUsage` field Task Manager already renders - **no Task
Manager changes were needed** to show a runtime-hosted application exactly like any other process.
Reported memory is display-only; the real `VirtualMemory` allocation ledger still reflects
`manifest.memoryUsage` reserved at launch time, matching how ordinary applications work.

## Lifecycle

```
starting → running ⇄ paused → stopped
              │
              └──────→ crashed
```

- **Minimize/restore** pauses/resumes automatically: `RuntimeManager` subscribes to
  `ProcessManager`, and `VirtualComputer.tick()` already flips a minimized window's process to
  `sleeping`/`running` - `RuntimeInstance.pause()`/`resume()` just follow that same transition.
  No new `WindowManager` API was added.
- **Crash handling**: `RuntimeInstance`'s own frame loop wraps every WASM call in try/catch (a
  React `ErrorBoundary` alone can't see an exception thrown inside a `requestAnimationFrame`
  callback). On any failure - a bad manifest, a failed `WebAssembly.instantiate`, or a trap during
  `update`/`render` - the instance transitions to `crashed`, posts an "Application crashed"
  notification, and stops its frame loop. **The process is left alive**, not auto-killed: Task
  Manager still lists it, and `RuntimeHostApp` shows a Restart overlay
  (`RuntimeManager.restart(pid)` disposes and re-attaches a fresh instance for the same
  pid/window). Killing it goes through the ordinary `computer.killProcess(pid)` → `onExit`
  cascade, which `RuntimeManager` also listens to for cleanup.
- **Nothing about a crash reaches the rest of Computer Simulator** - every other window, process
  and app keeps working.

## Security model

`ApplicationRuntime.instantiate()` builds an explicit, minimal `WebAssembly.Imports` object
(`buildImportObject()`) - today just `env.get_input`. There is no `fetch`, no DOM, no
`localStorage`/IndexedDB access, no arbitrary browser API: everything a module can do is mediated
through the small set of host functions handed to it, each of which is a pure function of
already-permission-checked state. A module that wants a capability the runtime doesn't expose
simply can't reach it - there is no escape hatch to "the real page" the way there is, deliberately,
for the Browser app's own `srcDoc` sandbox (see CLAUDE.md's "The Virtual Internet" section) - this
runtime doesn't even give a module that much.

## WASM execution model

Runs on the **main thread**, paced by `requestAnimationFrame`, not a Web Worker. The placeholder
stub does trivial per-frame work, so a worker would only add message-passing and build complexity
for no measurable benefit. `RuntimeDisplay`'s frame buffer and `RuntimeInput`'s snapshot are both
already plain, structured-cloneable data - so moving the tick loop into a worker later is a
documented upgrade path that doesn't change either public shape.

`ApplicationRuntime.tick()` also grows the module's memory (`WebAssembly.Memory.grow`) whenever a
manifest's declared display is larger than the module's own initial memory - a module doesn't
need to over-allocate pages up front just to guess at every possible display size.

## Installation

```ts
runtime.install(manifest, files); // files: Record<relativePath, Uint8Array>
runtime.uninstall(id);
```

`RuntimeManager.install()`/`uninstall()` delegate straight to `RuntimeRegistry`. There is no
separate "package" file format in this pass (spec's `doom.package` concept) - a manifest object
plus a map of file bytes is the installation unit; `DoomRuntimeAdapter.installDoom()` is a
one-call convenience wrapper around it.

## Application registration

```ts
runtimeRegistry.register({ manifest, adapter });     // not how this pass is wired
```

was the spec's suggested API; this implementation instead reuses the *existing*
`ApplicationRegistry` (`src/apps/index.ts`) for app-level registration (icon, window size,
process name - the same thing every app already goes through) and adds `RuntimeManager` purely
for the runtime-specific concerns (manifest, sandbox, lifecycle). A future game needs exactly two
additions, neither touching `core/runtime/`:

1. An `ApplicationDefinition` entry in `src/apps/index.ts` with `component: RuntimeHostApp`.
2. An adapter module (like `DoomRuntimeAdapter.ts`) exporting a manifest + file bytes + an
   `install<Name>()` helper, wired into Game Manager's `AVAILABLE` list and `commands/games.ts`'s
   `INSTALLABLE` map.

## DOOM integration

`core/runtime/doom/DoomRuntimeAdapter.ts` and `core/runtime/stub/`. The shipped "DOOM" is a
217-byte hand-assembled WebAssembly module (`stub/generate.mjs` is the source - literal
WebAssembly binary-format bytes, built and self-checked with `node`, no Emscripten/wat2wasm
toolchain involved) that renders an animated RGBA test pattern and echoes packed input state. It
proves every part of the pipeline - install, sandboxed instantiate, display, input, resource
accounting, persistence, pause/resume, crash handling - without shipping, downloading, or
referencing any real id Software code or WAD data.

Swapping in a real engine (an Emscripten build of a GPL source port such as Chocolate Doom or
PrBoom) later means: compile it to `.wasm` with `update(dt)`/`render(ptr,w,h)` exports matching
`ApplicationRuntime`'s calling convention, drop it into a manifest via
`DoomRuntimeAdapter.doomStubFiles()`'s replacement, and nothing in `core/runtime/` changes.

A **user-supplied IWAD** is required to actually play - the runtime never bundles, downloads or
parses commercial DOOM game data. `RuntimeHostApp` shows a "Select File" picker
(`hasWad()`/`DOOM_WAD_RELATIVE_PATH`) when none is present under the sandboxed
`saves`-sibling `wad/` directory; the picked bytes are written through the same
`RuntimeFileProvider.writeFile()` every other save/config write goes through. The stub engine
doesn't parse the WAD's contents - only that one exists - since validating real IWAD data is a
concern for whatever real engine eventually replaces the stub, not for the runtime layer.

## Known simplifications (documented, not accidental)

- Reported CPU/memory is a synthetic, jittered sample, not a real measurement (the browser can't
  expose real per-WASM-module cost) - but it flows through the same fields every other process
  uses, so it behaves identically from Task Manager's point of view.
- Permissions are granted wholesale at install time; there's no runtime prompt UI.
- The WASM tick loop runs on the main thread; a Web Worker is a documented future upgrade with no
  breaking changes to `RuntimeDisplay`/`RuntimeInput`'s public shape.
- `RuntimeInstance` live state (running/paused/crashed, current frame) is not persisted across a
  reload - a restored runtime window re-attaches a fresh instance the same way a restored Terminal
  window gets a fresh shell, not a replayed session.
