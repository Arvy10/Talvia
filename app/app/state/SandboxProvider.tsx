"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useState,
  type Dispatch,
  type ReactNode,
} from "react";

import { initialSandboxState, sandboxReducer } from "./reducer";
import {
  isSandboxStorageAvailable,
  loadSandboxState,
  saveSandboxState,
} from "./storage";
import type { SandboxAction, SandboxState } from "./types";

export type SandboxContextValue = {
  state: SandboxState;
  hydrated: boolean;
  dispatch: Dispatch<SandboxAction>;
};

const SandboxContext = createContext<SandboxContextValue | null>(null);

export function SandboxProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(sandboxReducer, initialSandboxState);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    dispatch({ type: "RESTORE_SANDBOX_STATE", state: loadSandboxState() });
    if (!isSandboxStorageAvailable()) {
      dispatch({ type: "SET_STORAGE_AVAILABILITY", available: false });
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) {
      return;
    }

    saveSandboxState(state);
    if (!isSandboxStorageAvailable() && state.storageAvailable) {
      dispatch({ type: "SET_STORAGE_AVAILABILITY", available: false });
    }
  }, [hydrated, state]);

  const value = useMemo(
    () => ({ state, hydrated, dispatch }),
    [state, hydrated],
  );

  return <SandboxContext.Provider value={value}>{children}</SandboxContext.Provider>;
}

export function useSandbox(): SandboxContextValue {
  const context = useContext(SandboxContext);
  if (context === null) {
    throw new Error("useSandbox must be used within a SandboxProvider");
  }

  return context;
}
