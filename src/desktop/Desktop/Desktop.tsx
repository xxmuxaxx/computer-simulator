import { useEffect, useRef, type MouseEvent } from 'react';
import { ContextMenuHost, showContextMenu } from '../../components/ContextMenu';
import { DialogHost } from '../../components/Dialogs';
import { DESKTOP } from '../../core/filesystem/seed';
import { useComputer } from '../../hooks/useComputer';
import { useSettings } from '../../hooks/useObservable';
import { paste, promptCreate } from '../../store/fileActions';
import { useUIStore } from '../../store/uiStore';
import { launchApp } from '../actions';
import { Launcher } from '../Launcher/Launcher';
import { Taskbar, TopBar } from '../Taskbar/Taskbar';
import { useShortcuts } from '../useShortcuts';
import { getWallpaper } from '../wallpapers';
import { WindowLayer } from '../WindowManager/WindowLayer';
import { DesktopIcons } from './DesktopIcons';
import { DebugPanel, Toasts, WindowSwitcher } from './Overlays';

export function Desktop() {
  const computer = useComputer();
  const settings = useSettings();
  const areaRef = useRef<HTMLDivElement>(null);
  const clipboard = useUIStore((s) => s.clipboard);
  useShortcuts();

  useEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    const update = () => computer.windowManager.setWorkArea(el.clientWidth, el.clientHeight);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [computer]);

  const onContextMenu = (e: MouseEvent) => {
    showContextMenu(e, [
      { label: 'New Folder', icon: 'folder-plus', onClick: () => void promptCreate(computer, DESKTOP, 'folder') },
      { label: 'New Text File', icon: 'file-plus', onClick: () => void promptCreate(computer, DESKTOP, 'file') },
      ...(clipboard ? [{ label: 'Paste', icon: 'paste', onClick: () => paste(computer, DESKTOP) }] : []),
      { separator: true },
      { label: 'Refresh', icon: 'refresh', onClick: () => computer.fileSystem.refresh() },
      { separator: true },
      { label: 'Display Settings', icon: 'palette', onClick: () => launchApp(computer, 'settings', { page: 'appearance' }) },
      { label: 'System Settings', icon: 'settings', onClick: () => launchApp(computer, 'settings') },
    ]);
  };

  return (
    <div className="os">
      <TopBar />
      <div
        ref={areaRef}
        className="desktop-area"
        style={{ background: getWallpaper(settings.wallpaper).background }}
        onContextMenu={onContextMenu}
        onPointerDown={() => useUIStore.getState().closeContextMenu()}
      >
        <DesktopIcons />
        <WindowLayer />
        {settings.showDebugPanel && <DebugPanel />}
        <Toasts />
        <Launcher />
      </div>
      <Taskbar />
      <WindowSwitcher />
      <ContextMenuHost />
      <DialogHost />
    </div>
  );
}
