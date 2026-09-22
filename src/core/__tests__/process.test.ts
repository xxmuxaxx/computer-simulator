import { describe, expect, it } from 'vitest';
import { SystemError } from '../errors';
import { ProcessManager } from '../process/ProcessManager';
import { createComputer } from './helpers';

describe('ProcessManager', () => {
  it('creates a process with the expected fields', () => {
    const pm = new ProcessManager(() => 42);
    const p = pm.spawn({ name: 'editor', memoryUsage: 200, baseCpu: 5 });
    expect(p).toMatchObject({ name: 'editor', status: 'running', memoryUsage: 200, startedAt: 42 });
    expect(p.pid).toBeGreaterThan(0);
    expect(pm.count()).toBe(1);
  });

  it('gets a process by pid', () => {
    const pm = new ProcessManager();
    const p = pm.spawn({ name: 'a', memoryUsage: 1 });
    expect(pm.get(p.pid)?.name).toBe('a');
    expect(pm.get(9999)).toBeUndefined();
    expect(() => pm.require(9999)).toThrow(SystemError);
  });

  it('kills processes and reports unknown pids', () => {
    const pm = new ProcessManager();
    const exited: number[] = [];
    pm.onExit((p) => exited.push(p.pid));
    const p = pm.spawn({ name: 'a', memoryUsage: 1 });
    pm.kill(p.pid);
    expect(pm.has(p.pid)).toBe(false);
    expect(exited).toEqual([p.pid]);
    expect(() => pm.kill(p.pid)).toThrowError('Process not found');
  });

  it('refuses to kill protected processes', () => {
    const pm = new ProcessManager();
    const p = pm.spawn({ name: 'system', memoryUsage: 1, protected: true });
    expect(() => pm.kill(p.pid)).toThrowError('Permission denied');
    expect(pm.has(p.pid)).toBe(true);
  });

  it('never reuses a pid', () => {
    const pm = new ProcessManager();
    const seen = new Set<number>();
    for (let i = 0; i < 50; i++) {
      const p = pm.spawn({ name: `p${i}`, memoryUsage: 1 });
      expect(seen.has(p.pid)).toBe(false);
      seen.add(p.pid);
      if (i % 2 === 0) pm.kill(p.pid);
    }
  });

  it('changes status and simulates cpu usage', () => {
    const pm = new ProcessManager();
    const p = pm.spawn({ name: 'a', memoryUsage: 1, baseCpu: 10 });
    pm.tick(() => 0.5);
    expect(pm.get(p.pid)?.cpuUsage).toBe(10);
    pm.setStatus(p.pid, 'sleeping');
    pm.tick(() => 0.5);
    expect(pm.get(p.pid)?.cpuUsage).toBeLessThan(1);
    pm.stop(p.pid);
    pm.tick(() => 0.5);
    expect(pm.get(p.pid)).toMatchObject({ status: 'stopped', cpuUsage: 0 });
  });
});

describe('VirtualComputer processes', () => {
  it('registers a process for every application and frees it on close', () => {
    const pc = createComputer();
    const before = { procs: pc.processManager.count(), mem: pc.memory.usedMB };
    const { windowId, pid } = pc.launch('files');
    expect(pc.processManager.get(pid)?.name).toBe('files');
    expect(pc.memory.usedMB).toBe(before.mem + 100);
    expect(pc.windowManager.get(windowId)?.pid).toBe(pid);
    pc.closeWindow(windowId);
    expect(pc.processManager.has(pid)).toBe(false);
    expect(pc.memory.usedMB).toBe(before.mem);
    expect(pc.processManager.count()).toBe(before.procs);
  });

  it('closes the window when its process is killed', () => {
    const pc = createComputer();
    const { windowId, pid } = pc.launch('terminal');
    pc.killProcess(pid);
    expect(pc.windowManager.get(windowId)).toBeUndefined();
  });

  it('supports several instances of the same application', () => {
    const pc = createComputer();
    const a = pc.launch('text-editor');
    const b = pc.launch('text-editor');
    expect(a.pid).not.toBe(b.pid);
    expect(a.windowId).not.toBe(b.windowId);
    expect(pc.windowManager.count()).toBe(2);
  });

  it('refuses to start an application when memory is exhausted', () => {
    const pc = createComputer();
    pc.launch('heavy');
    expect(() => pc.launch('heavy')).toThrowError(/Out of memory/);
  });

  it('cannot kill system processes', () => {
    const pc = createComputer();
    expect(() => pc.killProcess(1)).toThrowError('Permission denied');
  });
});
