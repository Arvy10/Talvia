import type { ReactNode } from "react";

import "./app.css";
import { AppShell } from "./components/AppShell";
import { SandboxProvider } from "./state/SandboxProvider";

export default function ProductLayout({ children }: { children: ReactNode }) {
  return <SandboxProvider><AppShell>{children}</AppShell></SandboxProvider>;
}
