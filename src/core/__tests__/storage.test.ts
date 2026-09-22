import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { VirtualComputer } from '../computer/VirtualComputer';
import { AutoSaver } from '../storage/AutoSaver';
import { IndexedDBBackend, MemoryBackend } from '../storage/backends';
import { ComputerStorage } from '../storage/ComputerStorage';
import { createComputer, createRegistry } from './helpers';

const backends = {
  memory: () => new MemoryBackend(),
  indexedDB: () => new IndexedDBBackend('test-db', new IDBFactory()),
};

describe.each(Object.entries(backends))('ComputerStorage (%s)', (_name, make) => {
  it('returns null when nothing has been saved', async () => {
    expect(await new ComputerStorage(make()).load()).toBeNull();
  });

  it('saves and loads the whole computer state', async () => {
    const storage = new ComputerStorage(make());
    const pc = createComputer();
    pc.fileSystem.writeFile('/home/user/Documents/note.txt', 'persisted text');
    pc.settings.update({ theme: 'light', computerName: 'my-box' });
    pc.uninstallApplication('heavy');
    pc.launch('terminal', { args: { foo: 'bar' } });
    await storage.save(pc.snapshot());

    const loaded = await storage.load();
    expect(loaded).not.toBeNull();
    const restored = new VirtualComputer({ applications: createRegistry(), snapshot: loaded });
    expect(restored.fileSystem.readFile('/home/user/Documents/note.txt')).toBe('persisted text');
    expect(restored.settings.getSnapshot()).toMatchObject({ theme: 'light', computerName: 'my-box' });
    expect(restored.installedApps.has('heavy')).toBe(false);
    expect(restored.installedApps.has('files')).toBe(true);
    // Desktop state: the terminal window comes back.
    const windows = restored.windowManager.getWindows();
    expect(windows.map((w) => w.appId)).toEqual(['terminal']);
    expect(windows[0]!.args).toEqual({ foo: 'bar' });
    expect(restored.processManager.findByName('terminal')).toHaveLength(1);
  });

  it('overwrites previous saves', async () => {
    const storage = new ComputerStorage(make());
    const pc = createComputer();
    await storage.save(pc.snapshot());
    pc.fileSystem.createFile('/tmp/second.txt', '2');
    await storage.save(pc.snapshot());
    const restored = new VirtualComputer({ applications: createRegistry(), snapshot: await storage.load() });
    expect(restored.fileSystem.exists('/tmp/second.txt')).toBe(true);
  });

  it('reset removes all saved data', async () => {
    const storage = new ComputerStorage(make());
    await storage.save(createComputer().snapshot());
    expect(await storage.load()).not.toBeNull();
    await storage.reset();
    expect(await storage.load()).toBeNull();
  });

  it('ignores corrupted data', async () => {
    const backend = make();
    await backend.setMany({ meta: { version: 1, savedAt: 1 }, filesystem: { rootId: 'root', nodes: 'broken' } });
    expect(await new ComputerStorage(backend).load()).toBeNull();
  });
});

describe('AutoSaver', () => {
  it('saves after changes and on flush', async () => {
    const storage = new ComputerStorage(new MemoryBackend());
    const pc = createComputer();
    const saver = new AutoSaver(pc, storage, 10);
    pc.fileSystem.createFile('/tmp/auto.txt', 'auto');
    await new Promise((r) => setTimeout(r, 50));
    let loaded = await storage.load();
    expect(loaded?.filesystem.nodes.some((n) => n.name === 'auto.txt')).toBe(true);

    pc.settings.update({ theme: 'light' });
    await saver.flush();
    loaded = await storage.load();
    expect(loaded?.settings.theme).toBe('light');
    saver.dispose();
  });

  it('fresh computers start with the default file system', () => {
    const pc = createComputer();
    expect(pc.fileSystem.isDirectory('/home/user/Desktop')).toBe(true);
    expect(pc.fileSystem.readFile('/home/user/Documents/readme.txt')).toContain('Welcome');
    expect(pc.fileSystem.exists('/home/user/Projects/hello.txt')).toBe(true);
    expect(pc.fileSystem.listDirectory('/home/user/Desktop').map((f) => f.name)).toEqual([
      'Documents.lnk',
      'Projects.lnk',
      'Terminal.lnk',
      'Trash.lnk',
    ]);
  });
});
