"use client";

import { useEffect, useState } from "react";
import { LuChevronDown, LuRefreshCw, LuUnplug } from "react-icons/lu";
import { Dialog } from "../components/Dialog";
import { GlassCard, PageHeader, StatusBadge } from "../components/ui";
import type { ChannelId, ConnectionStatus } from "../state/types";
import { ChannelLogo } from "./ChannelLogo";

const channels: Array<{ id: ChannelId; name: string; description: string }> = [
  { id: "linkedin", name: "LinkedIn", description: "Centralisez les échanges professionnels qui font avancer vos opportunités." },
  { id: "whatsapp", name: "WhatsApp", description: "Gardez le contexte de vos conversations rapides dans votre espace commercial." },
  { id: "gmail", name: "Gmail", description: "Retrouvez vos emails commerciaux avec le reste de votre suivi prospect." },
];
const empty: Record<ChannelId, ConnectionStatus> = { linkedin: "disconnected", whatsapp: "disconnected", gmail: "disconnected" };
const apiChannel = (channel: ChannelId) => channel === "gmail" ? "email" : channel;

export function ConnectionsClient() {
  const [statuses, setStatuses] = useState<Record<ChannelId, ConnectionStatus>>(empty);
  const [disconnectingChannel, setDisconnectingChannel] = useState<ChannelId | null>(null);
  const save = async (channel: ChannelId, status: ConnectionStatus) => {
    setStatuses((current) => ({ ...current, [channel]: status }));
    const response = await fetch("/api/connections", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ channel: apiChannel(channel), status }) });
    if (!response.ok) setStatuses((current) => ({ ...current, [channel]: "error" }));
  };
  useEffect(() => { void fetch("/api/connections").then(async (response) => response.ok ? response.json() : null).then((data) => { if (!data) return; setStatuses((current) => ({ ...current, ...Object.fromEntries(data.connections.map((item: { channel_type: "linkedin" | "whatsapp" | "email"; status: ConnectionStatus }) => [item.channel_type === "email" ? "gmail" : item.channel_type, item.status])) })); }); }, []);
  return <><PageHeader eyebrow="Configuration" title="Connexions" description="Reliez vos canaux à Talvia pour centraliser les conversations commerciales sans perdre leur contexte." />
    <section aria-label="Canaux disponibles" className="connections-grid">{channels.map(({ id, name, description }) => { const status=statuses[id]; const progress=status==="connecting"||status==="syncing"; return <GlassCard className="connection-card" key={id}><div className="connection-card__heading"><ChannelLogo channel={id}/><div><h2>{name}</h2><StatusBadge status={status}/></div></div><p>{description}</p><div className="connection-card__actions">{status==="connected"?<button className="connection-button connection-button--secondary" onClick={()=>setDisconnectingChannel(id)} type="button"><LuUnplug/>Déconnecter</button>:<button className="connection-button" disabled={progress} onClick={()=>void save(id,"connected")} type="button">{status==="error"?<LuRefreshCw/>:null}{progress?"Connexion en cours…":"Connecter"}</button>}</div></GlassCard>; })}</section>
    <details className="connection-tester"><summary><LuChevronDown/>Tester les états</summary><div className="connection-tester__content"><p>États locaux persistés dans votre workspace Talvia ; aucun canal externe n’est encore relié.</p><div className="connection-tester__controls">{channels.map(({id,name})=><label key={id}><span>{name}</span><select aria-label={`État ${name}`} onChange={(event)=>void save(id,event.target.value as ConnectionStatus)} value={statuses[id]}><option value="disconnected">Non connecté</option><option value="connecting">Connexion…</option><option value="syncing">Synchronisation…</option><option value="connected">Connecté</option><option value="error">Erreur</option></select></label>)}</div><button className="connection-button connection-button--quiet" onClick={()=>channels.forEach(({id})=>void save(id,"disconnected"))} type="button">Tout réinitialiser</button></div></details>
    <Dialog description="Les nouvelles conversations de ce canal ne seront plus synchronisées dans Talvia." onClose={()=>setDisconnectingChannel(null)} open={disconnectingChannel!==null} title={`Déconnecter ${disconnectingChannel?channels.find(({id})=>id===disconnectingChannel)?.name:"ce canal"} ?`}><div className="connection-dialog__actions"><button className="connection-button connection-button--secondary" onClick={()=>setDisconnectingChannel(null)} type="button">Annuler</button><button className="connection-button connection-button--danger" onClick={()=>{if(disconnectingChannel)void save(disconnectingChannel,"disconnected");setDisconnectingChannel(null);}} type="button">Déconnecter</button></div></Dialog>
  </>;
}
