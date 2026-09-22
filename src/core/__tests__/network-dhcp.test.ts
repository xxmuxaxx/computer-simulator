import { describe, expect, it } from 'vitest';
import { createComputer } from './helpers';

function buildLan() {
  const { network } = createComputer();
  const router = network.createDevice({ hostname: 'r1.local', type: 'router', interfaceCount: 1 });
  const lanSwitch = network.createDevice({ hostname: 'sw1.local', type: 'switch', interfaceCount: 4 });
  network.connectDevices(router.id, lanSwitch.id);
  network.configureInterface(router.id, router.interfaces[0]!.id, { ipAddress: '192.168.5.1', subnetMask: '255.255.255.0' });
  network.configureDhcp(router.id, {
    enabled: true,
    interfaceId: router.interfaces[0]!.id,
    rangeStart: '192.168.5.10',
    rangeEnd: '192.168.5.11',
    gateway: '192.168.5.1',
    subnetMask: '255.255.255.0',
    dnsServers: ['192.168.5.1'],
  });
  return { network, router, lanSwitch };
}

describe('DHCP', () => {
  it('allocates an address from the configured pool', () => {
    const { network, lanSwitch } = buildLan();
    const pc = network.createDevice({ hostname: 'pc1.local', type: 'computer' });
    network.connectDevices(lanSwitch.id, pc.id);
    const lease = network.requestDhcp(pc.id, pc.interfaces[0]!.id);
    expect(['192.168.5.10', '192.168.5.11']).toContain(lease.ipAddress);
    const iface = network.getDevice(pc.id)!.interfaces[0]!;
    expect(iface.ipAddress).toBe(lease.ipAddress);
    expect(iface.gateway).toBe('192.168.5.1');
    expect(iface.dhcp).toBe(true);
  });

  it('renews the same lease for the same MAC address', () => {
    const { network, lanSwitch } = buildLan();
    const pc = network.createDevice({ hostname: 'pc1.local', type: 'computer' });
    network.connectDevices(lanSwitch.id, pc.id);
    const first = network.requestDhcp(pc.id, pc.interfaces[0]!.id);
    const second = network.requestDhcp(pc.id, pc.interfaces[0]!.id);
    expect(second.ipAddress).toBe(first.ipAddress);
  });

  it('prevents two devices from ever holding the same leased address', () => {
    const { network, lanSwitch } = buildLan();
    const pc1 = network.createDevice({ hostname: 'pc1.local', type: 'computer' });
    const pc2 = network.createDevice({ hostname: 'pc2.local', type: 'computer' });
    network.connectDevices(lanSwitch.id, pc1.id);
    network.connectDevices(lanSwitch.id, pc2.id);
    const lease1 = network.requestDhcp(pc1.id, pc1.interfaces[0]!.id);
    const lease2 = network.requestDhcp(pc2.id, pc2.interfaces[0]!.id);
    expect(lease1.ipAddress).not.toBe(lease2.ipAddress);
  });

  it('throws once the pool is exhausted', () => {
    const { network, lanSwitch } = buildLan();
    const pc1 = network.createDevice({ hostname: 'pc1.local', type: 'computer' });
    const pc2 = network.createDevice({ hostname: 'pc2.local', type: 'computer' });
    const pc3 = network.createDevice({ hostname: 'pc3.local', type: 'computer' });
    network.connectDevices(lanSwitch.id, pc1.id);
    network.connectDevices(lanSwitch.id, pc2.id);
    network.connectDevices(lanSwitch.id, pc3.id);
    network.requestDhcp(pc1.id, pc1.interfaces[0]!.id);
    network.requestDhcp(pc2.id, pc2.interfaces[0]!.id);
    expect(() => network.requestDhcp(pc3.id, pc3.interfaces[0]!.id)).toThrow(/exhausted/);
  });

  it('fails when no DHCP server is reachable', () => {
    const { network } = createComputer();
    const pc = network.createDevice({ hostname: 'isolated.local', type: 'computer' });
    expect(() => network.requestDhcp(pc.id, pc.interfaces[0]!.id)).toThrow(/DHCP/);
  });
});
