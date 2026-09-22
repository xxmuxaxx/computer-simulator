import { runtimeError } from '../RuntimeError';
import type { RuntimeFileProvider } from '../RuntimeFileProvider';
import type { RuntimeManager } from '../RuntimeManager';
import type { RuntimeManifest } from '../types';

/**
 * DOOM's adapter onto the generic Virtual Application Runtime.
 *
 * Engine: https://github.com/jacobenget/doom.wasm (GPL-2.0), a WebAssembly build of Doom with a
 * deliberately minimal interface (10 imports, 4 exports - see `DoomEngineAdapter.ts`, which
 * implements that interface). It embeds id Software's officially freely-distributable Doom
 * Shareware WAD as a built-in fallback, so the game plays immediately with no separate IWAD
 * download; a player can still supply their own legally obtained retail WAD through the "Select
 * File" picker (`DOOM_WAD_RELATIVE_PATH`), which then takes priority. See docs/runtime.md for
 * full attribution and the exact release used.
 *
 * The engine binary itself is fetched from `public/runtime/doom/doom.wasm` at install time - a
 * ~4.5 MB third-party binary that is intentionally *not* committed to this repository (see
 * `.gitignore` and `public/runtime/doom/README.md` for how to obtain it).
 */
export const DOOM_APP_ID = 'doom';
export const DOOM_WAD_RELATIVE_PATH = 'wad/DOOM.WAD';
const DOOM_WASM_URL = `${import.meta.env.BASE_URL}runtime/doom/doom.wasm`;

export function createDoomManifest(): RuntimeManifest {
  return {
    id: DOOM_APP_ID,
    name: 'DOOM',
    version: '1.0.0',
    type: 'game',
    engine: 'doom-wasm',
    executable: 'doom.wasm',
    icon: 'gamepad',
    description: 'Doom, running on the doom.wasm engine (github.com/jacobenget/doom.wasm, GPL-2.0).',
    memoryUsage: 32,
    cpuUsage: 8,
    // This build reports its actual frame buffer as 640x400 via onGameInit() (a native 320x200
    // DOOM screen auto-scaled 2x internally) - not the 320x200 one might expect from vanilla
    // DOOM, confirmed against the real engine's own startup log.
    display: { width: 640, height: 400 },
    permissions: ['fs:read', 'fs:write', 'input:keyboard', 'input:mouse', 'display:render'],
  };
}

const WAD_MAGIC = ['IWAD', 'PWAD'];

/**
 * Minimal validation: every real WAD file starts with the 4-byte ASCII magic "IWAD" or "PWAD".
 * This has to be checked *before* a file ever reaches the engine, not just as a nicety - feeding
 * doom.wasm something without a valid WAD header doesn't fail gracefully (its W_Init treats it as
 * a fatal error, and at least this build doesn't reliably return control to the host afterwards),
 * so an invalid upload must never be written and restarted into.
 */
export function isValidWadHeader(bytes: Uint8Array): boolean {
  if (bytes.byteLength < 4) return false;
  return WAD_MAGIC.includes(new TextDecoder('ascii').decode(bytes.slice(0, 4)));
}

/** Fetches the engine binary. Overridable so tests never need the real ~4.5 MB file on disk. */
export async function fetchDoomEngineBytes(fetchImpl: typeof fetch = fetch): Promise<Uint8Array> {
  let response: Response;
  try {
    response = await fetchImpl(DOOM_WASM_URL);
  } catch (e) {
    throw runtimeError(DOOM_WASM_URL, `Could not reach the DOOM engine file: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!response.ok) {
    throw runtimeError(
      DOOM_WASM_URL,
      `DOOM engine file not found (HTTP ${response.status}). See public/runtime/doom/README.md for how to obtain it.`,
    );
  }
  return new Uint8Array(await response.arrayBuffer());
}

/** One-call installer: `await installDoom(computer.runtime)`. */
export async function installDoom(runtime: RuntimeManager, fetchImpl: typeof fetch = fetch): Promise<void> {
  const bytes = await fetchDoomEngineBytes(fetchImpl);
  runtime.install(createDoomManifest(), { 'doom.wasm': bytes });
}

/** Existence-only check - the runtime doesn't parse WAD contents, only that one was supplied. */
export function hasWad(fileProvider: RuntimeFileProvider): boolean {
  return fileProvider.exists(DOOM_WAD_RELATIVE_PATH);
}
