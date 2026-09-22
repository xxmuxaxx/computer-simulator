import { describe, expect, it } from 'vitest';
import { seedFileSystem } from '../filesystem/seed';
import { VirtualFileSystem } from '../filesystem/VirtualFileSystem';
import { runtimeError } from '../runtime/RuntimeError';
import { RuntimeRegistry } from '../runtime/RuntimeRegistry';
import type { RuntimeManifest } from '../runtime/types';

function manifest(overrides: Partial<RuntimeManifest> = {}): RuntimeManifest {
  return {
    id: 'doom',
    name: 'DOOM',
    version: '1.0.0',
    type: 'game',
    executable: 'doom.wasm',
    memoryUsage: 32,
    display: { width: 320, height: 200 },
    permissions: ['fs:read', 'fs:write', 'input:keyboard', 'input:mouse', 'display:render'],
    ...overrides,
  };
}

describe('RuntimeRegistry', () => {
  it('installs a package into /apps/<id>/, locked down like other system files', () => {
    const fs = new VirtualFileSystem();
    seedFileSystem(fs, []);
    const registry = new RuntimeRegistry(fs);

    registry.install(manifest(), { 'doom.wasm': new Uint8Array([1, 2, 3]) });

    expect(fs.exists('/apps/doom/manifest.json')).toBe(true);
    expect(fs.exists('/apps/doom/doom.wasm')).toBe(true);
    expect(fs.readBinary('/apps/doom/doom.wasm')).toEqual(new Uint8Array([1, 2, 3]));
    expect(fs.getStats('/apps/doom/manifest.json').readonly).toBe(true);
    expect(fs.getStats('/apps/doom').readonly).toBe(true);
    // /apps itself is re-locked afterwards - installing didn't leave it writable.
    expect(fs.getStats('/apps').readonly).toBe(true);
  });

  it('lists installed manifests and looks one up by id', () => {
    const fs = new VirtualFileSystem();
    seedFileSystem(fs, []);
    const registry = new RuntimeRegistry(fs);
    expect(registry.list()).toEqual([]);

    registry.install(manifest(), { 'doom.wasm': new Uint8Array([1]) });
    expect(registry.list().map((m) => m.id)).toEqual(['doom']);
    expect(registry.get('doom')?.name).toBe('DOOM');
    expect(registry.get('missing')).toBeUndefined();
  });

  it('refuses to install the same id twice', () => {
    const fs = new VirtualFileSystem();
    seedFileSystem(fs, []);
    const registry = new RuntimeRegistry(fs);
    registry.install(manifest(), { 'doom.wasm': new Uint8Array([1]) });
    expect(() => registry.install(manifest(), { 'doom.wasm': new Uint8Array([1]) })).toThrowError('Already installed');
  });

  it('removes a package and re-locks /apps afterwards', () => {
    const fs = new VirtualFileSystem();
    seedFileSystem(fs, []);
    const registry = new RuntimeRegistry(fs);
    registry.install(manifest(), { 'doom.wasm': new Uint8Array([1]) });

    registry.remove('doom');

    expect(fs.exists('/apps/doom')).toBe(false);
    expect(registry.list()).toEqual([]);
    expect(fs.getStats('/apps').readonly).toBe(true);
  });

  it('removing an uninstalled id throws ENOENT', () => {
    const fs = new VirtualFileSystem();
    seedFileSystem(fs, []);
    const registry = new RuntimeRegistry(fs);
    expect(() => registry.remove('nope')).toThrowError('File not found');
  });

  it('skips a corrupted manifest instead of throwing from list()', () => {
    const fs = new VirtualFileSystem();
    seedFileSystem(fs, []);
    fs.setAttributes('/apps', { readonly: false });
    fs.createDirectory('/apps/broken');
    fs.writeFile('/apps/broken/manifest.json', '{ not json');
    fs.setAttributes('/apps', { readonly: true });

    const registry = new RuntimeRegistry(fs);
    expect(registry.list()).toEqual([]);
  });

  it('works even without seedFileSystem having created /apps yet', () => {
    const fs = new VirtualFileSystem();
    const registry = new RuntimeRegistry(fs);
    expect(registry.list()).toEqual([]);
    registry.install(manifest(), { 'doom.wasm': new Uint8Array([1]) });
    expect(registry.get('doom')).toBeDefined();
  });

  it('runtimeError() carries the ERUNTIME code used for malformed manifests', () => {
    expect(runtimeError('doom', 'bad').code).toBe('ERUNTIME');
  });
});
