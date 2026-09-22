import { useEffect, useRef, useState } from 'react';
import { Icon } from '../../components/Icon';
import { useComputer } from '../../hooks/useComputer';
import { formatClock } from '../../utils/format';
import type { AppProps } from '../types';
import type { Packet } from '../../core/network/types';
import './network-monitor.css';

type Category = 'ICMP' | 'TCP' | 'UDP' | 'DNS' | 'HTTP' | 'ERROR';
type Filter = 'All' | Category;

interface LogEntry {
  id: number;
  at: number;
  category: Category;
  text: string;
  packet?: Packet;
  detail?: string;
}

const FILTERS: Filter[] = ['All', 'ICMP', 'TCP', 'UDP', 'DNS', 'HTTP', 'ERROR'];

export function NetworkMonitorApp(_props: AppProps) {
  const computer = useComputer();
  const network = computer.network;
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [filter, setFilter] = useState<Filter>('All');
  const [selected, setSelected] = useState<LogEntry | null>(null);
  const nextId = useRef(1);
  const hostnameOf = (id: string) => network.getDevice(id)?.hostname ?? id;

  useEffect(() => {
    const push = (entry: Omit<LogEntry, 'id' | 'at'>) => {
      setEntries((prev) => [...prev.slice(-299), { ...entry, id: nextId.current++, at: computer.clock() }]);
    };

    const unsub = [
      network.on('packet:delivered', ({ result }) => {
        const p = result.packet;
        if (p.protocol === 'TCP' || p.protocol === 'HTTP') return; // surfaced via tcp:connect/http:* instead
        push({
          category: p.protocol as Category,
          text: `${p.protocol}  ${p.sourceIp} → ${p.destinationIp}  ${result.latencyMs}ms`,
          packet: p,
          detail: `delivered in ${result.hops.length} hop(s)`,
        });
      }),
      network.on('packet:dropped', ({ result }) => {
        const p = result.packet;
        push({ category: 'ERROR', text: `${p.protocol}  ${p.sourceIp} → ${p.destinationIp}  ${result.error}`, packet: p, detail: result.errorCode });
      }),
      network.on('dns:query', ({ hostname, resolved, deviceId }) => {
        push({
          category: 'DNS',
          text: resolved ? `DNS   ${hostname} → ${resolved}` : `DNS   ${hostname} → NXDOMAIN`,
          detail: `queried by ${hostnameOf(deviceId)}`,
        });
      }),
      network.on('tcp:connect', ({ fromIp, toIp, port }) => {
        push({ category: 'TCP', text: `TCP   ${fromIp} → ${toIp}:${port}` });
      }),
      network.on('http:request', ({ fromIp, toIp, path }) => {
        push({ category: 'HTTP', text: `HTTP  GET ${path}  (${fromIp} → ${toIp})` });
      }),
      network.on('http:response', ({ toIp, status }) => {
        push({ category: 'HTTP', text: `HTTP  ${status} from ${toIp}` });
      }),
      network.on('firewall:blocked', ({ deviceId, packet, rule }) => {
        push({
          category: 'ERROR',
          text: `FIREWALL  blocked ${packet.protocol} on ${hostnameOf(deviceId)}`,
          packet,
          detail: rule ? `rule: ${rule.action} ${rule.direction} ${rule.protocol}${rule.port ? ` :${rule.port}` : ''}` : undefined,
        });
      }),
      network.on('service:started', ({ deviceId, service }) => {
        push({ category: 'TCP', text: `SERVICE  ${service.name} started on ${hostnameOf(deviceId)}` });
      }),
      network.on('service:stopped', ({ deviceId, service }) => {
        push({ category: 'TCP', text: `SERVICE  ${service.name} stopped on ${hostnameOf(deviceId)}` });
      }),
      network.on('dhcp:lease', ({ deviceId, lease }) => {
        push({ category: 'UDP', text: `DHCP  ${hostnameOf(deviceId)} leased ${lease.ipAddress}` });
      }),
    ];
    return () => unsub.forEach((u) => u());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [network]);

  const visible = entries.filter((e) => filter === 'All' || e.category === filter);

  return (
    <div className="netmon">
      <div className="netmon-filters">
        {FILTERS.map((f) => (
          <button key={f} className={`btn small${filter === f ? ' on' : ''}`} onClick={() => setFilter(f)}>
            {f}
          </button>
        ))}
        <button className="btn small" onClick={() => setEntries([])}>
          <Icon name="trash" size={12} /> Clear
        </button>
      </div>
      <div className="netmon-log">
        {visible.length === 0 && <p className="dim netmon-empty">No traffic yet. Try pinging a host or opening a site in Browser.</p>}
        {visible.map((e) => (
          <div key={e.id} className={`netmon-row cat-${e.category}${selected?.id === e.id ? ' selected' : ''}`} onClick={() => setSelected(e)}>
            <span className="netmon-time">{formatClock(e.at, '24', true)}</span>
            <span className="netmon-tag">{e.category}</span>
            <span className="netmon-text">{e.text}</span>
          </div>
        ))}
      </div>
      {selected && (
        <div className="netmon-inspector">
          <div className="netmon-inspector-head">
            <strong>Packet Inspector</strong>
            <button className="icon-btn" onClick={() => setSelected(null)}>
              <Icon name="close" size={13} />
            </button>
          </div>
          {selected.packet ? (
            <dl className="spec">
              <div>
                <dt>Protocol</dt>
                <dd>{selected.packet.protocol}</dd>
              </div>
              <div>
                <dt>Source</dt>
                <dd>{selected.packet.sourceIp}</dd>
              </div>
              <div>
                <dt>Destination</dt>
                <dd>{selected.packet.destinationIp}</dd>
              </div>
              <div>
                <dt>TTL</dt>
                <dd>{selected.packet.ttl}</dd>
              </div>
              <div>
                <dt>Status</dt>
                <dd>{selected.detail ?? '-'}</dd>
              </div>
            </dl>
          ) : (
            <p className="dim">{selected.detail ?? selected.text}</p>
          )}
        </div>
      )}
    </div>
  );
}
