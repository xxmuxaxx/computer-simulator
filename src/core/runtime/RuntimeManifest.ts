import { runtimeError } from './RuntimeError';
import type { RuntimeManifest, RuntimeManifestType, RuntimePermission } from './types';

const VALID_TYPES: readonly RuntimeManifestType[] = ['wasm', 'game', 'application'];
const VALID_PERMISSIONS: readonly RuntimePermission[] = [
  'fs:read',
  'fs:write',
  'input:keyboard',
  'input:mouse',
  'display:render',
];

function isValidPermission(value: unknown): value is RuntimePermission {
  return typeof value === 'string' && (VALID_PERMISSIONS as readonly string[]).includes(value);
}

/** Parses and validates a `manifest.json` payload. Throws ERUNTIME on anything malformed. */
export function parseManifest(json: string): RuntimeManifest {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    throw runtimeError(undefined, 'Malformed manifest.json');
  }
  if (typeof value !== 'object' || value === null) throw runtimeError(undefined, 'Malformed manifest.json');
  const v = value as Record<string, unknown>;

  const id = v.id;
  if (typeof id !== 'string' || !id) throw runtimeError(undefined, 'Manifest is missing "id"');
  if (typeof v.name !== 'string' || !v.name) throw runtimeError(id, 'Manifest is missing "name"');
  if (typeof v.version !== 'string' || !v.version) throw runtimeError(id, 'Manifest is missing "version"');
  if (typeof v.executable !== 'string' || !v.executable) throw runtimeError(id, 'Manifest is missing "executable"');
  if (typeof v.engine !== 'string' || !v.engine) throw runtimeError(id, 'Manifest is missing "engine"');
  if (!VALID_TYPES.includes(v.type as RuntimeManifestType)) throw runtimeError(id, 'Manifest has an invalid "type"');
  if (typeof v.memoryUsage !== 'number' || v.memoryUsage <= 0) throw runtimeError(id, 'Manifest is missing "memoryUsage"');

  const display = v.display as { width?: unknown; height?: unknown } | undefined;
  if (!display || typeof display.width !== 'number' || typeof display.height !== 'number') {
    throw runtimeError(id, 'Manifest is missing "display"');
  }

  const permissions = Array.isArray(v.permissions) ? v.permissions.filter(isValidPermission) : [];

  return {
    id,
    name: v.name as string,
    version: v.version as string,
    type: v.type as RuntimeManifestType,
    engine: v.engine as string,
    executable: v.executable as string,
    icon: typeof v.icon === 'string' ? v.icon : undefined,
    description: typeof v.description === 'string' ? v.description : undefined,
    memoryUsage: v.memoryUsage as number,
    cpuUsage: typeof v.cpuUsage === 'number' ? v.cpuUsage : undefined,
    display: { width: display.width, height: display.height },
    permissions,
  };
}

export function serializeManifest(manifest: RuntimeManifest): string {
  return JSON.stringify(manifest, null, 2) + '\n';
}
