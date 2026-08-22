import { createInitialSandboxState } from "./reducer";
import type { ConnectionStatus, SandboxEntity, SandboxState } from "./types";

export const STORAGE_KEY = "talvia:sandbox:v1";

let storageAvailable = true;

type PersistedSandboxState = Omit<SandboxState, "storageAvailable">;

const connectionStatuses: ConnectionStatus[] = [
  "disconnected",
  "connecting",
  "syncing",
  "connected",
  "error",
];

function isEntity(value: unknown): value is SandboxEntity {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { id?: unknown }).id === "string"
  );
}

function isConnectionStatus(value: unknown): value is ConnectionStatus {
  return (
    typeof value === "string" &&
    connectionStatuses.includes(value as ConnectionStatus)
  );
}

function isPersistedSandboxState(value: unknown): value is PersistedSandboxState {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const state = value as Partial<SandboxState>;
  const connections = state.connections;

  return (
    state.schemaVersion === 1 &&
    typeof state.sessionActive === "boolean" &&
    typeof connections === "object" &&
    connections !== null &&
    isConnectionStatus(connections.linkedin?.status) &&
    isConnectionStatus(connections.whatsapp?.status) &&
    isConnectionStatus(connections.gmail?.status) &&
    Array.isArray(state.contacts) &&
    state.contacts.every(isEntity) &&
    Array.isArray(state.opportunities) &&
    state.opportunities.every(isEntity) &&
    Array.isArray(state.automations) &&
    state.automations.every(isEntity) &&
    (state.pipelineView === "pipeline" || state.pipelineView === "list")
  );
}

export function loadSandboxState(): SandboxState {
  if (typeof window === "undefined") {
    return createInitialSandboxState();
  }

  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    storageAvailable = true;
    if (saved === null) {
      return createInitialSandboxState();
    }

    const parsed: unknown = JSON.parse(saved);
    return isPersistedSandboxState(parsed)
      ? { ...parsed, storageAvailable }
      : createInitialSandboxState();
  } catch {
    storageAvailable = false;
    return createInitialSandboxState();
  }
}

export function saveSandboxState(state: SandboxState): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    const { storageAvailable: _storageAvailable, ...persistedState } = state;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(persistedState));
    storageAvailable = true;
  } catch {
    storageAvailable = false;
  }
}

export function isSandboxStorageAvailable(): boolean {
  return storageAvailable;
}
