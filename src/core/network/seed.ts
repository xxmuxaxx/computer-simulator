import type { NetworkManager } from './NetworkManager';

const SITE_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Computer Simulator Network</title>
  <link rel="stylesheet" href="style.css" />
</head>
<body>
  <h1>Welcome to Computer Simulator Network</h1>
  <p>This page is served by <strong>server.local</strong> inside the virtual network.</p>
</body>
</html>
`;

const SITE_CSS = `body {
  font-family: system-ui, sans-serif;
  background: #0f172a;
  color: #e2e8f0;
  padding: 3rem;
}
h1 { color: #38bdf8; }
`;

/**
 * Creates the network every fresh computer boots with: one router providing DHCP, one
 * server running an HTTP site, and the local computer already addressed and connected.
 */
export function seedDefaultNetwork(network: NetworkManager, localDeviceId: string): void {
  const home = network.createNetwork('Home Network', '192.168.0.0/24');
  const router = network.createDevice({ hostname: 'router.local', type: 'router', interfaceCount: 1 });
  const lanSwitch = network.createDevice({ hostname: 'switch.local', type: 'switch', interfaceCount: 4 });
  const server = network.createDevice({ hostname: 'server.local', type: 'server' });

  // Router -- Switch -- {this computer, server}: a real shared LAN segment, not two point-to-point links.
  network.connectDevices(router.id, lanSwitch.id);
  network.connectDevices(lanSwitch.id, localDeviceId);
  network.connectDevices(lanSwitch.id, server.id);

  const routerLan = router.interfaces[0]!;
  network.configureInterface(router.id, routerLan.id, { ipAddress: '192.168.0.1', subnetMask: '255.255.255.0' });
  network.configureDhcp(router.id, {
    enabled: true,
    interfaceId: routerLan.id,
    rangeStart: '192.168.0.100',
    rangeEnd: '192.168.0.200',
    gateway: '192.168.0.1',
    subnetMask: '255.255.255.0',
    dnsServers: ['192.168.0.1'],
  });

  const localDevice = network.getDevice(localDeviceId)!;
  network.configureInterface(localDeviceId, localDevice.interfaces[0]!.id, {
    ipAddress: '192.168.0.100',
    subnetMask: '255.255.255.0',
    gateway: '192.168.0.1',
    dnsServers: ['192.168.0.1'],
  });
  network.configureInterface(server.id, server.interfaces[0]!.id, {
    ipAddress: '192.168.0.101',
    subnetMask: '255.255.255.0',
    gateway: '192.168.0.1',
    dnsServers: ['192.168.0.1'],
  });

  network.addDnsRecord(home.id, 'router.local', '192.168.0.1');
  network.addDnsRecord(home.id, 'desktop.local', '192.168.0.100');
  network.addDnsRecord(home.id, 'server.local', '192.168.0.101');

  const site = network.getDeviceFileSystem(server.id);
  if (site) {
    site.writeFile('/var/www/index.html', SITE_HTML);
    site.writeFile('/var/www/style.css', SITE_CSS);
  }
  network.startService(server.id, 'http');
}
