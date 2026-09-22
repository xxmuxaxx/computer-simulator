import { create } from 'zustand';
import type { FileStats } from '../core/filesystem/types';

export interface MenuItem {
  label?: string;
  icon?: string;
  shortcut?: string;
  disabled?: boolean;
  danger?: boolean;
  separator?: boolean;
  onClick?: () => void;
}

export interface ContextMenuState {
  x: number;
  y: number;
  items: MenuItem[];
}

export interface ChoiceButton {
  label: string;
  value: string;
  variant?: 'primary' | 'danger' | 'default';
}

export type DialogRequest =
  | { id: number; kind: 'choice'; title: string; message: string; buttons: ChoiceButton[]; resolve: (v: string | null) => void }
  | {
      id: number;
      kind: 'prompt';
      title: string;
      label: string;
      initial: string;
      confirmLabel: string;
      selectStem: boolean;
      resolve: (v: string | null) => void;
    }
  | {
      id: number;
      kind: 'file-picker';
      mode: 'open' | 'save';
      title: string;
      initialDir: string;
      defaultName: string;
      resolve: (v: string | null) => void;
    }
  | { id: number; kind: 'properties'; stats: FileStats; resolve: (v: null) => void };

export interface Clipboard {
  paths: string[];
  mode: 'copy' | 'cut';
}

export interface SwitcherState {
  open: boolean;
  index: number;
}

interface UIState {
  launcherOpen: boolean;
  contextMenu: ContextMenuState | null;
  dialogs: DialogRequest[];
  clipboard: Clipboard | null;
  switcher: SwitcherState;
  desktopSelection: string | null;
  setLauncherOpen(open: boolean): void;
  toggleLauncher(): void;
  openContextMenu(menu: ContextMenuState): void;
  closeContextMenu(): void;
  setClipboard(clipboard: Clipboard | null): void;
  setSwitcher(state: SwitcherState): void;
  selectDesktop(path: string | null): void;
  pushDialog(dialog: DialogRequest): void;
  popDialog(id: number): void;
}

export const useUIStore = create<UIState>((set) => ({
  launcherOpen: false,
  contextMenu: null,
  dialogs: [],
  clipboard: null,
  switcher: { open: false, index: 0 },
  desktopSelection: null,
  setLauncherOpen: (launcherOpen) => set({ launcherOpen }),
  toggleLauncher: () => set((s) => ({ launcherOpen: !s.launcherOpen, contextMenu: null })),
  openContextMenu: (contextMenu) => set({ contextMenu, launcherOpen: false }),
  closeContextMenu: () => set({ contextMenu: null }),
  setClipboard: (clipboard) => set({ clipboard }),
  setSwitcher: (switcher) => set({ switcher }),
  selectDesktop: (desktopSelection) => set({ desktopSelection }),
  pushDialog: (dialog) => set((s) => ({ dialogs: [...s.dialogs, dialog] })),
  popDialog: (id) => set((s) => ({ dialogs: s.dialogs.filter((d) => d.id !== id) })),
}));

let dialogId = 0;

/** Promise-based modal dialogs, usable from any application. */
export const dialogs = {
  choose(options: { title: string; message: string; buttons: ChoiceButton[] }): Promise<string | null> {
    return new Promise((resolve) =>
      useUIStore.getState().pushDialog({ id: ++dialogId, kind: 'choice', ...options, resolve }),
    );
  },

  async confirm(options: { title: string; message: string; confirmLabel?: string; danger?: boolean }): Promise<boolean> {
    const result = await dialogs.choose({
      title: options.title,
      message: options.message,
      buttons: [
        { label: 'Cancel', value: 'cancel' },
        { label: options.confirmLabel ?? 'OK', value: 'ok', variant: options.danger ? 'danger' : 'primary' },
      ],
    });
    return result === 'ok';
  },

  prompt(options: { title: string; label: string; initial?: string; confirmLabel?: string; selectStem?: boolean }): Promise<string | null> {
    return new Promise((resolve) =>
      useUIStore.getState().pushDialog({
        id: ++dialogId,
        kind: 'prompt',
        title: options.title,
        label: options.label,
        initial: options.initial ?? '',
        confirmLabel: options.confirmLabel ?? 'OK',
        selectStem: options.selectStem ?? false,
        resolve,
      }),
    );
  },

  pickFile(options: { mode: 'open' | 'save'; title?: string; initialDir: string; defaultName?: string }): Promise<string | null> {
    return new Promise((resolve) =>
      useUIStore.getState().pushDialog({
        id: ++dialogId,
        kind: 'file-picker',
        mode: options.mode,
        title: options.title ?? (options.mode === 'open' ? 'Open File' : 'Save As'),
        initialDir: options.initialDir,
        defaultName: options.defaultName ?? '',
        resolve,
      }),
    );
  },

  properties(stats: FileStats): Promise<null> {
    return new Promise((resolve) =>
      useUIStore.getState().pushDialog({ id: ++dialogId, kind: 'properties', stats, resolve }),
    );
  },
};
