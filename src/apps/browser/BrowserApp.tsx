import { useRef, useState } from 'react';
import { Icon } from '../../components/Icon';
import { errorMessage, isSystemError } from '../../core/errors';
import type { HttpResponse } from '../../core/network/types';
import { useComputer } from '../../hooks/useComputer';
import { useWindowCommands } from '../../hooks/windowCommands';
import type { AppProps } from '../types';
import './browser.css';

interface PageState {
  status: 'idle' | 'loading' | 'loaded' | 'error';
  url: string;
  response?: HttpResponse;
  error?: string;
}

function parseAddress(input: string): { host: string; port?: number; path: string } {
  let value = input.trim();
  let port: number | undefined;
  value = value.replace(/^https?:\/\//i, (m) => {
    port = /^https/i.test(m) ? 443 : undefined;
    return '';
  });
  const slash = value.indexOf('/');
  const authority = slash >= 0 ? value.slice(0, slash) : value;
  const path = slash >= 0 ? value.slice(slash) : '/';
  const [host, portStr] = authority.split(':');
  return { host: host || 'localhost', port: portStr ? Number(portStr) : port, path: path || '/' };
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

const ERROR_TITLES: Record<string, string> = {
  EDNSFAIL: "This site can't be reached",
  EHOSTUNREACH: "This site can't be reached",
  ENETUNREACH: "This site can't be reached",
  ETTLEXPIRED: "This site can't be reached",
  ECONNREFUSED: 'Connection refused',
  EFWDENY: 'Connection blocked by firewall',
};

export function BrowserApp({ windowId }: AppProps) {
  const computer = useComputer();
  const [address, setAddress] = useState('http://server.local');
  const [page, setPage] = useState<PageState>({ status: 'idle', url: '' });
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);

  const load = (raw: string, fromHistory = false) => {
    const target = raw.trim();
    if (!target) return;
    setAddress(target);
    setPage({ status: 'loading', url: target });
    const { host, port, path } = parseAddress(target);
    try {
      const response = computer.network.httpRequest(computer.network.localDeviceId, host, { port, path });
      if (response.status === 200 && response.contentType === 'text/html') {
        response.body = inlineStylesheets(response.body, path, (assetPath) => {
          try {
            const asset = computer.network.httpRequest(computer.network.localDeviceId, host, { port, path: assetPath });
            return asset.status === 200 ? asset.body : null;
          } catch {
            return null;
          }
        });
      }
      setPage({ status: 'loaded', url: target, response });
      computer.windowManager.setTitle(windowId, response.status === 200 ? host : `${host} - ${response.status}`);
    } catch (e) {
      const code = isSystemError(e) ? e.code : undefined;
      setPage({ status: 'error', url: target, error: code ? (ERROR_TITLES[code] ?? errorMessage(e)) : errorMessage(e) });
      computer.windowManager.setTitle(windowId, host);
    }
    if (!fromHistory) {
      const next = [...history.slice(0, historyIndex + 1), target];
      setHistory(next);
      setHistoryIndex(next.length - 1);
    }
  };

  useWindowCommands(windowId, {
    find: () => inputRef.current?.select(),
  });

  const goBack = () => {
    if (historyIndex <= 0) return;
    setHistoryIndex(historyIndex - 1);
    load(history[historyIndex - 1]!, true);
  };
  const goForward = () => {
    if (historyIndex >= history.length - 1) return;
    setHistoryIndex(historyIndex + 1);
    load(history[historyIndex + 1]!, true);
  };

  return (
    <div className="browser">
      <div className="browser-bar">
        <button className="icon-btn" disabled={historyIndex <= 0} onClick={goBack} title="Back">
          <Icon name="back" size={16} />
        </button>
        <button className="icon-btn" disabled={historyIndex >= history.length - 1} onClick={goForward} title="Forward">
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
          <Icon name="globe" size={14} className="dim" />
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
      </div>
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
          <iframe title="page" className="browser-frame" srcDoc={page.response.body} sandbox="" />
        )}
      </div>
    </div>
  );
}
