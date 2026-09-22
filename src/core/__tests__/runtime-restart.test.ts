import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createComputerWithDoom, installStubGame } from './helpers';

beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', () => 0);
  vi.stubGlobal('cancelAnimationFrame', () => {});
});

/** `attach()`/`restart()` fire-and-forget `instance.start()` (a real async WebAssembly.instantiate) -
 * poll briefly instead of assuming one microtask tick is enough. */
async function waitUntilRunning(getState: () => string): Promise<void> {
  for (let i = 0; i < 20 && getState() !== 'running'; i++) {
    await new Promise((r) => setTimeout(r, 5));
  }
}

describe('RuntimeManager.restart', () => {
  it('disposes the old instance and attaches a fresh one for the same pid/window/app', async () => {
    const pc = createComputerWithDoom();
    installStubGame(pc.runtime);
    const { pid, windowId } = pc.launch('doom');
    const first = pc.runtime.attach(pid, windowId, 'doom');
    await first.start();
    expect(first.state).toBe('running');

    const second = pc.runtime.restart(pid);
    expect(second).not.toBe(first);
    expect(second.pid).toBe(pid);
    expect(second.windowId).toBe(windowId);
    expect(second.appId).toBe('doom');
    expect(pc.runtime.get(pid)).toBe(second);

    await waitUntilRunning(() => second.state);
    expect(second.state).toBe('running');
  });

  it('throws ERUNTIME for a pid with no runtime instance', () => {
    const pc = createComputerWithDoom();
    expect(() => pc.runtime.restart(999)).toThrowError('No runtime instance');
  });

  it('a WAD upload followed by restart round-trips through the sandboxed file provider', async () => {
    const pc = createComputerWithDoom();
    installStubGame(pc.runtime);
    const { pid, windowId } = pc.launch('doom');
    const first = pc.runtime.attach(pid, windowId, 'doom');
    await first.start();

    first.fileProvider.writeFile('wad/DOOM.WAD', new Uint8Array([1, 2, 3]));
    const second = pc.runtime.restart(pid);
    await waitUntilRunning(() => second.state);

    expect(second.fileProvider.exists('wad/DOOM.WAD')).toBe(true);
    expect(second.state).toBe('running');
  });
});
