import { useState } from 'react';
import { Icon } from '../../components/Icon';
import { errorMessage } from '../../core/errors';
import { useComputer } from '../../hooks/useComputer';
import { useVersion } from '../../hooks/useObservable';
import type { AppProps } from '../types';
import { generateTemplate, WEBSITE_TEMPLATES, type WebsiteTemplateId } from './templates';
import './website-builder.css';

export function WebsiteBuilderApp(_props: AppProps) {
  const computer = useComputer();
  useVersion(computer.internet);
  useVersion(computer.network);
  const { internet, network } = computer;
  const servers = network.listDevices().filter((d) => d.hasFileSystem);

  const [domainName, setDomainName] = useState('');
  const [templateId, setTemplateId] = useState<WebsiteTemplateId>('blank');
  const [serverId, setServerId] = useState(servers.find((d) => d.type === 'server')?.id ?? servers[0]?.id ?? '');
  const [https, setHttps] = useState(false);
  const [created, setCreated] = useState<{ domain: string; https: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const trimmed = domainName.trim().toLowerCase();
  const availability = trimmed ? internet.domains.check(trimmed) : null;

  const create = () => {
    setError(null);
    setCreated(null);
    if (!trimmed) return;
    try {
      let domain = internet.domains.list().find((d) => d.name === trimmed && d.status === 'active');
      if (!domain) domain = internet.domains.register(trimmed);
      if (internet.hosting.list().some((w) => w.domainId === domain!.id)) {
        setError(`${trimmed} already has a website. Use Hosting Manager to edit it.`);
        return;
      }
      const server = network.getDevice(serverId);
      if (!server) {
        setError('Choose a server to host this site on.');
        return;
      }
      const content = generateTemplate(templateId, trimmed);
      internet.hosting.createWebsite({ domainId: domain.id, serverId, seedContent: content, https });
      const serverIp = server.interfaces.find((i) => i.ipAddress)?.ipAddress;
      if (serverIp) internet.dns.addRecord(domain.id, 'A', '@', serverIp);
      setCreated({ domain: trimmed, https });
      setDomainName('');
      setHttps(false);
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <div className="websitebuilder">
      <h2>Website Builder</h2>
      <p className="dim">Create a new virtual website: pick a domain, a starting template and a server to host it on.</p>

      <label className="wb-field">
        <span>Domain</span>
        <input className="input" placeholder="mysite.local" value={domainName} onChange={(e) => setDomainName(e.target.value)} spellCheck={false} />
      </label>
      {availability && <p className={`wb-availability ${availability === 'TAKEN' ? 'taken' : availability === 'INVALID' ? 'invalid' : 'available'}`}>{availability}</p>}

      <span className="wb-label">Template</span>
      <div className="wb-templates">
        {WEBSITE_TEMPLATES.map((t) => (
          <button key={t.id} className={`wb-template${templateId === t.id ? ' selected' : ''}`} onClick={() => setTemplateId(t.id)}>
            <strong>{t.name}</strong>
            <small className="dim">{t.description}</small>
          </button>
        ))}
      </div>

      <label className="wb-field">
        <span>Server</span>
        <select className="input" value={serverId} onChange={(e) => setServerId(e.target.value)}>
          {servers.map((s) => (
            <option key={s.id} value={s.id}>
              {s.hostname}
            </option>
          ))}
        </select>
      </label>

      <label className="wb-checkbox">
        <input type="checkbox" checked={https} onChange={(e) => setHttps(e.target.checked)} />
        <span>
          <Icon name="lock" size={14} className="dim" /> Enable HTTPS (issues a virtual certificate)
        </span>
      </label>

      <button className="btn btn-primary" disabled={!trimmed} onClick={create}>
        <Icon name="file-plus" size={14} /> Create Website
      </button>

      {error && <p className="wb-error">{error}</p>}
      {created && (
        <div className="wb-success">
          <Icon name="success" size={16} />
          <span>{created.domain} is live.</span>
          <button
            className="btn small"
            onClick={() => computer.launch('browser', { args: { url: `${created.https ? 'https' : 'http'}://${created.domain}` } })}
          >
            Open
          </button>
        </div>
      )}
    </div>
  );
}
