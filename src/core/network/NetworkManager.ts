import { SystemError, type ErrorCode } from '../errors';
import type { ProcessManager } from '../process/ProcessManager';
import { VirtualFileSystem } from '../filesystem/VirtualFileSystem';
import { Observable } from '../../utils/Observable';
import { extname } from '../../utils/path';
import { uid } from '../../utils/id';
import { NetworkEventBus } from './events';
import { allocateLease } from './dhcp';
import { DnsRegistry, lookupHosts } from './dns';
import { evaluateFirewall, createFirewallRule } from './firewall';
import { calculateNetwork, isSameSubnet, isValidCidr, isValidIp, isValidSubnetMask, maskToPrefixLength, networkFromCidr } from './ip';
import { generateMac } from './mac';
import { discoverSegment, resolvePath, type Topology } from './routing';
import { seedDefaultNetwork } from './seed';
import type { NetworkSnapshot } from './snapshot';
import { assertPortFree, createService, findServiceByPort, WELL_KNOWN_SERVICES, type ServiceSpec } from './services';
import type {
  Connection,
  DeviceRecord,
  DeviceStats,
  DeviceType,
  DhcpConfig,
  DhcpLease,
  DnsRecord,
  FirewallRule,
  HttpResponse,
  Network,
  NetworkDevice,
  NetworkEventMap,
  NetworkEventName,
  NetworkInterface,
  NetworkService,
  Packet,
  PacketResult,
  Protocol,
  RoutingEntry,
} from './types';

export interface NetworkManagerOptions {
  now?: () => number;
  random?: () => number;
  /** The user's own computer: its file system becomes the local device's /etc, /var/www. */
  localFileSystem: VirtualFileSystem;
  /** Lets running a service on the local device show up as a real process. */
  localProcessManager: ProcessManager;
  snapshot?: NetworkSnapshot | null;
}

export interface SendPacketInput {
  sourceIp: string;
  destinationIp: string;
  protocol: Protocol;
  sourcePort?: number;
  destinationPort?: number;
  payload?: unknown;
  ttl?: number;
}

export interface CreateDeviceInput {
  hostname: string;
  type: DeviceType;
  interfaceCount?: number;
}

const DEFAULT_TTL = 64;
const MAX_LATENCY_SAMPLES = 20;

function emptyStats(): DeviceStats {
  return { packetsSent: 0, packetsReceived: 0, packetsDropped: 0, packetsBlocked: 0, averageLatencyMs: 0, latencySamples: [] };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * Composition root of the virtual network: devices, interfaces, connections, routing, DHCP,
 * DNS, firewalls, services and packet delivery. Zero dependency on React - UI code (Network
 * Manager, Network Monitor, Browser, Server Manager, terminal commands) only observes it.
 */
export class NetworkManager extends Observable {
  readonly events = new NetworkEventBus();
  readonly localDeviceId: string;

  private devices = new Map<string, DeviceRecord>();
  private connections = new Map<string, Connection>();
  private networks = new Map<string, Network>();
  private dnsRegistries = new Map<string, DnsRegistry>();

  private readonly now: () => number;
  private readonly random: () => number;
  private readonly localFileSystem: VirtualFileSystem;
  private readonly localProcessManager: ProcessManager;

  constructor(options: NetworkManagerOptions) {
    super();
    this.now = options.now ?? Date.now;
    this.random = options.random ?? Math.random;
    this.localFileSystem = options.localFileSystem;
    this.localProcessManager = options.localProcessManager;
    ensureNetworkPaths(this.localFileSystem);

    if (options.snapshot) {
      this.localDeviceId = this.restoreFrom(options.snapshot);
    } else {
      this.localDeviceId = this.registerLocalDevice('desktop.local').id;
      seedDefaultNetwork(this, this.localDeviceId);
    }
  }

  on<K extends NetworkEventName>(event: K, listener: (payload: NetworkEventMap[K]) => void): () => void {
    return this.events.on(event, listener);
  }

  // ───────────────────────────── devices ─────────────────────────────

  private registerLocalDevice(hostname: string): NetworkDevice {
    const id = uid('dev');
    const record: DeviceRecord = {
      id,
      hostname,
      type: 'computer',
      interfaces: [this.makeInterface(id, 0)],
      firewall: { enabled: false, rules: [] },
      services: [],
      stats: emptyStats(),
      hasFileSystem: true,
      isLocal: true,
      fileSystem: this.localFileSystem,
    };
    this.devices.set(id, record);
    return this.toPublic(record);
  }

  private makeInterface(deviceId: string, index: number): NetworkInterface {
    return { id: uid('if'), deviceId, name: `eth${index}`, macAddress: generateMac(), dnsServers: [], status: 'up' };
  }

  private createDeviceFileSystem(type: DeviceType): VirtualFileSystem | undefined {
    if (type !== 'computer' && type !== 'server') return undefined;
    const fs = new VirtualFileSystem({ now: this.now });
    ensureNetworkPaths(fs);
    return fs;
  }

  createDevice(input: CreateDeviceInput): NetworkDevice {
    if (this.findDeviceByHostname(input.hostname)) {
      throw new SystemError('EDUPHOST', input.hostname, `A device named "${input.hostname}" already exists`);
    }
    const id = uid('dev');
    const count = input.interfaceCount ?? (input.type === 'router' ? 2 : 1);
    const interfaces = Array.from({ length: Math.max(1, count) }, (_, i) => this.makeInterface(id, i));
    const fileSystem = this.createDeviceFileSystem(input.type);
    const record: DeviceRecord = {
      id,
      hostname: input.hostname,
      type: input.type,
      interfaces,
      firewall: { enabled: false, rules: [] },
      services: [],
      stats: emptyStats(),
      hasFileSystem: !!fileSystem,
      isLocal: false,
      fileSystem,
      routingTable: input.type === 'router' ? [] : undefined,
    };
    this.devices.set(id, record);
    this.emit();
    this.events.emit('device:added', { device: this.toPublic(record) });
    return this.toPublic(record);
  }

  removeDevice(deviceId: string): void {
    const device = this.requireDevice(deviceId);
    if (device.isLocal) throw new SystemError('EACCES', deviceId, 'The local computer cannot be removed');
    for (const iface of device.interfaces) {
      const conn = this.findConnectionOf(iface.id);
      if (conn) this.connections.delete(conn.id);
    }
    this.devices.delete(deviceId);
    this.emit();
    this.events.emit('device:removed', { deviceId });
  }

  getDevice(deviceId: string): NetworkDevice | undefined {
    const record = this.devices.get(deviceId);
    return record && this.toPublic(record);
  }

  requireDevice(deviceId: string): DeviceRecord {
    const record = this.devices.get(deviceId);
    if (!record) throw new SystemError('ENODEV', deviceId, 'No such network device');
    return record;
  }

  listDevices(): NetworkDevice[] {
    return [...this.devices.values()].map((d) => this.toPublic(d));
  }

  findDeviceByHostname(hostname: string): NetworkDevice | undefined {
    const record = [...this.devices.values()].find((d) => d.hostname.toLowerCase() === hostname.toLowerCase());
    return record && this.toPublic(record);
  }

  findDeviceByIp(ip: string): NetworkDevice | undefined {
    const record = [...this.devices.values()].find((d) => d.interfaces.some((i) => i.ipAddress === ip));
    return record && this.toPublic(record);
  }

  getDeviceFileSystem(deviceId: string): VirtualFileSystem | undefined {
    return this.devices.get(deviceId)?.fileSystem;
  }

  // ───────────────────────────── interfaces ─────────────────────────────

  private findInterface(deviceId: string, interfaceId: string): { device: DeviceRecord; iface: NetworkInterface } {
    const device = this.requireDevice(deviceId);
    const iface = device.interfaces.find((i) => i.id === interfaceId);
    if (!iface) throw new SystemError('ENODEV', interfaceId, 'No such network interface');
    return { device, iface };
  }

  addInterface(deviceId: string): NetworkInterface {
    const device = this.requireDevice(deviceId);
    const iface = this.makeInterface(deviceId, device.interfaces.length);
    device.interfaces.push(iface);
    this.emit();
    return { ...iface };
  }

  setInterfaceStatus(deviceId: string, interfaceId: string, status: NetworkInterface['status']): void {
    const { iface } = this.findInterface(deviceId, interfaceId);
    iface.status = status;
    this.emit();
  }

  configureInterface(
    deviceId: string,
    interfaceId: string,
    patch: Partial<Pick<NetworkInterface, 'ipAddress' | 'subnetMask' | 'gateway' | 'dnsServers'>>,
  ): NetworkInterface {
    const { device, iface } = this.findInterface(deviceId, interfaceId);

    if (patch.ipAddress !== undefined) {
      if (patch.ipAddress && !isValidIp(patch.ipAddress)) throw new SystemError('EINVAL', patch.ipAddress, 'Invalid IP address');
      if (patch.ipAddress) {
        const owner = this.findDeviceByIp(patch.ipAddress);
        if (owner && owner.id !== deviceId) throw new SystemError('EDUPIP', patch.ipAddress, `${patch.ipAddress} is already assigned to ${owner.hostname}`);
      }
      iface.ipAddress = patch.ipAddress || undefined;
      iface.dhcp = false;
    }
    if (patch.subnetMask !== undefined) {
      if (patch.subnetMask && !isValidSubnetMask(patch.subnetMask)) throw new SystemError('EINVAL', patch.subnetMask, 'Invalid subnet mask');
      iface.subnetMask = patch.subnetMask || undefined;
    }
    if (patch.gateway !== undefined) {
      if (patch.gateway && !isValidIp(patch.gateway)) throw new SystemError('EINVAL', patch.gateway, 'Invalid gateway address');
      iface.gateway = patch.gateway || undefined;
    }
    if (patch.dnsServers !== undefined) iface.dnsServers = [...patch.dnsServers];

    if (device.type === 'router' && iface.ipAddress && iface.subnetMask) {
      const network = calculateNetwork(iface.ipAddress, iface.subnetMask);
      const prefix = maskToPrefixLength(iface.subnetMask);
      device.routingTable = (device.routingTable ?? []).filter((r) => !(r.gateway === 'connected' && r.interfaceId === iface.id));
      device.routingTable.push({ id: uid('rt'), destination: `${network}/${prefix}`, gateway: 'connected', interfaceId: iface.id });
    }
    this.emit();
    this.events.emit('device:updated', { device: this.toPublic(device) });
    return { ...iface };
  }

  // ───────────────────────────── topology ─────────────────────────────

  private topology(): Topology {
    const interfaces = new Map<string, NetworkInterface>();
    const deviceOfInterface = new Map<string, string>();
    for (const device of this.devices.values()) {
      for (const iface of device.interfaces) {
        interfaces.set(iface.id, iface);
        deviceOfInterface.set(iface.id, device.id);
      }
    }
    return { interfaces, devices: this.devices, connections: this.connections, deviceOfInterface };
  }

  private findConnectionOf(interfaceId: string): Connection | undefined {
    for (const conn of this.connections.values()) {
      if (conn.interfaceA === interfaceId || conn.interfaceB === interfaceId) return conn;
    }
    return undefined;
  }

  private freeInterface(device: DeviceRecord): NetworkInterface {
    const free = device.interfaces.find((i) => !this.findConnectionOf(i.id));
    if (free) return free;
    const iface = this.makeInterface(device.id, device.interfaces.length);
    device.interfaces.push(iface);
    return iface;
  }

  connect(interfaceAId: string, interfaceBId: string): Connection {
    if (interfaceAId === interfaceBId) throw new SystemError('EINVAL', interfaceAId, 'Cannot connect an interface to itself');
    if (this.findConnectionOf(interfaceAId)) throw new SystemError('EINVAL', interfaceAId, 'Interface is already connected');
    if (this.findConnectionOf(interfaceBId)) throw new SystemError('EINVAL', interfaceBId, 'Interface is already connected');
    const connection: Connection = { id: uid('conn'), interfaceA: interfaceAId, interfaceB: interfaceBId, up: true };
    this.connections.set(connection.id, connection);
    this.emit();
    this.events.emit('connection:added', { connection: { ...connection } });
    return { ...connection };
  }

  connectDevices(deviceAId: string, deviceBId: string): Connection {
    const a = this.requireDevice(deviceAId);
    const b = this.requireDevice(deviceBId);
    return this.connect(this.freeInterface(a).id, this.freeInterface(b).id);
  }

  disconnect(connectionId: string): void {
    if (!this.connections.delete(connectionId)) throw new SystemError('ENODEV', connectionId, 'No such connection');
    this.emit();
    this.events.emit('connection:removed', { connectionId });
  }

  disconnectDevices(deviceAId: string, deviceBId: string): void {
    const a = this.requireDevice(deviceAId);
    const b = this.requireDevice(deviceBId);
    const bInterfaceIds = new Set(b.interfaces.map((i) => i.id));
    for (const conn of this.connections.values()) {
      const aSide = a.interfaces.some((i) => i.id === conn.interfaceA || i.id === conn.interfaceB);
      const bSide = bInterfaceIds.has(conn.interfaceA) || bInterfaceIds.has(conn.interfaceB);
      if (aSide && bSide) {
        this.disconnect(conn.id);
        return;
      }
    }
  }

  /** Used by "Simulate Network Failure" without tearing down the cable/device. */
  setConnectionUp(connectionId: string, up: boolean): void {
    const conn = this.connections.get(connectionId);
    if (!conn) throw new SystemError('ENODEV', connectionId, 'No such connection');
    conn.up = up;
    this.emit();
    this.events.emit('connection:updated', { connection: { ...conn } });
  }

  listConnections(): Connection[] {
    return [...this.connections.values()].map((c) => ({ ...c }));
  }

  // ───────────────────────────── networks ─────────────────────────────

  createNetwork(name: string, cidr: string): Network {
    if (!isValidCidr(cidr)) throw new SystemError('EINVAL', cidr, 'Invalid CIDR block');
    const network: Network = { id: uid('net'), name, cidr };
    this.networks.set(network.id, network);
    this.dnsRegistries.set(network.id, new DnsRegistry());
    this.emit();
    return { ...network };
  }

  removeNetwork(networkId: string): void {
    this.networks.delete(networkId);
    this.dnsRegistries.delete(networkId);
    this.emit();
  }

  listNetworks(): Network[] {
    return [...this.networks.values()].map((n) => ({ ...n }));
  }

  findNetworkForIp(ip: string): Network | undefined {
    for (const network of this.networks.values()) {
      try {
        const { network: addr, mask } = networkFromCidr(network.cidr);
        if (isSameSubnet(ip, addr, mask)) return { ...network };
      } catch {
        // Skip malformed entries rather than failing the whole lookup.
      }
    }
    return undefined;
  }

  // ───────────────────────────── DNS ─────────────────────────────

  private registryFor(networkId: string): DnsRegistry {
    const registry = this.dnsRegistries.get(networkId);
    if (!registry) throw new SystemError('ENODEV', networkId, 'No such network');
    return registry;
  }

  addDnsRecord(networkId: string, hostname: string, ipAddress: string): DnsRecord {
    const record = this.registryFor(networkId).addRecord(hostname, ipAddress);
    this.emit();
    return record;
  }

  setDnsRecord(networkId: string, hostname: string, ipAddress: string): DnsRecord {
    const record = this.registryFor(networkId).setRecord(hostname, ipAddress);
    this.emit();
    return record;
  }

  removeDnsRecord(networkId: string, hostname: string): void {
    this.registryFor(networkId).removeRecord(hostname);
    this.emit();
  }

  listDnsRecords(networkId: string): DnsRecord[] {
    return this.registryFor(networkId).list();
  }

  /** Resolves via the device's own /etc/hosts first, then every known DNS registry. */
  resolveDns(deviceId: string, hostname: string): string {
    const device = this.requireDevice(deviceId);
    const hostsIp = lookupHosts(device.fileSystem, hostname);
    if (hostsIp) {
      this.events.emit('dns:query', { hostname, resolved: hostsIp, deviceId });
      return hostsIp;
    }
    for (const registry of this.dnsRegistries.values()) {
      const ip = registry.lookup(hostname);
      if (ip) {
        this.events.emit('dns:query', { hostname, resolved: ip, deviceId });
        return ip;
      }
    }
    this.events.emit('dns:query', { hostname, resolved: undefined, deviceId });
    throw new SystemError('EDNSFAIL', hostname, `Could not resolve hostname: ${hostname}`);
  }

  // ───────────────────────────── DHCP ─────────────────────────────

  configureDhcp(routerDeviceId: string, config: Omit<DhcpConfig, 'leases'>): void {
    const device = this.requireDevice(routerDeviceId);
    if (device.type !== 'router') throw new SystemError('EINVAL', routerDeviceId, 'Only a router can run a DHCP server');
    device.dhcp = { ...config, dnsServers: [...config.dnsServers], leases: device.dhcp?.leases ?? [] };
    this.emit();
  }

  requestDhcp(deviceId: string, interfaceId: string): DhcpLease {
    const { device, iface } = this.findInterface(deviceId, interfaceId);
    const topo = this.topology();
    const segment = discoverSegment(topo, interfaceId);
    let config: DhcpConfig | undefined;
    for (const ifaceId of segment) {
      const ownerId = topo.deviceOfInterface.get(ifaceId);
      const candidate = ownerId ? this.devices.get(ownerId) : undefined;
      if (candidate?.type === 'router' && candidate.dhcp?.enabled && candidate.dhcp.interfaceId === ifaceId) {
        config = candidate.dhcp;
        break;
      }
    }
    if (!config) throw new SystemError('ENODHCP', undefined, 'No DHCP server found on this network');
    const lease = allocateLease(config, iface.macAddress, device.hostname, this.now);
    iface.ipAddress = lease.ipAddress;
    iface.subnetMask = config.subnetMask;
    iface.gateway = config.gateway;
    iface.dnsServers = [...config.dnsServers];
    iface.dhcp = true;
    this.emit();
    this.events.emit('dhcp:lease', { deviceId, lease });
    return { ...lease };
  }

  private spawnServiceProcess(serviceName: string): number {
    return this.localProcessManager.spawn({ name: `${serviceName.toLowerCase()}d`, memoryUsage: 32, baseCpu: 1.2, kind: 'service' }).pid;
  }

  // ───────────────────────────── services ─────────────────────────────

  startService(deviceId: string, name: string | ServiceSpec): NetworkService {
    const device = this.requireDevice(deviceId);
    const spec = typeof name === 'string' ? WELL_KNOWN_SERVICES[name.toLowerCase()] : name;
    if (!spec) throw new SystemError('EINVAL', String(name), `Unknown service: ${String(name)}`);
    let service = device.services.find((s) => s.name.toLowerCase() === spec.name.toLowerCase());
    assertPortFree(device.services, spec.port, spec.protocol, service?.id);
    if (!service) {
      service = createService(spec);
      device.services.push(service);
    }
    service.status = 'running';
    if (device.isLocal) service.processId = this.spawnServiceProcess(spec.name);
    this.emit();
    this.events.emit('service:started', { deviceId, service: { ...service } });
    return { ...service };
  }

  stopService(deviceId: string, serviceId: string): void {
    const device = this.requireDevice(deviceId);
    const service = device.services.find((s) => s.id === serviceId);
    if (!service) throw new SystemError('ENODEV', serviceId, 'No such service');
    service.status = 'stopped';
    if (service.processId !== undefined && this.localProcessManager.has(service.processId)) {
      this.localProcessManager.terminate(service.processId);
    }
    service.processId = undefined;
    this.emit();
    this.events.emit('service:stopped', { deviceId, service: { ...service } });
  }

  /** Keeps a service's status honest when its backing process is killed from Task Manager. */
  handleProcessExit(pid: number): void {
    for (const device of this.devices.values()) {
      const service = device.services.find((s) => s.processId === pid);
      if (service) {
        service.status = 'stopped';
        service.processId = undefined;
        this.emit();
        this.events.emit('service:stopped', { deviceId: device.id, service: { ...service } });
      }
    }
  }

  listServices(deviceId: string): NetworkService[] {
    return this.requireDevice(deviceId).services.map((s) => ({ ...s }));
  }

  // ───────────────────────────── firewall ─────────────────────────────

  setFirewallEnabled(deviceId: string, enabled: boolean): void {
    this.requireDevice(deviceId).firewall.enabled = enabled;
    this.emit();
  }

  addFirewallRule(deviceId: string, input: Omit<FirewallRule, 'id'>): FirewallRule {
    const device = this.requireDevice(deviceId);
    const rule = createFirewallRule(input);
    device.firewall.rules.push(rule);
    this.emit();
    return { ...rule };
  }

  removeFirewallRule(deviceId: string, ruleId: string): void {
    const device = this.requireDevice(deviceId);
    device.firewall.rules = device.firewall.rules.filter((r) => r.id !== ruleId);
    this.emit();
  }

  moveFirewallRule(deviceId: string, ruleId: string, direction: 'up' | 'down'): void {
    const device = this.requireDevice(deviceId);
    const rules = device.firewall.rules;
    const index = rules.findIndex((r) => r.id === ruleId);
    const swapWith = direction === 'up' ? index - 1 : index + 1;
    if (index < 0 || swapWith < 0 || swapWith >= rules.length) return;
    [rules[index], rules[swapWith]] = [rules[swapWith]!, rules[index]!];
    this.emit();
  }

  listFirewallRules(deviceId: string): FirewallRule[] {
    return this.requireDevice(deviceId).firewall.rules.map((r) => ({ ...r }));
  }

  // ───────────────────────────── routing table ─────────────────────────────

  getRoutingTable(routerDeviceId: string): RoutingEntry[] {
    const device = this.requireDevice(routerDeviceId);
    return (device.routingTable ?? []).map((r) => ({ ...r }));
  }

  addRoute(routerDeviceId: string, input: Omit<RoutingEntry, 'id'>): RoutingEntry {
    const device = this.requireDevice(routerDeviceId);
    if (device.type !== 'router') throw new SystemError('EINVAL', routerDeviceId, 'Only routers have a routing table');
    const entry: RoutingEntry = { id: uid('rt'), ...input };
    device.routingTable = [...(device.routingTable ?? []), entry];
    this.emit();
    return { ...entry };
  }

  removeRoute(routerDeviceId: string, routeId: string): void {
    const device = this.requireDevice(routerDeviceId);
    device.routingTable = (device.routingTable ?? []).filter((r) => r.id !== routeId);
    this.emit();
  }

  // ───────────────────────────── packets ─────────────────────────────

  sendPacket(input: SendPacketInput): PacketResult {
    const sourceDevice = [...this.devices.values()].find((d) => d.interfaces.some((i) => i.ipAddress === input.sourceIp));
    if (!sourceDevice) throw new SystemError('ENODEV', input.sourceIp, 'Unknown source address');
    const sourceIface = sourceDevice.interfaces.find((i) => i.ipAddress === input.sourceIp)!;

    const packet: Packet = {
      id: uid('pkt'),
      sourceIp: input.sourceIp,
      destinationIp: input.destinationIp,
      protocol: input.protocol,
      sourcePort: input.sourcePort,
      destinationPort: input.destinationPort,
      payload: input.payload,
      ttl: input.ttl ?? DEFAULT_TTL,
      createdAt: this.now(),
    };
    this.events.emit('packet:sent', { packet, fromDeviceId: sourceDevice.id });

    const outbound = evaluateFirewall(sourceDevice.firewall, packet, 'outbound');
    if (!outbound.allow) {
      return this.dropped(packet, [], sourceDevice, 'EFWDENY', outbound.rule);
    }

    const path = resolvePath(this.topology(), sourceIface.id, input.destinationIp, packet.ttl, this.now);
    for (const hop of path.hops) this.events.emit('packet:hop', { packet, deviceId: hop.deviceId });

    if (!path.ok || !path.finalDeviceId) {
      return this.dropped(packet, path.hops, sourceDevice, path.errorCode ?? 'EHOSTUNREACH');
    }

    const targetDevice = this.devices.get(path.finalDeviceId)!;
    const inbound = evaluateFirewall(targetDevice.firewall, packet, 'inbound');
    if (!inbound.allow) {
      return this.dropped(packet, path.hops, targetDevice, 'EFWDENY', inbound.rule);
    }

    const latencyMs = round1(path.hops.length * (2 + this.random() * 8));
    sourceDevice.stats.packetsSent++;
    targetDevice.stats.packetsReceived++;
    pushLatency(sourceDevice.stats, latencyMs);
    const result: PacketResult = { packet, delivered: true, hops: path.hops, latencyMs };
    this.emit();
    this.events.emit('packet:delivered', { result });
    return result;
  }

  private dropped(packet: Packet, hops: PacketResult['hops'], blameDevice: DeviceRecord, errorCode: ErrorCode, rule?: FirewallRule): PacketResult {
    if (errorCode === 'EFWDENY') {
      blameDevice.stats.packetsBlocked++;
      this.events.emit('firewall:blocked', { deviceId: blameDevice.id, packet, rule });
    } else {
      blameDevice.stats.packetsDropped++;
    }
    const result: PacketResult = { packet, delivered: false, hops, latencyMs: 0, error: new SystemError(errorCode).message, errorCode };
    this.emit();
    this.events.emit('packet:dropped', { result });
    return result;
  }

  ping(fromDeviceId: string, target: string, count = 3): { resolvedIp: string; results: PacketResult[] } {
    const device = this.requireDevice(fromDeviceId);
    const sourceIface = device.interfaces.find((i) => i.ipAddress && i.status === 'up');
    if (!sourceIface?.ipAddress) throw new SystemError('ENETUNREACH', undefined, 'No active network interface');
    const resolvedIp = isValidIp(target) ? target : this.resolveDns(fromDeviceId, target);
    const results: PacketResult[] = [];
    for (let i = 0; i < count; i++) {
      results.push(this.sendPacket({ sourceIp: sourceIface.ipAddress, destinationIp: resolvedIp, protocol: 'ICMP', ttl: DEFAULT_TTL }));
    }
    return { resolvedIp, results };
  }

  traceroute(fromDeviceId: string, target: string): { resolvedIp: string; ok: boolean; errorCode?: string; hops: TracerouteHop[] } {
    const device = this.requireDevice(fromDeviceId);
    const sourceIface = device.interfaces.find((i) => i.ipAddress && i.status === 'up');
    if (!sourceIface?.ipAddress) throw new SystemError('ENETUNREACH', undefined, 'No active network interface');
    const resolvedIp = isValidIp(target) ? target : this.resolveDns(fromDeviceId, target);
    const path = resolvePath(this.topology(), sourceIface.id, resolvedIp, DEFAULT_TTL, this.now);
    const topo = this.topology();
    const hops: TracerouteHop[] = path.hops.map((h, i) => ({
      index: i + 1,
      hostname: this.devices.get(h.deviceId)?.hostname ?? '?',
      ip: topo.interfaces.get(h.interfaceId)?.ipAddress,
      latencyMs: round1((2 + this.random() * 8) * (i + 1)),
    }));
    return { resolvedIp, ok: path.ok, errorCode: path.errorCode, hops };
  }

  // ───────────────────────────── HTTP ─────────────────────────────

  httpRequest(fromDeviceId: string, host: string, options: { port?: number; path?: string } = {}): HttpResponse {
    const device = this.requireDevice(fromDeviceId);
    const sourceIface = device.interfaces.find((i) => i.ipAddress && i.status === 'up');
    if (!sourceIface?.ipAddress) throw new SystemError('ENETUNREACH', undefined, 'No active network interface');
    const targetIp = isValidIp(host) ? host : this.resolveDns(fromDeviceId, host);
    const port = options.port ?? 80;
    const path = options.path ?? '/';

    this.events.emit('tcp:connect', { fromIp: sourceIface.ipAddress, toIp: targetIp, port });
    const result = this.sendPacket({
      sourceIp: sourceIface.ipAddress,
      destinationIp: targetIp,
      protocol: 'TCP',
      sourcePort: 1024 + Math.floor(this.random() * 60000),
      destinationPort: port,
      ttl: DEFAULT_TTL,
    });
    if (!result.delivered) {
      const code = (result.errorCode as ErrorCode | undefined) ?? 'EHOSTUNREACH';
      throw new SystemError(code, targetIp);
    }

    const targetDeviceId = result.hops[result.hops.length - 1]?.deviceId;
    const targetDevice = targetDeviceId && this.devices.get(targetDeviceId);
    if (!targetDevice) throw new SystemError('EHOSTUNREACH', targetIp);
    const service = findServiceByPort(targetDevice.services, port, 'TCP');
    if (!service || service.status !== 'running') {
      throw new SystemError('ECONNREFUSED', targetIp, `Connection refused: nothing listening on port ${port}`);
    }

    this.events.emit('http:request', { fromIp: sourceIface.ipAddress, toIp: targetIp, path });
    const response = buildHttpResponse(targetDevice.fileSystem, path);
    this.events.emit('http:response', { fromIp: sourceIface.ipAddress, toIp: targetIp, status: response.status });
    return response;
  }

  // ───────────────────────────── misc queries ─────────────────────────────

  getMacTable(switchDeviceId: string): { mac: string; port: string }[] {
    const device = this.requireDevice(switchDeviceId);
    if (device.type !== 'switch') throw new SystemError('EINVAL', switchDeviceId, 'Not a switch');
    const out: { mac: string; port: string }[] = [];
    for (const port of device.interfaces) {
      const conn = this.findConnectionOf(port.id);
      if (!conn) continue;
      const peerIfaceId = conn.interfaceA === port.id ? conn.interfaceB : conn.interfaceA;
      for (const other of this.devices.values()) {
        const peerIface = other.interfaces.find((i) => i.id === peerIfaceId);
        if (peerIface) {
          out.push({ mac: peerIface.macAddress, port: port.name });
          break;
        }
      }
    }
    return out;
  }

  /** Every address reachable on the device's own broadcast domains - a stand-in for a real ARP cache. */
  getArpEntries(deviceId: string): { ip: string; mac: string; iface: string }[] {
    const device = this.requireDevice(deviceId);
    const topo = this.topology();
    const out: { ip: string; mac: string; iface: string }[] = [];
    for (const own of device.interfaces) {
      if (own.status !== 'up') continue;
      for (const ifaceId of discoverSegment(topo, own.id)) {
        if (ifaceId === own.id) continue;
        const iface = topo.interfaces.get(ifaceId);
        if (iface?.ipAddress) out.push({ ip: iface.ipAddress, mac: iface.macAddress, iface: own.name });
      }
    }
    return out;
  }

  // ───────────────────────────── persistence ─────────────────────────────

  snapshot(): NetworkSnapshot {
    return {
      networks: [...this.networks.values()].map((n) => ({ ...n })),
      devices: [...this.devices.values()].map((d) => ({
        ...this.toPublic(d),
        fileSystemSnapshot: !d.isLocal && d.fileSystem ? d.fileSystem.serialize() : undefined,
      })),
      connections: [...this.connections.values()].map((c) => ({ ...c })),
      dns: Object.fromEntries([...this.dnsRegistries.entries()].map(([id, registry]) => [id, registry.list()])),
      localDeviceId: this.localDeviceId,
    };
  }

  private restoreFrom(snapshot: NetworkSnapshot): string {
    for (const network of snapshot.networks) {
      this.networks.set(network.id, { ...network });
      const registry = new DnsRegistry();
      registry.replaceAll(snapshot.dns[network.id] ?? []);
      this.dnsRegistries.set(network.id, registry);
    }
    for (const raw of snapshot.devices) {
      const { fileSystemSnapshot, ...rest } = raw;
      const isLocal = raw.id === snapshot.localDeviceId;
      const fileSystem = isLocal ? this.localFileSystem : fileSystemSnapshot ? new VirtualFileSystem({ snapshot: fileSystemSnapshot, now: this.now }) : undefined;
      const record: DeviceRecord = {
        ...rest,
        interfaces: rest.interfaces.map((i) => ({ ...i })),
        firewall: { enabled: rest.firewall.enabled, rules: rest.firewall.rules.map((r) => ({ ...r })) },
        services: rest.services.map((s) => ({
          ...s,
          // Saved process ids belong to a process manager that no longer exists; a running
          // service gets a fresh backing process, exactly like relaunching it after a reboot.
          processId: isLocal && s.status === 'running' ? this.spawnServiceProcess(s.name) : undefined,
        })),
        stats: { ...rest.stats, latencySamples: [...rest.stats.latencySamples] },
        routingTable: rest.routingTable?.map((r) => ({ ...r })),
        dhcp: rest.dhcp ? { ...rest.dhcp, dnsServers: [...rest.dhcp.dnsServers], leases: [...rest.dhcp.leases] } : undefined,
        fileSystem,
      };
      if (isLocal) ensureNetworkPaths(this.localFileSystem);
      this.devices.set(record.id, record);
    }
    for (const conn of snapshot.connections) this.connections.set(conn.id, { ...conn });
    return snapshot.localDeviceId ?? this.registerLocalDevice('desktop.local').id;
  }

  private toPublic(record: DeviceRecord): NetworkDevice {
    const { fileSystem: _fileSystem, ...rest } = record;
    return {
      ...rest,
      interfaces: record.interfaces.map((i) => ({ ...i, dnsServers: [...i.dnsServers] })),
      firewall: { enabled: record.firewall.enabled, rules: record.firewall.rules.map((r) => ({ ...r })) },
      services: record.services.map((s) => ({ ...s })),
      stats: { ...record.stats, latencySamples: [...record.stats.latencySamples] },
      routingTable: record.routingTable?.map((r) => ({ ...r })),
      dhcp: record.dhcp ? { ...record.dhcp, dnsServers: [...record.dhcp.dnsServers], leases: [...record.dhcp.leases] } : undefined,
    };
  }
}

export interface TracerouteHop {
  index: number;
  hostname: string;
  ip?: string;
  latencyMs: number;
}

function pushLatency(stats: DeviceStats, ms: number): void {
  stats.latencySamples.push(ms);
  if (stats.latencySamples.length > MAX_LATENCY_SAMPLES) stats.latencySamples.shift();
  stats.averageLatencyMs = round1(stats.latencySamples.reduce((a, b) => a + b, 0) / stats.latencySamples.length);
}

function buildHttpResponse(fs: VirtualFileSystem | undefined, path: string): HttpResponse {
  if (!fs) return { status: 503, statusText: 'Service Unavailable', body: '', contentType: 'text/plain' };
  const target = path === '/' || path === '' ? '/var/www/index.html' : `/var/www${path.startsWith('/') ? path : `/${path}`}`;
  try {
    const body = fs.readFile(target);
    const ext = extname(target);
    const contentType = ext === '.css' ? 'text/css' : ext === '.js' ? 'application/javascript' : ext === '.json' ? 'application/json' : 'text/html';
    return { status: 200, statusText: 'OK', body, contentType };
  } catch {
    return { status: 404, statusText: 'Not Found', body: '<h1>404 Not Found</h1>', contentType: 'text/html' };
  }
}

/** Makes sure /etc/hosts and /var/www exist without clobbering content that is already there. */
export function ensureNetworkPaths(fs: VirtualFileSystem): void {
  if (!fs.exists('/etc')) fs.createDirectory('/etc', { recursive: true });
  if (!fs.exists('/etc/hosts')) fs.createFile('/etc/hosts', '127.0.0.1 localhost\n');
  if (!fs.exists('/var/www')) fs.createDirectory('/var/www', { recursive: true });
}
