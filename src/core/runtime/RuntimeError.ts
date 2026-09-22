import { SystemError } from '../errors';

/** The sandbox denied an operation the manifest didn't grant permission for. */
export function permissionDenied(path: string | undefined, message: string): SystemError {
  return new SystemError('EPERMISSION', path, message);
}

/** A runtime/WASM failure: bad manifest, failed instantiation, a trap during a tick, ... */
export function runtimeError(path: string | undefined, message: string): SystemError {
  return new SystemError('ERUNTIME', path, message);
}
