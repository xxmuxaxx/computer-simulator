import { useState } from 'react';
import { Icon } from '../../components/Icon';
import { useComputer } from '../../hooks/useComputer';
import { useVersion } from '../../hooks/useObservable';
import type { AppProps } from '../types';
import './search.css';

export function SearchApp(_props: AppProps) {
  const computer = useComputer();
  useVersion(computer.internet);
  const { internet } = computer;
  const [query, setQuery] = useState('');
  const [submitted, setSubmitted] = useState('');
  const [crawling, setCrawling] = useState(false);

  const results = submitted ? internet.search.query(submitted) : [];
  const stats = internet.search.getStats();
  const broken = internet.search.listBrokenLinks();

  const runCrawl = () => {
    setCrawling(true);
    const seeds = internet.hosting
      .list()
      .filter((w) => w.enabled && w.visibility === 'public')
      .map((w) => internet.domains.get(w.domainId))
      .filter((d): d is NonNullable<typeof d> => !!d)
      .map((d) => `http://${d.name}`);
    computer.attempt(() => internet.search.crawl(seeds));
    setCrawling(false);
  };

  return (
    <div className="searchapp">
      <div className="searchapp-hero">
        <h1>
          <Icon name="search" size={28} /> Virtual Search
        </h1>
        <form
          className="searchapp-form"
          onSubmit={(e) => {
            e.preventDefault();
            setSubmitted(query.trim());
          }}
        >
          <input className="input" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search the virtual internet" spellCheck={false} />
          <button className="btn btn-primary" type="submit">
            Search
          </button>
        </form>
        <div className="searchapp-meta">
          <span className="dim">
            Indexed: {internet.search.getIndexSize()} &middot; Last crawl - crawled {stats.crawled}, queued {stats.queued}, failed {stats.failed}
          </span>
          <button className="btn small" disabled={crawling} onClick={runCrawl}>
            <Icon name="refresh" size={14} /> {crawling ? 'Crawling...' : 'Run Crawler'}
          </button>
        </div>
      </div>

      <div className="searchapp-results">
        {submitted && results.length === 0 && <p className="dim">No results for &quot;{submitted}&quot;.</p>}
        {results.map((r) => (
          <div key={r.url} className="searchapp-result">
            <button className="searchapp-result-link" onClick={() => computer.launch('browser', { args: { url: r.url } })}>
              {r.title || r.url}
            </button>
            <div className="searchapp-result-url dim">{r.url}</div>
            <p className="searchapp-result-desc">{(r.description || r.text).slice(0, 180)}</p>
          </div>
        ))}
      </div>

      {broken.length > 0 && (
        <div className="searchapp-broken">
          <h3>Broken links</h3>
          {broken.map((url) => (
            <div key={url} className="dim">
              {url}
            </div>
          ))}
        </div>
      )}
      <p className="searchapp-hint dim">You can also open http://search.virtual directly in the Browser.</p>
    </div>
  );
}
