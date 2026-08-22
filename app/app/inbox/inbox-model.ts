import type { ChannelId, ConnectionStatus, SandboxConnection, SandboxState } from "../state/types";

export type InboxAvailability = "disconnected" | "syncing" | "connected-empty" | "error";

export const channelMap: Array<{ id: ChannelId; label: string }> = [
  { id: "linkedin", label: "LinkedIn" },
  { id: "whatsapp", label: "WhatsApp" },
  { id: "gmail", label: "Gmail" },
];

function getAvailability(status: ConnectionStatus): InboxAvailability {
  if (status === "connected") {
    return "connected-empty";
  }

  if (status === "error") {
    return "error";
  }

  if (status === "connecting" || status === "syncing") {
    return "syncing";
  }

  return "disconnected";
}

export function getConnectedChannelCount(state: SandboxState): number {
  return channelMap.filter(({ id }) => state.connections[id].status === "connected").length;
}

export function getInboxAvailability(connections: Record<ChannelId, SandboxConnection>): Record<ChannelId, InboxAvailability> {
  return channelMap.reduce<Record<ChannelId, InboxAvailability>>((availability, { id }) => {
    availability[id] = getAvailability(connections[id].status);
    return availability;
  }, {} as Record<ChannelId, InboxAvailability>);
}
