import { ApplicationRegistry } from '../applications/ApplicationRegistry';
import { VirtualComputer } from '../computer/VirtualComputer';
import { Shell } from '../shell/Shell';

export function createRegistry(): ApplicationRegistry {
  const registry = new ApplicationRegistry();
  const base = { icon: 'x', description: 'test app', defaultWidth: 400, defaultHeight: 300, component: null };
  registry.register({ ...base, id: 'files', name: 'Files', memoryUsage: 100, system: true });
  registry.register({ ...base, id: 'terminal', name: 'Terminal', memoryUsage: 80, system: true });
  registry.register({ ...base, id: 'text-editor', name: 'Text Editor', memoryUsage: 120, system: true });
  registry.register({ ...base, id: 'heavy', name: 'Heavy', memoryUsage: 3000 });
  return registry;
}

export function createComputer(): VirtualComputer {
  return new VirtualComputer({ applications: createRegistry(), random: () => 0.5 });
}

export function createShell(computer = createComputer()): { shell: Shell; computer: VirtualComputer } {
  return { shell: new Shell(computer), computer };
}
