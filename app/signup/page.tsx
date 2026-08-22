import type { Metadata } from 'next';
import AuthClient from '../components/AuthClient';
export const metadata: Metadata = { title: 'Créer un espace — Talvia', description: 'Créez votre espace commercial Talvia.' };
export default function SignupPage(){ return <AuthClient mode="signup"/>; }
