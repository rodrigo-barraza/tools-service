import type { OnDemandSourceOptions, CachedEvent } from "./_helpers.ts";

const OPENF1_BASE = "https://api.openf1.org/v1/sessions";

interface OpenF1Session {
  session_key: number;
  session_name: string;
  session_type: string;
  date_start: string;
  date_end: string;
  location: string;
  country_name: string;
  circuit_short_name: string;
  year: number;
}

/**
 * Fetch Formula 1 sessions from OpenF1. No API key required.
 * Filters sessions where the requested city matches the race location.
 */
export async function fetchOpenF1OnDemand(
  options: OnDemandSourceOptions,
): Promise<CachedEvent[]> {
  try {
    const currentYear = new Date().getFullYear();
    const response = await fetch(`${OPENF1_BASE}?year=${currentYear}`);
    if (!response.ok) return [];

    const sessions: OpenF1Session[] = await response.json();
    const normalizedCity = options.city.toLowerCase();

    return sessions
      .filter((session) => {
        const location = session.location.toLowerCase();
        const country = session.country_name.toLowerCase();
        return location.includes(normalizedCity) || normalizedCity.includes(location) || country.includes(normalizedCity);
      })
      .map((session) => ({
        name: `F1 ${session.circuit_short_name}: ${session.session_name}`,
        source: "openf1",
        sourceId: `openf1-${session.session_key}`,
        category: "sports",
        startDate: new Date(session.date_start),
        venue: {
          name: session.circuit_short_name,
          city: session.location,
        },
        metadata: {
          sessionType: session.session_type,
          country: session.country_name,
          year: session.year,
        },
      }));
  } catch {
    return [];
  }
}
