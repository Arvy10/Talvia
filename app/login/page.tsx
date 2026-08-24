import type { Metadata } from 'next';
import AuthClient from '../components/AuthClient';
export const metadata: Metadata = { title: 'Connexion — Talvia', description: 'Connectez-vous à votre espace commercial Talvia.' };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ mode?: string }> }) {
  const { mode } = await searchParams;
  return <AuthClient mode={mode === 'signup' ? 'signup' : 'login'} />;
}
