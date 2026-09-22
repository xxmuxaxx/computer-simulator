import { isSameSubnet, networkFromCidr, prefixToMask } from './ip';
import type { Connection, DeviceRecord, HopRecord, NetworkInterface, RoutingEntry } from './types';

export interface Topology {
  interfaces: ReadonlyMap<string, NetworkInterface>;
  devices: ReadonlyMap<string, DeviceRecord>;
  connections: ReadonlyMap<string, Connection>;
  deviceOfInterface: ReadonlyMap<string, string>;
}

export function adjacency(topo: Topology, interfaceId: string): string[] {
  const iface = topo.interfaces.get(interfaceId);
  if (!iface || iface.status !== 'up') return [];
  const result: string[] = [];
  for (const conn of topo.connections.values()) {
    if (!conn.up) continue;
    const peer = conn.interfaceA === interfaceId ? conn.interfaceB : conn.interfaceB === interfaceId ? conn.interfaceA : null;
    if (!peer) continue;
    const peerIface = topo.interfaces.get(peer);
    if (peerIface?.status === 'up') result.push(peer);
  }
  const deviceId = topo.deviceOfInterface.get(interfaceId);
  const device = deviceId ? topo.devices.get(deviceId) : undefined;
  if (device?.type === 'switch') {
    for (const port of device.interfaces) {
      if (port.id === interfaceId || port.status !== 'up') continue;
      if (hasLiveConnection(topo, port.id)) result.push(port.id);
    }
  }
  return result;
}

function hasLiveConnection(topo: Topology, interfaceId: string): boolean {
  for (const conn of topo.connections.values()) {
    if (!conn.up) continue;
    if (conn.interfaceA === interfaceId || conn.interfaceB === interfaceId) return true;
  }
  return false;
}

/** Every interface reachable from `startInterfaceId` without crossing a router. */
export function discoverSegment(topo: Topology, startInterfaceId: string): Set<string> {
  const visited = new Set<string>([startInterfaceId]);
  const queue = [startInterfaceId];
  while (queue.length) {
    const current = queue.shift()!;
    for (const next of adjacency(topo, current)) {
      if (!visited.has(next)) {
        visited.add(next);
        queue.push(next);
      }
    }
  }
  return visited;
}

export interface SegmentMatch {
  deviceId: string;
  interfaceId: string;
}

/** Breadth-first search across a broadcast domain (switches are transparent, routers are boundaries). */
export function resolveInSegment(topo: Topology, startInterfaceId: string, targetIp: string): SegmentMatch | null {
  const visited = new Set<string>([startInterfaceId]);
  const queue: string[] = [startInterfaceId];
  while (queue.length) {
    const current = queue.shift()!;
    const iface = topo.interfaces.get(current);
    if (iface?.ipAddress === targetIp && iface.status === 'up') {
      const deviceId = topo.deviceOfInterface.get(current);
      if (deviceId) return { deviceId, interfaceId: current };
    }
    for (const next of adjacency(topo, current)) {
      if (!visited.has(next)) {
        visited.add(next);
        queue.push(next);
      }
    }
  }
  return null;
}

/** Longest-prefix match; the default route (0.0.0.0/0) always matches last. */
export function bestRoute(table: readonly RoutingEntry[], destinationIp: string): RoutingEntry | undefined {
  let best: RoutingEntry | undefined;
  let bestPrefix = -1;
  for (const entry of table) {
    try {
      const { network, prefix } = networkFromCidr(entry.destination);
      if (isSameSubnet(destinationIp, network, prefixToMask(prefix)) && prefix > bestPrefix) {
        best = entry;
        bestPrefix = prefix;
      }
    } catch {
      // Malformed routes are simply ignored.
    }
  }
  return best;
}

export interface PathResult {
  ok: boolean;
  hops: HopRecord[];
  finalDeviceId?: string;
  finalInterfaceId?: string;
  errorCode?: 'EHOSTUNREACH' | 'ENETUNREACH' | 'ETTLEXPIRED';
}

const MAX_ROUTER_HOPS = 16;

/**
 * Walks a packet from `startInterfaceId` toward `destinationIp`. A host interface delivers
 * directly when the destination shares its subnet, otherwise hops to its configured gateway.
 * Every time the packet arrives at a router (on any interface, from the original sender or a
 * previous router) that router makes its own independent routing-table decision, so chains of
 * routers are followed correctly until the packet is delivered, refused, or TTL runs out.
 */
export function resolvePath(topo: Topology, startInterfaceId: string, destinationIp: string, ttl: number, now: () => number): PathResult {
  let currentInterfaceId = startInterfaceId;
  let remainingTtl = ttl;
  const hops: HopRecord[] = [];

  for (let guard = 0; guard < MAX_ROUTER_HOPS; guard++) {
    const currentIface = topo.interfaces.get(currentInterfaceId);
    const currentDeviceId = topo.deviceOfInterface.get(currentInterfaceId);
    if (!currentIface || !currentDeviceId) return { ok: false, hops, errorCode: 'EHOSTUNREACH' };
    hops.push({ deviceId: currentDeviceId, interfaceId: currentInterfaceId, at: now() });

    if (currentIface.ipAddress === destinationIp) {
      return { ok: true, hops, finalDeviceId: currentDeviceId, finalInterfaceId: currentInterfaceId };
    }

    remainingTtl -= 1;
    if (remainingTtl <= 0) return { ok: false, hops, errorCode: 'ETTLEXPIRED' };

    const currentDevice = topo.devices.get(currentDeviceId);

    if (currentDevice?.type === 'router' && currentDevice.routingTable) {
      const route = bestRoute(currentDevice.routingTable, destinationIp);
      if (!route) return { ok: false, hops, errorCode: 'ENETUNREACH' };
      const target = route.gateway === 'connected' ? destinationIp : route.gateway;
      const found = resolveInSegment(topo, route.interfaceId, target);
      if (!found) return { ok: false, hops, errorCode: route.gateway === 'connected' ? 'EHOSTUNREACH' : 'ENETUNREACH' };
      if (route.gateway === 'connected') {
        hops.push({ deviceId: found.deviceId, interfaceId: found.interfaceId, at: now() });
        return { ok: true, hops, finalDeviceId: found.deviceId, finalInterfaceId: found.interfaceId };
      }
      currentInterfaceId = found.interfaceId;
      continue;
    }

    const sameSubnet =
      !!currentIface.ipAddress && !!currentIface.subnetMask && isSameSubnet(currentIface.ipAddress, destinationIp, currentIface.subnetMask);
    const targetInSegment = sameSubnet ? destinationIp : currentIface.gateway;
    if (!targetInSegment) return { ok: false, hops, errorCode: sameSubnet ? 'EHOSTUNREACH' : 'ENETUNREACH' };

    const found = resolveInSegment(topo, currentInterfaceId, targetInSegment);
    if (!found) return { ok: false, hops, errorCode: sameSubnet ? 'EHOSTUNREACH' : 'ENETUNREACH' };

    if (sameSubnet) {
      hops.push({ deviceId: found.deviceId, interfaceId: found.interfaceId, at: now() });
      return { ok: true, hops, finalDeviceId: found.deviceId, finalInterfaceId: found.interfaceId };
    }
    currentInterfaceId = found.interfaceId;
  }
  return { ok: false, hops, errorCode: 'ENETUNREACH' };
}
