import { describe, expect, it } from 'vitest';
import { createComputer } from './helpers';

describe('services', () => {
  it('starts and stops a well-known service by name', () => {
    const { network } = createComputer();
    const server = network.findDeviceByHostname('server.local')!;
    const service = network.startService(server.id, 'ssh');
    expect(service.status).toBe('running');
    expect(service.port).toBe(22);
    network.stopService(server.id, service.id);
    expect(network.listServices(server.id).find((s) => s.id === service.id)?.status).toBe('stopped');
  });

  it('backs a running service on the local device with a real process', () => {
    const computer = createComputer();
    const service = computer.network.startService(computer.network.localDeviceId, 'http');
    expect(service.processId).toBeDefined();
    expect(computer.processManager.has(service.processId!)).toBe(true);
    computer.network.stopService(computer.network.localDeviceId, service.id);
    expect(computer.processManager.has(service.processId!)).toBe(false);
  });

  it('marks a service stopped when its process is killed independently', () => {
    const computer = createComputer();
    const service = computer.network.startService(computer.network.localDeviceId, 'ssh');
    computer.processManager.kill(service.processId!);
    expect(computer.network.listServices(computer.network.localDeviceId).find((s) => s.id === service.id)?.status).toBe('stopped');
  });

  it('rejects starting a second service on a port already in use', () => {
    const { network } = createComputer();
    const server = network.findDeviceByHostname('server.local')!;
    // HTTP is already running on port 80 from the default seed.
    expect(() => network.startService(server.id, { name: 'Other', protocol: 'TCP', port: 80 })).toThrow(/in use/);
  });
});
