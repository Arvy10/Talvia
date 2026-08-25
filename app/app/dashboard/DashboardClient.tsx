"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { LuArrowRight, LuInbox, LuMessageCircle, LuSend, LuSparkles, LuSquareActivity, LuUnplug, LuWorkflow } from "react-icons/lu";

import { ChannelLogo } from "../connections/ChannelLogo";
import { EmptyState, GlassCard, PageHeader, StatusBadge } from "../components/ui";
import MailIcon from "../components/icons/MailIcon";
import UsersGroupIcon from "../components/icons/UsersGroupIcon";
import { useSandbox } from "../state/SandboxProvider";
import { channelMap, getConnectedChannelCount } from "../inbox/inbox-model";

const shortcuts = [
  { href: "/app/inbox", label: "Inbox", description: "Centralisez les conversations lorsqu’elles arriveront.", icon: MailIcon },
  { href: "/app/contacts", label: "Contacts", description: "Vos contacts apparaîtront au fil de vos échanges.", icon: UsersGroupIcon },
  { href: "/app/automations", label: "Automatisations", description: "Préparez vos prochains flux, à votre rythme.", icon: LuWorkflow },
];

export function DashboardClient() {
  const { state } = useSandbox();
  const [businessContextReady, setBusinessContextReady] = useState<boolean | null>(null);
  const connectedCount = getConnectedChannelCount(state);
  const remainingCount = channelMap.length - connectedCount;
  const messages = state.messages ?? [];
  const activities = state.activities ?? [];
  const inbound = messages.filter((message) => message.direction === "inbound").length;
  const activeCampaigns = (state.campaigns ?? []).filter((campaign) => campaign.status === "active").length;

  useEffect(() => {
    void fetch("/api/business-context").then((response) => (response.ok ? response.json() : null)).then((data: { businessContext: { status: string } | null } | null) => {
      setBusinessContextReady(data?.businessContext?.status === "ready");
    });
  }, []);

  return <div className="dashboard-page">
    <PageHeader
      eyebrow="VUE D’ENSEMBLE"
      title="Votre suivi commercial, en un coup d’œil."
      description="Retrouvez les conversations à traiter, les prospects à relancer et les actions commerciales à poursuivre."
      actions={<Link className="connection-button" href="/app/connections"><LuUnplug aria-hidden="true" />Connexions</Link>}
    />

    {businessContextReady === false ? <GlassCard className="dashboard-bc-banner">
      <span className="dashboard-bc-banner__icon" aria-hidden="true"><LuSparkles /></span>
      <div><h2>Configurez le profil de votre entreprise</h2><p>Talvia peut analyser votre site web pour préparer un profil utile à vos échanges commerciaux.</p></div>
      <Link className="connection-button" href="/app/onboarding">Configurer<LuArrowRight aria-hidden="true" /></Link>
    </GlassCard> : null}

    <GlassCard className="dashboard-setup">
      <div className="dashboard-setup__intro">
        <p className="dashboard-kicker">MISE EN PLACE</p>
        <h2>Un espace prêt à structurer votre suivi.</h2>
        <p>Configurez vos canaux, puis organisez vos conversations, contacts et opportunités à votre rythme.</p>
      </div>
      <div className="dashboard-setup__progress" aria-label={`${connectedCount} canaux connectés sur ${channelMap.length}`}>
        <div className="dashboard-progress-label"><strong>{connectedCount} sur {channelMap.length} canaux configurés</strong><span>{remainingCount === 0 ? "Votre espace est prêt à accueillir vos premiers échanges." : `${remainingCount} canal(x) à configurer pour compléter votre espace.`}</span></div>
        <div aria-hidden="true" className="dashboard-progress-track"><span style={{ width: `${(connectedCount / channelMap.length) * 100}%` }} /></div>
        <div className="dashboard-channel-statuses">
          {channelMap.map(({ id, label }) => <div className="dashboard-channel-status" key={id}>
            <ChannelLogo channel={id} />
            <span>{label}</span>
            <StatusBadge status={state.connections[id].status} />
          </div>)}
        </div>
      </div>
    </GlassCard>

    <section aria-label="Vos prochains espaces" className="dashboard-shortcuts">
      {shortcuts.map(({ href, label, description, icon: Icon }) => <Link className="dashboard-shortcut" href={href} key={href}>
        <span className="dashboard-shortcut__icon"><Icon aria-hidden="true" /></span>
        <div><h2>{label}</h2><p>{description}</p></div>
        <LuArrowRight aria-hidden="true" className="dashboard-shortcut__arrow" />
      </Link>)}
    </section>

    <section className="dashboard-priority-grid">
      <GlassCard className="dashboard-priority-card dashboard-priority-card--coral"><span className="dashboard-priority-card__icon" aria-hidden="true"><LuMessageCircle /></span><span>À répondre</span><strong>{inbound}</strong><p>Conversations entrantes à traiter</p></GlassCard>
      <GlassCard className="dashboard-priority-card dashboard-priority-card--violet"><span className="dashboard-priority-card__icon" aria-hidden="true"><LuSend /></span><span>Campagnes actives</span><strong>{activeCampaigns}</strong><p>Campagnes actuellement en cours</p></GlassCard>
      <GlassCard className="dashboard-priority-card dashboard-priority-card--green"><span className="dashboard-priority-card__icon" aria-hidden="true"><LuSquareActivity /></span><span>Activité récente</span><strong>{activities.length}</strong><p>Actions enregistrées dans votre espace</p></GlassCard>
    </section>
    {activities.length === 0 ? <EmptyState className="dashboard-summary-empty" icon={<LuInbox />} title="Vos priorités apparaîtront ici" description="Ajoutez un contact, créez une campagne ou démarrez une conversation pour construire votre suivi commercial." /> : <GlassCard className="dashboard-activity"><p className="dashboard-kicker">ACTIVITÉ RÉCENTE</p>{activities.slice(-6).reverse().map((activity) => <div key={activity.id}><span>{activity.label}</span><small>Enregistrée</small></div>)}</GlassCard>}
  </div>;
}
