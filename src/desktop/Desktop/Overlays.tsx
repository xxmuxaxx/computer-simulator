import { useEffect } from 'react';
import { appRegistry } from '../../apps';
import { AppIcon, Icon } from '../../components/Icon';
import { useComputer } from '../../hooks/useComputer';
import { useNotifications, useSimulation, useVersion } from '../../hooks/useObservable';
import { useUIStore } from '../../store/uiStore';
import { formatMB } from '../../utils/format';
import type { Notification } from '../../core/notifications/NotificationCenter';

const TOAST_ICON: Record<Notification['type'], string> = {
  success: 'success',
  info: 'info',
  warning: 'warning',
  error: 'error',
};

function Toast({ n }: { n: Notification }) {
  const computer = useComputer();
  useEffect(() => {
    const t = setTimeout(() => computer.notifications.dismiss(n.id), n.timeoutMs);
    return () => clearTimeout(t);
  }, [computer, n.id, n.timeoutMs]);
  return (
    <div className={`toast toast-${n.type}`} role={n.type === 'error' ? 'alert' : 'status'}>
      <Icon name={TOAST_ICON[n.type]} size={18} />
      <div className="toast-text">
        <strong>{n.title}</strong>
        {n.message && <span>{n.message}</span>}
      </div>
      <button className="icon-btn" aria-label="Dismiss" onClick={() => computer.notifications.dismiss(n.id)}>
        <Icon name="close" size={14} />
      </button>
    </div>
  );
}

export function Toasts() {
  const notifications = useNotifications();
  return (
    <div className="toasts" aria-live="polite">
      {notifications.slice(-5).map((n) => (
        <Toast key={n.id} n={n} />
      ))}
    </div>
  );
}

/** Live numbers about the virtual computer, for debugging the simulation. */
export function DebugPanel() {
  const computer = useComputer();
  useSimulation();
  useVersion(computer.fileSystem);
  const { cpu, memory, disk, processManager, windowManager, fileSystem } = computer;
  const gb = (n: number) => (n / 1024 ** 3).toFixed(1);
  const rows: [string, string][] = [
    ['CPU', `${Math.round(cpu.load)}%  (${cpu.frequencyMHz} MHz)`],
    ['RAM', `${(memory.usedMB / 1024).toFixed(1)} GB / ${memory.totalMB / 1024} GB`],
    ['Disk', `${gb(disk.usedBytes)} GB / ${gb(disk.totalBytes)} GB`],
    ['Processes', String(processManager.count())],
    ['Windows', String(windowManager.count())],
    ['Files', String(fileSystem.countFiles())],
    ['Nodes', String(fileSystem.countNodes())],
    ['Uptime', `${Math.floor(computer.uptimeMs() / 1000)} s`],
  ];
  return (
    <aside className="debug-panel" aria-label="Developer panel">
      <div className="debug-head">
        <strong>Virtual Computer</strong>
        <button className="icon-btn" aria-label="Hide developer panel" onClick={() => computer.settings.update({ showDebugPanel: false })}>
          <Icon name="close" size={14} />
        </button>
      </div>
      <dl>
        {rows.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      <div className="debug-foot">Free RAM: {formatMB(memory.freeMB)}</div>
    </aside>
  );
}

/** Alt+Tab overlay listing windows in most-recently-used order. */
export function WindowSwitcher() {
  const computer = useComputer();
  const switcher = useUIStore((s) => s.switcher);
  useVersion(computer.windowManager);
  if (!switcher.open) return null;
  const list = computer.windowManager.getSwitcherOrder();
  return (
    <div className="switcher" role="listbox" aria-label="Switch windows">
      {list.map((w, i) => (
        <div key={w.id} role="option" aria-selected={i === switcher.index} className={`switcher-item${i === switcher.index ? ' selected' : ''}`}>
          <AppIcon name={appRegistry.find(w.appId)?.icon ?? 'file'} size={44} />
          <span>{w.title}</span>
        </div>
      ))}
    </div>
  );
}
