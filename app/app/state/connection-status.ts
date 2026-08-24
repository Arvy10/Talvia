import type {
  ChannelId,
  ConnectionStatus,
  SandboxConnection,
} from "./types";

export function normalizeTransientConnectionStatus(
  status: ConnectionStatus,
): ConnectionStatus {
  return status === "connecting" || status === "syncing"
    ? "disconnected"
    : status;
}

export function normalizeTransientConnections(
  connections: Record<ChannelId, SandboxConnection>,
): Record<ChannelId, SandboxConnection> {
  return {
    linkedin: {
      status: normalizeTransientConnectionStatus(connections.linkedin.status),
    },
    whatsapp: {
      status: normalizeTransientConnectionStatus(connections.whatsapp.status),
    },
    gmail: {
      status: normalizeTransientConnectionStatus(connections.gmail.status),
    },
  };
}
