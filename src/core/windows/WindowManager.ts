import { SystemError } from '../errors';
import type { LaunchArgs } from '../applications/types';
import { Observable } from '../../utils/Observable';
import { clamp } from '../../utils/format';
import { uid } from '../../utils/id';
import type { Bounds, OpenWindowSpec, WindowSnapshot, WindowState } from './types';

/**
 * Pure window state: geometry, stacking and focus. Rendering lives in the desktop layer.
 * Window objects are immutable; every change replaces only the affected window so that
 * views can rely on reference equality.
 */
export class WindowManager extends Observable {
  private windows = new Map<string, WindowState>();
  private zCounter = 1;
  private openedCount = 0;
  private _workArea = { width: 1280, height: 720 };
  private cache: readonly WindowState[] = [];

  get workArea(): { width: number; height: number } {
    return this._workArea;
  }

  setWorkArea(width: number, height: number): void {
    if (width === this._workArea.width && height === this._workArea.height) return;
    this._workArea = { width, height };
    this.emit();
  }

  /** Immutable array snapshot in creation order; replaced whenever anything changes. */
  getWindows = (): readonly WindowState[] => this.cache;

  get(id: string): WindowState | undefined {
    return this.windows.get(id);
  }

  count(): number {
    return this.windows.size;
  }

  open(spec: OpenWindowSpec): WindowState {
    const { width: aw, height: ah } = this._workArea;
    const width = Math.min(spec.width, Math.max(320, aw - 24));
    const height = Math.min(spec.height, Math.max(200, ah - 24));
    const step = this.openedCount++ % 8;
    const win: WindowState = {
      id: uid('win'),
      appId: spec.appId,
      title: spec.title,
      pid: spec.pid,
      x: spec.x ?? clamp(48 + step * 32, 0, Math.max(0, aw - width)),
      y: spec.y ?? clamp(32 + step * 32, 0, Math.max(0, ah - height)),
      width,
      height,
      minimized: spec.minimized ?? false,
      maximized: spec.maximized ?? false,
      zIndex: this.zCounter++,
      args: spec.args ?? {},
      dirty: false,
      minWidth: spec.minWidth ?? 360,
      minHeight: spec.minHeight ?? 240,
    };
    this.windows.set(win.id, win);
    this.commit();
    return win;
  }

  close(id: string): WindowState {
    const win = this.require(id);
    this.windows.delete(id);
    this.commit();
    return win;
  }

  /** Brings a window to the front and restores it if minimized. */
  focus(id: string): void {
    const win = this.require(id);
    if (win.minimized || this.activeId !== id) this.patch(id, { minimized: false, zIndex: this.zCounter++ });
  }

  minimize(id: string): void {
    if (this.require(id).minimized) return;
    this.patch(id, { minimized: true });
  }

  toggleMaximize(id: string): void {
    const win = this.require(id);
    this.patch(id, { maximized: !win.maximized, minimized: false, zIndex: this.zCounter++ });
  }

  /** Clicking a taskbar entry: restore, focus, or minimize if it is already active. */
  toggleFromTaskbar(id: string): void {
    const win = this.require(id);
    if (!win.minimized && this.activeId === id) this.minimize(id);
    else this.focus(id);
  }

  move(id: string, x: number, y: number): void {
    const win = this.require(id);
    const { width: aw, height: ah } = this._workArea;
    // Keep the title bar reachable.
    this.patch(id, {
      x: clamp(x, -win.width + 120, aw - 80),
      y: clamp(y, 0, Math.max(0, ah - 36)),
    });
  }

  setBounds(id: string, bounds: Bounds): void {
    const win = this.require(id);
    this.patch(id, {
      x: bounds.x,
      y: Math.max(0, bounds.y),
      width: Math.max(win.minWidth, bounds.width),
      height: Math.max(win.minHeight, bounds.height),
    });
  }

  setTitle(id: string, title: string): void {
    const win = this.windows.get(id);
    if (win && win.title !== title) this.patch(id, { title });
  }

  setDirty(id: string, dirty: boolean): void {
    const win = this.windows.get(id);
    if (win && win.dirty !== dirty) this.patch(id, { dirty });
  }

  /** Merges launch arguments (persisted with the desktop state, e.g. the folder shown in Files). */
  setArgs(id: string, args: LaunchArgs): void {
    const win = this.windows.get(id);
    if (!win) return;
    const next = { ...win.args, ...args };
    if (JSON.stringify(next) !== JSON.stringify(win.args)) this.patch(id, { args: next });
  }

  /** The visible window with the highest z-index. */
  get activeId(): string | null {
    let best: WindowState | null = null;
    for (const w of this.windows.values()) {
      if (!w.minimized && (!best || w.zIndex > best.zIndex)) best = w;
    }
    return best?.id ?? null;
  }

  /** Windows ordered most-recently-used first (for Alt+Tab). */
  getSwitcherOrder(): WindowState[] {
    return [...this.windows.values()].sort((a, b) => b.zIndex - a.zIndex);
  }

  findByPid(pid: number): WindowState[] {
    return [...this.windows.values()].filter((w) => w.pid === pid);
  }

  serialize(): WindowSnapshot[] {
    return [...this.windows.values()].map((w) => ({
      appId: w.appId,
      title: w.title,
      x: w.x,
      y: w.y,
      width: w.width,
      height: w.height,
      minimized: w.minimized,
      maximized: w.maximized,
      args: { ...w.args },
      order: w.zIndex,
    }));
  }

  clear(): void {
    this.windows.clear();
    this.commit();
  }

  private require(id: string): WindowState {
    const win = this.windows.get(id);
    if (!win) throw new SystemError('EINVAL', id, 'Window not found');
    return win;
  }

  private patch(id: string, changes: Partial<WindowState>): void {
    this.windows.set(id, { ...this.require(id), ...changes });
    this.commit();
  }

  private commit(): void {
    this.cache = [...this.windows.values()];
    this.emit();
  }
}
