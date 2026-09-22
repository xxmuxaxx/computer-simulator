import { beforeEach, describe, expect, it, vi } from 'vitest';
import { installDoom } from '../runtime/doom/DoomRuntimeAdapter';
import { createComputerWithDoom } from './helpers';

// The real runtime loop drives itself with requestAnimationFrame, which doesn't exist in the
// Node test environment. Stub it to a no-op that never fires - tests drive frames deterministically
// via RuntimeInstance.tickOnce() instead, exactly like the lifecycle tests do.
beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', () => 0);
  vi.stubGlobal('cancelAnimationFrame', () => {});
});

describe('runtime-backed applications integrate with the ordinary process/window pipeline', () => {
  it('computer.launch("doom") produces a real process and window like any other app', async () => {
    const pc = createComputerWithDoom();
    installDoom(pc.runtime);

    const { windowId, pid } = pc.launch('doom');

    const process = pc.processManager.get(pid);
    expect(process).toMatchObject({ kind: 'application', appId: 'doom', status: 'running' });
    expect(pc.windowManager.get(windowId)).toMatchObject({ appId: 'doom', pid });

    const instance = pc.runtime.attach(pid, windowId, 'doom');
    await instance.start();
    expect(instance.state).toBe('running');
  });

  it('minimizing the window pauses the instance via the existing tick-driven status sync', async () => {
    const pc = createComputerWithDoom();
    installDoom(pc.runtime);
    const { windowId, pid } = pc.launch('doom');
    const instance = pc.runtime.attach(pid, windowId, 'doom');
    await instance.start();
    expect(instance.state).toBe('running');

    pc.windowManager.minimize(windowId);
    pc.tick(); // VirtualComputer.tick() already flips a minimized window's process to 'sleeping'

    expect(pc.processManager.get(pid)?.status).toBe('sleeping');
    expect(instance.state).toBe('paused');

    pc.windowManager.focus(windowId);
    pc.tick();

    expect(pc.processManager.get(pid)?.status).toBe('running');
    expect(instance.state).toBe('running');
  });

  it('reportUsage is visible on the plain Process shape - no Task Manager changes needed', async () => {
    const pc = createComputerWithDoom();
    installDoom(pc.runtime);
    const { windowId, pid } = pc.launch('doom');
    const instance = pc.runtime.attach(pid, windowId, 'doom');
    await instance.start();

    instance.tickOnce();

    const process = pc.processManager.get(pid);
    expect(process?.cpuUsage).toBeGreaterThan(0);
    expect(process?.memoryUsage).toBeGreaterThan(0);
  });

  it('killing the process through the ordinary path disposes the runtime instance', async () => {
    const pc = createComputerWithDoom();
    installDoom(pc.runtime);
    const { windowId, pid } = pc.launch('doom');
    const instance = pc.runtime.attach(pid, windowId, 'doom');
    await instance.start();

    pc.killProcess(pid);

    expect(pc.processManager.has(pid)).toBe(false);
    expect(pc.windowManager.get(windowId)).toBeUndefined();
    expect(pc.runtime.get(pid)).toBeUndefined();
  });

  it('attaching before the game is installed throws ERUNTIME, not a crash', () => {
    const pc = createComputerWithDoom();
    const { windowId, pid } = pc.launch('doom');
    expect(() => pc.runtime.attach(pid, windowId, 'doom')).toThrowError('No runtime manifest installed');
  });
});
