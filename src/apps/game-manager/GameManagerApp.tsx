import { useState } from 'react';
import { Icon } from '../../components/Icon';
import { DOOM_APP_ID, createDoomManifest, installDoom, installDoomFromBytes } from '../../core/runtime/doom/DoomRuntimeAdapter';
import type { RuntimeManager } from '../../core/runtime/RuntimeManager';
import type { RuntimeManifest } from '../../core/runtime/types';
import { useComputer } from '../../hooks/useComputer';
import { useVersion } from '../../hooks/useObservable';
import type { AppProps } from '../types';
import './game-manager.css';

interface AvailableGame {
  manifest: () => RuntimeManifest;
  /** Fetches the engine from a static asset path - works for a local dev checkout with the file
   * manually placed, has nothing to fetch on a deployed build that never published it. */
  install: (runtime: RuntimeManager) => Promise<void>;
  /** Installs from a player-supplied file instead - the only option that works on any deployment,
   * since the engine binary is a third-party GPL asset this project doesn't vendor. */
  installFromBytes?: (runtime: RuntimeManager, bytes: Uint8Array) => void;
}

/** Adapters that can be installed, whether or not they're installed yet - just DOOM for now. */
const AVAILABLE: AvailableGame[] = [{ manifest: createDoomManifest, install: installDoom, installFromBytes: installDoomFromBytes }];

export function GameManagerApp(_props: AppProps) {
  const computer = useComputer();
  useVersion(computer.runtime);
  const [selected, setSelected] = useState<string | null>(null);
  const [installing, setInstalling] = useState<string | null>(null);
  const [uploadTarget, setUploadTarget] = useState<string | null>(null);

  const installed = computer.runtime.registry.list();
  const installedIds = new Set(installed.map((m) => m.id));
  const notInstalled = AVAILABLE.map((a) => a.manifest()).filter((m) => !installedIds.has(m.id));

  const play = (id: string) => computer.attempt(() => computer.launch(id));
  const install = async (id: string) => {
    const entry = AVAILABLE.find((a) => a.manifest().id === id);
    if (!entry) return;
    setUploadTarget(null);
    setInstalling(id);
    try {
      await entry.install(computer.runtime);
    } catch (e) {
      computer.reportError(e);
    } finally {
      setInstalling(null);
    }
  };
  const uploadEngine = async (id: string, file: File) => {
    const entry = AVAILABLE.find((a) => a.manifest().id === id);
    if (!entry?.installFromBytes) return;
    setInstalling(id);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      entry.installFromBytes(computer.runtime, bytes);
      computer.notifications.success('Installed', `${entry.manifest().name} was installed from the uploaded file.`);
    } catch (e) {
      computer.reportError(e);
    } finally {
      setInstalling(null);
      setUploadTarget(null);
    }
  };
  const remove = (id: string) => {
    computer.attempt(() => computer.runtime.uninstall(id));
    if (selected === id) setSelected(null);
  };
  const resetSaves = (id: string) => {
    const dir = `/home/user/games/${id}/saves`;
    computer.attempt(() => {
      if (computer.fileSystem.exists(dir)) computer.fileSystem.delete(dir, { recursive: true });
      computer.fileSystem.createDirectory(dir, { recursive: true });
    });
    computer.notifications.success('Saves reset', `${id} save data was cleared.`);
  };

  const selectedManifest = installed.find((m) => m.id === selected);

  return (
    <div className="game-manager">
      <div className="gm-list">
        <h3>Installed Games</h3>
        {installed.length === 0 && <p className="hint">No games installed yet.</p>}
        {installed.map((m) => (
          <div key={m.id} className={`gm-row${selected === m.id ? ' selected' : ''}`} onClick={() => setSelected(m.id)}>
            <Icon name={m.icon ?? 'gamepad'} size={24} />
            <div className="gm-row-text">
              <strong>{m.name}</strong>
              <span>Version {m.version}</span>
            </div>
            <div className="gm-row-actions">
              <button
                className="btn btn-primary"
                onClick={(e) => {
                  e.stopPropagation();
                  play(m.id);
                }}
              >
                Play
              </button>
              <button
                className="btn"
                onClick={(e) => {
                  e.stopPropagation();
                  resetSaves(m.id);
                }}
              >
                Reset Saves
              </button>
              <button
                className="btn btn-danger"
                onClick={(e) => {
                  e.stopPropagation();
                  remove(m.id);
                }}
              >
                Remove
              </button>
            </div>
          </div>
        ))}

        {notInstalled.length > 0 && (
          <>
            <h3>Available</h3>
            {notInstalled.map((m) => {
              const entry = AVAILABLE.find((a) => a.manifest().id === m.id);
              const busy = installing === m.id;
              return (
                <div key={m.id} className="gm-row gm-available-row">
                  <Icon name={m.icon ?? 'gamepad'} size={24} />
                  <div className="gm-row-text">
                    <strong>{m.name}</strong>
                    <span>{m.description}</span>
                    {entry?.installFromBytes && (
                      <span className="gm-upload-hint">No local copy of the engine found? You can upload the .wasm file yourself.</span>
                    )}
                  </div>
                  <div className="gm-row-actions">
                    <button className="btn btn-primary" disabled={busy} onClick={() => void install(m.id)}>
                      {busy && uploadTarget !== m.id ? 'Installing…' : 'Install'}
                    </button>
                    {entry?.installFromBytes && (
                      <label className={`btn${busy ? ' btn-disabled' : ''}`}>
                        {busy && uploadTarget === m.id ? 'Uploading…' : 'Upload file…'}
                        <input
                          type="file"
                          accept=".wasm"
                          hidden
                          disabled={busy}
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            e.target.value = '';
                            if (file) {
                              setUploadTarget(m.id);
                              void uploadEngine(m.id, file);
                            }
                          }}
                        />
                      </label>
                    )}
                  </div>
                </div>
              );
            })}
          </>
        )}
      </div>

      {selectedManifest && (
        <aside className="gm-detail">
          <h3>{selectedManifest.name}</h3>
          <dl>
            <div>
              <dt>Version</dt>
              <dd>{selectedManifest.version}</dd>
            </div>
            <div>
              <dt>Type</dt>
              <dd>{selectedManifest.type}</dd>
            </div>
            <div>
              <dt>Memory</dt>
              <dd>{selectedManifest.memoryUsage} MB</dd>
            </div>
            <div>
              <dt>Display</dt>
              <dd>
                {selectedManifest.display.width}x{selectedManifest.display.height}
              </dd>
            </div>
            <div>
              <dt>Permissions</dt>
              <dd>{selectedManifest.permissions.join(', ') || '-'}</dd>
            </div>
          </dl>
          {selectedManifest.id === DOOM_APP_ID && (
            <p className="hint">Launching DOOM without a supplied WAD will prompt for one - only a legally obtained IWAD, never a bundled one.</p>
          )}
        </aside>
      )}
    </div>
  );
}
