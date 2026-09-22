import type { OnDemandSourceOptions, CachedEvent } from "./_helpers.ts";

const TVMAZE_BASE = "https://api.tvmaze.com/schedule";

interface TvMazeEpisode {
  id: number;
  url: string;
  name: string;
  season: number;
  number: number;
  airdate: string;
  airtime: string;
  airstamp: string;
  runtime: number;
  show: {
    id: number;
    name: string;
    type: string;
    network: {
      name: string;
      country: {
        name: string;
        code: string;
        timezone: string;
      };
    } | null;
    image: {
      medium: string;
    } | null;
    summary: string;
  };
}

/**
 * Fetch TV show schedules from TVmaze. No API key required.
 * Returns upcoming episodes for the requested country.
 */
export async function fetchTvMazeOnDemand(
  options: OnDemandSourceOptions,
): Promise<CachedEvent[]> {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const country = options.countryCode || "US";
    
    const response = await fetch(`${TVMAZE_BASE}?country=${country}&date=${today}`);
    if (!response.ok) return [];

    const episodes: TvMazeEpisode[] = await response.json();
    
    return episodes.map((episode) => ({
      name: `${episode.show.name}: ${episode.name}`,
      source: "tvmaze",
      sourceId: `tvmaze-${episode.id}`,
      category: "entertainment",
      startDate: new Date(episode.airstamp),
      url: episode.url,
      metadata: {
        showType: episode.show.type,
        network: episode.show.network?.name,
        runtime: episode.runtime,
        summary: episode.show.summary?.replace(/<[^>]*>/g, ""), // Strip HTML
        image: episode.show.image?.medium,
      },
    }));
  } catch {
    return [];
  }
}
