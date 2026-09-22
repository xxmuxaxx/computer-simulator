import { describe, expect, it } from 'vitest';
import { createComputer } from './helpers';

const SERVER_IP = '192.168.0.101';

function bindSite(computer: ReturnType<typeof createComputer>, domainName: string, seedContent: { indexHtml: string; styleCss?: string }) {
  const { internet, network } = computer;
  const server = network.findDeviceByHostname('server.local')!;
  const domain = internet.domains.register(domainName);
  internet.dns.addRecord(domain.id, 'A', '@', SERVER_IP);
  const website = internet.hosting.createWebsite({ domainId: domain.id, serverId: server.id, seedContent });
  return { domain, website, server };
}

/** A fresh computer auto-seeds and crawls demo sites (computer.local, news.local, ...), so tests
 * that assert exact index sizes start from a clean slate instead. */
function resetSearchIndex(computer: ReturnType<typeof createComputer>): void {
  computer.internet.search.restore({ documents: [], inboundLinks: {}, brokenLinks: [], lastStats: { crawled: 0, queued: 0, failed: 0 } });
}

describe('Virtual Search', () => {
  it('crawls a site and indexes its title, description and body', () => {
    const computer = createComputer();
    const { internet } = computer;
    resetSearchIndex(computer);
    bindSite(computer, 'mydocs.local', {
      indexHtml: `<html><head><title>Docs Home</title><meta name="description" content="Documentation for the virtual internet" /></head><body><p>Learn how routing and DNS work.</p></body></html>`,
    });
    const stats = internet.search.crawl(['http://mydocs.local']);
    expect(stats.crawled).toBe(1);
    expect(stats.failed).toBe(0);
    expect(internet.search.getIndexSize()).toBe(1);
    const results = internet.search.query('routing');
    expect(results).toHaveLength(1);
    expect(results[0]!.url).toBe('http://mydocs.local/');
  });

  it('follows links and builds a link graph used for ranking', () => {
    const computer = createComputer();
    const { internet } = computer;
    bindSite(computer, 'hub.local', { indexHtml: `<html><head><title>Hub</title></head><body><a href="http://spoke.local/">Spoke</a></body></html>` });
    bindSite(computer, 'spoke.local', { indexHtml: `<html><head><title>Spoke</title></head><body><p>spoke content</p></body></html>` });
    const stats = internet.search.crawl(['http://hub.local']);
    expect(stats.crawled).toBe(2);
    const results = internet.search.query('spoke');
    expect(results.map((r) => r.url)).toContain('http://spoke.local/');
  });

  it('ranks a title match above a body-only match', () => {
    const computer = createComputer();
    const { internet } = computer;
    bindSite(computer, 'a.local', { indexHtml: `<html><head><title>Widgets</title></head><body>nothing special</body></html>` });
    bindSite(computer, 'b.local', { indexHtml: `<html><head><title>Home</title></head><body>we also sell widgets here</body></html>` });
    internet.search.crawl(['http://a.local', 'http://b.local']);
    const results = internet.search.query('widgets');
    expect(results[0]!.url).toBe('http://a.local/');
  });

  it('respects robots.txt Disallow rules', () => {
    const computer = createComputer();
    const { internet, network } = computer;
    resetSearchIndex(computer);
    const { server } = bindSite(computer, 'private-docs.local', {
      indexHtml: `<html><head><title>Home</title></head><body><a href="/private/secret.html">internal page</a></body></html>`,
    });
    const fs = network.getDeviceFileSystem(server.id)!;
    fs.writeFile('/var/www/private-docs.local/robots.txt', 'User-agent: *\nDisallow: /private\n');
    fs.createDirectory('/var/www/private-docs.local/private');
    fs.writeFile('/var/www/private-docs.local/private/secret.html', '<html><head><title>Secret</title></head><body>classified contents</body></html>');
    internet.search.crawl(['http://private-docs.local']);
    expect(internet.search.getIndexSize()).toBe(1);
    expect(internet.search.query('classified')).toHaveLength(0);
  });

  it('marks a broken link (404) as failed and does not index it', () => {
    const computer = createComputer();
    const { internet } = computer;
    bindSite(computer, 'broken.local', { indexHtml: `<html><head><title>Home</title></head><body><a href="/missing.html">missing</a></body></html>` });
    const stats = internet.search.crawl(['http://broken.local']);
    expect(stats.crawled).toBe(1);
    expect(stats.failed).toBe(1);
    expect(internet.search.listBrokenLinks()).toContain('http://broken.local/missing.html');
  });

  it('serves http://search.virtual out of the box and returns results for a query', () => {
    const computer = createComputer();
    const { internet, network } = computer;
    bindSite(computer, 'findme.local', { indexHtml: `<html><head><title>Find Me</title></head><body>unique content</body></html>` });
    internet.search.crawl(['http://findme.local']);

    const home = network.httpRequest(network.localDeviceId, 'search.virtual');
    expect(home.status).toBe(200);
    expect(home.body).toContain('Virtual Search');

    const results = network.httpRequest(network.localDeviceId, 'search.virtual', { path: '/search?q=findme' });
    expect(results.status).toBe(200);
    expect(results.body).toContain('findme.local');
  });

  it('round-trips the index through snapshot/restore', () => {
    const computer = createComputer();
    const { internet } = computer;
    resetSearchIndex(computer);
    bindSite(computer, 'persisted.local', { indexHtml: `<html><head><title>Persisted</title></head><body>keep me</body></html>` });
    internet.search.crawl(['http://persisted.local']);
    const snapshot = internet.snapshot();

    const restored = createComputer();
    restored.internet.search.restore(snapshot.search);
    expect(restored.internet.search.getIndexSize()).toBe(1);
    expect(restored.internet.search.query('persisted')).toHaveLength(1);
  });
});
