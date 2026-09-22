import { describe, expect, it } from 'vitest';
import { SystemError } from '../errors';
import { VirtualFileSystem } from '../filesystem/VirtualFileSystem';

const code = (fn: () => unknown): string | undefined => {
  try {
    fn();
  } catch (e) {
    return e instanceof SystemError ? e.code : 'OTHER';
  }
  return undefined;
};

describe('VirtualFileSystem binary support', () => {
  it('writes and reads raw bytes', () => {
    const fs = new VirtualFileSystem();
    const bytes = new Uint8Array([0, 1, 2, 255, 254, 10]);
    fs.writeBinary('/blob.bin', bytes);
    expect(fs.readBinary('/blob.bin')).toEqual(bytes);
    expect(fs.getStats('/blob.bin').size).toBe(bytes.byteLength);
  });

  it('accounts bytes by byteLength, not string length', () => {
    const fs = new VirtualFileSystem({ capacityBytes: 10 });
    const bytes = new Uint8Array(10).fill(7);
    fs.writeBinary('/full.bin', bytes);
    expect(fs.getUsedBytes()).toBe(10);
    expect(fs.getFreeBytes()).toBe(0);
    expect(code(() => fs.createFile('/more.txt', 'x'))).toBe('ENOSPC');
  });

  it('readFile refuses a binary node; readBinary accepts a text node', () => {
    const fs = new VirtualFileSystem();
    fs.writeBinary('/bin.dat', new Uint8Array([1, 2, 3]));
    fs.writeFile('/text.txt', 'hello');
    expect(code(() => fs.readFile('/bin.dat'))).toBe('EINVAL');
    expect(fs.readBinary('/text.txt')).toEqual(new TextEncoder().encode('hello'));
  });

  it('overwriting an existing binary file updates size and content', () => {
    const fs = new VirtualFileSystem();
    fs.writeBinary('/f.bin', new Uint8Array([1, 2, 3]));
    fs.writeBinary('/f.bin', new Uint8Array([9, 9]));
    expect(fs.readBinary('/f.bin')).toEqual(new Uint8Array([9, 9]));
    expect(fs.getStats('/f.bin').size).toBe(2);
  });

  it('respects readonly on binary writes', () => {
    const fs = new VirtualFileSystem();
    fs.writeBinary('/locked.bin', new Uint8Array([1]));
    fs.setAttributes('/locked.bin', { readonly: true });
    expect(code(() => fs.writeBinary('/locked.bin', new Uint8Array([2])))).toBe('EACCES');
  });

  it('writeBinary(create: false) requires an existing file', () => {
    const fs = new VirtualFileSystem();
    expect(code(() => fs.writeBinary('/missing.bin', new Uint8Array([1]), { create: false }))).toBe('ENOENT');
  });

  it('survives a serialize()/load() round trip byte-for-byte', () => {
    const fs = new VirtualFileSystem();
    const bytes = new Uint8Array(64);
    for (let i = 0; i < bytes.length; i++) bytes[i] = i;
    fs.writeBinary('/roundtrip.bin', bytes);
    const snapshot = structuredClone(fs.serialize());
    const restored = new VirtualFileSystem({ snapshot });
    expect(restored.readBinary('/roundtrip.bin')).toEqual(bytes);
    expect(restored.getUsedBytes()).toBe(bytes.byteLength);
  });
});
