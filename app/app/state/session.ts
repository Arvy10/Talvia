import { saveSandboxState } from "./storage";
import type { SandboxState } from "./types";

export function activateSandboxSession(
  existingState: SandboxState,
  userId: string | null = null,
): SandboxState {
  const activeState = { ...existingState, sessionActive: true };
  saveSandboxState(activeState, userId);
  return activeState;
}
