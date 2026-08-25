"use client";

import { useMemo } from "react";

import { countryName, guessCountryFromBrowserTimezone, listCountries } from "../countries";
import { TagComboBox } from "./TagComboBox";

const REGION_OPTIONS = ["Afrique", "Europe", "International"];

// Quick region/country chips for the common case, with a search fallback
// for something more specific. The guessed country from the browser's
// timezone is offered as ONE MORE clickable chip — never added silently —
// so a wrong guess costs nothing and a right one is one tap away.
export function GeographyPicker({ value, onChange }: { value: string[]; onChange: (next: string[]) => void }) {
  const guessedCountry = useMemo(() => {
    const code = guessCountryFromBrowserTimezone();
    return code ? countryName(code) : null;
  }, []);
  const countryNames = useMemo(() => listCountries().map((country) => country.name), []);

  const toggle = (item: string) => onChange(value.includes(item) ? value.filter((entry) => entry !== item) : [...value, item]);

  return <div className="geography-picker">
    <div className="choice-chips" role="group">
      {guessedCountry ? <button
        aria-pressed={value.includes(guessedCountry)}
        className={value.includes(guessedCountry) ? "choice-chip is-selected" : "choice-chip"}
        onClick={() => toggle(guessedCountry)}
        type="button"
      >
        {guessedCountry}
      </button> : null}
      {REGION_OPTIONS.map((option) => <button
        aria-pressed={value.includes(option)}
        className={value.includes(option) ? "choice-chip is-selected" : "choice-chip"}
        key={option}
        onClick={() => toggle(option)}
        type="button"
      >
        {option}
      </button>)}
    </div>
    <TagComboBox onChange={onChange} options={countryNames} placeholder="Ou recherchez un pays précis…" value={value} />
  </div>;
}
