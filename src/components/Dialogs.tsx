import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { errorMessage } from '../core/errors';
import { useFileSystemVersion } from '../hooks/useObservable';
import { useComputer } from '../hooks/useComputer';
import { useUIStore, type DialogRequest } from '../store/uiStore';
import { basename, dirname, extname, join, normalize } from '../utils/path';
import { formatBytes, formatDateTime } from '../utils/format';
import { FileTypeIcon } from './FileTypeIcon';
import { Icon } from './Icon';

function Modal({ title, children, onCancel, wide }: { title: string; children: ReactNode; onCancel: () => void; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCancel();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onCancel]);

  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div className={`modal${wide ? ' modal-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-title">{title}</div>
        {children}
      </div>
    </div>
  );
}

function ChoiceDialog({ dialog, done }: { dialog: Extract<DialogRequest, { kind: 'choice' }>; done: (v: string | null) => void }) {
  const primary = useRef<HTMLButtonElement>(null);
  useEffect(() => primary.current?.focus(), []);
  const focusIndex = Math.max(0, dialog.buttons.findIndex((b) => b.variant === 'primary' || b.variant === 'danger'));
  return (
    <Modal title={dialog.title} onCancel={() => done(null)}>
      <p className="modal-message">{dialog.message}</p>
      <div className="modal-actions">
        {dialog.buttons.map((b, i) => (
          <button
            key={b.value}
            ref={i === focusIndex ? primary : undefined}
            className={`btn${b.variant === 'primary' ? ' btn-primary' : b.variant === 'danger' ? ' btn-danger' : ''}`}
            onClick={() => done(b.value)}
          >
            {b.label}
          </button>
        ))}
      </div>
    </Modal>
  );
}

function PromptDialog({ dialog, done }: { dialog: Extract<DialogRequest, { kind: 'prompt' }>; done: (v: string | null) => void }) {
  const [value, setValue] = useState(dialog.initial);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const el = input.current;
    if (!el) return;
    el.focus();
    const dot = dialog.selectStem ? dialog.initial.lastIndexOf('.') : -1;
    el.setSelectionRange(0, dot > 0 ? dot : dialog.initial.length);
  }, [dialog.initial, dialog.selectStem]);
  const submit = () => {
    if (value.trim() !== '') done(value.trim());
  };
  return (
    <Modal title={dialog.title} onCancel={() => done(null)}>
      <label className="field">
        <span>{dialog.label}</span>
        <input
          ref={input}
          className="input"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          spellCheck={false}
        />
      </label>
      <div className="modal-actions">
        <button className="btn" onClick={() => done(null)}>
          Cancel
        </button>
        <button className="btn btn-primary" disabled={value.trim() === ''} onClick={submit}>
          {dialog.confirmLabel}
        </button>
      </div>
    </Modal>
  );
}

function FilePickerDialog({ dialog, done }: { dialog: Extract<DialogRequest, { kind: 'file-picker' }>; done: (v: string | null) => void }) {
  const computer = useComputer();
  const fs = computer.fileSystem;
  useFileSystemVersion();
  const [dir, setDir] = useState(() => (fs.isDirectory(dialog.initialDir) ? normalize(dialog.initialDir) : '/home/user'));
  const [name, setName] = useState(dialog.defaultName);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const entries = useMemo(() => {
    try {
      return fs
        .listDirectory(dir)
        .filter((e) => !e.name.startsWith('.'))
        .sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'directory' ? -1 : 1));
    } catch {
      return [];
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dir, fs, fs.version]);

  const enter = (path: string) => {
    setDir(path);
    setSelected(null);
    setError(null);
  };

  const submit = async () => {
    setError(null);
    if (dialog.mode === 'open') {
      if (selected && fs.isFile(selected)) done(selected);
      else setError('Select a file to open.');
      return;
    }
    const fileName = name.trim();
    if (!fileName) return setError('Enter a file name.');
    if (fileName.includes('/')) return setError('A file name cannot contain "/".');
    const target = join(dir, fileName);
    if (fs.isDirectory(target)) return enter(target);
    done(target);
  };

  const crumbs = normalize(dir).split('/').filter(Boolean);

  return (
    <Modal title={dialog.title} onCancel={() => done(null)} wide>
      <div className="picker-bar">
        <button className="icon-btn" title="Up" disabled={dir === '/'} onClick={() => enter(dirname(dir))}>
          <Icon name="up" />
        </button>
        <div className="crumbs">
          <button className="crumb" onClick={() => enter('/')}>
            /
          </button>
          {crumbs.map((c, i) => (
            <span key={i} className="crumb-wrap">
              <Icon name="chevron" size={12} />
              <button className="crumb" onClick={() => enter('/' + crumbs.slice(0, i + 1).join('/'))}>
                {c}
              </button>
            </span>
          ))}
        </div>
      </div>
      <div className="picker-list" role="listbox">
        {entries.length === 0 && <div className="empty">This folder is empty</div>}
        {entries.map((e) => (
          <div
            key={e.id}
            role="option"
            aria-selected={selected === e.path}
            className={`picker-row${selected === e.path ? ' selected' : ''}`}
            onClick={() => {
              if (e.type === 'file') {
                setSelected(e.path);
                if (dialog.mode === 'save') setName(e.name);
              } else setSelected(null);
            }}
            onDoubleClick={() => (e.type === 'directory' ? enter(e.path) : void submitFile(e.path))}
          >
            <FileTypeIcon stats={e} size={16} />
            <span className="picker-name">{e.name}</span>
            <span className="dim">{e.type === 'file' ? formatBytes(e.size) : ''}</span>
          </div>
        ))}
      </div>
      {dialog.mode === 'save' && (
        <label className="field">
          <span>File name</span>
          <input
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void submit()}
            autoFocus
            spellCheck={false}
          />
        </label>
      )}
      {error && <div className="form-error">{error}</div>}
      <div className="modal-actions">
        <button className="btn" onClick={() => done(null)}>
          Cancel
        </button>
        <button className="btn btn-primary" onClick={() => void submit()}>
          {dialog.mode === 'open' ? 'Open' : 'Save'}
        </button>
      </div>
    </Modal>
  );

  function submitFile(path: string) {
    if (dialog.mode === 'open') done(path);
    else {
      setName(basename(path));
      setSelected(path);
    }
  }
}

function PropertiesDialog({ dialog, done }: { dialog: Extract<DialogRequest, { kind: 'properties' }>; done: () => void }) {
  const s = dialog.stats;
  const rows: [string, string][] = [
    ['Name', s.name],
    ['Location', s.path === '/' ? '/' : dirname(s.path)],
    ['Type', s.type === 'directory' ? 'Folder' : extname(s.name) ? `${extname(s.name).slice(1).toUpperCase()} file` : 'File'],
    ['Size', `${formatBytes(s.size)} (${s.size.toLocaleString()} bytes)`],
    ...(s.type === 'directory' ? ([['Contains', `${s.childCount ?? 0} item(s)`]] as [string, string][]) : []),
    ['Created', formatDateTime(s.createdAt)],
    ['Modified', formatDateTime(s.modifiedAt)],
    ['Access', s.readonly ? 'Read only' : 'Read and write'],
  ];
  return (
    <Modal title="Properties" onCancel={done}>
      <div className="props-head">
        <FileTypeIcon stats={s} size={28} />
        <strong>{s.name}</strong>
      </div>
      <dl className="props">
        {rows.map(([k, v]) => (
          <div key={k} className="props-row">
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      <div className="modal-actions">
        <button className="btn btn-primary" onClick={done} autoFocus>
          Close
        </button>
      </div>
    </Modal>
  );
}

/** Renders the topmost pending dialog. Dialogs are requested through `dialogs.*` in the UI store. */
export function DialogHost() {
  const dialog = useUIStore((s) => s.dialogs[0]);
  const pop = useUIStore((s) => s.popDialog);
  if (!dialog) return null;

  const finish = (value: string | null) => {
    pop(dialog.id);
    try {
      (dialog.resolve as (v: string | null) => void)(value);
    } catch (e) {
      console.error(errorMessage(e));
    }
  };

  switch (dialog.kind) {
    case 'choice':
      return <ChoiceDialog key={dialog.id} dialog={dialog} done={finish} />;
    case 'prompt':
      return <PromptDialog key={dialog.id} dialog={dialog} done={finish} />;
    case 'file-picker':
      return <FilePickerDialog key={dialog.id} dialog={dialog} done={finish} />;
    case 'properties':
      return <PropertiesDialog key={dialog.id} dialog={dialog} done={() => finish(null)} />;
  }
}
