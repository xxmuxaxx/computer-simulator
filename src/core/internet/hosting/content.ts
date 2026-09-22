import { extname } from '../../../utils/path';
import type { VirtualFileSystem } from '../../filesystem/VirtualFileSystem';

export function contentTypeFor(path: string): string {
  const ext = extname(path);
  if (ext === '.css') return 'text/css';
  if (ext === '.js') return 'application/javascript';
  if (ext === '.json') return 'application/json';
  return 'text/html';
}

/** Joins a website's root directory with a request path, refusing to escape it. */
export function resolveSitePath(rootDirectory: string, requestPath: string): string | null {
  if (requestPath.includes('..')) return null;
  const clean = requestPath === '/' || requestPath === '' ? '/index.html' : requestPath.startsWith('/') ? requestPath : `/${requestPath}`;
  return `${rootDirectory}${clean}`;
}

const LOG_DIR = '/var/log/http';
export const ACCESS_LOG_PATH = `${LOG_DIR}/access.log`;
export const ERROR_LOG_PATH = `${LOG_DIR}/error.log`;

export function ensureHttpLogPaths(fs: VirtualFileSystem): void {
  if (!fs.exists(LOG_DIR)) fs.createDirectory(LOG_DIR, { recursive: true });
  if (!fs.exists(ACCESS_LOG_PATH)) fs.createFile(ACCESS_LOG_PATH, '');
  if (!fs.exists(ERROR_LOG_PATH)) fs.createFile(ERROR_LOG_PATH, '');
}

function formatLogTime(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function appendLine(fs: VirtualFileSystem, path: string, line: string): void {
  fs.writeFile(path, line + '\n', { append: true });
}

export function logAccess(fs: VirtualFileSystem, now: number, method: string, path: string, status: number): void {
  ensureHttpLogPaths(fs);
  appendLine(fs, ACCESS_LOG_PATH, `${formatLogTime(now)} ${method} ${path} ${status}`);
  if (status >= 400) appendLine(fs, ERROR_LOG_PATH, `${status} ${path}`);
}
