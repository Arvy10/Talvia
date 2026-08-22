"use client";

import Link from "next/link";
import { LuArrowRight, LuInbox, LuUnplug, LuUsers, LuWorkflow } from "react-icons/lu";

import { ChannelLogo } from "../connections/ChannelLogo";
import { EmptyState, GlassCard, PageHeader, StatusBadge } from "../components/ui";
import { useSandbox } from "../state/SandboxProvider";
import { channelMap, getConnectedChannelCount } from "../inbox/inbox-model";

const shortcuts = [
  { href: "/app/inbox", label: "Inbox", description: "Centralisez les conversations lorsqu’elles arriveront.", icon: LuInbox },
  { href: "/app/contacts", label: "Contacts", description: "Vos contacts apparaîtront au fil de vos échanges.", icon: LuUsers },
  { href: "/app/automations", label: "Automatisations", description: "Préparez vos prochains flux, à votre rythme.", icon: LuWorkflow },
];

export function DashboardClient() {
  const { state } = useSandbox();
  const connectedCount = getConnectedChannelCount(state);
  const remainingCount = channelMap.length - connectedCount;

  return <div className="dashboard-page">
    <PageHeader
      eyebrow="Aujourd’hui"
      title="Votre espace commercial commence ici."
      description="Reliez vos canaux pour retrouver chaque conversation au même endroit, sans inventer d’activité avant vos premiers échanges."
      actions={<Link className="connection-button" href="/app/connections"><LuUnplug aria-hidden="true" />Connexions</Link>}
    />

    <GlassCard className="dashboard-setup">
      <div className="dashboard-setup__intro">
        <p className="dashboard-kicker">MISE EN PLACE</p>
        <h2>Une inbox prête quand vous l’êtes.</h2>
        <p>Choisissez les canaux à relier. Talvia ne créera ni messages, ni contacts, ni activité de démonstration.</p>
      </div>
      <div className="dashboard-setup__progress" aria-label={`${connectedCount} canaux connectés sur ${channelMap.length}`}>
        <div className="dashboard-progress-label"><strong>{connectedCount} sur {channelMap.length} canaux connectés</strong><span>{remainingCount === 0 ? "Tout est prêt pour vos premières conversations." : `${remainingCount} à relier pour compléter votre espace.`}</span></div>
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

    <EmptyState
      className="dashboard-summary-empty"
      icon={<LuInbox />}
      title="L’essentiel apparaîtra ici"
      description="Les nouveaux messages, suivis et signaux utiles prendront leur place après la connexion de vos canaux."
    />
  </div>;
}
