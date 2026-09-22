import { SystemError } from '../../errors';
import { uid } from '../../../utils/id';
import type { InternetEventBus } from '../events';
import type { Domain, DomainAvailability, NameServer } from '../types';

export interface DomainRegistryOptions {
  now: () => number;
  events: InternetEventBus;
}

const DEFAULT_TTL_MS = 365 * 24 * 60 * 60 * 1000;
const NAME_RE = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/;

function defaultNameServers(): NameServer[] {
  return [
    { hostname: 'ns1.virtual-dns', ipAddress: '10.255.255.1' },
    { hostname: 'ns2.virtual-dns', ipAddress: '10.255.255.2' },
  ];
}

export function normalizeDomainName(name: string): string {
  return name.trim().toLowerCase();
}

export function isValidDomainName(name: string): boolean {
  return NAME_RE.test(normalizeDomainName(name));
}

/**
 * Virtual domain registry: registration, availability, renewal, release and WHOIS. Zero
 * dependency on the network layer - DnsZoneManager is what projects a domain's records into
 * NetworkManager once one exists.
 */
export class DomainRegistry {
  private domains = new Map<string, Domain>();
  private readonly now: () => number;
  private readonly events: InternetEventBus;

  constructor(options: DomainRegistryOptions) {
    this.now = options.now;
    this.events = options.events;
  }

  private sweepExpired(): void {
    const now = this.now();
    for (const domain of this.domains.values()) {
      if (domain.status === 'active' && domain.expiresAt !== undefined && domain.expiresAt <= now) {
        domain.status = 'expired';
        this.events.emit('domain:expired', { domain: { ...domain } });
      }
    }
  }

  private findByName(name: string): Domain | undefined {
    const key = normalizeDomainName(name);
    return [...this.domains.values()].find((d) => d.name === key);
  }

  check(name: string): DomainAvailability {
    if (!isValidDomainName(name)) return 'INVALID';
    this.sweepExpired();
    const existing = this.findByName(name);
    return existing && existing.status !== 'expired' ? 'TAKEN' : 'AVAILABLE';
  }

  register(name: string, ownerId?: string, ttlMs = DEFAULT_TTL_MS): Domain {
    const normalized = normalizeDomainName(name);
    if (!isValidDomainName(normalized)) throw new SystemError('EDOMAININVALID', normalized);
    this.sweepExpired();
    const existing = this.findByName(normalized);
    if (existing && existing.status !== 'expired') throw new SystemError('EDOMAINTAKEN', normalized);

    const now = this.now();
    const domain: Domain = existing
      ? { ...existing, ownerId, status: 'active', createdAt: now, expiresAt: now + ttlMs }
      : { id: uid('dom'), name: normalized, ownerId, status: 'active', createdAt: now, expiresAt: now + ttlMs, nameservers: defaultNameServers() };
    this.domains.set(domain.id, domain);
    this.events.emit('domain:registered', { domain: { ...domain } });
    return { ...domain };
  }

  renew(name: string, ttlMs = DEFAULT_TTL_MS): Domain {
    const domain = this.requireByName(name);
    const now = this.now();
    domain.status = 'active';
    domain.expiresAt = Math.max(domain.expiresAt ?? now, now) + ttlMs;
    this.events.emit('domain:renewed', { domain: { ...domain } });
    return { ...domain };
  }

  release(name: string): void {
    const domain = this.requireByName(name);
    this.domains.delete(domain.id);
    this.events.emit('domain:released', { domainId: domain.id });
  }

  reserve(name: string): Domain {
    const normalized = normalizeDomainName(name);
    if (!isValidDomainName(normalized)) throw new SystemError('EDOMAININVALID', normalized);
    const existing = this.findByName(normalized);
    if (existing && existing.status !== 'expired') throw new SystemError('EDOMAINTAKEN', normalized);
    const domain: Domain = { id: uid('dom'), name: normalized, status: 'reserved', createdAt: this.now(), nameservers: defaultNameServers() };
    this.domains.set(domain.id, domain);
    return { ...domain };
  }

  whois(name: string): Domain {
    return { ...this.requireByName(name) };
  }

  get(domainId: string): Domain | undefined {
    const domain = this.domains.get(domainId);
    return domain && { ...domain };
  }

  requireDomain(domainId: string): Domain {
    const domain = this.domains.get(domainId);
    if (!domain) throw new SystemError('ENODOMAIN', domainId);
    return { ...domain };
  }

  private requireByName(name: string): Domain {
    this.sweepExpired();
    const domain = this.findByName(name);
    if (!domain) throw new SystemError('ENODOMAIN', normalizeDomainName(name));
    return domain;
  }

  list(ownerId?: string): Domain[] {
    this.sweepExpired();
    const all = [...this.domains.values()];
    return (ownerId ? all.filter((d) => d.ownerId === ownerId) : all).map((d) => ({ ...d }));
  }

  serialize(): Domain[] {
    return this.list();
  }

  restore(domains: readonly Domain[]): void {
    this.domains = new Map(domains.map((d) => [d.id, { ...d, nameservers: d.nameservers.map((n) => ({ ...n })) }]));
  }
}
