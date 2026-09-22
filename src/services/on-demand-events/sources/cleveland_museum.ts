import type { OnDemandSourceOptions, CachedEvent } from "./_helpers.ts";

const CMA_EXHIBITIONS_URL = "https://openaccess-api.clevelandart.org/api/exhibitions/";

interface CmaExhibition {
  id: number;
  title: string;
  opening_date: string | null;
  closing_date: string | null;
  venues: Array<{
    name: string;
    start_date: string | null;
    end_date: string | null;
  }>;
}

interface CmaResponse {
  data: CmaExhibition[];
}

/**
 * Fetch exhibitions from the Cleveland Museum of Art. No API key required.
 * Filters for current/upcoming exhibitions at the museum or its venues.
 */
export async function fetchClevelandMuseumOnDemand(
  options: OnDemandSourceOptions,
): Promise<CachedEvent[]> {
  try {
    // Only relevant if the user is looking for events in Cleveland or general museum events
    const normalizedCity = options.city.toLowerCase();
    const isCleveland = normalizedCity.includes("cleveland");
    
    // Fetch recent exhibitions
    const response = await fetch(`${CMA_EXHIBITIONS_URL}?limit=50`);
    if (!response.ok) return [];

    const data: CmaResponse = await response.json();
    const now = new Date();

    return data.data
      .filter((exhibition) => {
        if (!exhibition.opening_date || !exhibition.closing_date) return false;
        const closingDate = new Date(exhibition.closing_date);
        return closingDate >= now; // Only current or future
      })
      .filter((_exhibition) => {
        // If not Cleveland, only include if the title is very prominent (placeholder logic)
        // or if the user is in "global" mode (which we don't have a flag for yet, so we'll be generous if it's a major museum)
        return isCleveland || normalizedCity === "";
      })
      .map((exhibition) => ({
        name: `CMA Exhibition: ${exhibition.title}`,
        source: "cleveland-museum",
        sourceId: `cma-${exhibition.id}`,
        category: "arts",
        startDate: new Date(exhibition.opening_date!),
        endDate: new Date(exhibition.closing_date!),
        venue: {
          name: exhibition.venues[0]?.name || "Cleveland Museum of Art",
          city: "Cleveland",
        },
        metadata: {
          id: exhibition.id,
        },
      }));
  } catch {
    return [];
  }
}
