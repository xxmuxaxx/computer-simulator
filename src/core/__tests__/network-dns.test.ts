import { describe, expect, it } from 'vitest';
import { createComputer } from './helpers';

describe('DNS', () => {
  it('resolves a hostname seeded by the default network', () => {
    const { network } = createComputer();
    expect(network.resolveDns(network.localDeviceId, 'server.local')).toBe('192.168.0.101');
  });

  it('fails for an unknown hostname', () => {
    const { network } = createComputer();
    expect(() => network.resolveDns(network.localDeviceId, 'does-not-exist.local')).toThrow(/resolve/);
  });

  it('rejects a duplicate record in the same registry', () => {
    const { network } = createComputer();
    const home = network.listNetworks()[0]!;
    expect(() => network.addDnsRecord(home.id, 'server.local', '192.168.0.250')).toThrow(/already exists/);
  });

  it('prefers a device-local /etc/hosts entry over the network DNS registry', () => {
    const computer = createComputer();
    computer.fileSystem.writeFile('/etc/hosts', '127.0.0.1 localhost\n10.10.10.10 server.local\n');
    expect(computer.network.resolveDns(computer.network.localDeviceId, 'server.local')).toBe('10.10.10.10');
  });
});
