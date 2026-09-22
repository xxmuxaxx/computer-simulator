import { join } from '../../utils/path';
import type { VirtualFileSystem } from './VirtualFileSystem';

/** Returns a path inside `dir` that does not exist yet: "New Folder", "New Folder 2", ... */
export function uniquePath(fs: VirtualFileSystem, dir: string, base: string, ext = ''): string {
  let candidate = join(dir, base + ext);
  for (let i = 2; fs.exists(candidate); i++) candidate = join(dir, `${base} ${i}${ext}`);
  return candidate;
}
