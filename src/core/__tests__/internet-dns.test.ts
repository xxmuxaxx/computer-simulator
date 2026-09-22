import { describe, expect, it } from 'vitest';
import { createComputer } from './helpers';

describe('DNS zone manager', () => {
  it('projects an A record into the network so the browser stack can resolve it', () => {
    const { internet, network } = createComputer();
    const domain = internet.domains.register('example.com');
    internet.dns.addRecord(domain.id, 'A', '@', '192.168.0.150');
    expect(network.resolveDns(network.localDeviceId, 'example.com')).toBe('192.168.0.150');
  });

  it('resolves a subdomain and a CNAME chain down to the same A record', () => {
    const { internet, network } = createComputer();
    const domain = internet.domains.register('example.com');
    internet.dns.addRecord(domain.id, 'A', '@', '192.168.0.150');
    internet.dns.addRecord(domain.id, 'CNAME', 'www', 'example.com');
    expect(network.resolveDns(network.localDeviceId, 'www.example.com')).toBe('192.168.0.150');
    expect(internet.dns.resolve('www.example.com')).toBe('192.168.0.150');
  });

  it('removes the network projection when the record is deleted', () => {
    const { internet, network } = createComputer();
    const domain = internet.domains.register('example.com');
    const record = internet.dns.addRecord(domain.id, 'A', '@', '192.168.0.150');
    internet.dns.removeRecord(domain.id, record.id);
    expect(() => network.resolveDns(network.localDeviceId, 'example.com')).toThrow();
  });

  it('stops resolving once the owning domain expires', () => {
    let now = 1_000_000;
    const { internet, network } = createComputer({ now: () => now });
    const domain = internet.domains.register('example.com', undefined, 1000);
    internet.dns.addRecord(domain.id, 'A', '@', '192.168.0.150');
    expect(network.resolveDns(network.localDeviceId, 'example.com')).toBe('192.168.0.150');
    now += 2000;
    internet.domains.check('example.com'); // triggers the expiry sweep
    expect(() => network.resolveDns(network.localDeviceId, 'example.com')).toThrow();
  });

  it('rejects an A record with an invalid IP address', () => {
    const { internet } = createComputer();
    const domain = internet.domains.register('example.com');
    expect(() => internet.dns.addRecord(domain.id, 'A', '@', 'not-an-ip')).toThrow();
  });

  it('leaves AAAA/MX/TXT/NS records stored but non-resolving', () => {
    const { internet, network } = createComputer();
    const domain = internet.domains.register('example.com');
    internet.dns.addRecord(domain.id, 'TXT', '@', 'v=spf1 -all');
    internet.dns.addRecord(domain.id, 'MX', '@', 'mail.example.com', { priority: 10 });
    expect(internet.dns.list(domain.id)).toHaveLength(2);
    expect(() => network.resolveDns(network.localDeviceId, 'example.com')).toThrow();
  });
});
