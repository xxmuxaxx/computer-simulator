import { describe, expect, it } from 'vitest';
import { createComputer } from './helpers';

describe('firewall', () => {
  it('allows everything by default, even when rules exist but are disabled', () => {
    const { network } = createComputer();
    const server = network.findDeviceByHostname('server.local')!;
    network.addFirewallRule(server.id, { direction: 'inbound', protocol: 'TCP', port: 22, action: 'deny' });
    const result = network.sendPacket({ sourceIp: '192.168.0.100', destinationIp: '192.168.0.101', protocol: 'TCP', destinationPort: 22 });
    expect(result.delivered).toBe(true);
  });

  it('blocks inbound traffic matching a deny rule once enabled', () => {
    const { network } = createComputer();
    const server = network.findDeviceByHostname('server.local')!;
    network.setFirewallEnabled(server.id, true);
    network.addFirewallRule(server.id, { direction: 'inbound', protocol: 'TCP', port: 22, action: 'deny' });
    const result = network.sendPacket({ sourceIp: '192.168.0.100', destinationIp: '192.168.0.101', protocol: 'TCP', destinationPort: 22 });
    expect(result.delivered).toBe(false);
    expect(result.errorCode).toBe('EFWDENY');
  });

  it('still allows unrelated traffic once enabled with a default-allow policy', () => {
    const { network } = createComputer();
    const server = network.findDeviceByHostname('server.local')!;
    network.setFirewallEnabled(server.id, true);
    network.addFirewallRule(server.id, { direction: 'inbound', protocol: 'TCP', port: 22, action: 'deny' });
    const result = network.sendPacket({ sourceIp: '192.168.0.100', destinationIp: '192.168.0.101', protocol: 'TCP', destinationPort: 80 });
    expect(result.delivered).toBe(true);
  });

  it('blocks outbound traffic from the sender before it ever leaves', () => {
    const { network } = createComputer();
    const local = network.localDeviceId;
    network.setFirewallEnabled(local, true);
    network.addFirewallRule(local, { direction: 'outbound', protocol: 'ICMP', action: 'deny' });
    const result = network.sendPacket({ sourceIp: '192.168.0.100', destinationIp: '192.168.0.101', protocol: 'ICMP' });
    expect(result.delivered).toBe(false);
    expect(result.errorCode).toBe('EFWDENY');
  });

  it('applies rules in order, first match wins', () => {
    const { network } = createComputer();
    const server = network.findDeviceByHostname('server.local')!;
    network.setFirewallEnabled(server.id, true);
    network.addFirewallRule(server.id, { direction: 'inbound', protocol: 'TCP', port: 80, action: 'allow' });
    network.addFirewallRule(server.id, { direction: 'inbound', protocol: 'ANY', action: 'deny' });
    const allowed = network.sendPacket({ sourceIp: '192.168.0.100', destinationIp: '192.168.0.101', protocol: 'TCP', destinationPort: 80 });
    const denied = network.sendPacket({ sourceIp: '192.168.0.100', destinationIp: '192.168.0.101', protocol: 'TCP', destinationPort: 8080 });
    expect(allowed.delivered).toBe(true);
    expect(denied.delivered).toBe(false);
  });
});
