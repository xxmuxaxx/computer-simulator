import { useWindows } from '../../hooks/useObservable';
import { useComputer } from '../../hooks/useComputer';
import { useVersion } from '../../hooks/useObservable';
import { WindowFrame } from './WindowFrame';

/** Renders every window. Frames are keyed by id, so applications keep their state while stacking changes. */
export function WindowLayer() {
  const computer = useComputer();
  const windows = useWindows();
  useVersion(computer.windowManager);
  const activeId = computer.windowManager.activeId;
  return (
    <>
      {windows.map((w) => (
        <WindowFrame key={w.id} win={w} active={w.id === activeId} />
      ))}
    </>
  );
}
