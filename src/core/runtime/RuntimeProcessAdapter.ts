import type { ProcessManager } from '../process/ProcessManager';
import type { RuntimeInstance } from './RuntimeInstance';

/**
 * Keeps a RuntimeInstance's paused/running state in sync with its own process's sleeping/running
 * status - which VirtualComputer.tick() already flips whenever the backing window is minimised or
 * restored. No new WindowManager API is needed: this just observes the same signal Task Manager
 * already reflects.
 */
export function attachStatusSync(instance: RuntimeInstance, processManager: ProcessManager): () => void {
  let lastStatus = processManager.get(instance.pid)?.status;
  return processManager.subscribe(() => {
    const p = processManager.get(instance.pid);
    if (!p || p.status === lastStatus) return;
    lastStatus = p.status;
    if (p.status === 'sleeping' && instance.state === 'running') instance.pause();
    else if (p.status === 'running' && instance.state === 'paused') instance.resume();
  });
}
