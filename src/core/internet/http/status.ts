export const STATUS_TEXT: Record<number, string> = {
  200: 'OK',
  201: 'Created',
  301: 'Moved Permanently',
  302: 'Found',
  400: 'Bad Request',
  403: 'Forbidden',
  404: 'Not Found',
  405: 'Method Not Allowed',
  500: 'Internal Server Error',
  503: 'Service Unavailable',
};

export function statusText(code: number): string {
  return STATUS_TEXT[code] ?? 'Unknown Status';
}
