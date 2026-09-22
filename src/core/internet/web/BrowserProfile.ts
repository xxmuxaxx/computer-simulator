import { Observable } from '../../../utils/Observable';
import { uid } from '../../../utils/id';
import type { Bookmark, BrowserHistoryEntry, Cookie } from '../types';
import { hostOf } from './origin';

export interface BrowserProfileOptions {
  now: () => number;
}

export interface BrowserProfileSnapshot {
  history: BrowserHistoryEntry[];
  bookmarks: Bookmark[];
  cookies: Record<string, Cookie[]>;
  localStorage: Record<string, Record<string, string>>;
  sessionStorage: Record<string, Record<string, string>>;
}

const MAX_HISTORY = 500;
type StorageKind = 'local' | 'session';

function parseSetCookie(raw: string, domain: string, now: number): Cookie {
  const parts = raw.split(';').map((p) => p.trim());
  const [name, value] = parts[0]!.split('=');
  const cookie: Cookie = { name: name ?? '', value: value ?? '', domain, path: '/', secure: false };
  for (const attr of parts.slice(1)) {
    const [key, val] = attr.split('=');
    const lower = key?.toLowerCase();
    if (lower === 'path' && val) cookie.path = val;
    else if (lower === 'secure') cookie.secure = true;
    else if (lower === 'max-age' && val) cookie.expires = now + Number(val) * 1000;
  }
  return cookie;
}

/**
 * Per-viewer browser state: history, bookmarks, and per-origin cookies/localStorage/
 * sessionStorage, isolated by origin (scheme+host+port) exactly like a real browser's
 * same-origin policy. Zero dependency on React - the Browser app is the only reader/writer.
 */
export class BrowserProfile extends Observable {
  private historyEntries: BrowserHistoryEntry[] = [];
  private bookmarkList: Bookmark[] = [];
  private cookieJar = new Map<string, Cookie[]>();
  private localStorageByOrigin = new Map<string, Record<string, string>>();
  private sessionStorageByOrigin = new Map<string, Record<string, string>>();
  private readonly now: () => number;

  constructor(options: BrowserProfileOptions) {
    super();
    this.now = options.now;
  }

  // ───────────────────────────── history ─────────────────────────────

  visit(url: string, title: string): void {
    this.historyEntries.push({ url, title, visitedAt: this.now() });
    if (this.historyEntries.length > MAX_HISTORY) this.historyEntries.shift();
    this.emit();
  }

  getHistory(): readonly BrowserHistoryEntry[] {
    return [...this.historyEntries].reverse();
  }

  clearHistory(): void {
    this.historyEntries = [];
    this.emit();
  }

  // ───────────────────────────── bookmarks ─────────────────────────────

  addBookmark(url: string, title: string): Bookmark {
    const bookmark: Bookmark = { id: uid('bm'), url, title, createdAt: this.now() };
    this.bookmarkList.push(bookmark);
    this.emit();
    return { ...bookmark };
  }

  removeBookmarkByUrl(url: string): void {
    this.bookmarkList = this.bookmarkList.filter((b) => b.url !== url);
    this.emit();
  }

  isBookmarked(url: string): boolean {
    return this.bookmarkList.some((b) => b.url === url);
  }

  listBookmarks(): Bookmark[] {
    return [...this.bookmarkList];
  }

  // ───────────────────────────── cookies ─────────────────────────────

  /** Stores a Set-Cookie response header value, scoped to the origin that sent it. */
  setCookie(origin: string, setCookieHeader: string): void {
    const cookie = parseSetCookie(setCookieHeader, hostOf(origin), this.now());
    const list = this.cookieJar.get(origin) ?? [];
    const next = list.filter((c) => c.name !== cookie.name);
    next.push(cookie);
    this.cookieJar.set(origin, next);
    this.emit();
  }

  /** Builds the Cookie request header for an origin (unexpired cookies only). */
  getCookieHeader(origin: string): string | undefined {
    const list = this.listCookies(origin);
    if (!list.length) return undefined;
    return list.map((c) => `${c.name}=${c.value}`).join('; ');
  }

  listCookies(origin: string): Cookie[] {
    const now = this.now();
    return (this.cookieJar.get(origin) ?? []).filter((c) => c.expires === undefined || c.expires > now);
  }

  clearCookies(origin?: string): void {
    if (origin) this.cookieJar.delete(origin);
    else this.cookieJar.clear();
    this.emit();
  }

  // ───────────────────────────── storage ─────────────────────────────

  private storageMap(kind: StorageKind): Map<string, Record<string, string>> {
    return kind === 'local' ? this.localStorageByOrigin : this.sessionStorageByOrigin;
  }

  getStorage(origin: string, kind: StorageKind): Record<string, string> {
    return { ...(this.storageMap(kind).get(origin) ?? {}) };
  }

  setStorageItem(origin: string, kind: StorageKind, key: string, value: string): void {
    const map = this.storageMap(kind);
    map.set(origin, { ...map.get(origin), [key]: value });
    this.emit();
  }

  removeStorageItem(origin: string, kind: StorageKind, key: string): void {
    const map = this.storageMap(kind);
    const next = { ...map.get(origin) };
    delete next[key];
    map.set(origin, next);
    this.emit();
  }

  clearStorage(origin: string, kind: StorageKind): void {
    this.storageMap(kind).delete(origin);
    this.emit();
  }

  // ───────────────────────────── persistence ─────────────────────────────

  snapshot(): BrowserProfileSnapshot {
    return {
      history: [...this.historyEntries],
      bookmarks: [...this.bookmarkList],
      cookies: Object.fromEntries(this.cookieJar),
      localStorage: Object.fromEntries(this.localStorageByOrigin),
      sessionStorage: Object.fromEntries(this.sessionStorageByOrigin),
    };
  }

  restore(data: BrowserProfileSnapshot): void {
    this.historyEntries = [...data.history];
    this.bookmarkList = [...data.bookmarks];
    this.cookieJar = new Map(Object.entries(data.cookies).map(([k, v]) => [k, [...v]]));
    this.localStorageByOrigin = new Map(Object.entries(data.localStorage).map(([k, v]) => [k, { ...v }]));
    this.sessionStorageByOrigin = new Map(Object.entries(data.sessionStorage).map(([k, v]) => [k, { ...v }]));
  }
}
