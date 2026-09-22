const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'];

export function formatBytes(bytes: number, digits = 1): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  let i = 0;
  let v = bytes;
  while (v >= 1024 && i < UNITS.length - 1) {
    v /= 1024;
    i++;
  }
  return `${i === 0 ? v : v.toFixed(digits)} ${UNITS[i]}`;
}

export function formatMB(mb: number): string {
  return mb >= 1024 ? `${(mb / 1024).toFixed(2)} GB` : `${Math.round(mb)} MB`;
}

const pad = (n: number) => String(n).padStart(2, '0');

export function formatClock(ts: number, format: '12' | '24', seconds = false): string {
  const d = new Date(ts);
  const mm = pad(d.getMinutes());
  const ss = seconds ? `:${pad(d.getSeconds())}` : '';
  if (format === '24') return `${pad(d.getHours())}:${mm}${ss}`;
  const h = d.getHours() % 12 || 12;
  return `${h}:${mm}${ss} ${d.getHours() < 12 ? 'AM' : 'PM'}`;
}

export function formatDateTime(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function formatDate(ts: number): string {
  return new Date(ts).toString().replace(/ GMT.*$/, '');
}

export function formatUptime(ms: number): string {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0 ? `${h}h ${m}m ${sec}s` : m > 0 ? `${m}m ${sec}s` : `${sec}s`;
}

export function bar(percent: number, width = 20): string {
  const p = Math.max(0, Math.min(100, percent));
  const filled = Math.round((p / 100) * width);
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}

export const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
