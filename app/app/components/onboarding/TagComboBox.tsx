"use client";

import { useMemo, useState } from "react";
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

  const suggestions = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const base = needle ? options.filter((option) => option.toLowerCase().includes(needle)) : options;
    return base.filter((option) => !value.includes(option)).slice(0, 8);
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

  return <div className="country-picker">
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
