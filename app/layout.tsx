import type { Metadata, Viewport } from 'next';
import '@fontsource/instrument-serif';
import '@fontsource-variable/instrument-sans';
import './globals.css';
import './typography.css';

const title = 'Talvia — Votre suivi commercial multicanal';
const description = 'Talvia rassemble votre suivi commercial autour de LinkedIn, WhatsApp et Gmail pour vous aider à suivre vos prospects, relancer au bon moment et faire avancer les bonnes opportunités.';

export const viewport: Viewport = { themeColor: '#0D0B10' };

export const metadata: Metadata = {
  metadataBase: new URL('https://talvia.io'),
  title,
  description,
  applicationName: 'Talvia',
  icons: { icon: '/favicon.svg' },
  openGraph: {
    title: 'Talvia — Vos conversations commerciales sont partout. Votre suivi ne devrait pas l’être.',
    description,
    type: 'website',
    locale: 'fr_FR',
    siteName: 'Talvia',
    images: [{ url: '/og.png', width: 1792, height: 1024, alt: 'Talvia — suivi commercial multicanal' }],
  },
  twitter: { card: 'summary_large_image', title, description, images: ['/og.png'] },
  robots: { index: true, follow: true },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="fr"><body>{children}</body></html>;
}
