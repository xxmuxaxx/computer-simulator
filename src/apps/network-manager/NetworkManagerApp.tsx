import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '../../components/Icon';
import { dialogs } from '../../store/uiStore';
import { useComputer } from '../../hooks/useComputer';
import { useVersion } from '../../hooks/useObservable';
import type { VirtualComputer } from '../../core/computer/VirtualComputer';
import type { DeviceType, FirewallRule, NetworkDevice, NetworkInterface } from '../../core/network/types';
import type { AppProps } from '../types';
import './network-manager.css';

const DEVICE_ICON: Record<DeviceType, string> = { computer: 'desktop', server: 'server', router: 'router', switch: 'network' };
const WELL_KNOWN = ['http', 'https', 'ssh', 'ftp', 'dns'];

function layerDevices(devices: NetworkDevice[], connections: ReturnType<VirtualComputer['network']['listConnections']>): NetworkDevice[][] {
  const ifaceOwner = new Map<string, string>();
  for (const d of devices) for (const i of d.interfaces) ifaceOwner.set(i.id, d.id);
  const adjacency = new Map<string, Set<string>>(devices.map((d) => [d.id, new Set<string>()]));
  for (const c of connections) {
    const a = ifaceOwner.get(c.interfaceA);
    const b = ifaceOwner.get(c.interfaceB);
    if (a && b) {
      adjacency.get(a)?.add(b);
      adjacency.get(b)?.add(a);
    }
  }
  const visited = new Set<string>();
  const layers: string[][] = [];
  let frontier = devices.filter((d) => d.type === 'router').map((d) => d.id);
  if (frontier.length === 0 && devices.length) frontier = [devices[0]!.id];
  while (frontier.length) {
    const layer = [...new Set(frontier)].filter((id) => !visited.has(id));
    if (!layer.length) break;
    layer.forEach((id) => visited.add(id));
    layers.push(layer);
    const next = new Set<string>();
    for (const id of layer) for (const n of adjacency.get(id) ?? []) if (!visited.has(n)) next.add(n);
    frontier = [...next];
  }
  const rest = devices.map((d) => d.id).filter((id) => !visited.has(id));
  if (rest.length) layers.push(rest);
  const byId = new Map(devices.map((d) => [d.id, d]));
  return layers.map((layer) => layer.map((id) => byId.get(id)!));
}

function Topology({
  devices,
  connections,
  selectedId,
  onSelect,
}: {
  devices: NetworkDevice[];
  connections: ReturnType<VirtualComputer['network']['listConnections']>;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const contentRef = useRef<HTMLDivElement>(null);
  const nodeRefs = useRef(new Map<string, HTMLDivElement>());
  const [zoom, setZoom] = useState(1);
  const [lines, setLines] = useState<{ id: string; x1: number; y1: number; x2: number; y2: number; up: boolean }[]>([]);
  const layers = useMemo(() => layerDevices(devices, connections), [devices, connections]);
  const ifaceOwner = useMemo(() => {
    const map = new Map<string, string>();
    for (const d of devices) for (const i of d.interfaces) map.set(i.id, d.id);
    return map;
  }, [devices]);

  useLayoutEffect(() => {
    const next = connections
      .map((c) => {
        const aDevice = ifaceOwner.get(c.interfaceA);
        const bDevice = ifaceOwner.get(c.interfaceB);
        const a = aDevice ? nodeRefs.current.get(aDevice) : undefined;
        const b = bDevice ? nodeRefs.current.get(bDevice) : undefined;
        if (!a || !b) return null;
        return {
          id: c.id,
          x1: a.offsetLeft + a.offsetWidth / 2,
          y1: a.offsetTop + a.offsetHeight / 2,
          x2: b.offsetLeft + b.offsetWidth / 2,
          y2: b.offsetTop + b.offsetHeight / 2,
          up: c.up,
        };
      })
      .filter((l): l is NonNullable<typeof l> => l !== null);
    setLines(next);
  }, [connections, ifaceOwner, layers]);

  return (
    <div className="netmgr-canvas">
      <div className="netmgr-zoom">
        <button className="icon-btn" title="Zoom out" onClick={() => setZoom((z) => Math.max(0.5, z - 0.15))}>
          <Icon name="minus" size={14} />
        </button>
        <span>{Math.round(zoom * 100)}%</span>
        <button className="icon-btn" title="Zoom in" onClick={() => setZoom((z) => Math.min(2, z + 0.15))}>
          <Icon name="plus" size={14} />
        </button>
        <button className="icon-btn" title="Reset zoom" onClick={() => setZoom(1)}>
          <Icon name="refresh" size={14} />
        </button>
      </div>
      <div className="netmgr-content" ref={contentRef} style={{ transform: `scale(${zoom})` }}>
        <svg className="netmgr-lines">
          {lines.map((l) => (
            <line key={l.id} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} className={l.up ? 'link-up' : 'link-down'} />
          ))}
        </svg>
        {layers.map((layer, i) => (
          <div className="netmgr-row" key={i}>
            {layer.map((d) => (
              <div
                key={d.id}
                ref={(el) => {
                  if (el) nodeRefs.current.set(d.id, el);
                  else nodeRefs.current.delete(d.id);
                }}
                className={`net-node${selectedId === d.id ? ' selected' : ''}`}
                onClick={() => onSelect(d.id)}
              >
                <Icon name={DEVICE_ICON[d.type]} size={22} />
                <strong>{d.hostname}</strong>
                <small>{d.interfaces.find((i) => i.ipAddress)?.ipAddress ?? 'no address'}</small>
                {d.firewall.enabled && <Icon name="shield-alert" size={12} className="net-node-badge" />}
              </div>
            ))}
          </div>
        ))}
        {devices.length === 0 && <p className="dim">No devices yet. Use "Add Device" to create one.</p>}
      </div>
    </div>
  );
}

function InterfaceRow({ computer, device, iface }: { computer: VirtualComputer; device: NetworkDevice; iface: NetworkInterface }) {
  const network = computer.network;
  const [editing, setEditing] = useState(false);
  const [ip, setIp] = useState(iface.ipAddress ?? '');
  const [mask, setMask] = useState(iface.subnetMask ?? '255.255.255.0');
  const [gateway, setGateway] = useState(iface.gateway ?? '');

  const save = () => {
    computer.attempt(() => {
      network.configureInterface(device.id, iface.id, {
        ipAddress: ip || undefined,
        subnetMask: mask || undefined,
        gateway: gateway || undefined,
      });
      computer.notifications.success('Interface updated', `${device.hostname} / ${iface.name}`);
    });
    setEditing(false);
  };

  return (
    <div className="iface-card">
      <div className="iface-head">
        <strong>{iface.name}</strong>
        <button
          className={`btn btn-ghost small${iface.status === 'up' ? ' on' : ''}`}
          onClick={() => computer.attempt(() => network.setInterfaceStatus(device.id, iface.id, iface.status === 'up' ? 'down' : 'up'))}
        >
          {iface.status.toUpperCase()}
        </button>
      </div>
      <div className="iface-body">
        <div>
          <dt>MAC</dt>
          <dd>{iface.macAddress}</dd>
        </div>
        {!editing ? (
          <>
            <div>
              <dt>IP</dt>
              <dd>{iface.ipAddress ?? '-'}</dd>
            </div>
            <div>
              <dt>Subnet</dt>
              <dd>{iface.subnetMask ?? '-'}</dd>
            </div>
            <div>
              <dt>Gateway</dt>
              <dd>{iface.gateway ?? '-'}</dd>
            </div>
            <div>
              <dt>DNS</dt>
              <dd>{iface.dnsServers.join(', ') || '-'}</dd>
            </div>
            {iface.dhcp && (
              <div>
                <dt>Source</dt>
                <dd>DHCP</dd>
              </div>
            )}
          </>
        ) : (
          <div className="iface-form">
            <label>
              IP
              <input className="input" value={ip} onChange={(e) => setIp(e.target.value)} placeholder="192.168.0.10" />
            </label>
            <label>
              Subnet mask
              <input className="input" value={mask} onChange={(e) => setMask(e.target.value)} placeholder="255.255.255.0" />
            </label>
            <label>
              Gateway
              <input className="input" value={gateway} onChange={(e) => setGateway(e.target.value)} placeholder="192.168.0.1" />
            </label>
          </div>
        )}
      </div>
      <div className="iface-actions">
        {editing ? (
          <>
            <button className="btn btn-primary small" onClick={save}>
              Save
            </button>
            <button className="btn small" onClick={() => setEditing(false)}>
              Cancel
            </button>
          </>
        ) : (
          <>
            <button className="btn small" onClick={() => setEditing(true)}>
              Configure
            </button>
            <button
              className="btn small"
              onClick={() =>
                computer.attempt(() => {
                  const lease = network.requestDhcp(device.id, iface.id);
                  computer.notifications.success('DHCP lease obtained', lease.ipAddress);
                })
              }
            >
              Request DHCP
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function FirewallPanel({ computer, device }: { computer: VirtualComputer; device: NetworkDevice }) {
  const network = computer.network;
  const [direction, setDirection] = useState<FirewallRule['direction']>('inbound');
  const [protocol, setProtocol] = useState<FirewallRule['protocol']>('TCP');
  const [port, setPort] = useState('');
  const [action, setAction] = useState<FirewallRule['action']>('deny');

  const addRule = () => {
    computer.attempt(() =>
      network.addFirewallRule(device.id, {
        direction,
        protocol,
        port: port.trim() ? Number(port) : undefined,
        action,
      }),
    );
    setPort('');
  };

  return (
    <div className="panel-section">
      <div className="panel-section-head">
        <strong>Firewall</strong>
        <label className="switch">
          <input type="checkbox" checked={device.firewall.enabled} onChange={(e) => network.setFirewallEnabled(device.id, e.target.checked)} />
          <span>Enabled</span>
        </label>
      </div>
      <div className="rule-list">
        {device.firewall.rules.map((r, i) => (
          <div key={r.id} className={`rule-row ${r.action}`}>
            <span className="rule-action">{r.action.toUpperCase()}</span>
            <span>{r.direction}</span>
            <span>{r.protocol}</span>
            <span>{r.port ?? 'any port'}</span>
            <span>{r.sourceIp ?? 'any source'}</span>
            <div className="rule-controls">
              <button className="icon-btn" disabled={i === 0} onClick={() => network.moveFirewallRule(device.id, r.id, 'up')} title="Move up">
                <Icon name="up" size={12} />
              </button>
              <button className="icon-btn" onClick={() => network.removeFirewallRule(device.id, r.id)} title="Remove rule">
                <Icon name="close" size={12} />
              </button>
            </div>
          </div>
        ))}
        {device.firewall.rules.length === 0 && <p className="dim">No rules - everything is allowed.</p>}
      </div>
      <div className="rule-form">
        <select className="input" value={direction} onChange={(e) => setDirection(e.target.value as FirewallRule['direction'])}>
          <option value="inbound">Inbound</option>
          <option value="outbound">Outbound</option>
        </select>
        <select className="input" value={protocol} onChange={(e) => setProtocol(e.target.value as FirewallRule['protocol'])}>
          <option value="TCP">TCP</option>
          <option value="UDP">UDP</option>
          <option value="ICMP">ICMP</option>
          <option value="ANY">ANY</option>
        </select>
        <input className="input" placeholder="Port (optional)" value={port} onChange={(e) => setPort(e.target.value)} />
        <select className="input" value={action} onChange={(e) => setAction(e.target.value as FirewallRule['action'])}>
          <option value="deny">Deny</option>
          <option value="allow">Allow</option>
        </select>
        <button className="btn btn-primary small" onClick={addRule}>
          Add Rule
        </button>
      </div>
    </div>
  );
}

function ServicesPanel({ computer, device }: { computer: VirtualComputer; device: NetworkDevice }) {
  const network = computer.network;
  return (
    <div className="panel-section">
      <strong>Services</strong>
      <div className="service-list">
        {device.services.map((s) => (
          <div key={s.id} className="service-row">
            <span>{s.name}</span>
            <span className="dim">:{s.port}</span>
            <span className={`svc-status ${s.status}`}>{s.status === 'running' ? 'RUNNING' : 'STOPPED'}</span>
            <button
              className="btn small"
              onClick={() =>
                computer.attempt(() => (s.status === 'running' ? network.stopService(device.id, s.id) : network.startService(device.id, s.name)))
              }
            >
              {s.status === 'running' ? 'Stop' : 'Start'}
            </button>
          </div>
        ))}
        {device.services.length === 0 && <p className="dim">No services configured.</p>}
      </div>
      <div className="service-add">
        {WELL_KNOWN.filter((name) => !device.services.some((s) => s.name.toLowerCase() === name)).map((name) => (
          <button key={name} className="btn small" onClick={() => computer.attempt(() => network.startService(device.id, name))}>
            + {name.toUpperCase()}
          </button>
        ))}
      </div>
    </div>
  );
}

function RoutingPanel({ computer, device }: { computer: VirtualComputer; device: NetworkDevice }) {
  const network = computer.network;
  const [destination, setDestination] = useState('');
  const [gateway, setGateway] = useState('');
  const [interfaceId, setInterfaceId] = useState(device.interfaces[0]?.id ?? '');

  return (
    <div className="panel-section">
      <strong>Routing table</strong>
      <div className="route-list">
        <div className="route-row route-head">
          <span>Destination</span>
          <span>Gateway</span>
          <span>Interface</span>
          <span />
        </div>
        {(device.routingTable ?? []).map((r) => (
          <div key={r.id} className="route-row">
            <span>{r.destination}</span>
            <span>{r.gateway}</span>
            <span>{device.interfaces.find((i) => i.id === r.interfaceId)?.name ?? '?'}</span>
            <button className="icon-btn" onClick={() => network.removeRoute(device.id, r.id)} title="Remove route">
              <Icon name="close" size={12} />
            </button>
          </div>
        ))}
      </div>
      <div className="rule-form">
        <input className="input" placeholder="0.0.0.0/0" value={destination} onChange={(e) => setDestination(e.target.value)} />
        <input className="input" placeholder="gateway IP" value={gateway} onChange={(e) => setGateway(e.target.value)} />
        <select className="input" value={interfaceId} onChange={(e) => setInterfaceId(e.target.value)}>
          {device.interfaces.map((i) => (
            <option key={i.id} value={i.id}>
              {i.name}
            </option>
          ))}
        </select>
        <button
          className="btn btn-primary small"
          onClick={() => {
            computer.attempt(() => network.addRoute(device.id, { destination, gateway: gateway || 'connected', interfaceId }));
            setDestination('');
            setGateway('');
          }}
        >
          Add Route
        </button>
      </div>
    </div>
  );
}

function DeviceInspector({ computer, device, onRemoved }: { computer: VirtualComputer; device: NetworkDevice; onRemoved: () => void }) {
  const network = computer.network;
  const others = network.listDevices().filter((d) => d.id !== device.id);
  const connections = network.listConnections();
  const ifaceOwner = new Map<string, string>();
  for (const d of network.listDevices()) for (const i of d.interfaces) ifaceOwner.set(i.id, d.id);
  const myConnections = connections
    .map((c) => {
      const aId = ifaceOwner.get(c.interfaceA);
      const bId = ifaceOwner.get(c.interfaceB);
      if (aId === device.id) return { conn: c, peerId: bId, myIface: c.interfaceA };
      if (bId === device.id) return { conn: c, peerId: aId, myIface: c.interfaceB };
      return null;
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  return (
    <div className="netmgr-inspector">
      <div className="panel-section">
        <div className="panel-section-head">
          <Icon name={DEVICE_ICON[device.type]} size={20} />
          <strong>{device.hostname}</strong>
        </div>
        <dl className="spec">
          <div>
            <dt>Type</dt>
            <dd>{device.type}</dd>
          </div>
          <div>
            <dt>Packets</dt>
            <dd>
              sent {device.stats.packetsSent} / recv {device.stats.packetsReceived}
            </dd>
          </div>
          <div>
            <dt>Dropped / Blocked</dt>
            <dd>
              {device.stats.packetsDropped} / {device.stats.packetsBlocked}
            </dd>
          </div>
          <div>
            <dt>Avg latency</dt>
            <dd>{device.stats.averageLatencyMs} ms</dd>
          </div>
        </dl>
        {!device.isLocal && (
          <button
            className="btn btn-danger small"
            onClick={async () => {
              const okConfirm = await dialogs.confirm({ title: 'Remove device?', message: `Remove ${device.hostname} and its connections?`, danger: true });
              if (okConfirm) {
                computer.attempt(() => network.removeDevice(device.id));
                onRemoved();
              }
            }}
          >
            Remove Device
          </button>
        )}
      </div>

      <div className="panel-section">
        <strong>Connections</strong>
        <div className="conn-list">
          {myConnections.map(({ conn, peerId, myIface }) => {
            const peer = peerId ? network.getDevice(peerId) : undefined;
            return (
              <div key={conn.id} className="conn-row">
                <span>{peer?.hostname ?? '?'}</span>
                <span className="dim">{device.interfaces.find((i) => i.id === myIface)?.name}</span>
                <button className={`btn small${conn.up ? ' on' : ''}`} onClick={() => network.setConnectionUp(conn.id, !conn.up)}>
                  {conn.up ? 'Up' : 'Down'}
                </button>
                <button className="icon-btn" title="Disconnect" onClick={() => network.disconnect(conn.id)}>
                  <Icon name="unplug" size={13} />
                </button>
              </div>
            );
          })}
          {myConnections.length === 0 && <p className="dim">Not connected to anything.</p>}
        </div>
        {others.length > 0 && (
          <ConnectPicker computer={computer} device={device} others={others} />
        )}
      </div>

      <div className="panel-section">
        <strong>Interfaces</strong>
        {device.interfaces.map((i) => (
          <InterfaceRow key={i.id} computer={computer} device={device} iface={i} />
        ))}
        <button className="btn small" onClick={() => computer.attempt(() => network.addInterface(device.id))}>
          + Add Interface
        </button>
      </div>

      {device.type === 'router' && <RoutingPanel computer={computer} device={device} />}

      {(device.type === 'computer' || device.type === 'server') && <ServicesPanel computer={computer} device={device} />}

      <FirewallPanel computer={computer} device={device} />

      {device.type === 'switch' && (
        <div className="panel-section">
          <strong>MAC address table</strong>
          <div className="route-list">
            <div className="route-row route-head">
              <span>MAC</span>
              <span>Port</span>
            </div>
            {network.getMacTable(device.id).map((e, i) => (
              <div className="route-row" key={i}>
                <span>{e.mac}</span>
                <span>{e.port}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ConnectPicker({ computer, device, others }: { computer: VirtualComputer; device: NetworkDevice; others: NetworkDevice[] }) {
  const [target, setTarget] = useState(others[0]?.id ?? '');
  return (
    <div className="rule-form">
      <select className="input" value={target} onChange={(e) => setTarget(e.target.value)}>
        {others.map((d) => (
          <option key={d.id} value={d.id}>
            {d.hostname}
          </option>
        ))}
      </select>
      <button className="btn small" onClick={() => target && computer.attempt(() => computer.network.connectDevices(device.id, target))}>
        Connect
      </button>
    </div>
  );
}

export function NetworkManagerApp(_props: AppProps) {
  const computer = useComputer();
  useVersion(computer.network);
  const network = computer.network;
  const devices = network.listDevices();
  const connections = network.listConnections();
  const [selectedId, setSelectedId] = useState<string | null>(network.localDeviceId);
  const selected = selectedId ? network.getDevice(selectedId) : undefined;

  const totalPackets = devices.reduce((sum, d) => sum + d.stats.packetsSent, 0);
  const totalErrors = devices.reduce((sum, d) => sum + d.stats.packetsDropped + d.stats.packetsBlocked, 0);

  const addDevice = async () => {
    const type = await dialogs.choose({
      title: 'Add Device',
      message: 'What kind of device do you want to add?',
      buttons: [
        { label: 'Computer', value: 'computer' },
        { label: 'Server', value: 'server' },
        { label: 'Router', value: 'router' },
        { label: 'Switch', value: 'switch' },
      ],
    });
    if (!type) return;
    const hostname = await dialogs.prompt({ title: 'Add Device', label: 'Hostname', initial: `${type}${devices.length}.local` });
    if (!hostname) return;
    computer.attempt(() => {
      const device = network.createDevice({ hostname, type: type as DeviceType });
      setSelectedId(device.id);
    });
  };

  return (
    <div className="netmgr">
      <div className="netmgr-toolbar">
        <button className="btn" onClick={() => void addDevice()}>
          <Icon name="plus" size={14} /> Add Device
        </button>
        <button className="btn" onClick={() => void simulateFailure(network, connections)}>
          <Icon name="shield-alert" size={14} /> Simulate Failure
        </button>
      </div>
      <div className="netmgr-body">
        <Topology devices={devices} connections={connections} selectedId={selectedId} onSelect={setSelectedId} />
        {selected && <DeviceInspector computer={computer} device={selected} onRemoved={() => setSelectedId(network.localDeviceId)} />}
      </div>
      <div className="netmgr-footer">
        <span>Devices: {devices.length}</span>
        <span>Packets: {totalPackets}</span>
        <span>Errors: {totalErrors}</span>
      </div>
    </div>
  );
}

async function simulateFailure(network: VirtualComputer['network'], connections: ReturnType<VirtualComputer['network']['listConnections']>) {
  if (connections.length === 0) return;
  const value = await dialogs.choose({
    title: 'Simulate Network Failure',
    message: 'Pick a connection to toggle. Toggling it again restores the link.',
    buttons: connections.map((c) => ({ label: `${c.id} (${c.up ? 'up' : 'down'})`, value: c.id })),
  });
  if (value) network.setConnectionUp(value, !network.listConnections().find((c) => c.id === value)?.up);
}
