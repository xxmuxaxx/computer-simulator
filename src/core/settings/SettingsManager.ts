import { SystemError } from '../errors';
import { Observable } from '../../utils/Observable';

export type ThemeName = 'dark' | 'light';
export type ClockFormat = '12' | '24';

export interface Settings {
  theme: ThemeName;
  /** Root font-size multiplier. */
  uiScale: number;
  wallpaper: string;
  computerName: string;
  userName: string;
  clockFormat: ClockFormat;
  showDebugPanel: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'dark',
  uiScale: 1,
  wallpaper: 'aurora',
  computerName: 'sim-pc',
  userName: 'user',
  clockFormat: '24',
  showDebugPanel: false,
};

const NAME_RE = /^[A-Za-z0-9_.-]{1,32}$/;
const NAME_HINT = 'Only letters, digits, ".", "_" and "-" are allowed (max 32 characters)';

export class SettingsManager extends Observable {
  private settings: Settings;

  constructor(initial?: Partial<Settings>) {
    super();
    this.settings = { ...DEFAULT_SETTINGS, ...initial };
  }

  /** Immutable snapshot; a new object is created for every change. */
  getSnapshot = (): Settings => this.settings;

  update(patch: Partial<Settings>): void {
    if (patch.computerName !== undefined && !NAME_RE.test(patch.computerName)) {
      throw new SystemError('EINVAL', undefined, `Invalid computer name. ${NAME_HINT}`);
    }
    if (patch.userName !== undefined && !NAME_RE.test(patch.userName)) {
      throw new SystemError('EINVAL', undefined, `Invalid user name. ${NAME_HINT}`);
    }
    this.settings = { ...this.settings, ...patch };
    this.emit();
  }

  reset(): void {
    this.settings = { ...DEFAULT_SETTINGS };
    this.emit();
  }
}
