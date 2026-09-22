import { useEffect, useRef, type DragEvent, type MouseEvent } from 'react';
import { FileTypeIcon } from '../../components/FileTypeIcon';
import { Icon } from '../../components/Icon';
import { SHORTCUT_EXT } from '../../core/filesystem/seed';
import type { FileStats } from '../../core/filesystem/types';
import { displayName } from '../../store/fileActions';
import { extname } from '../../utils/path';
import { formatBytes, formatDateTime } from '../../utils/format';

export type SortKey = 'name' | 'size' | 'modified' | 'type';
export interface SortState {
  key: SortKey;
  dir: 1 | -1;
}

export const DRAG_TYPE = 'application/x-sim-paths';

export function typeLabel(e: FileStats): string {
  if (e.type === 'directory') return 'Folder';
  const ext = extname(e.name);
  if (ext === SHORTCUT_EXT) return 'Shortcut';
  return ext ? `${ext.slice(1).toUpperCase()} file` : 'File';
}

export function sortEntries(entries: FileStats[], sort: SortState): FileStats[] {
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
  return [...entries].sort((a, b) => {
    if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
    let r = 0;
    switch (sort.key) {
      case 'size':
        r = a.size - b.size;
        break;
      case 'modified':
        r = a.modifiedAt - b.modifiedAt;
        break;
      case 'type':
        r = typeLabel(a).localeCompare(typeLabel(b));
        break;
    }
    if (sort.key === 'name') r = collator.compare(a.name, b.name);
    return (r !== 0 ? r : collator.compare(a.name, b.name)) * sort.dir;
  });
}

interface EntryViewProps {
  entry: FileStats;
  selected: boolean;
  cut: boolean;
  renaming: boolean;
  trashMode: boolean;
  onSelect(e: MouseEvent, entry: FileStats): void;
  onOpen(entry: FileStats): void;
  onContextMenu(e: MouseEvent, entry: FileStats): void;
  onRenameCommit(entry: FileStats, name: string | null): void;
  onDragStart(e: DragEvent, entry: FileStats): void;
  onDropOn(e: DragEvent, entry: FileStats): void;
}

function RenameInput({ entry, onCommit }: { entry: FileStats; onCommit(name: string | null): void }) {
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  const shown = displayName(entry.name);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    const dot = entry.type === 'file' ? shown.lastIndexOf('.') : -1;
    el.setSelectionRange(0, dot > 0 ? dot : shown.length);
  }, [entry.type, shown]);
  const finish = (value: string | null) => {
    if (done.current) return;
    done.current = true;
    onCommit(value);
  };
  return (
    <input
      ref={ref}
      className="input rename-input"
      defaultValue={shown}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') finish(e.currentTarget.value.trim());
        else if (e.key === 'Escape') finish(null);
      }}
      onBlur={(e) => finish(e.currentTarget.value.trim())}
      spellCheck={false}
    />
  );
}

function useDropProps(props: EntryViewProps) {
  const { entry } = props;
  const isDir = entry.type === 'directory';
  return {
    draggable: !props.renaming && !props.trashMode,
    onDragStart: (e: DragEvent) => props.onDragStart(e, entry),
    onDragOver: (e: DragEvent) => {
      if (isDir && e.dataTransfer.types.includes(DRAG_TYPE)) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
      }
    },
    onDrop: (e: DragEvent) => {
      if (isDir) props.onDropOn(e, entry);
    },
  };
}

export function ListRow(props: EntryViewProps) {
  const { entry, selected, cut, renaming, trashMode } = props;
  const drop = useDropProps(props);
  return (
    <div
      className={`frow${selected ? ' selected' : ''}${cut ? ' cut' : ''}`}
      role="row"
      aria-selected={selected}
      data-path={entry.path}
      onClick={(e) => props.onSelect(e, entry)}
      onDoubleClick={() => !renaming && props.onOpen(entry)}
      onContextMenu={(e) => props.onContextMenu(e, entry)}
      {...drop}
    >
      <span className="fcell fname">
        <FileTypeIcon stats={entry} size={18} />
        {renaming ? <RenameInput entry={entry} onCommit={(n) => props.onRenameCommit(entry, n)} /> : <span className="ftext">{displayName(entry.name)}</span>}
      </span>
      <span className="fcell fmod">{trashMode && entry.trash ? entry.trash.originalPath : formatDateTime(entry.modifiedAt)}</span>
      <span className="fcell fsize">{entry.type === 'directory' ? `${entry.childCount ?? 0} items` : formatBytes(entry.size)}</span>
      <span className="fcell ftype">{typeLabel(entry)}</span>
    </div>
  );
}

export function GridTile(props: EntryViewProps) {
  const { entry, selected, cut, renaming } = props;
  const drop = useDropProps(props);
  return (
    <div
      className={`ftile${selected ? ' selected' : ''}${cut ? ' cut' : ''}`}
      role="gridcell"
      aria-selected={selected}
      data-path={entry.path}
      onClick={(e) => props.onSelect(e, entry)}
      onDoubleClick={() => !renaming && props.onOpen(entry)}
      onContextMenu={(e) => props.onContextMenu(e, entry)}
      title={entry.name}
      {...drop}
    >
      <FileTypeIcon stats={entry} size={44} tile />
      {renaming ? <RenameInput entry={entry} onCommit={(n) => props.onRenameCommit(entry, n)} /> : <span className="ftile-name">{displayName(entry.name)}</span>}
    </div>
  );
}

export function SortHeader({ sort, onSort }: { sort: SortState; onSort(key: SortKey): void }) {
  const cols: [SortKey, string, string][] = [
    ['name', 'Name', 'fname'],
    ['modified', 'Modified', 'fmod'],
    ['size', 'Size', 'fsize'],
    ['type', 'Type', 'ftype'],
  ];
  return (
    <div className="fhead" role="row">
      {cols.map(([key, label, cls]) => (
        <button key={key} className={`fcell fhead-btn ${cls}`} onClick={() => onSort(key)} aria-sort={sort.key === key ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}>
          {label}
          {sort.key === key && <Icon name="chevron" size={12} className={sort.dir === 1 ? 'sort-asc' : 'sort-desc'} />}
        </button>
      ))}
    </div>
  );
}
