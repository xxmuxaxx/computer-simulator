import { ApplicationRegistry } from '../applications/ApplicationRegistry';
import { VirtualComputer, type ComputerOptions } from '../computer/VirtualComputer';
import type { RuntimeManager } from '../runtime/RuntimeManager';
import { decodeStubDoomWasm } from '../runtime/stub/stub-doom-bytes';
import type { RuntimeManifest } from '../runtime/types';
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

/**
 * Installs a runtime package backed by the placeholder stub engine, under the given app id
 * (default 'doom', matching `createRegistryWithDoom()`'s app registration). Used by tests that
 * exercise the *generic* runtime pipeline (launch/window/pause-resume/persistence) - deliberately
 * not `installDoom()`, which fetches the real ~4.5 MB third-party doom.wasm engine and would make
 * these tests depend on network access or a locally-placed binary.
 */
export function installStubGame(runtime: RuntimeManager, id = 'doom'): void {
  const manifest: RuntimeManifest = {
    id,
    name: 'Test Game',
    version: '1.0.0',
    type: 'game',
    engine: 'stub',
    executable: 'stub.wasm',
    memoryUsage: 32,
    cpuUsage: 8,
    display: { width: 4, height: 4 },
    permissions: ['fs:read', 'fs:write', 'input:keyboard', 'input:mouse', 'display:render'],
  };
  runtime.install(manifest, { 'stub.wasm': decodeStubDoomWasm() });
}
