import { ApplicationRegistry } from '../applications/ApplicationRegistry';
import { VirtualComputer, type ComputerOptions } from '../computer/VirtualComputer';
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

export function createComputer(overrides: Partial<ComputerOptions> = {}): VirtualComputer {
  return new VirtualComputer({ applications: createRegistry(), random: () => 0.5, ...overrides });
}

/** A registry that also has a 'doom' entry, for runtime/games tests that launch it. */
export function createRegistryWithDoom(): ApplicationRegistry {
  const registry = createRegistry();
  registry.register({
    id: 'doom',
    name: 'DOOM',
    icon: 'gamepad',
    description: 'test doom app',
    defaultWidth: 320,
    defaultHeight: 200,
    memoryUsage: 32,
    component: null,
  });
  return registry;
}

export function createComputerWithDoom(overrides: Partial<ComputerOptions> = {}): VirtualComputer {
  return createComputer({ applications: createRegistryWithDoom(), ...overrides });
}

export function createShell(computer = createComputer()): { shell: Shell; computer: VirtualComputer } {
  return { shell: new Shell(computer), computer };
}
