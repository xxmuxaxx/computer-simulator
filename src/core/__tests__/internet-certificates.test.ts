import { describe, expect, it } from 'vitest';
import { createComputer } from './helpers';

describe('Certificate Authority', () => {
  it('is invalid for a domain with no issued certificate', () => {
    const { internet } = createComputer();
    expect(internet.certificates.getStatus('example.com')).toBe('invalid');
  });

  it('is valid right after issuing', () => {
    const { internet } = createComputer();
    internet.certificates.issue('example.com');
    expect(internet.certificates.getStatus('example.com')).toBe('valid');
  });

  it('expires once past its validity window', () => {
    let now = 1_000_000;
    const { internet } = createComputer({ now: () => now });
    internet.certificates.issue('example.com', 1000);
    expect(internet.certificates.getStatus('example.com')).toBe('valid');
    now += 2000;
    expect(internet.certificates.getStatus('example.com')).toBe('expired');
  });

  it('is invalid for a different (mismatched) domain', () => {
    const { internet } = createComputer();
    internet.certificates.issue('example.com');
    expect(internet.certificates.getStatus('www.example.com')).toBe('invalid');
  });

  it('auto-issues a certificate when a website is created with https enabled', () => {
    const { internet, network } = createComputer();
    const server = network.findDeviceByHostname('server.local')!;
    const domain = internet.domains.register('secure.local');
    internet.dns.addRecord(domain.id, 'A', '@', '192.168.0.101');
    internet.hosting.createWebsite({ domainId: domain.id, serverId: server.id, https: true });
    expect(internet.certificates.getStatus('secure.local')).toBe('valid');
  });

  it('actually starts the https service so an https request succeeds end-to-end, not just the cert check', () => {
    const { internet, network } = createComputer();
    const server = network.findDeviceByHostname('server.local')!;
    const domain = internet.domains.register('secure.local');
    internet.dns.addRecord(domain.id, 'A', '@', '192.168.0.101');
    internet.hosting.createWebsite({ domainId: domain.id, serverId: server.id, https: true });
    const response = network.httpRequest(network.localDeviceId, 'secure.local', { port: 443 });
    expect(response.status).toBe(200);
  });

  it('revokes a certificate when https is turned off', () => {
    const { internet, network } = createComputer();
    const server = network.findDeviceByHostname('server.local')!;
    const domain = internet.domains.register('secure.local');
    internet.dns.addRecord(domain.id, 'A', '@', '192.168.0.101');
    const website = internet.hosting.createWebsite({ domainId: domain.id, serverId: server.id, https: true });
    internet.hosting.setHttps(website.id, false);
    expect(internet.certificates.getStatus('secure.local')).toBe('invalid');
  });
});
