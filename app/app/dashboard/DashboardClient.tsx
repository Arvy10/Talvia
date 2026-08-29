"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { LuArrowRight, LuInbox, LuMessageCircle, LuSend, LuSparkles, LuSquareActivity, LuUnplug, LuWorkflow } from "react-icons/lu";

import { ChannelLogo } from "../connections/ChannelLogo";
import { EmptyState, GlassCard, StatusBadge } from "../components/ui";
import MailIcon from "../components/icons/MailIcon";
import PlugConnectedIcon from "../components/icons/PlugConnectedIcon";
import UsersGroupIcon from "../components/icons/UsersGroupIcon";
import { useSandbox } from "../state/SandboxProvider";
import { apiChannelToUi, channelMap, type InboxApiChannel } from "../inbox/inbox-model";
import type { ChannelId, ConnectionStatus } from "../state/types";
import { useUserIdentity } from "../components/useUserIdentity";

type ApiConnection = { channel_type: InboxApiChannel; status: ConnectionStatus };

const shortcuts = [
  { href: "/app/inbox", label: "Inbox", description: "Centralisez les conversations lorsqu’elles arriveront.", icon: MailIcon },
  { href: "/app/contacts", label: "Contacts", description: "Vos contacts apparaîtront au fil de vos échanges.", icon: UsersGroupIcon },
  { href: "/app/automations", label: "Automatisations", description: "Préparez vos prochains flux, à votre rythme.", icon: LuWorkflow },
];

function greeting(hour: number): string {
  if (hour < 5) return "Bonsoir";
  if (hour < 12) return "Bonjour";
  if (hour < 18) return "Bon après-midi";
  return "Bonsoir";
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}

export function DashboardClient() {
  const { state } = useSandbox();
  const identity = useUserIdentity();
  const [businessContextReady, setBusinessContextReady] = useState<boolean | null>(null);
  const [now, setNow] = useState<Date | null>(null);
  // Real, database-backed connection status — the sandbox's `state.connections`
  // is local demo state that never reflects an actual Unipile connection, which
  // is why this widget could show "0 sur 3" for an account that's really connected.
  const [connectionStatus, setConnectionStatus] = useState<Record<ChannelId, ConnectionStatus>>({ linkedin: "disconnected", whatsapp: "disconnected", gmail: "disconnected" });

  const connectedCount = channelMap.filter(({ id }) => connectionStatus[id] === "connected").length;
  const remainingCount = channelMap.length - connectedCount;
  const messages = state.messages ?? [];
  const activities = state.activities ?? [];
  const inbound = messages.filter((message) => message.direction === "inbound").length;
  const activeCampaigns = (state.campaigns ?? []).filter((campaign) => campaign.status === "active").length;

  useEffect(() => {
    setNow(new Date());
    void fetch("/api/business-context").then((response) => (response.ok ? response.json() : null)).then((data: { businessContext: { status: string } | null } | null) => {
      setBusinessContextReady(data?.businessContext?.status === "ready");
    });
    void fetch("/api/connections").then((response) => (response.ok ? response.json() : null)).then((data: { connections: ApiConnection[] } | null) => {
      if (!data) return;
      setConnectionStatus((current) => {
        const next = { ...current };
        for (const connection of data.connections) next[apiChannelToUi(connection.channel_type)] = connection.status;
        return next;
      });
    });
  }, []);

  const dateLabel = useMemo(() => (now ? now.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" }) : ""), [now]);
  const updatedAtLabel = now ? `Actualisé à ${formatTime(now)}` : "";

  return <div className="dashboard-page">
    <header className="dashboard-brief">
      <p className="dashboard-brief__eyebrow">Brief quotidien</p>
      <div className="dashboard-brief__head">
        <div>
          <h1>{greeting(now?.getHours() ?? 12)}{identity.firstName ? `, ${identity.firstName}` : ""}.</h1>
          {dateLabel ? <p className="dashboard-brief__date">Nous sommes le {dateLabel}.</p> : null}
        </div>
        <Link className="connection-button" href="/app/connections"><LuUnplug aria-hidden="true" />Connexions</Link>
      </div>
      <p className="dashboard-brief__tagline">Votre suivi commercial, en un coup d’œil.</p>
      <p className="dashboard-brief__description">Retrouvez les conversations à traiter, les prospects à relancer et les actions commerciales à poursuivre.</p>
    </header>

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
            <StatusBadge status={connectionStatus[id]} />
          </div>)}
        </div>
      </div>
    </GlassCard>

    <section aria-label="Indicateurs du jour" className="dashboard-stats-grid">
      <GlassCard className="dashboard-stat-card">
        <div className="dashboard-stat-card__head"><span className="dashboard-stat-card__icon dashboard-stat-card__icon--violet" aria-hidden="true"><PlugConnectedIcon size={15} /></span><span>Canaux connectés</span></div>
        <strong>{connectedCount}<small>/{channelMap.length}</small></strong>
        <p>{updatedAtLabel}</p>
      </GlassCard>
      <GlassCard className="dashboard-stat-card">
        <div className="dashboard-stat-card__head"><span className="dashboard-stat-card__icon dashboard-stat-card__icon--coral" aria-hidden="true"><LuMessageCircle /></span><span>À répondre</span></div>
        <strong>{inbound}</strong>
        <p>{updatedAtLabel}</p>
      </GlassCard>
      <GlassCard className="dashboard-stat-card">
        <div className="dashboard-stat-card__head"><span className="dashboard-stat-card__icon dashboard-stat-card__icon--violet" aria-hidden="true"><LuSend /></span><span>Campagnes actives</span></div>
        <strong>{activeCampaigns}</strong>
        <p>{updatedAtLabel}</p>
      </GlassCard>
      <GlassCard className="dashboard-stat-card">
        <div className="dashboard-stat-card__head"><span className="dashboard-stat-card__icon dashboard-stat-card__icon--green" aria-hidden="true"><LuSquareActivity /></span><span>Activité récente</span></div>
        <strong>{activities.length}</strong>
        <p>{updatedAtLabel}</p>
      </GlassCard>
    </section>

    <div className="dashboard-secondary-grid">
      <GlassCard className="dashboard-secondary-card">
        <div className="dashboard-secondary-card__head"><h2>Conversations à traiter</h2><Link href="/app/inbox">Inbox<LuArrowRight aria-hidden="true" /></Link></div>
        {inbound === 0 ? <EmptyState className="dashboard-secondary-card__empty" icon={<LuInbox />} title="Rien à traiter" description="Les conversations entrantes de vos canaux connectés apparaîtront ici." /> : <p className="dashboard-secondary-card__count">{inbound} conversation{inbound > 1 ? "s" : ""} en attente de réponse.</p>}
      </GlassCard>
      <GlassCard className="dashboard-secondary-card">
        <div className="dashboard-secondary-card__head"><h2>Activité récente</h2></div>
        {activities.length === 0 ? <EmptyState className="dashboard-secondary-card__empty" icon={<LuSquareActivity />} title="Vos priorités apparaîtront ici" description="Ajoutez un contact, créez une campagne ou démarrez une conversation pour construire votre suivi." /> : <ul className="dashboard-secondary-card__list">{activities.slice(-6).reverse().map((activity) => <li key={activity.id}><span>{activity.label}</span><small>Enregistrée</small></li>)}</ul>}
      </GlassCard>
    </div>

    <section aria-label="Vos prochains espaces" className="dashboard-shortcuts">
      {shortcuts.map(({ href, label, description, icon: Icon }) => <Link className="dashboard-shortcut" href={href} key={href}>
        <span className="dashboard-shortcut__icon"><Icon aria-hidden="true" /></span>
        <div><h2>{label}</h2><p>{description}</p></div>
        <LuArrowRight aria-hidden="true" className="dashboard-shortcut__arrow" />
      </Link>)}
    </section>
  </div>;
}
