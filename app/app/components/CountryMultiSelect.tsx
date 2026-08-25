"use client";

import { useMemo, useState } from "react";
import { LuX } from "react-icons/lu";

import { listCountries } from "./countries";

const ALL_COUNTRIES = listCountries();

export function CountryMultiSelect({ value, onChange }: { value: string[]; onChange: (next: string[]) => void }) {
  const [query, setQuery] = useState("");

  const suggestions = useMemo(() => {
    if (!query.trim()) return [];
    const needle = query.trim().toLowerCase();
    return ALL_COUNTRIES.filter(({ name }) => name.toLowerCase().includes(needle) && !value.includes(name)).slice(0, 8);
  }, [query, value]);

  const add = (name: string) => {
    if (!value.includes(name)) onChange([...value, name]);
    setQuery("");
  };
  const remove = (name: string) => onChange(value.filter((item) => item !== name));

  return <div className="country-picker">
    {value.length > 0 ? <div className="country-picker__chips">
      {value.map((name) => <span className="country-chip" key={name}>
        {name}
        <button aria-label={`Retirer ${name}`} onClick={() => remove(name)} type="button"><LuX aria-hidden="true" /></button>
      </span>)}
    </div> : null}
    <div className="country-picker__search">
      <input
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Rechercher un pays…"
        type="text"
        value={query}
      />
      {suggestions.length > 0 ? <ul className="country-picker__suggestions" role="listbox">
        {suggestions.map(({ code, name }) => <li key={code}>
          <button onClick={() => add(name)} type="button">{name}</button>
        </li>)}
      </ul> : null}
    </div>
  </div>;
}
