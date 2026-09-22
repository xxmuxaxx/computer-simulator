import { describe, expect, it } from 'vitest';
import { createComputer } from './helpers';

function bindSite(computer: ReturnType<typeof createComputer>, domainName: string, ip: string, serverId?: string) {
  const { internet, network } = computer;
  const server = serverId ? network.getDevice(serverId)! : network.findDeviceByHostname('server.local')!;
  const domain = internet.domains.register(domainName);
  internet.dns.addRecord(domain.id, 'A', '@', ip);
  const website = internet.hosting.createWebsite({ domainId: domain.id, serverId: server.id, seedContent: { indexHtml: `<h1>${domainName}</h1>` } });
  return { domain, website, server };
}

describe('Hosting', () => {
  it('serves a newly created website by its domain name through real DNS + HTTP', () => {
    const computer = createComputer();
    const { network } = computer;
    bindSite(computer, 'example.com', '192.168.0.101');
    const response = network.httpRequest(network.localDeviceId, 'example.com');
    expect(response.status).toBe(200);
    expect(response.body).toContain('example.com');
  });

  it('routes multiple sites on the same server by Host header', () => {
    const computer = createComputer();
    const { network } = computer;
    bindSite(computer, 'example.com', '192.168.0.101');
    bindSite(computer, 'blog.local', '192.168.0.101');
    const a = network.httpRequest(network.localDeviceId, 'example.com');
    const b = network.httpRequest(network.localDeviceId, 'blog.local');
    expect(a.body).toContain('example.com');
    expect(b.body).toContain('blog.local');
  });

  it('still serves the legacy flat /var/www site when no website is bound to a host', () => {
    const { network } = createComputer();
    const response = network.httpRequest(network.localDeviceId, 'server.local');
    expect(response.status).toBe(200);
    expect(response.body).toContain('Welcome to Computer Simulator Network');
  });

  it('goes unavailable when a website is disabled and comes back when re-enabled', () => {
    const computer = createComputer();
    const { internet, network } = computer;
    const { website } = bindSite(computer, 'example.com', '192.168.0.101');
    internet.hosting.setEnabled(website.id, false);
    expect(network.httpRequest(network.localDeviceId, 'example.com').status).toBe(503);
    internet.hosting.setEnabled(website.id, true);
    expect(network.httpRequest(network.localDeviceId, 'example.com').status).toBe(200);
  });

  it('rejects a private site from outside its allowed networks', () => {
    const computer = createComputer();
    const { internet, network } = computer;
    const { website } = bindSite(computer, 'intranet.local', '192.168.0.101');
    internet.hosting.setVisibility(website.id, 'private', ['10.0.0.0/24']);
    expect(network.httpRequest(network.localDeviceId, 'intranet.local').status).toBe(403);
    internet.hosting.setVisibility(website.id, 'private', ['192.168.0.0/24']);
    expect(network.httpRequest(network.localDeviceId, 'intranet.local').status).toBe(200);
  });

  it('writes access and error log lines to the server file system', () => {
    const computer = createComputer();
    const { network } = computer;
    const { server } = bindSite(computer, 'example.com', '192.168.0.101');
    network.httpRequest(network.localDeviceId, 'example.com');
    network.httpRequest(network.localDeviceId, 'example.com', { path: '/missing.html' });
    const fs = network.getDeviceFileSystem(server.id)!;
    const access = fs.readFile('/var/log/http/access.log');
    expect(access).toMatch(/GET \/ 200/);
    expect(access).toMatch(/GET \/missing\.html 404/);
    expect(fs.readFile('/var/log/http/error.log')).toMatch(/404 \/missing\.html/);
  });

  it('tracks per-website request/error stats', () => {
    const computer = createComputer();
    const { internet, network } = computer;
    const { website } = bindSite(computer, 'example.com', '192.168.0.101');
    network.httpRequest(network.localDeviceId, 'example.com');
    network.httpRequest(network.localDeviceId, 'example.com', { path: '/missing.html' });
    const stats = internet.hosting.statsFor(website.id);
    expect(stats.requests).toBe(2);
    expect(stats.errors).toBe(1);
  });

  it('refuses to bind a second website to the same domain', () => {
    const computer = createComputer();
    const { internet, network } = computer;
    const { domain } = bindSite(computer, 'example.com', '192.168.0.101');
    const server = network.findDeviceByHostname('server.local')!;
    expect(() => internet.hosting.createWebsite({ domainId: domain.id, serverId: server.id })).toThrow();
  });

  it('issues a session cookie on the first visit and skips it once one is already sent', () => {
    const computer = createComputer();
    const { network } = computer;
    bindSite(computer, 'example.com', '192.168.0.101');
    const first = network.httpRequest(network.localDeviceId, 'example.com');
    expect(first.headers?.['Set-Cookie']).toMatch(/^sessionId=/);
    const second = network.httpRequest(network.localDeviceId, 'example.com', { headers: { Cookie: first.headers!['Set-Cookie']!.split(';')[0]! } });
    expect(second.headers?.['Set-Cookie']).toBeUndefined();
  });

  it('rejects non-GET requests against a static site with 405', () => {
    const computer = createComputer();
    const { network } = computer;
    bindSite(computer, 'example.com', '192.168.0.101');
    const response = network.httpRequest(network.localDeviceId, 'example.com', { method: 'POST', body: 'x=1' });
    expect(response.status).toBe(405);
  });
});
