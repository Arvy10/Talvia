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
    case "CREATE_AUTOMATION":
      return { ...state, automations: [...state.automations, action.automation] };
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
