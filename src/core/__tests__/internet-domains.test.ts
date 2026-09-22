import { describe, expect, it } from 'vitest';
import { createComputer } from './helpers';

describe('Domain registry', () => {
  it('registers an available domain', () => {
    const { internet } = createComputer();
    expect(internet.domains.check('example.com')).toBe('AVAILABLE');
    const domain = internet.domains.register('example.com', 'user');
    expect(domain.status).toBe('active');
    expect(domain.name).toBe('example.com');
    expect(internet.domains.check('example.com')).toBe('TAKEN');
  });

  it('normalizes case and rejects invalid names', () => {
    const { internet } = createComputer();
    internet.domains.register('Example.COM');
    expect(internet.domains.check('example.com')).toBe('TAKEN');
    expect(internet.domains.check('not a domain')).toBe('INVALID');
    expect(() => internet.domains.register('nope')).toThrow(/domain/i);
  });

  it('refuses to register a domain twice', () => {
    const { internet } = createComputer();
    internet.domains.register('example.com');
    expect(() => internet.domains.register('example.com')).toThrow();
  });

  it('expires a domain past its expiry date and frees it for re-registration', () => {
    let now = 1_000_000;
    const { internet } = createComputer({ now: () => now });
    internet.domains.register('example.com', undefined, 1000);
    now += 2000;
    expect(internet.domains.check('example.com')).toBe('AVAILABLE');
    expect(internet.domains.whois('example.com').status).toBe('expired');
    const reregistered = internet.domains.register('example.com');
    expect(reregistered.status).toBe('active');
  });

  it('renews a domain and releases it back to available', () => {
    const { internet } = createComputer();
    internet.domains.register('example.com');
    const renewed = internet.domains.renew('example.com');
    expect(renewed.status).toBe('active');
    internet.domains.release('example.com');
    expect(internet.domains.check('example.com')).toBe('AVAILABLE');
    expect(() => internet.domains.whois('example.com')).toThrow();
  });

  it('reports whois details including default nameservers', () => {
    const { internet } = createComputer();
    internet.domains.register('example.com', 'alice');
    const info = internet.domains.whois('example.com');
    expect(info.ownerId).toBe('alice');
    expect(info.nameservers.map((n) => n.hostname)).toEqual(['ns1.virtual-dns', 'ns2.virtual-dns']);
  });
});
