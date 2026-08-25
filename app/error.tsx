'use client';

import { useEffect } from 'react';

export default function RootError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: '24px', background: '#0d0b10', color: '#f7f4f8', fontFamily: 'Instrument Sans, Segoe UI, sans-serif', textAlign: 'center' }}>
      <div style={{ maxWidth: '420px' }}>
        <h1 style={{ fontSize: '28px', margin: '0 0 12px' }}>Un problème est survenu</h1>
        <p style={{ color: '#a9a2ae', margin: '0 0 24px', lineHeight: 1.6 }}>
          Cette page n’a pas pu s’afficher correctement. Réessayez, ou revenez à l’accueil.
        </p>
        <div style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
          <button
            onClick={reset}
            style={{ minHeight: '48px', padding: '0 20px', border: '1px solid #ff6b4a', borderRadius: '12px', background: '#ff6b4a', color: '#1b0d0a', fontWeight: 700, cursor: 'pointer' }}
            type="button"
          >
            Réessayer
          </button>
          <a
            href="/"
            style={{ minHeight: '48px', padding: '0 20px', display: 'inline-flex', alignItems: 'center', border: '1px solid #2d2632', borderRadius: '12px', color: '#f7f4f8', textDecoration: 'none' }}
          >
            Retour à l’accueil
          </a>
        </div>
      </div>
    </div>
  );
}
