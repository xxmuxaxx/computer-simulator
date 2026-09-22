/**
 * IPv4 utilities. No dependency on the network device model - pure functions over
 * dotted-decimal strings, so they can be unit tested in isolation.
 */

const OCTET = String.raw`(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)`;
const IPV4_RE = new RegExp(`^${OCTET}\\.${OCTET}\\.${OCTET}\\.${OCTET}$`);

export function isValidIp(ip: string): boolean {
  return IPV4_RE.test(ip.trim());
}

/** Parses "192.168.0.1" into its four octets. Throws on malformed input. */
export function parseIp(ip: string): [number, number, number, number] {
  const m = IPV4_RE.exec(ip.trim());
  if (!m) throw new Error(`Invalid IPv4 address: ${ip}`);
  return [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
}

export function formatIp(octets: readonly [number, number, number, number]): string {
  return octets.join('.');
}

export function ipToInt(ip: string): number {
  const [a, b, c, d] = parseIp(ip);
  return ((a << 24) | (b << 16) | (c << 8) | d) >>> 0;
}

export function intToIp(n: number): string {
  return formatIp([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]);
}

export function compareIp(a: string, b: string): number {
  return ipToInt(a) - ipToInt(b);
}

export function incrementIp(ip: string, by = 1): string {
  return intToIp((ipToInt(ip) + by) >>> 0);
}

const MASK_RE = new RegExp(`^${OCTET}\\.${OCTET}\\.${OCTET}\\.${OCTET}$`);

export function isValidSubnetMask(mask: string): boolean {
  if (!MASK_RE.test(mask.trim())) return false;
  const bits = ipToInt(mask).toString(2).padStart(32, '0');
  // A valid mask is a run of 1s followed by a run of 0s.
  return /^1*0*$/.test(bits);
}

export function maskToPrefixLength(mask: string): number {
  if (!isValidSubnetMask(mask)) throw new Error(`Invalid subnet mask: ${mask}`);
  return ipToInt(mask).toString(2).split('1').length - 1;
}

export function prefixToMask(prefix: number): string {
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) throw new Error(`Invalid CIDR prefix: ${prefix}`);
  const n = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return intToIp(n);
}

export interface Cidr {
  ip: string;
  prefix: number;
}

const CIDR_RE = /^(.+)\/(\d{1,2})$/;

export function isValidCidr(cidr: string): boolean {
  const m = CIDR_RE.exec(cidr.trim());
  if (!m) return false;
  const prefix = Number(m[2]);
  return isValidIp(m[1]!) && prefix >= 0 && prefix <= 32;
}

export function parseCidr(cidr: string): Cidr {
  const m = CIDR_RE.exec(cidr.trim());
  if (!m) throw new Error(`Invalid CIDR notation: ${cidr}`);
  const ip = m[1]!;
  const prefix = Number(m[2]);
  if (!isValidIp(ip) || prefix < 0 || prefix > 32) throw new Error(`Invalid CIDR notation: ${cidr}`);
  return { ip, prefix };
}

export function calculateNetwork(ip: string, mask: string): string {
  return intToIp(ipToInt(ip) & ipToInt(mask));
}

export function calculateBroadcast(ip: string, mask: string): string {
  return intToIp((ipToInt(ip) & ipToInt(mask)) | (~ipToInt(mask) >>> 0));
}

export function isSameSubnet(ipA: string, ipB: string, mask: string): boolean {
  return calculateNetwork(ipA, mask) === calculateNetwork(ipB, mask);
}

/** True for RFC1918 private ranges (10/8, 172.16/12, 192.168/16) and loopback (127/8). */
export function isPrivateIp(ip: string): boolean {
  const [a, b] = parseIp(ip);
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 127) return true;
  return false;
}

/** Inclusive list of every address between `start` and `end`. */
export function ipRange(start: string, end: string): string[] {
  const from = ipToInt(start);
  const to = ipToInt(end);
  const out: string[] = [];
  for (let n = from; n <= to; n++) out.push(intToIp(n));
  return out;
}

/** Network/broadcast pair derived from a CIDR block, e.g. "192.168.0.0/24". */
export function networkFromCidr(cidr: string): { network: string; broadcast: string; mask: string; prefix: number } {
  const { ip, prefix } = parseCidr(cidr);
  const mask = prefixToMask(prefix);
  return { network: calculateNetwork(ip, mask), broadcast: calculateBroadcast(ip, mask), mask, prefix };
}
