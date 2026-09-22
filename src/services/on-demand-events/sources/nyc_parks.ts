import type { OnDemandSourceOptions, CachedEvent } from "./_helpers.ts";

const NYC_PARKS_EVENTS_URL = "https://data.cityofnewyork.us/resource/w3wp-dpdi.json";

interface NycParksEvent {
  title: string;
  guid: string;
  description: string;
  parknames: string;
  startdate: string;
  enddate: string;
  starttime: string;
  endtime: string;
  location: string;
  categories: string;
  link: { url: string };
}

/**
 * Fetch public events from the NYC Parks Department via NYC Open Data.
 * No API key required.
 */
export async function fetchNycParksEventsOnDemand(
  options: OnDemandSourceOptions,
): Promise<CachedEvent[]> {
  try {
    // Only relevant if the user is looking for events in NYC
    const normalizedCity = options.city.toLowerCase();
    const isNyc = normalizedCity.includes("new york") || normalizedCity.includes("nyc");
    
    if (!isNyc && normalizedCity !== "") return [];

    const response = await fetch(`${NYC_PARKS_EVENTS_URL}?$limit=50`);
    if (!response.ok) return [];

    const data: NycParksEvent[] = await response.json();
    const now = new Date();

    return data
      .map((event) => {
        // Parse dates. The API returns startdate/enddate as T00:00:00 but has starttime/endtime as strings.
        const startDate = new Date(event.startdate);
        const endDate = new Date(event.enddate);

        return {
          name: event.title,
          source: "nyc-parks",
          sourceId: `nyc-parks-${event.guid}`,
          category: "entertainment", // Most park events are entertainment/community
          startDate,
          endDate,
          venue: {
            name: event.parknames,
            address: event.location,
            city: "New York",
          },
          url: event.link.url,
          metadata: {
            description: event.description,
            categories: event.categories,
            startTime: event.starttime,
            endTime: event.endtime,
          },
        };
      })
      .filter((event) => event.endDate >= now);
  } catch {
    return [];
  }
}
