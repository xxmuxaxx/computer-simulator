/**
 * Describes an application. `component` is generic on purpose: the core layer never
 * touches React, the UI layer supplies whatever component type it needs.
 */
export interface ApplicationDefinition<TComponent = unknown> {
  id: string;
  name: string;
  /** Icon name resolved by the UI layer. */
  icon: string;
  description: string;
  defaultWidth: number;
  defaultHeight: number;
  /** Memory reserved while the application is running (MB). */
  memoryUsage: number;
  component: TComponent;
  /** Name shown in the process list. Defaults to `id`. */
  processName?: string;
  /** Baseline CPU usage (percent) while the window is in the foreground. */
  cpuUsage?: number;
  /** Short CPU burst (percent) when the application starts. */
  startupCpu?: number;
  minWidth?: number;
  minHeight?: number;
  /** Core applications cannot be uninstalled. */
  system?: boolean;
  category?: 'system' | 'utility' | 'development' | 'demo';
}

export type LaunchArgs = Record<string, string | number | boolean | undefined>;
