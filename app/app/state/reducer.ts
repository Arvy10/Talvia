import type { SandboxAction, SandboxState } from "./types";

export function createInitialSandboxState(): SandboxState {
  return {
    schemaVersion: 1,
    sessionActive: false,
    storageAvailable: true,
    connections: {
      linkedin: { status: "disconnected" },
      whatsapp: { status: "disconnected" },
      gmail: { status: "disconnected" },
    },
    contacts: [],
    opportunities: [],
    automations: [],
    pipelineView: "pipeline",
  };
}

export const initialSandboxState = createInitialSandboxState();

export function sandboxReducer(
  state: SandboxState,
  action: SandboxAction,
): SandboxState {
  switch (action.type) {
    case "ACTIVATE_SANDBOX_SESSION":
      return state.sessionActive ? state : { ...state, sessionActive: true };
    case "SET_CONNECTION_STATUS":
      return {
        ...state,
        connections: {
          ...state.connections,
          [action.channel]: { status: action.status },
        },
      };
    case "CREATE_CONTACT":
      return { ...state, contacts: [...state.contacts, action.contact] };
    case "CREATE_OPPORTUNITY":
      return {
        ...state,
        opportunities: [...state.opportunities, action.opportunity],
      };
    case "UPDATE_OPPORTUNITY":
      return { ...state, opportunities: state.opportunities.map((item) => item.id === action.opportunity.id ? action.opportunity : item) };
    case "CREATE_AUTOMATION":
      return { ...state, automations: [...state.automations, action.automation] };
    case "CREATE_MESSAGE":
      return { ...state, messages: [...(state.messages ?? []), action.message] };
    case "CREATE_CONVERSATION":
      return { ...state, conversations: (state.conversations ?? []).some((item) => item.contactId === action.conversation.contactId && item.channel === action.conversation.channel) ? state.conversations : [...(state.conversations ?? []), action.conversation] };
    case "CREATE_CAMPAIGN":
      return { ...state, campaigns: [...(state.campaigns ?? []), action.campaign] };
    case "UPDATE_CAMPAIGN":
      return { ...state, campaigns: (state.campaigns ?? []).map((item) => item.id === action.campaign.id ? action.campaign : item) };
    case "DELETE_CAMPAIGN":
      return { ...state, campaigns: (state.campaigns ?? []).filter((item) => item.id !== action.id) };
    case "ADD_ACTIVITY":
      return { ...state, activities: [...(state.activities ?? []), action.activity] };
    case "UPDATE_OPPORTUNITY_STAGE":
      return {
        ...state,
        opportunities: state.opportunities.map((item) =>
          item.id === action.id ? { ...item, stage: action.stage } : item,
        ),
      };
    case "UPDATE_CONTACT":
      return { ...state, contacts: state.contacts.map((item) => item.id === action.contact.id ? action.contact : item) };
    case "DELETE_CONTACT":
      return { ...state, contacts: state.contacts.filter((item) => item.id !== action.id) };
    case "UPDATE_PROFILE":
      return { ...state, profile: action.profile };
    case "SET_PIPELINE_VIEW":
      return { ...state, pipelineView: action.view };
    case "RESTORE_SANDBOX_STATE":
      return action.state;
    case "SET_STORAGE_AVAILABILITY":
      return { ...state, storageAvailable: action.available };
    case "RESET_SANDBOX":
      return createInitialSandboxState();
  }
}
