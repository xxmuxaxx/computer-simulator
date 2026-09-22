import { describe, expect, it } from 'vitest';
import { createComputer } from './helpers';

describe('default network', () => {
  it('boots with a router, the local computer and a server, all connected and addressed', () => {
    const computer = createComputer();
    const { network } = computer;
    const devices = network.listDevices();
    expect(devices).toHaveLength(4);

    const local = network.getDevice(network.localDeviceId)!;
    expect(local.hostname).toBe('desktop.local');
    expect(local.interfaces[0]!.ipAddress).toBe('192.168.0.100');

    const router = network.findDeviceByHostname('router.local')!;
    expect(router.type).toBe('router');
    expect(router.interfaces[0]!.ipAddress).toBe('192.168.0.1');
    expect(router.routingTable).toEqual([
      expect.objectContaining({ destination: '192.168.0.0/24', gateway: 'connected' }),
    ]);

    const server = network.findDeviceByHostname('server.local')!;
    expect(server.interfaces[0]!.ipAddress).toBe('192.168.0.101');
    expect(server.services.find((s) => s.name === 'HTTP')?.status).toBe('running');

    expect(network.listConnections()).toHaveLength(3);

    const lanSwitch = network.findDeviceByHostname('switch.local')!;
    expect(lanSwitch.type).toBe('switch');
    expect(network.getMacTable(lanSwitch.id).map((e) => e.mac).sort()).toEqual(
      [router.interfaces[0]!.macAddress, local.interfaces[0]!.macAddress, server.interfaces[0]!.macAddress].sort(),
    );
  });
});

describe('device and interface management', () => {
  it('creates devices with generated MAC addresses and unique hostnames', () => {
    const { network } = createComputer();
    const laptop = network.createDevice({ hostname: 'laptop.local', type: 'computer' });
    expect(laptop.interfaces[0]!.macAddress).toMatch(/^([0-9A-F]{2}:){5}[0-9A-F]{2}$/);
    expect(() => network.createDevice({ hostname: 'laptop.local', type: 'computer' })).toThrow(/laptop\.local/);
  });

  it('rejects duplicate IP assignment', () => {
    const { network } = createComputer();
    const laptop = network.createDevice({ hostname: 'laptop.local', type: 'computer' });
    expect(() => network.configureInterface(laptop.id, laptop.interfaces[0]!.id, { ipAddress: '192.168.0.100' })).toThrow(/already assigned/);
  });

  it('rejects invalid IP and subnet mask', () => {
    const { network } = createComputer();
    const laptop = network.createDevice({ hostname: 'laptop.local', type: 'computer' });
    expect(() => network.configureInterface(laptop.id, laptop.interfaces[0]!.id, { ipAddress: 'nope' })).toThrow();
    expect(() => network.configureInterface(laptop.id, laptop.interfaces[0]!.id, { subnetMask: '255.0.255.0' })).toThrow();
  });

  it('connects and disconnects devices, and can simulate a link failure', () => {
    const { network } = createComputer();
    const laptop = network.createDevice({ hostname: 'laptop.local', type: 'computer' });
    const sw = network.createDevice({ hostname: 'sw1', type: 'switch', interfaceCount: 4 });
    const conn = network.connectDevices(sw.id, laptop.id);
    expect(network.listConnections()).toHaveLength(4);
    network.setConnectionUp(conn.id, false);
    expect(network.listConnections().find((c) => c.id === conn.id)?.up).toBe(false);
    network.disconnect(conn.id);
    expect(network.listConnections()).toHaveLength(3);
  });
});
