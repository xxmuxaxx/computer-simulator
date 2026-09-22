import { Icon } from '../../components/Icon';
import { useComputer } from '../../hooks/useComputer';
import { useVersion } from '../../hooks/useObservable';
import type { AppProps } from '../types';
import './internet-control-panel.css';

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

const QUICK_LINKS = [
  { appId: 'domain-manager', icon: 'link', label: 'Domains' },
  { appId: 'hosting-manager', icon: 'grid', label: 'Websites' },
  { appId: 'website-builder', icon: 'file-plus', label: 'Website Builder' },
  { appId: 'search', icon: 'search', label: 'Search' },
  { appId: 'network-manager', icon: 'network', label: 'Network' },
  { appId: 'network-monitor', icon: 'radio', label: 'Traffic' },
];

export function InternetControlPanelApp(_props: AppProps) {
  const computer = useComputer();
  useVersion(computer.internet);
  useVersion(computer.network);
  const { internet, network } = computer;

  const domains = internet.domains.list();
  const websites = internet.hosting.list();
  const servers = network.listDevices().filter((d) => d.type === 'server');
  const dnsRecordCount = domains.reduce((sum, d) => sum + internet.dns.list(d.id).length, 0);
  const certificates = internet.certificates.list();
  const allStats = websites.map((w) => internet.hosting.statsFor(w.id));
  const totalRequests = allStats.reduce((sum, s) => sum + s.requests, 0);
  const totalErrors = allStats.reduce((sum, s) => sum + s.errors, 0);
  const totalBandwidth = allStats.reduce((sum, s) => sum + s.bandwidthBytes, 0);
  const crawlStats = internet.search.getStats();

  return (
    <div className="icp">
      <header className="icp-header">
        <Icon name="globe" size={26} />
        <h1>Virtual Internet</h1>
      </header>

      <div className="icp-stats">
        <div>
          <strong>{domains.length}</strong>
          <span className="dim">Domains</span>
        </div>
        <div>
          <strong>{websites.length}</strong>
          <span className="dim">Websites</span>
        </div>
        <div>
          <strong>{servers.length}</strong>
          <span className="dim">Servers</span>
        </div>
        <div>
          <strong>{dnsRecordCount}</strong>
          <span className="dim">DNS Records</span>
        </div>
        <div>
          <strong>{certificates.length}</strong>
          <span className="dim">Certificates</span>
        </div>
        <div>
          <strong>{internet.search.getIndexSize()}</strong>
          <span className="dim">Indexed Pages</span>
        </div>
      </div>

      <div className="icp-stats icp-stats-secondary">
        <div>
          <strong>{totalRequests.toLocaleString()}</strong>
          <span className="dim">Requests</span>
        </div>
        <div>
          <strong>{totalErrors.toLocaleString()}</strong>
          <span className="dim">Errors</span>
        </div>
        <div>
          <strong>{formatBytes(totalBandwidth)}</strong>
          <span className="dim">Network Traffic</span>
        </div>
        <div>
          <strong>
            {crawlStats.crawled} / {crawlStats.failed}
          </strong>
          <span className="dim">Crawled / Failed</span>
        </div>
      </div>

      <h3>Active Websites</h3>
      <div className="icp-sites">
        {websites.length === 0 && <p className="dim">No websites yet.</p>}
        {websites.map((w) => {
          const domain = internet.domains.get(w.domainId);
          return (
            <div key={w.id} className="icp-site-row">
              <span>{domain?.name ?? '?'}</span>
              <span className={`icp-status ${w.enabled ? 'online' : 'offline'}`}>{w.enabled ? 'ONLINE' : 'OFFLINE'}</span>
            </div>
          );
        })}
      </div>

      <h3>Open</h3>
      <div className="icp-links">
        {QUICK_LINKS.map((l) => (
          <button key={l.appId} className="btn small" onClick={() => computer.attempt(() => computer.launch(l.appId))}>
            <Icon name={l.icon} size={14} /> {l.label}
          </button>
        ))}
      </div>
    </div>
  );
}
