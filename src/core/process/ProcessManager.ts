import { SystemError } from '../errors';
import { Observable } from '../../utils/Observable';
import { clamp } from '../../utils/format';

export type ProcessStatus = 'running' | 'sleeping' | 'stopped';
export type ProcessKind = 'system' | 'application' | 'service';

export interface Process {
  pid: number;
  name: string;
  status: ProcessStatus;
  /** Current CPU usage in percent of the whole CPU. */
  cpuUsage: number;
  /** Reserved memory in MB. */
  memoryUsage: number;
  startedAt: number;
  kind: ProcessKind;
  /** Application id for processes that back a window. */
  appId?: string;
  /** Baseline CPU usage when running (percent). */
  baseCpu: number;
  /** Transient extra CPU load that decays every tick (percent). */
  spike: number;
  /** System processes cannot be killed. */
  protected: boolean;
}

export interface SpawnSpec {
  name: string;
  memoryUsage: number;
  baseCpu?: number;
  kind?: ProcessKind;
  appId?: string;
  status?: ProcessStatus;
  protected?: boolean;
  /** Initial CPU burst (percent) that decays over the following ticks. */
  startupSpike?: number;
}

export type ExitListener = (process: Process) => void;

export class ProcessManager extends Observable {
  private processes = new Map<number, Process>();
  private nextPid = 1;
  private exitListeners = new Set<ExitListener>();
  private now: () => number;

  constructor(now: () => number = Date.now) {
    super();
    this.now = now;
  }

  /** PIDs are never reused within a session, so they are always unique. */
  spawn(spec: SpawnSpec): Process {
    const process: Process = {
      pid: this.nextPid++,
      name: spec.name,
      status: spec.status ?? 'running',
      cpuUsage: 0,
      memoryUsage: spec.memoryUsage,
      startedAt: this.now(),
      kind: spec.kind ?? 'application',
      appId: spec.appId,
      baseCpu: spec.baseCpu ?? 1,
      spike: spec.startupSpike ?? 0,
      protected: spec.protected ?? false,
    };
    process.cpuUsage = process.status === 'running' ? process.baseCpu + process.spike : 0;
    this.processes.set(process.pid, process);
    this.emit();
    return { ...process };
  }

  get(pid: number): Process | undefined {
    const p = this.processes.get(pid);
    return p && { ...p };
  }

  require(pid: number): Process {
    const p = this.get(pid);
    if (!p) throw new SystemError('ESRCH', String(pid));
    return p;
  }

  has(pid: number): boolean {
    return this.processes.has(pid);
  }

  list(): Process[] {
    return [...this.processes.values()].map((p) => ({ ...p }));
  }

  count(): number {
    return this.processes.size;
  }

  findByName(name: string): Process[] {
    return this.list().filter((p) => p.name === name);
  }

  /** Terminates a process. Throws ESRCH for unknown pids and EACCES for protected ones. */
  kill(pid: number): Process {
    const p = this.processes.get(pid);
    if (!p) throw new SystemError('ESRCH', String(pid));
    if (p.protected) throw new SystemError('EACCES', `${p.name} (${pid})`);
    return this.terminate(pid);
  }

  /** Removes a process regardless of protection (used for a full shutdown). */
  terminate(pid: number): Process {
    const p = this.processes.get(pid);
    if (!p) throw new SystemError('ESRCH', String(pid));
    this.processes.delete(pid);
    const exited = { ...p, status: 'stopped' as const, cpuUsage: 0 };
    this.emit();
    for (const l of [...this.exitListeners]) l(exited);
    return exited;
  }

  setStatus(pid: number, status: ProcessStatus): void {
    const p = this.processes.get(pid);
    if (!p) throw new SystemError('ESRCH', String(pid));
    if (p.status === status) return;
    p.status = status;
    if (status !== 'running') p.cpuUsage = 0;
    this.emit();
  }

  stop(pid: number): void {
    const p = this.require(pid);
    if (p.protected) throw new SystemError('EACCES', `${p.name} (${pid})`);
    this.setStatus(pid, 'stopped');
  }

  resume(pid: number): void {
    this.require(pid);
    this.setStatus(pid, 'running');
  }

  /** Adds a short-lived CPU burst to a process. */
  boost(pid: number, percent: number): void {
    const p = this.processes.get(pid);
    if (!p) return;
    p.spike = Math.max(p.spike, percent);
  }

  /**
   * Reports sustained, externally-measured usage for a process (e.g. a runtime-hosted
   * application). Unlike `boost()`'s decaying spike, this sets the baseline that `tick()`
   * jitters around every second, until the next report.
   */
  reportUsage(pid: number, usage: { cpuUsage?: number; memoryUsage?: number }): void {
    const p = this.processes.get(pid);
    if (!p) return;
    if (usage.cpuUsage !== undefined) {
      p.baseCpu = clamp(usage.cpuUsage, 0, 100);
      if (p.status === 'running') p.cpuUsage = round1(clamp(p.baseCpu + p.spike, 0, 100));
    }
    if (usage.memoryUsage !== undefined) p.memoryUsage = Math.max(0, usage.memoryUsage);
    this.emit();
  }

  onExit(listener: ExitListener): () => void {
    this.exitListeners.add(listener);
    return () => {
      this.exitListeners.delete(listener);
    };
  }

  /** Advances the CPU simulation by one step. */
  tick(random: () => number = Math.random): void {
    for (const p of this.processes.values()) {
      if (p.status === 'running') {
        const jitter = 0.75 + random() * 0.5;
        p.cpuUsage = round1(clamp(p.baseCpu * jitter + p.spike, 0, 100));
      } else if (p.status === 'sleeping') {
        p.cpuUsage = round1(p.baseCpu * 0.1 * random());
      } else p.cpuUsage = 0;
      p.spike = p.spike < 0.5 ? 0 : p.spike * 0.6;
    }
    this.emit();
  }

  totalCpu(): number {
    let sum = 0;
    for (const p of this.processes.values()) sum += p.cpuUsage;
    return round1(clamp(sum, 0, 100));
  }

  totalMemory(): number {
    let sum = 0;
    for (const p of this.processes.values()) sum += p.memoryUsage;
    return sum;
  }
}

const round1 = (n: number) => Math.round(n * 10) / 10;
