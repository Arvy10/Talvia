"use client";

import { useEffect, useRef, useState } from "react";
import { LuChevronDown, LuRefreshCw, LuUnplug } from "react-icons/lu";

import { Dialog } from "../components/Dialog";
import { GlassCard, PageHeader, StatusBadge } from "../components/ui";
import { useSandbox } from "../state/SandboxProvider";
import type { ChannelId, ConnectionStatus } from "../state/types";
import { ChannelLogo } from "./ChannelLogo";
import { getNextConnectionStatus, getRecoveredConnectionStatus } from "./connection-flow";

const channels: Array<{ id: ChannelId; name: string; description: string }> = [
  {
    id: "linkedin",
    name: "LinkedIn",
    description: "Centralisez les échanges professionnels qui font avancer vos opportunités.",
  },
  {
    id: "whatsapp",
    name: "WhatsApp",
    description: "Gardez le contexte de vos conversations rapides dans votre espace commercial.",
  },
  {
    id: "gmail",
    name: "Gmail",
    description: "Retrouvez vos emails commerciaux avec le reste de votre suivi prospect.",
  },
];

export function ConnectionsClient() {
  const { dispatch, hydrated, state } = useSandbox();
  const [disconnectingChannel, setDisconnectingChannel] = useState<ChannelId | null>(null);
  const timerIdsRef = useRef(new Map<ChannelId, ReturnType<typeof setTimeout>[]>());
  const connectionsRef = useRef(state.connections);
  connectionsRef.current = state.connections;

  const clearChannelTimers = (channel: ChannelId) => {
    timerIdsRef.current.get(channel)?.forEach(clearTimeout);
    timerIdsRef.current.delete(channel);
  };

  useEffect(() => () => {
    channels.forEach(({ id }) => {
      const status = connectionsRef.current[id].status;
      const recoveredStatus = getRecoveredConnectionStatus(status);
      if (recoveredStatus !== status) {
        dispatch({ type: "SET_CONNECTION_STATUS", channel: id, status: recoveredStatus });
      }
    });
    timerIdsRef.current.forEach((timerIds) => timerIds.forEach(clearTimeout));
    timerIdsRef.current.clear();
  }, [dispatch]);

  const setStatus = (channel: ChannelId, status: ConnectionStatus) => {
    clearChannelTimers(channel);
    dispatch({ type: "SET_CONNECTION_STATUS", channel, status });
  };

  const beginConnection = (channel: ChannelId) => {
    clearChannelTimers(channel);
    dispatch({ type: "SET_CONNECTION_STATUS", channel, status: getNextConnectionStatus("disconnected") });

    const syncingTimer = setTimeout(() => {
      dispatch({ type: "SET_CONNECTION_STATUS", channel, status: getNextConnectionStatus("connecting") });
    }, 800);
    const connectedTimer = setTimeout(() => {
      dispatch({ type: "SET_CONNECTION_STATUS", channel, status: getNextConnectionStatus("syncing") });
      timerIdsRef.current.delete(channel);
    }, 1800);

    timerIdsRef.current.set(channel, [syncingTimer, connectedTimer]);
  };

  const confirmDisconnect = () => {
    if (disconnectingChannel) {
      setStatus(disconnectingChannel, "disconnected");
    }
    setDisconnectingChannel(null);
  };

  const resetConnectionStates = () => {
    channels.forEach(({ id }) => setStatus(id, "disconnected"));
  };

  return <>
    <PageHeader
      eyebrow="Configuration"
      title="Connexions"
      description="Reliez vos canaux à Talvia pour centraliser les conversations commerciales sans perdre leur contexte."
    />

    <section aria-label="Canaux disponibles" className="connections-grid">
      {channels.map(({ id, name, description }) => {
        const status = state.connections[id].status;
        const isInProgress = status === "connecting" || status === "syncing";
        const actionLabel = status === "error" ? "Réessayer" : "Connecter";

        return <GlassCard className="connection-card" key={id}>
          <div className="connection-card__heading">
            <ChannelLogo channel={id} />
            <div>
              <h2>{name}</h2>
              <StatusBadge status={status} />
            </div>
          </div>
          <p>{description}</p>
          <div className="connection-card__actions">
            {status === "connected" ? <button className="connection-button connection-button--secondary" onClick={() => setDisconnectingChannel(id)} type="button"><LuUnplug aria-hidden="true" />Déconnecter</button> : <button className="connection-button" disabled={isInProgress} onClick={() => beginConnection(id)} type="button">{status === "error" ? <LuRefreshCw aria-hidden="true" /> : null}{isInProgress ? "Connexion en cours…" : actionLabel}</button>}
          </div>
        </GlassCard>;
      })}
    </section>

    <details className="connection-tester">
      <summary><LuChevronDown aria-hidden="true" />Tester les états</summary>
      <div className="connection-tester__content">
        <p>Simulez localement l’état de chaque canal. Ces réglages restent dans le bac à sable.</p>
        <div className="connection-tester__controls">
          {channels.map(({ id, name }) => <label key={id}>
            <span>{name}</span>
            <select aria-label={`État ${name}`} onChange={(event) => setStatus(id, event.target.value as ConnectionStatus)} value={state.connections[id].status}>
              <option value="disconnected">Non connecté</option>
              <option value="connecting">Connexion…</option>
              <option value="syncing">Synchronisation…</option>
              <option value="connected">Connecté</option>
              <option value="error">Erreur</option>
            </select>
          </label>)}
        </div>
        <button className="connection-button connection-button--quiet" onClick={resetConnectionStates} type="button">Tout réinitialiser</button>
      </div>
    </details>

    <Dialog
      description="Les nouvelles conversations de ce canal ne seront plus synchronisées dans Talvia."
      onClose={() => setDisconnectingChannel(null)}
      open={disconnectingChannel !== null}
      title={`Déconnecter ${disconnectingChannel ? channels.find(({ id }) => id === disconnectingChannel)?.name : "ce canal"} ?`}
    >
      <div className="connection-dialog__actions">
        <button className="connection-button connection-button--secondary" onClick={() => setDisconnectingChannel(null)} type="button">Annuler</button>
        <button className="connection-button connection-button--danger" onClick={confirmDisconnect} type="button">Déconnecter</button>
      </div>
    </Dialog>
  </>;
}
