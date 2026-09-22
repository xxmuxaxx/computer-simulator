import { uid } from '../../utils/id';
import type { FirewallDirection, FirewallRule, FirewallState, Packet } from './types';

/** First matching rule wins (in list order); no match means allow. */
export function evaluateFirewall(firewall: FirewallState, packet: Packet, direction: FirewallDirection): { allow: boolean; rule?: FirewallRule } {
  if (!firewall.enabled) return { allow: true };
  for (const rule of firewall.rules) {
    if (rule.direction !== direction) continue;
    if (rule.protocol !== 'ANY' && rule.protocol !== packet.protocol) continue;
    if (rule.port !== undefined && rule.port !== packet.destinationPort) continue;
    if (rule.sourceIp !== undefined && rule.sourceIp !== packet.sourceIp) continue;
    return { allow: rule.action === 'allow', rule };
  }
  return { allow: true };
}

export function createFirewallRule(input: Omit<FirewallRule, 'id'>): FirewallRule {
  return { id: uid('fw'), ...input };
}
