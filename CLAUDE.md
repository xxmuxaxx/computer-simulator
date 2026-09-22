# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Computer Simulator is a browser-based simulation of a personal computer: its own desktop, window
manager, virtual file system, process manager, terminal shell, and a handful of built-in
applications (Files, Terminal, Text Editor, Task Manager, Settings, a demo "System Benchmark"
app). All state is persisted locally via IndexedDB — there is no backend. It is a simulation, not
an emulator: no real machine code execution, no real file system access, no networking.

## Commands

```bash
npm run dev         # start the Vite dev server (http://localhost:5173)
npm run build        # tsc --noEmit, then production build to dist/
npm run typecheck     # strict TypeScript check only (no emit)
npm run test          # run the full vitest suite once
npm run test:watch     # vitest in watch mode
npm run preview         # preview the production build
```

Run a single test file: `npx vitest run src/core/__tests__/shell.test.ts`
Run tests matching a name: `npx vitest run -t "moves files to the trash"`

Tests live in `src/core/__tests__/` (vitest config in `vite.config.ts` restricts test discovery to
`src/**/*.test.ts`, environment `node`). There is no lint script configured.

## Architecture

The codebase is strictly layered: **`src/core/` has zero dependency on React.** Every core class
(`VirtualFileSystem`, `ProcessManager`, `WindowManager`, `SettingsManager`,
`NotificationCenter`, `VirtualCPU`/`VirtualMemory`/`VirtualDisk`, `Shell`) extends the small
`Observable` base (`src/utils/Observable.ts`) — a `subscribe`/`getVersion` pair designed to plug
into React's `useSyncExternalStore`. This means core logic can be constructed, driven and asserted
against in plain TypeScript without any DOM (see `src/core/__tests__/helpers.ts` for how tests spin
up a `VirtualComputer` headlessly).

```
src/
├── core/                    UI-independent simulation
│   ├── filesystem/           VirtualFileSystem — in-memory tree, serializable to/from a
│   │                          FileSystemSnapshot; all mutations throw SystemError (core/errors.ts)
│   │                          on invalid paths, not exceptions the UI has to guess at
│   ├── process/               ProcessManager — pid allocation, cpu/mem bookkeeping, kill/suspend
│   ├── hardware/               VirtualCPU / VirtualMemory / VirtualDisk — derive load/usage from
│   │                            the process manager and file system, never store it independently
│   ├── applications/            ApplicationRegistry + InstalledApplications — apps register
│   │                             themselves (see "Adding an application" below)
│   ├── windows/                  WindowManager — geometry/z-order/focus only, no rendering
│   ├── settings/, notifications/  SettingsManager, NotificationCenter
│   ├── shell/                    Command-line parser (tokenize/parse/expandWord) + Shell session
│   │                              + a CommandRegistry of pluggable Command objects
│   │                              (src/core/shell/commands/*)
│   ├── storage/                   StorageBackend abstraction (IndexedDBBackend / MemoryBackend),
│   │                              ComputerStorage (load/save/reset), AutoSaver (debounced,
│   │                              subscribes to the observables above)
│   └── computer/                  VirtualComputer — the composition root. Owns one instance of
│                                   every core manager, wires process↔memory↔window lifecycles
│                                   together (killing a process closes its windows, closing a
│                                   window frees its memory and kills its process, etc.), and
│                                   exposes snapshot()/restore for persistence.
│
├── apps/                    One folder per application (files/, terminal/, editor/,
│                              task-manager/, settings/, stress/). Each app is a plain React
│                              component receiving `{ windowId, pid, args }` (src/apps/types.ts).
│                              `src/apps/index.ts` is the single registration point.
├── desktop/                 React chrome: Desktop, WindowManager/WindowFrame (drag/resize/
│                              minimize/maximize), Taskbar, Launcher, keyboard shortcuts
│                              (useShortcuts.ts), wallpapers.
├── components/              Shared UI: Icon/AppIcon (icon name → lucide-react mapping),
│                              ContextMenu, Dialogs (promise-based modal dialogs via
│                              store/uiStore.ts's `dialogs` object), Meter/Sparkline,
│                              FileTypeIcon, ErrorBoundary (wraps every app window so one
│                              crashing app can't take down the desktop).
├── store/                   Zustand stores:
│                              - computerStore.ts: boots the VirtualComputer, owns the
│                                ComputerStorage/AutoSaver lifecycle, exposes reset()
│                              - uiStore.ts: launcher/context-menu/dialog/clipboard/switcher
│                                UI-only state, plus the `dialogs.*` promise API
│                              - fileActions.ts: user-facing file operations (create/rename/
│                                trash/paste/...) shared by the Files app and the desktop;
│                                every operation goes through computer.attempt() so failures
│                                become notifications instead of exceptions
├── hooks/                   React bindings onto core observables: useComputer() (context),
│                              useObservable.ts (useSettings/useWindows/useProcesses/...),
│                              windowCommands.ts (lets an active window respond to global
│                              shortcuts like Ctrl+S — see below)
└── utils/                   path.ts/glob.ts/format.ts/id.ts + the Observable base class
```

### VirtualComputer is the one composition root

`src/core/computer/VirtualComputer.ts` is where all the wiring happens: launching an app spawns a
process, reserves memory, and opens a window; closing a window kills its process and frees its
memory; killing a process closes its windows. `computer.attempt(fn)` is the standard way to run an
operation that might throw a `SystemError` — it reports the error as a notification and returns
`undefined` instead of propagating. UI code should prefer `attempt()` over manual try/catch.

`computer.tick()` runs once a second (`computer.start()`), advancing CPU load simulation, sampling
metrics history (for the Task Manager sparklines), and syncing process status with window
minimized state (minimized windows' processes go to `sleeping`).

### Persistence

`ComputerSnapshot` (`core/computer/snapshot.ts`) bundles the file system, settings, installed
apps and window layout. `AutoSaver` subscribes to the relevant observables and debounce-saves via
`ComputerStorage`, which wraps a `StorageBackend` (IndexedDB in the browser, falling back to an
in-memory backend — and marking the computer "volatile" with a notification — if IndexedDB is
unavailable). On boot, `store/computerStore.ts` loads the last snapshot and restores windows by
re-launching each app with its saved args/bounds.

### Adding an application

Register an `ApplicationDefinition<AppComponent>` in `src/apps/index.ts` (id, icon, memory/cpu
cost, default size, the component). Nothing else — desktop, launcher, taskbar, window manager and
task manager all read from the `ApplicationRegistry` and need no changes. An app component reads
`args` for its launch parameters (e.g. Files reads `args.path`) and can call
`computer.windowManager.setTitle/setArgs/setDirty(windowId, ...)` to keep its window chrome in
sync, and `useWindowCommands(windowId, { save, saveAs, delete, rename, newFile, open, find })` to
opt into global keyboard shortcuts routed by `desktop/useShortcuts.ts`.

### Adding a shell command

Add a `Command` (`{ name, description, execute(args, context) }`) to one of the files under
`src/core/shell/commands/` and include it in `builtinCommands` (`commands/index.ts`). The
`CommandContext` gives access to the `VirtualComputer`, the resolved cwd, env vars, stdin (for
pipelines), and helpers like `resolve()`/`setCwd()`. `Shell.ts` handles parsing (`parser.ts`:
pipes `|`, redirection `>`/`>>`, `;`, `&&`, quoting, `$VAR`/`~` expansion, globs) and is agnostic
to which commands exist — it only depends on the `CommandRegistry`.

### Errors

Every expected failure (missing file, disk full, permission denied, unknown pid, ...) is a
`SystemError` with a `code` (`core/errors.ts`) and a human-readable message. Shell commands catch
these per-target (see `commands/helpers.ts`'s `forEachTarget`) so e.g. `rm a.txt b.txt` reports a
partial failure instead of aborting; UI code funnels them through `computer.attempt()` /
`computer.reportError()` into the notification center.
