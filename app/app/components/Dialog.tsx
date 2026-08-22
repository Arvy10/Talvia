"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { LuX } from "react-icons/lu";

import { IconButton } from "./ui";

type DialogProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
};

const focusableSelector = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

export function Dialog({ open, onClose, title, description, children }: DialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const openingTriggerRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) {
      return;
    }

    openingTriggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
    const controls = dialog?.querySelectorAll<HTMLElement>(focusableSelector);
    (controls?.[0] ?? dialog)?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }

      if (event.key !== "Tab" || !dialog) {
        return;
      }

      const focusableControls = Array.from(dialog.querySelectorAll<HTMLElement>(focusableSelector));
      if (focusableControls.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }

      const first = focusableControls[0];
      const last = focusableControls.at(-1)!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      openingTriggerRef.current?.focus();
    };
  }, [open]);

  if (!open) {
    return null;
  }

  return <div className="dialog-backdrop" onMouseDown={(event) => {
    if (event.target === event.currentTarget) {
      onClose();
    }
  }}>
    <div aria-describedby={description ? descriptionId : undefined} aria-labelledby={titleId} aria-modal="true" className="dialog" ref={dialogRef} role="dialog" tabIndex={-1}>
      <header className="dialog__header">
        <div>
          <h2 id={titleId}>{title}</h2>
          {description ? <p id={descriptionId}>{description}</p> : null}
        </div>
        <IconButton label="Fermer la fenêtre" onClick={onClose}><LuX aria-hidden="true" /></IconButton>
      </header>
      <div className="dialog__body">{children}</div>
    </div>
  </div>;
}
