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

export function ConnectionsClient() {
  const [statuses, setStatuses] = useState<Record<ChannelId, ConnectionStatus>>(empty);
  const [disconnectingChannel, setDisconnectingChannel] = useState<ChannelId | null>(null);
  const [syncingChannel, setSyncingChannel] = useState<ChannelId | null>(null);
  const [syncResult, setSyncResult] = useState<Partial<Record<ChannelId, string>>>({});
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
  const syncHistory = async (channel: ChannelId) => {
    setSyncingChannel(channel);
    setSyncResult((current) => ({ ...current, [channel]: undefined }));
    const response = await fetch(`/api/connections/${channel}/sync`, { method: "POST" });
    const data = await response.json().catch(() => null) as { chatsProcessed?: number; messagesInserted?: number; chatsFailed?: number; error?: string } | null;
    setSyncingChannel(null);
    setSyncResult((current) => ({
      ...current,
      [channel]: !response.ok || !data
        ? (data?.error ?? "Échec de la synchronisation.")
        : `${data.chatsProcessed} conversation(s), ${data.messagesInserted} message(s) importés.${data.chatsFailed ? ` ${data.chatsFailed} conversation(s) ignorée(s) après échec — relancez la synchronisation pour réessayer.` : ""}`,
    }));
  };
  useEffect(() => { void fetch("/api/connections").then(async (response) => response.ok ? response.json() : null).then((data) => { if (!data) return; setStatuses((current) => ({ ...current, ...Object.fromEntries(data.connections.map((item: { channel_type: "linkedin" | "whatsapp" | "email"; status: ConnectionStatus }) => [item.channel_type === "email" ? "gmail" : item.channel_type, item.status])) })); }); }, []);
  return <><PageHeader eyebrow="Configuration" title="Connexions" description="Reliez vos canaux à Talvia pour centraliser les conversations commerciales sans perdre leur contexte." />
    <section aria-label="Canaux disponibles" className="connections-grid">{channels.map(({ id, name, description }) => { const status=statuses[id]; const progress=status==="connecting"||status==="syncing"; return <GlassCard className="connection-card" key={id}><div className="connection-card__heading"><ChannelLogo channel={id}/><div><h2>{name}</h2><StatusBadge status={status}/></div></div><p>{description}</p><div className="connection-card__actions">{status==="connected"?<><button className="connection-button connection-button--secondary" onClick={()=>setDisconnectingChannel(id)} type="button"><LuUnplug/>Déconnecter</button>{id==="linkedin"?<button className="connection-button connection-button--secondary" disabled={syncingChannel===id} onClick={()=>void syncHistory(id)} type="button">{syncingChannel===id?"Synchronisation…":"Synchroniser l’historique"}</button>:null}</>:<button className="connection-button" disabled={progress} onClick={()=>void connect(id)} type="button">{status==="error"?<RefreshIcon aria-hidden="true" size={14} />:null}{progress?"Connexion en cours…":"Connecter"}</button>}</div>{syncResult[id]?<p className="connection-card__sync-result">{syncResult[id]}</p>:null}</GlassCard>; })}</section>
    <details className="connection-tester"><summary><LuChevronDown/>Tester les états</summary><div className="connection-tester__content"><p>États locaux persistés dans votre workspace Talvia ; aucun canal externe n’est encore relié.</p><div className="connection-tester__controls">{channels.map(({id,name})=><label key={id}><span>{name}</span><select aria-label={`État ${name}`} onChange={(event)=>void save(id,event.target.value as ConnectionStatus)} value={statuses[id]}><option value="disconnected">Non connecté</option><option value="connecting">Connexion…</option><option value="syncing">Synchronisation…</option><option value="connected">Connecté</option><option value="error">Erreur</option></select></label>)}</div><button className="connection-button connection-button--quiet" onClick={()=>channels.forEach(({id})=>void save(id,"disconnected"))} type="button">Tout réinitialiser</button></div></details>
    <Dialog description="Les nouvelles conversations de ce canal ne seront plus synchronisées dans Talvia." onClose={()=>setDisconnectingChannel(null)} open={disconnectingChannel!==null} title={`Déconnecter ${disconnectingChannel?channels.find(({id})=>id===disconnectingChannel)?.name:"ce canal"} ?`}><div className="connection-dialog__actions"><button className="connection-button connection-button--secondary" onClick={()=>setDisconnectingChannel(null)} type="button">Annuler</button><button className="connection-button connection-button--danger" onClick={()=>{if(disconnectingChannel)void save(disconnectingChannel,"disconnected");setDisconnectingChannel(null);}} type="button">Déconnecter</button></div></Dialog>
  </>;
}
