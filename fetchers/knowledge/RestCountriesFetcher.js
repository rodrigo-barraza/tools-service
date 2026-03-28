import { REST_COUNTRIES_BASE_URL } from "../../constants.js";

/**
 * Rest Countries API fetcher.
 * https://restcountries.com/ — no auth, fully open.
 * Returns country info: population, languages, currencies, flags, etc.
 */

// ─── Helpers ───────────────────────────────────────────────────────

function normalizeCountry(c) {
  return {
    name: c.name?.common || null,
    officialName: c.name?.official || null,
    nativeNames: c.name?.nativeName
      ? Object.values(c.name.nativeName)
          .map((n) => n.common)
          .slice(0, 3)
      : [],
    cca2: c.cca2 || null,
    cca3: c.cca3 || null,
    capital: c.capital || [],
    region: c.region || null,
    subregion: c.subregion || null,
    population: c.population || 0,
    area: c.area || null,
    languages: c.languages ? Object.values(c.languages) : [],
    currencies: c.currencies
      ? Object.entries(c.currencies).map(([code, info]) => ({
          code,
          name: info.name,
          symbol: info.symbol,
        }))
      : [],
    timezones: c.timezones || [],
    borders: c.borders || [],
    flag: c.flag || null,
    flagPng: c.flags?.png || null,
    flagSvg: c.flags?.svg || null,
    coatOfArms: c.coatOfArms?.png || null,
    googleMaps: c.maps?.googleMaps || null,
    callingCodes: c.idd?.root
      ? (c.idd.suffixes || [""]).map((s) => `${c.idd.root}${s}`).slice(0, 3)
      : [],
    continent: c.continents?.[0] || null,
    independent: c.independent ?? null,
    unMember: c.unMember ?? null,
    landlocked: c.landlocked ?? null,
    carSide: c.car?.side || null,
    startOfWeek: c.startOfWeek || null,
  };
}

// ─── Get Country by Name ───────────────────────────────────────────

/**
 * Search for a country by name (partial match).
 * @param {string} name
 * @returns {Promise<object[]>}
 */
export async function searchCountries(name) {
  const url = `${REST_COUNTRIES_BASE_URL}/name/${encodeURIComponent(name)}`;
  const res = await fetch(url);

  if (res.status === 404) {
    return { found: false, countries: [] };
  }
  if (!res.ok) {
    throw new Error(`Rest Countries API → ${res.status} ${res.statusText}`);
  }

  const data = await res.json();
  return {
    found: true,
    count: data.length,
    countries: data.slice(0, 10).map(normalizeCountry),
  };
}

// ─── Get Country by Code ───────────────────────────────────────────

/**
 * Get a single country by ISO 3166-1 alpha-2 or alpha-3 code.
 * @param {string} code - e.g. "CA", "CAN", "US"
 * @returns {Promise<object>}
 */
export async function getCountryByCode(code) {
  const url = `${REST_COUNTRIES_BASE_URL}/alpha/${encodeURIComponent(code.toUpperCase())}`;
  const res = await fetch(url);

  if (res.status === 404) {
    return { found: false, code };
  }
  if (!res.ok) {
    throw new Error(`Rest Countries API → ${res.status} ${res.statusText}`);
  }

  const data = await res.json();
  const country = Array.isArray(data) ? data[0] : data;
  return { found: true, ...normalizeCountry(country) };
}

// ─── Get All Countries (summary) ──────────────────────────────────

/**
 * Get summary data for all countries (useful for "largest by population" etc.).
 * Returns a lighter payload.
 * @returns {Promise<object[]>}
 */
export async function getAllCountries() {
  const url = `${REST_COUNTRIES_BASE_URL}/all?fields=name,cca2,population,region,capital,flags`;
  const res = await fetch(url);

  if (!res.ok) {
    throw new Error(`Rest Countries API → ${res.status} ${res.statusText}`);
  }

  const data = await res.json();
  return data.map((c) => ({
    name: c.name?.common || null,
    cca2: c.cca2 || null,
    population: c.population || 0,
    region: c.region || null,
    capital: c.capital?.[0] || null,
    flag: c.flags?.png || null,
  }));
}
