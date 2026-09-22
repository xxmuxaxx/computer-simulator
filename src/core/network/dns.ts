import { SystemError } from '../errors';
import type { VirtualFileSystem } from '../filesystem/VirtualFileSystem';
import type { DnsRecord } from './types';

export const HOSTS_PATH = '/etc/hosts';

/** Per-network authoritative DNS records, keyed by hostname (case-insensitive). */
export class DnsRegistry {
  private records = new Map<string, string>();

  addRecord(hostname: string, ipAddress: string): DnsRecord {
    const key = hostname.toLowerCase();
    if (this.records.has(key)) throw new SystemError('EDUPHOST', hostname, `DNS record already exists: ${hostname}`);
    this.records.set(key, ipAddress);
    return { hostname, ipAddress };
  }

  setRecord(hostname: string, ipAddress: string): DnsRecord {
    this.records.set(hostname.toLowerCase(), ipAddress);
    return { hostname, ipAddress };
  }

  removeRecord(hostname: string): void {
    this.records.delete(hostname.toLowerCase());
  }

  lookup(hostname: string): string | undefined {
    return this.records.get(hostname.toLowerCase());
  }

  reverseLookup(ipAddress: string): string | undefined {
    for (const [hostname, ip] of this.records) if (ip === ipAddress) return hostname;
    return undefined;
  }

  list(): DnsRecord[] {
    return [...this.records.entries()].map(([hostname, ipAddress]) => ({ hostname, ipAddress }));
  }

  replaceAll(entries: readonly DnsRecord[]): void {
    this.records = new Map(entries.map((e) => [e.hostname.toLowerCase(), e.ipAddress]));
  }
}

/** Parses `/etc/hosts`-style content: "ip hostname [alias...]", ignoring comments/blank lines. */
export function parseHostsFile(content: string): DnsRecord[] {
  const out: DnsRecord[] = [];
  for (const line of content.split('\n')) {
    const trimmed = line.split('#')[0]!.trim();
    if (!trimmed) continue;
    const [ip, ...names] = trimmed.split(/\s+/);
    for (const name of names) if (ip) out.push({ hostname: name!, ipAddress: ip });
  }
  return out;
}

/** Resolves a hostname using a device's own /etc/hosts first, per real OS behaviour. */
export function lookupHosts(fs: VirtualFileSystem | undefined, hostname: string): string | undefined {
  if (!fs || !fs.exists(HOSTS_PATH)) return undefined;
  try {
    const records = parseHostsFile(fs.readFile(HOSTS_PATH));
    return records.find((r) => r.hostname.toLowerCase() === hostname.toLowerCase())?.ipAddress;
  } catch {
    return undefined;
  }
}
