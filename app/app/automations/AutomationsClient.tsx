"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { LuBolt, LuCopy, LuPencil, LuPlay, LuPlus, LuPower, LuTrash2, LuWorkflow } from "react-icons/lu";
import { Dialog } from "../components/Dialog";
import { EmptyState, PageHeader } from "../components/ui";
import { ChannelLogo } from "../connections/ChannelLogo";
import type { ChannelId } from "../state/types";
import { AUTOMATION_TEMPLATES, type AutomationTemplate } from "./templates";

type Status = "active" | "inactive" | "archived";
type Automation = {
  id: string; name: string; status: Status; triggerType: string;
  triggerConfig: Record<string, unknown>; conditionConfig: Record<string, unknown>;
  actionType: string; actionConfig: Record<string, unknown>; replyMode?: "draft" | "auto";
  delaySeconds: number; lastRunAt?: string; lastRunStatus?: string;
};
type Run = { id: string; trigger_type: string; status: "success" | "failed" | "skipped"; result_summary?: string | null; error_message?: string | null; created_at: string };
const events = [
  { id: "message.received", label: "Un nouveau message est reçu" },
  { id: "campaign.contact_replied", label: "Un contact répond à une campagne" },
  { id: "opportunity.stage_changed", label: "Une opportunité passe à Proposition" },
  { id: "opportunity.created", label: "Une opportunité est créée" },
  { id: "contact.created", label: "Un contact est ajouté" },
] as const;
const actions = [
  { id: "stop_campaign_participant", label: "Arrêter la séquence pour ce contact" },
  { id: "create_next_action", label: "Créer une prochaine action" },
  { id: "mark_conversation_to_process", label: "Marquer la conversation à traiter" },
  { id: "create_reply_draft", label: "Préparer un brouillon de réponse" },
] as const;
type Form = { name: string; event: typeof events[number]["id"]; action: typeof actions[number]["id"]; channel: ChannelId; condition: "" | "campaign" | "qualified"; enabled: boolean; replyMode: "draft" | "auto"; delayMinutes: string };
const blank: Form = { name: "", event: "message.received", action: "mark_conversation_to_process", channel: "linkedin", condition: "", enabled: true, replyMode: "draft", delayMinutes: "2" };

const toUiChannel = (value: unknown): ChannelId => value === "email" ? "gmail" : value === "whatsapp" ? "whatsapp" : "linkedin";
const toApiChannel = (value: ChannelId) => value === "gmail" ? "email" : value;
const eventLabel = (value: string) => events.find((item) => item.id === value)?.label ?? value;
const actionLabel = (value: string) => actions.find((item) => item.id === value)?.label ?? value;
const conditionToConfig = (value: Form["condition"]) => value === "campaign" ? { campaign: true } : value === "qualified" ? { status: "qualified" } : {};
const configToCondition = (value: Record<string, unknown>): Form["condition"] => value.campaign === true ? "campaign" : value.status === "qualified" ? "qualified" : "";
const templateEvent = (template: AutomationTemplate): Form["event"] => template.event === "campaign_reply" ? "campaign.contact_replied" : template.event === "opportunity_proposal" ? "opportunity.stage_changed" : "message.received";
const templateAction = (template: AutomationTemplate): Form["action"] => ({ stop_campaign: "stop_campaign_participant", create_follow_up: "create_next_action", mark_priority: "mark_conversation_to_process", prepare_draft: "create_reply_draft" }[template.action] ?? "mark_conversation_to_process") as Form["action"];

async function responseJson<T>(response: Response): Promise<T> {
  const payload = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(payload.error ?? "Une erreur est survenue.");
  return payload;
}

export function AutomationsClient() {
  const [tab, setTab] = useState<"mine" | "templates">("mine");
  const [automations, setAutomations] = useState<Automation[]>([]);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState<Form>(blank);
  const [selected, setSelected] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [runs, setRuns] = useState<Run[]>([]);
  const [error, setError] = useState("");
  const [testResult, setTestResult] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const current = useMemo(() => automations.find((item) => item.id === selected) ?? null, [automations, selected]);

  const refresh = async () => {
    setLoading(true);
    try {
      const payload = await responseJson<{ automations: Automation[] }>(await fetch("/api/automations", { cache: "no-store" }));
      setAutomations(payload.automations);
      setError("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Chargement impossible."); }
    finally { setLoading(false); }
  };
  const loadRuns = async (id: string) => {
    try {
      const payload = await responseJson<{ runs: Run[] }>(await fetch(`/api/automations/${id}/runs`, { cache: "no-store" }));
      setRuns(payload.runs);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Historique indisponible."); }
  };
  useEffect(() => { void refresh(); }, []);
  useEffect(() => {
    if (!selected) { setRuns([]); return; }
    void loadRuns(selected);
  }, [selected]);

  const open = (template?: AutomationTemplate, automation?: Automation) => {
    setEditing(automation?.id ?? null);
    setForm(automation ? {
      name: automation.name,
      event: events.some((item) => item.id === automation.triggerType) ? automation.triggerType as Form["event"] : "message.received",
      action: actions.some((item) => item.id === automation.actionType) ? automation.actionType as Form["action"] : "mark_conversation_to_process",
      channel: toUiChannel(automation.triggerConfig.channel), condition: configToCondition(automation.conditionConfig),
      enabled: automation.status === "active", replyMode: automation.replyMode ?? "draft",
      delayMinutes: String(Math.round(automation.delaySeconds / 60)),
    } : template ? { ...blank, name: template.title, event: templateEvent(template), action: templateAction(template), channel: template.channel } : blank);
    setError(""); setFormOpen(true);
  };
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!form.name.trim()) { setError("Donnez un nom à cette automatisation."); return; }
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(), status: form.enabled ? "active" : "inactive", triggerType: form.event,
        triggerConfig: { channel: toApiChannel(form.channel) }, conditionConfig: conditionToConfig(form.condition),
        actionType: form.action, actionConfig: {},
        replyMode: form.action === "create_reply_draft" ? form.replyMode : undefined,
        delaySeconds: Math.max(0, Number(form.delayMinutes) || 0) * 60,
      };
      await responseJson(await fetch(editing ? `/api/automations/${editing}` : "/api/automations", {
        method: editing ? "PATCH" : "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload),
      }));
      setFormOpen(false); await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Enregistrement impossible."); }
    finally { setSaving(false); }
  };
  const patch = async (automation: Automation, changes: Record<string, unknown>) => {
    try {
      await responseJson(await fetch(`/api/automations/${automation.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(changes) }));
      await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Mise à jour impossible."); }
  };
  const duplicate = async (automation: Automation) => {
    try { await responseJson(await fetch(`/api/automations/${automation.id}/duplicate`, { method: "POST" })); await refresh(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Duplication impossible."); }
  };
  const archive = async () => {
    if (!deleting) return;
    try {
      await responseJson(await fetch(`/api/automations/${deleting}`, { method: "DELETE" }));
      if (selected === deleting) setSelected(null);
      setDeleting(null); await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Archivage impossible."); }
  };
  const test = async (automation: Automation) => {
    try {
      const payload = await responseJson<{ run: Run }>(await fetch(`/api/automations/${automation.id}/test`, { method: "POST" }));
      setTestResult(payload.run.status === "success" ? "Test exécuté avec succès par le moteur." : "Test exécuté : consultez le résultat dans l’historique.");
      await Promise.all([refresh(), loadRuns(automation.id)]);
    } catch (cause) { setTestResult(cause instanceof Error ? cause.message : "Test impossible."); }
  };

  return <div className="automations-page automations-page--v2">
    <PageHeader title="Automatisations" description="Automatisez les tâches répétitives et laissez Talvia gérer les actions simples à votre place." actions={<button className="connection-button" onClick={() => open()} type="button"><LuPlus />Nouvelle automatisation</button>} />
    <div className="automation-tabs"><button className={tab === "mine" ? "is-active" : ""} onClick={() => setTab("mine")} type="button">Mes automatisations <span>{automations.length}</span></button><button className={tab === "templates" ? "is-active" : ""} onClick={() => setTab("templates")} type="button">Templates</button></div>
    {error && !formOpen ? <p className="form-error" role="alert">{error}</p> : null}
    {tab === "mine" ? loading ? <p className="automation-loading">Chargement des automatisations…</p> : automations.length ? <div className="automation-rule-list">
      {automations.map((automation) => <article className="automation-rule" key={automation.id}>
        <button className="automation-rule__body" onClick={() => setSelected(automation.id)} type="button"><ChannelLogo channel={toUiChannel(automation.triggerConfig.channel)} /><div><strong>{automation.name}</strong><p><span>Quand</span>{eventLabel(automation.triggerType)}<i>→</i><span>Alors</span>{actionLabel(automation.actionType)}</p></div><em className={automation.status === "active" ? "is-active" : ""}>{automation.status === "active" ? "Active" : "Inactive"}</em><small>{automation.lastRunAt ? `Exécutée le ${new Date(automation.lastRunAt).toLocaleDateString("fr")}` : "Jamais exécutée"}</small></button>
        <div className="automation-rule__actions"><button aria-label="Activer ou désactiver" onClick={() => void patch(automation, { status: automation.status === "active" ? "inactive" : "active" })} type="button"><LuPower /></button><button aria-label="Dupliquer" onClick={() => void duplicate(automation)} type="button"><LuCopy /></button><button aria-label="Modifier" onClick={() => open(undefined, automation)} type="button"><LuPencil /></button><button aria-label="Archiver" onClick={() => setDeleting(automation.id)} type="button"><LuTrash2 /></button></div>
      </article>)}
    </div> : <EmptyState icon={<LuWorkflow />} title="Aucune automatisation active" description="Automatisez vos tâches commerciales répétitives pour gagner du temps et éviter les oublis." action={<div className="automation-empty-actions"><button className="connection-button" onClick={() => open()} type="button">Créer une automatisation</button><button className="connection-button connection-button--secondary" onClick={() => setTab("templates")} type="button">Découvrir les modèles</button></div>} /> : <div className="automation-template-grid">
      {AUTOMATION_TEMPLATES.map((template) => <article className="automation-template-card" key={template.id}><ChannelLogo channel={template.channel} /><h2>{template.title}</h2><p>{template.description}</p><dl><div><dt>Quand</dt><dd>{template.trigger}</dd></div><div><dt>Alors</dt><dd>{template.action}</dd></div></dl><button className="connection-button connection-button--secondary" onClick={() => open(template)} type="button"><LuBolt />Utiliser ce modèle</button></article>)}
    </div>}
    <AutomationDetail automation={current} onClose={() => { setSelected(null); setTestResult(""); }} onEdit={() => current && open(undefined, current)} onTest={() => current && void test(current)} result={testResult} runs={runs} />
    <Dialog description="Cette règle est enregistrée dans votre espace de travail Talvia." onClose={() => setFormOpen(false)} open={formOpen} title={editing ? "Modifier l’automatisation" : "Nouvelle automatisation"}>
      <form className="workspace-form automation-builder" onSubmit={(event) => void save(event)}>
        <label><span>Nom *</span><input autoFocus onChange={(event) => setForm({ ...form, name: event.target.value })} value={form.name} /></label>
        <label><span>Quand</span><select onChange={(event) => setForm({ ...form, event: event.target.value as Form["event"] })} value={form.event}>{events.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
        <label><span>Sur</span><select onChange={(event) => setForm({ ...form, channel: event.target.value as ChannelId })} value={form.channel}><option value="linkedin">LinkedIn</option><option value="whatsapp">WhatsApp</option><option value="gmail">Email</option></select></label>
        <label><span>Si (facultatif)</span><select onChange={(event) => setForm({ ...form, condition: event.target.value as Form["condition"] })} value={form.condition}><option value="">Aucune condition</option><option value="campaign">La conversation appartient à une campagne</option><option value="qualified">Le contact est qualifié</option></select></label>
        <label><span>Alors</span><select onChange={(event) => setForm({ ...form, action: event.target.value as Form["action"] })} value={form.action}>{actions.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
        {form.action === "create_reply_draft" ? <fieldset><legend>Préparation de réponse</legend><label><span>Mode de réponse</span><select onChange={(event) => setForm({ ...form, replyMode: event.target.value as Form["replyMode"] })} value={form.replyMode}><option value="draft">Brouillon à valider</option><option value="auto">Exécution locale de test</option></select></label><label><span>Délai avant action (minutes)</span><input min="0" onChange={(event) => setForm({ ...form, delayMinutes: event.target.value })} type="number" value={form.delayMinutes} /></label><p className="automation-simulation">Aucun message n’est envoyé vers un canal externe pendant cette étape.</p></fieldset> : null}
        <label className="automation-enabled"><input checked={form.enabled} onChange={(event) => setForm({ ...form, enabled: event.target.checked })} type="checkbox" /><span>Activer cette automatisation</span></label>{error ? <small role="alert">{error}</small> : null}
        <div className="workspace-form__actions"><button className="connection-button connection-button--secondary" onClick={() => setFormOpen(false)} type="button">Annuler</button><button className="connection-button" disabled={saving} type="submit">{saving ? "Enregistrement…" : "Enregistrer"}</button></div>
      </form>
    </Dialog>
    <Dialog description="L’automatisation sera archivée. Son historique reste conservé." onClose={() => setDeleting(null)} open={!!deleting} title="Archiver cette automatisation ?"><div className="workspace-form"><div className="workspace-form__actions"><button className="connection-button connection-button--secondary" onClick={() => setDeleting(null)} type="button">Annuler</button><button className="connection-button connection-button--danger" onClick={() => void archive()} type="button">Archiver</button></div></div></Dialog>
  </div>;
}

function AutomationDetail({ automation, onClose, onEdit, onTest, result, runs }: { automation: Automation | null; onClose: () => void; onEdit: () => void; onTest: () => void; result: string; runs: Run[] }) {
  if (!automation) return null;
  return <div className="automation-detail-layer"><button aria-label="Fermer la fiche" onClick={onClose} type="button" /><aside><header><div><p>RÈGLE TALVIA</p><h2>{automation.name}</h2><span>Quand {eventLabel(automation.triggerType).toLowerCase()}, alors {actionLabel(automation.actionType).toLowerCase()}.</span></div><button onClick={onClose} type="button">×</button></header><section><h3>Statut</h3><p>{automation.status === "active" ? "Active" : "Inactive"}</p><button className="connection-button connection-button--secondary" onClick={onEdit} type="button"><LuPencil />Modifier</button><button className="connection-button" onClick={onTest} type="button"><LuPlay />Exécuter un test</button>{result ? <small>{result}</small> : null}</section><section><h3>Historique</h3>{runs.length ? runs.map((run) => <p key={run.id}><strong>{run.status === "success" ? "Exécution réussie" : run.status === "failed" ? "Exécution en échec" : "Exécution ignorée"}</strong>{run.result_summary ?? run.error_message ?? eventLabel(run.trigger_type)}<small>{new Date(run.created_at).toLocaleString("fr")}</small></p>) : <p>Aucune exécution enregistrée.</p>}</section></aside></div>;
}
