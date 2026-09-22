export type NodeType = 'file' | 'directory';

export interface TrashInfo {
  originalPath: string;
  deletedAt: number;
}

export interface FSNode {
  id: string;
  name: string;
  type: NodeType;
  /** Id of the parent directory. The root's parent is the empty string. */
  parentId: string;
  /** Text files use a string; binary files (installed WASM apps, WADs, ...) use raw bytes. */
  content?: string | Uint8Array;
  /** Bytes. For directories the stored value is 0; use getSize()/getStats() for the recursive size. */
  size: number;
  createdAt: number;
  modifiedAt: number;
  /** Cannot be deleted, renamed or moved. */
  protected?: boolean;
  /** Cannot be modified. For directories: children cannot be added or removed. */
  readonly?: boolean;
  trash?: TrashInfo;
}

export interface FileStats {
  id: string;
  name: string;
  path: string;
  type: NodeType;
  size: number;
  createdAt: number;
  modifiedAt: number;
  parentId: string;
  childCount?: number;
  protected: boolean;
  readonly: boolean;
  trash?: TrashInfo;
}

export interface FileSystemSnapshot {
  rootId: string;
  nodes: FSNode[];
}

export interface FileSystemOptions {
  snapshot?: FileSystemSnapshot;
  /** Bytes available to files. Defaults to unlimited. */
  capacityBytes?: number;
  now?: () => number;
  trashPath?: string;
}

export interface WriteOptions {
  /** Create the file when it doesn't exist (default true). */
  create?: boolean;
  append?: boolean;
}

export interface CreateFileOptions {
  /** Declared size in bytes, for "sparse" files that don't carry real content. */
  size?: number;
}
