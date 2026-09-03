"use client";

import { useEffect, useState } from "react";
import { LuChevronDown, LuUnplug } from "react-icons/lu";
import RefreshIcon from "../components/icons/RefreshIcon";
import { Dialog } from "../components/Dialog";
import { GlassCard, PageHeader, StatusBadge } from "../components/ui";
import type { ChannelId, ConnectionStatus } from "../state/types";
import { ChannelLogo } from "./ChannelLogo";

const channels: Array<{ id: ChannelId; name: string; description: string }> = [
  { id: "linkedin", name: "LinkedIn", description: "Préparez ce canal pour l’intégrer à votre suivi commercial dès sa disponibilité." },
  { id: "whatsapp", name: "WhatsApp", description: "Préparez ce canal pour conserver le contexte de vos conversations commerciales." },
  { id: "gmail", name: "Gmail", description: "Préparez ce canal pour réunir vos emails avec le reste de votre suivi prospect." },
];
const empty: Record<ChannelId, ConnectionStatus> = { linkedin: "disconnected", whatsapp: "disconnected", gmail: "disconnected" };
const apiChannel = (channel: ChannelId) => channel === "gmail" ? "email" : channel;
// Email imports its history through the same job runner as the other two
// (see backfillConnectionHistory) — manual-trigger only for now: a mailbox
// is typically far larger than a chat history, so the first import is a
// deliberate click rather than something that starts by itself on connect.
const syncableChannels = new Set<ChannelId>(["linkedin", "whatsapp", "gmail"]);

type SyncState = {
  status: "pending" | "running" | "completed" | "failed";
  chatsProcessed: number;
  messagesImported: number;
  chatsSkippedGroups: number;
  chatsFailed: number;
  error: string | null;
};

// Polls only while at least one channel actually has a sync in flight — a
// completed/failed/absent state needs no polling at all.
const SYNC_POLL_MS = 6000;

function syncLabel(channel: ChannelId, sync: SyncState | null | undefined): string | null {
  if (!sync) return null;
  const name = channels.find((entry) => entry.id === channel)?.name ?? channel;
  if (sync.status === "pending") return `Synchronisation de vos conversations ${name} en attente…`;
  if (sync.status === "running") {
    const parts = [`${sync.chatsProcessed} conversation${sync.chatsProcessed === 1 ? "" : "s"} analysée${sync.chatsProcessed === 1 ? "" : "s"}`, `${sync.messagesImported} message${sync.messagesImported === 1 ? "" : "s"} synchronisé${sync.messagesImported === 1 ? "" : "s"}`];
    if (sync.chatsSkippedGroups) parts.push(`${sync.chatsSkippedGroups} groupe${sync.chatsSkippedGroups === 1 ? "" : "s"} ignoré${sync.chatsSkippedGroups === 1 ? "" : "s"}`);
    return `Synchronisation de vos conversations ${name}… ${parts.join(" · ")}`;
  }
  if (sync.status === "completed") {
    const parts = [`${sync.chatsProcessed} conversation${sync.chatsProcessed === 1 ? "" : "s"}`, `${sync.messagesImported} message${sync.messagesImported === 1 ? "" : "s"} importés`];
    if (sync.chatsSkippedGroups) parts.push(`${sync.chatsSkippedGroups} groupe${sync.chatsSkippedGroups === 1 ? "" : "s"} ignoré${sync.chatsSkippedGroups === 1 ? "" : "s"}`);
    if (sync.chatsFailed) parts.push(`${sync.chatsFailed} échec${sync.chatsFailed === 1 ? "" : "s"}`);
    return `Synchronisation terminée — ${parts.join(" · ")}.`;
  }
  // The real technical detail already lives in connections.metadata.sync.error
  // (sanitized server-side — see sanitizeSyncError in unipile-adapter.ts,
  // which strips anything request-specific but keeps the HTTP status, SQL
  // error text, timeout wording, or constraint name). Surface it here
  // instead of a bare, undiagnosable "failed" — this is the whole point of
  // exposing `sync` from GET /api/connections in the first place.
  return `Synchronisation échouée : ${sync.error ?? "erreur inconnue."}`;
}

export function ConnectionsClient() {
  const [statuses, setStatuses] = useState<Record<ChannelId, ConnectionStatus>>(empty);
  const [disconnectingChannel, setDisconnectingChannel] = useState<ChannelId | null>(null);
  const [syncingChannel, setSyncingChannel] = useState<ChannelId | null>(null);
  const [syncStates, setSyncStates] = useState<Partial<Record<ChannelId, SyncState | null>>>({});
  const save = async (channel: ChannelId, status: ConnectionStatus) => {
    setStatuses((current) => ({ ...current, [channel]: status }));
    const response = await fetch("/api/connections", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ channel: apiChannel(channel), status }) });
    if (!response.ok) setStatuses((current) => ({ ...current, [channel]: "error" }));
  };
  // Real connection: redirects to Unipile's hosted auth wizard. The status
  // only becomes "connected" once the notify_url webhook confirms it — this
  // just kicks the flow off.
  const connect = async (channel: ChannelId) => {
    setStatuses((current) => ({ ...current, [channel]: "connecting" }));
    const response = await fetch(`/api/connections/${channel}/connect`, { method: "POST" });
    const data = await response.json().catch(() => null) as { url?: string } | null;
    if (!response.ok || !data?.url) {
      setStatuses((current) => ({ ...current, [channel]: "error" }));
      return;
    }
    window.location.href = data.url;
  };
  // Fast, non-blocking trigger — POST returns the current job state
  // immediately (pending, or the still-fresh running/completed/failed state
  // if a sync was already going), it never runs the backfill inline. Actual
  // progress arrives through the polling effect below, driven by whatever
  // external cron is hitting POST /api/connections/sync/run.
  const syncHistory = async (channel: ChannelId) => {
    setSyncingChannel(channel);
    const response = await fetch(`/api/connections/${channel}/sync`, { method: "POST" });
    const data = await response.json().catch(() => null) as SyncState | { error: string } | null;
    setSyncingChannel(null);
    if (!response.ok || !data || "error" in data) {
      setSyncStates((current) => ({ ...current, [channel]: { status: "failed", chatsProcessed: 0, messagesImported: 0, chatsSkippedGroups: 0, chatsFailed: 0, error: data && "error" in data ? data.error : "la requête a échoué." } }));
      return;
    }
    setSyncStates((current) => ({ ...current, [channel]: data }));
  };
  const refreshConnections = () => fetch("/api/connections").then(async (response) => response.ok ? response.json() : null).then((data) => {
    if (!data) return;
    type ConnectionRow = { channel_type: "linkedin" | "whatsapp" | "email"; status: ConnectionStatus; sync: SyncState | null };
    setStatuses((current) => ({ ...current, ...Object.fromEntries(data.connections.map((item: ConnectionRow) => [item.channel_type === "email" ? "gmail" : item.channel_type, item.status])) }));
    setSyncStates((current) => ({ ...current, ...Object.fromEntries(data.connections.map((item: ConnectionRow) => [item.channel_type === "email" ? "gmail" : item.channel_type, item.sync])) }));
  });
  useEffect(() => { void refreshConnections(); }, []);
  // One stable interval for the component's lifetime rather than
  // resubscribing on every state change — it only actually fetches while a
  // sync is genuinely pending/running, so an idle Connections page never
  // polls at all in practice.
  useEffect(() => {
    const timer = setInterval(() => {
      setSyncStates((current) => {
        if (Object.values(current).some((sync) => sync?.status === "pending" || sync?.status === "running")) void refreshConnections();
        return current;
      });
    }, SYNC_POLL_MS);
    return () => clearInterval(timer);
  }, []);
  return <><PageHeader eyebrow="Configuration" title="Connexions" description="Reliez vos canaux à Talvia pour centraliser les conversations commerciales sans perdre leur contexte." />
    <section aria-label="Canaux disponibles" className="connections-grid">{channels.map(({ id, name, description }) => { const status=statuses[id]; const progress=status==="connecting"||status==="syncing"; const sync=syncStates[id]; const syncBusy=syncingChannel===id||sync?.status==="pending"||sync?.status==="running"; const syncLabelText=syncingChannel===id?"Synchronisation…":sync?.status==="pending"||sync?.status==="running"?"Synchronisation…":sync?.status==="failed"?"Réessayer":sync?.status==="completed"?"Resynchroniser":"Synchroniser l’historique"; return <GlassCard className="connection-card" key={id}><div className="connection-card__heading"><ChannelLogo channel={id}/><div><h2>{name}</h2><StatusBadge status={status}/></div></div><p>{description}</p><div className="connection-card__actions">{status==="connected"?<><button className="connection-button connection-button--secondary" onClick={()=>setDisconnectingChannel(id)} type="button"><LuUnplug/>Déconnecter</button>{syncableChannels.has(id)?<button className="connection-button connection-button--secondary" disabled={syncBusy} onClick={()=>void syncHistory(id)} type="button">{syncLabelText}</button>:null}</>:<button className="connection-button" disabled={progress} onClick={()=>void connect(id)} type="button">{status==="error"?<RefreshIcon aria-hidden="true" size={14} />:null}{progress?"Connexion en cours…":"Connecter"}</button>}</div>{sync?<p className={`connection-card__sync-result${sync.status==="failed"?" connection-card__sync-result--error":""}${sync.status==="pending"||sync.status==="running"?" connection-card__sync-result--pending":""}`}>{syncLabel(id,sync)}</p>:null}</GlassCard>; })}</section>
    <details className="connection-tester"><summary><LuChevronDown/>Tester les états</summary><div className="connection-tester__content"><p>États locaux persistés dans votre workspace Talvia ; aucun canal externe n’est encore relié.</p><div className="connection-tester__controls">{channels.map(({id,name})=><label key={id}><span>{name}</span><select aria-label={`État ${name}`} onChange={(event)=>void save(id,event.target.value as ConnectionStatus)} value={statuses[id]}><option value="disconnected">Non connecté</option><option value="connecting">Connexion…</option><option value="syncing">Synchronisation…</option><option value="connected">Connecté</option><option value="error">Erreur</option></select></label>)}</div><button className="connection-button connection-button--quiet" onClick={()=>channels.forEach(({id})=>void save(id,"disconnected"))} type="button">Tout réinitialiser</button></div></details>
    <Dialog description="Les nouvelles conversations de ce canal ne seront plus synchronisées dans Talvia." onClose={()=>setDisconnectingChannel(null)} open={disconnectingChannel!==null} title={`Déconnecter ${disconnectingChannel?channels.find(({id})=>id===disconnectingChannel)?.name:"ce canal"} ?`}><div className="connection-dialog__actions"><button className="connection-button connection-button--secondary" onClick={()=>setDisconnectingChannel(null)} type="button">Annuler</button><button className="connection-button connection-button--danger" onClick={()=>{if(disconnectingChannel)void save(disconnectingChannel,"disconnected");setDisconnectingChannel(null);}} type="button">Déconnecter</button></div></Dialog>
  </>;
}
