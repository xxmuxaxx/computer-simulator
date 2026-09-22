import { ApplicationRegistry } from '../core/applications/ApplicationRegistry';
import type { AppComponent } from './types';
import { FilesApp } from './files/FilesApp';
import { TerminalApp } from './terminal/TerminalApp';
import { EditorApp } from './editor/EditorApp';
import { TaskManagerApp } from './task-manager/TaskManagerApp';
import { SettingsApp } from './settings/SettingsApp';
import { StressApp } from './stress/StressApp';

/**
 * Every application the desktop can launch, registered once at startup. Adding an
 * application means adding an entry here - the desktop, launcher and window manager
 * never need to change.
 */
export const appRegistry = new ApplicationRegistry<AppComponent>();

appRegistry.register({
  id: 'files',
  name: 'Files',
  icon: 'folder',
  description: 'Browse, organize and manage your files',
  defaultWidth: 860,
  defaultHeight: 560,
  minWidth: 480,
  minHeight: 320,
  memoryUsage: 180,
  cpuUsage: 1.5,
  startupCpu: 8,
  processName: 'file-manager',
  component: FilesApp,
  system: true,
  category: 'system',
});

appRegistry.register({
  id: 'terminal',
  name: 'Terminal',
  icon: 'terminal',
  description: 'Command-line access to the virtual computer',
  defaultWidth: 680,
  defaultHeight: 440,
  minWidth: 360,
  minHeight: 240,
  memoryUsage: 90,
  cpuUsage: 1,
  startupCpu: 4,
  component: TerminalApp,
  system: true,
  category: 'system',
});

appRegistry.register({
  id: 'text-editor',
  name: 'Text Editor',
  icon: 'file-text',
  description: 'Create and edit text files',
  defaultWidth: 720,
  defaultHeight: 520,
  minWidth: 420,
  minHeight: 300,
  memoryUsage: 150,
  cpuUsage: 1.2,
  startupCpu: 6,
  component: EditorApp,
  system: true,
  category: 'system',
});

appRegistry.register({
  id: 'task-manager',
  name: 'Task Manager',
  icon: 'activity',
  description: 'Monitor CPU, memory and running processes',
  defaultWidth: 760,
  defaultHeight: 560,
  minWidth: 520,
  minHeight: 380,
  memoryUsage: 130,
  cpuUsage: 2,
  startupCpu: 6,
  component: TaskManagerApp,
  system: true,
  category: 'system',
});

appRegistry.register({
  id: 'settings',
  name: 'Settings',
  icon: 'settings',
  description: 'Configure appearance, system and applications',
  defaultWidth: 720,
  defaultHeight: 540,
  minWidth: 520,
  minHeight: 380,
  memoryUsage: 110,
  cpuUsage: 1,
  startupCpu: 5,
  component: SettingsApp,
  system: true,
  category: 'system',
});

appRegistry.register({
  id: 'heavy',
  name: 'System Benchmark',
  icon: 'flame',
  description: 'Demo application that stresses CPU and memory',
  defaultWidth: 520,
  defaultHeight: 460,
  minWidth: 420,
  minHeight: 400,
  memoryUsage: 900,
  cpuUsage: 3,
  startupCpu: 12,
  processName: 'benchmark',
  component: StressApp,
  category: 'demo',
});
