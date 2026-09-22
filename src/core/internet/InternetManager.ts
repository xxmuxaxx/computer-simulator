import { Observable } from '../../utils/Observable';
import type { NetworkManager } from '../network/NetworkManager';
import { CertificateAuthority } from './certificates/CertificateAuthority';
import { DomainRegistry } from './domains/DomainRegistry';
import { DnsZoneManager } from './dns/DnsZoneManager';
import { InternetEventBus } from './events';
import { HostingRegistry } from './hosting/HostingRegistry';
import { SearchEngine } from './search/SearchEngine';
import { seedDefaultInternet } from './seed';
import type { InternetEventMap, InternetEventName } from './types';
import type { InternetSnapshot } from './snapshot';
import { BrowserProfile } from './web/BrowserProfile';

export interface InternetManagerOptions {
  network: NetworkManager;
  now?: () => number;
  random?: () => number;
  snapshot?: InternetSnapshot | null;
}

/**
 * Composition root of the Virtual Internet layer: domains, DNS zones, hosting, certificates and
 * search, all built on top of NetworkManager's public API. Zero dependency on React, same
 * Observable pattern as VirtualComputer's other managers.
 */
export class InternetManager extends Observable {
  readonly events = new InternetEventBus();
  readonly domains: DomainRegistry;
  readonly dns: DnsZoneManager;
  readonly hosting: HostingRegistry;
  readonly browser: BrowserProfile;
  readonly search: SearchEngine;
  readonly certificates: CertificateAuthority;

  private readonly now: () => number;

  constructor(options: InternetManagerOptions) {
    super();
    this.now = options.now ?? Date.now;
    this.domains = new DomainRegistry({ now: this.now, events: this.events });
    this.dns = new DnsZoneManager({ network: options.network, domains: this.domains, events: this.events });
    this.certificates = new CertificateAuthority({ now: this.now, events: this.events });
    this.hosting = new HostingRegistry({ network: options.network, domains: this.domains, certificates: this.certificates, now: this.now, events: this.events });
    this.browser = new BrowserProfile({ now: this.now });
    this.search = new SearchEngine({ network: options.network, now: this.now, events: this.events });
    this.hosting.setDynamicSearchHandler((query) => this.search.renderResultsPage(query));
    options.network.setHttpHandler(this.hosting.handleRequest);

    if (options.snapshot) {
      this.domains.restore(options.snapshot.domains);
      this.dns.restore(options.snapshot.dnsRecords);
      this.hosting.restore({ websites: options.snapshot.websites, stats: options.snapshot.websiteStats, apiEndpoints: options.snapshot.apiEndpoints });
      this.browser.restore(options.snapshot.browser);
      this.search.restore(options.snapshot.search);
      this.certificates.restore(options.snapshot.certificates);
    } else {
      this.seedSearchEngine(options.network);
      const demoUrls = seedDefaultInternet({ domains: this.domains, dns: this.dns, hosting: this.hosting, search: this.search }, options.network);
      this.search.crawl(['http://search.virtual', ...demoUrls]);
    }
    this.browser.subscribe(() => this.emit());

    this.events.on('domain:registered', () => this.emit());
    this.events.on('domain:renewed', () => this.emit());
    this.events.on('domain:released', () => this.emit());
    this.events.on('domain:expired', () => this.emit());
    this.events.on('dns:record-added', () => this.emit());
    this.events.on('dns:record-removed', () => this.emit());
    this.events.on('website:created', () => this.emit());
    this.events.on('website:updated', () => this.emit());
    this.events.on('website:deleted', () => this.emit());
    this.events.on('crawl:finished', () => this.emit());
    this.events.on('certificate:issued', () => this.emit());
    this.events.on('certificate:revoked', () => this.emit());
  }

  on<K extends InternetEventName>(event: K, listener: (payload: InternetEventMap[K]) => void): () => void {
    return this.events.on(event, listener);
  }

  /** search.virtual, seeded once on a fresh computer so `http://search.virtual` works out of the
   * box - its homepage is just its own results page rendered with an empty query. */
  private seedSearchEngine(network: NetworkManager): void {
    const server = network.findDeviceByHostname('server.local');
    if (!server) return;
    const serverIp = server.interfaces.find((i) => i.ipAddress)?.ipAddress;
    if (!serverIp) return;
    const domain = this.domains.register('search.virtual');
    this.dns.addRecord(domain.id, 'A', '@', serverIp);
    this.hosting.createWebsite({
      domainId: domain.id,
      serverId: server.id,
      kind: 'dynamic-search',
      seedContent: { indexHtml: this.search.renderResultsPage('').body },
    });
  }

  snapshot(): InternetSnapshot {
    const hosting = this.hosting.serialize();
    return {
      domains: this.domains.serialize(),
      dnsRecords: this.dns.serialize(),
      websites: hosting.websites,
      websiteStats: hosting.stats,
      apiEndpoints: hosting.apiEndpoints,
      browser: this.browser.snapshot(),
      search: this.search.serialize(),
      certificates: this.certificates.serialize(),
    };
  }
}
