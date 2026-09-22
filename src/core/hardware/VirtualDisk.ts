import type { VirtualFileSystem } from '../filesystem/VirtualFileSystem';

export const GB = 1024 ** 3;

export interface DiskSpec {
  totalBytes: number;
  /** Space taken by the (virtual) operating system itself. */
  reservedBytes: number;
}

export const DEFAULT_DISK: DiskSpec = { totalBytes: 20 * GB, reservedBytes: Math.round(1.6 * GB) };

/** Virtual disk. Free space is derived from the file system, so file sizes affect it. */
export class VirtualDisk {
  readonly totalBytes: number;
  readonly reservedBytes: number;
  private fs: VirtualFileSystem;

  constructor(fs: VirtualFileSystem, spec: DiskSpec = DEFAULT_DISK) {
    this.fs = fs;
    this.totalBytes = spec.totalBytes;
    this.reservedBytes = spec.reservedBytes;
    fs.setCapacity(spec.totalBytes - spec.reservedBytes);
  }

  get usedBytes(): number {
    return this.reservedBytes + this.fs.getUsedBytes();
  }

  get freeBytes(): number {
    return Math.max(0, this.totalBytes - this.usedBytes);
  }

  get usagePercent(): number {
    return (this.usedBytes / this.totalBytes) * 100;
  }
}
