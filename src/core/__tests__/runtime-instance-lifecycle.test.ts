import { describe, expect, it } from 'vitest';
import { VirtualFileSystem } from '../filesystem/VirtualFileSystem';
import { NotificationCenter } from '../notifications/NotificationCenter';
import { ProcessManager } from '../process/ProcessManager';
import { RuntimeEventBus } from '../runtime/events';
import { RuntimeInstance, type RuntimeInstanceOptions } from '../runtime/RuntimeInstance';
import { decodeStubDoomWasm } from '../runtime/stub/stub-doom-bytes';
import type { RuntimeManifest } from '../runtime/types';

function manifest(overrides: Partial<RuntimeManifest> = {}): RuntimeManifest {
  return {
    id: 'doom',
    name: 'DOOM',
    version: '1.0.0',
    type: 'game',
    engine: 'stub',
    executable: 'doom.wasm',
    memoryUsage: 32,
    cpuUsage: 8,
    display: { width: 4, height: 4 },
    permissions: ['fs:read', 'fs:write', 'input:keyboard', 'input:mouse', 'display:render'],
    ...overrides,
  };
}

/** Builds a RuntimeInstance with a manual (non-rAF) frame scheduler, driven only via tickOnce(). */
function makeInstance(overrides: Partial<RuntimeInstanceOptions> = {}) {
  const fs = new VirtualFileSystem();
  fs.createDirectory('/home/user/games/doom', { recursive: true });
  const processManager = new ProcessManager();
  const process = processManager.spawn({ name: 'doom', memoryUsage: 32, appId: 'doom' });
  const notifications = new NotificationCenter();
  const events = new RuntimeEventBus();

  const instance = new RuntimeInstance({
    pid: process.pid,
    windowId: 'win_1',
    appId: 'doom',
    manifest: manifest(),
    wasmBytes: decodeStubDoomWasm(),
    fileSystem: fs,
    fileRoot: '/home/user/games/doom',
    processManager,
    notifications,
    events,
    scheduleFrame: () => 0,
    cancelFrame: () => {},
    ...overrides,
  });
  return { instance, fs, processManager, notifications, events, pid: process.pid };
}

describe('RuntimeInstance lifecycle', () => {
  it('starts, loads the module and begins running', async () => {
    const { instance, events } = makeInstance();
    const started: unknown[] = [];
    events.on('instance:started', (p) => started.push(p));

    expect(instance.state).toBe('starting');
    await instance.start();

    expect(instance.state).toBe('running');
    expect(instance.wasmStatus).toBe('loaded');
    expect(started).toHaveLength(1);
  });

  it('tickOnce() advances the module and reports usage to ProcessManager', async () => {
    const { instance, processManager, pid } = makeInstance();
    await instance.start();

    const before = processManager.get(pid);
    instance.tickOnce();
    const after = processManager.get(pid);

    expect(after?.cpuUsage).toBeGreaterThan(0);
    expect(after?.memoryUsage).toBeGreaterThan(0);
    expect(after).not.toBe(before);
  });

  it('pause()/resume() only apply from the matching state', async () => {
    const { instance, events } = makeInstance();
    await instance.start();

    instance.resume(); // no-op: not paused
    expect(instance.state).toBe('running');

    instance.pause();
    expect(instance.state).toBe('paused');
    instance.pause(); // no-op: already paused
    expect(instance.state).toBe('paused');

    const resumed: unknown[] = [];
    events.on('instance:resumed', (p) => resumed.push(p));
    instance.resume();
    expect(instance.state).toBe('running');
    expect(resumed).toHaveLength(1);
  });

  it('a paused instance ignores tickOnce()', async () => {
    const { instance, processManager, pid } = makeInstance();
    await instance.start();
    instance.pause();
    const before = processManager.get(pid);
    instance.tickOnce();
    expect(processManager.get(pid)).toEqual(before);
  });

  it('stop() halts the loop and is idempotent', async () => {
    const { instance, events } = makeInstance();
    await instance.start();
    const stopped: unknown[] = [];
    events.on('instance:stopped', (p) => stopped.push(p));

    instance.stop();
    expect(instance.state).toBe('stopped');
    instance.stop();
    expect(stopped).toHaveLength(1);
  });

  it('crashes cleanly on a malformed WASM module, without throwing, and notifies the user', async () => {
    const { instance, notifications, events } = makeInstance({ wasmBytes: new Uint8Array([1, 2, 3, 4]) });
    const crashed: { message?: string }[] = [];
    events.on('instance:crashed', (p) => crashed.push(p));

    await expect(instance.start()).resolves.toBeUndefined();

    expect(instance.state).toBe('crashed');
    expect(instance.wasmStatus).toBe('error');
    expect(crashed).toHaveLength(1);
    expect(notifications.getSnapshot().some((n) => n.type === 'error' && n.title === 'Application crashed')).toBe(true);
  });

  it('a crashed instance is left running at the process level (not auto-killed)', async () => {
    const { instance, processManager, pid } = makeInstance({ wasmBytes: new Uint8Array([1, 2, 3, 4]) });
    await instance.start();
    expect(instance.state).toBe('crashed');
    expect(processManager.has(pid)).toBe(true);
  });

  it('info() reflects live state for the Runtime Monitor', async () => {
    const { instance } = makeInstance();
    await instance.start();
    const info = instance.info();
    expect(info).toMatchObject({ appId: 'doom', state: 'running', wasmStatus: 'loaded', displayWidth: 4, displayHeight: 4 });
  });
});
