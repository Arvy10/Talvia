"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { LuChevronDown } from "react-icons/lu";

import { INDUSTRY_OPTIONS } from "./industries";

// A closed-by-default searchable dropdown: click to reveal a keyword search
// over the preset list, or type something not on the list to use it as-is.
export function IndustrySelect({ value, onChange }: { value: string; onChange: (next: string) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClickOutside = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return INDUSTRY_OPTIONS;
    return INDUSTRY_OPTIONS.filter((option) => option.toLowerCase().includes(needle));
  }, [query]);

  const select = (option: string) => {
    onChange(option);
    setQuery("");
    setOpen(false);
  };

  return <div className="industry-select" ref={rootRef}>
    <button
      aria-expanded={open}
      className="industry-select__trigger"
      onClick={() => setOpen((current) => !current)}
      type="button"
    >
      <span>{value || "Choisir un secteur…"}</span>
      <LuChevronDown aria-hidden="true" className={open ? "is-open" : undefined} />
    </button>
    {open ? <div className="industry-select__panel">
      <input
        autoFocus
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Rechercher un secteur, ou écrire le vôtre…"
        type="text"
        value={query}
      />
      <ul role="listbox">
        {filtered.map((option) => <li key={option}>
          <button className={value === option ? "is-selected" : undefined} onClick={() => select(option)} type="button">{option}</button>
        </li>)}
        {query.trim() && !INDUSTRY_OPTIONS.some((option) => option.toLowerCase() === query.trim().toLowerCase())
          ? <li><button onClick={() => select(query.trim())} type="button">Utiliser « {query.trim()} »</button></li>
          : null}
      </ul>
    </div> : null}
  </div>;
}
