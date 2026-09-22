# Computer Simulator

An interactive simulation of a personal computer that runs entirely in the browser: its own
desktop, window manager, virtual file system, process manager, terminal shell and a handful of
built-in applications. Everything is persisted locally with IndexedDB.

## Getting started

```bash
npm install
npm run dev       # start the dev server (http://localhost:5173)
npm run test      # run the unit test suite (vitest)
npm run typecheck # strict TypeScript check
npm run build     # production build (dist/)
```

## Architecture

```
src/
├── core/            UI-independent simulation logic
│   ├── filesystem/   VirtualFileSystem: create/read/write/delete/move/copy/trash...
│   ├── process/       ProcessManager: pids, cpu/memory usage, kill/suspend
│   ├── hardware/       VirtualCPU, VirtualMemory, VirtualDisk
│   ├── applications/    ApplicationRegistry - apps register themselves, nothing else
│   │                     needs to know they exist
│   ├── windows/         WindowManager: geometry, stacking, focus (no React)
│   ├── settings/        SettingsManager
│   ├── notifications/   NotificationCenter
│   ├── shell/            Command parser + pluggable Command registry + Shell session
│   ├── storage/          IndexedDB/memory backends, ComputerStorage, AutoSaver
│   └── computer/         VirtualComputer glues all of the above together
│
├── apps/             One folder per application (files, terminal, editor, task-manager,
│                      settings, stress) - each registers itself in apps/index.ts
├── desktop/          Desktop, WindowManager (React chrome), Taskbar, Launcher
├── components/       Shared UI: icons, context menu, dialogs, meters
├── store/             Zustand stores: computer lifecycle, UI state, file actions
├── hooks/             React bindings onto the core's observables
└── utils/             path/glob/format helpers, Observable base class
```

The core layer (`src/core`) has no dependency on React; `VirtualComputer` can be constructed,
driven and inspected from plain TypeScript (see `src/core/__tests__`). The UI subscribes to it
through small `Observable` classes and `useSyncExternalStore`.

Adding a new application means registering an `ApplicationDefinition` in `src/apps/index.ts` -
the desktop, launcher, window manager and task manager never need to change. Adding a new shell
command means adding a `Command` to `src/core/shell/commands` - the terminal itself is unaware of
the concrete command list.

## Notes

This is a simulation, not an emulator: there is no real machine code execution, no real file
system access and no networking. The goal is a convincing, extensible desktop-OS experience
entirely inside the browser tab.
