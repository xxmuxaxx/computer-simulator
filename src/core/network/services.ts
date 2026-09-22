import { SystemError } from '../errors';
import { uid } from '../../utils/id';
import type { NetworkService } from './types';

export interface ServiceSpec {
  name: string;
  protocol: 'TCP' | 'UDP';
  port: number;
  status?: 'running' | 'stopped';
}

export const WELL_KNOWN_SERVICES: Record<string, ServiceSpec> = {
  http: { name: 'HTTP', protocol: 'TCP', port: 80 },
  https: { name: 'HTTPS', protocol: 'TCP', port: 443 },
  ssh: { name: 'SSH', protocol: 'TCP', port: 22 },
  ftp: { name: 'FTP', protocol: 'TCP', port: 21 },
  dns: { name: 'DNS', protocol: 'UDP', port: 53 },
  dhcp: { name: 'DHCP', protocol: 'UDP', port: 67 },
};

export function createService(spec: ServiceSpec): NetworkService {
  return { id: uid('svc'), name: spec.name, protocol: spec.protocol, port: spec.port, status: spec.status ?? 'stopped' };
}

export function findServiceByPort(services: readonly NetworkService[], port: number, protocol: 'TCP' | 'UDP'): NetworkService | undefined {
  return services.find((s) => s.port === port && s.protocol === protocol);
}

export function assertPortFree(services: readonly NetworkService[], port: number, protocol: 'TCP' | 'UDP', ignoreId?: string): void {
  const existing = findServiceByPort(services, port, protocol);
  if (existing && existing.id !== ignoreId && existing.status === 'running') {
    throw new SystemError('EPORTINUSE', String(port), `Port ${port}/${protocol} is already in use by ${existing.name}`);
  }
}
