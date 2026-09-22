import { useState } from 'react';
import { Icon } from '../../components/Icon';
import { dialogs } from '../../store/uiStore';
import { useComputer } from '../../hooks/useComputer';
import { useVersion } from '../../hooks/useObservable';
import type { AppProps } from '../types';
import './domain-manager.css';

function fmtDate(ts: number | undefined): string {
  return ts ? new Date(ts).toLocaleDateString() : '-';
}

export function DomainManagerApp(_props: AppProps) {
  const computer = useComputer();
  useVersion(computer.internet);
  const { internet } = computer;
  const [query, setQuery] = useState('');
  const trimmed = query.trim().toLowerCase();
  const availability = trimmed ? internet.domains.check(trimmed) : null;
  const domains = internet.domains.list();

  const register = () => {
    if (!trimmed) return;
    computer.attempt(() => internet.domains.register(trimmed));
    setQuery('');
  };

  const release = async (name: string) => {
    const okConfirm = await dialogs.confirm({
      title: 'Release domain?',
      message: `${name} will become available for anyone to register again.`,
      danger: true,
    });
    if (!okConfirm) return;
    computer.attempt(() => internet.domains.release(name));
  };

  return (
    <div className="domainmgr">
      <h2>Domain Manager</h2>

      <form
        className="domainmgr-search"
        onSubmit={(e) => {
          e.preventDefault();
        }}
      >
        <input className="input" placeholder="example.com" value={query} onChange={(e) => setQuery(e.target.value)} spellCheck={false} />
        <button className="btn btn-primary" type="submit" disabled={!trimmed}>
          <Icon name="search" size={14} /> Search
        </button>
      </form>

      {availability && (
        <div className="domainmgr-result">
          <div>
            <strong>{trimmed}</strong>
            <span className={`domainmgr-badge ${availability.toLowerCase()}`}>{availability}</span>
          </div>
          {availability === 'AVAILABLE' && (
            <button className="btn btn-primary small" onClick={register}>
              Register
            </button>
          )}
        </div>
      )}

      <h3>My Domains</h3>
      <table className="domainmgr-table">
        <thead>
          <tr>
            <th>Domain</th>
            <th>Status</th>
            <th>Expires</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {domains.map((d) => (
            <tr key={d.id}>
              <td>{d.name}</td>
              <td>
                <span className={`domainmgr-badge ${d.status}`}>{d.status.toUpperCase()}</span>
              </td>
              <td>{fmtDate(d.expiresAt)}</td>
              <td className="domainmgr-row-actions">
                <button className="btn small" onClick={() => computer.attempt(() => internet.domains.renew(d.name))}>
                  Renew
                </button>
                <button className="btn small btn-danger" onClick={() => void release(d.name)}>
                  Release
                </button>
              </td>
            </tr>
          ))}
          {domains.length === 0 && (
            <tr>
              <td colSpan={4} className="dim">
                No domains registered yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
