import type { VirtualComputer } from '../core/computer/VirtualComputer';
import { SHORTCUT_EXT } from '../core/filesystem/seed';
import { uniquePath } from '../core/filesystem/naming';
import { basename, dirname, extname, join } from '../utils/path';
import { dialogs, useUIStore } from './uiStore';

/** User-facing file operations shared by the Files app and the desktop. All errors become notifications. */

export function displayName(name: string): string {
  return extname(name) === SHORTCUT_EXT ? name.slice(0, -SHORTCUT_EXT.length) : name;
}

export async function promptCreate(computer: VirtualComputer, dir: string, kind: 'file' | 'folder'): Promise<string | undefined> {
  const fs = computer.fileSystem;
  const suggestion = basename(kind === 'folder' ? uniquePath(fs, dir, 'New Folder') : uniquePath(fs, dir, 'New File', '.txt'));
  const name = await dialogs.prompt({
    title: kind === 'folder' ? 'New Folder' : 'New Text File',
    label: kind === 'folder' ? 'Folder name' : 'File name',
    initial: suggestion,
    confirmLabel: 'Create',
    selectStem: kind === 'file',
  });
  if (!name) return undefined;
  return computer.attempt(() => {
    const path = join(dir, name);
    if (kind === 'folder') fs.createDirectory(path);
    else fs.createFile(path, '');
    return path;
  });
}

export async function promptRename(computer: VirtualComputer, path: string): Promise<string | undefined> {
  const current = basename(path);
  const isLink = extname(current) === SHORTCUT_EXT;
  const value = await dialogs.prompt({
    title: 'Rename',
    label: 'New name',
    initial: displayName(current),
    confirmLabel: 'Rename',
    selectStem: !isLink,
  });
  if (!value) return undefined;
  const next = isLink && extname(value) !== SHORTCUT_EXT ? value + SHORTCUT_EXT : value;
  if (next === current) return path;
  return computer.attempt(() => computer.fileSystem.rename(path, next).path);
}

/** Moves items to the trash; items already in the trash are deleted permanently after confirmation. */
export async function trashPaths(computer: VirtualComputer, paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  const fs = computer.fileSystem;
  if (paths.every((p) => fs.isInTrash(p))) return deletePermanently(computer, paths);
  let moved = 0;
  for (const p of paths) {
    if (computer.attempt(() => fs.trash(p)) !== undefined) moved++;
  }
  if (moved > 0) {
    computer.notifications.info(moved === 1 ? 'Moved to Trash' : `${moved} items moved to Trash`, moved === 1 ? basename(paths[0]!) : undefined);
  }
}

export async function deletePermanently(computer: VirtualComputer, paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  const label = paths.length === 1 ? `"${basename(paths[0]!)}"` : `${paths.length} items`;
  const ok = await dialogs.confirm({
    title: 'Delete permanently?',
    message: `${label} will be deleted forever. This cannot be undone.`,
    confirmLabel: 'Delete',
    danger: true,
  });
  if (!ok) return;
  for (const p of paths) computer.attempt(() => computer.fileSystem.delete(p, { recursive: true }));
}

export function restorePaths(computer: VirtualComputer, paths: string[]): void {
  for (const p of paths) {
    const restored = computer.attempt(() => computer.fileSystem.restore(p));
    if (restored) computer.notifications.success('Restored', restored.path);
  }
}

export async function emptyTrash(computer: VirtualComputer): Promise<void> {
  const count = computer.fileSystem.listTrash().length;
  if (count === 0) return;
  const ok = await dialogs.confirm({
    title: 'Empty Trash?',
    message: `${count} item${count === 1 ? '' : 's'} will be deleted forever.`,
    confirmLabel: 'Empty Trash',
    danger: true,
  });
  if (ok) computer.attempt(() => computer.fileSystem.emptyTrash());
}

export function copyToClipboard(paths: string[], mode: 'copy' | 'cut'): void {
  useUIStore.getState().setClipboard({ paths, mode });
}

export function paste(computer: VirtualComputer, destDir: string): void {
  const { clipboard, setClipboard } = useUIStore.getState();
  if (!clipboard) return;
  const fs = computer.fileSystem;
  for (const src of clipboard.paths) {
    computer.attempt(() => {
      if (!fs.exists(src)) return;
      const name = basename(src);
      if (clipboard.mode === 'copy') {
        // Never overwrite: copies get a " 2" suffix.
        const ext = fs.isFile(src) ? extname(name) : '';
        const target = uniquePath(fs, destDir, ext ? name.slice(0, -ext.length) : name, ext);
        fs.copy(src, target);
      } else {
        if (dirname(src) === destDir) return;
        fs.move(src, destDir);
      }
    });
  }
  if (clipboard.mode === 'cut') setClipboard(null);
}

export function movePaths(computer: VirtualComputer, paths: string[], destDir: string): void {
  for (const p of paths) {
    if (dirname(p) === destDir || p === destDir) continue;
    computer.attempt(() => computer.fileSystem.move(p, destDir));
  }
}

export function showProperties(computer: VirtualComputer, path: string): void {
  const stats = computer.attempt(() => computer.fileSystem.getStats(path));
  if (stats) void dialogs.properties(stats);
}

export function openPath(computer: VirtualComputer, path: string): void {
  computer.attempt(() => computer.openPath(path));
}
