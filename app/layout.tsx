import type { Metadata, Viewport } from 'next';
import '@fontsource/instrument-serif';
import '@fontsource-variable/instrument-sans';
import './globals.css';
import './typography.css';
import './auth-motion.css';

const title = 'Talvia — Toutes vos conversations commerciales au même endroit';
const description = 'Centralisez LinkedIn, WhatsApp, Instagram et vos emails dans une inbox commerciale conçue pour vous aider à répondre, relancer et convertir vos prospects.';

export const viewport: Viewport = { themeColor: '#0D0B10' };

export const metadata: Metadata = {
  metadataBase: new URL('https://talvia.io'),
  title,
  description,
  applicationName: 'Talvia',
  icons: { icon: '/favicon.svg' },
  openGraph: {
    title: 'Talvia — Toutes vos conversations commerciales. Un seul espace.',
    description,
    type: 'website',
    locale: 'fr_FR',
    siteName: 'Talvia',
    images: [{ url: '/og.png', width: 1792, height: 1024, alt: 'Talvia — Toutes vos conversations commerciales. Un seul espace.' }],
  },
  twitter: { card: 'summary_large_image', title, description, images: ['/og.png'] },
  robots: { index: true, follow: true },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="fr"><body>{children}</body></html>;
}
