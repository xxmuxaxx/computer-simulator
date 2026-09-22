import { describe, expect, it, vi, beforeEach } from 'vitest';
import { decodeStubDoomWasm } from '../runtime/stub/stub-doom-bytes';
import { createComputerWithDoom, createShell } from './helpers';

const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', () => 0);
  vi.stubGlobal('cancelAnimationFrame', () => {});
  // `games install doom` fetches the real ~4.5 MB third-party doom.wasm engine over the network;
  // stand in a fake successful response carrying the tiny placeholder bytes instead, so this test
  // exercises the *command's* logic (install/list/run/stop/info/remove) without needing network
  // access or the real engine file on disk.
  const bytes = decodeStubDoomWasm();
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    }),
  );
});

describe('games terminal command', () => {
  it('lists no games before anything is installed', () => {
    const { shell } = createShell(createComputerWithDoom());
    expect(shell.run('games list').stdout).toContain('No games installed');
  });

  it('installs, lists, runs, stops, inspects and removes doom', async () => {
    const { shell, computer } = createShell(createComputerWithDoom());

    const install = shell.run('games install doom');
    expect(install.exitCode).toBe(0);
    expect(install.stdout).toContain('Installing doom');
    await flush();
    expect(computer.runtime.registry.get('doom')).toBeDefined();

    const list = shell.run('games list');
    expect(list.stdout).toContain('doom');
    expect(list.stdout).toContain('DOOM');

    const run = shell.run('games run doom');
    expect(run.exitCode).toBe(0);
    expect(run.stdout).toMatch(/doom started \(PID \d+\)/);
    expect(computer.processManager.findByName('doom')).toHaveLength(1);

    const info = shell.run('games info doom');
    expect(info.stdout).toContain('Name: DOOM');
    expect(info.stdout).toContain('running (PID');

    const stop = shell.run('games stop doom');
    expect(stop.exitCode).toBe(0);
    expect(computer.processManager.findByName('doom')).toHaveLength(0);

    const remove = shell.run('games remove doom');
    expect(remove.exitCode).toBe(0);
    expect(shell.run('games list').stdout).toContain('No games installed');
  });

  it('posts a success notification once the background install completes', async () => {
    const { shell, computer } = createShell(createComputerWithDoom());
    shell.run('games install doom');
    await flush();
    expect(computer.notifications.getSnapshot().some((n) => n.type === 'success' && n.title === 'Installed')).toBe(true);
  });

  it('rejects unknown installable ids', () => {
    const { shell } = createShell(createComputerWithDoom());
    const result = shell.run('games install not-a-real-game');
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('no installable game named');
  });

  it('running doom before its runtime package is installed opens a window, but the runtime layer refuses to attach', () => {
    // "games run" only launches the window - the same ordinary app launch every app uses. Whether
    // the runtime package (manifest + wasm) is present is checked later, when the host component
    // attaches - covered by runtime-process-integration.test.ts's "attaching before install" case.
    const { shell, computer } = createShell(createComputerWithDoom());
    const run = shell.run('games run doom');
    expect(run.exitCode).toBe(0);
    const pid = computer.processManager.findByName('doom')[0]!.pid;
    expect(() => computer.runtime.attach(pid, 'irrelevant', 'doom')).toThrowError('No runtime manifest installed');
  });

  it('stopping a game that is not running fails cleanly', async () => {
    const { shell } = createShell(createComputerWithDoom());
    shell.run('games install doom');
    await flush();
    const result = shell.run('games stop doom');
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('is not running');
  });

  it('with no arguments, games behaves like "games list"', async () => {
    const { shell } = createShell(createComputerWithDoom());
    shell.run('games install doom');
    await flush();
    expect(shell.run('games').stdout).toContain('doom');
  });
});
