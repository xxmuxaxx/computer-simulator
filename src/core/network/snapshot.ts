import type { FileSystemSnapshot } from '../filesystem/types';
import type { Connection, DnsRecord, Network, NetworkDevice } from './types';

export interface NetworkDeviceSnapshot extends NetworkDevice {
  /** Only present for non-local devices with their own file system (computer/server). */
  fileSystemSnapshot?: FileSystemSnapshot;
}

export interface NetworkSnapshot {
  networks: Network[];
  devices: NetworkDeviceSnapshot[];
  connections: Connection[];
  /** networkId -> its DNS records. */
  dns: Record<string, DnsRecord[]>;
  localDeviceId: string | null;
}
