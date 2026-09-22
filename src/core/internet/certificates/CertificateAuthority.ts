import { uid } from '../../../utils/id';
import type { InternetEventBus } from '../events';
import type { CertificateStatus, VirtualCertificate } from '../types';

export interface CertificateAuthorityOptions {
  now: () => number;
  events: InternetEventBus;
}

const DEFAULT_VALIDITY_MS = 365 * 24 * 60 * 60 * 1000;
const ISSUER = 'Virtual CA';

/**
 * A minimal, non-cryptographic HTTPS simulation (spec explicitly says this is not real TLS): one
 * certificate per exact domain name, checked by the Browser before it renders an https:// page.
 */
export class CertificateAuthority {
  private certificates = new Map<string, VirtualCertificate>();
  private readonly now: () => number;
  private readonly events: InternetEventBus;

  constructor(options: CertificateAuthorityOptions) {
    this.now = options.now;
    this.events = options.events;
  }

  issue(domain: string, validityMs = DEFAULT_VALIDITY_MS): VirtualCertificate {
    const now = this.now();
    const certificate: VirtualCertificate = { id: uid('cert'), domain: domain.toLowerCase(), issuer: ISSUER, validFrom: now, validTo: now + validityMs };
    this.certificates.set(certificate.domain, certificate);
    this.events.emit('certificate:issued', { certificate: { ...certificate } });
    return { ...certificate };
  }

  revoke(domain: string): void {
    const certificate = this.certificates.get(domain.toLowerCase());
    if (!certificate) return;
    this.certificates.delete(certificate.domain);
    this.events.emit('certificate:revoked', { certificateId: certificate.id });
  }

  get(domain: string): VirtualCertificate | undefined {
    const cert = this.certificates.get(domain.toLowerCase());
    return cert && { ...cert };
  }

  /** A domain with no certificate, or an exact-name mismatch, is 'invalid' - exactly like a real
   * browser rejecting a cert that wasn't issued for the host being visited. */
  getStatus(domain: string): CertificateStatus {
    const cert = this.certificates.get(domain.toLowerCase());
    if (!cert) return 'invalid';
    return cert.validTo <= this.now() ? 'expired' : 'valid';
  }

  list(): VirtualCertificate[] {
    return [...this.certificates.values()].map((c) => ({ ...c }));
  }

  serialize(): VirtualCertificate[] {
    return this.list();
  }

  restore(certificates: readonly VirtualCertificate[]): void {
    this.certificates = new Map(certificates.map((c) => [c.domain, { ...c }]));
  }
}
