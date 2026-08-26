"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type Dispatch,
  type ReactNode,
} from "react";

import { authClient } from "../../lib/auth-client";
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
  const [hydrated, markHydrated] = useReducer(() => true, false);
  const storageAvailableRef = useRef(state.storageAvailable);
  storageAvailableRef.current = state.storageAvailable;
  // Resolved once on mount and reused for every save — storage is scoped
  // per user so a second person signing into the same browser never
  // inherits the previous account's contacts, messages, or opportunities.
  const userIdRef = useRef<string | null>(null);
  const {
    schemaVersion,
    sessionActive,
    connections,
    contacts,
    opportunities,
    automations,
    pipelineView,
    messages,
    conversations,
    campaigns,
    activities,
    profile,
  } = state;
  const stateToPersist = useMemo<SandboxState>(
    () => ({
      schemaVersion,
      sessionActive,
      storageAvailable: true,
      connections,
      contacts,
      opportunities,
      automations,
      pipelineView,
      ...(messages ? { messages } : {}),
      ...(conversations ? { conversations } : {}),
      ...(campaigns ? { campaigns } : {}),
      ...(activities ? { activities } : {}),
      ...(profile ? { profile } : {}),
    }),
    [
      schemaVersion,
      sessionActive,
      connections,
      contacts,
      opportunities,
      automations,
      pipelineView,
      messages,
      conversations,
      campaigns,
      activities,
      profile,
    ],
  );

  useEffect(() => {
    let cancelled = false;
    const hydrate = (userId: string | null) => {
      if (cancelled) return;
      userIdRef.current = userId;

      const restoredState = loadSandboxState(userId);
      dispatch({
        type: "RESTORE_SANDBOX_STATE",
        state: {
          ...restoredState,
          storageAvailable: isSandboxStorageAvailable(),
        },
      });
      if (!restoredState.sessionActive) {
        dispatch({ type: "ACTIVATE_SANDBOX_SESSION" });
      }
      markHydrated();
    };
    // A rejected session check (network hiccup, blocked request…) must
    // still hydrate — falling back to the unscoped "anon" bucket — rather
    // than leaving the app stuck on "loading" forever.
    authClient.getSession().then(
      (session) => hydrate(session.data?.user?.id ?? null),
      () => hydrate(null),
    );
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!hydrated) {
      return;
    }

    saveSandboxState(stateToPersist, userIdRef.current);
    const available = isSandboxStorageAvailable();
    if (available !== storageAvailableRef.current) {
      dispatch({ type: "SET_STORAGE_AVAILABILITY", available });
    }
  }, [hydrated, stateToPersist]);

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
