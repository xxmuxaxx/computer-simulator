import { SystemError } from '../errors';
import { Observable } from '../../utils/Observable';

/** Virtual RAM. Processes reserve memory here (in MB). */
export class VirtualMemory extends Observable {
  readonly totalMB: number;
  private allocations = new Map<number, number>();

  constructor(totalMB = 4096) {
    super();
    this.totalMB = totalMB;
  }

  get usedMB(): number {
    let sum = 0;
    for (const mb of this.allocations.values()) sum += mb;
    return sum;
  }

  get freeMB(): number {
    return this.totalMB - this.usedMB;
  }

  get usagePercent(): number {
    return (this.usedMB / this.totalMB) * 100;
  }

  canAllocate(mb: number): boolean {
    return mb <= this.freeMB;
  }

  allocate(owner: number, mb: number): void {
    if (!this.canAllocate(mb)) throw new SystemError('ENOMEM', undefined, 'Out of memory');
    this.allocations.set(owner, (this.allocations.get(owner) ?? 0) + mb);
    this.emit();
  }

  free(owner: number): number {
    const mb = this.allocations.get(owner) ?? 0;
    this.allocations.delete(owner);
    this.emit();
    return mb;
  }

  allocationOf(owner: number): number {
    return this.allocations.get(owner) ?? 0;
  }

  clear(): void {
    this.allocations.clear();
    this.emit();
  }
}
