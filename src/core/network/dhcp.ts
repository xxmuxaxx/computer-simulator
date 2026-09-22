import { SystemError } from '../errors';
import { compareIp, intToIp, ipToInt } from './ip';
import type { DhcpConfig, DhcpLease } from './types';

/**
 * Allocates (or renews) a lease for `macAddress`. Pure over the config object - the caller
 * (NetworkManager) owns mutating device state and emitting events.
 */
export function allocateLease(config: DhcpConfig, macAddress: string, hostname: string | undefined, now: () => number): DhcpLease {
  const existing = config.leases.find((l) => l.macAddress === macAddress);
  if (existing) return { ...existing, leasedAt: now() };

  const used = new Set(config.leases.map((l) => l.ipAddress));
  const from = ipToInt(config.rangeStart);
  const to = ipToInt(config.rangeEnd);
  for (let n = from; n <= to; n++) {
    const candidate = intToIp(n);
    if (!used.has(candidate)) {
      const lease: DhcpLease = { macAddress, ipAddress: candidate, hostname, leasedAt: now() };
      config.leases.push(lease);
      return lease;
    }
  }
  throw new SystemError('EDHCPFULL', undefined, `DHCP pool exhausted (${config.rangeStart} - ${config.rangeEnd})`);
}

export function releaseLease(config: DhcpConfig, macAddress: string): void {
  config.leases = config.leases.filter((l) => l.macAddress !== macAddress);
}

export function poolSize(config: DhcpConfig): number {
  return ipToInt(config.rangeEnd) - ipToInt(config.rangeStart) + 1;
}

export function isInRange(config: DhcpConfig, ip: string): boolean {
  return compareIp(ip, config.rangeStart) >= 0 && compareIp(ip, config.rangeEnd) <= 0;
}
