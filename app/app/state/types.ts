export type ChannelId = "linkedin" | "whatsapp" | "gmail";

export type ConnectionStatus =
  | "disconnected"
  | "connecting"
  | "syncing"
  | "connected"
  | "error";

export type PipelineView = "pipeline" | "list";

export type OpportunityStage =
  | "new"
  | "qualified"
  | "proposal"
  | "negotiation"
  | "won";

export type Contact = {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  channel?: ChannelId;
  company?: string;
  role?: string;
  status?: "prospect" | "lead" | "client" | "other";
  notes?: string;
};

export type SandboxMessage = {
  id: string;
  contactId: string;
  channel: ChannelId;
  body: string;
  direction: "inbound" | "outbound";
  simulated: true;
  createdAt: string;
};

export type SandboxCampaign = {
  id: string;
  name: string;
  objective: string;
  contactIds: string[];
  channels: ChannelId[];
  status: "draft" | "active" | "paused" | "completed";
  sequence: string[];
};

export type SandboxActivity = {
  id: string;
  label: string;
  createdAt: string;
};

export type Opportunity = {
  id: string;
  title: string;
  stage: OpportunityStage;
  organization?: string;
};

export type Automation = {
  id: string;
  name: string;
  trigger: string;
  channel: ChannelId;
  action: string;
  enabled: boolean;
};

export type SandboxConnection = {
  status: ConnectionStatus;
};

export type SandboxState = {
  schemaVersion: 1;
  sessionActive: boolean;
  storageAvailable: boolean;
  connections: Record<ChannelId, SandboxConnection>;
  contacts: Contact[];
  opportunities: Opportunity[];
  automations: Automation[];
  pipelineView: PipelineView;
  messages?: SandboxMessage[];
  campaigns?: SandboxCampaign[];
  activities?: SandboxActivity[];
};

export type SandboxAction =
  | { type: "ACTIVATE_SANDBOX_SESSION" }
  | {
      type: "SET_CONNECTION_STATUS";
      channel: ChannelId;
      status: ConnectionStatus;
    }
  | { type: "CREATE_CONTACT"; contact: Contact }
  | { type: "CREATE_OPPORTUNITY"; opportunity: Opportunity }
  | { type: "CREATE_AUTOMATION"; automation: Automation }
  | { type: "CREATE_MESSAGE"; message: SandboxMessage }
  | { type: "CREATE_CAMPAIGN"; campaign: SandboxCampaign }
  | { type: "ADD_ACTIVITY"; activity: SandboxActivity }
  | { type: "UPDATE_OPPORTUNITY_STAGE"; id: string; stage: OpportunityStage }
  | { type: "UPDATE_CONTACT"; contact: Contact }
  | { type: "DELETE_CONTACT"; id: string }
  | { type: "SET_PIPELINE_VIEW"; view: PipelineView }
  | { type: "RESTORE_SANDBOX_STATE"; state: SandboxState }
  | { type: "SET_STORAGE_AVAILABILITY"; available: boolean }
  | { type: "RESET_SANDBOX" };
