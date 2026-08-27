"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { LuX } from "react-icons/lu";

// Generalized version of the country picker: multi-value chips + a search
// box that suggests from a preset list and, unless disabled, offers to add
// whatever the user typed even if it isn't in that list.
export function TagComboBox({
  options,
  value,
  onChange,
  placeholder = "Rechercher…",
  allowCustom = true,
}: {
  options: string[];
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  allowCustom?: boolean;
}) {
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);

  // Closing on outside click / Escape — without this the panel could stay
  // open after the user clicked elsewhere, and with several of these
  // stacked in the same step (target types, roles, industries, geography)
  // an open one could sit on top of the fields/buttons below it.
  useEffect(() => {
    const onClickOutside = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setQuery("");
    };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  const suggestions = useMemo(() => {
    // A blank query must suggest nothing — showing the full option list
    // (up to 8 items) by default meant this panel was effectively always
    // open, not just while the user was actively searching.
    if (!query.trim()) return [];
    const needle = query.trim().toLowerCase();
    return options.filter((option) => option.toLowerCase().includes(needle) && !value.includes(option)).slice(0, 8);
  }, [query, options, value]);

  const add = (item: string) => {
    if (!value.includes(item)) onChange([...value, item]);
    setQuery("");
  };
  const remove = (item: string) => onChange(value.filter((entry) => entry !== item));

  const trimmedQuery = query.trim();
  const showCustomOption = allowCustom && trimmedQuery.length > 0
    && !options.some((option) => option.toLowerCase() === trimmedQuery.toLowerCase())
    && !value.some((item) => item.toLowerCase() === trimmedQuery.toLowerCase());

  return <div className="country-picker" ref={rootRef}>
    {value.length > 0 ? <div className="country-picker__chips">
      {value.map((item) => <span className="country-chip" key={item}>
        {item}
        <button aria-label={`Retirer ${item}`} onClick={() => remove(item)} type="button"><LuX aria-hidden="true" /></button>
      </span>)}
    </div> : null}
    <div className="country-picker__search">
      <input
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            setQuery("");
            return;
          }
          if (event.key === "Enter" && showCustomOption) {
            event.preventDefault();
            add(trimmedQuery);
          }
        }}
        placeholder={placeholder}
        type="text"
        value={query}
      />
      {suggestions.length > 0 || showCustomOption ? <ul className="country-picker__suggestions" role="listbox">
        {suggestions.map((item) => <li key={item}>
          <button onClick={() => add(item)} type="button">{item}</button>
        </li>)}
        {showCustomOption ? <li><button onClick={() => add(trimmedQuery)} type="button">Ajouter « {trimmedQuery} »</button></li> : null}
      </ul> : null}
    </div>
  </div>;
}
