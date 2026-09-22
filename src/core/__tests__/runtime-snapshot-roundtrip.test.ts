import { beforeEach, describe, expect, it, vi } from 'vitest';
import { VirtualComputer } from '../computer/VirtualComputer';
import { SNAPSHOT_VERSION } from '../computer/snapshot';
import { createComputerWithDoom, createRegistryWithDoom, installStubGame } from './helpers';

beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', () => 0);
  vi.stubGlobal('cancelAnimationFrame', () => {});
});

describe('runtime persistence piggybacks entirely on the existing filesystem snapshot', () => {
  it('installed manifests and save files survive a snapshot/restore cycle', () => {
    const pc = createComputerWithDoom();
    installStubGame(pc.runtime);
    const { pid, windowId } = pc.launch('doom');
    const instance = pc.runtime.attach(pid, windowId, 'doom');
    instance.fileProvider.writeFile('saves/slot1', new Uint8Array([1, 2, 3, 4]));

    const snapshot = pc.snapshot();
    expect(snapshot.version).toBe(SNAPSHOT_VERSION);
    // No dedicated runtime field: installed packages and save data are ordinary VFS content,
    // already covered by the `filesystem` key.
    expect(Object.keys(snapshot)).not.toContain('runtime');

    const restored = new VirtualComputer({ applications: createRegistryWithDoom(), snapshot });

    expect(restored.runtime.registry.get('doom')?.name).toBe('Test Game');
    expect(restored.fileSystem.exists('/apps/doom/stub.wasm')).toBe(true);
    expect(restored.fileSystem.readBinary('/home/user/games/doom/saves/slot1')).toEqual(new Uint8Array([1, 2, 3, 4]));
  });

  it('bumping nothing: SNAPSHOT_VERSION is unaffected by installing a runtime package', () => {
    const pc = createComputerWithDoom();
    installStubGame(pc.runtime);
    expect(pc.snapshot().version).toBe(SNAPSHOT_VERSION);
  });
});
