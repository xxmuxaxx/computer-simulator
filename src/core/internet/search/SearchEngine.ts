import type { NetworkManager } from '../../network/NetworkManager';
import type { HttpResponse } from '../../network/types';
import { parseUrl } from '../http/url';
import { statusText } from '../http/status';
import type { InternetEventBus } from '../events';
import type { CrawlStats, SearchDocument } from '../types';
import { extractPage, isDisallowed, parseRobots, parseSitemap, tokenize } from './htmlExtract';

export interface SearchEngineOptions {
  network: NetworkManager;
  now: () => number;
  events: InternetEventBus;
}

export interface SearchResult extends SearchDocument {
  score: number;
}

export interface SearchEngineSnapshot {
  documents: SearchDocument[];
  inboundLinks: Record<string, string[]>;
  brokenLinks: string[];
  lastStats: CrawlStats;
}

const DEFAULT_CRAWL_LIMIT = 200;
const MAX_RESULTS = 20;

interface DocTokens {
  title: Set<string>;
  description: Set<string>;
  body: Set<string>;
  url: Set<string>;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function absoluteUrl(host: string, path: string): string {
  return `http://${host}${path}`;
}

function resolveLink(baseHost: string, basePath: string, href: string): { host: string; path: string } | null {
  if (/^https?:\/\//i.test(href)) {
    const { host, path } = parseUrl(href);
    return { host, path };
  }
  if (/^(#|mailto:|javascript:|tel:)/i.test(href)) return null;
  if (href.startsWith('/')) return { host: baseHost, path: href };
  const dir = basePath.slice(0, basePath.lastIndexOf('/') + 1) || '/';
  return { host: baseHost, path: dir + href };
}

/**
 * The Virtual Search engine: a small crawler that walks real websites through NetworkManager
 * (DNS + HTTP, respecting firewalls and robots.txt exactly like the Browser does), an inverted
 * index built from what it finds, and simple relevance ranking. Zero dependency on React.
 */
export class SearchEngine {
  private documents = new Map<string, SearchDocument>();
  private tokens = new Map<string, DocTokens>();
  private inverted = new Map<string, Set<string>>();
  private inboundLinks = new Map<string, Set<string>>();
  private brokenLinks = new Set<string>();
  private lastStats: CrawlStats = { crawled: 0, queued: 0, failed: 0 };
  private readonly network: NetworkManager;
  private readonly now: () => number;
  private readonly events: InternetEventBus;

  constructor(options: SearchEngineOptions) {
    this.network = options.network;
    this.now = options.now;
    this.events = options.events;
  }

  /** BFS crawl from the given seed URLs, up to `limit` successfully crawled pages. */
  crawl(seedUrls: readonly string[], options: { limit?: number } = {}): CrawlStats {
    const limit = options.limit ?? DEFAULT_CRAWL_LIMIT;
    const visited = new Set<string>();
    const robotsRules = new Map<string, string[]>();
    const sitemapFetched = new Set<string>();
    const queue: string[] = [...seedUrls];
    let crawled = 0;
    let failed = 0;

    while (queue.length && crawled < limit) {
      const { host, path } = parseUrl(queue.shift()!);
      const url = absoluteUrl(host, path);
      if (visited.has(url)) continue;
      visited.add(url);

      if (!robotsRules.has(host)) robotsRules.set(host, this.fetchRobots(host));
      if (isDisallowed(path, robotsRules.get(host)!)) continue;

      if (!sitemapFetched.has(host)) {
        sitemapFetched.add(host);
        for (const su of this.fetchSitemap(host)) if (!visited.has(su)) queue.push(su);
      }

      const body = this.fetchPage(host, path);
      if (body === null) {
        failed++;
        this.brokenLinks.add(url);
        continue;
      }
      this.brokenLinks.delete(url);
      crawled++;

      const extracted = extractPage(body);
      const links: string[] = [];
      for (const href of extracted.links) {
        const resolved = resolveLink(host, path, href);
        if (!resolved) continue;
        const linkUrl = absoluteUrl(resolved.host, resolved.path);
        links.push(linkUrl);
        if (!this.inboundLinks.has(linkUrl)) this.inboundLinks.set(linkUrl, new Set());
        this.inboundLinks.get(linkUrl)!.add(url);
        if (!visited.has(linkUrl)) queue.push(linkUrl);
      }

      this.indexDocument({ url, title: extracted.title || host, description: extracted.description, text: extracted.text, links, indexedAt: this.now() });
    }

    this.lastStats = { crawled, queued: queue.length, failed };
    this.events.emit('crawl:finished', { stats: { ...this.lastStats } });
    return { ...this.lastStats };
  }

  private fetchPage(host: string, path: string): string | null {
    try {
      const response = this.network.httpRequest(this.network.localDeviceId, host, { path });
      return response.status === 200 ? response.body : null;
    } catch {
      return null;
    }
  }

  private fetchRobots(host: string): string[] {
    const body = this.fetchPage(host, '/robots.txt');
    return body ? parseRobots(body) : [];
  }

  private fetchSitemap(host: string): string[] {
    const body = this.fetchPage(host, '/sitemap.xml');
    return body ? parseSitemap(body) : [];
  }

  private indexDocument(doc: SearchDocument): void {
    this.removeFromIndex(doc.url);
    this.documents.set(doc.url, doc);
    const docTokens: DocTokens = {
      title: new Set(tokenize(doc.title)),
      description: new Set(tokenize(doc.description)),
      body: new Set(tokenize(doc.text)),
      url: new Set(tokenize(doc.url)),
    };
    this.tokens.set(doc.url, docTokens);
    for (const term of new Set([...docTokens.title, ...docTokens.description, ...docTokens.body, ...docTokens.url])) {
      if (!this.inverted.has(term)) this.inverted.set(term, new Set());
      this.inverted.get(term)!.add(doc.url);
    }
  }

  private removeFromIndex(url: string): void {
    if (!this.documents.has(url)) return;
    for (const [term, urls] of this.inverted) {
      urls.delete(url);
      if (urls.size === 0) this.inverted.delete(term);
    }
    this.documents.delete(url);
    this.tokens.delete(url);
  }

  query(text: string, limit = MAX_RESULTS): SearchResult[] {
    const terms = tokenize(text);
    if (!terms.length) return [];
    const scores = new Map<string, number>();
    for (const term of terms) {
      for (const url of this.inverted.get(term) ?? []) {
        const docTokens = this.tokens.get(url)!;
        let s = 0;
        if (docTokens.title.has(term)) s += 4;
        if (docTokens.description.has(term)) s += 2;
        if (docTokens.url.has(term)) s += 2;
        if (docTokens.body.has(term)) s += 1;
        scores.set(url, (scores.get(url) ?? 0) + s);
      }
    }
    for (const [url, s] of scores) scores.set(url, s + (this.inboundLinks.get(url)?.size ?? 0) * 0.5);
    return [...scores.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([url, score]) => ({ ...this.documents.get(url)!, score }));
  }

  getStats(): CrawlStats {
    return { ...this.lastStats };
  }

  getIndexSize(): number {
    return this.documents.size;
  }

  listBrokenLinks(): string[] {
    return [...this.brokenLinks];
  }

  /** Renders the search.virtual results page server-side (see HostingRegistry's dynamic-search kind). */
  renderResultsPage(query: string): HttpResponse {
    const trimmed = query.trim();
    const results = trimmed ? this.query(trimmed) : [];
    const rows = results
      .map(
        (r) =>
          `<div class="result"><a href="${escapeHtml(r.url)}">${escapeHtml(r.title)}</a><div class="url">${escapeHtml(r.url)}</div><p>${escapeHtml((r.description || r.text).slice(0, 160))}</p></div>`,
      )
      .join('');
    const summary = trimmed ? `<p class="dim">${results.length} result${results.length === 1 ? '' : 's'} for &quot;${escapeHtml(trimmed)}&quot;</p>` : '';
    const body = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Virtual Search${trimmed ? ` - ${escapeHtml(trimmed)}` : ''}</title>
  <style>
    body { font-family: system-ui, sans-serif; background: #0f172a; color: #e2e8f0; padding: 3rem 1.5rem; max-width: 640px; margin: 0 auto; }
    a { color: #38bdf8; text-decoration: none; }
    form { display: flex; gap: 8px; margin-bottom: 1.5rem; }
    input { flex: 1; padding: 8px 10px; border-radius: 6px; border: 1px solid #334155; background: #1e293b; color: inherit; }
    button { padding: 8px 14px; border-radius: 6px; border: none; background: #38bdf8; color: #0f172a; font-weight: 600; }
    .result { margin-bottom: 1.5rem; }
    .url { color: #94a3b8; font-size: 0.82rem; }
    .dim { color: #94a3b8; }
  </style>
</head>
<body>
  <h1>&#128269; Virtual Search</h1>
  <form action="/search" method="get">
    <input name="q" value="${escapeHtml(trimmed)}" placeholder="Search the virtual internet" />
    <button type="submit">Search</button>
  </form>
  ${summary}
  ${rows}
</body>
</html>
`;
    return { status: 200, statusText: statusText(200), body, contentType: 'text/html' };
  }

  serialize(): SearchEngineSnapshot {
    return {
      documents: [...this.documents.values()].map((d) => ({ ...d, links: [...d.links] })),
      inboundLinks: Object.fromEntries([...this.inboundLinks.entries()].map(([url, refs]) => [url, [...refs]])),
      brokenLinks: [...this.brokenLinks],
      lastStats: { ...this.lastStats },
    };
  }

  restore(snapshot: SearchEngineSnapshot): void {
    this.documents.clear();
    this.tokens.clear();
    this.inverted.clear();
    for (const doc of snapshot.documents) this.indexDocument(doc);
    this.inboundLinks = new Map(Object.entries(snapshot.inboundLinks).map(([url, refs]) => [url, new Set(refs)]));
    this.brokenLinks = new Set(snapshot.brokenLinks);
    this.lastStats = { ...snapshot.lastStats };
  }
}
