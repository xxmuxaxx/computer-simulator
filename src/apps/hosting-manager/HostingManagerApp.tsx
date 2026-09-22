import { useState } from 'react';
import { Icon } from '../../components/Icon';
import { dialogs } from '../../store/uiStore';
import type { VirtualComputer } from '../../core/computer/VirtualComputer';
import type { HttpMethod } from '../../core/internet/types';
import { useComputer } from '../../hooks/useComputer';
import { useVersion } from '../../hooks/useObservable';
import type { AppProps } from '../types';
import './hosting-manager.css';

const API_METHODS: HttpMethod[] = ['GET', 'POST', 'PUT', 'DELETE'];

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function HostingManagerApp({ windowId: _windowId }: AppProps) {
  const computer = useComputer();
  useVersion(computer.internet);
  const { internet, network } = computer;
  const sites = internet.hosting.list();
  const [selectedId, setSelectedId] = useState<string | null>(sites[0]?.id ?? null);
  const [editingFiles, setEditingFiles] = useState(false);
  const selected = selectedId ? internet.hosting.get(selectedId) : undefined;
  const domain = selected ? internet.domains.get(selected.domainId) : undefined;
  const server = selected ? network.getDevice(selected.serverId) : undefined;
  const stats = selected ? internet.hosting.statsFor(selected.id) : undefined;
  const records = domain ? internet.dns.list(domain.id) : [];
  const endpoints = selected ? internet.hosting.listApiEndpoints(selected.id) : [];

  const remove = async () => {
    if (!selected || !domain) return;
    const okConfirm = await dialogs.confirm({ title: 'Delete website?', message: `This unbinds ${domain.name} from its server. Files are kept.`, danger: true });
    if (!okConfirm) return;
    computer.attempt(() => internet.hosting.deleteWebsite(selected.id));
    setSelectedId(sites.find((s) => s.id !== selected.id)?.id ?? null);
  };

  const addRecord = async () => {
    if (!domain) return;
    const value = await dialogs.prompt({ title: 'Add A Record', label: `IP address for ${domain.name}`, initial: '192.168.0.101' });
    if (!value) return;
    computer.attempt(() => internet.dns.addRecord(domain.id, 'A', '@', value));
  };

  const addEndpoint = async () => {
    if (!selected) return;
    const method = await dialogs.choose({
      title: 'Add API Endpoint',
      message: 'HTTP method',
      buttons: API_METHODS.map((m) => ({ label: m, value: m })),
    });
    if (!method) return;
    const path = await dialogs.prompt({ title: 'Add API Endpoint', label: 'Path', initial: '/api/status' });
    if (!path) return;
    const statusInput = await dialogs.prompt({ title: 'Add API Endpoint', label: 'Status code', initial: '200' });
    if (!statusInput) return;
    const body = await dialogs.prompt({ title: 'Add API Endpoint', label: 'Response body (JSON)', initial: '{"status":"online"}' });
    if (body === null || body === undefined) return;
    computer.attempt(() =>
      internet.hosting.createApiEndpoint(selected.id, {
        method: method as HttpMethod,
        path,
        status: Number(statusInput) || 200,
        responseBody: body,
        headers: {},
      }),
    );
  };

  return (
    <div className="hostmgr">
      <aside className="hostmgr-list">
        {sites.length === 0 && <p className="dim hostmgr-empty">No websites yet. Use Website Builder to create one.</p>}
        {sites.map((s) => {
          const d = internet.domains.get(s.domainId);
          const srv = network.getDevice(s.serverId);
          return (
            <button key={s.id} className={`hostmgr-item${selectedId === s.id ? ' selected' : ''}`} onClick={() => setSelectedId(s.id)}>
              <Icon name="globe" size={18} />
              <div>
                <strong>{d?.name ?? '?'}</strong>
                <small className="dim">{srv?.hostname ?? '?'}</small>
              </div>
              <span className={`hostmgr-status ${s.enabled ? 'online' : 'offline'}`}>{s.enabled ? 'ONLINE' : 'OFFLINE'}</span>
            </button>
          );
        })}
      </aside>
      <section className="hostmgr-detail">
        {!selected && <p className="dim">Select a website to manage it.</p>}
        {selected && domain && (
          <>
            <header>
              <Icon name="globe" size={22} />
              <h2>{domain.name}</h2>
              <span className={`hostmgr-status ${selected.enabled ? 'online' : 'offline'}`}>{selected.enabled ? 'ONLINE' : 'OFFLINE'}</span>
            </header>
            <div className="hostmgr-meta">
              <div>
                <span className="dim">Server</span>
                <strong>{server?.hostname ?? '?'}</strong>
              </div>
              <div>
                <span className="dim">Root directory</span>
                <strong>{selected.rootDirectory}</strong>
              </div>
              <div>
                <span className="dim">Visibility</span>
                <strong>{selected.visibility === 'private' ? `Private (${selected.allowedNetworks.join(', ') || 'no networks allowed'})` : 'Public'}</strong>
              </div>
            </div>
            <div className="hostmgr-actions">
              <button className="btn small" onClick={() => computer.launch('browser', { args: { url: `http://${domain.name}` } })}>
                <Icon name="globe" size={14} /> Open
              </button>
              <button className="btn small" onClick={() => setEditingFiles(true)}>
                <Icon name="folder" size={14} /> Edit Files
              </button>
              <button className="btn small" onClick={() => computer.attempt(() => internet.hosting.setEnabled(selected.id, !selected.enabled))}>
                {selected.enabled ? <Icon name="pause" size={14} /> : <Icon name="play" size={14} />} {selected.enabled ? 'Disable' : 'Enable'}
              </button>
              <button className="btn small btn-danger" onClick={() => void remove()}>
                <Icon name="trash" size={14} /> Delete
              </button>
            </div>

            <h3>Statistics</h3>
            <div className="hostmgr-stats">
              <div>
                <strong>{stats?.visitors ?? 0}</strong>
                <span className="dim">Visitors</span>
              </div>
              <div>
                <strong>{stats?.pageViews ?? 0}</strong>
                <span className="dim">Page views</span>
              </div>
              <div>
                <strong>{stats?.requests ?? 0}</strong>
                <span className="dim">Requests</span>
              </div>
              <div>
                <strong>{stats?.errors ?? 0}</strong>
                <span className="dim">Errors</span>
              </div>
              <div>
                <strong>{formatBytes(stats?.bandwidthBytes ?? 0)}</strong>
                <span className="dim">Bandwidth</span>
              </div>
            </div>

            <h3>DNS</h3>
            <table className="hostmgr-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Type</th>
                  <th>Value</th>
                </tr>
              </thead>
              <tbody>
                {records.map((r) => (
                  <tr key={r.id}>
                    <td>{r.name === '@' ? domain.name : `${r.name}.${domain.name}`}</td>
                    <td>{r.type}</td>
                    <td>{r.value}</td>
                  </tr>
                ))}
                {records.length === 0 && (
                  <tr>
                    <td colSpan={3} className="dim">
                      No DNS records yet - this site is unreachable until you add one.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            <button className="btn small" onClick={() => void addRecord()}>
              <Icon name="plus" size={14} /> Add A Record
            </button>

            <h3>API Endpoints</h3>
            <table className="hostmgr-table">
              <thead>
                <tr>
                  <th>Method</th>
                  <th>Path</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {endpoints.map((e) => (
                  <tr key={e.id}>
                    <td>{e.method}</td>
                    <td>{e.path}</td>
                    <td>{e.status}</td>
                    <td>
                      <button className="icon-btn" title="Delete" onClick={() => computer.attempt(() => internet.hosting.deleteApiEndpoint(e.id))}>
                        <Icon name="trash" size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
                {endpoints.length === 0 && (
                  <tr>
                    <td colSpan={4} className="dim">
                      No API endpoints yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            <button className="btn small" onClick={() => void addEndpoint()}>
              <Icon name="plus" size={14} /> Add Endpoint
            </button>
          </>
        )}
      </section>
      {editingFiles && selected && (
        <WebsiteFileEditor computer={computer} deviceId={selected.serverId} rootDirectory={selected.rootDirectory} onClose={() => setEditingFiles(false)} />
      )}
    </div>
  );
}

interface WebsiteFileEditorProps {
  computer: VirtualComputer;
  deviceId: string;
  rootDirectory: string;
  onClose: () => void;
}

/** Website content lives on the hosting device's own private file system (not the local
 * computer's), which the general-purpose Files/Text Editor apps can't reach - so this is a
 * small dedicated editor for a website's own files, built on NetworkManager.getDeviceFileSystem. */
function WebsiteFileEditor({ computer, deviceId, rootDirectory, onClose }: WebsiteFileEditorProps) {
  useVersion(computer.network);
  const fs = computer.network.getDeviceFileSystem(deviceId);
  const files = fs && fs.exists(rootDirectory) ? fs.listDirectory(rootDirectory).filter((f) => f.type === 'file') : [];
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [content, setContent] = useState('');
  const [dirty, setDirty] = useState(false);

  const open = (path: string) => {
    if (!fs) return;
    setSelectedPath(path);
    setContent(fs.readFile(path));
    setDirty(false);
  };

  const save = () => {
    if (!fs || !selectedPath) return;
    computer.attempt(() => fs.writeFile(selectedPath, content));
    setDirty(false);
  };

  return (
    <div className="hostmgr-overlay">
      <div className="hostmgr-editor">
        <header>
          <strong>{rootDirectory}</strong>
          <button className="icon-btn" onClick={onClose} title="Close">
            <Icon name="close" size={16} />
          </button>
        </header>
        <div className="hostmgr-editor-body">
          <aside>
            {files.map((f) => (
              <button key={f.path} className={`hostmgr-editor-file${selectedPath === f.path ? ' selected' : ''}`} onClick={() => open(f.path)}>
                {f.name}
              </button>
            ))}
            {files.length === 0 && <p className="dim hostmgr-empty">No files.</p>}
          </aside>
          <div className="hostmgr-editor-main">
            {!selectedPath && <p className="dim">Select a file to edit.</p>}
            {selectedPath && (
              <>
                <textarea
                  className="hostmgr-editor-textarea"
                  value={content}
                  spellCheck={false}
                  onChange={(e) => {
                    setContent(e.target.value);
                    setDirty(true);
                  }}
                />
                <div className="hostmgr-editor-actions">
                  <button className="btn btn-primary small" disabled={!dirty} onClick={save}>
                    <Icon name="save" size={14} /> Save
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
