const DEFAULT_PORTS: Record<string, number> = { http: 80, https: 443 };

/** Same-origin key: scheme + host + port, matching the browser security model. */
export function originOf(scheme: string, host: string, port?: number): string {
  const effectivePort = port ?? DEFAULT_PORTS[scheme];
  const shown = effectivePort && effectivePort !== DEFAULT_PORTS[scheme] ? `:${effectivePort}` : '';
  return `${scheme}://${host}${shown}`;
}

export function hostOf(origin: string): string {
  return origin.replace(/^[a-z]+:\/\//, '').split(':')[0]!;
}
