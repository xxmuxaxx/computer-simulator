import { useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent, type MouseEvent } from 'react';
import { Icon } from '../../components/Icon';
import { showContextMenu } from '../../components/ContextMenu';
import { HOME, parseShortcut, SHORTCUT_EXT } from '../../core/filesystem/seed';
import type { FileStats } from '../../core/filesystem/types';
import { useComputer } from '../../hooks/useComputer';
import { useFileSystemVersion } from '../../hooks/useObservable';
import { useWindowCommands } from '../../hooks/windowCommands';
import {
  copyToClipboard,
  deletePermanently,
  emptyTrash,
  movePaths,
  openPath,
  paste,
  promptCreate,
  restorePaths,
  showProperties,
  trashPaths,
} from '../../store/fileActions';
import { useUIStore } from '../../store/uiStore';
import { basename, dirname, extname, isInside, join, normalize } from '../../utils/path';
import { formatBytes } from '../../utils/format';
import type { AppProps } from '../types';
import { DRAG_TYPE, GridTile, ListRow, SortHeader, sortEntries, type SortKey, type SortState } from './FileEntries';
import './files.css';

interface Location {
  label: string;
  path: string;
  icon: string;
}

const LOCATIONS: Location[] = [
  { label: 'Home', path: HOME, icon: 'home' },
  { label: 'Desktop', path: `${HOME}/Desktop`, icon: 'desktop' },
  { label: 'Documents', path: `${HOME}/Documents`, icon: 'file-text' },
  { label: 'Downloads', path: `${HOME}/Downloads`, icon: 'download' },
  { label: 'Projects', path: `${HOME}/Projects`, icon: 'folder' },
  { label: 'Computer', path: '/', icon: 'disk' },
];

export function FilesApp({ windowId, args }: AppProps) {
  const computer = useComputer();
  const fs = computer.fileSystem;
  useFileSystemVersion();
  const clipboard = useUIStore((s) => s.clipboard);

  const initial = typeof args.path === 'string' && fs.isDirectory(args.path) ? normalize(args.path) : HOME;
  const [path, setPath] = useState(initial);
  const [history, setHistory] = useState<{ back: string[]; forward: string[] }>({ back: [], forward: [] });
  const [view, setView] = useState<'list' | 'grid'>('list');
  const [sort, setSort] = useState<SortState>({ key: 'name', dir: 1 });
  const [selection, setSelection] = useState<string[]>([]);
  const [renaming, setRenaming] = useState<string | null>(null);
  const anchor = useRef<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // If the folder we are looking at disappears (deleted elsewhere), fall back to the nearest parent.
  let current = path;
  while (current !== '/' && !fs.isDirectory(current)) current = dirname(current);
  useEffect(() => {
    if (current !== path) {
      setPath(current);
      setSelection([]);
    }
  }, [current, path]);

  const trashPath = fs.trashPath;
  const trashMode = current === trashPath || isInside(trashPath, current);

  const entries = useMemo(() => {
    const all = fs.listDirectory(current).filter((e) => trashMode || !e.name.startsWith('.'));
    return sortEntries(all, sort);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fs, fs.version, current, sort, trashMode]);

  const trashCount = fs.listTrash().length;
  const selectedEntries = entries.filter((e) => selection.includes(e.path));
  // Drop selections that no longer exist.
  useEffect(() => {
    setSelection((sel) => (sel.every((p) => fs.exists(p)) ? sel : sel.filter((p) => fs.exists(p))));
  }, [fs, fs.version]);

  useEffect(() => {
    computer.windowManager.setTitle(windowId, `${trashMode && current === trashPath ? 'Trash' : basename(current) === '/' ? 'Computer' : basename(current)} - Files`);
    computer.windowManager.setArgs(windowId, { path: current });
  }, [computer, windowId, current, trashMode, trashPath]);

  const navigate = (to: string, record = true) => {
    const target = normalize(to);
    if (!fs.isDirectory(target)) {
      computer.attempt(() => fs.listDirectory(target));
      return;
    }
    if (record && target !== current) setHistory((h) => ({ back: [...h.back, current], forward: [] }));
    setPath(target);
    setSelection([]);
    setRenaming(null);
    anchor.current = null;
  };

  const goBack = () => {
    const prev = history.back[history.back.length - 1];
    if (prev === undefined) return;
    setHistory((h) => ({ back: h.back.slice(0, -1), forward: [current, ...h.forward] }));
    navigate(prev, false);
  };
  const goForward = () => {
    const next = history.forward[0];
    if (next === undefined) return;
    setHistory((h) => ({ back: [...h.back, current], forward: h.forward.slice(1) }));
    navigate(next, false);
  };
  const goUp = () => current !== '/' && navigate(dirname(current));

  const open = (entry: FileStats) => {
    if (trashMode && entry.type === 'file') {
      computer.notifications.info('This item is in the Trash', 'Restore it to open it.');
      return;
    }
    if (entry.type === 'directory') return navigate(entry.path);
    if (extname(entry.name) === SHORTCUT_EXT) {
      const shortcut = parseShortcut(fs.readFile(entry.path));
      if (shortcut?.kind === 'folder' && fs.isDirectory(shortcut.target)) return navigate(shortcut.target);
    }
    openPath(computer, entry.path);
  };

  const onSelect = (e: MouseEvent, entry: FileStats) => {
    listRef.current?.focus({ preventScroll: true });
    if (e.shiftKey && anchor.current) {
      const a = entries.findIndex((x) => x.path === anchor.current);
      const b = entries.findIndex((x) => x.path === entry.path);
      if (a >= 0 && b >= 0) {
        setSelection(entries.slice(Math.min(a, b), Math.max(a, b) + 1).map((x) => x.path));
        return;
      }
    }
    if (e.ctrlKey || e.metaKey) {
      setSelection((sel) => (sel.includes(entry.path) ? sel.filter((p) => p !== entry.path) : [...sel, entry.path]));
    } else setSelection([entry.path]);
    anchor.current = entry.path;
  };

  const commitRename = (entry: FileStats, name: string | null) => {
    setRenaming(null);
    if (!name || name === displayOf(entry)) return;
    const next = extname(entry.name) === SHORTCUT_EXT && extname(name) !== SHORTCUT_EXT ? name + SHORTCUT_EXT : name;
    const renamed = computer.attempt(() => fs.rename(entry.path, next));
    if (renamed) setSelection([renamed.path]);
  };

  const startRename = () => {
    if (selection.length === 1 && !trashMode) setRenaming(selection[0]!);
  };

  const deleteSelection = () => {
    if (selection.length === 0) return;
    void trashPaths(computer, selection);
  };

  const create = async (kind: 'file' | 'folder') => {
    if (trashMode) return;
    const created = await promptCreate(computer, current, kind);
    if (created) setSelection([created]);
  };

  useWindowCommands(windowId, {
    delete: deleteSelection,
    rename: startRename,
    newFile: () => void create('file'),
  });

  const entryMenu = (e: MouseEvent, entry: FileStats) => {
    const targets = selection.includes(entry.path) ? selection : [entry.path];
    if (!selection.includes(entry.path)) setSelection([entry.path]);
    if (trashMode) {
      showContextMenu(e, [
        { label: 'Restore', icon: 'restore', onClick: () => restorePaths(computer, targets) },
        { label: 'Delete Permanently', icon: 'trash', danger: true, onClick: () => void deletePermanently(computer, targets) },
        { separator: true },
        { label: 'Properties', icon: 'info', onClick: () => showProperties(computer, entry.path) },
      ]);
      return;
    }
    showContextMenu(e, [
      { label: 'Open', icon: 'folder-open', onClick: () => open(entry) },
      { separator: true },
      { label: 'Cut', icon: 'cut', shortcut: 'Ctrl+X', onClick: () => copyToClipboard(targets, 'cut') },
      { label: 'Copy', icon: 'copy', shortcut: 'Ctrl+C', onClick: () => copyToClipboard(targets, 'copy') },
      ...(entry.type === 'directory' ? [{ label: 'Paste Into Folder', icon: 'paste', disabled: !clipboard, onClick: () => paste(computer, entry.path) }] : []),
      { separator: true },
      { label: 'Rename', icon: 'rename', shortcut: 'F2', disabled: targets.length !== 1, onClick: () => setRenaming(entry.path) },
      { label: 'Move to Trash', icon: 'trash', shortcut: 'Del', danger: true, onClick: () => void trashPaths(computer, targets) },
      { separator: true },
      { label: 'Properties', icon: 'info', onClick: () => showProperties(computer, entry.path) },
    ]);
  };

  const backgroundMenu = (e: MouseEvent) => {
    setSelection([]);
    if (trashMode) {
      showContextMenu(e, [
        { label: 'Empty Trash', icon: 'trash', danger: true, disabled: trashCount === 0, onClick: () => void emptyTrash(computer) },
        { label: 'Refresh', icon: 'refresh', onClick: () => fs.refresh() },
      ]);
      return;
    }
    showContextMenu(e, [
      { label: 'New Folder', icon: 'folder-plus', onClick: () => void create('folder') },
      { label: 'New Text File', icon: 'file-plus', shortcut: 'Ctrl+N', onClick: () => void create('file') },
      { label: 'Paste', icon: 'paste', shortcut: 'Ctrl+V', disabled: !clipboard, onClick: () => paste(computer, current) },
      { separator: true },
      { label: 'Refresh', icon: 'refresh', onClick: () => fs.refresh() },
      { label: 'Properties', icon: 'info', onClick: () => showProperties(computer, current) },
    ]);
  };

  const onDragStart = (e: DragEvent, entry: FileStats) => {
    const paths = selection.includes(entry.path) ? selection : [entry.path];
    if (!selection.includes(entry.path)) setSelection([entry.path]);
    e.dataTransfer.setData(DRAG_TYPE, JSON.stringify(paths));
    e.dataTransfer.effectAllowed = 'move';
  };

  const dropTo = (e: DragEvent, dest: string) => {
    e.preventDefault();
    e.stopPropagation();
    const raw = e.dataTransfer.getData(DRAG_TYPE);
    if (!raw) return;
    const paths = (JSON.parse(raw) as string[]).filter((p) => p !== dest);
    if (dest === trashPath) void trashPaths(computer, paths);
    else movePaths(computer, paths, dest);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (renaming) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'a') {
      e.preventDefault();
      setSelection(entries.map((x) => x.path));
    } else if (mod && e.key.toLowerCase() === 'c' && selection.length) {
      e.preventDefault();
      copyToClipboard(selection, 'copy');
    } else if (mod && e.key.toLowerCase() === 'x' && selection.length && !trashMode) {
      e.preventDefault();
      copyToClipboard(selection, 'cut');
    } else if (mod && e.key.toLowerCase() === 'v' && !trashMode) {
      e.preventDefault();
      paste(computer, current);
    } else if (e.key === 'Enter' && selectedEntries.length === 1) {
      open(selectedEntries[0]!);
    } else if (e.key === 'Backspace' || (e.altKey && e.key === 'ArrowUp')) {
      e.preventDefault();
      goUp();
    } else if (e.altKey && e.key === 'ArrowLeft') goBack();
    else if (e.altKey && e.key === 'ArrowRight') goForward();
    else if (e.key === 'Escape') setSelection([]);
    else if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && entries.length) {
      e.preventDefault();
      const last = selection[selection.length - 1];
      const idx = entries.findIndex((x) => x.path === last);
      const next = Math.max(0, Math.min(entries.length - 1, idx + (e.key === 'ArrowDown' ? 1 : -1)));
      setSelection([entries[idx < 0 ? 0 : next]!.path]);
      anchor.current = entries[idx < 0 ? 0 : next]!.path;
    }
  };

  const crumbs = useMemo(() => {
    const out: { label: string; path: string }[] = [];
    if (trashMode) {
      out.push({ label: 'Trash', path: trashPath });
      const rest = current.slice(trashPath.length).split('/').filter(Boolean);
      rest.forEach((part, i) => out.push({ label: part, path: join(trashPath, ...rest.slice(0, i + 1)) }));
    } else {
      out.push({ label: '/', path: '/' });
      const parts = current.split('/').filter(Boolean);
      parts.forEach((part, i) => out.push({ label: part, path: '/' + parts.slice(0, i + 1).join('/') }));
    }
    return out;
  }, [current, trashMode, trashPath]);

  const toggleSort = (key: SortKey) => setSort((s) => (s.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: 1 }));
  const cutPaths = clipboard?.mode === 'cut' ? clipboard.paths : [];
  const selectedSize = selectedEntries.reduce((n, e) => n + e.size, 0);

  const entryProps = (entry: FileStats) => ({
    entry,
    selected: selection.includes(entry.path),
    cut: cutPaths.includes(entry.path),
    renaming: renaming === entry.path,
    trashMode,
    onSelect,
    onOpen: open,
    onContextMenu: entryMenu,
    onRenameCommit: commitRename,
    onDragStart,
    onDropOn: (e: DragEvent, target: FileStats) => dropTo(e, target.path),
  });

  return (
    <div className="files" onKeyDown={onKeyDown}>
      <nav className="files-sidebar" aria-label="Locations">
        <div className="side-title">Locations</div>
        {LOCATIONS.map((loc) => (
          <button
            key={loc.path}
            className={`side-item${!trashMode && current === loc.path ? ' active' : ''}`}
            onClick={() => navigate(loc.path)}
            onDragOver={(e) => e.dataTransfer.types.includes(DRAG_TYPE) && e.preventDefault()}
            onDrop={(e) => dropTo(e, loc.path)}
          >
            <Icon name={loc.icon} size={16} />
            <span>{loc.label}</span>
          </button>
        ))}
        <div className="side-sep" />
        <button
          className={`side-item${trashMode ? ' active' : ''}`}
          onClick={() => navigate(trashPath)}
          onDragOver={(e) => e.dataTransfer.types.includes(DRAG_TYPE) && e.preventDefault()}
          onDrop={(e) => dropTo(e, trashPath)}
        >
          <Icon name="trash" size={16} />
          <span>Trash</span>
          {trashCount > 0 && <span className="badge">{trashCount}</span>}
        </button>
      </nav>

      <div className="files-main">
        <div className="files-toolbar">
          <button className="icon-btn" title="Back (Alt+Left)" aria-label="Back" disabled={history.back.length === 0} onClick={goBack}>
            <Icon name="back" />
          </button>
          <button className="icon-btn" title="Forward (Alt+Right)" aria-label="Forward" disabled={history.forward.length === 0} onClick={goForward}>
            <Icon name="forward" />
          </button>
          <button className="icon-btn" title="Up (Backspace)" aria-label="Up" disabled={current === '/'} onClick={goUp}>
            <Icon name="up" />
          </button>
          <div className="crumbs" role="navigation" aria-label="Breadcrumbs">
            {crumbs.map((c, i) => (
              <span key={c.path} className="crumb-wrap">
                {i > 0 && <Icon name="chevron" size={12} />}
                <button
                  className={`crumb${i === crumbs.length - 1 ? ' current' : ''}`}
                  onClick={() => navigate(c.path)}
                  onDragOver={(e) => e.dataTransfer.types.includes(DRAG_TYPE) && e.preventDefault()}
                  onDrop={(e) => dropTo(e, c.path)}
                >
                  {c.label}
                </button>
              </span>
            ))}
          </div>
          {trashMode ? (
            <>
              <button className="btn" disabled={selection.length === 0} onClick={() => restorePaths(computer, selection)}>
                <Icon name="restore" size={14} /> Restore
              </button>
              <button className="btn btn-danger" disabled={trashCount === 0} onClick={() => void emptyTrash(computer)}>
                <Icon name="trash" size={14} /> Empty Trash
              </button>
            </>
          ) : (
            <>
              <button className="icon-btn" title="New file (Ctrl+N)" aria-label="New file" onClick={() => void create('file')}>
                <Icon name="file-plus" />
              </button>
              <button className="icon-btn" title="New folder" aria-label="New folder" onClick={() => void create('folder')}>
                <Icon name="folder-plus" />
              </button>
            </>
          )}
          <select
            className="select"
            aria-label="Sort by"
            value={`${sort.key}:${sort.dir}`}
            onChange={(e) => {
              const [key, dir] = e.target.value.split(':');
              setSort({ key: key as SortKey, dir: dir === '1' ? 1 : -1 });
            }}
          >
            <option value="name:1">Name (A-Z)</option>
            <option value="name:-1">Name (Z-A)</option>
            <option value="modified:-1">Newest first</option>
            <option value="modified:1">Oldest first</option>
            <option value="size:-1">Largest first</option>
            <option value="size:1">Smallest first</option>
            <option value="type:1">Type</option>
          </select>
          <div className="seg">
            <button className={view === 'list' ? 'on' : ''} aria-label="List view" aria-pressed={view === 'list'} title="List view" onClick={() => setView('list')}>
              <Icon name="list" size={15} />
            </button>
            <button className={view === 'grid' ? 'on' : ''} aria-label="Grid view" aria-pressed={view === 'grid'} title="Grid view" onClick={() => setView('grid')}>
              <Icon name="grid" size={15} />
            </button>
          </div>
        </div>

        <div
          ref={listRef}
          className={`files-list ${view}`}
          tabIndex={0}
          role={view === 'list' ? 'table' : 'grid'}
          onContextMenu={backgroundMenu}
          onClick={(e) => e.target === e.currentTarget && setSelection([])}
          onDragOver={(e) => {
            if (!trashMode && e.dataTransfer.types.includes(DRAG_TYPE)) e.preventDefault();
          }}
          onDrop={(e) => !trashMode && dropTo(e, current)}
        >
          {view === 'list' && <SortHeader sort={sort} onSort={toggleSort} />}
          {entries.length === 0 && (
            <div className="empty" onContextMenu={backgroundMenu}>
              {trashMode ? 'Trash is empty' : 'This folder is empty'}
            </div>
          )}
          {view === 'list'
            ? entries.map((entry) => <ListRow key={entry.id} {...entryProps(entry)} />)
            : entries.length > 0 && <div className="tiles">{entries.map((entry) => <GridTile key={entry.id} {...entryProps(entry)} />)}</div>}
        </div>

        <div className="files-status">
          <span>
            {entries.length} item{entries.length === 1 ? '' : 's'}
          </span>
          {selection.length > 0 && (
            <span>
              {selection.length} selected ({formatBytes(selectedSize)})
            </span>
          )}
          <span className="grow" />
          <span className="dim">{trashMode ? 'Trash' : current}</span>
        </div>
      </div>
    </div>
  );
}

function displayOf(entry: FileStats): string {
  return extname(entry.name) === SHORTCUT_EXT ? entry.name.slice(0, -SHORTCUT_EXT.length) : entry.name;
}
