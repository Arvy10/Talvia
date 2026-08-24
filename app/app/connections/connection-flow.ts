import type { ConnectionStatus } from "../state/types";
import { normalizeTransientConnectionStatus } from "../state/connection-status";

const nextStatus: Record<ConnectionStatus, ConnectionStatus> = {
  disconnected: "connecting",
  connecting: "syncing",
  syncing: "connected",
  connected: "connected",
  error: "connecting",
};

export function getNextConnectionStatus(status: ConnectionStatus): ConnectionStatus {
  return nextStatus[status];
}

export function getRecoveredConnectionStatus(status: ConnectionStatus): ConnectionStatus {
  return normalizeTransientConnectionStatus(status);
}
