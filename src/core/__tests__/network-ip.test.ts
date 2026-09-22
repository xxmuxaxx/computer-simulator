import { describe, expect, it } from 'vitest';
import {
  calculateBroadcast,
  calculateNetwork,
  formatIp,
  incrementIp,
  ipRange,
  isPrivateIp,
  isSameSubnet,
  isValidCidr,
  isValidIp,
  isValidSubnetMask,
  maskToPrefixLength,
  networkFromCidr,
  parseCidr,
  parseIp,
  prefixToMask,
} from '../network/ip';

describe('IP parsing and validation', () => {
  it('parses valid dotted-decimal addresses', () => {
    expect(parseIp('192.168.0.1')).toEqual([192, 168, 0, 1]);
    expect(formatIp([10, 0, 0, 1])).toBe('10.0.0.1');
  });

  it('validates addresses', () => {
    expect(isValidIp('192.168.0.1')).toBe(true);
    expect(isValidIp('172.16.0.1')).toBe(true);
    expect(isValidIp('256.0.0.1')).toBe(false);
    expect(isValidIp('1.2.3')).toBe(false);
    expect(isValidIp('a.b.c.d')).toBe(false);
  });

  it('throws on malformed input', () => {
    expect(() => parseIp('not-an-ip')).toThrow();
  });

  it('increments and compares addresses', () => {
    expect(incrementIp('192.168.0.1')).toBe('192.168.0.2');
    expect(incrementIp('192.168.0.255')).toBe('192.168.1.0');
    expect(ipRange('192.168.0.1', '192.168.0.3')).toEqual(['192.168.0.1', '192.168.0.2', '192.168.0.3']);
  });
});

describe('subnet masks', () => {
  it('validates contiguous masks', () => {
    expect(isValidSubnetMask('255.255.255.0')).toBe(true);
    expect(isValidSubnetMask('255.255.0.0')).toBe(true);
    expect(isValidSubnetMask('255.0.255.0')).toBe(false);
    expect(isValidSubnetMask('300.0.0.0')).toBe(false);
  });

  it('converts between mask and prefix length', () => {
    expect(maskToPrefixLength('255.255.255.0')).toBe(24);
    expect(maskToPrefixLength('255.255.0.0')).toBe(16);
    expect(prefixToMask(24)).toBe('255.255.255.0');
    expect(prefixToMask(8)).toBe('255.0.0.0');
    expect(prefixToMask(0)).toBe('0.0.0.0');
  });
});

describe('CIDR', () => {
  it('validates and parses CIDR notation', () => {
    expect(isValidCidr('192.168.0.0/24')).toBe(true);
    expect(isValidCidr('10.0.0.0/8')).toBe(true);
    expect(isValidCidr('10.0.0.0/33')).toBe(false);
    expect(isValidCidr('not-a-cidr')).toBe(false);
    expect(parseCidr('192.168.0.0/24')).toEqual({ ip: '192.168.0.0', prefix: 24 });
  });

  it('derives network/broadcast/mask from a CIDR block', () => {
    expect(networkFromCidr('192.168.0.10/24')).toEqual({
      network: '192.168.0.0',
      broadcast: '192.168.0.255',
      mask: '255.255.255.0',
      prefix: 24,
    });
  });
});

describe('subnet calculations', () => {
  it('calculates network and broadcast addresses', () => {
    expect(calculateNetwork('192.168.0.42', '255.255.255.0')).toBe('192.168.0.0');
    expect(calculateBroadcast('192.168.0.42', '255.255.255.0')).toBe('192.168.0.255');
    expect(calculateNetwork('10.1.2.3', '255.0.0.0')).toBe('10.0.0.0');
  });

  it('tells whether two addresses share a subnet', () => {
    expect(isSameSubnet('192.168.0.10', '192.168.0.200', '255.255.255.0')).toBe(true);
    expect(isSameSubnet('192.168.0.10', '192.168.1.10', '255.255.255.0')).toBe(false);
  });
});

describe('private address ranges', () => {
  it('recognises RFC1918 and loopback ranges', () => {
    expect(isPrivateIp('192.168.1.1')).toBe(true);
    expect(isPrivateIp('10.0.0.1')).toBe(true);
    expect(isPrivateIp('172.16.5.5')).toBe(true);
    expect(isPrivateIp('172.32.0.1')).toBe(false);
    expect(isPrivateIp('127.0.0.1')).toBe(true);
    expect(isPrivateIp('8.8.8.8')).toBe(false);
  });
});
