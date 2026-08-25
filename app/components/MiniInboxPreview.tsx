'use client';

import { useEffect, useRef, useState } from 'react';

const conversations: [string, string, string, string, string][] = [
  ['SM', 'Sarah M.', 'LinkedIn', 'Oui, une démo cette semaine serait parfaite.', '2 min'],
  ['MD', 'Marc D.', 'WhatsApp', 'Merci pour la proposition, je reviens vers vous.', '18 min'],
  ['AC', 'Acme', 'Gmail', 'Besoin d’automatiser nos relances', '1 h'],
];

export default function MiniInboxPreview() {
  const ref = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    function onScroll() {
      const section = ref.current?.closest('.section-wrap') as HTMLElement | null;
      if (!section) return;
      const rect = section.getBoundingClientRect();
      const total = rect.height - window.innerHeight;
      const progress = total > 0 ? Math.min(1, Math.max(0, -rect.top / total)) : 0;
      const index = Math.min(conversations.length - 1, Math.floor(progress * conversations.length));
      setActive(index);
    }

    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <div className="mini-inbox" ref={ref}>
      <header><span>Inbox</span><b>8 non lus</b></header>
      <nav>Tout&nbsp;&nbsp;&nbsp; LinkedIn&nbsp;&nbsp;&nbsp; WhatsApp</nav>
      {conversations.map((c, i) => (
        <article className={i === active ? 'selected' : ''} key={c[1]}>
          <i>{c[0]}</i>
          <div><b>{c[1]}</b><small>{c[2]}</small><p>{c[3]}</p></div>
          <time>{c[4]}</time>
        </article>
      ))}
    </div>
  );
}
