"use client";

import { useEffect, useMemo, useState } from "react";
import { LuArrowLeft, LuArrowRight, LuCheck, LuCopy, LuPlus, LuSearch, LuSend, LuTrash2, LuUserPlus } from "react-icons/lu";
import { Pause, Play } from "@animateicons/react/lucide";
import { Dialog } from "../components/Dialog";
import { EmptyState, PageHeader } from "../components/ui";
import { ChannelLogo } from "../connections/ChannelLogo";
import type { ChannelId, Contact, SandboxCampaign } from "../state/types";

const channels: Array<{ id: ChannelId; label: string; note: string }> = [
  { id: "linkedin", label: "LinkedIn", note: "Prospection professionnelle et suivi de relations." },
  { id: "whatsapp", label: "WhatsApp", note: "Relances et réactivation de contacts existants." },
  { id: "gmail", label: "Email", note: "Campagnes ciblées vers vos contacts connus." },
];
const objectives = [
  ["Prospecter", "Trouver ou contacter de nouvelles opportunités commerciales."],
  ["Relancer", "Reprendre contact avec des prospects existants."],
  ["Réactiver", "Recontacter des personnes avec lesquelles une conversation existait déjà."],
];
const steps = ["Objectif", "Canal", "Audience", "Séquence", "Messages", "Vérification"];
type CampaignFilter = "all" | SandboxCampaign["status"];
type ApiCampaign = { id:string; name:string; objective:string; channelType:"linkedin"|"whatsapp"|"email"; status:"draft"|"active"|"paused"|"completed"|"archived"; stopOnReply:boolean; participantCount:number; steps:Array<{stepType:string;delayValue?:number;delayUnit?:string;messageTemplate?:string}>; participants:Array<{contactId:string;status:"waiting"|"active"|"replied"|"completed"|"stopped"}> };
const apiChannelToUi=(channel:ApiCampaign["channelType"]):ChannelId=>channel==="email"?"gmail":channel;
const uiChannelToApi=(channel:ChannelId)=>channel==="gmail"?"email":channel;
const connectionStatus: Record<ChannelId, { status: "disconnected" }> = { linkedin: { status: "disconnected" }, whatsapp: { status: "disconnected" }, gmail: { status: "disconnected" } };
const objectiveToApi=(objective:string)=>objective==="Prospecter"?"prospecting":objective==="Relancer"?"follow_up":"reactivation";
const mapCampaign=(campaign:ApiCampaign):SandboxCampaign=>({id:campaign.id,name:campaign.name,objective:campaign.objective==="prospecting"?"Prospecter":campaign.objective==="follow_up"?"Relancer":"Réactiver",contactIds:campaign.participants.map(item=>item.contactId),channels:[apiChannelToUi(campaign.channelType)],channel:apiChannelToUi(campaign.channelType),status:campaign.status==="archived"?"completed":campaign.status,sequence:campaign.steps.map(item=>item.stepType==="wait"?`Attendre ${item.delayValue??0} ${item.delayUnit??"jours"}`:item.stepType==="follow_up"?"Relance":item.stepType==="message"?"Message initial":"Fin"),initialMessage:campaign.steps.find(item=>item.stepType==="message")?.messageTemplate,followUpMessage:campaign.steps.find(item=>item.stepType==="follow_up")?.messageTemplate,waitDays:campaign.steps.find(item=>item.stepType==="wait")?.delayValue,stopOnReply:campaign.stopOnReply,participantStatuses:Object.fromEntries(campaign.participants.map(item=>[item.contactId,item.status]))});

export function CampaignsClient() {
  const [campaigns,setCampaigns]=useState<SandboxCampaign[]>([]);
  const [contacts,setContacts]=useState<Contact[]>([]);
  const [error,setError]=useState("");
  const [wizardOpen, setWizardOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [objective, setObjective] = useState("Prospecter");
  const [channel, setChannel] = useState<ChannelId>("linkedin");
  const [selectedContacts, setSelectedContacts] = useState<string[]>([]);
  const [waitDays, setWaitDays] = useState(3);
  const [initialMessage, setInitialMessage] = useState("Bonjour {first_name}, je souhaitais échanger avec vous au sujet de {company}.");
  const [followUpMessage, setFollowUpMessage] = useState("Bonjour {first_name}, je me permets de revenir vers vous.");
  const [stopOnReply, setStopOnReply] = useState(true);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<CampaignFilter>("all");
  const [channelFilter, setChannelFilter] = useState<ChannelId | "all">("all");
  const [selectedCampaignId, setSelectedCampaignId] = useState<string | null>(null);
  const refresh=async()=>{const [campaignResponse,contactResponse]=await Promise.all([fetch("/api/campaigns"),fetch("/api/contacts")]);if(!campaignResponse.ok||!contactResponse.ok){setError("Impossible de charger les campagnes.");return;}const campaignData=await campaignResponse.json() as {campaigns:ApiCampaign[]};const contactData=await contactResponse.json() as {contacts:Contact[]};setCampaigns(campaignData.campaigns.map(mapCampaign));setContacts(contactData.contacts);};
  useEffect(()=>{void refresh();},[]);

  const compatibleContacts = useMemo(() => contacts.filter((contact) => channel === "linkedin" ? Boolean(contact.linkedinUrl) : channel === "whatsapp" ? Boolean(contact.phone) : Boolean(contact.email)), [channel, contacts]);
  const visibleContacts = compatibleContacts.filter((contact) => `${contact.name} ${contact.company ?? ""}`.toLowerCase().includes(search.toLowerCase()));
  const visibleCampaigns = campaigns.filter((campaign) => (filter === "all" || campaign.status === filter) && (channelFilter === "all" || (campaign.channel ?? campaign.channels[0]) === channelFilter));
  const selectedCampaign = campaigns.find((campaign) => campaign.id === selectedCampaignId) ?? null;
  const selectedChannel = selectedCampaign?.channel ?? selectedCampaign?.channels[0];

  const isProspecting = objective === "Prospecter" && channel === "linkedin";
  const resetWizard = () => { setWizardOpen(false); setStep(0); setName(""); setObjective("Prospecter"); setChannel("linkedin"); setSelectedContacts([]); setWaitDays(3); setSearch(""); };
  const chooseChannel = (value: ChannelId) => { setChannel(value); setSelectedContacts([]); };
  const createCampaign = async (status: "draft" | "active") => {
    const campaignName = name.trim() || `${objective} via ${channels.find((item) => item.id === channel)?.label}`;
    // A prospecting campaign starts with zero participants — candidates are
    // searched and reviewed after creation (see CampaignDetail's prospecting
    // panel), not selected here from existing Contacts. Its sequence is
    // invite -> message rather than message -> wait -> follow_up.
    const stepsInput = isProspecting
      ? [{ position: 0, stepType: "invite", channelType: "linkedin" }, { position: 1, stepType: "message", channelType: "linkedin", messageTemplate: initialMessage }, { position: 2, stepType: "end" }]
      : [{ position: 0, stepType: "message", channelType: uiChannelToApi(channel), messageTemplate: initialMessage }, { position: 1, stepType: "wait", delayValue: waitDays, delayUnit: "days" }, { position: 2, stepType: "follow_up", channelType: uiChannelToApi(channel), messageTemplate: followUpMessage }, { position: 3, stepType: "end" }];
    const response=await fetch("/api/campaigns",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({name:campaignName,objective:objectiveToApi(objective),channelType:uiChannelToApi(channel),participantIds:isProspecting?[]:selectedContacts,stopOnReply,steps:stepsInput})});
    const data=await response.json() as {campaign?:ApiCampaign;error?:string};if(!response.ok||!data.campaign){setError(data.error??"Impossible de créer la campagne.");return;}if(status==="active")await fetch(`/api/campaigns/${data.campaign.id}`,{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({action:"activate"})});setSelectedCampaignId(data.campaign.id);resetWizard();await refresh();
  };
  const campaignAction=async(action:"activate"|"pause"|"archive")=>{if(!selectedCampaign)return;const response=await fetch(`/api/campaigns/${selectedCampaign.id}`,{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({action})});if(!response.ok){const data=await response.json() as {error?:string};setError(data.error??"Action impossible.");return;}if(action==="archive")setSelectedCampaignId(null);await refresh();};
  const toggleStatus = () => void campaignAction(selectedCampaign?.status === "active" ? "pause" : "activate");
  const duplicate = async () => { if(!selectedCampaign)return; setName(`${selectedCampaign.name} — copie`);setObjective(selectedCampaign.objective);setChannel(selectedCampaign.channel??"linkedin");setSelectedContacts(selectedCampaign.contactIds);setWizardOpen(true); };

  if (selectedCampaign) return <CampaignDetail campaign={selectedCampaign} contacts={contacts} channel={selectedChannel} onBack={() => setSelectedCampaignId(null)} onDelete={() => void campaignAction("archive")} onDuplicate={duplicate} onToggle={toggleStatus} />;

  return <div className="campaigns-page campaigns-page--structured">
    <PageHeader title="Campagnes" description="Créez, automatisez et suivez vos actions commerciales sur vos différents canaux." actions={<button className="connection-button" onClick={() => setWizardOpen(true)} type="button"><LuPlus />Nouvelle campagne</button>} />
    <div className="campaign-toolbar"><div className="campaign-tabs">{(["all", "active", "draft", "paused", "completed"] as CampaignFilter[]).map((value) => <button className={filter === value ? "is-active" : undefined} key={value} onClick={() => setFilter(value)} type="button">{{ all: "Toutes", active: "Actives", draft: "Brouillons", paused: "En pause", completed: "Terminées" }[value]}</button>)}</div><select aria-label="Filtrer par canal" onChange={(event) => setChannelFilter(event.target.value as ChannelId | "all")} value={channelFilter}><option value="all">Tous les canaux</option>{channels.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></div>
    {error?<p className="campaign-guardrail">{error}</p>:null}{visibleCampaigns.length === 0 ? <EmptyState icon={<LuSend />} title="Aucune campagne pour le moment" description="Créez votre première campagne pour commencer à engager ou relancer vos contacts." action={<button className="connection-button" onClick={() => setWizardOpen(true)} type="button">Créer une campagne</button>} /> : <div className="campaign-table"><div className="campaign-table__head"><span>Campagne</span><span>Canal</span><span>Audience</span><span>Séquence</span><span>Statut</span><span /></div>{visibleCampaigns.map((campaign) => { const campaignChannel = campaign.channel ?? campaign.channels[0]; return <button className="campaign-row" key={campaign.id} onClick={() => setSelectedCampaignId(campaign.id)} type="button"><span><strong>{campaign.name}</strong><small>{campaign.objective}</small></span><span>{campaignChannel ? <><ChannelLogo channel={campaignChannel} />{channels.find((item) => item.id === campaignChannel)?.label}</> : "—"}</span><span>{campaign.contactIds.length} contacts</span><span>{campaign.sequence.length} étapes</span><span><i className={`campaign-status campaign-status--${campaign.status}`}>{campaign.status === "draft" ? "Brouillon" : campaign.status === "active" ? "Active" : campaign.status === "paused" ? "En pause" : "Terminée"}</i></span><LuArrowRight /></button>; })}</div>}
    <Dialog className="campaign-wizard-dialog" description="Simulation Talvia uniquement : aucun message réel ne sera envoyé." onClose={resetWizard} open={wizardOpen} title="Nouvelle campagne"><div className="campaign-wizard"><div className="campaign-wizard__progress">{steps.map((label, index) => <span className={index === step ? "is-current" : index < step ? "is-done" : undefined} key={label}><i>{index < step ? <LuCheck /> : index + 1}</i>{label}</span>)}</div><div className="campaign-wizard__body">{step === 0 ? <WizardObjective name={name} objective={objective} setName={setName} setObjective={setObjective} /> : null}{step === 1 ? <WizardChannel channel={channel} chooseChannel={chooseChannel} connections={connectionStatus} /> : null}{step === 2 ? (isProspecting ? <WizardProspectingAudience /> : <WizardAudience contacts={visibleContacts} search={search} selected={selectedContacts} setSearch={setSearch} setSelected={setSelectedContacts} />) : null}{step === 3 ? <WizardSequence channel={channel} isProspecting={isProspecting} waitDays={waitDays} setWaitDays={setWaitDays} stopOnReply={stopOnReply} setStopOnReply={setStopOnReply} /> : null}{step === 4 ? <WizardMessages channel={channel} isProspecting={isProspecting} initial={initialMessage} followUp={followUpMessage} setInitial={setInitialMessage} setFollowUp={setFollowUpMessage} /> : null}{step === 5 ? <WizardReview name={name} objective={objective} channel={channel} contacts={isProspecting ? undefined : selectedContacts.length} waitDays={waitDays} /> : null}</div><div className="campaign-wizard__actions"><button className="connection-button connection-button--secondary" disabled={step === 0} onClick={() => setStep(step - 1)} type="button"><LuArrowLeft />Retour</button>{step < 5 ? <button className="connection-button" disabled={step === 2 && !isProspecting && selectedContacts.length === 0} onClick={() => setStep(step + 1)} type="button">Continuer<LuArrowRight /></button> : <><button className="connection-button connection-button--secondary" onClick={() => void createCampaign("draft")} type="button">Enregistrer en brouillon</button><button className="connection-button" onClick={() => void createCampaign("active")} type="button"><Play aria-hidden="true" size={14} />Lancer</button></>}</div></div></Dialog>
  </div>;
}

function WizardObjective({ name, objective, setName, setObjective }: { name: string; objective: string; setName: (v: string) => void; setObjective: (v: string) => void }) { return <><h3>Que souhaitez-vous faire ?</h3><div className="campaign-choice-grid">{objectives.map(([title, note]) => <button className={objective === title ? "is-active" : undefined} key={title} onClick={() => setObjective(title)} type="button"><strong>{title}</strong><span>{note}</span></button>)}</div><label className="campaign-name-field"><span>Nom de la campagne</span><input onChange={(event) => setName(event.target.value)} placeholder="Ex. Relance prospects août" value={name} /></label></>; }
function WizardChannel({ channel, chooseChannel, connections }: { channel: ChannelId; chooseChannel: (v: ChannelId) => void; connections: Record<ChannelId, { status: string }> }) { return <><h3>Quel canal souhaitez-vous utiliser ?</h3><div className="campaign-choice-grid">{channels.map((item) => <button className={channel === item.id ? "is-active" : undefined} key={item.id} onClick={() => chooseChannel(item.id)} type="button"><ChannelLogo channel={item.id} /><strong>{item.label}</strong><span>{item.note}</span><small className={connections[item.id].status === "connected" ? "is-connected" : "is-disconnected"}>{connections[item.id].status === "connected" ? "Connecté" : "Non connecté"}</small></button>)}</div>{connections[channel].status !== "connected" ? <a className="campaign-connect-link" href="/app/connections">Configurer dans Connexions</a> : null}</>; }
function WizardAudience({ contacts, search, selected, setSearch, setSelected }: { contacts: Contact[]; search: string; selected: string[]; setSearch: (v: string) => void; setSelected: (v: string[]) => void }) { const toggle = (id: string) => setSelected(selected.includes(id) ? selected.filter((item) => item !== id) : [...selected, id]); return <><h3>Qui voulez-vous contacter ?</h3><div className="campaign-audience-tools"><label><LuSearch /><input onChange={(event) => setSearch(event.target.value)} placeholder="Rechercher..." value={search} /></label><button onClick={() => setSelected(selected.length === contacts.length ? [] : contacts.map((item) => item.id))} type="button">Tout sélectionner</button></div><div className="campaign-audience-list">{contacts.length === 0 ? <p>Aucun contact compatible avec ce canal.</p> : contacts.map((contact) => <label key={contact.id}><input checked={selected.includes(contact.id)} onChange={() => toggle(contact.id)} type="checkbox" /><span className="campaign-contact-avatar">{contact.name.slice(0, 2).toUpperCase()}</span><span><strong>{contact.name}</strong><small>{contact.role ?? "Contact"} · {contact.company ?? "Entreprise non renseignée"}</small></span></label>)}</div><p className="campaign-selected-count">{selected.length} contact(s) sélectionné(s)</p></>; }
// Prospecting has no existing-Contact audience to pick from at this point —
// candidates come from an AI-assisted LinkedIn search run after the campaign
// exists (see CampaignDetail's prospecting panel), reviewed and approved one
// by one before anything is sent.
function WizardProspectingAudience() { return <><h3>Qui voulez-vous contacter ?</h3><p className="campaign-helper">Pour la prospection LinkedIn, Talvia proposera une liste de profils correspondant à votre Business Context une fois la campagne créée — vous choisirez ensuite qui contacter avant tout envoi.</p></>; }
function WizardSequence({ channel, isProspecting, waitDays, setWaitDays, stopOnReply, setStopOnReply }: { channel: ChannelId; isProspecting: boolean; waitDays: number; setWaitDays: (v: number) => void; stopOnReply: boolean; setStopOnReply: (v: boolean) => void }) { const label = channels.find((item) => item.id === channel)?.label; if (isProspecting) return <><h3>Construisez votre séquence</h3><div className="campaign-sequence"><div>Invitation LinkedIn</div><i>↓</i><div>Si acceptée</div><i>↓</i><div>Message personnalisé</div><i>↓</i><div>Fin</div></div><p className="campaign-guardrail">Les invitations sont envoyées par petits lots que vous déclenchez vous-même, à un rythme sûr pour votre compte LinkedIn — jamais en continu automatiquement.</p></>; return <><h3>Construisez votre séquence</h3><div className="campaign-sequence"><div>Message {label}</div><i>↓</i><div className="campaign-wait">Attendre <input min={1} onChange={(event) => setWaitDays(Number(event.target.value))} type="number" value={waitDays} /> jours</div><i>↓</i><div>Si aucune réponse</div><i>↓</i><div>Relance {label}</div><i>↓</i><div>Fin</div></div><label className="campaign-stop-rule"><input checked={stopOnReply} onChange={(event) => setStopOnReply(event.target.checked)} type="checkbox" /><span><strong>Arrêter la séquence lorsqu’une réponse est reçue</strong><small>Activé par défaut pour respecter vos contacts.</small></span></label>{channel === "linkedin" ? <p className="campaign-guardrail">Cadence prudente — les messages seront répartis progressivement lorsque la connexion réelle sera disponible.</p> : channel === "whatsapp" ? <p className="campaign-guardrail">WhatsApp est recommandé pour les contacts avec lesquels vous avez déjà une relation commerciale.</p> : null}</>; }
function WizardMessages({ channel, isProspecting, initial, followUp, setInitial, setFollowUp }: { channel: ChannelId; isProspecting: boolean; initial: string; followUp: string; setInitial: (v: string) => void; setFollowUp: (v: string) => void }) { const label = channels.find((item) => item.id === channel)?.label; if (isProspecting) return <><h3>Message envoyé une fois l’invitation acceptée</h3><p className="campaign-helper">La note d’invitation elle-même est personnalisée automatiquement par Talvia pour chaque profil. Ce message-ci part une fois la personne connectée.</p><label><span>Message</span><textarea onChange={(event) => setInitial(event.target.value)} rows={5} value={initial} /></label></>; return <><h3>Rédigez vos messages {label}</h3><p className="campaign-helper">Utilisez {"{first_name}"} et {"{company}"} pour personnaliser vos messages.</p><label><span>Message initial</span><textarea onChange={(event) => setInitial(event.target.value)} rows={5} value={initial} /><button className="campaign-ai-placeholder" onClick={() => setInitial("Bonjour {first_name}, je souhaite échanger avec vous au sujet de {company}.")} type="button">✨ Proposer un exemple</button></label><label><span>Relance</span><textarea onChange={(event) => setFollowUp(event.target.value)} rows={4} value={followUp} /></label></>; }
function WizardReview({ name, objective, channel, contacts, waitDays }: { name: string; objective: string; channel: ChannelId; contacts?: number; waitDays: number }) { return <><h3>Vérifiez votre campagne</h3><dl className="campaign-review"><div><dt>Nom</dt><dd>{name || `${objective} via ${channels.find((item) => item.id === channel)?.label}`}</dd></div><div><dt>Objectif</dt><dd>{objective}</dd></div><div><dt>Canal</dt><dd>{channels.find((item) => item.id === channel)?.label}</dd></div><div><dt>Audience</dt><dd>{contacts === undefined ? "À choisir après création" : `${contacts} contacts`}</dd></div><div><dt>Séquence</dt><dd>{contacts === undefined ? "Invitation → Message" : `Message → ${waitDays} jours → Relance → Fin`}</dd></div></dl><p className="campaign-simulation-note">{contacts === undefined ? "Les invitations LinkedIn sont réelles une fois envoyées — rien ne part avant que vous ayez validé une liste de prospects." : "Aperçu local : aucun message n’est envoyé vers un canal externe."}</p></>; }
function CampaignDetail({ campaign, contacts, channel, onBack, onDelete, onDuplicate, onToggle }: { campaign: SandboxCampaign; contacts: Contact[]; channel?: ChannelId; onBack: () => void; onDelete: () => void; onDuplicate: () => void; onToggle: () => void }) { const participants = contacts.filter((contact) => campaign.contactIds.includes(contact.id)); const replied = Object.values(campaign.participantStatuses ?? {}).filter((status) => status === "replied").length; const isProspecting = campaign.objective === "Prospecter" && channel === "linkedin"; return <div className="campaign-detail"><button className="campaign-back" onClick={onBack} type="button"><LuArrowLeft />Retour aux campagnes</button><header className="campaign-detail__header"><div><div className="campaign-detail__title"><h1>{campaign.name}</h1><i className={`campaign-status campaign-status--${campaign.status}`}>{campaign.status}</i></div><p>{campaign.objective} · {channel ? channels.find((item) => item.id === channel)?.label : "Canal non défini"}</p></div><div><button className="connection-button connection-button--secondary" onClick={onToggle} type="button">{campaign.status === "active" ? <><Pause aria-hidden="true" size={14} />Mettre en pause</> : <><Play aria-hidden="true" size={14} />Activer</>}</button><button className="connection-button connection-button--quiet" onClick={onDuplicate} type="button"><LuCopy />Dupliquer</button><button className="connection-button connection-button--quiet" onClick={onDelete} type="button"><LuTrash2 />Archiver</button></div></header>{!isProspecting ? <p className="campaign-simulation-note">Simulation Talvia : aucun message n’est envoyé vers un canal externe.</p> : null}<div className="campaign-metrics"><div><span>Contacts</span><strong>{participants.length}</strong></div><div><span>Préparés</span><strong>{campaign.status === "active" || campaign.status === "paused" ? participants.length : 0}</strong></div><div><span>Réponses</span><strong>{replied}</strong></div><div><span>Terminés</span><strong>{Object.values(campaign.participantStatuses ?? {}).filter((status) => status === "completed").length}</strong></div></div><section className="campaign-detail-panel"><h2>Séquence</h2><div className="campaign-detail-sequence">{campaign.sequence.map((item, index) => <span key={`${item}-${index}`}>{item}</span>)}</div>{campaign.stopOnReply ? <p><LuCheck />La séquence est préparée pour s’arrêter après une réponse future.</p> : null}</section>{isProspecting ? <ProspectingPanel campaignId={campaign.id} campaignStatus={campaign.status} /> : <section className="campaign-detail-panel"><h2>Audience</h2><div className="campaign-participants"><div className="campaign-participants__head"><span>Contact</span><span>Entreprise</span><span>Étape actuelle</span><span>Statut</span><span /></div>{participants.map((contact) => { const status = campaign.participantStatuses?.[contact.id] ?? "waiting"; return <div className="campaign-participant" key={contact.id}><span><b className="campaign-contact-avatar">{contact.name.slice(0, 2).toUpperCase()}</b><strong>{contact.name}</strong></span><span>{contact.company ?? "—"}</span><span>{status === "replied" ? "Séquence arrêtée" : "Message initial"}</span><span>{status === "replied" ? "Répondu" : campaign.status === "active" ? "En cours" : "En attente"}</span><span>Simulation</span></div>; })}</div></section>}</div>; }

type ProspectCandidate = { id: string; providerId: string; name: string; headline?: string; company?: string; profileUrl?: string; status: "suggested" | "approved" | "rejected" };

// Search → human review → approve → manually-triggered send, in that order.
// Nothing here ever sends anything without an explicit click on a
// previously-reviewed list — see app/lib/prospecting.ts for why.
function ProspectingPanel({ campaignId, campaignStatus }: { campaignId: string; campaignStatus: SandboxCampaign["status"] }) {
  const [candidates, setCandidates] = useState<ProspectCandidate[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [keywords, setKeywords] = useState("");
  const [searching, setSearching] = useState(false);
  const [approving, setApproving] = useState(false);
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState("");

  const load = async () => { const response = await fetch(`/api/campaigns/${campaignId}/prospecting/search`); if (response.ok) setCandidates((await response.json() as { candidates: ProspectCandidate[] }).candidates); };
  useEffect(() => {
    // Fetch-on-mount/prop-change, same accepted pattern already used
    // throughout this codebase's other client components (e.g.
    // CampaignsClient's own top-level refresh()).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaignId]);

  const search = async () => {
    setSearching(true); setNotice("");
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/prospecting/search`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ keywords: keywords.trim() || undefined }) });
      const data = await response.json() as { candidates?: ProspectCandidate[]; error?: string };
      if (!response.ok) { setNotice(data.error ?? "Recherche impossible."); return; }
      setCandidates(data.candidates ?? []);
    } finally { setSearching(false); }
  };
  const toggle = (id: string) => setSelected(selected.includes(id) ? selected.filter((item) => item !== id) : [...selected, id]);
  const approve = async () => {
    if (!selected.length) return;
    setApproving(true); setNotice("");
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/prospecting/approve`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ candidateIds: selected }) });
      const data = await response.json() as { approved?: number; error?: string };
      if (!response.ok) { setNotice(data.error ?? "Validation impossible."); return; }
      setNotice(`${data.approved ?? 0} prospect(s) ajouté(s) à la campagne.`);
      setSelected([]);
      await load();
    } finally { setApproving(false); }
  };
  const sendBatch = async () => {
    setSending(true); setNotice("");
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/prospecting/send`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({}) });
      const data = await response.json() as { sent?: number; failed?: number; error?: string };
      if (!response.ok) { setNotice(data.error ?? "Envoi impossible."); return; }
      setNotice(`${data.sent ?? 0} invitation(s) envoyée(s)${data.failed ? `, ${data.failed} échec(s)` : ""}.`);
    } finally { setSending(false); }
  };

  const suggested = candidates.filter((item) => item.status === "suggested");
  const approved = candidates.filter((item) => item.status === "approved");

  return <section className="campaign-detail-panel">
    <h2>Prospects LinkedIn</h2>
    {notice ? <p className="campaign-guardrail">{notice}</p> : null}
    <div className="campaign-audience-tools">
      <label><LuSearch /><input onChange={(event) => setKeywords(event.target.value)} placeholder="Mots-clés additionnels (optionnel — sinon basé sur votre Business Context)" value={keywords} /></label>
      <button disabled={searching} onClick={() => void search()} type="button"><LuUserPlus />{searching ? "Recherche..." : "Rechercher des prospects"}</button>
    </div>
    {suggested.length ? <>
      <div className="campaign-audience-list">
        {suggested.map((candidate) => <label key={candidate.id}>
          <input checked={selected.includes(candidate.id)} onChange={() => toggle(candidate.id)} type="checkbox" />
          <span className="campaign-contact-avatar">{candidate.name.slice(0, 2).toUpperCase()}</span>
          <span><strong>{candidate.name}</strong><small>{candidate.headline ?? "Profil LinkedIn"}{candidate.company ? ` · ${candidate.company}` : ""}</small></span>
        </label>)}
      </div>
      <p className="campaign-selected-count">{selected.length} prospect(s) sélectionné(s)</p>
      <button className="connection-button" disabled={approving || !selected.length} onClick={() => void approve()} type="button">{approving ? "Validation..." : "Valider cette sélection"}</button>
    </> : <p>Aucun prospect suggéré pour l’instant — lancez une recherche.</p>}
    {approved.length ? <div className="campaign-detail-panel__footer">
      <p>{approved.length} prospect(s) validé(s), prêt(s) à recevoir une invitation.</p>
      <button className="connection-button" disabled={sending || campaignStatus !== "active"} onClick={() => void sendBatch()} type="button"><LuSend />{sending ? "Envoi..." : "Envoyer ce lot"}</button>
      {campaignStatus !== "active" ? <small>Activez la campagne avant d’envoyer des invitations.</small> : null}
    </div> : null}
  </section>;
}
