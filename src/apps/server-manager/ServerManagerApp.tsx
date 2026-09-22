import { useState } from 'react';
import { Icon } from '../../components/Icon';
import { useComputer } from '../../hooks/useComputer';
import { useVersion } from '../../hooks/useObservable';
import type { AppProps } from '../types';
import './server-manager.css';

const DEVICE_ICON: Record<string, string> = { computer: 'desktop', server: 'server', router: 'router', switch: 'network' };
const WELL_KNOWN = ['http', 'https', 'ssh', 'ftp', 'dns'];

export function ServerManagerApp(_props: AppProps) {
  const computer = useComputer();
  useVersion(computer.network);
  const network = computer.network;
  const devices = network.listDevices().filter((d) => d.type === 'computer' || d.type === 'server');
  const [selectedId, setSelectedId] = useState<string | null>(devices.find((d) => d.type === 'server')?.id ?? devices[0]?.id ?? null);
  const selected = selectedId ? network.getDevice(selectedId) : undefined;

  return (
    <div className="srvmgr">
      <aside className="srvmgr-list">
        {devices.map((d) => (
          <button key={d.id} className={`srvmgr-item${selectedId === d.id ? ' selected' : ''}`} onClick={() => setSelectedId(d.id)}>
            <Icon name={DEVICE_ICON[d.type]!} size={18} />
            <div>
              <strong>{d.hostname}</strong>
              <small className="dim">{d.interfaces.find((i) => i.ipAddress)?.ipAddress ?? 'no address'}</small>
            </div>
            <span className="srvmgr-count">{d.services.filter((s) => s.status === 'running').length}</span>
          </button>
        ))}
      </aside>
      <section className="srvmgr-detail">
        {!selected && <p className="dim">Select a device to manage its services.</p>}
        {selected && (
          <>
            <header>
              <Icon name={DEVICE_ICON[selected.type]!} size={22} />
              <h2>{selected.hostname}</h2>
            </header>
            <table className="srvmgr-table">
              <thead>
                <tr>
                  <th>Service</th>
                  <th>Port</th>
                  <th>Protocol</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {selected.services.map((s) => (
                  <tr key={s.id}>
                    <td>{s.name}</td>
                    <td>{s.port}</td>
                    <td>{s.protocol}</td>
                    <td className={s.status}>{s.status === 'running' ? 'RUNNING' : 'STOPPED'}</td>
                    <td className="srvmgr-actions">
                      <button
                        className="btn small"
                        onClick={() =>
                          computer.attempt(() => (s.status === 'running' ? network.stopService(selected.id, s.id) : network.startService(selected.id, s.name)))
                        }
                      >
                        {s.status === 'running' ? 'Stop' : 'Start'}
                      </button>
                      <button
                        className="btn small"
                        disabled={s.status !== 'running'}
                        onClick={() =>
                          computer.attempt(() => {
                            network.stopService(selected.id, s.id);
                            network.startService(selected.id, s.name);
                          })
                        }
                      >
                        Restart
                      </button>
                    </td>
                  </tr>
                ))}
                {selected.services.length === 0 && (
                  <tr>
                    <td colSpan={5} className="dim">
                      No services configured.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            <div className="srvmgr-add">
              <span className="dim">Add service:</span>
              {WELL_KNOWN.filter((name) => !selected.services.some((s) => s.name.toLowerCase() === name)).map((name) => (
                <button key={name} className="btn small" onClick={() => computer.attempt(() => network.startService(selected.id, name))}>
                  + {name.toUpperCase()}
                </button>
              ))}
            </div>
          </>
        )}
      </section>
    </div>
  );
}
