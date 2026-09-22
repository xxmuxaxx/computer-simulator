export type ErrorCode =
  | 'ENOENT'
  | 'EEXIST'
  | 'ENOTDIR'
  | 'EISDIR'
  | 'ENOTEMPTY'
  | 'ENOSPC'
  | 'EACCES'
  | 'EINVAL'
  | 'ESRCH'
  | 'ENOMEM'
  | 'ENOAPP'
  | 'ESYNTAX'
  | 'ECMD';

const DEFAULT_MESSAGES: Record<ErrorCode, string> = {
  ENOENT: 'File not found',
  EEXIST: 'Already exists',
  ENOTDIR: 'Not a directory',
  EISDIR: 'Is a directory',
  ENOTEMPTY: 'Directory not empty',
  ENOSPC: 'Disk is full',
  EACCES: 'Permission denied',
  EINVAL: 'Invalid argument',
  ESRCH: 'Process not found',
  ENOMEM: 'Out of memory',
  ENOAPP: 'Application not found',
  ESYNTAX: 'Syntax error',
  ECMD: 'Invalid command',
};

/** Every expected failure of the virtual computer is a SystemError. */
export class SystemError extends Error {
  readonly code: ErrorCode;
  readonly path?: string;

  constructor(code: ErrorCode, path?: string, message?: string) {
    super(message ?? DEFAULT_MESSAGES[code]);
    this.name = 'SystemError';
    this.code = code;
    this.path = path;
  }
}

export function isSystemError(e: unknown): e is SystemError {
  return e instanceof SystemError;
}

/** Human readable text for any thrown value: "File not found: /a/b". */
export function errorMessage(e: unknown): string {
  if (isSystemError(e)) return e.path ? `${e.message}: ${e.path}` : e.message;
  if (e instanceof Error) return e.message;
  return String(e);
}
