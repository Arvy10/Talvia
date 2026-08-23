'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FormEvent, useState } from 'react';

import { authClient } from '../lib/auth-client';
import { AuthSwitch } from './ui/auth-switch';

export default function AuthClient({ mode }: { mode: 'login' | 'signup' }) {
  const router = useRouter();
  const signup = mode === 'signup';
  const [show, setShow] = useState(false);
  const [status, setStatus] = useState<'idle' | 'loading' | 'done'>('idle');
  const [error, setError] = useState('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus('loading');
    setError('');
    const form = new FormData(event.currentTarget);
    const email = String(form.get('email') ?? '');
    const password = String(form.get('password') ?? '');
    const name = String(form.get('name') ?? '');
    const result = signup
      ? await authClient.signUp.email({ email, password, name })
      : await authClient.signIn.email({ email, password });
    if (result.error) {
      setError(result.error.message ?? "Impossible de vous connecter.");
      setStatus('idle');
      return;
    }
    if (signup) {
      const provision = await fetch('/api/workspace/provision', { method: 'POST' });
      if (!provision.ok) {
        setError("Votre compte a été créé, mais la préparation de l’espace a échoué. Réessayez de vous connecter.");
        setStatus('idle');
        return;
      }
    }
    setStatus('done');
    window.setTimeout(() => {
      setStatus('done');
      router.push('/app');
    }, 250);
  }

  return (
    <main className="auth-page">
      <section className="auth-brand">
        <Link href="/" className="brand">
          <span className="brand-mark" aria-hidden="true"><i /><i /><i /><i /></span>
          talvia
        </Link>
        <div className="auth-message">
          <span className="eyebrow">●—●—●&nbsp;&nbsp; Votre espace commercial</span>
          <h1>{signup ? 'Chaque opportunité commence par une conversation.' : 'Reprenez vos conversations là où vous les avez laissées.'}</h1>
          <p>{signup ? 'Créez votre espace Talvia et préparez une organisation commerciale plus simple, plus claire et plus attentive.' : 'Vos messages, vos relances et tout le contexte commercial — réunis dans un espace conçu pour agir.'}</p>
          <div className="auth-preview">
            <header><span>À relancer aujourd’hui</span><b>3</b></header>
            <article><i>SM</i><div><b>Sarah Mensah</b><small>A demandé une démonstration</small></div><em>Maintenant</em></article>
            <article><i>MD</i><div><b>Marc Dupont</b><small>Proposition envoyée il y a 5 jours</small></div><em>Relancer</em></article>
            <footer><span>✦</span>Talvia garde le fil pour vous.</footer>
          </div>
        </div>
        <small className="auth-quote">Automatisez le travail. Pas la relation.</small>
      </section>

      <section className="auth-form-side">
        <Link href="/" className="auth-back" aria-label="Retour à l’accueil Talvia">
          <span aria-hidden="true">←</span> Retour à l’accueil
        </Link>
        <div className="auth-form-wrap">
          <Link href="/" className="mobile-brand brand">
            <span className="brand-mark" aria-hidden="true"><i /><i /><i /><i /></span>
            talvia
          </Link>
          <span className="form-kicker">{signup ? 'NOUVEL ESPACE' : 'CONNEXION'}</span>
          <AuthSwitch mode={mode} />
          <h2>{signup ? 'Créez votre espace Talvia' : 'Bon retour parmi nous'}</h2>
          <p>{signup ? 'Quelques informations suffisent pour commencer.' : 'Entrez vos informations pour retrouver votre espace.'}</p>

          {status === 'done' ? (
            <div className="mock-success" role="status">
              <span>✓</span>
              <h3>{signup ? 'Votre espace Talvia est prêt.' : 'Connexion validée.'}</h3>
              <p>Votre session et vos données Contacts sont désormais persistées de façon sécurisée.</p>
              <Link className="button" href="/app">Ouvrir Talvia →</Link>
            </div>
          ) : (
            <form onSubmit={submit}>
              <div className="demo-note"><span>i</span><p><b>Compte Talvia</b><small>Vos identifiants restent chiffrés et vos données sont isolées dans votre espace.</small></p></div>
              {signup && <label>Nom complet<input name="name" autoComplete="name" required placeholder="Votre nom" /></label>}
              <label>Email professionnel<input type="email" name="email" autoComplete="email" required placeholder="vous@entreprise.com" /></label>
              <label>Mot de passe<div className="password-field"><input type={show ? 'text' : 'password'} name="password" autoComplete={signup ? 'new-password' : 'current-password'} required minLength={8} placeholder="8 caractères minimum" /><button type="button" onClick={() => setShow(!show)} aria-label={show ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}>{show ? 'Masquer' : 'Afficher'}</button></div></label>
              {!signup && <div className="form-options"><label><input type="checkbox" /> Se souvenir de moi</label><a href="#">Mot de passe oublié ?</a></div>}
              <button className="button submit" disabled={status === 'loading'}>{status === 'loading' ? 'Préparation…' : signup ? 'Créer mon espace' : 'Se connecter'}<span>→</span></button>
              {error ? <p className="form-error" role="alert">{error}</p> : null}
              <p className="form-switch">{signup ? 'Vous avez déjà un compte ?' : 'Pas encore de compte ?'} <Link href={signup ? '/login' : '/signup'}>{signup ? 'Se connecter' : 'Créer un compte'}</Link></p>
              {signup && <small className="terms">En continuant, vous acceptez nos conditions d’utilisation et notre politique de confidentialité.</small>}
            </form>
          )}
        </div>
      </section>
    </main>
  );
}
