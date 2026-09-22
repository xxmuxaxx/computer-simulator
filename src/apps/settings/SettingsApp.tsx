import { useState, type ReactNode } from 'react';
import { AppIcon, Icon } from '../../components/Icon';
import { Meter } from '../../components/Meter';
import { appRegistry } from '../index';
import { WALLPAPERS } from '../../desktop/wallpapers';
import { useComputer } from '../../hooks/useComputer';
import { useFileSystemVersion, useInstalledApps, useSettings, useSimulation } from '../../hooks/useObservable';
import { emptyTrash } from '../../store/fileActions';
import { useComputerStore } from '../../store/computerStore';
import { dialogs } from '../../store/uiStore';
import { formatBytes, formatMB } from '../../utils/format';
import type { AppProps } from '../types';
import './settings.css';

type Page = 'appearance' | 'system' | 'storage' | 'applications' | 'about';

const PAGES: { id: Page; label: string; icon: string }[] = [
  { id: 'appearance', label: 'Appearance', icon: 'palette' },
  { id: 'system', label: 'System', icon: 'cpu' },
  { id: 'storage', label: 'Storage', icon: 'disk' },
  { id: 'applications', label: 'Applications', icon: 'grid' },
  { id: 'about', label: 'About', icon: 'info' },
];

const SCALES = [
  { value: 0.9, label: 'Small' },
  { value: 1, label: 'Default' },
  { value: 1.12, label: 'Large' },
  { value: 1.25, label: 'Extra large' },
];

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="srow">
      <div className="srow-label">
        <strong>{label}</strong>
        {hint && <small>{hint}</small>}
      </div>
      <div className="srow-control">{children}</div>
    </div>
  );
}

function Segmented<T extends string | number>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange(v: T): void }) {
  return (
    <div className="seg">
      {options.map((o) => (
        <button key={String(o.value)} className={o.value === value ? 'on' : ''} aria-pressed={o.value === value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

function NameField({ label, value, onSave }: { label: string; value: string; onSave(v: string): void }) {
  const [draft, setDraft] = useState(value);
  const changed = draft !== value;
  return (
    <div className="name-field">
      <input
        className="input"
        aria-label={label}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && changed && onSave(draft.trim())}
        spellCheck={false}
      />
      <button className="btn" disabled={!changed} onClick={() => onSave(draft.trim())}>
        Apply
      </button>
    </div>
  );
}

function Appearance() {
  const computer = useComputer();
  const settings = useSettings();
  return (
    <>
      <h2>Appearance</h2>
      <Row label="Theme" hint="Switch between the light and dark interface">
        <Segmented
          value={settings.theme}
          options={[
            { value: 'dark', label: 'Dark' },
            { value: 'light', label: 'Light' },
          ]}
          onChange={(theme) => computer.settings.update({ theme })}
        />
      </Row>
      <Row label="Interface size" hint="Scales text and controls">
        <Segmented value={settings.uiScale} options={SCALES} onChange={(uiScale) => computer.settings.update({ uiScale })} />
      </Row>
      <div className="srow-block">
        <strong>Desktop wallpaper</strong>
        <div className="wallpapers">
          {WALLPAPERS.map((w) => (
            <button
              key={w.id}
              className={`wallpaper${settings.wallpaper === w.id ? ' selected' : ''}`}
              style={{ background: w.background }}
              onClick={() => computer.settings.update({ wallpaper: w.id })}
              aria-pressed={settings.wallpaper === w.id}
              title={w.name}
            >
              <span>{w.name}</span>
              {settings.wallpaper === w.id && <Icon name="check" size={14} />}
            </button>
          ))}
        </div>
      </div>
    </>
  );
}

function System() {
  const computer = useComputer();
  const settings = useSettings();
  useSimulation();
  const { cpu, memory, disk } = computer;
  const save = (patch: { computerName?: string; userName?: string }) => {
    computer.attempt(() => {
      computer.settings.update(patch);
      computer.notifications.success('Settings saved');
    });
  };
  return (
    <>
      <h2>System</h2>
      <Row label="Computer name" hint="Shown in the terminal prompt and top bar">
        <NameField label="Computer name" value={settings.computerName} onSave={(computerName) => save({ computerName })} />
      </Row>
      <Row label="User name" hint="Your home folder stays /home/user">
        <NameField label="User name" value={settings.userName} onSave={(userName) => save({ userName })} />
      </Row>
      <Row label="Clock format">
        <Segmented
          value={settings.clockFormat}
          options={[
            { value: '24', label: '24-hour' },
            { value: '12', label: '12-hour' },
          ]}
          onChange={(clockFormat) => computer.settings.update({ clockFormat })}
        />
      </Row>
      <div className="srow-block">
        <strong>Hardware</strong>
        <dl className="spec">
          <div><dt>CPU</dt><dd>{cpu.model}</dd></div>
          <div><dt>Cores</dt><dd>{cpu.cores} @ {cpu.baseFrequencyMHz} MHz (up to {cpu.maxFrequencyMHz} MHz)</dd></div>
          <div><dt>CPU load</dt><dd>{cpu.load.toFixed(1)}% - {cpu.frequencyMHz} MHz now</dd></div>
          <div><dt>RAM</dt><dd>{formatMB(memory.usedMB)} used of {formatMB(memory.totalMB)} ({formatMB(memory.freeMB)} free)</dd></div>
          <div><dt>Disk</dt><dd>{formatBytes(disk.usedBytes)} used of {formatBytes(disk.totalBytes)} ({formatBytes(disk.freeBytes)} free)</dd></div>
        </dl>
      </div>
    </>
  );
}

function Storage() {
  const computer = useComputer();
  useFileSystemVersion();
  const { fileSystem: fs, disk } = computer;
  const home = fs.isDirectory('/home/user') ? fs.getSize('/home/user') : 0;
  const trash = fs.exists(fs.trashPath) ? fs.getSize(fs.trashPath) : 0;
  const homeWithoutTrash = Math.max(0, home - trash);
  const other = Math.max(0, fs.getUsedBytes() - home);
  const total = disk.totalBytes;
  const seg = [
    { label: 'System', bytes: disk.reservedBytes, cls: 'seg-system' },
    { label: 'Your files', bytes: homeWithoutTrash, cls: 'seg-home' },
    { label: 'Trash', bytes: trash, cls: 'seg-trash' },
    { label: 'Other', bytes: other, cls: 'seg-other' },
  ];

  const reset = async () => {
    const ok = await dialogs.confirm({
      title: 'Reset Computer?',
      message: 'All files, folders, settings and installed applications will be erased and the computer returns to its original state. This cannot be undone.',
      confirmLabel: 'Reset Computer',
      danger: true,
    });
    if (ok) await useComputerStore.getState().reset();
  };

  return (
    <>
      <h2>Storage</h2>
      <div className="srow-block">
        <div className="storage-head">
          <strong>Virtual disk</strong>
          <span>
            {formatBytes(disk.usedBytes)} used of {formatBytes(total)}
          </span>
        </div>
        <div className="stack-bar" role="img" aria-label="Disk usage breakdown">
          {seg.map((s) => (
            <div key={s.label} className={s.cls} style={{ width: `${(s.bytes / total) * 100}%` }} title={`${s.label}: ${formatBytes(s.bytes)}`} />
          ))}
        </div>
        <Meter value={disk.usagePercent} label="Disk usage" tone="accent" />
        <ul className="legend">
          {seg.map((s) => (
            <li key={s.label}>
              <span className={`swatch ${s.cls}`} /> {s.label} <em>{formatBytes(s.bytes)}</em>
            </li>
          ))}
          <li>
            <span className="swatch seg-free" /> Free <em>{formatBytes(disk.freeBytes)}</em>
          </li>
        </ul>
        <div className="srow-actions">
          <button className="btn" onClick={() => void emptyTrash(computer)} disabled={fs.listTrash().length === 0}>
            <Icon name="trash" size={14} /> Empty Trash
          </button>
        </div>
      </div>
      <div className="danger-zone">
        <div>
          <strong>Reset Computer</strong>
          <small>Deletes all user data and restores the default system.</small>
        </div>
        <button className="btn btn-danger" onClick={() => void reset()}>
          Reset Computer
        </button>
      </div>
    </>
  );
}

function Applications() {
  const computer = useComputer();
  const installedIds = useInstalledApps();
  const all = appRegistry.list();
  const installed = all.filter((a) => installedIds.includes(a.id));
  const available = all.filter((a) => !installedIds.includes(a.id));
  return (
    <>
      <h2>Applications</h2>
      <div className="app-list">
        {installed.map((app) => (
          <div key={app.id} className="app-row">
            <AppIcon name={app.icon} size={36} />
            <div className="app-info">
              <strong>{app.name}</strong>
              <small>{app.description}</small>
              <small className="dim">Uses {formatMB(app.memoryUsage)} of RAM when running{app.system ? ' - system application' : ''}</small>
            </div>
            <button className="btn" onClick={() => computer.attempt(() => computer.launch(app.id))}>
              Open
            </button>
            <button
              className="btn btn-danger"
              disabled={app.system}
              title={app.system ? 'System applications cannot be uninstalled' : 'Uninstall'}
              onClick={() =>
                computer.attempt(() => {
                  computer.uninstallApplication(app.id);
                  computer.notifications.info('Application uninstalled', app.name);
                })
              }
            >
              Uninstall
            </button>
          </div>
        ))}
      </div>
      {available.length > 0 && (
        <>
          <h3>Available to install</h3>
          <div className="app-list">
            {available.map((app) => (
              <div key={app.id} className="app-row">
                <AppIcon name={app.icon} size={36} />
                <div className="app-info">
                  <strong>{app.name}</strong>
                  <small>{app.description}</small>
                </div>
                <button
                  className="btn btn-primary"
                  onClick={() => {
                    computer.installApplication(app.id);
                    computer.notifications.success('Application installed', app.name);
                  }}
                >
                  Install
                </button>
              </div>
            ))}
          </div>
        </>
      )}
    </>
  );
}

function About() {
  const computer = useComputer();
  return (
    <>
      <h2>About</h2>
      <div className="about">
        <div className="about-logo">
          <Icon name="terminal" size={34} />
        </div>
        <h3>Computer Simulator</h3>
        <p className="dim">Version 1.0.0</p>
        <p>
          A virtual personal computer that runs entirely in your browser: its own desktop, window manager, file system, processes and
          terminal. Everything is stored locally in IndexedDB.
        </p>
        <dl className="spec">
          <div><dt>Built with</dt><dd>React, TypeScript, Zustand</dd></div>
          <div><dt>Processes</dt><dd>{computer.processManager.count()}</dd></div>
          <div><dt>Files</dt><dd>{computer.fileSystem.countFiles()}</dd></div>
        </dl>
      </div>
    </>
  );
}

const CONTENT: Record<Page, () => ReactNode> = {
  appearance: () => <Appearance />,
  system: () => <System />,
  storage: () => <Storage />,
  applications: () => <Applications />,
  about: () => <About />,
};

export function SettingsApp({ args }: AppProps) {
  const initial = PAGES.some((p) => p.id === args.page) ? (args.page as Page) : 'appearance';
  const [page, setPage] = useState<Page>(initial);
  return (
    <div className="settings">
      <nav className="settings-nav" aria-label="Settings sections">
        {PAGES.map((p) => (
          <button key={p.id} className={`side-item${page === p.id ? ' active' : ''}`} onClick={() => setPage(p.id)}>
            <Icon name={p.icon} size={16} />
            <span>{p.label}</span>
          </button>
        ))}
      </nav>
      <div className="settings-content">{CONTENT[page]()}</div>
    </div>
  );
}
