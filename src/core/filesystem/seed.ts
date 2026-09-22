import type { VirtualFileSystem } from './VirtualFileSystem';

export const HOME = '/home/user';
export const DESKTOP = `${HOME}/Desktop`;

export interface AppManifest {
  id: string;
  name: string;
  description: string;
}

export type Shortcut = { kind: 'folder'; target: string } | { kind: 'app'; appId: string };

export const SHORTCUT_EXT = '.lnk';

export function serializeShortcut(shortcut: Shortcut): string {
  return JSON.stringify(shortcut);
}

export function parseShortcut(content: string): Shortcut | null {
  try {
    const value: unknown = JSON.parse(content);
    if (typeof value !== 'object' || value === null) return null;
    const v = value as Record<string, unknown>;
    if (v.kind === 'folder' && typeof v.target === 'string') return { kind: 'folder', target: v.target };
    if (v.kind === 'app' && typeof v.appId === 'string') return { kind: 'app', appId: v.appId };
    return null;
  } catch {
    return null;
  }
}

const README = `Welcome to Computer Simulator!

This is a small virtual computer that runs entirely in your browser.
Everything you create here (files, folders, settings) is stored locally
in IndexedDB and survives page reloads.

Things to try:
  - Double-click icons to open applications
  - Open the Terminal (Ctrl+Alt+T) and type "help"
  - Create a file in Text Editor, save it with Ctrl+S
  - Watch CPU and memory in Task Manager
  - Right-click the desktop for more actions

Nothing here touches your real file system.
`;

const HELLO = `Hello, World!
This file lives in /home/user/Projects.
`;

const MOTD = `Computer Simulator - a virtual computer in your browser.
Type "help" to list the available commands.
`;

/** Populates an empty file system with the default directory layout and demo files. */
export function seedFileSystem(fs: VirtualFileSystem, apps: readonly AppManifest[]): void {
  for (const dir of [
    HOME,
    DESKTOP,
    `${HOME}/Documents`,
    `${HOME}/Downloads`,
    `${HOME}/Projects`,
    fs.trashPath,
    '/system',
    '/apps',
    '/tmp',
    '/etc',
    '/var',
    '/var/www',
  ]) {
    fs.createDirectory(dir, { recursive: true });
  }

  fs.writeFile(`${HOME}/Documents/readme.txt`, README);
  fs.writeFile(`${HOME}/Projects/hello.txt`, HELLO);

  fs.writeFile(`${DESKTOP}/Documents${SHORTCUT_EXT}`, serializeShortcut({ kind: 'folder', target: `${HOME}/Documents` }));
  fs.writeFile(`${DESKTOP}/Projects${SHORTCUT_EXT}`, serializeShortcut({ kind: 'folder', target: `${HOME}/Projects` }));
  fs.writeFile(`${DESKTOP}/Terminal${SHORTCUT_EXT}`, serializeShortcut({ kind: 'app', appId: 'terminal' }));
  fs.writeFile(`${DESKTOP}/Trash${SHORTCUT_EXT}`, serializeShortcut({ kind: 'folder', target: fs.trashPath }));

  fs.writeFile('/system/version', 'Computer Simulator OS 1.0.0\n');
  fs.writeFile('/system/kernel.log', '[    0.000] kernel: virtual machine started\n[    0.120] kernel: filesystem mounted\n[    0.310] kernel: window manager ready\n');
  fs.writeFile('/etc/os-release', 'NAME="Computer Simulator OS"\nVERSION="1.0.0"\nID=compsim\n');
  fs.writeFile('/etc/motd', MOTD);
  fs.writeFile('/etc/hosts', '127.0.0.1 localhost\n');
  for (const app of apps) {
    fs.writeFile(`/apps/${app.id}.app`, JSON.stringify({ id: app.id, name: app.name, description: app.description }, null, 2) + '\n');
  }

  // Lock down system locations; user folders can't be removed or renamed.
  for (const p of ['/system', '/apps', '/etc']) fs.setAttributes(p, { readonly: true });
  for (const p of [
    '/system', '/apps', '/etc', '/tmp', '/var', '/var/www', '/home', HOME, DESKTOP,
    `${HOME}/Documents`, `${HOME}/Downloads`, `${HOME}/Projects`, fs.trashPath,
  ]) {
    fs.setAttributes(p, { protected: true });
  }
  // /etc/hosts and the website under /var/www stay editable - everything else under /etc is read-only.
  for (const file of [...fs.walk('/system'), ...fs.walk('/apps'), ...fs.walk('/etc')]) {
    if (file.path === '/etc/hosts') continue;
    fs.setAttributes(file.path, { readonly: true });
  }
}
