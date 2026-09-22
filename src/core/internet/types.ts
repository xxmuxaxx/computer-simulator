/** Shared, UI-independent types for the Virtual Internet layer built on top of core/network. */

export type DomainStatus = 'active' | 'expired' | 'reserved';

export interface NameServer {
  hostname: string;
  ipAddress: string;
}

export interface Domain {
  id: string;
  /** Normalized lowercase, e.g. "example.com". */
  name: string;
  ownerId?: string;
  status: DomainStatus;
  createdAt: number;
  expiresAt?: number;
  nameservers: NameServer[];
}

export type DomainAvailability = 'AVAILABLE' | 'TAKEN' | 'INVALID';

export type DnsRecordType = 'A' | 'AAAA' | 'CNAME' | 'MX' | 'TXT' | 'NS';

export interface InternetDnsRecord {
  id: string;
  domainId: string;
  type: DnsRecordType;
  /** Subdomain label, "@" for the domain root, e.g. "www". */
  name: string;
  value: string;
  ttl?: number;
  /** MX only. */
  priority?: number;
}

export type WebsiteVisibility = 'public' | 'private';
export type WebsiteKind = 'static' | 'dynamic-search';
export type WebsiteStatus = 'ONLINE' | 'OFFLINE' | 'DNS_ERROR' | 'SERVER_ERROR' | 'CERTIFICATE_ERROR';

export interface Website {
  id: string;
  domainId: string;
  serverId: string;
  rootDirectory: string;
  enabled: boolean;
  visibility: WebsiteVisibility;
  /** CIDR blocks allowed to reach a private site. */
  allowedNetworks: string[];
  https: boolean;
  kind: WebsiteKind;
  createdAt: number;
}

export interface WebsiteStats {
  websiteId: string;
  visitors: number;
  pageViews: number;
  requests: number;
  errors: number;
  bandwidthBytes: number;
  /** Bounded set of source IPs seen, used only to count unique visitors. */
  visitorIps: string[];
}

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

export interface ApiEndpoint {
  id: string;
  websiteId: string;
  method: HttpMethod;
  path: string;
  status: number;
  responseBody: string;
  headers: Record<string, string>;
}

export type CertificateStatus = 'valid' | 'expired' | 'invalid';

export interface VirtualCertificate {
  id: string;
  domain: string;
  issuer: string;
  validFrom: number;
  validTo: number;
}

export interface Cookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires?: number;
  secure: boolean;
}

export interface BrowserHistoryEntry {
  url: string;
  title: string;
  visitedAt: number;
}

export interface Bookmark {
  id: string;
  url: string;
  title: string;
  createdAt: number;
}

export interface SearchDocument {
  url: string;
  title: string;
  description: string;
  text: string;
  links: string[];
  indexedAt: number;
}

export interface CrawlStats {
  crawled: number;
  queued: number;
  failed: number;
}

export type InternetEventMap = {
  'domain:registered': { domain: Domain };
  'domain:renewed': { domain: Domain };
  'domain:released': { domainId: string };
  'domain:expired': { domain: Domain };
  'dns:record-added': { record: InternetDnsRecord };
  'dns:record-removed': { domainId: string; recordId: string };
  'website:created': { website: Website };
  'website:deleted': { websiteId: string };
  'website:updated': { website: Website };
  'certificate:issued': { certificate: VirtualCertificate };
  'certificate:revoked': { certificateId: string };
  'crawl:finished': { stats: CrawlStats };
};

export type InternetEventName = keyof InternetEventMap;
