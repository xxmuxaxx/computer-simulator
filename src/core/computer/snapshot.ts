import type { FileSystemSnapshot } from '../filesystem/types';
import type { Settings } from '../settings/SettingsManager';
import type { WindowSnapshot } from '../windows/types';

export const SNAPSHOT_VERSION = 1;

/** Everything that is persisted between sessions. */
export interface ComputerSnapshot {
  version: typeof SNAPSHOT_VERSION;
  savedAt: number;
  filesystem: FileSystemSnapshot;
  settings: Settings;
  installedApps: string[];
  windows: WindowSnapshot[];
}
