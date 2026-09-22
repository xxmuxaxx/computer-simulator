import { SystemError, errorMessage, isSystemError } from '../errors';
import { ApplicationRegistry } from '../applications/ApplicationRegistry';
import { InstalledApplications } from '../applications/InstalledApplications';
import type { LaunchArgs } from '../applications/types';
import { VirtualFileSystem } from '../filesystem/VirtualFileSystem';
import { parseShortcut, seedFileSystem, SHORTCUT_EXT } from '../filesystem/seed';
import { VirtualCPU } from '../hardware/VirtualCPU';
import { VirtualDisk } from '../hardware/VirtualDisk';
import { VirtualMemory } from '../hardware/VirtualMemory';
import { InternetManager } from '../internet/InternetManager';
import { NetworkManager } from '../network/NetworkManager';
import { NotificationCenter } from '../notifications/NotificationCenter';
import { ProcessManager } from '../process/ProcessManager';
import { RuntimeManager } from '../runtime/RuntimeManager';
import { SettingsManager } from '../settings/SettingsManager';
import { WindowManager } from '../windows/WindowManager';
import type { Bounds } from '../windows/types';
import { Observable } from '../../utils/Observable';
import { extname } from '../../utils/path';
import { uid } from '../../utils/id';
import { SNAPSHOT_VERSION, type ComputerSnapshot } from './snapshot';

export interface ComputerOptions {
  applications: ApplicationRegistry;
  snapshot?: ComputerSnapshot | null;
  random?: () => number;
  now?: () => number;
  totalMemoryMB?: number;
}

export interface LaunchOptions {
  args?: LaunchArgs;
  bounds?: Partial<Bounds>;
  title?: string;
  minimized?: boolean;
  maximized?: boolean;
}

export interface LaunchResult {
  windowId: string;
  pid: number;
}

export interface MetricsHistory {
  cpu: readonly number[];
  memory: readonly number[];
}

const HISTORY_LENGTH = 60;

/** Kernel and background processes that exist on every boot. */
const BOOT_PROCESSES = [
  { name: 'system', memoryUsage: 384, baseCpu: 1.6, kind: 'system' as const },
  { name: 'window-manager', memoryUsage: 96, baseCpu: 0.9, kind: 'service' as const },
  { name: 'desktop-shell', memoryUsage: 160, baseCpu: 1.2, kind: 'service' as const },
  { name: 'file-indexer', memoryUsage: 64, baseCpu: 0.6, kind: 'service' as const },
  { name: 'notification-daemon', memoryUsage: 32, baseCpu: 0.3, kind: 'service' as const },
];

/**
 * The virtual computer: hardware, processes, file system, windows and settings glued together.
 * It is completely UI-independent; React only observes it.
 */
export class VirtualComputer extends Observable {
  readonly id = uid('pc');
  readonly applications: ApplicationRegistry;
  readonly installedApps: InstalledApplications;
  readonly cpu: VirtualCPU;
  readonly memory: VirtualMemory;
  readonly disk: VirtualDisk;
  readonly fileSystem: VirtualFileSystem;
  readonly processManager: ProcessManager;
  readonly windowManager: WindowManager;
  readonly settings: SettingsManager;
  readonly notifications: NotificationCenter;
  readonly network: NetworkManager;
  readonly internet: InternetManager;
  readonly runtime: RuntimeManager;
  readonly startedAt: number;

  private random: () => number;
  private now: () => number;
  private timer: ReturnType<typeof setInterval> | null = null;
  private history: { cpu: number[]; memory: number[] } = { cpu: [], memory: [] };
  private historySnapshot: MetricsHistory = { cpu: [], memory: [] };

  constructor(options: ComputerOptions) {
    super();
    this.random = options.random ?? Math.random;
    this.now = options.now ?? Date.now;
    this.startedAt = this.now();
    this.applications = options.applications;

    const snapshot = options.snapshot ?? null;
    this.fileSystem = new VirtualFileSystem({ snapshot: snapshot?.filesystem, now: this.now });
    if (!snapshot) seedFileSystem(this.fileSystem, this.applications.list());
    this.disk = new VirtualDisk(this.fileSystem);
    this.memory = new VirtualMemory(options.totalMemoryMB ?? 4096);
    this.cpu = new VirtualCPU();
    this.processManager = new ProcessManager(this.now);
    this.windowManager = new WindowManager();
    this.settings = new SettingsManager(snapshot?.settings);
    this.notifications = new NotificationCenter(this.now);
    this.network = new NetworkManager({
      now: this.now,
      random: this.random,
      localFileSystem: this.fileSystem,
      localProcessManager: this.processManager,
      snapshot: snapshot?.network,
    });
    this.internet = new InternetManager({
      network: this.network,
      now: this.now,
      random: this.random,
      snapshot: snapshot?.internet,
    });
    this.runtime = new RuntimeManager({
      fileSystem: this.fileSystem,
      processManager: this.processManager,
      notifications: this.notifications,
      now: this.now,
      random: this.random,
    });

    const allIds = this.applications.list().map((a) => a.id);
    const systemIds = this.applications.list().filter((a) => a.system).map((a) => a.id);
    this.installedApps = new InstalledApplications(snapshot ? [...snapshot.installedApps, ...systemIds] : allIds);

    this.processManager.onExit((p) => {
      this.memory.free(p.pid);
      for (const w of this.windowManager.findByPid(p.pid)) this.windowManager.close(w.id);
      this.network.handleProcessExit(p.pid);
    });

    for (const spec of BOOT_PROCESSES) {
      const p = this.processManager.spawn({ ...spec, protected: true });
      this.memory.allocate(p.pid, p.memoryUsage);
    }
    this.processManager.tick(this.random);
    this.sample();

    if (snapshot) this.restoreWindows(snapshot);
  }

  // ───────────────────────────── time & simulation ─────────────────────────────

  /** Current virtual time in ms since the epoch. */
  clock(): number {
    return this.now();
  }

  uptimeMs(): number {
    return this.now() - this.startedAt;
  }

  get metricsHistory(): MetricsHistory {
    return this.historySnapshot;
  }

  /** Runs the simulation once. Called every second while the computer is powered on. */
  tick(): void {
    this.syncProcessStates();
    this.processManager.tick(this.random);
    this.cpu.update(this.processManager.totalCpu(), this.random);
    this.sample();
    this.emit();
  }

  start(intervalMs = 1000): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), intervalMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private sample(): void {
    this.history.cpu.push(this.cpu.load);
    this.history.memory.push(Math.round(this.memory.usagePercent * 10) / 10);
    if (this.history.cpu.length > HISTORY_LENGTH) {
      this.history.cpu.shift();
      this.history.memory.shift();
    }
    this.historySnapshot = { cpu: [...this.history.cpu], memory: [...this.history.memory] };
  }

  /** Minimised windows put their process to sleep. */
  private syncProcessStates(): void {
    for (const w of this.windowManager.getWindows()) {
      const p = this.processManager.get(w.pid);
      if (!p || p.status === 'stopped') continue;
      const desired = w.minimized ? 'sleeping' : 'running';
      if (p.status !== desired) this.processManager.setStatus(p.pid, desired);
    }
  }

  // ───────────────────────────── applications ─────────────────────────────

  launch(appId: string, options: LaunchOptions = {}): LaunchResult {
    const def = this.applications.get(appId);
    if (!this.installedApps.has(appId)) throw new SystemError('ENOAPP', appId, `${def.name} is not installed`);
    if (!this.memory.canAllocate(def.memoryUsage)) {
      throw new SystemError('ENOMEM', undefined, `Out of memory: cannot start ${def.name} (needs ${def.memoryUsage} MB)`);
    }
    const process = this.processManager.spawn({
      name: def.processName ?? def.id,
      memoryUsage: def.memoryUsage,
      baseCpu: def.cpuUsage ?? 2,
      startupSpike: def.startupCpu ?? 10,
      appId: def.id,
      kind: 'application',
    });
    this.memory.allocate(process.pid, def.memoryUsage);
    const win = this.windowManager.open({
      appId: def.id,
      title: options.title ?? def.name,
      pid: process.pid,
      width: options.bounds?.width ?? def.defaultWidth,
      height: options.bounds?.height ?? def.defaultHeight,
      x: options.bounds?.x,
      y: options.bounds?.y,
      minWidth: def.minWidth,
      minHeight: def.minHeight,
      args: options.args,
      minimized: options.minimized,
      maximized: options.maximized,
    });
    this.cpu.update(this.processManager.totalCpu(), this.random);
    this.emit();
    return { windowId: win.id, pid: process.pid };
  }

  closeWindow(windowId: string): void {
    const win = this.windowManager.get(windowId);
    if (!win) return;
    this.windowManager.close(windowId);
    if (this.processManager.has(win.pid)) this.processManager.terminate(win.pid);
    this.emit();
  }

  killProcess(pid: number): void {
    this.processManager.kill(pid);
    this.emit();
  }

  installApplication(appId: string): void {
    this.applications.get(appId);
    this.installedApps.install(appId);
  }

  uninstallApplication(appId: string): void {
    const def = this.applications.get(appId);
    if (def.system) throw new SystemError('EACCES', def.name, 'System applications cannot be uninstalled');
    for (const p of this.processManager.findByName(def.processName ?? def.id)) {
      if (p.appId === appId) this.processManager.kill(p.pid);
    }
    this.installedApps.uninstall(appId);
  }

  /** Opens a path with the appropriate application (folders in Files, shortcuts resolved, files in the editor). */
  openPath(path: string): LaunchResult {
    const stats = this.fileSystem.getStats(path);
    if (stats.type === 'directory') return this.launch('files', { args: { path: stats.path } });
    if (extname(stats.name) === SHORTCUT_EXT) {
      const shortcut = parseShortcut(this.fileSystem.readFile(stats.path));
      if (!shortcut) throw new SystemError('EINVAL', stats.path, 'Broken shortcut');
      if (shortcut.kind === 'folder') {
        if (!this.fileSystem.isDirectory(shortcut.target)) throw new SystemError('ENOENT', shortcut.target);
        return this.launch('files', { args: { path: shortcut.target } });
      }
      return this.launch(shortcut.appId);
    }
    return this.launch('text-editor', { args: { path: stats.path } });
  }

  /** Runs `fn`, converting failures into user-visible notifications instead of exceptions. */
  attempt<T>(fn: () => T): T | undefined {
    try {
      return fn();
    } catch (e) {
      this.reportError(e);
      return undefined;
    }
  }

  reportError(e: unknown): void {
    if (isSystemError(e)) this.notifications.error(e.message, e.path);
    else this.notifications.error('Unexpected error', errorMessage(e));
  }

  // ───────────────────────────── persistence ─────────────────────────────

  snapshot(): ComputerSnapshot {
    return {
      version: SNAPSHOT_VERSION,
      savedAt: this.now(),
      filesystem: this.fileSystem.serialize(),
      settings: this.settings.getSnapshot(),
      installedApps: [...this.installedApps.getSnapshot()],
      windows: this.windowManager.serialize(),
      network: this.network.snapshot(),
      internet: this.internet.snapshot(),
    };
  }

  private restoreWindows(snapshot: ComputerSnapshot): void {
    const ordered = [...snapshot.windows].sort((a, b) => a.order - b.order);
    for (const w of ordered) {
      try {
        this.launch(w.appId, {
          args: w.args,
          title: w.title,
          bounds: { x: w.x, y: w.y, width: w.width, height: w.height },
          minimized: w.minimized,
          maximized: w.maximized,
        });
      } catch {
        // An application that is no longer installed or available is simply not restored.
      }
    }
  }
}
