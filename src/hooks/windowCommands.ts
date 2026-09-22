import { useEffect, useRef, type MutableRefObject } from 'react';

/** Commands the desktop can route to the focused window (keyboard shortcuts). */
export type WindowCommand = 'save' | 'saveAs' | 'delete' | 'rename' | 'newFile' | 'open' | 'find';

type Handlers = Partial<Record<WindowCommand, () => void>>;

const registry = new Map<string, MutableRefObject<Handlers>>();

/** Lets an application react to shortcuts such as Ctrl+S or F2 while its window is active. */
export function useWindowCommands(windowId: string, handlers: Handlers): void {
  const ref = useRef(handlers);
  ref.current = handlers;
  useEffect(() => {
    registry.set(windowId, ref);
    return () => {
      registry.delete(windowId);
    };
  }, [windowId]);
}

/** Returns true when the window handles the command. */
export function dispatchWindowCommand(windowId: string, command: WindowCommand): boolean {
  const handler = registry.get(windowId)?.current[command];
  if (!handler) return false;
  handler();
  return true;
}
