import type { ConnectionStatus } from "../state/types";

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
