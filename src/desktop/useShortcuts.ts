import { useEffect } from 'react';
import { useComputer } from '../hooks/useComputer';
import { dispatchWindowCommand, type WindowCommand } from '../hooks/windowCommands';
import { useUIStore } from '../store/uiStore';
import { launchApp, requestCloseWindow } from './actions';

function isEditable(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable;
}

/** Global keyboard shortcuts of the virtual OS. */
export function useShortcuts(): void {
  const computer = useComputer();

  useEffect(() => {
    const wm = computer.windowManager;
    const ui = useUIStore;

    const closeSwitcher = (commit: boolean) => {
      const { switcher } = ui.getState();
      if (!switcher.open) return;
      if (commit) {
        const target = wm.getSwitcherOrder()[switcher.index];
        if (target) wm.focus(target.id);
      }
      ui.getState().setSwitcher({ open: false, index: 0 });
    };

    const routeToWindow = (e: KeyboardEvent, command: WindowCommand, alwaysPrevent = false) => {
      const id = wm.activeId;
      const handled = id ? dispatchWindowCommand(id, command) : false;
      if (handled || alwaysPrevent) e.preventDefault();
      return handled;
    };

    const onKeyDown = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      const mod = e.ctrlKey || e.metaKey;

      if (e.altKey && e.key === 'Tab') {
        e.preventDefault();
        const n = wm.count();
        if (n === 0) return;
        const { switcher, setSwitcher } = ui.getState();
        const step = e.shiftKey ? -1 : 1;
        const index = switcher.open ? (switcher.index + step + n) % n : n > 1 ? (step === 1 ? 1 : n - 1) : 0;
        setSwitcher({ open: true, index });
        return;
      }

      if (ui.getState().dialogs.length > 0) return;

      if (mod && e.altKey && key === 't') {
        e.preventDefault();
        launchApp(computer, 'terminal');
      } else if ((mod && !e.shiftKey && !e.altKey && key === 'w') || (e.altKey && !mod && key === 'w')) {
        e.preventDefault();
        const id = wm.activeId;
        if (id) void requestCloseWindow(computer, id);
      } else if (mod && e.shiftKey && key === 'd') {
        e.preventDefault();
        computer.settings.update({ showDebugPanel: !computer.settings.getSnapshot().showDebugPanel });
      } else if (mod && key === 's') {
        routeToWindow(e, e.shiftKey ? 'saveAs' : 'save', true);
      } else if (mod && !e.shiftKey && key === 'n') {
        routeToWindow(e, 'newFile');
      } else if (mod && !e.shiftKey && key === 'o') {
        routeToWindow(e, 'open');
      } else if (mod && !e.shiftKey && key === 'f') {
        routeToWindow(e, 'find');
      } else if (!mod && !e.altKey && (e.key === 'Delete' || e.key === 'F2')) {
        if (isEditable(e.target) || (e.target as HTMLElement | null)?.closest?.('.desktop-icons')) return;
        routeToWindow(e, e.key === 'Delete' ? 'delete' : 'rename');
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Alt') closeSwitcher(true);
    };
    const onBlur = () => closeSwitcher(false);

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, [computer]);
}
