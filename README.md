# Computer Simulator

An interactive simulation of a personal computer that runs entirely in the browser: its own
desktop, window manager, virtual file system, process manager, terminal shell, a small virtual
network and a handful of built-in applications. Everything is persisted locally with IndexedDB.

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
│   ├── network/          NetworkManager: devices, interfaces, routing, DHCP, DNS,
│   │                      firewalls, services and an HTTP simulation
│   └── computer/         VirtualComputer glues all of the above together
│
├── apps/             One folder per application (files, terminal, editor, task-manager,
│                      settings, stress, network-manager, network-monitor, server-manager,
│                      browser) - each registers itself in apps/index.ts
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

## The virtual network

`core/network` simulates a small LAN: virtual computers, servers, routers and switches, each with
their own IP/MAC addresses, connected into a topology you build in the **Network Manager** app.
Packets are actually routed hop by hop (switches bridge transparently, routers consult their own
routing table), so `ping`, `traceroute`, `nslookup`, DHCP leases and HTTP requests in the
**Browser** app all go through the same real delivery path - nothing is mocked. **Network
Monitor** shows the live event log (with a packet inspector), and **Server Manager** starts/stops
services on any device, including ones other than the computer you're using. A demo network
(router + switch + a server running an HTTP site) is created the first time you boot.

## Notes

This is a simulation, not an emulator: there is no real machine code execution, no real file
system access and no real networking - every packet, DNS lookup and HTTP request happens entirely
inside `core/network`, never touching the actual browser network stack. The goal is a convincing,
extensible desktop-OS experience entirely inside the browser tab.
