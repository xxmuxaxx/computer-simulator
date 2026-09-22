# Virtual Application & Game Runtime

This document describes `src/core/runtime/`: a sandboxed WASM application runtime layered on top
of the existing virtual OS primitives (`VirtualFileSystem`, `ProcessManager`, `WindowManager`,
`ApplicationRegistry`). DOOM is its first proof case, and runs on a real, third-party WASM DOOM
engine (see [DOOM integration](#doom-integration)) - the runtime itself is engine-agnostic and
was first proven against a tiny hand-assembled placeholder module that still ships as
`core/runtime/stub/` and backs the test suite.

## Architecture

```
VirtualComputer
    │
    ├── fileSystem, processManager, windowManager, notifications   (existing)
    │
    └── runtime: RuntimeManager                                     (peer subsystem)
            │
            ├── registry: RuntimeRegistry        - installed manifests, backed by /apps/<id>/
            ├── events: RuntimeEventBus           - lifecycle pub/sub (started/paused/crashed/...)
            └── instances: Map<pid, RuntimeInstance>
                    │
                    ├── ApplicationRuntime         - engine-agnostic sandboxed instantiate/tick
                    ├── engines/ (EngineAdapter)    - resolveEngineAdapter(manifest.engine, host)
                    │     ├── stubEngine.ts           the placeholder test engine
                    │     └── doom/DoomEngineAdapter   real doom.wasm's 10 imports/4 exports
                    ├── RuntimeDisplay              - RGBA frame buffer
                    ├── RuntimeInput                - permission-gated input state
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
keyboard/mouse events into the instance. It never touches the WASM module directly, and it knows
nothing about which engine is backing a given manifest.

### Engines are pluggable, not hardcoded

`ApplicationRuntime`/`RuntimeInstance` never assume a particular import/export shape. Every
engine-specific detail - what a module imports, how it renders a frame, how input reaches it -
lives behind the `EngineAdapter` interface (`core/runtime/engines/types.ts`):

```ts
interface EngineAdapter {
  createImports(): WebAssembly.Imports;
  bind(instance: WebAssembly.Instance, memory: WebAssembly.Memory): void;
  init(): void;
  tick(dtMs: number): void;
  handleKeyDown?(domKey: string): void;
  handleKeyUp?(domKey: string): void;
  preferredTickIntervalMs?: number;
}
```

`RuntimeManifest.engine` (e.g. `'stub'` or `'doom-wasm'`) selects which adapter factory handles a
given instance, resolved via `core/runtime/engines/index.ts`'s small `ENGINE_ADAPTERS` map -
exactly the same "one aggregating file, several leaf modules" pattern as
`commands/index.ts`'s `builtinCommands` or `apps/index.ts`'s app registrations. Two engines exist
today:

- **`stub`** (`engines/stubEngine.ts`): host-driven. The host calls `update(dt)` then
  `render(ptr, w, h)` and copies pixels out of a fixed offset itself. This is what the placeholder
  module in `core/runtime/stub/` implements, and what proved the whole pipeline before any real
  engine was involved.
- **`doom-wasm`** (`doom/DoomEngineAdapter.ts`): module-driven. The host calls `tickGame()`, and
  *the module* calls back into an imported `ui.drawFrame(ptr)` function whenever a frame is ready
  - a fundamentally different calling convention, which is exactly why this abstraction exists
  rather than being hardcoded to the stub's shape.

Adding a third engine (another game entirely) means writing one more `EngineAdapter` and adding
one entry to `ENGINE_ADAPTERS` - nothing else in `core/runtime/` changes.

## Manifest

```ts
interface RuntimeManifest {
  id: string;
  name: string;
  version: string;
  type: 'wasm' | 'game' | 'application';
  engine: string;                   // which EngineAdapter drives this module, e.g. 'doom-wasm'
  executable: string;                // path to the .wasm file, relative to /apps/<id>/
  icon?: string;
  description?: string;
  memoryUsage: number;               // MB, reserved at launch like any ApplicationDefinition
  cpuUsage?: number;                  // baseline % reported once running
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

`RuntimeFileProvider` is the *only* filesystem access a runtime application (or its engine
adapter) has. It is constructed with a fixed root - `/home/user/games/<id>/` - and every path is
resolved against that root and rejected with `EPERMISSION` if it would escape it (checked via
`utils/path.ts`'s `isInside`), regardless of `..` segments or absolute-looking input. It never
sees `/apps/<id>/` (the installed package itself, read directly by `RuntimeManager` at attach
time) or anything else on the real filesystem.

Save games, configuration, screenshots and any user-supplied WAD are just ordinary files under
this root (`saves/`, `config/`, `screenshots/`, `wad/`, created on first attach) - **not** a
second persistence system. They round-trip through the exact same `filesystem` key in
`ComputerSnapshot` that every other file already uses.

## Input adapter

`RuntimeHostApp` forwards DOM events to `RuntimeInstance.reportKeyDown(key)` /
`reportKeyUp(key)` / `reportMouseMove(x, y, buttons)` (`key` is `KeyboardEvent.key`, e.g.
`"ArrowLeft"` or `"a"`). `RuntimeInstance` permission-checks the event, updates `RuntimeInput`'s
buffered, permission-gated snapshot (`{ keys, mouseX, mouseY, mouseButtons }`, plus a packed
single-word form for adapters that poll it, like the stub), and forwards it to the active
`EngineAdapter`'s `handleKeyDown`/`handleKeyUp` for adapters that push input via a direct export
call instead (like DOOM's `reportKeyDown`/`reportKeyUp` exports). The sandboxed module itself
never registers a real `window`/`document` event listener.

## Display adapter

`RuntimeDisplay` owns a plain `Uint8ClampedArray` RGBA frame buffer (`getFrameBuffer()`), sized
from the manifest's `display.width`/`height`. `core/` never constructs a browser `ImageData`
object itself (that's a DOM global, not something a UI-independent layer should depend on) -
`RuntimeHostApp` is what does `new ImageData(new Uint8ClampedArray(buffer), w, h)` and
`ctx.putImageData(...)`, once per animation frame, decoupled from the engine's own tick cadence.
Whatever pixel format an engine's own frame buffer uses (DOOM's is BGRA) is converted to RGBA by
that engine's own adapter before it ever reaches `RuntimeDisplay`.

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
- **Tick pacing**: `RuntimeInstance`'s frame loop is driven by `requestAnimationFrame`, but an
  adapter can set `preferredTickIntervalMs` to be ticked less often - DOOM sets this to `1000/35`
  (its native tic rate) so the host doesn't call `tickGame()` at 60 Hz and force doom.wasm's own
  internal pacing logic to busy-wait every other frame, mirroring the engine's own reference
  browser example (`setInterval(tickGame, 1000/35)`).
- **Crash handling**: `RuntimeInstance`'s own frame loop wraps every WASM call in try/catch (a
  React `ErrorBoundary` alone can't see an exception thrown inside a `requestAnimationFrame`
  callback). On any failure - a bad manifest, a failed `WebAssembly.instantiate`, or a trap during
  a tick - the instance transitions to `crashed`, posts an "Application crashed" notification, and
  stops its frame loop. **The process is left alive**, not auto-killed: Task Manager still lists
  it, and `RuntimeHostApp` shows a Restart overlay (`RuntimeManager.restart(pid)` disposes and
  re-attaches a fresh instance for the same pid/window). Killing it goes through the ordinary
  `computer.killProcess(pid)` → `onExit` cascade, which `RuntimeManager` also listens to for
  cleanup.
- **Nothing about a crash reaches the rest of Computer Simulator** - every other window, process
  and app keeps working.

## Security model

`ApplicationRuntime.instantiate()` calls the active `EngineAdapter.createImports()` to build the
exact, explicit `WebAssembly.Imports` object a module is instantiated with - for the stub, just
`env.get_input`; for doom.wasm, its documented 10 functions across 5 namespaces (`loading.*`,
`runtimeControl.timeInMilliseconds`, `ui.drawFrame`, `gameSaving.*`, `console.*`), each
implemented as a pure function of already permission-checked host state
(`RuntimeFileProvider`/`RuntimeInput`/`RuntimeDisplay`/the sandboxed clock). There is no `fetch`,
no DOM, no `localStorage`/IndexedDB access, no arbitrary browser API reachable from inside the
module: everything it can do is mediated through whichever adapter is driving it. A module that
wants a capability the runtime doesn't expose simply can't reach it - there is no escape hatch to
"the real page" the way there is, deliberately, for the Browser app's own `srcDoc` sandbox (see
CLAUDE.md's "The Virtual Internet" section) - this runtime doesn't even give a module that much.

## WASM execution model

Runs on the **main thread**, paced by `requestAnimationFrame` (see "Tick pacing" above for how an
adapter can slow that down). Both shipped engines do modest per-frame work, so a Web Worker would
only add message-passing and build complexity for no measurable benefit today. `RuntimeDisplay`'s
frame buffer and the input snapshot are both already plain, structured-cloneable data - so moving
the tick loop into a worker later is a documented upgrade path that doesn't change either public
shape.

The stub engine's adapter also grows its module's memory (`WebAssembly.Memory.grow`) whenever a
manifest's declared display is larger than the tiny placeholder's own initial memory - real
doom.wasm manages its own memory growth internally and needs no such help.

## Installation

```ts
await runtime.install(manifest, files); // files: Record<relativePath, Uint8Array>
runtime.uninstall(id);
```

`RuntimeManager.install()`/`uninstall()` delegate straight to `RuntimeRegistry` (which itself is
synchronous - writing already-fetched bytes into the VFS). Obtaining those bytes can be async: the
stub's are a tiny embedded base64 constant (`installDoom` for the stub-era code used this), while
`DoomRuntimeAdapter.installDoom()` `fetch()`es the real ~4.5 MB engine binary from a static asset
first. There is no separate "package" file format in this pass (spec's `doom.package` concept) -
a manifest object plus a map of file bytes is the installation unit.

## Application registration

```ts
runtimeRegistry.register({ manifest, adapter });     // not how this pass is wired
```

was the spec's suggested API; this implementation instead reuses the *existing*
`ApplicationRegistry` (`src/apps/index.ts`) for app-level registration (icon, window size,
process name - the same thing every app already goes through) and adds `RuntimeManager` purely
for the runtime-specific concerns (manifest, sandbox, lifecycle). A future game needs:

1. An `ApplicationDefinition` entry in `src/apps/index.ts` with `component: RuntimeHostApp`.
2. An `EngineAdapter` in `core/runtime/engines/` (only if its WASM interface doesn't already match
   an existing adapter) plus one entry in `ENGINE_ADAPTERS`.
3. An adapter module (like `DoomRuntimeAdapter.ts`) exporting a manifest + a way to obtain the
   file bytes + an `install<Name>()` helper, wired into Game Manager's `AVAILABLE` list and
   `commands/games.ts`'s `INSTALLABLE` map.

None of this touches `ApplicationRuntime.ts`, `RuntimeInstance.ts` or `RuntimeManager.ts`.

## DOOM integration

**Engine**: [jacobenget/doom.wasm](https://github.com/jacobenget/doom.wasm) (GPL-2.0), release
[v0.1.0](https://github.com/jacobenget/doom.wasm/releases/tag/v0.1.0)
(`doom-v0.1.0.wasm`, commit `24bb772`). Chosen specifically for its deliberately minimal
interface - 10 imports, 4 exports, one exported memory - documented in the project's own
`doom.wasm.interface.txt` and `src/doom_wasm.h`. `DoomEngineAdapter.ts`
(`core/runtime/doom/DoomEngineAdapter.ts`) implements that interface as an `EngineAdapter`:

- `loading.onGameInit(width, height)` - records the engine's actual frame size. This build
  reports **640x400**, not vanilla DOOM's 320x200 (it auto-scales its native resolution 2x
  internally) - `createDoomManifest().display` was verified against this build's real startup
  log and corrected to match, since `RuntimeDisplay` is sized from the manifest *before* the
  module loads and `drawFrame()` copies exactly `width*height*4` bytes out of the engine's actual
  buffer every frame; a mismatch there silently renders a sheared/cropped picture rather than
  throwing anything.
- `loading.wadSizes` / `loading.readWads` - report/deliver a custom WAD from
  `RuntimeFileProvider`'s `wad/DOOM.WAD` if the player supplied one *and* `isValidWadHeader()`
  accepts it (checks for the 4-byte `IWAD`/`PWAD` magic); otherwise left untouched (its value on
  entry is already 0), which tells the engine "load the built-in Doom Shareware WAD" - the engine
  has that WAD compiled in (`DOOM1.WAD`, fetched at *the engine's own build time* from
  `https://distro.ibiblio.org/slitaz/sources/packages/d/doom1.wad` per its Makefile), id
  Software's officially, explicitly freely-distributable shareware episode ("Knee-Deep in the
  Dead"). **No commercial IWAD is bundled, downloaded or referenced anywhere in this repository
  or by this adapter.** The header check is validated twice - once by `RuntimeHostApp` before it
  ever writes an uploaded file, and again by `DoomEngineAdapter.wadSizes()` itself (in case a
  malformed WAD reaches `wad/DOOM.WAD` some other way, e.g. edited directly via Terminal/Files) -
  because this specific engine build doesn't fail gracefully on a malformed WAD: its `W_Init`
  treats it as fatal and can spin instead of returning control to the host, which hung the whole
  tab during verification until this check was added. A rejected file falls back to the built-in
  Shareware WAD exactly like "no WAD supplied," rather than surfacing a special error path.
- `runtimeControl.timeInMilliseconds()` - the sandboxed clock, as a `BigInt` (WASM `i64`).
- `ui.drawFrame(ptr)` - the engine calls this itself once a frame is ready; the adapter converts
  its BGRA pixel buffer to RGBA (swapping red/blue, forcing full alpha) into `RuntimeDisplay`.
- `gameSaving.*` - real save-game persistence, round-tripped through
  `RuntimeFileProvider` as `saves/slot<id>.dsg`; any failure (e.g. a future manifest without
  `fs:write`) is caught and reported as "0 bytes", matching the engine's own documented contract
  for "saving isn't supported" rather than throwing.
- `console.onInfoMessage` / `onErrorMessage` - forwarded to the browser console via `EngineHost.log`.

Keys are mapped from `KeyboardEvent.key` to doom.wasm's numeric `doomKey` values: named keys
(arrows, Ctrl→fire, Space→use, Shift/Tab/Escape/Enter/Backspace/Alt) are matched against the
engine's own exported `KEY_*` globals (read once in `init()`, since their values aren't fixed
across builds), and any other single printable character falls back to its ASCII code - exactly
mirroring the engine project's own reference browser example.

**The engine binary itself is not committed to this repository.** It's a ~4.5 MB third-party GPL
binary, so `public/runtime/doom/doom.wasm` is gitignored; `public/runtime/doom/README.md`
documents where to download it from (the release above) and `DoomRuntimeAdapter.fetchDoomEngineBytes()`
fetches it from that path at install time (Game Manager's Install button, or `games install doom`)
and writes it into the VFS the same way any other runtime package's files are installed.

The generic runtime pipeline (install/launch/sandbox/persistence/crash-handling) is exercised by
the automated test suite entirely against the placeholder **stub** engine (see
`runtime-*-test.ts`), which needs no network access or third-party file - it's what proved the
architecture before any real engine was integrated, and it's what CI actually runs.
`DoomEngineAdapter`'s own translation logic (key mapping, BGRA conversion, WAD protocol, save
games) is unit-tested directly (`runtime-doom-adapter.test.ts`) by calling its import functions
against a fake `WebAssembly.Instance`, also without touching the real binary. Whether the real
doom.wasm binary actually plays correctly is verified manually in the browser once it's present
on disk - not part of the automated suite, since the file is deliberately not vendored.

## Known simplifications (documented, not accidental)

- Reported CPU/memory is a synthetic, jittered sample, not a real measurement (the browser can't
  expose real per-WASM-module cost) - but it flows through the same fields every other process
  uses, so it behaves identically from Task Manager's point of view.
- Permissions are granted wholesale at install time; there's no runtime prompt UI.
- The WASM tick loop runs on the main thread; a Web Worker is a documented future upgrade with no
  breaking changes to `RuntimeDisplay`/input's public shape.
- `RuntimeInstance` live state (running/paused/crashed, current frame) is not persisted across a
  reload - a restored runtime window re-attaches a fresh instance the same way a restored Terminal
  window gets a fresh shell, not a replayed session. Save games (a *file*, not live state) do
  persist, since they're ordinary VFS content.
