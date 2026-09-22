import type { VirtualFileSystem } from '../filesystem/VirtualFileSystem';
import { dirname, isInside, join, normalize } from '../../utils/path';
import { permissionDenied } from './RuntimeError';
import type { RuntimePermission } from './types';

/**
 * Sandboxed filesystem facade handed to a runtime application: every path is resolved relative
 * to a fixed root (its `/home/user/games/<id>` data directory) and cannot escape it, and every
 * operation is gated by the permissions granted in its manifest. This is the only filesystem
 * access a WASM module's imports can reach - never the raw VirtualFileSystem.
 */
export class RuntimeFileProvider {
  private fs: VirtualFileSystem;
  private root: string;
  private permissions: ReadonlySet<RuntimePermission>;

  constructor(fs: VirtualFileSystem, root: string, permissions: ReadonlySet<RuntimePermission>) {
    this.fs = fs;
    this.root = normalize(root);
    this.permissions = permissions;
  }

  exists(relPath: string): boolean {
    return this.fs.exists(this.resolve(relPath));
  }

  list(relPath = '.'): string[] {
    if (!this.permissions.has('fs:read')) throw permissionDenied(relPath, 'Missing fs:read permission');
    const dir = this.resolve(relPath);
    if (!this.fs.exists(dir)) return [];
    return this.fs.listDirectory(dir).map((s) => s.name);
  }

  readFile(relPath: string): Uint8Array {
    if (!this.permissions.has('fs:read')) throw permissionDenied(relPath, 'Missing fs:read permission');
    return this.fs.readBinary(this.resolve(relPath));
  }

  writeFile(relPath: string, data: Uint8Array): void {
    if (!this.permissions.has('fs:write')) throw permissionDenied(relPath, 'Missing fs:write permission');
    const full = this.resolve(relPath);
    const dir = dirname(full);
    if (!this.fs.exists(dir)) this.fs.createDirectory(dir, { recursive: true });
    this.fs.writeBinary(full, data);
  }

  private resolve(relPath: string): string {
    const full = join(this.root, relPath);
    if (!isInside(this.root, full)) throw permissionDenied(relPath, 'Path escapes the sandbox');
    return full;
  }
}
