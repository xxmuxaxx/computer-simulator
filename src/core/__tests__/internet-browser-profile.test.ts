import { describe, expect, it } from 'vitest';
import { BrowserProfile } from '../internet/web/BrowserProfile';
import { originOf } from '../internet/web/origin';

describe('BrowserProfile', () => {
  it('records visits to history, most recent first', () => {
    const profile = new BrowserProfile({ now: () => 1000 });
    profile.visit('http://a.local', 'A');
    profile.visit('http://b.local', 'B');
    expect(profile.getHistory().map((h) => h.url)).toEqual(['http://b.local', 'http://a.local']);
  });

  it('clears history', () => {
    const profile = new BrowserProfile({ now: () => 1000 });
    profile.visit('http://a.local', 'A');
    profile.clearHistory();
    expect(profile.getHistory()).toHaveLength(0);
  });

  it('adds and removes bookmarks', () => {
    const profile = new BrowserProfile({ now: () => 1000 });
    profile.addBookmark('http://a.local', 'A');
    expect(profile.isBookmarked('http://a.local')).toBe(true);
    profile.removeBookmarkByUrl('http://a.local');
    expect(profile.isBookmarked('http://a.local')).toBe(false);
  });

  it('scopes cookies per origin and round-trips a Set-Cookie header', () => {
    const profile = new BrowserProfile({ now: () => 1000 });
    const originA = originOf('http', 'a.local');
    const originB = originOf('http', 'b.local');
    profile.setCookie(originA, 'sessionId=abc123; Path=/');
    expect(profile.getCookieHeader(originA)).toBe('sessionId=abc123');
    expect(profile.getCookieHeader(originB)).toBeUndefined();
  });

  it('expires a cookie past its max-age', () => {
    let now = 1000;
    const profile = new BrowserProfile({ now: () => now });
    const origin = originOf('http', 'a.local');
    profile.setCookie(origin, 'sessionId=abc123; Max-Age=1');
    expect(profile.getCookieHeader(origin)).toContain('abc123');
    now += 5000;
    expect(profile.getCookieHeader(origin)).toBeUndefined();
  });

  it('keeps localStorage isolated per origin', () => {
    const profile = new BrowserProfile({ now: () => 1000 });
    const originA = originOf('http', 'a.local');
    const originB = originOf('http', 'b.local');
    profile.setStorageItem(originA, 'local', 'key', 'value-a');
    profile.setStorageItem(originB, 'local', 'key', 'value-b');
    expect(profile.getStorage(originA, 'local')).toEqual({ key: 'value-a' });
    expect(profile.getStorage(originB, 'local')).toEqual({ key: 'value-b' });
  });

  it('round-trips through snapshot/restore', () => {
    const profile = new BrowserProfile({ now: () => 1000 });
    const origin = originOf('http', 'a.local');
    profile.visit('http://a.local', 'A');
    profile.addBookmark('http://a.local', 'A');
    profile.setCookie(origin, 'sessionId=abc123');
    profile.setStorageItem(origin, 'session', 'k', 'v');

    const restored = new BrowserProfile({ now: () => 1000 });
    restored.restore(profile.snapshot());
    expect(restored.getHistory()).toHaveLength(1);
    expect(restored.isBookmarked('http://a.local')).toBe(true);
    expect(restored.getCookieHeader(origin)).toBe('sessionId=abc123');
    expect(restored.getStorage(origin, 'session')).toEqual({ k: 'v' });
  });
});
