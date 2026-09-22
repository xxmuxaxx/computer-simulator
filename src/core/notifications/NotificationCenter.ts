import { Observable } from '../../utils/Observable';
import { uid } from '../../utils/id';

export type NotificationType = 'success' | 'info' | 'warning' | 'error';

export interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  message?: string;
  createdAt: number;
  /** Auto-dismiss delay; the UI layer owns the timer. */
  timeoutMs: number;
}

export interface NotifyInput {
  type?: NotificationType;
  title: string;
  message?: string;
  timeoutMs?: number;
}

const MAX_KEPT = 50;

export class NotificationCenter extends Observable {
  private items: readonly Notification[] = [];
  private now: () => number;

  constructor(now: () => number = Date.now) {
    super();
    this.now = now;
  }

  getSnapshot = (): readonly Notification[] => this.items;

  notify(input: NotifyInput): Notification {
    const n: Notification = {
      id: uid('ntf'),
      type: input.type ?? 'info',
      title: input.title,
      message: input.message,
      createdAt: this.now(),
      timeoutMs: input.timeoutMs ?? (input.type === 'error' ? 6000 : 3500),
    };
    this.items = [...this.items, n].slice(-MAX_KEPT);
    this.emit();
    return n;
  }

  success(title: string, message?: string): Notification {
    return this.notify({ type: 'success', title, message });
  }
  info(title: string, message?: string): Notification {
    return this.notify({ type: 'info', title, message });
  }
  warning(title: string, message?: string): Notification {
    return this.notify({ type: 'warning', title, message });
  }
  error(title: string, message?: string): Notification {
    return this.notify({ type: 'error', title, message });
  }

  dismiss(id: string): void {
    const next = this.items.filter((n) => n.id !== id);
    if (next.length === this.items.length) return;
    this.items = next;
    this.emit();
  }

  clear(): void {
    this.items = [];
    this.emit();
  }
}
