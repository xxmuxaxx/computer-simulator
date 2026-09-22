import { Observable } from '../../utils/Observable';

/** Tracks which registered applications are installed on this computer. */
export class InstalledApplications extends Observable {
  private ids: readonly string[];

  constructor(initial: readonly string[] = []) {
    super();
    this.ids = [...new Set(initial)];
  }

  getSnapshot = (): readonly string[] => this.ids;

  has(id: string): boolean {
    return this.ids.includes(id);
  }

  install(id: string): void {
    if (this.has(id)) return;
    this.ids = [...this.ids, id];
    this.emit();
  }

  uninstall(id: string): void {
    if (!this.has(id)) return;
    this.ids = this.ids.filter((x) => x !== id);
    this.emit();
  }
}
