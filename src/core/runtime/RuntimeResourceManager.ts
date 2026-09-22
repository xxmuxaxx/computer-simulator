export interface UsageSample {
  cpuUsage: number;
  memoryUsage: number;
  fps: number;
}

export interface RuntimeResourceManagerOptions {
  baseCpu: number;
  baseMemory: number;
  random?: () => number;
  now?: () => number;
}

/**
 * Tracks a rolling fps counter and a synthetic cpu/memory cost model for a running instance.
 * Values are simulated (the browser doesn't expose real per-module CPU/GPU cost), but they feed
 * the same `ProcessManager.reportUsage()` path every other process's numbers come from, so Task
 * Manager shows a runtime-hosted application exactly like any other process.
 */
export class RuntimeResourceManager {
  private baseCpu: number;
  private baseMemory: number;
  private random: () => number;
  private now: () => number;
  private frameCount = 0;
  private lastFpsAt: number;
  private fps = 0;

  constructor(options: RuntimeResourceManagerOptions) {
    this.baseCpu = options.baseCpu;
    this.baseMemory = options.baseMemory;
    this.random = options.random ?? Math.random;
    this.now = options.now ?? Date.now;
    this.lastFpsAt = this.now();
  }

  recordFrame(): void {
    this.frameCount++;
    const elapsed = this.now() - this.lastFpsAt;
    if (elapsed >= 1000) {
      this.fps = Math.round((this.frameCount * 1000) / elapsed);
      this.frameCount = 0;
      this.lastFpsAt = this.now();
    }
  }

  sample(): UsageSample {
    const jitter = 0.85 + this.random() * 0.3;
    return {
      cpuUsage: Math.round(this.baseCpu * jitter * 10) / 10,
      memoryUsage: Math.round(this.baseMemory * (0.95 + this.random() * 0.1)),
      fps: this.fps,
    };
  }
}
