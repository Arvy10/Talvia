'use client';

import { useRef } from 'react';
import { ChannelIcon, type ChannelKey } from './ChannelIcon';

const CHANNELS: { id: ChannelKey; label: string }[] = [
  { id: 'linkedin', label: 'LinkedIn' },
  { id: 'whatsapp', label: 'WhatsApp' },
  { id: 'gmail', label: 'Gmail' },
];

export default function ChannelDock() {
  const itemRefs = useRef<(HTMLDivElement | null)[]>([]);

  function handleMove(e: React.MouseEvent) {
    if (typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const mouseX = e.clientX;
    itemRefs.current.forEach((el) => {
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const center = rect.left + rect.width / 2;
      const dist = Math.abs(mouseX - center);
      const scale = Math.max(1, 1.55 - dist / 90);
      const lift = Math.min(10, Math.max(0, (scale - 1) * 22));
      el.style.transform = `translateY(-${lift}px) scale(${scale})`;
    });
  }

  function handleLeave() {
    itemRefs.current.forEach((el) => { if (el) el.style.transform = ''; });
  }

  return (
    <div className="channel-dock" onMouseMove={handleMove} onMouseLeave={handleLeave}>
      {CHANNELS.map((c, i) => (
        <div className="channel-dock-item" key={c.id} ref={(el) => { itemRefs.current[i] = el; }}>
          <ChannelIcon channel={c.id} size={17} />
          <span>{c.label}</span>
        </div>
      ))}
    </div>
  );
}
