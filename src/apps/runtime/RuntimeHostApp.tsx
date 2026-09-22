import { useEffect, useRef, useState } from 'react';
import { DOOM_APP_ID, DOOM_WAD_RELATIVE_PATH, hasWad, installDoom, isValidWadHeader } from '../../core/runtime/doom/DoomRuntimeAdapter';
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
  const [customWad, setCustomWad] = useState(false);
  const [crashed, setCrashed] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [showWadPicker, setShowWadPicker] = useState(false);

  const attach = () => {
    if (!appId) return;
    try {
      const inst = computer.runtime.attach(pid, windowId, appId);
      setInstance(inst);
      setNotInstalled(false);
      setCrashed(inst.state === 'crashed');
      // The engine embeds a legally freely-distributable Shareware WAD as its own fallback, so
      // the game already plays with no WAD present - this only tracks whether the player has
      // opted into their own legally obtained WAD, never a blocking gate.
      setCustomWad(appId === DOOM_APP_ID && hasWad(inst.fileProvider));
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

  const install = async () => {
    setInstalling(true);
    try {
      await installDoom(computer.runtime);
      attach();
    } catch (e) {
      computer.reportError(e);
    } finally {
      setInstalling(false);
    }
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
    if (appId === DOOM_APP_ID && !isValidWadHeader(bytes)) {
      computer.notifications.error('Invalid WAD file', `"${file.name}" doesn't have a valid IWAD/PWAD header.`);
      return;
    }
    try {
      instance.fileProvider.writeFile(DOOM_WAD_RELATIVE_PATH, bytes);
    } catch (e) {
      computer.reportError(e);
      return;
    }
    setShowWadPicker(false);
    // doom.wasm only reads WAD data once, during its own startup - restart the instance so the
    // engine picks up the newly supplied file on its next initGame().
    const fresh = computer.attempt(() => computer.runtime.restart(pid));
    if (fresh) {
      setInstance(fresh);
      setCrashed(false);
      setCustomWad(true);
    }
  };

  const buttonsBitmask = (e: { buttons: number }) => e.buttons;

  if (notInstalled) {
    return (
      <div className="runtime-host runtime-placeholder">
        <p>Game data not found.</p>
        <p className="hint">This application hasn't been installed yet.</p>
        {appId === DOOM_APP_ID ? (
          <button className="btn btn-primary" disabled={installing} onClick={() => void install()}>
            {installing ? 'Installing…' : 'Install DOOM'}
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
          instance.reportKeyDown(e.key);
        }}
        onKeyUp={(e) => {
          e.preventDefault();
          instance.reportKeyUp(e.key);
        }}
        onBlur={() => instance.input.blur()}
        onMouseMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          instance.reportMouseMove(e.clientX - rect.left, e.clientY - rect.top, buttonsBitmask(e));
        }}
        onMouseDown={(e) => instance.reportMouseMove(instance.input.snapshot().mouseX, instance.input.snapshot().mouseY, buttonsBitmask(e))}
        onMouseUp={(e) => instance.reportMouseMove(instance.input.snapshot().mouseX, instance.input.snapshot().mouseY, buttonsBitmask(e))}
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
        {!crashed && appId === DOOM_APP_ID && (
          <div className="runtime-wad-control">
            {showWadPicker ? (
              <div className="runtime-wad-picker">
                <p className="hint">Select a legally obtained DOOM IWAD - never a bundled/commercial one.</p>
                <div className="runtime-wad-actions">
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
                  <button className="btn" onClick={() => setShowWadPicker(false)}>
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button className="btn btn-ghost" onClick={() => setShowWadPicker(true)}>
                {customWad ? 'Change WAD' : 'Use my own WAD…'}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
