import { SystemError } from '../errors';
import { Observable } from '../../utils/Observable';
import type { ApplicationDefinition } from './types';

export class ApplicationRegistry<TComponent = unknown> extends Observable {
  private apps = new Map<string, ApplicationDefinition<TComponent>>();

  register(definition: ApplicationDefinition<TComponent>): void {
    this.apps.set(definition.id, definition);
    this.emit();
  }

  unregister(id: string): void {
    this.apps.delete(id);
    this.emit();
  }

  has(id: string): boolean {
    return this.apps.has(id);
  }

  find(id: string): ApplicationDefinition<TComponent> | undefined {
    return this.apps.get(id);
  }

  get(id: string): ApplicationDefinition<TComponent> {
    const def = this.apps.get(id);
    if (!def) throw new SystemError('ENOAPP', id);
    return def;
  }

  list(): ApplicationDefinition<TComponent>[] {
    return [...this.apps.values()];
  }

  search(query: string, ids?: readonly string[]): ApplicationDefinition<TComponent>[] {
    const q = query.trim().toLowerCase();
    return this.list().filter(
      (a) =>
        (!ids || ids.includes(a.id)) &&
        (q === '' || a.name.toLowerCase().includes(q) || a.description.toLowerCase().includes(q) || a.id.includes(q)),
    );
  }
}
