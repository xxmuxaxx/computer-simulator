import { describe, expect, it } from 'vitest';
import { createComputer } from './helpers';

/** Builds a two-router, two-subnet topology: PC-A(192.168.10.0/24) <-> routerA <-> routerB <-> PC-B(192.168.20.0/24). */
function buildTwoNetworkTopology() {
  const { network } = createComputer();
  const pcA = network.createDevice({ hostname: 'pc-a.local', type: 'computer' });
  const routerA = network.createDevice({ hostname: 'router-a.local', type: 'router', interfaceCount: 2 });
  const routerB = network.createDevice({ hostname: 'router-b.local', type: 'router', interfaceCount: 2 });
  const pcB = network.createDevice({ hostname: 'pc-b.local', type: 'computer' });

  network.connectDevices(pcA.id, routerA.id);
  network.connect(routerA.interfaces[1]!.id, routerB.interfaces[1]!.id);
  network.connectDevices(routerB.id, pcB.id);

  network.configureInterface(routerA.id, routerA.interfaces[0]!.id, { ipAddress: '192.168.10.1', subnetMask: '255.255.255.0' });
  network.configureInterface(routerA.id, routerA.interfaces[1]!.id, { ipAddress: '172.16.1.1', subnetMask: '255.255.255.252' });
  network.configureInterface(routerB.id, routerB.interfaces[1]!.id, { ipAddress: '172.16.1.2', subnetMask: '255.255.255.252' });
  network.configureInterface(routerB.id, routerB.interfaces[0]!.id, { ipAddress: '192.168.20.1', subnetMask: '255.255.255.0' });

  network.configureInterface(pcA.id, pcA.interfaces[0]!.id, { ipAddress: '192.168.10.2', subnetMask: '255.255.255.0', gateway: '192.168.10.1' });
  network.configureInterface(pcB.id, pcB.interfaces[0]!.id, { ipAddress: '192.168.20.2', subnetMask: '255.255.255.0', gateway: '192.168.20.1' });

  return { network, pcA, pcB, routerA, routerB };
}

describe('routing between subnets', () => {
  it('delivers a packet unreachable without cross routes', () => {
    const { network, pcB } = buildTwoNetworkTopology();
    const result = network.sendPacket({ sourceIp: '192.168.10.2', destinationIp: '192.168.20.2', protocol: 'ICMP' });
    expect(result.delivered).toBe(false);
    expect(result.errorCode).toBe('ENETUNREACH');
    void pcB;
  });

  it('routes across two routers once static routes point at each other', () => {
    const { network, routerA, routerB } = buildTwoNetworkTopology();
    network.addRoute(routerA.id, { destination: '192.168.20.0/24', gateway: '172.16.1.2', interfaceId: routerA.interfaces[1]!.id });
    network.addRoute(routerB.id, { destination: '192.168.10.0/24', gateway: '172.16.1.1', interfaceId: routerB.interfaces[1]!.id });

    const result = network.sendPacket({ sourceIp: '192.168.10.2', destinationIp: '192.168.20.2', protocol: 'ICMP' });
    expect(result.delivered).toBe(true);
    expect(result.hops.map((h) => h.deviceId)).toEqual(expect.arrayContaining([routerA.id, routerB.id]));
  });

  it('reports a network as unreachable when no route matches and there is no default route', () => {
    const { network } = buildTwoNetworkTopology();
    const result = network.sendPacket({ sourceIp: '192.168.10.2', destinationIp: '8.8.8.8', protocol: 'ICMP' });
    expect(result.delivered).toBe(false);
    expect(result.errorCode).toBe('ENETUNREACH');
  });

  it('follows the default route (0.0.0.0/0) when a more specific route is missing', () => {
    const { network, routerA, routerB } = buildTwoNetworkTopology();
    network.addRoute(routerA.id, { destination: '0.0.0.0/0', gateway: '172.16.1.2', interfaceId: routerA.interfaces[1]!.id });
    const result = network.sendPacket({ sourceIp: '192.168.10.2', destinationIp: '8.8.8.8', protocol: 'ICMP' });
    // The packet does travel via the default route to routerB, which then has nowhere left to send it.
    expect(result.hops.some((h) => h.deviceId === routerB.id)).toBe(true);
    expect(result.delivered).toBe(false);
    expect(result.errorCode).toBe('ENETUNREACH');
  });

  it('expires packets whose TTL reaches zero', () => {
    const { network } = buildTwoNetworkTopology();
    const result = network.sendPacket({ sourceIp: '192.168.10.2', destinationIp: '192.168.10.1', protocol: 'ICMP', ttl: 1 });
    expect(result.delivered).toBe(false);
    expect(result.errorCode).toBe('ETTLEXPIRED');
  });

  it('reports host unreachable for an address with no matching host on the local segment', () => {
    const { network } = buildTwoNetworkTopology();
    const result = network.sendPacket({ sourceIp: '192.168.10.2', destinationIp: '192.168.10.99', protocol: 'ICMP' });
    expect(result.delivered).toBe(false);
    expect(result.errorCode).toBe('EHOSTUNREACH');
  });
});

describe('ping', () => {
  it('produces one result per echo request with simulated latency', () => {
    const { network, pcA, routerA } = buildTwoNetworkTopology();
    const routerAIp = network.getDevice(routerA.id)!.interfaces[0]!.ipAddress!;
    const { resolvedIp, results } = network.ping(pcA.id, routerAIp, 3);
    expect(resolvedIp).toBe('192.168.10.1');
    expect(results).toHaveLength(3);
    for (const r of results) {
      expect(r.delivered).toBe(true);
      expect(r.latencyMs).toBeGreaterThan(0);
    }
  });

  it('times out against an unreachable host', () => {
    const { network, pcA } = buildTwoNetworkTopology();
    const { results } = network.ping(pcA.id, '192.168.10.250', 1);
    expect(results[0]!.delivered).toBe(false);
  });
});
