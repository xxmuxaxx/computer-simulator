import { beforeEach, describe, expect, it, vi } from 'vitest';
import { VirtualComputer } from '../computer/VirtualComputer';
import { createComputerWithDoom, createRegistryWithDoom, installStubGame } from './helpers';

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
    installStubGame(pc.runtime);

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
    installStubGame(pc.runtime);
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
    installStubGame(pc.runtime);
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
    installStubGame(pc.runtime);
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

  it('reinstalling a currently-running game kills its process instead of leaving a dangling instance', async () => {
    const pc = createComputerWithDoom();
    installStubGame(pc.runtime);
    const { windowId, pid } = pc.launch('doom');
    const instance = pc.runtime.attach(pid, windowId, 'doom');
    await instance.start();
    expect(pc.processManager.has(pid)).toBe(true);

    installStubGame(pc.runtime); // reinstall over the same id while it's running

    expect(pc.processManager.has(pid)).toBe(false);
    expect(pc.runtime.get(pid)).toBeUndefined();
  });

  it('installing a game makes it launchable for a returning user whose saved snapshot predates that app (regression: installedApps only auto-includes every app on a brand new computer - a returning user\'s saved snapshot only carries what it already had, so computer.launch() refused with ENOAPP even though the game package itself installed fine)', () => {
    const registry = createRegistryWithDoom();
    const fresh = new VirtualComputer({ applications: registry, random: () => 0.5 });
    const snapshot = fresh.snapshot();
    // Simulate an existing user's snapshot, saved back when 'doom' wasn't a registered app yet.
    const staleSnapshot = { ...snapshot, installedApps: snapshot.installedApps.filter((id) => id !== 'doom') };
    const pc = new VirtualComputer({ applications: registry, snapshot: staleSnapshot, random: () => 0.5 });
    expect(pc.installedApps.has('doom')).toBe(false);
    expect(() => pc.launch('doom')).toThrowError('DOOM is not installed');

    installStubGame(pc.runtime);

    expect(pc.installedApps.has('doom')).toBe(true);
    expect(() => pc.launch('doom')).not.toThrow();
  });

  it('a game whose package is already installed but whose installedApps fell out of sync is repaired on boot, with no install() call needed (regression: this is the exact state a user got stuck in - DOOM already showed as installed in Game Manager, "Play" still failed with "DOOM is not installed")', () => {
    const registry = createRegistryWithDoom();
    const seed = createComputerWithDoom();
    installStubGame(seed.runtime);
    const snapshot = seed.snapshot();
    // Simulate exactly the reported stuck state: the runtime package is installed (present in
    // the filesystem snapshot) but installedApps wasn't carrying it (as could happen before this
    // reconciliation existed, or from any other cause of the two falling out of sync).
    const desyncedSnapshot = { ...snapshot, installedApps: snapshot.installedApps.filter((id) => id !== 'doom') };
    const pc = new VirtualComputer({ applications: registry, snapshot: desyncedSnapshot, random: () => 0.5 });

    // No install()/uninstall() call here - RuntimeManager's constructor alone must fix this.
    expect(pc.runtime.registry.get('doom')).toBeDefined();
    expect(pc.installedApps.has('doom')).toBe(true);
    expect(() => pc.launch('doom')).not.toThrow();
  });

  it('removing a game also removes it from the launcher-level installed apps', () => {
    const pc = createComputerWithDoom();
    installStubGame(pc.runtime);
    expect(pc.installedApps.has('doom')).toBe(true);

    pc.runtime.uninstall('doom');

    expect(pc.installedApps.has('doom')).toBe(false);
    expect(() => pc.launch('doom')).toThrowError('DOOM is not installed');
  });
});
