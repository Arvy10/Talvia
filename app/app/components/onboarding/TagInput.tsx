"use client";

import { useState } from "react";
import { LuX } from "react-icons/lu";

// Free-text chip entry with no preset suggestions — for offers, where
// there's no meaningful list to suggest from. Caps the count so onboarding
// stays "a few main offers," not a full catalogue.
export function TagInput({
  value,
  onChange,
  placeholder,
  max = 5,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  max?: number;
}) {
  const [draft, setDraft] = useState("");

  const add = () => {
    const trimmed = draft.trim();
    if (!trimmed || value.length >= max || value.some((item) => item.toLowerCase() === trimmed.toLowerCase())) return;
    onChange([...value, trimmed]);
    setDraft("");
  };
  const remove = (item: string) => onChange(value.filter((entry) => entry !== item));

  return <div className="tag-input">
    {value.length > 0 ? <div className="tag-input__chips">
      {value.map((item) => <span className="tag-input__chip" key={item}>
        {item}
        <button aria-label={`Retirer ${item}`} onClick={() => remove(item)} type="button"><LuX aria-hidden="true" /></button>
      </span>)}
    </div> : null}
    {value.length < max ? <div className="tag-input__row">
      <input
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            add();
          }
        }}
        placeholder={placeholder}
        type="text"
        value={draft}
      />
      <button className="connection-button connection-button--secondary" disabled={!draft.trim()} onClick={add} type="button">Ajouter</button>
    </div> : <p className="tag-input__limit">Maximum {max} atteint.</p>}
  </div>;
}
