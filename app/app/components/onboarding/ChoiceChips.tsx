"use client";

// A small closed set of big, tappable choices — single or multi-select.
// Deliberately has no search/free-text: use TagComboBox when the list is
// long or needs a custom entry, this component when 3-8 options are enough.
export function ChoiceChips({
  options,
  value,
  onChange,
  multiple = false,
}: {
  options: string[];
  value: string | string[];
  onChange: (next: string | string[]) => void;
  multiple?: boolean;
}) {
  const isSelected = (option: string) => (multiple ? (value as string[]).includes(option) : value === option);

  const toggle = (option: string) => {
    if (multiple) {
      const current = value as string[];
      onChange(current.includes(option) ? current.filter((item) => item !== option) : [...current, option]);
      return;
    }
    onChange(option === value ? "" : option);
  };

  return <div className="choice-chips" role="group">
    {options.map((option) => <button
      aria-pressed={isSelected(option)}
      className={isSelected(option) ? "choice-chip is-selected" : "choice-chip"}
      key={option}
      onClick={() => toggle(option)}
      type="button"
    >
      {option}
    </button>)}
  </div>;
}
