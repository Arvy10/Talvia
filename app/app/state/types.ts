export type ChannelId = "linkedin" | "whatsapp" | "gmail";

export type ConnectionStatus =
  | "disconnected"
  | "connecting"
  | "syncing"
  | "connected"
  | "error";

export type PipelineView = "pipeline" | "list";

export type SandboxEntity = {
  id: string;
  [key: string]: unknown;
};

export type SandboxConnection = {
  status: ConnectionStatus;
};

export type SandboxState = {
  schemaVersion: 1;
  sessionActive: boolean;
  storageAvailable: boolean;
  connections: Record<ChannelId, SandboxConnection>;
  contacts: SandboxEntity[];
  opportunities: SandboxEntity[];
  automations: SandboxEntity[];
  pipelineView: PipelineView;
};

export type SandboxAction =
  | {
      type: "SET_CONNECTION_STATUS";
      channel: ChannelId;
      status: ConnectionStatus;
    }
  | { type: "CREATE_CONTACT"; contact: SandboxEntity }
  | { type: "CREATE_OPPORTUNITY"; opportunity: SandboxEntity }
  | { type: "CREATE_AUTOMATION"; automation: SandboxEntity }
  | { type: "SET_PIPELINE_VIEW"; view: PipelineView }
  | { type: "RESTORE_SANDBOX_STATE"; state: SandboxState }
  | { type: "SET_STORAGE_AVAILABILITY"; available: boolean }
  | { type: "RESET_SANDBOX" };
