import { useEffect, useState } from 'react';
import { appRegistry } from '../../apps';
import { AppIcon, Icon } from '../../components/Icon';
import { useComputer } from '../../hooks/useComputer';
import { useSettings, useSimulation, useVersion, useWindows } from '../../hooks/useObservable';
import { useUIStore } from '../../store/uiStore';
import { formatClock, formatMB } from '../../utils/format';
import { launchApp } from '../actions';

export function TopBar() {
  const computer = useComputer();
  const settings = useSettings();
  const [now, setNow] = useState(() => computer.clock());
  useVersion(computer.windowManager);
  useEffect(() => {
    const id = setInterval(() => setNow(computer.clock()), 1000);
    return () => clearInterval(id);
  }, [computer]);

  const active = computer.windowManager.activeId ? computer.windowManager.get(computer.windowManager.activeId) : undefined;
  return (
    <header className="topbar">
      <div className="topbar-left">
        <Icon name="terminal" size={14} />
        <strong>Computer Simulator</strong>
      </div>
      <div className="topbar-center">{active?.title ?? ''}</div>
      <div className="topbar-right">
        <span className="dim">{settings.userName}@{settings.computerName}</span>
        <time className="clock" dateTime={new Date(now).toISOString()} title={new Date(now).toLocaleDateString(undefined, { dateStyle: 'full' })}>
          {formatClock(now, settings.clockFormat)}
        </time>
      </div>
    </header>
  );
}

export function Taskbar() {
  const computer = useComputer();
  const windows = useWindows();
  const settings = useSettings();
  const launcherOpen = useUIStore((s) => s.launcherOpen);
  const toggleLauncher = useUIStore((s) => s.toggleLauncher);
  useSimulation();
  const activeId = computer.windowManager.activeId;
  const cpu = computer.cpu.load;
  const memUsed = computer.memory.usedMB;

  return (
    <footer className="taskbar">
      <button
        className={`start-btn${launcherOpen ? ' active' : ''}`}
        onClick={toggleLauncher}
        onPointerDown={(e) => e.stopPropagation()}
        aria-label="Application launcher"
        aria-expanded={launcherOpen}
        title="Applications"
      >
        <Icon name="grid" size={18} />
        <span>Apps</span>
      </button>

      <div className="task-list">
        {windows.map((w) => {
          const def = appRegistry.find(w.appId);
          return (
            <button
              key={w.id}
              className={`task${w.id === activeId ? ' active' : ''}${w.minimized ? ' minimized' : ''}`}
              onClick={() => computer.windowManager.toggleFromTaskbar(w.id)}
              title={w.title}
            >
              <AppIcon name={def?.icon ?? 'file'} size={20} />
              <span className="task-title">{w.title}</span>
            </button>
          );
        })}
      </div>

      <div className="status">
        <span className="status-item" title="System status">
          <span className="dot dot-ok" /> System ready
        </span>
        <span className="status-item" title="CPU load">
          <Icon name="cpu" size={14} /> CPU {Math.round(cpu)}%
        </span>
        <span className="status-item" title="Memory in use">
          <Icon name="memory" size={14} /> RAM {formatMB(memUsed).replace(' GB', '')} / {computer.memory.totalMB / 1024} GB
        </span>
        <button
          className={`icon-btn${settings.showDebugPanel ? ' on' : ''}`}
          title="Developer panel (Ctrl+Shift+D)"
          aria-label="Toggle developer panel"
          aria-pressed={settings.showDebugPanel}
          onClick={() => computer.settings.update({ showDebugPanel: !settings.showDebugPanel })}
        >
          <Icon name="bug" size={16} />
        </button>
        <button className="icon-btn" title="System Settings" aria-label="System Settings" onClick={() => launchApp(computer, 'settings')}>
          <Icon name="settings" size={16} />
        </button>
      </div>
    </footer>
  );
}
