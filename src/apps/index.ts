import { ApplicationRegistry } from '../core/applications/ApplicationRegistry';
import type { AppComponent } from './types';
import { FilesApp } from './files/FilesApp';
import { TerminalApp } from './terminal/TerminalApp';
import { EditorApp } from './editor/EditorApp';
import { TaskManagerApp } from './task-manager/TaskManagerApp';
import { SettingsApp } from './settings/SettingsApp';
import { StressApp } from './stress/StressApp';
import { NetworkManagerApp } from './network-manager/NetworkManagerApp';
import { NetworkMonitorApp } from './network-monitor/NetworkMonitorApp';
import { ServerManagerApp } from './server-manager/ServerManagerApp';
import { BrowserApp } from './browser/BrowserApp';
import { HostingManagerApp } from './hosting-manager/HostingManagerApp';
import { WebsiteBuilderApp } from './website-builder/WebsiteBuilderApp';
import { DomainManagerApp } from './domain-manager/DomainManagerApp';
import { SearchApp } from './search/SearchApp';
import { InternetControlPanelApp } from './internet-control-panel/InternetControlPanelApp';

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
  id: 'network-manager',
  name: 'Network Manager',
  icon: 'network',
  description: 'View and configure the virtual network: devices, addresses, routing and firewalls',
  defaultWidth: 900,
  defaultHeight: 620,
  minWidth: 640,
  minHeight: 440,
  memoryUsage: 150,
  cpuUsage: 1.5,
  startupCpu: 6,
  component: NetworkManagerApp,
  system: true,
  category: 'system',
});

appRegistry.register({
  id: 'network-monitor',
  name: 'Network Monitor',
  icon: 'radio',
  description: 'Watch live network traffic: ICMP, TCP, UDP, DNS and HTTP events',
  defaultWidth: 640,
  defaultHeight: 480,
  minWidth: 420,
  minHeight: 320,
  memoryUsage: 110,
  cpuUsage: 1,
  startupCpu: 4,
  component: NetworkMonitorApp,
  system: true,
  category: 'system',
});

appRegistry.register({
  id: 'server-manager',
  name: 'Server Manager',
  icon: 'server',
  description: 'Start, stop and inspect network services on any device',
  defaultWidth: 680,
  defaultHeight: 480,
  minWidth: 460,
  minHeight: 340,
  memoryUsage: 100,
  cpuUsage: 1,
  startupCpu: 4,
  component: ServerManagerApp,
  system: true,
  category: 'system',
});

appRegistry.register({
  id: 'browser',
  name: 'Browser',
  icon: 'globe',
  description: 'Browse virtual web sites hosted on the network',
  defaultWidth: 800,
  defaultHeight: 560,
  minWidth: 420,
  minHeight: 320,
  memoryUsage: 220,
  cpuUsage: 2,
  startupCpu: 8,
  component: BrowserApp,
  system: true,
  category: 'system',
});

appRegistry.register({
  id: 'domain-manager',
  name: 'Domain Manager',
  icon: 'link',
  description: 'Register, renew and release virtual domain names',
  defaultWidth: 640,
  defaultHeight: 560,
  minWidth: 480,
  minHeight: 400,
  memoryUsage: 100,
  cpuUsage: 1,
  startupCpu: 4,
  component: DomainManagerApp,
  system: true,
  category: 'system',
});

appRegistry.register({
  id: 'hosting-manager',
  name: 'Hosting Manager',
  icon: 'grid',
  description: 'Manage websites hosted on the virtual network: bind domains, view stats and logs',
  defaultWidth: 820,
  defaultHeight: 560,
  minWidth: 560,
  minHeight: 380,
  memoryUsage: 130,
  cpuUsage: 1,
  startupCpu: 5,
  component: HostingManagerApp,
  system: true,
  category: 'system',
});

appRegistry.register({
  id: 'website-builder',
  name: 'Website Builder',
  icon: 'file-plus',
  description: 'Create a new virtual website from a template',
  defaultWidth: 620,
  defaultHeight: 640,
  minWidth: 460,
  minHeight: 480,
  memoryUsage: 110,
  cpuUsage: 1,
  startupCpu: 4,
  component: WebsiteBuilderApp,
  system: true,
  category: 'system',
});

appRegistry.register({
  id: 'search',
  name: 'Virtual Search',
  icon: 'search',
  description: 'Search sites indexed from the virtual internet',
  defaultWidth: 620,
  defaultHeight: 640,
  minWidth: 420,
  minHeight: 420,
  memoryUsage: 120,
  cpuUsage: 1,
  startupCpu: 4,
  component: SearchApp,
  system: true,
  category: 'system',
});

appRegistry.register({
  id: 'internet-control-panel',
  name: 'Internet Control Panel',
  icon: 'shield',
  description: 'Dashboard for the Virtual Internet: domains, websites, servers and traffic',
  defaultWidth: 700,
  defaultHeight: 620,
  minWidth: 480,
  minHeight: 420,
  memoryUsage: 100,
  cpuUsage: 1,
  startupCpu: 4,
  component: InternetControlPanelApp,
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
