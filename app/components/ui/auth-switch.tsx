"use client";

import styles from "./auth-switch.module.css";

export function AuthSwitch({ mode, onNavigate }: { mode: "login" | "signup"; onNavigate: (target: "login" | "signup") => void }) {
  return <nav aria-label="Accès au compte" className={styles.switch}>
    <button aria-current={mode === "login" ? "page" : undefined} className={mode === "login" ? styles.active : undefined} onClick={() => onNavigate("login")} type="button">Connexion</button>
    <button aria-current={mode === "signup" ? "page" : undefined} className={mode === "signup" ? styles.active : undefined} onClick={() => onNavigate("signup")} type="button">Créer un compte</button>
  </nav>;
}
