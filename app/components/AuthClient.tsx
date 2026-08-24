'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useState } from 'react';
import { authClient } from '../lib/auth-client';
import { AuthSwitch } from './ui/auth-switch';

type AuthMode = 'login' | 'signup';

type AuthClientProps = {
  mode: AuthMode;
};

function TalviaMark() {
  return <span className="talvia-auth__mark" aria-hidden="true"><i /><i /><i /><i /></span>;
}

export default function AuthClient({ mode: initialMode }: AuthClientProps) {
  const [mode, setMode] = useState<AuthMode>(initialMode);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [status, setStatus] = useState<'idle' | 'loading' | 'done'>('idle');
  const [error, setError] = useState('');
  const isSignup = mode === 'signup';

  useEffect(() => {
    const handlePopState = () => {
      setMode(window.location.pathname === '/signup' ? 'signup' : 'login');
      setStatus('idle');
      setError('');
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  function changeMode(nextMode: AuthMode) {
    if (nextMode === mode || isTransitioning) return;

    setIsTransitioning(true);
    setMode(nextMode);
    setStatus('idle');
    setError('');
    window.history.pushState({}, '', nextMode === 'signup' ? '/signup' : '/login');
    window.setTimeout(() => setIsTransitioning(false), 560);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus('loading');
    setError('');

    const form = new FormData(event.currentTarget);
    const email = String(form.get('email') ?? '');
    const password = String(form.get('password') ?? '');
    const name = String(form.get('name') ?? '');
    const result = isSignup
      ? await authClient.signUp.email({ email, password, name, callbackURL: '/app' })
      : await authClient.signIn.email({ email, password });

    if (result.error) {
      setError(result.error.message ?? 'Impossible de vous connecter.');
      setStatus('idle');
      return;
    }

    setStatus('done');
    if (!isSignup) window.setTimeout(() => window.location.assign('/app'), 250);
  }

  return (
    <main className={`talvia-auth${isTransitioning ? ' talvia-auth--transitioning' : ''}`}>
      <section className="talvia-auth__card" data-mode={mode}>
        <aside className="talvia-auth__panel" aria-label="Présentation Talvia">
          <Link className="talvia-auth__brand" href="/" aria-label="Retour à l’accueil Talvia">
            <TalviaMark />
            <span>talvia</span>
          </Link>

          <div className="talvia-auth__panel-content">
            <span className="talvia-auth__eyebrow">●—●—● Votre espace commercial</span>
            <h2>{isSignup ? 'Déjà parmi nous ?' : 'Nouveau ici ?'}</h2>
            <p>{isSignup ? 'Retrouvez vos conversations et vos relances dans un même espace.' : 'Créez votre espace Talvia et gardez le fil de chaque opportunité.'}</p>
            <button className="talvia-auth__secondary-action" onClick={() => changeMode(isSignup ? 'login' : 'signup')} type="button">
              {isSignup ? 'Se connecter' : 'Créer mon espace'} <span aria-hidden="true">→</span>
            </button>
          </div>
        </aside>

        <section className="talvia-auth__form-shell">
          <Link className="talvia-auth__back" href="/">← Retour à l’accueil</Link>
          <div className="talvia-auth__form-content">
            <span className="talvia-auth__kicker">{isSignup ? 'NOUVEL ESPACE' : 'CONNEXION'}</span>
            <AuthSwitch mode={mode} onNavigate={changeMode} />
            <h1>{isSignup ? 'Créez votre espace Talvia' : 'Bon retour parmi nous'}</h1>
            <p className="talvia-auth__intro">{isSignup ? 'Quelques informations suffisent pour commencer.' : 'Entrez vos informations pour retrouver votre espace.'}</p>

            {status === 'done' ? (
              <div className="talvia-auth__success" role="status">
                <span aria-hidden="true">✓</span>
                <h2>{isSignup ? 'Vérifiez votre adresse e-mail.' : 'Connexion validée.'}</h2>
                <p>{isSignup ? 'Nous venons de vous envoyer un lien de confirmation.' : 'Votre session est prête.'}</p>
              </div>
            ) : (
              <form className="talvia-auth__form" onSubmit={handleSubmit}>
                <div className="talvia-auth__notice"><span aria-hidden="true">i</span><p><b>Compte Talvia</b><small>Vos identifiants restent chiffrés et vos données sont isolées dans votre espace.</small></p></div>
                {isSignup && <label>Nom complet<input name="name" required placeholder="Votre nom" /></label>}
                <label>Email professionnel<input name="email" type="email" required placeholder="vous@entreprise.com" /></label>
                <label>Mot de passe<div className="talvia-auth__password"><input name="password" type={showPassword ? 'text' : 'password'} required minLength={8} placeholder="8 caractères minimum" /><button onClick={() => setShowPassword(!showPassword)} type="button">{showPassword ? 'Masquer' : 'Afficher'}</button></div></label>
                {!isSignup && <div className="talvia-auth__options"><label><input type="checkbox" /> Se souvenir de moi</label><a href="#">Mot de passe oublié ?</a></div>}
                <button className="talvia-auth__submit" disabled={status === 'loading'} type="submit">{status === 'loading' ? 'Préparation…' : isSignup ? 'Créer mon espace' : 'Se connecter'} <span aria-hidden="true">→</span></button>
                {error && <p className="talvia-auth__error" role="alert">{error}</p>}
                <p className="talvia-auth__switch-copy">{isSignup ? 'Vous avez déjà un compte ?' : 'Pas encore de compte ?'} <button onClick={() => changeMode(isSignup ? 'login' : 'signup')} type="button">{isSignup ? 'Se connecter' : 'Créer un compte'}</button></p>
              </form>
            )}
          </div>
        </section>
      </section>
    </main>
  );
}
