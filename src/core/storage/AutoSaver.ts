import type { VirtualComputer } from '../computer/VirtualComputer';
import type { ComputerStorage } from './ComputerStorage';
import { errorMessage } from '../errors';

/** Persists the computer shortly after any of its persistent parts change. */
export class AutoSaver {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private unsubscribers: Array<() => void> = [];
  private inFlight: Promise<void> = Promise.resolve();
  private disposed = false;
  private lastSerialized = '';

  constructor(
    private readonly computer: VirtualComputer,
    private readonly storage: ComputerStorage,
    private readonly delayMs = 300,
  ) {
    const schedule = () => this.schedule();
    this.unsubscribers = [
      computer.fileSystem.subscribe(schedule),
      computer.settings.subscribe(schedule),
      computer.installedApps.subscribe(schedule),
      computer.windowManager.subscribe(schedule),
      computer.network.subscribe(schedule),
      computer.internet.subscribe(schedule),
    ];
  }

  private schedule(): void {
    if (this.disposed) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), this.delayMs);
  }

  /** Saves right now (skipping the debounce) and resolves when the write is done. */
  flush(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.disposed) return this.inFlight;
    const snapshot = this.computer.snapshot();
    // Window transitions such as focus changes do not need to hit the disk if nothing else changed.
    const { savedAt: _ignored, ...comparable } = snapshot;
    const serialized = JSON.stringify(comparable);
    if (serialized === this.lastSerialized) return this.inFlight;
    this.lastSerialized = serialized;
    this.inFlight = this.inFlight
      .then(() => this.storage.save(snapshot))
      .catch((e: unknown) => {
        this.lastSerialized = '';
        this.computer.notifications.error('Failed to save computer state', errorMessage(e));
      });
    return this.inFlight;
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.disposed = true;
    for (const u of this.unsubscribers) u();
    this.unsubscribers = [];
  }
}
