"use client";

import { useEffect } from "react";
import { LuRefreshCw, LuTriangleAlert } from "react-icons/lu";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="app-main">
      <div className="empty-state">
        <div aria-hidden="true" className="empty-state__icon">
          <LuTriangleAlert />
        </div>
        <h2>Un problème est survenu</h2>
        <p>Cette page n’a pas pu s’afficher correctement. Vous pouvez réessayer sans perdre votre session.</p>
        <div className="empty-state__action">
          <button className="connection-button" onClick={reset} type="button">
            <LuRefreshCw aria-hidden="true" />
            Réessayer
          </button>
        </div>
      </div>
    </div>
  );
}
