import type { Metadata } from 'next';
import AuthClient from '../components/AuthClient';
export const metadata: Metadata = { title: 'Connexion — Talvia', description: 'Connectez-vous à votre espace commercial Talvia.' };
export default function LoginPage(){ return <AuthClient mode="login"/>; }
