import { memo, useCallback, useRef, type PointerEvent as ReactPointerEvent } from 'react';
import { appRegistry } from '../../apps';
import { ErrorBoundary } from '../../components/ErrorBoundary';
import { Icon, AppIcon } from '../../components/Icon';
import type { WindowState } from '../../core/windows/types';
import { useComputer } from '../../hooks/useComputer';
import { useVersion } from '../../hooks/useObservable';
import { requestCloseWindow } from '../actions';

type ResizeDir = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';
const RESIZE_DIRS: ResizeDir[] = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];

interface Props {
  win: WindowState;
  active: boolean;
}

/** Shown over an application whose process was suspended from the Task Manager. */
function SuspendedOverlay({ pid }: { pid: number }) {
  const computer = useComputer();
  useVersion(computer.processManager);
  const process = computer.processManager.get(pid);
  if (process?.status !== 'stopped') return null;
  return (
    <div className="suspended">
      <Icon name="pause" size={28} />
      <strong>Process suspended</strong>
      <button className="btn btn-primary" onClick={() => computer.processManager.resume(pid)}>
        Resume
      </button>
    </div>
  );
}

function WindowFrameImpl({ win, active }: Props) {
  const computer = useComputer();
  const wm = computer.windowManager;
  const def = appRegistry.find(win.appId);
  const drag = useRef<{ px: number; py: number; x: number; y: number } | null>(null);

  const onTitlePointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (e.button !== 0 || (e.target as HTMLElement).closest('button')) return;
      wm.focus(win.id);
      if (win.maximized) return;
      drag.current = { px: e.clientX, py: e.clientY, x: win.x, y: win.y };
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    [wm, win.id, win.maximized, win.x, win.y],
  );

  const onTitlePointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const d = drag.current;
      if (d) wm.move(win.id, d.x + e.clientX - d.px, d.y + e.clientY - d.py);
    },
    [wm, win.id],
  );

  const endDrag = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    drag.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  }, []);

  const onResizeDown = (dir: ResizeDir) => (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || win.maximized) return;
    e.preventDefault();
    e.stopPropagation();
    wm.focus(win.id);
    const start = { px: e.clientX, py: e.clientY, x: win.x, y: win.y, w: win.width, h: win.height };
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - start.px;
      const dy = ev.clientY - start.py;
      let { x, y, w, h } = start;
      if (dir.includes('e')) w = start.w + dx;
      if (dir.includes('s')) h = start.h + dy;
      if (dir.includes('w')) {
        w = Math.max(win.minWidth, start.w - dx);
        x = start.x + (start.w - w);
      }
      if (dir.includes('n')) {
        h = Math.max(win.minHeight, start.h - dy);
        y = start.y + (start.h - h);
      }
      wm.setBounds(win.id, { x, y, width: w, height: h });
    };
    const up = () => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
      target.removeEventListener('pointercancel', up);
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
    target.addEventListener('pointercancel', up);
  };

  if (!def) return null;
  const App = def.component;

  const style = win.maximized
    ? { zIndex: win.zIndex }
    : { left: win.x, top: win.y, width: win.width, height: win.height, zIndex: win.zIndex };

  return (
    <section
      className={`window${active ? ' active' : ''}${win.minimized ? ' minimized' : ''}${win.maximized ? ' maximized' : ''}`}
      style={style}
      tabIndex={-1}
      aria-label={win.title}
      aria-hidden={win.minimized}
      data-window-id={win.id}
      onPointerDownCapture={() => {
        if (!active) wm.focus(win.id);
      }}
    >
      <div
        className="titlebar"
        onPointerDown={onTitlePointerDown}
        onPointerMove={onTitlePointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onDoubleClick={(e) => {
          if (!(e.target as HTMLElement).closest('button')) wm.toggleMaximize(win.id);
        }}
      >
        <span className="titlebar-icon">
          <AppIcon name={def.icon} size={18} />
        </span>
        <span className="titlebar-title">
          {win.title}
          {win.dirty && <span className="dirty-dot" title="Unsaved changes" />}
        </span>
        <div className="titlebar-buttons">
          <button className="wbtn" title="Minimize" aria-label="Minimize" onClick={() => wm.minimize(win.id)}>
            <Icon name="minimize" size={14} />
          </button>
          <button
            className="wbtn"
            title={win.maximized ? 'Restore' : 'Maximize'}
            aria-label={win.maximized ? 'Restore' : 'Maximize'}
            onClick={() => wm.toggleMaximize(win.id)}
          >
            <Icon name={win.maximized ? 'copy' : 'maximize'} size={win.maximized ? 13 : 12} />
          </button>
          <button className="wbtn wbtn-close" title="Close" aria-label="Close" onClick={() => void requestCloseWindow(computer, win.id)}>
            <Icon name="close" size={15} />
          </button>
        </div>
      </div>
      <div className="window-body">
        <ErrorBoundary label={def.name}>
          <App windowId={win.id} pid={win.pid} args={win.args} />
        </ErrorBoundary>
        <SuspendedOverlay pid={win.pid} />
      </div>
      {!win.maximized && RESIZE_DIRS.map((d) => <div key={d} className={`resize resize-${d}`} onPointerDown={onResizeDown(d)} />)}
    </section>
  );
}

export const WindowFrame = memo(WindowFrameImpl);
