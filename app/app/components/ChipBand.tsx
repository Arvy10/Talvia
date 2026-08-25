"use client";

import { useState } from "react";

// A horizontally scrollable single-select band of preset options, with a
// free-text fallback for anything not in the list — the list never has to
// be exhaustive to stay useful.
export function ChipBand({ options, value, onChange }: { options: string[]; value: string; onChange: (next: string) => void }) {
  const isCustom = value.trim() !== "" && !options.includes(value);
  const [customMode, setCustomMode] = useState(isCustom);

  return <div className="chip-band">
    <div className="chip-band__scroll">
      {options.map((option) => <button
        className={!customMode && value === option ? "chip-band__item is-selected" : "chip-band__item"}
        key={option}
        onClick={() => { setCustomMode(false); onChange(option); }}
        type="button"
      >
        {option}
      </button>)}
      <button
        className={customMode ? "chip-band__item is-selected" : "chip-band__item"}
        onClick={() => { setCustomMode(true); onChange(""); }}
        type="button"
      >
        Autre
      </button>
    </div>
    {customMode ? <input
      autoFocus
      onChange={(event) => onChange(event.target.value)}
      placeholder="Précisez votre secteur…"
      type="text"
      value={value}
    /> : null}
  </div>;
}
