import { useSyncExternalStore } from 'react';
import type { Observable } from '../utils/Observable';
import type { Settings } from '../core/settings/SettingsManager';
import type { Notification } from '../core/notifications/NotificationCenter';
import type { WindowState } from '../core/windows/types';
import type { Process } from '../core/process/ProcessManager';
import { useComputer } from './useComputer';

/** Re-renders the component whenever the observable changes; returns its version. */
export function useVersion(source: Observable): number {
  return useSyncExternalStore(source.subscribe, source.getVersion);
}

export function useSettings(): Settings {
  const { settings } = useComputer();
  return useSyncExternalStore(settings.subscribe, settings.getSnapshot);
}

export function useNotifications(): readonly Notification[] {
  const { notifications } = useComputer();
  return useSyncExternalStore(notifications.subscribe, notifications.getSnapshot);
}

export function useWindows(): readonly WindowState[] {
  const { windowManager } = useComputer();
  return useSyncExternalStore(windowManager.subscribe, windowManager.getWindows);
}

export function useWindow(id: string): WindowState | undefined {
  const { windowManager } = useComputer();
  useVersion(windowManager);
  return windowManager.get(id);
}

export function useInstalledApps(): readonly string[] {
  const { installedApps } = useComputer();
  return useSyncExternalStore(installedApps.subscribe, installedApps.getSnapshot);
}

/** Ticks with the simulation (once per second). */
export function useSimulation(): void {
  useVersion(useComputer());
}

export function useFileSystemVersion(): number {
  return useVersion(useComputer().fileSystem);
}

export function useProcesses(): Process[] {
  const computer = useComputer();
  useVersion(computer.processManager);
  return computer.processManager.list();
}
