import { SNAPSHOT_VERSION, type ComputerSnapshot } from '../computer/snapshot';
import type { StorageBackend } from './backends';

const KEYS = ['meta', 'filesystem', 'settings', 'installedApps', 'windows'] as const;

interface Meta {
  version: number;
  savedAt: number;
}

/** Saves and loads computer snapshots. Each domain is stored under its own key. */
export class ComputerStorage {
  constructor(private readonly backend: StorageBackend) {}

  async save(snapshot: ComputerSnapshot): Promise<void> {
    const meta: Meta = { version: snapshot.version, savedAt: snapshot.savedAt };
    await this.backend.setMany({
      meta,
      filesystem: snapshot.filesystem,
      settings: snapshot.settings,
      installedApps: snapshot.installedApps,
      windows: snapshot.windows,
    });
  }

  /** Returns null when nothing (valid) has been saved yet. */
  async load(): Promise<ComputerSnapshot | null> {
    const data = await this.backend.getMany(KEYS);
    const meta = data.meta as Meta | undefined;
    if (!meta || meta.version !== SNAPSHOT_VERSION) return null;
    const fs = data.filesystem as ComputerSnapshot['filesystem'] | undefined;
    if (!fs || !Array.isArray(fs.nodes) || !fs.nodes.some((n) => n.id === fs.rootId)) return null;
    return {
      version: SNAPSHOT_VERSION,
      savedAt: meta.savedAt,
      filesystem: fs,
      settings: (data.settings ?? {}) as ComputerSnapshot['settings'],
      installedApps: Array.isArray(data.installedApps) ? (data.installedApps as string[]) : [],
      windows: Array.isArray(data.windows) ? (data.windows as ComputerSnapshot['windows']) : [],
    };
  }

  /** Deletes every piece of saved data. */
  async reset(): Promise<void> {
    await this.backend.clear();
  }
}
