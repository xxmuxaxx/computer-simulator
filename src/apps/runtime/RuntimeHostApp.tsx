import { useEffect, useRef, useState } from 'react';
import { DOOM_APP_ID, DOOM_WAD_RELATIVE_PATH, hasWad, installDoom } from '../../core/runtime/doom/DoomRuntimeAdapter';
import type { RuntimeInstance } from '../../core/runtime/RuntimeInstance';
import { useComputer } from '../../hooks/useComputer';
import { useWindow } from '../../hooks/useObservable';
import type { AppProps } from '../types';
import './runtime-host.css';

/**
 * Generic host component shared by every runtime-backed application: it knows nothing about
 * DOOM specifically (beyond the one WAD-picker affordance below) and would work unmodified for
 * any future game registered through the same runtime. It owns the canvas paint loop and forwards
 * keyboard/mouse to RuntimeInput - the sandboxed module never sees a real browser event.
 */
export function RuntimeHostApp({ windowId, pid }: AppProps) {
  const computer = useComputer();
  const win = useWindow(windowId);
  const appId = win?.appId;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [instance, setInstance] = useState<RuntimeInstance | null>(null);
  const [notInstalled, setNotInstalled] = useState(false);
  const [needsWad, setNeedsWad] = useState(false);
  const [crashed, setCrashed] = useState(false);

  const attach = () => {
    if (!appId) return;
    try {
      const inst = computer.runtime.attach(pid, windowId, appId);
      setInstance(inst);
      setNotInstalled(false);
      setCrashed(inst.state === 'crashed');
      setNeedsWad(appId === DOOM_APP_ID && !hasWad(inst.fileProvider));
    } catch {
      setNotInstalled(true);
    }
  };

  useEffect(attach, [computer, pid, windowId, appId]);

  // Paint loop: independent of the instance's own update/render cadence, it just repaints
  // whatever is currently in the shared frame buffer as fast as the browser allows.
  useEffect(() => {
    if (!instance) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    let handle: number;
    const paint = () => {
      const isCrashed = instance.state === 'crashed';
      setCrashed(isCrashed);
      if (!isCrashed) {
        try {
          const buffer = instance.display.getFrameBuffer();
          ctx.putImageData(new ImageData(new Uint8ClampedArray(buffer), instance.display.width, instance.display.height), 0, 0);
        } catch {
          // Missing display:render permission - nothing to paint.
        }
      }
      handle = requestAnimationFrame(paint);
    };
    handle = requestAnimationFrame(paint);
    return () => cancelAnimationFrame(handle);
  }, [instance]);

  const install = () => {
    computer.attempt(() => installDoom(computer.runtime));
    attach();
  };

  const restart = () => {
    const fresh = computer.attempt(() => computer.runtime.restart(pid));
    if (fresh) {
      setInstance(fresh);
      setCrashed(false);
    }
  };

  const pickWadFile = async (file: File) => {
    if (!instance) return;
    const bytes = new Uint8Array(await file.arrayBuffer());
    computer.attempt(() => instance.fileProvider.writeFile(DOOM_WAD_RELATIVE_PATH, bytes));
    setNeedsWad(!hasWad(instance.fileProvider));
  };

  const buttonsBitmask = (e: { buttons: number }) => e.buttons;

  if (notInstalled) {
    return (
      <div className="runtime-host runtime-placeholder">
        <p>Game data not found.</p>
        <p className="hint">This application hasn't been installed yet.</p>
        {appId === DOOM_APP_ID ? (
          <button className="btn btn-primary" onClick={install}>
            Install DOOM
          </button>
        ) : (
          <p className="hint">Install it from Game Manager first.</p>
        )}
      </div>
    );
  }

  if (!instance) return <div className="runtime-host runtime-placeholder" />;

  return (
    <div className="runtime-host">
      <div
        className="runtime-canvas-wrap"
        tabIndex={0}
        onKeyDown={(e) => {
          e.preventDefault();
          instance.input.pushKey(e.code, true);
        }}
        onKeyUp={(e) => {
          e.preventDefault();
          instance.input.pushKey(e.code, false);
        }}
        onBlur={() => instance.input.blur()}
        onMouseMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          instance.input.pushMouse(e.clientX - rect.left, e.clientY - rect.top, buttonsBitmask(e));
        }}
        onMouseDown={(e) => instance.input.pushMouse(instance.input.snapshot().mouseX, instance.input.snapshot().mouseY, buttonsBitmask(e))}
        onMouseUp={(e) => instance.input.pushMouse(instance.input.snapshot().mouseX, instance.input.snapshot().mouseY, buttonsBitmask(e))}
      >
        <canvas ref={canvasRef} width={instance.display.width} height={instance.display.height} />
        {crashed && (
          <div className="runtime-overlay">
            <p>Application crashed</p>
            <p className="hint">{instance.manifest.name} was terminated unexpectedly.</p>
            <button className="btn btn-primary" onClick={restart}>
              Restart
            </button>
          </div>
        )}
        {!crashed && needsWad && (
          <div className="runtime-overlay">
            <p>Game data not found.</p>
            <p className="hint">Please provide a legally obtained DOOM IWAD.</p>
            <label className="btn btn-primary">
              Select File
              <input
                type="file"
                accept=".wad"
                hidden
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void pickWadFile(file);
                }}
              />
            </label>
          </div>
        )}
      </div>
    </div>
  );
}
