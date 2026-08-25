'use client';

import { useEffect, useState } from 'react';

const PHRASES = [
  'Votre espace commercial, enfin réuni',
  'De la prospection à la conversion',
  'Automatisez le travail. Pas la relation.',
];

export default function RotatingEyebrow() {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const id = setInterval(() => setIndex((i) => (i + 1) % PHRASES.length), 3800);
    return () => clearInterval(id);
  }, []);

  return (
    <span className="eyebrow">
      <span className="eyebrow-track" aria-hidden="true">
        <i className="dot" /><i className="dash" /><i className="dot" /><i className="dash" /><i className="dot" />
        <i className="eyebrow-runner" />
      </span>
      <span className="eyebrow-text" key={index}>{PHRASES[index]}</span>
    </span>
  );
}
