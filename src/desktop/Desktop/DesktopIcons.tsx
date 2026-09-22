import { AppIcon } from '../../components/Icon';
import { showContextMenu } from '../../components/ContextMenu';
import { FileTypeIcon } from '../../components/FileTypeIcon';
import { DESKTOP, parseShortcut, SHORTCUT_EXT } from '../../core/filesystem/seed';
import type { FileStats } from '../../core/filesystem/types';
import { useComputer } from '../../hooks/useComputer';
import { useFileSystemVersion } from '../../hooks/useObservable';
import { displayName, openPath, promptRename, showProperties, trashPaths } from '../../store/fileActions';
import { useUIStore } from '../../store/uiStore';
import { extname } from '../../utils/path';

/** Icon for a desktop entry: app shortcuts and the trash get their own artwork. */
function EntryArt({ entry, trashFull }: { entry: FileStats; trashFull: boolean }) {
  const computer = useComputer();
  if (extname(entry.name) === SHORTCUT_EXT) {
    const shortcut = parseShortcut(computer.fileSystem.readFile(entry.path));
    if (shortcut?.kind === 'app') {
      const def = computer.applications.find(shortcut.appId);
      return <AppIcon name={def?.icon ?? 'file'} size={48} />;
    }
    if (shortcut?.kind === 'folder') {
      if (shortcut.target === computer.fileSystem.trashPath) {
        return (
          <span className="trash-art">
            <AppIcon name="trash" size={48} />
            {trashFull && <span className="trash-badge" />}
          </span>
        );
      }
      return <AppIcon name="folder" size={48} />;
    }
  }
  return <FileTypeIcon stats={entry} size={48} tile />;
}

export function DesktopIcons() {
  const computer = useComputer();
  useFileSystemVersion();
  const selected = useUIStore((s) => s.desktopSelection);
  const select = useUIStore((s) => s.selectDesktop);
  const fs = computer.fileSystem;
  const entries = fs.isDirectory(DESKTOP) ? fs.listDirectory(DESKTOP) : [];
  const trashFull = fs.listTrash().length > 0;

  const menuFor = (e: React.MouseEvent, entry: FileStats) => {
    select(entry.path);
    showContextMenu(e, [
      { label: 'Open', icon: 'folder-open', onClick: () => openPath(computer, entry.path) },
      { separator: true },
      { label: 'Rename', icon: 'rename', shortcut: 'F2', onClick: () => void promptRename(computer, entry.path) },
      { label: 'Move to Trash', icon: 'trash', shortcut: 'Del', danger: true, onClick: () => void trashPaths(computer, [entry.path]) },
      { separator: true },
      { label: 'Properties', icon: 'info', onClick: () => showProperties(computer, entry.path) },
    ]);
  };

  return (
    <div className="desktop-icons" onPointerDown={(e) => e.target === e.currentTarget && select(null)}>
      {entries.map((entry) => (
        <button
          key={entry.id}
          className={`desktop-icon${selected === entry.path ? ' selected' : ''}`}
          onClick={(e) => {
            e.stopPropagation();
            select(entry.path);
          }}
          onDoubleClick={() => openPath(computer, entry.path)}
          onContextMenu={(e) => menuFor(e, entry)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') openPath(computer, entry.path);
            else if (e.key === 'Delete') void trashPaths(computer, [entry.path]);
            else if (e.key === 'F2') void promptRename(computer, entry.path);
          }}
          title={entry.name}
        >
          <EntryArt entry={entry} trashFull={trashFull} />
          <span className="desktop-icon-label">{displayName(entry.name)}</span>
        </button>
      ))}
    </div>
  );
}
