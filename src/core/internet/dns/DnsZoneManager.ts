import { SystemError } from '../../errors';
import type { NetworkManager } from '../../network/NetworkManager';
import { isValidIp } from '../../network/ip';
import { uid } from '../../../utils/id';
import type { DomainRegistry } from '../domains/DomainRegistry';
import type { InternetEventBus } from '../events';
import type { Domain, DnsRecordType, InternetDnsRecord } from '../types';

export interface DnsZoneManagerOptions {
  network: NetworkManager;
  domains: DomainRegistry;
  events: InternetEventBus;
}

const MAX_CNAME_DEPTH = 8;

function effectiveHostname(domain: Domain, name: string): string {
  return name === '@' || name === '' ? domain.name : `${name}.${domain.name}`;
}

/**
 * Per-domain A/AAAA/CNAME/MX/TXT/NS records. The only record types that actually resolve
 * anything are A and CNAME (chained down to an A) - everything else is stored and shown in the
 * UI/WHOIS but architectural only, per spec. Resolution itself always happens through
 * NetworkManager.resolveDns: this class only keeps that manager's DNS registries in sync with
 * the effective A-mapping computed from the zone data, via its existing public API.
 */
export class DnsZoneManager {
  private records = new Map<string, InternetDnsRecord>();
  private synced = new Map<string, { networkId: string; ip: string }>();
  private readonly network: NetworkManager;
  private readonly domains: DomainRegistry;
  private readonly events: InternetEventBus;

  constructor(options: DnsZoneManagerOptions) {
    this.network = options.network;
    this.domains = options.domains;
    this.events = options.events;
    this.events.on('domain:expired', () => this.resyncAll());
    this.events.on('domain:renewed', () => this.resyncAll());
    this.events.on('domain:released', ({ domainId }) => {
      for (const r of [...this.records.values()]) if (r.domainId === domainId) this.records.delete(r.id);
      this.resyncAll();
    });
  }

  addRecord(domainId: string, type: DnsRecordType, name: string, value: string, extra: { ttl?: number; priority?: number } = {}): InternetDnsRecord {
    this.domains.requireDomain(domainId);
    if (type === 'A' && !isValidIp(value)) throw new SystemError('EINVAL', value, 'Invalid IPv4 address for an A record');
    const record: InternetDnsRecord = { id: uid('dns'), domainId, type, name: name.trim().toLowerCase() || '@', value: value.trim(), ...extra };
    this.records.set(record.id, record);
    this.events.emit('dns:record-added', { record: { ...record } });
    this.resyncAll();
    return { ...record };
  }

  removeRecord(domainId: string, recordId: string): void {
    const record = this.records.get(recordId);
    if (!record || record.domainId !== domainId) throw new SystemError('ENOENT', recordId, 'No such DNS record');
    this.records.delete(recordId);
    this.events.emit('dns:record-removed', { domainId, recordId });
    this.resyncAll();
  }

  list(domainId: string): InternetDnsRecord[] {
    return [...this.records.values()].filter((r) => r.domainId === domainId).map((r) => ({ ...r }));
  }

  listAll(): InternetDnsRecord[] {
    return [...this.records.values()].map((r) => ({ ...r }));
  }

  /** Resolves a hostname through the zone data only (A/CNAME chain), independent of NetworkManager. */
  resolve(hostname: string): string | undefined {
    return this.resolveChain(hostname.trim().toLowerCase(), 0, new Set());
  }

  private resolveChain(hostname: string, depth: number, visited: Set<string>): string | undefined {
    if (depth >= MAX_CNAME_DEPTH || visited.has(hostname)) return undefined;
    visited.add(hostname);
    for (const domain of this.domains.list()) {
      if (domain.status !== 'active') continue;
      if (hostname !== domain.name && !hostname.endsWith(`.${domain.name}`)) continue;
      const name = hostname === domain.name ? '@' : hostname.slice(0, -(domain.name.length + 1));
      for (const record of this.records.values()) {
        if (record.domainId !== domain.id || record.name !== name) continue;
        if (record.type === 'A') return record.value;
        if (record.type === 'CNAME') return this.resolveChain(record.value.trim().toLowerCase(), depth + 1, visited);
      }
    }
    return undefined;
  }

  /** Recomputes every domain's effective hostname->IP mapping and reconciles it into NetworkManager. */
  private resyncAll(): void {
    const desired = new Map<string, string>();
    for (const domain of this.domains.list()) {
      if (domain.status !== 'active') continue;
      const names = new Set(this.filter((r) => r.domainId === domain.id).map((r) => r.name));
      for (const name of names) {
        const host = effectiveHostname(domain, name);
        const ip = this.resolveChain(host, 0, new Set());
        if (ip) desired.set(host, ip);
      }
    }

    for (const [hostname, prev] of this.synced) {
      const nextIp = desired.get(hostname);
      if (nextIp === prev.ip) continue;
      try {
        this.network.removeDnsRecord(prev.networkId, hostname);
      } catch {
        // Network may have been removed already; nothing to clean up.
      }
      this.synced.delete(hostname);
    }
    for (const [hostname, ip] of desired) {
      if (this.synced.has(hostname)) continue;
      const network = this.network.findNetworkForIp(ip);
      if (!network) continue;
      this.network.setDnsRecord(network.id, hostname, ip);
      this.synced.set(hostname, { networkId: network.id, ip });
    }
  }

  private filter(pred: (r: InternetDnsRecord) => boolean): InternetDnsRecord[] {
    return [...this.records.values()].filter(pred);
  }

  serialize(): InternetDnsRecord[] {
    return this.listAll();
  }

  restore(records: readonly InternetDnsRecord[]): void {
    this.records = new Map(records.map((r) => [r.id, { ...r }]));
    this.resyncAll();
  }
}
