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
  | "won"
  | "lost";

export type OpportunityCurrency = "USD" | "EUR" | "XAF";

export type Contact = {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  channel?: ChannelId;
  linkedinUrl?: string;
  company?: string;
  role?: string;
  website?: string;
  status?: "new" | "follow_up" | "qualified" | "client" | "inactive" | "prospect" | "lead" | "other";
  notes?: string;
  notesUpdatedAt?: string;
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

export type SandboxConversation = {
  id: string;
  contactId: string;
  channel: ChannelId;
  createdAt: string;
  unread?: boolean;
};

export type SandboxCampaign = {
  id: string;
  name: string;
  objective: string;
  contactIds: string[];
  channels: ChannelId[];
  status: "draft" | "active" | "paused" | "completed";
  sequence: string[];
  channel?: ChannelId;
  initialMessage?: string;
  followUpMessage?: string;
  waitDays?: number;
  stopOnReply?: boolean;
  participantStatuses?: Record<string, "waiting" | "active" | "replied" | "completed" | "stopped">;
};

export type SandboxActivity = {
  id: string;
  label: string;
  createdAt: string;
  opportunityId?: string;
  contactId?: string;
  kind?: "created" | "stage_changed" | "note_added" | "action_completed" | "message" | "closed";
};

export type SandboxProfile = {
  firstName: string;
  lastName: string;
  email: string;
  company?: string;
  role?: string;
  language: string;
  timezone: string;
};

export type Opportunity = {
  id: string;
  title: string;
  stage: OpportunityStage;
  organization?: string;
  contactId?: string;
  sourceChannel?: ChannelId;
  conversationId?: string;
  campaignId?: string;
  value?: number;
  currency?: OpportunityCurrency;
  nextAction?: string;
  nextActionAt?: string;
  nextActionCompletedAt?: string;
  notes?: string;
  createdAt?: string;
  updatedAt?: string;
  closedAt?: string;
  finalValue?: number;
  lostReason?: "price" | "no_need" | "not_now" | "competitor" | "no_response" | "other";
};

export type Automation = {
  id: string;
  name: string;
  trigger: string;
  channel: ChannelId;
  action: string;
  enabled: boolean;
  event?: "message_received" | "campaign_reply" | "opportunity_proposal" | "opportunity_created" | "contact_added";
  condition?: string;
  replyMode?: "draft" | "auto";
  autoReplyConfirmed?: boolean;
  delayMinutes?: number;
  lastRunAt?: string;
  lastResult?: "success" | "skipped" | "failed";
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
  conversations?: SandboxConversation[];
  campaigns?: SandboxCampaign[];
  activities?: SandboxActivity[];
  profile?: SandboxProfile;
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
  | { type: "UPDATE_OPPORTUNITY"; opportunity: Opportunity }
  | { type: "CREATE_AUTOMATION"; automation: Automation }
  | { type: "UPDATE_AUTOMATION"; automation: Automation }
  | { type: "DELETE_AUTOMATION"; id: string }
  | { type: "CREATE_MESSAGE"; message: SandboxMessage }
  | { type: "CREATE_CONVERSATION"; conversation: SandboxConversation }
  | { type: "CREATE_CAMPAIGN"; campaign: SandboxCampaign }
  | { type: "UPDATE_CAMPAIGN"; campaign: SandboxCampaign }
  | { type: "DELETE_CAMPAIGN"; id: string }
  | { type: "ADD_ACTIVITY"; activity: SandboxActivity }
  | { type: "UPDATE_OPPORTUNITY_STAGE"; id: string; stage: OpportunityStage }
  | { type: "UPDATE_CONTACT"; contact: Contact }
  | { type: "DELETE_CONTACT"; id: string }
  | { type: "UPDATE_PROFILE"; profile: SandboxProfile }
  | { type: "SET_PIPELINE_VIEW"; view: PipelineView }
  | { type: "RESTORE_SANDBOX_STATE"; state: SandboxState }
  | { type: "SET_STORAGE_AVAILABILITY"; available: boolean }
  | { type: "RESET_SANDBOX" };
