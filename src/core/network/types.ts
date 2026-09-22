/** Shared, UI-independent types for the virtual network. */
import type { VirtualFileSystem } from '../filesystem/VirtualFileSystem';

export type DeviceType = 'computer' | 'server' | 'router' | 'switch';
export type InterfaceStatus = 'up' | 'down';

export interface NetworkInterface {
  id: string;
  deviceId: string;
  /** e.g. "eth0". */
  name: string;
  macAddress: string;
  ipAddress?: string;
  subnetMask?: string;
  gateway?: string;
  dnsServers: string[];
  status: InterfaceStatus;
  /** Assigned by DHCP rather than typed in by hand. */
  dhcp?: boolean;
}

export type Protocol = 'TCP' | 'UDP' | 'ICMP' | 'DNS' | 'HTTP' | 'ANY';

export interface Packet {
  id: string;
  sourceIp: string;
  destinationIp: string;
  protocol: Protocol;
  sourcePort?: number;
  destinationPort?: number;
  payload?: unknown;
  ttl: number;
  createdAt: number;
}

export type ServiceStatus = 'running' | 'stopped';

export interface NetworkService {
  id: string;
  name: string;
  protocol: 'TCP' | 'UDP';
  port: number;
  status: ServiceStatus;
  /** Set on the local device, where a running service is backed by a real process. */
  processId?: number;
}

export type FirewallDirection = 'inbound' | 'outbound';
export type FirewallAction = 'allow' | 'deny';

export interface FirewallRule {
  id: string;
  direction: FirewallDirection;
  protocol: 'TCP' | 'UDP' | 'ICMP' | 'ANY';
  port?: number;
  sourceIp?: string;
  action: FirewallAction;
}

export interface FirewallState {
  enabled: boolean;
  rules: FirewallRule[];
}

export interface DeviceStats {
  packetsSent: number;
  packetsReceived: number;
  packetsDropped: number;
  packetsBlocked: number;
  /** Rolling average of successful round-trip latencies, in ms. */
  averageLatencyMs: number;
  latencySamples: number[];
}

export interface NetworkDevice {
  id: string;
  hostname: string;
  type: DeviceType;
  interfaces: NetworkInterface[];
  firewall: FirewallState;
  services: NetworkService[];
  stats: DeviceStats;
  /** The network this device's file system (/etc/hosts, /var/www) lives in, if any. */
  hasFileSystem: boolean;
  /** True for the device that wraps the user's own VirtualComputer. */
  isLocal: boolean;
  /** Routers only: forwarding table. */
  routingTable?: RoutingEntry[];
  /** Routers only: DHCP server configuration. */
  dhcp?: DhcpConfig;
}

export interface RoutingEntry {
  id: string;
  /** CIDR, e.g. "192.168.0.0/24", or "0.0.0.0/0" for the default route. */
  destination: string;
  /** "connected" for directly attached networks, otherwise a next-hop IP. */
  gateway: 'connected' | string;
  interfaceId: string;
}

export interface DhcpLease {
  macAddress: string;
  ipAddress: string;
  hostname?: string;
  leasedAt: number;
}

export interface DhcpConfig {
  enabled: boolean;
  interfaceId: string;
  rangeStart: string;
  rangeEnd: string;
  gateway: string;
  subnetMask: string;
  dnsServers: string[];
  leases: DhcpLease[];
}

export interface DnsRecord {
  hostname: string;
  ipAddress: string;
}

export interface Network {
  id: string;
  name: string;
  /** CIDR block this network was allocated from, e.g. "192.168.0.0/24". */
  cidr: string;
}

/** A physical link between two interfaces (point-to-point cable). */
export interface Connection {
  id: string;
  interfaceA: string;
  interfaceB: string;
  /** A severed connection is kept (for "Simulate Network Failure") rather than removed. */
  up: boolean;
}

export interface HopRecord {
  deviceId: string;
  interfaceId: string;
  at: number;
}

export interface PacketResult {
  packet: Packet;
  delivered: boolean;
  hops: HopRecord[];
  latencyMs: number;
  error?: string;
  /** SystemError code describing why delivery failed. */
  errorCode?: string;
}

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

export interface HttpResponse {
  status: number;
  statusText: string;
  body: string;
  contentType: string;
  headers?: Record<string, string>;
}

/** What a Website content resolver (see core/internet/hosting) receives for each request. */
export interface HttpRequestContext {
  method: HttpMethod;
  path: string;
  /** The Host the client asked for - a hostname, not necessarily the device's own name. */
  host: string;
  headers: Record<string, string>;
  body?: string;
  sourceIp: string;
}

/** Pluggable content resolver: NetworkManager only handles transport, this decides what a
 * listening HTTP service actually serves. Defaults to the single-file-per-device behavior;
 * core/internet's HostingRegistry replaces it with real Host-header multi-site routing. */
export type HttpHandler = (device: DeviceRecord, request: HttpRequestContext) => HttpResponse;

export type NetworkEventMap = {
  'device:added': { device: NetworkDevice };
  'device:removed': { deviceId: string };
  'device:updated': { device: NetworkDevice };
  'connection:added': { connection: Connection };
  'connection:removed': { connectionId: string };
  'connection:updated': { connection: Connection };
  'packet:sent': { packet: Packet; fromDeviceId: string };
  'packet:hop': { packet: Packet; deviceId: string };
  'packet:delivered': { result: PacketResult };
  'packet:dropped': { result: PacketResult };
  'service:started': { deviceId: string; service: NetworkService };
  'service:stopped': { deviceId: string; service: NetworkService };
  'dns:query': { hostname: string; resolved?: string; deviceId: string };
  'dhcp:lease': { deviceId: string; lease: DhcpLease };
  'firewall:blocked': { deviceId: string; packet: Packet; rule?: FirewallRule };
  'tcp:connect': { fromIp: string; toIp: string; port: number };
  'http:request': { fromIp: string; toIp: string; path: string };
  'http:response': { fromIp: string; toIp: string; status: number };
};

export type NetworkEventName = keyof NetworkEventMap;

/** Internal representation held by NetworkManager - a NetworkDevice plus its private file system. */
export interface DeviceRecord extends NetworkDevice {
  /** computer/server devices get one; the local device shares the real VirtualComputer's. */
  fileSystem?: VirtualFileSystem;
}
