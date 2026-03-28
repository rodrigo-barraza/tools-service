import { EXCHANGE_RATE_BASE_URL } from "../../constants.js";

/**
 * Exchange Rate API fetcher.
 * https://open.er-api.com/ — no auth required (free tier).
 * Returns real-time exchange rates for 161 currencies.
 */

// ─── In-Memory Rate Cache ──────────────────────────────────────────

const rateCache = new Map();
const RATE_CACHE_TTL_MS = 3_600_000; // 1 hour — rates update daily on free tier

// ─── Fetch Latest Rates ────────────────────────────────────────────

/**
 * Get latest exchange rates for a base currency.
 * @param {string} [base="USD"]
 * @returns {Promise<object>}
 */
async function fetchRates(base = "USD") {
  const upperBase = base.toUpperCase();

  // Check cache
  const cached = rateCache.get(upperBase);
  if (cached && Date.now() - cached.fetchedAt < RATE_CACHE_TTL_MS) {
    return cached.data;
  }

  const url = `${EXCHANGE_RATE_BASE_URL}/${upperBase}`;
  const res = await fetch(url);

  if (!res.ok) {
    throw new Error(`Exchange Rate API → ${res.status} ${res.statusText}`);
  }

  const data = await res.json();

  if (data.result !== "success") {
    throw new Error(
      `Exchange Rate API → ${data["error-type"] || "unknown error"}`,
    );
  }

  const result = {
    base: data.base_code,
    lastUpdate: data.time_last_update_utc,
    nextUpdate: data.time_next_update_utc,
    rates: data.rates,
  };

  rateCache.set(upperBase, { data: result, fetchedAt: Date.now() });
  return result;
}

// ─── Convert Currency ──────────────────────────────────────────────

/**
 * Convert an amount from one currency to another.
 * @param {number} amount
 * @param {string} from - Source currency code (e.g. "USD")
 * @param {string} to - Target currency code (e.g. "CAD")
 * @returns {Promise<object>}
 */
export async function convertCurrency(amount, from, to) {
  const upperFrom = from.toUpperCase();
  const upperTo = to.toUpperCase();

  const rateData = await fetchRates(upperFrom);
  const rate = rateData.rates[upperTo];

  if (rate == null) {
    throw new Error(`Currency "${upperTo}" not found`);
  }

  const converted = Math.round(amount * rate * 100) / 100;

  return {
    from: upperFrom,
    to: upperTo,
    amount,
    rate,
    converted,
    lastUpdate: rateData.lastUpdate,
  };
}

// ─── List Available Currencies ─────────────────────────────────────

/**
 * Get all available currency codes.
 * @returns {Promise<string[]>}
 */
export async function listCurrencies() {
  const rateData = await fetchRates("USD");
  return Object.keys(rateData.rates).sort();
}
