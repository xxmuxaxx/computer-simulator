import type { NetworkManager } from '../network/NetworkManager';
import type { DomainRegistry } from './domains/DomainRegistry';
import type { DnsZoneManager } from './dns/DnsZoneManager';
import type { HostingRegistry } from './hosting/HostingRegistry';
import type { SearchEngine } from './search/SearchEngine';

export interface SeedDeps {
  domains: DomainRegistry;
  dns: DnsZoneManager;
  hosting: HostingRegistry;
  search: SearchEngine;
}

const NAV = [
  { href: 'http://computer.local', text: 'Home' },
  { href: 'http://docs.local', text: 'Docs' },
  { href: 'http://news.local', text: 'News' },
  { href: 'http://shop.local', text: 'Shop' },
];

function page(title: string, heading: string, body: string): string {
  const nav = NAV.map((l) => `<a href="${l.href}">${l.text}</a>`).join(' &middot; ');
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>${title}</title>
  <style>body{font-family:system-ui,sans-serif;background:#0f172a;color:#e2e8f0;padding:2.5rem;max-width:640px;margin:0 auto;}a{color:#38bdf8;margin-right:.5rem;}h1{color:#38bdf8;}</style>
</head>
<body>
  <h1>${heading}</h1>
  ${body}
  <p>${nav}</p>
</body>
</html>
`;
}

const DEMO_SITES = [
  {
    domain: 'computer.local',
    title: 'Computer Simulator',
    heading: 'Computer Simulator',
    body: '<p>A browser-based simulation of a personal computer: its own desktop, file system, terminal, process manager and a fully virtual Internet.</p>',
  },
  {
    domain: 'news.local',
    title: 'Virtual News',
    heading: 'Virtual News',
    body:
      '<div><h2>Search engine launches</h2><p>Virtual Search now crawls every public site on the network and ranks results by relevance.</p></div>' +
      '<div><h2>HTTPS arrives</h2><p>Websites can now request a certificate from the Virtual CA and serve over https.</p></div>',
  },
  {
    domain: 'docs.local',
    title: 'Documentation',
    heading: 'Virtual Internet Docs',
    body: '<p>Register a domain, point its DNS at a server, and your site goes live. See Domain Manager and Hosting Manager for details.</p>',
  },
  {
    domain: 'shop.local',
    title: 'Virtual Shop',
    heading: 'Virtual Shop',
    body: '<div><h2>Widget</h2><p>$9.99</p></div><div><h2>Gadget</h2><p>$19.99</p></div>',
  },
];

/** The demo Internet every fresh computer boots with, so the Browser, Search and Hosting Manager
 * all have something real to show immediately instead of an empty shell (spec §50). */
export function seedDefaultInternet(deps: SeedDeps, network: NetworkManager): string[] {
  const server = network.findDeviceByHostname('server.local');
  if (!server) return [];
  const serverIp = server.interfaces.find((i) => i.ipAddress)?.ipAddress;
  if (!serverIp) return [];

  const urls: string[] = [];
  for (const s of DEMO_SITES) {
    const domain = deps.domains.register(s.domain);
    deps.dns.addRecord(domain.id, 'A', '@', serverIp);
    deps.hosting.createWebsite({ domainId: domain.id, serverId: server.id, seedContent: { indexHtml: page(s.title, s.heading, s.body) } });
    urls.push(`http://${s.domain}`);
  }
  return urls;
}
