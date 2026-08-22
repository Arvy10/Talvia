"use client";

import { useState, type FormEvent } from "react";
import { LuBolt, LuPlus, LuWorkflow } from "react-icons/lu";

import { Dialog } from "../components/Dialog";
import { EmptyState, GlassCard, PageHeader } from "../components/ui";
import { ChannelLogo } from "../connections/ChannelLogo";
import { useSandbox } from "../state/SandboxProvider";
import type { ChannelId } from "../state/types";
import { AUTOMATION_TEMPLATES, type AutomationTemplate } from "./templates";

const channels: Array<{ id: ChannelId; label: string }> = [
  { id: "linkedin", label: "LinkedIn" },
  { id: "whatsapp", label: "WhatsApp" },
  { id: "gmail", label: "Gmail" },
];

type AutomationForm = {
  name: string;
  trigger: string;
  channel: ChannelId;
  action: string;
  enabled: boolean;
};

const emptyForm: AutomationForm = {
  name: "",
  trigger: "",
  channel: "linkedin",
  action: "",
  enabled: true,
};

function getAutomationValue(automation: Record<string, unknown>, key: string) {
  return typeof automation[key] === "string" ? automation[key] : "";
}

export function AutomationsClient() {
  const { dispatch, state } = useSandbox();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [form, setForm] = useState<AutomationForm>(emptyForm);
  const [nameError, setNameError] = useState("");

  const closeDialog = () => {
    setIsDialogOpen(false);
    setForm(emptyForm);
    setNameError("");
  };

  const openBuilder = (template?: AutomationTemplate) => {
    setForm(template ? {
      name: template.title,
      trigger: template.trigger,
      channel: template.channel,
      action: template.action,
      enabled: true,
    } : emptyForm);
    setNameError("");
    setIsDialogOpen(true);
  };

  const submitAutomation = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = form.name.trim();
    if (!name) {
      setNameError("Donnez un nom à cette automatisation avant de l’enregistrer.");
      return;
    }

    dispatch({
      type: "CREATE_AUTOMATION",
      automation: {
        id: crypto.randomUUID(),
        name,
        trigger: form.trigger.trim(),
        channel: form.channel,
        action: form.action.trim(),
        enabled: form.enabled,
      },
    });
    closeDialog();
  };

  return <div className="automations-page">
    <PageHeader
      eyebrow="Flux de travail"
      title="Automatisations"
      description="Créez des flux adaptés à vos essais. Rien n’est lancé ni rempli tant que vous ne le configurez pas."
      actions={<button className="connection-button" onClick={() => openBuilder()} type="button"><LuPlus aria-hidden="true" />Nouvelle automatisation</button>}
    />

    <section aria-labelledby="your-automations-title" className="automations-region">
      <div className="automations-region__heading">
        <div><p>VOS CONFIGURATIONS</p><h2 id="your-automations-title">Vos automatisations</h2></div>
        <span>{state.automations.length}</span>
      </div>
      {state.automations.length === 0 ? <EmptyState
        className="automations-empty"
        icon={<LuWorkflow />}
        title="Aucune automatisation"
        description="Vos flux apparaîtront ici après leur configuration dans le bac à sable."
        action={<button className="connection-button connection-button--secondary" onClick={() => openBuilder()} type="button">Configurer un flux</button>}
      /> : <div className="automations-list">
        {state.automations.map((automation) => {
          const channel = getAutomationValue(automation, "channel") as ChannelId;
          const enabled = automation.enabled === true;
          return <GlassCard className="automation-card" key={automation.id}>
            <div className="automation-card__heading">
              {channels.some(({ id }) => id === channel) ? <ChannelLogo channel={channel} /> : null}
              <div><h3>{getAutomationValue(automation, "name") || "Automatisation sans nom"}</h3><span>{enabled ? "Activée" : "Désactivée"}</span></div>
            </div>
            <dl>
              <div><dt>Déclencheur</dt><dd>{getAutomationValue(automation, "trigger") || "À définir"}</dd></div>
              <div><dt>Action</dt><dd>{getAutomationValue(automation, "action") || "À définir"}</dd></div>
            </dl>
          </GlassCard>;
        })}
      </div>}
    </section>

    <section aria-labelledby="template-library-title" className="automation-template-library">
      <div className="automations-region__heading">
        <div><p>BIBLIOTHÈQUE PRODUIT</p><h2 id="template-library-title">Modèles de capacités</h2></div>
      </div>
      <p className="automation-template-library__intro">Ces exemples décrivent des capacités de Talvia. Ils ne créent aucun flux, destinataire ou résultat.</p>
      <div className="automation-template-grid">
        {AUTOMATION_TEMPLATES.map((template) => <GlassCard className="automation-template-card" key={template.id}>
          <div className="automation-card__heading"><ChannelLogo channel={template.channel} /><div><h3>{template.title}</h3><span>{channels.find(({ id }) => id === template.channel)?.label}</span></div></div>
          <p>{template.description}</p>
          <dl>
            <div><dt>Déclencheur</dt><dd>{template.trigger}</dd></div>
            <div><dt>Action</dt><dd>{template.action}</dd></div>
          </dl>
          <button className="connection-button connection-button--secondary" onClick={() => openBuilder(template)} type="button"><LuBolt aria-hidden="true" />Utiliser ce modèle</button>
        </GlassCard>)}
      </div>
    </section>

    <Dialog
      description="Le flux restera local à votre bac à sable jusqu’à sa réinitialisation."
      onClose={closeDialog}
      open={isDialogOpen}
      title="Configurer une automatisation"
    >
      <form className="workspace-form" onSubmit={submitAutomation}>
        <label>
          <span>Nom <em aria-hidden="true">*</em></span>
          <input aria-describedby={nameError ? "automation-name-error" : undefined} autoFocus onChange={(event) => { setForm({ ...form, name: event.target.value }); setNameError(""); }} value={form.name} />
          {nameError ? <small id="automation-name-error" role="alert">{nameError}</small> : null}
        </label>
        <label><span>Déclencheur</span><input onChange={(event) => setForm({ ...form, trigger: event.target.value })} placeholder="Ex. Message reçu" value={form.trigger} /></label>
        <label><span>Canal</span><select onChange={(event) => setForm({ ...form, channel: event.target.value as ChannelId })} value={form.channel}>{channels.map(({ id, label }) => <option key={id} value={id}>{label}</option>)}</select></label>
        <label><span>Action</span><input onChange={(event) => setForm({ ...form, action: event.target.value })} placeholder="Ex. Préparer un brouillon" value={form.action} /></label>
        <label className="automation-enabled"><input checked={form.enabled} onChange={(event) => setForm({ ...form, enabled: event.target.checked })} type="checkbox" /><span>Activer cette automatisation</span></label>
        <div className="workspace-form__actions"><button className="connection-button connection-button--secondary" onClick={closeDialog} type="button">Annuler</button><button className="connection-button" type="submit">Enregistrer</button></div>
      </form>
    </Dialog>
  </div>;
}
