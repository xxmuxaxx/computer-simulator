export interface ParsedUrl {
  scheme: 'http' | 'https';
  host: string;
  port?: number;
  path: string;
}

/** Parses "https://example.com:8080/a/b" (scheme optional, defaults to http) into its parts. */
export function parseUrl(input: string): ParsedUrl {
  let value = input.trim();
  let scheme: 'http' | 'https' = 'http';
  let port: number | undefined;
  const schemeMatch = /^(https?):\/\//i.exec(value);
  if (schemeMatch) {
    scheme = schemeMatch[1]!.toLowerCase() as 'http' | 'https';
    if (scheme === 'https') port = 443;
    value = value.slice(schemeMatch[0].length);
  }
  const slash = value.indexOf('/');
  const authority = slash >= 0 ? value.slice(0, slash) : value;
  const path = slash >= 0 ? value.slice(slash) : '/';
  const [host, portStr] = authority.split(':');
  return { scheme, host: host || 'localhost', port: portStr ? Number(portStr) : port, path: path || '/' };
}
