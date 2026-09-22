import type { FileStats } from '../core/filesystem/types';
import { SHORTCUT_EXT } from '../core/filesystem/seed';
import { extname } from '../utils/path';
import { AppIcon, Icon } from './Icon';

/** Icon that matches a file system entry (folder, shortcut, text file...). */
export function FileTypeIcon({ stats, size = 18, tile = false }: { stats: FileStats; size?: number; tile?: boolean }) {
  if (tile) {
    const name = stats.type === 'directory' ? 'folder' : extname(stats.name) === SHORTCUT_EXT ? 'link' : 'file-text';
    return <AppIcon name={name} size={size} />;
  }
  if (stats.type === 'directory') return <Icon name="folder" size={size} className="ico-folder" />;
  if (extname(stats.name) === SHORTCUT_EXT) return <Icon name="link" size={size} className="ico-link" />;
  return <Icon name="file-text" size={size} className="ico-file" />;
}
