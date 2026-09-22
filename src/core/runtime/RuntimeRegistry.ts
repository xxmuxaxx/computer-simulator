import { SystemError } from '../errors';
import type { VirtualFileSystem } from '../filesystem/VirtualFileSystem';
import { parseManifest, serializeManifest } from './RuntimeManifest';
import type { RuntimeManifest } from './types';

export const APPS_ROOT = '/apps';

/**
 * Tracks installed runtime applications. There is no separate in-memory store to keep in sync:
 * "installed" means `/apps/<id>/manifest.json` exists in the VirtualFileSystem, which already
 * round-trips through the existing filesystem snapshot - so installing a game needs no new
 * persistence surface at all.
 *
 * `seedFileSystem()` locks `/apps` (readonly) once at boot, after writing the built-in `.app`
 * manifests, so installing/removing a package here must temporarily unlock it the same way -
 * exactly mirroring seedFileSystem's own write-then-lock order.
 */
export class RuntimeRegistry {
  private fs: VirtualFileSystem;

  constructor(fs: VirtualFileSystem) {
    this.fs = fs;
  }

  list(): RuntimeManifest[] {
    if (!this.fs.exists(APPS_ROOT)) return [];
    const out: RuntimeManifest[] = [];
    for (const entry of this.fs.listDirectory(APPS_ROOT)) {
      if (entry.type !== 'directory') continue;
      const manifestPath = `${APPS_ROOT}/${entry.name}/manifest.json`;
      if (!this.fs.exists(manifestPath)) continue;
      try {
        out.push(parseManifest(this.fs.readFile(manifestPath)));
      } catch {
        // A corrupted package is skipped rather than crashing the whole registry listing.
      }
    }
    return out;
  }

  get(id: string): RuntimeManifest | undefined {
    return this.list().find((m) => m.id === id);
  }

  /**
   * Installs (or reinstalls/repairs) a package. Deliberately does **not** gate on `get(id)` -
   * that depends on the existing manifest still being parseable, and a package directory can be
   * left behind in a broken state (a stale schema from before a manifest field was added, a
   * partial previous install, ...). Detecting "already there" from `fs.exists(dir)` directly and
   * always wiping+replacing means installing is idempotent and self-healing: there's no state a
   * broken `/apps/<id>/` can get stuck in that "Install" can't recover from.
   */
  install(manifest: RuntimeManifest, files: Record<string, Uint8Array>): void {
    const dir = `${APPS_ROOT}/${manifest.id}`;
    this.withUnlockedApps(() => {
      if (this.fs.exists(dir)) {
        this.fs.setAttributes(dir, { readonly: false, protected: false });
        this.fs.delete(dir, { recursive: true });
      }
      this.fs.createDirectory(dir, { recursive: true });
      this.fs.writeFile(`${dir}/manifest.json`, serializeManifest(manifest));
      for (const [name, bytes] of Object.entries(files)) {
        this.fs.writeBinary(`${dir}/${name}`, bytes);
      }
      for (const stat of this.fs.walk(dir)) this.fs.setAttributes(stat.path, { readonly: true });
      this.fs.setAttributes(dir, { readonly: true, protected: true });
    });
  }

  remove(id: string): void {
    const dir = `${APPS_ROOT}/${id}`;
    if (!this.fs.exists(dir)) throw new SystemError('ENOENT', id);
    this.withUnlockedApps(() => {
      this.fs.setAttributes(dir, { readonly: false, protected: false });
      this.fs.delete(dir, { recursive: true });
    });
  }

  private withUnlockedApps(fn: () => void): void {
    const wasReadonly = this.fs.exists(APPS_ROOT) && this.fs.getStats(APPS_ROOT).readonly;
    if (wasReadonly) this.fs.setAttributes(APPS_ROOT, { readonly: false });
    try {
      fn();
    } finally {
      if (wasReadonly) this.fs.setAttributes(APPS_ROOT, { readonly: true });
    }
  }
}
