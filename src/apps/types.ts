import type { ComponentType } from 'react';
import type { LaunchArgs } from '../core/applications/types';

/** Props every application component receives from the window that hosts it. */
export interface AppProps {
  windowId: string;
  pid: number;
  args: LaunchArgs;
}

export type AppComponent = ComponentType<AppProps>;
