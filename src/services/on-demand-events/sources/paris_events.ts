import type { OnDemandSourceOptions, CachedEvent } from "./_helpers.ts";

const PARIS_EVENTS_URL = "https://opendata.paris.fr/api/records/1.0/search/?dataset=que-faire-a-paris-&rows=50";

interface ParisRecord {
  fields: {
    id: string;
    title: string;
    description: string;
    date_start: string;
    date_end: string;
    address_name: string;
    address_street: string;
    address_zipcode: string;
    address_city: string;
    price_type: string;
    cover_url: string;
    url: string;
    category?: string;
  };
}

interface ParisResponse {
  records: ParisRecord[];
}

/**
 * Fetch public events from the City of Paris Open Data portal.
 * No API key required.
 */
export async function fetchParisEventsOnDemand(
  options: OnDemandSourceOptions,
): Promise<CachedEvent[]> {
  try {
    // Only relevant if the user is looking for events in Paris
    const normalizedCity = options.city.toLowerCase();
    const isParis = normalizedCity.includes("paris");
    
    if (!isParis && normalizedCity !== "") return [];

    const response = await fetch(PARIS_EVENTS_URL);
    if (!response.ok) return [];

    const data: ParisResponse = await response.json();
    const now = new Date();

    return data.records
      .map((record) => {
        const fields = record.fields;
        return {
          name: fields.title,
          source: "paris-events",
          sourceId: `paris-${fields.id}`,
          category: fields.category || "entertainment",
          startDate: new Date(fields.date_start),
          endDate: new Date(fields.date_end),
          venue: {
            name: fields.address_name,
            address: fields.address_street,
            city: fields.address_city,
            zipCode: fields.address_zipcode,
          },
          url: fields.url,
          metadata: {
            priceType: fields.price_type,
            coverUrl: fields.cover_url,
          },
        };
      })
      .filter((event) => event.endDate >= now);
  } catch {
    return [];
  }
}
