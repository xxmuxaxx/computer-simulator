import { describe, expect, it } from 'vitest';
import { SystemError } from '../errors';
import { VirtualFileSystem } from '../filesystem/VirtualFileSystem';
import { RuntimeDisplay } from '../runtime/RuntimeDisplay';
import { RuntimeFileProvider } from '../runtime/RuntimeFileProvider';
import { RuntimeInput } from '../runtime/RuntimeInput';
import type { RuntimePermission } from '../runtime/types';

const code = (fn: () => unknown): string | undefined => {
  try {
    fn();
  } catch (e) {
    return e instanceof SystemError ? e.code : 'OTHER';
  }
  return undefined;
};

function perms(...list: RuntimePermission[]): ReadonlySet<RuntimePermission> {
  return new Set(list);
}

describe('RuntimeFileProvider', () => {
  it('denies reads and writes without the matching permission', () => {
    const fs = new VirtualFileSystem();
    fs.createDirectory('/home/user/games/doom', { recursive: true });
    const provider = new RuntimeFileProvider(fs, '/home/user/games/doom', perms());
    expect(code(() => provider.readFile('config/settings.json'))).toBe('EPERMISSION');
    expect(code(() => provider.writeFile('saves/slot1', new Uint8Array([1])))).toBe('EPERMISSION');
  });

  it('allows reads/writes once granted, scoped under its root', () => {
    const fs = new VirtualFileSystem();
    fs.createDirectory('/home/user/games/doom', { recursive: true });
    const provider = new RuntimeFileProvider(fs, '/home/user/games/doom', perms('fs:read', 'fs:write'));
    provider.writeFile('saves/slot1', new Uint8Array([1, 2, 3]));
    expect(fs.readBinary('/home/user/games/doom/saves/slot1')).toEqual(new Uint8Array([1, 2, 3]));
    expect(provider.readFile('saves/slot1')).toEqual(new Uint8Array([1, 2, 3]));
    expect(provider.list('saves')).toEqual(['slot1']);
  });

  it('refuses to escape its root even with permission granted', () => {
    const fs = new VirtualFileSystem();
    fs.createDirectory('/home/user/games/doom', { recursive: true });
    fs.createDirectory('/etc', { recursive: true });
    fs.writeFile('/etc/hosts', 'secret');
    const provider = new RuntimeFileProvider(fs, '/home/user/games/doom', perms('fs:read', 'fs:write'));
    expect(code(() => provider.readFile('../../../etc/hosts'))).toBe('EPERMISSION');
    expect(code(() => provider.writeFile('../../../etc/hosts', new Uint8Array([1])))).toBe('EPERMISSION');
    expect(fs.readFile('/etc/hosts')).toBe('secret');
  });

  it('exists() and list() on a missing directory do not throw', () => {
    const fs = new VirtualFileSystem();
    fs.createDirectory('/home/user/games/doom', { recursive: true });
    const provider = new RuntimeFileProvider(fs, '/home/user/games/doom', perms('fs:read'));
    expect(provider.exists('saves/slot1')).toBe(false);
    expect(provider.list('saves')).toEqual([]);
  });
});

describe('RuntimeInput', () => {
  it('is inert without input permissions', () => {
    const input = new RuntimeInput(perms());
    input.pushKey('KeyA', true);
    input.pushMouse(1, 2, 1);
    expect(input.connected).toBe(false);
    expect(input.packed()).toBe(0);
  });

  it('tracks keys and mouse once granted, and packs a nonzero word', () => {
    const input = new RuntimeInput(perms('input:keyboard', 'input:mouse'));
    input.pushKey('Space', true);
    input.pushMouse(10, 20, 1);
    expect(input.connected).toBe(true);
    expect(input.snapshot().keys.has('Space')).toBe(true);
    expect(input.packed()).not.toBe(0);
    input.blur();
    expect(input.snapshot().keys.size).toBe(0);
  });
});

describe('RuntimeDisplay', () => {
  it('denies the frame buffer without display:render', () => {
    const display = new RuntimeDisplay(4, 4, perms());
    expect(code(() => display.getFrameBuffer())).toBe('EPERMISSION');
  });

  it('exposes a correctly sized RGBA buffer once granted', () => {
    const display = new RuntimeDisplay(4, 4, perms('display:render'));
    expect(display.getFrameBuffer().byteLength).toBe(4 * 4 * 4);
  });
});
