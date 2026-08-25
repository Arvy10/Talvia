import Link from 'next/link';
import ScrollReveal from './ScrollReveal';
import { ChannelIcon } from './ChannelIcon';
import MiniInboxPreview from './MiniInboxPreview';

function Brand() { return <span className="brand"><span className="brand-mark" aria-hidden="true"><i /><i /><i /><i /></span>talvia</span>; }
function Head({ kicker, title, copy }: { kicker: string; title: string; copy: string }) { return <header className="section-head"><span>{kicker}</span><h2>{title}</h2><p>{copy}</p></header>; }

function Flow() { return <div className="flow-stage"><div className="flow-channels"><span><ChannelIcon channel="linkedin" size={16} /><i>LinkedIn</i><small>3 conversations</small></span><span><ChannelIcon channel="whatsapp" size={16} /><i>WhatsApp</i><small>5 messages</small></span><span><ChannelIcon channel="gmail" size={16} /><i>Gmail</i><small>1 proposition</small></span></div><div className="flow-lines" aria-hidden="true"><i /><i /><i /><b>●</b></div><div className="flow-center"><Brand /><small>Tout le contexte. Une seule vue.</small></div></div>; }

function Sequence() { const steps: [string, string, string, string][] = [['①', 'Invitation LinkedIn', 'Message personnalisé au premier contact', 'Envoyé'], ['②', 'Relance J+4', 'Rappel court si aucune réponse', 'Programmé'], ['③', 'Réponse reçue', 'La séquence s’arrête automatiquement', 'Stop']]; return <div className="follow-card"><header><div><small>SÉQUENCE LINKEDIN</small><h3>Prospect Nova Studio</h3></div><span>3 étapes</span></header>{steps.map((x) => <article key={x[1]}><i>{x[0]}</i><div><h4>{x[1]}</h4><p>{x[2]}</p></div><button>{x[3]}</button></article>)}<footer><span>✦</span><p><b>Une réponse coupe la séquence.</b><br />L’Inbox prend le relais, pas l’automatisation.</p></footer></div>; }

function Crm() { return <div className="crm-card"><header><i>SM</i><div><h3>Sarah Mensah</h3><p>Head of Growth · Nova Studio</p></div><span>Proposition</span></header><div className="crm-channels"><ChannelIcon channel="linkedin" size={11} /><ChannelIcon channel="whatsapp" size={11} /><small>2 canaux</small></div><dl><div><dt>Besoin identifié</dt><dd>Suivi commercial multicanal</dd></div><div><dt>Dernière interaction</dt><dd>Aujourd’hui, 09:47</dd></div><div><dt>Prochaine action</dt><dd>Planifier une démonstration</dd></div></dl><section><small>✦ RÉSUMÉ TALVIA</small><p>Sarah cherche à centraliser les prospects de Nova Studio entre LinkedIn et WhatsApp. Intérêt confirmé pour une démo cette semaine.</p></section><footer><span>Contact enrichi depuis la conversation</span><b>Mis à jour à l’instant</b></footer></div>; }

function Workflow({ items, humanIndex }: { items: [string, string, string, string][]; humanIndex?: number }) { return <div className="workflow">{items.map((x, i) => <div className={humanIndex === i ? 'human' : ''} key={x[0]}><span>{x[0]}</span><i>{x[1]}</i><b>{x[2]}</b><small>{x[3]}</small></div>)}</div>; }

function Phases() {
  const phases: [string, string, string, string][] = [
    ['01', 'Approche', 'Prospecter, échanger', 'Vous abordez vos prospects sur LinkedIn, WhatsApp ou Gmail. Chaque réponse arrive dans un espace unique.'],
    ['02', 'Suivi', 'Suivre, relancer', 'Le contact garde son historique. La bonne conversation revient sous vos yeux au bon moment.'],
    ['03', 'Conversion', 'Qualifier, convertir', 'Un vrai signal commercial fait avancer l’opportunité, étape par étape, dans votre pipeline.'],
  ];
  return <div className="phase-list">{phases.map((phase) => <div className="phase-list__item" key={phase[0]}><span className="phase-list__index">{phase[0]}</span><div><span className="phase-list__tag">{phase[1]}</span><h3>{phase[2]}</h3><p>{phase[3]}</p></div></div>)}</div>;
}

const automationSteps: [string, string, string, string][] = [
  ['01', '✉', 'Nouveau message', 'Un prospect vous écrit'],
  ['02', '✦', 'Analyse', 'Intention et besoin'],
  ['03', '◇', 'Qualification', 'Contexte structuré'],
  ['04', '▦', 'CRM mis à jour', 'Sans saisie manuelle'],
  ['05', '✓', 'Validation humaine', 'Vous décidez d’envoyer'],
];

export function LandingSections() { return <>
  <section className="problem section" id="fonctionnalites"><div className="section-wrap"><ScrollReveal><Head kicker="LE PROBLÈME" title="Un prospect sur LinkedIn. Un autre sur WhatsApp. Un devis dans Gmail." copy="Une relance oubliée quelque part au milieu. Une opportunité perdue parce que personne n’a recroisé les trois." /></ScrollReveal><ScrollReveal><Flow /></ScrollReveal></div></section>

  <section className="feature section"><div className="section-wrap"><ScrollReveal><Head kicker="ORGANISATION TALVIA" title="Chaque étape de votre cycle commercial, au même endroit." copy="Pas une case de plus dans un tableau. Un fil continu, de la première approche jusqu’à la conversion." /></ScrollReveal><ScrollReveal><Phases /></ScrollReveal></div></section>

  <section className="feature section"><div className="section-wrap split"><ScrollReveal><Head kicker="INBOX UNIFIÉE" title="Une inbox pour toutes vos conversations." copy="Passez d’un prospect à l’autre, pas d’une application à l’autre. Chaque échange reste lisible, quel que soit le canal." /><ul className="benefits"><li><b>Une vue claire</b><span>Filtrez par canal, non-lus ou relances.</span></li><li><b>Tout le contexte</b><span>Retrouvez l’historique avant de répondre.</span></li><li><b>Une seule routine</b><span>Traitez vos conversations depuis le même espace.</span></li></ul></ScrollReveal><MiniInboxPreview /></div></section>

  <section className="feature section"><div className="section-wrap split reverse"><ScrollReveal><Sequence /></ScrollReveal><ScrollReveal><Head kicker="CAMPAGNES" title="Approchez, relancez, puis arrêtez dès qu’une vraie conversation commence." copy="Une séquence LinkedIn s’interrompt à la première réponse. Préparez vos relances WhatsApp autour des contacts déjà engagés et gardez la conversation au centre du suivi." /></ScrollReveal></div></section>

  <section className="feature section crm-section"><div className="section-wrap split"><ScrollReveal><Head kicker="OPPORTUNITÉS" title="Une réponse seule ne suffit pas à créer une opportunité." copy="Talvia vous aide à identifier les échanges qui présentent un véritable intérêt commercial et à les faire avancer dans votre pipeline." /></ScrollReveal><ScrollReveal><Crm /></ScrollReveal></div></section>

  <section className="automation section"><div className="section-wrap"><ScrollReveal><Head kicker="AUTOMATISATIONS" title="Automatisez le travail. Pas la relation." copy="Relances, rappels, changements de statut, arrêts de séquence ou préparation de réponses : vous choisissez ce que Talvia prend en charge et ce qui reste sous votre validation." /></ScrollReveal><ScrollReveal><Workflow items={automationSteps} humanIndex={4} /></ScrollReveal><p className="reassurance"><span>✓</span><b>La relation reste humaine.</b> Vous gardez la main sur ce qui compte.</p></div></section>

  <section className="pricing section" id="tarifs"><div className="section-wrap pricing-inner"><div><span className="section-kicker">TARIFS</span><h2>Commencez simplement.</h2><p>Talvia prépare ses premières offres. Créez votre espace pour être informé du lancement et accéder aux formules dès leur disponibilité.</p></div><div className="pricing-card"><small>ACCÈS DE LANCEMENT</small><h3>Talvia Early</h3><p>Le suivi commercial multicanal pensé pour les entrepreneurs, agences et petites équipes.</p><ul><li>✓ Inbox LinkedIn, WhatsApp et Gmail</li><li>✓ Suivi des contacts et opportunités</li><li>✓ Campagnes et relances</li></ul><Link className="button" href="/signup">Créer mon espace →</Link><small>Aucun paiement demandé à cette étape.</small></div></div></section>

  <section className="final-cta section"><div><span className="eyebrow">●—●—●&nbsp;&nbsp; Reprenez le fil</span><h2>Vos prochaines opportunités sont peut-être déjà dans vos messages.</h2><p>Réunissez vos conversations et reprenez le contrôle de vos opportunités commerciales.</p><Link className="button" href="/signup">Commencer avec Talvia →</Link></div></section>

  <footer className="footer"><div><Brand /><p>Le poste de travail intelligent de vos conversations commerciales.</p></div><nav><a href="#produit">Produit</a><a href="#fonctionnalites">Fonctionnalités</a><a href="#tarifs">Tarifs</a><Link href="/login">Connexion</Link></nav><small>© 2026 Talvia&nbsp;&nbsp; · &nbsp;&nbsp;<a href="#">Confidentialité</a>&nbsp;&nbsp; · &nbsp;&nbsp;<a href="#">Mentions légales</a></small></footer>
</>; }
