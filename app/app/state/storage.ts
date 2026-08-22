import { createInitialSandboxState } from "./reducer";
import { normalizeTransientConnections } from "./connection-status";
import type {
  Automation,
  ChannelId,
  ConnectionStatus,
  Contact,
  Opportunity,
  OpportunityStage,
  SandboxState,
  SandboxMessage,
} from "./types";

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyFields(
  value: Record<string, unknown>,
  fields: readonly string[],
): boolean {
  return Object.keys(value).every((field) => fields.includes(field));
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === "string";
}

function isChannelId(value: unknown): value is ChannelId {
  return value === "linkedin" || value === "whatsapp" || value === "gmail";
}

function isOptionalChannelId(value: unknown): value is ChannelId | undefined {
  return value === undefined || isChannelId(value);
}

function isOpportunityStage(value: unknown): value is OpportunityStage {
  return (
    value === "new" ||
    value === "qualified" ||
    value === "proposal" ||
    value === "negotiation" ||
    value === "won"
  );
}

function isContact(value: unknown): value is Contact {
  return (
    isRecord(value) &&
    hasOnlyFields(value, ["id", "name", "email", "phone", "channel", "company", "role", "status", "notes"]) &&
    isNonEmptyString(value.id) &&
    isNonEmptyString(value.name) &&
    isOptionalString(value.email) &&
    isOptionalString(value.phone) &&
    isOptionalChannelId(value.channel) &&
    isOptionalString(value.company) && isOptionalString(value.role) &&
    (value.status === undefined || ["prospect", "lead", "client", "other"].includes(value.status as string)) &&
    isOptionalString(value.notes)
  );
}

function isOpportunity(value: unknown): value is Opportunity {
  return (
    isRecord(value) &&
    hasOnlyFields(value, ["id", "title", "stage", "organization"]) &&
    isNonEmptyString(value.id) &&
    isNonEmptyString(value.title) &&
    isOpportunityStage(value.stage) &&
    isOptionalString(value.organization)
  );
}

function isAutomation(value: unknown): value is Automation {
  return (
    isRecord(value) &&
    hasOnlyFields(value, [
      "id",
      "name",
      "trigger",
      "channel",
      "action",
      "enabled",
    ]) &&
    isNonEmptyString(value.id) &&
    isNonEmptyString(value.name) &&
    typeof value.trigger === "string" &&
    isChannelId(value.channel) &&
    typeof value.action === "string" &&
    typeof value.enabled === "boolean"
  );
}

function isSandboxMessage(value: unknown): value is SandboxMessage {
  return isRecord(value) && hasOnlyFields(value, ["id", "contactId", "channel", "body", "direction", "simulated", "createdAt"]) &&
    isNonEmptyString(value.id) && isNonEmptyString(value.contactId) && isChannelId(value.channel) &&
    isNonEmptyString(value.body) && (value.direction === "inbound" || value.direction === "outbound") &&
    value.simulated === true && isNonEmptyString(value.createdAt);
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
    state.contacts.every(isContact) &&
    Array.isArray(state.opportunities) &&
    state.opportunities.every(isOpportunity) &&
    Array.isArray(state.automations) &&
    state.automations.every(isAutomation) &&
    (state.pipelineView === "pipeline" || state.pipelineView === "list") &&
    (state.messages === undefined || (Array.isArray(state.messages) && state.messages.every(isSandboxMessage))) &&
    (state.campaigns === undefined || Array.isArray(state.campaigns)) &&
    (state.activities === undefined || Array.isArray(state.activities))
    && (state.profile === undefined || isRecord(state.profile))
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
      ? {
          ...parsed,
          connections: normalizeTransientConnections(parsed.connections),
          storageAvailable,
        }
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
    const persistedState: PersistedSandboxState = {
      schemaVersion: state.schemaVersion,
      sessionActive: state.sessionActive,
      connections: normalizeTransientConnections(state.connections),
      contacts: state.contacts,
      opportunities: state.opportunities,
      automations: state.automations,
      pipelineView: state.pipelineView,
      ...(state.messages ? { messages: state.messages } : {}),
      ...(state.campaigns ? { campaigns: state.campaigns } : {}),
      ...(state.activities ? { activities: state.activities } : {}),
      ...(state.profile ? { profile: state.profile } : {}),
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(persistedState));
    storageAvailable = true;
  } catch {
    storageAvailable = false;
  }
}

export function isSandboxStorageAvailable(): boolean {
  return storageAvailable;
}
