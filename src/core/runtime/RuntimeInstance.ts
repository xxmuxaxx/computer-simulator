import type { NotificationCenter } from '../notifications/NotificationCenter';
import type { ProcessManager } from '../process/ProcessManager';
import type { VirtualFileSystem } from '../filesystem/VirtualFileSystem';
import { instantiate, tick as tickModule, type LoadedModule } from './ApplicationRuntime';
import { RuntimeDisplay } from './RuntimeDisplay';
import { RuntimeFileProvider } from './RuntimeFileProvider';
import { RuntimeInput } from './RuntimeInput';
import { RuntimeResourceManager } from './RuntimeResourceManager';
import type { RuntimeEventBus } from './events';
import type { RuntimeInstanceInfo, RuntimeManifest, RuntimePermission, RuntimeState } from './types';

export interface RuntimeInstanceOptions {
  pid: number;
  windowId: string;
  appId: string;
  manifest: RuntimeManifest;
  wasmBytes: Uint8Array;
  fileSystem: VirtualFileSystem;
  fileRoot: string;
  processManager: ProcessManager;
  notifications: NotificationCenter;
  events: RuntimeEventBus;
  now?: () => number;
  random?: () => number;
  /** Drives the frame loop; defaults to requestAnimationFrame. Overridable for headless tests. */
  scheduleFrame?: (cb: (ts: number) => void) => number;
  cancelFrame?: (handle: number) => void;
}

/**
 * A single running (or crashed/stopped) instance of a runtime application. Owns the sandboxed
 * WASM module plus its display/input/file/resource handles, and drives the update/render loop.
 * Never touches React or the DOM beyond the frame buffer it exposes through `display`.
 */
export class RuntimeInstance {
  readonly id: string;
  readonly pid: number;
  readonly windowId: string;
  readonly appId: string;
  readonly manifest: RuntimeManifest;
  readonly display: RuntimeDisplay;
  readonly input: RuntimeInput;
  readonly fileProvider: RuntimeFileProvider;
  readonly startedAt: number;

  private permissions: Set<RuntimePermission>;
  private resources: RuntimeResourceManager;
  private processManager: ProcessManager;
  private notifications: NotificationCenter;
  private events: RuntimeEventBus;
  private now: () => number;
  private wasmBytes: Uint8Array;
  private module: LoadedModule | null = null;
  private _state: RuntimeState = 'starting';
  private _wasmStatus: 'loading' | 'loaded' | 'error' = 'loading';
  private lastError: string | undefined;
  private frameHandle: number | null = null;
  private lastTickAt: number;
  private scheduleFrame: (cb: (ts: number) => void) => number;
  private cancelFrame: (handle: number) => void;

  constructor(options: RuntimeInstanceOptions) {
    this.id = `runtime-${options.pid}`;
    this.pid = options.pid;
    this.windowId = options.windowId;
    this.appId = options.appId;
    this.manifest = options.manifest;
    this.permissions = new Set(options.manifest.permissions);
    this.display = new RuntimeDisplay(options.manifest.display.width, options.manifest.display.height, this.permissions);
    this.input = new RuntimeInput(this.permissions);
    this.fileProvider = new RuntimeFileProvider(options.fileSystem, options.fileRoot, this.permissions);
    this.resources = new RuntimeResourceManager({
      baseCpu: options.manifest.cpuUsage ?? 5,
      baseMemory: options.manifest.memoryUsage,
      random: options.random,
      now: options.now,
    });
    this.processManager = options.processManager;
    this.notifications = options.notifications;
    this.events = options.events;
    this.now = options.now ?? Date.now;
    this.wasmBytes = options.wasmBytes;
    this.startedAt = this.now();
    this.lastTickAt = this.startedAt;
    this.scheduleFrame = options.scheduleFrame ?? ((cb) => requestAnimationFrame(cb));
    this.cancelFrame = options.cancelFrame ?? ((h) => cancelAnimationFrame(h));
  }

  get state(): RuntimeState {
    return this._state;
  }

  get wasmStatus(): 'loading' | 'loaded' | 'error' {
    return this._wasmStatus;
  }

  /** Loads the WASM module and starts the frame loop. Errors transition to 'crashed', never throw. */
  async start(): Promise<void> {
    try {
      const module = await instantiate(this.wasmBytes, { getInput: () => this.input.packed() });
      this.module = module;
      this._wasmStatus = 'loaded';
      this._state = 'running';
      this.lastTickAt = this.now();
      this.events.emit('instance:started', { pid: this.pid, appId: this.appId });
      this.loop();
    } catch (e) {
      this._wasmStatus = 'error';
      this.crash(e);
    }
  }

  pause(): void {
    if (this._state !== 'running') return;
    this._state = 'paused';
    this.stopLoop();
    this.events.emit('instance:paused', { pid: this.pid, appId: this.appId });
  }

  resume(): void {
    if (this._state !== 'paused') return;
    this._state = 'running';
    this.lastTickAt = this.now();
    this.loop();
    this.events.emit('instance:resumed', { pid: this.pid, appId: this.appId });
  }

  stop(): void {
    if (this._state === 'stopped') return;
    this.stopLoop();
    this._state = 'stopped';
    this.events.emit('instance:stopped', { pid: this.pid, appId: this.appId });
  }

  /** Advances one frame synchronously, bypassing the rAF loop - used by the host component when
   * driving its own paint cadence, and by tests via a no-op scheduler. */
  tickOnce(): void {
    if (this._state !== 'running' || !this.module) return;
    this.frame();
  }

  info(): RuntimeInstanceInfo {
    const sample = this.resources.sample();
    return {
      id: this.id,
      pid: this.pid,
      windowId: this.windowId,
      appId: this.appId,
      appName: this.manifest.name,
      state: this._state,
      startedAt: this.startedAt,
      fps: sample.fps,
      cpuUsage: sample.cpuUsage,
      memoryUsage: sample.memoryUsage,
      wasmStatus: this._wasmStatus,
      displayWidth: this.display.width,
      displayHeight: this.display.height,
      inputConnected: this.input.connected,
      lastError: this.lastError,
    };
  }

  private loop(): void {
    this.frameHandle = this.scheduleFrame(() => {
      if (this._state !== 'running') return;
      this.frame();
      this.loop();
    });
  }

  private stopLoop(): void {
    if (this.frameHandle !== null) {
      this.cancelFrame(this.frameHandle);
      this.frameHandle = null;
    }
  }

  private frame(): void {
    if (!this.module) return;
    const t = this.now();
    const dt = t - this.lastTickAt;
    this.lastTickAt = t;
    try {
      tickModule(this.module, dt, this.display.getFrameBuffer(), this.display.width, this.display.height);
      this.resources.recordFrame();
      const usage = this.resources.sample();
      this.processManager.reportUsage(this.pid, usage);
    } catch (e) {
      this.crash(e);
    }
  }

  private crash(e: unknown): void {
    this._state = 'crashed';
    this.lastError = e instanceof Error ? e.message : String(e);
    console.error(`[runtime:${this.appId}] instance crashed`, e);
    this.stopLoop();
    this.notifications.error('Application crashed', `${this.manifest.name} was terminated unexpectedly.`);
    this.events.emit('instance:crashed', { pid: this.pid, appId: this.appId, message: this.lastError });
  }
}
