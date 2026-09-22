# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Computer Simulator is a browser-based simulation of a personal computer: its own desktop, window
manager, virtual file system, process manager, terminal shell, a virtual network, a fully virtual
Internet built on top of it, a sandboxed WASM application runtime, and a handful of built-in
applications (Files, Terminal, Text Editor, Task Manager, Settings, Network Manager, Network
Monitor, Server Manager, Browser, Domain Manager, Hosting Manager, Website Builder, Virtual
Search, Internet Control Panel, Game Manager, Runtime Monitor, a demo "System Benchmark" app, and
DOOM — a placeholder game proving the runtime end-to-end). All state is persisted locally via
IndexedDB — there is no backend. It is a simulation, not an emulator: no real machine code
execution, no real file system access, and no real networking — every device, packet, DNS lookup
and HTTP request lives entirely inside `core/network` and `core/internet`, and every runtime
application is sandboxed inside `core/runtime` (see "The virtual network", "The Virtual
Internet" and "The Virtual Application & Game Runtime" below).

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
│   │                              (src/core/shell/commands/*, including commands/network.ts)
│   ├── storage/                   StorageBackend abstraction (IndexedDBBackend / MemoryBackend),
│   │                              ComputerStorage (load/save/reset), AutoSaver (debounced,
│   │                              subscribes to the observables above, including network)
│   ├── network/                   NetworkManager — devices, interfaces, connections, routing,
│   │                              DHCP, DNS, firewalls, services and HTTP (see "The virtual
│   │                              network" below). Zero dependency on React, same Observable
│   │                              pattern as everything else in core/.
│   ├── internet/                   InternetManager — domains, DNS zones, website hosting/APIs,
│   │                              HTTPS certificates, a search engine and the Browser's own
│   │                              profile, all built on core/network's public API (see "The
│   │                              Virtual Internet" below). Zero dependency on React.
│   ├── runtime/                    RuntimeManager — installs, sandboxes and runs WASM
│   │                              applications (games first) as real ProcessManager processes
│   │                              and WindowManager windows (see "The Virtual Application &
│   │                              Game Runtime" below, and docs/runtime.md). Zero dependency
│   │                              on React.
│   └── computer/                  VirtualComputer — the composition root. Owns one instance of
│                                   every core manager including NetworkManager,
│                                   InternetManager and RuntimeManager, wires process↔memory↔
│                                   window lifecycles together (killing a process closes its
│                                   windows, closing a window frees its memory and kills its
│                                   process, etc.), and exposes snapshot()/restore for
│                                   persistence.
│
├── apps/                    One folder per application (files/, terminal/, editor/,
│                              task-manager/, settings/, stress/, network-manager/,
│                              network-monitor/, server-manager/, browser/, domain-manager/,
│                              hosting-manager/, website-builder/, search/,
│                              internet-control-panel/, game-manager/, runtime-monitor/,
│                              runtime/ [the generic RuntimeHostApp shared by every runtime
│                              app, e.g. DOOM]). Each app is a plain React component
│                              receiving `{ windowId, pid, args }` (src/apps/types.ts).
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

`ComputerSnapshot` (`core/computer/snapshot.ts`, `SNAPSHOT_VERSION`) bundles the file system,
settings, installed apps, window layout, the network snapshot and the internet snapshot (domains,
DNS records, websites/API endpoints, certificates, the search index, and the Browser's own
history/bookmarks/cookies). Installed runtime packages and game saves are **not** a separate
snapshot field — they're ordinary files under `/apps/<id>/` and `/home/user/games/<id>/`, already
covered by the `filesystem` key (see "The Virtual Application & Game Runtime" below); adding
`RuntimeManager` did not bump `SNAPSHOT_VERSION`. `AutoSaver` subscribes to the relevant
observables (including `computer.network` and `computer.internet`) and debounce-saves via
`ComputerStorage`,
which wraps a `StorageBackend` (IndexedDB in the browser, falling back to an in-memory backend —
and marking the computer "volatile" with a notification — if IndexedDB is unavailable). On boot,
`store/computerStore.ts` loads the last snapshot and restores windows by re-launching each app
with its saved args/bounds. Bumping `SNAPSHOT_VERSION` invalidates every existing saved snapshot
(the loader refuses anything with a mismatched version) — there is no migration path, only a
clean reset to defaults, which is intentional for a project still under active development.

### The virtual network

`core/network/NetworkManager.ts` is a second composition root living alongside `VirtualComputer`'s
other managers (`computer.network`), not a separate app: it models more than one machine even
though only one of them (`network.localDeviceId`) is the computer the user is actually sitting at.

- **Devices** (`computer`/`server`/`router`/`switch`) each have one or more `NetworkInterface`s
  (MAC via `network/mac.ts`, optional IP/mask/gateway/DNS, up/down status). The local device's
  interface is backed by the real `VirtualComputer.fileSystem` (so `/etc/hosts` and `/var/www` are
  editable from Files/Terminal); every other device gets its own private `VirtualFileSystem`
  instance held only inside its `DeviceRecord` (see `types.ts`), used for its `/var/www` site and
  `/etc/hosts`.
- **Topology** is a graph of `Connection`s between interfaces. `routing.ts` resolves delivery in
  two steps: `resolveInSegment`/`discoverSegment` do a same-broadcast-domain BFS that treats
  switches as transparent (their ports get mutual adjacency) and routers as boundaries; then
  `resolvePath` walks a packet across that graph, and every time it reaches a router (on any
  interface) that router makes an independent routing-table decision (`bestRoute`, longest-prefix
  match, `0.0.0.0/0` as the default route), so chains of routers work correctly. TTL is decremented
  once per hop.
- **`network.sendPacket()`** is the single real send path: it looks up the source device, checks
  its outbound firewall, resolves the path, checks the destination's inbound firewall, and returns
  a `PacketResult` (hops, latency, delivered/error). `ping()`/`traceroute()`/`httpRequest()` are all
  built on top of it — nothing fakes a result without actually routing a packet through the graph.
- **DHCP** (`dhcp.ts`) allocates/renews leases from a router's configured pool (`requestDhcp`).
  **DNS** (`dns.ts`) is one `DnsRegistry` per `Network` (a CIDR block, `network.createNetwork()`);
  `resolveDns()` checks the device's own `/etc/hosts` first, then every registry. **Firewalls**
  (`firewall.ts`) evaluate a device's ordered rule list, first match wins, default allow.
  **Services** (`services.ts`) are per-device listening ports; starting one on the local device
  also spawns a real `ProcessManager` process, so Task Manager and `ps` see it too.
- **Events**: `network.on('packet:sent' | 'packet:delivered' | 'packet:dropped' | 'dns:query' |
  'firewall:blocked' | 'service:started' | ... , handler)` is a plain typed pub/sub
  (`network/events.ts`), independent of the `Observable` version counter used for React re-renders
  — Network Monitor subscribes to these directly instead of polling.
- A default "Home Network" (router + switch + server, all seeded from `network/seed.ts`) is
  created the first time a computer boots with no saved snapshot; the server runs an HTTP service
  with a demo site under `/var/www`.

New network-aware terminal commands live in `core/shell/commands/network.ts` (`ip`, `ifconfig`,
`ping`, `traceroute`, `arp`, `route`, `nslookup`, `netstat`, `server`) and all operate on the
*local* device only — reaching another device's services (e.g. stopping HTTP on `server.local`) is
done through the Network Manager or Server Manager apps instead, the same way a real shell can't
administer a remote host without something like SSH.

### The Virtual Internet

`core/internet/InternetManager.ts` (`computer.internet`) is a third composition root, built
entirely on `NetworkManager`'s public API — it never bypasses DNS resolution or packet routing,
and `core/network` never imports from `core/internet` (the dependency only goes one way).

- **Domains** (`domains/DomainRegistry.ts`): register/check/renew/release/whois, with a
  `DomainStatus` of `active`/`expired`/`reserved` and default `ns1`/`ns2.virtual-dns` nameservers.
- **DNS** (`dns/DnsZoneManager.ts`) stores per-domain A/AAAA/CNAME/MX/TXT/NS records, but only
  A and CNAME chains actually resolve to anything (the rest are architectural, per spec) —
  whenever a domain/record changes, `DnsZoneManager` recomputes the effective hostname→IP mapping
  and pushes/removes it from the correct `Network`'s existing `DnsRegistry` via
  `network.setDnsRecord`/`removeDnsRecord` (chosen by `network.findNetworkForIp`). The *only* thing
  that ever resolves a hostname during a real request is still `network.resolveDns` — this class
  just keeps it in sync.
- **Hosting** (`hosting/HostingRegistry.ts`) is installed as `NetworkManager`'s HTTP content
  resolver via `network.setHttpHandler` (see `NetworkManagerOptions`/`HttpHandler` in
  `network/types.ts` — the transport layer stays generic; `core/internet` is what actually decides
  what a listening HTTP service serves). It resolves a `Website` by `Host` header (several sites
  can share one server), enforces enabled/visibility/`allowedNetworks`, matches registered
  `ApiEndpoint`s before falling back to static files, issues a session cookie on first visit,
  writes `/var/log/http/{access,error}.log` on the target device, and tracks per-site
  `WebsiteStats`. A request for a host with no matching `Website` falls back to the device's flat
  `/var/www` (this is what keeps the original seeded `server.local` site working unmodified).
- **Certificates** (`certificates/CertificateAuthority.ts`) are an explicitly non-cryptographic
  HTTPS simulation: one certificate per exact domain name, `valid`/`expired`/`invalid`. Creating or
  updating a website with `https: true` both issues a certificate *and* starts the `https` service
  on port 443 (via `network.startService`) — a cert alone doesn't make the port answer, the same
  way a real server needs something bound to 443, not just a certificate on disk.
- **Search** (`search/SearchEngine.ts`) crawls via `network.httpRequest` exactly like the Browser
  does — no real `fetch`. It respects `/robots.txt`, follows `/sitemap.xml`, builds an inverted
  index plus a link graph for ranking, and marks unreachable links as broken. `search.virtual` is a
  `Website` with `kind: 'dynamic-search'`; `HostingRegistry` recognizes `/search?q=...` on that
  kind and renders live results server-side via `SearchEngine.renderResultsPage`, which is what
  makes `http://search.virtual` work from the real Browser, not just the dedicated Search app.
- **Browser profile** (`web/BrowserProfile.ts`, `computer.internet.browser`) holds history,
  bookmarks, and per-origin (`web/origin.ts`: scheme+host+port) cookies and local/session storage,
  isolated exactly like a real browser's same-origin policy. `web/sandbox.ts` wraps every served
  HTML page with a strict CSP and a `console.*` → `postMessage` bridge before the Browser app sets
  it as an iframe's `srcDoc` (`sandbox="allow-scripts"`, no `allow-same-origin`): page JavaScript
  can run and mutate its own DOM, but can't reach the real network, the real filesystem or the
  parent window.
- A default Internet (`internet/seed.ts`: `computer.local`, `news.local`, `docs.local`,
  `shop.local`, plus `search.virtual`) is registered, hosted on the seeded `server.local`, and
  crawled the first time a computer boots with no saved snapshot — the same pattern as
  `network/seed.ts`'s default network.

New internet-aware terminal commands live in `core/shell/commands/internet.ts` (`domain`, `dns`,
`website`, `cert`, `curl`, `wget`, `whois`). Unlike the local-only network commands above, these
operate on the Internet control plane (domains/DNS/websites/certificates are global resources, not
a specific device to "log into") — the same distinction `NetworkManager`'s cross-device
`configureInterface`/`startService` already draws for the GUI apps.

### The Virtual Application & Game Runtime

`core/runtime/RuntimeManager.ts` (`computer.runtime`) is a fourth composition root, a peer of
`NetworkManager`/`InternetManager`. It lets third-party WASM applications — games first — be
installed, sandboxed and run as ordinary virtual processes/windows. Full design in
`docs/runtime.md`; the key architectural invariant is: **a runtime-backed app is launched through
the completely unmodified `computer.launch(appId)` path**, so `WindowManager`, `ProcessManager`
and Task Manager needed zero changes to support it.

- **Manifests** (`RuntimeManifest`: id/name/version/type/executable/permissions/display/...) are
  installed by `RuntimeRegistry` as `/apps/<id>/manifest.json` + package files, written into the
  *existing* `VirtualFileSystem` (no second persistence system) and locked down exactly like
  `seedFileSystem()` locks `/apps/*.app` — briefly unlocking `/apps` for the duration of an
  install/remove and always re-locking it afterwards.
- **Launch**: an app whose `ApplicationDefinition.component` is the generic
  `RuntimeHostApp` (`src/apps/runtime/RuntimeHostApp.tsx`) calls
  `computer.runtime.attach(pid, windowId, appId)` on mount, which creates a sandboxed
  `RuntimeInstance` for that pid and starts it.
- **Sandbox**: `ApplicationRuntime.instantiate()` builds an explicit, minimal
  `WebAssembly.Imports` object — no `fetch`, no DOM, no globals. A module only ever gets a
  `RuntimeFileProvider` (scoped to `/home/user/games/<id>/`, permission-gated, can't escape its
  root), a `RuntimeInput` snapshot (buffered keyboard/mouse, never a real event listener) and a
  `RuntimeDisplay` frame buffer (`Uint8ClampedArray`, painted onto a `<canvas>` by
  `RuntimeHostApp` — `core/` itself never touches the DOM `ImageData` type).
- **Resource accounting** reuses the existing `Process` shape via a new, small
  `ProcessManager.reportUsage(pid, { cpuUsage?, memoryUsage? })` method (mirrors `boost()`'s
  spike but sets a sustained baseline) — Task Manager shows a runtime-hosted app like any other
  process, no Task Manager changes needed.
- **Lifecycle**: `starting → running ⇄ paused → stopped`, plus `crashed` on any thrown error
  during a tick (a WASM trap, a failed instantiate, ...). Minimize/restore pauses/resumes
  automatically, riding the same minimized→sleeping process-status sync `VirtualComputer.tick()`
  already does. A crash posts a notification and stops the frame loop but **leaves the process
  alive** — Task Manager and Runtime Monitor still see it — rather than auto-killing it.
- DOOM (`core/runtime/doom/`) is the first proof case: a hand-assembled 217-byte placeholder WASM
  module (`core/runtime/stub/generate.mjs`), not real id Software code or WAD data. The runtime
  API is shaped so a real engine drops in later as a manifest + `.wasm` swap, no `core/runtime/`
  changes required.

New games/runtime-app terminal commands live in `core/shell/commands/games.ts` (`games
list|install|run|stop|info|remove`), following the same single-command-with-subcommands style as
`domain`/`dns`/`website` in `commands/internet.ts`.

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

Every expected failure (missing file, disk full, permission denied, unknown pid, host unreachable,
connection refused, DNS lookup failed, blocked by firewall, a runtime sandbox permission denial,
a WASM load/trap failure, ...) is a `SystemError` with a `code`
(`core/errors.ts`) and a human-readable message. Shell commands catch these per-target (see
`commands/helpers.ts`'s `forEachTarget`) so e.g. `rm a.txt b.txt` reports a partial failure instead
of aborting; UI code funnels them through `computer.attempt()` / `computer.reportError()` into the
notification center. `PacketResult.errorCode` reuses the same `ErrorCode` union so a dropped
packet's reason and a thrown `SystemError`'s reason are always the same vocabulary.
