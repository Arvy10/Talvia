"use client";

import Link from "next/link";
import styles from "./auth-switch.module.css";

export function AuthSwitch({ mode }: { mode: "login" | "signup" }) {
  return <nav aria-label="Accès au compte" className={styles.switch}>
    <Link aria-current={mode === "login" ? "page" : undefined} className={mode === "login" ? styles.active : undefined} href="/login">Connexion</Link>
    <Link aria-current={mode === "signup" ? "page" : undefined} className={mode === "signup" ? styles.active : undefined} href="/signup">Créer un compte</Link>
  </nav>;
}
