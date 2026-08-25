"use client";

import { useEffect, useState } from "react";

function formatTime(date: Date) {
  return date.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}

export function TopbarClock() {
  const [time, setTime] = useState<string | null>(null);

  useEffect(() => {
    setTime(formatTime(new Date()));
    const id = setInterval(() => setTime(formatTime(new Date())), 30_000);
    return () => clearInterval(id);
  }, []);

  return (
    <span className="app-topbar__clock" suppressHydrationWarning>
      {time}
    </span>
  );
}
