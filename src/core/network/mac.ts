import { uid } from '../../utils/id';

/** Small string hash (not cryptographic) used to turn a unique id into MAC bytes. */
function hashByte(input: string, seed: number): number {
  let h = seed;
  for (let i = 0; i < input.length; i++) h = (Math.imul(h, 31) + input.charCodeAt(i)) >>> 0;
  return h & 0xff;
}

/**
 * Generates a MAC address guaranteed unique within the session, e.g. "02:1A:2B:3C:4D:5E".
 * Derived from `uid()` rather than an injected random source, so it stays unique even when
 * the computer's simulation clock uses a fixed random function (as tests do for determinism).
 */
export function generateMac(): string {
  const unique = uid('mac');
  const bytes = Array.from({ length: 6 }, (_, i) => hashByte(unique, i + 1));
  bytes[0] = (bytes[0]! & 0b11111100) | 0b00000010; // locally administered, unicast
  return bytes.map((b) => b.toString(16).toUpperCase().padStart(2, '0')).join(':');
}

const MAC_RE = /^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$/;

export function isValidMac(mac: string): boolean {
  return MAC_RE.test(mac.trim());
}
