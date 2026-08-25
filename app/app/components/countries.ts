// ISO 3166-1 alpha-2 country codes. French display names are derived at
// runtime via Intl.DisplayNames rather than hand-typed, so there's one
// source of truth (the code list) and no risk of translation drift.
export const COUNTRY_CODES = [
  "AF", "ZA", "AL", "DZ", "DE", "AD", "AO", "AG", "SA", "AR", "AM", "AU", "AT", "AZ",
  "BS", "BH", "BD", "BB", "BE", "BZ", "BJ", "BT", "BY", "MM", "BO", "BA", "BW", "BR",
  "BN", "BG", "BF", "BI", "KH", "CM", "CA", "CV", "CL", "CN", "CY", "CO", "KM", "CG",
  "CD", "KR", "KP", "CR", "CI", "HR", "CU", "DK", "DJ", "DM", "EG", "SV", "AE", "EC",
  "ER", "ES", "EE", "SZ", "US", "ET", "FJ", "FI", "FR", "GA", "GM", "GE", "GH", "GR",
  "GD", "GT", "GN", "GW", "GQ", "GY", "HT", "HN", "HU", "IN", "ID", "IQ", "IR", "IE",
  "IS", "IL", "IT", "JM", "JP", "JO", "KZ", "KE", "KG", "KI", "KW", "LA", "LS", "LV",
  "LB", "LR", "LY", "LI", "LT", "LU", "MK", "MG", "MY", "MW", "MV", "ML", "MT", "MA",
  "MH", "MU", "MR", "MX", "FM", "MD", "MC", "MN", "ME", "MZ", "NA", "NR", "NP", "NI",
  "NE", "NG", "NO", "NZ", "OM", "UG", "UZ", "PK", "PW", "PA", "PG", "PY", "NL", "PE",
  "PH", "PL", "PT", "QA", "RO", "GB", "RU", "RW", "EH", "KN", "SM", "VC", "LC", "SB",
  "WS", "AS", "ST", "SN", "RS", "SC", "SL", "SG", "SK", "SI", "SO", "SD", "SS", "LK",
  "SE", "CH", "SR", "SY", "TJ", "TZ", "TD", "TH", "TL", "TG", "TO", "TT", "TN", "TM",
  "TR", "TV", "UA", "UY", "VU", "VA", "VE", "VN", "YE", "ZM", "ZW",
] as const;

let displayNames: Intl.DisplayNames | null = null;
function getDisplayNames(): Intl.DisplayNames | null {
  if (typeof Intl === "undefined" || typeof Intl.DisplayNames === "undefined") return null;
  displayNames ??= new Intl.DisplayNames(["fr"], { type: "region" });
  return displayNames;
}

export function countryName(code: string): string {
  return getDisplayNames()?.of(code) ?? code;
}

export function listCountries(): Array<{ code: string; name: string }> {
  return COUNTRY_CODES.map((code) => ({ code, name: countryName(code) })).sort((a, b) => a.name.localeCompare(b.name, "fr"));
}

// A pragmatic subset of common IANA zones mapped to the country they most
// often correspond to — not exhaustive, only used to pre-select a likely
// country the user can freely change or remove, never to infer anything
// silently trusted downstream.
const TIMEZONE_COUNTRY: Record<string, string> = {
  "Africa/Brazzaville": "CG", "Africa/Kinshasa": "CD", "Africa/Abidjan": "CI",
  "Africa/Dakar": "SN", "Africa/Bamako": "ML", "Africa/Douala": "CM",
  "Africa/Libreville": "GA", "Africa/Lome": "TG", "Africa/Cotonou": "BJ",
  "Africa/Ouagadougou": "BF", "Africa/Niamey": "NE", "Africa/Conakry": "GN",
  "Africa/Casablanca": "MA", "Africa/Tunis": "TN", "Africa/Algiers": "DZ",
  "Africa/Cairo": "EG", "Africa/Johannesburg": "ZA", "Africa/Nairobi": "KE",
  "Africa/Lagos": "NG", "Africa/Accra": "GH", "Africa/Addis_Ababa": "ET",
  "Africa/Kigali": "RW", "Africa/Bujumbura": "BI",
  "Europe/Paris": "FR", "Europe/Brussels": "BE", "Europe/Zurich": "CH",
  "Europe/Luxembourg": "LU", "Europe/Monaco": "MC", "Europe/Madrid": "ES",
  "Europe/Lisbon": "PT", "Europe/Rome": "IT", "Europe/Berlin": "DE",
  "Europe/Vienna": "AT", "Europe/Amsterdam": "NL", "Europe/London": "GB",
  "Europe/Dublin": "IE", "Europe/Warsaw": "PL", "Europe/Prague": "CZ",
  "Europe/Bucharest": "RO", "Europe/Athens": "GR", "Europe/Stockholm": "SE",
  "Europe/Oslo": "NO", "Europe/Copenhagen": "DK", "Europe/Helsinki": "FI",
  "Europe/Moscow": "RU", "Europe/Kyiv": "UA", "Europe/Istanbul": "TR",
  "America/New_York": "US", "America/Chicago": "US", "America/Denver": "US",
  "America/Los_Angeles": "US", "America/Toronto": "CA", "America/Vancouver": "CA",
  "America/Mexico_City": "MX", "America/Sao_Paulo": "BR", "America/Buenos_Aires": "AR",
  "America/Bogota": "CO", "America/Lima": "PE", "America/Santiago": "CL",
  "America/Port-au-Prince": "HT", "America/Martinique": "MQ", "America/Guadeloupe": "GP",
  "Asia/Tokyo": "JP", "Asia/Shanghai": "CN", "Asia/Hong_Kong": "HK",
  "Asia/Singapore": "SG", "Asia/Seoul": "KR", "Asia/Dubai": "AE",
  "Asia/Riyadh": "SA", "Asia/Jerusalem": "IL", "Asia/Kolkata": "IN",
  "Asia/Bangkok": "TH", "Asia/Jakarta": "ID", "Asia/Manila": "PH",
  "Asia/Ho_Chi_Minh": "VN", "Asia/Beirut": "LB", "Asia/Amman": "JO",
  "Australia/Sydney": "AU", "Australia/Melbourne": "AU", "Pacific/Auckland": "NZ",
};

// Best-effort suggestion only — never silently trusted, always shown as a
// removable/changeable pre-selection in the UI, matching the "fact vs.
// suggestion" epistemics used for the rest of the Business Context.
export function guessCountryFromBrowserTimezone(): string | null {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return TIMEZONE_COUNTRY[zone] ?? null;
  } catch {
    return null;
  }
}
