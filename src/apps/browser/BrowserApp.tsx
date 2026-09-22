import { useEffect, useRef, useState } from 'react';
import { Icon } from '../../components/Icon';
import { errorMessage, isSystemError } from '../../core/errors';
import { parseUrl } from '../../core/internet/http/url';
import { originOf } from '../../core/internet/web/origin';
import { sandboxHtml } from '../../core/internet/web/sandbox';
import type { HttpResponse } from '../../core/network/types';
import { useComputer } from '../../hooks/useComputer';
import { useVersion } from '../../hooks/useObservable';
import { useWindowCommands } from '../../hooks/windowCommands';
import type { AppProps } from '../types';
import './browser.css';

interface PageState {
  status: 'idle' | 'loading' | 'loaded' | 'error' | 'cert-error';
  url: string;
  response?: HttpResponse;
  error?: string;
  secure?: boolean;
}

/** Inlines linked stylesheets by fetching them through the same virtual HTTP request path, so
 * nothing ever escapes the simulated network to a real browser request. */
function inlineStylesheets(html: string, basePath: string, fetchAsset: (path: string) => string | null): string {
  const dir = basePath.slice(0, basePath.lastIndexOf('/') + 1) || '/';
  return html.replace(/<link[^>]+rel=["']stylesheet["'][^>]*href=["']([^"']+)["'][^>]*\/?>/gi, (match, href: string) => {
    const resolved = href.startsWith('/') ? href : dir + href;
    const css = fetchAsset(resolved);
    return css !== null ? `<style>${css}</style>` : match;
  });
}

function extractTitle(html: string, fallback: string): string {
  const m = /<title[^>]*>([^<]*)<\/title>/i.exec(html);
  const title = m?.[1]?.trim();
  return title || fallback;
}

const ERROR_TITLES: Record<string, string> = {
  EDNSFAIL: "This site can't be reached",
  EHOSTUNREACH: "This site can't be reached",
  ENETUNREACH: "This site can't be reached",
  ETTLEXPIRED: "This site can't be reached",
  ECONNREFUSED: 'Connection refused',
  EFWDENY: 'Connection blocked by firewall',
};

function formatTime(ms: number): string {
  return new Date(ms).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

interface ConsoleEntry {
  level: string;
  text: string;
}

interface NetworkEntry {
  method: string;
  url: string;
  status: number;
}

export function BrowserApp({ windowId, args }: AppProps) {
  const computer = useComputer();
  useVersion(computer.internet);
  const profile = computer.internet.browser;
  const initialAddress = typeof args.url === 'string' ? args.url : 'http://server.local';
  const [address, setAddress] = useState(initialAddress);
  const [page, setPage] = useState<PageState>({ status: 'idle', url: '' });
  const [navStack, setNavStack] = useState<string[]>([]);
  const [navIndex, setNavIndex] = useState(-1);
  const [panel, setPanel] = useState<'none' | 'history' | 'bookmarks' | 'devtools'>('none');
  const [devtoolsTab, setDevtoolsTab] = useState<'console' | 'network' | 'storage' | 'elements'>('console');
  const [consoleLog, setConsoleLog] = useState<ConsoleEntry[]>([]);
  const [requests, setRequests] = useState<NetworkEntry[]>([]);
  const [rawBody, setRawBody] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handler = (event: MessageEvent) => {
      const data = event.data as { source?: string; level?: string; args?: unknown[] } | undefined;
      if (data?.source !== 'virtual-internet-console') return;
      setConsoleLog((prev) => [...prev, { level: data.level ?? 'log', text: (data.args ?? []).join(' ') }]);
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  const load = (raw: string, fromHistory = false) => {
    const target = raw.trim();
    if (!target) return;
    setConsoleLog([]);
    setRequests([]);
    setRawBody('');
    setAddress(target);
    setPage({ status: 'loading', url: target });
    const { scheme, host, port, path } = parseUrl(target);
    const origin = originOf(scheme, host, port);

    if (scheme === 'https') {
      const certStatus = computer.internet.certificates.getStatus(host);
      if (certStatus !== 'valid') {
        setPage({ status: 'cert-error', url: target, error: certStatus });
        computer.windowManager.setTitle(windowId, `${host} - Certificate Error`);
        if (!fromHistory) {
          const next = [...navStack.slice(0, navIndex + 1), target];
          setNavStack(next);
          setNavIndex(next.length - 1);
        }
        return;
      }
    }

    try {
      const cookieHeader = profile.getCookieHeader(origin);
      const response = computer.network.httpRequest(computer.network.localDeviceId, host, {
        port,
        path,
        headers: cookieHeader ? { Cookie: cookieHeader } : undefined,
      });
      const setCookie = response.headers?.['Set-Cookie'];
      if (setCookie) profile.setCookie(origin, setCookie);
      const seenRequests: NetworkEntry[] = [{ method: 'GET', url: target, status: response.status }];
      if (response.status === 200 && response.contentType === 'text/html') {
        setRawBody(response.body);
        response.body = inlineStylesheets(response.body, path, (assetPath) => {
          try {
            const asset = computer.network.httpRequest(computer.network.localDeviceId, host, {
              port,
              path: assetPath,
              headers: profile.getCookieHeader(origin) ? { Cookie: profile.getCookieHeader(origin)! } : undefined,
            });
            seenRequests.push({ method: 'GET', url: `${scheme}://${host}${assetPath}`, status: asset.status });
            return asset.status === 200 ? asset.body : null;
          } catch {
            seenRequests.push({ method: 'GET', url: `${scheme}://${host}${assetPath}`, status: 0 });
            return null;
          }
        });
        response.body = sandboxHtml(response.body);
      }
      setRequests(seenRequests);
      setPage({ status: 'loaded', url: target, response, secure: scheme === 'https' });
      const title = response.status === 200 ? extractTitle(response.body, host) : `${host} - ${response.status}`;
      computer.windowManager.setTitle(windowId, title);
      if (response.status === 200) profile.visit(target, title);
    } catch (e) {
      const code = isSystemError(e) ? e.code : undefined;
      setPage({ status: 'error', url: target, error: code ? (ERROR_TITLES[code] ?? errorMessage(e)) : errorMessage(e) });
      computer.windowManager.setTitle(windowId, host);
    }
    if (!fromHistory) {
      const next = [...navStack.slice(0, navIndex + 1), target];
      setNavStack(next);
      setNavIndex(next.length - 1);
    }
  };

  useWindowCommands(windowId, {
    find: () => inputRef.current?.select(),
  });

  useEffect(() => {
    load(initialAddress);
    // Only ever auto-load the address this window was opened with, not on every re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const goBack = () => {
    if (navIndex <= 0) return;
    setNavIndex(navIndex - 1);
    load(navStack[navIndex - 1]!, true);
  };
  const goForward = () => {
    if (navIndex >= navStack.length - 1) return;
    setNavIndex(navIndex + 1);
    load(navStack[navIndex + 1]!, true);
  };

  const currentUrl = parseUrl(page.url || address);
  const currentOrigin = originOf(currentUrl.scheme, currentUrl.host, currentUrl.port);

  const bookmarked = page.url ? profile.isBookmarked(page.url) : false;
  const toggleBookmark = () => {
    if (!page.url) return;
    if (bookmarked) profile.removeBookmarkByUrl(page.url);
    else profile.addBookmark(page.url, computer.windowManager.get(windowId)?.title ?? page.url);
  };

  return (
    <div className="browser">
      <div className="browser-bar">
        <button className="icon-btn" disabled={navIndex <= 0} onClick={goBack} title="Back">
          <Icon name="back" size={16} />
        </button>
        <button className="icon-btn" disabled={navIndex >= navStack.length - 1} onClick={goForward} title="Forward">
          <Icon name="forward" size={16} />
        </button>
        <button className="icon-btn" onClick={() => page.url && load(page.url, true)} title="Reload">
          <Icon name="refresh" size={16} />
        </button>
        <form
          className="browser-address"
          onSubmit={(e) => {
            e.preventDefault();
            load(address);
          }}
        >
          <Icon name={page.secure ? 'lock' : 'globe'} size={14} className={page.secure ? 'browser-secure' : 'dim'} />
          <input
            ref={inputRef}
            className="input"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            spellCheck={false}
            placeholder="http://server.local"
          />
        </form>
        <button className="btn btn-primary small" onClick={() => load(address)}>
          Go
        </button>
        <button
          className={`icon-btn${bookmarked ? ' on' : ''}`}
          disabled={page.status !== 'loaded'}
          onClick={toggleBookmark}
          title={bookmarked ? 'Remove bookmark' : 'Add bookmark'}
        >
          <Icon name="star" size={16} />
        </button>
        <button className={`icon-btn${panel === 'bookmarks' ? ' on' : ''}`} onClick={() => setPanel(panel === 'bookmarks' ? 'none' : 'bookmarks')} title="Bookmarks">
          <Icon name="bookmark" size={16} />
        </button>
        <button className={`icon-btn${panel === 'history' ? ' on' : ''}`} onClick={() => setPanel(panel === 'history' ? 'none' : 'history')} title="History">
          <Icon name="history" size={16} />
        </button>
        <button className={`icon-btn${panel === 'devtools' ? ' on' : ''}`} onClick={() => setPanel(panel === 'devtools' ? 'none' : 'devtools')} title="Developer Tools">
          <Icon name="terminal" size={16} />
        </button>
      </div>

      {panel === 'history' && (
        <div className="browser-panel">
          <div className="browser-panel-header">
            <strong>History</strong>
            <button className="btn small" onClick={() => profile.clearHistory()}>
              Clear History
            </button>
          </div>
          {profile.getHistory().length === 0 && <p className="dim browser-panel-empty">No history yet.</p>}
          {profile.getHistory().map((h, i) => (
            <button key={i} className="browser-panel-row" onClick={() => load(h.url)}>
              <span>{h.title}</span>
              <small className="dim">{h.url}</small>
              <small className="dim">{formatTime(h.visitedAt)}</small>
            </button>
          ))}
        </div>
      )}
      {panel === 'bookmarks' && (
        <div className="browser-panel">
          <div className="browser-panel-header">
            <strong>Bookmarks</strong>
          </div>
          {profile.listBookmarks().length === 0 && <p className="dim browser-panel-empty">No bookmarks yet.</p>}
          {profile.listBookmarks().map((b) => (
            <div key={b.id} className="browser-panel-row browser-panel-bookmark">
              <button onClick={() => load(b.url)}>
                <span>{b.title}</span>
                <small className="dim">{b.url}</small>
              </button>
              <button className="icon-btn" title="Remove" onClick={() => profile.removeBookmarkByUrl(b.url)}>
                <Icon name="close" size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
      {panel === 'devtools' && (
        <div className="browser-panel browser-devtools">
          <div className="browser-devtools-tabs">
            {(['console', 'network', 'storage', 'elements'] as const).map((tab) => (
              <button key={tab} className={`browser-devtools-tab${devtoolsTab === tab ? ' selected' : ''}`} onClick={() => setDevtoolsTab(tab)}>
                {tab[0]!.toUpperCase() + tab.slice(1)}
              </button>
            ))}
            {devtoolsTab === 'console' && (
              <button className="btn small browser-devtools-clear" onClick={() => setConsoleLog([])}>
                Clear
              </button>
            )}
          </div>
          {devtoolsTab === 'console' && (
            <div className="browser-console">
              {consoleLog.length === 0 && <p className="dim browser-panel-empty">Nothing logged by this page yet.</p>}
              {consoleLog.map((entry, i) => (
                <div key={i} className={`browser-console-line ${entry.level}`}>
                  {entry.text}
                </div>
              ))}
            </div>
          )}
          {devtoolsTab === 'network' && (
            <table className="browser-devtools-table">
              <thead>
                <tr>
                  <th>Method</th>
                  <th>URL</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {requests.map((r, i) => (
                  <tr key={i}>
                    <td>{r.method}</td>
                    <td>{r.url}</td>
                    <td className={r.status >= 400 || r.status === 0 ? 'error' : ''}>{r.status || 'failed'}</td>
                  </tr>
                ))}
                {requests.length === 0 && (
                  <tr>
                    <td colSpan={3} className="dim">
                      No requests yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
          {devtoolsTab === 'storage' && (
            <table className="browser-devtools-table">
              <thead>
                <tr>
                  <th>Cookie</th>
                  <th>Value</th>
                </tr>
              </thead>
              <tbody>
                {profile.listCookies(currentOrigin).map((c) => (
                  <tr key={c.name}>
                    <td>{c.name}</td>
                    <td>{c.value}</td>
                  </tr>
                ))}
                {profile.listCookies(currentOrigin).length === 0 && (
                  <tr>
                    <td colSpan={2} className="dim">
                      No cookies for this origin.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
          {devtoolsTab === 'elements' && <pre className="browser-devtools-source">{rawBody || 'No document loaded.'}</pre>}
        </div>
      )}

      <div className="browser-content">
        {page.status === 'idle' && <div className="browser-empty dim">Enter an address to open a site on the virtual network.</div>}
        {page.status === 'loading' && <div className="browser-empty dim">Loading {page.url}...</div>}
        {page.status === 'error' && (
          <div className="browser-error">
            <Icon name="warning" size={32} />
            <h2>{page.error}</h2>
            <p className="dim">{page.url}</p>
          </div>
        )}
        {page.status === 'cert-error' && (
          <div className="browser-error">
            <Icon name="shield-alert" size={32} />
            <h2>Certificate Error</h2>
            <p className="dim">
              {page.error === 'expired'
                ? `The certificate for this site has expired.`
                : `The certificate is not valid for ${parseUrl(page.url).host}.`}
            </p>
            <p className="dim">{page.url}</p>
          </div>
        )}
        {page.status === 'loaded' && page.response && page.response.status !== 200 && (
          <div className="browser-error">
            <Icon name="warning" size={32} />
            <h2>
              {page.response.status} {page.response.statusText}
            </h2>
            <p className="dim">{page.url}</p>
          </div>
        )}
        {page.status === 'loaded' && page.response && page.response.status === 200 && (
          <iframe title="page" className="browser-frame" srcDoc={page.response.body} sandbox="allow-scripts" />
        )}
      </div>
    </div>
  );
}
