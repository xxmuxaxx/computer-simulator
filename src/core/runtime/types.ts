/** Capabilities a runtime application may be granted. Checked by RuntimeFileProvider/RuntimeInput/RuntimeDisplay. */
export type RuntimePermission = 'fs:read' | 'fs:write' | 'input:keyboard' | 'input:mouse' | 'display:render';

export type RuntimeManifestType = 'wasm' | 'game' | 'application';

/**
 * Describes an installed runtime application. Stored as `/apps/<id>/manifest.json` in the
 * VirtualFileSystem - there is no separate manifest registry to keep in sync.
 */
export interface RuntimeManifest {
  id: string;
  name: string;
  version: string;
  type: RuntimeManifestType;
  /** Path to the WASM module, relative to `/apps/<id>/`. */
  executable: string;
  icon?: string;
  description?: string;
  /** Reserved memory while running (MB), reported to ProcessManager/VirtualMemory at launch. */
  memoryUsage: number;
  /** Baseline CPU usage (percent) reported once the instance starts ticking. */
  cpuUsage?: number;
  display: { width: number; height: number };
  permissions: RuntimePermission[];
}

export type RuntimeState = 'starting' | 'running' | 'paused' | 'stopped' | 'crashed';

export interface RuntimeInstanceInfo {
  id: string;
  pid: number;
  windowId: string;
  appId: string;
  appName: string;
  state: RuntimeState;
  startedAt: number;
  fps: number;
  cpuUsage: number;
  memoryUsage: number;
  wasmStatus: 'loading' | 'loaded' | 'error';
  displayWidth: number;
  displayHeight: number;
  inputConnected: boolean;
  lastError?: string;
}
