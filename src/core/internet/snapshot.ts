import type { ApiEndpoint, Domain, InternetDnsRecord, VirtualCertificate, Website, WebsiteStats } from './types';
import type { SearchEngineSnapshot } from './search/SearchEngine';
import type { BrowserProfileSnapshot } from './web/BrowserProfile';

/** Everything the Virtual Internet layer persists between sessions. */
export interface InternetSnapshot {
  domains: Domain[];
  dnsRecords: InternetDnsRecord[];
  websites: Website[];
  websiteStats: WebsiteStats[];
  apiEndpoints: ApiEndpoint[];
  browser: BrowserProfileSnapshot;
  search: SearchEngineSnapshot;
  certificates: VirtualCertificate[];
}
