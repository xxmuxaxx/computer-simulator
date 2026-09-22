import { describe, expect, it } from 'vitest';
import { VirtualComputer } from '../computer/VirtualComputer';
import { ComputerStorage } from '../storage/ComputerStorage';
import { MemoryBackend } from '../storage/backends';
import { createComputer, createRegistry } from './helpers';

describe('network persistence', () => {
  it('restores devices, addresses, DNS, firewall rules and running services after a reload', async () => {
    const storage = new ComputerStorage(new MemoryBackend());
    const pc = createComputer();
    const server = pc.network.findDeviceByHostname('server.local')!;
    pc.network.setFirewallEnabled(server.id, true);
    pc.network.addFirewallRule(server.id, { direction: 'inbound', protocol: 'TCP', port: 22, action: 'deny' });
    pc.network.startService(server.id, 'ssh');
    await storage.save(pc.snapshot());

    const restored = new VirtualComputer({ applications: createRegistry(), snapshot: await storage.load() });
    expect(restored.network.listDevices()).toHaveLength(4);

    const restoredServer = restored.network.findDeviceByHostname('server.local')!;
    expect(restoredServer.interfaces[0]!.ipAddress).toBe('192.168.0.101');
    expect(restoredServer.firewall.enabled).toBe(true);
    expect(restoredServer.firewall.rules).toHaveLength(1);
    expect(restoredServer.services.find((s) => s.name === 'SSH')?.status).toBe('running');
    expect(restoredServer.services.find((s) => s.name === 'HTTP')?.status).toBe('running');

    // The local device keeps its own identity and file system-backed hosts/site.
    const local = restored.network.getDevice(restored.network.localDeviceId)!;
    expect(local.hostname).toBe('desktop.local');
    expect(local.interfaces[0]!.ipAddress).toBe('192.168.0.100');

    expect(restored.network.resolveDns(restored.network.localDeviceId, 'server.local')).toBe('192.168.0.101');
    const ping = restored.network.ping(restored.network.localDeviceId, 'server.local', 1);
    expect(ping.results[0]!.delivered).toBe(true);

    const httpService = restoredServer.services.find((s) => s.name === 'HTTP')!;
    expect(httpService.processId).toBeUndefined();
  });

  it('gives a running local-device service a fresh backing process after reload', async () => {
    const storage = new ComputerStorage(new MemoryBackend());
    const pc = createComputer();
    pc.network.startService(pc.network.localDeviceId, 'ssh');
    await storage.save(pc.snapshot());

    const restored = new VirtualComputer({ applications: createRegistry(), snapshot: await storage.load() });
    const local = restored.network.getDevice(restored.network.localDeviceId)!;
    const ssh = local.services.find((s) => s.name === 'SSH')!;
    expect(ssh.status).toBe('running');
    expect(ssh.processId).toBeDefined();
    expect(restored.processManager.has(ssh.processId!)).toBe(true);
  });

  it('persists a non-local device file system (its website content)', async () => {
    const storage = new ComputerStorage(new MemoryBackend());
    const pc = createComputer();
    const server = pc.network.findDeviceByHostname('server.local')!;
    pc.network.getDeviceFileSystem(server.id)!.writeFile('/var/www/about.html', '<p>about</p>');
    await storage.save(pc.snapshot());

    const restored = new VirtualComputer({ applications: createRegistry(), snapshot: await storage.load() });
    const restoredServer = restored.network.findDeviceByHostname('server.local')!;
    const response = restored.network.httpRequest(restored.network.localDeviceId, 'server.local', { path: '/about.html' });
    expect(response.body).toContain('about');
    void restoredServer;
  });
});
