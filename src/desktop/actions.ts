import type { VirtualComputer } from '../core/computer/VirtualComputer';
import type { LaunchArgs } from '../core/applications/types';
import { dialogs } from '../store/uiStore';
import { useUIStore } from '../store/uiStore';

export function launchApp(computer: VirtualComputer, appId: string, args?: LaunchArgs): void {
  useUIStore.getState().setLauncherOpen(false);
  computer.attempt(() => computer.launch(appId, { args }));
}

/** Closes a window, asking first when the application reports unsaved work. */
export async function requestCloseWindow(computer: VirtualComputer, windowId: string): Promise<void> {
  const win = computer.windowManager.get(windowId);
  if (!win) return;
  if (win.dirty) {
    computer.windowManager.focus(windowId);
    const ok = await dialogs.confirm({
      title: 'Unsaved changes',
      message: `"${win.title}" has unsaved changes. Close it anyway?`,
      confirmLabel: 'Discard changes',
      danger: true,
    });
    if (!ok) return;
  }
  computer.closeWindow(windowId);
}
