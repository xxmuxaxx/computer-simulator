import { SystemError } from '../../errors';
import { isSameSubnet, isValidCidr, networkFromCidr } from '../../network/ip';
import type { NetworkManager } from '../../network/NetworkManager';
import type { DeviceRecord, HttpRequestContext, HttpResponse } from '../../network/types';
import { uid } from '../../../utils/id';
import type { CertificateAuthority } from '../certificates/CertificateAuthority';
import type { DomainRegistry } from '../domains/DomainRegistry';
import type { InternetEventBus } from '../events';
import type { ApiEndpoint, Website, WebsiteKind, WebsiteStats, WebsiteVisibility } from '../types';
import { statusText } from '../http/status';
import { ACCESS_LOG_PATH, contentTypeFor, ensureHttpLogPaths, ERROR_LOG_PATH, logAccess, resolveSitePath } from './content';

export interface CreateWebsiteInput {
  domainId: string;
  serverId: string;
  rootDirectory?: string;
  visibility?: WebsiteVisibility;
  allowedNetworks?: string[];
  https?: boolean;
  kind?: WebsiteKind;
  seedContent?: { indexHtml: string; styleCss?: string };
}

export interface HostingRegistryOptions {
  network: NetworkManager;
  domains: DomainRegistry;
  certificates: CertificateAuthority;
  now: () => number;
  events: InternetEventBus;
}

const MAX_VISITOR_IPS = 500;

function emptyStats(websiteId: string): WebsiteStats {
  return { websiteId, visitors: 0, pageViews: 0, requests: 0, errors: 0, bandwidthBytes: 0, visitorIps: [] };
}

function ipInAnyCidr(ip: string, cidrs: readonly string[]): boolean {
  return cidrs.some((cidr) => {
    if (!isValidCidr(cidr)) return false;
    const { network, mask } = networkFromCidr(cidr);
    return isSameSubnet(ip, network, mask);
  });
}

/**
 * Website hosting: creates/binds sites to servers and resolves incoming HTTP requests by Host
 * header, including multiple sites sharing one server. Installed as NetworkManager's HTTP content
 * resolver (see NetworkManager.setHttpHandler) so a real request from Browser/curl/wget always
 * goes DNS -> routing -> firewall -> here, never a shortcut.
 */
export class HostingRegistry {
  private websites = new Map<string, Website>();
  private stats = new Map<string, WebsiteStats>();
  private apiEndpoints = new Map<string, ApiEndpoint>();
  private dynamicSearchHandler?: (query: string) => HttpResponse;
  private readonly network: NetworkManager;
  private readonly domains: DomainRegistry;
  private readonly certificates: CertificateAuthority;
  private readonly now: () => number;
  private readonly events: InternetEventBus;

  constructor(options: HostingRegistryOptions) {
    this.network = options.network;
    this.domains = options.domains;
    this.certificates = options.certificates;
    this.now = options.now;
    this.events = options.events;
  }

  /** Installed by SearchEngine so a 'dynamic-search' website's /search path renders live results
   * instead of a static file - this is what makes http://search.virtual work from the real
   * Browser, not just the dedicated Search app. */
  setDynamicSearchHandler(handler: (query: string) => HttpResponse): void {
    this.dynamicSearchHandler = handler;
  }

  createWebsite(input: CreateWebsiteInput): Website {
    const domain = this.domains.requireDomain(input.domainId);
    if ([...this.websites.values()].some((w) => w.domainId === input.domainId)) {
      throw new SystemError('EEXIST', domain.name, `${domain.name} already has a website bound to it`);
    }
    const fs = this.network.getDeviceFileSystem(input.serverId);
    if (!fs) throw new SystemError('ENODEV', input.serverId, 'Server has no file system to host a website on');

    const rootDirectory = input.rootDirectory ?? `/var/www/${domain.name}`;
    if (!fs.exists(rootDirectory)) fs.createDirectory(rootDirectory, { recursive: true });
    if (!fs.exists(`${rootDirectory}/index.html`)) {
      fs.writeFile(`${rootDirectory}/index.html`, input.seedContent?.indexHtml ?? defaultIndexHtml(domain.name));
      if (input.seedContent?.styleCss) fs.writeFile(`${rootDirectory}/style.css`, input.seedContent.styleCss);
    }
    ensureHttpLogPaths(fs);
    if (input.https) {
      this.certificates.issue(domain.name);
      // No real TLS is simulated, but a real client still connects on port 443 - make sure
      // something is actually listening there, the same way a real server runs nginx on both.
      this.network.startService(input.serverId, 'https');
    }

    const website: Website = {
      id: uid('site'),
      domainId: input.domainId,
      serverId: input.serverId,
      rootDirectory,
      enabled: true,
      visibility: input.visibility ?? 'public',
      allowedNetworks: input.allowedNetworks ?? [],
      https: input.https ?? false,
      kind: input.kind ?? 'static',
      createdAt: this.now(),
    };
    this.websites.set(website.id, website);
    this.stats.set(website.id, emptyStats(website.id));
    this.events.emit('website:created', { website: { ...website } });
    return { ...website };
  }

  deleteWebsite(websiteId: string): void {
    if (!this.websites.delete(websiteId)) throw new SystemError('ENOWEBSITE', websiteId);
    this.stats.delete(websiteId);
    for (const e of [...this.apiEndpoints.values()]) if (e.websiteId === websiteId) this.apiEndpoints.delete(e.id);
    this.events.emit('website:deleted', { websiteId });
  }

  // ───────────────────────────── API endpoints ─────────────────────────────

  createApiEndpoint(websiteId: string, input: Omit<ApiEndpoint, 'id' | 'websiteId'>): ApiEndpoint {
    const website = this.requireWebsite(websiteId);
    const path = normalizeApiPath(input.path);
    if ([...this.apiEndpoints.values()].some((e) => e.websiteId === websiteId && e.method === input.method && e.path === path)) {
      throw new SystemError('EEXIST', path, `${input.method} ${path} is already defined`);
    }
    const endpoint: ApiEndpoint = { id: uid('api'), websiteId, ...input, path };
    this.apiEndpoints.set(endpoint.id, endpoint);
    this.events.emit('website:updated', { website: { ...website } });
    return { ...endpoint };
  }

  deleteApiEndpoint(endpointId: string): void {
    const endpoint = this.apiEndpoints.get(endpointId);
    if (!endpoint) throw new SystemError('ENOENT', endpointId, 'No such API endpoint');
    this.apiEndpoints.delete(endpointId);
    const website = this.websites.get(endpoint.websiteId);
    if (website) this.events.emit('website:updated', { website: { ...website } });
  }

  listApiEndpoints(websiteId: string): ApiEndpoint[] {
    return [...this.apiEndpoints.values()].filter((e) => e.websiteId === websiteId).map((e) => ({ ...e }));
  }

  private findApiEndpoint(websiteId: string, method: string, path: string): ApiEndpoint | undefined {
    const clean = normalizeApiPath(path.split('?')[0]!);
    return [...this.apiEndpoints.values()].find((e) => e.websiteId === websiteId && e.method === method && e.path === clean);
  }

  setEnabled(websiteId: string, enabled: boolean): Website {
    const website = this.requireWebsite(websiteId);
    website.enabled = enabled;
    this.events.emit('website:updated', { website: { ...website } });
    return { ...website };
  }

  setVisibility(websiteId: string, visibility: WebsiteVisibility, allowedNetworks: string[] = []): Website {
    const website = this.requireWebsite(websiteId);
    website.visibility = visibility;
    website.allowedNetworks = allowedNetworks;
    this.events.emit('website:updated', { website: { ...website } });
    return { ...website };
  }

  setHttps(websiteId: string, enabled: boolean): Website {
    const website = this.requireWebsite(websiteId);
    website.https = enabled;
    const domain = this.domains.get(website.domainId);
    if (enabled && domain) {
      this.certificates.issue(domain.name);
      this.network.startService(website.serverId, 'https');
    } else if (!enabled && domain) {
      this.certificates.revoke(domain.name);
    }
    this.events.emit('website:updated', { website: { ...website } });
    return { ...website };
  }

  get(websiteId: string): Website | undefined {
    const website = this.websites.get(websiteId);
    return website && { ...website };
  }

  private requireWebsite(websiteId: string): Website {
    const website = this.websites.get(websiteId);
    if (!website) throw new SystemError('ENOWEBSITE', websiteId);
    return website;
  }

  list(serverId?: string): Website[] {
    const all = [...this.websites.values()];
    return (serverId ? all.filter((w) => w.serverId === serverId) : all).map((w) => ({ ...w }));
  }

  statsFor(websiteId: string): WebsiteStats {
    return { ...(this.stats.get(websiteId) ?? emptyStats(websiteId)) };
  }

  /** Called by the Browser layer on a real top-level navigation (not internal asset fetches). */
  recordPageView(websiteId: string, sourceIp: string): void {
    const stats = this.stats.get(websiteId);
    if (!stats) return;
    stats.pageViews++;
    if (!stats.visitorIps.includes(sourceIp)) {
      stats.visitorIps.push(sourceIp);
      if (stats.visitorIps.length > MAX_VISITOR_IPS) stats.visitorIps.shift();
      stats.visitors = stats.visitorIps.length;
    }
  }

  private findWebsiteFor(serverId: string, host: string): Website | undefined {
    for (const website of this.websites.values()) {
      if (website.serverId !== serverId) continue;
      const domain = this.domains.get(website.domainId);
      if (!domain) continue;
      if (host === domain.name || host.endsWith(`.${domain.name}`)) return website;
    }
    return undefined;
  }

  /** Installed as NetworkManager's HTTP content resolver. */
  handleRequest = (device: DeviceRecord, request: HttpRequestContext): HttpResponse => {
    const website = this.findWebsiteFor(device.id, request.host);
    const response = this.resolve(device, website, request);
    if (website) this.trackRequest(website, response);
    if (device.fileSystem) logAccess(device.fileSystem, this.now(), request.method, request.path, response.status);
    return response;
  };

  private trackRequest(website: Website, response: HttpResponse): void {
    const stats = this.stats.get(website.id) ?? this.stats.set(website.id, emptyStats(website.id)).get(website.id)!;
    stats.requests++;
    stats.bandwidthBytes += response.body.length;
    if (response.status >= 400) stats.errors++;
  }

  private resolve(device: DeviceRecord, website: Website | undefined, request: HttpRequestContext): HttpResponse {
    if (!website) return legacyResponse(device, request);
    if (!website.enabled) return errorResponse(503);
    if (website.visibility === 'private' && !ipInAnyCidr(request.sourceIp, website.allowedNetworks)) {
      return errorResponse(403);
    }
    if (!device.fileSystem) return errorResponse(503);

    const api = this.findApiEndpoint(website.id, request.method, request.path);
    if (api) {
      const response: HttpResponse = {
        status: api.status,
        statusText: statusText(api.status),
        body: api.responseBody,
        contentType: api.headers['Content-Type'] ?? 'application/json',
        headers: api.headers,
      };
      return withSessionCookie(response, request);
    }
    if (website.kind === 'dynamic-search' && this.dynamicSearchHandler && /^\/search(\?|$)/.test(request.path)) {
      const query = new URLSearchParams(request.path.split('?')[1] ?? '').get('q') ?? '';
      return withSessionCookie(this.dynamicSearchHandler(query), request);
    }
    if (request.method !== 'GET') return errorResponse(405);
    const target = resolveSitePath(website.rootDirectory, request.path);
    if (!target) return errorResponse(400);
    try {
      const body = device.fileSystem.readFile(target);
      const response: HttpResponse = { status: 200, statusText: statusText(200), body, contentType: contentTypeFor(target) };
      return withSessionCookie(response, request);
    } catch {
      return errorResponse(404);
    }
  }

  serialize(): { websites: Website[]; stats: WebsiteStats[]; apiEndpoints: ApiEndpoint[] } {
    return {
      websites: [...this.websites.values()].map((w) => ({ ...w })),
      stats: [...this.stats.values()].map((s) => ({ ...s })),
      apiEndpoints: [...this.apiEndpoints.values()].map((e) => ({ ...e })),
    };
  }

  restore(data: { websites: Website[]; stats: WebsiteStats[]; apiEndpoints: ApiEndpoint[] }): void {
    this.websites = new Map(data.websites.map((w) => [w.id, { ...w, allowedNetworks: [...w.allowedNetworks] }]));
    this.stats = new Map(data.stats.map((s) => [s.websiteId, { ...s, visitorIps: [...s.visitorIps] }]));
    this.apiEndpoints = new Map(data.apiEndpoints.map((e) => [e.id, { ...e, headers: { ...e.headers } }]));
  }
}

function normalizeApiPath(path: string): string {
  const trimmed = path.trim();
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

function errorResponse(status: number): HttpResponse {
  const text = statusText(status);
  return { status, statusText: text, body: `<h1>${status} ${text}</h1>`, contentType: 'text/html' };
}

const SESSION_COOKIE = 'sessionId';

/** Real, minimal session support (spec §37): a visitor with no session cookie yet gets one
 * issued via Set-Cookie; a visitor who already sent one is left alone. */
function withSessionCookie(response: HttpResponse, request: HttpRequestContext): HttpResponse {
  const cookieHeader = request.headers['Cookie'] ?? request.headers['cookie'];
  if (cookieHeader?.includes(`${SESSION_COOKIE}=`)) return response;
  return { ...response, headers: { ...response.headers, 'Set-Cookie': `${SESSION_COOKIE}=${uid('sess')}; Path=/` } };
}

/** No Website is bound for this device/host: fall back to the device's own flat /var/www, which
 * is how the originally-seeded server.local site (and any bare IP request) keeps working. */
function legacyResponse(device: DeviceRecord, request: HttpRequestContext): HttpResponse {
  if (!device.fileSystem) return errorResponse(503);
  const target = resolveSitePath('/var/www', request.path);
  if (!target) return errorResponse(400);
  try {
    const body = device.fileSystem.readFile(target);
    return { status: 200, statusText: statusText(200), body, contentType: contentTypeFor(target) };
  } catch {
    return errorResponse(404);
  }
}

function defaultIndexHtml(domainName: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>${domainName}</title>
</head>
<body>
  <h1>Welcome to ${domainName}</h1>
  <p>This site lives entirely inside Computer Simulator's Virtual Internet.</p>
</body>
</html>
`;
}

export { ACCESS_LOG_PATH, ERROR_LOG_PATH };
