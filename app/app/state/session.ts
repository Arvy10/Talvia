import { saveSandboxState } from "./storage";
import type { SandboxState } from "./types";

export function activateSandboxSession(
  existingState: SandboxState,
): SandboxState {
  const activeState = { ...existingState, sessionActive: true };
  saveSandboxState(activeState);
  return activeState;
}
