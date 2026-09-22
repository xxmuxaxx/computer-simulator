import { runtimeError } from '../RuntimeError';
import { createDoomEngineAdapter } from '../doom/DoomEngineAdapter';
import { createStubEngineAdapter } from './stubEngine';
import type { EngineAdapter, EngineAdapterFactory, EngineHost } from './types';

export type { EngineAdapter, EngineAdapterFactory, EngineHost } from './types';

/**
 * The known engines a RuntimeManifest's `engine` field can select. This is the one place that
 * knows both "stub" and "doom-wasm" exist - exactly like `commands/index.ts` aggregating
 * `networkCommands`/`internetCommands`/`gamesCommands`, or `apps/index.ts` mapping an app id to
 * its component. ApplicationRuntime/RuntimeInstance never import from here; they only ever see
 * the `EngineAdapter` a factory produces.
 */
const ENGINE_ADAPTERS: Record<string, EngineAdapterFactory> = {
  stub: createStubEngineAdapter,
  'doom-wasm': createDoomEngineAdapter,
};

export function resolveEngineAdapter(engine: string, host: EngineHost): EngineAdapter {
  const factory = ENGINE_ADAPTERS[engine];
  if (!factory) throw runtimeError(engine, `Unknown runtime engine "${engine}"`);
  return factory(host);
}
