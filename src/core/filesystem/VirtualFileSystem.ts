import { SystemError } from '../errors';
import { Observable } from '../../utils/Observable';
import { basename, dirname, isInside, normalize, splitPath, SEP } from '../../utils/path';
import { uid } from '../../utils/id';
import type {
  CreateFileOptions,
  FileStats,
  FileSystemOptions,
  FileSystemSnapshot,
  FSNode,
  WriteOptions,
} from './types';

export const ROOT_ID = 'root';
export const DEFAULT_TRASH_PATH = '/home/user/.trash';

const encoder = new TextEncoder();
const byteLength = (s: string): number => encoder.encode(s).length;
const contentSize = (c: string | Uint8Array): number => (c instanceof Uint8Array ? c.byteLength : byteLength(c));

function joinPath(dir: string, name: string): string {
  return dir === SEP ? SEP + name : dir + SEP + name;
}

/**
 * In-memory virtual file system. Knows nothing about React, the DOM or persistence:
 * it can be serialised with `serialize()` and restored through `options.snapshot`.
 */
export class VirtualFileSystem extends Observable {
  readonly trashPath: string;
  private nodes = new Map<string, FSNode>();
  /** parentId -> (child name -> child id) */
  private children = new Map<string, Map<string, string>>();
  private usedBytes = 0;
  private _capacity: number;
  private now: () => number;

  constructor(options: FileSystemOptions = {}) {
    super();
    this.now = options.now ?? Date.now;
    this._capacity = options.capacityBytes ?? Number.POSITIVE_INFINITY;
    this.trashPath = options.trashPath ?? DEFAULT_TRASH_PATH;
    if (options.snapshot) this.load(options.snapshot);
    else this.createRoot();
  }

  // ───────────────────────────── capacity ─────────────────────────────

  get capacityBytes(): number {
    return this._capacity;
  }

  setCapacity(bytes: number): void {
    this._capacity = bytes;
    this.emit();
  }

  getUsedBytes(): number {
    return this.usedBytes;
  }

  getFreeBytes(): number {
    return Math.max(0, this._capacity - this.usedBytes);
  }

  // ───────────────────────────── queries ─────────────────────────────

  exists(path: string): boolean {
    return this.lookup(path) !== undefined;
  }

  isDirectory(path: string): boolean {
    return this.lookup(path)?.type === 'directory';
  }

  isFile(path: string): boolean {
    return this.lookup(path)?.type === 'file';
  }

  getStats(path: string): FileStats {
    return this.statsOf(this.getNode(path));
  }

  getStatsById(id: string): FileStats {
    const node = this.nodes.get(id);
    if (!node) throw new SystemError('ENOENT', id);
    return this.statsOf(node);
  }

  getPath(id: string): string {
    const parts: string[] = [];
    let node = this.nodes.get(id);
    while (node && node.id !== ROOT_ID) {
      parts.push(node.name);
      node = this.nodes.get(node.parentId);
    }
    return SEP + parts.reverse().join(SEP);
  }

  /** Recursive size in bytes. */
  getSize(path: string): number {
    return this.sizeOf(this.getNode(path));
  }

  readFile(path: string): string {
    const node = this.getNode(path);
    if (node.type === 'directory') throw new SystemError('EISDIR', normalize(path));
    if (node.content instanceof Uint8Array) {
      throw new SystemError('EINVAL', normalize(path), 'Not a text file');
    }
    return node.content ?? '';
  }

  /** Reads a file's raw bytes, whether it was written as text or binary. */
  readBinary(path: string): Uint8Array {
    const node = this.getNode(path);
    if (node.type === 'directory') throw new SystemError('EISDIR', normalize(path));
    if (node.content instanceof Uint8Array) return node.content;
    return encoder.encode(node.content ?? '');
  }

  listDirectory(path: string): FileStats[] {
    const node = this.getNode(path);
    if (node.type !== 'directory') throw new SystemError('ENOTDIR', normalize(path));
    return this.childNodes(node)
      .map((n) => this.statsOf(n))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Depth-first walk of everything below `path` (path itself is not included). */
  walk(path: string): FileStats[] {
    const out: FileStats[] = [];
    const visit = (node: FSNode) => {
      for (const child of this.childNodes(node).sort((a, b) => a.name.localeCompare(b.name))) {
        out.push(this.statsOf(child));
        if (child.type === 'directory') visit(child);
      }
    };
    const root = this.getNode(path);
    if (root.type === 'directory') visit(root);
    return out;
  }

  /** Number of files (not directories). */
  countFiles(): number {
    let n = 0;
    for (const node of this.nodes.values()) if (node.type === 'file') n++;
    return n;
  }

  countNodes(): number {
    return this.nodes.size;
  }

  // ───────────────────────────── mutations ─────────────────────────────

  createFile(path: string, content: string | Uint8Array = '', options: CreateFileOptions = {}): FileStats {
    const { parent, name } = this.splitTarget(path);
    this.assertWritableDir(parent, path);
    if (this.childId(parent, name)) throw new SystemError('EEXIST', normalize(path));
    const size = options.size ?? contentSize(content);
    this.assertSpace(size, true);
    const node = this.insert(parent, name, 'file', content, size);
    this.emit();
    return this.statsOf(node);
  }

  createDirectory(path: string, options: { recursive?: boolean } = {}): FileStats {
    const target = normalize(path);
    if (options.recursive) {
      let current = this.getNode(SEP);
      for (const part of splitPath(target)) {
        this.validateName(part);
        const existingId = this.childId(current, part);
        if (existingId) {
          const existing = this.nodes.get(existingId)!;
          if (existing.type !== 'directory') throw new SystemError('ENOTDIR', target);
          current = existing;
        } else {
          this.assertWritableDir(current, target);
          this.assertSpace(0, true);
          current = this.insert(current, part, 'directory', undefined, 0);
        }
      }
      this.emit();
      return this.statsOf(current);
    }
    const { parent, name } = this.splitTarget(target);
    this.assertWritableDir(parent, target);
    if (this.childId(parent, name)) throw new SystemError('EEXIST', target);
    this.assertSpace(0, true);
    const node = this.insert(parent, name, 'directory', undefined, 0);
    this.emit();
    return this.statsOf(node);
  }

  writeFile(path: string, content: string, options: WriteOptions = {}): FileStats {
    const { create = true, append = false } = options;
    const existing = this.lookup(path);
    if (!existing) {
      if (!create) throw new SystemError('ENOENT', normalize(path));
      return this.createFile(path, content);
    }
    if (existing.type === 'directory') throw new SystemError('EISDIR', normalize(path));
    if (existing.readonly) throw new SystemError('EACCES', normalize(path));
    const next = append ? (existing.content ?? '') + content : content;
    const newSize = byteLength(next);
    this.assertSpace(newSize - existing.size, false);
    this.usedBytes += newSize - existing.size;
    existing.content = next;
    existing.size = newSize;
    this.touch(existing);
    this.emit();
    return this.statsOf(existing);
  }

  /** Like `writeFile`, but for raw bytes (installed WASM apps, WAD/asset uploads, ...). */
  writeBinary(path: string, data: Uint8Array, options: WriteOptions = {}): FileStats {
    const { create = true } = options;
    const existing = this.lookup(path);
    if (!existing) {
      if (!create) throw new SystemError('ENOENT', normalize(path));
      return this.createFile(path, data);
    }
    if (existing.type === 'directory') throw new SystemError('EISDIR', normalize(path));
    if (existing.readonly) throw new SystemError('EACCES', normalize(path));
    const newSize = data.byteLength;
    this.assertSpace(newSize - existing.size, false);
    this.usedBytes += newSize - existing.size;
    existing.content = data;
    existing.size = newSize;
    this.touch(existing);
    this.emit();
    return this.statsOf(existing);
  }

  delete(path: string, options: { recursive?: boolean } = {}): void {
    const node = this.getNode(path);
    this.assertRemovable(node, path);
    if (node.type === 'directory' && !options.recursive && this.children.get(node.id)?.size) {
      throw new SystemError('ENOTEMPTY', normalize(path));
    }
    const parent = this.nodes.get(node.parentId);
    this.removeSubtree(node);
    this.touch(parent);
    this.emit();
  }

  rename(path: string, newName: string): FileStats {
    const node = this.getNode(path);
    this.assertRemovable(node, path);
    this.validateName(newName);
    if (newName === node.name) return this.statsOf(node);
    const siblings = this.children.get(node.parentId)!;
    if (siblings.has(newName)) throw new SystemError('EEXIST', joinPath(dirname(path), newName));
    siblings.delete(node.name);
    node.name = newName;
    siblings.set(newName, node.id);
    this.touch(node);
    this.touch(this.nodes.get(node.parentId));
    this.emit();
    return this.statsOf(node);
  }

  /**
   * Moves `src` to `dest`. If `dest` is an existing directory the node keeps its
   * name and is placed inside; otherwise `dest` is the new full path.
   */
  move(src: string, dest: string): FileStats {
    const node = this.getNode(src);
    this.assertRemovable(node, src);
    const { parent, name } = this.resolveDestination(dest, node.name);
    if (node.type === 'directory' && this.isDescendant(parent, node)) {
      throw new SystemError('EINVAL', normalize(dest), 'Cannot move a directory into itself');
    }
    this.assertWritableDir(parent, dest);
    if (parent.id === node.parentId && name === node.name) return this.statsOf(node);
    if (this.childId(parent, name)) throw new SystemError('EEXIST', this.pathOfChild(parent, name));
    const oldParent = this.nodes.get(node.parentId)!;
    this.children.get(oldParent.id)!.delete(node.name);
    node.parentId = parent.id;
    node.name = name;
    delete node.trash;
    this.children.get(parent.id)!.set(name, node.id);
    this.touch(node);
    this.touch(oldParent);
    this.touch(parent);
    this.emit();
    return this.statsOf(node);
  }

  /** Copies a file or a whole directory tree. Same destination rules as `move`. */
  copy(src: string, dest: string): FileStats {
    const node = this.getNode(src);
    const { parent, name } = this.resolveDestination(dest, node.name);
    if (node.type === 'directory' && this.isDescendant(parent, node)) {
      throw new SystemError('EINVAL', normalize(dest), 'Cannot copy a directory into itself');
    }
    this.assertWritableDir(parent, dest);
    if (this.childId(parent, name)) throw new SystemError('EEXIST', this.pathOfChild(parent, name));
    this.assertSpace(this.sizeOf(node), true);
    const copy = this.cloneSubtree(node, parent, name);
    this.touch(parent);
    this.emit();
    return this.statsOf(copy);
  }

  setAttributes(path: string, attrs: { readonly?: boolean; protected?: boolean }): void {
    const node = this.getNode(path);
    if (attrs.readonly !== undefined) node.readonly = attrs.readonly || undefined;
    if (attrs.protected !== undefined) node.protected = attrs.protected || undefined;
    this.emit();
  }

  // ───────────────────────────── trash ─────────────────────────────

  isInTrash(path: string): boolean {
    return isInside(this.trashPath, path) && normalize(path) !== this.trashPath;
  }

  listTrash(): FileStats[] {
    return this.exists(this.trashPath) ? this.listDirectory(this.trashPath) : [];
  }

  /** Moves a node into the trash, remembering where it came from. */
  trash(path: string): FileStats {
    const node = this.getNode(path);
    const fullPath = this.getPath(node.id);
    if (isInside(this.trashPath, fullPath) || isInside(fullPath, this.trashPath)) {
      throw new SystemError('EINVAL', fullPath, 'Already in trash or contains the trash');
    }
    this.assertRemovable(node, fullPath);
    if (!this.exists(this.trashPath)) this.createDirectory(this.trashPath, { recursive: true });
    const trashDir = this.getNode(this.trashPath);
    const name = this.uniqueName(trashDir, node.name);
    const oldParent = this.nodes.get(node.parentId)!;
    this.children.get(oldParent.id)!.delete(node.name);
    node.parentId = trashDir.id;
    node.name = name;
    node.trash = { originalPath: fullPath, deletedAt: this.now() };
    this.children.get(trashDir.id)!.set(name, node.id);
    this.touch(oldParent);
    this.touch(trashDir);
    this.emit();
    return this.statsOf(node);
  }

  /** Restores a trashed node to its original location (or the trash's parent directory). */
  restore(path: string): FileStats {
    const node = this.getNode(path);
    const trashDir = this.getNode(this.trashPath);
    if (!node.trash || node.parentId !== trashDir.id) {
      throw new SystemError('EINVAL', normalize(path), 'Not a trashed item');
    }
    const originalDir = dirname(node.trash.originalPath);
    const originalName = basename(node.trash.originalPath);
    let parent = this.lookup(originalDir);
    if (!parent || parent.type !== 'directory' || parent.readonly) parent = this.getNode(dirname(this.trashPath));
    const name = this.uniqueName(parent, originalName);
    this.children.get(trashDir.id)!.delete(node.name);
    node.parentId = parent.id;
    node.name = name;
    delete node.trash;
    this.children.get(parent.id)!.set(name, node.id);
    this.touch(node);
    this.touch(parent);
    this.touch(trashDir);
    this.emit();
    return this.statsOf(node);
  }

  emptyTrash(): number {
    if (!this.exists(this.trashPath)) return 0;
    const trashDir = this.getNode(this.trashPath);
    const items = this.childNodes(trashDir);
    for (const item of items) this.removeSubtree(item);
    this.touch(trashDir);
    this.emit();
    return items.length;
  }

  // ───────────────────────────── snapshots ─────────────────────────────

  serialize(): FileSystemSnapshot {
    return {
      rootId: ROOT_ID,
      nodes: [...this.nodes.values()].map((n) => ({ ...n, trash: n.trash && { ...n.trash } })),
    };
  }

  /** Forces observers to re-read the tree (the "Refresh" action). */
  refresh(): void {
    this.emit();
  }

  /** Replaces the whole tree (used by Reset Computer). */
  replaceWith(snapshot: FileSystemSnapshot): void {
    this.load(snapshot);
    this.emit();
  }

  // ───────────────────────────── internals ─────────────────────────────

  private createRoot(): void {
    this.nodes.clear();
    this.children.clear();
    this.usedBytes = 0;
    const t = this.now();
    const root: FSNode = {
      id: ROOT_ID,
      name: '',
      type: 'directory',
      parentId: '',
      size: 0,
      createdAt: t,
      modifiedAt: t,
      protected: true,
    };
    this.nodes.set(ROOT_ID, root);
    this.children.set(ROOT_ID, new Map());
  }

  private load(snapshot: FileSystemSnapshot): void {
    this.nodes.clear();
    this.children.clear();
    this.usedBytes = 0;
    for (const raw of snapshot.nodes) {
      const node: FSNode = { ...raw, trash: raw.trash && { ...raw.trash } };
      if (!node.trash) delete node.trash;
      this.nodes.set(node.id, node);
      if (node.type === 'directory') this.children.set(node.id, new Map());
    }
    for (const node of this.nodes.values()) {
      if (node.id === ROOT_ID) continue;
      this.children.get(node.parentId)?.set(node.name, node.id);
      if (node.type === 'file') this.usedBytes += node.size;
    }
    if (!this.nodes.has(ROOT_ID)) this.createRoot();
  }

  private lookup(path: string): FSNode | undefined {
    const target = normalize(path);
    if (!target.startsWith(SEP)) return undefined;
    let node = this.nodes.get(ROOT_ID)!;
    for (const part of splitPath(target)) {
      if (node.type !== 'directory') return undefined;
      const id = this.children.get(node.id)?.get(part);
      if (!id) return undefined;
      node = this.nodes.get(id)!;
    }
    return node;
  }

  private getNode(path: string): FSNode {
    if (!normalize(path).startsWith(SEP)) throw new SystemError('EINVAL', path, 'Path must be absolute');
    const node = this.lookup(path);
    if (!node) throw new SystemError('ENOENT', normalize(path));
    return node;
  }

  private childId(parent: FSNode, name: string): string | undefined {
    return this.children.get(parent.id)?.get(name);
  }

  private childNodes(node: FSNode): FSNode[] {
    const ids = this.children.get(node.id);
    return ids ? [...ids.values()].map((id) => this.nodes.get(id)!) : [];
  }

  private pathOfChild(parent: FSNode, name: string): string {
    return joinPath(this.getPath(parent.id), name);
  }

  private splitTarget(path: string): { parent: FSNode; name: string } {
    const target = normalize(path);
    if (!target.startsWith(SEP)) throw new SystemError('EINVAL', path, 'Path must be absolute');
    if (target === SEP) throw new SystemError('EEXIST', SEP);
    const name = basename(target);
    this.validateName(name);
    const parent = this.lookup(dirname(target));
    if (!parent) throw new SystemError('ENOENT', dirname(target));
    if (parent.type !== 'directory') throw new SystemError('ENOTDIR', dirname(target));
    return { parent, name };
  }

  private resolveDestination(dest: string, srcName: string): { parent: FSNode; name: string } {
    const existing = this.lookup(dest);
    if (existing?.type === 'directory') return { parent: existing, name: srcName };
    return this.splitTarget(dest);
  }

  private validateName(name: string): void {
    if (name === '' || name === '.' || name === '..' || name.includes('/') || name.includes('\0') || name.length > 255) {
      throw new SystemError('EINVAL', name, 'Invalid file name');
    }
  }

  private assertWritableDir(dir: FSNode, path: string): void {
    if (dir.readonly) throw new SystemError('EACCES', normalize(path));
  }

  private assertRemovable(node: FSNode, path: string): void {
    if (node.protected || node.readonly) throw new SystemError('EACCES', normalize(path));
    const parent = this.nodes.get(node.parentId);
    if (parent?.readonly) throw new SystemError('EACCES', normalize(path));
  }

  /** `strict`: a brand-new node needs at least one free byte, even when it is empty. */
  private assertSpace(delta: number, strict: boolean): void {
    const free = this._capacity - this.usedBytes;
    if (delta > free || (strict && free <= 0)) throw new SystemError('ENOSPC');
  }

  private insert(
    parent: FSNode,
    name: string,
    type: FSNode['type'],
    content: string | Uint8Array | undefined,
    size: number,
  ): FSNode {
    const t = this.now();
    const node: FSNode = { id: uid('n'), name, type, parentId: parent.id, size, createdAt: t, modifiedAt: t };
    if (type === 'file') {
      node.content = content ?? '';
      this.usedBytes += size;
    } else this.children.set(node.id, new Map());
    this.nodes.set(node.id, node);
    this.children.get(parent.id)!.set(name, node.id);
    this.touch(parent);
    return node;
  }

  private removeSubtree(node: FSNode): void {
    if (node.type === 'directory') for (const child of this.childNodes(node)) this.removeSubtree(child);
    else this.usedBytes -= node.size;
    this.children.delete(node.id);
    this.children.get(node.parentId)?.delete(node.name);
    this.nodes.delete(node.id);
  }

  private cloneSubtree(node: FSNode, parent: FSNode, name: string): FSNode {
    const t = this.now();
    const copy: FSNode = {
      id: uid('n'),
      name,
      type: node.type,
      parentId: parent.id,
      size: node.size,
      createdAt: t,
      modifiedAt: t,
    };
    if (node.type === 'file') {
      copy.content = node.content ?? '';
      this.usedBytes += node.size;
    } else this.children.set(copy.id, new Map());
    this.nodes.set(copy.id, copy);
    this.children.get(parent.id)!.set(name, copy.id);
    if (node.type === 'directory') {
      for (const child of this.childNodes(node)) this.cloneSubtree(child, copy, child.name);
    }
    return copy;
  }

  /** True when `node` is `ancestor` or lives somewhere below it. */
  private isDescendant(node: FSNode, ancestor: FSNode): boolean {
    let cur: FSNode | undefined = node;
    while (cur) {
      if (cur.id === ancestor.id) return true;
      cur = this.nodes.get(cur.parentId);
    }
    return false;
  }

  private uniqueName(dir: FSNode, name: string): string {
    if (!this.childId(dir, name)) return name;
    const dot = name.lastIndexOf('.');
    const stem = dot > 0 ? name.slice(0, dot) : name;
    const ext = dot > 0 ? name.slice(dot) : '';
    for (let i = 2; ; i++) {
      const candidate = `${stem} (${i})${ext}`;
      if (!this.childId(dir, candidate)) return candidate;
    }
  }

  private sizeOf(node: FSNode): number {
    if (node.type === 'file') return node.size;
    let total = 0;
    for (const child of this.childNodes(node)) total += this.sizeOf(child);
    return total;
  }

  private touch(node: FSNode | undefined): void {
    if (node) node.modifiedAt = this.now();
  }

  private statsOf(node: FSNode): FileStats {
    const stats: FileStats = {
      id: node.id,
      name: node.name === '' ? SEP : node.name,
      path: this.getPath(node.id),
      type: node.type,
      size: this.sizeOf(node),
      createdAt: node.createdAt,
      modifiedAt: node.modifiedAt,
      parentId: node.parentId,
      protected: !!node.protected,
      readonly: !!node.readonly,
    };
    if (node.type === 'directory') stats.childCount = this.children.get(node.id)?.size ?? 0;
    if (node.trash) stats.trash = { ...node.trash };
    return stats;
  }
}
