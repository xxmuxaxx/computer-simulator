import { describe, expect, it } from 'vitest';
import { createComputer } from './helpers';

function bindSite(computer: ReturnType<typeof createComputer>, domainName: string, ip: string) {
  const { internet, network } = computer;
  const server = network.findDeviceByHostname('server.local')!;
  const domain = internet.domains.register(domainName);
  internet.dns.addRecord(domain.id, 'A', '@', ip);
  const website = internet.hosting.createWebsite({ domainId: domain.id, serverId: server.id });
  return { domain, website, server };
}

describe('Virtual APIs', () => {
  it('serves a GET endpoint with a custom status and JSON body', () => {
    const computer = createComputer();
    const { internet, network } = computer;
    const { website } = bindSite(computer, 'example.com', '192.168.0.101');
    internet.hosting.createApiEndpoint(website.id, {
      method: 'GET',
      path: '/api/users',
      status: 200,
      responseBody: JSON.stringify([{ id: 1, name: 'Alice' }]),
      headers: {},
    });
    const response = network.httpRequest(network.localDeviceId, 'example.com', { path: '/api/users' });
    expect(response.status).toBe(200);
    expect(response.contentType).toBe('application/json');
    expect(JSON.parse(response.body)).toEqual([{ id: 1, name: 'Alice' }]);
  });

  it('serves a POST endpoint and 405s an undefined method on the same path', () => {
    const computer = createComputer();
    const { internet, network } = computer;
    const { website } = bindSite(computer, 'example.com', '192.168.0.101');
    internet.hosting.createApiEndpoint(website.id, { method: 'POST', path: '/api/users', status: 201, responseBody: '{"ok":true}', headers: {} });

    const post = network.httpRequest(network.localDeviceId, 'example.com', { path: '/api/users', method: 'POST', body: '{}' });
    expect(post.status).toBe(201);

    const del = network.httpRequest(network.localDeviceId, 'example.com', { path: '/api/users', method: 'DELETE' });
    expect(del.status).toBe(405);
  });

  it('matches the endpoint path regardless of a GET query string', () => {
    const computer = createComputer();
    const { internet, network } = computer;
    const { website } = bindSite(computer, 'example.com', '192.168.0.101');
    internet.hosting.createApiEndpoint(website.id, { method: 'GET', path: '/api/status', status: 200, responseBody: '{"status":"online"}', headers: {} });
    const response = network.httpRequest(network.localDeviceId, 'example.com', { path: '/api/status?verbose=1' });
    expect(response.status).toBe(200);
    expect(response.body).toContain('online');
  });

  it('refuses to register the same method+path twice', () => {
    const computer = createComputer();
    const { internet } = computer;
    const { website } = bindSite(computer, 'example.com', '192.168.0.101');
    internet.hosting.createApiEndpoint(website.id, { method: 'GET', path: '/api/status', status: 200, responseBody: '{}', headers: {} });
    expect(() => internet.hosting.createApiEndpoint(website.id, { method: 'GET', path: '/api/status', status: 200, responseBody: '{}', headers: {} })).toThrow();
  });

  it('removing an endpoint falls back to static file resolution (or 404/405)', () => {
    const computer = createComputer();
    const { internet, network } = computer;
    const { website } = bindSite(computer, 'example.com', '192.168.0.101');
    const endpoint = internet.hosting.createApiEndpoint(website.id, { method: 'GET', path: '/api/status', status: 200, responseBody: '{}', headers: {} });
    internet.hosting.deleteApiEndpoint(endpoint.id);
    const response = network.httpRequest(network.localDeviceId, 'example.com', { path: '/api/status' });
    expect(response.status).toBe(404);
  });
});
