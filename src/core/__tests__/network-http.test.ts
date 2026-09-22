import { describe, expect, it } from 'vitest';
import { createComputer } from './helpers';

describe('HTTP', () => {
  it('serves the seeded site over hostname resolution', () => {
    const { network } = createComputer();
    const response = network.httpRequest(network.localDeviceId, 'server.local');
    expect(response.status).toBe(200);
    expect(response.body).toContain('Welcome to Computer Simulator Network');
  });

  it('serves the site by IP too, and returns 404 for a missing page', () => {
    const { network } = createComputer();
    const ok = network.httpRequest(network.localDeviceId, '192.168.0.101');
    expect(ok.status).toBe(200);
    const missing = network.httpRequest(network.localDeviceId, '192.168.0.101', { path: '/nope.html' });
    expect(missing.status).toBe(404);
  });

  it('refuses the connection once the HTTP service is stopped', () => {
    const { network } = createComputer();
    const server = network.findDeviceByHostname('server.local')!;
    const http = network.listServices(server.id).find((s) => s.name === 'HTTP')!;
    network.stopService(server.id, http.id);
    expect(() => network.httpRequest(network.localDeviceId, 'server.local')).toThrow(/refused/);
  });

  it('reports the server unavailable when the network is unreachable', () => {
    const { network } = createComputer();
    const server = network.findDeviceByHostname('server.local')!;
    network.disconnectDevices(network.findDeviceByHostname('switch.local')!.id, server.id);
    expect(() => network.httpRequest(network.localDeviceId, 'server.local')).toThrow();
  });

  it('is blocked by a firewall rule denying inbound HTTP', () => {
    const { network } = createComputer();
    const server = network.findDeviceByHostname('server.local')!;
    network.setFirewallEnabled(server.id, true);
    network.addFirewallRule(server.id, { direction: 'inbound', protocol: 'TCP', port: 80, action: 'deny' });
    expect(() => network.httpRequest(network.localDeviceId, 'server.local')).toThrow();
  });
});
