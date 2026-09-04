"use client";

import { useEffect, useMemo, useState } from "react";
import { LuArrowLeft, LuArrowRight, LuCheck, LuCopy, LuPlus, LuSearch, LuSend, LuTrash2, LuUserPlus } from "react-icons/lu";
import { Pause, Play } from "@animateicons/react/lucide";
import { Dialog } from "../components/Dialog";
import { EmptyState, PageHeader } from "../components/ui";
import { ChannelLogo } from "../connections/ChannelLogo";
import type { ChannelId, ConnectionStatus, Contact, SandboxCampaign } from "../state/types";

const channels: Array<{ id: ChannelId; label: string; note: string }> = [
  { id: "linkedin", label: "LinkedIn", note: "Prospection professionnelle et suivi de relations." },
  { id: "whatsapp", label: "WhatsApp", note: "Relances et réactivation de contacts existants." },
  { id: "gmail", label: "E-mail", note: "Suivi, relances et propositions vers des adresses déjà connues." },
  { id: "gmail", label: "Email", note: "Campagnes ciblées vers vos contacts connus." },
];
const objectives = [
  ["Prospecter", "Trouver ou contacter de nouvelles opportunités commerciales."],
  ["Relancer", "Reprendre contact avec des prospects existants."],
  ["Réactiver", "Recontacter des personnes avec lesquelles une conversation existait déjà."],
];
const steps = ["Objectif", "Canal", "Audience", "Séquence", "Messages", "Vérification"];
// {first_name}/{company} are substituted for real once the message actually
// sends (see unipile-adapter.ts's sendProspectingFollowUp) — these are just
// good starting copy, editable before the campaign is created.
const PROSPECTING_MESSAGE_DEFAULT = "Bonjour {first_name}, merci d’avoir accepté mon invitation ! Je m’intéresse à ce que fait {company} et j’aimerais en savoir plus sur vos priorités actuelles. Auriez-vous quelques minutes cette semaine pour échanger ?";
const CAMPAIGN_MESSAGE_DEFAULT = "Bonjour {first_name}, je souhaitais échanger avec vous au sujet de {company}.";
type CampaignFilter = "all" | SandboxCampaign["status"];
// One row per Contact with a real, existing WhatsApp Conversation (see
// GET /api/campaigns/whatsapp-relations / lib/campaigns.ts's
// listEligibleWhatsAppRelations) — never a generic Contacts list. Only the
// metadata needed to recognize the relationship, never full history.
type WhatsAppRelation = { id: string; name: string; company?: string; conversationId: string; lastMessageAt?: string; lastMessagePreview?: string; lastMessageDirection?: "inbound" | "outbound" };
// One row per Contact with a real, usable email address (see
// GET /api/campaigns/email-audience / lib/campaigns.ts's
// listEligibleEmailContacts). `hasConversation` is what distinguishes a
// threaded relance from a first touch — both are legitimate on email.
type EmailAudienceContact = { id: string; name: string; company?: string; address: string; hasConversation: boolean; lastMessageAt?: string };
type ApiCampaign = { id:string; name:string; objective:string; channelType:"linkedin"|"whatsapp"|"email"; status:"draft"|"active"|"paused"|"completed"|"archived"; stopOnReply:boolean; participantCount:number; steps:Array<{stepType:string;delayValue?:number;delayUnit?:string;messageTemplate?:string}>; participants:Array<{contactId:string;status:"waiting"|"active"|"replied"|"completed"|"stopped"}> };
const apiChannelToUi=(channel:ApiCampaign["channelType"]):ChannelId=>channel==="email"?"gmail":channel;
const uiChannelToApi=(channel:ChannelId)=>channel==="gmail"?"email":channel;
const EMPTY_CONNECTION_STATUS: Record<ChannelId, ConnectionStatus> = { linkedin: "disconnected", whatsapp: "disconnected", gmail: "disconnected" };
const objectiveToApi=(objective:string)=>objective==="Prospecter"?"prospecting":objective==="Relancer"?"follow_up":"reactivation";
const mapCampaign=(campaign:ApiCampaign):SandboxCampaign=>({id:campaign.id,name:campaign.name,objective:campaign.objective==="prospecting"?"Prospecter":campaign.objective==="follow_up"?"Relancer":"Réactiver",contactIds:campaign.participants.map(item=>item.contactId),channels:[apiChannelToUi(campaign.channelType)],channel:apiChannelToUi(campaign.channelType),status:campaign.status==="archived"?"completed":campaign.status,sequence:campaign.steps.map(item=>item.stepType==="wait"?`Attendre ${item.delayValue??0} ${item.delayUnit??"jours"}`:item.stepType==="follow_up"?"Relance":item.stepType==="message"?"Message initial":"Fin"),initialMessage:campaign.steps.find(item=>item.stepType==="message")?.messageTemplate,followUpMessage:campaign.steps.find(item=>item.stepType==="follow_up")?.messageTemplate,waitDays:campaign.steps.find(item=>item.stepType==="wait")?.delayValue,stopOnReply:campaign.stopOnReply,participantStatuses:Object.fromEntries(campaign.participants.map(item=>[item.contactId,item.status]))});

export function CampaignsClient() {
  const [campaigns,setCampaigns]=useState<SandboxCampaign[]>([]);
  const [contacts,setContacts]=useState<Contact[]>([]);
  const [whatsappRelations,setWhatsappRelations]=useState<WhatsAppRelation[]>([]);
  const [emailAudience,setEmailAudience]=useState<EmailAudienceContact[]>([]);
  const [emailSubject,setEmailSubject]=useState("");
  const [error,setError]=useState("");
  const [wizardOpen, setWizardOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [objective, setObjective] = useState("Prospecter");
  const [channel, setChannel] = useState<ChannelId>("linkedin");
  const [selectedContacts, setSelectedContacts] = useState<string[]>([]);
  const [waitDays, setWaitDays] = useState(3);
  const [initialMessage, setInitialMessage] = useState(PROSPECTING_MESSAGE_DEFAULT);
  const [followUpMessage, setFollowUpMessage] = useState("Bonjour {first_name}, je me permets de revenir vers vous.");
  const [stopOnReply, setStopOnReply] = useState(true);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<CampaignFilter>("all");
  const [channelFilter, setChannelFilter] = useState<ChannelId | "all">("all");
  const [selectedCampaignId, setSelectedCampaignId] = useState<string | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<Record<ChannelId, ConnectionStatus>>(EMPTY_CONNECTION_STATUS);
  const refresh=async()=>{const [campaignResponse,contactResponse,whatsappRelationsResponse,emailAudienceResponse]=await Promise.all([fetch("/api/campaigns"),fetch("/api/contacts"),fetch("/api/campaigns/whatsapp-relations"),fetch("/api/campaigns/email-audience")]);if(!campaignResponse.ok||!contactResponse.ok){setError("Impossible de charger les campagnes.");return;}const campaignData=await campaignResponse.json() as {campaigns:ApiCampaign[]};const contactData=await contactResponse.json() as {contacts:Contact[]};setCampaigns(campaignData.campaigns.map(mapCampaign));setContacts(contactData.contacts);if(whatsappRelationsResponse.ok){const relationsData=await whatsappRelationsResponse.json() as {relations:WhatsAppRelation[]};setWhatsappRelations(relationsData.relations);}if(emailAudienceResponse.ok){const audienceData=await emailAudienceResponse.json() as {contacts:EmailAudienceContact[]};setEmailAudience(audienceData.contacts);}};
  useEffect(()=>{void refresh();},[]);
  // Same source of truth and mapping as app/app/connections/ConnectionsClient.tsx —
  // a connection only ever becomes "connected" once Unipile's webhook confirms
  // it (see api/webhooks/unipile), never self-reported, so reading /api/connections
  // here is the only honest way to know if LinkedIn is really usable for a campaign.
  useEffect(()=>{void fetch("/api/connections").then(async(response)=>response.ok?response.json():null).then((data)=>{if(!data)return;setConnectionStatus((current)=>({...current,...Object.fromEntries(data.connections.map((item:{channel_type:"linkedin"|"whatsapp"|"email";status:ConnectionStatus})=>[item.channel_type==="email"?"gmail":item.channel_type,item.status]))}));});},[]);

  // WhatsApp deliberately does NOT reuse compatibleContacts (Contact.phone
  // truthy) — that only proves an identity exists, not a real Conversation.
  // whatsappRelations already comes pre-filtered to Contacts with both an
  // identity AND an existing WhatsApp Conversation (see
  // listEligibleWhatsAppRelations) — this list is the eligibility rule,
  // not just a display choice.
  const compatibleContacts = useMemo(() => contacts.filter((contact) => channel === "linkedin" ? Boolean(contact.linkedinUrl) : channel === "whatsapp" ? Boolean(contact.phone) : Boolean(contact.email)), [channel, contacts]);
  const visibleContacts = compatibleContacts.filter((contact) => `${contact.name} ${contact.company ?? ""}`.toLowerCase().includes(search.toLowerCase()));
  const visibleWhatsAppRelations = whatsappRelations.filter((relation) => `${relation.name} ${relation.company ?? ""}`.toLowerCase().includes(search.toLowerCase()));
  const visibleEmailAudience = emailAudience.filter((contact) => `${contact.name} ${contact.company ?? ""} ${contact.address}`.toLowerCase().includes(search.toLowerCase()));
  const visibleCampaigns = campaigns.filter((campaign) => (filter === "all" || campaign.status === filter) && (channelFilter === "all" || (campaign.channel ?? campaign.channels[0]) === channelFilter));
  const selectedCampaign = campaigns.find((campaign) => campaign.id === selectedCampaignId) ?? null;
  const selectedChannel = selectedCampaign?.channel ?? selectedCampaign?.channels[0];

  const isProspecting = objective === "Prospecter" && channel === "linkedin";
  // Swaps the message field's starting copy when the objective/channel
  // choice crosses the prospecting boundary — applied directly in the
  // event handlers below (chooseObjective/chooseChannel) rather than a
  // reactive effect, and only while the field still holds one of the two
  // known defaults, so it never overwrites an edit the user already made.
  const applyProspectingDefault = (nextObjective: string, nextChannel: ChannelId) => {
    const nextIsProspecting = nextObjective === "Prospecter" && nextChannel === "linkedin";
    setInitialMessage((current) => {
      if (current !== PROSPECTING_MESSAGE_DEFAULT && current !== CAMPAIGN_MESSAGE_DEFAULT) return current;
      return nextIsProspecting ? PROSPECTING_MESSAGE_DEFAULT : CAMPAIGN_MESSAGE_DEFAULT;
    });
  };
  const resetWizard = () => { setWizardOpen(false); setStep(0); setName(""); setObjective("Prospecter"); setChannel("linkedin"); setSelectedContacts([]); setWaitDays(3); setSearch(""); setEmailSubject(""); setInitialMessage(PROSPECTING_MESSAGE_DEFAULT); setFollowUpMessage("Bonjour {first_name}, je me permets de revenir vers vous."); };
  const chooseObjective = (value: string) => { setObjective(value); applyProspectingDefault(value, channel); };
  const chooseChannel = (value: ChannelId) => { setChannel(value); setSelectedContacts([]); applyProspectingDefault(objective, value); };
  const createCampaign = async (status: "draft" | "active") => {
    const campaignName = name.trim() || `${objective} via ${channels.find((item) => item.id === channel)?.label}`;
    // A prospecting campaign starts with zero participants — candidates are
    // searched and reviewed after creation (see CampaignDetail's prospecting
    // panel), not selected here from existing Contacts. A follow-up is just
    // another 'message' step (see campaign-execution/step-progression.ts's
    // WAIT handling) — never a distinct 'follow_up' mechanism — so the two
    // relances below reuse the exact same step type as the first message.
    const stepsInput = isProspecting
      ? [
          { position: 0, stepType: "invite", channelType: "linkedin" },
          { position: 1, stepType: "message", channelType: "linkedin", messageTemplate: initialMessage },
          { position: 2, stepType: "wait", delayValue: waitDays, delayUnit: "days" },
          { position: 3, stepType: "message", channelType: "linkedin", messageTemplate: followUpMessage },
          { position: 4, stepType: "wait", delayValue: waitDays, delayUnit: "days" },
          { position: 5, stepType: "message", channelType: "linkedin" },
          { position: 6, stepType: "end" },
        ]
      : [{ position: 0, stepType: "message", channelType: uiChannelToApi(channel), messageTemplate: initialMessage }, { position: 1, stepType: "wait", delayValue: waitDays, delayUnit: "days" }, { position: 2, stepType: "message", channelType: uiChannelToApi(channel), messageTemplate: followUpMessage }, { position: 3, stepType: "end" }];
    const response=await fetch("/api/campaigns",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({name:campaignName,objective:objectiveToApi(objective),channelType:uiChannelToApi(channel),participantIds:isProspecting?[]:selectedContacts,stopOnReply,steps:stepsInput,...(channel==="gmail"?{emailSubject:emailSubject.trim()}:{})})});
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
    <Dialog className="campaign-wizard-dialog" description={channel==="whatsapp"?"Les messages WhatsApp envoyés depuis une campagne sont réels — ils continuent une conversation déjà existante.":channel==="gmail"?"Les e-mails envoyés depuis une campagne sont réels — vers des adresses que Talvia connaît déjà.":"Simulation Talvia uniquement : aucun message réel ne sera envoyé."} onClose={resetWizard} open={wizardOpen} title="Nouvelle campagne"><div className="campaign-wizard"><div className="campaign-wizard__progress">{steps.map((label, index) => <span className={index === step ? "is-current" : index < step ? "is-done" : undefined} key={label}><i>{index < step ? <LuCheck /> : index + 1}</i>{label}</span>)}</div><div className="campaign-wizard__body">{step === 0 ? <WizardObjective name={name} objective={objective} setName={setName} setObjective={chooseObjective} /> : null}{step === 1 ? <WizardChannel channel={channel} chooseChannel={chooseChannel} connections={connectionStatus} /> : null}{step === 2 ? (isProspecting ? <WizardProspectingAudience /> : channel === "whatsapp" ? <WizardWhatsAppAudience relations={visibleWhatsAppRelations} search={search} selected={selectedContacts} setSearch={setSearch} setSelected={setSelectedContacts} /> : channel === "gmail" ? <WizardEmailAudience contacts={visibleEmailAudience} search={search} selected={selectedContacts} setSearch={setSearch} setSelected={setSelectedContacts} /> : <WizardAudience contacts={visibleContacts} search={search} selected={selectedContacts} setSearch={setSearch} setSelected={setSelectedContacts} />) : null}{step === 3 ? <WizardSequence channel={channel} isProspecting={isProspecting} waitDays={waitDays} setWaitDays={setWaitDays} stopOnReply={stopOnReply} setStopOnReply={setStopOnReply} /> : null}{step === 4 ? <WizardMessages channel={channel} isProspecting={isProspecting} initial={initialMessage} followUp={followUpMessage} setInitial={setInitialMessage} setFollowUp={setFollowUpMessage} emailSubject={emailSubject} setEmailSubject={setEmailSubject} /> : null}{step === 5 ? <WizardReview name={name} objective={objective} channel={channel} contacts={isProspecting ? undefined : selectedContacts.length} waitDays={waitDays} /> : null}</div><div className="campaign-wizard__actions"><button className="connection-button connection-button--secondary" disabled={step === 0} onClick={() => setStep(step - 1)} type="button"><LuArrowLeft />Retour</button>{step < 5 ? <button className="connection-button" disabled={(step === 2 && !isProspecting && selectedContacts.length === 0) || (step === 4 && channel === "gmail" && !emailSubject.trim())} onClick={() => setStep(step + 1)} type="button">Continuer<LuArrowRight /></button> : <><button className="connection-button connection-button--secondary" onClick={() => void createCampaign("draft")} type="button">Enregistrer en brouillon</button><button className="connection-button" onClick={() => void createCampaign("active")} type="button"><Play aria-hidden="true" size={14} />Lancer</button></>}</div></div></Dialog>
  </div>;
}

function WizardObjective({ name, objective, setName, setObjective }: { name: string; objective: string; setName: (v: string) => void; setObjective: (v: string) => void }) { return <><h3>Que souhaitez-vous faire ?</h3><div className="campaign-choice-grid">{objectives.map(([title, note]) => <button className={objective === title ? "is-active" : undefined} key={title} onClick={() => setObjective(title)} type="button"><strong>{title}</strong><span>{note}</span></button>)}</div><label className="campaign-name-field"><span>Nom de la campagne</span><input onChange={(event) => setName(event.target.value)} placeholder="Ex. Relance prospects août" value={name} /></label></>; }
function WizardChannel({ channel, chooseChannel, connections }: { channel: ChannelId; chooseChannel: (v: ChannelId) => void; connections: Record<ChannelId, ConnectionStatus> }) { return <><h3>Quel canal souhaitez-vous utiliser ?</h3><div className="campaign-choice-grid">{channels.map((item) => <button className={channel === item.id ? "is-active" : undefined} key={item.id} onClick={() => chooseChannel(item.id)} type="button"><ChannelLogo channel={item.id} /><strong>{item.label}</strong><span>{item.note}</span><small className={connections[item.id] === "connected" ? "is-connected" : "is-disconnected"}>{connections[item.id] === "connected" ? "Connecté" : "Non connecté"}</small></button>)}</div>{connections[channel] !== "connected" ? <a className="campaign-connect-link" href="/app/connections">Configurer dans Connexions</a> : null}</>; }
function WizardAudience({ contacts, search, selected, setSearch, setSelected }: { contacts: Contact[]; search: string; selected: string[]; setSearch: (v: string) => void; setSelected: (v: string[]) => void }) { const toggle = (id: string) => setSelected(selected.includes(id) ? selected.filter((item) => item !== id) : [...selected, id]); return <><h3>Qui voulez-vous contacter ?</h3><div className="campaign-audience-tools"><label><LuSearch /><input onChange={(event) => setSearch(event.target.value)} placeholder="Rechercher..." value={search} /></label><button onClick={() => setSelected(selected.length === contacts.length ? [] : contacts.map((item) => item.id))} type="button">Tout sélectionner</button></div><div className="campaign-audience-list">{contacts.length === 0 ? <p>Aucun contact compatible avec ce canal.</p> : contacts.map((contact) => <label key={contact.id}><input checked={selected.includes(contact.id)} onChange={() => toggle(contact.id)} type="checkbox" /><span className="campaign-contact-avatar">{contact.name.slice(0, 2).toUpperCase()}</span><span><strong>{contact.name}</strong><small>{contact.role ?? "Contact"} · {contact.company ?? "Entreprise non renseignée"}</small></span></label>)}</div><p className="campaign-selected-count">{selected.length} contact(s) sélectionné(s)</p></>; }
// WhatsApp is a relation-continuation channel, not a cold-prospecting one
// (docs/product/ARCHITECTURE.md §7) — `relations` already comes pre-filtered
// server-side to Contacts with a real, existing WhatsApp Conversation (see
// GET /api/campaigns/whatsapp-relations); this view exists so the user
// recognizes the relationship and where it left off, not to browse a CRM
// list. Same row shape/grid as WizardAudience (checkbox, avatar, content),
// just with the relationship context appended, not rebuilt.
function WizardWhatsAppAudience({ relations, search, selected, setSearch, setSelected }: { relations: WhatsAppRelation[]; search: string; selected: string[]; setSearch: (v: string) => void; setSelected: (v: string[]) => void }) {
  const toggle = (id: string) => setSelected(selected.includes(id) ? selected.filter((item) => item !== id) : [...selected, id]);
  const formatDate = (iso: string) => new Date(iso).toLocaleDateString("fr", { day: "numeric", month: "short", year: "numeric" });
  return <><h3>Avec qui reprendre la conversation ?</h3>
    <div className="campaign-audience-tools"><label><LuSearch /><input onChange={(event) => setSearch(event.target.value)} placeholder="Rechercher..." value={search} /></label><button onClick={() => setSelected(selected.length === relations.length ? [] : relations.map((item) => item.id))} type="button">Tout sélectionner</button></div>
    <div className="campaign-audience-list">
      {relations.length === 0
        ? (search.trim()
            ? <p>Aucun résultat pour cette recherche.</p>
            : <p className="campaign-helper">Aucune conversation WhatsApp disponible pour une relance. Les relations apparaissent ici une fois qu’une conversation WhatsApp existe déjà avec ce contact — après synchronisation ou premier échange.</p>)
        : relations.map((relation) => <label key={relation.id}>
            <input checked={selected.includes(relation.id)} onChange={() => toggle(relation.id)} type="checkbox" />
            <span className="campaign-contact-avatar">{relation.name.slice(0, 2).toUpperCase()}</span>
            <span className="campaign-relation-row__meta">
              <strong>{relation.name}</strong>
              <small>{relation.company ?? "WhatsApp"}</small>
              {relation.lastMessagePreview ? <small className="campaign-relation-row__preview">{relation.lastMessageDirection === "outbound" ? "Envoyé : " : relation.lastMessageDirection === "inbound" ? "Reçu : " : ""}{relation.lastMessagePreview}</small> : null}
              {relation.lastMessageAt ? <small className="campaign-relation-row__date">{formatDate(relation.lastMessageAt)}</small> : null}
            </span>
          </label>)}
    </div>
    <p className="campaign-selected-count">{selected.length} relation(s) sélectionnée(s)</p>
  </>;
}
// Email audience. Unlike WhatsApp, an existing Conversation is NOT required
// — a first mail to an address Talvia already knows is a legitimate email
// capability (see app/lib/campaign-execution/email-executor.ts). The list
// still comes pre-filtered server-side (GET /api/campaigns/email-audience):
// only Contacts with a real, usable address appear, and the server re-checks
// that rule again before every send. Each row says which of the two it will
// be, so the user is never surprised by a mail that starts a new thread.
function WizardEmailAudience({ contacts, search, selected, setSearch, setSelected }: { contacts: EmailAudienceContact[]; search: string; selected: string[]; setSearch: (v: string) => void; setSelected: (v: string[]) => void }) {
  const toggle = (id: string) => setSelected(selected.includes(id) ? selected.filter((item) => item !== id) : [...selected, id]);
  return <><h3>À qui écrire ?</h3>
    <div className="campaign-audience-tools"><label><LuSearch /><input onChange={(event) => setSearch(event.target.value)} placeholder="Rechercher..." value={search} /></label><button onClick={() => setSelected(selected.length === contacts.length ? [] : contacts.map((item) => item.id))} type="button">Tout sélectionner</button></div>
    <div className="campaign-audience-list">
      {contacts.length === 0
        ? (search.trim()
            ? <p>Aucun résultat pour cette recherche.</p>
            : <p className="campaign-helper">Aucun contact avec une adresse e-mail exploitable. Ajoutez une adresse à un contact, ou connectez votre boîte e-mail pour importer vos conversations existantes.</p>)
        : contacts.map((contact) => <label key={contact.id}>
            <input checked={selected.includes(contact.id)} onChange={() => toggle(contact.id)} type="checkbox" />
            <span className="campaign-contact-avatar">{contact.name.slice(0, 2).toUpperCase()}</span>
            <span className="campaign-relation-row__meta">
              <strong>{contact.name}</strong>
              <small>{contact.address}</small>
              <small className="campaign-relation-row__preview">{contact.hasConversation ? "Conversation existante — la relance suivra le fil" : "Aucun échange encore — ce sera le premier e-mail"}</small>
            </span>
          </label>)}
    </div>
    <p className="campaign-selected-count">{selected.length} contact(s) sélectionné(s)</p>
  </>;
}
// Prospecting has no existing-Contact audience to pick from at this point —
// candidates come from an AI-assisted LinkedIn search run after the campaign
// exists (see CampaignDetail's prospecting panel), reviewed and approved one
// by one before anything is sent.
function WizardProspectingAudience() { return <><h3>Qui voulez-vous contacter ?</h3><p className="campaign-helper">Pour la prospection LinkedIn, Talvia proposera une liste de profils correspondant à votre Business Context une fois la campagne créée — vous choisirez ensuite qui contacter avant tout envoi.</p></>; }
function WizardSequence({ channel, isProspecting, waitDays, setWaitDays, stopOnReply, setStopOnReply }: { channel: ChannelId; isProspecting: boolean; waitDays: number; setWaitDays: (v: number) => void; stopOnReply: boolean; setStopOnReply: (v: boolean) => void }) { const label = channels.find((item) => item.id === channel)?.label; if (isProspecting) return <><h3>Construisez votre séquence</h3><div className="campaign-sequence"><div>Invitation LinkedIn</div><i>↓</i><div>Si acceptée</div><i>↓</i><div>Message 1</div><i>↓</i><div className="campaign-wait">Attendre <input min={1} onChange={(event) => setWaitDays(Number(event.target.value))} type="number" value={waitDays} /> jours</div><i>↓</i><div>Relance 1 (si aucune réponse)</div><i>↓</i><div className="campaign-wait">Attendre {waitDays} jours</div><i>↓</i><div>Relance 2 (si aucune réponse)</div><i>↓</i><div>Fin</div></div><p className="campaign-guardrail">Les invitations sont envoyées par petits lots que vous déclenchez vous-même, à un rythme sûr pour votre compte LinkedIn — jamais en continu automatiquement. Une réponse du prospect, à tout moment, arrête immédiatement la suite de la séquence.</p></>; return <><h3>Construisez votre séquence</h3><div className="campaign-sequence"><div>Message {label}</div><i>↓</i><div className="campaign-wait">Attendre <input min={1} onChange={(event) => setWaitDays(Number(event.target.value))} type="number" value={waitDays} /> jours</div><i>↓</i><div>Si aucune réponse</div><i>↓</i><div>Relance {label}</div><i>↓</i><div>Fin</div></div><label className="campaign-stop-rule"><input checked={stopOnReply} onChange={(event) => setStopOnReply(event.target.checked)} type="checkbox" /><span><strong>Arrêter la séquence lorsqu’une réponse est reçue</strong><small>Activé par défaut pour respecter vos contacts.</small></span></label>{channel === "linkedin" ? <p className="campaign-guardrail">Cadence prudente — les messages seront répartis progressivement lorsque la connexion réelle sera disponible.</p> : channel === "whatsapp" ? <p className="campaign-guardrail">WhatsApp est recommandé pour les contacts avec lesquels vous avez déjà une relation commerciale.</p> : null}</>; }
function WizardMessages({ channel, isProspecting, initial, followUp, setInitial, setFollowUp, emailSubject, setEmailSubject }: { channel: ChannelId; isProspecting: boolean; initial: string; followUp: string; setInitial: (v: string) => void; setFollowUp: (v: string) => void; emailSubject: string; setEmailSubject: (v: string) => void }) { const label = channels.find((item) => item.id === channel)?.label; if (isProspecting) return <><h3>Message envoyé une fois l’invitation acceptée</h3><p className="campaign-helper">La note d’invitation elle-même est personnalisée automatiquement par Talvia pour chaque profil. Ce message-ci part une fois la personne connectée.</p><label><span>Message</span><textarea onChange={(event) => setInitial(event.target.value)} rows={5} value={initial} /></label></>; return <><h3>Rédigez vos messages {label}</h3><p className="campaign-helper">Utilisez {"{first_name}"} et {"{company}"} pour personnaliser vos messages.</p>{channel === "gmail" ? <label><span>Objet de l’e-mail</span><input onChange={(event) => setEmailSubject(event.target.value)} placeholder="Ex. Suite à notre échange" value={emailSubject} /><small className="campaign-helper">Utilisé pour un premier e-mail. Une relance dans un fil existant garde l’objet d’origine. Talvia n’invente jamais d’objet : sans celui-ci, le premier envoi est bloqué.</small></label> : null}<label><span>Message initial</span><textarea onChange={(event) => setInitial(event.target.value)} rows={5} value={initial} /><button className="campaign-ai-placeholder" onClick={() => setInitial("Bonjour {first_name}, je souhaite échanger avec vous au sujet de {company}.")} type="button">✨ Proposer un exemple</button></label><label><span>Relance</span><textarea onChange={(event) => setFollowUp(event.target.value)} rows={4} value={followUp} /></label></>; }
function WizardReview({ name, objective, channel, contacts, waitDays }: { name: string; objective: string; channel: ChannelId; contacts?: number; waitDays: number }) { return <><h3>Vérifiez votre campagne</h3><dl className="campaign-review"><div><dt>Nom</dt><dd>{name || `${objective} via ${channels.find((item) => item.id === channel)?.label}`}</dd></div><div><dt>Objectif</dt><dd>{objective}</dd></div><div><dt>Canal</dt><dd>{channels.find((item) => item.id === channel)?.label}</dd></div><div><dt>Audience</dt><dd>{contacts === undefined ? "À choisir après création" : `${contacts} contacts`}</dd></div><div><dt>Séquence</dt><dd>{contacts === undefined ? "Invitation → Message" : `Message → ${waitDays} jours → Relance → Fin`}</dd></div></dl><p className="campaign-simulation-note">{contacts === undefined ? "Les invitations LinkedIn sont réelles une fois envoyées — rien ne part avant que vous ayez validé une liste de prospects." : "Aperçu local : aucun message n’est envoyé vers un canal externe."}</p></>; }
function CampaignDetail({ campaign, contacts, channel, onBack, onDelete, onDuplicate, onToggle }: { campaign: SandboxCampaign; contacts: Contact[]; channel?: ChannelId; onBack: () => void; onDelete: () => void; onDuplicate: () => void; onToggle: () => void }) { const participants = contacts.filter((contact) => campaign.contactIds.includes(contact.id)); const replied = Object.values(campaign.participantStatuses ?? {}).filter((status) => status === "replied").length; const isProspecting = campaign.objective === "Prospecter" && channel === "linkedin"; return <div className="campaign-detail"><button className="campaign-back" onClick={onBack} type="button"><LuArrowLeft />Retour aux campagnes</button><header className="campaign-detail__header"><div><div className="campaign-detail__title"><h1>{campaign.name}</h1><i className={`campaign-status campaign-status--${campaign.status}`}>{campaign.status}</i></div><p>{campaign.objective} · {channel ? channels.find((item) => item.id === channel)?.label : "Canal non défini"}</p></div><div><button className="connection-button connection-button--secondary" onClick={onToggle} type="button">{campaign.status === "active" ? <><Pause aria-hidden="true" size={14} />Mettre en pause</> : <><Play aria-hidden="true" size={14} />Activer</>}</button><button className="connection-button connection-button--quiet" onClick={onDuplicate} type="button"><LuCopy />Dupliquer</button><button className="connection-button connection-button--quiet" onClick={onDelete} type="button"><LuTrash2 />Archiver</button></div></header>{!isProspecting && channel !== "whatsapp" && channel !== "gmail" ? <p className="campaign-simulation-note">Simulation Talvia : aucun message n’est envoyé vers un canal externe.</p> : null}<div className="campaign-metrics"><div><span>Contacts</span><strong>{participants.length}</strong></div><div><span>Préparés</span><strong>{campaign.status === "active" || campaign.status === "paused" ? participants.length : 0}</strong></div><div><span>Réponses</span><strong>{replied}</strong></div><div><span>Terminés</span><strong>{Object.values(campaign.participantStatuses ?? {}).filter((status) => status === "completed").length}</strong></div></div><section className="campaign-detail-panel"><h2>Séquence</h2><div className="campaign-detail-sequence">{campaign.sequence.map((item, index) => <span key={`${item}-${index}`}>{item}</span>)}</div>{campaign.stopOnReply ? <p><LuCheck />La séquence est préparée pour s’arrêter après une réponse future.</p> : null}</section>{isProspecting ? <><StrategyCard campaignId={campaign.id} /><ProspectingPanel campaignId={campaign.id} campaignStatus={campaign.status} /></> : <section className="campaign-detail-panel"><h2>Audience</h2><div className="campaign-participants"><div className="campaign-participants__head"><span>Contact</span><span>Entreprise</span><span>Étape actuelle</span><span>Statut</span><span /></div>{participants.map((contact) => { const status = campaign.participantStatuses?.[contact.id] ?? "waiting"; return <div className="campaign-participant" key={contact.id}><span><b className="campaign-contact-avatar">{contact.name.slice(0, 2).toUpperCase()}</b><strong>{contact.name}</strong></span><span>{contact.company ?? "—"}</span><span>{status === "replied" ? "Séquence arrêtée" : "Message initial"}</span><span>{status === "replied" ? "Répondu" : campaign.status === "active" ? "En cours" : "En attente"}</span><span>{channel === "whatsapp" || channel === "gmail" ? "Réel" : "Simulation"}</span></div>; })}</div></section>}
{!isProspecting && (channel === "whatsapp" || channel === "gmail") ? <ConversationParticipantsPanel campaignId={campaign.id} campaignStatus={campaign.status} /> : null}</div>; }

type CandidateQualification = { score: number; fit: "strong" | "moderate" | "weak" | "insufficient_data"; reasons: string[]; uncertainties: string[]; disqualified: boolean; disqualificationReasons: string[] };
type ProspectCandidate = { id: string; providerId: string; name: string; headline?: string; company?: string; location?: string; role?: string; profileUrl?: string; status: "suggested" | "approved" | "rejected"; qualification?: CandidateQualification; participantId?: string };
type CampaignStrategy = { objective: string; targetDescription: string; targetRoles: string[]; companyTypes: string[]; industries: string[]; geography: string[]; qualificationCriteria: string[]; exclusionCriteria: string[]; reasoning: string; source: "ai_generated" | "user_edited"; validatedAt: string | null };
const FIT_LABEL: Record<CandidateQualification["fit"], string> = { strong: "Excellent fit", moderate: "Fit correct", weak: "Fit faible", insufficient_data: "Données insuffisantes" };

// "Qui cibler et pourquoi" pour CETTE campagne, proposé par Talvia à partir
// du Business Context (app/lib/campaign-strategy.ts), validé/corrigé ici
// avant que la recherche LinkedIn ne s'en serve.
function StrategyCard({ campaignId }: { campaignId: string }) {
  const [strategy, setStrategy] = useState<CampaignStrategy | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [validating, setValidating] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ targetDescription: "", targetRoles: "", industries: "", geography: "", qualificationCriteria: "", exclusionCriteria: "" });
  const [notice, setNotice] = useState("");

  const toDraft = (value: CampaignStrategy) => ({ targetDescription: value.targetDescription, targetRoles: value.targetRoles.join(", "), industries: value.industries.join(", "), geography: value.geography.join(", "), qualificationCriteria: value.qualificationCriteria.join(", "), exclusionCriteria: value.exclusionCriteria.join(", ") });

  const load = async () => {
    const response = await fetch(`/api/campaigns/${campaignId}/strategy`);
    if (response.ok) { const data = (await response.json()) as { strategy: CampaignStrategy | null }; setStrategy(data.strategy); if (data.strategy) setDraft(toDraft(data.strategy)); }
    setLoaded(true);
  };
  useEffect(() => {
    // Fetch-on-mount, same accepted pattern as ProspectingPanel's own load().
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaignId]);

  const generate = async () => {
    setGenerating(true); setNotice("");
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/strategy`, { method: "POST" });
      const data = (await response.json()) as { strategy?: CampaignStrategy; error?: string };
      if (!response.ok) { setNotice(data.error ?? "Génération impossible."); return; }
      setStrategy(data.strategy ?? null);
      if (data.strategy) setDraft(toDraft(data.strategy));
    } finally { setGenerating(false); }
  };
  const saveEdits = async () => {
    setSaving(true); setNotice("");
    try {
      const body = {
        targetDescription: draft.targetDescription,
        targetRoles: draft.targetRoles.split(",").map((value) => value.trim()).filter(Boolean),
        industries: draft.industries.split(",").map((value) => value.trim()).filter(Boolean),
        geography: draft.geography.split(",").map((value) => value.trim()).filter(Boolean),
        qualificationCriteria: draft.qualificationCriteria.split(",").map((value) => value.trim()).filter(Boolean),
        exclusionCriteria: draft.exclusionCriteria.split(",").map((value) => value.trim()).filter(Boolean),
      };
      const response = await fetch(`/api/campaigns/${campaignId}/strategy`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const data = (await response.json()) as { strategy?: CampaignStrategy; error?: string };
      if (!response.ok) { setNotice(data.error ?? "Enregistrement impossible."); return; }
      setStrategy(data.strategy ?? null);
      setEditing(false);
    } finally { setSaving(false); }
  };
  const validate = async () => {
    setValidating(true); setNotice("");
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/strategy/validate`, { method: "POST" });
      const data = (await response.json()) as { strategy?: CampaignStrategy; error?: string };
      if (!response.ok) { setNotice(data.error ?? "Validation impossible."); return; }
      setStrategy(data.strategy ?? null);
    } finally { setValidating(false); }
  };

  if (!loaded) return null;

  return <section className="campaign-detail-panel prospecting-strategy">
    <h2>Cible proposée par Talvia</h2>
    {notice ? <p className="campaign-guardrail">{notice}</p> : null}
    {!strategy ? <>
      <p className="campaign-helper">Talvia peut proposer une cible de prospection à partir de votre Business Context — vous pourrez la corriger avant toute recherche.</p>
      <button className="connection-button" disabled={generating} onClick={() => void generate()} type="button">{generating ? "Génération..." : "Proposer une cible"}</button>
    </> : editing ? <>
      <label><span>Description de la cible</span><textarea onChange={(event) => setDraft({ ...draft, targetDescription: event.target.value })} rows={3} value={draft.targetDescription} /></label>
      <label><span>Rôles recherchés (séparés par des virgules)</span><input onChange={(event) => setDraft({ ...draft, targetRoles: event.target.value })} value={draft.targetRoles} /></label>
      <label><span>Secteurs</span><input onChange={(event) => setDraft({ ...draft, industries: event.target.value })} value={draft.industries} /></label>
      <label><span>Géographie</span><input onChange={(event) => setDraft({ ...draft, geography: event.target.value })} value={draft.geography} /></label>
      <label><span>Critères de qualification</span><input onChange={(event) => setDraft({ ...draft, qualificationCriteria: event.target.value })} value={draft.qualificationCriteria} /></label>
      <label><span>Exclusions</span><input onChange={(event) => setDraft({ ...draft, exclusionCriteria: event.target.value })} value={draft.exclusionCriteria} /></label>
      <div className="campaign-wizard__actions">
        <button className="connection-button connection-button--secondary" onClick={() => setEditing(false)} type="button">Annuler</button>
        <button className="connection-button" disabled={saving} onClick={() => void saveEdits()} type="button">{saving ? "Enregistrement..." : "Enregistrer"}</button>
      </div>
    </> : <>
      <p>{strategy.targetDescription || strategy.objective}</p>
      <dl className="prospecting-strategy__facts">
        {strategy.targetRoles.length ? <div><dt>Rôles</dt><dd>{strategy.targetRoles.join(", ")}</dd></div> : null}
        {strategy.industries.length ? <div><dt>Secteurs</dt><dd>{strategy.industries.join(", ")}</dd></div> : null}
        {strategy.geography.length ? <div><dt>Géographie</dt><dd>{strategy.geography.join(", ")}<small> — utilisée pour évaluer les prospects trouvés, pas pour filtrer la recherche LinkedIn elle-même.</small></dd></div> : null}
        {strategy.qualificationCriteria.length ? <div><dt>Qualification</dt><dd>{strategy.qualificationCriteria.join(", ")}</dd></div> : null}
        {strategy.exclusionCriteria.length ? <div><dt>Exclusions</dt><dd>{strategy.exclusionCriteria.join(", ")}</dd></div> : null}
      </dl>
      {strategy.source === "user_edited" ? <small className="prospecting-strategy__badge">Corrigée par vous</small> : null}
      {strategy.validatedAt
        ? <small className="prospecting-strategy__badge prospecting-strategy__badge--validated">Stratégie validée — la recherche est autorisée</small>
        : <p className="campaign-guardrail">Cette stratégie doit être validée avant de pouvoir lancer une recherche.</p>}
      <div className="campaign-wizard__actions">
        <button className="connection-button connection-button--secondary" onClick={() => setEditing(true)} type="button">Corriger la cible</button>
        {!strategy.validatedAt ? <button className="connection-button" disabled={validating} onClick={() => void validate()} type="button">{validating ? "Validation..." : "Valider cette cible"}</button> : null}
      </div>
    </>}
  </section>;
}

// A visual "is this thing actually doing something" cue for prospecting —
// deliberately tied to real state, not decorative motion for its own sake:
// the sweep only spins fast/bright while `active` (a real search request is
// in flight); otherwise it idles slowly. Blips are the candidates already
// found, placed at a stable pseudo-random position derived from their id
// (golden-angle spacing) so they don't jitter between renders.
function ProspectingRadar({ active, candidateCount }: { active: boolean; candidateCount: number }) {
  const blips = useMemo(() => {
    const count = Math.min(candidateCount, 14);
    return Array.from({ length: count }, (_, index) => {
      const angle = (index * 137.507) % 360;
      const radiusPct = 22 + ((index * 53) % 62);
      const rad = (angle * Math.PI) / 180;
      const r = (radiusPct / 100) * 88;
      return { x: 100 + r * Math.cos(rad), y: 100 + r * Math.sin(rad), delay: (index % 6) * 0.3 };
    });
  }, [candidateCount]);

  return <div className={`prospecting-radar${active ? " is-sweeping" : ""}`} role="img" aria-label={active ? "Recherche de prospects en cours" : `${candidateCount} prospect(s) repéré(s)`}>
    <div className="prospecting-radar__sweep" />
    <svg viewBox="0 0 200 200">
      <circle className="prospecting-radar__ring" cx="100" cy="100" r="88" />
      <circle className="prospecting-radar__ring" cx="100" cy="100" r="58" />
      <circle className="prospecting-radar__ring" cx="100" cy="100" r="28" />
      <line className="prospecting-radar__crosshair" x1="100" y1="8" x2="100" y2="192" />
      <line className="prospecting-radar__crosshair" x1="8" y1="100" x2="192" y2="100" />
      {blips.map((blip, index) => <circle className="prospecting-radar__blip" cx={blip.x} cy={blip.y} key={index} r="4" style={{ animationDelay: `${blip.delay}s` }} />)}
    </svg>
  </div>;
}

type GeneratedTextState = { status: "not_generated" | "generated" | "edited" | "approved"; generatedText: string | null; editedText: string | null; approvedText: string | null; approvedAt: string | null };
type PersonalizationState = {
  evidence: { observedFacts: Array<{ type: string; value: string; source: string }>; uncertainties: string[] };
  outreachAngle: { whyContactThisPerson: string; relevantOffer: string; evidenceUsed: string[]; conversationGoal: string; tone: string } | null;
  invitation: GeneratedTextState;
  // generationMode (WhatsApp only — see app/lib/campaign-personalization.ts)
  // distinguishes a genuinely conversation-grounded proposal from a safe
  // deterministic fallback; undefined for LinkedIn artifacts and any
  // pre-C2 record, rendered as no badge at all rather than a guess.
  messages: Array<GeneratedTextState & { stepId: string; generationMode?: "ai_grounded" | "deterministic_fallback" }>;
  generatedAt: string | null;
  aiModel: string | null;
};
const TEXT_STATUS_LABEL: Record<GeneratedTextState["status"], string> = { not_generated: "non générée", generated: "générée", edited: "modifiée", approved: "approuvée" };
const GENERATION_MODE_LABEL: Record<"ai_grounded" | "deterministic_fallback", string> = {
  ai_grounded: "Basé sur votre conversation réelle avec ce contact",
  deterministic_fallback: "Personnalisation limitée — vérifiez le message avant d'approuver",
};

// Qualified Candidate -> Evidence -> Outreach Angle -> Generated text ->
// Human review -> Approved text (docs spec §1) — the executor only ever
// sends `approvedText`, never anything generated here directly (see
// app/lib/campaign-personalization.ts). Reused as-is for WhatsApp
// participants (see WhatsAppParticipantsPanel below) — the API routes it
// calls already dispatch by channel server-side, so nothing here needs to
// know which channel it's rendering for beyond `showInvitation`, since
// WhatsApp has no invitation/acceptance step at all.
function PersonalizationCard({ campaignId, candidate, showInvitation = true }: { campaignId: string; candidate: { id: string; name: string; participantId?: string }; showInvitation?: boolean }) {
  const participantId = candidate.participantId;
  const [personalization, setPersonalization] = useState<PersonalizationState | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [invitationDraft, setInvitationDraft] = useState("");
  const [messageDrafts, setMessageDrafts] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState("");

  const applyPersonalization = (value: PersonalizationState) => {
    setPersonalization(value);
    setInvitationDraft(value.invitation.editedText ?? value.invitation.generatedText ?? "");
    setMessageDrafts(Object.fromEntries(value.messages.map((entry) => [entry.stepId, entry.editedText ?? entry.generatedText ?? ""])));
  };

  const load = async () => {
    if (!participantId) { setLoaded(true); return; }
    const response = await fetch(`/api/campaigns/${campaignId}/participants/${participantId}/personalization`);
    if (response.ok) applyPersonalization((await response.json() as { personalization: PersonalizationState }).personalization);
    setLoaded(true);
  };
  useEffect(() => {
    // Fetch-on-mount, same accepted pattern as ProspectingPanel's own load().
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [participantId]);

  const generate = async () => {
    if (!participantId) return;
    setGenerating(true); setNotice("");
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/participants/${participantId}/personalization`, { method: "POST" });
      const data = (await response.json()) as { personalization?: PersonalizationState; error?: string };
      if (!response.ok) { setNotice(data.error ?? "Génération impossible."); return; }
      if (data.personalization) applyPersonalization(data.personalization);
    } finally { setGenerating(false); }
  };

  const editField = async (field: "invitation" | "message", text: string, stepId?: string) => {
    if (!participantId) return;
    setBusy(true); setNotice("");
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/participants/${participantId}/personalization`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ field, stepId, text }) });
      const data = (await response.json()) as { personalization?: PersonalizationState; error?: string };
      if (!response.ok) { setNotice(data.error ?? "Enregistrement impossible."); return; }
      if (data.personalization) applyPersonalization(data.personalization);
    } finally { setBusy(false); }
  };
  const approveField = async (field: "invitation" | "message", stepId?: string) => {
    if (!participantId) return;
    setBusy(true); setNotice("");
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/participants/${participantId}/personalization/approve`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ field, stepId }) });
      const data = (await response.json()) as { personalization?: PersonalizationState; error?: string };
      if (!response.ok) { setNotice(data.error ?? "Approbation impossible."); return; }
      if (data.personalization) applyPersonalization(data.personalization);
    } finally { setBusy(false); }
  };

  if (!loaded) return null;
  // messages[] is already ordered by step position (see
  // getParticipantPersonalization) — index 0 is the first post-acceptance
  // message, every entry after it is a follow-up in send order.
  const messageLabel = (index: number) => index === 0 ? (showInvitation ? "Message une fois l’invitation acceptée" : "Message initial") : `Relance ${index}`;
  // WhatsApp has no invitation/acceptance concept, so `invitation` never
  // leaves 'not_generated' for it (see generateWhatsAppParticipantPersonalization)
  // — gate on messages too, or a WhatsApp participant would be stuck showing
  // "Générer" forever even after a real generation succeeded.
  const notYetGenerated = !personalization || (personalization.invitation.status === "not_generated" && personalization.messages.length === 0);

  return <div className="prospecting-personalization">
    <div className="prospecting-personalization__head"><span className="campaign-contact-avatar">{candidate.name.slice(0, 2).toUpperCase()}</span><strong>{candidate.name}</strong></div>
    {notice ? <p className="campaign-guardrail">{notice}</p> : null}
    {notYetGenerated ? (
      <button className="connection-button connection-button--secondary" disabled={generating || !participantId} onClick={() => void generate()} type="button">{generating ? "Génération..." : "Générer la personnalisation"}</button>
    ) : <>
      {personalization.evidence.observedFacts.length ? <p className="campaign-helper">Fondé sur : {personalization.evidence.observedFacts.map((fact) => fact.value).join(", ")}</p> : null}
      {personalization.evidence.uncertainties.length ? <p className="campaign-helper">Non vérifié : {personalization.evidence.uncertainties.join(" ")}</p> : null}
      {personalization.outreachAngle ? <p className="campaign-helper">Angle proposé : {personalization.outreachAngle.whyContactThisPerson}</p> : null}

      {showInvitation ? <><label><span>Note d’invitation ({TEXT_STATUS_LABEL[personalization.invitation.status]})</span>
        <textarea disabled={personalization.invitation.status === "approved"} onChange={(event) => setInvitationDraft(event.target.value)} rows={2} value={invitationDraft} />
      </label>
      <div className="campaign-wizard__actions">
        {personalization.invitation.status === "approved"
          ? <small className="prospecting-strategy__badge prospecting-strategy__badge--validated">Invitation approuvée — c’est exactement ce texte qui sera envoyé</small>
          : <><button className="connection-button connection-button--secondary" disabled={busy} onClick={() => void editField("invitation", invitationDraft)} type="button">Enregistrer</button><button className="connection-button" disabled={busy} onClick={() => void approveField("invitation")} type="button">Approuver l’invitation</button></>}
      </div></> : null}

      {personalization.messages.map((message, index) => <div key={message.stepId}>
        <label><span>{messageLabel(index)} ({TEXT_STATUS_LABEL[message.status]})</span>
          <textarea disabled={message.status === "approved"} onChange={(event) => setMessageDrafts((drafts) => ({ ...drafts, [message.stepId]: event.target.value }))} rows={3} value={messageDrafts[message.stepId] ?? ""} />
        </label>
        {message.generationMode ? <p className="campaign-helper">{GENERATION_MODE_LABEL[message.generationMode]}</p> : null}
        <div className="campaign-wizard__actions">
          {message.status === "approved"
            ? <small className="prospecting-strategy__badge prospecting-strategy__badge--validated">{index === 0 ? "Message" : "Relance"} approuvé — c’est exactement ce texte qui sera envoyé</small>
            : <><button className="connection-button connection-button--secondary" disabled={busy} onClick={() => void editField("message", messageDrafts[message.stepId] ?? "", message.stepId)} type="button">Enregistrer</button><button className="connection-button" disabled={busy} onClick={() => void approveField("message", message.stepId)} type="button">Approuver</button></>}
        </div>
      </div>)}

      <button className="connection-button connection-button--quiet" disabled={generating} onClick={() => void generate()} type="button">{generating ? "Régénération..." : "Régénérer une proposition"}</button>
    </>}
  </div>;
}

type WhatsAppParticipant = { id: string; contactId: string; name: string; company?: string };

// WhatsApp participants come from Contacts already added to the campaign
// (WizardAudience, at creation) — never from campaign_prospect_candidates —
// so this reads them straight from the campaign record instead of the
// prospecting candidate list ProspectingPanel below uses. Each participant
// reuses PersonalizationCard exactly as LinkedIn does; the generate/edit/
// approve routes it calls already dispatch to the WhatsApp-appropriate
// generator server-side (see campaign-personalization.ts) — nothing here
// needs to know that.
// Shared by every channel whose participants are existing Contacts
// (WhatsApp and email today) — the personalization API routes already
// dispatch by channel server-side, so this view needs to know nothing about
// which one it is rendering. "Envoyer ce lot" runs the exact same
// runDueCampaignActions the cron sweep uses (POST .../prospecting/send is
// the engine entry point, not a LinkedIn-specific one) — a manual
// invocation of the engine, never a second send path.
function ConversationParticipantsPanel({ campaignId, campaignStatus }: { campaignId: string; campaignStatus: SandboxCampaign["status"] }) {
  const [participants, setParticipants] = useState<WhatsAppParticipant[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState("");

  const load = async () => {
    const response = await fetch(`/api/campaigns/${campaignId}`);
    if (response.ok) {
      const data = await response.json() as { campaign?: { participants: WhatsAppParticipant[] } };
      setParticipants(data.campaign?.participants ?? []);
    }
    setLoaded(true);
  };
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaignId]);

  const runBatch = async () => {
    setSending(true); setNotice("");
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/prospecting/send`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({}) });
      const data = await response.json() as { sent?: number; skipped?: number; failed?: number; error?: string };
      if (!response.ok) { setNotice(data.error ?? "Envoi impossible."); return; }
      setNotice(`${data.sent ?? 0} envoyé(s), ${data.skipped ?? 0} ignoré(s), ${data.failed ?? 0} en échec.`);
      await load();
    } finally { setSending(false); }
  };

  if (!loaded) return null;
  return <section className="campaign-detail-panel">
    <h2>Personnalisation</h2>
    {participants.length === 0
      ? <p className="campaign-helper">Aucun participant pour le moment.</p>
      : participants.map((participant) => <PersonalizationCard campaignId={campaignId} candidate={{ id: participant.id, name: participant.name, participantId: participant.id }} key={participant.id} showInvitation={false} />)}
    {participants.length > 0 ? <div className="campaign-send-batch">
      <button className="connection-button" disabled={sending || campaignStatus !== "active"} onClick={() => void runBatch()} type="button">{sending ? "Envoi…" : "Envoyer ce lot"}</button>
      <small className="campaign-helper">{campaignStatus === "active" ? "Seuls les messages approuvés partent. Une réponse arrête immédiatement la séquence du contact concerné." : "Activez la campagne pour pouvoir envoyer."}</small>
      {notice ? <p className="campaign-helper">{notice}</p> : null}
    </div> : null}
  </section>;
}

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
  const [hasSearched, setHasSearched] = useState(false);

  const load = async () => { const response = await fetch(`/api/campaigns/${campaignId}/prospecting/search`); if (response.ok) { const data = await response.json() as { candidates: ProspectCandidate[] }; setCandidates(data.candidates); if (data.candidates.length) setHasSearched(true); } };
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
      setHasSearched(true);
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
    <div className="prospecting-header">
      <ProspectingRadar active={searching} candidateCount={candidates.length} />
      <div>
        <h2>Prospects LinkedIn</h2>
        <p>{searching ? "Recherche de nouveaux profils en cours..." : campaignStatus === "active" ? "Campagne active — lancez une recherche quand vous le souhaitez." : "Activez la campagne pour envoyer les invitations une fois des prospects validés."}</p>
      </div>
    </div>
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
          <span>
            <strong>{candidate.name}</strong>
            <small>{candidate.headline ?? "Profil LinkedIn"}{candidate.company ? ` · ${candidate.company}` : ""}{candidate.location ? ` · ${candidate.location}` : ""}</small>
            {candidate.qualification?.disqualified
              ? <small className="prospecting-fit prospecting-fit--disqualified">Ne correspond pas à la cible{candidate.qualification.disqualificationReasons[0] ? ` — ${candidate.qualification.disqualificationReasons[0]}` : ""}</small>
              : candidate.qualification ? <small className={`prospecting-fit prospecting-fit--${candidate.qualification.fit}`}>{FIT_LABEL[candidate.qualification.fit]}{candidate.qualification.reasons[0] ? ` — ${candidate.qualification.reasons[0]}` : candidate.qualification.uncertainties[0] ? ` — ${candidate.qualification.uncertainties[0]}` : ""}</small> : null}
          </span>
        </label>)}
      </div>
      <p className="campaign-selected-count">{selected.length} prospect(s) sélectionné(s)</p>
      <button className="connection-button" disabled={approving || !selected.length} onClick={() => void approve()} type="button">{approving ? "Validation..." : "Valider cette sélection"}</button>
    </> : <p>{hasSearched ? "Aucun prospect trouvé pour cette recherche — essayez d’élargir vos critères." : "Aucun prospect suggéré pour l’instant — lancez une recherche."}</p>}
    {approved.length ? <div className="campaign-detail-panel__footer">
      <p>{approved.length} prospect(s) validé(s), prêt(s) à recevoir une invitation.</p>
      <button className="connection-button" disabled={sending || campaignStatus !== "active"} onClick={() => void sendBatch()} type="button"><LuSend />{sending ? "Envoi..." : "Envoyer ce lot"}</button>
      {campaignStatus !== "active" ? <small>Activez la campagne avant d’envoyer des invitations.</small> : null}
    </div> : null}
    {approved.length ? <div className="prospecting-personalization-list">
      <h3>Personnalisation par prospect</h3>
      <p className="campaign-helper">Ce qui est envoyé à chaque prospect est exactement le texte approuvé ci-dessous — jamais un texte régénéré au moment de l’envoi.</p>
      {approved.map((candidate) => <PersonalizationCard campaignId={campaignId} candidate={candidate} key={candidate.id} />)}
    </div> : null}
  </section>;
}
