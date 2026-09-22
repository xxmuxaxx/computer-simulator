import type { LaunchArgs } from '../applications/types';

export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WindowState extends Bounds {
  id: string;
  appId: string;
  title: string;
  pid: number;
  minimized: boolean;
  maximized: boolean;
  zIndex: number;
  args: LaunchArgs;
  /** Set by an application when it has unsaved work. */
  dirty: boolean;
  minWidth: number;
  minHeight: number;
}

export interface OpenWindowSpec {
  appId: string;
  title: string;
  pid: number;
  width: number;
  height: number;
  minWidth?: number;
  minHeight?: number;
  args?: LaunchArgs;
  x?: number;
  y?: number;
  minimized?: boolean;
  maximized?: boolean;
}

/** Persisted part of a window (ids and pids are reassigned on boot). */
export interface WindowSnapshot extends Bounds {
  appId: string;
  title: string;
  minimized: boolean;
  maximized: boolean;
  args: LaunchArgs;
  order: number;
}
