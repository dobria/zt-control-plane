import { memberPayload, networkPayload } from "@/lib/payloads";
import { memberId, networkId } from "@/lib/validation";
import type { ManagedNetwork, NetworkMember } from "@/lib/types";

export function backupNetworkConfiguration(network: ManagedNetwork) {
  return {
    id: networkId(network.id),
    ...networkPayload(network),
  };
}

export function backupMemberConfiguration(member: NetworkMember) {
  return {
    id: memberId(member.id),
    ...memberPayload(member),
  };
}
