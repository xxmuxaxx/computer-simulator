import { SystemError } from '../errors';
import { Observable } from '../../utils/Observable';
import type { InstalledApplications } from '../applications/InstalledApplications';
import type { VirtualFileSystem } from '../filesystem/VirtualFileSystem';
import type { NotificationCenter } from '../notifications/NotificationCenter';
import type { ProcessManager } from '../process/ProcessManager';
import { RuntimeEventBus, type RuntimeEventMap, type RuntimeEventName } from './events';
import { attachStatusSync } from './RuntimeProcessAdapter';
import { RuntimeInstance } from './RuntimeInstance';
import { APPS_ROOT, RuntimeRegistry } from './RuntimeRegistry';
import type { RuntimeInstanceInfo, RuntimeManifest } from './types';

export interface RuntimeManagerOptions {
  fileSystem: VirtualFileSystem;
  processManager: ProcessManager;
  notifications: NotificationCenter;
  /** Installing/removing a runtime package also keeps this in sync (see RuntimeManager.install),
   * so `computer.launch(id)` works right after installing without a separate launcher-level step. */
  installedApps: InstalledApplications;
  now?: () => number;
  random?: () => number;
  /** Overridable for headless tests; defaults to requestAnimationFrame. */
  scheduleFrame?: (cb: (ts: number) => void) => number;
  cancelFrame?: (handle: number) => void;
}

const GAMES_ROOT = '/home/user/games';
const DATA_DIRS = ['saves', 'config', 'screenshots'];

/**
 * Peer composition root alongside NetworkManager/InternetManager: turns an installed
 * RuntimeManifest into a live, sandboxed RuntimeInstance backed by a real ProcessManager process
 * and WindowManager window. Zero changes to WindowManager/ProcessManager/Task Manager - a
 * runtime-hosted application is launched through the completely ordinary `computer.launch(appId)`.
 */
export class RuntimeManager extends Observable {
  readonly registry: RuntimeRegistry;
  readonly events = new RuntimeEventBus();

  private fs: VirtualFileSystem;
  private processManager: ProcessManager;
  private notifications: NotificationCenter;
  private installedApps: InstalledApplications;
  private now: () => number;
  private random: () => number;
  private scheduleFrame?: (cb: (ts: number) => void) => number;
  private cancelFrame?: (handle: number) => void;
  private instances = new Map<number, RuntimeInstance>();
  private unsubscribers = new Map<number, () => void>();

  constructor(options: RuntimeManagerOptions) {
    super();
    this.fs = options.fileSystem;
    this.processManager = options.processManager;
    this.notifications = options.notifications;
    this.installedApps = options.installedApps;
    this.now = options.now ?? Date.now;
    this.random = options.random ?? Math.random;
    this.scheduleFrame = options.scheduleFrame;
    this.cancelFrame = options.cancelFrame;
    this.registry = new RuntimeRegistry(this.fs);

    // Self-heals a computer whose installedApps fell out of sync with an already-installed
    // runtime package before this reconciliation existed (see docs/runtime.md's "Installation"
    // section) - every package the registry already knows about is guaranteed launchable from
    // the moment RuntimeManager exists, not just from the next install()/uninstall() call.
    for (const manifest of this.registry.list()) this.installedApps.install(manifest.id);

    this.processManager.onExit((p) => this.dispose(p.pid));
  }

  on<K extends RuntimeEventName>(event: K, listener: (payload: RuntimeEventMap[K]) => void): () => void {
    return this.events.on(event, listener);
  }

  install(manifest: RuntimeManifest, files: Record<string, Uint8Array>): void {
    // install() can reinstall/repair over an existing package (see RuntimeRegistry.install) - if
    // that package happens to be running right now, kill it first rather than leaving a live
    // instance pointing at files that are about to be replaced out from under it.
    for (const instance of this.instances.values()) {
      if (instance.appId === manifest.id) this.processManager.kill(instance.pid);
    }
    this.registry.install(manifest, files);
    // Keep the launcher-level "installed apps" list in sync with the runtime package: without
    // this, computer.launch(id) refuses with ENOAPP for anyone whose saved installedApps
    // predates this app being registered (it's only auto-added for a brand new computer).
    this.installedApps.install(manifest.id);
    this.events.emit('manifest:installed', { appId: manifest.id });
    this.emit();
  }

  uninstall(id: string): void {
    for (const instance of this.instances.values()) {
      if (instance.appId === id) this.processManager.kill(instance.pid);
    }
    this.registry.remove(id);
    this.installedApps.uninstall(id);
    this.events.emit('manifest:removed', { appId: id });
    this.emit();
  }

  /** Called by the generic RuntimeHostApp when its window mounts for a runtime-backed application. */
  attach(pid: number, windowId: string, appId: string): RuntimeInstance {
    const existing = this.instances.get(pid);
    if (existing) return existing;

    const manifest = this.registry.get(appId);
    if (!manifest) throw new SystemError('ERUNTIME', appId, 'No runtime manifest installed for this application');

    const wasmBytes = this.fs.readBinary(`${APPS_ROOT}/${appId}/${manifest.executable}`);
    const fileRoot = `${GAMES_ROOT}/${appId}`;
    if (!this.fs.exists(fileRoot)) this.fs.createDirectory(fileRoot, { recursive: true });
    for (const sub of DATA_DIRS) {
      const p = `${fileRoot}/${sub}`;
      if (!this.fs.exists(p)) this.fs.createDirectory(p);
    }

    const instance = new RuntimeInstance({
      pid,
      windowId,
      appId,
      manifest,
      wasmBytes,
      fileSystem: this.fs,
      fileRoot,
      processManager: this.processManager,
      notifications: this.notifications,
      events: this.events,
      now: this.now,
      random: this.random,
      scheduleFrame: this.scheduleFrame,
      cancelFrame: this.cancelFrame,
    });
    this.instances.set(pid, instance);
    this.unsubscribers.set(pid, attachStatusSync(instance, this.processManager));
    this.emit();
    void instance.start();
    return instance;
  }

  get(pid: number): RuntimeInstance | undefined {
    return this.instances.get(pid);
  }

  list(): RuntimeInstanceInfo[] {
    return [...this.instances.values()].map((i) => i.info());
  }

  /** Reloads a crashed (or otherwise stopped) instance in place - same pid and window, fresh module. */
  restart(pid: number): RuntimeInstance {
    const existing = this.instances.get(pid);
    if (!existing) throw new SystemError('ERUNTIME', String(pid), 'No runtime instance for this process');
    const { windowId, appId } = existing;
    this.dispose(pid);
    return this.attach(pid, windowId, appId);
  }

  private dispose(pid: number): void {
    const instance = this.instances.get(pid);
    if (!instance) return;
    instance.stop();
    this.unsubscribers.get(pid)?.();
    this.unsubscribers.delete(pid);
    this.instances.delete(pid);
    this.emit();
  }
}
