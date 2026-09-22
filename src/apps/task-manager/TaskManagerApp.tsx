import { useMemo, useState } from 'react';
import { Icon } from '../../components/Icon';
import { Meter, Sparkline } from '../../components/Meter';
import { showContextMenu } from '../../components/ContextMenu';
import type { Process } from '../../core/process/ProcessManager';
import { useComputer } from '../../hooks/useComputer';
import { useSimulation } from '../../hooks/useObservable';
import { useWindowCommands } from '../../hooks/windowCommands';
import { formatBytes, formatDateTime, formatMB, formatUptime } from '../../utils/format';
import type { AppProps } from '../types';
import './task-manager.css';

type SortKey = 'pid' | 'name' | 'cpuUsage' | 'memoryUsage' | 'status';

const COLUMNS: { key: SortKey; label: string; className: string }[] = [
  { key: 'pid', label: 'PID', className: 'c-pid' },
  { key: 'name', label: 'Name', className: 'c-name' },
  { key: 'cpuUsage', label: 'CPU', className: 'c-cpu' },
  { key: 'memoryUsage', label: 'Memory', className: 'c-mem' },
  { key: 'status', label: 'Status', className: 'c-status' },
];

export function TaskManagerApp({ windowId }: AppProps) {
  const computer = useComputer();
  useSimulation();
  const { cpu, memory, disk, processManager } = computer;
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'cpuUsage', dir: -1 });
  const [selectedPid, setSelectedPid] = useState<number | null>(null);

  const processes = processManager.list();
  const rows = useMemo(() => {
    return [...processes].sort((a, b) => {
      const av = a[sort.key];
      const bv = b[sort.key];
      const r = typeof av === 'string' ? av.localeCompare(bv as string) : (av as number) - (bv as number);
      return (r !== 0 ? r : a.pid - b.pid) * sort.dir;
    });
    // processes is a fresh array every tick
  }, [processes, sort]);

  const selected = selectedPid !== null ? processManager.get(selectedPid) : undefined;
  const history = computer.metricsHistory;
  const memPct = memory.usagePercent;

  const endProcess = (p: Process) => {
    computer.attempt(() => computer.killProcess(p.pid));
    if (!processManager.has(p.pid)) {
      computer.notifications.success("Process ended", `${p.name} (PID ${p.pid})`);
      if (selectedPid === p.pid) setSelectedPid(null);
    }
  };

  const toggleSuspend = (p: Process) => {
    computer.attempt(() => (p.status === 'stopped' ? processManager.resume(p.pid) : processManager.stop(p.pid)));
  };

  useWindowCommands(windowId, {
    delete: () => selected && endProcess(selected),
  });

  const windowsOf = selected ? computer.windowManager.findByPid(selected.pid) : [];

  return (
    <div className="taskman">
      <div className="perf">
        <section className="card">
          <header>
            <span>CPU</span>
            <strong>{Math.round(cpu.load)}%</strong>
          </header>
          <Meter value={cpu.load} label="CPU usage" />
          <Sparkline values={history.cpu} />
          <div className="cores">
            {cpu.coreLoads.map((l, i) => (
              <div key={i} className="core" title={`Core ${i}: ${l.toFixed(0)}%`}>
                <div className="core-fill" style={{ height: `${l}%` }} />
              </div>
            ))}
          </div>
          <footer>
            {cpu.cores} cores &middot; {cpu.frequencyMHz} MHz
          </footer>
        </section>
        <section className="card">
          <header>
            <span>Memory</span>
            <strong>{Math.round(memPct)}%</strong>
          </header>
          <Meter value={memPct} label="Memory usage" />
          <Sparkline values={history.memory} />
          <footer>
            {(memory.usedMB / 1024).toFixed(2)} GB / {(memory.totalMB / 1024).toFixed(0)} GB
          </footer>
        </section>
        <section className="card">
          <header>
            <span>Disk</span>
            <strong>{Math.round(disk.usagePercent)}%</strong>
          </header>
          <Meter value={disk.usagePercent} label="Disk usage" tone="accent" />
          <div className="disk-info">
            <span>Used {formatBytes(disk.usedBytes)}</span>
            <span>Free {formatBytes(disk.freeBytes)}</span>
          </div>
          <footer>{formatBytes(disk.totalBytes)} virtual disk</footer>
        </section>
      </div>

      <div className="proc-area">
        <div className="proc-table" role="table" aria-label="Processes">
          <div className="proc-head" role="row">
            {COLUMNS.map((c) => (
              <button
                key={c.key}
                className={`pcell ${c.className}`}
                onClick={() => setSort((s) => (s.key === c.key ? { key: c.key, dir: s.dir === 1 ? -1 : 1 } : { key: c.key, dir: c.key === 'name' || c.key === 'status' ? 1 : -1 }))}
                aria-sort={sort.key === c.key ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}
              >
                {c.label}
                {sort.key === c.key && <Icon name="chevron" size={12} className={sort.dir === 1 ? 'sort-asc' : 'sort-desc'} />}
              </button>
            ))}
          </div>
          <div className="proc-body">
            {rows.map((p) => (
              <div
                key={p.pid}
                role="row"
                aria-selected={p.pid === selectedPid}
                className={`prow${p.pid === selectedPid ? ' selected' : ''}${p.status !== 'running' ? ' dim-row' : ''}`}
                onClick={() => setSelectedPid(p.pid)}
                onContextMenu={(e) => {
                  setSelectedPid(p.pid);
                  showContextMenu(e, [
                    { label: 'End Process', icon: 'close', danger: true, disabled: p.protected, onClick: () => endProcess(p) },
                    { label: p.status === 'stopped' ? 'Resume' : 'Suspend', icon: p.status === 'stopped' ? 'play' : 'pause', disabled: p.protected, onClick: () => toggleSuspend(p) },
                  ]);
                }}
              >
                <span className="pcell c-pid">{p.pid}</span>
                <span className="pcell c-name">{p.name}</span>
                <span className="pcell c-cpu">{p.cpuUsage.toFixed(1)}%</span>
                <span className="pcell c-mem">{formatMB(p.memoryUsage)}</span>
                <span className={`pcell c-status st-${p.status}`}>{p.status}</span>
              </div>
            ))}
          </div>
        </div>

        <aside className="proc-detail">
          {selected ? (
            <>
              <h3>{selected.name}</h3>
              <dl>
                <div><dt>PID</dt><dd>{selected.pid}</dd></div>
                <div><dt>Type</dt><dd>{selected.kind}</dd></div>
                <div><dt>Status</dt><dd>{selected.status}</dd></div>
                <div><dt>CPU</dt><dd>{selected.cpuUsage.toFixed(1)}%</dd></div>
                <div><dt>Memory</dt><dd>{formatMB(selected.memoryUsage)}</dd></div>
                <div><dt>Started</dt><dd>{formatDateTime(selected.startedAt)}</dd></div>
                <div><dt>Running for</dt><dd>{formatUptime(computer.clock() - selected.startedAt)}</dd></div>
                {selected.appId && <div><dt>Application</dt><dd>{selected.appId}</dd></div>}
                {windowsOf.length > 0 && <div><dt>Window</dt><dd>{windowsOf.map((w) => w.title).join(', ')}</dd></div>}
              </dl>
              <div className="detail-actions">
                <button className="btn btn-danger" disabled={selected.protected} onClick={() => endProcess(selected)}>
                  End Process
                </button>
                <button className="btn" disabled={selected.protected} onClick={() => toggleSuspend(selected)}>
                  {selected.status === 'stopped' ? 'Resume' : 'Suspend'}
                </button>
              </div>
              {selected.protected && <p className="hint">System processes are protected and cannot be ended.</p>}
            </>
          ) : (
            <p className="hint">Select a process to see its details.</p>
          )}
        </aside>
      </div>
    </div>
  );
}
